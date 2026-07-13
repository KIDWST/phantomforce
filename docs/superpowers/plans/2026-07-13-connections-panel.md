# Connections Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Local, encrypted storage for provider API keys (Claude/Codex), injected into spawned terminal processes in place of ambient system config — no accounts, no logins, single local user.

**Architecture:** One new top-level module (`connections.js`, AES-256-GCM via Node's built-in `crypto`), one extension point in `profiles.js`'s existing `terminalEnv()`, three new API routes, and a new topbar modal mirroring the existing Missions modal exactly.

**Tech Stack:** Node's built-in `crypto`/`node:test`, no new dependencies, vanilla JS frontend matching existing `public/*.js` conventions (plain global scripts, `api()` fetch wrapper, `escapeHtml`).

## Global Constraints

- No new npm dependencies.
- `.termina/connections.key` and `.termina/connections.json` live under the already-gitignored `.termina/` tree.
- The real API key value must never be returned by any API response after being saved, never logged, never appear in any ledger/report/recording file.
- `terminalEnv()` with no `providerId` argument must remain byte-for-byte identical to its current behavior (existing callers unaffected until explicitly updated).

---

### Task 1: `connections.js`

**Files:**
- Create: `connections.js`
- Test: `tests/connections.test.mjs`

**Interfaces:**
- Produces: `CONNECTION_PROVIDERS: {claude:{label,envVar}, codex:{label,envVar}}`, `saveConnection(appDir, provider, apiKey) -> Promise<void>`, `readConnections(appDir) -> {[provider]: {connected:true, last4, connectedAt}}`, `removeConnection(appDir, provider) -> Promise<void>`, `getApiKeyEnv(appDir, provider) -> {[envVar]: string} | {}`.

- [ ] **Step 1: Write the failing tests**

```js
// tests/connections.test.mjs
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  CONNECTION_PROVIDERS,
  getApiKeyEnv,
  readConnections,
  removeConnection,
  saveConnection,
} from "../connections.js";

async function withTempAppDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "termina-connections-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("readConnections returns an empty object when nothing is saved", async () => {
  await withTempAppDir(async (appDir) => {
    assert.deepEqual(readConnections(appDir), {});
  });
});

test("saveConnection then readConnections exposes only metadata, never the key material", async () => {
  await withTempAppDir(async (appDir) => {
    await saveConnection(appDir, "claude", "sk-ant-abc123xyz789");
    const all = readConnections(appDir);
    assert.equal(all.claude.connected, true);
    assert.equal(all.claude.last4, "z789");
    assert.ok(typeof all.claude.connectedAt === "number");
    // Literal assertion: the exposed shape must never widen to include
    // ciphertext/key material, even accidentally in a future edit.
    assert.equal(Object.prototype.hasOwnProperty.call(all.claude, "iv"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(all.claude, "authTag"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(all.claude, "ciphertext"), false);
    assert.equal(JSON.stringify(all).includes("abc123xyz789"), false);
  });
});

test("getApiKeyEnv decrypts back to the real key under the provider's env var", async () => {
  await withTempAppDir(async (appDir) => {
    await saveConnection(appDir, "claude", "sk-ant-abc123xyz789");
    assert.deepEqual(getApiKeyEnv(appDir, "claude"), { ANTHROPIC_API_KEY: "sk-ant-abc123xyz789" });
  });
});

test("getApiKeyEnv returns {} for a provider with no stored connection", async () => {
  await withTempAppDir(async (appDir) => {
    assert.deepEqual(getApiKeyEnv(appDir, "claude"), {});
  });
});

test("removeConnection deletes the entry", async () => {
  await withTempAppDir(async (appDir) => {
    await saveConnection(appDir, "codex", "sk-openai-xyz");
    await removeConnection(appDir, "codex");
    assert.deepEqual(readConnections(appDir), {});
    assert.deepEqual(getApiKeyEnv(appDir, "codex"), {});
  });
});

test("a corrupted connections.json makes readConnections return {} instead of throwing", async () => {
  await withTempAppDir(async (appDir) => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(path.join(appDir, ".termina"), { recursive: true });
    await writeFile(path.join(appDir, ".termina", "connections.json"), "not json", "utf8");
    assert.deepEqual(readConnections(appDir), {});
  });
});

test("CONNECTION_PROVIDERS maps claude/codex to their real env var names", () => {
  assert.equal(CONNECTION_PROVIDERS.claude.envVar, "ANTHROPIC_API_KEY");
  assert.equal(CONNECTION_PROVIDERS.codex.envVar, "OPENAI_API_KEY");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/connections.test.mjs`
Expected: FAIL — `Cannot find module '../connections.js'`

- [ ] **Step 3: Write the implementation**

```js
// connections.js
// Local, encrypted storage for provider API keys — no accounts, no logins,
// single local user. Encrypts at rest so keys don't sit as plaintext under
// .termina/, and are never echoed into any log, ledger, recording, or API
// response. This does NOT protect against a determined attacker with full
// access to the user's own account, the same limitation ~/.claude/ or
// ~/.aws/credentials already have — it's meaningfully better than the
// status quo (no stored secret at all), not a claim of airtight security.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const CONNECTION_PROVIDERS = {
  claude: { label: "Claude (Anthropic)", envVar: "ANTHROPIC_API_KEY" },
  codex: { label: "Codex (OpenAI)", envVar: "OPENAI_API_KEY" },
};

function termDir(appDir) {
  const dir = path.join(appDir, ".termina");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function keyPath(appDir) {
  return path.join(termDir(appDir), "connections.key");
}

function connectionsPath(appDir) {
  return path.join(termDir(appDir), "connections.json");
}

function getOrCreateKey(appDir) {
  const file = keyPath(appDir);
  if (existsSync(file)) return Buffer.from(readFileSync(file, "utf8"), "base64");
  const key = randomBytes(32);
  writeFileSync(file, key.toString("base64"), "utf8");
  return key;
}

function readRaw(appDir) {
  const file = connectionsPath(appDir);
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function writeRaw(appDir, all) {
  writeFileSync(connectionsPath(appDir), JSON.stringify(all, null, 2), "utf8");
}

export async function saveConnection(appDir, provider, apiKey) {
  const key = getOrCreateKey(appDir);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  const all = readRaw(appDir);
  all[provider] = {
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    last4: apiKey.slice(-4),
    connectedAt: Date.now(),
  };
  writeRaw(appDir, all);
}

// Metadata only — never includes iv/authTag/ciphertext. Safe to serialize
// straight to an API response.
export function readConnections(appDir) {
  const all = readRaw(appDir);
  const out = {};
  for (const [provider, entry] of Object.entries(all)) {
    out[provider] = { connected: true, last4: entry.last4, connectedAt: entry.connectedAt };
  }
  return out;
}

export async function removeConnection(appDir, provider) {
  const all = readRaw(appDir);
  delete all[provider];
  writeRaw(appDir, all);
}

// Server-side only — never call this from a handler that serializes its
// result back to the client.
export function getApiKeyEnv(appDir, provider) {
  const meta = CONNECTION_PROVIDERS[provider];
  if (!meta) return {};
  const all = readRaw(appDir);
  const entry = all[provider];
  if (!entry) return {};
  try {
    const key = getOrCreateKey(appDir);
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(entry.iv, "base64"));
    decipher.setAuthTag(Buffer.from(entry.authTag, "base64"));
    const plain = Buffer.concat([decipher.update(Buffer.from(entry.ciphertext, "base64")), decipher.final()]);
    return { [meta.envVar]: plain.toString("utf8") };
  } catch {
    return {};
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/connections.test.mjs`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add connections.js tests/connections.test.mjs
git commit -m "Add local encrypted Connections storage (Claude/Codex API keys)"
```

---

### Task 2: `terminalEnv(providerId)` in `profiles.js`

**Files:**
- Modify: `profiles.js`
- Test: `tests/profiles.test.mjs` (new)

**Interfaces:**
- Consumes: `getApiKeyEnv` (Task 1).
- Produces: `terminalEnv(providerId?)` — same return shape as today, with the provider's env var merged in when a connection exists.

- [ ] **Step 1: Write the failing tests**

```js
// tests/profiles.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

import { terminalEnv } from "../profiles.js";

test("terminalEnv() with no argument matches today's behavior — no provider key injected", () => {
  const env = terminalEnv();
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.TERM, "xterm-256color");
});

test("terminalEnv(providerId) with no stored connection does not inject a key", () => {
  const env = terminalEnv("claude");
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
});
```

(A live save→inject round trip is covered by the manual verification step
in Task 4, not a unit test here — `profiles.js` resolves its own `appDir`
internally from `import.meta.url`, so a unit test would need to either
monkeypatch that or write into the real repo's `.termina/`; neither is
worth it for what's ultimately one `Object.assign`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/profiles.test.mjs`
Expected: FAIL — `terminalEnv` doesn't yet accept a provider id (though these
two particular tests may pass even against the old signature; that's fine,
they're guarding against regressions from Step 3, not proving new
behavior — the real new-behavior check is the manual verification in Task 4).

- [ ] **Step 3: Write the implementation**

In `profiles.js`, add the import and update `terminalEnv`:

```js
import { getApiKeyEnv } from "./connections.js";
```

Replace:

```js
export function terminalEnv() {
  const keep = [
```

with:

```js
export function terminalEnv(providerId) {
  const keep = [
```

And replace the function's final lines:

```js
  for (const key of keep) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key];
    }
  }
  return env;
}
```

with:

```js
  for (const key of keep) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key];
    }
  }
  if (providerId) Object.assign(env, getApiKeyEnv(appDir, providerId));
  return env;
}
```

- [ ] **Step 4: Update `server.js`'s two `terminalEnv()` call sites to pass the provider id**

`grep -n "terminalEnv()" server.js` finds the call sites. Solo-tile
`startSession` spawns with `profile.id` as the provider id; Mission Mode's
worker/branch spawn paths (which build a `workerProfile` object) use
`providerId`/`role.provider`, already a local variable in each of those
blocks. Change each `terminalEnv()` call to `terminalEnv(profile.id)` in
`startSession`, and to `terminalEnv(providerId)` in the mission-worker and
branch-worker spawn blocks — matching whichever variable holding the
provider id is already in scope at each call site (do not introduce a new
variable; every one of these blocks already computes/has `providerId` or
`profile.id` available).

- [ ] **Step 5: Run tests to verify they pass, syntax-check server.js**

Run: `node --test tests/profiles.test.mjs && node --check server.js && node --check profiles.js`
Expected: PASS, no syntax errors.

- [ ] **Step 6: Commit**

```bash
git add profiles.js server.js tests/profiles.test.mjs
git commit -m "Inject stored connection API keys into spawned terminal processes"
```

---

### Task 3: API routes

**Files:**
- Modify: `server.js`

**Interfaces:**
- Consumes: `CONNECTION_PROVIDERS`, `saveConnection`, `readConnections`, `removeConnection` (Task 1).

- [ ] **Step 1: Import**

Add near the other top-level imports in `server.js`:

```js
import { CONNECTION_PROVIDERS, readConnections, removeConnection, saveConnection } from "./connections.js";
```

- [ ] **Step 2: Add the three routes**

Insert after the existing `/api/repos` route block in `server.js`:

```js
  if (pathName === "/api/connections" && req.method === "GET") {
    return sendJson(res, 200, { ok: true, connections: readConnections(appDir) });
  }

  const connectionMatch = pathName.match(/^\/api\/connections\/([\w-]+)$/);
  if (connectionMatch && req.method === "POST") {
    const provider = connectionMatch[1];
    if (!Object.prototype.hasOwnProperty.call(CONNECTION_PROVIDERS, provider)) {
      return sendJson(res, 400, { ok: false, error: "unknown_provider" });
    }
    readJsonBody(req)
      .then(async (body) => {
        const apiKey = String(body.apiKey ?? "").trim();
        if (!apiKey) return sendJson(res, 400, { ok: false, error: "api_key_required" });
        await saveConnection(appDir, provider, apiKey);
        return sendJson(res, 200, { ok: true, connections: readConnections(appDir) });
      })
      .catch((error) => sendJson(res, 500, { ok: false, error: error.message }));
    return;
  }

  if (connectionMatch && req.method === "DELETE") {
    const provider = connectionMatch[1];
    removeConnection(appDir, provider)
      .then(() => sendJson(res, 200, { ok: true, connections: readConnections(appDir) }))
      .catch((error) => sendJson(res, 500, { ok: false, error: error.message }));
    return;
  }
```

- [ ] **Step 3: Syntax-check and run the full suite**

Run: `node --check server.js && npm test`
Expected: no syntax errors; all prior tests plus Tasks 1-2's new tests pass.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "Add /api/connections routes (list, save, remove)"
```

---

### Task 4: Connections modal UI

**Files:**
- Modify: `public/index.html` (topbar button + modal markup)
- Create: `public/connections.js`
- Modify: `public/styles.css`

**Interfaces:**
- Consumes: `GET/POST/DELETE /api/connections[/:provider]` (Task 3); existing globals `api`, `escapeHtml`.

- [ ] **Step 1: Add the topbar button and modal markup to `public/index.html`**

Add a button next to the existing `missions-btn` in the `.controls` div:

```html
        <button id="connections-btn" class="ghost" type="button" title="Connect your own API keys per provider">🔌 Connections</button>
```

Add a modal after the existing `#mission-modal` block, before the closing
`</main>`... actually after `#mission-modal`'s closing `</div>`, mirroring
its exact structure:

```html
    <div id="connections-modal" class="overlay hidden" role="dialog" aria-modal="true" aria-label="Connections">
      <div class="overlay-panel mission-panel">
        <div class="overlay-head">
          <span>Connections</span>
          <button type="button" id="connections-close" class="ghost">Close</button>
        </div>
        <div id="connections-body" class="mission-body"></div>
      </div>
    </div>
```

Add the new script tag alongside the existing ones, before `mission.js`
(no dependency between them, order doesn't matter functionally, but keep
grouped with the other feature scripts):

```html
    <script src="/connections.js"></script>
```

- [ ] **Step 2: Write `public/connections.js`**

```js
/* Connections panel — local, encrypted API key storage per provider. No
   accounts, no logins; this is single-user, local-only Termina. Shares
   globals from app.js (api, escapeHtml). */

const CONNECTION_PROVIDER_LABELS = {
  claude: "Claude (Anthropic)",
  codex: "Codex (OpenAI)",
};

document.getElementById("connections-btn").addEventListener("click", () => {
  document.getElementById("connections-modal").classList.remove("hidden");
  renderConnections();
});
document.getElementById("connections-close").addEventListener("click", () => {
  document.getElementById("connections-modal").classList.add("hidden");
});
document.getElementById("connections-modal").addEventListener("click", (e) => {
  if (e.target.id === "connections-modal") document.getElementById("connections-modal").classList.add("hidden");
});

async function renderConnections() {
  const body = document.getElementById("connections-body");
  body.innerHTML = `<p class="mission-loading">Loading…</p>`;
  const res = await api("/api/connections").then((r) => r.json()).catch(() => ({ ok: false }));
  const connections = res.ok ? res.connections : {};
  body.innerHTML = "";

  for (const [provider, label] of Object.entries(CONNECTION_PROVIDER_LABELS)) {
    body.appendChild(renderConnectionRow(provider, label, connections[provider]));
  }
}

function renderConnectionRow(provider, label, entry) {
  const row = document.createElement("div");
  row.className = "connection-row";
  row.innerHTML = `
    <div class="connection-row-head">
      <b>${escapeHtml(label)}</b>
      <span class="connection-status">${entry ? `Connected — saved key ending •••${escapeHtml(entry.last4)}` : "Using system default"}</span>
    </div>
    <div class="connection-row-actions">
      <input type="password" class="connection-key-input" placeholder="Paste API key" />
      <button type="button" class="mw-btn connection-save">Save</button>
      ${entry ? `<button type="button" class="mw-btn connection-remove">Remove</button>` : ""}
    </div>
    <p class="connection-error hidden"></p>
  `;

  const errorEl = row.querySelector(".connection-error");
  row.querySelector(".connection-save").addEventListener("click", async () => {
    const input = row.querySelector(".connection-key-input");
    const apiKey = input.value.trim();
    errorEl.classList.add("hidden");
    if (!apiKey) {
      errorEl.textContent = "Paste a key first.";
      errorEl.classList.remove("hidden");
      return;
    }
    const res = await api(`/api/connections/${provider}`, { method: "POST", body: JSON.stringify({ apiKey }) }).then((r) => r.json());
    if (!res.ok) {
      errorEl.textContent = friendlyError(res.error);
      errorEl.classList.remove("hidden");
      return;
    }
    renderConnections();
  });

  const removeBtn = row.querySelector(".connection-remove");
  removeBtn?.addEventListener("click", async () => {
    const res = await api(`/api/connections/${provider}`, { method: "DELETE" }).then((r) => r.json());
    if (!res.ok) {
      errorEl.textContent = friendlyError(res.error);
      errorEl.classList.remove("hidden");
      return;
    }
    renderConnections();
  });

  return row;
}
```

`friendlyError` is the existing global helper already defined in
`public/mission.js` — since all `<script>` tags share one global scope,
this file can call it directly as long as `mission.js` has already loaded
by the time a user clicks Save (true for any real interaction, since all
scripts load before user input is possible).

- [ ] **Step 3: Add styles**

Append to `public/styles.css`:

```css
.connection-row {
  padding: 12px 0;
  border-bottom: 1px solid var(--line);
}
.connection-row-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.connection-status {
  font-size: 12px;
  color: var(--muted);
}
.connection-row-actions {
  display: flex;
  gap: 8px;
}
.connection-key-input {
  flex: 1;
  padding: 6px 8px;
  border-radius: 8px;
  border: 1px solid var(--line);
  background: var(--panel);
  color: var(--soft);
  font-size: 12px;
}
.connection-error {
  color: var(--red);
  font-size: 11px;
  margin: 6px 0 0;
}
```

- [ ] **Step 4: Syntax-check**

Run: `node --check public/connections.js`
Expected: no output.

- [ ] **Step 5: Manual verification**

Run: `npm start`, open the app, click "🔌 Connections", save a real (or
throwaway/rotatable) Anthropic key, confirm the status line shows the
masked last-4 and Remove appears; open a plain PowerShell tile (not a
`claude` tile, so nothing sensitive is ever displayed) and run
`echo $env:ANTHROPIC_API_KEY` — **do not** run this in a recorded Mission
Mode worker tile — to confirm the *next newly-launched* `claude` tile's
process actually receives the key (the PowerShell check itself won't show
it, since the key is only injected into `claude`/`codex` profile spawns,
not plain shells — the real check is that a freshly-started `claude` tile
works using the saved key even with no system-wide login configured, if
that's testable; otherwise confirm via Task 5's live check below). Then
click Remove and confirm the status line reverts to "Using system default."

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/connections.js public/styles.css
git commit -m "Add Connections panel UI"
```

---

### Task 5: Full suite + live verification

- [ ] **Step 1: Run the complete test suite**

Run: `npm test`
Expected: PASS — prior count plus 7 (Task 1) + 2 (Task 2) = prior + 9.

- [ ] **Step 2: Live-verify the actual env injection**

Boot the server standalone (`node server.js`), `POST /api/connections/claude`
with a real or clearly-fake-but-formatted test value, then start a session
using a profile whose `command`/`args` is a harmless one-liner that prints
`ANTHROPIC_API_KEY` (e.g. temporarily point a test profile at
`pwsh -Command "echo $env:ANTHROPIC_API_KEY"` via the existing
`/api/sessions/:id/start` route with a throwaway profile id) to confirm the
env var is genuinely present in the spawned process — this is the one part
of this feature that can't be verified by a unit test (it crosses into real
process spawning), so it must be checked live before calling this done.
Clean up the saved test key afterward via `DELETE /api/connections/claude`.
