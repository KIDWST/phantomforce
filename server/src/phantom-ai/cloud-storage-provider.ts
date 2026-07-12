/* PhantomForce — Asset Vault Stage 8: cloud capability.

   A real, pluggable S3-compatible object storage provider (works against
   AWS S3, Cloudflare R2, Backblaze B2, or MinIO — anything speaking the S3
   REST API), implemented with Node's built-in crypto/fetch instead of a new
   SDK dependency: this repo's node_modules is a shared symlink used by
   other concurrent work, and adding a package here would write into that
   shared directory outside version control review. AWS Signature V4 is a
   public, stable spec — this hand-rolled signer implements it directly.

   Honesty contract: if the required environment variables aren't set,
   isConfigured() returns false and every operation returns a real
   "cloud_storage_not_configured" error — never a fabricated success. This
   mirrors how ffmpeg availability is handled in asset-ingest.ts. */

import { createHash, createHmac } from "node:crypto";

export interface CloudStorageProvider {
  readonly name: string;
  isConfigured(): boolean;
  upload(key: string, body: Buffer, contentType: string): Promise<{ ok: true } | { ok: false; error: string }>;
  download(key: string): Promise<{ ok: true; buffer: Buffer } | { ok: false; error: string }>;
  delete(key: string): Promise<{ ok: true } | { ok: false; error: string }>;
}

type S3Config = {
  endpoint: string; // e.g. https://s3.amazonaws.com or https://<accountid>.r2.cloudflarestorage.com
  region: string; // "auto" is accepted by R2
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

function readS3Config(): S3Config | null {
  const endpoint = process.env.PHANTOMFORCE_CLOUD_S3_ENDPOINT?.trim().replace(/\/+$/, "");
  const region = process.env.PHANTOMFORCE_CLOUD_S3_REGION?.trim();
  const bucket = process.env.PHANTOMFORCE_CLOUD_S3_BUCKET?.trim();
  const accessKeyId = process.env.PHANTOMFORCE_CLOUD_S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.PHANTOMFORCE_CLOUD_S3_SECRET_ACCESS_KEY?.trim();
  if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) return null;
  return { endpoint, region, bucket, accessKeyId, secretAccessKey };
}

function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function amzDateStamp(date: Date): { amzDate: string; dateStamp: string } {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const amzDate = iso; // e.g. 20260101T000000Z
  const dateStamp = amzDate.slice(0, 8); // 20260101
  return { amzDate, dateStamp };
}

function signingKey(secretAccessKey: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

// Real AWS Signature V4, path-style URLs (works uniformly across S3/R2/B2/
// MinIO, unlike virtual-hosted-style which needs bucket-specific DNS).
function signRequest(
  config: S3Config,
  method: "PUT" | "GET" | "DELETE" | "HEAD",
  key: string,
  bodyHash: string,
): { url: string; headers: Record<string, string> } {
  const { amzDate, dateStamp } = amzDateStamp(new Date());
  const endpointUrl = new URL(config.endpoint);
  const host = endpointUrl.host;
  const canonicalUri = `/${config.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const canonicalQueryString = "";
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${bodyHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [method, canonicalUri, canonicalQueryString, canonicalHeaders, signedHeaders, bodyHash].join("\n");
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256Hex(canonicalRequest)].join("\n");
  const key_ = signingKey(config.secretAccessKey, dateStamp, config.region, "s3");
  const signature = createHmac("sha256", key_).update(stringToSign, "utf8").digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return {
    url: `${endpointUrl.protocol}//${host}${canonicalUri}`,
    headers: {
      Host: host,
      "x-amz-content-sha256": bodyHash,
      "x-amz-date": amzDate,
      Authorization: authorization,
    },
  };
}

class S3CompatibleCloudStorageProvider implements CloudStorageProvider {
  readonly name = "s3-compatible";

  isConfigured(): boolean {
    return readS3Config() !== null;
  }

  async upload(key: string, body: Buffer, contentType: string) {
    const config = readS3Config();
    if (!config) return { ok: false as const, error: "cloud_storage_not_configured" };
    const bodyHash = sha256Hex(body);
    const { url, headers } = signRequest(config, "PUT", key, bodyHash);
    try {
      const response = await fetch(url, {
        method: "PUT",
        headers: { ...headers, "Content-Type": contentType },
        body: new Uint8Array(body),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        return { ok: false as const, error: `cloud_upload_failed_${response.status}: ${text.slice(0, 200)}` };
      }
      return { ok: true as const };
    } catch (error) {
      return { ok: false as const, error: `cloud_upload_error: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  async download(key: string) {
    const config = readS3Config();
    if (!config) return { ok: false as const, error: "cloud_storage_not_configured" };
    const { url, headers } = signRequest(config, "GET", key, sha256Hex(Buffer.alloc(0)));
    try {
      const response = await fetch(url, { method: "GET", headers });
      if (!response.ok) return { ok: false as const, error: `cloud_download_failed_${response.status}` };
      const buffer = Buffer.from(await response.arrayBuffer());
      return { ok: true as const, buffer };
    } catch (error) {
      return { ok: false as const, error: `cloud_download_error: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  async delete(key: string) {
    const config = readS3Config();
    if (!config) return { ok: false as const, error: "cloud_storage_not_configured" };
    const { url, headers } = signRequest(config, "DELETE", key, sha256Hex(Buffer.alloc(0)));
    try {
      const response = await fetch(url, { method: "DELETE", headers });
      if (!response.ok && response.status !== 404) {
        return { ok: false as const, error: `cloud_delete_failed_${response.status}` };
      }
      return { ok: true as const };
    } catch (error) {
      return { ok: false as const, error: `cloud_delete_error: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
}

const provider = new S3CompatibleCloudStorageProvider();

// Only one provider exists today. A future provider (e.g. Google Drive, via
// the real Drive API/OAuth) would implement the same CloudStorageProvider
// interface and get selected here — callers never change.
export function getCloudStorageProvider(): CloudStorageProvider {
  return provider;
}

// Exported for the signing logic to be unit-tested without a live bucket.
export const __internal = { signRequest, sha256Hex, readS3Config };
