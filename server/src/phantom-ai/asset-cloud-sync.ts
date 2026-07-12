/* PhantomForce — Asset Vault Stage 8: cloud sync operations.

   Ties the real S3-compatible provider (cloud-storage-provider.ts) to the
   real local files (content-asset-storage.ts) and the real index
   (asset-db.ts). Every function here either performs a genuine network
   call or returns an honest "not configured"/"not found" error — nothing
   here ever marks an asset as cloud-available without a provider call that
   actually succeeded. */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { contentAssetFilesDir } from "./content-asset-storage.js";
import { getCloudStorageProvider } from "./cloud-storage-provider.js";
import { getAssetById, setAssetAvailability, setAssetCloudLocation, clearAssetCloudLocation } from "./asset-db.js";

export type CloudCapabilityStatus = { configured: boolean; provider: string };

export function getCloudCapabilityStatus(): CloudCapabilityStatus {
  const provider = getCloudStorageProvider();
  return { configured: provider.isConfigured(), provider: provider.name };
}

function cloudKeyFor(ownerScope: string, assetId: string): string {
  return `${ownerScope}/${assetId}`;
}

export async function uploadAssetToCloud(assetId: string, ownerScope: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const provider = getCloudStorageProvider();
  if (!provider.isConfigured()) return { ok: false, error: "cloud_storage_not_configured" };

  const asset = getAssetById(assetId, ownerScope);
  if (!asset) return { ok: false, error: "not_found" };

  let buffer: Buffer;
  try {
    buffer = await readFile(path.join(contentAssetFilesDir(), asset.storage_key));
  } catch {
    return { ok: false, error: "local_file_missing" };
  }

  const cloudKey = cloudKeyFor(ownerScope, assetId);
  const result = await provider.upload(cloudKey, buffer, asset.mime_type);
  if (!result.ok) return result;

  setAssetCloudLocation(assetId, ownerScope, provider.name, cloudKey);
  setAssetAvailability(assetId, ownerScope, "local_and_cloud");
  return { ok: true };
}

export async function downloadAssetFromCloud(assetId: string, ownerScope: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const provider = getCloudStorageProvider();
  if (!provider.isConfigured()) return { ok: false, error: "cloud_storage_not_configured" };

  const asset = getAssetById(assetId, ownerScope);
  if (!asset) return { ok: false, error: "not_found" };
  if (!asset.cloud_key) return { ok: false, error: "no_cloud_copy" };

  const result = await provider.download(asset.cloud_key);
  if (!result.ok) return result;

  const dir = contentAssetFilesDir();
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, asset.storage_key), result.buffer);
  setAssetAvailability(assetId, ownerScope, "local_and_cloud");
  return { ok: true };
}

export async function removeAssetFromCloud(assetId: string, ownerScope: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const provider = getCloudStorageProvider();
  if (!provider.isConfigured()) return { ok: false, error: "cloud_storage_not_configured" };

  const asset = getAssetById(assetId, ownerScope);
  if (!asset) return { ok: false, error: "not_found" };
  if (!asset.cloud_key) return { ok: false, error: "no_cloud_copy" };

  const result = await provider.delete(asset.cloud_key);
  if (!result.ok) return result;

  clearAssetCloudLocation(assetId, ownerScope);
  setAssetAvailability(assetId, ownerScope, "local");
  return { ok: true };
}
