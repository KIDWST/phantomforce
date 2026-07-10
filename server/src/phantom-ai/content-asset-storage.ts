/* PhantomForce — content asset storage.
   A small pluggable interface so photos/videos created in Content Hub can
   sync across devices instead of living only in one browser's localStorage.
   Today there is exactly one provider: local disk on this same machine
   (server/.local/content-assets). A future provider (e.g. Google Drive, via
   the real Drive API/OAuth — never scraped credentials or a stored
   password) can implement the same ContentAssetStorageProvider interface
   and be swapped in later without touching any caller. Every asset carries
   a hard 30-day expiry — this is a temporary cross-device sync/archive
   layer, not permanent app storage. */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";

const RETENTION_DAYS = 30;
const DEFAULT_STATE_DIR = path.join(process.cwd(), ".local", "content-assets");
const STATE_DIR = process.env.PHANTOMFORCE_CONTENT_ASSET_DIR ?? DEFAULT_STATE_DIR;
const FILES_DIR = path.join(STATE_DIR, "files");
const INDEX_FILE = path.join(STATE_DIR, "index.json");
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

type AssetIndex = { records: ContentAssetRecord[] };

async function readIndex(): Promise<AssetIndex> {
  try {
    const raw = await readFile(INDEX_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<AssetIndex>;
    return { records: Array.isArray(parsed.records) ? parsed.records : [] };
  } catch {
    return { records: [] };
  }
}

async function writeIndex(index: AssetIndex) {
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(INDEX_FILE, `${JSON.stringify(index, null, 2)}\n`, "utf8");
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

export interface ContentAssetStorageProvider {
  putAsset(input: {
    ownerScope: string;
    dataUrl: string;
    originalName?: string;
  }): Promise<{ ok: true; asset: ContentAssetRecord } | { ok: false; error: string }>;
  getAssetFile(
    id: string,
    ownerScope: string,
  ): Promise<{ ok: true; dataUrl: string; asset: ContentAssetRecord } | { ok: false; error: string }>;
  listAssets(ownerScope: string): Promise<ContentAssetRecord[]>;
  deleteAsset(id: string, ownerScope: string): Promise<boolean>;
  deleteExpiredAssets(): Promise<{ deletedCount: number }>;
}

class LocalDiskContentAssetProvider implements ContentAssetStorageProvider {
  async putAsset({ ownerScope, dataUrl, originalName }: { ownerScope: string; dataUrl: string; originalName?: string }) {
    const parsed = parseDataUrl(dataUrl);
    if (!parsed) return { ok: false as const, error: "invalid_data_url" };
    if (parsed.buffer.byteLength > MAX_UPLOAD_BYTES) return { ok: false as const, error: "file_too_large" };

    const id = randomUUID();
    const now = new Date();
    const record: ContentAssetRecord = {
      id,
      owner_scope: ownerScope,
      original_name: (originalName || "content-asset").slice(0, 160),
      mime_type: parsed.mimeType,
      size_bytes: parsed.buffer.byteLength,
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    };

    await mkdir(FILES_DIR, { recursive: true });
    await writeFile(path.join(FILES_DIR, id), parsed.buffer);
    const index = await readIndex();
    index.records.push(record);
    await writeIndex(index);

    return { ok: true as const, asset: record };
  }

  async getAssetFile(id: string, ownerScope: string) {
    const index = await readIndex();
    const record = index.records.find((item) => item.id === id && item.owner_scope === ownerScope);
    if (!record) return { ok: false as const, error: "not_found" };
    try {
      const buffer = await readFile(path.join(FILES_DIR, id));
      return { ok: true as const, dataUrl: `data:${record.mime_type};base64,${buffer.toString("base64")}`, asset: record };
    } catch {
      return { ok: false as const, error: "file_missing" };
    }
  }

  async listAssets(ownerScope: string) {
    const index = await readIndex();
    return index.records
      .filter((item) => item.owner_scope === ownerScope)
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  }

  async deleteAsset(id: string, ownerScope: string) {
    const index = await readIndex();
    const record = index.records.find((item) => item.id === id && item.owner_scope === ownerScope);
    if (!record) return false;
    index.records = index.records.filter((item) => item.id !== id);
    await writeIndex(index);
    await unlink(path.join(FILES_DIR, id)).catch(() => {});
    return true;
  }

  async deleteExpiredAssets() {
    const index = await readIndex();
    const now = Date.now();
    const expired = index.records.filter((item) => Date.parse(item.expires_at) <= now);
    if (!expired.length) return { deletedCount: 0 };
    index.records = index.records.filter((item) => Date.parse(item.expires_at) > now);
    await writeIndex(index);
    await Promise.all(expired.map((item) => unlink(path.join(FILES_DIR, item.id)).catch(() => {})));
    return { deletedCount: expired.length };
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
