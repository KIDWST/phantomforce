import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { appendUsage, readUsage } from "../../openrouter-agent/usage-log.mjs";

async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "termina-openrouter-usage-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("appendUsage is a no-op when logPath is undefined", async () => {
  await assert.doesNotReject(appendUsage(undefined, { ts: 1, promptTokens: 1, completionTokens: 1, model: "x", costUsd: null }));
});

test("appendUsage/readUsage round-trip, entries in order", async () => {
  await withTempDir(async (dir) => {
    const logPath = path.join(dir, "usage.jsonl");
    await appendUsage(logPath, { ts: 1, promptTokens: 10, completionTokens: 5, model: "z-ai/glm-5.2", costUsd: null });
    await appendUsage(logPath, { ts: 2, promptTokens: 20, completionTokens: 8, model: "z-ai/glm-5.2", costUsd: 0.002 });
    const all = await readUsage(logPath);
    assert.equal(all.length, 2);
    assert.equal(all[0].promptTokens, 10);
    assert.equal(all[1].costUsd, 0.002);
  });
});

test("readUsage on a missing file returns an empty array", async () => {
  await withTempDir(async (dir) => {
    assert.deepEqual(await readUsage(path.join(dir, "does-not-exist.jsonl")), []);
  });
});

test("readUsage tolerates a corrupted line, keeps the rest", async () => {
  await withTempDir(async (dir) => {
    const logPath = path.join(dir, "usage.jsonl");
    const good = JSON.stringify({ ts: 1, promptTokens: 1, completionTokens: 1, model: "x", costUsd: null });
    await writeFile(logPath, `${good}\nnot json\n${good}\n`, "utf8");
    const all = await readUsage(logPath);
    assert.equal(all.length, 2);
  });
});
