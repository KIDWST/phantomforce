import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { join, parse } from "node:path";
import { tmpdir } from "node:os";
import Fastify from "fastify";
import { requestPhantomPlayEngineCommand, type PhantomPlayEngineCommandInput } from "../src/phantomplay-engine-agent.js";
import { registerPhantomPlayEngineRoutes } from "../src/phantomplay-engine-routes.js";
import { makePaywallPreHandler, requiresWrite } from "../src/access/paywall-guard.js";

const root = await mkdtemp(join(tmpdir(), "phantom-engine-agent-test-"));
const input: PhantomPlayEngineCommandInput = { gameId: "fixture", projectTitle: "Fixture", cwd: root, instruction: "Rename the title, run tests.", provider: "codex" };
const execution = { status: "called" as const, outputText: "Updated title.", model: "fixture", errorMessage: null, commands: [{ command: "node --test", exitCode: 0, output: "1 test passed" }] };
const plan = async () => ({ ok: true as const, plan: "Test plan", provider: "codex" as const, model: "fixture" });
try {
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "engine-agent-fixture" }));
  await writeFile(join(root, "game.js"), "export const title = 'Before';\n");
  const result = await requestPhantomPlayEngineCommand(input, { plan, execute: async () => {
    await writeFile(join(root, "game.js"), "export const title = 'After';\n");
    return execution;
  } });
  assert(result.ok);
  assert.equal(result.status, "changes_applied");
  assert.deepEqual(result.changedFiles, ["game.js"]);
  assert.equal(result.commands[0].exitCode, 0);
  assert.equal(result.snapshotComplete, true);
  assert.match(await readFile(join(root, result.receiptPath), "utf8"), /NOT verified/u);

  const noop = await requestPhantomPlayEngineCommand(input, { plan, execute: async () => ({ ...execution, commands: [], outputText: "Everything is verified!" }) });
  assert(noop.ok);
  assert.equal(noop.status, "no_changes");
  assert.deepEqual(noop.changedFiles, []);
  assert.equal(noop.commands.length, 0);

  const failedTest = await requestPhantomPlayEngineCommand(input, { plan, execute: async () => ({ ...execution, commands: [{ command: "node --test", exitCode: 1, output: "FAILED" }] }) });
  assert(failedTest.ok);
  assert.equal(failedTest.status, "review_required");

  const partial = await requestPhantomPlayEngineCommand(input, { plan, execute: async () => {
    await writeFile(join(root, "game.js"), "partially changed");
    throw Error("worker lost connection");
  } });
  assert(!partial.ok);
  assert.deepEqual(partial.changedFiles, ["game.js"]);
  assert(partial.receiptPath);
  assert.match(await readFile(join(root, partial.receiptPath), "utf8"), /worker lost connection/u);

  let release!: () => void;
  const pending = requestPhantomPlayEngineCommand(input, { plan, execute: async () => { await new Promise<void>(resolve => { release = resolve; }); return execution; } });
  while (!release) await new Promise(resolve => setTimeout(resolve, 10));
  const duplicate = await requestPhantomPlayEngineCommand(input, { plan, execute: async () => execution });
  assert(!duplicate.ok && duplicate.code === "project_busy");
  release(); await pending;

  const unsafe = await requestPhantomPlayEngineCommand({ ...input, cwd: parse(root).root });
  assert(!unsafe.ok && unsafe.code === "invalid_project");
  const traversal = join(root, "empty"); await mkdir(traversal);
  const outsideMarker = await requestPhantomPlayEngineCommand({ ...input, cwd: traversal, projectFiles: [".."] });
  assert(!outsideMarker.ok && outsideMarker.code === "invalid_project");
  const deployment = join(root, "deployments", "live"); await mkdir(deployment, { recursive: true });
  await writeFile(join(deployment, "package.json"), "{}");
  const live = await requestPhantomPlayEngineCommand({ ...input, cwd: deployment });
  assert(!live.ok && live.code === "invalid_project");

  const server = Fastify();
  server.addHook("preHandler", makePaywallPreHandler(() => null));
  registerPhantomPlayEngineRoutes(server, { localAllowed: () => true, credential: async () => null, agentOptions: { plan, execute: async () => execution } });
  const headers = { host: "127.0.0.1:5190", "x-phantom-engine-client": "desktop-v1", "x-phantom-engine-request": "fixture-1" };
  const url = "/api/phantomplay/engine/commands";
  for (const hostile of [{ ...headers, origin: "https://example.com" }, { ...headers, host: "admin.phantomforce.online" }, { ...headers, "x-forwarded-for": "8.8.8.8" }, { host: headers.host }]) {
    const denied = await server.inject({ method: "POST", url, headers: hostile, payload: input });
    assert.equal(denied.statusCode, 403);
  }
  const remote = await server.inject({ method: "POST", url, remoteAddress: "10.0.0.5", headers, payload: input });
  assert.equal(remote.statusCode, 403);
  const accepted = await server.inject({ method: "POST", url, headers, payload: input });
  assert.equal(accepted.statusCode, 202);
  const id = accepted.json().runId;
  const retry = await server.inject({ method: "POST", url, headers, payload: input });
  assert.equal(retry.json().runId, id);
  const conflict = await server.inject({ method: "POST", url, headers, payload: { ...input, instruction: "different" } });
  assert.equal(conflict.statusCode, 409);
  let state;
  do { await new Promise(resolve => setTimeout(resolve, 10)); state = await server.inject({ method: "GET", url: url + "/" + id, headers }); } while (state.json().status === "running");
  assert.equal(state.json().result.ok, true);
  const cancel = await server.inject({ method: "POST", url: url + "/" + id + "/cancel", headers });
  assert.equal(cancel.statusCode, 200);
  assert(requiresWrite("POST", "/api/phantomplay/engine/dangerous-new-route"));
  await server.close();
  console.log("PASS: file receipts, no-op truth, failing tests, partial errors, locking, unsafe roots, deployment guard, native job/poll/cancel, idempotency, browser/remote denial, paywall boundary.");
} finally {
  // Only the mkdtemp directory created by this test.
  await rm(root, { recursive: true, force: true });
}
