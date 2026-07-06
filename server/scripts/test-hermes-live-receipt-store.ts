import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  persistHermesLiveReceiptPreview,
  readHermesLiveReceiptStoreRecords,
} from "../src/phantom-ai/hermes-live-receipt-store.js";
import { buildHermesLiveCallReceiptContract } from "../src/phantom-ai/hermes-live-receipts.js";
import { buildLiveSmokePreflightReport } from "../src/phantom-ai/live-smoke-preflight.js";
import { previewModelRouterFoundation } from "../src/phantom-ai/model-router.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const tempDir = mkdtempSync(join(tmpdir(), "phantom-hermes-live-receipt-store-"));
const storePath = join(tempDir, "hermes-live-receipts.jsonl");
const ledgerPath = join(tempDir, "hermes-ledger.jsonl");
const queuePath = join(tempDir, "hermes-approvals.jsonl");
const fakeProviderKey = ["sk", "or", "v1", "storecontract0123456789"].join("-");
const fakePromptSecret = ["prompt", "store", "secret", "123456789"].join("-");
const fakeToken = ["receipt", "store", "token", "123456789"].join("-");
const fakeCard = ["4000", "0000", "0000", "0002"].join(" ");

try {
  const source = readFileSync(
    new URL("../src/phantom-ai/hermes-live-receipt-store.ts", import.meta.url),
    "utf8",
  );
  assert(!/\bfetch\s*\(/i.test(source), "Receipt store must not add fetch calls.");
  assert(!/\bhttps?\.request\b/i.test(source), "Receipt store must not add HTTP request calls.");
  assert(!/\bappendHermesLedgerRecord\b/i.test(source), "Receipt store must not append Hermes ledger records.");
  assert(!/\bpersistApprovalQueuePreview\b/i.test(source), "Receipt store must not write approval queue records.");
  assert(!/\bappendApprovalQueueTransition\b/i.test(source), "Receipt store must not write approval transitions.");

  const preview = previewModelRouterFoundation(
    {
      tenant_id: "demo-trainer",
      business_name: "West Loop Strength Lab",
      actor_user_id: "admin-jordan",
      actor_role: "platform_admin",
      request_id: "hermes-live-receipt-store-proof",
      task_type: "content_idea_summary",
      sensitivity_level: "low",
      user_request: `Persist only redacted receipt preview. SECRET_PROMPT=${fakePromptSecret} Bearer ${fakeToken} ${fakeCard}`,
      business_summary: "Owner-only local proof. No external actions.",
      module_data: [
        {
          module: "Tasks",
          summary: "Local proof data only.",
          items: [{ title: "Draft only", status: "preview", detail: "No external send." }],
        },
      ],
    },
    {
      env: {
        PHANTOM_MODEL_ROUTER_MODE: "openrouter",
        OPENROUTER_API_KEY: fakeProviderKey,
        OPENROUTER_MODEL: "z-ai/glm-5.2",
        PHANTOM_LIVE_PROVIDERS_ENABLED: "true",
        PHANTOM_HERMES_LEDGER_PATH: ledgerPath,
        PHANTOM_HERMES_APPROVAL_QUEUE_PATH: queuePath,
      },
    },
  );
  const preflight = await buildLiveSmokePreflightReport(preview, { ledgerPath });
  const contract = buildHermesLiveCallReceiptContract({ preview, preflight });
  const persistence = await persistHermesLiveReceiptPreview(contract, {
    storePath,
    env: { NODE_ENV: "development" },
    persistedAt: "2026-06-29T00:00:00.000Z",
  });
  const serialized = readFileSync(storePath, "utf8");

  assert(persistence.persisted === true, "Receipt preview should persist in local dev mode.");
  assert(persistence.reason === "persisted_local_dev_only", "Receipt persistence reason should be local dev only.");
  assert(persistence.record !== null, "Receipt persistence should return a record.");
  assert(persistence.record.store_kind === "local_dev_only_receipt_store", "Receipt store kind should be explicit.");
  assert(persistence.record.local_dev_only === true, "Receipt store must be local/dev only.");
  assert(persistence.record.receipt_store_written === true, "Receipt store should mark receipt store write only.");
  assert(persistence.record.external_ledger_written === false, "Receipt store must not write an external ledger.");
  assert(persistence.record.production_ledger_written === false, "Receipt store must not write a production ledger.");
  assert(persistence.record.production_write_allowed === false, "Receipt store must not allow production writes.");
  assert(persistence.record.provider.provider_name === "OpenRouter", "Receipt store must keep provider linkage.");
  assert(persistence.record.provider.model_id === "z-ai/glm-5.2", "Receipt store must keep GLM model linkage.");
  assert(persistence.record.live_smoke_preflight_id === preflight.preflight_id, "Receipt store must link preflight.");
  assert(persistence.record.budget_gate_status === preflight.budget_gate.status, "Receipt store must link budget gate.");
  assert(
    persistence.record.approval_gate_status === preflight.approval_execution_gate.status,
    "Receipt store must link approval gate.",
  );

  for (const blocked of [persistence, persistence.record, persistence.record.request_receipt, persistence.record.response_receipt]) {
    assert(blocked.providerCalled === false, "Receipt store providerCalled must stay false.");
    assert(blocked.networkCallPerformed === false, "Receipt store networkCallPerformed must stay false.");
    assert(blocked.ledgerWritten === false, "Receipt store ledgerWritten must stay false.");
    assert(blocked.queueWritten === false, "Receipt store queueWritten must stay false.");
    assert(blocked.approvalExecuted === false, "Receipt store approvalExecuted must stay false.");
    assert(blocked.readyForSend === false, "Receipt store readyForSend must stay false.");
  }

  for (const secret of [fakeProviderKey, fakePromptSecret, fakeToken, fakeCard]) {
    assert(!serialized.includes(secret), `Receipt store must not persist raw secret value ${secret}.`);
    assert(!JSON.stringify(persistence).includes(secret), `Receipt result must not return raw secret value ${secret}.`);
  }

  assert(!existsSync(ledgerPath), "Receipt store must not create Hermes ledger file.");
  assert(!existsSync(queuePath), "Receipt store must not create approval queue file.");

  const blockedProduction = await persistHermesLiveReceiptPreview(contract, {
    storePath: join(tempDir, "production-blocked.jsonl"),
    env: { NODE_ENV: "production" },
  });
  assert(blockedProduction.persisted === false, "Production receipt persistence must be blocked.");
  assert(blockedProduction.reason === "production_write_blocked", "Production block reason must be explicit.");
  assert(!existsSync(join(tempDir, "production-blocked.jsonl")), "Production block must not create a store file.");

  writeFileSync(storePath, `${serialized}not json\n`, "utf8");
  const readResult = await readHermesLiveReceiptStoreRecords({ storePath, limit: 5000 });
  assert(readResult.limit === 50, "Receipt store limit must clamp to 50.");
  assert(readResult.records.length === 1, "Receipt store should read the valid record.");
  assert(readResult.malformed_lines === 1, "Receipt store should tolerate malformed lines.");

  console.log(
    JSON.stringify(
      {
        ok: true,
        storePath,
        persisted: persistence.persisted,
        reason: persistence.reason,
        recordId: persistence.record.record_id,
        provider: persistence.record.provider.provider_name,
        modelId: persistence.record.provider.model_id,
        providerCalled: persistence.providerCalled,
        networkCallPerformed: persistence.networkCallPerformed,
        ledgerWritten: persistence.ledgerWritten,
        queueWritten: persistence.queueWritten,
        approvalExecuted: persistence.approvalExecuted,
        readyForSend: persistence.readyForSend,
        ledgerFileCreated: existsSync(ledgerPath),
        queueFileCreated: existsSync(queuePath),
        productionBlocked: !blockedProduction.persisted,
        recordsRead: readResult.records.length,
        malformedLines: readResult.malformed_lines,
        clampedLimit: readResult.limit,
        secretsLeaked:
          serialized.includes(fakeProviderKey) ||
          serialized.includes(fakePromptSecret) ||
          serialized.includes(fakeToken) ||
          serialized.includes(fakeCard),
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
