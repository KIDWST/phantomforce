import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const main = read("../app/js/main.js");
const module = read("../app/js/phantomplay.js");
const index = read("../app/index.html");
const css = read("../app/phantomplay.css");
const staticServer = read("../ops/admin-live/admin-static-server.mjs");
const games = ["neon-drift", "signal-match", "focus-stack"].map((name) => read(`../app/games/${name}.html`));

assert.match(main, /id:\s*"phantomplay"[\s\S]*label:\s*"PhantomPlay"/u, "PhantomPlay must be in the native navigation.");
assert.match(main, /renderPhantomPlay/u, "The workspace must use the PhantomPlay renderer.");
assert.match(main, /sessionId:\s*kind === "admin" \? "admin-jordan" : "client-sports-demo"/u, "Local UI tests must obtain a real protected demo session when the local backend is available.");
assert.match(index, /phantomplay\.css\?v=phantom-live-/u, "The dedicated PhantomPlay stylesheet must be loaded.");
assert.match(module, /sandbox="allow-scripts"/u, "Games must launch in a script-only sandbox.");
assert.doesNotMatch(module, /allow-same-origin|allow-forms|allow-popups/u, "The player must not grant origin, form, or popup powers.");
assert.match(module, /event\.source !== frame\.contentWindow/u, "Game messages must be bound to the active frame.");
assert.match(module, /data\.source !== "phantomplay-game"/u, "Game messages must use the PhantomPlay protocol marker.");
assert.match(module, /Offline mode/u, "An honest offline state must exist.");
assert.match(module, /No matching games/u, "A real search empty state must exist.");
assert.match(module, /Edit release/u, "Developers must be able to revise releases.");
assert.match(module, /Request changes/u, "Admin moderation controls must exist.");
assert.match(module, /data-pp-favorite/u, "Favorites must be interactive.");
assert.match(css, /@media\s*\(max-width:\s*767px\)/u, "Phone-specific responsive layout must exist.");
assert.match(staticServer, /urlPath\.startsWith\("\/api\/phantomplay"\)/u, "The live admin server must proxy PhantomPlay API routes.");

for (const game of games) {
  assert.match(game, /Content-Security-Policy/u, "Every built-in game must set a CSP.");
  assert.match(game, /connect-src 'none'/u, "Built-in games must block network access.");
  assert.match(game, /source:'phantomplay-game'/u, "Built-in games must use the host protocol.");
  assert.doesNotMatch(game, /https?:\/\//u, "Built-in games must not call external services.");
  assert.doesNotMatch(game, /font-size:clamp\([^;]*vw/u, "Game type must not scale directly with viewport width.");
}

console.log("PhantomPlay frontend and game safety checks passed.");
