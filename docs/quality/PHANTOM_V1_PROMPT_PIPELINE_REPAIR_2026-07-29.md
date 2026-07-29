# Phantom V1 Prompt Pipeline Repair - 2026-07-29

## Summary

PhantomBot was updated so Phantom V1 is presented as the active PhantomForce product lane instead of a generic local chat model.

The corrected stack identity is:

- Phantom V1: active PhantomBot product/runtime layer.
- Local Phantom/Qwen: fast local lane.
- Qwen3-Coder: software/code lane.
- Kimi K3: deep reasoning lane when available.
- ChatGPT bridge: supervisor and fallback lane.

This is product routing and orchestration language. It does not claim ChatGPT-trained weights inside the local model.

## Fixes

- Added prompt integrity envelopes with hashes, sentinels, segmentation, and tamper/oversize rejection.
- Raised Phantom prompt limits from short slices to long prompt handling.
- Removed silent prompt clipping in browser and server paths.
- Updated identity/capability responses to avoid generic "I cannot access files/run code" refusals.
- Added local-model detection for false runtime-capability denials, so the next allowed Phantom V1 lane can take over instead of showing the bad response.
- Updated browser cache build markers to `phantom-live-20260729-94`.

## Verification

Passed:

- `npm run typecheck`
- `npm run test:instant-chat:tools --workspace @phantomforce/server`
- `npm run test:local-ollama-transport --workspace @phantomforce/server`
- `npm run test:prompt-integrity --workspace @phantomforce/server`
- `npm run test:agent-assist-bridge --workspace @phantomforce/server`
- `npm run test:hermes-acp-operator --workspace @phantomforce/server`
- `node --check` for changed browser modules
- `git diff --check` returned no whitespace errors

Live checks:

- Backend restarted hidden as PID `57312`.
- `http://127.0.0.1:5190/health` returned healthy.
- Local app served build `phantom-live-20260729-94`.
- ChatGPT bridge health returned service OK, browser up, page ready, hidden window.
- Kimi direct endpoint advertised `kimi-k3-hf:latest`, Phantom V1, and Qwen3-Coder.

## Notes

The in-app browser was at the sign-in gate during verification, so no logged-in UI chat prompt was submitted from this repair session.

No secrets, cookies, tokens, raw prompts, or account data were stored in this note.
