/* Asset Cloud derived-file cache.
   Originals are never evicted — only DERIVED files (thumbnails, previews)
   live under cache policy, because every one of them can be regenerated
   from its original on demand (readAssetBytes does exactly that on a miss).

   The index is a small JSON file tracking size + last access per derived
   key; eviction is LRU under a configurable cap. Corrupt/missing index
   recovers by resetting — worst case the next access repopulates it. */

import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { PrismaClient } from "@prisma/client";

import { prisma } from "../access/prisma-runtime.js";
import { assetCloudRoot, getAssetStorageProvider } from "./asset-storage-provider.js";

const CACHE_LIMIT_MB = Number(process.env.PHANTOM_ASSET_CACHE_MB ?? 512);
const INDEX_PATH = () => resolve(assetCloudRoot(), "derived-cache-index.json");

type CacheEntry = { orgId: string; key: string; sizeBytes: number; lastAccess: number };
type CacheIndex = { entries: CacheEntry[]; counters: Record<string, number> };

let cached: CacheIndex | null = null;
let writeQueued = false;

async function loadIndex(): Promise<CacheIndex> {
  if (cached) return cached;
  try {
    const raw = JSON.parse(await readFile(INDEX_PATH(), "utf8")) as CacheIndex;
    cached = {
      entries: Array.isArray(raw.entries) ? raw.entries.filter((e) => e && e.key && e.orgId) : [],
      counters: raw.counters && typeof raw.counters === "object" ? raw.counters : {},
    };
  } catch {
    cached = { entries: [], counters: {} };
  }
  return cached;
}

function scheduleWrite() {
  if (writeQueued) return;
  writeQueued = true;
  setTimeout(async () => {
    writeQueued = false;
    if (!cached) return;
    await writeFile(INDEX_PATH(), JSON.stringify(cached), "utf8").catch(() => {});
  }, 500);
}

export async function recordCacheEvent(name: "hit" | "miss" | "eviction" | "processing_failed" | "upload_failed" | "download_failed") {
  const index = await loadIndex();
  index.counters[name] = (index.counters[name] ?? 0) + 1;
  scheduleWrite();
}

export async function touchDerived(orgId: string, key: string, sizeBytes: number) {
  const index = await loadIndex();
  const existing = index.entries.find((e) => e.orgId === orgId && e.key === key);
  if (existing) {
    existing.lastAccess = Date.now();
    existing.sizeBytes = sizeBytes;
  } else {
    index.entries.push({ orgId, key, sizeBytes, lastAccess: Date.now() });
  }
  scheduleWrite();
  await enforceCacheLimit();
}

async function enforceCacheLimit() {
  const index = await loadIndex();
  const limitBytes = CACHE_LIMIT_MB * 1024 * 1024;
  let total = index.entries.reduce((sum, e) => sum + e.sizeBytes, 0);
  if (total <= limitBytes) return;
  const provider = getAssetStorageProvider();
  const byOldest = [...index.entries].sort((a, b) => a.lastAccess - b.lastAccess);
  for (const entry of byOldest) {
    if (total <= limitBytes) break;
    await provider.deleteDerived(entry.orgId, entry.key).catch(() => {});
    index.entries = index.entries.filter((e) => e !== entry);
    total -= entry.sizeBytes;
    index.counters.eviction = (index.counters.eviction ?? 0) + 1;
  }
  scheduleWrite();
}

/* ---------------- diagnostics (admin curtain only) ---------------- */

export async function assetCloudDiagnostics() {
  const db: PrismaClient | undefined = prisma;
  const index = await loadIndex();
  const cacheBytes = index.entries.reduce((sum, e) => sum + e.sizeBytes, 0);

  let assetTotals: { count: number; bytes: number; processing: number; failed: number } = { count: 0, bytes: 0, processing: 0, failed: 0 };
  let missingOriginals: Array<{ id: string; orgId: string; title: string }> = [];
  if (db) {
    const [count, sum, processing, failed] = await Promise.all([
      db.mediaAsset.count(),
      db.mediaAsset.aggregate({ _sum: { sizeBytes: true } }),
      db.mediaAsset.count({ where: { state: "processing" } }),
      db.mediaAsset.count({ where: { state: "failed" } }),
    ]);
    assetTotals = { count, bytes: sum._sum.sizeBytes ?? 0, processing, failed };

    /* broken references: DB rows whose blob is gone from the provider */
    const provider = getAssetStorageProvider();
    const sample = await db.mediaAsset.findMany({
      select: { id: true, orgId: true, title: true, sha256: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    for (const asset of sample) {
      if (!(await provider.blobExists(asset.orgId, asset.sha256))) {
        missingOriginals.push({ id: asset.id, orgId: asset.orgId, title: asset.title });
        if (missingOriginals.length >= 20) break;
      }
    }
  }

  let diskBytes = 0;
  try {
    diskBytes = (await stat(assetCloudRoot())).isDirectory() ? -1 : 0; /* -1 = present, exact walk skipped */
  } catch { diskBytes = 0; }

  return {
    provider: "local-disk",
    root_present: diskBytes !== 0,
    assets: assetTotals,
    cache: {
      derived_files: index.entries.length,
      derived_bytes: cacheBytes,
      limit_mb: CACHE_LIMIT_MB,
      counters: index.counters,
    },
    missing_originals: missingOriginals,
    checked_at: new Date().toISOString(),
  };
}

/* test hook */
export async function resetCacheIndexForTests() {
  cached = { entries: [], counters: {} };
  await rm(INDEX_PATH(), { force: true }).catch(() => {});
}
