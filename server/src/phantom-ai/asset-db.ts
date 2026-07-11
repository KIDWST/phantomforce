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
  legacy_synced_id: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
};

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
    legacy_synced_id: row.legacy_synced_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    expires_at: row.expires_at,
  };
}

let dbInstance: DatabaseSync | null = null;

export function getAssetDb(): DatabaseSync {
  if (dbInstance) return dbInstance;
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
  dbInstance = new DatabaseSync(DB_PATH);
  dbInstance.exec(`
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
      legacy_synced_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
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
  `);
  return dbInstance;
}

// Test-only: point a fresh in-memory database at this module without
// touching the real on-disk vault.
export function resetAssetDbForTests(): DatabaseSync {
  dbInstance?.close();
  dbInstance = new DatabaseSync(":memory:");
  dbInstance.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE assets (
      id TEXT PRIMARY KEY, owner_scope TEXT NOT NULL, asset_type TEXT NOT NULL, original_name TEXT NOT NULL,
      title TEXT, description TEXT, source TEXT, provider TEXT, model TEXT, style TEXT,
      aspect TEXT, duration_seconds REAL, mime_type TEXT NOT NULL, extension TEXT,
      file_size_bytes INTEGER NOT NULL, width INTEGER, height INTEGER, content_hash TEXT,
      storage_provider TEXT NOT NULL, storage_key TEXT NOT NULL, tier TEXT NOT NULL DEFAULT 'cache',
      favorite INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0,
      legacy_synced_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, expires_at TEXT
    );
    CREATE INDEX idx_assets_owner_scope ON assets(owner_scope);
    CREATE INDEX idx_assets_content_hash ON assets(content_hash);
    CREATE TABLE tags (id TEXT PRIMARY KEY, owner_scope TEXT NOT NULL, name TEXT NOT NULL, UNIQUE(owner_scope, name));
    CREATE TABLE asset_tags (asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE, tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE, PRIMARY KEY (asset_id, tag_id));
    CREATE TABLE collections (id TEXT PRIMARY KEY, owner_scope TEXT NOT NULL, name TEXT NOT NULL, description TEXT, created_at TEXT NOT NULL);
    CREATE TABLE collection_assets (collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE, asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE, PRIMARY KEY (collection_id, asset_id));
  `);
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
