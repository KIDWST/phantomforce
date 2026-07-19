/* Verifies the Termina mission "chat -> ask -> explicit confirm -> real
   dispatch" path end-to-end, plus unit-level isMissionDone() logic, without
   a real Termina process: mocks global fetch so no PTY worker, git
   worktree, or LLM call ever actually happens. Uses the same in-process
   app.inject() pattern as test-agent-workforce-status.ts.

   The one thing this script exists to prove: a mission never dispatches
   (never calls Termina's decompose/create-mission endpoints) until a
   SEPARATE, later request carries an explicit, narrowly-matched user
   confirmation — never from the first message alone, never from a
   heuristic, never twice from one confirmation. */
import assert from "node:assert/strict";

process.env.NODE_ENV = "development";
process.env.PHANTOMFORCE_SERVER_LISTEN = "false";
process.env.PHANTOMFORCE_SERVER_LOGGER = "false";
process.env.PHANTOMFORCE_AUTH_PROVIDER = "demo";
process.env.PHANTOMFORCE_ENABLE_DEMO_AUTH = "true";
process.env.PHANTOMFORCE_SKIP_SERVER_DOTENV = "true";
process.env.TERMINA_TOKEN = "test-termina-token";

function parseJson<T>(payload: string): T {
  return JSON.parse(payload) as T;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/* ---------------- unit-level: isMissionDone() ported logic ---------------- */
{
  const { isMissionDone } = await import("../src/phantom-ai/termina-bridge.js");

  assert.equal(isMissionDone({ workers: [] }, []), true, "a mission with no workers is trivially done");

  assert.equal(
    isMissionDone(
      { workers: [{ id: "w1", status: "running" }] },
      [],
    ),
    false,
    "a running worker with no terminal ledger event is not done",
  );

  assert.equal(
    isMissionDone(
      { workers: [{ id: "w1", status: "stopped" }] },
      [],
    ),
    true,
    "a worker whose own status is a terminal abnormal one (stopped) counts as done even with no ledger event",
  );

  assert.equal(
    isMissionDone(
      { workers: [{ id: "w1", status: "running" }] },
      [{ workerId: "w1", type: "COMPLETE" }],
    ),
    true,
    "a running worker with a COMPLETE ledger event for its id counts as done",
  );

  assert.equal(
    isMissionDone(
      { workers: [{ id: "w1", status: "running" }, { id: "w2", status: "running" }] },
      [{ workerId: "w1", type: "COMPLETE" }],
    ),
    false,
    "the mission is not done while any worker is neither terminal nor ledger-completed",
  );

  assert.equal(
    isMissionDone(
      { workers: [{ id: "w1", status: "running" }, { id: "w2", status: "failed" }] },
      [{ workerId: "w1", type: "FAILED" }],
    ),
    true,
    "FAILED counts as terminal too -- done does not imply success",
  );
}

/* ---------------- end-to-end: chat ask -> confirm -> dispatch ---------------- */

const realFetch = globalThis.fetch;
let terminaUp = true;
let terminaCallCount = 0;
let lastMissionBody: Record<string, unknown> | null = null;
const fakeRoles = [{ name: "Builder", scope: "implement the fix", deliverables: ["passing tests"], prohibited: ["touching prod"] }];
const missionsById = new Map<string, unknown>();

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input);
  if (!url.startsWith("http://127.0.0.1:7420")) {
    /* This script's own header comment claims no LLM call ever actually
       happens. Previously this branch silently passed every non-Termina
       URL through to the REAL fetch -- so any chat message that fell
       through to the generic admin AI pipeline (a non-confirmation
       follow-up, a bare "yes" with nothing pending, etc.) made a REAL,
       billed network call to whatever live provider this environment's
       real credentials pointed at (observed hitting OpenRouter's GLM
       endpoint during manual verification of this script). Fail closed
       instead: the admin chat pipeline's provider-call layer is built to
       tolerate a failed provider call gracefully
       (callAdminPhantomAiProviderSafe catches and reports a clean
       "status: error" result rather than throwing further), so refusing
       the network here just makes those paths report a clean
       provider-unreachable outcome instead of spending real money and
       real tokens mid-test-run. */
    throw new Error(`test-termina-bridge: refusing real network call to ${url} -- only the mocked Termina endpoint is allowed in this test.`);
  }
  terminaCallCount += 1;

  if (!terminaUp) throw new Error("fetch failed: connection refused");

  const headers = (init?.headers as Record<string, string> | undefined) ?? {};
  const tokenHeader = headers["X-Termina-Token"] ?? headers["x-termina-token"];
  if (url.endsWith("/api/health")) {
    return tokenHeader === "test-termina-token"
      ? new Response(JSON.stringify({ ok: true, app: "termina" }), { status: 200 })
      : new Response(JSON.stringify({ ok: false, error: "bad_token" }), { status: 401 });
  }
  if (tokenHeader !== "test-termina-token") {
    return new Response(JSON.stringify({ ok: false, error: "bad_token" }), { status: 401 });
  }

  if (url.endsWith("/api/missions/decompose")) {
    return new Response(JSON.stringify({ ok: true, roles: fakeRoles, missionName: "Fix the failing test", costUsd: 0.02 }), { status: 200 });
  }

  if (url.endsWith("/api/missions") && init?.method === "POST") {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    lastMissionBody = body;
    const mission = {
      id: "abc123",
      name: body.name,
      objective: body.objective,
      workspaceRoot: body.workspaceRoot,
      launchMode: body.launchMode,
      status: "running",
      createdAt: new Date().toISOString(),
      workers: [{ id: "w1", name: "Builder", status: "starting" }],
    };
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

const MISSION_MESSAGE = "Split this across multiple agents and implement the whole feature end to end.";

try {
  const { app } = await import("../src/index.js");

  /* Self-cleaning precondition: agent runs persist to a real, shared
     .phantom/agent-runs.jsonl (rehydrated at boot -- see agent-runs.ts's
     rehydrateAgentRuns()) so that approvals survive server restarts in
     production. That means a leftover `awaiting_approval` termina_mission
     run from a PRIOR run of this exact test script would still be found as
     "pending" by findLatestPendingMissionRun() the next time this script
     runs for the same demo session -- which would make the "ask" step
     below skip proposing a fresh run and silently fall through to a
     normal chat answer instead, failing assertions in a way that has
     nothing to do with the actual ask/confirm logic under test.

     This must NEVER cancel a real pending mission a real user is actually
     waiting to approve, so the filter below is deliberately narrow: only
     runs whose session_id is one of THIS script's own fixed demo session
     ids AND whose request text is byte-for-byte this script's own
     MISSION_MESSAGE literal qualify. A real business request would not
     coincidentally match both. Cleaned up through the same real,
     sanctioned cancel path (requestAgentRunCancel) -- no direct store
     mutation. */
  {
    const { listAgentRuns, requestAgentRunCancel, rehydrateAgentRuns } = await import("../src/phantom-ai/agent-runs.js");
    const { TERMINA_MISSION_OPERATION } = await import("../src/phantom-ai/termina-mission-executor.js");
    /* index.ts's own startup already awaits rehydrateAgentRuns() before its
       module finishes loading, so by the time the dynamic import() above
       has resolved this really has completed -- awaiting it again here is
       just an explicit, self-documenting guarantee, not extra work. */
    await rehydrateAgentRuns();
    const ownDemoSessionIds = new Set(["admin-jordan", "client-sports-demo"]);
    const leftoverFromEarlierRunsOfThisScript = listAgentRuns({ state: "awaiting_approval", limit: 200 })
      .filter((run) =>
        run.operation === TERMINA_MISSION_OPERATION
        && ownDemoSessionIds.has(run.session_id)
        && run.request === MISSION_MESSAGE);
    for (const run of leftoverFromEarlierRunsOfThisScript) requestAgentRunCancel(run.id);
  }

  const login = async (sessionId: string) => {
    const response = await app.inject({ method: "POST", url: "/auth/demo-login", payload: { sessionId } });
    assert.equal(response.statusCode, 200, `${sessionId} should obtain a local test token.`);
    return parseJson<{ token: string }>(response.payload).token;
  };
  const ownerToken = await login("admin-jordan");
  const devToken = await login("client-sports-demo");

  const chat = async (token: string, message: string) => {
    const response = await app.inject({
      method: "POST",
      url: "/phantom-ai/chat",
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        message,
        user_request: message,
        route_tier: "standard",
        task_type: "chat",
      },
    });
    return { statusCode: response.statusCode, body: parseJson<Record<string, any>>(response.payload) };
  };

  // ---- non-admin sessions never get offered a mission at all ----
  const nonAdminAsk = await chat(devToken, MISSION_MESSAGE);
  assert.equal(nonAdminAsk.statusCode, 200, "Non-admin chat should still succeed.");
  assert.notEqual(nonAdminAsk.body.mission_run?.state, "awaiting_approval", "Non-admin sessions must never see a mission proposal.");
  assert.equal(terminaCallCount, 0, "Nothing should call Termina for a non-admin message.");

  // ---- ask tier: mission-worthy phrasing proposes a run, but calls nothing ----
  const ask = await chat(ownerToken, MISSION_MESSAGE);
  assert.equal(ask.statusCode, 200, "Mission ask should return 200.");
  assert.equal(ask.body.approval_required, true, "Ask response should mark approval as required.");
  assert.equal(ask.body.approval_status, "pending", "Ask response should be pending, not approved.");
  assert.equal(ask.body.mission_run?.state, "awaiting_approval", "A mission run should be proposed in awaiting_approval state.");
  assert.equal(ask.body.mission_run?.operation, "termina_mission", "The proposed run should be the termina_mission operation.");
  assert.equal(terminaCallCount, 0, "Proposing a mission must not call Termina's decompose/create-mission endpoints -- that would spend real cost before approval.");
  const runId = ask.body.mission_run.id as string;

  // ---- asking again (still no explicit yes) must not re-propose or call anything ----
  const askAgain = await chat(ownerToken, "what would that actually involve?");
  assert.equal(askAgain.body.mission_run, undefined, "A non-confirmation follow-up should not touch the pending mission run.");
  assert.equal(terminaCallCount, 0, "Still no Termina call before an explicit yes.");

  // ---- explicit confirm: only now should decompose + createMission fire ----
  const confirm = await chat(ownerToken, "yes, run it");
  assert.equal(confirm.statusCode, 200, "Confirm should return 200.");
  assert.equal(confirm.body.approval_executed, true, "Confirm should mark approval as executed.");
  assert.equal(confirm.body.mission_run?.id, runId, "Confirm should resolve the same run that was proposed.");

  let finalRun: any = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const runResponse = await app.inject({ method: "GET", url: `/phantom-ai/runs/${runId}`, headers: { Authorization: `Bearer ${ownerToken}` } });
    const runBody = parseJson<{ ok: true; run: any }>(runResponse.payload);
    if (["succeeded", "failed", "partially_succeeded"].includes(runBody.run.state)) {
      finalRun = runBody.run;
      break;
    }
    await sleep(25);
  }
  assert.ok(finalRun, "The run should reach a terminal state after approval.");
  assert.equal(finalRun.state, "succeeded", `Run should succeed against the mocked Termina API (got ${finalRun.state}: ${finalRun.error}).`);
  assert.equal(terminaCallCount >= 2, true, "Approval should have triggered at least a decompose call and a create-mission call.");
  assert.ok(lastMissionBody, "createMission should have been called.");
  assert.equal(lastMissionBody!.launchMode, "approval", "createMission must always send launchMode \"approval\", never \"auto\".");
  assert.equal(finalRun.inputs.missionId, "abc123", "The real Termina mission id should be recorded on the run.");

  // ---- single-use: saying "yes" again must not re-dispatch the same run ----
  const callCountAfterFirstConfirm = terminaCallCount;
  const secondYes = await chat(ownerToken, "yes, run it");
  assert.notEqual(secondYes.body.mission_run?.id, runId, "A second 'yes' with no pending run must not reuse the already-approved run id.");
  // No fresh mission text preceded this second "yes", so the heuristic still
  // matches (task_type default) but there is nothing pending to confirm --
  // it is treated as a fresh ask/no-op, never a second dispatch of runId.
  assert.equal(terminaCallCount, callCountAfterFirstConfirm, "A bare 'yes' with no pending mission must not call Termina again.");

  // ---- Termina down: the run fails cleanly instead of crashing ----
  terminaUp = false;
  const ask2 = await chat(ownerToken, MISSION_MESSAGE);
  const runId2 = ask2.body.mission_run.id as string;
  const confirm2 = await chat(ownerToken, "go ahead");
  assert.equal(confirm2.body.approval_executed, true, "Confirm should still report executed even though Termina is down -- failure surfaces via run state.");

  let finalRun2: any = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const runResponse = await app.inject({ method: "GET", url: `/phantom-ai/runs/${runId2}`, headers: { Authorization: `Bearer ${ownerToken}` } });
    const runBody = parseJson<{ ok: true; run: any }>(runResponse.payload);
    if (["succeeded", "failed", "partially_succeeded"].includes(runBody.run.state)) {
      finalRun2 = runBody.run;
      break;
    }
    await sleep(25);
  }
  assert.ok(finalRun2, "The run should still reach a terminal state when Termina is unreachable.");
  assert.equal(finalRun2.state, "failed", "The run should fail cleanly, not crash the server, when Termina is down.");
  assert.match(String(finalRun2.error), /isn't running/i, "The failure message should clearly say Termina isn't running.");
  terminaUp = true;

  await app.close();
  console.log(JSON.stringify({
    ok: true,
    nonAdminNeverOffered: true,
    noCallBeforeApproval: true,
    launchModeAlwaysApproval: true,
    singleUseConfirmed: true,
    terminaDownFailsClean: true,
  }));
} finally {
  globalThis.fetch = realFetch;
}
