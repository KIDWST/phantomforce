import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { maybeCheckpoint, readCheckpoints } from "../../mission/checkpoint.js";
import { createWorktreeFromRef } from "../../mission/worktree.js";

const run = promisify(execFile);

async function makeScratchRepo() {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "termina-branch-repo-"));
  await run("git", ["init", "-q"], { cwd: repoRoot });
  await run("git", ["config", "user.email", "test@example.com"], { cwd: repoRoot });
  await run("git", ["config", "user.name", "Test"], { cwd: repoRoot });
  await writeFile(path.join(repoRoot, "app.js"), "v1\n", "utf8");
  await run("git", ["add", "app.js"], { cwd: repoRoot });
  await run("git", ["commit", "-q", "-m", "init"], { cwd: repoRoot });
  return repoRoot;
}

test("a worker's checkpoint can be branched into a new worktree whose files match that point in time, leaving the original worker's files untouched", async () => {
  const repoRoot = await makeScratchRepo();
  let originalWt;
  let branchWt;
  let appDir;
  try {
    originalWt = await createWorktreeFromRef({ repoRoot, missionId: "m1", workerSlug: "backend" });

    // worker edits a file and "proposes a change" -> checkpoint fires
    await writeFile(path.join(originalWt.path, "app.js"), "v2 (proposed)\n", "utf8");
    appDir = await mkdtemp(path.join(os.tmpdir(), "termina-branch-appdir-"));
    const checkpoint = await maybeCheckpoint({
      appDir,
      missionId: "m1",
      worker: { id: "w1", branch: originalWt.branch, cwd: originalWt.path },
      eventType: "PROPOSED_CHANGE",
    });
    assert.ok(checkpoint);

    // worker keeps going, files change again after the checkpoint
    await writeFile(path.join(originalWt.path, "app.js"), "v3 (kept working)\n", "utf8");

    // branch from the checkpoint into a sibling worktree
    branchWt = await createWorktreeFromRef({ repoRoot, missionId: "m1", workerSlug: "backend-branch-1", ref: checkpoint.sha });

    const norm = (s) => s.replace(/\r\n/g, "\n");
    const branchedContent = norm(await readFile(path.join(branchWt.path, "app.js"), "utf8"));
    assert.equal(branchedContent, "v2 (proposed)\n"); // frozen at the checkpoint, not v1 and not v3

    const originalContent = norm(await readFile(path.join(originalWt.path, "app.js"), "utf8"));
    assert.equal(originalContent, "v3 (kept working)\n"); // original worker's live files are untouched by branching

    const all = await readCheckpoints(appDir, "m1");
    assert.equal(all.length, 1);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
    if (originalWt) await rm(originalWt.path, { recursive: true, force: true }).catch(() => {});
    if (branchWt) await rm(branchWt.path, { recursive: true, force: true }).catch(() => {});
    if (appDir) await rm(appDir, { recursive: true, force: true }).catch(() => {});
  }
});
