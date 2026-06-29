import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildHermesLiveCallReceiptContract } from "../src/phantom-ai/hermes-live-receipts.js";
import { buildLiveSmokePreflightReport } from "../src/phantom-ai/live-smoke-preflight.js";
import { previewModelRouterFoundation } from "../src/phantom-ai/model-router.js";
import { OPENROUTER_CHAT_COMPLETIONS_ENDPOINT } from "../src/phantom-ai/providers/openrouter-adapter.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const tempDir = mkdtempSync(join(tmpdir(), "phantom-hermes-live-receipts-"));
const ledgerPath = join(tempDir, "hermes-ledger.jsonl");
const providerKeyEnvName = ["OPENROUTER", "API", "KEY"].join("_");
const fakeProviderKey = ["sk", "or", "v1", "receiptcontract0123456789"].join("-");
const fakePromptSecret = ["prompt", "receipt", "secret", "123456789"].join("-");
const fakeToken = ["receipt", "token", "123456789"].join("-");
const fakeCard = ["4000", "0000", "0000", "0002"].join(" ");

try {
  const source = readFileSync(new URL("../src/phantom-ai/hermes-live-receipts.ts", import.meta.url), "utf8");
  assert(!/\bfetch\s*\(/i.test(source), "Receipt contract must not add fetch calls.");
  assert(!/\bhttps?\.request\b/i.test(source), "Receipt contract must not add HTTP request calls.");
  assert(!/\bappendHermesLedgerRecord\b/i.test(source), "Receipt contract must not append Hermes ledger records.");
  assert(!/\bpersistApprovalQueuePreview\b/i.test(source), "Receipt contract must not write approval queue records.");
  assert(!/\bappendApprovalQueueTransition\b/i.test(source), "Receipt contract must not write approval transitions.");

  const preview = previewModelRouterFoundation(
    {
      tenant_id: "demo-trainer",
      business_name: "West Loop Strength Lab",
      actor_user_id: "admin-jordan",
      actor_role: "platform_admin",
      request_id: "hermes-live-receipt-proof",
      task_type: "content_idea_summary",
      sensitivity_level: "low",
      user_request: `Summarize safe trainer tasks. SECRET_PROMPT=${fakePromptSecret} Bearer ${fakeToken} ${fakeCard}`,
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
        [providerKeyEnvName]: fakeProviderKey,
        OPENROUTER_MODEL: "z-ai/glm-5.2",
        PHANTOM_LIVE_PROVIDERS_ENABLED: "true",
        PHANTOM_HERMES_LEDGER_PATH: ledgerPath,
      },
    },
  );
  const preflight = await buildLiveSmokePreflightReport(preview, { ledgerPath });
  const contract = buildHermesLiveCallReceiptContract({ preview, preflight });
  const serialized = JSON.stringify(contract);

  assert(contract.status === "blocked_contract_only", "Receipt contract must stay blocked.");
  assert(contract.provider.provider_name === "OpenRouter", "Receipt provider name must be OpenRouter.");
  assert(contract.provider.model_id === "z-ai/glm-5.2", "Receipt model metadata must be GLM 5.2.");
  assert(contract.endpoint_contract.endpoint === OPENROUTER_CHAT_COMPLETIONS_ENDPOINT, "Receipt must link endpoint contract.");
  assert(contract.endpoint_contract.transport_enabled === false, "Receipt endpoint transport must be disabled.");
  assert(contract.endpoint_contract.network_client_implemented === false, "Receipt endpoint must not implement network client.");
  assert(contract.live_smoke_preflight_id === preflight.preflight_id, "Receipt must link live-smoke preflight.");
  assert(contract.budget_gate_status === preflight.budget_gate.status, "Receipt must link budget gate.");
  assert(contract.approval_gate_status === preflight.approval_execution_gate.status, "Receipt must link approval gate.");
  assert(contract.request_receipt.correlation_id === contract.correlation_id, "Request receipt must share correlation id.");
  assert(contract.response_receipt.correlation_id === contract.correlation_id, "Response receipt must share correlation id.");
  assert(contract.request_receipt.receipt_kind === "redacted_provider_request", "Request receipt kind must be explicit.");
  assert(contract.response_receipt.receipt_kind === "redacted_provider_response", "Response receipt kind must be explicit.");
  assert(contract.response_receipt.response_status === "not_called", "Response receipt must state provider was not called.");
  assert(contract.request_receipt.ledger_append_required_before_live, "Request receipt must be required before live.");
  assert(contract.response_receipt.ledger_append_required_before_live, "Response receipt must be required before live.");
  assert(contract.request_receipt.ledger_append_performed === false, "Request receipt must not be appended yet.");
  assert(contract.response_receipt.ledger_append_performed === false, "Response receipt must not be appended yet.");

  for (const blocked of [contract, contract.request_receipt, contract.response_receipt]) {
    assert(blocked.providerCalled === false, "Receipt blocked boolean providerCalled must be false.");
    assert(blocked.networkCallPerformed === false, "Receipt blocked boolean networkCallPerformed must be false.");
    assert(blocked.ledgerWritten === false, "Receipt blocked boolean ledgerWritten must be false.");
    assert(blocked.queueWritten === false, "Receipt blocked boolean queueWritten must be false.");
    assert(blocked.approvalExecuted === false, "Receipt blocked boolean approvalExecuted must be false.");
    assert(blocked.readyForSend === false, "Receipt blocked boolean readyForSend must be false.");
  }

  assert(contract.redaction.fake_api_key_redacted, "Receipt redaction must mask fake API key.");
  assert(contract.redaction.fake_token_redacted, "Receipt redaction must mask fake token.");
  assert(contract.redaction.fake_card_redacted, "Receipt redaction must mask fake card.");
  assert(contract.redaction.fake_prompt_redacted, "Receipt redaction must mask fake prompt-like value.");
  assert(contract.redaction.raw_api_key_returned === false, "Receipt must not return raw API key.");
  assert(contract.redaction.raw_token_returned === false, "Receipt must not return raw token.");
  assert(contract.redaction.raw_card_returned === false, "Receipt must not return raw card.");
  assert(contract.redaction.raw_prompt_returned === false, "Receipt must not return raw prompt.");
  assert(!serialized.includes(fakeProviderKey), "Receipt contract must not leak raw provider key.");
  assert(!serialized.includes(fakePromptSecret), "Receipt contract must not leak raw prompt-like value.");
  assert(!serialized.includes(fakeToken), "Receipt contract must not leak raw token.");
  assert(!serialized.includes(fakeCard), "Receipt contract must not leak raw card.");
  assert(!existsSync(ledgerPath), "Receipt contract must not create a ledger file.");
  assert(contract.ledger_write_mode === "not_written_contract_only", "Receipt ledger mode must be contract-only.");
  assert(contract.queue_write_mode === "not_written_contract_only", "Receipt queue mode must be contract-only.");
  assert(contract.approval_execution_mode === "not_implemented", "Receipt approval execution must be unimplemented.");

  console.log(
    JSON.stringify(
      {
        ok: true,
        contractId: contract.contract_id,
        correlationId: contract.correlation_id,
        requestReceiptId: contract.request_receipt.receipt_id,
        responseReceiptId: contract.response_receipt.receipt_id,
        provider: contract.provider.provider_name,
        modelId: contract.provider.model_id,
        endpoint: contract.endpoint_contract.endpoint,
        providerCalled: contract.providerCalled,
        networkCallPerformed: contract.networkCallPerformed,
        ledgerWritten: contract.ledgerWritten,
        queueWritten: contract.queueWritten,
        approvalExecuted: contract.approvalExecuted,
        readyForSend: contract.readyForSend,
        ledgerFileCreated: existsSync(ledgerPath),
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
