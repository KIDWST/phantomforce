import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const main = read("../app/js/main.js");
const bot = read("../app/js/phantomai.js");
const settings = read("../app/js/settings.js");
const css = read("../app/phantombot-next.css");
const desktop = read("../packages/phantombot-desktop/src/main.cjs");

for (const selector of [
  "data-phantombot-constellation",
  "data-phantombot-constellation-progress",
  "data-phantombot-constellation-objective",
  "data-phantombot-constellation-nodes",
  "data-phantombot-open-mission",
  "data-phantombot-mission-next",
  "data-phantombot-copy-continuity",
  "data-phantombot-brain-mesh",
  "data-phantombot-branch-active",
]) {
  assert.match(main, new RegExp(selector), `The shared PhantomBot surface must include ${selector}.`);
}

assert.match(bot, /function missionConstellation[\s\S]*Intent[\s\S]*Context[\s\S]*Work[\s\S]*Proof[\s\S]*Next orbit/u, "The mission constellation must derive the complete flight path from session truth.");
assert.match(bot, /hasVerifiedReceipt[\s\S]*operator\?\.receiptId[\s\S]*operator\?\.receiptVerified !== false/u, "Verification must advance only from a real operator receipt.");
assert.match(bot, /hasProof = hasVerifiedReceipt \|\| artifacts\.length > 0/u, "Proof must come from receipts or attached outputs, never decorative progress.");
assert.match(bot, /Only real replies, outputs, approvals, and receipts advance the map/u, "The mission map must explain its evidence boundary.");
assert.match(bot, /function buildContinuityPacket[\s\S]*Recent working context[\s\S]*Safest next move[\s\S]*do not invent completion/u, "Continuity packets must preserve objective, recent context, proof, and safe continuation rules.");
assert.match(bot, /function copyContinuityPacket[\s\S]*navigator\.clipboard\?\.writeText[\s\S]*document\.execCommand\("copy"\)/u, "Continuity copy must work in modern browsers and the desktop fallback.");
assert.match(bot, /function branchActiveTask[\s\S]*branchTaskAt\(task\.messages\.length - 1\)/u, "A user must be able to create a parallel mission path from the latest checkpoint.");
assert.match(bot, /data-phantombot-mission-next[\s\S]*chatBindings\.input\.value/u, "The safest next move must fill the composer without silently executing.");
assert.doesNotMatch(bot, /data-phantombot-mission-next[^\n]{0,260}(?:requestSubmit|submitPrompt)/u, "Mission continuation must remain user-controlled.");

assert.match(settings, /export function getOperatorBrainMesh/u, "Settings must expose the canonical brain and bridge mesh.");
assert.match(settings, /export async function hydrateOperatorBrainMesh[\s\S]*refreshAgentAssistBridge[\s\S]*refreshHiggsfieldBridge/u, "The mesh must hydrate from the real ChatGPT and Higgsfield status routes.");
assert.match(settings, /nodes\.filter\(\(node\) => node\.state === "connected"\)/u, "Active mesh counts must come from confirmed connected nodes.");
assert.match(bot, /hydrateOperatorBrainMesh\(\)[\s\S]*paintSessionHud\(\)[\s\S]*paintDetailDrawer\(\)/u, "PhantomBot must repaint when real mesh health arrives.");
assert.match(bot, /data-phantombot-manage-mesh[\s\S]*pf\.settings\.tab\.v1", "bridge"/u, "The mission layer must route mesh configuration to the dedicated Bridges section.");

for (const selector of [
  ".phantombot-constellation",
  ".phantombot-mission-dossier",
  ".phantombot-brain-mesh",
]) {
  assert.match(css, new RegExp(selector.replaceAll(".", "\\.")), `${selector} must have dedicated shared styling.`);
}
assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.phantombot-constellation/u, "The mission layer must adapt on phones and narrow desktop windows.");
assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*phantombot-constellation/u, "Constellation motion must honor reduced-motion preferences.");
assert.equal((css.match(/\{/gu) || []).length, (css.match(/\}/gu) || []).length, "Mission CSS blocks must remain balanced.");

assert.match(desktop, /https:\/\/admin\.phantomforce\.online\/app\/index\.html/u, "The desktop shell must load the same hosted app surface as web.");
assert.match(desktop, /await mainWindow\.loadURL\(target\.url\)/u, "Desktop must continue loading the shared PhantomBot bundle rather than a divergent UI.");

console.log("PhantomBot interstellar mission checks passed: evidence-grounded constellation, portable continuity, parallel paths, live brain mesh, and desktop/web parity.");
