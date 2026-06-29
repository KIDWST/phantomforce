import { redactSensitiveText } from "./hermes-ledger.js";
import { getProviderSetupStatus } from "./model-router.js";
import { getProviderBudgetPolicyStatus } from "./provider-policy.js";
import type {
  ProviderReadinessReport,
  ProviderReadinessRoute,
  ProviderReadinessRouteStatus,
  ProviderSetupStatus,
} from "./types.js";

// Foundation-only provider readiness derivation.
//
// This reports, per provider route, whether the prerequisites for a future
// live route are present. It NEVER enables a route, calls a provider, reads a
// raw secret value, or claims production readiness. It derives entirely from
// the boolean/config-name fields already exposed by getProviderSetupStatus and
// getProviderBudgetPolicyStatus, so no API key value can flow into the report.

function redactStrings(values: string[]): string[] {
  return values.map((value) => redactSensitiveText(value));
}

function buildRoute(options: {
  id: ProviderReadinessRoute["id"];
  label: string;
  configured: boolean;
  status: ProviderReadinessRouteStatus;
  isDefaultSafeRoute: boolean;
  missing: string[];
  detail: string;
}): ProviderReadinessRoute {
  return {
    id: options.id,
    label: options.label,
    configured: options.configured,
    status: options.status,
    live_call_allowed: false,
    is_default_safe_route: options.isDefaultSafeRoute,
    missing: redactStrings(options.missing),
    detail: redactSensitiveText(options.detail),
  };
}

function deriveRoutes(setup: ProviderSetupStatus): ProviderReadinessRoute[] {
  const openRouterConfigured = setup.openrouter_glm.configured;
  const claudeConfigured = setup.claude_api.configured;
  const localAvailable = setup.local_fallback.available;

  return [
    buildRoute({
      id: "mock",
      label: "Built-in mock route",
      configured: true,
      status: "configured",
      isDefaultSafeRoute: true,
      missing: [],
      detail: "Safe built-in preview route is always available. It records mock results only and makes no live call.",
    }),
    buildRoute({
      id: "openrouter_glm",
      label: "OpenRouter GLM worker route",
      configured: openRouterConfigured,
      status: openRouterConfigured ? "configured" : "needs_config",
      isDefaultSafeRoute: false,
      missing: openRouterConfigured
        ? []
        : [
            "Server-side OPENROUTER_API_KEY (value stays server-side and is never shown).",
            "Funded OpenRouter account before any live worker call.",
          ],
      detail: openRouterConfigured
        ? "Worker credentials are present for future use; live calls remain globally disabled."
        : "Worker route is not configured. It cannot be selected for live work until owner setup is complete.",
    }),
    buildRoute({
      id: "claude",
      label: "Claude premium reasoning route",
      configured: claudeConfigured,
      status: claudeConfigured ? "configured" : "needs_config",
      isDefaultSafeRoute: false,
      missing: claudeConfigured ? [] : ["Server-side ANTHROPIC_API_KEY (value stays server-side and is never shown)."],
      detail: claudeConfigured
        ? "Premium credentials are present for future use; live calls remain globally disabled."
        : "Premium reasoning route is planned and not configured for live calls.",
    }),
    buildRoute({
      id: "local",
      label: "Local/private fallback route",
      configured: localAvailable,
      status: localAvailable ? "configured" : "needs_config",
      isDefaultSafeRoute: false,
      missing: localAvailable
        ? []
        : ["A local model endpoint (for example OLLAMA_BASE_URL) or PHANTOM_LOCAL_MODEL_AVAILABLE=true."],
      detail: localAvailable
        ? "Local endpoint is referenced for future private/offline use; live calls remain globally disabled."
        : "No local fallback endpoint is configured for the server.",
    }),
    buildRoute({
      id: "byok",
      label: "Bring Your Own Key",
      configured: setup.byok.enabled,
      status: "disabled",
      isDefaultSafeRoute: false,
      missing: ["BYOK is intentionally planned and disabled by default. No customer key intake exists."],
      detail: "Bring Your Own Key remains an advanced/future capability and is disabled in this foundation.",
    }),
  ];
}

export function getProviderReadinessReport(
  env: NodeJS.ProcessEnv = process.env,
  options: { checkedAt?: string } = {},
): ProviderReadinessReport {
  const setup = getProviderSetupStatus(env);
  const policy = getProviderBudgetPolicyStatus(env);
  const routes = deriveRoutes(setup);
  const anyLiveRouteConfigured = routes.some((route) => route.id !== "mock" && route.configured);

  return {
    checked_at: options.checkedAt ?? new Date().toISOString(),
    router_mode: setup.router_mode,
    live_providers_globally_enabled: policy.live_providers_globally_enabled,
    production_ready: false,
    any_live_route_configured: anyLiveRouteConfigured,
    recommended_route: "mock",
    routes,
    required_before_live: redactStrings(policy.required_before_live_calls),
    client_safe_summary:
      "Phantom AI runs in safe preview mode. No external AI providers are called and no provider keys are stored.",
    admin_debug_summary: redactSensitiveText(
      `Router mode ${setup.router_mode}; live providers ${
        policy.live_providers_globally_enabled ? "flagged-on-but-still-dry-run" : "disabled"
      }; live route credentials ${anyLiveRouteConfigured ? "present" : "absent"}; production_ready false.`,
    ),
    safety_flags: {
      live_provider_call_allowed: false,
      execution_disabled: true,
      dry_run_only: true,
      secrets_stored: false,
      admin_only: true,
      not_production: true,
    },
  };
}
