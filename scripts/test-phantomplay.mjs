import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const main = read("../app/js/main.js");
const module = read("../app/js/phantomplay.js");
const index = read("../app/index.html");
const css = read("../app/phantomplay.css");
const staticServer = read("../ops/admin-live/admin-static-server.mjs");
const games = ["neon-drift", "signal-match", "focus-stack"].map((name) => read(`../app/games/${name}.html`));
const appFiles = [index, main, module, ...games];

assert.match(main, /id:\s*"phantomplay"[\s\S]*label:\s*"PhantomPlay"/u, "PhantomPlay must be in the native navigation.");
assert.match(main, /renderPhantomPlay/u, "The workspace must use the PhantomPlay renderer.");
assert.match(read("../app/js/customization.js"), /canAccessConfiguredModule[\s\S]*module\.id !== "phantomplay"[\s\S]*selected_members/u, "PhantomPlay nav access must be controlled by the workspace module configuration.");
assert.match(main, /sessionId:\s*kind === "admin" \? "admin-jordan" : "client-sports-demo"/u, "Local UI tests must obtain a real protected demo session when the local backend is available.");
assert.match(index, /phantomplay\.css\?v=phantom-live-/u, "The dedicated PhantomPlay stylesheet must be loaded.");
assert.match(module, /sandbox="allow-scripts"/u, "Games must launch in a script-only sandbox.");
assert.doesNotMatch(module, /allow-same-origin|allow-forms|allow-popups/u, "The player must not grant origin, form, or popup powers.");
assert.match(module, /event\.source !== frame\.contentWindow/u, "Game messages must be bound to the active frame.");
assert.match(module, /data\.source !== "phantomplay-game"/u, "Game messages must use the PhantomPlay protocol marker.");
assert.match(module, /Offline mode/u, "An honest offline state must exist.");
assert.match(module, /not enabled for this workspace|optional workspace module/u, "Direct PhantomPlay URLs need a clear unavailable state.");
assert.match(module, /No matching games/u, "A real search empty state must exist.");
assert.match(module, /Edit release/u, "Developers must be able to revise releases.");
assert.match(module, /Request changes/u, "Admin moderation controls must exist.");
assert.match(module, /data-pp-favorite/u, "Favorites must be interactive.");
assert.match(module, /data-pp-player-pause/u, "The player must expose pause and resume controls.");
assert.match(module, /data-pp-player-restart/u, "The player must expose a restart control.");
assert.match(module, /frame\.focus/u, "The active game frame must receive keyboard focus.");
assert.match(css, /@media\s*\(max-width:\s*767px\)/u, "Phone-specific responsive layout must exist.");
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
assert.doesNotMatch(games[2], /function size\(\)\{[^}]*reset\(\)/u, "Focus Stack must not erase a run when the mobile viewport resizes.");

console.log("PhantomPlay frontend and game safety checks passed.");
