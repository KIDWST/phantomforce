/* PhantomForce — Automation workspace.
   Customer and brand context belongs in the real Memory/Hermes notes layer.
   This file renders Automation honestly from user-created automation records
   only. No internal lanes or fabricated records are shown. */

import { store, uid, visible, pushActivity, ago, currentWs, VACATION_POLICY } from "./store.js?v=phantom-live-20260709-98";

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ======================================================================
   AUTOMATION — user-created workflows only
   ====================================================================== */
const AGENT_STATE = {
  active: { label: "RUNNING", cls: "on" },
  waiting: { label: "WAITING", cls: "gate" },
  "needs-approval": { label: "APPROVE", cls: "gate" },
  blocked: { label: "BLOCKED", cls: "hold" },
  paused: { label: "PAUSED", cls: "idle" },
  idle: { label: "DRAFT", cls: "idle" },
};

export function renderAutomation(el, opts = {}) {
  const notify = opts.notify || (() => {});
  const paint = () => renderAutomation(el, opts);
  const agents = visible(store.state.agents || []);
  const count = agents.length;
  const pending = agents.filter((a) => a.status === "idle" || a.status === "needs-approval").length;
  const running = agents.filter((a) => a.status === "active").length;
  const paused = agents.filter((a) => a.status === "paused" || a.status === "waiting").length;

  const vacationRuns = visible(store.state.vacationRuns || []);
  const VAC_AGENTS = ["Planner", "Builder", "Creative", "Website", "Ops", "Reviewer", "Approval"];
  const VAC_STATUS = {
    draft: "DRAFT", awaiting_approval: "AWAITING APPROVAL", running: "RUNNING",
    paused: "PAUSED", complete: "COMPLETE", blocked: "BLOCKED", failed: "FAILED",
  };

  el.innerHTML = `
    <div class="au">
      <div class="bm-note au-note"><i></i>Automations appear here after Phantom drafts them from the dashboard chat. Nothing runs until you approve it.</div>

      <section class="bm-card au-card vac-card">
        <div class="bm-card-h">
          <h3>Vacation Mode</h3>
          <span class="bm-hint">Planning scaffold — approved autonomous runs come next</span>
        </div>
        <p class="vac-tag">Leave the work running without losing control.</p>
        <p class="vac-desc">Choose approved goals, limits, and actions. Phantom drafts, organizes, reviews, and reports while you're away — anything risky waits in the Approval Queue.</p>
        <div class="vac-form">
          <label class="vac-field vac-wide"><span>Goal while you're away</span>
            <input type="text" data-vac-goal maxlength="220" placeholder="e.g. Continue the game trailer, draft the landing page, organize tasks, write the launch email" />
          </label>
          <label class="vac-field"><span>Time window</span>
            <select data-vac-window>
              <option value="120">2 hours</option>
              <option value="240">4 hours</option>
              <option value="360" selected>6 hours</option>
              <option value="480">Overnight (8h max)</option>
            </select>
          </label>
          <label class="vac-field"><span>Report cadence</span>
            <select data-vac-cadence>
              <option value="on-return" selected>One report when I'm back</option>
              <option value="hourly">Hourly summaries</option>
              <option value="on-complete">When everything's done</option>
            </select>
          </label>
          <div class="vac-field vac-wide"><span>Agents on the run</span>
            <div class="vac-chips" data-vac-agents>
              ${VAC_AGENTS.map((a, i) => `<button type="button" class="vac-chip ${i < 4 ? "on" : ""}" data-vac-agent="${a}">${a}</button>`).join("")}
            </div>
          </div>
          <div class="vac-bounds vac-wide">
            <div><b>Allowed while away</b><i>${VACATION_POLICY.allowedActions.join(" · ")}</i></div>
            <div><b>Waits for your approval</b><i>${VACATION_POLICY.blockedActions.join(" · ")}</i></div>
          </div>
        </div>
        <div class="vac-actions">
          <button class="btn" data-vac-draft type="button">Draft Vacation Plan</button>
          <button class="btn btn-quiet" data-open-ws="approvals" type="button">View approvals</button>
        </div>
        ${vacationRuns.length ? `<div class="au-list vac-runs">
          ${vacationRuns.map((r) => `<div class="au-item">
            <span class="aops-led aops-${r.status === "awaiting_approval" ? "gate" : "idle"}"><i></i></span>
            <span class="au-item-main"><b>${esc(r.title)}</b><i>${esc(r.goal)}</i><em>${Math.round((r.timeWindowMinutes || 360) / 60)}h window · ${esc((r.assignedAgents || []).join(", "))} · report: ${esc(r.reportCadence || "on-return")}</em></span>
            <span class="aops-agent-mode aops-m-${r.status === "awaiting_approval" ? "gate" : "idle"}">${VAC_STATUS[r.status] || "DRAFT"}</span>
            <span class="au-actions">
              ${r.status === "draft" ? `<button class="btn btn-quiet" data-vac-submit="${r.id}">Start after approval</button>` : ""}
              ${r.status === "awaiting_approval" ? `<button class="btn btn-quiet" data-open-ws="approvals">Review</button>` : ""}
            </span>
            <button class="bm-x" data-vac-del="${r.id}" aria-label="Remove vacation plan">✕</button>
          </div>`).join("")}
        </div>` : ""}
      </section>

      <section class="bm-card au-card">
        <div class="bm-card-h"><h3>Your automations</h3><span class="bm-hint">${count} made</span></div>
        <div class="au-summary" aria-label="Automation summary">
          <span><b>${count}</b><i>Total</i></span>
          <span><b>${pending}</b><i>Needs approval</i></span>
          <span><b>${running}</b><i>Running</i></span>
          <span><b>${paused}</b><i>Paused</i></span>
        </div>
        <div class="au-list">
          ${agents.length ? agents.map((a) => {
            const st = AGENT_STATE[a.status] || AGENT_STATE.idle;
            const pendingApproval = (store.state.approvals || []).find((app) => app.ref === a.id && app.status === "pending");
            const created = a.createdAt ? ago(a.createdAt) : "created by Phantom";
            return `<div class="au-item">
              <span class="aops-led aops-${st.cls === "on" ? "on" : st.cls === "idle" ? "idle" : st.cls === "hold" ? "hold" : "gate"}"><i></i></span>
              <span class="au-item-main"><b>${esc(a.name)}</b><i>${esc(a.mission || a.role || "")}</i><em>${esc(created)} · ${esc(a.source || "Phantom dashboard")}</em></span>
              <span class="aops-agent-mode aops-m-${st.cls === "on" ? "on" : st.cls === "idle" ? "idle" : st.cls === "hold" ? "hold" : "gate"}">${st.label}</span>
              <span class="au-actions">
                ${pendingApproval ? `<button class="btn btn-quiet" data-open-ws="approvals">Review</button>` : ""}
                ${a.status === "active" ? `<button class="btn btn-quiet" data-au-pause="${a.id}">Pause</button>` : ""}
                ${a.status === "paused" || a.status === "waiting" ? `<button class="btn btn-quiet" data-au-resume="${a.id}">Resume</button>` : ""}
              </span>
              <button class="bm-x" data-au-del="${a.id}" aria-label="Remove automation">✕</button>
            </div>`;
          }).join("") : `<div class="au-empty"><b>No automations made yet.</b><span>Ask Phantom on the dashboard to create a repeatable workflow. It will land here as a draft and wait for approval.</span><button class="btn" data-au-focus type="button">Ask Phantom</button></div>`}
        </div>
      </section>
    </div>`;

  /* ---- Vacation Mode scaffold: drafts a bounded run plan, never executes.
     "Start after approval" queues it in Approvals; autonomy ships later. ---- */
  el.querySelectorAll("[data-vac-agent]").forEach((chip) => {
    chip.onclick = () => chip.classList.toggle("on");
  });
  el.querySelector("[data-vac-draft]")?.addEventListener("click", () => {
    const goal = (el.querySelector("[data-vac-goal]")?.value || "").trim();
    if (!goal) {
      el.querySelector("[data-vac-goal]")?.focus();
      notify("Vacation Mode", "Give the run a goal first — what should keep moving while you're away?");
      return;
    }
    const agents = [...el.querySelectorAll("[data-vac-agent].on")].map((c) => c.dataset.vacAgent);
    const run = {
      id: uid("vac"),
      ws: currentWs() === "phantomforce" ? "phantomforce" : currentWs(),
      title: `Vacation run — ${goal.slice(0, 42)}${goal.length > 42 ? "…" : ""}`,
      goal,
      status: "draft",
      timeWindowMinutes: Math.min(VACATION_POLICY.maxRunMinutes, Number(el.querySelector("[data-vac-window]")?.value || 360)),
      reportCadence: el.querySelector("[data-vac-cadence]")?.value || "on-return",
      allowedActions: [...VACATION_POLICY.allowedActions],
      blockedActions: [...VACATION_POLICY.blockedActions],
      assignedAgents: agents.length ? agents : ["Planner", "Builder", "Creative", "Website"],
      approvalRequired: true,
      startedAt: null,
      completedAt: null,
      report: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    store.state.vacationRuns.unshift(run);
    pushActivity("Vacation Mode", `drafted run plan "${run.title}" — nothing runs until approval.`, run.ws);
    store.save();
    notify("Vacation Mode", `Plan drafted: "${goal.slice(0, 48)}". Nothing is running — review it, then send it to approval.`);
    paint();
  });
  el.querySelectorAll("[data-vac-submit]").forEach((btn) => {
    btn.onclick = () => {
      const run = (store.state.vacationRuns || []).find((r) => r.id === btn.dataset.vacSubmit);
      if (!run) return;
      run.status = "awaiting_approval";
      run.updatedAt = new Date().toISOString();
      store.state.approvals.unshift({
        id: uid("app"), ws: run.ws, type: "vacation_mode",
        title: `Start Vacation Mode: ${run.title}`,
        detail: `${run.goal} · ${Math.round(run.timeWindowMinutes / 60)}h window · agents: ${run.assignedAgents.join(", ")}. Allowed: ${run.allowedActions.slice(0, 5).join(", ")}… Blocked without approval: ${run.blockedActions.slice(0, 5).join(", ")}…`,
        ref: run.id, status: "pending", requestedBy: "Vacation Mode", at: new Date().toISOString(),
      });
      pushActivity("Vacation Mode", `queued "${run.title}" for approval. Autonomous execution ships in a later build — approving records your go-ahead.`, run.ws);
      store.save();
      notify("Vacation Mode", "Run queued for your approval. Approved autonomous execution is the next build — nothing moves without you.");
      paint();
    };
  });
  el.querySelectorAll("[data-vac-del]").forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.vacDel;
      store.state.vacationRuns = (store.state.vacationRuns || []).filter((r) => r.id !== id);
      store.state.approvals = (store.state.approvals || []).filter((a) => a.ref !== id);
      store.save();
      paint();
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
      store.save();
      notify("Automation", `paused "${agent.name}".`);
      paint();
    };
  });
  el.querySelectorAll("[data-au-resume]").forEach((btn) => {
    btn.onclick = () => {
      const agent = (store.state.agents || []).find((a) => a.id === btn.dataset.auResume);
      if (!agent) return;
      agent.status = "active";
      agent.updatedAt = new Date().toISOString();
      pushActivity("Automation", `resumed automation "${agent.name}".`, agent.ws || currentWs());
      store.save();
      notify("Automation", `resumed "${agent.name}".`);
      paint();
    };
  });
  el.querySelectorAll("[data-au-del]").forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.auDel;
      const removed = (store.state.agents || []).find((a) => a.id === id);
      store.state.agents = (store.state.agents || []).filter((a) => a.id !== id);
      store.state.approvals = (store.state.approvals || []).filter((a) => a.ref !== id);
      if (removed) pushActivity("Automation", `removed automation "${removed.name}".`, removed.ws);
      store.save();
      paint();
    };
  });
}
