export type ProviderPlatformStatus = "operational" | "degraded" | "outage" | "unknown";
export type ProviderConnectionStatus = "authorized" | "authorization_expiring" | "expired" | "permission_missing" | "rate_limited" | "reconnecting" | "failed" | "unavailable";
export type ProviderErrorCode = "AUTH_EXPIRED" | "RATE_LIMITED" | "INVALID_MEDIA" | "PROCESSING_FAILED" | "PERMISSION_DENIED" | "TEMPORARY_FAILURE" | "PROVIDER_OUTAGE" | "UNKNOWN";

export type ProviderHealth = {
  platformStatus: ProviderPlatformStatus;
  checkedAt: string;
  detail: string;
};

export type ProviderPublishInput = {
  idempotencyKey: string;
  correlationId: string;
  publicationId: string;
  revisionHash: string;
  content: string;
  media: Array<{ id: string; name: string; checksum: string }>;
  failureMode?: string;
};

export type ProviderPublishResult = {
  providerPublicationId: string;
  publicUrl: string;
  acceptedAt: string;
  rawStatus: string;
};

export type ProviderAnalyticsResult = {
  providerPublicationId: string;
  capturedAt: string;
  impressions: number;
  engagements: number;
  clicks: number;
};

export class ProviderAdapterError extends Error {
  constructor(
    public readonly code: ProviderErrorCode,
    message: string,
    public readonly retryable: boolean,
    public readonly remediation: string,
    public readonly httpStatus = 502,
  ) {
    super(message);
    this.name = "ProviderAdapterError";
  }
}

export interface ProviderAdapter {
  readonly id: string;
  readonly environment: "sandbox" | "production";
  healthCheck(): Promise<ProviderHealth>;
  refreshAuthorization(correlationId: string, failureMode?: string): Promise<{ connectionStatus: "authorized"; checkedAt: string; detail: string }>;
  publish(input: ProviderPublishInput): Promise<ProviderPublishResult>;
  fetchAnalytics(providerPublicationId: string, correlationId: string): Promise<ProviderAnalyticsResult>;
}

function cleanDetail(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.replace(/\s+/gu, " ").trim().slice(0, 300) : fallback;
}

function normalizedError(status: number, payload: Record<string, unknown> | null): ProviderAdapterError {
  const message = cleanDetail(payload?.message || payload?.error, `Provider request failed (${status}).`);
  if (payload?.error === "processing_failed") return new ProviderAdapterError("PROCESSING_FAILED", message, false, "Inspect the provider processing result, correct the content, approve a new revision, and publish again.", status);
  if (status === 401) return new ProviderAdapterError("AUTH_EXPIRED", message, false, "Reconnect the organization provider connection.", status);
  if (status === 403) return new ProviderAdapterError("PERMISSION_DENIED", message, false, "Restore the required provider publishing permission.", status);
  if (status === 400 || status === 422) return new ProviderAdapterError("INVALID_MEDIA", message, false, "Correct the rejected media or content revision, approve it, and publish again.", status);
  if (status === 429) return new ProviderAdapterError("RATE_LIMITED", message, true, "Wait for the provider retry window, then retry the same job.", status);
  if (status >= 500) return new ProviderAdapterError("PROVIDER_OUTAGE", message, true, "Retry after provider recovery; no duplicate publication will be created.", status);
  return new ProviderAdapterError("UNKNOWN", message, false, "Inspect the provider response and connection permissions.", status);
}

async function jsonRequest(url: string, init: RequestInit, timeoutMs = 6_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok) throw normalizedError(response.status, payload);
    return payload || {};
  } catch (error) {
    if (error instanceof ProviderAdapterError) throw error;
    if ((error as Error)?.name === "AbortError") {
      throw new ProviderAdapterError("TEMPORARY_FAILURE", "Provider request timed out.", true, "Retry the leased job; the idempotency key prevents a duplicate post.", 504);
    }
    throw new ProviderAdapterError("TEMPORARY_FAILURE", cleanDetail((error as Error)?.message, "Provider is unavailable."), true, "Verify provider health and retry the leased job.", 503);
  } finally {
    clearTimeout(timer);
  }
}

export class HttpSandboxProviderAdapter implements ProviderAdapter {
  readonly id = "phantomforce-http-sandbox";
  readonly environment = "sandbox" as const;

  constructor(private readonly origin: string, private readonly requestTimeoutMs = Math.max(100, Number(process.env.PHANTOMFORCE_PRODUCTION_CORE_PROVIDER_TIMEOUT_MS || 6_000))) {}

  async healthCheck(): Promise<ProviderHealth> {
    try {
      const payload = await jsonRequest(`${this.origin}/health`, { method: "GET" }, 3_000);
      return {
        platformStatus: payload.status === "operational" ? "operational" : payload.status === "degraded" ? "degraded" : "unknown",
        checkedAt: new Date().toISOString(),
        detail: cleanDetail(payload.detail, "Sandbox provider responded."),
      };
    } catch (error) {
      return {
        platformStatus: error instanceof ProviderAdapterError && error.code === "PROVIDER_OUTAGE" ? "outage" : "unknown",
        checkedAt: new Date().toISOString(),
        detail: cleanDetail((error as Error)?.message, "Sandbox provider health is unavailable."),
      };
    }
  }

  async refreshAuthorization(correlationId: string, failureMode = "") {
    const payload = await jsonRequest(`${this.origin}/authorization/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Correlation-ID": correlationId },
      body: JSON.stringify({ failureMode }),
    }, this.requestTimeoutMs);
    return { connectionStatus: "authorized" as const, checkedAt: cleanDetail(payload.checkedAt, new Date().toISOString()), detail: cleanDetail(payload.detail, "Provider authorization refreshed.") };
  }

  async publish(input: ProviderPublishInput): Promise<ProviderPublishResult> {
    const payload = await jsonRequest(`${this.origin}/publications`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": input.idempotencyKey, "X-Correlation-ID": input.correlationId },
      body: JSON.stringify(input),
    }, this.requestTimeoutMs);
    const providerPublicationId = cleanDetail(payload.providerPublicationId, "");
    if (!providerPublicationId) throw new ProviderAdapterError("UNKNOWN", "Provider accepted the request without a publication ID.", false, "Inspect the provider response contract.");
    return {
      providerPublicationId,
      publicUrl: cleanDetail(payload.publicUrl, ""),
      acceptedAt: cleanDetail(payload.acceptedAt, new Date().toISOString()),
      rawStatus: cleanDetail(payload.status, "accepted"),
    };
  }

  async fetchAnalytics(providerPublicationId: string, correlationId: string): Promise<ProviderAnalyticsResult> {
    const payload = await jsonRequest(`${this.origin}/publications/${encodeURIComponent(providerPublicationId)}/analytics`, {
      method: "GET",
      headers: { "X-Correlation-ID": correlationId },
    }, this.requestTimeoutMs);
    return {
      providerPublicationId,
      capturedAt: cleanDetail(payload.capturedAt, new Date().toISOString()),
      impressions: Math.max(0, Number(payload.impressions || 0)),
      engagements: Math.max(0, Number(payload.engagements || 0)),
      clicks: Math.max(0, Number(payload.clicks || 0)),
    };
  }
}

export function productionProviderAdapter() {
  const origin = String(process.env.PHANTOMFORCE_PRODUCTION_CORE_PROVIDER_URL || "").replace(/\/+$/u, "");
  if (!origin) return null;
  return new HttpSandboxProviderAdapter(origin);
}
