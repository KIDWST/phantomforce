import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const index = read("app/index.html");
const main = read("app/js/main.js");
const phantomAi = read("app/js/phantomai.js");
const companion = read("app/js/companion.js");
const presence = read("app/js/phantom-presence.js");
const css = read("app/command-os.css");

const expectedPoses = [
  "assert.webp", "chin.webp", "conjure.webp", "coy.webp", "cross.webp",
  "laugh.webp", "mode-admin.webp", "mode-ask.webp", "mode-dark-admin.webp",
  "mode-dark-ask.webp", "mode-dark-image.webp", "mode-dark-video.webp",
  "mode-dark-website.webp", "mode-dark-write.webp", "mode-image.webp",
  "mode-video.webp", "mode-website.webp", "mode-write.webp", "point.webp",
  "present.webp", "scheme.webp", "sheepish.webp", "welcome.webp",
];

for (const name of expectedPoses) {
  const url = new URL(`app/assets/poses/${name}`, root);
  assert.equal(existsSync(url), true, `Recovered pose is missing: ${name}`);
  assert.ok(statSync(url).size > 20_000, `Recovered pose is unexpectedly empty: ${name}`);
}

assert.match(index, /data-phantompet-canvas/u, "Overview must mount the animated PhantomPet.");
assert.doesNotMatch(index, /phantompet-orb-img/u, "Overview must not regress to the static brand image.");
assert.match(main, /mountPhantomPresence\(\$\("\[data-phantompet-canvas\]"\)/u, "Overview must start the live character engine.");
assert.match(phantomAi, /data-phantombot-presence-canvas/u, "PhantomBot must expose the recovered full character.");
assert.match(phantomAi, /mountPhantomPresence\(log\.querySelector/u, "PhantomBot must animate the recovered character.");
assert.match(presence, /createPhantomCharacter/u, "Presence surfaces must use the original character engine.");
assert.match(presence, /prefers-reduced-motion: reduce/u, "Character motion must respect reduced-motion preferences.");
assert.match(companion, /phantom:presence-state/u, "Existing agent states must drive every Phantom presence.");
assert.match(css, /\.phantombot-presence-canvas/u, "Recovered PhantomBot character needs stable layout styling.");
assert.match(css, /\.phantompet-orb-canvas/u, "Recovered Overview pet needs stable layout styling.");

console.log(`Recovered Phantom presence checks passed (${expectedPoses.length} core poses verified).`);
