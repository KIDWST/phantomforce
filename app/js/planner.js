import {
  store, uid, visible, moneyView, todaysPlan, currentWs, wsName, pushActivity,
  workspaceStorageGetItem, workspaceStorageSetItem,
} from "./store.js?v=phantom-live-20260717-18";

const PLANNER_ITEMS_KEY = "pf.aiPlanner.items.v1";
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const isoDay = (date = new Date()) => date.toISOString().slice(0, 10);
const addDays = (base, days) => {
  const date = new Date(base);
  date.setDate(date.getDate() + days);
  return date;
};

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

/* ---------------- 3-lane board: Blocked / Ready / Done ----------------
   Lanes are derived, never stored: a block is only ever "blocked" while it
   genuinely depends on another saved block that isn't done yet. That means
   completing (or reopening) any block automatically recalculates every
   downstream block's lane on the next render — there is no separate "recalc"
   step to forget to run, and a dependency on a block that no longer exists
   (deleted) silently resolves instead of leaving the block stuck blocked
   forever. Dependencies only ever point at real saved plan blocks, never
   invented placeholder tasks. */
function unmetDependencies(item, items) {
  const dependsOn = Array.isArray(item.dependsOn) ? item.dependsOn : [];
  return dependsOn
    .map((id) => items.find((candidate) => candidate.id === id))
    .filter((blocker) => blocker && blocker.status !== "done");
}
function deriveLane(item, items) {
  if (item.status === "done") return "done";
  return unmetDependencies(item, items).length ? "blocked" : "ready";
}
const LANES = [
  { id: "blocked", label: "Blocked", hint: "Waiting on another block to finish first." },
  { id: "ready", label: "Ready", hint: "Nothing in the way — can be worked now." },
  { id: "done", label: "Done", hint: "Finished. Reopening recalculates anything blocked on it." },
];

function depCandidates(item, items) {
  // A can't depend on B if B already (directly) depends on A — the
  // shallow guard that keeps the dependency picker from offering the most
  // obvious two-item deadlock. Deeper cycles are still possible if someone
  // really wants one, same as any real planning tool.
  return items.filter((other) => other.id !== item.id && !(Array.isArray(other.dependsOn) && other.dependsOn.includes(item.id)));
}

function dependencyPicker(item, items) {
  const candidates = depCandidates(item, items).slice(0, 24);
  const selected = new Set(Array.isArray(item.dependsOn) ? item.dependsOn : []);
  if (!candidates.length) return "";
  return `<details class="planner-dep-picker">
    <summary>Depends on ${selected.size ? `(${selected.size})` : ""}</summary>
    <div class="planner-dep-list">
      ${candidates.map((candidate) => `<label><input type="checkbox" data-pl-dep="${esc(item.id)}" value="${esc(candidate.id)}" ${selected.has(candidate.id) ? "checked" : ""}><span>${esc(candidate.title)}</span></label>`).join("")}
    </div>
  </details>`;
}

function plannerItemCard(item, items) {
  const lane = deriveLane(item, items);
  const blockers = lane === "blocked" ? unmetDependencies(item, items) : [];
  return `<article class="planner-item planner-item-${lane}">
    <div>
      <small>${esc(item.type || "Plan")} · ${esc(item.priority || "normal")}</small>
      <b>${esc(item.title)}</b>
      ${item.notes ? `<p>${esc(item.notes)}</p>` : ""}
      ${blockers.length ? `<p class="planner-item-blockers">Blocked by ${blockers.map((blocker) => esc(blocker.title)).join(", ")}</p>` : ""}
    </div>
    ${dependencyPicker(item, items)}
    <div class="planner-item-actions">
      <button class="btn btn-quiet" type="button" data-pl-done="${esc(item.id)}" ${lane === "blocked" && item.status !== "done" ? 'title="Blocked items can still be marked done if the work actually happened."' : ""}>${item.status === "done" ? "Reopen" : "Done"}</button>
      <button class="btn btn-quiet" type="button" data-pl-delete="${esc(item.id)}">Remove</button>
    </div>
  </article>`;
}

function laneBoard(items) {
  return `<div class="planner-lanes">
    ${LANES.map((lane) => {
      const laneItems = items.filter((item) => deriveLane(item, items) === lane.id);
      return `<section class="planner-lane planner-lane-${lane.id}">
        <header><h4>${esc(lane.label)}</h4><span>${laneItems.length}</span></header>
        <p class="planner-lane-hint">${esc(lane.hint)}</p>
        <div class="planner-lane-items">
          ${laneItems.length ? laneItems.map((item) => plannerItemCard(item, items)).join("") : `<p class="planner-empty">Nothing here.</p>`}
        </div>
      </section>`;
    }).join("")}
  </div>`;
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

function plannerForm(items = []) {
  return `<section class="planner-card planner-add">
    <div class="planner-card-head"><div><p>Manual or AI-prepped</p><h3>Add a planning block</h3></div></div>
    <form data-pl-form>
      <label>Title<input data-pl-title required placeholder="Review ChicagoShots follow-ups" /></label>
      <label>Type<select data-pl-type><option>Focus</option><option>CRM</option><option>Accounting</option><option>Security</option><option>Content</option><option>Website</option></select></label>
      <label>Date<input data-pl-date type="date" value="${isoDay()}" /></label>
      <label>Priority<select data-pl-priority><option>normal</option><option>medium</option><option>high</option></select></label>
      <label class="planner-wide">Notes<textarea data-pl-notes placeholder="What should Phantom prepare, watch, or summarize?"></textarea></label>
      ${items.length ? `<label class="planner-wide">Depends on (optional)
        <select data-pl-new-deps multiple size="${Math.min(6, items.length)}">
          ${items.slice(0, 30).map((item) => `<option value="${esc(item.id)}">${esc(item.title)}${item.status === "done" ? " (done)" : ""}</option>`).join("")}
        </select>
        <i class="planner-hint">Ctrl/Cmd-click to select more than one. Leave empty for a block that's ready right away.</i>
      </label>` : ""}
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
  const workspaceLabel = wsName(currentWs());

  el.innerHTML = `<div class="planner pl">
    <section class="planner-hero">
      <div>
        <p>AI planner · ${esc(workspaceLabel)}</p>
        <h2>Plan the business before the business asks.</h2>
        <span>Phantom watches approvals, CRM, accounting, tasks, schedules, content, sites, and automation coverage, then turns it into a clean operating day.</span>
      </div>
      <div class="planner-metrics">
        ${metricCard("Approvals", signals.approvals.length, "waiting on owner")}
        ${metricCard("Due CRM", signals.dueLeads.length, "follow-ups now")}
        ${metricCard("Accounting", signals.finance.uncategorizedCount, "uncategorized")}
        ${metricCard("Automations", signals.activeAutomations.length, `${signals.stockAutomations.length} stocked`)}
      </div>
    </section>
    <section class="planner-grid">
      <div class="planner-main">
        <section class="planner-card planner-brief">
          <div class="planner-card-head">
            <div><p>Operating brief</p><h3>Today needs attention here</h3></div>
            <button class="btn btn-quiet" type="button" data-open-ws="approvals">Review approvals</button>
          </div>
          <div class="planner-brief-list">
            ${plan.length ? plan.map((item) => `<button type="button" data-open-ws="${esc(item.open)}"><b>${esc(item.kind || "signal")}</b><span>${esc(item.text)}</span></button>`).join("") : `<p class="planner-empty">No urgent local records. Planner will keep watching as connectors and workspace records fill in.</p>`}
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
            ${prep.map((item) => `<article><small>${esc(item.priority)}</small><b>${esc(item.title)}</b><p>${esc(item.detail)}</p><div><button class="btn btn-quiet" type="button" data-open-ws="${esc(item.open)}">Open</button><button class="btn btn-quiet" type="button" data-pl-suggest="${esc(item.id)}">Plan it</button></div></article>`).join("")}
          </div>
        </section>
        ${plannerForm(items)}
      </aside>
    </section>
    <section class="planner-card planner-board-card">
      <div class="planner-card-head"><div><p>Saved plan · 3-lane board</p><h3>Blocked → Ready → Done</h3></div></div>
      ${items.length ? laneBoard(items) : `<p class="planner-empty">Nothing saved yet. Use AI prep or add a planning block.</p>`}
    </section>
  </div>`;

  el.querySelector("[data-pl-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const dependsOn = Array.from(el.querySelector("[data-pl-new-deps]")?.selectedOptions || []).map((option) => option.value);
    const item = {
      id: uid("plan"),
      title: el.querySelector("[data-pl-title]")?.value.trim().slice(0, 120) || "Planner block",
      type: el.querySelector("[data-pl-type]")?.value || "Focus",
      date: el.querySelector("[data-pl-date]")?.value || isoDay(),
      priority: el.querySelector("[data-pl-priority]")?.value || "normal",
      notes: el.querySelector("[data-pl-notes]")?.value.trim().slice(0, 500) || "",
      status: "open",
      dependsOn,
      createdAt: new Date().toISOString(),
    };
    savePlannerItems([item, ...items]);
    pushActivity("Planner", `saved plan block "${item.title}"${dependsOn.length ? ` (blocked on ${dependsOn.length})` : ""}.`, currentWs());
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
      const targetId = btn.dataset.plDone;
      const target = items.find((item) => item.id === targetId);
      const wasDone = target?.status === "done";
      const next = items.map((item) => item.id === targetId ? { ...item, status: wasDone ? "open" : "done", updatedAt: new Date().toISOString() } : item);
      // Dependency recalculation isn't a separate step: deriveLane() reads
      // live status off `next`, so anything that depended on this block just
      // became Ready (or Blocked again on reopen) the moment paint() re-renders.
      if (!wasDone && target) {
        const unblocked = items.filter((item) => item.id !== targetId
          && unmetDependencies(item, items).some((blocker) => blocker.id === targetId)
          && unmetDependencies(item, next).length === 0);
        if (unblocked.length) pushActivity("Planner", `"${target.title}" is done — ${unblocked.map((item) => `"${item.title}"`).join(", ")} moved to Ready.`, currentWs());
      }
      savePlannerItems(next);
      paint();
    };
  });
  el.querySelectorAll("[data-pl-dep]").forEach((checkbox) => {
    checkbox.onchange = () => {
      const itemId = checkbox.dataset.plDep;
      const next = items.map((item) => {
        if (item.id !== itemId) return item;
        const current = new Set(Array.isArray(item.dependsOn) ? item.dependsOn : []);
        if (checkbox.checked) current.add(checkbox.value); else current.delete(checkbox.value);
        return { ...item, dependsOn: [...current], updatedAt: new Date().toISOString() };
      });
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
}
