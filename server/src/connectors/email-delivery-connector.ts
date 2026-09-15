import { createHmac, timingSafeEqual } from "node:crypto";

export type EmailDeliveryRequest = {
  tenantId: string;
  actionId: string;
  correlationId: string;
  to: string[];
  subject: string;
  body: string;
  threadId?: string | null;
};

export type EmailDeliveryReceipt = {
  accepted: true;
  provider: "gmail" | "outlook" | "other";
  messageId: string;
  threadId: string | null;
  submittedAt: string;
};

export type EmailProviderEvent = {
  eventId: string;
  tenantId: string;
  messageId: string;
  provider: "gmail" | "outlook" | "other";
  eventType: "delivered" | "bounced" | "replied";
  occurredAt: string;
  sequence: number;
  threadId: string | null;
  replyPreview: string | null;
};

function text(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function executorUrl() {
  const value = text(process.env.PHANTOMFORCE_EMAIL_EXECUTOR_URL, 2_000).replace(/\/$/, "");
  if (!value) return "";
  if (/^https:\/\//i.test(value) || /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/i.test(value)) return value;
  return "";
}

function executorSecret() {
  return text(process.env.PHANTOMFORCE_EMAIL_EXECUTOR_SECRET, 4_000);
}

function webhookSecret() {
  return text(process.env.PHANTOMFORCE_EMAIL_WEBHOOK_SECRET || process.env.PHANTOMFORCE_EMAIL_EXECUTOR_SECRET, 4_000);
}

export function getEmailDeliveryConnectorStatus() {
  const urlReady = Boolean(executorUrl());
  const executorSecretReady = executorSecret().length >= 24;
  const webhookReady = webhookSecret().length >= 24;
  return {
    providerContract: "phantomforce_email_executor_v1",
    sendReady: urlReady && executorSecretReady,
    trackingReady: webhookReady,
    replySyncReady: webhookReady,
    state: urlReady && executorSecretReady && webhookReady ? "ready" as const : "configuration_required" as const,
    reason: !urlReady
      ? "PHANTOMFORCE_EMAIL_EXECUTOR_URL is not configured with HTTPS or loopback."
      : !executorSecretReady
        ? "PHANTOMFORCE_EMAIL_EXECUTOR_SECRET must be configured with at least 24 characters."
        : !webhookReady
          ? "PHANTOMFORCE_EMAIL_WEBHOOK_SECRET must be configured with at least 24 characters."
          : null,
    secretsExposed: false,
  };
}

function normalizedAddresses(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => text(item, 320).toLowerCase())
    .filter((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item))
    .slice(0, 50);
}

export async function submitEmailDelivery(request: EmailDeliveryRequest): Promise<EmailDeliveryReceipt> {
  const status = getEmailDeliveryConnectorStatus();
  if (!status.sendReady) {
    throw Object.assign(new Error(status.reason || "Email delivery is not configured."), { code: "email_delivery_not_configured" });
  }
  const to = normalizedAddresses(request.to);
  const subject = text(request.subject, 300);
  const body = typeof request.body === "string" ? request.body.trim().slice(0, 50_000) : "";
  if (!to.length || !subject || !body) throw new Error("A valid recipient, subject, and message body are required.");
  const response = await fetch(`${executorUrl()}/v1/email/send`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${executorSecret()}`,
      "content-type": "application/json",
      "x-idempotency-key": request.actionId,
      "x-phantomforce-correlation-id": request.correlationId,
    },
    body: JSON.stringify({
      contract: "phantomforce_email_executor_v1",
      tenant_id: text(request.tenantId, 120),
      action_id: text(request.actionId, 120),
      correlation_id: text(request.correlationId, 180),
      message: { to, subject, body, thread_id: text(request.threadId, 300) || null },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || payload.accepted !== true) {
    throw new Error(`Email provider rejected the request (${response.status}).`);
  }
  const provider = payload.provider === "gmail" || payload.provider === "outlook" ? payload.provider : "other";
  const messageId = text(payload.message_id, 300);
  const submittedAt = text(payload.submitted_at, 80);
  if (!messageId || !Number.isFinite(Date.parse(submittedAt))) {
    throw new Error("Email provider response did not include a valid message receipt.");
  }
  return {
    accepted: true,
    provider,
    messageId,
    threadId: text(payload.thread_id, 300) || null,
    submittedAt,
  };
}

function providerEventCanonical(input: EmailProviderEvent) {
  return [
    input.eventId,
    input.tenantId,
    input.messageId,
    input.provider,
    input.eventType,
    input.occurredAt,
    input.sequence,
    input.threadId || "",
    input.replyPreview || "",
  ].join("|");
}

export function parseVerifiedEmailProviderEvent(body: unknown, signatureHeader: unknown): EmailProviderEvent {
  const source = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const event: EmailProviderEvent = {
    eventId: text(source.event_id, 180),
    tenantId: text(source.tenant_id, 120),
    messageId: text(source.message_id, 300),
    provider: source.provider === "gmail" || source.provider === "outlook" ? source.provider : "other",
    eventType: source.event_type === "delivered" || source.event_type === "bounced" || source.event_type === "replied" ? source.event_type : "delivered",
    occurredAt: text(source.occurred_at, 80),
    sequence: Number(source.sequence),
    threadId: text(source.thread_id, 300) || null,
    replyPreview: text(source.reply_preview, 2_000) || null,
  };
  if (!event.eventId || !event.tenantId || !event.messageId || !Number.isInteger(event.sequence) || event.sequence < 0 || !Number.isFinite(Date.parse(event.occurredAt))) {
    throw Object.assign(new Error("Invalid email provider event."), { code: "invalid_email_provider_event" });
  }
  if (source.event_type !== "delivered" && source.event_type !== "bounced" && source.event_type !== "replied") {
    throw Object.assign(new Error("Unsupported email provider event type."), { code: "unsupported_email_provider_event" });
  }
  const secret = webhookSecret();
  if (secret.length < 24) throw Object.assign(new Error("Email event webhook is not configured."), { code: "email_webhook_not_configured" });
  const expected = createHmac("sha256", secret).update(providerEventCanonical(event)).digest("hex");
  const received = text(signatureHeader, 200).replace(/^sha256=/i, "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(received) || !timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"))) {
    throw Object.assign(new Error("Invalid email provider signature."), { code: "invalid_email_provider_signature" });
  }
  return event;
}

export function signEmailProviderEventForTest(event: EmailProviderEvent, secret: string) {
  return createHmac("sha256", secret).update(providerEventCanonical(event)).digest("hex");
}
