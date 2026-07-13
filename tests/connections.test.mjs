import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
    await mkdir(path.join(appDir, ".termina"), { recursive: true });
    await writeFile(path.join(appDir, ".termina", "connections.json"), "not json", "utf8");
    assert.deepEqual(readConnections(appDir), {});
  });
});

test("CONNECTION_PROVIDERS maps claude/codex to their real env var names", () => {
  assert.equal(CONNECTION_PROVIDERS.claude.envVar, "ANTHROPIC_API_KEY");
  assert.equal(CONNECTION_PROVIDERS.codex.envVar, "OPENAI_API_KEY");
});

test("CONNECTION_PROVIDERS.openrouter declares a model extraField", () => {
  assert.equal(CONNECTION_PROVIDERS.openrouter.envVar, "OPENROUTER_API_KEY");
  assert.equal(CONNECTION_PROVIDERS.openrouter.extraField.envVar, "OPENROUTER_MODEL");
});

test("saveConnection stores and getApiKeyEnv returns an extraField value", async () => {
  await withTempAppDir(async (appDir) => {
    await saveConnection(appDir, "openrouter", "sk-or-test123", "z-ai/glm-5.2");
    const env = getApiKeyEnv(appDir, "openrouter");
    assert.equal(env.OPENROUTER_API_KEY, "sk-or-test123");
    assert.equal(env.OPENROUTER_MODEL, "z-ai/glm-5.2");
  });
});

test("readConnections exposes the extra value as metadata (it's not a secret)", async () => {
  await withTempAppDir(async (appDir) => {
    await saveConnection(appDir, "openrouter", "sk-or-test123", "z-ai/glm-5.2");
    assert.equal(readConnections(appDir).openrouter.extra, "z-ai/glm-5.2");
  });
});
