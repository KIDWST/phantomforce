// Termina never calls an LLM API itself — it drives a PTY. So real token
// counts come from tailing the provider CLI's own local session transcript,
// matched to a worker by its (always-fresh, never-reused) worktree cwd. When
// a provider has no confirmed local log format, or the transcript hasn't
// appeared yet, callers fall back to estimateFromChars — clearly distinct
// from real data, never presented as equal-confidence.
import { existsSync, statSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

// Matches Claude Code's own project-directory naming exactly (verified
// against a real ~/.claude/projects/<name> directory for a known cwd on
// this machine).
export function sanitizeCwdToProjectDirName(cwd) {
  return cwd.replace(/[:\\/.]/g, "-");
}

export function claudeProjectDir(cwd, claudeProjectsDir) {
  return path.join(claudeProjectsDir, sanitizeCwdToProjectDirName(cwd));
}

// A worker's worktree is always a brand-new directory (createWorktree /
// createWorktreeFromRef refuse to reuse an existing one), so its Claude
// project directory can never contain a transcript from anything else —
// "most recently modified .jsonl in that directory" is unambiguous, not a
// heuristic guess.
export async function findClaudeTranscript(cwd, claudeProjectsDir) {
  const dir = claudeProjectDir(cwd, claudeProjectsDir);
  if (!existsSync(dir)) return null;
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }
  const jsonl = entries.filter((f) => f.endsWith(".jsonl"));
  if (!jsonl.length) return null;
  const withMtime = jsonl.map((f) => {
    const full = path.join(dir, f);
    let mtime = 0;
    try {
      mtime = statSync(full).mtimeMs;
    } catch {
      /* ignore */
    }
    return { full, mtime };
  });
  withMtime.sort((a, b) => b.mtime - a.mtime);
  return withMtime[0].full;
}

// Verified against a real local transcript: each assistant turn is one JSON
// line with message.model and message.usage.{input_tokens,
// cache_creation_input_tokens, cache_read_input_tokens, output_tokens}.
export async function readClaudeUsage(filePath) {
  let text;
  try {
    text = await readFile(filePath, "utf8");
  } catch {
    return { inputTokens: 0, outputTokens: 0, cacheTokens: 0, model: null };
  }
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheTokens = 0;
  let model = null;
  for (const line of text.trim().split("\n")) {
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const usage = entry?.message?.usage;
    if (entry?.type !== "assistant" || !usage) continue;
    inputTokens += usage.input_tokens ?? 0;
    inputTokens += usage.cache_creation_input_tokens ?? 0;
    inputTokens += usage.cache_read_input_tokens ?? 0;
    cacheTokens += (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
    outputTokens += usage.output_tokens ?? 0;
    if (entry.message.model) model = entry.message.model;
  }
  return { inputTokens, outputTokens, cacheTokens, model };
}

// Character-count fallback for providers/moments with no readable real
// transcript yet. ~4 chars/token is the standard rough approximation; all of
// it is attributed to input since there's no way to distinguish prompt vs.
// completion from raw terminal bytes alone.
export function estimateFromChars(charCount) {
  return { inputTokens: Math.round(charCount / 4), outputTokens: 0 };
}

// Verified per-1M-token USD rates, checked against each model's own pricing
// page at time of writing. An unrecognized model returns null rather than
// guessing a rate — never invent a dollar figure.
const RATES_PER_MILLION_USD = {
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-opus-4-8": { input: 15, output: 75 },
  "claude-haiku-4-5-20251001": { input: 0.8, output: 4 },
};

export function costForUsage({ model, inputTokens, outputTokens }) {
  const rate = model ? RATES_PER_MILLION_USD[model] : null;
  if (!rate) return null;
  return (inputTokens / 1_000_000) * rate.input + (outputTokens / 1_000_000) * rate.output;
}

// codex: null — no confirmed local transcript format for the Codex CLI at
// time of writing; the tracker falls back to estimateFromChars for it.
export const TOKEN_ADAPTERS = {
  claude: { findTranscript: findClaudeTranscript, readUsage: readClaudeUsage },
  codex: null,
};
