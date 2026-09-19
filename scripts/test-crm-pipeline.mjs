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
  crmAutomation: read("server/src/crm/crm-growth-automation.ts"),
  publicResearch: read("server/src/crm/public-prospect-research.ts"),
  organizationPulse: read("server/src/phantom-ai/organization-pulse.ts"),
  automationEngine: read("server/src/phantom-ai/automation-engine.ts"),
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
must(files.workspaces, /function crmSourceRecordUrl[\s\S]*openstreetmap/u, "Sourced CRM records must expose their public evidence link.");
must(files.workspaces, /Research proof[\s\S]*Open directory record[\s\S]*Open official-site evidence/u, "The selected relationship must show both directory and official-site research proof when available.");
must(files.workspaces, /wedding-ecosystem[\s\S]*Weddings[\s\S]*coaches-programs[\s\S]*Coaches/u, "Wedding and coaching prospects must be first-class CRM segments.");
must(files.workspaces, /capture a real contact manually/u, "Manual real-contact capture must remain available.");
must(files.workspaces, /data-crm-account="\$\{esc\(ws\)\}"/u, "Relationships must expose the authenticated organization scope in the CRM shell.");
must(files.workspaces, /data-relationship-tab="leads"[\s\S]*data-relationship-tab="clients"[\s\S]*data-relationship-tab="followups"/u, "Leads, clients, and follow-ups must remain inside one Relationships destination.");
must(files.workspaces, /function isFollowUpRelationship[\s\S]*untouchedResearchProspect[\s\S]*records\.filter\(isFollowUpRelationship\)/u, "Research review dates must not inflate the human follow-up queue before a real touch or explicit follow-up stage.");
must(files.workspaces, /function crmEmailPermissionReady[\s\S]*public-business[\s\S]*email:published-business/u, "The permission-ready count must follow the account's saved outreach policy and exclusions.");
must(files.workspaces, /workspaceStorageSetItem\(CRM_VIEW_STORAGE_KEY/u, "The selected relationship view must persist in workspace-scoped storage.");
must(files.workspaces, /crmPreferences[\s\S]*pipelineName[\s\S]*defaultValue[\s\S]*followUpDays/u, "Each organization must own customizable CRM labels and defaults.");
must(files.workspaces, /data-crm-contact-form[\s\S]*name="email"[\s\S]*name="status"[\s\S]*name="due"[\s\S]*name="notes"/u, "The CRM must provide a complete contact editor instead of chained browser prompts.");
must(files.workspaces, /data-crm-import[\s\S]*parseRelationshipCsv/u, "The account CRM must support scoped CSV import.");
must(files.workspaces, /data-crm-export[\s\S]*exportRelationshipCsv/u, "The account CRM must support scoped CSV export.");
assert.doesNotMatch(files.workspaces, /prompt\("Contact name|prompt\("Company \/ brand/u, "Relationship creation and editing cannot use chained browser prompts.");
must(files.workspaces, /lead\.ws === ws && isFollowUpRelationship\(lead\)/u, "Follow-up lists must be explicitly restricted to the active organization and actionable relationships.");
must(files.workspaces, /Show email activity details/u, "Follow-ups must expose the account email queue and reply stream inside Relationships.");
must(files.workspaces, /proposeWorkGraphAction/u, "CRM sends must enter the durable work graph.");
must(files.orgClient, /export async function fetchWorkGraphActions/u, "The browser must be able to rebuild the email queue from tenant-scoped server actions.");
must(files.server, /app\.get\("\/api\/workforce\/actions"[\s\S]*document_version[\s\S]*checksum/u, "The work graph must expose an authenticated durable action listing.");
must(files.workspaces, /fetchWorkGraphActions\(\{ type: "email\.send", limit: 200 \}\)[\s\S]*serverBacked: true/u, "Relationships must hydrate server-backed email history after refresh.");
must(files.workspaces, /fetchWorkGraphActions\(\{ type: "email\.draft", limit: 200 \}\)[\s\S]*preparedByPhantomBot: isPreparedDraft/u, "Relationships must hydrate PhantomBot-prepared email drafts into the account queue.");
must(files.workspaces, /policy:\s*\{ surface: "external", reversible: false, requiresApproval: true \}/u, "Every CRM send must require owner approval.");
must(files.workspaces, /draft\.channel === "email" && consent === "opt-in"/u, "Only opted-in email drafts may enter the email executor.");
must(files.workspaces, /threadId: draft\.threadId \|\| undefined/u, "CRM reply sends must preserve provider threads.");
must(files.workspaces, /replyToMessageId: draft\.replyToMessageId \|\| undefined/u, "CRM reply sends must preserve the provider message being answered.");
must(files.workspaces, /crmContactId: lead\.id[\s\S]*clientDraftId: draft\.id/u, "Queued emails must preserve CRM contact and client-draft identity for cross-device recovery.");
must(files.workspaces, /data-act="draft-reply"/u, "Verified provider replies must offer a reply-draft action.");
must(files.workspaces, /Server record · immutable history/u, "Hydrated email history must not pretend it can be deleted from one browser.");
must(files.workspaces, /providerReceipts/u, "CRM status must count real provider receipts instead of a placeholder.");
must(files.connectionCenter, /emailExecution\?\.sendReady === true[\s\S]*trackingReady === true[\s\S]*replySyncReady === true/u, "Inbox status cannot claim connected until execution, tracking, and reply sync are ready.");
must(files.connectionCenter, /error\?\.status\) === 401 \|\| Number\(error\?\.status\) === 403[\s\S]*Sign in with an account-backed workspace/u, "CRM inbox setup must translate authorization failures into customer-facing language.");
must(files.connectionCenter, /available && executionReady[\s\S]*"configuration_required"/u, "A completed inbox check must resolve to an actionable state instead of remaining stuck on checking.");
must(files.connectionCenter, /TimeoutError[\s\S]*AbortError[\s\S]*AbortSignal\.timeout\(4_000\)/u, "Inbox status checks must time out into a recoverable state instead of waiting forever.");
assert.doesNotMatch(files.connectionCenter, /connectionState\.emailExecution\?\.reason \|\| connectionState\.error/u, "CRM status must not expose deployment configuration details as customer copy.");
must(files.workspaces, /setupBlockerCount = autopilotRunning \? 0 : Math\.max\(autopilotBlockers\.length, emailConnected \? 0 : 1\)/u, "Disconnected inbox automation must never claim zero setup blockers.");
must(files.workspaces, /emailChecking = crmEmailUi\.state === "checking" && crmEmailUi\.loading/u, "Checking copy must only appear while an inbox request is actively running.");
must(files.workspaces, /4_500[\s\S]*Promise\.race\(\[getEmailConnectionSnapshot\(\), statusFallback\]\)[\s\S]*window\.clearTimeout/u, "Relationships must independently recover when an inbox status request never settles.");
must(files.emailConnector, /x-idempotency-key/u, "Provider submission must include a stable idempotency key.");
must(files.emailConnector, /timingSafeEqual/u, "Provider events must use timing-safe signature verification.");
must(files.workGraph, /recordWorkGraphEmailProviderEvent/u, "Work graph must durably record provider delivery and reply events.");
must(files.workGraph, /providerReceipt\.provider !== options\.event\.provider[\s\S]*email_provider_mismatch/u, "Provider events must match the executor that produced the original receipt.");
must(files.actionContracts, /EmailSendActionSchema[\s\S]*threadId: z\.string\(\)\.max\(300\)\.optional\(\)[\s\S]*replyToMessageId[\s\S]*crmContactId[\s\S]*clientDraftId/u, "Email send contracts must support threaded, CRM-linked, cross-device replies.");
must(files.actionContracts, /EmailDraftActionSchema[\s\S]*crmContactId: z\.string\(\)\.max\(120\)\.optional/u, "Prepared CRM drafts must carry explicit contact identity without fabricating a provider thread.");
must(files.server, /app\.post\("\/api\/email\/provider\/events"/u, "A signed provider event endpoint is required.");
must(files.server, /recordWorkGraphEmailProviderEvent[\s\S]*synchronizeCrmOutreachOutcomesForOrganization[\s\S]*crm_sync/u, "Verified provider events must synchronize CRM outcomes immediately and report deferred database work truthfully.");
must(files.crmAutomation, /email:published-business/u, "Outreach prep must require a published business email tag.");
must(files.crmAutomation, /consent:denied[\s\S]*do-not-contact[\s\S]*unsubscribed[\s\S]*email:guessed/u, "Outreach prep must exclude denied, opted-out, and guessed addresses.");
must(files.crmAutomation, /type:\s*"email\.draft"[\s\S]*requiresApproval:\s*true/u, "PhantomBot CRM automation must create approval-bound drafts only.");
must(files.crmAutomation, /autopilotBlockers[\s\S]*senderPostalAddress[\s\S]*sendReady[\s\S]*trackingReady[\s\S]*replySyncReady/u, "Autopilot must stop before sending when identity, postal address, inbox, or signed provider events are missing.");
must(files.crmAutomation, /isValidBusinessPostalAddress[\s\S]*address\.length >= 12[\s\S]*\\d/u, "A city-only postal entry must not unlock commercial sending.");
must(files.crmAutomation, /This is a business introduction[\s\S]*reply “unsubscribe”/u, "Automatic commercial outreach must include disclosure and a plain opt-out path.");
must(files.crmAutomation, /type:\s*"email\.send"[\s\S]*system:crm-standing-approval[\s\S]*providerReceipt/u, "Exception-only autopilot must use a recorded standing policy and count only verified provider receipts.");
must(files.crmAutomation, /outreach:replied[\s\S]*automatic sequence[\s\S]*outreach:bounced[\s\S]*do-not-contact/u, "Reply and bounce outcomes must stop the automatic sequence.");
must(files.crmAutomation, /unsubscribe\|remove me\|stop emailing\|do not contact[\s\S]*unsubscribed[\s\S]*do-not-contact[\s\S]*suppressed immediately/u, "Opt-out replies must immediately suppress the address and stop outreach.");
must(files.automationEngine, /id:\s*"crm-outreach-autopilot"[\s\S]*cadence:\s*"hourly"[\s\S]*external_action:\s*true/u, "The CRM outcome loop must run hourly and disclose that it may execute an external action.");
must(files.workspaces, /Autopilot running — only exceptions need you[\s\S]*email sent[\s\S]*follow-up needed[\s\S]*replies/u, "Relationships must default to the outcome-only operator view.");
must(files.workspaces, /AUTOMATION AUDIT TRAIL[\s\S]*Show email activity details/u, "Detailed email activity must remain available in a collapsed audit trail.");
must(files.workspaces, /function crmContactEmailTrail[\s\S]*SERVER EMAIL HISTORY[\s\S]*providerReceipt[\s\S]*Open full email queue/u,
  "Every selected relationship must expose its server-backed email history and provider proof in context.");
must(files.workspaces, /providerReplies[\s\S]*verifiedEmailCount[\s\S]*verifiedReplyCount[\s\S]*email sent[\s\S]*replies/u,
  "Relationship outcome totals must reconcile all hydrated provider receipts, not only autopilot aggregates.");
must(files.workspaces, /name="autopilotMaxFollowUps"[\s\S]*None[\s\S]*2 follow-ups[\s\S]*maxFollowUps: Math\.max\(0, Math\.min\(2/u,
  "Each account must control a bounded zero-to-two automatic follow-up sequence.");
must(files.crmAutomation, /function completedFollowUpCount[\s\S]*outreach:followup-[\s\S]*crmFollowUpSequence/u,
  "Automatic follow-ups must advance through durable per-contact sequence markers.");
must(files.crmAutomation, /executionAttempted: false, submittedNow: false[\s\S]*submittedNow: !hadProviderReceipt/u,
  "An idempotent replay of a completed email action cannot be counted as a fresh provider attempt or send.");
must(files.crmAutomation, /latestProviderReplyContext[\s\S]*threadId: prior\.threadId[\s\S]*replyToMessageId: prior\.messageId/u,
  "Automatic follow-ups must use verified provider thread lineage instead of an internal CRM placeholder.");
assert.doesNotMatch(files.crmAutomation, /threadId:\s*`crm-contact:/u, "CRM contact identity must never be sent to Gmail or Outlook as a provider thread ID.");
must(files.organizationPulse, /readCrmIntelligence[\s\S]*Live account CRM/u, "PhantomBot workspace context must include tenant-scoped CRM intelligence.");

must(files.server, /researchPublicProspects\(\{ \.\.\.parsed\.data, excludeSourceIds: \[\.\.\.existingSourceIds\] \}\)/u, "CRM pulls must use the real public-organization research adapter and advance past persisted directory sources.");
must(files.server, /sourceMode:\s*"public-research"/u, "Successful public research must be recorded in the account-scoped CRM settings.");
must(files.server, /sourceMode:\s*"research-required"/u, "Failed public research must remain actionable in the account-scoped CRM settings.");
must(files.server, /error:\s*"public_research_temporarily_unavailable"/u, "Unavailable research must return a stable retryable error code.");
must(files.server, /created:\s*0/u, "Unavailable research must create zero contacts.");
must(files.server, /contacts:\s*\[\]/u, "Unavailable research must return no contacts.");
must(files.server, /provider_called:\s*research\.providerCalled/u, "Successful research receipts must reflect the actual provider call.");
must(files.server, /crm_public_prospects_imported/u, "Every successful sourced CRM batch must create an organization audit receipt.");
must(files.server, /outbound_action_executed:\s*false/u, "CRM routes must not send outbound actions.");
must(files.server, /public_exposure_changed:\s*false/u, "CRM routes must not change public exposure.");
must(files.server, /const existingBrain =[\s\S]*\.\.\.existingBrain[\s\S]*brain: updatedBrain/u, "CRM research commands must preserve each organization's saved customization.");
must(files.publicResearch, /OVERPASS_ENDPOINTS[\s\S]*api\/interpreter/u, "Public research must use named OpenStreetMap Overpass endpoints.");
must(files.publicResearch, /sourceUrl = `https:\/\/www\.openstreetmap\.org\/\$\{sourceId\}`/u, "Every sourced organization must carry a reviewable source record.");
must(files.publicResearch, /email \? "email:published-business" : "email:research-needed"/u, "CRM research must distinguish published business email from missing email.");
must(files.publicResearch, /"consent:unknown"/u, "CRM research must never infer outreach consent.");
must(files.publicResearch, /!value\.includes\(";"\)[\s\S]*@/u, "Ambiguous public email fields must be rejected instead of guessed.");
must(files.publicResearch, /MAX_WEBSITE_ENRICHMENTS_PER_PULL[\s\S]*MAX_WEBSITE_DOCUMENT_BYTES[\s\S]*WEBSITE_EVIDENCE_TTL_MS/u,
  "Official-site enrichment must remain bounded by a per-pull cap, response limit, and cache TTL.");
must(files.publicResearch, /assertPublicWebsiteUrl[\s\S]*privateNetworkAddress[\s\S]*redirect: "manual"[\s\S]*public_website_cross_domain_redirect_blocked/u,
  "Official-site enrichment must reject private-network targets and cross-domain redirects.");
must(files.publicResearch, /mailto:[\s\S]*tel:[\s\S]*officialWebsiteSource[\s\S]*source:official-website/u,
  "Website-enriched contact details must be literal published links with an exact evidence page and source tag.");
must(files.publicResearch, /publishedEmailsAdded[\s\S]*publishedPhonesAdded[\s\S]*consent:unknown/u,
  "Website enrichment must report factual coverage without changing consent state.");
must(files.server, /websiteEnrichment: research\.websiteEnrichment/u,
  "The account research receipt and audit event must preserve official-site enrichment outcomes.");
must(files.publicResearch, /excludeSourceIds[\s\S]*availableCandidates[\s\S]*balancedCandidates[\s\S]*excludedExistingSources/u,
  "Repeated research must continue past already-saved source records before selecting the next bounded batch.");
must(files.server, /existingSourceIds[\s\S]*researchPublicProspects\(\{ \.\.\.parsed\.data, excludeSourceIds: \[\.\.\.existingSourceIds\] \}\)[\s\S]*skippedExisting/u,
  "The account route must pass its persisted directory sources into research and report skipped coverage truthfully.");
must(files.coreClient, /export function friendlyBackendError/u, "Shared client core must expose a friendly backend error formatter.");
must(files.packageJson, /test:crm-pipeline/u, "Root package must expose the CRM regression test.");

const truthSurface = `${files.server}\n${files.publicResearch}\n${files.workspaces}`;
assert.doesNotMatch(truthSurface, /CRM_PULL_ARCHETYPES|crmPullPlan|LEAD_ARCHETYPES|createProspectsFromPrompt/u, "Synthetic contact generators must not exist in the active CRM path.");
assert.doesNotMatch(truthSurface, /\.example\.local/u, "The active CRM path must not generate placeholder websites or emails.");
const researchRequiredIndex = files.server.indexOf('sourceMode: "research-required"');
const crmDiscoveryTruthSurface = files.server.slice(Math.max(0, researchRequiredIndex - 1_500), researchRequiredIndex + 3_000);
assert.doesNotMatch(crmDiscoveryTruthSurface, /outbound_action_executed:\s*true|public_exposure_changed:\s*true/iu, "CRM discovery must not perform outbound or public-exposure actions.");

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
