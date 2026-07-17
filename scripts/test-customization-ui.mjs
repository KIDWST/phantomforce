import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../app/js/customization.js", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../app/js/main.js", import.meta.url), "utf8");
const settingsSource = readFileSync(new URL("../app/js/settings.js", import.meta.url), "utf8");

assert.match(source, /function defaultConfiguration/u, "Workspace Studio needs a local default configuration.");
assert.match(source, /PLATFORM_MODULES/u, "Workspace modules need a local platform-module fallback.");
assert.match(source, /activeConfiguration = defaultConfiguration\(\)/u, "Customization loading must fail open to local defaults.");
assert.match(source, /Modules are available now; publishing waits for the server/u, "Fallback mode needs a clear operator message.");
assert.doesNotMatch(source, /Workspace Studio could not load/u, "Workspace Studio must not dead-end when the backend is temporarily unavailable.");
assert.match(mainSource, /id:\s*"admincontrol"/u, "Owner Admin Control needs a bottom sidebar nav item.");
assert.match(mainSource, /ownerOnly:\s*true[^}]*ws:\s*"admincontrol"|ws:\s*"admincontrol"[^}]*ownerOnly:\s*true/u, "Admin Control must stay owner-only.");
assert.match(settingsSource, /export function renderOwnerAdminControl/u, "Admin Control needs a dedicated owner console renderer.");
assert.match(source, /Validate and publish/u, "Workspace Studio should support publish without forcing a separate preview click.");

for (const id of ["dashboard", "crm", "media", "sites", "money", "phantomplay", "intelligence", "analytics", "customize", "settings"]) {
  assert.match(source, new RegExp(`\\["${id}"`, "u"), `${id} must be present in the local Workspace Modules fallback.`);
}

console.log("Workspace Studio UI fallback checks passed.");
