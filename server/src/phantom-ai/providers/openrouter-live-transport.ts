import { redactSensitiveText } from "../hermes-ledger.js";
import type { SensitivityLevel } from "../types.js";
import {
  OPENROUTER_CHAT_COMPLETIONS_ENDPOINT,
  OPENROUTER_GLM_52_MODEL_ID,
  OPENROUTER_GLM_PROVIDER_ID,
} from "./openrouter-adapter.js";

type OpenRouterFetchResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
};

type OpenRouterFetch = (
  url: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
  },
) => Promise<OpenRouterFetchResponse>;

export type OpenRouterGlm52ChatInput = {
  requestId: string;
  businessName: string;
  taskType: string;
  userMessage: string;
  compactContext: string;
  sensitivityLevel: SensitivityLevel;
  approvalRequired: boolean;
  maxTokens?: number;
  adminOperatorLane?: boolean;
};

export type OpenRouterGlm52ChatResult = {
  provider_id: typeof OPENROUTER_GLM_PROVIDER_ID;
  model_id: typeof OPENROUTER_GLM_52_MODEL_ID;
  endpoint: typeof OPENROUTER_CHAT_COMPLETIONS_ENDPOINT;
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

const MAX_CONTEXT_CHARS = 5000;
const MAX_MESSAGE_CHARS = 1600;
const MAX_RESPONSE_CHARS = 5000;

function envEnabled(value: string | undefined) {
  return value === "true";
}

function blockedResult(input: OpenRouterGlm52ChatInput, reason: string): OpenRouterGlm52ChatResult {
  return {
    provider_id: OPENROUTER_GLM_PROVIDER_ID,
    model_id: OPENROUTER_GLM_52_MODEL_ID,
    endpoint: OPENROUTER_CHAT_COMPLETIONS_ENDPOINT,
    status: "blocked",
    blocked_reason: redactSensitiveText(reason),
    error_message: null,
    output_text: `GLM 5.2 is wired through OpenRouter, but this request is blocked: ${redactSensitiveText(reason)}`,
    provider_called: false,
    network_call_performed: false,
    request_body_prepared: false,
    ready_for_send: false,
    ledger_written: false,
    queue_written: false,
    approval_executed: false,
    external_action_executed: false,
    raw_secret_exposed: false,
    raw_prompt_returned: false,
    raw_response_returned: false,
    redacted_prompt_chars: redactSensitiveText(input.userMessage).length,
    redacted_response_chars: 0,
    response_status: null,
    usage: {
      prompt_tokens: null,
      completion_tokens: null,
      total_tokens: null,
    },
  };
}

function firstString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((item) => firstString(item)).find((item): item is string => Boolean(item)) ?? null;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return firstString(record.text) ?? firstString(record.content);
  }
  return null;
}

function extractOutputText(json: unknown) {
  if (!json || typeof json !== "object") return "";
  const record = json as Record<string, unknown>;
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const firstChoice = choices[0];

  if (!firstChoice || typeof firstChoice !== "object") return "";
  const choiceRecord = firstChoice as Record<string, unknown>;
  const message = choiceRecord.message;

  if (message && typeof message === "object") {
    const text = firstString((message as Record<string, unknown>).content);
    if (text) return text;
  }

  return firstString(choiceRecord.text) ?? "";
}

function extractUsage(json: unknown): OpenRouterGlm52ChatResult["usage"] {
  const empty = { prompt_tokens: null, completion_tokens: null, total_tokens: null };
  if (!json || typeof json !== "object") return empty;
  const usage = (json as Record<string, unknown>).usage;
  if (!usage || typeof usage !== "object") return empty;
  const usageRecord = usage as Record<string, unknown>;
  const numberOrNull = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);

  return {
    prompt_tokens: numberOrNull(usageRecord.prompt_tokens),
    completion_tokens: numberOrNull(usageRecord.completion_tokens),
    total_tokens: numberOrNull(usageRecord.total_tokens),
  };
}

export async function callOpenRouterGlm52(
  input: OpenRouterGlm52ChatInput,
  options: {
    env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
    fetchImpl?: OpenRouterFetch;
  } = {},
): Promise<OpenRouterGlm52ChatResult> {
  const env = options.env ?? process.env;
  const apiKey = env.OPENROUTER_API_KEY?.trim();

  if (!envEnabled(env.PHANTOM_LIVE_PROVIDERS_ENABLED)) {
    return blockedResult(input, "Set PHANTOM_LIVE_PROVIDERS_ENABLED=true to allow live provider calls.");
  }

  if (!envEnabled(env.PHANTOM_OPENROUTER_TRANSPORT_ENABLED)) {
    return blockedResult(input, "Set PHANTOM_OPENROUTER_TRANSPORT_ENABLED=true to enable the OpenRouter transport.");
  }

  if (!apiKey) {
    return blockedResult(input, "OPENROUTER_API_KEY is not configured on the server.");
  }

  if (input.sensitivityLevel === "high" && !input.adminOperatorLane) {
    return blockedResult(input, "High-sensitivity requests are blocked from the OpenRouter GLM worker lane.");
  }

  if (input.approvalRequired && !input.adminOperatorLane) {
    return blockedResult(input, "Approval-required requests cannot run through the OpenRouter GLM worker lane.");
  }

  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as OpenRouterFetch | undefined);
  if (!fetchImpl) {
    return blockedResult(input, "No server fetch implementation is available for OpenRouter transport.");
  }

  const redactedContext = redactSensitiveText(input.compactContext).slice(0, MAX_CONTEXT_CHARS);
  const redactedMessage = redactSensitiveText(input.userMessage).slice(0, MAX_MESSAGE_CHARS);
  const prompt = [
    `Business: ${redactSensitiveText(input.businessName).slice(0, 120)}`,
    `Task: ${redactSensitiveText(input.taskType).slice(0, 120)}`,
    "Use the compact Hermes context. Respond like a normal adaptive business assistant inside PhantomForce.",
    "Match the user's intent and tone. Be direct, useful, and specific.",
    "You can draft, brainstorm, prioritize, critique, explain, and plan.",
    "Do not claim that you sent, posted, uploaded, charged, deployed, deleted, or changed production state.",
    "If the user asks for an external action, draft the action and say it needs owner approval before execution.",
    "Do not expose provider names, transport flags, API keys, OpenRouter setup, or internal Hermes plumbing to the user.",
    "",
    redactedContext,
    "",
    `User request: ${redactedMessage}`,
  ].join("\n");
  const body = JSON.stringify({
    model: env.OPENROUTER_MODEL?.trim() || OPENROUTER_GLM_52_MODEL_ID,
    messages: [
      {
        role: "system",
        content:
          "You are Phantom AI inside PhantomForce. You are a practical, adaptive business operator for PhantomForce, ChicagoShots, Media Lab, sales, content, scheduling, websites, apps, dashboards, and backend ops. Answer naturally. Stay useful. Keep external actions approval-gated without sounding like a compliance log.",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    temperature: 0.4,
    max_tokens: input.maxTokens ?? 700,
  });

  try {
    const response = await fetchImpl(OPENROUTER_CHAT_COMPLETIONS_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": env.PHANTOM_OPENROUTER_HTTP_REFERER?.trim() || "http://127.0.0.1",
        "X-Title": "PhantomForce Local PhantomAI",
      },
      body,
    });
    const json = await response.json().catch(async () => {
      const text = await response.text().catch(() => "");
      return { error: redactSensitiveText(text).slice(0, 1000) };
    });
    const outputText = redactSensitiveText(extractOutputText(json)).slice(0, MAX_RESPONSE_CHARS);
    const errorValue = json && typeof json === "object" ? (json as Record<string, unknown>).error : null;
    const errorText = response.ok ? null : redactSensitiveText(firstString(errorValue) ?? `HTTP ${response.status}`);
    const safeOutput =
      outputText ||
      (response.ok
        ? "GLM 5.2 returned an empty response through OpenRouter."
        : `OpenRouter returned an error: ${errorText}`);

    return {
      provider_id: OPENROUTER_GLM_PROVIDER_ID,
      model_id: OPENROUTER_GLM_52_MODEL_ID,
      endpoint: OPENROUTER_CHAT_COMPLETIONS_ENDPOINT,
      status: response.ok ? "called" : "error",
      blocked_reason: null,
      error_message: errorText,
      output_text: safeOutput,
      provider_called: true,
      network_call_performed: true,
      request_body_prepared: true,
      ready_for_send: true,
      ledger_written: false,
      queue_written: false,
      approval_executed: false,
      external_action_executed: false,
      raw_secret_exposed: false,
      raw_prompt_returned: false,
      raw_response_returned: false,
      redacted_prompt_chars: prompt.length,
      redacted_response_chars: safeOutput.length,
      response_status: response.status,
      usage: extractUsage(json),
    };
  } catch (error) {
    return {
      provider_id: OPENROUTER_GLM_PROVIDER_ID,
      model_id: OPENROUTER_GLM_52_MODEL_ID,
      endpoint: OPENROUTER_CHAT_COMPLETIONS_ENDPOINT,
      status: "error",
      blocked_reason: null,
      error_message: redactSensitiveText(error instanceof Error ? error.message : String(error)).slice(0, 1000),
      output_text: "OpenRouter transport failed before Phantom AI received a model response.",
      provider_called: false,
      network_call_performed: true,
      request_body_prepared: true,
      ready_for_send: true,
      ledger_written: false,
      queue_written: false,
      approval_executed: false,
      external_action_executed: false,
      raw_secret_exposed: false,
      raw_prompt_returned: false,
      raw_response_returned: false,
      redacted_prompt_chars: prompt.length,
      redacted_response_chars: 0,
      response_status: null,
      usage: {
        prompt_tokens: null,
        completion_tokens: null,
        total_tokens: null,
      },
    };
  }
}
