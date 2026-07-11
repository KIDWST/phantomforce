/* PhantomForce — Vacation Mode.
   Backend-backed admin surface for bounded, temporary away-coverage while an
   owner is away — a separate system from Automation (app/js/brandops.js).
   Vacation Mode may invoke existing automations as part of its coverage
   plan, but it never starts, stops, or owns them: turning Vacation Mode on
   or off only changes away-coverage, never whether normal automations run.
   This page does not send email, post, spend credits, or execute providers;
   it stores settings, records proof, and queues review decisions. */

import { session as accessSession, ago, store, visible } from "./store.js?v=phantom-live-20260710-146";

const esc = (value = "") => String(value)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

const PERMISSION_GROUPS = [
  ["watchInbox", "Watch inbox", "Needs email connector"],
  ["draftEmailReplies", "Draft email replies", "Safe draft work"],
  ["sendEmailOnlyAfterApproval", "Send email only after approval", "Outbound stays gated"],
  ["autoReplyToNewMessages", "Auto-reply to new messages", "Disabled until email is connected"],
  ["followUpWithLeads", "Follow up with leads", "Queue replies for review"],
  ["updateCrmTasks", "Update CRM/tasks", "Safe internal updates"],
  ["scheduleSocialPosts", "Schedule social posts", "No public posts without approval"],
  ["generateContentDrafts", "Generate content drafts", "Draft images, captions, and briefs"],
  ["monitorUrgentItems", "Monitor urgent items", "Flag risk fast"],
  ["notifyImportantChanges", "Notify me about important changes", "In-app now"],
  ["allowLowRiskAutomations", "Allow low-risk automations", "Internal safe steps only"],
  ["requireApprovalForAllOutbound", "Require approval for all outbound actions", "Recommended"],
];

const NOTIFICATION_GROUPS = [
  ["inApp", "In-app notifications"],
  ["emailSummary", "Email summary"],
  ["urgentOnly", "Urgent-only notifications"],
  ["dailyDigest", "Daily digest"],
  ["realTimeActivityFeed", "Real-time activity feed"],
];

const MODE_COPY = {
  off: "Off",
  draft_only: "Draft-only",
  approval_required: "Approval-required",
  limited_autopilot: "Limited autopilot",
};

const READINESS_COPY = {
  ready: "Ready",
  needs_setup: "Needs setup",
  not_connected: "Not connected",
  in_app_only: "In-app only",
  blocked_by_policy: "Blocked",
};

const RISK_COPY = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

let state = {
  loading: true,
  error: "",
  status: null,
  activity: [],
  approvals: [],
};

function authHeaders(extra = {}) {
  const token = typeof accessSession?.token === "function" ? accessSession.token() : "";
  return {
    ...extra,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
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
    throw new Error(data.error || data.message || `Vacation Mode API failed (${response.status})`);
  }
  return data;
}

const STATUS_CACHE_KEY = "pf.vacation.statusCache.v1";
function cacheStatusForNav(status) {
  try { localStorage.setItem(STATUS_CACHE_KEY, JSON.stringify({ enabled: !!status?.enabled, at: Date.now() })); } catch {}
}
/* Nav-badge helper for main.js — reads the last successfully fetched status
   so the sidebar can show ON/OFF without re-fetching on every render or
   fabricating a state that was never actually confirmed. */
export function cachedVacationStatus() {
  try {
    const raw = JSON.parse(localStorage.getItem(STATUS_CACHE_KEY) || "null");
    if (raw && typeof raw.enabled === "boolean") return raw;
  } catch {}
  return null;
}

async function loadVacationData() {
  const [status, activity, approvals] = await Promise.all([
    api("/api/vacation-mode/status"),
    api("/api/vacation-mode/activity?limit=40"),
    api("/api/vacation-mode/approvals?limit=30"),
  ]);
  state = {
    loading: false,
    error: "",
    status,
    activity: activity.activity || [],
    approvals: approvals.approvals || [],
  };
  cacheStatusForNav(status);
}

function fmtTime(value) {
  if (!value) return "None yet";
  try { return new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
  catch { return String(value); }
}

function boolAttr(value) {
  return value ? "checked" : "";
}

function readinessTone(status) {
  if (status === "ready") return "ready";
  if (status === "in_app_only") return "info";
  if (status === "not_connected") return "off";
  if (status === "blocked_by_policy") return "block";
  return "setup";
}

function renderToggle(key, label, detail, checked) {
  return `<label class="vm-toggle">
    <span><b>${esc(label)}</b><i>${esc(detail || "")}</i></span>
    <input type="checkbox" data-vm-permission="${esc(key)}" ${boolAttr(checked)} />
  </label>`;
}

function renderNotificationToggle(key, label, checked) {
  return `<label class="vm-toggle vm-toggle-small">
    <span><b>${esc(label)}</b></span>
    <input type="checkbox" data-vm-notification="${esc(key)}" ${boolAttr(checked)} ${key === "inApp" ? "disabled" : ""} />
  </label>`;
}

function permissionPayload(root) {
  const permissions = {};
  root.querySelectorAll("[data-vm-permission]").forEach((input) => {
    permissions[input.dataset.vmPermission] = input.checked;
  });
  const notificationPreferences = {};
  root.querySelectorAll("[data-vm-notification]").forEach((input) => {
    notificationPreferences[input.dataset.vmNotification] = input.checked;
  });
  const outOfOffice = {
    enabled: !!root.querySelector("[data-vm-ooo-enabled]")?.checked,
    template: root.querySelector("[data-vm-ooo-template]")?.value || "",
    startDate: root.querySelector("[data-vm-ooo-start]")?.value || "",
    endDate: root.querySelector("[data-vm-ooo-end]")?.value || "",
    behavior: root.querySelector("[data-vm-ooo-behavior]")?.value || "draft_only",
  };
  return { permissions, notificationPreferences, outOfOffice };
}

function statusCard(status) {
  const active = !!status.enabled;
  return `<section class="vm-card vm-status-card ${active ? "is-active" : ""}">
    <div class="vm-status-main">
      <span class="vm-kicker">Vacation Mode</span>
      <h3>${active ? "Your phantom workforce is watching." : "Vacation Mode is off."}</h3>
      <p>${active
        ? "Approved internal work can keep moving. Anything outbound, risky, expensive, or destructive still waits for review."
        : "Turn it on when you want PhantomForce to watch, draft, organize, and queue work while you are away."}</p>
    </div>
    <div class="vm-status-side">
      <span class="vm-state-pill ${active ? "on" : "off"}">${active ? "ON" : "OFF"}</span>
      <div class="vm-mode-select">
        <span>Mode</span>
        <select data-vm-mode ${active ? "disabled" : ""}>
          ${["draft_only", "approval_required", "limited_autopilot"].map((mode) => `<option value="${mode}" ${status.mode === mode ? "selected" : ""}>${MODE_COPY[mode]}</option>`).join("")}
        </select>
      </div>
      <div class="vm-mini-facts">
        <span><b>Started</b><i>${esc(fmtTime(status.startedAt))}</i></span>
        <span><b>Last activity</b><i>${esc(fmtTime(status.lastActivityAt))}</i></span>
      </div>
      <div class="vm-status-actions">
        ${active
          ? `<button class="btn btn-primary vm-danger" data-vm-deactivate type="button">Turn off Vacation Mode</button>
             <button class="btn btn-quiet" data-vm-kill type="button">Stop away-coverage immediately</button>`
          : `<button class="btn btn-primary" data-vm-activate type="button">Turn on Vacation Mode</button>`}
      </div>
    </div>
  </section>`;
}

function metricsCards(metrics = {}) {
  const items = [
    ["Items observed", metrics.itemsObserved ?? 0],
    ["Drafts created", metrics.draftsCreated ?? 0],
    ["Approvals pending", metrics.approvalsPending ?? 0],
    ["Automations completed", metrics.automationsCompleted ?? 0],
    ["Blocked actions", metrics.blockedActions ?? 0],
    ["Last check-in", metrics.lastCheckIn ? ago(metrics.lastCheckIn) : "None"],
  ];
  return `<section class="vm-metrics">${items.map(([label, value]) => `<article class="vm-metric"><b>${esc(value)}</b><span>${esc(label)}</span></article>`).join("")}</section>`;
}

function permissionsCard(status) {
  const p = status.permissions || {};
  return `<section class="vm-card">
    <div class="vm-card-head">
      <span class="vm-kicker">Allowed while I’m away</span>
      <h3>Permissions</h3>
    </div>
    <div class="vm-toggle-grid">
      ${PERMISSION_GROUPS.map(([key, label, detail]) => renderToggle(key, label, detail, !!p[key])).join("")}
    </div>
    <div class="vm-save-row">
      <button class="btn btn-primary" data-vm-save type="button">Save permissions</button>
      <span>No sends, posts, uploads, invoices, paid calls, or destructive actions happen from this page.</span>
    </div>
  </section>`;
}

function readinessCard(status) {
  return `<section class="vm-card">
    <div class="vm-card-head">
      <span class="vm-kicker">Readiness checklist</span>
      <h3>What is ready</h3>
    </div>
    <div class="vm-readiness">
      ${(status.readiness || []).map((item) => `<article class="vm-ready vm-ready-${readinessTone(item.status)}">
        <span></span>
        <div><b>${esc(item.label)}</b><i>${esc(item.detail)}</i></div>
        <em>${esc(READINESS_COPY[item.status] || item.status)}</em>
      </article>`).join("")}
    </div>
  </section>`;
}

function approvalsCard(approvals) {
  return `<section class="vm-card">
    <div class="vm-card-head">
      <span class="vm-kicker">Needs your attention</span>
      <h3>Urgent approvals</h3>
    </div>
    <div class="vm-approvals">
      ${approvals.length ? approvals.map((item) => `<article class="vm-approval vm-risk-${esc(item.riskLevel)}">
        <div class="vm-approval-top">
          <span>${esc(RISK_COPY[item.riskLevel] || item.riskLevel)}</span>
          <i>${esc(fmtTime(item.timestamp))}</i>
        </div>
        <h4>${esc(item.title)}</h4>
        <p><b>Source:</b> ${esc(item.source)}</p>
        <p><b>Suggested action:</b> ${esc(item.suggestedAction)}</p>
        <p><b>Why flagged:</b> ${esc(item.reason)}</p>
        <div class="vm-approval-actions">
          <button class="btn btn-primary" data-vm-approval="${esc(item.id)}" data-vm-decision="approve" type="button">Approve</button>
          <button class="btn btn-quiet" data-vm-approval="${esc(item.id)}" data-vm-decision="reject" type="button">Reject</button>
          <button class="btn btn-quiet" data-vm-approval="${esc(item.id)}" data-vm-decision="snooze" type="button">Snooze</button>
          <button class="btn btn-quiet" data-open-ws="approvals" type="button">Edit</button>
        </div>
      </article>`).join("") : `<div class="vm-empty">Nothing urgent right now.</div>`}
    </div>
  </section>`;
}

function activityCard(activity) {
  return `<section class="vm-card">
    <div class="vm-card-head">
      <span class="vm-kicker">What your phantom workforce has been doing</span>
      <h3>Activity feed</h3>
    </div>
    <div class="vm-feed">
      ${activity.length ? activity.map((item) => `<article class="vm-feed-item vm-event-${esc(item.eventType)}">
        <span></span>
        <div><b>${esc(item.actor)} · ${esc(item.eventType.replace(/_/g, " "))}</b><p>${esc(item.message)}</p>${item.relatedEntity ? `<i>${esc(item.relatedEntity)}</i>` : ""}</div>
        <time>${esc(fmtTime(item.createdAt))}</time>
      </article>`).join("") : `<div class="vm-empty">No Vacation Mode activity yet.</div>`}
    </div>
  </section>`;
}

function outOfOfficeCard(status) {
  const ooo = status.outOfOffice || {};
  return `<section class="vm-card">
    <div class="vm-card-head">
      <span class="vm-kicker">Out-of-office auto reply</span>
      <h3>Email readiness</h3>
    </div>
    <div class="vm-ooo-grid">
      <label class="vm-toggle vm-toggle-small">
        <span><b>Enable auto-reply preference</b><i>Stored only until email is connected.</i></span>
        <input type="checkbox" data-vm-ooo-enabled ${boolAttr(!!ooo.enabled)} />
      </label>
      <label class="vm-field"><span>Behavior</span>
        <select data-vm-ooo-behavior>
          <option value="draft_only" ${ooo.behavior === "draft_only" ? "selected" : ""}>Draft only</option>
          <option value="queue_for_approval" ${ooo.behavior === "queue_for_approval" ? "selected" : ""}>Queue for approval</option>
          <option value="send_automatically" disabled>Send automatically — needs connected provider + explicit permission</option>
        </select>
      </label>
      <label class="vm-field"><span>Start</span><input type="date" data-vm-ooo-start value="${esc(ooo.startDate || "")}" /></label>
      <label class="vm-field"><span>End</span><input type="date" data-vm-ooo-end value="${esc(ooo.endDate || "")}" /></label>
      <label class="vm-field vm-wide"><span>Reply template</span><textarea data-vm-ooo-template rows="5">${esc(ooo.template || "")}</textarea></label>
    </div>
    <div class="vm-provider-state">
      <b>Provider status</b>
      <span>${esc(READINESS_COPY[ooo.providerStatus] || "Not connected")}</span>
      <i>Phantom can draft replies and queue them, but automatic email changes are blocked until the connector is configured.</i>
    </div>
  </section>`;
}

function notificationsCard(status) {
  const prefs = status.notificationPreferences || {};
  return `<section class="vm-card">
    <div class="vm-card-head">
      <span class="vm-kicker">Notifications</span>
      <h3>How Phantom checks in</h3>
    </div>
    <div class="vm-toggle-grid vm-toggle-grid-compact">
      ${NOTIFICATION_GROUPS.map(([key, label]) => renderNotificationToggle(key, label, !!prefs[key])).join("")}
    </div>
    <div class="vm-save-row">
      <button class="btn btn-primary" data-vm-save type="button">Save notifications</button>
      <span>Email and push delivery are stored as preferences until the provider is connected.</span>
    </div>
  </section>`;
}

/* Vacation Mode may use existing automations for away-coverage, but it never
   owns them — this card only reads real automation records (store.state.agents)
   and their allowedDuringVacation flag; it never creates, starts, or stops one. */
function automationsCoverageCard() {
  const running = visible(store.state.agents || []).filter((a) => a.status === "active");
  const allowed = running.filter((a) => a.allowedDuringVacation !== false);
  return `<section class="vm-card vm-queue-card">
    <div class="vm-card-head">
      <span class="vm-kicker">Automations, not Vacation Mode</span>
      <h3>${allowed.length} automation${allowed.length === 1 ? "" : "s"} available for vacation coverage</h3>
    </div>
    <div class="vm-action-list">
      ${running.length ? running.map((a) => {
        const isAllowed = a.allowedDuringVacation !== false;
        return `<span class="vm-automation-flag ${isAllowed ? "is-allowed" : "is-blocked"}">${esc(a.name)} — ${isAllowed ? "allowed during Vacation Mode" : "blocked during Vacation Mode"}${a.requiresApprovalDuringVacation !== false ? " · requires approval" : ""}</span>`;
      }).join("") : `<span class="vm-empty-inline">No active automations yet — set one up on the Automation page.</span>`}
    </div>
    <p>Normal automations keep running whether Vacation Mode is on or off. Turning Vacation Mode off stops away-coverage only — it never pauses or deletes an automation.</p>
    <div class="vm-save-row"><button class="btn btn-quiet" type="button" data-open-ws="automation">Open Automation</button></div>
  </section>`;
}

function renderShell(el) {
  if (state.loading) {
    el.innerHTML = `<div class="vm-loading">Loading Vacation Mode…</div>`;
    return;
  }
  if (state.error) {
    el.innerHTML = `<div class="vm-error"><b>Vacation Mode could not load.</b><span>${esc(state.error)}</span><button class="btn" data-vm-retry type="button">Retry</button></div>`;
    return;
  }

  const status = state.status;
  el.innerHTML = `<div class="vm">
    <header class="vm-hero">
      <div>
        <span class="vm-kicker">Your phantom workforce</span>
        <h2>Let the business keep moving while you’re away.</h2>
        <p>Vacation Mode watches, drafts, updates safe internal work, and brings urgent decisions back to you. It does not send, post, spend, upload, invoice, or delete without approval.</p>
      </div>
      <div class="vm-hero-mark"><span></span><b>${status.enabled ? "ACTIVE" : "READY"}</b></div>
    </header>
    ${statusCard(status)}
    ${metricsCards(status.metrics)}
    <div class="vm-grid">
      ${permissionsCard(status)}
      ${readinessCard(status)}
      ${approvalsCard(state.approvals)}
      ${activityCard(state.activity)}
      ${outOfOfficeCard(status)}
      ${notificationsCard(status)}
      ${automationsCoverageCard()}
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

async function postAndRefresh(el, path, body) {
  await api(path, { method: path.includes("/settings") ? "PATCH" : "POST", body: JSON.stringify(body || {}) });
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
      if (target.matches("[data-vm-retry]")) {
        await refresh(el);
        return;
      }
      if (target.matches("[data-vm-activate]")) {
        const payload = permissionPayload(el);
        payload.mode = el.querySelector("[data-vm-mode]")?.value || "approval_required";
        await postAndRefresh(el, "/api/vacation-mode/activate", payload);
        notify("Vacation Mode", "Vacation Mode enabled. Away-coverage is active. Outbound actions still require approval.");
        return;
      }
      if (target.matches("[data-vm-deactivate], [data-vm-kill]")) {
        await postAndRefresh(el, "/api/vacation-mode/deactivate", {});
        notify("Vacation Mode", "Vacation Mode disabled. Away-coverage stopped. Normal automations remain active.");
        return;
      }
      if (target.matches("[data-vm-save]")) {
        await postAndRefresh(el, "/api/vacation-mode/settings", permissionPayload(el));
        notify("Vacation Mode", "Settings saved.");
        return;
      }
      const approval = target.closest("[data-vm-approval]");
      if (approval) {
        await postAndRefresh(
          el,
          `/api/vacation-mode/approvals/${encodeURIComponent(approval.dataset.vmApproval)}/decision`,
          { decision: approval.dataset.vmDecision },
        );
        notify("Vacation Mode", "Approval decision recorded. No external action was executed.");
      }
    } catch (error) {
      notify("Vacation Mode", error.message || "Vacation Mode action failed.");
      state = { ...state, error: error.message || "Vacation Mode action failed.", loading: false };
      renderShell(el);
    }
  });
}
