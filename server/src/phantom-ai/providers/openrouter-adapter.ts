import { redactSensitiveText } from "../hermes-ledger.js";
import type {
  ApprovalRequestStatus,
  OpenRouterGlmTransportContract,
  OpenRouterGlmAdapterDryRunResult,
  ProviderPolicyEvaluationResult,
  ProviderReadinessRoute,
  ProviderRoute,
  SensitivityLevel,
} from "../types.js";

export const OPENROUTER_GLM_PROVIDER_ID = "openrouter_glm" as const;
export const OPENROUTER_GLM_52_MODEL_ID = "z-ai/glm-5.2" as const;
export const OPENROUTER_CHAT_COMPLETIONS_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions" as const;

const MAX_PROMPT_SUMMARY_CHARS = 1200;

function uniqRedacted(values: string[]) {
  return Array.from(new Set(values.map((value) => redactSensitiveText(value)).filter(Boolean)));
}

function createEnvelopeId(requestId: string) {
  return `dry-openrouter-${Buffer.from(redactSensitiveText(requestId)).toString("base64url").slice(0, 24)}`;
}

function buildOpenRouterGlmTransportContract(requiredBeforeLive: string[]): OpenRouterGlmTransportContract {
  return {
    provider_id: OPENROUTER_GLM_PROVIDER_ID,
    model_id: OPENROUTER_GLM_52_MODEL_ID,
    contract_status: "disabled_contract_only",
    endpoint: OPENROUTER_CHAT_COMPLETIONS_ENDPOINT,
    method: "POST",
    auth_header_required: true,
    auth_header_preview: "Authorization: Bearer [redacted]",
    content_type: "application/json",
    optional_headers: {
      http_referer: "planned_admin_config_only",
      x_title: "planned_admin_config_only",
    },
    request_body_shape: {
      model: OPENROUTER_GLM_52_MODEL_ID,
      messages: "redacted_messages_required",
      temperature: "optional_number",
      max_tokens: "optional_number",
    },
    response_body_shape: {
      choices: "provider_response_choices",
      usage: "provider_usage_metadata",
    },
    transport_enabled: false,
    live_call_allowed: false,
    network_client_implemented: false,
    request_body_prepared: false,
    ready_for_send: false,
    provider_called: false,
    network_call_performed: false,
    raw_api_key_returned: false,
    raw_prompt_returned: false,
    raw_response_stored: false,
    payment_required_before_live: true,
    payment_instruction_status: "not_requested",
    payment_instruction:
      "Do not fund OpenRouter yet; finish budget, Hermes receipts, redaction, approval execution, and smoke approval first.",
    required_before_enable: requiredBeforeLive,
    admin_debug_summary: redactSensitiveText(
      `OpenRouter GLM transport contract targets ${OPENROUTER_CHAT_COMPLETIONS_ENDPOINT} with model ${OPENROUTER_GLM_52_MODEL_ID}; network client is not implemented.`,
    ),
    client_safe_summary: "Phantom AI provider transport is not enabled. No external AI provider was called.",
    safety_flags: {
      admin_only: true,
      contract_only: true,
      live_call_allowed: false,
      network_client_implemented: false,
      provider_called: false,
      raw_secret_exposed: false,
      request_body_prepared: false,
      ready_for_send: false,
      payment_not_requested: true,
    },
  };
}

export function buildOpenRouterGlmAdapterDryRunPreview(input: {
  requestId: string;
  redactedPromptSummary: string;
  estimatedTokens: number;
  estimatedCostUsd: number | null;
  routeCandidate: ProviderRoute;
  sensitivityLevel: SensitivityLevel;
  approvalStatus: ApprovalRequestStatus;
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
    "Pass the admin-only live smoke preflight for budget, ledger, redaction, approval execution, and transport gates.",
    "Prove the transport passes provider policy with route_allowed true in a future approved patch.",
    "Keep provider details admin-only and keep customer UI in Phantom AI language.",
  ]);
  const redactedPromptSummary = redactSensitiveText(input.redactedPromptSummary).slice(0, MAX_PROMPT_SUMMARY_CHARS);
  const estimatedTokens = Math.max(0, Math.ceil(input.estimatedTokens));
  const estimatedCostUsd = input.estimatedCostUsd === null ? null : Math.max(0, input.estimatedCostUsd);

  return {
    provider_id: OPENROUTER_GLM_PROVIDER_ID,
    model_id: OPENROUTER_GLM_52_MODEL_ID,
    adapter_status: "blocked_dry_run",
    request_id: redactSensitiveText(input.requestId),
    redacted_prompt_summary: redactedPromptSummary,
    estimated_tokens: estimatedTokens,
    estimated_cost_usd: estimatedCostUsd,
    live_call_allowed: false,
    execution_disabled: true,
    blocked_reason: blockedReasons[0] ?? "OpenRouter GLM adapter dry-run blocked live provider use.",
    required_before_live: requiredBeforeLive,
    transport_contract: buildOpenRouterGlmTransportContract(requiredBeforeLive),
    live_transport_readiness: {
      status: "blocked",
      ready_for_live_transport: false,
      live_transport_configured: false,
      live_transport_enabled: false,
      admin_only_mode: true,
      provider_policy_allowed: false,
      readiness_key_present: Boolean(input.readinessRoute?.key_present),
      budget_status_ok: false,
      budget_status: input.providerPolicy.budget.status,
      approval_status_ok: false,
      approval_status: input.approvalStatus,
      firewall_permits_call: false,
      ledger_write_required: true,
      request_redaction_required: true,
      response_redaction_required: true,
      live_smoke_test_explicitly_approved: false,
      blocked_reasons: blockedReasons,
      required_before_live_smoke_test: requiredBeforeLive,
    },
    dry_run_request_envelope: {
      envelope_id: createEnvelopeId(input.requestId),
      provider_id: OPENROUTER_GLM_PROVIDER_ID,
      model_id: OPENROUTER_GLM_52_MODEL_ID,
      request_id: redactSensitiveText(input.requestId),
      redacted_prompt_summary: redactedPromptSummary,
      estimated_tokens: estimatedTokens,
      estimated_cost_usd: estimatedCostUsd,
      metadata: {
        route_candidate: input.routeCandidate,
        sensitivity_level: input.sensitivityLevel,
        approval_status: input.approvalStatus,
        budget_status: input.providerPolicy.budget.status,
      },
      dry_run_only: true,
      live_call_allowed: false,
      execution_disabled: true,
      no_live_call_reason: blockedReasons[0] ?? "OpenRouter live transport readiness is blocked.",
      network_payload_prepared: false,
      ready_for_send: false,
      contains_raw_credential: false,
      contains_raw_env_value: false,
      contains_raw_prompt: false,
    },
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
