import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const mediaLab = read("../app/js/medialab.js");
const mediaGeneration = read("../app/js/mediageneration.js");
const mediaBackend = read("../app/js/mediabackend.js");
const contentHub = read("../app/js/contenthub.js");
const contentPublication = read("../app/js/contentpublication.js");
const videoCut = read("../app/js/videocut.js");
const css = read("../app/phantom.css");

assert.match(mediaGeneration, /export async function listMediaJobs\(\{ activeOnly = false \} = \{\}\)/u,
  "Media Lab must be able to hydrate both active and terminal durable jobs.");
assert.match(mediaLab, /const jobs = \(await listMediaJobs\(\)\)\.map\(normalizePendingJob\)/u,
  "Media Lab must hydrate persisted jobs after refresh.");
assert.match(mediaLab, /pendingJobControllers\.get\(jobId\)\?\.abort\(\)/u,
  "Cancel must stop the active provider request, not only hide a card.");
assert.match(mediaLab, /await transitionMediaJob\(jobId, "cancelled"\)/u,
  "Cancel must persist a terminal cancelled state.");
assert.match(mediaLab, /data-ml-retry-job/u,
  "Failed and cancelled render attempts must expose retry.");
assert.match(mediaLab, /const retry = await retryMediaJob\(source\.id\)[\s\S]*await runGenerate\(liveBody, cfg, opts, root, esc, retry\)/u,
  "Retry must re-enter the real generation pipeline rather than only create another queue record.");
assert.match(mediaLab, /existingLifecycleJob \|\| await createMediaJob/u,
  "The provider pipeline must accept a durable retry record.");
assert.match(mediaLab, /transitionMediaJob\(lifecycleJob\.id, "completed", \{ outputAssetIds:/u,
  "Generation may complete only with output asset references.");
assert.match(mediaLab, /provider_queued_without_verified_output/u,
  "Provider acceptance without a verified output must not be reported as completion.");

assert.match(mediaBackend, /export async function archiveSyncedAsset\(id\)/u,
  "Synced Media Pool assets must support server-side archive.");
assert.match(mediaBackend, /export async function restoreSyncedAsset\(id\)/u,
  "Archived synced assets must support restore.");
assert.match(contentHub, /if \(asset\.syncedId\) archiveSyncedAsset\(asset\.syncedId\)/u,
  "Content Hub recycle must archive the corresponding synced asset.");
assert.match(contentHub, /if \(asset\.syncedId\) restoreSyncedAsset\(asset\.syncedId\)/u,
  "Content Hub restore must reactivate the corresponding synced asset.");

assert.match(contentPublication, /source_asset_id:/u,
  "Content publishing must preserve a source media identity.");
assert.match(contentPublication, /thumbnail_asset_id:/u,
  "Content publishing must preserve a separate thumbnail identity.");
assert.match(contentHub, /publication = await persistContentPublication\(draft\)/u,
  "Content Hub must persist drafts and schedules to the authoritative lifecycle.");
assert.match(contentHub, /draft\.localOnly = !publication/u,
  "A backend outage must remain visible instead of pretending a draft synced.");
assert.match(contentHub, /Post preserved locally, but the server schedule did not sync/u,
  "Schedule failure must preserve the draft and tell the operator the truth.");
assert.match(contentHub, /No external post was sent/u,
  "Saving a schedule must never imply an external post happened.");

assert.match(videoCut, /const projectKey = `pf\.phantomcut\.project\.v1:/u,
  "PhantomCut project persistence must be tenant-scoped.");
assert.match(videoCut, /function saveProject\(\{ announce = false \} = \{\}\)/u,
  "PhantomCut must have an explicit durable project save path.");
assert.match(videoCut, /function restoreProject\(\)/u,
  "PhantomCut must restore a saved project after refresh.");
assert.match(videoCut, /data-vc-save-project/u,
  "PhantomCut must expose an explicit Save project control.");
assert.match(videoCut, /data-vc-export-cancel/u,
  "PhantomCut must expose export cancellation.");
assert.match(videoCut, /This browser has no MediaRecorder webm support/u,
  "Unsupported browser export must be explained honestly.");

assert.match(css, /\.ml-pending-card\s*\{[\s\S]*grid-template-columns:\s*72px minmax\(0,\s*1fr\) auto/u,
  "Pending cards must reserve space for lifecycle actions without crushing text.");
assert.match(css, /\.vc-save-project\s*\{[\s\S]*white-space:\s*nowrap/u,
  "The explicit PhantomCut save action must render as a readable control.");

console.log("Creative OS UI lifecycle checks passed");
