import { redactSensitiveText } from "./hermes-ledger.js";
import { getProviderSetupStatus } from "./model-router.js";
import { getProviderBudgetPolicyStatus } from "./provider-policy.js";
import type {
  ProviderReadinessKeySource,
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

function hasEnvValue(env: NodeJS.ProcessEnv, key: string) {
  return Boolean(env[key]?.trim());
}

function maskedKeyPreview(keyPresent: boolean, label: string) {
  return keyPresent ? `${label} present ([redacted])` : "not present";
}

function getRouteSafetyFlags(): ProviderReadinessRoute["safety_flags"] {
  return {
    live_calls_allowed: false,
    raw_secret_exposed: false,
    secret_stored: false,
    network_check_performed: false,
    admin_only: true,
    readiness_only: true,
  };
}

function buildRoute(options: {
  id: ProviderReadinessRoute["id"];
  label: string;
  clientSafeLabel: string;
  clientSafeStatus: string;
  configured: boolean;
  status: ProviderReadinessRouteStatus;
  keySource: ProviderReadinessKeySource;
  keyPresent: boolean;
  keyPreview: string;
  modelId: string | null;
  setupRequired: boolean;
  disabledReason: string;
  requiredBeforeLive: string[];
  lastCheckedAt: string;
  isDefaultSafeRoute: boolean;
  missing: string[];
  detail: string;
}): ProviderReadinessRoute {
  return {
    id: options.id,
    label: options.label,
    client_safe_label: options.clientSafeLabel,
    client_safe_status: options.clientSafeStatus,
    configured: options.configured,
    enabled: false,
    status: options.status,
    key_source: options.keySource,
    key_present: options.keyPresent,
    key_preview: redactSensitiveText(options.keyPreview),
    model_id: options.modelId ? redactSensitiveText(options.modelId) : null,
    setup_required: options.setupRequired,
    disabled_reason: redactSensitiveText(options.disabledReason),
    required_before_live: redactStrings(options.requiredBeforeLive),
    last_checked_at: options.lastCheckedAt,
    live_call_allowed: false,
    is_default_safe_route: options.isDefaultSafeRoute,
    missing: redactStrings(options.missing),
    detail: redactSensitiveText(options.detail),
    safety_flags: getRouteSafetyFlags(),
  };
}

function deriveRoutes(setup: ProviderSetupStatus, env: NodeJS.ProcessEnv, lastCheckedAt: string): ProviderReadinessRoute[] {
  const openRouterConfigured = setup.openrouter_glm.configured;
  const claudeConfigured = setup.claude_api.configured;
  const localAvailable = setup.local_fallback.available;
  const openRouterKeyPresent = hasEnvValue(env, "OPENROUTER_API_KEY");
  const claudeKeyPresent = hasEnvValue(env, "ANTHROPIC_API_KEY");
  const localConfigPresent = hasEnvValue(env, "OLLAMA_BASE_URL") || env.PHANTOM_LOCAL_MODEL_AVAILABLE === "true";
  const liveDisabledReason = "Live provider calls are disabled by the provider policy gate.";
  const providerRequiredBeforeLive = [
    "Keep credentials server-side and never expose raw values to customers.",
    "Pass the provider/budget policy gate with route_allowed explicitly true in a future approved patch.",
    "Complete runtime proof that clients cannot see provider readiness internals.",
    "Add separate reviewed provider-call implementation; this readiness report never calls providers.",
  ];

  return [
    buildRoute({
      id: "mock",
      label: "Built-in mock route",
      clientSafeLabel: "Preview assistant",
      clientSafeStatus: "Available for safe preview",
      configured: true,
      status: "configured",
      keySource: "none",
      keyPresent: false,
      keyPreview: "not required",
      modelId: "phantomforce-mock-router",
      setupRequired: false,
      disabledReason: "Mock route is preview-only and never performs a live provider call.",
      requiredBeforeLive: [],
      lastCheckedAt,
      isDefaultSafeRoute: true,
      missing: [],
      detail: "Safe built-in preview route is always available. It records mock results only and makes no live call.",
    }),
    buildRoute({
      id: "openrouter_glm",
      label: "OpenRouter GLM worker route",
      clientSafeLabel: "Worker route",
      clientSafeStatus: openRouterConfigured ? "Configured for future admin use" : "Setup required",
      configured: openRouterConfigured,
      status: openRouterConfigured ? "configured" : "needs_config",
      keySource: "env",
      keyPresent: openRouterKeyPresent,
      keyPreview: maskedKeyPreview(openRouterKeyPresent, "server env key"),
      modelId: setup.openrouter_glm.model_id,
      setupRequired: !openRouterConfigured,
      disabledReason: liveDisabledReason,
      requiredBeforeLive: providerRequiredBeforeLive,
      lastCheckedAt,
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
      clientSafeLabel: "Premium reasoning route",
      clientSafeStatus: claudeConfigured ? "Configured for future admin use" : "Setup required",
      configured: claudeConfigured,
      status: claudeConfigured ? "configured" : "needs_config",
      keySource: "env",
      keyPresent: claudeKeyPresent,
      keyPreview: maskedKeyPreview(claudeKeyPresent, "server env key"),
      modelId: "official-api-configured-later",
      setupRequired: !claudeConfigured,
      disabledReason: liveDisabledReason,
      requiredBeforeLive: providerRequiredBeforeLive,
      lastCheckedAt,
      isDefaultSafeRoute: false,
      missing: claudeConfigured ? [] : ["Server-side ANTHROPIC_API_KEY (value stays server-side and is never shown)."],
      detail: claudeConfigured
        ? "Premium credentials are present for future use; live calls remain globally disabled."
        : "Premium reasoning route is planned and not configured for live calls.",
    }),
    buildRoute({
      id: "local",
      label: "Private API lane",
      clientSafeLabel: "Private API lane",
      clientSafeStatus: localAvailable ? "Configured for future admin use" : "Planned / not configured",
      configured: localAvailable,
      status: localAvailable ? "configured" : "needs_config",
      keySource: localConfigPresent ? "env" : "none",
      keyPresent: localConfigPresent,
      keyPreview: maskedKeyPreview(localConfigPresent, "private route config"),
      modelId: localAvailable ? "private-api-configured-later" : null,
      setupRequired: !localAvailable,
      disabledReason: liveDisabledReason,
      requiredBeforeLive: providerRequiredBeforeLive,
      lastCheckedAt,
      isDefaultSafeRoute: false,
      missing: localAvailable
        ? []
        : ["Private API route is not configured for this server yet."],
      detail: localAvailable
        ? "Private API route is referenced for future protected use; live calls remain globally disabled."
        : "Private APIs save lives. No private route is configured for this server yet.",
    }),
    buildRoute({
      id: "byok",
      label: "Bring Your Own Key",
      clientSafeLabel: "Custom key option",
      clientSafeStatus: "Planned / disabled",
      configured: false,
      status: "disabled",
      keySource: "vault_planned",
      keyPresent: false,
      keyPreview: "not accepted",
      modelId: null,
      setupRequired: true,
      disabledReason: "BYOK is planned only. No customer key intake, vault storage, or live usage exists.",
      requiredBeforeLive: [
        "Design and review a separate key intake flow.",
        "Add secure vault storage; never store keys in local JSONL or client-visible state.",
        "Add explicit owner approval and audit proof before any BYOK route can exist.",
      ],
      lastCheckedAt,
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
  const checkedAt = options.checkedAt ?? new Date().toISOString();
  const routes = deriveRoutes(setup, env, checkedAt);
  const anyLiveRouteConfigured = routes.some(
    (route) => route.id !== "mock" && route.id !== "byok" && route.configured,
  );

  return {
    checked_at: checkedAt,
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
