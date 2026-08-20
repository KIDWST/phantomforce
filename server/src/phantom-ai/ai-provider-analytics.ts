import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { aiRuntimeRoot, type AiRuntimeProviderId } from "./ai-runtime-config.js";
import {
  AI_CREDENTIAL_PROVIDER_IDS,
  getAiProviderCredential,
  getAiProviderCredentialStatus,
  type AiCredentialProviderId,
} from "./ai-provider-credentials.js";

type ProviderUsage = {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
};

type UsageEvent = {
  version: 1;
  tenant_id: string;
  request_id: string;
  surface: string;
  provider_id: AiRuntimeProviderId;
  model_id: string;
  status: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  created_at: string;
};

export type AiProviderAccountSnapshot = {
  provider_id: AiCredentialProviderId;
  display_name: string;
  status: "up" | "down";
  detail: string;
  latency_ms: number;
  last_checked_at: string;
  account: {
    source: "provider";
    currency: string | null;
    spent_amount: number | null;
    limit_amount: number | null;
    remaining_amount: number | null;
    limit_reset_at: string | null;
    is_free_tier: boolean | null;
    balances: Array<{
      currency: string;
      total: number;
      granted: number;
      topped_up: number;
    }>;
  };
};

type AnalyticsOptions = {
  root?: string;
  fetchImpl?: typeof fetch;
  force?: boolean;
  credentialRoot?: string;
  credentialEnv?: NodeJS.ProcessEnv | Record<string, string | undefined>;
};

const accountCache = new Map<string, { expiresAt: number; snapshots: AiProviderAccountSnapshot[] }>();
const appendLocks = new Map<string, Promise<unknown>>();
const ACCOUNT_CACHE_MS = 60_000;
const ACCOUNT_TIMEOUT_MS = 8_000;

function safeSegment(value: unknown, fallback = "unknown", maxLength = 120) {
  const normalized = String(value || "").trim().replace(/[^a-zA-Z0-9_.:@+\/-]+/g, "-").replace(/^-+|-+$/g, "");
  return (normalized || fallback).slice(0, maxLength);
}

function safeTenantId(value: unknown) {
  return String(value || "").trim().replace(/[^a-zA-Z0-9_.:-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "unknown";
}

function finiteNonNegative(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function tokenValue(value: unknown) {
  const number = finiteNonNegative(value);
  return number === null ? null : Math.trunc(number);
}

function usageRoot(root?: string) {
  return resolve(root || aiRuntimeRoot(), "usage");
}

function usagePath(tenantId: string, root?: string) {
  return resolve(usageRoot(root), `${safeTenantId(tenantId)}.ndjson`);
}

async function withAppendLock<T>(tenantId: string, operation: () => Promise<T>) {
  const key = safeTenantId(tenantId);
  const previous = appendLocks.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  appendLocks.set(key, current);
  try {
    return await current;
  } finally {
    if (appendLocks.get(key) === current) appendLocks.delete(key);
  }
}

export async function recordAiProviderUsage(options: {
  tenantId: string;
  requestId: string;
  surface?: string;
  providerId: AiRuntimeProviderId;
  modelId?: string | null;
  status: string;
  usage?: ProviderUsage | null;
  root?: string;
}) {
  const event: UsageEvent = {
    version: 1,
    tenant_id: safeTenantId(options.tenantId),
    request_id: safeSegment(options.requestId, "request", 120),
    surface: safeSegment(options.surface, "unknown", 80),
    provider_id: options.providerId,
    model_id: safeSegment(options.modelId, options.providerId, 120),
    status: safeSegment(options.status, "unknown", 32),
    prompt_tokens: tokenValue(options.usage?.prompt_tokens),
    completion_tokens: tokenValue(options.usage?.completion_tokens),
    total_tokens: tokenValue(options.usage?.total_tokens),
    created_at: new Date().toISOString(),
  };
  await withAppendLock(options.tenantId, async () => {
    const path = usagePath(options.tenantId, options.root);
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
  });
  return event;
}

async function readUsageEvents(tenantId: string, root?: string) {
  try {
    const body = await readFile(usagePath(tenantId, root), "utf8");
    return body.split(/\r?\n/u).filter(Boolean).flatMap((line) => {
      try {
        const event = JSON.parse(line) as UsageEvent;
        return event?.version === 1 && event.tenant_id === safeTenantId(tenantId) ? [event] : [];
      } catch {
        return [];
      }
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function emptyUsageSummary() {
  return {
    attempts: 0,
    successful_requests: 0,
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  };
}

export async function getAiProviderUsageSummary(tenantId: string, rangeDays: number, root?: string) {
  const days = [7, 30, 90].includes(rangeDays) ? rangeDays : 30;
  const startAt = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const events = (await readUsageEvents(tenantId, root)).filter((event) => {
    const timestamp = Date.parse(event.created_at);
    return Number.isFinite(timestamp) && timestamp >= startAt.getTime();
  });
  const totals = emptyUsageSummary();
  const byProvider = new Map<AiRuntimeProviderId, ReturnType<typeof emptyUsageSummary>>();
  for (const event of events) {
    const provider = byProvider.get(event.provider_id) ?? emptyUsageSummary();
    for (const summary of [totals, provider]) {
      summary.attempts += 1;
      if (event.status === "called") summary.successful_requests += 1;
      summary.prompt_tokens += event.prompt_tokens ?? 0;
      summary.completion_tokens += event.completion_tokens ?? 0;
      summary.total_tokens += event.total_tokens ?? 0;
    }
    byProvider.set(event.provider_id, provider);
  }
  return {
    range: { days, start_at: startAt.toISOString(), end_at: new Date().toISOString() },
    totals,
    providers: [...byProvider.entries()].map(([provider_id, usage]) => ({ provider_id, ...usage })),
  };
}

function emptyAccount(): AiProviderAccountSnapshot["account"] {
  return {
    source: "provider" as const,
    currency: null,
    spent_amount: null,
    limit_amount: null,
    remaining_amount: null,
    limit_reset_at: null,
    is_free_tier: null,
    balances: [],
  };
}

function safeProviderError(error: unknown) {
  if (error instanceof Error && error.name === "AbortError") return "Account check timed out.";
  return "Provider account check failed.";
}

async function fetchJson(url: string, credential: string, fetchImpl: typeof fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ACCOUNT_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${credential}`, Accept: "application/json" },
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(`Provider returned HTTP ${response.status}.`), { status: response.status });
    return { payload, latencyMs: Date.now() - startedAt };
  } finally {
    clearTimeout(timer);
  }
}

async function probeDeepSeek(credential: string, fetchImpl: typeof fetch): Promise<AiProviderAccountSnapshot> {
  const checkedAt = new Date().toISOString();
  const startedAt = Date.now();
  try {
    const { payload, latencyMs } = await fetchJson("https://api.deepseek.com/user/balance", credential, fetchImpl);
    const balances = Array.isArray(payload?.balance_infos) ? payload.balance_infos.flatMap((balance: any) => {
      const currency = safeSegment(balance?.currency, "", 12).toUpperCase();
      const total = finiteNonNegative(balance?.total_balance);
      const granted = finiteNonNegative(balance?.granted_balance);
      const toppedUp = finiteNonNegative(balance?.topped_up_balance);
      return currency && total !== null ? [{ currency, total, granted: granted ?? 0, topped_up: toppedUp ?? 0 }] : [];
    }) : [];
    const available = payload?.is_available !== false;
    return {
      provider_id: "deepseek_api",
      display_name: "DeepSeek",
      status: available ? "up" : "down",
      detail: available ? "Credential verified by DeepSeek." : "DeepSeek reports that this account cannot make requests.",
      latency_ms: latencyMs,
      last_checked_at: checkedAt,
      account: { ...emptyAccount(), balances },
    };
  } catch (error) {
    return {
      provider_id: "deepseek_api",
      display_name: "DeepSeek",
      status: "down",
      detail: safeProviderError(error),
      latency_ms: Date.now() - startedAt,
      last_checked_at: checkedAt,
      account: emptyAccount(),
    };
  }
}

async function probeOpenRouter(credential: string, fetchImpl: typeof fetch): Promise<AiProviderAccountSnapshot> {
  const checkedAt = new Date().toISOString();
  const startedAt = Date.now();
  try {
    const { payload, latencyMs } = await fetchJson("https://openrouter.ai/api/v1/key", credential, fetchImpl);
    const data = payload?.data && typeof payload.data === "object" ? payload.data : {};
    const spent = finiteNonNegative(data.usage);
    const limit = finiteNonNegative(data.limit);
    const reportedRemaining = finiteNonNegative(data.limit_remaining);
    const remaining = reportedRemaining ?? (limit !== null && spent !== null ? Math.max(0, limit - spent) : null);
    return {
      provider_id: "openrouter_glm",
      display_name: "OpenRouter",
      status: "up",
      detail: "Credential verified by OpenRouter.",
      latency_ms: latencyMs,
      last_checked_at: checkedAt,
      account: {
        ...emptyAccount(),
        currency: "USD",
        spent_amount: spent,
        limit_amount: limit,
        remaining_amount: remaining,
        limit_reset_at: typeof data.limit_reset === "string" ? data.limit_reset : null,
        is_free_tier: typeof data.is_free_tier === "boolean" ? data.is_free_tier : null,
      },
    };
  } catch (error) {
    return {
      provider_id: "openrouter_glm",
      display_name: "OpenRouter",
      status: "down",
      detail: safeProviderError(error),
      latency_ms: Date.now() - startedAt,
      last_checked_at: checkedAt,
      account: emptyAccount(),
    };
  }
}

export async function getConfiguredAiProviderAccountSnapshots(tenantId: string, options: AnalyticsOptions = {}) {
  const cacheKey = `${safeTenantId(tenantId)}:${options.credentialRoot || "default"}`;
  const cached = accountCache.get(cacheKey);
  if (!options.force && cached && cached.expiresAt > Date.now()) return cached.snapshots.map((item) => structuredClone(item));
  const credentialOptions = { root: options.credentialRoot, env: options.credentialEnv };
  const statuses = await getAiProviderCredentialStatus(tenantId, credentialOptions);
  const fetchImpl = options.fetchImpl ?? fetch;
  const snapshots = (await Promise.all(AI_CREDENTIAL_PROVIDER_IDS.map(async (providerId) => {
    if (!statuses[providerId]?.configured) return null;
    const credential = await getAiProviderCredential(tenantId, providerId, credentialOptions);
    if (!credential) return null;
    return providerId === "deepseek_api" ? probeDeepSeek(credential, fetchImpl) : probeOpenRouter(credential, fetchImpl);
  }))).filter((item): item is AiProviderAccountSnapshot => Boolean(item));
  accountCache.set(cacheKey, { expiresAt: Date.now() + ACCOUNT_CACHE_MS, snapshots });
  return snapshots.map((item) => structuredClone(item));
}

export async function getAiProviderAnalytics(options: {
  tenantId: string;
  rangeDays?: number;
} & AnalyticsOptions) {
  const [usage, accounts] = await Promise.all([
    getAiProviderUsageSummary(options.tenantId, options.rangeDays ?? 30, options.root),
    getConfiguredAiProviderAccountSnapshots(options.tenantId, options),
  ]);
  return {
    generated_at: new Date().toISOString(),
    usage,
    accounts,
    accounting_truth: {
      token_counts: "measured_from_provider_responses",
      money: "provider_reported_only",
      estimates_used: false,
      prompts_stored: false,
      credentials_returned: false,
    },
  };
}
