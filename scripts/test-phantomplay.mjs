import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const main = read("../app/js/main.js");
const module = read("../app/js/phantomplay.js");
const index = read("../app/index.html");
const css = read("../app/phantomplay.css");
const staticServer = read("../ops/admin-live/admin-static-server.mjs");
const gameSlugs = ["neon-drift", "signal-match", "focus-stack", "word-weld", "reflex-grid", "penalty-kick"];
const games = gameSlugs.map((name) => read(`../app/games/${name}.html`));
const neonDrift = games[gameSlugs.indexOf("neon-drift")];
const penaltyKick = games[gameSlugs.indexOf("penalty-kick")];
const appFiles = [index, main, module, ...games];

assert.match(main, /id:\s*"phantomplay"[\s\S]*label:\s*"PhantomPlay"/u, "PhantomPlay must be in the native navigation.");
assert.match(main, /renderPhantomPlay/u, "The workspace must use the PhantomPlay renderer.");
assert.match(main, /sessionId:\s*kind === "admin" \? "admin-jordan" : "client-sports-demo"/u, "Local UI tests must obtain a real protected demo session when the local backend is available.");
assert.match(index, /phantomplay\.css\?v=phantom-live-/u, "The dedicated PhantomPlay stylesheet must be loaded.");
assert.match(module, /sandbox="allow-scripts"/u, "Games must launch in a script-only sandbox.");
assert.doesNotMatch(module, /allow-same-origin|allow-forms|allow-popups/u, "The player must not grant origin, form, or popup powers.");
assert.match(module, /event\.source !== frame\.contentWindow/u, "Game messages must be bound to the active frame.");
assert.match(module, /data\.source !== "phantomplay-game"/u, "Game messages must use the PhantomPlay protocol marker.");
assert.match(module, /Offline mode/u, "An honest offline state must exist.");
assert.match(module, /No matching builds/u, "A real search empty state must exist.");
assert.match(module, /not a marketplace/u, "PhantomPlay must be positioned as a sandbox, not a marketplace.");
assert.match(module, /Playtest Rooms/u, "PhantomPlay must expose the private playtest surface.");
assert.match(module, /No public discovery/u, "Private rooms must avoid public discovery.");
assert.match(module, /same workspace/u, "Private rooms must be scoped to the signed-in workspace.");
assert.match(module, /No direct inbound device ports/u, "Wireless play must not require exposing player devices.");
assert.match(module, /Classroom mode only allows Everyone-rated games/u, "School rooms must have an Everyone-rated content boundary.");
assert.match(module, /\/api\/phantomplay\/rooms/u, "The play-together UI must use the authenticated PhantomPlay room API.");
assert.match(module, /Edit build/u, "Builders must be able to revise builds.");
assert.match(module, /function developerDirectory/u, "The Dev Rooms tab must be backed by a developer directory derived from catalog data.");
assert.match(module, /Dev score/u, "Developer profiles must expose a visible Dev score.");
assert.match(module, /data-pp-open-dev/u, "Developer cards must open profile views.");
assert.match(module, /data-pp-support-dev/u, "Developer profiles must allow local support marks.");
assert.match(module, /data-pp-donate-dev/u, "Developer profiles must allow local collaboration intent without starting payments.");
assert.match(module, /data-pp-save-dev-note/u, "Developer profiles must support private dev notes.");
const renderDeveloperSource = module.match(/function renderDeveloper\(\) \{([\s\S]*?)\nfunction renderAdmin/u)?.[1] || "";
assert.ok(renderDeveloperSource, "renderDeveloper must exist.");
assert.doesNotMatch(renderDeveloperSource, /data-pp-submit-form|New submission|DEVELOPER DISTRIBUTION|marketplace|storefront/u, "The Dev Rooms tab must render the sandbox directory/profile flow, not the old submission form or marketplace copy.");
assert.match(module, /Request changes/u, "Admin moderation controls must exist.");
assert.match(module, /data-pp-favorite/u, "Favorites must be interactive.");
assert.match(module, /data-pp-player-pause/u, "The player must expose pause and resume controls.");
assert.match(module, /data-pp-player-restart/u, "The player must expose a restart control.");
assert.match(module, /frame\.focus/u, "The active game frame must receive keyboard focus.");
for (const slug of gameSlugs) {
  assert.match(module, new RegExp(`id:\\s*"${slug}"`, "u"), `${slug} must be registered in the frontend built-in catalog.`);
  assert.match(module, new RegExp(`/app/games/${slug}\\.html`, "u"), `${slug} must have a playable launch URL.`);
}
assert.match(css, /@media\s*\(max-width:\s*767px\)/u, "Phone-specific responsive layout must exist.");
assert.match(css, /\.pp-dev-list/u, "Developer directory cards must be styled.");
assert.match(css, /\.pp-dev-profile/u, "Developer profile views must be styled.");
assert.match(css, /\.pp-dev-notes/u, "Developer notes must be styled.");
assert.match(css, /workspace-page:has\(\.pp-player\)[^{]*\.workspace-page-body\{[^}]*transform:none!important/u, "The game player must escape the animated page containing block.");
assert.match(staticServer, /urlPath\.startsWith\("\/api\/phantomplay"\)/u, "The live admin server must proxy PhantomPlay API routes.");

const buildIds = new Set(appFiles.flatMap((source) => source.match(/phantom-live-\d{8}-\d+/gu) || []));
assert.equal(buildIds.size, 1, `The PhantomPlay module graph must use one build ID, found: ${[...buildIds].join(", ")}`);

for (const game of games) {
  assert.match(game, /Content-Security-Policy/u, "Every built-in game must set a CSP.");
  assert.match(game, /connect-src 'none'/u, "Built-in games must block network access.");
  assert.match(game, /source:'phantomplay-game'/u, "Built-in games must use the host protocol.");
  assert.doesNotMatch(game, /https?:\/\//u, "Built-in games must not call external services.");
  assert.doesNotMatch(game, /font-size:clamp\([^;]*vw/u, "Game type must not scale directly with viewport width.");
  assert.match(game, /event\.data\.type==='pause'/u, "Every built-in game must respond to host pause controls.");
  assert.match(game, /event\.data\.type==='restart'/u, "Every built-in game must respond to host restart controls.");
  const inlineScript = game.match(/<script>([\s\S]*?)<\/script>/u)?.[1] || "";
  assert.doesNotThrow(() => new Function(inlineScript), "Every built-in game script must parse.");
}

assert.match(games[0], /\.start\[hidden\][^{]*\{display:none\}/u, "Neon Drift's start overlay must actually leave the play field.");
assert.match(neonDrift, /invuln/u, "Neon Drift must give the ship a short grace window after damage.");
assert.match(neonDrift, /maxSpeed=\.00105/u, "Neon Drift ship speed must stay tuned for arcade responsiveness.");
assert.match(neonDrift, /e\.y>1\.12\)\{e\.dead=true\}/u, "Escaped enemies should leave the field without damaging the player.");
assert.doesNotMatch(neonDrift, /e\.y>1\.08\)\{e\.dead=true;damage\(\)\}/u, "Escaped enemies must not cause invisible hull damage.");
assert.doesNotMatch(games[2], /function size\(\)\{[^}]*reset\(\)/u, "Focus Stack must not erase a run when the mobile viewport resizes.");
assert.match(penaltyKick, /\.field\{[^}]*height:100%;[^}]*min-height:280px/u, "Penalty Kick must reserve a real playable field instead of collapsing around absolute children.");
assert.match(penaltyKick, /function meterPower\(\)\{[^}]*getBoundingClientRect/u, "Penalty Kick must calculate shot timing from live meter geometry.");
assert.doesNotMatch(penaltyKick, /getComputedStyle\(meter\)\.transform\.split/u, "Penalty Kick must not use raw CSS transform pixels for shot timing.");
assert.match(penaltyKick, /else start\(\)/u, "Penalty Kick must let keyboard users start from the opening overlay.");

console.log("PhantomPlay frontend and game safety checks passed.");
