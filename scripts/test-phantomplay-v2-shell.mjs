import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const shell = read("../app/js/phantomplay-v2.js");
const v1Catalog = read("../app/js/phantomplay.js");
const serverCatalog = read("../server/src/phantom-ai/phantomplay.ts");
const css = read("../app/phantomplay-v2.css");
const neon = read("../app/games/neon-drift.html");

assert.match(shell, /Auto-fire spaceship shooter/u, "V2 fallback catalog must describe Neon Drift as the shooter build.");
assert.match(shell, /neon-drift\.html\?v=1\.2\.2/u, "V2 fallback catalog must launch the shooter cache version.");
assert.match(shell, /gameCover/u, "V2 fallback cards need real generated cover art.");
assert.doesNotMatch(shell, /summary:\s*"Offline built-in game\."/u, "V2 must not render generic offline filler cards.");
assert.doesNotMatch(shell, /pp2-art-fallback[^]*slice\(0,\s*1\)/u, "V2 must not fall back to giant one-letter game art.");

for (const source of [v1Catalog, serverCatalog]) {
  assert.match(source, /Auto-fire spaceship shooter with waves, powerups, and shield saves/u, "All catalogs must agree on the Neon Drift shooter metadata.");
  assert.match(source, /neon-drift\.html\?v=1\.2\.2/u, "All catalogs must use the current Neon Drift shooter launch URL.");
  assert.doesNotMatch(source, /Hard-mode signal drifting/u, "Old Neon Drift lane-dodge metadata must not come back.");
}

assert.match(neon, /Auto-fire spaceship shooter/u, "Neon Drift must show shooter instructions.");
assert.match(neon, /function shoot\(/u, "Neon Drift must include projectile shooting.");
assert.match(neon, /powerups/u, "Neon Drift must include powerups.");
assert.match(neon, /maxSpeed=\.0018/u, "Neon Drift must use the faster shooter movement tuning.");
assert.doesNotMatch(neon, /dodge red mines/u, "The old lane-dodge copy must not remain.");

assert.match(css, /\.pp2-art::after/u, "V2 cards need cover-art overlay treatment.");
assert.match(css, /object-fit:cover/u, "V2 cards must present real cover art.");
assert.match(css, /\.pp2-art-fallback\{display:none\}/u, "Visible letter placeholders must be disabled.");

console.log("PhantomPlay V2 shell regression checks passed.");
