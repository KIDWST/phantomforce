import assert from "node:assert/strict";
import { test } from "node:test";

import { AGENT_PROVIDERS, isAgentProvider } from "../../mission/adapters.js";

test("claude and codex are both recognized agent providers", () => {
  assert.equal(isAgentProvider("claude"), true);
  assert.equal(isAgentProvider("codex"), true);
});

test("a plain shell profile is not an agent provider", () => {
  assert.equal(isAgentProvider("pwsh"), false);
  assert.equal(isAgentProvider("cmd"), false);
  assert.equal(isAgentProvider(undefined), false);
});

test("claude audit mode uses --permission-mode plan (blocks writes)", () => {
  const args = AGENT_PROVIDERS.claude.buildArgs("audit").join(" ");
  assert.ok(args.includes("--permission-mode plan"));
});

test("claude write mode uses --permission-mode default (interactive approval)", () => {
  const args = AGENT_PROVIDERS.claude.buildArgs("write").join(" ");
  assert.ok(args.includes("--permission-mode default"));
});

test("codex audit mode uses a read-only sandbox", () => {
  const args = AGENT_PROVIDERS.codex.buildArgs("audit").join(" ");
  assert.ok(args.includes("--sandbox read-only"));
});

test("codex write mode uses a workspace-write sandbox with on-request approval", () => {
  const args = AGENT_PROVIDERS.codex.buildArgs("write").join(" ");
  assert.ok(args.includes("--sandbox workspace-write"));
  assert.ok(args.includes("--ask-for-approval on-request"));
});
