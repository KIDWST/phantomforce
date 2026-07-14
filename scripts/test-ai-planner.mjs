import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const main = read("../app/js/main.js");
const planner = read("../app/js/planner.js");
const store = read("../app/js/store.js");
const brandops = read("../app/js/brandops.js");
const customization = read("../app/js/customization.js");
const css = read("../app/phantom.css");
const packageJson = read("../package.json");

assert.match(main, /renderPlanner/u, "Planner renderer must be imported into the app shell.");
assert.match(main, /id:\s*"planner"[\s\S]*label:\s*"Planner"[\s\S]*ws:\s*"planner"/u, "Planner must be a top-level navigation item.");
assert.match(main, /planner:\s*\{\s*title:\s*"Planner"[\s\S]*render:\s*\(body\)\s*=>\s*renderPlanner/u, "Planner must mount as a first-class workspace.");
assert.match(main, /planner:\s*"Planner"/u, "Planner must have a mobile navigation label.");
assert.match(main, /id:\s*"memory"[\s\S]*bottom:\s*true/u, "System utilities must stay in the lower sidebar group.");
assert.match(main, /n\.bottom\s*\?\s*"nav-item-bottom"/u, "Desktop navigation must render lower-sidebar classes.");
assert.match(customization, /\["planner",\s*"Planner"/u, "Planner must be registered in workspace customization modules.");
assert.match(customization, /\(left\.bottom \? 1 : 0\)\s*-\s*\(right\.bottom \? 1 : 0\)/u, "Customization sorting must preserve top and bottom sidebar groups.");

const stockBlock = store.match(/export const STOCK_AUTOMATION_BUNDLES = \[([\s\S]*?)\];/u)?.[1] || "";
const stockCount = (stockBlock.match(/id:\s*"phantomforce-/gu) || []).length;
assert.ok(stockCount >= 10, `At least 10 stock automation bundles must ship, found ${stockCount}.`);
assert.match(store, /ensureStockAutomations\(\[\]\)/u, "New stores must seed stock automations.");
assert.match(store, /ensureStockAutomations\(Array\.isArray\(d\.agents\)/u, "Existing stores must be normalized with missing stock automations.");
assert.match(store, /for \(const workspace of workspaces\)[\s\S]*for \(const bundle of STOCK_AUTOMATION_BUNDLES\)/u, "Stock automations must be added to every organization, not only PhantomForce.");
assert.match(store, /safeMode:\s*"read-only-prep"/u, "Stock automations must default to read-only/prep-safe mode.");
assert.match(store, /status:\s*"active"/u, "Stock automations should ship enabled.");

assert.match(brandops, /Bundled work/u, "Automation edit rows must expose the bundled work inside a stock automation.");
assert.match(brandops, /a\.jobs\.length/u, "Automation rows must summarize bundled checks.");

assert.match(planner, /PLANNER_ITEMS_KEY/u, "Planner must persist local plan blocks.");
assert.match(planner, /workspaceStorageGetItem\(PLANNER_ITEMS_KEY/u, "Planner items must load through workspace-isolated storage.");
assert.match(planner, /workspaceStorageSetItem\(PLANNER_ITEMS_KEY/u, "Planner items must save through workspace-isolated storage.");
assert.match(planner, /plannerSignals/u, "Planner must derive signals from live local app state.");
assert.match(planner, /aiPrepQueue/u, "Planner must generate an AI-style prep queue.");
assert.match(planner, /signals\.stockAutomations/u, "Planner must surface stock automation coverage.");
assert.match(store, /Approval queue review|CRM push\/pull preparation|Bank\/card connector check|Calendar connector check/u, "Stock bundles must cover approvals, CRM, accounting, and scheduling.");

assert.match(css, /\.planner-hero/u, "Planner hero must be styled.");
assert.match(css, /\.planner-auto-grid/u, "Planner automation bundle grid must be styled.");
assert.match(css, /\.au-bundle-jobs/u, "Automation bundled-work details must be styled.");
assert.match(packageJson, /test:ai-planner/u, "Package scripts must include the AI Planner regression test.");

console.log("AI Planner checks passed.");
