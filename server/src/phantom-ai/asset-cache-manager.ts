/* PhantomForce — Asset Vault Stage 3: cache manager.

   Real operations over the actual SQLite index and the actual files on
   disk — no simulated statistics, no decorative progress. Every function
   here either queries the real database or touches the real filesystem.

   Hard rule enforced throughout: a "vault"-tier asset is never evicted and
   never counted as an eviction candidate, no matter its expires_at or
   quota pressure — only "cache"-tier, unpinned assets are ever removable
   by this module. */

import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { contentAssetFilesDir } from "./content-asset-storage.js";
import {
  deleteAssetById,
  getAssetDb,
  getCacheStats,
  listAllStorageKeys,
  listEvictionCandidates,
  type AssetRecord,
  type CacheStats,
} from "./asset-db.js";

export type { CacheStats };
export { getCacheStats };

// Files present on disk with no matching database row under any owner_scope
// — real orphans, found by actually reading the directory and diffing
// against the real index, not guessed at.
export async function findOrphanFiles(): Promise<string[]> {
  const dir = contentAssetFilesDir();
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const known = new Set(listAllStorageKeys("local-disk"));
  return entries.filter((name) => !known.has(name));
}

// Database rows whose file is missing from disk — real, checked with an
// actual stat() call per row, not inferred.
export async function findMissingFiles(ownerScope?: string): Promise<AssetRecord[]> {
  const db = getAssetDb();
  const rows = (
    ownerScope
      ? db.prepare(`SELECT * FROM assets WHERE storage_provider = 'local-disk' AND owner_scope = ?`).all(ownerScope)
      : db.prepare(`SELECT * FROM assets WHERE storage_provider = 'local-disk'`).all()
  ) as any[];
  const dir = contentAssetFilesDir();
  const missing: AssetRecord[] = [];
  for (const row of rows) {
    try {
      await stat(path.join(dir, row.storage_key));
    } catch {
      missing.push(row);
    }
  }
  return missing;
}

// Real hash verification: re-reads the file and re-hashes it, comparing to
// the stored content_hash. If no content_hash was ever recorded (pre-Stage-4
// assets), this can only confirm the file is readable, not that it's
// unmodified — that distinction is returned explicitly, never blurred.
export async function verifyAssetIntegrity(
  asset: AssetRecord,
): Promise<{ ok: boolean; checked: "hash" | "readable-only"; reason?: string }> {
  const dir = contentAssetFilesDir();
  let buffer: Buffer;
  try {
    buffer = await readFile(path.join(dir, asset.storage_key));
  } catch {
    return { ok: false, checked: "readable-only", reason: "file_missing_or_unreadable" };
  }
  if (!asset.content_hash) {
    return { ok: true, checked: "readable-only" };
  }
  const actualHash = createHash("sha256").update(buffer).digest("hex");
  if (actualHash !== asset.content_hash) {
    return { ok: false, checked: "hash", reason: "hash_mismatch" };
  }
  return { ok: true, checked: "hash" };
}

export type CleanupPreview = {
  candidateCount: number;
  wouldFreeBytes: number;
  assets: Array<{
    id: string;
    original_name: string;
    file_size_bytes: number;
    last_accessed_at: string | null;
    storage_key: string;
  }>;
};

// Preview only — never deletes anything. Shows exactly what a real cleanup
// would remove, in the exact order it would remove them, so a caller (the
// admin UI) can show a safe "this is what will be deleted" screen before
// anything actually happens.
export function previewCleanup(ownerScope: string, targetFreeBytes: number): CleanupPreview {
  const candidates = listEvictionCandidates(ownerScope);
  const assets: CleanupPreview["assets"] = [];
  let freed = 0;
  for (const asset of candidates) {
    if (freed >= targetFreeBytes) break;
    assets.push({
      id: asset.id,
      original_name: asset.original_name,
      file_size_bytes: asset.file_size_bytes,
      last_accessed_at: asset.last_accessed_at,
      storage_key: asset.storage_key,
    });
    freed += asset.file_size_bytes;
  }
  return { candidateCount: assets.length, wouldFreeBytes: freed, assets };
}

export type CleanupResult = { deletedCount: number; freedBytes: number; deletedIds: string[] };

// Actually deletes — cache-tier, unpinned, least-recently-used first, only
// as many as needed to free targetFreeBytes. Deletes the real file too, not
// just the index row.
export async function runCleanup(ownerScope: string, targetFreeBytes: number): Promise<CleanupResult> {
  const preview = previewCleanup(ownerScope, targetFreeBytes);
  const dir = contentAssetFilesDir();
  const deletedIds: string[] = [];
  let freedBytes = 0;
  for (const item of preview.assets) {
    const deleted = deleteAssetById(item.id, ownerScope);
    if (!deleted) continue;
    await unlink(path.join(dir, item.storage_key)).catch(() => {});
    deletedIds.push(item.id);
    freedBytes += item.file_size_bytes;
  }
  return { deletedCount: deletedIds.length, freedBytes, deletedIds };
}
