import { CLIENT_SETUP_MODULES } from "../client-setup/client-setup-store.js";
import type { ClientSetupDocument } from "../client-setup/client-setup-store.js";
import type { CrmPipelineDocument } from "../crm/crm-pipeline-store.js";
import type { ProposalDocument } from "../proposals/proposal-store.js";
import type { WorkspaceApprovalDocument } from "../workspace-approvals/workspace-approval-store.js";

export type ManagedGrowthSurface = "clientsetup" | "crm" | "proposals" | "approvals" | "analytics" | "content" | "media" | "workforce";

export type ManagedGrowthMetric = {
  id: string;
  label: string;
  value: number;
  unit: string;
  detail: string;
  source: string;
};

export type ManagedGrowthBlocker = {
  id: string;
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
  source: string;
};

export type ManagedGrowthNextAction = {
  id: string;
  title: string;
  detail: string;
  surface: ManagedGrowthSurface;
  requiresApproval: boolean;
  source: string;
};

export type ManagedGrowthModuleStatus = {
  id: string;
  label: string;
  status: "live" | "needs_action" | "needs_setup" | "waiting";
  enabledClients: number;
  signalCount: number;
  detail: string;
  blocker: string;
  nextAction: string;
  surface: ManagedGrowthSurface;
  source: string;
};

export type ManagedGrowthReportSource = {
  id: string;
  label: string;
  version: number;
  checksum: string;
  updatedAt: string;
};

export type ManagedGrowthReport = {
  schemaVersion: 1;
  tenantId: string;
  generatedAt: string;
  title: string;
  summary: string;
  metrics: ManagedGrowthMetric[];
  modules: ManagedGrowthModuleStatus[];
  blockers: ManagedGrowthBlocker[];
  nextActions: ManagedGrowthNextAction[];
  sourceDocuments: ManagedGrowthReportSource[];
  setup: {
    activeConfigured: number;
    pendingConfigured: number;
    averageCompleteness: number;
    blockers: string[];
  };
  safety: {
    providerCalled: false;
    outboundActionExecuted: false;
    publicExposureChanged: false;
    socialAnalyticsStatus: "not_connected_here";
    socialAnalyticsReason: string;
  };
};

type BuildManagedGrowthReportInput = {
  tenantId: string;
  generatedAt?: string;
  crm: CrmPipelineDocument;
  proposals: ProposalDocument;
  approvals: WorkspaceApprovalDocument;
  clientSetup: ClientSetupDocument;
};

function source(id: string, label: string, document: { version?: number; checksum?: string; updatedAt?: string }): ManagedGrowthReportSource {
  return {
    id,
    label,
    version: Number.isInteger(document.version) ? Number(document.version) : 1,
    checksum: String(document.checksum || ""),
    updatedAt: String(document.updatedAt || ""),
  };
}

function metric(id: string, label: string, value: number, unit: string, detail: string, sourceId: string): ManagedGrowthMetric {
  return { id, label, value: Math.max(0, Math.round(Number(value) || 0)), unit, detail, source: sourceId };
}

function blocker(id: string, severity: ManagedGrowthBlocker["severity"], title: string, detail: string, sourceId: string): ManagedGrowthBlocker {
  return { id, severity, title, detail, source: sourceId };
}

function action(
  id: string,
  title: string,
  detail: string,
  surface: ManagedGrowthNextAction["surface"],
  requiresApproval: boolean,
  sourceId: string,
): ManagedGrowthNextAction {
  return { id, title, detail, surface, requiresApproval, source: sourceId };
}

function isDue(value: string | undefined, now: number) {
  const due = Date.parse(String(value || ""));
  return Number.isFinite(due) && due <= now;
}

function moneyValue(rows: Array<{ price?: number; value?: number }>) {
  return rows.reduce((sum, row) => sum + Math.max(0, Number(row.price ?? row.value ?? 0) || 0), 0);
}

function setupSlotConfigured(slot: ClientSetupDocument["slots"][number] | undefined) {
  return Boolean(slot && slot.status !== "empty" && slot.organizationName.trim());
}

function configuredSlots(slots: ClientSetupDocument["slots"]) {
  return slots.filter(setupSlotConfigured);
}

function enabledSlots(slots: ClientSetupDocument["slots"], moduleId: string) {
  return configuredSlots(slots).filter((slot) => slot.modules?.[moduleId]);
}

function moduleStatus(input: {
  id: string;
  label: string;
  enabledClients: number;
  signalCount: number;
  detail: string;
  blocker?: string;
  nextAction: string;
  surface: ManagedGrowthSurface;
  source: string;
  needsAction?: boolean;
}): ManagedGrowthModuleStatus {
  let status: ManagedGrowthModuleStatus["status"] = "waiting";
  if (input.enabledClients <= 0) status = "needs_setup";
  else if (input.needsAction) status = "needs_action";
  else if (input.signalCount > 0) status = "live";
  return {
    id: input.id,
    label: input.label,
    status,
    enabledClients: input.enabledClients,
    signalCount: Math.max(0, Math.round(Number(input.signalCount) || 0)),
    detail: input.detail,
    blocker: input.blocker || "",
    nextAction: input.nextAction,
    surface: input.surface,
    source: input.source,
  };
}

function moduleLabel(id: string) {
  return CLIENT_SETUP_MODULES.find((module) => module.id === id)?.label || id.replaceAll("_", " ");
}

export function buildManagedGrowthReport(input: BuildManagedGrowthReportInput): ManagedGrowthReport {
  const generatedAt = input.generatedAt || new Date().toISOString();
  const now = Date.parse(generatedAt);
  const leads = Array.isArray(input.crm.leads) ? input.crm.leads : [];
  const proposals = Array.isArray(input.proposals.proposals) ? input.proposals.proposals : [];
  const approvals = Array.isArray(input.approvals.approvals) ? input.approvals.approvals : [];
  const setupSlots = Array.isArray(input.clientSetup.slots) ? input.clientSetup.slots : [];

  const openLeadStatuses = new Set(["new", "follow-up", "proposal"]);
  const openLeads = leads.filter((lead) => openLeadStatuses.has(lead.status));
  const followUpsDue = leads.filter((lead) => ["new", "follow-up"].includes(lead.status) && isDue(lead.due, now));
  const proposalDrafts = proposals.filter((proposal) => proposal.status === "draft");
  const proposalSendReady = proposals.filter((proposal) => proposal.status === "sent-ready");
  const proposalWon = proposals.filter((proposal) => proposal.status === "won");
  const pendingApprovals = approvals.filter((approval) => approval.status === "pending");
  const changesRequested = approvals.filter((approval) => approval.status === "changes-requested");
  const activeConfigured = setupSlots.filter((slot) => slot.slotKind === "active" && setupSlotConfigured(slot)).length;
  const pendingConfigured = setupSlots.filter((slot) => slot.slotKind === "pending" && setupSlotConfigured(slot)).length;
  const configured = configuredSlots(setupSlots);
  const averageCompleteness = configured.length
    ? Math.round(configured.reduce((sum, slot) => sum + Math.max(0, Number(slot.completeness?.score || 0)), 0) / configured.length)
    : 0;
  const setupBlockers = setupSlots.flatMap((slot) => Array.isArray(slot.completeness?.blockers) ? slot.completeness.blockers : []);
  const slotsFor = (moduleId: string) => enabledSlots(setupSlots, moduleId);
  const contentCalendarSlots = slotsFor("content_calendar");
  const mediaAssetSlots = slotsFor("media_assets");
  const reportsSlots = slotsFor("reports");
  const packagesOffersSlots = slotsFor("packages_offers");
  const businessCleanupSlots = slotsFor("business_cleanup");
  const socialConfigured = contentCalendarSlots.filter((slot) => Boolean(slot.socialMediaWorkflow?.cadence || slot.socialMediaWorkflow?.platforms?.length || slot.socialMediaWorkflow?.assetSource)).length;
  const mediaAssetSourcesConfigured = mediaAssetSlots.filter((slot) => Boolean(slot.socialMediaWorkflow?.assetSource)).length;
  const reportingConfigured = reportsSlots.filter((slot) => Boolean(slot.reportingPreferences?.cadence || slot.reportingPreferences?.metrics?.length || slot.reportingPreferences?.recipients)).length;
  const packageCount = packagesOffersSlots.reduce((sum, slot) => sum + (Array.isArray(slot.servicesPackages) ? slot.servicesPackages.length : 0), 0);
  const businessCleanupBlockers = businessCleanupSlots.flatMap((slot) => Array.isArray(slot.completeness?.blockers) ? slot.completeness.blockers : []);
  const enabledLeadSources = configured.reduce((sum, slot) => sum + (Array.isArray(slot.leadSources) ? slot.leadSources.filter((source) => source.enabled !== false).length : 0), 0);

  const moduleStatuses = [
    moduleStatus({
      id: "lead_queue",
      label: moduleLabel("lead_queue"),
      enabledClients: slotsFor("lead_queue").length,
      signalCount: openLeads.length,
      detail: openLeads.length ? "Saved CRM leads are ready for qualification and routing." : "The module is ready once CRM prospect lanes are saved.",
      blocker: openLeads.length ? "" : "No open CRM leads are saved yet.",
      nextAction: openLeads.length ? "Open Clients and review lead priority." : "Use the Clients prompter or Capture lead to create source-labeled prospect lanes.",
      surface: "crm",
      source: "crm",
    }),
    moduleStatus({
      id: "follow_up_queue",
      label: moduleLabel("follow_up_queue"),
      enabledClients: slotsFor("follow_up_queue").length,
      signalCount: followUpsDue.length,
      detail: followUpsDue.length ? "Due follow-ups need an approval-safe next move." : "No saved CRM follow-ups are due right now.",
      blocker: followUpsDue.length ? "Follow-ups are due now." : "",
      nextAction: followUpsDue.length ? "Open Clients and prepare the due follow-ups." : "Keep lead due dates current in the CRM.",
      surface: "crm",
      source: "crm",
      needsAction: followUpsDue.length > 0,
    }),
    moduleStatus({
      id: "content_calendar",
      label: moduleLabel("content_calendar"),
      enabledClients: contentCalendarSlots.length,
      signalCount: socialConfigured,
      detail: socialConfigured ? "Client setup contains social cadence, platforms, or content workflow details." : "Content planning needs cadence, platforms, or workflow notes in Client Setup.",
      blocker: socialConfigured ? "" : "No configured social/media workflow is saved for active clients.",
      nextAction: socialConfigured ? "Open Publish to turn approved media into draft posts." : "Configure the social/media workflow for each active client.",
      surface: "content",
      source: "client_setup",
    }),
    moduleStatus({
      id: "media_assets",
      label: moduleLabel("media_assets"),
      enabledClients: mediaAssetSlots.length,
      signalCount: mediaAssetSourcesConfigured,
      detail: "Media readiness is based on saved Client Setup asset-source instructions, not local uploads or invented media counts.",
      blocker: mediaAssetSlots.some((slot) => !slot.socialMediaWorkflow?.assetSource) ? "At least one media-enabled client needs an asset source." : "",
      nextAction: "Open Media Lab to prepare assets, then keep publishing work approval-gated.",
      surface: "media",
      source: "client_setup",
    }),
    moduleStatus({
      id: "approval_queue",
      label: moduleLabel("approval_queue"),
      enabledClients: slotsFor("approval_queue").length,
      signalCount: pendingApprovals.length,
      detail: pendingApprovals.length ? "Owner-gated approval cards are waiting." : "Approval rules are configured and no pending approval card is waiting.",
      blocker: pendingApprovals.length ? "Approval queue has pending decisions." : "",
      nextAction: pendingApprovals.length ? "Open Approvals and decide or request changes." : "Keep risky outbound work routed through Approvals.",
      surface: "approvals",
      source: "approvals",
      needsAction: pendingApprovals.length > 0,
    }),
    moduleStatus({
      id: "client_requests",
      label: moduleLabel("client_requests"),
      enabledClients: slotsFor("client_requests").length,
      signalCount: 0,
      detail: "Client request intake is configured in setup; dedicated request records are not counted in this report yet.",
      blocker: slotsFor("client_requests").length ? "" : "No configured client has Client Requests enabled.",
      nextAction: "Add request intake rules in Client Setup before exposing it to client admins.",
      surface: "clientsetup",
      source: "client_setup",
    }),
    moduleStatus({
      id: "employee_tasks",
      label: moduleLabel("employee_tasks"),
      enabledClients: slotsFor("employee_tasks").length,
      signalCount: 0,
      detail: "Employee task readiness is setup-backed; task assignment records are not counted here yet.",
      blocker: slotsFor("employee_tasks").length ? "" : "No configured client has Employee Tasks enabled.",
      nextAction: "Open Workforce after roles and assignment rules are saved in Client Setup.",
      surface: "workforce",
      source: "client_setup",
    }),
    moduleStatus({
      id: "reports",
      label: moduleLabel("reports"),
      enabledClients: reportsSlots.length,
      signalCount: reportingConfigured,
      detail: reportingConfigured ? "Reporting cadence, metrics, or recipients are saved." : "Reporting preferences need cadence, metrics, or recipients.",
      blocker: reportingConfigured ? "" : "No configured client has reporting preferences saved.",
      nextAction: "Open Client Setup and finish reporting preferences before treating reports as repeatable.",
      surface: "clientsetup",
      source: "client_setup",
    }),
    moduleStatus({
      id: "packages_offers",
      label: moduleLabel("packages_offers"),
      enabledClients: packagesOffersSlots.length,
      signalCount: packageCount,
      detail: packageCount ? "Saved setup packages/offers can feed proposal work." : "No services or packages are configured yet.",
      blocker: packageCount ? "" : "Client Setup needs at least one service/package.",
      nextAction: packageCount ? "Open Offer Desk to turn packages into proposal drafts." : "Add sellable packages in Client Setup.",
      surface: "proposals",
      source: "client_setup",
    }),
    moduleStatus({
      id: "business_cleanup",
      label: moduleLabel("business_cleanup"),
      enabledClients: businessCleanupSlots.length,
      signalCount: businessCleanupBlockers.length,
      detail: businessCleanupBlockers.length ? "Setup blockers are visible on clients with the cleanup checklist enabled." : "No setup completeness blockers are visible on cleanup-enabled clients.",
      blocker: businessCleanupBlockers.length ? "Client Setup still has open completeness blockers for cleanup-enabled clients." : "",
      nextAction: businessCleanupBlockers.length ? "Open Client Setup and clear the next setup action." : "Keep the checklist enabled for every new client.",
      surface: "clientsetup",
      source: "client_setup",
      needsAction: businessCleanupBlockers.length > 0,
    }),
  ];

  const reportMetrics = [
    metric("open_leads", "Open leads", openLeads.length, "leads", "Leads in new, follow-up, or proposal stages.", "crm"),
    metric("follow_ups_due", "Follow-ups due", followUpsDue.length, "leads", "Open leads with due dates at or before report time.", "crm"),
    metric("proposal_pipeline", "Proposal pipeline", moneyValue(proposals.filter((proposal) => ["draft", "sent-ready", "sent"].includes(proposal.status))), "dollars", "Draft, send-ready, and sent proposal value.", "proposals"),
    metric("won_value", "Won value", moneyValue(proposalWon), "dollars", "Won proposal value recorded in Proposal Forge.", "proposals"),
    metric("pending_approvals", "Pending approvals", pendingApprovals.length, "approvals", "Approval cards waiting on owner/admin decision.", "approvals"),
    metric("setup_completeness", "Setup completeness", averageCompleteness, "percent", "Average configured client setup completeness.", "client_setup"),
    metric("enabled_lead_sources", "Enabled lead sources", enabledLeadSources, "sources", "Enabled lead sources saved across configured client slots.", "client_setup"),
  ];

  const blockers: ManagedGrowthBlocker[] = [];
  if (activeConfigured < 2) {
    blockers.push(blocker(
      "client_setup_active_slots",
      "warning",
      "Two active client slots are not fully configured.",
      "The setup console is the source of truth for active client organizations. Configure both active slots before treating Managed Growth Ops as repeatable.",
      "client_setup",
    ));
  }
  if (!openLeads.length) {
    blockers.push(blocker("crm_empty", "warning", "No open CRM leads are saved.", "Add or generate prospect lanes in Clients before the report can show follow-up pressure.", "crm"));
  }
  if (followUpsDue.length) {
    blockers.push(blocker("follow_ups_due", "critical", "Follow-ups are due now.", "These leads need the next safe follow-up step prepared or reviewed.", "crm"));
  }
  if (pendingApprovals.length) {
    blockers.push(blocker("approvals_pending", "warning", "Approval queue is waiting.", "Review pending approval cards before any owner-gated work can move forward.", "approvals"));
  }
  if (changesRequested.length) {
    blockers.push(blocker("approval_changes_requested", "info", "Some work needs changes.", "Changes-requested approvals should be repaired before being counted as ready.", "approvals"));
  }
  blockers.push(blocker(
    "social_analytics_disconnected",
    "info",
    "Social performance is not counted in this report.",
    "Social metrics require official OAuth/API syncs or imported platform exports in Social media analytics. Local uploads, drafts, and post history are excluded.",
    "analytics",
  ));

  const nextActions: ManagedGrowthNextAction[] = [];
  if (pendingApprovals.length) {
    nextActions.push(action("review_pending_approvals", "Review pending approvals", "Decide or request changes on owner-gated work before it moves.", "approvals", false, "approvals"));
  }
  if (followUpsDue.length) {
    nextActions.push(action("prepare_follow_ups", "Prepare due follow-ups", "Open Clients and turn due follow-up cards into approval-safe next moves.", "crm", true, "crm"));
  }
  if (proposalSendReady.length) {
    nextActions.push(action("review_send_ready_proposals", "Review send-ready proposals", "Proposal Forge has send-ready drafts. Confirm them before any external send lane is used.", "proposals", true, "proposals"));
  }
  if (activeConfigured < 2) {
    nextActions.push(action("finish_client_setup", "Finish client setup slots", "Configure two active client organizations so reporting and operations can repeat cleanly.", "clientsetup", false, "client_setup"));
  }
  if (!openLeads.length) {
    nextActions.push(action("build_crm_lanes", "Build prospect lanes", "Use the Clients prompter to add source-labeled, no-contact-claim prospect lanes.", "crm", false, "crm"));
  }
  if (!nextActions.length) {
    nextActions.push(action("review_reporting_preferences", "Review reporting preferences", "Client setup, CRM, proposals, and approvals are populated. Confirm cadence and report recipients next.", "clientsetup", false, "client_setup"));
  }

  const summary = blockers.some((item) => item.severity === "critical")
    ? "Managed Growth Ops has urgent internal work waiting."
    : openLeads.length || proposals.length || approvals.length
      ? "Managed Growth Ops has server-backed activity to review."
      : "Managed Growth Ops is ready for setup, but no activity has been saved yet.";

  return {
    schemaVersion: 1,
    tenantId: input.tenantId,
    generatedAt,
    title: "Managed Growth Ops report",
    summary,
    metrics: reportMetrics,
    modules: moduleStatuses,
    blockers,
    nextActions: nextActions.slice(0, 6),
    sourceDocuments: [
      source("client_setup", "Client Setup", input.clientSetup),
      source("crm", "CRM Pipeline", input.crm),
      source("proposals", "Proposal Forge", input.proposals),
      source("approvals", "Workspace Approvals", input.approvals),
    ],
    setup: {
      activeConfigured,
      pendingConfigured,
      averageCompleteness,
      blockers: [...new Set(setupBlockers)].slice(0, 12),
    },
    safety: {
      providerCalled: false,
      outboundActionExecuted: false,
      publicExposureChanged: false,
      socialAnalyticsStatus: "not_connected_here",
      socialAnalyticsReason: "Use official social OAuth/API syncs or imported platform reports for social performance. This report only uses internal PhantomForce records.",
    },
  };
}
