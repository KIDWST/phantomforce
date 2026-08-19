import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const mediaLab = readFileSync(new URL("../app/js/medialab.js", import.meta.url), "utf8");
const orgs = readFileSync(new URL("../app/js/orgs.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/creator-studio.css", import.meta.url), "utf8");
const server = readFileSync(new URL("../server/src/index.ts", import.meta.url), "utf8");
const thumbnailService = readFileSync(new URL("../server/src/assets/local-media-thumbnail.ts", import.meta.url), "utf8");

assert.match(
  mediaLab,
  /const NAV_TABS = \[[\s\S]*?\["assets", "Assets"\][\s\S]*?session\.tab === "assets"[\s\S]*?renderAssetCatalogue/u,
  "Assets must remain a first-class Media Lab workspace tab.",
);

assert.match(
  mediaLab,
  /catalogueFallbackThumbnail[\s\S]*data-catalog-fallback[\s\S]*const cards = \[\.\.\.body\.querySelectorAll\("\[data-catalog-thumb\]"\)\][\s\S]*Math\.min\(6, cards\.length\)/u,
  "Every card must paint immediately and the complete result set must hydrate through a bounded worker pool.",
);
assert.doesNotMatch(mediaLab, /querySelectorAll\("\[data-catalog-thumb\]"\)\]\.slice/u, "Thumbnail hydration must never stop at an arbitrary card count.");
assert.match(mediaLab, /localAssetThumbnailBlobUrl\(row\.id\)[\s\S]*captureCatalogueVideoPoster/u, "Local and browser video assets must use poster-specific thumbnail paths.");
assert.match(orgs, /localAssetThumbnailBlobCache[\s\S]*attempt < 2[\s\S]*\/thumbnail/u, "Local thumbnail requests must be cached and retried.");
assert.match(server, /local-assets\/:assetId\/thumbnail[\s\S]*createLocalAssetThumbnail[\s\S]*x-phantom-thumbnail-state[\s\S]*localMediaFallbackSvg/u, "The local server must always return either a cached preview or a renderable fallback.");
assert.match(thumbnailService, /MAX_ACTIVE_GENERATORS = 2[\s\S]*showwavespic[\s\S]*00:00:00\.750/u, "Thumbnail extraction must cover video, audio, and bounded generation.");
assert.match(thumbnailService, /validThumbnail\(outputPath\)[\s\S]*state: "cached"/u, "Repeated thumbnail requests must use the persistent cache.");

const drawers = mediaLab.match(/const NAV_DRAWERS = \[([\s\S]*?)\];/u)?.[1] || "";
assert.doesNotMatch(drawers, /"assets"/u, "Assets must not regress to the narrow utility drawer.");

assert.match(
  mediaLab,
  /Asset Catalogue[\s\S]*data-catalog-upload[\s\S]*data-catalog-sync[\s\S]*webkitdirectory[\s\S]*data-catalog-search[\s\S]*data-catalog-display="grid"[\s\S]*data-catalog-display="list"/u,
  "The catalogue must expose upload, folder sync, search, and both stable layouts.",
);

assert.match(
  mediaLab,
  /function catalogueRows[\s\S]*sourceType: "cloud"[\s\S]*sourceType: "local"[\s\S]*cataloguePoolRows/u,
  "Asset Cloud, local PC files, and Media Pool must share one catalogue.",
);

assert.match(
  mediaLab,
  /async function uploadCatalogueFiles[\s\S]*assetsAvailable\(\)[\s\S]*uploadAsset\([\s\S]*syncCatalogueFolder[\s\S]*webkitRelativePath[\s\S]*URL\.createObjectURL/u,
  "Uploads must use tenant-scoped Asset Cloud while explicit folder sync remains local to the session.",
);

assert.match(
  mediaLab,
  /patchAsset\([\s\S]*assetLifecycle\([\s\S]*data-catalog-bulk-favorite[\s\S]*data-catalog-bulk-trash/u,
  "Metadata, favorites, archive/trash, restore, and bulk organization controls must remain wired.",
);

assert.match(
  css,
  /\.ml-asset-catalogue[\s\S]*\.ml-catalog-layout[\s\S]*\.ml-catalog-detail[\s\S]*@media \(max-width: 1180px\)[\s\S]*@media \(max-width: 760px\)[\s\S]*@media \(max-width: 460px\)/u,
  "The full catalogue must retain desktop, tablet, and phone layouts.",
);

console.log("Media asset catalogue checks passed.");
