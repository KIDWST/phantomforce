import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appHtml = readFileSync(new URL("../app/index.html", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../app/js/main.js", import.meta.url), "utf8");
const storeSource = readFileSync(new URL("../app/js/phantomstore.js", import.meta.url), "utf8");
const storeCss = readFileSync(new URL("../app/phantomstore.css", import.meta.url), "utf8");
const customizationSource = readFileSync(new URL("../app/js/customization.js", import.meta.url), "utf8");
const registrySource = readFileSync(new URL("../server/src/customization/module-registry.ts", import.meta.url), "utf8");
const profilesSource = readFileSync(new URL("../server/src/customization/workspace-profiles.ts", import.meta.url), "utf8");
const backendSource = readFileSync(new URL("../server/src/phantom-ai/phantomstore.ts", import.meta.url), "utf8");
const backendTestSource = readFileSync(new URL("../server/scripts/test-phantomstore.ts", import.meta.url), "utf8");

assert.match(appHtml, /phantomstore\.css/u, "App shell must load PhantomStore styles.");
assert.match(mainSource, /renderPhantomStore/u, "Main app must import PhantomStore renderer.");
assert.match(mainSource, /\{\s*id:\s*"phantomstore",\s*label:\s*"PhantomStore",\s*icon:\s*"spark",\s*ws:\s*"phantomstore"\s*\}/u, "Sidebar must expose PhantomStore as its own workspace.");
assert.match(mainSource, /phantomstore:\s*\{\s*title:\s*"PhantomStore"[\s\S]*render:\s*\(body\)\s*=>\s*renderPhantomStore\(body/u, "Workspace registry must render the PhantomStore screen.");

assert.match(storeSource, /\/api\/phantomstore\?tenant_id=/u, "PhantomStore UI must load the PhantomStore marketplace API.");
assert.match(storeSource, /\/api\/phantomstore\/tools"/u, "PhantomStore UI must submit tools to its own API.");
assert.match(storeSource, /\/api\/phantomstore\/tools\/\$\{encodeURIComponent\(id\)\}\/install/u, "Install intent must use the PhantomStore install endpoint.");
assert.match(storeSource, /\/api\/phantomstore\/tools\/\$\{encodeURIComponent\(id\)\}\/moderate/u, "Moderation must use the PhantomStore moderation endpoint.");
assert.match(storeSource, /This is not Site Builder\. This is not Store Builder\. PhantomStore is its own AI marketplace\./u, "UI must name PhantomStore as separate from Site Builder and Store Builder.");
assert.match(storeSource, /PhantomStore does not run this code/u, "Install panel must explain that marketplace listings do not execute code.");
assert.match(storeSource, /PhantomStore does not upload or host submitted code/u, "Submit panel must explain that code is not hosted or uploaded.");
assert.match(storeSource, /Source \/ repo URL/u, "Submissions must require a source URL.");
assert.match(storeSource, /Admin review before listing/u, "Discovery must communicate review before listing.");
assert.match(storeSource, /\["discover", "Discover"\][\s\S]*\["submit", "Submit"\][\s\S]*\["review"/u, "PhantomStore must provide discover, submit, and review sections.");
assert.match(storeSource, /const safeHref[\s\S]*\^https\?:\\\/\\\//u, "Client links must refuse non-http(s) marketplace URLs.");
assert.match(storeSource, /new URL\(url\)/u, "Client link safety must parse and normalize URLs before rendering hrefs.");
assert.match(backendSource, /function safeUrl[\s\S]*parsed\.protocol === "https:" \|\| parsed\.protocol === "http:"/u, "Backend must sanitize PhantomStore URLs to http(s) only.");
assert.match(backendTestSource, /repoUrl: "javascript:alert\(1\)"[\s\S]*non-http\(s\) repo URL must be sanitized away and fail submission/u, "Backend PhantomStore tests must reject javascript URLs.");

for (const selector of [".ps-shell", ".ps-market-hero", ".ps-tool", ".ps-submit-layout", ".ps-moderate"]) {
  assert.ok(storeCss.includes(selector), `${selector} style must be present.`);
}

assert.match(customizationSource, /\["phantomstore", "PhantomStore", true/u, "Workspace customization fallback must know PhantomStore.");
assert.match(registrySource, /id:\s*"phantomstore"[\s\S]*displayName:\s*"PhantomStore"[\s\S]*route:\s*"phantomstore"/u, "Server module registry must expose PhantomStore.");
assert.match(profilesSource, /business:[\s\S]*enabledModules:[\s\S]*"phantomstore"/u, "Business workspaces should include PhantomStore by default.");
assert.match(profilesSource, /creator:[\s\S]*enabledModules:[\s\S]*"phantomstore"/u, "Creator workspaces should include PhantomStore by default.");
assert.match(profilesSource, /developer:[\s\S]*enabledModules:[\s\S]*"phantomstore"/u, "Developer workspaces should include PhantomStore by default.");

console.log("PhantomStore UI and module wiring checks passed.");
