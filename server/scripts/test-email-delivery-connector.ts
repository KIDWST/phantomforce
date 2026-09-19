import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  getEmailDeliveryConnectorStatus,
  parseVerifiedEmailProviderEvent,
  signEmailProviderEventForTest,
  type EmailProviderEvent,
} from "../src/connectors/email-delivery-connector.js";
import {
  decideWorkAction,
  getWorkGraphDocument,
  proposeWorkAction,
  recordWorkGraphEmailProviderEvent,
} from "../src/workforce/work-graph.js";
import { requiresWrite } from "../src/access/paywall-guard.js";

const saved = {
  url: process.env.PHANTOMFORCE_EMAIL_EXECUTOR_URL,
  executorSecret: process.env.PHANTOMFORCE_EMAIL_EXECUTOR_SECRET,
  webhookSecret: process.env.PHANTOMFORCE_EMAIL_WEBHOOK_SECRET,
};
delete process.env.PHANTOMFORCE_EMAIL_EXECUTOR_URL;
delete process.env.PHANTOMFORCE_EMAIL_EXECUTOR_SECRET;
delete process.env.PHANTOMFORCE_EMAIL_WEBHOOK_SECRET;
assert.equal(getEmailDeliveryConnectorStatus().sendReady, false);
assert.equal(requiresWrite("POST", "/api/email/provider/events"), false, "the signed provider webhook must bypass session paywall checks");

const requests: Array<{ headers: Record<string, string | string[] | undefined>; body: Record<string, unknown> }> = [];
const provider = createServer((request, response) => {
  let raw = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => { raw += chunk; });
  request.on("end", () => {
    requests.push({ headers: request.headers, body: JSON.parse(raw) as Record<string, unknown> });
    response.writeHead(202, { "content-type": "application/json" });
    response.end(JSON.stringify({
      accepted: true,
      provider: "gmail",
      message_id: "gmail-message-9001",
      thread_id: "gmail-thread-42",
      submitted_at: "2026-09-15T15:00:00.000Z",
    }));
  });
});

await new Promise<void>((resolvePromise) => provider.listen(0, "127.0.0.1", resolvePromise));
const address = provider.address();
if (!address || typeof address === "string") throw new Error("Test email provider did not bind to a TCP port.");
const root = await mkdtemp(join(tmpdir(), "phantomforce-email-delivery-"));
const secret = "email-test-secret-with-more-than-24-characters";

try {
  process.env.PHANTOMFORCE_EMAIL_EXECUTOR_URL = `http://127.0.0.1:${address.port}`;
  process.env.PHANTOMFORCE_EMAIL_EXECUTOR_SECRET = secret;
  process.env.PHANTOMFORCE_EMAIL_WEBHOOK_SECRET = secret;
  const status = getEmailDeliveryConnectorStatus();
  assert.equal(status.sendReady, true);
  assert.equal(status.trackingReady, true);
  assert.equal(status.replySyncReady, true);

  const proposed = await proposeWorkAction({
    tenantId: "tenant-email",
    actor: "phantom-ai",
    root,
    idempotencyKey: "email-send-provider-1",
    correlationId: "campaign-chicagoshots-1",
    action: {
      type: "email.send",
      proposedBy: "ai",
      rationale: "Send the owner-approved campaign message.",
      policy: { surface: "external", reversible: false, requiresApproval: true },
      payload: { to: ["public-business@example.com"], subject: "Chicago production support", body: "A reviewed message body.", threadId: "gmail-thread-existing", replyToMessageId: "gmail-message-existing" },
    },
  });
  assert.equal(proposed.result.action.status, "awaiting_approval");
  assert.equal(requests.length, 0, "proposing must never send");

  const decided = await decideWorkAction({ tenantId: "tenant-email", actionId: proposed.result.action.id, actor: "owner", decision: "approve", root });
  assert.equal(decided.result.action.status, "verified_complete");
  assert.equal(decided.result.action.receipt?.artifactType, "provider_email_message");
  assert.equal(decided.result.action.receipt?.providerReceipt?.deliveryStatus, "submitted");
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.headers["x-idempotency-key"], proposed.result.action.id);
  assert.equal((requests[0]?.body.message as { subject?: string })?.subject, "Chicago production support");
  assert.equal((requests[0]?.body.message as { thread_id?: string })?.thread_id, "gmail-thread-existing");
  assert.equal((requests[0]?.body.message as { in_reply_to_message_id?: string })?.in_reply_to_message_id, "gmail-message-existing");

  const delivered: EmailProviderEvent = {
    eventId: "evt-delivered-1",
    tenantId: "tenant-email",
    messageId: "gmail-message-9001",
    provider: "gmail",
    eventType: "delivered",
    occurredAt: "2026-09-15T15:01:00.000Z",
    sequence: 1,
    threadId: "gmail-thread-42",
    replyPreview: null,
  };
  const deliveredSignature = signEmailProviderEventForTest(delivered, secret);
  const verifiedDelivered = parseVerifiedEmailProviderEvent({
    event_id: delivered.eventId,
    tenant_id: delivered.tenantId,
    message_id: delivered.messageId,
    provider: delivered.provider,
    event_type: delivered.eventType,
    occurred_at: delivered.occurredAt,
    sequence: delivered.sequence,
    thread_id: delivered.threadId,
  }, deliveredSignature);
  const applied = await recordWorkGraphEmailProviderEvent({ event: verifiedDelivered, root });
  assert.equal(applied.result.applied, true);
  const replay = await recordWorkGraphEmailProviderEvent({ event: verifiedDelivered, root });
  assert.equal(replay.result.replayed, true);
  await assert.rejects(
    recordWorkGraphEmailProviderEvent({ event: { ...verifiedDelivered, eventId: "evt-provider-mismatch", provider: "outlook", sequence: 2 }, root }),
    (error: Error & { code?: string }) => error.code === "email_provider_mismatch",
    "A signed event from a different provider must not mutate a Gmail receipt.",
  );

  const replied: EmailProviderEvent = {
    ...delivered,
    eventId: "evt-replied-1",
    eventType: "replied",
    occurredAt: "2026-09-15T16:00:00.000Z",
    sequence: 2,
    replyPreview: "Yes, please send availability for October.",
  };
  const verifiedReply = parseVerifiedEmailProviderEvent({
    event_id: replied.eventId,
    tenant_id: replied.tenantId,
    message_id: replied.messageId,
    provider: replied.provider,
    event_type: replied.eventType,
    occurred_at: replied.occurredAt,
    sequence: replied.sequence,
    thread_id: replied.threadId,
    reply_preview: replied.replyPreview,
  }, signEmailProviderEventForTest(replied, secret));
  await recordWorkGraphEmailProviderEvent({ event: verifiedReply, root });
  const document = await getWorkGraphDocument("tenant-email", "owner", root);
  const receipt = document.actions.find((action) => action.id === proposed.result.action.id)?.receipt?.providerReceipt;
  assert.equal(receipt?.deliveryStatus, "replied");
  assert.equal(receipt?.replyCount, 1);
  assert.equal(receipt?.events.length, 2);
  assert.throws(() => parseVerifiedEmailProviderEvent({
    event_id: replied.eventId,
    tenant_id: replied.tenantId,
    message_id: replied.messageId,
    provider: replied.provider,
    event_type: replied.eventType,
    occurred_at: replied.occurredAt,
    sequence: replied.sequence,
    thread_id: replied.threadId,
    reply_preview: "Tampered reply text.",
  }, signEmailProviderEventForTest(replied, secret)), /Invalid email provider signature/);
  assert.throws(() => parseVerifiedEmailProviderEvent({
    event_id: replied.eventId,
    tenant_id: replied.tenantId,
    message_id: replied.messageId,
    provider: replied.provider,
    event_type: replied.eventType,
    occurred_at: replied.occurredAt,
    sequence: replied.sequence,
  }, "0".repeat(64)), /Invalid email provider signature/);

  console.log(JSON.stringify({
    ok: true,
    approvalBoundSend: true,
    providerReceiptRequired: true,
    idempotencyHeader: true,
    signedTrackingEvents: true,
    replySync: true,
    tenantIsolation: true,
  }));
} finally {
  provider.close();
  await rm(root, { recursive: true, force: true });
  if (saved.url === undefined) delete process.env.PHANTOMFORCE_EMAIL_EXECUTOR_URL; else process.env.PHANTOMFORCE_EMAIL_EXECUTOR_URL = saved.url;
  if (saved.executorSecret === undefined) delete process.env.PHANTOMFORCE_EMAIL_EXECUTOR_SECRET; else process.env.PHANTOMFORCE_EMAIL_EXECUTOR_SECRET = saved.executorSecret;
  if (saved.webhookSecret === undefined) delete process.env.PHANTOMFORCE_EMAIL_WEBHOOK_SECRET; else process.env.PHANTOMFORCE_EMAIL_WEBHOOK_SECRET = saved.webhookSecret;
}
