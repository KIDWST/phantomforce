// Finance connector boundary -- actual-transaction ledger status.
//
// Money in PhantomForce must mean confirmed transactions only: bank/card sync,
// CSV import, or manual ledger rows. Quote potential and won proposal value are
// opportunity/goal signals and must not be reported as cash.
//
// Live bank/card sync is deliberately fail-closed until a real provider runtime,
// server-side token storage, and explicit owner enablement exist.

export type FinanceConnectorSource = {
  id: "manual-ledger" | "csv-import" | "plaid-bank" | "plaid-credit-card";
  display_name: string;
  kind: "manual" | "import" | "bank" | "credit_card";
  provider: "phantomforce" | "csv" | "plaid";
  status: "ready" | "needs_config";
  enabled: boolean;
  live: boolean;
  credential_mode: "none" | "server_side_required";
  credentials_required_in_ui: false;
  frontend_credentials_allowed: false;
  transaction_source: "user_entered" | "file_import" | "provider_sync";
  enabled_actions: string[];
  disabled_actions: string[];
  reason: string;
};

export type FinanceConnectorStatus = {
  connector: "finance";
  display_name: string;
  enabled: true;
  admin_only: true;
  ledger_semantics: "actual_transactions_only";
  money_counts_only: "bank_card_csv_or_manual_transactions";
  opportunity_values_are_goals: true;
  manual_entry_ready: true;
  csv_import_ready: true;
  live_bank_sync_enabled: false;
  live_credit_card_sync_enabled: false;
  provider_runtime: "not_implemented";
  provider: "plaid";
  enable_gate_env: string;
  enable_gate_seen: boolean;
  credential_mode: "server_side_required";
  credentials_required_in_ui: false;
  frontend_credentials_allowed: false;
  external_account_linking: false;
  sources: FinanceConnectorSource[];
  planned_onboarding_steps: string[];
  disabled_actions: string[];
  safety_flags: {
    no_plaintext_credentials: true;
    no_frontend_bank_tokens: true;
    no_live_provider_calls: true;
    no_pipeline_cash_counting: true;
  };
  reason: string;
};

export const FINANCE_CONNECTOR_ENABLE_ENV = "PHANTOMFORCE_FINANCE_CONNECTOR_ENABLED";

function plaidConfigured(env: NodeJS.ProcessEnv) {
  return Boolean(env.PLAID_CLIENT_ID && env.PLAID_SECRET && env.PLAID_ENV);
}

export function getFinanceConnectorStatus(env: NodeJS.ProcessEnv = process.env): FinanceConnectorStatus {
  const gateSeen = env[FINANCE_CONNECTOR_ENABLE_ENV] === "true";
  const hasPlaidConfig = plaidConfigured(env);

  return {
    connector: "finance",
    display_name: "Business finance ledger",
    enabled: true,
    admin_only: true,
    ledger_semantics: "actual_transactions_only",
    money_counts_only: "bank_card_csv_or_manual_transactions",
    opportunity_values_are_goals: true,
    manual_entry_ready: true,
    csv_import_ready: true,
    // Even if env is present, this module has no Plaid runtime or token store
    // yet, so it must not claim live sync.
    live_bank_sync_enabled: false,
    live_credit_card_sync_enabled: false,
    provider_runtime: "not_implemented",
    provider: "plaid",
    enable_gate_env: FINANCE_CONNECTOR_ENABLE_ENV,
    enable_gate_seen: gateSeen,
    credential_mode: "server_side_required",
    credentials_required_in_ui: false,
    frontend_credentials_allowed: false,
    external_account_linking: false,
    sources: [
      {
        id: "manual-ledger",
        display_name: "Manual ledger",
        kind: "manual",
        provider: "phantomforce",
        status: "ready",
        enabled: true,
        live: false,
        credential_mode: "none",
        credentials_required_in_ui: false,
        frontend_credentials_allowed: false,
        transaction_source: "user_entered",
        enabled_actions: ["create_transaction", "delete_transaction", "export_csv"],
        disabled_actions: [],
        reason: "Manual transaction entry is available without external credentials.",
      },
      {
        id: "csv-import",
        display_name: "Bank/card CSV import",
        kind: "import",
        provider: "csv",
        status: "ready",
        enabled: true,
        live: false,
        credential_mode: "none",
        credentials_required_in_ui: false,
        frontend_credentials_allowed: false,
        transaction_source: "file_import",
        enabled_actions: ["import_csv", "export_csv"],
        disabled_actions: [],
        reason: "CSV import reads user-supplied bank/card exports; no account login is requested.",
      },
      {
        id: "plaid-bank",
        display_name: "Bank account sync",
        kind: "bank",
        provider: "plaid",
        status: "needs_config",
        enabled: false,
        live: false,
        credential_mode: "server_side_required",
        credentials_required_in_ui: false,
        frontend_credentials_allowed: false,
        transaction_source: "provider_sync",
        enabled_actions: [],
        disabled_actions: ["create_link_token", "exchange_public_token", "sync_transactions"],
        reason: hasPlaidConfig
          ? "Plaid env vars are present, but the Plaid runtime and encrypted token store are not implemented yet."
          : "Plaid env vars, link-token route, token exchange, and encrypted item storage are not configured.",
      },
      {
        id: "plaid-credit-card",
        display_name: "Credit card sync",
        kind: "credit_card",
        provider: "plaid",
        status: "needs_config",
        enabled: false,
        live: false,
        credential_mode: "server_side_required",
        credentials_required_in_ui: false,
        frontend_credentials_allowed: false,
        transaction_source: "provider_sync",
        enabled_actions: [],
        disabled_actions: ["create_link_token", "exchange_public_token", "sync_transactions"],
        reason: hasPlaidConfig
          ? "Plaid env vars are present, but card transaction sync is not implemented yet."
          : "Plaid env vars, link-token route, token exchange, and encrypted item storage are not configured.",
      },
    ],
    planned_onboarding_steps: [
      "Choose the production bank data provider contract, defaulting to Plaid Transactions.",
      "Add server-side link-token creation and public-token exchange behind admin/session auth.",
      "Store provider item/access tokens encrypted on the server, never in browser storage.",
      "Normalize synced bank/card rows into the same transaction schema as manual and CSV entries.",
      "Add duplicate detection, category mapping, audit history, and owner-controlled disconnect.",
    ],
    disabled_actions: ["live_bank_sync", "live_credit_card_sync", "store_provider_tokens", "count_quote_potential_as_cash"],
    safety_flags: {
      no_plaintext_credentials: true,
      no_frontend_bank_tokens: true,
      no_live_provider_calls: true,
      no_pipeline_cash_counting: true,
    },
    reason:
      "Finance ledger is live for manual rows and CSV imports. Bank/card sync is an explicit backend integration step and remains disabled until a secure Plaid-compatible runtime is implemented.",
  };
}
