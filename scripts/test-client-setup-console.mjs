import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

const files = {
  main: read("app/js/main.js"),
  ui: read("app/js/clientsetup.js"),
  css: read("app/phantom.css"),
  store: read("server/src/client-setup/client-setup-store.ts"),
  server: read("server/src/index.ts"),
  staticServer: read("ops/admin-live/admin-static-server.mjs"),
  moduleRegistry: read("server/src/customization/module-registry.ts"),
  customizationClient: read("app/js/customization.js"),
  packageJson: read("package.json"),
};

const mustInclude = (source, pattern, message) => {
  assert.match(source, pattern, message);
};

mustInclude(files.main, /renderClientSetupConsole/u, "Client Setup console must be imported and rendered.");
mustInclude(files.main, /id:\s*"clientsetup"[\s\S]*label:\s*"Client Setup"/u, "Sidebar nav must include Client Setup.");
mustInclude(files.main, /clientsetup:\s*\{[\s\S]*Owner setup console/u, "Custom route must render the setup console.");
mustInclude(files.moduleRegistry, /id:\s*"clientsetup"/u, "Server module registry must expose clientsetup.");
mustInclude(files.customizationClient, /\["clientsetup",\s*"Client Setup"/u, "Client customization registry must expose clientsetup.");

for (const slotId of ["active-1", "active-2", "pending-1"]) {
  mustInclude(files.ui, new RegExp(slotId, "u"), `UI must include ${slotId} slot.`);
  mustInclude(files.store, new RegExp(slotId, "u"), `Server store must include ${slotId} slot.`);
}

for (const key of [
  "local_service",
  "media_content",
  "contractor_home_service",
  "sports_team_club",
  "restaurant_bar_venue",
  "professional_service",
  "crypto_startup_internal_ops",
]) {
  mustInclude(files.ui, new RegExp(key, "u"), `UI must include ${key} template.`);
  mustInclude(files.store, new RegExp(key, "u"), `Server store must include ${key} template.`);
}

for (const phrase of [
  "Lead Queue",
  "Follow-Up Queue",
  "Social/Content Calendar",
  "Media Assets",
  "Approval Queue",
  "Client Requests",
  "Employee Tasks",
  "Reports",
  "Packages/Offers",
  "Business Cleanup Checklist",
]) {
  mustInclude(files.ui, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"), `UI must include module: ${phrase}`);
}

mustInclude(files.ui, /data-cs-module/u, "Client Setup modules must render as individual toggles.");
mustInclude(files.ui, /currentSlot\(state\)\.modules\[input\.dataset\.csModule\]\s*=\s*input\.checked/u, "Client Setup module toggles must save into the active setup slot.");
mustInclude(files.ui, /Object\.values\(slot\.modules\s*\|\|\s*\{\}\)\.some\(Boolean\)/u, "Client Setup completeness must depend on enabled modules.");
mustInclude(files.store, /CLIENT_SETUP_MODULES/u, "Server store must define canonical Client Setup modules.");
mustInclude(files.store, /modules:\s*Record<string,\s*boolean>/u, "Server setup slots must persist enabled module state.");
mustInclude(files.store, /Object\.values\(slot\.modules\)\.some\(Boolean\)/u, "Server setup completeness must depend on enabled modules.");

for (const requiredSurface of [
  "servicesPackages",
  "leadSources",
  "socialMediaWorkflow",
  "approvalRules",
  "reportingPreferences",
  "computeCompleteness",
  "nextAction",
  "blockers",
  "Save setup",
]) {
  mustInclude(files.ui, new RegExp(requiredSurface, "u"), `UI must include ${requiredSurface}.`);
}

for (const persistedSurface of [
  "servicesPackages",
  "leadSources",
  "socialMediaWorkflow",
  "approvalRules",
  "reportingPreferences",
  "calculateCompleteness",
  "nextAction",
  "blockers",
  "ClientSetupDocument",
]) {
  mustInclude(files.store, new RegExp(persistedSurface, "u"), `Store must include ${persistedSurface}.`);
}

mustInclude(files.server, /app\.get\("\/api\/client-setup"/u, "Server must expose GET /api/client-setup.");
mustInclude(files.server, /app\.post\("\/api\/client-setup\/slots\/:slotId"/u, "Server must expose slot save route.");
mustInclude(files.server, /provider_called:\s*false/u, "Client setup routes must not claim provider calls.");
mustInclude(files.server, /outbound_action_executed:\s*false/u, "Client setup routes must not send outbound actions.");
mustInclude(files.staticServer, /urlPath\.startsWith\("\/api\/client-setup"\)/u, "Static server must proxy client setup API.");
mustInclude(files.css, /\.client-setup-console/u, "Client Setup CSS must exist.");
mustInclude(files.css, /overflow:\s*visible/u, "Client Setup layout must preserve natural page scrolling.");
mustInclude(files.ui, /friendlyClientSetupError[\s\S]*Sign in to load server-backed Client Setup/u, "Client Setup must hide raw auth transport errors behind a clean sign-in message.");
mustInclude(files.ui, /authorization bearer/i, "Client Setup must explicitly map bearer-token failures instead of displaying them.");

const clientSetupSources = `${files.ui}\n${files.store}`;
assert.doesNotMatch(clientSetupSources, /officialchicagoshots|ChicagoShots client|Test Client|fake client/iu, "Client Setup must not seed fake/live client claims.");
assert.doesNotMatch(clientSetupSources, /provider_called:\s*true|outbound_action_executed:\s*true/iu, "Client Setup must not perform provider or outbound actions.");
mustInclude(files.packageJson, /test:client-setup-console/u, "Root package must expose the Client Setup regression test.");

console.log(JSON.stringify({
  ok: true,
  product: "PRODUCT-02 Client Setup Wizard / Owner Setup Console",
  slots: 3,
  activeSlots: 2,
  pendingSlots: 1,
  templates: 7,
  modules: 10,
  serverBacked: true,
  externalActions: false,
}, null, 2));
