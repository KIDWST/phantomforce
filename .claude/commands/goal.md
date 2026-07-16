# /goal — autonomous highest-value execution

Run this as an autonomous work cycle, not a conversation. Do not ask what to
do next unless you are genuinely blocked (missing credential, ambiguous
product decision only Jordan can make, or a change that would touch
live/production behavior without authorization).

## Sequence

1. **Load the spec, in this order:**
   `docs/PHANTOM_VISION.md` → `docs/PRINCIPLES.md` → `docs/ARCHITECTURE.md` →
   `docs/CURRENT_MISSION.md` → `docs/ROADMAP.md`. `AGENTS.md` governs repo
   mechanics (source of truth, cache-bust convention, push rules) — read it
   too, every time, even if you think you remember it.
2. **Inspect the codebase.** Read the relevant `app/js/*`, `server/src/**`,
   and `docs/*` before assuming a capability is missing. This product has a
   habit of already containing the thing under a different name — check
   `docs/RELEASE_CANDIDATE_TRUTH_MAP.md` and `docs/WORKFORCE_REALITY_AUDIT.md`
   for what's LIVE vs GATED vs ABSENT before building anything.
3. **Compare implementation against the vision.** Find the gap between what
   `CURRENT_MISSION.md` says the architecture should be and what the code
   actually does.
4. **Pick the single highest-value missing capability** that advances the
   current mission phase. Prefer extending an existing object/space
   (Outcome, Signal, Decision, Evidence, Approval, Memory, Department) over
   inventing a parallel one. Skip cosmetic-only work unless it's load-bearing
   for the architecture (e.g., a UI surface an already-shipped backend has no
   home in yet).
5. **Execute it fully** — backend, frontend, and the doc it touches, not a
   partial slice.
6. **Validate.** Run the relevant test scripts/checks. For UI changes, bump
   the `phantom-live-YYYYMMDD-N` build id everywhere `AGENTS.md` requires it,
   and actually look at the browser behavior.
7. **Preserve every existing working capability.** No silent regressions, no
   "removed for now."
8. **Report like the product does:** what was decided, what changed, what's
   blocked, what needs approval, next recommended action.
9. **Commit locally** when verified. Do not push, deploy, sync live admin, or
   touch billing/auth/external actions without Jordan's explicit go-ahead —
   per `AGENTS.md` and the worktree's standing rules.
10. **Continue.** Move to the next highest-value gap. Only stop when genuinely
    blocked — not when the obvious next task feels done.
