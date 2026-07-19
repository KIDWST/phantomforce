# PhantomBot merger — design spec

**Date:** 2026-07-19
**Status:** approved by owner (Jordan), proceeding straight to implementation plan per explicit "just get it done" direction.

## Summary

Termina and PhantomBot Unleashed merge into one product: **PhantomBot**. Termina's Electron shell (mission-mode multi-agent orchestrator + terminal-wall PTY tiles) becomes PhantomBot itself — Termina retires as a separate identity. PhantomBot Unleashed's uncensored-chat capability becomes a mode inside that same shell instead of a separate Tkinter app. A new local router service gives PhantomBot a cloud-preferred, local-guaranteed-fallback model chain so it never hard-requires a subscription. PhantomBot is sellable as its own product (standalone desktop app + license key) and also ships as a streamlined module embedded inside the PhantomForce dashboard.

## Non-negotiable constraints (from owner)

1. Fallback direction is **cloud-preferred, local-guaranteed**: try the configured cloud provider when available; fall back to the local model on any failure/absence. The product must never hard-fail for lack of a subscription.
2. Two distinct, separately-gated model slots:
   - **PhantomPT** — free, safe default local model, always available, no paywall.
   - **Phantom Unleashed** — paywalled via a standalone license key; user picks which uncensored model they want, or gets the bundled `huihui-qwen3.6-35b-uncensored:q3` default. Model choice is validated against `UNLEASHED_MARKERS` so a user-picked model still qualifies as actually uncensored.
3. License-key entitlement is **standalone and offline-capable** (works without a PhantomForce account, with periodic online re-check) — required since PhantomBot must work as a separately-sold product independent of PhantomForce.
4. Default UX must be zero-config ("easy until a user wants advanced settings"); advanced settings (specific providers/keys, per-slot model choice, priority overrides) live behind an explicit advanced toggle.
5. Termina's mission-mode orchestration and terminal-wall tiles are a capability floor — nothing here is removed or narrowed by the merge.
6. From the prior PhantomBot Unleashed 2.0 design spec (2026-07-17), these constraints still hold post-merge: capability floor (every existing Unleashed tool carries over unchanged or wider), model choice fixed at `huihui-qwen3.6-35b-uncensored:q3` as the bundled default, and the "Claude-Code style but more power / fewer restrictions" autonomy posture including the "no self-destruct" rule. That spec's constraint #4 ("stay a standalone chat-window app") is explicitly **voided** by this merge — it was written to rule out exactly this restructuring.

## Architecture

### Components

1. **PhantomBot Shell** — Termina's existing Electron app (`electron-main.cjs`, `server.js`, `mission/*`, `public/*`), rebranded. Mission-mode orchestration and terminal-wall tiles unchanged. Gains a new **Chat mode** tab (replaces PhantomBot Unleashed's Tkinter window) for PhantomPT/Unleashed conversation.

2. **PhantomPT Router Service** — a local Python sidecar process, managed by the shell the same way it already manages CLI-tile child processes. Built by evolving the existing `phantombot-engine` code (from `Phantombot-Unleashed/.claude/worktrees/phantombot-2-0/phantombot-engine/`), not a rewrite:
   - **Carried forward near-verbatim**: `guardrails.py` (segment-split + shlex-tokenize + binary-name/flag-semantics danger detection — the standout asset of the 2.0 work, 23 passing tests), the WebSocket message framing (`{type, payload}`) and per-message token-auth model, `tools.py`'s capability-floor toolset.
   - **Relocated/adapted**: `compact_messages()` moves out of its current Ollama-only assumption into a provider-agnostic context-management layer, since the router must compact context across cloud and local providers alike.
   - **New in the router**: cloud-preferred/local-fallback provider policy; tool-call batching (a real gap the 2.0 plan flagged in its own self-review and never implemented — batch independent read-only tool calls into one turn instead of one round-trip per call); the license-key entitlement gate for Unleashed; model-picker logic for Unleashed's model choice.

3. **Consolidated credential vault** — Termina's mission-mode CLI adapters (`claude`/`codex`/`openrouter`) currently read keys from their own `connections.js` AES-256-GCM vault. That vault relocates into the router service and becomes the single source of truth for all cloud keys. Mission-mode CLI launches and PhantomPT/Unleashed chat both read from it — one encrypted store, not two.

4. **Embedded PhantomForce dashboard module** — modeled on PhantomCut's proven pattern (confirmed healthy 2026-07-19): a thin client-side file under `app/js/`, mounted as a persistent host inside an existing dashboard area (not a new top-level nav tab), talking to the same local router over an authenticated loopback connection. No new server-side proxy layer. Same standalone license-key gate applies here.

### Data flow (one chat turn)

Shell Chat mode or embedded dashboard module → local router service → cloud provider if configured & healthy (streamed back) → on any cloud failure/absence, automatic fallback to local Ollama (PhantomPT default model, or the active Unleashed model if that mode is selected and license-gated) → tool-calls stay approval-gated through the carried-over guardrails, applied uniformly regardless of which surface the request came from.

### Error handling

- Cloud provider failure (auth, rate limit, network) → silent-but-visible fallback to local (a small status indicator shows cloud vs. local; never a scary error to the user).
- Local Ollama not running / model not pulled → router auto-starts Ollama or offers to pull the default model on first run.
- Unleashed license check fails → clear upsell message, never a silent block.

### Testing

- The 59 existing `phantombot-engine` tests (guardrails, tools, streaming, WS auth) carry forward as regression coverage and must stay green through the port.
- New tests required: fallback-policy behavior (mock cloud failure → assert local fallback fires), tool-call batching, the relocated context-compaction under multi-provider input, and the license-key gate (valid / invalid / offline-grace-period / expired).
- Manual verification path: send a message with no cloud key configured (PhantomPT answers locally) → add a cloud key (cloud answers) → simulate cloud failure (confirms fallback) → toggle Unleashed with/without a valid license (confirms gate + upsell).

## Explicitly out of scope for this spec

- The actual licensing/payment backend (issuing keys, billing) — this spec defines the client-side entitlement *check* contract the router enforces; issuing/selling keys is a separate initiative.
- Full parity redesign of the embedded PhantomForce dashboard module's UI polish — first pass is functional parity with the shell's Chat mode, not a bespoke redesign.
- Formal retirement/deletion of the old `phantombot_unleashed.py` Tkinter app and `Phantombot-Unleashed` repo — happens only after the merged Chat mode reaches capability parity and is verified working end-to-end.
