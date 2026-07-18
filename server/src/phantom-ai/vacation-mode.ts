import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { AccessSession } from "../access/session.js";
import { appendApprovalQueueTransition, readApprovalQueueWithTransitions } from "./approval-queue.js";
import { appendHermesLedgerRecord, getHermesLedgerStatus, redactSensitiveText } from "./hermes-ledger.js";
import type { ApprovalQueueTransitionStatus, HermesLedgerRecord } from "./types.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../../..");
const storePath = process.env.PHANTOMFORCE_VACATION_MODE_PATH || resolve(repoRoot, ".phantom", "vacation-mode.json");

export type VacationModeMode = "off" | "hands_off";
export type VacationApprovalDecision = "approve" | "reject" | "snooze";
export type VacationRiskLevel = "low" | "medium" | "high" | "urgent";
export type VacationEventType = "observed" | "drafted" | "queued_approval" | "completed" | "blocked" | "needs_setup" | "notification_sent";
export type OperatorTaskType = "phone_call" | "attend_meeting" | "lead_follow_up" | "booking_coordination" | "client_message" | "research" | "exception_triage" | "other";
export type OperatorTaskStatus = "needs_setup" | "blocked" | "queued" | "assigned" | "in_progress" | "completed" | "canceled" | "taken_over";

export type VacationPermissions = {
  watchInbox: boolean;
  draftEmailReplies: boolean;
  sendEmailOnlyAfterApproval: boolean;
  autoReplyToNewMessages: boolean;
  followUpWithLeads: boolean;
  updateCrmTasks: boolean;
  scheduleSocialPosts: boolean;
  generateContentDrafts: boolean;
  monitorUrgentItems: boolean;
  notifyImportantChanges: boolean;
  allowLowRiskAutomations: boolean;
  requireApprovalForAllOutbound: boolean;
};

type OutOfOffice = {
  enabled: boolean;
  template: string;
  startDate: string | null;
  endDate: string | null;
  behavior: "draft_only" | "queue_for_approval";
  providerStatus: "not_connected" | "connected_needs_permission" | "ready" | "blocked_by_policy";
};

type NotificationPreferences = {
  inApp: boolean;
  emailSummary: boolean;
  urgentOnly: boolean;
  dailyDigest: boolean;
  realTimeActivityFeed: boolean;
};

type OperatorCoverage = {
  enabled: boolean;
  ownerInterruptionPolicy: "emergencies_only" | "daily_digest";
  allowCalls: boolean;
  allowMeetings: boolean;
  allowLeadFollowUps: boolean;
  allowBookingCoordination: boolean;
  allowClientMessages: boolean;
  dailyCreditLimit: number;
  handoffNotes: string;
  awayStart: string | null;
  awayEnd: string | null;
  timezone: string;
};

type OperatorWallet = {
  included: number;
  used: number;
  reserved: number;
  unit: "operator_credit";
  separateFromAiCredits: true;
};

export type VacationActivity = {
  id: string;
  workspaceId: string;
  actor: "Phantom AI" | "Hermes" | "Workflow" | "User" | "Human Operator";
  eventType: VacationEventType;
  riskLevel: VacationRiskLevel;
  message: string;
  relatedEntity?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

export type VacationApproval = {
  id: string;
  workspaceId: string;
  title: string;
  source: string;
  riskLevel: VacationRiskLevel;
  suggestedAction: string;
  reason: string;
  status: "pending" | "approved" | "rejected" | "snoozed";
  timestamp: string;
  metadata?: Record<string, unknown>;
};

export type OperatorTask = {
  id: string;
  workspaceId: string;
  type: OperatorTaskType;
  title: string;
  instructions: string;
  status: OperatorTaskStatus;
  creditCost: number;
  scheduledFor: string | null;
  assignedTo: string | null;
  outcome: string | null;
  createdAt: string;
  updatedAt: string;
  // Distinguishes "blocked, out of Operator Credits" from "blocked, the
  // owner's coverage plan doesn't authorize this kind of work" from
  // "blocked, coverage is paused" — all use status: "blocked", but the owner
  // needs to know which one it is (credits are solved by buying credits,
  // policy by changing a toggle, paused by resuming coverage).
  blockedReason?: "credits" | "policy" | "paused" | null;
};

type VacationWorkspaceState = {
  workspaceId: string;
  enabled: boolean;
  mode: VacationModeMode;
  // Pause-without-ending: while paused, the away window, wallet, and settings
  // stay intact, but coverage (check-ins and new operator-task queueing) is
  // suspended. pausedTotalMs accumulates completed pause spans for the
  // current away window so the digest never counts paused time as covered.
  paused: boolean;
  pausedAt: string | null;
  pausedTotalMs: number;
  startedAt: string | null;
  endedAt: string | null;
  lastActivityAt: string | null;
  lastCheckInAt: string | null;
  nextCheckInAt: string | null;
  permissions: VacationPermissions;
  outOfOffice: OutOfOffice;
  notificationPreferences: NotificationPreferences;
  operatorCoverage: OperatorCoverage;
  operatorWallet: OperatorWallet;
  operatorTasks: OperatorTask[];
  activity: VacationActivity[];
  approvals: VacationApproval[];
  createdAt: string;
  updatedAt: string;
};

type VacationStore = { version: 2; workspaces: Record<string, VacationWorkspaceState> };

const DEFAULT_PERMISSIONS: VacationPermissions = {
  watchInbox: false,
  draftEmailReplies: true,
  sendEmailOnlyAfterApproval: true,
  autoReplyToNewMessages: false,
  followUpWithLeads: false,
  updateCrmTasks: true,
  scheduleSocialPosts: false,
  generateContentDrafts: true,
  monitorUrgentItems: true,
  notifyImportantChanges: true,
  allowLowRiskAutomations: true,
  requireApprovalForAllOutbound: true,
};

const DEFAULT_OUT_OF_OFFICE: OutOfOffice = {
  enabled: false,
  template: "Thanks for reaching out. I am away, but my PhantomForce team is covering the business and will route anything urgent.",
  startDate: null,
  endDate: null,
  behavior: "queue_for_approval",
  providerStatus: "not_connected",
};

const DEFAULT_NOTIFICATIONS: NotificationPreferences = {
  inApp: true,
  emailSummary: false,
  urgentOnly: true,
  dailyDigest: true,
  realTimeActivityFeed: true,
};

const DEFAULT_COVERAGE: OperatorCoverage = {
  enabled: true,
  ownerInterruptionPolicy: "emergencies_only",
  allowCalls: true,
  allowMeetings: true,
  allowLeadFollowUps: true,
  allowBookingCoordination: true,
  allowClientMessages: true,
  dailyCreditLimit: 10,
  handoffNotes: "Keep the business moving. Handle routine work and only interrupt me for a true emergency.",
  awayStart: null,
  awayEnd: null,
  timezone: "America/Chicago",
};

const TASK_COST: Record<OperatorTaskType, number> = {
  phone_call: 2,
  attend_meeting: 4,
  lead_follow_up: 1,
  booking_coordination: 1,
  client_message: 1,
  research: 1,
  exception_triage: 1,
  other: 2,
};

// Bounded-autonomy enforcement: maps each operator task type to the
// coverage-plan toggle that actually authorizes it (app/js/vacation.js
// coveragePlan() checkboxes). Task types with no entry here (research,
// exception_triage, other) have no corresponding owner toggle in the
// coverage plan UI, so they are never blocked by this check — inventing a
// restriction the owner never configured would be its own kind of
// dishonesty. This is what makes "what Phantom can decide alone vs. must
// ask about" real: before this, the coverage toggles were saved and
// displayed but createVacationOperatorTask() never actually read them, so
// turning a toggle off had no effect on what could be queued.
const TASK_TYPE_ALLOW_FIELD: Partial<Record<OperatorTaskType, keyof OperatorCoverage>> = {
  phone_call: "allowCalls",
  attend_meeting: "allowMeetings",
  lead_follow_up: "allowLeadFollowUps",
  booking_coordination: "allowBookingCoordination",
  client_message: "allowClientMessages",
};
const TASK_TYPE_LABEL: Record<OperatorTaskType, string> = {
  phone_call: "Take calls",
  attend_meeting: "Attend meetings",
  lead_follow_up: "Follow up with leads",
  booking_coordination: "Handle bookings",
  client_message: "Handle client messages",
  research: "Research",
  exception_triage: "Handle an exception",
  other: "Other human work",
};

const RISK_ORDER: Record<VacationRiskLevel, number> = { urgent: 4, high: 3, medium: 2, low: 1 };

const now = () => new Date().toISOString();
const text = (value: unknown, max = 800) => redactSensitiveText(String(value ?? "")).trim().slice(0, max);
const workspaceIdFor = (session: AccessSession) => session.clientId || session.id || "owner-admin";
const businessNameFor = (session: AccessSession) => session.clientId === "client-chicagoshots" ? "ChicagoShots" : session.clientId || "PhantomForce";
const defaultCredits = (session: AccessSession) => Number(session.canManageAccess ? process.env.PHANTOMFORCE_OWNER_OPERATOR_CREDITS || 100 : process.env.PHANTOMFORCE_DEFAULT_OPERATOR_CREDITS || 0);
const humanStaffingReady = () => process.env.PHANTOMFORCE_HUMAN_OPERATOR_ENABLED === "true";
const checkIntervalMs = () => Math.max(30_000, Number(process.env.PHANTOMFORCE_VACATION_CHECK_INTERVAL_MS || 300_000));

function activity(workspaceId: string, input: Omit<VacationActivity, "id" | "workspaceId" | "createdAt">): VacationActivity {
  return { id: `vac-act-${randomUUID()}`, workspaceId, createdAt: now(), ...input, message: text(input.message, 900), relatedEntity: input.relatedEntity ? text(input.relatedEntity, 180) : undefined };
}

function freshState(session: AccessSession): VacationWorkspaceState {
  const createdAt = now();
  const workspaceId = workspaceIdFor(session);
  return {
    workspaceId,
    enabled: false,
    mode: "off",
    paused: false,
    pausedAt: null,
    pausedTotalMs: 0,
    startedAt: null,
    endedAt: null,
    lastActivityAt: createdAt,
    lastCheckInAt: null,
    nextCheckInAt: null,
    permissions: { ...DEFAULT_PERMISSIONS },
    outOfOffice: { ...DEFAULT_OUT_OF_OFFICE },
    notificationPreferences: { ...DEFAULT_NOTIFICATIONS },
    operatorCoverage: { ...DEFAULT_COVERAGE },
    operatorWallet: { included: Math.max(0, defaultCredits(session)), used: 0, reserved: 0, unit: "operator_credit", separateFromAiCredits: true },
    operatorTasks: [],
    activity: [activity(workspaceId, { actor: "Hermes", eventType: "observed", riskLevel: "low", message: "Away coverage is ready. No work has been invented or started.", relatedEntity: "Away Mode" })],
    approvals: [],
    createdAt,
    updatedAt: createdAt,
  };
}

function migrateState(raw: Record<string, unknown>, session: AccessSession): VacationWorkspaceState {
  const base = freshState(session);
  const enabled = raw.enabled === true;
  const oldApprovals = Array.isArray(raw.approvals) ? raw.approvals as VacationApproval[] : [];
  const oldActivity = Array.isArray(raw.activity) ? raw.activity as VacationActivity[] : base.activity;
  return {
    ...base,
    ...raw,
    enabled,
    mode: enabled ? "hands_off" : "off",
    paused: enabled && raw.paused === true,
    pausedAt: enabled && raw.paused === true && typeof raw.pausedAt === "string" ? raw.pausedAt : null,
    pausedTotalMs: Math.max(0, Number(raw.pausedTotalMs) || 0),
    permissions: { ...base.permissions, ...(raw.permissions as Partial<VacationPermissions> || {}) },
    outOfOffice: { ...base.outOfOffice, ...(raw.outOfOffice as Partial<OutOfOffice> || {}) },
    notificationPreferences: { ...base.notificationPreferences, ...(raw.notificationPreferences as Partial<NotificationPreferences> || {}) },
    operatorCoverage: { ...base.operatorCoverage, ...(raw.operatorCoverage as Partial<OperatorCoverage> || {}) },
    operatorWallet: { ...base.operatorWallet, ...(raw.operatorWallet as Partial<OperatorWallet> || {}), unit: "operator_credit", separateFromAiCredits: true },
    operatorTasks: Array.isArray(raw.operatorTasks) ? raw.operatorTasks as OperatorTask[] : [],
    activity: oldActivity,
    approvals: oldApprovals.filter((item) => item?.metadata?.fallback !== true),
  } as VacationWorkspaceState;
}

async function readStore(): Promise<VacationStore> {
  try {
    const parsed = JSON.parse(await readFile(storePath, "utf8")) as { workspaces?: Record<string, Record<string, unknown>> };
    return { version: 2, workspaces: parsed.workspaces as Record<string, VacationWorkspaceState> || {} };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 2, workspaces: {} };
    throw error;
  }
}

async function writeStore(store: VacationStore) {
  await mkdir(dirname(storePath), { recursive: true });
  await writeFile(storePath, JSON.stringify(store, null, 2), "utf8");
}

async function getState(session: AccessSession) {
  const store = await readStore();
  const id = workspaceIdFor(session);
  const state = store.workspaces[id] ? migrateState(store.workspaces[id] as unknown as Record<string, unknown>, session) : freshState(session);
  store.workspaces[id] = state;
  await writeStore(store);
  return { store, state };
}

/** Total paused time for the current away window, including a still-open pause. */
function pausedMsFor(state: VacationWorkspaceState): number {
  let open = 0;
  if (state.enabled && state.paused && state.pausedAt) {
    const since = Date.parse(state.pausedAt);
    if (Number.isFinite(since)) open = Math.max(0, Date.now() - since);
  }
  return state.pausedTotalMs + open;
}

/** Close an open pause span into pausedTotalMs (on resume, deactivate, or auto-end). */
function foldPause(state: VacationWorkspaceState, timestamp: string) {
  if (state.paused && state.pausedAt) {
    const since = Date.parse(state.pausedAt);
    const until = Date.parse(timestamp);
    if (Number.isFinite(since) && Number.isFinite(until)) state.pausedTotalMs += Math.max(0, until - since);
  }
  state.paused = false;
  state.pausedAt = null;
}

function pushActivity(state: VacationWorkspaceState, event: VacationActivity) {
  state.activity.unshift(event);
  state.activity = state.activity.slice(0, 120);
  state.lastActivityAt = event.createdAt;
  state.updatedAt = event.createdAt;
}

async function ledger(session: AccessSession, state: VacationWorkspaceState, event: VacationActivity) {
  const record: HermesLedgerRecord = {
    timestamp: event.createdAt,
    tenant_id: state.workspaceId,
    business_name: businessNameFor(session),
    actor_user_id: session.id,
    actor_role: session.canManageAccess ? "platform_admin" : "business_owner",
    request_id: event.id,
    task_type: `vacation_mode.${event.eventType}`,
    sensitivity_level: event.riskLevel === "urgent" || event.riskLevel === "high" ? "medium" : "low",
    provider_route: "router",
    model_id: "phantomforce-away-coverage",
    context_chars: event.message.length,
    estimated_tokens: 0,
    estimated_cost_usd: null,
    user_request_summary: "Away coverage activity.",
    result_summary: event.message,
    approval_required: event.riskLevel === "urgent" || event.riskLevel === "high",
    approval_status: event.riskLevel === "urgent" || event.riskLevel === "high" ? "pending" : "not_required",
    risks: ["No external action was executed by this status route."],
    next_action: state.enabled ? "Continue coverage and surface emergencies only." : "Away Mode is off.",
    agent_run_id: event.id,
  };
  try { await appendHermesLedgerRecord(record); return true; } catch { return false; }
}

function normalizeCoverage(value: unknown, previous: OperatorCoverage): OperatorCoverage {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const bool = (key: keyof OperatorCoverage) => typeof input[key] === "boolean" ? input[key] as boolean : previous[key] as boolean;
  return {
    enabled: true,
    ownerInterruptionPolicy: input.ownerInterruptionPolicy === "daily_digest" ? "daily_digest" : "emergencies_only",
    allowCalls: bool("allowCalls"),
    allowMeetings: bool("allowMeetings"),
    allowLeadFollowUps: bool("allowLeadFollowUps"),
    allowBookingCoordination: bool("allowBookingCoordination"),
    allowClientMessages: bool("allowClientMessages"),
    dailyCreditLimit: Math.min(100, Math.max(0, Number(input.dailyCreditLimit ?? previous.dailyCreditLimit) || 0)),
    handoffNotes: typeof input.handoffNotes === "string" ? text(input.handoffNotes, 1600) : previous.handoffNotes,
    awayStart: typeof input.awayStart === "string" && input.awayStart ? text(input.awayStart, 50) : null,
    awayEnd: typeof input.awayEnd === "string" && input.awayEnd ? text(input.awayEnd, 50) : null,
    timezone: typeof input.timezone === "string" && input.timezone ? text(input.timezone, 80) : previous.timezone,
  };
}

function normalizePermissions(value: unknown, previous: VacationPermissions): VacationPermissions {
  const input = value && typeof value === "object" ? value as Partial<Record<keyof VacationPermissions, unknown>> : {};
  const next = { ...previous };
  for (const key of Object.keys(next) as Array<keyof VacationPermissions>) if (typeof input[key] === "boolean") next[key] = input[key] as boolean;
  next.requireApprovalForAllOutbound = true;
  next.sendEmailOnlyAfterApproval = true;
  return next;
}

function normalizeSettings(state: VacationWorkspaceState, body: unknown) {
  const input = body && typeof body === "object" ? body as Record<string, unknown> : {};
  state.operatorCoverage = normalizeCoverage(input.operatorCoverage, state.operatorCoverage);
  state.permissions = normalizePermissions(input.permissions, state.permissions);
  if (input.outOfOffice && typeof input.outOfOffice === "object") {
    const ooo = input.outOfOffice as Record<string, unknown>;
    state.outOfOffice = { ...state.outOfOffice, enabled: typeof ooo.enabled === "boolean" ? ooo.enabled : state.outOfOffice.enabled, template: typeof ooo.template === "string" ? text(ooo.template, 1600) : state.outOfOffice.template, startDate: typeof ooo.startDate === "string" && ooo.startDate ? text(ooo.startDate, 50) : null, endDate: typeof ooo.endDate === "string" && ooo.endDate ? text(ooo.endDate, 50) : null, behavior: "queue_for_approval", providerStatus: "not_connected" };
  }
}

async function readiness(state: VacationWorkspaceState, session: AccessSession) {
  const proof = await getHermesLedgerStatus().catch(() => ({ enabled: false, exists: false }));
  const available = state.operatorWallet.included - state.operatorWallet.used - state.operatorWallet.reserved;
  return [
    { id: "workspace", label: "Private workspace", status: "ready", detail: session.canManageAccess ? "Owner workspace verified." : "Client workspace verified and isolated." },
    { id: "coverage", label: "Digital coverage engine", status: "ready", detail: "Check-ins, drafts, safe internal work, exception routing, and proof are available." },
    { id: "operator-queue", label: "Human operator desk", status: humanStaffingReady() ? "ready" : "needs_setup", detail: humanStaffingReady() ? "Human operator staffing is connected." : "Requests can be queued; a staffed operator service still needs to be connected." },
    { id: "credits", label: "Operator Credits", status: available > 0 ? "ready" : "needs_setup", detail: available > 0 ? `${available} human-work credits available, separate from AI credits.` : "Add Operator Credits before requesting human work." },
    { id: "proof", label: "Proof log", status: proof.enabled ? "ready" : "needs_setup", detail: proof.enabled ? "Coverage receipts are available." : "Proof ledger needs setup." },
    { id: "email", label: "Email connector", status: "not_connected", detail: "Email can be planned and drafted, but a sender connector is not active here." },
    { id: "calendar", label: "Calendar connector", status: "not_connected", detail: "Meeting requests can be queued; calendar writes need a connector." },
    { id: "kill-switch", label: "Instant stop", status: "ready", detail: "Turn off Away Mode stops new autonomous coverage immediately." },
  ];
}

function metrics(state: VacationWorkspaceState) {
  return {
    itemsObserved: state.activity.filter((e) => e.eventType === "observed").length,
    draftsCreated: state.activity.filter((e) => e.eventType === "drafted").length,
    approvalsPending: state.approvals.filter((a) => a.status === "pending").length,
    automationsCompleted: state.activity.filter((e) => e.eventType === "completed").length,
    blockedActions: state.activity.filter((e) => e.eventType === "blocked" || e.eventType === "needs_setup").length,
    operatorTasksOpen: state.operatorTasks.filter((task) => ["queued", "assigned", "in_progress", "needs_setup"].includes(task.status)).length,
    lastCheckIn: state.lastCheckInAt,
  };
}

async function queueApprovals(workspaceId: string) {
  const queue = await readApprovalQueueWithTransitions({ limit: 30 }).catch(() => ({ records: [] }));
  return queue.records
    .filter((record) => record.queue_status === "pending" && record.approval.tenant_context.tenant_id === workspaceId)
    .map((record) => ({
    id: record.queue_id,
    workspaceId,
    title: record.approval.summary || record.approval.action_type || "Owner decision needed",
    source: "Approval queue",
    riskLevel: (record.approval.risk_level === "critical" ? "urgent" : record.approval.risk_level || "low") as VacationRiskLevel,
    suggestedAction: "Review only if this cannot safely wait for your return.",
    reason: record.approval.approval_reason || "This action exceeds the active coverage boundary.",
    status: "pending" as const,
    timestamp: record.queued_at,
    metadata: { queue_id: record.queue_id, execution_disabled: true },
    }));
}

export async function getVacationModeStatus(session: AccessSession) {
  const { state } = await getState(session);
  const available = Math.max(0, state.operatorWallet.included - state.operatorWallet.used - state.operatorWallet.reserved);
  return {
    enabled: state.enabled,
    mode: state.enabled ? "hands_off" : "off",
    paused: state.enabled && state.paused,
    pausedAt: state.enabled && state.paused ? state.pausedAt : null,
    pausedMs: pausedMsFor(state),
    startedAt: state.startedAt,
    endedAt: state.endedAt,
    lastActivityAt: state.lastActivityAt,
    lastCheckInAt: state.lastCheckInAt,
    nextCheckInAt: state.nextCheckInAt,
    permissions: state.permissions,
    outOfOffice: state.outOfOffice,
    notificationPreferences: state.notificationPreferences,
    operatorCoverage: state.operatorCoverage,
    operatorWallet: { ...state.operatorWallet, available, costs: TASK_COST },
    readiness: await readiness(state, session),
    metrics: metrics(state),
    operatorQueueReady: true,
    humanStaffingReady: humanStaffingReady(),
    safety: { external_send_performed: false, provider_call_performed: false, high_risk_owner_exception: true, operator_credits_separate_from_ai: true },
  };
}

export async function activateVacationMode(session: AccessSession, body: unknown) {
  const { store, state } = await getState(session);
  normalizeSettings(state, body);
  state.enabled = true;
  state.mode = "hands_off";
  state.operatorCoverage.enabled = true;
  state.paused = false;
  state.pausedAt = null;
  state.pausedTotalMs = 0;
  state.startedAt = now();
  state.endedAt = null;
  state.nextCheckInAt = new Date(Date.now() + checkIntervalMs()).toISOString();
  const event = activity(state.workspaceId, { actor: "User", eventType: "completed", riskLevel: "low", message: "Away Mode is on. Phantom handles approved digital work, the operator desk handles queued human work, and only true exceptions interrupt the owner.", relatedEntity: "Away Mode" });
  pushActivity(state, event);
  await writeStore(store);
  const ledgerWritten = await ledger(session, state, event);
  return { status: await getVacationModeStatus(session), activity: event, ledgerWritten };
}

export async function deactivateVacationMode(session: AccessSession) {
  const { store, state } = await getState(session);
  const endedAt = now();
  foldPause(state, endedAt);
  state.enabled = false;
  state.mode = "off";
  state.endedAt = endedAt;
  state.nextCheckInAt = null;
  const event = activity(state.workspaceId, { actor: "User", eventType: "blocked", riskLevel: "low", message: "Away Mode stopped. No new coverage work will start.", relatedEntity: "Instant stop" });
  pushActivity(state, event);
  await writeStore(store);
  const ledgerWritten = await ledger(session, state, event);
  return { status: await getVacationModeStatus(session), activity: event, ledgerWritten };
}

/** Suspend coverage without ending the away window. Wallet, window, and
 *  settings are untouched; check-ins and new operator queueing stop until
 *  resume. Returns null when Away Mode is not active (nothing to pause). */
export async function pauseVacationMode(session: AccessSession) {
  const { store, state } = await getState(session);
  if (!state.enabled) return null;
  if (!state.paused) {
    state.paused = true;
    state.pausedAt = now();
    state.nextCheckInAt = null;
    const event = activity(state.workspaceId, { actor: "User", eventType: "blocked", riskLevel: "low", message: "Coverage paused — nothing runs until you resume. The away window, Operator Credits, and coverage plan are unchanged.", relatedEntity: "Pause coverage" });
    pushActivity(state, event);
    await writeStore(store);
    const ledgerWritten = await ledger(session, state, event);
    return { status: await getVacationModeStatus(session), activity: event, ledgerWritten };
  }
  await writeStore(store);
  return { status: await getVacationModeStatus(session), activity: null, ledgerWritten: false };
}

/** Resume coverage after a pause. Idempotent when not paused. Returns null
 *  when Away Mode is not active. */
export async function resumeVacationMode(session: AccessSession) {
  const { store, state } = await getState(session);
  if (!state.enabled) return null;
  if (state.paused) {
    const timestamp = now();
    foldPause(state, timestamp);
    state.nextCheckInAt = new Date(Date.now() + checkIntervalMs()).toISOString();
    const event = activity(state.workspaceId, { actor: "User", eventType: "completed", riskLevel: "low", message: "Coverage resumed. Scheduled check-ins and operator queueing are back on; the paused time is not counted as covered.", relatedEntity: "Resume coverage" });
    pushActivity(state, event);
    await writeStore(store);
    const ledgerWritten = await ledger(session, state, event);
    return { status: await getVacationModeStatus(session), activity: event, ledgerWritten };
  }
  await writeStore(store);
  return { status: await getVacationModeStatus(session), activity: null, ledgerWritten: false };
}

export async function updateVacationModeSettings(session: AccessSession, body: unknown) {
  const { store, state } = await getState(session);
  normalizeSettings(state, body);
  const event = activity(state.workspaceId, { actor: "User", eventType: "completed", riskLevel: "low", message: "Away coverage plan updated.", relatedEntity: "Coverage plan" });
  pushActivity(state, event);
  await writeStore(store);
  const ledgerWritten = await ledger(session, state, event);
  return { status: await getVacationModeStatus(session), activity: event, ledgerWritten };
}

export async function getVacationModeActivity(session: AccessSession, limit = 40) {
  const { state } = await getState(session);
  return state.activity.slice(0, Math.min(100, Math.max(1, limit)));
}

export async function getVacationModeApprovals(session: AccessSession, limit = 30) {
  const { state } = await getState(session);
  const all = [...state.approvals, ...await queueApprovals(state.workspaceId)].filter((item) => item.status === "pending");
  const visible = state.enabled ? all.filter((item) => item.riskLevel === "urgent" || item.riskLevel === "high") : all;
  return visible.sort((a, b) => RISK_ORDER[b.riskLevel] - RISK_ORDER[a.riskLevel] || Date.parse(b.timestamp) - Date.parse(a.timestamp)).slice(0, Math.min(50, Math.max(1, limit)));
}

export async function getVacationOperatorTasks(session: AccessSession, limit = 50) {
  const { state } = await getState(session);
  return state.operatorTasks.slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, Math.min(100, Math.max(1, limit)));
}

export async function createVacationOperatorTask(session: AccessSession, body: unknown) {
  const { store, state } = await getState(session);
  const input = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const type = typeof input.type === "string" && Object.prototype.hasOwnProperty.call(TASK_COST, input.type)
    ? input.type as OperatorTaskType
    : "other";
  const title = text(input.title, 180);
  if (!title) throw new Error("Operator task title is required.");
  const creditCost = TASK_COST[type];
  // Bounded-autonomy check: does the owner's coverage plan actually allow
  // this kind of work while they're away? This is checked before the
  // credit-balance check so a policy block never gets misread as a billing
  // problem.
  // Pause enforcement: while coverage is paused, the operator task processor
  // must not accept new work — same enforcement point as the coverage-plan
  // toggles, checked first because it is the broadest suspension.
  const pausedBlocked = state.enabled && state.paused;
  const allowField = TASK_TYPE_ALLOW_FIELD[type];
  const policyBlocked = !pausedBlocked && (allowField ? state.operatorCoverage[allowField] !== true : false);
  const available = state.operatorWallet.included - state.operatorWallet.used - state.operatorWallet.reserved;
  const creditsBlocked = !pausedBlocked && !policyBlocked && available < creditCost;
  const status: OperatorTaskStatus = pausedBlocked || policyBlocked || creditsBlocked ? "blocked" : humanStaffingReady() ? "queued" : "needs_setup";
  const blockedReason: OperatorTask["blockedReason"] = pausedBlocked ? "paused" : policyBlocked ? "policy" : creditsBlocked ? "credits" : null;
  const timestamp = now();
  const task: OperatorTask = { id: `vac-op-${randomUUID()}`, workspaceId: state.workspaceId, type, title, instructions: text(input.instructions, 1800), status, creditCost, scheduledFor: typeof input.scheduledFor === "string" && input.scheduledFor ? text(input.scheduledFor, 60) : null, assignedTo: null, outcome: null, createdAt: timestamp, updatedAt: timestamp, blockedReason };
  if (status !== "blocked") state.operatorWallet.reserved += creditCost;
  state.operatorTasks.unshift(task);
  const message = status === "queued"
    ? `Queued human operator work: ${title}.`
    : status === "needs_setup"
      ? `Saved operator request: ${title}. Human staffing must be connected before assignment.`
      : pausedBlocked
        ? `Blocked operator request: ${title}. Coverage is paused — nothing runs until you resume Away Mode coverage.`
        : policyBlocked
          ? `Blocked operator request: ${title}. "${TASK_TYPE_LABEL[type]}" is turned off in your Away Mode coverage plan — enable it in the coverage plan if you want Phantom to queue this kind of work while you're away.`
          : `Blocked operator request: ${title}. Not enough Operator Credits.`;
  const event = activity(state.workspaceId, { actor: "Workflow", eventType: status === "blocked" ? "blocked" : status === "needs_setup" ? "needs_setup" : "queued_approval", riskLevel: status === "blocked" ? "medium" : "low", message, relatedEntity: title, metadata: { operatorTaskId: task.id, operatorCredits: creditCost, blockedReason } });
  pushActivity(state, event);
  await writeStore(store);
  await ledger(session, state, event);
  return { task, wallet: (await getVacationModeStatus(session)).operatorWallet };
}

export async function cancelVacationOperatorTask(session: AccessSession, id: string) {
  const { store, state } = await getState(session);
  const task = state.operatorTasks.find((item) => item.id === id);
  if (!task) return null;
  if (["queued", "assigned", "in_progress", "needs_setup"].includes(task.status)) state.operatorWallet.reserved = Math.max(0, state.operatorWallet.reserved - task.creditCost);
  task.status = "canceled";
  task.updatedAt = now();
  const event = activity(state.workspaceId, { actor: "User", eventType: "blocked", riskLevel: "low", message: `Canceled operator request: ${task.title}. Reserved credits were released.`, relatedEntity: task.title });
  pushActivity(state, event);
  await writeStore(store);
  await ledger(session, state, event);
  return task;
}

/** "Take over": the owner marks a task owner-handled. Reserved credits are
 *  released and the task is excluded from operator processing for good. */
export async function takeOverVacationOperatorTask(session: AccessSession, id: string) {
  const { store, state } = await getState(session);
  const task = state.operatorTasks.find((item) => item.id === id);
  if (!task) return null;
  if (task.status === "completed" || task.status === "canceled") throw new Error("This request is already closed, so there is nothing to take over.");
  if (task.status !== "taken_over") {
    if (["queued", "assigned", "in_progress", "needs_setup"].includes(task.status)) state.operatorWallet.reserved = Math.max(0, state.operatorWallet.reserved - task.creditCost);
    task.status = "taken_over";
    task.assignedTo = "Owner";
    task.updatedAt = now();
    const event = activity(state.workspaceId, { actor: "User", eventType: "blocked", riskLevel: "low", message: `Owner took over: ${task.title}. The operator desk released it and any reserved credits were returned.`, relatedEntity: task.title, metadata: { operatorTaskId: task.id, takenOver: true } });
    pushActivity(state, event);
    await writeStore(store);
    await ledger(session, state, event);
  }
  return task;
}

export async function updateVacationOperatorTask(session: AccessSession, id: string, body: unknown) {
  const { store, state } = await getState(session);
  const task = state.operatorTasks.find((item) => item.id === id);
  if (!task) return null;
  // Take-over exclusion: once the owner takes a task over, the operator desk
  // may not move it again — it is no longer operator work.
  if (task.status === "taken_over") throw new Error("The owner took this task over; it is no longer operator work.");
  const input = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const status = input.status as OperatorTaskStatus;
  if (!["assigned", "in_progress", "completed", "blocked"].includes(status)) throw new Error("Unsupported operator task status.");
  const wasOpen = ["queued", "assigned", "in_progress", "needs_setup"].includes(task.status);
  if (status === "completed" && wasOpen) {
    state.operatorWallet.reserved = Math.max(0, state.operatorWallet.reserved - task.creditCost);
    state.operatorWallet.used += task.creditCost;
  } else if (status === "blocked" && wasOpen) state.operatorWallet.reserved = Math.max(0, state.operatorWallet.reserved - task.creditCost);
  task.status = status;
  task.assignedTo = typeof input.assignedTo === "string" ? text(input.assignedTo, 120) : task.assignedTo;
  task.outcome = typeof input.outcome === "string" ? text(input.outcome, 1600) : task.outcome;
  task.updatedAt = now();
  const event = activity(state.workspaceId, { actor: "Human Operator", eventType: status === "completed" ? "completed" : status === "blocked" ? "blocked" : "observed", riskLevel: "low", message: `Operator request ${status.replaceAll("_", " ")}: ${task.title}.`, relatedEntity: task.title });
  pushActivity(state, event);
  await writeStore(store);
  await ledger(session, state, event);
  return task;
}

export async function decideVacationApproval(session: AccessSession, approvalId: string, decision: VacationApprovalDecision, note?: string) {
  const { store, state } = await getState(session);
  const local = state.approvals.find((item) => item.id === approvalId);
  if (local) {
    local.status = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "snoozed";
    local.metadata = { ...(local.metadata || {}), note: text(note, 500), execution_disabled: true };
    await writeStore(store);
    return { approval: local, execution_disabled: true };
  }
  const statusMap: Record<VacationApprovalDecision, ApprovalQueueTransitionStatus> = { approve: "reviewed", reject: "dismissed", snooze: "needs_changes" };
  const transition = await appendApprovalQueueTransition({
    queueId: approvalId,
    toStatus: statusMap[decision],
    requestedBy: { actor_user_id: session.id, actor_role: session.canManageAccess ? "platform_admin" : "business_owner" },
    note: text(note || `Away Mode ${decision}. No automatic execution.`, 500),
    /* Non-admin sessions may only decide on their own workspace's queued approvals —
       the shared queue file has no tenant partition, so without this a member of
       any org could transition another org's approval by supplying its queue_id. */
    expectedTenantId: session.canManageAccess ? undefined : state.workspaceId,
  });
  return transition ? { transition, execution_disabled: true } : null;
}

export async function runVacationModeCheckIn(reason = "scheduled") {
  const store = await readStore();
  const timestamp = now();
  let checked = 0;
  let active = 0;
  for (const state of Object.values(store.workspaces)) {
    checked += 1;
    if (!state.enabled) continue;
    active += 1;
    if (state.operatorCoverage.awayEnd && Date.parse(state.operatorCoverage.awayEnd) <= Date.now()) {
      foldPause(state, timestamp);
      state.enabled = false;
      state.mode = "off";
      state.endedAt = timestamp;
      state.nextCheckInAt = null;
      pushActivity(state, activity(state.workspaceId, { actor: "Workflow", eventType: "completed", riskLevel: "low", message: "Away Mode ended at the planned return time.", relatedEntity: "Coverage schedule" }));
      continue;
    }
    // Pause enforcement: a paused workspace gets no coverage checks and no
    // check-in receipts — nothing runs until the owner resumes. Auto-end at
    // the planned return time (above) still applies while paused.
    if (state.paused) continue;
    const pending = await queueApprovals(state.workspaceId);
    const urgent = pending.filter((item) => item.riskLevel === "urgent" || item.riskLevel === "high").length;
    state.lastCheckInAt = timestamp;
    state.nextCheckInAt = new Date(Date.now() + checkIntervalMs()).toISOString();
    pushActivity(state, activity(state.workspaceId, { actor: "Phantom AI", eventType: "observed", riskLevel: urgent ? "high" : "low", message: urgent ? `Coverage check found ${urgent} owner exception${urgent === 1 ? "" : "s"}.` : "Coverage check complete. No owner emergency found.", relatedEntity: reason, metadata: { pendingApprovals: pending.length, ownerExceptions: urgent } }));
  }
  await writeStore(store);
  return { checked, active, timestamp };
}

export function startVacationModeEngine(logger?: { info?: (value: unknown) => void; error?: (value: unknown) => void }) {
  let stopped = false;
  const tick = () => runVacationModeCheckIn("scheduled").catch((error) => logger?.error?.(error));
  void tick();
  const timer = setInterval(tick, checkIntervalMs());
  timer.unref?.();
  logger?.info?.({ vacationModeEngine: "started", intervalMs: checkIntervalMs() });
  return () => { stopped = true; clearInterval(timer); return stopped; };
}

export { TASK_COST as VACATION_OPERATOR_CREDIT_COSTS };
