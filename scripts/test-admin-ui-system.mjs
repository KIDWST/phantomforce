import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const index = read("../app/index.html");
const main = read("../app/js/main.js");
const planner = read("../app/js/planner.js");
const adminCss = read("../app/admin-next.css");
const commandCss = read("../app/command-os.css");
const brandCss = readdirSync(new URL("../app/", import.meta.url))
  .filter((file) => file.endsWith(".css"))
  .map((file) => read(`../app/${file}`))
  .join("\n");
const buildId = index.match(/phantom-live-\d{8}-\d+/u)?.[0];
assert.ok(buildId, "The initial admin document must expose a live cache build.");
const escapedBuildId = buildId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const requiredStyles = [
  "phantom.css",
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

for (const file of ["phantomplay.css", "phantomplay-v2.css", "phantomstore.css", "creator-studio.css", "phantomhunter.css", "phantomhunter-connect.css"]) {
  assert.doesNotMatch(index, new RegExp(`<link rel="stylesheet"[^>]*href="/app/${file.replaceAll(".", "\\.")}`), `${file} must stay isolated from the initial shell.`);
  assert.match(index, new RegExp(`<link rel="preload" as="style"[^>]*data-workspace-style-preload[^>]*href="/app/${file.replaceAll(".", "\\.")}`), `${file} must be downloaded before first navigation.`);
  assert.match(main, new RegExp(`/${file.replaceAll(".", "\\.")}\\?v=${escapedBuildId}`), `${file} must remain available through the workspace style loader at ${buildId}.`);
}

assert.match(main, /const workspaceStylePromises = new Map\(\)[\s\S]*function loadWorkspaceStyle[\s\S]*link\.addEventListener\("load"[\s\S]*function warmWorkspaceStyles/u, "Route-only styles must expose one shared, awaitable preload contract.");
assert.match(main, /async function renderWorkspacePage[\s\S]*await ensureWorkspaceStyles\(key\)[\s\S]*root\.innerHTML/u, "A workspace page must wait for its complete visual system before inserting route markup.");
assert.match(main, /async function openWorkspace[\s\S]*await ensureWorkspaceStyles\(key\)[\s\S]*overlayRoot\.innerHTML/u, "Overlay workspaces must obey the same styled-before-visible handoff.");
assert.match(main, /data-workspace-transition[\s\S]*beginWorkspaceTransition[\s\S]*failWorkspaceTransition/u, "Slow and failed routes must use the branded transition and truthful retry surface.");
assert.match(commandCss, /Workspace handoff[\s\S]*\.workspace-transition[\s\S]*\.workspace-transition-mark[\s\S]*prefers-reduced-motion/u, "The branded route transition must be responsive and reduced-motion safe.");

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
  "planner-attention-list",
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
assert.match(brandCss, /--neon:\s*#41ffa1/u, "The shared product chrome must use Phantom mint as its primary accent.");
assert.doesNotMatch(
  brandCss,
  /#(?:5b4cff|b44bf0|b78cff|7c6cff|6242f5|42e9ff|4f8dff|632bb0|6b54db|886df9|896cf9|9c92ff|814af7|8a79ff|3822c5|5e4ade|241f3f|5d5880|8b87a8|f3f2fa|f4f0ff|aaa2c8|7f789d|070611|2b2649|3a3560)|rgba\((?:91,\s*76,\s*255|91,76,255|98,\s*66,\s*245|124,\s*108,\s*255|139,\s*122,\s*255|129,\s*98,\s*255|138,\s*121,\s*255|129,\s*74,\s*247|79,\s*141,\s*255|180,\s*75,\s*240|51,\s*10,\s*245|43,\s*38,\s*73|36,\s*31,\s*63|36,31,63)/iu,
  "Shared product styles must not retain the retired purple shell palette.",
);

const openingBraces = (adminCss.match(/\{/gu) || []).length;
const closingBraces = (adminCss.match(/\}/gu) || []).length;
assert.equal(openingBraces, closingBraces, "Admin Next CSS must have balanced blocks.");

console.log(`Admin UI system checks passed: ${requiredStyles.length} global styles, atomic warmed workspace CSS, branded route recovery, ${requiredModuleHints.length} eager modules, responsive Planner, green/black brand.`);
