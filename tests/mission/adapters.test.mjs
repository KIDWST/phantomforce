import assert from "node:assert/strict";
import { test } from "node:test";

import { AGENT_PROVIDERS, isAgentProvider, isLaunchMode } from "../../mission/adapters.js";

test("claude, codex, and openrouter are all recognized agent providers", () => {
  assert.equal(isAgentProvider("claude"), true);
  assert.equal(isAgentProvider("codex"), true);
  assert.equal(isAgentProvider("openrouter"), true);
});

test("a plain shell profile is not an agent provider", () => {
  assert.equal(isAgentProvider("pwsh"), false);
  assert.equal(isAgentProvider("cmd"), false);
  assert.equal(isAgentProvider(undefined), false);
});

test("plan/approval/auto are the only recognized launch modes", () => {
  assert.equal(isLaunchMode("plan"), true);
  assert.equal(isLaunchMode("approval"), true);
  assert.equal(isLaunchMode("auto"), true);
  assert.equal(isLaunchMode("bypassPermissions"), false);
  assert.equal(isLaunchMode(undefined), false);
});

test("claude plan mode uses --permission-mode plan (blocks writes)", () => {
  const args = AGENT_PROVIDERS.claude.buildArgs("plan").join(" ");
  assert.ok(args.includes("--permission-mode plan"));
});

test("claude approval mode uses --permission-mode manual (interactive approval)", () => {
  const args = AGENT_PROVIDERS.claude.buildArgs("approval").join(" ");
  assert.ok(args.includes("--permission-mode manual"));
});

test("claude auto mode uses the documented --permission-mode auto, not bypassPermissions", () => {
  const args = AGENT_PROVIDERS.claude.buildArgs("auto").join(" ");
  assert.ok(args.includes("--permission-mode auto"));
  assert.ok(!args.includes("bypassPermissions"));
});

test("codex plan mode uses a read-only sandbox", () => {
  const args = AGENT_PROVIDERS.codex.buildArgs("plan").join(" ");
  assert.ok(args.includes("--sandbox read-only"));
});

test("codex approval mode uses a workspace-write sandbox with on-request approval", () => {
  const args = AGENT_PROVIDERS.codex.buildArgs("approval").join(" ");
  assert.ok(args.includes("--sandbox workspace-write"));
  assert.ok(args.includes("--ask-for-approval on-request"));
});

test("codex auto mode uses the documented --ask-for-approval never, not the dangerous bypass flag", () => {
  const args = AGENT_PROVIDERS.codex.buildArgs("auto").join(" ");
  assert.ok(args.includes("--sandbox workspace-write"));
  assert.ok(args.includes("--ask-for-approval never"));
  assert.ok(!args.includes("dangerously-bypass"));
});

test("openrouter buildArgs runs the agent script with the given mode", () => {
  const args = AGENT_PROVIDERS.openrouter.buildArgs("auto").join(" ");
  assert.ok(args.includes("--mode auto"));
  assert.ok(args.includes("agent.mjs"));
});

test("openrouter buildArgs includes --usage-log when a path is given", () => {
  const args = AGENT_PROVIDERS.openrouter.buildArgs("approval", { usageLogPath: "C:\\some\\path\\usage.jsonl" }).join(" ");
  assert.ok(args.includes("--usage-log"));
  assert.ok(args.includes("usage.jsonl"));
});

test("openrouter buildArgs with no opts still works (backward compatible default)", () => {
  assert.doesNotThrow(() => AGENT_PROVIDERS.openrouter.buildArgs("plan"));
});
