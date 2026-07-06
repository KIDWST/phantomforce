import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const codexTransport = await readFile(
  new URL("../src/phantom-ai/providers/codex-cli-transport.ts", import.meta.url),
  "utf8",
);
const localOllamaTransport = await readFile(
  new URL("../src/phantom-ai/providers/local-ollama-transport.ts", import.meta.url),
  "utf8",
);
const appCommand = await readFile(
  new URL("../../app/js/command.js", import.meta.url),
  "utf8",
);
const appMain = await readFile(
  new URL("../../app/js/main.js", import.meta.url),
  "utf8",
);
const appStore = await readFile(
  new URL("../../app/js/store.js", import.meta.url),
  "utf8",
);
const appWorkspaces = await readFile(
  new URL("../../app/js/workspaces.js", import.meta.url),
  "utf8",
);
const appIndex = await readFile(
  new URL("../../app/index.html", import.meta.url),
  "utf8",
);
const serverIndex = await readFile(
  new URL("../src/index.ts", import.meta.url),
  "utf8",
);
const claudeTransport = await readFile(
  new URL("../src/phantom-ai/providers/claude-cli-transport.ts", import.meta.url),
  "utf8",
);
const openrouterTransport = await readFile(
  new URL("../src/phantom-ai/providers/openrouter-live-transport.ts", import.meta.url),
  "utf8",
);
const publicAppBundle = [appIndex, appCommand, appMain, appStore, appWorkspaces].join("\n");

assert(!codexTransport.includes("This chat run is read-only"), "Codex lane must not tell admin Phantom it is read-only.");
assert(codexTransport.includes("Phantom is an admin command cockpit"), "Private brain lane must frame Phantom as an admin command cockpit.");
assert(codexTransport.includes("business artifacts"), "Codex lane must describe artifact creation capability.");
assert(codexTransport.includes("action adapter returned a receipt"), "Codex lane must preserve truthful execution receipts.");
assert(codexTransport.includes("For practical how-to questions, give 4-6 short usable steps."), "Private brain lane must answer how-to questions with useful steps.");
assert(codexTransport.includes("PHANTOM_CODEX_SANDBOX"), "Codex lane must expose a configurable admin execution sandbox.");
assert(codexTransport.includes("workspace-write"), "Codex lane must default admin execution to workspace-write.");

assert(localOllamaTransport.includes("Phantom is an admin command cockpit with action lanes"), "Local model lane must use action-lane framing.");
assert(appCommand.includes("Ask in plain business language"), "Browser command router must answer capability questions with the unified plain-language framing.");
assert(appCommand.includes("Create a video request"), "Browser command router must expose creation-oriented routes.");
assert(appMain.includes("handleCommand(text)"), "UI must still route command input through the local command engine first.");
assert(appMain.includes("rememberConversation({ prompt: raw"), "UI must persist useful command conversations into local memory.");
assert(appStore.includes("export function rememberConversation"), "App store must expose local memory writes.");
assert(appStore.includes("memoryRetention"), "App store must expose local memory retention rules.");
assert(appIndex.includes("data-command-form"), "Admin UI must include the root command form.");
assert(appIndex.includes("data-phantom-3d"), "Admin UI must include the living Phantom stage mount.");
assert(!/\bcodex\b/i.test(publicAppBundle), "Public app shell must not expose Codex naming in browser-shipped code.");
assert(appWorkspaces.includes("memoryRetention"), "Memory workspace must show retention behavior.");
assert(appWorkspaces.includes("forgetMemory"), "Memory workspace must allow local cleanup.");
assert(serverIndex.includes("admin_execution_mode"), "Backend chat response must report admin execution mode.");
assert(serverIndex.includes("private_brain"), "Backend must expose neutral private brain status instead of raw provider names.");
assert(codexTransport.includes("Execution mode:"), "Codex lane must receive execution mode.");
assert(localOllamaTransport.includes("Execution mode:"), "Local GLM/Ollama lane must receive execution mode.");
assert(claudeTransport.includes("Execution mode:"), "Claude CLI lane must receive execution mode.");
assert(openrouterTransport.includes("Execution mode:"), "OpenRouter GLM lane must receive execution mode.");

console.log(
  JSON.stringify(
    {
      ok: true,
      codexReadOnlyPhraseRemoved: true,
      actionLaneFramingPresent: true,
      browserCapabilityAnswerPresent: true,
      adminExecutionModePresent: true,
      localMemoryPresent: true,
    },
    null,
    2,
  ),
);
