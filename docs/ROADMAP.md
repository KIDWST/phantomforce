# PhantomForce — Roadmap

Long-term phase plan. `docs/CURRENT_MISSION.md` names what's active right
now; this document is the map of everything after it. Phases are sequenced
by dependency, not by calendar date — do not start a later phase's
deliverables before its dependencies are real, even if it looks faster.

## Phase 1 — Foundation: Command, Outcomes, Signals, Memory

**Objectives:** stand up the core object model from `docs/ARCHITECTURE.md`
so every later phase has something real to build on.

**Deliverables:**
- Outcome as a first-class record (target, deadline, metric, strategy,
  workstreams, departments, approvals, evidence, risks, costs, results).
- Signal generalized beyond Competitor Intelligence into a cross-department
  object with a shared evidence/confidence format.
- Decision Card packaging layer (Signal + recommendation + evidence →
  approve/modify/dismiss), distinct from the Approval Queue's risk gate.
- Memory Vault made editable (create/edit/forget, confidence, weight,
  retention, source events) per `docs/PHASE_III_BRAIN_GAP_MAP.md`, plus the
  context-preview endpoint.
- Command home screen rebuilt to surface Decision Cards and an honest
  away-time summary instead of a generic dashboard.

**Dependencies:** none — this is the floor everything else stands on.

**Success criteria:** the owner can open Command and see, without typing
anything, what needs attention, what Phantom already handled, and one
recommended next decision, backed by a real Outcome/Signal/Evidence record
rather than a static layout.

## Phase 2 — Department Execution

**Objectives:** make the Workforce/department view real and connect it to
Outcomes.

**Deliverables:**
- Department groupings (Growth, Creative, Operations, Client Care, Finance,
  Intelligence, Technology) surfaced over the existing agent-workforce
  topology.
- Automations and workers routable to a specific Outcome's workstreams.
- Tool/automation routing that respects the truthful-topology standard from
  `docs/WORKFORCE_REALITY_AUDIT.md` (no fake per-worker activity claims).

**Dependencies:** Phase 1's Outcome and Signal objects.

**Success criteria:** opening an Outcome shows which departments are
assigned and what they've done, without the owner needing to separately
visit Workforce.

## Phase 3 — Business Intelligence

**Objectives:** make Analytics and Intelligence explanatory and
action-producing, not just displays.

**Deliverables:**
- Analytics that explains *why* a metric moved (see the vision doc's
  engagement-drop example) and proposes replacement work.
- Competitor/market Intelligence findings that always offer a next action
  (exploit, differentiate, respond, track, reposition, ignore), building on
  `docs/COMPETITOR_INTELLIGENCE.md`'s existing evidence/confidence pattern.
- CRM/finance signals (overdue invoice, cooling lead, cash-flow risk)
  feeding the same Signal pipeline as content and competitor signals.

**Dependencies:** Phase 1's Signal/Decision pipeline; Phase 2's department
routing (a finance Signal needs to reach the Finance department view).

**Success criteria:** every Intelligence/Analytics finding a user sees has
a one-click next action attached, not just a chart.

## Phase 4 — Away Mode (Autonomous Supervision)

**Objectives:** extend the existing Vacation Mode into the fuller Away Mode
described in the vision — owner-defined outcome priorities, spend/
communication boundaries, contact rules, urgency thresholds, and briefing
cadence.

**Deliverables:**
- Away Mode configuration surface (what matters while away, what Phantom
  may decide alone, boundaries, contacts, urgency definition, report
  cadence) built on `VACATION_POLICY`/`VacationModeRun`, not a parallel
  system.
- Bounded autonomous execution of "safe" actions (draft, plan, organize,
  summarize) within the configured boundaries — matching the v0.3/v0.4
  roadmap already committed in `docs/PHANTOMFORCE_AUTONOMOUS_CREATIVE_OS.md`.
- Return-briefing report: completed / needs-approval / blocked / prevented
  duplicate work / missed-opportunity callouts.

**Dependencies:** Phase 1's Approval/Evidence objects; Phase 3's Signal
sources (Away Mode needs real Signals to act on, not synthetic ones).

**Success criteria:** the owner can leave, and return to a report that
matches the vision doc's example — specific, numbered, and honest about
what still needs a decision.

## Phase 5 — Multi-User and Org Collaboration

**Objectives:** extend beyond a single owner to teams while keeping the
approval/control model intact.

**Deliverables:** role-scoped Decision Cards and Approvals (who can approve
what), org-level Memory vs. individual-user context, department assignment
across multiple humans plus Phantom workers, audit trail across users.

**Dependencies:** Phases 1–2's object model and department structure must
be stable before adding a second axis (users/roles) on top of them.

**Success criteria:** a second team member can operate inside their
assigned departments/outcomes without seeing or approving outside their
scope, and Memory correctly separates org-level from individual context.

## Phase 6 — Marketplace / Extensible Worker Ecosystem

**Objectives:** let the tool/worker/automation substrate grow without
growing the owner's cognitive load.

**Deliverables:** a registered way to add new tools/automations/model
providers that plug into Execution and inherit the existing Evidence →
Memory → Outcome flow automatically; a review/approval path for
third-party or community-contributed workers, mirroring the moderation
model already proven in `docs/PHANTOMPLAY.md`.

**Dependencies:** Phases 1–4's object model, Approval gate, and Away Mode
boundaries must be load-bearing enough that a new worker type can plug into
them without special-casing.

**Success criteria:** a new capability (tool, automation, model provider)
can be added without inventing a new object, a new approval path, or a new
memory store.
