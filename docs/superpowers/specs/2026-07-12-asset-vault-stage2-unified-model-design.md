# Asset Vault — Stage 2: Unified Asset Model

Status: approved, implementing.

## Goal

Give PhantomForce's real, working proto-asset-system (Content Hub's asset
registration + `content-asset-storage.ts`) a stable, tenant-scoped, queryable
data model — the foundation every later stage (cache policy, ingestion
pipeline, AI search, PhantomCut integration, presets) depends on. This is
Stage 2 of a larger mission; earlier stages (discovery) are complete, later
stages (cache manager, ingestion pipeline, search/embeddings, PhantomCut UI,
presets, cloud sync, admin tools) are explicitly out of scope here.

## Discovery summary (full detail in the conversation that produced this spec)

- `phantomcut-ai` has no asset system of any kind to merge with — it's a
  control-plane for DaVinci Resolve/Higgsfield/MoneyPrinter/REAPER, not an
  editor with its own asset library. Its own roadmap already calls for a
  "generated asset inbox," confirming this gap is real, not invented.
- This repo's `server/src/phantom-ai/content-asset-storage.ts` is the one
  genuine proto-asset-system found anywhere in the PhantomForce/PhantomCut
  codebases: a real, working, pluggable storage provider behind real routes,
  with real records on disk today. It was scoped for a narrow job (a 30-day
  cache behind Content Hub's social-post aggregator), not a tenant-isolated,
  taggable, cross-feature vault — hence this stage.
- **Correction made during implementation, after direct code reading**: initial
  research claimed asset scoping was hardcoded to `owner-admin` and that no
  client code sent `currentTenantId()` to these routes. Reading the actual
  code (`app/js/mediabackend.js`'s `syncAssetUpload`/`listSyncedAssets`/
  `fetchSyncedAssetFile`, and `server/src/index.ts`'s `contentAssetOwnerScope`)
  shows this is already correct for admin/workspace sessions: the client
  already sends `tenant_id: currentTenantId()` on every call, and the server
  already uses it to scope `owner_scope` for sessions with `canManageAccess`
  (i.e. Jordan's own admin sessions). The narrower, real behavior: for
  non-admin (restricted client) sessions, `owner_scope` is keyed by
  `session.clientId` rather than the workspace tenant id — which isolates
  different external clients from each other correctly, it just doesn't also
  subdivide by internal workspace, and there's no evidence that's actually
  needed for a client login. **There is no tenant-scoping bug to fix here.**
  This stage preserves `owner_scope` and its existing derivation exactly as
  the new model's partition key, rather than introducing a parallel
  `tenant_id` concept that would misrepresent working access-control logic.
- No database exists anywhere in this repo today — everything is local-disk
  JSON + localStorage.
- `PhantomForce-App` (a separate, not-live rewrite) has a real Postgres/Prisma
  multi-tenant schema (Org/Membership/etc.) but no Asset/Media table at all;
  not relevant to reuse here since this repo doesn't share that database.

## Architecture: extend, don't replace

`content-asset-storage.ts` keeps its `ContentAssetStorageProvider` interface
and its local-disk file storage exactly as-is — that part already works and
Content Hub/Media Lab depend on it today. What changes is what backs its
index: a new SQLite database (`server/src/phantom-ai/asset-db.ts`) using
Node's built-in `node:sqlite` (confirmed working on this repo's required
Node >=22, specifically verified against the exact Node 22.22.3 binary that
runs the live server — zero new dependencies, no native-module build risk).
Node itself marks this module experimental; that's a real, visible tradeoff
of this choice, not hidden.

Existing HTTP routes (`POST/GET/DELETE /phantom-ai/content/assets[/:id/file]`)
keep their exact current response shape — `contenthub.js` and `medialab.js`
need zero changes to keep working. Tags and collections are new, additive
routes only.

## Data model

```sql
CREATE TABLE assets (
  id TEXT PRIMARY KEY,               -- stable UUID, independent of file path
  owner_scope TEXT NOT NULL,         -- exactly what contentAssetOwnerScope() already
                                     -- computes today: workspace tenant id for admin
                                     -- sessions, session.clientId for restricted client
                                     -- sessions. Reused as-is, not replaced.
  asset_type TEXT NOT NULL,          -- image | video | audio | ... (matches Content Hub's existing `type`)
  title TEXT,
  description TEXT,
  source TEXT,                      -- upload | generated | ... (matches existing field)
  provider TEXT,
  model TEXT,
  style TEXT,
  aspect TEXT,
  duration_seconds REAL,
  mime_type TEXT,
  extension TEXT,
  file_size_bytes INTEGER,
  width INTEGER,
  height INTEGER,
  content_hash TEXT,                 -- groundwork for Stage 4 dedup; cheap to add now
  storage_provider TEXT NOT NULL,    -- which ContentAssetStorageProvider backs this
  storage_key TEXT NOT NULL,         -- path/key within that provider — decoupled from id
  tier TEXT NOT NULL DEFAULT 'cache', -- 'vault' (never auto-expires) | 'cache' (existing 30-day policy)
  favorite INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  legacy_synced_id TEXT,              -- traceability back to the pre-migration JSON index
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT                     -- only meaningful when tier = 'cache'
);
CREATE INDEX idx_assets_owner_scope ON assets(owner_scope);
CREATE INDEX idx_assets_content_hash ON assets(content_hash);

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  owner_scope TEXT NOT NULL,
  name TEXT NOT NULL,
  UNIQUE(owner_scope, name)
);
CREATE TABLE asset_tags (
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (asset_id, tag_id)
);

CREATE TABLE collections (
  id TEXT PRIMARY KEY,
  owner_scope TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE collection_assets (
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  PRIMARY KEY (collection_id, asset_id)
);
```

Explicitly out of scope for this stage: asset packs (bundling + licensing +
versioning), thumbnails/proxies/waveforms (Stage 4 — ingestion pipeline),
embeddings/semantic search (Stage 5), any cache eviction policy beyond the
existing 30-day `cache` tier expiry (Stage 3 proper).

## Access scoping (preserved, not fixed)

No changes needed to `contentAssetOwnerScope()`, the three route handlers,
or `mediabackend.js`'s sync calls — all already correctly resolve and send
`owner_scope`/`tenant_id` today. The new SQLite model's `owner_scope` column
is populated with exactly the same string those routes already compute, and
every query (`listAssets`, tag/collection lookups) filters by it, the same
way `listAssets(ownerScope)` already filters the JSON index today. A test
proves this explicitly: an asset created under one `owner_scope` must not
be visible when queried under another.

## Migration

On first server start after this change, if the SQLite file doesn't exist
yet, a migration step reads the existing JSON-index records (4 real ones
today) and backfills them into `assets`, carrying each record's existing
`owner_scope` straight over unchanged, and `tier = 'cache'` (preserving their current
expiry behavior — nothing that was subject to 30-day expiry before silently
becomes permanent). Each row's `storage_key` points at the exact same file
already on disk — no file is moved or copied, so there is zero data-loss
risk. The old JSON index file is left in place, untouched, as a reversible
fallback (not deleted). This runs automatically rather than as a manual
step, since this is a solo local admin app where a forgotten manual
migration step would just mean silently missing data.

## Production safety

This repo auto-deploys on push to `main`. All of this work happens on a
dedicated local branch (`asset-vault-stage2-unified-model`), not `main`.
Nothing is pushed or merged without explicit review and sign-off — this is
a hard stop, not a default-yes.

## Testing

This repo's convention is standalone `tsx scripts/test-*.ts` scripts (no
vitest/jest configured) — `server/scripts/test-asset-vault.ts` follows that
exact pattern rather than introducing a new one. Covers: schema creation,
CRUD, owner_scope isolation (an asset created under one scope is invisible
when queried under another), migration correctness against real fixture JSON
records, tags/collections CRUD, and that existing routes' response shapes
are unchanged (a regression check against what Content Hub/Media Lab
actually read today).
