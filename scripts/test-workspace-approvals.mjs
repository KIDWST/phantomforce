import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

const files = {
  store: read("server/src/workspace-approvals/workspace-approval-store.ts"),
  server: read("server/src/index.ts"),
  client: read("app/js/approvalpipeline.js"),
  workspaces: read("app/js/workspaces.js"),
  staticServer: read("ops/admin-live/admin-static-server.mjs"),
  audit: read("scripts/audit-client-setup-data-model.mjs"),
  packageJson: read("package.json"),
};

const must = (source, pattern, message) => assert.match(source, pattern, message);

must(files.store, /WorkspaceApprovalDocument/u, "Workspace approval store must define a durable document.");
must(files.store, /WorkspaceApprovalStatus/u, "Workspace approval store must define statuses.");
must(files.store, /"pending" \| "approved" \| "declined" \| "changes-requested"/u, "Workspace approval statuses must support decision states.");
must(files.store, /createWorkspaceApproval/u, "Workspace approval store must create approval requests.");
must(files.store, /decideWorkspaceApproval/u, "Workspace approval store must decide approval requests.");
must(files.store, /deleteWorkspaceApproval/u, "Workspace approval store must delete approval requests.");
must(files.store, /serverBacked:\s*true/u, "Workspace approvals must be marked server-backed after normalization.");

for (const route of [
  /app\.get\("\/api\/workspace-approvals"/u,
  /app\.post\("\/api\/workspace-approvals"/u,
  /app\.post\("\/api\/workspace-approvals\/:approvalId"/u,
  /app\.delete\("\/api\/workspace-approvals\/:approvalId"/u,
]) {
  must(files.server, route, `Server route missing: ${route}`);
}

must(files.server, /canDecideWorkspaceApprovals/u, "Approval decisions must have an owner/admin boundary.");
must(files.server, /approval_execution_implemented:\s*false/u, "Workspace approval routes must not imply execution exists.");
must(files.server, /provider_called:\s*false/u, "Workspace approval routes must not claim provider calls.");
must(files.server, /outbound_action_executed:\s*false/u, "Workspace approval routes must not send outbound actions.");
must(files.server, /public_exposure_changed:\s*false/u, "Workspace approval routes must not change public exposure.");
must(files.staticServer, /urlPath\.startsWith\("\/api\/workspace-approvals"\)/u, "Static server must proxy workspace approval API routes.");

for (const exported of ["loadWorkspaceApprovals", "createWorkspaceApproval", "decideWorkspaceApproval", "deleteWorkspaceApproval"]) {
  must(files.client, new RegExp(`export async function ${exported}`, "u"), `Client API must export ${exported}.`);
}

must(files.workspaces, /Server approvals saved/u, "Approvals page must display server approval state.");
must(files.workspaces, /queueWorkspaceApproval/u, "Approval-producing widgets must use a shared server/local queue helper.");
must(files.workspaces, /createServerWorkspaceApproval/u, "Widgets must create server workspace approvals.");
must(files.workspaces, /decideServerWorkspaceApproval/u, "Approvals page must decide server workspace approvals.");
must(files.workspaces, /deleteServerWorkspaceApproval/u, "Approvals page must delete server workspace approvals.");
must(files.workspaces, /applyApprovalSideEffects/u, "Approvals page must keep internal draft-state side effects explicit.");
must(files.audit, /PERSIST-WORKSPACE-APPROVALS/u, "Structured audit must report workspace approval persistence.");
must(files.packageJson, /test:workspace-approvals/u, "Root package must expose the workspace approvals regression test.");

const joined = `${files.store}\n${files.server}\n${files.client}\n${files.workspaces}`;
assert.doesNotMatch(joined, /provider_called:\s*true|outbound_action_executed:\s*true|public_exposure_changed:\s*true|approval_execution_implemented:\s*true/iu, "Workspace approvals must not perform external/provider/public/execution actions.");
assert.doesNotMatch(files.store, /api[_-]?key|password|secret|token/iu, "Workspace approval store must not persist secret-shaped fields.");

console.log(JSON.stringify({
  ok: true,
  product: "Workspace approval queue server persistence",
  routes: 4,
  statuses: ["pending", "approved", "declined", "changes-requested"],
  serverBacked: true,
  executionImplemented: false,
  externalActions: false,
}, null, 2));
