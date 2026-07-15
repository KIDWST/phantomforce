import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

const files = {
  store: read("server/src/crm/crm-pipeline-store.ts"),
  server: read("server/src/index.ts"),
  client: read("app/js/crmpipeline.js"),
  workspaces: read("app/js/workspaces.js"),
  pageworker: read("app/js/pageworker.js"),
  crmProspects: read("app/js/crmprospects.js"),
  staticServer: read("ops/admin-live/admin-static-server.mjs"),
  audit: read("scripts/audit-client-setup-data-model.mjs"),
  packageJson: read("package.json"),
};

const must = (source, pattern, message) => assert.match(source, pattern, message);

must(files.store, /CrmPipelineDocument/u, "CRM store must define a durable document.");
must(files.store, /CrmLeadStatus/u, "CRM store must define lead statuses.");
must(files.store, /"new" \| "follow-up" \| "proposal" \| "won" \| "lost"/u, "CRM statuses must support the board lanes.");
must(files.store, /upsertCrmProspectLanes/u, "CRM store must upsert prospect lanes.");
must(files.store, /serverBacked:\s*true/u, "CRM leads must be marked server-backed after normalization.");

for (const route of [
  /app\.get\("\/api\/crm\/leads"/u,
  /app\.post\("\/api\/crm\/leads"/u,
  /app\.post\("\/api\/crm\/prospect-lanes"/u,
  /app\.post\("\/api\/crm\/leads\/:leadId"/u,
  /app\.delete\("\/api\/crm\/leads\/:leadId"/u,
]) {
  must(files.server, route, `Server route missing: ${route}`);
}

must(files.server, /provider_called:\s*false/u, "CRM routes must not claim provider calls.");
must(files.server, /outbound_action_executed:\s*false/u, "CRM routes must not send outbound actions.");
must(files.server, /public_exposure_changed:\s*false/u, "CRM routes must not change public exposure.");
must(files.staticServer, /urlPath\.startsWith\("\/api\/crm"\)/u, "Static server must proxy CRM API routes.");

for (const exported of ["loadCrmLeads", "createCrmLead", "updateCrmLead", "deleteCrmLead", "persistCrmProspectLanes"]) {
  must(files.client, new RegExp(`export async function ${exported}`, "u"), `Client API must export ${exported}.`);
}
for (const exported of ["signalCrmRefresh", "crmRefreshSignal"]) {
  must(files.client, new RegExp(`export function ${exported}`, "u"), `Client API must export ${exported}.`);
}
must(files.client, /CRM_REFRESH_SIGNAL_KEY/u, "CRM client must expose a refresh signal key for cross-page CRM updates.");

must(files.workspaces, /Server CRM saved/u, "Clients page must display server CRM state.");
must(files.workspaces, /loadCrmLeads/u, "Clients page must load server CRM leads.");
must(files.workspaces, /crmRefreshSignal[\s\S]*refreshRequested[\s\S]*loadCrmLeads/u, "Clients page must reload stale server CRM snapshots after a prompter save.");
must(files.workspaces, /function visibleCrmLeads\(serverBacked\)/u, "Clients page must merge local prompt drafts into the visible server-backed board.");
must(files.workspaces, /localCrmPromptDrafts\(\)[\s\S]*source === "Phantom AI prospect map"/u, "Clients page must keep prompt-created CRM lanes visible when server persistence is delayed.");
must(files.workspaces, /local draft[\s\S]*awaiting server save/u, "Server-backed Clients page must disclose local draft lanes awaiting server save.");
must(files.workspaces, /writeError/u, "Clients page must track CRM write failures separately from server connectivity state.");
must(files.workspaces, /createServerCrmLead/u, "Clients page must create server CRM leads.");
must(files.workspaces, /updateServerCrmLead/u, "Clients page must update server CRM leads.");
must(files.workspaces, /serverBacked && crmRuntime\.canWrite && !lead\.localDraftOnly[\s\S]*updateServerCrmLead\(lead\.id, patch\)/u, "Local draft CRM lanes must not update a missing server row.");
must(files.workspaces, /serverBacked && crmRuntime\.canWrite && !l\.localDraftOnly[\s\S]*deleteServerCrmLead\(id\)/u, "Local draft CRM lanes must not delete a missing server row.");
must(files.pageworker, /persistCrmProspectLanes/u, "Clients page prompter must persist prospect lanes.");
must(files.pageworker, /persistCrmProspectLanes[\s\S]*signalCrmRefresh/u, "Clients page prompter must signal the board to refresh after server persistence.");
must(files.pageworker, /Server CRM saved the draft lanes/u, "Prompter result must report server CRM persistence.");
must(files.crmProspects, /createCrmProspectBuildout/u, "CRM prospect builder must be shared for page-specific prompters.");
must(files.workspaces, /data-client-crm-form/u, "Clients page must expose a visible prompt-to-CRM form.");
must(files.workspaces, /persistCrmProspectLanes\(lanes, rawPrompt\)/u, "Visible Clients page prompt must persist CRM lanes when the server session can write.");
must(files.workspaces, /ready in the New column/u, "Visible Clients page prompt must tell the user where the CRM cards appeared.");
must(files.workspaces, /Server save failed, so the draft lanes stay visible locally/u, "Visible Clients page prompt must not report total failure when local CRM lane creation succeeded.");
must(files.workspaces, /catch \(error\) \{[\s\S]*crmRuntime\.writeError = error\?\.message \|\| "Server CRM save failed\.";[\s\S]*persistenceNote = "Server save failed, so the draft lanes stay visible locally\."/u, "Visible Clients page prompt must keep server CRM mode active when only prompt persistence fails.");
must(files.workspaces, /No outreach, uploads, public exposure, or fake contact details/u, "Visible Clients page prompt must disclose CRM-only safe behavior.");
must(files.audit, /PERSIST-CRM-PIPELINE/u, "Structured audit must report CRM pipeline persistence.");
must(files.packageJson, /test:crm-pipeline/u, "Root package must expose the CRM pipeline regression test.");

const joined = `${files.store}\n${files.server}\n${files.client}\n${files.workspaces}\n${files.pageworker}`;
assert.doesNotMatch(joined, /provider_called:\s*true|outbound_action_executed:\s*true|public_exposure_changed:\s*true/iu, "CRM pipeline must not perform external/provider/public actions.");
assert.doesNotMatch(files.store, /fake email|fake phone|invent real/iu, "CRM store must not seed fake contact details.");

globalThis.localStorage = {
  data: new Map(),
  getItem(key) { return this.data.has(key) ? this.data.get(key) : null; },
  setItem(key, value) { this.data.set(key, String(value)); },
  removeItem(key) { this.data.delete(key); },
};
globalThis.window = { dispatchEvent() {} };
globalThis.CustomEvent = class CustomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
  }
};

const crmProspectModule = await import(new URL("../app/js/crmprospects.js?v=crm-pipeline-runtime-test", import.meta.url));
const storeModule = await import(new URL("../app/js/store.js?v=phantom-live-20260714-258", import.meta.url));
const screenshotStylePrompt = "update our clients crm with clients who you think would be interested in phantomforce. your phantom workforce.. creators, businesses, schools, everyone. Just add to our CRM/clients tab";
assert.equal(crmProspectModule.isCrmProspectBuildout(screenshotStylePrompt), true, "Clients page prompt must recognize natural CRM buildout requests.");
const requestedSegments = crmProspectModule.requestedProspectSegments(screenshotStylePrompt).map((segment) => segment.id);
assert.deepEqual(requestedSegments, [
  "creators-media",
  "local-service",
  "schools-education",
  "professional-services",
  "sports-clubs",
  "ops-heavy-teams",
  "warm-network",
], "Clients page prompt must expand 'everyone' into every PhantomForce prospect lane.");
const buildout = crmProspectModule.createCrmProspectBuildout(screenshotStylePrompt);
assert.equal(buildout.created.length, requestedSegments.length, "CRM prospect buildout must create a card for every requested segment.");
assert.equal(storeModule.store.state.leads.length, requestedSegments.length, "CRM prospect buildout must add the cards to the visible local CRM state.");
assert.ok(buildout.task?.title.includes("Qualify PhantomForce CRM prospect map"), "CRM prospect buildout must create the follow-up qualification task.");
assert.ok(buildout.leads.every((lead) => lead.status === "new" && lead.source === "Phantom AI prospect map"), "Prompt-created CRM cards must land in the New column with the safe prospect-map source.");
assert.ok(buildout.leads.some((lead) => /Creators/.test(lead.company)), "Prompt-created CRM cards must include creators/media.");
assert.ok(buildout.leads.some((lead) => /Schools/.test(lead.company)), "Prompt-created CRM cards must include schools/education.");
assert.ok(buildout.leads.every((lead) => /No external outreach, contact details, or live relationship claims were added/u.test(lead.notes)), "Prompt-created CRM cards must disclose safe CRM-only behavior.");

console.log(JSON.stringify({
  ok: true,
  product: "CRM pipeline server persistence",
  routes: 5,
  stages: ["new", "follow-up", "proposal", "won", "lost"],
  serverBacked: true,
  externalActions: false,
}, null, 2));
