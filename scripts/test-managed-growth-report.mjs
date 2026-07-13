import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const server = read("server/src/index.ts");
const report = read("server/src/managed-growth/managed-growth-report.ts");
const client = read("app/js/managedgrowth.js");
const main = read("app/js/main.js");
const css = read("app/phantom.css");
const staticServer = read("ops/admin-live/admin-static-server.mjs");
const audit = read("scripts/audit-client-setup-data-model.mjs");
const packageJson = read("package.json");
const serverPackage = read("server/package.json");

assert.match(report, /export function buildManagedGrowthReport/u, "Report builder must be a testable pure function.");
assert.match(report, /CrmPipelineDocument/u, "Report must read CRM pipeline source documents.");
assert.match(report, /ProposalDocument/u, "Report must read Proposal Forge source documents.");
assert.match(report, /WorkspaceApprovalDocument/u, "Report must read workspace approval source documents.");
assert.match(report, /ClientSetupDocument/u, "Report must read Client Setup source documents.");
assert.match(report, /providerCalled:\s*false/u, "Report safety must prove no provider call happened.");
assert.match(report, /outboundActionExecuted:\s*false/u, "Report safety must prove no outbound action happened.");
assert.match(report, /socialAnalyticsStatus:\s*"not_connected_here"/u, "Internal growth report must not pretend to be social analytics.");

assert.match(server, /app\.get\("\/api\/managed-growth\/report"/u, "Server must expose an authenticated managed-growth report route.");
assert.match(server, /buildManagedGrowthReport\(\{ tenantId, clientSetup, crm, proposals, approvals \}\)/u, "Route must build from the four server-backed documents.");
assert.match(staticServer, /urlPath\.startsWith\("\/api\/managed-growth"\)/u, "Admin static server must proxy the managed-growth API.");

assert.match(client, /export async function loadManagedGrowthReport/u, "Browser client must fetch the report endpoint.");
assert.match(client, /Managed Growth Ops/u, "Browser UI must label the internal operations report.");
assert.match(client, /Social performance stays separate/u, "Browser UI must keep social analytics separate.");
assert.match(client, /data-open-ws="\$\{esc\(item\.surface\)\}"/u, "Next actions must deep-link to relevant product surfaces.");

assert.match(main, /managedgrowth\.js/u, "Analytics route must import the Managed Growth report panel.");
assert.match(main, /data-managed-growth-report/u, "Analytics route must mount Managed Growth report before social analytics.");
assert.match(main, /data-social-analytics-report/u, "Analytics route must still render social analytics separately.");

assert.match(css, /\.mg-report/u, "Managed Growth report must have dedicated responsive UI styles.");
assert.match(css, /\.analytics-stack/u, "Analytics page must stack internal and social report sections.");

assert.match(audit, /PERSIST-MANAGED-GROWTH-REPORT/u, "Client setup audit must include Managed Growth report persistence evidence.");
assert.match(packageJson, /test:managed-growth-report/u, "Root package must expose the Managed Growth report test.");
assert.match(serverPackage, /test:managed-growth-report/u, "Server package must expose the Managed Growth report builder test.");

assert.doesNotMatch(client, /live social metrics|workspace analytics are live|local uploads are counted/i, "Client must not claim social metrics are live or count local uploads.");

console.log("Managed Growth report checks passed.");
