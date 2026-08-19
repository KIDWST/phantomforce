import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  generateLocalMediaThumbnail,
  localMediaFallbackSvg,
  resolveLocalFfmpeg,
} from "../src/assets/local-media-thumbnail.js";

const root = await mkdtemp(join(tmpdir(), "phantomforce-thumbnail-test-"));
try {
  const fallback = localMediaFallbackSvg({ title: "Test & Asset", kind: "video" }).toString("utf8");
  assert.match(fallback, /Test &amp; Asset/u, "Fallback thumbnails must safely include the asset title.");
  assert.match(fallback, /PHANTOMFORCE MEDIA LAB/u, "Fallback thumbnails must remain visibly branded.");

  const ffmpeg = await resolveLocalFfmpeg();
  if (ffmpeg) {
    const sourcePath = join(root, "source.ppm");
    const outputPath = join(root, "cache", "source.jpg");
    const pixels = Array.from({ length: 64 * 36 }, (_, index) => index % 64 < 32 ? "20 220 140" : "15 38 70").join(" ");
    await writeFile(sourcePath, `P3\n64 36\n255\n${pixels}\n`, "utf8");
    const generated = await generateLocalMediaThumbnail({ sourcePath, outputPath, kind: "image" });
    assert.equal(generated.ok, true, `FFmpeg thumbnail generation failed: ${generated.detail || "unknown"}`);
    const jpg = await readFile(outputPath);
    assert.ok(jpg.length > 512, "Generated thumbnails must contain a real image payload.");
    assert.equal(jpg[0], 0xff, "Generated thumbnails must be JPEG files.");
    assert.equal(jpg[1], 0xd8, "Generated thumbnails must be JPEG files.");
    const cached = await generateLocalMediaThumbnail({ sourcePath, outputPath, kind: "image" });
    assert.equal(cached.state, "cached", "Repeated requests must use the persistent thumbnail cache.");
  } else {
    console.log("FFmpeg unavailable; extraction check skipped, fallback contract verified.");
  }

  console.log("Local media thumbnail checks passed.");
} finally {
  await rm(root, { recursive: true, force: true });
}
