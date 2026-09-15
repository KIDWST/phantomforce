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
  connectionCenter: read("app/js/connection-center.js"),
  emailConnector: read("server/src/connectors/email-delivery-connector.ts"),
  workGraph: read("server/src/workforce/work-graph.ts"),
  actionContracts: read("packages/contracts/src/actions.ts"),
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
must(files.workspaces, /data-crm-account="\$\{esc\(ws\)\}"/u, "Relationships must expose the authenticated organization scope in the CRM shell.");
must(files.workspaces, /data-relationship-tab="leads"[\s\S]*data-relationship-tab="clients"[\s\S]*data-relationship-tab="followups"/u, "Leads, clients, and follow-ups must remain inside one Relationships destination.");
must(files.workspaces, /workspaceStorageSetItem\(CRM_VIEW_STORAGE_KEY/u, "The selected relationship view must persist in workspace-scoped storage.");
must(files.workspaces, /crmPreferences[\s\S]*pipelineName[\s\S]*defaultValue[\s\S]*followUpDays/u, "Each organization must own customizable CRM labels and defaults.");
must(files.workspaces, /data-crm-contact-form[\s\S]*name="email"[\s\S]*name="status"[\s\S]*name="due"[\s\S]*name="notes"/u, "The CRM must provide a complete contact editor instead of chained browser prompts.");
must(files.workspaces, /data-crm-import[\s\S]*parseRelationshipCsv/u, "The account CRM must support scoped CSV import.");
must(files.workspaces, /data-crm-export[\s\S]*exportRelationshipCsv/u, "The account CRM must support scoped CSV export.");
assert.doesNotMatch(files.workspaces, /prompt\("Contact name|prompt\("Company \/ brand/u, "Relationship creation and editing cannot use chained browser prompts.");
must(files.workspaces, /lead\.ws === ws && lead\.status !== "lost"/u, "Follow-up lists must be explicitly restricted to the active organization.");
must(files.workspaces, /Email queue & replies/u, "Follow-ups must expose the account email queue and reply stream inside Relationships.");
must(files.workspaces, /proposeWorkGraphAction/u, "CRM sends must enter the durable work graph.");
must(files.workspaces, /policy:\s*\{ surface: "external", reversible: false, requiresApproval: true \}/u, "Every CRM send must require owner approval.");
must(files.workspaces, /draft\.channel === "email" && consent === "opt-in"/u, "Only opted-in email drafts may enter the email executor.");
must(files.workspaces, /threadId: draft\.threadId \|\| undefined/u, "CRM reply sends must preserve provider threads.");
must(files.workspaces, /data-act="draft-reply"/u, "Verified provider replies must offer a reply-draft action.");
must(files.workspaces, /providerReceipts/u, "CRM status must count real provider receipts instead of a placeholder.");
must(files.connectionCenter, /emailExecution\?\.sendReady === true[\s\S]*trackingReady === true[\s\S]*replySyncReady === true/u, "Inbox status cannot claim connected until execution, tracking, and reply sync are ready.");
must(files.connectionCenter, /error\?\.status\) === 401 \|\| Number\(error\?\.status\) === 403[\s\S]*Sign in with an account-backed workspace/u, "CRM inbox setup must translate authorization failures into customer-facing language.");
must(files.emailConnector, /x-idempotency-key/u, "Provider submission must include a stable idempotency key.");
must(files.emailConnector, /timingSafeEqual/u, "Provider events must use timing-safe signature verification.");
must(files.workGraph, /recordWorkGraphEmailProviderEvent/u, "Work graph must durably record provider delivery and reply events.");
must(files.actionContracts, /EmailSendActionSchema[\s\S]*threadId: z\.string\(\)\.optional\(\)/u, "Email send contracts must support threaded replies.");
must(files.server, /app\.post\("\/api\/email\/provider\/events"/u, "A signed provider event endpoint is required.");

must(files.server, /sourceMode:\s*"research-required"/u, "Unfulfilled discovery must be recorded as research-required.");
must(files.server, /error:\s*"public_research_not_connected"/u, "Unavailable research must return a stable error code.");
must(files.server, /created:\s*0/u, "Unavailable research must create zero contacts.");
must(files.server, /contacts:\s*\[\]/u, "Unavailable research must return no contacts.");
must(files.server, /provider_called:\s*false/u, "Unavailable research must not claim a provider call.");
must(files.server, /outbound_action_executed:\s*false/u, "CRM routes must not send outbound actions.");
must(files.server, /public_exposure_changed:\s*false/u, "CRM routes must not change public exposure.");
must(files.server, /const existingBrain =[\s\S]*\.\.\.existingBrain[\s\S]*brain: updatedBrain/u, "CRM research commands must preserve each organization's saved customization.");
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
  emailExecution: "approval-bound-and-provider-verified",
}, null, 2));
