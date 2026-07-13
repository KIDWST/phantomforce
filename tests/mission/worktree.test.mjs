import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { branchName, createWorktree, createWorktreeFromRef, removeWorktree, slugify, worktreePath } from "../../mission/worktree.js";

const run = promisify(execFile);

test("slugify lowercases, strips punctuation, and collapses whitespace", () => {
  assert.equal(slugify("Backend / API Auditor!"), "backend-api-auditor");
  assert.equal(slugify("  Leading and trailing  "), "leading-and-trailing");
});

test("slugify falls back to 'worker' for input with nothing sluggable", () => {
  assert.equal(slugify("!!!"), "worker");
});

test("branch names follow the termina/mission-<id>/<slug> convention", () => {
  assert.equal(branchName("abc123", "backend"), "termina/mission-abc123/backend");
});

test("worktree paths live outside the repo, next to it", () => {
  const repoRoot = path.join("C:", "repos", "phantomforce");
  const wt = worktreePath(repoRoot, "abc123", "backend");
  assert.equal(path.dirname(wt).includes("phantomforce"), false);
  assert.ok(wt.includes(".termina-worktrees"));
  assert.ok(wt.includes("phantomforce-mission-abc123-backend"));
});

async function makeScratchRepo() {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "termina-wt-repo-"));
  await run("git", ["init", "-q"], { cwd: repoRoot });
  await run("git", ["config", "user.email", "test@example.com"], { cwd: repoRoot });
  await run("git", ["config", "user.name", "Test"], { cwd: repoRoot });
  await writeFile(path.join(repoRoot, "README.md"), "hello\n", "utf8");
  await run("git", ["add", "README.md"], { cwd: repoRoot });
  await run("git", ["commit", "-q", "-m", "init"], { cwd: repoRoot });
  return repoRoot;
}

test("createWorktree creates a real isolated branch + worktree, removeWorktree tears it down", async () => {
  const repoRoot = await makeScratchRepo();
  let wt;
  try {
    wt = await createWorktree({ repoRoot, missionId: "m1", workerSlug: "backend" });
    assert.equal(wt.branch, "termina/mission-m1/backend");
    const { stdout } = await run("git", ["status", "--porcelain"], { cwd: wt.path });
    assert.equal(stdout.trim(), ""); // fresh checkout, clean

    await removeWorktree({ repoRoot, targetPath: wt.path });
    const { stdout: list } = await run("git", ["worktree", "list"], { cwd: repoRoot });
    assert.ok(!list.includes(wt.path));
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
    if (wt) await rm(wt.path, { recursive: true, force: true }).catch(() => {});
  }
});

test("createWorktreeFromRef checks out an explicit non-HEAD ref, not HEAD", async () => {
  const repoRoot = await makeScratchRepo();
  let wt;
  try {
    // second commit moves HEAD forward
    await writeFile(path.join(repoRoot, "README.md"), "v2\n", "utf8");
    await run("git", ["add", "README.md"], { cwd: repoRoot });
    await run("git", ["commit", "-q", "-m", "v2"], { cwd: repoRoot });
    const firstCommit = (await run("git", ["rev-list", "--max-parents=0", "HEAD"], { cwd: repoRoot })).stdout.trim();

    wt = await createWorktreeFromRef({ repoRoot, missionId: "m3", workerSlug: "branch-a", ref: firstCommit });
    const content = await readFile(path.join(wt.path, "README.md"), "utf8");
    // Windows git checkouts may normalize LF -> CRLF; compare content, not exact bytes.
    assert.equal(content.replace(/\r\n/g, "\n"), "hello\n"); // v1 content, from the first commit — not HEAD's "v2\n"
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
    if (wt) await rm(wt.path, { recursive: true, force: true }).catch(() => {});
  }
});

test("createWorktree refuses to reuse a dirty existing directory at the target path", async () => {
  const repoRoot = await makeScratchRepo();
  let wt;
  try {
    wt = await createWorktree({ repoRoot, missionId: "m2", workerSlug: "frontend" });
    await writeFile(path.join(wt.path, "uncommitted.txt"), "oops\n", "utf8");

    await assert.rejects(
      () => createWorktree({ repoRoot, missionId: "m2", workerSlug: "frontend" }),
      /uncommitted changes|already exists/,
    );
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
    if (wt) await rm(wt.path, { recursive: true, force: true }).catch(() => {});
  }
});
