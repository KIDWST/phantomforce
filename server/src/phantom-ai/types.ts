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

export type ProviderBudgetHardGateReason =
  | "cap_missing"
  | "payment_not_confirmed"
  | "budget_exceeded"
  | "budget_not_approved"
  | "cost_estimate_missing"
  | "approval_execution_missing";

export type ProviderFundingApprovalState = "missing" | "unfunded" | "funded";
export type ProviderBudgetApprovalState = "missing" | "not_approved" | "approved";
export type ProviderFundingApprovalContractStatus = "blocked" | "preflight_allowed_transport_disabled";
export type ProviderFundingApprovalBlockedReason =
  | "funding_record_missing"
  | "funding_not_confirmed"
  | "budget_approval_missing"
  | "cost_estimate_missing"
  | "estimated_cost_exceeds_cap"
  | "daily_cap_exceeded"
  | "monthly_cap_exceeded";

export type ProviderFundingRecordContract = {
  funding_id: string;
  tenant_id: string;
  provider_id: string;
  model_id: string;
  funding_state: ProviderFundingApprovalState;
  funded_budget_cap_usd: number | null;
  current_daily_spend_usd: number;
  current_monthly_spend_usd: number;
  source: "missing" | "admin_contract_preview";
  local_dev_only: true;
  payment_collected: false;
};

export type ProviderBudgetApprovalRecordContract = {
  approval_id: string;
  tenant_id: string;
  provider_id: string;
  model_id: string;
  approval_state: ProviderBudgetApprovalState;
  approved_budget_cap_usd: number | null;
  approved_by: string | null;
  approved_at: string | null;
  local_dev_only: true;
  approval_execution_implemented: false;
};

export type ProviderFundingApprovalContractInput = {
  tenant_id: string;
  business_name: string;
  provider_id: string;
  model_id: string;
  estimated_tokens: number;
  estimated_cost_usd: number | null;
  budget_caps: ProviderBudgetCaps | null;
  funding_record: ProviderFundingRecordContract | null;
  approval_record: ProviderBudgetApprovalRecordContract | null;
  checked_at?: string;
};

export type ProviderFundingApprovalContract = {
  contract_id: string;
  checked_at: string;
  status: ProviderFundingApprovalContractStatus;
  tenant_id: string;
  business_name: string;
  provider_id: string;
  model_id: string;
  estimated_tokens: number;
  estimated_cost_usd: number | null;
  funding_record_present: boolean;
  explicit_funded_budget_state: boolean;
  explicit_budget_approval_state: boolean;
  funding_state: ProviderFundingApprovalState;
  approval_state: ProviderBudgetApprovalState;
  effective_per_request_cap_usd: number | null;
  current_daily_spend_usd: number;
  current_monthly_spend_usd: number;
  funding_preflight_allowed: boolean;
  provider_transport_allowed: false;
  live_call_allowed: false;
  execution_disabled: true;
  ready_for_send: false;
  blocked_reasons: ProviderFundingApprovalBlockedReason[];
  blocked_reason_details: string[];
  required_before_transport: string[];
  funding_record: ProviderFundingRecordContract | null;
  approval_record: ProviderBudgetApprovalRecordContract | null;
  machine_check: {
    required_before_provider_transport: true;
    required_contract_status_before_transport: "preflight_allowed_transport_disabled";
    current_status: ProviderFundingApprovalContractStatus;
    transport_must_reference_contract_id: string;
    bypass_allowed: false;
    transport_still_disabled_after_preflight: true;
    failure_code: "provider_funding_approval_blocked" | "provider_transport_not_implemented";
  };
  client_safe_summary: string;
  admin_debug_summary: string;
  safety_flags: {
    admin_only: true;
    contract_only: true;
    funding_preflight_allowed: boolean;
    provider_transport_allowed: false;
    live_call_allowed: false;
    provider_called: false;
    network_call_performed: false;
    payment_collected: false;
    payment_setup_started: false;
    billing_launched: false;
    approval_execution_implemented: false;
    queue_execution_implemented: false;
    production_ledger_written: false;
    request_body_prepared: false;
    ready_for_send: false;
    raw_secret_exposed: false;
  };
};

export type ProviderBudgetHardGateInput = {
  tenant_id: string;
  business_name: string;
  provider_id: string;
  model_id: string;
  estimated_tokens: number;
  estimated_cost_usd: number | null;
  current_daily_spend_usd?: number;
  current_monthly_spend_usd?: number;
  budget_caps: ProviderBudgetCaps | null;
  payment_status: "unknown" | "unpaid" | "paid";
  budget_approved: boolean;
  approval_status: ApprovalRequestStatus;
  checked_at?: string;
};

export type ProviderBudgetHardGateContract = {
  gate_id: string;
  checked_at: string;
  status: "blocked";
  tenant_id: string;
  business_name: string;
  provider_id: string;
  model_id: string;
  route_allowed: false;
  live_call_allowed: false;
  hard_gate_passed: false;
  estimated_tokens: number;
  estimated_cost_usd: number | null;
  current_daily_spend_usd: number;
  current_monthly_spend_usd: number;
  budget_caps: ProviderBudgetCaps | null;
  payment_status: "unknown" | "unpaid" | "paid";
  budget_approved: boolean;
  approval_status: ApprovalRequestStatus;
  funding_approval_contract: ProviderFundingApprovalContract;
  blocked_reasons: ProviderBudgetHardGateReason[];
  blocked_reason_details: string[];
  required_before_transport: string[];
  machine_check: {
    required_before_provider_transport: true;
    required_status_before_transport: "pass";
    current_status: "blocked";
    bypass_allowed: false;
    transport_must_reference_gate_id: string;
    failure_code: "provider_budget_hard_gate_blocked";
  };
  client_safe_summary: string;
  admin_debug_summary: string;
  safety_flags: {
    admin_only: true;
    hard_gate: true;
    contract_only: true;
    route_allowed: false;
    live_call_allowed: false;
    provider_called: false;
    network_call_performed: false;
    payment_collected: false;
    payment_setup_started: false;
    billing_launched: false;
    approval_execution_implemented: false;
    raw_secret_exposed: false;
  };
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

export type LiveSmokePreflightGateStatus = "pass" | "blocked" | "not_implemented";

export type LiveSmokePreflightReport = {
  preflight_id: string;
  checked_at: string;
  provider_route: ProviderRoute;
  model_id: string;
  status: "blocked";
  live_smoke_allowed: false;
  execution_disabled: true;
  provider_called: false;
  network_call_performed: false;
  ledger_written: false;
  queue_written: false;
  approval_executed: false;
  live_smoke_test_explicitly_approved: false;
  budget_gate: {
    status: LiveSmokePreflightGateStatus;
    ready_for_live: false;
    enforcement_mode: BudgetGuardEnforcementMode;
    budget_status: BudgetGuardStatus;
    policy_route_allowed: false;
    estimated_tokens: number;
    estimated_cost_usd: number | null;
    monthly_budget_cap_usd: number;
    daily_budget_cap_usd: number;
    per_request_estimated_token_cap: number;
    per_request_estimated_cost_cap_usd: number;
    reasons: string[];
  };
  ledger_gate: {
    status: LiveSmokePreflightGateStatus;
    ready_for_live: false;
    ledger_enabled: boolean;
    ledger_exists: boolean;
    ledger_bytes: number;
    ledger_path: string;
    live_request_record_required: true;
    live_response_record_required: true;
    redacted_record_required: true;
    preflight_write_performed: false;
    reason: string;
  };
  redaction_gate: {
    status: LiveSmokePreflightGateStatus;
    obvious_secret_redaction_passed: boolean;
    request_redaction_required: true;
    response_redaction_required: true;
    raw_probe_returned: boolean;
    raw_secret_returned: boolean;
    ready_for_live_transport: false;
    reason: string;
  };
  approval_execution_gate: {
    status: LiveSmokePreflightGateStatus;
    approval_execution_implemented: false;
    execute_endpoint_expected_status: 404;
    status_transitions_only: true;
    live_action_allowed: false;
    reason: string;
  };
  transport_gate: {
    status: LiveSmokePreflightGateStatus;
    ready_for_live_transport: false;
    live_transport_configured: false;
    live_transport_enabled: false;
    firewall_permits_call: false;
    dry_run_envelope_ready_for_send: false;
    network_payload_prepared: false;
    reason: string;
  };
  required_before_live_smoke_test: string[];
  admin_debug_summary: string;
  client_safe_summary: string;
  safety_flags: {
    admin_only: true;
    dry_run_only: true;
    live_smoke_allowed: false;
    live_provider_call_allowed: false;
    execution_disabled: true;
    provider_called: false;
    network_call_performed: false;
    ledger_written: false;
    queue_written: false;
    approval_executed: false;
    raw_secret_exposed: false;
    raw_prompt_returned: false;
    raw_response_stored: false;
  };
};

export type OpenRouterGlmTransportContract = {
  provider_id: "openrouter_glm";
  model_id: "z-ai/glm-5.2";
  contract_status: "disabled_contract_only";
  endpoint: "https://openrouter.ai/api/v1/chat/completions";
  method: "POST";
  auth_header_required: true;
  auth_header_preview: "Authorization: Bearer [redacted]";
  content_type: "application/json";
  optional_headers: {
    http_referer: "planned_admin_config_only";
    x_title: "planned_admin_config_only";
  };
  request_body_shape: {
    model: "z-ai/glm-5.2";
    messages: "redacted_messages_required";
    temperature: "optional_number";
    max_tokens: "optional_number";
  };
  response_body_shape: {
    choices: "provider_response_choices";
    usage: "provider_usage_metadata";
  };
  transport_enabled: false;
  live_call_allowed: false;
  network_client_implemented: false;
  request_body_prepared: false;
  ready_for_send: false;
  provider_called: false;
  network_call_performed: false;
  raw_api_key_returned: false;
  raw_prompt_returned: false;
  raw_response_stored: false;
  payment_required_before_live: true;
  payment_instruction_status: "not_requested";
  payment_instruction: "Do not fund OpenRouter yet; finish budget, Hermes receipts, redaction, approval execution, and smoke approval first.";
  required_before_enable: string[];
  admin_debug_summary: string;
  client_safe_summary: string;
  safety_flags: {
    admin_only: true;
    contract_only: true;
    live_call_allowed: false;
    network_client_implemented: false;
    provider_called: false;
    raw_secret_exposed: false;
    request_body_prepared: false;
    ready_for_send: false;
    payment_not_requested: true;
  };
};

export type HermesLiveCallReceiptProviderMetadata = {
  provider_id: "openrouter_glm";
  provider_name: "OpenRouter";
  model_id: "z-ai/glm-5.2";
};

export type HermesLiveCallReceiptEndpointLinkage = {
  endpoint: OpenRouterGlmTransportContract["endpoint"];
  method: OpenRouterGlmTransportContract["method"];
  transport_contract_status: OpenRouterGlmTransportContract["contract_status"];
  transport_enabled: false;
  network_client_implemented: false;
};

export type HermesLiveCallReceiptGateLinkage = {
  live_smoke_preflight_id: string;
  live_smoke_preflight_status: LiveSmokePreflightReport["status"];
  live_smoke_allowed: false;
  budget_gate_status: LiveSmokePreflightGateStatus;
  budget_policy_route_allowed: false;
  approval_gate_status: LiveSmokePreflightGateStatus;
  approval_execution_implemented: false;
  approval_id: string;
  approval_status: ApprovalRequestStatus;
};

export type HermesLiveCallRedactionProofFlags = {
  fake_api_key_redacted: boolean;
  fake_token_redacted: boolean;
  fake_card_redacted: boolean;
  fake_prompt_redacted: boolean;
  raw_api_key_returned: false;
  raw_token_returned: false;
  raw_card_returned: false;
  raw_prompt_returned: false;
  request_redaction_required: true;
  response_redaction_required: true;
  response_redaction_contract_only: true;
};

export type HermesLiveCallReceiptBlockedBooleans = {
  providerCalled: false;
  networkCallPerformed: false;
  ledgerWritten: false;
  queueWritten: false;
  approvalExecuted: false;
  readyForSend: false;
};

export type HermesLiveCallRequestReceiptContract = HermesLiveCallReceiptBlockedBooleans & {
  receipt_id: string;
  correlation_id: string;
  receipt_kind: "redacted_provider_request";
  contract_status: "contract_only_blocked";
  created_at: string;
  provider: HermesLiveCallReceiptProviderMetadata;
  endpoint_contract: HermesLiveCallReceiptEndpointLinkage;
  gate_linkage: HermesLiveCallReceiptGateLinkage;
  redaction: HermesLiveCallRedactionProofFlags;
  redacted_request_summary: string;
  redacted_context_preview: string;
  request_payload_prepared: false;
  request_body_ready_for_send: false;
  raw_prompt_stored: false;
  raw_api_key_stored: false;
  ledger_append_required_before_live: true;
  ledger_append_performed: false;
};

export type HermesLiveCallResponseReceiptContract = HermesLiveCallReceiptBlockedBooleans & {
  receipt_id: string;
  correlation_id: string;
  receipt_kind: "redacted_provider_response";
  contract_status: "contract_only_blocked";
  created_at: string;
  provider: HermesLiveCallReceiptProviderMetadata;
  endpoint_contract: HermesLiveCallReceiptEndpointLinkage;
  gate_linkage: HermesLiveCallReceiptGateLinkage;
  redaction: HermesLiveCallRedactionProofFlags;
  response_status: "not_called";
  redacted_response_summary: string;
  raw_response_stored: false;
  provider_usage_recorded: false;
  ledger_append_required_before_live: true;
  ledger_append_performed: false;
};

export type HermesLiveCallReceiptContract = HermesLiveCallReceiptBlockedBooleans & {
  contract_id: string;
  correlation_id: string;
  status: "blocked_contract_only";
  created_at: string;
  provider: HermesLiveCallReceiptProviderMetadata;
  endpoint_contract: HermesLiveCallReceiptEndpointLinkage;
  live_smoke_preflight_id: string;
  budget_gate_status: LiveSmokePreflightGateStatus;
  approval_gate_status: LiveSmokePreflightGateStatus;
  request_receipt: HermesLiveCallRequestReceiptContract;
  response_receipt: HermesLiveCallResponseReceiptContract;
  redaction: HermesLiveCallRedactionProofFlags;
  ledger_write_mode: "not_written_contract_only";
  queue_write_mode: "not_written_contract_only";
  approval_execution_mode: "not_implemented";
  required_before_live: string[];
  admin_debug_summary: string;
  client_safe_summary: string;
  safety_flags: {
    admin_only: true;
    contract_only: true;
    provider_called: false;
    network_call_performed: false;
    ledger_written: false;
    queue_written: false;
    approval_executed: false;
    ready_for_send: false;
    raw_secret_exposed: false;
    raw_prompt_returned: false;
    raw_response_stored: false;
  };
};

export type HermesLiveCallReceiptPersistedRecord = HermesLiveCallReceiptBlockedBooleans & {
  record_id: string;
  persisted_at: string;
  store_kind: "local_dev_only_receipt_store";
  store_version: 1;
  contract_id: string;
  correlation_id: string;
  provider: HermesLiveCallReceiptProviderMetadata;
  endpoint_contract: HermesLiveCallReceiptEndpointLinkage;
  live_smoke_preflight_id: string;
  budget_gate_status: LiveSmokePreflightGateStatus;
  approval_gate_status: LiveSmokePreflightGateStatus;
  request_receipt: HermesLiveCallRequestReceiptContract;
  response_receipt: HermesLiveCallResponseReceiptContract;
  redaction: HermesLiveCallRedactionProofFlags;
  ledger_write_mode: "not_written_receipt_store_only";
  queue_write_mode: "not_written_receipt_store_only";
  approval_execution_mode: "not_implemented";
  receipt_store_written: true;
  external_ledger_written: false;
  production_ledger_written: false;
  production_write_allowed: false;
  local_dev_only: true;
  safety_flags: {
    local_file_only: true;
    redacted: true;
    provider_called: false;
    network_call_performed: false;
    request_body_prepared: false;
    ready_for_send: false;
    ledger_written: false;
    queue_written: false;
    approval_executed: false;
    production_write_allowed: false;
    raw_secret_exposed: false;
  };
};

export type HermesLiveCallReceiptPersistenceResult = {
  persisted: boolean;
  reason: "persisted_local_dev_only" | "production_write_blocked";
  store_path: string;
  record: HermesLiveCallReceiptPersistedRecord | null;
  providerCalled: false;
  networkCallPerformed: false;
  ledgerWritten: false;
  queueWritten: false;
  approvalExecuted: false;
  readyForSend: false;
  external_ledger_written: false;
  production_ledger_written: false;
  production_write_allowed: false;
};

export type HermesLiveCallReceiptStoreReadResult = {
  store_path: string;
  limit: number;
  records: HermesLiveCallReceiptPersistedRecord[];
  malformed_lines: number;
};

export type ProviderInvocationFirewallInput = {
  requested_provider_id: string;
  requested_route: ProviderRoute;
  requested_model_id: string;
  redacted_context_summary: string;
  estimated_tokens: number;
  estimated_cost_usd: number | null;
  action_classification: ActionPreviewStatus;
  sensitivity_level: SensitivityLevel;
  approval_request: ApprovalRequestPreview;
  policy_result: ProviderPolicyEvaluationResult;
  readiness_result: ProviderReadinessReport;
};

export type OpenRouterGlmAdapterDryRunResult = {
  provider_id: "openrouter_glm";
  model_id: "z-ai/glm-5.2";
  adapter_status: "blocked_dry_run";
  request_id: string;
  redacted_prompt_summary: string;
  estimated_tokens: number;
  estimated_cost_usd: number | null;
  live_call_allowed: false;
  execution_disabled: true;
  blocked_reason: string;
  required_before_live: string[];
  transport_contract: OpenRouterGlmTransportContract;
  live_transport_readiness: {
    status: "blocked";
    ready_for_live_transport: false;
    live_transport_configured: false;
    live_transport_enabled: false;
    admin_only_mode: true;
    provider_policy_allowed: false;
    readiness_key_present: boolean;
    budget_status_ok: false;
    budget_status: BudgetGuardStatus;
    approval_status_ok: false;
    approval_status: ApprovalRequestStatus;
    firewall_permits_call: false;
    ledger_write_required: true;
    request_redaction_required: true;
    response_redaction_required: true;
    live_smoke_test_explicitly_approved: false;
    blocked_reasons: string[];
    required_before_live_smoke_test: string[];
  };
  dry_run_request_envelope: {
    envelope_id: string;
    provider_id: "openrouter_glm";
    model_id: "z-ai/glm-5.2";
    request_id: string;
    redacted_prompt_summary: string;
    estimated_tokens: number;
    estimated_cost_usd: number | null;
    metadata: {
      route_candidate: ProviderRoute;
      sensitivity_level: SensitivityLevel;
      approval_status: ApprovalRequestStatus;
      budget_status: BudgetGuardStatus;
    };
    dry_run_only: true;
    live_call_allowed: false;
    execution_disabled: true;
    no_live_call_reason: string;
    network_payload_prepared: false;
    ready_for_send: false;
    contains_raw_credential: false;
    contains_raw_env_value: false;
    contains_raw_prompt: false;
  };
  dry_run_response: {
    provider_called: false;
    network_call_performed: false;
    http_request_prepared: false;
    output_text: string;
    raw_response: null;
  };
  admin_debug_summary: string;
  client_safe_summary: string;
  safety_flags: {
    dry_run_only: true;
    live_call_allowed: false;
    execution_disabled: true;
    provider_called: false;
    network_call_performed: false;
    http_request_prepared: false;
    raw_secret_exposed: false;
    raw_prompt_returned: false;
    raw_response_stored: false;
    ledger_written: false;
    queue_written: false;
    approval_executed: false;
    policy_route_allowed: false;
    readiness_live_call_allowed: false;
    admin_only: true;
  };
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
  budget_hard_gate: ProviderBudgetHardGateContract;
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
  openrouter_adapter: OpenRouterGlmAdapterDryRunResult | null;
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
