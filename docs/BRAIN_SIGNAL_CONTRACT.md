# Brain Signal Contract

The internal API the brain exposes to other modules — the dashboard frontend
and business-module backends — instead of each one re-deriving its own
notion of "what matters". Implementation: `server/src/phantom-ai/signals.ts`.
Routes: `server/src/index.ts` (`/api/brain/signals`, `/api/brain/contract`).

## Why this exists

`docs/ARCHITECTURE.md` names **Signal** as a core object — "a meaningful,
evidence-backed change that may require a decision" — and notes it existed
twice, narrowly: inside `competitor-intelligence.ts` (competitor-only) and
`organization-pulse.ts`'s Opportunity engine (pulse-only, and silent about
domains that are disconnected/not entitled rather than just empty). This
module generalizes it into one cross-department shape without adding a third
read path — it normalizes the two existing outputs
(`getOrganizationOpportunities`, `getOrganizationGraph`'s gaps) into `Signal[]`.

## The `Signal` type

```ts
type Signal = {
  id: string;
  department: "Growth" | "Creative" | "Operations" | "Client Care" | "Finance" | "Intelligence" | "Technology";
  impact: "high" | "medium" | "low";
  confidence: "high" | "medium";      // high = read off a live record count; medium = derived/interpretive
  title: string;
  whatHappened: string;               // evidence in prose — why this signal fired
  evidence: { source: string; nodeId?: string };  // provenance: which store/graph node backs this
  recommendedAction?: { label: string; route: string };
  canPhantomHandle: boolean;          // always false today — see Honesty rule below
  approvalRequired: boolean;          // always false today — see Honesty rule below
  isLiveActivity: boolean;            // true for queue/run/approval state; used to build "what changed"
};
```

## The three questions + one convenience call

| Function | Answers | Semantics |
|---|---|---|
| `getWhatChanged(session, access)` | "What changed?" | Signals where `isLiveActivity` is true — approvals pending, agent runs failed, automations failing. **Not** a time-based diff (no history/diff engine exists) — see Honesty rule. |
| `getWhatMatters(session, access)` | "What matters?" | The full impact-ranked `Signal[]`, structural gaps included (idle memories, disconnected domains, unfused competitor signals). |
| `getRecommendedActions(session, access, precomputed?, limit=8)` | "What should happen next?" | Top signals (by impact) that carry a concrete `recommendedAction`. |
| `getBrainContract(session, access)` | All three, one read | Fetches pulse/opportunities/graph once and derives all three lists from it — call this one unless you specifically need only one slice. |

REST:

- `GET /api/brain/signals` → `{ ok, tenantId, generatedAt, signals: Signal[] }`
- `GET /api/brain/contract` → `{ ok, tenantId, generatedAt, whatChanged, whatMatters, recommendedActions }`

Both accept `?tenant_id=` the same way `/api/organization/*` does (owner/admin
sessions only; otherwise scoped to the caller's own tenant).

## Honesty rule (non-negotiable, per `docs/ARCHITECTURE.md` Safety Boundaries)

Every signal here is a **navigation recommendation**, not an executed action.
`canPhantomHandle` and `approvalRequired` are hard-coded `false` because
nothing in this module executes anything — it only points at a surface for a
human to review. If a future signal source genuinely gains autonomous
handling (e.g. an automation retry Phantom can run itself), that source's
mapping function is where `canPhantomHandle`/`approvalRequired` should be set
per-signal — never flip the default, add real capability first.

Similarly, "what changed" does not claim a delta it didn't compute. It is the
honestly-scoped subset of signals whose source is inherently live queue/run
state. Extending it to a true time-based diff would require persisting a
prior snapshot and belongs in a follow-up, not a silent assumption here.

## Extending this to a new module

When a new business module wants its state to surface as brain signals:

1. Add it to `organization-pulse.ts`'s pulse/opportunity read first (that's
   the established live-read pattern — `safe()` wrapper, `{available, ...}`
   sections). Do not add a second aggregation layer.
2. If the module can be meaningfully "disconnected" (not just empty), also
   add a graph node/gap for it in `getOrganizationGraph` so
   `signalsFromUncoveredGaps` in `signals.ts` picks it up even when no
   Opportunity exists for it yet (e.g. an entitlement-gated domain).
3. If the new opportunity/gap needs a department other than what the
   `DEPARTMENT_BY_ROUTE` / `DEPARTMENT_BY_NODE_TYPE` lookups in `signals.ts`
   already infer, add an explicit entry rather than relying on the fallback.
