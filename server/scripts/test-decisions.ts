/* Decision Card lifecycle tests — exercises server/src/phantom-ai/decisions.ts
   against a synthetic BrainContract and a temp store, so no live tenant data
   is touched. Run: npm run test:decisions --workspace @phantomforce/server */

import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDir = mkdtempSync(join(tmpdir(), "pf-decisions-"));
process.env.PHANTOMFORCE_DECISIONS_PATH = join(tempDir, "decisions.json");
process.env.PHANTOM_HERMES_LEDGER_PATH = join(tempDir, "hermes-ledger.jsonl");

const { listDecisions, decide } = await import("../src/phantom-ai/decisions.js");
const { resolveHermesLedgerPath } = await import("../src/phantom-ai/hermes-ledger.js");

type AnySignal = {
  id: string; department: "Growth" | "Operations"; impact: "high" | "medium" | "low";
  confidence: "high" | "medium"; title: string; whatHappened: string;
  evidence: { source: string; nodeId?: string };
  recommendedAction?: { label: string; route: string };
  canPhantomHandle: boolean; approvalRequired: boolean; isLiveActivity: boolean;
};

const session = { id: "owner-1", label: "Owner", role: "admin", canManageAccess: true } as never;
const accessA = { tenantId: "tenant-a", orgId: null, competitorEntitled: false, canManage: true };
const accessB = { tenantId: "tenant-b", orgId: null, competitorEntitled: false, canManage: true };

function contractFor(tenantId: string, signals: AnySignal[]) {
  return {
    tenantId,
    generatedAt: new Date().toISOString(),
    whatChanged: signals.filter((signal) => signal.isLiveActivity),
    whatMatters: signals,
    recommendedActions: signals.filter((signal) => signal.recommendedAction),
  } as never;
}

const approvalSignal: AnySignal = {
  id: "opportunity:approvals-pending",
  department: "Operations",
  impact: "high",
  confidence: "high",
  title: "2 approvals waiting on you",
  whatHappened: "The server-confirmed approval queue has 2 pending items.",
  evidence: { source: "approval-queue", nodeId: "approvals" },
  recommendedAction: { label: "Open approvals", route: "approvals" },
  canPhantomHandle: false,
  approvalRequired: false,
  isLiveActivity: true,
};

const leadSignal: AnySignal = {
  id: "opportunity:lead-cooling",
  department: "Growth",
  impact: "medium",
  confidence: "medium",
  title: "A lead is cooling",
  whatHappened: "No contact in 9 days.",
  evidence: { source: "crm" },
  recommendedAction: { label: "Open CRM", route: "crm" },
  canPhantomHandle: false,
  approvalRequired: false,
  isLiveActivity: false,
};

let failures = 0;
function check(name: string, condition: boolean, detail = "") {
  if (condition) console.log(`ok   ${name}`);
  else { failures += 1; console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

// 1. Materialization: two signals become two open decisions, impact-ranked.
let feed = await listDecisions(session, accessA, contractFor("tenant-a", [leadSignal, approvalSignal]));
check("materializes open decisions from signals", feed.open.length === 2);
check("open decisions are impact-ranked", feed.open[0]?.impact === "high");
check("decision carries evidence + recommendation", Boolean(feed.open[0]?.evidence.source && feed.open[0]?.recommendation?.route));

// 2. Re-listing with unchanged signals does not duplicate.
feed = await listDecisions(session, accessA, contractFor("tenant-a", [leadSignal, approvalSignal]));
check("re-listing is idempotent", feed.open.length === 2);

// 3. Approve: decided, ledger written, follow-through is honest navigation.
const approvalCard = feed.open.find((decision) => decision.signalId === approvalSignal.id)!;
const approved = await decide(session, accessA, approvalCard.id, "approve");
check("approve marks the decision approved", approved.status === "approved" && approved.decidedAt !== null);
check("approve follow-through is navigation, not execution", approved.followThrough?.type === "navigation" && approved.followThrough.route === "approvals");
const ledgerRaw = await readFile(resolveHermesLedgerPath(), "utf8").catch(() => "");
check("decide writes the Hermes ledger", ledgerRaw.includes("decision_card"));

// 4. Suppression: same evidence does not re-open an approved decision.
feed = await listDecisions(session, accessA, contractFor("tenant-a", [leadSignal, approvalSignal]));
check("approved decision suppresses identical re-detection", feed.open.length === 1 && feed.decided.length === 1);

// 5. Evidence change reopens: the same signal with new content becomes a new open card.
const changedApproval = { ...approvalSignal, whatHappened: "The queue grew to 5 pending items." };
feed = await listDecisions(session, accessA, contractFor("tenant-a", [leadSignal, changedApproval]));
check("changed evidence legitimately reopens the decision", feed.open.some((decision) => decision.signalId === approvalSignal.id));

// 6. Dismiss suppresses; double-decide rejects.
const leadCard = feed.open.find((decision) => decision.signalId === leadSignal.id)!;
await decide(session, accessA, leadCard.id, "dismiss");
let doubleDecideRejected = false;
try { await decide(session, accessA, leadCard.id, "approve"); } catch { doubleDecideRejected = true; }
check("a decided card cannot be decided again", doubleDecideRejected);
feed = await listDecisions(session, accessA, contractFor("tenant-a", [leadSignal, changedApproval]));
check("dismissed decision suppresses re-detection", !feed.open.some((decision) => decision.signalId === leadSignal.id));

// 7. Withdrawn signal removes its open card (no stale claims).
feed = await listDecisions(session, accessA, contractFor("tenant-a", [leadSignal]));
check("open card is withdrawn when its signal disappears", !feed.open.some((decision) => decision.signalId === approvalSignal.id));

// 8. Modify requires-and-stores the owner note.
feed = await listDecisions(session, accessA, contractFor("tenant-a", [changedApproval]));
const modifyCard = feed.open[0]!;
const modified = await decide(session, accessA, modifyCard.id, "modify", "Escalate only the two oldest.");
check("modify stores the owner note", modified.status === "modified" && modified.ownerNote === "Escalate only the two oldest.");

// 9. Tenant isolation: tenant-b sees nothing from tenant-a.
const feedB = await listDecisions(session, accessB, contractFor("tenant-b", []));
check("tenants are isolated", feedB.open.length === 0 && feedB.decided.length === 0);
let crossTenantRejected = false;
try { await decide(session, accessB, modifyCard.id, "approve"); } catch { crossTenantRejected = true; }
check("cross-tenant decide is rejected", crossTenantRejected);

rmSync(tempDir, { recursive: true, force: true });

if (failures) { console.error(`\n${failures} decision check(s) failed.`); process.exit(1); }
console.log("\nAll decision checks passed.");
