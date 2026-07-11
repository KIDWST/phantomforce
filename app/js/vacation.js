/* PhantomForce Vacation Mode — hands-off business coverage.
   AI work and real-human operator work are intentionally separate. Operator
   credits never masquerade as AI credits, and queued work never masquerades
   as completed human work. */

import { session as accessSession, ago } from "./store.js?v=phantom-live-20260711-159";

const esc = (value = "") => String(value)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

const TASK_LABELS = {
  phone_call: "Take or return a call",
  attend_meeting: "Attend a meeting",
  lead_follow_up: "Follow up with a lead",
  booking_coordination: "Coordinate a booking",
  client_message: "Handle a client message",
  research: "Research and report",
  exception_triage: "Handle an exception",
  other: "Other human work",
};

const TASK_STATUS = {
  needs_setup: "Needs setup",
  blocked: "Blocked",
  queued: "Waiting for operator",
  assigned: "Operator assigned",
  in_progress: "In progress",
  completed: "Completed",
  canceled: "Canceled",
};

const READINESS_COPY = {
  ready: "Ready",
  needs_setup: "Needs setup",
  not_connected: "Not connected",
  in_app_only: "In-app only",
  blocked_by_policy: "Blocked",
};

let state = {
  loading: true,
  error: "",
  status: null,
  activity: [],
  approvals: [],
  tasks: [],
};

function authHeaders(extra = {}) {
  const token = typeof accessSession?.token === "function" ? accessSession.token() : "";
  return { ...extra, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: authHeaders({
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || data.message || `Vacation Mode request failed (${response.status})`);
  }
  return data;
}

const STATUS_CACHE_KEY = "pf.vacation.statusCache.v2";
function cacheStatusForNav(status) {
  try { localStorage.setItem(STATUS_CACHE_KEY, JSON.stringify({ enabled: !!status?.enabled, at: Date.now() })); } catch {}
}

export function cachedVacationStatus() {
  try {
    const current = JSON.parse(localStorage.getItem(STATUS_CACHE_KEY) || "null");
    if (current && typeof current.enabled === "boolean") return current;
    const legacy = JSON.parse(localStorage.getItem("pf.vacation.statusCache.v1") || "null");
    if (legacy && typeof legacy.enabled === "boolean") return legacy;
  } catch {}
  return null;
}

async function loadVacationData() {
  const [status, activity, approvals, tasks] = await Promise.all([
    api("/api/vacation-mode/status"),
    api("/api/vacation-mode/activity?limit=60"),
    api("/api/vacation-mode/approvals?limit=20"),
    api("/api/vacation-mode/operator-tasks?limit=60"),
  ]);
  state = {
    loading: false,
    error: "",
    status,
    activity: activity.activity || [],
    approvals: approvals.approvals || [],
    tasks: tasks.tasks || [],
  };
  cacheStatusForNav(status);
}

function fmtTime(value) {
  if (!value) return "Not yet";
  try { return new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
  catch { return String(value); }
}

function boolAttr(value) {
  return value ? "checked" : "";
}

function localDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function coveragePayload(root) {
  const getToggle = (key) => !!root.querySelector(`[data-vm-coverage="${key}"]`)?.checked;
  const getPermission = (key) => !!root.querySelector(`[data-vm-permission="${key}"]`)?.checked;
  return {
    operatorCoverage: {
      enabled: true,
      ownerInterruptionPolicy: root.querySelector("[data-vm-interruption]")?.value || "emergencies_only",
      allowPhoneCalls: getToggle("allowPhoneCalls"),
      allowMeetings: getToggle("allowMeetings"),
      allowLeadFollowUp: getToggle("allowLeadFollowUp"),
      allowBookingCoordination: getToggle("allowBookingCoordination"),
      allowClientMessages: getToggle("allowClientMessages"),
      dailyCreditLimit: Number(root.querySelector("[data-vm-credit-limit]")?.value || 10),
      handoffNotes: root.querySelector("[data-vm-handoff]")?.value || "",
      awayStart: root.querySelector("[data-vm-away-start]")?.value || "",
      awayEnd: root.querySelector("[data-vm-away-end]")?.value || "",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago",
    },
    permissions: {
      watchInbox: getPermission("watchInbox"),
      draftEmailReplies: true,
      sendEmailOnlyAfterApproval: false,
      autoReplyToNewMessages: getPermission("autoReplyToNewMessages"),
      followUpWithLeads: getPermission("followUpWithLeads"),
      updateCrmTasks: true,
      scheduleSocialPosts: getPermission("scheduleSocialPosts"),
      generateContentDrafts: true,
      monitorUrgentItems: true,
      notifyImportantChanges: true,
      allowLowRiskAutomations: true,
      requireApprovalForAllOutbound: false,
    },
    outOfOffice: {
      enabled: !!root.querySelector("[data-vm-ooo-enabled]")?.checked,
      template: root.querySelector("[data-vm-ooo-template]")?.value || "",
      startDate: root.querySelector("[data-vm-away-start]")?.value || "",
      endDate: root.querySelector("[data-vm-away-end]")?.value || "",
      behavior: root.querySelector("[data-vm-ooo-behavior]")?.value || "queue_for_operator",
    },
    notificationPreferences: {
      inApp: true,
      emailSummary: false,
      urgentOnly: true,
      dailyDigest: true,
      realTimeActivityFeed: true,
    },
  };
}

function statusHero(status) {
  const active = !!status.enabled;
  const operator = status.operator || {};
  const wallet = operator.wallet || {};
  const network = operator.network || {};
  return `<section class="vm-command ${active ? "is-active" : ""}">
    <div class="vm-command-copy">
      <span class="vm-kicker">Full business coverage</span>
      <h2>${active ? "You are away. Phantom is on duty." : "Go away. Your business stays covered."}</h2>
      <p>Phantom handles digital work. Human calls, meetings, and judgment-heavy work go to your operator desk using separate Operator Credits.</p>
      <div class="vm-promise-row">
        <span>AI work continues</span>
        <span>Human operator queue</span>
        <span>Owner interrupted for emergencies only</span>
      </div>
    </div>
    <div class="vm-command-state">
      <span class="vm-state-pill ${active ? "on" : "off"}">${active ? "ON DUTY" : "OFF"}</span>
      <strong>${wallet.available ?? 0}</strong>
      <small>Operator Credits available</small>
      <em>Separate from AI credits</em>
      <div class="vm-status-actions">
        ${active
          ? `<button class="btn btn-primary vm-danger" data-vm-deactivate type="button">End Vacation Mode</button>
             <button class="btn btn-quiet" data-vm-kill type="button">Stop new work now</button>`
          : `<button class="btn btn-primary" data-vm-activate type="button">Start hands-off coverage</button>`}
      </div>
      <i class="vm-staffing ${network.humanStaffingReady ? "is-ready" : ""}">${network.humanStaffingReady ? "Live operators available" : "Operator queue ready · staffing connection needed"}</i>
    </div>
  </section>`;
}

function metrics(status) {
  const m = status.metrics || {};
  const items = [
    [m.operatorCreditsAvailable ?? 0, "Operator credits"],
    [m.operatorTasksQueued ?? 0, "Human tasks open"],
    [m.operatorTasksCompleted ?? 0, "Human tasks done"],
    [m.digitalWorkCompleted ?? 0, "Digital work done"],
    [m.ownerInterruptions ?? 0, "Need you"],
    [m.lastCheckIn ? ago(m.lastCheckIn) : "Not yet", "Last check-in"],
  ];
  return `<section class="vm-metrics">${items.map(([value, label]) => `<article class="vm-metric"><b>${esc(value)}</b><span>${esc(label)}</span></article>`).join("")}</section>`;
}

function coveragePlan(status) {
  const c = status.operator?.coverage || {};
  return `<section class="vm-card vm-plan-card">
    <div class="vm-card-head"><span class="vm-kicker">One handoff</span><h3>Tell your operator what matters</h3></div>
    <div class="vm-plan-grid">
      <label class="vm-field"><span>Leave</span><input type="datetime-local" data-vm-away-start value="${esc(localDateTime(c.awayStart))}" /></label>
      <label class="vm-field"><span>Return</span><input type="datetime-local" data-vm-away-end value="${esc(localDateTime(c.awayEnd))}" /></label>
      <label class="vm-field"><span>Interrupt me</span><select data-vm-interruption>
        <option value="emergencies_only" ${c.ownerInterruptionPolicy !== "daily_digest" ? "selected" : ""}>Emergencies only</option>
        <option value="daily_digest" ${c.ownerInterruptionPolicy === "daily_digest" ? "selected" : ""}>Daily summary</option>
      </select></label>
      <label class="vm-field"><span>Daily human-work limit</span><input type="number" min="1" max="100" data-vm-credit-limit value="${esc(c.dailyCreditLimit ?? 10)}" /></label>
      <label class="vm-field vm-wide"><span>Standing instructions</span><textarea data-vm-handoff rows="4" placeholder="What can your operator decide without interrupting you?">${esc(c.handoffNotes || "")}</textarea></label>
    </div>
    <div class="vm-toggle-grid vm-coverage-toggles">
      ${[
        ["allowPhoneCalls", "Calls", "Take or return business calls"],
        ["allowMeetings", "Meetings", "Attend, take notes, and report back"],
        ["allowLeadFollowUp", "Lead follow-up", "Keep opportunities moving"],
        ["allowBookingCoordination", "Bookings", "Coordinate schedules and details"],
        ["allowClientMessages", "Client messages", "Handle routine communication"],
      ].map(([key, label, detail]) => `<label class="vm-toggle"><span><b>${label}</b><i>${detail}</i></span><input type="checkbox" data-vm-coverage="${key}" ${boolAttr(c[key] !== false)} /></label>`).join("")}
    </div>
    <div class="vm-save-row"><button class="btn btn-primary" data-vm-save type="button">Save coverage plan</button><span>These instructions follow this business workspace only.</span></div>
  </section>`;
}

function operatorWallet(status) {
  const operator = status.operator || {};
  const wallet = operator.wallet || {};
  const costs = operator.creditCosts || {};
  return `<section class="vm-card vm-wallet-card">
    <div class="vm-card-head"><span class="vm-kicker">Human work balance</span><h3>Operator Credits</h3></div>
    <div class="vm-wallet-numbers">
      <span><b>${esc(wallet.available ?? 0)}</b><i>Available</i></span>
      <span><b>${esc(wallet.reserved ?? 0)}</b><i>Reserved</i></span>
      <span><b>${esc(wallet.used ?? 0)}</b><i>Used</i></span>
    </div>
    <p>Operator Credits pay for real human time. AI generation and chat use a different balance.</p>
    <div class="vm-cost-list">
      <span>Call <b>${costs.phone_call ?? 2}</b></span>
      <span>Meeting <b>${costs.attend_meeting ?? 4}</b></span>
      <span>Follow-up <b>${costs.lead_follow_up ?? 1}</b></span>
      <span>Booking <b>${costs.booking_coordination ?? 1}</b></span>
    </div>
  </section>`;
}

function newOperatorTask(status) {
  const costs = status.operator?.creditCosts || {};
  return `<section class="vm-card vm-new-task">
    <div class="vm-card-head"><span class="vm-kicker">Real human work</span><h3>Give the operator desk a job</h3></div>
    <div class="vm-operator-form">
      <label class="vm-field"><span>Job</span><select data-vm-task-type>
        ${Object.entries(TASK_LABELS).filter(([key]) => key !== "exception_triage").map(([key, label]) => `<option value="${key}">${esc(label)} · ${costs[key] ?? 1} credit${(costs[key] ?? 1) === 1 ? "" : "s"}</option>`).join("")}
      </select></label>
      <label class="vm-field"><span>Person or company</span><input data-vm-task-contact placeholder="Optional" /></label>
      <label class="vm-field"><span>When</span><input type="datetime-local" data-vm-task-time /></label>
      <label class="vm-field vm-wide"><span>What needs to happen?</span><textarea rows="4" data-vm-task-instructions placeholder="Example: Call the client, answer their basic questions, collect the missing project details, and leave me a short summary."></textarea></label>
    </div>
    <div class="vm-save-row"><button class="btn btn-primary" data-vm-queue-task type="button">Queue human work</button><span>Credits reserve when the task enters the queue. Queued does not mean completed.</span></div>
  </section>`;
}

function taskQueue(tasks) {
  const open = tasks.filter((task) => !["completed", "canceled"].includes(task.status));
  const recentDone = tasks.filter((task) => ["completed", "canceled"].includes(task.status)).slice(0, 5);
  const renderTask = (task) => `<article class="vm-op-task is-${esc(task.status)}">
    <div class="vm-op-task-top"><span>${esc(TASK_STATUS[task.status] || task.status)}</span><time>${esc(fmtTime(task.updatedAt))}</time></div>
    <h4>${esc(task.title)}</h4>
    <p>${esc(task.instructions)}</p>
    <div class="vm-op-task-meta">
      <span>${esc(task.estimatedCredits)} operator credit${task.estimatedCredits === 1 ? "" : "s"}</span>
      ${task.contactName ? `<span>${esc(task.contactName)}</span>` : ""}
      ${task.scheduledAt ? `<span>${esc(fmtTime(task.scheduledAt))}</span>` : ""}
    </div>
    ${!["completed", "canceled"].includes(task.status) ? `<button class="vm-task-x" data-vm-cancel-task="${esc(task.id)}" type="button" title="Cancel task" aria-label="Cancel ${esc(task.title)}">×</button>` : ""}
  </article>`;
  return `<section class="vm-card vm-operator-queue">
    <div class="vm-card-head"><span class="vm-kicker">Operator desk</span><h3>${open.length} human job${open.length === 1 ? "" : "s"} open</h3></div>
    <div class="vm-op-list">${open.length ? open.map(renderTask).join("") : `<div class="vm-empty">No human work is waiting.</div>`}</div>
    ${recentDone.length ? `<details class="vm-details"><summary>Recent closed work</summary><div class="vm-op-list">${recentDone.map(renderTask).join("")}</div></details>` : ""}
  </section>`;
}

function ownerExceptions(approvals) {
  return `<section class="vm-card vm-exceptions">
    <div class="vm-card-head"><span class="vm-kicker">Only when it truly needs you</span><h3>Owner exceptions</h3></div>
    ${approvals.length ? approvals.map((item) => `<article class="vm-approval vm-risk-${esc(item.riskLevel)}">
      <div class="vm-approval-top"><span>${esc(item.riskLevel)}</span><i>${esc(fmtTime(item.timestamp))}</i></div>
      <h4>${esc(item.title)}</h4><p>${esc(item.reason)}</p>
      <button class="btn btn-quiet" type="button" data-open-ws="approvals">Open decision</button>
    </article>`).join("") : `<div class="vm-empty"><b>Nobody needs you right now.</b><span>Routine exceptions go to the operator desk.</span></div>`}
  </section>`;
}

function activityFeed(activity) {
  return `<section class="vm-card vm-activity-card">
    <div class="vm-card-head"><span class="vm-kicker">Proof, not promises</span><h3>What happened while you were away</h3></div>
    <div class="vm-feed">${activity.length ? activity.map((item) => `<article class="vm-feed-item vm-event-${esc(item.eventType)}">
      <span></span><div><b>${esc(item.actor)}</b><p>${esc(item.message)}</p></div><time>${esc(fmtTime(item.createdAt))}</time>
    </article>`).join("") : `<div class="vm-empty">No Vacation Mode activity yet.</div>`}</div>
  </section>`;
}

function setupDetails(status) {
  const p = status.permissions || {};
  const ooo = status.outOfOffice || {};
  return `<section class="vm-card vm-setup-card">
    <details class="vm-details">
      <summary>Digital coverage and connections</summary>
      <div class="vm-toggle-grid">
        ${[
          ["watchInbox", "Watch inbox", "When an email connector is available"],
          ["autoReplyToNewMessages", "Cover new messages", "Use the operator or connected reply policy"],
          ["followUpWithLeads", "Follow up with leads", "Keep opportunities moving"],
          ["scheduleSocialPosts", "Keep content moving", "Follow each social connector policy"],
        ].map(([key, label, detail]) => `<label class="vm-toggle"><span><b>${label}</b><i>${detail}</i></span><input type="checkbox" data-vm-permission="${key}" ${boolAttr(p[key] !== false)} /></label>`).join("")}
      </div>
      <div class="vm-ooo-grid">
        <label class="vm-toggle vm-toggle-small"><span><b>Out-of-office coverage</b><i>${ooo.providerStatus === "ready" ? "Connector ready" : "Queues for operator until email is connected"}</i></span><input type="checkbox" data-vm-ooo-enabled ${boolAttr(!!ooo.enabled)} /></label>
        <label class="vm-field"><span>Message behavior</span><select data-vm-ooo-behavior>
          <option value="queue_for_operator" ${ooo.behavior !== "draft_only" ? "selected" : ""}>Queue for operator</option>
          <option value="draft_only" ${ooo.behavior === "draft_only" ? "selected" : ""}>Draft only</option>
          <option value="send_automatically" ${ooo.providerStatus === "ready" ? "" : "disabled"}>Send automatically when connector policy allows</option>
        </select></label>
        <label class="vm-field vm-wide"><span>Reply message</span><textarea rows="4" data-vm-ooo-template>${esc(ooo.template || "")}</textarea></label>
      </div>
    </details>
    <details class="vm-details">
      <summary>Readiness checklist</summary>
      <div class="vm-readiness">${(status.readiness || []).map((item) => `<article class="vm-ready vm-ready-${esc(item.status)}"><span></span><div><b>${esc(item.label)}</b><i>${esc(item.detail)}</i></div><em>${esc(READINESS_COPY[item.status] || item.status)}</em></article>`).join("")}</div>
    </details>
    <div class="vm-save-row"><button class="btn btn-primary" data-vm-save type="button">Save digital coverage</button></div>
  </section>`;
}

function renderShell(el) {
  if (state.loading) {
    el.innerHTML = `<div class="vm-loading">Loading hands-off coverage…</div>`;
    return;
  }
  if (state.error) {
    el.innerHTML = `<div class="vm-error"><b>Vacation Mode could not load.</b><span>${esc(state.error)}</span><button class="btn" data-vm-retry type="button">Retry</button></div>`;
    return;
  }
  const status = state.status;
  el.innerHTML = `<div class="vm vm-v2">
    ${statusHero(status)}
    ${metrics(status)}
    <div class="vm-grid vm-grid-power">
      ${coveragePlan(status)}
      ${operatorWallet(status)}
      ${newOperatorTask(status)}
      ${taskQueue(state.tasks)}
      ${ownerExceptions(state.approvals)}
      ${activityFeed(state.activity)}
      ${setupDetails(status)}
    </div>
  </div>`;
}

async function refresh(el) {
  try {
    state = { ...state, loading: true, error: "" };
    renderShell(el);
    await loadVacationData();
  } catch (error) {
    state = { ...state, loading: false, error: error.message || "Unknown error" };
  }
  renderShell(el);
}

async function postAndRefresh(el, path, body, method = "POST") {
  await api(path, { method, body: JSON.stringify(body || {}) });
  await refresh(el);
}

export function renderVacationMode(el, opts = {}) {
  const notify = opts.notify || (() => {});
  renderShell(el);
  if (state.loading || (!state.status && !state.error)) refresh(el);
  if (el.dataset.vmBound === "true") return;
  el.dataset.vmBound = "true";

  el.addEventListener("click", async (event) => {
    const target = event.target.closest("button");
    if (!target) return;
    try {
      if (target.matches("[data-vm-retry]")) return void await refresh(el);
      if (target.matches("[data-vm-activate]")) {
        await postAndRefresh(el, "/api/vacation-mode/activate", coveragePayload(el));
        notify("Vacation Mode", "Hands-off coverage is active. Phantom and the operator desk are on duty.");
        return;
      }
      if (target.matches("[data-vm-deactivate], [data-vm-kill]")) {
        await postAndRefresh(el, "/api/vacation-mode/deactivate", {});
        notify("Vacation Mode", "New away-coverage work stopped.");
        return;
      }
      if (target.matches("[data-vm-save]")) {
        await postAndRefresh(el, "/api/vacation-mode/settings", coveragePayload(el), "PATCH");
        notify("Vacation Mode", "Coverage plan saved.");
        return;
      }
      if (target.matches("[data-vm-queue-task]")) {
        const type = el.querySelector("[data-vm-task-type]")?.value || "other";
        const instructions = el.querySelector("[data-vm-task-instructions]")?.value.trim() || "";
        if (!instructions) throw new Error("Tell the operator what needs to happen.");
        const label = TASK_LABELS[type] || "Operator task";
        await postAndRefresh(el, "/api/vacation-mode/operator-tasks", {
          type,
          title: label,
          instructions,
          contactName: el.querySelector("[data-vm-task-contact]")?.value || "",
          scheduledAt: el.querySelector("[data-vm-task-time]")?.value || "",
          source: "owner",
        });
        notify("Operator Desk", "Human work queued. Operator Credits were reserved; AI credits were not used.");
        return;
      }
      const cancelId = target.dataset.vmCancelTask;
      if (cancelId) {
        await postAndRefresh(el, `/api/vacation-mode/operator-tasks/${encodeURIComponent(cancelId)}/cancel`, {});
        notify("Operator Desk", "Task canceled and reserved credits released.");
      }
    } catch (error) {
      notify("Vacation Mode", error.message || "Vacation Mode action failed.");
      state = { ...state, error: error.message || "Vacation Mode action failed.", loading: false };
      renderShell(el);
    }
  });
}
