# Baseline and archaeology

## Authoritative checkout

- Repository worktree: `C:\Users\jorda\Documents\Codex\2026-08-16\files-mentioned-by-the-user-phantomforce\work\phantomforce-admin-app-implementation`
- Branch: `codex/phantomforce-admin-app-20260816`
- Baseline commit: `fb5814749ae20f184bd890a0ed5f14c4f76eb874`
- Baseline subject: `fix(admin): restore primary navigation and simplify search`

The existing operational checkout and the repository-recommended July worktree both contained unrelated local changes, including PhantomPlay paths. This isolated worktree was created from `origin/main` so the app/admin work and the frozen game boundary could be proven independently.

## Current product contracts

- App shell, route aliases, navigation profiles, compact drawer: `app/js/main.js`
- Route registry and product grammar: `app/js/product-grammar.js`
- Command OS responsive shell: `app/command-os.css`
- Unified analytics domains: `app/js/analytics-hub.js`
- Clients/CRM UI and workflows: `app/js/easycrm.js`, `server/src/routes/contacts.ts`
- Media and content: `app/js/medialab.js`, `app/js/contenthub.js`
- PhantomBot web workspace: `app/js/phantomai.js`, `app/js/main.js`
- Store: `app/js/phantomstore.js`, `app/phantomstore.css`
- Admin/server boundaries: `server/src`, `packages/contracts`
- Browser viewport gate: `scripts/test-responsive-viewports.mjs`

The baseline already contains the broad user/admin platform. This implementation therefore repaired measured gaps instead of replacing mature routes or inventing parallel schemas.

## Historical candidates reviewed

Recent history identifies the relevant product-contract lineage:

- `de6978f6` — Media Lab page scrolling
- `a1b84a48` — media routing and generation lanes
- `62f30262` — PhantomBot command CSS/accessibility
- `de2d38d4` — PhantomBot automation control plane
- `f98f3589` — PhantomBot account switching
- `cc46e90e` — web/desktop PhantomBot shell alignment
- `67bb78a5` — PhantomAI, Command OS, and Store updates

Those commits were treated as archaeology only. No historical implementation was blindly cherry-picked.

## Baseline runtime findings

The local demo-auth runtime loaded successfully. Before changes, browser inspection reproduced:

- Business Signals compressed into unusable multi-column cards at phone width.
- The compact navigation drawer opened without moving focus inside and did not restore focus on Escape.
- The tablet Dashboard decision deck overlapped the business brief.
- The phone decision list retained a horizontal carousel override.
- Unified Analytics placed KPI tiles before the primary chart.

External production OAuth/provider behavior was not exercised because the local runtime intentionally used demo authentication and disabled creative-engine transport.
