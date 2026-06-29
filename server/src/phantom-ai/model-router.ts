import { compileHermesContext } from "./context-compiler.js";
import { appendHermesLedgerRecord, resolveHermesLedgerPath } from "./hermes-ledger.js";
import type {
  ModelRouterDecision,
  ModelRouterMode,
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

const APPROVAL_TASK_PATTERN =
  /(send|post|upload|charge|billing|payment|card|delete|deploy|credential|secret|production|route change)/i;

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
      detail: openRouterConfigured
        ? "Cheap worker route can be selected for low-risk tasks; no live call is made by this status check."
        : "OpenRouter credits/API key required. Jordan must manually fund OpenRouter and add OPENROUTER_API_KEY to local server env.",
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
        ? "Private/helper fallback may be selected for sensitive or offline tasks later."
        : "No local fallback endpoint is configured for the server.",
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
  return APPROVAL_TASK_PATTERN.test(`${request.task_type} ${request.user_request}`);
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
      modelId = "local-fallback-configured-later";
      nextAction = "Local/private route selected in status only; Patch 3B does not call local models.";
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

export async function runModelRouterFoundation(
  request: ModelRouterRequest,
  options: {
    env?: NodeJS.ProcessEnv;
    ledgerPath?: string;
  } = {},
): Promise<ModelRouterRunResult> {
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
    ledger_record: ledgerRecord,
  };
}

