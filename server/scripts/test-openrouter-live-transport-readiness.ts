import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildOpenRouterGlmAdapterDryRunPreview,
  OPENROUTER_CHAT_COMPLETIONS_ENDPOINT,
  OPENROUTER_GLM_52_MODEL_ID,
} from "../src/phantom-ai/providers/openrouter-adapter.js";
import { previewModelRouterFoundation } from "../src/phantom-ai/model-router.js";
import type { ModelRouterRequest } from "../src/phantom-ai/types.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../..");
const adapterSourcePath = resolve(repoRoot, "server/src/phantom-ai/providers/openrouter-adapter.ts");
const providerKeyEnvName = ["OPENROUTER", "API", "KEY"].join("_");
const fakeProviderKey = ["sk", "or", "v1", "transportgate0123456789"].join("-");
const sensitiveName = ["SEC", "RET"].join("");
const sensitiveValue = ["raw", "transport", "value"].join("-");
const cardLikeValue = ["4000", "0000", "0000", "0002"].join(" ");

const request: ModelRouterRequest = {
  tenant_id: "demo-trainer",
  business_name: "West Loop Strength Lab",
  actor_user_id: "demo-owner",
  actor_role: "platform_admin",
  request_id: "openrouter-live-transport-test-001",
  task_type: "content_idea_summary",
  sensitivity_level: "low",
  user_request: "Summarize safe trainer content priorities for owner review.",
  business_summary: "Owner-only personal training simulation. External actions approval-only.",
  module_data: [
    {
      module: "Content",
      summary: "Demo content queue for safe review.",
      items: [{ title: "Trainer recap", status: "draft", detail: "Owner review only." }],
    },
  ],
};

const source = await readFile(adapterSourcePath, "utf8");

assert(!/\bfetch\s*\(/.test(source), "Live transport gate must not add fetch calls.");
assert(!/\bhttps?\s*\.\s*request\b/.test(source), "Live transport gate must not add HTTP request calls.");
assert(!/axios\s*\(/i.test(source), "Live transport gate must not add axios calls.");
assert(!/undici/i.test(source), "Live transport gate must not import undici.");
assert(source.includes(OPENROUTER_CHAT_COMPLETIONS_ENDPOINT), "Live transport gate should expose disabled endpoint contract.");

const preview = previewModelRouterFoundation(request, {
  env: {
    PHANTOM_MODEL_ROUTER_MODE: "openrouter",
    [providerKeyEnvName]: fakeProviderKey,
    OPENROUTER_MODEL: OPENROUTER_GLM_52_MODEL_ID,
    PHANTOM_LIVE_PROVIDERS_ENABLED: "true",
  },
});
const firewall = preview.provider_invocation;
const adapter = firewall.openrouter_adapter;

assert(preview.decision.provider_route === "openrouter_glm", "Preview should select OpenRouter route when configured.");
assert(adapter !== null, "OpenRouter preview should include adapter dry-run details.");
assert(firewall.live_call_allowed === false, "Firewall must still block live provider calls.");
assert(firewall.execution_disabled === true, "Firewall execution must remain disabled.");
assert(!preview.provider_policy.route_allowed, "Provider policy must keep route_allowed false.");

const readiness = adapter.live_transport_readiness;
const envelope = adapter.dry_run_request_envelope;
const contract = adapter.transport_contract;

assert(readiness.status === "blocked", "Live transport readiness must be blocked.");
assert(readiness.ready_for_live_transport === false, "Live transport must not be ready.");
assert(readiness.live_transport_configured === false, "Live transport must not be configured.");
assert(readiness.live_transport_enabled === false, "Live transport must not be enabled.");
assert(readiness.admin_only_mode === true, "Transport readiness must remain admin-only.");
assert(readiness.provider_policy_allowed === false, "Provider policy gate must not be allowed.");
assert(readiness.readiness_key_present === true, "Readiness may show masked key presence as a boolean.");
assert(readiness.budget_status_ok === false, "Budget gate must not authorize live transport.");
assert(readiness.approval_status_ok === false, "Approval status must not authorize live transport.");
assert(readiness.firewall_permits_call === false, "Firewall must not permit live transport.");
assert(readiness.ledger_write_required === true, "Future live smoke test must require ledger write.");
assert(readiness.request_redaction_required === true, "Future live smoke test must require request redaction.");
assert(readiness.response_redaction_required === true, "Future live smoke test must require response redaction.");
assert(
  readiness.live_smoke_test_explicitly_approved === false,
  "Live smoke test must not be marked approved.",
);
assert(readiness.required_before_live_smoke_test.length > 0, "Readiness must list live smoke-test prerequisites.");

assert(envelope.provider_id === "openrouter_glm", "Envelope should identify provider id for admin preview.");
assert(envelope.model_id === OPENROUTER_GLM_52_MODEL_ID, "Envelope should identify GLM model for admin preview.");
assert(envelope.dry_run_only === true, "Envelope must be dry-run only.");
assert(envelope.live_call_allowed === false, "Envelope must not allow live call.");
assert(envelope.execution_disabled === true, "Envelope execution must be disabled.");
assert(envelope.network_payload_prepared === false, "Envelope must not prepare a provider payload.");
assert(envelope.ready_for_send === false, "Envelope must not be sendable.");
assert(envelope.contains_raw_credential === false, "Envelope must not contain raw credentials.");
assert(envelope.contains_raw_env_value === false, "Envelope must not contain raw env values.");
assert(envelope.contains_raw_prompt === false, "Envelope must not contain raw prompt.");
assert(adapter.dry_run_response.provider_called === false, "Adapter must not call provider.");
assert(adapter.dry_run_response.network_call_performed === false, "Adapter must not call network.");
assert(adapter.dry_run_response.http_request_prepared === false, "Adapter must not prepare HTTP request.");
assert(contract.endpoint === OPENROUTER_CHAT_COMPLETIONS_ENDPOINT, "Contract should target OpenRouter chat completions.");
assert(contract.model_id === OPENROUTER_GLM_52_MODEL_ID, "Contract should target GLM 5.2.");
assert(contract.transport_enabled === false, "Contract transport must remain disabled.");
assert(contract.network_client_implemented === false, "Contract must not implement a network client.");
assert(contract.request_body_prepared === false, "Contract must not prepare a request body.");
assert(contract.ready_for_send === false, "Contract must not be ready for send.");
assert(contract.provider_called === false, "Contract must not call provider.");
assert(contract.network_call_performed === false, "Contract must not call network.");
assert(contract.raw_api_key_returned === false, "Contract must not return a raw API key.");
assert(contract.payment_instruction_status === "not_requested", "Contract must not request payment yet.");

const serializedAdapter = JSON.stringify(adapter);
assert(!serializedAdapter.includes(fakeProviderKey), "Adapter must not expose raw provider key.");

const secretAdapter = buildOpenRouterGlmAdapterDryRunPreview({
  requestId: "openrouter-live-transport-test-002",
  redactedPromptSummary: `Preview only. ${sensitiveName}=${sensitiveValue} card ${cardLikeValue}.`,
  estimatedTokens: 900,
  estimatedCostUsd: null,
  routeCandidate: preview.decision.provider_route,
  sensitivityLevel: preview.decision.sensitivity_level,
  approvalStatus: preview.approval_request.status,
  providerPolicy: preview.provider_policy,
  readinessRoute: firewall.readiness_route,
  firewallBlockedReasons: firewall.blocked_reasons,
  firewallRequiredBeforeLive: firewall.required_before_live,
});
const serializedSecretAdapter = JSON.stringify(secretAdapter);

assert(!serializedSecretAdapter.includes(sensitiveValue), "Dry-run envelope must redact secret-like prompt values.");
assert(!serializedSecretAdapter.includes(cardLikeValue), "Dry-run envelope must redact card-like prompt values.");
assert(
  secretAdapter.dry_run_request_envelope.contains_raw_prompt === false,
  "Secret-bearing envelope must not include raw prompt.",
);
assert(secretAdapter.transport_contract.raw_prompt_returned === false, "Secret-bearing contract must not return raw prompt.");

console.log(
  JSON.stringify(
    {
      ok: true,
      readyForLiveTransport: readiness.ready_for_live_transport,
      liveTransportConfigured: readiness.live_transport_configured,
      liveTransportEnabled: readiness.live_transport_enabled,
      providerPolicyAllowed: readiness.provider_policy_allowed,
      readinessKeyPresent: readiness.readiness_key_present,
      budgetStatusOk: readiness.budget_status_ok,
      approvalStatusOk: readiness.approval_status_ok,
      firewallPermitsCall: readiness.firewall_permits_call,
      smokeTestApproved: readiness.live_smoke_test_explicitly_approved,
      envelopeReadyForSend: envelope.ready_for_send,
      networkPayloadPrepared: envelope.network_payload_prepared,
      contractEndpoint: contract.endpoint,
      contractTransportEnabled: contract.transport_enabled,
      networkClientImplemented: contract.network_client_implemented,
      paymentInstructionStatus: contract.payment_instruction_status,
      providerCalled: adapter.dry_run_response.provider_called,
      networkCallPerformed: adapter.dry_run_response.network_call_performed,
      secretsLeaked:
        serializedAdapter.includes(fakeProviderKey) ||
        serializedSecretAdapter.includes(sensitiveValue) ||
        serializedSecretAdapter.includes(cardLikeValue),
      sourceContainsTransport:
        /\bfetch\s*\(/.test(source) ||
        /\bhttps?\s*\.\s*request\b/.test(source) ||
        /axios\s*\(/i.test(source) ||
        /undici/i.test(source),
    },
    null,
    2,
  ),
);
