import { readFileSync } from "node:fs";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

function readProjectFile(relativePath: string) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const companion = readProjectFile("apps/web/public/app/js/companion.js");
const mainJs = readProjectFile("apps/web/public/app/js/main.js");
const css = readProjectFile("apps/web/public/app/phantom.css");
const indexHtml = readProjectFile("apps/web/public/app/index.html");

const buildId = "phantom-live-20260713-qa-sweep-01";

assert(indexHtml.includes(`window.PHANTOM_BUILD = "${buildId}"`), "Index should expose the new build id.");
assert(indexHtml.includes(`/app/js/main.js?v=${buildId}`), "Index should load the bumped main bundle.");
assert(mainJs.includes(`./companion.js?v=${buildId}`), "Main should load the bumped companion bundle.");
assert(companion.includes(`./character.js?v=${buildId}`), "Companion should load the bumped character bundle.");

const requiredCompanionTokens = [
  "pc-chat-pill",
  "Chat</span>",
  "data-pc-settings",
  "data-pc-settings-panel",
  'renderSettingSelect("model", "Model")',
  'renderSettingSelect("speed", "Speed")',
  'renderSettingSelect("detail", "Style")',
  "Private API lane",
  "Fast local",
  "Deep review",
  "Provider details stay behind Phantom",
  "getChatSettings",
];

for (const token of requiredCompanionTokens) {
  assert(companion.includes(token), `Companion should include ${token}.`);
}

const requiredCssTokens = [
  ".pc-chat-pill",
  ".pc-settings-btn",
  ".pc-settings-panel",
  ".pc-setting-field",
  ".pc-settings-summary",
];

for (const token of requiredCssTokens) {
  assert(css.includes(token), `Chat settings CSS should include ${token}.`);
}

assert(mainJs.includes("Chat with Phantom."), "Starter title should say Chat with Phantom.");
assert(mainJs.includes("Chat with PhantomForce"), "Input placeholder should be chat-oriented.");
assert(mainJs.includes("const speed = getChatSettings().speed"), "Typing speed should read chat settings.");
assert(!mainJs.includes("Start Build Mode"), "Starter list must not expose Start Build Mode.");
assert(!mainJs.includes('setCompanionMode("build")'), "Main chat should not toggle companion build mode.");
assert(!companion.includes("setCompanionMode"), "Companion should not keep a mode-switch API.");
assert(!companion.includes("companionMode"), "Companion should not expose chat/build mode state.");
assert(!companion.includes("data-pc-mode"), "Companion should not expose a Chat/Build mode toggle.");
assert(!companion.includes("Toggle Build mode"), "Companion should not label settings as build mode.");
assert(!companion.includes("Build mode"), "Companion should not show Build mode copy.");
assert(!css.includes(".pc-mode"), "Old mode toggle CSS should be removed.");
assert(!css.includes(".chat-start-btn.is-build"), "Starter build-mode styling should be removed.");

console.log(
  JSON.stringify(
    {
      ok: true,
      buildId,
      visibleChatLabel: true,
      settingsGear: true,
      modelSetting: true,
      speedSetting: true,
      buildModeToggleRemoved: true,
    },
    null,
    2,
  ),
);
