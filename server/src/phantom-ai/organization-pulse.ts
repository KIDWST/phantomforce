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

type Unavailable = { available: false; reason: string };
type Section<T> = ({ available: true } & T) | Unavailable;

export type OrganizationPulse = {
  tenantId: string;
  generatedAt: string;
  approvals: Section<{ pending: number; latest: Array<{ id: string; action: string; queuedAt: string }> }>;
  agentRuns: Section<{ running: number; failed: number; recent: Array<{ id: string; title: string; state: string; operation: string }> }>;
  automations: Section<{ total: number; enabled: number; failing: Array<{ id: string; name: string; lastSummary: string }> }>;
  competitors: Section<{ businessName: string; category: string; competitorCount: number; signalCount: number; inferenceCount: number; competitorsWithoutSignals: number }>;
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

export async function getOrganizationPulse(session: AccessSession, access: PulseAccess): Promise<OrganizationPulse> {
  const { tenantId, orgId } = access;

  const [approvals, agentRuns, automations, competitors, memories, assets, sites] = await Promise.all([
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
    approvals, agentRuns, automations, competitors, memories, assets, sites,
    phantomplay: { available: true, builtInGames: PHANTOMPLAY_BUILT_IN_GAMES.length },
  };
}

/* The compact awareness block injected into Phantom AI chat context. Every
   line traces to a real store read above; nothing is invented. Kept short so
   it never crowds out the user's own message or memories. */
export function buildWorkspaceAwarenessText(pulse: OrganizationPulse): string {
  const lines: string[] = [`Live workspace state (${pulse.tenantId}):`];
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
