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

type PrivacyChatResponse = {
  ok: boolean;
  model_id: string;
  message: {
    role: "assistant";
    content: string;
  };
  privacy_guard?: {
    location_accessed: boolean;
    location_inferred: boolean;
    device_location_used: boolean;
    ip_location_used: boolean;
    requires_explicit_location: boolean;
    reason: string;
  };
  provider_request_body_created: boolean;
  live_provider_called: boolean;
  network_call_performed: boolean;
  approval_executed: boolean;
  queue_written: boolean;
  weather?: {
    ok: boolean;
    place?: string;
    label?: string;
    temperature?: number;
    feels_like?: number;
    humidity?: number;
    wind_speed?: number;
    message?: string;
  };
};

async function login(sessionId: string) {
  const response = await app.inject({
    method: "POST",
    url: "/auth/demo-login",
    headers: { "Content-Type": "application/json" },
    payload: JSON.stringify({ sessionId }),
  });
  assert(response.statusCode === 200, `${sessionId} login should succeed.`);
  return parseJson<LoginResponse>(response.payload).token;
}

async function askWeather(token: string, sessionId: string) {
  const response = await app.inject({
    method: "POST",
    url: "/phantom-ai/chat",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    payload: JSON.stringify({
      provider: "phantom",
      admin_model: "codex",
      message: "what's the weather?",
      request_id: `privacy-weather-${sessionId}`,
    }),
  });
  assert(response.statusCode === 200, `${sessionId} weather request should return 200.`);
  return parseJson<PrivacyChatResponse>(response.payload);
}

async function sendLocationFollowUp(token: string, sessionId: string) {
  const response = await app.inject({
    method: "POST",
    url: "/phantom-ai/chat",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    payload: JSON.stringify({
      provider: "phantom",
      admin_model: "codex",
      message: "ok i'm in New York",
      request_id: `privacy-weather-location-${sessionId}`,
    }),
  });
  assert(response.statusCode === 200, `${sessionId} weather follow-up should return 200.`);
  return parseJson<PrivacyChatResponse>(response.payload);
}

async function askWeatherForNewYork(token: string, sessionId: string) {
  const message = sessionId.includes("curly") ? "what’s the weather in New York" : "what's the weather in New York";
  const response = await app.inject({
    method: "POST",
    url: "/phantom-ai/chat",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    payload: JSON.stringify({
      provider: "phantom",
      admin_model: "codex",
      message,
      request_id: `privacy-weather-inline-location-${sessionId}`,
    }),
  });
  assert(response.statusCode === 200, `${sessionId} inline weather location request should return 200.`);
  return parseJson<PrivacyChatResponse>(response.payload);
}

const realFetch = globalThis.fetch;

function installWeatherFetchStub() {
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith("https://geocoding-api.open-meteo.com/v1/search")) {
      return new Response(
        JSON.stringify({
          results: [
            {
              name: "New York",
              admin1: "New York",
              country: "United States",
              latitude: 40.7143,
              longitude: -74.006,
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.startsWith("https://api.open-meteo.com/v1/forecast")) {
      return new Response(
        JSON.stringify({
          current: {
            temperature_2m: 74.2,
            apparent_temperature: 75.8,
            relative_humidity_2m: 61,
            precipitation: 0,
            weather_code: 1,
            wind_speed_10m: 8.4,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return realFetch(input, init);
  };
}

try {
  const adminToken = await login("admin-jordan");
  const clientToken = await login("client-sports-demo");
  const admin = await askWeather(adminToken, "admin");
  const client = await askWeather(clientToken, "client");

  for (const [label, body] of [
    ["admin", admin],
    ["client", client],
  ] as const) {
    assert(body.model_id === "phantom-privacy-location-guard", `${label} should use local privacy guard.`);
    assert(body.message.content.includes("does not access or infer your location"), `${label} should not infer location.`);
    assert(body.privacy_guard?.location_accessed === false, `${label} should not access location.`);
    assert(body.privacy_guard?.location_inferred === false, `${label} should not infer location.`);
    assert(body.privacy_guard?.device_location_used === false, `${label} should not use device location.`);
    assert(body.privacy_guard?.ip_location_used === false, `${label} should not use IP location.`);
    assert(body.privacy_guard?.requires_explicit_location === true, `${label} should require explicit location.`);
    assert(body.provider_request_body_created === false, `${label} should not prepare a provider body.`);
    assert(body.live_provider_called === false, `${label} should not call a live provider.`);
    assert(body.network_call_performed === false, `${label} should not perform a network call.`);
    assert(body.approval_executed === false, `${label} should not execute approvals.`);
    assert(body.queue_written === false, `${label} should not write queues.`);
  }

  installWeatherFetchStub();
  const adminFollowUp = await sendLocationFollowUp(adminToken, "admin");
  assert(adminFollowUp.model_id === "phantom-weather-explicit-location", "Admin follow-up should run explicit-location weather lookup.");
  assert(adminFollowUp.message.content.includes("New York, New York, United States"), "Follow-up should include the resolved New York place.");
  assert(adminFollowUp.message.content.includes("New York"), "Follow-up should use the explicit New York location.");
  assert(adminFollowUp.message.content.includes("Privacy note"), "Follow-up should include privacy note.");
  assert(adminFollowUp.weather?.ok === true, "Follow-up should include successful weather metadata.");
  assert(adminFollowUp.weather?.temperature === 74.2, "Follow-up should use stubbed weather temperature.");
  assert(adminFollowUp.privacy_guard?.location_inferred === false, "Follow-up should not infer location.");
  assert(adminFollowUp.privacy_guard?.explicit_location_received === true, "Follow-up should record explicit location.");
  assert(adminFollowUp.provider_request_body_created === false, "Follow-up should not prepare provider body.");
  assert(adminFollowUp.live_provider_called === false, "Follow-up should not call live provider.");
  assert(adminFollowUp.network_call_performed === true, "Follow-up should perform only explicit-location weather network lookup.");

  const clientInlineLocation = await askWeatherForNewYork(clientToken, "client-pending");
  assert(clientInlineLocation.model_id === "phantom-weather-explicit-location", "Inline weather location should run explicit-location weather lookup.");
  assert(clientInlineLocation.message.content.includes("New York, New York, United States"), "Inline weather location should extract only New York.");
  assert(!clientInlineLocation.message.content.includes("match for what's the weather"), "Inline weather location should not treat the full sentence as location.");
  assert(clientInlineLocation.weather?.ok === true, "Inline weather location should include successful weather metadata.");
  assert(clientInlineLocation.network_call_performed === true, "Inline weather location should perform explicit-location weather lookup.");

  const adminCurlyInlineLocation = await askWeatherForNewYork(adminToken, "admin-curly");
  assert(adminCurlyInlineLocation.model_id === "phantom-weather-explicit-location", "Curly apostrophe weather location should run explicit-location weather lookup.");
  assert(adminCurlyInlineLocation.message.content.includes("New York, New York, United States"), "Curly apostrophe weather location should extract only New York.");
  assert(!adminCurlyInlineLocation.message.content.includes("match for what"), "Curly apostrophe weather location should not treat the full sentence as location.");

  console.log(
    JSON.stringify(
      {
        ok: true,
        admin_model_id: admin.model_id,
        client_model_id: client.model_id,
        admin_followup_model_id: adminFollowUp.model_id,
        client_inline_model_id: clientInlineLocation.model_id,
        admin_curly_inline_model_id: adminCurlyInlineLocation.model_id,
        privacy_reason: admin.privacy_guard?.reason,
        followup_reason: adminFollowUp.privacy_guard?.reason,
        provider_called: admin.live_provider_called || client.live_provider_called,
        network_call_performed: admin.network_call_performed || client.network_call_performed || adminFollowUp.network_call_performed,
      },
      null,
      2,
    ),
  );
} finally {
  globalThis.fetch = realFetch;
  await app.close();
}
