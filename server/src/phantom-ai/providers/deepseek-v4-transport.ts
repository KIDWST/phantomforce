import { redactSensitiveText } from "../hermes-ledger.js";
import type { SensitivityLevel } from "../types.js";

export const DEEPSEEK_PROVIDER_ID = "deepseek_api" as const;
export const DEEPSEEK_V4_FLASH_MODEL_ID = "deepseek-v4-flash" as const;
export const DEEPSEEK_CHAT_COMPLETIONS_ENDPOINT = "https://api.deepseek.com/chat/completions" as const;

type DeepSeekFetchResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
};

type DeepSeekFetch = (
  url: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<DeepSeekFetchResponse>;

export type DeepSeekV4ChatInput = {
  requestId: string;
  businessName: string;
  taskType: string;
  userMessage: string;
  compactContext: string;
  sensitivityLevel: SensitivityLevel;
  approvalRequired: boolean;
  executionMode?: "approval" | "auto";
  maxTokens?: number;
  adminOperatorLane?: boolean;
};

export type DeepSeekV4ChatResult = {
  provider_id: typeof DEEPSEEK_PROVIDER_ID;
  model_id: string;
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
  raw_secret_exposed: false;
  raw_prompt_returned: false;
  raw_response_returned: false;
  response_status: number | null;
  usage: {
    prompt_tokens: number | null;
    completion_tokens: number | null;
    total_tokens: number | null;
  };
};

const MAX_CONTEXT_CHARS = 48_000;
const MAX_MESSAGE_CHARS = 200_000;
const MAX_RESPONSE_CHARS = 180_000;
const DEFAULT_TIMEOUT_MS = 45_000;

function firstString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(firstString).find((item): item is string => Boolean(item)) ?? null;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return firstString(record.text) ?? firstString(record.content) ?? firstString(record.message);
  }
  return null;
}

function extractOutputText(json: unknown) {
  if (!json || typeof json !== "object") return "";
  const choices = Array.isArray((json as Record<string, unknown>).choices)
    ? (json as Record<string, unknown>).choices as unknown[]
    : [];
  const choice = choices[0];
  if (!choice || typeof choice !== "object") return "";
  const message = (choice as Record<string, unknown>).message;
  return firstString(message) ?? firstString((choice as Record<string, unknown>).text) ?? "";
}

function extractUsage(json: unknown): DeepSeekV4ChatResult["usage"] {
  const empty = { prompt_tokens: null, completion_tokens: null, total_tokens: null };
  if (!json || typeof json !== "object") return empty;
  const usage = (json as Record<string, unknown>).usage;
  if (!usage || typeof usage !== "object") return empty;
  const numberOrNull = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
  const record = usage as Record<string, unknown>;
  return {
    prompt_tokens: numberOrNull(record.prompt_tokens),
    completion_tokens: numberOrNull(record.completion_tokens),
    total_tokens: numberOrNull(record.total_tokens),
  };
}

function baseResult(modelId: string, endpoint: string) {
  return {
    provider_id: DEEPSEEK_PROVIDER_ID,
    model_id: modelId,
    endpoint,
    ledger_written: false,
    queue_written: false,
    approval_executed: false,
    external_action_executed: false,
    raw_secret_exposed: false,
    raw_prompt_returned: false,
    raw_response_returned: false,
  } as const;
}

export async function callDeepSeekV4Flash(
  input: DeepSeekV4ChatInput,
  options: {
    credential?: string | null;
    env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
    fetchImpl?: DeepSeekFetch;
    modelId?: string | null;
  } = {},
): Promise<DeepSeekV4ChatResult> {
  const env = options.env ?? process.env;
  const credential = options.credential?.trim() || env.DEEPSEEK_API_KEY?.trim() || "";
  const modelId = options.modelId?.trim() || env.DEEPSEEK_MODEL?.trim() || DEEPSEEK_V4_FLASH_MODEL_ID;
  const endpoint = `${(env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com").replace(/\/$/, "")}/chat/completions`;
  const blocked = (reason: string): DeepSeekV4ChatResult => ({
    ...baseResult(modelId, endpoint),
    status: "blocked",
    blocked_reason: redactSensitiveText(reason),
    error_message: null,
    output_text: `DeepSeek is not ready: ${redactSensitiveText(reason)}`,
    provider_called: false,
    network_call_performed: false,
    request_body_prepared: false,
    ready_for_send: false,
    response_status: null,
    usage: { prompt_tokens: null, completion_tokens: null, total_tokens: null },
  });

  if (!credential) return blocked("Add the DeepSeek API key in Settings -> AI Control Center.");
  if (input.sensitivityLevel === "high" && !input.adminOperatorLane) {
    return blocked("High-sensitivity requests stay on an approved private provider lane.");
  }
  if (input.approvalRequired && !input.adminOperatorLane) {
    return blocked("Approval-required work cannot use the unreviewed worker lane.");
  }
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as DeepSeekFetch | undefined);
  if (!fetchImpl) return blocked("No server network transport is available.");

  const compactContext = redactSensitiveText(input.compactContext).slice(0, MAX_CONTEXT_CHARS);
  const userMessage = redactSensitiveText(input.userMessage).slice(0, MAX_MESSAGE_CHARS);
  const body = JSON.stringify({
    model: modelId,
    messages: [
      {
        role: "system",
        content: [
          "You are PhantomForce's organization-wide operator brain.",
          "Translate the user's goal into a direct, useful answer or an execution-ready plan for PhantomForce.",
          "Use supplied workspace context when relevant and ignore it when the request is general.",
          "Never claim an external action completed without a PhantomForce receipt.",
          "External sends, publishing, payments, destructive changes, and production deployment remain approval gated.",
          "Do not expose provider credentials, internal routing, or hidden reasoning.",
        ].join(" "),
      },
      {
        role: "user",
        content: [
          `Business: ${redactSensitiveText(input.businessName).slice(0, 120)}`,
          `Task type: ${redactSensitiveText(input.taskType).slice(0, 120)}`,
          `Execution mode: ${input.executionMode === "auto" ? "safe internal auto" : "approval"}`,
          "",
          compactContext,
          "",
          `User request: ${userMessage}`,
        ].join("\n"),
      },
    ],
    temperature: 0.35,
    max_tokens: input.maxTokens ?? 8192,
  });

  const timeoutValue = Number(env.PHANTOM_DEEPSEEK_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(timeoutValue) ? Math.min(Math.max(timeoutValue, 3_000), 180_000) : DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" },
      body,
      signal: controller.signal,
    });
    const json = await response.json().catch(async () => ({ error: redactSensitiveText(await response.text().catch(() => "")) }));
    const output = redactSensitiveText(extractOutputText(json)).slice(0, MAX_RESPONSE_CHARS);
    const providerError = json && typeof json === "object" ? firstString((json as Record<string, unknown>).error) : null;
    const errorMessage = response.ok ? null : redactSensitiveText(providerError || `HTTP ${response.status}`).slice(0, 1000);
    return {
      ...baseResult(modelId, endpoint),
      status: response.ok && output ? "called" : "error",
      blocked_reason: null,
      error_message: errorMessage || (output ? null : "DeepSeek returned an empty response."),
      output_text: output || (errorMessage ? `DeepSeek returned an error: ${errorMessage}` : "DeepSeek returned an empty response."),
      provider_called: true,
      network_call_performed: true,
      request_body_prepared: true,
      ready_for_send: true,
      response_status: response.status,
      usage: extractUsage(json),
    };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return {
      ...baseResult(modelId, endpoint),
      status: "error",
      blocked_reason: null,
      error_message: timedOut
        ? `DeepSeek did not respond within ${timeoutMs}ms.`
        : redactSensitiveText(error instanceof Error ? error.message : String(error)).slice(0, 1000),
      output_text: "DeepSeek did not return a model response.",
      provider_called: false,
      network_call_performed: true,
      request_body_prepared: true,
      ready_for_send: true,
      response_status: null,
      usage: { prompt_tokens: null, completion_tokens: null, total_tokens: null },
    };
  } finally {
    clearTimeout(timer);
  }
}
