/* Asset Vault Stage 9 — admin diagnostics + repair tools. Real filesystem
   in a temp dir, real in-memory SQLite index, real ffmpeg where dimension/
   thumbnail behavior is asserted (already confirmed available earlier in
   this test suite family — see test-asset-ingest.ts). */
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

const tempStateDir = await mkdtemp(path.join(os.tmpdir(), "phantomforce-admin-diagnostics-test-"));
process.env.PHANTOMFORCE_CONTENT_ASSET_DIR = tempStateDir;
await mkdir(path.join(tempStateDir, "files"), { recursive: true });

const { resetAssetDbForTests, insertAsset, getAssetById } = await import("../src/phantom-ai/asset-db.js");
const { findDuplicateGroups, reindexAsset, importFolder, MAX_FOLDER_IMPORT_FILES } = await import(
  "../src/phantom-ai/asset-admin-diagnostics.js"
);

resetAssetDbForTests();

// ---- duplicate detection ------------------------------------------------------------

const sharedBytes = Buffer.from("identical content across two rows");
const sharedHash = createHash("sha256").update(sharedBytes).digest("hex");

const dupOne = insertAsset({
  ownerScope: "scope-a",
  assetType: "image",
  originalName: "first-copy.jpg",
  mimeType: "image/jpeg",
  fileSizeBytes: sharedBytes.byteLength,
  contentHash: sharedHash,
  storageProvider: "local-disk",
  storageKey: "dup-one-key",
});
const dupTwo = insertAsset({
  ownerScope: "scope-a",
  assetType: "image",
  originalName: "second-copy.jpg",
  mimeType: "image/jpeg",
  fileSizeBytes: sharedBytes.byteLength,
  contentHash: sharedHash,
  storageProvider: "local-disk",
  storageKey: "dup-two-key",
});
const unique = insertAsset({
  ownerScope: "scope-a",
  assetType: "image",
  originalName: "unique.jpg",
  mimeType: "image/jpeg",
  fileSizeBytes: 5,
  contentHash: createHash("sha256").update("something else entirely").digest("hex"),
  storageProvider: "local-disk",
  storageKey: "unique-key",
});
const otherScopeDup = insertAsset({
  ownerScope: "scope-b",
  assetType: "image",
  originalName: "other-scope.jpg",
  mimeType: "image/jpeg",
  fileSizeBytes: sharedBytes.byteLength,
  contentHash: sharedHash, // same bytes, but a different owner_scope entirely
  storageProvider: "local-disk",
  storageKey: "other-scope-key",
});

const groups = findDuplicateGroups("scope-a");
assert(groups.length === 1, "exactly one duplicate group should be found in scope-a.");
assert(groups[0].content_hash === sharedHash, "the duplicate group should be keyed by the shared content hash.");
const groupIds = groups[0].assets.map((a) => a.id).sort();
assert(
  JSON.stringify(groupIds) === JSON.stringify([dupOne.id, dupTwo.id].sort()),
  "the duplicate group should contain exactly the two rows sharing that hash, not the unique one.",
);
assert(
  !groups[0].assets.some((a) => a.id === otherScopeDup.id),
  "duplicate detection must never cross owner_scope boundaries, even with identical bytes/hash.",
);
assert(!groups[0].assets.some((a) => a.id === unique.id), "a hash with only one row must not appear as a duplicate group.");

console.log("duplicate detection: all passed.");

// ---- reindex -------------------------------------------------------------------------

const filesDir = path.join(tempStateDir, "files");
const reindexBytes = Buffer.from("bytes for a legacy asset missing its content_hash");
await writeFile(path.join(filesDir, "legacy-key"), reindexBytes);
const legacyAsset = insertAsset({
  ownerScope: "scope-a",
  assetType: "image",
  originalName: "legacy.jpg",
  mimeType: "image/jpeg",
  fileSizeBytes: reindexBytes.byteLength,
  storageProvider: "local-disk",
  storageKey: "legacy-key",
  // no contentHash — simulates a pre-Stage-4 legacy-migrated row
});
assert(legacyAsset.content_hash === null, "sanity check: the legacy row should start with no content_hash.");

const reindexOutcome = await reindexAsset(legacyAsset.id, "scope-a");
assert(reindexOutcome.ok, "reindexAsset should succeed for a real local-disk asset.");
const afterReindex = getAssetById(legacyAsset.id, "scope-a");
assert(
  afterReindex!.content_hash === createHash("sha256").update(reindexBytes).digest("hex"),
  "reindexAsset should compute and store the real sha256 of the actual file, exactly like initial ingestion does.",
);

const reindexMissing = await reindexAsset("does-not-exist", "scope-a");
assert(!reindexMissing.ok && reindexMissing.error === "not_found", "reindexing a nonexistent asset id must fail honestly.");

console.log("reindex: all passed.");

// ---- folder import ---------------------------------------------------------------------

const importSourceDir = await mkdtemp(path.join(os.tmpdir(), "phantomforce-import-source-"));
await writeFile(path.join(importSourceDir, "photo-a.jpg"), Buffer.from("photo a bytes"));
await writeFile(path.join(importSourceDir, "photo-b.png"), Buffer.from("photo b bytes"));
await writeFile(path.join(importSourceDir, "notes.txt"), Buffer.from("not an importable media type"));
await writeFile(path.join(importSourceDir, "photo-a-duplicate.jpg"), Buffer.from("photo a bytes")); // identical bytes to photo-a.jpg

const importOutcome = await importFolder("scope-import", importSourceDir, "cache");
assert(importOutcome.ok, "importFolder should succeed against a real, readable directory.");
if (importOutcome.ok) {
  const result = importOutcome.result;
  assert(result.scanned === 4, "importFolder should scan every real file in the directory.");
  assert(result.imported === 2, "only the two distinct real media files should be imported (photo-a.jpg, photo-b.png).");
  assert(result.skippedUnsupported === 1, "notes.txt must be skipped as an unsupported type, not imported as fake media.");
  assert(result.skippedDuplicate === 1, "photo-a-duplicate.jpg has identical bytes to photo-a.jpg and must be skipped as a duplicate.");
  assert(result.importedAssetIds.length === 2, "importedAssetIds should list exactly the imported assets.");

  const { listAssetsByOwnerScope } = await import("../src/phantom-ai/asset-db.js");
  const imported = listAssetsByOwnerScope("scope-import");
  assert(imported.length === 2, "the imported assets should actually be queryable from the real index afterward.");
  assert(
    imported.every((a) => a.content_hash && a.width !== undefined),
    "imported assets should have gone through the real ingestion pipeline (content_hash set).",
  );
}

const importMissingFolder = await importFolder("scope-import", path.join(importSourceDir, "does-not-exist"), "cache");
assert(!importMissingFolder.ok && importMissingFolder.error === "folder_not_found", "importing a nonexistent folder must fail honestly, not silently report zero scanned.");

assert(MAX_FOLDER_IMPORT_FILES > 0, "the folder-import cap should be a real positive bound, not unset/zero.");

console.log("folder import: all passed.");

await rm(tempStateDir, { recursive: true, force: true });
await rm(importSourceDir, { recursive: true, force: true });

console.log(JSON.stringify({ ok: true, suite: "asset-admin-diagnostics" }, null, 2));
