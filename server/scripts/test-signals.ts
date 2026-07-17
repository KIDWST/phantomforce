import assert from "node:assert/strict";

import type { AccessSession } from "../src/access/session.js";
import type { Opportunity, OrganizationGraph, OrganizationPulse, PulseAccess } from "../src/phantom-ai/organization-pulse.js";
import { getRecommendedActions, getSignals, getWhatChanged, getWhatMatters } from "../src/phantom-ai/signals.js";

const tenantId = "dev-org-chicagoshots";
const generatedAt = "2026-07-17T12:00:00.000Z";

/* Real shapes the opportunity engine actually produces (mirrors the fixtures
   getOrganizationOpportunities pushes for these exact ids), not fabricated
   test-only data — see organization-pulse.ts's push() calls for each id. */
const opportunities: Opportunity[] = [
  {
    id: "approvals-pending",
    impact: "high",
    title: "2 approval(s) are blocking work",
    why: "Waiting in the queue: Publish post, Send proposal.",
    provenance: { source: "hermes-approvals.jsonl", nodeId: "approval:queue-1" },
    action: { label: "Review approvals", route: "approvals" },
  },
  {
    id: "automation-failing:job-9",
    impact: "high",
    title: "Platform automation failing: Nightly digest",
    why: "Last run reported an error.",
    provenance: { source: "automation-engine", nodeId: "automation:job-9" },
    action: { label: "Open automations", route: "automation" },
  },
  {
    id: "runs-failed",
    impact: "medium",
    title: "1 agent run(s) failed",
    why: "Work stopped mid-flight.",
    provenance: { source: "agent-runs.jsonl" },
    action: { label: "Review runs", route: "automation" },
  },
  {
    id: "managed-growth:0:crm",
    impact: "medium",
    title: "Follow up with Studio",
    why: "Follow-up is due now. Backed by 4 server document(s).",
    provenance: { source: "managed-growth-report", nodeId: `managed-growth:${tenantId}` },
    action: { label: "Open crm", route: "crm" },
  },
  {
    id: "discovery-never-run",
    impact: "high",
    title: "You aren't tracking any competitors",
    why: "The profile is set, but discovery has never run.",
    provenance: { source: "competitor-intelligence.discoveryRuns" },
    action: { label: "Find competitors", route: "competitor-intelligence" },
  },
  {
    id: "memories-idle",
    impact: "low",
    title: "3 saved memories have never been used",
    why: "Stored knowledge that never informs an answer is dead weight.",
    provenance: { source: "brain-memory.jsonl" },
    action: { label: "Open the memory vault", route: "brain" },
  },
];

/* Graph gaps: one duplicates an opportunity already covered (same nodeId —
   must be deduped), one is a real uncovered gap (entitlement-gated domain
   the opportunity engine silently skips because it only iterates
   `pulse.*.available` sections). */
const graph: OrganizationGraph = {
  tenantId,
  generatedAt,
  nodes: [
    { id: "approval:queue-1", type: "approval", label: "Publish post", source: "hermes-approvals.jsonl" },
    { id: "system:competitor-intelligence", type: "system", label: "Competitor Intelligence", source: "entitlements" },
  ],
  edges: [],
  gaps: [
    { nodeId: "approval:queue-1", reason: "Waiting on the owner — downstream work is blocked." },
    { nodeId: "system:competitor-intelligence", reason: "Not enabled for this plan — no competitive awareness feeds the brain." },
  ],
};

const pulse = { tenantId, generatedAt } as unknown as OrganizationPulse;
const session = {} as AccessSession;
const access = {} as PulseAccess;
const precomputed = { pulse, opportunities: { tenantId, generatedAt, opportunities }, graph };

const feed = await getSignals(session, access, precomputed);

assert.equal(feed.tenantId, tenantId);
assert.equal(feed.signals.length, 7, "6 opportunities + 1 uncovered gap (the covered gap must be deduped)");
assert(!feed.signals.some((s) => s.id === "gap:approval:queue-1"), "gap already covered by an opportunity must not double-report");
assert(feed.signals.some((s) => s.id === "gap:system:competitor-intelligence"), "uncovered entitlement gap must surface as a signal");

const impactOrder = feed.signals.map((s) => s.impact);
for (let i = 1; i < impactOrder.length; i++) {
  const rank = { high: 0, medium: 1, low: 2 } as const;
  assert(rank[impactOrder[i - 1]] <= rank[impactOrder[i]], "signals must be sorted high -> medium -> low");
}

const byId = (id: string) => feed.signals.find((s) => s.id === id);
assert.equal(byId("opportunity:approvals-pending")?.department, "Operations");
assert.equal(byId("opportunity:automation-failing:job-9")?.department, "Technology");
assert.equal(byId("opportunity:discovery-never-run")?.department, "Intelligence");
assert.equal(byId("opportunity:memories-idle")?.department, "Intelligence");
assert.equal(byId("gap:system:competitor-intelligence")?.department, "Technology");
assert.equal(byId("gap:system:competitor-intelligence")?.confidence, "medium");
assert.equal(byId("opportunity:approvals-pending")?.canPhantomHandle, false);
assert.equal(byId("opportunity:approvals-pending")?.approvalRequired, false);

const changed = await getWhatChanged(session, access, precomputed);
assert.deepEqual(
  changed.signals.map((s) => s.id).sort(),
  ["opportunity:approvals-pending", "opportunity:automation-failing:job-9", "opportunity:runs-failed"].sort(),
  "what-changed must be exactly the live-activity subset, nothing fabricated as a delta",
);

const matters = await getWhatMatters(session, access, precomputed);
assert.equal(matters.signals.length, feed.signals.length, "what-matters is the full ranked list");

const actions = await getRecommendedActions(session, access, precomputed, 3);
assert.equal(actions.signals.length, 3, "limit is respected");
assert(actions.signals.every((s) => Boolean(s.recommendedAction)), "every recommended action must carry a route");

console.log(JSON.stringify({ ok: true, signals: feed.signals.length, changed: changed.signals.length, recommended: actions.signals.length }));
