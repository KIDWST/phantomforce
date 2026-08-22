import { openRouterFetch } from "./openrouter-http.js";

export const OPENROUTER_MODELS_ENDPOINT = "https://openrouter.ai/api/v1/models";
export const OPENROUTER_MODELS_TIMEOUT_MS = 20_000;

export type OpenRouterModelOption = {
  id: string;
  name: string;
  context_length: number | null;
  pricing: {
    prompt: string | null;
    completion: string | null;
  };
};

type OpenRouterModelsFetch = (
  url: string,
  init: { headers: Record<string, string>; signal?: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

function cleanText(value: unknown, maxLength = 240) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanPrice(value: unknown) {
  const price = cleanText(value, 48);
  return price && /^\d+(?:\.\d+)?(?:e-?\d+)?$/iu.test(price) ? price : null;
}

export function parseOpenRouterModels(value: unknown): OpenRouterModelOption[] {
  if (!value || typeof value !== "object") return [];
  const data = (value as Record<string, unknown>).data;
  if (!Array.isArray(data)) return [];
  const unique = new Map<string, OpenRouterModelOption>();
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const id = cleanText(record.id, 200);
    if (!id || !/^[a-zA-Z0-9._:/-]+$/u.test(id)) continue;
    if (unique.has(id)) continue;
    const pricing = record.pricing && typeof record.pricing === "object"
      ? record.pricing as Record<string, unknown>
      : {};
    const rawContext = Number(record.context_length);
    unique.set(id, {
      id,
      name: cleanText(record.name, 200) || id,
      context_length: Number.isFinite(rawContext) && rawContext > 0 ? Math.round(rawContext) : null,
      pricing: {
        prompt: cleanPrice(pricing.prompt),
        completion: cleanPrice(pricing.completion),
      },
    });
  }
  return [...unique.values()].slice(0, 500);
}

export async function fetchOpenRouterModels(options: {
  credential?: string | null;
  fetchImpl?: OpenRouterModelsFetch;
  timeoutMs?: number;
} = {}) {
  const fetchImpl = options.fetchImpl ?? (openRouterFetch as unknown as OpenRouterModelsFetch);
  const headers: Record<string, string> = {};
  const credential = options.credential?.trim();
  if (credential) headers.Authorization = `Bearer ${credential}`;
  const controller = new AbortController();
  const timeoutMs = Number.isFinite(options.timeoutMs)
    ? Math.max(1000, Number(options.timeoutMs))
    : OPENROUTER_MODELS_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(OPENROUTER_MODELS_ENDPOINT, { headers, signal: controller.signal });
    if (!response.ok) throw new Error(`OpenRouter models returned HTTP ${response.status}.`);
    return parseOpenRouterModels(await response.json());
  } finally {
    clearTimeout(timer);
  }
}
