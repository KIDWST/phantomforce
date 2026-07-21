# ADMIN_ARCHITECTURE_MAP.md

Atlas (Worker 1) — repository map for the four-day admin-completion mission.
Audited read-only from `C:\Users\jorda\Documents\Codex\deployments\phantomforce-live`
at commit `a05590741b1e94e6fc3d7d6bb6b411e84542c181` (rollback tag
`pre-admin-completion-20260721-1332`). Scope per Atlas's assignment: `app/`
frontend, `server/src/{access,approval,crm,customization,phantom-ai,proposals,
sites,workspace-approvals}`, `server/prisma/schema.prisma`, `package.json`
scripts, and the test/build/deploy commands.

**Do not re-derive this from scratch.** The repo already carries three mature
architecture documents that this map defers to rather than duplicates:
`docs/ARCHITECTURE.md` (object model: Outcome/Signal/Decision/Approval/
Execution/Memory/Skill), `docs/RELEASE_CANDIDATE_TRUTH_MAP.md` (LIVE vs GATED
vs ABSENT feature inventory), and `docs/CURRENT_MISSION.md` (the product's own
current-priority gap list). Read those before assuming a gap is undiscovered.

## 0. Critical framing for the rest of this mission

This is **not** a green-field or half-broken admin app. It is a mature,
continuously-shipped, single-owner (Jordan) SaaS admin console with an
explicit fail-closed honesty posture: features that are intentionally
gated/dry-run (paid media spend, live DNS writes, billing checkout, email
send) are documented as GATED, not broken — see `docs/RELEASE_CANDIDATE_TRUTH_MAP.md`.
**Do not let any mission worker "fix" a documented GATED preview into silent
live execution.** That would be a regression, not progress, and several past
audits in this repo exist specifically to prevent that failure mode.

Two coordination facts change how this mission must run here:

1. **A separate, longer-running autonomous mission already operates on this
   exact repo.** `docs/quality/EVOLUTION_MISSION.md` / `EVOLUTION_STATE.json`
   describe a "seven-day evolution mission" (2026-07-19 through 2026-07-25,
   21 scheduled cycles at 08:00/14:00/20:00 America/Chicago) that edits from a
   *different* checkout (`...\Codex\worktrees\phantomforce-live-social-analytics-20260712`)
   and fast-forwards into *this* served checkout. It is currently on Cycle 1,
   `latest_stable_commit` matches this repo's history. Expect `origin/main` to
   move under this mission; AGENTS.md's own convention is "fetch + rebase
   before every push," not exclusive branch ownership.
2. **There is live, pre-existing uncommitted WIP in this checkout right now**
   (`app/js/phantomplay.js`, `server/src/phantom-ai/phantomplay.ts` modified;
   18 new untracked `app/assets/phantomplay/*-cover.svg` files) from a session
   that is neither Atlas nor, presumably, any of the six mission workers. Diff
   inspected and confirmed additive/cosmetic (game cover-art URL wiring for a
   batch of ~18 games) — unrelated to the P0 test failure below. Per this
   repo's own `CLAUDE.md`/`AGENTS.md` convention and the mission's "preserve
   current work" rule, this is left untouched, not claimed, not stashed.

Relay should decide once, explicitly, whether the six mission workers use the
mission template's dedicated branches/worktrees or fold into this repo's
existing direct-to-main-with-rebase convention — and state that decision in
`.termina/file-ownership.json` so workers don't diverge.

## 1. Entry points

- **Static admin/customer app**: `app/index.html` (single bundle serves both
  `admin.phantomforce.online` and `app.phantomforce.online`; role/authority
  differs by session, not by build). Cache-busted via `phantom-live-YYYYMMDD-N`
  build id referenced from `index.html`/`app/js/*`/`app/phantom.css`/
  `app/phantom-skin.css` — any edit to those requires bumping it everywhere or
  browsers serve stale assets. `npm run ship:live-admin` bumps this
  automatically; do not hand-edit the id in isolation.
- **Backend**: `server/src/index.ts` (not read this pass — Relay-owned route
  registration) boots a Fastify server (`@fastify/cors`, `fastify`, `zod`
  validation, Prisma client). Dev: `npm run dev:server` → `tsx watch src/index.ts`.
  Prod: `server` workspace `build` (`tsc`) → `start` (`node dist/index.js`).
- **Health check** (authoritative "is this checkout live" signal):
  `https://admin.phantomforce.online/health` → `.root` must equal this
  checkout's path; `.commit` must equal `git rev-parse HEAD`. Re-verify every
  session per this repo's own `CLAUDE.md` — it has been wrong before.
- **Database**: PostgreSQL via Prisma (`server/prisma/schema.prisma`,
  `DATABASE_URL` env). `npm run prisma:generate` at root delegates to the
  server workspace.
- **Ship gate**: `npm run ship:live-admin -- --commit "..."` — bumps build id,
  runs test gates, commits, pushes `origin/main`, verifies live URLs itself.
  **This mission's workers must never run this directly except through
  Relay** — it pushes to the shared remote and is the one command in this
  repo explicitly gated to a single owner (the served-checkout convention).
  `npm run verify:live-admin` (`--verify-only`) is the safe read-only check.

## 2. `app/js/` — frontend module inventory (52 files, flat, no framework;
vanilla JS + `void.css`/`void.js` + `app/phantom.css`/`phantom-skin.css`)

Grouped by the product's own Space taxonomy (`docs/ARCHITECTURE.md` §Primary
Spaces) rather than alphabetically, since that taxonomy is what any new nav
work must respect:

| Space | Modules |
|---|---|
| Command (home) | `main.js`, `command.js`, `missioncontrol.js`, `organizationpulse.js`, `orgs.js`, `orggraph.js` |
| Outcomes/CRM | `crmpipeline.js`, `crmprospects.js`, `finance-recurring.js`, `client-tasks.js`, `planner.js` |
| Workforce | `agentops.js`, `buddy.js`, `character.js`, `companion.js`, `companion-preferences.js` |
| Business records | `clientsetup.js`, `organization.js`, `serverrecords.js`, `store.js`, `workspaces.js` |
| Memory | `brain.js` |
| Analytics | `social-analytics.js`, `contenthub.js`, `competitor-intelligence.js` |
| Media / Content | `medialab.js`, `mediabackend.js`, `imagefilters.js`, `assetcloud.js`, `videocut.js`, `content-editor.js`, `content-ideas.js`, `promptlibrary.js`, `pageworker.js`, `sitestudio.js` |
| Approvals | `approvalpipeline.js`, `proposalpipeline.js` |
| Settings/Developer | `settings.js`, `desktop-context.js`, `customization.js` |
| Away Mode | `vacation.js` |
| Chat brain | `brain.js` (chat surface), `intent-router.js` |
| PhantomPlay/Store (customer product, not core admin) | `phantomplay.js`, `phantomplay-v2.js`, `phantomstore.js`, `phantom-3d.js` |
| Misc / ops | `ambient.js`, `brandops.js`, `flowmap.js`, `managedgrowth.js` |

## 3. `server/src/` module map (in-scope directories only)

| Module | Files | Role |
|---|---|---|
| `access/` | 20 files: `access-guard`, `access-repository`, `access-workflow`, `auth-delivery`, `billing-provider`, `entitlements`, `paywall*`, `rate-limit`, `session`, `subscription-store`, `user-accounts`, `production-readiness`, `public-hosts`, `prisma-runtime`, `pangolin-*`, `deployment-model`, `local-customer-accounts`, `tenant-provider-connections`, `client-access-state`, `module-handlers` | Auth, sessions, entitlements/plans, multi-tenant client-access, billing-adapter boundary, production/dev auth-mode gating. `docs/RELEASE_CANDIDATE_TRUTH_MAP.md` marks the 39-check auth suite and entitlement enforcement LIVE. |
| `approval/` | `action-registry.ts` only | 11 action contracts, intentionally executor-less scaffolding — real execution lives in `phantom-ai/agent-runs.ts`. Do not wire these to executors as a "fix"; that would create a second execution path (explicitly warned against in `docs/ARCHITECTURE.md`). |
| `crm/` | `crm-pipeline-store.ts` only | Backing store for `crmpipeline.js`/`crmprospects.js`. Thin — most CRM logic may live in `phantom-ai/chicagoshots-nexprospex-crm.ts` (owner-specific CRM integration) or app-side; verify before assuming this file is the whole backend. |
| `customization/` | `customization-service.ts`, `customization-store.ts`, `module-registry.ts`, `schemas.ts`, `workspace-profiles.ts` | Per-workspace module enable/disable + profile customization; backs `customization.js` and `ModuleEntitlement` in Prisma. |
| `phantom-ai/` | 50+ files | By far the largest and most architecturally significant directory — the "brain." Sub-clusters: agent execution (`agent-runs.ts`, `agent-actions.ts`, `agent-workforce.ts`, `automation-engine.ts`), memory/Brain (`neural-spine.ts`, `hermes-*.ts` ×8, `owner-codex-memory.ts`), model routing (`model-router.ts`, `provider-*.ts` ×7, `providers/`), media (`media-lab-image-toolchain.ts`, `rembg-bridge.ts`, `phantomstore.ts`), games (`phantomplay*.ts` ×4 — **customer product, not admin**), security (`prompt-injection-guard.ts`, `security-scanner.ts`, `security-scan-scheduler.ts`, `external-security-monitor.ts`), chat (`instant-chat-*.ts` ×4, `context-compiler.ts`, `conversation-policy.ts`), decisions/signals (`decisions.ts`, `signals.ts`), and misc (`termina-bridge.ts`, `termina-mission-executor.ts` — note: this repo already has its own "Termina" concept, distinct from this mission's orchestrator name; do not conflate them in docs). **Recommend Relay split this directory into ≥3 sub-slices before assigning to any one worker** — it is too large and too architecturally central for one owner. |
| `proposals/` | `proposal-store.ts` only | Backs `proposalpipeline.js`. |
| `sites/` | `dns-adapter.ts`, `publishing.ts` | Website builder publishing pipeline (build→validate→approve→verify→rollback), real DNS TXT verification (never writes DNS — GATED by design, not a gap). Backed by `Site`/`SiteBuild`/`SiteDeployment`/`SiteDomain` in Prisma. `docs/RELEASE_CANDIDATE_TRUTH_MAP.md` marks the 32-check suite LIVE. |
| `workspace-approvals/` | `workspace-approval-store.ts` only | Client-access provisioning approval lane — the third of three distinct approval stores named in `docs/ARCHITECTURE.md` (agent-run execution approvals, read-only triage/Vacation-Mode lane, this one). Know which lane you're extending. |

Directories that exist under `server/src/` but are **outside** Atlas's audited
scope (flagged for Relay to assign, not yet inventoried in depth):
`assets/`, `connectors/`, `client-setup/`, `falcon/`, `managed-growth/`.

## 4. Data model (`server/prisma/schema.prisma`, 33 models)

Core tenancy: `User` (with `isSuperAdmin` — Jordan only, distinct from
per-org `Membership.role`) → `Membership` → `Org`. Auth: `AuthSession`,
`AuthChallenge` (2FA/reset/username-recovery), `Invitation`. Billing/plans:
`Plan`, `OrgPlan`, `UsageEvent`. Sites: `Site` → `SiteBuild`/`SiteDeployment`/
`SiteDomain`. Asset Cloud (permanent, content-addressed): `MediaAsset` →
`MediaAssetVersion`, `AssetFolder`, `AssetCollection`/`AssetCollectionItem`,
`AssetUsage`. Brain/execution: `ChatThread`/`ChatMessage`, `Action` →
`Approval`, `Task`, `FalconJob`, `AuditEvent` (hash-chained). CRM: `Contact`,
`CrmSettings`. Client provisioning: `ClientAccess`, `ModuleEntitlement`,
`Connection`. No destructive-looking gaps observed in the schema itself; all
cascade deletes are scoped to org/parent ownership as expected for a
multi-tenant model.

## 5. Commands (verified this pass, read-only)

| Command | Result | Notes |
|---|---|---|
| `npm run typecheck` | **PASS** | `tsc` on `contracts` then `server`, zero errors. |
| `npm run build` | **PASS** | `contracts` + `server` build clean via `tsc`. `app/` has no build step — it's served as static files directly. |
| `npm run test:release-critical` | **FAIL** | Fails at the `test:phantomplay` sub-gate — see `ADMIN_COMPLETION_MATRIX.md` row P0-1. This blocks `npm run test:release-full` and, transitively, the `ship:live-admin` gate. |
| `npm run ship:live-admin` | **not run** (would push to `origin/main` — out of Atlas's read-only scope; Relay-owned) | |
| `npm run verify:live-admin` | not run this pass; safe (`--verify-only`) if Relay wants a live-health cross-check | |

Full script inventory: root `package.json` defines ~30 `test:*` scripts
covering intent routing, dashboard chat, auth boundaries, memory retention,
content planner, media-lab editor, videocut editor, page worker, topbar
media, PhantomPlay (+edge worker sub-package), competitor intelligence,
workspace site builder, organization settings/isolation, client setup,
customization UI, CRM pipeline, proposal pipeline, workspace approvals,
managed growth report, database auth (PowerShell, live Postgres),
PhantomStore, customer plan switching, change-memory guard, command surface,
and live-ship smoke. Most of these are narrow/targeted per-feature gates, not
generic CRUD tests — read the relevant one before writing a new test for a
module that likely already has one.

## 6. Critical path for this mission

1. **Unblock the release gate** (P0-1: `test:phantomplay` regex failure) —
   otherwise no vertical slice can be verified "ship-able" through the
   existing, repo-native test:release-critical/test:release-full gates that
   this mission is supposed to reuse, not replace.
2. **Resolve the branch/coordination model** with Relay before any worker
   starts editing (dedicated mission branches vs. this repo's existing
   direct-to-main-with-rebase convention; both the seven-day evolution
   mission and unknown other sessions push to the same `origin/main`).
3. **Assign `server/src/phantom-ai/` sub-slices** — it's the module most
   likely to cause file-ownership collisions given its size and centrality.
4. Everything else in `docs/CURRENT_MISSION.md`'s "Current gaps" list
   (Outcome record, cross-department Signal generalization, Brain Memory
   Vault/behavioral-profile/context-preview per `docs/PHASE_III_BRAIN_GAP_MAP.md`,
   Command-home Decision surfacing) is real, named, prioritized work already
   defined by the product itself — the completion matrix below imports these
   rather than re-discovering them.
