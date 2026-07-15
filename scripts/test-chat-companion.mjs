import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (file) => readFileSync(resolve(here, file), "utf8");

const character = read("../app/js/character.js");
const companion = read("../app/js/companion.js");
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

console.log("chat companion smoothness checks passed");
