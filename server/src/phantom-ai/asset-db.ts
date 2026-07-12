/* PhantomForce — Asset Vault Stage 2: Unified Asset Model.

   The queryable index behind content-asset-storage.ts. Previously that
   module kept its own bookkeeping in a flat index.json file; this module
   replaces that bookkeeping with a real SQLite database (node:sqlite —
   built into Node 22+, confirmed working here, zero new dependency) so
   assets get tags, collections, and owner_scope-indexed queries.

   content-asset-storage.ts's actual file storage (server/.local/content-
   assets/files/<id>) is untouched by this module — this only owns the
   metadata index, exactly like index.json did before it.

   owner_scope is carried over verbatim from whatever
   contentAssetOwnerScope() in server/src/index.ts already computes today
   (workspace tenant id for admin sessions, session.clientId for restricted
   client sessions) — this module does not reinterpret or replace that
   access-control logic, only indexes by it. */

import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";

const DEFAULT_DB_PATH = path.join(process.cwd(), ".local", "content-assets", "asset-vault.db");
const DB_PATH = process.env.PHANTOMFORCE_ASSET_DB_PATH ?? DEFAULT_DB_PATH;

export type AssetTier = "vault" | "cache";

export type AssetRecord = {
  id: string;
  owner_scope: string;
  asset_type: string;
  original_name: string;
  title: string | null;
  description: string | null;
  source: string | null;
  provider: string | null;
  model: string | null;
  style: string | null;
  aspect: string | null;
  duration_seconds: number | null;
  mime_type: string;
  extension: string | null;
  file_size_bytes: number;
  width: number | null;
  height: number | null;
  content_hash: string | null;
  storage_provider: string;
  storage_key: string;
  tier: AssetTier;
  favorite: boolean;
  archived: boolean;
  pinned: boolean;
  availability: AssetAvailability;
  cloud_provider: string | null;
  cloud_key: string | null;
  legacy_synced_id: string | null;
  created_at: string;
  updated_at: string;
  last_accessed_at: string | null;
  expires_at: string | null;
};

export type AssetAvailability = "local" | "cloud" | "local_and_cloud" | "syncing" | "downloading" | "uploading" | "missing" | "corrupted";

// SQLite has no boolean type; this module's public shape uses real
// booleans, rows on the wire use 0/1 — these two helpers are the only
// place that distinction should ever need to be handled.
function rowToAsset(row: any): AssetRecord {
  return {
    id: row.id,
    owner_scope: row.owner_scope,
    asset_type: row.asset_type,
    original_name: row.original_name,
    title: row.title,
    description: row.description,
    source: row.source,
    provider: row.provider,
    model: row.model,
    style: row.style,
    aspect: row.aspect,
    duration_seconds: row.duration_seconds,
    mime_type: row.mime_type,
    extension: row.extension,
    file_size_bytes: row.file_size_bytes,
    width: row.width,
    height: row.height,
    content_hash: row.content_hash,
    storage_provider: row.storage_provider,
    storage_key: row.storage_key,
    tier: row.tier,
    favorite: row.favorite === 1,
    archived: row.archived === 1,
    pinned: row.pinned === 1,
    availability: row.availability,
    cloud_provider: row.cloud_provider,
    cloud_key: row.cloud_key,
    legacy_synced_id: row.legacy_synced_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_accessed_at: row.last_accessed_at,
    expires_at: row.expires_at,
  };
}

// Single shared schema for both the real on-disk database and the in-memory
// test database — the two were previously defined twice and had already
// drifted out of sync once; this is the fix, not just a style preference.
const SCHEMA_SQL = `
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      owner_scope TEXT NOT NULL,
      asset_type TEXT NOT NULL,
      original_name TEXT NOT NULL,
      title TEXT,
      description TEXT,
      source TEXT,
      provider TEXT,
      model TEXT,
      style TEXT,
      aspect TEXT,
      duration_seconds REAL,
      mime_type TEXT NOT NULL,
      extension TEXT,
      file_size_bytes INTEGER NOT NULL,
      width INTEGER,
      height INTEGER,
      content_hash TEXT,
      storage_provider TEXT NOT NULL,
      storage_key TEXT NOT NULL,
      tier TEXT NOT NULL DEFAULT 'cache',
      favorite INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      pinned INTEGER NOT NULL DEFAULT 0,
      availability TEXT NOT NULL DEFAULT 'local',
      cloud_provider TEXT,
      cloud_key TEXT,
      legacy_synced_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_accessed_at TEXT,
      expires_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_assets_owner_scope ON assets(owner_scope);
    CREATE INDEX IF NOT EXISTS idx_assets_content_hash ON assets(content_hash);

    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      owner_scope TEXT NOT NULL,
      name TEXT NOT NULL,
      UNIQUE(owner_scope, name)
    );
    CREATE TABLE IF NOT EXISTS asset_tags (
      asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (asset_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS collections (
      id TEXT PRIMARY KEY,
      owner_scope TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS collection_assets (
      collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      PRIMARY KEY (collection_id, asset_id)
    );

    CREATE TABLE IF NOT EXISTS asset_derivatives (
      id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      storage_key TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      file_size_bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(asset_id, kind)
    );
    CREATE INDEX IF NOT EXISTS idx_asset_derivatives_asset_id ON asset_derivatives(asset_id);

    CREATE TABLE IF NOT EXISTS presets (
      id TEXT PRIMARY KEY,
      owner_scope TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      kind TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      definition TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_presets_owner_scope ON presets(owner_scope);
`;

let dbInstance: DatabaseSync | null = null;

export function getAssetDb(): DatabaseSync {
  if (dbInstance) return dbInstance;
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
  dbInstance = new DatabaseSync(DB_PATH);
  dbInstance.exec(SCHEMA_SQL);
  return dbInstance;
}

// Test-only: point a fresh in-memory database at this module without
// touching the real on-disk vault. Uses the exact same schema as the real
// database (see SCHEMA_SQL) so tests can't silently drift from production.
export function resetAssetDbForTests(): DatabaseSync {
  dbInstance?.close();
  dbInstance = new DatabaseSync(":memory:");
  dbInstance.exec(SCHEMA_SQL);
  return dbInstance;
}

export type NewAssetInput = {
  id?: string;
  ownerScope: string;
  assetType: string;
  originalName: string;
  title?: string | null;
  description?: string | null;
  source?: string | null;
  provider?: string | null;
  model?: string | null;
  style?: string | null;
  aspect?: string | null;
  durationSeconds?: number | null;
  mimeType: string;
  extension?: string | null;
  fileSizeBytes: number;
  width?: number | null;
  height?: number | null;
  contentHash?: string | null;
  storageProvider: string;
  storageKey: string;
  tier?: AssetTier;
  legacySyncedId?: string | null;
  createdAt?: string;
  expiresAt?: string | null;
};

export function insertAsset(input: NewAssetInput): AssetRecord {
  const db = getAssetDb();
  const now = new Date().toISOString();
  const id = input.id ?? randomUUID();
  const createdAt = input.createdAt ?? now;
  const tier = input.tier ?? "cache";
  db.prepare(
    `INSERT INTO assets (
      id, owner_scope, asset_type, original_name, title, description, source, provider, model, style, aspect,
      duration_seconds, mime_type, extension, file_size_bytes, width, height, content_hash,
      storage_provider, storage_key, tier, favorite, archived, legacy_synced_id,
      created_at, updated_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)`,
  ).run(
    id,
    input.ownerScope,
    input.assetType,
    input.originalName,
    input.title ?? null,
    input.description ?? null,
    input.source ?? null,
    input.provider ?? null,
    input.model ?? null,
    input.style ?? null,
    input.aspect ?? null,
    input.durationSeconds ?? null,
    input.mimeType,
    input.extension ?? null,
    input.fileSizeBytes,
    input.width ?? null,
    input.height ?? null,
    input.contentHash ?? null,
    input.storageProvider,
    input.storageKey,
    tier,
    input.legacySyncedId ?? null,
    createdAt,
    now,
    input.expiresAt ?? null,
  );
  return getAssetById(id, input.ownerScope) as AssetRecord;
}

export function getAssetById(id: string, ownerScope: string): AssetRecord | null {
  const row = getAssetDb().prepare(`SELECT * FROM assets WHERE id = ? AND owner_scope = ?`).get(id, ownerScope);
  return row ? rowToAsset(row) : null;
}

export function listAssetsByOwnerScope(ownerScope: string): AssetRecord[] {
  const rows = getAssetDb()
    .prepare(`SELECT * FROM assets WHERE owner_scope = ? ORDER BY created_at DESC`)
    .all(ownerScope);
  return rows.map(rowToAsset);
}

export function deleteAssetById(id: string, ownerScope: string): boolean {
  const result = getAssetDb().prepare(`DELETE FROM assets WHERE id = ? AND owner_scope = ?`).run(id, ownerScope);
  return result.changes > 0;
}

// Only ever removes tier='cache' rows past their expiry — a 'vault' asset
// has no expires_at and can never match this query, by construction.
export function deleteExpiredCacheAssets(): { deletedCount: number; deletedIds: string[]; deletedStorageKeys: string[] } {
  const nowIso = new Date().toISOString();
  const rows = getAssetDb()
    .prepare(`SELECT id, storage_key FROM assets WHERE tier = 'cache' AND expires_at IS NOT NULL AND expires_at <= ?`)
    .all(nowIso) as Array<{ id: string; storage_key: string }>;
  if (!rows.length) return { deletedCount: 0, deletedIds: [], deletedStorageKeys: [] };
  const del = getAssetDb().prepare(`DELETE FROM assets WHERE id = ?`);
  for (const row of rows) del.run(row.id);
  return {
    deletedCount: rows.length,
    deletedIds: rows.map((r) => r.id),
    deletedStorageKeys: rows.map((r) => r.storage_key),
  };
}

export function findAssetByContentHash(ownerScope: string, contentHash: string): AssetRecord | null {
  const row = getAssetDb()
    .prepare(`SELECT * FROM assets WHERE owner_scope = ? AND content_hash = ? LIMIT 1`)
    .get(ownerScope, contentHash);
  return row ? rowToAsset(row) : null;
}

// ---- tags -------------------------------------------------------------------

export type TagRecord = { id: string; owner_scope: string; name: string };

export function upsertTag(ownerScope: string, name: string): TagRecord {
  const db = getAssetDb();
  const existing = db.prepare(`SELECT * FROM tags WHERE owner_scope = ? AND name = ?`).get(ownerScope, name) as
    | TagRecord
    | undefined;
  if (existing) return existing;
  const id = randomUUID();
  db.prepare(`INSERT INTO tags (id, owner_scope, name) VALUES (?, ?, ?)`).run(id, ownerScope, name);
  return { id, owner_scope: ownerScope, name };
}

export function tagAsset(assetId: string, ownerScope: string, tagName: string): TagRecord {
  const asset = getAssetById(assetId, ownerScope);
  if (!asset) throw new Error("asset_not_found");
  const tag = upsertTag(ownerScope, tagName);
  getAssetDb()
    .prepare(`INSERT OR IGNORE INTO asset_tags (asset_id, tag_id) VALUES (?, ?)`)
    .run(assetId, tag.id);
  return tag;
}

export function untagAsset(assetId: string, ownerScope: string, tagName: string): void {
  const db = getAssetDb();
  const tag = db.prepare(`SELECT id FROM tags WHERE owner_scope = ? AND name = ?`).get(ownerScope, tagName) as
    | { id: string }
    | undefined;
  if (!tag) return;
  db.prepare(`DELETE FROM asset_tags WHERE asset_id = ? AND tag_id = ?`).run(assetId, tag.id);
}

export function listTagsForAsset(assetId: string): TagRecord[] {
  return getAssetDb()
    .prepare(
      `SELECT tags.* FROM tags JOIN asset_tags ON asset_tags.tag_id = tags.id WHERE asset_tags.asset_id = ? ORDER BY tags.name`,
    )
    .all(assetId) as TagRecord[];
}

export function listAssetIdsForTag(ownerScope: string, tagName: string): string[] {
  const rows = getAssetDb()
    .prepare(
      `SELECT asset_tags.asset_id AS asset_id FROM asset_tags
       JOIN tags ON tags.id = asset_tags.tag_id
       WHERE tags.owner_scope = ? AND tags.name = ?`,
    )
    .all(ownerScope, tagName) as Array<{ asset_id: string }>;
  return rows.map((r) => r.asset_id);
}

// ---- collections ------------------------------------------------------------

export type CollectionRecord = { id: string; owner_scope: string; name: string; description: string | null; created_at: string };

export function createCollection(ownerScope: string, name: string, description?: string): CollectionRecord {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  getAssetDb()
    .prepare(`INSERT INTO collections (id, owner_scope, name, description, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(id, ownerScope, name, description ?? null, createdAt);
  return { id, owner_scope: ownerScope, name, description: description ?? null, created_at: createdAt };
}

export function listCollections(ownerScope: string): CollectionRecord[] {
  return getAssetDb()
    .prepare(`SELECT * FROM collections WHERE owner_scope = ? ORDER BY created_at DESC`)
    .all(ownerScope) as CollectionRecord[];
}

export function addAssetToCollection(collectionId: string, assetId: string, ownerScope: string): void {
  const db = getAssetDb();
  const collection = db.prepare(`SELECT id FROM collections WHERE id = ? AND owner_scope = ?`).get(collectionId, ownerScope);
  if (!collection) throw new Error("collection_not_found");
  const asset = getAssetById(assetId, ownerScope);
  if (!asset) throw new Error("asset_not_found");
  db.prepare(`INSERT OR IGNORE INTO collection_assets (collection_id, asset_id) VALUES (?, ?)`).run(collectionId, assetId);
}

export function listAssetsInCollection(collectionId: string, ownerScope: string): AssetRecord[] {
  const rows = getAssetDb()
    .prepare(
      `SELECT assets.* FROM assets
       JOIN collection_assets ON collection_assets.asset_id = assets.id
       JOIN collections ON collections.id = collection_assets.collection_id
       WHERE collection_assets.collection_id = ? AND collections.owner_scope = ?
       ORDER BY assets.created_at DESC`,
    )
    .all(collectionId, ownerScope);
  return rows.map(rowToAsset);
}

// ---- access tracking + pinning (Stage 3: cache manager) ----------------------------

export function touchAssetAccess(id: string, ownerScope: string): void {
  getAssetDb()
    .prepare(`UPDATE assets SET last_accessed_at = ? WHERE id = ? AND owner_scope = ?`)
    .run(new Date().toISOString(), id, ownerScope);
}

export function setAssetPinned(id: string, ownerScope: string, pinned: boolean): boolean {
  const result = getAssetDb()
    .prepare(`UPDATE assets SET pinned = ?, updated_at = ? WHERE id = ? AND owner_scope = ?`)
    .run(pinned ? 1 : 0, new Date().toISOString(), id, ownerScope);
  return result.changes > 0;
}

export type CacheStats = {
  totalAssets: number;
  totalBytes: number;
  vaultAssets: number;
  vaultBytes: number;
  cacheAssets: number;
  cacheBytes: number;
  pinnedAssets: number;
  pinnedBytes: number;
};

// Real aggregate query over the actual table — not a guess, not a fixture.
// ownerScope omitted means "across every scope" (an admin-only view; the
// HTTP route restricts this, this function itself has no access opinion).
export function getCacheStats(ownerScope?: string): CacheStats {
  const db = getAssetDb();
  const where = ownerScope ? `WHERE owner_scope = ?` : "";
  const args = ownerScope ? [ownerScope] : [];
  const row = db
    .prepare(
      `SELECT
         COUNT(*) AS total_assets,
         COALESCE(SUM(file_size_bytes), 0) AS total_bytes,
         COALESCE(SUM(CASE WHEN tier = 'vault' THEN 1 ELSE 0 END), 0) AS vault_assets,
         COALESCE(SUM(CASE WHEN tier = 'vault' THEN file_size_bytes ELSE 0 END), 0) AS vault_bytes,
         COALESCE(SUM(CASE WHEN tier = 'cache' THEN 1 ELSE 0 END), 0) AS cache_assets,
         COALESCE(SUM(CASE WHEN tier = 'cache' THEN file_size_bytes ELSE 0 END), 0) AS cache_bytes,
         COALESCE(SUM(CASE WHEN pinned = 1 THEN 1 ELSE 0 END), 0) AS pinned_assets,
         COALESCE(SUM(CASE WHEN pinned = 1 THEN file_size_bytes ELSE 0 END), 0) AS pinned_bytes
       FROM assets ${where}`,
    )
    .get(...args) as any;
  return {
    totalAssets: row.total_assets,
    totalBytes: row.total_bytes,
    vaultAssets: row.vault_assets,
    vaultBytes: row.vault_bytes,
    cacheAssets: row.cache_assets,
    cacheBytes: row.cache_bytes,
    pinnedAssets: row.pinned_assets,
    pinnedBytes: row.pinned_bytes,
  };
}

// Candidates for eviction when over quota: cache-tier, not pinned, least
// recently used first (falling back to created_at for an asset that was
// never accessed after ingestion). Ordering only — callers decide how many
// to actually take.
export function listEvictionCandidates(ownerScope: string): AssetRecord[] {
  const rows = getAssetDb()
    .prepare(
      `SELECT * FROM assets
       WHERE owner_scope = ? AND tier = 'cache' AND pinned = 0
       ORDER BY COALESCE(last_accessed_at, created_at) ASC`,
    )
    .all(ownerScope);
  return rows.map(rowToAsset);
}

export function listAllStorageKeys(storageProvider: string): string[] {
  const rows = getAssetDb()
    .prepare(`SELECT storage_key FROM assets WHERE storage_provider = ?`)
    .all(storageProvider) as Array<{ storage_key: string }>;
  return rows.map((r) => r.storage_key);
}

export function setAssetAvailability(id: string, ownerScope: string, availability: AssetAvailability): boolean {
  const result = getAssetDb()
    .prepare(`UPDATE assets SET availability = ?, updated_at = ? WHERE id = ? AND owner_scope = ?`)
    .run(availability, new Date().toISOString(), id, ownerScope);
  return result.changes > 0;
}

export function setAssetContentHash(id: string, ownerScope: string, contentHash: string): void {
  getAssetDb()
    .prepare(`UPDATE assets SET content_hash = ?, updated_at = ? WHERE id = ? AND owner_scope = ?`)
    .run(contentHash, new Date().toISOString(), id, ownerScope);
}

export function setAssetDimensions(id: string, ownerScope: string, width: number | null, height: number | null, durationSeconds: number | null): void {
  getAssetDb()
    .prepare(
      `UPDATE assets SET width = ?, height = ?, duration_seconds = COALESCE(?, duration_seconds), updated_at = ? WHERE id = ? AND owner_scope = ?`,
    )
    .run(width, height, durationSeconds, new Date().toISOString(), id, ownerScope);
}

export function setAssetFavorite(id: string, ownerScope: string, favorite: boolean): boolean {
  const result = getAssetDb()
    .prepare(`UPDATE assets SET favorite = ?, updated_at = ? WHERE id = ? AND owner_scope = ?`)
    .run(favorite ? 1 : 0, new Date().toISOString(), id, ownerScope);
  return result.changes > 0;
}

export function setAssetArchived(id: string, ownerScope: string, archived: boolean): boolean {
  const result = getAssetDb()
    .prepare(`UPDATE assets SET archived = ?, updated_at = ? WHERE id = ? AND owner_scope = ?`)
    .run(archived ? 1 : 0, new Date().toISOString(), id, ownerScope);
  return result.changes > 0;
}

// ---- search (Stage 5) ---------------------------------------------------------------
// Real keyword + filter search over the actual columns and the actual tag
// index — no embeddings, no vector similarity, no ranking model. This
// project has no embeddings infrastructure (no vector store, no configured
// embedding provider), so semantic/similarity search is explicitly not
// offered rather than faked with a keyword search dressed up as "AI search."
// What's here is real: SQL LIKE text matching (case-insensitive for ASCII,
// SQLite's native behavior) across name/title/description/source/provider/
// model/style, combined with exact filters and AND-tag matching.

export type AssetSearchQuery = {
  text?: string;
  assetType?: string;
  tier?: AssetTier;
  favorite?: boolean;
  archived?: boolean;
  provider?: string;
  tags?: string[]; // AND semantics: every listed tag must be present
  collectionId?: string;
  sort?: "created_desc" | "created_asc" | "name_asc" | "size_desc";
  limit?: number;
  offset?: number;
};

export type AssetSearchResult = { results: AssetRecord[]; total: number };

export function searchAssets(ownerScope: string, query: AssetSearchQuery): AssetSearchResult {
  const db = getAssetDb();
  const clauses: string[] = ["owner_scope = ?"];
  const args: Array<string | number> = [ownerScope];

  if (query.text && query.text.trim()) {
    const like = `%${query.text.trim()}%`;
    clauses.push(
      `(original_name LIKE ? OR title LIKE ? OR description LIKE ? OR source LIKE ? OR provider LIKE ? OR model LIKE ? OR style LIKE ?)`,
    );
    args.push(like, like, like, like, like, like, like);
  }
  if (query.assetType) {
    clauses.push(`asset_type = ?`);
    args.push(query.assetType);
  }
  if (query.tier) {
    clauses.push(`tier = ?`);
    args.push(query.tier);
  }
  if (query.favorite !== undefined) {
    clauses.push(`favorite = ?`);
    args.push(query.favorite ? 1 : 0);
  }
  if (query.archived !== undefined) {
    clauses.push(`archived = ?`);
    args.push(query.archived ? 1 : 0);
  }
  if (query.provider) {
    clauses.push(`provider = ?`);
    args.push(query.provider);
  }
  if (query.collectionId) {
    clauses.push(`id IN (SELECT asset_id FROM collection_assets WHERE collection_id = ?)`);
    args.push(query.collectionId);
  }
  if (query.tags && query.tags.length > 0) {
    clauses.push(
      `id IN (
         SELECT asset_tags.asset_id FROM asset_tags
         JOIN tags ON tags.id = asset_tags.tag_id
         WHERE tags.owner_scope = ? AND tags.name IN (${query.tags.map(() => "?").join(",")})
         GROUP BY asset_tags.asset_id
         HAVING COUNT(DISTINCT tags.name) = ?
       )`,
    );
    args.push(ownerScope, ...query.tags, query.tags.length);
  }

  const where = clauses.join(" AND ");
  const orderBy =
    query.sort === "created_asc"
      ? "created_at ASC"
      : query.sort === "name_asc"
        ? "original_name COLLATE NOCASE ASC"
        : query.sort === "size_desc"
          ? "file_size_bytes DESC"
          : "created_at DESC";

  const total = (db.prepare(`SELECT COUNT(*) AS count FROM assets WHERE ${where}`).get(...args) as any).count as number;

  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  const offset = Math.max(query.offset ?? 0, 0);
  const rows = db
    .prepare(`SELECT * FROM assets WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
    .all(...args, limit, offset);

  return { results: rows.map(rowToAsset), total };
}

// ---- derivatives (Stage 4: ingestion pipeline) -------------------------------------
// Thumbnails/proxies/waveforms generated from a source asset. One row per
// (asset, kind) — re-ingesting an asset replaces its derivative of that kind
// rather than accumulating stale rows (see upsertDerivative).

export type DerivativeKind = "thumbnail" | "proxy" | "waveform";

export type DerivativeRecord = {
  id: string;
  asset_id: string;
  kind: DerivativeKind;
  storage_key: string;
  mime_type: string;
  width: number | null;
  height: number | null;
  file_size_bytes: number;
  created_at: string;
};

function rowToDerivative(row: any): DerivativeRecord {
  return {
    id: row.id,
    asset_id: row.asset_id,
    kind: row.kind,
    storage_key: row.storage_key,
    mime_type: row.mime_type,
    width: row.width,
    height: row.height,
    file_size_bytes: row.file_size_bytes,
    created_at: row.created_at,
  };
}

export function upsertDerivative(input: {
  assetId: string;
  kind: DerivativeKind;
  storageKey: string;
  mimeType: string;
  width?: number | null;
  height?: number | null;
  fileSizeBytes: number;
}): DerivativeRecord {
  const db = getAssetDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO asset_derivatives (id, asset_id, kind, storage_key, mime_type, width, height, file_size_bytes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(asset_id, kind) DO UPDATE SET
       storage_key = excluded.storage_key,
       mime_type = excluded.mime_type,
       width = excluded.width,
       height = excluded.height,
       file_size_bytes = excluded.file_size_bytes,
       created_at = excluded.created_at`,
  ).run(id, input.assetId, input.kind, input.storageKey, input.mimeType, input.width ?? null, input.height ?? null, input.fileSizeBytes, now);
  return rowToDerivative(
    db.prepare(`SELECT * FROM asset_derivatives WHERE asset_id = ? AND kind = ?`).get(input.assetId, input.kind),
  );
}

export function listDerivativesForAsset(assetId: string): DerivativeRecord[] {
  const rows = getAssetDb().prepare(`SELECT * FROM asset_derivatives WHERE asset_id = ? ORDER BY kind`).all(assetId);
  return rows.map(rowToDerivative);
}

export function getDerivative(assetId: string, kind: DerivativeKind): DerivativeRecord | null {
  const row = getAssetDb().prepare(`SELECT * FROM asset_derivatives WHERE asset_id = ? AND kind = ?`).get(assetId, kind);
  return row ? rowToDerivative(row) : null;
}

// ---- presets (Stage 7) -------------------------------------------------------------

export type PresetRecord = {
  id: string;
  owner_scope: string;
  name: string;
  description: string | null;
  kind: string;
  version: number;
  definition: unknown;
  archived: boolean;
  created_at: string;
  updated_at: string;
};

function rowToPreset(row: any): PresetRecord {
  return {
    id: row.id,
    owner_scope: row.owner_scope,
    name: row.name,
    description: row.description,
    kind: row.kind,
    version: row.version,
    definition: JSON.parse(row.definition),
    archived: row.archived === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function createPreset(input: {
  ownerScope: string;
  name: string;
  description?: string | null;
  kind: string;
  definition: unknown;
}): PresetRecord {
  const id = randomUUID();
  const now = new Date().toISOString();
  getAssetDb()
    .prepare(
      `INSERT INTO presets (id, owner_scope, name, description, kind, version, definition, archived, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, 0, ?, ?)`,
    )
    .run(id, input.ownerScope, input.name, input.description ?? null, input.kind, JSON.stringify(input.definition), now, now);
  return rowToPreset(
    getAssetDb().prepare(`SELECT * FROM presets WHERE id = ? AND owner_scope = ?`).get(id, input.ownerScope),
  );
}

export function listPresets(ownerScope: string, kind?: string): PresetRecord[] {
  const rows = kind
    ? getAssetDb()
        .prepare(`SELECT * FROM presets WHERE owner_scope = ? AND kind = ? AND archived = 0 ORDER BY created_at DESC`)
        .all(ownerScope, kind)
    : getAssetDb().prepare(`SELECT * FROM presets WHERE owner_scope = ? AND archived = 0 ORDER BY created_at DESC`).all(ownerScope);
  return rows.map(rowToPreset);
}

export function getPresetById(id: string, ownerScope: string): PresetRecord | null {
  const row = getAssetDb().prepare(`SELECT * FROM presets WHERE id = ? AND owner_scope = ?`).get(id, ownerScope);
  return row ? rowToPreset(row) : null;
}

// A new version is a new row sharing the same lineage via name+kind rather
// than mutating history in place — old versions stay inspectable.
export function createPresetVersion(previousId: string, ownerScope: string, definition: unknown): PresetRecord | null {
  const previous = getPresetById(previousId, ownerScope);
  if (!previous) return null;
  const id = randomUUID();
  const now = new Date().toISOString();
  getAssetDb()
    .prepare(
      `INSERT INTO presets (id, owner_scope, name, description, kind, version, definition, archived, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    )
    .run(id, ownerScope, previous.name, previous.description, previous.kind, previous.version + 1, JSON.stringify(definition), now, now);
  return getPresetById(id, ownerScope);
}

export function archivePreset(id: string, ownerScope: string): boolean {
  const result = getAssetDb()
    .prepare(`UPDATE presets SET archived = 1, updated_at = ? WHERE id = ? AND owner_scope = ?`)
    .run(new Date().toISOString(), id, ownerScope);
  return result.changes > 0;
}
