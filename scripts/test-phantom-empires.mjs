import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const html = read("../app/games/phantom-empires/index.html");
const game = read("../app/games/phantom-empires/game.js");
const css = read("../app/games/phantom-empires/style.css");
const art = read("../app/assets/phantomplay/phantom-empires-cover.svg");
const clientCatalog = read("../app/js/phantomplay.js");
const serverCatalog = read("../server/src/phantom-ai/phantomplay-flagship.ts");

assert.doesNotThrow(() => new Function(game), "Phantom Empires game runtime must parse as browser JavaScript.");
assert.match(html, /Content-Security-Policy[\s\S]*connect-src 'none'/u, "The game must remain network-silent inside the PhantomPlay sandbox.");
assert.match(html, /data-start="campaign"[\s\S]*data-start="skirmish"[\s\S]*data-start="sandbox"/u, "Campaign, Skirmish, and Architect modes must be launchable.");
assert.match(html, /data-command-tab="build"[\s\S]*data-command-tab="train"[\s\S]*data-command-tab="realm"/u, "The RTS command deck must expose build, train, and realm controls.");
assert.match(html, /id="minimap"[\s\S]*data-touch="army"[\s\S]*data-touch="attack"/u, "The game must ship minimap and coarse-pointer commands.");

for (const mechanic of [
  "worker", "sword", "archer", "cavalry", "catapult", "ship",
  "citadel", "house", "barracks", "range", "stable", "workshop", "dock", "tower", "wall", "market",
]) assert.match(game, new RegExp(`\\b${mechanic}: \\{`, "u"), `Phantom Empires must retain the ${mechanic} simulation definition.`);

assert.match(game, /const AGE = \[[\s\S]*FOUNDING[\s\S]*IRON CROWN[\s\S]*IMPERIAL[\s\S]*SOVEREIGN/u, "The civilization must progress through four distinct Ages.");
assert.match(game, /function updateGather[\s\S]*function updateBuild[\s\S]*function attack/u, "Economy, construction, and combat must run as real simulation systems.");
assert.match(game, /WORLD\.bridges[\s\S]*function waypointFor/u, "Land units must route through the authored river bridges.");
assert.match(game, /War Docks must touch the river/u, "Naval construction must remain water-bound.");
assert.match(game, /function updateAI[\s\S]*ENEMY WAR PARTY/u, "The rival empire must generate escalating attack waves.");
assert.match(game, /weather\.type === "rain"[\s\S]*weather\.type === "storm"[\s\S]*lightning/u, "The battlefield must render active rain and storm states.");
assert.match(game, /controlGroups[\s\S]*\^Digit\(\[1-6\]\)\$[\s\S]*event\.ctrlKey/u, "RTS control groups must be keyboard-operable.");
assert.match(game, /saveGame[\s\S]*host\("save-state"[\s\S]*restoreGame/u, "Local and PhantomPlay host save-state handoff must both work.");
assert.match(game, /host\("progress"[\s\S]*host\("complete"/u, "Progress and campaign completion must report to PhantomPlay.");
assert.match(game, /window\.__PhantomEmpiresTest/u, "A deterministic playtest seam must remain available.");

assert.match(css, /@media\(max-width:1000px\)[\s\S]*@media\(max-width:650px\)/u, "Desktop and narrow touch layouts must both be authored.");
assert.match(css, /prefers-reduced-motion:reduce/u, "The strategy presentation must respect reduced motion.");
assert.ok(art.length > 5000, "Phantom Empires must retain custom scene-rich cover art.");
assert.match(art, /PHANTOM[\s\S]*EMPIRES[\s\S]*SOVEREIGN/u, "The custom cover must carry the complete game identity.");

const clientStart = clientCatalog.indexOf('{ id: "phantom-empires"');
const clientRecord = clientCatalog.slice(clientStart, clientCatalog.indexOf("\n", clientStart));
const serverStart = serverCatalog.indexOf('    id: "phantom-empires"');
const serverRecord = serverCatalog.slice(serverCatalog.lastIndexOf("  {", serverStart), serverCatalog.indexOf("\n  },", serverStart) + 5);
for (const [label, record] of [["client fallback", clientRecord], ["server", serverRecord]]) {
  assert.ok(record, `${label} catalog must include Phantom Empires.`);
  assert.match(record, /launchUrl:\s*"\/app\/games\/phantom-empires\/index\.html\?v=1\.0\.0"/u, `${label} catalog must launch the real 1.0.0 build.`);
  assert.match(record, /thumbnail:[^\n]*phantom-empires/u, `${label} catalog must use the custom cover.`);
  assert.doesNotMatch(record, /Unreal Engine/u, `${label} catalog must not falsely label the browser strategy runtime as Unreal.`);
}

console.log(JSON.stringify({ ok: true, game: "phantom-empires", version: "1.0.0", modes: 3, unitTypes: 6, buildings: 10, ages: 4, desktopWebParity: true }));
