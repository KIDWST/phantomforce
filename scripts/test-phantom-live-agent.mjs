import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const appHtml = read("app/index.html");
const mainSource = read("app/js/main.js");
const liveAgentSource = read("app/js/phantomlive.js");
const liveAgentCss = read("app/phantomlive.css");
const storeSource = read("app/js/phantomstore.js");
const backendStoreSource = read("server/src/phantom-ai/phantomstore.ts");

assert.match(appHtml, /phantomlive\.css/u, "App shell must load Phantom Live Agent styles.");
assert.match(appHtml, /data-nav-id="phantomlive"[\s\S]*Live Agent/u, "Top navigation must expose Live Agent.");
assert.match(mainSource, /renderPhantomLiveAgent/u, "Main app must import the Live Agent renderer.");
assert.match(mainSource, /id:\s*"phantomlive"[\s\S]*label:\s*"Live Agent"/u, "Sidebar registry must expose Phantom Live Agent.");
assert.match(mainSource, /phantomlive:\s*\{\s*title:\s*"Phantom Live Agent"[\s\S]*render:\s*\(body\)\s*=>\s*renderPhantomLiveAgent\(body\)/u, "Workspace registry must render Phantom Live Agent.");
assert.match(mainSource, /free:\s*new Set\(\[[\s\S]*"phantomlive"/u, "Live Agent must be available from the free plan workflow set.");

assert.match(liveAgentSource, /export function renderPhantomLiveAgent/u, "Live Agent module must export its renderer.");
assert.match(liveAgentSource, /pf\.phantomLiveAgents\.v1/u, "Live Agent state must use a scoped local storage key.");
assert.match(liveAgentSource, /Agent Creator/u, "Live Agent must render the creator section.");
assert.match(liveAgentSource, /Test Sandbox/u, "Live Agent must render the sandbox section.");
assert.match(liveAgentSource, /Store \/ Arsenal/u, "Live Agent must render the Store / Arsenal packaging section.");
assert.match(liveAgentSource, /Activate locally/u, "Runtime actions must be local activation, not public deployment.");
assert.match(liveAgentSource, /Pause/u, "Runtime actions must allow pausing the local agent.");
assert.match(liveAgentSource, /Speak intro/u, "Runtime must include local browser speech preview.");
assert.match(liveAgentSource, /externalActions[\s\S]*locked in this slice/u, "External actions must stay blocked by deterministic UI logic.");
assert.match(liveAgentSource, /Hermes approval\/autopilot/u, "Hands-on work must be routed to Hermes approval/autopilot policy.");
assert.match(liveAgentSource, /does not send email, post, upload, charge, scan/u, "UI must state no-send/no-upload/no-scan boundaries.");
assert.doesNotMatch(liveAgentSource, /fetch\(/u, "Live Agent slice must not call APIs or hidden remote services.");

for (const selector of [
  ".pla-shell",
  ".pla-hero",
  ".pla-tabs",
  ".pla-grid",
  ".pla-panel",
  ".pla-avatar",
  ".pla-sandbox",
  ".pla-package",
]) {
  assert.match(liveAgentCss, new RegExp(selector.replace(".", "\\."), "u"), `Live Agent CSS must define ${selector}.`);
}

assert.match(storeSource, /product-phantom-live-agent/u, "Offline PhantomStore fallback must list Phantom Live Agent.");
assert.match(backendStoreSource, /product-phantom-live-agent/u, "Backend PhantomStore seed must list Phantom Live Agent.");
assert.match(storeSource + backendStoreSource, /Create a living AI employee/u, "Store listing must match the product promise.");
assert.match(storeSource + backendStoreSource, /external channels, tools, and public deployment require explicit setup and approval/iu, "Store listing must preserve safety boundaries.");
assert.ok(statSync(new URL("../app/assets/phantomstore/phantom-live-agent-cover.svg", import.meta.url)).size > 2500, "Phantom Live Agent cover must be a real branded asset.");

console.log("Phantom Live Agent slice checks passed.");
