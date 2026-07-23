# Nexus Phase 8 — Hardening and release evidence

Phase 8 closes cross-cutting gaps without inventing new product surfaces.

## Implemented boundaries

- The live static host and API add `nosniff`, frame, referrer, and permissions headers.
- Path traversal continues to fail before file access.
- The shell has a keyboard-visible skip link to the authoritative workspace landmark.
- Reduced-motion behavior includes the new navigation affordance.
- Startup no longer unregisters every service worker or deletes every cache on the origin. Build drift is repaired by the existing targeted build probe and page replacement.
- Initial-shell budgets are enforced for HTML, first-party stylesheets, and the entry module.
- PhantomStore and the cross-cutting hardening test are permanent release-critical checks.

## Runtime budgets

- `app/index.html`: less than 80 KiB.
- First-party CSS linked by the shell: no more than 12 files and less than 1,100,000 bytes total.
- `app/js/main.js`: less than 260 KiB. Feature modules remain lazy imports.

These are regression ceilings, not optimization targets.

## Release and rollback

The release path remains:

1. Run `npm run test:release-critical`.
2. Normalize one `phantom-live-*` build ID across application text assets.
3. Commit only the intended files and push `main`.
4. Run `ops/admin-live/Sync-AdminMain.ps1`.
5. Run `npm run verify:live-admin` and inspect the deployed desktop and phone views.

If a live release is unhealthy:

1. Identify the last verified commit from the release note and confirm it is an ancestor of `main`.
2. Use `git revert` on the bad release commit or commits; never rewrite shared history.
3. Run the release-critical gate against the resulting tree.
4. Push the revert commit, run the same sync command, and verify all live origins serve the reverted build.

`test:nexus-hardening` performs a non-destructive rollback rehearsal by retrieving the committed shell from Git, restoring an altered isolated copy, and verifying the exact SHA-256 content hash.

## Verification command

```powershell
npm run test:nexus-hardening
```

The test emits measured byte totals and verifies accessibility structure, targeted recovery, runtime response headers, traversal blocking, and the rollback rehearsal.
