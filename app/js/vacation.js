import { session as accessSession, ago } from "./store.js?v=phantom-live-20260714-264";

const esc = (value = "") => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const cacheKey = "pf.vacation.statusCache.v2";
const taskLabels = { phone_call: "Take a call", attend_meeting: "Attend a meeting", lead_follow_up: "Follow up with a lead", booking_coordination: "Handle a booking", client_message: "Handle a client message", research: "Research something", exception_triage: "Handle an exception", other: "Other human work" };

let state = { loading: true, error: "", authRequired: false, status: null, activity: [], approvals: [], tasks: [] };

function authHeaders(extra = {}) {
  const token = typeof accessSession?.token === "function" ? accessSession.token() : "";
  return { ...extra, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: authHeaders({ ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    const error = new Error(data.error || data.message || `Away Mode request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function cacheStatus(status) {
  try { localStorage.setItem(cacheKey, JSON.stringify({ enabled: !!status?.enabled, at: Date.now() })); } catch {}
}

export function cachedVacationStatus() {
  try {
    const raw = JSON.parse(localStorage.getItem(cacheKey) || "null");
    return raw && typeof raw.enabled === "boolean" ? raw : null;
  } catch { return null; }
}

async function load() {
  const [status, activity, approvals, tasks] = await Promise.all([
    api("/api/vacation-mode/status"),
    api("/api/vacation-mode/activity?limit=50"),
    api("/api/vacation-mode/approvals?limit=30"),
    api("/api/vacation-mode/operator-tasks?limit=50"),
  ]);
  state = { loading: false, error: "", status, activity: activity.activity || [], approvals: approvals.approvals || [], tasks: tasks.tasks || [] };
  cacheStatus(status);
}

function dateValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function fmt(value) {
  if (!value) return "Not yet";
  try { return new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch { return String(value); }
}

function checkbox(key, label, detail, checked) {
  return `<label class="vm-cover-toggle"><input type="checkbox" data-cover="${esc(key)}" ${checked ? "checked" : ""}><span><b>${esc(label)}</b><i>${esc(detail)}</i></span></label>`;
}

function sinceLine(status) {
  if (status.enabled) return `Away since ${fmt(status.startedAt)}`;
  if (status.startedAt && status.endedAt) return `Last away period ended ${fmt(status.endedAt)}`;
  return "Never been used yet";
}

function statusHero(status) {
  const enabled = !!status.enabled;
  const plannedEnd = status.operatorCoverage?.awayEnd;
  return `<section class="vm-command ${enabled ? "is-active" : ""}">
    <div class="vm-command-copy">
      <span class="vm-kicker">Away Mode</span>
      <h2>${enabled ? "ON — Phantom is covering." : "OFF — nothing runs without you."}</h2>
      <p class="vm-since">${esc(sinceLine(status))}${enabled && plannedEnd ? ` · turns itself off ${fmt(plannedEnd)}` : ""}</p>
      <ul class="vm-behaviors">
        <li><b>Scheduled check-ins.</b> Phantom reviews the business on a timer and logs every check.${enabled ? ` Next check ${fmt(status.nextCheckInAt)}${status.lastCheckInAt ? `, last ${fmt(status.lastCheckInAt)}` : ""}.` : ""}</li>
        <li><b>Exceptions only.</b> While away, only urgent and high-risk approvals reach you. Routine approvals wait for your return.</li>
        <li><b>Human work by request.</b> Jobs you queue go to the operator desk and spend Operator Credits — never AI credits.</li>
        <li><b>Nothing sent externally on its own.</b> Every outbound action still requires your approval, away or not.</li>
        ${plannedEnd ? `<li><b>Automatic end.</b> Away Mode switches itself off at your planned return time (${fmt(plannedEnd)}).</li>` : ""}
      </ul>
    </div>
    <div class="vm-command-state">
      <span class="vm-state-pill ${enabled ? "on" : "off"}">${enabled ? "ON" : "OFF"}</span>
      <strong>${enabled ? "Phantom is on duty" : "Away Mode is off"}</strong>
      <small>${enabled ? `Away since ${fmt(status.startedAt)}` : "Coverage starts the moment you turn it on"}</small>
      <button class="btn ${enabled ? "vm-danger" : "btn-primary"}" type="button" data-vm-toggle>${enabled ? "Turn off Away Mode" : "Turn on Away Mode"}</button>
    </div>
  </section>`;
}

const isToggleEvent = (event) => event.relatedEntity === "Away Mode" || event.relatedEntity === "Instant stop";

function digestWindow(status) {
  const start = status.startedAt ? Date.parse(status.startedAt) : NaN;
  if (!Number.isFinite(start)) return null;
  if (status.enabled) return { start, end: Date.now(), live: true };
  const end = status.endedAt ? Date.parse(status.endedAt) : NaN;
  return Number.isFinite(end) ? { start, end, live: false } : null;
}

function digestCard(status, activity, approvals) {
  const win = digestWindow(status);
  const head = (title, sub) => `<div class="vm-card-head"><div><span class="vm-kicker">${win?.live ? "While you're away" : "While you were away"}</span><h3>${esc(title)}</h3></div><span>${esc(sub)}</span></div>`;
  if (!win) {
    return `<section class="vm-card vm-wide">${head("No away period yet", "")}<div class="vm-empty"><b>Nothing to report.</b><span>Turn on Away Mode and this digest will summarize what Phantom handled while you were gone.</span></div></section>`;
  }
  const inWindow = activity.filter((event) => {
    const t = Date.parse(event.createdAt);
    return Number.isFinite(t) && t >= win.start && t <= win.end + 60_000;
  });
  const checkIns = inWindow.filter((e) => e.eventType === "observed").length;
  const notable = inWindow.filter((e) => e.eventType !== "observed" && !isToggleEvent(e));
  const drafted = notable.filter((e) => e.eventType === "drafted").length;
  const completed = notable.filter((e) => e.eventType === "completed").length;
  const queued = notable.filter((e) => e.eventType === "queued_approval").length;
  const flagged = notable.filter((e) => e.eventType === "blocked" || e.eventType === "needs_setup").length;
  const waiting = approvals.length;
  const range = `${fmt(status.startedAt)} – ${win.live ? "now" : fmt(status.endedAt)}`;
  const stats = `<div class="vm-digest-stats">
    <span><b>${checkIns}</b> check-in${checkIns === 1 ? "" : "s"}</span>
    <span><b>${drafted}</b> drafted</span>
    <span><b>${completed}</b> completed</span>
    <span><b>${queued}</b> queued for humans</span>
    <span><b>${flagged}</b> flagged</span>
    <span class="${waiting ? "is-waiting" : ""}"><b>${waiting}</b> waiting on you</span>
  </div>`;
  const quiet = !notable.length && !waiting;
  const body = quiet
    ? `<div class="vm-empty"><b>All quiet.</b><span>${checkIns ? `Phantom checked in ${checkIns} time${checkIns === 1 ? "" : "s"} and nothing needed you.` : "No coverage checks have run in this window yet."}</span></div>`
    : `<div class="vm-feed">${notable.slice(0, 6).map((event) => `<article class="vm-feed-item vm-event-${esc(event.eventType)}"><span></span><div><b>${esc(event.message)}</b><p>${esc(event.actor)} · ${esc(event.relatedEntity || event.eventType.replaceAll("_", " "))}</p></div><time>${ago(event.createdAt)}</time></article>`).join("") || `<div class="vm-empty-inline">Nothing notable yet — ${waiting} approval${waiting === 1 ? "" : "s"} below need${waiting === 1 ? "s" : ""} you.</div>`}</div>`;
  return `<section class="vm-card vm-wide">${head(quiet ? "Nothing needed you" : "Here is what happened", range)}${stats}${body}</section>`;
}

function coveragePlan(status) {
  const c = status.operatorCoverage || {};
  return `<section class="vm-card vm-plan-card">
    <div class="vm-card-head"><div><span class="vm-kicker">Coverage plan</span><h3>Tell the operator what “handled” means.</h3></div><span class="vm-state-pill ${status.enabled ? "on" : "off"}">${status.enabled ? "LIVE" : "SAVED"}</span></div>
    <div class="vm-plan-grid">
      <label class="vm-field"><span>Leaving</span><input type="datetime-local" data-cover-field="awayStart" value="${esc(dateValue(c.awayStart))}"></label>
      <label class="vm-field"><span>Back</span><input type="datetime-local" data-cover-field="awayEnd" value="${esc(dateValue(c.awayEnd))}"></label>
      <label class="vm-field"><span>Interrupt me</span><select data-cover-field="ownerInterruptionPolicy"><option value="emergencies_only" ${c.ownerInterruptionPolicy !== "daily_digest" ? "selected" : ""}>Emergencies only</option><option value="daily_digest" ${c.ownerInterruptionPolicy === "daily_digest" ? "selected" : ""}>Daily summary too</option></select></label>
      <label class="vm-field"><span>Daily human-credit limit</span><input type="number" min="0" max="100" data-cover-field="dailyCreditLimit" value="${Number(c.dailyCreditLimit || 0)}"></label>
    </div>
    <div class="vm-coverage-toggles">
      ${checkbox("allowCalls", "Take calls", "A human operator can return or cover calls.", c.allowCalls)}
      ${checkbox("allowMeetings", "Attend meetings", "A human operator can join and record next steps.", c.allowMeetings)}
      ${checkbox("allowLeadFollowUps", "Follow up with leads", "Keep opportunities warm while you are away.", c.allowLeadFollowUps)}
      ${checkbox("allowBookingCoordination", "Handle bookings", "Coordinate times and flag schedule conflicts.", c.allowBookingCoordination)}
      ${checkbox("allowClientMessages", "Handle client messages", "Answer routine questions using your instructions.", c.allowClientMessages)}
    </div>
    <label class="vm-field vm-wide"><span>Standing instructions</span><textarea rows="4" data-cover-field="handoffNotes">${esc(c.handoffNotes || "")}</textarea></label>
    <div class="vm-save-row"><button class="btn" type="button" data-vm-save>Save coverage plan</button><span>Safe digital work is automatic. Human work spends only Operator Credits.</span></div>
  </section>`;
}

function walletCard(status) {
  const wallet = status.operatorWallet || {};
  const costs = wallet.costs || {};
  return `<section class="vm-card vm-wallet-card">
    <div class="vm-card-head"><div><span class="vm-kicker">Human work wallet</span><h3>Operator Credits</h3></div><span class="vm-state-pill ${wallet.available > 0 ? "on" : "off"}">${wallet.available || 0} AVAILABLE</span></div>
    <p>These pay for real human work. They never come out of your AI credits.</p>
    <div class="vm-wallet-numbers"><span><b>${wallet.included || 0}</b>included</span><span><b>${wallet.reserved || 0}</b>reserved</span><span><b>${wallet.used || 0}</b>used</span></div>
    <div class="vm-cost-list"><span>Call <b>${costs.phone_call || 2}</b></span><span>Meeting <b>${costs.attend_meeting || 4}</b></span><span>Follow-up <b>${costs.lead_follow_up || 1}</b></span><span>Booking <b>${costs.booking_coordination || 1}</b></span></div>
    <div class="vm-staffing ${status.humanStaffingReady ? "is-ready" : ""}"><i></i><span><b>${status.humanStaffingReady ? "Operator desk connected" : "Operator desk needs staffing"}</b>${status.humanStaffingReady ? "Human requests can be assigned." : "Requests save safely, but nobody will claim a call or meeting until staffing is connected."}</span></div>
  </section>`;
}

function taskForm() {
  return `<section class="vm-card vm-operator-form">
    <div class="vm-card-head"><div><span class="vm-kicker">Real human help</span><h3>Give the operator desk a job.</h3></div></div>
    <label class="vm-field"><span>Type of work</span><select data-op-field="type">${Object.entries(taskLabels).map(([value, label]) => `<option value="${value}">${esc(label)}</option>`).join("")}</select></label>
    <label class="vm-field"><span>What needs to happen?</span><input data-op-field="title" placeholder="Call the new lead and book a consultation"></label>
    <label class="vm-field"><span>Details the operator needs</span><textarea rows="4" data-op-field="instructions" placeholder="Who, why, preferred outcome, boundaries, and anything they should not promise"></textarea></label>
    <label class="vm-field"><span>When?</span><input type="datetime-local" data-op-field="scheduledFor"></label>
    <button class="btn btn-primary" type="button" data-op-create>Queue human help</button>
  </section>`;
}

function tasksCard(tasks) {
  const visible = tasks.filter((task) => task.status !== "canceled").slice(0, 20);
  return `<section class="vm-card vm-wide"><div class="vm-card-head"><div><span class="vm-kicker">Operator desk</span><h3>Human work queue</h3></div><span>${visible.length} jobs</span></div>
    <div class="vm-op-list">${visible.length ? visible.map((task) => `<article class="vm-op-task">
      <div class="vm-op-task-top"><span class="vm-state-pill ${task.status === "completed" ? "on" : task.status === "blocked" ? "off" : ""}">${esc(task.status.replaceAll("_", " "))}</span><button class="vm-task-x" type="button" data-op-cancel="${esc(task.id)}" title="Cancel request" aria-label="Cancel request">×</button></div>
      <h4>${esc(task.title)}</h4><p>${esc(task.instructions || "No extra instructions.")}</p>
      <div class="vm-op-task-meta"><span>${esc(taskLabels[task.type] || "Human work")}</span><span>${task.creditCost} credits</span><span>${task.scheduledFor ? fmt(task.scheduledFor) : "As soon as possible"}</span></div>
    </article>`).join("") : `<div class="vm-empty">No human work queued. Your operator desk starts clean.</div>`}</div>
  </section>`;
}

function exceptionsCard(approvals) {
  return `<section class="vm-card"><div class="vm-card-head"><div><span class="vm-kicker">Owner exceptions</span><h3>Needs you, not the operator</h3></div><span>${approvals.length}</span></div>
    <div class="vm-approvals">${approvals.length ? approvals.map((item) => `<article class="vm-approval vm-risk-${esc(item.riskLevel)}"><div class="vm-approval-top"><span>${esc(item.riskLevel)}</span><i>${fmt(item.timestamp)}</i></div><h4>${esc(item.title)}</h4><p>${esc(item.reason)}</p><div class="vm-approval-actions"><button class="btn btn-quiet" data-approval="${esc(item.id)}" data-decision="reject">Reject</button><button class="btn" data-approval="${esc(item.id)}" data-decision="snooze">Snooze</button><button class="btn btn-primary" data-approval="${esc(item.id)}" data-decision="approve">Approve</button></div></article>`).join("") : `<div class="vm-empty"><b>No emergency needs you.</b><span>That is the point. Routine work stays with Phantom and the operator desk.</span></div>`}</div>
  </section>`;
}

function activityCard(events) {
  return `<section class="vm-card"><div class="vm-card-head"><div><span class="vm-kicker">Proof</span><h3>Full activity log</h3></div><span>${events.length} receipts</span></div><div class="vm-feed">${events.slice(0, 25).map((event) => `<article class="vm-feed-item vm-event-${esc(event.eventType)}"><span></span><div><b>${esc(event.message)}</b><p>${esc(event.actor)} · ${esc(event.relatedEntity || event.eventType.replaceAll("_", " "))}</p></div><time>${ago(event.createdAt)}</time></article>`).join("") || `<div class="vm-empty">No activity yet.</div>`}</div></section>`;
}

function readinessCard(items) {
  return `<details class="vm-card vm-wide vm-details"><summary><span><b>Connections and digital coverage</b><i>See what is ready and what still needs setup</i></span><em>${items.filter((item) => item.status === "ready").length}/${items.length} ready</em></summary><div class="vm-readiness">${items.map((item) => `<article class="vm-ready vm-ready-${esc(item.status)}"><span></span><div><b>${esc(item.label)}</b><i>${esc(item.detail)}</i></div><em>${esc(item.status.replaceAll("_", " "))}</em></article>`).join("")}</div></details>`;
}

function render(el) {
  if (state.loading) { el.innerHTML = `<div class="vm-loading">Loading Away Mode…</div>`; return; }
  if (state.authRequired) {
    el.innerHTML = `<div class="vm-error"><b>Away Mode needs a signed-in session.</b><span>This workspace is browsing without a server sign-in, so live coverage status is not available. Sign in from the access gate with your owner account, then come back here.</span><button class="btn" data-retry>Retry</button></div>`;
    return;
  }
  if (state.error) { el.innerHTML = `<div class="vm-error"><b>Away Mode could not load.</b><span>${esc(state.error)}</span><button class="btn" data-retry>Retry</button></div>`; return; }
  const s = state.status;
  el.innerHTML = `<div class="vm">${statusHero(s)}${digestCard(s, state.activity, state.approvals)}<div class="vm-grid vm-grid-power">${coveragePlan(s)}${walletCard(s)}${taskForm()}${tasksCard(state.tasks)}${exceptionsCard(state.approvals)}${activityCard(state.activity)}${readinessCard(s.readiness || [])}</div></div>`;
}

async function refresh(el) {
  state = { ...state, loading: true, error: "", authRequired: false };
  render(el);
  try { await load(); } catch (error) {
    const authRequired = error?.status === 401;
    state = { ...state, loading: false, authRequired, error: authRequired ? "" : error.message || "Away Mode could not load." };
  }
  render(el);
}

function payload(el) {
  const value = (name) => el.querySelector(`[data-cover-field="${name}"]`)?.value || null;
  const checked = (name) => !!el.querySelector(`[data-cover="${name}"]`)?.checked;
  return { mode: "hands_off", operatorCoverage: { awayStart: value("awayStart"), awayEnd: value("awayEnd"), ownerInterruptionPolicy: value("ownerInterruptionPolicy"), dailyCreditLimit: Number(value("dailyCreditLimit") || 0), handoffNotes: value("handoffNotes") || "", allowCalls: checked("allowCalls"), allowMeetings: checked("allowMeetings"), allowLeadFollowUps: checked("allowLeadFollowUps"), allowBookingCoordination: checked("allowBookingCoordination"), allowClientMessages: checked("allowClientMessages") } };
}

async function mutate(el, path, method = "POST", body = {}) {
  await api(path, { method, body: JSON.stringify(body) });
  await refresh(el);
}

export function renderVacationMode(el, opts = {}) {
  const notify = opts.notify || (() => {});
  render(el);
  if (!state.status && !state.error) void refresh(el);
  if (el.dataset.vmBound === "true") return;
  el.dataset.vmBound = "true";
  el.addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    try {
      if (button.matches("[data-retry]")) return void await refresh(el);
      if (button.matches("[data-vm-toggle]")) {
        await mutate(el, state.status?.enabled ? "/api/vacation-mode/deactivate" : "/api/vacation-mode/activate", "POST", payload(el));
        notify("Away Mode", state.status?.enabled ? "Away Mode is on. Phantom is covering." : "Away Mode is off.");
        return;
      }
      if (button.matches("[data-vm-save]")) { await mutate(el, "/api/vacation-mode/settings", "PATCH", payload(el)); notify("Away Mode", "Coverage plan saved."); return; }
      if (button.matches("[data-op-create]")) {
        const get = (name) => el.querySelector(`[data-op-field="${name}"]`)?.value || "";
        await mutate(el, "/api/vacation-mode/operator-tasks", "POST", { type: get("type"), title: get("title"), instructions: get("instructions"), scheduledFor: get("scheduledFor") || null });
        notify("Operator desk", "Human-work request saved."); return;
      }
      if (button.dataset.opCancel) { await mutate(el, `/api/vacation-mode/operator-tasks/${encodeURIComponent(button.dataset.opCancel)}/cancel`); notify("Operator desk", "Request canceled and reserved credits released."); return; }
      if (button.dataset.approval) { await mutate(el, `/api/vacation-mode/approvals/${encodeURIComponent(button.dataset.approval)}/decision`, "POST", { decision: button.dataset.decision }); notify("Away Mode", "Decision recorded."); }
    } catch (error) {
      if (error?.status === 401) {
        notify("Away Mode", "Sign in with your owner account to use Away Mode.");
        state = { ...state, loading: false, authRequired: true, error: "" };
      } else {
        notify("Away Mode", error.message || "Action failed.");
        state = { ...state, loading: false, error: error.message || "Action failed." };
      }
      render(el);
    }
  });
}
