import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bell,
  Bot,
  CalendarDays,
  Check,
  Clock3,
  Command,
  Copy,
  Download,
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
  | "agents"
  | "inbox"
  | "calendar"
  | "tasks"
  | "content"
  | "media"
  | "site"
  | "offers"
  | "approvals"
  | "access"
  | "activity"
  | "connections";
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

type AiProviderChoice = "phantom" | "openrouter_glm" | "codex" | "glm_5_2" | "claude_cli";

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
    live_transport_enabled: boolean;
    live_call_ready: boolean;
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

type PhantomAiOpsStatus = {
  product_status: string;
  hermes: {
    ready: boolean;
    status: string;
    ledger_enabled: boolean;
    context_compiler_enabled: boolean;
    ledger_exists: boolean;
    ledger_bytes: number;
    interaction_memory_store_enabled: boolean;
    interaction_memory_store_exists: boolean;
    interaction_memory_store_bytes: number;
    local_dev_only: boolean;
    production_write_allowed: boolean;
  };
  glm_worker: {
    configured: boolean;
    model_id: string;
    live_transport_enabled: boolean;
    live_call_ready: boolean;
    status: "ready" | "gated_or_off";
    key_present_masked_boolean: boolean;
    setup_required: boolean;
    payment_setup_needed: boolean;
    detail: string;
  };
  tool_lane_status: {
    status: string;
    selected_tool_id: string | null;
    selected_tool_name: string | null;
    allowed_mode: string | null;
    execution_disabled: boolean;
    would_run: boolean;
    reason: string;
    blocked_actions: string[];
  };
  n8n: {
    n8n_scaffolded: boolean;
    n8n_running: boolean;
    n8n_local_url: string;
    n8n_host: string;
    n8n_port: number;
    health_check: string;
    workflow_drafts: Array<{
      id: string;
      exists: boolean;
      active: boolean;
    }>;
    public_webhooks_allowed: boolean;
    credentials_configured: boolean;
  };
  chicagoshots_ops: {
    available: boolean;
    route: string;
    workflow_preview_enabled: boolean;
    dry_run_only: boolean;
    provider_called: boolean;
    external_send: boolean;
    queue_written: boolean;
    approval_executed: boolean;
  };
  send_readiness: {
    status: "planned_disabled";
    send_enabled: boolean;
    send_route_present: boolean;
    approval_required: boolean;
    manual_operator_confirmation_required: boolean;
    automatic_send_allowed: boolean;
    bulk_send_allowed: boolean;
    queue_execution_allowed: boolean;
    test_allowlist_required: boolean;
    test_allowlist_configured: boolean;
    credentials_configured: boolean;
    credentials_status: "not_configured_no_secret_read";
    external_send: boolean;
    provider_called: boolean;
    n8n_executed: boolean;
    approval_execution: boolean;
    queue_write: boolean;
    production_ledger_write: boolean;
    audit_receipt_required: boolean;
    audit_receipt_written: boolean;
    architecture: string[];
    next_required_before_send: string[];
  };
  safety_flags: {
    approvals_execute_absent: boolean;
    execution_disabled: boolean;
    external_sends_disabled: boolean;
    queue_writes_disabled: boolean;
    production_ledger_writes_disabled: boolean;
    provider_called: boolean;
    live_provider_called: boolean;
    provider_request_body_created: boolean;
    provider_transport_allowed: boolean;
    external_api_call_performed: boolean;
    workflow_executed: boolean;
    n8n_started: boolean;
    public_webhook_opened: boolean;
    credentials_used: boolean;
    approval_executed: boolean;
    queue_written: boolean;
    production_ledger_written: boolean;
    localhost_status_check_performed: boolean;
  };
};

type ChicagoShotsLeadForm = {
  client_name: string;
  contact: string;
  event_type: string;
  date_time: string;
  location: string;
  requested_service: string;
  budget_rate: string;
  source_platform: string;
  urgency: string;
  notes: string;
};

type ChicagoShotsLeadPreset = {
  id: string;
  label: string;
  detail: string;
  form: ChicagoShotsLeadForm;
};

type ChicagoShotsLeadIntakePacket = {
  preview_id: string;
  prepared_at: string;
  normalized_lead: {
    tenant_id: string;
    client_name: string;
    contact: string;
    event_type: string;
    event_category: string;
    date_time: string;
    location: string;
    requested_service: string;
    budget_rate: string;
    source_platform: string;
    urgency: string;
    notes: string;
  };
  recommended_service_package: {
    id: string;
    name: string;
    rationale: string;
    suggested_addons: string[];
  };
  quote_draft: {
    title: string;
    summary: string;
    line_items: string[];
    recommended_price_range: string;
    payment_terms_note: string;
    delivery_timeline: string;
    upsell_options: string[];
    assumptions: string[];
    would_send: false;
    payment_request_created: false;
    invoice_created: false;
  };
  recommended_price_range: string;
  payment_terms_note: string;
  delivery_timeline: string;
  upsell_options: string[];
  task_draft: {
    title: string;
    priority: string;
    suggested_due: string;
    steps: string[];
  };
  deliverables_checklist: string[];
  follow_up_draft: {
    channel_hint: string;
    subject: string;
    body: string;
    would_send: false;
  };
  approval_preview: {
    action_type: string;
    status: string;
    risk_level: string;
    summary: string;
    requires_approval_before_send: boolean;
    execution_disabled: boolean;
    would_send: false;
  };
  memory_context_used: {
    source: string;
    recalled_count: number;
    has_memory: boolean;
    compact_memory: string;
  };
  safety_flags: Record<string, boolean>;
};

type ChicagoShotsProposalStatus = "draft" | "sent_manually" | "follow_up_needed" | "won" | "lost";
type ChicagoShotsProposalHistoryFilter = "all" | ChicagoShotsProposalStatus;
type ChicagoShotsProposalStatusCounts = Record<ChicagoShotsProposalStatus, number> & {
  total: number;
};
type ChicagoShotsProposalPriorityLabel =
  | "send_now"
  | "follow_up_now"
  | "watch_reply"
  | "delivery_ready"
  | "closed_lost";
type ChicagoShotsPhantomAiAction =
  | "draft_follow_up"
  | "generate_proposal"
  | "explain_package"
  | "summarize_saved_packet"
  | "suggest_next_action";
type ChicagoShotsPhantomAiArtifactKind =
  | "follow_up"
  | "proposal"
  | "package"
  | "approval"
  | "saved_packet"
  | "next_action";

type ChicagoShotsPhantomAiArtifact = {
  id: string;
  kind: ChicagoShotsPhantomAiArtifactKind;
  title: string;
  summary: string;
  body?: string;
  details: string[];
  copy_label?: string;
  copy_text?: string;
};

type ChicagoShotsProposalHistoryRecord = {
  id: string;
  created_at: string;
  status: ChicagoShotsProposalStatus;
  status_updated_at: string;
  proposal_priority_score: number;
  proposal_priority_label: ChicagoShotsProposalPriorityLabel;
  proposal_next_action: string;
  proposal_next_action_detail: string;
  proposal_follow_up_timing: string;
  source_preview_id: string;
  client_name: string;
  event_type: string;
  package: string;
  recommended_package: string;
  recommended_price_range: string;
  delivery_timeline: string;
  follow_up_channel: string;
  quote_draft: ChicagoShotsLeadIntakePacket["quote_draft"];
  client_ready_proposal: string;
  proposal_summary: string;
  exported_markdown: string;
  safety_flags: Record<string, boolean>;
  local_dev_only: true;
  production_write_allowed: false;
};

type ChicagoShotsProposalHistoryListResponse = {
  ok?: boolean;
  records?: ChicagoShotsProposalHistoryRecord[];
  summary_counts?: ChicagoShotsProposalStatusCounts;
  error?: string;
};

type ChicagoShotsProposalHistorySaveResponse = {
  ok?: boolean;
  record?: ChicagoShotsProposalHistoryRecord;
  error?: string;
};

type ChicagoShotsProposalStatusUpdateResponse = {
  ok?: boolean;
  record?: ChicagoShotsProposalHistoryRecord;
  error?: string;
};

type PhantomAiChatResponse = {
  ok: boolean;
  provider_choice: AiProviderChoice;
  admin_model_lane?: AiProviderChoice;
  admin_model_label?: string;
  model_id: string;
  message?: {
    role: "assistant";
    content: string;
  };
  hermes?: {
    context_used: boolean;
    ledger_written: boolean;
    provider_route: string;
    recalled_memory_count: number;
  };
  operator?: {
    status: string;
    admin_only: boolean;
    localhost_only: boolean;
    tool_requested: boolean;
    tool_executed: boolean;
    tool_name: string | null;
    tool_result: unknown;
  } | null;
  openrouter?: {
    status: "blocked" | "called" | "error";
    blocked_reason: string | null;
    error_message: string | null;
    provider_called: boolean;
    network_call_performed: boolean;
  };
  claude_cli?: {
    status: "blocked" | "called" | "error";
    blocked_reason: string | null;
    error_message: string | null;
    provider_called: boolean;
    network_call_performed: boolean;
  } | null;
  live_provider_called: boolean;
  network_call_performed: boolean;
  provider_request_body_created: boolean;
  approval_executed: boolean;
  queue_written: boolean;
  external_action_executed: boolean;
  error?: string;
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
const OWNER_ORG_NAME = "PhantomForce";
const DEFAULT_CLIENT_WORKSPACE_ID = "client-chicagoshots";
const CORE_ORGANIZATION_CLIENT_IDS = new Set(["client-chicagoshots", "client-sports-demo", "client-past-due"]);
const ADMIN_ONLY_ROUTES = new Set<Route>(["agents", "site", "access", "connections"]);

const initialSessions: AppSession[] = [
  {
    id: "admin-jordan",
    label: "Jordan (admin)",
    role: "admin",
    canManageAccess: true,
  },
  {
    id: "client-sports-demo",
    label: "Test Client",
    role: "client",
    clientId: "client-sports-demo",
    canManageAccess: false,
  },
];

const navItems: Array<{ id: Route; label: string; icon: ReactNode }> = [
  { id: "command", label: "Home", icon: <Command size={18} /> },
  { id: "agents", label: "Agents", icon: <Bot size={18} /> },
  { id: "site", label: "Site Studio", icon: <FileText size={18} /> },
  { id: "inbox", label: "Leads", icon: <Users size={18} /> },
  { id: "offers", label: "Money", icon: <Zap size={18} /> },
  { id: "content", label: "Create", icon: <FileText size={18} /> },
  { id: "media", label: "Video", icon: <Play size={18} /> },
  { id: "calendar", label: "Bookings", icon: <CalendarDays size={18} /> },
  { id: "tasks", label: "Work", icon: <SquareCheckBig size={18} /> },
  { id: "approvals", label: "Review", icon: <ShieldCheck size={18} /> },
  { id: "access", label: "Access", icon: <KeyRound size={18} /> },
  { id: "connections", label: "System", icon: <Link2 size={18} /> },
];

const validRouteIds = new Set<Route>(navItems.map((item) => item.id));

function parsePreviewRoute(value: string | null): Route {
  return value && validRouteIds.has(value as Route) ? (value as Route) : "command";
}

const initialEmails: EmailItem[] = [
  {
    id: "mail-1",
    from: "ChicagoShots lead",
    subject: "Can we lock a shoot date next week?",
    preview: "Need a quick slot for the product shoot and a quote before Friday.",
    age: "18m",
    priority: "high",
    status: "needs-reply",
    project: "ChicagoShots",
  },
  {
    id: "mail-2",
    from: "Coach/team owner",
    subject: "Media day and highlight package",
    preview: "Needs a clear package, booking window, and parent-facing delivery plan.",
    age: "2h",
    priority: "medium",
    status: "waiting",
    project: "ChicagoShots",
  },
  {
    id: "mail-3",
    from: "Local service business",
    subject: "Website and backend follow-up",
    preview: "Asked what the setup sprint includes and whether booking can be cleaned up.",
    age: "4h",
    priority: "medium",
    status: "needs-reply",
    project: "PhantomForce",
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
    title: "Client decision call",
    time: "Wed 2:00 PM",
    owner: "ChicagoShots lead",
    status: "confirmed",
  },
  {
    id: "event-3",
    title: "Media package review",
    time: "Thu 6:30 PM",
    owner: "Coach/team owner",
    status: "proposed",
  },
];

const initialTasks: TaskItem[] = [
  {
    id: "task-1",
    title: "Reply with shoot options",
    owner: "PhantomForce",
    due: "Today",
    status: "today",
  },
  {
    id: "task-2",
    title: "Review media-day package",
    owner: "Ops",
    due: "Tomorrow",
    status: "queued",
  },
  {
    id: "task-3",
    title: "Draft backend cleanup follow-up",
    owner: "Assistant",
    due: "Today",
    status: "today",
  },
];

const initialActivity: ActivityItem[] = [
  {
    id: "act-1",
    title: "Operator brief generated",
    detail: "Pipeline, content, scheduling, and client next steps are organized.",
    time: "9:02 AM",
    level: "ok",
  },
  {
    id: "act-2",
    title: "Client workflow checked",
    detail: "Drafts, follow-ups, and scheduling actions are ready to review or send.",
    time: "9:01 AM",
    level: "info",
  },
  {
    id: "act-3",
    title: "Private controls protected",
    detail: "Developer tools, credentials, logs, and engine settings stay out of the client workspace.",
    time: "8:58 AM",
    level: "warn",
  },
];

const initialMessages: Message[] = [
  {
    id: "msg-1",
    role: "assistant",
    content:
      "PhantomForce is online. I found one urgent follow-up, two booking opportunities, and a quote path. Tell me what to do: reply, book, quote, create content, or clean up the day.",
  },
];

const connections: Connection[] = [
  {
    id: "gmail",
    name: "Google Gmail",
    description: "Read inbox, identify follow-ups, draft replies, and prepare sends for final confirmation.",
    status: "connected",
    scopes: ["Read mail", "Draft mail", "Confirm before send"],
  },
  {
    id: "calendar",
    name: "Google Calendar",
    description: "Check availability, propose meeting times, and stage booking actions.",
    status: "connected",
    scopes: ["Read calendar", "Stage booking"],
  },
  {
    id: "falcon",
    name: "Private action engine",
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
    business: "Test Client",
    owner: "Demo Client",
    plan: "Test client workspace",
    paymentStatus: "paid",
    accessStatus: "active",
    gateway: "Pangolin",
    privateRoute: "app.phantomforce.online/test-client",
    modules: ["Command", "Calendar", "Tasks", "Approvals", "Contacts"],
    lastAudit: "Deposit paid; workspace active",
  },
  {
    id: "client-past-due",
    business: "The Force",
    owner: "Client Owner",
    plan: "$1,250/mo Ops Support",
    paymentStatus: "failed",
    accessStatus: "revoked",
    gateway: "Pangolin",
    privateRoute: "app.phantomforce.online/the-force",
    modules: ["Command", "Tasks", "Reports"],
    lastAudit: "Payment failed; private route revoked",
  },
];

function normalizeClientAccessRecord(record: ClientAccess): ClientAccess {
  if (record.id === "client-sports-demo") {
    return {
      ...record,
      business: "Test Client",
      owner: record.owner === "Client Owner" || record.owner === "Sports Ops Demo Owner" ? "Demo Client" : record.owner,
      plan: record.plan === "$2,000 Team Media Day" ? "Test client workspace" : record.plan,
      privateRoute:
        record.privateRoute === "app.phantomforce.online/sports-ops-demo"
          ? "app.phantomforce.online/test-client"
          : record.privateRoute,
    };
  }

  if (record.id === "client-past-due") {
    return {
      ...record,
      business: "The Force",
      privateRoute:
        record.privateRoute === "app.phantomforce.online/past-due-pilot"
          ? "app.phantomforce.online/the-force"
          : record.privateRoute,
      lastAudit: record.lastAudit.replace(/Past Due Pilot/g, "The Force"),
    };
  }

  return record;
}

function phantomAiModeLabel(choice: AiProviderChoice): string {
  if (choice === "glm_5_2") return "Deep thinking";
  if (choice === "claude_cli") return "Second opinion";
  return "Auto";
}

function normalizePangolinRoutePlan(plan: PangolinRoutePlan): PangolinRoutePlan {
  if (plan.clientId === "client-sports-demo") {
    return {
      ...plan,
      business: "Test Client",
      privateRoute:
        plan.privateRoute === "app.phantomforce.online/sports-ops-demo"
          ? "app.phantomforce.online/test-client"
          : plan.privateRoute,
    };
  }

  if (plan.clientId === "client-past-due") {
    return {
      ...plan,
      business: "The Force",
      privateRoute:
        plan.privateRoute === "app.phantomforce.online/past-due-pilot"
          ? "app.phantomforce.online/the-force"
          : plan.privateRoute,
    };
  }

  return plan;
}

function accessStatusFromGuardMode(mode: GuardedWorkspace["mode"]): ClientAccessStatus {
  if (mode === "blocked") return "revoked";
  if (mode === "read_only") return "past_due";
  return "active";
}

const modules = [
  "AI Command",
  "Email",
  "Calendar",
  "Work",
  "Review",
  "Activity",
  "Contacts",
  "Documents",
  "Private engine",
];

const clientModuleCatalog = [
  "Command",
  "Calendar",
  "Work",
  "Review",
  "Contacts",
  "Content",
  "Activity",
  "Documents",
  "Reports",
];

const truthStatusLabels: TruthLabel[] = [
  {
    label: "PhantomAI",
    value: "Unified AI workspace",
    state: "demo",
    detail:
      "Users interact with PhantomAI only. Model routing, tools, and backend internals stay behind the product surface.",
  },
  {
    label: "Memory",
    value: "Local context active",
    state: "real",
    detail:
      "Workspace context and receipts can be stored locally without exposing raw backend systems to users.",
  },
  {
    label: "Access",
    value: "Demo Local / Owner Config-Gated / Pangolin Dry-Run",
    state: "demo",
    detail:
      "Local sessions and owner admin are config-gated. Pangolin status is inspection-only unless separately proven live.",
  },
  {
    label: "Spend",
    value: "Controlled",
    state: "stub",
    detail:
      "Live paid generation remains gated until each capability is explicitly enabled.",
  },
  {
    label: "Actions",
    value: "Review Queue / Live Sends Off",
    state: "real",
    detail:
      "The UI prepares work for review. External sends, uploads, deploys, billing, and destructive actions stay off until explicitly connected.",
  },
  {
    label: "Client Mode",
    value: "PhantomForce + ChicagoShots",
    state: "real",
    detail: "The visible workspace is focused on PhantomForce operations and ChicagoShots media/content workflows.",
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
    value: "Online",
    state: "real",
    detail:
      "Phantom AI drafts, prioritizes, and organizes business actions from inside the dashboard.",
  },
  {
    label: "ChicagoShots",
    value: "Workflow ready",
    state: "real",
    detail: "Lead intake, quote drafts, proposal packets, and local follow-up status are available from the cockpit.",
  },
  {
    label: "Actions",
    value: "Review queue",
    state: "real",
    detail:
      "Drafts and suggested actions stay visible until Jordan confirms, edits, or sends them.",
  },
  {
    label: "Sending",
    value: "Draft-first",
    state: "real",
    detail: "The next live step is a confirmed-send adapter with allowlisted test recipients and audit receipts.",
  },
];

const phantomAiStatus = {
  availability: "Online",
  memory: "Workspace context active",
  fallback: "Provider and developer details stay behind Phantom AI",
  approvalGate: "Confirm before external send",
  allowedSuggestions: [
    "Prioritize leads, proposal packets, schedule gaps, and follow-ups",
    "Draft replies, quotes, booking plans, and operational next steps",
    "Summarize what to do next without exposing developer tooling",
  ],
  approvalRequired: [
    "Sending email, posting content, uploads, deploys, route changes, billing, credentials, deletes, or production changes",
    "Any customer-facing claim that has not been proven inside the dashboard",
  ],
};

const businessOpsSimulation = {
  owner: {
    name: "Jordan West",
    business: "PhantomForce",
    market: "AI-assisted business ops, media, websites, apps, dashboards, and content systems",
    mode: "Internal owner cockpit",
  },
  services: [
    {
      title: "$750 Starter Setup",
      detail: "Quick ops cleanup, offer clarity, follow-up drafts, and a simple action board.",
      status: "starter",
    },
    {
      title: "$1,500 Core Sprint",
      detail: "Command center setup, lead workflow, proposal/quote package, content plan, and delivery handoff.",
      status: "default",
    },
    {
      title: "$2,500 Pro Buildout",
      detail: "Messy workflow rescue with dashboard/app planning, automations, video support, and retainer path.",
      status: "pro",
    },
  ],
  leads: [
    { title: "Jordan Test Client", detail: "Needs ChicagoShots sports media packet and follow-up timing.", status: "hot" },
    { title: "Local service business", detail: "Needs website/backend cleanup and a simple booking workflow.", status: "warm" },
    { title: "Coach/team owner", detail: "Needs media day offer, parent communication, and highlight delivery structure.", status: "new" },
  ],
  clients: [
    { title: "ChicagoShots", detail: "Partner media workspace for videography, sports content, and deliverables.", status: "active" },
    { title: "PhantomForce", detail: "Owner workspace for AI ops, offers, buildouts, and follow-up systems.", status: "active" },
    { title: "New setup sprint lead", detail: "Proposal packet ready; send manually or book the call.", status: "ready" },
  ],
  schedule: [
    { title: "15-minute setup call", detail: "Map the mess, qualify package, and choose Starter/Core/Pro.", status: "hold" },
    { title: "ChicagoShots packet review", detail: "Confirm deliverables, price range, proof/demo, and next follow-up.", status: "confirmed" },
    { title: "Ops sprint delivery block", detail: "Build dashboard/docs/follow-up system after the client says yes.", status: "proposed" },
  ],
  tasks: [
    { title: "Review priority proposal packet", detail: "Confirm scope and mark sent manually after Jordan sends it.", status: "today" },
    { title: "Prepare Core Sprint follow-up", detail: "Draft short reply and price anchor for review.", status: "ready" },
    { title: "Package proof/demo link", detail: "Attach THE FORCE / video proof only where accurate.", status: "queued" },
  ],
  approvals: [
    { title: "Send Core Sprint follow-up", detail: "Email draft is ready; Jordan sends it manually.", status: "pending" },
    { title: "Publish showcase clip", detail: "Needs review before posting; no autonomous posting.", status: "blocked" },
    { title: "Create payment request", detail: "Payment/invoice creation is not active until separately connected.", status: "blocked" },
  ],
  contentCalendar: [
    { title: "Monday", detail: "Why small businesses need an ops system before more random apps.", status: "draft" },
    { title: "Wednesday", detail: "ChicagoShots media-day package: sports clips, photos, and delivery structure.", status: "draft" },
    { title: "Friday", detail: "Video proof clip needs a final check before posting.", status: "review" },
  ],
  contentIdeas: [
    { title: "Ops + Content Setup Sprint", detail: "Simple explainer for the $1,500 Core Sprint.", status: "recommended" },
    { title: "ChicagoShots media arm", detail: "How videography/content plugs into PhantomForce systems.", status: "recommended" },
    { title: "Client proof story", detail: "Use only proof-backed assets; no fake results or testimonials.", status: "review" },
    { title: "Behind the build", detail: "Show dashboard/action workflow without exposing dev tools.", status: "queued" },
  ],
  contentDrafts: [
    { title: "Core Sprint private-send message", detail: "Draft only until Jordan manually sends.", status: "ready" },
    { title: "THE FORCE send package", detail: "Use privately; public posting is off.", status: "blocked" },
    { title: "Website/backend cleanup post", detail: "Draft only; platform posting is not wired.", status: "draft" },
  ],
  mediaRequests: [
    { title: "Sports highlight clips", detail: "ChicagoShots deliverable planning for teams, coaches, and events.", status: "ready" },
    { title: "Private launch reel", detail: "THE FORCE v0.3-style product showcase for serious prospects.", status: "planned" },
    { title: "Client media proof", detail: "Consent and usage rights required before publish workflow.", status: "blocked" },
  ],
  mediaDeliverables: [
    { title: "Highlight cutdown", detail: "Short-form clip workflow for review and delivery.", status: "queued" },
    { title: "Generated creative proof", detail: "Creative output proof; no autonomous posting.", status: "review" },
    { title: "Media day checklist", detail: "Shot list, consent checklist, and delivery plan.", status: "planned" },
  ],
  mediaPlaceholders: [
    { title: "Uploads", detail: "Use manual/local handoff until upload intake is connected.", status: "planned" },
    { title: "Delivery links", detail: "External delivery/posting needs final confirmation.", status: "review" },
    { title: "Client consent vault", detail: "Consent tracking is required before public media usage.", status: "required" },
  ],
  offerRecommendations: [
    { title: "Lead with $1,500 Core Sprint", detail: "Best default for businesses that need ops + content setup.", status: "recommended" },
    { title: "Fallback to $750 Starter", detail: "Use when the prospect is smaller or needs a lower-friction entry.", status: "option" },
    { title: "Upgrade to $2,500 Pro", detail: "Use for messy workflows, teams, dashboards, or content/media complexity.", status: "recommended" },
  ],
  pricingDrafts: [
    { title: "$750 Starter", detail: "Lean setup and first follow-up/proposal package.", status: "draft" },
    { title: "$1,500 Core", detail: "Default Ops + Content Setup Sprint.", status: "draft" },
    { title: "$2,500 Pro", detail: "Expanded system/dashboard/media workflow.", status: "option" },
  ],
  onboardingChecklist: [
    { title: "Business surfaces", detail: "PhantomForce, ChicagoShots, video output, and offer ladder are aligned.", status: "done" },
    { title: "Send controls", detail: "External actions require an explicit final click.", status: "done" },
    { title: "Send adapter", detail: "Next build step before real email/test sends.", status: "required" },
    { title: "Client-safe dashboard mode", detail: "Developer and engine internals stay off the normal cockpit.", status: "done" },
  ],
  launchBlockers: [
    { title: "Send adapter", detail: "Real sending needs allowlist, confirmation phrase, and audit receipts.", status: "required" },
    { title: "Payment/invoice action", detail: "Billing actions need a separate confirmed implementation.", status: "required" },
    { title: "Client delivery proof", detail: "Use real deliverables before claiming autonomous production.", status: "required" },
  ],
  phantomCut: {
    title: "Video Studio add-on",
    detail:
      "Optional video/editor support for reels, sports clips, creative proofs, and media-heavy clients.",
    status: "available/proof-backed/planned",
  },
  roleModel: [
    { title: "Jordan / PhantomForce", detail: "Platform super-admin concept and final control layer.", status: "operator" },
    { title: "Business owner", detail: "Admin only for this business workspace.", status: "owner admin" },
    { title: "Employees", detail: "Disabled/future until roles, audit, and permission rules are implemented.", status: "disabled" },
    { title: "Client portal users", detail: "Optional/future. Current workspaces focus on scoped client actions.", status: "future" },
  ],
};

const API_BASE_URL =
  (import.meta as unknown as { env?: { VITE_API_BASE_URL?: string } }).env?.VITE_API_BASE_URL?.replace(/\/$/, "") ??
  "http://127.0.0.1:5190";
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
    live_transport_enabled: false,
    live_call_ready: false,
    detail:
      "OpenRouter account/API key is required before GLM 5.2 can run through Phantom AI.",
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

const defaultPhantomAiOpsStatus: PhantomAiOpsStatus = {
  product_status: "Online - protected",
  hermes: {
    ready: false,
    status: "Status unavailable",
    ledger_enabled: false,
    context_compiler_enabled: false,
    ledger_exists: false,
    ledger_bytes: 0,
    interaction_memory_store_enabled: false,
    interaction_memory_store_exists: false,
    interaction_memory_store_bytes: 0,
    local_dev_only: true,
    production_write_allowed: false,
  },
  glm_worker: {
    configured: false,
    model_id: "z-ai/glm-5.2",
    live_transport_enabled: false,
    live_call_ready: false,
    status: "gated_or_off",
    key_present_masked_boolean: false,
    setup_required: true,
    payment_setup_needed: true,
    detail: "GLM worker lane is gated/off unless admin env flags and provider readiness are enabled.",
  },
  tool_lane_status: {
    status: "dry_run_preview",
    selected_tool_id: "n8n",
    selected_tool_name: "n8n",
    allowed_mode: "dry_run_only",
    execution_disabled: true,
    would_run: false,
    reason: "Tool lane status is waiting on the backend. Nothing can run.",
    blocked_actions: [],
  },
  n8n: {
    n8n_scaffolded: false,
    n8n_running: false,
    n8n_local_url: "http://127.0.0.1:5678",
    n8n_host: "127.0.0.1",
    n8n_port: 5678,
    health_check: "not_checked",
    workflow_drafts: [],
    public_webhooks_allowed: false,
    credentials_configured: false,
  },
  chicagoshots_ops: {
    available: false,
    route: "POST /phantom-ai/ops/chicagoshots/lead-intake/preview",
    workflow_preview_enabled: false,
    dry_run_only: true,
    provider_called: false,
    external_send: false,
    queue_written: false,
    approval_executed: false,
  },
  send_readiness: {
    status: "planned_disabled",
    send_enabled: false,
    send_route_present: false,
    approval_required: true,
    manual_operator_confirmation_required: true,
    automatic_send_allowed: false,
    bulk_send_allowed: false,
    queue_execution_allowed: false,
    test_allowlist_required: true,
    test_allowlist_configured: false,
    credentials_configured: false,
    credentials_status: "not_configured_no_secret_read",
    external_send: false,
    provider_called: false,
    n8n_executed: false,
    approval_execution: false,
    queue_write: false,
    production_ledger_write: false,
    audit_receipt_required: true,
    audit_receipt_written: false,
    architecture: [
      "Draft only inside PhantomForce.",
      "Owner approval required before any external send route can exist.",
      "Manual operator confirmation required for one allowed test recipient.",
    ],
    next_required_before_send: [
      "Implement a separate approval-gated send adapter.",
      "Add a local test-recipient allowlist.",
      "Add redacted receipt storage for every send attempt.",
    ],
  },
  safety_flags: {
    approvals_execute_absent: true,
    execution_disabled: true,
    external_sends_disabled: true,
    queue_writes_disabled: true,
    production_ledger_writes_disabled: true,
    provider_called: false,
    live_provider_called: false,
    provider_request_body_created: false,
    provider_transport_allowed: false,
    external_api_call_performed: false,
    workflow_executed: false,
    n8n_started: false,
    public_webhook_opened: false,
    credentials_used: false,
    approval_executed: false,
    queue_written: false,
    production_ledger_written: false,
    localhost_status_check_performed: false,
  },
};

const defaultChicagoShotsLeadForm: ChicagoShotsLeadForm = {
  client_name: "",
  contact: "",
  event_type: "",
  date_time: "",
  location: "",
  requested_service: "",
  budget_rate: "",
  source_platform: "",
  urgency: "",
  notes: "",
};

const chicagoShotsLeadPresets: ChicagoShotsLeadPreset[] = [
  {
    id: "sports-highlight",
    label: "Sports highlight inquiry",
    detail: "Team action gallery + short social clips",
    form: {
      client_name: "Coach Ramirez",
      contact: "coach@example.com",
      event_type: "sports tournament",
      date_time: "Saturday afternoon",
      location: "South Loop fieldhouse",
      requested_service: "team action photos and highlight clips",
      budget_rate: "$1,200 target",
      source_platform: "Instagram DM",
      urgency: "high",
      notes: "Parent booster group wants fast action coverage, a small gallery, and social-ready clips for top plays.",
    },
  },
  {
    id: "real-estate-listing",
    label: "Real estate listing media",
    detail: "MLS stills + optional walkthrough video",
    form: {
      client_name: "Taylor Brooks",
      contact: "taylor@homes.example",
      event_type: "real estate listing",
      date_time: "Thursday morning",
      location: "West Loop condo",
      requested_service: "property photos and walkthrough video",
      budget_rate: "$750-$1,000",
      source_platform: "Referral",
      urgency: "medium",
      notes: "Listing goes live next week. Needs bright interior photos, exterior shots, and optional vertical walkthrough.",
    },
  },
  {
    id: "event-wedding",
    label: "Event / wedding coverage",
    detail: "Timeline, gallery, teaser, approval-ready reply",
    form: {
      client_name: "Maria Lopez",
      contact: "maria@example.com",
      event_type: "wedding",
      date_time: "August 15 at 4 PM",
      location: "Lincoln Park Conservatory",
      requested_service: "ceremony coverage and reception highlights",
      budget_rate: "$3,500",
      source_platform: "Website form",
      urgency: "high",
      notes: "Outdoor ceremony, reception nearby, wants full gallery and a short teaser for family.",
    },
  },
];

function formatChicagoShotsFollowUpDraft(packet: ChicagoShotsLeadIntakePacket) {
  return [
    `Subject: ${packet.follow_up_draft.subject}`,
    "",
    packet.follow_up_draft.body,
    "",
    "Status: Preview only. Jordan must review before any manual use.",
  ].join("\n");
}

function formatChicagoShotsClientSummary(packet: ChicagoShotsLeadIntakePacket) {
  return [
    `${packet.normalized_lead.client_name || "New ChicagoShots lead"} - ${packet.recommended_service_package.name}`,
    `Contact: ${packet.normalized_lead.contact || "Not provided"}`,
    `Need: ${packet.normalized_lead.requested_service || packet.normalized_lead.event_type || "Not provided"}`,
    `When/location: ${packet.normalized_lead.date_time || "TBD"} / ${packet.normalized_lead.location || "TBD"}`,
    `Budget: ${packet.normalized_lead.budget_rate || "Not provided"}`,
    `Urgency: ${packet.normalized_lead.urgency}`,
    `Next step: ${packet.task_draft.steps[0] ?? "Review lead and confirm scope."}`,
    "",
    "Preview only. No send. No queue write. No ledger write.",
  ].join("\n");
}

function formatChicagoShotsDeliverables(packet: ChicagoShotsLeadIntakePacket) {
  return [
    `ChicagoShots deliverables - ${packet.recommended_service_package.name}`,
    `Client: ${packet.normalized_lead.client_name || "New lead"}`,
    "",
    ...packet.deliverables_checklist.map((item, index) => `${index + 1}. ${item}`),
    "",
    "Status: Preview only. No queue write. No ledger write.",
  ].join("\n");
}

function formatChicagoShotsQuoteDraft(packet: ChicagoShotsLeadIntakePacket) {
  return [
    packet.quote_draft.title,
    "",
    packet.quote_draft.summary,
    "",
    `Recommended range: ${packet.recommended_price_range}`,
    `Delivery timeline: ${packet.delivery_timeline}`,
    `Payment terms: ${packet.payment_terms_note}`,
    "",
    "Line items:",
    ...packet.quote_draft.line_items.map((item, index) => `${index + 1}. ${item}`),
    "",
    "Upsell options:",
    ...packet.upsell_options.map((item, index) => `${index + 1}. ${item}`),
    "",
    "Assumptions:",
    ...packet.quote_draft.assumptions.map((item, index) => `${index + 1}. ${item}`),
    "",
    "Status: Preview only. No send. No payment request. No invoice. No queue write. No ledger write.",
  ].join("\n");
}

function formatChicagoShotsProposalSummary(packet: ChicagoShotsLeadIntakePacket) {
  return [
    `${packet.normalized_lead.client_name || "New ChicagoShots lead"} - ${packet.recommended_service_package.name}`,
    `Quote range: ${packet.recommended_price_range}`,
    `Timeline: ${packet.delivery_timeline}`,
    `Package fit: ${packet.recommended_service_package.rationale}`,
    `Primary deliverables: ${packet.deliverables_checklist.join(", ")}`,
    `Upsells: ${packet.upsell_options.join(", ") || "None"}`,
    "",
    packet.payment_terms_note,
    "",
    "Preview only. Jordan must review before manual client use.",
  ].join("\n");
}

function formatChicagoShotsClientReadyProposal(packet: ChicagoShotsLeadIntakePacket) {
  const clientName = packet.normalized_lead.client_name || "ChicagoShots client";
  const eventName = packet.normalized_lead.event_type || packet.normalized_lead.requested_service || "media project";
  return [
    "# ChicagoShots Proposal Draft",
    "",
    `Prepared for: ${clientName}`,
    `Project: ${eventName}`,
    `Date/time: ${packet.normalized_lead.date_time || "To be confirmed"}`,
    `Location: ${packet.normalized_lead.location || "To be confirmed"}`,
    "",
    "## Project Summary",
    "",
    packet.quote_draft.summary,
    "",
    "## Recommended Package",
    "",
    `${packet.recommended_service_package.name}: ${packet.recommended_service_package.rationale}`,
    "",
    "## Quote Range",
    "",
    packet.recommended_price_range,
    "",
    "## Deliverables",
    "",
    ...packet.deliverables_checklist.map((item) => `- ${item}`),
    "",
    "## Delivery Timeline",
    "",
    packet.delivery_timeline,
    "",
    "## Payment Terms",
    "",
    packet.payment_terms_note,
    "",
    "## Optional Add-ons",
    "",
    ...packet.upsell_options.map((item) => `- ${item}`),
    "",
    "## Follow-up Draft",
    "",
    packet.follow_up_draft.body,
  ].join("\n");
}

function formatChicagoShotsIntakePacket(packet: ChicagoShotsLeadIntakePacket) {
  return [
    formatChicagoShotsClientReadyProposal(packet),
    "",
    "---",
    "",
    "# Internal Operator Notes",
    "",
    `- Preview ID: ${packet.preview_id}`,
    `- Prepared: ${packet.prepared_at}`,
    `- Status: Preview only / manual-send only`,
    `- External send: No`,
    `- Payment request: No`,
    `- Invoice: No`,
    `- Queue write: No`,
    `- Ledger write: No`,
    "",
    "## Internal client summary",
    "",
    formatChicagoShotsClientSummary(packet),
    "",
    "## Internal lead notes",
    "",
    `- Client: ${packet.normalized_lead.client_name || "New lead"}`,
    `- Contact: ${packet.normalized_lead.contact || "Not provided"}`,
    `- Category: ${packet.normalized_lead.event_category}`,
    `- Event: ${packet.normalized_lead.event_type || "Not provided"}`,
    `- Date/time: ${packet.normalized_lead.date_time || "Not provided"}`,
    `- Location: ${packet.normalized_lead.location || "Not provided"}`,
    `- Budget/rate: ${packet.normalized_lead.budget_rate || "Not provided"}`,
    `- Source: ${packet.normalized_lead.source_platform || "Not provided"}`,
    `- Urgency: ${packet.normalized_lead.urgency}`,
    `- Notes: ${packet.normalized_lead.notes || "None"}`,
    "",
    "## Internal quote details",
    "",
    formatChicagoShotsQuoteDraft(packet),
    "",
    "## Operator task draft",
    "",
    `${packet.task_draft.title} (${packet.task_draft.priority}, due ${packet.task_draft.suggested_due})`,
    ...packet.task_draft.steps.map((step, index) => `${index + 1}. ${step}`),
    "",
    "## Approval preview",
    "",
    `- Status: ${packet.approval_preview.status}`,
    `- Risk: ${packet.approval_preview.risk_level}`,
    `- Execution disabled: ${packet.approval_preview.execution_disabled ? "true" : "false"}`,
    `- Summary: ${packet.approval_preview.summary}`,
    "",
    "## Safety flags",
    "",
    ...Object.entries(packet.safety_flags).map(([key, value]) => `- ${key}: ${value ? "true" : "false"}`),
    "",
    "Preview only. No send. No payment request. No invoice. No queue write. No ledger write.",
  ].join("\n");
}

function chicagoShotsPacketFileName(packet: ChicagoShotsLeadIntakePacket) {
  const base = packet.normalized_lead.client_name || packet.recommended_service_package.name || packet.preview_id;
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);
  const dateSlug = packet.prepared_at.slice(0, 10) || "preview";
  return `chicagoshots-intake-${slug || "lead"}-${dateSlug}.md`;
}

function chicagoShotsSavedPacketFileName(record: ChicagoShotsProposalHistoryRecord) {
  const slug = (record.client_name || record.package || record.id)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);
  const dateSlug = record.created_at.slice(0, 10) || "saved";
  return `chicagoshots-proposal-${slug || "lead"}-${dateSlug}.md`;
}

const chicagoShotsProposalStatusLabels: Record<ChicagoShotsProposalStatus, string> = {
  draft: "Draft",
  sent_manually: "Sent manually",
  follow_up_needed: "Follow-up needed",
  won: "Won",
  lost: "Lost",
};

const chicagoShotsProposalStatusOptions: ChicagoShotsProposalStatus[] = [
  "draft",
  "sent_manually",
  "follow_up_needed",
  "won",
  "lost",
];

const chicagoShotsProposalHistoryFilters: ChicagoShotsProposalHistoryFilter[] = [
  "all",
  "draft",
  "sent_manually",
  "follow_up_needed",
  "won",
  "lost",
];

const chicagoShotsProposalPriorityLabels: Record<ChicagoShotsProposalPriorityLabel, string> = {
  send_now: "Send now",
  follow_up_now: "Follow up now",
  watch_reply: "Watch reply",
  delivery_ready: "Delivery ready",
  closed_lost: "Closed lost",
};

const defaultChicagoShotsProposalStatusCounts: ChicagoShotsProposalStatusCounts = {
  total: 0,
  draft: 0,
  sent_manually: 0,
  follow_up_needed: 0,
  won: 0,
  lost: 0,
};

function countChicagoShotsProposalStatuses(records: ChicagoShotsProposalHistoryRecord[]): ChicagoShotsProposalStatusCounts {
  return records.reduce(
    (counts, record) => ({
      ...counts,
      total: counts.total + 1,
      [record.status]: counts[record.status] + 1,
    }),
    { ...defaultChicagoShotsProposalStatusCounts },
  );
}

function chicagoShotsProposalBody(record: ChicagoShotsProposalHistoryRecord) {
  return record.client_ready_proposal || record.exported_markdown;
}

function hasChicagoShotsLeadInput(form: ChicagoShotsLeadForm) {
  return Object.values(form).some((value) => value.trim().length > 0);
}

function createChicagoShotsArtifact(
  kind: ChicagoShotsPhantomAiArtifactKind,
  title: string,
  summary: string,
  details: string[],
  options: { body?: string; copyLabel?: string; copyText?: string } = {},
): ChicagoShotsPhantomAiArtifact {
  return {
    id: makeId(`phantom-ai-${kind}`),
    kind,
    title,
    summary,
    body: options.body,
    details,
    copy_label: options.copyLabel,
    copy_text: options.copyText,
  };
}

function createChicagoShotsNextActionArtifact(summary: string, details: string[]) {
  const copyText = [summary, ...details.map((detail) => `- ${detail}`)].join("\n");

  return createChicagoShotsArtifact("next_action", "Suggested next action", summary, details, {
    copyLabel: "next action",
    copyText,
  });
}

function buildFollowUpArtifact(packet: ChicagoShotsLeadIntakePacket) {
  const draft = formatChicagoShotsFollowUpDraft(packet);

  return createChicagoShotsArtifact(
    "follow_up",
    packet.follow_up_draft.subject,
    `Prepared for ${packet.normalized_lead.client_name || "the lead"} on ${packet.follow_up_draft.channel_hint}.`,
    [
      "Preview-only draft",
      "Jordan approval required before any manual send",
      `Package: ${packet.recommended_service_package.name}`,
    ],
    {
      body: packet.follow_up_draft.body,
      copyLabel: "follow-up draft",
      copyText: draft,
    },
  );
}

function buildProposalArtifact(packet: ChicagoShotsLeadIntakePacket) {
  const proposal = formatChicagoShotsClientReadyProposal(packet);

  return createChicagoShotsArtifact(
    "proposal",
    packet.quote_draft.title,
    packet.quote_draft.summary,
    [
      `Range: ${packet.recommended_price_range}`,
      `Timeline: ${packet.delivery_timeline}`,
      "No payment request or invoice created",
    ],
    {
      body: proposal,
      copyLabel: "client-ready proposal",
      copyText: proposal,
    },
  );
}

function buildPackageArtifact(packet: ChicagoShotsLeadIntakePacket) {
  return createChicagoShotsArtifact(
    "package",
    `${packet.recommended_service_package.name} recommendation`,
    packet.recommended_service_package.rationale,
    [
      `Category: ${packet.normalized_lead.event_category}`,
      `Add-ons: ${packet.recommended_service_package.suggested_addons.join(", ") || "None"}`,
      `Quote range: ${packet.recommended_price_range}`,
    ],
  );
}

function buildApprovalArtifact(packet: ChicagoShotsLeadIntakePacket) {
  return createChicagoShotsArtifact(
    "approval",
    "Approval preview",
    packet.approval_preview.summary,
    [
      `Status: ${packet.approval_preview.status}`,
      `Risk: ${packet.approval_preview.risk_level}`,
      `Execution disabled: ${packet.approval_preview.execution_disabled ? "true" : "false"}`,
      "No approval execution route is used",
    ],
  );
}

function buildSavedPacketArtifact(record: ChicagoShotsProposalHistoryRecord) {
  const proposal = chicagoShotsProposalBody(record);

  return createChicagoShotsArtifact(
    "saved_packet",
    `${record.client_name} - ${record.package}`,
    record.proposal_summary,
    [
      `Status: ${chicagoShotsProposalStatusLabels[record.status]}`,
      `Priority: ${record.proposal_priority_score} / ${chicagoShotsProposalPriorityLabels[record.proposal_priority_label]}`,
      `Next action: ${record.proposal_next_action}`,
      `Range: ${record.recommended_price_range}`,
      `Updated: ${record.status_updated_at}`,
    ],
    {
      body: proposal,
      copyLabel: "saved proposal packet",
      copyText: proposal,
    },
  );
}

function chicagoShotsProposalStatusLabel(status: ChicagoShotsProposalHistoryFilter) {
  if (status === "all") return "All";
  if (status === "draft") return "Drafts";
  return chicagoShotsProposalStatusLabels[status];
}

function chicagoShotsProposalStatusClass(status: ChicagoShotsProposalStatus) {
  return `status-${status.replace(/_/g, "-")}`;
}

function chicagoShotsProposalPriorityClass(label: ChicagoShotsProposalPriorityLabel) {
  return `priority-${label.replace(/_/g, "-")}`;
}

function sortChicagoShotsProposalHistory(records: ChicagoShotsProposalHistoryRecord[]) {
  return [...records].sort(
    (left, right) =>
      right.proposal_priority_score - left.proposal_priority_score ||
      right.status_updated_at.localeCompare(left.status_updated_at) ||
      right.created_at.localeCompare(left.created_at),
  );
}

function chicagoShotsProposalSearchText(record: ChicagoShotsProposalHistoryRecord) {
  return [
    record.client_name,
    record.event_type,
    record.package,
    record.recommended_package,
    record.recommended_price_range,
    record.delivery_timeline,
    record.follow_up_channel,
    record.proposal_summary,
    record.proposal_next_action,
    record.proposal_next_action_detail,
    chicagoShotsProposalPriorityLabels[record.proposal_priority_label],
    record.status,
  ]
    .join(" ")
    .toLowerCase();
}

function getChicagoShotsPriorityProposal(records: ChicagoShotsProposalHistoryRecord[]) {
  return sortChicagoShotsProposalHistory(records)[0] ?? null;
}

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
  const [previewLinkApplied, setPreviewLinkApplied] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState("admin-jordan");
  const [sessionToken, setSessionToken] = useState("");
  const [commandText, setCommandText] = useState("");
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [emails, setEmails] = useState(initialEmails);
  const [events, setEvents] = useState(initialEvents);
  const [tasks, setTasks] = useState(initialTasks);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [activity, setActivity] = useState(initialActivity);
  const [clientAccess, setClientAccess] = useState(initialClientAccess.map(normalizeClientAccessRecord));
  const [guardedWorkspace, setGuardedWorkspace] = useState<GuardedWorkspace | null>(null);
  const [workspaceModuleView, setWorkspaceModuleView] = useState<WorkspaceModuleView | null>(null);
  const [pangolinPlan, setPangolinPlan] = useState<PangolinRoutePlan[]>([]);
  const [pangolinStatus, setPangolinStatus] = useState<PangolinReadOnlyStatus | null>(null);
  const [readinessReport, setReadinessReport] = useState<ProductionReadinessReport | null>(null);
  const [providerSetupStatus, setProviderSetupStatus] = useState<ProviderSetupStatus>(defaultProviderSetupStatus);
  const [phantomAiOpsStatus, setPhantomAiOpsStatus] =
    useState<PhantomAiOpsStatus>(defaultPhantomAiOpsStatus);
  const [aiProvider, setAiProvider] = useState<AiProviderChoice>("codex");
  const [phantomAiBusy, setPhantomAiBusy] = useState(false);
  const [moneyDemoBusy, setMoneyDemoBusy] = useState<MoneyDemoStage | null>(null);
  const [selectedOrg, setSelectedOrg] = useState(OWNER_ORG_NAME);
  const activeSession = useMemo(
    () => initialSessions.find((session) => session.id === activeSessionId) ?? initialSessions[0],
    [activeSessionId],
  );
  const canManageAccess = activeSession.canManageAccess;
  const visibleNavItems = useMemo(() => {
    if (canManageAccess) return navItems;
    return navItems.filter((item) => !ADMIN_ONLY_ROUTES.has(item.id));
  }, [canManageAccess]);
  const visibleClientAccess = useMemo(() => {
    if (canManageAccess) return clientAccess;
    return clientAccess.filter((client) => client.id === activeSession.clientId);
  }, [activeSession.clientId, canManageAccess, clientAccess]);
  const organizationOptions = useMemo(() => {
    if (!canManageAccess) return [selectedOrg];

    return Array.from(
      new Set([
        OWNER_ORG_NAME,
        ...clientAccess
          .filter((client) => CORE_ORGANIZATION_CLIENT_IDS.has(client.id))
          .map((client) => client.business),
      ]),
    );
  }, [canManageAccess, clientAccess, selectedOrg]);
  const selectedWorkspaceClient = useMemo(
    () => clientAccess.find((client) => client.business === selectedOrg),
    [clientAccess, selectedOrg],
  );

  useEffect(() => {
    if (!canManageAccess && ADMIN_ONLY_ROUTES.has(route)) {
      setRoute("command");
    }
  }, [canManageAccess, route]);

  function sessionHeaders(json = false): Record<string, string> {
    const headers: Record<string, string> = json ? { "Content-Type": "application/json" } : {};

    if (sessionToken) {
      headers[AUTHORIZATION_HEADER] = `Bearer ${sessionToken}`;
    }

    return headers;
  }

  async function signIn(sessionId: string, preferredRoute: Route = "command") {
    const session = initialSessions.find((item) => item.id === sessionId) ?? initialSessions[0];
    const allowedRoute = session.canManageAccess || !ADMIN_ONLY_ROUTES.has(preferredRoute)
      ? preferredRoute
      : "command";
    setActiveSessionId(session.id);
    setSelectedOrg(
      session.clientId
        ? (clientAccess.find((client) => client.id === session.clientId)?.business ?? session.label)
        : OWNER_ORG_NAME,
    );
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
    setRoute(allowedRoute);
  }

  useEffect(() => {
    if (previewLinkApplied || signedIn) return;

    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session");
    const previewSession = initialSessions.find((session) => session.id === sessionId);

    if (!previewSession) return;

    setPreviewLinkApplied(true);
    void signIn(previewSession.id, parsePreviewRoute(params.get("view")));
  }, [previewLinkApplied, signedIn]);

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

  async function refreshGuardedWorkspace(
    clientId = activeSession.clientId ?? selectedWorkspaceClient?.id ?? DEFAULT_CLIENT_WORKSPACE_ID,
  ) {
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
        const workspaceRecord = normalizeClientAccessRecord({
          id: data.workspace.id,
          business: data.workspace.business,
          owner: "Client Owner",
          plan: "Workspace",
          paymentStatus: "paid",
          accessStatus: accessStatusFromGuardMode(data.workspace.mode),
          gateway: "Pangolin",
          privateRoute: "",
          modules,
          lastAudit: "",
        });
        setGuardedWorkspace({
          id: data.workspace.id,
          business: workspaceRecord.business,
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
        const workspaceRecord = normalizeClientAccessRecord({
          id: data.record.id,
          business: data.record.business,
          owner: "Client Owner",
          plan: "Workspace",
          paymentStatus: "paid",
          accessStatus: accessStatusFromGuardMode(data.decision.mode),
          gateway: "Pangolin",
          privateRoute: "",
          modules,
          lastAudit: "",
        });
        setGuardedWorkspace({
          id: data.record.id,
          business: workspaceRecord.business,
          mode: data.decision.mode,
          modules,
          reason: data.decision.reason,
        });
        setWorkspaceModuleView(null);
      }
    } catch {
      setGuardedWorkspace({
        id: clientId,
        business: "ChicagoShots",
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
        setPangolinPlan(data.plans.map(normalizePangolinRoutePlan));
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
      addActivity("AI setup offline", "PhantomAI system status is waiting on the backend.", "warn");
      setProviderSetupStatus(defaultProviderSetupStatus);
    }
  }

  async function refreshPhantomAiOpsStatus() {
    if (!canManageAccess) {
      setPhantomAiOpsStatus(defaultPhantomAiOpsStatus);
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/phantom-ai/ops/status`, {
        headers: sessionHeaders(),
      });

      if (!response.ok) {
        setPhantomAiOpsStatus(defaultPhantomAiOpsStatus);
        return;
      }

      const data = (await response.json()) as { status?: PhantomAiOpsStatus };
      setPhantomAiOpsStatus(data.status ?? defaultPhantomAiOpsStatus);
    } catch {
      addActivity("Phantom AI ops status offline", "Admin ops dashboard is waiting on the backend.", "warn");
      setPhantomAiOpsStatus(defaultPhantomAiOpsStatus);
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
          setClientAccess(data.records.map(normalizeClientAccessRecord));
        }
      } catch {
        addActivity("Access API offline", "Using local workspace access state until the backend is available.", "warn");
      }
    }

    void loadClientAccess();
    void refreshGuardedWorkspace();
    if (canManageAccess) {
      void refreshPangolinPlan();
      void refreshReadinessReport();
      void refreshProviderSetupStatus();
      void refreshPhantomAiOpsStatus();
    } else {
      setPangolinPlan([]);
      setReadinessReport(null);
      setProviderSetupStatus(defaultProviderSetupStatus);
      setPhantomAiOpsStatus(defaultPhantomAiOpsStatus);
    }

    return () => {
      cancelled = true;
    };
  }, [activeSessionId, sessionToken, signedIn]);

  useEffect(() => {
    if (!signedIn || !canManageAccess || !selectedWorkspaceClient) return;

    void refreshGuardedWorkspace(selectedWorkspaceClient.id);
  }, [canManageAccess, selectedOrg, signedIn, selectedWorkspaceClient?.id]);

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
    const normalizedRecord = normalizeClientAccessRecord(record);
    setClientAccess((current) => {
      const exists = current.some((item) => item.id === normalizedRecord.id);
      return exists
        ? current.map((item) => (item.id === normalizedRecord.id ? normalizedRecord : item))
        : [normalizedRecord, ...current];
    });
  }

  function createFollowUpPlan() {
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
          "I found the best next action: reply to the priority lead and reserve a call window. I prepared an email draft and a booking card for your final click. No external action has been taken.",
      },
    ]);
    addActivity("Review cards created", "Email and calendar actions are ready to confirm.", "ok");
    setRoute("command");
  }

  async function runPhantomCommand(rawText: string) {
    const text = rawText.trim();
    if (!text) return;
    setCommandText("");
    setMessages((current) => [...current, { id: makeId("msg-user"), role: "user", content: text }]);

    if (!canManageAccess) {
      setMessages((current) => [
        ...current,
        {
          id: makeId("msg-assistant"),
          role: "assistant",
          content:
            "This client workspace is in demo mode. You can see how PhantomForce prepares replies, quotes, bookings, content, and approvals, but the real operator console and infrastructure stay private.",
        },
      ]);
      addActivity("Client operator demo protected", "No operator endpoint was called for this client session.", "info");
      return;
    }

    const lower = text.toLowerCase();

    const requestsExternalAction =
      /\b(send|email|dm|text|post|upload)\b.*\b(to|them|client|lead|prospect|gmail|instagram|facebook|youtube)\b/.test(
        lower,
      ) ||
      lower.includes("send it") ||
      lower.includes("send this") ||
      lower.includes("create calendar") ||
      lower.includes("put it on my calendar") ||
      lower.includes("handle the follow-up") ||
      /\b(schedule|book)\b.*\b(call|meeting|appointment|calendar|with|client|lead|prospect)\b/.test(lower);

    if (requestsExternalAction) {
      createFollowUpPlan();
      return;
    }

    if (aiProvider === "codex" || aiProvider === "glm_5_2" || aiProvider === "claude_cli" || aiProvider === "phantom") {
      setPhantomAiBusy(true);

      try {
        const response = await fetch(`${API_BASE_URL}/phantom-ai/chat`, {
          method: "POST",
          headers: sessionHeaders(true),
          body: JSON.stringify({
            provider: canManageAccess && aiProvider === "glm_5_2" ? "openrouter_glm" : "phantom",
            admin_model: canManageAccess ? aiProvider : undefined,
            message: text,
            tenant_id: activeSession.clientId ?? "phantomforce-owner",
            business_name: selectedOrg,
            actor_user_id: activeSession.id,
            request_id: `chat-${Date.now()}`,
            task_type: "content_idea_summary",
            sensitivity_level: "low",
            business_summary:
              "Owner command center request. External actions, sends, uploads, billing, deletes, deploys, and credential changes require explicit confirmation.",
            module_data: [
              {
                module: "Command Center",
                summary: "Current local workspace state for Phantom AI response.",
                items: [
                  { title: "Needs confirmation", status: String(stats.pending), detail: "Review before external action." },
                  { title: "Follow-ups", status: String(stats.urgent), detail: "Prioritize next steps." },
                  { title: "Today tasks", status: String(stats.today), detail: "Summarize operational priorities." },
                ],
              },
            ],
          }),
        });
        const data = (await response.json().catch(() => null)) as PhantomAiChatResponse | null;
        const content =
          data?.message?.content ?? data?.error ?? "PhantomAI could not reach the selected mode.";

        setMessages((current) => [
          ...current,
          {
            id: makeId("msg-assistant"),
            role: "assistant",
            content,
          },
        ]);
        addActivity(
          "Phantom AI replied",
          canManageAccess
            ? `PhantomAI answered in ${phantomAiModeLabel(aiProvider).toLowerCase()} mode${data?.hermes?.ledger_written ? " and saved a local receipt" : ""}.`
            : "Client-safe guidance returned without exposing admin tools.",
          "ok",
        );
        return;
      } catch {
        setMessages((current) => [
          ...current,
          {
            id: makeId("msg-assistant"),
            role: "assistant",
            content:
              "Phantom AI could not reach the backend. I can still prepare local drafts, booking cards, quotes, and tasks from the dashboard.",
          },
        ]);
        addActivity("Phantom AI backend offline", "The Phantom AI backend did not answer.", "warn");
      } finally {
        setPhantomAiBusy(false);
      }
    }

    if (lower.includes("brief") || lower.includes("today")) {
      setMessages((current) => [
        ...current,
        {
          id: makeId("msg-assistant"),
          role: "assistant",
          content:
            "Today needs focus on 2 replies, 3 active tasks, and 1 calendar hold. The fastest win is confirming the client follow-up package, then clearing the backend cleanup reply.",
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
            "I can help with that. I can brief the day, prioritize leads, prepare replies, build quotes, organize tasks, and stage booking actions for your final click.",
      },
    ]);
  }

  async function submitCommand(event: FormEvent) {
    event.preventDefault();
    await runPhantomCommand(commandText);
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

    addActivity("Confirmed action completed", approval.title, "ok");
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
      ? "revenue proof payment received from NexProspex close"
      : "revenue proof signed agreement before payment clears";
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
      addActivity("Revenue proof blocked", "This session cannot propose client provisioning.", "warn");
      return;
    }

    const proposalData = (await proposalResponse.json()) as { approval?: { id: string } };
    if (!proposalData.approval?.id) {
      addActivity("Revenue proof blocked", "Provisioning did not return an approval card.", "warn");
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
      addActivity("Revenue proof approval blocked", "This session cannot approve provisioning.", "warn");
      return;
    }

    const data = (await approvalResponse.json()) as { record?: ClientAccess };
    if (data.record) {
      upsertClientAccessRecord(data.record);
      addActivity(
        paid ? "Revenue proof active" : "Revenue proof blocked",
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
            {organizationOptions.map((organization) => (
              <option key={organization}>{organization}</option>
            ))}
          </select>
        </div>

        <nav className="side-nav" aria-label="Main navigation">
          {visibleNavItems.map((item) => (
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
            <p>Workspace controls</p>
          </div>
          <strong>Client side stays clean.</strong>
          <small>Clients see actions, proposals, next steps, and deliverables. Developer tools stay hidden.</small>
        </div>
        <div className="engine-card truth-rail-card">
          <div>
            <span className="status-dot locked" />
            <p>Workspace status</p>
          </div>
          <strong>Action cockpit online.</strong>
          <small>Phantom AI, ChicagoShots proposals, and next-step planning are active locally.</small>
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
            aiProvider={aiProvider}
            setAiProvider={setAiProvider}
            phantomAiBusy={phantomAiBusy}
            canManageAccess={canManageAccess}
            phantomAiOpsStatus={phantomAiOpsStatus}
            sessionHeaders={sessionHeaders}
            createFollowUpPlan={createFollowUpPlan}
            runPhantomCommand={runPhantomCommand}
            stats={stats}
            approvals={approvals}
            approveAction={approveAction}
            rejectAction={rejectAction}
            emails={emails}
            events={events}
            setRoute={setRoute}
          />
        ) : null}
        {route === "agents" && canManageAccess ? (
          <AgentControlCenter
            aiProvider={aiProvider}
            setAiProvider={setAiProvider}
            phantomAiBusy={phantomAiBusy}
            runPhantomCommand={runPhantomCommand}
            setRoute={setRoute}
            pangolinPlan={pangolinPlan}
            pangolinStatus={pangolinStatus}
          />
        ) : null}
        {route === "inbox" ? <InboxView emails={emails} createFollowUpPlan={createFollowUpPlan} /> : null}
        {route === "calendar" ? <CalendarView events={events} /> : null}
        {route === "tasks" ? <TasksView tasks={tasks} completeTask={completeTask} /> : null}
        {route === "content" ? <ContentView /> : null}
        {route === "media" ? <MediaLabView /> : null}
        {route === "site" && canManageAccess ? (
          <SiteStudioView pangolinPlan={pangolinPlan} pangolinStatus={pangolinStatus} />
        ) : null}
        {route === "offers" ? <OffersView /> : null}
        {route === "approvals" ? (
          <ApprovalsView approvals={approvals} approveAction={approveAction} rejectAction={rejectAction} />
        ) : null}
        {route === "access" && canManageAccess ? (
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
        {route === "connections" && canManageAccess ? (
          <StatusView
            canManageAccess={canManageAccess}
            providerSetupStatus={providerSetupStatus}
            sessionHeaders={sessionHeaders}
            pangolinPlan={pangolinPlan}
            pangolinStatus={pangolinStatus}
          />
        ) : null}
      </main>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        {visibleNavItems.map((item) => (
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
            <span>AI business command center</span>
          </div>
        </div>
        <h1>Ask once. Get the finished work.</h1>
        <p>
          Ask PhantomAI for the finished thing - replies, quotes, bookings, docs, and video - then confirm what leaves. One login, one mobile-ready business brain.
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
            External actions stay behind final-click controls inside the business dashboard.
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
  aiProvider,
  setAiProvider,
  phantomAiBusy,
  canManageAccess,
  phantomAiOpsStatus,
  sessionHeaders,
  createFollowUpPlan,
  runPhantomCommand,
  stats,
  approvals,
  approveAction,
  rejectAction,
  emails,
  events,
  setRoute,
}: {
  messages: Message[];
  commandText: string;
  setCommandText: (value: string) => void;
  submitCommand: (event: FormEvent) => void;
  aiProvider: AiProviderChoice;
  setAiProvider: (value: AiProviderChoice) => void;
  phantomAiBusy: boolean;
  canManageAccess: boolean;
  phantomAiOpsStatus: PhantomAiOpsStatus;
  sessionHeaders: (json?: boolean) => Record<string, string>;
  createFollowUpPlan: () => void;
  runPhantomCommand: (text: string) => Promise<void>;
  stats: { urgent: number; pending: number; today: number; events: number };
  approvals: Approval[];
  approveAction: (id: string) => void;
  rejectAction: (id: string) => void;
  emails: EmailItem[];
  events: CalendarEvent[];
  setRoute: (route: Route) => void;
}) {
  const pendingApprovals = approvals.filter((approval) => approval.status === "pending");
  const aiProviderLabel = phantomAiModeLabel(aiProvider);

  if (!canManageAccess) {
    return <ClientOperatorDemoDashboard />;
  }

  const nextActions = [
    {
      title: "Write the reply",
      detail: "PhantomAI drafts the message and next click.",
      meta: `${stats.urgent} waiting`,
      icon: <Mail size={20} />,
      tone: "danger",
      action: createFollowUpPlan,
      cta: "Ask now",
    },
    {
      title: "Book the call",
      detail: "Get times, agenda, and follow-up copy.",
      meta: `${stats.events} calendar items`,
      icon: <CalendarDays size={20} />,
      tone: "blue",
      action: () =>
        void runPhantomCommand(
          "Draft a 15-minute setup call plan for the next interested lead. Include two time windows, what to ask, and what to send after.",
        ),
      cta: "Ask now",
    },
    {
      title: "Price the sprint",
      detail: "Choose the package and write the pitch.",
      meta: "$750 / $1,500 / $2,500",
      icon: <Zap size={20} />,
      tone: "gold",
      action: () =>
        void runPhantomCommand(
          "Turn the current lead into a quote recommendation. Choose $750 Starter, $1,500 Core, or $2,500 Pro and explain the next step.",
        ),
      cta: "Ask now",
    },
    {
      title: "Make an asset",
      detail: "Turn the idea into a post, deck, doc, or video plan.",
      meta: "Content + video",
      icon: <FileText size={20} />,
      tone: "green",
      action: () =>
        void runPhantomCommand(
          "Create the best client-ready artifact for the current opportunity: choose a doc, one-page proposal, content plan, or video concept and build the first draft.",
        ),
      cta: "Ask now",
    },
    {
      title: "Customize my site",
      detail: "Propose copy, sections, or design for your private site.",
      meta: "Preview + approve",
      icon: <Sparkles size={20} />,
      tone: "violet",
      action: () =>
        void runPhantomCommand(
          "Propose updates to my PhantomForce website: suggest copy, sections, or design changes as a preview I can review and approve before anything goes live. Keep everything private to my business.",
        ),
      cta: "Ask now",
    },
  ];
  const workflowSteps = [
    { label: "Ask", value: "1", icon: <Sparkles size={18} /> },
    { label: "Build", value: "artifact", icon: <FileText size={18} /> },
    { label: "Preview", value: "card", icon: <SquareCheckBig size={18} /> },
    { label: "Confirm", value: stats.pending, icon: <ShieldCheck size={18} /> },
    { label: "Send", value: "manual", icon: <Send size={18} /> },
  ];
  return (
    <div className="command-layout">
      <section className="command-main">
        <div className="hero-command">
          <div>
            <span className="eyebrow">PhantomAI · your superuser</span>
            <h2>Command anything. It's done.</h2>
            <p>
              One private AI that runs your business — drafts, deals, docs, video, even your website. Smarter than a generic chatbot because it's wired into your operation, and nothing leaves without you.
            </p>
          </div>
          <button className="demo-button" type="button" onClick={createFollowUpPlan}>
            <Sparkles size={18} />
            Command PhantomAI
          </button>
          <button className="ghost-small" type="button" onClick={() => setRoute("agents")}>
            <Bot size={16} />
            Agent Control
          </button>
        </div>

        <section className="outcome-rail" aria-label="PhantomAI output types">
          <article>
            <Mail size={18} />
            <strong>Reply</strong>
            <span>ready-to-send draft</span>
          </article>
          <article>
            <FileText size={18} />
            <strong>Doc</strong>
            <span>proposal or brief</span>
          </article>
          <article>
            <CalendarDays size={18} />
            <strong>Booking</strong>
            <span>call plan + times</span>
          </article>
          <article>
            <BarChart3 size={18} />
            <strong>Sheet</strong>
            <span>pipeline or quote table</span>
          </article>
          <article>
            <Play size={18} />
            <strong>Video</strong>
            <span>creative prompt + proof</span>
          </article>
        </section>

        <section className="action-board" aria-label="Next actions">
          <div className="section-head compact">
            <div>
              <span className="eyebrow">Do this next</span>
              <h3>Ask once. Get the artifact.</h3>
            </div>
            <span>{stats.today} work items</span>
          </div>
          <div className="action-card-grid">
            {nextActions.map((action) => (
              <button className={`action-tile ${action.tone}`} type="button" onClick={action.action} key={action.title}>
                <span className="action-icon">{action.icon}</span>
                <strong>{action.title}</strong>
                <small>{action.detail}</small>
                <em>{action.meta}</em>
                <b>
                  {action.cta}
                  <ArrowRight size={15} />
                </b>
              </button>
            ))}
          </div>
        </section>

        <section className="workflow-board" aria-label="Workflow">
          {workflowSteps.map((step, index) => (
            <article className="workflow-step" key={step.label}>
              <span>{step.icon}</span>
              <strong>{step.label}</strong>
              <em>{step.value}</em>
              {index < workflowSteps.length - 1 ? <ArrowRight size={16} /> : null}
            </article>
          ))}
        </section>

        <section className="proof-strip" aria-label="Action proof">
          <article>
            <Sparkles size={18} />
            <strong>Phantom AI</strong>
            <span>Builds the outcome</span>
          </article>
          <article>
            <ShieldCheck size={18} />
            <strong>Send control</strong>
            <span>You choose what leaves</span>
          </article>
          <article>
            <Play size={18} />
            <strong>Creative engine</strong>
            <span>Video lives here</span>
          </article>
        </section>

        <section className="chat-card">
          <div className="section-head">
            <div>
              <span className="eyebrow">Phantom AI</span>
              <h3>Command thread</h3>
            </div>
            {canManageAccess ? (
              <span className="safe-pill admin-operator-pill">
                <Command size={15} />
                Mode: {aiProviderLabel}
              </span>
            ) : (
              <span className="safe-pill">
                <ShieldCheck size={15} />
                Client protected
              </span>
            )}
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
            {canManageAccess ? (
              <label aria-label="PhantomAI mode" className="llm-select lane-readout model-select">
                <Bot size={15} />
                <select
                  value={aiProvider}
                  onChange={(event) => setAiProvider(event.target.value as AiProviderChoice)}
                  disabled={phantomAiBusy}
                >
                  <option value="codex">Auto</option>
                  <option value="glm_5_2">Deeper thinking</option>
                  <option value="claude_cli">Second opinion</option>
                </select>
              </label>
            ) : (
              <div aria-label="Phantom AI lane" className="llm-select lane-readout">
                <Bot size={15} />
                <span>Phantom AI</span>
              </div>
            )}
            <input
              value={commandText}
              onChange={(event) => setCommandText(event.target.value)}
              placeholder="Ask for the finished thing: reply, quote, booking plan, doc, deck, content, or video..."
              disabled={phantomAiBusy}
            />
            <button type="submit" title="Send command" disabled={phantomAiBusy}>
              {phantomAiBusy ? <RefreshCcw size={18} /> : <Send size={18} />}
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

        <section className="panel next-move-panel">
          <div className="section-head compact">
            <div>
              <span className="eyebrow">Launch controls</span>
              <h3>Jump to the result area.</h3>
            </div>
          </div>
          <div className="launch-control-grid">
            <button type="button" onClick={() => setRoute("inbox")}>
              <Inbox size={17} />
              Leads
            </button>
            <button type="button" onClick={() => setRoute("offers")}>
              <Zap size={17} />
              Money
            </button>
            <button type="button" onClick={() => setRoute("media")}>
              <Play size={17} />
              Video
            </button>
            <button type="button" onClick={() => setRoute("agents")}>
              <Bot size={17} />
              Agents
            </button>
            <button type="button" onClick={() => setRoute("calendar")}>
              <CalendarDays size={17} />
              Bookings
            </button>
            {canManageAccess ? (
              <button type="button" onClick={() => setRoute("access")}>
                <KeyRound size={17} />
                Access
              </button>
            ) : null}
          </div>
        </section>

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
            <EmptyState icon={<ShieldCheck size={20} />} title="No pending commands" detail="Ask Phantom AI for a follow-up, quote, booking step, or content action." />
          )}
        </section>

        <section className="panel">
          <div className="section-head compact">
            <h3>Live context</h3>
            <span>Action source</span>
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

const clientOperatorDemoFlow = [
  {
    title: "Lead intake",
    detail: "A new lead or business request lands in one clear workspace.",
    icon: <Inbox size={18} />,
  },
  {
    title: "Recommended package",
    detail: "PhantomForce suggests the best service path without exposing engine internals.",
    icon: <Zap size={18} />,
  },
  {
    title: "Quote/proposal draft",
    detail: "The operator prepares a client-ready draft for human review.",
    icon: <FileText size={18} />,
  },
  {
    title: "Approval gate",
    detail: "Nothing sends, posts, books, or bills until the business owner approves.",
    icon: <ShieldCheck size={18} />,
  },
];

const clientDemoOutcomes = [
  "Reply drafts",
  "Quote summaries",
  "Booking plans",
  "Task checklists",
  "Content ideas",
  "Proposal packets",
];

const privateInfrastructureList = [
  "Internal operator console",
  "Private keys and model routing",
  "Workflow worker layer",
  "Security scan controls",
  "Local files and logs",
  "Admin debug/status panels",
];

function ClientOperatorDemoDashboard() {
  return (
    <div className="client-operator-demo" data-testid="client-operator-demo">
      <section className="client-demo-hero">
        <div>
          <span className="eyebrow">Operator demo</span>
          <h2>See the system. Do not touch the engine.</h2>
          <p>
            This is the customer-safe PhantomForce preview: the business outcome is visible, but Jordan's private
            infrastructure, local tools, agent stack, and security controls stay behind the wall.
          </p>
        </div>
        <div className="client-demo-lock">
          <Lock size={20} />
          <strong>Demo mode</strong>
          <span>No commands, no sends, no infrastructure access</span>
        </div>
      </section>

      <section className="client-demo-status-strip" aria-label="Client demo safety status">
        <span>Preview only</span>
        <span>No operator endpoint</span>
        <span>No backend model call</span>
        <span>No background execution</span>
        <span>No private logs</span>
      </section>

      <section className="client-demo-flow" aria-label="Demo operator flow">
        {clientOperatorDemoFlow.map((step, index) => (
          <article className="client-demo-flow-card" key={step.title}>
            <span>{step.icon}</span>
            <small>Step {index + 1}</small>
            <strong>{step.title}</strong>
            <p>{step.detail}</p>
          </article>
        ))}
      </section>

      <section className="client-demo-grid">
        <article className="client-demo-card">
          <span className="eyebrow">What customers see</span>
          <h3>Business-ready output lanes</h3>
          <div className="client-demo-chip-grid">
            {clientDemoOutcomes.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        </article>

        <article className="client-demo-card private">
          <span className="eyebrow">What stays private</span>
          <h3>Infrastructure is not the product UI</h3>
          <ul>
            {privateInfrastructureList.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
      </section>

      <section className="client-demo-window" aria-label="Locked operator preview">
        <div className="client-demo-window-head">
          <span />
          <span />
          <span />
          <strong>PhantomForce client workspace preview</strong>
        </div>
        <div className="client-demo-output-grid">
          <article>
            <Mail size={17} />
            <strong>Follow-up draft</strong>
            <p>Prepared for review. Owner approves before anything leaves.</p>
          </article>
          <article>
            <CalendarDays size={17} />
            <strong>Booking plan</strong>
            <p>Agenda and windows staged. No calendar mutation from demo.</p>
          </article>
          <article>
            <BarChart3 size={17} />
            <strong>Quote lane</strong>
            <p>Package guidance appears here without payment or invoice actions.</p>
          </article>
          <article>
            <Play size={17} />
            <strong>Media workflow</strong>
            <p>Creative direction can be previewed; generation tools stay private.</p>
          </article>
        </div>
        <button className="primary-action locked-demo-button" type="button" disabled>
          <Lock size={17} />
          Operator actions locked in demo
        </button>
      </section>
    </div>
  );
}

function InboxView({ emails, createFollowUpPlan }: { emails: EmailItem[]; createFollowUpPlan: () => void }) {
  const [mode, setMode] = useState<ResultMode>("recommended");
  const followUpItems: SimulationItem[] = emails.map((email) => ({
    title: email.subject,
    detail: `${email.from} - ${email.preview}`,
    status: email.status,
  }));
  const allItems = [...businessOpsSimulation.leads, ...businessOpsSimulation.clients, ...followUpItems];
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
    <Page
      title="Work queue"
      kicker="PhantomAI outcomes"
      action={
        <span className="safe-pill">
          <Sparkles size={15} />
          Ask creates work
        </span>
      }
    >
      <section className="module-panel simulation-section">
        <div className="section-head">
          <div>
            <span className="eyebrow">Generated work</span>
            <h3>{mode === "recommended" ? "Today and high-leverage outcomes" : "All work results"}</h3>
          </div>
          <ResultModeToggle mode={mode} setMode={setMode} />
        </div>
        <p>Do not create work here manually. Ask PhantomAI on Home; this tab is where the resulting tasks, drafts, and follow-ups are tracked.</p>
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
      ? businessOpsSimulation.approvals.filter((approval) => approval.status === "pending")
      : businessOpsSimulation.approvals;

  return (
    <Page title="Review queue" kicker="Pending commands">
      <section className="module-panel simulation-section">
        <div className="section-head">
          <div>
            <span className="eyebrow">AI filtered vs all results</span>
            <h3>{mode === "recommended" ? "Needs your final click" : "All review records"}</h3>
          </div>
          <ResultModeToggle mode={mode} setMode={setMode} />
        </div>
        <p>Bookings, sends, uploads, billing, credentials, and production changes sit here until you confirm them.</p>
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
            <h3>Command review</h3>
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
    ...businessOpsSimulation.contentIdeas.filter((item) => ["recommended", "review"].includes(item.status ?? "")),
    ...businessOpsSimulation.contentCalendar.filter((item) => item.status === "review"),
  ];
  const allContent = [...businessOpsSimulation.contentCalendar, ...businessOpsSimulation.contentIdeas];
  const visibleContent = mode === "recommended" ? recommendedContent : allContent;
  const platformPlaceholders: SimulationItem[] = [
    { title: "Instagram", detail: "Draft planning only. Posting needs a final click.", status: "final check" },
    { title: "Email newsletter", detail: "Ideas can be prepared; sends need confirmation.", status: "final check" },
    { title: "Short-form video", detail: "Publish and upload actions stay off until connected.", status: "not connected" },
  ];

  return (
    <Page title="Create" kicker="Posts, briefs, and assets" action={<TruthBadge state="real" label="Draft-first" />}>
      <section className="module-panel simulation-section">
        <div className="section-head">
          <div>
            <span className="eyebrow">AI filtered vs all results</span>
            <h3>{mode === "recommended" ? "PhantomAI recommended outputs" : "All content ideas and calendar items"}</h3>
          </div>
          <ResultModeToggle mode={mode} setMode={setMode} />
        </div>
        <SimulationList items={visibleContent} />
      </section>

      <div className="destination-grid">
        <SimulationSection icon={<CalendarDays size={18} />} title="Content calendar" items={businessOpsSimulation.contentCalendar} />
        <SimulationSection icon={<FileText size={18} />} title="Output ideas" items={businessOpsSimulation.contentIdeas} />
        <SimulationSection icon={<ShieldCheck size={18} />} title="Drafts ready to review" items={businessOpsSimulation.contentDrafts} />
        <SimulationSection icon={<AlertTriangle size={18} />} title="Platform send status" items={platformPlaceholders} />
      </div>
    </Page>
  );
}

function MediaLabView() {
  return (
    <Page title="Video Studio" kicker="Creative output" action={<TruthBadge state="real" label="Proof-backed" />}>
      <section className="simulation-hero">
        <div>
          <span className="eyebrow">Creative engine</span>
          <h3>Ask for the video plan. PhantomAI prepares the cut path.</h3>
          <p>
            Track requests, drafts, consent, proof clips, and delivery status without exposing generation tools or raw
            upload controls.
          </p>
        </div>
        <div className="simulation-hero-status">
          <StatusLine label="Uploads" value="Final click" />
          <StatusLine label="Delivery" value="Confirm first" />
          <StatusLine label="Core app" value="Leads, bookings, money, work, review" />
        </div>
      </section>

      <div className="destination-grid">
        <SimulationSection icon={<Play size={18} />} title="Media requests" items={businessOpsSimulation.mediaRequests} />
        <SimulationSection icon={<SquareCheckBig size={18} />} title="Deliverables and workflow status" items={businessOpsSimulation.mediaDeliverables} />
        <SimulationSection icon={<AlertTriangle size={18} />} title="Uploads and delivery status" items={businessOpsSimulation.mediaPlaceholders} />
        <VideoEngineAddonCard />
      </div>
    </Page>
  );
}

function OffersView() {
  const [mode, setMode] = useState<ResultMode>("recommended");
  const allOfferItems = [
    ...businessOpsSimulation.services,
    ...businessOpsSimulation.offerRecommendations,
    ...businessOpsSimulation.pricingDrafts,
  ];
  const recommendedOfferItems = businessOpsSimulation.offerRecommendations.filter((item) =>
    ["recommended", "option"].includes(item.status ?? ""),
  );
  const visibleOfferItems = mode === "recommended" ? recommendedOfferItems : allOfferItems;
  const approvalItems = businessOpsSimulation.approvals.filter((item) =>
    item.title.toLowerCase().includes("offer") || item.title.toLowerCase().includes("payment"),
  );

  return (
    <Page title="Offers" kicker="Packages and pricing" action={<TruthBadge state="real" label="Offer ladder" />}>
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
        <SimulationSection icon={<Sparkles size={18} />} title="Setup sprint packages" items={businessOpsSimulation.services} />
        <SimulationSection icon={<Zap size={18} />} title="Offer builder recommendations" items={businessOpsSimulation.offerRecommendations} />
        <SimulationSection icon={<FileText size={18} />} title="Pricing and package drafts" items={businessOpsSimulation.pricingDrafts} />
        <SimulationSection icon={<ShieldCheck size={18} />} title="Review status" items={approvalItems} />
      </div>
    </Page>
  );
}

function AgentControlCenter({
  aiProvider,
  setAiProvider,
  phantomAiBusy,
  runPhantomCommand,
  setRoute,
  pangolinPlan,
  pangolinStatus,
}: {
  aiProvider: AiProviderChoice;
  setAiProvider: (value: AiProviderChoice) => void;
  phantomAiBusy: boolean;
  runPhantomCommand: (text: string) => Promise<void>;
  setRoute: (route: Route) => void;
  pangolinPlan: PangolinRoutePlan[];
  pangolinStatus: PangolinReadOnlyStatus | null;
}) {
  const [agentCommand, setAgentCommand] = useState(
    "Audit the dashboard like my admin operating system. Tell me what is broken, what to fix first, and what you can directly prepare.",
  );
  const activeLane = phantomAiModeLabel(aiProvider);
  const enabledRoutes = pangolinPlan.filter((plan) => plan.desiredState === "enabled").length;
  const disabledRoutes = pangolinPlan.filter((plan) => plan.desiredState === "disabled").length;
  const controlActions = [
    {
      title: "Audit this app",
      detail: "Find broken UX, stale labels, blocked workflows, and launch blockers.",
      icon: <Search size={18} />,
      prompt:
        "Audit the current PhantomForce dashboard as an admin operating system. Identify broken UX, stale labels, blocked workflows, and the next fixes. Do not send, deploy, or mutate external systems.",
    },
    {
      title: "Change the website",
      detail: "Draft website copy or layout changes and send them to Site Studio preview.",
      icon: <FileText size={18} />,
      prompt:
        "Prepare a Site Studio update for PhantomForce: rewrite the public site hero, offer section, and CTA. Keep it as a private draft/preview only.",
    },
    {
      title: "Check Pangolin",
      detail: "Explain which private routes are enabled, disabled, and unverified.",
      icon: <KeyRound size={18} />,
      prompt:
        "Explain the current Pangolin route plan in plain English. List enabled, disabled, and unverified routes, then tell me what must be configured before live route control.",
    },
    {
      title: "Prepare a quote",
      detail: "Pick Starter/Core/Pro and generate the client-ready pitch.",
      icon: <Zap size={18} />,
      prompt:
        "Use the current PhantomForce offer ladder to prepare a client-ready quote. Choose $750 Starter, $1,500 Core, or $2,500 Pro and write the next-step message.",
    },
    {
      title: "Make a media plan",
      detail: "Turn a client into a ChicagoShots + Media Lab content path.",
      icon: <Play size={18} />,
      prompt:
        "Create a ChicagoShots and PhantomForce Media Lab content plan for a sports/team/client lead. Include deliverables, timeline, price path, and what proof to show.",
    },
    {
      title: "Brief Claude",
      detail: "Write a strict report-only Claude review prompt.",
      icon: <MessageSquare size={18} />,
      prompt:
        "Draft a report-only Claude review prompt for this dashboard. Ask Claude to judge UI, usability, functionality, truthfulness, and whether it is ready to proceed. Claude must not edit files.",
    },
  ];

  function submitAgentCommand(event: FormEvent) {
    event.preventDefault();
    void runPhantomCommand(agentCommand);
  }

  return (
    <Page
      title="Agent Control Center"
      kicker="Admin operating system"
      action={<TruthBadge state="real" label="Admin only" />}
    >
      <section className="simulation-hero">
        <div>
          <span className="eyebrow">Operator app</span>
          <h3>Control the agents from here.</h3>
          <p>
            This is the private console for directing PhantomAI, Codex-style local work, GLM reasoning, Claude review,
            Hermes memory, Site Studio, and Pangolin route planning from one place.
          </p>
        </div>
        <div className="simulation-hero-status">
          <StatusLine label="Active lane" value={activeLane} />
          <StatusLine label="Client access" value="Hidden" />
          <StatusLine label="External mutation" value="Off" />
        </div>
      </section>

      <section className="module-panel simulation-section">
        <div className="section-head">
          <div>
            <span className="eyebrow">Agent lane</span>
            <h3>Choose how PhantomAI thinks</h3>
          </div>
          <TruthBadge state="real" label={activeLane} />
        </div>
        <div className="action-card-grid">
          {[
            { value: "codex" as AiProviderChoice, label: "Auto / operator", detail: "Best default for local app work." },
            { value: "glm_5_2" as AiProviderChoice, label: "Deep thinking", detail: "Use for strategy, copy, and reasoning." },
            { value: "claude_cli" as AiProviderChoice, label: "Second opinion", detail: "Use for review when Claude CLI is available." },
          ].map((lane) => (
            <button
              className={`action-tile ${aiProvider === lane.value ? "green" : "blue"}`}
              key={lane.value}
              type="button"
              onClick={() => setAiProvider(lane.value)}
              disabled={phantomAiBusy}
            >
              <span className="action-icon">
                <Bot size={18} />
              </span>
              <strong>{lane.label}</strong>
              <small>{lane.detail}</small>
              <em>{aiProvider === lane.value ? "Selected" : "Click to switch"}</em>
            </button>
          ))}
        </div>
      </section>

      <section className="module-panel simulation-section">
        <div className="section-head">
          <div>
            <span className="eyebrow">Command pad</span>
            <h3>Tell the agents what to do</h3>
          </div>
          <TruthBadge state="real" label="Runs through PhantomAI" />
        </div>
        <form className="lead-intake-form" onSubmit={submitAgentCommand}>
          <label className="lead-notes-field">
            Admin command
            <textarea value={agentCommand} onChange={(event) => setAgentCommand(event.target.value)} />
          </label>
          <div className="lead-intake-actions">
            <button className="primary-action" type="submit" disabled={phantomAiBusy || !agentCommand.trim()}>
              {phantomAiBusy ? <RefreshCcw size={16} /> : <Command size={16} />}
              Run through PhantomAI
            </button>
            <button className="ghost-small" type="button" onClick={() => setRoute("site")}>
              <FileText size={15} />
              Open Site Studio
            </button>
            <button className="ghost-small" type="button" onClick={() => setRoute("connections")}>
              <Link2 size={15} />
              System
            </button>
          </div>
        </form>
      </section>

      <section className="action-board" aria-label="Agent actions">
        <div className="section-head compact">
          <div>
            <span className="eyebrow">Direct controls</span>
            <h3>Click an outcome, not a tool.</h3>
          </div>
          <span>{controlActions.length} actions</span>
        </div>
        <div className="action-card-grid">
          {controlActions.map((action) => (
            <button
              className="action-tile violet"
              type="button"
              key={action.title}
              onClick={() => void runPhantomCommand(action.prompt)}
              disabled={phantomAiBusy}
            >
              <span className="action-icon">{action.icon}</span>
              <strong>{action.title}</strong>
              <small>{action.detail}</small>
              <b>
                Run
                <ArrowRight size={15} />
              </b>
            </button>
          ))}
        </div>
      </section>

      <div className="destination-grid">
        <article className="operator-result-card">
          <span className="eyebrow">Hermes memory</span>
          <h4>Receipts and context stay in the backend.</h4>
          <p>
            PhantomAI can use workspace context and interaction receipts without exposing raw keys, logs, or provider
            plumbing to clients.
          </p>
          <StatusLine label="Memory lane" value="Backend" />
          <StatusLine label="Client visibility" value="None" />
        </article>
        <article className="operator-result-card">
          <span className="eyebrow">Local control</span>
          <h4>Admin can direct local work. Clients cannot.</h4>
          <p>
            File, repo, dashboard, and operator tasks belong here. Customer workspaces receive finished artifacts,
            drafts, and approvals only.
          </p>
          <StatusLine label="Admin tools" value="Available" />
          <StatusLine label="Client tools" value="Blocked" />
        </article>
        <article className="operator-result-card">
          <span className="eyebrow">Pangolin route map</span>
          <h4>
            {enabledRoutes} enabled, {disabledRoutes} disabled.
          </h4>
          <p>
            Pangolin is the private doorway layer. PhantomForce decides what each workspace can do after a user enters.
          </p>
          <StatusLine label="Live instance" value={pangolinStatus?.status ?? "unconfigured"} />
          <StatusLine label="Live changes" value="Off" />
        </article>
      </div>
    </Page>
  );
}

function SiteStudioView({
  pangolinPlan,
  pangolinStatus,
}: {
  pangolinPlan: PangolinRoutePlan[];
  pangolinStatus: PangolinReadOnlyStatus | null;
}) {
  const [siteDraft, setSiteDraft] = useState({
    hero: "PhantomForce builds the system behind your business.",
    subhead:
      "Ask PhantomAI for replies, quotes, bookings, docs, content, and video plans from one owner cockpit.",
    offer: "Start with an Ops + Content Setup Sprint: $750 Starter, $1,500 Core, or $2,500 Pro.",
    cta: "Book a 15-minute setup call",
  });
  const [previewOpen, setPreviewOpen] = useState(true);

  function updateDraft(key: keyof typeof siteDraft, value: string) {
    setSiteDraft((current) => ({ ...current, [key]: value }));
  }

  return (
    <Page title="Site Studio" kicker="Admin operating system" action={<TruthBadge state="stub" label="Draft / preview" />}>
      <section className="simulation-hero">
        <div>
          <span className="eyebrow">Website Control</span>
          <h3>Edit the public story from inside PhantomForce.</h3>
          <p>
            This is the safe admin surface for site copy, offer positioning, and launch preview. Publishing stays gated
            until a real deploy path is explicitly connected.
          </p>
        </div>
        <div className="simulation-hero-status">
          <StatusLine label="Draft edits" value="Local only" />
          <StatusLine label="Preview" value={previewOpen ? "Visible" : "Hidden"} />
          <StatusLine label="Publish" value="Gated / off" />
        </div>
      </section>

      <section className="module-panel simulation-section">
        <div className="section-head">
          <div>
            <span className="eyebrow">Ask-to-site control</span>
            <h3>Website copy draft</h3>
          </div>
          <TruthBadge state="stub" label="No live publish" />
        </div>
        <div className="lead-intake-form">
          <label>
            Hero headline
            <input value={siteDraft.hero} onChange={(event) => updateDraft("hero", event.target.value)} />
          </label>
          <label className="lead-notes-field">
            Supporting copy
            <textarea value={siteDraft.subhead} onChange={(event) => updateDraft("subhead", event.target.value)} />
          </label>
          <label className="lead-notes-field">
            Offer line
            <textarea value={siteDraft.offer} onChange={(event) => updateDraft("offer", event.target.value)} />
          </label>
          <label>
            CTA
            <input value={siteDraft.cta} onChange={(event) => updateDraft("cta", event.target.value)} />
          </label>
          <div className="lead-intake-actions">
            <button className="primary-action" type="button" onClick={() => setPreviewOpen(true)}>
              <Sparkles size={16} />
              Preview changes
            </button>
            <button className="ghost-small" type="button" onClick={() => setPreviewOpen(false)}>
              Hide preview
            </button>
            <button className="ghost-small" type="button" disabled title="Publishing requires a separate approved deploy gate.">
              <Lock size={15} />
              Publish gated
            </button>
          </div>
        </div>
      </section>

      <div className="destination-grid">
        {previewOpen ? (
          <article className="operator-result-card">
            <span className="eyebrow">Public site preview</span>
            <h4>{siteDraft.hero}</h4>
            <p>{siteDraft.subhead}</p>
            <p className="draft-copy">{siteDraft.offer}</p>
            <button className="primary-small" type="button" disabled>
              {siteDraft.cta}
            </button>
          </article>
        ) : null}
        <PangolinSummaryPanel pangolinPlan={pangolinPlan} pangolinStatus={pangolinStatus} />
        <article className="operator-result-card">
          <span className="eyebrow">Admin OS rule</span>
          <h4>Draft here. Confirm before anything leaves.</h4>
          <ul>
            <li>No public publish from this pass.</li>
            <li>No DNS, Pangolin, deploy, billing, or email mutation.</li>
            <li>Future publish should create a review card with diff, target, and rollback.</li>
          </ul>
        </article>
      </div>
    </Page>
  );
}

function PangolinSummaryPanel({
  pangolinPlan,
  pangolinStatus,
}: {
  pangolinPlan: PangolinRoutePlan[];
  pangolinStatus: PangolinReadOnlyStatus | null;
}) {
  const enabledRoutes = pangolinPlan.filter((plan) => plan.desiredState === "enabled").length;
  const readOnlyRoutes = pangolinPlan.filter((plan) => plan.desiredState === "read_only").length;
  const disabledRoutes = pangolinPlan.filter((plan) => plan.desiredState === "disabled").length;

  return (
    <article className="operator-result-card">
      <span className="eyebrow">Private Route Control · Pangolin</span>
      <h4>Payment controls the doorway. PhantomForce controls the workspace.</h4>
      <p>
        Payment/access state controls private-route reachability. PhantomForce controls which modules and actions users
        get after they enter.
      </p>
      <StatusLine label="Live instance" value={pangolinStatus?.status ?? "unconfigured"} />
      <StatusLine label="Enabled routes" value={String(enabledRoutes)} />
      <StatusLine label="Read-only routes" value={String(readOnlyRoutes)} />
      <StatusLine label="Disabled routes" value={String(disabledRoutes)} />
      <StatusLine label="Live changes" value="Off" />
      <p className="route-note">
        {pangolinStatus?.configured
          ? pangolinStatus.reason
          : "Set PANGOLIN_READONLY_BASE_URL for read-only live instance verification."}
      </p>
    </article>
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
      detail: "Route stays reachable while PhantomForce handlers enforce restricted access.",
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
            <span>Confirmation and audit required</span>
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
          <h3>{guardedWorkspace?.business ?? "ChicagoShots"}</h3>
          <p>This panel checks whether the selected workspace can load its private modules.</p>
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
              onClick={() => refreshWorkspaceModule(guardedWorkspace?.id ?? "client-chicagoshots", module)}
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
  pangolinPlan,
  pangolinStatus,
}: {
  canManageAccess: boolean;
  providerSetupStatus: ProviderSetupStatus;
  sessionHeaders: (json?: boolean) => Record<string, string>;
  pangolinPlan: PangolinRoutePlan[];
  pangolinStatus: PangolinReadOnlyStatus | null;
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
      {canManageAccess ? <PangolinSummaryPanel pangolinPlan={pangolinPlan} pangolinStatus={pangolinStatus} /> : null}
      {canManageAccess ? <HermesRouterDebugPanel sessionHeaders={sessionHeaders} /> : null}
      <section className="module-panel simulation-section">
        <div className="section-head">
          <div>
            <span className="eyebrow">Customer-safe status</span>
            <h3>Launch blockers stay visible without exposing the tool stack.</h3>
          </div>
        </div>
        <div className="simulation-list">
          {businessOpsSimulation.launchBlockers.map((item) => (
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
        <TruthBadge state="real" label="Action ready" />
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
  const glmReady = status.openrouter_glm.live_call_ready ? "Ready" : "Blocked";

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
          label="GLM 5.2 live lane"
          value={glmReady}
          detail={`Transport flag: ${status.openrouter_glm.live_transport_enabled ? "on" : "off"}. Admin chat can use GLM only when key, live providers, and transport are all enabled.`}
          state={status.openrouter_glm.live_call_ready ? "real" : "blocked"}
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
          detail="OpenRouter credits stay in OpenRouter. PhantomForce stores no card details and only uses the server-side API key."
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
    "Summarize today's safest PhantomForce and ChicagoShots follow-up priorities for owner review only.",
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
      tenant_id: "phantomforce-owner",
      business_name: businessOpsSimulation.owner.business,
      request_id: `ui-preview-${Date.now()}`,
      task_type: task,
      sensitivity_level: sensitivity,
      user_request: text,
      business_summary:
        "Owner-only PhantomForce workspace. Client-facing work stays approval-only and developer tooling remains hidden.",
      module_data: [
        {
          module: "Tasks",
          summary: "Today includes local business tasks and approval-only follow-ups.",
          items: businessOpsSimulation.tasks.slice(0, 3),
        },
        {
          module: "Approvals",
          summary: "Approvals are review items only; no sends, uploads, billing, or production actions execute.",
          items: businessOpsSimulation.approvals.slice(0, 3),
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

function PhantomAiStatusPanel({
  canManageAccess = false,
  opsStatus = defaultPhantomAiOpsStatus,
  sessionHeaders,
}: {
  canManageAccess?: boolean;
  opsStatus?: PhantomAiOpsStatus;
  sessionHeaders?: (json?: boolean) => Record<string, string>;
}) {
  if (!canManageAccess) {
    return (
      <section className="panel phantom-ai-panel">
        <div className="section-head compact">
          <div>
            <span className="eyebrow">Phantom AI status</span>
            <h3>Assistant, proposals, and send controls</h3>
          </div>
          <TruthBadge state="real" label="Online" />
        </div>
        <div className="ai-status-list">
          <StatusLine label="Phantom AI" value={phantomAiStatus.availability} />
          <StatusLine
            label="ChicagoShots"
            value={opsStatus.chicagoshots_ops.available ? "Proposal workflow ready" : "Proposal workflow loading"}
          />
          <StatusLine
            label="Send readiness"
            value={opsStatus.send_readiness.send_enabled ? "Enabled" : "Draft-first / confirmation required"}
          />
          <StatusLine label="Send control" value={phantomAiStatus.approvalGate} />
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
            <strong>Needs final click</strong>
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

  const hermesValue = opsStatus.hermes.ready
    ? "Ledger + context compiler enabled"
    : "Setup required";
  const memoryStoreValue = opsStatus.hermes.interaction_memory_store_enabled
    ? opsStatus.hermes.interaction_memory_store_exists
      ? `Local memory store present (${opsStatus.hermes.interaction_memory_store_bytes} bytes)`
      : "Local memory store ready / empty"
    : "Memory store unavailable";
  const glmValue = opsStatus.glm_worker.live_call_ready
    ? `Ready: ${opsStatus.glm_worker.model_id}`
    : `Gated/off: ${opsStatus.glm_worker.model_id}`;
  const n8nValue = opsStatus.n8n.n8n_running
    ? `Running at ${opsStatus.n8n.n8n_local_url}`
    : opsStatus.n8n.n8n_scaffolded
      ? `Available locally at ${opsStatus.n8n.n8n_local_url}`
      : "Scaffold not detected";
  const safetyValue =
    opsStatus.safety_flags.execution_disabled &&
    opsStatus.safety_flags.external_sends_disabled &&
    opsStatus.safety_flags.queue_writes_disabled &&
    opsStatus.safety_flags.production_ledger_writes_disabled
      ? "External actions blocked"
      : "Review safety gates";

  return (
    <section className="panel phantom-ai-panel">
      <div className="section-head compact">
        <div>
          <span className="eyebrow">Admin ops dashboard</span>
          <h3>Live local system state</h3>
        </div>
        <TruthBadge state="real" label="Live Internal Pilot" />
      </div>
      <div className="ai-status-list">
        <StatusLine label="Phantom AI" value={opsStatus.product_status} />
        <StatusLine label="Hermes" value={hermesValue} />
        <StatusLine label="Memory store" value={memoryStoreValue} />
        <StatusLine label="Advanced reasoning lane" value={glmValue} />
        <StatusLine label="n8n local worker" value={n8nValue} />
        <StatusLine
          label="ChicagoShots"
          value={opsStatus.chicagoshots_ops.available ? "Workflow ready" : "Workflow unavailable"}
        />
        <StatusLine
          label="Send readiness"
          value={opsStatus.send_readiness.send_enabled ? "Enabled" : "Draft-only / disabled"}
        />
        <StatusLine label="Safety state" value={safetyValue} />
      </div>
      <div className="ai-rule-columns ops-rule-columns">
        <div>
          <strong>Current gates</strong>
          <ul>
            <li>GLM worker: {opsStatus.glm_worker.live_call_ready ? "ready" : "gated/off unless enabled"}</li>
            <li>Tool lane: {opsStatus.tool_lane_status.status}</li>
            <li>n8n scaffolded: {opsStatus.n8n.n8n_scaffolded ? "true" : "false"}</li>
            <li>ChicagoShots preview: {opsStatus.chicagoshots_ops.dry_run_only ? "dry-run only" : "review"}</li>
            <li>Send route present: {opsStatus.send_readiness.send_route_present ? "true" : "false"}</li>
          </ul>
        </div>
        <div>
          <strong>Blocked actions</strong>
          <ul>
            <li>Approvals execute endpoint: {opsStatus.safety_flags.approvals_execute_absent ? "absent" : "review"}</li>
            <li>Execution disabled: {opsStatus.safety_flags.execution_disabled ? "true" : "false"}</li>
            <li>Queue writes disabled: {opsStatus.safety_flags.queue_writes_disabled ? "true" : "false"}</li>
            <li>
              Production ledger writes disabled:{" "}
              {opsStatus.safety_flags.production_ledger_writes_disabled ? "true" : "false"}
            </li>
            <li>External sends disabled: {opsStatus.safety_flags.external_sends_disabled ? "true" : "false"}</li>
            <li>Test allowlist required: {opsStatus.send_readiness.test_allowlist_required ? "true" : "false"}</li>
            <li>Audit receipt required: {opsStatus.send_readiness.audit_receipt_required ? "true" : "false"}</li>
          </ul>
        </div>
      </div>
      <ChicagoShotsLeadIntakePanel sessionHeaders={sessionHeaders} />
      <p className="ops-status-note">
        Read-only localhost/admin status. No provider call, n8n workflow execution, approval execution, queue write, or
        production ledger write is performed by this dashboard.
      </p>
    </section>
  );
}

function ChicagoShotsLeadIntakePanel({
  sessionHeaders,
}: {
  sessionHeaders?: (json?: boolean) => Record<string, string>;
}) {
  const [leadForm, setLeadForm] = useState<ChicagoShotsLeadForm>(defaultChicagoShotsLeadForm);
  const [leadPreview, setLeadPreview] = useState<ChicagoShotsLeadIntakePacket | null>(null);
  const [leadBusy, setLeadBusy] = useState(false);
  const [leadError, setLeadError] = useState("");
  const [copiedLeadText, setCopiedLeadText] = useState("");
  const [proposalHistory, setProposalHistory] = useState<ChicagoShotsProposalHistoryRecord[]>([]);
  const [selectedProposalRecord, setSelectedProposalRecord] = useState<ChicagoShotsProposalHistoryRecord | null>(null);
  const [proposalHistoryBusy, setProposalHistoryBusy] = useState(false);
  const [proposalHistoryStatus, setProposalHistoryStatus] = useState("");
  const [proposalHistoryFilter, setProposalHistoryFilter] = useState<ChicagoShotsProposalHistoryFilter>("all");
  const [proposalHistoryCounts, setProposalHistoryCounts] =
    useState<ChicagoShotsProposalStatusCounts>(defaultChicagoShotsProposalStatusCounts);
  const [proposalHistorySearch, setProposalHistorySearch] = useState("");
  const [phantomAiArtifacts, setPhantomAiArtifacts] = useState<ChicagoShotsPhantomAiArtifact[]>([]);
  const hasSessionHeaders = Boolean(sessionHeaders);

  function updateLeadField(field: keyof ChicagoShotsLeadForm, value: string) {
    setLeadForm((current) => ({ ...current, [field]: value }));
  }

  function applyPreset(preset: ChicagoShotsLeadPreset) {
    setLeadForm(preset.form);
    setLeadPreview(null);
    setLeadError("");
    setCopiedLeadText("");
    setPhantomAiArtifacts([
      createChicagoShotsNextActionArtifact("Preset loaded. Generate the intake preview to create quote and proposal artifacts.", [
        preset.label,
        "Preview route stays local and deterministic",
        "No send or invoice is created",
      ]),
    ]);
  }

  useEffect(() => {
    if (!sessionHeaders) return;
    void loadProposalHistory();
  }, [hasSessionHeaders]);

  async function copyLeadText(label: string, text: string) {
    setLeadError("");
    if (!navigator.clipboard?.writeText) {
      setLeadError("Clipboard is not available in this browser. Select the draft text manually.");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopiedLeadText(`Copied ${label}.`);
    } catch {
      setLeadError("Clipboard copy was blocked by the browser. Select the draft text manually.");
    }
  }

  function downloadLeadPacket(packet: ChicagoShotsLeadIntakePacket) {
    setLeadError("");
    const packetText = formatChicagoShotsIntakePacket(packet);
    downloadMarkdown(chicagoShotsPacketFileName(packet), packetText);
    setCopiedLeadText("Downloaded intake packet.");
  }

  function downloadMarkdown(fileName: string, markdown: string) {
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function showPhantomAiArtifacts(cards: ChicagoShotsPhantomAiArtifact[]) {
    setPhantomAiArtifacts(cards.slice(0, 5));
  }

  function addPhantomAiArtifacts(cards: ChicagoShotsPhantomAiArtifact[]) {
    setPhantomAiArtifacts((current) => [...cards, ...current].slice(0, 5));
  }

  async function requestChicagoShotsPreview(options: { saveToHistory?: boolean } = {}) {
    setLeadError("");
    setCopiedLeadText("");

    if (!sessionHeaders) {
      setLeadError("Admin session is not available. Sign in as Jordan / PhantomForce Admin.");
      return null;
    }

    setLeadBusy(true);
    try {
      const response = await fetch(`${API_BASE_URL}/phantom-ai/ops/chicagoshots/lead-intake/preview`, {
        method: "POST",
        headers: sessionHeaders(true),
        body: JSON.stringify({
          tenant_id: "chicagoshots",
          ...leadForm,
        }),
      });
      const data = (await response.json().catch(() => null)) as {
        ok?: boolean;
        lead?: ChicagoShotsLeadIntakePacket;
        error?: string;
      } | null;

      if (!response.ok || !data?.lead) {
        setLeadPreview(null);
        setLeadError(data?.error ?? "ChicagoShots intake preview is unavailable.");
        return null;
      }

      setLeadPreview(data.lead);
      if (options.saveToHistory ?? true) {
        void saveProposalPacket(data.lead, { silent: true });
      }
      return data.lead;
    } catch {
      setLeadPreview(null);
      setLeadError("ChicagoShots intake preview could not reach the local backend.");
      return null;
    } finally {
      setLeadBusy(false);
    }
  }

  async function loadProposalHistory() {
    if (!sessionHeaders) return;

    setProposalHistoryBusy(true);
    try {
      const response = await fetch(`${API_BASE_URL}/phantom-ai/ops/chicagoshots/proposal-history?limit=50`, {
        headers: sessionHeaders(),
      });
      const data = (await response.json().catch(() => null)) as ChicagoShotsProposalHistoryListResponse | null;

      if (!response.ok || !data?.records) {
        setProposalHistoryStatus(data?.error ?? "Proposal history is not available.");
        return;
      }

      setProposalHistory(data.records);
      setProposalHistoryCounts(data.summary_counts ?? countChicagoShotsProposalStatuses(data.records));
      if (selectedProposalRecord && !data.records.some((record) => record.id === selectedProposalRecord.id)) {
        setSelectedProposalRecord(null);
      } else if (selectedProposalRecord) {
        setSelectedProposalRecord(data.records.find((record) => record.id === selectedProposalRecord.id) ?? selectedProposalRecord);
      }
      setProposalHistoryStatus(data.records.length ? "Loaded recent proposal packets." : "No saved proposal packets yet.");
    } catch {
      setProposalHistoryStatus("Proposal history could not reach the local backend.");
    } finally {
      setProposalHistoryBusy(false);
    }
  }

  async function saveProposalPacket(
    packet: ChicagoShotsLeadIntakePacket,
    options: { silent?: boolean } = {},
  ): Promise<ChicagoShotsProposalHistoryRecord | null> {
    if (!sessionHeaders) {
      setLeadError("Admin session is not available. Sign in as Jordan / PhantomForce Admin.");
      return null;
    }

    const exportedMarkdown = formatChicagoShotsIntakePacket(packet);
    const clientReadyProposal = formatChicagoShotsClientReadyProposal(packet);
    const proposalSummary = formatChicagoShotsProposalSummary(packet);

    try {
      const response = await fetch(`${API_BASE_URL}/phantom-ai/ops/chicagoshots/proposal-history/save`, {
        method: "POST",
        headers: sessionHeaders(true),
        body: JSON.stringify({
          packet,
          proposal_summary: proposalSummary,
          client_ready_proposal: clientReadyProposal,
          exported_markdown: exportedMarkdown,
        }),
      });
      const data = (await response.json().catch(() => null)) as ChicagoShotsProposalHistorySaveResponse | null;

      if (!response.ok || !data?.record) {
        setProposalHistoryStatus(data?.error ?? "Proposal packet could not be saved locally.");
        return null;
      }

      setProposalHistory((current) => {
        const next = [data.record!, ...current.filter((record) => record.id !== data.record!.id)].slice(0, 50);
        setProposalHistoryCounts(countChicagoShotsProposalStatuses(next));
        return next;
      });
      setSelectedProposalRecord(data.record);
      setProposalHistoryStatus(options.silent ? "Saved generated packet to local history." : "Saved proposal packet locally.");
      return data.record;
    } catch {
      setProposalHistoryStatus("Proposal packet could not be saved to the local backend.");
      return null;
    }
  }

  async function updateProposalPacketStatus(record: ChicagoShotsProposalHistoryRecord, status: ChicagoShotsProposalStatus) {
    if (!sessionHeaders) {
      setLeadError("Admin session is not available. Sign in as Jordan / PhantomForce Admin.");
      return;
    }

    setProposalHistoryBusy(true);
    try {
      const response = await fetch(
        `${API_BASE_URL}/phantom-ai/ops/chicagoshots/proposal-history/${encodeURIComponent(record.id)}/status`,
        {
          method: "PATCH",
          headers: sessionHeaders(true),
          body: JSON.stringify({ status }),
        },
      );
      const data = (await response.json().catch(() => null)) as ChicagoShotsProposalStatusUpdateResponse | null;

      if (!response.ok || !data?.record) {
        setProposalHistoryStatus(data?.error ?? "Proposal status could not be updated locally.");
        return;
      }

      setProposalHistory((current) => {
        const next = [data.record!, ...current.filter((item) => item.id !== data.record!.id)].slice(0, 50);
        setProposalHistoryCounts(countChicagoShotsProposalStatuses(next));
        return next;
      });
      setSelectedProposalRecord(data.record);
      setProposalHistoryStatus(`Status updated: ${chicagoShotsProposalStatusLabels[data.record.status]}. No message was sent.`);
      showPhantomAiArtifacts([
        buildSavedPacketArtifact(data.record),
        createChicagoShotsNextActionArtifact(data.record.proposal_next_action, [
          data.record.proposal_next_action_detail,
          `Follow-up timing: ${data.record.proposal_follow_up_timing}`,
          "No automated send, payment request, invoice, queue write, or ledger write occurred",
        ]),
      ]);
    } catch {
      setProposalHistoryStatus("Proposal status update could not reach the local backend.");
    } finally {
      setProposalHistoryBusy(false);
    }
  }

  function getActiveProposalRecord() {
    return selectedProposalRecord ?? getChicagoShotsPriorityProposal(proposalHistory);
  }

  function createMissingLeadArtifact(action: string) {
    return createChicagoShotsNextActionArtifact(`${action} needs a lead context first.`, [
      "Load a ChicagoShots preset or enter lead details",
      "Generate the local intake preview",
      "Then Phantom AI can produce dashboard artifacts from the packet",
    ]);
  }

  async function ensureLeadPreviewForAction(action: string) {
    if (leadPreview) return leadPreview;

    if (!hasChicagoShotsLeadInput(leadForm)) {
      showPhantomAiArtifacts([createMissingLeadArtifact(action)]);
      return null;
    }

    return requestChicagoShotsPreview({ saveToHistory: false });
  }

  function buildContextNextActionArtifact() {
    const activeRecord = getActiveProposalRecord();

    if (activeRecord) {
      return createChicagoShotsNextActionArtifact(activeRecord.proposal_next_action, [
        `${activeRecord.client_name} - ${activeRecord.package}`,
        `Status: ${chicagoShotsProposalStatusLabels[activeRecord.status]}`,
        `Priority: ${activeRecord.proposal_priority_score} / ${chicagoShotsProposalPriorityLabels[activeRecord.proposal_priority_label]}`,
        activeRecord.proposal_next_action_detail,
        "No automated message, payment request, invoice, queue write, or ledger write will be created",
      ]);
    }

    if (leadPreview) {
      return createChicagoShotsNextActionArtifact("Save the generated proposal packet, then choose the next local pipeline status.", [
        `${leadPreview.normalized_lead.client_name || "New lead"} - ${leadPreview.recommended_service_package.name}`,
        `Range: ${leadPreview.recommended_price_range}`,
        "Saved packet history stays local/admin-only",
      ]);
    }

    return createChicagoShotsNextActionArtifact("Start with a ChicagoShots lead preset or enter a real lead request.", [
      "Phantom AI will use the local preview route",
      "Artifacts render as dashboard cards",
      "Provider calls and external actions stay blocked",
    ]);
  }

  async function runPhantomAiAction(action: ChicagoShotsPhantomAiAction) {
    if (action === "summarize_saved_packet") {
      const activeRecord = getActiveProposalRecord();
      showPhantomAiArtifacts(
        activeRecord
          ? [buildSavedPacketArtifact(activeRecord), buildContextNextActionArtifact()]
          : [
              createChicagoShotsNextActionArtifact("No saved packet is selected yet.", [
                "Generate a proposal packet from the lead intake form",
                "Or select an existing saved packet from recent proposal packets",
                "History stays local/admin-only",
              ]),
            ],
      );
      return;
    }

    if (action === "suggest_next_action") {
      showPhantomAiArtifacts([buildContextNextActionArtifact()]);
      return;
    }

    const packet = await ensureLeadPreviewForAction(
      action === "draft_follow_up"
        ? "Draft follow-up"
        : action === "generate_proposal"
          ? "Generate proposal"
          : "Explain package recommendation",
    );

    if (!packet) return;

    if (action === "draft_follow_up") {
      showPhantomAiArtifacts([buildFollowUpArtifact(packet), buildApprovalArtifact(packet)]);
      return;
    }

    if (action === "explain_package") {
      showPhantomAiArtifacts([buildPackageArtifact(packet), buildContextNextActionArtifact()]);
      return;
    }

    const savedRecord = await saveProposalPacket(packet);
    showPhantomAiArtifacts([
      buildProposalArtifact(packet),
      buildApprovalArtifact(packet),
      ...(savedRecord ? [buildSavedPacketArtifact(savedRecord)] : []),
    ]);
  }

  function downloadSavedPacket(record: ChicagoShotsProposalHistoryRecord) {
    setLeadError("");
    downloadMarkdown(chicagoShotsSavedPacketFileName(record), record.exported_markdown);
    setCopiedLeadText("Downloaded saved proposal packet.");
  }

  async function generateIntakePreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const packet = await requestChicagoShotsPreview({ saveToHistory: true });

    if (packet) {
      showPhantomAiArtifacts([buildProposalArtifact(packet), buildApprovalArtifact(packet), buildFollowUpArtifact(packet)]);
    }
  }

  const safetyRows = leadPreview
    ? [
        ["Provider call", leadPreview.safety_flags.provider_called],
        ["Network call", leadPreview.safety_flags.network_call_performed],
        ["External send", leadPreview.safety_flags.external_send],
        ["Would send", leadPreview.safety_flags.would_send],
        ["Approval executed", leadPreview.safety_flags.approval_executed],
        ["Queue written", leadPreview.safety_flags.queue_written],
        ["Production ledger write", leadPreview.safety_flags.production_ledger_write],
        ["Raw secret exposed", leadPreview.safety_flags.raw_secret_exposed],
      ]
    : [];
  const prioritizedProposalHistory = sortChicagoShotsProposalHistory(proposalHistory);
  const priorityProposalRecord = getChicagoShotsPriorityProposal(proposalHistory);
  const proposalSearchTerm = proposalHistorySearch.trim().toLowerCase();
  const visibleProposalHistory = prioritizedProposalHistory.filter((record) =>
    (proposalHistoryFilter === "all" ? true : record.status === proposalHistoryFilter) &&
    (!proposalSearchTerm || chicagoShotsProposalSearchText(record).includes(proposalSearchTerm)),
  );
  const activeProposalRecord = getActiveProposalRecord();
  const nextActionContext = buildContextNextActionArtifact().summary;
  const workflowContext = leadPreview
    ? `${leadPreview.normalized_lead.client_name || "New lead"} - ${leadPreview.recommended_service_package.name}`
    : activeProposalRecord
      ? `${activeProposalRecord.client_name} - ${activeProposalRecord.package}`
      : "ChicagoShots lead intake ready";
  const activePacketContext = activeProposalRecord
    ? `${activeProposalRecord.client_name} (${chicagoShotsProposalStatusLabels[activeProposalRecord.status]})`
    : leadPreview
      ? `${leadPreview.normalized_lead.client_name || "Unsaved lead"} preview`
      : "No proposal packet selected";
  const priorityPacketContext = priorityProposalRecord
    ? `${priorityProposalRecord.client_name} - ${chicagoShotsProposalStatusLabels[priorityProposalRecord.status]}`
    : "No saved packet yet";
  const phantomAiActionDisabled = !sessionHeaders || leadBusy || proposalHistoryBusy;

  return (
    <section className="lead-intake-panel">
      <div className="section-head compact">
        <div>
          <span className="eyebrow">ChicagoShots operator</span>
          <h3>Lead intake preview</h3>
        </div>
        <TruthBadge state="real" label="Admin only" />
      </div>
      <div className="lead-status-strip" aria-label="ChicagoShots preview safety status">
        <span>Preview only</span>
        <span>No send</span>
        <span>No invoice</span>
        <span>No queue write</span>
        <span>No ledger write</span>
      </div>
      <section className="phantom-ai-workflow-brain" aria-label="Embedded Phantom AI dashboard workflow">
        <div className="section-head compact">
          <div>
            <span className="eyebrow">Phantom AI embedded</span>
            <h4>Dashboard brain for this workflow</h4>
          </div>
          <TruthBadge state="real" label="Action-first" />
        </div>
        <div className="phantom-ai-context-grid">
          <StatusLine label="Current module" value="Phantom AI / ChicagoShots operator" />
          <StatusLine label="Workflow context" value={workflowContext} />
          <StatusLine label="Active packet" value={activePacketContext} />
          <StatusLine label="Priority packet" value={priorityPacketContext} />
          <StatusLine label="Best local move" value={nextActionContext} />
        </div>
        <div className="phantom-ai-action-row" aria-label="Embedded Phantom AI actions">
          <button
            className="ghost-small"
            type="button"
            onClick={() => void runPhantomAiAction("draft_follow_up")}
            disabled={phantomAiActionDisabled}
          >
            <MessageSquare size={15} />
            Draft follow-up
          </button>
          <button
            className="ghost-small"
            type="button"
            onClick={() => void runPhantomAiAction("generate_proposal")}
            disabled={phantomAiActionDisabled}
          >
            <FileText size={15} />
            Generate proposal
          </button>
          <button
            className="ghost-small"
            type="button"
            onClick={() => void runPhantomAiAction("explain_package")}
            disabled={phantomAiActionDisabled}
          >
            <Search size={15} />
            Explain package recommendation
          </button>
          <button
            className="ghost-small"
            type="button"
            onClick={() => void runPhantomAiAction("summarize_saved_packet")}
            disabled={phantomAiActionDisabled || !activeProposalRecord}
          >
            <FileText size={15} />
            Summarize saved packet
          </button>
          <button
            className="ghost-small"
            type="button"
            onClick={() => void runPhantomAiAction("suggest_next_action")}
            disabled={phantomAiActionDisabled}
          >
            <ArrowRight size={15} />
            Suggest next action
          </button>
          <button
            className="ghost-small"
            type="button"
            onClick={() => {
              if (!priorityProposalRecord) return;
              setSelectedProposalRecord(priorityProposalRecord);
              showPhantomAiArtifacts([
                buildSavedPacketArtifact(priorityProposalRecord),
                buildContextNextActionArtifact(),
              ]);
            }}
            disabled={phantomAiActionDisabled || !priorityProposalRecord}
          >
            <Zap size={15} />
            Open priority packet
          </button>
        </div>
        {phantomAiArtifacts.length ? (
          <div className="phantom-ai-artifact-grid" aria-label="Phantom AI dashboard artifacts">
            {phantomAiArtifacts.map((artifact) => (
              <article className={`operator-result-card phantom-ai-artifact ${artifact.kind}`} key={artifact.id}>
                <span className="eyebrow">{artifact.kind.replace(/_/g, " ")}</span>
                <h4>{artifact.title}</h4>
                <p>{artifact.summary}</p>
                {artifact.body ? <p className="draft-copy">{artifact.body}</p> : null}
                <ul>
                  {artifact.details.map((detail) => (
                    <li key={detail}>{detail}</li>
                  ))}
                </ul>
                {artifact.copy_text && artifact.copy_label ? (
                  <button
                    className="ghost-small"
                    type="button"
                    onClick={() => void copyLeadText(artifact.copy_label!, artifact.copy_text!)}
                  >
                    <Copy size={15} />
                    Copy {artifact.copy_label}
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <p className="ops-status-note">
            Use the embedded actions to turn this module context into follow-up, proposal, approval, saved-packet, or
            next-action cards.
          </p>
        )}
      </section>
      <div className="lead-preset-row" aria-label="ChicagoShots lead presets">
        {chicagoShotsLeadPresets.map((preset) => (
          <button className="lead-preset-button" type="button" key={preset.id} onClick={() => applyPreset(preset)}>
            <strong>{preset.label}</strong>
            <span>{preset.detail}</span>
          </button>
        ))}
      </div>
      <form className="lead-intake-form" onSubmit={generateIntakePreview}>
        <label>
          Client name
          <input
            value={leadForm.client_name}
            onChange={(event) => updateLeadField("client_name", event.target.value)}
            placeholder="Jordan Test Client"
          />
        </label>
        <label>
          Contact
          <input
            value={leadForm.contact}
            onChange={(event) => updateLeadField("contact", event.target.value)}
            placeholder="client@example.com"
          />
        </label>
        <label>
          Event type
          <input
            value={leadForm.event_type}
            onChange={(event) => updateLeadField("event_type", event.target.value)}
            placeholder="Corporate event"
          />
        </label>
        <label>
          Date/time
          <input
            value={leadForm.date_time}
            onChange={(event) => updateLeadField("date_time", event.target.value)}
            placeholder="July 18, 2026 at 6 PM"
          />
        </label>
        <label>
          Location
          <input
            value={leadForm.location}
            onChange={(event) => updateLeadField("location", event.target.value)}
            placeholder="River North, Chicago"
          />
        </label>
        <label>
          Requested service
          <input
            value={leadForm.requested_service}
            onChange={(event) => updateLeadField("requested_service", event.target.value)}
            placeholder="Event coverage and same-day teaser"
          />
        </label>
        <label>
          Budget/rate
          <input
            value={leadForm.budget_rate}
            onChange={(event) => updateLeadField("budget_rate", event.target.value)}
            placeholder="$1,500 budget"
          />
        </label>
        <label>
          Source/platform
          <input
            value={leadForm.source_platform}
            onChange={(event) => updateLeadField("source_platform", event.target.value)}
            placeholder="Instagram DM"
          />
        </label>
        <label>
          Urgency
          <select value={leadForm.urgency} onChange={(event) => updateLeadField("urgency", event.target.value)}>
            <option value="">Auto-classify</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>
        <label className="lead-notes-field">
          Notes
          <textarea
            value={leadForm.notes}
            onChange={(event) => updateLeadField("notes", event.target.value)}
            placeholder="Paste the raw lead notes here. Secrets and sensitive values are redacted server-side."
          />
        </label>
        <div className="lead-intake-actions">
          <button className="primary-action" type="submit" disabled={leadBusy}>
            <Sparkles size={16} />
            {leadBusy ? "Generating..." : "Generate Intake Preview"}
          </button>
          <button
            className="ghost-small"
            type="button"
            onClick={() => {
              setLeadForm(defaultChicagoShotsLeadForm);
              setLeadPreview(null);
              setLeadError("");
            }}
            disabled={leadBusy}
          >
            Clear
          </button>
        </div>
      </form>

      {leadError ? <p className="operator-error">{leadError}</p> : null}
      {copiedLeadText ? <p className="operator-copy-status">{copiedLeadText}</p> : null}
      {proposalHistoryStatus ? <p className="operator-copy-status">{proposalHistoryStatus}</p> : null}

      <section className="proposal-history-panel" aria-label="Recent ChicagoShots proposal packets">
        <div className="section-head compact">
          <div>
            <span className="eyebrow">Local history</span>
            <h4>Recent proposal packets</h4>
          </div>
          <button className="ghost-small" type="button" onClick={() => void loadProposalHistory()} disabled={proposalHistoryBusy}>
            <RefreshCcw size={15} />
            {proposalHistoryBusy ? "Loading" : "Refresh"}
          </button>
        </div>
        <div className="lead-status-strip">
          <span>Local only</span>
          <span>Admin only</span>
          <span>No send</span>
          <span>No payment</span>
          <span>No ledger write</span>
        </div>
        <div className="proposal-summary-grid" aria-label="ChicagoShots proposal pipeline counts">
          <StatusLine label="Total saved" value={String(proposalHistoryCounts.total)} />
          <StatusLine label="Drafts" value={String(proposalHistoryCounts.draft)} />
          <StatusLine label="Sent manually" value={String(proposalHistoryCounts.sent_manually)} />
          <StatusLine label="Follow-up needed" value={String(proposalHistoryCounts.follow_up_needed)} />
          <StatusLine label="Won" value={String(proposalHistoryCounts.won)} />
        </div>
        {priorityProposalRecord ? (
          <article className="proposal-priority-card" aria-label="Fastest money move">
            <span className={`proposal-priority-badge ${chicagoShotsProposalPriorityClass(priorityProposalRecord.proposal_priority_label)}`}>
              {chicagoShotsProposalPriorityLabels[priorityProposalRecord.proposal_priority_label]} ·{" "}
              {priorityProposalRecord.proposal_priority_score}
            </span>
            <div>
              <strong>{priorityProposalRecord.proposal_next_action}</strong>
              <p>{priorityProposalRecord.proposal_next_action_detail}</p>
            </div>
            <button
              className="ghost-small"
              type="button"
              onClick={() => {
                setSelectedProposalRecord(priorityProposalRecord);
                showPhantomAiArtifacts([buildSavedPacketArtifact(priorityProposalRecord), buildContextNextActionArtifact()]);
              }}
            >
              <Zap size={15} />
              Work this first
            </button>
          </article>
        ) : null}
        <div className="proposal-history-tools">
          <label className="proposal-search-field">
            Search saved packets
            <input
              value={proposalHistorySearch}
              onChange={(event) => setProposalHistorySearch(event.target.value)}
              placeholder="Client, package, status, price..."
            />
          </label>
          {priorityProposalRecord ? (
            <button
              className="ghost-small"
              type="button"
              onClick={() => setSelectedProposalRecord(priorityProposalRecord)}
            >
              <Zap size={15} />
              Jump to priority
            </button>
          ) : null}
        </div>
        <div className="proposal-filter-row" aria-label="ChicagoShots proposal filters">
          {chicagoShotsProposalHistoryFilters.map((value) => (
            <button
              className={`proposal-filter-button${proposalHistoryFilter === value ? " active" : ""}`}
              type="button"
              key={value}
              onClick={() => setProposalHistoryFilter(value as ChicagoShotsProposalHistoryFilter)}
            >
              {chicagoShotsProposalStatusLabel(value)}
            </button>
          ))}
        </div>
        {visibleProposalHistory.length ? (
          <div className="proposal-history-list">
            {visibleProposalHistory.map((record) => (
              <button
                className={`proposal-history-item${selectedProposalRecord?.id === record.id ? " active" : ""}`}
                type="button"
                key={record.id}
                onClick={() => setSelectedProposalRecord(record)}
              >
                <span className={`proposal-status-badge ${chicagoShotsProposalStatusClass(record.status)}`}>
                  {chicagoShotsProposalStatusLabels[record.status]}
                </span>
                <strong>{record.client_name}</strong>
                <span>{record.package}</span>
                <span className={`proposal-priority-mini ${chicagoShotsProposalPriorityClass(record.proposal_priority_label)}`}>
                  {chicagoShotsProposalPriorityLabels[record.proposal_priority_label]} · {record.proposal_priority_score}
                </span>
                <span>{record.proposal_next_action}</span>
                <span>{record.created_at.slice(0, 10)} - {record.recommended_price_range}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="ops-status-note">
            {proposalHistory.length
              ? "No proposal packets match this filter."
              : "Generate an intake preview to save the first local proposal packet."}
          </p>
        )}
        {selectedProposalRecord ? (
          <article className="operator-result-card proposal-history-detail">
            <span className="eyebrow">Saved packet</span>
            <h4>{selectedProposalRecord.client_name} - {selectedProposalRecord.package}</h4>
            <StatusLine label="Status" value={chicagoShotsProposalStatusLabels[selectedProposalRecord.status]} />
            <StatusLine label="Created" value={selectedProposalRecord.created_at} />
            <StatusLine label="Status updated" value={selectedProposalRecord.status_updated_at} />
            <StatusLine label="Range" value={selectedProposalRecord.recommended_price_range} />
            <StatusLine label="Timeline" value={selectedProposalRecord.delivery_timeline} />
            <StatusLine label="Channel" value={selectedProposalRecord.follow_up_channel} />
            <StatusLine
              label="Priority"
              value={`${chicagoShotsProposalPriorityLabels[selectedProposalRecord.proposal_priority_label]} / ${selectedProposalRecord.proposal_priority_score}`}
            />
            <StatusLine label="Follow-up timing" value={selectedProposalRecord.proposal_follow_up_timing} />
            <div className="proposal-next-action-box">
              <strong>{selectedProposalRecord.proposal_next_action}</strong>
              <p>{selectedProposalRecord.proposal_next_action_detail}</p>
            </div>
            <p>{selectedProposalRecord.proposal_summary}</p>
            <label className="proposal-status-select">
              Status
              <select
                value={selectedProposalRecord.status}
                onChange={(event) =>
                  void updateProposalPacketStatus(
                    selectedProposalRecord,
                    event.target.value as ChicagoShotsProposalStatus,
                  )
                }
                disabled={proposalHistoryBusy}
              >
                {chicagoShotsProposalStatusOptions.map((status) => (
                  <option value={status} key={status}>
                    {chicagoShotsProposalStatusLabels[status]}
                  </option>
                ))}
              </select>
            </label>
            <div className="proposal-status-actions" aria-label="ChicagoShots proposal status actions">
              {chicagoShotsProposalStatusOptions.map((status) => (
                <button
                  className={`ghost-small proposal-status-action${selectedProposalRecord.status === status ? " active" : ""}`}
                  type="button"
                  key={status}
                  onClick={() => void updateProposalPacketStatus(selectedProposalRecord, status)}
                  disabled={proposalHistoryBusy || selectedProposalRecord.status === status}
                >
                  {status === "sent_manually"
                    ? "Mark sent manually"
                    : status === "follow_up_needed"
                      ? "Mark follow-up needed"
                      : status === "won"
                        ? "Mark won"
                        : status === "lost"
                          ? "Mark lost"
                          : "Mark draft"}
                </button>
              ))}
            </div>
            <div className="lead-copy-actions">
              <button
                className="ghost-small"
                type="button"
                onClick={() =>
                  void copyLeadText("saved client-ready proposal", chicagoShotsProposalBody(selectedProposalRecord))
                }
              >
                <Copy size={15} />
                Copy client-ready proposal
              </button>
              <button className="ghost-small" type="button" onClick={() => downloadSavedPacket(selectedProposalRecord)}>
                <Download size={15} />
                Download saved .md
              </button>
            </div>
            <pre className="proposal-packet-preview">{selectedProposalRecord.exported_markdown}</pre>
          </article>
        ) : null}
      </section>

      {leadPreview ? (
        <div className="lead-preview-output">
          <div className="lead-copy-actions" aria-label="Copy ChicagoShots intake outputs">
            <button className="ghost-small" type="button" onClick={() => void saveProposalPacket(leadPreview)}>
              <FileText size={15} />
              Save to history
            </button>
            <button className="ghost-small" type="button" onClick={() => downloadLeadPacket(leadPreview)}>
              <Download size={15} />
              Download intake packet
            </button>
            <button
              className="ghost-small"
              type="button"
              onClick={() => void copyLeadText("client summary", formatChicagoShotsClientSummary(leadPreview))}
            >
              <Copy size={15} />
              Copy client summary
            </button>
            <button
              className="ghost-small"
              type="button"
              onClick={() => void copyLeadText("follow-up draft", formatChicagoShotsFollowUpDraft(leadPreview))}
            >
              <Copy size={15} />
              Copy follow-up draft
            </button>
            <button
              className="ghost-small"
              type="button"
              onClick={() => void copyLeadText("quote draft", formatChicagoShotsQuoteDraft(leadPreview))}
            >
              <Copy size={15} />
              Copy quote draft
            </button>
            <button
              className="ghost-small"
              type="button"
              onClick={() => void copyLeadText("proposal summary", formatChicagoShotsProposalSummary(leadPreview))}
            >
              <Copy size={15} />
              Copy proposal summary
            </button>
            <button
              className="ghost-small"
              type="button"
              onClick={() =>
                void copyLeadText("client-ready proposal", formatChicagoShotsClientReadyProposal(leadPreview))
              }
            >
              <Copy size={15} />
              Copy client-ready proposal
            </button>
            <button
              className="ghost-small"
              type="button"
              onClick={() => void copyLeadText("deliverables checklist", formatChicagoShotsDeliverables(leadPreview))}
            >
              <Copy size={15} />
              Copy deliverables checklist
            </button>
            <button
              className="ghost-small"
              type="button"
              onClick={() => void copyLeadText("full intake packet", formatChicagoShotsIntakePacket(leadPreview))}
            >
              <Copy size={15} />
              Copy full intake packet
            </button>
          </div>
          <article className="operator-result-card">
            <span className="eyebrow">Normalized lead</span>
            <StatusLine label="Client" value={leadPreview.normalized_lead.client_name} />
            <StatusLine label="Contact" value={leadPreview.normalized_lead.contact} />
            <StatusLine label="Category" value={leadPreview.normalized_lead.event_category} />
            <StatusLine label="Urgency" value={leadPreview.normalized_lead.urgency} />
            <p>{leadPreview.normalized_lead.notes}</p>
          </article>
          <article className="operator-result-card">
            <span className="eyebrow">Recommended package</span>
            <h4>{leadPreview.recommended_service_package.name}</h4>
            <p>{leadPreview.recommended_service_package.rationale}</p>
            <small>Add-ons: {leadPreview.recommended_service_package.suggested_addons.join(", ") || "None"}</small>
          </article>
          <article className="operator-result-card">
            <span className="eyebrow">Quote / proposal</span>
            <h4>{leadPreview.quote_draft.title}</h4>
            <StatusLine label="Range" value={leadPreview.recommended_price_range} />
            <StatusLine label="Timeline" value={leadPreview.delivery_timeline} />
            <p>{leadPreview.quote_draft.summary}</p>
            <small>{leadPreview.payment_terms_note}</small>
            <ul>
              {leadPreview.quote_draft.line_items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <small>Upsells: {leadPreview.upsell_options.join(", ") || "None"}</small>
          </article>
          <article className="operator-result-card">
            <span className="eyebrow">Task draft</span>
            <h4>{leadPreview.task_draft.title}</h4>
            <StatusLine label="Priority" value={leadPreview.task_draft.priority} />
            <StatusLine label="Suggested due" value={leadPreview.task_draft.suggested_due} />
            <ul>
              {leadPreview.task_draft.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ul>
          </article>
          <article className="operator-result-card">
            <span className="eyebrow">Deliverables</span>
            <ul>
              {leadPreview.deliverables_checklist.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
          <article className="operator-result-card">
            <span className="eyebrow">Follow-up draft</span>
            <StatusLine label="Channel" value={leadPreview.follow_up_draft.channel_hint} />
            <h4>{leadPreview.follow_up_draft.subject}</h4>
            <p className="draft-copy">{leadPreview.follow_up_draft.body}</p>
          </article>
          <article className="operator-result-card">
            <span className="eyebrow">Approval preview</span>
            <StatusLine label="Status" value={leadPreview.approval_preview.status} />
            <StatusLine label="Risk" value={leadPreview.approval_preview.risk_level} />
            <StatusLine
              label="Execution disabled"
              value={leadPreview.approval_preview.execution_disabled ? "true" : "false"}
            />
            <p>{leadPreview.approval_preview.summary}</p>
          </article>
          <article className="operator-result-card safety-output-card">
            <span className="eyebrow">Safety flags</span>
            {safetyRows.map(([label, value]) => (
              <StatusLine key={String(label)} label={String(label)} value={value ? "true" : "false"} />
            ))}
          </article>
        </div>
      ) : null}
    </section>
  );
}

function VideoEngineAddonCard() {
  return (
    <section className="module-panel simulation-section phantomcut-card">
      <div className="simulation-section-head">
        <span>
          <Play size={18} />
        </span>
        <div>
          <span className="eyebrow">Video capability</span>
          <h3>Controlled creative generation</h3>
        </div>
      </div>
      <p>{businessOpsSimulation.phantomCut.detail}</p>
      <div className="module-list">
        <span>optional</span>
        <span>not core app</span>
        <span>{businessOpsSimulation.phantomCut.status}</span>
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
        detail="Switch to All results to see the full local result list."
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
            Confirm
          </button>
          <button type="button" className="reject" onClick={() => rejectAction(approval.id)}>
            <X size={16} />
            Skip
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
