# PhantomForce Site Inventory

Last updated: 2026-07-19

Scope: static repository discovery, server route extraction from
`server/src/index.ts`, application navigation from `app/js/main.js`, local
runtime evidence in `run-evidence/first-real-run-20260714-153002`, Cycle 1
Headless Edge smoke, the 2026-07-16 responsive matrix, and Cycle 29's real
database-auth two-organization 90-turn conversation proof at 1440x900 and
390x844.

## Public Web

| Route | Auth | Purpose | Main actions | States | Related tests | Known problems |
|---|---:|---|---|---|---|---|
| `/` | No | Public PhantomForce landing page on GitHub Pages/static server. | Read product story, follow CTAs. | Normal, 404 redirect through static host. | Build/static smoke only this cycle. | Needs deeper public copy, SEO, and CTA audit. |
| `/index.html` | No | Same public landing bundle. | Same as `/`. | Normal. | Build/static smoke only this cycle. | Public route inventory is shallow this cycle. |
| `/404.html` | No | Static not-found page. | Return to known destination. | 404. | Not browser-verified this cycle. | Needs runtime 404/deep-link audit. |
| `/robots.txt` | No | Search crawler rule. | Read. | Static. | Static inspection. | Needs private route indexing review. |
| `/sitemap.xml` | No | Public route discovery for search. | Read. | Static. | Static inspection. | Currently very small; likely under-represents public content. |

## Admin Application Shell

| Route | Auth | Purpose | Main actions | States | Related tests | Known problems |
|---|---:|---|---|---|---|---|
| `/app` | Depends host/session | Redirect to `/app/index.html`. | Enter app. | Redirect. | Server route extraction. | Needs browser redirect/history audit. |
| `/app/index.html` | Owner/admin/local gate | Business Manager shell. | Login, switch modules, use command/chat. | Logged out, owner logged in, mobile nav, hash route, gate hidden, split desktop sidebar. | `npm run build`, `npm run test:customization-ui`, Headless Edge 1440/375 smoke. | Full mobile/module visual QA not complete. |
| `#/ws/:workspace` | Owner/admin/client depending workspace | Deep link to workspace. | Route to dashboard/module. | Valid workspace, invalid hash fallback. | UI sweep clicked visible nav. | Browser history and invalid deep links need deeper testing. |
| `#/page/:workspace` | Owner/admin/client depending workspace | Page-style workspace route. | Open full workspace page. | Valid page, invalid hash fallback. | UI sweep partial. | Needs direct deep-link coverage. |

## Auth And Account Routes

| Route | Auth | Purpose | Main actions | States | Related tests | Known problems |
|---|---:|---|---|---|---|---|
| `/auth/owner-login` | No | Owner/admin login. | Submit owner credentials. | Success, invalid, host restriction. | First real run harness; auth suites exist. | Do not print secrets in tests. |
| `/auth/demo-login` | No/local config | Demo/local session login. | Select test/admin/client session. | Enabled, disabled. | Multiple server tests. | Demo-only, not production auth. |
| `/auth/login` | No/database config | Database user login. | Email/password login. | Enabled, disabled, invalid, host restriction. | Auth boundary tests. | Needs browser registration/recovery audit. |
| `/auth/logout` | Yes | End session. | Logout/revoke DB session. | DB session, stateless session. | Auth tests. | UI logout flow not fully exercised this cycle. |
| `/auth/me` | Yes | Current account/org state. | Read memberships, entitlements. | Legacy, database. | Cycle 18 DB-auth browser fixture. | Two-membership browser state and active-org persistence verified. |
| `/auth/switch-org` | DB session | Switch active organization. | Change org. | Member, non-member denied. | 56 API checks plus Cycle 18 browser fixture. | Valid two-org switching and forged non-member rejection verified. |
| `/auth/invitations/accept` | No/database config | Accept org invite. | Create/claim account. | Valid, expired, invalid. | Auth tests. | Browser onboarding and recovery not audited. |

## Authenticated Navigation Destinations

| Workspace | Auth | Primary purpose | Main actions | Important states | Related tests | Last audit | Known problems |
|---|---:|---|---|---|---|---|---|
| Dashboard | Yes | Operating summary and chat entry. | Ask Phantom, review plan. | Empty data, live pulse, isolated immediate follow-up, named-topic return, causal/comparison/event callback, scoped rollback. | 56-prompt brain suite; 157-request live-model gate; Cycle 29 90-turn browser journey. | 2026-07-19 | Needs accessibility/keyboard pass. |
| Clients | Yes | CRM pipeline. | Create/update leads, statuses. | Empty, lead list, proposal-linked. | `test:crm-pipeline`; Cycle 19 two-org browser. | 2026-07-18 | Two-way tenant isolation, forged-label authority, and reload verified. |
| Client Setup | Owner/admin | Client/workspace setup slots. | Configure packages, modules, lead sources. | Active, pending, empty. | `test:client-setup-console`; API harness. | 2026-07-14 | Needs long-content/mobile form audit. |
| Media Lab | Yes | Media generation/editing. | Create, edit, rembg, provider status. | Provider ready/off, pending jobs. | Media tests exist; 2026-07-16 responsive matrix. | 2026-07-16 | Needs interaction-level editor/mobile form audit. |
| Websites | Yes | Website/domain prompt builder. | Prompt site changes, build/manage domains. | Empty, build, publish approval. | `test:workspace-site-builder`, site-store. | 2026-07-14 | Needs public copy and onboarding simplification audit. |
| Accounting | Owner/admin | Transactions/import/accounting surface. | Review accounts/imports/manual records. | Empty/manual/provider not connected. | Cycle 19 two-org browser. | 2026-07-18 | Manual transaction and connector-request isolation verified; live bank/card adapters need deeper tests. |
| Planner | Yes | AI planner, prep queue, automation coverage. | Add plan blocks, review prep. | Empty, populated, stock automations. | `test:ai-planner`. | 2026-07-14 | Needs keyboard/mobile audit. |
| PhantomPlay | Yes | Game launch/management surface. | Launch/play/configure games. | V1/V2, catalog, leaderboard. | `test:phantomplay`; API harness; 2026-07-16 responsive matrix. | 2026-07-16 | Penalty Kick catalog visibility fixed; mobile game play still needs deeper QA. |
| Competitor Intelligence | Owner/admin | Market scout and public-signal intelligence. | Scout, add competitors/signals. | Unavailable, ready, aggressive. | `test:competitor-intelligence`; API harness. | 2026-07-14 | Scout is structured but not live web research. |
| Analytics | Owner/admin | Social/content analytics. | Review metrics/connectors. | Empty, connector missing, synced. | `test-social-analytics`. | 2026-07-14 | Needs connector/error-state audit. |
| Memory | Owner/admin | Memory vs temporary history. | Review/add/edit/delete memory. | Empty, saved, expiring, organization switch. | `test:memory`; Cycle 18 DB-auth browser fixture. | 2026-07-18 | Two-way organization isolation is verified; UI edit/delete keyboard pass remains. |
| Automations | Owner/admin | Scheduled automation controls. | Toggle/run/edit bundles. | Collapsed, expanded, enabled/disabled, logs. | `test:automation-workspace`; API harness. | 2026-07-14 | Needs switch-only behavior browser regression. |
| Approvals | Owner/admin | Approval queue. | Approve/request changes/decline. | Empty, pending, decided. | `test:workspace-approvals`; Cycle 19 two-org browser. | 2026-07-18 | Tenant isolation and authoritative hydration verified; destructive-action confirmation still needs audit. |
| Workforce | Owner/admin | Worker map and operational force view. | Inspect workers/departments. | Baseline, active, mapped. | UI sweep. | 2026-07-14 | Worker counts need real proof/terminology audit. |
| Away Mode | Owner/admin | Vacation/coverage mode. | Activate/deactivate, settings, approvals. | Off, on, approvals. | Vacation server tests. | 2026-07-14 | UI text sample was thin; needs route-specific audit. |
| Settings | Yes by role | Business Manager settings. | Configure model/settings/nav. | Owner/admin/client variants. | UI sweep; 2026-07-16 responsive matrix; `test:settings-connections`. | 2026-07-16 | Needs form-submit and keyboard pass. |
| Developer | Owner | Developer control room. | Inspect providers, runs, tooling. | Provider ready/off, logs. | UI sweep. | 2026-07-14 | Should remain role/capability, not org identity. |

## Server API Groups

Machine route extraction found 150+ Fastify routes in `server/src/index.ts`.
See `docs/quality/site-surface.json` for grouped machine-readable coverage.

## Coverage Gaps For Next Cycles

- Browser registration, invitation acceptance, recovery, logout, expired
  sessions, and permission-denied recovery states.
- Interaction-level mobile/browser checks after the 2026-07-16 viewport matrix
  proved no horizontal overflow or clipped visible control text across seven
  app destinations at 320, 375, 768, 1024, 1440, and 1920px.
- Keyboard-only and reduced-motion interaction pass.
- Public landing, pricing, workspace profile, role/module, and subscription
  explanation audit.
- 404, redirects, deep links, browser history, and permission-denied states.
