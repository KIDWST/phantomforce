import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (path) => readFileSync(resolve(here, path), "utf8");

const runtime = read("../app/js/ai-runtime.js");
const settings = read("../app/js/settings.js");
const command = read("../app/js/command.js");
const pageWorker = read("../app/js/pageworker.js");
const phantomBot = read("../app/js/phantomai.js");
const main = read("../app/js/main.js");
const server = read("../server/src/index.ts");
const claude = read("../server/src/phantom-ai/providers/claude-cli-transport.ts");
const codex = read("../server/src/phantom-ai/providers/codex-cli-transport.ts");
const openRouter = read("../server/src/phantom-ai/providers/openrouter-live-transport.ts");
const providerManager = read("../server/src/phantom-ai/admin-provider-manager.ts");

for (const id of ["local_ollama", "codex_cli", "claude_cli", "openrouter_glm", "chatgpt_bridge"]) {
  assert.match(runtime, new RegExp(`\\b${id}\\b`, "u"), `${id} must be part of the unified browser runtime.`);
}
assert.match(runtime, /runtime_config:\s*true/u, "Every unified AI request must opt into the saved organization runtime.");
assert.match(runtime, /\/phantom-ai\/runtime\/config/u, "The browser runtime must persist organization AI settings on the server.");
assert.match(runtime, /expected_version/u, "AI runtime saves must use optimistic version checks.");
assert.match(runtime, /waitForAiRuntimeSave/u, "Prompt submission must be able to wait for an in-flight model choice save.");

assert.match(settings, /name:\s*"Codex"/u, "The user-facing provider list must expose Codex by name.");
assert.match(settings, /name:\s*"Claude"/u, "The user-facing provider list must expose Claude by name.");
assert.match(settings, /name:\s*"OpenRouter"/u, "The user-facing provider list must expose OpenRouter by name.");
assert.match(settings, /name:\s*"Phantom V1"/u, "The user-facing provider list must expose the local Phantom/Ollama lane.");
assert.match(settings, /type="text"[\s\S]{0,160}data-ai-provider-model/u, "Custom provider model IDs must be enterable, not limited to a decorative dropdown.");
assert.match(settings, /Real means a live health check passed/u, "Settings must explain truthful provider state.");
assert.match(settings, /Saved for this organization/u, "Settings must disclose organization-level persistence.");
assert.match(settings, /select\.oninput[\s\S]{0,220}setTimeout\(commitModel, 450\)/u, "Typed custom model IDs must persist after a short debounce.");
assert.doesNotMatch(settings, /Kimi K3 direct is available/u, "Settings must not claim an unverified direct Kimi transport.");

assert.match(command, /await waitForAiRuntimeSave\(\)/u, "PhantomBot must wait for the selected model to persist before sending.");
assert.match(command, /\.\.\.buildAiRuntimeRequest\(settings, "phantombot"\)/u, "PhantomBot must use the unified runtime selection.");
assert.match(command, /SINGLE_PROVIDER_MAX_PROVIDER_MS\[providerId\] \|\| INSTANT_CHAT_MAX_PROVIDER_MS/u, "An explicitly selected provider must receive its direct-call budget without slowing Hybrid chat.");
assert.match(command, /return fallbackProviderId \|\| "local"/u, "Reasoning requests must not silently force ChatGPT.");
assert.doesNotMatch(command, /providerId:\s*"chatgpt"[\s\S]{0,180}allowedProviders:\s*\[PROVIDER_TO_BACKEND\.chatgpt\]/u, "Effort controls must not override the chosen provider with ChatGPT.");
assert.doesNotMatch(command, /\/phantom-ai\/respond/u, "PhantomBot must not bypass the unified runtime through the retired response endpoint.");

assert.match(pageWorker, /buildAiRuntimeRequest\(pageWorkerAiSettings\(\), `page_outcome:\$\{pageId\}`\)/u, "Prompt the Outcome must use the same model selection as PhantomBot.");
assert.match(pageWorker, /payload\.ai_runtime/u, "Prompt the Outcome must render the actual provider/model receipt.");
assert.doesNotMatch(pageWorker, /admin_model:\s*"private"/u, "Prompt the Outcome must not hard-code the old private lane.");

assert.match(phantomBot, /phantomai-runtime-receipt/u, "PhantomBot must show its runtime receipt.");
assert.match(phantomBot, /fallback used/u, "PhantomBot must disclose fallback use.");
assert.doesNotMatch(phantomBot, /PhantomBot connected/u, "PhantomBot must not claim a provider is connected without a real state check.");
assert.doesNotMatch(phantomBot, /Phantom V1:Latest/u, "PhantomBot must not display a hard-coded model identity.");
assert.match(main, /function phantomBotBrainPresentation\(\)/u, "The PhantomBot shell must derive its brain label from the selected runtime.");
assert.match(main, /getOperatorInfrastructureStatus\(\)/u, "The PhantomBot shell must derive truth state from provider health.");
assert.doesNotMatch(main, /PhantomBot connected/u, "The app shell must not claim a provider is connected without a real state check.");
assert.doesNotMatch(main, /Phantom V1:Latest/u, "The app shell must not display a hard-coded model identity.");

assert.match(server, /app\.get\("\/phantom-ai\/runtime\/config"/u, "Server must expose the saved AI runtime.");
assert.match(server, /app\.put\("\/phantom-ai\/runtime\/config"/u, "Server must persist AI runtime updates.");
assert.match(server, /app\.post\("\/phantom-ai\/runtime\/providers\/refresh"/u, "Server must support explicit provider health refresh.");
assert.match(server, /runtimeConfigState\?\.source === "saved"/u, "Chat must use server-persisted runtime state when it exists.");
assert.match(server, /ai_runtime:\s*runtimeConfig/u, "Chat responses must include a runtime receipt.");

assert.match(claude, /\["--model", modelId\]/u, "Claude's selected model must reach the CLI --model flag.");
assert.match(codex, /PHANTOM_CODEX_MODEL/u, "Codex must accept the exact selected model from the unified runtime.");
assert.match(codex, /--model \$model/u, "Codex's selected model must reach the CLI --model flag.");
assert.match(codex, /model_id:\s*model/u, "Codex receipts must preserve the actual selected model.");
assert.match(openRouter, /model:\s*modelId/u, "OpenRouter's selected model must reach the request body.");
assert.match(openRouter, /model_id:\s*modelId/u, "OpenRouter receipts must preserve the actual selected model.");
assert.match(providerManager, /PHANTOM_LIVE_PROVIDERS_ENABLED === "true"[\s\S]{0,160}PHANTOM_OPENROUTER_TRANSPORT_ENABLED === "true"/u, "OpenRouter health must use the same enable flags as its live transport.");
assert.match(providerManager, /DEFAULT_CLAUDE_PS1[\s\S]{0,180}"auth",[\s\S]{0,40}"status"/u, "Claude health must verify authentication, not merely the presence of a script.");

console.log("AI runtime UI and routing contract checks passed.");
