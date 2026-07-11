import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { AccessSession } from "../access/session.js";
import {
  appendApprovalQueueTransition,
  readApprovalQueueWithTransitions,
} from "./approval-queue.js";
import {
  appendHermesLedgerRecord,
  getHermesLedgerStatus,
  redactSensitiveText,
} from "./hermes-ledger.js";
import type { ApprovalQueueTransitionStatus, HermesLedgerRecord } from "./types.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../../..");
const VACATION_MODE_PATH = process.env.PHANTOMFORCE_VACATION_MODE_PATH
  ? resolve(process.env.PHANTOMFORCE_VACATION_MODE_PATH)
  : resolve(repoRoot, ".phantom", "vacation-mode.json");

export type VacationModeMode = "off" | "hands_off";
export type VacationApprovalDecision = "approve" | "reject" | "snooze";
export type VacationRiskLevel = "low" | "medium" | "high" | "urgent";
export type VacationEventType =
  | "observed"
  | "drafted"
  | "operator_queued"
  | "operator_assigned"
  | "queued_approval"
  | "completed"
  | "blocked"
  | "needs_setup"
  | "notification_sent";

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

export type OperatorTaskType =
  | "phone_call"
  | "attend_meeting"
  | "lead_follow_up"
  | "booking_coordination"
  | "client_message"
  | "research"
  | "exception_triage"
  | "other";

export type OperatorTaskStatus =
  | "needs_setup"
  | "blocked"
  | "queued"
  | "assigned"
  | "in_progress"
  | "completed"
  | "canceled";

export type OperatorTask = {
  id: string;
  workspaceId: string;
  type: OperatorTaskType;
  title: string;
  instructions: string;
  contactName: string;
  scheduledAt: string | null;
  status: OperatorTaskStatus;
  source: "owner" | "phantom" | "workflow";
  sourceId?: string;
  estimatedCredits: number;
  reservedCredits: number;
  actualCredits: number;
  assignedOperator: string | null;
  outcome: string;
  createdAt: string;
  updatedAt: string;
};

type OperatorCoverage = {
  enabled: boolean;
  ownerInterruptionPolicy: "emergencies_only" | "daily_digest";
  allowPhoneCalls: boolean;
  allowMeetings: boolean;
  allowLeadFollowUp: boolean;
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

type VacationOutOfOffice = {
  enabled: boolean;
  template: string;
  startDate: string | null;
  endDate: string | null;
  behavior: "draft_only" | "queue_for_operator" | "send_automatically";
  providerStatus: "not_connected" | "connected_needs_permission" | "ready" | "blocked_by_policy";
};

type VacationNotifications = {
  inApp: boolean;
  emailSummary: boolean;
  urgentOnly: boolean;
  dailyDigest: boolean;
  realTimeActivityFeed: boolean;
};

export type VacationActivity = {
  id: string;
  workspaceId: string;
  actor: "Phantom AI" | "Hermes" | "Workflow" | "Human operator" | "User";
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

type VacationWorkspaceState = {
  workspaceId: string;
  enabled: boolean;
  mode: VacationModeMode;
  startedAt: string | null;
  endedAt: string | null;
  lastActivityAt: string | null;
  lastCheckInAt: string | null;
  permissions: VacationPermissions;
  operatorCoverage: OperatorCoverage;
  operatorWallet: OperatorWallet;
  operatorTasks: OperatorTask[];
  outOfOffice: VacationOutOfOffice;
  notificationPreferences: VacationNotifications;
  activity: VacationActivity[];
  approvals: VacationApproval[];
  createdAt: string;
  updatedAt: string;
};

type VacationStore = {
  version: 2;
  workspaces: Record<string, VacationWorkspaceState>;
};

const DEFAULT_PERMISSIONS: VacationPermissions = {
  watchInbox: true,
  draftEmailReplies: true,
  sendEmailOnlyAfterApproval: false,
  autoReplyToNewMessages: true,
  followUpWithLeads: true,
  updateCrmTasks: true,
  scheduleSocialPosts: true,
  generateContentDrafts: true,
  monitorUrgentItems: true,
  notifyImportantChanges: true,
  allowLowRiskAutomations: true,
  requireApprovalForAllOutbound: false,
};

const DEFAULT_OPERATOR_COVERAGE: OperatorCoverage = {
  enabled: true,
  ownerInterruptionPolicy: "emergencies_only",
  allowPhoneCalls: true,
  allowMeetings: true,
  allowLeadFollowUp: true,
  allowBookingCoordination: true,
  allowClientMessages: true,
  dailyCreditLimit: 10,
  handoffNotes: "Handle routine business work. Contact me only for a true emergency or a decision outside these instructions.",
  awayStart: null,
  awayEnd: null,
  timezone: "America/Chicago",
};

const DEFAULT_OUT_OF_OFFICE: VacationOutOfOffice = {
  enabled: false,
  template:
    "Thanks for reaching out. My PhantomForce operator is covering routine work while I am away and will make sure the right person follows up.",
  startDate: null,
  endDate: null,
  behavior: "queue_for_operator",
  providerStatus: "not_connected",
};

const DEFAULT_NOTIFICATIONS: VacationNotifications = {
  inApp: true,
  emailSummary: false,
  urgentOnly: true,
  dailyDigest: true,
  realTimeActivityFeed: true,
};

const OPERATOR_CREDIT_COST: Record<OperatorTaskType, number> = {
  phone_call: 2,
  attend_meeting: 4,
  lead_follow_up: 1,
  booking_coordination: 1,
  client_message: 1,
  research: 1,
  exception_triage: 1,
  other: 2,
};

const RISK_ORDER: Record<VacationRiskLevel, number> = { urgent: 4, high: 3, medium: 2, low: 1 };

function nowIso() {
  return new Date().toISOString();
}

function safeString(value: unknown, max = 600) {
  return redactSensitiveText(String(value ?? "")).trim().slice(0, max);
}

function workspaceIdFor(session: AccessSession) {
  return session.clientId || session.id || "owner-admin";
}

function businessNameFor(session: AccessSession) {
  if (session.clientId === "client-chicagoshots") return "ChicagoShots";
  if (session.clientId === "client-sports-demo") return "Test Client";
  if (session.clientId) return session.clientId;
  return "PhantomForce";
}

function defaultIncludedCredits(workspaceId: string) {
  const configured = Number(
    workspaceId === "owner-admin"
      ? process.env.PHANTOMFORCE_OWNER_OPERATOR_CREDITS ?? 100
      : process.env.PHANTOMFORCE_DEFAULT_OPERATOR_CREDITS ?? 0,
  );
  return Number.isFinite(configured) ? Math.max(0, Math.floor(configured)) : 0;
}

function operatorNetworkReady() {
  return process.env.PHANTOMFORCE_HUMAN_OPERATOR_ENABLED === "true";
}

function operatorDeskName() {
  return safeString(process.env.PHANTOMFORCE_OPERATOR_DESK_NAME || "PhantomForce Operator Desk", 80);
}

function operatorAvailable(wallet: OperatorWallet) {
  return Math.max(0, wallet.included - wallet.used - wallet.reserved);
}

function createActivity(
  workspaceId: string,
  input: Omit<VacationActivity, "id" | "workspaceId" | "createdAt">,
): VacationActivity {
  return {
    id: `vac-act-${randomUUID()}`,
    workspaceId,
    createdAt: nowIso(),
    ...input,
    message: safeString(input.message, 900),
    relatedEntity: input.relatedEntity ? safeString(input.relatedEntity, 180) : undefined,
  };
}

function createWorkspaceState(session: AccessSession): VacationWorkspaceState {
  const workspaceId = workspaceIdFor(session);
  const createdAt = nowIso();
  return {
    workspaceId,
    enabled: false,
    mode: "off",
    startedAt: null,
    endedAt: null,
    lastActivityAt: createdAt,
    lastCheckInAt: null,
    permissions: { ...DEFAULT_PERMISSIONS },
    operatorCoverage: { ...DEFAULT_OPERATOR_COVERAGE },
    operatorWallet: {
      included: defaultIncludedCredits(workspaceId),
      used: 0,
      reserved: 0,
      unit: "operator_credit",
      separateFromAiCredits: true,
    },
    operatorTasks: [],
    outOfOffice: { ...DEFAULT_OUT_OF_OFFICE },
    notificationPreferences: { ...DEFAULT_NOTIFICATIONS },
    activity: [],
    approvals: [],
    createdAt,
    updatedAt: createdAt,
  };
}

function migrateWorkspace(raw: Partial<VacationWorkspaceState> & Record<string, unknown>, workspaceId: string) {
  const base = createWorkspaceState({
    id: workspaceId,
    label: workspaceId,
    role: workspaceId === "owner-admin" ? "admin" : "client",
    clientId: workspaceId === "owner-admin" ? undefined : workspaceId,
    canManageAccess: workspaceId === "owner-admin",
  });
  const rawWallet = raw.operatorWallet && typeof raw.operatorWallet === "object"
    ? raw.operatorWallet as Partial<OperatorWallet>
    : {};
  const rawTasks = Array.isArray(raw.operatorTasks) ? raw.operatorTasks as OperatorTask[] : [];
  const rawApprovals = Array.isArray(raw.approvals) ? raw.approvals as VacationApproval[] : [];
  const rawActivity = Array.isArray(raw.activity) ? raw.activity as VacationActivity[] : [];
  return {
    ...base,
    ...raw,
    workspaceId,
    enabled: raw.enabled === true,
    mode: raw.enabled === true ? "hands_off" as const : "off" as const,
    permissions: { ...DEFAULT_PERMISSIONS, ...(raw.permissions || {}) },
    operatorCoverage: { ...DEFAULT_OPERATOR_COVERAGE, ...(raw.operatorCoverage || {}) },
    operatorWallet: {
      ...base.operatorWallet,
      ...rawWallet,
      included: Math.max(0, Number(rawWallet.included ?? base.operatorWallet.included) || 0),
      used: Math.max(0, Number(rawWallet.used ?? 0) || 0),
      reserved: Math.max(0, Number(rawWallet.reserved ?? 0) || 0),
      unit: "operator_credit" as const,
      separateFromAiCredits: true as const,
    },
    operatorTasks: rawTasks.filter((task) => task && typeof task.id === "string").slice(0, 200),
    outOfOffice: { ...DEFAULT_OUT_OF_OFFICE, ...(raw.outOfOffice || {}) },
    notificationPreferences: { ...DEFAULT_NOTIFICATIONS, ...(raw.notificationPreferences || {}) },
    activity: rawActivity.filter((event) => event && typeof event.id === "string").slice(0, 200),
    approvals: rawApprovals
      .filter((approval) => approval && typeof approval.id === "string" && approval.metadata?.fallback !== true)
      .slice(0, 100),
    lastCheckInAt: typeof raw.lastCheckInAt === "string" ? raw.lastCheckInAt : null,
  } satisfies VacationWorkspaceState;
}

async function readStore(): Promise<VacationStore> {
  try {
    const raw = await readFile(VACATION_MODE_PATH, "utf8");
    const parsed = JSON.parse(raw) as { version?: number; workspaces?: Record<string, Record<string, unknown>> };
    const workspaces: Record<string, VacationWorkspaceState> = {};
    for (const [workspaceId, state] of Object.entries(parsed?.workspaces || {})) {
      workspaces[workspaceId] = migrateWorkspace(state as Partial<VacationWorkspaceState> & Record<string, unknown>, workspaceId);
    }
    return { version: 2, workspaces };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 2, workspaces: {} };
    throw error;
  }
}

async function writeStore(store: VacationStore) {
  await mkdir(dirname(VACATION_MODE_PATH), { recursive: true });
  await writeFile(VACATION_MODE_PATH, JSON.stringify(store, null, 2), "utf8");
}

async function getWorkspaceState(session: AccessSession) {
  const store = await readStore();
  const workspaceId = workspaceIdFor(session);
  if (!store.workspaces[workspaceId]) store.workspaces[workspaceId] = createWorkspaceState(session);
  store.workspaces[workspaceId] = migrateWorkspace(store.workspaces[workspaceId], workspaceId);
  await writeStore(store);
  return { store, state: store.workspaces[workspaceId] };
}

function normalizePermissions(value: unknown, previous: VacationPermissions): VacationPermissions {
  const input = value && typeof value === "object" ? (value as Partial<Record<keyof VacationPermissions, unknown>>) : {};
  const next = { ...previous };
  for (const key of Object.keys(next) as Array<keyof VacationPermissions>) {
    if (typeof input[key] === "boolean") next[key] = input[key];
  }
  return next;
}

function normalizeOperatorCoverage(value: unknown, previous: OperatorCoverage): OperatorCoverage {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const booleanKeys: Array<keyof Pick<OperatorCoverage,
    "enabled" | "allowPhoneCalls" | "allowMeetings" | "allowLeadFollowUp" | "allowBookingCoordination" | "allowClientMessages"
  >> = ["enabled", "allowPhoneCalls", "allowMeetings", "allowLeadFollowUp", "allowBookingCoordination", "allowClientMessages"];
  const next = { ...previous };
  for (const key of booleanKeys) if (typeof input[key] === "boolean") next[key] = input[key] as never;
  if (input.ownerInterruptionPolicy === "daily_digest" || input.ownerInterruptionPolicy === "emergencies_only") {
    next.ownerInterruptionPolicy = input.ownerInterruptionPolicy;
  }
  if (typeof input.dailyCreditLimit === "number" && Number.isFinite(input.dailyCreditLimit)) {
    next.dailyCreditLimit = Math.min(100, Math.max(1, Math.floor(input.dailyCreditLimit)));
  }
  if (typeof input.handoffNotes === "string") next.handoffNotes = safeString(input.handoffNotes, 2400);
  if (typeof input.awayStart === "string") next.awayStart = input.awayStart ? safeString(input.awayStart, 40) : null;
  if (typeof input.awayEnd === "string") next.awayEnd = input.awayEnd ? safeString(input.awayEnd, 40) : null;
  if (typeof input.timezone === "string" && input.timezone.trim()) next.timezone = safeString(input.timezone, 80);
  return next;
}

function normalizeOutOfOffice(value: unknown, previous: VacationOutOfOffice): VacationOutOfOffice {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const behavior = input.behavior === "draft_only" || input.behavior === "queue_for_operator" || input.behavior === "send_automatically"
    ? input.behavior
    : previous.behavior;
  const providerReady = process.env.PHANTOMFORCE_EMAIL_CONNECTOR_READY === "true";
  return {
    ...previous,
    enabled: typeof input.enabled === "boolean" ? input.enabled : previous.enabled,
    template: typeof input.template === "string" ? safeString(input.template, 1600) : previous.template,
    startDate: typeof input.startDate === "string" && input.startDate ? safeString(input.startDate, 40) : null,
    endDate: typeof input.endDate === "string" && input.endDate ? safeString(input.endDate, 40) : null,
    behavior: behavior === "send_automatically" && !providerReady ? "queue_for_operator" : behavior,
    providerStatus: providerReady ? "ready" : "not_connected",
  };
}

function normalizeNotifications(value: unknown, previous: VacationNotifications): VacationNotifications {
  const input = value && typeof value === "object" ? value as Partial<Record<keyof VacationNotifications, unknown>> : {};
  const next = { ...previous };
  for (const key of Object.keys(next) as Array<keyof VacationNotifications>) {
    if (typeof input[key] === "boolean") next[key] = input[key];
  }
  next.inApp = true;
  return next;
}

function normalizeTaskType(value: unknown): OperatorTaskType | null {
  const allowed: OperatorTaskType[] = [
    "phone_call", "attend_meeting", "lead_follow_up", "booking_coordination",
    "client_message", "research", "exception_triage", "other",
  ];
  return typeof value === "string" && allowed.includes(value as OperatorTaskType) ? value as OperatorTaskType : null;
}

function taskAllowed(coverage: OperatorCoverage, type: OperatorTaskType) {
  if (!coverage.enabled) return false;
  if (type === "phone_call") return coverage.allowPhoneCalls;
  if (type === "attend_meeting") return coverage.allowMeetings;
  if (type === "lead_follow_up") return coverage.allowLeadFollowUp;
  if (type === "booking_coordination") return coverage.allowBookingCoordination;
  if (type === "client_message") return coverage.allowClientMessages;
  return true;
}

async function recordLedger(session: AccessSession, state: VacationWorkspaceState, event: VacationActivity) {
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
    model_id: "phantomforce-vacation-mode",
    context_chars: event.message.length,
    estimated_tokens: 0,
    estimated_cost_usd: null,
    user_request_summary: "Vacation Mode state change or operator activity.",
    result_summary: event.message,
    approval_required: event.riskLevel === "urgent" || event.riskLevel === "high",
    approval_status: event.riskLevel === "urgent" || event.riskLevel === "high" ? "pending" : "not_required",
    risks: ["External provider execution is handled by its connector policy, not this state route."],
    next_action: state.enabled ? "Continue hands-off coverage and operator triage." : "Vacation Mode is off.",
    agent_run_id: event.id,
  };
  try {
    await appendHermesLedgerRecord(record);
    return true;
  } catch {
    return false;
  }
}

function pushActivity(state: VacationWorkspaceState, activity: VacationActivity) {
  state.activity.unshift(activity);
  state.activity = state.activity.slice(0, 200);
  state.lastActivityAt = activity.createdAt;
  state.updatedAt = activity.createdAt;
}

async function existingApprovalQueueRecords(workspaceId: string) {
  const queue = await readApprovalQueueWithTransitions({ limit: 50 }).catch(() => ({ records: [] }));
  return queue.records
    .filter((record) => record.queue_status === "pending")
    .map((record) => {
      const riskLevel: VacationRiskLevel = record.approval.risk_level === "critical"
        ? "urgent"
        : record.approval.risk_level === "high"
          ? "high"
          : record.approval.risk_level === "medium" ? "medium" : "low";
      return {
        id: record.queue_id,
        workspaceId,
        title: record.approval.summary || record.approval.action_type || "Exception needs review",
        source: "Approval queue",
        riskLevel,
        suggestedAction: riskLevel === "urgent" || riskLevel === "high"
          ? "Owner decision required."
          : "Route to the operator desk.",
        reason: record.approval.approval_reason || "This action crossed its configured limit.",
        status: "pending" as const,
        timestamp: record.queued_at,
        metadata: { queue_id: record.queue_id, source: "hermes_approval_queue" },
      };
    });
}

async function readinessFor(state: VacationWorkspaceState, session: AccessSession) {
  const ledger = await getHermesLedgerStatus().catch(() => ({ enabled: false, exists: false, bytes: 0 }));
  const available = operatorAvailable(state.operatorWallet);
  const humanReady = operatorNetworkReady();
  return [
    {
      id: "workspace-auth",
      label: "Workspace authenticated",
      status: "ready",
      detail: session.canManageAccess ? "Owner control verified." : "Client workspace access verified.",
    },
    {
      id: "coverage-engine",
      label: "Hands-off coverage engine",
      status: "ready",
      detail: "Server check-ins continue while Vacation Mode is active.",
    },
    {
      id: "operator-queue",
      label: "Operator task queue",
      status: "ready",
      detail: "Calls, meetings, follow-ups, and exceptions can be queued with proof.",
    },
    {
      id: "operator-staffing",
      label: "Live human operator staffing",
      status: humanReady ? "ready" : "needs_setup",
      detail: humanReady ? `${operatorDeskName()} is accepting assignments.` : "Queue is ready; live operator staffing is not connected on this host yet.",
    },
    {
      id: "operator-credits",
      label: "Operator credits",
      status: available > 0 ? "ready" : "needs_setup",
      detail: available > 0 ? `${available} separate operator credits available.` : "Add operator credits before assigning human work.",
    },
    {
      id: "hermes-ledger",
      label: "Proof ledger",
      status: ledger.enabled ? "ready" : "needs_setup",
      detail: ledger.enabled ? "State changes and decisions are recorded." : "Proof ledger is unavailable.",
    },
    {
      id: "email",
      label: "Email connector",
      status: process.env.PHANTOMFORCE_EMAIL_CONNECTOR_READY === "true" ? "ready" : "not_connected",
      detail: process.env.PHANTOMFORCE_EMAIL_CONNECTOR_READY === "true"
        ? "Email work can follow the configured connector policy."
        : "Email drafts can be prepared; sending is unavailable until connected.",
    },
    {
      id: "calendar",
      label: "Calendar connector",
      status: process.env.PHANTOMFORCE_CALENDAR_CONNECTOR_READY === "true" ? "ready" : "not_connected",
      detail: process.env.PHANTOMFORCE_CALENDAR_CONNECTOR_READY === "true"
        ? "Meeting and booking context is available."
        : "Meeting tasks can be queued, but calendar access is not connected.",
    },
    {
      id: "kill-switch",
      label: "Instant stop",
      status: "ready",
      detail: "Turning Vacation Mode off stops new away-coverage assignments immediately.",
    },
  ];
}

function metricsFor(state: VacationWorkspaceState) {
  const events = state.activity;
  return {
    itemsObserved: events.filter((event) => event.eventType === "observed").length,
    digitalWorkCompleted: events.filter((event) => event.eventType === "completed").length,
    ownerInterruptions: state.approvals.filter((approval) => approval.status === "pending" && (approval.riskLevel === "urgent" || approval.riskLevel === "high")).length,
    operatorTasksQueued: state.operatorTasks.filter((task) => ["queued", "assigned", "in_progress"].includes(task.status)).length,
    operatorTasksCompleted: state.operatorTasks.filter((task) => task.status === "completed").length,
    operatorCreditsAvailable: operatorAvailable(state.operatorWallet),
    blockedActions: events.filter((event) => event.eventType === "blocked" || event.eventType === "needs_setup").length,
    lastCheckIn: state.lastCheckInAt || state.lastActivityAt,
  };
}

function publicOperatorState(state: VacationWorkspaceState) {
  return {
    coverage: state.operatorCoverage,
    wallet: {
      ...state.operatorWallet,
      available: operatorAvailable(state.operatorWallet),
    },
    network: {
      queueReady: true,
      humanStaffingReady: operatorNetworkReady(),
      deskName: operatorDeskName(),
    },
    creditCosts: OPERATOR_CREDIT_COST,
  };
}

export async function getVacationModeStatus(session: AccessSession) {
  const { state } = await getWorkspaceState(session);
  return {
    enabled: state.enabled,
    mode: state.enabled ? state.mode : "off",
    startedAt: state.startedAt,
    endedAt: state.endedAt,
    lastActivityAt: state.lastActivityAt,
    lastCheckInAt: state.lastCheckInAt,
    permissions: state.permissions,
    operator: publicOperatorState(state),
    outOfOffice: state.outOfOffice,
    notificationPreferences: state.notificationPreferences,
    readiness: await readinessFor(state, session),
    metrics: metricsFor(state),
    safety: {
      hands_off: state.enabled,
      owner_interruption_policy: state.operatorCoverage.ownerInterruptionPolicy,
      operator_credits_separate_from_ai_credits: true,
      high_risk_owner_escalation: true,
      destructive_actions_allowed: false,
      connector_policies_still_apply: true,
    },
  };
}

export async function activateVacationMode(session: AccessSession, body: unknown) {
  const { store, state } = await getWorkspaceState(session);
  const input = body && typeof body === "object" ? body as Record<string, unknown> : {};
  state.enabled = true;
  state.mode = "hands_off";
  state.permissions = normalizePermissions(input.permissions, state.permissions);
  state.operatorCoverage = normalizeOperatorCoverage(input.operatorCoverage, state.operatorCoverage);
  state.outOfOffice = normalizeOutOfOffice(input.outOfOffice, state.outOfOffice);
  state.notificationPreferences = normalizeNotifications(input.notificationPreferences, state.notificationPreferences);
  state.startedAt = nowIso();
  state.endedAt = null;
  const activity = createActivity(state.workspaceId, {
    actor: "User",
    eventType: "completed",
    riskLevel: "low",
    message: "Hands-off coverage activated. Phantom handles permitted digital work, the operator desk receives human tasks, and the owner is interrupted only for configured emergencies.",
    relatedEntity: "Vacation Mode",
  });
  pushActivity(state, activity);
  await writeStore(store);
  const ledgerWritten = await recordLedger(session, state, activity);
  return { status: await getVacationModeStatus(session), activity, ledgerWritten };
}

export async function deactivateVacationMode(session: AccessSession) {
  const { store, state } = await getWorkspaceState(session);
  state.enabled = false;
  state.mode = "off";
  state.endedAt = nowIso();
  const activity = createActivity(state.workspaceId, {
    actor: "User",
    eventType: "blocked",
    riskLevel: "low",
    message: "Vacation Mode turned off. New away-coverage work and operator assignments stopped immediately; existing operator tasks remain visible for clean handoff.",
    relatedEntity: "Instant stop",
  });
  pushActivity(state, activity);
  await writeStore(store);
  const ledgerWritten = await recordLedger(session, state, activity);
  return { status: await getVacationModeStatus(session), activity, ledgerWritten };
}

export async function updateVacationModeSettings(session: AccessSession, body: unknown) {
  const { store, state } = await getWorkspaceState(session);
  const input = body && typeof body === "object" ? body as Record<string, unknown> : {};
  state.permissions = normalizePermissions(input.permissions, state.permissions);
  state.operatorCoverage = normalizeOperatorCoverage(input.operatorCoverage, state.operatorCoverage);
  state.outOfOffice = normalizeOutOfOffice(input.outOfOffice, state.outOfOffice);
  state.notificationPreferences = normalizeNotifications(input.notificationPreferences, state.notificationPreferences);
  const activity = createActivity(state.workspaceId, {
    actor: "User",
    eventType: "completed",
    riskLevel: "low",
    message: "Vacation coverage instructions saved. Operator credits remain separate from AI credits.",
    relatedEntity: "Coverage plan",
  });
  pushActivity(state, activity);
  await writeStore(store);
  const ledgerWritten = await recordLedger(session, state, activity);
  return { status: await getVacationModeStatus(session), activity, ledgerWritten };
}

export async function createVacationOperatorTask(session: AccessSession, body: unknown) {
  const { store, state } = await getWorkspaceState(session);
  const input = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const type = normalizeTaskType(input.type);
  const title = safeString(input.title || input.instructions, 160);
  const instructions = safeString(input.instructions, 1600);
  if (!type || !title || !instructions) return null;
  const estimatedCredits = OPERATOR_CREDIT_COST[type];
  const available = operatorAvailable(state.operatorWallet);
  const allowed = taskAllowed(state.operatorCoverage, type);
  const status: OperatorTaskStatus = !allowed
    ? "blocked"
    : available < estimatedCredits
      ? "blocked"
      : "queued";
  const reservedCredits = status === "queued" ? estimatedCredits : 0;
  if (reservedCredits) state.operatorWallet.reserved += reservedCredits;
  const task: OperatorTask = {
    id: `vac-op-${randomUUID()}`,
    workspaceId: state.workspaceId,
    type,
    title,
    instructions,
    contactName: safeString(input.contactName, 120),
    scheduledAt: typeof input.scheduledAt === "string" && input.scheduledAt ? safeString(input.scheduledAt, 60) : null,
    status,
    source: input.source === "phantom" || input.source === "workflow" ? input.source : "owner",
    sourceId: typeof input.sourceId === "string" ? safeString(input.sourceId, 160) : undefined,
    estimatedCredits,
    reservedCredits,
    actualCredits: 0,
    assignedOperator: null,
    outcome: "",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  state.operatorTasks.unshift(task);
  state.operatorTasks = state.operatorTasks.slice(0, 200);
  const activity = createActivity(state.workspaceId, {
    actor: task.source === "owner" ? "User" : "Phantom AI",
    eventType: status === "queued" ? "operator_queued" : "blocked",
    riskLevel: status === "queued" ? "low" : "medium",
    message: status === "queued"
      ? `${task.title} queued for human operator coverage. ${estimatedCredits} operator credit${estimatedCredits === 1 ? "" : "s"} reserved; AI credits were not used.`
      : `${task.title} could not be queued: ${allowed ? "not enough operator credits" : "this task type is disabled in the coverage plan"}.`,
    relatedEntity: task.id,
    metadata: { operator_task_id: task.id, operator_credits: estimatedCredits, ai_credits: 0 },
  });
  pushActivity(state, activity);
  await writeStore(store);
  const ledgerWritten = await recordLedger(session, state, activity);
  return { task, activity, ledgerWritten, operator: publicOperatorState(state) };
}

export async function getVacationOperatorTasks(session: AccessSession, limit = 40) {
  const { state } = await getWorkspaceState(session);
  const cleanLimit = Number.isFinite(limit) ? Math.min(Math.max(Math.floor(limit), 1), 100) : 40;
  return state.operatorTasks.slice(0, cleanLimit);
}

export async function cancelVacationOperatorTask(session: AccessSession, taskId: string) {
  const { store, state } = await getWorkspaceState(session);
  const task = state.operatorTasks.find((item) => item.id === taskId);
  if (!task || ["completed", "canceled"].includes(task.status)) return null;
  state.operatorWallet.reserved = Math.max(0, state.operatorWallet.reserved - task.reservedCredits);
  task.reservedCredits = 0;
  task.status = "canceled";
  task.updatedAt = nowIso();
  const activity = createActivity(state.workspaceId, {
    actor: "User",
    eventType: "blocked",
    riskLevel: "low",
    message: `Canceled operator task: ${task.title}. Reserved operator credits were released.`,
    relatedEntity: task.id,
  });
  pushActivity(state, activity);
  await writeStore(store);
  const ledgerWritten = await recordLedger(session, state, activity);
  return { task, activity, ledgerWritten, operator: publicOperatorState(state) };
}

export async function updateVacationOperatorTask(
  session: AccessSession,
  taskId: string,
  body: unknown,
) {
  const { store, state } = await getWorkspaceState(session);
  const task = state.operatorTasks.find((item) => item.id === taskId);
  if (!task) return null;
  const input = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const allowedStatuses: OperatorTaskStatus[] = ["assigned", "in_progress", "completed", "blocked", "canceled"];
  const nextStatus = typeof input.status === "string" && allowedStatuses.includes(input.status as OperatorTaskStatus)
    ? input.status as OperatorTaskStatus
    : null;
  if (!nextStatus) return null;
  if (nextStatus === "completed" && task.status !== "completed") {
    const actual = typeof input.actualCredits === "number" && Number.isFinite(input.actualCredits)
      ? Math.max(0, Math.min(100, Math.floor(input.actualCredits)))
      : task.estimatedCredits;
    state.operatorWallet.reserved = Math.max(0, state.operatorWallet.reserved - task.reservedCredits);
    state.operatorWallet.used += actual;
    task.reservedCredits = 0;
    task.actualCredits = actual;
  } else if ((nextStatus === "blocked" || nextStatus === "canceled") && task.reservedCredits) {
    state.operatorWallet.reserved = Math.max(0, state.operatorWallet.reserved - task.reservedCredits);
    task.reservedCredits = 0;
  }
  task.status = nextStatus;
  task.assignedOperator = typeof input.assignedOperator === "string" ? safeString(input.assignedOperator, 100) : task.assignedOperator;
  task.outcome = typeof input.outcome === "string" ? safeString(input.outcome, 1400) : task.outcome;
  task.updatedAt = nowIso();
  const activity = createActivity(state.workspaceId, {
    actor: "Human operator",
    eventType: nextStatus === "completed" ? "completed" : nextStatus === "assigned" || nextStatus === "in_progress" ? "operator_assigned" : "blocked",
    riskLevel: "low",
    message: nextStatus === "completed"
      ? `Human operator completed: ${task.title}. ${task.actualCredits} operator credit${task.actualCredits === 1 ? "" : "s"} used.`
      : `Operator task ${task.title} changed to ${nextStatus.replace(/_/g, " ")}.`,
    relatedEntity: task.id,
  });
  pushActivity(state, activity);
  await writeStore(store);
  const ledgerWritten = await recordLedger(session, state, activity);
  return { task, activity, ledgerWritten, operator: publicOperatorState(state) };
}

export async function getVacationModeActivity(session: AccessSession, limit = 40) {
  const { state } = await getWorkspaceState(session);
  const cleanLimit = Number.isFinite(limit) ? Math.min(Math.max(Math.floor(limit), 1), 100) : 40;
  return state.activity.slice(0, cleanLimit);
}

export async function getVacationModeApprovals(session: AccessSession, limit = 30) {
  const { state } = await getWorkspaceState(session);
  const existing = await existingApprovalQueueRecords(state.workspaceId);
  return [...state.approvals, ...existing]
    .filter((approval) => approval.status === "pending")
    .filter((approval) => !state.enabled || approval.riskLevel === "urgent" || approval.riskLevel === "high")
    .sort((a, b) => RISK_ORDER[b.riskLevel] - RISK_ORDER[a.riskLevel] || new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, Math.min(Math.max(Math.floor(limit), 1), 50));
}

export async function decideVacationApproval(
  session: AccessSession,
  approvalId: string,
  decision: VacationApprovalDecision,
  note?: string,
) {
  const { store, state } = await getWorkspaceState(session);
  const safeNote = safeString(note || "", 500);
  const local = state.approvals.find((approval) => approval.id === approvalId);
  if (local) {
    local.status = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "snoozed";
    local.metadata = { ...(local.metadata || {}), last_note: safeNote };
    await writeStore(store);
    return { approval: local, execution_disabled: true };
  }
  const statusMap: Record<VacationApprovalDecision, ApprovalQueueTransitionStatus> = {
    approve: "reviewed",
    reject: "dismissed",
    snooze: "needs_changes",
  };
  const transition = await appendApprovalQueueTransition({
    queueId: approvalId,
    toStatus: statusMap[decision],
    requestedBy: {
      actor_user_id: session.id,
      actor_role: session.canManageAccess ? "platform_admin" : "business_owner",
    },
    note: safeNote || `Vacation Mode emergency decision: ${decision}.`,
  });
  if (!transition) return null;
  const activity = createActivity(state.workspaceId, {
    actor: "User",
    eventType: "queued_approval",
    riskLevel: "high",
    message: `Owner recorded emergency decision "${decision}" for ${approvalId}. Connector policy still controls execution.`,
    relatedEntity: approvalId,
  });
  pushActivity(state, activity);
  await writeStore(store);
  const ledgerWritten = await recordLedger(session, state, activity);
  return { transition, activity, ledgerWritten, execution_disabled: true };
}

export async function runVacationModeCheckIn(reason = "scheduled") {
  const store = await readStore();
  const checkedAt = nowIso();
  let workspacesChecked = 0;
  let tasksQueued = 0;
  for (const state of Object.values(store.workspaces)) {
    if (!state.enabled) continue;
    workspacesChecked += 1;
    const coverage = state.operatorCoverage;
    if (coverage.awayEnd && new Date(coverage.awayEnd).getTime() <= Date.now()) {
      state.enabled = false;
      state.mode = "off";
      state.endedAt = checkedAt;
      pushActivity(state, createActivity(state.workspaceId, {
        actor: "Workflow",
        eventType: "completed",
        riskLevel: "low",
        message: "Vacation Mode ended automatically at the configured return time.",
        relatedEntity: "Coverage schedule",
      }));
      continue;
    }

    const approvals = await existingApprovalQueueRecords(state.workspaceId);
    const routine = approvals.filter((item) => item.riskLevel === "low" || item.riskLevel === "medium");
    for (const approval of routine) {
      if (state.operatorTasks.some((task) => task.sourceId === approval.id && task.status !== "canceled")) continue;
      if (operatorAvailable(state.operatorWallet) < OPERATOR_CREDIT_COST.exception_triage) break;
      const task: OperatorTask = {
        id: `vac-op-${randomUUID()}`,
        workspaceId: state.workspaceId,
        type: "exception_triage",
        title: `Triage: ${safeString(approval.title, 130)}`,
        instructions: safeString(`${approval.reason} ${approval.suggestedAction}`, 1200),
        contactName: "",
        scheduledAt: null,
        status: "queued",
        source: "phantom",
        sourceId: approval.id,
        estimatedCredits: 1,
        reservedCredits: 1,
        actualCredits: 0,
        assignedOperator: null,
        outcome: "",
        createdAt: checkedAt,
        updatedAt: checkedAt,
      };
      state.operatorWallet.reserved += 1;
      state.operatorTasks.unshift(task);
      tasksQueued += 1;
    }
    state.lastCheckInAt = checkedAt;
    pushActivity(state, createActivity(state.workspaceId, {
      actor: "Phantom AI",
      eventType: "observed",
      riskLevel: "low",
      message: `Hands-off check-in complete: ${approvals.length} exception${approvals.length === 1 ? "" : "s"} inspected, ${routine.length} routine item${routine.length === 1 ? "" : "s"} eligible for operator handling, ${state.operatorTasks.filter((task) => ["queued", "assigned", "in_progress"].includes(task.status)).length} operator task${state.operatorTasks.filter((task) => ["queued", "assigned", "in_progress"].includes(task.status)).length === 1 ? "" : "s"} open.`,
      relatedEntity: "Vacation Mode check-in",
      metadata: { reason, approvals_inspected: approvals.length, routine_items: routine.length },
    }));
  }
  await writeStore(store);
  return { ok: true, checkedAt, workspacesChecked, tasksQueued };
}

export function startVacationModeEngine(log?: { info?: (value: unknown) => void; warn?: (value: unknown) => void }) {
  const configured = Number(process.env.PHANTOMFORCE_VACATION_CHECK_INTERVAL_MS ?? 5 * 60 * 1000);
  const intervalMs = Number.isFinite(configured) ? Math.max(30_000, Math.floor(configured)) : 5 * 60 * 1000;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await runVacationModeCheckIn("scheduled");
      if (result.workspacesChecked) log?.info?.({ vacationMode: result });
    } catch (error) {
      log?.warn?.({ vacationMode: "check_in_failed", error: error instanceof Error ? error.message : "unknown" });
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  void tick();
  return () => clearInterval(timer);
}
