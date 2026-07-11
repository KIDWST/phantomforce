/* Asset Vault Stage 2 — covers the SQLite model (asset-db.ts) directly, and
   content-asset-storage.ts's provider contract (file storage + migration
   from the legacy index.json). Uses an in-memory database throughout
   (resetAssetDbForTests) and a real temp directory for file operations —
   never touches the real .local/content-assets vault. */
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  addAssetToCollection,
  createCollection,
  deleteAssetById,
  deleteExpiredCacheAssets,
  getAssetById,
  insertAsset,
  listAssetsByOwnerScope,
  listAssetsInCollection,
  listTagsForAsset,
  resetAssetDbForTests,
  tagAsset,
  untagAsset,
} from "../src/phantom-ai/asset-db.js";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

resetAssetDbForTests();

// ---- basic CRUD ---------------------------------------------------------------

const assetA = insertAsset({
  ownerScope: "scope-a",
  assetType: "image",
  originalName: "photo.jpg",
  mimeType: "image/jpeg",
  fileSizeBytes: 1024,
  storageProvider: "local-disk",
  storageKey: "key-a",
});
assert(typeof assetA.id === "string" && assetA.id.length > 0, "insertAsset should assign a stable id.");
assert(assetA.tier === "cache", "default tier should be cache.");

const fetched = getAssetById(assetA.id, "scope-a");
assert(fetched !== null && fetched.original_name === "photo.jpg", "getAssetById should round-trip the inserted row.");

// ---- owner_scope isolation ------------------------------------------------------

const assetB = insertAsset({
  ownerScope: "scope-b",
  assetType: "image",
  originalName: "other.jpg",
  mimeType: "image/jpeg",
  fileSizeBytes: 2048,
  storageProvider: "local-disk",
  storageKey: "key-b",
});

assert(getAssetById(assetA.id, "scope-b") === null, "an asset must not be readable under a different owner_scope.");
assert(getAssetById(assetB.id, "scope-a") === null, "isolation must hold in both directions.");
const scopeAList = listAssetsByOwnerScope("scope-a");
assert(scopeAList.length === 1 && scopeAList[0].id === assetA.id, "listAssetsByOwnerScope must not leak across scopes.");

// ---- tags -----------------------------------------------------------------------

tagAsset(assetA.id, "scope-a", "sports");
tagAsset(assetA.id, "scope-a", "impact");
let tags = listTagsForAsset(assetA.id);
assert(tags.length === 2 && tags.map((t) => t.name).includes("sports"), "tagAsset should attach real tags.");
untagAsset(assetA.id, "scope-a", "impact");
tags = listTagsForAsset(assetA.id);
assert(tags.length === 1 && tags[0].name === "sports", "untagAsset should detach exactly the requested tag.");

let threwOnCrossScopeTag = false;
try {
  tagAsset(assetA.id, "scope-b", "wrong-scope");
} catch {
  threwOnCrossScopeTag = true;
}
assert(threwOnCrossScopeTag, "tagging an asset under the wrong owner_scope must fail, not silently succeed.");

// ---- collections ------------------------------------------------------------------

const collection = createCollection("scope-a", "ChicagoShots Sports Impact Pack", "example pack");
addAssetToCollection(collection.id, assetA.id, "scope-a");
const inCollection = listAssetsInCollection(collection.id, "scope-a");
assert(inCollection.length === 1 && inCollection[0].id === assetA.id, "collection membership should round-trip.");

let threwOnCrossScopeCollection = false;
try {
  addAssetToCollection(collection.id, assetB.id, "scope-a"); // assetB belongs to scope-b, not scope-a
} catch {
  threwOnCrossScopeCollection = true;
}
assert(threwOnCrossScopeCollection, "adding another scope's asset to a collection must fail.");

assert(deleteAssetById(assetA.id, "scope-a"), "deleting an owned asset should succeed.");
assert(listTagsForAsset(assetA.id).length === 0, "deleting an asset must cascade its tag memberships.");
assert(listAssetsInCollection(collection.id, "scope-a").length === 0, "deleting an asset must cascade its collection memberships.");

// ---- cache expiry (never touches vault-tier assets) --------------------------------

const past = new Date(Date.now() - 1000).toISOString();
const future = new Date(Date.now() + 1000 * 60 * 60).toISOString();

const expiredCache = insertAsset({
  ownerScope: "scope-a",
  assetType: "image",
  originalName: "expired.jpg",
  mimeType: "image/jpeg",
  fileSizeBytes: 10,
  storageProvider: "local-disk",
  storageKey: "expired-key",
  tier: "cache",
  expiresAt: past,
});
const freshCache = insertAsset({
  ownerScope: "scope-a",
  assetType: "image",
  originalName: "fresh.jpg",
  mimeType: "image/jpeg",
  fileSizeBytes: 10,
  storageProvider: "local-disk",
  storageKey: "fresh-key",
  tier: "cache",
  expiresAt: future,
});
const vaultAsset = insertAsset({
  ownerScope: "scope-a",
  assetType: "image",
  originalName: "permanent.jpg",
  mimeType: "image/jpeg",
  fileSizeBytes: 10,
  storageProvider: "local-disk",
  storageKey: "vault-key",
  tier: "vault",
  expiresAt: past, // even if a caller mistakenly set an expiry, tier=vault must still never be swept
});

const cleanup = deleteExpiredCacheAssets();
assert(cleanup.deletedIds.includes(expiredCache.id), "an expired cache-tier asset must be swept.");
assert(!cleanup.deletedIds.includes(freshCache.id), "a not-yet-expired cache-tier asset must survive.");
assert(!cleanup.deletedIds.includes(vaultAsset.id), "a vault-tier asset must never be swept, regardless of expires_at.");
assert(getAssetById(expiredCache.id, "scope-a") === null, "swept asset should actually be gone from the index.");
assert(getAssetById(vaultAsset.id, "scope-a") !== null, "vault asset must still be present after cleanup.");

console.log("asset-db.ts: all checks passed.");

// ---- content-asset-storage.ts: file storage + legacy migration --------------------

const tempStateDir = await mkdtemp(path.join(os.tmpdir(), "phantomforce-asset-vault-test-"));
process.env.PHANTOMFORCE_CONTENT_ASSET_DIR = tempStateDir;

// Seed a fake pre-Stage-2 index.json + matching file, exactly like a real
// legacy install would have on disk, before content-asset-storage.ts is
// ever imported — this is what proves migration runs correctly on first use.
const legacyId = "legacy-asset-1";
await mkdir(path.join(tempStateDir, "files"), { recursive: true });
await writeFile(path.join(tempStateDir, "files", legacyId), Buffer.from("fake-jpeg-bytes"));
await writeFile(
  path.join(tempStateDir, "index.json"),
  JSON.stringify({
    records: [
      {
        id: legacyId,
        owner_scope: "legacy-scope",
        original_name: "old-photo.jpg",
        mime_type: "image/jpeg",
        size_bytes: 15,
        created_at: "2026-01-01T00:00:00.000Z",
        expires_at: "2099-01-01T00:00:00.000Z",
      },
    ],
  }),
);

const { getContentAssetStorageProvider } = await import("../src/phantom-ai/content-asset-storage.js");
const provider = getContentAssetStorageProvider();

// First real call triggers the lazy migration.
const legacyListed = await provider.listAssets("legacy-scope");
assert(legacyListed.length === 1 && legacyListed[0].id === legacyId, "legacy index.json record should appear after migration.");
assert(legacyListed[0].original_name === "old-photo.jpg", "migrated record must preserve its original filename.");

const legacyFile = await provider.getAssetFile(legacyId, "legacy-scope");
assert(legacyFile.ok, "migrated asset's file should still be readable at its original storage path.");

// A brand-new asset through the real provider (base64 of "hello").
const dataUrl = `data:text/plain;base64,${Buffer.from("hello").toString("base64")}`;
const putResult = await provider.putAsset({ ownerScope: "new-scope", dataUrl, originalName: "note.txt" });
assert(putResult.ok, "putAsset should succeed for a valid data URL.");
if (putResult.ok) {
  const fileResult = await provider.getAssetFile(putResult.asset.id, "new-scope");
  assert(fileResult.ok, "a freshly-put asset's file should be readable back.");
  const deleted = await provider.deleteAsset(putResult.asset.id, "new-scope");
  assert(deleted, "deleteAsset should succeed for an asset that exists.");
  const afterDelete = await provider.getAssetFile(putResult.asset.id, "new-scope");
  assert(!afterDelete.ok, "a deleted asset's file must no longer be readable.");
}

const oversized = `data:text/plain;base64,${Buffer.alloc(13 * 1024 * 1024).toString("base64")}`;
const oversizedResult = await provider.putAsset({ ownerScope: "new-scope", dataUrl: oversized });
assert(!oversizedResult.ok && oversizedResult.error === "file_too_large", "oversized uploads must be rejected.");

await rm(tempStateDir, { recursive: true, force: true });

console.log("content-asset-storage.ts: all checks passed.");
console.log(JSON.stringify({ ok: true, suites: ["asset-db", "content-asset-storage"] }, null, 2));
