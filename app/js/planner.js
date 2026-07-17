import {
  store, uid, visible, moneyView, todaysPlan, currentWs, wsName, pushActivity,
  workspaceStorageGetItem, workspaceStorageSetItem,
} from "./store.js?v=phantom-live-20260717-12";

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
  const workspaceLabel = wsName(currentWs());

  el.innerHTML = `<div class="planner">
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
        ${plannerForm()}
        <section class="planner-card">
          <div class="planner-card-head"><div><p>Saved plan</p><h3>Workspace blocks</h3></div></div>
          <div class="planner-item-list">${items.length ? items.map(plannerItemCard).join("") : `<p class="planner-empty">Nothing saved yet. Use AI prep or add a planning block.</p>`}</div>
        </section>
      </aside>
    </section>
  </div>`;

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
}
