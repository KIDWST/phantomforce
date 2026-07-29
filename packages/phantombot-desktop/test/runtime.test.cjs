"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  KIMI_CONTEXT_LENGTH,
  KIMI_ENDPOINT,
  KIMI_MODEL,
  KIMI_PROVIDER_ID,
  LOCAL_OLLAMA_ENDPOINT,
  PHANTOM_V1_CONTEXT_LENGTH,
  PHANTOM_V1_MODEL,
  PHANTOM_V1_PROVIDER_ID,
  assertKimiDoesNotUseOpenRouter,
  findHermesExecutable,
  findPhantomForceRoot,
  isKimiProviderRecord,
  isPhantomV1Model,
  migrateHermesComposerStorage,
  migrateKimiProviderRecord,
  phantomForceLaunchCommand,
  probeUrl,
  resolveKimiProviderConfig,
  safeRuntimeSummary,
  waitForUrl
} = require("../src/runtime.cjs");

test("PhantomForce launch command is fixed and shell-injection resistant", () => {
  const launch = phantomForceLaunchCommand({
    ComSpec: "C:\\Windows\\System32\\cmd.exe",
    SystemRoot: "C:\\Windows"
  });
  if (process.platform === "win32") {
    assert.equal(launch.executable, "C:\\Windows\\System32\\cmd.exe");
    assert.deepEqual(launch.args, ["/d", "/s", "/c", "npm.cmd run dev:server"]);
  } else {
    assert.equal(launch.executable, "npm");
    assert.deepEqual(launch.args, ["run", "dev:server"]);
  }
});

test("probeUrl reports a reachable local health endpoint", async (t) => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end('{"ok":true}');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.equal(typeof address, "object");
  const url = `http://127.0.0.1:${address.port}/health`;
  assert.equal(await probeUrl(url), true);
});

test("waitForUrl observes a service that becomes ready", async (t) => {
  const server = http.createServer((_request, response) => response.end("ok"));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/health`;
  assert.equal(
    await waitForUrl(url, { timeoutMs: 1000, intervalMs: 20 }),
    true
  );
});

test("findHermesExecutable honors an explicit existing executable", (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "phantombot-hermes-"));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const executable = path.join(tempRoot, "hermes.exe");
  fs.writeFileSync(executable, "");
  assert.equal(
    findHermesExecutable({
      PHANTOMBOT_HERMES_EXECUTABLE: executable,
      PATH: ""
    }),
    executable
  );
});

test("findPhantomForceRoot walks up to the monorepo contract", (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "phantombot-root-"));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const nested = path.join(tempRoot, "packages", "phantombot-desktop", "src");
  fs.mkdirSync(path.join(tempRoot, "server"), { recursive: true });
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(tempRoot, "package.json"), "{}");
  fs.writeFileSync(path.join(tempRoot, "server", "package.json"), "{}");
  assert.equal(
    findPhantomForceRoot({
      env: {},
      packageDirectory: nested,
      resourcesPath: path.join(tempRoot, "missing")
    }),
    tempRoot
  );
});

test("safeRuntimeSummary excludes paths, logs, and provider details", () => {
  const summary = safeRuntimeSummary({
    app: {
      reachable: true,
      source: "local",
      checkedAt: "2026-07-26T00:00:00.000Z",
      root: "C:\\secret\\repo"
    },
    hermes: {
      installed: true,
      healthy: true,
      acpReady: true,
      executable: "C:\\secret\\hermes.exe",
      version: "Hermes 1.2.3",
      rawOutput: "API key: secret"
    },
    supervisor: {
      startedByDesktop: true,
      pid: 42,
      command: "secret command"
    }
  });
  assert.deepEqual(summary, {
    app: {
      reachable: true,
      source: "local",
      checkedAt: "2026-07-26T00:00:00.000Z",
      errorCode: null
    },
    hermes: {
      installed: true,
      healthy: true,
      acpReady: true,
      version: "Hermes 1.2.3",
      errorCode: null
    },
    supervisor: {
      startedByDesktop: true,
      pid: 42,
      errorCode: null
    }
  });
});

test("Kimi provider configuration resolves to the direct gateway and 65536 context", () => {
  const config = resolveKimiProviderConfig({
    provider_id: KIMI_PROVIDER_ID,
    endpoint: KIMI_ENDPOINT,
    model: KIMI_MODEL,
    context_length: 8192,
    details: { context_length: KIMI_CONTEXT_LENGTH }
  });
  assert.equal(config.provider_id, KIMI_PROVIDER_ID);
  assert.equal(config.endpoint, KIMI_ENDPOINT);
  assert.equal(config.model, KIMI_MODEL);
  assert.equal(config.context_length, KIMI_CONTEXT_LENGTH);
  assert.equal(config.openrouter_used, false);
});

test("Kimi provider default accepts Hermes Agent 64000 token minimum", () => {
  const config = resolveKimiProviderConfig({
    provider_id: KIMI_PROVIDER_ID,
    endpoint: KIMI_ENDPOINT,
    model: KIMI_MODEL,
    context_length: 8192
  });
  assert.ok(config.context_length >= 64000);
  assert.equal(config.metadata_source, "kimi_provider_default");
});

test("stale Kimi provider context migrates from 8192 to 65536", () => {
  const result = migrateKimiProviderRecord({
    id: KIMI_PROVIDER_ID,
    endpoint: KIMI_ENDPOINT,
    model: KIMI_MODEL,
    context_length: 8192
  });
  assert.equal(result.changed, true);
  assert.equal(result.record.provider_id, KIMI_PROVIDER_ID);
  assert.equal(result.record.endpoint, KIMI_ENDPOINT);
  assert.equal(result.record.model, KIMI_MODEL);
  assert.equal(result.record.context_length, KIMI_CONTEXT_LENGTH);
});

test("local Ollama provider is not assigned the Kimi context override", () => {
  const local = {
    id: "ollama-launch",
    endpoint: LOCAL_OLLAMA_ENDPOINT,
    model: "huihui-qwen3.6-35b-uncensored:q3",
    context_length: 8192
  };
  const result = migrateKimiProviderRecord(local);
  assert.equal(result.changed, false);
  assert.deepEqual(result.record, local);
  assert.equal(isKimiProviderRecord(local), false);
});

test("Kimi and normal Ollama provider records remain distinct", () => {
  const kimi = resolveKimiProviderConfig();
  const local = {
    provider_id: "ollama-launch",
    endpoint: LOCAL_OLLAMA_ENDPOINT,
    model: "huihui-qwen3.6-35b-uncensored:q3"
  };
  assert.notEqual(kimi.provider_id, local.provider_id);
  assert.notEqual(kimi.endpoint, local.endpoint);
});

test("Kimi requests never resolve to OpenRouter", () => {
  assert.equal(assertKimiDoesNotUseOpenRouter(resolveKimiProviderConfig()), true);
  assert.equal(assertKimiDoesNotUseOpenRouter({
    provider_id: KIMI_PROVIDER_ID,
    endpoint: "https://openrouter.ai/api/v1",
    model: KIMI_MODEL
  }), false);
});

test("Kimi model alias is not a normal local Ollama request", () => {
  const config = resolveKimiProviderConfig({ model: "kimi-k3-hf" });
  assert.equal(config.endpoint, KIMI_ENDPOINT);
  assert.notEqual(config.endpoint, LOCAL_OLLAMA_ENDPOINT);
});

test("Phantom V1 model aliases are recognized", () => {
  assert.equal(isPhantomV1Model("phantom-v1"), true);
  assert.equal(isPhantomV1Model(PHANTOM_V1_MODEL), true);
  assert.equal(isPhantomV1Model("qwen3-coder:30b"), false);
});

test("Hermes composer storage keeps Phantom V1 local but disables native thinking", () => {
  const values = new Map([
    ["hermes.desktop.composer.model", PHANTOM_V1_MODEL],
    ["hermes.desktop.composer.provider", "ollama-launch"],
    ["hermes.desktop.composer.reasoning_effort", "medium"],
    ["hermes.desktop.composer.thinking", "true"]
  ]);
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };
  const result = migrateHermesComposerStorage(storage);
  assert.equal(result.changed, true);
  assert.equal(values.get("hermes.desktop.composer.provider"), PHANTOM_V1_PROVIDER_ID);
  assert.equal(values.get("hermes.desktop.composer.model"), PHANTOM_V1_MODEL);
  assert.equal(values.get("hermes.desktop.composer.reasoning_effort"), "none");
  assert.equal(values.get("hermes.desktop.composer.reasoning"), "none");
  assert.equal(values.get("hermes.desktop.composer.thinking"), "false");
  assert.equal(values.get("hermes.desktop.composer.thinking.enabled"), "false");
  assert.equal(values.get("hermes.desktop.composer.reasoning.enabled"), "false");
  assert.equal(result.context_length, PHANTOM_V1_CONTEXT_LENGTH);
  assert.equal(result.reasoning_effort, "none");
});

test("Hermes composer storage migrates stale Kimi state to kimi-k3-direct only", () => {
  const values = new Map([
    ["hermes.desktop.composer.model", KIMI_MODEL],
    ["hermes.desktop.composer.provider", "ollama-launch"]
  ]);
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };
  const result = migrateHermesComposerStorage(storage);
  assert.equal(result.changed, true);
  assert.equal(values.get("hermes.desktop.composer.provider"), KIMI_PROVIDER_ID);
  assert.equal(values.get("hermes.desktop.composer.model"), KIMI_MODEL);
  assert.equal(result.context_length, KIMI_CONTEXT_LENGTH);
});

test("Hermes composer storage leaves non-Kimi local Ollama state unchanged", () => {
  const values = new Map([
    ["hermes.desktop.composer.model", "huihui-qwen3.6-35b-uncensored:q3"],
    ["hermes.desktop.composer.provider", "ollama-launch"]
  ]);
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };
  const result = migrateHermesComposerStorage(storage);
  assert.equal(result.changed, false);
  assert.equal(values.get("hermes.desktop.composer.provider"), "ollama-launch");
  assert.equal(values.get("hermes.desktop.composer.model"), "huihui-qwen3.6-35b-uncensored:q3");
});
