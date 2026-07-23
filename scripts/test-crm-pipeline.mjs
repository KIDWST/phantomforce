import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const must = (source, pattern, message) => assert.match(source, pattern, message);

const files = {
  legacyStore: read("server/src/crm/crm-pipeline-store.ts"),
  server: read("server/src/index.ts"),
  coreClient: read("app/js/store.js"),
  orgClient: read("app/js/orgs.js"),
  workspaces: read("app/js/workspaces.js"),
  staticServer: read("ops/admin-live/admin-static-server.mjs"),
  packageJson: read("package.json"),
};

// The legacy JSON pipeline remains an internal managed-growth seam. The visible
// Clients surface must use the organization-scoped database CRM instead.
must(files.legacyStore, /CrmPipelineDocument/u, "Internal CRM store must define a durable document.");
must(files.legacyStore, /"new" \| "follow-up" \| "proposal" \| "won" \| "lost"/u, "CRM statuses must support board lanes.");
must(files.server, /app\.get\("\/orgs\/:orgId\/crm"/u, "Organization CRM read route is required.");
must(files.server, /app\.post\("\/orgs\/:orgId\/crm\/settings"/u, "Organization CRM settings route is required.");
must(files.server, /app\.post\("\/orgs\/:orgId\/crm\/contacts"/u, "Organization CRM create route is required.");
must(files.server, /app\.post\("\/orgs\/:orgId\/crm\/pull"/u, "Organization CRM research route is required.");
must(files.server, /app\.patch\("\/orgs\/:orgId\/crm\/contacts\/:contactId"/u, "Organization CRM update route is required.");
must(files.server, /app\.delete\("\/orgs\/:orgId\/crm\/contacts\/:contactId"/u, "Organization CRM delete route is required.");
must(files.server, /app\.post\("\/orgs\/:orgId\/crm\/contacts\/merge\/preview"/u, "Organization CRM merge preview route is required.");
must(files.server, /app\.post\("\/orgs\/:orgId\/crm\/contacts\/merge\/apply"/u, "Organization CRM merge apply route is required.");
must(files.server, /app\.post\("\/orgs\/:orgId\/crm\/merges\/:mergeId\/rollback"/u, "Organization CRM merge rollback route is required.");
must(files.server, /app\.get\("\/orgs\/:orgId\/crm\/contacts\/:contactId\/history"/u, "Organization CRM stage history route is required.");
must(files.server, /crm_merge_preview_stale/u, "CRM merge must reject stale previews.");
must(files.server, /crm_merge_target_changed/u, "CRM rollback must not overwrite contact edits made after a merge.");
must(files.server, /crm_stage_changed/u, "CRM status and stage changes must be audited.");
must(files.staticServer, /urlPath\.startsWith\("\/orgs\/"\)/u, "Static server must proxy organization API routes.");

for (const exported of ["fetchOrgCrm", "createOrgCrmContact", "pullOrgCrmContacts", "updateOrgCrmContact", "deleteOrgCrmContact"]) {
  must(files.orgClient, new RegExp(`export async function ${exported}`, "u"), `Organization client must export ${exported}.`);
}
must(files.workspaces, /fetchOrgCrm/u, "Clients page must read the organization CRM.");
must(files.workspaces, /createOrgCrmContact/u, "Clients page must support manual real-contact capture.");
must(files.workspaces, /pullOrgCrmContacts/u, "Clients page must route discovery requests through the server.");
must(files.workspaces, /updateOrgCrmContact/u, "Clients page must update organization contacts.");
must(files.workspaces, /deleteOrgCrmContact/u, "Clients page must delete organization contacts.");
must(files.workspaces, /function syncServerCrm/u, "Clients page must synchronize database contacts.");
must(files.workspaces, /function crmPullIntent/u, "Clients page must recognize natural discovery requests.");
must(files.workspaces, /No placeholder or invented contacts were added/u, "Clients page must disclose that unavailable research creates zero placeholders.");
must(files.workspaces, /capture a real contact manually/u, "Manual real-contact capture must remain available.");

must(files.server, /sourceMode:\s*"research-required"/u, "Unfulfilled discovery must be recorded as research-required.");
must(files.server, /error:\s*"public_research_not_connected"/u, "Unavailable research must return a stable error code.");
must(files.server, /created:\s*0/u, "Unavailable research must create zero contacts.");
must(files.server, /contacts:\s*\[\]/u, "Unavailable research must return no contacts.");
must(files.server, /provider_called:\s*false/u, "Unavailable research must not claim a provider call.");
must(files.server, /outbound_action_executed:\s*false/u, "CRM routes must not send outbound actions.");
must(files.server, /public_exposure_changed:\s*false/u, "CRM routes must not change public exposure.");
must(files.coreClient, /export function friendlyBackendError/u, "Shared client core must expose a friendly backend error formatter.");
must(files.packageJson, /test:crm-pipeline/u, "Root package must expose the CRM regression test.");

const truthSurface = `${files.server}\n${files.workspaces}`;
assert.doesNotMatch(truthSurface, /CRM_PULL_ARCHETYPES|crmPullPlan|LEAD_ARCHETYPES|createProspectsFromPrompt/u, "Synthetic contact generators must not exist in the active CRM path.");
assert.doesNotMatch(truthSurface, /\.example\.local/u, "The active CRM path must not generate placeholder websites or emails.");
assert.doesNotMatch(truthSurface, /provider_called:\s*true|outbound_action_executed:\s*true|public_exposure_changed:\s*true/iu, "CRM discovery must not perform unverified external actions.");

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

const storeModule = await import(new URL("../app/js/store.js?v=crm-truth-test", import.meta.url));
assert.equal(
  storeModule.friendlyBackendError(401, "Missing or invalid Authorization bearer token.", { authMessage: "Sign in to load server-backed CRM." }),
  "Sign in to load server-backed CRM.",
  "Shared friendly error formatter must not leak raw bearer-token failures.",
);
assert.equal(
  storeModule.friendlyBackendError(422, "Lead name is required.", { authMessage: "Sign in to load server-backed CRM." }),
  "Request failed (422): Lead name is required.",
  "Shared friendly error formatter must preserve validation messages.",
);

console.log(JSON.stringify({
  ok: true,
  product: "Organization CRM truth guard",
  lifecycle: ["create", "read", "update", "delete"],
  syntheticContacts: false,
  externalActions: false,
}, null, 2));
