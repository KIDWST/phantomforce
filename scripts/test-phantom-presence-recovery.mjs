import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const index = read("app/index.html");
const main = read("app/js/main.js");
const phantomAi = read("app/js/phantomai.js");
const companion = read("app/js/companion.js");
const buddy = read("app/js/buddy.js");
const companionPrefs = read("app/js/companion-preferences.js");
const presence = read("app/js/phantom-presence.js");
const settings = read("app/js/settings.js");
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

assert.doesNotMatch(index, /phantompet-presence|data-phantompet-canvas|phantompet-orb/u, "Overview must not mount a second hard-coded PhantomPet.");
assert.doesNotMatch(main, /mountPhantomPresence\(\$\("\[data-phantompet-canvas\]"\)/u, "Overview must not start the removed duplicate pet renderer.");
assert.match(main, /setTimeout\(\(\) => mountBuddy\(\), 1600\)/u, "The one movable PhantomPet must remain the shell-level companion renderer.");
assert.match(phantomAi, /data-phantombot-presence-canvas/u, "PhantomBot must expose the recovered full character.");
assert.match(phantomAi, /mountPhantomPresence\(log\.querySelector/u, "PhantomBot must animate the recovered character.");
assert.match(presence, /createPhantomCharacter/u, "Presence surfaces must use the original character engine.");
assert.match(presence, /prefers-reduced-motion: reduce/u, "Character motion must respect reduced-motion preferences.");
assert.match(presence, /const GESTURE_SEQUENCES = \{/u, "PhantomBot must choreograph full-body gestures by live state.");
assert.match(presence, /idle:[\s\S]*welcome[\s\S]*present[\s\S]*point[\s\S]*laugh/u, "Idle PhantomBot must visibly welcome, present, point, and laugh.");
assert.match(presence, /canvas\.dataset\.phantomGesture/u, "The active PhantomBot gesture must remain observable for desktop and browser verification.");
assert.match(companion, /phantom:presence-state/u, "Existing agent states must drive every Phantom presence.");
assert.match(css, /\.phantombot-presence-canvas/u, "Recovered PhantomBot character needs stable layout styling.");
assert.match(css, /\.phantombot-presence\s*\{[\s\S]*?width:\s*clamp\(430px, 46vw, 680px\);[\s\S]*?height:\s*clamp\(380px, 52vh, 560px\);/u, "PhantomBot must render as a large presence on the shared web and desktop surface.");
assert.match(css, /\.phantombot-presence-canvas\s*\{[\s\S]*?opacity:\s*\.22;[\s\S]*?mix-blend-mode:\s*screen;/u, "PhantomBot must remain visibly translucent instead of becoming an opaque mascot.");
assert.doesNotMatch(css, /html\[data-command-os="2040"\] \.phantombot-presence\s*\{[\s\S]*?width:\s*190px;/u, "Desktop parity must never shrink PhantomBot back to the old 190px mascot.");
assert.doesNotMatch(`${css}\n${baseCss}`, /\.phantompet-presence(?:-wrap|-canvas|-status|-tip)?/u, "Removed Overview-pet styling must not recreate the duplicate renderer.");
assert.match(companionPrefs, /roamingEnabled:\s*true/u, "Companion defaults must keep free movement enabled.");
assert.match(companionPrefs, /autoWander:\s*false/u, "Companion must stay where the user places it unless wandering is explicitly enabled.");
assert.match(companionPrefs, /rememberPagePositions:\s*true/u, "Companion defaults must remember positions by page.");
assert.match(companionPrefs, /saveCompanionPagePlacement/u, "Companion position memory must be persisted.");
assert.match(buddy, /function roamingAllowed\(\) \{ return prefs\.roamingEnabled && !mobile\(\); \}/u, "Companion controller must honor free movement preferences independently from idle motion.");
assert.doesNotMatch(buddy, /data-buddy-resize|resizeHandle/u, "Companion must not expose the regressed drag-to-resize dot.");
assert.doesNotMatch(baseCss, /\.buddy-resize|\.buddy\.is-resizing/u, "Companion styling must not paint a resize dot or grip state.");
assert.match(buddy, /scroll to resize[\s\S]*canvas\.addEventListener\("wheel",[\s\S]*manualSizePx = clampNumber[\s\S]*saveCurrentPagePlacement\(\)[\s\S]*\{ passive: false, signal \}/u, "Scrolling over PhantomPet must resize it in place and persist the page-specific size.");
assert.match(buddy, /data-buddy-action="roam"/u, "Right-click menu must include free movement.");
assert.match(buddy, /data-buddy-action="wander"/u, "Right-click menu must expose optional wandering.");
assert.match(buddy, /function autoWanderAllowed\(\)/u, "Free placement and autonomous wandering must be independent behaviors.");
assert.match(buddy, /data-buddy-action="reset-page"/u, "Right-click menu must include per-page position reset.");
assert.match(buddy, /switchPageContext/u, "Companion must track route changes for page-specific placement.");
assert.match(buddy, /saveCurrentPagePlacement/u, "Companion drag and wheel resize must save the page placement.");
assert.match(buddy, /Math\.hypot\(event\.clientX - dragPointerStartX, event\.clientY - dragPointerStartY\)/u, "Drag detection must use total gesture distance rather than tiny pointer-event steps.");
assert.match(buddy, /layer\.classList\.remove\("is-grabbed"\);[\s\S]*?vx = 0;[\s\S]*?vy = 0;[\s\S]*?if \(dragged\)/u, "Every drag release must stop retained pointer velocity.");
assert.match(buddy, /canvas\.addEventListener\("lostpointercapture", release[\s\S]*?window\.addEventListener\("pointerup", release, \{ capture: true, signal \}\)/u, "Drag release must survive pointer capture loss and pointerup outside the companion canvas.");
assert.match(buddy, /canvas\.addEventListener\("wheel",[\s\S]*?saveCurrentPagePlacement\(\);[\s\S]*?if \(enableFreePlacement\) prefs = updateCompanionPrefs/u, "Wheel sizing must save the custom size before preference refresh restores the current page placement.");
assert.match(buddy, /undock\(\{ keepPosition: !!x && !!y, silent: true \}\)/u, "Preference refresh must preserve a live free placement when browser storage is unavailable.");
assert.match(buddy, /!autoWanderAllowed\(\)[\s\S]*?vx = 0;[\s\S]*?vy = 0;[\s\S]*?tx = x;[\s\S]*?ty = y;/u, "Non-wandering placement must be a hard stationary state.");
assert.doesNotMatch(buddy, /function undock\(\)\s*\{\s*dock\(\);\s*\}/u, "Undock must not be a sidebar alias.");
assert.doesNotMatch(buddy, /I'll stay in the sidebar/u, "Drag release must not force the companion back to the sidebar.");
assert.doesNotMatch(baseCss, /body:has\(\.phantom \.app-main > \.console:not\(\.console-workspace\)\) \.buddy/u, "Overview must not hide the movable companion.");
assert.match(settings, /data-companion-toggle="roamingEnabled"/u, "Settings must expose free movement.");
assert.match(settings, /data-companion-toggle="autoWander"/u, "Settings must expose autonomous wandering separately.");
assert.match(settings, /data-companion-toggle="rememberPagePositions"/u, "Settings must expose per-page placement memory.");
assert.match(settings, /data-companion-reset-placements/u, "Settings must expose placement reset.");

console.log(`Recovered Phantom presence checks passed (${expectedPoses.length} core poses verified).`);
