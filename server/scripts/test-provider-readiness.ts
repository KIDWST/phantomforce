import { getProviderReadinessReport } from "../src/phantom-ai/provider-readiness.js";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

function routeById(report: ReturnType<typeof getProviderReadinessReport>, id: string) {
  const route = report.routes.find((item) => item.id === id);
  if (!route) {
    throw new Error(`Expected route ${id} in readiness report.`);
  }
  return route;
}

// Fake secret values that must never appear in the report output.
const fakeOpenRouterKey = ["sk", "or", "v1", "abcdef0123456789"].join("-");
const fakeAnthropicKey = ["sk", "ant", "test", "9876543210fedcba"].join("-");
const fakeLocalUrl = "http://127.0.0.1:11434";

// 1) Default env: only mock is configured, no live providers, not production.
const defaultReport = getProviderReadinessReport({});

assert(defaultReport.production_ready === false, "Foundation must never be production-ready.");
assert(!defaultReport.live_providers_globally_enabled, "Live providers must default to disabled.");
assert(defaultReport.recommended_route === "mock", "Recommended route must be the safe mock route.");
assert(!defaultReport.any_live_route_configured, "No live route should be configured by default.");
assert(defaultReport.safety_flags.live_provider_call_allowed === false, "Live calls must stay disallowed.");
assert(defaultReport.safety_flags.secrets_stored === false, "Report must state no secrets are stored.");
assert(defaultReport.safety_flags.execution_disabled === true, "Execution must stay disabled.");
assert(defaultReport.safety_flags.admin_only === true, "Readiness must be admin-only.");
assert(defaultReport.safety_flags.not_production === true, "Report must flag not-production posture.");

const mock = routeById(defaultReport, "mock");
assert(mock.configured && mock.status === "configured", "Mock route must always be configured.");
assert(mock.is_default_safe_route, "Mock route must be the default safe route.");
assert(mock.live_call_allowed === false, "Mock route must not allow a live call.");

assert(routeById(defaultReport, "openrouter_glm").status === "needs_config", "OpenRouter must need config by default.");
assert(routeById(defaultReport, "claude").status === "needs_config", "Claude must need config by default.");
assert(routeById(defaultReport, "local").status === "needs_config", "Local must need config by default.");
assert(routeById(defaultReport, "byok").status === "disabled", "BYOK must stay disabled.");
assert(routeById(defaultReport, "openrouter_glm").missing.length > 0, "Unconfigured route must list missing items.");
assert(
  !/openrouter|claude|local|byok/i.test(defaultReport.client_safe_summary),
  "Client-safe summary must not expose provider internals.",
);

// 2) Configured env with fake secrets: routes flip to configured but secret
//    VALUES must never appear, and live calls/production stay disabled.
const configuredReport = getProviderReadinessReport({
  OPENROUTER_API_KEY: fakeOpenRouterKey,
  ANTHROPIC_API_KEY: fakeAnthropicKey,
  OLLAMA_BASE_URL: fakeLocalUrl,
  PHANTOM_ALLOW_BYOK: "true",
});

assert(routeById(configuredReport, "openrouter_glm").configured, "OpenRouter should read as configured.");
assert(routeById(configuredReport, "claude").configured, "Claude should read as configured.");
assert(routeById(configuredReport, "local").configured, "Local should read as configured.");
assert(configuredReport.any_live_route_configured, "Configured env should report a live route present.");
assert(configuredReport.production_ready === false, "Configured credentials still must not be production-ready.");
assert(
  configuredReport.routes.every((route) => route.live_call_allowed === false),
  "No route may allow a live call even when configured.",
);
assert(routeById(configuredReport, "byok").status === "disabled", "BYOK must remain disabled even if enabled in env.");

const serialized = JSON.stringify(configuredReport);
assert(!serialized.includes(fakeOpenRouterKey), "Report must not include the raw OpenRouter key value.");
assert(!serialized.includes(fakeAnthropicKey), "Report must not include the raw Anthropic key value.");
assert(!serialized.includes(fakeLocalUrl), "Report must not include the raw local endpoint value.");

// 3) Live-providers flag set ON: still dry-run-only, still not production.
const liveFlaggedReport = getProviderReadinessReport({
  OPENROUTER_API_KEY: fakeOpenRouterKey,
  PHANTOM_LIVE_PROVIDERS_ENABLED: "true",
});

assert(liveFlaggedReport.live_providers_globally_enabled, "Live flag should be reflected.");
assert(liveFlaggedReport.production_ready === false, "Live flag must not make the foundation production-ready.");
assert(
  liveFlaggedReport.safety_flags.live_provider_call_allowed === false,
  "Live flag must not allow an actual provider call.",
);
assert(liveFlaggedReport.required_before_live.length > 0, "Report must list prerequisites before live calls.");

console.log(
  JSON.stringify(
    {
      ok: true,
      defaultRecommendedRoute: defaultReport.recommended_route,
      defaultProductionReady: defaultReport.production_ready,
      defaultAnyLiveRouteConfigured: defaultReport.any_live_route_configured,
      configuredAnyLiveRouteConfigured: configuredReport.any_live_route_configured,
      configuredProductionReady: configuredReport.production_ready,
      secretsLeaked:
        serialized.includes(fakeOpenRouterKey) ||
        serialized.includes(fakeAnthropicKey) ||
        serialized.includes(fakeLocalUrl),
      liveFlaggedLiveCallAllowed: liveFlaggedReport.safety_flags.live_provider_call_allowed,
      routeStatuses: defaultReport.routes.map((route) => `${route.id}:${route.status}`),
    },
    null,
    2,
  ),
);
