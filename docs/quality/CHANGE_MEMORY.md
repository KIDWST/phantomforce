# PhantomForce Change Memory

This folder is the release integrity memory for work that the owner has accepted or explicitly rejected.

The problem it prevents is not a normal bug. The failure mode is stale overwrite: a good admin change ships locally, another agent or sync cycle works from old files, and the old version comes back later. The guard in `scripts/guard-change-memory.mjs` turns those owner decisions into blocking checks.

## Rules

- Accepted decisions go in `CHANGE_MEMORY.json` with `status: "active"` and required file patterns.
- Rejected or removed behavior goes in the same rule as `forbiddenPatterns`, or in a `status: "removed"` rule if there is no active replacement.
- Do not delete a rule just because the current task is inconvenient. Remove or change a rule only when Jordan explicitly reverses that decision.
- Do not store secrets, keys, tokens, cookies, passwords, customer private data, or sensitive lead data in this ledger.
- Before pushing, syncing, or telling Jordan a change is live, run:

```powershell
npm run test:change-memory
```

- Before telling Jordan the live admin is aligned, run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ops\admin-live\Test-LiveAdminSource.ps1 -Strict
```

## What This Is Not

This is not full test coverage. It is a tripwire against the exact things that have wasted the most time: old worktrees, old UI copy, old business concepts, broken org isolation, and accepted game or layout fixes disappearing.
