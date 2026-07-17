import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const contentHubSource = readFileSync(new URL("../app/js/contenthub.js", import.meta.url), "utf8");
const mediaLabSource = readFileSync(new URL("../app/js/medialab.js", import.meta.url), "utf8");
const cssSource = readFileSync(new URL("../app/phantom.css", import.meta.url), "utf8");

assert.match(contentHubSource, /CH_ASSET_RECYCLE_KEY\s*=\s*"pf\.contenthub\.assets\.recycle\.v1"/, "Content assets need a separate 30-day recycle store.");
assert.match(contentHubSource, /export function loadRecycledContentAssets\(\)/, "Recycle bin assets must be loadable.");
assert.match(contentHubSource, /export function recycleContentAssets\(assets = \[\]\)/, "Removing media must route through a recycle helper.");
assert.match(contentHubSource, /trashExpiresAt:\s*trashedAt \+ CONTENT_ASSET_LIMITS\.retentionDays \* DAY/, "Recycled media must expire after the configured retention window.");
assert.match(contentHubSource, /export function restoreRecycledContentAssets\(ids = \[\]\)/, "Recycled media must be restorable.");
assert.match(contentHubSource, /createdAt:\s*restoredAt/, "Restored media must regain active retention instead of expiring immediately.");
assert.match(contentHubSource, /export function purgeRecycledContentAssets\(ids = \[\]\)/, "The recycle bin needs permanent deletion for expired or unwanted media.");
assert.match(contentHubSource, /recycleContentAssets\(deleted\)/, "Content Hub single-asset removal must no longer hard-delete local media.");
assert.match(contentHubSource, /recycleContentAssets\(deletedAssets\)/, "Content Hub bulk removal must no longer hard-delete local media.");
assert.match(contentHubSource, /restoreRecycledContentAssets\(restoredAssets\.map/, "Undo must restore from the recycle bin when possible.");

assert.match(mediaLabSource, /loadRecycledContentAssets,\s*recycleContentAssets,\s*restoreRecycledContentAssets,\s*purgeRecycledContentAssets/u, "Media Lab must use the shared recycle helpers.");
assert.match(mediaLabSource, /function poolRecycleBinHtml\(items,\s*esc\)/, "Media Pool must render a recovery section.");
assert.match(mediaLabSource, /data-pool-trash-act="restore"/, "Recycle Bin must expose restore.");
assert.match(mediaLabSource, /data-pool-trash-act="purge"/, "Recycle Bin must expose permanent delete.");
assert.match(mediaLabSource, /recycleContentAssets\(asset\)/, "The Media Pool x action must recycle instead of hard-delete.");
assert.match(mediaLabSource, /const recycled = loadRecycledContentAssets\(\)/, "Media Pool render must include recycled assets.");
assert.match(mediaLabSource, /poolRecycleBinHtml\(recycled,\s*esc\)/, "Media Pool must append the recycle bin UI.");

assert.match(cssSource, /\.ml-recycle-bin\s*\{/, "Recycle Bin needs visible Media Lab styling.");
assert.match(cssSource, /\.ml-recycle-row\s*\{/, "Recycle Bin rows need compact styling.");

console.log("medialab recycle bin tests passed");
