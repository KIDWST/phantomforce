import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const main = readFileSync(new URL("../app/js/main.js", import.meta.url), "utf8");
const index = readFileSync(new URL("../app/index.html", import.meta.url), "utf8");

const widgetStart = main.indexOf("function renderCommandWidgets()");
const widgetEnd = main.indexOf("mount.innerHTML = cards.map(card).join(\"\");", widgetStart);
const widgetSource = widgetStart >= 0 && widgetEnd > widgetStart ? main.slice(widgetStart, widgetEnd) : "";

assert.match(index, /data-command-widgets/u, "Dashboard must keep the expandable command widget mount.");
assert.match(widgetSource, /id:\s*"workforce"/u, "Workforce must stay available as a dashboard widget.");
assert.match(widgetSource, /id:\s*"automations"/u, "Automations must stay available as a dashboard widget.");
assert.match(widgetSource, /id:\s*"phantomwire"/u, "PhantomWire activity must be surfaced on the dashboard.");
assert.doesNotMatch(widgetSource, /id:\s*"memory"/u, "Memory should not consume a dashboard widget slot.");
assert.doesNotMatch(main, /memoryStats\s*\(/u, "Dashboard widgets should not depend on Memory stats.");
assert.match(main, /id:\s*"automation"[\s\S]*?navHidden:\s*true/u, "Automations should stay out of primary navigation.");
assert.match(main, /id:\s*"workers"[\s\S]*?navHidden:\s*true/u, "Workforce should stay out of primary navigation.");
assert.match(main, /id:\s*"memory"[\s\S]*?navHidden:\s*true/u, "Memory should stay out of primary navigation.");

console.log("command surface checks passed");
