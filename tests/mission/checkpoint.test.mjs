import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { CHECKPOINT_EVENT_TYPES, maybeCheckpoint, readCheckpoints, snapshotWorktree } from "../../mission/checkpoint.js";

const run = promisify(execFile);

async function makeScratchRepo() {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "termina-ckpt-repo-"));
  await run("git", ["init", "-q"], { cwd: repoRoot });
  await run("git", ["config", "user.email", "test@example.com"], { cwd: repoRoot });
  await run("git", ["config", "user.name", "Test"], { cwd: repoRoot });
  await writeFile(path.join(repoRoot, "README.md"), "hello\n", "utf8");
  await run("git", ["add", "README.md"], { cwd: repoRoot });
  await run("git", ["commit", "-q", "-m", "init"], { cwd: repoRoot });
  return repoRoot;
}

async function withTempAppDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "termina-ckpt-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("snapshotWorktree on a dirty tree returns a resolvable stash-create SHA without altering the tree", async () => {
  const repoRoot = await makeScratchRepo();
  try {
    await writeFile(path.join(repoRoot, "README.md"), "changed\n", "utf8");
    const sha = await snapshotWorktree(repoRoot);
    assert.ok(sha && /^[0-9a-f]{7,40}$/.test(sha));
    const { stdout } = await run("git", ["status", "--porcelain"], { cwd: repoRoot });
    assert.equal(stdout.trim(), "M README.md"); // stash create doesn't touch the working tree
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("snapshotWorktree on a clean tree falls back to HEAD", async () => {
  const repoRoot = await makeScratchRepo();
  try {
    const head = (await run("git", ["rev-parse", "HEAD"], { cwd: repoRoot })).stdout.trim();
    const sha = await snapshotWorktree(repoRoot);
    assert.equal(sha, head);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("maybeCheckpoint skips workers with no branch (not an isolated worktree worker)", async () => {
  await withTempAppDir(async (appDir) => {
    const result = await maybeCheckpoint({
      appDir,
      missionId: "m1",
      worker: { id: "w1", branch: null, cwd: "irrelevant" },
      eventType: "PROPOSED_CHANGE",
    });
    assert.equal(result, null);
  });
});

test("maybeCheckpoint skips event types that aren't checkpoint-worthy", async () => {
  const repoRoot = await makeScratchRepo();
  try {
    await withTempAppDir(async (appDir) => {
      const result = await maybeCheckpoint({
        appDir,
        missionId: "m1",
        worker: { id: "w1", branch: "termina/mission-m1/w1", cwd: repoRoot },
        eventType: "DISCOVERY",
      });
      assert.equal(result, null);
    });
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("maybeCheckpoint records a checkpoint for a qualifying event and it round-trips via readCheckpoints", async () => {
  const repoRoot = await makeScratchRepo();
  try {
    await withTempAppDir(async (appDir) => {
      assert.ok(CHECKPOINT_EVENT_TYPES.includes("PROPOSED_CHANGE"));
      const record = await maybeCheckpoint({
        appDir,
        missionId: "m1",
        worker: { id: "w1", branch: "termina/mission-m1/w1", cwd: repoRoot },
        eventType: "PROPOSED_CHANGE",
      });
      assert.ok(record);
      assert.equal(record.workerId, "w1");
      assert.equal(record.ledgerEventType, "PROPOSED_CHANGE");

      const all = await readCheckpoints(appDir, "m1");
      assert.equal(all.length, 1);
      assert.equal(all[0].sha, record.sha);
    });
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("readCheckpoints returns an empty array when no checkpoints file exists", async () => {
  await withTempAppDir(async (appDir) => {
    assert.deepEqual(await readCheckpoints(appDir, "does-not-exist"), []);
  });
});
