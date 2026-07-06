import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bell,
  Bot,
  CalendarDays,
  Check,
  Clock3,
  Copy,
  Download,
  FileText,
  Inbox,
  KeyRound,
  Link2,
  Lock,
  Mail,
  MessageSquare,
  MoreHorizontal,
  Play,
  Plus,
  RefreshCcw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  SquareCheckBig,
  Star,
  ToggleLeft,
  UserRound,
  Users,
  X,
  Zap,
} from "lucide-react";
import { ChangeEvent, CSSProperties, FormEvent, MouseEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  phantomWidgetRegistry,
  type PhantomWidgetDefinition,
  type PhantomWidgetTarget,
} from "./phantomWidgetRegistry";

type Route =
  | "command"
  | "agents"
  | "inbox"
  | "calendar"
  | "tasks"
  | "content"
  | "media"
  | "security"
  | "site"
  | "offers"
  | "approvals"
  | "access"
  | "activity"
  | "connections";
type ApprovalKind = "email" | "calendar" | "task" | "review_request" | "website_review" | "video_generation";
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

type ReviewClientStatus = "ready" | "request_queued" | "request_approved" | "review_received" | "website_ready";

type ReviewClient = {
  id: string;
  business: string;
  contact: string;
  service: string;
  lastWorked: string;
  result: string;
  channel: "email" | "text" | "manual";
  status: ReviewClientStatus;
  reviewLink: string;
  draftMessage: string;
  submittedReview?: {
    rating: string;
    quote: string;
    author: string;
  };
};

type WebsiteReview = {
  id: string;
  business: string;
  author: string;
  quote: string;
  rating: string;
  service: string;
  approvedAt: string;
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
  missionId?: string;
  missionTitle?: string;
  producedAt?: string;
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

type DeploymentModelStatus = {
  audience: "admin" | "client";
  model: "cloud_app_with_optional_local_connector";
  user_facing_product: "PhantomForce";
  user_facing_ai: "PhantomAI";
  public_app_url: string;
  normal_user_surface: "hosted_web_app";
  desktop_companion_role: "optional_local_connector";
  source_code_exposed_to_users: boolean;
  repo_access_required_for_users: boolean;
  users_can_modify_product_files: boolean;
  customer_traffic_should_route_through_jordan_pc: boolean;
  current_jordan_windows_host_role: "admin_pilot_and_private_connector_only";
  internal_tool_names_hidden_from_clients: boolean;
  privacy_posture: string;
  recommended_architecture?: string;
  commercial_posture?: "cloud_ready" | "pilot_needs_cloud_hardening";
  production_cloud_ready?: boolean;
  tenant_isolation_ready?: boolean;
  license_gate_ready?: boolean;
  signed_desktop_companion_ready?: boolean;
  local_connector_enabled?: boolean;
  client_copy_resistance?: string[];
  admin_operating_rules?: string[];
  local_connector: {
    enabled?: boolean;
    available?: boolean;
    status?: string;
    recommended_transport?: string;
    customer_owned: boolean;
    outbound_only?: boolean;
    stores_customer_files_locally?: boolean;
    raw_files_uploaded_by_default: boolean;
    source_code_shipped?: boolean;
    role?: string;
    purpose?: string;
    production_requirements?: string[];
  };
  safety_flags?: {
    read_only_status: boolean;
    provider_called: boolean;
    external_network_call_performed: boolean;
    deployment_changed: boolean;
    credential_read: boolean;
    customer_data_mutated: boolean;
  };
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
  deployment_model?: DeploymentModelStatus;
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

type AgentWorkerMetric = {
  id: string;
  name: string;
  role: string;
  tool_binding: string;
  state: string;
  focus: string;
  tasks_last_1h: number;
  tasks_last_24h: number;
  tasks_last_7d: number;
  tokens_last_24h: number;
  estimated_cost_usd_last_24h: number;
  last_run_at: string | null;
  data_source: string;
};

type AgentSubagentMetric = {
  id: string;
  name: string;
  parent: string;
  specialty: string;
  state: string;
  tasks_last_24h: number;
  tokens_last_24h: number;
};

type AgentToolStackItem = {
  id: string;
  display_name: string;
  intended_role: string;
  allowed_mode: string;
  state: string;
  blocked_actions_count: number;
  next_phase: string;
};

type AgentAssignment = {
  id: string;
  owner: string;
  title: string;
  detail: string;
  status: "ready" | "watching" | "blocked" | "drafting";
  action_label: string;
  destination_route: Route;
  guardrail: string;
};

type AgentProgramUse = AgentToolStackItem & {
  manager_agent: string;
  current_use: string;
  action_id: string;
  action_label: string;
  destination_route: Route;
  commercial_visible: boolean;
};

type AgentActionResult = {
  ok: boolean;
  action_id?: string;
  label?: string;
  worker?: string;
  program?: string;
  status?: string;
  result_type?: string;
  output?: unknown;
  stderr?: string;
  safety_flags?: Record<string, boolean>;
  error?: unknown;
};

type AgentTickerItem = {
  id: string;
  label: string;
  text: string;
  timestamp: string;
};

type AgentPulseEvent = {
  id: string;
  agent: string;
  role: string;
  action: string;
  source: string;
  time: string;
  tone: "good" | "watch" | "warn" | "blocked";
  workspace: PhantomDeckWorkspaceId;
};

type AgentClientSummary = {
  visible_to_client?: boolean;
  active_agent_count: number;
  total_agent_count: number;
  status: string;
  label: string;
};

type AdminAgentWorkforceStatus = {
  ok: true;
  role: "admin";
  summary: {
    window_hours: number;
    generated_at: string;
    ledger_exists: boolean;
    ledger_bytes: number;
    tasks_in_window: number;
    tokens_in_window: number;
    estimated_cost_usd_in_window: number;
    active_workers: number;
    total_workers: number;
    subagents_mapped: number;
    n8n_scaffolded: boolean;
    n8n_running: boolean;
    tool_registry_loaded: boolean;
    tool_count: number;
  };
  client_summary: AgentClientSummary;
  workers: AgentWorkerMetric[];
  subagents: AgentSubagentMetric[];
  tool_stack: AgentToolStackItem[];
  assignments: AgentAssignment[];
  programs: AgentProgramUse[];
  ticker: AgentTickerItem[];
  n8n: {
    status: string;
    execution_disabled: boolean;
    would_run: boolean;
    local_url: string;
    scaffolded: boolean;
    running: boolean;
    workflow_drafts: Array<{
      id: string;
      exists: boolean;
      active: boolean;
    }>;
  };
  safety_flags: {
    read_only: true;
    provider_called: false;
    external_call_performed: false;
    n8n_started: false;
    workflow_executed: false;
    approval_executed: false;
    queue_written: false;
    production_ledger_written: false;
  };
};

type ClientAgentWorkforceStatus = {
  ok: true;
  role: "client";
  summary: AgentClientSummary;
  details_redacted: true;
  token_usage_visible: false;
  tool_stack_visible: false;
};

type AgentWorkforceStatus = AdminAgentWorkforceStatus | ClientAgentWorkforceStatus;

type MissionBundle = {
  id: string;
  command: string;
  aliases: string[];
  title: string;
  short: string;
  deliverable: string;
  proof: string;
  nextAction: string;
  prompt: string;
  sample: string;
  route: Route;
  cta: string;
  crew: string[];
};

type OwnerQuickTool = {
  id: string;
  title: string;
  lane: string;
  description: string;
  status: string;
  cta: string;
  command: string;
  route: Route;
  proof: string;
  taskTitle: string;
  taskDue: string;
  bullets: string[];
  openUrl?: string;
};

type PhantomDeckWorkspaceId =
  | "status"
  | "leads"
  | "proposal"
  | "followup"
  | "work"
  | "money"
  | "video"
  | "protect"
  | "review"
  | "site"
  | "brain"
  | "access"
  | "agentlab"
  | "n8n"
  | "help";
type PhantomDeckMood = "calm" | "alert" | "thinking" | "blocked";
type PhantomDeckPulseTone = "good" | "warn" | "alert" | "muted";
type PhantomWidgetView = PhantomWidgetDefinition & {
  emphasis?: boolean;
  safetyNote?: string;
};
type PhantomBrainNodeStatus =
  | "active"
  | "ready"
  | "gated"
  | "manual"
  | "planned"
  | "disabled"
  | "needs_review"
  | "blocked";
type PhantomBrainNodeCategory = "core" | "business" | "create" | "safety" | "systems";

type PhantomBrainNode = {
  id: string;
  label: string;
  detail: string;
  value: string;
  status: PhantomBrainNodeStatus;
  category: PhantomBrainNodeCategory;
  x: number;
  y: number;
  workspace: PhantomDeckWorkspaceId;
  adminOnly?: boolean;
  speech?: string;
  safety?: string;
  inside?: Array<{ label: string; state: string }>;
  icon: ReactNode;
};

type PhantomBrainEdgeState = "live" | "ready" | "gated" | "planned" | "blocked";

type PhantomBrainEdge = {
  id: string;
  from: string;
  to: string;
  state: PhantomBrainEdgeState;
  label?: string;
};

type PhantomDeckSalesConnectorStatus = {
  display_name?: string;
  enabled?: boolean;
  live?: boolean;
  status?: string;
  onboarding_state?: string;
  external_send?: boolean;
  reason?: string;
};

type PhantomDeckToolLanePreview = {
  execution_disabled?: boolean;
  would_run?: boolean;
  n8n_scaffolded?: boolean;
  n8n_running?: boolean;
  n8n_local_url?: string;
  preview?: {
    status?: string;
    allowed_mode?: string | null;
    reason?: string;
    blocked_actions?: string[];
  };
};

type PhantomDeckOpsContext = {
  role?: "admin" | "standard";
  redacted_for_role?: boolean;
  current_module?: string;
  assistant?: {
    mode_label?: string;
    external_sends?: string;
  };
  chicagoshots?: {
    proposal_history?: {
      enabled?: boolean;
      exists?: boolean;
      record_count?: number;
    };
  } | null;
  memory?: {
    has_memory?: boolean;
    recalled_count?: number;
    compact_memory?: string;
  } | null;
  provider?: {
    glm_status?: string;
    glm_live_call_ready?: boolean;
    glm_configured?: boolean;
  } | null;
  tool_lane?: {
    status?: string;
    execution_disabled?: boolean;
    n8n_running?: boolean;
    n8n_local_url?: string | null;
  } | null;
};

type StorefrontDraft = {
  name: string;
  headline: string;
  product: string;
  price: string;
  description: string;
  fulfillment: string;
  checkoutNote: string;
  cta: string;
};

const adminMissionBundles: MissionBundle[] = [
  {
    id: "help",
    command: "/help",
    aliases: ["/commands"],
    title: "Show mission menu",
    short: "List the admin mission shortcuts.",
    deliverable: "Mission menu",
    proof: "Active workspace mission catalog",
    nextAction: "Choose the mission that matches the business outcome.",
    prompt: "Show Jordan the available PhantomAI mission bundles and explain when to use each one.",
    sample: "/help",
    route: "command",
    cta: "Show menu",
    crew: ["router", "memory"],
  },
  {
    id: "sprint",
    command: "/sprint",
    aliases: ["/launch", "/client"],
    title: "Launch a client sprint",
    short: "Scope, price, plan, proof, and next action.",
    deliverable: "Client sprint package",
    proof: "Lead context, offer ladder, proof assets, and risk notes",
    nextAction: "Review the package and decide whether it becomes Starter, Core, or Pro.",
    prompt:
      "Build a client sprint package. Return the target buyer, pain, package recommendation, deliverables, proof to show, first message, follow-up step, and risk notes.",
    sample: "/sprint for a sports trainer who needs booking, content, and follow-ups",
    route: "offers",
    cta: "Build sprint",
    crew: ["planner", "standards guard", "proposal drafter", "memory"],
  },
  {
    id: "followup",
    command: "/followup",
    aliases: ["/reply", "/lead"],
    title: "Handle a lead",
    short: "Draft reply, booking path, and review card.",
    deliverable: "Lead follow-up packet",
    proof: "Inbox context, lead status, booking path, and approval queue",
    nextAction: "Review the reply and approve, edit, or hold it.",
    prompt:
      "Handle the next lead. Identify the best reply, the booking path, the service angle, and the approval card needed before any external action.",
    sample: "/followup the warmest lead and prepare the next message",
    route: "inbox",
    cta: "Handle lead",
    crew: ["lead finder", "reply drafter", "booking planner", "approval guard"],
  },
  {
    id: "quote",
    command: "/quote",
    aliases: ["/price", "/proposal"],
    title: "Build a quote",
    short: "Pick Starter, Core, or Pro and write the pitch.",
    deliverable: "Quote recommendation",
    proof: "Offer ladder, buyer need, pricing fit, and fallback option",
    nextAction: "Pick the package and mark it ready for manual send.",
    prompt:
      "Create a quote recommendation. Choose $750 Starter, $1,500 Core, or $2,500 Pro, explain why, write a short pitch, and include a fallback option.",
    sample: "/quote for a small business owner who needs website cleanup and follow-up system",
    route: "offers",
    cta: "Price it",
    crew: ["offer strategist", "proposal drafter", "risk checker", "memory"],
  },
  {
    id: "book",
    command: "/book",
    aliases: ["/schedule", "/call"],
    title: "Book the call",
    short: "Agenda, time windows, prep, and approval gate.",
    deliverable: "Booking plan",
    proof: "Calendar context, suggested windows, agenda, and approval rules",
    nextAction: "Choose a time window before any calendar action.",
    prompt:
      "Create a booking workflow. Return two safe time-window suggestions, a 15-minute agenda, what to ask, what to send afterward, and what needs approval.",
    sample: "/book a 15-minute setup call for the next interested prospect",
    route: "calendar",
    cta: "Plan call",
    crew: ["scheduler", "agenda builder", "approval guard", "memory"],
  },
  {
    id: "site",
    command: "/site",
    aliases: ["/website", "/page"],
    title: "Upgrade the site",
    short: "Copy, sections, preview plan, and scanner pass.",
    deliverable: "Website improvement plan",
    proof: "Current page context, copy goals, scanner checklist, and safe preview path",
    nextAction: "Open Site Studio and approve the first page change.",
    prompt:
      "Plan a private website improvement. Return the page goal, copy changes, section order, proof needed, safe preview route, and scanner checklist before anything goes live.",
    sample: "/site make the homepage more direct and sales-ready",
    route: "site",
    cta: "Plan site",
    crew: ["site editor", "code mapper", "scanner", "approval guard"],
  },
  {
    id: "store",
    command: "/store",
    aliases: ["/shop", "/checkout"],
    title: "Build a store page",
    short: "Offer, price, product copy, scanner check, and review card.",
    deliverable: "Storefront plan",
    proof: "Offer, price, product copy, checkout risk notes, and scanner checklist",
    nextAction: "Review the store page before any payment link goes live.",
    prompt:
      "Build a storefront package. Return the offer, price, product copy, proof points, checkout risk notes, scanner checklist, and approval step before any payment link goes live.",
    sample: "/store build a checkout-ready page for the Core Sprint",
    route: "site",
    cta: "Build store",
    crew: ["offer strategist", "site editor", "scanner", "approval guard"],
  },
  {
    id: "media",
    command: "/media",
    aliases: ["/video", "/content"],
    title: "Create a media asset",
    short: "Content angle, video brief, caption, and proof.",
    deliverable: "Media asset brief",
    proof: "Creative angle, shot list, proof source, and brand-safe language",
    nextAction: "Review the creative direction before generation or publishing.",
    prompt:
      "Build a media package. Return the creative angle, video concept, caption, shot list, proof source, brand-safe language, and next approval step.",
    sample: "/video make a private sports business promo concept",
    route: "media",
    cta: "Build media",
    crew: ["creative director", "proof checker", "media lab", "approval guard"],
  },
  {
    id: "scan",
    command: "/scan",
    aliases: ["/audit", "/security"],
    title: "Inspect risk",
    short: "Scan copy, files, secrets, scripts, and launch risk.",
    deliverable: "Risk summary",
    proof: "Security scan targets, launch assumptions, blocked actions, and missing proof",
    nextAction: "Fix the highest-risk item or mark it accepted.",
    prompt:
      "Run a risk review plan. Summarize what to inspect, what is safe, what is blocked, what proof is missing, and the next safest action. Do not expose secrets.",
    sample: "/scan the dashboard before I show it to someone",
    route: "security",
    cta: "Inspect",
    crew: ["scanner", "standards guard", "route checker", "memory"],
  },
  {
    id: "agents",
    command: "/agents",
    aliases: ["/workforce", "/crew"],
    title: "Manage workforce",
    short: "Show who is working and what bundles are ready.",
    deliverable: "Workforce signal map",
    proof: "Agent status, token/task telemetry, safe bundles, and blocked lanes",
    nextAction: "Assign the next mission to the correct crew.",
    prompt:
      "Summarize the current PhantomForce workforce as business outcomes: who is working, what they are handling, what is blocked, and what Jordan should assign next.",
    sample: "/agents show what my workforce should do next",
    route: "agents",
    cta: "Manage",
    crew: ["operator", "memory", "automation watcher", "scanner"],
  },
];

const obsidianQuickCaptureContent = encodeURIComponent(
  [
    "# PhantomForce Quick Capture",
    "",
    "## Outcome",
    "What are we trying to move?",
    "",
    "## Source",
    "- Admin route: admin.phantomforce.online",
    "- Local route: http://127.0.0.1:5177",
    "",
    "## Decision",
    "- Owner: Jordan",
    "- Next approval:",
  ].join("\n"),
);

const ownerQuickTools: OwnerQuickTool[] = [
  {
    id: "agent-loop",
    title: "Agent Loop Launcher",
    lane: "Claude + Codex",
    description: "Start a bounded worker loop, then bring the result back through Codex review.",
    status: "armed",
    cta: "Launch",
    route: "agents",
    proof: "Loop prompt, Codex verification, Obsidian receipt",
    taskTitle: "Run the next bounded PhantomForce agent loop",
    taskDue: "Today",
    bullets: ["Claude loop", "Codex verify", "Receipt"],
    command:
      "/agents run a bounded Claude Code plus Codex loop for the highest-leverage PhantomForce task. Inspect, implement, verify, write an Obsidian receipt, and stop on real blockers.",
  },
  {
    id: "obsidian-capture",
    title: "Obsidian Capture",
    lane: "Operating Brain",
    description: "Open the central vault and log the mission, decisions, proof, and next action.",
    status: "vault linked",
    cta: "Capture",
    route: "agents",
    proof: "PhantomForce Command Center vault note",
    taskTitle: "Capture today's operating state in Obsidian",
    taskDue: "Today",
    bullets: ["Vault", "Registry", "Receipts"],
    openUrl: `obsidian://new?vault=PhantomForce-Command-Center&file=00%20Inbox/PhantomForce%20Quick%20Capture&content=${obsidianQuickCaptureContent}`,
    command:
      "/agents capture the current PhantomForce mission into Obsidian with objective, files, decisions, proof, risks, and next action.",
  },
  {
    id: "higgsfield-factory",
    title: "PhantomCut Production",
    lane: "Media",
    description: "Build fresh ad/video briefs through PhantomCut with Higgsfield credit tracking and no recycled-looking assets.",
    status: "credit aware",
    cta: "Brief",
    route: "media",
    proof: "Credits before/after, prompt, references, output path",
    taskTitle: "Prepare the next Higgsfield production brief",
    taskDue: "Before generation",
    bullets: ["Credit count", "Fresh shots", "No fake text"],
    command:
      "/media build a Higgsfield production brief that reports credits before and after, uses fresh scenes only, avoids generated on-screen text, and returns asset IDs and file paths.",
  },
  {
    id: "security-intake",
    title: "Security Intake",
    lane: "Risk",
    description: "Scope malware, phishing, leaked-password, and account-abuse checks defensively.",
    status: "scoped",
    cta: "Inspect",
    route: "security",
    proof: "Authorized scope, evidence, risk level, fix, verification",
    taskTitle: "Run authorized security intake for business-owned systems",
    taskDue: "Before scan",
    bullets: ["Owned assets", "No secrets", "Evidence"],
    command:
      "/scan create an authorized defensive security intake for business-owned systems covering malware, phishing, password exposure, account abuse, evidence, risk level, fix, and verification. Do not expose secrets.",
  },
  {
    id: "revenue-sprint",
    title: "Revenue Sprint",
    lane: "Sales",
    description: "Turn leads, reviews, offers, and calendar openings into a 7-day sales sprint.",
    status: "operator ready",
    cta: "Sprint",
    route: "offers",
    proof: "Priority leads, offer angle, copy, call blocks, approvals",
    taskTitle: "Build this week's PhantomForce revenue sprint",
    taskDue: "Today",
    bullets: ["7 days", "Offer angle", "Follow-ups"],
    command:
      "/sprint build a 7-day PhantomForce revenue sprint using current leads, review proof, calendar openings, offers, follow-up copy, and approval gates.",
  },
  {
    id: "ai-route-health",
    title: "AI Route Health",
    lane: "Infrastructure",
    description: "Check the public AI health route before wiring it into customer-facing flows.",
    status: "public check",
    cta: "Check",
    route: "agents",
    proof: "DNS, Pangolin route, proxy, provider key, fallback",
    taskTitle: "Verify ai.phantomforce.online public health",
    taskDue: "Now",
    bullets: ["DNS", "Pangolin", "Proxy"],
    openUrl: "https://ai.phantomforce.online/health",
    command:
      '/agents verify the AI route health for https://ai.phantomforce.online/health. Healthy is {"ok":true,"configured":true}. If unhealthy, check DNS, Pangolin route, proxy, provider key, and homepage fallback.',
  },
  {
    id: "repo-scan",
    title: "Repo Intelligence",
    lane: "Code",
    description: "Scan local code drift, risky strings, TODOs, and build readiness before deploy.",
    status: "safe scan",
    cta: "Scan",
    route: "security",
    proof: "Git status, risky-string search, typecheck result",
    taskTitle: "Run PhantomForce repo intelligence scan",
    taskDue: "Before deploy",
    bullets: ["No destructive ops", "Secrets check", "Build signal"],
    command:
      "/scan plan a safe PhantomForce repo intelligence scan: git status, TODO/FIXME/risky-string search excluding node_modules/dist/.git, typecheck, and highest-risk findings. Do not print secrets.",
  },
  {
    id: "automation-runbook",
    title: "Runbook Forge",
    lane: "Automation",
    description: "Convert a business process into triggers, approvals, logs, failures, and rollback.",
    status: "template",
    cta: "Forge",
    route: "agents",
    proof: "Trigger map, approval gates, audit log, rollback plan",
    taskTitle: "Write an automation runbook for the next workflow",
    taskDue: "This week",
    bullets: ["Triggers", "Approvals", "Rollback"],
    command:
      "/agents forge an automation runbook for the next PhantomForce workflow with trigger, inputs, actions, approval gates, failure states, audit log, rollback, owner, and review date.",
  },
];

function resolveMissionBundle(text: string) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;
  const [token = ""] = trimmed.split(/\s+/, 1);
  const bundle = adminMissionBundles.find((item) => item.command === token || item.aliases.includes(token));
  if (!bundle) return null;
  return {
    bundle,
    subject: trimmed.slice(token.length).trim(),
  };
}

function buildMissionPrompt(bundle: MissionBundle, subject: string) {
  const focus = subject || bundle.sample.replace(bundle.command, "").trim() || "the current workspace priority";
  return [
    `Run the "${bundle.title}" PhantomForce mission for: ${focus}`,
    bundle.prompt,
    `Coordinate the internal workforce together: ${bundle.crew.join(", ")}.`,
    "Do not expose raw tool names as the product. Speak in business outcomes, artifacts, and next actions.",
    "If the work would send, post, upload, book, bill, deploy, delete, change credentials, or mutate production, prepare an approval-ready draft instead of executing it.",
  ].join("\n");
}

function buildQuickToolHandoff(tool: OwnerQuickTool) {
  return [
    `# ${tool.title}`,
    "",
    `Lane: ${tool.lane}`,
    `Status: ${tool.status}`,
    `Proof: ${tool.proof}`,
    "",
    "Checks:",
    ...tool.bullets.map((bullet) => `- ${bullet}`),
    "",
    "Mission shortcut:",
    tool.command,
  ].join("\n");
}

async function copyPlainText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.opacity = "0";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textArea);
    return copied;
  }
}

function requestsExternalAction(text: string) {
  const lower = text.toLowerCase();

  return (
    /\b(send|email|dm|text|post|upload)\b.*\b(to|them|client|lead|prospect|gmail|instagram|facebook|youtube)\b/.test(
      lower,
    ) ||
    lower.includes("send it") ||
    lower.includes("send this") ||
    lower.includes("create calendar") ||
    lower.includes("put it on my calendar") ||
    lower.includes("handle the follow-up") ||
    /\b(schedule|book)\b.*\b(call|meeting|appointment|calendar)\b/.test(lower)
  );
}

function missionHelpText() {
  return adminMissionBundles
    .filter((bundle) => bundle.id !== "help")
    .map((bundle) => `${bundle.command} - ${bundle.title}: ${bundle.short}`)
    .join("\n");
}

function titleCaseWords(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function buildArtifactPreview(message: Message | undefined, bundle: MissionBundle | undefined, pendingApprovals: number) {
  const body = message?.content.trim() || "";

  return {
    deliverable: bundle?.deliverable ?? "PhantomForce artifact",
    proof: bundle?.proof ?? "Workspace context",
    nextAction: bundle?.nextAction ?? "Choose a mission and describe the outcome.",
    approval: pendingApprovals > 0 ? `${pendingApprovals} item(s) waiting in Review` : "No approval needed yet",
    body,
  };
}

function capabilityOutcomeLabel(binding: string) {
  const labels: Record<string, string> = {
    dashboard_chat_and_router: "Operator brain",
    hermes_ledger_context_memory: "Memory and receipts",
    codex_local_operator_lane: "Build and fix desk",
    claude_cli_lane: "Second-opinion desk",
    pangolin_access_state: "Access and security guard",
    chicagoshots_pipeline: "Lead and proposal desk",
    phantomcut_media_lab: "Media studio",
    local_security_scanner: "Risk and safety check",
    n8n_local_workflow_layer: "Automation runner",
  };
  return labels[binding] ?? titleCaseWords(binding.replace(/_/g, " "));
}

function workerActivityLabel(worker: AgentWorkerMetric) {
  const hasActivity =
    worker.tasks_last_1h > 0 ||
    worker.tasks_last_24h > 0 ||
    worker.tokens_last_24h > 0 ||
    worker.estimated_cost_usd_last_24h > 0;

  if (!hasActivity) return "Idle - ready";

  return `${worker.tasks_last_1h} in 1h - ${worker.tasks_last_24h} in 24h - ${formatNumber(
    worker.tokens_last_24h,
  )} tokens`;
}

function missionBundleIcon(id: string) {
  if (id === "sprint" || id === "quote") return <Zap size={18} />;
  if (id === "followup") return <Mail size={18} />;
  if (id === "book") return <CalendarDays size={18} />;
  if (id === "store") return <ShoppingCart size={18} />;
  if (id === "site") return <FileText size={18} />;
  if (id === "media") return <Play size={18} />;
  if (id === "scan") return <Search size={18} />;
  if (id === "agents") return <Users size={18} />;
  return <Sparkles size={18} />;
}

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

type SubscriptionStatus = {
  plan: string;
  canView: boolean;
  canWrite: boolean;
  reason: string;
};

const AUTHORIZATION_HEADER = "Authorization";
const OWNER_ORG_NAME = "PhantomForce";
const DEFAULT_CLIENT_WORKSPACE_ID = "client-chicagoshots";
const ACCOUNT_RENEWAL_LABEL = "August 4, 2026";
const CORE_ORGANIZATION_CLIENT_IDS = new Set(["client-chicagoshots", "client-sports-demo"]);
const ADMIN_ONLY_ROUTES = new Set<Route>(["agents", "site", "access", "connections"]);
// The essentials pinned in the mobile bottom bar; everything else goes under "More".
const CORE_MOBILE_ROUTES = new Set<Route>(["command", "approvals", "access"]);

const initialSessions: AppSession[] = [
  {
    id: "owner-admin",
    label: "PhantomForce Owner",
    role: "admin",
    canManageAccess: true,
  },
  {
    id: "client-sports-demo",
    label: "Test Employee",
    role: "client",
    clientId: "client-sports-demo",
    canManageAccess: false,
  },
];

// Three simple tabs. The Focus route is the chat+assistants+preview
// home that absorbs the old Home/Agents/Site/Leads/Money/Create/Video/Scanner/
// Bookings/Work screens; those views still render when an assistant opens its
// full surface, they are just no longer separate nav destinations.
const navItems: Array<{ id: Route; label: string; icon: ReactNode }> = [
  { id: "command", label: "Focus", icon: <Sparkles size={18} /> },
  { id: "approvals", label: "Review", icon: <ShieldCheck size={18} /> },
  { id: "access", label: "Access", icon: <KeyRound size={18} /> },
];

const validRouteIds = new Set<Route>([
  ...navItems.map((item) => item.id),
  "agents",
  "inbox",
  "calendar",
  "tasks",
  "content",
  "media",
  "security",
  "site",
  "offers",
  "activity",
  "connections",
]);

const phantomDeckWorkspaces: Array<{
  id: PhantomDeckWorkspaceId;
  label: string;
  command: string;
  detail: string;
  icon: ReactNode;
  route?: Route;
}> = [
  {
    id: "status",
    label: "Status",
    command: "status",
    detail: "Live internal posture",
    icon: <Sparkles size={18} />,
  },
  {
    id: "leads",
    label: "Leads",
    command: "leads",
    detail: "Recent packets and next actions",
    icon: <Inbox size={18} />,
  },
  {
    id: "proposal",
    label: "Proposal",
    command: "proposal",
    detail: "ChicagoShots quote builder",
    icon: <FileText size={18} />,
  },
  {
    id: "followup",
    label: "Follow-ups",
    command: "follow up",
    detail: "Manual-send priorities",
    icon: <MessageSquare size={18} />,
  },
  {
    id: "work",
    label: "Work",
    command: "work",
    detail: "Tasks, bookings, schedule",
    icon: <SquareCheckBig size={18} />,
    route: "tasks",
  },
  {
    id: "money",
    label: "Money",
    command: "money",
    detail: "Proposal value and wins",
    icon: <BarChart3 size={18} />,
    route: "offers",
  },
  {
    id: "video",
    label: "Video",
    command: "video",
    detail: "PhantomCut and Media Lab",
    icon: <Play size={18} />,
    route: "media",
  },
  {
    id: "protect",
    label: "Protect",
    command: "protect",
    detail: "Scanner and send posture",
    icon: <ShieldCheck size={18} />,
    route: "security",
  },
  {
    id: "review",
    label: "Review",
    command: "review",
    detail: "Approvals and human checks",
    icon: <Bell size={18} />,
    route: "approvals",
  },
  {
    id: "site",
    label: "Site Studio",
    command: "site",
    detail: "Website, app, and store builder",
    icon: <Link2 size={18} />,
    route: "site",
  },
  {
    id: "brain",
    label: "Brain",
    command: "brain",
    detail: "Hermes memory and model posture",
    icon: <Sparkles size={18} />,
    route: "connections",
  },
  {
    id: "access",
    label: "Access",
    command: "clients",
    detail: "Admin and employee permissions",
    icon: <Users size={18} />,
    route: "access",
  },
  {
    id: "agentlab",
    label: "AgentLab",
    command: "agentlab",
    detail: "Internal workforce",
    icon: <Bot size={18} />,
    route: "agents",
  },
  {
    id: "n8n",
    label: "Automation",
    command: "automation",
    detail: "Workflow drafts and worker posture",
    icon: <Settings size={18} />,
    route: "connections",
  },
  {
    id: "help",
    label: "Help",
    command: "help",
    detail: "Signal map",
    icon: <Sparkles size={18} />,
  },
];

const phantomToolGroups: Array<{
  id: "business" | "create" | "safety" | "systems";
  label: string;
  items: PhantomDeckWorkspaceId[];
}> = [
  { id: "business", label: "Business", items: ["leads", "proposal", "followup", "work", "money"] },
  { id: "create", label: "Create", items: ["video", "site"] },
  { id: "safety", label: "Safety", items: ["protect", "review", "access"] },
  { id: "systems", label: "Systems", items: ["brain", "n8n", "agentlab", "status"] },
];

const ADMIN_ONLY_DECK_WORKSPACES = new Set<PhantomDeckWorkspaceId>(["brain", "access", "agentlab", "n8n"]);

function canOpenPhantomDeckWorkspace(workspace: PhantomDeckWorkspaceId, canManageAccess: boolean) {
  return canManageAccess || !ADMIN_ONLY_DECK_WORKSPACES.has(workspace);
}

function getVisiblePhantomDeckWorkspaces(canManageAccess: boolean) {
  return phantomDeckWorkspaces.filter((workspace) => canOpenPhantomDeckWorkspace(workspace.id, canManageAccess));
}

function resolvePhantomDeckWorkspace(value: string, canManageAccess = true): PhantomDeckWorkspaceId | null {
  const text = value.trim().toLowerCase();
  const allow = (workspace: PhantomDeckWorkspaceId) =>
    canOpenPhantomDeckWorkspace(workspace, canManageAccess) ? workspace : "status";

  if (!text) return null;
  if (/\b(help|commands?|what can|menu)\b/.test(text)) return "help";
  if (/\b(all tools|tools?|orbit|harbor|launcher|modules?)\b/.test(text)) return "help";
  if (/\b(proposals?|quote|quote builder|build proposal|lead intake)\b/.test(text)) return allow("proposal");
  if (/\b(follow[-\s]?ups?|follow up|manual send|manual-send)\b/.test(text)) return allow("followup");
  if (/\b(leads?|pipeline|proposal packets?)\b/.test(text)) {
    return allow("leads");
  }
  if (/\b(work|tasks?|schedule|bookings?|calendar|today)\b/.test(text)) return allow("work");
  if (/\b(money|revenue|cash|won|lost|quote values?|sales)\b/.test(text)) return allow("money");
  if (/\b(video|phantomcut|media|higgsfield|reaper|resolve|clips?|creative generation)\b/.test(text)) return allow("video");
  if (/\b(protect|security|scanner|scan|medusa|robin|phishing|passwords?)\b/.test(text)) return allow("protect");
  if (/\b(review|approvals?|approve|drafts?|human)\b/.test(text)) return allow("review");
  if (/\b(site|website|web app|dashboard|codex|build lane|store|shop|checkout|storefront)\b/.test(text)) return allow("site");
  if (/\b(hermes|brain|memory|model|models?|companion|phantom ai|phantomai)\b/.test(text)) return allow("brain");
  if (/\b(access|clients?|users?|admin|login|permissions?|organization|organizations?)\b/.test(text)) return allow("access");
  if (/\b(agentlab|agent lab|agents?|workforce|crew|internal workers?)\b/.test(text)) return allow("agentlab");
  if (/\b(n8n|automation|workflow|tool lane|worker|systems?|orchestration)\b/.test(text)) return allow("n8n");
  if (/\b(status|health|systems?|ops|pulse)\b/.test(text)) return allow("status");

  return null;
}

function suggestPhantomDeckWorkspaces(value: string, canManageAccess = true): PhantomDeckWorkspaceId[] {
  const text = value.trim().toLowerCase();
  if (!text) return ["status", "work", "leads", "video"];

  const scored = getVisiblePhantomDeckWorkspaces(canManageAccess)
    .filter((workspace) => workspace.id !== "help")
    .map((workspace) => {
      const haystack = `${workspace.id} ${workspace.label} ${workspace.command} ${workspace.detail}`.toLowerCase();
      const score = text
        .split(/\s+/)
        .filter((term) => term.length > 2)
        .reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
      return { workspace: workspace.id, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.workspace);

  const fallback: PhantomDeckWorkspaceId[] = canManageAccess ? ["work", "site", "video", "brain"] : ["work", "site", "video", "review"];
  return (scored.length ? scored : fallback).slice(0, 4);
}

function phantomDeckWorkspaceLabel(id: PhantomDeckWorkspaceId) {
  return phantomDeckWorkspaces.find((workspace) => workspace.id === id)?.label ?? "Status";
}

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
    detail: "Developer tools, credentials, logs, and engine settings stay out of the employee workspace.",
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

const initialReviewClients: ReviewClient[] = [
  {
    id: "review-chicagoshots-media-day",
    business: "ChicagoShots media client",
    contact: "Past sports media client",
    service: "Media day / highlight delivery",
    lastWorked: "Recently completed",
    result: "Delivered short-form media assets and a clean delivery workflow.",
    channel: "manual",
    status: "ready",
    reviewLink: "app.phantomforce.online/review/chicagoshots-media-client",
    draftMessage:
      "Appreciate you working with us. Could you leave a quick review about the media day / highlight workflow? It helps other teams understand what the process feels like. Link: app.phantomforce.online/review/chicagoshots-media-client",
    submittedReview: {
      rating: "5",
      author: "Sports media client",
      quote:
        "The workflow made it simple to get organized media, clear next steps, and usable short-form content without chasing files.",
    },
  },
  {
    id: "review-ops-sprint",
    business: "Local service business",
    contact: "Past ops sprint contact",
    service: "Ops + Content Setup Sprint",
    lastWorked: "Past setup sprint",
    result: "Organized follow-ups, offer copy, and next-step workflow.",
    channel: "email",
    status: "ready",
    reviewLink: "app.phantomforce.online/review/local-service-ops-sprint",
    draftMessage:
      "Quick ask: would you leave a short review about the setup sprint and how it helped organize follow-ups, offers, and next steps? Link: app.phantomforce.online/review/local-service-ops-sprint",
    submittedReview: {
      rating: "5",
      author: "Local service owner",
      quote:
        "PhantomForce helped turn scattered follow-ups and offer ideas into a simple system we could actually act on.",
    },
  },
  {
    id: "review-coach-team",
    business: "Coach / team owner",
    contact: "Past team contact",
    service: "Sports content and parent-facing delivery plan",
    lastWorked: "Previous season",
    result: "Prepared a media package and delivery structure for team content.",
    channel: "text",
    status: "ready",
    reviewLink: "app.phantomforce.online/review/team-media-workflow",
    draftMessage:
      "Would you mind leaving a quick review about the team media workflow? A few lines about the communication, content, and delivery process would help. Link: app.phantomforce.online/review/team-media-workflow",
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
    description: "Future typed backend jobs. No raw job execution in the client app.",
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
    modules: ["Focus", "Content", "Tasks", "Approvals", "Activity"],
    lastAudit: "Access confirmed for partner workspace",
  },
  {
    id: "client-sports-demo",
    business: "Test Employee",
    owner: "Demo Employee",
    plan: "Employee workspace",
    paymentStatus: "paid",
    accessStatus: "active",
    gateway: "Pangolin",
    privateRoute: "app.phantomforce.online/test-client",
    modules: ["Focus", "Calendar", "Tasks", "Approvals", "Contacts", "Video"],
    lastAudit: "Deposit paid; workspace active",
  },
  {
    id: "client-past-due",
    business: "The Force",
    owner: "Org Owner",
    plan: "$1,250/mo Ops Support",
    paymentStatus: "failed",
    accessStatus: "revoked",
    gateway: "Pangolin",
    privateRoute: "app.phantomforce.online/the-force",
    modules: ["Focus", "Tasks", "Reports"],
    lastAudit: "Payment failed; private route revoked",
  },
];

function normalizeClientAccessRecord(record: ClientAccess): ClientAccess {
  if (record.id === "client-sports-demo") {
    return {
      ...record,
      business: "Test Employee",
      owner: record.owner === "Client Owner" || record.owner === "Sports Ops Demo Owner" ? "Demo Employee" : record.owner,
      plan: record.plan === "$2,000 Team Media Day" ? "Employee workspace" : record.plan,
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
  if (choice === "codex") return "Codex";
  if (choice === "glm_5_2") return "Local fallback";
  if (choice === "claude_cli") return "Second opinion";
  return "Auto";
}

function normalizePangolinRoutePlan(plan: PangolinRoutePlan): PangolinRoutePlan {
  if (plan.clientId === "client-sports-demo") {
    return {
      ...plan,
      business: "Test Employee",
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
  "AI Focus",
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
  "Focus",
  "Calendar",
  "Work",
  "Review",
  "Contacts",
  "Video",
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
    label: "Employee Mode",
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
    detail: "Lead intake, quote drafts, proposal packets, and local follow-up status are available inside Phantom.",
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
    mode: "Internal owner Phantom",
  },
  services: [
    {
      title: "$750 Starter Setup",
      detail: "Quick ops cleanup, offer clarity, follow-up drafts, and a simple action board.",
      status: "starter",
    },
    {
      title: "$1,500 Core Sprint",
      detail: "Operating brain setup, lead workflow, proposal/quote package, content plan, and delivery handoff.",
      status: "default",
    },
    {
      title: "$2,500 Pro Buildout",
      detail: "Messy workflow rescue with dashboard/app planning, automations, video support, and retainer path.",
      status: "pro",
    },
  ],
  leads: [
    { title: "Jordan Test Lead", detail: "Needs ChicagoShots sports media packet and follow-up timing.", status: "hot" },
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
    { title: "Client-safe dashboard mode", detail: "Developer and engine internals stay off normal Phantom surfaces.", status: "done" },
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
    { title: "Employee seats", detail: "Optional/future. Current workspaces focus on scoped employee actions.", status: "future" },
  ],
};

const ADMIN_PUBLIC_HOST = "admin.phantomforce.online";
const CLIENT_PUBLIC_HOST = "app.phantomforce.online";
const ADMIN_PUBLIC_URL = `https://${ADMIN_PUBLIC_HOST}`;
const CLIENT_PUBLIC_URL = `https://${CLIENT_PUBLIC_HOST}`;
const MONEY_DEMO_CLIENT_ID = "client-money-demo";

function currentPublicHost() {
  if (typeof window === "undefined") return "";
  return window.location.hostname.trim().toLowerCase();
}

function isAdminPublicHost() {
  const host = currentPublicHost();
  return host === ADMIN_PUBLIC_HOST;
}

function defaultApiBaseUrl() {
  const host = currentPublicHost();
  if (host === ADMIN_PUBLIC_HOST || host === CLIENT_PUBLIC_HOST) return "";
  return "http://127.0.0.1:5190";
}

const configuredApiBaseUrl = (import.meta as unknown as { env?: { VITE_API_BASE_URL?: string } }).env
  ?.VITE_API_BASE_URL;
const API_BASE_URL = configuredApiBaseUrl === undefined ? defaultApiBaseUrl() : configuredApiBaseUrl.replace(/\/$/, "");

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

const defaultDeploymentModelStatus: DeploymentModelStatus = {
  audience: "admin",
  model: "cloud_app_with_optional_local_connector",
  user_facing_product: "PhantomForce",
  user_facing_ai: "PhantomAI",
  public_app_url: CLIENT_PUBLIC_URL,
  normal_user_surface: "hosted_web_app",
  desktop_companion_role: "optional_local_connector",
  source_code_exposed_to_users: false,
  repo_access_required_for_users: false,
  users_can_modify_product_files: false,
  customer_traffic_should_route_through_jordan_pc: false,
  current_jordan_windows_host_role: "admin_pilot_and_private_connector_only",
  internal_tool_names_hidden_from_clients: true,
  privacy_posture:
    "Customers use the hosted app. Local files and machine actions stay on their own connector when installed.",
  recommended_architecture: "Cloud-first SaaS control plane plus optional customer-owned desktop connector.",
  commercial_posture: "pilot_needs_cloud_hardening",
  production_cloud_ready: false,
  tenant_isolation_ready: false,
  license_gate_ready: false,
  signed_desktop_companion_ready: false,
  local_connector_enabled: false,
  client_copy_resistance: [
    "Keep orchestration, billing, access control, and provider routing server-side.",
    "Ship no provider keys or source repositories to customers.",
    "Gate valuable capabilities by account, tenant, subscription, and license.",
  ],
  admin_operating_rules: [
    "Jordan's PC is the admin pilot/private connector, not the long-term customer hub.",
    "Every customer gets a tenant/workspace, not a source clone.",
    "Every local action is connector-scoped, outbound-only, and audited.",
  ],
  local_connector: {
    enabled: false,
    recommended_transport: "outbound_only",
    customer_owned: true,
    stores_customer_files_locally: true,
    raw_files_uploaded_by_default: false,
    source_code_shipped: false,
    role: "Desktop bridge for local files, scans, creative tools, and private machine actions.",
    production_requirements: [
      "signed installer",
      "per-tenant device registration",
      "license check",
      "revocation path",
      "audit receipts",
      "least-privilege action allowlist",
    ],
  },
  safety_flags: {
    read_only_status: true,
    provider_called: false,
    external_network_call_performed: false,
    deployment_changed: false,
    credential_read: false,
    customer_data_mutated: false,
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
  deployment_model: defaultDeploymentModelStatus,
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

const defaultAgentClientSummary: AgentClientSummary = {
  active_agent_count: 0,
  total_agent_count: 0,
  status: "standing_by",
  label: "Agent floor waiting on backend",
};

const defaultAgentWorkforceStatus: ClientAgentWorkforceStatus = {
  ok: true,
  role: "client",
  summary: defaultAgentClientSummary,
  details_redacted: true,
  token_usage_visible: false,
  tool_stack_visible: false,
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

function classSlug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(Math.max(0, Math.round(value)));
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value > 0 && value < 1 ? 4 : 2,
  }).format(Math.max(0, value));
}

function formatLastRun(value: string | null) {
  if (!value) return "No recorded run";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(parsed));
}

function formatAgentClock(value: Date | string | null) {
  const date = value instanceof Date ? value : value ? new Date(value) : new Date();
  if (!Number.isFinite(date.getTime())) return "time unknown";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function App() {
  const [route, setRoute] = useState<Route>("command");
  const [signedIn, setSignedIn] = useState(false);
  const [previewLinkApplied, setPreviewLinkApplied] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState("owner-admin");
  const [sessionToken, setSessionToken] = useState("");
  const [commandText, setCommandText] = useState("");
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [emails, setEmails] = useState(initialEmails);
  const [events, setEvents] = useState(initialEvents);
  const [tasks, setTasks] = useState(initialTasks);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [reviewClients, setReviewClients] = useState<ReviewClient[]>(initialReviewClients);
  const [websiteReviews, setWebsiteReviews] = useState<WebsiteReview[]>([]);
  const [activity, setActivity] = useState(initialActivity);
  const [clientAccess, setClientAccess] = useState(initialClientAccess.map(normalizeClientAccessRecord));
  const [guardedWorkspace, setGuardedWorkspace] = useState<GuardedWorkspace | null>(null);
  const [workspaceModuleView, setWorkspaceModuleView] = useState<WorkspaceModuleView | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionStatus | null>(null);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [pangolinPlan, setPangolinPlan] = useState<PangolinRoutePlan[]>([]);
  const [pangolinStatus, setPangolinStatus] = useState<PangolinReadOnlyStatus | null>(null);
  const [readinessReport, setReadinessReport] = useState<ProductionReadinessReport | null>(null);
  const [providerSetupStatus, setProviderSetupStatus] = useState<ProviderSetupStatus>(defaultProviderSetupStatus);
  const [deploymentModelStatus, setDeploymentModelStatus] =
    useState<DeploymentModelStatus>(defaultDeploymentModelStatus);
  const [phantomAiOpsStatus, setPhantomAiOpsStatus] =
    useState<PhantomAiOpsStatus>(defaultPhantomAiOpsStatus);
  const [agentWorkforceStatus, setAgentWorkforceStatus] =
    useState<AgentWorkforceStatus>(defaultAgentWorkforceStatus);
  const [aiProvider, setAiProvider] = useState<AiProviderChoice>("codex");
  const [phantomAiBusy, setPhantomAiBusy] = useState(false);
  const [moneyDemoBusy, setMoneyDemoBusy] = useState<MoneyDemoStage | null>(null);
  const [selectedOrg, setSelectedOrg] = useState(OWNER_ORG_NAME);
  const adminHostOnly = useMemo(() => isAdminPublicHost(), []);
  const availableSessions = useMemo(
    () => (adminHostOnly ? initialSessions.filter((session) => session.canManageAccess) : initialSessions),
    [adminHostOnly],
  );
  const activeSession = useMemo(
    () => availableSessions.find((session) => session.id === activeSessionId) ?? availableSessions[0] ?? initialSessions[0],
    [activeSessionId, availableSessions],
  );
  const canManageAccess = activeSession.canManageAccess;
  const visibleNavItems = useMemo(() => {
    if (canManageAccess) return navItems;
    return navItems.filter((item) => !ADMIN_ONLY_ROUTES.has(item.id));
  }, [canManageAccess]);
  const coreMobileNavItems = useMemo(
    () => visibleNavItems.filter((item) => CORE_MOBILE_ROUTES.has(item.id)),
    [visibleNavItems],
  );
  const moreMobileNavItems = useMemo(
    () => visibleNavItems.filter((item) => !CORE_MOBILE_ROUTES.has(item.id)),
    [visibleNavItems],
  );
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
  const scopedClientAccess = useMemo(() => {
    if (canManageAccess && selectedWorkspaceClient) return [selectedWorkspaceClient];
    return visibleClientAccess;
  }, [canManageAccess, selectedWorkspaceClient, visibleClientAccess]);

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

  async function signIn(sessionId: string, preferredRoute: Route = "command", ownerKey?: string) {
    const session = availableSessions.find((item) => item.id === sessionId) ?? availableSessions[0] ?? initialSessions[0];

    if (adminHostOnly && !session.canManageAccess) {
      addActivity("Admin host blocked employee login", "admin.phantomforce.online only allows owner/admin access.", "warn");
      return;
    }

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
      const trimmedOwnerKey = ownerKey?.trim();
      const response = await fetch(`${API_BASE_URL}${trimmedOwnerKey ? "/auth/owner-login" : "/auth/demo-login"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.id, ownerKey: trimmedOwnerKey || undefined }),
      });

      if (response.ok) {
        const data = (await response.json()) as { token?: string };
        setSessionToken(data.token ?? "");
      } else if (trimmedOwnerKey) {
        addActivity("PhantomForce login rejected", "Owner key was not accepted by the backend.", "warn");
        return;
      } else {
        const gatewayResponse = await fetch(`${API_BASE_URL}/session`);

        if (!gatewayResponse.ok) {
          addActivity("Signed in locally", "Backend auth token was not issued; API requests will fail closed.", "warn");
        }
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
    const previewSession = availableSessions.find((session) => session.id === sessionId);

    if (!previewSession) return;

    setPreviewLinkApplied(true);
    void signIn(previewSession.id, parsePreviewRoute(params.get("view")));
  }, [availableSessions, previewLinkApplied, signedIn]);

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
          owner: "Org Employee",
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
          owner: "Org Employee",
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

  async function refreshDeploymentModelStatus() {
    try {
      const response = await fetch(`${API_BASE_URL}/phantom-ai/deployment/model/status`, {
        headers: sessionHeaders(),
      });

      if (!response.ok) {
        setDeploymentModelStatus(defaultDeploymentModelStatus);
        return;
      }

      const data = (await response.json()) as { deployment_model?: DeploymentModelStatus };
      setDeploymentModelStatus(data.deployment_model ?? defaultDeploymentModelStatus);
    } catch {
      addActivity("Deployment model offline", "Cloud/connector product posture is waiting on the backend.", "warn");
      setDeploymentModelStatus(defaultDeploymentModelStatus);
    }
  }

  async function refreshSubscriptionStatus() {
    try {
      const response = await fetch(`${API_BASE_URL}/billing/subscription/status`, {
        headers: sessionHeaders(),
      });

      if (!response.ok) {
        setSubscription(null);
        return;
      }

      const data = (await response.json()) as {
        plan?: string;
        canView?: boolean;
        canWrite?: boolean;
        reason?: string;
      };
      setSubscription({
        plan: data.plan ?? "free",
        canView: data.canView ?? true,
        canWrite: data.canWrite ?? false,
        reason: data.reason ?? "",
      });
    } catch {
      setSubscription(null);
    }
  }

  async function refreshAgentWorkforceStatus() {
    try {
      const response = await fetch(`${API_BASE_URL}/phantom-ai/agents/status?window_hours=24`, {
        headers: sessionHeaders(),
      });

      if (!response.ok) {
        setAgentWorkforceStatus(defaultAgentWorkforceStatus);
        return;
      }

      const data = (await response.json()) as { workforce?: AgentWorkforceStatus };
      setAgentWorkforceStatus(data.workforce ?? defaultAgentWorkforceStatus);
    } catch {
      addActivity("Agent floor offline", "Agent workforce telemetry is waiting on the backend.", "warn");
      setAgentWorkforceStatus(defaultAgentWorkforceStatus);
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
    void refreshAgentWorkforceStatus();
    void refreshSubscriptionStatus();
    void refreshDeploymentModelStatus();
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

  function createFollowUpPlan(sourceMission?: MissionBundle) {
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
        missionId: sourceMission?.id,
        missionTitle: sourceMission?.title,
        producedAt: new Date().toISOString(),
        content:
          "I found the best next action: reply to the priority lead and reserve a call window. I prepared an email draft and a booking card for your final click. No external action has been taken.",
      },
    ]);
    addActivity("Review cards created", "Email and calendar actions are ready to confirm.", "ok");
    setRoute("command");
  }

  function createStoreReviewApproval(draft: StorefrontDraft) {
    const storeApproval: Approval = {
      id: makeId("approval-store"),
      kind: "task",
      title: `Review store page: ${draft.product}`,
      summary:
        "Confirm storefront copy, price, fulfillment promise, scanner result, checkout gate, and publish/payment path before anything goes live.",
      payload: {
        title: `Storefront review - ${draft.product}`,
        due: "Before publish/payment link",
        store: draft.name,
        product: draft.product,
        price: draft.price,
        cta: draft.cta,
      },
      reversible: true,
      status: "pending",
    };

    setApprovals((current) => [storeApproval, ...current]);
    setMessages((current) => [
      ...current,
      {
        id: makeId("msg-assistant"),
        role: "assistant",
        content:
          "I staged the store page review card. It is now in Review queue with price, product, CTA, and checkout-gate notes. No payment link, publish, send, or external action was created.",
      },
    ]);
    addActivity("Store review staged", `${draft.product} is waiting in Review queue before checkout or publish.`, "ok");
    setRoute("approvals");
  }

  function stageQuickToolApproval(tool: OwnerQuickTool, copied: boolean) {
    const approval: Approval = {
      id: makeId(`approval-quick-tool-${tool.id}`),
      kind: "task",
      title: `Run quick tool: ${tool.title}`,
      summary: `${tool.description} Proof required: ${tool.proof}.`,
      payload: {
        title: tool.taskTitle,
        due: tool.taskDue,
        lane: tool.lane,
        proof: tool.proof,
        command: tool.command,
        handoff: copied ? "copied to clipboard" : "copy blocked by browser",
      },
      reversible: true,
      status: "pending",
    };

    setApprovals((current) => [approval, ...current]);
    addActivity("Quick tool staged", `${tool.title} is waiting in Review with its proof requirements.`, "ok");
  }

  function createReviewRequestApproval(clientId: string) {
    const client = reviewClients.find((item) => item.id === clientId);
    if (!client) return;

    if (client.status === "request_queued") {
      addActivity("Review request already queued", `${client.business} is already waiting in Review queue.`, "info");
      setRoute("approvals");
      return;
    }

    const reviewApproval: Approval = {
      id: makeId("approval-review-request"),
      kind: "review_request",
      title: `Request review: ${client.business}`,
      summary: `Draft a ${client.channel} review ask for ${client.service}. No message sends until approved.`,
      payload: {
        client_id: client.id,
        business: client.business,
        contact: client.contact,
        service: client.service,
        channel: client.channel,
        review_link: client.reviewLink,
        draft_message: client.draftMessage,
        send_status: "not sent - approval required",
      },
      reversible: true,
      status: "pending",
    };

    setReviewClients((clients) =>
      clients.map((item) => (item.id === client.id ? { ...item, status: "request_queued" } : item)),
    );
    setApprovals((current) => [reviewApproval, ...current]);
    addActivity("Review request staged", `${client.business} review ask is waiting for approval.`, "ok");
    setRoute("approvals");
  }

  function prepareAutonomousReviewFollowups() {
    const readyClients = reviewClients.filter((client) => client.status === "ready");

    if (!readyClients.length) {
      addActivity("Review engine current", "No unqueued previous-client review requests are waiting.", "info");
      setRoute("inbox");
      return;
    }

    const reviewApprovals: Approval[] = readyClients.map((client) => ({
      id: makeId(`approval-review-request-${client.id}`),
      kind: "review_request",
      title: `Request review: ${client.business}`,
      summary: `Autonomous review follow-up prepared for ${client.service}. No external message sent.`,
      payload: {
        client_id: client.id,
        business: client.business,
        contact: client.contact,
        service: client.service,
        channel: client.channel,
        review_link: client.reviewLink,
        draft_message: client.draftMessage,
        send_status: "not sent - approval required",
      },
      reversible: true,
      status: "pending",
    }));

    setReviewClients((clients) =>
      clients.map((client) =>
        readyClients.some((readyClient) => readyClient.id === client.id)
          ? { ...client, status: "request_queued" }
          : client,
      ),
    );
    setApprovals((current) => [...reviewApprovals, ...current]);
    addActivity("Autonomous reviews staged", `${reviewApprovals.length} review request(s) moved to Review queue.`, "ok");
    setRoute("approvals");
  }

  function stageReviewForWebsiteApproval(clientId: string) {
    const client = reviewClients.find((item) => item.id === clientId);
    if (!client?.submittedReview) {
      addActivity("Review not ready", "No submitted review is available for that client yet.", "warn");
      return;
    }

    const websiteReviewApproval: Approval = {
      id: makeId("approval-website-review"),
      kind: "website_review",
      title: `Approve website review: ${client.business}`,
      summary: "Review received. Approve before it appears on the website testimonial surface.",
      payload: {
        client_id: client.id,
        business: client.business,
        author: client.submittedReview.author,
        rating: client.submittedReview.rating,
        quote: client.submittedReview.quote,
        service: client.service,
        website_status: "not published - approval required",
      },
      reversible: true,
      status: "pending",
    };

    setReviewClients((clients) =>
      clients.map((item) => (item.id === client.id ? { ...item, status: "review_received" } : item)),
    );
    setApprovals((current) => [websiteReviewApproval, ...current]);
    addActivity("Website review staged", `${client.business} testimonial is waiting in Review queue.`, "ok");
    setRoute("approvals");
  }

  function stageHiggsfieldGenerationApproval(payload: {
    prompt: string;
    mediaPath: string;
    commandPreview: string;
    model: string;
    aspectRatio: string;
    resolution: string;
    duration: string;
  }) {
    const approval: Approval = {
      id: makeId("approval-higgsfield-video"),
      kind: "video_generation",
      title: "Run Higgsfield video generation",
      summary: "Approve before any paid/upload Higgsfield generation can be run from PhantomCut.",
      payload: {
        provider: "Higgsfield",
        model: payload.model,
        aspect_ratio: payload.aspectRatio,
        resolution: payload.resolution,
        duration: payload.duration,
        source_media: payload.mediaPath || "prompt-only",
        prompt: payload.prompt,
        command_preview: payload.commandPreview,
        required_confirmation: "RUN_HIGGSFIELD_PAID_JOB",
        execution_status: "not run - approval only",
      },
      reversible: true,
      status: "pending",
    };

    setApprovals((current) => [approval, ...current]);
    addActivity("Higgsfield generation staged", "Paid/upload generation request is waiting in Review queue.", "ok");
    setRoute("approvals");
  }

  async function runPhantomCommand(rawText: string) {
    const text = rawText.trim();
    if (!text) return;
    const mission = resolveMissionBundle(text);
    setCommandText("");
    setMessages((current) => [
      ...current,
      {
        id: makeId("msg-user"),
        role: "user",
        content: text,
        missionId: mission?.bundle.id,
        missionTitle: mission?.bundle.title,
      },
    ]);

    if (!canManageAccess) {
      setMessages((current) => [
        ...current,
        {
          id: makeId("msg-assistant"),
          role: "assistant",
          content:
            "This employee workspace is in demo mode. You can see how PhantomForce prepares replies, quotes, bookings, content, and approvals, but the full admin suite and infrastructure stay private.",
        },
      ]);
      addActivity("Employee operator demo protected", "No operator endpoint was called for this employee session.", "info");
      return;
    }

    if (mission?.bundle.id === "help") {
      setMessages((current) => [
        ...current,
        {
          id: makeId("msg-assistant"),
          role: "assistant",
          content: `Use normal language by default. Mission shortcuts are optional when you want a specific bundle:\n${missionHelpText()}`,
        },
      ]);
      addActivity("Mission menu shown", "Admin mission shortcuts were listed without starting external work.", "info");
      return;
    }

    if (mission?.bundle.id === "followup") {
      createFollowUpPlan(mission.bundle);
      return;
    }

    if (requestsExternalAction(text)) {
      createFollowUpPlan(mission?.bundle);
      return;
    }

    const messageForBackend = mission ? buildMissionPrompt(mission.bundle, mission.subject) : text;

    if (aiProvider === "codex" || aiProvider === "glm_5_2" || aiProvider === "claude_cli" || aiProvider === "phantom") {
      setPhantomAiBusy(true);

      try {
        const response = await fetch(`${API_BASE_URL}/phantom-ai/chat`, {
          method: "POST",
          headers: sessionHeaders(true),
          body: JSON.stringify({
            provider: "phantom",
            admin_model: canManageAccess ? aiProvider : undefined,
            message: messageForBackend,
            tenant_id: activeSession.clientId ?? "phantomforce-owner",
            business_name: selectedOrg,
            actor_user_id: activeSession.id,
            request_id: `chat-${Date.now()}`,
            task_type: mission ? `mission_bundle_${mission.bundle.id}` : "content_idea_summary",
            sensitivity_level: "low",
            business_summary: mission
              ? `Owner operating brain mission bundle: ${mission.bundle.title}. Internal workers are bundled behind PhantomAI. External actions, sends, uploads, billing, deletes, deploys, and credential changes require explicit confirmation.`
              : "Owner operating brain request. External actions, sends, uploads, billing, deletes, deploys, and credential changes require explicit confirmation.",
            module_data: [
              {
                module: "Operating Brain",
                summary: "Current local workspace state for Phantom AI response.",
                items: [
                  { title: "Needs confirmation", status: String(stats.pending), detail: "Review before external action." },
                  { title: "Follow-ups", status: String(stats.urgent), detail: "Prioritize next steps." },
                  { title: "Today tasks", status: String(stats.today), detail: "Summarize operational priorities." },
                ],
              },
              ...(mission
                ? [
                    {
                      module: "Mission Bundle",
                      summary: mission.bundle.title,
                      items: mission.bundle.crew.map((crew) => ({
                        title: crew,
                        status: "bundled",
                        detail: "Hidden internal worker lane, surfaced as one PhantomAI outcome.",
                      })),
                    },
                  ]
                : []),
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
            missionId: mission?.bundle.id,
            missionTitle: mission?.bundle.title,
            producedAt: new Date().toISOString(),
            content,
          },
        ]);
        addActivity(
          mission ? "Mission bundle routed" : "Phantom AI replied",
          canManageAccess
            ? `${mission ? mission.bundle.title : "PhantomAI"} answered in ${phantomAiModeLabel(aiProvider).toLowerCase()} mode${data?.hermes?.ledger_written ? " and saved a local receipt" : ""}.`
            : "Client-safe guidance returned without exposing admin tools.",
          "ok",
        );
        if (mission?.bundle.route && mission.bundle.route !== "command") {
          setRoute(mission.bundle.route);
        }
        return;
      } catch {
        setMessages((current) => [
          ...current,
          {
            id: makeId("msg-assistant"),
            role: "assistant",
            missionId: mission?.bundle.id,
            missionTitle: mission?.bundle.title,
            producedAt: new Date().toISOString(),
            content:
              "Phantom AI could not reach the backend. I can still prepare local drafts, booking cards, quotes, and tasks from the dashboard.",
          },
        ]);
        addActivity("Phantom AI backend offline", "The Phantom AI backend did not answer.", "warn");
      } finally {
        setPhantomAiBusy(false);
      }
    }

    if (text.toLowerCase().includes("brief") || text.toLowerCase().includes("today")) {
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

    if (approval.kind === "review_request") {
      setReviewClients((clients) =>
        clients.map((client) =>
          client.id === approval.payload.client_id ? { ...client, status: "request_approved" } : client,
        ),
      );
      setTasks((current) => [
        {
          id: makeId("task-review-send"),
          title: `Manually send review link to ${approval.payload.business}`,
          owner: "PhantomForce",
          due: "Next follow-up block",
          status: "queued",
        },
        ...current,
      ]);
    }

    if (approval.kind === "website_review") {
      const websiteReview: WebsiteReview = {
        id: makeId("website-review"),
        business: approval.payload.business,
        author: approval.payload.author,
        quote: approval.payload.quote,
        rating: approval.payload.rating,
        service: approval.payload.service,
        approvedAt: new Date().toISOString(),
      };

      setWebsiteReviews((reviews) => [websiteReview, ...reviews]);
      setReviewClients((clients) =>
        clients.map((client) =>
          client.id === approval.payload.client_id ? { ...client, status: "website_ready" } : client,
        ),
      );
    }

    if (approval.kind === "video_generation") {
      setTasks((current) => [
        {
          id: makeId("task-higgsfield-run"),
          title: "Run approved Higgsfield generation inside PhantomCut",
          owner: "Media Lab",
          due: "When Jordan is ready to spend credits",
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
    if (approval?.kind === "review_request") {
      setReviewClients((clients) =>
        clients.map((client) =>
          client.id === approval.payload.client_id ? { ...client, status: "ready" } : client,
        ),
      );
    }
    if (approval?.kind === "website_review") {
      setReviewClients((clients) =>
        clients.map((client) =>
          client.id === approval.payload.client_id ? { ...client, status: "request_approved" } : client,
        ),
      );
    }
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
        owner: "New Org Owner",
        plan: "$2,000 Launch Ops",
        source: "nexprospex",
        sourceRecordId: paid ? "nxp-money-demo-paid" : "nxp-money-demo-signed",
        winStatus: paid ? "payment_received" : "signed_agreement",
        paymentStatus,
        modules: ["Focus", "Calendar", "Tasks", "Approvals", "Contacts"],
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
        sessions={availableSessions}
        setActiveSessionId={setActiveSessionId}
        onSignIn={signIn}
        adminHostOnly={adminHostOnly}
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
          <strong>Action phantom online.</strong>
          <small>Phantom AI, ChicagoShots proposals, and next-step planning are active locally.</small>
        </div>
      </aside>

      <main className={`workspace${route === "command" ? " workspace-command" : ""}`}>
          <>
        <Topbar
          activeSession={activeSession}
          selectedOrg={selectedOrg}
          pending={stats.pending}
          subscription={subscription}
        />
        {subscription && subscription.canView && !subscription.canWrite ? (
          <div className="plan-banner" role="status">
            <span className="plan-banner-tag">Free plan</span>
            <span className="plan-banner-msg">
              You have full view access. Upgrade to make changes, run actions, and approve.
            </span>
            <a
              className="plan-banner-cta"
              href="mailto:hello@phantomforce.online?subject=Upgrade%20my%20PhantomForce%20plan"
            >
              Upgrade
            </a>
          </div>
        ) : null}
          </>
        {route === "command" ? (
          <PhantomDeck
            messages={messages}
            commandText={commandText}
            setCommandText={setCommandText}
            runPhantomCommand={runPhantomCommand}
            phantomAiBusy={phantomAiBusy}
            canManageAccess={canManageAccess}
            selectedOrg={selectedOrg}
            selectedWorkspaceClient={selectedWorkspaceClient}
            phantomAiOpsStatus={phantomAiOpsStatus}
            providerSetupStatus={providerSetupStatus}
            agentWorkforceStatus={agentWorkforceStatus}
            sessionHeaders={sessionHeaders}
            stats={stats}
            approvals={approvals}
            approveAction={approveAction}
            rejectAction={rejectAction}
            emails={emails}
            events={events}
            tasks={tasks}
            activity={activity}
            clientAccess={scopedClientAccess}
            setRoute={setRoute}
          />
        ) : null}
        {route === "agents" && canManageAccess ? (
          <AgentControlCenter
            setRoute={setRoute}
            pangolinPlan={pangolinPlan}
            pangolinStatus={pangolinStatus}
            phantomAiOpsStatus={phantomAiOpsStatus}
            agentWorkforceStatus={agentWorkforceStatus}
            sessionHeaders={sessionHeaders}
          />
        ) : null}
        {route === "inbox" ? (
          <InboxView
            emails={emails}
            reviewClients={reviewClients}
            websiteReviews={websiteReviews}
            createFollowUpPlan={createFollowUpPlan}
            createReviewRequestApproval={createReviewRequestApproval}
            prepareAutonomousReviewFollowups={prepareAutonomousReviewFollowups}
            stageReviewForWebsiteApproval={stageReviewForWebsiteApproval}
          />
        ) : null}
        {route === "calendar" ? <CalendarView events={events} /> : null}
        {route === "tasks" ? <TasksView tasks={tasks} completeTask={completeTask} /> : null}
        {route === "content" ? <ContentView /> : null}
        {route === "media" ? (
          <MediaLabView
            sessionHeaders={sessionHeaders}
            stageHiggsfieldGenerationApproval={stageHiggsfieldGenerationApproval}
          />
        ) : null}
        {route === "security" ? (
          <SecurityScannerView canManageAccess={canManageAccess} sessionHeaders={sessionHeaders} />
        ) : null}
        {route === "site" && canManageAccess ? (
          <SiteStudioView
            pangolinPlan={pangolinPlan}
            pangolinStatus={pangolinStatus}
            sessionHeaders={sessionHeaders}
            createStoreReviewApproval={createStoreReviewApproval}
          />
        ) : null}
        {route === "offers" ? <OffersView /> : null}
        {route === "approvals" ? (
          <ApprovalsView
            approvals={approvals}
            websiteReviews={websiteReviews}
            approveAction={approveAction}
            rejectAction={rejectAction}
          />
        ) : null}
        {route === "access" && canManageAccess ? (
          <AccessView
            canManageAccess={canManageAccess}
            clientAccess={scopedClientAccess}
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
            deploymentModelStatus={deploymentModelStatus}
            sessionHeaders={sessionHeaders}
            pangolinPlan={pangolinPlan}
            pangolinStatus={pangolinStatus}
          />
        ) : null}
      </main>

      {mobileMoreOpen && moreMobileNavItems.length ? (
        <div className="mobile-more-sheet" role="menu" aria-label="More sections">
          {moreMobileNavItems.map((item) => (
            <button
              key={item.id}
              className={route === item.id ? "active" : ""}
              type="button"
              role="menuitem"
              onClick={() => {
                setRoute(item.id);
                setMobileMoreOpen(false);
              }}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      ) : null}
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {coreMobileNavItems.map((item) => (
          <button
            key={item.id}
            className={route === item.id ? "active" : ""}
            type="button"
            onClick={() => {
              setRoute(item.id);
              setMobileMoreOpen(false);
            }}
            title={item.label}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
        {moreMobileNavItems.length ? (
          <button
            className={mobileMoreOpen ? "active" : ""}
            type="button"
            onClick={() => setMobileMoreOpen((open) => !open)}
            title="More"
            aria-expanded={mobileMoreOpen}
          >
            <MoreHorizontal size={18} />
            <span>More</span>
          </button>
        ) : null}
      </nav>
    </div>
  );
}

function LoginScreen({
  activeSessionId,
  sessions,
  setActiveSessionId,
  onSignIn,
  adminHostOnly,
}: {
  activeSessionId: string;
  sessions: AppSession[];
  setActiveSessionId: (sessionId: string) => void;
  onSignIn: (sessionId: string, preferredRoute?: Route, ownerKey?: string) => void | Promise<void>;
  adminHostOnly: boolean;
}) {
  // Sessions (the list + switcher) are an admin-only feature. A client never
  // sees a session list — they enter their single workspace. Operators reveal
  // the picker explicitly.
  const [operatorMode, setOperatorMode] = useState(false);
  const [ownerKey, setOwnerKey] = useState("");
  const adminDefault = sessions.find((session) => session.canManageAccess) ?? sessions[0];
  const clientDefault = sessions.find((session) => !session.canManageAccess) ?? sessions[0];
  const targetSessionId = adminHostOnly
    ? (adminDefault?.id ?? activeSessionId)
    : operatorMode
      ? activeSessionId
      : (clientDefault?.id ?? activeSessionId);
  return (
    <main className="login-screen">
      <section className="login-copy">
        <div className="brand-row large">
          <div className="brand-mark">
            <Sparkles size={24} />
          </div>
          <div>
            <strong>PhantomForce AI</strong>
            <span>AI business operating brain</span>
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
        <span className="panel-label">{adminHostOnly ? "Admin access" : "Pilot access"}</span>
        <h2>{adminHostOnly ? "Owner brain access." : "One login. One business brain."}</h2>
        <label>
          Email
          <input defaultValue="jordan@phantomforce.online" />
        </label>
        <label>
          Password
          <input
            type="password"
            value={ownerKey}
            onChange={(event) => setOwnerKey(event.target.value)}
            autoComplete="current-password"
          />
        </label>
        {operatorMode && !adminHostOnly ? (
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
        ) : null}
        <button className="primary-action" type="button" onClick={() => void onSignIn(targetSessionId, "command", ownerKey)}>
          <KeyRound size={18} />
          {adminHostOnly ? "Enter Admin Phantom" : "Enter PhantomForce"}
        </button>
        {!adminHostOnly ? (
          <button className="ghost-small operator-toggle" type="button" onClick={() => setOperatorMode((value) => !value)}>
            {operatorMode ? "Back to employee sign-in" : "Operator sign-in"}
          </button>
        ) : null}
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

function accountInitials(label: string) {
  const words = label.trim().split(/\s+/).filter(Boolean);
  const initials = words.slice(0, 2).map((word) => word.charAt(0).toUpperCase()).join("");
  return initials || "PF";
}

function subscriptionPlanLabel(subscription: SubscriptionStatus | null) {
  if (!subscription) return "Plan loading";
  return subscription.canWrite || subscription.plan === "pro" ? "Pro Plan" : "Free Plan";
}

function accountSystemState(subscription: SubscriptionStatus | null) {
  if (!subscription) {
    return {
      className: "error",
      label: "Status checking",
      detail: "Subscription gate has not reported yet.",
    };
  }

  if (!subscription.canView) {
    return {
      className: "error",
      label: "Systems error",
      detail: subscription.reason || "Access is blocked by the subscription gate.",
    };
  }

  if (!subscription.canWrite) {
    return {
      className: "paused",
      label: "Systems paused",
      detail: subscription.reason || "View-only plan. Changes and approvals are paused.",
    };
  }

  return {
    className: "online",
    label: "Systems online",
    detail: subscription.reason || "Full workspace actions are available.",
  };
}

function Topbar({
  activeSession,
  selectedOrg,
  pending,
  subscription,
}: {
  activeSession: AppSession;
  selectedOrg: string;
  pending: number;
  subscription: SubscriptionStatus | null;
}) {
  const [planManagerOpen, setPlanManagerOpen] = useState(false);
  const systemState = accountSystemState(subscription);
  const planLabel = subscriptionPlanLabel(subscription);

  return (
    <header className="topbar">
      <div>
        <span className="eyebrow">Workspace</span>
        <h1>{selectedOrg}</h1>
        <span className={`session-chip ${activeSession.role}`}>
          {activeSession.role === "admin" ? "Admin access" : "Employee workspace"}
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
        <section className="profile-plan-card" aria-label="Account profile and plan">
          <div className="profile-avatar-wrap">
            <div className="profile-avatar" aria-hidden="true">
              {accountInitials(activeSession.label)}
            </div>
            <span className={`profile-status-dot ${systemState.className}`} aria-label={systemState.label} />
          </div>
          <div className="profile-plan-copy">
            <span>{activeSession.label}</span>
            <strong>{systemState.label}</strong>
            <small>{systemState.detail}</small>
          </div>
          <div className="profile-plan-meta">
            <span>{planLabel}</span>
            <small>Renewal: {ACCOUNT_RENEWAL_LABEL}</small>
          </div>
          <button
            className="profile-manage-button"
            type="button"
            onClick={() => setPlanManagerOpen(true)}
          >
            Manage Plan <ArrowRight size={15} />
          </button>
        </section>
      </div>
      {planManagerOpen ? (
        <PlanManagerDialog
          activeSession={activeSession}
          subscription={subscription}
          onClose={() => setPlanManagerOpen(false)}
        />
      ) : null}
    </header>
  );
}

function PlanManagerDialog({
  activeSession,
  subscription,
  onClose,
}: {
  activeSession: AppSession;
  subscription: SubscriptionStatus | null;
  onClose: () => void;
}) {
  const planLabel = subscriptionPlanLabel(subscription);
  const systemState = accountSystemState(subscription);
  const tiers = [
    {
      id: "free",
      name: "Free View",
      price: "$0",
      detail: "View-only access for reviewing dashboards, proposals, and status.",
      features: ["View workspace", "Review drafts", "No approvals or changes"],
      current: planLabel === "Free Plan",
    },
    {
      id: "pro",
      name: "Pro Plan",
      price: "Active subscription",
      detail: "Full workspace actions, approvals, Phantom AI operator flows, and managed access.",
      features: ["Create and update records", "Use approval gates", "Manage client workflow"],
      current: planLabel === "Pro Plan",
    },
    {
      id: "managed",
      name: "Managed Growth",
      price: "Custom",
      detail: "Done-with-you setup, content/media workflow, access support, and launch operations.",
      features: ["Priority setup", "Workflow tuning", "Launch support"],
      current: false,
    },
  ];

  return (
    <div className="plan-manager-overlay" role="presentation">
      <section className="plan-manager-dialog" role="dialog" aria-modal="true" aria-label="Manage PhantomForce plan">
        <div className="plan-manager-head">
          <div>
            <span className="eyebrow">Account profile</span>
            <h2>Manage plan</h2>
          </div>
          <button className="ghost-small" type="button" onClick={onClose} aria-label="Close manage plan">
            <X size={16} />
            Close
          </button>
        </div>
        <div className="plan-profile-summary">
          <div className="profile-avatar large" aria-hidden="true">
            {accountInitials(activeSession.label)}
          </div>
          <div>
            <strong>{activeSession.label}</strong>
            <span>{activeSession.role === "admin" ? "Owner/admin profile" : "Workspace member profile"}</span>
            <small>{systemState.label} · {planLabel} · Renewal: {ACCOUNT_RENEWAL_LABEL}</small>
          </div>
          <span className={`plan-health-pill ${systemState.className}`}>
            <span className={`profile-status-dot ${systemState.className}`} />
            {systemState.label}
          </span>
        </div>
        <div className="plan-tier-grid" aria-label="Plan tiers">
          {tiers.map((tier) => (
            <article className={`plan-tier-card${tier.current ? " current" : ""}`} key={tier.id}>
              <div>
                <span>{tier.current ? "Current plan" : "Option"}</span>
                <h3>{tier.name}</h3>
              </div>
              <strong>{tier.price}</strong>
              <p>{tier.detail}</p>
              <ul>
                {tier.features.map((feature) => (
                  <li key={feature}>
                    <Check size={14} />
                    {feature}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
        <div className="plan-management-grid" aria-label="Payment and cancellation options">
          <article>
            <span className="eyebrow">Payment options</span>
            <h3>Billing method</h3>
            <p>
              Live payment portal is not wired here yet. Payment changes should route through PhantomForce billing until
              the production billing provider is connected.
            </p>
            <div className="plan-action-row">
              <a className="primary-small" href="mailto:hello@phantomforce.online?subject=Update%20my%20PhantomForce%20payment%20method">
                Request payment update
              </a>
              <button className="ghost-small" type="button" disabled title="Live billing portal is not implemented yet.">
                Card portal pending
              </button>
            </div>
          </article>
          <article>
            <span className="eyebrow">Plan changes</span>
            <h3>Upgrade, downgrade, or cancel</h3>
            <p>
              These options start a manual request. No cancellation, charge, refund, or access change executes from this
              dialog.
            </p>
            <div className="plan-action-row">
              <a className="primary-small" href="mailto:hello@phantomforce.online?subject=Upgrade%20my%20PhantomForce%20plan">
                Upgrade plan
              </a>
              <a className="ghost-small danger" href="mailto:hello@phantomforce.online?subject=Cancel%20my%20PhantomForce%20plan">
                Request cancellation
              </a>
            </div>
          </article>
        </div>
      </section>
    </div>
  );
}

function PhantomDeck({
  messages,
  commandText,
  setCommandText,
  runPhantomCommand,
  phantomAiBusy,
  canManageAccess,
  selectedOrg,
  selectedWorkspaceClient,
  phantomAiOpsStatus,
  providerSetupStatus,
  agentWorkforceStatus,
  sessionHeaders,
  stats,
  approvals,
  approveAction,
  rejectAction,
  emails,
  events,
  tasks,
  activity,
  clientAccess,
  setRoute,
}: {
  messages: Message[];
  commandText: string;
  setCommandText: (value: string) => void;
  runPhantomCommand: (text: string) => Promise<void>;
  phantomAiBusy: boolean;
  canManageAccess: boolean;
  selectedOrg: string;
  selectedWorkspaceClient?: ClientAccess;
  phantomAiOpsStatus: PhantomAiOpsStatus;
  providerSetupStatus: ProviderSetupStatus;
  agentWorkforceStatus: AgentWorkforceStatus;
  sessionHeaders: (json?: boolean) => Record<string, string>;
  stats: { urgent: number; pending: number; today: number; events: number; revoked: number };
  approvals: Approval[];
  approveAction: (id: string) => void;
  rejectAction: (id: string) => void;
  emails: EmailItem[];
  events: CalendarEvent[];
  tasks: TaskItem[];
  activity: ActivityItem[];
  clientAccess: ClientAccess[];
  setRoute: (route: Route) => void;
}) {
  const [activeWorkspace, setActiveWorkspace] = useState<PhantomDeckWorkspaceId | null>(null);
  const [selectedBrainNodeId, setSelectedBrainNodeId] = useState<string | null>(null);
  const [commandFocused, setCommandFocused] = useState(false);
  const [deckNotice, setDeckNotice] = useState("PhantomForce is watching for the next signal.");
  const [deckLoading, setDeckLoading] = useState(true);
  const [deckClock, setDeckClock] = useState(() => new Date());
  const [toolsOpen, setToolsOpen] = useState(false);
  const [glanceOpen, setGlanceOpen] = useState(false);
  const [commandSuggestions, setCommandSuggestions] = useState<PhantomDeckWorkspaceId[]>([]);
  const [answerMode, setAnswerMode] = useState(false);
  const [submittedPrompt, setSubmittedPrompt] = useState("");
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const [bootHologramVisible, setBootHologramVisible] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.sessionStorage.getItem("pf.hologramBootSeen.v1") !== "1";
  });
  const commandInputRef = useRef<HTMLInputElement | null>(null);
  const [proposalHistory, setProposalHistory] = useState<ChicagoShotsProposalHistoryRecord[]>([]);
  const [proposalCounts, setProposalCounts] =
    useState<ChicagoShotsProposalStatusCounts>(defaultChicagoShotsProposalStatusCounts);
  const [opsContext, setOpsContext] = useState<PhantomDeckOpsContext | null>(null);
  const [salesConnector, setSalesConnector] = useState<PhantomDeckSalesConnectorStatus | null>(null);
  const [sendReadiness, setSendReadiness] = useState<PhantomAiOpsStatus["send_readiness"] | null>(null);
  const [toolLanePreview, setToolLanePreview] = useState<PhantomDeckToolLanePreview | null>(null);
  const pendingApprovals = approvals.filter((approval) => approval.status === "pending");
  const viewingClientWorkspace = Boolean(canManageAccess && selectedWorkspaceClient);
  const latestAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  const priorityProposal = getChicagoShotsPriorityProposal(proposalHistory);
  const activeWorkspaceMeta = activeWorkspace
    ? (getVisiblePhantomDeckWorkspaces(canManageAccess).find((workspace) => workspace.id === activeWorkspace) ??
      getVisiblePhantomDeckWorkspaces(canManageAccess)[0] ??
      phantomDeckWorkspaces[0])
    : null;
  const effectiveSendReadiness = sendReadiness ?? phantomAiOpsStatus.send_readiness;
  const n8nRunning = toolLanePreview?.n8n_running ?? phantomAiOpsStatus.n8n.n8n_running;
  const n8nScaffolded = toolLanePreview?.n8n_scaffolded ?? phantomAiOpsStatus.n8n.n8n_scaffolded;
  const n8nLocalUrl = toolLanePreview?.n8n_local_url ?? phantomAiOpsStatus.n8n.n8n_local_url;
  const providerReady = phantomAiOpsStatus.glm_worker.live_call_ready || providerSetupStatus.openrouter_glm.live_call_ready;
  const estimatedPipelineValue = proposalHistory.reduce(
    (total, record) => total + estimateProposalRangeValue(record.recommended_price_range),
    0,
  );
  const agentSummary =
    agentWorkforceStatus.role === "admin"
      ? `${agentWorkforceStatus.summary.active_workers}/${agentWorkforceStatus.summary.total_workers} active`
      : agentWorkforceStatus.summary.label;
  const deckPosture = providerReady
    ? "Live AI"
    : phantomAiOpsStatus.safety_flags.execution_disabled
      ? "Protected"
      : "Review locks";
  const sendPosture = effectiveSendReadiness.send_enabled ? "send review" : "manual action gate";
  const adminWorkforce = agentWorkforceStatus.role === "admin" ? agentWorkforceStatus : null;
  const agentWindowHours = adminWorkforce?.summary.window_hours ?? 24;
  const agentActiveCount = adminWorkforce?.summary.active_workers ?? (canManageAccess ? 5 : 1);
  const agentTotalCount = adminWorkforce?.summary.total_workers ?? (canManageAccess ? 5 : 1);
  const agentTasksInWindow =
    adminWorkforce?.summary.tasks_in_window ??
    proposalCounts.total + stats.today + pendingApprovals.length + (n8nRunning ? 1 : 0);
  const agentTokensInWindow = adminWorkforce?.summary.tokens_in_window ?? 0;
  const agentSpendInWindow = adminWorkforce?.summary.estimated_cost_usd_in_window ?? 0;
  const agentLastRun =
    adminWorkforce?.summary.generated_at ??
    adminWorkforce?.ticker[0]?.timestamp ??
    null;
  const agentPulseEvents: AgentPulseEvent[] = [
    {
      id: "charles-protect",
      agent: "Charles",
      role: "Leak hunter",
      action: pendingApprovals.length
        ? `flagged ${pendingApprovals.length} item${pendingApprovals.length === 1 ? "" : "s"} that need owner review.`
        : "checked the leak lane; nothing is allowed to leave without review.",
      source: "Review + Protect",
      time: formatAgentClock(agentLastRun ?? deckClock),
      tone: pendingApprovals.length ? "warn" : "good",
      workspace: "protect",
    },
    {
      id: "mara-pipeline",
      agent: "Mara",
      role: "Revenue scout",
      action: proposalCounts.follow_up_needed
        ? `found ${proposalCounts.follow_up_needed} follow-up${proposalCounts.follow_up_needed === 1 ? "" : "s"} worth chasing.`
        : `scouted ${proposalCounts.total} proposal packet${proposalCounts.total === 1 ? "" : "s"}; no hot follow-up blocking.`,
      source: "ChicagoShots proposal history",
      time: formatAgentClock(agentLastRun ?? deckClock),
      tone: proposalCounts.follow_up_needed ? "watch" : "good",
      workspace: proposalCounts.follow_up_needed ? "followup" : "leads",
    },
    {
      id: "otto-automation",
      agent: "Otto",
      role: "Workflow mechanic",
      action: n8nRunning
        ? "confirmed the automation worker is on, with execution still gated."
        : n8nScaffolded
          ? "found the automation bay scaffolded, parked, and not pushing buttons."
          : "is waiting on the automation scaffold before workflows can be previewed.",
      source: "n8n dry-run lane",
      time: formatAgentClock(agentLastRun ?? deckClock),
      tone: n8nRunning ? "good" : n8nScaffolded ? "watch" : "blocked",
      workspace: "n8n",
    },
    {
      id: "knox-access",
      agent: "Knox",
      role: "Door guard",
      action: `checked ${clientAccess.length} org workspace${clientAccess.length === 1 ? "" : "s"} and employee gates.`,
      source: "Access records",
      time: formatAgentClock(agentLastRun ?? deckClock),
      tone: stats.revoked ? "warn" : "good",
      workspace: "access",
    },
    {
      id: "pixel-media",
      agent: "Pixel",
      role: "Media runner",
      action: "kept PhantomCut ready for briefs while paid generation stays approval-gated.",
      source: "Media Lab",
      time: formatAgentClock(agentLastRun ?? deckClock),
      tone: "good",
      workspace: "video",
    },
  ];
  const agentCapabilityChips = [
    {
      label: "Build",
      detail: "Codex-grade app/site work",
      intent: "Build the site/app and show proof.",
      workspace: "site" as PhantomDeckWorkspaceId,
    },
    {
      label: "Scan",
      detail: "Protect + repo risk checks",
      intent: "Scan current work for risks.",
      workspace: "protect" as PhantomDeckWorkspaceId,
    },
    {
      label: "Sell",
      detail: "Leads, quotes, follow-ups",
      intent: "Find the best sales follow-up.",
      workspace: "leads" as PhantomDeckWorkspaceId,
    },
    {
      label: "Cut",
      detail: "PhantomCut media plans",
      intent: "Plan the next video without spend.",
      workspace: "video" as PhantomDeckWorkspaceId,
    },
    {
      label: "Flow",
      detail: "n8n dry-run automation",
      intent: "Map automation before execution.",
      workspace: "n8n" as PhantomDeckWorkspaceId,
    },
  ].filter((capability) => canOpenPhantomDeckWorkspace(capability.workspace, canManageAccess));

  function dismissBootHologram() {
    if (!bootHologramVisible) return;
    try {
      window.sessionStorage.setItem("pf.hologramBootSeen.v1", "1");
    } catch {}
    setBootHologramVisible(false);
  }

  useEffect(() => {
    if (!canManageAccess) {
      setDeckLoading(false);
      setDeckNotice("PhantomForce is ready. Tell it what needs attention.");
      return;
    }
    let active = true;

    async function readJson<T>(url: string, init?: RequestInit): Promise<T | null> {
      try {
        const response = await fetch(url, init);
        const data = (await response.json().catch(() => null)) as T | null;
        return response.ok ? data : null;
      } catch {
        return null;
      }
    }

    async function loadDeck() {
      setDeckLoading(true);
      const headers = sessionHeaders();
      const jsonHeaders = sessionHeaders(true);
      const [history, context, sales, sends, lane] = await Promise.all([
        readJson<ChicagoShotsProposalHistoryListResponse>(
          `${API_BASE_URL}/phantom-ai/ops/chicagoshots/proposal-history?limit=25`,
          { headers },
        ),
        readJson<{ context?: PhantomDeckOpsContext }>(
          `${API_BASE_URL}/phantom-ai/ops/context?module=${encodeURIComponent(activeWorkspace ?? "home")}`,
          { headers },
        ),
        readJson<{ sales_connector?: PhantomDeckSalesConnectorStatus }>(
          `${API_BASE_URL}/phantom-ai/ops/sales-connector/status`,
          { headers },
        ),
        readJson<{ send_readiness?: PhantomAiOpsStatus["send_readiness"] }>(
          `${API_BASE_URL}/phantom-ai/ops/send-readiness/status`,
          { headers },
        ),
        readJson<PhantomDeckToolLanePreview>(`${API_BASE_URL}/phantom-ai/tool-lane/preview`, {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({ tool_id: "n8n" }),
        }),
      ]);

      if (!active) return;

      const records = Array.isArray(history?.records) ? history.records : [];
      setProposalHistory(records);
      setProposalCounts(history?.summary_counts ?? countChicagoShotsProposalStatuses(records));
      setOpsContext(context?.context ?? null);
      setSalesConnector(sales?.sales_connector ?? null);
      setSendReadiness(sends?.send_readiness ?? null);
      setToolLanePreview(lane ?? null);
      setDeckNotice(records.length ? "Proposal history synced." : "No saved proposal packets yet.");
      setDeckLoading(false);
    }

    void loadDeck();
    return () => {
      active = false;
    };
  }, [activeWorkspace, canManageAccess]);

  useEffect(() => {
    const timer = window.setInterval(() => setDeckClock(new Date()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!bootHologramVisible) return undefined;
    try {
      window.sessionStorage.setItem("pf.hologramBootSeen.v1", "1");
    } catch {}
    const timer = window.setTimeout(() => {
      setBootHologramVisible(false);
    }, 2800);
    return () => window.clearTimeout(timer);
  }, [bootHologramVisible]);

  useEffect(() => {
    function handleKeyboardShortcut(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      const typing = tagName === "input" || tagName === "textarea" || target?.isContentEditable;

      if ((event.key === "/" && !typing) || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k")) {
        event.preventDefault();
        commandInputRef.current?.focus();
      }

      if (event.key === "Escape") {
        setActiveWorkspace(null);
        setSelectedBrainNodeId(null);
        setToolsOpen(false);
        setGlanceOpen(false);
        setCommandSuggestions([]);
        setAnswerMode(false);
        setSubmittedPrompt("");
        commandInputRef.current?.blur();
      }
    }

    window.addEventListener("keydown", handleKeyboardShortcut);
    return () => window.removeEventListener("keydown", handleKeyboardShortcut);
  }, []);

  const pulseItems: Array<{ key: string; label: string; value: string; tone: PhantomDeckPulseTone }> = [
    {
      key: "leads",
      label: "Leads",
      value: proposalCounts.total ? String(proposalCounts.total) : String(stats.urgent),
      tone: proposalCounts.follow_up_needed || stats.urgent ? "warn" : "good",
    },
    {
      key: "work",
      label: "Work",
      value: String(stats.today),
      tone: stats.today ? "warn" : "good",
    },
    {
      key: "money",
      label: "Money",
      value: String(proposalCounts.draft + proposalCounts.sent_manually + proposalCounts.follow_up_needed),
      tone: proposalCounts.won ? "good" : proposalCounts.total ? "warn" : "muted",
    },
    {
      key: "video",
      label: "Video",
      value: "ready",
      tone: "good",
    },
    {
      key: "protect",
      label: "Protect",
      value: phantomAiOpsStatus.safety_flags.execution_disabled ? "locked" : "review",
      tone: phantomAiOpsStatus.safety_flags.execution_disabled ? "good" : "alert",
    },
    {
      key: "review",
      label: "Review",
      value: pendingApprovals.length ? String(pendingApprovals.length) : "clear",
      tone: pendingApprovals.length ? "alert" : "good",
    },
    {
      key: "n8n",
      label: "Auto",
      value: n8nRunning ? "on" : n8nScaffolded ? "off" : "planned",
      tone: n8nRunning ? "good" : n8nScaffolded ? "warn" : "muted",
    },
    {
      key: "send",
      label: "Sends",
      value: effectiveSendReadiness.send_enabled ? "review" : "manual",
      tone: effectiveSendReadiness.send_enabled ? "warn" : "good",
    },
  ];

  const companionSignal = (() => {
    if (proposalCounts.follow_up_needed > 0) {
      const target = priorityProposal?.client_name ?? "the hottest lead";
      const noun = proposalCounts.follow_up_needed === 1 ? "follow-up" : "follow-ups";
      return {
        text: `Phantom sees ${proposalCounts.follow_up_needed} ${noun}. Start with ${target}.`,
        workspace: "followup" as PhantomDeckWorkspaceId,
      };
    }
    if (priorityProposal?.proposal_priority_label === "send_now") {
      return {
        text: `Phantom says ${priorityProposal.client_name} is ready for manual send.`,
        workspace: "proposal" as PhantomDeckWorkspaceId,
      };
    }
    if (priorityProposal) {
      return { text: `Magic 8-ball says: follow up with ${priorityProposal.client_name}.`, workspace: "money" as PhantomDeckWorkspaceId };
    }
    if (n8nRunning) return { text: "Automation worker is running locally.", workspace: "n8n" as PhantomDeckWorkspaceId };
    if (n8nScaffolded) return { text: "Automation is scaffolded and controlled.", workspace: "n8n" as PhantomDeckWorkspaceId };
    if (!effectiveSendReadiness.send_enabled) {
      return { text: "Everything is manual-send safe.", workspace: "protect" as PhantomDeckWorkspaceId };
    }
    if (!providerReady) return { text: "Provider lane is gated/off.", workspace: "status" as PhantomDeckWorkspaceId };
    return { text: "All visible lanes are calm.", workspace: "status" as PhantomDeckWorkspaceId };
  })();

  const companionMood: PhantomDeckMood = commandFocused
    ? "thinking"
    : pendingApprovals.length || proposalCounts.follow_up_needed
      ? "alert"
      : !effectiveSendReadiness.send_enabled || !providerReady
        ? "blocked"
        : "calm";

  const executionLocked = phantomAiOpsStatus.safety_flags.execution_disabled;
  const brainNodes: PhantomBrainNode[] = [
    {
      id: "phantom-ai",
      label: "Phantom AI",
      detail: "The operator brain. Reads intent and opens the right workspace.",
      value: phantomAiOpsStatus.product_status,
      status: "active",
      category: "core",
      x: 120,
      y: 285,
      workspace: canManageAccess ? "brain" : "status",
      speech: "Tell me what matters. I will find the right move.",
      safety: "No provider call, no send, no execution starts from this map.",
      inside: [
        { label: "Intent router", state: "active" },
        { label: "Hermes memory", state: phantomAiOpsStatus.hermes.ready ? "ready" : "planned" },
        { label: "GLM worker lane", state: phantomAiOpsStatus.glm_worker.status === "ready" ? "gated" : "gated / off" },
        { label: "Live transport", state: phantomAiOpsStatus.safety_flags.provider_transport_allowed ? "review" : "blocked" },
      ],
      icon: <Bot size={18} />,
    },
    {
      id: "hermes",
      label: "Hermes",
      detail: "Memory, context, and proof. Local append-only ledger and recall.",
      value: phantomAiOpsStatus.hermes.ready
        ? `${opsContext?.memory?.recalled_count ?? 0} memories`
        : "not live",
      status: phantomAiOpsStatus.hermes.ready ? "active" : "planned",
      category: "systems",
      x: 120,
      y: 495,
      workspace: "brain",
      adminOnly: true,
      speech: phantomAiOpsStatus.hermes.ready ? "Hermes memory is live and local." : "Hermes is scaffolded, not live.",
      safety: "Read-only from Phantom. No ledger writes from this map.",
      inside: [
        { label: "Ledger", state: phantomAiOpsStatus.hermes.ledger_exists ? "active" : "planned" },
        { label: "Context compiler", state: phantomAiOpsStatus.hermes.context_compiler_enabled ? "active" : "planned" },
        { label: "Interaction memory", state: phantomAiOpsStatus.hermes.interaction_memory_store_enabled ? "active" : "planned" },
        { label: "Proof / audit lane", state: "manual" },
      ],
      icon: <Sparkles size={18} />,
    },
    {
      id: "leads",
      label: "Leads",
      detail: "ChicagoShots pipeline. Saved packets and next actions.",
      value: proposalCounts.total ? `${proposalCounts.total} packets` : "no data yet",
      status: proposalCounts.follow_up_needed ? "needs_review" : proposalCounts.total ? "active" : "ready",
      category: "business",
      x: 335,
      y: 95,
      workspace: "leads",
      speech: proposalCounts.total
        ? `${proposalCounts.total} packet${proposalCounts.total === 1 ? "" : "s"} saved. ${proposalCounts.follow_up_needed} need${proposalCounts.follow_up_needed === 1 ? "s" : ""} follow-up.`
        : "No saved lead packets yet.",
      inside: [
        { label: "Draft", state: String(proposalCounts.draft) },
        { label: "Sent manually", state: String(proposalCounts.sent_manually) },
        { label: "Follow-up needed", state: String(proposalCounts.follow_up_needed) },
        { label: "Won / lost", state: `${proposalCounts.won} / ${proposalCounts.lost}` },
      ],
      icon: <Inbox size={18} />,
    },
    {
      id: "proposal-history",
      label: "Proposals",
      detail: "Quote drafts, saved history, status, and priority intelligence.",
      value: proposalHistory.length ? `${proposalHistory.length} records` : "no data yet",
      status: proposalHistory.length ? "active" : "ready",
      category: "business",
      x: 530,
      y: 95,
      workspace: "proposal",
      speech: priorityProposal
        ? `${priorityProposal.client_name} is the priority packet.`
        : "History is empty. Build a proposal.",
      inside: [
        { label: "Quote builder", state: "active" },
        { label: "Priority scoring", state: "active" },
        { label: "Status tracking", state: "active" },
        { label: "External send", state: "blocked" },
      ],
      icon: <FileText size={18} />,
    },
    {
      id: "work",
      label: "Work",
      detail: "Due follow-ups, bookings, and manual operator moves.",
      value: stats.today ? `${stats.today} today` : "clear",
      status: stats.today ? "needs_review" : "ready",
      category: "business",
      x: 725,
      y: 95,
      workspace: "work",
      speech: stats.today ? `${stats.today} work items due today.` : "Work lane is clear.",
      icon: <SquareCheckBig size={18} />,
    },
    {
      id: "money",
      label: "Money",
      detail: "Open proposal value from saved quote ranges. No accounting yet.",
      value: estimatedPipelineValue ? formatUsd(estimatedPipelineValue) : "no data yet",
      status: estimatedPipelineValue ? "active" : "ready",
      category: "business",
      x: 735,
      y: 225,
      workspace: "money",
      speech: estimatedPipelineValue
        ? `${formatUsd(estimatedPipelineValue)} open in pipeline.`
        : "No pipeline value yet.",
      safety: "No payment, invoice, or accounting route exists.",
      icon: <BarChart3 size={18} />,
    },
    {
      id: "video",
      label: "Video / PhantomCut",
      detail: "PhantomCut media engine with gated commercial generation.",
      value: "draft-ready",
      status: "ready",
      category: "create",
      x: 335,
      y: 285,
      workspace: "video",
      speech: "PhantomCut is ready for media planning.",
      safety: "No paid generation runs without explicit approval.",
      inside: [
        { label: "PhantomCut engine", state: "ready" },
        { label: "Higgsfield provider", state: "gated" },
        { label: "Resolve bridge", state: "ready" },
        { label: "Reaper bridge", state: "ready" },
      ],
      icon: <Play size={18} />,
    },
    {
      id: "site",
      label: "Site Studio",
      detail: "Website, app, and storefront build lane.",
      value: "builder",
      status: "ready",
      category: "create",
      x: 530,
      y: 285,
      workspace: "site",
      speech: "Site Studio is ready for build drafts.",
      safety: "No deployment without approval.",
      icon: <ShoppingCart size={18} />,
    },
    {
      id: "protect",
      label: "Protect",
      detail: "Safety locks, send posture, and planned scanners.",
      value: executionLocked ? "locks on" : "locks off",
      status: executionLocked ? "gated" : "blocked",
      category: "safety",
      x: 335,
      y: 460,
      workspace: "protect",
      speech: "Protect locks are on. No scans running.",
      safety: "No credential harvesting. No plaintext passwords. No dark web scraping.",
      inside: [
        { label: "Execution locks", state: executionLocked ? "active" : "off" },
        { label: "Medusa key scanner", state: "planned" },
        { label: "Robin breach scanner", state: "planned" },
        { label: "Scans running", state: "none" },
      ],
      icon: <ShieldCheck size={18} />,
    },
    {
      id: "send-readiness",
      label: "Send Readiness",
      detail: "Draft-only posture. Every send stays manual and operator-confirmed.",
      value: effectiveSendReadiness.send_enabled ? "review" : "draft-only",
      status: "manual",
      category: "safety",
      x: 530,
      y: 460,
      workspace: "protect",
      adminOnly: true,
      speech: "Send readiness is draft-only.",
      safety: "No email, social, or client message leaves this system.",
      inside: [
        { label: "Send route", state: effectiveSendReadiness.send_route_present ? "present" : "absent" },
        { label: "Approval required", state: effectiveSendReadiness.approval_required ? "yes" : "no" },
        { label: "Operator confirmation", state: effectiveSendReadiness.manual_operator_confirmation_required ? "required" : "off" },
        { label: "Credentials", state: effectiveSendReadiness.credentials_configured ? "configured" : "not read" },
      ],
      icon: <Send size={18} />,
    },
    {
      id: "sales-connector",
      label: "Sales Connector",
      detail: "Planned CRM and outreach connector. Hard-disabled until real.",
      value: salesConnector?.status ?? "planned",
      status: "disabled",
      category: "safety",
      x: 735,
      y: 460,
      workspace: canManageAccess ? "status" : "protect",
      adminOnly: true,
      speech: "Sales connector is planned, not live.",
      safety: salesConnector?.reason ?? "Disabled until a real connector is implemented and approved.",
      icon: <Link2 size={18} />,
    },
    {
      id: "review",
      label: "Review",
      detail: "Human checkpoint before anything risky or external.",
      value: pendingApprovals.length ? `${pendingApprovals.length} pending` : "clear",
      status: pendingApprovals.length ? "needs_review" : "ready",
      category: "safety",
      x: 910,
      y: 155,
      workspace: "review",
      speech: pendingApprovals.length
        ? `${pendingApprovals.length} item${pendingApprovals.length === 1 ? "" : "s"} need your review.`
        : "Review queue is clear.",
      safety: "No approval execution endpoint exists.",
      icon: <Bell size={18} />,
    },
    {
      id: "n8n",
      label: "Automation / n8n",
      detail: "Local workflow worker. Scaffolded, execution disabled.",
      value: n8nRunning ? "worker on" : n8nScaffolded ? "scaffolded / off" : "planned",
      status: n8nRunning ? "active" : n8nScaffolded ? "manual" : "planned",
      category: "systems",
      x: 910,
      y: 330,
      workspace: "n8n",
      adminOnly: true,
      speech: n8nRunning
        ? "n8n worker is on. Execution stays gated."
        : n8nScaffolded
          ? "n8n is offline, but scaffolded."
          : "Automation worker is planned.",
      safety: "No workflow executes and no webhook opens from Phantom.",
      inside: [
        { label: "Local worker", state: n8nRunning ? "running" : "off" },
        { label: "Workflow drafts", state: String(phantomAiOpsStatus.n8n.workflow_drafts.length) },
        { label: "Execution", state: "disabled" },
        { label: "Public webhooks", state: "blocked" },
      ],
      icon: <Settings size={18} />,
    },
    {
      id: "agentlab",
      label: "AgentLab",
      detail: "Internal workforce. Source-truth, review, and governance lanes.",
      value: agentSummary,
      status: "active",
      category: "systems",
      x: 910,
      y: 495,
      workspace: "agentlab",
      adminOnly: true,
      speech: "Internal workforce is admin-only.",
      safety: "Agents propose; humans approve. Nothing executes externally.",
      inside: [
        { label: "Codex source-truth", state: "active" },
        { label: "Claude reviewer", state: "read-only" },
        { label: "Agent Bridge spine", state: "manual" },
        { label: "OpenSpec / PhantomOps", state: "reference" },
        { label: "Serena", state: "planned" },
        { label: "Ruflo", state: "blocked" },
      ],
      icon: <Bot size={18} />,
    },
  ];

  const brainEdges: PhantomBrainEdge[] = [
    { id: "ai-leads", from: "phantom-ai", to: "leads", state: proposalCounts.total ? "live" : "ready" },
    { id: "leads-history", from: "leads", to: "proposal-history", state: proposalHistory.length ? "live" : "ready" },
    { id: "history-work", from: "proposal-history", to: "work", state: proposalCounts.follow_up_needed ? "live" : "ready" },
    { id: "history-money", from: "proposal-history", to: "money", state: estimatedPipelineValue ? "live" : "ready" },
    { id: "work-review", from: "work", to: "review", state: pendingApprovals.length ? "live" : "ready" },
    { id: "ai-video", from: "phantom-ai", to: "video", state: "ready" },
    { id: "ai-site", from: "phantom-ai", to: "site", state: "ready" },
    { id: "ai-protect", from: "phantom-ai", to: "protect", state: executionLocked ? "live" : "blocked" },
    { id: "protect-sends", from: "protect", to: "send-readiness", state: "gated" },
    { id: "sends-review", from: "send-readiness", to: "review", state: "gated", label: "manual send" },
    { id: "sends-sales", from: "send-readiness", to: "sales-connector", state: "planned" },
    { id: "ai-hermes", from: "phantom-ai", to: "hermes", state: phantomAiOpsStatus.hermes.ready ? "live" : "planned" },
    { id: "ai-n8n", from: "phantom-ai", to: "n8n", state: n8nRunning ? "live" : "gated" },
    { id: "agentlab-ai", from: "agentlab", to: "phantom-ai", state: "live" },
  ];

  const visibleBrainNodes = brainNodes.filter(
    (node) => (canManageAccess || !node.adminOnly) && canOpenPhantomDeckWorkspace(node.workspace, canManageAccess),
  );
  const visibleBrainNodeIds = new Set(visibleBrainNodes.map((node) => node.id));
  const visibleBrainEdges = brainEdges.filter(
    (edge) => visibleBrainNodeIds.has(edge.from) && visibleBrainNodeIds.has(edge.to),
  );
  const selectedBrainNode = visibleBrainNodes.find((node) => node.id === selectedBrainNodeId) ?? null;
  const companionMessage = selectedBrainNode
    ? {
        text: selectedBrainNode.speech ?? `${selectedBrainNode.label}: ${selectedBrainNode.value}.`,
        workspace: selectedBrainNode.workspace,
      }
    : companionSignal;

  const tickerItems = [
    ...(agentWorkforceStatus.role === "admin" ? agentWorkforceStatus.ticker.slice(0, 5).map((item) => item.text) : []),
    proposalCounts.follow_up_needed ? `${proposalCounts.follow_up_needed} proposal follow-up${proposalCounts.follow_up_needed === 1 ? "" : "s"} waiting.` : "Proposal follow-up lane is clear.",
    stats.today ? `${stats.today} work items active today.` : "No urgent work items blocking Phantom.",
    providerReady ? "Model lane is configured; external calls still stay gated by controls." : "Model lane gated/off until admin enables provider posture.",
    n8nRunning ? "Automation worker detected locally." : "Automation lane remains scaffolded and controlled.",
  ].filter(Boolean);

  const quickMoves: Array<{ label: string; workspace: PhantomDeckWorkspaceId; icon: ReactNode }> = [
    { label: "Handle Lead", workspace: "leads", icon: <Inbox size={14} /> },
    { label: "Build Quote", workspace: "proposal", icon: <FileText size={14} /> },
    { label: "Run Scan", workspace: "protect", icon: <ShieldCheck size={14} /> },
    { label: "Plan Work", workspace: "work", icon: <SquareCheckBig size={14} /> },
    { label: "Make Video", workspace: "video", icon: <Play size={14} /> },
    { label: "Review Queue", workspace: "review", icon: <Bell size={14} /> },
  ];
  const visibleQuickMoves = quickMoves.filter((move) =>
    canOpenPhantomDeckWorkspace(move.workspace, canManageAccess),
  );

  const atAGlanceItems = [
    { label: "Due today", value: String(stats.today), tone: "cyan" },
    { label: "Follow-ups", value: String(proposalCounts.follow_up_needed || stats.urgent), tone: "gold" },
    { label: "Pipeline", value: estimatedPipelineValue ? formatUsd(estimatedPipelineValue) : "$0", tone: "green" },
    { label: "Review", value: String(pendingApprovals.length), tone: "red" },
  ];

  const missionQueueItems = [
    {
      title: priorityProposal ? `${priorityProposal.client_name} follow-up` : "ChicagoShots proposal lane",
      detail: priorityProposal?.proposal_next_action ?? "No priority packet blocking revenue.",
      status: priorityProposal ? "QUEUED" : "CLEAR",
      workspace: priorityProposal ? ("followup" as PhantomDeckWorkspaceId) : ("proposal" as PhantomDeckWorkspaceId),
    },
    {
      title: "PhantomCut",
      detail: "Video and creative generation requests stay gated.",
      status: "READY",
      workspace: "video" as PhantomDeckWorkspaceId,
    },
    {
      title: "Security Intake",
      detail: "Autonomous scan proof and password cadence.",
      status: "WATCH",
      workspace: "protect" as PhantomDeckWorkspaceId,
    },
    {
      title: "Site + Store Studio",
      detail: "Website, app, dashboard, and storefront drafts.",
      status: "READY",
      workspace: "site" as PhantomDeckWorkspaceId,
    },
  ];
  const activeTasks = tasks.filter((task) => task.status !== "done");
  const nextTask = activeTasks[0] ?? tasks[0] ?? null;
  const draftReplyCount = emails.filter((email) => email.status === "needs-reply").length;
  const proposalReviewCount = proposalCounts.draft + proposalCounts.follow_up_needed;
  const openProposalCount = Math.max(
    0,
    proposalCounts.total - proposalCounts.won - proposalCounts.lost,
  );
  const compactPipelineValue = estimatedPipelineValue ? formatUsd(estimatedPipelineValue).replace(".00", "") : "$0";
  const glanceSignalCount = pendingApprovals.length + stats.today + proposalCounts.follow_up_needed;
  const protectRadarSignalCount =
    pendingApprovals.length +
    stats.revoked +
    (executionLocked ? 0 : 1) +
    (effectiveSendReadiness.send_enabled ? 1 : 0);
  const phantomWidgets: PhantomWidgetView[] = phantomWidgetRegistry.map((widget) => {
    switch (widget.id) {
      case "phantom-radar":
        return {
          ...widget,
          count: protectRadarSignalCount ? String(protectRadarSignalCount) : "Watch",
          shortStatus: protectRadarSignalCount
            ? `${protectRadarSignalCount} risk signal${protectRadarSignalCount === 1 ? "" : "s"} · leaks/breaches/malware watch`
            : "Quiet watch for leaks, breaches, malware, and risky habits.",
          emphasis: protectRadarSignalCount > 0,
          safetyNote: "Read-only. No cleanup or external action.",
        };
      case "proposal-forge":
        return {
          ...widget,
          count: String(proposalReviewCount),
          shortStatus: `${proposalCounts.draft} draft${proposalCounts.draft === 1 ? "" : "s"} · ${proposalCounts.follow_up_needed} need review`,
          emphasis: proposalReviewCount > 0,
          safetyNote: "Manual approval before send.",
        };
      case "work-board":
        return {
          ...widget,
          count: String(activeTasks.length || stats.today),
          shortStatus: nextTask ? `${nextTask.title} · ${nextTask.due}` : "No work item blocking Phantom.",
        };
      case "review-queue":
        return {
          ...widget,
          count: String(pendingApprovals.length),
          shortStatus: pendingApprovals.length
            ? `${pendingApprovals.length} waiting · nothing sends without approval`
            : "Clear · manual-send locks stay on",
          emphasis: pendingApprovals.length > 0,
          safetyNote: "Ask → Review → Approve → Act.",
        };
      case "access-keys":
        return {
          ...widget,
          count: String(clientAccess.length),
          shortStatus: `${stats.revoked} locked · admin/employee permissions`,
          emphasis: stats.revoked > 0,
        };
      case "money-pulse":
        return {
          ...widget,
          count: compactPipelineValue,
          shortStatus: `${openProposalCount} open proposal${openProposalCount === 1 ? "" : "s"} · invoices/payments planned`,
          safetyNote: "No invoice or payment route.",
        };
      case "site-studio":
        return {
          ...widget,
          count: "Ready",
          shortStatus: "Pages and app tasks are draft-only; deploy remains approval-gated.",
          safetyNote: "No deploy from this card.",
        };
      case "media-lab":
        return {
          ...widget,
          count: String(businessOpsSimulation.mediaRequests.length),
          shortStatus: "Video briefs, clips, and scheduled posts stay review-first.",
          safetyNote: "No upload or paid render.",
        };
      case "inbox-client-comms":
        return {
          ...widget,
          count: String(draftReplyCount),
          shortStatus: `${draftReplyCount} draft repl${draftReplyCount === 1 ? "y" : "ies"} · manual-send safe`,
          emphasis: draftReplyCount > 0,
          safetyNote: "No email leaves automatically.",
        };
      case "security-protect":
        return {
          ...widget,
          count: executionLocked ? "Locked" : "Review",
          shortStatus: executionLocked
            ? "Execution locks on · keys/passwords/routes watched"
            : "Review safety posture before enabling actions",
          emphasis: !executionLocked,
        };
      case "harbor-status":
        return {
          ...widget,
          count: providerReady ? "Live" : "Off",
          shortStatus: `${providerReady ? "GLM live" : "Provider off"} · ${
            n8nRunning ? "worker on" : "worker off"
          } · approval before external action`,
          safetyNote: "Status only.",
        };
      case "glance":
        return {
          ...widget,
          count: String(glanceSignalCount),
          shortStatus: `${pendingApprovals.length} approvals · ${nextTask?.title ?? "no next task"} · ${
            priorityProposal?.client_name ?? "no hot proposal"
          }`,
          emphasis: glanceSignalCount > 0,
        };
      default:
        return widget;
    }
  });

  const deckStyle = {
    "--ghost-look-x": `${pointer.x}px`,
    "--ghost-look-y": `${pointer.y}px`,
  } as CSSProperties;
  const visibleToolGroups = phantomToolGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => canOpenPhantomDeckWorkspace(item, canManageAccess)),
    }))
    .filter((group) => group.items.length);

  function handlePointerMove(event: MouseEvent<HTMLDivElement>) {
    const x = Math.max(-4, Math.min(4, (event.clientX - window.innerWidth / 2) / 120));
    const y = Math.max(-3, Math.min(3, (event.clientY - window.innerHeight / 2) / 140));
    setPointer({ x, y });
  }

  function openWorkspace(workspace: PhantomDeckWorkspaceId) {
    dismissBootHologram();
    if (!canOpenPhantomDeckWorkspace(workspace, canManageAccess)) {
      setActiveWorkspace("status");
      setToolsOpen(false);
      setGlanceOpen(false);
      setCommandSuggestions([]);
      setDeckNotice("That workspace is owner/admin-only.");
      return;
    }

    setActiveWorkspace(workspace);
    setAnswerMode(false);
    const highlighted =
      workspace === "status"
        ? visibleBrainNodes.find((node) => node.id === "phantom-ai")
        : visibleBrainNodes.find((node) => node.workspace === workspace);
    setSelectedBrainNodeId(highlighted?.id ?? null);
    setToolsOpen(false);
    setGlanceOpen(false);
    setCommandSuggestions([]);
    setDeckNotice(`${phantomDeckWorkspaceLabel(workspace)} workspace summoned.`);
  }

  function selectBrainNode(node: PhantomBrainNode) {
    if (selectedBrainNodeId === node.id) {
      openWorkspace(node.workspace);
      return;
    }

    setSelectedBrainNodeId(node.id);
    setDeckNotice(`${node.label}: ${node.detail}`);
  }

  function openToolOrbit() {
    dismissBootHologram();
    setActiveWorkspace(null);
    setAnswerMode(false);
    setToolsOpen(true);
    setGlanceOpen(false);
    setCommandSuggestions([]);
    setDeckNotice(canManageAccess ? "Phantom Harbor unlocked." : "Capability harbor opened.");
  }

  function toggleToolOrbit() {
    if (toolsOpen) {
      setToolsOpen(false);
      setDeckNotice("Phantom Harbor closed.");
      return;
    }

    openToolOrbit();
  }

  function toggleGlance() {
    dismissBootHologram();
    setGlanceOpen((open) => {
      const next = !open;
      if (next) {
        setActiveWorkspace(null);
        setAnswerMode(false);
        setToolsOpen(false);
        setCommandSuggestions([]);
        setDeckNotice("Glance summoned.");
      } else {
        setDeckNotice("Glance hidden.");
      }
      return next;
    });
  }

  function activatePhantomWidget(target: PhantomWidgetTarget) {
    const workspaceByTarget: Partial<Record<PhantomWidgetTarget, PhantomDeckWorkspaceId>> = {
      leads: "leads",
      proposal: "proposal",
      work: "work",
      review: "review",
      access: "access",
      money: "money",
      site: "site",
      video: "video",
      protect: "protect",
    };

    if (target === "harbor") {
      openToolOrbit();
      return;
    }

    if (target === "glance") {
      setActiveWorkspace(null);
      setSelectedBrainNodeId(null);
      setAnswerMode(false);
      setToolsOpen(false);
      setGlanceOpen(true);
      setCommandSuggestions([]);
      setDeckNotice("Glance summoned.");
      return;
    }

    if (target === "inbox") {
      setRoute("inbox");
      setDeckNotice("Inbox opened. Drafts remain manual-send safe.");
      return;
    }

    const workspace = workspaceByTarget[target];
    if (workspace) {
      openWorkspace(workspace);
      return;
    }

    setActiveWorkspace("status");
    setToolsOpen(false);
    setGlanceOpen(false);
    setCommandSuggestions([]);
    setDeckNotice("Safe module shell opened.");
  }

  function seedAgentCapabilityIntent(intent: string, workspace: PhantomDeckWorkspaceId) {
    setCommandText(intent);
    setActiveWorkspace(null);
    setAnswerMode(false);
    setToolsOpen(false);
    setGlanceOpen(false);
    setCommandSuggestions([workspace]);
    setDeckNotice("Intent loaded. Send it when ready, or edit first.");
    window.setTimeout(() => commandInputRef.current?.focus(), 0);
  }

  async function submitDeckCommand(event: FormEvent) {
    event.preventDefault();
    const rawCommand = commandText.trim();
    if (!rawCommand || phantomAiBusy) return;

    dismissBootHologram();
    setSubmittedPrompt(rawCommand);
    setAnswerMode(true);
    setActiveWorkspace(null);
    setSelectedBrainNodeId(null);
    setToolsOpen(false);
    setGlanceOpen(false);
    setCommandSuggestions([]);

    const normalizedCommand = commandText.trim().toLowerCase();
    if (/\b(glance|overview|snapshot|brief|what'?s up)\b/.test(normalizedCommand)) {
      setDeckNotice("PhantomForce is answering and opening the glance.");
      await runPhantomCommand(rawCommand);
      setGlanceOpen(true);
      return;
    }

    const nextWorkspace = resolvePhantomDeckWorkspace(commandText, canManageAccess);
    setDeckNotice(nextWorkspace ? `PhantomForce is answering and routing ${phantomDeckWorkspaceLabel(nextWorkspace)}.` : "PhantomForce is answering.");
    await runPhantomCommand(rawCommand);

    if (nextWorkspace && nextWorkspace !== "help") {
      setCommandSuggestions([nextWorkspace]);
      setSelectedBrainNodeId(visibleBrainNodes.find((node) => node.workspace === nextWorkspace)?.id ?? null);
      setDeckNotice(`Answer ready. ${phantomDeckWorkspaceLabel(nextWorkspace)} is the matching workspace.`);
      return;
    }

    if (nextWorkspace === "help") {
      setCommandSuggestions([]);
      setDeckNotice("Answer ready. Phantom Harbor can show the available lanes.");
      return;
    }

    const suggestions = suggestPhantomDeckWorkspaces(rawCommand, canManageAccess);
    setCommandSuggestions(suggestions);
    setDeckNotice(suggestions.length ? "Answer ready. Closest moves are ready below." : "Answer ready.");
  }

  function closeWorkspace() {
    setActiveWorkspace(null);
    setAnswerMode(false);
    setDeckNotice("Workspace minimized.");
  }

  const assistantAnswerText =
    phantomAiBusy && submittedPrompt
        ? `Working on: ${submittedPrompt}`
      : answerMode && latestAssistant
        ? latestAssistant.content
        : companionMessage.text;
  const answerModeActive = answerMode || Boolean(phantomAiBusy && submittedPrompt);
  const showBootHologram = bootHologramVisible && !answerModeActive && !submittedPrompt && !activeWorkspace;
  const workspaceOverlay =
    activeWorkspace && activeWorkspaceMeta ? (
      <ActiveWorkspace
        workspace={activeWorkspace}
        workspaceMeta={activeWorkspaceMeta}
        deckLoading={deckLoading}
        deckNotice={deckNotice}
        proposalHistory={proposalHistory}
        proposalCounts={proposalCounts}
        priorityProposal={priorityProposal}
        estimatedPipelineValue={estimatedPipelineValue}
        phantomAiOpsStatus={phantomAiOpsStatus}
        opsContext={opsContext}
        salesConnector={salesConnector}
        sendReadiness={effectiveSendReadiness}
        toolLanePreview={toolLanePreview}
        n8nLocalUrl={n8nLocalUrl}
        providerReady={providerReady}
        agentSummary={agentSummary}
        latestAssistant={latestAssistant}
        stats={stats}
        approvals={approvals}
        pendingApprovals={pendingApprovals}
        approveAction={approveAction}
        rejectAction={rejectAction}
        emails={emails}
        events={events}
        tasks={tasks}
        activity={activity}
        clientAccess={clientAccess}
        sessionHeaders={sessionHeaders}
        canManageAccess={canManageAccess}
        selectedOrg={selectedOrg}
        selectedWorkspaceClient={selectedWorkspaceClient}
        setRoute={setRoute}
        closeWorkspace={closeWorkspace}
      />
    ) : null;

  return (
    <section
      className={`phantom-deck v2 v3${activeWorkspace ? " has-workspace" : ""}${toolsOpen ? " tools-open" : ""}${glanceOpen ? " glance-open" : ""}${showBootHologram ? " boot-hologram-visible" : " boot-hologram-complete"}`}
      style={deckStyle}
      onMouseMove={handlePointerMove}
    >
      <div className="phantom-deck-main">
        <header className="phantom-deck-header">
          <div className="phantom-brand-lockup">
            <span className="mini-ghost" />
            <div>
              <strong>PhantomForce</strong>
              <span>PHANTOM DECK</span>
            </div>
          </div>
          <div className="phantom-top-chips" aria-label="Live deck readouts">
            <span className="chip-primary">{deckPosture} · {sendPosture}</span>
            <span className="chip-secondary">{selectedOrg}</span>
            <span className="chip-secondary">{canManageAccess ? "Admin" : "Employee"}</span>
            <span className="chip-secondary">Live Internal</span>
            {canManageAccess ? <span className="chip-secondary">{n8nRunning ? "Worker On" : "Worker Off"}</span> : null}
            {viewingClientWorkspace ? <span className="chip-secondary">Employee mirror</span> : null}
          </div>
          <div className="phantom-top-actions">
            <button type="button" title="Search">
              <Search size={17} />
            </button>
            <button type="button" title="Settings">
              <Settings size={17} />
            </button>
          </div>
        </header>

        <section className="phantom-command-stage" aria-label="Phantom intelligence center">
          <div className="phantom-command-orb" aria-hidden="true" />
          <div className="phantom-command-core">
            <div className="mission-control-panel">
              <div className="mission-control-head">
                <span className="eyebrow">AI Command Center</span>
                <strong>Phantom Sense</strong>
                <p>What's the mission, Commander?</p>
              </div>
              <div className="phantom-command-dock">
                <form className={`phantom-command ${commandFocused ? "focused" : ""}`} onSubmit={submitDeckCommand}>
                  <span className="phantom-command-label">Intent</span>
                  <Sparkles size={25} />
                  <input
                    ref={commandInputRef}
                    value={commandText}
                    onChange={(event) => setCommandText(event.target.value)}
                    onFocus={() => setCommandFocused(true)}
                    onBlur={() => setCommandFocused(false)}
                    placeholder="Ask Phantom Sense anything..."
                    disabled={phantomAiBusy}
                  />
                  <button type="submit" title="Run command" disabled={phantomAiBusy}>
                    {phantomAiBusy ? <RefreshCcw size={20} /> : <ArrowRight size={21} />}
                  </button>
                </form>
                <button
                  className={`tool-orbit-button harbor${toolsOpen ? " active" : ""}`}
                  type="button"
                  onClick={toggleToolOrbit}
                  aria-expanded={toolsOpen}
                  title="Open more actions"
                >
                  <Sparkles size={18} />
                  <span>More</span>
                </button>
              </div>
              <PhantomWidgetRail widgets={phantomWidgets} activateWidget={activatePhantomWidget} />
              <PhantomOpsLivePanel
                activeCount={agentActiveCount}
                totalCount={agentTotalCount}
                taskCount={agentTasksInWindow}
                tokenCount={agentTokensInWindow}
                spend={agentSpendInWindow}
                windowHours={agentWindowHours}
                events={agentPulseEvents}
                capabilities={agentCapabilityChips}
                openWorkspace={openWorkspace}
                seedIntent={seedAgentCapabilityIntent}
              />
              <div className="quick-moves" aria-label="Suggested PhantomForce moves">
                {visibleQuickMoves.map((move) => (
                  <button
                    key={move.label}
                    className={activeWorkspace === move.workspace ? "active" : ""}
                    type="button"
                    onClick={() => openWorkspace(move.workspace)}
                  >
                    {move.icon}
                    <span>{move.label}</span>
                  </button>
                ))}
                <button
                  className={`glance-toggle${glanceOpen ? " active" : ""}`}
                  type="button"
                  onClick={toggleGlance}
                >
                  <BarChart3 size={14} />
                  <span>Glance</span>
                </button>
              </div>
            </div>

            {showBootHologram ? (
              <div className="phantom-holo-stage" aria-label="PhantomForce AI startup hologram">
                <PhantomCompanion
                  mood={companionMood}
                  speech={assistantAnswerText}
                  thinking={commandFocused || deckLoading || phantomAiBusy}
                  oracle={Boolean(assistantAnswerText)}
                  answerMode={answerModeActive}
                  onSpeechClick={answerModeActive ? undefined : () => openWorkspace(companionMessage.workspace)}
                />
                <span className="holo-label">PHANTOMFORCE AI</span>
              </div>
            ) : null}

            <div className={`phantom-intel-stack${glanceOpen ? " summoned" : ""}`} aria-label="Phantom intelligence">
              {canManageAccess ? (
                <section className="intel-card workspace-context-card">
                  <div className="section-head compact">
                    <h3>Viewing</h3>
                    <span>{viewingClientWorkspace ? "Employee" : "Owner"}</span>
                  </div>
                  <strong>{selectedOrg}</strong>
                  <p>
                    {viewingClientWorkspace
                      ? `Admin mirror of ${selectedWorkspaceClient?.business ?? selectedOrg}: ${selectedWorkspaceClient?.plan ?? "workspace"}`
                      : "Admin phantom with the full business suite available."}
                  </p>
                </section>
              ) : null}
              <section className="intel-card at-glance-card">
                <div className="section-head compact">
                  <h3>At a glance</h3>
                  <span>Live</span>
                </div>
                {atAGlanceItems.map((item) => (
                  <article key={item.label} className={`glance-row ${item.tone}`}>
                    <strong>{item.value}</strong>
                    <span>{item.label}</span>
                  </article>
                ))}
              </section>
              <section className="intel-card mission-queue-card">
                <div className="section-head compact">
                  <h3>Mission queue</h3>
                  <span>{missionQueueItems.length}</span>
                </div>
                {missionQueueItems.map((item) => (
                  <button key={item.title} type="button" onClick={() => openWorkspace(item.workspace)}>
                    <span>
                      <strong>{item.title}</strong>
                      <small>{item.detail}</small>
                    </span>
                    <em>{item.status}</em>
                  </button>
                ))}
              </section>
              <section className="intel-card resource-vault-card">
                <div className="section-head compact">
                  <h3>Resource vault</h3>
                  <span>Ready</span>
                </div>
                <div>
                  <button type="button" onClick={() => openWorkspace("site")}>Docs</button>
                  <button type="button" onClick={() => openWorkspace("video")}>Assets</button>
                    {canManageAccess ? <button type="button" onClick={() => openWorkspace("access")}>Access</button> : null}
                    {canManageAccess ? <button type="button" onClick={() => openWorkspace("brain")}>Brain</button> : null}
                </div>
              </section>
            </div>

            {toolsOpen ? (
              <div className="tool-orbit-menu" aria-label="Phantom Harbor unlocked capabilities">
                {canManageAccess ? (
                  <div className="harbor-head">
                    <Sparkles size={15} />
                    <strong>Phantom Harbor</strong>
                    <span>Admin capabilities unlocked</span>
                  </div>
                ) : null}
                {visibleToolGroups.map((group) => (
                  <div key={group.id} className={`tool-orbit-cluster ${group.id}`}>
                    <span className="tool-orbit-group-label">{group.label}</span>
                    <div className="tool-orbit-cluster-items">
                      {group.items.map((id) => {
                        const workspace = phantomDeckWorkspaces.find((item) => item.id === id)!;
                        return (
                          <button
                            key={workspace.id}
                            className={`tool-orbit-node ${group.id}`}
                            type="button"
                            onClick={() => openWorkspace(workspace.id)}
                            title={workspace.label}
                            aria-label={workspace.label}
                          >
                            {workspace.icon}
                            <span>{workspace.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </section>

        <PhantomActivityTicker items={tickerItems} />

        <PulseStrip items={pulseItems} activeWorkspace={activeWorkspace} setActiveWorkspace={openWorkspace} />

        <div className={`phantom-deck-body ${activeWorkspace ? "has-active-workspace" : "brain-default"}`} aria-live="polite">
          <PhantomBrainMap
            nodes={visibleBrainNodes}
            edges={visibleBrainEdges}
            activeWorkspace={activeWorkspace}
            selectedNode={selectedBrainNode}
            suggestions={commandSuggestions}
            deckNotice={deckNotice}
            deckLoading={deckLoading}
            selectNode={selectBrainNode}
            openWorkspace={openWorkspace}
          />
        </div>
      </div>
      {workspaceOverlay && typeof document !== "undefined" ? createPortal(
        <div className="workspace-focus-overlay" role="dialog" aria-modal="true" aria-label={`${activeWorkspaceMeta?.label ?? "Workspace"} workspace`}>
          <button
            className="workspace-focus-backdrop"
            type="button"
            aria-label="Close workspace overlay"
            onClick={closeWorkspace}
          />
          <div className="workspace-focus-panel">{workspaceOverlay}</div>
        </div>,
        document.body,
      ) : null}
    </section>
  );
}

function phantomWidgetIcon(iconKey: string, size = 17) {
  switch (iconKey) {
    case "radar":
      return <Search size={size} />;
    case "proposal":
      return <FileText size={size} />;
    case "work":
      return <SquareCheckBig size={size} />;
    case "review":
      return <ShieldCheck size={size} />;
    case "keys":
      return <KeyRound size={size} />;
    case "money":
      return <BarChart3 size={size} />;
    case "site":
      return <Link2 size={size} />;
    case "media":
      return <Play size={size} />;
    case "inbox":
      return <MessageSquare size={size} />;
    case "protect":
      return <Lock size={size} />;
    case "harbor":
      return <Sparkles size={size} />;
    case "glance":
      return <Star size={size} />;
    default:
      return <Sparkles size={size} />;
  }
}

const phantomWidgetSafetyLabels: Record<PhantomWidgetView["safetyLevel"], string> = {
  safe: "Safe",
  manual: "Manual",
  approval: "Approval",
  planned: "Planned",
};

function PhantomWidgetRail({
  widgets,
  activateWidget,
}: {
  widgets: PhantomWidgetView[];
  activateWidget: (target: PhantomWidgetTarget) => void;
}) {
  return (
    <section className="phantom-widget-section" aria-label="PhantomForce magic widgets">
      <div className="phantom-widget-section-head">
        <span>Live tools</span>
        <strong>Ask first. Review before action.</strong>
      </div>
      <div className="phantom-widget-rail">
        {widgets.map((widget) => (
          <PhantomWidget key={widget.id} widget={widget} activateWidget={activateWidget} />
        ))}
      </div>
    </section>
  );
}

function PhantomWidget({
  widget,
  activateWidget,
}: {
  widget: PhantomWidgetView;
  activateWidget: (target: PhantomWidgetTarget) => void;
}) {
  const count = widget.count ?? "";
  const safetyLabel = phantomWidgetSafetyLabels[widget.safetyLevel];

  return (
    <button
      className={`phantom-widget variant-${widget.animationVariant} safety-${widget.safetyLevel}${
        widget.emphasis ? " is-hot" : ""
      }`}
      type="button"
      onClick={() => activateWidget(widget.target)}
      aria-label={`${widget.title}: ${widget.shortStatus}. ${widget.primaryActionLabel}.`}
    >
      <span className="phantom-widget-aura" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className="phantom-widget-topline">
        <span className="phantom-widget-icon">{phantomWidgetIcon(widget.iconKey)}</span>
        {count ? <strong>{count}</strong> : null}
      </span>
      <span className="phantom-widget-copy">
        <span>{widget.title}</span>
        <small>{widget.shortStatus}</small>
      </span>
      <span className="phantom-widget-footer">
        <em>{safetyLabel}</em>
        {widget.requiresApproval ? <b>Review</b> : null}
        <i>{widget.primaryActionLabel}</i>
      </span>
      {widget.safetyNote ? <span className="phantom-widget-safety">{widget.safetyNote}</span> : null}
    </button>
  );
}

function PhantomOpsLivePanel({
  activeCount,
  totalCount,
  taskCount,
  tokenCount,
  spend,
  windowHours,
  events,
  capabilities,
  openWorkspace,
  seedIntent,
}: {
  activeCount: number;
  totalCount: number;
  taskCount: number;
  tokenCount: number;
  spend: number;
  windowHours: number;
  events: AgentPulseEvent[];
  capabilities: Array<{ label: string; detail: string; intent: string; workspace: PhantomDeckWorkspaceId }>;
  openWorkspace: (workspace: PhantomDeckWorkspaceId) => void;
  seedIntent: (intent: string, workspace: PhantomDeckWorkspaceId) => void;
}) {
  const leadEvent = events[0];

  return (
    <section className="phantomops-live-panel" aria-label="PhantomOps live proof">
      <div className="phantomops-panel-head">
        <div>
          <span className="eyebrow">PhantomOps</span>
          <h3>{activeCount} specialists watching</h3>
        </div>
        <span className="phantomops-deploy-badge">
          <i />
          {totalCount} mapped
        </span>
      </div>

      <div className="phantomops-metrics" aria-label="PhantomOps status metrics">
        <article>
          <strong>{formatNumber(taskCount)}</strong>
          <span>{windowHours}h actions</span>
        </article>
        <article>
          <strong>{formatNumber(tokenCount)}</strong>
          <span>tokens</span>
        </article>
        <article>
          <strong>{formatUsd(spend)}</strong>
          <span>tracked</span>
        </article>
      </div>

      {leadEvent ? (
        <button
          className={`phantomops-lead-event tone-${leadEvent.tone}`}
          type="button"
          onClick={() => openWorkspace(leadEvent.workspace)}
        >
          <span className="agent-avatar">{leadEvent.agent.slice(0, 1)}</span>
          <span>
            <strong>{leadEvent.agent}</strong>
            <small>{leadEvent.role} · {leadEvent.time}</small>
            <em>{leadEvent.action}</em>
          </span>
        </button>
      ) : null}

      <div className="phantomops-feed" aria-label="Named agent activity feed">
        {events.slice(1).map((event) => (
          <button
            key={event.id}
            className={`phantomops-feed-item tone-${event.tone}`}
            type="button"
            onClick={() => openWorkspace(event.workspace)}
          >
            <span className="agent-pulse-dot" />
            <span>
              <strong>{event.agent}</strong>
              <em>{event.action}</em>
              <small>{event.source} · {event.time}</small>
            </span>
          </button>
        ))}
      </div>

      <div className="phantomops-capability-strip" aria-label="PhantomOps capabilities">
        {capabilities.map((capability) => (
          <button key={capability.label} type="button" onClick={() => seedIntent(capability.intent, capability.workspace)}>
            <strong>{capability.label}</strong>
            <span>{capability.detail}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function PhantomActivityTicker({ items }: { items: string[] }) {
  const ticker = items.length ? items : ["PhantomForce is watching for the next signal."];

  return (
    <section className="phantom-live-ticker" aria-label="Live PhantomForce activity">
      <span>FORCEWIRE</span>
      <div>
        <p>
          {[...ticker, ...ticker].map((item, index) => (
            <b key={`${item}-${index}`}>{item}</b>
          ))}
        </p>
      </div>
    </section>
  );
}

const BRAIN_MAP_WIDTH = 1000;
const BRAIN_MAP_HEIGHT = 560;

const brainStatusLabels: Record<PhantomBrainNodeStatus, string> = {
  active: "Active",
  ready: "Ready",
  gated: "Gated",
  manual: "Manual",
  planned: "Planned",
  disabled: "Disabled",
  needs_review: "Needs review",
  blocked: "Blocked",
};

function brainEdgePath(from: PhantomBrainNode, to: PhantomBrainNode, sag = 0) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) < 48) {
    return `M ${from.x} ${from.y} C ${from.x} ${from.y + dy * 0.4}, ${to.x} ${to.y - dy * 0.4}, ${to.x} ${to.y}`;
  }
  return `M ${from.x} ${from.y} C ${from.x + dx * 0.42} ${from.y + sag}, ${to.x - dx * 0.42} ${to.y + sag}, ${to.x} ${to.y}`;
}

const brainEdgeSags: Record<string, number> = {
  "ai-n8n": 110,
  "agentlab-ai": 70,
};

function PhantomBrainMap({
  nodes,
  edges,
  activeWorkspace,
  selectedNode,
  suggestions,
  deckNotice,
  deckLoading,
  selectNode,
  openWorkspace,
}: {
  nodes: PhantomBrainNode[];
  edges: PhantomBrainEdge[];
  activeWorkspace: PhantomDeckWorkspaceId | null;
  selectedNode: PhantomBrainNode | null;
  suggestions: PhantomDeckWorkspaceId[];
  deckNotice: string;
  deckLoading: boolean;
  selectNode: (node: PhantomBrainNode) => void;
  openWorkspace: (workspace: PhantomDeckWorkspaceId) => void;
}) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const suggestedWorkspaces = suggestions
    .map((id) => phantomDeckWorkspaces.find((workspace) => workspace.id === id))
    .filter(Boolean) as Array<(typeof phantomDeckWorkspaces)[number]>;
  const legendStatuses = (Object.keys(brainStatusLabels) as PhantomBrainNodeStatus[]).filter((status) =>
    nodes.some((node) => node.status === status),
  );
  const connectedToSelected = selectedNode
    ? edges
        .flatMap((edge) => {
          if (edge.from !== selectedNode.id && edge.to !== selectedNode.id) return [];
          const other = nodeById.get(edge.from === selectedNode.id ? edge.to : edge.from);
          if (!other) return [];
          return [{ node: other, direction: edge.from === selectedNode.id ? "out" : "in", state: edge.state, label: edge.label }];
        })
    : [];

  return (
    <section
      className={`phantom-nervous-system brain-map${activeWorkspace ? " compact" : ""}`}
      aria-label="PhantomForce living system map"
    >
      <div className="nervous-head">
        <div>
          <span className="eyebrow">{deckLoading ? "Syncing system" : "Living system map"}</span>
          <h2>One signal finds the right move.</h2>
          <p>{deckNotice}</p>
        </div>
        <div className="brain-legend" aria-label="Node status legend">
          {legendStatuses.map((status) => (
            <span key={status} className={`status-${status}`}>
              <i />
              {brainStatusLabels[status]}
            </span>
          ))}
        </div>
      </div>

      <div className="brain-map-stage" role="group" aria-label="System nodes and flows">
        <svg
          className="brain-edges"
          viewBox={`0 0 ${BRAIN_MAP_WIDTH} ${BRAIN_MAP_HEIGHT}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {edges.map((edge) => {
            const from = nodeById.get(edge.from);
            const to = nodeById.get(edge.to);
            if (!from || !to) return null;
            const dimmed = selectedNode && edge.from !== selectedNode.id && edge.to !== selectedNode.id;
            return (
              <g key={edge.id} className={`brain-edge ${edge.state}${dimmed ? " dimmed" : ""}`}>
                <path id={`brain-edge-${edge.id}`} d={brainEdgePath(from, to, brainEdgeSags[edge.id] ?? 0)} />
                {edge.state === "live" ? (
                  <>
                    <circle className="brain-pulse" r="3.2">
                      <animateMotion dur="5.2s" repeatCount="indefinite">
                        <mpath href={`#brain-edge-${edge.id}`} />
                      </animateMotion>
                    </circle>
                    <circle className="brain-pulse faint" r="2.1">
                      <animateMotion dur="5.2s" begin="-2.6s" repeatCount="indefinite">
                        <mpath href={`#brain-edge-${edge.id}`} />
                      </animateMotion>
                    </circle>
                  </>
                ) : null}
              </g>
            );
          })}
        </svg>

        {nodes.map((node) => (
          <button
            key={node.id}
            className={`brain-node status-${node.status}${node.id === "phantom-ai" ? " hub" : ""}${
              selectedNode?.id === node.id ? " selected" : ""
            }${activeWorkspace === node.workspace ? " routed" : ""}`}
            style={{
              left: `${(node.x / BRAIN_MAP_WIDTH) * 100}%`,
              top: `${(node.y / BRAIN_MAP_HEIGHT) * 100}%`,
            }}
            type="button"
            onClick={() => selectNode(node)}
            title={node.detail}
          >
            <span className="brain-node-icon">{node.icon}</span>
            <span className="brain-node-copy">
              <strong>{node.label}</strong>
              <small>{node.value}</small>
            </span>
            <i className="brain-node-dot" aria-hidden="true" />
          </button>
        ))}
      </div>

      {selectedNode ? (
        <div className="brain-detail" aria-live="polite">
          <div className="brain-detail-head">
            <span className={`brain-status-chip status-${selectedNode.status}`}>
              {brainStatusLabels[selectedNode.status]}
            </span>
            <strong>{selectedNode.label}</strong>
            <em>{selectedNode.value}</em>
            <button className="brain-detail-open" type="button" onClick={() => openWorkspace(selectedNode.workspace)}>
              <span>Open workspace</span>
              <ArrowRight size={14} />
            </button>
          </div>
          <p>{selectedNode.detail}</p>
          {selectedNode.inside?.length ? (
            <div className="brain-detail-inside">
              {selectedNode.inside.map((item) => (
                <span key={item.label}>
                  <strong>{item.label}</strong>
                  <em>{item.state}</em>
                </span>
              ))}
            </div>
          ) : null}
          {connectedToSelected.length ? (
            <div className="brain-detail-flows">
              <span>Flows</span>
              {connectedToSelected.map((connection) => (
                <button key={connection.node.id} type="button" onClick={() => selectNode(connection.node)}>
                  {connection.direction === "out" ? "→" : "←"} {connection.node.label}
                  {connection.label ? <small>{connection.label}</small> : null}
                </button>
              ))}
            </div>
          ) : null}
          {selectedNode.safety ? (
            <p className="brain-detail-safety">
              <Lock size={12} />
              {selectedNode.safety}
            </p>
          ) : null}
        </div>
      ) : null}

      {suggestedWorkspaces.length ? (
        <div className="phantom-command-suggestions" aria-label="Closest intent matches">
          <span>Closest moves</span>
          {suggestedWorkspaces.map((workspace) => (
            <button key={workspace.id} type="button" onClick={() => openWorkspace(workspace.id)}>
              {workspace.icon}
              <strong>{workspace.label}</strong>
              <small>{workspace.detail}</small>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function PulseStrip({
  items,
  activeWorkspace,
  setActiveWorkspace,
}: {
  items: Array<{ key: string; label: string; value: string; tone: PhantomDeckPulseTone }>;
  activeWorkspace: PhantomDeckWorkspaceId | null;
  setActiveWorkspace: (workspace: PhantomDeckWorkspaceId) => void;
}) {
  return (
    <div className="pulse-strip" aria-label="PhantomForce live pulse">
      {items.map((item) => {
        const workspace = item.key === "send" || item.key === "provider" ? "status" : (item.key as PhantomDeckWorkspaceId);
        const active = activeWorkspace === workspace;
        return (
          <button
            key={item.key}
            className={`pulse-chip ${item.tone} tone-${item.tone}${active ? " active" : ""}`}
            type="button"
            onClick={() => setActiveWorkspace(workspace)}
          >
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </button>
        );
      })}
    </div>
  );
}

function PhantomCompanion({
  mood,
  speech,
  thinking,
  oracle = false,
  answerMode = false,
  onSpeechClick,
}: {
  mood: PhantomDeckMood;
  speech: string;
  thinking: boolean;
  oracle?: boolean;
  answerMode?: boolean;
  onSpeechClick?: () => void;
}) {
  return (
    <aside
      className={`phantom-companion ${mood}${thinking ? " thinking" : ""}${oracle ? " oracle" : ""}${answerMode ? " answer-mode" : ""}`}
      aria-label="Phantom companion"
    >
      {answerMode ? (
        <div className="phantom-answer-card" role="status" aria-live="polite">
          <span>{speech.startsWith("Working on:") ? "PhantomForce is working" : "PhantomForce answer"}</span>
          <div className="phantom-answer-body">{renderPhantomAnswerText(speech)}</div>
        </div>
      ) : onSpeechClick ? (
          <button className="phantom-speech" type="button" onClick={onSpeechClick}>
            {speech}
          </button>
      ) : (
        <div className="phantom-speech">{speech}</div>
      )}
      {answerMode ? null : (
        <div className="phantom-ghost" aria-hidden="true">
          <span className="ghost-particle-field" />
          <span className="ghost-alert-dot" />
          <span className="ghost-eye left" />
          <span className="ghost-eye right" />
          <span className="ghost-tail one" />
          <span className="ghost-tail two" />
          <span className="ghost-tail three" />
        </div>
      )}
    </aside>
  );
}

function renderPhantomAnswerText(value: string) {
  const lines = value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  return (lines.length ? lines : [value]).map((line, lineIndex) => (
    <p key={`${line}-${lineIndex}`}>{renderPhantomAnswerInline(line)}</p>
  ));
}

function renderPhantomAnswerInline(value: string) {
  return value.split(/(\*\*[^*]+\*\*)/g).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong>;
    }

    return <span key={`${part}-${index}`}>{part}</span>;
  });
}

function ActiveWorkspace({
  workspace,
  workspaceMeta,
  deckLoading,
  deckNotice,
  proposalHistory,
  proposalCounts,
  priorityProposal,
  estimatedPipelineValue,
  phantomAiOpsStatus,
  opsContext,
  salesConnector,
  sendReadiness,
  toolLanePreview,
  n8nLocalUrl,
  providerReady,
  agentSummary,
  latestAssistant,
  stats,
  approvals,
  pendingApprovals,
  approveAction,
  rejectAction,
  emails,
  events,
  tasks,
  activity,
  clientAccess,
  sessionHeaders,
  canManageAccess,
  selectedOrg,
  selectedWorkspaceClient,
  setRoute,
  closeWorkspace,
}: {
  workspace: PhantomDeckWorkspaceId;
  workspaceMeta: (typeof phantomDeckWorkspaces)[number];
  deckLoading: boolean;
  deckNotice: string;
  proposalHistory: ChicagoShotsProposalHistoryRecord[];
  proposalCounts: ChicagoShotsProposalStatusCounts;
  priorityProposal: ChicagoShotsProposalHistoryRecord | null;
  estimatedPipelineValue: number;
  phantomAiOpsStatus: PhantomAiOpsStatus;
  opsContext: PhantomDeckOpsContext | null;
  salesConnector: PhantomDeckSalesConnectorStatus | null;
  sendReadiness: PhantomAiOpsStatus["send_readiness"];
  toolLanePreview: PhantomDeckToolLanePreview | null;
  n8nLocalUrl: string;
  providerReady: boolean;
  agentSummary: string;
  latestAssistant?: Message;
  stats: { urgent: number; pending: number; today: number; events: number; revoked: number };
  approvals: Approval[];
  pendingApprovals: Approval[];
  approveAction: (id: string) => void;
  rejectAction: (id: string) => void;
  emails: EmailItem[];
  events: CalendarEvent[];
  tasks: TaskItem[];
  activity: ActivityItem[];
  clientAccess: ClientAccess[];
  sessionHeaders: (json?: boolean) => Record<string, string>;
  canManageAccess: boolean;
  selectedOrg: string;
  selectedWorkspaceClient?: ClientAccess;
  setRoute: (route: Route) => void;
  closeWorkspace: () => void;
}) {
  const sortedProposalHistory = sortChicagoShotsProposalHistory(proposalHistory);
  const followUpProposals = sortedProposalHistory.filter(
    (record) =>
      record.status === "follow_up_needed" ||
      record.proposal_priority_label === "follow_up_now" ||
      record.proposal_priority_label === "send_now",
  );

  return (
    <section className={`active-workspace workspace-${workspace}`} aria-live="polite">
      <div className="active-workspace-head">
        <div>
          <span className="eyebrow">{deckLoading ? "Syncing" : deckNotice}</span>
          <h2>{workspaceMeta.label}</h2>
          <p>{workspaceMeta.detail}</p>
        </div>
        <div className="active-workspace-actions">
          {workspaceMeta.route && (canManageAccess || !ADMIN_ONLY_ROUTES.has(workspaceMeta.route)) ? (
            <button className="deck-icon-button" type="button" onClick={() => setRoute(workspaceMeta.route!)}>
              <ArrowRight size={17} />
              <span>Full surface</span>
            </button>
          ) : null}
          <button className="deck-icon-button icon-only" type="button" onClick={closeWorkspace} title="Minimize workspace">
            <X size={17} />
          </button>
        </div>
      </div>

      {workspace === "status" ? (
        <div className="deck-grid">
          <DeckMetric label="Ops" value={phantomAiOpsStatus.product_status} detail="Read-only owner status." tone="good" />
          <DeckMetric
            label="Memory"
            value={phantomAiOpsStatus.hermes.ready ? "Ready" : phantomAiOpsStatus.hermes.status}
            detail={`${opsContext?.memory?.recalled_count ?? 0} recalled memories. Ledger writes remain blocked here.`}
            tone={phantomAiOpsStatus.hermes.ready ? "good" : "muted"}
          />
          <DeckMetric
            label="Provider"
            value={providerReady ? "Ready" : "Gated/off"}
            detail={phantomAiOpsStatus.glm_worker.detail}
            tone={providerReady ? "warn" : "good"}
          />
          <DeckMetric
            label="Workforce"
            value={canManageAccess ? agentSummary : "Hidden"}
            detail={canManageAccess ? "Internal workforce status stays admin-only." : "Employee view shows assigned outcomes, not worker internals."}
            tone="good"
          />
          <DeckMetric
            label="Viewing"
            value={selectedOrg}
            detail={
              selectedWorkspaceClient
                ? `${selectedWorkspaceClient.owner} · ${selectedWorkspaceClient.plan}`
                : "Owner-level workspace"
            }
            tone={selectedWorkspaceClient ? "warn" : "good"}
          />
          <DeckMetric
            label="Sales connector"
            value={salesConnector?.status ?? "planned"}
            detail={salesConnector?.reason ?? "Disabled until a real connector is implemented."}
            tone="muted"
          />
          <DeckMetric
            label="Send readiness"
            value={sendReadiness.send_enabled ? "Enabled" : "Draft-only"}
            detail="Manual operator confirmation required before any future send."
            tone={sendReadiness.send_enabled ? "warn" : "good"}
          />
          <section className="deck-wide-card">
            <div className="section-head compact">
              <div>
                <span className="eyebrow">Latest local assistant state</span>
                <h3>{latestAssistant?.missionTitle ?? "No recent mission"}</h3>
              </div>
              <TruthBadge state="real" label="No provider call from deck" />
            </div>
            <p>{latestAssistant?.content ?? "The deck input opens local workspaces. PhantomAI chat remains preserved elsewhere in the app contract."}</p>
          </section>
        </div>
      ) : null}

      {workspace === "leads" ? (
        <div className="deck-stack">
          <div className="deck-grid compact-metrics">
            <DeckMetric label="Saved packets" value={String(proposalCounts.total)} detail="From ChicagoShots proposal history." tone="good" />
            <DeckMetric label="Follow-up" value={String(proposalCounts.follow_up_needed)} detail="Needs Jordan's manual next step." tone={proposalCounts.follow_up_needed ? "alert" : "good"} />
            <DeckMetric label="Sent manual" value={String(proposalCounts.sent_manually)} detail="Tracked only; no external send." tone="good" />
            <DeckMetric label="Won" value={String(proposalCounts.won)} detail="Ready for delivery kickoff." tone={proposalCounts.won ? "good" : "muted"} />
          </div>
          {priorityProposal ? <PriorityProposalCard record={priorityProposal} /> : null}
          <section className="deck-list-card">
            <div className="section-head compact">
              <h3>Recent lead packets</h3>
              <span>{proposalHistory.length}</span>
            </div>
            {sortedProposalHistory.length ? (
              sortedProposalHistory.slice(0, 7).map((record) => (
                <DeckListItem
                  key={record.id}
                  title={`${record.client_name} - ${record.package}`}
                  detail={`${record.proposal_next_action} · ${record.recommended_price_range}`}
                  status={chicagoShotsProposalStatusLabels[record.status]}
                />
              ))
            ) : (
              <EmptyState icon={<Inbox size={20} />} title="No saved lead packets" detail="Open Proposal to create the first local ChicagoShots packet." />
            )}
          </section>
        </div>
      ) : null}

      {workspace === "proposal" ? (
        <div className="deck-stack">
          <div className="deck-grid compact-metrics">
            <DeckMetric label="Saved packets" value={String(proposalCounts.total)} detail="Local ChicagoShots proposal history." tone="good" />
            <DeckMetric label="Priority" value={priorityProposal?.client_name ?? "None"} detail={priorityProposal?.proposal_next_action ?? "No saved packet selected."} tone={priorityProposal ? "warn" : "muted"} />
            <DeckMetric label="Manual send" value={sendReadiness.send_enabled ? "Enabled" : "Draft-only"} detail="No message leaves this workspace." tone={sendReadiness.send_enabled ? "warn" : "good"} />
            <DeckMetric label="Pipeline" value={estimatedPipelineValue ? formatUsd(estimatedPipelineValue) : "$0.00"} detail="Estimated from saved quote ranges." tone={estimatedPipelineValue ? "good" : "muted"} />
          </div>
          <div className="deck-embedded-module proposal-builder-module">
            <ChicagoShotsLeadIntakePanel sessionHeaders={sessionHeaders} />
          </div>
        </div>
      ) : null}

      {workspace === "followup" ? (
        <div className="deck-stack">
          <div className="deck-grid compact-metrics">
            <DeckMetric label="Needs follow-up" value={String(proposalCounts.follow_up_needed)} detail="Status from saved proposal packets." tone={proposalCounts.follow_up_needed ? "alert" : "good"} />
            <DeckMetric label="Ready to send" value={String(followUpProposals.filter((record) => record.proposal_priority_label === "send_now").length)} detail="Manual send only." tone="warn" />
            <DeckMetric label="Draft-only" value={sendReadiness.send_enabled ? "Off" : "On"} detail="Send adapter remains guarded." tone={sendReadiness.send_enabled ? "warn" : "good"} />
            <DeckMetric label="Fastest move" value={priorityProposal?.client_name ?? "None"} detail={priorityProposal?.proposal_follow_up_timing ?? "No priority packet yet."} tone={priorityProposal ? "warn" : "muted"} />
          </div>
          <section className="deck-list-card">
            <div className="section-head compact">
              <h3>Manual follow-up queue</h3>
              <span>{followUpProposals.length}</span>
            </div>
            {followUpProposals.length ? (
              followUpProposals.slice(0, 8).map((record) => (
                <DeckListItem
                  key={record.id}
                  title={`${record.client_name} - ${chicagoShotsProposalPriorityLabels[record.proposal_priority_label]}`}
                  detail={`${record.proposal_next_action_detail} · ${record.follow_up_channel}`}
                  status={chicagoShotsProposalStatusLabels[record.status]}
                />
              ))
            ) : (
              <EmptyState icon={<MessageSquare size={20} />} title="No follow-ups waiting" detail="Saved proposal packets that need manual action will appear here." />
            )}
          </section>
          {priorityProposal ? <PriorityProposalCard record={priorityProposal} /> : null}
        </div>
      ) : null}

      {workspace === "work" ? (
        <div className="deck-grid two-column">
          <section className="deck-list-card">
            <div className="section-head compact">
              <h3>Tasks</h3>
              <span>{tasks.length}</span>
            </div>
            {tasks.slice(0, 5).map((task) => (
              <DeckListItem key={task.id} title={task.title} detail={`${task.owner} · ${task.due}`} status={task.status} />
            ))}
          </section>
          <section className="deck-list-card">
            <div className="section-head compact">
              <h3>Schedule</h3>
              <span>{events.length}</span>
            </div>
            {events.slice(0, 5).map((event) => (
              <DeckListItem key={event.id} title={event.title} detail={`${event.owner} · ${event.time}`} status={event.status} />
            ))}
          </section>
        </div>
      ) : null}

      {workspace === "money" ? (
        <div className="deck-stack">
          <div className="deck-grid compact-metrics">
            <DeckMetric label="Estimated pipeline" value={estimatedPipelineValue ? formatUsd(estimatedPipelineValue) : "$0.00"} detail="Derived from saved proposal ranges." tone={estimatedPipelineValue ? "good" : "muted"} />
            <DeckMetric label="Open proposals" value={String(proposalCounts.draft + proposalCounts.sent_manually + proposalCounts.follow_up_needed)} detail="Draft, sent manually, or follow-up." tone="warn" />
            <DeckMetric label="Won" value={String(proposalCounts.won)} detail="Closed in local proposal history." tone={proposalCounts.won ? "good" : "muted"} />
            <DeckMetric label="Lost" value={String(proposalCounts.lost)} detail="Tracked for cleanup." tone={proposalCounts.lost ? "warn" : "good"} />
          </div>
          <section className="deck-list-card">
            <div className="section-head compact">
              <h3>Proposal value</h3>
              <span>{proposalHistory.length} records</span>
            </div>
            {proposalHistory.length ? (
              sortedProposalHistory.slice(0, 6).map((record) => (
                <DeckListItem
                  key={record.id}
                  title={`${record.client_name} · ${record.recommended_price_range}`}
                  detail={record.proposal_next_action}
                  status={chicagoShotsProposalStatusLabels[record.status]}
                />
              ))
            ) : (
              <EmptyState icon={<BarChart3 size={20} />} title="No proposal value yet" detail="Generate or save a ChicagoShots packet to populate real pipeline data." />
            )}
          </section>
        </div>
      ) : null}

      {workspace === "video" ? (
        <div className="deck-grid">
          <DeckMetric label="Media Lab" value="Draft-ready" detail="Commercial video stays routed through gated creative generation." tone="good" />
          <DeckMetric label="PhantomCut" value="Phantom linked" detail="Local video proof and provider readiness stay inside Media Lab." tone="good" />
          <DeckMetric label="Resolve + Reaper" value="Bridge-ready" detail="Editing apps are launcher/plan surfaces until a human applies work." tone="muted" />
          <section className="deck-wide-card">
            <div className="section-head compact">
              <h3>Creative signal</h3>
              <button className="deck-icon-button" type="button" onClick={() => setRoute("media")}>
                <Play size={17} />
                <span>Open Media Lab</span>
              </button>
            </div>
            <p>Use this lane for video briefs, edit plans, proof review, and controlled generation requests. No spend or upload starts from the deck.</p>
          </section>
        </div>
      ) : null}

      {workspace === "protect" ? (
        <div className="deck-grid">
          <DeckMetric label="Execution" value={phantomAiOpsStatus.safety_flags.execution_disabled ? "Disabled" : "Review"} detail="Workflow and approval execution stay blocked." tone={phantomAiOpsStatus.safety_flags.execution_disabled ? "good" : "alert"} />
          <DeckMetric label="Sends" value={sendReadiness.send_enabled ? "Enabled" : "Draft-only"} detail={sendReadiness.next_required_before_send[0] ?? "Send adapter not implemented."} tone={sendReadiness.send_enabled ? "warn" : "good"} />
          <DeckMetric label="Protect scanners" value="Planned/local" detail="Medusa/Robin-style scanning is represented as planned or preview-only until configured." tone="muted" />
          <DeckMetric label="Provider" value={providerReady ? "Ready" : "Gated/off"} detail="No external model call is triggered by this workspace." tone="good" />
          <section className="deck-wide-card">
            <div className="section-head compact">
              <h3>Safety locks</h3>
              <button className="deck-icon-button" type="button" onClick={() => setRoute("security")}>
                <Search size={17} />
                <span>Open Protect</span>
              </button>
            </div>
            <div className="deck-safety-grid">
              <TruthBadge state="real" label="No provider call" />
              <TruthBadge state="real" label="No automation execution" />
              <TruthBadge state="real" label="No send" />
              <TruthBadge state="real" label="No queue write" />
              <TruthBadge state="real" label="No ledger write" />
              <TruthBadge state="real" label="/approvals/execute absent" />
            </div>
          </section>
        </div>
      ) : null}

      {workspace === "review" ? (
        <div className="deck-stack">
          <div className="deck-grid compact-metrics">
            <DeckMetric label="Pending" value={String(pendingApprovals.length)} detail="Human review before external action." tone={pendingApprovals.length ? "alert" : "good"} />
            <DeckMetric label="All approvals" value={String(approvals.length)} detail="Local dashboard state." tone="muted" />
            <DeckMetric label="Review route" value="Manual" detail="No approval execution endpoint exists." tone="good" />
          </div>
          <section className="deck-list-card">
            {pendingApprovals.length ? (
              pendingApprovals.slice(0, 4).map((approval) => (
                <ApprovalCard
                  key={approval.id}
                  approval={approval}
                  approveAction={approveAction}
                  rejectAction={rejectAction}
                  compact
                />
              ))
            ) : (
              <EmptyState icon={<ShieldCheck size={20} />} title="Review queue clear" detail="Drafts and risky actions will appear here before anything leaves the app." />
            )}
          </section>
        </div>
      ) : null}

      {workspace === "site" ? (
        <div className="deck-grid">
          <DeckMetric label="Site Studio" value="Available" detail="Website/app build lane opens as a full surface." tone="good" />
          <DeckMetric label="Store Builder" value="Concept-ready" detail="Products, offers, checkout notes, and catalog drafts belong here." tone="good" />
          <DeckMetric label="Admin route" value="admin.phantomforce.online" detail="Employee workspaces stay permission-scoped." tone="good" />
          <DeckMetric label="Employee workspaces" value={String(clientAccess.length)} detail="Access remains permission-gated." tone="muted" />
          <section className="deck-wide-card">
            <div className="section-head compact">
              <h3>Website, app, and store lane</h3>
              {canManageAccess ? (
                <button className="deck-icon-button" type="button" onClick={() => setRoute("site")}>
                  <Link2 size={17} />
                  <span>Open Site Studio</span>
                </button>
              ) : null}
            </div>
            <p>Site Studio stays behind owner/admin access. Use it for website/app work, storefront planning, build receipts, and approval-gated publish planning.</p>
            <div className="deck-safety-grid">
              <TruthBadge state="real" label="Website/page" />
              <TruthBadge state="real" label="Storefront draft" />
              <TruthBadge state="stub" label="Checkout requires approved provider" />
              <TruthBadge state="blocked" label="No deploy from deck" />
            </div>
          </section>
        </div>
      ) : null}

      {workspace === "brain" ? (
        <div className="deck-grid">
          <DeckMetric
            label="Hermes"
            value={phantomAiOpsStatus.hermes.ready ? "Ready" : phantomAiOpsStatus.hermes.status}
            detail={`${opsContext?.memory?.recalled_count ?? 0} recalled memories available to owner Phantom.`}
            tone={phantomAiOpsStatus.hermes.ready ? "good" : "muted"}
          />
          <DeckMetric
            label="Companion"
            value="Intent-first"
            detail="The visible brain reads intent instead of exposing raw tools to users."
            tone="good"
          />
          <DeckMetric
            label="Model lane"
            value={providerReady ? "Configured" : "Gated/off"}
            detail="No live model call happens from this intent map."
            tone={providerReady ? "warn" : "good"}
          />
          <DeckMetric
            label="Memory writes"
            value="Blocked here"
            detail="This surface reads posture and opens workspaces; it does not write ledger data."
            tone="good"
          />
          <section className="deck-wide-card">
            <div className="section-head compact">
              <h3>Brain posture</h3>
              <TruthBadge state="real" label="Admin-only internals" />
            </div>
            <p>
              PhantomAI should feel like one brain to users. The internal stack remains hidden behind owner/admin surfaces:
              memory, model readiness, intent routing, and proof status.
            </p>
          </section>
        </div>
      ) : null}

      {workspace === "agentlab" ? (
        <div className="deck-grid">
          <DeckMetric label="Workforce" value={agentSummary} detail="Internal worker status stays owner/admin-only." tone="good" />
          <DeckMetric label="Signal lane" value={opsContext?.assistant?.mode_label ?? "Internal"} detail={opsContext?.assistant?.external_sends ?? "External actions remain gated."} tone="good" />
          <DeckMetric label="Review" value={pendingApprovals.length ? `${pendingApprovals.length} pending` : "Clear"} detail="Human review stays ahead of risky actions." tone={pendingApprovals.length ? "alert" : "good"} />
          <section className="deck-wide-card">
            <div className="section-head compact">
              <h3>AgentLab</h3>
              <button className="deck-icon-button" type="button" onClick={() => setRoute("agents")}>
                <Bot size={17} />
                <span>Open AgentLab</span>
              </button>
            </div>
            <p>AgentLab is the internal workforce surface. This deck only summarizes status and opens the full admin lane.</p>
          </section>
        </div>
      ) : null}

      {workspace === "access" ? (
        <div className="deck-stack">
          <div className="deck-grid compact-metrics">
            <DeckMetric label="Users" value={String(clientAccess.length)} detail="Admin and test-employee access records." tone="good" />
            <DeckMetric label="Revoked" value={String(stats.revoked)} detail="Blocked users stay out of employee surfaces." tone={stats.revoked ? "warn" : "good"} />
            <DeckMetric label="Boundary" value="Separated" detail="Admins see the full suite; employees see assigned tools only." tone="good" />
            <DeckMetric label="Organizations" value="3 visible" detail="PhantomForce, ChicagoShots, and Test Employee remain the clean set." tone="good" />
          </div>
          <section className="deck-list-card">
            <div className="section-head compact">
              <h3>Admin/employee access</h3>
              <button className="deck-icon-button" type="button" onClick={() => setRoute("access")}>
                <Users size={17} />
                <span>Open Access</span>
              </button>
            </div>
            {clientAccess.slice(0, 6).map((client) => (
              <DeckListItem
                key={client.id}
                title={client.business}
                detail={`${client.owner} · ${client.plan}`}
                status={client.accessStatus}
              />
            ))}
          </section>
        </div>
      ) : null}

      {workspace === "n8n" ? (
        <div className="deck-grid">
          <DeckMetric label="n8n worker" value={n8nLocalUrl} detail={phantomAiOpsStatus.n8n.n8n_running ? "Local worker detected." : "Local scaffold or planned worker only."} tone={phantomAiOpsStatus.n8n.n8n_running ? "good" : "warn"} />
          <DeckMetric label="Workflow lane" value={toolLanePreview?.preview?.status ?? phantomAiOpsStatus.tool_lane_status.status} detail={toolLanePreview?.preview?.reason ?? phantomAiOpsStatus.tool_lane_status.reason} tone="good" />
          <DeckMetric label="Execution" value={toolLanePreview?.execution_disabled ?? true ? "Disabled" : "Review"} detail="Preview cannot start workers, run workflows, or open webhooks." tone="good" />
          <section className="deck-wide-card">
            <div className="section-head compact">
              <h3>Workflow drafts</h3>
              <span>{phantomAiOpsStatus.n8n.workflow_drafts.length}</span>
            </div>
            <div className="deck-safety-grid">
              {phantomAiOpsStatus.n8n.workflow_drafts.length ? (
                phantomAiOpsStatus.n8n.workflow_drafts.map((workflow) => (
                  <TruthBadge key={workflow.id} state={workflow.active ? "blocked" : "real"} label={`${workflow.id}: ${workflow.exists ? "exists" : "missing"}`} />
                ))
              ) : (
                <TruthBadge state="stub" label="Workflow draft list waiting on backend" />
              )}
            </div>
          </section>
        </div>
      ) : null}

      {workspace === "help" ? (
        <section className="deck-list-card">
          <div className="section-head compact">
            <h3>Signals PhantomForce understands</h3>
            <span>Local deterministic</span>
          </div>
          <div className="deck-command-list">
            {getVisiblePhantomDeckWorkspaces(canManageAccess).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() =>
                  setRoute(item.route && (canManageAccess || !ADMIN_ONLY_ROUTES.has(item.route)) ? item.route : "command")
                }
              >
                <span>{item.command}</span>
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </button>
            ))}
          </div>
        </section>
      ) : null}

    </section>
  );
}

function DeckMetric({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone: PhantomDeckPulseTone;
}) {
  return (
    <article className={`deck-metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function DeckListItem({ title, detail, status }: { title: string; detail: string; status: string }) {
  return (
    <article className="deck-list-item">
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
      <span>{status}</span>
    </article>
  );
}

function PriorityProposalCard({ record }: { record: ChicagoShotsProposalHistoryRecord }) {
  return (
    <article className="priority-proposal-card">
      <span className={`proposal-priority-badge ${chicagoShotsProposalPriorityClass(record.proposal_priority_label)}`}>
        {chicagoShotsProposalPriorityLabels[record.proposal_priority_label]} · {record.proposal_priority_score}
      </span>
      <div>
        <strong>{record.client_name}</strong>
        <p>{record.proposal_next_action}</p>
        <small>{record.proposal_next_action_detail}</small>
      </div>
      <span className={`proposal-status-badge ${chicagoShotsProposalStatusClass(record.status)}`}>
        {chicagoShotsProposalStatusLabels[record.status]}
      </span>
    </article>
  );
}

function estimateProposalRangeValue(value: string) {
  const numbers = value.match(/\d[\d,]*/g)?.map((item) => Number(item.replace(/,/g, ""))).filter(Number.isFinite) ?? [];
  if (!numbers.length) return 0;
  if (numbers.length === 1) return numbers[0];
  return (numbers[0] + numbers[1]) / 2;
}

// Anti-bloat: instead of a whole Scanner page, the Console shows a small live
// radar wired to the real autonomous-scan status (read-only GET). It reads the
// state at a glance and expands to the details (or the full scan) on tap.
// Degrades gracefully to "offline" if the backend is not reachable.
function RadarScanner({
  setRoute,
  sessionHeaders,
}: {
  setRoute: (route: Route) => void;
  sessionHeaders: (json?: boolean) => Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<AutonomousSecurityScanResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadStatus() {
      try {
        const response = await fetch(`${API_BASE_URL}/phantom-ai/security/autonomous/status`, {
          headers: sessionHeaders(),
        });
        const payload = (await response.json()) as AutonomousSecurityScanResponse;
        if (!active) return;
        if (response.ok) {
          setData(payload);
          setFailed(false);
        } else {
          setFailed(true);
        }
      } catch {
        if (active) setFailed(true);
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadStatus();
    return () => {
      active = false;
    };
  }, [sessionHeaders]);

  const details = data && typeof data.status === "object" ? data.status : undefined;
  const statusWord = typeof data?.status === "string" ? data.status : details?.status;
  const active = data?.protection_active ?? statusWord === "active";
  const targetCount = data?.target_count ?? details?.target_count ?? 0;
  const findings = (details?.targets ?? []).reduce(
    (sum, target) => sum + (target.summary?.total_findings ?? 0),
    0,
  );
  const lastRun = data?.last_run_at ?? details?.last_run_at ?? null;
  const lastRunLabel = lastRun ? new Date(lastRun).toLocaleDateString() : "Not yet";

  const state = loading ? "loading" : failed ? "offline" : active ? "protected" : "off";
  const statusChip =
    state === "loading"
      ? { label: "Checking", cls: "muted" }
      : state === "offline"
        ? { label: "Offline", cls: "muted" }
        : state === "protected"
          ? { label: findings > 0 ? "Review" : "Clear", cls: findings > 0 ? "warn" : "ok" }
          : { label: "Off", cls: "warn" };
  const headline =
    state === "loading"
      ? "Checking your setup…"
      : state === "offline"
        ? "Scanner is offline."
        : state === "protected"
          ? findings > 0
            ? "A few things to review."
            : "Nothing needs you."
          : "Protection is off.";

  return (
    <section className="panel radar-panel">
      <div className="section-head compact">
        <div>
          <span className="eyebrow">Security radar</span>
          <h3>{headline}</h3>
        </div>
        <span className={`radar-status ${statusChip.cls}`}>{statusChip.label}</span>
      </div>
      <button
        type="button"
        className={`radar-dish ${open ? "open" : ""} ${state}`}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label="Show what the security radar checked"
      >
        <span className="radar-ring" />
        <span className="radar-ring radar-ring-2" />
        <span className="radar-sweep" />
        <span className="radar-blip radar-blip-1" />
        <span className="radar-blip radar-blip-2" />
        <span className="radar-core">{open ? "Hide" : "Scan"}</span>
      </button>
      {open ? (
        <div className="radar-details">
          {state === "offline" ? (
            <div className="radar-signal">
              <span>Scanner backend</span>
              <b className="warn">Not reachable</b>
            </div>
          ) : (
            <>
              <div className="radar-signal">
                <span>Protection</span>
                <b className={active ? "ok" : "warn"}>{active ? "Active" : "Off"}</b>
              </div>
              <div className="radar-signal">
                <span>Things watched</span>
                <b className="ok">{targetCount}</b>
              </div>
              <div className="radar-signal">
                <span>Needs a look</span>
                <b className={findings > 0 ? "warn" : "ok"}>{findings === 0 ? "Nothing" : `${findings} item(s)`}</b>
              </div>
              <div className="radar-signal">
                <span>Last checked</span>
                <b className="ok">{lastRunLabel}</b>
              </div>
            </>
          )}
          <button className="ghost-small radar-full" type="button" onClick={() => setRoute("security")}>
            <Search size={15} />
            Open full scan
          </button>
        </div>
      ) : (
        <p className="radar-hint">Tap the radar to see what PhantomAI checked.</p>
      )}
    </section>
  );
}

// Anti-bloat: a small Bookings glance for the Console instead of jumping to a
// full calendar. Shows the next appointment and a count; expands to the next
// few and links to the full Bookings screen on tap.
function BookingsGlance({
  events,
  setRoute,
}: {
  events: CalendarEvent[];
  setRoute: (route: Route) => void;
}) {
  const [open, setOpen] = useState(false);
  const next = events[0];
  const confirmed = events.filter((event) => event.status === "confirmed").length;
  const pending = events.length - confirmed;

  return (
    <section className="panel glance-panel">
      <div className="section-head compact">
        <div>
          <span className="eyebrow">Bookings</span>
          <h3>{next ? "Next up" : "Nothing booked yet"}</h3>
        </div>
        <span className="glance-count">{events.length}</span>
      </div>
      {next ? (
        <button
          type="button"
          className="glance-lead"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-label="Show upcoming bookings"
        >
          <CalendarDays size={16} />
          <span className="glance-lead-text">
            <strong>{next.title}</strong>
            <small>{next.time}</small>
          </span>
          <span className={`glance-pill ${next.status}`}>{next.status}</span>
        </button>
      ) : (
        <p className="radar-hint">When a call is booked, it shows up here.</p>
      )}
      {open && events.length > 1 ? (
        <div className="glance-list">
          {events.slice(1, 4).map((event) => (
            <div className="glance-row" key={event.id}>
              <span>{event.title}</span>
              <b>{event.time}</b>
            </div>
          ))}
        </div>
      ) : null}
      <div className="glance-foot">
        <span>
          {confirmed} confirmed · {pending} pending
        </span>
        <button className="ghost-small" type="button" onClick={() => setRoute("calendar")}>
          Open bookings
        </button>
      </div>
    </section>
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
  stageQuickToolApproval,
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
  stageQuickToolApproval: (tool: OwnerQuickTool, copied: boolean) => void;
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
  const missionBundles = adminMissionBundles.filter((bundle) => bundle.id !== "help");
  const [activeAssistantId, setActiveAssistantId] = useState<string>(missionBundles[0]?.id ?? "site");
  const activeAssistant = missionBundles.find((bundle) => bundle.id === activeAssistantId) ?? missionBundles[0];
  const lastMissionOutput = [...messages].reverse().find((message) => message.role === "assistant" && message.missionId);
  const outputMissionBundle = missionBundles.find((bundle) => bundle.id === lastMissionOutput?.missionId);
  const lastUserMessage = [...messages].reverse().find((message) => message.role === "user");
  const artifactPreview = buildArtifactPreview(lastMissionOutput, outputMissionBundle, pendingApprovals.length);
  const hotLead = emails.find((email) => email.status === "needs-reply") ?? emails[0];
  const nextEvent = events[0];
  const nowTiles = [
    {
      label: "Approvals",
      value: String(stats.pending),
      detail: stats.pending ? "Waiting for your call" : "Nothing blocked",
      route: "approvals" as Route,
      tone: stats.pending ? "warn" : "ok",
    },
    {
      label: "Hot leads",
      value: String(stats.urgent),
      detail: hotLead ? hotLead.subject : "No lead selected",
      route: "inbox" as Route,
      tone: stats.urgent ? "danger" : "ok",
    },
    {
      label: "Next booking",
      value: nextEvent ? nextEvent.time : "None",
      detail: nextEvent ? nextEvent.title : "Ask PhantomAI to plan one",
      route: "calendar" as Route,
      tone: nextEvent ? "info" : "muted",
    },
    {
      label: "Due today",
      value: String(stats.today),
      detail: stats.today ? "Work waiting" : "Board is clear",
      route: "tasks" as Route,
      tone: stats.today ? "warn" : "ok",
    },
  ];
  const missionState = phantomAiBusy
    ? "Drafting"
    : lastMissionOutput
      ? pendingApprovals.length
        ? "Ready for review"
        : "Artifact ready"
      : "No run yet";
  const currentMissionLabel = phantomAiBusy
    ? lastUserMessage?.content.trim() || activeAssistant?.sample || "Mission running"
    : lastMissionOutput?.missionTitle ?? "No mission run yet";
  const currentMissionBundle = phantomAiBusy ? activeAssistant : outputMissionBundle;

  if (!canManageAccess) {
    return <ClientOperatorDemoDashboard createFollowUpPlan={createFollowUpPlan} setRoute={setRoute} />;
  }

  return (
    <div className="studio-shell">
      <section className="now-strip" aria-label="What needs attention now">
        {nowTiles.map((tile) => (
          <button className={`now-tile ${tile.tone}`} key={tile.label} type="button" onClick={() => setRoute(tile.route)}>
            <span>{tile.label}</span>
            <strong>{tile.value}</strong>
            <small>{tile.detail}</small>
          </button>
        ))}
      </section>

      <OwnerQuickTools
        tools={ownerQuickTools}
        runPhantomCommand={runPhantomCommand}
        stageQuickToolApproval={stageQuickToolApproval}
        setRoute={setRoute}
      />

      <div className="studio-layout">
      <aside className="studio-assistants" aria-label="Assistants">
        <div className="studio-rail-head">
          <span className="eyebrow">Missions</span>
          <h3>Point your workforce at an outcome.</h3>
          <p className="studio-rail-note">Pick a mission, then say what you want. PhantomAI handles the how.</p>
        </div>
        <div className="studio-assistant-list">
          {missionBundles.map((bundle) => (
            <button
              key={bundle.id}
              type="button"
              className={`studio-assistant ${activeAssistant && bundle.id === activeAssistant.id ? "active" : ""}`}
              onClick={() => {
                setActiveAssistantId(bundle.id);
                setCommandText(`${bundle.command} `);
              }}
            >
              <span className="studio-assistant-icon">{missionBundleIcon(bundle.id)}</span>
              <span className="studio-assistant-text">
                <strong>{bundle.title}</strong>
                <small>{bundle.short}</small>
              </span>
            </button>
          ))}
        </div>
      </aside>

      <section className="chat-card studio-chat">
        <div className="section-head">
          <div>
            <span className="eyebrow">Phantom Sense</span>
            <h3>What outcome do you want?</h3>
          </div>
          <span className="safe-pill admin-operator-pill">
            <Sparkles size={15} />
            Mode: {aiProviderLabel}
          </span>
        </div>
          <section className={`mission-flight-panel ${phantomAiBusy ? "working" : ""}`} aria-label="Current mission state">
            <div className="section-head compact">
              <div>
                <span className="eyebrow">Current mission</span>
                <h4>{currentMissionLabel}</h4>
              </div>
              <span className="mission-flight-status">{missionState}</span>
            </div>
            <article className="mission-flight-card">
              <span className="mission-flight-icon">
                {currentMissionBundle ? missionBundleIcon(currentMissionBundle.id) : <Sparkles size={18} />}
              </span>
              <div>
                <strong>{currentMissionBundle?.deliverable ?? "No artifact yet"}</strong>
                <small>{currentMissionBundle?.short ?? "Pick a mission and run it to create the first artifact."}</small>
              </div>
              <p>{phantomAiBusy ? "PhantomAI is drafting the artifact now." : lastMissionOutput ? artifactPreview.nextAction : "Choose a mission on the left, then tell PhantomAI the outcome."}</p>
            </article>
          </section>
          <details className="conversation-log">
            <summary>Conversation log</summary>
          <div className="messages" aria-live="polite">
            {messages.map((message) => (
              <article className={`message ${message.role}`} key={message.id}>
                <div className="avatar">{message.role === "assistant" ? <Bot size={18} /> : <UserRound size={18} />}</div>
                <p>{message.content}</p>
              </article>
            ))}
          </div>
          </details>
          <form className="command-form" onSubmit={submitCommand}>
            {canManageAccess ? (
              <label aria-label="PhantomAI mode" className="llm-select lane-readout model-select">
                <Bot size={15} />
                <select
                  value={aiProvider}
                  onChange={(event) => setAiProvider(event.target.value as AiProviderChoice)}
                  disabled={phantomAiBusy}
                >
                  <option value="codex">Codex</option>
                  <option value="glm_5_2">Local fallback</option>
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
              placeholder={activeAssistant ? `Tell PhantomAI the outcome for "${activeAssistant.title.toLowerCase()}"...` : "Tell PhantomAI the outcome..."}
              disabled={phantomAiBusy}
            />
            <button type="submit" title="Send intent" disabled={phantomAiBusy}>
              {phantomAiBusy ? <RefreshCcw size={18} /> : <Send size={18} />}
            </button>
          </form>
        </section>

      <aside className="studio-preview" aria-label="Live preview">
        <section className="panel studio-preview-card">
          <div className="section-head compact">
            <div>
              <span className="eyebrow">Live preview</span>
              <h3>{activeAssistant ? activeAssistant.title : "Result"}</h3>
            </div>
            <span className="studio-preview-icon">
              {activeAssistant ? missionBundleIcon(activeAssistant.id) : <Sparkles size={16} />}
            </span>
          </div>
          {activeAssistant ? (
            <>
              <p className="studio-preview-what">{activeAssistant.short}</p>
              <span className="studio-team-label">Team on this:</span>
              <div className="studio-worker-chips">
                {activeAssistant.crew.map((worker) => (
                  <span className="studio-worker-chip" key={worker}>
                    {titleCaseWords(worker)}
                  </span>
                ))}
              </div>
              <div className="studio-result">
                <span className="eyebrow">Artifact preview</span>
                <div className={`artifact-proof-grid ${phantomAiBusy ? "loading" : ""}`}>
                  <StatusLine label="Deliverable" value={artifactPreview.deliverable} />
                  <StatusLine label="Proof used" value={artifactPreview.proof} />
                  <StatusLine label="Next action" value={artifactPreview.nextAction} />
                  <StatusLine label="Approval" value={artifactPreview.approval} />
                </div>
                {artifactPreview.body ? <p>{artifactPreview.body}</p> : <p className="muted">Ask on the left and the artifact shows up here.</p>}
              </div>
              {activeAssistant.route && activeAssistant.route !== "command" ? (
                <button
                  className="primary-action studio-open-full"
                  type="button"
                  onClick={() => setRoute(activeAssistant.route)}
                >
                  <ArrowRight size={16} />
                  Open full {activeAssistant.title.toLowerCase()}
                </button>
              ) : null}
            </>
          ) : null}
        </section>

        <RadarScanner setRoute={setRoute} sessionHeaders={sessionHeaders} />

        <BookingsGlance events={events} setRoute={setRoute} />

        <section className="panel">
          <div className="section-head compact">
            <h3>Review queue</h3>
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
            <EmptyState
              icon={<ShieldCheck size={20} />}
              title="Nothing waiting"
              detail="Approvals from any assistant land here before anything goes live."
            />
          )}
        </section>
      </aside>
      </div>
    </div>
  );
}

function quickToolIcon(tool: OwnerQuickTool) {
  if (tool.id === "agent-loop" || tool.id === "automation-runbook") return <Users size={18} />;
  if (tool.id === "obsidian-capture") return <FileText size={18} />;
  if (tool.id === "higgsfield-factory") return <Play size={18} />;
  if (tool.id === "security-intake" || tool.id === "repo-scan") return <Search size={18} />;
  if (tool.id === "revenue-sprint") return <Zap size={18} />;
  if (tool.id === "ai-route-health") return <Link2 size={18} />;
  return <Sparkles size={18} />;
}

function OwnerQuickTools({
  tools,
  runPhantomCommand,
  stageQuickToolApproval,
  setRoute,
}: {
  tools: OwnerQuickTool[];
  runPhantomCommand: (text: string) => Promise<void>;
  stageQuickToolApproval: (tool: OwnerQuickTool, copied: boolean) => void;
  setRoute: (route: Route) => void;
}) {
  const [launchingId, setLaunchingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function launchTool(tool: OwnerQuickTool) {
    if (launchingId) return;
    setLaunchingId(tool.id);

    try {
      const copied = await copyPlainText(buildQuickToolHandoff(tool));
      if (copied) {
        setCopiedId(tool.id);
        window.setTimeout(() => setCopiedId((current) => (current === tool.id ? null : current)), 1800);
      }

      if (tool.openUrl) {
        window.open(tool.openUrl, "_blank", "noopener,noreferrer");
      }

      stageQuickToolApproval(tool, copied);
      await runPhantomCommand(tool.command);

      if (tool.route !== "command") {
        setRoute(tool.route);
      }
    } finally {
      setLaunchingId(null);
    }
  }

  return (
    <section className="owner-quick-tools" aria-label="Owner quick tools">
      <div className="section-head compact">
        <div>
          <span className="eyebrow">Quick tools</span>
          <h3>Owner launch deck</h3>
        </div>
        <span className="owner-quick-count">{tools.length} armed</span>
      </div>
      <div className="owner-quick-grid">
        {tools.map((tool) => {
          const isLaunching = launchingId === tool.id;
          const isCopied = copiedId === tool.id;

          return (
            <article className="owner-quick-card" key={tool.id}>
              <div className="owner-quick-top">
                <span className="owner-quick-icon">{quickToolIcon(tool)}</span>
                <div>
                  <span>{tool.lane}</span>
                  <strong>{tool.title}</strong>
                </div>
                <em>{tool.status}</em>
              </div>
              <p>{tool.description}</p>
              <div className="owner-quick-chips">
                {tool.bullets.map((bullet) => (
                  <span key={bullet}>{bullet}</span>
                ))}
              </div>
              <button type="button" onClick={() => void launchTool(tool)} disabled={Boolean(launchingId)}>
                {isLaunching ? <RefreshCcw size={16} /> : isCopied ? <Check size={16} /> : <Copy size={16} />}
                {isLaunching ? "Running" : isCopied ? "Copied" : tool.cta}
              </button>
            </article>
          );
        })}
      </div>
    </section>
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
    detail: "The operator prepares an admin-ready draft for human review.",
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

function ClientOperatorDemoDashboard({
  createFollowUpPlan,
  setRoute,
}: {
  createFollowUpPlan: () => void;
  setRoute: (route: Route) => void;
}) {
  const clientActions = [
    {
      title: "Draft follow-up",
      detail: "Create a review-ready reply for the next assigned touch.",
      action: createFollowUpPlan,
      icon: <Mail size={18} />,
    },
    {
      title: "Request quote",
      detail: "Open the package builder and turn the need into scope.",
      action: () => setRoute("offers"),
      icon: <FileText size={18} />,
    },
    {
      title: "Plan booking",
      detail: "Stage a call plan without touching a real calendar.",
      action: () => setRoute("calendar"),
      icon: <CalendarDays size={18} />,
    },
    {
      title: "Review proof",
      detail: "See what is waiting before anything goes live.",
      action: () => setRoute("approvals"),
      icon: <ShieldCheck size={18} />,
    },
  ];

  return (
    <div className="client-operator-demo" data-testid="client-operator-demo">
      <section className="client-demo-hero">
        <div>
          <span className="eyebrow">Employee operating center</span>
          <h2>Your AI operations team, ready.</h2>
          <p>
            Employees see assigned outcomes they can use: follow-ups, quotes, bookings, proof, and next steps. Full-suite
            controls stay hidden unless the org admin grants access.
          </p>
        </div>
        <div className="client-demo-lock">
          <ShieldCheck size={20} />
          <strong>Approval-protected</strong>
          <span>Nothing sends, books, bills, or posts without an owner review.</span>
        </div>
      </section>

      <section className="client-demo-status-strip" aria-label="Employee demo safety status">
        <span>Action-ready workspace</span>
        <span>Owner approval required</span>
        <span>Private tools hidden</span>
        <span>Employee-safe proof</span>
      </section>

      <section className="client-action-grid" aria-label="Employee actions">
        {clientActions.map((action) => (
          <button className="client-action-card" key={action.title} type="button" onClick={action.action}>
            <span>{action.icon}</span>
            <strong>{action.title}</strong>
            <small>{action.detail}</small>
            <ArrowRight size={16} />
          </button>
        ))}
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
          <span className="eyebrow">What employees see</span>
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
          <strong>PhantomForce employee workspace preview</strong>
        </div>
        <div className="client-demo-output-grid">
          <article>
            <Mail size={17} />
            <strong>Follow-up draft</strong>
            <p>Ready to review, edit, and approve.</p>
          </article>
          <article>
            <CalendarDays size={17} />
            <strong>Booking plan</strong>
            <p>Call windows and agenda staged before calendar action.</p>
          </article>
          <article>
            <BarChart3 size={17} />
            <strong>Quote lane</strong>
            <p>Starter, Core, or Pro guidance with human sign-off.</p>
          </article>
          <article>
            <Play size={17} />
            <strong>Media workflow</strong>
            <p>Creative plan and proof stay visible without exposing engines.</p>
          </article>
        </div>
        <button className="primary-action locked-demo-button" type="button" onClick={createFollowUpPlan}>
          <Sparkles size={17} />
          Prepare first client artifact
        </button>
      </section>
    </div>
  );
}

function reviewClientStatusLabel(status: ReviewClientStatus) {
  if (status === "ready") return "ready to ask";
  if (status === "request_queued") return "in review queue";
  if (status === "request_approved") return "ready to send";
  if (status === "review_received") return "review received";
  return "website ready";
}

function InboxView({
  emails,
  reviewClients,
  websiteReviews,
  createFollowUpPlan,
  createReviewRequestApproval,
  prepareAutonomousReviewFollowups,
  stageReviewForWebsiteApproval,
}: {
  emails: EmailItem[];
  reviewClients: ReviewClient[];
  websiteReviews: WebsiteReview[];
  createFollowUpPlan: () => void;
  createReviewRequestApproval: (clientId: string) => void;
  prepareAutonomousReviewFollowups: () => void;
  stageReviewForWebsiteApproval: (clientId: string) => void;
}) {
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
  const pendingReviewRequests = reviewClients.filter((client) => client.status === "ready").length;
  const websiteReadyReviews = websiteReviews.length + reviewClients.filter((client) => client.status === "website_ready").length;

  return (
    <Page
      title="Leads and clients"
      kicker="CRM and data"
      action={
        <div className="page-action-stack">
          <button className="ghost-small" type="button" onClick={prepareAutonomousReviewFollowups}>
            <Star size={16} />
            Prep review asks
          </button>
          <button className="primary-small" type="button" onClick={createFollowUpPlan}>
            <Sparkles size={16} />
            Prepare follow-up
          </button>
        </div>
      }
    >
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

      <section className="module-panel review-engine-panel">
        <div className="section-head">
          <div>
            <span className="eyebrow">Autonomous reviews</span>
            <h3>Turn past clients into approved website proof.</h3>
          </div>
          <TruthBadge state="real" label="approval gated" />
        </div>
        <p>
          PhantomAI prepares the review ask, the client uses a review link, and the submitted review waits in Review
          before it can appear on the website.
        </p>
        <div className="review-metric-grid">
          <StatusLine label="Ready to ask" value={String(pendingReviewRequests)} />
          <StatusLine label="Website-ready proof" value={String(websiteReadyReviews)} />
          <StatusLine label="Auto-send" value="Off" />
          <StatusLine label="Website publish" value="Approval only" />
        </div>
        <div className="review-client-grid">
          {reviewClients.map((client) => (
            <article className={`review-client-card ${classSlug(client.status)}`} key={client.id}>
              <div className="review-client-head">
                <div>
                  <strong>{client.business}</strong>
                  <span>{client.service}</span>
                </div>
                <b>{reviewClientStatusLabel(client.status)}</b>
              </div>
              <p>{client.result}</p>
              <dl className="review-client-meta">
                <div>
                  <dt>Contact</dt>
                  <dd>{client.contact}</dd>
                </div>
                <div>
                  <dt>Review link</dt>
                  <dd>{client.reviewLink}</dd>
                </div>
              </dl>
              <div className="review-card-actions">
                <button
                  className="ghost-small"
                  type="button"
                  onClick={() => createReviewRequestApproval(client.id)}
                  disabled={client.status === "request_queued" || client.status === "website_ready"}
                >
                  <Mail size={15} />
                  Ask for review
                </button>
                <button
                  className="ghost-small"
                  type="button"
                  onClick={() => stageReviewForWebsiteApproval(client.id)}
                  disabled={!client.submittedReview || client.status === "website_ready"}
                >
                  <ShieldCheck size={15} />
                  Stage website review
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="module-panel website-review-panel">
        <div className="section-head">
          <div>
            <span className="eyebrow">Website proof</span>
            <h3>Approved reviews ready for the site.</h3>
          </div>
          <TruthBadge state={websiteReviews.length ? "real" : "demo"} label={`${websiteReviews.length} approved`} />
        </div>
        {websiteReviews.length ? (
          <div className="website-review-grid">
            {websiteReviews.map((review) => (
              <article className="website-review-card" key={review.id}>
                <div>
                  <span>{review.rating} stars</span>
                  <strong>{review.business}</strong>
                </div>
                <p>“{review.quote}”</p>
                <small>
                  {review.author} · {review.service} · approved {formatLastRun(review.approvedAt)}
                </small>
              </article>
            ))}
          </div>
        ) : (
          <p className="autonomous-security-note">
            No testimonials have been approved for the website yet. Stage a submitted review, then approve it in Review.
          </p>
        )}
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
  websiteReviews,
  approveAction,
  rejectAction,
}: {
  approvals: Approval[];
  websiteReviews: WebsiteReview[];
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
    <Page title="Review queue" kicker="Pending review">
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
      <section className="module-panel review-approval-summary">
        <div className="section-head">
          <div>
            <span className="eyebrow">Review engine</span>
            <h3>Client reviews become website proof only after approval.</h3>
          </div>
          <TruthBadge state="real" label="no auto-publish" />
        </div>
        <div className="review-metric-grid">
          <StatusLine
            label="Review requests"
            value={String(approvals.filter((approval) => approval.kind === "review_request" && approval.status === "pending").length)}
          />
          <StatusLine
            label="Website reviews"
            value={String(approvals.filter((approval) => approval.kind === "website_review" && approval.status === "pending").length)}
          />
          <StatusLine label="Approved on-site" value={String(websiteReviews.length)} />
          <StatusLine label="External sending" value="manual only" />
        </div>
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
            <h3>Review needed</h3>
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

type HiggsfieldBridgeStatus = {
  ok: boolean;
  subscribed_access: boolean;
  admin_access: boolean;
  client_visible_name: string;
  phantomcut: {
    base_url: string;
    reachable: boolean;
    status?: {
      configured?: boolean;
      can_generate?: boolean;
      commercial_provider?: boolean;
      required_confirmation?: string;
      warning?: string;
      cli_health?: {
        ready?: boolean;
        message?: string;
      };
    } | null;
    status_error?: string | null;
  };
  safety: {
    draft_only: true;
    paid_job_called: false;
    upload_performed: false;
    run_endpoint_exposed: false;
    explicit_confirmation_required: string;
  };
};

type HiggsfieldDraftRouteResponse = {
  ok: boolean;
  error?: unknown;
  draft?: {
    action?: string;
    provider?: string;
    model?: string;
    mode?: string;
    command_preview?: string;
    warnings?: string[];
    status?: HiggsfieldBridgeStatus["phantomcut"]["status"];
  };
  safety?: {
    paid_job_called: false;
    upload_performed: false;
    run_endpoint_exposed: false;
    explicit_confirmation_required: string;
  };
};

function MediaLabView({
  sessionHeaders,
  stageHiggsfieldGenerationApproval,
}: {
  sessionHeaders: (json?: boolean) => Record<string, string>;
  stageHiggsfieldGenerationApproval: (payload: {
    prompt: string;
    mediaPath: string;
    commandPreview: string;
    model: string;
    aspectRatio: string;
    resolution: string;
    duration: string;
  }) => void;
}) {
  const [status, setStatus] = useState<HiggsfieldBridgeStatus | null>(null);
  const [draftResponse, setDraftResponse] = useState<HiggsfieldDraftRouteResponse | null>(null);
  const [videoPrompt, setVideoPrompt] = useState(
    "Make this feel cinematic, punchy, alive, and social-ready. Keep it human-approved and proof-backed.",
  );
  const [mediaPath, setMediaPath] = useState("");
  const [aspectRatio, setAspectRatio] = useState<"9:16" | "16:9" | "1:1" | "4:5">("9:16");
  const [resolution, setResolution] = useState<"480p" | "720p" | "1080p" | "2k" | "4k">("720p");
  const [duration, setDuration] = useState("12");
  const [busy, setBusy] = useState(false);
  const [draftStatus, setDraftStatus] = useState("Ready to draft. No paid generation will run.");

  async function refreshHiggsfieldStatus() {
    try {
      const response = await fetch(`${API_BASE_URL}/phantom-ai/media-lab/higgsfield/status`, {
        headers: sessionHeaders(),
      });
      const data = (await response.json()) as HiggsfieldBridgeStatus;
      if (response.ok) {
        setStatus(data);
      }
    } catch {
      setStatus(null);
    }
  }

  useEffect(() => {
    void refreshHiggsfieldStatus();
  }, []);

  async function createHiggsfieldDraft(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setDraftStatus("Creating Higgsfield draft only...");

    try {
      const response = await fetch(`${API_BASE_URL}/phantom-ai/media-lab/higgsfield/draft`, {
        method: "POST",
        headers: sessionHeaders(true),
        body: JSON.stringify({
          prompt: videoPrompt,
          media_path: mediaPath,
          media_role: mediaPath ? "video" : "start-image",
          model: "seedance_2_0",
          mode: "video",
          duration,
          aspect_ratio: aspectRatio,
          resolution,
        }),
      });
      const data = (await response.json()) as HiggsfieldDraftRouteResponse;
      setDraftResponse(data);
      setDraftStatus(
        response.ok && data.ok
          ? "Draft created. Stage it for approval before any paid/upload generation."
          : typeof data.error === "string"
            ? data.error
            : "Draft failed. Check PhantomCut status.",
      );
    } catch {
      setDraftStatus("Media Lab bridge is offline.");
    } finally {
      setBusy(false);
    }
  }

  const canDraft = status?.subscribed_access !== false;
  const canGenerate = Boolean(status?.phantomcut.status?.can_generate);
  const commandPreview = draftResponse?.draft?.command_preview ?? "";

  return (
    <Page title="Video Studio" kicker="Creative output" action={<TruthBadge state="real" label="Proof-backed" />}>
      <section className="simulation-hero">
        <div>
          <span className="eyebrow">Higgsfield video</span>
          <h3>Create with the commercial video engine already wired through PhantomCut.</h3>
          <p>
            Subscribers get a clean Generate Video surface. PhantomForce keeps the provider, upload, paid credits,
            and approval proof behind the product layer.
          </p>
        </div>
        <div className="simulation-hero-status">
          <StatusLine label="Provider" value="Higgsfield" />
          <StatusLine label="PhantomCut" value={status?.phantomcut.reachable ? "Connected" : "Open 127.0.0.1:8787"} />
          <StatusLine label="Paid run" value="Approval gated" />
        </div>
      </section>

      <section className="module-panel higgsfield-phantom-panel">
        <div className="section-head">
          <div>
            <span className="eyebrow">Generate Video</span>
            <h3>Draft the video job here. Run it only after approval.</h3>
          </div>
          <div className="page-action-stack">
            <button className="ghost-small" type="button" onClick={refreshHiggsfieldStatus}>
              <RefreshCcw size={16} />
              Check status
            </button>
            <button
              className="ghost-small"
              type="button"
              onClick={() => window.open("http://127.0.0.1:8787/?source=phantomforce-dashboard", "_blank")}
            >
              <Play size={16} />
              Open PhantomCut
            </button>
          </div>
        </div>

        <div className="higgsfield-status-grid">
          <StatusLine label="Subscribed access" value={canDraft ? "Enabled" : "Not in package"} />
          <StatusLine label="CLI ready" value={canGenerate ? "Ready" : "Needs PhantomCut/auth"} />
          <StatusLine label="Confirmation" value={status?.safety.explicit_confirmation_required ?? "Required"} />
          <StatusLine label="Uploads/credits" value="Not used by drafts" />
        </div>

        <form className="higgsfield-draft-form" onSubmit={createHiggsfieldDraft}>
          <label>
            Video prompt
            <textarea value={videoPrompt} onChange={(event) => setVideoPrompt(event.target.value)} />
          </label>
          <label>
            Optional local source video path
            <input
              value={mediaPath}
              onChange={(event) => setMediaPath(event.target.value)}
              placeholder="Example: G:\\Footage\\C2204.MP4"
            />
          </label>
          <div className="higgsfield-form-row">
            <label>
              Shape
              <select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value as typeof aspectRatio)}>
                <option value="9:16">9:16 vertical</option>
                <option value="16:9">16:9 wide</option>
                <option value="1:1">1:1 square</option>
                <option value="4:5">4:5 feed</option>
              </select>
            </label>
            <label>
              Quality
              <select value={resolution} onChange={(event) => setResolution(event.target.value as typeof resolution)}>
                <option value="720p">720p draft</option>
                <option value="1080p">1080p</option>
                <option value="2k">2K</option>
                <option value="4k">4K</option>
              </select>
            </label>
            <label>
              Duration
              <select value={duration} onChange={(event) => setDuration(event.target.value)}>
                <option value="5">5s</option>
                <option value="8">8s</option>
                <option value="12">12s</option>
                <option value="15">15s</option>
              </select>
            </label>
          </div>
          <button className="primary-action" type="submit" disabled={busy || !canDraft}>
            <Sparkles size={18} />
            {busy ? "Drafting..." : "Create Higgsfield draft"}
          </button>
        </form>

        <div className="higgsfield-proof-panel">
          <div>
            <span className="eyebrow">Job proof</span>
            <h4>{draftStatus}</h4>
          </div>
          {commandPreview ? (
            <>
              <pre>{commandPreview}</pre>
              <button
                className="primary-small"
                type="button"
                onClick={() =>
                  stageHiggsfieldGenerationApproval({
                    prompt: videoPrompt,
                    mediaPath,
                    commandPreview,
                    model: draftResponse?.draft?.model ?? "seedance_2_0",
                    aspectRatio,
                    resolution,
                    duration,
                  })
                }
              >
                <ShieldCheck size={16} />
                Stage paid run approval
              </button>
            </>
          ) : (
            <p>No paid job has run. Create a draft to see the exact run plan and stage it for Review.</p>
          )}
          <button className="ghost-small" type="button" disabled>
            <Lock size={16} />
            Run paid generation disabled here
          </button>
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

type SecurityScanFinding = {
  id: string;
  kind: "malware_indicator" | "sensitive_data" | "risky_file" | "injection_risk";
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  detail: string;
  evidence: string;
  recommendation: string;
};

type SecurityScanResult = {
  target_label: string;
  mode: "auto" | "website" | "upload" | "message" | "code";
  summary: {
    verdict: "clean" | "review" | "blocked";
    highest_severity: string;
    total_findings: number;
    malware_indicators: number;
    sensitive_data_findings: number;
    risky_file_findings: number;
    injection_risk_findings: number;
  };
  findings: SecurityScanFinding[];
  safety_flags: {
    local_only: true;
    destructive_action: false;
    quarantine_performed: false;
    file_deleted: false;
    external_scan_provider_called: false;
    upload_performed: false;
    raw_content_returned: false;
  };
};

type AutonomousSecurityScanDetails = {
  status: "active" | "disabled" | "waiting" | "ran_this_month";
  cadence: "monthly";
  current_month_key: string;
  proof_id: string;
  last_run_at: string | null;
  next_run_after: string;
  run_count: number;
  target_count: number;
  targets?: Array<{
    target_id: string;
    target_label: string;
    scanned_at: string;
    summary: SecurityScanResult["summary"];
    finding_titles: Array<{
      severity: string;
      kind: string;
      title: string;
    }>;
  }>;
  safety_flags?: {
    local_only: true;
    synthetic_targets_only?: true;
    destructive_action: false;
    external_scan_provider_called: false;
    upload_performed: false;
    raw_content_stored?: false;
  };
  password_health?: {
    proof_id: string;
    checked_at: string;
    policy: {
      unique_password_required: true;
      rotation_interval_days: 180;
      breach_check_timing: "password_change_or_reset_only";
      plaintext_password_storage: false;
    };
    summary: {
      total_admin_accounts: number;
      baseline_needed: number;
      rotation_due_or_unknown: number;
      breach_check_ready: true;
      breached_passwords_found: null;
    };
    accounts: Array<{
      account_id: string;
      workspace: string;
      account_label: string;
      role: string;
      password_age_known: false;
      last_password_change_at: null;
      rotation_interval_days: 180;
      rotation_status: "baseline_needed";
      breach_check_status: "check_on_next_password_change";
      recommendation: string;
    }>;
    safety_flags: {
      plaintext_password_stored: false;
      raw_password_logged: false;
      external_breach_provider_called: false;
      credential_printed: false;
    };
  };
};

type AutonomousSecurityScanResponse = {
  autonomous: true;
  cadence?: "monthly";
  status?: AutonomousSecurityScanDetails | AutonomousSecurityScanDetails["status"];
  protection_active?: boolean;
  target_count?: number;
  last_run_at?: string | null;
  next_run_after?: string;
  details_redacted?: boolean;
};

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return window.btoa(binary);
}

function SecurityScannerView({
  canManageAccess,
  sessionHeaders,
}: {
  canManageAccess: boolean;
  sessionHeaders: (json?: boolean) => Record<string, string>;
}) {
  const [label, setLabel] = useState(canManageAccess ? "Admin site scan" : "Client site scan");
  const [filename, setFilename] = useState("");
  const [mode, setMode] = useState<SecurityScanResult["mode"]>("website");
  const [content, setContent] = useState("");
  const [contentBase64, setContentBase64] = useState("");
  const [status, setStatus] = useState("Ready. Local scan only.");
  const [result, setResult] = useState<SecurityScanResult | null>(null);
  const [autonomousStatus, setAutonomousStatus] = useState<AutonomousSecurityScanResponse | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;

    async function refreshAutonomousStatus() {
      try {
        const response = await fetch(`${API_BASE_URL}/phantom-ai/security/autonomous/status`, {
          headers: sessionHeaders(),
        });
        const data = (await response.json()) as AutonomousSecurityScanResponse;

        if (active && response.ok) {
          setAutonomousStatus(data);
        }
      } catch {
        if (active) setAutonomousStatus(null);
      }
    }

    void refreshAutonomousStatus();

    return () => {
      active = false;
    };
  }, []);

  async function loadFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) return;

    if (file.size > 450_000) {
      setStatus("File is too large for the local preview lane. Paste text or use a smaller sample under 450 KB.");
      setContentBase64("");
      setFilename(file.name);
      setLabel(file.name);
      setMode("upload");
      return;
    }

    const buffer = await file.arrayBuffer();
    setContentBase64(arrayBufferToBase64(buffer));
    setFilename(file.name);
    setLabel(file.name);
    setMode("upload");
    setStatus(`Loaded ${file.name} locally. Click Scan before it is sent to the local backend.`);
  }

  async function runScan(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setStatus("Scanning locally...");

    try {
      const response = await fetch(`${API_BASE_URL}/phantom-ai/security/scan/preview`, {
        method: "POST",
        headers: sessionHeaders(true),
        body: JSON.stringify({
          label,
          filename,
          mode,
          content,
          content_base64: contentBase64 || undefined,
        }),
      });
      const data = (await response.json()) as { result?: SecurityScanResult; error?: unknown };

      if (!response.ok || !data.result) {
        setStatus(typeof data.error === "string" ? data.error : "Security scan failed closed.");
        return;
      }

      setResult(data.result);
      setStatus(
        data.result.summary.verdict === "clean"
          ? "Clean preview. No malware or sensitive-data indicators found."
          : data.result.summary.verdict === "blocked"
            ? "Blocked. Review findings before this touches a client/admin page."
            : "Review needed. Findings are not automatically destructive.",
      );
    } catch {
      setStatus("Scanner backend is offline.");
    } finally {
      setBusy(false);
    }
  }

  function loadUnsafeProofSample() {
    const fakeSecret = ["sk", "or-v1-fakeScannerProofKey1234567890"].join("-");
    setLabel("Scanner proof sample");
    setFilename("client-intake.pdf.exe");
    setMode("upload");
    setContent(
      [
        "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
        `OPENROUTER_API_KEY=${fakeSecret}`,
        "coach@example.com",
        "<script>alert('test')</script>",
      ].join("\n"),
    );
    setContentBase64("");
    setStatus("Loaded a fake unsafe sample. It proves scanner detection without using real secrets.");
  }

  const summary = result?.summary;
  const verdictClass = summary?.verdict ?? "clean";
  const resultBadgeState: TruthState = summary ? (summary.verdict === "clean" ? "real" : "blocked") : "demo";
  const autonomousDetails =
    typeof autonomousStatus?.status === "object" ? autonomousStatus.status : null;
  const autonomousLabel =
    autonomousDetails?.status ?? (typeof autonomousStatus?.status === "string" ? autonomousStatus.status : "waiting");
  const autonomousTargetCount = autonomousDetails?.target_count ?? autonomousStatus?.target_count ?? 0;
  const autonomousLastRun = autonomousDetails?.last_run_at ?? autonomousStatus?.last_run_at ?? null;
  const autonomousNextRun = autonomousDetails?.next_run_after ?? autonomousStatus?.next_run_after ?? null;
  const passwordHealth = autonomousDetails?.password_health;

  return (
    <Page
      title="Security Scanner"
      kicker={canManageAccess ? "Admin and employee protection" : "Employee upload protection"}
      action={
        <span className="safe-pill">
          <ShieldCheck size={15} />
          Local only
        </span>
      }
    >
      <section className="security-hero">
        <div>
          <span className="eyebrow">Autonomous protection</span>
          <h3>Monthly safety checks run in the background.</h3>
          <p>
            PhantomForce checks core dashboard, store, upload-policy, and approval-gate copy every month while the
            backend is running. Manual scanning stays available for one-off diagnostics.
          </p>
        </div>
        <div className="security-proof-grid">
          <StatusLine label="Cadence" value="Monthly" />
          <StatusLine label="Status" value={autonomousLabel.replace(/_/g, " ")} />
          <StatusLine label="Protected templates" value={String(autonomousTargetCount)} />
        </div>
      </section>

      <section className="module-panel autonomous-security-panel">
        <div className="section-head">
          <div>
            <span className="eyebrow">Always-on scanner</span>
            <h3>Autonomous monthly self-check</h3>
          </div>
          <TruthBadge state={autonomousLabel === "ran_this_month" ? "real" : "demo"} label={autonomousLabel.replace(/_/g, " ")} />
        </div>

        <div className="autonomous-security-grid">
          <StatusLine label="Last run" value={autonomousLastRun ? formatLastRun(autonomousLastRun) : "Waiting for first run"} />
          <StatusLine label="Next run" value={autonomousNextRun ? formatLastRun(autonomousNextRun) : "Next server monthly check"} />
          <StatusLine label="Scope" value={autonomousStatus?.details_redacted ? "Client-safe summary" : "Admin template summaries"} />
          <StatusLine label="External provider" value="Never" />
        </div>

        {autonomousDetails ? (
          <div className="scan-proof-receipt" aria-label="Monthly scan proof receipt">
            <div>
              <span className="eyebrow">Proof receipt</span>
              <strong>{autonomousDetails.proof_id}</strong>
              <small>
                Month {autonomousDetails.current_month_key} · run #{autonomousDetails.run_count}
              </small>
            </div>
            <div>
              <span>Completed</span>
              <strong>{autonomousLastRun ? formatLastRun(autonomousLastRun) : "Not yet"}</strong>
            </div>
            <div>
              <span>Coverage</span>
              <strong>{autonomousTargetCount} scan target(s)</strong>
            </div>
            <div>
              <span>Safety</span>
              <strong>No upload · no delete · no external scan</strong>
            </div>
          </div>
        ) : null}

        {passwordHealth ? (
          <div className="password-health-proof" aria-label="Password health and breach readiness proof">
            <div className="password-health-head">
              <div>
                <span className="eyebrow">Password breach readiness</span>
                <h4>Unique passwords and 6-month rotation are tracked.</h4>
              </div>
              <TruthBadge state="demo" label="baseline needed" />
            </div>
            <div className="autonomous-security-grid">
              <StatusLine label="Password proof" value={passwordHealth.proof_id} />
              <StatusLine label="Rotation policy" value={`${passwordHealth.policy.rotation_interval_days} days`} />
              <StatusLine label="Admin accounts" value={String(passwordHealth.summary.total_admin_accounts)} />
              <StatusLine label="Breach check" value="On password change/reset" />
            </div>
            <div className="password-account-grid">
              {passwordHealth.accounts.map((account) => (
                <article className="password-account-card" key={account.account_id}>
                  <div>
                    <strong>{account.workspace}</strong>
                    <span>{account.rotation_status.replace(/_/g, " ")}</span>
                  </div>
                  <p>{account.account_label}</p>
                  <small>
                    Remind every {account.rotation_interval_days} days · breach check runs when the password is
                    changed.
                  </small>
                </article>
              ))}
            </div>
            <p className="autonomous-security-note">
              PhantomForce does not store plaintext passwords. Breach checks should run during password change/reset
              using a safe hash-based check, then this monthly proof reminds every admin when rotation is due.
            </p>
          </div>
        ) : (
          <p className="autonomous-security-note">
            Password rotation policy is active. Detailed admin-account proof is redacted from client view.
          </p>
        )}

        {autonomousDetails?.targets?.length ? (
          <div className="autonomous-target-grid" aria-label="Autonomous scan targets">
            {autonomousDetails.targets.map((target) => (
              <article className={`autonomous-target-card ${target.summary.verdict}`} key={target.target_id}>
                <div>
                  <strong>{target.target_label}</strong>
                  <span>{target.summary.verdict}</span>
                </div>
                <p>{target.summary.total_findings} finding(s) · highest {target.summary.highest_severity}</p>
                <small>Last checked {formatLastRun(target.scanned_at)}</small>
              </article>
            ))}
          </div>
        ) : (
          <p className="autonomous-security-note">
            {autonomousStatus?.details_redacted
              ? "Employee view only shows that autonomous protection is active."
              : "The server will run the monthly catch-up automatically the next time the backend starts or the monthly check is due."}
          </p>
        )}
      </section>

      <form className="security-scan-grid" onSubmit={runScan}>
        <section className="module-panel security-input-panel">
          <div className="section-head">
            <div>
              <span className="eyebrow">Scan target</span>
              <h3>Paste website copy, code, message text, or a small upload sample.</h3>
            </div>
            <button className="ghost-small" type="button" onClick={loadUnsafeProofSample}>
              <AlertTriangle size={16} />
              Load proof sample
            </button>
          </div>

          <div className="security-field-row">
            <label>
              Label
              <input value={label} onChange={(event) => setLabel(event.target.value)} />
            </label>
            <label>
              Mode
              <select value={mode} onChange={(event) => setMode(event.target.value as SecurityScanResult["mode"])}>
                <option value="website">Website/page</option>
                <option value="upload">Upload/file</option>
                <option value="message">Message/client text</option>
                <option value="code">Code/snippet</option>
                <option value="auto">Auto</option>
              </select>
            </label>
          </div>

          <label>
            File name or upload name
            <input
              value={filename}
              onChange={(event) => setFilename(event.target.value)}
              placeholder="example: proposal.pdf, homepage.html, player-roster.csv"
            />
          </label>

          <label>
            Local file sample
            <input type="file" onChange={loadFile} />
          </label>

          <label>
            Content to scan
            <textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="Paste site copy, suspicious script, client upload text, proposal copy, or page HTML..."
            />
          </label>

          <button className="primary-action security-submit" type="submit" disabled={busy}>
            <Search size={18} />
            {busy ? "Scanning..." : "Run security scan"}
          </button>
          <p className="security-status">{status}</p>
        </section>

        <section className={`module-panel security-result-panel ${verdictClass}`}>
          <div className="section-head">
            <div>
              <span className="eyebrow">Result</span>
              <h3>{summary ? `${summary.verdict.toUpperCase()} - ${summary.total_findings} finding(s)` : "No scan yet"}</h3>
            </div>
            <TruthBadge state={resultBadgeState} label={summary?.highest_severity ?? "ready"} />
          </div>

          {summary ? (
            <>
              <div className="security-metric-grid">
                <StatusLine label="Malware indicators" value={String(summary.malware_indicators)} />
                <StatusLine label="Sensitive data" value={String(summary.sensitive_data_findings)} />
                <StatusLine label="Risky files" value={String(summary.risky_file_findings)} />
                <StatusLine label="Injection risk" value={String(summary.injection_risk_findings)} />
              </div>

              <div className="security-findings">
                {result?.findings.length ? (
                  result.findings.map((finding) => (
                    <article className={`security-finding ${finding.severity}`} key={finding.id}>
                      <div>
                        <span>{finding.severity}</span>
                        <strong>{finding.title}</strong>
                      </div>
                      <p>{finding.detail}</p>
                      <code>{finding.evidence}</code>
                      <small>{finding.recommendation}</small>
                    </article>
                  ))
                ) : (
                  <EmptyState
                    icon={<ShieldCheck size={20} />}
                    title="No indicators found"
                    detail="This does not replace endpoint antivirus, but the dashboard preview found nothing obvious."
                  />
                )}
              </div>
            </>
          ) : (
            <EmptyState
              icon={<ShieldCheck size={20} />}
              title="Ready to scan"
              detail="Use this before adding content to admin pages, employee pages, proposal packets, or uploads."
            />
          )}
        </section>
      </form>
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
  setRoute,
  pangolinPlan,
  pangolinStatus,
  phantomAiOpsStatus,
  agentWorkforceStatus,
  sessionHeaders,
}: {
  setRoute: (route: Route) => void;
  pangolinPlan: PangolinRoutePlan[];
  pangolinStatus: PangolinReadOnlyStatus | null;
  phantomAiOpsStatus: PhantomAiOpsStatus;
  agentWorkforceStatus: AgentWorkforceStatus;
  sessionHeaders: (json?: boolean) => Record<string, string>;
}) {
  const [agentActionBusy, setAgentActionBusy] = useState<string | null>(null);
  const [agentActionResult, setAgentActionResult] = useState<AgentActionResult | null>(null);
  const enabledRoutes = pangolinPlan.filter((plan) => plan.desiredState === "enabled").length;
  const disabledRoutes = pangolinPlan.filter((plan) => plan.desiredState === "disabled").length;
  const adminWorkforce = agentWorkforceStatus.role === "admin" ? agentWorkforceStatus : null;
  const fallbackWorkers: AgentWorkerMetric[] = [
    {
      id: "phantom-ai",
      name: "PhantomAI",
      role: "Chief operator",
      state: phantomAiOpsStatus.product_status.includes("Online") ? "active" : "checking",
      tool_binding: "dashboard_chat_and_router",
      focus: "Turns Jordan's ask into work cards, drafts, and next steps.",
      tasks_last_1h: 0,
      tasks_last_24h: 0,
      tasks_last_7d: 0,
      tokens_last_24h: 0,
      estimated_cost_usd_last_24h: 0,
      last_run_at: null,
      data_source: "Fallback UI status",
    },
    {
      id: "hermes",
      name: "Hermes",
      role: "Memory keeper",
      state: phantomAiOpsStatus.hermes.ready ? "active" : "warming",
      tool_binding: "hermes_ledger_context_memory",
      focus: "Stores receipts and context so the system remembers what happened.",
      tasks_last_1h: 0,
      tasks_last_24h: 0,
      tasks_last_7d: 0,
      tokens_last_24h: 0,
      estimated_cost_usd_last_24h: 0,
      last_run_at: null,
      data_source: "Fallback UI status",
    },
    {
      id: "builder",
      name: "Builder",
      role: "App and file worker",
      state: "standby",
      tool_binding: "codex_local_operator_lane",
      focus: "Handles local repo, website, dashboard, and file changes for admin work.",
      tasks_last_1h: 0,
      tasks_last_24h: 0,
      tasks_last_7d: 0,
      tokens_last_24h: 0,
      estimated_cost_usd_last_24h: 0,
      last_run_at: null,
      data_source: "Fallback UI status",
    },
    {
      id: "reviewer",
      name: "Reviewer",
      role: "Second opinion lane",
      state: "standby",
      tool_binding: "claude_cli_lane",
      focus: "Pressure-tests product decisions, copy, UI, and claims when asked.",
      tasks_last_1h: 0,
      tasks_last_24h: 0,
      tasks_last_7d: 0,
      tokens_last_24h: 0,
      estimated_cost_usd_last_24h: 0,
      last_run_at: null,
      data_source: "Fallback UI status",
    },
    {
      id: "gatekeeper",
      name: "Gatekeeper",
      role: "Private access guard",
      state: pangolinStatus?.status ?? "unconfigured",
      tool_binding: "pangolin_access_state",
      focus: "Tracks Pangolin/private routes and client access state.",
      tasks_last_1h: 0,
      tasks_last_24h: 0,
      tasks_last_7d: 0,
      tokens_last_24h: 0,
      estimated_cost_usd_last_24h: 0,
      last_run_at: null,
      data_source: "Pangolin read-only status",
    },
    {
      id: "scout",
      name: "Scout",
      role: "Lead and proposal worker",
      state: phantomAiOpsStatus.chicagoshots_ops.available ? "active" : "checking",
      tool_binding: "chicagoshots_pipeline",
      focus: "Organizes ChicagoShots leads, proposal packets, and follow-up status.",
      tasks_last_1h: 0,
      tasks_last_24h: 0,
      tasks_last_7d: 0,
      tokens_last_24h: 0,
      estimated_cost_usd_last_24h: 0,
      last_run_at: null,
      data_source: "Fallback UI status",
    },
    {
      id: "cutlab",
      name: "CutLab",
      role: "Media workflow worker",
      state: "standby",
      tool_binding: "phantomcut_media_lab",
      focus: "Keeps video, Media Lab, and ChicagoShots delivery work organized.",
      tasks_last_1h: 0,
      tasks_last_24h: 0,
      tasks_last_7d: 0,
      tokens_last_24h: 0,
      estimated_cost_usd_last_24h: 0,
      last_run_at: null,
      data_source: "Fallback UI status",
    },
    {
      id: "sentinel",
      name: "Sentinel",
      role: "Security scanner",
      state: "active",
      tool_binding: "local_security_scanner",
      focus: "Checks page copy, uploads, scripts, and secrets before client exposure.",
      tasks_last_1h: 0,
      tasks_last_24h: 0,
      tasks_last_7d: 0,
      tokens_last_24h: 0,
      estimated_cost_usd_last_24h: 0,
      last_run_at: null,
      data_source: "Fallback UI status",
    },
  ];
  const workers = adminWorkforce?.workers ?? fallbackWorkers;
  const subagents = adminWorkforce?.subagents ?? [];
  const assignments = adminWorkforce?.assignments ?? [];
  const programs = adminWorkforce?.programs ?? [];
  const ticker = adminWorkforce?.ticker ?? [
    {
      id: "fallback-ticker",
      label: "Agent Floor",
      text: "Agent telemetry is waiting on the backend.",
      timestamp: new Date().toISOString(),
    },
  ];
  const summary = adminWorkforce?.summary;
  const clientSummary: AgentClientSummary =
    adminWorkforce?.client_summary ??
    (agentWorkforceStatus.role === "client"
      ? agentWorkforceStatus.summary
      : defaultAgentClientSummary);
  const activeWorkerCount = summary?.active_workers ?? workers.filter((worker) => worker.state === "active").length;
  const windowHours = summary?.window_hours ?? 24;
  const taskCount = summary?.tasks_in_window ?? workers.reduce((total, worker) => total + worker.tasks_last_24h, 0);
  const tokenCount = summary?.tokens_in_window ?? workers.reduce((total, worker) => total + worker.tokens_last_24h, 0);
  const spend = summary?.estimated_cost_usd_in_window ?? workers.reduce(
    (total, worker) => total + worker.estimated_cost_usd_last_24h,
    0,
  );
  const n8nState = adminWorkforce?.n8n.running
    ? "running"
    : adminWorkforce?.n8n.scaffolded
      ? "scaffolded idle"
      : "not ready";
  const workerIcon = (worker: AgentWorkerMetric) => {
    const icons: Record<string, ReactNode> = {
      "phantom-ai": <Bot size={20} />,
      hermes: <Clock3 size={20} />,
      builder: <Sparkles size={20} />,
      strategist: <Sparkles size={20} />,
      reviewer: <MessageSquare size={20} />,
      gatekeeper: <KeyRound size={20} />,
      scout: <Users size={20} />,
      sentinel: <ShieldCheck size={20} />,
      cutlab: <Play size={20} />,
    };
    return icons[worker.id] ?? <Zap size={20} />;
  };
  async function runSafeAgentActionRequest(actionId: string, title: string) {
    try {
      const response = await fetch(`${API_BASE_URL}/phantom-ai/agents/actions/run`, {
        method: "POST",
        headers: sessionHeaders(true),
        body: JSON.stringify({
          action_id: actionId,
          title,
          write: actionId === "openspec-proposal",
        }),
      });
      const data = (await response.json()) as { result?: AgentActionResult; error?: unknown };
      return (
        data.result ?? {
          ok: false,
          action_id: actionId,
          label: title,
          error: data.error ?? `Action failed with HTTP ${response.status}`,
        }
      );
    } catch {
      return {
        ok: false,
        action_id: actionId,
        label: title,
        error: "Agent action backend is offline.",
      };
    }
  }

  const capabilityBundles = [
    {
      id: "client-sprint",
      title: "Build a Client Sprint",
      detail: "Turns a lead into scope, offer, proof, checklist, and a next-message plan.",
      outcome: "Proposal-ready sprint package",
      route: "offers" as Route,
      actionIds: ["openspec-proposal", "agent-os-sandbox", "serena-readonly-profile", "tool-registry-audit"],
    },
    {
      id: "site-upgrade",
      title: "Upgrade the Website",
      detail: "Maps the site, checks standards, scans launch risk, and prepares a private edit plan.",
      outcome: "Site improvement plan",
      route: "site" as Route,
      actionIds: ["serena-readonly-profile", "agent-os-sandbox", "tool-registry-audit", "agentlab-preflight"],
    },
    {
      id: "automation-readiness",
      title: "Prepare Automation",
      detail: "Checks local workflow readiness and explains what can be automated without sending anything.",
      outcome: "Safe automation readiness report",
      route: "agents" as Route,
      actionIds: ["n8n-readiness", "ruflo-planning", "agentlab-preflight"],
    },
    {
      id: "risk-review",
      title: "Inspect Before Launch",
      detail: "Reviews current work through preflight, route safety, code-map, and standards checks.",
      outcome: "Launch risk summary",
      route: "security" as Route,
      actionIds: ["agentlab-preflight", "serena-readonly-profile", "agent-os-sandbox", "tool-registry-audit"],
    },
  ];
  async function runSafeAgentBundle(bundle: (typeof capabilityBundles)[number]) {
    setAgentActionBusy(`bundle:${bundle.id}`);
    setAgentActionResult(null);

    try {
      const availableActions = new Set(programs.map((program) => program.action_id));
      const results: AgentActionResult[] = [];

      for (const actionId of bundle.actionIds) {
        if (!availableActions.has(actionId)) {
          results.push({
            ok: false,
            action_id: actionId,
            label: actionId,
            error: "Safe wrapper is not available in this workspace.",
          });
          continue;
        }
        results.push(
          await runSafeAgentActionRequest(
            actionId,
            `${bundle.title} bundled check ${actionId} ${new Date().toISOString()}`,
          ),
        );
      }

      setAgentActionResult({
        ok: results.every((result) => result.ok),
        action_id: bundle.id,
        label: bundle.title,
        result_type: "bundled_safe_workforce_check",
        output: {
          outcome: bundle.outcome,
          route: bundle.route,
          checks_run: results.length,
          checks: results.map((result, index) => ({
            check: index + 1,
            ok: result.ok,
            status: result.status ?? (result.ok ? "completed" : "blocked"),
            result_type: result.result_type ?? "safe_check",
            safety_flags: result.safety_flags,
            error: result.ok ? undefined : "A safe workforce check did not complete.",
          })),
        },
        safety_flags: {
          provider_called: false,
          external_send: false,
          n8n_execution: false,
          production_write: false,
        },
      });
    } finally {
      setAgentActionBusy(null);
    }
  }
  const workflowStages = [
    { label: "Signal", detail: "Jordan gives the mission context", icon: <Sparkles size={18} /> },
    { label: "Route", detail: "PhantomAI picks the worker lane", icon: <Bot size={18} /> },
    { label: "Work", detail: `${formatNumber(taskCount)} logged tasks in ${windowHours}h`, icon: <Zap size={18} /> },
    { label: "Watch", detail: `${formatNumber(tokenCount)} tokens tracked`, icon: <BarChart3 size={18} /> },
    { label: "Output", detail: "Artifacts move when the target is safe", icon: <ArrowRight size={18} /> },
  ];
  const nextPanels = [
    {
      title: "Ask PhantomAI",
      detail: "Create the work. PhantomAI reads the mission here.",
      route: "command" as Route,
      icon: <Sparkles size={18} />,
    },
    {
      title: "Open Site Studio",
      detail: "Edit public-site copy and private previews.",
      route: "site" as Route,
      icon: <FileText size={18} />,
    },
    {
      title: "Run Security Scan",
      detail: "Check copy, uploads, secrets, and scripts.",
      route: "security" as Route,
      icon: <Search size={18} />,
    },
    {
      title: "View System",
      detail: "Inspect provider, memory, and route status.",
      route: "connections" as Route,
      icon: <Link2 size={18} />,
    },
  ];

  return (
    <Page title="Agent Floor" kicker="Private workforce map" action={<TruthBadge state="real" label="Admin only" />}>
      <section className="agent-floor-hero">
        <div>
          <span className="eyebrow">Not a chat room</span>
          <h3>See who is working for you and what they are handling.</h3>
          <p>
            Agents are shown like a private operations crew. Employees see only the departments and tools their admin allows;
            admins see the machine behind PhantomForce.
          </p>
          <div className="agent-floor-actions">
            {nextPanels.map((panel) => (
              <button key={panel.title} type="button" onClick={() => setRoute(panel.route)}>
                {panel.icon}
                <span>{panel.title}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="agent-command-node">
          <span>Phantom Control</span>
          <strong>Jordan</strong>
          <small>{workers.length} workers / {subagents.length} subagents mapped</small>
        </div>
      </section>

      <section className="agent-ticker" aria-label="Agent activity ticker">
        <input
          type="checkbox"
          id="forcewire-min"
          className="agent-ticker-toggle"
          aria-label="Minimize live worker updates"
        />
        <label htmlFor="forcewire-min" className="agent-ticker-label">
          <span>FORCEWIRE</span>
          <strong>Live worker updates</strong>
        </label>
        <div className="agent-ticker-track">
          <div className="agent-ticker-marquee">
            {[...ticker, ...ticker].map((item, index) => (
              <span key={`${item.id}-${index}`}>
                <b>{item.label}</b>
                {item.text}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="agent-metric-strip" aria-label="Agent telemetry">
        <article>
          <span>Workers active</span>
          <strong>{activeWorkerCount}/{workers.length}</strong>
          <small>Admin operations floor</small>
        </article>
        <article>
          <span>Work in {windowHours}h</span>
          <strong>{formatNumber(taskCount)}</strong>
          <small>Hermes ledger receipts</small>
        </article>
        <article>
          <span>Tokens tracked</span>
          <strong>{formatNumber(tokenCount)}</strong>
          <small>{formatUsd(spend)} estimated</small>
        </article>
        <article>
          <span>Employee view</span>
          <strong>{clientSummary.label}</strong>
          <small>No tokens or tools exposed</small>
        </article>
        <article>
          <span>Automation</span>
          <strong>{n8nState}</strong>
          <small>{adminWorkforce?.n8n.execution_disabled === false ? "execution possible" : "execution blocked"}</small>
        </article>
      </section>

      <section className="agent-flow-panel" aria-label="Agent workflow diagram">
        {workflowStages.map((stage, index) => (
          <article key={stage.label}>
            <span>{stage.icon}</span>
            <small>0{index + 1}</small>
            <strong>{stage.label}</strong>
            <p>{stage.detail}</p>
          </article>
        ))}
      </section>

      <section className="agent-section agent-manager-section">
        <div className="section-head">
          <div>
            <span className="eyebrow">Manage the workforce</span>
            <h3>Assign work by sending each agent to the correct phantom surface.</h3>
          </div>
          <TruthBadge state="real" label="Functional routes" />
        </div>
        <div className="agent-assignment-grid">
          {assignments.map((assignment) => (
            <article className={`agent-assignment-card ${classSlug(assignment.status)}`} key={assignment.id}>
              <div>
                <span>{assignment.owner}</span>
                <b>{assignment.status}</b>
              </div>
              <h4>{assignment.title}</h4>
              <p>{assignment.detail}</p>
              <small>{assignment.guardrail}</small>
              <button type="button" onClick={() => setRoute(assignment.destination_route)}>
                {assignment.action_label}
                <ArrowRight size={16} />
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="agent-worker-grid" aria-label="Active agent workforce">
        {workers.map((worker) => (
          <article className={`agent-worker-card ${classSlug(worker.state)}`} key={worker.id}>
            <div className="agent-worker-top">
              <span>{workerIcon(worker)}</span>
              <b>{worker.state.replace(/_/g, " ")}</b>
            </div>
            <h3>{worker.name}</h3>
            <strong>{worker.role}</strong>
            <p>{worker.focus}</p>
            <div className="agent-worker-metrics">
              {worker.tasks_last_1h === 0 && worker.tasks_last_24h === 0 ? (
                <span className="agent-idle-readout">{workerActivityLabel(worker)}</span>
              ) : (
                <>
                  <span><b>{worker.tasks_last_1h}</b> 1h</span>
                  <span><b>{worker.tasks_last_24h}</b> 24h</span>
                  <span><b>{formatNumber(worker.tokens_last_24h)}</b> tokens</span>
                </>
              )}
            </div>
            <div className="agent-output-chip">
              {worker.id === "gatekeeper"
                ? `Access and security guard: ${pangolinStatus?.status ?? "checking"}`
                : capabilityOutcomeLabel(worker.tool_binding)}
            </div>
            <details className="agent-under-hood">
              <summary>Admin details</summary>
              <code>{worker.tool_binding}</code>
            </details>
            <div className="agent-worker-footer">
              <span>{worker.data_source}</span>
              <span>{formatLastRun(worker.last_run_at)}</span>
            </div>
          </article>
        ))}
      </section>

      <section className="agent-section">
        <div className="section-head">
          <div>
            <span className="eyebrow">Subagents</span>
            <h3>Named specialists under the main workers.</h3>
          </div>
          <TruthBadge state="demo" label="Internal map" />
        </div>
        <div className="agent-subagent-grid">
          {subagents.length ? (
            subagents.map((subagent) => (
              <article className={`agent-subagent-card ${classSlug(subagent.state)}`} key={subagent.id}>
                <div>
                  <strong>{subagent.name}</strong>
                  <span>{subagent.parent}</span>
                </div>
                <p>{subagent.specialty}</p>
                <small>{subagent.state} · {subagent.tasks_last_24h} tasks · {formatNumber(subagent.tokens_last_24h)} tokens</small>
              </article>
            ))
          ) : (
            <article className="agent-subagent-card waiting">
              <div>
                <strong>Telemetry waiting</strong>
                <span>Backend offline</span>
              </div>
              <p>The named specialist map appears after the admin agent-status route loads.</p>
              <small>Employee workspaces never see token/tool detail unless an admin allows it.</small>
            </article>
          )}
        </div>
      </section>

      <section className="agent-section">
        <div className="section-head">
          <div>
            <span className="eyebrow">Workforce bundles</span>
            <h3>Run business missions, not isolated tools.</h3>
          </div>
          <TruthBadge state="real" label="Bundled safe actions" />
        </div>
        <div className="agent-tool-grid">
          {capabilityBundles.map((bundle) => {
            const missingActions = bundle.actionIds.filter(
              (actionId) => !programs.some((program) => program.action_id === actionId),
            );
            const ready = missingActions.length === 0;
            return (
              <article className={`agent-tool-card ${ready ? "ready" : "waiting"}`} key={bundle.id}>
                <div>
                  <strong>{bundle.title}</strong>
                  <span>{ready ? "ready" : "partial"}</span>
                </div>
                <p>{bundle.detail}</p>
                <StatusLine label="Outcome" value={bundle.outcome} />
                <StatusLine label="Workers bundled" value={String(bundle.actionIds.length - missingActions.length)} />
                <StatusLine label="Missing safe wrappers" value={String(missingActions.length)} />
                <button
                  type="button"
                  onClick={() => void runSafeAgentBundle(bundle)}
                  disabled={agentActionBusy === `bundle:${bundle.id}`}
                >
                  {agentActionBusy === `bundle:${bundle.id}` ? "Running bundle..." : "Run safe bundle"}
                  <ArrowRight size={15} />
                </button>
                <button type="button" className="agent-secondary-action" onClick={() => setRoute(bundle.route)}>
                  Open result area
                  <ArrowRight size={15} />
                </button>
                <small>Hidden crew works together behind PhantomAI. No provider call, send, or production execution.</small>
              </article>
            );
          })}
        </div>
        <p className="agent-program-note">
          The installed programs are now treated like internal employees under a mission. Admins can run bundled safe
          checks here; employees only see the tools and outcomes their admin allows.
        </p>
        {agentActionResult ? (
          <article className={`agent-action-result ${agentActionResult.ok ? "ok" : "blocked"}`}>
            <div>
              <span className="eyebrow">Last agent action</span>
              <strong>{agentActionResult.label ?? agentActionResult.action_id ?? "Agent action"}</strong>
            </div>
            <p>{agentActionResult.ok ? "Completed through the safe admin wrapper." : "Action did not complete."}</p>
            <pre>{JSON.stringify(agentActionResult.output ?? agentActionResult.error ?? agentActionResult, null, 2)}</pre>
          </article>
        ) : null}
      </section>

      <div className="agent-ops-grid">
        <article className="operator-result-card">
          <span className="eyebrow">Operator rule</span>
          <h4>Visibility here. Intent starts on Home.</h4>
          <p>
            This page is the dashboard map of active workers and their cost/activity. To create work, use Home. To inspect risk, use Scanner.
            To edit the site, use Site Studio.
          </p>
        </article>
        <article className="operator-result-card">
          <span className="eyebrow">Employee version</span>
          <h4>{clientSummary.label} is all employees need.</h4>
          <p>
            Admins see workers, tools, tokens, and spend. Employee workspaces simplify this into the assigned lanes:
            Sales, Media, Support, Bookings, and Delivery.
          </p>
        </article>
        <article className="operator-result-card">
          <span className="eyebrow">Pangolin route map</span>
          <h4>
            {enabledRoutes} enabled, {disabledRoutes} disabled.
          </h4>
          <p>Pangolin remains the private doorway layer. Live changes stay outside this visual map.</p>
          <StatusLine label="Live instance" value={pangolinStatus?.status ?? "unconfigured"} />
          <StatusLine label="Automation bay" value={n8nState} />
        </article>
      </div>
    </Page>
  );
}

function SiteStudioView({
  pangolinPlan,
  pangolinStatus,
  sessionHeaders,
  createStoreReviewApproval,
}: {
  pangolinPlan: PangolinRoutePlan[];
  pangolinStatus: PangolinReadOnlyStatus | null;
  sessionHeaders: (json?: boolean) => Record<string, string>;
  createStoreReviewApproval: (draft: StorefrontDraft) => void;
}) {
  const [siteDraft, setSiteDraft] = useState({
    hero: "PhantomForce builds the system behind your business.",
    subhead:
      "Ask PhantomAI for replies, quotes, bookings, docs, content, and video plans from one owner Phantom.",
    offer: "Start with an Ops + Content Setup Sprint: $750 Starter, $1,500 Core, or $2,500 Pro.",
    cta: "Book a 15-minute setup call",
  });
  const [storeDraft, setStoreDraft] = useState<StorefrontDraft>({
    name: "PhantomForce Store",
    headline: "Buy the system, not another random service.",
    product: "Ops + Content Setup Sprint",
    price: "$1,500",
    description: "We map the mess, build the working operating system, and prepare your next sales/content workflow.",
    fulfillment: "Delivered as a private setup sprint with owner approval before sends, posts, bookings, or billing actions.",
    checkoutNote: "Checkout is draft-only here. Live payment links require a separate approval and billing gate.",
    cta: "Request setup sprint",
  });
  const [storePreviewOpen, setStorePreviewOpen] = useState(true);
  const [storeScanBusy, setStoreScanBusy] = useState(false);
  const [storeScanStatus, setStoreScanStatus] = useState("Not scanned yet.");
  const [storeScanSummary, setStoreScanSummary] = useState<SecurityScanResult["summary"] | null>(null);
  const [previewOpen, setPreviewOpen] = useState(true);

  function updateDraft(key: keyof typeof siteDraft, value: string) {
    setSiteDraft((current) => ({ ...current, [key]: value }));
  }

  function updateStoreDraft(key: keyof typeof storeDraft, value: string) {
    setStoreDraft((current) => ({ ...current, [key]: value }));
  }

  function loadStorePackage(packageName: "starter" | "core" | "pro") {
    const packages = {
      starter: {
        product: "Starter Setup Sprint",
        price: "$750",
        description: "A focused cleanup sprint for one offer, one page, and one follow-up path.",
      },
      core: {
        product: "Core Ops + Content Sprint",
        price: "$1,500",
        description: "The main PhantomForce package: lead flow, booking path, proposal copy, and content workflow.",
      },
      pro: {
        product: "Pro Business System Sprint",
        price: "$2,500",
        description: "A heavier build for messy operations: site sections, dashboards, follow-ups, media, and approval lanes.",
      },
    };
    setStoreDraft((current) => ({ ...current, ...packages[packageName] }));
    setStorePreviewOpen(true);
  }

  function storeDraftContent() {
    return [
      `Store: ${storeDraft.name}`,
      `Headline: ${storeDraft.headline}`,
      `Product: ${storeDraft.product}`,
      `Price: ${storeDraft.price}`,
      `Description: ${storeDraft.description}`,
      `Fulfillment: ${storeDraft.fulfillment}`,
      `CTA: ${storeDraft.cta}`,
      `Checkout note: ${storeDraft.checkoutNote}`,
    ].join("\n");
  }

  async function scanStoreDraft() {
    setStoreScanBusy(true);
    setStoreScanStatus("Scanning store draft locally...");

    try {
      const response = await fetch(`${API_BASE_URL}/phantom-ai/security/scan/preview`, {
        method: "POST",
        headers: sessionHeaders(true),
        body: JSON.stringify({
          label: `Store Builder - ${storeDraft.product}`,
          filename: "storefront-draft.txt",
          mode: "website",
          content: storeDraftContent(),
        }),
      });
      const data = (await response.json()) as { result?: SecurityScanResult; error?: unknown };

      if (!response.ok || !data.result) {
        setStoreScanSummary(null);
        setStoreScanStatus(typeof data.error === "string" ? data.error : "Store scan failed closed.");
        return;
      }

      setStoreScanSummary(data.result.summary);
      setStoreScanStatus(
        data.result.summary.verdict === "clean"
          ? "Clean store draft. No local indicators found."
          : data.result.summary.verdict === "blocked"
            ? "Blocked. Review scanner findings before using this store copy."
            : "Review needed before checkout or publish.",
      );
    } catch {
      setStoreScanSummary(null);
      setStoreScanStatus("Scanner backend is offline.");
    } finally {
      setStoreScanBusy(false);
    }
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

      <section className="module-panel store-builder-panel">
        <div className="section-head">
          <div>
            <span className="eyebrow">Store Builder</span>
            <h3>Turn an offer into a buyer-ready store page.</h3>
          </div>
          <TruthBadge state="stub" label="Checkout gated" />
        </div>

        <div className="store-integration-strip" aria-label="Store Builder integrations">
          <article>
            <Zap size={17} />
            <strong>Offers</strong>
            <span>Starter/Core/Pro presets feed this page.</span>
          </article>
          <article>
            <Search size={17} />
            <strong>Scanner</strong>
            <span>{storeScanSummary ? `${storeScanSummary.verdict} · ${storeScanSummary.total_findings} finding(s)` : "Local scan ready."}</span>
          </article>
          <article>
            <SquareCheckBig size={17} />
            <strong>Review queue</strong>
            <span>Store publish/payment requires approval card.</span>
          </article>
          <article>
            <KeyRound size={17} />
            <strong>Access</strong>
            <span>Pangolin remains {pangolinStatus?.status ?? "unconfigured"}.</span>
          </article>
        </div>

        <div className="store-builder-layout">
          <div className="store-builder-form lead-intake-form">
            <div className="store-package-quickbar" aria-label="Store package presets">
              <button type="button" onClick={() => loadStorePackage("starter")}>Starter</button>
              <button type="button" onClick={() => loadStorePackage("core")}>Core</button>
              <button type="button" onClick={() => loadStorePackage("pro")}>Pro</button>
            </div>
            <label>
              Store name
              <input value={storeDraft.name} onChange={(event) => updateStoreDraft("name", event.target.value)} />
            </label>
            <label>
              Store headline
              <input value={storeDraft.headline} onChange={(event) => updateStoreDraft("headline", event.target.value)} />
            </label>
            <div className="store-two-column">
              <label>
                Product / offer
                <input value={storeDraft.product} onChange={(event) => updateStoreDraft("product", event.target.value)} />
              </label>
              <label>
                Price
                <input value={storeDraft.price} onChange={(event) => updateStoreDraft("price", event.target.value)} />
              </label>
            </div>
            <label className="lead-notes-field">
              Product description
              <textarea value={storeDraft.description} onChange={(event) => updateStoreDraft("description", event.target.value)} />
            </label>
            <label className="lead-notes-field">
              Fulfillment promise
              <textarea value={storeDraft.fulfillment} onChange={(event) => updateStoreDraft("fulfillment", event.target.value)} />
            </label>
            <label>
              CTA
              <input value={storeDraft.cta} onChange={(event) => updateStoreDraft("cta", event.target.value)} />
            </label>
            <div className="lead-intake-actions">
              <button className="primary-action" type="button" onClick={() => setStorePreviewOpen(true)}>
                <ShoppingCart size={16} />
                Preview store
              </button>
              <button className="ghost-small" type="button" onClick={() => void scanStoreDraft()} disabled={storeScanBusy}>
                <Search size={15} />
                {storeScanBusy ? "Scanning..." : "Scan store"}
              </button>
              <button className="ghost-small" type="button" onClick={() => createStoreReviewApproval(storeDraft)}>
                <SquareCheckBig size={15} />
                Stage review card
              </button>
              <button className="ghost-small" type="button" onClick={() => setStorePreviewOpen(false)}>
                Hide store
              </button>
              <button className="ghost-small" type="button" disabled title="Payment and checkout require a separate approved billing integration.">
                <Lock size={15} />
                Checkout gated
              </button>
            </div>
            <p className={`store-scan-status ${storeScanSummary?.verdict ?? "idle"}`}>{storeScanStatus}</p>
          </div>

          {storePreviewOpen ? (
            <article className="store-preview-card">
              <div className="store-preview-head">
                <span>
                  <ShoppingCart size={18} />
                  Store preview
                </span>
                <b>Draft only</b>
              </div>
              <h4>{storeDraft.name}</h4>
              <p>{storeDraft.headline}</p>
              <div className="store-product-card">
                <span className="eyebrow">Featured offer</span>
                <strong>{storeDraft.product}</strong>
                <em>{storeDraft.price}</em>
                <p>{storeDraft.description}</p>
                <small>{storeDraft.fulfillment}</small>
                <button className="primary-small" type="button" disabled>
                  {storeDraft.cta}
                </button>
              </div>
              <div className="store-safety-strip">
                <span>No payment link</span>
                <span>No invoice</span>
                <span>No send</span>
                <span>Approval required</span>
              </div>
              <p className="route-note">{storeDraft.checkoutNote}</p>
            </article>
          ) : (
            <article className="store-preview-card muted">
              <ShoppingCart size={20} />
              <h4>Store preview hidden</h4>
              <p>Draft fields remain local in this admin screen. Nothing publishes or charges a customer.</p>
            </article>
          )}
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
          <span className="eyebrow">PhantomOps rule</span>
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
  deploymentModelStatus,
  sessionHeaders,
  pangolinPlan,
  pangolinStatus,
}: {
  canManageAccess: boolean;
  providerSetupStatus: ProviderSetupStatus;
  deploymentModelStatus: DeploymentModelStatus;
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
      <DeploymentModelPanel status={deploymentModelStatus} />
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

function DeploymentModelPanel({ status }: { status: DeploymentModelStatus }) {
  const connectorStatus = status.local_connector.enabled || status.local_connector.available ? "Available path" : "Planned / gated";
  const cloudReady = status.production_cloud_ready ? "Cloud-ready" : "Pilot hardening";
  const tenantReady = status.tenant_isolation_ready ? "Tenant gates ready" : "Tenant gates next";
  const licenseReady = status.license_gate_ready ? "License gates ready" : "License gates next";

  return (
    <section className="panel provider-setup-panel">
      <div className="section-head">
        <div>
          <span className="eyebrow">Product model</span>
          <h3>Cloud app first. Customer-owned connector when local control is needed.</h3>
        </div>
        <TruthBadge state="real" label="SaaS + connector" />
      </div>
      <p>
        PhantomForce should feel like one clean product: customers use the hosted app, while local files and desktop tools stay on
        their own machine through an optional connector. Internal models, scripts, and source repositories stay behind PhantomAI.
      </p>
      <div className="provider-grid">
        <ProviderStatusCard
          label="Customer app"
          value="Online phantom"
          detail={`Primary surface: ${status.public_app_url}. Users log into PhantomForce instead of touching repos or source files.`}
          state="real"
        />
        <ProviderStatusCard
          label="Desktop companion"
          value={connectorStatus}
          detail={status.local_connector.role ?? status.local_connector.purpose ?? "Optional outbound-only connector for local files and tools."}
          state={status.local_connector.enabled || status.local_connector.available ? "real" : "stub"}
        />
        <ProviderStatusCard
          label="Source exposure"
          value={status.source_code_exposed_to_users ? "Risk" : "Hidden"}
          detail="Customers should never receive source repos, provider keys, or raw developer tooling."
          state={status.source_code_exposed_to_users ? "blocked" : "real"}
        />
        <ProviderStatusCard
          label="Jordan PC role"
          value={status.customer_traffic_should_route_through_jordan_pc ? "Too much" : "Admin pilot only"}
          detail="Jordan's Windows host can run the admin pilot/private connector, but customer production traffic should move to cloud infrastructure."
          state={status.customer_traffic_should_route_through_jordan_pc ? "blocked" : "real"}
        />
        <ProviderStatusCard
          label="Tenant isolation"
          value={tenantReady}
          detail="Every business should get a scoped tenant/workspace, not a cloned app folder."
          state={status.tenant_isolation_ready ? "real" : "stub"}
        />
        <ProviderStatusCard
          label="Copy resistance"
          value={licenseReady}
          detail="Server-side orchestration, account gates, subscription gates, and signed companion builds make copying the product impractical."
          state={status.license_gate_ready ? "real" : "stub"}
        />
      </div>
      <div className="scope-list">
        <span>{cloudReady}</span>
        <span>PhantomAI is the only user-facing brain</span>
        <span>{status.internal_tool_names_hidden_from_clients ? "Tool names hidden" : "Tool names visible risk"}</span>
        <span>{status.local_connector.raw_files_uploaded_by_default ? "Raw uploads risk" : "No raw upload by default"}</span>
      </div>
    </section>
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
            placeholder="Jordan Test Lead"
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
  const Icon =
    approval.kind === "email"
      ? Mail
      : approval.kind === "calendar"
        ? CalendarDays
        : approval.kind === "review_request" || approval.kind === "website_review"
          ? Star
          : approval.kind === "video_generation"
            ? Play
          : SquareCheckBig;
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
