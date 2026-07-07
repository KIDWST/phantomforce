/* PhantomForce — Automation workspace.
   Customer and brand context belongs in the real Memory/Hermes notes layer.
   This file renders Automation honestly from user-created automation records
   only. No internal lanes or fabricated records are shown. */

import { store, visible, pushActivity, ago, currentWs } from "./store.js?v=phantom-live-20260707-54";

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

  el.innerHTML = `
    <div class="au">
      <div class="bm-note au-note"><i></i>Automations appear here after Phantom drafts them from the dashboard chat. Nothing runs until you approve it.</div>

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
