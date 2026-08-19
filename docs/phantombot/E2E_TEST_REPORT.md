# End-to-End Test Report

Automated evidence:

- Desktop focused UI suite: 69 passed across Phantom presence, model controls, and chat timeline cleanup.
- Registered Ollama request-context tests: 2 passed.
- Gateway duplicate-marker regression: 1 passed.
- Phantom profile/runtime/config sweep: 299 passed, 3 unrelated Windows harness failures.
- TypeScript renderer/electron/e2e typecheck: passed.
- Targeted desktop lint: passed.
- Production build and unpacked Windows packaging: passed.

The three broad-suite failures are documented, not hidden: one asserts the legacy `~/.hermes` default against this product's installed `AppData\Local\hermes` home, and two invoke `env -i sh` on Windows after intentionally erasing the PATH that would locate `sh`.

Manual packaged path:

- App launched from the rebuilt executable.
- Both Phantom profiles were visible.
- Active-profile reselection kept the visible model-marker count unchanged.
- Fresh Phantom prompt entered running state, started local Ollama, changed the mascot to the working pose, and did not reproduce `_ollama_request_ctx`.
