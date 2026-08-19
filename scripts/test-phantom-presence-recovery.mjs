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
const baseCss = read("app/phantom.css");

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
assert.match(index, /phantompet-presence-canvas/u, "Overview must render PhantomPet as the full painted presence.");
assert.doesNotMatch(index, /phantompet-orb/u, "Overview must not regress PhantomPet to a circular orb.");
assert.match(main, /mountPhantomPresence\(\$\("\[data-phantompet-canvas\]"\)/u, "Overview must start the live character engine.");
assert.match(main, /mountPhantomPresence\([^\n]*compact: false, small: false/u, "Overview must render the full-quality full-body PhantomPet.");
assert.match(phantomAi, /data-phantombot-presence-canvas/u, "PhantomBot must expose the recovered full character.");
assert.match(phantomAi, /mountPhantomPresence\(log\.querySelector/u, "PhantomBot must animate the recovered character.");
assert.match(presence, /createPhantomCharacter/u, "Presence surfaces must use the original character engine.");
assert.match(presence, /prefers-reduced-motion: reduce/u, "Character motion must respect reduced-motion preferences.");
assert.match(companion, /phantom:presence-state/u, "Existing agent states must drive every Phantom presence.");
assert.match(css, /\.phantombot-presence-canvas/u, "Recovered PhantomBot character needs stable layout styling.");
assert.match(css, /\.phantompet-presence-canvas/u, "Recovered Overview pet needs stable full-body layout styling.");
const petButtonCss = baseCss.match(/\.phantompet-presence\s*\{[\s\S]*?\n\}/u)?.[0] || "";
assert.match(petButtonCss, /border:\s*0;[\s\S]*background:\s*transparent;[\s\S]*overflow:\s*visible/u, "PhantomPet must remain a transparent, unclipped character presence.");
assert.doesNotMatch(petButtonCss, /border-radius:\s*50%/u, "PhantomPet must never return to a circular avatar treatment.");

console.log(`Recovered Phantom presence checks passed (${expectedPoses.length} core poses verified).`);
