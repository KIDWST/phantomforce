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

type SendReadiness = {
  status: "planned_disabled";
  send_enabled: false;
  send_route_present: false;
  approval_required: true;
  manual_operator_confirmation_required: true;
  automatic_send_allowed: false;
  bulk_send_allowed: false;
  queue_execution_allowed: false;
  test_allowlist_required: true;
  test_allowlist_configured: false;
  credentials_configured: false;
  credentials_status: "not_configured_no_secret_read";
  external_send: false;
  provider_called: false;
  n8n_executed: false;
  approval_execution: false;
  queue_write: false;
  production_ledger_write: false;
  audit_receipt_required: true;
  audit_receipt_written: false;
  architecture: string[];
  next_required_before_send: string[];
};

type SendReadinessResponse = {
  ok: boolean;
  read_only: true;
  send_readiness: SendReadiness;
};

type OpsStatusResponse = {
  ok: boolean;
  read_only: true;
  status: {
    send_readiness: SendReadiness;
    safety_flags: {
      external_sends_disabled: true;
      queue_writes_disabled: true;
      production_ledger_writes_disabled: true;
      approval_executed: false;
      queue_written: false;
      production_ledger_written: false;
    };
  };
};

try {
  const unauth = await app.inject({
    method: "GET",
    url: "/phantom-ai/ops/send-readiness/status",
  });
  assert(unauth.statusCode === 401, "Unauthenticated send readiness status should return 401.");

  const clientLogin = await app.inject({
    method: "POST",
    url: "/auth/demo-login",
    headers: { "Content-Type": "application/json" },
    payload: JSON.stringify({ sessionId: "client-chicagoshots" }),
  });
  assert(clientLogin.statusCode === 200, "Client demo login should succeed.");
  const clientToken = parseJson<LoginResponse>(clientLogin.payload).token;

  const clientStatus = await app.inject({
    method: "GET",
    url: "/phantom-ai/ops/send-readiness/status",
    headers: { Authorization: `Bearer ${clientToken}` },
  });
  assert(clientStatus.statusCode === 403, "Client/non-admin send readiness status should return 403.");

  const adminLogin = await app.inject({
    method: "POST",
    url: "/auth/demo-login",
    headers: { "Content-Type": "application/json" },
    payload: JSON.stringify({ sessionId: "admin-jordan" }),
  });
  assert(adminLogin.statusCode === 200, "Admin demo login should succeed.");
  const adminToken = parseJson<LoginResponse>(adminLogin.payload).token;
  const headers = { Authorization: `Bearer ${adminToken}` };

  const status = await app.inject({
    method: "GET",
    url: "/phantom-ai/ops/send-readiness/status",
    headers,
  });
  assert(status.statusCode === 200, "Admin send readiness status should return 200.");
  const body = parseJson<SendReadinessResponse>(status.payload);
  const readiness = body.send_readiness;

  assert(body.ok === true, "Readiness response should be ok.");
  assert(body.read_only === true, "Readiness response must be read-only.");
  assert(readiness.status === "planned_disabled", "Send readiness must be planned/disabled.");
  assert(readiness.send_enabled === false, "Send must be disabled.");
  assert(readiness.send_route_present === false, "No send route may be present.");
  assert(readiness.approval_required === true, "Approval must be required before any future send.");
  assert(
    readiness.manual_operator_confirmation_required === true,
    "Manual operator confirmation must be required before any future send.",
  );
  assert(readiness.automatic_send_allowed === false, "Automatic send must not be allowed.");
  assert(readiness.bulk_send_allowed === false, "Bulk send must not be allowed.");
  assert(readiness.queue_execution_allowed === false, "Queue execution must not be allowed.");
  assert(readiness.test_allowlist_required === true, "Test recipient allowlist must be required.");
  assert(readiness.credentials_configured === false, "Credentials must not be configured by this route.");
  assert(readiness.external_send === false, "Readiness status must not send externally.");
  assert(readiness.provider_called === false, "Readiness status must not call a provider.");
  assert(readiness.n8n_executed === false, "Readiness status must not execute n8n.");
  assert(readiness.approval_execution === false, "Readiness status must not execute approvals.");
  assert(readiness.queue_write === false, "Readiness status must not write queues.");
  assert(readiness.production_ledger_write === false, "Readiness status must not write production ledgers.");
  assert(readiness.audit_receipt_required === true, "Future sends must require audit receipts.");
  assert(readiness.audit_receipt_written === false, "Status route must not write audit receipts.");

  const opsStatus = await app.inject({
    method: "GET",
    url: "/phantom-ai/ops/status",
    headers,
  });
  assert(opsStatus.statusCode === 200, "Ops status should return 200.");
  const opsBody = parseJson<OpsStatusResponse>(opsStatus.payload);
  assert(opsBody.status.send_readiness.send_enabled === false, "Ops status must expose disabled send readiness.");
  assert(opsBody.status.send_readiness.send_route_present === false, "Ops status must expose no send route.");
  assert(opsBody.status.safety_flags.external_sends_disabled === true, "External sends must stay disabled.");
  assert(opsBody.status.safety_flags.queue_writes_disabled === true, "Queue writes must stay disabled.");
  assert(
    opsBody.status.safety_flags.production_ledger_writes_disabled === true,
    "Production ledger writes must stay disabled.",
  );

  const executeRoute = await app.inject({
    method: "POST",
    url: "/phantom-ai/approvals/execute",
    headers: { ...headers, "Content-Type": "application/json" },
    payload: JSON.stringify({}),
  });
  assert(executeRoute.statusCode === 404, "/phantom-ai/approvals/execute must remain absent.");

  console.log(
    JSON.stringify(
      {
        ok: true,
        unauthStatus: unauth.statusCode,
        clientStatus: clientStatus.statusCode,
        adminStatus: status.statusCode,
        opsStatus: opsStatus.statusCode,
        approvalsExecuteStatus: executeRoute.statusCode,
        sendEnabled: readiness.send_enabled,
        sendRoutePresent: readiness.send_route_present,
        approvalRequired: readiness.approval_required,
        manualConfirmationRequired: readiness.manual_operator_confirmation_required,
        testAllowlistRequired: readiness.test_allowlist_required,
        credentialsConfigured: readiness.credentials_configured,
        externalSend: readiness.external_send,
        providerCalled: readiness.provider_called,
        n8nExecuted: readiness.n8n_executed,
        approvalExecution: readiness.approval_execution,
        queueWrite: readiness.queue_write,
        productionLedgerWrite: readiness.production_ledger_write,
        auditReceiptRequired: readiness.audit_receipt_required,
      },
      null,
      2,
    ),
  );
} finally {
  await app.close();
}
