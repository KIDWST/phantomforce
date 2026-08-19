import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";

export type LocalThumbnailKind = "image" | "video" | "audio" | "other";

export type LocalThumbnailResult = {
  ok: boolean;
  path?: string;
  state: "cached" | "generated" | "unavailable";
  detail?: string;
};

const generationJobs = new Map<string, Promise<LocalThumbnailResult>>();
const generationQueue: Array<() => void> = [];
const MAX_ACTIVE_GENERATORS = 2;
let activeGenerators = 0;
let ffmpegProbe: Promise<string | null> | null = null;

function runHidden(command: string, args: string[], timeout: number) {
  return new Promise<void>((resolve, reject) => {
    execFile(command, args, {
      windowsHide: true,
      timeout,
      maxBuffer: 1024 * 1024,
    }, (error) => error ? reject(error) : resolve());
  });
}

function queued<T>(work: () => Promise<T>) {
  return new Promise<T>((resolve, reject) => {
    const start = () => {
      activeGenerators += 1;
      work().then(resolve, reject).finally(() => {
        activeGenerators -= 1;
        generationQueue.shift()?.();
      });
    };
    if (activeGenerators < MAX_ACTIVE_GENERATORS) start();
    else generationQueue.push(start);
  });
}

async function probeFfmpeg(candidate: string) {
  if (candidate.toLowerCase().endsWith(".exe") && !existsSync(candidate)) return false;
  try {
    await runHidden(candidate, ["-hide_banner", "-version"], 5_000);
    return true;
  } catch {
    return false;
  }
}

export async function resolveLocalFfmpeg() {
  ffmpegProbe ??= (async () => {
    const localAppData = String(process.env.LOCALAPPDATA || "").trim();
    const candidates = [
      String(process.env.PHANTOMFORCE_FFMPEG_PATH || "").trim(),
      String(process.env.FFMPEG_PATH || "").trim(),
      localAppData ? `${localAppData}\\Microsoft\\WinGet\\Links\\ffmpeg.exe` : "",
      localAppData ? `${localAppData}\\hermes\\hermes-agent\\venv\\Scripts\\ffmpeg.exe` : "",
      "ffmpeg",
    ].filter(Boolean);
    for (const candidate of [...new Set(candidates)]) {
      if (await probeFfmpeg(candidate)) return candidate;
    }
    return null;
  })();
  return ffmpegProbe;
}

async function validThumbnail(pathname: string) {
  try {
    const info = await stat(pathname);
    return info.isFile() && info.size > 512;
  } catch {
    return false;
  }
}

function visualArgs(sourcePath: string, outputPath: string, kind: LocalThumbnailKind, seek?: string) {
  const base = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y"];
  if (seek) base.push("-ss", seek);
  base.push("-i", sourcePath);
  if (kind === "audio") {
    base.push(
      "-filter_complex",
      "showwavespic=s=640x360:split_channels=1:colors=0x53f5a4,format=yuvj420p",
      "-frames:v",
      "1",
    );
  } else {
    base.push(
      "-map",
      "0:v:0",
      "-frames:v",
      "1",
      "-an",
      "-sn",
      "-dn",
      "-vf",
      "scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2:color=0x071018",
    );
  }
  base.push("-q:v", "3", "-f", "image2", outputPath);
  return base;
}

async function generateThumbnail(sourcePath: string, outputPath: string, kind: LocalThumbnailKind): Promise<LocalThumbnailResult> {
  if (await validThumbnail(outputPath)) return { ok: true, path: outputPath, state: "cached" };
  if (!existsSync(sourcePath) || kind === "other") return { ok: false, state: "unavailable", detail: "unsupported_source" };
  const ffmpeg = await resolveLocalFfmpeg();
  if (!ffmpeg) return { ok: false, state: "unavailable", detail: "ffmpeg_unavailable" };

  await mkdir(dirname(outputPath), { recursive: true });
  const attempts = kind === "video" ? ["00:00:00.750", "00:00:00.000"] : [undefined];
  let detail = "thumbnail_generation_failed";
  for (const seek of attempts) {
    const temporaryPath = `${outputPath}.${process.pid}-${randomUUID()}.tmp.jpg`;
    try {
      await runHidden(ffmpeg, visualArgs(sourcePath, temporaryPath, kind, seek), 30_000);
      if (!await validThumbnail(temporaryPath)) throw new Error("thumbnail_output_empty");
      await rm(outputPath, { force: true });
      await rename(temporaryPath, outputPath);
      return { ok: true, path: outputPath, state: "generated" };
    } catch (error) {
      detail = error instanceof Error ? error.message.slice(0, 240) : detail;
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }
  return { ok: false, state: "unavailable", detail };
}

export function generateLocalMediaThumbnail(input: {
  sourcePath: string;
  outputPath: string;
  kind: LocalThumbnailKind;
}) {
  const key = input.outputPath.toLowerCase();
  const existing = generationJobs.get(key);
  if (existing) return existing;
  const job = queued(() => generateThumbnail(input.sourcePath, input.outputPath, input.kind))
    .finally(() => generationJobs.delete(key));
  generationJobs.set(key, job);
  return job;
}

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&apos;",
  })[character] || character);
}

export function localMediaFallbackSvg(input: { title?: string; kind?: string }) {
  const title = escapeXml(String(input.title || "Untitled asset").trim().slice(0, 54));
  const kind = escapeXml(String(input.kind || "asset").trim().toUpperCase().slice(0, 18));
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" role="img" aria-label="${title}">
  <rect width="640" height="360" fill="#071018"/>
  <path d="M0 300H640M0 240H640M0 180H640M0 120H640M0 60H640M80 0V360M160 0V360M240 0V360M320 0V360M400 0V360M480 0V360M560 0V360" stroke="#173229" stroke-width="1" opacity=".55"/>
  <rect x="42" y="42" width="92" height="28" rx="4" fill="#102b22" stroke="#2ba976"/>
  <text x="88" y="61" fill="#8fffd0" font-family="Arial, sans-serif" font-size="13" font-weight="700" text-anchor="middle">${kind}</text>
  <path d="M274 130h92v72h-92z" fill="#0b1815" stroke="#36dc99" stroke-width="3"/>
  <path d="m309 150 32 16-32 16z" fill="#53f5a4"/>
  <text x="42" y="306" fill="#edf8f3" font-family="Arial, sans-serif" font-size="22" font-weight="700">${title}</text>
  <text x="42" y="332" fill="#7f9a90" font-family="Arial, sans-serif" font-size="13">PHANTOMFORCE MEDIA LAB</text>
</svg>`, "utf8");
}
