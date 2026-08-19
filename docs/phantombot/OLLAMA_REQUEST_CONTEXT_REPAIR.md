# Ollama Request Context Repair

Root cause was in `agent/chat_completion_helpers.py`: `_ollama_request_ctx` was initialized in the Codex and legacy-provider branches, but the normal registered-provider branch consumed it before either assignment.

Repair:

- Import and call the pure `choose_ollama_request_num_ctx` helper once before provider-profile branching.
- Derive the request-local value from the active model plus the agent's configured Ollama context.
- Reuse the value for all provider paths instead of maintaining branch-local copies.
- Do not swallow unexpected exceptions around context selection.

Regression test: `TestBuildApiKwargs.test_registered_ollama_provider_uses_request_local_context` exercises a registered local provider and asserts `extra_body.options.num_ctx == 65536`.

Verification:

- Focused request-building tests: 2 passed.
- Live packaged Phantom request: no `_ollama_request_ctx` error appeared during startup or generation.
