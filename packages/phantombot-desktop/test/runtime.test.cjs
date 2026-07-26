"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  findHermesExecutable,
  findPhantomForceRoot,
  phantomForceLaunchCommand,
  probeUrl,
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
