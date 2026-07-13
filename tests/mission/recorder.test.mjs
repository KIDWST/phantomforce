import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createFrameRecorder, readFrames, recordingPath } from "../../mission/recorder.js";

async function withTempAppDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "termina-recorder-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("appended frames round-trip through readFrames in order", async () => {
  await withTempAppDir(async (appDir) => {
    const rec = createFrameRecorder(appDir, "m1", "w1");
    await rec.append("hello ");
    await rec.append("world\r\n");
    const frames = await readFrames(appDir, "m1", "w1");
    assert.equal(frames.length, 2);
    assert.equal(frames[0].data, "hello ");
    assert.equal(frames[1].data, "world\r\n");
    assert.equal(frames[0].seq, 0);
    assert.equal(frames[1].seq, 1);
    assert.ok(typeof frames[0].ts === "number");
  });
});

test("readFrames returns null when no recording exists", async () => {
  await withTempAppDir(async (appDir) => {
    assert.equal(await readFrames(appDir, "m1", "nope"), null);
  });
});

test("a corrupted line is skipped, the rest of the frames still read", async () => {
  await withTempAppDir(async (appDir) => {
    const file = recordingPath(appDir, "m1", "w1");
    await mkdir(path.dirname(file), { recursive: true });
    const good1 = JSON.stringify({ ts: 1, seq: 0, data: Buffer.from("a").toString("base64") });
    const good2 = JSON.stringify({ ts: 2, seq: 1, data: Buffer.from("b").toString("base64") });
    await writeFile(file, `${good1}\nnot json\n${good2}\n`, "utf8");
    const frames = await readFrames(appDir, "m1", "w1");
    assert.equal(frames.length, 2);
    assert.equal(frames[0].data, "a");
    assert.equal(frames[1].data, "b");
  });
});
