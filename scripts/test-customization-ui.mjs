import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../app/js/customization.js", import.meta.url), "utf8");

assert.match(source, /function defaultConfiguration/u, "Workspace Studio needs a local default configuration.");
assert.match(source, /PLATFORM_MODULES/u, "Workspace modules need a local platform-module fallback.");
assert.match(source, /activeConfiguration = defaultConfiguration\(\)/u, "Customization loading must fail open to local defaults.");
assert.match(source, /Modules are available now; publishing waits for the server/u, "Fallback mode needs a clear operator message.");
assert.match(source, /Ready to publish/u, "Workspace Studio should let admins publish without previewing first.");
assert.doesNotMatch(source, /!preview\?\.valid \|\| busy/u, "Publish must not require a preview result before it is enabled.");
assert.doesNotMatch(source, /Workspace Studio could not load/u, "Workspace Studio must not dead-end when the backend is temporarily unavailable.");

for (const id of ["dashboard", "crm", "media", "sites", "money", "phantomplay", "intelligence", "analytics", "customize", "settings"]) {
  assert.match(source, new RegExp(`\\["${id}"`, "u"), `${id} must be present in the local Workspace Modules fallback.`);
}

console.log("Workspace Studio UI fallback checks passed.");
