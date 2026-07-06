import { readFileSync } from "node:fs";

import { getSalesConnectorStatus, SALES_CONNECTOR_ENABLE_ENV } from "../src/connectors/sales-connector.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

// Static guard: the sales connector status module must not call out or read creds.
const source = readFileSync(new URL("../src/connectors/sales-connector.ts", import.meta.url), "utf8");
assert(!/\bfetch\s*\(/i.test(source), "sales connector must not call fetch.");
assert(!/https?\.request|axios|node-fetch/i.test(source), "sales connector must not make HTTP requests.");
assert(!/OPENROUTER|api[_-]?key|getCredential|process\.env\.[A-Z_]*KEY/i.test(source), "sales connector must not read credentials/keys.");

// Default: planned + disabled + non-live + no creds + no send.
const status = getSalesConnectorStatus({} as NodeJS.ProcessEnv);
assert(status.connector === "sales", "connector id");
assert(status.enabled === false, "must be disabled");
assert(status.live === false, "must be non-live");
assert(status.status === "planned", "status planned");
assert(status.onboarding_state === "not_started", "onboarding not started");
assert(status.credential_mode === "none", "no credential mode");
assert(status.credentials_required_in_ui === false, "no credentials required in UI");
assert(status.external_send === false, "no external send");
assert(status.admin_only === true, "admin only");
assert(status.enabled_actions.length === 0, "no enabled actions");
assert(status.disabled_actions.length > 0, "lists disabled actions");
assert(status.planned_onboarding_steps.length > 0, "documents onboarding steps");
assert(typeof status.reason === "string" && status.reason.length > 0, "has a reason");

// Even if the enable gate env is set, it must NOT flip live/enabled (no live
// connector behavior exists; enabling is a separate authorized step).
const withGate = getSalesConnectorStatus({ [SALES_CONNECTOR_ENABLE_ENV]: "true" } as unknown as NodeJS.ProcessEnv);
assert(withGate.enable_gate_seen === true, "gate env is observed");
assert(withGate.enabled === false, "gate env must not enable the connector");
assert(withGate.live === false, "gate env must not make it live");
assert(withGate.external_send === false, "gate env must not enable sends");

console.log(
  JSON.stringify(
    {
      ok: true,
      status: status.status,
      enabled: status.enabled,
      live: status.live,
      externalSend: status.external_send,
      credentialsRequiredInUi: status.credentials_required_in_ui,
      adminOnly: status.admin_only,
      gateEnvHonoredButStillDisabled: withGate.enable_gate_seen && !withGate.enabled && !withGate.live,
    },
    null,
    2,
  ),
);
