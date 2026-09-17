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
const automationNextCss = read("../app/automation-next.css");
const packageJson = read("../package.json");

const tabsBlock = brandops.match(/const TABS = \[([\s\S]*?)\];/u)?.[1] || "";

assert.match(
  brandops,
  /Customer\/brand context belongs in[\s\S]*the real Memory\/Hermes notes layer/u,
  "Automation must route customer or brand context to the real Memory/Hermes layer.",
);
assert.match(tabsBlock, /\["today", "Today"\]/u, "Automation must lead with the daily command center.");
assert.match(tabsBlock, /\["configured", "Configured"\]/u, "Automation must keep the Configured tab.");
assert.match(tabsBlock, /\["approvals", "Decisions"\]/u, "Automation must own the decision queue.");
assert.match(tabsBlock, /\["risk", "Exceptions"\]/u, "Automation must own operational exceptions.");
assert.match(tabsBlock, /\["recipes", "Recipes"\]/u, "Automation must keep the Recipes tab.");
assert.match(tabsBlock, /\["logs", "Activity"\]/u, "Automation must keep a unified Activity tab.");
assert.match(tabsBlock, /\["safety", "Safety rules"\]/u, "Automation must keep the Safety rules tab.");
assert.doesNotMatch(tabsBlock, /brand|memory/i, "Automation must not include a Brand Memory tab.");
assert.doesNotMatch(
  brandops,
  /Brand Memory|brand memory|brand-memory|brandMemory|data-au-brand|data-brand-memory/u,
  "Automation must not render a redundant Brand Memory form or tab.",
);
assert.match(
  brandops,
  /renderAutomation\(el, opts = \{\}\)[\s\S]*One brain\. Every workflow\./u,
  "Automation should present one unified control plane.",
);
assert.match(
  brandops,
  /friendlyBackendError[\s\S]*Sign in to load automation jobs[\s\S]*Sign in to load the run engine/u,
  "Automation must hide raw auth transport errors for scheduled jobs and agent runs.",
);
assert.match(css, /Automation control plane — workflows, decisions, exceptions/u, "Automation CSS should describe the unified control plane.");
assert.match(automationNextCss, /data-phantombot-view="automations"[\s\S]*phantombot-mission-hud[\s\S]*display:none!important/u, "Automation must remove unrelated chat mission chrome.");
assert.match(automationNextCss, /data-phantombot-view="automations"[\s\S]*phantombot-taskrail[\s\S]*display:none!important/u, "Automation must use the full stage instead of preserving the chat task rail.");
assert.match(automationNextCss, /data-phantombot-view=automations[\s\S]*data-phantomai-tab=chat[\s\S]*display:none!important[\s\S]*data-phantomai-tab=automations[\s\S]*display:inline-flex!important/u, "Automation must show a truthful active workspace label on phones.");
assert.match(brandops, /data-au-tabs-more[\s\S]*syncTabOverflow[\s\S]*scrollBy/u, "Automation must provide a functional mobile control for horizontally overflowed sections.");
assert.match(phantomai, /let activePhantomAiTab = "chat";[\s\S]*activePhantomAiTab = tab;/u, "PhantomBot must retain the active workspace through shell remounts.");
assert.match(phantomai, /requestedWorkspace[\s\S]*"automation"[\s\S]*\? "automations"[\s\S]*: activePhantomAiTab/u, "Direct Automation routes must remount into Automations instead of Chat.");
assert.match(brandops, /renderOperatorMiniSettings[\s\S]*renderApprovals[\s\S]*renderRiskWatch/u, "Automations must combine AI routing, decisions, and exceptions.");
assert.match(brandops, /Daily command center[\s\S]*Attention queue[\s\S]*Provider receipt/u, "Automations must summarize real attention signals and distinguish provider receipts.");
assert.match(packageJson, /test:automation-workspace/u, "Root package must expose the Automation workspace regression test.");
assert.match(main, /data-phantomai-tab="automations"[\s\S]*data-phantombot-automations-mount/u, "PhantomBot must contain the automation control plane.");
assert.match(main, /\{ id: "automation",\s+label: "Automations"[\s\S]*navZone: "bottom"/u, "Automation must remain a quiet operator destination without entering the primary business rail.");
assert.match(phantomai, /renderAutomation\(mount\)/u, "PhantomBot must mount the existing real automation workspace.");
assert.match(main, /automation:\s*\{[\s\S]*renderAutomation\(body/u, "The utility destination and PhantomBot must reuse the same real automation workspace.");
assert.match(automationEngine, /actor_user_id: "phantombot-automation-engine"[\s\S]*model_id: "phantombot-automation-engine"/u, "Automation receipts must identify PhantomBot as the internal runner.");
assert.match(automationEngine, /id: "phantomstore-live-route-guard"[\s\S]*cadence: "hourly"/u, "The former Codex PhantomStore guard must have an hourly PhantomBot-native replacement.");

console.log("Automation workspace checks passed.");
