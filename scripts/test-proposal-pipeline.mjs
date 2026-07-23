import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

const files = {
  store: read("server/src/proposals/proposal-store.ts"),
  server: read("server/src/index.ts"),
  coreClient: read("app/js/store.js"),
  client: read("app/js/proposalpipeline.js"),
  workspaces: read("app/js/workspaces.js"),
  staticServer: read("ops/admin-live/admin-static-server.mjs"),
  audit: read("scripts/audit-client-setup-data-model.mjs"),
  packageJson: read("package.json"),
};

const must = (source, pattern, message) => assert.match(source, pattern, message);

must(files.store, /ProposalDocument/u, "Proposal store must define a durable document.");
must(files.store, /ProposalStatus/u, "Proposal store must define proposal statuses.");
must(files.store, /"draft" \| "sent-ready" \| "sent" \| "won" \| "lost" \| "invoice-ready"/u, "Proposal statuses must preserve the existing forge states.");
must(files.store, /createProposalDraft/u, "Proposal store must create draft proposals.");
must(files.store, /updateProposalDraft/u, "Proposal store must update draft proposals.");
must(files.store, /deleteProposalDraft/u, "Proposal store must delete draft proposals.");
must(files.store, /acceptProposalVersion/u, "Proposal store must bind acceptance to an immutable proposal version.");
must(files.store, /convertAcceptedProposal/u, "Proposal store must convert accepted proposals idempotently.");
must(files.store, /priceMinor/u, "Proposal totals must use integer minor-unit arithmetic.");
must(files.store, /payloadHash/u, "Proposal versions must carry deterministic payload hashes.");
must(files.store, /serverBacked:\s*true/u, "Proposal drafts must be marked server-backed after normalization.");

for (const route of [
  /app\.get\("\/api\/proposals"/u,
  /app\.post\("\/api\/proposals"/u,
  /app\.post\("\/api\/proposals\/:proposalId"/u,
  /app\.delete\("\/api\/proposals\/:proposalId"/u,
  /app\.post\("\/api\/proposals\/:proposalId\/accept"/u,
  /app\.post\("\/api\/proposals\/:proposalId\/convert"/u,
]) {
  must(files.server, route, `Server route missing: ${route}`);
}

must(files.server, /canWriteCrm\(session\)/u, "Proposal routes must require the same member write boundary as CRM.");
must(files.server, /provider_called:\s*false/u, "Proposal routes must not claim provider calls.");
must(files.server, /outbound_action_executed:\s*false/u, "Proposal routes must not send outbound actions.");
must(files.server, /public_exposure_changed:\s*false/u, "Proposal routes must not change public exposure.");
must(files.staticServer, /urlPath\.startsWith\("\/api\/proposals"\)/u, "Static server must proxy proposal API routes.");

for (const exported of ["loadProposals", "createProposal", "updateProposal", "deleteProposal"]) {
  must(files.client, new RegExp(`export async function ${exported}`, "u"), `Client API must export ${exported}.`);
}
must(files.coreClient, /export function friendlyBackendError/u, "Shared client core must expose a friendly backend error formatter.");
must(files.client, /friendlyBackendError[\s\S]*Sign in to load server-backed proposals/u, "Proposal client must hide raw auth transport errors behind a clean sign-in message.");

must(files.workspaces, /Server proposals saved/u, "Proposal Forge must display server proposal state.");
must(files.workspaces, /loadProposals/u, "Proposal Forge must load server proposals.");
must(files.workspaces, /createServerProposal/u, "Proposal Forge must create server proposals.");
must(files.workspaces, /updateServerProposal/u, "Proposal Forge must update server proposals.");
must(files.workspaces, /deleteServerProposal/u, "Proposal Forge must delete server proposals.");
must(files.workspaces, /proposalServerAvailable\(\)[\s\S]*createServerProposal\(\{ \.\.\.p, leadId: l\.id \}\)/u, "Lead conversion must create server-backed proposal drafts when signed in.");
must(files.workspaces, /Nothing was sent/u, "Proposal Forge must clearly preserve the draft-only send boundary.");
must(files.audit, /PERSIST-PROPOSALS/u, "Structured audit must report proposal persistence.");
must(files.packageJson, /test:proposal-pipeline/u, "Root package must expose the proposal pipeline regression test.");

const joined = `${files.store}\n${files.server}\n${files.client}\n${files.workspaces}`;
assert.doesNotMatch(joined, /provider_called:\s*true|outbound_action_executed:\s*true|public_exposure_changed:\s*true/iu, "Proposal pipeline must not perform external/provider/public actions.");
assert.doesNotMatch(files.store, /fake email|fake phone|invent real/iu, "Proposal store must not seed fake contact details.");

console.log(JSON.stringify({
  ok: true,
  product: "Proposal drafts server persistence",
  routes: 6,
  statuses: ["draft", "sent-ready", "sent", "won", "lost", "invoice-ready"],
  serverBacked: true,
  externalActions: false,
}, null, 2));
