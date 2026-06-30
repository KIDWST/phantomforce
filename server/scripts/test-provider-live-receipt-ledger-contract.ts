import { readFileSync } from "node:fs";

import { buildHermesLiveCallReceiptContract } from "../src/phantom-ai/hermes-live-receipts.js";
import { buildLiveSmokePreflightReport } from "../src/phantom-ai/live-smoke-preflight.js";
import { previewModelRouterFoundation } from "../src/phantom-ai/model-router.js";
import {
  buildProviderBudgetApprovalRecordContract,
  buildProviderFundingRecordContract,
  evaluateProviderFundingApprovalContract,
} from "../src/phantom-ai/provider-funding-approval-contract.js";
import { evaluateProviderLiveReceiptLedgerContract } from "../src/phantom-ai/provider-live-receipt-ledger-contract.js";
import type {
  ApprovalRequestPreview,
  ModelRouterRequest,
  ProviderBudgetCaps,
  ProviderLiveReceiptLedgerContractInput,
} from "../src/phantom-ai/types.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const caps: ProviderBudgetCaps = {
  monthly_budget_cap_usd: 20,
  daily_budget_cap_usd: 5,
  per_request_estimated_token_cap: 4000,
  per_request_estimated_cost_cap_usd: 0.1,
};
const providerKeyLabel = ["OPENROUTER", "API", "KEY"].join("_");
const fakeProviderKey = ["sk", "or", "v1", "ledgercontract0123456789"].join("-");
const fakeTokenValue = ["ledger", "token", "123456789"].join("-");
const fakeCard = ["4242", "4242", "4242", "4242"].join(" ");
const fakePromptLabel = ["SECRET", "PROMPT"].join("_");
const fakePrompt = ["ledger", "prompt", "secret"].join("-");
const futureTrue = true as true;

const source = readFileSync(
  new URL("../src/phantom-ai/provider-live-receipt-ledger-contract.ts", import.meta.url),
  "utf8",
);
assert(!/\bfetch\s*\(/i.test(source), "Live receipt ledger contract must not add fetch calls.");
assert(!/\bhttps?\.request\b/i.test(source), "Live receipt ledger contract must not add HTTP request calls.");
assert(!/\baxios\s*\(/i.test(source), "Live receipt ledger contract must not add axios calls.");
assert(!/\bwriteFile\b|\bappendFile\b|\bmkdir\b/i.test(source), "Live receipt ledger contract must not write files.");
assert(!/\bappendHermesLedgerRecord\b/i.test(source), "Live receipt ledger contract must not append Hermes ledger records.");
assert(!/\bpersistApprovalQueuePreview\b/i.test(source), "Live receipt ledger contract must not write approval queue records.");
assert(!/\bappendApprovalQueueTransition\b/i.test(source), "Live receipt ledger contract must not write approval transitions.");

const request: ModelRouterRequest = {
  tenant_id: `demo-trainer ${providerKeyLabel}=${fakeProviderKey}`,
  business_name: `West Loop Strength Lab TOKEN=${fakeTokenValue} ${fakeCard}`,
  actor_user_id: "demo-owner",
  actor_role: "platform_admin",
  request_id: "live-receipt-ledger-contract-proof",
  task_type: "content_idea_summary",
  sensitivity_level: "low",
  user_request: "Summarize safe content ideas for owner review only.",
  business_summary: `Owner-only personal training simulation. External actions are approval-only. ${fakePromptLabel}=${fakePrompt}.`,
  module_data: [],
};
const preview = previewModelRouterFoundation(request, {
  env: {
    PHANTOM_MODEL_ROUTER_MODE: "openrouter",
    [providerKeyLabel]: fakeProviderKey,
    PHANTOM_LIVE_PROVIDERS_ENABLED: "true",
    PHANTOM_AI_BUDGET_ENFORCEMENT_MODE: "future_live_guard",
  },
});
const preflight = await buildLiveSmokePreflightReport(preview);
const receiptContract = buildHermesLiveCallReceiptContract({ preview, preflight });
const fundingApprovalContract = evaluateProviderFundingApprovalContract({
  tenant_id: request.tenant_id,
  business_name: request.business_name,
  provider_id: "openrouter_glm",
  model_id: "z-ai/glm-5.2",
  estimated_tokens: 1200,
  estimated_cost_usd: 0.02,
  budget_caps: caps,
  funding_record: buildProviderFundingRecordContract({
    tenant_id: request.tenant_id,
    provider_id: "openrouter_glm",
    model_id: "z-ai/glm-5.2",
    funding_state: "funded",
    funded_budget_cap_usd: 0.1,
  }),
  approval_record: buildProviderBudgetApprovalRecordContract({
    tenant_id: request.tenant_id,
    provider_id: "openrouter_glm",
    model_id: "z-ai/glm-5.2",
    approval_state: "approved",
    approved_budget_cap_usd: 0.1,
    approved_by: `Bearer ${fakeTokenValue}`,
    approved_at: "2026-06-29T00:00:00.000Z",
  }),
  checked_at: "2026-06-29T00:00:00.000Z",
});
const approvedApprovalSnapshot: ApprovalRequestPreview = {
  ...preview.approval_request,
  status: "approved",
};

function baseInput(overrides: Partial<ProviderLiveReceiptLedgerContractInput> = {}): ProviderLiveReceiptLedgerContractInput {
  return {
    tenant_id: request.tenant_id,
    business_name: request.business_name,
    provider_route: "openrouter_glm",
    model_id: "z-ai/glm-5.2",
    requested_operation: "preflight_preview",
    readiness_passed: true,
    budget_passed: true,
    funding_approval_contract: fundingApprovalContract,
    approval_snapshot: approvedApprovalSnapshot,
    estimated_cost_usd: 0.02,
    redaction: receiptContract.redaction,
    receipt_contract: receiptContract,
    transport_proof: null,
    checked_at: "2026-06-29T00:00:00.000Z",
    ...overrides,
  };
}

const blockedNoLedgerWrite = evaluateProviderLiveReceiptLedgerContract(
  baseInput({
    readiness_passed: false,
    budget_passed: false,
    funding_approval_contract: null,
    approval_snapshot: null,
    estimated_cost_usd: null,
    redaction: null,
    receipt_contract: null,
  }),
);
assert(blockedNoLedgerWrite.state === "blocked_no_ledger_write", "Failed gates must block ledger writes.");
assert(blockedNoLedgerWrite.blocked_reasons.includes("readiness_not_passed"), "Readiness failure must be explicit.");
assert(blockedNoLedgerWrite.blocked_reasons.includes("funding_not_passed"), "Funding failure must be explicit.");
assert(blockedNoLedgerWrite.blocked_reasons.includes("approval_not_passed"), "Approval failure must be explicit.");
assert(blockedNoLedgerWrite.blocked_reasons.includes("budget_not_passed"), "Budget failure must be explicit.");
assert(blockedNoLedgerWrite.blocked_reasons.includes("cost_estimate_missing"), "Missing cost must be explicit.");
assert(blockedNoLedgerWrite.blocked_reasons.includes("redaction_not_passed"), "Missing redaction must be explicit.");
assert(blockedNoLedgerWrite.blocked_reasons.includes("receipt_contract_missing"), "Missing receipt must be explicit.");

const preflightAllowed = evaluateProviderLiveReceiptLedgerContract(baseInput());
assert(
  preflightAllowed.state === "preflight_allowed_transport_disabled",
  "Funded, approved, cost-known state may allow only a preflight audit preview.",
);
assert(preflightAllowed.preflight_audit_preview_allowed === true, "Preflight audit preview should be allowed.");
assert(
  preflightAllowed.allowed_ledger_record_kinds.length === 1 &&
    preflightAllowed.allowed_ledger_record_kinds[0] === "redacted_preflight_audit_preview",
  "Only redacted preflight audit previews may be allowed.",
);
assert(preflightAllowed.completed_live_call_receipt_allowed === false, "Completed live-call receipts must stay blocked.");
assert(preflightAllowed.provider_result_record_allowed === false, "Provider result records must stay blocked.");
assert(preflightAllowed.production_ledger_write_allowed === false, "Production ledger writes must stay blocked.");
assert(preflightAllowed.provider_transport_allowed === false, "Provider transport must stay disabled.");
assert(preflightAllowed.live_call_allowed === false, "Live calls must stay disabled.");
assert(preflightAllowed.ready_for_send === false, "Request must not be ready for send.");
assert(preflightAllowed.provider_called === false, "Provider must not be called.");
assert(preflightAllowed.network_call_performed === false, "Network must not be called.");
assert(preflightAllowed.ledger_written === false, "Production ledger must not be written.");
assert(preflightAllowed.queue_written === false, "Queue must not be written.");
assert(preflightAllowed.approval_executed === false, "Approval must not be executed.");

const futureTransportMissingReceipt = evaluateProviderLiveReceiptLedgerContract(
  baseInput({
    requested_operation: "future_transport_attempt",
    receipt_contract: null,
  }),
);
assert(
  futureTransportMissingReceipt.state === "future_transport_attempt_requires_receipt",
  "Future transport attempts must require receipt fields.",
);
assert(
  futureTransportMissingReceipt.future_transport_attempt_contract.contract_status ===
    "blocked_missing_or_unsafe_fields",
  "Future transport contract must reject missing fields.",
);
assert(
  futureTransportMissingReceipt.future_transport_attempt_contract.missing_required_fields.includes("receipt_contract"),
  "Missing receipt contract field must be reported.",
);
assert(futureTransportMissingReceipt.provider_transport_allowed === false, "Future transport must still be disabled.");

const futureTransportRequirementsOnly = evaluateProviderLiveReceiptLedgerContract(
  baseInput({
    requested_operation: "future_transport_attempt",
  }),
);
assert(
  futureTransportRequirementsOnly.state === "future_transport_attempt_requires_receipt",
  "Future transport operation should only define requirements.",
);
assert(
  futureTransportRequirementsOnly.future_transport_attempt_contract.contract_status ===
    "requirements_defined_transport_disabled",
  "Complete required fields should define requirements but keep transport disabled.",
);
assert(futureTransportRequirementsOnly.ready_for_send === false, "Complete future fields must not become sendable.");

const providerResultNoProof = evaluateProviderLiveReceiptLedgerContract(
  baseInput({
    requested_operation: "future_provider_result",
    transport_proof: null,
  }),
);
assert(
  providerResultNoProof.state === "future_provider_result_requires_transport_proof",
  "Provider result records must require transport proof.",
);
assert(providerResultNoProof.blocked_reasons.includes("transport_proof_missing"), "Missing transport proof must block.");
assert(
  providerResultNoProof.future_provider_result_contract.provider_result_record_allowed === false,
  "Provider result record must remain blocked.",
);

const providerResultWithFakeProof = evaluateProviderLiveReceiptLedgerContract(
  baseInput({
    requested_operation: "future_provider_result",
    transport_proof: {
      transport_proof_id: "future-proof-not-real",
      provider_route: "openrouter_glm",
      model_id: "z-ai/glm-5.2",
      correlation_id: receiptContract.correlation_id,
      request_receipt_id: receiptContract.request_receipt.receipt_id,
      response_receipt_id: receiptContract.response_receipt.receipt_id,
      provider_call_confirmed: futureTrue,
      network_call_confirmed: futureTrue,
      request_redacted: futureTrue,
      response_redacted: futureTrue,
      raw_secret_exposed: false,
    },
  }),
);
assert(
  providerResultWithFakeProof.state === "future_provider_result_requires_transport_proof",
  "Provider result state must still be blocked today even with a future-shaped proof.",
);
assert(
  providerResultWithFakeProof.future_provider_result_contract.provider_result_record_allowed === false,
  "Fake future transport proof must not unlock result records.",
);
assert(providerResultWithFakeProof.provider_called === false, "Contract output must not claim provider call happened.");
assert(
  providerResultWithFakeProof.network_call_performed === false,
  "Contract output must not claim network call happened.",
);

const productionWrite = evaluateProviderLiveReceiptLedgerContract(
  baseInput({
    requested_operation: "production_ledger_write",
    production_ledger_write_requested: true,
  }),
);
assert(
  productionWrite.state === "production_ledger_write_disabled",
  "Production ledger writes must have their own disabled state.",
);
assert(
  productionWrite.blocked_reasons.includes("production_ledger_write_disabled"),
  "Production ledger write disabled reason must be explicit.",
);
assert(productionWrite.production_ledger_write_allowed === false, "Production ledger write must not be allowed.");
assert(productionWrite.production_ledger_written === false, "Production ledger must not be written.");

const serialized = JSON.stringify({
  blockedNoLedgerWrite,
  preflightAllowed,
  futureTransportMissingReceipt,
  futureTransportRequirementsOnly,
  providerResultNoProof,
  providerResultWithFakeProof,
  productionWrite,
  preview,
  receiptContract,
  fundingApprovalContract,
});
assert(!serialized.includes(fakeProviderKey), "Ledger contract proof must not expose raw provider key.");
assert(!serialized.includes(fakeTokenValue), "Ledger contract proof must not expose raw token.");
assert(!serialized.includes(fakeCard), "Ledger contract proof must not expose raw card.");
assert(!serialized.includes(fakePrompt), "Ledger contract proof must not expose raw prompt-like value.");
assert(preview.provider_invocation.live_call_allowed === false, "OpenRouter GLM route must remain blocked.");
assert(preview.provider_invocation.execution_disabled === true, "OpenRouter GLM execution must remain disabled.");
assert(
  preview.provider_invocation.openrouter_adapter?.transport_contract.ready_for_send === false,
  "OpenRouter GLM must not be ready for send.",
);
assert(
  preview.provider_invocation.budget_hard_gate.funding_approval_contract.provider_transport_allowed === false,
  "Funding approval contract must not allow provider transport.",
);

for (const contract of [
  blockedNoLedgerWrite,
  preflightAllowed,
  futureTransportMissingReceipt,
  futureTransportRequirementsOnly,
  providerResultNoProof,
  providerResultWithFakeProof,
  productionWrite,
]) {
  assert(contract.provider_called === false, "Ledger semantics must never claim provider call.");
  assert(contract.network_call_performed === false, "Ledger semantics must never claim network call.");
  assert(contract.provider_transport_allowed === false, "Ledger semantics must never allow provider transport.");
  assert(contract.live_call_allowed === false, "Ledger semantics must never allow live call.");
  assert(contract.execution_disabled === true, "Ledger semantics must keep execution disabled.");
  assert(contract.ready_for_send === false, "Ledger semantics must not become ready for send.");
  assert(contract.ledger_written === false, "Ledger semantics must not write production ledger.");
  assert(contract.production_ledger_written === false, "Ledger semantics must not write production ledger.");
  assert(contract.queue_written === false, "Ledger semantics must not write queue.");
  assert(contract.approval_executed === false, "Ledger semantics must not execute approval.");
  assert(contract.safety_flags.payment_collected === false, "Ledger semantics must not collect payment.");
  assert(contract.safety_flags.request_body_prepared === false, "Ledger semantics must not prepare request bodies.");
  assert(contract.safety_flags.raw_secret_exposed === false, "Ledger semantics must not expose secrets.");
}

console.log(
  JSON.stringify(
    {
      ok: true,
      blockedState: blockedNoLedgerWrite.state,
      preflightState: preflightAllowed.state,
      preflightAllowedKinds: preflightAllowed.allowed_ledger_record_kinds,
      futureTransportState: futureTransportRequirementsOnly.state,
      futureTransportReadyForSend: futureTransportRequirementsOnly.ready_for_send,
      providerResultState: providerResultNoProof.state,
      providerResultAllowed: providerResultNoProof.provider_result_record_allowed,
      productionWriteState: productionWrite.state,
      productionLedgerWritten: productionWrite.production_ledger_written,
      providerCalled: preflightAllowed.provider_called,
      networkCallPerformed: preflightAllowed.network_call_performed,
      liveCallAllowed: preflightAllowed.live_call_allowed,
      readyForSend: preflightAllowed.ready_for_send,
      openRouterReadyForSend: preview.provider_invocation.openrouter_adapter?.transport_contract.ready_for_send,
      secretsLeaked:
        serialized.includes(fakeProviderKey) ||
        serialized.includes(fakeTokenValue) ||
        serialized.includes(fakeCard) ||
        serialized.includes(fakePrompt),
    },
    null,
    2,
  ),
);
