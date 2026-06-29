export type ActorRole = "platform_admin" | "business_owner" | "employee" | "client";
export type SensitivityLevel = "low" | "medium" | "high";
export type ProviderRoute = "mock" | "openrouter_glm" | "claude" | "local" | "router";
export type ModelRouterMode = "mock" | "openrouter" | "claude" | "local" | "router";
export type ApprovalStatus = "not_required" | "pending" | "approved" | "rejected" | "blocked";

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

export type ModelRouterRunResult = {
  decision: ModelRouterDecision;
  context_packet: HermesContextPacket;
  ledger_record: HermesLedgerRecord;
};
