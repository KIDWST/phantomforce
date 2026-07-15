import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const tempDir = mkdtempSync(join(tmpdir(), "phantom-receipt-test-"));
const originalDir = process.env.PHANTOMFORCE_RECEIPT_ASSET_DIR;
process.env.PHANTOMFORCE_RECEIPT_ASSET_DIR = tempDir;

try {
  const { getReceiptAssetStorageProvider } = await import("../src/connectors/receipt-asset-storage.js");
  const provider = getReceiptAssetStorageProvider();

  const tinyPngDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const stored = await provider.putAsset({ ownerScope: "owner-jordan", dataUrl: tinyPngDataUrl, originalName: "receipt.png" });
  assert(stored.ok, "storing a valid receipt image must succeed");
  if (!stored.ok) throw new Error("unreachable");
  assert(stored.asset.mime_type === "image/png", "stored asset must record the correct mime type");
  assert(!("expires_at" in stored.asset), "receipt assets must not carry an expiry field");

  const wrongScope = await provider.getAssetFile(stored.asset.id, "someone-else");
  assert(wrongScope.ok === false, "a different owner scope must not be able to read the receipt");

  const read = await provider.getAssetFile(stored.asset.id, "owner-jordan");
  assert(read.ok === true, "the owning scope must be able to read the receipt back");
  if (read.ok) assert(read.dataUrl.startsWith("data:image/png;base64,"), "read-back data URL must round-trip the mime type");

  const oversized = "data:image/png;base64," + "A".repeat(20_000_000);
  const rejected = await provider.putAsset({ ownerScope: "owner-jordan", dataUrl: oversized });
  assert(rejected.ok === false, "an oversized upload must be rejected");

  const deleted = await provider.deleteAsset(stored.asset.id, "owner-jordan");
  assert(deleted === true, "delete must succeed for the owning scope");
  const afterDelete = await provider.getAssetFile(stored.asset.id, "owner-jordan");
  assert(afterDelete.ok === false, "a deleted receipt must no longer be readable");

  console.log(JSON.stringify({ ok: true, suite: "receipt-asset-storage" }));
} finally {
  if (originalDir === undefined) delete process.env.PHANTOMFORCE_RECEIPT_ASSET_DIR;
  else process.env.PHANTOMFORCE_RECEIPT_ASSET_DIR = originalDir;
  rmSync(tempDir, { recursive: true, force: true });
}
