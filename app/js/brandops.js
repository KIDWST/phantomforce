/* PhantomForce — Automation workspace.
   A standalone system: automations are real user-created workflow records
   that run independently of any other feature. Vacation Mode (its own
   first-class page) can lean on automations while it's active, but this
   page never renders vacation-specific UI — that would blur two different
   products into one confusing surface. Customer/brand context belongs in
   the real Memory/Hermes notes layer; this file renders only real,
   user-created automation records. No internal lanes or fabricated
   records are shown. */

import { store, uid, visible, pushActivity, ago, currentWs } from "./store.js?v=phantom-live-20260709-117";

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const AGENT_STATE = {
  active: { label: "RUNNING", cls: "on" },
  waiting: { label: "WAITING", cls: "gate" },
  "needs-approval": { label: "APPROVE", cls: "gate" },
  blocked: { label: "BLOCKED", cls: "hold" },
  paused: { label: "PAUSED", cls: "idle" },
  idle: { label: "DRAFT", cls: "idle" },
};

/* Starter recipes — real, honest starting points. Using one creates a real
   draft automation record (same path as chat-created automations) that
   waits in Drafts for approval; nothing runs on its own. */
const RECIPES = [
  { id: "lead-followup", name: "Follow up with new leads every morning", mission: "Each morning, review new leads from the last 24 hours and draft a personalized follow-up for each one. Drafts wait for approval before sending." },
  { id: "weekly-analytics", name: "Send me a weekly analytics report", mission: "Every week, compile a summary of connected-account performance and post it as an activity update." },
  { id: "comment-drafts", name: "Draft replies to comments, don't send", mission: "Watch connected social accounts for new comments and draft a reply for each — nothing sends without approval." },
  { id: "lead-assign", name: "Assign a worker when a new lead comes in", mission: "When a new lead is captured, assign it to an available worker and draft an initial response for review." },
  { id: "daily-digest", name: "Daily digest of what needs my attention", mission: "Each morning, summarize pending approvals, urgent items, and anything blocked so it's one glance instead of a hunt." },
];

const TABS = [
  ["active", "Active"],
  ["recipes", "Recipes"],
  ["drafts", "Drafts"],
  ["logs", "Logs"],
  ["safety", "Safety rules"],
];

let auTab = "active";

function agentCard(a, opts) {
  const st = AGENT_STATE[a.status] || AGENT_STATE.idle;
  const pendingApproval = (store.state.approvals || []).find((app) => app.ref === a.id && app.status === "pending");
  /* Vacation Mode never controls whether this automation exists or runs
     normally — allowedDuringVacation only decides whether away-coverage is
     permitted to invoke it while the owner is away. */
  const allowedDuringVacation = a.allowedDuringVacation !== false;
  return `<div class="au-item">
    <span class="aops-led aops-${st.cls === "on" ? "on" : st.cls === "idle" ? "idle" : st.cls === "hold" ? "hold" : "gate"}"><i></i></span>
    <span class="au-item-main">
      <b>${esc(a.name)}</b>
      <i>${esc(a.mission || a.role || "")}</i>
      <em>Created ${esc(ago(a.createdAt))} · Updated ${esc(ago(a.updatedAt))} · ${esc(a.source || "Phantom dashboard")}</em>
      <em class="au-vacation-flag ${allowedDuringVacation ? "au-vacation-flag-on" : "au-vacation-flag-off"}">${allowedDuringVacation ? "Allowed during Vacation Mode" : "Blocked during Vacation Mode"} · requires approval to run</em>
    </span>
    <span class="aops-agent-mode aops-m-${st.cls === "on" ? "on" : st.cls === "idle" ? "idle" : st.cls === "hold" ? "hold" : "gate"}">${st.label}</span>
    <span class="au-actions">
      ${pendingApproval ? `<button class="btn btn-quiet" data-open-ws="approvals">Review</button>` : ""}
      ${a.status === "active" ? `<button class="btn btn-quiet" data-au-pause="${a.id}">Pause</button>` : ""}
      ${a.status === "paused" || a.status === "waiting" ? `<button class="btn btn-quiet" data-au-resume="${a.id}">Resume</button>` : ""}
      <button class="btn btn-quiet" data-au-vacation-toggle="${a.id}" title="Vacation Mode rules decide whether this can run while you are away.">${allowedDuringVacation ? "Block in Vacation Mode" : "Allow in Vacation Mode"}</button>
    </span>
    <button class="bm-x" data-au-del="${a.id}" aria-label="Remove automation">✕</button>
  </div>`;
}

function activeTab(agents) {
  const active = agents.filter((a) => a.status === "active");
  return `<div class="au-list">${active.length ? active.map((a) => agentCard(a)).join("") : `<div class="au-empty"><b>Nothing running right now.</b><span>Approve a draft below to start it, or use a recipe to create one.</span></div>`}</div>`;
}

function recipesTab() {
  return `<div class="au-recipes">
    <p class="bm-hint au-recipes-note">Using a recipe drafts a real automation and sends it to Drafts for your review — nothing runs until you approve it.</p>
    <div class="au-recipe-grid">
      ${RECIPES.map((r) => `<article class="au-recipe-card">
        <b>${esc(r.name)}</b>
        <p>${esc(r.mission)}</p>
        <button class="btn btn-quiet" type="button" data-au-recipe="${esc(r.id)}">Use this recipe</button>
      </article>`).join("")}
    </div>
  </div>`;
}

function draftsTab(agents) {
  const drafts = agents.filter((a) => a.status === "idle" || a.status === "needs-approval");
  return `<div class="au-list">${drafts.length ? drafts.map((a) => agentCard(a)).join("") : `<div class="au-empty"><b>No drafts waiting.</b><span>Ask Phantom on the dashboard to create a repeatable workflow, or use a recipe.</span><button class="btn" data-au-focus type="button">Ask Phantom</button></div>`}</div>`;
}

function logsTab() {
  const rows = (store.state.activity || []).filter((a) => a.text && /automation/i.test(a.text)).slice(0, 40);
  return `<div class="au-logs">${rows.length ? rows.map((a) => `<div class="au-log-row"><b>${esc(a.who)}</b><span>${esc(a.text)}</span><i>${ago(a.at)}</i></div>`).join("") : `<p class="au-empty-note">No automation history yet.</p>`}</div>`;
}

function safetyTab() {
  const rules = [
    ["New automations start as drafts", "Nothing runs the moment it's created — every automation waits in Drafts until you approve it."],
    ["Outward-facing actions always gate", "Sending, publishing, spending, or deleting always queues to Approvals — automations can't skip that, regardless of status."],
    ["Pause stops before the next run", "Pausing an active automation stops it cleanly; resuming picks back up from paused, not mid-action. Pausing this automation does not disable Vacation Mode."],
    ["Vacation Mode is a separate system", "Vacation Mode rules decide whether this can run while you are away. Automations can be used during Vacation Mode if allowed, but turning Vacation Mode on or off never starts, stops, or deletes an automation."],
    ["Connected app scope", "No per-automation third-party app connections are tracked yet — automations run against your PhantomForce workspace only."],
  ];
  return `<div class="au-safety">${rules.map(([t, d]) => `<article class="au-safety-card"><b>${esc(t)}</b><p>${esc(d)}</p></article>`).join("")}</div>`;
}

export function renderAutomation(el, opts = {}) {
  const notify = opts.notify || (() => {});
  const paint = () => renderAutomation(el, opts);
  const agents = visible(store.state.agents || []);
  const count = agents.length;
  const pending = agents.filter((a) => a.status === "idle" || a.status === "needs-approval").length;
  const running = agents.filter((a) => a.status === "active").length;
  const paused = agents.filter((a) => a.status === "paused" || a.status === "waiting").length;

  const panel = auTab === "active" ? activeTab(agents)
    : auTab === "recipes" ? recipesTab()
    : auTab === "drafts" ? draftsTab(agents)
    : auTab === "logs" ? logsTab()
    : safetyTab();

  el.innerHTML = `
    <div class="au">
      <div class="bm-note au-note"><i></i>Automations help your team move faster — they appear here after Phantom drafts them from the dashboard chat, or you pick a recipe, and nothing runs until you approve it. Vacation Mode is a separate system with its own page: automations can be used during Vacation Mode if allowed, but Vacation Mode never turns your automations on or off.</div>
      <div class="au-summary" aria-label="Automation summary">
        <span><b>${count}</b><i>Total</i></span>
        <span><b>${pending}</b><i>Needs approval</i></span>
        <span><b>${running}</b><i>Running</i></span>
        <span><b>${paused}</b><i>Paused</i></span>
      </div>
      <nav class="ml-tabs au-tabs" role="tablist">
        ${TABS.map(([id, label]) => `<button class="ml-tab ${auTab === id ? "is-active" : ""}" type="button" role="tab" data-au-tab="${id}">${label}${id === "drafts" && pending ? ` <i class="ss-acc-count">${pending}</i>` : ""}</button>`).join("")}
      </nav>
      <section class="bm-card au-card">${panel}</section>
    </div>`;

  el.querySelectorAll("[data-au-tab]").forEach((btn) => btn.onclick = () => { auTab = btn.dataset.auTab; paint(); });

  el.querySelectorAll("[data-au-recipe]").forEach((btn) => {
    btn.onclick = () => {
      const recipe = RECIPES.find((r) => r.id === btn.dataset.auRecipe);
      if (!recipe) return;
      const ws = currentWs() === "phantomforce" ? "phantomforce" : currentWs();
      const a = {
        id: uid("agt"), ws, kind: "automation", source: "Recipe",
        name: recipe.name, mission: recipe.mission, status: "idle",
        allowedDuringVacation: true, requiresApprovalDuringVacation: true,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      store.state.agents.unshift(a);
      store.state.approvals.unshift({
        id: uid("app"), ws, type: "automation",
        title: `Enable automation: ${a.name}`, detail: a.mission,
        ref: a.id, status: "pending", requestedBy: "Recipe", at: new Date().toISOString(),
      });
      pushActivity("Automation", `drafted automation "${a.name}" from a recipe — waiting on approval.`, ws);
      // Switch tab and re-render on this closure's live element before store.save()/notify() —
      // notify() triggers a global store-change listener that can fully remount this page,
      // which would otherwise leave this call updating an already-detached DOM reference.
      auTab = "drafts";
      paint();
      store.save();
      notify("Automation", `Drafted "${a.name}" from a recipe. It's waiting in Drafts for your approval.`);
    };
  });

  el.querySelector("[data-au-focus]")?.addEventListener("click", () => opts.focusCommand?.());
  el.querySelectorAll("[data-au-pause]").forEach((btn) => {
    btn.onclick = () => {
      const agent = (store.state.agents || []).find((a) => a.id === btn.dataset.auPause);
      if (!agent) return;
      agent.status = "paused";
      agent.updatedAt = new Date().toISOString();
      pushActivity("Automation", `paused automation "${agent.name}".`, agent.ws || currentWs());
      paint();
      store.save();
      notify("Automation", `paused "${agent.name}".`);
    };
  });
  el.querySelectorAll("[data-au-resume]").forEach((btn) => {
    btn.onclick = () => {
      const agent = (store.state.agents || []).find((a) => a.id === btn.dataset.auResume);
      if (!agent) return;
      agent.status = "active";
      agent.updatedAt = new Date().toISOString();
      pushActivity("Automation", `resumed automation "${agent.name}".`, agent.ws || currentWs());
      paint();
      store.save();
      notify("Automation", `resumed "${agent.name}".`);
    };
  });
  el.querySelectorAll("[data-au-vacation-toggle]").forEach((btn) => {
    btn.onclick = () => {
      const agent = (store.state.agents || []).find((a) => a.id === btn.dataset.auVacationToggle);
      if (!agent) return;
      const nextAllowed = !(agent.allowedDuringVacation !== false);
      agent.allowedDuringVacation = nextAllowed;
      agent.updatedAt = new Date().toISOString();
      pushActivity("Automation", `${nextAllowed ? "allowed" : "blocked"} "${agent.name}" during Vacation Mode.`, agent.ws || currentWs());
      paint();
      store.save();
      notify("Automation", nextAllowed ? `"${agent.name}" is now allowed during Vacation Mode.` : `"${agent.name}" is now blocked during Vacation Mode.`);
    };
  });
  el.querySelectorAll("[data-au-del]").forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.auDel;
      const removed = (store.state.agents || []).find((a) => a.id === id);
      store.state.agents = (store.state.agents || []).filter((a) => a.id !== id);
      store.state.approvals = (store.state.approvals || []).filter((a) => a.ref !== id);
      if (removed) pushActivity("Automation", `removed automation "${removed.name}".`, removed.ws);
      paint();
      store.save();
    };
  });
}
