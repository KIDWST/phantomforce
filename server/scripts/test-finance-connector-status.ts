import {
  FINANCE_CONNECTOR_ENABLE_ENV,
  getFinanceConnectorStatus,
} from "../src/connectors/finance-connector.js";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

const status = getFinanceConnectorStatus({} as NodeJS.ProcessEnv);

assert(status.connector === "finance", "Finance connector id should be stable.");
assert(status.enabled === true, "Finance ledger should be available.");
assert(status.ledger_semantics === "actual_transactions_only", "Money must use actual transaction semantics.");
assert(status.money_counts_only === "bank_card_csv_or_manual_transactions", "Money must not count pipeline/opportunity values.");
assert(status.opportunity_values_are_goals === true, "Opportunity values must be goals, not ledger cash.");
assert(status.manual_entry_ready === true, "Manual transaction entry should be ready.");
assert(status.csv_import_ready === true, "CSV import should be ready.");
assert(status.live_bank_sync_enabled === false, "Bank sync must not claim live readiness.");
assert(status.live_credit_card_sync_enabled === false, "Credit card sync must not claim live readiness.");
assert(status.frontend_credentials_allowed === false, "Bank/card credentials must not be accepted in the frontend.");
assert(status.external_account_linking === false, "External account linking must be disabled pre-runtime.");
assert(status.safety_flags.no_pipeline_cash_counting === true, "Pipeline cash counting must stay blocked.");

const manual = status.sources.find((source) => source.id === "manual-ledger");
const csv = status.sources.find((source) => source.id === "csv-import");
const bank = status.sources.find((source) => source.id === "plaid-bank");
const card = status.sources.find((source) => source.id === "plaid-credit-card");

assert(manual?.enabled === true && manual.status === "ready", "Manual ledger source should be ready.");
assert(csv?.enabled === true && csv.status === "ready", "CSV import source should be ready.");
assert(bank?.enabled === false && bank.live === false, "Bank source must fail closed.");
assert(card?.enabled === false && card.live === false, "Credit card source must fail closed.");
assert(bank?.credentials_required_in_ui === false, "Bank sync must not request UI credentials.");
assert(card?.frontend_credentials_allowed === false, "Card sync must not expose frontend tokens.");
assert(
  bank?.disabled_actions.includes("sync_transactions") && card?.disabled_actions.includes("sync_transactions"),
  "Provider transaction sync must stay disabled pre-runtime.",
);

const gated = getFinanceConnectorStatus({
  [FINANCE_CONNECTOR_ENABLE_ENV]: "true",
  PLAID_CLIENT_ID: "present",
  PLAID_SECRET: "present",
  PLAID_ENV: "sandbox",
} as unknown as NodeJS.ProcessEnv);

assert(gated.enable_gate_seen === true, "Enable gate should be detected.");
assert(gated.live_bank_sync_enabled === false, "Env gate alone must not enable bank sync.");
assert(gated.live_credit_card_sync_enabled === false, "Env gate alone must not enable card sync.");
assert(gated.provider_runtime === "not_implemented", "Provider runtime must remain explicit.");

console.log(
  JSON.stringify({
    ok: true,
    connector: status.connector,
    ledgerSemantics: status.ledger_semantics,
    manualReady: status.manual_entry_ready,
    csvReady: status.csv_import_ready,
    liveBankSync: status.live_bank_sync_enabled,
    liveCardSync: status.live_credit_card_sync_enabled,
    disabledProviderActions: bank?.disabled_actions,
  }),
);
