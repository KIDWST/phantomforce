import assert from "node:assert/strict";

import {
  getHermesBackendInventory,
  runHermesBackendChat,
  runHermesBackendChatStream,
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
  if (/^\/api\/sessions\/phantombot_[a-f0-9]{32}\/chat\/stream$/u.test(url.pathname) && init.method === "POST") {
    return new Response([
      'event: run.started\ndata: {"session_id":"stream-session","run_id":"run-live","seq":1,"runtime":{"provider":"openrouter","model":"z-ai/glm-5.3","model_lock":"confirmed","private_path":"C:/private"}}\n\n',
      'event: tool.progress\ndata: {"session_id":"stream-session","run_id":"run-live","seq":2,"tool_name":"_thinking","delta":"private hidden reasoning"}\n\n',
      'event: tool.started\ndata: {"session_id":"stream-session","run_id":"run-live","seq":3,"tool_name":"web_search","preview":"Searching primary sources","args":{"api_key":"must-not-leak"}}\n\n',
      'event: assistant.delta\ndata: {"session_id":"stream-session","run_id":"run-live","seq":4,"delta":"Live Hermes sk-split"}\n\n',
      'event: assistant.delta\ndata: {"session_id":"stream-session","run_id":"run-live","seq":5,"delta":"secret123456 "}\n\n',
      'event: tool.completed\ndata: {"session_id":"stream-session","run_id":"run-live","seq":6,"tool_name":"web_search","preview":"Primary sources ready","args":{"cookie":"must-not-leak"}}\n\n',
      'event: assistant.completed\ndata: {"session_id":"stream-session","run_id":"run-live","seq":7,"content":"Live Hermes completed.","runtime":{"provider":"openrouter","model":"z-ai/glm-5.3","model_lock":"confirmed"}}\n\n',
      'event: run.completed\ndata: {"session_id":"stream-session","run_id":"run-live","seq":8,"usage":{"input_tokens":12,"output_tokens":8,"private_meter":99},"runtime":{"provider":"openrouter","model":"z-ai/glm-5.3","model_lock":"confirmed"}}\n\n',
      'event: done\ndata: {"session_id":"stream-session","run_id":"run-live","seq":9}\n\n',
    ].join(""), { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }
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

const streamEvents: Array<{ event: string; data: Record<string, unknown> }> = [];
const streamed = await runHermesBackendChatStream({
  tenantId: "owner-org",
  actorId: "owner-user",
  taskId: "task-123",
  prompt: "Research and stream the answer through Hermes.",
  providerId: "openrouter",
  modelId: "z-ai/glm-5.3",
  effort: "deep",
}, {
  env,
  fetchImpl,
  onEvent: (event) => { streamEvents.push(event); },
});

assert.equal(streamed.source, "hermes_backend");
assert.equal(streamed.model_id, "z-ai/glm-5.3");
assert.deepEqual(streamEvents.map((event) => event.event), [
  "run.started",
  "reasoning",
  "tool.started",
  "tool.completed",
  "assistant.delta",
  "assistant.completed",
  "run.completed",
  "done",
]);
assert.equal(streamEvents.find((event) => event.event === "assistant.delta")?.data.delta, "Live Hermes [redacted-key] ");
assert.equal(JSON.stringify(streamEvents).includes("sk-splitsecret123456"), false);
assert.equal(streamEvents.find((event) => event.event === "tool.started")?.data.tool_name, "web_search");
assert.equal(JSON.stringify(streamEvents).includes("must-not-leak"), false);
assert.equal(JSON.stringify(streamEvents).includes("private hidden reasoning"), false);
assert.equal(JSON.stringify(streamEvents).includes("private_path"), false);
assert.equal(JSON.stringify(streamEvents).includes("private_meter"), false);
const streamRequest = requests.find((request) => /\/chat\/stream$/u.test(request.path));
assert.equal(streamRequest?.body?.model, "z-ai/glm-5.3");
assert.equal(streamRequest?.body?.require_model_lock, true);

const cancelled = new AbortController();
cancelled.abort();
const abortFetch: typeof fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
  if (/\/chat\/stream$/u.test(url.pathname)) {
    if (init.signal?.aborted) throw new DOMException("Stopped", "AbortError");
    return await new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("Stopped", "AbortError")), { once: true });
    });
  }
  return await fetchImpl(input, init);
};
await assert.rejects(
  runHermesBackendChatStream({
    tenantId: "owner-org",
    actorId: "owner-user",
    taskId: "task-cancel",
    prompt: "Start a long Hermes run.",
    providerId: "openrouter",
    modelId: "z-ai/glm-5.3",
    effort: "deep",
  }, { env, fetchImpl: abortFetch, signal: cancelled.signal, onEvent: () => {} }),
  (error: Error & { status?: number }) => error.message === "Hermes response was stopped." && error.status === 499,
);

console.log(JSON.stringify({
  ok: true,
  glm53Discovered: true,
  liveToolsMirrored: inventory.tools_available,
  skillsMirrored: inventory.skills.count,
  persistentSession: chat.session_id,
  modelLock: chat.runtime.model_lock,
  liveStreamEvents: streamEvents.length,
  toolArgumentsRedacted: true,
  cancellationPropagated: true,
  secretReturned: false,
}));
