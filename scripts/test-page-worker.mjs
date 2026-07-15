import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (file) => readFileSync(resolve(here, file), "utf8");

const worker = read("../app/js/pageworker.js");
const main = read("../app/js/main.js");
const command = read("../app/js/command.js");
const css = read("../app/phantom.css");
const index = read("../app/index.html");
const skipPages = worker.match(/const SKIP_PAGES = new Set\(\[([\s\S]*?)\]\);/u)?.[1] || "";

assert.match(worker, /automation:\s*\{[\s\S]*Enter your automation here and we’ll go through what we can do for you/u, "Automation page must have the requested worker prompt.");
assert.match(worker, /Infer trigger, condition, action, review gate, and off switch/u, "Automation prompt must return plain-English steps.");
assert.match(worker, /Do not send, post, deploy, delete, charge, or expose anything without approval/u, "Automation prompt must preserve safety boundaries.");
assert.match(worker, /analytics:\s*\{/u, "Analytics should have a worker prompt.");
assert.match(worker, /money:\s*\{[\s\S]*Prompt the money question/u, "Accounting should have a page-specific money prompter.");
assert.match(worker, /memory:\s*\{[\s\S]*Prompt the memory check/u, "Memory should have a page-specific memory prompter.");
assert.match(worker, /approvals:\s*\{[\s\S]*Prompt the risk review/u, "Approvals should have a page-specific risk prompter.");
assert.match(worker, /workforce:\s*\{[\s\S]*Prompt the worker route/u, "Workforce should have a page-specific worker prompter.");
assert.match(worker, /money:\s*\[[\s\S]*never invent revenue or charges/u, "Accounting fallback must separate real records from missing connector data.");
assert.match(worker, /memory:\s*\[[\s\S]*smallest durable memory update/u, "Memory fallback must avoid saving every chat line.");
assert.match(worker, /approvals:\s*\[[\s\S]*Never execute the underlying action/u, "Approvals fallback must not execute from the prompt result.");
assert.match(worker, /workforce:\s*\[[\s\S]*proof that worker must return/u, "Workforce fallback must define proof requirements.");
assert.match(worker, /phantomplay:\s*\[[\s\S]*same-workspace\/private-room boundaries/u, "PhantomPlay fallback must preserve private-room boundaries.");
assert.match(worker, /leads:\s*\{[\s\S]*Build the prospect list/u, "Leads page must have a dedicated prospect-builder worker.");
assert.match(worker, /createCrmProspectBuildout/u, "Leads worker must reuse the CRM prospect buildout instead of duplicating lead logic.");
assert.match(worker, /CRM_PAGE_ACTION_VERB[\s\S]*find[\s\S]*discover[\s\S]*source[\s\S]*identify/u, "Leads page prompt must understand find/discover/source client requests.");
assert.match(worker, /CRM_PAGE_AUDIENCE[\s\S]*gyms\?[\s\S]*coaches\?[\s\S]*service compan/u, "Leads page prompt must understand real prospect categories, not only the word CRM.");
assert.match(worker, /runPageAction\(pageId, prompt\)[\s\S]*renderThinking\(out, pageId, prompt, pageAction\)[\s\S]*askBackendForPageOutcome/u, "Clients CRM creation must happen before the slower backend report.");
assert.match(worker, /currentWorkerOutput/u, "Page worker output must survive the Leads page repaint after CRM cards are saved.");
assert.match(worker, /No fake contact details were generated/u, "Leads worker must not hallucinate contact details.");
assert.match(command, /client\\s\+base[\s\S]*consider[\s\S]*could\\s\+use/u, "Client-base prospect phrasing must route into CRM prospect buildout.");
assert.match(command, /find\|add\|search\|discover\|research\|scout\|source\|identify/u, "Global CRM prospect routing must understand find/add/discover client language.");
assert.match(skipPages, /"settings"[\s\S]*"developer"[\s\S]*"activity"/u, "System/admin pages should skip page worker prompts.");
assert.match(skipPages, /"sites"[\s\S]*"media"[\s\S]*"content"/u, "Native prompt-first surfaces must not duplicate the top page worker prompt.");
assert.doesNotMatch(skipPages, /"assets"|"intelligence"|"vacation"|"phantomplay"/u, "Pages without a main AI prompter should keep the page outcome prompt available.");
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

assert.match(main, /import \{ pageWorkerHtml, mountPageWorkers \} from "\.\/pageworker\.js\?v=phantom-live-\d{8}-\d+"/u, "main.js must import the current page worker module.");
assert.match(main, /\$\{pageWorkerHtml\(key, def\)\}/u, "Workspace pages must mount the worker prompt.");
assert.match(main, /mountPageWorkers\(root, mediaOpts\(\)\)/u, "Workspace pages must bind worker prompt events.");
assert.match(main, /mountPageWorkers\(overlayRoot, mediaOpts\(\)\)/u, "Overlay pages must bind worker prompt events.");

assert.match(css, /\.page-worker\b/u, "Page worker styles must exist.");
assert.match(css, /\.page-worker-output\.is-thinking/u, "Backend thinking state must have visible styling.");
assert.match(css, /\.page-worker-backend-result/u, "Backend answer must have visible result styling.");
assert.match(css, /\.page-worker-output li::before/u, "Plain-English step bullets must be styled.");
assert.match(css, /\.page-worker-action-result/u, "Local page actions must have visible result styling.");
assert.match(index, /phantom-live-\d{8}-\d+/u, "Index cache id must exist for the app bundle.");

function installMemoryStorage(name) {
  if (globalThis[name]) return;
  const storage = new Map();
  globalThis[name] = {
    getItem: (key) => storage.has(String(key)) ? storage.get(String(key)) : null,
    setItem: (key, value) => { storage.set(String(key), String(value)); },
    removeItem: (key) => { storage.delete(String(key)); },
    clear: () => { storage.clear(); },
  };
}

installMemoryStorage("localStorage");
installMemoryStorage("sessionStorage");

const pageWorkerBuildId = worker.match(/store\.js\?v=([^"']+)/)?.[1] || "";
const pageWorkerQuery = pageWorkerBuildId ? `?v=${pageWorkerBuildId}` : "";
const { runPageAction } = await import(`../app/js/pageworker.js${pageWorkerQuery}`);
const { ctx, store } = await import(`../app/js/store.js${pageWorkerQuery}`);

ctx.session = { role: "admin", name: "Jordan", ws: "phantomforce" };
store.state.leads = [];
store.state.tasks = [];
store.state.activity = [];

let fetchCalled = false;
globalThis.fetch = async () => {
  fetchCalled = true;
  throw new Error("Leads page CRM local action must not require backend fetch.");
};

const pageAction = runPageAction(
  "leads",
  "find and add clients who could use PhantomForce: gyms, schools, creators, service companies, and warm prospects",
);

assert.equal(fetchCalled, false, "Leads page CRM local action should not call the backend.");
assert.equal(pageAction?.type, "prospect-buildout", "Leads page should execute the CRM prospect buildout action.");
assert.equal(pageAction?.refreshWorkspace, true, "Leads page should request a workspace refresh after CRM cards are created.");
assert.ok(store.state.leads.length >= 4, "Leads page prompt should create multiple CRM prospect lanes.");
assert.ok(store.state.leads.some((lead) => /creator/i.test(`${lead.name} ${lead.notes}`)), "Leads page prompt should include creator prospects.");
assert.ok(store.state.leads.some((lead) => /school|education/i.test(`${lead.name} ${lead.notes}`)), "Leads page prompt should include school prospects.");
assert.ok(store.state.leads.some((lead) => /local service|gym|service/i.test(`${lead.name} ${lead.notes}`)), "Leads page prompt should include local service or gym prospects.");
assert.ok(store.state.leads.every((lead) => /No external outreach|contact details|live relationship claims/i.test(lead.notes)), "CRM cards must not invent live contacts or outreach claims.");
assert.ok(store.state.tasks.some((task) => /Qualify PhantomForce CRM prospect map/i.test(task.title)), "Leads page prompt should create a qualification task.");
assert.match(pageAction.summary, /ready in Leads/i, "Leads page action should report visible CRM results.");

console.log("Page worker prompt checks passed.");
