/* PhantomForce — Motion Array library import.

   One-off admin ingestion of the local Motion Array pack folder
   (G:\Motionarray download) into the Asset Vault. The folder is 100% ZIP
   source archives, so the existing admin import-folder route (media files
   only, non-recursive) can't take it directly — this script extracts each
   pack to a staging dir on the same drive, walks it recursively, and feeds
   every supported media file through the exact same insertAsset/ingestAsset
   path the route uses. Nothing here invents a second ingestion pipeline.

   Decisions carried over from the 2026-07-10 Media Lab intake note:
   - Motion Array files are internal production source material.
   - Software installers (the DaVinci Resolve ZIP) are excluded.
   - Assets go in at tier "vault" (no 30-day expiry, LRU-protected) —
     this is Jordan's editing library, not transient cache.

   Organization ("the right spots"):
   - every asset tagged: "motionarray" + its category + its pack slug
   - every asset added to the "Motion Array Library" collection
   - category = the source subfolder (elements/gfx/macros/mockups/soccer),
     or a filename heuristic for packs sitting at the folder root

   Run from server/ (the DB and file store resolve from cwd, same as dev):
     npx tsx scripts/import-motionarray.ts --scan          # preview only, no writes
     npx tsx scripts/import-motionarray.ts --run           # full import
     npx tsx scripts/import-motionarray.ts --run --only camera_transitions
*/

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { contentAssetDerivedDir, contentAssetFilesDir } from "../src/phantom-ai/content-asset-storage.js";
import { ingestAsset, sha256File } from "../src/phantom-ai/asset-ingest.js";
import {
  addAssetToCollection,
  createCollection,
  findAssetByContentHash,
  insertAsset,
  listCollections,
  tagAsset,
} from "../src/phantom-ai/asset-db.js";

const execFileAsync = promisify(execFile);

const SOURCE_ROOT = process.env.MOTIONARRAY_SOURCE_DIR ?? "G:\\Motionarray download";
const STAGING_DIR = path.join(SOURCE_ROOT, "_vault-staging");
const OWNER_SCOPE = "phantomforce-owner"; // OWNER_MEMORY_TENANT_ID — the admin/owner workspace scope
const COLLECTION_NAME = "Motion Array Library";

// Same supported set as the admin import-folder route — anything the vault
// UI can't preview/insert stays out (project files, fonts, installers).
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

// Blocked per the intake decision: software, not an effects asset.
const BLOCKED_ZIP_PATTERN = /davinci_resolve/i;

function packSlug(zipName: string): string {
  return zipName
    .replace(/\.zip$/i, "")
    .replace(/_source_\d+$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function categoryForZip(zipPath: string): string {
  const parent = path.basename(path.dirname(zipPath)).toLowerCase();
  if (parent !== path.basename(SOURCE_ROOT).toLowerCase()) return parent;
  const name = path.basename(zipPath).toLowerCase();
  if (/transition/.test(name)) return "transitions";
  if (/logo/.test(name)) return "logos";
  if (/title|intro|kinetic/.test(name)) return "titles";
  if (/text|type|typeface|gothic/.test(name)) return "text-effects";
  if (/slideshow|promo|posters|vogue|buildings|retro/.test(name)) return "templates";
  if (/pack_of|overlay|marks|strokes|butterflies|ephemera|objects|highlighter|glitch|celluloid|skulls/.test(name))
    return "overlays";
  return "library";
}

function isJunkPath(relPath: string): boolean {
  const parts = relPath.split(/[\\/]/);
  return parts.some((p) => p === "__MACOSX" || p === ".DS_Store" || p.startsWith("._"));
}

async function findZips(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (full === STAGING_DIR) continue;
      out.push(...(await findZips(full)));
    } else if (entry.isFile() && /\.zip$/i.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

async function walkFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walkFiles(full)));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

type PackReport = {
  zip: string;
  slug: string;
  category: string;
  extracted: number;
  imported: number;
  skippedDuplicate: number;
  skippedUnsupported: number;
  importedBytes: number;
  errors: string[];
};

async function ensureCollection(): Promise<string> {
  const existing = listCollections(OWNER_SCOPE).find((c) => c.name === COLLECTION_NAME);
  if (existing) return existing.id;
  return createCollection(OWNER_SCOPE, COLLECTION_NAME, "Motion Array source packs imported from G:\\Motionarray download").id;
}

async function importPack(zipPath: string, collectionId: string, scanOnly: boolean): Promise<PackReport> {
  const slug = packSlug(path.basename(zipPath));
  const category = categoryForZip(zipPath);
  const report: PackReport = {
    zip: path.basename(zipPath),
    slug,
    category,
    extracted: 0,
    imported: 0,
    skippedDuplicate: 0,
    skippedUnsupported: 0,
    importedBytes: 0,
    errors: [],
  };

  if (scanOnly) {
    // Preview via the archive listing only — nothing is extracted or written.
    try {
      const { stdout } = await execFileAsync("tar", ["-tf", zipPath], { maxBuffer: 64 * 1024 * 1024 });
      const entries = stdout.split(/\r?\n/).filter((line) => line && !line.endsWith("/"));
      report.extracted = entries.length;
      for (const entry of entries) {
        if (isJunkPath(entry)) continue;
        const ext = path.extname(entry).toLowerCase();
        if (IMPORTABLE_EXTENSIONS[ext]) report.imported += 1; // "would import"
        else report.skippedUnsupported += 1;
      }
    } catch (error) {
      report.errors.push(`list_failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    return report;
  }

  const packStaging = path.join(STAGING_DIR, slug);
  await rm(packStaging, { recursive: true, force: true });
  await mkdir(packStaging, { recursive: true });
  try {
    await execFileAsync("tar", ["-xf", zipPath, "-C", packStaging], { maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    report.errors.push(`extract_failed: ${error instanceof Error ? error.message : String(error)}`);
    await rm(packStaging, { recursive: true, force: true });
    return report;
  }

  const filesDir = contentAssetFilesDir();
  await mkdir(filesDir, { recursive: true });
  const files = await walkFiles(packStaging);
  report.extracted = files.length;

  for (const filePath of files) {
    const relPath = path.relative(packStaging, filePath);
    if (isJunkPath(relPath)) continue;
    const ext = path.extname(filePath).toLowerCase();
    const mimeType = IMPORTABLE_EXTENSIONS[ext];
    if (!mimeType) {
      report.skippedUnsupported += 1;
      continue;
    }

    try {
      const contentHash = await sha256File(filePath);
      const existing = findAssetByContentHash(OWNER_SCOPE, contentHash);
      if (existing) {
        // Already in the vault (e.g. a re-run) — still make sure it sits in
        // the right spots: tags + collection are idempotent upserts.
        tagAsset(existing.id, OWNER_SCOPE, "motionarray");
        tagAsset(existing.id, OWNER_SCOPE, category);
        tagAsset(existing.id, OWNER_SCOPE, slug);
        if (/help|tutorial|preview/i.test(path.basename(filePath))) tagAsset(existing.id, OWNER_SCOPE, "reference");
        addAssetToCollection(collectionId, existing.id, OWNER_SCOPE);
        report.skippedDuplicate += 1;
        continue;
      }

      const stats = await stat(filePath);
      const assetType = mimeType.startsWith("video/") ? "video" : mimeType.startsWith("audio/") ? "audio" : "image";
      const id = randomUUID();
      await copyFile(filePath, path.join(filesDir, id));
      insertAsset({
        id,
        ownerScope: OWNER_SCOPE,
        assetType,
        originalName: path.basename(filePath),
        title: path.basename(filePath, ext),
        source: "motionarray",
        provider: "motionarray",
        mimeType,
        extension: ext.replace(/^\./, ""),
        fileSizeBytes: stats.size,
        contentHash,
        storageProvider: "local-disk",
        storageKey: id,
        tier: "vault",
        expiresAt: null,
      });
      await ingestAsset({
        assetId: id,
        ownerScope: OWNER_SCOPE,
        assetType,
        mimeType,
        sourcePath: path.join(filesDir, id),
        derivedDir: contentAssetDerivedDir(),
      });
      tagAsset(id, OWNER_SCOPE, "motionarray");
      tagAsset(id, OWNER_SCOPE, category);
      tagAsset(id, OWNER_SCOPE, slug);
      // Tutorial/preview media shipped inside preset packs — real, useful
      // reference material, but filterable apart from production footage.
      if (/help|tutorial|preview/i.test(path.basename(filePath))) tagAsset(id, OWNER_SCOPE, "reference");
      addAssetToCollection(collectionId, id, OWNER_SCOPE);
      report.imported += 1;
      report.importedBytes += stats.size;
    } catch (error) {
      report.errors.push(`${relPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  await rm(packStaging, { recursive: true, force: true });
  return report;
}

async function main() {
  const argv = process.argv.slice(2);
  const scanOnly = argv.includes("--scan");
  const run = argv.includes("--run");
  const onlyIdx = argv.indexOf("--only");
  const only = onlyIdx >= 0 ? argv[onlyIdx + 1]?.toLowerCase() : null;
  if (!scanOnly && !run) {
    console.error("Usage: tsx scripts/import-motionarray.ts --scan | --run [--only <substring>]");
    process.exit(2);
  }
  if (!existsSync(path.join(process.cwd(), ".local", "content-assets"))) {
    console.error("Run from the server/ directory — .local/content-assets not found under cwd.");
    process.exit(2);
  }
  if (!existsSync(SOURCE_ROOT)) {
    console.error(`Source folder not found: ${SOURCE_ROOT}`);
    process.exit(2);
  }

  let zips = (await findZips(SOURCE_ROOT)).sort();
  const blocked = zips.filter((z) => BLOCKED_ZIP_PATTERN.test(path.basename(z)));
  zips = zips.filter((z) => !BLOCKED_ZIP_PATTERN.test(path.basename(z)));
  if (only) zips = zips.filter((z) => path.basename(z).toLowerCase().includes(only));

  console.log(`${scanOnly ? "SCAN" : "IMPORT"}: ${zips.length} packs (${blocked.length} blocked as software)`);
  const collectionId = scanOnly ? "" : await ensureCollection();

  const totals = { packs: 0, imported: 0, skippedDuplicate: 0, skippedUnsupported: 0, importedBytes: 0, errors: 0 };
  for (const [index, zipPath] of zips.entries()) {
    const report = await importPack(zipPath, collectionId, scanOnly);
    totals.packs += 1;
    totals.imported += report.imported;
    totals.skippedDuplicate += report.skippedDuplicate;
    totals.skippedUnsupported += report.skippedUnsupported;
    totals.importedBytes += report.importedBytes;
    totals.errors += report.errors.length;
    console.log(
      `[${index + 1}/${zips.length}] ${report.zip} → category=${report.category} ` +
        `${scanOnly ? "would import" : "imported"}=${report.imported} dup=${report.skippedDuplicate} ` +
        `unsupported=${report.skippedUnsupported}${report.errors.length ? ` ERRORS=${report.errors.length}` : ""}`,
    );
    for (const err of report.errors) console.log(`    ! ${err}`);
  }

  await rm(STAGING_DIR, { recursive: true, force: true });
  console.log(
    `\nDONE (${scanOnly ? "scan only, nothing written" : "import"}): packs=${totals.packs} ` +
      `${scanOnly ? "wouldImport" : "imported"}=${totals.imported} dup=${totals.skippedDuplicate} ` +
      `unsupported=${totals.skippedUnsupported} bytes=${(totals.importedBytes / 1024 / 1024 / 1024).toFixed(2)}GB ` +
      `errors=${totals.errors}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
