/* PhantomForce — Asset Vault Stage 9: admin diagnostics + repair tools.

   Bulk integrity validation, duplicate detection, re-indexing, and local
   folder import — all real operations over the real index/filesystem, all
   gated at the route level to admin sessions only (see requireAdminAccessSession
   in index.ts), since folder import in particular reads arbitrary local
   server paths. Nothing here is a dry summary of what "would" happen
   unless explicitly named preview/scan; every write path really writes. */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { contentAssetDerivedDir, contentAssetFilesDir } from "./content-asset-storage.js";
import { ingestAsset } from "./asset-ingest.js";
import { verifyAssetIntegrity } from "./asset-cache-manager.js";
import {
  findAssetByContentHash,
  getAssetById,
  insertAsset,
  listAssetsByOwnerScope,
  type AssetRecord,
  type AssetTier,
} from "./asset-db.js";

// ---- bulk integrity validation ------------------------------------------------------

export type IntegrityReport = {
  checked: number;
  ok: number;
  failed: Array<{ id: string; original_name: string; reason: string }>;
};

export async function runIntegrityValidation(ownerScope: string): Promise<IntegrityReport> {
  const assets = listAssetsByOwnerScope(ownerScope).filter((asset) => asset.storage_provider === "local-disk");
  const failed: IntegrityReport["failed"] = [];
  let ok = 0;
  for (const asset of assets) {
    const result = await verifyAssetIntegrity(asset);
    if (result.ok) ok += 1;
    else failed.push({ id: asset.id, original_name: asset.original_name, reason: result.reason || "unknown" });
  }
  return { checked: assets.length, ok, failed };
}

// ---- duplicate detection ------------------------------------------------------------
// True content duplicates (same sha256) that survived independently of the
// upload-time dedup in content-asset-storage.ts — e.g. assets migrated
// from the pre-Stage-4 legacy index, before content_hash existed.

export type DuplicateGroup = { content_hash: string; assets: AssetRecord[] };

export function findDuplicateGroups(ownerScope: string): DuplicateGroup[] {
  const assets = listAssetsByOwnerScope(ownerScope);
  const byHash = new Map<string, AssetRecord[]>();
  for (const asset of assets) {
    if (!asset.content_hash) continue;
    const list = byHash.get(asset.content_hash);
    if (list) list.push(asset);
    else byHash.set(asset.content_hash, [asset]);
  }
  const groups: DuplicateGroup[] = [];
  for (const [contentHash, list] of byHash) {
    if (list.length > 1) groups.push({ content_hash: contentHash, assets: list });
  }
  return groups;
}

// ---- re-index ------------------------------------------------------------------------
// Re-runs the real Stage 4 ingestion pass (hash/dimensions/derivatives) on
// an asset that already exists — useful for legacy-migrated assets that
// predate content_hash, or assets ingested before ffmpeg was available.

export async function reindexAsset(
  assetId: string,
  ownerScope: string,
): Promise<{ ok: true; result: Awaited<ReturnType<typeof ingestAsset>> } | { ok: false; error: string }> {
  const asset = getAssetById(assetId, ownerScope);
  if (!asset) return { ok: false, error: "not_found" };
  if (asset.storage_provider !== "local-disk") return { ok: false, error: "not_local_disk" };

  const sourcePath = path.join(contentAssetFilesDir(), asset.storage_key);
  try {
    const result = await ingestAsset({
      assetId: asset.id,
      ownerScope,
      assetType: asset.asset_type,
      mimeType: asset.mime_type,
      sourcePath,
      derivedDir: contentAssetDerivedDir(),
    });
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// ---- local folder import --------------------------------------------------------------
// A flat (non-recursive) scan of one real local directory on this server's
// machine — admin-only by design (see requireAdminAccessSession at the
// route). Bounded at MAX_FOLDER_IMPORT_FILES per call so a huge folder
// can't run unbounded; anything beyond the cap is honestly reported as
// skippedOverLimit, never silently dropped.

const IMPORTABLE_EXTENSIONS: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
};

export const MAX_FOLDER_IMPORT_FILES = 500;

export type FolderImportResult = {
  scanned: number;
  imported: number;
  skippedDuplicate: number;
  skippedUnsupported: number;
  skippedOverLimit: number;
  importedAssetIds: string[];
};

function inferAssetType(mimeType: string): string {
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "image";
}

export async function importFolder(
  ownerScope: string,
  folderPath: string,
  tier: AssetTier = "cache",
): Promise<{ ok: true; result: FolderImportResult } | { ok: false; error: string }> {
  let entries: string[];
  try {
    entries = await readdir(folderPath);
  } catch {
    return { ok: false, error: "folder_not_found" };
  }

  const result: FolderImportResult = {
    scanned: 0,
    imported: 0,
    skippedDuplicate: 0,
    skippedUnsupported: 0,
    skippedOverLimit: 0,
    importedAssetIds: [],
  };
  const filesDir = contentAssetFilesDir();
  await mkdir(filesDir, { recursive: true });

  for (const name of entries) {
    const fullPath = path.join(folderPath, name);
    let stats;
    try {
      stats = await stat(fullPath);
    } catch {
      continue;
    }
    if (!stats.isFile()) continue;
    result.scanned += 1;

    const ext = path.extname(name).toLowerCase();
    const mimeType = IMPORTABLE_EXTENSIONS[ext];
    if (!mimeType) {
      result.skippedUnsupported += 1;
      continue;
    }
    if (result.imported >= MAX_FOLDER_IMPORT_FILES) {
      result.skippedOverLimit += 1;
      continue;
    }

    const buffer = await readFile(fullPath);
    const contentHash = createHash("sha256").update(buffer).digest("hex");
    if (findAssetByContentHash(ownerScope, contentHash)) {
      result.skippedDuplicate += 1;
      continue;
    }

    const id = randomUUID();
    const destPath = path.join(filesDir, id);
    await writeFile(destPath, buffer);
    const assetType = inferAssetType(mimeType);
    const now = new Date();
    insertAsset({
      id,
      ownerScope,
      assetType,
      originalName: name,
      mimeType,
      extension: ext.replace(/^\./, ""),
      fileSizeBytes: buffer.byteLength,
      contentHash,
      storageProvider: "local-disk",
      storageKey: id,
      tier,
      createdAt: now.toISOString(),
      expiresAt: tier === "cache" ? new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString() : null,
    });
    await ingestAsset({ assetId: id, ownerScope, assetType, mimeType, sourcePath: destPath, derivedDir: contentAssetDerivedDir() });
    result.imported += 1;
    result.importedAssetIds.push(id);
  }

  return { ok: true, result };
}
