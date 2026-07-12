/* PhantomForce — content asset storage.
   A small pluggable interface so photos/videos created in Content Hub can
   sync across devices instead of living only in one browser's localStorage.
   Today there is exactly one provider: local disk on this same machine
   (server/.local/content-assets). A future provider (e.g. Google Drive, via
   the real Drive API/OAuth — never scraped credentials or a stored
   password) can implement the same ContentAssetStorageProvider interface
   and be swapped in later without touching any caller.

   Asset Vault Stage 2: the bookkeeping behind this provider moved from a
   flat index.json file to a real SQLite index (./asset-db.ts) so assets
   get tags, collections, and indexed queries — but this module's own
   public shape (ContentAssetRecord, ContentAssetStorageProvider, and every
   exported function) is unchanged, so no caller (Content Hub, Media Lab,
   the HTTP routes in index.ts) needs to change to keep working.

   Every asset defaults to the existing 30-day expiry ("cache" tier) unless
   a caller explicitly asks for permanent ("vault") storage — nothing that
   was subject to expiry before silently becomes permanent, and nothing
   requests vault storage today, so real-world behavior for existing
   callers is unchanged. */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import {
  deleteAssetById,
  deleteExpiredCacheAssets,
  findAssetByContentHash,
  getAssetById,
  insertAsset,
  listAssetsByOwnerScope,
  listDerivativesForAsset,
  touchAssetAccess,
  type AssetRecord,
  type AssetTier,
  type DerivativeKind,
  type DerivativeRecord,
} from "./asset-db.js";
import { ingestAsset, sha256File } from "./asset-ingest.js";

const RETENTION_DAYS = 30;
const DEFAULT_STATE_DIR = path.join(process.cwd(), ".local", "content-assets");
const STATE_DIR = process.env.PHANTOMFORCE_CONTENT_ASSET_DIR ?? DEFAULT_STATE_DIR;
const FILES_DIR = path.join(STATE_DIR, "files");
const DERIVED_DIR = path.join(STATE_DIR, "derived");
// Pre-Stage-2 index. Read once (lazily, on first real operation) to
// backfill the SQLite index, then left on disk untouched as a reversible
// fallback — never written to or deleted by this module again.
const LEGACY_INDEX_FILE = path.join(STATE_DIR, "index.json");
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024; // generous for one edited photo, blocks abuse

export type ContentAssetRecord = {
  id: string;
  owner_scope: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  expires_at: string;
};

function toContentAssetRecord(asset: AssetRecord): ContentAssetRecord {
  return {
    id: asset.id,
    owner_scope: asset.owner_scope,
    original_name: asset.original_name,
    mime_type: asset.mime_type,
    size_bytes: asset.file_size_bytes,
    // Only a "vault" tier asset has no expiry, and nothing creates one via
    // this provider today (tier defaults to "cache" below) — this empty
    // string is a placeholder for when a "promote to vault" path exists,
    // not something today's real usage ever hits.
    created_at: asset.created_at,
    expires_at: asset.expires_at ?? "",
  };
}

function inferAssetType(mimeType: string): string {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "file";
}

function parseDataUrl(dataUrl: string): { mimeType: string; buffer: Buffer } | null {
  const match = /^data:([\w./+-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  try {
    return { mimeType: match[1], buffer: Buffer.from(match[2], "base64") };
  } catch {
    return null;
  }
}

// Runs once per server process. Idempotent by design (checks each legacy
// record against the new index by id+owner_scope before inserting), so a
// restart after a partially-completed migration never double-inserts.
let migrationAttempted = false;
async function ensureMigratedFromLegacyIndex() {
  if (migrationAttempted) return;
  migrationAttempted = true;
  let raw: string;
  try {
    raw = await readFile(LEGACY_INDEX_FILE, "utf8");
  } catch {
    return; // no legacy index — fresh install, nothing to migrate
  }
  let records: Array<Record<string, unknown>>;
  try {
    const parsed = JSON.parse(raw) as { records?: unknown };
    records = Array.isArray(parsed.records) ? (parsed.records as Array<Record<string, unknown>>) : [];
  } catch {
    return;
  }
  for (const legacy of records) {
    const id = typeof legacy.id === "string" ? legacy.id : null;
    const ownerScope = typeof legacy.owner_scope === "string" ? legacy.owner_scope : null;
    if (!id || !ownerScope) continue;
    if (getAssetById(id, ownerScope)) continue; // already migrated in a prior run
    const mimeType = typeof legacy.mime_type === "string" ? legacy.mime_type : "application/octet-stream";
    insertAsset({
      id,
      ownerScope,
      assetType: inferAssetType(mimeType),
      originalName: typeof legacy.original_name === "string" ? legacy.original_name : "content-asset",
      mimeType,
      fileSizeBytes: typeof legacy.size_bytes === "number" ? legacy.size_bytes : 0,
      storageProvider: "local-disk",
      storageKey: id, // legacy files live at FILES_DIR/<id> — same convention this provider still uses
      tier: "cache",
      legacySyncedId: id,
      createdAt: typeof legacy.created_at === "string" ? legacy.created_at : undefined,
      expiresAt: typeof legacy.expires_at === "string" ? legacy.expires_at : null,
    });
  }
}

export interface ContentAssetStorageProvider {
  putAsset(input: {
    ownerScope: string;
    dataUrl: string;
    originalName?: string;
    // Additive, optional metadata — Stage 2 groundwork for richer callers.
    // Every field defaults sensibly when omitted, so existing callers
    // (which pass none of these) are unaffected.
    assetType?: string;
    title?: string;
    description?: string;
    source?: string;
    provider?: string;
    model?: string;
    style?: string;
    aspect?: string;
    durationSeconds?: number;
    tier?: AssetTier;
  }): Promise<{ ok: true; asset: ContentAssetRecord } | { ok: false; error: string }>;
  getAssetFile(
    id: string,
    ownerScope: string,
  ): Promise<{ ok: true; dataUrl: string; asset: ContentAssetRecord } | { ok: false; error: string }>;
  listAssets(ownerScope: string): Promise<ContentAssetRecord[]>;
  deleteAsset(id: string, ownerScope: string): Promise<boolean>;
  deleteExpiredAssets(): Promise<{ deletedCount: number }>;
  // Stage 4: ingestion-produced thumbnails/proxies/waveforms. Empty array
  // (not an error) when ffmpeg wasn't available at ingest time.
  listDerivatives(id: string, ownerScope: string): Promise<DerivativeRecord[]>;
  getDerivativeFile(
    id: string,
    ownerScope: string,
    kind: DerivativeKind,
  ): Promise<{ ok: true; dataUrl: string; derivative: DerivativeRecord } | { ok: false; error: string }>;
}

class LocalDiskContentAssetProvider implements ContentAssetStorageProvider {
  async putAsset(input: Parameters<ContentAssetStorageProvider["putAsset"]>[0]) {
    const parsed = parseDataUrl(input.dataUrl);
    if (!parsed) return { ok: false as const, error: "invalid_data_url" };
    if (parsed.buffer.byteLength > MAX_UPLOAD_BYTES) return { ok: false as const, error: "file_too_large" };
    await ensureMigratedFromLegacyIndex();

    // Real content-addressed dedup: identical bytes already stored for this
    // owner_scope return the existing asset rather than writing a second
    // copy of the file and a second index row.
    const contentHash = createHash("sha256").update(parsed.buffer).digest("hex");
    const existing = findAssetByContentHash(input.ownerScope, contentHash);
    if (existing) return { ok: true as const, asset: toContentAssetRecord(existing) };

    const id = randomUUID();
    const now = new Date();
    const originalName = (input.originalName || "content-asset").slice(0, 160);
    const extension = path.extname(originalName).replace(/^\./, "") || null;
    const tier: AssetTier = input.tier ?? "cache";
    const expiresAt = tier === "cache" ? new Date(now.getTime() + RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString() : null;
    const assetType = input.assetType ?? inferAssetType(parsed.mimeType);

    await mkdir(FILES_DIR, { recursive: true });
    const sourcePath = path.join(FILES_DIR, id);
    await writeFile(sourcePath, parsed.buffer);

    insertAsset({
      id,
      ownerScope: input.ownerScope,
      assetType,
      originalName,
      title: input.title ?? null,
      description: input.description ?? null,
      source: input.source ?? null,
      provider: input.provider ?? null,
      model: input.model ?? null,
      style: input.style ?? null,
      aspect: input.aspect ?? null,
      durationSeconds: input.durationSeconds ?? null,
      mimeType: parsed.mimeType,
      extension,
      fileSizeBytes: parsed.buffer.byteLength,
      contentHash,
      storageProvider: "local-disk",
      storageKey: id,
      tier,
      createdAt: now.toISOString(),
      expiresAt,
    });

    // Real ffprobe/ffmpeg pass: fills in width/height/duration and generates
    // whatever derivative makes sense for this asset type. Awaited so the
    // asset record returned to the caller already reflects real metadata
    // rather than nulls that only get filled in later.
    await ingestAsset({
      assetId: id,
      ownerScope: input.ownerScope,
      assetType,
      mimeType: parsed.mimeType,
      sourcePath,
      derivedDir: DERIVED_DIR,
    });

    const finalAsset = getAssetById(id, input.ownerScope) as AssetRecord;
    return { ok: true as const, asset: toContentAssetRecord(finalAsset) };
  }

  async getAssetFile(id: string, ownerScope: string) {
    await ensureMigratedFromLegacyIndex();
    const asset = getAssetById(id, ownerScope);
    if (!asset) return { ok: false as const, error: "not_found" };
    try {
      const buffer = await readFile(path.join(FILES_DIR, asset.storage_key));
      touchAssetAccess(id, ownerScope); // real LRU signal for the Stage 3 cache manager
      return {
        ok: true as const,
        dataUrl: `data:${asset.mime_type};base64,${buffer.toString("base64")}`,
        asset: toContentAssetRecord(asset),
      };
    } catch {
      return { ok: false as const, error: "file_missing" };
    }
  }

  async listAssets(ownerScope: string) {
    await ensureMigratedFromLegacyIndex();
    return listAssetsByOwnerScope(ownerScope).map(toContentAssetRecord);
  }

  async deleteAsset(id: string, ownerScope: string) {
    await ensureMigratedFromLegacyIndex();
    const asset = getAssetById(id, ownerScope);
    if (!asset) return false;
    // Captured before the delete: the FK cascade removes the derivative DB
    // rows automatically, but the derivative *files* on disk are only
    // cleaned up here, using the storage keys we just read.
    const derivatives = listDerivativesForAsset(id);
    const deleted = deleteAssetById(id, ownerScope);
    if (deleted) {
      await unlink(path.join(FILES_DIR, asset.storage_key)).catch(() => {});
      await Promise.all(derivatives.map((d) => unlink(path.join(DERIVED_DIR, d.storage_key)).catch(() => {})));
    }
    return deleted;
  }

  async deleteExpiredAssets() {
    await ensureMigratedFromLegacyIndex();
    const { deletedCount, deletedStorageKeys } = deleteExpiredCacheAssets();
    await Promise.all(deletedStorageKeys.map((key) => unlink(path.join(FILES_DIR, key)).catch(() => {})));
    return { deletedCount };
  }

  async listDerivatives(id: string, ownerScope: string) {
    const asset = getAssetById(id, ownerScope);
    if (!asset) return [];
    return listDerivativesForAsset(id);
  }

  async getDerivativeFile(id: string, ownerScope: string, kind: DerivativeKind) {
    const asset = getAssetById(id, ownerScope);
    if (!asset) return { ok: false as const, error: "not_found" };
    const derivative = listDerivativesForAsset(id).find((d) => d.kind === kind);
    if (!derivative) return { ok: false as const, error: "derivative_not_found" };
    try {
      const buffer = await readFile(path.join(DERIVED_DIR, derivative.storage_key));
      return { ok: true as const, dataUrl: `data:${derivative.mime_type};base64,${buffer.toString("base64")}`, derivative };
    } catch {
      return { ok: false as const, error: "file_missing" };
    }
  }
}

const localDiskProvider = new LocalDiskContentAssetProvider();

// Only "local-disk" exists today. A future "google-drive" provider (real
// Drive API/OAuth, never scraped credentials) implements the same
// interface and gets selected here — callers never change.
export function getContentAssetStorageProvider(): ContentAssetStorageProvider {
  return localDiskProvider;
}

export const CONTENT_ASSET_RETENTION_DAYS = RETENTION_DAYS;

// Exposed for asset-cache-manager.ts — the real file storage location this
// provider uses, needed for orphan/corruption detection and eviction.
export function contentAssetFilesDir(): string {
  return FILES_DIR;
}

// Exposed for admin/diagnostic tooling (Stage 9) — the real derivative
// storage location, parallel to contentAssetFilesDir() above.
export function contentAssetDerivedDir(): string {
  return DERIVED_DIR;
}
