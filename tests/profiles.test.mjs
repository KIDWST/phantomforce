import assert from "node:assert/strict";
import { test } from "node:test";

import { terminalEnv } from "../profiles.js";

test("terminalEnv() with no argument matches today's behavior — no provider key injected", () => {
  const env = terminalEnv();
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.TERM, "xterm-256color");
});

test("terminalEnv(providerId) with no stored connection does not inject a key", () => {
  const env = terminalEnv("claude");
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
});
