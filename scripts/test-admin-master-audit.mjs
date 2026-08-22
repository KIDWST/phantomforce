import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const index = read("../app/index.html");
const main = read("../app/js/main.js");
const workspaces = read("../app/js/workspaces.js");
const store = read("../app/js/store.js");
const orgs = read("../app/js/orgs.js");
const css = read("../app/phantom.css");
const server = read("../server/src/index.ts");
const accounts = read("../server/src/access/user-accounts.ts");
const workGraph = read("../server/src/workforce/work-graph.ts");
const release = read("./test-release-critical.mjs");
const databaseAuthTest = read("../server/scripts/test-database-auth.mjs");
const primaryNav = index.match(/<nav class="os-primary-nav"[\s\S]*?<\/nav>/u)?.[0] || "";

const sourcePath = process.env.PHANTOMFORCE_ADMIN_AUDIT_SOURCE
  || "C:/Users/jorda/Downloads/PHANTOMFORCE_ADMIN_MASTER_AUDIT_10M_PLUS.md";
let sourceCases = null;
if (existsSync(sourcePath)) {
  const source = readFileSync(sourcePath, "utf8");
  sourceCases = (source.match(/^### PFQA-\d{6}\b/gmu) || []).length;
  assert.equal(sourceCases, 2186, "The supplied audit source must contain all 2,186 PFQA cases.");
}

const primaryJobs = [
  ["dashboard", "Overview"],
  ["leads", "Leads"],
  ["followup", "Follow-up"],
  ["bookings", "Bookings"],
  ["clients", "Clients"],
  ["money", "Quotes &amp; Money"],
  ["media", "Media Lab"],
  ["sites", "Sites &amp; Stores"],
  ["approvals", "Approvals"],
  ["riskwatch", "Risk Watch"],
  ["analytics", "Analytics"],
];

let previousIndex = -1;
for (const [id, label] of primaryJobs) {
  const pattern = `data-nav-id="${id}"`;
  const indexPosition = primaryNav.indexOf(pattern);
  assert.ok(indexPosition > previousIndex, `${label} must appear in the audited primary-job order.`);
  assert.match(primaryNav.slice(indexPosition, indexPosition + 240), new RegExp(`>${label}<`), `${id} must render the audited owner label.`);
  previousIndex = indexPosition;
}

assert.doesNotMatch(primaryNav, /data-nav-id="(?:phantomplay|phantomstore|automation)"/u, "Ecosystem and system tools cannot displace daily owner jobs in the primary rail.");
assert.match(main, /\{ id: "approvals",\s+label: "Approvals",[^\n]*ws: "approvals"/u, "Approvals must be a persistent destination.");
assert.doesNotMatch(main, /\{ id: "approvals"[^\n]*dashboardWidget/u, "Approvals cannot be hidden as a dashboard-only widget.");
assert.match(main, /\{ id: "riskwatch",\s+label: "Risk Watch",[^\n]*ws: "riskwatch"/u, "Risk Watch must be a persistent destination.");
assert.match(main, /crm: "leads"[\s\S]*protect: "riskwatch"/u, "Old CRM and Protect deep links must remain compatible.");

for (const [id, renderer] of [
  ["leads", "renderLeads"],
  ["followup", "renderFollowUp"],
  ["comms", "renderComms"],
  ["bookings", "renderBookings"],
  ["clients", "renderClients"],
  ["riskwatch", "renderRiskWatch"],
  ["runtime", "renderRuntime"],
  ["audit", "renderAuditLog"],
  ["notifications", "renderNotifications"],
]) {
  assert.match(workspaces, new RegExp(`${id}: \\{[^\\n]*render: ${renderer}`), `${id} must register its real audited workspace.`);
}

assert.match(workspaces, /permission unknown[\s\S]*drafting allowed · sending blocked/iu, "Follow-up must make the consent boundary explicit.");
assert.match(workspaces, /Approval changes a draft to send-ready; it does not invent a provider delivery receipt/u, "Comms cannot claim an unverified send.");
assert.match(workspaces, /Verified server actions[\s\S]*Recent execution evidence[\s\S]*receipt/u, "Approvals must show backend execution evidence.");
for (const evidenceSource of ["Protected approval audit", "Agent execution", "Operator activity"]) {
  assert.match(workspaces, new RegExp(evidenceSource), `Audit Log must distinguish ${evidenceSource}.`);
}
assert.match(store, /communications: \[\][\s\S]*notificationReads: \[\][\s\S]*riskAcknowledgements: \[\]/u, "Operational inbox and risk state must persist in the tenant store.");

for (const selector of [".ops-summary", ".ops-client-layout", ".ops-risk", ".ops-timeline"]) {
  assert.match(css, new RegExp(selector.replace(".", "\\.")), `${selector} must have a stable visual contract.`);
}
assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.ops-summary \{ grid-template-columns: 1fr; \}/u, "Audited workspaces must collapse intentionally on phones.");

const gates = [];
function gate(id, assertion, message) {
  assert.ok(assertion, message);
  gates.push(id);
}

gate("AUTH-01", /test:auth-boundaries/u.test(release) && /customerAuthForbiddenOnHost/u.test(server), "Public auth boundaries must stay release-gated and server enforced.");
gate("TENANT-01", /tenant isolation \(the aggressive part\)/iu.test(databaseAuthTest) && /test:organization-record-isolation/u.test(release), "Cross-organization record isolation must stay in release-critical coverage.");
gate("APPROVAL-01", /id: "approvals"[\s\S]*label: "Approvals"/u.test(main) && /decideServerRun/u.test(workspaces), "Approvals must be a real destination backed by server decisions.");
gate("RISK-01", /id: "riskwatch"[\s\S]*label: "Risk Watch"[\s\S]*ws: "riskwatch"/u.test(main) && /protect: "riskwatch"/u.test(main), "Risk Watch must be first-class while preserving legacy Protect links.");
gate("AUDIT-01", /app\.get\("\/orgs\/:orgId\/audit"[\s\S]*requireOrgManager\(request, reply, orgId\)/u.test(server), "Organization audit reads must be server-side role scoped.");
gate("AUDIT-02", /prevHash[\s\S]*stableHash\(body\)/u.test(accounts), "Organization audit events must remain hash chained.");
gate("AUDIT-03", /export async function fetchOrgAuditEvents/u.test(orgs) && /auditlog: \{[^\n]*adminOnly: true/u.test(workspaces), "The protected server audit trail must have a real admin UI client and route.");
gate("STATE-01", ["idle", "loading", "ready", "empty", "restricted", "error"].every((state) => workspaces.includes(`"${state}"`)), "Audit evidence must distinguish loading, empty, restricted, and failed states.");
gate("ZERO-01", /No result count will appear until the server answers/u.test(workspaces) && /verified empty history/u.test(workspaces), "Unavailable evidence must never collapse into a false zero.");
gate("FRESH-01", /refreshedAt[\s\S]*Refreshed/u.test(workspaces), "Consequential audit data must expose freshness.");
gate("EXPORT-01", /function downloadRedactedAudit/u.test(workspaces) && !/const safe = events\.map\([\s\S]{0,420}payload/u.test(workspaces), "Audit export must use a redacted allowlist and exclude payloads.");
gate("A11Y-01", /role="status"[\s\S]*aria-live="polite"/u.test(workspaces) && /@media \(max-width: 720px\)[\s\S]*\.audit-hero/u.test(css), "Audit states must remain semantic and responsive.");
gate("BILLING-01", /plan_change_requires_billing/u.test(server) && /Only the verified Stripe event/u.test(server), "Paid plans must not be self-assigned outside verified billing.");
gate("IDEMPOTENCY-01", /idempotency_key/u.test(server) && /publish:\$\{orgId\}:\$\{siteId\}/u.test(server), "Consequential writes must retain idempotency controls.");
gate("WORKGRAPH-01", /test:work-graph/u.test(release) && /test:workforce-heartbeat-ui/u.test(release), "The authoritative workforce lifecycle must stay in release-critical coverage.");
gate("WORKGRAPH-02", /\/api\/workforce\/heartbeat/u.test(server) && /idempotencyKey === idempotencyKey/u.test(workGraph), "The owner heartbeat must be server backed and idempotent.");
gate("WORKGRAPH-03", /const prevHash = document\.audit\.at\(-1\)\?\.hash \?\? null[\s\S]*hash: createHash\("sha256"\)/u.test(workGraph) && /if \(!verified\) throw new Error/u.test(workGraph), "Work completion must require read-back evidence in a hash-chained audit.");
gate("EXTERNAL-TRUTH-01", /No verified email delivery connector is active for this organization/u.test(workGraph) && /Connect and verify Gmail or Outlook/u.test(workGraph), "Unavailable external execution must surface an exact reason and remediation.");

console.log(JSON.stringify({
  ok: true,
  suite: "phantomforce-admin-master-audit",
  sourceCases: sourceCases ?? "source-not-mounted",
  primaryJobs: primaryJobs.length,
  executableReleaseGates: gates.length,
  gates,
}, null, 2));
