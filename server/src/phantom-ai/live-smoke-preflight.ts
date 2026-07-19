import { getHermesLedgerStatus, redactSensitiveText, redactPersonalDataText } from "./hermes-ledger.js";
import type {
  BudgetGuardStatus,
  LiveSmokePreflightGateStatus,
  LiveSmokePreflightReport,
  ModelRouterPreviewResult,
} from "./types.js";

function uniqRedacted(values: string[]) {
  return Array.from(new Set(values.map((value) => redactPersonalDataText(value)).filter(Boolean)));
}

function createPreflightId(requestId: string) {
  return `smoke-preflight-${Buffer.from(redactSensitiveText(requestId)).toString("base64url").slice(0, 24)}`;
}

function getBudgetGateStatus(status: BudgetGuardStatus): LiveSmokePreflightGateStatus {
  if (status === "blocked" || status === "disabled") return "blocked";
  return "blocked";
}

function buildRedactionProbe() {
  const keyValue = ["secret", "probe", "value", "123456789"].join("-");
  const tokenValue = ["token", "probe", "value", "123456789"].join("-");
  const cardValue = ["4111", "1111", "1111", "1111"].join(" ");
  const rawProbe = [
    ["api", "key"].join("_") + "=" + keyValue,
    `Bearer ${tokenValue}`,
    cardValue,
  ].join(" ");
  const redactedProbe = redactSensitiveText(rawProbe);
  const rawSecretReturned =
    redactedProbe.includes(keyValue) || redactedProbe.includes(tokenValue) || redactedProbe.includes(cardValue);

  return {
    rawProbe,
    redactedProbe,
    rawSecretReturned,
    obviousSecretRedactionPassed: !rawSecretReturned && redactedProbe !== rawProbe,
  };
}

export async function buildLiveSmokePreflightReport(
  preview: ModelRouterPreviewResult,
  options: {
    ledgerPath?: string;
  } = {},
): Promise<LiveSmokePreflightReport> {
  const ledgerStatus = await getHermesLedgerStatus({ ledgerPath: options.ledgerPath });
  const adapter = preview.provider_invocation.openrouter_adapter;
  const redactionProbe = buildRedactionProbe();
  const requiredBeforeLiveSmokeTest = uniqRedacted([
    ...preview.provider_policy.required_before_live_calls,
    ...preview.provider_invocation.required_before_live,
    ...(adapter?.live_transport_readiness.required_before_live_smoke_test ?? []),
    "Budget enforcement must be implemented as a hard live guard, not preview metadata.",
    "Hermes must append a redacted request and response receipt around any live smoke test.",
    "Hermes live-call receipt contract must be implemented before any request body can become sendable.",
    "Request and response redaction must run before transport payloads or UI/debug output can exist.",
    "Approval execution must be designed and separately reviewed; this preflight cannot approve or execute.",
    "OpenRouter payment or credits should not be requested until every local live-smoke gate passes.",
    "Jordan must explicitly approve a one-time local admin-only smoke test after all gates pass.",
  ]);
  const transportReason =
    adapter?.dry_run_request_envelope.no_live_call_reason ??
    preview.provider_invocation.blocked_reason ??
    "Provider invocation firewall blocks live transport.";
  const redactionStatus: LiveSmokePreflightGateStatus = redactionProbe.obviousSecretRedactionPassed
    ? "pass"
    : "blocked";

  return {
    preflight_id: createPreflightId(preview.context_packet.request_id),
    checked_at: new Date().toISOString(),
    provider_route: preview.decision.provider_route,
    model_id: preview.decision.model_id,
    status: "blocked",
    live_smoke_allowed: false,
    execution_disabled: true,
    provider_called: false,
    network_call_performed: false,
    ledger_written: false,
    queue_written: false,
    approval_executed: false,
    live_smoke_test_explicitly_approved: false,
    budget_gate: {
      status: getBudgetGateStatus(preview.provider_policy.budget.status),
      ready_for_live: false,
      enforcement_mode: preview.provider_policy.budget.enforcement_mode,
      budget_status: preview.provider_policy.budget.status,
      policy_route_allowed: false,
      estimated_tokens: preview.provider_policy.budget.estimated_tokens,
      estimated_cost_usd: preview.provider_policy.budget.estimated_cost_usd,
      monthly_budget_cap_usd: preview.provider_policy.budget.monthly_budget_cap_usd,
      daily_budget_cap_usd: preview.provider_policy.budget.daily_budget_cap_usd,
      per_request_estimated_token_cap: preview.provider_policy.budget.per_request_estimated_token_cap,
      per_request_estimated_cost_cap_usd: preview.provider_policy.budget.per_request_estimated_cost_cap_usd,
      reasons: uniqRedacted([
        ...preview.provider_policy.budget.reasons,
        "Budget is still preview/status-only and cannot authorize live spend.",
      ]),
    },
    ledger_gate: {
      status: "blocked",
      ready_for_live: false,
      ledger_enabled: ledgerStatus.enabled,
      ledger_exists: ledgerStatus.exists,
      ledger_bytes: ledgerStatus.bytes,
      ledger_path: ledgerStatus.ledgerPath,
      live_request_record_required: true,
      live_response_record_required: true,
      redacted_record_required: true,
      preflight_write_performed: false,
      reason:
        "Hermes ledger exists as local storage, but this preflight does not write. Future live smoke must append redacted request and response receipts.",
    },
    redaction_gate: {
      status: redactionStatus,
      obvious_secret_redaction_passed: redactionProbe.obviousSecretRedactionPassed,
      request_redaction_required: true,
      response_redaction_required: true,
      raw_probe_returned: redactionProbe.redactedProbe === redactionProbe.rawProbe,
      raw_secret_returned: redactionProbe.rawSecretReturned,
      ready_for_live_transport: false,
      reason: redactionProbe.obviousSecretRedactionPassed
        ? "Obvious key, token, and card-like probes are masked, but live transport redaction is not wired yet."
        : "Redaction probe failed; live transport must remain blocked.",
    },
    approval_execution_gate: {
      status: "not_implemented",
      approval_execution_implemented: false,
      execute_endpoint_expected_status: 404,
      status_transitions_only: true,
      live_action_allowed: false,
      reason:
        "Approval queue review transitions are status-only. There is no approval execution endpoint or live action runner.",
    },
    transport_gate: {
      status: "blocked",
      ready_for_live_transport: false,
      live_transport_configured: false,
      live_transport_enabled: false,
      firewall_permits_call: false,
      dry_run_envelope_ready_for_send: adapter?.dry_run_request_envelope.ready_for_send ?? false,
      network_payload_prepared: adapter?.dry_run_request_envelope.network_payload_prepared ?? false,
      reason: redactPersonalDataText(transportReason),
    },
    required_before_live_smoke_test: requiredBeforeLiveSmokeTest,
    admin_debug_summary: redactPersonalDataText(
      `Live smoke preflight blocked for ${preview.decision.provider_route}/${preview.decision.model_id}; budget=${preview.provider_policy.budget.status}; ledger_write=false; approval_execution=false; transport=false.`,
    ),
    client_safe_summary: "Phantom AI is in preview mode. No external AI call or live action was run.",
    safety_flags: {
      admin_only: true,
      dry_run_only: true,
      live_smoke_allowed: false,
      live_provider_call_allowed: false,
      execution_disabled: true,
      provider_called: false,
      network_call_performed: false,
      ledger_written: false,
      queue_written: false,
      approval_executed: false,
      raw_secret_exposed: false,
      raw_prompt_returned: false,
      raw_response_stored: false,
    },
  };
}
