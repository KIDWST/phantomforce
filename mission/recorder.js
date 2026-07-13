// Records each mission worker's raw PTY output as timestamped, ordered
// frames, for the Mission DVR scrub timeline. Best-effort and append-only,
// mirroring the existing captureDetection pattern in server.js — a write
// failure never blocks the session. Only ever created for mission workers
// (server.js gates this on session.missionId != null); solo tiles are never
// recorded.
import { existsSync, mkdirSync } from "node:fs";
import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";

export function recordingsDir(appDir, missionId) {
  return path.join(appDir, ".termina", "missions", missionId, "recordings");
}

export function recordingPath(appDir, missionId, workerId) {
  return path.join(recordingsDir(appDir, missionId), `${workerId}.jsonl`);
}

// seq is a per-recorder monotonic counter, not derived from Date.now() —
// two frames can land in the same millisecond and must still sort correctly.
export function createFrameRecorder(appDir, missionId, workerId) {
  let seq = 0;
  const file = recordingPath(appDir, missionId, workerId);
  return {
    async append(data) {
      try {
        mkdirSync(path.dirname(file), { recursive: true });
        const line = JSON.stringify({ ts: Date.now(), seq: seq++, data: Buffer.from(data, "utf8").toString("base64") });
        await appendFile(file, line + "\n", "utf8");
      } catch {
        /* best effort only */
      }
    },
  };
}

export async function readFrames(appDir, missionId, workerId) {
  const file = recordingPath(appDir, missionId, workerId);
  if (!existsSync(file)) return null;
  const text = await readFile(file, "utf8");
  const frames = [];
  for (const line of text.trim().split("\n")) {
    if (!line) continue;
    try {
      const frame = JSON.parse(line);
      frames.push({ ts: frame.ts, seq: frame.seq, data: Buffer.from(frame.data, "base64").toString("utf8") });
    } catch {
      /* skip corrupted line, keep the rest */
    }
  }
  return frames;
}
