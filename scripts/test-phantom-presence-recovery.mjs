import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const index = read("app/index.html");
const main = read("app/js/main.js");
const phantomAi = read("app/js/phantomai.js");
const companion = read("app/js/companion.js");
const presence = read("app/js/phantom-presence.js");
const settings = read("app/js/settings.js");
const css = read("app/command-os.css");
const baseCss = read("app/phantom.css");
const adminCss = read("app/admin-next.css");
const combinedCss = `${css}\n${baseCss}\n${adminCss}`;

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

assert.equal(existsSync(new URL("app/js/buddy.js", root)), false, "The movable shell pet controller must remain removed.");
assert.equal(existsSync(new URL("app/js/companion-preferences.js", root)), false, "Pet placement preferences must remain removed.");
assert.doesNotMatch(index, /phantompet-presence|data-phantompet-canvas|phantompet-orb/u, "Overview must not mount a hard-coded pet.");
assert.doesNotMatch(main, /mountBuddy|buddyReact|\.\/buddy\.js|data-buddy/u, "The application shell must not mount or react through the removed pet.");
assert.doesNotMatch(settings, /renderCompanionTab|data-companion-|companion-preferences|id:\s*["']companion["']/u, "Settings must not expose removed pet controls.");
assert.doesNotMatch(combinedCss, /\.buddy(?:[\s.#:\[]|$)|data-buddy|buddyVanish|buddyPop|buddyMobilePop/u, "Removed pet styles and animations must not remain in the shell.");

assert.match(phantomAi, /data-phantombot-presence-canvas/u, "PhantomBot must expose the recovered full character inside chat.");
assert.match(phantomAi, /mountPhantomPresence\(log\.querySelector/u, "PhantomBot must animate its embedded character.");
assert.match(presence, /createPhantomCharacter/u, "Presence surfaces must use the original character engine.");
assert.match(presence, /prefers-reduced-motion: reduce/u, "Character motion must respect reduced-motion preferences.");
assert.match(presence, /const GESTURE_SEQUENCES = \{/u, "PhantomBot must choreograph full-body gestures by live state.");
assert.match(presence, /idle:[\s\S]*welcome[\s\S]*present[\s\S]*point[\s\S]*laugh/u, "Idle PhantomBot must visibly welcome, present, point, and laugh.");
assert.match(presence, /canvas\.dataset\.phantomGesture/u, "The active PhantomBot gesture must remain observable for verification.");
assert.match(companion, /phantom:presence-state/u, "Existing agent states must continue to drive the embedded PhantomBot presence.");
assert.match(css, /\.phantombot-presence-canvas/u, "The embedded PhantomBot character needs stable layout styling.");
assert.match(css, /\.phantombot-presence\s*\{[\s\S]*?width:\s*clamp\(430px, 46vw, 680px\);[\s\S]*?height:\s*clamp\(380px, 52vh, 560px\);/u, "PhantomBot must render as a large presence on the shared web and desktop surface.");
assert.match(css, /\.phantombot-presence-canvas\s*\{[\s\S]*?opacity:\s*\.22;[\s\S]*?mix-blend-mode:\s*screen;/u, "PhantomBot must remain visibly translucent instead of becoming an opaque mascot.");
assert.doesNotMatch(css, /html\[data-command-os="2040"\] \.phantombot-presence\s*\{[\s\S]*?width:\s*190px;/u, "Desktop parity must never shrink PhantomBot back to the old 190px mascot size.");
assert.doesNotMatch(combinedCss, /\.phantompet-presence(?:-wrap|-canvas|-status|-tip)?/u, "Removed Overview-pet styling must not recreate a duplicate renderer.");

console.log(`Phantom presence checks passed (${expectedPoses.length} core poses verified; shell pet removed).`);
