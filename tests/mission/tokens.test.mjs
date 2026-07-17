import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  costForUsage,
  estimateFromChars,
  findClaudeTranscript,
  readClaudeUsage,
  sanitizeCwdToProjectDirName,
} from "../../mission/tokens.js";

test("sanitizeCwdToProjectDirName matches Claude Code's real project-dir naming", () => {
  const cwd = "C:\\Users\\jorda\\.termina-worktrees\\Termina-mission-a6bbb1875498-checker";
  assert.equal(sanitizeCwdToProjectDirName(cwd), "C--Users-jorda--termina-worktrees-Termina-mission-a6bbb1875498-checker");
});

test("estimateFromChars produces a rough token count with zero output tokens (no way to split without real data)", () => {
  const est = estimateFromChars(4000);
  assert.equal(est.inputTokens, 1000);
  assert.equal(est.outputTokens, 0);
});

test("costForUsage returns null for an unrecognized model rather than guessing", () => {
  assert.equal(costForUsage({ model: "some-future-model-1", inputTokens: 100, outputTokens: 100 }), null);
});

test("costForUsage computes a real number for a known model", () => {
  const cost = costForUsage({ model: "claude-sonnet-5", inputTokens: 1_000_000, outputTokens: 1_000_000 });
  assert.ok(typeof cost === "number" && cost > 0);
});

async function withTempClaudeProjects(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "termina-claude-projects-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("findClaudeTranscript returns null when the project dir doesn't exist yet", async () => {
  await withTempClaudeProjects(async (claudeProjectsDir) => {
    assert.equal(await findClaudeTranscript("C:\\some\\worktree", claudeProjectsDir), null);
  });
});

test("findClaudeTranscript finds the transcript once the project dir exists", async () => {
  await withTempClaudeProjects(async (claudeProjectsDir) => {
    const cwd = "C:\\some\\worktree";
    const projectDir = path.join(claudeProjectsDir, sanitizeCwdToProjectDirName(cwd));
    await mkdir(projectDir, { recursive: true });
    const file = path.join(projectDir, "session-1.jsonl");
    await writeFile(file, "", "utf8");
    assert.equal(await findClaudeTranscript(cwd, claudeProjectsDir), file);
  });
});

test("readClaudeUsage sums usage across assistant turns from a real-shaped transcript", async () => {
  await withTempClaudeProjects(async (claudeProjectsDir) => {
    const file = path.join(claudeProjectsDir, "session.jsonl");
    const line1 = JSON.stringify({
      type: "assistant",
      message: { model: "claude-sonnet-5", usage: { input_tokens: 2, cache_creation_input_tokens: 100, cache_read_input_tokens: 50, output_tokens: 20 } },
    });
    const line2 = JSON.stringify({
      type: "assistant",
      message: { model: "claude-sonnet-5", usage: { input_tokens: 3, cache_creation_input_tokens: 0, cache_read_input_tokens: 400, output_tokens: 30 } },
    });
    const userLine = JSON.stringify({ type: "user", message: { content: "hi" } });
    await writeFile(file, `${line1}\n${userLine}\n${line2}\n`, "utf8");

    const usage = await readClaudeUsage(file);
    assert.equal(usage.inputTokens, 2 + 100 + 50 + 3 + 0 + 400);
    assert.equal(usage.outputTokens, 20 + 30);
    assert.equal(usage.model, "claude-sonnet-5");
  });
});

test("readClaudeUsage reports cacheTokens and the latest turn's input (input+cache of the newest assistant message)", async () => {
  await withTempClaudeProjects(async (claudeProjectsDir) => {
    const file = path.join(claudeProjectsDir, "session.jsonl");
    const line1 = JSON.stringify({
      type: "assistant",
      message: { model: "claude-sonnet-5", usage: { input_tokens: 2, cache_creation_input_tokens: 100, cache_read_input_tokens: 50, output_tokens: 20 } },
    });
    const line2 = JSON.stringify({
      type: "assistant",
      message: { model: "claude-sonnet-5", usage: { input_tokens: 3, cache_creation_input_tokens: 0, cache_read_input_tokens: 400, output_tokens: 30 } },
    });
    await writeFile(file, `${line1}\n${line2}\n`, "utf8");

    const usage = await readClaudeUsage(file);
    assert.equal(usage.cacheTokens, 100 + 50 + 0 + 400);
    // Last turn = second assistant line only: 3 + 0 + 400.
    assert.equal(usage.lastTurnInputTokens, 3 + 0 + 400);
  });
});

test("readClaudeUsage on an unreadable file reports zeroed cache/last-turn fields too", async () => {
  const usage = await readClaudeUsage(path.join(os.tmpdir(), "termina-definitely-missing.jsonl"));
  assert.equal(usage.cacheTokens, 0);
  assert.equal(usage.lastTurnInputTokens, 0);
});
