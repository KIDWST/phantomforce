import { evaluateProviderInvocationFirewall } from "../src/phantom-ai/provider-invocation-firewall.js";
import { previewModelRouterFoundation } from "../src/phantom-ai/model-router.js";
import type { ModelRouterRequest } from "../src/phantom-ai/types.js";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

// Fake secret values that must never appear in the firewall result.
const fakeSecret = ["SECRET", "TOKEN"].join("_");
const fakeSecretValue = ["abc", "123", "456", "789"].join("");
const fakeCard = ["4242", "4242", "4242", "4242"].join(" ");
const fakeProviderKey = ["sk", "or", "v1", "firewalltest0123456789"].join("-");
const openRouterKeyEnvName = ["OPENROUTER", "API", "KEY"].join("_");

const baseRequest: ModelRouterRequest = {
  tenant_id: "demo-trainer",
  business_name: "West Loop Strength Lab",
  actor_user_id: "demo-owner",
  actor_role: "platform_admin",
  request_id: "firewall-test-001",
  task_type: "content_idea_summary",
  sensitivity_level: "low",
  user_request: "Summarize today's safest trainer follow-ups for review only.",
  business_summary: "Owner-only personal training demo. External actions are approval-only.",
  module_data: [],
};

// 1) Default mock preview: firewall must block, no live call, no execution.
const mockPreview = previewModelRouterFoundation(baseRequest, { env: { PHANTOM_MODEL_ROUTER_MODE: "mock" } });
const mockFirewall = mockPreview.provider_invocation;

assert(mockFirewall.status === "blocked", "Firewall must always be blocked.");
assert(mockFirewall.live_call_allowed === false, "Firewall must never allow a live call.");
assert(mockFirewall.execution_disabled === true, "Firewall must keep execution disabled.");
assert(mockFirewall.dry_run_result.provider_called === false, "Firewall must not call a provider.");
assert(mockFirewall.dry_run_result.network_call_performed === false, "Firewall must not perform a network call.");
assert(mockFirewall.dry_run_result.ledger_written === false, "Firewall preview must not write the ledger.");
assert(mockFirewall.dry_run_result.queue_written === false, "Firewall preview must not write the queue.");
assert(mockFirewall.dry_run_result.approval_executed === false, "Firewall must not execute an approval.");
assert(mockFirewall.safety_flags.live_call_allowed === false, "Safety flag live_call_allowed must be false.");
assert(mockFirewall.safety_flags.provider_called === false, "Safety flag provider_called must be false.");
assert(mockFirewall.safety_flags.network_call_performed === false, "Safety flag network_call_performed must be false.");
assert(mockFirewall.safety_flags.raw_secret_exposed === false, "Safety flag raw_secret_exposed must be false.");
assert(mockFirewall.safety_flags.secrets_stored === false, "Safety flag secrets_stored must be false.");
assert(mockFirewall.safety_flags.approval_execution_implemented === false, "Approval execution must not be implemented.");
assert(mockFirewall.safety_flags.dry_run_only === true, "Firewall must be dry-run only.");
assert(mockFirewall.safety_flags.admin_only === true, "Firewall must be admin-only.");
assert(mockFirewall.blocked_reasons.length > 0, "Firewall must list blocked reasons.");
assert(mockFirewall.required_before_live.length > 0, "Firewall must list prerequisites before live calls.");
assert(
  !/openrouter|claude|local model/i.test(mockFirewall.client_safe_summary),
  "Client-safe summary must not expose provider internals.",
);

// 2) Even with credentials configured AND the live flag flipped on, the
//    firewall must still block and refuse any live call.
const liveFlaggedPreview = previewModelRouterFoundation(
  { ...baseRequest, request_id: "firewall-test-002", task_type: "content_idea_summary" },
  {
    env: {
      PHANTOM_MODEL_ROUTER_MODE: "openrouter",
      [openRouterKeyEnvName]: fakeProviderKey,
      PHANTOM_LIVE_PROVIDERS_ENABLED: "true",
    },
  },
);
const liveFlaggedFirewall = liveFlaggedPreview.provider_invocation;

assert(liveFlaggedFirewall.status === "blocked", "Firewall must block even when live flag is on.");
assert(liveFlaggedFirewall.live_call_allowed === false, "Firewall must refuse live calls even when flagged on.");
assert(
  liveFlaggedFirewall.dry_run_result.provider_called === false,
  "Firewall must not call a provider even with credentials present.",
);
assert(
  !JSON.stringify(liveFlaggedFirewall).includes(fakeProviderKey),
  "Firewall result must not include the raw provider key value.",
);

// 3) Secret-bearing high-sensitivity request: no raw secret/card may appear.
const secretPreview = previewModelRouterFoundation(
  {
    ...baseRequest,
    request_id: "firewall-test-003",
    task_type: "delete_client_record",
    sensitivity_level: "high",
    user_request: `Delete the record. ${fakeSecret}=${fakeSecretValue} card ${fakeCard}.`,
  },
  { env: { PHANTOM_MODEL_ROUTER_MODE: "mock" } },
);
const secretFirewall = secretPreview.provider_invocation;
const serializedSecretFirewall = JSON.stringify(secretFirewall);

assert(secretFirewall.status === "blocked", "Destructive secret request must still be blocked.");
assert(!serializedSecretFirewall.includes(fakeSecretValue), "Firewall result must not include raw secret value.");
assert(!serializedSecretFirewall.includes(fakeCard), "Firewall result must not include raw card value.");

// 4) Direct evaluator call must also always block, regardless of inputs.
const directResult = evaluateProviderInvocationFirewall({
  requested_provider_id: "openrouter_glm",
  requested_route: "openrouter_glm",
  requested_model_id: "z-ai/glm-5.2",
  redacted_context_summary: "Redacted summary for direct firewall test.",
  estimated_tokens: 1200,
  estimated_cost_usd: 0.01,
  action_classification: mockPreview.action_preview.status,
  approval_request: mockPreview.approval_request,
  policy_result: mockPreview.provider_policy,
  readiness_result: mockFirewall.readiness_result,
});

assert(directResult.status === "blocked", "Direct firewall evaluation must block.");
assert(directResult.live_call_allowed === false, "Direct firewall evaluation must not allow a live call.");

console.log(
  JSON.stringify(
    {
      ok: true,
      mockStatus: mockFirewall.status,
      mockLiveCallAllowed: mockFirewall.live_call_allowed,
      mockProviderCalled: mockFirewall.dry_run_result.provider_called,
      liveFlaggedStatus: liveFlaggedFirewall.status,
      liveFlaggedLiveCallAllowed: liveFlaggedFirewall.live_call_allowed,
      secretLeaked:
        serializedSecretFirewall.includes(fakeSecretValue) || serializedSecretFirewall.includes(fakeCard),
      directStatus: directResult.status,
      blockedReasonSample: mockFirewall.blocked_reasons[0],
    },
    null,
    2,
  ),
);
