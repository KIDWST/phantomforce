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
const commandOs = read("../app/js/command-os.js");
const index = read("../app/index.html");
const server = read("../server/src/index.ts");
const claude = read("../server/src/phantom-ai/providers/claude-cli-transport.ts");
const codex = read("../server/src/phantom-ai/providers/codex-cli-transport.ts");
const openRouter = read("../server/src/phantom-ai/providers/openrouter-live-transport.ts");
const providerManager = read("../server/src/phantom-ai/admin-provider-manager.ts");
const deepSeek = read("../server/src/phantom-ai/providers/deepseek-v4-transport.ts");
const credentials = read("../server/src/phantom-ai/ai-provider-credentials.ts");
const settingsSkin = read("../app/admin-next.css");

for (const id of ["deepseek_api", "local_ollama", "codex_cli", "claude_cli", "openrouter_glm", "chatgpt_bridge"]) {
  assert.match(runtime, new RegExp(`\\b${id}\\b`, "u"), `${id} must be part of the unified browser runtime.`);
}
assert.match(runtime, /phantom_bot:\s*buildRouteConfig\(settings\.phantomBot \|\| settings\)/u, "The saved runtime must carry a separate PhantomBot route.");
assert.match(runtime, /routeForSurface\(config, surface\)/u, "Each request must resolve the correct platform or PhantomBot route.");
assert.match(runtime, /runtime_config:\s*true/u, "Every unified AI request must opt into the saved organization runtime.");
assert.match(runtime, /\/phantom-ai\/runtime\/config/u, "The browser runtime must persist organization AI settings on the server.");
assert.match(runtime, /expected_version/u, "AI runtime saves must use optimistic version checks.");
assert.match(runtime, /waitForAiRuntimeSave/u, "Prompt submission must be able to wait for an in-flight model choice save.");

assert.match(settings, /name:\s*"Codex"/u, "The user-facing provider list must expose Codex by name.");
assert.match(settings, /name:\s*"Claude"/u, "The user-facing provider list must expose Claude by name.");
assert.match(settings, /name:\s*"OpenRouter"/u, "The user-facing provider list must expose OpenRouter by name.");
assert.match(settings, /name:\s*"Phantom V1"/u, "The user-facing provider list must expose the local Phantom/Ollama lane.");
assert.match(settings, /name:\s*"DeepSeek V4 Flash"/u, "The AI control center must expose DeepSeek V4 Flash.");
assert.match(settings, /providerId:\s*"deepseek_api"/u, "DeepSeek must have a server-backed credential setup control.");
assert.match(settings, /providerId:\s*"openrouter_glm"/u, "OpenRouter must have a server-backed credential setup control.");
assert.match(settings, /Platform brain/u, "Settings must label the organization-wide platform brain.");
assert.match(settings, /Controls PhantomBot conversations only/u, "Settings must explain that PhantomBot has an independent route.");
assert.match(settings, /<select data-ai-route="\$\{esc\(routeId\)\}" data-ai-provider-model/u, "Provider models must use clear dropdown controls.");
assert.match(settings, /OpenRouter model catalogue/u, "The gateway must expose the live OpenRouter model catalogue.");
assert.match(settings, /Phantom Loop/u, "The gateway must expose optional loop controls alongside the two independent brains.");
assert.match(settings, /Real means a provider health check or model request passed/u, "Settings must explain truthful provider state.");
assert.match(settings, /Saved for this organization/u, "Settings must disclose organization-level persistence.");
assert.doesNotMatch(settings, /Kimi K3 direct is available/u, "Settings must not claim an unverified direct Kimi transport.");
assert.match(runtime, /\/phantom-ai\/runtime\/models/u, "The browser runtime must load provider model catalogues through the organization gateway.");
assert.match(commandOs, /localStorage\.setItem\("pf\.settings\.tab\.v1", "model"\)/u, "The footer gateway must open the dedicated brain page.");
assert.doesNotMatch(commandOs, /renderOperatorMiniSettings/u, "The footer gateway must not open the PhantomBot-only mini control.");
assert.match(index, /<b>GATEWAY<\/b>/u, "The bottom status entry must be clearly labeled Gateway.");

assert.match(command, /await waitForAiRuntimeSave\(\)/u, "PhantomBot must wait for the selected model to persist before sending.");
assert.match(command, /\.\.\.buildAiRuntimeRequest\(settings, "phantombot"\)/u, "PhantomBot must use its independent saved runtime route.");
assert.match(command, /SINGLE_PROVIDER_MAX_PROVIDER_MS\[providerId\] \|\| INSTANT_CHAT_MAX_PROVIDER_MS/u, "An explicitly selected provider must receive its direct-call budget without slowing Hybrid chat.");
assert.match(command, /return fallbackProviderId \|\| "local"/u, "Reasoning requests must not silently force ChatGPT.");
assert.doesNotMatch(command, /providerId:\s*"chatgpt"[\s\S]{0,180}allowedProviders:\s*\[PROVIDER_TO_BACKEND\.chatgpt\]/u, "Effort controls must not override the chosen provider with ChatGPT.");
assert.doesNotMatch(command, /\/phantom-ai\/respond/u, "PhantomBot must not bypass the unified runtime through the retired response endpoint.");

assert.match(pageWorker, /buildAiRuntimeRequest\(pageWorkerAiSettings\(\), `page_outcome:\$\{pageId\}`\)/u, "Prompt the Outcome must use the platform brain route.");
assert.match(pageWorker, /payload\.ai_runtime/u, "Prompt the Outcome must render the actual provider/model receipt.");
assert.doesNotMatch(pageWorker, /admin_model:\s*"private"/u, "Prompt the Outcome must not hard-code the old private lane.");

assert.match(phantomBot, /phantomai-runtime-receipt/u, "PhantomBot must show its runtime receipt.");
assert.match(phantomBot, /fallback used/u, "PhantomBot must disclose fallback use.");
assert.doesNotMatch(phantomBot, /PhantomBot connected/u, "PhantomBot must not claim a provider is connected without a real state check.");
assert.doesNotMatch(phantomBot, /Phantom V1:Latest/u, "PhantomBot must not display a hard-coded model identity.");
assert.match(main, /function phantomBotBrainPresentation\(\)/u, "The PhantomBot shell must derive its brain label from the selected runtime.");
assert.match(main, /getOperatorInfrastructureStatus\("phantombot"\)/u, "The PhantomBot shell must derive truth state from its own provider route and health.");
assert.doesNotMatch(main, /PhantomBot connected/u, "The app shell must not claim a provider is connected without a real state check.");
assert.doesNotMatch(main, /Phantom V1:Latest/u, "The app shell must not display a hard-coded model identity.");

assert.match(server, /app\.get\("\/phantom-ai\/runtime\/config"/u, "Server must expose the saved AI runtime.");
assert.match(server, /app\.put\("\/phantom-ai\/runtime\/config"/u, "Server must persist AI runtime updates.");
assert.match(server, /app\.put\("\/phantom-ai\/runtime\/credentials"/u, "Server must securely accept organization AI credentials.");
assert.match(server, /app\.delete\("\/phantom-ai\/runtime\/credentials"/u, "Server must let an owner remove an organization AI credential.");
assert.match(server, /app\.get\("\/phantom-ai\/runtime\/models"/u, "Server must expose authenticated provider model discovery.");
assert.match(server, /app\.post\("\/phantom-ai\/runtime\/providers\/refresh"/u, "Server must support explicit provider health refresh.");
assert.match(server, /aiRuntimeRouteForSurface\(runtimeConfig, runtimeSurface\)/u, "The server must resolve platform and PhantomBot requests independently.");
assert.match(server, /runtimeConfigState\?\.source === "saved"/u, "Chat must use server-persisted runtime state when it exists.");
assert.match(server, /ai_runtime:\s*runtimeConfig/u, "Chat responses must include a runtime receipt.");

assert.match(claude, /\["--model", modelId\]/u, "Claude's selected model must reach the CLI --model flag.");
assert.match(codex, /PHANTOM_CODEX_MODEL/u, "Codex must accept the exact selected model from the unified runtime.");
assert.match(codex, /--model \$model/u, "Codex's selected model must reach the CLI --model flag.");
assert.match(codex, /model_id:\s*model/u, "Codex receipts must preserve the actual selected model.");
assert.match(openRouter, /model:\s*modelId/u, "OpenRouter's selected model must reach the request body.");
assert.match(openRouter, /model_id:\s*modelId/u, "OpenRouter receipts must preserve the actual selected model.");
assert.match(openRouter, /options\.credential\?\.trim\(\)/u, "OpenRouter must accept the organization-encrypted credential.");
assert.match(deepSeek, /https:\/\/api\.deepseek\.com\/chat\/completions/u, "DeepSeek must use its direct official API endpoint.");
assert.match(deepSeek, /model:\s*modelId/u, "The selected DeepSeek model must reach the request body.");
assert.match(credentials, /aes-256-gcm/u, "Provider API keys must be encrypted at rest.");
assert.match(credentials, /secret_returned:\s*false/u, "Credential status must never return the raw key.");
assert.match(credentials, /"deepseek_api", "openrouter_glm"/u, "The encrypted vault must support both DeepSeek and OpenRouter keys.");
assert.match(providerManager, /PHANTOM_LIVE_PROVIDERS_ENABLED === "true"[\s\S]{0,160}PHANTOM_OPENROUTER_TRANSPORT_ENABLED === "true"/u, "OpenRouter health must use the same enable flags as its live transport.");
assert.match(providerManager, /DEFAULT_CLAUDE_PS1[\s\S]{0,180}"auth",[\s\S]{0,40}"status"/u, "Claude health must verify authentication, not merely the presence of a script.");
assert.match(settingsSkin, /Settings control center/u, "The final app skin must own the settings visual system.");
assert.match(settingsSkin, /\.settings-operator \.set-route-grid[\s\S]{0,120}repeat\(2/u, "Platform and PhantomBot routes must be visually comparable.");

console.log("AI runtime UI and routing contract checks passed.");
