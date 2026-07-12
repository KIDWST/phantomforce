/* Asset Vault Stage 4 — ingestion pipeline. Synthesizes real tiny media
   fixtures with ffmpeg's lavfi source filters (no checked-in binary
   fixtures needed) and runs them through the real provider.putAsset() path,
   which now calls the real asset-ingest.ts under the hood. If ffmpeg is not
   on PATH this suite still runs but only asserts the honest-degradation
   behavior (no width/height/derivatives, no crash) — it never fakes a pass. */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

const tempStateDir = await mkdtemp(path.join(os.tmpdir(), "phantomforce-asset-ingest-test-"));
process.env.PHANTOMFORCE_CONTENT_ASSET_DIR = tempStateDir;

const { resetAssetDbForTests } = await import("../src/phantom-ai/asset-db.js");
resetAssetDbForTests(); // in-memory index — without this, content-hash dedup would match stale rows from a prior real on-disk run

const { getContentAssetStorageProvider } = await import("../src/phantom-ai/content-asset-storage.js");
const { isFfmpegAvailable } = await import("../src/phantom-ai/asset-ingest.js");
const provider = getContentAssetStorageProvider();

const ffmpegAvailable = await isFfmpegAvailable();
console.log(`ffmpeg available: ${ffmpegAvailable}`);

const fixturesDir = await mkdtemp(path.join(os.tmpdir(), "phantomforce-ingest-fixtures-"));
const jpgPath = path.join(fixturesDir, "fixture.jpg");
const mp4Path = path.join(fixturesDir, "fixture.mp4");
const wavPath = path.join(fixturesDir, "fixture.wav");

if (ffmpegAvailable) {
  await execFileAsync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=red:s=64x48", "-frames:v", "1", jpgPath]);
  await execFileAsync("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=64x48:d=1",
    "-pix_fmt",
    "yuv420p",
    mp4Path,
  ]);
  await execFileAsync("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", wavPath]);
}

async function toDataUrl(filePath: string, mimeType: string): Promise<string> {
  const buffer = await readFile(filePath);
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

if (ffmpegAvailable) {
  // ---- image: dimensions + thumbnail -------------------------------------------

  const imagePut = await provider.putAsset({
    ownerScope: "ingest-scope",
    dataUrl: await toDataUrl(jpgPath, "image/jpeg"),
    originalName: "fixture.jpg",
    assetType: "image",
  });
  assert(imagePut.ok, "putAsset should succeed for a real JPEG.");
  if (imagePut.ok) {
    assert(imagePut.asset.id.length > 0, "a real asset id should be assigned.");

    const rawBytes = await readFile(jpgPath);
    const expectedHash = createHash("sha256").update(rawBytes).digest("hex");
    // content_hash isn't on ContentAssetRecord's public shape; fetch the raw row via the db module.
    const { getAssetById } = await import("../src/phantom-ai/asset-db.js");
    const rawAsset = getAssetById(imagePut.asset.id, "ingest-scope");
    assert(rawAsset !== null, "the inserted asset should be readable back from the index.");
    assert(rawAsset!.content_hash === expectedHash, "content_hash must be the real sha256 of the uploaded bytes.");
    assert(rawAsset!.width === 64 && rawAsset!.height === 48, "real ffprobe dimensions should be recorded for an image.");

    const derivatives = await provider.listDerivatives(imagePut.asset.id, "ingest-scope");
    assert(
      derivatives.some((d) => d.kind === "thumbnail"),
      "a real thumbnail derivative should be generated for an image asset.",
    );
    const thumbFile = await provider.getDerivativeFile(imagePut.asset.id, "ingest-scope", "thumbnail");
    assert(thumbFile.ok, "the generated thumbnail file should actually be readable back.");

    // ---- dedup: identical bytes must not create a second asset ------------------
    const secondPut = await provider.putAsset({
      ownerScope: "ingest-scope",
      dataUrl: await toDataUrl(jpgPath, "image/jpeg"),
      originalName: "fixture-again.jpg",
      assetType: "image",
    });
    assert(secondPut.ok && secondPut.asset.id === imagePut.asset.id, "uploading identical bytes must dedup to the same asset id.");
  }

  console.log("image ingestion (dimensions + thumbnail + dedup): all passed.");

  // ---- video: dimensions + duration + thumbnail + proxy -------------------------

  const videoPut = await provider.putAsset({
    ownerScope: "ingest-scope",
    dataUrl: await toDataUrl(mp4Path, "video/mp4"),
    originalName: "fixture.mp4",
    assetType: "video",
  });
  assert(videoPut.ok, "putAsset should succeed for a real MP4.");
  if (videoPut.ok) {
    const { getAssetById } = await import("../src/phantom-ai/asset-db.js");
    const rawAsset = getAssetById(videoPut.asset.id, "ingest-scope");
    assert(rawAsset!.width === 64 && rawAsset!.height === 48, "real ffprobe dimensions should be recorded for a video.");
    assert(
      typeof rawAsset!.duration_seconds === "number" && rawAsset!.duration_seconds! > 0,
      "real ffprobe duration should be recorded for a video.",
    );

    const derivatives = await provider.listDerivatives(videoPut.asset.id, "ingest-scope");
    assert(derivatives.some((d) => d.kind === "thumbnail"), "a real thumbnail should be generated for a video asset.");
    assert(derivatives.some((d) => d.kind === "proxy"), "a real proxy should be generated for a video asset.");
    const proxyFile = await provider.getDerivativeFile(videoPut.asset.id, "ingest-scope", "proxy");
    assert(proxyFile.ok, "the generated proxy file should actually be readable back.");
  }

  console.log("video ingestion (dimensions + duration + thumbnail + proxy): all passed.");

  // ---- audio: duration + waveform ------------------------------------------------

  const audioPut = await provider.putAsset({
    ownerScope: "ingest-scope",
    dataUrl: await toDataUrl(wavPath, "audio/wav"),
    originalName: "fixture.wav",
    assetType: "audio",
  });
  assert(audioPut.ok, "putAsset should succeed for a real WAV.");
  if (audioPut.ok) {
    const { getAssetById } = await import("../src/phantom-ai/asset-db.js");
    const rawAsset = getAssetById(audioPut.asset.id, "ingest-scope");
    assert(
      typeof rawAsset!.duration_seconds === "number" && rawAsset!.duration_seconds! > 0,
      "real ffprobe duration should be recorded for audio.",
    );

    const derivatives = await provider.listDerivatives(audioPut.asset.id, "ingest-scope");
    assert(derivatives.some((d) => d.kind === "waveform"), "a real waveform image should be generated for an audio asset.");
    const waveFile = await provider.getDerivativeFile(audioPut.asset.id, "ingest-scope", "waveform");
    assert(waveFile.ok, "the generated waveform file should actually be readable back.");

    // ---- deleting the asset must also remove its derivative file on disk ----------
    const deleted = await provider.deleteAsset(audioPut.asset.id, "ingest-scope");
    assert(deleted, "deleteAsset should succeed.");
    const afterDelete = await provider.getDerivativeFile(audioPut.asset.id, "ingest-scope", "waveform");
    assert(!afterDelete.ok, "a deleted asset's derivative file must no longer be readable.");
  }

  console.log("audio ingestion (duration + waveform + cascade cleanup): all passed.");
} else {
  // Honest degradation path: no ffmpeg, so no fabricated metadata/derivatives.
  const plainDataUrl = `data:image/jpeg;base64,${Buffer.from("not-real-jpeg-bytes").toString("base64")}`;
  const put = await provider.putAsset({ ownerScope: "ingest-scope", dataUrl: plainDataUrl, assetType: "image" });
  assert(put.ok, "putAsset should still succeed when ffmpeg is unavailable.");
  if (put.ok) {
    const derivatives = await provider.listDerivatives(put.asset.id, "ingest-scope");
    assert(derivatives.length === 0, "no derivatives should be fabricated when ffmpeg is unavailable.");
  }
  console.log("ffmpeg unavailable: honest-degradation path passed (no fabricated metadata).");
}

await rm(tempStateDir, { recursive: true, force: true });
await rm(fixturesDir, { recursive: true, force: true });

console.log(JSON.stringify({ ok: true, suite: "asset-ingest", ffmpegAvailable }, null, 2));
