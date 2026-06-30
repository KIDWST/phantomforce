import {
  AlertTriangle,
  ArrowRight,
  Bell,
  Bot,
  CalendarDays,
  Check,
  Clock3,
  Command,
  FileText,
  Inbox,
  KeyRound,
  Link2,
  Lock,
  Mail,
  MessageSquare,
  Play,
  Plus,
  RefreshCcw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  SquareCheckBig,
  ToggleLeft,
  UserRound,
  Users,
  X,
  Zap,
} from "lucide-react";
import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";

type Route =
  | "command"
  | "inbox"
  | "calendar"
  | "tasks"
  | "content"
  | "media"
  | "offers"
  | "approvals"
  | "access"
  | "activity"
  | "connections"
  | "trainer";
type ApprovalKind = "email" | "calendar" | "task";
type ApprovalStatus = "pending" | "approved" | "rejected";
type ActivityLevel = "ok" | "info" | "warn";
type ClientAccessStatus = "active" | "past_due" | "revoked";
type PaymentStatus = "paid" | "due" | "failed";
type MoneyDemoStage = "signed" | "paid" | "past_due" | "revoked" | "restored";
type TruthState = "real" | "demo" | "stub" | "blocked";
type ResultMode = "recommended" | "all";

type EmailItem = {
  id: string;
  from: string;
  subject: string;
  preview: string;
  age: string;
  priority: "high" | "medium" | "low";
  status: "needs-reply" | "waiting" | "handled";
  project: string;
};

type CalendarEvent = {
  id: string;
  title: string;
  time: string;
  owner: string;
  status: "confirmed" | "proposed" | "hold";
};

type TaskItem = {
  id: string;
  title: string;
  owner: string;
  due: string;
  status: "today" | "queued" | "done";
};

type Approval = {
  id: string;
  kind: ApprovalKind;
  title: string;
  summary: string;
  payload: Record<string, string>;
  reversible: boolean;
  status: ApprovalStatus;
};

type ActivityItem = {
  id: string;
  title: string;
  detail: string;
  time: string;
  level: ActivityLevel;
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type Connection = {
  id: string;
  name: string;
  description: string;
  status: "connected" | "ready" | "locked";
  scopes: string[];
};

type TruthLabel = {
  label: string;
  value: string;
  state: TruthState;
  detail: string;
};

type SimulationItem = {
  title: string;
  detail: string;
  status?: string;
};

type ClientAccess = {
  id: string;
  business: string;
  owner: string;
  plan: string;
  paymentStatus: PaymentStatus;
  accessStatus: ClientAccessStatus;
  gateway: "Pangolin";
  privateRoute: string;
  modules: string[];
  lastAudit: string;
};

type GuardedWorkspace = {
  id: string;
  business: string;
  mode: "full" | "read_only" | "blocked";
  modules: string[];
  reason: string;
};

type WorkspaceModuleAction = {
  id: string;
  label: string;
  requiresFullAccess: boolean;
  enabled: boolean;
};

type WorkspaceModuleView = {
  moduleKey: string;
  title: string;
  mode: GuardedWorkspace["mode"];
  writeAccess: boolean;
  summary: string;
  widgets: Array<{
    id: string;
    label: string;
    value: string;
  }>;
  records: Array<{
    id: string;
    title: string;
    status: string;
  }>;
  primaryActions: WorkspaceModuleAction[];
  disabledActions: WorkspaceModuleAction[];
  connector?: {
    id: string;
    provider: string;
    credentialMode: string;
    credentialSource: string;
    credentialRef: string | null;
    workspaceId: string | null;
    scopes: string[];
    status: string;
    readOnly: boolean;
    live: boolean;
    reason: string;
  };
};

type PangolinRoutePlan = {
  clientId: string;
  business: string;
  privateRoute: string;
  gateway: "Pangolin";
  accessStatus: ClientAccessStatus;
  paymentStatus: PaymentStatus;
  desiredState: "enabled" | "read_only" | "disabled";
  mode: GuardedWorkspace["mode"];
  gatewayEnforcement: "allow_route" | "disable_route";
  appEnforcement: GuardedWorkspace["mode"];
  enforcementNote: string;
  modules: string[];
  reason: string;
  liveChangeRequired: boolean;
  liveChangesAllowed: boolean;
};

type PangolinReadOnlyStatus = {
  provider: "Pangolin";
  readOnly: true;
  configured: boolean;
  status: "unconfigured" | "reachable" | "unreachable";
  checkedAt: string;
  baseUrl?: string;
  healthPath?: string;
  httpStatus?: number;
  latencyMs?: number;
  reason: string;
  liveChangesAllowed: false;
};

type ReadinessGate = {
  id: string;
  label: string;
  status: "ready" | "needs_config" | "blocked";
  detail: string;
  evidence: string;
};

type ProductionReadinessReport = {
  checkedAt: string;
  localDemoReady: boolean;
  productionReady: boolean;
  summary: string;
  gates: ReadinessGate[];
};

type ProviderSetupStatus = {
  router_mode: "mock" | "openrouter" | "claude" | "local" | "router";
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

type HermesLedgerRecordPreview = {
  timestamp: string;
  tenant_id: string;
  business_name: string;
  actor_user_id: string;
  actor_role: string;
  request_id: string;
  task_type: string;
  sensitivity_level: string;
  provider_route: string;
  model_id: string;
  context_chars: number;
  estimated_tokens: number;
  estimated_cost_usd: number | null;
  user_request_summary: string;
  result_summary: string;
  approval_required: boolean;
  approval_status: string;
  risks: string[];
  next_action: string;
};

type BudgetGuardStatus = "ok" | "warning" | "blocked" | "disabled";

type ProviderPolicyPreview = {
  route_candidate: string;
  route_status: "allowed" | "blocked" | "dry_run_only";
  route_allowed: boolean;
  policy_status: "live_disabled" | "dry_run_only" | "budget_blocked" | "blocked";
  approval_required: boolean;
  live_call_disabled_reason: string;
  client_safe_summary: string;
  admin_debug_summary: string;
  required_before_live_calls: string[];
  policy: {
    live_providers_globally_enabled: boolean;
    managed_provider_mode: string;
    byok_status: "enabled" | "disabled" | "planned_not_implemented";
    local_fallback_status: "enabled" | "disabled" | "planned_not_implemented";
    default_route_status: "allowed" | "blocked" | "dry_run_only";
    admin_debug_visibility: "admin_only";
    client_safe_status: string;
    no_api_keys_stored: true;
    budget_guard: {
      caps: {
        monthly_budget_cap_usd: number;
        daily_budget_cap_usd: number;
        per_request_estimated_token_cap: number;
        per_request_estimated_cost_cap_usd: number;
      };
      enforcement_mode: "preview_only" | "disabled" | "future_live_guard";
      status: BudgetGuardStatus;
      detail: string;
    };
    required_before_live_calls: string[];
  };
  budget: {
    status: BudgetGuardStatus;
    enforcement_mode: "preview_only" | "disabled" | "future_live_guard";
    live_provider_required: boolean;
    estimated_tokens: number;
    estimated_cost_usd: number | null;
    monthly_budget_cap_usd: number;
    daily_budget_cap_usd: number;
    per_request_estimated_token_cap: number;
    per_request_estimated_cost_cap_usd: number;
    reasons: string[];
  };
  safety_flags: Record<string, boolean>;
};

type ProviderPolicyStatusResponse = {
  policy: ProviderPolicyPreview["policy"];
  preview: ProviderPolicyPreview;
  execution_disabled: boolean;
  live_provider_called: boolean;
  approval_execution_implemented: boolean;
  secrets_stored: boolean;
};

type ProviderReadinessRoute = {
  id: "mock" | "openrouter_glm" | "claude" | "local" | "byok";
  label: string;
  client_safe_label: string;
  client_safe_status: string;
  configured: boolean;
  enabled: false;
  status: "configured" | "needs_config" | "disabled";
  key_source: "env" | "vault_planned" | "managed_planned" | "none";
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
  safety_flags: Record<string, boolean>;
};

type ProviderReadinessReport = {
  checked_at: string;
  router_mode: ProviderSetupStatus["router_mode"];
  live_providers_globally_enabled: boolean;
  production_ready: false;
  any_live_route_configured: boolean;
  recommended_route: "mock";
  routes: ProviderReadinessRoute[];
  required_before_live: string[];
  client_safe_summary: string;
  admin_debug_summary: string;
  safety_flags: Record<string, boolean>;
};

type ProviderReadinessStatusResponse = {
  readiness: ProviderReadinessReport;
  live_provider_called: boolean;
  execution_disabled: boolean;
  secrets_stored: boolean;
};

type OpenRouterGlmAdapterDryRunResult = {
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
  transport_contract: {
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
    payment_instruction: string;
    required_before_enable: string[];
    admin_debug_summary: string;
    client_safe_summary: string;
    safety_flags: Record<string, boolean>;
  };
  live_transport_readiness: {
    status: "blocked";
    ready_for_live_transport: false;
    live_transport_configured: false;
    live_transport_enabled: false;
    admin_only_mode: true;
    provider_policy_allowed: false;
    readiness_key_present: boolean;
    budget_status_ok: false;
    budget_status: string;
    approval_status_ok: false;
    approval_status: string;
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
  safety_flags: Record<string, boolean>;
};

type ProviderInvocationFirewallResult = {
  invocation_id: string;
  status: "blocked";
  requested_provider_id: string;
  requested_route: string;
  requested_model_id: string;
  redacted_context_summary: string;
  estimated_tokens: number;
  estimated_cost_usd: number | null;
  action_classification: string;
  policy_result: ProviderPolicyPreview;
  readiness_result: ProviderReadinessReport;
  readiness_route: ProviderReadinessRoute | null;
  approval_requirement: {
    approval_required: boolean;
    approval_status: "preview-only" | "pending" | "blocked" | "approved" | "rejected" | "expired";
    risk_level: "low" | "medium" | "high" | "critical";
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
  openrouter_adapter: OpenRouterGlmAdapterDryRunResult | null;
  client_safe_summary: string;
  admin_debug_summary: string;
  safety_flags: Record<string, boolean>;
};

type ProviderInvocationPreviewResponse = {
  dry_run: boolean;
  ledger_written: boolean;
  queue_written: boolean;
  live_provider_called: boolean;
  approval_execution_implemented: boolean;
  provider_invocation: ProviderInvocationFirewallResult;
  provider_policy: ProviderPolicyPreview;
  provider_readiness: ProviderReadinessReport;
};

type LiveSmokePreflightGateStatus = "pass" | "blocked" | "not_implemented";

type LiveSmokePreflightReport = {
  preflight_id: string;
  checked_at: string;
  provider_route: string;
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
    enforcement_mode: string;
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
  safety_flags: Record<string, boolean>;
};

type LiveSmokePreflightResponse = {
  dry_run: boolean;
  live_smoke_allowed: false;
  execution_disabled: true;
  provider_called: false;
  network_call_performed: false;
  ledger_written: false;
  queue_written: false;
  approval_executed: false;
  approval_execution_implemented: false;
  preflight: LiveSmokePreflightReport;
};

type HermesLiveCallReceiptContract = {
  contract_id: string;
  correlation_id: string;
  status: "blocked_contract_only";
  created_at: string;
  provider: {
    provider_id: "openrouter_glm";
    provider_name: "OpenRouter";
    model_id: "z-ai/glm-5.2";
  };
  endpoint_contract: {
    endpoint: "https://openrouter.ai/api/v1/chat/completions";
    method: "POST";
    transport_contract_status: "disabled_contract_only";
    transport_enabled: false;
    network_client_implemented: false;
  };
  live_smoke_preflight_id: string;
  budget_gate_status: LiveSmokePreflightGateStatus;
  approval_gate_status: LiveSmokePreflightGateStatus;
  request_receipt: {
    receipt_id: string;
    correlation_id: string;
    receipt_kind: "redacted_provider_request";
    ledger_append_required_before_live: true;
    ledger_append_performed: false;
    request_payload_prepared: false;
    request_body_ready_for_send: false;
    providerCalled: false;
    networkCallPerformed: false;
    ledgerWritten: false;
    queueWritten: false;
    approvalExecuted: false;
    readyForSend: false;
  };
  response_receipt: {
    receipt_id: string;
    correlation_id: string;
    receipt_kind: "redacted_provider_response";
    response_status: "not_called";
    ledger_append_required_before_live: true;
    ledger_append_performed: false;
    providerCalled: false;
    networkCallPerformed: false;
    ledgerWritten: false;
    queueWritten: false;
    approvalExecuted: false;
    readyForSend: false;
  };
  redaction: {
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
  ledger_write_mode: "not_written_contract_only";
  queue_write_mode: "not_written_contract_only";
  approval_execution_mode: "not_implemented";
  required_before_live: string[];
  admin_debug_summary: string;
  client_safe_summary: string;
  providerCalled: false;
  networkCallPerformed: false;
  ledgerWritten: false;
  queueWritten: false;
  approvalExecuted: false;
  readyForSend: false;
  safety_flags: Record<string, boolean>;
};

type HermesLiveCallReceiptContractResponse = {
  dry_run: true;
  contract_only: true;
  provider_called: false;
  network_call_performed: false;
  ledger_written: false;
  queue_written: false;
  approval_executed: false;
  ready_for_send: false;
  approval_execution_implemented: false;
  receipt_contract: HermesLiveCallReceiptContract;
};

type HermesContextPreview = {
  dry_run: boolean;
  ledger_written: boolean;
  live_provider_called: boolean;
  decision: {
    provider_route: string;
    model_id: string;
    sensitivity_level: string;
    approval_required: boolean;
    approval_status: string;
    risks: string[];
    next_action: string;
  };
  action_preview: {
    status: "safe" | "pending_approval" | "blocked" | "destructive" | "live_provider_required";
    label: string;
    approval_required: boolean;
    live_execution_allowed: false;
    safe_for_preview: boolean;
    reasons: string[];
    next_action: string;
  };
  approval_request: {
    approval_id: string;
    action_type: string;
    risk_level: "low" | "medium" | "high" | "critical";
    status: "preview-only" | "pending" | "blocked" | "approved" | "rejected" | "expired";
    summary: string;
    approval_reason: string;
    requested_by: {
      actor_user_id: string;
      actor_role: string;
    };
    tenant_context: {
      tenant_id: string;
      business_name: string;
      request_id: string;
    };
    created_at: string;
    expires_at: string | null;
    estimated_impact: {
      provider_route: string;
      model_id: string;
      estimated_tokens: number;
      estimated_cost_usd: number | null;
      budget_status: string;
    };
    redacted_context_preview: string;
    safety_flags: {
      dry_run: boolean;
      execution_disabled: boolean;
      approval_execution_implemented: boolean;
      live_provider_call_allowed: boolean;
      ledger_write_allowed: boolean;
      secrets_redacted: boolean;
      destructive_action: boolean;
      live_provider_required: boolean;
      high_sensitivity: boolean;
    };
    execution_disabled: boolean;
  };
  provider_policy: ProviderPolicyPreview;
  provider_readiness: ProviderReadinessReport;
  provider_invocation: ProviderInvocationFirewallResult;
  context: {
    compact_context: string;
    user_request_summary: string;
    context_chars: number;
    estimated_tokens: number;
    raw_context_chars: number;
    compression_ratio: number;
  };
};

type ApprovalQueueRecordPreview = {
  queue_id: string;
  queued_at: string;
  queue_status: "pending" | "blocked_preview" | "preview_only";
  latest_review_status: "unreviewed" | "reviewed" | "dismissed" | "needs_changes" | "expired" | "note_added";
  transition_count: number;
  latest_transition_at: string | null;
  latest_transition: {
    transition_id: string;
    queue_id: string;
    from_status: string;
    to_status: "reviewed" | "dismissed" | "needs_changes" | "expired" | "note_added";
    requested_by: {
      actor_user_id: string;
      actor_role: string;
    };
    timestamp: string;
    note: string;
    execution_disabled: boolean;
    safety_flags: {
      local_file_only: boolean;
      redacted: boolean;
      status_only: boolean;
      approval_execution_implemented: boolean;
      live_action_allowed: boolean;
      ledger_write_allowed: boolean;
    };
  } | null;
  source: string;
  approval: HermesContextPreview["approval_request"];
  execution_disabled: boolean;
  queue_safety: {
    local_file_only: boolean;
    redacted: boolean;
    approval_execution_implemented: boolean;
    live_action_allowed: boolean;
    ledger_write_allowed: boolean;
  };
};

type ApprovalQueuePreviewResponse = {
  dry_run: boolean;
  ledger_written: boolean;
  live_provider_called: boolean;
  approval_execution_implemented: boolean;
  action_preview: HermesContextPreview["action_preview"];
  approval_request: HermesContextPreview["approval_request"];
  provider_policy: ProviderPolicyPreview;
  provider_readiness: ProviderReadinessReport;
  provider_invocation: ProviderInvocationFirewallResult;
  queue_write: {
    queued: boolean;
    reason: "queued" | "preview_only_not_queued" | "queue_not_requested";
    record: ApprovalQueueRecordPreview | null;
  };
};

type ApprovalQueueTransitionTarget = "reviewed" | "dismissed" | "needs_changes" | "expired";

type ApprovalQueueTransitionResponse = {
  execution_disabled: boolean;
  approval_execution_implemented: boolean;
  live_provider_called: boolean;
  ledger_written: boolean;
  transition: {
    transitioned: boolean;
    transition: NonNullable<ApprovalQueueRecordPreview["latest_transition"]>;
    record: ApprovalQueueRecordPreview;
  };
};

type AppSession = {
  id: string;
  label: string;
  role: "admin" | "client";
  clientId?: string;
  canManageAccess: boolean;
};

const AUTHORIZATION_HEADER = "Authorization";

const initialSessions: AppSession[] = [
  {
    id: "admin-jordan",
    label: "Jordan / PhantomForce Admin",
    role: "admin",
    canManageAccess: true,
  },
  {
    id: "client-chicagoshots",
    label: "ChicagoShots client workspace",
    role: "client",
    clientId: "client-chicagoshots",
    canManageAccess: false,
  },
  {
    id: "client-sports-demo",
    label: "Sports Ops Demo client",
    role: "client",
    clientId: "client-sports-demo",
    canManageAccess: false,
  },
  {
    id: "client-past-due",
    label: "Past Due Pilot client",
    role: "client",
    clientId: "client-past-due",
    canManageAccess: false,
  },
];

const navItems: Array<{ id: Route; label: string; icon: ReactNode }> = [
  { id: "command", label: "Home", icon: <Command size={18} /> },
  { id: "trainer", label: "Phantom AI", icon: <Sparkles size={18} /> },
  { id: "inbox", label: "Leads & Clients", icon: <Users size={18} /> },
  { id: "calendar", label: "Schedule", icon: <CalendarDays size={18} /> },
  { id: "tasks", label: "Tasks", icon: <SquareCheckBig size={18} /> },
  { id: "content", label: "Content", icon: <FileText size={18} /> },
  { id: "media", label: "Media Lab", icon: <Play size={18} /> },
  { id: "offers", label: "Offers", icon: <Zap size={18} /> },
  { id: "approvals", label: "Approvals", icon: <ShieldCheck size={18} /> },
  { id: "access", label: "Settings", icon: <KeyRound size={18} /> },
  { id: "connections", label: "Status", icon: <Link2 size={18} /> },
];

const initialEmails: EmailItem[] = [
  {
    id: "mail-1",
    from: "Maya Chen",
    subject: "Can we lock a shoot date next week?",
    preview: "Need a quick slot for the product shoot and a quote before Friday.",
    age: "18m",
    priority: "high",
    status: "needs-reply",
    project: "ChicagoShots",
  },
  {
    id: "mail-2",
    from: "Southside Elite",
    subject: "Roster updates and parent contact list",
    preview: "Three players changed teams and two forms are still missing.",
    age: "2h",
    priority: "medium",
    status: "waiting",
    project: "Sports Ops",
  },
  {
    id: "mail-3",
    from: "Air Authority",
    subject: "Follow-up after estimate",
    preview: "Customer asked whether Tuesday install is still possible.",
    age: "4h",
    priority: "medium",
    status: "needs-reply",
    project: "Service Pipeline",
  },
];

const initialEvents: CalendarEvent[] = [
  {
    id: "event-1",
    title: "Open production window",
    time: "Tue 10:30 AM",
    owner: "Jordan",
    status: "hold",
  },
  {
    id: "event-2",
    title: "Client approval call",
    time: "Wed 2:00 PM",
    owner: "Maya Chen",
    status: "confirmed",
  },
  {
    id: "event-3",
    title: "Roster review",
    time: "Thu 6:30 PM",
    owner: "Southside Elite",
    status: "proposed",
  },
];

const initialTasks: TaskItem[] = [
  {
    id: "task-1",
    title: "Reply to Maya with shoot options",
    owner: "PhantomForce",
    due: "Today",
    status: "today",
  },
  {
    id: "task-2",
    title: "Review missing sports forms",
    owner: "Ops",
    due: "Tomorrow",
    status: "queued",
  },
  {
    id: "task-3",
    title: "Draft Air Authority follow-up",
    owner: "Assistant",
    due: "Today",
    status: "today",
  },
];

const initialActivity: ActivityItem[] = [
  {
    id: "act-1",
    title: "Morning brief generated",
    detail: "3 emails need action, 2 calendar holds, 2 approval-ready workflows.",
    time: "9:02 AM",
    level: "ok",
  },
  {
    id: "act-2",
    title: "Google connectors checked",
    detail: "Gmail and Calendar are ready in demo mode. No external writes without approval.",
    time: "9:01 AM",
    level: "info",
  },
  {
    id: "act-3",
    title: "Falcon boundary locked",
    detail: "Raw commands, files, logs, and model settings are not exposed to clients.",
    time: "8:58 AM",
    level: "warn",
  },
];

const initialMessages: Message[] = [
  {
    id: "msg-1",
    role: "assistant",
    content:
      "PhantomForce is online - protected. I found one urgent client follow-up, two scheduling opportunities, and one approval-ready action. Ask me to handle the day, schedule a call, draft replies, or clean up the inbox.",
  },
];

const connections: Connection[] = [
  {
    id: "gmail",
    name: "Google Gmail",
    description: "Read inbox, identify follow-ups, draft replies, and send only after approval.",
    status: "connected",
    scopes: ["Read mail", "Draft mail", "Send with approval"],
  },
  {
    id: "calendar",
    name: "Google Calendar",
    description: "Check availability, propose meeting times, and create events after approval.",
    status: "connected",
    scopes: ["Read calendar", "Create with approval"],
  },
  {
    id: "falcon",
    name: "Falcon private worker",
    description: "Future typed backend jobs. No raw command execution in the client app.",
    status: "locked",
    scopes: ["Typed jobs only", "Staff diagnostics", "Kill switch"],
  },
];

const initialClientAccess: ClientAccess[] = [
  {
    id: "client-chicagoshots",
    business: "ChicagoShots",
    owner: "Jordan West",
    plan: "Internal partner",
    paymentStatus: "paid",
    accessStatus: "active",
    gateway: "Pangolin",
    privateRoute: "app.phantomforce.online/chicagoshots",
    modules: ["Command", "Content", "Tasks", "Approvals", "Activity"],
    lastAudit: "Access confirmed for partner workspace",
  },
  {
    id: "client-sports-demo",
    business: "Sports Ops Demo",
    owner: "Client Owner",
    plan: "$2,000 Team Media Day",
    paymentStatus: "paid",
    accessStatus: "active",
    gateway: "Pangolin",
    privateRoute: "app.phantomforce.online/sports-ops-demo",
    modules: ["Command", "Calendar", "Tasks", "Approvals", "Contacts"],
    lastAudit: "Deposit paid; workspace active",
  },
  {
    id: "client-past-due",
    business: "Past Due Pilot",
    owner: "Client Owner",
    plan: "$1,250/mo Ops Support",
    paymentStatus: "failed",
    accessStatus: "revoked",
    gateway: "Pangolin",
    privateRoute: "app.phantomforce.online/past-due-pilot",
    modules: ["Command", "Tasks", "Reports"],
    lastAudit: "Payment failed; private route revoked",
  },
];

const modules = [
  "AI Command",
  "Email",
  "Calendar",
  "Tasks",
  "Approvals",
  "Activity",
  "Contacts",
  "Documents",
  "Falcon Worker",
];

const clientModuleCatalog = [
  "Command",
  "Calendar",
  "Tasks",
  "Approvals",
  "Contacts",
  "Content",
  "Activity",
  "Documents",
  "Reports",
];

const truthStatusLabels: TruthLabel[] = [
  {
    label: "Brain",
    value: "Mock / OpenRouter GLM / Claude API / Local / Router",
    state: "demo",
    detail:
      "The dashboard assistant remains demo-first. Provider routing is status-only unless a server-side route is configured and approved.",
  },
  {
    label: "Hermes",
    value: "Ledger Enabled / Context Compiler Enabled",
    state: "real",
    detail:
      "Hermes can write local JSONL records and compile compact context packets. It does not call external models.",
  },
  {
    label: "Access",
    value: "Demo Local / Owner Config-Gated / Pangolin Dry-Run",
    state: "demo",
    detail:
      "Demo sessions and owner admin are local/config-gated. Pangolin status is read-only/dry-run unless separately proven live.",
  },
  {
    label: "Budget",
    value: "Planned / Not Enforced",
    state: "stub",
    detail:
      "Budget fields can be recorded with Hermes/provider status, but enforcement is not implemented in this patch.",
  },
  {
    label: "Actions",
    value: "Approval Only / Live Disabled",
    state: "real",
    detail:
      "The UI creates reviewable approval items. Sends, uploads, deploys, production, billing, and destructive actions are disabled.",
  },
  {
    label: "Client Mode",
    value: "Personal Training Simulation",
    state: "demo",
    detail:
      "The trainer cockpit uses local sample data only. It is not a launched customer workspace or live billing environment.",
  },
  {
    label: "Team Mode",
    value: "Owner Only / Employees Disabled",
    state: "blocked",
    detail:
      "Employee seats, delegated permissions, and staff workflows are intentionally blocked until access rules are implemented.",
  },
];

const customerStatusLabels: TruthLabel[] = [
  {
    label: "Phantom AI",
    value: "Online - protected",
    state: "demo",
    detail:
      "Phantom AI can summarize the workspace and prepare approval-ready next steps while keeping private data out of customer-visible plumbing.",
  },
  {
    label: "Memory",
    value: "Setup required",
    state: "stub",
    detail:
      "Workspace history, rules, approval records, and context packets are planned but not yet connected as durable memory.",
  },
  {
    label: "Actions",
    value: "Approval only",
    state: "real",
    detail:
      "Drafts and suggested actions stay in the approval queue until Jordan or the owner approves them.",
  },
  {
    label: "Launch readiness",
    value: "Blocked",
    state: "blocked",
    detail:
      "Premium reasoning, memory ledger, audit trail, access gates, and billing proof must be finished before a real customer launch.",
  },
];

const phantomAiStatus = {
  availability: "Online - protected",
  memory: "Setup required",
  fallback: "Private APIs save lives; provider details stay behind Phantom AI",
  approvalGate: "Approval gate visible for demo actions; live external actions disabled",
  allowedSuggestions: [
    "Prioritize leads, tasks, schedule gaps, and client follow-ups",
    "Draft approval-ready messages and operational next steps",
    "Summarize launch blockers and onboarding progress",
  ],
  approvalRequired: [
    "Sending email, posting content, uploads, deploys, route changes, billing, credentials, deletes, or production changes",
    "Any customer-facing claim that premium reasoning, memory, billing, access, or employee roles are live",
  ],
};

const personalTrainingSimulation = {
  owner: {
    name: "Jordan West",
    business: "West Loop Strength Lab",
    market: "Chicago personal training",
    mode: "Local demo simulation",
  },
  services: [
    {
      title: "Founder's Body Rebuild",
      detail: "$497/mo hybrid coaching with weekly accountability and nutrition review.",
      status: "demo package",
    },
    {
      title: "Private Strength Sessions",
      detail: "$125/session in-gym training for executives and busy parents.",
      status: "demo package",
    },
    {
      title: "Transformation Sprint",
      detail: "8-week onboarding sprint with assessment, schedule, habit plan, and progress photos.",
      status: "demo package",
    },
  ],
  leads: [
    { title: "Maya C.", detail: "Asked about morning private sessions and meal prep accountability.", status: "hot" },
    { title: "Andre R.", detail: "Corporate referral wants a 6-week reset before travel season.", status: "warm" },
    { title: "Priya S.", detail: "Instagram lead waiting on package comparison and start dates.", status: "new" },
  ],
  clients: [
    { title: "Eli Morgan", detail: "Strength rebuild, Tue/Thu 7 AM, needs knee-friendly programming.", status: "active" },
    { title: "Nina Patel", detail: "Fat-loss sprint, Mon/Wed 6 PM, weekly photo check due Friday.", status: "active" },
    { title: "Carlos Rivera", detail: "Trial completed; needs approval to send membership offer.", status: "approval" },
  ],
  schedule: [
    { title: "7:00 AM - Eli Morgan", detail: "Lower-body strength session with form video notes.", status: "confirmed" },
    { title: "12:30 PM - Lead consult", detail: "Maya C. discovery call and package fit review.", status: "hold" },
    { title: "6:00 PM - Nina Patel", detail: "Conditioning block and weekly measurement check.", status: "confirmed" },
  ],
  tasks: [
    { title: "Draft Maya follow-up", detail: "Explain Founder's Body Rebuild and available start windows.", status: "today" },
    { title: "Update Carlos offer", detail: "Prepare approval item before any email is sent.", status: "approval only" },
    { title: "Compile weekly wins", detail: "Summarize check-ins for active clients without external posting.", status: "queued" },
  ],
  approvals: [
    { title: "Send membership offer to Carlos", detail: "Email must stay pending until Jordan approves.", status: "pending" },
    { title: "Publish transformation reel", detail: "Needs client consent and media review before upload/post.", status: "blocked" },
    { title: "Activate payment link", detail: "Billing claims and payment changes are not live in this simulation.", status: "blocked" },
  ],
  contentCalendar: [
    { title: "Monday", detail: "Coach POV: why founders need simple strength systems.", status: "draft" },
    { title: "Wednesday", detail: "Client education carousel about protein and consistency.", status: "draft" },
    { title: "Friday", detail: "Wins roundup requires approval and consent before posting.", status: "approval" },
  ],
  contentIdeas: [
    { title: "Protein reset checklist", detail: "Raw carousel idea for busy owners who skip breakfast.", status: "raw idea" },
    { title: "Founder's 20-minute lift", detail: "Short-form post showing a simple hotel-gym strength session.", status: "recommended" },
    { title: "Client win story", detail: "Transformation narrative requires consent before any public post.", status: "approval" },
    { title: "Meal prep Sunday", detail: "Behind-the-scenes education post for accountability coaching.", status: "queued" },
  ],
  contentDrafts: [
    { title: "Maya consult follow-up post", detail: "Draft educational caption, no prospect details included.", status: "pending approval" },
    { title: "Friday wins roundup", detail: "Requires client consent and owner review before publishing.", status: "blocked" },
    { title: "Founder strength myth", detail: "Draft only; platform posting is not wired.", status: "draft" },
  ],
  mediaRequests: [
    { title: "Form-check clips", detail: "Optional short edits for client feedback, local/demo only.", status: "demo" },
    { title: "Reel template", detail: "30-second transformation story format for review.", status: "planned" },
    { title: "Testimonial capture", detail: "Consent and usage rights required before any publish workflow.", status: "blocked" },
  ],
  mediaDeliverables: [
    { title: "Form-check cutdown", detail: "Coach review clip for internal client feedback.", status: "queued" },
    { title: "Transformation reel draft", detail: "Storyboard only; no upload or publish workflow is live.", status: "approval" },
    { title: "Testimonial prep sheet", detail: "Shot list and consent checklist for a future media day.", status: "planned" },
  ],
  mediaPlaceholders: [
    { title: "Uploads", detail: "File upload intake is not wired in this simulation.", status: "placeholder" },
    { title: "Delivery links", detail: "External delivery and posting are disabled until approval gates exist.", status: "disabled" },
    { title: "Client consent vault", detail: "Consent storage is a launch blocker, not live storage.", status: "blocked" },
  ],
  offerRecommendations: [
    { title: "Lead Maya into Founder's Body Rebuild", detail: "Best match: accountability plus morning-session availability.", status: "recommended" },
    { title: "Offer Carlos a 90-day private training upgrade", detail: "Prepare owner-approved email before any send.", status: "approval" },
    { title: "Bundle nutrition review with Transformation Sprint", detail: "Demo recommendation for higher-retention package design.", status: "demo" },
  ],
  pricingDrafts: [
    { title: "$497/mo hybrid coaching", detail: "Draft recurring package; billing activation is not live.", status: "draft" },
    { title: "$125 private session", detail: "Simple session rate for owner review.", status: "draft" },
    { title: "$1,997 8-week sprint", detail: "Premium transformation package, pending final scope approval.", status: "approval" },
  ],
  onboardingChecklist: [
    { title: "Client profile", detail: "Offer, services, voice, and target persona captured in demo seed.", status: "done" },
    { title: "Approval policy", detail: "External actions require Jordan or owner approval.", status: "done" },
    { title: "Premium reasoning setup", detail: "Official customer-facing AI configuration is not implemented in this app.", status: "blocked" },
    { title: "Memory ledger", detail: "Append-only memory and context ledger still need implementation.", status: "blocked" },
  ],
  launchBlockers: [
    { title: "Premium reasoning setup", detail: "No official customer-facing premium reasoning route is wired or proven.", status: "blocked" },
    { title: "Memory and audit ledger", detail: "No durable app memory, context compiler, or approval ledger exists yet.", status: "blocked" },
    { title: "Production access rules", detail: "Employee roles, live routes, billing, and production gates need hard proof.", status: "blocked" },
  ],
  phantomCut: {
    title: "PhantomCut Media Lab add-on",
    detail:
      "Optional video/editor support for form checks, reels, and media-heavy clients. It is not required for the personal trainer core app.",
    status: "available/demo/planned",
  },
  roleModel: [
    { title: "Jordan / PhantomForce", detail: "Platform super-admin concept and final control layer.", status: "operator" },
    { title: "Business owner", detail: "Admin only for this business workspace in the simulation.", status: "owner admin" },
    { title: "Employees", detail: "Disabled/future until roles, audit, and permission rules are implemented.", status: "disabled" },
    { title: "Client portal users", detail: "Optional/future. Trainer clients are roster records today, not portal accounts.", status: "future" },
  ],
};

const API_BASE_URL = "http://127.0.0.1:5190";
const MONEY_DEMO_CLIENT_ID = "client-money-demo";

const defaultProviderSetupStatus: ProviderSetupStatus = {
  router_mode: "mock",
  phantomforce_managed: {
    status: "recommended",
    detail: "Default customer experience. Provider setup remains an owner/admin responsibility.",
  },
  openrouter_glm: {
    configured: false,
    status: "Not Configured",
    model_id: "z-ai/glm-5.2",
    setup_required: true,
    payment_setup_needed: true,
    detail:
      "OpenRouter account/API key will be needed later. Do not fund OpenRouter until budget, Hermes receipts, redaction, approval execution, and smoke approval gates pass.",
  },
  claude_api: {
    configured: false,
    status: "Not Configured",
    detail: "Premium reasoning route is planned for official Claude API configuration later.",
  },
  local_fallback: {
    available: false,
    status: "Not Available",
    detail: "Private APIs save lives. Model routing stays behind Phantom AI instead of exposing backend plumbing.",
  },
  byok: {
    enabled: false,
    status: "Disabled",
    detail: "Bring Your Own Key remains advanced/future and is disabled by default.",
  },
  budget: {
    status: "Planned / Not Enforced",
    default_tenant_budget_usd: null,
    detail: "Budget fields are planned; enforcement is not implemented in Patch 3B.",
  },
  hermes: {
    ledger_enabled: false,
    context_compiler_enabled: false,
    ledger_path: ".phantom/hermes-ledger.jsonl",
    status: "Stub",
  },
  phantom_plus: {
    status: "Planned",
    detail: "PhantomPlus will be bounded managed multi-agent runs inside PhantomForce. No loops are implemented.",
    agent_loop_status: "Not Implemented",
  },
};

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 1000)}`;
}

function normalizeModuleKey(moduleKey: string) {
  return moduleKey.trim().toLowerCase();
}

function moduleTestId(clientId: string, moduleKey: string) {
  const slug = moduleKey.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return `access-module-${clientId}-${slug}`;
}

function App() {
  const [route, setRoute] = useState<Route>("command");
  const [signedIn, setSignedIn] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState("admin-jordan");
  const [sessionToken, setSessionToken] = useState("");
  const [commandText, setCommandText] = useState("");
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [emails, setEmails] = useState(initialEmails);
  const [events, setEvents] = useState(initialEvents);
  const [tasks, setTasks] = useState(initialTasks);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [activity, setActivity] = useState(initialActivity);
  const [clientAccess, setClientAccess] = useState(initialClientAccess);
  const [guardedWorkspace, setGuardedWorkspace] = useState<GuardedWorkspace | null>(null);
  const [workspaceModuleView, setWorkspaceModuleView] = useState<WorkspaceModuleView | null>(null);
  const [pangolinPlan, setPangolinPlan] = useState<PangolinRoutePlan[]>([]);
  const [pangolinStatus, setPangolinStatus] = useState<PangolinReadOnlyStatus | null>(null);
  const [readinessReport, setReadinessReport] = useState<ProductionReadinessReport | null>(null);
  const [providerSetupStatus, setProviderSetupStatus] = useState<ProviderSetupStatus>(defaultProviderSetupStatus);
  const [moneyDemoBusy, setMoneyDemoBusy] = useState<MoneyDemoStage | null>(null);
  const [selectedOrg, setSelectedOrg] = useState("PhantomForce Pilot");
  const activeSession = useMemo(
    () => initialSessions.find((session) => session.id === activeSessionId) ?? initialSessions[0],
    [activeSessionId],
  );
  const canManageAccess = activeSession.canManageAccess;
  const visibleClientAccess = useMemo(() => {
    if (canManageAccess) return clientAccess;
    return clientAccess.filter((client) => client.id === activeSession.clientId);
  }, [activeSession.clientId, canManageAccess, clientAccess]);

  function sessionHeaders(json = false): Record<string, string> {
    const headers: Record<string, string> = json ? { "Content-Type": "application/json" } : {};

    if (sessionToken) {
      headers[AUTHORIZATION_HEADER] = `Bearer ${sessionToken}`;
    }

    return headers;
  }

  async function signIn(sessionId: string) {
    const session = initialSessions.find((item) => item.id === sessionId) ?? initialSessions[0];
    setActiveSessionId(session.id);
    setSelectedOrg(session.clientId ? session.label.replace(" client", "") : "PhantomForce Pilot");
    setSessionToken("");

    try {
      const response = await fetch(`${API_BASE_URL}/auth/demo-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.id }),
      });

      if (response.ok) {
        const data = (await response.json()) as { token?: string };
        setSessionToken(data.token ?? "");
      } else {
        addActivity("Signed in locally", "Backend auth token was not issued; API requests will fail closed.", "warn");
      }
    } catch {
      addActivity("Signed in locally", "Backend auth service is offline; API requests will fail closed.", "warn");
    }

    setSignedIn(true);
    setRoute("command");
  }

  async function refreshWorkspaceModule(clientId: string, moduleKey?: string) {
    if (!moduleKey) {
      setWorkspaceModuleView(null);
      return;
    }

    try {
      const response = await fetch(
        `${API_BASE_URL}/client-workspaces/${clientId}/modules/${encodeURIComponent(moduleKey)}`,
        {
          headers: sessionHeaders(),
        },
      );

      const data = (await response.json()) as { moduleView?: WorkspaceModuleView };

      if (response.ok && data.moduleView) {
        setWorkspaceModuleView(data.moduleView);
        return;
      }
    } catch {
      addActivity("Module handler offline", "The guarded module payload is waiting on the backend.", "warn");
    }

    setWorkspaceModuleView(null);
  }

  async function refreshGuardedWorkspace(clientId = activeSession.clientId ?? "client-sports-demo") {
    try {
      const response = await fetch(`${API_BASE_URL}/client-workspaces/${clientId}`, {
        headers: sessionHeaders(),
      });
      const data = (await response.json()) as {
        workspace?: {
          id: string;
          business: string;
          mode: GuardedWorkspace["mode"];
          modules: string[];
        };
        decision?: {
          mode: GuardedWorkspace["mode"];
          modules?: string[];
          reason: string;
        };
        record?: {
          id: string;
          business: string;
        };
      };

      if (response.ok && data.workspace) {
        const modules = data.workspace.modules;
        setGuardedWorkspace({
          id: data.workspace.id,
          business: data.workspace.business,
          mode: data.workspace.mode,
          modules,
          reason: data.decision?.reason ?? "Workspace request allowed.",
        });
        const preferredModule = modules.includes("Calendar") ? "Calendar" : modules[0];
        void refreshWorkspaceModule(data.workspace.id, preferredModule);
        return;
      }

      if (data.record && data.decision) {
        const modules = data.decision.modules ?? [];
        setGuardedWorkspace({
          id: data.record.id,
          business: data.record.business,
          mode: data.decision.mode,
          modules,
          reason: data.decision.reason,
        });
        setWorkspaceModuleView(null);
      }
    } catch {
      setGuardedWorkspace({
        id: clientId,
        business: "Sports Ops Demo",
        mode: "blocked",
        modules: [],
        reason: "Backend guard unavailable; production should fail closed.",
      });
      setWorkspaceModuleView(null);
    }
  }

  async function refreshPangolinPlan() {
    if (!canManageAccess) {
      setPangolinPlan([]);
      setPangolinStatus(null);
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/pangolin/reconcile/dry-run`, {
        headers: sessionHeaders(),
      });

      if (response.status === 403) {
        setPangolinPlan([]);
        return;
      }

      if (!response.ok) return;

      const data = (await response.json()) as { plans?: PangolinRoutePlan[] };
      if (Array.isArray(data.plans)) {
        setPangolinPlan(data.plans);
      }
    } catch {
      addActivity("Pangolin dry-run offline", "Gateway route planning is waiting on the backend.", "warn");
    }

    try {
      const response = await fetch(`${API_BASE_URL}/pangolin/status/read-only`, {
        headers: sessionHeaders(),
      });

      if (!response.ok) return;

      const data = (await response.json()) as { status?: PangolinReadOnlyStatus };
      if (data.status) {
        setPangolinStatus(data.status);
      }
    } catch {
      addActivity("Pangolin status offline", "Read-only gateway verification is waiting on the backend.", "warn");
    }
  }

  async function refreshReadinessReport() {
    if (!canManageAccess) {
      setReadinessReport(null);
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/readiness`, {
        headers: sessionHeaders(),
      });

      if (!response.ok) {
        setReadinessReport(null);
        return;
      }

      const data = (await response.json()) as { report?: ProductionReadinessReport };
      setReadinessReport(data.report ?? null);
    } catch {
      addActivity("Readiness API offline", "Production readiness gates are waiting on the backend.", "warn");
      setReadinessReport(null);
    }
  }

  async function refreshProviderSetupStatus() {
    if (!canManageAccess) {
      setProviderSetupStatus(defaultProviderSetupStatus);
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/phantom-ai/provider-status`, {
        headers: sessionHeaders(),
      });

      if (!response.ok) {
        setProviderSetupStatus(defaultProviderSetupStatus);
        return;
      }

      const data = (await response.json()) as { status?: ProviderSetupStatus };
      setProviderSetupStatus(data.status ?? defaultProviderSetupStatus);
    } catch {
      addActivity("Provider setup offline", "Phantom AI provider status is waiting on the backend.", "warn");
      setProviderSetupStatus(defaultProviderSetupStatus);
    }
  }

  useEffect(() => {
    let cancelled = false;

    if (!signedIn) return undefined;

    async function loadClientAccess() {
      try {
        const response = await fetch(`${API_BASE_URL}/client-access`, {
          headers: sessionHeaders(),
        });
        if (!response.ok) return;
        const data = (await response.json()) as { records?: ClientAccess[] };
        if (!cancelled && Array.isArray(data.records)) {
          setClientAccess(data.records);
        }
      } catch {
        addActivity("Access API offline", "Using local demo access state until the backend is available.", "warn");
      }
    }

    void loadClientAccess();
    void refreshGuardedWorkspace();
    if (canManageAccess) {
      void refreshPangolinPlan();
      void refreshReadinessReport();
      void refreshProviderSetupStatus();
    } else {
      setPangolinPlan([]);
      setReadinessReport(null);
      setProviderSetupStatus(defaultProviderSetupStatus);
    }

    return () => {
      cancelled = true;
    };
  }, [activeSessionId, sessionToken, signedIn]);

  const stats = useMemo(() => {
    return {
      urgent: emails.filter((email) => email.status === "needs-reply").length,
      pending: approvals.filter((approval) => approval.status === "pending").length,
      today: tasks.filter((task) => task.status === "today").length,
      events: events.length,
      revoked: clientAccess.filter((client) => client.accessStatus === "revoked").length,
    };
  }, [emails, approvals, tasks, events, clientAccess]);

  function addActivity(title: string, detail: string, level: ActivityLevel = "info") {
    setActivity((current) => [
      {
        id: makeId("act"),
        title,
        detail,
        time: "Just now",
        level,
      },
      ...current,
    ]);
  }

  function upsertClientAccessRecord(record: ClientAccess) {
    setClientAccess((current) => {
      const exists = current.some((item) => item.id === record.id);
      return exists ? current.map((item) => (item.id === record.id ? record : item)) : [record, ...current];
    });
  }

  function createFollowUpPlan(source = "command") {
    const targetEmail = emails.find((email) => email.status === "needs-reply") || emails[0];
    const emailApproval: Approval = {
      id: makeId("approval-email"),
      kind: "email",
      title: `Send reply to ${targetEmail.from}`,
      summary: "Confirm next-week availability, offer two call windows, and ask for final shoot details.",
      payload: {
        recipient: targetEmail.from,
        subject: `Re: ${targetEmail.subject}`,
        body:
          "Thanks for the details. I can hold Tuesday at 10:30 AM or Wednesday at 2:00 PM for a quick planning call. Send the final shoot requirements and I will lock the path from there.",
      },
      reversible: false,
      status: "pending",
    };
    const calendarApproval: Approval = {
      id: makeId("approval-calendar"),
      kind: "calendar",
      title: "Create planning call",
      summary: "Place a tentative call on the calendar after the client confirms the preferred slot.",
      payload: {
        title: `Planning call with ${targetEmail.from}`,
        time: "Next Tue 10:30 AM",
        participants: targetEmail.from,
      },
      reversible: true,
      status: "pending",
    };

    setApprovals((current) => [emailApproval, calendarApproval, ...current]);
    setMessages((current) => [
      ...current,
      {
        id: makeId("msg-assistant"),
        role: "assistant",
        content:
          source === "demo"
            ? "Demo flow ready: I found Maya's follow-up, drafted the reply, checked the calendar, and created two approval cards. Nothing external happens until you approve."
            : "I found the best next action: reply to Maya and reserve a call window. I prepared an email and a calendar event for approval. No external action has been taken.",
      },
    ]);
    addActivity("Approval cards created", "Email and calendar actions are waiting for review.", "ok");
    setRoute("command");
  }

  function submitCommand(event: FormEvent) {
    event.preventDefault();
    const text = commandText.trim();
    if (!text) return;
    setCommandText("");
    setMessages((current) => [...current, { id: makeId("msg-user"), role: "user", content: text }]);

    const lower = text.toLowerCase();
    if (lower.includes("schedule") || lower.includes("follow") || lower.includes("handle") || lower.includes("email")) {
      createFollowUpPlan();
      return;
    }

    if (lower.includes("brief") || lower.includes("today")) {
      setMessages((current) => [
        ...current,
        {
          id: makeId("msg-assistant"),
          role: "assistant",
          content:
            "Today needs focus on 2 replies, 3 active tasks, and 1 calendar hold. The fastest win is approving the client follow-up package, then clearing the Air Authority reply.",
        },
      ]);
      addActivity("Brief requested", "Assistant summarized the current operational load.", "info");
      return;
    }

    setMessages((current) => [
      ...current,
      {
        id: makeId("msg-assistant"),
        role: "assistant",
        content:
          "I can help with that. For this first build, I can brief the day, find follow-ups, create approval cards, organize tasks, and prepare email/calendar actions for review.",
      },
    ]);
  }

  function approveAction(id: string) {
    const approval = approvals.find((item) => item.id === id);
    if (!approval) return;

    setApprovals((current) =>
      current.map((item) => (item.id === id ? { ...item, status: "approved" } : item)),
    );

    if (approval.kind === "email") {
      setEmails((current) =>
        current.map((email) =>
          approval.payload.recipient === email.from ? { ...email, status: "handled" } : email,
        ),
      );
    }

    if (approval.kind === "calendar") {
      setEvents((current) => [
        {
          id: makeId("event"),
          title: approval.payload.title,
          time: approval.payload.time,
          owner: approval.payload.participants,
          status: "confirmed",
        },
        ...current,
      ]);
    }

    if (approval.kind === "task") {
      setTasks((current) => [
        {
          id: makeId("task"),
          title: approval.payload.title,
          owner: "PhantomForce",
          due: approval.payload.due,
          status: "queued",
        },
        ...current,
      ]);
    }

    addActivity("Approved action executed", approval.title, "ok");
  }

  function rejectAction(id: string) {
    const approval = approvals.find((item) => item.id === id);
    setApprovals((current) =>
      current.map((item) => (item.id === id ? { ...item, status: "rejected" } : item)),
    );
    if (approval) addActivity("Action rejected", approval.title, "warn");
  }

  function completeTask(id: string) {
    setTasks((current) =>
      current.map((task) => (task.id === id ? { ...task, status: "done" } : task)),
    );
    addActivity("Task completed", "A task was marked complete from the PhantomForce app.", "ok");
  }

  async function updateClientAccess(id: string, nextStatus: ClientAccessStatus) {
    const client = clientAccess.find((item) => item.id === id);
    const reason =
      nextStatus === "active"
        ? "Jordan restored paid private access"
        : nextStatus === "past_due"
          ? "Jordan marked account past due"
          : "Jordan revoked private route for non-payment";

    try {
      const proposalResponse = await fetch(`${API_BASE_URL}/client-access/${id}/status/propose`, {
        method: "POST",
        headers: sessionHeaders(true),
        body: JSON.stringify({
          accessStatus: nextStatus,
          reason,
          proposedBy: "Jordan",
        }),
      });

      if (!proposalResponse.ok) {
        addActivity("Access request blocked", "This session cannot propose client access changes.", "warn");
        return;
      }

      const proposalData = (await proposalResponse.json()) as {
        approval?: { id: string };
      };

      if (!proposalData.approval?.id) {
        throw new Error("Access API did not return an approval.");
      }

      const approvalResponse = await fetch(
        `${API_BASE_URL}/client-access-approvals/${proposalData.approval.id}/decision`,
        {
          method: "POST",
          headers: sessionHeaders(true),
          body: JSON.stringify({
            decision: "approve",
            decidedBy: "Jordan",
            reason,
          }),
        },
      );

      if (approvalResponse.ok) {
        const data = (await approvalResponse.json()) as { record?: ClientAccess };
        if (data.record) {
          upsertClientAccessRecord(data.record);
        }
      } else {
        addActivity("Access approval blocked", "This session cannot approve client access changes.", "warn");
        return;
      }
    } catch {
      setClientAccess((current) =>
        current.map((item) => {
          if (item.id !== id) return item;
          const paymentStatus: PaymentStatus =
            nextStatus === "active" ? "paid" : nextStatus === "past_due" ? "due" : "failed";

          return {
            ...item,
            accessStatus: nextStatus,
            paymentStatus,
            lastAudit: reason,
          };
        }),
      );
    }

    if (client) {
      const detail =
        nextStatus === "active"
          ? `${client.business} can access the dashboard through the private gateway.`
          : nextStatus === "past_due"
            ? `${client.business} is flagged past due before full revocation.`
            : `${client.business} is blocked from the private dashboard route.`;
      addActivity("Client access updated", detail, nextStatus === "revoked" ? "warn" : "ok");
    }

    void refreshGuardedWorkspace(id);
    void refreshPangolinPlan();
  }

  async function updateClientModule(id: string, moduleKey: string, enabled: boolean) {
    const client = clientAccess.find((item) => item.id === id);
    const reason = enabled
      ? `Jordan enabled ${moduleKey} for this package`
      : `Jordan disabled ${moduleKey} for this package`;

    try {
      const proposalResponse = await fetch(
        `${API_BASE_URL}/client-access/${id}/modules/${encodeURIComponent(moduleKey)}/propose`,
        {
          method: "POST",
          headers: sessionHeaders(true),
          body: JSON.stringify({
            enabled,
            reason,
            proposedBy: "Jordan",
          }),
        },
      );

      if (!proposalResponse.ok) {
        addActivity("Module request blocked", "This session cannot propose module entitlement changes.", "warn");
        return;
      }

      const proposalData = (await proposalResponse.json()) as {
        approval?: { id: string };
      };

      if (!proposalData.approval?.id) {
        throw new Error("Access API did not return a module approval.");
      }

      const approvalResponse = await fetch(
        `${API_BASE_URL}/client-access-approvals/${proposalData.approval.id}/decision`,
        {
          method: "POST",
          headers: sessionHeaders(true),
          body: JSON.stringify({
            decision: "approve",
            decidedBy: "Jordan",
            reason,
          }),
        },
      );

      if (!approvalResponse.ok) {
        addActivity("Module approval blocked", "This session cannot approve module entitlement changes.", "warn");
        return;
      }

      const data = (await approvalResponse.json()) as { record?: ClientAccess };
      if (data.record) {
        upsertClientAccessRecord(data.record);
      }
    } catch {
      setClientAccess((current) =>
        current.map((item) => {
          if (item.id !== id) return item;

          const normalized = normalizeModuleKey(moduleKey);
          const hasModule = item.modules.some((module) => normalizeModuleKey(module) === normalized);
          const modules = enabled
            ? hasModule
              ? item.modules
              : [...item.modules, moduleKey]
            : item.modules.filter((module) => normalizeModuleKey(module) !== normalized);

          return {
            ...item,
            modules,
            lastAudit: reason,
          };
        }),
      );
    }

    if (client) {
      addActivity(
        enabled ? "Client module enabled" : "Client module disabled",
        `${moduleKey} ${enabled ? "enabled for" : "removed from"} ${client.business}.`,
        enabled ? "ok" : "warn",
      );
    }

    void refreshGuardedWorkspace(id);
    void refreshPangolinPlan();
  }

  async function provisionMoneyDemo(paymentStatus: PaymentStatus) {
    const paid = paymentStatus === "paid";
    const reason = paid
      ? "money demo payment received from NexProspex close"
      : "money demo signed agreement before payment clears";
    const proposalResponse = await fetch(`${API_BASE_URL}/client-provisioning/propose`, {
      method: "POST",
      headers: sessionHeaders(true),
      body: JSON.stringify({
        clientId: MONEY_DEMO_CLIENT_ID,
        business: "Money Demo Athletics",
        owner: "New Client Owner",
        plan: "$2,000 Launch Ops",
        source: "nexprospex",
        sourceRecordId: paid ? "nxp-money-demo-paid" : "nxp-money-demo-signed",
        winStatus: paid ? "payment_received" : "signed_agreement",
        paymentStatus,
        modules: ["Command", "Calendar", "Tasks", "Approvals", "Contacts"],
        reason,
        proposedBy: "Jordan",
      }),
    });

    if (!proposalResponse.ok) {
      addActivity("Money demo blocked", "This session cannot propose client provisioning.", "warn");
      return;
    }

    const proposalData = (await proposalResponse.json()) as { approval?: { id: string } };
    if (!proposalData.approval?.id) {
      addActivity("Money demo blocked", "Provisioning did not return an approval card.", "warn");
      return;
    }

    const approvalResponse = await fetch(
      `${API_BASE_URL}/client-access-approvals/${proposalData.approval.id}/decision`,
      {
        method: "POST",
        headers: sessionHeaders(true),
        body: JSON.stringify({
          decision: "approve",
          decidedBy: "Jordan",
          reason,
        }),
      },
    );

    if (!approvalResponse.ok) {
      addActivity("Money demo approval blocked", "This session cannot approve provisioning.", "warn");
      return;
    }

    const data = (await approvalResponse.json()) as { record?: ClientAccess };
    if (data.record) {
      upsertClientAccessRecord(data.record);
      addActivity(
        paid ? "Money demo active" : "Money demo blocked",
        paid
          ? "Payment received; workspace, modules, private route, and Calendar boundary are active."
          : "Signed lead is provisioned but blocked until payment clears.",
        paid ? "ok" : "warn",
      );
    }

    await refreshGuardedWorkspace(MONEY_DEMO_CLIENT_ID);
    await refreshPangolinPlan();
  }

  async function runMoneyDemoStage(stage: MoneyDemoStage) {
    setMoneyDemoBusy(stage);

    try {
      if (stage === "signed") {
        await provisionMoneyDemo("due");
        return;
      }

      if (stage === "paid") {
        await provisionMoneyDemo("paid");
        await refreshWorkspaceModule(MONEY_DEMO_CLIENT_ID, "Calendar");
        return;
      }

      const nextStatus: ClientAccessStatus =
        stage === "past_due" ? "past_due" : stage === "revoked" ? "revoked" : "active";
      await updateClientAccess(MONEY_DEMO_CLIENT_ID, nextStatus);
      await refreshGuardedWorkspace(MONEY_DEMO_CLIENT_ID);

      if (stage === "restored") {
        await refreshWorkspaceModule(MONEY_DEMO_CLIENT_ID, "Calendar");
      }
    } finally {
      setMoneyDemoBusy(null);
    }
  }

  if (!signedIn) {
    return (
      <LoginScreen
        activeSessionId={activeSessionId}
        sessions={initialSessions}
        setActiveSessionId={setActiveSessionId}
        onSignIn={signIn}
      />
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <div className="brand-mark">
            <Sparkles size={22} />
          </div>
          <div>
            <strong>PhantomForce</strong>
            <span>AI operations app</span>
          </div>
        </div>

        <div className="org-switcher">
          <span>Organization</span>
          <select
            value={selectedOrg}
            onChange={(event) => setSelectedOrg(event.target.value)}
            disabled={!canManageAccess}
          >
            <option>PhantomForce Pilot</option>
            <option>Personal Training Simulation</option>
            <option>ChicagoShots</option>
            <option>Sports Ops Demo</option>
            {!canManageAccess ? <option>{selectedOrg}</option> : null}
          </select>
        </div>

        <nav className="side-nav" aria-label="Main navigation">
          {navItems.map((item) => (
            <button
              key={item.id}
              className={route === item.id ? "active" : ""}
              type="button"
              onClick={() => setRoute(item.id)}
              title={item.label}
            >
              {item.icon}
              <span>{item.label}</span>
              {item.id === "approvals" && stats.pending > 0 ? <b>{stats.pending}</b> : null}
            </button>
          ))}
        </nav>

        <div className="engine-card">
          <div>
            <span className="status-dot locked" />
            <p>Protected actions</p>
          </div>
          <strong>Private boundary</strong>
          <small>Customers see approved outcomes, not raw tools, files, logs, or shell access.</small>
        </div>
        <div className="engine-card truth-rail-card">
          <div>
            <span className="status-dot locked" />
            <p>Workspace status</p>
          </div>
          <strong>Setup required before live launch.</strong>
          <small>Phantom AI is demo-mode. Memory is setup-required. External actions stay approval-only.</small>
        </div>
      </aside>

      <main className="workspace">
        <Topbar activeSession={activeSession} selectedOrg={selectedOrg} pending={stats.pending} />
        {route === "command" ? (
          <CommandCenter
            messages={messages}
            commandText={commandText}
            setCommandText={setCommandText}
            submitCommand={submitCommand}
            createFollowUpPlan={() => createFollowUpPlan("demo")}
            stats={stats}
            approvals={approvals}
            approveAction={approveAction}
            rejectAction={rejectAction}
            emails={emails}
            events={events}
          />
        ) : null}
        {route === "inbox" ? <InboxView emails={emails} createFollowUpPlan={createFollowUpPlan} /> : null}
        {route === "calendar" ? <CalendarView events={events} /> : null}
        {route === "tasks" ? <TasksView tasks={tasks} completeTask={completeTask} /> : null}
        {route === "content" ? <ContentView /> : null}
        {route === "media" ? <MediaLabView /> : null}
        {route === "offers" ? <OffersView /> : null}
        {route === "approvals" ? (
          <ApprovalsView approvals={approvals} approveAction={approveAction} rejectAction={rejectAction} />
        ) : null}
        {route === "access" ? (
          <AccessView
            canManageAccess={canManageAccess}
            clientAccess={visibleClientAccess}
            guardedWorkspace={guardedWorkspace}
            workspaceModuleView={workspaceModuleView}
            pangolinPlan={pangolinPlan}
            pangolinStatus={pangolinStatus}
            readinessReport={readinessReport}
            refreshGuardedWorkspace={refreshGuardedWorkspace}
            refreshWorkspaceModule={refreshWorkspaceModule}
            refreshReadinessReport={refreshReadinessReport}
            updateClientAccess={updateClientAccess}
            updateClientModule={updateClientModule}
            runMoneyDemoStage={runMoneyDemoStage}
            moneyDemoBusy={moneyDemoBusy}
          />
        ) : null}
        {route === "activity" ? <ActivityView activity={activity} /> : null}
        {route === "connections" ? (
          <StatusView
            canManageAccess={canManageAccess}
            providerSetupStatus={providerSetupStatus}
            sessionHeaders={sessionHeaders}
          />
        ) : null}
        {route === "trainer" ? <TrainerSimulationView canManageAccess={canManageAccess} /> : null}
      </main>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        {navItems.map((item) => (
          <button
            key={item.id}
            className={route === item.id ? "active" : ""}
            type="button"
            onClick={() => setRoute(item.id)}
            title={item.label}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

function LoginScreen({
  activeSessionId,
  sessions,
  setActiveSessionId,
  onSignIn,
}: {
  activeSessionId: string;
  sessions: AppSession[];
  setActiveSessionId: (sessionId: string) => void;
  onSignIn: (sessionId: string) => void | Promise<void>;
}) {
  return (
    <main className="login-screen">
      <section className="login-copy">
        <div className="brand-row large">
          <div className="brand-mark">
            <Sparkles size={24} />
          </div>
          <div>
            <strong>PhantomForce AI</strong>
            <span>Business command app</span>
          </div>
        </div>
        <h1>Run the business from one command center.</h1>
        <p>
          Email, scheduling, approvals, tasks, activity history, and AI-assisted operations in one mobile-ready product.
        </p>
        <div className="hero-asset">
          <img src="/assets/operator-core.png" alt="PhantomForce operator interface preview" />
        </div>
      </section>
      <section className="login-panel">
        <span className="panel-label">Pilot access</span>
        <h2>One login. One business brain.</h2>
        <label>
          Email
          <input defaultValue="jordan@phantomforce.online" />
        </label>
        <label>
          Password
          <input type="password" defaultValue="phantomforce" />
        </label>
        <label>
          Session
          <select value={activeSessionId} onChange={(event) => setActiveSessionId(event.target.value)}>
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.label}
              </option>
            ))}
          </select>
        </label>
        <button className="primary-action" type="button" onClick={() => void onSignIn(activeSessionId)}>
          <KeyRound size={18} />
          Enter PhantomForce
        </button>
        <p className="account-disclaimer">
          By creating an account, you agree that PhantomForce provides software, automation tools, and AI-generated
          assistance. You are responsible for reviewing and approving any outputs, decisions, messages, content, or
          business actions taken through the platform. PhantomForce is not responsible for losses, missed opportunities,
          incorrect decisions, or actions you choose to take based on platform suggestions. AI outputs may be inaccurate
          and are not legal, financial, medical, or professional advice. See <a href="/terms">Terms</a> for details.
        </p>
        <div className="login-rails">
          <p>
            <Lock size={16} />
            Private access can be revoked cleanly when payment stops.
          </p>
          <p>
            <ShieldCheck size={16} />
            Actions stay approval-gated behind the business dashboard.
          </p>
        </div>
      </section>
    </main>
  );
}

function Topbar({
  activeSession,
  selectedOrg,
  pending,
}: {
  activeSession: AppSession;
  selectedOrg: string;
  pending: number;
}) {
  return (
    <header className="topbar">
      <div>
        <span className="eyebrow">Workspace</span>
        <h1>{selectedOrg}</h1>
        <span className={`session-chip ${activeSession.role}`}>
          {activeSession.role === "admin" ? "Admin access" : "Client workspace"}
        </span>
      </div>
      <div className="topbar-actions">
        <button type="button" title="Search">
          <Search size={18} />
        </button>
        <button type="button" title="Notifications">
          <Bell size={18} />
          {pending > 0 ? <b>{pending}</b> : null}
        </button>
        <button type="button" title="Settings">
          <Settings size={18} />
        </button>
      </div>
    </header>
  );
}

function CommandCenter({
  messages,
  commandText,
  setCommandText,
  submitCommand,
  createFollowUpPlan,
  stats,
  approvals,
  approveAction,
  rejectAction,
  emails,
  events,
}: {
  messages: Message[];
  commandText: string;
  setCommandText: (value: string) => void;
  submitCommand: (event: FormEvent) => void;
  createFollowUpPlan: () => void;
  stats: { urgent: number; pending: number; today: number; events: number };
  approvals: Approval[];
  approveAction: (id: string) => void;
  rejectAction: (id: string) => void;
  emails: EmailItem[];
  events: CalendarEvent[];
}) {
  const pendingApprovals = approvals.filter((approval) => approval.status === "pending");
  return (
    <div className="command-layout">
      <section className="command-main">
        <div className="hero-command">
          <div>
            <span className="eyebrow">AI command center</span>
            <h2>Ask. Review. Approve. Move the business.</h2>
            <p>
              PhantomForce turns inbox pressure, calendar gaps, and scattered tasks into approved business actions.
            </p>
          </div>
          <button className="demo-button" type="button" onClick={createFollowUpPlan}>
            <Play size={18} />
            Run first gold demo
          </button>
        </div>

        <div className="metric-grid">
          <Metric icon={<Mail size={18} />} label="Follow-ups" value={stats.urgent} tone="danger" />
          <Metric icon={<ShieldCheck size={18} />} label="Approvals" value={stats.pending} tone="gold" />
          <Metric icon={<SquareCheckBig size={18} />} label="Today tasks" value={stats.today} tone="green" />
          <Metric icon={<CalendarDays size={18} />} label="Calendar items" value={stats.events} tone="blue" />
        </div>

        <CustomerReadinessPanel />

        <section className="chat-card">
          <div className="section-head">
            <div>
              <span className="eyebrow">Phantom AI</span>
              <h3>Command thread</h3>
            </div>
            <span className="safe-pill">
              <ShieldCheck size={15} />
              Approval gated
            </span>
          </div>
          <div className="messages" aria-live="polite">
            {messages.map((message) => (
              <article className={`message ${message.role}`} key={message.id}>
                <div className="avatar">{message.role === "assistant" ? <Bot size={18} /> : <UserRound size={18} />}</div>
                <p>{message.content}</p>
              </article>
            ))}
          </div>
          <form className="command-form" onSubmit={submitCommand}>
            <input
              value={commandText}
              onChange={(event) => setCommandText(event.target.value)}
              placeholder="Ask PhantomForce to brief, reply, schedule, or handle a follow-up..."
            />
            <button type="submit" title="Send command">
              <Send size={18} />
            </button>
          </form>
        </section>
      </section>

      <aside className="command-side">
        <section className="panel asset-panel">
          <img src="/assets/falcon-stream.png" alt="Protected workflow stream" />
          <div>
            <span className="eyebrow">Backend power</span>
            <h3>Automation stays behind the glass.</h3>
            <p>Clients get safe typed outcomes, not raw execution controls.</p>
          </div>
        </section>

        <PhantomAiStatusPanel />

        <section className="panel">
          <div className="section-head compact">
            <h3>Action stack</h3>
            <span>{pendingApprovals.length} pending</span>
          </div>
          {pendingApprovals.length ? (
            <div className="stack-list">
              {pendingApprovals.slice(0, 2).map((approval) => (
                <ApprovalCard
                  key={approval.id}
                  approval={approval}
                  approveAction={approveAction}
                  rejectAction={rejectAction}
                  compact
                />
              ))}
            </div>
          ) : (
            <EmptyState icon={<ShieldCheck size={20} />} title="No pending approvals" detail="Run the demo or ask for a follow-up to create reviewable actions." />
          )}
        </section>

        <section className="panel">
          <div className="section-head compact">
            <h3>Live context</h3>
            <span>Read only</span>
          </div>
          <div className="context-list">
            <ContextRow icon={<Inbox size={17} />} title={emails[0].subject} detail={`${emails[0].from} - ${emails[0].age}`} />
            <ContextRow icon={<CalendarDays size={17} />} title={events[0].title} detail={`${events[0].time} - ${events[0].status}`} />
          </div>
        </section>
      </aside>
    </div>
  );
}

function Metric({ icon, label, value, tone }: { icon: ReactNode; label: string; value: number; tone: string }) {
  return (
    <article className={`metric ${tone}`}>
      <span>{icon}</span>
      <div>
        <strong>{value}</strong>
        <p>{label}</p>
      </div>
    </article>
  );
}

function InboxView({ emails, createFollowUpPlan }: { emails: EmailItem[]; createFollowUpPlan: () => void }) {
  const [mode, setMode] = useState<ResultMode>("recommended");
  const followUpItems: SimulationItem[] = emails.map((email) => ({
    title: email.subject,
    detail: `${email.from} - ${email.preview}`,
    status: email.status,
  }));
  const allItems = [...personalTrainingSimulation.leads, ...personalTrainingSimulation.clients, ...followUpItems];
  const recommendedItems = allItems.filter((item) =>
    ["hot", "approval", "needs-reply", "new"].includes(item.status ?? ""),
  );
  const visibleItems = mode === "recommended" ? recommendedItems : allItems;

  return (
    <Page title="Leads and clients" kicker="Lead intake" action={<button className="primary-small" onClick={createFollowUpPlan}><Sparkles size={16} /> Prepare follow-up</button>}>
      <section className="module-panel simulation-section">
        <div className="section-head">
          <div>
            <span className="eyebrow">AI filtered vs all results</span>
            <h3>{mode === "recommended" ? "Phantom AI recommended" : "All leads, clients, and follow-ups"}</h3>
          </div>
          <ResultModeToggle mode={mode} setMode={setMode} />
        </div>
        <SimulationList items={visibleItems} />
      </section>
    </Page>
  );
}

function CalendarView({ events }: { events: CalendarEvent[] }) {
  return (
    <Page title="Schedule" kicker="Sessions">
      <div className="timeline">
        {events.map((event) => (
          <article className="timeline-item" key={event.id}>
            <Clock3 size={18} />
            <div>
              <h3>{event.title}</h3>
              <p>{event.time}</p>
            </div>
            <span className={`status-badge ${event.status}`}>{event.status}</span>
          </article>
        ))}
      </div>
    </Page>
  );
}

function TasksView({ tasks, completeTask }: { tasks: TaskItem[]; completeTask: (id: string) => void }) {
  const [mode, setMode] = useState<ResultMode>("recommended");
  const visibleTasks = mode === "recommended" ? tasks.filter((task) => task.status === "today") : tasks;

  return (
    <Page title="Task operations" kicker="Execution queue" action={<button className="ghost-small"><Plus size={16} /> New task</button>}>
      <section className="module-panel simulation-section">
        <div className="section-head">
          <div>
            <span className="eyebrow">AI filtered vs all results</span>
            <h3>{mode === "recommended" ? "Today and high-leverage tasks" : "All task results"}</h3>
          </div>
          <ResultModeToggle mode={mode} setMode={setMode} />
        </div>
        <p>Phantom AI can recommend the next task to review, but completing or sending anything sensitive stays approval-only.</p>
      </section>
      <div className="task-list">
        {visibleTasks.map((task) => (
          <article className={`task-row ${task.status}`} key={task.id}>
            <button type="button" onClick={() => completeTask(task.id)} title="Complete task">
              <Check size={17} />
            </button>
            <div>
              <h3>{task.title}</h3>
              <p>{task.owner} - due {task.due}</p>
            </div>
            <span>{task.status}</span>
          </article>
        ))}
      </div>
    </Page>
  );
}

function ApprovalsView({
  approvals,
  approveAction,
  rejectAction,
}: {
  approvals: Approval[];
  approveAction: (id: string) => void;
  rejectAction: (id: string) => void;
}) {
  const [mode, setMode] = useState<ResultMode>("recommended");
  const visibleApprovals =
    mode === "recommended" ? approvals.filter((approval) => approval.status === "pending") : approvals;
  const demoApprovals =
    mode === "recommended"
      ? personalTrainingSimulation.approvals.filter((approval) => approval.status === "pending")
      : personalTrainingSimulation.approvals;

  return (
    <Page title="Approval cockpit" kicker="Human oversight">
      <section className="module-panel simulation-section">
        <div className="section-head">
          <div>
            <span className="eyebrow">AI filtered vs all results</span>
            <h3>{mode === "recommended" ? "Pending approval queue" : "All approval records"}</h3>
          </div>
          <ResultModeToggle mode={mode} setMode={setMode} />
        </div>
        <p>External sends, uploads, posts, billing, credentials, and production changes stay blocked until approved.</p>
      </section>
      {visibleApprovals.length ? (
        <div className="approval-grid">
          {visibleApprovals.map((approval) => (
            <ApprovalCard
              key={approval.id}
              approval={approval}
              approveAction={approveAction}
              rejectAction={rejectAction}
            />
          ))}
        </div>
      ) : (
        <section className="module-panel simulation-section">
          <div className="simulation-section-head">
            <span>
              <ShieldCheck size={18} />
            </span>
            <h3>Demo approval queue</h3>
          </div>
          <SimulationList items={demoApprovals} />
        </section>
      )}
    </Page>
  );
}

function ContentView() {
  const [mode, setMode] = useState<ResultMode>("recommended");
  const recommendedContent = [
    ...personalTrainingSimulation.contentIdeas.filter((item) => ["recommended", "approval"].includes(item.status ?? "")),
    ...personalTrainingSimulation.contentCalendar.filter((item) => item.status === "approval"),
  ];
  const allContent = [...personalTrainingSimulation.contentCalendar, ...personalTrainingSimulation.contentIdeas];
  const visibleContent = mode === "recommended" ? recommendedContent : allContent;
  const platformPlaceholders: SimulationItem[] = [
    { title: "Instagram", detail: "Draft planning only. Posting is not wired.", status: "placeholder" },
    { title: "Email newsletter", detail: "Ideas can be queued, but sends require approval and future wiring.", status: "placeholder" },
    { title: "Short-form video", detail: "Publish and upload actions are disabled in this simulation.", status: "approval only" },
  ];

  return (
    <Page title="Content" kicker="Calendar and drafts" action={<TruthBadge state="real" label="Approval only" />}>
      <section className="module-panel simulation-section">
        <div className="section-head">
          <div>
            <span className="eyebrow">AI filtered vs all results</span>
            <h3>{mode === "recommended" ? "Recommended posts" : "All content ideas and calendar items"}</h3>
          </div>
          <ResultModeToggle mode={mode} setMode={setMode} />
        </div>
        <SimulationList items={visibleContent} />
      </section>

      <div className="destination-grid">
        <SimulationSection icon={<CalendarDays size={18} />} title="Content calendar" items={personalTrainingSimulation.contentCalendar} />
        <SimulationSection icon={<FileText size={18} />} title="Raw content queue" items={personalTrainingSimulation.contentIdeas} />
        <SimulationSection icon={<ShieldCheck size={18} />} title="Drafts pending approval" items={personalTrainingSimulation.contentDrafts} />
        <SimulationSection icon={<AlertTriangle size={18} />} title="Platform status placeholders" items={platformPlaceholders} />
      </div>
    </Page>
  );
}

function MediaLabView() {
  return (
    <Page title="Media Lab" kicker="Requests and delivery" action={<TruthBadge state="demo" label="Optional add-on" />}>
      <section className="simulation-hero">
        <div>
          <span className="eyebrow">Media workflow</span>
          <h3>Video and asset work stays an add-on to the owner cockpit.</h3>
          <p>
            Media Lab helps track requests, drafts, consent, and delivery status. Uploads, delivery links, and external
            publishing are placeholders until approval and storage gates are implemented.
          </p>
        </div>
        <div className="simulation-hero-status">
          <StatusLine label="Uploads" value="Placeholder / not wired" />
          <StatusLine label="Delivery" value="Approval required" />
          <StatusLine label="Core app" value="Leads, schedule, offers, tasks, approvals" />
        </div>
      </section>

      <div className="destination-grid">
        <SimulationSection icon={<Play size={18} />} title="Media requests" items={personalTrainingSimulation.mediaRequests} />
        <SimulationSection icon={<SquareCheckBig size={18} />} title="Deliverables and workflow status" items={personalTrainingSimulation.mediaDeliverables} />
        <SimulationSection icon={<AlertTriangle size={18} />} title="Uploads and delivery placeholders" items={personalTrainingSimulation.mediaPlaceholders} />
        <PhantomCutAddonCard />
      </div>
    </Page>
  );
}

function OffersView() {
  const [mode, setMode] = useState<ResultMode>("recommended");
  const allOfferItems = [
    ...personalTrainingSimulation.services,
    ...personalTrainingSimulation.offerRecommendations,
    ...personalTrainingSimulation.pricingDrafts,
  ];
  const recommendedOfferItems = personalTrainingSimulation.offerRecommendations.filter((item) =>
    ["recommended", "approval"].includes(item.status ?? ""),
  );
  const visibleOfferItems = mode === "recommended" ? recommendedOfferItems : allOfferItems;
  const approvalItems = personalTrainingSimulation.approvals.filter((item) =>
    item.title.toLowerCase().includes("offer") || item.title.toLowerCase().includes("payment"),
  );

  return (
    <Page title="Offers" kicker="Packages and pricing" action={<TruthBadge state="demo" label="Demo packages" />}>
      <section className="module-panel simulation-section">
        <div className="section-head">
          <div>
            <span className="eyebrow">AI filtered vs all results</span>
            <h3>{mode === "recommended" ? "Offer recommendations" : "All packages, recommendations, and drafts"}</h3>
          </div>
          <ResultModeToggle mode={mode} setMode={setMode} />
        </div>
        <SimulationList items={visibleOfferItems} />
      </section>

      <div className="destination-grid">
        <SimulationSection icon={<Sparkles size={18} />} title="Personal training packages" items={personalTrainingSimulation.services} />
        <SimulationSection icon={<Zap size={18} />} title="Offer builder recommendations" items={personalTrainingSimulation.offerRecommendations} />
        <SimulationSection icon={<FileText size={18} />} title="Pricing and package drafts" items={personalTrainingSimulation.pricingDrafts} />
        <SimulationSection icon={<ShieldCheck size={18} />} title="Approval status" items={approvalItems} />
      </div>
    </Page>
  );
}

function ActivityView({ activity }: { activity: ActivityItem[] }) {
  return (
    <Page title="Activity and audit" kicker="Traceability">
      <div className="activity-feed">
        {activity.map((item) => (
          <article className={`activity-item ${item.level}`} key={item.id}>
            <span />
            <div>
              <h3>{item.title}</h3>
              <p>{item.detail}</p>
            </div>
            <time>{item.time}</time>
          </article>
        ))}
      </div>
    </Page>
  );
}

function AccessView({
  canManageAccess,
  clientAccess,
  guardedWorkspace,
  workspaceModuleView,
  pangolinPlan,
  pangolinStatus,
  readinessReport,
  refreshGuardedWorkspace,
  refreshWorkspaceModule,
  refreshReadinessReport,
  updateClientAccess,
  updateClientModule,
  runMoneyDemoStage,
  moneyDemoBusy,
}: {
  canManageAccess: boolean;
  clientAccess: ClientAccess[];
  guardedWorkspace: GuardedWorkspace | null;
  workspaceModuleView: WorkspaceModuleView | null;
  pangolinPlan: PangolinRoutePlan[];
  pangolinStatus: PangolinReadOnlyStatus | null;
  readinessReport: ProductionReadinessReport | null;
  refreshGuardedWorkspace: (clientId?: string) => void;
  refreshWorkspaceModule: (clientId: string, moduleKey?: string) => void;
  refreshReadinessReport: () => void;
  updateClientAccess: (id: string, nextStatus: ClientAccessStatus) => void;
  updateClientModule: (id: string, moduleKey: string, enabled: boolean) => void;
  runMoneyDemoStage: (stage: MoneyDemoStage) => void;
  moneyDemoBusy: MoneyDemoStage | null;
}) {
  const moneyDemoClient = clientAccess.find((client) => client.id === MONEY_DEMO_CLIENT_ID);
  const moneyDemoStages: Array<{ id: MoneyDemoStage; label: string; detail: string }> = [
    {
      id: "signed",
      label: "Signed",
      detail: "Agreement landed from NexProspex; workspace is blocked until payment clears.",
    },
    {
      id: "paid",
      label: "Paid",
      detail: "Payment activates modules, private route plan, and the Calendar boundary.",
    },
    {
      id: "past_due",
      label: "Past due",
      detail: "Route stays reachable while PhantomForce handlers enforce read-only.",
    },
    {
      id: "revoked",
      label: "Revoked",
      detail: "Private route plan disables access and the app blocks workspace requests.",
    },
    {
      id: "restored",
      label: "Restored",
      detail: "Paid access returns with modules and credential reference intact.",
    },
  ];

  return (
    <Page title="Settings and access" kicker="Workspace access">
      <section className="access-hero">
        <div>
          <span className="eyebrow">Private business OS</span>
          <h3>Payment controls the doorway. PhantomForce controls the workspace.</h3>
          <p>
            {canManageAccess
              ? "Customers get a simple dashboard. Jordan gets module entitlements, private routes, revocation, and audit history."
              : "This workspace only shows the modules and access state currently allowed by PhantomForce."}
          </p>
        </div>
        <div className="access-proof">
          <KeyRound size={22} />
          <strong>Paid users enter</strong>
          <span>Past-due users can be blocked without exposing backend services.</span>
        </div>
      </section>

      {canManageAccess ? (
        <section className="money-demo-panel" data-testid="money-demo-panel">
          <div className="route-panel-head">
            <div>
              <span className="eyebrow">Revenue proof</span>
              <h3>NexProspex win to paid workspace</h3>
            </div>
            <span className={`money-demo-status ${moneyDemoClient?.accessStatus ?? "revoked"}`}>
              {moneyDemoClient
                ? `${moneyDemoClient.paymentStatus} / ${moneyDemoClient.accessStatus}`
                : "not provisioned"}
            </span>
          </div>
          <div className="money-demo-steps">
            {moneyDemoStages.map((stage, index) => (
              <button
                type="button"
                data-testid={`money-demo-${stage.id}`}
                disabled={moneyDemoBusy !== null}
                key={stage.id}
                onClick={() => runMoneyDemoStage(stage.id)}
              >
                <span>{index + 1}</span>
                <strong>{moneyDemoBusy === stage.id ? "Running" : stage.label}</strong>
                <small>{stage.detail}</small>
              </button>
            ))}
          </div>
          <div className="money-demo-proof">
            <span>{moneyDemoClient?.privateRoute ?? "app.phantomforce.online/money-demo-athletics"}</span>
            <span>Calendar credential ref: local-demo:{MONEY_DEMO_CLIENT_ID}:calendar</span>
            <span>Approval and audit required</span>
          </div>
          <div className="demo-boundary-strip" data-testid="money-demo-production-boundary">
            <strong>{readinessReport?.localDemoReady ? "Local demo verified" : "Demo gates checking"}</strong>
            <span>
              {readinessReport?.productionReady
                ? "Production gates are clear."
                : "Not production: real auth, live OAuth, Pangolin verification, deployment, and production Postgres still need gates cleared."}
            </span>
          </div>
        </section>
      ) : null}

      {canManageAccess ? (
        <section className="readiness-panel" data-testid="readiness-panel">
          <div className="route-panel-head">
            <div>
              <span className="eyebrow">Production gates</span>
              <h3>{readinessReport?.productionReady ? "Production ready" : "Local demo ready"}</h3>
            </div>
            <div className="readiness-actions">
              <span className={`readiness-pill ${readinessReport?.productionReady ? "ready" : "needs_config"}`}>
                {readinessReport?.productionReady ? "production ready" : "not production"}
              </span>
              <button type="button" onClick={refreshReadinessReport}>
                <RefreshCcw size={16} />
                Refresh
              </button>
            </div>
          </div>
          <p>{readinessReport?.summary ?? "Readiness gates have not loaded yet."}</p>
          <div className="readiness-grid">
            {(readinessReport?.gates ?? []).map((gate) => (
              <article className={`readiness-card ${gate.status}`} data-testid={`readiness-${gate.id}`} key={gate.id}>
                <div>
                  <strong>{gate.label}</strong>
                  <span>{gate.status.replace("_", " ")}</span>
                </div>
                <p>{gate.detail}</p>
                <small>{gate.evidence}</small>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="guard-panel" data-testid="access-guard-panel">
        <div>
          <span className="eyebrow">Request-time guard</span>
          <h3>{guardedWorkspace?.business ?? "Sports Ops Demo"}</h3>
          <p>
            This panel calls the same backend decision endpoint a client workspace uses before loading private modules.
          </p>
        </div>
        <div className={`guard-decision ${guardedWorkspace?.mode ?? "blocked"}`}>
          <strong>{guardedWorkspace?.mode ?? "checking"}</strong>
          <span>{guardedWorkspace?.reason ?? "Checking live server decision."}</span>
        </div>
        <div className="guard-modules">
          {(guardedWorkspace?.modules.length ? guardedWorkspace.modules : ["No modules available"]).map((module) => (
            <button
              type="button"
              key={module}
              disabled={!guardedWorkspace || module === "No modules available"}
              onClick={() => refreshWorkspaceModule(guardedWorkspace?.id ?? "client-sports-demo", module)}
            >
              {module}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => refreshGuardedWorkspace()}>
          <RefreshCcw size={16} />
          Refresh guard
        </button>
      </section>

      {workspaceModuleView ? (
        <section className="module-view-panel" data-testid="module-view-panel">
          <div className="route-panel-head">
            <div>
              <span className="eyebrow">Guarded module handler</span>
              <h3>{workspaceModuleView.title}</h3>
            </div>
            <span className={`module-access-pill ${workspaceModuleView.writeAccess ? "write" : "read"}`}>
              {workspaceModuleView.writeAccess ? "Write enabled" : "Read only"}
            </span>
          </div>
          <p>{workspaceModuleView.summary}</p>
          {workspaceModuleView.connector ? (
            <div className="module-connector-boundary">
              <span>connector: {workspaceModuleView.connector.id}</span>
              <span>{workspaceModuleView.connector.provider}</span>
              <span>{workspaceModuleView.connector.credentialMode}</span>
              <span>{workspaceModuleView.connector.status}</span>
              <span>{workspaceModuleView.connector.credentialSource}</span>
              {workspaceModuleView.connector.credentialRef ? (
                <span>ref: {workspaceModuleView.connector.credentialRef}</span>
              ) : null}
              <span>{workspaceModuleView.connector.readOnly ? "read only" : "write capable"}</span>
              <small>{workspaceModuleView.connector.reason}</small>
            </div>
          ) : null}
          <div className="module-view-grid">
            {workspaceModuleView.widgets.map((widget) => (
              <div className="module-widget" key={widget.id}>
                <span>{widget.label}</span>
                <strong>{widget.value}</strong>
              </div>
            ))}
          </div>
          <div className="module-view-body">
            <div>
              <span className="eyebrow">Records</span>
              <div className="module-record-list">
                {workspaceModuleView.records.map((record) => (
                  <article key={record.id}>
                    <strong>{record.title}</strong>
                    <span>{record.status}</span>
                  </article>
                ))}
              </div>
            </div>
            <div>
              <span className="eyebrow">Actions</span>
              <div className="module-action-list">
                {workspaceModuleView.primaryActions.map((action) => (
                  <span className="module-action enabled" key={action.id}>
                    {action.label}
                  </span>
                ))}
                {workspaceModuleView.disabledActions.map((action) => (
                  <span className="module-action disabled" key={action.id}>
                    {action.label}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>
      ) : (
        <section className="module-view-panel empty" data-testid="module-view-panel">
          <span className="eyebrow">Guarded module handler</span>
          <h3>No module payload loaded</h3>
          <p>Choose an enabled workspace module to inspect the handler output.</p>
        </section>
      )}

      {canManageAccess ? (
        <section className="pangolin-panel" data-testid="pangolin-dry-run-panel">
          <div className="route-panel-head">
            <div>
              <span className="eyebrow">Pangolin route dry-run</span>
              <h3>Private gateway plan</h3>
            </div>
            <span className="dry-run-pill">No live changes</span>
          </div>
          <div className={`gateway-status ${pangolinStatus?.status ?? "unconfigured"}`} data-testid="pangolin-readonly-status">
            <strong>{pangolinStatus?.status ?? "unconfigured"}</strong>
            <span>{pangolinStatus?.reason ?? "Read-only gateway verification has not run yet."}</span>
            <small>
              {pangolinStatus?.configured
                ? `${pangolinStatus.baseUrl}${pangolinStatus.healthPath ?? ""}`
                : "PANGOLIN_READONLY_BASE_URL not configured"}
            </small>
          </div>
          <div className="pangolin-grid">
            {pangolinPlan.map((plan) => (
              <article
                className="pangolin-route"
                data-testid={`pangolin-route-${plan.clientId}`}
                key={plan.clientId}
              >
                <div>
                  <h4>{plan.business}</h4>
                  <p>{plan.privateRoute}</p>
                </div>
                <span className={`route-state ${plan.desiredState}`}>
                  {plan.desiredState.replace("_", " ")}
                </span>
                <div className="route-meta">
                  <span>{plan.paymentStatus}</span>
                  <span>{plan.mode}</span>
                  <span>gateway: {plan.gatewayEnforcement.replace("_", " ")}</span>
                  <span>app: {plan.appEnforcement.replace("_", " ")}</span>
                  <span>{plan.modules.length} modules</span>
                </div>
                <p className="route-note">{plan.enforcementNote}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <div className="access-grid">
        {clientAccess.map((client) => (
          <article className={`access-card ${client.accessStatus}`} data-testid={`access-card-${client.id}`} key={client.id}>
            <div className="record-top">
              <div>
                <h3>{client.business}</h3>
                <p>{client.owner}</p>
              </div>
              <span className={`status-badge ${client.accessStatus}`}>{client.accessStatus}</span>
            </div>
            <dl className="payload">
              <div>
                <dt>Plan</dt>
                <dd>{client.plan}</dd>
              </div>
              <div>
                <dt>Payment</dt>
                <dd>{client.paymentStatus}</dd>
              </div>
              <div>
                <dt>Private route</dt>
                <dd>{client.privateRoute}</dd>
              </div>
              <div>
                <dt>Audit</dt>
                <dd>{client.lastAudit}</dd>
              </div>
            </dl>
            {canManageAccess ? (
              <div className="module-control-list" aria-label={`${client.business} module entitlements`}>
                {Array.from(new Set([...clientModuleCatalog, ...client.modules])).map((module) => {
                  const enabled = client.modules.some(
                    (clientModule) => normalizeModuleKey(clientModule) === normalizeModuleKey(module),
                  );

                  return (
                    <button
                      type="button"
                      className={`module-toggle ${enabled ? "enabled" : "disabled"}`}
                      data-testid={moduleTestId(client.id, module)}
                      key={module}
                      onClick={() => updateClientModule(client.id, module, !enabled)}
                    >
                      {enabled ? <Check size={14} /> : <Plus size={14} />}
                      <span>{module}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="module-list">
                {client.modules.map((module) => (
                  <span key={module}>{module}</span>
                ))}
              </div>
            )}
            {canManageAccess ? (
              <div className="access-actions">
                <button
                  type="button"
                  data-testid={`access-restore-${client.id}`}
                  onClick={() => updateClientAccess(client.id, "active")}
                >
                  <Check size={16} />
                  Restore
                </button>
                <button
                  type="button"
                  data-testid={`access-due-${client.id}`}
                  onClick={() => updateClientAccess(client.id, "past_due")}
                >
                  <Clock3 size={16} />
                  Mark due
                </button>
                <button
                  type="button"
                  data-testid={`access-revoke-${client.id}`}
                  onClick={() => updateClientAccess(client.id, "revoked")}
                >
                  <ToggleLeft size={16} />
                  Revoke
                </button>
              </div>
            ) : (
              <p className="access-note">Access changes require PhantomForce admin approval.</p>
            )}
          </article>
        ))}
      </div>
    </Page>
  );
}

function StatusView({
  canManageAccess,
  providerSetupStatus,
  sessionHeaders,
}: {
  canManageAccess: boolean;
  providerSetupStatus: ProviderSetupStatus;
  sessionHeaders: (json?: boolean) => Record<string, string>;
}) {
  const [showDebug, setShowDebug] = useState(false);

  return (
    <Page
      title="Status"
      kicker="Launch readiness"
      action={<TruthBadge state="blocked" label="Needs setup" />}
    >
      <CustomerReadinessPanel />
      {canManageAccess ? <ProviderSetupPanel status={providerSetupStatus} /> : null}
      {canManageAccess ? <HermesRouterDebugPanel sessionHeaders={sessionHeaders} /> : null}
      <section className="module-panel simulation-section">
        <div className="section-head">
          <div>
            <span className="eyebrow">Customer-safe status</span>
            <h3>Launch blockers stay visible without exposing the tool stack.</h3>
          </div>
        </div>
        <div className="simulation-list">
          {personalTrainingSimulation.launchBlockers.map((item) => (
            <article key={`status-${item.title}`}>
              <div>
                <strong>{item.title}</strong>
                <p>{item.detail}</p>
              </div>
              <span className="simulation-status">{item.status}</span>
            </article>
          ))}
        </div>
      </section>
      {canManageAccess ? (
        <section className="panel debug-panel">
          <div className="section-head compact">
            <div>
              <span className="eyebrow">Admin/debug</span>
              <h3>Background workforce status</h3>
            </div>
            <button className="ghost-small" type="button" onClick={() => setShowDebug((value) => !value)}>
              {showDebug ? "Hide debug" : "Show debug"}
            </button>
          </div>
          <p>
            This is for owner/support visibility only. Customers stay in PhantomForce and Phantom AI product language.
          </p>
          {showDebug ? (
            <>
              <AdminDebugStatusPanel />
              <div className="connection-grid">
                {connections.map((connection) => (
                  <article className={`connection-card ${connection.status}`} key={connection.id}>
                    <div className="record-top">
                      <h3>{connection.name}</h3>
                      <span className={`status-badge ${connection.status}`}>{connection.status}</span>
                    </div>
                    <p>{connection.description}</p>
                    <div className="scope-list">
                      {connection.scopes.map((scope) => (
                        <span key={scope}>{scope}</span>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            </>
          ) : null}
        </section>
      ) : null}
    </Page>
  );
}

function CustomerReadinessPanel() {
  return (
    <section className="panel truth-panel">
      <div className="section-head">
        <div>
          <span className="eyebrow">PhantomForce status</span>
          <h3>What the owner can safely trust today.</h3>
        </div>
        <TruthBadge state="demo" label="Online - protected" />
      </div>
      <div className="truth-grid">
        {customerStatusLabels.map((item) => (
          <article className={`truth-item ${item.state}`} key={item.label}>
            <div>
              <span>{item.label}</span>
              <TruthBadge state={item.state} label={item.value} />
            </div>
            <strong>{item.value}</strong>
            <p>{item.detail}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function ProviderSetupPanel({ status }: { status: ProviderSetupStatus }) {
  const paymentNeeded = status.openrouter_glm.payment_setup_needed ? "Yes" : "No";

  return (
    <section className="panel provider-setup-panel">
      <div className="section-head">
        <div>
          <span className="eyebrow">Admin setup</span>
          <h3>Phantom AI provider and Hermes foundation.</h3>
        </div>
        <TruthBadge state="demo" label={`Brain: ${status.router_mode}`} />
      </div>
      <p>
        Normal owners use Phantom AI. Provider setup, budget planning, and Hermes status stay in owner/admin setup.
      </p>
      <div className="provider-grid">
        <ProviderStatusCard
          label="PhantomForce Managed"
          value="Recommended / Default"
          detail={status.phantomforce_managed.detail}
          state="real"
        />
        <ProviderStatusCard
          label="OpenRouter GLM"
          value={`${status.openrouter_glm.status} / ${status.openrouter_glm.model_id}`}
          detail={status.openrouter_glm.detail}
          state={status.openrouter_glm.configured ? "real" : "stub"}
        />
        <ProviderStatusCard
          label="Claude API"
          value={status.claude_api.status}
          detail={status.claude_api.detail}
          state={status.claude_api.configured ? "real" : "stub"}
        />
        <ProviderStatusCard
          label="Private API lane"
          value="Private APIs save lives"
          detail="Model routing stays private behind Phantom AI. Customers see protected assistance, not infrastructure details."
          state={status.local_fallback.available ? "real" : "stub"}
        />
        <ProviderStatusCard
          label="Bring Your Own Key"
          value={status.byok.status}
          detail={status.byok.detail}
          state="blocked"
        />
        <ProviderStatusCard
          label="Budget cap"
          value={status.budget.status}
          detail={status.budget.detail}
          state="stub"
        />
        <ProviderStatusCard
          label="Payment/setup needed"
          value={paymentNeeded}
          detail="Do not fund OpenRouter yet. PhantomForce never stores card details here, and payment waits until every live-smoke gate passes."
          state={status.openrouter_glm.payment_setup_needed ? "blocked" : "real"}
        />
        <ProviderStatusCard
          label="Hermes ledger"
          value={status.hermes.ledger_enabled ? "Enabled" : "Disabled"}
          detail={`${status.hermes.status}; path ${status.hermes.ledger_path}`}
          state={status.hermes.ledger_enabled ? "real" : "stub"}
        />
        <ProviderStatusCard
          label="Context compiler"
          value={status.hermes.context_compiler_enabled ? "Enabled" : "Disabled"}
          detail="Compiles compact packets for token saving. Full history is not dumped into models."
          state={status.hermes.context_compiler_enabled ? "real" : "stub"}
        />
        <ProviderStatusCard
          label="PhantomPlus"
          value={status.phantom_plus.status}
          detail={`${status.phantom_plus.detail} Agent loops: ${status.phantom_plus.agent_loop_status}.`}
          state="stub"
        />
      </div>
    </section>
  );
}

function ProviderStatusCard({
  label,
  value,
  detail,
  state,
}: {
  label: string;
  value: string;
  detail: string;
  state: TruthState;
}) {
  return (
    <article className={`provider-card ${state}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function actionPreviewState(status: HermesContextPreview["action_preview"]["status"]): TruthState {
  if (status === "safe") return "real";
  if (status === "pending_approval" || status === "live_provider_required") return "stub";
  return "blocked";
}

function approvalPreviewState(approval: HermesContextPreview["approval_request"]): TruthState {
  if (approval.status === "blocked" || approval.risk_level === "critical" || approval.risk_level === "high") {
    return "blocked";
  }

  if (approval.status === "pending" || approval.risk_level === "medium") return "stub";
  return "real";
}

function formatSafetyFlag(flag: string) {
  return flag.replace(/_/g, " ");
}

function queueRecordState(record: ApprovalQueueRecordPreview): TruthState {
  if (record.latest_review_status === "dismissed" || record.latest_review_status === "expired") return "blocked";
  if (record.latest_review_status === "needs_changes") return "stub";
  if (record.latest_review_status === "reviewed") return "real";
  if (record.queue_status === "blocked_preview" || record.approval.risk_level === "critical") return "blocked";
  if (record.queue_status === "pending" || record.approval.risk_level === "medium") return "stub";
  return "real";
}

function budgetGuardState(status: BudgetGuardStatus): TruthState {
  if (status === "blocked") return "blocked";
  if (status === "warning") return "stub";
  if (status === "disabled") return "demo";
  return "real";
}

function liveSmokeGateState(status: LiveSmokePreflightGateStatus): TruthState {
  if (status === "pass") return "real";
  if (status === "not_implemented") return "stub";
  return "blocked";
}

function readinessRouteState(route: ProviderReadinessRoute): TruthState {
  if (route.live_call_allowed || route.enabled) return "blocked";
  if (route.id === "mock" && route.configured) return "real";
  if (route.status === "configured") return "stub";
  if (route.status === "disabled") return "blocked";
  return "demo";
}

function ProviderReadinessPanel({ readiness }: { readiness: ProviderReadinessReport | null }) {
  if (!readiness) {
    return (
      <div className="provider-readiness-panel">
        <div className="section-head compact">
          <div>
            <span className="eyebrow">Provider Readiness</span>
            <h3>Admin-only setup status</h3>
          </div>
          <TruthBadge state="demo" label="Not loaded" />
        </div>
        <p className="execution-disabled-banner">
          Readiness not loaded. No live provider calls can run from this app state.
        </p>
      </div>
    );
  }

  return (
    <div className="provider-readiness-panel">
      <div className="section-head compact">
        <div>
          <span className="eyebrow">Provider Readiness</span>
          <h3>Admin-only provider setup status</h3>
        </div>
        <TruthBadge state="real" label="Readiness/status only" />
      </div>
      <p className="execution-disabled-banner">
        READINESS ONLY: key presence is boolean/masked, raw env values are not shown, and no provider network check or
        live model call is performed.
      </p>
      <div className="provider-grid">
        <ProviderStatusCard
          label="Mock provider"
          value="Available"
          detail="The built-in preview route remains the recommended safe route."
          state="real"
        />
        <ProviderStatusCard
          label="Live provider calls"
          value="Disabled"
          detail={readiness.admin_debug_summary}
          state="blocked"
        />
        <ProviderStatusCard
          label="Any live route configured"
          value={readiness.any_live_route_configured ? "Yes / disabled" : "No"}
          detail="Configured only means prerequisites are present; execution is still disabled."
          state={readiness.any_live_route_configured ? "stub" : "demo"}
        />
        <ProviderStatusCard
          label="Production ready"
          value={readiness.production_ready ? "Yes" : "No"}
          detail="Provider readiness does not make PhantomForce production-ready."
          state={readiness.production_ready ? "blocked" : "real"}
        />
      </div>
      <div className="provider-readiness-list">
        {readiness.routes.map((route) => (
          <article className={`provider-readiness-record ${readinessRouteState(route)}`} key={route.id}>
            <div className="record-top">
              <div>
                <span>{route.status.replace(/_/g, " ")}</span>
                <strong>{route.label}</strong>
                <p>{route.detail}</p>
              </div>
              <TruthBadge state={readinessRouteState(route)} label={route.live_call_allowed ? "Unsafe" : "No live call"} />
            </div>
            <div className="approval-queue-meta">
              <span>Configured: {route.configured ? "yes" : "no"}</span>
              <span>Enabled: {route.enabled ? "yes" : "no"}</span>
              <span>Key source: {route.key_source.replace(/_/g, " ")}</span>
              <span>Key present: {route.key_present ? "yes" : "no"}</span>
              <span>Key preview: {route.key_preview}</span>
              <span>Model: {route.model_id ?? "Not configured"}</span>
              <span>Setup required: {route.setup_required ? "yes" : "no"}</span>
              <span>Checked: {route.last_checked_at}</span>
              <span>Client-safe: {route.client_safe_status}</span>
              <span>Network check: {route.safety_flags.network_check_performed ? "yes" : "no"}</span>
            </div>
            <p className="access-note">{route.disabled_reason}</p>
            {route.missing.length ? (
              <div className="context-preview">
                <div className="section-head compact">
                  <div>
                    <span className="eyebrow">Missing setup</span>
                    <h3>{route.client_safe_label}</h3>
                  </div>
                </div>
                <ul>
                  {route.missing.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </article>
        ))}
      </div>
      <div className="context-preview">
        <div className="section-head compact">
          <div>
            <span className="eyebrow">Required before live calls</span>
            <h3>Readiness checklist</h3>
          </div>
          <TruthBadge state="blocked" label="Still disabled" />
        </div>
        <ul>
          {readiness.required_before_live.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ProviderPolicyGatePanel({ policy }: { policy: ProviderPolicyPreview | null }) {
  if (!policy) {
    return (
      <div className="provider-policy-panel">
        <div className="section-head compact">
          <div>
            <span className="eyebrow">Provider Policy Gate</span>
            <h3>Admin-only live call policy</h3>
          </div>
          <TruthBadge state="demo" label="Not loaded" />
        </div>
        <p className="execution-disabled-banner">
          Policy preview not loaded. Live calls remain disabled unless the server proves otherwise.
        </p>
      </div>
    );
  }

  return (
    <div className="provider-policy-panel">
      <div className="section-head compact">
        <div>
          <span className="eyebrow">Provider Policy Gate</span>
          <h3>Admin-only live call and budget guard</h3>
        </div>
        <TruthBadge state={policy.route_allowed ? "blocked" : "real"} label="No live call allowed" />
      </div>
      <p className="execution-disabled-banner">
        POLICY PREVIEW ONLY: route selection, budget guard, and approval metadata are visible here, but no provider,
        billing, upload, post, delete, deploy, or approval execution can run.
      </p>
      <div className="debug-safety-strip">
        <TruthBadge state="real" label="Admin only" />
        <TruthBadge state="real" label="No API keys stored" />
        <TruthBadge state="stub" label="Budget guard preview" />
        <TruthBadge state="blocked" label="Live calls disabled" />
      </div>
      <div className="provider-grid">
        <ProviderStatusCard
          label="Route allowed"
          value={policy.route_allowed ? "Yes" : "No"}
          detail={policy.live_call_disabled_reason}
          state={policy.route_allowed ? "blocked" : "real"}
        />
        <ProviderStatusCard
          label="Route status"
          value={policy.route_status.replace(/_/g, " ")}
          detail={policy.admin_debug_summary}
          state={policy.route_status === "blocked" ? "blocked" : "stub"}
        />
        <ProviderStatusCard
          label="Provider policy"
          value={policy.policy_status.replace(/_/g, " ")}
          detail={policy.policy.client_safe_status}
          state={policy.policy_status === "budget_blocked" || policy.policy_status === "blocked" ? "blocked" : "stub"}
        />
        <ProviderStatusCard
          label="Budget guard"
          value={policy.budget.status}
          detail={policy.budget.reasons.join(" ")}
          state={budgetGuardState(policy.budget.status)}
        />
        <ProviderStatusCard
          label="Budget enforcement"
          value={policy.budget.enforcement_mode.replace(/_/g, " ")}
          detail={`Request caps: ${policy.budget.per_request_estimated_token_cap} tokens / $${policy.budget.per_request_estimated_cost_cap_usd.toFixed(2)} estimated cost.`}
          state="stub"
        />
        <ProviderStatusCard
          label="Managed mode"
          value={policy.policy.managed_provider_mode.replace(/_/g, " ")}
          detail={`BYOK: ${policy.policy.byok_status.replace(/_/g, " ")}. Private API lane: ${policy.policy.local_fallback_status.replace(/_/g, " ")}.`}
          state="demo"
        />
      </div>
      <div className="approval-meta-grid">
        <span>Monthly cap: ${policy.budget.monthly_budget_cap_usd.toFixed(2)}</span>
        <span>Daily cap: ${policy.budget.daily_budget_cap_usd.toFixed(2)}</span>
        <span>Estimated tokens: {policy.budget.estimated_tokens}</span>
        <span>Estimated cost: ${policy.budget.estimated_cost_usd?.toFixed(4) ?? "unknown"}</span>
        <span>Approval required: {policy.approval_required ? "yes" : "no"}</span>
        <span>No API keys stored: {policy.policy.no_api_keys_stored ? "yes" : "no"}</span>
      </div>
      <div className="safety-flag-grid" aria-label="Provider policy safety flags">
        {Object.entries(policy.safety_flags).map(([flag, enabled]) => (
          <span className={enabled ? "enabled" : "disabled"} key={flag}>
            {formatSafetyFlag(flag)}: {enabled ? "yes" : "no"}
          </span>
        ))}
      </div>
      <div className="context-preview">
        <div className="section-head compact">
          <div>
            <span className="eyebrow">Required before live calls</span>
            <h3>Future guard checklist</h3>
          </div>
          <TruthBadge state="blocked" label="Still blocked" />
        </div>
        <ul>
          {policy.required_before_live_calls.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ProviderInvocationFirewallPanel({ invocation }: { invocation: ProviderInvocationFirewallResult | null }) {
  if (!invocation) {
    return (
      <div className="provider-invocation-panel">
        <div className="section-head compact">
          <div>
            <span className="eyebrow">Provider Invocation Firewall</span>
            <h3>Admin-only provider call boundary</h3>
          </div>
          <TruthBadge state="demo" label="Not loaded" />
        </div>
        <p className="execution-disabled-banner">
          Firewall preview not loaded. Live provider calls remain disabled, and no execution endpoint exists here.
        </p>
      </div>
    );
  }

  return (
    <div className="provider-invocation-panel">
      <div className="section-head compact">
        <div>
          <span className="eyebrow">Provider Invocation Firewall</span>
          <h3>Admin-only dry-run call boundary</h3>
        </div>
        <TruthBadge state={invocation.live_call_allowed ? "blocked" : "real"} label="Blocked / dry-run" />
      </div>
      <p className="execution-disabled-banner">
        PROVIDER FIREWALL: no live provider call, no network request, no approval execution, no ledger write, and no
        queue write can run from this preview.
      </p>
      <div className="debug-safety-strip">
        <TruthBadge state="real" label="No live provider call" />
        <TruthBadge state="real" label="Execution disabled" />
        <TruthBadge state="real" label="Provider not called" />
        <TruthBadge state="real" label="No raw context stored" />
        <TruthBadge state="stub" label="Future boundary only" />
      </div>
      <div className="provider-grid">
        <ProviderStatusCard
          label="Firewall status"
          value={invocation.status}
          detail={invocation.blocked_reason}
          state={invocation.live_call_allowed ? "blocked" : "real"}
        />
        <ProviderStatusCard
          label="Requested route"
          value={invocation.requested_route}
          detail={`Model: ${invocation.requested_model_id}. Provider id: ${invocation.requested_provider_id}.`}
          state="stub"
        />
        <ProviderStatusCard
          label="Live call allowed"
          value={invocation.live_call_allowed ? "Yes" : "No"}
          detail={invocation.admin_debug_summary}
          state={invocation.live_call_allowed ? "blocked" : "real"}
        />
        <ProviderStatusCard
          label="Execution"
          value={invocation.execution_disabled ? "Disabled" : "Unsafe"}
          detail={invocation.dry_run_result.output_text}
          state={invocation.execution_disabled ? "real" : "blocked"}
        />
        <ProviderStatusCard
          label="Policy route"
          value={invocation.policy_result.route_allowed ? "Allowed" : "Blocked"}
          detail={invocation.policy_result.live_call_disabled_reason}
          state={invocation.policy_result.route_allowed ? "blocked" : "real"}
        />
        <ProviderStatusCard
          label="Readiness"
          value={invocation.readiness_route?.status.replace(/_/g, " ") ?? "Missing"}
          detail={invocation.readiness_route?.disabled_reason ?? "No readiness route matched this provider candidate."}
          state={invocation.readiness_route?.configured ? "stub" : "demo"}
        />
        <ProviderStatusCard
          label="Approval requirement"
          value={
            invocation.approval_requirement.approval_required
              ? invocation.approval_requirement.approval_status
              : "Not required"
          }
          detail={invocation.approval_requirement.reason || "Safe preview metadata only."}
          state={invocation.approval_requirement.approval_required ? "stub" : "real"}
        />
        <ProviderStatusCard
          label="Cost/tokens"
          value={`${invocation.estimated_tokens} tokens`}
          detail={`Estimated cost: $${invocation.estimated_cost_usd?.toFixed(4) ?? "unknown"}.`}
          state="demo"
        />
      </div>
      {invocation.openrouter_adapter ? (
        <div className="context-preview">
          <div className="section-head compact">
            <div>
              <span className="eyebrow">OpenRouter / GLM adapter</span>
              <h3>Dry-run skeleton for future worker route</h3>
            </div>
            <TruthBadge state="stub" label="Adapter skeleton" />
          </div>
          <p className="execution-disabled-banner">
            OPENROUTER ADAPTER DRY-RUN: model {invocation.openrouter_adapter.model_id}, no live provider call, no HTTP
            request prepared, and no raw provider response exists.
          </p>
          <div className="provider-grid">
            <ProviderStatusCard
              label="Adapter status"
              value={invocation.openrouter_adapter.adapter_status.replace(/_/g, " ")}
              detail={invocation.openrouter_adapter.blocked_reason}
              state="stub"
            />
            <ProviderStatusCard
              label="Model"
              value={invocation.openrouter_adapter.model_id}
              detail={`Provider id: ${invocation.openrouter_adapter.provider_id}. Request: ${invocation.openrouter_adapter.request_id}.`}
              state="demo"
            />
            <ProviderStatusCard
              label="HTTP request"
              value={invocation.openrouter_adapter.dry_run_response.http_request_prepared ? "Prepared" : "Not prepared"}
              detail={invocation.openrouter_adapter.dry_run_response.output_text}
              state={invocation.openrouter_adapter.dry_run_response.http_request_prepared ? "blocked" : "real"}
            />
            <ProviderStatusCard
              label="Provider called"
              value={invocation.openrouter_adapter.dry_run_response.provider_called ? "Yes" : "No"}
              detail={invocation.openrouter_adapter.admin_debug_summary}
              state={invocation.openrouter_adapter.dry_run_response.provider_called ? "blocked" : "real"}
            />
            <ProviderStatusCard
              label="Transport contract"
              value={invocation.openrouter_adapter.transport_contract.contract_status.replace(/_/g, " ")}
              detail={`${invocation.openrouter_adapter.transport_contract.method} ${invocation.openrouter_adapter.transport_contract.endpoint}`}
              state="stub"
            />
            <ProviderStatusCard
              label="Contract model"
              value={invocation.openrouter_adapter.transport_contract.request_body_shape.model}
              detail="Future request body must use redacted messages only; no body is prepared today."
              state="demo"
            />
            <ProviderStatusCard
              label="Network client"
              value={
                invocation.openrouter_adapter.transport_contract.network_client_implemented
                  ? "Implemented"
                  : "Not implemented"
              }
              detail={invocation.openrouter_adapter.transport_contract.admin_debug_summary}
              state={
                invocation.openrouter_adapter.transport_contract.network_client_implemented ? "blocked" : "real"
              }
            />
            <ProviderStatusCard
              label="Payment"
              value={
                invocation.openrouter_adapter.transport_contract.payment_instruction_status === "not_requested"
                  ? "Not requested"
                  : "Required"
              }
              detail={invocation.openrouter_adapter.transport_contract.payment_instruction}
              state="blocked"
            />
            <ProviderStatusCard
              label="Live transport"
              value={invocation.openrouter_adapter.live_transport_readiness.live_transport_enabled ? "Enabled" : "Disabled"}
              detail="Live transport is not configured or enabled; this adapter cannot send a provider request."
              state="blocked"
            />
            <ProviderStatusCard
              label="Key present"
              value={invocation.openrouter_adapter.live_transport_readiness.readiness_key_present ? "Yes / masked" : "No"}
              detail="Admin sees masked presence only. Raw credentials are never returned to the UI."
              state={invocation.openrouter_adapter.live_transport_readiness.readiness_key_present ? "stub" : "demo"}
            />
            <ProviderStatusCard
              label="Policy allowed"
              value={invocation.openrouter_adapter.live_transport_readiness.provider_policy_allowed ? "Yes" : "No"}
              detail="Provider policy still reports route_allowed false."
              state="real"
            />
            <ProviderStatusCard
              label="Budget gate"
              value={invocation.openrouter_adapter.live_transport_readiness.budget_status}
              detail="Budget status is preview-only and cannot authorize live spend."
              state="stub"
            />
            <ProviderStatusCard
              label="Approval execution"
              value={
                invocation.openrouter_adapter.live_transport_readiness.approval_status_ok
                  ? "Ready"
                  : "Not implemented"
              }
              detail={`Approval status: ${invocation.openrouter_adapter.live_transport_readiness.approval_status}.`}
              state="blocked"
            />
            <ProviderStatusCard
              label="Firewall"
              value={
                invocation.openrouter_adapter.live_transport_readiness.firewall_permits_call ? "Permits" : "Blocking"
              }
              detail={invocation.openrouter_adapter.dry_run_request_envelope.no_live_call_reason}
              state="real"
            />
            <ProviderStatusCard
              label="Dry-run envelope"
              value={invocation.openrouter_adapter.dry_run_request_envelope.ready_for_send ? "Sendable" : "Not sendable"}
              detail={`Envelope ${invocation.openrouter_adapter.dry_run_request_envelope.envelope_id}; no network payload is prepared.`}
              state="demo"
            />
            <ProviderStatusCard
              label="Request body"
              value={invocation.openrouter_adapter.transport_contract.request_body_prepared ? "Prepared" : "Not prepared"}
              detail="No raw prompt, raw API key, or provider payload is returned by this contract."
              state={invocation.openrouter_adapter.transport_contract.request_body_prepared ? "blocked" : "real"}
            />
          </div>
          <div className="context-preview">
            <div className="section-head compact">
              <div>
                <span className="eyebrow">OpenRouter GLM contract</span>
                <h3>Contract only, no transport client</h3>
              </div>
              <TruthBadge state="blocked" label="Payment not requested" />
            </div>
            <div className="approval-queue-counts">
              <span>Auth: {invocation.openrouter_adapter.transport_contract.auth_header_preview}</span>
              <span>Content type: {invocation.openrouter_adapter.transport_contract.content_type}</span>
              <span>Ready for send: {invocation.openrouter_adapter.transport_contract.ready_for_send ? "yes" : "no"}</span>
              <span>Provider called: {invocation.openrouter_adapter.transport_contract.provider_called ? "yes" : "no"}</span>
              <span>Network: {invocation.openrouter_adapter.transport_contract.network_call_performed ? "yes" : "no"}</span>
            </div>
          </div>
          <div className="context-preview">
            <div className="section-head compact">
              <div>
                <span className="eyebrow">Required before live smoke test</span>
                <h3>Transport readiness checklist</h3>
              </div>
              <TruthBadge state="blocked" label="Smoke test not approved" />
            </div>
            <ul>
              {invocation.openrouter_adapter.live_transport_readiness.required_before_live_smoke_test.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div className="safety-flag-grid" aria-label="OpenRouter adapter safety flags">
            {Object.entries(invocation.openrouter_adapter.safety_flags).map(([flag, enabled]) => (
              <span className={enabled ? "enabled" : "disabled"} key={flag}>
                {formatSafetyFlag(flag)}: {enabled ? "yes" : "no"}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      <div className="context-preview">
        <div className="section-head compact">
          <div>
            <span className="eyebrow">Blocked reasons</span>
            <h3>Why no provider can run</h3>
          </div>
          <TruthBadge state="real" label="Always blocked today" />
        </div>
        <ul>
          {invocation.blocked_reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </div>
      <div className="context-preview">
        <div className="section-head compact">
          <div>
            <span className="eyebrow">Required before live calls</span>
            <h3>Future firewall checklist</h3>
          </div>
          <TruthBadge state="blocked" label="Not production ready" />
        </div>
        <ul>
          {invocation.required_before_live.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
      <div className="context-preview">
        <div className="section-head compact">
          <div>
            <span className="eyebrow">Redacted context summary</span>
            <h3>Stored only in this response</h3>
          </div>
          <TruthBadge state="real" label="Redacted" />
        </div>
        <pre>{invocation.redacted_context_summary || "No context summary returned."}</pre>
      </div>
      <div className="safety-flag-grid" aria-label="Provider invocation firewall safety flags">
        {Object.entries(invocation.safety_flags).map(([flag, enabled]) => (
          <span className={enabled ? "enabled" : "disabled"} key={flag}>
            {formatSafetyFlag(flag)}: {enabled ? "yes" : "no"}
          </span>
        ))}
      </div>
    </div>
  );
}

function LiveSmokePreflightPanel({ preflight }: { preflight: LiveSmokePreflightReport | null }) {
  if (!preflight) {
    return (
      <div className="provider-invocation-panel">
        <div className="section-head compact">
          <div>
            <span className="eyebrow">Live Smoke Preflight</span>
            <h3>Admin-only safety gates</h3>
          </div>
          <TruthBadge state="demo" label="Not loaded" />
        </div>
        <p className="execution-disabled-banner">
          Live smoke test preflight not loaded. Provider transport remains disabled and no smoke-test endpoint exists.
        </p>
      </div>
    );
  }

  return (
    <div className="provider-invocation-panel">
      <div className="section-head compact">
        <div>
          <span className="eyebrow">Live Smoke Preflight</span>
          <h3>Budget, ledger, redaction, approval, and transport gates</h3>
        </div>
        <TruthBadge state="blocked" label="No live smoke" />
      </div>
      <p className="execution-disabled-banner">
        LIVE SMOKE PREFLIGHT: blocked. No provider call, no network request, no approval execution, no queue write, and
        no Hermes ledger write occurred.
      </p>
      <div className="provider-grid">
        <ProviderStatusCard
          label="Smoke test"
          value={preflight.live_smoke_allowed ? "Allowed" : "Blocked"}
          detail={preflight.admin_debug_summary}
          state="blocked"
        />
        <ProviderStatusCard
          label="Budget gate"
          value={preflight.budget_gate.status.replace(/_/g, " ")}
          detail={`Budget ${preflight.budget_gate.budget_status}; enforcement ${preflight.budget_gate.enforcement_mode.replace(/_/g, " ")}.`}
          state={liveSmokeGateState(preflight.budget_gate.status)}
        />
        <ProviderStatusCard
          label="Ledger gate"
          value={preflight.ledger_gate.status.replace(/_/g, " ")}
          detail={preflight.ledger_gate.reason}
          state={liveSmokeGateState(preflight.ledger_gate.status)}
        />
        <ProviderStatusCard
          label="Redaction gate"
          value={preflight.redaction_gate.status.replace(/_/g, " ")}
          detail={preflight.redaction_gate.reason}
          state={liveSmokeGateState(preflight.redaction_gate.status)}
        />
        <ProviderStatusCard
          label="Approval execution"
          value={preflight.approval_execution_gate.status.replace(/_/g, " ")}
          detail={preflight.approval_execution_gate.reason}
          state={liveSmokeGateState(preflight.approval_execution_gate.status)}
        />
        <ProviderStatusCard
          label="Transport gate"
          value={preflight.transport_gate.status.replace(/_/g, " ")}
          detail={preflight.transport_gate.reason}
          state={liveSmokeGateState(preflight.transport_gate.status)}
        />
      </div>
      <div className="approval-queue-counts">
        <span>Provider called: {preflight.provider_called ? "yes" : "no"}</span>
        <span>Network: {preflight.network_call_performed ? "yes" : "no"}</span>
        <span>Ledger write: {preflight.ledger_written ? "yes" : "no"}</span>
        <span>Queue write: {preflight.queue_written ? "yes" : "no"}</span>
        <span>Approval executed: {preflight.approval_executed ? "yes" : "no"}</span>
        <span>Execute endpoint: expected {preflight.approval_execution_gate.execute_endpoint_expected_status}</span>
      </div>
      <div className="context-preview">
        <div className="section-head compact">
          <div>
            <span className="eyebrow">Required before smoke test</span>
            <h3>Still blocked until every gate is real</h3>
          </div>
          <TruthBadge state="blocked" label="Jordan approval required later" />
        </div>
        <ul>
          {preflight.required_before_live_smoke_test.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
      <div className="safety-flag-grid" aria-label="Live smoke preflight safety flags">
        {Object.entries(preflight.safety_flags).map(([flag, enabled]) => (
          <span className={enabled ? "enabled" : "disabled"} key={flag}>
            {formatSafetyFlag(flag)}: {enabled ? "yes" : "no"}
          </span>
        ))}
      </div>
    </div>
  );
}

function HermesLiveReceiptContractPanel({ contract }: { contract: HermesLiveCallReceiptContract | null }) {
  if (!contract) {
    return (
      <div className="provider-invocation-panel">
        <div className="section-head compact">
          <div>
            <span className="eyebrow">Hermes Live Receipts</span>
            <h3>Request/response receipt contract</h3>
          </div>
          <TruthBadge state="demo" label="Not loaded" />
        </div>
        <p className="execution-disabled-banner">
          Receipt contract not loaded. Future live provider smoke tests still require redacted request and response
          receipts before transport can turn on.
        </p>
      </div>
    );
  }

  return (
    <div className="provider-invocation-panel">
      <div className="section-head compact">
        <div>
          <span className="eyebrow">Hermes Live Receipts</span>
          <h3>Mandatory redacted request and response receipts</h3>
        </div>
        <TruthBadge state="blocked" label="Contract only" />
      </div>
      <p className="execution-disabled-banner">
        HERMES RECEIPT CONTRACT: no provider call, no network request, no ledger write, no queue write, no approval
        execution, and no sendable request body exists.
      </p>
      <div className="provider-grid">
        <ProviderStatusCard
          label="Contract"
          value={contract.status.replace(/_/g, " ")}
          detail={contract.admin_debug_summary}
          state="blocked"
        />
        <ProviderStatusCard
          label="Correlation"
          value={contract.correlation_id}
          detail={`Contract ${contract.contract_id}`}
          state="demo"
        />
        <ProviderStatusCard
          label="Provider/model"
          value={`${contract.provider.provider_name} / ${contract.provider.model_id}`}
          detail={`${contract.endpoint_contract.method} ${contract.endpoint_contract.endpoint}`}
          state="stub"
        />
        <ProviderStatusCard
          label="Request receipt"
          value={contract.request_receipt.receipt_id}
          detail={`Required before live: ${contract.request_receipt.ledger_append_required_before_live ? "yes" : "no"}. Written: ${contract.request_receipt.ledger_append_performed ? "yes" : "no"}.`}
          state="blocked"
        />
        <ProviderStatusCard
          label="Response receipt"
          value={contract.response_receipt.receipt_id}
          detail={`Status: ${contract.response_receipt.response_status}. Written: ${contract.response_receipt.ledger_append_performed ? "yes" : "no"}.`}
          state="blocked"
        />
        <ProviderStatusCard
          label="Redaction proof"
          value={contract.redaction.fake_api_key_redacted && contract.redaction.fake_prompt_redacted ? "Passed" : "Blocked"}
          detail="Fake API key, token, card, and prompt-like values must be redacted before live transport."
          state={contract.redaction.fake_api_key_redacted && contract.redaction.fake_prompt_redacted ? "real" : "blocked"}
        />
        <ProviderStatusCard
          label="Budget linkage"
          value={contract.budget_gate_status.replace(/_/g, " ")}
          detail={`Preflight ${contract.live_smoke_preflight_id}. Budget route allowed: no.`}
          state={liveSmokeGateState(contract.budget_gate_status)}
        />
        <ProviderStatusCard
          label="Approval linkage"
          value={contract.approval_gate_status.replace(/_/g, " ")}
          detail={`Approval execution mode: ${contract.approval_execution_mode.replace(/_/g, " ")}.`}
          state={liveSmokeGateState(contract.approval_gate_status)}
        />
      </div>
      <div className="approval-queue-counts">
        <span>Provider called: {contract.providerCalled ? "yes" : "no"}</span>
        <span>Network: {contract.networkCallPerformed ? "yes" : "no"}</span>
        <span>Ledger write: {contract.ledgerWritten ? "yes" : "no"}</span>
        <span>Queue write: {contract.queueWritten ? "yes" : "no"}</span>
        <span>Approval executed: {contract.approvalExecuted ? "yes" : "no"}</span>
        <span>Ready for send: {contract.readyForSend ? "yes" : "no"}</span>
      </div>
      <div className="context-preview">
        <div className="section-head compact">
          <div>
            <span className="eyebrow">Required before live receipts</span>
            <h3>Still not live transport</h3>
          </div>
          <TruthBadge state="blocked" label="Ledger not written" />
        </div>
        <ul>
          {contract.required_before_live.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
      <div className="safety-flag-grid" aria-label="Hermes live receipt safety flags">
        {Object.entries(contract.safety_flags).map(([flag, enabled]) => (
          <span className={enabled ? "enabled" : "disabled"} key={flag}>
            {formatSafetyFlag(flag)}: {enabled ? "yes" : "no"}
          </span>
        ))}
      </div>
    </div>
  );
}

function HermesRouterDebugPanel({ sessionHeaders }: { sessionHeaders: (json?: boolean) => Record<string, string> }) {
  const [records, setRecords] = useState<HermesLedgerRecordPreview[]>([]);
  const [queueRecords, setQueueRecords] = useState<ApprovalQueueRecordPreview[]>([]);
  const [queueCounts, setQueueCounts] = useState({
    pending: 0,
    blockedPreview: 0,
    previewOnly: 0,
    malformedLines: 0,
    transitionMalformedLines: 0,
    reviewed: 0,
    dismissed: 0,
    needsChanges: 0,
    expired: 0,
  });
  const [transitionNotes, setTransitionNotes] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<HermesContextPreview | null>(null);
  const [providerPolicy, setProviderPolicy] = useState<ProviderPolicyPreview | null>(null);
  const [providerReadiness, setProviderReadiness] = useState<ProviderReadinessReport | null>(null);
  const [providerInvocation, setProviderInvocation] = useState<ProviderInvocationFirewallResult | null>(null);
  const [liveSmokePreflight, setLiveSmokePreflight] = useState<LiveSmokePreflightReport | null>(null);
  const [hermesReceiptContract, setHermesReceiptContract] = useState<HermesLiveCallReceiptContract | null>(null);
  const [previewText, setPreviewText] = useState(
    "Summarize today's safest trainer follow-up priorities for owner review only.",
  );
  const [taskType, setTaskType] = useState("content_idea_summary");
  const [sensitivityLevel, setSensitivityLevel] = useState("low");
  const [historyStatus, setHistoryStatus] = useState("Not loaded");
  const [previewStatus, setPreviewStatus] = useState("Not loaded");
  const [queueStatus, setQueueStatus] = useState("Not loaded");
  const [policyStatus, setPolicyStatus] = useState("Not loaded");
  const [readinessStatus, setReadinessStatus] = useState("Not loaded");
  const [invocationStatus, setInvocationStatus] = useState("Not loaded");
  const [liveSmokeStatus, setLiveSmokeStatus] = useState("Not loaded");
  const [receiptContractStatus, setReceiptContractStatus] = useState("Not loaded");

  function buildPreviewPayload(text = previewText, task = taskType, sensitivity = sensitivityLevel) {
    return {
      tenant_id: "demo-trainer",
      business_name: personalTrainingSimulation.owner.business,
      request_id: `ui-preview-${Date.now()}`,
      task_type: task,
      sensitivity_level: sensitivity,
      user_request: text,
      business_summary:
        "Owner-only personal training demo workspace. Employees disabled. External actions approval-only.",
      module_data: [
        {
          module: "Tasks",
          summary: "Today includes local demo tasks and approval-only follow-ups.",
          items: personalTrainingSimulation.tasks.slice(0, 3),
        },
        {
          module: "Approvals",
          summary: "Approvals are review items only; no sends, uploads, billing, or production actions execute.",
          items: personalTrainingSimulation.approvals.slice(0, 3),
        },
      ],
    };
  }

  async function refreshHistory() {
    setHistoryStatus("Loading redacted ledger history...");

    try {
      const response = await fetch(`${API_BASE_URL}/phantom-ai/hermes-ledger/history?limit=8`, {
        headers: sessionHeaders(),
      });

      if (!response.ok) {
        setRecords([]);
        setHistoryStatus("Admin ledger history unavailable");
        return;
      }

      const data = (await response.json()) as { records?: HermesLedgerRecordPreview[] };
      setRecords(Array.isArray(data.records) ? data.records : []);
      setHistoryStatus(Array.isArray(data.records) && data.records.length ? "Redacted history loaded" : "No ledger records yet");
    } catch {
      setRecords([]);
      setHistoryStatus("Backend offline");
    }
  }

  async function refreshApprovalQueue() {
    setQueueStatus("Loading local approval queue...");

    try {
      const response = await fetch(`${API_BASE_URL}/phantom-ai/approvals/queue?limit=8`, {
        headers: sessionHeaders(),
      });

      if (!response.ok) {
        setQueueRecords([]);
        setQueueStatus("Admin approval queue unavailable");
        return;
      }

      const data = (await response.json()) as {
        queue?: {
          pending_count?: number;
          blocked_preview_count?: number;
          preview_only_count?: number;
          malformed_lines?: number;
          transition_malformed_lines?: number;
          reviewed_count?: number;
          dismissed_count?: number;
          needs_changes_count?: number;
          expired_count?: number;
        };
        records?: ApprovalQueueRecordPreview[];
      };
      const nextRecords = Array.isArray(data.records) ? data.records : [];
      setQueueRecords(nextRecords);
      setQueueCounts({
        pending: data.queue?.pending_count ?? 0,
        blockedPreview: data.queue?.blocked_preview_count ?? 0,
        previewOnly: data.queue?.preview_only_count ?? 0,
        malformedLines: data.queue?.malformed_lines ?? 0,
        transitionMalformedLines: data.queue?.transition_malformed_lines ?? 0,
        reviewed: data.queue?.reviewed_count ?? 0,
        dismissed: data.queue?.dismissed_count ?? 0,
        needsChanges: data.queue?.needs_changes_count ?? 0,
        expired: data.queue?.expired_count ?? 0,
      });
      setQueueStatus(nextRecords.length ? "Local approval queue loaded" : "No queued approval previews yet");
    } catch {
      setQueueRecords([]);
      setQueueStatus("Backend offline");
    }
  }

  async function refreshProviderPolicy() {
    setPolicyStatus("Loading provider policy gate...");

    try {
      const response = await fetch(`${API_BASE_URL}/phantom-ai/provider-policy/status`, {
        headers: sessionHeaders(),
      });

      if (!response.ok) {
        setProviderPolicy(null);
        setPolicyStatus("Admin policy gate unavailable");
        return;
      }

      const data = (await response.json()) as ProviderPolicyStatusResponse;
      setProviderPolicy(data.preview ?? null);
      setPolicyStatus(data.preview?.route_allowed ? "Unsafe live route" : "Live calls blocked");
    } catch {
      setProviderPolicy(null);
      setPolicyStatus("Backend offline");
    }
  }

  async function refreshProviderReadiness() {
    setReadinessStatus("Loading provider readiness...");

    try {
      const response = await fetch(`${API_BASE_URL}/phantom-ai/provider-readiness/status`, {
        headers: sessionHeaders(),
      });

      if (!response.ok) {
        setProviderReadiness(null);
        setReadinessStatus("Admin provider readiness unavailable");
        return;
      }

      const data = (await response.json()) as ProviderReadinessStatusResponse;
      setProviderReadiness(data.readiness ?? null);
      setReadinessStatus(data.readiness?.any_live_route_configured ? "Configured / live disabled" : "Mock only");
    } catch {
      setProviderReadiness(null);
      setReadinessStatus("Backend offline");
    }
  }

  async function refreshProviderInvocation(text = previewText, task = taskType, sensitivity = sensitivityLevel) {
    setInvocationStatus("Checking provider invocation firewall...");

    try {
      const response = await fetch(`${API_BASE_URL}/phantom-ai/provider-invocation/preview`, {
        method: "POST",
        headers: sessionHeaders(true),
        body: JSON.stringify(buildPreviewPayload(text, task, sensitivity)),
      });

      if (!response.ok) {
        setProviderInvocation(null);
        setInvocationStatus("Admin firewall preview unavailable");
        return;
      }

      const data = (await response.json()) as ProviderInvocationPreviewResponse;
      setProviderInvocation(data.provider_invocation ?? null);
      setProviderPolicy(data.provider_policy ?? data.provider_invocation?.policy_result ?? null);
      setProviderReadiness(data.provider_readiness ?? data.provider_invocation?.readiness_result ?? null);
      setInvocationStatus(data.provider_invocation?.live_call_allowed ? "Unsafe live route" : "Blocked / dry-run");
    } catch {
      setProviderInvocation(null);
      setInvocationStatus("Backend offline");
    }
  }

  async function refreshLiveSmokePreflight(text = previewText, task = taskType, sensitivity = sensitivityLevel) {
    setLiveSmokeStatus("Checking live smoke gates...");

    try {
      const response = await fetch(`${API_BASE_URL}/phantom-ai/live-smoke/preflight`, {
        method: "POST",
        headers: sessionHeaders(true),
        body: JSON.stringify(buildPreviewPayload(text, task, sensitivity)),
      });

      if (!response.ok) {
        setLiveSmokePreflight(null);
        setLiveSmokeStatus("Admin preflight unavailable");
        return;
      }

      const data = (await response.json()) as LiveSmokePreflightResponse;
      setLiveSmokePreflight(data.preflight ?? null);
      setLiveSmokeStatus(data.preflight?.live_smoke_allowed ? "Unsafe live route" : "Blocked / no live smoke");
    } catch {
      setLiveSmokePreflight(null);
      setLiveSmokeStatus("Backend offline");
    }
  }

  async function refreshHermesReceiptContract(text = previewText, task = taskType, sensitivity = sensitivityLevel) {
    setReceiptContractStatus("Checking receipt contract...");

    try {
      const response = await fetch(`${API_BASE_URL}/phantom-ai/hermes-live-receipts/contract`, {
        method: "POST",
        headers: sessionHeaders(true),
        body: JSON.stringify(buildPreviewPayload(text, task, sensitivity)),
      });

      if (!response.ok) {
        setHermesReceiptContract(null);
        setReceiptContractStatus("Admin receipt contract unavailable");
        return;
      }

      const data = (await response.json()) as HermesLiveCallReceiptContractResponse;
      setHermesReceiptContract(data.receipt_contract ?? null);
      setReceiptContractStatus(data.receipt_contract?.status === "blocked_contract_only" ? "Blocked / contract only" : "Unsafe");
    } catch {
      setHermesReceiptContract(null);
      setReceiptContractStatus("Backend offline");
    }
  }

  async function runContextPreview(text = previewText, task = taskType, sensitivity = sensitivityLevel) {
    setPreviewStatus("Running dry-run preview...");

    try {
      const response = await fetch(`${API_BASE_URL}/phantom-ai/context-preview`, {
        method: "POST",
        headers: sessionHeaders(true),
        body: JSON.stringify(buildPreviewPayload(text, task, sensitivity)),
      });

      if (!response.ok) {
        setPreview(null);
        setPreviewStatus("Preview unavailable");
        return;
      }

      const data = (await response.json()) as HermesContextPreview;
      setPreview(data);
      setProviderPolicy(data.provider_policy);
      setProviderReadiness(data.provider_readiness);
      setProviderInvocation(data.provider_invocation);
      setInvocationStatus(data.provider_invocation?.live_call_allowed ? "Unsafe live route" : "Blocked / dry-run");
      setPreviewStatus("Dry-run preview ready");
    } catch {
      setPreview(null);
      setPreviewStatus("Backend offline");
    }
  }

  async function queueCurrentApprovalPreview() {
    setQueueStatus("Queueing preview-only approval object...");

    try {
      const response = await fetch(`${API_BASE_URL}/phantom-ai/approvals/preview`, {
        method: "POST",
        headers: sessionHeaders(true),
        body: JSON.stringify({
          ...buildPreviewPayload(previewText, taskType, sensitivityLevel),
          queue_approval: true,
        }),
      });

      if (!response.ok) {
        setQueueStatus("Approval queue write unavailable");
        return;
      }

      const data = (await response.json()) as ApprovalQueuePreviewResponse;
      setProviderPolicy(data.provider_policy);
      setProviderReadiness(data.provider_readiness);
      setProviderInvocation(data.provider_invocation);
      setInvocationStatus(data.provider_invocation?.live_call_allowed ? "Unsafe live route" : "Blocked / dry-run");
      if (data.queue_write.queued) {
        setQueueStatus("Approval preview queued locally. Execution remains disabled.");
      } else if (data.queue_write.reason === "preview_only_not_queued") {
        setQueueStatus("Safe preview was not queued. No approval is required.");
      } else {
        setQueueStatus("Queue write was not requested.");
      }
      await refreshApprovalQueue();
    } catch {
      setQueueStatus("Backend offline");
    }
  }

  async function transitionQueueRecord(queueId: string, status: ApprovalQueueTransitionTarget) {
    setQueueStatus("Saving status-only queue transition...");

    try {
      const response = await fetch(`${API_BASE_URL}/phantom-ai/approvals/queue/${encodeURIComponent(queueId)}/status`, {
        method: "POST",
        headers: sessionHeaders(true),
        body: JSON.stringify({
          status,
          note: transitionNotes[queueId] ?? "",
        }),
      });

      if (!response.ok) {
        setQueueStatus("Queue transition unavailable");
        return;
      }

      const data = (await response.json()) as ApprovalQueueTransitionResponse;
      if (data.execution_disabled && !data.approval_execution_implemented && !data.live_provider_called) {
        setQueueStatus(`Status saved: ${data.transition.transition.to_status.replace(/_/g, " ")}. No action executed.`);
      } else {
        setQueueStatus("Unsafe transition response blocked by UI proof.");
      }
      setTransitionNotes((current) => ({ ...current, [queueId]: "" }));
      await refreshApprovalQueue();
    } catch {
      setQueueStatus("Backend offline");
    }
  }

  useEffect(() => {
    void refreshHistory();
    void refreshApprovalQueue();
    void refreshProviderPolicy();
    void refreshProviderReadiness();
    void refreshProviderInvocation();
    void refreshLiveSmokePreflight();
    void refreshHermesReceiptContract();
    void runContextPreview();
  }, []);

  function submitPreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runContextPreview();
    void refreshLiveSmokePreflight();
    void refreshHermesReceiptContract();
  }

  return (
    <section className="panel hermes-debug-panel">
      <div className="section-head">
        <div>
          <span className="eyebrow">Admin/debug</span>
          <h3>Hermes history and router preview.</h3>
        </div>
        <TruthBadge state="demo" label="Dry-run only" />
      </div>
      <p>
        This panel is admin-only. It reads redacted Hermes records and previews context, route, sensitivity, and
        approval metadata without writing to the ledger or calling a live provider.
      </p>
      <div className="debug-safety-strip">
        <TruthBadge state="real" label="Real ledger read" />
        <TruthBadge state="demo" label="Dry-run context preview" />
        <TruthBadge state="real" label="Provider policy blocks live calls" />
        <TruthBadge state="real" label="Provider readiness masked" />
        <TruthBadge state="stub" label="Budget guard preview" />
        <TruthBadge state="blocked" label="Live smoke blocked" />
        <TruthBadge state="real" label="No live provider call" />
        <TruthBadge state="stub" label="Approval execution not implemented" />
      </div>

      <form className="hermes-preview-form" onSubmit={submitPreview}>
        <label>
          Preview request
          <textarea value={previewText} onChange={(event) => setPreviewText(event.target.value)} rows={4} />
        </label>
        <div className="hermes-preview-controls">
          <label>
            Task type
            <select value={taskType} onChange={(event) => setTaskType(event.target.value)}>
              <option value="content_idea_summary">Content idea summary</option>
              <option value="send_post_upload">Send/post/upload action</option>
              <option value="delete_client_record">Delete client record</option>
              <option value="billing_summary">Billing summary</option>
            </select>
          </label>
          <label>
            Sensitivity
            <select value={sensitivityLevel} onChange={(event) => setSensitivityLevel(event.target.value)}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
          <button className="ghost-small" type="submit">
            Run preview
          </button>
          <button className="ghost-small" type="button" onClick={() => void refreshHistory()}>
            Refresh ledger
          </button>
          <button className="ghost-small danger" type="button" onClick={() => void queueCurrentApprovalPreview()}>
            Queue preview
          </button>
          <button className="ghost-small" type="button" onClick={() => void refreshProviderInvocation()}>
            Check firewall
          </button>
          <button className="ghost-small danger" type="button" onClick={() => void refreshLiveSmokePreflight()}>
            Check smoke gates
          </button>
          <button className="ghost-small" type="button" onClick={() => void refreshHermesReceiptContract()}>
            Check receipts
          </button>
        </div>
      </form>

      <div className="provider-grid">
        <ProviderStatusCard
          label="Real ledger read"
          value={historyStatus}
          detail={
            records.length
              ? `${records.length} recent redacted records. Secret-like values are masked before display.`
              : "Missing or empty ledger is safe and displays as an empty state."
          }
          state="real"
        />
        <ProviderStatusCard
          label="Dry-run context preview"
          value={previewStatus}
          detail="Preview compiles context and metadata only. It does not write to Hermes."
          state="demo"
        />
        <ProviderStatusCard
          label="No ledger write"
          value={preview?.ledger_written ? "Yes" : "No"}
          detail="Context preview must never append records."
          state={preview?.ledger_written ? "blocked" : "real"}
        />
        <ProviderStatusCard
          label="No live provider call"
          value={preview?.live_provider_called ? "Yes" : "No"}
          detail="Private API routes stay blocked in this preview; Phantom AI does not leak provider plumbing to customers."
          state={preview?.live_provider_called ? "blocked" : "real"}
        />
        <ProviderStatusCard
          label="Approval execution"
          value="Not implemented"
          detail="This panel only previews approval status. It cannot execute sends, posts, billing, deletes, deploys, or provider work."
          state="stub"
        />
        <ProviderStatusCard
          label="Approval queue"
          value={queueStatus}
          detail="Queue writes are local JSONL only. No approval can execute from this queue."
          state="stub"
        />
        <ProviderStatusCard
          label="Provider policy gate"
          value={policyStatus}
          detail={
            providerPolicy
              ? providerPolicy.live_call_disabled_reason
              : "Policy endpoint is admin-only. Live provider calls remain blocked."
          }
          state={providerPolicy?.route_allowed ? "blocked" : "real"}
        />
        <ProviderStatusCard
          label="Budget guard preview"
          value={providerPolicy?.budget.status ?? "Not loaded"}
          detail={
            providerPolicy
              ? providerPolicy.budget.reasons.join(" ")
              : "Budget status is preview-only and does not charge, bill, or call providers."
          }
          state={providerPolicy ? budgetGuardState(providerPolicy.budget.status) : "demo"}
        />
        <ProviderStatusCard
          label="Provider readiness"
          value={readinessStatus}
          detail={
            providerReadiness
              ? "Readiness is admin-only, masked, and status-only. No provider network check is performed."
              : "Readiness endpoint is admin-only and does not expose raw configuration."
          }
          state="real"
        />
        <ProviderStatusCard
          label="Provider firewall"
          value={invocationStatus}
          detail={
            providerInvocation
              ? providerInvocation.blocked_reason
              : "Invocation firewall endpoint is admin-only and dry-run only."
          }
          state={providerInvocation?.live_call_allowed ? "blocked" : "real"}
        />
        <ProviderStatusCard
          label="Live smoke preflight"
          value={liveSmokeStatus}
          detail={
            liveSmokePreflight
              ? liveSmokePreflight.admin_debug_summary
              : "Admin-only preflight checks budget, ledger, redaction, approval execution, and transport gates."
          }
          state="blocked"
        />
        <ProviderStatusCard
          label="Hermes receipt contract"
          value={receiptContractStatus}
          detail={
            hermesReceiptContract
              ? hermesReceiptContract.admin_debug_summary
              : "Future live calls must produce redacted request and response receipts before transport can turn on."
          }
          state="blocked"
        />
      </div>

      <ProviderInvocationFirewallPanel invocation={preview?.provider_invocation ?? providerInvocation} />
      <LiveSmokePreflightPanel preflight={liveSmokePreflight} />
      <HermesLiveReceiptContractPanel contract={hermesReceiptContract} />
      <ProviderReadinessPanel readiness={preview?.provider_readiness ?? providerReadiness} />
      <ProviderPolicyGatePanel policy={preview?.provider_policy ?? providerPolicy} />

      <div className="approval-queue-panel">
        <div className="section-head compact">
          <div>
            <span className="eyebrow">Approval Queue</span>
            <h3>Local preview queue</h3>
          </div>
          <TruthBadge state="stub" label="Execution disabled" />
        </div>
        <p className="execution-disabled-banner">
          Preview/queue only - no live action can run. This queue cannot approve, reject, send, post, upload, delete,
          bill, deploy, or call a provider.
        </p>
        <div className="approval-queue-counts">
          <span>Pending: {queueCounts.pending}</span>
          <span>Blocked previews: {queueCounts.blockedPreview}</span>
          <span>Preview-only: {queueCounts.previewOnly}</span>
          <span>Malformed skipped: {queueCounts.malformedLines}</span>
          <span>Reviewed: {queueCounts.reviewed}</span>
          <span>Dismissed: {queueCounts.dismissed}</span>
          <span>Needs changes: {queueCounts.needsChanges}</span>
          <span>Expired: {queueCounts.expired}</span>
          <span>Transition malformed: {queueCounts.transitionMalformedLines}</span>
        </div>
        {queueRecords.length ? (
          <div className="approval-queue-list">
            {queueRecords.map((record) => (
              <article className={`approval-queue-record ${queueRecordState(record)}`} key={record.queue_id}>
                <div>
                  <span>{record.queue_status.replace(/_/g, " ")}</span>
                  <strong>{record.approval.summary}</strong>
                  <p>{record.approval.approval_reason}</p>
                </div>
                <div className="approval-queue-meta">
                  <span>ID: {record.approval.approval_id}</span>
                  <span>Action: {record.approval.action_type}</span>
                  <span>Risk: {record.approval.risk_level}</span>
                  <span>Status: {record.approval.status}</span>
                  <span>Review: {record.latest_review_status.replace(/_/g, " ")}</span>
                  <span>Transitions: {record.transition_count}</span>
                  <span>Latest transition: {record.latest_transition_at ?? "None"}</span>
                  <span>Created: {record.approval.created_at}</span>
                  <span>Expires: {record.approval.expires_at ?? "Not applicable"}</span>
                  <span>Tokens: {record.approval.estimated_impact.estimated_tokens}</span>
                  <span>Budget: {record.approval.estimated_impact.budget_status.replace(/_/g, " ")}</span>
                  <span>Execution disabled: {record.execution_disabled ? "yes" : "no"}</span>
                  <span>Live action allowed: {record.queue_safety.live_action_allowed ? "yes" : "no"}</span>
                </div>
                <div className="safety-flag-grid" aria-label="Queued approval safety flags">
                  {Object.entries(record.approval.safety_flags).map(([flag, enabled]) => (
                    <span className={enabled ? "enabled" : "disabled"} key={flag}>
                      {formatSafetyFlag(flag)}: {enabled ? "yes" : "no"}
                    </span>
                  ))}
                </div>
                {record.latest_transition?.note ? (
                  <p className="approval-transition-note">Latest note: {record.latest_transition.note}</p>
                ) : null}
                <div className="approval-transition-controls">
                  <label>
                    Status note
                    <input
                      value={transitionNotes[record.queue_id] ?? ""}
                      onChange={(event) =>
                        setTransitionNotes((current) => ({
                          ...current,
                          [record.queue_id]: event.target.value.slice(0, 500),
                        }))
                      }
                      placeholder="Optional redacted review note"
                    />
                  </label>
                  <div>
                    <span>Status only - no execution</span>
                    <button type="button" onClick={() => void transitionQueueRecord(record.queue_id, "reviewed")}>
                      Mark reviewed
                    </button>
                    <button type="button" onClick={() => void transitionQueueRecord(record.queue_id, "dismissed")}>
                      Dismiss
                    </button>
                    <button type="button" onClick={() => void transitionQueueRecord(record.queue_id, "needs_changes")}>
                      Needs changes
                    </button>
                    <button type="button" onClick={() => void transitionQueueRecord(record.queue_id, "expired")}>
                      Expire
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="access-note">
            No queued approval previews yet. Use Queue preview to store the current risky preview locally without
            executing it.
          </p>
        )}
      </div>

      {preview ? (
        <div className="hermes-preview-grid">
          <article className="provider-card real">
            <span>Selected route</span>
            <strong>{preview.decision.provider_route}</strong>
            <p>{preview.decision.next_action}</p>
          </article>
          <article className={`provider-card ${actionPreviewState(preview.action_preview.status)}`}>
            <span>Approval preview</span>
            <strong>{preview.action_preview.status.replace(/_/g, " ")}</strong>
            <p>{preview.action_preview.label}</p>
          </article>
          <article className="provider-card stub">
            <span>Context size</span>
            <strong>
              {preview.context.context_chars} / {preview.context.raw_context_chars} chars
            </strong>
            <p>{preview.context.estimated_tokens} estimated tokens in compact packet.</p>
          </article>
          <article className={`provider-card ${preview.decision.sensitivity_level === "high" ? "blocked" : "real"}`}>
            <span>Sensitivity</span>
            <strong>{preview.decision.sensitivity_level}</strong>
            <p>Approval required: {preview.decision.approval_required ? "yes" : "no"}</p>
          </article>
          <div className="approval-preview-panel">
            <div className="section-head compact">
              <div>
                <span className="eyebrow">Approval Preview</span>
                <h3>Preview-only request object</h3>
              </div>
              <TruthBadge
                state={approvalPreviewState(preview.approval_request)}
                label={preview.approval_request.execution_disabled ? "Execution disabled" : "Unsafe"}
              />
            </div>
            <p className="execution-disabled-banner">
              PREVIEW ONLY: no approval was executed, no live provider was called, and no destructive action ran.
            </p>
            <div className="approval-summary-grid">
              <ProviderStatusCard
                label="Action classification"
                value={preview.approval_request.action_type}
                detail={preview.approval_request.summary}
                state={approvalPreviewState(preview.approval_request)}
              />
              <ProviderStatusCard
                label="Approval requirement"
                value={
                  preview.approval_request.status === "preview-only"
                    ? "No approval required"
                    : preview.approval_request.status
                }
                detail={preview.approval_request.approval_reason || "Safe local preview. No approval item is created."}
                state={approvalPreviewState(preview.approval_request)}
              />
              <ProviderStatusCard
                label="Risk level"
                value={preview.approval_request.risk_level}
                detail="Risk is structural metadata only; execution remains disabled."
                state={approvalPreviewState(preview.approval_request)}
              />
              <ProviderStatusCard
                label="Execution"
                value={preview.approval_request.execution_disabled ? "Disabled" : "Unsafe"}
                detail="Approval execution is not implemented in this patch."
                state={preview.approval_request.execution_disabled ? "real" : "blocked"}
              />
            </div>
            <div className="approval-meta-grid">
              <span>Approval ID: {preview.approval_request.approval_id}</span>
              <span>Requested by: {preview.approval_request.requested_by.actor_role}</span>
              <span>Tenant: {preview.approval_request.tenant_context.business_name}</span>
              <span>
                Expires:{" "}
                {preview.approval_request.expires_at ? preview.approval_request.expires_at : "Not applicable"}
              </span>
              <span>Estimated tokens: {preview.approval_request.estimated_impact.estimated_tokens}</span>
              <span>Budget: {preview.approval_request.estimated_impact.budget_status.replace(/_/g, " ")}</span>
            </div>
            <div className="safety-flag-grid" aria-label="Approval preview safety flags">
              {Object.entries(preview.approval_request.safety_flags).map(([flag, enabled]) => (
                <span className={enabled ? "enabled" : "disabled"} key={flag}>
                  {formatSafetyFlag(flag)}: {enabled ? "yes" : "no"}
                </span>
              ))}
            </div>
            <div className="context-preview approval-context">
              <div className="section-head compact">
                <div>
                  <span className="eyebrow">Redacted approval context</span>
                  <h3>Stored preview body</h3>
                </div>
                <TruthBadge state="real" label="Secrets redacted" />
              </div>
              {preview.approval_request.redacted_context_preview ? (
                <pre>{preview.approval_request.redacted_context_preview}</pre>
              ) : (
                <p>No approval context preview returned.</p>
              )}
            </div>
          </div>
          <div className="context-preview">
            <div className="section-head compact">
              <div>
                <span className="eyebrow">Compact context packet</span>
                <h3>Redacted preview payload</h3>
              </div>
              <TruthBadge state="demo" label="No model call" />
            </div>
            <pre>{preview.context.compact_context}</pre>
          </div>
          <div className="context-preview">
            <div className="section-head compact">
              <div>
                <span className="eyebrow">Action rules</span>
                <h3>Preview metadata</h3>
              </div>
              <TruthBadge state={actionPreviewState(preview.action_preview.status)} label={preview.action_preview.status} />
            </div>
            {preview.action_preview.status === "blocked" || preview.action_preview.status === "destructive" ? (
              <p className="blocked-preview-note">
                Blocked preview only. Review the metadata and create an approval item later; this patch cannot execute it.
              </p>
            ) : null}
            <ul>
              {preview.action_preview.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
            <p>{preview.action_preview.next_action}</p>
          </div>
        </div>
      ) : null}

      <div className="ledger-history">
        <div className="section-head compact">
          <div>
            <span className="eyebrow">Hermes ledger</span>
            <h3>Recent redacted records</h3>
          </div>
        </div>
        {records.length ? (
          records.map((record) => (
            <article className="ledger-record" key={`${record.timestamp}-${record.request_id}`}>
              <div>
                <strong>{record.task_type}</strong>
                <p>{record.user_request_summary}</p>
              </div>
              <div className="ledger-meta">
                <span>{record.provider_route}</span>
                <span>{record.sensitivity_level}</span>
                <span>{record.approval_status}</span>
                <span>{record.context_chars} chars</span>
              </div>
            </article>
          ))
        ) : (
          <p className="access-note">
            No Hermes records yet or the local ledger file is missing. This is safe; history stays empty until a mock
            route records local JSONL.
          </p>
        )}
      </div>
    </section>
  );
}

function AdminDebugStatusPanel() {
  return (
    <section className="panel truth-panel">
      <div className="section-head">
        <div>
          <span className="eyebrow">Admin/debug truth status</span>
          <h3>Raw implementation status for operator review.</h3>
        </div>
        <TruthBadge state="stub" label="Debug only" />
      </div>
      <div className="truth-grid">
        {truthStatusLabels.map((item) => (
          <article className={`truth-item ${item.state}`} key={item.label}>
            <div>
              <span>{item.label}</span>
              <TruthBadge state={item.state} label={item.state} />
            </div>
            <strong>
              {item.label}: {item.value}
            </strong>
            <p>{item.detail}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function PhantomAiStatusPanel() {
  return (
    <section className="panel phantom-ai-panel">
      <div className="section-head compact">
        <div>
          <span className="eyebrow">Phantom AI status</span>
          <h3>Assistant, memory, and approvals</h3>
        </div>
        <TruthBadge state="demo" label="Demo assistant" />
      </div>
      <div className="ai-status-list">
        <StatusLine label="Phantom AI" value={phantomAiStatus.availability} />
        <StatusLine label="Memory" value={phantomAiStatus.memory} />
        <StatusLine label="Background help" value={phantomAiStatus.fallback} />
        <StatusLine label="Approval gate" value={phantomAiStatus.approvalGate} />
      </div>
      <div className="ai-rule-columns">
        <div>
          <strong>Allowed to suggest</strong>
          <ul>
            {phantomAiStatus.allowedSuggestions.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
        </div>
        <div>
          <strong>Requires approval</strong>
          <ul>
            {phantomAiStatus.approvalRequired.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function TrainerSimulationView({ canManageAccess }: { canManageAccess: boolean }) {
  const simulation = personalTrainingSimulation;
  const [showDebug, setShowDebug] = useState(false);

  return (
    <Page
      title="Phantom AI"
      kicker="Personal training workspace"
      action={<TruthBadge state="demo" label="Demo / Local" />}
    >
      <section className="simulation-hero">
        <div>
          <span className="eyebrow">Owner/operator profile</span>
          <h3>{simulation.owner.business}</h3>
          <p>
            {simulation.owner.name} - {simulation.owner.market}. This cockpit is a local-only simulation seed, not a live
            customer deployment.
          </p>
        </div>
        <div className="simulation-hero-status">
          <StatusLine label="Mode" value={simulation.owner.mode} />
          <StatusLine label="Team Mode" value="Owner Only / Employees Disabled" />
          <StatusLine label="Actions" value="Approval Only / Live Disabled" />
        </div>
      </section>

      <CustomerReadinessPanel />
      <PhantomAiStatusPanel />

      <div className="simulation-grid">
        <SimulationSection icon={<Sparkles size={18} />} title="Services and packages" items={simulation.services} />
        <SimulationSection icon={<Users size={18} />} title="Leads" items={simulation.leads} />
        <SimulationSection icon={<UserRound size={18} />} title="Client roster" items={simulation.clients} />
        <SimulationSection icon={<CalendarDays size={18} />} title="Today's schedule" items={simulation.schedule} />
        <SimulationSection icon={<SquareCheckBig size={18} />} title="Tasks" items={simulation.tasks} />
        <SimulationSection icon={<ShieldCheck size={18} />} title="Approvals queue" items={simulation.approvals} />
        <SimulationSection icon={<KeyRound size={18} />} title="Role model" items={simulation.roleModel} />
        <SimulationSection icon={<Check size={18} />} title="Onboarding checklist" items={simulation.onboardingChecklist} />
        <SimulationSection icon={<AlertTriangle size={18} />} title="Launch blockers" items={simulation.launchBlockers} />
      </div>
      {canManageAccess ? (
        <section className="panel debug-panel">
          <div className="section-head compact">
            <div>
              <span className="eyebrow">Admin/debug</span>
              <h3>Implementation truth labels</h3>
            </div>
            <button className="ghost-small" type="button" onClick={() => setShowDebug((value) => !value)}>
              {showDebug ? "Hide debug" : "Show debug"}
            </button>
          </div>
          <p>
            Debug labels name background systems for owner/support review only. The default owner workspace stays in
            PhantomForce product language.
          </p>
          {showDebug ? <AdminDebugStatusPanel /> : null}
        </section>
      ) : null}
    </Page>
  );
}

function PhantomCutAddonCard() {
  return (
    <section className="module-panel simulation-section phantomcut-card">
      <div className="simulation-section-head">
        <span>
          <Play size={18} />
        </span>
        <div>
          <span className="eyebrow">Media Lab add-on</span>
          <h3>{personalTrainingSimulation.phantomCut.title}</h3>
        </div>
      </div>
      <p>{personalTrainingSimulation.phantomCut.detail}</p>
      <div className="module-list">
        <span>optional</span>
        <span>not core app</span>
        <span>{personalTrainingSimulation.phantomCut.status}</span>
      </div>
    </section>
  );
}

function SimulationSection({ icon, title, items }: { icon: ReactNode; title: string; items: SimulationItem[] }) {
  return (
    <section className="module-panel simulation-section">
      <div className="simulation-section-head">
        <span>{icon}</span>
        <h3>{title}</h3>
      </div>
      <SimulationList items={items} />
    </section>
  );
}

function SimulationList({ items }: { items: SimulationItem[] }) {
  if (!items.length) {
    return (
      <EmptyState
        icon={<Sparkles size={20} />}
        title="No matching results"
        detail="Switch to All results to see the full local demo list."
      />
    );
  }

  return (
    <div className="simulation-list">
      {items.map((item) => (
        <article key={`${item.title}-${item.status ?? "item"}`}>
          <div>
            <strong>{item.title}</strong>
            <p>{item.detail}</p>
          </div>
          {item.status ? <span className="simulation-status">{item.status}</span> : null}
        </article>
      ))}
    </div>
  );
}

function ResultModeToggle({ mode, setMode }: { mode: ResultMode; setMode: (mode: ResultMode) => void }) {
  return (
    <div className="result-toggle" aria-label="Result mode">
      <button
        className={mode === "recommended" ? "active" : ""}
        type="button"
        onClick={() => setMode("recommended")}
      >
        Phantom AI recommended
      </button>
      <button className={mode === "all" ? "active" : ""} type="button" onClick={() => setMode("all")}>
        All results
      </button>
    </div>
  );
}

function StatusLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="status-line">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TruthBadge({ state, label }: { state: TruthState; label: string }) {
  return (
    <span aria-label={label} className={`truth-badge ${state}`}>
      {label}
    </span>
  );
}

function Page({ title, kicker, action, children }: { title: string; kicker: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="page">
      <div className="page-head">
        <div>
          <span className="eyebrow">{kicker}</span>
          <h2>{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function ApprovalCard({
  approval,
  approveAction,
  rejectAction,
  compact = false,
}: {
  approval: Approval;
  approveAction: (id: string) => void;
  rejectAction: (id: string) => void;
  compact?: boolean;
}) {
  const Icon = approval.kind === "email" ? Mail : approval.kind === "calendar" ? CalendarDays : SquareCheckBig;
  return (
    <article className={`approval-card ${compact ? "compact" : ""} ${approval.status}`}>
      <div className="approval-title">
        <span>
          <Icon size={18} />
        </span>
        <div>
          <h3>{approval.title}</h3>
          <p>{approval.summary}</p>
        </div>
      </div>
      {!compact ? (
        <dl className="payload">
          {Object.entries(approval.payload).map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <div className="approval-meta">
        <span>{approval.reversible ? "Reversible" : "External final action"}</span>
        <b>{approval.status}</b>
      </div>
      {approval.status === "pending" ? (
        <div className="approval-actions">
          <button type="button" className="approve" onClick={() => approveAction(approval.id)}>
            <Check size={16} />
            Approve
          </button>
          <button type="button" className="reject" onClick={() => rejectAction(approval.id)}>
            <X size={16} />
            Reject
          </button>
        </div>
      ) : null}
    </article>
  );
}

function ContextRow({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return (
    <div className="context-row">
      <span>{icon}</span>
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
    </div>
  );
}

function EmptyState({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return (
    <div className="empty-state">
      <span>{icon}</span>
      <h3>{title}</h3>
      <p>{detail}</p>
    </div>
  );
}

export default App;
