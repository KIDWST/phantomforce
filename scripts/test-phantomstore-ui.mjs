import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appHtml = readFileSync(new URL("../app/index.html", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../app/js/main.js", import.meta.url), "utf8");
const storeSource = readFileSync(new URL("../app/js/phantomstore.js", import.meta.url), "utf8");
const storeCss = readFileSync(new URL("../app/phantomstore.css", import.meta.url), "utf8");
const customizationSource = readFileSync(new URL("../app/js/customization.js", import.meta.url), "utf8");
const staticServerSource = readFileSync(new URL("../ops/admin-live/admin-static-server.mjs", import.meta.url), "utf8");
const registrySource = readFileSync(new URL("../server/src/customization/module-registry.ts", import.meta.url), "utf8");
const profilesSource = readFileSync(new URL("../server/src/customization/workspace-profiles.ts", import.meta.url), "utf8");
const backendSource = readFileSync(new URL("../server/src/phantom-ai/phantomstore.ts", import.meta.url), "utf8");
const backendTestSource = readFileSync(new URL("../server/scripts/test-phantomstore.ts", import.meta.url), "utf8");

assert.match(appHtml, /phantomstore\.css/u, "App shell must load PhantomStore styles.");
assert.match(mainSource, /renderPhantomStore/u, "Main app must import PhantomStore renderer.");
const mainStoreVersion = mainSource.match(/\.\/store\.js\?v=([^"]+)/u)?.[1];
const phantomStoreVersion = storeSource.match(/\.\/store\.js\?v=([^"]+)/u)?.[1];
assert.ok(mainStoreVersion && phantomStoreVersion && mainStoreVersion === phantomStoreVersion, "PhantomStore must import the same store.js build as the app shell so auth/session state is shared.");
assert.match(mainSource, new RegExp(`\\.\\/phantomstore\\.js\\?v=${mainStoreVersion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "u"), "Main app must cache-bust PhantomStore with the current shared store build.");
/* Tolerates extra nav-entry properties (e.g. dept) added by other workstreams;
   the invariant is the id/label/icon/ws quadruple, not the exact object shape. */
assert.match(mainSource, /\{\s*id:\s*"phantomstore",\s*label:\s*"PhantomStore",\s*icon:\s*"spark",\s*ws:\s*"phantomstore"[^}]*\}/u, "Sidebar must expose PhantomStore as its own clearly labeled workspace.");
assert.match(mainSource, /phantomstore:\s*\{\s*title:\s*"PhantomStore",\s*kicker:\s*"AI marketplace"[\s\S]*render:\s*\(body\)\s*=>\s*renderPhantomStore\(body/u, "Workspace registry must render the PhantomStore AI marketplace screen.");

assert.match(storeSource, /\/api\/phantomstore\?tenant_id=/u, "PhantomStore UI must load the PhantomStore marketplace API.");
assert.match(staticServerSource, /urlPath\.startsWith\("\/api\/phantomstore"\)/u, "Public static server must proxy PhantomStore API routes.");
assert.match(storeSource, /\/api\/phantomstore\/tools"/u, "PhantomStore UI must submit tools to its own API.");
assert.match(storeSource, /\/api\/phantomstore\/tools\/\$\{encodeURIComponent\(id\)\}\/install/u, "Install intent must use the PhantomStore install endpoint.");
assert.match(storeSource, /\/api\/phantomstore\/tools\/\$\{encodeURIComponent\(id\)\}\/moderate/u, "Moderation must use the PhantomStore moderation endpoint.");
assert.match(storeSource, /\/api\/phantomstore\/products\/\$\{encodeURIComponent\(id\)\}\/buy/u, "Product buy intent must use the PhantomStore product endpoint.");
assert.match(storeSource, /This is not Site Builder\. This is not Store Builder\. PhantomStore is its own AI marketplace\./u, "UI must name PhantomStore as separate from Site Builder and Store Builder.");
assert.match(storeSource, /Seller directory/u, "Discovery must include a seller directory.");
assert.match(storeSource, /Ready to buy/u, "Discovery must expose ready-to-buy products before community tools.");
assert.match(storeSource, /seller reviews/u, "Seller cards must show seller reviews.");
assert.match(storeSource, /product reviews/u, "Product cards must show product reviews.");
assert.match(storeSource, /PhantomStore does not run this code/u, "Install panel must explain that marketplace listings do not execute code.");
assert.match(storeSource, /PhantomStore does not upload or host submitted code/u, "Submit panel must explain that code is not hosted or uploaded.");
assert.match(storeSource, /Source \/ repo URL/u, "Submissions must require a source URL.");
assert.match(storeSource, /Admin review before listing/u, "Discovery must communicate review before listing.");
assert.match(storeSource, /\["discover", "Discover"\][\s\S]*\["submit", "Submit"\][\s\S]*\["review"/u, "PhantomStore must provide discover, submit, and review sections.");
assert.match(storeSource, /const safeHref[\s\S]*\^https\?:\\\/\\\//u, "Client links must refuse non-http(s) marketplace URLs.");
assert.match(storeSource, /new URL\(url\)/u, "Client link safety must parse and normalize URLs before rendering hrefs.");
assert.match(backendSource, /function safeUrl[\s\S]*parsed\.protocol === "https:" \|\| parsed\.protocol === "http:"/u, "Backend must sanitize PhantomStore URLs to http(s) only.");
assert.match(backendTestSource, /repoUrl: "javascript:alert\(1\)"[\s\S]*non-http\(s\) repo URL must be sanitized away and fail submission/u, "Backend PhantomStore tests must reject javascript URLs.");
assert.match(backendSource, /const SEEDED_SELLERS/u, "Backend must seed seller profiles.");
assert.match(backendSource, /const SEEDED_PRODUCTS/u, "Backend must seed product listings.");
assert.match(backendSource, /recordPhantomStoreProductBuyClick/u, "Backend must track product buy intent.");

/* Product model upgrades: real image fields, variants, inventory, and
   store-backed persistence with admin-gated editing. */
assert.match(backendSource, /imageUrl: string \| null;[\s\S]*gallery: string\[\];[\s\S]*videoUrl: string \| null;[\s\S]*media: PhantomStoreProductMedia\[\];[\s\S]*variants: PhantomStoreProductVariant\[\];[\s\S]*inventory: PhantomStoreProductInventory;/u, "Product model must carry imageUrl, gallery, videoUrl, media, variants, and inventory.");
assert.match(backendSource, /latestVersion: string;[\s\S]*releaseChannel: PhantomStoreReleaseChannel;[\s\S]*updatePolicy: PhantomStoreUpdatePolicy;[\s\S]*updateStatus: PhantomStoreUpdateStatus;[\s\S]*lastUpdateCheckAt: string;[\s\S]*nextUpdateCheckAt: string;[\s\S]*updateUrl: string;[\s\S]*releaseNotes: string;/u, "Product model must carry release/update metadata for marketplace freshness.");
assert.match(backendSource, /const PRODUCT_UPDATE_CHECK_INTERVAL_MS = 6 \* 60 \* 60 \* 1000/u, "PhantomStore products must refresh update checks on a 6-hour cadence.");
assert.match(backendSource, /function refreshProductUpdateChecks/u, "Existing PhantomStore JSON stores must refresh product update-check timestamps.");
assert.match(backendSource, /function syncSeededProductReleases/u, "Existing PhantomStore JSON stores must sync seeded product release/version metadata.");
assert.match(backendSource, /name: "PhantomVox"[\s\S]*releaseChannel: "preview"[\s\S]*updateStatus: "coming_soon"/u, "The Reaper plugin listing must be branded as PhantomVox and flagged close to launch.");
assert.match(backendSource, /name: "Termina"[\s\S]*version: "0\.3\.0"[\s\S]*Prompt Scheduler\/Sender/u, "Termina must advertise the current scheduler-capable release.");
assert.match(backendSource, /type: "video"[\s\S]*AI-generated Termina showcase/u, "Termina must include a real generated showcase video media item.");
assert.match(backendSource, /function syncSeededProductMedia/u, "Existing PhantomStore JSON stores must sync newly generated seeded product media.");
assert.match(backendSource, /imageUrl: "\/app\/assets\/brand-phantom\.png"/u, "Business OS must use the real shipped brand image asset, not a fabricated photo.");
assert.match(backendSource, /imageUrl: null/u, "Products without a real image asset must ship imageUrl null so the client renders a branded tile instead of a fake image.");
assert.match(backendSource, /id: "termina-early-access", label: "Early access license", priceUsd: 20/u, "Termina must keep its real $20 early-access pricing as a variant.");
assert.match(backendSource, /function seedProductsIfEmpty/u, "Products must be store-backed: seeded once from SEEDED_PRODUCTS, then served from the JSON store.");
assert.match(backendSource, /export async function upsertPhantomStoreProduct[\s\S]*Platform moderation access is required/u, "Product create/update must reuse the moderation permission gate.");
assert.match(backendSource, /productVariantClicks/u, "Backend must record variant-level buy clicks.");
assert.match(backendTestSource, /variantId: "termina-early-access"/u, "Backend PhantomStore tests must cover variant-aware buy recording.");
assert.match(backendTestSource, /devProductUpdate\.statusCode === 403/u, "Backend PhantomStore tests must prove non-admin product updates get a 403.");

/* In-app product detail view + admin product editor in the UI. */
assert.match(storeSource, /function brandTileUrl[\s\S]*data:image\/svg\+xml/u, "Missing product images must render a deterministic branded SVG tile generated in code.");
assert.match(storeSource, /function productImageUrl/u, "Product cards must render the backend imageUrl field with a branded-tile fallback.");
assert.match(storeSource, /data-ps-detail/u, "Product cards must open an in-app detail view.");
assert.match(storeSource, /data-ps-product-view/u, "The detail view must be marked with a deep-linkable data attribute.");
assert.match(storeSource, /data-ps-back/u, "The detail view must provide a back-to-discover control.");
assert.match(storeSource, /data-ps-variant/u, "The detail view must offer a variant selector.");
assert.doesNotMatch(storeSource, />Product page</u, "The UI must not show a duplicate external Product page link when View details is the product page.");
assert.match(storeSource, /function productWorkflowMatch/u, "Products must calculate an AI workflow match score.");
assert.match(storeSource, /workflow match/u, "The product page must expose AI workflow match copy.");
assert.match(storeSource, /function productGallery/u, "The product page must build a gallery/showcase from product media plus branded fallback frames.");
assert.match(storeSource, /function productMedia/u, "The product page must render first-class product image/video media.");
assert.match(storeSource, /<video src=/u, "Generated product videos must render directly inside the product detail page.");
assert.match(storeSource, /function productShowcase/u, "The product page must explain the AI fit, prediction, and proof signals.");
assert.match(storeSource, /function productUpdateState/u, "The product UI must compute product update/readiness state.");
assert.match(storeSource, /VERSION HEALTH/u, "The product detail page must show release/update health.");
assert.match(storeSource, /latest v/u, "Product cards must show the latest version signal.");
assert.match(storeSource, /releaseNotes: String\(data\.get\("releaseNotes"\)/u, "The admin product editor must save release notes.");
assert.match(storeSource, /updatePolicy: String\(data\.get\("updatePolicy"\)/u, "The admin product editor must save update policy.");
assert.match(storeSource, /variant \? \{ variantId: variant\.id \} : \{\}/u, "Buy requests must carry the selected variant id.");
assert.match(storeSource, /ui\.snapshot\?\.canModerate \? adminProductsPanel\(\)/u, "The admin product editor must only render for moderation-capable sessions.");
assert.match(storeSource, /\/api\/phantomstore\/products\/\$\{encodeURIComponent\(productId\)\}/u, "The admin product editor must save through the product update endpoint.");
assert.match(storeSource, /quality_hold/u, "Buy availability must respect quality_hold status.");
assert.match(storeSource, /function outOfStock/u, "Buy availability must respect tracked inventory at zero stock.");

for (const selector of [".ps-shell", ".ps-market-hero", ".ps-tool", ".ps-product", ".ps-seller", ".ps-reviews", ".ps-submit-layout", ".ps-moderate", ".ps-product-media", ".ps-detail", ".ps-variant", ".ps-admin-products", ".ps-match-chip", ".ps-video-chip", ".ps-card-gallery", ".ps-ai-fit-panel", ".ps-fit-meter", ".ps-showcase-strip", ".ps-detail-stage", ".ps-media-strip", ".ps-update-chip", ".ps-update-panel", ".ps-release-notes"]) {
  assert.ok(storeCss.includes(selector), `${selector} style must be present.`);
}

assert.match(storeCss, /@keyframes ps-card-scan/u, "Product cards must include a modern animated scan treatment.");
assert.match(storeCss, /@keyframes ps-light-sweep/u, "Product media must include animated light sweep treatment.");
assert.match(storeCss, /@keyframes ps-meter/u, "AI workflow match meter must animate into place.");

assert.match(customizationSource, /\["phantomstore", "PhantomStore", false/u, "Workspace customization fallback must know PhantomStore is a protected platform tab.");
assert.match(registrySource, /id:\s*"phantomstore"[\s\S]*displayName:\s*"PhantomStore"[\s\S]*route:\s*"phantomstore"[\s\S]*required:\s*true[\s\S]*customerConfigurable:\s*false/u, "Server module registry must expose PhantomStore as a required, non-hideable marketplace tab.");
assert.match(profilesSource, /business:[\s\S]*enabledModules:[\s\S]*"phantomstore"/u, "Business workspaces should include PhantomStore by default.");
assert.match(profilesSource, /creator:[\s\S]*enabledModules:[\s\S]*"phantomstore"/u, "Creator workspaces should include PhantomStore by default.");
assert.match(profilesSource, /developer:[\s\S]*enabledModules:[\s\S]*"phantomstore"/u, "Developer workspaces should include PhantomStore by default.");

console.log("PhantomStore UI and module wiring checks passed.");
