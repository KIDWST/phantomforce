import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (file) => readFileSync(resolve(here, file), "utf8");

const character = read("../app/js/character.js");
const companion = read("../app/js/companion.js");
const buddy = read("../app/js/buddy.js");
const css = read("../app/phantom.css");

assert.match(
  character,
  /createPhantomCharacter\(\{\s*small\s*=\s*false,\s*preload\s*=\s*\[\],\s*settled\s*=\s*false\s*\}/u,
  "The shared Phantom renderer must expose an explicit pre-settled mode.",
);
assert.match(
  character,
  /let born = settled \? -2\.4 : null/u,
  "Pre-settled Phantom instances must start past the materialize reveal.",
);
assert.match(
  character,
  /if \(born == null\) born = t/u,
  "Normal Phantom instances should still establish their birth time on first draw.",
);
assert.match(
  companion,
  /createPhantomCharacter\(\{\s*small:\s*true,\s*settled:\s*true\s*\}\)/u,
  "The chatbox Phantom should not replay the full startup reveal when remounted.",
);
assert.match(
  companion,
  /setCompanionState\(mode === "loop" \? "building" : "idle"\)/u,
  "The chatbox Phantom should initialize an explicit visible state on mount.",
);
assert.match(
  companion,
  /function clearAvatarPop\(\)[\s\S]*classList\.remove\("pc-pop"\)/u,
  "The one-shot avatar pop class should have a shared cleanup function.",
);
assert.match(
  companion,
  /animationend[\s\S]*pcPop[\s\S]*clearAvatarPop\(\)/u,
  "The one-shot avatar pop class should be removed after it finishes.",
);
assert.match(
  companion,
  /function triggerAvatarPop\(\)[\s\S]*setTimeout\(clearAvatarPop,\s*520\)/u,
  "The avatar pop class needs a timeout cleanup fallback when animationend is missed.",
);
assert.match(
  companion,
  /el\.canvas\.addEventListener\("click"[\s\S]*event\.stopPropagation\(\)[\s\S]*pulse = Math\.max\(pulse,\s*0\.18\)/u,
  "Clicking the chatbox Phantom should be a smooth pulse only, not a state or intro reset.",
);
assert.doesNotMatch(
  companion,
  /createPhantomCharacter\(\{\s*small:\s*true\s*\}\)/u,
  "The chat companion must not use a fresh small character that replays materialization.",
);
assert.match(css, /\.pc-avatar\.pc-pop/u, "The compact avatar pop animation should remain available for real state changes.");

assert.match(
  buddy,
  /SCROLL_AWAY_QUIPS[\s\S]*Wait, where are you going\?[\s\S]*Wait for me\.[\s\S]*I thought we were friends\.[\s\S]*Don't forget me!/u,
  "The sidebar Phantom pet should have playful scroll-away copy.",
);
assert.match(
  buddy,
  /standard:\s*mobile\(\) \? 78 : 112/u,
  "The desktop sidebar Phantom pet should be larger by default.",
);
assert.match(
  buddy,
  /querySelector\("\.side-nav-utility"\)[\s\S]*const navRoot = mainNav \|\| sidebar\?\.querySelector\("\.side-nav"\);[\s\S]*utilityTop[\s\S]*bottom = Math\.max\(sideTop \+ 150, utilityTop - 12\)/u,
  "The bigger sidebar Phantom pet must stay above utility navigation and fall back safely to the legacy side-nav root.",
);
assert.match(
  buddy,
  /function vanishForScroll\(\)[\s\S]*say\(scrollAwayText\(\), 1450\)[\s\S]*scrollHidden = true/u,
  "Downward scrolling should trigger a short quip and then hide the sidebar Phantom pet.",
);
assert.match(
  buddy,
  /say\(scrollAwayText\(\), 1450\)[\s\S]*\}, 1500\);/u,
  "The scroll-away quip should remain visible long enough to finish before the pet hides.",
);
assert.match(
  buddy,
  /now - lastScrollAwayAt < 14000[\s\S]*scrollVanishing = true;[\s\S]*scrollHidden = false;[\s\S]*setTimeout\(\(\) =>[\s\S]*scrollHidden = true[\s\S]*\}, 920\)/u,
  "Repeated scroll-away hides should finish the fade instead of snapping invisible.",
);
assert.match(
  buddy,
  /LAST_SCROLL_QUIP_KEY[\s\S]*function scrollAwayText\(\)[\s\S]*localStorage\.getItem\(LAST_SCROLL_QUIP_KEY\)[\s\S]*localStorage\.setItem\(LAST_SCROLL_QUIP_KEY, next\)/u,
  "Scroll-away quips should rotate independently from normal companion quips.",
);
assert.match(
  buddy,
  /function revealFromScroll\(\)[\s\S]*classList\.remove\("is-scroll-hidden", "is-scroll-vanishing"\)/u,
  "Scrolling back should reveal the sidebar Phantom pet cleanly.",
);
assert.match(
  css,
  /\.buddy\.is-scroll-vanishing\s*\{[\s\S]*pointer-events: none;[\s\S]*buddyVanish[\s\S]*\.buddy\.is-scroll-hidden/u,
  "The sidebar Phantom pet should use a non-blocking vanish/fade class instead of staying sticky while scrolling.",
);

console.log("chat companion smoothness checks passed");
