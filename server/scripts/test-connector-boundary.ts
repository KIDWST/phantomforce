import { getWorkspaceModuleView } from "../src/access/module-handlers.js";
import type { ClientAccessRecord } from "../src/access/client-access-state.js";
import type { WorkspaceAccessDecision } from "../src/access/access-guard.js";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

const record: ClientAccessRecord = {
  id: "client-missing-calendar-credential",
  business: "Missing Calendar Credential Demo",
  owner: "Client Owner",
  plan: "$1,250/mo Ops Support",
  paymentStatus: "paid",
  accessStatus: "active",
  gateway: "Pangolin",
  privateRoute: "app.phantomforce.online/missing-calendar-credential-demo",
  modules: ["Command", "Calendar"],
  connectorCredentials: {},
  lastAudit: "Synthetic connector-boundary fail-closed fixture",
};

const decision: WorkspaceAccessDecision = {
  allowed: true,
  mode: "full",
  reason: "Synthetic active workspace for connector-boundary test.",
  modules: record.modules,
};

const moduleView = await getWorkspaceModuleView(record, decision, "Calendar");

assert(moduleView.connector?.status === "missing", "Calendar connector should report missing credential reference.");
assert(moduleView.connector?.credentialMode === "missing", "Calendar credential mode should be missing.");
assert(moduleView.connector?.credentialSource === "none", "Missing credential should have no credential source.");
assert(moduleView.connector?.credentialRef === null, "Missing credential should not expose a credential ref.");
assert(moduleView.connector?.live === false, "Missing credential must not claim live connector access.");
assert(moduleView.records.length === 0, "Missing credential should not return calendar records.");
assert(
  moduleView.disabledActions.some((action) => action.id === "view-calendar"),
  "Missing credential should disable even read connector actions.",
);
assert(
  moduleView.disabledActions.some((action) => action.id === "create-event"),
  "Missing credential should disable write connector actions.",
);
assert(moduleView.primaryActions.length === 0, "Missing credential should expose no enabled Calendar actions.");

console.log(
  JSON.stringify({
    ok: true,
    connectorStatus: moduleView.connector.status,
    credentialMode: moduleView.connector.credentialMode,
    credentialSource: moduleView.connector.credentialSource,
    disabledActions: moduleView.disabledActions.map((action) => action.id),
    primaryActions: moduleView.primaryActions.map((action) => action.id),
  }),
);
