import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = await mkdtemp(join(tmpdir(), "phantomforce-social-http-"));
const secret = "social-http-secret-at-least-24-characters";
process.env.NODE_ENV = "development";
process.env.PHANTOMFORCE_AUTH_PROVIDER = "demo";
process.env.PHANTOMFORCE_ENABLE_DEMO_AUTH = "true";
process.env.PHANTOMFORCE_SKIP_SERVER_DOTENV = "true";
process.env.PHANTOMFORCE_SERVER_LISTEN = "false";
process.env.PHANTOMFORCE_SERVER_LOGGER = "false";
process.env.PHANTOMFORCE_CONTENT_PUBLICATION_DIR = root;
process.env.PHANTOMFORCE_SOCIAL_EXECUTOR_URL = "http://127.0.0.1:8787";
process.env.PHANTOMFORCE_SOCIAL_EXECUTOR_SECRET = secret;
process.env.PHANTOMFORCE_SOCIAL_WEBHOOK_SECRET = secret;

const originalFetch = globalThis.fetch;
let executorCalls = 0;
globalThis.fetch = async (input, init) => {
  assert.equal(String(input), "http://127.0.0.1:8787/v1/social/publish");
  assert.equal(new Headers(init?.headers).get("x-idempotency-key"), "social-http-draft-1");
  executorCalls += 1;
  return new Response(JSON.stringify({
    accepted: true,
    results: [
      { channel: "instagram", accepted: true, provider: "meta", submission_id: "submit-ig-http-1", submitted_at: "2026-09-15T13:00:00.000Z" },
      { channel: "linkedin", accepted: true, provider: "linkedin", submission_id: "submit-li-http-1", submitted_at: "2026-09-15T13:00:00.000Z" },
    ],
  }), { status: 202, headers: { "content-type": "application/json" } });
};

const { app } = await import("../src/index.js");
const { signSocialProviderEventForTest } = await import("../src/connectors/social-publishing-connector.js");
const readJson = <T>(response: { body: string }) => JSON.parse(response.body) as T;
const tenantId = "social-http-owner";

try {
  const login = await app.inject({ method: "POST", url: "/auth/demo-login", payload: { sessionId: "admin-jordan" } });
  const token = readJson<{ token: string }>(login).token;
  const headers = { authorization: `Bearer ${token}` };

  const statusResponse = await app.inject({ method: "GET", url: `/api/connections/status?tenant_id=${tenantId}`, headers });
  assert.equal(statusResponse.statusCode, 200);
  const connection = readJson<{ social_publishing: { state: string; supportedChannels: string[]; secretsExposed: boolean } }>(statusResponse).social_publishing;
  assert.equal(connection.state, "ready");
  assert.equal(connection.supportedChannels.includes("instagram"), true);
  assert.equal(connection.secretsExposed, false);

  const createResponse = await app.inject({
    method: "POST",
    url: "/api/content-publications",
    headers,
    payload: {
      tenant_id: tenantId,
      idempotency_key: "social-http-draft-1",
      status: "approval_required",
      channels: ["instagram", "linkedin"],
      caption: "One campaign, adapted and verified everywhere.",
      post_type: "video",
      timezone: "America/Chicago",
    },
  });
  assert.equal(createResponse.statusCode, 201);
  const created = readJson<{ publication: { id: string } }>(createResponse).publication;

  const approveResponse = await app.inject({
    method: "POST",
    url: `/api/content-publications/${created.id}/approve`,
    headers,
    payload: { tenant_id: tenantId, approval_id: "approval-social-http-1" },
  });
  assert.equal(approveResponse.statusCode, 200);
  const approved = readJson<{
    publication: { status: string; externalSent: boolean; channelResults: Array<{ status: string; submissionReceiptId: string }> };
    provider_called: boolean;
    public_exposure_changed: boolean;
  }>(approveResponse);
  assert.equal(executorCalls, 1);
  assert.equal(approved.provider_called, true);
  assert.equal(approved.public_exposure_changed, false);
  assert.equal(approved.publication.status, "publishing");
  assert.equal(approved.publication.externalSent, false);
  assert.equal(approved.publication.channelResults.every((row) => row.status === "submitted" && row.submissionReceiptId), true);

  const event = {
    eventId: "social-http-event-1",
    tenantId,
    publicationId: created.id,
    channel: "instagram" as const,
    eventType: "published" as const,
    occurredAt: "2026-09-15T13:01:00.000Z",
    sequence: 1,
    provider: "meta",
    submissionId: "submit-ig-http-1",
    platformPostId: "ig-platform-post-http-1",
    publicUrl: "https://instagram.example.test/p/http-1",
    errorCode: null,
    errorMessage: null,
  };
  const signature = signSocialProviderEventForTest(event, secret);
  const webhookResponse = await app.inject({
    method: "POST",
    url: "/api/social/provider/events",
    headers: { "x-phantomforce-social-signature": signature },
    payload: {
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
    },
  });
  assert.equal(webhookResponse.statusCode, 200);
  const applied = readJson<{ applied: boolean; public_exposure_changed: boolean }>(webhookResponse);
  assert.equal(applied.applied, true);
  assert.equal(applied.public_exposure_changed, true);

  const replay = await app.inject({
    method: "POST",
    url: "/api/social/provider/events",
    headers: { "x-phantomforce-social-signature": signature },
    payload: {
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
    },
  });
  assert.equal(readJson<{ applied: boolean; replayed: boolean }>(replay).applied, false);
  assert.equal(readJson<{ replayed: boolean }>(replay).replayed, true);

  console.log(JSON.stringify({
    ok: true,
    suite: "social-publishing-http",
    approvalBound: true,
    executorCalledOnce: true,
    platformReceiptRecorded: true,
    webhookReplaySafe: true,
  }, null, 2));
} finally {
  globalThis.fetch = originalFetch;
  await app.close();
  await rm(root, { recursive: true, force: true });
}
