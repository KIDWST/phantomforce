import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const main = readFileSync(new URL("../app/js/main.js", import.meta.url), "utf8");
const index = readFileSync(new URL("../app/index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/phantom.css", import.meta.url), "utf8");

const widgetStart = main.indexOf("function renderCommandWidgets()");
const widgetEnd = main.indexOf("mount.innerHTML = cards.map(card).join(\"\");", widgetStart);
const widgetSource = widgetStart >= 0 && widgetEnd > widgetStart ? main.slice(widgetStart, widgetEnd) : "";

assert.match(index, /data-command-widgets/u, "Dashboard must keep the expandable command widget mount.");
assert.match(widgetSource, /id:\s*"workforce"/u, "Workforce must stay available as a dashboard widget.");
assert.match(widgetSource, /id:\s*"automations"/u, "Automations must stay available as a dashboard widget.");
assert.match(widgetSource, /id:\s*"phantomwire"/u, "PhantomWire activity must be surfaced on the dashboard.");
assert.match(widgetSource, /renderCommandToolDock\(\)/u, "Workforce widget must show an inline worker dock.");
assert.match(widgetSource, /renderAutomationDock\(automations\)/u, "Automation widget must show an inline automation dock.");
assert.match(main, /function renderCommandToolDock\(\)/u, "Command surface should define the worker dock renderer.");
assert.match(main, /function renderAutomationDock\(automations = \[\]\)/u, "Command surface should define the automation dock renderer.");
assert.match(css, /\.cw-dock\s*\{/u, "Expanded command widgets must have visual dock styling.");
assert.match(css, /\.cw-dock-node::before/u, "Command dock nodes should expose visible status dots.");
assert.doesNotMatch(widgetSource, /id:\s*"memory"/u, "Memory should not consume a dashboard widget slot.");
assert.doesNotMatch(main, /memoryStats\s*\(/u, "Dashboard widgets should not depend on Memory stats.");
assert.match(main, /id:\s*"automation"[\s\S]*?navHidden:\s*true/u, "Automations should stay out of primary navigation.");
assert.match(main, /id:\s*"workers"[\s\S]*?navHidden:\s*true/u, "Workforce should stay out of primary navigation.");
assert.match(main, /id:\s*"memory"[\s\S]*?navHidden:\s*true/u, "Memory should stay out of primary navigation.");

console.log("command surface checks passed");
