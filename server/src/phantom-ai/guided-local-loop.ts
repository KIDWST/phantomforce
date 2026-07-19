import type { AdminProviderId } from "./admin-provider-manager.js";
import { redactSensitiveText } from "./hermes-ledger.js";
import type { SensitivityLevel } from "./types.js";

export type GuidedLoopSource = "explicit_loop" | "local_auto_supervisor";

export type GuidedLoopConfig = {
  enabled: true;
  source: GuidedLoopSource;
  local_first: true;
  supervisor_provider_id: AdminProviderId;
  supervisor_model_id: string | null;
  max_passes: number;
  timeout_ms: number;
  share_private_context: boolean;
  allow_tool_calls: boolean;
  proof_logging: boolean;
  consumer_chatgpt_browser_automation: false;
};

export type GuidedLoopChatContext = {
  requestId: string;
  businessName: string;
  taskType: string;
  userMessage: string;
  compactContext: string;
  sensitivityLevel: SensitivityLevel;
  approvalRequired: boolean;
  executionMode: "approval" | "auto";
  requestedModel?: string;
  requestedModelId?: string | null;
  routeTier?: "instant" | "standard" | "deep";
  maxProviderMs?: number | null;
};

export type GuidedLoopProviderResult = {
  provider_id?: AdminProviderId | string;
  model_id?: string;
  status: string;
  output_text?: string;
  error_message?: string | null;
  blocked_reason?: string | null;
  provider_called?: boolean;
  network_call_performed?: boolean;
  request_body_prepared?: boolean;
};

export type GuidedLoopStage = {
  stage: "local_draft" | "supervisor_review" | "local_finalize";
  provider_id: AdminProviderId;
  status: string;
  provider_called: boolean;
  network_call_performed: boolean;
  output_chars: number;
  error_message: string | null;
};

export type GuidedLoopRun = {
  providerId: AdminProviderId;
  primaryProviderId: AdminProviderId;
  fallbackUsed: boolean;
  allFailed: boolean;
  attempts: Array<{ provider_id: AdminProviderId; status: string; error_message: string | null }>;
  result: GuidedLoopProviderResult & {
    provider_id: AdminProviderId;
    model_id: string;
    output_text: string;
    provider_called: boolean;
    network_call_performed: boolean;
    request_body_prepared: boolean;
  };
  guidedLoop: {
    status:
      | "completed"
      | "degraded_local_only"
      | "degraded_supervisor_final"
      | "blocked"
      | "failed";
    source: GuidedLoopSource;
    local_first: true;
    supervisor_provider_id: AdminProviderId;
    final_provider_id: AdminProviderId | null;
    consumer_chatgpt_browser_automation: false;
    share_private_context: boolean;
    allow_tool_calls: boolean;
    proof_logging: boolean;
    stages: GuidedLoopStage[];
    safety_flags: {
      local_worker_called: boolean;
      supervisor_called: boolean;
      final_local_called: boolean;
      consumer_chatgpt_browser_automation_blocked: true;
      external_action_executed: false;
      approval_executed: false;
      raw_secret_exposed: false;
    };
  };
};

const LOOP_PROVIDER_TO_ADMIN_PROVIDER: Record<string, AdminProviderId | null> = {
  openai: "codex_cli",
  codex: "codex_cli",
  claude: "claude_cli",
  glm: "openrouter_glm",
  openrouter: "openrouter_glm",
  local: "local_ollama",
  ollama: "local_ollama",
  custom: null,
};

const FORBIDDEN_CONSUMER_CHAT_PROVIDERS = new Set([
  "browser",
  "browser_chatgpt",
  "chatgpt_browser",
  "chatgpt_web",
  "consumer_chatgpt",
  "consumer_chatgpt_browser",
  "web_chatgpt",
]);

function bool(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }
  return fallback;
}

function intInRange(value: unknown, fallback: number, min: number, max: number) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.round(parsed), min), max);
}

function cleanModel(value: unknown) {
  if (typeof value !== "string") return null;
  const model = value.trim();
  return model && model.length <= 100 && /^[\w./:@+-]+$/.test(model) ? model : null;
}

export function isForbiddenConsumerChatSupervisor(value: unknown) {
  return typeof value === "string" && FORBIDDEN_CONSUMER_CHAT_PROVIDERS.has(value.trim().toLowerCase());
}

export function backendProviderForLoopProvider(value: unknown): AdminProviderId | null {
  if (typeof value !== "string") return null;
  return LOOP_PROVIDER_TO_ADMIN_PROVIDER[value.trim().toLowerCase()] ?? null;
}

function firstNonLocalProvider(ids: Array<AdminProviderId | null | undefined>, fallback: AdminProviderId) {
  return ids.find((id): id is AdminProviderId => Boolean(id && id !== "local_ollama")) ?? fallback;
}

export function normalizeGuidedLoopConfig(
  value: unknown,
  options: {
    requestedProviderId: AdminProviderId;
    defaultSupervisorProviderId?: AdminProviderId;
    localAutoSupervisor?: boolean;
  },
): GuidedLoopConfig | null {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const explicitEnabled = bool(input.enabled, false);
  const shouldAutoGuideLocal =
    options.requestedProviderId === "local_ollama" &&
    options.localAutoSupervisor === true &&
    !explicitEnabled;
  if (!explicitEnabled && !shouldAutoGuideLocal) return null;

  const rawTarget = input.supervisor_provider ?? input.target_provider ?? input.provider;
  if (isForbiddenConsumerChatSupervisor(rawTarget)) {
    return {
      enabled: true,
      source: explicitEnabled ? "explicit_loop" : "local_auto_supervisor",
      local_first: true,
      supervisor_provider_id: options.defaultSupervisorProviderId ?? "codex_cli",
      supervisor_model_id: null,
      max_passes: 0,
      timeout_ms: 0,
      share_private_context: false,
      allow_tool_calls: false,
      proof_logging: true,
      consumer_chatgpt_browser_automation: false,
    };
  }

  const supervisorProviderId = firstNonLocalProvider(
    [
      backendProviderForLoopProvider(rawTarget),
      backendProviderForLoopProvider(input.fallback_supervisor_provider),
      options.defaultSupervisorProviderId,
      "codex_cli",
      "claude_cli",
    ],
    "codex_cli",
  );

  return {
    enabled: true,
    source: shouldAutoGuideLocal ? "local_auto_supervisor" : "explicit_loop",
    local_first: true,
    supervisor_provider_id: supervisorProviderId,
    supervisor_model_id: cleanModel(input.supervisor_model ?? input.target_model),
    max_passes: intInRange(input.max_passes, 3, 2, 3),
    timeout_ms: intInRange(input.timeout_ms, 45000, 10000, 90000),
    share_private_context: bool(input.share_private_context, false),
    allow_tool_calls: false,
    proof_logging: bool(input.proof_logging, true),
    consumer_chatgpt_browser_automation: false,
  };
}

function outputText(result: GuidedLoopProviderResult | null | undefined) {
  return redactSensitiveText(String(result?.output_text || "")).trim();
}

function usable(result: GuidedLoopProviderResult | null | undefined) {
  return result?.status === "called" && outputText(result).length > 0;
}

function resultError(result: GuidedLoopProviderResult | null | undefined) {
  return redactSensitiveText(
    result?.error_message ||
    result?.blocked_reason ||
    (result?.status ? `status: ${result.status}` : "Provider did not return a result."),
  );
}

function stage(
  name: GuidedLoopStage["stage"],
  providerId: AdminProviderId,
  result: GuidedLoopProviderResult | null | undefined,
): GuidedLoopStage {
  return {
    stage: name,
    provider_id: providerId,
    status: result?.status || "error",
    provider_called: Boolean(result?.provider_called),
    network_call_performed: Boolean(result?.network_call_performed),
    output_chars: outputText(result).length,
    error_message: usable(result) ? null : resultError(result),
  };
}

function supervisorPrompt(ctx: GuidedLoopChatContext, localDraft: string) {
  return [
    "Review and improve this local model draft for PhantomForce.",
    "Keep the answer useful, specific, and business-aware.",
    "Do not claim a send, upload, publish, browser-login, payment, deployment, deletion, or PC edit happened unless an explicit receipt exists.",
    "Return the improved answer only.",
    "",
    `User request: ${redactSensitiveText(ctx.userMessage)}`,
    "",
    `Local draft:\n${redactSensitiveText(localDraft)}`,
  ].join("\n");
}

function finalLocalPrompt(ctx: GuidedLoopChatContext, localDraft: string, supervisorDraft: string) {
  return [
    "Produce the final PhantomForce answer using the local draft and the supervisor guidance.",
    "Sound natural, decisive, and concrete. Keep risky actions approval-gated.",
    "",
    `User request: ${redactSensitiveText(ctx.userMessage)}`,
    "",
    `Local draft:\n${redactSensitiveText(localDraft)}`,
    "",
    `Supervisor guidance:\n${redactSensitiveText(supervisorDraft)}`,
  ].join("\n");
}

function contextForSupervisor(ctx: GuidedLoopChatContext, config: GuidedLoopConfig, localDraft: string) {
  if (config.share_private_context) {
    return `${ctx.compactContext}\n\nLocal draft:\n${redactSensitiveText(localDraft)}`.slice(0, 9000);
  }
  return [
    "Private workspace context is intentionally withheld from the supervisor lane.",
    "Use only the user request and the redacted local draft.",
    "",
    `Redacted local draft:\n${redactSensitiveText(localDraft)}`,
  ].join("\n").slice(0, 5000);
}

function modelId(result: GuidedLoopProviderResult | null | undefined, fallback: AdminProviderId) {
  return redactSensitiveText(String(result?.model_id || fallback));
}

function asResult(
  providerId: AdminProviderId,
  result: GuidedLoopProviderResult,
  output: string,
): GuidedLoopRun["result"] {
  return {
    ...result,
    provider_id: providerId,
    model_id: modelId(result, providerId),
    status: result.status || "called",
    output_text: output,
    provider_called: Boolean(result.provider_called),
    network_call_performed: Boolean(result.network_call_performed),
    request_body_prepared: Boolean(result.request_body_prepared),
  };
}

export async function runGuidedLocalSupervisorLoop(
  config: GuidedLoopConfig,
  ctx: GuidedLoopChatContext,
  callProvider: (providerId: AdminProviderId, ctx: GuidedLoopChatContext) => Promise<GuidedLoopProviderResult>,
): Promise<GuidedLoopRun> {
  const attempts: GuidedLoopRun["attempts"] = [];
  const stages: GuidedLoopStage[] = [];

  const localDraftResult = await callProvider("local_ollama", ctx);
  stages.push(stage("local_draft", "local_ollama", localDraftResult));
  attempts.push({
    provider_id: "local_ollama",
    status: localDraftResult.status,
    error_message: usable(localDraftResult) ? null : resultError(localDraftResult),
  });

  if (!usable(localDraftResult)) {
    return {
      providerId: "local_ollama",
      primaryProviderId: "local_ollama",
      fallbackUsed: false,
      allFailed: true,
      attempts,
      result: asResult("local_ollama", localDraftResult, ""),
      guidedLoop: {
        status: "failed",
        source: config.source,
        local_first: true,
        supervisor_provider_id: config.supervisor_provider_id,
        final_provider_id: null,
        consumer_chatgpt_browser_automation: false,
        share_private_context: config.share_private_context,
        allow_tool_calls: false,
        proof_logging: config.proof_logging,
        stages,
        safety_flags: {
          local_worker_called: Boolean(localDraftResult.provider_called),
          supervisor_called: false,
          final_local_called: false,
          consumer_chatgpt_browser_automation_blocked: true,
          external_action_executed: false,
          approval_executed: false,
          raw_secret_exposed: false,
        },
      },
    };
  }

  const localDraft = outputText(localDraftResult);
  const supervisorCtx: GuidedLoopChatContext = {
    ...ctx,
    userMessage: supervisorPrompt(ctx, localDraft),
    compactContext: contextForSupervisor(ctx, config, localDraft),
    requestedModelId: config.supervisor_model_id,
    maxProviderMs: Math.min(config.timeout_ms, 45000),
  };
  const supervisorResult = await callProvider(config.supervisor_provider_id, supervisorCtx);
  stages.push(stage("supervisor_review", config.supervisor_provider_id, supervisorResult));
  attempts.push({
    provider_id: config.supervisor_provider_id,
    status: supervisorResult.status,
    error_message: usable(supervisorResult) ? null : resultError(supervisorResult),
  });

  if (!usable(supervisorResult)) {
    return {
      providerId: "local_ollama",
      primaryProviderId: "local_ollama",
      fallbackUsed: false,
      allFailed: false,
      attempts,
      result: asResult("local_ollama", localDraftResult, localDraft),
      guidedLoop: {
        status: "degraded_local_only",
        source: config.source,
        local_first: true,
        supervisor_provider_id: config.supervisor_provider_id,
        final_provider_id: "local_ollama",
        consumer_chatgpt_browser_automation: false,
        share_private_context: config.share_private_context,
        allow_tool_calls: false,
        proof_logging: config.proof_logging,
        stages,
        safety_flags: {
          local_worker_called: Boolean(localDraftResult.provider_called),
          supervisor_called: Boolean(supervisorResult.provider_called),
          final_local_called: false,
          consumer_chatgpt_browser_automation_blocked: true,
          external_action_executed: false,
          approval_executed: false,
          raw_secret_exposed: false,
        },
      },
    };
  }

  const supervisorDraft = outputText(supervisorResult);
  const finalCtx: GuidedLoopChatContext = {
    ...ctx,
    userMessage: finalLocalPrompt(ctx, localDraft, supervisorDraft),
    compactContext: `${ctx.compactContext}\n\nSupervisor guidance:\n${supervisorDraft}`.slice(0, 9000),
    maxProviderMs: Math.min(config.timeout_ms, 45000),
  };
  const finalLocalResult = await callProvider("local_ollama", finalCtx);
  stages.push(stage("local_finalize", "local_ollama", finalLocalResult));
  attempts.push({
    provider_id: "local_ollama",
    status: finalLocalResult.status,
    error_message: usable(finalLocalResult) ? null : resultError(finalLocalResult),
  });

  const finalOutput = usable(finalLocalResult) ? outputText(finalLocalResult) : supervisorDraft;
  const finalProviderId: AdminProviderId = usable(finalLocalResult) ? "local_ollama" : config.supervisor_provider_id;
  const finalResult = usable(finalLocalResult) ? finalLocalResult : supervisorResult;

  return {
    providerId: finalProviderId,
    primaryProviderId: "local_ollama",
    fallbackUsed: finalProviderId !== "local_ollama",
    allFailed: false,
    attempts,
    result: asResult(finalProviderId, finalResult, finalOutput),
    guidedLoop: {
      status: usable(finalLocalResult) ? "completed" : "degraded_supervisor_final",
      source: config.source,
      local_first: true,
      supervisor_provider_id: config.supervisor_provider_id,
      final_provider_id: finalProviderId,
      consumer_chatgpt_browser_automation: false,
      share_private_context: config.share_private_context,
      allow_tool_calls: false,
      proof_logging: config.proof_logging,
      stages,
      safety_flags: {
        local_worker_called: Boolean(localDraftResult.provider_called),
        supervisor_called: Boolean(supervisorResult.provider_called),
        final_local_called: Boolean(finalLocalResult.provider_called),
        consumer_chatgpt_browser_automation_blocked: true,
        external_action_executed: false,
        approval_executed: false,
        raw_secret_exposed: false,
      },
    },
  };
}
