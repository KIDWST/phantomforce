/* Signals — the cross-department generalization of the Signal object named in
   docs/ARCHITECTURE.md: "a meaningful, evidence-backed change that may
   require a decision". Today that concept exists twice, narrowly: inside
   competitor-intelligence.ts (competitor-only) and organization-pulse.ts's
   Opportunity engine (pulse-only, entitlement-blind to disconnected domains).

   This module does not add a third store or a second read path. It
   normalizes the two existing outputs — getOrganizationOpportunities() and
   getOrganizationGraph()'s honest disconnection gaps — into one Signal[]
   shape, then exposes the three-question contract other modules should call
   instead of re-deriving their own notion of "what matters":

     getWhatChanged()        -> signals tied to live queue/run/approval state
     getWhatMatters()        -> the full impact-ranked signal list
     getRecommendedActions() -> top signals that carry a concrete next step
     getBrainContract()      -> all three in one read (the shape to consume)

   Honesty rule (see docs/ARCHITECTURE.md "Safety Boundaries"): there is no
   history/diff engine in this codebase, so "what changed" is NOT a fabricated
   delta over time. It is an honestly-scoped subset — signals whose source is
   inherently live operational state (approvals queue, automation runs, agent
   runs) rather than a standing structural fact (idle memories, disconnected
   domains, unfused signals). Every Signal's `isLiveActivity` flag is how that
   subset is derived; nothing here claims a delta that wasn't actually read. */

import type { AccessSession } from "../access/session.js";
import {
  getOrganizationGraph,
  getOrganizationOpportunities,
  getOrganizationPulse,
  type GraphNode,
  type Opportunity,
  type OrganizationGraph,
  type OrganizationPulse,
  type PulseAccess,
} from "./organization-pulse.js";

export type SignalDepartment = "Growth" | "Creative" | "Operations" | "Client Care" | "Finance" | "Intelligence" | "Technology";

export type Signal = {
  id: string;
  department: SignalDepartment;
  impact: "high" | "medium" | "low";
  /* High = read directly off a live record count (queue size, run state).
     Medium = derived/interpretive (a graph disconnection, a heuristic gap). */
  confidence: "high" | "medium";
  title: string;
  whatHappened: string;
  evidence: { source: string; nodeId?: string };
  recommendedAction?: { label: string; route: string };
  /* Conservative by construction: every input here is a navigation
     recommendation, not an executed action, so both default false. Nothing
     in this module claims autonomy or an approval gate it doesn't enforce. */
  canPhantomHandle: boolean;
  approvalRequired: boolean;
  isLiveActivity: boolean;
};

export type SignalFeed = { tenantId: string; generatedAt: string; signals: Signal[] };

const LIVE_ACTIVITY_IDS = new Set(["approvals-pending", "runs-failed"]);
const isLiveActivityOpportunity = (opportunity: Opportunity) =>
  LIVE_ACTIVITY_IDS.has(opportunity.id) || opportunity.id.startsWith("automation-failing:");

const DEPARTMENT_BY_ROUTE: Record<string, SignalDepartment> = {
  approvals: "Operations",
  automation: "Technology",
  crm: "Growth",
  managedgrowth: "Growth",
  proposals: "Growth",
  "competitor-intelligence": "Intelligence",
  assetcloud: "Creative",
  brain: "Intelligence",
};

const DEPARTMENT_BY_NODE_TYPE: Record<string, SignalDepartment> = {
  system: "Technology",
  automation: "Technology",
  "agent-run": "Technology",
  competitor: "Intelligence",
  "business-profile": "Intelligence",
  "audience-gap": "Intelligence",
  "market-opportunity": "Intelligence",
  signal: "Intelligence",
  insight: "Intelligence",
  dossier: "Intelligence",
  memory: "Intelligence",
  "brain-event": "Intelligence",
  "client-setup": "Growth",
  "crm-lead": "Growth",
  proposal: "Growth",
  "managed-growth": "Growth",
  approval: "Operations",
  asset: "Creative",
  website: "Creative",
};

function departmentForOpportunity(opportunity: Opportunity): SignalDepartment {
  const byRoute = DEPARTMENT_BY_ROUTE[opportunity.action.route];
  if (byRoute) return byRoute;
  if (opportunity.provenance.source.startsWith("competitor-intelligence")) return "Intelligence";
  if (opportunity.provenance.source.includes("asset")) return "Creative";
  return "Operations";
}

function departmentForNode(node: GraphNode): SignalDepartment {
  return DEPARTMENT_BY_NODE_TYPE[node.type] ?? "Operations";
}

function signalFromOpportunity(opportunity: Opportunity): Signal {
  return {
    id: `opportunity:${opportunity.id}`,
    department: departmentForOpportunity(opportunity),
    impact: opportunity.impact,
    confidence: "high",
    title: opportunity.title,
    whatHappened: opportunity.why,
    evidence: { source: opportunity.provenance.source, nodeId: opportunity.provenance.nodeId },
    recommendedAction: { label: opportunity.action.label, route: opportunity.action.route },
    canPhantomHandle: false,
    approvalRequired: false,
    isLiveActivity: isLiveActivityOpportunity(opportunity),
  };
}

/* Graph disconnections the Opportunity engine doesn't already surface — most
   importantly entitlement-gated domains (e.g. competitor intelligence off
   for this plan), which getOrganizationOpportunities silently skips today
   because it only iterates `pulse.*.available` sections. Deduped against
   opportunities by nodeId so nothing double-reports the same gap. */
function signalsFromUncoveredGaps(graph: OrganizationGraph, coveredNodeIds: Set<string>): Signal[] {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const signals: Signal[] = [];
  for (const gap of graph.gaps) {
    if (coveredNodeIds.has(gap.nodeId)) continue;
    const node = nodesById.get(gap.nodeId);
    if (!node) continue;
    signals.push({
      id: `gap:${gap.nodeId}`,
      department: departmentForNode(node),
      impact: node.type === "system" ? "medium" : "low",
      confidence: "medium",
      title: `${node.label} is disconnected from the brain`,
      whatHappened: gap.reason,
      evidence: { source: node.source, nodeId: node.id },
      canPhantomHandle: false,
      approvalRequired: false,
      isLiveActivity: false,
    });
  }
  return signals;
}

const IMPACT_RANK = { high: 0, medium: 1, low: 2 } as const;
const sortByImpact = (signals: Signal[]) => [...signals].sort((left, right) => IMPACT_RANK[left.impact] - IMPACT_RANK[right.impact]);

export type SignalSources = { pulse?: OrganizationPulse; opportunities?: Awaited<ReturnType<typeof getOrganizationOpportunities>>; graph?: OrganizationGraph };

export async function getSignals(session: AccessSession, access: PulseAccess, precomputed?: SignalSources): Promise<SignalFeed> {
  const pulse = precomputed?.pulse ?? (await getOrganizationPulse(session, access));
  const [opportunityResult, graph] = await Promise.all([
    precomputed?.opportunities ?? getOrganizationOpportunities(session, access, pulse),
    precomputed?.graph ?? getOrganizationGraph(session, access),
  ]);

  const opportunitySignals = opportunityResult.opportunities.map(signalFromOpportunity);
  const coveredNodeIds = new Set(opportunitySignals.map((signal) => signal.evidence.nodeId).filter((id): id is string => Boolean(id)));
  const gapSignals = signalsFromUncoveredGaps(graph, coveredNodeIds);

  return {
    tenantId: pulse.tenantId,
    generatedAt: new Date().toISOString(),
    signals: sortByImpact([...opportunitySignals, ...gapSignals]),
  };
}

/* "What changed" is deliberately narrow — see the honesty note at the top of
   this file. It is the subset of live-activity signals, not a fabricated
   delta since a prior read. */
export async function getWhatChanged(session: AccessSession, access: PulseAccess, precomputed?: SignalSources): Promise<SignalFeed> {
  const feed = await getSignals(session, access, precomputed);
  return { ...feed, signals: feed.signals.filter((signal) => signal.isLiveActivity) };
}

/* "What matters" is the full impact-ranked list — the standing priority
   view, independent of whether any one item just changed. */
export async function getWhatMatters(session: AccessSession, access: PulseAccess, precomputed?: SignalSources): Promise<SignalFeed> {
  return getSignals(session, access, precomputed);
}

export async function getRecommendedActions(
  session: AccessSession,
  access: PulseAccess,
  precomputed?: SignalSources,
  limit = 8,
): Promise<SignalFeed> {
  const feed = await getSignals(session, access, precomputed);
  return { ...feed, signals: feed.signals.filter((signal) => signal.recommendedAction).slice(0, limit) };
}

export type BrainContract = {
  tenantId: string;
  generatedAt: string;
  whatChanged: Signal[];
  whatMatters: Signal[];
  recommendedActions: Signal[];
};

/* The one call other modules (dashboard frontend, business-module backends)
   should reach for instead of re-deriving their own priority logic — a
   single read shared across all three questions. */
export async function getBrainContract(session: AccessSession, access: PulseAccess): Promise<BrainContract> {
  const pulse = await getOrganizationPulse(session, access);
  const [opportunities, graph] = await Promise.all([
    getOrganizationOpportunities(session, access, pulse),
    getOrganizationGraph(session, access),
  ]);
  const precomputed = { pulse, opportunities, graph };
  const feed = await getSignals(session, access, precomputed);
  return {
    tenantId: feed.tenantId,
    generatedAt: feed.generatedAt,
    whatChanged: feed.signals.filter((signal) => signal.isLiveActivity),
    whatMatters: feed.signals,
    recommendedActions: feed.signals.filter((signal) => signal.recommendedAction).slice(0, 8),
  };
}
