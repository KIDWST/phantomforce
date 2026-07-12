/* Asset Vault Stage 8 — asset-cloud-sync.ts. Covers the honest-degradation
   path (no cloud provider configured, as in this test environment — no
   real bucket/credentials exist here) plus the real local-file plumbing:
   uploadAssetToCloud/downloadAssetFromCloud must never mark an asset as
   cloud-synced without a real provider call having actually succeeded. */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

delete process.env.PHANTOMFORCE_CLOUD_S3_ENDPOINT;
delete process.env.PHANTOMFORCE_CLOUD_S3_REGION;
delete process.env.PHANTOMFORCE_CLOUD_S3_BUCKET;
delete process.env.PHANTOMFORCE_CLOUD_S3_ACCESS_KEY_ID;
delete process.env.PHANTOMFORCE_CLOUD_S3_SECRET_ACCESS_KEY;

const tempStateDir = await mkdtemp(path.join(os.tmpdir(), "phantomforce-cloud-sync-test-"));
process.env.PHANTOMFORCE_CONTENT_ASSET_DIR = tempStateDir;
await mkdir(path.join(tempStateDir, "files"), { recursive: true });

const { resetAssetDbForTests, insertAsset, getAssetById } = await import("../src/phantom-ai/asset-db.js");
const { getCloudCapabilityStatus, uploadAssetToCloud, downloadAssetFromCloud, removeAssetFromCloud } = await import(
  "../src/phantom-ai/asset-cloud-sync.js"
);

resetAssetDbForTests();

const status = getCloudCapabilityStatus();
assert(status.configured === false, "getCloudCapabilityStatus must honestly report unconfigured when no env vars are set.");
assert(status.provider === "s3-compatible", "the provider name should be reported even when unconfigured.");

await writeFile(path.join(tempStateDir, "files", "asset-1-key"), Buffer.from("local bytes"));
const asset = insertAsset({
  ownerScope: "scope-a",
  assetType: "image",
  originalName: "photo.jpg",
  mimeType: "image/jpeg",
  fileSizeBytes: 11,
  storageProvider: "local-disk",
  storageKey: "asset-1-key",
});

const uploadResult = await uploadAssetToCloud(asset.id, "scope-a");
assert(
  !uploadResult.ok && uploadResult.error === "cloud_storage_not_configured",
  "uploadAssetToCloud must fail honestly, not fabricate a cloud copy, when no provider is configured.",
);
const afterUpload = getAssetById(asset.id, "scope-a");
assert(
  afterUpload!.availability === "local" && afterUpload!.cloud_key === null,
  "a failed upload attempt must never mark the asset as cloud-available or set a cloud_key.",
);

const downloadResult = await downloadAssetFromCloud(asset.id, "scope-a");
assert(!downloadResult.ok && downloadResult.error === "cloud_storage_not_configured", "downloadAssetFromCloud must fail the same honest way.");

const removeResult = await removeAssetFromCloud(asset.id, "scope-a");
assert(!removeResult.ok && removeResult.error === "cloud_storage_not_configured", "removeAssetFromCloud must fail the same honest way.");

const missingAssetUpload = await uploadAssetToCloud("does-not-exist", "scope-a");
assert(!missingAssetUpload.ok, "uploading a nonexistent asset id must fail, never silently succeed.");

console.log("asset-cloud-sync honesty contract: all passed.");

await rm(tempStateDir, { recursive: true, force: true });
console.log(JSON.stringify({ ok: true, suite: "asset-cloud-sync" }, null, 2));
