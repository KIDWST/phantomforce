/* Verifies the Termina Mission Bridge (docs/superpowers/specs/2026-07-15-
   termina-mission-bridge-design.md) without a real Termina process: mocks
   global fetch so no PTY worker, git worktree, or LLM call actually happens.
   Uses the same in-process app.inject() pattern as test-phantomstore.ts. */
process.env.NODE_ENV = "development";
process.env.PHANTOMFORCE_SERVER_LISTEN = "false";
process.env.PHANTOMFORCE_SERVER_LOGGER = "false";
process.env.PHANTOMFORCE_AUTH_PROVIDER = "demo";
process.env.PHANTOMFORCE_ENABLE_DEMO_AUTH = "true";
process.env.PHANTOMFORCE_SKIP_SERVER_DOTENV = "true";
process.env.TERMINA_TOKEN = "test-termina-token";
process.env.TERMINA_APPROVED_WORKSPACE_ROOT = "C:\\fake\\approved\\workspace";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

const realFetch = globalThis.fetch;
let lastRequest: { url: string; init?: RequestInit } | null = null;
let terminaUp = true;
const fakeRoles = [{ name: "Builder", scope: "implement the fix", deliverables: ["passing tests"], prohibited: ["touching prod"] }];
const missionsById = new Map<string, any>();

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input);
  if (!url.startsWith("http://127.0.0.1:7420")) return realFetch(input, init);
  lastRequest = { url, init };
  if (!terminaUp) throw new Error("fetch failed: connection refused");
  const header = (init?.headers as Record<string, string> | undefined)?.["x-termina-token"];
  if (header !== "test-termina-token") return new Response(JSON.stringify({ ok: false, error: "bad_token" }), { status: 401 });

  if (url.endsWith("/api/health")) return new Response(JSON.stringify({ ok: true, app: "termina" }), { status: 200 });

  if (url.endsWith("/api/missions/decompose")) {
    const body = JSON.parse(String(init?.body ?? "{}"));
    assert(body.workspaceRoot === "C:\\fake\\approved\\workspace", "decompose must always use the configured approved workspace root, never a caller-supplied one");
    return new Response(JSON.stringify({ ok: true, roles: fakeRoles, missionName: "Fix the failing test", costUsd: 0.02 }), { status: 200 });
  }

  if (url.endsWith("/api/missions") && init?.method === "POST") {
    const body = JSON.parse(String(init?.body ?? "{}"));
    assert(body.workspaceRoot === "C:\\fake\\approved\\workspace", "mission creation must always use the configured approved workspace root");
    assert(Array.isArray(body.roles) && body.roles.length === 1, "mission creation should forward the approved roles");
    const mission = { id: "abc123", name: body.name, objective: body.objective, workspaceRoot: body.workspaceRoot, status: "running", workers: [{ id: "w1", name: "Builder", status: "starting" }] };
    missionsById.set(mission.id, mission);
    return new Response(JSON.stringify({ ok: true, mission }), { status: 200 });
  }

  const getMatch = url.match(/\/api\/missions\/([\w-]+)$/);
  if (getMatch && (!init?.method || init.method === "GET")) {
    const mission = missionsById.get(getMatch[1]);
    if (!mission) return new Response(JSON.stringify({ ok: false, error: "mission_not_found" }), { status: 404 });
    return new Response(JSON.stringify({ ok: true, mission, ledger: [], tokens: {} }), { status: 200 });
  }

  return new Response(JSON.stringify({ ok: false, error: "unhandled_mock_route" }), { status: 500 });
}) as typeof fetch;

try {
  const { app } = await import("../src/index.js");

  const login = async (sessionId: string) => {
    const response = await app.inject({ method: "POST", url: "/auth/demo-login", payload: { sessionId } });
    assert(response.statusCode === 200, `${sessionId} should obtain a local test token.`);
    return (response.json() as { token: string }).token;
  };
  const ownerToken = await login("admin-jordan");
  const devToken = await login("client-sports-demo");

  // ---- auth boundary: this executes real commands, so it's admin-only ----
  const unauthed = await app.inject({ method: "GET", url: "/phantom-ai/termina/health" });
  assert(unauthed.statusCode === 401, "Health check must require a signed-in session.");
  const nonAdmin = await app.inject({ method: "GET", url: "/phantom-ai/termina/health", headers: { Authorization: `Bearer ${devToken}` } });
  assert(nonAdmin.statusCode === 403, "A non-admin session must not reach the Termina bridge at all.");

  // ---- health check ----
  const health = await app.inject({ method: "GET", url: "/phantom-ai/termina/health", headers: { Authorization: `Bearer ${ownerToken}` } });
  assert(health.statusCode === 200 && health.json().reachable === true, "Health check should report Termina reachable when the mock responds ok.");

  terminaUp = false;
  const healthDown = await app.inject({ method: "GET", url: "/phantom-ai/termina/health", headers: { Authorization: `Bearer ${ownerToken}` } });
  assert(healthDown.statusCode === 200 && healthDown.json().reachable === false, "Health check should degrade to reachable:false, not throw, when Termina is down.");
  terminaUp = true;

  // ---- observe tier: decompose needs no approval ----
  const decompose = await app.inject({ method: "POST", url: "/phantom-ai/missions/decompose", headers: { Authorization: `Bearer ${ownerToken}` }, payload: { objective: "Fix the failing test" } });
  assert(decompose.statusCode === 200 && decompose.json().roles.length === 1, "Decompose should return a plan without needing approval.");

  // ---- work-inside-approved-projects tier: requires confirmed approval ----
  const startAttempt = await app.inject({
    method: "POST", url: "/phantom-ai/missions", headers: { Authorization: `Bearer ${ownerToken}` },
    payload: { objective: "Fix the failing test", missionName: decompose.json().missionName, roles: decompose.json().roles },
  });
  assert(startAttempt.statusCode === 200 && typeof startAttempt.json().approvalId === "string", "Starting a mission should only create a pending approval, not execute anything yet.");
  assert(!lastRequest || !lastRequest.url.endsWith("/api/missions"), "No real POST /api/missions call should happen before the approval is confirmed.");
  const approvalId = startAttempt.json().approvalId as string;

  const badConfirm = await app.inject({ method: "POST", url: `/phantom-ai/missions/approvals/does-not-exist/confirm`, headers: { Authorization: `Bearer ${ownerToken}` } });
  assert(badConfirm.statusCode === 404, "Confirming an unknown/expired approval id should 404, not silently start a mission.");

  const confirm = await app.inject({ method: "POST", url: `/phantom-ai/missions/approvals/${approvalId}/confirm`, headers: { Authorization: `Bearer ${ownerToken}` } });
  assert(confirm.statusCode === 200 && confirm.json().mission?.id === "abc123", "Confirming a valid approval should actually start the mission via Termina.");

  const reuseConfirm = await app.inject({ method: "POST", url: `/phantom-ai/missions/approvals/${approvalId}/confirm`, headers: { Authorization: `Bearer ${ownerToken}` } });
  assert(reuseConfirm.statusCode === 404, "An approval must be single-use -- confirming it twice should fail the second time.");

  // ---- passthrough read ----
  const missionGet = await app.inject({ method: "GET", url: "/phantom-ai/missions/abc123", headers: { Authorization: `Bearer ${ownerToken}` } });
  assert(missionGet.statusCode === 200 && missionGet.json().mission?.status === "running", "Mission get should passthrough Termina's real mission state.");

  const missionGetNonAdmin = await app.inject({ method: "GET", url: "/phantom-ai/missions/abc123", headers: { Authorization: `Bearer ${devToken}` } });
  assert(missionGetNonAdmin.statusCode === 403, "Reading mission state must also be admin-only.");

  await app.close();
  console.log(JSON.stringify({ ok: true, adminOnly: true, healthDegradesGracefully: true, approvedWorkspaceAlwaysUsed: true, approvalGateEnforced: true, approvalSingleUse: true, passthroughWorks: true }));
} finally {
  globalThis.fetch = realFetch;
}
