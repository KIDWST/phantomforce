function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

function parseJson<T>(payload: string): T {
  return JSON.parse(payload) as T;
}

process.env.NODE_ENV = "development";
process.env.PHANTOMFORCE_SERVER_LISTEN = "false";
process.env.PHANTOMFORCE_SERVER_LOGGER = "false";
process.env.PHANTOMFORCE_AUTH_PROVIDER = "demo";
process.env.PHANTOMFORCE_ENABLE_DEMO_AUTH = "true";
process.env.PHANTOMFORCE_SKIP_SERVER_DOTENV = "true";
process.env.PHANTOMFORCE_ALLOW_UNSIGNED_SESSION_HEADER = "false";
process.env.PHANTOM_FORCE_OPENROUTER_GLM = "false";
process.env.OLLAMA_BASE_URL = "http://127.0.0.1:1";
process.env.PHANTOM_OLLAMA_TIMEOUT_MS = "3000";

const { app } = await import("../src/index.js");

type LoginResponse = {
  ok: boolean;
  token: string;
};

type ChatResponse = {
  ok: boolean;
  model_id: string;
  result_status: string;
  message: { role: "assistant"; content: string };
  fallback: {
    used: boolean;
    all_failed: boolean;
    local_instant_fallback_used: boolean;
  };
  instant_local_fallback: {
    status: "local_fallback";
    model_id: "phantom-instant-local-fallback";
    provider_called: false;
    network_call_performed: false;
    output_text: string;
  } | null;
  live_provider_called: boolean;
  external_action_executed: boolean;
  route_tier: string;
};

try {
  const login = await app.inject({
    method: "POST",
    url: "/auth/demo-login",
    headers: { "Content-Type": "application/json" },
    payload: JSON.stringify({ sessionId: "admin-jordan" }),
  });
  assert(login.statusCode === 200, "Admin demo login should succeed.");
  const token = parseJson<LoginResponse>(login.payload).token;

  const response = await app.inject({
    method: "POST",
    url: "/phantom-ai/chat",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    payload: JSON.stringify({
      tenant_id: "phantomforce",
      business_name: "PhantomForce",
      actor_user_id: "admin-jordan",
      request_id: "instant-chat-fallback-test",
      task_type: "question",
      message: "What's your favorite food?",
      route_tier: "instant",
      model_lane: "glm_5_2",
      max_provider_ms: 3000,
      allow_provider_fallback: false,
      allowed_providers: ["local_ollama"],
    }),
  });
  assert(response.statusCode === 200, "Instant chat should still return 200 when the selected provider is down.");
  const body = parseJson<ChatResponse>(response.payload);

  assert(body.ok === true, "Chat response should be ok.");
  assert(body.route_tier === "instant", "Fallback should stay on the instant route.");
  assert(body.result_status === "local_fallback", "Provider failure should be converted into a local instant fallback.");
  assert(body.model_id === "phantom-instant-local-fallback", "Response should identify the local instant fallback model.");
  assert(body.fallback.used === true, "Fallback metadata should report a fallback.");
  assert(body.fallback.all_failed === true, "Provider failure should still be visible in metadata.");
  assert(body.fallback.local_instant_fallback_used === true, "Metadata should identify the local instant fallback.");
  assert(body.instant_local_fallback?.provider_called === false, "Local fallback must not claim a provider call.");
  assert(body.instant_local_fallback?.network_call_performed === false, "Local fallback must not claim a network call.");
  assert(body.live_provider_called === false, "No live provider should be marked called for the fallback.");
  assert(body.external_action_executed === false, "Instant fallback must not execute external actions.");
  assert(/tacos/i.test(body.message.content), "Favorite-food fallback should answer the question.");
  assert(!/couldn'?t complete/i.test(body.message.content), "Instant fallback should not return the dead-provider failure copy.");

  console.log("Instant chat fallback checks passed.");
} finally {
  await app.close();
}
