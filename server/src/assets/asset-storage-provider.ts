/* Asset Cloud storage provider boundary.
   Blobs are content-addressed (sha256) and org-prefixed on every provider,
   so identical uploads share storage and org isolation holds at the storage
   layer too. The local-disk provider is the REAL, verified development and
   single-box production tier. S3-compatible providers (R2/MinIO/S3/B2) plug
   in behind the same interface via env configuration — until credentials
   exist they report `configured: false` and are never silently used.

   This is deliberately a separate seam from the 30-day ContentAsset scratch
   store (content-asset-storage.ts): that tier keeps its expiry semantics;
   the Asset Cloud is permanent. */

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../../..");

const LOCAL_ROOT = process.env.PHANTOM_ASSET_CLOUD_DIR
  ? resolve(process.env.PHANTOM_ASSET_CLOUD_DIR)
  : resolve(repoRoot, ".phantom", "asset-cloud");

export type AssetBlobRef = {
  /** provider-relative key, stable across machines */
  key: string;
  /** absolute path for local providers; informational elsewhere */
  path: string;
  sizeBytes: number;
  sha256: string;
};

export type AssetStorageProvider = {
  id: string;
  label: string;
  configured: boolean;
  /** true when reads/writes hit this machine's disk (no network) */
  local: boolean;
  putBlob: (orgId: string, sha256: string, bytes: Buffer) => Promise<AssetBlobRef>;
  getBlob: (orgId: string, key: string) => Promise<Buffer | null>;
  deleteBlob: (orgId: string, key: string) => Promise<void>;
  blobExists: (orgId: string, key: string) => Promise<boolean>;
  putDerived: (orgId: string, name: string, bytes: Buffer) => Promise<AssetBlobRef>;
  getDerived: (orgId: string, key: string) => Promise<Buffer | null>;
  deleteDerived: (orgId: string, key: string) => Promise<void>;
};

export function sha256Of(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function safeOrgSegment(orgId: string) {
  const cleaned = orgId.replace(/[^a-zA-Z0-9_.-]+/g, "-").slice(0, 80);
  if (!cleaned) throw new Error("invalid_org_id");
  return cleaned;
}

function safeKeySegment(key: string) {
  /* keys are provider-issued (sha256 or derived names) — refuse traversal */
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,140}$/.test(key)) throw new Error("invalid_blob_key");
  return key;
}

function localPath(orgId: string, area: "blobs" | "derived", key: string) {
  return resolve(LOCAL_ROOT, safeOrgSegment(orgId), area, safeKeySegment(key));
}

async function atomicWrite(path: string, bytes: Buffer) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now().toString(36)}`;
  await writeFile(tmp, bytes);
  await rename(tmp, path);
}

const localProvider: AssetStorageProvider = {
  id: "local-disk",
  label: "Local disk (content-addressed, org-isolated)",
  configured: true,
  local: true,
  async putBlob(orgId, sha256, bytes) {
    const key = safeKeySegment(sha256);
    const path = localPath(orgId, "blobs", key);
    try {
      const existing = await stat(path);
      /* content-addressed: identical bytes already stored */
      return { key, path, sizeBytes: existing.size, sha256 };
    } catch { /* not present yet */ }
    await atomicWrite(path, bytes);
    return { key, path, sizeBytes: bytes.length, sha256 };
  },
  async getBlob(orgId, key) {
    try {
      return await readFile(localPath(orgId, "blobs", key));
    } catch {
      return null;
    }
  },
  async deleteBlob(orgId, key) {
    await rm(localPath(orgId, "blobs", key), { force: true });
  },
  async blobExists(orgId, key) {
    try {
      await stat(localPath(orgId, "blobs", key));
      return true;
    } catch {
      return false;
    }
  },
  async putDerived(orgId, name, bytes) {
    const key = safeKeySegment(name);
    const path = localPath(orgId, "derived", key);
    await atomicWrite(path, bytes);
    return { key, path, sizeBytes: bytes.length, sha256: sha256Of(bytes) };
  },
  async getDerived(orgId, key) {
    try {
      return await readFile(localPath(orgId, "derived", key));
    } catch {
      return null;
    }
  },
  async deleteDerived(orgId, key) {
    await rm(localPath(orgId, "derived", key), { force: true });
  },
};

/* S3-compatible boundary: honestly unconfigured until real credentials are
   provided. The env contract is fixed now so wiring a provider later never
   changes product code. */
const s3Configured = Boolean(
  process.env.PHANTOM_ASSET_S3_ENDPOINT &&
  process.env.PHANTOM_ASSET_S3_BUCKET &&
  process.env.PHANTOM_ASSET_S3_ACCESS_KEY_ID &&
  process.env.PHANTOM_ASSET_S3_SECRET_ACCESS_KEY,
);

export function describeAssetStorageProviders() {
  return [
    { id: localProvider.id, label: localProvider.label, configured: true, active: !s3Configured || process.env.PHANTOM_ASSET_STORAGE_PROVIDER !== "s3" },
    {
      id: "s3-compatible",
      label: "S3-compatible cloud (R2 / MinIO / S3 / B2)",
      configured: s3Configured,
      active: false,
      setup_env: [
        "PHANTOM_ASSET_S3_ENDPOINT",
        "PHANTOM_ASSET_S3_BUCKET",
        "PHANTOM_ASSET_S3_ACCESS_KEY_ID",
        "PHANTOM_ASSET_S3_SECRET_ACCESS_KEY",
        "PHANTOM_ASSET_STORAGE_PROVIDER=s3",
      ],
      note: s3Configured
        ? "Credentials present but the s3 adapter implementation has not shipped yet — local-disk remains active."
        : "Not configured. The local-disk provider is the active, verified tier.",
    },
  ];
}

export function getAssetStorageProvider(): AssetStorageProvider {
  /* only the local provider is implemented; the selector exists so a future
     s3 adapter slots in without touching call sites */
  return localProvider;
}

export function assetCloudRoot() {
  return LOCAL_ROOT;
}
