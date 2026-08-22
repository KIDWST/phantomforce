import { openRouterFetch } from "./openrouter-http.js";

export const OPENROUTER_KEY_ENDPOINT = "https://openrouter.ai/api/v1/key";
export const OPENROUTER_KEY_VALIDATION_TIMEOUT_MS = 20_000;

type OpenRouterKeyFetch = (
  url: string,
  init: { headers: Record<string, string>; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number }>;

export type OpenRouterCredentialValidation = {
  valid: boolean;
  statusCode: number;
  code?: string;
  error?: string;
};

export async function validateOpenRouterCredential(
  credential: string | null,
  options: { fetchImpl?: OpenRouterKeyFetch; timeoutMs?: number } = {},
): Promise<OpenRouterCredentialValidation> {
  if (!credential?.trim()) {
    return { valid: false, statusCode: 400, code: "api_key_missing", error: "OpenRouter API key is missing." };
  }

  const fetchImpl = options.fetchImpl ?? (openRouterFetch as unknown as OpenRouterKeyFetch);

  const timeoutMs = Number.isFinite(options.timeoutMs)
    ? Math.max(1_000, Number(options.timeoutMs))
    : OPENROUTER_KEY_VALIDATION_TIMEOUT_MS;
  try {
    const response = await fetchImpl(OPENROUTER_KEY_ENDPOINT, {
      headers: { Authorization: `Bearer ${credential.trim()}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status === 401) {
      return {
        valid: false,
        statusCode: 401,
        code: "api_key_invalid",
        error: "OpenRouter API key invalid or expired (HTTP 401). Replace it in PhantomPlay Settings → Connections.",
      };
    }
    if (!response.ok) {
      return {
        valid: false,
        statusCode: 502,
        code: "api_key_validation_unavailable",
        error: `OpenRouter key validation is temporarily unavailable (HTTP ${response.status}).`,
      };
    }
    return { valid: true, statusCode: 200 };
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return {
      valid: false,
      statusCode: 502,
      code: "api_key_validation_unavailable",
      error: timedOut
        ? "OpenRouter key validation timed out. Check your connection and try again."
        : "OpenRouter key validation could not reach OpenRouter. Check your connection and try again.",
    };
  }
}
