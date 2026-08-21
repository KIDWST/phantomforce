import {
  store, uid, visible, moneyView, todaysPlan, currentWs, wsName, pushActivity,
  workspaceStorageGetItem, workspaceStorageSetItem, session,
} from "./store.js?v=phantom-live-20260820-187";
import {
  brainContractAttentionItems, cachedBrainContract, cachedOrganizationPulse,
  loadBrainContract, loadOrganizationPulse, organizationPulseState,
} from "./organizationpulse.js?v=phantom-live-20260820-187";

const PLANNER_ITEMS_KEY = "pf.aiPlanner.items.v1";
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const isoDay = (date = new Date()) => date.toISOString().slice(0, 10);
const addDays = (base, days) => {
  const date = new Date(base);
  date.setDate(date.getDate() + days);
  return date;
};
const plannerRuntime = { notice: "", tone: "", running: false };

function authHeaders(json = false) {
  const token = typeof session?.token === "function" ? session.token() : "";
  const sessionId = typeof session?.get === "function" ? session.get()?.sessionId : "";
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(sessionId ? { "x-phantomforce-session": sessionId } : {}),
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

async function plannerApi(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...authHeaders(Boolean(options.body)), ...(options.headers || {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload?.error === "string" ? payload.error : `Operation failed (${response.status}).`);
  return payload;
}

function hydratePlannerIntelligence(paint, { force = false } = {}) {
  const state = organizationPulseState();
  if (!session.token() || plannerRuntime.running) return;
  const needsLoad = force || !cachedOrganizationPulse() || !cachedBrainContract();
  if (!needsLoad || state.status === "loading" || state.brainContractStatus === "loading") return;
  plannerRuntime.running = true;
  Promise.all([
    loadOrganizationPulse({ force }).catch(() => null),
    loadBrainContract({ force }).catch(() => null),
  ]).finally(() => {
    plannerRuntime.running = false;
    paint();
  });
}

function loadPlannerItems() {
  try {
    const parsed = JSON.parse(workspaceStorageGetItem(PLANNER_ITEMS_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savePlannerItems(items) {
  workspaceStorageSetItem(PLANNER_ITEMS_KEY, JSON.stringify(items.slice(0, 120)));
}

function startOfWeek(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay() || 7;
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day + 1);
  return d;
}

function dueToday(record = {}) {
  const raw = record.due || record.date || record.scheduledAt || record.at;
  if (!raw) return false;
  return isoDay(new Date(raw)) <= isoDay();
}

function plannerSignals() {
  const approvals = visible(store.state.approvals || []).filter((item) => item.status === "pending");
  const leads = visible(store.state.leads || []).filter((lead) => ["new", "follow-up"].includes(lead.status || "new"));
  const tasks = visible(store.state.tasks || []).filter((task) => ["new", "working"].includes(task.status || "new"));
  const finance = moneyView();
  const automations = visible(store.state.agents || []).filter((agent) => agent.kind === "automation");
  return {
    approvals,
    leads,
    tasks,
    finance,
    automations,
    dueLeads: leads.filter(dueToday),
    dueTasks: tasks.filter(dueToday),
    activeAutomations: automations.filter((agent) => agent.status === "active"),
    stockAutomations: automations.filter((agent) => agent.stock || agent.source === "Stock automation"),
  };
}

function aiPrepQueue(signals) {
  const items = [];
  if (signals.approvals.length) items.push({
    id: "approvals",
    title: "Prepare approval decisions",
    detail: `${signals.approvals.length} pending item${signals.approvals.length === 1 ? "" : "s"} need owner review before anything external happens.`,
    open: "approvals",
    priority: "high",
  });
  if (signals.dueLeads.length) items.push({
    id: "crm",
    title: "Prep CRM follow-ups",
    detail: `${signals.dueLeads.length} lead${signals.dueLeads.length === 1 ? "" : "s"} are due now. Draft the next touch before they cool off.`,
    open: "leads",
    priority: "high",
  });
  if (signals.finance.uncategorizedCount) items.push({
    id: "accounting",
    title: "Clean accounting categories",
    detail: `${signals.finance.uncategorizedCount} transaction${signals.finance.uncategorizedCount === 1 ? "" : "s"} still need categories or receipt context.`,
    open: "money",
    priority: "medium",
  });
  if (signals.dueTasks.length) items.push({
    id: "tasks",
    title: "Turn loose tasks into a work block",
    detail: `${signals.dueTasks.length} task${signals.dueTasks.length === 1 ? "" : "s"} are ready. Batch them into one focused block.`,
    open: "workforce",
    priority: "medium",
  });
  if (!signals.activeAutomations.length) items.push({
    id: "automations",
    title: "Turn on baseline automation coverage",
    detail: "Stock automation bundles exist, but none are active in this workspace.",
    open: "automation",
    priority: "high",
  });
  items.push({
    id: "weekly",
    title: "Draft the week plan",
    detail: "Reserve time for owner approvals, CRM hygiene, accounting review, content prep, and website checks.",
    open: "planner",
    priority: "normal",
  });
  return items.slice(0, 6);
}

function attentionQueue(localItems, { ownerOperator = false } = {}) {
  const serverItems = brainContractAttentionItems().map((item) => ({
    id: item.signal?.id || `server:${item.title}`,
    title: item.title,
    detail: item.signal?.whatHappened || item.sub,
    kind: item.signal?.department || "AI signal",
    open: item.open,
    source: "Live organization brain",
    aiAction: item.signal?.canPhantomHandle ? "handle" : "prepare",
    approvalRequired: item.signal?.approvalRequired === true,
    repairId: ownerOperator && String(item.signal?.id || "").startsWith("opportunity:automation-failing:")
      ? String(item.signal.id).replace("opportunity:automation-failing:", "")
      : "",
    retryFailedRuns: item.signal?.id === "opportunity:runs-failed",
  }));
  const local = localItems.map((item) => ({ ...item, title: item.text, source: "Workspace record" }));
  const seen = new Set();
  return [...local, ...serverItems].filter((item) => {
    const key = `${String(item.open || "").toLowerCase()}:${String(item.title || "").toLowerCase()}`;
    if (!item.title || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 12);
}

function operatorPrompt(items, mode = "single") {
  const scope = items.map((item, index) => `${index + 1}. [${item.kind || "attention"}] ${item.title}${item.detail ? ` — ${item.detail}` : ""}${item.approvalRequired ? " [APPROVAL OR OWNER ACTION REQUIRED]" : ""}`).join("\n");
  return `Operate this PhantomForce attention ${mode === "bulk" ? "queue" : "item"} end to end for organization ${wsName(currentWs())}.\n\n${scope}\n\nDo every safe internal step you can now: inspect real workspace state, repair retryable internal failures, organize work, draft missing material, and verify the result. Never claim completion without a receipt or a real record change. Do not send, publish, deploy, spend, delete, change credentials, or approve on the owner's behalf. Prepare those consequential steps completely and leave one clear approval card for the owner. Finish with a compact monitor report: completed, still running, needs approval, and blocked with the exact reason.`;
}

function manualAttentionAction(item) {
  const now = new Date().toISOString();
  if (item.manualAction === "done") {
    const task = (store.state.tasks || []).find((record) => record.id === item.recordId);
    if (!task) return false;
    task.status = "done";
    task.completedAt = now;
    task.updatedAt = now;
    pushActivity("Planner", `manually completed task "${task.title}".`, currentWs());
    store.save();
    return true;
  }
  if (item.manualAction === "follow-up-done") {
    const lead = (store.state.leads || []).find((record) => record.id === item.recordId);
    if (!lead) return false;
    lead.status = "follow-up";
    lead.lastContactAt = now;
    lead.due = isoDay(addDays(new Date(), 7));
    lead.next = "Review the next touch in one week";
    pushActivity("Planner", `recorded a completed follow-up for ${lead.name}.`, currentWs());
    store.save();
    return true;
  }
  return false;
}

async function retryFailedRuns() {
  const pulse = cachedOrganizationPulse();
  const failed = pulse?.agentRuns?.available
    ? (pulse.agentRuns.recent || []).filter((run) => run.state === "failed")
    : [];
  const results = await Promise.allSettled(failed.map((run) => plannerApi(`/phantom-ai/runs/${encodeURIComponent(run.id)}/retry`, { method: "POST" })));
  return { attempted: failed.length, succeeded: results.filter((result) => result.status === "fulfilled").length };
}

async function runDirectRepair(item) {
  if (item.repairId) {
    await plannerApi(`/phantom-ai/automations/${encodeURIComponent(item.repairId)}/run`, { method: "POST" });
    return "Workflow rerun finished and its proof was refreshed.";
  }
  if (item.retryFailedRuns) {
    const result = await retryFailedRuns();
    return result.attempted
      ? `${result.succeeded}/${result.attempted} failed run${result.attempted === 1 ? "" : "s"} safely retried.`
      : "No retryable failed runs remain.";
  }
  return "";
}

function attentionCard(item) {
  const directRepair = item.repairId || item.retryFailedRuns;
  const manual = item.manualAction === "done" || item.manualAction === "follow-up-done";
  return `<article class="planner-attention-card ${item.approvalRequired ? "needs-approval" : "can-run"}">
    <div class="planner-attention-copy">
      <small>${esc(item.kind || "signal")} · ${esc(item.source || "Phantom")}</small>
      <b>${esc(item.title)}</b>
      <p>${esc(item.detail || "Phantom has enough context to prepare the next safe step.")}</p>
      <span>${item.approvalRequired ? "Owner gate preserved" : item.aiAction === "handle" ? "AI can handle" : "AI can prepare"}</span>
    </div>
    <div class="planner-attention-actions">
      ${directRepair ? `<button class="btn btn-primary" type="button" data-pl-repair="${esc(item.id)}">${item.retryFailedRuns ? "Retry safely" : "Repair now"}</button>` : `<button class="btn btn-primary" type="button" data-pl-ai="${esc(item.id)}">${item.aiAction === "handle" ? "AI handle" : "AI prepare"}</button>`}
      ${manual ? `<button class="btn btn-quiet" type="button" data-pl-manual="${esc(item.id)}">${item.manualAction === "done" ? "Mark done" : "Follow-up done"}</button>` : ""}
      <button class="btn btn-quiet" type="button" data-open-ws="${esc(item.open || "phantomai")}">Open</button>
    </div>
  </article>`;
}

function metricCard(label, value, sub) {
  return `<span><b>${esc(value)}</b><i>${esc(label)}</i><em>${esc(sub)}</em></span>`;
}

function automationBundleCard(agent) {
  const enabled = agent.status === "active";
  const jobs = Array.isArray(agent.jobs) ? agent.jobs : [];
  return `<article class="planner-auto-card ${enabled ? "is-on" : "is-off"}">
    <div>
      <small>${esc(agent.family || "Automation")} · ${esc(agent.cadence || "Scheduled")}</small>
      <b>${esc(agent.name)}</b>
      <p>${esc(agent.mission || "")}</p>
    </div>
    <ul>${jobs.slice(0, 5).map((job) => `<li>${esc(job)}</li>`).join("")}</ul>
    <em>${enabled ? "Enabled" : "Off"} · ${esc(agent.safeMode || "approval-gated")}</em>
  </article>`;
}

function plannerItemCard(item) {
  return `<article class="planner-item ${item.status === "done" ? "is-done" : ""}">
    <div>
      <small>${esc(item.type || "Plan")} · ${esc(item.priority || "normal")}</small>
      <b>${esc(item.title)}</b>
      ${item.notes ? `<p>${esc(item.notes)}</p>` : ""}
    </div>
    <div class="planner-item-actions">
      <button class="btn btn-quiet" type="button" data-pl-done="${esc(item.id)}">${item.status === "done" ? "Reopen" : "Done"}</button>
      <button class="btn btn-quiet" type="button" data-pl-delete="${esc(item.id)}">Remove</button>
    </div>
  </article>`;
}

function weekBoard(items, signals) {
  const start = startOfWeek();
  const taskEvents = [...signals.tasks, ...signals.leads].map((item) => ({
    id: item.id,
    date: item.due || item.date || item.at,
    title: item.title || item.name || item.next || "Business item",
    type: item.name ? "CRM" : "Task",
  })).filter((item) => item.date);
  return `<section class="planner-card planner-week">
    <div class="planner-card-head">
      <div><p>AI week board</p><h3>What Phantom should keep in view</h3></div>
      <button class="btn btn-quiet" type="button" data-open-ws="automation">Automation coverage</button>
    </div>
    <div class="planner-days">
      ${Array.from({ length: 7 }, (_, index) => {
        const day = addDays(start, index);
        const key = isoDay(day);
        const dayItems = items.filter((item) => item.date === key);
        const records = taskEvents.filter((item) => isoDay(new Date(item.date)) === key);
        return `<div class="planner-day ${key === isoDay() ? "is-today" : ""}">
          <header><b>${day.toLocaleDateString(undefined, { weekday: "short" })}</b><span>${day.getDate()}</span></header>
          <div>
            ${[...dayItems.map((item) => ({ title: item.title, type: item.type || "Plan" })), ...records].slice(0, 4).map((item) => `<p><b>${esc(item.type)}</b>${esc(item.title)}</p>`).join("") || `<i>Open planning space</i>`}
          </div>
        </div>`;
      }).join("")}
    </div>
  </section>`;
}

function plannerForm() {
  return `<section class="planner-card planner-add">
    <div class="planner-card-head"><div><p>Manual or AI-prepped</p><h3>Add a planning block</h3></div></div>
    <form data-pl-form>
      <label>Title<input data-pl-title required placeholder="Review ChicagoShots follow-ups" /></label>
      <label>Type<select data-pl-type><option>Focus</option><option>CRM</option><option>Accounting</option><option>Security</option><option>Content</option><option>Website</option></select></label>
      <label>Date<input data-pl-date type="date" value="${isoDay()}" /></label>
      <label>Priority<select data-pl-priority><option>normal</option><option>medium</option><option>high</option></select></label>
      <label class="planner-wide">Notes<textarea data-pl-notes placeholder="What should Phantom prepare, watch, or summarize?"></textarea></label>
      <button class="btn btn-primary" type="submit">Save plan block</button>
    </form>
  </section>`;
}

export function renderPlanner(el, opts = {}) {
  const notify = opts.notify || (() => {});
  const paint = () => renderPlanner(el, opts);
  const items = loadPlannerItems();
  const signals = plannerSignals();
  const prep = aiPrepQueue(signals);
  const plan = todaysPlan();
  const attention = attentionQueue(plan, { ownerOperator: opts.isOwnerOperator === true });
  const pulse = cachedOrganizationPulse();
  const serverRunning = pulse?.agentRuns?.available ? Number(pulse.agentRuns.running || 0) : 0;
  const aiReady = typeof opts.runAI === "function";
  const workspaceLabel = wsName(currentWs());

  el.innerHTML = `<div class="planner">
    <section class="planner-hero">
      <div>
        <p>AI planner · ${esc(workspaceLabel)}</p>
        <h2>Monitor the business. Phantom runs the routine.</h2>
        <span>Phantom watches approvals, CRM, accounting, tasks, schedules, content, sites, and system health—then handles safe work and brings only consequential decisions back to you.</span>
      </div>
      <div class="planner-metrics">
        ${metricCard("Needs attention", attention.length, attention.length ? "real records + live signals" : "all clear")}
        ${metricCard("AI running", serverRunning, serverRunning ? "working in background" : "ready for work")}
        ${metricCard("Owner decisions", signals.approvals.length, "never auto-approved")}
        ${metricCard("Automations", signals.activeAutomations.length, `${signals.stockAutomations.length} stocked`)}
      </div>
    </section>
    <section class="planner-autopilot ${attention.length ? "has-work" : "is-clear"}" aria-label="Phantom Autopilot">
      <div class="planner-autopilot-state"><span class="planner-autopilot-orb" aria-hidden="true"></span><div><p>Phantom Autopilot</p><h3>${attention.length ? `${attention.length} item${attention.length === 1 ? "" : "s"} triaged` : "Everything is under control"}</h3><span>${attention.length ? "Safe internal work can run together. External actions stay queued for your approval." : "Phantom is watching live organization records and will surface only real work."}</span></div></div>
      <div class="planner-autopilot-actions">
        <button class="btn btn-primary" type="button" data-pl-run-all ${!attention.length || !aiReady || plannerRuntime.running ? "disabled" : ""}>${plannerRuntime.running ? "Working…" : "AI complete all safe work"}</button>
        <button class="btn btn-quiet" type="button" data-pl-refresh ${plannerRuntime.running ? "disabled" : ""}>Recheck everything</button>
      </div>
    </section>
    ${plannerRuntime.notice ? `<div class="planner-operation-notice is-${esc(plannerRuntime.tone || "info")}" role="status">${esc(plannerRuntime.notice)}</div>` : ""}
    <section class="planner-grid">
      <div class="planner-main">
        <section class="planner-card planner-brief">
          <div class="planner-card-head">
            <div><p>AI operating queue</p><h3>Needs attention—already triaged</h3></div>
            <span class="planner-live-state"><i></i>${session.token() ? "Live organization brain" : "Local workspace monitor"}</span>
          </div>
          <div class="planner-attention-list">
            ${attention.length ? attention.map(attentionCard).join("") : `<div class="planner-clear"><b>No work needs you right now.</b><span>Phantom will continue monitoring connections, failed runs, approvals, clients, finance, security, and scheduled work.</span></div>`}
          </div>
        </section>
        ${weekBoard(items, signals)}
        <section class="planner-card">
          <div class="planner-card-head"><div><p>Automation stock</p><h3>Baseline coverage for this organization</h3></div><button class="btn btn-quiet" type="button" data-open-ws="automation">Open Automations</button></div>
          <div class="planner-auto-grid">${signals.stockAutomations.map(automationBundleCard).join("")}</div>
        </section>
      </div>
      <aside class="planner-side">
        <section class="planner-card">
          <div class="planner-card-head"><div><p>AI prep queue</p><h3>What Phantom would prepare next</h3></div></div>
          <div class="planner-prep-list">
            ${prep.map((item) => `<article><small>${esc(item.priority)}</small><b>${esc(item.title)}</b><p>${esc(item.detail)}</p><div><button class="btn btn-quiet" type="button" data-open-ws="${esc(item.open)}">Open</button><button class="btn btn-quiet" type="button" data-pl-suggest="${esc(item.id)}">Plan it</button><button class="btn btn-primary" type="button" data-pl-prep-ai="${esc(item.id)}" ${!aiReady ? "disabled" : ""}>AI prepare</button></div></article>`).join("")}
          </div>
        </section>
        ${plannerForm()}
        <section class="planner-card">
          <div class="planner-card-head"><div><p>Saved plan</p><h3>Workspace blocks</h3></div></div>
          <div class="planner-item-list">${items.length ? items.map(plannerItemCard).join("") : `<p class="planner-empty">Nothing saved yet. Use AI prep or add a planning block.</p>`}</div>
        </section>
      </aside>
    </section>
  </div>`;

  el.querySelector("[data-pl-refresh]")?.addEventListener("click", () => {
    plannerRuntime.notice = "Rechecking live records, system health, and the organization brain…";
    plannerRuntime.tone = "info";
    hydratePlannerIntelligence(paint, { force: true });
    paint();
  });

  el.querySelector("[data-pl-run-all]")?.addEventListener("click", async () => {
    if (!attention.length || !aiReady || plannerRuntime.running) return;
    plannerRuntime.running = true;
    plannerRuntime.notice = `Phantom is handling ${attention.length} attention item${attention.length === 1 ? "" : "s"}. Consequential actions will wait for approval.`;
    plannerRuntime.tone = "working";
    paint();
    const direct = attention.filter((item) => item.repairId || item.retryFailedRuns);
    const directResults = await Promise.allSettled(direct.map(runDirectRepair));
    const repaired = directResults.filter((result) => result.status === "fulfilled").length;
    const queued = opts.runAI(operatorPrompt(attention, "bulk"), { autoSubmit: true, source: "Needs attention" });
    plannerRuntime.running = false;
    plannerRuntime.notice = `${repaired ? `${repaired} retryable system item${repaired === 1 ? "" : "s"} restarted. ` : ""}${queued ? "PhantomBot is completing the remaining safe work now; owner gates are preserved." : "Open PhantomBot to complete the prepared work."}`;
    plannerRuntime.tone = queued ? "success" : "warn";
    pushActivity("Phantom Autopilot", `started a bulk safe-work pass for ${attention.length} attention item${attention.length === 1 ? "" : "s"}.`, currentWs());
    store.save();
  });

  el.querySelectorAll("[data-pl-ai]").forEach((button) => {
    button.onclick = () => {
      const item = attention.find((candidate) => candidate.id === button.dataset.plAi);
      if (!item || !aiReady) return;
      opts.runAI(operatorPrompt([item]), { autoSubmit: true, source: "Needs attention" });
    };
  });

  el.querySelectorAll("[data-pl-prep-ai]").forEach((button) => {
    button.onclick = () => {
      const item = prep.find((candidate) => candidate.id === button.dataset.plPrepAi);
      if (!item || !aiReady) return;
      opts.runAI(operatorPrompt([{ ...item, kind: "AI prep", source: "Planner recommendation", aiAction: "prepare" }]), { autoSubmit: true, source: "AI prep queue" });
    };
  });

  el.querySelectorAll("[data-pl-manual]").forEach((button) => {
    button.onclick = () => {
      const item = attention.find((candidate) => candidate.id === button.dataset.plManual);
      if (!item || !manualAttentionAction(item)) return;
      plannerRuntime.notice = `Recorded “${item.title}” as manually handled.`;
      plannerRuntime.tone = "success";
      notify("Planner", plannerRuntime.notice);
      paint();
    };
  });

  el.querySelectorAll("[data-pl-repair]").forEach((button) => {
    button.onclick = async () => {
      const item = attention.find((candidate) => candidate.id === button.dataset.plRepair);
      if (!item || plannerRuntime.running) return;
      plannerRuntime.running = true;
      plannerRuntime.notice = `Repairing “${item.title}”…`;
      plannerRuntime.tone = "working";
      paint();
      try {
        plannerRuntime.notice = await runDirectRepair(item);
        plannerRuntime.tone = "success";
        await Promise.all([loadOrganizationPulse({ force: true }).catch(() => null), loadBrainContract({ force: true }).catch(() => null)]);
      } catch (error) {
        plannerRuntime.notice = error instanceof Error ? error.message : "The repair could not finish.";
        plannerRuntime.tone = "warn";
      } finally {
        plannerRuntime.running = false;
        paint();
      }
    };
  });

  el.querySelector("[data-pl-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const item = {
      id: uid("plan"),
      title: el.querySelector("[data-pl-title]")?.value.trim().slice(0, 120) || "Planner block",
      type: el.querySelector("[data-pl-type]")?.value || "Focus",
      date: el.querySelector("[data-pl-date]")?.value || isoDay(),
      priority: el.querySelector("[data-pl-priority]")?.value || "normal",
      notes: el.querySelector("[data-pl-notes]")?.value.trim().slice(0, 500) || "",
      status: "open",
      createdAt: new Date().toISOString(),
    };
    savePlannerItems([item, ...items]);
    pushActivity("Planner", `saved plan block "${item.title}".`, currentWs());
    notify("Planner", `Saved "${item.title}".`);
    paint();
  });

  el.querySelectorAll("[data-pl-suggest]").forEach((btn) => {
    btn.onclick = () => {
      const suggestion = prep.find((item) => item.id === btn.dataset.plSuggest);
      if (!suggestion) return;
      const item = {
        id: uid("plan"),
        title: suggestion.title,
        type: "AI prep",
        date: isoDay(),
        priority: suggestion.priority,
        notes: suggestion.detail,
        status: "open",
        createdAt: new Date().toISOString(),
      };
      savePlannerItems([item, ...items]);
      pushActivity("Planner", `queued AI prep block "${item.title}".`, currentWs());
      notify("Planner", `Queued "${item.title}".`);
      paint();
    };
  });

  el.querySelectorAll("[data-pl-done]").forEach((btn) => {
    btn.onclick = () => {
      const next = items.map((item) => item.id === btn.dataset.plDone ? { ...item, status: item.status === "done" ? "open" : "done", updatedAt: new Date().toISOString() } : item);
      savePlannerItems(next);
      paint();
    };
  });
  el.querySelectorAll("[data-pl-delete]").forEach((btn) => {
    btn.onclick = () => {
      savePlannerItems(items.filter((item) => item.id !== btn.dataset.plDelete));
      paint();
    };
  });
  hydratePlannerIntelligence(paint);
}
