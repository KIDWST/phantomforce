# PhantomForce Phase III Brain / Neural Spine Gap Map

Generated during discovery before code changes for `PHANTOMFORCE PHASE III — BRAIN / NEURAL SPINE`.

## Existing Systems

- Hermes ledger / activity proof: EXISTS AND SHOULD BE EXTENDED
  - `server/src/phantom-ai/hermes-ledger.ts` writes `.phantom/hermes-ledger.jsonl`.
  - Chat and automation already append redacted records.
- Hermes interaction memory: PARTIALLY EXISTS
  - Preview contract and local-dev interaction store exist.
  - Recall feeds `hermes-memory-context`, but it is not editable owner memory.
- Browser Memory tab: EXISTS BUT IS COSMETIC / NOT WIRED TO SERVER
  - `app/js/workspaces.js` and `app/js/store.js` provide localStorage memory with 30-day retention.
  - It does not feed server chat context.
- Phantom AI chat route: EXISTS AND SHOULD BE EXTENDED
  - `POST /phantom-ai/chat` routes admin model lanes and writes Hermes ledger.
  - It uses Hermes context but not an editable Brain profile/vault.
- Intent router: EXISTS AND SHOULD BE EXTENDED
  - Frontend classifier keeps casual chat from auto-creating tasks.
- Worker / agent workforce: EXISTS AND SHOULD BE EXTENDED
  - `agent-workforce.ts` builds parent workers, subagents, and generated neural cells from real ledger signals.
- Automation engine: EXISTS AND SHOULD BE EXTENDED
  - `automation-engine.ts` runs read-only jobs and logs outcomes to Hermes.
- Approval queue: EXISTS AND SHOULD BE EXTENDED
  - `.phantom/hermes-approvals.jsonl` and transitions exist; execution remains disabled.
- Vacation Mode: EXISTS AND SHOULD BE EXTENDED LATER
  - `.phantom/vacation-mode.json` exists; keep approval gates intact.
- Developer / control room: EXISTS AND SHOULD BE EXTENDED
  - Owner-only UI shows workers, tool programs, rembg, ai-proxy, media health.
- Content Hub / Media Lab: EXISTS AND SHOULD BE EXTENDED
  - Asset storage, rembg status, media toolchain, manual/gated media modes exist.
- ai-proxy health: EXISTS AND SHOULD BE EXTENDED
  - Frontend probes media/chat bridge; brain should include it in system health.
- rembg bridge: EXISTS AND SHOULD BE EXTENDED
  - Local Fastify/Python `py` route is real and should be remembered as tool state.
- Higgsfield manual/subscription behavior: PARTIALLY EXISTS
  - Media routes distinguish API/gated/manual lanes, but brain needs persistent rule memory.
- Auth/session/tenant scoping: EXISTS AND SHOULD BE USED
  - `requireAccessSession`, `requireAdminAccessSession`, and `clientId` scoping are established.
- Tool registry / n8n / AgentOS / Serena / Ruflo / OpenSpec: EXISTS AND SHOULD BE EXTENDED
  - Tool registry and dry-run n8n preview exist; Developer UI hides internal names in owner-facing product where needed.
- Local JSON stores: EXISTS
  - `.phantom/*.jsonl` for Hermes/approvals/proposals/live receipts.
  - `.local/*` for automation/content/security operational state.

## Missing Synapses

- Central Brain adapter / context composer: MISSING
  - Need one server-side coordinator that reads memory, ledger, workers, approvals, automation, media health, and system health.
- Editable server Memory Vault: MISSING
  - Need owner/session-scoped records with create/edit/forget, confidence, weight, retention, and source events.
- Behavioral profile: MISSING
  - Need derived operator profile from explicit memories and feedback without sensitive personal inference.
- Context preview endpoint: MISSING
  - Need a no-LLM endpoint showing injected micro-prompt, selected memories, active rules, risk, and reasons.
- Feedback integrator: MISSING
  - Need remember/forget/correction/thumbs/useful/not-useful signals that update memory/profile suggestions.
- Brain status UI: MISSING
  - Existing Memory and Developer pages do not show one real Brain panel with memory vault, profile, context preview, learnings, signals, action safety, and system brain health.
- Chat injection from editable Brain: MISSING
  - Chat currently uses Hermes memory context, but not the new editable profile and memory vault.

## Implementation Plan

1. Add `server/src/phantom-ai/neural-spine.ts` as an adapter, not a replacement.
2. Store editable Brain memories/events in `.phantom/brain-memory.jsonl` and `.phantom/brain-events.jsonl`, alongside Hermes.
3. Read existing Hermes ledger, interaction memory, approval queue, workforce, automation, rembg, model/provider, media toolchain, and tool-lane status.
4. Expose owner/session-scoped endpoints:
   - `GET /phantom-ai/brain/status`
   - `GET /phantom-ai/brain/memories`
   - `POST /phantom-ai/brain/memories`
   - `PATCH /phantom-ai/brain/memories/:id`
   - `DELETE /phantom-ai/brain/memories/:id`
   - `POST /phantom-ai/brain/feedback`
   - `POST /phantom-ai/brain/context-preview`
   - `POST /phantom-ai/brain/events`
5. Integrate `composeBrainContext` into `POST /phantom-ai/chat` before model calls.
6. Keep injected micro-prompts compact and owner-debug visible; never claim model-weight training.
7. Add an owner/admin Phantom Brain UI page that uses real endpoints and lets the owner create/edit/forget memories.
8. Seed only durable known facts when the Brain store is empty, with source `phase_iii_bootstrap`; do not seed fake tasks/leads.
9. Add targeted tests for memory CRUD, context preview, chat context injection, and safety gates.
