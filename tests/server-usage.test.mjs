import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { shouldPollSession, resolveSoloTranscript } from "../mission/usage-poll.js";
import { sanitizeCwdToProjectDirName } from "../mission/tokens.js";

// ---- shouldPollSession -------------------------------------------------------

test("shouldPollSession: mission workers always poll (existing behavior)", () => {
  assert.equal(shouldPollSession({ missionId: "m1", workerId: "w1", provider: "claude", cwd: "C:\\wt" }), true);
});

test("shouldPollSession: solo claude tile with a cwd polls", () => {
  assert.equal(shouldPollSession({ missionId: null, workerId: null, provider: "claude", cwd: "C:\\Users\\jorda" }), true);
});

test("shouldPollSession: solo openrouter tile with a cwd polls", () => {
  assert.equal(shouldPollSession({ missionId: null, workerId: null, provider: "openrouter", cwd: "C:\\Users\\jorda" }), true);
});

test("shouldPollSession: plain shells never poll — no adapter, no fake data", () => {
  for (const provider of ["pwsh", "cmd", "wsl", "python", "node", undefined]) {
    assert.equal(shouldPollSession({ missionId: null, workerId: null, provider, cwd: "C:\\Users\\jorda" }), false, `provider=${provider}`);
  }
});

test("shouldPollSession: solo codex tile does not poll (adapter is null — no confirmed transcript format)", () => {
  assert.equal(shouldPollSession({ missionId: null, workerId: null, provider: "codex", cwd: "C:\\Users\\jorda" }), false);
});

test("shouldPollSession: solo claude tile without a resolvable cwd does not poll", () => {
  assert.equal(shouldPollSession({ missionId: null, workerId: null, provider: "claude", cwd: null }), false);
});

// ---- resolveSoloTranscript (honest attribution — QA ledger TQA-03) ----------

async function withTempClaudeProjects(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "termina-solo-usage-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("resolveSoloTranscript: no project dir yet → null", async () => {
  await withTempClaudeProjects(async (claudeProjectsDir) => {
    assert.equal(await resolveSoloTranscript("C:\\some\\solo\\dir", claudeProjectsDir, Date.now()), null);
  });
});

test("resolveSoloTranscript: exactly one transcript touched since session start → unambiguous", async () => {
  await withTempClaudeProjects(async (claudeProjectsDir) => {
    const cwd = "C:\\some\\solo\\dir";
    const projectDir = path.join(claudeProjectsDir, sanitizeCwdToProjectDirName(cwd));
    await mkdir(projectDir, { recursive: true });
    const startedAt = Date.now() - 60_000;
    const stale = path.join(projectDir, "old-session.jsonl");
    await writeFile(stale, "", "utf8");
    const old = new Date(startedAt - 3_600_000);
    await utimes(stale, old, old);
    const live = path.join(projectDir, "live-session.jsonl");
    await writeFile(live, "", "utf8");

    const found = await resolveSoloTranscript(cwd, claudeProjectsDir, startedAt);
    assert.ok(found);
    assert.equal(found.path, live);
    assert.equal(found.ambiguous, false);
  });
});

test("resolveSoloTranscript: several transcripts advancing since session start → ambiguous, flagged", async () => {
  await withTempClaudeProjects(async (claudeProjectsDir) => {
    const cwd = "C:\\some\\shared\\dir";
    const projectDir = path.join(claudeProjectsDir, sanitizeCwdToProjectDirName(cwd));
    await mkdir(projectDir, { recursive: true });
    const startedAt = Date.now() - 60_000;
    await writeFile(path.join(projectDir, "a.jsonl"), "", "utf8");
    await writeFile(path.join(projectDir, "b.jsonl"), "", "utf8");

    const found = await resolveSoloTranscript(cwd, claudeProjectsDir, startedAt);
    assert.ok(found);
    assert.equal(found.ambiguous, true, "shared project dir with two live transcripts must be marked ambiguous");
  });
});

test("resolveSoloTranscript: only transcripts predating the session → null (never attribute someone else's usage)", async () => {
  await withTempClaudeProjects(async (claudeProjectsDir) => {
    const cwd = "C:\\some\\solo\\dir";
    const projectDir = path.join(claudeProjectsDir, sanitizeCwdToProjectDirName(cwd));
    await mkdir(projectDir, { recursive: true });
    const stale = path.join(projectDir, "old-session.jsonl");
    await writeFile(stale, "", "utf8");
    const old = new Date(Date.now() - 3_600_000);
    await utimes(stale, old, old);

    assert.equal(await resolveSoloTranscript(cwd, claudeProjectsDir, Date.now()), null);
  });
});
