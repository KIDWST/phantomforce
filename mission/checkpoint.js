// Snapshots a worker's worktree to a shadow git object on qualifying ledger
// events, without touching the worker's real branch, working tree, or the
// stash ref list. Only meaningful for isolated (git worktree) write-mode
// workers — shared-folder and plan-mode (read-only) workers produce none.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export const CHECKPOINT_EVENT_TYPES = ["FILE_CLAIM", "PROPOSED_CHANGE", "CHANGE_APPLIED", "COMPLETE", "FAILED"];

export function checkpointsPath(appDir, missionId) {
  return path.join(appDir, ".termina", "missions", missionId, "checkpoints.jsonl");
}

// `git stash create` returns a commit-ish SHA representing the current
// index+worktree state *without* touching the working tree, the index, or
// the stash ref list — safe to call at any time. On a clean tree it prints
// nothing (there's no diff to snapshot); HEAD already IS that checkpoint.
export async function snapshotWorktree(cwd) {
  try {
    const { stdout } = await run("git", ["stash", "create"], { cwd });
    const sha = stdout.trim();
    if (sha) return sha;
    const head = await run("git", ["rev-parse", "HEAD"], { cwd });
    return head.stdout.trim();
  } catch {
    return null;
  }
}

export async function maybeCheckpoint({ appDir, missionId, worker, eventType }) {
  if (!worker.branch) return null; // not an isolated worktree worker
  if (!CHECKPOINT_EVENT_TYPES.includes(eventType)) return null;
  const sha = await snapshotWorktree(worker.cwd);
  if (!sha) return null;
  const record = { ts: Date.now(), workerId: worker.id, sha, ledgerEventType: eventType };
  try {
    mkdirSync(path.dirname(checkpointsPath(appDir, missionId)), { recursive: true });
    await appendFile(checkpointsPath(appDir, missionId), JSON.stringify(record) + "\n", "utf8");
  } catch {
    return null;
  }
  return record;
}

export async function readCheckpoints(appDir, missionId) {
  const file = checkpointsPath(appDir, missionId);
  if (!existsSync(file)) return [];
  const text = await readFile(file, "utf8");
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}
