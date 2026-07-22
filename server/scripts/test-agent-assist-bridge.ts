import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const port = "5195";
const baseUrl = `http://127.0.0.1:${port}`;

async function ready() {
  try {
    return (await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(500) })).ok;
  } catch {
    return false;
  }
}

const serverRoot = fileURLToPath(new URL("../", import.meta.url));
const tsxLoader = fileURLToPath(new URL("../../node_modules/tsx/dist/loader.mjs", import.meta.url));
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
    PHANTOM_AGENT_ASSIST_BRIDGE_ENABLED: "false",
    PHANTOM_AGENT_ASSIST_BRIDGE_URL: "",
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
  assert.equal(statusPayload.status.transport, "relay_packet");
  assert.equal(statusPayload.live_provider_called, false);
  assert.equal(statusPayload.database_written, false);

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
  assert.equal(assist.status, "bridge_unavailable");
  assert.equal(assist.provider, "chatgpt_plus");
  assert.equal(assist.provider_mode, "instant");
  assert.equal(assist.provider_called, false);
  assert.equal(assist.network_call_performed, false);
  assert.equal(assist.external_action_executed, false);
  assert.equal(assist.database_written, false);
  assert.match(assist.relay_packet.prompt, /Caller: phantombot/u);
  assert.match(assist.relay_packet.prompt, /ChatGPT Plus/u);
  assert.doesNotMatch(assist.relay_packet.prompt, /secret-token|api-key/u);

  console.log("agent assist universal bridge checks passed");
} finally {
  child.kill();
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
}
