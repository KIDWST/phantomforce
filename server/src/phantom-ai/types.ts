export type ActorRole = "platform_admin" | "business_owner" | "employee" | "client";
export type SensitivityLevel = "low" | "medium" | "high";
export type ProviderRoute = "mock" | "openrouter_glm" | "claude" | "local" | "router";
export type ModelRouterMode = "mock" | "openrouter" | "claude" | "local" | "router";
export type ApprovalStatus = "not_required" | "pending" | "approved" | "rejected" | "blocked";
export type ActionPreviewStatus = "safe" | "pending_approval" | "blocked" | "destructive" | "live_provider_required";
export type ApprovalRequestStatus = "preview-only" | "pending" | "blocked" | "approved" | "rejected" | "expired";
export type ApprovalRiskLevel = "low" | "medium" | "high" | "critical";
export type ApprovalQueueStatus = "pending" | "blocked_preview" | "preview_only";
export type ApprovalQueueReviewStatus = "unreviewed" | "reviewed" | "dismissed" | "needs_changes" | "expired" | "note_added";
export type ApprovalQueueTransitionStatus = Exclude<ApprovalQueueReviewStatus, "unreviewed">;
export type ProviderRoutePolicyStatus = "allowed" | "blocked" | "dry_run_only";
export type ProviderPolicyStatus = "live_disabled" | "dry_run_only" | "budget_blocked" | "blocked";
export type ProviderPolicyFeatureStatus = "enabled" | "disabled" | "planned_not_implemented";
export type BudgetGuardStatus = "ok" | "warning" | "blocked" | "disabled";
export type BudgetGuardEnforcementMode = "preview_only" | "disabled" | "future_live_guard";

export type HermesLedgerRecord = {
  timestamp: string;
  tenant_id: string;
  business_name: string;
  actor_user_id: string;
  actor_role: ActorRole;
  request_id: string;
  task_type: string;
  sensitivity_level: SensitivityLevel;
  provider_route: ProviderRoute;
  model_id: string;
  context_chars: number;
  estimated_tokens: number;
  estimated_cost_usd: number | null;
  user_request_summary: string;
  result_summary: string;
  approval_required: boolean;
  approval_status: ApprovalStatus;
  risks: string[];
  next_action: string;
  agent_run_id?: string;
  parent_task_id?: string;
};

export type ContextModuleData = {
  module: string;
  summary: string;
  items?: Array<{
    title: string;
    status?: string;
    detail?: string;
  }>;
};

export type ContextCompilerInput = {
  tenant_id: string;
  business_name: string;
  request_id: string;
  task_type: string;
  sensitivity_level: SensitivityLevel;
  provider_route: ProviderRoute;
  user_request: string;
  business_summary: string;
  module_data: ContextModuleData[];
  relevant_rules: string[];
  approval_restrictions: string[];
  max_chars?: number;
};

export type HermesContextPacket = {
  tenant_id: string;
  business_name: string;
  request_id: string;
  task_type: string;
  sensitivity_level: SensitivityLevel;
  provider_route: ProviderRoute;
  user_request_summary: string;
  compact_context: string;
  context_chars: number;
  estimated_tokens: number;
  raw_context_chars: number;
  compression_ratio: number;
};

export type ProviderSetupStatus = {
  router_mode: ModelRouterMode;
  phantomforce_managed: {
    status: "recommended";
    detail: string;
  };
  openrouter_glm: {
    configured: boolean;
    status: "Configured" | "Not Configured";
    model_id: string;
    setup_required: boolean;
    payment_setup_needed: boolean;
    detail: string;
  };
  claude_api: {
    configured: boolean;
    status: "Configured" | "Not Configured";
    detail: string;
  };
  local_fallback: {
    available: boolean;
    status: "Available" | "Not Available";
    detail: string;
  };
  byok: {
    enabled: boolean;
    status: "Disabled" | "Future";
    detail: string;
  };
  budget: {
    status: "Planned / Not Enforced" | "Enforced";
    default_tenant_budget_usd: number | null;
    detail: string;
  };
  hermes: {
    ledger_enabled: boolean;
    context_compiler_enabled: boolean;
    ledger_path: string;
    ledger_exists?: boolean;
    ledger_bytes?: number;
    status: "Ledger Enabled / Context Compiler Enabled" | "Stub";
  };
  phantom_plus: {
    status: "Planned";
    detail: string;
    agent_loop_status: "Not Implemented";
  };
};

export type ProviderBudgetCaps = {
  monthly_budget_cap_usd: number;
  daily_budget_cap_usd: number;
  per_request_estimated_token_cap: number;
  per_request_estimated_cost_cap_usd: number;
};

export type ProviderBudgetPolicyState = {
  live_providers_globally_enabled: boolean;
  managed_provider_mode: "phantomforce_managed_preview";
  byok_status: ProviderPolicyFeatureStatus;
  local_fallback_status: ProviderPolicyFeatureStatus;
  default_route_status: ProviderRoutePolicyStatus;
  admin_debug_visibility: "admin_only";
  client_safe_status: string;
  no_api_keys_stored: true;
  budget_guard: {
    caps: ProviderBudgetCaps;
    enforcement_mode: BudgetGuardEnforcementMode;
    status: BudgetGuardStatus;
    detail: string;
  };
  required_before_live_calls: string[];
};

export type BudgetGuardPreview = {
  status: BudgetGuardStatus;
  enforcement_mode: BudgetGuardEnforcementMode;
  live_provider_required: boolean;
  estimated_tokens: number;
  estimated_cost_usd: number | null;
  monthly_budget_cap_usd: number;
  daily_budget_cap_usd: number;
  per_request_estimated_token_cap: number;
  per_request_estimated_cost_cap_usd: number;
  reasons: string[];
};

export type ProviderPolicyEvaluationInput = {
  route_candidate: ProviderRoute;
  sensitivity_level: SensitivityLevel;
  action_classification: ActionPreviewStatus;
  estimated_tokens: number;
  estimated_cost_usd: number | null;
  approval_required: boolean;
  provider_enabled: boolean;
};

export type ProviderPolicyEvaluationResult = {
  route_candidate: ProviderRoute;
  route_status: ProviderRoutePolicyStatus;
  route_allowed: false;
  policy_status: ProviderPolicyStatus;
  approval_required: boolean;
  live_call_disabled_reason: string;
  client_safe_summary: string;
  admin_debug_summary: string;
  required_before_live_calls: string[];
  policy: ProviderBudgetPolicyState;
  budget: BudgetGuardPreview;
  safety_flags: {
    live_providers_globally_disabled: boolean;
    live_provider_call_allowed: false;
    route_execution_allowed: false;
    dry_run_only: true;
    managed_provider_preview_only: true;
    byok_not_implemented: boolean;
    local_fallback_not_implemented: boolean;
    budget_enforcement_preview_only: boolean;
    secrets_stored: false;
    approval_gate_required: boolean;
    high_sensitivity: boolean;
    destructive_or_external_action: boolean;
  };
};

export type ProviderReadinessRouteId = "mock" | "openrouter_glm" | "claude" | "local" | "byok";
export type ProviderReadinessRouteStatus = "configured" | "needs_config" | "disabled";
export type ProviderReadinessKeySource = "env" | "vault_planned" | "managed_planned" | "none";

export type ProviderReadinessRoute = {
  id: ProviderReadinessRouteId;
  label: string;
  client_safe_label: string;
  client_safe_status: string;
  configured: boolean;
  enabled: false;
  status: ProviderReadinessRouteStatus;
  key_source: ProviderReadinessKeySource;
  key_present: boolean;
  key_preview: string;
  model_id: string | null;
  setup_required: boolean;
  disabled_reason: string;
  required_before_live: string[];
  last_checked_at: string;
  live_call_allowed: false;
  is_default_safe_route: boolean;
  missing: string[];
  detail: string;
  safety_flags: {
    live_calls_allowed: false;
    raw_secret_exposed: false;
    secret_stored: false;
    network_check_performed: false;
    admin_only: true;
    readiness_only: true;
  };
};

export type ProviderReadinessReport = {
  checked_at: string;
  router_mode: ModelRouterMode;
  live_providers_globally_enabled: boolean;
  production_ready: false;
  any_live_route_configured: boolean;
  recommended_route: "mock";
  routes: ProviderReadinessRoute[];
  required_before_live: string[];
  client_safe_summary: string;
  admin_debug_summary: string;
  safety_flags: {
    live_provider_call_allowed: false;
    execution_disabled: true;
    dry_run_only: true;
    secrets_stored: false;
    admin_only: true;
    not_production: true;
  };
};

export type ModelRouterRequest = {
  tenant_id: string;
  business_name: string;
  actor_user_id: string;
  actor_role: ActorRole;
  request_id: string;
  task_type: string;
  user_request: string;
  business_summary: string;
  module_data: ContextModuleData[];
  relevant_rules?: string[];
  approval_restrictions?: string[];
  sensitivity_level?: SensitivityLevel;
  agent_run_id?: string;
  parent_task_id?: string;
};

export type ModelRouterDecision = {
  provider_route: ProviderRoute;
  model_id: string;
  sensitivity_level: SensitivityLevel;
  approval_required: boolean;
  approval_status: ApprovalStatus;
  risks: string[];
  next_action: string;
  estimated_cost_usd: number | null;
};

export type ActionPreview = {
  status: ActionPreviewStatus;
  label: string;
  approval_required: boolean;
  live_execution_allowed: false;
  safe_for_preview: boolean;
  reasons: string[];
  next_action: string;
};

export type ApprovalRequestPreview = {
  approval_id: string;
  action_type: string;
  risk_level: ApprovalRiskLevel;
  status: ApprovalRequestStatus;
  summary: string;
  approval_reason: string;
  requested_by: {
    actor_user_id: string;
    actor_role: ActorRole;
  };
  tenant_context: {
    tenant_id: string;
    business_name: string;
    request_id: string;
  };
  created_at: string;
  expires_at: string | null;
  estimated_impact: {
    provider_route: ProviderRoute;
    model_id: string;
    estimated_tokens: number;
    estimated_cost_usd: number | null;
    budget_status: BudgetGuardStatus | "not_enforced";
  };
  redacted_context_preview: string;
  safety_flags: {
    dry_run: true;
    execution_disabled: true;
    approval_execution_implemented: false;
    live_provider_call_allowed: false;
    ledger_write_allowed: false;
    secrets_redacted: true;
    destructive_action: boolean;
    live_provider_required: boolean;
    high_sensitivity: boolean;
  };
  execution_disabled: true;
};

export type ApprovalQueueRecord = {
  queue_id: string;
  queued_at: string;
  queue_status: ApprovalQueueStatus;
  source: "admin-preview";
  approval: ApprovalRequestPreview;
  execution_disabled: true;
  queue_safety: {
    local_file_only: true;
    redacted: true;
    approval_execution_implemented: false;
    live_action_allowed: false;
    ledger_write_allowed: false;
  };
};

export type ApprovalQueueTransitionRecord = {
  transition_id: string;
  queue_id: string;
  from_status: ApprovalQueueReviewStatus;
  to_status: ApprovalQueueTransitionStatus;
  requested_by: {
    actor_user_id: string;
    actor_role: ActorRole;
  };
  timestamp: string;
  note: string;
  execution_disabled: true;
  safety_flags: {
    local_file_only: true;
    redacted: true;
    status_only: true;
    approval_execution_implemented: false;
    live_action_allowed: false;
    ledger_write_allowed: false;
  };
};

export type ApprovalQueueRecordWithTransitions = ApprovalQueueRecord & {
  latest_review_status: ApprovalQueueReviewStatus;
  transition_count: number;
  latest_transition_at: string | null;
  latest_transition: ApprovalQueueTransitionRecord | null;
};

export type ApprovalQueueTransitionWriteResult = {
  transitioned: boolean;
  transition: ApprovalQueueTransitionRecord;
  record: ApprovalQueueRecordWithTransitions;
};

export type ApprovalQueueWriteResult = {
  queued: boolean;
  reason: "queued" | "preview_only_not_queued" | "queue_not_requested";
  record: ApprovalQueueRecord | null;
};

export type ProviderInvocationFirewallInput = {
  requested_provider_id: string;
  requested_route: ProviderRoute;
  requested_model_id: string;
  redacted_context_summary: string;
  estimated_tokens: number;
  estimated_cost_usd: number | null;
  action_classification: ActionPreviewStatus;
  approval_request: ApprovalRequestPreview;
  policy_result: ProviderPolicyEvaluationResult;
  readiness_result: ProviderReadinessReport;
};

export type ProviderInvocationFirewallResult = {
  invocation_id: string;
  status: "blocked";
  requested_provider_id: string;
  requested_route: ProviderRoute;
  requested_model_id: string;
  redacted_context_summary: string;
  estimated_tokens: number;
  estimated_cost_usd: number | null;
  action_classification: ActionPreviewStatus;
  policy_result: ProviderPolicyEvaluationResult;
  readiness_result: ProviderReadinessReport;
  readiness_route: ProviderReadinessRoute | null;
  approval_requirement: {
    approval_required: boolean;
    approval_status: ApprovalRequestStatus;
    risk_level: ApprovalRiskLevel;
    reason: string;
  };
  live_call_allowed: false;
  execution_disabled: true;
  blocked_reason: string;
  blocked_reasons: string[];
  required_before_live: string[];
  dry_run_result: {
    provider_called: false;
    network_call_performed: false;
    output_text: string;
    ledger_written: false;
    queue_written: false;
    approval_executed: false;
  };
  client_safe_summary: string;
  admin_debug_summary: string;
  safety_flags: {
    live_call_allowed: false;
    execution_disabled: true;
    provider_called: false;
    network_call_performed: false;
    route_allowed: false;
    readiness_configured: boolean;
    readiness_live_call_allowed: false;
    approval_required: boolean;
    approval_execution_implemented: false;
    raw_secret_exposed: false;
    raw_context_stored: false;
    raw_context_returned: false;
    secrets_stored: false;
    ledger_written: false;
    queue_written: false;
    dry_run_only: true;
    admin_only: true;
  };
};

export type ModelRouterPreviewResult = {
  decision: ModelRouterDecision;
  context_packet: HermesContextPacket;
  action_preview: ActionPreview;
  approval_request: ApprovalRequestPreview;
  provider_policy: ProviderPolicyEvaluationResult;
  provider_invocation: ProviderInvocationFirewallResult;
  dry_run: true;
  ledger_written: false;
  live_provider_called: false;
};

export type ModelRouterRunResult = {
  decision: ModelRouterDecision;
  context_packet: HermesContextPacket;
  action_preview: ActionPreview;
  approval_request: ApprovalRequestPreview;
  provider_policy: ProviderPolicyEvaluationResult;
  provider_invocation: ProviderInvocationFirewallResult;
  ledger_record: HermesLedgerRecord;
};
