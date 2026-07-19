import { redactSensitiveText } from "../hermes-ledger.js";
import { sanitizeProviderDetail } from "../provider-error.js";
import type { SensitivityLevel } from "../types.js";

type LocalOllamaFetchResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
};

type LocalOllamaFetch = (
  url: string,
  init: {
    method: "GET" | "POST";
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<LocalOllamaFetchResponse>;

export type LocalOllamaStatus = {
  ok: boolean;
  endpoint: string;
  model_id: string;
  fallback_model_id: string | null;
  local_only: boolean;
  models: string[];
  error: string | null;
};

const DEFAULT_OLLAMA_PROBE_TIMEOUT_MS = 4000;
const DEFAULT_OLLAMA_CHAT_TIMEOUT_MS = 60000;

export type LocalOllamaChatInput = {
  requestId: string;
  businessName: string;
  taskType: string;
  userMessage: string;
  compactContext: string;
  sensitivityLevel: SensitivityLevel;
  approvalRequired: boolean;
  executionMode?: "approval" | "auto";
  conversationMode?: boolean;
  maxTokens?: number;
  adminOperatorLane?: boolean;
};

export type LocalOllamaChatResult = {
  provider_id: "local_ollama";
  model_id: string;
  requested_model_id: string;
  fallback_model_id: string | null;
  fallback_used: boolean;
  endpoint: string;
  status: "blocked" | "called" | "error";
  blocked_reason: string | null;
  error_message: string | null;
  output_text: string;
  provider_called: boolean;
  network_call_performed: boolean;
  request_body_prepared: boolean;
  ready_for_send: boolean;
  ledger_written: false;
  queue_written: false;
  approval_executed: false;
  external_action_executed: false;
  external_provider_called: false;
  raw_secret_exposed: false;
  raw_prompt_returned: false;
  raw_response_returned: false;
  redacted_prompt_chars: number;
  redacted_response_chars: number;
  response_status: number | null;
  usage: {
    prompt_tokens: number | null;
    completion_tokens: number | null;
    total_tokens: number | null;
  };
};

const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
const DEFAULT_LOCAL_MODEL = "hf.co/unsloth/GLM-5.2-GGUF:UD-IQ1_S";
const MAX_CONTEXT_CHARS = 5000;
const MAX_MESSAGE_CHARS = 1600;
const MAX_RESPONSE_CHARS = 5000;

function normalizeBaseUrl(value: string | undefined) {
  return (value?.trim() || DEFAULT_OLLAMA_BASE_URL).replace(/\/+$/, "");
}

function resolveLocalModel(env: NodeJS.ProcessEnv | Record<string, string | undefined>) {
  return (
    env.PHANTOM_LOCAL_GLM_MODEL?.trim() ||
    env.PHANTOM_OLLAMA_MODEL?.trim() ||
    env.OLLAMA_MODEL?.trim() ||
    DEFAULT_LOCAL_MODEL
  );
}

function resolveFallbackModel(env: NodeJS.ProcessEnv | Record<string, string | undefined>, primaryModelId: string) {
  const explicit =
    env.PHANTOM_OLLAMA_FALLBACK_MODEL?.trim() ||
    env.PHANTOM_LOCAL_GLM_FALLBACK_MODEL?.trim() ||
    "";
  return explicit && explicit !== primaryModelId ? explicit : null;
}

function isLocalOllamaBaseUrl(baseUrl: string) {
  try {
    const parsed = new URL(baseUrl);
    return ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function emptyUsage(): LocalOllamaChatResult["usage"] {
  return {
    prompt_tokens: null,
    completion_tokens: null,
    total_tokens: null,
  };
}

function blockedResult(
  input: LocalOllamaChatInput,
  endpoint: string,
  modelId: string,
  requestedModelId: string,
  fallbackModelId: string | null,
  fallbackUsed: boolean,
  reason: string,
): LocalOllamaChatResult {
  return {
    provider_id: "local_ollama",
    model_id: modelId,
    requested_model_id: requestedModelId,
    fallback_model_id: fallbackModelId,
    fallback_used: fallbackUsed,
    endpoint,
    status: "blocked",
    blocked_reason: redactSensitiveText(reason),
    error_message: null,
    output_text: `Local Phantom reasoning is blocked: ${redactSensitiveText(reason)}`,
    provider_called: false,
    network_call_performed: false,
    request_body_prepared: false,
    ready_for_send: false,
    ledger_written: false,
    queue_written: false,
    approval_executed: false,
    external_action_executed: false,
    external_provider_called: false,
    raw_secret_exposed: false,
    raw_prompt_returned: false,
    raw_response_returned: false,
    redacted_prompt_chars: redactSensitiveText(input.userMessage).length,
    redacted_response_chars: 0,
    response_status: null,
    usage: emptyUsage(),
  };
}

function firstString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((item) => firstString(item)).find((item): item is string => Boolean(item)) ?? null;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return firstString(record.content) ?? firstString(record.text);
  }
  return null;
}

function extractOutputText(json: unknown) {
  if (!json || typeof json !== "object") return "";
  const record = json as Record<string, unknown>;
  return firstString(record.message) ?? firstString(record.response) ?? firstString(record.content) ?? "";
}

function extractUsage(json: unknown): LocalOllamaChatResult["usage"] {
  if (!json || typeof json !== "object") return emptyUsage();
  const record = json as Record<string, unknown>;
  const numberOrNull = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
  const promptTokens = numberOrNull(record.prompt_eval_count);
  const completionTokens = numberOrNull(record.eval_count);
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens !== null && completionTokens !== null ? promptTokens + completionTokens : null,
  };
}

async function listInstalledOllamaModels(baseUrl: string, fetchImpl: LocalOllamaFetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_OLLAMA_PROBE_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${baseUrl}/api/tags`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const json = await response.json();
    if (!json || typeof json !== "object") return null;
    const models = (json as { models?: unknown }).models;
    if (!Array.isArray(models)) return null;

    return new Set(
      models.flatMap((model) => {
        if (!model || typeof model !== "object") return [];
        const record = model as { name?: unknown; model?: unknown };
        const name = typeof record.name === "string" ? record.name : "";
        const modelId = typeof record.model === "string" ? record.model : "";
        return [name, modelId].filter(Boolean);
      }),
    );
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function getLocalOllamaStatus(
  options: {
    env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
    fetchImpl?: LocalOllamaFetch;
  } = {},
): Promise<LocalOllamaStatus> {
  const env = options.env ?? process.env;
  const baseUrl = normalizeBaseUrl(env.OLLAMA_BASE_URL);
  const endpoint = `${baseUrl}/api/tags`;
  const modelId = resolveLocalModel(env);
  const fallbackModelId = resolveFallbackModel(env, modelId);
  const localOnly = isLocalOllamaBaseUrl(baseUrl);

  if (!localOnly && env.PHANTOM_ALLOW_REMOTE_OLLAMA !== "true") {
    return {
      ok: false,
      endpoint,
      model_id: modelId,
      fallback_model_id: fallbackModelId,
      local_only: false,
      models: [],
      error: "OLLAMA_BASE_URL must be localhost unless PHANTOM_ALLOW_REMOTE_OLLAMA=true.",
    };
  }

  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as LocalOllamaFetch | undefined);
  if (!fetchImpl) {
    return {
      ok: false,
      endpoint,
      model_id: modelId,
      fallback_model_id: fallbackModelId,
      local_only: localOnly,
      models: [],
      error: "No server fetch implementation is available for local Ollama status.",
    };
  }

  const models = await listInstalledOllamaModels(baseUrl, fetchImpl);
  if (!models) {
    return {
      ok: false,
      endpoint,
      model_id: modelId,
      fallback_model_id: fallbackModelId,
      local_only: localOnly,
      models: [],
      error: "Local Ollama did not return an installed model list.",
    };
  }

  return {
    ok: models.has(modelId) || Boolean(fallbackModelId && models.has(fallbackModelId)),
    endpoint,
    model_id: modelId,
    fallback_model_id: fallbackModelId,
    local_only: localOnly,
    models: Array.from(models).sort(),
    error: models.has(modelId) || Boolean(fallbackModelId && models.has(fallbackModelId))
      ? null
      : `Requested local model "${modelId}" is not installed.`,
  };
}

export async function callLocalOllamaChat(
  input: LocalOllamaChatInput,
  options: {
    env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
    fetchImpl?: LocalOllamaFetch;
  } = {},
): Promise<LocalOllamaChatResult> {
  const env = options.env ?? process.env;
  const baseUrl = normalizeBaseUrl(env.OLLAMA_BASE_URL);
  const requestedModelId = resolveLocalModel(env);
  const fallbackModelId = resolveFallbackModel(env, requestedModelId);
  let modelId = requestedModelId;
  let fallbackUsed = false;
  const endpoint = `${baseUrl}/api/chat`;

  if (!isLocalOllamaBaseUrl(baseUrl) && env.PHANTOM_ALLOW_REMOTE_OLLAMA !== "true") {
    return blockedResult(
      input,
      endpoint,
      modelId,
      requestedModelId,
      fallbackModelId,
      fallbackUsed,
      "OLLAMA_BASE_URL must be localhost unless PHANTOM_ALLOW_REMOTE_OLLAMA=true.",
    );
  }

  if (input.sensitivityLevel === "high" && !input.adminOperatorLane) {
    return blockedResult(
      input,
      endpoint,
      modelId,
      requestedModelId,
      fallbackModelId,
      fallbackUsed,
      "High-sensitivity requests require owner review before local model processing.",
    );
  }

  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as LocalOllamaFetch | undefined);
  if (!fetchImpl) {
    return blockedResult(
      input,
      endpoint,
      modelId,
      requestedModelId,
      fallbackModelId,
      fallbackUsed,
      "No server fetch implementation is available for the local Ollama transport.",
    );
  }

  const installedModels = await listInstalledOllamaModels(baseUrl, fetchImpl);
  if (installedModels && !installedModels.has(requestedModelId)) {
    if (fallbackModelId && installedModels.has(fallbackModelId)) {
      modelId = fallbackModelId;
      fallbackUsed = true;
    } else {
      return blockedResult(
        input,
        endpoint,
        requestedModelId,
        requestedModelId,
        fallbackModelId,
        false,
        `Requested local model "${requestedModelId}" is not installed in Ollama. Pull it first, or set PHANTOM_OLLAMA_FALLBACK_MODEL to an installed local model.`,
      );
    }
  }

  const redactedContext = redactSensitiveText(input.compactContext).slice(0, MAX_CONTEXT_CHARS);
  const redactedMessage = redactSensitiveText(input.userMessage).slice(0, MAX_MESSAGE_CHARS);
  const conversationMode = input.conversationMode === true;
  const prompt = conversationMode
    ? [
        redactedContext,
        "",
        `Current user message: ${redactedMessage}`,
      ].filter(Boolean).join("\n")
    : [
        `Business: ${redactSensitiveText(input.businessName).slice(0, 120)}`,
        `Task: ${redactSensitiveText(input.taskType).slice(0, 120)}`,
        `Admin-only local brain metadata: active model ${modelId}; requested target ${requestedModelId}; fallback used ${fallbackUsed ? "yes" : "no"}${fallbackModelId ? `; fallback model ${fallbackModelId}` : ""}. Use this only when the user asks what model or brain is running.`,
        `Execution mode: ${input.executionMode === "auto" ? "auto" : "approval"}. ${input.executionMode === "auto" ? "Safe internal workspace artifacts/action cards may be created automatically; external actions still require adapter receipts." : "Stage actions for review before execution."}`,
        "Use the compact Hermes context. Respond like a normal adaptive business assistant inside PhantomForce.",
        "/nothink",
        "Match the user's intent and tone. Be direct, useful, and specific.",
        "You can draft, brainstorm, prioritize, critique, explain, plan, and turn requests into business artifacts, image briefs, video briefs, build plans, operator work items, or action cards.",
        "Describe Phantom as active, capable, and in Full Effect for admin work. Phantom is an admin command cockpit with action lanes.",
        "For image requests, produce prompt-ready art direction, crop, subject, style, and delivery notes through Media Lab.",
        "For video requests, produce a generation-ready brief, source analysis if relevant, shot list, pacing notes, caption, and approval path through Media Lab.",
        "For build requests, produce a practical implementation plan: app/site/dashboard structure, data model, UI flow, files/modules likely needed, test path, and next action.",
        "For local operator requests, behave like Phantom Operator: analyze the request and produce concrete execution steps for the admin-only operator lane. Do not expose backend tool names.",
        "Do not claim that you sent, posted, uploaded, charged, deployed, deleted, or changed production state unless a specific action adapter receipt is present.",
        "If the user asks for an external action, prepare the concrete artifact/action plan and say it is ready for the proper execution lane or owner approval.",
        "Privacy-first rule: never infer or claim the user's physical location from IP, account, browser, device, timezone, memory, or context.",
        "For weather or location-based requests, ask for an explicit city/ZIP/location or explicit approval for a live lookup; do not guess.",
        "Do not expose transport flags, API keys, raw prompts, or internal Hermes details to the user. If asked about the model, use the admin-only local brain metadata exactly.",
        "",
        redactedContext,
        "",
        `User request: ${redactedMessage}`,
      ].join("\n");
  const body = JSON.stringify({
    model: modelId,
    stream: false,
    think: false,
    keep_alive: conversationMode ? "24h" : "5m",
    options: {
      temperature: conversationMode ? 0.3 : 0.35,
      think: false,
      num_ctx: conversationMode ? 2048 : undefined,
      num_predict: input.maxTokens ?? (conversationMode ? 80 : 700),
    },
    messages: [
      {
        role: "system",
        content: conversationMode
          ? "You are Phantom AI, a fast, natural general-purpose assistant. Answer directly in 1-3 sentences unless the user requests another format. Stay in the user's current language and script unless they explicitly request translation or another language. Follow recent conversation precisely: preserve named subjects, resolve pronouns from the newest relevant turn, and obey later corrections. When asked for a replacement, shorter version, final item, or one new fact, return only that result instead of repeating earlier material. Honor exact output constraints without extra framing. When an approximate word count is requested, aim within 20 percent of it instead of stopping early. Use stable knowledge for factual claims and never invent a plausible-sounding detail; state uncertainty when needed. Do not append a follow-up question unless missing information prevents a useful answer. For harmless taste questions, make a playful conversational choice instead of disclaiming that AI lacks feelings; never claim real sensory experience. Recalculate arithmetic before answering. Do not mention business systems, action cards, memory, ledgers, pipelines, workspace status, or internal operations unless asked. Never expose hidden reasoning."
          : "You are Phantom AI inside PhantomForce. You are a practical business operator for PhantomForce, ChicagoShots, image/video creation, sales, scheduling, websites, apps, dashboards, builds, local operator work, and backend ops. Answer naturally. Stay useful. Keep external actions receipt-based without sounding like a compliance log.",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  const chatTimeoutMs = Number(env.PHANTOM_OLLAMA_TIMEOUT_MS ?? DEFAULT_OLLAMA_CHAT_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    Number.isFinite(chatTimeoutMs) ? chatTimeoutMs : DEFAULT_OLLAMA_CHAT_TIMEOUT_MS,
  );

  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body,
      signal: controller.signal,
    });
    const json = await response.json().catch(async () => {
      const text = await response.text().catch(() => "");
      return { error: redactSensitiveText(text).slice(0, 1000) };
    });
    const outputText = redactSensitiveText(extractOutputText(json)).slice(0, MAX_RESPONSE_CHARS);
    const errorValue = json && typeof json === "object" ? (json as Record<string, unknown>).error : null;
    const errorText = response.ok
      ? null
      : sanitizeProviderDetail(redactSensitiveText(firstString(errorValue) ?? `HTTP ${response.status}`), { lane: "local" });
    const safeOutput =
      outputText ||
      (response.ok
        ? "The local Ollama model returned an empty response."
        : `Local Ollama returned an error: ${errorText}`);

    return {
      provider_id: "local_ollama",
      model_id: modelId,
      requested_model_id: requestedModelId,
      fallback_model_id: fallbackModelId,
      fallback_used: fallbackUsed,
      endpoint,
      status: response.ok ? "called" : "error",
      blocked_reason: null,
      error_message: errorText,
      output_text: safeOutput,
      provider_called: response.ok,
      network_call_performed: true,
      request_body_prepared: true,
      ready_for_send: true,
      ledger_written: false,
      queue_written: false,
      approval_executed: false,
      external_action_executed: false,
      external_provider_called: false,
      raw_secret_exposed: false,
      raw_prompt_returned: false,
      raw_response_returned: false,
      redacted_prompt_chars: prompt.length,
      redacted_response_chars: safeOutput.length,
      response_status: response.status,
      usage: extractUsage(json),
    };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return {
      provider_id: "local_ollama",
      model_id: modelId,
      requested_model_id: requestedModelId,
      fallback_model_id: fallbackModelId,
      fallback_used: fallbackUsed,
      endpoint,
      status: "error",
      blocked_reason: null,
      error_message: timedOut
        ? `Local brain did not answer within ${chatTimeoutMs}ms.`
        : sanitizeProviderDetail(redactSensitiveText(error instanceof Error ? error.message : String(error)), { lane: "local" }),
      output_text: timedOut
        ? "Local brain timed out. Phantom can use another allowed route."
        : "Local brain is offline. Start the local model service or switch Phantom to another brain lane.",
      provider_called: false,
      network_call_performed: true,
      request_body_prepared: true,
      ready_for_send: true,
      ledger_written: false,
      queue_written: false,
      approval_executed: false,
      external_action_executed: false,
      external_provider_called: false,
      raw_secret_exposed: false,
      raw_prompt_returned: false,
      raw_response_returned: false,
      redacted_prompt_chars: prompt.length,
      redacted_response_chars: 0,
      response_status: null,
      usage: emptyUsage(),
    };
  } finally {
    clearTimeout(timer);
  }
}
