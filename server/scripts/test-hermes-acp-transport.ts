import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  HermesAcpTransport,
  normalizeHermesAcpUpdate,
  type HermesAcpNormalizedEvent,
} from "../src/phantom-ai/hermes-acp-transport.js";

const scriptDir = resolve(fileURLToPath(new URL(".", import.meta.url)));
const fixture = resolve(scriptDir, "fixtures", "fake-hermes-acp.mjs");
const workspace = resolve(scriptDir, "../..");

const events: HermesAcpNormalizedEvent[] = [];
const transport = new HermesAcpTransport({
  executable: process.execPath,
  args: [fixture],
  workspaceRoot: workspace,
  requestTimeoutMs: 10_000,
  idleTimeoutMs: 30_000,
});
transport.on("event", (event) => events.push(event));

const capabilities = await transport.initialize();
assert.equal(capabilities.protocolVersion, 1);
assert.equal(capabilities.agentName, "Fake Hermes");
assert.equal(capabilities.loadSession, true);
assert.equal(capabilities.prompt.image, true);

const created = await transport.newSession();
assert.equal(created.sessionId, "fake-hermes-session-1");
const loaded = await transport.loadSession(created.sessionId);
assert.equal(loaded.sessionId, created.sessionId);
await transport.prompt(created.sessionId, "Plan a safe documentation edit.");
assert(events.some((event) => event.type === "connecting"));
assert(events.some((event) => event.type === "connected"));
assert(events.some((event) => event.type === "analyzing"));
assert(events.some((event) => event.type === "plan_created"));
assert(events.some((event) => event.type === "context_inspection"));
assert(events.some((event) => event.type === "message_delta"));
assert(!events.some((event) => event.summary.includes("private hidden reasoning")));
transport.cancel(created.sessionId);
assert(events.some((event) => event.type === "cancelled"));
transport.close();

const unknownUpdate = normalizeHermesAcpUpdate(
  { sessionUpdate: "unknown_update", rawInput: "secret" },
  1,
);
assert.equal(unknownUpdate, null);

const malformedEvents: HermesAcpNormalizedEvent[] = [];
const malformedTransport = new HermesAcpTransport({
  executable: process.execPath,
  args: [fixture],
  workspaceRoot: workspace,
  env: { ...process.env, FAKE_HERMES_ACP_MODE: "malformed" },
  requestTimeoutMs: 5_000,
});
malformedTransport.on("event", (event) => malformedEvents.push(event));
await malformedTransport.initialize();
const malformedSession = await malformedTransport.newSession();
await malformedTransport.prompt(malformedSession.sessionId, "malformed");
assert(malformedEvents.some((event) => event.type === "failed"));
malformedTransport.close();

const dropTransport = new HermesAcpTransport({
  executable: process.execPath,
  args: [fixture],
  workspaceRoot: workspace,
  env: { ...process.env, FAKE_HERMES_ACP_MODE: "drop" },
  requestTimeoutMs: 5_000,
});
await dropTransport.initialize();
const droppedSession = await dropTransport.newSession();
await assert.rejects(
  dropTransport.prompt(droppedSession.sessionId, "drop"),
  /hermes_acp_disconnected/,
);
dropTransport.close();

const timeoutTransport = new HermesAcpTransport({
  executable: process.execPath,
  args: [fixture],
  workspaceRoot: workspace,
  env: { ...process.env, FAKE_HERMES_ACP_MODE: "timeout" },
  requestTimeoutMs: 1_000,
});
await timeoutTransport.initialize();
const timeoutSession = await timeoutTransport.newSession();
await assert.rejects(
  timeoutTransport.prompt(timeoutSession.sessionId, "timeout"),
  /hermes_acp_timeout:session\/prompt/,
);
timeoutTransport.close();

console.log(JSON.stringify({
  ok: true,
  handshake: true,
  capabilities: true,
  sessionCreation: true,
  sessionLoad: true,
  streamingNormalization: true,
  malformedEventsFailClosed: true,
  hiddenReasoningRedacted: true,
  droppedConnectionFailsClosed: true,
  cancellation: true,
  timeoutFailsClosed: true,
}));
