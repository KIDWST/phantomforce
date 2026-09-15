import { createHmac, timingSafeEqual } from "node:crypto";

export const SOCIAL_CHANNELS = ["instagram", "facebook", "linkedin", "tiktok", "youtube", "x", "pinterest"] as const;
export type SocialChannel = typeof SOCIAL_CHANNELS[number];

export type SocialPublishRequest = {
  tenantId: string;
  publicationId: string;
  idempotencyKey: string;
  correlationId: string;
  channels: string[];
  caption: string;
  sourceAssetId: string | null;
  thumbnailAssetId: string | null;
  postType: string;
  scheduledFor: string | null;
  timezone: string;
};

export type SocialSubmissionReceipt = {
  channel: SocialChannel;
  accepted: boolean;
  provider: string;
  submissionId: string | null;
  submittedAt: string;
  errorCode: string | null;
  errorMessage: string | null;
};

export type SocialProviderEvent = {
  eventId: string;
  tenantId: string;
  publicationId: string;
  channel: SocialChannel;
  eventType: "published" | "failed";
  occurredAt: string;
  sequence: number;
  provider: string;
  submissionId: string;
  platformPostId: string | null;
  publicUrl: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

function text(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function executorUrl() {
  const value = text(process.env.PHANTOMFORCE_SOCIAL_EXECUTOR_URL, 2_000).replace(/\/$/, "");
  if (!value) return "";
  if (/^https:\/\//i.test(value) || /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/i.test(value)) return value;
  return "";
}

function executorSecret() {
  return text(process.env.PHANTOMFORCE_SOCIAL_EXECUTOR_SECRET, 4_000);
}

function webhookSecret() {
  return text(process.env.PHANTOMFORCE_SOCIAL_WEBHOOK_SECRET || process.env.PHANTOMFORCE_SOCIAL_EXECUTOR_SECRET, 4_000);
}

export function getSocialPublishingConnectorStatus() {
  const urlReady = Boolean(executorUrl());
  const executorSecretReady = executorSecret().length >= 24;
  const webhookReady = webhookSecret().length >= 24;
  return {
    providerContract: "phantomforce_social_executor_v1",
    supportedChannels: [...SOCIAL_CHANNELS],
    publishReady: urlReady && executorSecretReady,
    trackingReady: webhookReady,
    state: urlReady && executorSecretReady && webhookReady ? "ready" as const : "configuration_required" as const,
    reason: !urlReady
      ? "PHANTOMFORCE_SOCIAL_EXECUTOR_URL is not configured with HTTPS or loopback."
      : !executorSecretReady
        ? "PHANTOMFORCE_SOCIAL_EXECUTOR_SECRET must be configured with at least 24 characters."
        : !webhookReady
          ? "PHANTOMFORCE_SOCIAL_WEBHOOK_SECRET must be configured with at least 24 characters."
          : null,
    approvalRequired: true,
    platformReceiptRequired: true,
    secretsExposed: false,
  };
}

function normalizedChannels(value: unknown): SocialChannel[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => text(item, 80).toLowerCase()))]
    .filter((item): item is SocialChannel => SOCIAL_CHANNELS.includes(item as SocialChannel));
}

function captionForChannel(caption: string, channel: SocialChannel) {
  const clean = caption.trim().slice(0, 8_000);
  if (channel === "x" && clean.length > 280) return `${clean.slice(0, 277).trim()}...`;
  return clean;
}

export async function submitSocialPublication(request: SocialPublishRequest): Promise<SocialSubmissionReceipt[]> {
  const status = getSocialPublishingConnectorStatus();
  if (!status.publishReady) {
    throw Object.assign(new Error(status.reason || "Social publishing is not configured."), { code: "social_publishing_not_configured" });
  }
  const channels = normalizedChannels(request.channels);
  const caption = text(request.caption, 8_000);
  if (!channels.length || !caption) throw new Error("At least one supported channel and a caption are required.");
  const response = await fetch(`${executorUrl()}/v1/social/publish`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${executorSecret()}`,
      "content-type": "application/json",
      "x-idempotency-key": text(request.idempotencyKey, 180),
      "x-phantomforce-correlation-id": text(request.correlationId, 180),
    },
    body: JSON.stringify({
      contract: "phantomforce_social_executor_v1",
      tenant_id: text(request.tenantId, 120),
      publication_id: text(request.publicationId, 120),
      correlation_id: text(request.correlationId, 180),
      scheduled_for: request.scheduledFor,
      timezone: text(request.timezone, 100) || "UTC",
      source_asset_id: text(request.sourceAssetId, 140) || null,
      thumbnail_asset_id: text(request.thumbnailAssetId, 140) || null,
      post_type: text(request.postType, 80) || "auto",
      channel_payloads: channels.map((channel) => ({
        channel,
        caption: captionForChannel(caption, channel),
      })),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || payload.accepted !== true || !Array.isArray(payload.results)) {
    throw new Error(`Social executor rejected the request (${response.status}).`);
  }
  const now = new Date().toISOString();
  const rows = payload.results.map((raw) => {
    const row = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const channel = text(row.channel, 80).toLowerCase() as SocialChannel;
    const accepted = row.accepted === true;
    return {
      channel,
      accepted,
      provider: text(row.provider, 120) || channel,
      submissionId: accepted ? text(row.submission_id, 300) || null : null,
      submittedAt: Number.isFinite(Date.parse(text(row.submitted_at, 80))) ? text(row.submitted_at, 80) : now,
      errorCode: accepted ? null : text(row.error_code, 100) || "provider_rejected",
      errorMessage: accepted ? null : text(row.error_message, 400) || "The channel rejected the publication request.",
    };
  }).filter((row): row is SocialSubmissionReceipt => channels.includes(row.channel));
  if (rows.length !== channels.length || new Set(rows.map((row) => row.channel)).size !== channels.length) {
    throw new Error("Social executor response did not include one result for every requested channel.");
  }
  if (rows.some((row) => row.accepted && !row.submissionId)) {
    throw new Error("Social executor accepted a channel without a submission receipt.");
  }
  return rows;
}

function providerEventCanonical(event: SocialProviderEvent) {
  return [
    event.eventId,
    event.tenantId,
    event.publicationId,
    event.channel,
    event.eventType,
    event.occurredAt,
    event.sequence,
    event.provider,
    event.submissionId,
    event.platformPostId || "",
    event.publicUrl || "",
    event.errorCode || "",
    event.errorMessage || "",
  ].join("|");
}

export function parseVerifiedSocialProviderEvent(body: unknown, signatureHeader: unknown): SocialProviderEvent {
  const source = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const channel = text(source.channel, 80).toLowerCase() as SocialChannel;
  const event: SocialProviderEvent = {
    eventId: text(source.event_id, 180),
    tenantId: text(source.tenant_id, 120),
    publicationId: text(source.publication_id, 120),
    channel,
    eventType: source.event_type === "published" ? "published" : "failed",
    occurredAt: text(source.occurred_at, 80),
    sequence: Number(source.sequence),
    provider: text(source.provider, 120) || channel,
    submissionId: text(source.submission_id, 300),
    platformPostId: text(source.platform_post_id, 300) || null,
    publicUrl: text(source.public_url, 1_000) || null,
    errorCode: text(source.error_code, 100) || null,
    errorMessage: text(source.error_message, 400) || null,
  };
  if (!event.eventId || !event.tenantId || !event.publicationId || !SOCIAL_CHANNELS.includes(channel)
    || !event.submissionId || !Number.isInteger(event.sequence) || event.sequence < 0 || !Number.isFinite(Date.parse(event.occurredAt))) {
    throw Object.assign(new Error("Invalid social provider event."), { code: "invalid_social_provider_event" });
  }
  if (source.event_type !== "published" && source.event_type !== "failed") {
    throw Object.assign(new Error("Unsupported social provider event type."), { code: "unsupported_social_provider_event" });
  }
  if (event.eventType === "published" && !event.platformPostId) {
    throw Object.assign(new Error("Published social events require a platform post receipt."), { code: "platform_post_receipt_required" });
  }
  const secret = webhookSecret();
  if (secret.length < 24) throw Object.assign(new Error("Social event webhook is not configured."), { code: "social_webhook_not_configured" });
  const expected = createHmac("sha256", secret).update(providerEventCanonical(event)).digest("hex");
  const received = text(signatureHeader, 200).replace(/^sha256=/i, "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(received) || !timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"))) {
    throw Object.assign(new Error("Invalid social provider signature."), { code: "invalid_social_provider_signature" });
  }
  return event;
}

export function signSocialProviderEventForTest(event: SocialProviderEvent, secret: string) {
  return createHmac("sha256", secret).update(providerEventCanonical(event)).digest("hex");
}
