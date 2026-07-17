// Poll-gating + solo-tile transcript attribution, extracted from server.js so
// they are unit-testable without spawning a PTY (server.js starts listening on
// import, so nothing in it can be imported by tests directly).
import { existsSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";

import { TOKEN_ADAPTERS, claudeProjectDir } from "./tokens.js";

// A session is worth polling when either (a) it's a mission worker — the
// mission pipeline owns attribution via its always-fresh worktree cwd — or
// (b) it's a solo tile whose provider has a real token adapter AND whose
// spawn cwd is known. Plain shells (pwsh/cmd/wsl/...) and codex (adapter
// null: no confirmed local transcript format) never poll — no adapter means
// no data, never fake data.
export function shouldPollSession(session) {
  if (!session) return false;
  if (session.missionId && session.workerId) return true;
  const adapter = session.provider ? TOKEN_ADAPTERS[session.provider] : null;
  return Boolean(adapter && session.cwd);
}

// Solo tiles run in ordinary directories (e.g. plain C:\Users\jorda) whose
// Claude project dir may hold transcripts from other sessions — unlike
// mission worktrees, "most recent .jsonl" is NOT automatically this tile's.
// Honest attribution (QA ledger TQA-03):
//   - only transcripts whose mtime advanced after this session started are
//     candidates (a transcript untouched since before the spawn cannot be
//     this session's);
//   - exactly one candidate → unambiguous;
//   - several candidates advancing concurrently → we cannot prove which is
//     ours, so the newest is returned flagged ambiguous:true and the caller
//     must mark the payload estimated, never presenting it as real.
export async function resolveSoloTranscript(cwd, claudeProjectsDir, sessionStartedAt) {
  const dir = claudeProjectDir(cwd, claudeProjectsDir);
  if (!existsSync(dir)) return null;
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }
  const candidates = [];
  for (const name of entries) {
    if (!name.endsWith(".jsonl")) continue;
    const full = path.join(dir, name);
    let mtime = 0;
    try {
      mtime = statSync(full).mtimeMs;
    } catch {
      continue;
    }
    if (mtime >= sessionStartedAt) candidates.push({ full, mtime });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.mtime - a.mtime);
  return { path: candidates[0].full, ambiguous: candidates.length > 1 };
}
