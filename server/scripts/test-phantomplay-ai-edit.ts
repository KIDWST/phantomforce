import assert from "node:assert/strict";

import {
  explainPhantomPlayProviderFailure,
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
  engine: "Canvas2D",
  projectFiles: ["index.html", "game.ts", "styles.css"],
};

function marked(content: string) {
  return `<<<PHANTOMPLAY_FILE_BEGIN>>>\n${content}\n<<<PHANTOMPLAY_FILE_END>>>`;
}

const invalidOpenRouterKey = explainPhantomPlayProviderFailure("openrouter", "HTTP 401");
assert.equal(invalidOpenRouterKey.code, "api_key_invalid");
assert.match(invalidOpenRouterKey.summary, /API key invalid or expired \(HTTP 401\)/u);

const exhaustedResult = await requestPhantomPlayAiEdit(
  { ...baseInput, provider: "openrouter", model: "deepseek/deepseek-v4-flash" },
  {
    callProvider: async (provider) => {
      if (provider === "openrouter") throw new Error("HTTP 401");
      if (provider === "local") throw new Error("AI edit timed out after 120000ms");
      throw new Error("Command failed: provider executable failed");
    },
  },
);
assert.equal(exhaustedResult.ok, false);
if (exhaustedResult.ok) throw new Error("Exhausted provider test unexpectedly succeeded");
assert.equal(exhaustedResult.code, "api_key_invalid");
assert.match(exhaustedResult.error, /^OpenRouter API key invalid or expired \(HTTP 401\)\./u);
assert.doesNotMatch(exhaustedResult.error, /Automatic fallbacks also failed:/u);
assert.equal(exhaustedResult.failures?.length, 1);

for (const selected of ["codex", "claude", "openrouter", "local"] as const) {
  const calls: string[] = [];
  const callProvider: PhantomPlayAiEditProviderCall = async (provider, prompt, input) => {
    calls.push(provider);
    assert.equal(provider, selected);
    assert.equal(input.model, `${selected}-model`);
    assert.match(prompt, /Increase the score to two/u);
    assert.match(prompt, /export const score = 1/u);
    assert.match(prompt, /Project file map/u);
    assert.match(prompt, /Canvas2D/u);
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
assert.equal(autoResult.provider, "local");
assert.deepEqual(autoCalls, ["codex", "local"]);

const selectedFallbackCalls: Array<{ provider: string; model: string | undefined }> = [];
const selectedFallback = await requestPhantomPlayAiEdit(
  { ...baseInput, provider: "openrouter", model: "deepseek/deepseek-v4-flash" },
  {
    callProvider: async (provider, _prompt, input) => {
      selectedFallbackCalls.push({ provider, model: input.model });
      if (provider === "openrouter") throw new Error("HTTP 503");
      return { raw: marked(revised), provider, model: "fallback-model" };
    },
  },
);
assert.equal(selectedFallback.ok, true);
if (!selectedFallback.ok) throw new Error(selectedFallback.error);
assert.equal(selectedFallback.provider, "codex");
assert.deepEqual(selectedFallbackCalls, [
  { provider: "openrouter", model: "deepseek/deepseek-v4-flash" },
  { provider: "codex", model: "" },
]);

const configuredFallbackCalls: string[] = [];
const configuredFallback = await requestPhantomPlayAiEdit(
  {
    ...baseInput,
    provider: "openrouter",
    model: "z-ai/glm-5.2",
    fallbackProvider: "claude",
    allowFallbacks: true,
  },
  {
    callProvider: async (provider) => {
      configuredFallbackCalls.push(provider);
      if (provider === "openrouter") throw new Error("HTTP 503");
      return { raw: marked(revised), provider, model: "configured-fallback" };
    },
  },
);
assert.equal(configuredFallback.ok, true);
if (!configuredFallback.ok) throw new Error(configuredFallback.error);
assert.equal(configuredFallback.provider, "claude");
assert.deepEqual(configuredFallbackCalls, ["openrouter", "claude"]);

const noFallbackCalls: string[] = [];
const noFallback = await requestPhantomPlayAiEdit(
  { ...baseInput, provider: "codex", allowFallbacks: false },
  {
    callProvider: async (provider) => {
      noFallbackCalls.push(provider);
      throw new Error("Command failed: provider executable failed");
    },
  },
);
assert.equal(noFallback.ok, false);
assert.deepEqual(noFallbackCalls, ["codex"]);

const malformed = await requestPhantomPlayAiEdit(
  { ...baseInput, provider: "local" },
  {
    callProvider: async (provider) => ({ raw: "partial prose only", provider, model: "local-test" }),
  },
);
assert.equal(malformed.ok, false);
if (malformed.ok) throw new Error("Malformed edit unexpectedly succeeded");
assert.match(malformed.error, /required complete-file markers/u);

const invalidJson = await requestPhantomPlayAiEdit(
  { ...baseInput, filePath: "manifest.json", fileContent: "{}", provider: "local" },
  { callProvider: async (provider) => ({ raw: marked("{not-json}"), provider, model: "local-test" }) },
);
assert.equal(invalidJson.ok, false);
if (invalidJson.ok) throw new Error("Invalid JSON edit unexpectedly succeeded");
assert.match(invalidJson.error, /revised JSON is invalid/u);

console.log("PhantomPlay AI edit provider routing test passed.");
