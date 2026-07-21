/* Decisions — the Decision Card packaging layer named in docs/ARCHITECTURE.md:
   "a structured recommendation the owner approves, modifies, or dismisses in
   one action — distinct from an Approval, which is the risk gate *after* a
   decision is made."

   This module is deliberately a PACKAGING layer, not a new detection engine
   and not a new execution path (both are architecture rules):

   - Detection stays in signals.ts (`getBrainContract`) — Decisions are
     materialized FROM the live Signal feed on read. A Decision adds owner
     state (open / approved / modified / dismissed) on top of a Signal; it
     never invents a finding the Signal layer didn't produce.
   - Execution stays where it lives today. Every current Signal's
     recommendation is a navigation step by construction (see signals.ts),
     so approving a Decision honestly records the owner's choice, writes the
     evidence trail to the Hermes ledger, and returns the route for the UI
     to open. Nothing here claims an external action was executed — when
     Signals gain run-capable actions, follow-through routes through the ONE
     agent-run engine, not through this file.

   Lifecycle honesty:
   - A decided (approved/modified/dismissed) card suppresses re-surfacing of
     the same signal WHILE THE UNDERLYING EVIDENCE IS UNCHANGED. The
     suppression key is a content hash of what the signal actually says — if
     the situation changes, the card legitimately returns as a new open
     Decision. Dismissals additionally expire after DISMISS_SUPPRESS_DAYS so
     a standing problem the owner snoozed does not stay invisible forever. */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { AccessSession } from "../access/session.js";
import { appendHermesLedgerRecord } from "./hermes-ledger.js";
import { getBrainContract, type BrainContract, type Signal, type SignalDepartment } from "./signals.js";
import type { PulseAccess } from "./organization-pulse.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../../..");
const storePath = process.env.PHANTOMFORCE_DECISIONS_PATH || resolve(repoRoot, ".phantom", "decisions.json");

const DISMISS_SUPPRESS_DAYS = 7;
const DECIDED_RETENTION_DAYS = 30;
const MAX_DECIDED_PER_TENANT = 200;

export type DecisionStatus = "open" | "approved" | "modified" | "dismissed";

export type DecisionRecord = {
  id: string;
  tenantId: string;
  signalId: string;
  /* Hash of the signal's observable content — the suppression/reopen key. */
  evidenceHash: string;
  department: SignalDepartment;
  impact: "high" | "medium" | "low";
  confidence: "high" | "medium";
  title: string;
  whatHappened: string;
  evidence: { source: string; nodeId?: string };
  recommendation: { label: string; route: string } | null;
  canPhantomHandle: boolean;
  approvalRequired: boolean;
  status: DecisionStatus;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  /* Owner's modification note — only set when status is "modified". */
  ownerNote: string | null;
  /* Honest record of what deciding actually did. Today every follow-through
     is navigation; nothing external executes from this layer. */
  followThrough: { type: "navigation"; route: string | null; detail: string } | null;
};

type DecisionStore = { version: 1; tenants: Record<string, Record<string, DecisionRecord>> };

const now = () => new Date().toISOString();
const daysAgo = (iso: string) => (Date.now() - Date.parse(iso)) / 86_400_000;

function contentHash(signal: Signal) {
  return createHash("sha256")
    .update(`${signal.id}|${signal.title}|${signal.whatHappened}|${signal.recommendedAction?.route ?? ""}`)
    .digest("hex")
    .slice(0, 16);
}

function decisionIdFor(signal: Signal, hash: string) {
  return `decision:${signal.id}:${hash}`;
}

async function readStore(): Promise<DecisionStore> {
  try {
    const parsed = JSON.parse(await readFile(storePath, "utf8")) as { tenants?: DecisionStore["tenants"] };
    return { version: 1, tenants: parsed.tenants || {} };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, tenants: {} };
    throw error;
  }
}

async function writeStore(store: DecisionStore) {
  await mkdir(dirname(storePath), { recursive: true });
  await writeFile(storePath, JSON.stringify(store, null, 2), "utf8");
}

/* Decided records suppress an identical re-detection; dismissals expire so a
   snoozed standing problem eventually resurfaces. */
function suppresses(record: DecisionRecord): boolean {
  if (record.status === "open") return false;
  if (record.status === "dismissed") return daysAgo(record.decidedAt || record.createdAt) < DISMISS_SUPPRESS_DAYS;
  return true; // approved/modified stay decided for this evidence state
}

function pruneTenant(records: Record<string, DecisionRecord>) {
  const decided = Object.values(records)
    .filter((record) => record.status !== "open")
    .sort((left, right) => (right.decidedAt || "").localeCompare(left.decidedAt || ""));
  for (const record of decided) {
    const tooOld = daysAgo(record.decidedAt || record.createdAt) > DECIDED_RETENTION_DAYS;
    const overCap = decided.indexOf(record) >= MAX_DECIDED_PER_TENANT;
    if (tooOld || overCap) delete records[record.id];
  }
}

function fromSignal(tenantId: string, signal: Signal): DecisionRecord {
  const hash = contentHash(signal);
  return {
    id: decisionIdFor(signal, hash),
    tenantId,
    signalId: signal.id,
    evidenceHash: hash,
    department: signal.department,
    impact: signal.impact,
    confidence: signal.confidence,
    title: signal.title,
    whatHappened: signal.whatHappened,
    evidence: signal.evidence,
    recommendation: signal.recommendedAction ?? null,
    canPhantomHandle: signal.canPhantomHandle,
    approvalRequired: signal.approvalRequired,
    status: "open",
    createdAt: now(),
    decidedAt: null,
    decidedBy: null,
    ownerNote: null,
    followThrough: null,
  };
}

export type DecisionFeed = {
  tenantId: string;
  generatedAt: string;
  open: DecisionRecord[];
  decided: DecisionRecord[];
};

const IMPACT_RANK = { high: 0, medium: 1, low: 2 } as const;

/* Materialize the current Decision feed for a tenant: read live signals,
   upsert open cards for anything not suppressed by a prior decision on the
   same evidence, and drop open cards whose signal disappeared (the situation
   resolved itself — an open card for a gone signal would be a stale claim). */
export async function listDecisions(
  session: AccessSession,
  access: PulseAccess,
  precomputed?: BrainContract,
): Promise<DecisionFeed> {
  const contract = precomputed ?? (await getBrainContract(session, access));
  const tenantId = contract.tenantId;
  const store = await readStore();
  const records = store.tenants[tenantId] || (store.tenants[tenantId] = {});

  const liveIds = new Set<string>();
  for (const signal of contract.whatMatters) {
    const hash = contentHash(signal);
    const id = decisionIdFor(signal, hash);
    liveIds.add(id);
    const existing = records[id];
    if (existing) continue; // open stays open; decided keeps its state
    const priorDecisionsForSignal = Object.values(records).filter((record) => record.signalId === signal.id);
    const suppressed = priorDecisionsForSignal.some((record) => record.evidenceHash === hash && suppresses(record));
    if (suppressed) continue;
    // Evidence changed (new hash) or first sighting: stale OPEN cards for the
    // same signal are replaced; decided history for old evidence is retained.
    for (const prior of priorDecisionsForSignal) {
      if (prior.status === "open" && prior.evidenceHash !== hash) delete records[prior.id];
    }
    records[id] = fromSignal(tenantId, signal);
  }

  // An open card whose signal is no longer detected is withdrawn honestly.
  for (const record of Object.values(records)) {
    if (record.status === "open" && !liveIds.has(record.id)) delete records[record.id];
  }

  pruneTenant(records);
  await writeStore(store);

  const all = Object.values(records);
  return {
    tenantId,
    generatedAt: now(),
    open: all
      .filter((record) => record.status === "open")
      .sort((left, right) => IMPACT_RANK[left.impact] - IMPACT_RANK[right.impact]),
    decided: all
      .filter((record) => record.status !== "open")
      .sort((left, right) => (right.decidedAt || "").localeCompare(left.decidedAt || ""))
      .slice(0, 20),
  };
}

export type DecideAction = "approve" | "modify" | "dismiss";

const STATUS_FOR_ACTION: Record<DecideAction, DecisionStatus> = {
  approve: "approved",
  modify: "modified",
  dismiss: "dismissed",
};

export async function decide(
  session: AccessSession,
  access: PulseAccess,
  decisionId: string,
  action: DecideAction,
  note?: string,
): Promise<DecisionRecord> {
  if (!STATUS_FOR_ACTION[action]) throw new Error(`Unknown decision action: ${String(action)}`);
  const store = await readStore();
  const records = store.tenants[access.tenantId];
  const record = records?.[decisionId];
  if (!record) throw new Error("Decision not found for this organization.");
  if (record.status !== "open") throw new Error(`Decision is already ${record.status}.`);

  record.status = STATUS_FOR_ACTION[action];
  record.decidedAt = now();
  record.decidedBy = session.id || session.email || "owner";
  record.ownerNote = action === "modify" ? String(note || "").slice(0, 500) || null : null;
  record.followThrough =
    action === "dismiss"
      ? null
      : {
          type: "navigation",
          route: record.recommendation?.route ?? null,
          detail: record.recommendation
            ? `Owner ${action === "approve" ? "approved" : "modified"} the recommendation; PhantomForce opens ${record.recommendation.label}. No external action was executed by this decision.`
            : "Owner acknowledged the finding. No external action was executed by this decision.",
        };

  await writeStore(store);

  await appendHermesLedgerRecord({
    timestamp: record.decidedAt,
    tenant_id: record.tenantId,
    business_name: access.tenantId,
    actor_user_id: record.decidedBy,
    actor_role: session.isSuperAdmin ? "platform_admin" : "business_owner",
    request_id: record.id,
    task_type: "decision_card",
    sensitivity_level: "low",
    provider_route: "local",
    model_id: "deterministic-decision-layer",
    context_chars: 0,
    estimated_tokens: 0,
    estimated_cost_usd: null,
    user_request_summary: `${action}: ${record.title}`.slice(0, 200),
    result_summary: (record.followThrough?.detail || `Decision ${record.status} with no follow-through action.`).slice(0, 300),
    approval_required: record.approvalRequired,
    approval_status: "not_required",
    risks: [],
    next_action: record.followThrough?.route ? `open:${record.followThrough.route}` : "none",
  });

  return record;
}
