import assert from "node:assert/strict";

import {
  requestPhantomPlayAiEdit,
  type PhantomPlayAiEditProviderCall,
  type PhantomPlayAiProvider,
} from "../src/phantomplay-ai-edit.js";

const original = "export const score = 1;\n";
const revised = "export const score = 2;\n";
const baseInput = {
  gameId: "test-game",
  filePath: "game.ts",
  fileContent: original,
  instruction: "Increase the score to two.",
  cwd: process.cwd(),
};

function marked(content: string) {
  return `<<<PHANTOMPLAY_FILE_BEGIN>>>\n${content}\n<<<PHANTOMPLAY_FILE_END>>>`;
}

for (const selected of ["codex", "claude", "openrouter", "local"] as const) {
  const calls: string[] = [];
  const callProvider: PhantomPlayAiEditProviderCall = async (provider, prompt, input) => {
    calls.push(provider);
    assert.equal(provider, selected);
    assert.equal(input.model, `${selected}-model`);
    assert.match(prompt, /Increase the score to two/u);
    assert.match(prompt, /export const score = 1/u);
    return { raw: marked(revised), provider, model: `${selected}-model` };
  };
  const result = await requestPhantomPlayAiEdit(
    { ...baseInput, provider: selected, model: `${selected}-model` },
    { callProvider },
  );
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error(result.error);
  assert.equal(result.newContent, revised);
  assert.equal(result.provider, selected);
  assert.equal(result.model, `${selected}-model`);
  assert.deepEqual(calls, [selected]);
}

const autoCalls: Array<Exclude<PhantomPlayAiProvider, "auto">> = [];
const autoResult = await requestPhantomPlayAiEdit(
  { ...baseInput, provider: "auto" },
  {
    callProvider: async (provider) => {
      autoCalls.push(provider);
      if (provider === "codex") throw new Error("Codex offline for deterministic test");
      return { raw: marked(revised), provider, model: "fallback-model" };
    },
  },
);
assert.equal(autoResult.ok, true);
if (!autoResult.ok) throw new Error(autoResult.error);
assert.equal(autoResult.provider, "claude");
assert.deepEqual(autoCalls, ["codex", "claude"]);

const malformed = await requestPhantomPlayAiEdit(
  { ...baseInput, provider: "local" },
  {
    callProvider: async (provider) => ({ raw: "partial prose only", provider, model: "local-test" }),
  },
);
assert.equal(malformed.ok, false);
if (malformed.ok) throw new Error("Malformed edit unexpectedly succeeded");
assert.match(malformed.error, /required complete-file markers/u);

console.log("PhantomPlay AI edit provider routing test passed.");
