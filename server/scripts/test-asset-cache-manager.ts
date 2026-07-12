/* Asset Vault Stage 3 — cache manager. Real filesystem in a temp dir, real
   in-memory SQLite index. No mocked disk state. */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

const tempStateDir = await mkdtemp(path.join(os.tmpdir(), "phantomforce-cache-manager-test-"));
process.env.PHANTOMFORCE_CONTENT_ASSET_DIR = tempStateDir;
await mkdir(path.join(tempStateDir, "files"), { recursive: true });

const { resetAssetDbForTests, insertAsset, setAssetPinned, getCacheStats } = await import("../src/phantom-ai/asset-db.js");
const { findOrphanFiles, findMissingFiles, verifyAssetIntegrity, previewCleanup, runCleanup } = await import(
  "../src/phantom-ai/asset-cache-manager.js"
);

resetAssetDbForTests();

const filesDir = path.join(tempStateDir, "files");

// A real orphan: a file with no DB row.
await writeFile(path.join(filesDir, "orphan-file"), "orphan bytes");

// A real "missing file" case: DB row exists, file does not.
const missingOne = insertAsset({
  ownerScope: "scope-a",
  assetType: "image",
  originalName: "ghost.jpg",
  mimeType: "image/jpeg",
  fileSizeBytes: 5,
  storageProvider: "local-disk",
  storageKey: "ghost-key",
});

// A real, present, hash-verifiable asset.
const goodBytes = Buffer.from("real file contents");
await writeFile(path.join(filesDir, "good-key"), goodBytes);
const crypto = await import("node:crypto");
const goodHash = crypto.createHash("sha256").update(goodBytes).digest("hex");
const goodAsset = insertAsset({
  ownerScope: "scope-a",
  assetType: "image",
  originalName: "good.jpg",
  mimeType: "image/jpeg",
  fileSizeBytes: goodBytes.byteLength,
  storageProvider: "local-disk",
  storageKey: "good-key",
  contentHash: goodHash,
});

// A tampered asset: stored hash won't match the file's real bytes.
await writeFile(path.join(filesDir, "tampered-key"), Buffer.from("original"));
const tamperedAsset = insertAsset({
  ownerScope: "scope-a",
  assetType: "image",
  originalName: "tampered.jpg",
  mimeType: "image/jpeg",
  fileSizeBytes: 8,
  storageProvider: "local-disk",
  storageKey: "tampered-key",
  contentHash: crypto.createHash("sha256").update("not-the-real-content").digest("hex"),
});

const orphans = await findOrphanFiles();
assert(orphans.includes("orphan-file"), "a file with no DB row should be reported as an orphan.");
assert(!orphans.includes("good-key"), "a file with a real DB row must not be reported as an orphan.");

const missing = await findMissingFiles("scope-a");
assert(missing.some((a) => a.id === missingOne.id), "a DB row whose file is absent should be reported as missing.");
assert(!missing.some((a) => a.id === goodAsset.id), "a DB row whose file exists must not be reported as missing.");

const goodCheck = await verifyAssetIntegrity(goodAsset);
assert(goodCheck.ok && goodCheck.checked === "hash", "a matching hash should verify as ok.");

const tamperedCheck = await verifyAssetIntegrity(tamperedAsset);
assert(!tamperedCheck.ok && tamperedCheck.reason === "hash_mismatch", "a mismatched hash must be reported, not silently passed.");

console.log("integrity/orphan checks: all passed.");

// ---- cache stats + cleanup (LRU, pinning, vault protection) ------------------------

const expiredCache = insertAsset({
  ownerScope: "scope-b",
  assetType: "image",
  originalName: "old1.jpg",
  mimeType: "image/jpeg",
  fileSizeBytes: 1000,
  storageProvider: "local-disk",
  storageKey: "old1-key",
  tier: "cache",
});
await writeFile(path.join(filesDir, "old1-key"), Buffer.alloc(1000));

const pinnedCache = insertAsset({
  ownerScope: "scope-b",
  assetType: "image",
  originalName: "pinned.jpg",
  mimeType: "image/jpeg",
  fileSizeBytes: 1000,
  storageProvider: "local-disk",
  storageKey: "pinned-key",
  tier: "cache",
});
await writeFile(path.join(filesDir, "pinned-key"), Buffer.alloc(1000));
setAssetPinned(pinnedCache.id, "scope-b", true);

const vaultOne = insertAsset({
  ownerScope: "scope-b",
  assetType: "image",
  originalName: "vault.jpg",
  mimeType: "image/jpeg",
  fileSizeBytes: 1000,
  storageProvider: "local-disk",
  storageKey: "vault-key",
  tier: "vault",
});
await writeFile(path.join(filesDir, "vault-key"), Buffer.alloc(1000));

const stats = getCacheStats("scope-b");
assert(stats.totalAssets === 3, "cache stats should count every asset in scope.");
assert(stats.pinnedAssets === 1 && stats.pinnedBytes === 1000, "pinned stats should reflect the pinned asset only.");
assert(stats.vaultAssets === 1, "vault stats should reflect the vault-tier asset only.");

const preview = previewCleanup("scope-b", 1000);
assert(
  preview.assets.length === 1 && preview.assets[0].id === expiredCache.id,
  "cleanup preview must only offer the unpinned cache-tier asset, never the pinned or vault one.",
);

const cleanupResult = await runCleanup("scope-b", 1000);
assert(cleanupResult.deletedIds.includes(expiredCache.id), "runCleanup should actually delete the eligible asset.");
assert(!cleanupResult.deletedIds.includes(pinnedCache.id), "runCleanup must never delete a pinned asset.");
assert(!cleanupResult.deletedIds.includes(vaultOne.id), "runCleanup must never delete a vault-tier asset.");

const statsAfter = getCacheStats("scope-b");
assert(statsAfter.totalAssets === 2, "the deleted asset should actually be gone from stats afterward.");

console.log("cache stats/cleanup checks: all passed.");

await rm(tempStateDir, { recursive: true, force: true });
console.log(JSON.stringify({ ok: true, suite: "asset-cache-manager" }, null, 2));
