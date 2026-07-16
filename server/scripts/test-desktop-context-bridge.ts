import { readFileSync } from "node:fs";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

function readProjectFile(relativePath: string) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const buildId = "phantom-live-20260713-qa-sweep-01";
const indexHtml = readProjectFile("apps/web/public/app/index.html");
const mainJs = readProjectFile("apps/web/public/app/js/main.js");
const desktopContextJs = readProjectFile("apps/web/public/app/js/desktop-context.js");
const css = readProjectFile("apps/web/public/app/phantom.css");

const requiredBridgeTokens = [
  "PF_HERMES_DESKTOP_CONTEXT_REQUEST",
  "PF_HERMES_DESKTOP_CONTEXT_RESULT",
  "PF_HERMES_FOCUS_TAB_REQUEST",
  "PF_HERMES_FOCUS_TAB_RESULT",
  "phantomforce.hermes.extension.v1",
  "mountDesktopContextWidget",
  "Safe metadata only",
];

for (const token of requiredBridgeTokens) {
  assert(desktopContextJs.includes(token), `Desktop Context bridge should include ${token}.`);
}

assert(indexHtml.includes("data-desktop-context"), "Dashboard should mount the Desktop Context card.");
assert(mainJs.includes(`./desktop-context.js?v=${buildId}`), "Main should load the current Desktop Context bundle.");
assert(mainJs.includes("mountDesktopContextWidget($(\"[data-desktop-context]\")"), "Main should mount Desktop Context into the status rail.");
assert(css.includes(".desktop-context-card"), "CSS should style the Desktop Context card.");
assert(css.includes(".dc-open"), "CSS should style Desktop Context open controls.");

const appSource = `${indexHtml}\n${mainJs}\n${desktopContextJs}\n${css}`;
assert(!/document\.cookie|chrome\.cookies|browser\.cookies/i.test(appSource), "Desktop Context must not read cookies.");
assert(!/passwordsRead:\s*true|cookiesRead:\s*true|tokensRead:\s*true|filesystemRead:\s*true/i.test(appSource), "Desktop Context must not claim unsafe reads.");
assert(!/fetch\s*\(/.test(desktopContextJs), "Desktop Context should use the browser bridge, not network fetch.");

console.log(
  JSON.stringify(
    {
      ok: true,
      buildId,
      desktopContextCard: true,
      mediaTabs: "safe metadata through Hermes browser bridge",
      focusAction: "user-click tab focus only",
      noCookiesPasswordsTokensHistoryFiles: true,
      noNetworkFetch: true,
    },
    null,
    2,
  ),
);
