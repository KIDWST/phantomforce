import { readFileSync } from "node:fs";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

function readProjectFile(relativePath: string) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const buildId = "phantom-live-20260706-30";
const indexHtml = readProjectFile("apps/web/public/app/index.html");
const mainJs = readProjectFile("apps/web/public/app/js/main.js");
const agentOps = readProjectFile("apps/web/public/app/js/agentops.js");
const workspaces = readProjectFile("apps/web/public/app/js/workspaces.js");
const css = readProjectFile("apps/web/public/app/phantom.css");

assert(indexHtml.includes(`window.PHANTOM_BUILD = "${buildId}"`), "Index should expose the current build id.");
assert(indexHtml.includes(`/app/js/main.js?v=${buildId}`), "Index should load the current main bundle.");
assert(indexHtml.includes('data-agent-ticker aria-label="PhantomWire"'), "Top broadcast should be labeled PhantomWire.");
assert(!indexHtml.includes("data-agentops"), "Dashboard markup should not mount the full worker console.");

assert(mainJs.includes(`import { mountAgentTicker } from "./agentops.js?v=${buildId}"`), "Main should import only the compact PhantomWire ticker.");
assert(!mainJs.includes("mountAgentConsole("), "Main should not mount the full worker console outside the Workers surface.");
assert(mainJs.includes("Worker controls live in the Workers tab."), "Developer page should point worker controls to Workers.");

assert(agentOps.includes("<b>PhantomWire</b>"), "Agent activity module should brand the ticker as PhantomWire.");
assert(!agentOps.includes("recent worker activity"), "PhantomWire should not add subtitle copy after the name.");
assert(agentOps.includes('"n8n-worker": "Charles"'), "PhantomWire should alias backend worker names for the top broadcast.");
assert(agentOps.includes(".replace(/\\bn8n\\b/gi, \"workflow lane\")"), "PhantomWire should hide raw backend tool names from the broadcast copy.");
assert(agentOps.includes("<h2>Workers</h2>"), "Fallback console should be titled Workers, not PhantomWire.");

assert(workspaces.includes("workforce: { title: \"Workers\""), "Workers workspace should exist.");
assert(workspaces.includes("renderWorkforce"), "Workers workspace should render the worker roster.");
assert(workspaces.includes("worker-grid"), "Workers workspace should own worker cards.");

assert(css.includes("/* ---- PhantomWire: compact recent-work broadcast under the topbar ---- */"), "CSS should identify PhantomWire as the compact broadcast.");
assert(css.includes(".atk-track"), "CSS should style the PhantomWire scrolling track.");
assert(!css.includes(".agent-ticker { display: none; }"), "PhantomWire should remain visible on mobile.");

console.log(
  JSON.stringify(
    {
      ok: true,
      buildId,
      phantomWireTopBroadcast: true,
      workerRosterInWorkersTab: true,
      mobileTickerVisible: true,
      fullConsoleNotMountedOnDashboard: true,
    },
    null,
    2,
  ),
);
