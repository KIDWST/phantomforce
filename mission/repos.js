// Finds real git repositories on this machine so the mission creation UI can
// offer a pick-list instead of making the user hand-type (and get wrong) a
// filesystem path. Bounded on every axis — depth, result count, wall-clock
// time — since this walks the real filesystem.
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const SCAN_ROOTS = [os.homedir(), path.join(os.homedir(), "Documents"), path.join(os.homedir(), "source", "repos")];
const SKIP_NAMES = new Set(["node_modules", ".git", "AppData", "$Recycle.Bin", "System Volume Information", "Library"]);
const MAX_RESULTS = 40;
const MAX_DEPTH = 4;
const MAX_MS = 2500;

export function findGitRepos(roots = SCAN_ROOTS) {
  const found = [];
  const seen = new Set();
  const deadline = Date.now() + MAX_MS;

  function scan(dir, depth) {
    if (found.length >= MAX_RESULTS || depth > MAX_DEPTH || Date.now() > deadline) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    // A git *worktree* checkout has a ".git" FILE (pointing back at the main
    // repo's .git/worktrees/<name>), not a ".git" directory — a plain
    // `isDirectory()` check misses every worktree. Accept either.
    if (entries.some((e) => e.name === ".git")) {
      if (!seen.has(dir)) {
        seen.add(dir);
        found.push({ path: dir, name: path.basename(dir) });
      }
      // Keep descending: worktrees are commonly nested under a repo (e.g.
      // <repo>/worktrees/<branch>, or this app's own .termina-worktrees/),
      // so stopping at the first repo found would miss them.
    }
    for (const e of entries) {
      if (found.length >= MAX_RESULTS || Date.now() > deadline) return;
      if (!e.isDirectory() || e.name.startsWith(".") || SKIP_NAMES.has(e.name)) continue;
      scan(path.join(dir, e.name), depth + 1);
    }
  }

  for (const root of roots) {
    if (existsSync(root)) scan(root, 0);
  }
  return found;
}
