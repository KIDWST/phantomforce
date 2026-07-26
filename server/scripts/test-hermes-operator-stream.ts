import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import fastifyWebsocket from "@fastify/websocket";
import Fastify from "fastify";
import WebSocket from "ws";

const staleCleanup = process.env.HERMES_STREAM_TEST_CLEANUP;
if (staleCleanup) {
  const tempRoot = resolve(tmpdir());
  const target = resolve(staleCleanup);
  if (!target.startsWith(`${tempRoot}\\`) || !target.split(/[\\/]/u).at(-1)?.startsWith("hermes-stream-")) {
    throw new Error("unsafe_stream_test_cleanup_target");
  }
  await rm(target, { recursive: true, force: true });
  process.stdout.write('{"cleanup":true}\n');
  process.exit(0);
}

const scriptDir = resolve(fileURLToPath(new URL(".", import.meta.url)));
const fakeHermes = resolve(scriptDir, "fixtures", "fake-hermes-acp.mjs");
const root = await mkdtemp(resolve(tmpdir(), "hermes-stream-"));
const phantom = resolve(root, ".phantom");
await mkdir(resolve(root, "docs"), { recursive: true });
await writeFile(
  resolve(root, "docs", "PHANTOMBOT_DESKTOP_VERTICAL_SLICE.md"),
  "# Fixture\n\nStatus: implemented desktop/runtime foundation; the complete master mission is not finished.\n",
  "utf8",
);
await writeFile(
  resolve(root, "package.json"),
  JSON.stringify({
    name: "hermes-stream-fixture",
    private: true,
    scripts: {
      "test:phantombot-desktop": "node -e \"console.log('ok')\"",
    },
  }),
  "utf8",
);

Object.assign(process.env, {
  NODE_ENV: "test",
  PHANTOMBOT_OPERATOR_WORKSPACE_ROOT: root,
  PHANTOM_HERMES_ACP_SESSIONS_PATH: resolve(phantom, "sessions.jsonl"),
  PHANTOM_AGENT_RUNS_LOG_PATH: resolve(phantom, "runs.jsonl"),
  PHANTOM_AGENT_RUN_ARTIFACTS_DIR: resolve(phantom, "artifacts"),
  PHANTOM_HERMES_LEDGER_PATH: resolve(phantom, "ledger.jsonl"),
  PHANTOM_BRAIN_MEMORY_PATH: resolve(phantom, "memory.jsonl"),
  PHANTOM_BRAIN_EVENTS_PATH: resolve(phantom, "memory-events.jsonl"),
});

const { rejectAgentRun } = await import("../src/phantom-ai/agent-runs.js");
const {
  createHermesOperatorSession,
  getHermesOperatorSession,
} = await import("../src/phantom-ai/hermes-acp-operator.js");
const { registerHermesOperatorStream } = await import("../src/phantom-ai/hermes-operator-stream.js");

const owner = {
  id: "stream-owner",
  label: "Stream Owner",
  role: "admin" as const,
  canManageAccess: true,
};
const other = {
  id: "stream-other",
  label: "Other Workspace",
  role: "admin" as const,
  canManageAccess: true,
  orgId: "other-workspace",
};
const options = {
  sessionsPath: resolve(phantom, "sessions.jsonl"),
  workspaceRoot: root,
  hermesExecutable: process.execPath,
  hermesArgs: [fakeHermes],
  env: { ...process.env },
};

const app = Fastify({ logger: false });
await app.register(fastifyWebsocket);
registerHermesOperatorStream(app, {
  resolveToken: async (token) =>
    token === "owner-token" ? owner
      : token === "other-token" ? other
        : null,
});
await app.listen({ host: "127.0.0.1", port: 0 });
const address = app.server.address();
assert(address && typeof address === "object");

function socketUrl(id: string) {
  return `ws://127.0.0.1:${address.port}/ws/phantom-ai/hermes-acp/sessions/${id}`;
}

function waitForMessage(
  socket: WebSocket,
  predicate: (value: Record<string, unknown>) => boolean,
  timeoutMs = 10_000,
) {
  return new Promise<Record<string, unknown>>((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      socket.off("message", onMessage);
      rejectPromise(new Error("stream_message_timeout"));
    }, timeoutMs);
    const onMessage = (raw: WebSocket.RawData) => {
      let value: Record<string, unknown>;
      try {
        value = JSON.parse(raw.toString()) as Record<string, unknown>;
      } catch {
        return;
      }
      if (!predicate(value)) return;
      clearTimeout(timer);
      socket.off("message", onMessage);
      resolvePromise(value);
    };
    socket.on("message", onMessage);
  });
}

function waitForClose(socket: WebSocket, timeoutMs = 5_000) {
  return new Promise<number>((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => rejectPromise(new Error("stream_close_timeout")), timeoutMs);
    socket.once("close", (code) => {
      clearTimeout(timer);
      resolvePromise(code);
    });
  });
}

async function connect(
  id: string,
  token: string,
  workspace: string,
  cursor = 0,
) {
  const socket = new WebSocket(socketUrl(id));
  await new Promise<void>((resolvePromise, rejectPromise) => {
    socket.once("open", () => resolvePromise());
    socket.once("error", rejectPromise);
  });
  socket.send(JSON.stringify({ type: "authenticate", token, workspace, cursor }));
  return socket;
}

async function waitForOperator(id: string, state: string, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const record = await getHermesOperatorSession(owner, id, options);
    if (record?.state === state) return record;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 40));
  }
  throw new Error(`operator did not reach ${state}`);
}

try {
  const created = await createHermesOperatorSession(
    owner,
    { prompt: "Prepare the harmless governed documentation fixture.", workspace: "fixture-workspace" },
    options,
  );

  const invalid = await connect(created.id, "invalid-token", "fixture-workspace");
  assert.equal(await waitForClose(invalid), 1008);

  const crossWorkspace = await connect(created.id, "other-token", "fixture-workspace");
  assert.equal(await waitForClose(crossWorkspace), 1008);

  const wrongBinding = await connect(created.id, "owner-token", "wrong-workspace");
  assert.equal(await waitForClose(wrongBinding), 1008);

  const forged = await connect(created.id, "owner-token", "fixture-workspace", 999_999);
  const cursorRejected = await waitForMessage(forged, (value) => value.type === "cursor_rejected");
  assert.equal(cursorRejected.reason, "cursor_ahead_of_authoritative_state");
  const recovered = await waitForMessage(forged, (value) => value.type === "operator_update");
  assert(Number(recovered.cursor) < 999_999);
  forged.close();

  const first = await connect(created.id, "owner-token", "fixture-workspace");
  const pendingUpdate = await waitForMessage(
    first,
    (value) =>
      value.type === "operator_update"
      && (value.session as { state?: string } | undefined)?.state === "awaiting_approval",
    15_000,
  );
  const pendingSession = pendingUpdate.session as {
    events: Array<{ sequence: number }>;
    assistantText?: string;
    agentRunId?: string;
  };
  assert.equal(pendingSession.assistantText, "");
  assert(pendingSession.agentRunId);
  const sequences = pendingSession.events.map((event) => event.sequence);
  assert.equal(new Set(sequences).size, sequences.length);
  assert.deepEqual((pendingUpdate.run as { inputs?: unknown }).inputs, {});
  const cursor = Number(pendingUpdate.cursor);
  first.close();

  const pending = await waitForOperator(created.id, "awaiting_approval");
  assert(pending.agentRunId);
  assert.equal((await rejectAgentRun(pending.agentRunId, owner, "stream denial")).ok, true);

  const reconnected = await connect(created.id, "owner-token", "fixture-workspace", cursor);
  const terminal = await waitForMessage(
    reconnected,
    (value) =>
      value.type === "operator_update"
      && (value.session as { state?: string } | undefined)?.state === "denied",
  );
  const terminalEvents = (terminal.session as { events: Array<{ sequence: number }> }).events;
  assert(terminalEvents.length > 0, "reconnect must recover events missed while disconnected");
  assert(terminalEvents.every((event) => event.sequence > cursor));
  const terminalCursor = Number(terminal.cursor);
  reconnected.close();

  const replay = await connect(created.id, "owner-token", "fixture-workspace", terminalCursor);
  const replayUpdate = await waitForMessage(replay, (value) => value.type === "operator_update");
  assert.equal((replayUpdate.session as { events: unknown[] }).events.length, 0);
  assert.equal(replayUpdate.terminal, true);
  replay.close();

  const cancellable = await createHermesOperatorSession(
    owner,
    { prompt: "Prepare another harmless governed documentation fixture.", workspace: "fixture-workspace" },
    options,
  );
  const cancelSocket = await connect(cancellable.id, "owner-token", "fixture-workspace");
  await waitForMessage(cancelSocket, (value) => value.type === "operator_update");
  cancelSocket.send(JSON.stringify({ type: "cancel" }));
  const cancelledUpdate = await waitForMessage(
    cancelSocket,
    (value) =>
      value.type === "operator_update"
      && (value.session as { state?: string } | undefined)?.state === "cancelled",
  );
  assert.equal((cancelledUpdate.session as { state: string }).state, "cancelled");
  cancelSocket.close();
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));

  process.stdout.write(`${JSON.stringify({
    ok: true,
    authenticated: true,
    invalidTokenRejected: true,
    crossWorkspaceRejected: true,
    workspaceBindingEnforced: true,
    forgedCursorRecovered: true,
    missedEventsRecovered: true,
    duplicatesSuppressed: true,
    repeatedTerminalSuppressed: true,
    cancellation: true,
    rawAssistantTextSuppressed: true,
    runInputsSuppressed: true,
  }, null, 2)}\n`);
} finally {
  await app.close();
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    try {
      await rm(root, { recursive: true, force: true });
      break;
    } catch (error) {
      if (attempt === 20) throw error;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    }
  }
}
