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
const VACATION_MODE_PATH = resolve(repoRoot, ".phantom", "vacation-mode.json");

export type VacationModeMode = "off" | "draft_only" | "approval_required" | "limited_autopilot";
export type VacationApprovalDecision = "approve" | "reject" | "snooze";
export type VacationRiskLevel = "low" | "medium" | "high" | "urgent";
export type VacationEventType =
  | "observed"
  | "drafted"
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

type VacationOutOfOffice = {
  enabled: boolean;
  template: string;
  startDate: string | null;
  endDate: string | null;
  behavior: "draft_only" | "queue_for_approval" | "send_automatically";
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
  actor: "Phantom AI" | "Hermes" | "Workflow" | "User";
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
  permissions: VacationPermissions;
  outOfOffice: VacationOutOfOffice;
  notificationPreferences: VacationNotifications;
  activity: VacationActivity[];
  approvals: VacationApproval[];
  createdAt: string;
  updatedAt: string;
};

type VacationStore = {
  version: 1;
  workspaces: Record<string, VacationWorkspaceState>;
};

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
  allowLowRiskAutomations: false,
  requireApprovalForAllOutbound: true,
};

const DEFAULT_OUT_OF_OFFICE: VacationOutOfOffice = {
  enabled: false,
  template:
    "Thanks for reaching out. I am away right now, but PhantomForce is watching for urgent items. I will review anything that needs my approval.",
  startDate: null,
  endDate: null,
  behavior: "draft_only",
  providerStatus: "not_connected",
};

const DEFAULT_NOTIFICATIONS: VacationNotifications = {
  inApp: true,
  emailSummary: false,
  urgentOnly: true,
  dailyDigest: true,
  realTimeActivityFeed: true,
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

async function readStore(): Promise<VacationStore> {
  try {
    const raw = await readFile(VACATION_MODE_PATH, "utf8");
    const parsed = JSON.parse(raw) as VacationStore;
    return {
      version: 1,
      workspaces: parsed?.workspaces && typeof parsed.workspaces === "object" ? parsed.workspaces : {},
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, workspaces: {} };
    throw error;
  }
}

async function writeStore(store: VacationStore) {
  await mkdir(dirname(VACATION_MODE_PATH), { recursive: true });
  await writeFile(VACATION_MODE_PATH, JSON.stringify(store, null, 2), "utf8");
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

function seedApprovals(workspaceId: string): VacationApproval[] {
  const ts = nowIso();
  return [
    {
      id: `vac-appr-${randomUUID()}`,
      workspaceId,
      title: "Client asked for same-day booking",
      source: "Vacation Mode local approval fallback",
      riskLevel: "urgent",
      suggestedAction: "Review the drafted response before anything is sent.",
      reason: "Same-day booking changes can affect schedule, pricing, and client expectations.",
      status: "pending",
      timestamp: ts,
      metadata: { fallback: true, external_send_allowed: false },
    },
    {
      id: `vac-appr-${randomUUID()}`,
      workspaceId,
      title: "Lead follow-up drafted",
      source: "Vacation Mode local approval fallback",
      riskLevel: "medium",
      suggestedAction: "Approve, edit, or reject the follow-up draft.",
      reason: "Outbound messages remain gated until a real sender and approval flow are configured.",
      status: "pending",
      timestamp: ts,
      metadata: { fallback: true, external_send_allowed: false },
    },
  ];
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
    permissions: { ...DEFAULT_PERMISSIONS },
    outOfOffice: { ...DEFAULT_OUT_OF_OFFICE },
    notificationPreferences: { ...DEFAULT_NOTIFICATIONS },
    activity: [
      createActivity(workspaceId, {
        actor: "Hermes",
        eventType: "observed",
        riskLevel: "low",
        message: "Vacation Mode workspace initialized. No external actions are enabled.",
        relatedEntity: "Vacation Mode",
      }),
      createActivity(workspaceId, {
        actor: "Workflow",
        eventType: "needs_setup",
        riskLevel: "medium",
        message: "Email auto-reply is not connected. Phantom can draft replies, but cannot send automatically.",
        relatedEntity: "Out-of-office auto reply",
      }),
    ],
    approvals: seedApprovals(workspaceId),
    createdAt,
    updatedAt: createdAt,
  };
}

async function getWorkspaceState(session: AccessSession) {
  const store = await readStore();
  const workspaceId = workspaceIdFor(session);
  if (!store.workspaces[workspaceId]) {
    store.workspaces[workspaceId] = createWorkspaceState(session);
    await writeStore(store);
  }
  return { store, state: store.workspaces[workspaceId] };
}

function normalizeMode(value: unknown): VacationModeMode {
  if (value === "draft_only" || value === "approval_required" || value === "limited_autopilot") return value;
  return "approval_required";
}

function normalizePermissions(value: unknown, previous: VacationPermissions): VacationPermissions {
  const input = value && typeof value === "object" ? (value as Partial<Record<keyof VacationPermissions, unknown>>) : {};
  const next = { ...previous };
  for (const key of Object.keys(next) as Array<keyof VacationPermissions>) {
    if (typeof input[key] === "boolean") next[key] = input[key];
  }

  if (next.scheduleSocialPosts || next.autoReplyToNewMessages || !next.sendEmailOnlyAfterApproval) {
    next.requireApprovalForAllOutbound = true;
    next.sendEmailOnlyAfterApproval = true;
  }

  return next;
}

function normalizeOutOfOffice(value: unknown, previous: VacationOutOfOffice): VacationOutOfOffice {
  const input = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const behavior =
    input.behavior === "queue_for_approval" || input.behavior === "send_automatically" || input.behavior === "draft_only"
      ? input.behavior
      : previous.behavior;
  return {
    ...previous,
    enabled: typeof input.enabled === "boolean" ? input.enabled : previous.enabled,
    template: typeof input.template === "string" ? safeString(input.template, 1600) : previous.template,
    startDate: typeof input.startDate === "string" && input.startDate ? safeString(input.startDate, 40) : null,
    endDate: typeof input.endDate === "string" && input.endDate ? safeString(input.endDate, 40) : null,
    behavior: behavior === "send_automatically" ? "queue_for_approval" : behavior,
    providerStatus: "not_connected",
  };
}

function normalizeNotifications(value: unknown, previous: VacationNotifications): VacationNotifications {
  const input = value && typeof value === "object" ? (value as Partial<Record<keyof VacationNotifications, unknown>>) : {};
  const next = { ...previous };
  for (const key of Object.keys(next) as Array<keyof VacationNotifications>) {
    if (typeof input[key] === "boolean") next[key] = input[key];
  }
  next.inApp = true;
  return next;
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
    user_request_summary: "Vacation Mode state change or activity.",
    result_summary: event.message,
    approval_required: event.riskLevel === "urgent" || event.riskLevel === "high",
    approval_status: event.riskLevel === "urgent" || event.riskLevel === "high" ? "pending" : "not_required",
    risks: ["No external send/post/provider action was executed by this route."],
    next_action: state.enabled ? "Monitor activity and review urgent approvals." : "Vacation Mode is off.",
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
  state.activity = state.activity.slice(0, 80);
  state.lastActivityAt = activity.createdAt;
  state.updatedAt = activity.createdAt;
}

async function readinessFor(state: VacationWorkspaceState, session: AccessSession) {
  const ledger = await getHermesLedgerStatus().catch(() => ({ enabled: false, exists: false, bytes: 0 }));
  return [
    {
      id: "owner-auth",
      label: "Owner/admin authenticated",
      status: session.canManageAccess ? "ready" : "needs_setup",
      detail: session.canManageAccess ? "Owner control verified." : "Admin owner session required.",
    },
    {
      id: "hermes-ledger",
      label: "Hermes memory/proof ledger reachable",
      status: ledger.enabled ? "ready" : "needs_setup",
      detail: ledger.enabled ? (ledger.exists ? "Proof ledger is reachable." : "Ledger path ready; first write will create it.") : "Hermes ledger unavailable.",
    },
    {
      id: "approval-queue",
      label: "Approval queue reachable",
      status: "ready",
      detail: "Vacation approvals are stored locally and existing approval queue records are surfaced.",
    },
    {
      id: "notifications",
      label: "Notification channel configured",
      status: "in_app_only",
      detail: "In-app activity feed is ready. Email/push delivery is not connected.",
    },
    {
      id: "email",
      label: "Email integration configured",
      status: "not_connected",
      detail: "Email sending and auto-replies are blocked until a provider is connected and approved.",
    },
    {
      id: "ooo-template",
      label: "Out-of-office template configured",
      status: state.outOfOffice.template ? "ready" : "needs_setup",
      detail: state.outOfOffice.template ? "Template saved." : "Add the reply text before use.",
    },
    {
      id: "calendar",
      label: "Calendar access configured",
      status: "not_connected",
      detail: "Calendar writes are not connected in this Vacation Mode pass.",
    },
    {
      id: "crm",
      label: "CRM/task workspace configured",
      status: "ready",
      detail: "Internal task/CRM updates can be drafted or updated locally.",
    },
    {
      id: "kill-switch",
      label: "Kill switch available",
      status: "ready",
      detail: "Turn off Vacation Mode stops autonomous work immediately.",
    },
  ];
}

function metricsFor(state: VacationWorkspaceState) {
  const events = state.activity;
  return {
    itemsObserved: events.filter((event) => event.eventType === "observed").length,
    draftsCreated: events.filter((event) => event.eventType === "drafted").length,
    approvalsPending: state.approvals.filter((approval) => approval.status === "pending").length,
    automationsCompleted: events.filter((event) => event.eventType === "completed").length,
    blockedActions: events.filter((event) => event.eventType === "blocked" || event.eventType === "needs_setup").length,
    lastCheckIn: state.lastActivityAt,
  };
}

async function existingApprovalQueueRecords(workspaceId: string) {
  const queue = await readApprovalQueueWithTransitions({ limit: 20 }).catch(() => ({ records: [] }));
  return queue.records
    .filter((record) => record.queue_status === "pending")
    .map((record) => {
      const riskLevel: VacationRiskLevel =
        record.approval.risk_level === "critical"
          ? "urgent"
          : record.approval.risk_level === "high"
            ? "high"
            : record.approval.risk_level === "medium"
              ? "medium"
              : "low";
      return {
        id: record.queue_id,
        workspaceId,
        title: record.approval.summary || record.approval.action_type || "Approval needed",
        source: "Existing approval queue",
        riskLevel,
        suggestedAction: "Review this before anything leaves the system.",
        reason: record.approval.approval_reason || "This action requires owner review.",
        status: "pending" as const,
        timestamp: record.queued_at,
        metadata: { queue_id: record.queue_id, source: "hermes_approval_queue", execution_disabled: true },
      };
    });
}

export async function getVacationModeStatus(session: AccessSession) {
  const { state } = await getWorkspaceState(session);
  const readiness = await readinessFor(state, session);
  return {
    enabled: state.enabled,
    mode: state.enabled ? state.mode : "off",
    startedAt: state.startedAt,
    endedAt: state.endedAt,
    lastActivityAt: state.lastActivityAt,
    permissions: state.permissions,
    outOfOffice: state.outOfOffice,
    notificationPreferences: state.notificationPreferences,
    readiness,
    metrics: metricsFor(state),
    safety: {
      external_send_performed: false,
      provider_call_performed: false,
      approval_required_for_outbound: true,
      destructive_actions_allowed: false,
    },
  };
}

export async function activateVacationMode(session: AccessSession, body: unknown) {
  const { store, state } = await getWorkspaceState(session);
  const input = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  let mode = normalizeMode(input.mode);
  const permissions = normalizePermissions(input.permissions, state.permissions);

  if (mode === "limited_autopilot" && !permissions.requireApprovalForAllOutbound) {
    mode = "approval_required";
  }

  state.enabled = true;
  state.mode = mode;
  state.permissions = permissions;
  state.outOfOffice = normalizeOutOfOffice(input.outOfOffice, state.outOfOffice);
  state.notificationPreferences = normalizeNotifications(input.notificationPreferences, state.notificationPreferences);
  state.startedAt = nowIso();
  state.endedAt = null;
  const activity = createActivity(state.workspaceId, {
    actor: "User",
    eventType: "completed",
    riskLevel: mode === "limited_autopilot" ? "medium" : "low",
    message:
      mode === "limited_autopilot"
        ? "Vacation Mode activated with limited autopilot. Outbound actions still require approval."
        : "Vacation Mode activated. Phantom will observe, draft, update safe work, and queue approvals.",
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
    message: "Vacation Mode turned off. Autonomous work stopped immediately.",
    relatedEntity: "Kill switch",
  });
  pushActivity(state, activity);
  await writeStore(store);
  const ledgerWritten = await recordLedger(session, state, activity);
  return { status: await getVacationModeStatus(session), activity, ledgerWritten };
}

export async function updateVacationModeSettings(session: AccessSession, body: unknown) {
  const { store, state } = await getWorkspaceState(session);
  const input = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  state.permissions = normalizePermissions(input.permissions, state.permissions);
  state.outOfOffice = normalizeOutOfOffice(input.outOfOffice, state.outOfOffice);
  state.notificationPreferences = normalizeNotifications(input.notificationPreferences, state.notificationPreferences);
  const activity = createActivity(state.workspaceId, {
    actor: "User",
    eventType: "completed",
    riskLevel: "low",
    message: "Vacation Mode settings saved. External sends and provider actions remain gated.",
    relatedEntity: "Vacation Mode settings",
  });
  pushActivity(state, activity);
  await writeStore(store);
  const ledgerWritten = await recordLedger(session, state, activity);
  return { status: await getVacationModeStatus(session), activity, ledgerWritten };
}

export async function getVacationModeActivity(session: AccessSession, limit = 30) {
  const { state } = await getWorkspaceState(session);
  const cleanLimit = Number.isFinite(limit) ? Math.min(Math.max(Math.floor(limit), 1), 80) : 30;
  return state.activity.slice(0, cleanLimit);
}

export async function getVacationModeApprovals(session: AccessSession, limit = 30) {
  const { state } = await getWorkspaceState(session);
  const existing = await existingApprovalQueueRecords(state.workspaceId);
  return [...state.approvals, ...existing]
    .filter((approval) => approval.status === "pending")
    .sort((a, b) => {
      const risk = RISK_ORDER[b.riskLevel] - RISK_ORDER[a.riskLevel];
      return risk || new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    })
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
    local.metadata = { ...(local.metadata || {}), last_note: safeNote, execution_disabled: true };
    const activity = createActivity(state.workspaceId, {
      actor: "User",
      eventType: decision === "approve" ? "queued_approval" : decision === "reject" ? "blocked" : "observed",
      riskLevel: local.riskLevel,
      message:
        decision === "approve"
          ? `Reviewed approval: ${local.title}. It is marked approved for operator follow-up; no external action was executed.`
          : decision === "reject"
            ? `Rejected approval: ${local.title}. No external action was executed.`
            : `Snoozed approval: ${local.title}. It remains paused.`,
      relatedEntity: local.title,
    });
    pushActivity(state, activity);
    await writeStore(store);
    const ledgerWritten = await recordLedger(session, state, activity);
    return { approval: local, activity, ledgerWritten, execution_disabled: true };
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
    note: safeNote || `Vacation Mode ${decision}. Execution remains disabled.`,
  });

  if (!transition) return null;

  const activity = createActivity(state.workspaceId, {
    actor: "User",
    eventType: "queued_approval",
    riskLevel: "medium",
    message: `Recorded approval queue decision "${decision}" for ${approvalId}. No external action was executed.`,
    relatedEntity: approvalId,
  });
  pushActivity(state, activity);
  await writeStore(store);
  const ledgerWritten = await recordLedger(session, state, activity);
  return { transition, activity, ledgerWritten, execution_disabled: true };
}
