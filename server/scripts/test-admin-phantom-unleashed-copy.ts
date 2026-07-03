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

assert(!codexTransport.includes("This chat run is read-only"), "Codex lane must not tell admin Phantom it is read-only.");
assert(codexTransport.includes("Phantom is an admin command cockpit"), "Codex lane must frame Phantom as an admin command cockpit.");
assert(codexTransport.includes("business artifacts"), "Codex lane must describe artifact creation capability.");
assert(codexTransport.includes("action adapter returned a receipt"), "Codex lane must preserve truthful execution receipts.");

assert(localOllamaTransport.includes("Phantom is an admin command cockpit with action lanes"), "Local model lane must use action-lane framing.");
assert(appCommand.includes("Phantom is not read-only"), "Browser command router must answer read-only capability questions directly.");
assert(appMain.includes("Phantom is not read-only"), "UI backend prompt summary must preserve admin action framing.");

console.log(
  JSON.stringify(
    {
      ok: true,
      codexReadOnlyPhraseRemoved: true,
      actionLaneFramingPresent: true,
      browserCapabilityAnswerPresent: true,
    },
    null,
    2,
  ),
);
