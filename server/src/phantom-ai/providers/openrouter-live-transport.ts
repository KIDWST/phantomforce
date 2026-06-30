import { redactSensitiveText } from "../hermes-ledger.js";
import type { SensitivityLevel } from "../types.js";
import {
  OPENROUTER_CHAT_COMPLETIONS_ENDPOINT,
  OPENROUTER_GLM_52_MODEL_ID,
  OPENROUTER_GLM_PROVIDER_ID,
} from "./openrouter-adapter.js";

const MAX_PROMPT_CHARS = 6000;
const DEFAULT_MAX_TOKENS = 700;
const DEFAULT_TEMPERATURE = 0.2;

type FetchLike = typeof fetch;

export type OpenRouterLiveChatInput = {
  requestId: string;
  userMessage: string;
  compactContext: string;
  sensitivityLevel: SensitivityLevel;
  approvalRequired: boolean;
  estimatedTokens: number;
  maxTokens?: number;
  temperature?: number;
};

export type OpenRouterLiveChatResult = {
  status: "blocked" | "called" | "error";
  provider_id: typeof OPENROUTER_GLM_PROVIDER_ID;
  model_id: typeof OPENROUTER_GLM_52_MODEL_ID;
  request_id: string;
  output_text: string;
  blocked_reason: string | null;
  error_message: string | null;
  live_call_allowed: boolean;
  execution_disabled: boolean;
  provider_called: boolean;
  network_call_performed: boolean;
  request_body_prepared: boolean;
  ready_for_send: boolean;
  redacted_request_summary: string;
  usage: {
    prompt_tokens: number | null;
    completion_tokens: number | null;
    total_tokens: number | null;
  };
  raw_api_key_returned: false;
  raw_prompt_returned: false;
  raw_response_returned: false;
  safety_flags: {
    admin_only: true;
    live_provider_call_allowed: boolean;
    provider_called: boolean;
    network_call_performed: boolean;
    approval_required: boolean;
    high_sensitivity_blocked: boolean;
    raw_secret_exposed: false;
    raw_prompt_returned: false;
    raw_response_returned: false;
    queue_written: false;
    approval_executed: false;
    external_action_executed: false;
  };
};

function envEnabled(value: string | undefined) {
  return value === "true";
}

function clampNonNegativeInteger(value: number | undefined, fallback: number, max: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.floor(value ?? fallback), 1), max);
}

function safePrompt(value: string, maxChars = MAX_PROMPT_CHARS) {
  return redactSensitiveText(value.replace(/\s+/g, " ").trim()).slice(0, maxChars);
}

function firstTextContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "text" in item) {
          const text = (item as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function readUsage(value: unknown) {
  if (!value || typeof value !== "object") {
    return { prompt_tokens: null, completion_tokens: null, total_tokens: null };
  }

  const usage = value as {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    total_tokens?: unknown;
  };

  return {
    prompt_tokens: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : null,
    completion_tokens: typeof usage.completion_tokens === "number" ? usage.completion_tokens : null,
    total_tokens: typeof usage.total_tokens === "number" ? usage.total_tokens : null,
  };
}

function resultBase(input: OpenRouterLiveChatInput): Omit<OpenRouterLiveChatResult, "status" | "output_text" | "blocked_reason" | "error_message" | "live_call_allowed" | "execution_disabled" | "provider_called" | "network_call_performed" | "request_body_prepared" | "ready_for_send" | "usage" | "safety_flags"> {
  return {
    provider_id: OPENROUTER_GLM_PROVIDER_ID,
    model_id: OPENROUTER_GLM_52_MODEL_ID,
    request_id: redactSensitiveText(input.requestId),
    redacted_request_summary: safePrompt(input.userMessage, 500),
    raw_api_key_returned: false,
    raw_prompt_returned: false,
    raw_response_returned: false,
  };
}

function blockedResult(input: OpenRouterLiveChatInput, reason: string): OpenRouterLiveChatResult {
  return {
    ...resultBase(input),
    status: "blocked",
    output_text: reason,
    blocked_reason: reason,
    error_message: null,
    live_call_allowed: false,
    execution_disabled: true,
    provider_called: false,
    network_call_performed: false,
    request_body_prepared: false,
    ready_for_send: false,
    usage: { prompt_tokens: null, completion_tokens: null, total_tokens: null },
    safety_flags: {
      admin_only: true,
      live_provider_call_allowed: false,
      provider_called: false,
      network_call_performed: false,
      approval_required: input.approvalRequired,
      high_sensitivity_blocked: input.sensitivityLevel === "high",
      raw_secret_exposed: false,
      raw_prompt_returned: false,
      raw_response_returned: false,
      queue_written: false,
      approval_executed: false,
      external_action_executed: false,
    },
  };
}

function validateLiveOpenRouterGates(input: OpenRouterLiveChatInput, env: NodeJS.ProcessEnv | Record<string, string | undefined>) {
  if (input.sensitivityLevel === "high") {
    return "High-sensitivity requests are blocked from OpenRouter GLM 5.2.";
  }

  if (input.approvalRequired) {
    return "Requests that require approval cannot call OpenRouter GLM 5.2.";
  }

  if (!envEnabled(env.PHANTOM_LIVE_PROVIDERS_ENABLED)) {
    return "Set PHANTOM_LIVE_PROVIDERS_ENABLED=true to allow live provider calls.";
  }

  if (!envEnabled(env.PHANTOM_OPENROUTER_TRANSPORT_ENABLED)) {
    return "Set PHANTOM_OPENROUTER_TRANSPORT_ENABLED=true to enable the OpenRouter transport.";
  }

  if (!env.OPENROUTER_API_KEY?.trim()) {
    return "OPENROUTER_API_KEY is not configured on the server.";
  }

  return null;
}

export async function callOpenRouterGlm52(
  input: OpenRouterLiveChatInput,
  options: {
    env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
    fetchImpl?: FetchLike;
  } = {},
): Promise<OpenRouterLiveChatResult> {
  const env = options.env ?? process.env;
  const blockedReason = validateLiveOpenRouterGates(input, env);

  if (blockedReason) {
    return blockedResult(input, blockedReason);
  }

  const apiKey = env.OPENROUTER_API_KEY?.trim();
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  if (!apiKey) {
    return blockedResult(input, "OPENROUTER_API_KEY is not configured on the server.");
  }

  if (typeof fetchImpl !== "function") {
    return blockedResult(input, "Server fetch runtime is unavailable.");
  }

  const maxTokens = clampNonNegativeInteger(input.maxTokens, DEFAULT_MAX_TOKENS, 2000);
  const temperature = Number.isFinite(input.temperature) ? Math.min(Math.max(input.temperature ?? DEFAULT_TEMPERATURE, 0), 1) : DEFAULT_TEMPERATURE;
  const compactContext = safePrompt(input.compactContext);
  const userMessage = safePrompt(input.userMessage, 3000);
  const body = {
    model: env.OPENROUTER_MODEL?.trim() || OPENROUTER_GLM_52_MODEL_ID,
    messages: [
      {
        role: "system",
        content:
          "You are Phantom AI inside PhantomForce. Help the business owner with concise operational guidance. Do not claim to send, post, upload, delete, charge, deploy, or change credentials.",
      },
      {
        role: "user",
        content: `Hermes context:\n${compactContext}\n\nOwner request:\n${userMessage}`,
      },
    ],
    max_tokens: maxTokens,
    temperature,
    stream: false,
  };

  try {
    const response = await fetchImpl(OPENROUTER_CHAT_COMPLETIONS_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": env.PHANTOM_OPENROUTER_HTTP_REFERER?.trim() || "http://127.0.0.1",
        "X-OpenRouter-Title": "PhantomForce",
      },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => null)) as
      | {
          choices?: Array<{ message?: { content?: unknown } }>;
          usage?: unknown;
          error?: { message?: unknown };
        }
      | null;

    if (!response.ok) {
      return {
        ...resultBase(input),
        status: "error",
        output_text: "OpenRouter returned an error. Check admin status for setup details.",
        blocked_reason: null,
        error_message: redactSensitiveText(
          typeof payload?.error?.message === "string" ? payload.error.message : `OpenRouter HTTP ${response.status}`,
        ),
        live_call_allowed: true,
        execution_disabled: false,
        provider_called: true,
        network_call_performed: true,
        request_body_prepared: true,
        ready_for_send: true,
        usage: readUsage(payload?.usage),
        safety_flags: {
          admin_only: true,
          live_provider_call_allowed: true,
          provider_called: true,
          network_call_performed: true,
          approval_required: input.approvalRequired,
          high_sensitivity_blocked: false,
          raw_secret_exposed: false,
          raw_prompt_returned: false,
          raw_response_returned: false,
          queue_written: false,
          approval_executed: false,
          external_action_executed: false,
        },
      };
    }

    const outputText = redactSensitiveText(firstTextContent(payload?.choices?.[0]?.message?.content)).trim();

    return {
      ...resultBase(input),
      status: "called",
      output_text: outputText || "OpenRouter GLM 5.2 returned an empty response.",
      blocked_reason: null,
      error_message: null,
      live_call_allowed: true,
      execution_disabled: false,
      provider_called: true,
      network_call_performed: true,
      request_body_prepared: true,
      ready_for_send: true,
      usage: readUsage(payload?.usage),
      safety_flags: {
        admin_only: true,
        live_provider_call_allowed: true,
        provider_called: true,
        network_call_performed: true,
        approval_required: false,
        high_sensitivity_blocked: false,
        raw_secret_exposed: false,
        raw_prompt_returned: false,
        raw_response_returned: false,
        queue_written: false,
        approval_executed: false,
        external_action_executed: false,
      },
    };
  } catch (error) {
    return {
      ...resultBase(input),
      status: "error",
      output_text: "OpenRouter request failed before Phantom AI received a model response.",
      blocked_reason: null,
      error_message: redactSensitiveText(error instanceof Error ? error.message : "Unknown OpenRouter transport error."),
      live_call_allowed: true,
      execution_disabled: false,
      provider_called: true,
      network_call_performed: true,
      request_body_prepared: true,
      ready_for_send: true,
      usage: { prompt_tokens: null, completion_tokens: null, total_tokens: null },
      safety_flags: {
        admin_only: true,
        live_provider_call_allowed: true,
        provider_called: true,
        network_call_performed: true,
        approval_required: input.approvalRequired,
        high_sensitivity_blocked: false,
        raw_secret_exposed: false,
        raw_prompt_returned: false,
        raw_response_returned: false,
        queue_written: false,
        approval_executed: false,
        external_action_executed: false,
      },
    };
  }
}
