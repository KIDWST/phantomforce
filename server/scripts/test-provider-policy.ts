import {
  evaluateProviderBudgetPolicy,
  getProviderBudgetPolicyStatus,
} from "../src/phantom-ai/provider-policy.js";
import { previewModelRouterFoundation } from "../src/phantom-ai/model-router.js";
import type { ModelRouterRequest } from "../src/phantom-ai/types.js";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

const secretLabel = ["SECRET", "TOKEN"].join("_");
const secretValue = ["abc", "123", "456", "789"].join("");
const cardValue = ["4242", "4242", "4242", "4242"].join(" ");
const policyStatus = getProviderBudgetPolicyStatus({});

assert(!policyStatus.live_providers_globally_enabled, "Live providers should default to disabled.");
assert(policyStatus.no_api_keys_stored, "Policy status must state that no keys are stored.");
assert(policyStatus.admin_debug_visibility === "admin_only", "Policy internals must be admin-only.");
assert(policyStatus.byok_status === "planned_not_implemented", "BYOK must remain planned only.");
assert(
  policyStatus.local_fallback_status === "planned_not_implemented",
  "Local fallback must remain planned only in policy.",
);

const safePolicy = evaluateProviderBudgetPolicy(
  {
    route_candidate: "mock",
    sensitivity_level: "low",
    action_classification: "safe",
    estimated_tokens: 1200,
    estimated_cost_usd: 0,
    approval_required: false,
    provider_enabled: true,
  },
  { env: {} },
);

assert(!safePolicy.route_allowed, "Safe preview must still not allow a live route.");
assert(safePolicy.route_status === "dry_run_only", "Safe mock route should be dry-run-only.");
assert(safePolicy.policy_status === "live_disabled", "Live provider policy should be disabled by default.");
assert(safePolicy.budget.status === "ok", "Budget guard should pass small safe preview.");
assert(safePolicy.safety_flags.live_providers_globally_disabled, "Live disabled flag should be true.");
assert(!safePolicy.safety_flags.live_provider_call_allowed, "Live provider call flag must stay false.");
assert(!safePolicy.safety_flags.secrets_stored, "Policy result must not claim stored secrets.");
assert(
  !/openrouter|claude|local model/i.test(safePolicy.client_safe_summary),
  "Client-safe summary must not expose provider internals.",
);

const warningPolicy = evaluateProviderBudgetPolicy(
  {
    route_candidate: "mock",
    sensitivity_level: "low",
    action_classification: "safe",
    estimated_tokens: 5000,
    estimated_cost_usd: 0.21,
    approval_required: false,
    provider_enabled: true,
  },
  { env: {} },
);

assert(warningPolicy.budget.status === "warning", "Near-cap preview should warn.");
assert(!warningPolicy.route_allowed, "Warning preview must not allow a live route.");

const blockedBudgetPolicy = evaluateProviderBudgetPolicy(
  {
    route_candidate: "mock",
    sensitivity_level: "low",
    action_classification: "safe",
    estimated_tokens: 9000,
    estimated_cost_usd: 1.25,
    approval_required: false,
    provider_enabled: true,
  },
  { env: {} },
);

assert(blockedBudgetPolicy.budget.status === "blocked", "High estimate should be budget-blocked.");
assert(blockedBudgetPolicy.policy_status === "budget_blocked", "Policy status should reflect budget block.");
assert(blockedBudgetPolicy.route_status === "blocked", "Budget-blocked route should be blocked.");
assert(!blockedBudgetPolicy.route_allowed, "Budget-blocked preview must not allow a live route.");

const liveProviderPolicy = evaluateProviderBudgetPolicy(
  {
    route_candidate: "local",
    sensitivity_level: "low",
    action_classification: "live_provider_required",
    estimated_tokens: 1800,
    estimated_cost_usd: null,
    approval_required: false,
    provider_enabled: true,
  },
  {
    env: {
      PHANTOM_LIVE_PROVIDERS_ENABLED: "true",
      PHANTOM_AI_BUDGET_ENFORCEMENT_MODE: "future_live_guard",
    },
  },
);

assert(!liveProviderPolicy.route_allowed, "Live-provider-required route must not execute.");
assert(liveProviderPolicy.route_status === "blocked", "Live-provider-required preview should remain blocked.");
assert(liveProviderPolicy.approval_required, "Live-provider-required preview should require approval metadata.");
assert(liveProviderPolicy.budget.status === "warning", "Unknown future live cost should warn.");
assert(
  liveProviderPolicy.safety_flags.route_execution_allowed === false,
  "Route execution must be disabled even when future guard mode is selected.",
);

const disabledBudgetPolicy = evaluateProviderBudgetPolicy(
  {
    route_candidate: "mock",
    sensitivity_level: "low",
    action_classification: "safe",
    estimated_tokens: 999999,
    estimated_cost_usd: 999,
    approval_required: false,
    provider_enabled: true,
  },
  { env: { PHANTOM_AI_BUDGET_ENFORCEMENT_MODE: "disabled" } },
);

assert(disabledBudgetPolicy.budget.status === "disabled", "Disabled budget mode should report disabled.");
assert(!disabledBudgetPolicy.route_allowed, "Disabled budget mode still must not allow live routes.");

const request: ModelRouterRequest = {
  tenant_id: "demo-trainer",
  business_name: "West Loop Strength Lab",
  actor_user_id: "demo-owner",
  actor_role: "platform_admin",
  request_id: "provider-policy-test-001",
  task_type: "content_idea_summary",
  sensitivity_level: "low",
  user_request: "Summarize owner content ideas for review only.",
  business_summary: "Owner-only personal training simulation. External actions are approval-only.",
  module_data: [],
};
const routedPreview = previewModelRouterFoundation(request, {
  env: {
    PHANTOM_MODEL_ROUTER_MODE: "local",
    PHANTOM_LOCAL_MODEL_AVAILABLE: "true",
    PHANTOM_LIVE_PROVIDERS_ENABLED: "true",
  },
});

assert(
  routedPreview.action_preview.status === "live_provider_required",
  "Configured local route should be previewed as live-provider-required.",
);
assert(!routedPreview.provider_policy.route_allowed, "Router preview provider policy must block live route.");
assert(!routedPreview.live_provider_called, "Router preview must not call a live provider.");
assert(!routedPreview.ledger_written, "Router preview must not write the ledger.");
assert(
  !JSON.stringify(routedPreview.provider_policy).includes(secretValue),
  "Policy result must not include raw secret-like text from the request.",
);
assert(
  !JSON.stringify(routedPreview.provider_policy).includes(cardValue),
  "Policy result must not include raw card-like text from the request.",
);

const secretPreview = previewModelRouterFoundation(
  {
    ...request,
    request_id: "provider-policy-test-002",
    task_type: "content_idea_summary",
    user_request: `Summarize internal notes. ${secretLabel}=${secretValue} card ${cardValue}.`,
  },
  { env: { PHANTOM_MODEL_ROUTER_MODE: "mock" } },
);

assert(
  !JSON.stringify(secretPreview.provider_policy).includes(secretValue),
  "Policy result must not include raw secret-like text from high-sensitivity request.",
);
assert(
  !JSON.stringify(secretPreview.provider_policy).includes(cardValue),
  "Policy result must not include raw card-like text from high-sensitivity request.",
);

console.log(
  JSON.stringify(
    {
      ok: true,
      liveProvidersEnabledDefault: policyStatus.live_providers_globally_enabled,
      safeRouteAllowed: safePolicy.route_allowed,
      safePolicyStatus: safePolicy.policy_status,
      warningBudgetStatus: warningPolicy.budget.status,
      blockedBudgetStatus: blockedBudgetPolicy.budget.status,
      liveProviderRouteAllowed: liveProviderPolicy.route_allowed,
      liveProviderBudgetStatus: liveProviderPolicy.budget.status,
      disabledBudgetStatus: disabledBudgetPolicy.budget.status,
      routedPreviewPolicyStatus: routedPreview.provider_policy.policy_status,
      liveProviderCalled: routedPreview.live_provider_called,
    },
    null,
    2,
  ),
);
