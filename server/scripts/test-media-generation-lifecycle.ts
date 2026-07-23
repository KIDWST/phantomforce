import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createMediaGenerationJob,
  listMediaGenerationJobs,
  retryMediaGenerationJob,
  transitionMediaGenerationJob,
} from "../src/media/media-generation-store.js";

const root = await mkdtemp(path.join(os.tmpdir(), "phantom-media-generation-"));

try {
  const first = await createMediaGenerationJob({
    tenantId: "tenant-a",
    actor: "operator-a",
    idempotencyKey: "request-1",
    input: {
      modality: "image",
      prompt: "A cinematic product photograph",
      provider: "media-lab",
      model: "image-v1",
      parameters: { aspect: "1:1", count: 2 },
    },
    root,
  });
  assert.equal(first.created, true);
  assert.equal(first.job.status, "queued");

  const duplicate = await createMediaGenerationJob({
    tenantId: "tenant-a",
    actor: "operator-a",
    idempotencyKey: "request-1",
    input: { modality: "video", prompt: "This must not replace the original" },
    root,
  });
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.job.id, first.job.id);
  assert.equal(duplicate.job.modality, "image");

  const concurrent = await Promise.all(["request-2", "request-3", "request-4"].map((idempotencyKey, index) =>
    createMediaGenerationJob({
      tenantId: "tenant-a",
      actor: "operator-a",
      idempotencyKey,
      input: { modality: index === 0 ? "video" : "image", prompt: `Concurrent job ${index + 1}` },
      root,
    })));
  assert.equal(concurrent.every((result) => result.created), true);
  assert.equal((await listMediaGenerationJobs("tenant-a", { activeOnly: true, root })).length, 4);

  const started = await transitionMediaGenerationJob({
    tenantId: "tenant-a",
    jobId: first.job.id,
    actor: "operator-a",
    status: "running",
    root,
  });
  assert.equal(started.job.status, "running");
  await assert.rejects(
    transitionMediaGenerationJob({
      tenantId: "tenant-a",
      jobId: first.job.id,
      actor: "operator-a",
      status: "completed",
      outputAssetIds: [],
      root,
    }),
    /verified_output_reference_required/u,
  );

  const completed = await transitionMediaGenerationJob({
    tenantId: "tenant-a",
    jobId: first.job.id,
    actor: "operator-a",
    status: "completed",
    outputAssetIds: ["asset-1", "asset-2"],
    root,
  });
  assert.equal(completed.job.status, "completed");
  assert.deepEqual(completed.job.outputAssetIds, ["asset-1", "asset-2"]);

  const cancelledSource = concurrent[0].job;
  const cancelled = await transitionMediaGenerationJob({
    tenantId: "tenant-a",
    jobId: cancelledSource.id,
    actor: "operator-a",
    status: "cancelled",
    root,
  });
  assert.equal(cancelled.job.status, "cancelled");
  const repeatedCancel = await transitionMediaGenerationJob({
    tenantId: "tenant-a",
    jobId: cancelledSource.id,
    actor: "operator-a",
    status: "cancelled",
    root,
  });
  assert.equal(repeatedCancel.changed, false);

  const retry = await retryMediaGenerationJob({
    tenantId: "tenant-a",
    jobId: cancelledSource.id,
    actor: "operator-a",
    idempotencyKey: "retry-1",
    root,
  });
  assert.equal(retry.job.retryOf, cancelledSource.id);
  assert.equal(retry.job.attempt, 2);
  assert.equal(retry.job.status, "queued");

  assert.equal((await listMediaGenerationJobs("tenant-b", { root })).length, 0);
  await assert.rejects(
    transitionMediaGenerationJob({
      tenantId: "tenant-b",
      jobId: first.job.id,
      actor: "operator-b",
      status: "cancelled",
      root,
    }),
    /job_not_found/u,
  );

  const afterRefresh = await listMediaGenerationJobs("tenant-a", { root });
  assert.equal(afterRefresh.some((job) => job.id === retry.job.id), true);
  assert.equal(afterRefresh.find((job) => job.id === first.job.id)?.status, "completed");

  console.log("media generation lifecycle tests passed");
} finally {
  await rm(root, { recursive: true, force: true });
}
