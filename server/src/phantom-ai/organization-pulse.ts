/* Organization Pulse — the single tenant-scoped aggregation layer over every
   real store PhantomForce owns. Three consumers share these reads:

     1. Phantom AI chat: a compact "workspace awareness" context block, so the
        brain answers from live org state instead of memory alone.
     2. The dashboard attention surface: pending approvals, failed runs,
        running work — server truth, not client-store guesses.
     3. The Organization Brain Graph: real nodes and edges with honest
        disconnection detection.

   Design rules: every read is wrapped so one broken store never breaks the
   pulse; sections report { available:false, reason } instead of pretending;
   nothing here mutates any store; DB-backed domains (Asset Cloud, Sites)
   surface honestly as "not connected in this workspace" when the session has
   no database org. */

import type { AccessSession } from "../access/session.js";
import { listAgentRuns } from "./agent-runs.js";
import { readApprovalQueueRecords } from "./approval-queue.js";
import { listAutomationJobs } from "./automation-engine.js";
import { getCompetitorIntelligenceSnapshot } from "./competitor-intelligence.js";
import { listBrainMemories, readBrainEvents } from "./neural-spine.js";
import { PHANTOMPLAY_BUILT_IN_GAMES } from "./phantomplay.js";
import { getClientSetupDocument } from "../client-setup/client-setup-store.js";
import { getCrmPipelineDocument } from "../crm/crm-pipeline-store.js";
import { buildManagedGrowthReport, type ManagedGrowthReport } from "../managed-growth/managed-growth-report.js";
import { getProposalDocument } from "../proposals/proposal-store.js";
import { getWorkspaceApprovalDocument } from "../workspace-approvals/workspace-approval-store.js";

type Unavailable = { available: false; reason: string };
type Section<T> = ({ available: true } & T) | Unavailable;

export type OrganizationPulse = {
  tenantId: string;
  generatedAt: string;
  approvals: Section<{ pending: number; latest: Array<{ id: string; action: string; queuedAt: string }> }>;
  agentRuns: Section<{ running: number; failed: number; recent: Array<{ id: string; title: string; state: string; operation: string }> }>;
  automations: Section<{ total: number; enabled: number; failing: Array<{ id: string; name: string; lastSummary: string }> }>;
  competitors: Section<{ businessName: string; category: string; competitorCount: number; signalCount: number; inferenceCount: number; competitorsWithoutSignals: number; discoveryRuns: number }>;
  managedGrowth: Section<{
    summary: string;
    activeClients: number;
    pendingClients: number;
    setupCompleteness: number;
    openLeads: number;
    followUpsDue: number;
    proposalPipeline: number;
    wonValue: number;
    pendingWorkspaceApprovals: number;
    blockerCount: number;
    criticalBlockers: number;
    nextActions: Array<{ title: string; detail: string; surface: string; requiresApproval: boolean }>;
    sourceDocuments: number;
    socialAnalyticsStatus: "not_connected_here";
  }>;
  memories: Section<{ total: number; neverRecalled: number; recent: string[] }>;
  assets: Section<{ total: number; recent: Array<{ id: string; title: string; kind: string }>; unusedRecent: number }>;
  sites: Section<{ total: number; names: string[] }>;
  phantomplay: Section<{ builtInGames: number }>;
};

export type PulseAccess = {
  tenantId: string;
  /* DB org id when the session is database-backed; Asset Cloud + Sites live there. */
  orgId?: string | null;
  competitorEntitled: boolean;
  canManage: boolean;
};

const unavailable = (reason: string): Unavailable => ({ available: false, reason });

async function safe<T>(label: string, reader: () => Promise<Section<T>>): Promise<Section<T>> {
  try {
    return await reader();
  } catch (error) {
    return unavailable(`${label} could not be read: ${error instanceof Error ? error.message.slice(0, 120) : "unknown error"}`);
  }
}

/* Asset Cloud + Sites are Prisma-backed; import lazily so file-store
   deployments without a database never pay for (or crash on) the import. */
async function readAssets(orgId: string) {
  const { listAssets, assetUsageReport } = await import("../assets/asset-service.js");
  const page = await listAssets(orgId, { view: "library", limit: 24 } as never);
  const items = (Array.isArray(page) ? page : (page as { assets?: unknown[] }).assets ?? []) as Array<Record<string, unknown>>;
  let unusedRecent = 0;
  const recent = [] as Array<{ id: string; title: string; kind: string }>;
  for (const asset of items.slice(0, 12)) {
    const id = String(asset.id ?? "");
    recent.push({ id, title: String(asset.title ?? asset.filename ?? "Untitled"), kind: String(asset.kind ?? "file") });
    try {
      const usage = await assetUsageReport(orgId, id);
      const count = Array.isArray(usage) ? usage.length : Number((usage as { total?: number })?.total ?? 0);
      if (!count) unusedRecent += 1;
    } catch { /* usage report is best-effort */ }
  }
  return { total: items.length, recent, unusedRecent };
}

async function readSites(orgId: string) {
  const { listOrgSites } = await import("../sites/publishing.js");
  const sites = (await listOrgSites(orgId)) as Array<{ name?: string; slug?: string }>;
  return { total: sites.length, names: sites.slice(0, 6).map((site) => String(site.name ?? site.slug ?? "site")) };
}

function metricValue(report: ManagedGrowthReport, id: string) {
  return Number(report.metrics.find((metric) => metric.id === id)?.value ?? 0);
}

async function buildManagedGrowthPulseSection(tenantId: string, actor: string) {
  const [clientSetup, crm, proposals, approvals] = await Promise.all([
    getClientSetupDocument(tenantId, actor),
    getCrmPipelineDocument(tenantId, actor),
    getProposalDocument(tenantId, actor),
    getWorkspaceApprovalDocument(tenantId, actor),
  ]);
  const report = buildManagedGrowthReport({ tenantId, clientSetup, crm, proposals, approvals });
  return {
    report,
    documents: { clientSetup, crm, proposals, approvals },
    summary: report.summary,
    activeClients: report.setup.activeConfigured,
    pendingClients: report.setup.pendingConfigured,
    setupCompleteness: metricValue(report, "setup_completeness"),
    openLeads: metricValue(report, "open_leads"),
    followUpsDue: metricValue(report, "follow_ups_due"),
    proposalPipeline: metricValue(report, "proposal_pipeline"),
    wonValue: metricValue(report, "won_value"),
    pendingWorkspaceApprovals: metricValue(report, "pending_approvals"),
    blockerCount: report.blockers.length,
    criticalBlockers: report.blockers.filter((blocker) => blocker.severity === "critical").length,
    nextActions: report.nextActions.slice(0, 5).map((action) => ({
      title: action.title,
      detail: action.detail,
      surface: action.surface,
      requiresApproval: action.requiresApproval,
    })),
    sourceDocuments: report.sourceDocuments.length,
    socialAnalyticsStatus: report.safety.socialAnalyticsStatus,
  };
}

export async function getOrganizationPulse(session: AccessSession, access: PulseAccess): Promise<OrganizationPulse> {
  const { tenantId, orgId } = access;

  const [approvals, agentRuns, automations, competitors, managedGrowth, memories, assets, sites] = await Promise.all([
    safe("Approval queue", async () => {
      const queue = await readApprovalQueueRecords({ limit: 200 });
      const mine = queue.records.filter((record) => record.approval?.tenant_context?.tenant_id === tenantId);
      const pending = mine.filter((record) => record.queue_status === "pending");
      return {
        available: true as const,
        pending: pending.length,
        latest: pending.slice(0, 3).map((record) => ({ id: record.queue_id, action: record.approval.action_type, queuedAt: record.queued_at })),
      };
    }),
    safe("Agent runs", async () => {
      const runs = listAgentRuns({ limit: 40 });
      // Strict workspace scoping: an admin viewing org X must see org X's
      // runs, not the whole platform's — anything else misrepresents the org.
      const scoped = runs.filter((run) => run.workspace === tenantId);
      return {
        available: true as const,
        running: scoped.filter((run) => run.state === "queued" || run.state === "executing" || run.state === "verifying").length,
        failed: scoped.filter((run) => run.state === "failed").length,
        recent: scoped.slice(0, 6).map((run) => ({ id: run.id, title: run.title, state: run.state, operation: run.operation })),
      };
    }),
    safe("Automations", async () => {
      if (!access.canManage) return unavailable("Automation status is visible to workspace owners and admins.");
      const jobs = await listAutomationJobs();
      return {
        available: true as const,
        total: jobs.length,
        enabled: jobs.filter((job) => job.enabled).length,
        failing: jobs
          .filter((job) => job.enabled && job.last_status === "error")
          .slice(0, 4)
          .map((job) => ({ id: job.id, name: job.name, lastSummary: String(job.last_summary ?? "").slice(0, 140) })),
      };
    }),
    safe("Competitor intelligence", async () => {
      if (!access.competitorEntitled) return unavailable("Competitor Intelligence is not enabled for this plan.");
      const snapshot = await getCompetitorIntelligenceSnapshot(session, {
        tenantId, entitled: true, aggressiveEntitled: false, competitorLimit: 0, signalLimit: 0,
      });
      const withoutSignals = snapshot.competitors.filter(
        (competitor) => !snapshot.signals.some((signal) => signal.competitorId === competitor.id),
      ).length;
      return {
        available: true as const,
        businessName: snapshot.businessProfile?.businessName ?? "",
        category: snapshot.businessProfile?.category ?? "",
        competitorCount: snapshot.competitors.length,
        signalCount: snapshot.signals.length,
        inferenceCount: snapshot.inferences.length,
        competitorsWithoutSignals: withoutSignals,
        discoveryRuns: snapshot.discoveryRuns.length,
      };
    }),
    safe("Managed Growth Ops", async () => {
      const section = await buildManagedGrowthPulseSection(tenantId, session.id);
      return {
        available: true as const,
        summary: section.summary,
        activeClients: section.activeClients,
        pendingClients: section.pendingClients,
        setupCompleteness: section.setupCompleteness,
        openLeads: section.openLeads,
        followUpsDue: section.followUpsDue,
        proposalPipeline: section.proposalPipeline,
        wonValue: section.wonValue,
        pendingWorkspaceApprovals: section.pendingWorkspaceApprovals,
        blockerCount: section.blockerCount,
        criticalBlockers: section.criticalBlockers,
        nextActions: section.nextActions,
        sourceDocuments: section.sourceDocuments,
        socialAnalyticsStatus: section.socialAnalyticsStatus,
      };
    }),
    safe("Brain memories", async () => {
      const result = await listBrainMemories(session, { limit: 100, readOnly: true });
      // Platform bootstrap notes are seeded guidance, not organization
      // knowledge — counting them would fake a brain for empty workspaces.
      const active = result.memories.filter((memory) => memory.active !== false && memory.source !== "phase_iii_bootstrap");
      return {
        available: true as const,
        total: active.length,
        neverRecalled: active.filter((memory) => !memory.useCount).length,
        recent: active.slice(0, 4).map((memory) => memory.text.slice(0, 110)),
      };
    }),
    safe("Asset Cloud", async () => {
      if (!orgId) return unavailable("Asset Cloud isn't connected for this workspace yet.");
      return { available: true as const, ...(await readAssets(orgId)) };
    }),
    safe("Websites", async () => {
      if (!orgId) return unavailable("No websites are connected for this workspace yet.");
      return { available: true as const, ...(await readSites(orgId)) };
    }),
  ]);

  return {
    tenantId,
    generatedAt: new Date().toISOString(),
    approvals, agentRuns, automations, competitors, managedGrowth, memories, assets, sites,
    phantomplay: { available: true, builtInGames: PHANTOMPLAY_BUILT_IN_GAMES.length },
  };
}

/* The compact awareness block injected into Phantom AI chat context. Every
   line traces to a real store read above; nothing is invented. Kept short so
   it never crowds out the user's own message or memories. */
export function buildWorkspaceAwarenessText(pulse: OrganizationPulse): string {
  const lines: string[] = [
    `Live workspace state (${pulse.tenantId}) — background reference only: use it when the user asks about status, work, assets, or competitors. Do NOT volunteer this as a status report in casual conversation.`,
  ];
  if (pulse.approvals.available) {
    lines.push(pulse.approvals.pending
      ? `- ${pulse.approvals.pending} approval(s) WAITING for the owner (${pulse.approvals.latest.map((item) => item.action).join(", ")})`
      : "- No approvals waiting");
  }
  if (pulse.agentRuns.available) {
    const bits = [];
    if (pulse.agentRuns.running) bits.push(`${pulse.agentRuns.running} running`);
    if (pulse.agentRuns.failed) bits.push(`${pulse.agentRuns.failed} FAILED`);
    lines.push(`- Agent runs: ${bits.length ? bits.join(", ") : "none active"}`);
  }
  if (pulse.automations.available && pulse.automations.failing.length) {
    lines.push(`- Automations failing: ${pulse.automations.failing.map((job) => job.name).join(", ")}`);
  }
  if (pulse.managedGrowth.available) {
    const growth = pulse.managedGrowth;
    lines.push(`- Managed Growth Ops: ${growth.openLeads} open lead(s), ${growth.followUpsDue} due follow-up(s), $${growth.proposalPipeline} proposal pipeline, ${growth.pendingWorkspaceApprovals} workspace approval(s) waiting, setup ${growth.setupCompleteness}%`);
    if (growth.nextActions.length) lines.push(`- Next growth action: ${growth.nextActions[0].title} (${growth.nextActions[0].surface})`);
    if (growth.socialAnalyticsStatus === "not_connected_here") lines.push("- Social performance is not counted here unless official OAuth/API syncs or imported reports exist");
  }
  if (pulse.competitors.available && pulse.competitors.competitorCount) {
    lines.push(`- Competitor intel: tracking ${pulse.competitors.competitorCount} competitor(s), ${pulse.competitors.signalCount} public signal(s), ${pulse.competitors.inferenceCount} estimate(s)${pulse.competitors.competitorsWithoutSignals ? `; ${pulse.competitors.competitorsWithoutSignals} competitor(s) have no evidence yet` : ""}`);
  } else if (pulse.competitors.available && pulse.competitors.businessName) {
    lines.push(`- Business profile: ${pulse.competitors.businessName} (${pulse.competitors.category || "category not set"}); no competitors tracked yet`);
  }
  if (pulse.assets.available) {
    lines.push(`- Asset Cloud: ${pulse.assets.total} asset(s) in the library${pulse.assets.total ? ` — check the library before generating new media; reuse saves credits` : ""}`);
  } else {
    lines.push(`- Asset Cloud: not connected in this workspace`);
  }
  if (pulse.sites.available && pulse.sites.total) {
    lines.push(`- Websites: ${pulse.sites.total} (${pulse.sites.names.join(", ")})`);
  }
  if (pulse.memories.available) {
    lines.push(`- Brain: ${pulse.memories.total} stored memories`);
  }
  return lines.join("\n").slice(0, 900);
}

/* ── Organization Brain Graph ─────────────────────────────────────────────
   Real nodes, real edges, honest gaps. Every node carries `source` (the
   store it came from) so any claim in the picture is inspectable. Nodes that
   are genuinely disconnected say WHY — a missing integration, an unused
   asset, a competitor without evidence — and unavailable domains appear as
   disconnected system nodes rather than being silently omitted. */

export type GraphNode = {
  id: string; type: string; label: string; source: string;
  state?: string; disconnected?: boolean; reason?: string;
};
export type GraphEdge = { from: string; to: string; kind: string };
export type OrganizationGraph = {
  tenantId: string; generatedAt: string;
  nodes: GraphNode[]; edges: GraphEdge[];
  gaps: Array<{ nodeId: string; reason: string }>;
};

export async function getOrganizationGraph(session: AccessSession, access: PulseAccess): Promise<OrganizationGraph> {
  const { tenantId } = access;
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const gaps: Array<{ nodeId: string; reason: string }> = [];
  const orgNode = `org:${tenantId}`;
  nodes.push({ id: orgNode, type: "organization", label: tenantId, source: "access-session" });

  const mark = (node: GraphNode, reason: string) => {
    node.disconnected = true; node.reason = reason; gaps.push({ nodeId: node.id, reason });
  };

  /* Managed Growth Ops spine — setup slots, CRM, proposals, and workspace
     approvals. This makes the brain map show the business operating state
     Phantom actually owns, not just memory and competitor records. */
  try {
    const managed = await buildManagedGrowthPulseSection(tenantId, session.id);
    const report = managed.report;
    const reportNode = `managed-growth:${tenantId}`;
    const growthNode: GraphNode = {
      id: reportNode,
      type: "managed-growth",
      label: "Managed Growth Ops",
      source: "managed-growth-report",
      state: report.summary,
    };
    if (managed.criticalBlockers) mark(growthNode, `${managed.criticalBlockers} critical managed-growth blocker(s) need attention.`);
    nodes.push(growthNode);
    edges.push({ from: orgNode, to: reportNode, kind: "operates" });

    const now = Date.now();
    for (const slot of managed.documents.clientSetup.slots) {
      const id = `client-setup:${slot.slotId}`;
      const name = slot.organizationName || `${slot.slotKind === "pending" ? "Pending" : "Active"} client slot ${slot.slotId}`;
      const node: GraphNode = {
        id,
        type: "client-setup",
        label: name.slice(0, 48),
        source: "client-setup.json",
        state: `${slot.status || "empty"} · ${Math.max(0, Number(slot.completeness?.score || 0))}%`,
      };
      if (!slot.organizationName || slot.status === "empty") {
        mark(node, "Client setup slot is not configured yet.");
      } else if (slot.completeness?.blockers?.length) {
        mark(node, slot.completeness.blockers[0].slice(0, 120));
      }
      nodes.push(node);
      edges.push({ from: reportNode, to: id, kind: "configures" });
    }

    for (const lead of managed.documents.crm.leads.filter((item) => ["new", "follow-up", "proposal"].includes(item.status)).slice(0, 10)) {
      const id = `crm-lead:${lead.id}`;
      const node: GraphNode = {
        id,
        type: "crm-lead",
        label: (lead.company || lead.name || "CRM lead").slice(0, 48),
        source: "crm-pipeline.json",
        state: lead.status,
      };
      const due = Date.parse(lead.due || "");
      if (["new", "follow-up"].includes(lead.status) && Number.isFinite(due) && due <= now) {
        mark(node, "Follow-up is due now.");
      }
      nodes.push(node);
      edges.push({ from: reportNode, to: id, kind: "tracks" });
      if (lead.setupSlotId) edges.push({ from: `client-setup:${lead.setupSlotId}`, to: id, kind: "belongs_to" });
    }

    for (const proposal of managed.documents.proposals.proposals.filter((item) => ["draft", "sent-ready", "sent", "won"].includes(item.status)).slice(0, 10)) {
      const id = `proposal:${proposal.id}`;
      const node: GraphNode = {
        id,
        type: "proposal",
        label: (proposal.client || "Proposal").slice(0, 48),
        source: "proposals.json",
        state: `${proposal.status} · $${proposal.price || 0}`,
      };
      if (proposal.status === "sent-ready") mark(node, "Send-ready proposal still needs the correct approval path before any external send.");
      nodes.push(node);
      edges.push({ from: reportNode, to: id, kind: "prices" });
      if (proposal.leadId) edges.push({ from: `crm-lead:${proposal.leadId}`, to: id, kind: "converted_to" });
      if (proposal.setupSlotId) edges.push({ from: `client-setup:${proposal.setupSlotId}`, to: id, kind: "belongs_to" });
    }

    for (const approval of managed.documents.approvals.approvals.slice(0, 10)) {
      const id = `workspace-approval:${approval.id}`;
      const node: GraphNode = {
        id,
        type: "approval",
        label: approval.title.slice(0, 48),
        source: "workspace-approvals.json",
        state: approval.status,
      };
      if (approval.status === "pending") mark(node, "Workspace approval is waiting on an owner or admin decision.");
      nodes.push(node);
      edges.push({ from: reportNode, to: id, kind: "awaits_decision" });
    }
  } catch { /* non-fatal; pulse reports managed-growth read failures */ }

  /* Competitor intelligence — competitors, signals, estimates, dossiers */
  if (access.competitorEntitled) {
    try {
      const snapshot = await getCompetitorIntelligenceSnapshot(session, {
        tenantId, entitled: true, aggressiveEntitled: false, competitorLimit: 0, signalLimit: 0,
      });
      if (snapshot.businessProfile?.businessName) {
        const id = `profile:${tenantId}`;
        nodes.push({ id, type: "business-profile", label: snapshot.businessProfile.businessName, source: "competitor-intelligence.businessProfile" });
        edges.push({ from: orgNode, to: id, kind: "describes" });
      }
      for (const competitor of snapshot.competitors.slice(0, 10)) {
        const id = `competitor:${competitor.id}`;
        const node: GraphNode = { id, type: "competitor", label: competitor.name, source: "competitor-intelligence.competitors" };
        const signals = snapshot.signals.filter((signal) => signal.competitorId === competitor.id);
        if (!signals.length) mark(node, "No public signals recorded yet — this competitor is untracked evidence-wise.");
        nodes.push(node);
        edges.push({ from: orgNode, to: id, kind: "competes_with" });
        for (const signal of signals.slice(0, 4)) {
          const signalId = `signal:${signal.id}`;
          nodes.push({ id: signalId, type: "signal", label: signal.title.slice(0, 48), source: "competitor-intelligence.signals" });
          edges.push({ from: id, to: signalId, kind: "evidenced_by" });
        }
        for (const inference of snapshot.inferences.filter((entry) => entry.competitorId === competitor.id).slice(0, 3)) {
          const infId = `inference:${inference.id}`;
          nodes.push({ id: infId, type: "insight", label: inference.estimate.slice(0, 48), source: "competitor-intelligence.inferences" });
          edges.push({ from: id, to: infId, kind: "informs" });
        }
        if (snapshot.dossiers.some((dossier) => dossier.competitorId === competitor.id)) {
          const dosId = `dossier:${competitor.id}`;
          nodes.push({ id: dosId, type: "dossier", label: `Deep dive: ${competitor.name}`.slice(0, 48), source: "competitor-intelligence.dossiers" });
          edges.push({ from: id, to: dosId, kind: "analyzed_by" });
        }
      }
      for (const theme of snapshot.audienceThemes.slice(0, 6)) {
        const themeId = `audience-gap:${theme.id}`;
        nodes.push({ id: themeId, type: "audience-gap", label: theme.theme.slice(0, 48), source: "competitor-intelligence.audienceThemes" });
        const owner = `competitor:${theme.competitorId}`;
        edges.push(nodes.some((node) => node.id === owner) ? { from: owner, to: themeId, kind: "reveals" } : { from: orgNode, to: themeId, kind: "reveals" });
      }
      for (const opportunity of snapshot.opportunities.slice(0, 6)) {
        const oppId = `market-opportunity:${opportunity.id}`;
        nodes.push({ id: oppId, type: "market-opportunity", label: opportunity.title.slice(0, 48), source: "competitor-intelligence.opportunities" });
        const owner = `competitor:${opportunity.competitorId}`;
        edges.push(nodes.some((node) => node.id === owner) ? { from: owner, to: oppId, kind: "suggests" } : { from: orgNode, to: oppId, kind: "suggests" });
      }
    } catch { /* section absent from graph on read failure; pulse reports it */ }
  } else {
    const id = `system:competitor-intelligence`;
    nodes.push({ id, type: "system", label: "Competitor Intelligence", source: "entitlements" });
    mark(nodes[nodes.length - 1], "Not enabled for this plan — no competitive awareness feeds the brain.");
    edges.push({ from: orgNode, to: id, kind: "missing_integration" });
  }

  /* Brain memories + events → agent runs */
  try {
    const memories = await listBrainMemories(session, { limit: 40, readOnly: true });
    for (const memory of memories.memories.filter((entry) => entry.active !== false && entry.source !== "phase_iii_bootstrap").slice(0, 10)) {
      const id = `memory:${memory.id}`;
      const node: GraphNode = { id, type: "memory", label: memory.text.slice(0, 48), source: "brain-memory.jsonl" };
      if (!memory.useCount) mark(node, "Never recalled in a conversation — stored but not yet informing decisions.");
      nodes.push(node);
      edges.push({ from: orgNode, to: id, kind: "learned" });
    }
    const events = await readBrainEvents(session, { limit: 30 });
    for (const event of events.events.slice(0, 10)) {
      if (event.linkedRunId) {
        edges.push({ from: `memoryevent:${event.id}`, to: `run:${event.linkedRunId}`, kind: "triggered" });
        nodes.push({ id: `memoryevent:${event.id}`, type: "brain-event", label: (event.summary || event.type).slice(0, 44), source: "brain-events.jsonl" });
      }
    }
  } catch { /* non-fatal */ }

  /* Agent runs */
  try {
    const runs = listAgentRuns({ limit: 20 }).filter((run) => run.workspace === tenantId);
    for (const run of runs.slice(0, 10)) {
      const id = `run:${run.id}`;
      const node: GraphNode = { id, type: "agent-run", label: run.title.slice(0, 48), source: "agent-runs.jsonl", state: run.state };
      if (run.state === "failed") mark(node, "This run failed — work stopped here.");
      nodes.push(node);
      edges.push({ from: orgNode, to: id, kind: "executed" });
    }
  } catch { /* non-fatal */ }

  /* Approvals */
  try {
    const queue = await readApprovalQueueRecords({ limit: 100 });
    for (const record of queue.records.filter((entry) => entry.approval?.tenant_context?.tenant_id === tenantId).slice(0, 8)) {
      const id = `approval:${record.queue_id}`;
      const node: GraphNode = { id, type: "approval", label: record.approval.action_type.slice(0, 44), source: "hermes-approvals.jsonl", state: record.queue_status };
      if (record.queue_status === "pending") {
        mark(node, "Waiting on the owner — downstream work is blocked until this is decided.");
      }
      nodes.push(node);
      edges.push({ from: orgNode, to: id, kind: "requires_decision" });
    }
  } catch { /* non-fatal */ }

  /* Automations — platform jobs visible to workspace owners/admins */
  if (access.canManage) {
    try {
      const jobs = await listAutomationJobs();
      for (const job of jobs.slice(0, 16)) {
        const id = `automation:${job.id}`;
        const node: GraphNode = {
          id, type: "automation", label: job.name.slice(0, 44), source: "automation-engine",
          state: !job.enabled ? "paused" : job.last_status === "error" ? "failing" : job.last_status === "ok" ? "healthy" : "never_run",
        };
        if (job.enabled && job.last_status === "error") {
          mark(node, `Last run failed: ${String(job.last_summary ?? "no summary").slice(0, 90)}`);
        }
        nodes.push(node);
        edges.push({ from: orgNode, to: id, kind: "operates" });
      }
    } catch { /* non-fatal */ }
  }

  /* Asset Cloud + Sites (database-backed) */
  if (access.orgId) {
    try {
      const assets = await readAssets(access.orgId);
      for (const asset of assets.recent.slice(0, 10)) {
        const id = `asset:${asset.id}`;
        nodes.push({ id, type: "asset", label: asset.title.slice(0, 44), source: "asset-cloud (db)" });
        edges.push({ from: orgNode, to: id, kind: "owns" });
      }
    } catch { /* non-fatal */ }
    try {
      const sites = await readSites(access.orgId);
      for (const name of sites.names) {
        const id = `site:${name}`;
        nodes.push({ id, type: "website", label: name.slice(0, 44), source: "sites (db)" });
        edges.push({ from: orgNode, to: id, kind: "publishes" });
      }
    } catch { /* non-fatal */ }
  } else {
    const id = "system:asset-cloud";
    nodes.push({ id, type: "system", label: "Asset Cloud", source: "database" });
    mark(nodes[nodes.length - 1], "Asset Cloud isn't connected for this workspace — creative memory is offline.");
    edges.push({ from: orgNode, to: id, kind: "missing_integration" });
  }

  /* Deduplicate nodes (edges may have introduced placeholders) and drop
     edges whose endpoints don't exist so the client never renders ghosts. */
  const seen = new Map<string, GraphNode>();
  for (const node of nodes) if (!seen.has(node.id)) seen.set(node.id, node);
  const finalNodes = [...seen.values()];
  const ids = new Set(finalNodes.map((node) => node.id));
  const finalEdges = edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to));

  return { tenantId, generatedAt: new Date().toISOString(), nodes: finalNodes, edges: finalEdges, gaps };
}

/* ── Opportunity Engine ───────────────────────────────────────────────────
   Continuous graph analysis turned into actionable next moves. Every
   opportunity is DERIVED from the same real reads as the pulse — each one
   carries provenance (the store + node it came from) and a route the user
   can act on. Nothing here is fabricated: no rule fires without a matching
   record, and an empty workspace produces setup opportunities, not fiction. */

export type Opportunity = {
  id: string;
  impact: "high" | "medium" | "low";
  title: string;
  why: string;
  provenance: { source: string; nodeId?: string };
  action: { label: string; route: string };
};

export async function getOrganizationOpportunities(
  session: AccessSession,
  access: PulseAccess,
  precomputedPulse?: OrganizationPulse,
): Promise<{ tenantId: string; generatedAt: string; opportunities: Opportunity[] }> {
  const pulse = precomputedPulse ?? await getOrganizationPulse(session, access);
  const opportunities: Opportunity[] = [];
  const push = (opportunity: Opportunity) => opportunities.push(opportunity);

  if (pulse.approvals.available && pulse.approvals.pending > 0) {
    push({
      id: "approvals-pending", impact: "high",
      title: `${pulse.approvals.pending} approval(s) are blocking work`,
      why: `Waiting in the queue: ${pulse.approvals.latest.map((item) => item.action).join(", ")}. Nothing downstream moves until these are decided.`,
      provenance: { source: "hermes-approvals.jsonl", nodeId: pulse.approvals.latest[0] ? `approval:${pulse.approvals.latest[0].id}` : undefined },
      action: { label: "Review approvals", route: "approvals" },
    });
  }
  if (pulse.automations.available && pulse.automations.failing.length > 0) {
    for (const job of pulse.automations.failing.slice(0, 3)) {
      push({
        id: `automation-failing:${job.id}`, impact: "high",
        title: `Platform automation failing: ${job.name}`,
        why: `${job.lastSummary || "The last run reported an error."} This is a platform-level job — it affects the whole PhantomForce install, not just this workspace.`,
        provenance: { source: "automation-engine", nodeId: `automation:${job.id}` },
        action: { label: "Open automations", route: "automation" },
      });
    }
  }
  if (pulse.agentRuns.available && pulse.agentRuns.failed > 0) {
    push({
      id: "runs-failed", impact: "medium",
      title: `${pulse.agentRuns.failed} agent run(s) failed`,
      why: "Work stopped mid-flight. Review what broke; most runs can be retried once the cause is fixed.",
      provenance: { source: "agent-runs.jsonl" },
      action: { label: "Review runs", route: "automation" },
    });
  }
  if (pulse.managedGrowth.available) {
    const growth = pulse.managedGrowth;
    growth.nextActions.slice(0, 3).forEach((nextAction, index) => {
      const urgent = growth.criticalBlockers > 0 || growth.followUpsDue > 0 || growth.pendingWorkspaceApprovals > 0;
      push({
        id: `managed-growth:${index}:${nextAction.surface}`,
        impact: urgent || nextAction.requiresApproval ? "high" : growth.blockerCount > 0 ? "medium" : "low",
        title: nextAction.title,
        why: `${nextAction.detail} Backed by ${growth.sourceDocuments} server document(s): client setup, CRM, proposals, and workspace approvals.`,
        provenance: { source: "managed-growth-report", nodeId: `managed-growth:${pulse.tenantId}` },
        action: { label: `Open ${nextAction.surface}`, route: nextAction.surface },
      });
    });
  }
  if (pulse.competitors.available) {
    const c = pulse.competitors;
    if (!c.businessName) {
      push({
        id: "profile-missing", impact: "high",
        title: "Phantom doesn't know what your business is yet",
        why: "Competitor discovery, deep dives, and tailored recommendations all start from the business profile.",
        provenance: { source: "competitor-intelligence.businessProfile" },
        action: { label: "Set up the profile", route: "competitor-intelligence" },
      });
    } else if (c.competitorCount === 0 && c.discoveryRuns === 0) {
      push({
        id: "discovery-never-run", impact: "high",
        title: "You aren't tracking any competitors",
        why: `The profile for ${c.businessName} is set, but discovery has never run — you're operating without competitive awareness.`,
        provenance: { source: "competitor-intelligence.discoveryRuns" },
        action: { label: "Find competitors", route: "competitor-intelligence" },
      });
    }
    if (c.competitorsWithoutSignals > 0) {
      push({
        id: "competitors-unevidenced", impact: "medium",
        title: `${c.competitorsWithoutSignals} competitor(s) have no evidence`,
        why: "Tracked but empty — no public signals recorded, so they contribute nothing to estimates. Run their deep-dive dossiers and log what you find.",
        provenance: { source: "competitor-intelligence.signals" },
        action: { label: "Open deep dives", route: "competitor-intelligence" },
      });
    }
    if (c.signalCount >= 3 && c.inferenceCount === 0) {
      push({
        id: "signals-unfused", impact: "medium",
        title: `${c.signalCount} signals collected but never fused`,
        why: "Evidence is piling up without being turned into labeled estimates. Fusing is one click per competitor.",
        provenance: { source: "competitor-intelligence.inferences" },
        action: { label: "Fuse signals", route: "competitor-intelligence" },
      });
    }
  }
  if (pulse.assets.available && pulse.assets.unusedRecent > 0) {
    push({
      id: "assets-unused", impact: "medium",
      title: `${pulse.assets.unusedRecent} recent asset(s) never reused`,
      why: "Generating replacements for media you already own burns credits. Check the library before the next generation.",
      provenance: { source: "asset-cloud (db)" },
      action: { label: "Open Asset Cloud", route: "assetcloud" },
    });
  }
  if (!pulse.assets.available) {
    push({
      id: "assetcloud-disconnected", impact: "low",
      title: "Asset Cloud isn't connected here",
      why: "Without the library, Phantom can't recommend reuse and every generation starts from zero.",
      provenance: { source: "database" },
      action: { label: "See what's connected", route: "brain" },
    });
  }
  if (pulse.memories.available && pulse.memories.neverRecalled >= 3) {
    push({
      id: "memories-idle", impact: "low",
      title: `${pulse.memories.neverRecalled} saved memories have never been used`,
      why: "Stored knowledge that never informs an answer is dead weight — review, sharpen, or prune it.",
      provenance: { source: "brain-memory.jsonl" },
      action: { label: "Open the memory vault", route: "brain" },
    });
  }

  const rank = { high: 0, medium: 1, low: 2 } as const;
  opportunities.sort((left, right) => rank[left.impact] - rank[right.impact]);
  return { tenantId: pulse.tenantId, generatedAt: new Date().toISOString(), opportunities };
}
