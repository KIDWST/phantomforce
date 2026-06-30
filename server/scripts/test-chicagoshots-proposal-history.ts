import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createChicagoShotsProposalHistoryRecord,
  persistChicagoShotsProposalHistoryRecord,
  readChicagoShotsProposalHistoryRecordById,
  readChicagoShotsProposalHistoryRecords,
  updateChicagoShotsProposalHistoryRecordStatus,
} from "../src/phantom-ai/chicagoshots-proposal-history.js";
import { buildChicagoShotsLeadIntakePreview } from "../src/phantom-ai/ops-workflow.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

const source = readFileSync(new URL("../src/phantom-ai/chicagoshots-proposal-history.ts", import.meta.url), "utf8");
assert(!/\bfetch\s*\(/i.test(source), "Proposal history store must not add fetch calls.");
assert(!/\bhttps?\.request\b/i.test(source), "Proposal history store must not add HTTP request calls.");
assert(!/\baxios\s*\(/i.test(source), "Proposal history store must not add axios calls.");
assert(!/\bappendHermesLedgerRecord\b/i.test(source), "Proposal history store must not write Hermes ledgers.");
assert(!/\bpersistApprovalQueuePreview\b|\bappendApprovalQueueTransition\b/i.test(source), "Proposal history store must not write approval queues.");
assert(!/\bn8n\b/i.test(source), "Proposal history store must not execute or reference n8n.");

const tempDir = mkdtempSync(join(tmpdir(), "phantom-chicagoshots-history-"));
const storePath = join(tempDir, "proposal-history.jsonl");
const fakeApiKeyValue = ["sk", "chishots", "0123456789abcdef"].join("-");

try {
  const packet = await buildChicagoShotsLeadIntakePreview(
    {
      tenant_id: "chicagoshots",
      actor_user_id: "admin-jordan",
      client_name: "Coach Ramirez",
      contact: "coach@example.com",
      event_type: "sports tournament",
      date_time: "Saturday afternoon",
      location: "South Loop fieldhouse",
      requested_service: "team action photos and highlight clips",
      budget_rate: "$1,200 target",
      notes: `Needs fast delivery. api_key=${fakeApiKeyValue}`,
      source_platform: "Instagram DM",
      urgency: "high",
    },
    { storePath: join(tempDir, "memory.jsonl"), now: "2026-06-30T15:00:00.000Z" },
  );

  const markdown = [
    "# ChicagoShots Proposal Draft",
    "",
    "Prepared for: Coach Ramirez",
    "Project: sports tournament",
    "",
    `Internal secret check api_key=${fakeApiKeyValue}`,
  ].join("\n");
  const clientReadyProposal = [
    "# ChicagoShots Proposal Draft",
    "",
    "Prepared for: Coach Ramirez",
    "Project: sports tournament",
    "",
    "Quote range: $750-$1,500",
  ].join("\n");
  const record = createChicagoShotsProposalHistoryRecord({
    packet,
    proposalSummary: `${packet.normalized_lead.client_name} - ${packet.recommended_service_package.name}`,
    clientReadyProposal,
    exportedMarkdown: markdown,
  });
  const recordJson = JSON.stringify(record);

  assert(record.client_name === "Coach Ramirez", "Record should keep the client name.");
  assert(record.status === "draft", "New saved proposals should start as draft.");
  assert(record.package === "Sports / Action", "Record should keep the package name.");
  assert(record.recommended_package === "Sports / Action", "Record should expose recommended_package.");
  assert(record.recommended_price_range === "$750-$1,500", "Record should keep the price range.");
  assert(record.delivery_timeline.length > 0, "Record should keep the delivery timeline.");
  assert(record.follow_up_channel === "email", "Record should keep the follow-up channel.");
  assert(record.client_ready_proposal.includes("Quote range: $750-$1,500"), "Record should keep client-ready proposal copy.");
  assert(record.exported_markdown.includes("[redacted"), "Record should redact sensitive markdown.");
  assert(!recordJson.includes(fakeApiKeyValue), "Record must not store raw API keys.");
  assert(record.safety_flags.external_send === false, "History must not send externally.");
  assert(record.safety_flags.provider_called === false, "History must not call providers.");
  assert(record.safety_flags.n8n_executed === false, "History must not execute n8n.");
  assert(record.safety_flags.approval_executed === false, "History must not execute approvals.");
  assert(record.safety_flags.queue_written === false, "History must not write queues.");
  assert(record.safety_flags.production_ledger_write === false, "History must not write production ledgers.");
  assert(record.safety_flags.payment_request_created === false, "History must not create payment requests.");
  assert(record.safety_flags.invoice_created === false, "History must not create invoices.");

  const persistence = await persistChicagoShotsProposalHistoryRecord(record, { storePath });
  assert(persistence.persisted === true, "Record should persist locally in development mode.");
  assert(persistence.reason === "persisted_local_admin_only", "Persist reason should describe local admin history.");

  const blockedPersistence = await persistChicagoShotsProposalHistoryRecord(record, {
    storePath: join(tempDir, "blocked.jsonl"),
    env: { NODE_ENV: "production" },
  });
  assert(blockedPersistence.persisted === false, "Production-mode history writes must be blocked.");
  assert(blockedPersistence.reason === "production_write_blocked", "Production block reason should be explicit.");

  const history = await readChicagoShotsProposalHistoryRecords({ storePath });
  assert(history.records.length === 1, "History list should return the saved packet.");
  assert(history.records[0].id === record.id, "History list should preserve the record id.");
  assert(history.status_counts.total === 1, "History should count total saved proposals.");
  assert(history.status_counts.draft === 1, "History should count draft proposals.");

  const byId = await readChicagoShotsProposalHistoryRecordById(record.id, { storePath });
  assert(byId?.id === record.id, "History lookup should return the saved packet by id.");

  const wonUpdate = await updateChicagoShotsProposalHistoryRecordStatus(record.id, "won", {
    storePath,
    updatedAt: "2026-06-30T16:00:00.000Z",
  });
  assert(wonUpdate.found === true, "Status update should find the saved proposal.");
  assert(wonUpdate.record?.status === "won", "Status update should mark the proposal won.");
  assert(wonUpdate.record?.status_updated_at === "2026-06-30T16:00:00.000Z", "Status update timestamp should persist.");
  assert(wonUpdate.record?.safety_flags.external_send === false, "Status update must not send externally.");
  assert(wonUpdate.record?.safety_flags.queue_written === false, "Status update must not write queues.");
  assert(wonUpdate.record?.safety_flags.production_ledger_write === false, "Status update must not write production ledgers.");

  const updatedHistory = await readChicagoShotsProposalHistoryRecords({ storePath });
  assert(updatedHistory.records[0].status === "won", "History should return latest status by proposal id.");
  assert(updatedHistory.status_counts.won === 1, "History should count won proposals.");
  assert(updatedHistory.status_counts.draft === 0, "Latest status should replace draft count.");

  console.log(
    JSON.stringify(
      {
        ok: true,
        id: record.id,
        client: record.client_name,
        package: record.package,
        recommendedPackage: record.recommended_package,
        priceRange: record.recommended_price_range,
        clientReadyProposal: record.client_ready_proposal.includes("Quote range"),
        initialStatus: record.status,
        updatedStatus: wonUpdate.record?.status,
        followUpChannel: record.follow_up_channel,
        recordsReturned: history.records.length,
        totalSaved: updatedHistory.status_counts.total,
        wonCount: updatedHistory.status_counts.won,
        providerCalled: record.safety_flags.provider_called,
        externalSend: record.safety_flags.external_send,
        n8nExecuted: record.safety_flags.n8n_executed,
        approvalExecuted: record.safety_flags.approval_executed,
        queueWritten: record.safety_flags.queue_written,
        productionLedgerWrite: record.safety_flags.production_ledger_write,
        paymentRequestCreated: record.safety_flags.payment_request_created,
        invoiceCreated: record.safety_flags.invoice_created,
        productionWriteBlocked: blockedPersistence.reason === "production_write_blocked",
        rawSecretStored: recordJson.includes(fakeApiKeyValue),
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
