# Workflow reliability checkpoint — October 26, 2026

The owner explicitly requested a new active goal to keep improving PhantomForce. This checkpoint prioritizes reproducible failures and real workflow evidence. It does not claim perfection or revive the expired July evolution schedule. No new scheduled job, background service, subscription or external communication was created.

## What changed

The earlier CRM draft-identity failure came from generated contracts, not missing CRM source logic. The canonical deployment's contracts source includes `crmContactId`, but its ignored `dist/actions.js` did not. Hermes ran current TypeScript source while importing that old package entry. A matching Git commit alone could therefore conceal stale runtime behavior.

`scripts/ensure-workspace-contracts.mjs` checks that the server resolves the contracts package in the same checkout. It fingerprints contract sources, compiler package, package/config files and all generated output. It builds when either fingerprint is absent or changed, refuses a failed build or changing sources, and atomically stamps successful output. Check-only mode reports drift without rewriting files.

The normal root build and Hermes launcher use this check. Startup prepares contracts before stopping the existing listener, then sets a verified source fingerprint for `/health`. The source doctor compares the running fingerprint with the currently verified package. Existing auth, memberships, approval policy and contact/message logic remain unchanged.

Development dependencies are now installed in this isolated checkout. Its former dependency junction pointed at the canonical deployment's node_modules, causing builds here to leave the package actually imported by tests stale. That temporary link was renamed, left untouched after automatic review rejected its removal, and excluded only from local Git status. It is not served or shipped.

The full suite then exposed the initial CSS budget regression from the prior workspace panel. Its styles are now loaded on demand; the header button retains its small always-loaded style. Workspace opening and selection helpers moved into the existing workspace module. Initial CSS is 1,118,310 bytes across ten stylesheets, and main.js is below 260,000 bytes. Budgets were preserved, not raised. The normalized cache build is `phantom-live-20261026-240`.

## Verification

- The previously failing CRM growth automation test passed with a fresh, same-checkout contract build. Its provider calls use only the test's disposable loopback executor; no real messages were sent.
- New contract suite: 14 checks using real TypeScript compilation, including source and output drift, cache reuse, failed build stamp preservation and cross-checkout package rejection.
- Existing auth boundary checks passed. PowerShell launcher and source-doctor syntax parsed successfully.
- Workspace browser suite passed all three businesses at desktop, tablet and phone widths, plus single-customer explanation, refresh failure recovery, local print tool, Escape and restored focus after deferred styling.
- Nexus hardening now passes initial size budgets, accessibility/header checks, targeted recovery, traversal refusal and rollback rehearsal. Change memory passed 523 checks.
- Full release suite rerun; final outcome recorded in shared process memory with deployment verification.
- The optional separate live-ship guard twice hit its existing ten-second Windows PowerShell subprocess deadline before returning a negative-root result; no launcher was run on a real production port through that fixture. This is not reported as passing.

## Remaining work

The older business browser test still targets a removed `data-business-home` control. Trying the actual Projects control reached the right page but failed to retain/open its editor; the original scenario was preserved rather than weakening its assertions. Suspected background remounts need a focused reproduction. `store.onChange` currently remounts active pages, a risk to unsaved form and selected-file state. Prioritize this next.

The customer account cannot switch into an owner's businesses without owner authentication. The public admin hostname previously failed DNS; a local installed-app entry exists. In-app browser access was unavailable during this checkpoint, so no authenticated owner UI click-through is claimed.

## Undo

Revert this checkpoint commit and sync the canonical deployment through the normal release path. This restores the old launcher, diagnostics and workspace loading. Generated contracts are reproducible artifacts; there is no database migration, new membership or new recurring task. Do not delete unrelated worktrees or live dependencies.
