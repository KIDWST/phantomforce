/* PhantomForce — Automation workspace.
   A standalone system: automations are real user-created workflow records
   that run independently of any other feature. Vacation Mode (its own
   first-class page) can lean on automations while it's active, but this
   page never renders vacation-specific UI — that would blur two different
   products into one confusing surface. Customer/brand context belongs in
   the real Memory/Hermes notes layer; this file renders only real,
   user-created automation records. No internal lanes or fabricated
   records are shown. */

import { store, uid, visible, pushActivity, ago, currentWs, session, workspaceStorageSetItem } from "./store.js?v=phantom-live-20260717-16";
import {
  DAILY_IDEA_AUTOMATION_ID, dailyIdeaState, refreshDailyIdeas, saveDailyIdeaAutomation,
  DAILY_IDEA_CHANNELS, DAILY_IDEA_CONTENT_TYPES, DAILY_IDEA_FOCUS, DAILY_IDEA_STYLES,
} from "./content-ideas.js?v=phantom-live-20260717-16";

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ---------------- Autopilot: the real, scheduled server-side automations ----------------
   These are NOT the client-side "agents" records above — they're read-only,
   scheduled (daily/weekly/monthly) jobs that live on the server, each
   logging a real result to the Hermes ledger on every run. Every request
   here is a real network call; unreachable/unauthorized always renders an
   honest error state, never a fabricated job list. */
let autopilotJobs = null;
let autopilotError = null;
let autopilotLoading = false;
let autopilotBusyIds = new Set();

function authHeaders(extra = {}) {
  const token = session.token();
  return { ...extra, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

async function fetchAutopilotJobs() {
  try {
    const r = await fetch("/phantom-ai/automations", { headers: authHeaders() });
    const d = await r.json().catch(() => null);
    if (r.ok && d && d.ok) return { ok: true, jobs: d.jobs };
    return { ok: false, error: (d && d.error) || `Request failed (${r.status}).` };
  } catch {
    return { ok: false, error: "Could not reach the automation engine." };
  }
}

async function toggleAutopilotJob(id, enabled) {
  try {
    const r = await fetch(`/phantom-ai/automations/${encodeURIComponent(id)}/toggle`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ enabled }),
    });
    const d = await r.json().catch(() => null);
    return r.ok && d && d.ok ? { ok: true } : { ok: false, error: (d && d.error) || `Request failed (${r.status}).` };
  } catch {
    return { ok: false, error: "Could not reach the automation engine." };
  }
}

async function runAutopilotJobNow(id) {
  try {
    const r = await fetch(`/phantom-ai/automations/${encodeURIComponent(id)}/run`, { method: "POST", headers: authHeaders() });
    const d = await r.json().catch(() => null);
    return r.ok && d && d.ok ? { ok: true } : { ok: false, error: (d && d.error) || `Request failed (${r.status}).` };
  } catch {
    return { ok: false, error: "Could not reach the automation engine." };
  }
}

const AUTOPILOT_CATEGORY_LABEL = {
  health: "System health",
  ops: "Business operations",
  content: "Content & marketing",
  intelligence: "Competitor intelligence",
  security: "Security protection",
  crm: "CRM discovery",
  outreach: "Outreach prep",
};
const AUTOPILOT_CADENCE_LABEL = { daily: "Daily", weekly: "Weekly", monthly: "Monthly" };

const AGENT_STATE = {
  active: { label: "ON", cls: "on" },
  waiting: { label: "OFF", cls: "gate" },
  "needs-approval": { label: "APPROVAL", cls: "gate" },
  blocked: { label: "BLOCKED", cls: "hold" },
  paused: { label: "OFF", cls: "idle" },
  idle: { label: "OFF", cls: "idle" },
};

/* Starter recipes — real, honest starting points. Using one creates a real
   draft automation record (same path as chat-created automations) that
   lands in Configured as off / approval required; nothing runs on its own. */
const RECIPES = [
  { id: "lead-followup", name: "Follow up with new leads every morning", mission: "Each morning, review new leads from the last 24 hours and draft a personalized follow-up for each one. Replies wait for approval before sending." },
  { id: "weekly-analytics", name: "Send me a weekly analytics report", mission: "Every week, compile a summary of connected-account performance and post it as an activity update." },
  { id: "comment-drafts", name: "Draft replies to comments, don't send", mission: "Watch connected social accounts for new comments and draft a reply for each — nothing sends without approval." },
  { id: "lead-assign", name: "Assign a worker when a new lead comes in", mission: "When a new lead is captured, assign it to an available worker and draft an initial response for review." },
  { id: "daily-digest", name: "Daily digest of what needs my attention", mission: "Each morning, summarize pending approvals, urgent items, and anything blocked so it's one glance instead of a hunt." },
];

const TABS = [
  ["configured", "Configured"],
  ["autopilot", "Always-on"],
  ["recipes", "Recipes"],
  ["logs", "Logs"],
  ["safety", "Safety rules"],
];

let auTab = "configured";
let expandedAutomationId = null;

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
      <em>Created ${esc(ago(a.createdAt))} · Updated ${esc(ago(a.updatedAt))} · ${esc(a.source || "Dashboard")}</em>
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

function autopilotJobCard(job) {
  const busy = autopilotBusyIds.has(job.id);
  const tone = !job.enabled ? "off" : job.last_status === "error" ? "warn" : job.last_status === "ok" ? "on" : "warn";
  return `<article class="ap-job-card ap-tone-${tone}">
    <div class="ap-job-top">
      <label class="ap-switch" title="${job.enabled ? "Turn off" : "Turn on"}">
        <input type="checkbox" data-ap-toggle="${esc(job.id)}" ${job.enabled ? "checked" : ""} ${busy ? "disabled" : ""} />
        <span class="ap-switch-track"><span class="ap-switch-thumb"></span></span>
      </label>
      <div class="ap-job-id">
        <b>${esc(job.name)}</b>
        <i>${esc(AUTOPILOT_CADENCE_LABEL[job.cadence] || job.cadence)} · runs ${job.run_count} time${job.run_count === 1 ? "" : "s"}</i>
      </div>
      <button class="btn btn-quiet ap-run-now" type="button" data-ap-run="${esc(job.id)}" ${busy || !job.enabled ? "disabled" : ""}>${busy ? "Running…" : "Run now"}</button>
    </div>
    <p class="ap-job-desc">${esc(job.description)}</p>
    ${job.benefit ? `<p class="ap-job-benefit">${esc(job.benefit)}</p>` : ""}
    <div class="ap-job-meta">
      ${job.output ? `<span>${esc(job.output)}</span>` : ""}
      ${job.approval_required ? `<span>Approval-gated</span>` : `<span>Read-only</span>`}
      ${job.external_action ? `<span>External action</span>` : `<span>No external writes</span>`}
    </div>
    ${Array.isArray(job.setup_fields) && job.setup_fields.length ? `<div class="ap-job-setup">${job.setup_fields.map((field) => `<i>${esc(field)}</i>`).join("")}</div>` : ""}
    <div class="ap-job-foot">
      <span class="ap-job-status ap-tone-${tone}">${job.last_status ? esc(job.last_status) : "not run yet"}</span>
      <span>${job.last_summary ? esc(job.last_summary) : "No runs logged yet."}</span>
      <i>${job.last_run_at ? esc(ago(job.last_run_at)) : ""}</i>
    </div>
  </article>`;
}

function options(list, selected) {
  return list.map((item) => `<option value="${esc(item)}" ${item === selected ? "selected" : ""}>${esc(item)}</option>`).join("");
}

function automationRow({ id, kicker, name, summary, meta, enabled, disabled = false, expanded = false, switchAttr = "", status = "" }) {
  return `<article class="au-automation-row ${expanded ? "is-expanded" : ""}" data-au-expand="${esc(id)}" role="button" tabindex="0" aria-expanded="${expanded ? "true" : "false"}">
    <label class="ap-switch au-row-switch" title="${disabled ? "Approval required before this can be switched" : enabled ? "Turn off" : "Turn on"}">
      <input type="checkbox" ${switchAttr} ${enabled ? "checked" : ""} ${disabled ? "disabled" : ""} />
      <span class="ap-switch-track"><span class="ap-switch-thumb"></span></span>
    </label>
    <div class="au-row-main">
      <span class="au-row-kicker">${esc(kicker)}</span>
      <b>${esc(name)}</b>
      <p>${esc(summary || "No mission saved yet.")}</p>
    </div>
    <div class="au-row-meta">
      ${status ? `<i>${esc(status)}</i>` : ""}
      <span>${esc(meta || "")}</span>
    </div>
    <button class="au-row-open" type="button" data-au-open="${esc(id)}">${expanded ? "Close" : "Edit"}</button>
  </article>`;
}

function dailyIdeaEditPanel(config, missingProfile) {
  return `<div class="au-edit-panel" data-au-edit-panel="${esc(DAILY_IDEA_AUTOMATION_ID)}">
    <div class="au-config-grid">
      <label class="au-config-wide">Automation name<input data-di-name value="${esc(config.name)}" /></label>
      <label>Number of ideas<input type="number" min="1" max="12" step="1" data-di-count value="${esc(config.count)}" /></label>
      <label>Style<select data-di-style>${options(DAILY_IDEA_STYLES, config.style)}</select></label>
      <label>Content focus<select data-di-focus>${options(DAILY_IDEA_FOCUS, config.focus)}</select></label>
      <label>Refresh hour<input type="number" min="0" max="23" step="1" data-di-hour value="${esc(config.refreshHour)}" /></label>
      <label class="au-config-wide">What content?<input data-di-content-types value="${esc(config.contentTypes.join(", "))}" placeholder="Short video, Carousel, Image post" /></label>
      <label class="au-config-wide">Channels<input data-di-channels value="${esc(config.channels.join(", "))}" placeholder="Instagram, TikTok, LinkedIn" /></label>
    </div>
    <div class="au-profile-box ${missingProfile ? "needs-profile" : ""}">
      <div>
        <b>Business profile for this account</b>
        <p>New accounts should answer these basics on setup so Phantom does not guess wrong. These fields guide the daily ideas only; no provider call happens here.</p>
      </div>
      <div class="au-profile-grid">
        <label>Business name<input data-di-profile="businessName" value="${esc(config.profile.businessName)}" placeholder="e.g. Ultimate Treasures" /></label>
        <label>Audience<input data-di-profile="audience" value="${esc(config.profile.audience)}" placeholder="Who are we trying to reach?" /></label>
        <label>Offer<input data-di-profile="offer" value="${esc(config.profile.offer)}" placeholder="What do we sell or want booked?" /></label>
        <label>Voice<input data-di-profile="voice" value="${esc(config.profile.voice)}" placeholder="Direct, premium, playful, local..." /></label>
        <label class="au-config-wide">Goal<input data-di-profile="goal" value="${esc(config.profile.goal)}" placeholder="Bookings, awareness, sales, leads..." /></label>
      </div>
    </div>
    <div class="au-config-actions">
      <button class="btn btn-primary" data-di-save type="button">Save automation</button>
      <button class="btn btn-quiet" data-di-refresh type="button">Regenerate today's ${esc(config.count)}</button>
      <button class="btn btn-quiet" data-di-open-ideas data-open-ws="content" type="button">Open New Ideas</button>
    </div>
    <p class="bm-hint">Daily ideas are replaced each day. If the user saves an idea in Creator Hub, that saved idea stays; the disposable batch does not.</p>
  </div>`;
}

function customAutomationEditPanel(a, pendingApproval, allowedDuringVacation) {
  const st = AGENT_STATE[a.status] || AGENT_STATE.idle;
  return `<div class="au-edit-panel" data-au-edit-panel="${esc(a.id)}">
    <div class="au-edit-grid">
      <label>Name<input data-au-edit-name="${esc(a.id)}" value="${esc(a.name)}" /></label>
      <label>Status<input value="${esc(st.label)}" disabled /></label>
      <label class="au-config-wide">Mission<textarea data-au-edit-mission="${esc(a.id)}">${esc(a.mission || a.role || "")}</textarea></label>
      <label>Source<input value="${esc(a.source || "Dashboard")}" disabled /></label>
      <label>Updated<input value="${esc(ago(a.updatedAt))}" disabled /></label>
    </div>
    <div class="au-config-actions">
      <button class="btn btn-primary" data-au-save-agent="${esc(a.id)}" type="button">Save changes</button>
      ${pendingApproval ? `<button class="btn btn-quiet" data-open-ws="approvals" type="button">Review approval</button>` : ""}
      ${a.status === "active" ? `<button class="btn btn-quiet" data-au-pause="${esc(a.id)}" type="button">Pause</button>` : ""}
      ${a.status === "paused" || a.status === "waiting" ? `<button class="btn btn-quiet" data-au-resume="${esc(a.id)}" type="button">Resume</button>` : ""}
      <button class="btn btn-quiet" data-au-vacation-toggle="${esc(a.id)}" type="button">${allowedDuringVacation ? "Block in Vacation Mode" : "Allow in Vacation Mode"}</button>
      <button class="btn btn-quiet" data-au-del="${esc(a.id)}" type="button">Delete</button>
    </div>
  </div>`;
}

function configuredAutomationTab(agents) {
  const { config, ideas, savedIdeas, missingProfile } = dailyIdeaState();
  const created = agents.filter((a) => a.kind === "automation");
  if (expandedAutomationId && expandedAutomationId !== DAILY_IDEA_AUTOMATION_ID && !created.some((a) => a.id === expandedAutomationId)) {
    expandedAutomationId = null;
  }
  const dailyExpanded = expandedAutomationId === DAILY_IDEA_AUTOMATION_ID;
  const automationRows = [
    {
      id: DAILY_IDEA_AUTOMATION_ID,
      enabled: config.enabled,
      html: `<div class="au-automation-block">
      ${automationRow({
        id: DAILY_IDEA_AUTOMATION_ID,
        kicker: "Creator Hub automation",
        name: config.name,
        summary: `Fresh disposable idea batch every day. Today: ${ideas.length} active, ${savedIdeas.length} saved.`,
        meta: `${config.count}/day · ${config.style} · ${config.focus} · ${config.refreshHour}:00`,
        enabled: config.enabled,
        expanded: dailyExpanded,
        switchAttr: "data-di-enabled-quick",
        status: config.enabled ? "On" : "Off",
      })}
      ${dailyExpanded ? dailyIdeaEditPanel(config, missingProfile) : ""}
    </div>`,
    },
    ...created.map((a) => {
      const pendingApproval = (store.state.approvals || []).find((app) => app.ref === a.id && app.status === "pending");
      const st = AGENT_STATE[a.status] || AGENT_STATE.idle;
      const allowedDuringVacation = a.allowedDuringVacation !== false;
      const disabled = !!pendingApproval || a.status === "needs-approval" || a.status === "blocked";
      const expanded = expandedAutomationId === a.id;
      return {
        id: a.id,
        enabled: a.status === "active",
        html: `<div class="au-automation-block">
        ${automationRow({
          id: a.id,
          kicker: a.source || "User-created automation",
          name: a.name,
          summary: a.mission || a.role || "",
          meta: `Updated ${ago(a.updatedAt)} · ${allowedDuringVacation ? "Vacation allowed" : "Vacation blocked"}`,
          enabled: a.status === "active",
          disabled,
          expanded,
          switchAttr: `data-au-enable="${esc(a.id)}"`,
          status: pendingApproval ? "Approval needed" : st.label,
        })}
        ${expanded ? customAutomationEditPanel(a, pendingApproval, allowedDuringVacation) : ""}
      </div>`,
      };
    }),
  ];
  const onRows = automationRows.filter((row) => row.enabled);
  const offRows = automationRows.filter((row) => !row.enabled);
  const renderGroup = (label, rows, empty) => `
    <section class="au-automation-group ${rows.length ? "" : "is-empty"}">
      <div class="au-automation-group-head">
        <b>${esc(label)}</b>
        <span>${rows.length}</span>
      </div>
      ${rows.length ? rows.map((row) => row.html).join("") : `<p class="au-empty-note">${esc(empty)}</p>`}
    </section>`;
  return `<div class="au-config-wrap">
    <section class="au-config-card au-config-list-card">
      <div class="au-config-head">
        <div>
          <p class="ch-eyebrow">Configured automations</p>
          <h3>Automation list</h3>
          <p>On automations stay at the top. Off or approval-required automations stay below. Use the switch for quick control, or open a row to rename and edit it.</p>
        </div>
      </div>
      <div class="au-automation-list">
        ${renderGroup("On", onRows, "No automations are on yet.")}
        ${renderGroup("Off / approval required", offRows, "Nothing is off or waiting.")}
      </div>
    </section>
  </div>`;
}

function autopilotDeveloperTab() {
  if (autopilotJobs === null && autopilotError) {
    return `<div class="au-empty"><b>Couldn't load Autopilot.</b><span>${esc(autopilotError)}</span><button class="btn" type="button" data-ap-retry>Retry</button></div>`;
  }
  if (autopilotJobs === null) {
    return `<div class="ap-loading"><p class="au-empty-note">Checking the automation engine…</p></div>`;
  }
  const jobs = autopilotJobs || [];
  const activeCount = jobs.filter((j) => j.enabled).length;
  const categories = ["security", "intelligence", "crm", "outreach", "content", "ops", "health"];
  return `<div class="ap-wrap">
    <p class="bm-hint">Tell Phantom about the business first — website, store, emails, CRM/source, offer, audience, and competitors. These automations start on for every account, but the better the profile, the sharper the results. Sends, posts, spending, uploads, CRM writes, and publishing still require approval.</p>
    <div class="au-summary" aria-label="Autopilot summary">
      <span><b>${jobs.length}</b><i>Jobs defined</i></span>
      <span><b>${activeCount}</b><i>Turned on</i></span>
      <span><b>${jobs.filter((j) => j.last_status === "error").length}</b><i>Last run flagged</i></span>
    </div>
    ${categories.map((cat) => {
      const inCat = jobs.filter((j) => j.category === cat);
      if (!inCat.length) return "";
      return `<section class="ap-category">
        <h4>${esc(AUTOPILOT_CATEGORY_LABEL[cat] || cat)}</h4>
        <div class="ap-job-grid">${inCat.map(autopilotJobCard).join("")}</div>
      </section>`;
    }).join("")}
  </div>`;
}

function loadAutopilotDiagnostics(el, paint) {
  if (autopilotJobs || autopilotLoading || autopilotError) return;
  autopilotLoading = true;
  autopilotError = null;
  fetchAutopilotJobs().then((res) => {
    autopilotLoading = false;
    if (res.ok) { autopilotJobs = res.jobs; autopilotError = null; }
    else { autopilotError = res.error; }
    if (document.body.contains(el)) paint();
  });
}

function wireAutopilotDiagnostics(el, notify, paint) {
  el.querySelector("[data-ap-retry]")?.addEventListener("click", () => {
    autopilotJobs = null;
    autopilotError = null;
    paint();
  });

  el.querySelectorAll("[data-ap-toggle]").forEach((input) => {
    input.onchange = async () => {
      const id = input.dataset.apToggle;
      const nextEnabled = input.checked;
      autopilotBusyIds.add(id);
      paint();
      const res = await toggleAutopilotJob(id, nextEnabled);
      autopilotBusyIds.delete(id);
      if (res.ok && autopilotJobs) {
        const job = autopilotJobs.find((j) => j.id === id);
        if (job) job.enabled = nextEnabled;
        notify("Autopilot", `${nextEnabled ? "Turned on" : "Turned off"} "${job?.name || id}".`);
      } else {
        notify("Autopilot", `Couldn't update "${id}": ${res.error || "unknown error"}.`);
      }
      paint();
    };
  });

  el.querySelectorAll("[data-ap-run]").forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.dataset.apRun;
      autopilotBusyIds.add(id);
      paint();
      const res = await runAutopilotJobNow(id);
      autopilotBusyIds.delete(id);
      if (res.ok) {
        const refreshed = await fetchAutopilotJobs();
        if (refreshed.ok) autopilotJobs = refreshed.jobs;
        notify("Autopilot", `Ran "${id}" now.`);
      } else {
        notify("Autopilot", `Couldn't run "${id}": ${res.error || "unknown error"}.`);
      }
      paint();
    };
  });
}

export function renderDeveloperAutopilotPanel(el, opts = {}) {
  const notify = opts.notify || (() => {});
  const paint = () => renderDeveloperAutopilotPanel(el, opts);
  loadAutopilotDiagnostics(el, paint);
  el.innerHTML = `
    <section class="developer-card ap-dev-panel">
      <p class="developer-kicker">Autopilot diagnostics</p>
      <h4>Scheduled server jobs</h4>
      <p class="set-note">Owner/developer curtain view. These are internal read-only/prep jobs and local health checks; keep this out of client-facing surfaces.</p>
      ${autopilotDeveloperTab()}
    </section>`;
  wireAutopilotDiagnostics(el, notify, paint);
}

/* ---------------- Agent runs: the real server execution lifecycle ----------------
   Every row here is a real backend run record (queued → executing → verifying
   → completed/failed/cancelled) with a persisted event trail, an artifact on
   disk, and a Hermes ledger proof id. The same engine chat uses for "run a
   business snapshot" — one system, two doors. Unreachable/unauthorized renders
   an honest error; nothing is ever shown as running unless the server says so. */
let agentRunsOps = null;
let agentRunsList = null;
let agentRunsError = null;
let agentRunsLoading = false;
let agentRunsBusy = false;
let agentRunsExpandedId = null;
let agentRunsPollTimer = null;
const TERMINAL_RUN_STATES = new Set(["completed", "failed", "cancelled"]);
const RUN_STATE_CLS = { queued: "idle", executing: "on", verifying: "on", completed: "on", failed: "hold", cancelled: "idle" };

async function fetchAgentRunsData() {
  try {
    const [opsRes, runsRes] = await Promise.all([
      fetch("/phantom-ai/runs/operations", { headers: authHeaders() }),
      fetch("/phantom-ai/runs", { headers: authHeaders() }),
    ]);
    const ops = await opsRes.json().catch(() => null);
    const runsPayload = await runsRes.json().catch(() => null);
    if (opsRes.ok && ops?.ok && runsRes.ok && runsPayload?.ok) {
      return { ok: true, operations: ops.operations, runs: runsPayload.runs };
    }
    const status = !opsRes.ok ? opsRes.status : runsRes.status;
    return { ok: false, error: status === 401 || status === 403 ? "This session isn't authorized for the run engine." : `Run engine request failed (${status}).` };
  } catch {
    return { ok: false, error: "Could not reach the run engine." };
  }
}

function agentRunEventRow(evt) {
  return `<div class="dev-run-event">
    <i>${esc(new Date(evt.at).toLocaleTimeString())}</i>
    ${evt.state ? `<b>${esc(evt.state)}</b>` : `<b class="dev-run-event-note">·</b>`}
    <span>${esc(evt.note)}</span>
  </div>`;
}

function agentRunRow(run) {
  const cls = RUN_STATE_CLS[run.state] || "gate";
  const artifact = (run.artifacts || [])[0];
  const expanded = agentRunsExpandedId === run.id;
  const terminal = TERMINAL_RUN_STATES.has(run.state);
  return `<div class="au-item dev-run-item" data-dev-run="${esc(run.id)}">
    <span class="aops-led aops-${cls}"><i></i></span>
    <span class="au-item-main">
      <b>${esc(run.title)} <em class="dev-run-state dev-run-state-${esc(run.state)}">${esc(run.state)}</em></b>
      <i>${esc(run.request || run.operation)}</i>
      <em>${esc(run.id)} · updated ${esc(ago(run.updated_at))} · workspace ${esc(run.workspace)}</em>
      ${artifact ? `<em class="dev-run-artifact">Artifact: ${esc(artifact.summary)}</em>` : ""}
      ${run.proof_request_id ? `<em class="dev-run-proof">Ledger proof: request ${esc(run.proof_request_id)}</em>` : ""}
      ${run.error ? `<em class="dev-run-error">${esc(run.error)}</em>` : ""}
    </span>
    <span class="dev-run-actions">
      <button class="btn btn-quiet" type="button" data-dev-run-events="${esc(run.id)}">${expanded ? "Hide trail" : `Events (${(run.events || []).length})`}</button>
      ${terminal ? "" : `<button class="btn btn-quiet" type="button" data-dev-run-cancel="${esc(run.id)}">Cancel</button>`}
    </span>
    ${expanded ? `<div class="dev-run-events">${(run.events || []).map(agentRunEventRow).join("")}</div>` : ""}
  </div>`;
}

function agentRunsBody() {
  if (agentRunsError) {
    return `<div class="dev-error-banner"><b>Run engine unavailable.</b><span>${esc(agentRunsError)}</span><button type="button" data-dev-runs-retry>Retry</button></div>`;
  }
  if (!agentRunsList) return `<p class="au-empty-note">Checking the run engine…</p>`;
  const active = agentRunsList.filter((r) => !TERMINAL_RUN_STATES.has(r.state)).length;
  return `
    <div class="dev-run-ops">
      ${(agentRunsOps || []).map((op) => `
        <article class="ap-curtain-card dev-run-op">
          <b>${esc(op.title)}</b>
          <p>${esc(op.description)}</p>
          <button class="btn" type="button" data-dev-run-start="${esc(op.id)}" ${agentRunsBusy ? "disabled" : ""}>Run now</button>
        </article>`).join("")}
    </div>
    ${agentRunsList.length ? `
      <div class="au-summary" aria-label="Run summary">
        <span><b>${agentRunsList.length}</b><i>Runs this session</i></span>
        <span><b>${active}</b><i>In flight</i></span>
        <span><b>${agentRunsList.filter((r) => r.state === "failed").length}</b><i>Failed</i></span>
      </div>
      <div class="au-list dev-run-list">${agentRunsList.map(agentRunRow).join("")}</div>`
    : `<p class="au-empty-note">No runs yet since the server started. Start one above, or tell Phantom "run a business snapshot" in chat — both land here.</p>`}`;
}

function scheduleAgentRunsPoll(el, paint) {
  clearTimeout(agentRunsPollTimer);
  const hasActive = (agentRunsList || []).some((r) => !TERMINAL_RUN_STATES.has(r.state));
  if (!hasActive) return;
  agentRunsPollTimer = setTimeout(async () => {
    if (!document.body.contains(el)) return;
    const res = await fetchAgentRunsData();
    if (!document.body.contains(el)) return;
    if (res.ok) { agentRunsOps = res.operations; agentRunsList = res.runs; agentRunsError = null; }
    paint();
  }, 1200);
}

function wireAgentRunsPanel(el, notify, paint) {
  el.querySelector("[data-dev-runs-retry]")?.addEventListener("click", () => {
    agentRunsList = null;
    agentRunsError = null;
    agentRunsLoading = false;
    paint();
  });
  el.querySelectorAll("[data-dev-run-start]").forEach((btn) => {
    btn.onclick = async () => {
      agentRunsBusy = true;
      paint();
      try {
        const r = await fetch("/phantom-ai/runs", {
          method: "POST",
          headers: authHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ operation: btn.dataset.devRunStart, request: "Started from Developer → Agent runs", workspace: currentWs() }),
        });
        const d = await r.json().catch(() => null);
        if (r.ok && d?.ok) notify("Agent runs", `Started ${d.run.title} (${d.run.id}).`);
        else notify("Agent runs", `Couldn't start the run: ${(d && d.error) || `request failed (${r.status})`}.`);
      } catch {
        notify("Agent runs", "Couldn't reach the run engine.");
      }
      agentRunsBusy = false;
      const res = await fetchAgentRunsData();
      if (res.ok) { agentRunsOps = res.operations; agentRunsList = res.runs; agentRunsError = null; }
      if (document.body.contains(el)) paint();
    };
  });
  el.querySelectorAll("[data-dev-run-events]").forEach((btn) => {
    btn.onclick = () => {
      agentRunsExpandedId = agentRunsExpandedId === btn.dataset.devRunEvents ? null : btn.dataset.devRunEvents;
      paint();
    };
  });
  el.querySelectorAll("[data-dev-run-cancel]").forEach((btn) => {
    btn.onclick = async () => {
      try {
        await fetch(`/phantom-ai/runs/${encodeURIComponent(btn.dataset.devRunCancel)}/cancel`, { method: "POST", headers: authHeaders() });
      } catch {}
      const res = await fetchAgentRunsData();
      if (res.ok) { agentRunsOps = res.operations; agentRunsList = res.runs; agentRunsError = null; }
      if (document.body.contains(el)) paint();
    };
  });
}

export function renderDeveloperAgentRunsPanel(el, opts = {}) {
  const notify = opts.notify || (() => {});
  const paint = () => renderDeveloperAgentRunsPanel(el, opts);
  if (!agentRunsList && !agentRunsLoading && !agentRunsError) {
    agentRunsLoading = true;
    fetchAgentRunsData().then((res) => {
      agentRunsLoading = false;
      if (res.ok) { agentRunsOps = res.operations; agentRunsList = res.runs; agentRunsError = null; }
      else agentRunsError = res.error;
      if (document.body.contains(el)) paint();
    });
  }
  el.innerHTML = `
    <section class="developer-card ap-dev-panel">
      <p class="developer-kicker">Agent runs</p>
      <h4>Real execution lifecycle</h4>
      <p class="set-note">Every run walks queued → executing → verifying → completed/failed with a persisted event trail, an artifact on disk, and a Hermes ledger proof entry. Same engine chat uses for "run a business snapshot". Read-only executors — no sends, no spend.</p>
      ${agentRunsBody()}
    </section>`;
  wireAgentRunsPanel(el, notify, paint);
  scheduleAgentRunsPoll(el, paint);
}

function recipesTab() {
  return `<div class="au-recipes">
    <p class="bm-hint au-recipes-note">Using a recipe adds a real automation to Configured as off / approval required. Nothing runs until you turn it on or approve it.</p>
    <div class="au-recipe-grid">
      ${RECIPES.map((r) => `<article class="au-recipe-card">
        <b>${esc(r.name)}</b>
        <p>${esc(r.mission)}</p>
        <button class="btn btn-quiet" type="button" data-au-recipe="${esc(r.id)}">Use this recipe</button>
      </article>`).join("")}
    </div>
  </div>`;
}

function logsTab() {
  const rows = (store.state.activity || []).filter((a) => a.text && /automation/i.test(a.text)).slice(0, 40);
  return `<div class="au-logs">${rows.length ? rows.map((a) => `<div class="au-log-row"><b>${esc(a.who)}</b><span>${esc(a.text)}</span><i>${ago(a.at)}</i></div>`).join("") : `<p class="au-empty-note">No automation history yet.</p>`}</div>`;
}

function safetyTab() {
  const rules = [
    ["New automations start off", "Nothing runs the moment it's created — every automation lands in Configured as off or approval required until you approve it."],
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
  const allowedTabIds = new Set(TABS.map(([id]) => id));
  if (!allowedTabIds.has(auTab)) auTab = "configured";
  const agents = visible(store.state.agents || []);
  const automationAgents = agents.filter((a) => a.kind === "automation");
  const dailyConfig = dailyIdeaState().config;
  const count = automationAgents.length + 1;
  const pending = automationAgents.filter((a) => a.status === "idle" || a.status === "needs-approval").length;
  const running = automationAgents.filter((a) => a.status === "active").length + (dailyConfig.enabled ? 1 : 0);
  const off = Math.max(0, count - running);

  const panel = auTab === "configured" ? configuredAutomationTab(agents)
    : auTab === "autopilot" ? autopilotDeveloperTab()
    : auTab === "recipes" ? recipesTab()
    : auTab === "logs" ? logsTab()
    : safetyTab();

  el.innerHTML = `
    <div class="au">
      <div class="bm-note au-note"><i></i>Tell Phantom about your business — website, store, emails, CRM/source, offer, audience, and competitors — so automations use the right data from day one.</div>
      <div class="au-summary" aria-label="Automation summary">
        <span><b>${count}</b><i>Configured</i></span>
        <span><b>${running}</b><i>On</i></span>
        <span><b>${off}</b><i>Off</i></span>
        <span><b>${pending}</b><i>Approval required</i></span>
      </div>
      <nav class="ml-tabs au-tabs" role="tablist">
        ${TABS.map(([id, label]) => `<button class="ml-tab ${auTab === id ? "is-active" : ""}" type="button" role="tab" data-au-tab="${id}">${label}</button>`).join("")}
      </nav>
      <section class="bm-card au-card">${panel}</section>
    </div>`;

  if (auTab === "autopilot") loadAutopilotDiagnostics(el, paint);
  if (auTab === "autopilot") wireAutopilotDiagnostics(el, notify, paint);

  el.querySelectorAll("[data-au-tab]").forEach((btn) => btn.onclick = () => { auTab = btn.dataset.auTab; paint(); });

  const toggleExpandedAutomation = (id) => {
    expandedAutomationId = expandedAutomationId === id ? null : id;
    paint();
  };
  el.querySelectorAll("[data-au-expand]").forEach((row) => {
    row.addEventListener("click", (event) => {
      if (event.target.closest(".au-row-switch, button, input, label, select, textarea, a")) return;
      toggleExpandedAutomation(row.dataset.auExpand);
    });
    row.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      if (event.target.closest(".au-row-switch, button, input, label, select, textarea, a")) return;
      event.preventDefault();
      toggleExpandedAutomation(row.dataset.auExpand);
    });
  });
  el.querySelectorAll(".au-row-switch").forEach((sw) => {
    sw.addEventListener("click", (event) => event.stopPropagation());
    sw.addEventListener("pointerdown", (event) => event.stopPropagation());
    sw.addEventListener("keydown", (event) => event.stopPropagation());
  });
  el.querySelectorAll("[data-au-open]").forEach((btn) => {
    btn.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleExpandedAutomation(btn.dataset.auOpen);
    };
  });

  el.querySelector("[data-di-enabled-quick]")?.addEventListener("change", (event) => {
    const current = dailyIdeaState().config;
    const next = saveDailyIdeaAutomation({ ...current, enabled: !!event.target.checked });
    pushActivity("Automation", `${next.enabled ? "enabled" : "disabled"} ${next.name}.`, currentWs());
    store.save();
    notify("Automation", `${next.enabled ? "Turned on" : "Turned off"} "${next.name}".`);
    paint();
  });

  el.querySelectorAll("[data-au-enable]").forEach((input) => {
    input.onchange = () => {
      const agent = (store.state.agents || []).find((a) => a.id === input.dataset.auEnable);
      if (!agent) return;
      const nextStatus = input.checked ? "active" : "paused";
      agent.status = nextStatus;
      agent.updatedAt = new Date().toISOString();
      pushActivity("Automation", `${nextStatus === "active" ? "resumed" : "paused"} automation "${agent.name}".`, agent.ws || currentWs());
      store.save();
      notify("Automation", `${nextStatus === "active" ? "Turned on" : "Turned off"} "${agent.name}".`);
      paint();
    };
  });

  el.querySelector("[data-di-save]")?.addEventListener("click", () => {
    const current = dailyIdeaState().config;
    const profile = { ...current.profile };
    el.querySelectorAll("[data-di-profile]").forEach((input) => { profile[input.dataset.diProfile] = input.value || ""; });
    const next = saveDailyIdeaAutomation({
      ...current,
      name: (el.querySelector("[data-di-name]")?.value || current.name).trim().slice(0, 90) || current.name,
      enabled: current.enabled,
      count: Number(el.querySelector("[data-di-count]")?.value || current.count),
      style: el.querySelector("[data-di-style]")?.value || current.style,
      focus: el.querySelector("[data-di-focus]")?.value || current.focus,
      refreshHour: Number(el.querySelector("[data-di-hour]")?.value || current.refreshHour),
      contentTypes: String(el.querySelector("[data-di-content-types]")?.value || "").split(","),
      channels: String(el.querySelector("[data-di-channels]")?.value || "").split(","),
      autoClearDaily: true,
      profile,
    });
    refreshDailyIdeas();
    pushActivity("Automation", `updated ${next.name}: ${next.count} daily ideas, ${next.style} style, ${next.focus} focus.`, currentWs());
    store.save();
    notify("Automation", `Saved "${next.name}" and regenerated today's idea batch.`);
    paint();
  });

  el.querySelectorAll("[data-au-save-agent]").forEach((btn) => {
    btn.onclick = () => {
      const agent = (store.state.agents || []).find((a) => a.id === btn.dataset.auSaveAgent);
      if (!agent) return;
      const name = el.querySelector(`[data-au-edit-name="${CSS.escape(agent.id)}"]`)?.value.trim();
      const mission = el.querySelector(`[data-au-edit-mission="${CSS.escape(agent.id)}"]`)?.value.trim();
      if (name) agent.name = name.slice(0, 90);
      agent.mission = (mission || agent.mission || agent.role || "").slice(0, 500);
      agent.updatedAt = new Date().toISOString();
      pushActivity("Automation", `updated automation "${agent.name}".`, agent.ws || currentWs());
      store.save();
      notify("Automation", `Saved "${agent.name}".`);
      paint();
    };
  });

  el.querySelector("[data-di-refresh]")?.addEventListener("click", () => {
    const next = refreshDailyIdeas();
    pushActivity("Automation", `refreshed ${next.name} for today's Creator Hub ideas.`, currentWs());
    store.save();
    notify("Automation", `Refreshed today's ${next.count} ideas.`);
    paint();
  });

  el.querySelector("[data-di-open-ideas]")?.addEventListener("click", () => {
    try { workspaceStorageSetItem("pf.contenthub.openTab.v1", "ideas"); } catch {}
  });

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
      auTab = "configured";
      expandedAutomationId = a.id;
      paint();
      store.save();
      notify("Automation", `Added "${a.name}" to Configured. It is off until approved or turned on.`);
    };
  });

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
