# Connections Panel — Design

Status: approved, implementing.

## Goal

Let the user store their own provider API keys locally (starting with
Claude/Anthropic and Codex/OpenAI) so spawned terminals — solo tiles and
Mission Mode workers alike — use that key instead of relying on whatever's
already configured system-wide. No accounts, no logins: Termina stays
strictly local/single-user (127.0.0.1 only), this is just per-provider
credential storage instead of always inheriting ambient system config.

Explicitly out of scope for this pass: OpenRouter/GLM support (needs a new
agent loop to even exist as a worker type — separately scoped in
`2026-07-13-openrouter-agent-scoping.md`, not built in this pass), any form
of multi-user auth (explicitly rejected — local is trusted enough without
sign-ins), and OS-keychain integration (would require a new dependency).

## Threat model (state this plainly in the UI, not just here)

This encrypts API keys at rest so they don't sit as plaintext in
`.termina/`, don't appear in git history if `.termina/` were ever
accidentally un-gitignored, and are never echoed into any log, ledger,
recording, or API response. It does **not** protect against a determined
attacker with full access to the user's own account — the same limitation
`~/.claude/` or `~/.aws/credentials` already have. This is meaningfully
better than the status quo (no stored secret at all today), not a claim of
airtight security.

## Architecture

### `connections.js` (new, top-level — not `mission/`-scoped)

- `getOrCreateKey(appDir)` — reads a 32-byte key from `.termina/connections.key`;
  generates one via `crypto.randomBytes(32)` and writes it if missing.
- `saveConnection(appDir, provider, apiKey)` — AES-256-GCM encrypts
  `apiKey` with a fresh random IV, stores `{iv, authTag, ciphertext}`
  (all base64) plus `{last4, connectedAt}` metadata in
  `.termina/connections.json`, keyed by provider.
- `readConnections(appDir)` — returns **metadata only**:
  `{ [provider]: { connected: true, last4, connectedAt } }` — safe to
  serialize straight to the client, since it never includes the ciphertext
  or key.
- `removeConnection(appDir, provider)` — deletes that provider's entry.
- `getApiKeyEnv(appDir, provider)` — decrypts and returns
  `{ [ENV_VAR]: apiKey }` for the given provider, or `{}` if none is
  stored. **Server-side only** — never called from a request handler that
  serializes its result to the client.

```js
export const CONNECTION_PROVIDERS = {
  claude: { label: "Claude (Anthropic)", envVar: "ANTHROPIC_API_KEY" },
  codex: { label: "Codex (OpenAI)", envVar: "OPENAI_API_KEY" },
};
```

### `profiles.js` — `terminalEnv(providerId)`

Existing `terminalEnv()` (already the single allow-listed-env choke point
every spawned PTY goes through — both `server.js`'s solo-tile `startSession`
calls and Mission Mode's worker spawns) gains an optional `providerId`
parameter. When present and a connection is stored for it, the decrypted
env var is merged into the returned env object. Absent `providerId` or no
stored connection: behavior is byte-for-byte identical to today (existing
callers that don't pass it keep working unchanged).

`server.js`'s two call sites (`startSession` for solo tiles, and Mission
Mode's worker/branch spawn paths) start passing `profile.id` /
`role.provider` through — the profile ids Termina already uses (`"claude"`,
`"codex"`) match `CONNECTION_PROVIDERS`' keys exactly, so no new mapping
table is needed.

## API

- `GET /api/connections` → `{ ok: true, connections: {...} }` (metadata
  from `readConnections`, safe to expose).
- `POST /api/connections/:provider` → body `{ apiKey }`; validates
  `provider` is a known key in `CONNECTION_PROVIDERS` and `apiKey` is a
  non-empty string; calls `saveConnection`; returns updated metadata only.
- `DELETE /api/connections/:provider` → calls `removeConnection`; returns
  `{ ok: true }`.

## UI

New "🔌 Connections" topbar button (same modal pattern as the existing
Missions modal: `#connections-modal`, open/close wiring identical in shape
to `openMissionModal`/`closeMissionModal`). One row per
`CONNECTION_PROVIDERS` entry:

- A masked `<input type="password">` for pasting a new key, a "Save"
  button.
- A status line: "Connected — saved key ending •••`last4`" (green) when
  `connections[provider].connected`, otherwise "Using system default —
  whatever `claude`/`codex login` already has configured" (muted).
- A "Remove" button, shown only when connected, calling the DELETE route.

The input is write-only — once a key is saved, the field clears and only
the masked status line remains; the real value is never fetched back or
displayed again by anything in the UI.

## Error handling

Consistent with the rest of Termina: a `POST`/`DELETE` failure surfaces as
an inline error next to that provider's row, never a blocked modal; if
`.termina/connections.json` is missing or corrupted, `readConnections`
returns `{}` (every provider shows "Using system default") rather than
throwing — matches every other `read*` function's corrupted-file handling
already established in `mission/store.js`.

## Testing

- `tests/connections.test.mjs` — round-trip save/read/remove; `readConnections`
  never includes ciphertext/key material in its return value (a literal
  assertion that the object has no `iv`/`authTag`/`ciphertext` keys, so this
  test would fail loudly if a future edit accidentally widened what's
  exposed); a corrupted `connections.json` makes `readConnections` return
  `{}` instead of throwing; `getApiKeyEnv` returns `{}` for a provider with
  no stored connection and the correct `{ANTHROPIC_API_KEY: ...}` /
  `{OPENAI_API_KEY: ...}` shape for one that has one.
- `tests/profiles.test.mjs` (new, first test file for `profiles.js`) —
  `terminalEnv()` with no argument is unchanged from today; `terminalEnv("claude")`
  with a stored connection includes `ANTHROPIC_API_KEY`; `terminalEnv("claude")`
  with no stored connection does not include it (falls through to whatever
  `process.env` already has, i.e. today's exact behavior).
- Manual verification (in the implementation plan): save a real key via the
  UI, launch a `claude` tile, confirm (via a throwaway `echo $env:ANTHROPIC_API_KEY`
  in a plain PowerShell tile, not the claude tile itself, to avoid ever
  displaying the key in a recorded pane) that the spawned process actually
  received it.
