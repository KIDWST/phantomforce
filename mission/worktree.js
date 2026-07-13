// Git worktree lifecycle for isolated write-mode missions. One branch + one
// worktree per writing worker, kept outside the tracked repo so it never
// pollutes `git status` in the main checkout.
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

function git(cwd, args) {
  return run("git", args, { cwd });
}

export async function isGitRepo(root) {
  try {
    const { stdout } = await git(root, ["rev-parse", "--is-inside-work-tree"]);
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

export async function getHeadRef(root) {
  const { stdout } = await git(root, ["rev-parse", "HEAD"]);
  return stdout.trim();
}

export async function isDirty(root) {
  const { stdout } = await git(root, ["status", "--porcelain"]);
  return stdout.trim().length > 0;
}

export function slugify(name) {
  return (
    String(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "worker"
  );
}

export function branchName(missionId, workerSlug) {
  return `termina/mission-${missionId}/${workerSlug}`;
}

export function worktreePath(repoRoot, missionId, workerSlug) {
  const repoName = path.basename(repoRoot);
  return path.join(path.dirname(repoRoot), ".termina-worktrees", `${repoName}-mission-${missionId}-${workerSlug}`);
}

// Creates an isolated worktree + branch for one worker, checked out at an
// explicit ref (defaults to the repo's current HEAD). Refuses outright
// rather than silently reusing a dirty directory if the target path already
// exists with uncommitted changes.
export async function createWorktreeFromRef({ repoRoot, missionId, workerSlug, ref }) {
  const branch = branchName(missionId, workerSlug);
  const targetPath = worktreePath(repoRoot, missionId, workerSlug);

  if (existsSync(targetPath)) {
    if (await isDirty(targetPath)) {
      throw new Error(`worktree path already exists with uncommitted changes: ${targetPath}`);
    }
    throw new Error(`worktree path already exists: ${targetPath}`);
  }

  await mkdir(path.dirname(targetPath), { recursive: true });
  const resolvedRef = ref ?? (await getHeadRef(repoRoot));
  await git(repoRoot, ["worktree", "add", "-b", branch, targetPath, resolvedRef]);
  return { path: targetPath, branch };
}

export async function createWorktree({ repoRoot, missionId, workerSlug }) {
  return createWorktreeFromRef({ repoRoot, missionId, workerSlug });
}

// Manual, user-confirmed action only. Never deletes the branch.
export async function removeWorktree({ repoRoot, targetPath, force = false }) {
  const args = ["worktree", "remove", targetPath];
  if (force) args.push("--force");
  await git(repoRoot, args);
}
