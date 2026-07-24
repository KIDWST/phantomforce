import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const port = "5195";
const baseUrl = `http://127.0.0.1:${port}`;
const adapterPort = "5196";
const adapterBaseUrl = `http://127.0.0.1:${adapterPort}`;

async function ready() {
  try {
    return (await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(500) })).ok;
  } catch {
    return false;
  }
}

const serverRoot = fileURLToPath(new URL("../", import.meta.url));
const tsxLoader = fileURLToPath(new URL("../../node_modules/tsx/dist/loader.mjs", import.meta.url));
const adapterChild = spawn(process.execPath, ["scripts/chatgpt-assist-adapter.mjs"], {
  cwd: serverRoot,
  env: {
    ...process.env,
    PHANTOM_CHATGPT_ADAPTER_PORT: adapterPort,
    PHANTOM_CHATGPT_ADAPTER_HOST: "127.0.0.1",
    PHANTOM_AGENT_ASSIST_BRIDGE_TOKEN: "",
    PHANTOM_CHATGPT_ADAPTER_COMMAND: "",
  },
  stdio: "ignore",
  windowsHide: true,
});

async function adapterReady() {
  try {
    return (await fetch(`${adapterBaseUrl}/health`, { signal: AbortSignal.timeout(500) })).ok;
  } catch {
    return false;
  }
}

for (let attempt = 0; attempt < 60 && !(await adapterReady()); attempt += 1) {
  assert.equal(adapterChild.exitCode, null, "Disposable ChatGPT adapter exited during startup");
  await new Promise((resolve) => setTimeout(resolve, 100));
}
assert.equal(await adapterReady(), true, "Disposable ChatGPT adapter did not become ready");

const child = spawn(process.execPath, ["--import", pathToFileURL(tsxLoader).href, "src/index.ts"], {
  cwd: serverRoot,
  env: {
    ...process.env,
    PORT: port,
    HOST: "127.0.0.1",
    NODE_ENV: "development",
    PHANTOMFORCE_AUTH_PROVIDER: "demo",
    PHANTOMFORCE_ENABLE_DEMO_AUTH: "true",
    PHANTOMFORCE_SKIP_SERVER_DOTENV: "true",
    PHANTOM_AGENT_ASSIST_BRIDGE_URL: `${adapterBaseUrl}/assist`,
  },
  stdio: "ignore",
  windowsHide: true,
});

for (let attempt = 0; attempt < 60 && !(await ready()); attempt += 1) {
  assert.equal(child.exitCode, null, "Disposable agent-assist server exited during startup");
  await new Promise((resolve) => setTimeout(resolve, 100));
}
assert.equal(await ready(), true, "Disposable agent-assist server did not become ready");

try {
  const login = await fetch(`${baseUrl}/auth/session-login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: "admin-jordan" }),
  });
  assert.equal(login.ok, true);
  const token = String((await login.json() as { token?: string }).token || "");
  assert.ok(token);

  const statusResponse = await fetch(`${baseUrl}/phantom-ai/agent-assist/status`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(statusResponse.ok, true);
  const statusPayload = await statusResponse.json() as Record<string, any>;
  assert.equal(statusPayload.status.bridge_id, "phantom-agent-assist-chatgpt");
  assert.equal(statusPayload.status.universal, true);
  assert.equal(statusPayload.status.session_scoped, false);
  assert.equal(statusPayload.status.transport, "http");
  assert.equal(statusPayload.status.setup_required, false);
  assert.deepEqual(statusPayload.status.effort_levels, ["instant", "standard", "deep"]);
  assert.match(statusPayload.status.subscription_billing_note, /user-owned local ChatGPT adapter/u);
  assert.equal(statusPayload.status.env.openai_api_key, "OPENAI_API_KEY");
  assert.equal(statusPayload.status.setup_options.some((item: Record<string, any>) => item.id === "relay_packet" && item.ready === true), true);
  assert.equal(statusPayload.status.setup_options.some((item: Record<string, any>) => item.id === "local_chatgpt_adapter" && item.ready === true), true);
  assert.equal(statusPayload.status.setup_options.some((item: Record<string, any>) => item.id === "openai_api_key"), true);
  assert.equal(statusPayload.live_provider_called, false);
  assert.equal(statusPayload.database_written, false);
  assert.doesNotMatch(JSON.stringify(statusPayload), /sk-[A-Za-z0-9]/u);

  const assistResponse = await fetch(`${baseUrl}/phantom-ai/agent-assist`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      caller: "phantombot",
      mode: "instant",
      task: "Help this agent decide whether the copy is clear.",
      context: "No external action is approved.",
      constraints: ["Return a verdict only."],
      desired_output: "APPROVED / NEEDS_CHANGES plus one sentence.",
      execute_bridge: false,
    }),
  });
  assert.equal(assistResponse.ok, true);
  const assist = await assistResponse.json() as Record<string, any>;
  assert.equal(assist.bridge_id, "phantom-agent-assist-chatgpt");
  assert.equal(assist.caller, "phantombot");
  assert.equal(assist.status, "relay_packet_ready");
  assert.equal(assist.provider, "chatgpt_plus");
  assert.equal(assist.provider_mode, "standard");
  assert.equal(assist.effort, "standard");
  assert.equal(assist.provider_called, false);
  assert.equal(assist.network_call_performed, false);
  assert.equal(assist.external_action_executed, false);
  assert.equal(assist.database_written, false);
  assert.match(assist.relay_packet.prompt, /Caller: phantombot/u);
  assert.match(assist.relay_packet.prompt, /ChatGPT Plus/u);
  assert.doesNotMatch(assist.relay_packet.prompt, /secret-token|api-key/u);

  const blockedExecute = await fetch(`${baseUrl}/phantom-ai/agent-assist`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      caller: "phantom_ai",
      mode: "strategy",
      effort: "deep",
      task: "Think through the offer.",
      execute_bridge: true,
    }),
  });
  assert.equal(blockedExecute.ok, true);
  const blocked = await blockedExecute.json() as Record<string, any>;
  assert.equal(blocked.provider_called, false);
  assert.equal(blocked.network_call_performed, false);
  assert.equal(blocked.status, "bridge_error");
  assert.match(blocked.error_message, /not configured|not connected/i);

  console.log("agent assist universal bridge checks passed");
} finally {
  child.kill();
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
  adapterChild.kill();
  await new Promise<void>((resolve) => adapterChild.once("exit", () => resolve()));
}
