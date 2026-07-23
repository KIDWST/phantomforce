import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  approveContentPublication,
  cancelContentPublication,
  createContentPublication,
  listContentPublications,
  recordPublicationChannelResult,
} from "../src/content/content-publication-store.js";

const root = await mkdtemp(path.join(os.tmpdir(), "phantom-content-publications-"));
try {
  const created = await createContentPublication({
    tenantId: "tenant-a",
    actor: "author-a",
    idempotencyKey: "draft-1",
    input: {
      status: "scheduled",
      channels: ["instagram", "linkedin"],
      caption: "A reviewed launch post",
      sourceAssetId: "asset-source",
      thumbnailAssetId: "asset-thumbnail",
      postType: "image",
      timezone: "America/Chicago",
      scheduledFor: "2026-07-24T14:00:00.000Z",
    },
    root,
  });
  assert.equal(created.created, true);
  assert.equal(created.publication.externalSent, false);
  assert.equal(created.publication.thumbnailAssetId, "asset-thumbnail");
  assert.equal(created.publication.timezone, "America/Chicago");

  const duplicate = await createContentPublication({
    tenantId: "tenant-a",
    actor: "author-a",
    idempotencyKey: "draft-1",
    input: { status: "draft", channels: ["x"], caption: "Must not replace" },
    root,
  });
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.publication.id, created.publication.id);
  assert.deepEqual(duplicate.publication.channels, ["instagram", "linkedin"]);

  await assert.rejects(
    recordPublicationChannelResult({
      tenantId: "tenant-a",
      publicationId: created.publication.id,
      actor: "provider-worker",
      channel: "instagram",
      status: "published",
      providerReceiptId: "receipt-before-approval",
      root,
    }),
    /publication_not_in_progress/u,
  );

  const approved = await approveContentPublication({
    tenantId: "tenant-a",
    publicationId: created.publication.id,
    approvalId: "approval-verified-1",
    actor: "manager-a",
    root,
  });
  assert.equal(approved.status, "publishing");

  await assert.rejects(
    recordPublicationChannelResult({
      tenantId: "tenant-a",
      publicationId: created.publication.id,
      actor: "provider-worker",
      channel: "instagram",
      status: "published",
      root,
    }),
    /provider_receipt_required/u,
  );

  const oneSuccess = await recordPublicationChannelResult({
    tenantId: "tenant-a",
    publicationId: created.publication.id,
    actor: "provider-worker",
    channel: "instagram",
    status: "published",
    providerReceiptId: "ig-receipt-1",
    publicUrl: "https://example.invalid/post/1",
    root,
  });
  assert.equal(oneSuccess.status, "publishing");

  const partial = await recordPublicationChannelResult({
    tenantId: "tenant-a",
    publicationId: created.publication.id,
    actor: "provider-worker",
    channel: "linkedin",
    status: "failed",
    errorCode: "provider_timeout",
    errorMessage: "LinkedIn did not acknowledge the request.",
    root,
  });
  assert.equal(partial.status, "partial");
  assert.equal(partial.externalSent, true);

  await assert.rejects(cancelContentPublication("tenant-a", created.publication.id, root), /published_content_cannot_be_cancelled/u);
  assert.equal((await listContentPublications("tenant-b", root)).length, 0);
  assert.equal((await listContentPublications("tenant-a", root)).length, 1);

  const draft = await createContentPublication({
    tenantId: "tenant-a",
    actor: "author-a",
    idempotencyKey: "draft-2",
    input: { status: "draft", channels: ["x"], caption: "Safe local draft" },
    root,
  });
  const cancelled = await cancelContentPublication("tenant-a", draft.publication.id, root);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.externalSent, false);

  console.log("content publication lifecycle tests passed");
} finally {
  await rm(root, { recursive: true, force: true });
}
