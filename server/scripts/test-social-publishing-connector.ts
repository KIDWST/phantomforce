import assert from "node:assert/strict";

import {
  getSocialPublishingConnectorStatus,
  parseVerifiedSocialProviderEvent,
  signSocialProviderEventForTest,
  submitSocialPublication,
  type SocialProviderEvent,
} from "../src/connectors/social-publishing-connector.js";

const originalUrl = process.env.PHANTOMFORCE_SOCIAL_EXECUTOR_URL;
const originalExecutorSecret = process.env.PHANTOMFORCE_SOCIAL_EXECUTOR_SECRET;
const originalWebhookSecret = process.env.PHANTOMFORCE_SOCIAL_WEBHOOK_SECRET;
const originalFetch = globalThis.fetch;
const secret = "social-test-secret-at-least-24-characters";

try {
  delete process.env.PHANTOMFORCE_SOCIAL_EXECUTOR_URL;
  delete process.env.PHANTOMFORCE_SOCIAL_EXECUTOR_SECRET;
  delete process.env.PHANTOMFORCE_SOCIAL_WEBHOOK_SECRET;
  assert.equal(getSocialPublishingConnectorStatus().state, "configuration_required");

  process.env.PHANTOMFORCE_SOCIAL_EXECUTOR_URL = "https://social-executor.example.test";
  process.env.PHANTOMFORCE_SOCIAL_EXECUTOR_SECRET = secret;
  process.env.PHANTOMFORCE_SOCIAL_WEBHOOK_SECRET = secret;
  assert.equal(getSocialPublishingConnectorStatus().state, "ready");

  let submittedBody: Record<string, unknown> | null = null;
  globalThis.fetch = async (_input, init) => {
    submittedBody = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
    return new Response(JSON.stringify({
      accepted: true,
      results: [
        { channel: "instagram", accepted: true, provider: "meta", submission_id: "ig-submit-1", submitted_at: "2026-09-15T12:00:00.000Z" },
        { channel: "x", accepted: true, provider: "x", submission_id: "x-submit-1", submitted_at: "2026-09-15T12:00:00.000Z" },
      ],
    }), { status: 202, headers: { "content-type": "application/json" } });
  };

  const receipts = await submitSocialPublication({
    tenantId: "tenant-a",
    publicationId: "publication-a",
    idempotencyKey: "publish-once-a",
    correlationId: "social:publication-a",
    channels: ["instagram", "x"],
    caption: "A long campaign caption ".repeat(30),
    sourceAssetId: "asset-a",
    thumbnailAssetId: "thumb-a",
    postType: "video",
    scheduledFor: null,
    timezone: "America/Chicago",
  });
  assert.equal(receipts.length, 2);
  assert.equal(receipts.every((receipt) => receipt.accepted && receipt.submissionId), true);
  const channelPayloads = submittedBody?.channel_payloads as Array<{ channel: string; caption: string }>;
  assert.equal(channelPayloads.find((row) => row.channel === "x")?.caption.length, 280);
  assert.equal(channelPayloads.find((row) => row.channel === "instagram")?.caption.length > 280, true);

  const event: SocialProviderEvent = {
    eventId: "event-social-1",
    tenantId: "tenant-a",
    publicationId: "publication-a",
    channel: "instagram",
    eventType: "published",
    occurredAt: "2026-09-15T12:01:00.000Z",
    sequence: 1,
    provider: "meta",
    submissionId: "ig-submit-1",
    platformPostId: "ig-post-1",
    publicUrl: "https://instagram.example.test/p/ig-post-1",
    errorCode: null,
    errorMessage: null,
  };
  const signature = signSocialProviderEventForTest(event, secret);
  const parsed = parseVerifiedSocialProviderEvent({
    event_id: event.eventId,
    tenant_id: event.tenantId,
    publication_id: event.publicationId,
    channel: event.channel,
    event_type: event.eventType,
    occurred_at: event.occurredAt,
    sequence: event.sequence,
    provider: event.provider,
    submission_id: event.submissionId,
    platform_post_id: event.platformPostId,
    public_url: event.publicUrl,
  }, signature);
  assert.equal(parsed.platformPostId, "ig-post-1");
  assert.throws(() => parseVerifiedSocialProviderEvent({
    event_id: event.eventId,
    tenant_id: event.tenantId,
    publication_id: event.publicationId,
    channel: event.channel,
    event_type: event.eventType,
    occurred_at: event.occurredAt,
    sequence: event.sequence,
    provider: event.provider,
    submission_id: event.submissionId,
    platform_post_id: event.platformPostId,
    public_url: event.publicUrl,
  }, "0".repeat(64)), /signature/u);

  console.log(JSON.stringify({
    ok: true,
    suite: "social-publishing-connector",
    channelAdaptation: true,
    submissionReceipts: true,
    signedProviderEvents: true,
  }, null, 2));
} finally {
  globalThis.fetch = originalFetch;
  if (originalUrl === undefined) delete process.env.PHANTOMFORCE_SOCIAL_EXECUTOR_URL;
  else process.env.PHANTOMFORCE_SOCIAL_EXECUTOR_URL = originalUrl;
  if (originalExecutorSecret === undefined) delete process.env.PHANTOMFORCE_SOCIAL_EXECUTOR_SECRET;
  else process.env.PHANTOMFORCE_SOCIAL_EXECUTOR_SECRET = originalExecutorSecret;
  if (originalWebhookSecret === undefined) delete process.env.PHANTOMFORCE_SOCIAL_WEBHOOK_SECRET;
  else process.env.PHANTOMFORCE_SOCIAL_WEBHOOK_SECRET = originalWebhookSecret;
}
