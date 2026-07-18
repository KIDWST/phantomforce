import assert from "node:assert/strict";
import { test } from "node:test";

import { buildProfileArgs } from "../profiles.js";

const claudeProfile = {
  id: "claude",
  label: "Claude CLI",
  command: "pwsh.exe",
  args: ["-NoLogo", "-NoExit", "-Command", "claude"],
  cwd: "C:\\Users\\x",
  detector: "claude",
};

const codexProfile = {
  id: "codex",
  label: "Codex CLI",
  command: "pwsh.exe",
  args: ["-NoLogo", "-NoExit", "-Command", "codex"],
  cwd: "C:\\Users\\x",
  detector: "codex",
};

const openrouterProfile = {
  id: "openrouter",
  label: "OpenRouter CLI",
  command: "pwsh.exe",
  args: ["-NoLogo", "-NoExit", "-Command", 'node "C:\\app\\openrouter-agent\\agent.mjs" --mode approval'],
  cwd: "C:\\Users\\x",
  detector: "openrouter",
};

const pwshProfile = { id: "pwsh", label: "PowerShell", command: "pwsh.exe", args: ["-NoLogo"], cwd: "C:\\Users\\x" };

test("claude profile args gain --model when a model is requested", () => {
  const { args, env } = buildProfileArgs(claudeProfile, { model: "claude-opus-4-8" });
  const joined = args.join(" ");
  assert.ok(joined.includes("--model"), joined);
  assert.ok(joined.includes("claude-opus-4-8"), joined);
  // Still one pwsh -Command invocation of claude.
  assert.equal(args[0], "-NoLogo");
  assert.ok(args[args.length - 1].startsWith("claude"));
  assert.deepEqual(env, {});
});

test("claude profile args are byte-identical without a model (and the profile is never mutated)", () => {
  const before = JSON.stringify(claudeProfile.args);
  const { args, env } = buildProfileArgs(claudeProfile, {});
  assert.deepEqual(args, ["-NoLogo", "-NoExit", "-Command", "claude"]);
  assert.deepEqual(env, {});
  buildProfileArgs(claudeProfile, { model: "claude-opus-4-8" });
  assert.equal(JSON.stringify(claudeProfile.args), before, "buildProfileArgs must not mutate the profile");
});

test("codex profile args gain --model when a model is requested", () => {
  const { args } = buildProfileArgs(codexProfile, { model: "gpt-5-codex" });
  const joined = args.join(" ");
  assert.ok(joined.includes("--model"), joined);
  assert.ok(joined.includes("gpt-5-codex"), joined);
});

test("openrouter profile gets the model as OPENROUTER_MODEL env, not an arg (agent.mjs reads env)", () => {
  const { args, env } = buildProfileArgs(openrouterProfile, { model: "openai/gpt-4o" });
  assert.equal(env.OPENROUTER_MODEL, "openai/gpt-4o");
  assert.deepEqual(args, openrouterProfile.args);
});

test("plain shells ignore a model request entirely", () => {
  const { args, env } = buildProfileArgs(pwshProfile, { model: "claude-opus-4-8" });
  assert.deepEqual(args, ["-NoLogo"]);
  assert.deepEqual(env, {});
});

test("a model id with a quote cannot break out of the pwsh command string", () => {
  const { args } = buildProfileArgs(claudeProfile, { model: "bad'; Remove-Item x" });
  const command = args[args.length - 1];
  // pwsh single-quote escaping doubles the quote — the payload stays inert text.
  assert.ok(command.includes("''"), command);
});
