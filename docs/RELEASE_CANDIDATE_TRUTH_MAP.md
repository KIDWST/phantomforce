# PhantomForce — Release-Candidate Truth Map

Product-wide audit of what is LIVE, what is deliberately GATED, and what is
ABSENT — so nobody mistakes an honest safety gate for an unfinished feature,
or vice versa. Compiled from a full route/module inventory of `app/`,
`server/src/`, `ops/`, and `ai-proxy/`.

The product's core posture: **fail-closed honesty**. The `phantom-ai` layer
is built around dry-run/preview contracts that draft real work and queue real
approvals but never send, pay, or execute externally without an explicit
gate. That is a feature, not debt.

## LIVE (verified end-to-end)

| Capability | Where | Notes |
|---|---|---|
| Chat brain (intent lanes, backend chain, memory context) | `app/js/command.js`, `intent-router.js`, `/phantom-ai/chat` | 26-case behavior contract + flow suite |
| Agent-run engine (states, artifacts, receipts, ledger proof) | `server/src/phantom-ai/agent-runs.ts` | one engine; approvals survive restarts |
| Approval-gated external execution | same + `/phantom-ai/runs/:id/{approve,reject}` | expiry, receipts, org authority checks |
| Multi-tenant auth/orgs/roles/invitations/audit | `server/src/access/user-accounts.ts` | 39-check live suite |
| Entitlements (plans, limits, usage ledger, manual admin) | `server/src/access/entitlements.ts` | enforced on chat/runs/seats/sites |
| Website builder + editor (sections, history, devices) | `app/js/sitestudio.js`, `workspaces.js` | |
| Website publishing (build→validate→approve→verify→rollback) | `server/src/sites/publishing.ts`, `/public/sites/:id` | 32-check suite; served content hash-verified |
| Domain verification (real DNS TXT + probes; never writes DNS) | `server/src/sites/dns-adapter.ts` | states are honest; typing ≠ connected |
| Media Lab utilities: rembg background removal, image edit/filters, canvas proxy | `/phantom-ai/media-lab/rembg/*`, `imagefilters.js` | real local Python rembg |
| Paid media generation | `ai-proxy` `/generate` (Higgsfield + OpenAI image), admin-static-server `/generate` + `/generate/job/:id` async jobs | production topology: served from the owner box |
| Content assets store (30-day server store) | `/phantom-ai/content/assets`, `content-asset-storage.ts` | pluggable provider seam, not permanent cloud |
| Scheduled server automations (read-only jobs + Hermes ledger) | `automation-engine.ts`, Developer → Autopilot | |
| Decision Cards (Signal feed → approve/modify/dismiss + Command deck) | `decisions.ts`, `/phantom-ai/decisions`, `renderDecisions` | follow-through is navigation only — no external execution from this layer |
| Live chat transports | OpenRouter (env-gated), Claude CLI, Codex CLI, local Ollama | fail-closed chain |
| GitHub Pages public site + admin static server + auto-sync | `ops/admin-live/*`, `CNAME` | push-to-deploy |

## GATED (intentional fail-closed previews — do not "fix" into silent execution)

- Provider budget hard-gate, funding approval contract, invocation firewall,
  live-smoke preflight: preview/dry-run by design; execution requires the
  documented env gates + approvals.
- Creative-engine `media.render`: draft lane only; paid renders demand the
  `RUN_MEDIA_PAID_JOB` confirmation contract.
- Email send: stub until `RESEND_API_KEY` (+ approval path); calendar commit,
  CRM writes: local/preview connectors report `live:false` truthfully.
- Plaid/finance: manual/CSV ready; live provider runtime deliberately
  `not_implemented` until configured.
- Pangolin reconcile: dry-run only; live route mutation hardwired off.
- `approval/action-registry.ts`: 11 action contracts validate but have no
  executors — kept as the contract spine; real execution belongs to the ONE
  agent-run engine, not a parallel path.

## ABSENT (named nowhere in the product UI; do not imply otherwise)

- Voiceover/TTS/audio generation — no provider, no route, no surface.
- PhantomPlay/games/achievements/leaderboards — nothing exists.
- Blog builder, ecommerce storefront — prompt-library seed text only.
- Websockets/SSE push — everything polls.
- Billing checkout — manual super-admin plan assignment only (by design
  until a billing provider is integrated via the adapter boundary).
- Media providers Sora/Runway/Flux — `enabled:false`, marked "coming soon"
  in the owner-only Developer panel only.
- OAuth social connect — manual handle capture; live posting disabled with
  honest copy.

## KNOWN DUPLICATES / SEAMS (documented, deliberately deferred)

- `renderMedia` (workspaces.js) doubles as Media Lab's "Pending" tab via
  `opts.renderPending` — one store, two views; unify when Media Lab is next
  touched.
- `#/ws/phantom` deep-link chat console (`renderPhantom`) duplicates the
  dashboard chat; both call the same brain. No nav entry exposes it.
- Approval lanes: agent-runs (execution approvals, live) vs
  `approval-queue.ts` (read-only triage lane used by Vacation Mode, which
  deliberately CANNOT approve/execute) vs client-access provisioning
  approvals (separate domain). Three stores, three purposes; collapse only
  with a migration plan.
- Two activity accountings: `agent-workforce.ts` (ledger-derived) and
  `agent-runs.ts` — reconcile when the Workers surface is next reworked.

## REMOVED THIS PASS (verified dead)

- `app/js/agent-control-center.js`, `app/js/phantom-workers-ticker.js`,
  `app/js/media-image.js` — self-executing or exporting modules imported by
  nothing (stale `connector-signin-20260705-01` build tags).
- `renderSites` "Site Portfolio" surface — permanently shadowed by
  `CUSTOM.sites → renderSiteStudio` in `workspaceDef()`; unreachable from
  nav, palette, and deep links.

## AUDIT FINDINGS THAT DID NOT SURVIVE VERIFICATION

- `/api/creative-engine/status` and `/generate/job/:id` are NOT dead
  frontend paths — both are served by `ops/admin-live/admin-static-server.mjs`
  (lines ~832/842) in the production topology.
- `openrouter-adapter.ts` is not a dead duplicate of the live transport — it
  is the shared contract layer imported by the live transport, the
  invocation firewall, and the receipts store.
