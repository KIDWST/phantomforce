/* PhantomForce — Motion Array import verification.
   Read-only summary of what import-motionarray.ts put in the vault:
   counts by category tag, derivative coverage, collection membership,
   and a sample of records. Run from server/: npx tsx scripts/verify-motionarray-import.ts */

import { getAssetDb } from "../src/phantom-ai/asset-db.js";

const db = getAssetDb();

const assets = db
  .prepare(
    `SELECT id, original_name, asset_type, tier, width, height, duration_seconds, availability, file_size_bytes
     FROM assets WHERE source = 'motionarray' AND owner_scope = 'phantomforce-owner'`,
  )
  .all() as Array<Record<string, unknown>>;

console.log(`motionarray assets: ${assets.length}`);
const byType = new Map<string, number>();
for (const a of assets) byType.set(String(a.asset_type), (byType.get(String(a.asset_type)) ?? 0) + 1);
console.log("by type:", Object.fromEntries(byType));

const tagCounts = db
  .prepare(
    `SELECT tags.name AS name, COUNT(*) AS n FROM tags
     JOIN asset_tags ON asset_tags.tag_id = tags.id
     JOIN assets ON assets.id = asset_tags.asset_id
     WHERE assets.source = 'motionarray' AND tags.owner_scope = 'phantomforce-owner'
       AND tags.name IN ('motionarray','elements','gfx','macros','mockups','soccer','titles','transitions','logos','text-effects','templates','overlays','library')
     GROUP BY tags.name ORDER BY n DESC`,
  )
  .all() as Array<{ name: string; n: number }>;
console.log("category tag counts:", tagCounts.map((t) => `${t.name}=${t.n}`).join(" "));

const derivCounts = db
  .prepare(
    `SELECT asset_derivatives.kind AS kind, COUNT(*) AS n FROM asset_derivatives
     JOIN assets ON assets.id = asset_derivatives.asset_id
     WHERE assets.source = 'motionarray' GROUP BY asset_derivatives.kind`,
  )
  .all() as Array<{ kind: string; n: number }>;
console.log("derivatives:", derivCounts.map((d) => `${d.kind}=${d.n}`).join(" "));

const inCollection = db
  .prepare(
    `SELECT COUNT(*) AS n FROM collection_assets
     JOIN collections ON collections.id = collection_assets.collection_id
     JOIN assets ON assets.id = collection_assets.asset_id
     WHERE collections.name = 'Motion Array Library' AND assets.source = 'motionarray'`,
  )
  .get() as { n: number };
console.log(`in "Motion Array Library" collection: ${inCollection.n}`);

const totalBytes = assets.reduce((sum, a) => sum + Number(a.file_size_bytes ?? 0), 0);
console.log(`total size: ${(totalBytes / 1024 / 1024 / 1024).toFixed(2)} GB`);

const missingDims = assets.filter((a) => a.width === null).length;
console.log(`assets without probed dimensions: ${missingDims}`);

console.log("\nsample:");
for (const a of assets.slice(0, 5)) {
  const tags = db
    .prepare(`SELECT tags.name AS name FROM tags JOIN asset_tags ON asset_tags.tag_id = tags.id WHERE asset_tags.asset_id = ?`)
    .all(a.id) as Array<{ name: string }>;
  console.log(
    ` - ${a.original_name} [${a.asset_type}, ${a.width}x${a.height}, ${a.duration_seconds ?? "-"}s, tier=${a.tier}] tags: ${tags.map((t) => t.name).join(", ")}`,
  );
}
