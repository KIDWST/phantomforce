import { createHash } from "node:crypto";

import { redactSensitiveText } from "./hermes-ledger.js";
import type {
  ProviderLiveReceiptLedgerBlockedReason,
  ProviderLiveReceiptLedgerContract,
  ProviderLiveReceiptLedgerContractInput,
  ProviderLiveReceiptLedgerState,
} from "./types.js";

function normalizeCost(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) ? null : Math.max(0, value);
}

function createContractId(input: ProviderLiveReceiptLedgerContractInput, checkedAt: string) {
  const digest = createHash("sha256")
    .update(
      [
        input.tenant_id,
        input.provider_route,
        input.model_id,
        input.requested_operation,
        input.receipt_contract?.correlation_id ?? "missing-receipt",
        checkedAt,
      ].join(":"),
    )
    .digest("hex")
    .slice(0, 24);

  return `provider-live-receipt-ledger-${digest}`;
}

function detailForReason(reason: ProviderLiveReceiptLedgerBlockedReason) {
  switch (reason) {
    case "readiness_not_passed":
      return "Provider readiness has not passed for a future live-call receipt.";
    case "funding_not_passed":
      return "Funding and budget approval preflight has not passed.";
    case "approval_not_passed":
      return "Explicit approval snapshot is missing or not approved.";
    case "budget_not_passed":
      return "Budget preflight has not passed.";
    case "cost_estimate_missing":
      return "Estimated provider cost is required before any live-call ledger semantics can pass.";
    case "redaction_not_passed":
      return "Request and response redaction proof is missing or failed.";
    case "receipt_contract_missing":
      return "A redacted request/response receipt contract is required before future transport.";
    case "future_transport_receipt_fields_missing":
      return "Future transport receipt requirements are missing one or more required fields.";
    case "future_transport_receipt_fields_unsafe":
      return "Future transport receipt requirements contain unsafe or unredacted fields.";
    case "transport_proof_missing":
      return "A provider result cannot be recorded until a future transport proof exists.";
    case "production_ledger_write_disabled":
      return "Production live-call ledger writes are disabled until production semantics are implemented.";
  }
}

function isRedactionPassed(input: ProviderLiveReceiptLedgerContractInput) {
  const redaction = input.redaction;

  return Boolean(
    redaction &&
      redaction.fake_api_key_redacted &&
      redaction.fake_token_redacted &&
      redaction.fake_card_redacted &&
      redaction.fake_prompt_redacted &&
      redaction.raw_api_key_returned === false &&
      redaction.raw_token_returned === false &&
      redaction.raw_card_returned === false &&
      redaction.raw_prompt_returned === false,
  );
}

function isApprovalPassed(input: ProviderLiveReceiptLedgerContractInput) {
  return input.approval_snapshot?.status === "approved";
}

function isFundingPassed(input: ProviderLiveReceiptLedgerContractInput) {
  return input.funding_approval_contract?.status === "preflight_allowed_transport_disabled";
}

function requiredFieldStatus(input: ProviderLiveReceiptLedgerContractInput) {
  return {
    tenant_id: Boolean(input.tenant_id.trim()),
    provider_route: Boolean(input.provider_route),
    model_id: Boolean(input.model_id.trim()),
    budget_snapshot: input.budget_passed,
    funding_snapshot: Boolean(input.funding_approval_contract),
    approval_snapshot: Boolean(input.approval_snapshot),
    estimated_cost_usd: normalizeCost(input.estimated_cost_usd) !== null,
    redaction_status: isRedactionPassed(input),
    receipt_contract: Boolean(input.receipt_contract),
    correlation_id: Boolean(input.receipt_contract?.correlation_id),
    request_receipt_id: Boolean(input.receipt_contract?.request_receipt.receipt_id),
    response_receipt_id: Boolean(input.receipt_contract?.response_receipt.receipt_id),
    live_smoke_preflight_id: Boolean(input.receipt_contract?.live_smoke_preflight_id),
    endpoint_contract: Boolean(input.receipt_contract?.endpoint_contract),
  };
}

function getMissingFields(input: ProviderLiveReceiptLedgerContractInput) {
  return Object.entries(requiredFieldStatus(input))
    .filter(([, present]) => !present)
    .map(([field]) => field);
}

function getUnsafeFields(input: ProviderLiveReceiptLedgerContractInput) {
  const unsafe: string[] = [];
  const receipt = input.receipt_contract;

  if (receipt?.request_receipt.raw_api_key_stored) unsafe.push("request_receipt.raw_api_key_stored");
  if (receipt?.request_receipt.raw_prompt_stored) unsafe.push("request_receipt.raw_prompt_stored");
  if (receipt?.response_receipt.raw_response_stored) unsafe.push("response_receipt.raw_response_stored");
  if (receipt?.request_receipt.request_body_ready_for_send) unsafe.push("request_receipt.request_body_ready_for_send");
  if (receipt?.request_receipt.request_payload_prepared) unsafe.push("request_receipt.request_payload_prepared");
  if (receipt?.readyForSend) unsafe.push("receipt_contract.readyForSend");
  if (receipt?.providerCalled) unsafe.push("receipt_contract.providerCalled");
  if (receipt?.networkCallPerformed) unsafe.push("receipt_contract.networkCallPerformed");
  if (receipt?.ledgerWritten) unsafe.push("receipt_contract.ledgerWritten");
  if (receipt?.approvalExecuted) unsafe.push("receipt_contract.approvalExecuted");

  return unsafe;
}

function getBaseBlockedReasons(input: ProviderLiveReceiptLedgerContractInput) {
  const reasons: ProviderLiveReceiptLedgerBlockedReason[] = [];

  if (!input.readiness_passed) reasons.push("readiness_not_passed");
  if (!isFundingPassed(input)) reasons.push("funding_not_passed");
  if (!isApprovalPassed(input)) reasons.push("approval_not_passed");
  if (!input.budget_passed) reasons.push("budget_not_passed");
  if (normalizeCost(input.estimated_cost_usd) === null) reasons.push("cost_estimate_missing");
  if (!isRedactionPassed(input)) reasons.push("redaction_not_passed");
  if (!input.receipt_contract) reasons.push("receipt_contract_missing");

  return reasons;
}

function getState(input: ProviderLiveReceiptLedgerContractInput, baseReasons: ProviderLiveReceiptLedgerBlockedReason[]) {
  if (input.requested_operation === "production_ledger_write" || input.production_ledger_write_requested) {
    return "production_ledger_write_disabled";
  }

  if (input.requested_operation === "future_provider_result") {
    return "future_provider_result_requires_transport_proof";
  }

  if (input.requested_operation === "future_transport_attempt") {
    return "future_transport_attempt_requires_receipt";
  }

  if (baseReasons.length === 0) {
    return "preflight_allowed_transport_disabled";
  }

  return "blocked_no_ledger_write";
}

function getOperationReasons(options: {
  input: ProviderLiveReceiptLedgerContractInput;
  state: ProviderLiveReceiptLedgerState;
  missingFields: string[];
  unsafeFields: string[];
}) {
  const reasons: ProviderLiveReceiptLedgerBlockedReason[] = [];

  if (options.state === "production_ledger_write_disabled") {
    reasons.push("production_ledger_write_disabled");
  }

  if (options.state === "future_provider_result_requires_transport_proof" && !options.input.transport_proof) {
    reasons.push("transport_proof_missing");
  }

  if (options.state === "future_transport_attempt_requires_receipt" && options.missingFields.length) {
    reasons.push("future_transport_receipt_fields_missing");
  }

  if (options.state === "future_transport_attempt_requires_receipt" && options.unsafeFields.length) {
    reasons.push("future_transport_receipt_fields_unsafe");
  }

  return reasons;
}

function failureCode(state: ProviderLiveReceiptLedgerState) {
  switch (state) {
    case "future_transport_attempt_requires_receipt":
      return "provider_transport_receipt_requirements_only" as const;
    case "future_provider_result_requires_transport_proof":
      return "provider_result_transport_proof_missing" as const;
    case "production_ledger_write_disabled":
      return "production_ledger_write_disabled" as const;
    case "blocked_no_ledger_write":
    case "preflight_allowed_transport_disabled":
      return "provider_live_receipt_ledger_blocked" as const;
  }
}

export function evaluateProviderLiveReceiptLedgerContract(
  input: ProviderLiveReceiptLedgerContractInput,
): ProviderLiveReceiptLedgerContract {
  const checkedAt = input.checked_at ?? new Date().toISOString();
  const contractId = createContractId(input, checkedAt);
  const missingFields = getMissingFields(input);
  const unsafeFields = getUnsafeFields(input).map((field) => redactSensitiveText(field));
  const baseReasons = getBaseBlockedReasons(input);
  const state = getState(input, baseReasons);
  const operationReasons = getOperationReasons({
    input,
    state,
    missingFields,
    unsafeFields,
  });
  const blockedReasons = Array.from(new Set([...baseReasons, ...operationReasons]));
  const preflightAuditPreviewAllowed = state === "preflight_allowed_transport_disabled";
  const receipt = input.receipt_contract;

  return {
    contract_id: contractId,
    checked_at: checkedAt,
    state,
    requested_operation: input.requested_operation,
    tenant_id: redactSensitiveText(input.tenant_id),
    business_name: redactSensitiveText(input.business_name),
    provider_route: input.provider_route,
    model_id: redactSensitiveText(input.model_id),
    estimated_cost_usd: normalizeCost(input.estimated_cost_usd),
    readiness_passed: input.readiness_passed,
    budget_passed: input.budget_passed,
    funding_passed: isFundingPassed(input),
    approval_passed: isApprovalPassed(input),
    cost_estimate_present: normalizeCost(input.estimated_cost_usd) !== null,
    redaction_passed: isRedactionPassed(input),
    receipt_contract_present: Boolean(receipt),
    preflight_audit_preview_allowed: preflightAuditPreviewAllowed,
    completed_live_call_receipt_allowed: false,
    provider_result_record_allowed: false,
    production_ledger_write_allowed: false,
    local_dev_preview_allowed: true,
    provider_called: false,
    network_call_performed: false,
    provider_transport_allowed: false,
    live_call_allowed: false,
    execution_disabled: true,
    ready_for_send: false,
    ledger_written: false,
    production_ledger_written: false,
    queue_written: false,
    approval_executed: false,
    blocked_reasons: blockedReasons,
    blocked_reason_details: blockedReasons.map((reason) => redactSensitiveText(detailForReason(reason))),
    allowed_ledger_record_kinds: preflightAuditPreviewAllowed ? ["redacted_preflight_audit_preview"] : [],
    blocked_ledger_record_kinds: [
      "completed_live_call_receipt",
      "provider_result",
      "production_live_call_ledger_write",
    ],
    future_transport_attempt_contract: {
      required: true,
      contract_status:
        missingFields.length || unsafeFields.length
          ? "blocked_missing_or_unsafe_fields"
          : "requirements_defined_transport_disabled",
      receipt_required_before_send: true,
      redacted_request_receipt_required: true,
      redacted_response_receipt_required: true,
      budget_snapshot_required: true,
      funding_snapshot_required: true,
      approval_snapshot_required: true,
      estimated_cost_required: true,
      redaction_status_required: true,
      missing_required_fields: missingFields.map((field) => redactSensitiveText(field)),
      unsafe_fields: unsafeFields,
      request_body_prepared: false,
      ready_for_send: false,
    },
    future_provider_result_contract: {
      transport_proof_required: true,
      transport_proof_present: Boolean(input.transport_proof),
      provider_result_record_allowed: false,
      blocked_reason: redactSensitiveText(
        input.transport_proof
          ? "Provider result recording remains disabled until a separate production ledger implementation exists."
          : "Provider result recording requires future transport proof. Transport proof does not exist in this patch.",
      ),
    },
    production_ledger_contract: {
      production_write_requested: input.requested_operation === "production_ledger_write" || Boolean(input.production_ledger_write_requested),
      production_write_allowed: false,
      blocked_reason: "Production live-call ledger writes are disabled until production semantics are implemented.",
    },
    receipt_contract_summary: {
      contract_id: receipt?.contract_id ?? null,
      correlation_id: receipt?.correlation_id ?? null,
      request_receipt_id: receipt?.request_receipt.receipt_id ?? null,
      response_receipt_id: receipt?.response_receipt.receipt_id ?? null,
      live_smoke_preflight_id: receipt?.live_smoke_preflight_id ?? null,
    },
    machine_check: {
      required_before_provider_transport: true,
      required_before_completed_live_receipt: true,
      current_state: state,
      expected_preflight_state_before_future_transport: "preflight_allowed_transport_disabled",
      completed_receipt_requires_transport_proof: true,
      production_ledger_write_disabled: true,
      transport_must_reference_contract_id: contractId,
      bypass_allowed: false,
      failure_code: failureCode(state),
    },
    client_safe_summary: "Phantom AI can preview safety state. No external AI call, send, or live ledger write happened.",
    admin_debug_summary: redactSensitiveText(
      `Live receipt ledger semantics ${contractId} is ${state} for ${input.provider_route}/${input.model_id}.`,
    ),
    safety_flags: {
      admin_only: true,
      contract_only: true,
      provider_called: false,
      network_call_performed: false,
      provider_transport_allowed: false,
      live_call_allowed: false,
      execution_disabled: true,
      ready_for_send: false,
      ledger_written: false,
      production_ledger_written: false,
      queue_written: false,
      approval_executed: false,
      payment_collected: false,
      request_body_prepared: false,
      completed_receipt_allowed: false,
      provider_result_record_allowed: false,
      raw_secret_exposed: false,
      raw_prompt_returned: false,
      raw_response_stored: false,
    },
  };
}
