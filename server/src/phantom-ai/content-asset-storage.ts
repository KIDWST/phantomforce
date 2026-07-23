/* PhantomForce durable content-asset storage.
   Bytes are untrusted until their file signature is inspected. Records are
   tenant scoped while identical bytes share a checksum-addressed blob.
   Removal archives metadata first; restore is possible throughout retention. */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const RETENTION_DAYS = 30;
const DEFAULT_STATE_DIR = path.join(process.cwd(), ".local", "content-assets");
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const indexLocks = new Map<string, Promise<unknown>>();

export type ContentAssetRecord = {
  id: string;
  owner_scope: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  checksum_sha256: string;
  blob_ref_count: number;
  version: number;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  expires_at: string;
};

type AssetIndex = { schemaVersion: 2; records: ContentAssetRecord[] };

function cleanOwnerScope(value: string) {
  return String(value || "").trim().replace(/[^a-zA-Z0-9_.:-]+/g, "-").slice(0, 100) || "unknown";
}

function cleanName(value = "") {
  return String(value || "content-asset").replace(/[\u0000-\u001f<>:"/\\|?*]+/g, "-").trim().slice(0, 160) || "content-asset";
}

function sha256(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function parseDataUrl(dataUrl: string): { declaredMime: string; buffer: Buffer } | null {
  const match = /^data:([\w./+-]+);base64,([a-z0-9+/=\r\n]+)$/iu.exec(dataUrl);
  if (!match) return null;
  try {
    const buffer = Buffer.from(match[2], "base64");
    return buffer.length ? { declaredMime: match[1].toLowerCase(), buffer } : null;
  } catch {
    return null;
  }
}

function sniffMime(buffer: Buffer): string | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (buffer.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii"))) return "image/gif";
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = buffer.subarray(8, 12).toString("ascii").toLowerCase();
    if (["avif", "avis"].includes(brand)) return "image/avif";
    return "video/mp4";
  }
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString("ascii") === "OggS") return "audio/ogg";
  if (buffer.length >= 3 && buffer.subarray(0, 3).toString("ascii") === "ID3") return "audio/mpeg";
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WAVE") return "audio/wav";
  return null;
}

function normalizedMime(value: string) {
  const mime = value.toLowerCase();
  return mime === "image/jpg" ? "image/jpeg" : mime;
}

function refCounts(records: ContentAssetRecord[]) {
  const counts = new Map<string, number>();
  records.forEach((record) => counts.set(record.checksum_sha256, (counts.get(record.checksum_sha256) || 0) + 1));
  records.forEach((record) => { record.blob_ref_count = counts.get(record.checksum_sha256) || 1; });
}

export interface ContentAssetStorageProvider {
  putAsset(input: {
    ownerScope: string;
    dataUrl: string;
    originalName?: string;
  }): Promise<{ ok: true; asset: ContentAssetRecord; deduplicated: boolean } | { ok: false; error: string }>;
  getAssetFile(
    id: string,
    ownerScope: string,
  ): Promise<{ ok: true; dataUrl: string; asset: ContentAssetRecord } | { ok: false; error: string }>;
  listAssets(ownerScope: string): Promise<ContentAssetRecord[]>;
  listArchivedAssets(ownerScope: string): Promise<ContentAssetRecord[]>;
  deleteAsset(id: string, ownerScope: string): Promise<boolean>;
  restoreAsset(id: string, ownerScope: string): Promise<ContentAssetRecord | null>;
  purgeAsset(id: string, ownerScope: string): Promise<boolean>;
  deleteExpiredAssets(): Promise<{ deletedCount: number }>;
}

export class LocalDiskContentAssetProvider implements ContentAssetStorageProvider {
  readonly stateDir: string;
  readonly filesDir: string;
  readonly legacyFilesDir: string;
  readonly indexFile: string;

  constructor(stateDir = process.env.PHANTOMFORCE_CONTENT_ASSET_DIR || DEFAULT_STATE_DIR) {
    this.stateDir = path.resolve(stateDir);
    this.filesDir = path.join(this.stateDir, "blobs");
    this.legacyFilesDir = path.join(this.stateDir, "files");
    this.indexFile = path.join(this.stateDir, "index.json");
  }

  private async readIndex(): Promise<AssetIndex> {
    try {
      const parsed = JSON.parse(await readFile(this.indexFile, "utf8")) as { records?: Array<Partial<ContentAssetRecord>> };
      const now = new Date().toISOString();
      const records = Array.isArray(parsed.records)
        ? parsed.records.map((raw): ContentAssetRecord => ({
            id: String(raw.id || randomUUID()),
            owner_scope: cleanOwnerScope(String(raw.owner_scope || "unknown")),
            original_name: cleanName(raw.original_name),
            mime_type: normalizedMime(String(raw.mime_type || "application/octet-stream")),
            size_bytes: Number(raw.size_bytes) || 0,
            checksum_sha256: String(raw.checksum_sha256 || ""),
            blob_ref_count: Number(raw.blob_ref_count) || 1,
            version: Number(raw.version) || 1,
            status: raw.status === "archived" ? "archived" : "active",
            created_at: String(raw.created_at || now),
            updated_at: String(raw.updated_at || raw.created_at || now),
            archived_at: raw.archived_at ? String(raw.archived_at) : null,
            expires_at: String(raw.expires_at || new Date(Date.now() + RETENTION_DAYS * 86_400_000).toISOString()),
          }))
        : [];
      await this.hydrateLegacyChecksums(records);
      refCounts(records);
      return { schemaVersion: 2, records };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { schemaVersion: 2, records: [] };
      throw error;
    }
  }

  private async hydrateLegacyChecksums(records: ContentAssetRecord[]) {
    for (const record of records) {
      if (/^[a-f0-9]{64}$/u.test(record.checksum_sha256)) continue;
      try {
        const buffer = await readFile(path.join(this.legacyFilesDir, record.id));
        record.checksum_sha256 = sha256(buffer);
        record.size_bytes = buffer.length;
        const detected = sniffMime(buffer);
        if (detected) record.mime_type = detected;
        await mkdir(this.filesDir, { recursive: true });
        const target = path.join(this.filesDir, record.checksum_sha256);
        try { await stat(target); } catch { await writeFile(target, buffer); }
      } catch {
        record.checksum_sha256 = sha256(Buffer.from(`missing:${record.id}`));
      }
    }
  }

  private async writeIndex(index: AssetIndex) {
    refCounts(index.records);
    await mkdir(this.stateDir, { recursive: true });
    const temporary = `${this.indexFile}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(index, null, 2)}\n`, "utf8");
    await rename(temporary, this.indexFile);
  }

  private async withIndexLock<T>(operation: (index: AssetIndex) => Promise<T> | T) {
    const key = this.indexFile.toLowerCase();
    const previous = indexLocks.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(async () => {
      const index = await this.readIndex();
      const result = await operation(index);
      await this.writeIndex(index);
      return result;
    });
    indexLocks.set(key, current);
    try {
      return await current;
    } finally {
      if (indexLocks.get(key) === current) indexLocks.delete(key);
    }
  }

  private async blobFor(record: ContentAssetRecord) {
    const modern = path.join(this.filesDir, record.checksum_sha256);
    try { return await readFile(modern); } catch { return readFile(path.join(this.legacyFilesDir, record.id)); }
  }

  async putAsset({ ownerScope, dataUrl, originalName }: { ownerScope: string; dataUrl: string; originalName?: string }) {
    const parsed = parseDataUrl(dataUrl);
    if (!parsed) return { ok: false as const, error: "invalid_data_url" };
    if (parsed.buffer.length > MAX_UPLOAD_BYTES) return { ok: false as const, error: "file_too_large" };
    const detectedMime = sniffMime(parsed.buffer);
    if (!detectedMime) return { ok: false as const, error: "unsupported_or_unrecognized_file_type" };
    if (normalizedMime(parsed.declaredMime) !== detectedMime) return { ok: false as const, error: "mime_signature_mismatch" };
    const checksum = sha256(parsed.buffer);
    const owner = cleanOwnerScope(ownerScope);
    await mkdir(this.filesDir, { recursive: true });
    const blobPath = path.join(this.filesDir, checksum);
    let deduplicated = true;
    try { await stat(blobPath); } catch {
      await writeFile(blobPath, parsed.buffer);
      deduplicated = false;
    }
    const asset = await this.withIndexLock((index) => {
      const now = new Date();
      const record: ContentAssetRecord = {
        id: randomUUID(),
        owner_scope: owner,
        original_name: cleanName(originalName),
        mime_type: detectedMime,
        size_bytes: parsed.buffer.length,
        checksum_sha256: checksum,
        blob_ref_count: 1,
        version: 1,
        status: "active",
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
        archived_at: null,
        expires_at: new Date(now.getTime() + RETENTION_DAYS * 86_400_000).toISOString(),
      };
      index.records.push(record);
      return record;
    });
    const refreshed = (await this.listAssets(owner)).find((record) => record.id === asset.id) || asset;
    return { ok: true as const, asset: refreshed, deduplicated };
  }

  async getAssetFile(id: string, ownerScope: string) {
    const index = await this.readIndex();
    const record = index.records.find((item) => item.id === id && item.owner_scope === cleanOwnerScope(ownerScope) && item.status === "active");
    if (!record) return { ok: false as const, error: "not_found" };
    try {
      const buffer = await this.blobFor(record);
      if (sha256(buffer) !== record.checksum_sha256) return { ok: false as const, error: "checksum_mismatch" };
      return { ok: true as const, dataUrl: `data:${record.mime_type};base64,${buffer.toString("base64")}`, asset: record };
    } catch {
      return { ok: false as const, error: "file_missing" };
    }
  }

  async listAssets(ownerScope: string) {
    const index = await this.readIndex();
    const owner = cleanOwnerScope(ownerScope);
    return index.records.filter((item) => item.owner_scope === owner && item.status === "active")
      .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
  }

  async listArchivedAssets(ownerScope: string) {
    const index = await this.readIndex();
    const owner = cleanOwnerScope(ownerScope);
    return index.records.filter((item) => item.owner_scope === owner && item.status === "archived")
      .sort((a, b) => Date.parse(b.archived_at || b.updated_at) - Date.parse(a.archived_at || a.updated_at));
  }

  async deleteAsset(id: string, ownerScope: string) {
    return this.withIndexLock((index) => {
      const record = index.records.find((item) => item.id === id && item.owner_scope === cleanOwnerScope(ownerScope));
      if (!record) return false;
      if (record.status !== "archived") {
        record.status = "archived";
        record.archived_at = new Date().toISOString();
        record.updated_at = record.archived_at;
      }
      return true;
    });
  }

  async restoreAsset(id: string, ownerScope: string) {
    return this.withIndexLock((index) => {
      const record = index.records.find((item) => item.id === id && item.owner_scope === cleanOwnerScope(ownerScope) && item.status === "archived");
      if (!record) return null;
      record.status = "active";
      record.archived_at = null;
      record.updated_at = new Date().toISOString();
      record.expires_at = new Date(Date.now() + RETENTION_DAYS * 86_400_000).toISOString();
      return record;
    });
  }

  async purgeAsset(id: string, ownerScope: string) {
    let checksum = "";
    const removed = await this.withIndexLock((index) => {
      const record = index.records.find((item) => item.id === id && item.owner_scope === cleanOwnerScope(ownerScope));
      if (!record) return false;
      checksum = record.checksum_sha256;
      index.records = index.records.filter((item) => item !== record);
      return true;
    });
    if (!removed) return false;
    const remaining = await this.readIndex();
    if (!remaining.records.some((record) => record.checksum_sha256 === checksum)) {
      await unlink(path.join(this.filesDir, checksum)).catch(() => {});
    }
    return true;
  }

  async deleteExpiredAssets() {
    const expired: Array<{ id: string; owner: string }> = [];
    const now = Date.now();
    const index = await this.readIndex();
    index.records.forEach((record) => {
      if (Date.parse(record.expires_at) <= now) expired.push({ id: record.id, owner: record.owner_scope });
    });
    for (const record of expired) await this.purgeAsset(record.id, record.owner);
    return { deletedCount: expired.length };
  }
}

const localDiskProvider = new LocalDiskContentAssetProvider();

export function getContentAssetStorageProvider(): ContentAssetStorageProvider {
  return localDiskProvider;
}

export const CONTENT_ASSET_RETENTION_DAYS = RETENTION_DAYS;
