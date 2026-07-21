# ADMIN_COMPLETION_MATRIX.md

Compiled by Atlas (Worker 1), read-only audit, commit
`a05590741b1e94e6fc3d7d6bb6b411e84542c181`, rollback tag
`pre-admin-completion-20260721-1332`. Cross-referenced against this repo's
own prior audits (`docs/RELEASE_CANDIDATE_TRUTH_MAP.md`,
`docs/CURRENT_MISSION.md`, `docs/PHASE_III_BRAIN_GAP_MAP.md`,
`docs/quality/QUALITY_BACKLOG.md`) rather than re-discovered from zero — see
`ADMIN_ARCHITECTURE_MAP.md` §0 for why this matters here specifically.

**Read before assigning work:** several rows below reference capability that
is intentionally gated (fail-closed by design). Marking those "complete" by
wiring live execution would be a regression, not progress. They are listed
separately in §3 so no worker mistakes an honest safety gate for an unfinished
feature.

## §1 — P0 (blocks build/start/auth/data-safety/foundational workflow)

| # | Feature/Route | Role | Expected | Current | FE | BE | Persist | Perm | Test | Priority | Owner | Files | Deps | Blockers | Final Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| P0-1 | Release gate: `npm run test:release-critical` | n/a (CI/ship gate) | Full release-critical suite passes so `ship:live-admin` can run | **FAILED at audit time** at the `test:phantomplay` sub-gate: a regex assertion (`/font-size:clamp\([^;]*vw/u`) did not match the generated inline CSS for the Type Storm game's overlay. Confirmed via diff at the time that the WIP files then in flight (`app/js/phantomplay.js`, `server/src/phantom-ai/phantomplay.ts`) did **not** touch this CSS — a pre-existing baseline failure, not caused by that WIP. **Update, same session:** `git status` at hand-off now also shows `app/games/type-storm.html` and `scripts/test-phantomplay.mjs` modified (not present at audit start) — a concurrent session appears to be actively fixing this exact gate right now. Re-run `npm run test:release-critical` before assigning this row; it may already be resolved. | n/a | n/a | n/a | n/a | **RED at audit time, in-flight fix detected** | **P0** | Beacon: re-run the gate first; only pick up remaining work | `scripts/test-phantomplay.mjs`, `app/games/type-storm.html` | none | Do not duplicate a fix already in progress — verify current state before touching these files | **RE-VERIFY BEFORE ASSIGNING — likely already being fixed by another session** |
| P0-2 | `npm run typecheck` | n/a | Passes | **PASSES** (contracts + server, zero errors) | n/a | n/a | n/a | n/a | GREEN | P0 (verified, no action needed) | n/a | n/a | n/a | none | **VERIFIED GREEN** |
| P0-3 | `npm run build` | n/a | Passes | **PASSES** (contracts + server `tsc` build clean; `app/` is static, no build step) | n/a | n/a | n/a | n/a | GREEN | P0 (verified, no action needed) | n/a | n/a | n/a | none | **VERIFIED GREEN** |
| P0-4 | Server startup / `/health` | n/a | Dev server starts, `/health` returns JSON with correct `root`/`commit` | **Not started this pass** (starting a long-running dev server is outside a 90-minute read-only audit; requires `DATABASE_URL` + `server/.env` per `docs/ADMIN_RECOVERY.md`) | n/a | n/a | n/a | n/a | NOT RUN | P0 (needs verification) | Forge Systems or Beacon | `server/src/index.ts`, `server/.env` | Postgres reachable, `.env` populated | Env/secrets not something Atlas can/should inspect | **NEEDS VERIFICATION** |
| P0-5 | Auth/authz enforcement (login, session, 2FA, org isolation, admin-only routes) | owner/admin/member/client | Server-side enforced per `docs/RELEASE_CANDIDATE_TRUTH_MAP.md`'s "39-check live suite" claim | **Claimed LIVE by existing docs; not independently re-verified by Atlas this pass** (would require running `test:auth-boundaries`, `test:database-auth`, and the PowerShell auth suites, several of which need a live Postgres + `.env`) | n/a | n/a | n/a | claimed enforced | claimed passing, not re-run | P0 (spot-check, not re-audit) | Beacon | `server/src/access/**` | live/dev Postgres | none identified, just unverified this pass | **CLAIMED GREEN, UNVERIFIED — Beacon should re-run `test:auth-boundaries` + `test:database-auth` early Day 1** |

## §2 — P1 (release-critical functionality incomplete or unreliable)

These are the product's own named current gaps (`docs/CURRENT_MISSION.md`
§"Current gaps", `docs/PHASE_III_BRAIN_GAP_MAP.md`), not invented from a
generic admin-CRUD checklist — this product is far past that stage.

| # | Feature/Route | Role | Expected | Current | FE | BE | Persist | Perm | Test | Priority | Owner | Files | Deps | Blockers | Final Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| P1-1 | Outcome record | owner/admin | A first-class Outcome object (goal, deadline, metric, strategy, workstreams, departments, approvals, evidence, risks, costs, results) unifying CRM pipeline / managed growth / proposals | **MISSING as a first-class model.** Implicit today across `crmpipeline.js`, `managedgrowth.js`, `proposals/proposal-store.ts`. No `Outcome` model in `schema.prisma`. | absent | absent | absent | n/a | none | **P1** | Forge Systems (schema+API) + Forge Experience (surfacing UI) | new `server/src/outcomes/` (proposed), `schema.prisma` migration, `app/js/main.js` Outcomes space | Relay must approve the schema migration (shared file) | Needs a design decision on Outcome shape before implementation — do not invent unilaterally, `docs/ARCHITECTURE.md` explicitly leaves this open | **NOT STARTED** |
| P1-2 | Cross-department Signal | owner/admin | Signal object generalized beyond Competitor Intelligence to content/finance/CRM/automation-health, per the pattern already proven in `competitor-intelligence.ts` and generalized once already in `server/src/phantom-ai/signals.ts` | **PARTIALLY DONE.** `signals.ts` already normalizes `organization-pulse.ts` + graph disconnections into a cross-department `Signal[]` (`getWhatChanged`/`getWhatMatters`/`getRecommendedActions`). Competitor-Intelligence-specific signals still feed in via the opportunity/graph layer, per design (not duplicated). Remaining gap: additional department sources (finance, automation health) not yet emitting into this pipeline. | partial | partial | n/a | n/a | none observed | **P1** | Forge Systems | `server/src/phantom-ai/signals.ts`, `organization-pulse.ts` | none | Scope of "which departments still need to emit Signals" needs Relay/owner confirmation before treating as done | **IN PROGRESS (per product's own docs)** |
| P1-3 | Brain Memory Vault (editable), behavioral profile, context-preview endpoint | owner | Owner/session-scoped memory CRUD (`GET/POST/PATCH/DELETE /phantom-ai/brain/memories`), derived behavioral profile, no-LLM context-preview endpoint, feedback integrator, one real Brain status UI panel, chat injection from the editable vault | **`docs/PHASE_III_BRAIN_GAP_MAP.md`'s "Missing Synapses" list is STALE — verified by direct inspection, do not trust that doc for this row.** `server/src/phantom-ai/neural-spine.ts` already exists (1,325 lines) and `server/src/index.ts` already wires every endpoint the gap map called missing: `GET /phantom-ai/brain/status`, `GET`/`POST`/`PATCH`/`DELETE /phantom-ai/brain/memories`, `POST /phantom-ai/brain/feedback`, `POST /phantom-ai/brain/context-preview`, `POST /phantom-ai/brain/events` (grep-confirmed at `server/src/index.ts:6702-6979`). **Not verified this pass:** whether `app/js/brain.js` actually calls these endpoints (vs. the gap map's separately-noted cosmetic localStorage UI in `workspaces.js`/`store.js`), whether chat injection (`composeBrainContext` into `POST /phantom-ai/chat`) is wired, and whether `npm run test:neural-spine` passes. | not verified — check if `brain.js` calls the real endpoints or still uses localStorage | **endpoints exist** (grep-verified) | not verified (`.phantom/brain-memory.jsonl` presence not checked) | not verified | `test:neural-spine` script exists, not run this pass | **P1 (verification gap, not a build gap)** | Beacon: run `npm run test:neural-spine` + trace `brain.js` → these endpoints first, before Forge Systems writes any new code here | `server/src/phantom-ai/neural-spine.ts`, `server/src/index.ts:6702-6979`, `app/js/brain.js` | none | **Do not re-implement this — a prior agent already built it. Confirm wiring/UI completeness, then update or archive the stale gap-map doc.** | **LIKELY DONE OR MOSTLY DONE — re-verify wiring before assigning new implementation work** |
| P1-4 | Command home Decision surfacing / "three things need attention" | owner | Command home reads as focused priorities + honest away-time summary, not a generic dashboard | **MOSTLY DONE (2026-07-20)** per `docs/CURRENT_MISSION.md`: `decisions.ts` packages Signal feed into approve/modify/dismiss Decision Cards; `renderDecisions` in `main.js` renders the deck; `/api/brain/signals` + `/api/brain/contract` now wired. Named remaining depth: run-capable follow-through via `agent-runs.ts` once Signals carry executable actions (currently navigation-only follow-through). | done | done | done | n/a | not verified this pass | **P1 (remaining depth only)** | Forge Systems | `server/src/phantom-ai/decisions.ts`, `agent-runs.ts`, `app/js/main.js` | P1-2 (Signals need executable actions before this can extend) | Do not build a second execution path — route through `agent-runs.ts` per `docs/ARCHITECTURE.md` | **MOSTLY DONE, one dependent gap remains** |
| P1-5 | Website publishing / domain verification | owner/admin | Build→validate→approve→verify→rollback for sites, real DNS TXT verification | **Claimed LIVE** ("32-check suite", `dns-adapter.ts` honest states) per truth map — not independently re-run by Atlas this pass (`npm run test:sites`) | claimed live | claimed live | claimed live (Site/SiteBuild/SiteDeployment/SiteDomain models present, schema looks sound) | claimed enforced | claimed passing, not re-run | P1 (spot-check) | Beacon | `server/src/sites/**` | none | none identified | **CLAIMED GREEN, run `npm run test:sites` to confirm before Day 2 close** |

## §3 — GATED BY DESIGN (do not "fix" — listed so nobody re-flags these as bugs)

Full detail in `docs/RELEASE_CANDIDATE_TRUTH_MAP.md` §GATED. Summary for
quick reference during triage:

- Provider budget hard-gate / funding-approval contract / invocation
  firewall / live-smoke preflight — preview/dry-run by design.
- `media.render` paid renders — draft lane only until `RUN_MEDIA_PAID_JOB`
  confirmation contract clears.
- Email send — stub until `RESEND_API_KEY` configured + approval path.
- Plaid/finance live provider — manual/CSV ready; live mode deliberately
  `not_implemented` until configured.
- Pangolin reconcile — dry-run only; live route mutation hardwired off.
- `approval/action-registry.ts`'s 11 action contracts — validate but have no
  executors on purpose; real execution is `agent-runs.ts`, not this.
- Voiceover/TTS, blog builder, ecommerce storefront, WebSockets/SSE,
  self-serve billing checkout, Sora/Runway/Flux media providers, OAuth
  social auto-post — named ABSENT in the truth map; treat as legitimate P3
  future work, not a P0/P1 defect, unless the mission explicitly wants one of
  these built (would be new scope — get owner sign-off first).

## §4 — P2/P3 and known seams (deferred by prior audit, not this mission's job to force)

- Duplicate/overlapping surfaces documented and deliberately deferred:
  `renderMedia`'s dual role in Media Lab's Pending tab; `#/ws/phantom` deep
  link duplicating dashboard chat; three separate approval lanes (agent-run
  execution, read-only triage/Vacation-Mode, client-access provisioning);
  two activity accountings (`agent-workforce.ts` vs `agent-runs.ts`). Unify
  only if a P0/P1 fix specifically requires touching one of these — do not
  proactively refactor them this sprint (feature-freeze discipline).
- `docs/quality/QUALITY_BACKLOG.md` already tracks several verified-and-fixed
  issues from the repo's own seven-day evolution mission (Q-0001 casual-chat
  local-provider fallback, Q-0008 sidebar nav grouping, Q-0009 Phantom Rumble
  stale-victory-state, Q-0010 Penalty Kick catalog visibility — all marked
  Fixed as of Cycle 1/1B). Beacon should read that file directly rather than
  Atlas re-deriving it; treat it as a live-updating sibling ledger, not a
  static import into this matrix.

## §5 — Explicitly out of Atlas's audited scope this pass

`server/src/{assets,connectors,client-setup,falcon,managed-growth}/`,
`server/src/index.ts` route registration, `app/js/{phantomplay,phantomplay-v2,
phantomstore,phantom-3d}.js` (customer game/store surface — lower priority for
an *admin*-completion mission, and `phantomplay.js` currently has unrelated
external WIP in flight, see `ADMIN_ARCHITECTURE_MAP.md` §0), `ai-proxy/`,
`ops/n8n/`. Flagged in `.termina/atlas-file-ownership-proposal.json` for Relay
to assign or explicitly descope.

## §6 — Critical path (see `ADMIN_ARCHITECTURE_MAP.md` §6 for full reasoning)

1. Fix P0-1 (`test:phantomplay` release-gate failure) — unblocks the repo's
   own ship gate that this mission should reuse.
2. Relay decides the branch/worktree-vs-direct-to-main convention and the
   `server/src/phantom-ai/` sub-slice split before assigning P1-1..P1-4.
3. Beacon re-verifies P0-4/P0-5/P1-5 (claimed-green items Atlas didn't re-run)
   early Day 1 so "claimed" doesn't silently stand in for "verified" through
   Day 4.
4. ~~Execute P1-3 (Brain Memory Vault) against the gap map's 8-step plan~~ —
   **superseded**: verified during this audit that the endpoints already
   exist (`server/src/index.ts:6702-6979`, `neural-spine.ts`). Have Beacon
   confirm wiring/tests first; only assign new implementation if that check
   finds a real gap, and update `docs/PHASE_III_BRAIN_GAP_MAP.md` either way
   since it's now stale and could mislead the next agent who reads it first.
