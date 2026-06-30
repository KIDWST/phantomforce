import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

function parseJson<T>(payload: string): T {
  return JSON.parse(payload) as T;
}

const tempDir = mkdtempSync(join(tmpdir(), "phantom-chicagoshots-history-route-"));
process.env.NODE_ENV = "development";
process.env.PHANTOMFORCE_SERVER_LISTEN = "false";
process.env.PHANTOMFORCE_SERVER_LOGGER = "false";
process.env.PHANTOMFORCE_AUTH_PROVIDER = "demo";
process.env.PHANTOMFORCE_ENABLE_DEMO_AUTH = "true";
process.env.PHANTOMFORCE_ALLOW_UNSIGNED_SESSION_HEADER = "false";
process.env.PHANTOM_CHICAGOSHOTS_PROPOSAL_HISTORY_PATH = join(tempDir, "proposal-history.jsonl");

const { app } = await import("../src/index.js");

type LoginResponse = {
  ok: boolean;
  token: string;
};

type PreviewResponse = {
  ok: boolean;
  lead: unknown;
};

type SaveResponse = {
  ok: boolean;
  record: {
    id: string;
    client_name: string;
    status: string;
    package: string;
    recommended_package: string;
    recommended_price_range: string;
    client_ready_proposal: string;
    exported_markdown: string;
    safety_flags: {
      external_send: false;
      provider_called: false;
      n8n_executed: false;
      approval_executed: false;
      queue_written: false;
      production_ledger_write: false;
      payment_request_created: false;
      invoice_created: false;
    };
  };
};

type HistoryResponse = {
  ok: boolean;
  records: Array<{ id: string; status: string }>;
  summary_counts: {
    total: number;
    draft: number;
    sent_manually: number;
    follow_up_needed: number;
    won: number;
    lost: number;
  };
};

type StatusUpdateResponse = {
  ok: boolean;
  status: string;
  record: SaveResponse["record"] & {
    status_updated_at: string;
  };
  provider_called: false;
  external_send: false;
  n8n_executed: false;
  approval_executed: false;
  queue_written: false;
  production_ledger_write: false;
  payment_request_created: false;
  invoice_created: false;
};

try {
  const unauth = await app.inject({
    method: "GET",
    url: "/phantom-ai/ops/chicagoshots/proposal-history",
  });
  assert(unauth.statusCode === 401, "Unauthenticated history list should return 401.");

  const clientLogin = await app.inject({
    method: "POST",
    url: "/auth/demo-login",
    headers: { "Content-Type": "application/json" },
    payload: JSON.stringify({ sessionId: "client-chicagoshots" }),
  });
  assert(clientLogin.statusCode === 200, "Client demo login should succeed.");
  const clientToken = parseJson<LoginResponse>(clientLogin.payload).token;

  const clientHistory = await app.inject({
    method: "GET",
    url: "/phantom-ai/ops/chicagoshots/proposal-history",
    headers: { Authorization: `Bearer ${clientToken}` },
  });
  assert(clientHistory.statusCode === 403, "Client/non-admin history list should return 403.");

  const adminLogin = await app.inject({
    method: "POST",
    url: "/auth/demo-login",
    headers: { "Content-Type": "application/json" },
    payload: JSON.stringify({ sessionId: "admin-jordan" }),
  });
  assert(adminLogin.statusCode === 200, "Admin demo login should succeed.");
  const adminToken = parseJson<LoginResponse>(adminLogin.payload).token;
  const adminHeaders = {
    Authorization: `Bearer ${adminToken}`,
    "Content-Type": "application/json",
  };

  const emptyHistory = await app.inject({
    method: "GET",
    url: "/phantom-ai/ops/chicagoshots/proposal-history",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert(emptyHistory.statusCode === 200, "Admin history list should return 200.");

  const preview = await app.inject({
    method: "POST",
    url: "/phantom-ai/ops/chicagoshots/lead-intake/preview",
    headers: adminHeaders,
    payload: JSON.stringify({
      tenant_id: "chicagoshots",
      client_name: "Coach Ramirez",
      contact: "coach@example.com",
      event_type: "sports tournament",
      date_time: "Saturday afternoon",
      location: "South Loop fieldhouse",
      requested_service: "team action photos and highlight clips",
      budget_rate: "$1,200 target",
      source_platform: "Instagram DM",
      urgency: "high",
      notes: "Parent booster group wants fast action coverage.",
    }),
  });
  assert(preview.statusCode === 200, "Admin lead preview should return 200.");
  const previewBody = parseJson<PreviewResponse>(preview.payload);
  assert(previewBody.ok === true && previewBody.lead, "Preview should return a lead packet.");

  const exportedMarkdown = [
    "# ChicagoShots Proposal Draft",
    "",
    "Prepared for: Coach Ramirez",
    "Project: sports tournament",
    "",
    "Preview only. No send. No payment request. No invoice. No queue write. No ledger write.",
  ].join("\n");
  const clientReadyProposal = [
    "# ChicagoShots Proposal Draft",
    "",
    "Prepared for: Coach Ramirez",
    "Project: sports tournament",
    "",
    "Quote range: $750-$1,500",
  ].join("\n");
  const save = await app.inject({
    method: "POST",
    url: "/phantom-ai/ops/chicagoshots/proposal-history/save",
    headers: adminHeaders,
    payload: JSON.stringify({
      packet: previewBody.lead,
      proposal_summary: "Coach Ramirez - Sports / Action",
      client_ready_proposal: clientReadyProposal,
      exported_markdown: exportedMarkdown,
    }),
  });
  assert(save.statusCode === 200, "Admin save should return 200.");
  const saveBody = parseJson<SaveResponse>(save.payload);
  assert(saveBody.ok === true, "Save response should be ok.");
  assert(saveBody.record.client_name === "Coach Ramirez", "Saved record should keep client name.");
  assert(saveBody.record.status === "draft", "Saved record should start as draft.");
  assert(saveBody.record.package === "Sports / Action", "Saved record should keep package.");
  assert(saveBody.record.recommended_package === "Sports / Action", "Saved record should expose recommended_package.");
  assert(saveBody.record.client_ready_proposal.includes("Quote range"), "Saved record should include client_ready_proposal.");
  assert(saveBody.record.safety_flags.external_send === false, "Saved record must not send externally.");
  assert(saveBody.record.safety_flags.provider_called === false, "Saved record must not call providers.");
  assert(saveBody.record.safety_flags.n8n_executed === false, "Saved record must not execute n8n.");
  assert(saveBody.record.safety_flags.approval_executed === false, "Saved record must not execute approvals.");
  assert(saveBody.record.safety_flags.queue_written === false, "Saved record must not write queues.");
  assert(saveBody.record.safety_flags.production_ledger_write === false, "Saved record must not write production ledgers.");
  assert(saveBody.record.safety_flags.payment_request_created === false, "Saved record must not create payment requests.");
  assert(saveBody.record.safety_flags.invoice_created === false, "Saved record must not create invoices.");

  const history = await app.inject({
    method: "GET",
    url: "/phantom-ai/ops/chicagoshots/proposal-history",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert(history.statusCode === 200, "Admin history list after save should return 200.");
  const historyBody = parseJson<HistoryResponse>(history.payload);
  assert(historyBody.records.some((record) => record.id === saveBody.record.id), "History list should include saved packet.");
  assert(historyBody.summary_counts.total === 1, "History response should include total saved count.");
  assert(historyBody.summary_counts.draft === 1, "History response should count draft proposals.");

  const unauthStatusUpdate = await app.inject({
    method: "PATCH",
    url: `/phantom-ai/ops/chicagoshots/proposal-history/${saveBody.record.id}/status`,
    headers: {
      "Content-Type": "application/json",
    },
    payload: JSON.stringify({ status: "follow_up_needed" }),
  });
  assert(unauthStatusUpdate.statusCode === 401, "Unauthenticated status update should return 401.");

  const clientStatusUpdate = await app.inject({
    method: "PATCH",
    url: `/phantom-ai/ops/chicagoshots/proposal-history/${saveBody.record.id}/status`,
    headers: {
      Authorization: `Bearer ${clientToken}`,
      "Content-Type": "application/json",
    },
    payload: JSON.stringify({ status: "follow_up_needed" }),
  });
  assert(clientStatusUpdate.statusCode === 403, "Client/non-admin status update should return 403.");

  const invalidStatusUpdate = await app.inject({
    method: "PATCH",
    url: `/phantom-ai/ops/chicagoshots/proposal-history/${saveBody.record.id}/status`,
    headers: adminHeaders,
    payload: JSON.stringify({ status: "emailed_automatically" }),
  });
  assert(invalidStatusUpdate.statusCode === 400, "Invalid proposal status should return 400.");

  const sentUpdate = await app.inject({
    method: "PATCH",
    url: `/phantom-ai/ops/chicagoshots/proposal-history/${saveBody.record.id}/status`,
    headers: adminHeaders,
    payload: JSON.stringify({ status: "sent_manually" }),
  });
  assert(sentUpdate.statusCode === 200, "Admin sent-manually status update should return 200.");
  const sentBody = parseJson<StatusUpdateResponse>(sentUpdate.payload);
  assert(sentBody.status === "sent_manually", "Status update response should show sent manually.");
  assert(sentBody.provider_called === false, "Sent-manually status update must not call providers.");
  assert(sentBody.external_send === false, "Sent-manually status update must not send externally.");
  assert(sentBody.payment_request_created === false, "Sent-manually status update must not create payment requests.");
  assert(sentBody.invoice_created === false, "Sent-manually status update must not create invoices.");

  const followUpUpdate = await app.inject({
    method: "PATCH",
    url: `/phantom-ai/ops/chicagoshots/proposal-history/${saveBody.record.id}/status`,
    headers: adminHeaders,
    payload: JSON.stringify({ status: "follow_up_needed" }),
  });
  assert(followUpUpdate.statusCode === 200, "Admin status update should return 200.");
  const followUpBody = parseJson<StatusUpdateResponse>(followUpUpdate.payload);
  assert(followUpBody.status === "follow_up_needed", "Status update response should show follow-up needed.");
  assert(followUpBody.provider_called === false, "Status update must not call providers.");
  assert(followUpBody.external_send === false, "Status update must not send externally.");
  assert(followUpBody.n8n_executed === false, "Status update must not execute n8n.");
  assert(followUpBody.approval_executed === false, "Status update must not execute approvals.");
  assert(followUpBody.queue_written === false, "Status update must not write queues.");
  assert(followUpBody.production_ledger_write === false, "Status update must not write production ledgers.");
  assert(followUpBody.payment_request_created === false, "Status update must not create payment requests.");
  assert(followUpBody.invoice_created === false, "Status update must not create invoices.");

  const wonUpdate = await app.inject({
    method: "PATCH",
    url: `/phantom-ai/ops/chicagoshots/proposal-history/${saveBody.record.id}/status`,
    headers: adminHeaders,
    payload: JSON.stringify({ status: "won" }),
  });
  assert(wonUpdate.statusCode === 200, "Admin won status update should return 200.");
  const wonBody = parseJson<StatusUpdateResponse>(wonUpdate.payload);
  assert(wonBody.status === "won", "Status update response should show won.");

  const updatedHistory = await app.inject({
    method: "GET",
    url: "/phantom-ai/ops/chicagoshots/proposal-history",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert(updatedHistory.statusCode === 200, "Admin history after status update should return 200.");
  const updatedHistoryBody = parseJson<HistoryResponse>(updatedHistory.payload);
  assert(updatedHistoryBody.records.some((record) => record.id === saveBody.record.id && record.status === "won"), "History list should show latest won status.");
  assert(updatedHistoryBody.summary_counts.won === 1, "History response should count won proposals.");
  assert(updatedHistoryBody.summary_counts.draft === 0, "History response should remove replaced draft count.");

  const byId = await app.inject({
    method: "GET",
    url: `/phantom-ai/ops/chicagoshots/proposal-history/${saveBody.record.id}`,
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert(byId.statusCode === 200, "Admin history by-id lookup should return 200.");

  const executeRoute = await app.inject({
    method: "POST",
    url: "/phantom-ai/approvals/execute",
    headers: adminHeaders,
    payload: JSON.stringify({}),
  });
  assert(executeRoute.statusCode === 404, "/phantom-ai/approvals/execute must remain absent.");

  console.log(
    JSON.stringify(
      {
        ok: true,
        unauthStatus: unauth.statusCode,
        clientStatus: clientHistory.statusCode,
        adminStatus: emptyHistory.statusCode,
        saveStatus: save.statusCode,
        unauthStatusUpdateStatus: unauthStatusUpdate.statusCode,
        clientStatusUpdateStatus: clientStatusUpdate.statusCode,
        invalidStatusUpdateStatus: invalidStatusUpdate.statusCode,
        sentUpdateStatus: sentUpdate.statusCode,
        followUpUpdateStatus: followUpUpdate.statusCode,
        wonUpdateStatus: wonUpdate.statusCode,
        byIdStatus: byId.statusCode,
        approvalsExecuteStatus: executeRoute.statusCode,
        savedId: saveBody.record.id,
        client: saveBody.record.client_name,
        package: saveBody.record.package,
        currentStatus: wonBody.status,
        totalSaved: updatedHistoryBody.summary_counts.total,
        wonCount: updatedHistoryBody.summary_counts.won,
        recommendedPackage: saveBody.record.recommended_package,
        clientReadyProposal: saveBody.record.client_ready_proposal.includes("Quote range"),
        providerCalled: saveBody.record.safety_flags.provider_called,
        externalSend: saveBody.record.safety_flags.external_send,
        n8nExecuted: saveBody.record.safety_flags.n8n_executed,
        approvalExecuted: saveBody.record.safety_flags.approval_executed,
        queueWritten: saveBody.record.safety_flags.queue_written,
        productionLedgerWrite: saveBody.record.safety_flags.production_ledger_write,
        paymentRequestCreated: saveBody.record.safety_flags.payment_request_created,
        invoiceCreated: saveBody.record.safety_flags.invoice_created,
      },
      null,
      2,
    ),
  );
} finally {
  await app.close();
  rmSync(tempDir, { recursive: true, force: true });
}
