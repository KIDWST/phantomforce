import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (file) => readFileSync(resolve(here, file), "utf8");

const brandops = read("../app/js/brandops.js");
const phantomai = read("../app/js/phantomai.js");
const main = read("../app/js/main.js");
const automationEngine = read("../server/src/phantom-ai/automation-engine.ts");
const css = read("../app/phantom.css");
const packageJson = read("../package.json");

const tabsBlock = brandops.match(/const TABS = \[([\s\S]*?)\];/u)?.[1] || "";

assert.match(
  brandops,
  /Customer\/brand context belongs in[\s\S]*the real Memory\/Hermes notes layer/u,
  "Automation must route customer or brand context to the real Memory/Hermes layer.",
);
assert.match(tabsBlock, /\["configured", "Configured"\]/u, "Automation must keep the Configured tab.");
assert.match(tabsBlock, /\["recipes", "Recipes"\]/u, "Automation must keep the Recipes tab.");
assert.match(tabsBlock, /\["logs", "Logs"\]/u, "Automation must keep the Logs tab.");
assert.match(tabsBlock, /\["safety", "Safety rules"\]/u, "Automation must keep the Safety rules tab.");
assert.doesNotMatch(tabsBlock, /brand|memory/i, "Automation must not include a Brand Memory tab.");
assert.doesNotMatch(
  brandops,
  /Brand Memory|brand memory|brand-memory|brandMemory|data-au-brand|data-brand-memory/u,
  "Automation must not render a redundant Brand Memory form or tab.",
);
assert.match(
  brandops,
  /renderAutomation\(el, opts = \{\}\)[\s\S]*Configured automations live here/u,
  "Automation should describe itself as configured automations, not brand memory.",
);
assert.match(
  brandops,
  /friendlyBackendError[\s\S]*Sign in to load automation jobs[\s\S]*Sign in to load the run engine/u,
  "Automation must hide raw auth transport errors for scheduled jobs and agent runs.",
);
assert.match(css, /Automation workspace — Configured\/Recipes\/Logs\/Safety/u, "Automation CSS should describe the four automation tabs.");
assert.match(packageJson, /test:automation-workspace/u, "Root package must expose the Automation workspace regression test.");
assert.match(main, /data-phantomai-tab="automations"[\s\S]*data-phantombot-automations-mount/u, "PhantomBot must contain the automation control plane.");
assert.doesNotMatch(main, /\{ id: "automation",\s+label: "Automations"/u, "Automation must not remain a separate top-level application.");
assert.match(phantomai, /renderAutomation\(mount\)/u, "PhantomBot must mount the existing real automation workspace.");
assert.match(automationEngine, /actor_user_id: "phantombot-automation-engine"[\s\S]*model_id: "phantombot-automation-engine"/u, "Automation receipts must identify PhantomBot as the internal runner.");
assert.match(automationEngine, /id: "phantomstore-live-route-guard"[\s\S]*cadence: "hourly"/u, "The former Codex PhantomStore guard must have an hourly PhantomBot-native replacement.");

console.log("Automation workspace checks passed.");
