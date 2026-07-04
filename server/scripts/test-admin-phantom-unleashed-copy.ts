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
  new URL("../../apps/web/public/app/js/command.js", import.meta.url),
  "utf8",
);
const appMain = await readFile(
  new URL("../../apps/web/public/app/js/main.js", import.meta.url),
  "utf8",
);
const appStore = await readFile(
  new URL("../../apps/web/public/app/js/store.js", import.meta.url),
  "utf8",
);
const appWorkspaces = await readFile(
  new URL("../../apps/web/public/app/js/workspaces.js", import.meta.url),
  "utf8",
);
const appIndex = await readFile(
  new URL("../../apps/web/public/app/index.html", import.meta.url),
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

assert(!codexTransport.includes("This chat run is read-only"), "Codex lane must not tell admin Phantom it is read-only.");
assert(codexTransport.includes("Phantom is an admin command cockpit"), "Codex lane must frame Phantom as an admin command cockpit.");
assert(codexTransport.includes("business artifacts"), "Codex lane must describe artifact creation capability.");
assert(codexTransport.includes("action adapter returned a receipt"), "Codex lane must preserve truthful execution receipts.");

assert(localOllamaTransport.includes("Phantom is an admin command cockpit with action lanes"), "Local model lane must use action-lane framing.");
assert(appCommand.includes("Phantom is not read-only"), "Browser command router must answer read-only capability questions directly.");
assert(appMain.includes("Phantom is not read-only"), "UI backend prompt summary must preserve admin action framing.");
assert(appStore.includes("export const executionMode"), "App store must expose an admin execution mode.");
assert(appStore.includes("pf.admin.executionMode.v1"), "Execution mode must persist locally.");
assert(appIndex.includes("data-mode-switch"), "Admin UI must include the mode switch control.");
assert(appIndex.includes("data-memory-log"), "Admin UI must include the memory log shortcut.");
assert(appMain.includes("execution_mode: executionMode.get()"), "Admin chat must send execution_mode to the backend.");
assert(appMain.includes("openOwnerMemoryLog"), "App shell must provide a direct owner memory log opener.");
assert(appCommand.includes("Owner Memory Log"), "Command router must support memory log requests.");
assert(appWorkspaces.includes("set-mode-auto"), "PhantomOps must expose Auto Mode control.");
assert(appWorkspaces.includes("set-mode-approval"), "PhantomOps must expose Approval Mode control.");
assert(serverIndex.includes("admin_execution_mode"), "Backend chat response must report admin execution mode.");
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
      ownerMemoryLogShortcutPresent: true,
    },
    null,
    2,
  ),
);
