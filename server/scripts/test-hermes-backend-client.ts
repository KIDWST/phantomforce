import assert from "node:assert/strict";

import {
  getHermesBackendInventory,
  runHermesBackendChat,
} from "../src/phantom-ai/hermes-backend-client.js";

const requests: Array<{ path: string; method: string; authorization: string; body: Record<string, unknown> | null }> = [];
const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { "Content-Type": "application/json" },
});

const fetchImpl: typeof fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
  const body = typeof init.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : null;
  requests.push({
    path: `${url.pathname}${url.search}`,
    method: String(init.method || "GET"),
    authorization: new Headers(init.headers).get("Authorization") || "",
    body,
  });
  if (url.pathname === "/health") return json({ status: "ok", platform: "hermes-agent", version: "0.20.4" });
  if (url.pathname === "/api/model/options") {
    return json({
      provider: "openrouter",
      model: "z-ai/glm-5.3",
      providers: [
        {
          slug: "openrouter",
          name: "OpenRouter",
          is_current: true,
          authenticated: true,
          source: "built-in",
          total_models: 2,
          models: ["z-ai/glm-5.3", "openai/gpt-5.6-sol"],
          featured_models: ["z-ai/glm-5.3"],
          capabilities: {
            "z-ai/glm-5.3": { reasoning: true, can_disable_reasoning: false, fast: false },
            "openai/gpt-5.6-sol": { reasoning: true, can_disable_reasoning: true, fast: true },
          },
        },
      ],
    });
  }
  if (url.pathname === "/v1/toolsets") {
    return json({ object: "list", data: [
      { name: "web", label: "Web", description: "Search and extract", enabled: true, configured: true, tools: ["web_search", "web_extract"] },
      { name: "terminal", label: "Terminal", description: "Run commands", enabled: true, configured: true, tools: ["terminal", "process"] },
    ] });
  }
  if (url.pathname === "/v1/skills") return json({ object: "list", data: [{ name: "browser" }, { name: "imagegen" }] });
  if (url.pathname === "/v1/capabilities") return json({ platform: "hermes-agent", features: { session_chat: true, session_model_lock: true, approval_events: true } });
  if (url.pathname === "/api/sessions" && init.method === "POST") return json({ object: "hermes.session", session: { id: body?.id } }, 201);
  if (/^\/api\/sessions\/phantombot_[a-f0-9]{32}\/chat$/u.test(url.pathname) && init.method === "POST") {
    return json({
      object: "hermes.session.chat.completion",
      session_id: url.pathname.split("/")[3],
      message: { role: "assistant", content: "GLM 5.3 answered through the real Hermes tool runtime." },
      usage: { total_tokens: 42 },
      runtime: { provider: "openrouter", model: "z-ai/glm-5.3", model_lock: "confirmed" },
    });
  }
  return json({ error: { message: `Unexpected request: ${url.pathname}` } }, 404);
};

const env = {
  PHANTOMBOT_HERMES_API_URL: "http://127.0.0.1:8642",
  PHANTOMBOT_HERMES_API_KEY: "test-hermes-server-key",
} as NodeJS.ProcessEnv;

const inventory = await getHermesBackendInventory({ env, fetchImpl, force: true });
assert.equal(inventory.online, true);
assert.equal(inventory.version, "0.20.4");
assert.equal(inventory.current_model, "z-ai/glm-5.3");
assert.ok(inventory.providers.find((provider) => provider.id === "openrouter")?.models.some((model) => model.id === "z-ai/glm-5.3"));
assert.equal(inventory.tools_available, 4);
assert.equal(inventory.skills.count, 2);
assert.ok(inventory.features.includes("session_model_lock"));
assert.equal(JSON.stringify(inventory).includes("test-hermes-server-key"), false);

const chat = await runHermesBackendChat({
  tenantId: "owner-org",
  actorId: "owner-user",
  taskId: "task-123",
  prompt: "Use Hermes to explain the active runtime.",
  providerId: "openrouter",
  modelId: "z-ai/glm-5.3",
  effort: "deep",
}, { env, fetchImpl });

assert.equal(chat.source, "hermes_backend");
assert.equal(chat.model_id, "z-ai/glm-5.3");
assert.equal(chat.provider_id, "openrouter");
assert.match(chat.session_id, /^phantombot_[a-f0-9]{32}$/u);
assert.match(chat.say, /real Hermes tool runtime/u);
assert.equal(chat.secret_returned, false);

const createRequest = requests.find((request) => request.path === "/api/sessions" && request.method === "POST");
assert.equal(createRequest?.body?.provider, "openrouter");
assert.equal(createRequest?.body?.model, "z-ai/glm-5.3");
assert.equal(createRequest?.body?.require_model_lock, true);
const chatRequest = requests.find((request) => /\/chat$/u.test(request.path));
assert.equal(chatRequest?.body?.model, "z-ai/glm-5.3");
assert.equal(chatRequest?.body?.require_model_lock, true);
assert.ok(requests.every((request) => request.authorization === "Bearer test-hermes-server-key"));
assert.equal(JSON.stringify(requests).includes("OPENROUTER_API_KEY"), false);

console.log(JSON.stringify({
  ok: true,
  glm53Discovered: true,
  liveToolsMirrored: inventory.tools_available,
  skillsMirrored: inventory.skills.count,
  persistentSession: chat.session_id,
  modelLock: chat.runtime.model_lock,
  secretReturned: false,
}));
