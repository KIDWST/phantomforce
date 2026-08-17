# Release and cache report

- Baseline commit: `fb5814749ae20f184bd890a0ed5f14c4f76eb874`
- Working branch: `codex/phantomforce-admin-app-20260816`
- Frontend cache identifier: `phantom-live-20260816-144` for the changed shell modules; unchanged modules retain `phantom-live-20260801-141` so the shared store is not instantiated twice
- Database migrations: none
- Deployment: not performed
- Commit/push: not performed

Build, typecheck, static command checks, the complete Production Core Golden Path/failure suite, strict secret scan, dependency audit, and the expanded 60-case Chrome matrix passed locally. The broad `test:release-critical` command was intentionally not run because it invokes the frozen PhantomPlay-specific suite; navigation compatibility was instead proven by the non-touch guard and shared responsive route check without a game build.

Rollback for this local-only change is reversal/removal of the isolated worktree changes. Application/schema rollback against a deployed staging data service was not possible because nothing was deployed; that remains a blocking promotion gate.
