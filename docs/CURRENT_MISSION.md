# PhantomForce — Current Mission

This document changes as the product evolves. It names the priority for
*right now*. Timeless vision, philosophy, and architecture live in
`docs/PHANTOM_VISION.md`, `docs/PRINCIPLES.md`, and `docs/ARCHITECTURE.md` —
this doc doesn't repeat them, it applies them.

## The priority

Transform PhantomForce from an AI tool suite into an operating intelligence.

Concretely: rearchitect around **Command, Outcomes, Signals, Decision
Cards, Institutional Memory, Workforce, Evidence, and approval-safe
execution** — the objects and flow defined in `docs/ARCHITECTURE.md.` Today
the product has strong individual capability (Media Lab, Content Hub,
Competitor Intelligence, the agent-run engine, Vacation Mode, the Brain/
Hermes memory layer) that is not yet unified around a single "what does the
business need next" experience. That unification is the work.

## Rules

- **Maintain every existing working capability.** Nothing gets removed to
  make room for the new architecture; it gets connected to it.
- **Do not redesign for appearance.** A screen that looks better but changes
  nothing about what the owner has to think about is not progress here.
- **Architecture first, UI second.** Land the object/data model (Outcome,
  Signal, Decision, Evidence) before styling its surface.
- **Do not duplicate systems that already exist.** Before building
  something new, check `docs/ARCHITECTURE.md`'s object table and
  `docs/RELEASE_CANDIDATE_TRUTH_MAP.md`. Extend `neural-spine.ts` instead of
  a second memory store; extend `agent-workforce.ts` instead of a second
  worker registry; extend `approval-queue.ts`/`agent-runs.ts` instead of a
  second approval path.
- **Extend what exists where possible.** The fastest path to "Signals" is
  generalizing the pattern already proven in `competitor-intelligence.ts`,
  not inventing a parallel evidence format.

## Current gaps (as of this writing)

Per `docs/PHASE_III_BRAIN_GAP_MAP.md` and `docs/ARCHITECTURE.md`'s object
table, the named gaps are:

1. **Outcome** has no first-class record yet — it's implicit across CRM
   pipeline, managed growth, and proposals. Needs a unifying data model.
2. **Signal** exists only inside Competitor Intelligence. Needs to become a
   cross-department object (content, finance, CRM, automation health all
   need to emit Signals, not just competitors).
3. **Decision Card** doesn't exist as a packaging layer yet — Signals need a
   recommendation + evidence + approve/modify/dismiss surface distinct from
   the Approval Queue's risk-gate role.
4. **Editable Memory Vault, behavioral profile, and context-preview
   endpoint** are the named-missing pieces of the Brain (`neural-spine.ts`)
   per the gap map — the ledger/ingestion side already exists.
5. **Command home screen** doesn't yet read as "three things need
   attention" — it needs to surface Decision Cards and an honest
   away-time summary, not a generic dashboard.

## Also prioritize

Real connected behavior over decorative UI; useful defaults for new
accounts; a clean mobile experience; accurate status everywhere (no
optimistic/fake state); memory and context actually reaching chat and
recommendations; automation and worker proof that matches
`docs/WORKFORCE_REALITY_AUDIT.md`'s truthful-topology standard; Media Lab
and Content Hub reliability; simple, legible owner control over what
Phantom is allowed to do alone.
