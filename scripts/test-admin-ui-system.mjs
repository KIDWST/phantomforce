import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const index = read("../app/index.html");
const main = read("../app/js/main.js");
const planner = read("../app/js/planner.js");
const adminCss = read("../app/admin-next.css");
const buildId = index.match(/phantom-live-\d{8}-\d+/u)?.[0];
assert.ok(buildId, "The initial admin document must expose a live cache build.");
const escapedBuildId = buildId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const requiredStyles = [
  "phantom.css",
  "phantomplay.css",
  "phantomplay-v2.css",
  "competitor-intelligence.css",
  "orggraph.css",
  "phantom-skin.css",
  "command-os.css",
  "site-studio-responsive.css",
  "workspace-mobile-integrity.css",
  "phantombot-next.css",
  "admin-next.css",
];

for (const file of requiredStyles) {
  assert.match(
    index,
    new RegExp(`<link rel="stylesheet"[^>]*data-admin-page-style[^>]*href="/app/${file.replaceAll(".", "\\.")}`),
    `${file} must be fetched and applied from the initial admin document.`,
  );
}

for (const file of ["phantomstore.css", "creator-studio.css", "phantomhunter.css", "phantomhunter-connect.css"]) {
  assert.doesNotMatch(index, new RegExp(`<link rel="stylesheet"[^>]*href="/app/${file.replaceAll(".", "\\.")}`), `${file} must stay off the initial shell.`);
  assert.match(main, new RegExp(`/${file.replaceAll(".", "\\.")}\\?v=${escapedBuildId}`), `${file} must remain available through the workspace style loader at ${buildId}.`);
}

const adminCssPosition = index.indexOf("/app/admin-next.css");
const integrityCssPosition = index.indexOf("/app/workspace-mobile-integrity.css");
const phantomBotCssPosition = index.indexOf("/app/phantombot-next.css");
const mainModulePosition = index.indexOf('<script type="module" src="/app/js/main.js');
assert.ok(phantomBotCssPosition > integrityCssPosition, "The PhantomBot mission workspace must override its legacy shell layer.");
assert.ok(adminCssPosition > phantomBotCssPosition, "The unified admin brand must remain the final CSS authority.");
assert.ok(adminCssPosition > integrityCssPosition, "The unified admin brand must be the final CSS authority.");
assert.ok(adminCssPosition < mainModulePosition, "Every global admin stylesheet must load before the application boots.");

const requiredModuleHints = [
  "planner.js",
  "phantomai.js",
  "phantomhunter.js",
  "medialab.js",
  "contenthub.js",
  "analytics-hub.js",
  "sitestudio.js",
  "brandops.js",
  "workspaces.js",
  "vacation.js",
];

for (const file of requiredModuleHints) {
  assert.match(index, new RegExp(`<link rel="modulepreload" href="/app/js/${file.replaceAll(".", "\\.")}`), `${file} needs an eager module hint.`);
  assert.match(main, new RegExp(`from "\\./${file.replaceAll(".", "\\.")}\\?v=`), `${file} must remain in the static application module graph.`);
}

for (const className of [
  "planner-hero",
  "planner-metrics",
  "planner-grid",
  "planner-card",
  "planner-brief-list",
  "planner-days",
  "planner-auto-grid",
  "planner-prep-list",
  "planner-add",
]) {
  assert.match(planner, new RegExp(`class="[^"]*${className}`), `Planner must render ${className}.`);
  assert.match(adminCss, new RegExp(`\\.${className}(?:[\\s,{:.>]|$)`), `Planner presentation must style ${className}.`);
}

assert.match(adminCss, /--pf-black:\s*#020705/u, "Admin Next must own the black base.");
assert.match(adminCss, /--pf-green:\s*#18f28f/u, "Admin Next must own the Phantom green accent.");
assert.match(index, /<meta name="theme-color" content="#020705"/u, "Browser and preload chrome must begin on the black brand base.");
assert.match(index, /\.boot-fallback[\s\S]*?rgba\(24, 242, 143/u, "The pre-application loading state must already use Phantom green.");
assert.doesNotMatch(index, /#(?:f3f2fa|f5f4fb|241f3f|5d5880)|rgba\((?:139,\s*103,\s*255|126,\s*103,\s*255|199,\s*153,\s*255|130,\s*112,\s*255|91,\s*76,\s*255)/iu, "The initial document cannot flash the retired light-purple experience.");
assert.match(adminCss, /\.page-worker[\s\S]*?rgba\(24, 242, 143/u, "Page intelligence must use the green brand layer.");
assert.match(adminCss, /\.os-primary-nav button::after[\s\S]*?var\(--pf-green\)/u, "Navigation state must use Phantom green.");
assert.doesNotMatch(adminCss, /purple|violet|indigo|blue|#(?:5b4cff|b44bf0|7c6cff|4f8dff|6da4ff|74a9ff)|rgba\((?:91,\s*76,\s*255|124,\s*108,\s*255|79,\s*141,\s*255)/iu, "The final admin authority must not reintroduce the retired purple/blue palette.");

const openingBraces = (adminCss.match(/\{/gu) || []).length;
const closingBraces = (adminCss.match(/\}/gu) || []).length;
assert.equal(openingBraces, closingBraces, "Admin Next CSS must have balanced blocks.");

console.log(`Admin UI system checks passed: ${requiredStyles.length} global styles, lazy workspace CSS, ${requiredModuleHints.length} eager modules, responsive Planner, green/black brand.`);
