import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildPromptIntegrityEnvelope } from "../src/phantom-ai/prompt-integrity.js";

const appPort = 5197;
const appBaseUrl = `http://127.0.0.1:${appPort}`;
const runtimeRoot = await mkdtemp(join(tmpdir(), "phantom-ai-runtime-http-"));
const ollamaRequests: Array<Record<string, unknown>> = [];

const mockOllama = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/api/tags") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ models: [{ name: "runtime-test:latest", model: "runtime-test:latest" }] }));
    return;
  }
  if (request.method === "POST" && request.url === "/api/chat") {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      ollamaRequests.push(JSON.parse(body));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        message: { role: "assistant", content: "The selected local model answered this runtime test." },
        prompt_eval_count: 12,
        eval_count: 9,
      }));
    });
    return;
  }
  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "not_found" }));
});

await new Promise<void>((resolve) => mockOllama.listen(0, "127.0.0.1", resolve));
const mockAddress = mockOllama.address();
assert.ok(mockAddress && typeof mockAddress === "object");
const ollamaBaseUrl = `http://127.0.0.1:${mockAddress.port}`;

async function ready() {
  try {
    const response = await fetch(`${appBaseUrl}/health`, { signal: AbortSignal.timeout(500) });
    return response.ok;
  } catch {
    return false;
  }
}

async function startServer(): Promise<ChildProcess> {
  assert.equal(await ready(), false, `Port ${appPort} is already serving an application.`);
  const serverRoot = fileURLToPath(new URL("../", import.meta.url));
  const tsxLoader = fileURLToPath(new URL("../../node_modules/tsx/dist/loader.mjs", import.meta.url));
  const child = spawn(process.execPath, ["--import", pathToFileURL(tsxLoader).href, "src/index.ts"], {
    cwd: serverRoot,
    env: {
      ...process.env,
      PORT: String(appPort),
      HOST: "127.0.0.1",
      NODE_ENV: "development",
      PHANTOMFORCE_AUTH_PROVIDER: "demo",
      PHANTOMFORCE_ENABLE_DEMO_AUTH: "true",
      PHANTOMFORCE_SKIP_SERVER_DOTENV: "true",
      PHANTOMFORCE_AI_RUNTIME_DIR: runtimeRoot,
      OLLAMA_BASE_URL: ollamaBaseUrl,
      PHANTOM_OLLAMA_MODEL: "runtime-test:latest",
      PHANTOM_OLLAMA_TIMEOUT_MS: "3000",
      PHANTOM_FORCE_OPENROUTER_GLM: "false",
      OPENROUTER_API_KEY: "",
    },
    stdio: "ignore",
    windowsHide: true,
  });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await ready()) return child;
    if (child.exitCode != null) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  child.kill();
  throw new Error("Disposable PhantomForce server did not become ready.");
}

async function login(sessionId: string) {
  const response = await fetch(`${appBaseUrl}/auth/session-login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  assert.equal(response.ok, true, `Login failed for ${sessionId}: HTTP ${response.status}`);
  const payload = await response.json() as { token?: string };
  assert.ok(payload.token);
  return payload.token;
}

function auth(token: string) {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

function promptIntegrity(message: string, id: string) {
  return buildPromptIntegrityEnvelope(message, {
    messageId: id,
    conversationId: "ai-runtime-http",
    clientVersion: "ai-runtime-http-test",
  });
}

const models = {
  local_ollama: "runtime-test:latest",
  codex_cli: "gpt-5.6-sol",
  claude_cli: "sonnet",
  openrouter_glm: "openrouter/auto",
  chatgpt_bridge: "chatgpt-standard",
};

const child = await startServer();
try {
  const adminToken = await login("admin-jordan");
  const clientToken = await login("client-sports-demo");
  const tenantId = "ai-runtime-http-org";

  const initialResponse = await fetch(`${appBaseUrl}/phantom-ai/runtime/config?tenant_id=${tenantId}`, {
    headers: auth(adminToken),
  });
  assert.equal(initialResponse.ok, true);
  const initial = await initialResponse.json() as Record<string, any>;
  assert.equal(initial.source, "default");
  assert.equal(initial.secrets_returned, false);

  const saveLocalResponse = await fetch(`${appBaseUrl}/phantom-ai/runtime/config`, {
    method: "PUT",
    headers: auth(adminToken),
    body: JSON.stringify({
      tenant_id: tenantId,
      expected_version: initial.config.version,
      mode: "single",
      primary_provider_id: "local_ollama",
      allowed_provider_ids: ["local_ollama"],
      models,
      fallback_enabled: false,
    }),
  });
  assert.equal(saveLocalResponse.ok, true, `Local runtime save failed: HTTP ${saveLocalResponse.status}`);
  const localConfig = await saveLocalResponse.json() as Record<string, any>;
  assert.equal(localConfig.source, "saved");
  assert.equal(localConfig.config.primary_provider_id, "local_ollama");
  assert.deepEqual(localConfig.config.allowed_provider_ids, ["local_ollama"]);
  assert.equal(localConfig.config.fallback_enabled, false);

  const localMessage = "Write one short sentence about a lighthouse.";
  const chatResponse = await fetch(`${appBaseUrl}/phantom-ai/chat`, {
    method: "POST",
    headers: auth(adminToken),
    body: JSON.stringify({
      message: localMessage,
      user_request: localMessage,
      prompt_integrity: promptIntegrity(localMessage, "runtime-local-message"),
      tenant_id: tenantId,
      business_name: "Runtime Test",
      actor_user_id: "runtime-test",
      task_type: "chat",
      route_tier: "instant",
      runtime_config: true,
      runtime_surface: "prompt_outcome",
      // These intentionally conflict. The persisted organization choice must win.
      provider: "phantom",
      admin_model: "codex",
      model_lane: "codex",
      requested_model: "gpt-5.6-sol",
      allowed_providers: ["codex_cli"],
      allow_provider_fallback: true,
    }),
  });
  const chat = await chatResponse.json() as Record<string, any>;
  assert.equal(chatResponse.ok, true, `Runtime chat failed: HTTP ${chatResponse.status} ${JSON.stringify(chat)}`);
  assert.equal(ollamaRequests.length, 1);
  assert.equal(ollamaRequests[0].model, "runtime-test:latest");
  assert.equal(chat.model_id, "runtime-test:latest");
  assert.equal(chat.ai_runtime.state, "real");
  assert.equal(chat.ai_runtime.surface, "prompt_outcome");
  assert.equal(chat.ai_runtime.tenant_id, tenantId);
  assert.equal(chat.ai_runtime.config_source, "saved");
  assert.equal(chat.ai_runtime.requested_provider_id, "local_ollama");
  assert.equal(chat.ai_runtime.responding_provider_id, "local_ollama");
  assert.equal(chat.ai_runtime.responding_model_id, "runtime-test:latest");
  assert.equal(chat.ai_runtime.provider_called, true);
  assert.equal(chat.ai_runtime.fallback_used, false);

  const clientRuntimeResponse = await fetch(`${appBaseUrl}/phantom-ai/runtime/config`, {
    headers: auth(clientToken),
  });
  assert.equal(clientRuntimeResponse.ok, true);
  const clientRuntimeInitial = await clientRuntimeResponse.json() as Record<string, any>;
  const clientTenantId = String(clientRuntimeInitial.tenant_id);
  assert.ok(clientTenantId);

  const saveClientRuntimeResponse = await fetch(`${appBaseUrl}/phantom-ai/runtime/config`, {
    method: "PUT",
    headers: auth(adminToken),
    body: JSON.stringify({
      tenant_id: clientTenantId,
      expected_version: clientRuntimeInitial.config.version,
      mode: "single",
      primary_provider_id: "local_ollama",
      allowed_provider_ids: ["local_ollama"],
      models,
      fallback_enabled: false,
    }),
  });
  assert.equal(saveClientRuntimeResponse.ok, true);

  const clientMessage = "Draft two concise sentences about a lighthouse launch.";
  const clientChatResponse = await fetch(`${appBaseUrl}/phantom-ai/chat`, {
    method: "POST",
    headers: auth(clientToken),
    body: JSON.stringify({
      message: clientMessage,
      user_request: clientMessage,
      prompt_integrity: promptIntegrity(clientMessage, "runtime-client-standard-message"),
      task_type: "chat",
      route_tier: "standard",
      runtime_config: true,
      runtime_surface: "phantombot",
    }),
  });
  const clientChat = await clientChatResponse.json() as Record<string, any>;
  assert.equal(clientChatResponse.ok, true, `Client runtime chat failed: HTTP ${clientChatResponse.status} ${JSON.stringify(clientChat)}`);
  assert.equal(ollamaRequests.length, 2, "A workspace member's standard chat must invoke the organization's saved provider.");
  assert.equal(ollamaRequests[1].model, "runtime-test:latest");
  assert.equal(clientChat.model_id, "runtime-test:latest");
  assert.equal(clientChat.ai_runtime.state, "real");
  assert.equal(clientChat.ai_runtime.tenant_id, clientTenantId);
  assert.equal(clientChat.ai_runtime.config_source, "saved");
  assert.equal(clientChat.ai_runtime.requested_provider_id, "local_ollama");
  assert.equal(clientChat.ai_runtime.responding_provider_id, "local_ollama");
  assert.equal(clientChat.ai_runtime.responding_model_id, "runtime-test:latest");
  assert.equal(clientChat.ai_runtime.provider_called, true);

  const crossOrgRead = await fetch(`${appBaseUrl}/phantom-ai/runtime/config?tenant_id=${tenantId}`, {
    headers: auth(clientToken),
  });
  assert.equal(crossOrgRead.status, 403);

  const clientWrite = await fetch(`${appBaseUrl}/phantom-ai/runtime/config`, {
    method: "PUT",
    headers: auth(clientToken),
    body: JSON.stringify({
      mode: "single",
      primary_provider_id: "local_ollama",
      allowed_provider_ids: ["local_ollama"],
      models,
      fallback_enabled: false,
    }),
  });
  assert.equal(clientWrite.status, 403);

  const saveUnavailableResponse = await fetch(`${appBaseUrl}/phantom-ai/runtime/config`, {
    method: "PUT",
    headers: auth(adminToken),
    body: JSON.stringify({
      tenant_id: tenantId,
      expected_version: localConfig.config.version,
      mode: "single",
      primary_provider_id: "openrouter_glm",
      allowed_provider_ids: ["openrouter_glm"],
      models,
      fallback_enabled: false,
    }),
  });
  assert.equal(saveUnavailableResponse.ok, true);

  const unavailableMessage = "Give one short launch headline.";
  const unavailableResponse = await fetch(`${appBaseUrl}/phantom-ai/chat`, {
    method: "POST",
    headers: auth(adminToken),
    body: JSON.stringify({
      message: unavailableMessage,
      user_request: unavailableMessage,
      prompt_integrity: promptIntegrity(unavailableMessage, "runtime-unavailable-message"),
      tenant_id: tenantId,
      business_name: "Runtime Test",
      actor_user_id: "runtime-test",
      task_type: "chat",
      route_tier: "instant",
      runtime_config: true,
      runtime_surface: "phantombot",
    }),
  });
  assert.equal(unavailableResponse.ok, true);
  const unavailable = await unavailableResponse.json() as Record<string, any>;
  assert.equal(unavailable.ai_runtime.state, "unavailable");
  assert.equal(unavailable.ai_runtime.requested_provider_id, "openrouter_glm");
  assert.equal(unavailable.ai_runtime.provider_called, false);
  assert.equal(unavailable.ai_runtime.fallback_used, false);
  assert.equal(unavailable.fallback.all_failed, true);
  assert.match(String(unavailable.message.content), /openrouter|disabled|configured|unavailable/i);
  assert.equal(ollamaRequests.length, 2, "A failed single-provider choice must not silently call local Ollama.");

  console.log(JSON.stringify({
    ok: true,
    suite: "ai-runtime-http",
    persisted_override: true,
    exact_model_called: "runtime-test:latest",
    workspace_member_runtime_called: true,
    runtime_receipt: true,
    cross_org_isolation: true,
    unavailable_is_actionable: true,
    silent_fallbacks: 0,
  }));
} finally {
  child.kill();
  await new Promise<void>((resolve) => mockOllama.close(() => resolve()));
  await rm(runtimeRoot, { recursive: true, force: true });
}
