import { createHash } from "node:crypto";

import { compileHermesContext } from "./context-compiler.js";
import { appendHermesLedgerRecord, redactSensitiveText, resolveHermesLedgerPath } from "./hermes-ledger.js";
import { evaluateProviderBudgetPolicy } from "./provider-policy.js";
import { evaluateProviderInvocationFirewall } from "./provider-invocation-firewall.js";
import { getProviderReadinessReport } from "./provider-readiness.js";
import type {
  ActionPreview,
  ApprovalRequestPreview,
  ApprovalRequestStatus,
  ApprovalRiskLevel,
  BudgetGuardStatus,
  ModelRouterDecision,
  ModelRouterMode,
  ModelRouterPreviewResult,
  ModelRouterRequest,
  ModelRouterRunResult,
  ProviderRoute,
  ProviderSetupStatus,
  SensitivityLevel,
} from "./types.js";

export const DEFAULT_OPENROUTER_MODEL = "z-ai/glm-5.2";

const DEFAULT_RULES = [
  "Normal customers interact with Phantom AI, not raw providers.",
  "Do not execute sends, uploads, posts, charges, deletes, deploys, credential changes, or production changes.",
  "High-sensitivity data must not route to cheap third-party worker models by default.",
];

const DEFAULT_APPROVAL_RESTRICTIONS = [
  "External emails, posts, uploads, delivery links, payment/card actions, credential changes, deletes, deploys, and production touches require approval.",
  "Demo mode may draft or classify work, but live execution is disabled.",
];

const EXPLICIT_EXTERNAL_ACTION_PATTERN =
  /\b(send|email|dm|text|post|upload)\b.*\b(to|them|client|lead|prospect|gmail|instagram|facebook|youtube|externally|now)\b|\b(send|email|dm|text|post|upload) (it|this|that|the)\b/i;

const APPROVAL_ONLY_ACTION_PATTERN =
  /(charge|billing|payment|card|delete|deploy|credential|secret|production|route change)/i;

const ADVICE_OR_DRAFT_PATTERN =
  /\b(what should i|what do i|what can i|help me|draft|write|prepare|compose|suggest|recommend|give me|create a draft)\b/i;

const EXPLICIT_EXECUTION_PATTERN =
  /\b(send|email|dm|text|post|upload)\b.*\b(now|for me|on my behalf|go ahead|actually send|without approval|right now)\b|\b(send|email|dm|text|post|upload) (it|this|that|the)\b/i;

const DESTRUCTIVE_TASK_PATTERN =
  /(charge|billing|payment|card|delete|destroy|remove|wipe|drop|deploy|migration|migrate|credential|secret|production|route change)/i;

const HIGH_SENSITIVITY_PATTERN =
  /(credential|secret|api key|password|payment|billing|card|health|medical|minor|child|legal|financial|private record|diagnosis)/i;

const WORKER_TASK_PATTERN =
  /(summary|summarize|filter|draft|classify|classification|content idea|task|compression|context|lead|offer)/i;

function hasValue(value: string | undefined) {
  return Boolean(value?.trim());
}

function normalizeMode(value: string | undefined): ModelRouterMode {
  if (value === "openrouter" || value === "claude" || value === "local" || value === "router") return value;
  return "mock";
}

function parseBudget(value: string | undefined) {
  if (!value?.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function getProviderSetupStatus(env: NodeJS.ProcessEnv = process.env): ProviderSetupStatus {
  const routerMode = normalizeMode(env.PHANTOM_MODEL_ROUTER_MODE);
  const openRouterConfigured = hasValue(env.OPENROUTER_API_KEY);
  const liveProvidersEnabled = env.PHANTOM_LIVE_PROVIDERS_ENABLED === "true";
  const openRouterTransportEnabled = env.PHANTOM_OPENROUTER_TRANSPORT_ENABLED === "true";
  const openRouterLiveReady = openRouterConfigured && liveProvidersEnabled && openRouterTransportEnabled;
  const claudeConfigured = hasValue(env.ANTHROPIC_API_KEY);
  const localAvailable = hasValue(env.OLLAMA_BASE_URL) || env.PHANTOM_LOCAL_MODEL_AVAILABLE === "true";
  const byokEnabled = env.PHANTOM_ALLOW_BYOK === "true";
  const modelId = env.OPENROUTER_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL;

  return {
    router_mode: routerMode,
    phantomforce_managed: {
      status: "recommended",
      detail: "Default customer experience. Provider setup remains an owner/admin responsibility.",
    },
    openrouter_glm: {
      configured: openRouterConfigured,
      status: openRouterConfigured ? "Configured" : "Not Configured",
      model_id: modelId,
      setup_required: !openRouterConfigured,
      payment_setup_needed: !openRouterConfigured,
      live_transport_enabled: openRouterTransportEnabled,
      live_call_ready: openRouterLiveReady,
      detail: openRouterLiveReady
        ? "GLM 5.2 is ready for admin-selected low-risk Phantom AI chat through OpenRouter."
        : openRouterConfigured
          ? "OpenRouter key is configured. Set live provider and OpenRouter transport flags to enable GLM 5.2 chat."
        : "OpenRouter account/API key is required before GLM 5.2 can run through Phantom AI.",
    },
    claude_api: {
      configured: claudeConfigured,
      status: claudeConfigured ? "Configured" : "Not Configured",
      detail: claudeConfigured
        ? "Premium reasoning route is configured but not called by Patch 3B."
        : "Premium reasoning route is planned for official Claude API configuration later.",
    },
    local_fallback: {
      available: localAvailable,
      status: localAvailable ? "Available" : "Not Available",
      detail: localAvailable
        ? "Private API lane may be selected for sensitive or protected tasks later."
        : "Private APIs save lives. No private route is configured for this server yet.",
    },
    byok: {
      enabled: byokEnabled,
      status: byokEnabled ? "Future" : "Disabled",
      detail: "Bring Your Own Key remains advanced/future and is disabled by default.",
    },
    budget: {
      status: "Planned / Not Enforced",
      default_tenant_budget_usd: parseBudget(env.PHANTOM_DEFAULT_TENANT_BUDGET_USD),
      detail: "Budget fields are recorded/planned; enforcement is not implemented in Patch 3B.",
    },
    hermes: {
      ledger_enabled: true,
      context_compiler_enabled: true,
      ledger_path: resolveHermesLedgerPath(env.PHANTOM_HERMES_LEDGER_PATH),
      status: "Ledger Enabled / Context Compiler Enabled",
    },
    phantom_plus: {
      status: "Planned",
      detail: "PhantomPlus will be bounded managed multi-agent runs inside PhantomForce. No loops are implemented.",
      agent_loop_status: "Not Implemented",
    },
  };
}

function classifySensitivity(request: ModelRouterRequest): SensitivityLevel {
  if (request.sensitivity_level === "high") return "high";
  if (HIGH_SENSITIVITY_PATTERN.test(request.user_request)) return "high";
  return request.sensitivity_level ?? "low";
}

function taskRequiresApproval(request: ModelRouterRequest) {
  const text = `${request.task_type} ${request.user_request}`;
  if (APPROVAL_ONLY_ACTION_PATTERN.test(text)) return true;
  if (ADVICE_OR_DRAFT_PATTERN.test(text) && !EXPLICIT_EXECUTION_PATTERN.test(text)) return false;
  return EXPLICIT_EXTERNAL_ACTION_PATTERN.test(text) || APPROVAL_ONLY_ACTION_PATTERN.test(text);
}

function taskLooksDestructive(request: ModelRouterRequest) {
  return DESTRUCTIVE_TASK_PATTERN.test(`${request.task_type} ${request.user_request}`);
}

function chooseRoute(request: ModelRouterRequest, status: ProviderSetupStatus): ModelRouterDecision {
  const sensitivity = classifySensitivity(request);
  const approvalRequired = taskRequiresApproval(request);
  const risks: string[] = [];
  let providerRoute: ProviderRoute = "mock";
  let modelId = "phantomforce-mock-router";
  let nextAction = "Record mock result in Hermes and keep action approval-only.";

  if (approvalRequired) {
    risks.push("Action requires explicit approval and must not execute automatically.");
  }

  if (sensitivity === "high") {
    risks.push("High-sensitivity data must not route to cheap third-party worker models by default.");
  }

  if (!approvalRequired && sensitivity !== "high") {
    if (
      (status.router_mode === "openrouter" || status.router_mode === "router") &&
      status.openrouter_glm.configured &&
      WORKER_TASK_PATTERN.test(request.task_type)
    ) {
      providerRoute = "openrouter_glm";
      modelId = status.openrouter_glm.model_id;
      nextAction = "OpenRouter GLM worker route selected for low-risk work; live call remains disabled until approved.";
    } else if ((status.router_mode === "claude" || status.router_mode === "router") && status.claude_api.configured) {
      providerRoute = "claude";
      modelId = "claude-api-configured-later";
      nextAction = "Premium route selected in status only; Patch 3B does not call Claude.";
    } else if ((status.router_mode === "local" || status.router_mode === "router") && status.local_fallback.available) {
      providerRoute = "local";
      modelId = "private-api-configured-later";
      nextAction = "Private API lane selected in status only; Patch 3B does not call protected routes.";
    }
  }

  if (providerRoute === "mock") {
    risks.push("No live provider call executed; result is demo/mock foundation only.");
  }

  return {
    provider_route: providerRoute,
    model_id: modelId,
    sensitivity_level: sensitivity,
    approval_required: approvalRequired,
    approval_status: approvalRequired ? "pending" : "not_required",
    risks,
    next_action: nextAction,
    estimated_cost_usd: providerRoute === "mock" ? 0 : null,
  };
}

function buildActionPreview(request: ModelRouterRequest, decision: ModelRouterDecision): ActionPreview {
  if (taskLooksDestructive(request)) {
    return {
      status: "destructive",
      label: "Destructive or production-like action",
      approval_required: true,
      live_execution_allowed: false,
      safe_for_preview: true,
      reasons: [
        "The requested action touches billing, credentials, production, deploys, deletes, or destructive state.",
        "Patch 3C only previews the decision. It does not execute the action.",
      ],
      next_action: "Create a pending approval item in a future patch; do not execute.",
    };
  }

  if (decision.sensitivity_level === "high") {
    return {
      status: "blocked",
      label: "Blocked for high sensitivity",
      approval_required: true,
      live_execution_allowed: false,
      safe_for_preview: true,
      reasons: [
        "High-sensitivity data must not route to cheap third-party worker models by default.",
        "A private/manual review path is required before any live provider work.",
      ],
      next_action: "Keep this as a redacted preview until a private approved route exists.",
    };
  }

  if (decision.approval_required) {
    return {
      status: "pending_approval",
      label: "Pending approval required",
      approval_required: true,
      live_execution_allowed: false,
      safe_for_preview: true,
      reasons: ["The request asks for an external or live action that needs explicit approval."],
      next_action: "Show a pending approval preview; do not execute.",
    };
  }

  if (decision.provider_route !== "mock") {
    return {
      status: "live_provider_required",
      label: "Live provider required later",
      approval_required: false,
      live_execution_allowed: false,
      safe_for_preview: true,
      reasons: ["The router selected a non-mock route, but this patch does not call live providers."],
      next_action: "Use this preview for review only; live provider wiring needs a separate approved patch.",
    };
  }

  return {
    status: "safe",
    label: "Safe dry-run preview",
    approval_required: false,
    live_execution_allowed: false,
    safe_for_preview: true,
    reasons: ["The request can be previewed locally without live provider calls or external actions."],
    next_action: "Review the context packet and ledger metadata before deeper integration.",
  };
}

function createApprovalId(request: ModelRouterRequest) {
  const digest = createHash("sha256")
    .update(`${request.tenant_id}:${request.request_id}:${request.task_type}`)
    .digest("hex")
    .slice(0, 24);
  return `appr-${digest}`;
}

function getApprovalStatus(actionPreview: ActionPreview): ApprovalRequestStatus {
  if (actionPreview.status === "safe") return "preview-only";
  if (actionPreview.status === "blocked" || actionPreview.status === "destructive") return "blocked";
  return "pending";
}

function getRiskLevel(decision: ModelRouterDecision, actionPreview: ActionPreview): ApprovalRiskLevel {
  if (actionPreview.status === "destructive") return "critical";
  if (decision.sensitivity_level === "high" || actionPreview.status === "blocked") return "high";
  if (actionPreview.status === "pending_approval" || actionPreview.status === "live_provider_required") return "medium";
  return "low";
}

function getApprovalExpiry(status: ApprovalRequestStatus, createdAt: Date) {
  if (status === "preview-only" || status === "blocked") return null;
  return new Date(createdAt.getTime() + 24 * 60 * 60 * 1000).toISOString();
}

function buildApprovalSummary(request: ModelRouterRequest, actionPreview: ActionPreview) {
  const prefix =
    actionPreview.status === "safe"
      ? "No approval required"
      : actionPreview.status === "destructive"
        ? "Blocked destructive action"
        : actionPreview.status === "blocked"
          ? "Blocked approval preview"
          : "Approval required";
  return `${prefix}: ${request.task_type} for ${request.business_name}`;
}

function buildApprovalRequestPreview(
  request: ModelRouterRequest,
  decision: ModelRouterDecision,
  actionPreview: ActionPreview,
  compactContext: string,
  budgetStatus: BudgetGuardStatus | "not_enforced",
): ApprovalRequestPreview {
  const createdAt = new Date();
  const status = getApprovalStatus(actionPreview);

  return {
    approval_id: createApprovalId(request),
    action_type: redactSensitiveText(request.task_type),
    risk_level: getRiskLevel(decision, actionPreview),
    status,
    summary: redactSensitiveText(buildApprovalSummary(request, actionPreview)),
    approval_reason: redactSensitiveText(actionPreview.reasons.join(" ")),
    requested_by: {
      actor_user_id: redactSensitiveText(request.actor_user_id),
      actor_role: request.actor_role,
    },
    tenant_context: {
      tenant_id: redactSensitiveText(request.tenant_id),
      business_name: redactSensitiveText(request.business_name),
      request_id: redactSensitiveText(request.request_id),
    },
    created_at: createdAt.toISOString(),
    expires_at: getApprovalExpiry(status, createdAt),
    estimated_impact: {
      provider_route: decision.provider_route,
      model_id: decision.model_id,
      estimated_tokens: Math.ceil(compactContext.length / 4),
      estimated_cost_usd: decision.estimated_cost_usd,
      budget_status: budgetStatus,
    },
    redacted_context_preview: redactSensitiveText(compactContext),
    safety_flags: {
      dry_run: true,
      execution_disabled: true,
      approval_execution_implemented: false,
      live_provider_call_allowed: false,
      ledger_write_allowed: false,
      secrets_redacted: true,
      destructive_action: actionPreview.status === "destructive",
      live_provider_required: actionPreview.status === "live_provider_required",
      high_sensitivity: decision.sensitivity_level === "high",
    },
    execution_disabled: true,
  };
}

function isSelectedProviderEnabled(route: ProviderRoute, status: ProviderSetupStatus) {
  if (route === "mock") return true;
  if (route === "openrouter_glm") return status.openrouter_glm.configured;
  if (route === "claude") return status.claude_api.configured;
  if (route === "local") return status.local_fallback.available;
  return false;
}

export function previewModelRouterFoundation(
  request: ModelRouterRequest,
  options: {
    env?: NodeJS.ProcessEnv;
  } = {},
): ModelRouterPreviewResult {
  const status = getProviderSetupStatus(options.env ?? process.env);
  const decision = chooseRoute(request, status);
  const contextPacket = compileHermesContext({
    tenant_id: request.tenant_id,
    business_name: request.business_name,
    request_id: request.request_id,
    task_type: request.task_type,
    sensitivity_level: decision.sensitivity_level,
    provider_route: decision.provider_route,
    user_request: request.user_request,
    business_summary: request.business_summary,
    module_data: request.module_data,
    relevant_rules: request.relevant_rules ?? DEFAULT_RULES,
    approval_restrictions: request.approval_restrictions ?? DEFAULT_APPROVAL_RESTRICTIONS,
  });
  const actionPreview = buildActionPreview(request, decision);
  const providerPolicy = evaluateProviderBudgetPolicy(
    {
      route_candidate: decision.provider_route,
      sensitivity_level: decision.sensitivity_level,
      action_classification: actionPreview.status,
      estimated_tokens: contextPacket.estimated_tokens,
      estimated_cost_usd: decision.estimated_cost_usd,
      approval_required: decision.approval_required,
      provider_enabled: isSelectedProviderEnabled(decision.provider_route, status),
    },
    { env: options.env ?? process.env },
  );
  const approvalRequest = buildApprovalRequestPreview(
    request,
    decision,
    actionPreview,
    contextPacket.compact_context,
    providerPolicy.budget.status,
  );
  const providerReadiness = getProviderReadinessReport(options.env ?? process.env);
  const providerInvocation = evaluateProviderInvocationFirewall({
    requested_provider_id: decision.provider_route,
    requested_route: decision.provider_route,
    requested_model_id: decision.model_id,
    redacted_context_summary: contextPacket.compact_context,
    estimated_tokens: contextPacket.estimated_tokens,
    estimated_cost_usd: decision.estimated_cost_usd,
    action_classification: actionPreview.status,
    sensitivity_level: decision.sensitivity_level,
    approval_request: approvalRequest,
    policy_result: providerPolicy,
    readiness_result: providerReadiness,
  });

  return {
    decision,
    context_packet: contextPacket,
    action_preview: actionPreview,
    approval_request: approvalRequest,
    provider_policy: providerPolicy,
    provider_invocation: providerInvocation,
    dry_run: true,
    ledger_written: false,
    live_provider_called: false,
  };
}

export async function runModelRouterFoundation(
  request: ModelRouterRequest,
  options: {
    env?: NodeJS.ProcessEnv;
    ledgerPath?: string;
  } = {},
): Promise<ModelRouterRunResult> {
  const preview = previewModelRouterFoundation(request, { env: options.env });
  const {
    decision,
    context_packet: contextPacket,
    action_preview: actionPreview,
    approval_request: approvalRequest,
    provider_policy: providerPolicy,
    provider_invocation: providerInvocation,
  } = preview;

  const ledgerRecord = {
    timestamp: new Date().toISOString(),
    tenant_id: request.tenant_id,
    business_name: request.business_name,
    actor_user_id: request.actor_user_id,
    actor_role: request.actor_role,
    request_id: request.request_id,
    task_type: request.task_type,
    sensitivity_level: decision.sensitivity_level,
    provider_route: decision.provider_route,
    model_id: decision.model_id,
    context_chars: contextPacket.context_chars,
    estimated_tokens: contextPacket.estimated_tokens,
    estimated_cost_usd: decision.estimated_cost_usd,
    user_request_summary: contextPacket.user_request_summary,
    result_summary:
      decision.provider_route === "mock"
        ? "Mock Phantom AI route recorded to Hermes. No provider call executed."
        : `Provider route selected as ${decision.provider_route}; live model call not executed by Patch 3B.`,
    approval_required: decision.approval_required,
    approval_status: decision.approval_status,
    risks: decision.risks,
    next_action: decision.next_action,
    agent_run_id: request.agent_run_id,
    parent_task_id: request.parent_task_id,
  };

  await appendHermesLedgerRecord(ledgerRecord, { ledgerPath: options.ledgerPath });

  return {
    decision,
    context_packet: contextPacket,
    action_preview: actionPreview,
    approval_request: approvalRequest,
    provider_policy: providerPolicy,
    provider_invocation: providerInvocation,
    ledger_record: ledgerRecord,
  };
}
