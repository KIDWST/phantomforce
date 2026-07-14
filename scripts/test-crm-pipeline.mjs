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
must(files.workspaces, /createServerCrmLead/u, "Clients page must create server CRM leads.");
must(files.workspaces, /updateServerCrmLead/u, "Clients page must update server CRM leads.");
must(files.pageworker, /persistCrmProspectLanes/u, "Clients page prompter must persist prospect lanes.");
must(files.pageworker, /persistCrmProspectLanes[\s\S]*signalCrmRefresh/u, "Clients page prompter must signal the board to refresh after server persistence.");
must(files.pageworker, /Server CRM saved the draft lanes/u, "Prompter result must report server CRM persistence.");
must(files.audit, /PERSIST-CRM-PIPELINE/u, "Structured audit must report CRM pipeline persistence.");
must(files.packageJson, /test:crm-pipeline/u, "Root package must expose the CRM pipeline regression test.");

const joined = `${files.store}\n${files.server}\n${files.client}\n${files.workspaces}\n${files.pageworker}`;
assert.doesNotMatch(joined, /provider_called:\s*true|outbound_action_executed:\s*true|public_exposure_changed:\s*true/iu, "CRM pipeline must not perform external/provider/public actions.");
assert.doesNotMatch(files.store, /fake email|fake phone|invent real/iu, "CRM store must not seed fake contact details.");

console.log(JSON.stringify({
  ok: true,
  product: "CRM pipeline server persistence",
  routes: 5,
  stages: ["new", "follow-up", "proposal", "won", "lost"],
  serverBacked: true,
  externalActions: false,
}, null, 2));
