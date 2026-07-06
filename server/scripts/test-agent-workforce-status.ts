function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

function parseJson<T>(payload: string): T {
  return JSON.parse(payload) as T;
}

process.env.NODE_ENV = "development";
process.env.PHANTOMFORCE_SERVER_LISTEN = "false";
process.env.PHANTOMFORCE_SERVER_LOGGER = "false";
process.env.PHANTOMFORCE_AUTH_PROVIDER = "demo";
process.env.PHANTOMFORCE_ENABLE_DEMO_AUTH = "true";
process.env.PHANTOMFORCE_ALLOW_UNSIGNED_SESSION_HEADER = "false";

const { app } = await import("../src/index.js");

type LoginResponse = {
  ok: boolean;
  token: string;
};

type AdminAgentStatusResponse = {
  ok: true;
  read_only: true;
  workforce: {
    role: "admin";
    summary: {
      window_hours: number;
      tasks_in_window: number;
      tokens_in_window: number;
      active_workers: number;
      total_workers: number;
      subagents_mapped: number;
      tool_count: number;
    };
    workers: Array<{
      id: string;
      name: string;
      state: string;
      tasks_last_24h: number;
      tokens_last_24h: number;
      tool_binding: string;
    }>;
    subagents: Array<{
      id: string;
      name: string;
      tasks_last_24h: number;
      tokens_last_24h: number;
    }>;
    assignments: Array<{
      id: string;
      owner: string;
      destination_route: string;
      action_label: string;
    }>;
    programs: Array<{
      id: string;
      manager_agent: string;
      current_use: string;
      action_id: string;
      commercial_visible: false;
      destination_route: string;
    }>;
    ticker: Array<{
      id: string;
      label: string;
      text: string;
    }>;
    tool_stack: Array<{
      id: string;
      display_name: string;
      state: string;
      allowed_mode: string;
    }>;
    safety_flags: {
      read_only: true;
      provider_called: false;
      external_call_performed: false;
      n8n_started: false;
      workflow_executed: false;
    };
  };
};

type ClientAgentStatusResponse = {
  ok: true;
  read_only: true;
  workforce: {
    role: "client";
    summary: {
      active_agent_count: number;
      total_agent_count: number;
      label: string;
    };
    details_redacted: true;
    token_usage_visible: false;
    tool_stack_visible: false;
  };
};

try {
  const unauth = await app.inject({
    method: "GET",
    url: "/phantom-ai/agents/status",
  });
  assert(unauth.statusCode === 401, "Unauthenticated agent status should return 401.");

  const adminLogin = await app.inject({
    method: "POST",
    url: "/auth/demo-login",
    headers: { "Content-Type": "application/json" },
    payload: JSON.stringify({ sessionId: "admin-jordan" }),
  });
  assert(adminLogin.statusCode === 200, "Admin demo login should succeed.");
  const adminToken = parseJson<LoginResponse>(adminLogin.payload).token;

  const adminStatus = await app.inject({
    method: "GET",
    url: "/phantom-ai/agents/status?window_hours=24",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert(adminStatus.statusCode === 200, "Admin agent status should return 200.");
  const adminBody = parseJson<AdminAgentStatusResponse>(adminStatus.payload);
  const adminPayload = JSON.stringify(adminBody);
  assert(adminBody.ok === true, "Admin response should be ok.");
  assert(adminBody.read_only === true, "Agent status must be read-only.");
  assert(adminBody.workforce.role === "admin", "Admin response should expose admin role.");
  assert(adminBody.workforce.summary.window_hours === 24, "Window should be honored.");
  assert(adminBody.workforce.summary.total_workers >= 8, "Admin should see the worker map.");
  assert(adminBody.workforce.summary.subagents_mapped >= 10, "Admin should see subagent map.");
  assert(adminBody.workforce.workers.some((worker) => worker.id === "gatekeeper"), "Gatekeeper should exist.");
  assert(adminBody.workforce.workers.every((worker) => typeof worker.tokens_last_24h === "number"), "Workers should expose token usage.");
  assert(adminBody.workforce.tool_stack.some((tool) => tool.id === "n8n"), "Tool stack should include n8n.");
  assert(adminBody.workforce.tool_stack.some((tool) => tool.id === "openspec"), "Tool stack should include OpenSpec.");
  assert(adminBody.workforce.tool_stack.some((tool) => tool.id === "agent-os"), "Tool stack should include PhantomOps.");
  assert(adminBody.workforce.assignments.length >= 6, "Admin should see functional workforce assignment cards.");
  assert(
    adminBody.workforce.assignments.some((assignment) => assignment.destination_route === "security"),
    "Assignments should route Sentinel to the Scanner.",
  );
  assert(adminBody.workforce.programs.some((program) => program.id === "n8n"), "Programs should include n8n use state.");
  assert(
    adminBody.workforce.programs.every((program) => program.commercial_visible === false),
    "Internal program names must remain admin-only.",
  );
  assert(!adminPayload.includes("PHANTOM_PI"), "Admin workforce payload must not expose hidden harness env keys.");
  assert(!adminPayload.includes("minimal_agent_harness"), "Admin workforce payload must not expose hidden harness ids.");
  assert(!adminPayload.includes('"Pi"'), "Admin workforce payload must not expose raw hidden harness brand.");
  assert(adminBody.workforce.ticker.length >= 3, "Admin should receive an activity ticker.");
  assert(
    adminBody.workforce.ticker.some((item) => item.text.includes("tokens")),
    "Ticker should include token-backed work updates.",
  );
  assert(
    adminBody.workforce.programs.some((program) => program.action_id === "openspec-proposal"),
    "Programs should expose safe action ids.",
  );
  assert(adminBody.workforce.safety_flags.provider_called === false, "Status route must not call providers.");
  assert(adminBody.workforce.safety_flags.external_call_performed === false, "Status route must not call external APIs.");
  assert(adminBody.workforce.safety_flags.n8n_started === false, "Status route must not start n8n.");
  assert(adminBody.workforce.safety_flags.workflow_executed === false, "Status route must not execute workflows.");

  const clientLogin = await app.inject({
    method: "POST",
    url: "/auth/demo-login",
    headers: { "Content-Type": "application/json" },
    payload: JSON.stringify({ sessionId: "client-sports-demo" }),
  });
  assert(clientLogin.statusCode === 200, "Client demo login should succeed.");
  const clientToken = parseJson<LoginResponse>(clientLogin.payload).token;

  const clientStatus = await app.inject({
    method: "GET",
    url: "/phantom-ai/agents/status",
    headers: { Authorization: `Bearer ${clientToken}` },
  });
  assert(clientStatus.statusCode === 200, "Client agent status should return 200.");
  const clientBody = parseJson<ClientAgentStatusResponse>(clientStatus.payload);
  const clientPayload = JSON.stringify(clientBody);
  assert(clientBody.workforce.role === "client", "Client response should be redacted client view.");
  assert(clientBody.workforce.details_redacted === true, "Client details should be redacted.");
  assert(clientBody.workforce.token_usage_visible === false, "Client must not see token usage.");
  assert(clientBody.workforce.tool_stack_visible === false, "Client must not see tool stack.");
  assert(!("tool_stack" in clientBody.workforce), "Client workforce should not include tool stack records.");
  assert(!clientPayload.includes("tokens_last_24h"), "Client payload must not include per-agent token usage.");
  assert(!clientPayload.includes('"tool_stack":'), "Client payload must not include tool stack records.");

  const actions = await app.inject({
    method: "GET",
    url: "/phantom-ai/agents/actions",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert(actions.statusCode === 200, "Admin agent actions list should return 200.");
  const actionsBody = parseJson<{
    ok: true;
    actions: Array<{ id: string; product_repo_edits: false; external_actions: false; provider_calls: false }>;
  }>(actions.payload);
  assert(actionsBody.actions.some((action) => action.id === "n8n-readiness"), "n8n readiness action should be listed.");
  assert(actionsBody.actions.some((action) => action.id === "serena-readonly-profile"), "Serena read-only action should be listed.");
  assert(actionsBody.actions.every((action) => action.product_repo_edits === false), "Actions must not edit product repos.");
  assert(actionsBody.actions.every((action) => action.external_actions === false), "Actions must not perform external actions.");
  assert(actionsBody.actions.every((action) => action.provider_calls === false), "Actions must not call providers.");

  const clientActions = await app.inject({
    method: "GET",
    url: "/phantom-ai/agents/actions",
    headers: { Authorization: `Bearer ${clientToken}` },
  });
  assert(clientActions.statusCode === 403, "Client must not list admin agent actions.");

  const n8nAction = await app.inject({
    method: "POST",
    url: "/phantom-ai/agents/actions/run",
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    payload: JSON.stringify({ action_id: "n8n-readiness" }),
  });
  assert(n8nAction.statusCode === 200, "n8n safe action should run.");
  const n8nActionBody = parseJson<{
    ok: true;
    result: {
      ok: true;
      safety_flags: {
        provider_calls: false;
        n8n_started: false;
        workflow_executed: false;
        credentials_used: false;
      };
    };
  }>(n8nAction.payload);
  assert(n8nActionBody.result.safety_flags.provider_calls === false, "Action must not call providers.");
  assert(n8nActionBody.result.safety_flags.n8n_started === false, "Action must not start n8n.");
  assert(n8nActionBody.result.safety_flags.workflow_executed === false, "Action must not execute workflows.");

  const openspecPreview = await app.inject({
    method: "POST",
    url: "/phantom-ai/agents/actions/run",
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    payload: JSON.stringify({ action_id: "openspec-proposal", title: "Test workforce proposal preview", write: false }),
  });
  assert(openspecPreview.statusCode === 200, "OpenSpec preview action should run.");
  const openspecBody = parseJson<{
    ok: true;
    result: { ok: true; output: { written: false; product_repo_edits: false; external_actions: false } };
  }>(openspecPreview.payload);
  assert(openspecBody.result.output.written === false, "Test must not write an OpenSpec proposal.");
  assert(openspecBody.result.output.product_repo_edits === false, "OpenSpec action must not edit product repos.");

  console.log(
    JSON.stringify(
      {
        ok: true,
        unauthStatus: unauth.statusCode,
        adminStatus: adminStatus.statusCode,
        clientStatus: clientStatus.statusCode,
        totalWorkers: adminBody.workforce.summary.total_workers,
        activeWorkers: adminBody.workforce.summary.active_workers,
        subagentsMapped: adminBody.workforce.summary.subagents_mapped,
        toolCount: adminBody.workforce.summary.tool_count,
        clientLabel: clientBody.workforce.summary.label,
        providerCalled: adminBody.workforce.safety_flags.provider_called,
        n8nStarted: adminBody.workforce.safety_flags.n8n_started,
        workflowExecuted: adminBody.workforce.safety_flags.workflow_executed,
      },
      null,
      2,
    ),
  );
} finally {
  await app.close();
}
