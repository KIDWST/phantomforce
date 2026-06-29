export type ActorRole = "platform_admin" | "business_owner" | "employee" | "client";
export type SensitivityLevel = "low" | "medium" | "high";
export type ProviderRoute = "mock" | "openrouter_glm" | "claude" | "local" | "router";
export type ModelRouterMode = "mock" | "openrouter" | "claude" | "local" | "router";
export type ApprovalStatus = "not_required" | "pending" | "approved" | "rejected" | "blocked";
export type ActionPreviewStatus = "safe" | "pending_approval" | "blocked" | "destructive" | "live_provider_required";
export type ApprovalRequestStatus = "preview-only" | "pending" | "blocked" | "approved" | "rejected" | "expired";
export type ApprovalRiskLevel = "low" | "medium" | "high" | "critical";
export type ApprovalQueueStatus = "pending" | "blocked_preview" | "preview_only";

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
    budget_status: "not_enforced";
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

export type ApprovalQueueWriteResult = {
  queued: boolean;
  reason: "queued" | "preview_only_not_queued" | "queue_not_requested";
  record: ApprovalQueueRecord | null;
};

export type ModelRouterPreviewResult = {
  decision: ModelRouterDecision;
  context_packet: HermesContextPacket;
  action_preview: ActionPreview;
  approval_request: ApprovalRequestPreview;
  dry_run: true;
  ledger_written: false;
  live_provider_called: false;
};

export type ModelRouterRunResult = {
  decision: ModelRouterDecision;
  context_packet: HermesContextPacket;
  action_preview: ActionPreview;
  approval_request: ApprovalRequestPreview;
  ledger_record: HermesLedgerRecord;
};
