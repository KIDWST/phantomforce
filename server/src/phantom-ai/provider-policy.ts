import { redactPersonalDataText } from "./hermes-ledger.js";
import type {
  ActionPreviewStatus,
  BudgetGuardEnforcementMode,
  BudgetGuardPreview,
  BudgetGuardStatus,
  ProviderBudgetCaps,
  ProviderBudgetPolicyState,
  ProviderPolicyEvaluationInput,
  ProviderPolicyEvaluationResult,
  ProviderPolicyStatus,
  ProviderRoute,
  ProviderRoutePolicyStatus,
} from "./types.js";

const DEFAULT_BUDGET_CAPS: ProviderBudgetCaps = {
  monthly_budget_cap_usd: 100,
  daily_budget_cap_usd: 10,
  per_request_estimated_token_cap: 6000,
  per_request_estimated_cost_cap_usd: 0.25,
};

const WARNING_RATIO = 0.8;

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function parseNonNegativeNumber(value: string | undefined, fallback: number) {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseEnforcementMode(value: string | undefined): BudgetGuardEnforcementMode {
  if (value === "disabled" || value === "future_live_guard") return value;
  return "preview_only";
}

function getBudgetCaps(env: NodeJS.ProcessEnv): ProviderBudgetCaps {
  return {
    monthly_budget_cap_usd: parseNonNegativeNumber(
      env.PHANTOM_AI_MONTHLY_BUDGET_USD,
      DEFAULT_BUDGET_CAPS.monthly_budget_cap_usd,
    ),
    daily_budget_cap_usd: parseNonNegativeNumber(
      env.PHANTOM_AI_DAILY_BUDGET_USD,
      DEFAULT_BUDGET_CAPS.daily_budget_cap_usd,
    ),
    per_request_estimated_token_cap: parseNonNegativeNumber(
      env.PHANTOM_AI_REQUEST_TOKEN_CAP,
      DEFAULT_BUDGET_CAPS.per_request_estimated_token_cap,
    ),
    per_request_estimated_cost_cap_usd: parseNonNegativeNumber(
      env.PHANTOM_AI_REQUEST_COST_CAP_USD,
      DEFAULT_BUDGET_CAPS.per_request_estimated_cost_cap_usd,
    ),
  };
}

function getPolicyRequiredBeforeLiveCalls() {
  return [
    "Owner must explicitly enable live provider calls for this local workspace.",
    "A future live guard must enforce budget limits before any provider call can run.",
    "Provider configuration must stay server-side and must not be shown to customers.",
    "Approval execution must exist as a separate reviewed patch before external actions can run.",
    "Browser/runtime proof must show client sessions cannot see provider policy internals.",
  ];
}

export function getProviderBudgetPolicyStatus(env: NodeJS.ProcessEnv = process.env): ProviderBudgetPolicyState {
  const enforcementMode = parseEnforcementMode(env.PHANTOM_AI_BUDGET_ENFORCEMENT_MODE);
  const liveProvidersEnabled = parseBoolean(env.PHANTOM_LIVE_PROVIDERS_ENABLED, false);
  const budgetStatus: BudgetGuardStatus = enforcementMode === "disabled" ? "disabled" : "ok";

  return {
    live_providers_globally_enabled: liveProvidersEnabled,
    managed_provider_mode: "phantomforce_managed_preview",
    byok_status: "planned_not_implemented",
    local_fallback_status: "planned_not_implemented",
    default_route_status: liveProvidersEnabled ? "dry_run_only" : "blocked",
    admin_debug_visibility: "admin_only",
    client_safe_status: "Phantom AI preview is available. Live external AI calls are disabled.",
    no_api_keys_stored: true,
    budget_guard: {
      caps: getBudgetCaps(env),
      enforcement_mode: enforcementMode,
      status: budgetStatus,
      detail:
        enforcementMode === "disabled"
          ? "Budget guard is disabled for preview reads; live calls are still disabled elsewhere."
          : "Budget guard is preview-only. It estimates and blocks in metadata but cannot execute billing or provider calls.",
    },
    required_before_live_calls: getPolicyRequiredBeforeLiveCalls(),
  };
}

function isExternalOrDestructiveAction(actionClassification: ActionPreviewStatus) {
  return (
    actionClassification === "pending_approval" ||
    actionClassification === "blocked" ||
    actionClassification === "destructive" ||
    actionClassification === "live_provider_required"
  );
}

function isLiveProviderRequired(routeCandidate: ProviderRoute, actionClassification: ActionPreviewStatus) {
  return routeCandidate !== "mock" || actionClassification === "live_provider_required";
}

function evaluateBudgetGuard(options: {
  estimatedTokens: number;
  estimatedCostUsd: number | null;
  liveProviderRequired: boolean;
  caps: ProviderBudgetCaps;
  enforcementMode: BudgetGuardEnforcementMode;
}): BudgetGuardPreview {
  const reasons: string[] = [];
  const tokens = Math.max(0, Math.ceil(options.estimatedTokens));
  const cost = options.estimatedCostUsd === null ? null : Math.max(0, options.estimatedCostUsd);

  if (options.enforcementMode === "disabled") {
    return {
      status: "disabled",
      enforcement_mode: options.enforcementMode,
      live_provider_required: options.liveProviderRequired,
      estimated_tokens: tokens,
      estimated_cost_usd: cost,
      monthly_budget_cap_usd: options.caps.monthly_budget_cap_usd,
      daily_budget_cap_usd: options.caps.daily_budget_cap_usd,
      per_request_estimated_token_cap: options.caps.per_request_estimated_token_cap,
      per_request_estimated_cost_cap_usd: options.caps.per_request_estimated_cost_cap_usd,
      reasons: ["Budget guard enforcement is disabled. Live provider calls are still blocked by policy."],
    };
  }

  if (tokens > options.caps.per_request_estimated_token_cap) {
    reasons.push("Estimated tokens exceed the per-request preview cap.");
  }

  if (cost !== null && cost > options.caps.per_request_estimated_cost_cap_usd) {
    reasons.push("Estimated cost exceeds the per-request preview cap.");
  }

  if (reasons.length) {
    return {
      status: "blocked",
      enforcement_mode: options.enforcementMode,
      live_provider_required: options.liveProviderRequired,
      estimated_tokens: tokens,
      estimated_cost_usd: cost,
      monthly_budget_cap_usd: options.caps.monthly_budget_cap_usd,
      daily_budget_cap_usd: options.caps.daily_budget_cap_usd,
      per_request_estimated_token_cap: options.caps.per_request_estimated_token_cap,
      per_request_estimated_cost_cap_usd: options.caps.per_request_estimated_cost_cap_usd,
      reasons,
    };
  }

  if (tokens >= options.caps.per_request_estimated_token_cap * WARNING_RATIO) {
    reasons.push("Estimated tokens are near the per-request preview cap.");
  }

  if (cost !== null && cost >= options.caps.per_request_estimated_cost_cap_usd * WARNING_RATIO) {
    reasons.push("Estimated cost is near the per-request preview cap.");
  }

  if (options.liveProviderRequired && cost === null) {
    reasons.push("Live route preview needs a future cost estimate before any live guard can allow it.");
  }

  return {
    status: reasons.length ? "warning" : "ok",
    enforcement_mode: options.enforcementMode,
    live_provider_required: options.liveProviderRequired,
    estimated_tokens: tokens,
    estimated_cost_usd: cost,
    monthly_budget_cap_usd: options.caps.monthly_budget_cap_usd,
    daily_budget_cap_usd: options.caps.daily_budget_cap_usd,
    per_request_estimated_token_cap: options.caps.per_request_estimated_token_cap,
    per_request_estimated_cost_cap_usd: options.caps.per_request_estimated_cost_cap_usd,
    reasons: reasons.length ? reasons : ["Budget preview is within configured caps."],
  };
}

function getRouteStatus(options: {
  routeCandidate: ProviderRoute;
  liveProvidersEnabled: boolean;
  providerEnabled: boolean;
  budgetStatus: BudgetGuardStatus;
  highSensitivity: boolean;
  externalOrDestructiveAction: boolean;
}): ProviderRoutePolicyStatus {
  if (options.budgetStatus === "blocked" || options.highSensitivity || options.externalOrDestructiveAction) {
    return "blocked";
  }

  if (!options.liveProvidersEnabled) {
    return options.routeCandidate === "mock" ? "dry_run_only" : "blocked";
  }

  if (options.routeCandidate !== "mock" && !options.providerEnabled) {
    return "blocked";
  }

  return "dry_run_only";
}

function getPolicyStatus(options: {
  routeStatus: ProviderRoutePolicyStatus;
  liveProvidersEnabled: boolean;
  budgetStatus: BudgetGuardStatus;
}): ProviderPolicyStatus {
  if (options.budgetStatus === "blocked") return "budget_blocked";
  if (!options.liveProvidersEnabled) return "live_disabled";
  if (options.routeStatus === "blocked") return "blocked";
  return "dry_run_only";
}

function getDisabledReason(options: {
  routeStatus: ProviderRoutePolicyStatus;
  policyStatus: ProviderPolicyStatus;
  routeCandidate: ProviderRoute;
  providerEnabled: boolean;
  budgetReasons: string[];
}) {
  if (options.policyStatus === "budget_blocked") {
    return `Budget guard blocked this preview: ${options.budgetReasons.join(" ")}`;
  }

  if (options.routeStatus === "blocked" && options.routeCandidate !== "mock" && !options.providerEnabled) {
    return "The selected route is not configured for safe local preview and cannot run.";
  }

  if (options.policyStatus === "live_disabled") {
    return "Live provider calls are globally disabled for this local preview.";
  }

  return "Provider policy is dry-run-only. Route selection can be previewed, but no live call can run.";
}

export function evaluateProviderBudgetPolicy(
  input: ProviderPolicyEvaluationInput,
  options: { env?: NodeJS.ProcessEnv } = {},
): ProviderPolicyEvaluationResult {
  const policy = getProviderBudgetPolicyStatus(options.env ?? process.env);
  const liveProviderRequired = isLiveProviderRequired(input.route_candidate, input.action_classification);
  const externalOrDestructiveAction = isExternalOrDestructiveAction(input.action_classification);
  const highSensitivity = input.sensitivity_level === "high";
  const budget = evaluateBudgetGuard({
    estimatedTokens: input.estimated_tokens,
    estimatedCostUsd: input.estimated_cost_usd,
    liveProviderRequired,
    caps: policy.budget_guard.caps,
    enforcementMode: policy.budget_guard.enforcement_mode,
  });
  const routeStatus = getRouteStatus({
    routeCandidate: input.route_candidate,
    liveProvidersEnabled: policy.live_providers_globally_enabled,
    providerEnabled: input.provider_enabled,
    budgetStatus: budget.status,
    highSensitivity,
    externalOrDestructiveAction,
  });
  const policyStatus = getPolicyStatus({
    routeStatus,
    liveProvidersEnabled: policy.live_providers_globally_enabled,
    budgetStatus: budget.status,
  });
  const approvalRequired = input.approval_required || externalOrDestructiveAction || highSensitivity;
  const liveCallDisabledReason = getDisabledReason({
    routeStatus,
    policyStatus,
    routeCandidate: input.route_candidate,
    providerEnabled: input.provider_enabled,
    budgetReasons: budget.reasons,
  });

  return {
    route_candidate: input.route_candidate,
    route_status: routeStatus,
    route_allowed: false,
    policy_status: policyStatus,
    approval_required: approvalRequired,
    live_call_disabled_reason: redactPersonalDataText(liveCallDisabledReason),
    client_safe_summary: "Phantom AI can preview this safely, but no live action or external AI call will run.",
    admin_debug_summary: redactPersonalDataText(
      `Route ${input.route_candidate} is ${routeStatus}; policy ${policyStatus}; budget ${budget.status}.`,
    ),
    required_before_live_calls: policy.required_before_live_calls.map((item) => redactPersonalDataText(item)),
    policy,
    budget: {
      ...budget,
      reasons: budget.reasons.map((reason) => redactPersonalDataText(reason)),
    },
    safety_flags: {
      live_providers_globally_disabled: !policy.live_providers_globally_enabled,
      live_provider_call_allowed: false,
      route_execution_allowed: false,
      dry_run_only: true,
      managed_provider_preview_only: true,
      byok_not_implemented: policy.byok_status === "planned_not_implemented",
      local_fallback_not_implemented: policy.local_fallback_status === "planned_not_implemented",
      budget_enforcement_preview_only: policy.budget_guard.enforcement_mode === "preview_only",
      secrets_stored: false,
      approval_gate_required: approvalRequired,
      high_sensitivity: highSensitivity,
      destructive_or_external_action: externalOrDestructiveAction,
    },
  };
}
