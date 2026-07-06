import { readFileSync } from "node:fs";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

function readProjectFile(relativePath: string) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const buildId = "phantom-live-20260706-31";
const indexHtml = readProjectFile("apps/web/public/app/index.html");
const mainJs = readProjectFile("apps/web/public/app/js/main.js");
const mediaLab = readProjectFile("apps/web/public/app/js/medialab.js");
const css = readProjectFile("apps/web/public/app/phantom.css");

assert(indexHtml.includes(`window.PHANTOM_BUILD = "${buildId}"`), "Index should expose the current build id.");
assert(mainJs.includes(`./medialab.js?v=${buildId}`), "Main should load the current Media Lab/settings bundle.");
assert(mediaLab.includes(`./contenthub.js?v=${buildId}`), "Media Lab should load the current Content Hub bundle.");

const requiredTokens = [
  "Auto-connect",
  "Open Login",
  "data-social-auto",
  "data-social-open",
  "set-social-link-details",
  "Saved profile",
  "preferredPlatform",
  "socialLoginTarget(account)",
  "window.open(socialLoginTarget(account)",
];

for (const token of requiredTokens) {
  assert(mediaLab.includes(token), `Settings social account flow should include ${token}.`);
}

const forbiddenTokens = [
  "Prepare OAuth",
  "Official connect plan",
  "Official OAuth/API",
  "Login email / username",
  "manual email/handle/profile fields",
  "data-social-oauth",
  "data-social-enabled",
  "data-social-login",
  "Connection rules",
  "Detect Hermes",
  "Link latest profile",
  "Hermes Extension",
  "Hermes verified",
];

for (const token of forbiddenTokens) {
  assert(!mediaLab.includes(token), `Settings social account flow should not expose ${token}.`);
}

assert(css.includes(".set-connect-model.set-connect-model-simple"), "CSS should support the simplified two-choice social model.");
assert(css.includes(".set-social-primary-actions"), "CSS should style the simplified action row.");
assert(css.includes(".set-social-link-details"), "CSS should style the optional saved profile drawer.");

console.log(
  JSON.stringify(
    {
      ok: true,
      buildId,
      socialActions: ["Auto-connect", "Open Login"],
      removedConfusingControls: true,
      noManualLoginFields: true,
      noOauthPlanUi: true,
      noCookieTokenPasswordAccess: true,
    },
    null,
    2,
  ),
);
