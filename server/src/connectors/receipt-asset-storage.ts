/* PhantomForce — receipt asset storage.
   Local-disk storage for photos dropped into the Accounting tab's smart
   entry flow. Unlike content-asset-storage.ts (a 30-day sync/archive
   cache for Content Hub media), receipts are financial records the owner
   may need at tax time, so they carry no automatic expiry — they persist
   until their transaction is deleted and the caller explicitly removes
   them. */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";

const DEFAULT_STATE_DIR = path.join(process.cwd(), ".local", "receipt-assets");
const STATE_DIR = process.env.PHANTOMFORCE_RECEIPT_ASSET_DIR ?? DEFAULT_STATE_DIR;
const FILES_DIR = path.join(STATE_DIR, "files");
const INDEX_FILE = path.join(STATE_DIR, "index.json");
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

export type ReceiptAssetRecord = {
  id: string;
  owner_scope: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
};

type AssetIndex = { records: ReceiptAssetRecord[] };

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

export interface ReceiptAssetStorageProvider {
  putAsset(input: {
    ownerScope: string;
    dataUrl: string;
    originalName?: string;
  }): Promise<{ ok: true; asset: ReceiptAssetRecord } | { ok: false; error: string }>;
  getAssetFile(
    id: string,
    ownerScope: string,
  ): Promise<{ ok: true; dataUrl: string; asset: ReceiptAssetRecord } | { ok: false; error: string }>;
  deleteAsset(id: string, ownerScope: string): Promise<boolean>;
}

class LocalDiskReceiptAssetProvider implements ReceiptAssetStorageProvider {
  async putAsset({ ownerScope, dataUrl, originalName }: { ownerScope: string; dataUrl: string; originalName?: string }) {
    const parsed = parseDataUrl(dataUrl);
    if (!parsed) return { ok: false as const, error: "invalid_data_url" };
    if (parsed.buffer.byteLength > MAX_UPLOAD_BYTES) return { ok: false as const, error: "file_too_large" };

    const id = randomUUID();
    const record: ReceiptAssetRecord = {
      id,
      owner_scope: ownerScope,
      original_name: (originalName || "receipt").slice(0, 160),
      mime_type: parsed.mimeType,
      size_bytes: parsed.buffer.byteLength,
      created_at: new Date().toISOString(),
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

  async deleteAsset(id: string, ownerScope: string) {
    const index = await readIndex();
    const record = index.records.find((item) => item.id === id && item.owner_scope === ownerScope);
    if (!record) return false;
    index.records = index.records.filter((item) => item.id !== id);
    await writeIndex(index);
    await unlink(path.join(FILES_DIR, id)).catch(() => {});
    return true;
  }
}

const localDiskProvider = new LocalDiskReceiptAssetProvider();

export function getReceiptAssetStorageProvider(): ReceiptAssetStorageProvider {
  return localDiskProvider;
}
