# Restore the complete owner console on the app domain

Owner direction, October 26, 2026: restore the remembered admin site with all extras at app.phantomforce.online. Build `phantom-live-20261026-242`.

## Findings and resulting behavior

The legacy admin and current app use the same canonical repository and backend. The executive dashboard, PhantomBot, Next Move, activity, Admin, Developer, Runtime, Workforce, Away Mode, PhantomPlay and PhantomStore had not been deleted. Business profile filtering hid shared tools even for a verified platform owner. The Menu also selected a fixed subset of routes, hiding new business destinations and Workforce. Before a successful catalog response, the preserved `phantomforce-internal` organization received a neutral profile instead of the established PhantomForce presentation. The old admin hostname currently does not resolve in the tested network; copying that inaccessible hostname is unnecessary because the original implementation remains in Git and the served bundle.

The canonical app now restores the existing command-center dashboard as the platform owner's home in every business. This reuses the original implementation and styles. The Menu contains every allowed registered tool, including the existing admin extras, Workforce and business-specific destinations. Command center and Business overview are separately named: the latter opens the focused commerce, studio or business overview. Existing project, social-account, commerce and automatic print-analysis routes remain available. Occasionally Odd keeps one Customers destination.

Reserved internal/legacy organization IDs map only to the known presentation profile. Exact organization IDs, request headers, storage namespaces, current organization, records and server permissions remain unchanged. Full tool discovery depends on `isOwnerOperator()` derived from the verified account. Customers keep their existing narrowed business navigation and do not gain operator authority through a label, profile, hostname or link. No production membership, credential, cookie or record migration is performed.

The restored dashboard scopes agent names, missions, counts and local security posture to the selected business. Renderer tests exercise colliding record IDs, foreign missions, legacy unassigned rows and an empty business. The legacy Activity overlay continues to open above active print analysis and closes without remounting its underlying work.

## Runtime integrity

The source doctor reproduced an API with the correct Git commit but a null contracts fingerprint. The existing remote-stack launcher had replaced the verified API with a direct launch. Sync now checks the verified contracts fingerprint as well as the commit. Existing alternative launchers verify contracts before starting the API and pass the resulting nonsecret fingerprint. No additional service, recurring task or restart policy is created.

## Verification and undo

Focused navigation tests exercise owner tools in every profile, retained permission flags, exact internal aliases, one relationship destination and unchanged customer navigation. An isolated browser suite exercises the original owner home, delayed/unavailable catalog, 42 actual workspace opens, business switching, focused business overviews, scoped agent details/counts and security status, and customer restrictions at 1440px and 390px. It uses disposable browser profiles and local fixture APIs; it does not claim an authenticated production owner session. The existing nine-case business suite still verifies actual work-item saves, identical-ID removal isolation, reload and layout at 1440px, 390px and 320px, entering the business overview explicitly from the restored owner console.

The workspace-contract suite passes 25 checks, including real compilation, an actual supervised TypeScript entry point, stale generated-output rebuild, failure before entry on invalid contracts, child exit-status propagation, and seven PowerShell same-commit/fingerprint alignment decisions. Existing size/accessibility budgets are retained.

Release-gate results and canonical deployment evidence are recorded in the shared Obsidian continuation note after verification. The release must pass the change-memory guard, existing size/accessibility budgets and complete critical gate before deployment. The live source doctor must confirm the served root, commit, build and compiled contracts.

Undo the application release by reverting its dedicated commit on main and syncing the canonical deployment. External infrastructure launcher backups are recorded in the sanitized process note. There is no database migration to reverse.
