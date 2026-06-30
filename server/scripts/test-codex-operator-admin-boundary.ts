import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runCodexOperatorChat } from "../src/phantom-ai/codex-operator.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

function parseJson<T>(payload: string): T {
  return JSON.parse(payload) as T;
}

process.env.NODE_ENV = "development";
process.env.PHANTOMFORCE_SERVER_LISTEN = "false";
process.env.PHANTOMFORCE_SERVER_LOGGER = "false";
process.env.PHANTOMFORCE_AUTH_PROVIDER = "demo";
process.env.PHANTOMFORCE_ENABLE_DEMO_AUTH = "true";
process.env.PHANTOMFORCE_ALLOW_UNSIGNED_SESSION_HEADER = "false";

const { app } = await import("../src/index.js");

type LoginResponse = {
  ok: boolean;
  token: string;
};

const tempDir = mkdtempSync(join(tmpdir(), "phantom-codex-operator-"));
const writtenPath = join(tempDir, "admin-write-proof.txt");
const clientProofPath = join(tempDir, "client-should-not-exist.txt");
const fakeKey = ["sk", "or", "v1", "codexoperator0123456789"].join("-");
let fakeFetchCalls = 0;
const originalFetch = globalThis.fetch;

const fakeFetch: typeof fetch = async (_url, init) => {
  fakeFetchCalls += 1;
  const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: Array<{ content?: string }> };
  const lastMessage = body.messages?.at(-1)?.content ?? "";
  const content = lastMessage.includes("write-file-request")
    ? JSON.stringify({
        tool: "write_file",
        path: writtenPath,
        content: "admin write proof",
        mode: "create",
      })
    : "Admin operator completed the requested local action and returned a receipt.";

  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
};

try {
  process.env.OPENROUTER_API_KEY = fakeKey;
  globalThis.fetch = fakeFetch;

  const commandResult = await runCodexOperatorChat(
    {
      requestId: "operator-command-test",
      businessName: "PhantomForce",
      userMessage: "/run Write-Output phantom-admin-shell-ok",
      compactContext: "test context",
      approvalRequired: false,
      cwd: process.cwd(),
    },
    {
      env: {
        OPENROUTER_API_KEY: fakeKey,
      },
      fetchImpl: fakeFetch,
    },
  );

  assert(commandResult.status === "called", "Admin operator command should complete.");
  assert(commandResult.tool_requested === true, "Admin command should request a tool.");
  assert(commandResult.tool_executed === true, "Admin command should execute the tool.");
  assert(commandResult.tool_name === "run_command", "Admin command should use run_command.");
  assert(
    JSON.stringify(commandResult.tool_result).includes("phantom-admin-shell-ok"),
    "Admin command result should include command stdout proof.",
  );
  assert(commandResult.approval_executed === false, "Operator must not execute approval records.");
  assert(commandResult.queue_written === false, "Operator must not write approval queues.");

  const writeResult = await runCodexOperatorChat(
    {
      requestId: "operator-write-test",
      businessName: "PhantomForce",
      userMessage: "write-file-request",
      compactContext: "test context",
      approvalRequired: false,
      cwd: process.cwd(),
    },
    {
      env: {
        OPENROUTER_API_KEY: fakeKey,
      },
      fetchImpl: fakeFetch,
    },
  );

  assert(writeResult.tool_requested === true, "Model-selected write should request a tool.");
  assert(writeResult.tool_executed === true, "Model-selected write should execute.");
  assert(writeResult.tool_name === "write_file", "Model-selected write should use write_file.");
  assert(existsSync(writtenPath), "write_file should create the proof file.");
  assert(readFileSync(writtenPath, "utf8") === "admin write proof", "write_file should write exact proof content.");

  const adminLogin = await app.inject({
    method: "POST",
    url: "/auth/demo-login",
    headers: { "Content-Type": "application/json" },
    payload: JSON.stringify({ sessionId: "admin-jordan" }),
  });
  assert(adminLogin.statusCode === 200, "Admin login should succeed.");
  const adminToken = parseJson<LoginResponse>(adminLogin.payload).token;
  const adminCodexChat = await app.inject({
    method: "POST",
    url: "/phantom-ai/chat",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    payload: JSON.stringify({
      provider: "phantom",
      admin_model: "codex",
      message: "/run Write-Output admin-route-shell-ok",
      request_id: "admin-route-codex-test",
    }),
  });
  const adminCodexBody = parseJson<Record<string, unknown>>(adminCodexChat.payload);
  assert(adminCodexChat.statusCode === 200, "Admin Codex chat route should succeed.");
  assert(adminCodexBody.admin_model_lane === "codex", "Admin Codex route should report codex lane.");
  assert(Boolean(adminCodexBody.operator), "Admin Codex route should return operator metadata.");
  assert(
    JSON.stringify(adminCodexBody).includes("admin-route-shell-ok"),
    "Admin Codex route should include shell stdout proof.",
  );
  assert(JSON.stringify(adminCodexBody).includes("ledger_written"), "Admin Codex route should expose Hermes ledger receipt.");

  const adminGlmChat = await app.inject({
    method: "POST",
    url: "/phantom-ai/chat",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    payload: JSON.stringify({
      provider: "openrouter_glm",
      admin_model: "glm_5_2",
      message: "Draft a send-for-approval follow-up, but do not send it.",
      request_id: "admin-route-glm-test",
    }),
  });
  const adminGlmBody = parseJson<Record<string, unknown>>(adminGlmChat.payload);
  assert(adminGlmChat.statusCode === 200, "Admin GLM chat route should succeed.");
  assert(adminGlmBody.admin_model_lane === "glm_5_2", "Admin GLM route should report GLM lane.");
  assert(!adminGlmBody.operator, "Admin GLM route should not expose operator tool metadata.");
  assert(Boolean(adminGlmBody.hermes), "Admin GLM route should include Hermes-backed metadata.");

  const clientLogin = await app.inject({
    method: "POST",
    url: "/auth/demo-login",
    headers: { "Content-Type": "application/json" },
    payload: JSON.stringify({ sessionId: "client-sports-demo" }),
  });
  assert(clientLogin.statusCode === 200, "Client login should succeed.");
  const clientToken = parseJson<LoginResponse>(clientLogin.payload).token;
  const clientChat = await app.inject({
    method: "POST",
    url: "/phantom-ai/chat",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${clientToken}`,
    },
    payload: JSON.stringify({
      provider: "phantom",
      admin_model: "codex",
      message: `/run Set-Content -Path "${clientProofPath}" -Value "client executed"`,
    }),
  });
  const clientBody = parseJson<Record<string, unknown>>(clientChat.payload);
  assert(clientChat.statusCode === 200, "Client chat should still respond normally.");
  assert(!("operator" in clientBody), "Client chat response must not expose the operator lane.");
  assert(!existsSync(clientProofPath), "Client command must not execute or create local files.");

  console.log(
    JSON.stringify(
      {
        ok: true,
        commandTool: commandResult.tool_name,
        commandExecuted: commandResult.tool_executed,
        writeTool: writeResult.tool_name,
        writeExecuted: writeResult.tool_executed,
        adminRouteCodexLane: adminCodexBody.admin_model_lane,
        adminRouteGlmLane: adminGlmBody.admin_model_lane,
        proofFileCreated: existsSync(writtenPath),
        clientOperatorHidden: !("operator" in clientBody),
        fakeFetchCalls,
        approvalExecuted: commandResult.approval_executed || writeResult.approval_executed,
        queueWritten: commandResult.queue_written || writeResult.queue_written,
      },
      null,
      2,
    ),
  );
} finally {
  globalThis.fetch = originalFetch;
  await app.close();
  rmSync(tempDir, { recursive: true, force: true });
}
