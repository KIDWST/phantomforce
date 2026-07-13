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
const skipPages = worker.match(/const SKIP_PAGES = new Set\(\[([\s\S]*?)\]\);/u)?.[1] || "";

assert.match(worker, /automation:\s*\{[\s\S]*Enter your automation here and we’ll go through what we can do for you/u, "Automation page must have the requested worker prompt.");
assert.match(worker, /Infer trigger, condition, action, review gate, and off switch/u, "Automation prompt must return plain-English steps.");
assert.match(worker, /Do not send, post, deploy, delete, charge, or expose anything without approval/u, "Automation prompt must preserve safety boundaries.");
assert.match(worker, /analytics:\s*\{/u, "Analytics should have a worker prompt.");
assert.match(worker, /leads:\s*\{[\s\S]*Build the client base/u, "Clients page must have a dedicated prospect-builder worker.");
assert.match(worker, /createCrmProspectBuildout/u, "Clients worker must reuse the CRM prospect buildout instead of duplicating lead logic.");
assert.match(worker, /No fake contact details were generated/u, "Clients worker must not hallucinate contact details.");
assert.match(read("../app/js/command.js"), /client\\s\+base[\s\S]*consider[\s\S]*could\\s\+use/u, "Client-base prospect phrasing must route into CRM prospect buildout.");
assert.match(skipPages, /"settings"[\s\S]*"developer"[\s\S]*"activity"/u, "Only system/admin pages should skip page worker prompts.");
assert.doesNotMatch(skipPages, /"media"|"sites"|"content"|"assets"|"intelligence"|"vacation"|"phantomplay"/u, "Normal product pages must keep the AI page outcome prompt available.");
assert.match(worker, /fetch\("\/phantom-ai\/chat"/u, "Page outcome prompts must call the Phantom AI backend.");
assert.match(worker, /module_data: pageContextModules/u, "Backend page prompts must send page context modules.");
assert.match(worker, /currentTenantId/u, "Backend page prompts must carry tenant context.");
assert.match(worker, /AI backend thinking/u, "Page prompts must show a backend thinking state.");
assert.match(worker, /Phantom is asking the backend brain/u, "Thinking state should give visible, human feedback.");
assert.match(worker, /AI backend result/u, "Backend answer must render as the primary result.");
assert.match(worker, /Never say the work is queued/u, "Backend prompt must avoid confusing queued language.");
assert.match(worker, /Before we proceed, answer this:/u, "Blocking questions must use the requested phrasing.");
assert.match(worker, /button\.disabled = true/u, "Submitting a page prompt must disable the button while the backend runs.");
assert.match(worker, /data-page-worker-form/u, "Worker prompt form must be bindable.");
assert.match(worker, /opts\.notify/u, "Worker prompt should log/notify without executing external actions.");

assert.match(main, /import \{ pageWorkerHtml, mountPageWorkers \} from "\.\/pageworker\.js\?v=phantom-live-20260712-\d+"/u, "main.js must import the current page worker module.");
assert.match(main, /\$\{pageWorkerHtml\(key, def\)\}/u, "Workspace pages must mount the worker prompt.");
assert.match(main, /mountPageWorkers\(root, mediaOpts\(\)\)/u, "Workspace pages must bind worker prompt events.");
assert.match(main, /mountPageWorkers\(overlayRoot, mediaOpts\(\)\)/u, "Overlay pages must bind worker prompt events.");

assert.match(css, /\.page-worker\b/u, "Page worker styles must exist.");
assert.match(css, /\.page-worker-output\.is-thinking/u, "Backend thinking state must have visible styling.");
assert.match(css, /\.page-worker-backend-result/u, "Backend answer must have visible result styling.");
assert.match(css, /\.page-worker-output li::before/u, "Plain-English step bullets must be styled.");
assert.match(css, /\.page-worker-action-result/u, "Local page actions must have visible result styling.");
assert.match(index, /phantom-live-20260712-\d+/u, "Index cache id must exist for the app bundle.");

console.log("Page worker prompt checks passed.");
