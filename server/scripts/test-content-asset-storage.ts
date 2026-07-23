import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LocalDiskContentAssetProvider } from "../src/phantom-ai/content-asset-storage.js";

const pngBytes = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
]);
const pngDataUrl = `data:image/png;base64,${pngBytes.toString("base64")}`;
const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

const stateDir = await mkdtemp(path.join(os.tmpdir(), "phantom-content-assets-"));
const provider = new LocalDiskContentAssetProvider(stateDir);

try {
  const first = await provider.putAsset({
    ownerScope: "tenant-a",
    dataUrl: pngDataUrl,
    originalName: "hero.png",
  });
  assert.equal(first.ok, true);
  if (!first.ok) throw new Error(first.error);
  assert.equal(first.deduplicated, false);
  assert.equal(first.asset.mime_type, "image/png");
  assert.match(first.asset.checksum_sha256, /^[a-f0-9]{64}$/);

  const spoofed = await provider.putAsset({
    ownerScope: "tenant-a",
    dataUrl: `data:image/png;base64,${jpegBytes.toString("base64")}`,
    originalName: "not-really.png",
  });
  assert.deepEqual(spoofed, { ok: false, error: "mime_signature_mismatch" });

  const duplicate = await provider.putAsset({
    ownerScope: "tenant-a",
    dataUrl: pngDataUrl,
    originalName: "hero-copy.png",
  });
  assert.equal(duplicate.ok, true);
  if (!duplicate.ok) throw new Error(duplicate.error);
  assert.equal(duplicate.deduplicated, true);
  assert.equal(duplicate.asset.checksum_sha256, first.asset.checksum_sha256);

  const tenantB = await provider.putAsset({
    ownerScope: "tenant-b",
    dataUrl: pngDataUrl,
    originalName: "private.png",
  });
  assert.equal(tenantB.ok, true);
  if (!tenantB.ok) throw new Error(tenantB.error);

  assert.equal((await provider.listAssets("tenant-a")).length, 2);
  assert.equal((await provider.listAssets("tenant-b")).length, 1);
  assert.deepEqual(await provider.getAssetFile(tenantB.asset.id, "tenant-a"), { ok: false, error: "not_found" });

  const blobsBeforeArchive = await readdir(path.join(stateDir, "blobs"));
  assert.deepEqual(blobsBeforeArchive, [first.asset.checksum_sha256]);

  assert.equal(await provider.deleteAsset(first.asset.id, "tenant-a"), true);
  assert.equal((await provider.listAssets("tenant-a")).length, 1);
  assert.equal((await provider.listArchivedAssets("tenant-a")).length, 1);
  await stat(path.join(stateDir, "blobs", first.asset.checksum_sha256));

  const restored = await provider.restoreAsset(first.asset.id, "tenant-a");
  assert.equal(restored?.status, "active");
  assert.equal((await provider.listAssets("tenant-a")).length, 2);

  assert.equal(await provider.purgeAsset(first.asset.id, "tenant-a"), true);
  assert.equal((await provider.getAssetFile(duplicate.asset.id, "tenant-a")).ok, true);
  await stat(path.join(stateDir, "blobs", duplicate.asset.checksum_sha256));

  assert.equal(await provider.purgeAsset(duplicate.asset.id, "tenant-a"), true);
  assert.equal((await provider.getAssetFile(tenantB.asset.id, "tenant-b")).ok, true);
  await stat(path.join(stateDir, "blobs", tenantB.asset.checksum_sha256));

  assert.equal(await provider.purgeAsset(tenantB.asset.id, "tenant-b"), true);
  await assert.rejects(stat(path.join(stateDir, "blobs", tenantB.asset.checksum_sha256)));

  const index = JSON.parse(await readFile(path.join(stateDir, "index.json"), "utf8")) as { schemaVersion: number; records: unknown[] };
  assert.equal(index.schemaVersion, 2);
  assert.equal(index.records.length, 0);

  console.log("content asset storage tests passed");
} finally {
  await rm(stateDir, { recursive: true, force: true });
}
