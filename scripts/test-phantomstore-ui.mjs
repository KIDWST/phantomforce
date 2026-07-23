import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";

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
assert.match(storeSource, /\/api\/phantomstore\/products\/\$\{encodeURIComponent\(id\)\}\/buy/u, "Product buy intent must use the PhantomStore product endpoint.");
assert.match(storeSource, /This is not Site Builder\. This is not Store Builder\. PhantomStore is its own AI marketplace\./u, "UI must name PhantomStore as separate from Site Builder and Store Builder.");
assert.match(storeSource, /Seller directory/u, "Discovery must include a seller directory.");
assert.match(storeSource, /Ready to buy/u, "Discovery must expose ready-to-buy products before community tools.");
assert.match(storeSource, /const PRODUCT_ART_FALLBACKS/u, "PhantomStore must provide product artwork fallbacks when listings are missing images.");
assert.match(storeSource, /beatforge-cover\.svg/u, "PhantomStore must have BeatForge product art instead of reusing PhantomForce OS art.");
assert.match(storeSource + backendSource, /phantombot-cover\.svg/u, "PhantomStore must give Phantombot products real cover art instead of blank cards.");
assert.match(storeSource + backendSource, /phantombot-unleashed-cover\.svg/u, "Phantombot Unleashed must have distinct self-hosted product art instead of duplicating Phantombot.");
assert.match(storeSource, /unleashed\|self-hosted\|local-only\|fully local[\s\S]*phantombot-unleashed-cover\.svg/u, "Fallback product art must route local/self-hosted listings to the Unleashed cover first.");
assert.match(storeSource, /id:\s*"product-phantombot"[\s\S]*imageUrl:\s*"\/app\/assets\/phantomstore\/phantombot-cover\.svg/u, "Offline Phantombot listing must use the regular Phantombot cover.");
assert.match(storeSource, /id:\s*"product-phantombot-unleashed"[\s\S]*imageUrl:\s*"\/app\/assets\/phantomstore\/phantombot-unleashed-cover\.svg/u, "Offline Unleashed listing must use the distinct Unleashed cover.");
assert.match(backendSource, /id:\s*"product-phantombot"[\s\S]*imageUrl:\s*"\/app\/assets\/phantomstore\/phantombot-cover\.svg/u, "Backend Phantombot listing must use the regular Phantombot cover.");
assert.match(backendSource, /id:\s*"product-phantombot-unleashed"[\s\S]*imageUrl:\s*"\/app\/assets\/phantomstore\/phantombot-unleashed-cover\.svg/u, "Backend Unleashed listing must use the distinct Unleashed cover.");
assert.ok(statSync(new URL("../app/assets/phantomstore/phantombot-unleashed-cover.svg", import.meta.url)).size > 3500, "Unleashed cover must stay scene-rich instead of reverting to a tiny placeholder.");
assert.match(storeSource, /function localFallbackSnapshot\(\)/u, "PhantomStore must render a read-only local product catalog when live sync is offline.");
assert.match(storeSource, /ui\.snapshot\?\.readOnlyFallback[\s\S]*Opening the product page from the local catalog/u, "PhantomStore offline fallback buy buttons must open product pages instead of becoming dead API actions.");
assert.match(storeSource, /const artUrl = imageUrl \|\| fallbackImageUrl/u, "Product cards must choose uploaded art first and branded fallback art second.");
assert.match(storeSource, /ps-product-media\$\{imageUrl \? "" : " is-fallback"\}/u, "Product cards must always render a media block, even for missing product pictures.");
assert.match(storeSource, /seller reviews/u, "Seller cards must show seller reviews.");
assert.match(storeSource, /product reviews/u, "Product cards must show product reviews.");
assert.match(storeSource, /PhantomStore does not run this code/u, "Install panel must explain that marketplace listings do not execute code.");
assert.match(storeSource, /PhantomStore does not upload or host submitted code/u, "Submit panel must explain that code is not hosted or uploaded.");
assert.match(storeSource, /Source \/ repo URL/u, "Submissions must require a source URL.");
assert.match(storeSource, /Admin review before listing/u, "Discovery must communicate review before listing.");
assert.match(storeSource, /PHANTOM DRAFT INTAKE/u, "Submit must start with the AI-assisted bulk draft intake.");
assert.match(storeSource, /Draft with Phantom/u, "Submit must let users generate marketplace drafts from pasted batch input.");
assert.match(storeSource, /Save all as drafts/u, "Generated marketplace submissions must be saved as drafts, not auto-submitted.");
assert.match(storeSource, /Nothing is submitted, installed, uploaded, fetched, or approved/u, "AI intake must state its no-external-action boundary.");
assert.match(storeSource, /\/api\/phantomstore\/tools\/ai-draft/u, "UI must call the PhantomStore AI draft endpoint.");
assert.match(storeSource, /\/api\/phantomstore\/tools\/bulk-drafts/u, "UI must save generated submissions through the bulk draft endpoint.");
assert.match(storeSource, /\["discover", "Discover"\][\s\S]*\["library", "Library"\][\s\S]*\["submit", "Submit"\][\s\S]*\["review"/u, "PhantomStore must provide discover, owned library, submit, and review sections.");
assert.match(storeSource, /function renderLibrary\(\)[\s\S]*Ownership, compatibility, installed version, updates, and uninstall state/u, "PhantomStore must expose a truthful owned-product lifecycle surface.");
assert.match(storeSource, /data-ps-lifecycle="uninstall"[\s\S]*Uninstall, keep data/u, "Library uninstall must default to preserving customer data.");
assert.match(storeSource, /\/api\/phantomstore\/products\/\$\{encodeURIComponent\(id\)\}\/installation/u, "Library lifecycle actions must use the authenticated installation endpoint.");
assert.match(storeSource, /const safeHref[\s\S]*\^https\?:\\\/\\\//u, "Client links must refuse non-http(s) marketplace URLs.");
assert.match(storeSource, /new URL\(url\)/u, "Client link safety must parse and normalize URLs before rendering hrefs.");
assert.match(backendSource, /function safeUrl[\s\S]*parsed\.protocol === "https:" \|\| parsed\.protocol === "http:"/u, "Backend must sanitize PhantomStore URLs to http(s) only.");
assert.match(backendTestSource, /repoUrl: "javascript:alert\(1\)"[\s\S]*non-http\(s\) repo URL must be sanitized away and fail submission/u, "Backend PhantomStore tests must reject javascript URLs.");
assert.match(backendSource, /const SEEDED_SELLERS/u, "Backend must seed seller profiles.");
assert.match(backendSource, /const SEEDED_PRODUCTS/u, "Backend must seed product listings.");
assert.match(backendSource, /id:\s*"product-beatforge"[\s\S]*name:\s*"BeatForge"/u, "Backend must seed BeatForge as a real product listing.");
assert.doesNotMatch(backendSource, /id:\s*"product-phantomforce-os"/u, "PhantomForce OS must not be sold in the store users are already using.");
assert.match(backendSource, /Drop in a beat, attach your own kit/u, "BeatForge listing must clearly describe the beat + kit workflow.");
assert.match(backendSource, /review-beatforge-rebuild-plan/u, "BeatForge listing must use producer-specific review proof.");
assert.doesNotMatch(backendSource, /review-phantomforce-os/u, "Old PhantomForce OS product reviews must not remain attached to BeatForge.");
assert.match(backendSource, /recordPhantomStoreProductBuyClick/u, "Backend must track product buy intent.");
assert.match(backendSource, /grantPhantomStoreProductEntitlement/u, "Backend must support authoritative product entitlement grants.");
assert.match(backendSource, /existingReference[\s\S]*idempotent:\s*true/u, "Purchase-reference replay must be idempotent.");
assert.match(backendSource, /mutatePhantomStoreInstallation/u, "Backend must support install, update, restore, and uninstall state.");
assert.match(backendSource, /userDataStatus\s*=\s*purge \? "purged" : "preserved"/u, "Uninstall must preserve customer data unless purge is explicitly confirmed.");
assert.match(backendTestSource, /Plan\/access loss must revoke access without deleting installed user data/u, "Backend tests must protect customer data through access loss.");
assert.match(backendSource, /generatePhantomStoreSubmissionDrafts/u, "Backend must provide deterministic PhantomStore draft generation.");
assert.match(backendSource, /providerCalled:\s*false/u, "Draft generation must not claim an external AI provider was called.");
assert.match(backendSource, /externalFetchPerformed:\s*false/u, "Draft generation must not fetch external URLs.");
assert.match(backendSource, /saveGeneratedPhantomStoreDrafts/u, "Backend must save generated submissions as drafts only.");
assert.match(backendTestSource, /Bulk generated drafts must never auto-submit for public review/u, "Backend tests must protect generated drafts from auto-submission.");
assert.match(readFileSync(new URL("../server/src/index.ts", import.meta.url), "utf8"), /\/api\/beatforge\/preview[\s\S]*files_written:\s*false[\s\S]*daw_mutated:\s*false[\s\S]*audio_uploaded:\s*false/u,
  "BeatForge preview route must be explicit that it does not write files, mutate a DAW, or upload audio.");

for (const selector of [".ps-shell", ".ps-market-hero", ".ps-tool", ".ps-product", ".ps-seller", ".ps-reviews", ".ps-submit-layout", ".ps-ai-intake", ".ps-ai-drafts", ".ps-moderate"]) {
  assert.ok(storeCss.includes(selector), `${selector} style must be present.`);
}
for (const selector of [".ps-library", ".ps-library-grid", ".ps-library-card", ".ps-library-note"]) {
  assert.ok(storeCss.includes(selector), `${selector} lifecycle style must be present.`);
}
assert.match(storeCss, /\.ps-product-media img\{[^}]*object-fit:contain/u, "PhantomStore product images must show the full cover art instead of cropped/zoomed media.");
assert.match(storeCss, /\.ps-product-media img\{[^}]*transform:none/u, "PhantomStore product images must not be zoomed with transforms.");
assert.match(storeCss, /Product tile polish: keep PhantomStore feeling like a real marketplace/u, "PhantomStore product cards need a marketplace-grade visual layer.");
assert.match(storeCss, /\.ps-product-grid\{[\s\S]*?minmax\(min\(360px,100%\),1fr\)/u, "PhantomStore product cards must keep stable responsive card widths.");
assert.match(storeCss, /\.ps-product\{[\s\S]*?radial-gradient\(520px 240px/u, "PhantomStore product cards must use a richer product-tile surface.");
assert.match(storeCss, /\.ps-product-media\{[\s\S]*?min-height:220px/u, "PhantomStore product art must get enough stage height on desktop.");
assert.match(storeCss, /html\[data-org-color-mode="light"\] \.ps-shell/u, "PhantomStore must explicitly separate light-mode card surfaces from dark mode.");
assert.match(storeCss, /workspace-page\[data-workspace-page="phantomstore"\] \.workspace-page-body\{[\s\S]*?padding-bottom:calc\(var\(--mobile-admin-taskbar,80px\) \+ 64px/u, "PhantomStore mobile pages need extra bottom runway above the fixed dock.");
assert.match(storeCss, /@media\(max-width:640px\)[\s\S]*\.ps-product-grid,\s*\.ps-seller-grid,\s*\.ps-grid\{grid-template-columns:1fr/u, "PhantomStore must collapse product and seller grids on phones.");
assert.match(storeCss, /\.ps-product-fallback/u, "PhantomStore must style branded fallback product art.");
assert.match(storeCss, /\.ps-fallback-note/u, "PhantomStore must style the local read-only fallback notice.");

assert.match(customizationSource, /\["phantomstore", "PhantomStore", false/u, "Workspace customization fallback must know PhantomStore is a protected platform tab.");
assert.match(registrySource, /id:\s*"phantomstore"[\s\S]*displayName:\s*"PhantomStore"[\s\S]*route:\s*"phantomstore"[\s\S]*required:\s*true[\s\S]*customerConfigurable:\s*false/u, "Server module registry must expose PhantomStore as a required, non-hideable marketplace tab.");
assert.match(profilesSource, /business:[\s\S]*enabledModules:[\s\S]*"phantomstore"/u, "Business workspaces should include PhantomStore by default.");
assert.match(profilesSource, /creator:[\s\S]*enabledModules:[\s\S]*"phantomstore"/u, "Creator workspaces should include PhantomStore by default.");
assert.match(profilesSource, /developer:[\s\S]*enabledModules:[\s\S]*"phantomstore"/u, "Developer workspaces should include PhantomStore by default.");

console.log("PhantomStore UI and module wiring checks passed.");
