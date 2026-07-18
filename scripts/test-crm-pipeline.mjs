import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* CRM regression: the live server-backed CRM is the ORG-SCOPED layer
   (/orgs/:orgId/crm/*) served from server/src/index.ts with its client in
   app/js/orgs.js and the Clients page in app/js/workspaces.js. The older
   tenant "pipeline" layer (/api/crm/*, app/js/crmpipeline.js,
   server/src/crm/crm-pipeline-store.ts) was superseded by it — those files
   remain on disk but nothing imports them and their routes are gone. This
   test asserts the architecture that actually runs. */

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

const files = {
  server: read("server/src/index.ts"),
  coreClient: read("app/js/store.js"),
  orgs: read("app/js/orgs.js"),
  workspaces: read("app/js/workspaces.js"),
  crmProspects: read("app/js/crmprospects.js"),
  staticServer: read("ops/admin-live/admin-static-server.mjs"),
  packageJson: read("package.json"),
};

const must = (source, pattern, message) => assert.match(source, pattern, message);

for (const route of [
  /app\.get\("\/orgs\/:orgId\/crm"/u,
  /app\.post\("\/orgs\/:orgId\/crm\/settings"/u,
  /app\.post\("\/orgs\/:orgId\/crm\/contacts"/u,
  /app\.post\("\/orgs\/:orgId\/crm\/pull"/u,
  /app\.patch\("\/orgs\/:orgId\/crm\/contacts\/:contactId"/u,
  /app\.delete\("\/orgs\/:orgId\/crm\/contacts\/:contactId"/u,
]) {
  must(files.server, route, `Org CRM server route missing: ${route}`);
}

must(files.staticServer, /urlPath\.startsWith\("\/orgs\/"\)/u, "Static server must proxy org CRM API routes.");

for (const exported of ["fetchOrgCrm", "createOrgCrmContact", "updateOrgCrmContact", "deleteOrgCrmContact", "pullOrgCrmContacts"]) {
  must(files.orgs, new RegExp(`export async function ${exported}`, "u"), `Org client API must export ${exported}.`);
}

must(files.workspaces, /function syncServerCrm\(ws, rerender\)/u, "Clients page must sync the server CRM board for database sessions.");
must(files.workspaces, /function crmPayload\(/u, "Clients page must normalize leads into the server CRM payload.");
must(files.workspaces, /updateOrgCrmContact\(lead\.id, crmPayload\(lead\)\)/u, "Clients page must persist lead changes to the org CRM.");
must(files.workspaces, /createOrgCrmContact\(crmPayload\(lead\)\)/u, "Manually captured contacts must persist to the org CRM.");
must(files.workspaces, /deleteOrgCrmContact\(id\)/u, "Removing a contact must delete the org CRM row.");
must(files.workspaces, /pullOrgCrmContacts\(pull\)/u, "The pull prompt must request server-side CRM candidates.");
must(files.workspaces, /data-lead-form/u, "Clients page must expose a visible prompt-to-CRM form.");
must(files.workspaces, /createProspectsFromPrompt\(prompt\)/u, "The Clients prompt must expand into local prospect lanes when no pull intent matches.");
must(files.crmProspects, /createCrmProspectBuildout/u, "CRM prospect builder must be shared for page-specific prompters.");
must(files.coreClient, /export function friendlyBackendError/u, "Shared client core must expose a friendly backend error formatter.");
must(files.packageJson, /test:crm-pipeline/u, "Root package must expose the CRM regression test.");

/* CRM upgrades: inline editor, follow-up reminders, owner/last-contact
   fields, deterministic client brief + suggested next action, file links,
   and a real-activity timeline. */
must(files.workspaces, /data-crm-edit-form/u, "Clients page must edit contacts through an inline form, not prompt() chains.");
must(files.workspaces, /<b>Owner<\/b>/u, "CRM detail must show the relationship owner.");
must(files.workspaces, /<b>Last contact<\/b>/u, "CRM detail must show the last contact date.");
must(files.workspaces, /<b>Follow-up<\/b>/u, "CRM detail must show the follow-up date.");
must(files.workspaces, /function crmFollowUpDue\(/u, "CRM must derive follow-up-due state from real dates.");
must(files.workspaces, /\["due", /u, "CRM filters must include a follow-up-due view.");
must(files.workspaces, /function crmClientBrief\(/u, "CRM must derive the client brief from real fields only.");
must(files.workspaces, /function crmSuggestedNext\(/u, "CRM must suggest a next action from pipeline stage rules.");
must(files.workspaces, /function crmTimelineFor\(/u, "CRM must derive the per-client timeline from real activity.");
must(files.workspaces, /"add-file"/u, "CRM must support attaching file links to a contact.");
must(files.workspaces, /"log-touch"/u, "CRM must let the owner log a contact touchpoint.");

const joined = `${files.server}\n${files.orgs}\n${files.workspaces}\n${files.crmProspects}`;
assert.doesNotMatch(joined, /provider_called:\s*true|outbound_action_executed:\s*true|public_exposure_changed:\s*true/iu, "CRM must not perform external/provider/public actions.");

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
const storeModule = await import(new URL("../app/js/store.js?v=phantom-live-20260717-18", import.meta.url));
assert.equal(
  storeModule.friendlyBackendError(401, "Missing or invalid Authorization bearer token.", { authMessage: "Sign in to load server-backed CRM." }),
  "Sign in to load server-backed CRM.",
  "Shared friendly error formatter must not leak raw bearer-token failures.",
);
assert.match(
  storeModule.friendlyBackendError(422, "Lead name is required.", { authMessage: "Sign in to load server-backed CRM." }),
  /Lead name is required/u,
  "Shared friendly error formatter must preserve non-auth validation messages.",
);
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
  product: "Org CRM server persistence + Clients page upgrades",
  routes: 6,
  stages: ["new", "follow-up", "proposal", "won", "lost"],
  serverBacked: true,
  externalActions: false,
}, null, 2));
