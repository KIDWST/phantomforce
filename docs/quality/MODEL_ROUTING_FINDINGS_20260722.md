# Chat model-routing — findings & the ChatGPT-brain path (2026-07-22)

Prompted by a live failure: casual chat ("p dawg i missed u") returned
*"I didn't get a clean model answer in time."* Owner's stated intent: the chain
should be **Codex → Claude → OpenRouter → Local (+ ChatGPT)**, using ChatGPT's
reasoning as the "brain" and the local model as the "hands", and this failure
should never happen because OpenRouter is a fallback.

## Finding 1 — the fallback ORDER is already correct

`server/src/phantom-ai/admin-provider-manager.ts`:

```ts
const PROVIDER_PRIORITY: AdminProviderId[] =
  ["codex_cli", "claude_cli", "openrouter_glm", "local_ollama"];
```

That is exactly **Codex → Claude → OpenRouter → Local**. `adminProviderAttemptOrder()`
walks this list, skipping any provider marked `offline`, and the chat route
(`server/src/index.ts` ~3913) attempts them in order with per-provider timeouts.
So the ordering is **not** the bug.

## Finding 2 — why the OpenRouter fallback didn't save it (env, not code)

OpenRouter only becomes a live attempt when **three** env values are all set
(`server/src/phantom-ai/model-router.ts:75-78`):

- `OPENROUTER_API_KEY` (configured)
- `PHANTOM_LIVE_PROVIDERS_ENABLED=true`
- `PHANTOM_OPENROUTER_TRANSPORT_ENABLED=true`

If any is missing on the live box, OpenRouter is treated as not-live and the
chain falls straight through to a local model that may be down/slow — producing
the cold error. **This is a deployment/env configuration check, not a routing
code change.** (Do not commit these keys/flags to the repo; set them in the
live `server/.env`.)

## Finding 3 — ChatGPT/OpenAI is genuinely NOT in the chain

The four transports are `codex-cli`, `claude-cli`, `openrouter-live` (GLM 5.2),
and `local-ollama`. There is **no OpenAI/ChatGPT transport**. So "Local + ChatGPT"
and the "ChatGPT brain → local hands" split require a **new provider integration**,
not a reorder.

### Precise implementation spec (for a session with a running server)

1. Add `openai_chat` to `AdminProviderId` and append to `PROVIDER_PRIORITY`
   after `openrouter_glm` (so the chain becomes Codex → Claude → OpenRouter →
   OpenAI → Local), gated on `OPENAI_API_KEY` + a live flag.
2. Add `server/src/phantom-ai/providers/openai-chat-transport.ts` mirroring
   `openrouter-live-transport.js` (same input/return contract:
   `{ status, model_id, text, error_message }`).
3. Wire it into the `providerId` switch in `index.ts` (~3804-3865) and the
   readiness/status surfaces in `model-router.ts`.
4. **Brain → hands** (optional, larger): a two-pass mode where OpenAI produces
   the reasoning/plan and the local model renders the final surface text. Model
   this as an explicit lane, not a silent default, so provider truthfulness and
   the existing approval gates are preserved. Keep it behind the same
   fail-closed contract as every other external call.
5. Verify with `npm run test:dashboard-chat` and
   `npm run test:instant-chat:http-live-model` (both need the server + keys),
   then the strict live doctor.

**Not done here:** this sandbox is a fresh clone with no `node_modules` and no
provider keys, so a new server transport cannot be built, typechecked, or tested
in it. Implementing it blind would violate the repo's own verification gates.

## Shipped here — client-side safety net (verified)

`app/js/command.js` `localQuestionAnswer()` had a cold dead-end when the model
chain returned nothing AND no business keyword matched — which is exactly what a
pure greeting hits. Added a warm small-talk/greeting/affection branch so casual
chat ("hey", "p dawg i missed u", "thanks", "gm") always gets a human reply, and
softened the remaining fallback copy. This is the "Local" tier behaving as the
owner expects: a friendly hello never shows a model-failure error. Verified
headless (backend absent → local fallback path, same as the live failure).
Build id bumped to `phantom-live-20260722-21`.
