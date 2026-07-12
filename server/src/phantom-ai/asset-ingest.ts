/* PhantomForce — Asset Vault Stage 4: ingestion pipeline.

   Real content-hash dedup and real media probing/derivative generation via
   the ffmpeg/ffprobe binaries actually installed on this machine. If ffmpeg
   is not on PATH, every function here degrades honestly: dimensions/
   derivatives are simply skipped (asset still ingests, availability stays
   accurate) — nothing here ever fabricates a thumbnail, a duration, or a
   waveform. No caller should assume derivatives exist; check the returned
   IngestResult or query listDerivativesForAsset(). */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { setAssetContentHash, setAssetDimensions, upsertDerivative, type DerivativeRecord } from "./asset-db.js";

const execFileAsync = promisify(execFile);

const FFMPEG_BIN = process.env.PHANTOMFORCE_FFMPEG_PATH || "ffmpeg";
const FFPROBE_BIN = process.env.PHANTOMFORCE_FFPROBE_PATH || "ffprobe";

let ffmpegAvailableCache: boolean | null = null;

// Checked once per process, not once per asset — a missing binary should
// never be re-discovered on every single upload.
export async function isFfmpegAvailable(): Promise<boolean> {
  if (ffmpegAvailableCache !== null) return ffmpegAvailableCache;
  try {
    await execFileAsync(FFMPEG_BIN, ["-version"]);
    await execFileAsync(FFPROBE_BIN, ["-version"]);
    ffmpegAvailableCache = true;
  } catch {
    ffmpegAvailableCache = false;
  }
  return ffmpegAvailableCache;
}

// Test-only: force a re-check next time (e.g. after changing env vars).
export function resetFfmpegAvailabilityCacheForTests(): void {
  ffmpegAvailableCache = null;
}

export function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export type ProbedMedia = { width: number | null; height: number | null; durationSeconds: number | null };

// Real ffprobe call, parsed from its actual JSON output — never inferred
// from a file extension or a guessed aspect ratio.
export async function probeMediaMetadata(filePath: string): Promise<ProbedMedia | null> {
  if (!(await isFfmpegAvailable())) return null;
  try {
    const { stdout } = await execFileAsync(FFPROBE_BIN, [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      filePath,
    ]);
    const parsed = JSON.parse(stdout) as {
      format?: { duration?: string };
      streams?: Array<{ codec_type?: string; width?: number; height?: number; duration?: string }>;
    };
    const videoStream = parsed.streams?.find((s) => s.codec_type === "video");
    const durationRaw = videoStream?.duration ?? parsed.format?.duration;
    const durationSeconds = durationRaw ? Number.parseFloat(durationRaw) : null;
    return {
      width: typeof videoStream?.width === "number" ? videoStream.width : null,
      height: typeof videoStream?.height === "number" ? videoStream.height : null,
      durationSeconds: durationSeconds !== null && Number.isFinite(durationSeconds) ? durationSeconds : null,
    };
  } catch {
    return null; // unreadable/corrupt media — honestly reported as "could not probe", not faked
  }
}

const THUMBNAIL_WIDTH = 320;
const PROXY_WIDTH = 640;
const WAVEFORM_SIZE = "640x120";

type DerivativeResult = { width: number | null; height: number | null; fileSizeBytes: number } | null;

async function runFfmpeg(args: string[]): Promise<boolean> {
  try {
    await execFileAsync(FFMPEG_BIN, args);
    return true;
  } catch {
    return false;
  }
}

export async function generateImageThumbnail(sourcePath: string, destPath: string): Promise<DerivativeResult> {
  if (!(await isFfmpegAvailable())) return null;
  const ok = await runFfmpeg(["-y", "-i", sourcePath, "-vf", `scale=${THUMBNAIL_WIDTH}:-1`, "-frames:v", "1", destPath]);
  if (!ok) return null;
  const probed = await probeMediaMetadata(destPath);
  const size = await stat(destPath);
  return { width: probed?.width ?? null, height: probed?.height ?? null, fileSizeBytes: size.size };
}

export async function generateVideoThumbnail(sourcePath: string, destPath: string): Promise<DerivativeResult> {
  if (!(await isFfmpegAvailable())) return null;
  const ok = await runFfmpeg([
    "-y",
    "-ss",
    "00:00:00.5",
    "-i",
    sourcePath,
    "-vf",
    `scale=${THUMBNAIL_WIDTH}:-1`,
    "-frames:v",
    "1",
    destPath,
  ]);
  if (!ok) return null;
  const probed = await probeMediaMetadata(destPath);
  const size = await stat(destPath);
  return { width: probed?.width ?? null, height: probed?.height ?? null, fileSizeBytes: size.size };
}

export async function generateVideoProxy(sourcePath: string, destPath: string): Promise<DerivativeResult> {
  if (!(await isFfmpegAvailable())) return null;
  const ok = await runFfmpeg([
    "-y",
    "-i",
    sourcePath,
    "-vf",
    `scale=${PROXY_WIDTH}:-2`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "28",
    "-c:a",
    "aac",
    "-b:a",
    "96k",
    destPath,
  ]);
  if (!ok) return null;
  const probed = await probeMediaMetadata(destPath);
  const size = await stat(destPath);
  return { width: probed?.width ?? null, height: probed?.height ?? null, fileSizeBytes: size.size };
}

export async function generateAudioWaveform(sourcePath: string, destPath: string): Promise<DerivativeResult> {
  if (!(await isFfmpegAvailable())) return null;
  const ok = await runFfmpeg([
    "-y",
    "-i",
    sourcePath,
    "-filter_complex",
    `showwavespic=s=${WAVEFORM_SIZE}:colors=#4f9dff`,
    "-frames:v",
    "1",
    destPath,
  ]);
  if (!ok) return null;
  const size = await stat(destPath);
  const [w, h] = WAVEFORM_SIZE.split("x").map(Number);
  return { width: w, height: h, fileSizeBytes: size.size };
}

export type IngestResult = {
  contentHash: string;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  ffmpegAvailable: boolean;
  derivatives: DerivativeRecord[];
};

// The orchestrator: hashes the real file, probes real metadata, generates
// whatever derivatives make sense for assetType, and records all of it.
// Never throws on a missing/broken ffmpeg — that's a real, expected
// environment state, not a bug condition.
export async function ingestAsset(input: {
  assetId: string;
  ownerScope: string;
  assetType: string;
  mimeType: string;
  sourcePath: string;
  derivedDir: string;
}): Promise<IngestResult> {
  const contentHash = await sha256File(input.sourcePath);
  setAssetContentHash(input.assetId, input.ownerScope, contentHash);

  const ffmpegAvailable = await isFfmpegAvailable();
  const probed = ffmpegAvailable ? await probeMediaMetadata(input.sourcePath) : null;
  if (probed) {
    setAssetDimensions(input.assetId, input.ownerScope, probed.width, probed.height, probed.durationSeconds);
  }

  const derivatives: DerivativeRecord[] = [];
  if (ffmpegAvailable) {
    await mkdir(input.derivedDir, { recursive: true });

    if (input.assetType === "image") {
      const destKey = `${input.assetId}-thumbnail.jpg`;
      const result = await generateImageThumbnail(input.sourcePath, path.join(input.derivedDir, destKey));
      if (result) {
        derivatives.push(
          upsertDerivative({
            assetId: input.assetId,
            kind: "thumbnail",
            storageKey: destKey,
            mimeType: "image/jpeg",
            width: result.width,
            height: result.height,
            fileSizeBytes: result.fileSizeBytes,
          }),
        );
      }
    } else if (input.assetType === "video") {
      const thumbKey = `${input.assetId}-thumbnail.jpg`;
      const thumbResult = await generateVideoThumbnail(input.sourcePath, path.join(input.derivedDir, thumbKey));
      if (thumbResult) {
        derivatives.push(
          upsertDerivative({
            assetId: input.assetId,
            kind: "thumbnail",
            storageKey: thumbKey,
            mimeType: "image/jpeg",
            width: thumbResult.width,
            height: thumbResult.height,
            fileSizeBytes: thumbResult.fileSizeBytes,
          }),
        );
      }
      const proxyKey = `${input.assetId}-proxy.mp4`;
      const proxyResult = await generateVideoProxy(input.sourcePath, path.join(input.derivedDir, proxyKey));
      if (proxyResult) {
        derivatives.push(
          upsertDerivative({
            assetId: input.assetId,
            kind: "proxy",
            storageKey: proxyKey,
            mimeType: "video/mp4",
            width: proxyResult.width,
            height: proxyResult.height,
            fileSizeBytes: proxyResult.fileSizeBytes,
          }),
        );
      }
    } else if (input.assetType === "audio") {
      const waveKey = `${input.assetId}-waveform.png`;
      const waveResult = await generateAudioWaveform(input.sourcePath, path.join(input.derivedDir, waveKey));
      if (waveResult) {
        derivatives.push(
          upsertDerivative({
            assetId: input.assetId,
            kind: "waveform",
            storageKey: waveKey,
            mimeType: "image/png",
            width: waveResult.width,
            height: waveResult.height,
            fileSizeBytes: waveResult.fileSizeBytes,
          }),
        );
      }
    }
  }

  return {
    contentHash,
    width: probed?.width ?? null,
    height: probed?.height ?? null,
    durationSeconds: probed?.durationSeconds ?? null,
    ffmpegAvailable,
    derivatives,
  };
}
