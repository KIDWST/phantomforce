import type { WorkspaceAccessDecision } from "./access-guard.js";
import type { ClientAccessRecord } from "./client-access-state.js";
import { readClientCalendar } from "../connectors/calendar-connector.js";

export type WorkspaceModuleAction = {
  id: string;
  label: string;
  requiresFullAccess: boolean;
  enabled: boolean;
};

export type WorkspaceModuleView = {
  moduleKey: string;
  title: string;
  mode: WorkspaceAccessDecision["mode"];
  writeAccess: boolean;
  summary: string;
  widgets: Array<{
    id: string;
    label: string;
    value: string;
  }>;
  records: Array<{
    id: string;
    title: string;
    status: string;
  }>;
  primaryActions: WorkspaceModuleAction[];
  disabledActions: WorkspaceModuleAction[];
  connector?: {
    id: string;
    provider: string;
    credentialMode: string;
    credentialSource: string;
    credentialRef: string | null;
    workspaceId: string | null;
    scopes: string[];
    status: string;
    readOnly: boolean;
    live: boolean;
    reason: string;
  };
};

type ModuleDefinition = {
  title: string;
  summary: string;
  widgets: WorkspaceModuleView["widgets"];
  records: WorkspaceModuleView["records"];
  actions: Array<Omit<WorkspaceModuleAction, "enabled">>;
  connector?: WorkspaceModuleView["connector"];
};

const moduleDefinitions: Record<string, ModuleDefinition> = {
  command: {
    title: "Command Center",
    summary: "Live operating snapshot for the client workspace.",
    widgets: [
      { id: "priority", label: "Priority", value: "Revenue and delivery focus" },
      { id: "access", label: "Access state", value: "Managed by PhantomForce" },
    ],
    records: [
      { id: "daily-brief", title: "Daily operator brief", status: "ready" },
      { id: "approval-queue", title: "Approval queue", status: "guarded" },
    ],
    actions: [
      { id: "draft-operator-plan", label: "Draft operator plan", requiresFullAccess: false },
      { id: "create-workflow", label: "Create workflow", requiresFullAccess: true },
    ],
  },
  calendar: {
    title: "Calendar",
    summary: "Client scheduling and deadline control surface.",
    widgets: [
      { id: "today", label: "Today", value: "2 priority blocks" },
      { id: "next-deadline", label: "Next deadline", value: "Media proof review" },
    ],
    records: [
      { id: "event-1", title: "Client delivery review", status: "scheduled" },
      { id: "event-2", title: "Follow-up window", status: "open" },
    ],
    actions: [
      { id: "view-calendar", label: "View calendar", requiresFullAccess: false },
      { id: "create-event", label: "Create event", requiresFullAccess: true },
    ],
  },
  tasks: {
    title: "Tasks",
    summary: "Assigned work and next actions for the client workspace.",
    widgets: [
      { id: "open", label: "Open", value: "4" },
      { id: "blocked", label: "Blocked", value: "0" },
    ],
    records: [
      { id: "task-1", title: "Confirm package scope", status: "today" },
      { id: "task-2", title: "Prepare deliverable checklist", status: "queued" },
    ],
    actions: [
      { id: "view-tasks", label: "View tasks", requiresFullAccess: false },
      { id: "create-task", label: "Create task", requiresFullAccess: true },
    ],
  },
  approvals: {
    title: "Approvals",
    summary: "Human approval lane for consequential side effects.",
    widgets: [
      { id: "pending", label: "Pending", value: "2" },
      { id: "policy", label: "Policy", value: "Human approval required" },
    ],
    records: [
      { id: "approval-1", title: "Client access update", status: "pending" },
      { id: "approval-2", title: "Outbound message draft", status: "queued" },
    ],
    actions: [
      { id: "review-approvals", label: "Review approvals", requiresFullAccess: false },
      { id: "approve-action", label: "Approve action", requiresFullAccess: true },
    ],
  },
  contacts: {
    title: "Contacts",
    summary: "Client people, stakeholders, and relationship context.",
    widgets: [
      { id: "contacts", label: "Contacts", value: "12" },
      { id: "warm", label: "Warm follow-ups", value: "3" },
    ],
    records: [
      { id: "contact-1", title: "Decision maker", status: "active" },
      { id: "contact-2", title: "Ops contact", status: "needs-update" },
    ],
    actions: [
      { id: "view-contacts", label: "View contacts", requiresFullAccess: false },
      { id: "add-contact", label: "Add contact", requiresFullAccess: true },
    ],
  },
  content: {
    title: "Content",
    summary: "ChicagoShots/social package planning and asset queue.",
    widgets: [
      { id: "assets", label: "Assets", value: "8" },
      { id: "posts", label: "Draft posts", value: "5" },
    ],
    records: [
      { id: "content-1", title: "Media day carousel", status: "draft" },
      { id: "content-2", title: "Sponsor graphic", status: "review" },
    ],
    actions: [
      { id: "view-content", label: "View content", requiresFullAccess: false },
      { id: "create-content", label: "Create content", requiresFullAccess: true },
    ],
  },
  video: {
    title: "Video Studio",
    summary: "Subscriber video generation cockpit backed by PhantomForce Media Lab and Higgsfield drafts.",
    widgets: [
      { id: "provider", label: "Provider", value: "Higgsfield" },
      { id: "mode", label: "Mode", value: "Draft first" },
    ],
    records: [
      { id: "higgsfield-draft", title: "Generate Video draft lane", status: "available" },
      { id: "approval", title: "Paid/upload run confirmation", status: "required" },
    ],
    actions: [
      { id: "view-video-studio", label: "Open Video Studio", requiresFullAccess: false },
      { id: "draft-generation-job", label: "Draft generation job", requiresFullAccess: true },
    ],
  },
  activity: {
    title: "Activity",
    summary: "Audit-friendly record of workspace changes.",
    widgets: [
      { id: "events", label: "Events", value: "Latest 24h" },
      { id: "audit", label: "Audit", value: "On" },
    ],
    records: [
      { id: "activity-1", title: "Access checked", status: "logged" },
      { id: "activity-2", title: "Module viewed", status: "logged" },
    ],
    actions: [
      { id: "view-activity", label: "View activity", requiresFullAccess: false },
      { id: "export-activity", label: "Export activity", requiresFullAccess: true },
    ],
  },
  documents: {
    title: "Documents",
    summary: "Client docs, proposals, and delivery files.",
    widgets: [
      { id: "docs", label: "Documents", value: "6" },
      { id: "needs-review", label: "Needs review", value: "1" },
    ],
    records: [
      { id: "doc-1", title: "Scope agreement", status: "active" },
      { id: "doc-2", title: "Delivery checklist", status: "draft" },
    ],
    actions: [
      { id: "view-documents", label: "View documents", requiresFullAccess: false },
      { id: "create-document", label: "Create document", requiresFullAccess: true },
    ],
  },
  reports: {
    title: "Reports",
    summary: "Client reporting and operational scorecards.",
    widgets: [
      { id: "score", label: "Score", value: "Healthy" },
      { id: "revenue", label: "Revenue signal", value: "Active" },
    ],
    records: [
      { id: "report-1", title: "Weekly operator report", status: "ready" },
      { id: "report-2", title: "Access report", status: "guarded" },
    ],
    actions: [
      { id: "view-reports", label: "View reports", requiresFullAccess: false },
      { id: "generate-report", label: "Generate report", requiresFullAccess: true },
    ],
  },
};

function normalizeModuleKey(moduleKey: string) {
  return moduleKey.trim().toLowerCase();
}

function defaultModuleDefinition(moduleKey: string, record: ClientAccessRecord): ModuleDefinition {
  return {
    title: moduleKey,
    summary: `${record.business} custom workflow module.`,
    widgets: [
      { id: "workspace", label: "Workspace", value: record.business },
      { id: "access", label: "Access", value: record.accessStatus },
    ],
    records: [
      { id: "custom-module", title: `${moduleKey} workspace`, status: "available" },
    ],
    actions: [
      { id: "view-module", label: "View module", requiresFullAccess: false },
      { id: "run-module-action", label: "Run module action", requiresFullAccess: true },
    ],
  };
}

async function calendarModuleDefinition(record: ClientAccessRecord): Promise<ModuleDefinition> {
  const calendar = await readClientCalendar(record);

  return {
    title: "Calendar",
    summary: "Client scheduling and deadline control surface through the Calendar connector boundary.",
    widgets: [
      { id: "today", label: "Today", value: `${calendar.stats.priorityBlocks} priority blocks` },
      { id: "next-deadline", label: "Next deadline", value: calendar.stats.nextDeadline },
    ],
    records: calendar.events.map((event) => ({
      id: event.id,
      title: event.title,
      status: event.status,
    })),
    actions: [
      { id: "view-calendar", label: "View calendar", requiresFullAccess: false },
      { id: "create-event", label: "Create event", requiresFullAccess: true },
    ],
    connector: {
      id: calendar.connectorId,
      provider: calendar.provider,
      credentialMode: calendar.credentialBoundary.credentialMode,
      credentialSource: calendar.credentialBoundary.credentialSource,
      credentialRef: calendar.credentialBoundary.credentialRef,
      workspaceId: calendar.credentialBoundary.workspaceId,
      scopes: calendar.credentialBoundary.scopes,
      status: calendar.credentialBoundary.status,
      readOnly: calendar.credentialBoundary.readOnly,
      live: calendar.live,
      reason: calendar.credentialBoundary.reason,
    },
  };
}

export async function getWorkspaceModuleView(
  record: ClientAccessRecord,
  decision: WorkspaceAccessDecision,
  moduleKey: string,
): Promise<WorkspaceModuleView> {
  const normalizedModuleKey = normalizeModuleKey(moduleKey);
  const definition =
    normalizedModuleKey === "calendar"
      ? await calendarModuleDefinition(record)
      : moduleDefinitions[normalizedModuleKey] ?? defaultModuleDefinition(moduleKey, record);
  const writeAccess = decision.mode === "full";
  const connectorAvailable = definition.connector?.status !== "missing";
  const actions = definition.actions.map((action) => ({
    ...action,
    enabled: connectorAvailable && (!action.requiresFullAccess || writeAccess),
  }));

  return {
    moduleKey,
    title: definition.title,
    mode: decision.mode,
    writeAccess,
    summary: definition.summary,
    widgets: definition.widgets,
    records: definition.records,
    primaryActions: actions.filter((action) => action.enabled),
    disabledActions: actions.filter((action) => !action.enabled),
    connector: definition.connector,
  };
}
