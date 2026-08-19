# Baseline Architecture

Verified 2026-08-16 against the running Windows package.

- Product source: `C:\Users\jorda\Documents\Codex\worktrees\phantombot-product-hermes-main`
- Product branch/HEAD: `phantomforce/phantombot-product-main` at `21e275ca12e84076e44a9e1c3a3bccf34978dde9`
- Desktop: Electron main/preload owns local process and filesystem integration; the React renderer owns chat, composer, settings, projects, and diagnostics.
- Runtime: the packaged desktop starts `hermes_cli.main serve`; the gateway/session layer owns model configuration, history, streaming, and durable events.
- Local inference: provider `phantom` uses the OpenAI-compatible Ollama endpoint at `127.0.0.1:11434/v1`.
- Public product profiles: `phantom` and `phantom-unleashed`; provider/runtime identities remain implementation detail in ordinary user-facing copy.
- Baseline defect evidence: `_ollama_request_ctx` could be read before assignment in the registered-provider path; repeated same-route selection could append redundant model timeline events; the mascot was positioned against the whole thread instead of the composer.

The archive's historical repository lead was not used blindly. The running executable and process tree identified this worktree as the real product source.
