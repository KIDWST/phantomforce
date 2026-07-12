/* Asset Cloud migration indexer.
   Indexes existing media into the permanent library WITHOUT moving or
   deleting anything. Sources:
   - the 30-day ContentAsset scratch store (server/.local/content-assets):
     records + blobs are read in place, copied into content-addressed
     storage, and left untouched (their own expiry keeps applying).
   Dry-run first, rerunnable: an already-indexed file (same org + sha256)
   is skipped, so repeated runs converge instead of duplicating. */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { PrismaClient } from "@prisma/client";

import { prisma } from "../access/prisma-runtime.js";
import { ALLOWED_MIME, MAX_ASSET_BYTES } from "./asset-service.js";
import { getAssetStorageProvider, sha256Of } from "./asset-storage-provider.js";

function requirePrisma(): PrismaClient {
  if (!prisma) throw new Error("Asset migration requires DATABASE_URL.");
  return prisma;
}

const SCRATCH_DIR = process.env.PHANTOMFORCE_CONTENT_ASSET_DIR
  ? resolve(process.env.PHANTOMFORCE_CONTENT_ASSET_DIR)
  : resolve(process.cwd(), "server", ".local", "content-assets");

type ScratchRecord = {
  id: string;
  owner_scope: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  expires_at: string;
};

export type MigrationReport = {
  dry_run: boolean;
  source: string;
  scanned: number;
  eligible: number;
  indexed: number;
  skipped_already_indexed: number;
  skipped_invalid: Array<{ id: string; reason: string }>;
  scope_mapping: Record<string, string>;
  ran_at: string;
};

export async function runContentAssetMigration(input: {
  /** owner_scope -> orgId mapping; scopes without a mapping are skipped */
  scopeToOrg: Record<string, string>;
  dryRun: boolean;
  actorEmail: string;
}): Promise<MigrationReport> {
  const db = requirePrisma();
  const report: MigrationReport = {
    dry_run: input.dryRun,
    source: SCRATCH_DIR,
    scanned: 0,
    eligible: 0,
    indexed: 0,
    skipped_already_indexed: 0,
    skipped_invalid: [],
    scope_mapping: input.scopeToOrg,
    ran_at: new Date().toISOString(),
  };

  let records: ScratchRecord[] = [];
  try {
    const index = JSON.parse(await readFile(resolve(SCRATCH_DIR, "index.json"), "utf8")) as { records?: ScratchRecord[] };
    records = Array.isArray(index.records) ? index.records : [];
  } catch {
    return report; /* no scratch store — nothing to index, honestly reported */
  }

  const provider = getAssetStorageProvider();
  for (const record of records) {
    report.scanned += 1;
    const orgId = input.scopeToOrg[record.owner_scope];
    if (!orgId) {
      report.skipped_invalid.push({ id: record.id, reason: `unmapped_scope:${record.owner_scope}` });
      continue;
    }
    if (!ALLOWED_MIME[record.mime_type?.toLowerCase?.() ?? ""]) {
      report.skipped_invalid.push({ id: record.id, reason: `mime_not_allowed:${record.mime_type}` });
      continue;
    }
    let bytes: Buffer;
    try {
      bytes = await readFile(resolve(SCRATCH_DIR, "files", record.id));
    } catch {
      report.skipped_invalid.push({ id: record.id, reason: "blob_missing" });
      continue;
    }
    if (bytes.length > MAX_ASSET_BYTES) {
      report.skipped_invalid.push({ id: record.id, reason: "file_too_large" });
      continue;
    }
    report.eligible += 1;
    const sha256 = sha256Of(bytes);
    const existing = await db.mediaAsset.findFirst({ where: { orgId, sha256 }, select: { id: true } });
    if (existing) {
      report.skipped_already_indexed += 1;
      continue;
    }
    if (input.dryRun) {
      report.indexed += 1; /* would index */
      continue;
    }
    const blob = await provider.putBlob(orgId, sha256, bytes);
    await db.mediaAsset.create({
      data: {
        orgId,
        title: record.original_name.slice(0, 160) || "migrated asset",
        originalName: record.original_name.slice(0, 160) || "migrated asset",
        mimeType: record.mime_type,
        kind: ALLOWED_MIME[record.mime_type].kind,
        sizeBytes: bytes.length,
        sha256,
        contentPath: blob.path,
        source: "sync-migrated",
        tags: [],
        state: "ready",
        createdAt: new Date(record.created_at || Date.now()),
      },
    });
    report.indexed += 1;
  }
  return report;
}
