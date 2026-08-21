import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const main = read("../app/js/main.js");
const workspaces = read("../app/js/workspaces.js");
const orgs = read("../app/js/orgs.js");
const css = read("../app/phantom.css");
const server = read("../server/src/index.ts");
const accounts = read("../server/src/access/user-accounts.ts");
const release = read("./test-release-critical.mjs");
const databaseAuthTest = read("../server/scripts/test-database-auth.mjs");

const sourcePath = process.env.PHANTOMFORCE_ADMIN_AUDIT_SOURCE
  || "C:/Users/jorda/Downloads/PHANTOMFORCE_ADMIN_MASTER_AUDIT_10M_PLUS.md";
let sourceCases = null;
if (existsSync(sourcePath)) {
  const source = readFileSync(sourcePath, "utf8");
  sourceCases = (source.match(/^### PFQA-\d{6}\b/gmu) || []).length;
  assert.equal(sourceCases, 2186, "The supplied audit source must contain all 2,186 PFQA cases.");
}

const gates = [];
function gate(id, assertion, message) {
  assert.ok(assertion, message);
  gates.push(id);
}

gate("AUTH-01", /test:auth-boundaries/u.test(release) && /customerAuthForbiddenOnHost/u.test(server), "Public auth boundaries must stay release-gated and server enforced.");
gate("TENANT-01", /tenant isolation \(the aggressive part\)/iu.test(databaseAuthTest) && /test:organization-record-isolation/u.test(release), "Cross-organization record isolation must stay in release-critical coverage.");
gate("APPROVAL-01", /id: "approvals"[\s\S]*label: "Approvals"/u.test(main) && /decideServerRun/u.test(workspaces), "Approvals must be a real destination backed by server decisions.");
gate("RISK-01", /id: "protect"[\s\S]*label: "Risk Watch"[\s\S]*ws: "protect"/u.test(main), "Risk Watch must be a first-class navigation destination.");
gate("AUDIT-01", /app\.get\("\/orgs\/:orgId\/audit"[\s\S]*requireOrgManager\(request, reply, orgId\)/u.test(server), "Organization audit reads must be server-side role scoped.");
gate("AUDIT-02", /prevHash[\s\S]*stableHash\(body\)/u.test(accounts), "Organization audit events must remain hash chained.");
gate("AUDIT-03", /export async function fetchOrgAuditEvents/u.test(orgs) && /auditlog: \{[^\n]*adminOnly: true/u.test(workspaces), "The protected server audit trail must have a real admin UI client and route.");
gate("STATE-01", ["idle", "loading", "ready", "empty", "restricted", "error"].every((state) => workspaces.includes(`\"${state}\"`)), "Audit evidence must distinguish loading, empty, restricted, and failed states.");
gate("ZERO-01", /No result count will appear until the server answers/u.test(workspaces) && /verified empty history/u.test(workspaces), "Unavailable evidence must never collapse into a false zero.");
gate("FRESH-01", /refreshedAt[\s\S]*Refreshed/u.test(workspaces), "Consequential audit data must expose freshness.");
gate("EXPORT-01", /function downloadRedactedAudit/u.test(workspaces) && !/const safe = events\.map\([\s\S]{0,420}payload/u.test(workspaces), "Audit export must use a redacted allowlist and exclude payloads.");
gate("A11Y-01", /role="status"[\s\S]*aria-live="polite"/u.test(workspaces) && /@media \(max-width: 720px\)[\s\S]*\.audit-hero/u.test(css), "Audit states must remain semantic and responsive.");
gate("BILLING-01", /plan_change_requires_billing/u.test(server) && /Only the verified Stripe event/u.test(server), "Paid plans must not be self-assigned outside verified billing.");
gate("IDEMPOTENCY-01", /idempotency_key/u.test(server) && /publish:\$\{orgId\}:\$\{siteId\}/u.test(server), "Consequential writes must retain idempotency controls.");

console.log(JSON.stringify({
  ok: true,
  suite: "phantomforce-admin-master-audit",
  sourceCases: sourceCases ?? "source-not-mounted",
  executableReleaseGates: gates.length,
  gates,
}, null, 2));
