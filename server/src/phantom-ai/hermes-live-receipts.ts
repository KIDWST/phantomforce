import { redactSensitiveText, redactPersonalDataText } from "./hermes-ledger.js";
import {
  OPENROUTER_CHAT_COMPLETIONS_ENDPOINT,
  OPENROUTER_GLM_52_MODEL_ID,
  OPENROUTER_GLM_PROVIDER_ID,
} from "./providers/openrouter-adapter.js";
import type {
  HermesLiveCallReceiptBlockedBooleans,
  HermesLiveCallReceiptContract,
  HermesLiveCallReceiptEndpointLinkage,
  HermesLiveCallReceiptGateLinkage,
  HermesLiveCallReceiptProviderMetadata,
  HermesLiveCallRedactionProofFlags,
  LiveSmokePreflightReport,
  ModelRouterPreviewResult,
  OpenRouterGlmTransportContract,
} from "./types.js";

const blockedBooleans: HermesLiveCallReceiptBlockedBooleans = {
  providerCalled: false,
  networkCallPerformed: false,
  ledgerWritten: false,
  queueWritten: false,
  approvalExecuted: false,
  readyForSend: false,
};

function idPart(value: string) {
  return Buffer.from(redactSensitiveText(value)).toString("base64url").slice(0, 24);
}

function createReceiptId(kind: "request" | "response", correlationId: string) {
  return `hermes-live-${kind}-${idPart(correlationId)}`;
}

function createCorrelationId(preview: ModelRouterPreviewResult, preflight: LiveSmokePreflightReport) {
  return `corr-${idPart(`${preview.context_packet.request_id}:${preflight.preflight_id}`)}`;
}

function buildRedactionProof(): HermesLiveCallRedactionProofFlags {
  const fakeApiKey = ["api", "key"].join("_");
  const fakeApiKeyValue = ["fake", "receipt", "key", "123456789"].join("-");
  const fakeTokenValue = ["fake", "receipt", "token", "123456789"].join("-");
  const fakeCardValue = ["4242", "4242", "4242", "4242"].join(" ");
  const fakePromptValue = ["prompt", "secret", "receipt", "value"].join("-");
  const probe = [
    `${fakeApiKey}=${fakeApiKeyValue}`,
    `Bearer ${fakeTokenValue}`,
    fakeCardValue,
    `SECRET_PROMPT=${fakePromptValue}`,
  ].join(" ");
  const redacted = redactSensitiveText(probe);

  return {
    fake_api_key_redacted: !redacted.includes(fakeApiKeyValue),
    fake_token_redacted: !redacted.includes(fakeTokenValue),
    fake_card_redacted: !redacted.includes(fakeCardValue),
    fake_prompt_redacted: !redacted.includes(fakePromptValue),
    raw_api_key_returned: false,
    raw_token_returned: false,
    raw_card_returned: false,
    raw_prompt_returned: false,
    request_redaction_required: true,
    response_redaction_required: true,
    response_redaction_contract_only: true,
  };
}

function buildProviderMetadata(): HermesLiveCallReceiptProviderMetadata {
  return {
    provider_id: OPENROUTER_GLM_PROVIDER_ID,
    provider_name: "OpenRouter",
    model_id: OPENROUTER_GLM_52_MODEL_ID,
  };
}

function buildEndpointLinkage(contract: OpenRouterGlmTransportContract): HermesLiveCallReceiptEndpointLinkage {
  return {
    endpoint: contract.endpoint,
    method: contract.method,
    transport_contract_status: contract.contract_status,
    transport_enabled: false,
    network_client_implemented: false,
  };
}

function buildGateLinkage(
  preview: ModelRouterPreviewResult,
  preflight: LiveSmokePreflightReport,
): HermesLiveCallReceiptGateLinkage {
  return {
    live_smoke_preflight_id: preflight.preflight_id,
    live_smoke_preflight_status: preflight.status,
    live_smoke_allowed: false,
    budget_gate_status: preflight.budget_gate.status,
    budget_policy_route_allowed: false,
    approval_gate_status: preflight.approval_execution_gate.status,
    approval_execution_implemented: false,
    approval_id: redactSensitiveText(preview.approval_request.approval_id),
    approval_status: preview.approval_request.status,
  };
}

export function buildHermesLiveCallReceiptContract(input: {
  preview: ModelRouterPreviewResult;
  preflight: LiveSmokePreflightReport;
}): HermesLiveCallReceiptContract {
  const adapter = input.preview.provider_invocation.openrouter_adapter;
  const transportContract = adapter?.transport_contract ?? {
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
    required_before_enable: input.preflight.required_before_live_smoke_test,
    admin_debug_summary: "Fallback disabled OpenRouter transport contract. No network client is implemented.",
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
  } satisfies OpenRouterGlmTransportContract;
  const correlationId = createCorrelationId(input.preview, input.preflight);
  const now = new Date().toISOString();
  const provider = buildProviderMetadata();
  const endpointContract = buildEndpointLinkage(transportContract);
  const gateLinkage = buildGateLinkage(input.preview, input.preflight);
  const redaction = buildRedactionProof();
  const requiredBeforeLive = Array.from(
    new Set([
      ...input.preflight.required_before_live_smoke_test,
      "Hermes must append the redacted request receipt before any live provider request.",
      "Hermes must append the redacted response receipt after any provider response or failure.",
      "Receipts must keep provider, budget, approval, preflight, and endpoint correlation IDs together.",
    ].map((item) => redactPersonalDataText(item))),
  );
  const requestReceipt = {
    ...blockedBooleans,
    receipt_id: createReceiptId("request", correlationId),
    correlation_id: correlationId,
    receipt_kind: "redacted_provider_request" as const,
    contract_status: "contract_only_blocked" as const,
    created_at: now,
    provider,
    endpoint_contract: endpointContract,
    gate_linkage: gateLinkage,
    redaction,
    redacted_request_summary: redactPersonalDataText(input.preview.context_packet.user_request_summary),
    redacted_context_preview: redactPersonalDataText(input.preview.context_packet.compact_context),
    request_payload_prepared: false as const,
    request_body_ready_for_send: false as const,
    raw_prompt_stored: false as const,
    raw_api_key_stored: false as const,
    ledger_append_required_before_live: true as const,
    ledger_append_performed: false as const,
  };
  const responseReceipt = {
    ...blockedBooleans,
    receipt_id: createReceiptId("response", correlationId),
    correlation_id: correlationId,
    receipt_kind: "redacted_provider_response" as const,
    contract_status: "contract_only_blocked" as const,
    created_at: now,
    provider,
    endpoint_contract: endpointContract,
    gate_linkage: gateLinkage,
    redaction,
    response_status: "not_called" as const,
    redacted_response_summary: "No provider response exists. Live provider call was not made.",
    raw_response_stored: false as const,
    provider_usage_recorded: false as const,
    ledger_append_required_before_live: true as const,
    ledger_append_performed: false as const,
  };

  return {
    ...blockedBooleans,
    contract_id: `hermes-live-receipt-contract-${idPart(correlationId)}`,
    correlation_id: correlationId,
    status: "blocked_contract_only",
    created_at: now,
    provider,
    endpoint_contract: endpointContract,
    live_smoke_preflight_id: input.preflight.preflight_id,
    budget_gate_status: input.preflight.budget_gate.status,
    approval_gate_status: input.preflight.approval_execution_gate.status,
    request_receipt: requestReceipt,
    response_receipt: responseReceipt,
    redaction,
    ledger_write_mode: "not_written_contract_only",
    queue_write_mode: "not_written_contract_only",
    approval_execution_mode: "not_implemented",
    required_before_live: requiredBeforeLive,
    admin_debug_summary: redactPersonalDataText(
      `Hermes live-call receipt contract for ${provider.provider_name}/${provider.model_id}; request and response receipts are required but not written.`,
    ),
    client_safe_summary: "Phantom AI is in preview mode. No external AI provider was called.",
    safety_flags: {
      admin_only: true,
      contract_only: true,
      provider_called: false,
      network_call_performed: false,
      ledger_written: false,
      queue_written: false,
      approval_executed: false,
      ready_for_send: false,
      raw_secret_exposed: false,
      raw_prompt_returned: false,
      raw_response_stored: false,
    },
  };
}
