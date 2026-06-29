import { redactSensitiveText } from "../hermes-ledger.js";
import type {
  OpenRouterGlmAdapterDryRunResult,
  ProviderPolicyEvaluationResult,
  ProviderReadinessRoute,
} from "../types.js";

export const OPENROUTER_GLM_PROVIDER_ID = "openrouter_glm" as const;
export const OPENROUTER_GLM_52_MODEL_ID = "z-ai/glm-5.2" as const;

const MAX_PROMPT_SUMMARY_CHARS = 1200;

function uniqRedacted(values: string[]) {
  return Array.from(new Set(values.map((value) => redactSensitiveText(value)).filter(Boolean)));
}

export function buildOpenRouterGlmAdapterDryRunPreview(input: {
  requestId: string;
  redactedPromptSummary: string;
  estimatedTokens: number;
  estimatedCostUsd: number | null;
  providerPolicy: ProviderPolicyEvaluationResult;
  readinessRoute: ProviderReadinessRoute | null;
  firewallBlockedReasons: string[];
  firewallRequiredBeforeLive: string[];
}): OpenRouterGlmAdapterDryRunResult {
  const readinessConfigured = Boolean(input.readinessRoute?.configured);
  const readinessLiveAllowed = Boolean(input.readinessRoute?.live_call_allowed);
  const blockedReasons = uniqRedacted([
    ...input.firewallBlockedReasons,
    "OpenRouter GLM adapter is skeleton-only and cannot create a live HTTP request.",
    input.providerPolicy.live_call_disabled_reason,
    input.readinessRoute?.disabled_reason ?? "OpenRouter readiness route is missing.",
  ]);
  const requiredBeforeLive = uniqRedacted([
    ...input.firewallRequiredBeforeLive,
    ...(input.readinessRoute?.required_before_live ?? []),
    "Add a separate reviewed OpenRouter transport implementation.",
    "Prove the transport passes provider policy with route_allowed true in a future approved patch.",
    "Keep provider details admin-only and keep customer UI in Phantom AI language.",
  ]);

  return {
    provider_id: OPENROUTER_GLM_PROVIDER_ID,
    model_id: OPENROUTER_GLM_52_MODEL_ID,
    adapter_status: "blocked_dry_run",
    request_id: redactSensitiveText(input.requestId),
    redacted_prompt_summary: redactSensitiveText(input.redactedPromptSummary).slice(0, MAX_PROMPT_SUMMARY_CHARS),
    estimated_tokens: Math.max(0, Math.ceil(input.estimatedTokens)),
    estimated_cost_usd: input.estimatedCostUsd === null ? null : Math.max(0, input.estimatedCostUsd),
    live_call_allowed: false,
    execution_disabled: true,
    blocked_reason: blockedReasons[0] ?? "OpenRouter GLM adapter dry-run blocked live provider use.",
    required_before_live: requiredBeforeLive,
    dry_run_response: {
      provider_called: false,
      network_call_performed: false,
      http_request_prepared: false,
      output_text: "OpenRouter GLM 5.2 adapter preview only. No provider call or HTTP request was made.",
      raw_response: null,
    },
    admin_debug_summary: redactSensitiveText(
      `OpenRouter GLM 5.2 adapter dry-run for ${OPENROUTER_GLM_52_MODEL_ID}; readiness configured=${readinessConfigured}; readiness live=${readinessLiveAllowed}; policy route_allowed=false.`,
    ),
    client_safe_summary: "Phantom AI previewed this safely. No external AI provider was called.",
    safety_flags: {
      dry_run_only: true,
      live_call_allowed: false,
      execution_disabled: true,
      provider_called: false,
      network_call_performed: false,
      http_request_prepared: false,
      raw_secret_exposed: false,
      raw_prompt_returned: false,
      raw_response_stored: false,
      ledger_written: false,
      queue_written: false,
      approval_executed: false,
      policy_route_allowed: false,
      readiness_live_call_allowed: false,
      admin_only: true,
    },
  };
}
