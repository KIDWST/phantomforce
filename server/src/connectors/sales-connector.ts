// Sales connector onboarding -- pre-live status boundary.
//
// There is no live Sales/CRM connector yet. Rather than ship a half-wired
// connector with broken buttons or latent external sends, this exposes a clear,
// admin-only "planned / coming later" status so the product is honest about it.
//
// Hard boundaries (pre-live):
// - Always disabled and non-live. No credentials are requested or stored.
// - No external send / outreach / CRM sync action exists or is enabled.
// - Enabling real onboarding later is a separate, explicitly-authorized step.

export type SalesConnectorStatus = {
  connector: "sales";
  display_name: string;
  enabled: false;
  live: false;
  read_only: true;
  admin_only: true;
  status: "planned";
  onboarding_state: "not_started";
  credential_mode: "none";
  credentials_required_in_ui: false;
  external_send: false;
  enabled_actions: [];
  disabled_actions: string[];
  planned_onboarding_steps: string[];
  enable_gate_env: string;
  enable_gate_seen: boolean;
  reason: string;
};

export const SALES_CONNECTOR_ENABLE_ENV = "PHANTOMFORCE_SALES_CONNECTOR_ENABLED";

export function getSalesConnectorStatus(env: NodeJS.ProcessEnv = process.env): SalesConnectorStatus {
  const gateSeen = env[SALES_CONNECTOR_ENABLE_ENV] === "true";

  return {
    connector: "sales",
    display_name: "Sales connector",
    // Intentionally hard-disabled in pre-live cleanup. Even if the enable gate
    // env is set, no live connector behavior exists to turn on yet, so this
    // never reports enabled/live -- it stays a planned status until a real
    // provider + onboarding is implemented and separately authorized.
    enabled: false,
    live: false,
    read_only: true,
    admin_only: true,
    status: "planned",
    onboarding_state: "not_started",
    credential_mode: "none",
    credentials_required_in_ui: false,
    external_send: false,
    enabled_actions: [],
    disabled_actions: ["import_leads", "sync_crm", "send_outreach", "log_activity_to_crm"],
    planned_onboarding_steps: [
      "Choose a real sales/CRM provider (e.g. lead source) and its API contract.",
      "Add a typed connector + credential boundary (no secrets in UI).",
      "Implement read-only lead import behind approval/audit, then approval-gated sync.",
      "Explicitly enable via a dedicated authorized step before any live use.",
    ],
    enable_gate_env: SALES_CONNECTOR_ENABLE_ENV,
    enable_gate_seen: gateSeen,
    reason:
      "Sales connector is not wired yet. It is intentionally disabled (planned) until a real CRM/lead provider, typed credential boundary, and approval-gated import are implemented and explicitly enabled. No credentials, no external send, no live action.",
  };
}
