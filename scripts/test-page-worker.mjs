import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (file) => readFileSync(resolve(here, file), "utf8");

const worker = read("../app/js/pageworker.js");
const main = read("../app/js/main.js");
const css = read("../app/phantom.css");
const index = read("../app/index.html");

assert.match(worker, /automation:\s*\{[\s\S]*Enter your automation here and we’ll go through what we can do for you/u, "Automation page must have the requested worker prompt.");
assert.match(worker, /Find the trigger: when this should start/u, "Automation prompt must return plain-English steps.");
assert.match(worker, /Mark sends, posts, deletes, spending, and client messages for approval/u, "Automation prompt must preserve safety boundaries.");
assert.match(worker, /sites:\s*\{/u, "Website page should have a worker prompt.");
assert.match(worker, /content:\s*\{/u, "Content Hub should have a worker prompt.");
assert.match(worker, /analytics:\s*\{/u, "Analytics should have a worker prompt.");
assert.match(worker, /vacation:\s*\{/u, "Away Mode should have a worker prompt.");
assert.match(worker, /phantomplay:\s*\{/u, "PhantomPlay should have a worker prompt.");
assert.match(worker, /data-page-worker-form/u, "Worker prompt form must be bindable.");
assert.match(worker, /opts\.notify/u, "Worker prompt should log/notify without executing external actions.");

assert.match(main, /import \{ pageWorkerHtml, mountPageWorkers \} from "\.\/pageworker\.js\?v=phantom-live-20260712-226"/u, "main.js must import the page worker module.");
assert.match(main, /\$\{pageWorkerHtml\(key, def\)\}/u, "Workspace pages must mount the worker prompt.");
assert.match(main, /mountPageWorkers\(root, mediaOpts\(\)\)/u, "Workspace pages must bind worker prompt events.");
assert.match(main, /mountPageWorkers\(overlayRoot, mediaOpts\(\)\)/u, "Overlay pages must bind worker prompt events.");

assert.match(css, /\.page-worker\b/u, "Page worker styles must exist.");
assert.match(css, /\.page-worker-output li::before/u, "Plain-English step bullets must be styled.");
assert.match(index, /phantom-live-20260712-226/u, "Index cache id must be bumped for the new worker module.");

console.log("Page worker prompt checks passed.");
