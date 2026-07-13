// Best-effort JSONL logger, same never-block philosophy as every other
// logger in this codebase. A no-op when logPath is undefined — solo-tile
// usage (outside Mission Mode) isn't tracked, matching how Mission DVR
// recording is already mission-only.
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

export async function appendUsage(logPath, entry) {
  if (!logPath) return;
  try {
    await mkdir(path.dirname(logPath), { recursive: true });
    await appendFile(logPath, JSON.stringify(entry) + "\n", "utf8");
  } catch {
    /* best effort only */
  }
}

export async function readUsage(logPath) {
  if (!existsSync(logPath)) return [];
  let text;
  try {
    text = await readFile(logPath, "utf8");
  } catch {
    return [];
  }
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
