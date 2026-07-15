import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { AccessSession } from "../src/access/session.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

const root = await mkdtemp(join(tmpdir(), "phantomstore-"));
process.env.PHANTOMFORCE_PHANTOMSTORE_PATH = join(root, "phantomstore.json");
process.env.NODE_ENV = "development";
process.env.PHANTOMFORCE_SERVER_LISTEN = "false";
process.env.PHANTOMFORCE_SERVER_LOGGER = "false";
process.env.PHANTOMFORCE_AUTH_PROVIDER = "demo";
process.env.PHANTOMFORCE_ENABLE_DEMO_AUTH = "true";
process.env.PHANTOMFORCE_SKIP_SERVER_DOTENV = "true";

const owner: AccessSession = { id: "owner", userId: "owner-user", label: "Owner Studio", role: "admin", canManageAccess: true, orgId: "org-owner", orgRole: "owner", isSuperAdmin: true };
const devA: AccessSession = { id: "dev-a", userId: "dev-a", label: "Developer A", role: "client", canManageAccess: false, orgId: "org-a", orgRole: "member" };
const devB: AccessSession = { id: "dev-b", userId: "dev-b", label: "Developer B", role: "client", canManageAccess: false, orgId: "org-b", orgRole: "member" };

try {
  const store = await import("../src/phantom-ai/phantomstore.js");

  const initial = await store.getPhantomStoreSnapshot(devA);
  assert(initial.catalog.length === 0, "A fresh store should ship no seeded tools.");
  assert(initial.canModerate === false, "A regular developer must not receive moderation access.");
  assert(initial.submissions.length === 0, "A developer with no submissions should see an empty list.");

  let incompleteRejected = false;
  try { await store.submitPhantomStoreTool(devA, { name: "Bad", submit: true }); } catch { incompleteRejected = true; }
  assert(incompleteRejected, "Incomplete tool submissions must be rejected when submit is true.");

  const draft = await store.submitPhantomStoreTool(devA, { name: "Draft Only", summary: "Not ready yet." });
  assert(draft.tool.status === "draft", "Saving without submit:true should store a draft even though required fields are still missing.");
  assert(draft.issues.length > 0, "The draft should still report which fields are outstanding, for the UI to show before submit.");

  const created = await store.submitPhantomStoreTool(devA, {
    name: "Repo Sync CLI",
    summary: "Keep two git repos in lockstep from a single command.",
    description: "A small CLI that mirrors commits between two remotes on a schedule, built for the PhantomForce agent worktree workflow.",
    category: "CLI",
    tags: ["git", "sync", "cli"],
    repoUrl: "https://github.com/example/repo-sync-cli",
    installMethod: "npm",
    installCommand: "npm install -g repo-sync-cli",
    version: "1.0.0",
    license: "MIT",
    submit: true,
  });
  assert(created.tool.status === "submitted", "A complete submission should enter the moderation queue.");
  assert(created.tool.developerId === "dev-a", "The submission should be attributed to the actor, not a client-supplied id.");

  const isolated = await store.getPhantomStoreSnapshot(devB);
  assert(isolated.submissions.length === 0, "Submissions must stay isolated between developers.");
  assert(isolated.catalog.length === 0, "Unapproved tools must not appear in anyone's public catalog.");

  let playerModerationBlocked = false;
  try { await store.moderatePhantomStoreTool(devA, created.tool.id, { decision: "approved" }); } catch { playerModerationBlocked = true; }
  assert(playerModerationBlocked, "Non-admin developers must not moderate tools, including their own.");

  let badRepoRejected = false;
  let badRepoMessage = "";
  try {
    await store.submitPhantomStoreTool(devA, {
      name: "Bad Repo Link", summary: "Uses a non-http scheme.", description: "Deliberately invalid repo URL to prove scheme validation.",
      repoUrl: "javascript:alert(1)", installMethod: "manual", submit: true,
    });
  } catch (error) {
    badRepoRejected = true;
    badRepoMessage = error instanceof Error ? error.message : "";
  }
  assert(badRepoRejected, "A non-http(s) repo URL must be sanitized away and fail submission, not get stored.");
  assert(badRepoMessage.toLowerCase().includes("repo"), "The validation error should mention the missing/invalid repo URL.");

  await store.moderatePhantomStoreTool(owner, created.tool.id, { decision: "approved", featured: true, note: "Looks solid." });
  const approved = await store.getPhantomStoreSnapshot(devB);
  assert(approved.catalog.some((tool) => tool.name === "Repo Sync CLI"), "An approved tool should enter the public catalog for every tenant.");
  assert(!("moderationNote" in approved.catalog[0]), "The public catalog must never leak internal moderation notes.");

  const clicked = await store.recordPhantomStoreInstallClick(devB, created.tool.id);
  assert(clicked?.installClicks === 1, "Install clicks on an approved tool should increment.");
  const clickedAgain = await store.recordPhantomStoreInstallClick(devB, created.tool.id);
  assert(clickedAgain?.installClicks === 2, "Install clicks should accumulate across visitors.");

  const draftClick = await store.recordPhantomStoreInstallClick(devB, draft.tool.id);
  assert(draftClick === null, "Install clicks must not count against tools that were never approved.");

  await store.moderatePhantomStoreTool(owner, created.tool.id, { decision: "disabled", note: "Pulled for test." });
  const disabled = await store.getPhantomStoreSnapshot(devB);
  assert(!disabled.catalog.some((tool) => tool.name === "Repo Sync CLI"), "A disabled tool must disappear from the catalog immediately.");

  let staleUpdateBlocked = false;
  try { await store.updatePhantomStoreTool(devA, created.tool.id, { summary: "Sneaky re-edit." }); } catch { staleUpdateBlocked = true; }
  assert(staleUpdateBlocked, "A developer must not silently re-edit a tool that has already left draft/submitted state without review.");

  const status = await store.getPhantomStoreStatus();
  assert(status.tools === 2 && status.approvedTools === 0, "Status should reflect total tools written and current approved count (rejected submissions never get stored).");

  const persisted = JSON.parse(await readFile(process.env.PHANTOMFORCE_PHANTOMSTORE_PATH, "utf8")) as { tools: unknown[] };
  assert(persisted.tools.length === 2, "Tool submissions should be durable across process restarts.");

  const { app } = await import("../src/index.js");
  const unauthenticated = await app.inject({ method: "GET", url: "/api/phantomstore" });
  assert(unauthenticated.statusCode === 401, "The catalog API must require a signed-in session.");
  const login = async (sessionId: string) => {
    const response = await app.inject({ method: "POST", url: "/auth/demo-login", payload: { sessionId } });
    assert(response.statusCode === 200, `${sessionId} should obtain a local test token.`);
    return (response.json() as { token: string }).token;
  };
  const ownerToken = await login("admin-jordan");
  const devToken = await login("client-sports-demo");
  const ownerView = await app.inject({ method: "GET", url: "/api/phantomstore", headers: { Authorization: `Bearer ${ownerToken}` } });
  assert(ownerView.statusCode === 200 && ownerView.json().canModerate === true, "Platform admin sessions should receive moderation access via the route.");
  const devView = await app.inject({ method: "GET", url: "/api/phantomstore", headers: { Authorization: `Bearer ${devToken}` } });
  assert(devView.statusCode === 200 && devView.json().canModerate === false, "A free-plan client session should still be able to view the catalog, without moderation access.");
  const devSubmitBlocked = await app.inject({
    method: "POST", url: "/api/phantomstore/tools", headers: { Authorization: `Bearer ${devToken}` },
    payload: { name: "Route Tool", summary: "Submitted through the HTTP route.", description: "Proves the Fastify route wiring saves a tool end to end.", repoUrl: "https://example.test/route-tool", installMethod: "manual", submit: true },
  });
  assert(devSubmitBlocked.statusCode === 403, "The platform's fail-closed write gate should block a free-plan session from submitting through the route, same as any other mutating route.");
  const ownerSubmit = await app.inject({
    method: "POST", url: "/api/phantomstore/tools", headers: { Authorization: `Bearer ${ownerToken}` },
    payload: { name: "Route Tool", summary: "Submitted through the HTTP route.", description: "Proves the Fastify route wiring saves a tool end to end.", repoUrl: "https://example.test/route-tool", installMethod: "manual", submit: true },
  });
  assert(ownerSubmit.statusCode === 200 && ownerSubmit.json().tool.status === "submitted", "The submission route should accept a complete tool and enter review for a session with write access.");
  const routeToolId = ownerSubmit.json().tool.id as string;
  const ownerModeration = await app.inject({ method: "POST", url: `/api/phantomstore/tools/${routeToolId}/moderate`, headers: { Authorization: `Bearer ${ownerToken}` }, payload: { decision: "approved" } });
  assert(ownerModeration.statusCode === 200 && ownerModeration.json().tool.status === "approved", "The moderation route should approve a tool for an admin session.");
  const installRoute = await app.inject({ method: "POST", url: `/api/phantomstore/tools/${routeToolId}/install`, headers: { Authorization: `Bearer ${ownerToken}` } });
  assert(installRoute.statusCode === 200 && installRoute.json().installClicks === 1, "The install-click route should record a click for an approved tool.");
  await app.close();

  console.log(JSON.stringify({ ok: true, tenantIsolation: true, validationEnforced: true, moderationGated: true, catalogFiltered: true, installClicksTracked: true, moderationNoteHidden: true, routeAuth: true }));
} finally {
  await rm(root, { recursive: true, force: true });
}
