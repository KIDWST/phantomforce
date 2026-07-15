import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../app/js/customization.js", import.meta.url), "utf8");

assert.match(source, /function defaultConfiguration/u, "Workspace Studio needs a local default configuration.");
assert.match(source, /PLATFORM_MODULES/u, "Workspace modules need a local platform-module fallback.");
assert.match(source, /activeConfiguration = defaultConfiguration\(\)/u, "Customization loading must fail open to local defaults.");
assert.match(source, /Modules are available now; publishing waits for the server/u, "Fallback mode needs a clear operator message.");
assert.match(source, /Ready to publish/u, "Workspace Studio should let admins publish without previewing first.");
assert.match(source, /friendlyBackendError[\s\S]*Sign in to load Workspace Studio/u, "Workspace Studio must hide raw auth transport errors behind a clean sign-in message.");
assert.doesNotMatch(source, /!preview\?\.valid \|\| busy/u, "Publish must not require a preview result before it is enabled.");
assert.doesNotMatch(source, /Workspace Studio could not load/u, "Workspace Studio must not dead-end when the backend is temporarily unavailable.");
assert.match(source, /previewCustomizedNavigation/u, "Navigation customization needs a pure preview helper for regression tests.");
assert.match(source, /\(left\.bottom \? 1 : 0\)\s*-\s*\(right\.bottom \? 1 : 0\)/u, "Navigation sorting must use an explicit bottom-group comparison.");

for (const id of ["dashboard", "crm", "media", "sites", "money", "phantomplay", "intelligence", "analytics", "customize", "settings"]) {
  assert.match(source, new RegExp(`\\["${id}"`, "u"), `${id} must be present in the local Workspace Modules fallback.`);
}

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => { storage.set(key, String(value)); },
  removeItem: (key) => { storage.delete(key); },
};
globalThis.sessionStorage = globalThis.localStorage;
globalThis.window = { dispatchEvent() {} };

const { previewCustomizedNavigation } = await import(`../app/js/customization.js?test=${Date.now()}`);
const baseNav = [
  { id: "dashboard" },
  { id: "crm" },
  { id: "clientsetup" },
  { id: "media" },
  { id: "sites" },
  { id: "money" },
  { id: "planner" },
  { id: "phantomplay" },
  { id: "memory", bottom: true },
  { id: "automation", bottom: true },
  { id: "approvals", bottom: true },
  { id: "workers", bottom: true },
  { id: "intelligence", bottom: true },
  { id: "analytics", bottom: true },
  { id: "vacation", bottom: true },
  { id: "developer", bottom: true },
  { id: "settings", bottom: true },
];
const oldSavedOrder = [
  "dashboard", "crm", "clientsetup", "media", "sites", "money", "planner", "phantomplay",
  "intelligence", "analytics", "memory", "automation", "approvals", "workers", "vacation", "developer", "settings",
];
const configuration = {
  modules: oldSavedOrder.map((id, order) => ({ id, label: id, enabled: true, order, roles: ["owner", "admin", "manager", "member", "client"] })),
};
const ownerOrder = previewCustomizedNavigation(baseNav, configuration, "owner").map((item) => item.id);
assert.deepEqual(ownerOrder, [
  "dashboard", "crm", "clientsetup", "media", "sites", "money", "planner", "phantomplay",
  "memory", "automation", "approvals", "workers", "intelligence", "analytics", "vacation", "developer", "settings",
], "Navigation customization must preserve the top group and base sidebar bottom-group order even with old saved module order values.");

console.log("Workspace Studio UI fallback and navigation checks passed.");
