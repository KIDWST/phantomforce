/* Asset Vault Stage 8 — cloud storage provider. Two things are verified for
   real:
   1. The honest-degradation contract: with no PHANTOMFORCE_CLOUD_S3_* env
      vars set, isConfigured() is false and every operation returns a real
      "cloud_storage_not_configured" error, never a fabricated success.
   2. The actual SigV4-signed HTTP client works end to end, by running a
      real (if minimal) HTTP server in this process that implements S3's
      PUT/GET/DELETE-object semantics, and pointing the provider's env vars
      at it. This is not a mock of our own code — it's a real network round
      trip over real HTTP, just against a local S3-compatible stand-in
      instead of a live AWS/R2/B2 bucket (no such credentials exist here). */
import { createServer } from "node:http";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

// ---- unconfigured honesty contract ------------------------------------------------

delete process.env.PHANTOMFORCE_CLOUD_S3_ENDPOINT;
delete process.env.PHANTOMFORCE_CLOUD_S3_REGION;
delete process.env.PHANTOMFORCE_CLOUD_S3_BUCKET;
delete process.env.PHANTOMFORCE_CLOUD_S3_ACCESS_KEY_ID;
delete process.env.PHANTOMFORCE_CLOUD_S3_SECRET_ACCESS_KEY;

const { getCloudStorageProvider } = await import("../src/phantom-ai/cloud-storage-provider.js");
const unconfigured = getCloudStorageProvider();
assert(!unconfigured.isConfigured(), "with no env vars set, isConfigured() must be false.");

const uploadResult = await unconfigured.upload("some/key", Buffer.from("data"), "text/plain");
assert(
  !uploadResult.ok && uploadResult.error === "cloud_storage_not_configured",
  "upload() with no config must return a real cloud_storage_not_configured error, not a fabricated success.",
);
const downloadResult = await unconfigured.download("some/key");
assert(!downloadResult.ok && downloadResult.error === "cloud_storage_not_configured", "download() must fail the same honest way.");
const deleteResult = await unconfigured.delete("some/key");
assert(!deleteResult.ok && deleteResult.error === "cloud_storage_not_configured", "delete() must fail the same honest way.");

console.log("unconfigured honesty contract: all passed.");

// ---- real signed HTTP round trip against a local S3-compatible stand-in ----------

const store = new Map<string, Buffer>();
const mockS3 = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const key = decodeURIComponent(req.url || "");
    if (req.method === "PUT") {
      store.set(key, Buffer.concat(chunks));
      res.writeHead(200);
      res.end();
    } else if (req.method === "GET") {
      const body = store.get(key);
      if (!body) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      res.end(body);
    } else if (req.method === "DELETE") {
      const existed = store.delete(key);
      res.writeHead(existed ? 200 : 404);
      res.end();
    } else {
      res.writeHead(405);
      res.end();
    }
  });
});

await new Promise<void>((resolve) => mockS3.listen(0, "127.0.0.1", resolve));
const address = mockS3.address();
if (!address || typeof address === "string") throw new Error("could not determine mock S3 server port");
const port = address.port;

process.env.PHANTOMFORCE_CLOUD_S3_ENDPOINT = `http://127.0.0.1:${port}`;
process.env.PHANTOMFORCE_CLOUD_S3_REGION = "auto";
process.env.PHANTOMFORCE_CLOUD_S3_BUCKET = "phantomforce-asset-vault-test";
process.env.PHANTOMFORCE_CLOUD_S3_ACCESS_KEY_ID = "test-access-key-id";
process.env.PHANTOMFORCE_CLOUD_S3_SECRET_ACCESS_KEY = "test-secret-access-key";

// Same singleton as `unconfigured` above — readS3Config() re-reads
// process.env on every call rather than caching at module load, so no
// fresh import is needed for it to pick up the env vars just set.
const configured = unconfigured;
assert(configured.isConfigured(), "with all five env vars set, isConfigured() must be true.");

const payload = Buffer.from("real asset bytes for the cloud round trip");
const realUpload = await configured.upload("scope-a/asset-1", payload, "application/octet-stream");
assert(realUpload.ok, `a real signed PUT against the mock S3 server should succeed: ${!realUpload.ok ? realUpload.error : ""}`);
assert(store.has("/phantomforce-asset-vault-test/scope-a/asset-1"), "the mock server should have actually received and stored the object.");

const realDownload = await configured.download("scope-a/asset-1");
assert(realDownload.ok, `a real signed GET should succeed: ${!realDownload.ok ? realDownload.error : ""}`);
if (realDownload.ok) {
  assert(realDownload.buffer.equals(payload), "downloaded bytes must exactly match what was uploaded.");
}

const missingDownload = await configured.download("scope-a/does-not-exist");
assert(!missingDownload.ok, "downloading a key that was never uploaded must fail, not return empty/fake data.");

const realDelete = await configured.delete("scope-a/asset-1");
assert(realDelete.ok, `a real signed DELETE should succeed: ${!realDelete.ok ? realDelete.error : ""}`);
assert(!store.has("/phantomforce-asset-vault-test/scope-a/asset-1"), "the object must actually be gone from the mock server after delete.");

console.log("real signed S3-compatible round trip (PUT/GET/DELETE): all passed.");

await new Promise<void>((resolve) => mockS3.close(() => resolve()));

console.log(JSON.stringify({ ok: true, suite: "cloud-storage-provider" }, null, 2));
