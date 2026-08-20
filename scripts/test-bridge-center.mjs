import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const settings = readFileSync(new URL("../app/js/settings.js", import.meta.url), "utf8");
const connections = readFileSync(new URL("../app/js/connection-center.js", import.meta.url), "utf8");
const phantomBot = readFileSync(new URL("../app/js/phantomai.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/admin-next.css", import.meta.url), "utf8");

assert.match(settings, /\{ id: "bridge", label: "Bridges", category: "Connections" \}/u, "Bridges must be a dedicated Connections tab.");
assert.match(settings, /\/phantom-ai\/agent-assist\/status/u, "Bridge control must read the real ChatGPT bridge status.");
assert.match(settings, /\/api\/creative-engine\/status/u, "Bridge control must read the real Higgsfield creative-engine status.");
assert.match(settings, /data-bridge-card="chatgpt"[\s\S]*data-bridge-card="higgsfield"/u, "ChatGPT Plus and Higgsfield must have separate bridge cards.");
assert.match(settings, /Credits used[\s\S]*Credits remaining/u, "The Higgsfield bridge must show tracked credits used and remaining.");
assert.match(settings, /Usage remaining<\/dt><dd>Not reported by ChatGPT/u, "ChatGPT usage limits must not be invented when the provider does not report them.");
assert.match(settings, /PhantomForce brain[\s\S]*PhantomBot brain/u, "The connection overview must keep the platform and PhantomBot brains visibly separate.");
assert.match(settings, /data-bridge-ai-form[\s\S]*Build with PhantomBot[\s\S]*data-bridge-custom-manual/u, "New bridge setup must offer AI-guided and manual paths.");
assert.match(settings, /Keep the bridge in setup until a real authenticated health check proves it is active/u, "AI-guided setup must preserve connection truth.");

assert.match(connections, /Active first[\s\S]*Configured connections/u, "Configured connections must be shown before the connector catalogue.");
assert.match(connections, /\.sort\(\(a, b\)[\s\S]*connected: 0/u, "Active connections must sort before checking or attention states.");
assert.match(connections, /Brain routes[\s\S]*What powers your workspace/u, "Connector control must show brain routes at the top.");

assert.match(phantomBot, /BRIDGE_PROMPT_KEY[\s\S]*Bridge setup brief is ready/u, "PhantomBot must receive the guided bridge setup brief.");
assert.match(css, /\.set-bridge-product-grid[\s\S]*\.set-connect-active-grid/u, "Bridge and active-connector layouts must have dedicated responsive styling.");

console.log("Bridge and active-first connector control checks passed.");
