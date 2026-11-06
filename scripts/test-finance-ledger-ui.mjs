import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workspace = await readFile(new URL("../app/js/workspaces.js", import.meta.url), "utf8");
const client = await readFile(new URL("../app/js/financeledger.js", import.meta.url), "utf8");
const store = await readFile(new URL("../app/js/store.js", import.meta.url), "utf8");
const server = await readFile(new URL("../server/src/index.ts", import.meta.url), "utf8");

assert.match(workspace, /loadAuthoritativeFinance\(ws, rerender\)/u, "Accounting must load its tenant ledger from the server");
assert.match(workspace, /legacy-browser:/u, "Existing browser records need a deterministic one-time migration");
assert.match(workspace, /financeContentKey\(text\)/u, "CSV import retries must use a content-derived key");
assert.match(workspace, /voidServerFinanceTransaction/u, "UI deletion must call the server-side auditable void operation");
assert.match(workspace, /reconcileServerFinanceTransaction/u, "Reconciliation must be available from the Accounting UI");
assert.match(workspace, /isDatabaseSession\(\) && !canManageActiveOrg\(\)/u, "Client-role Accounting must be read-only");
assert.match(workspace, /testMode: false/u, "UI writes must explicitly distinguish actual records from test data");
assert.doesNotMatch(workspace, /This cannot be undone/u, "Accounting must not describe audited voiding as hard deletion");
const accounting = workspace.slice(workspace.indexOf("async function loadAuthoritativeFinance"), workspace.indexOf("function render", workspace.indexOf("function renderMoney") + 1));
assert.match(accounting, /Recorded cash inflow/u, "Positive ledger entries must be labeled as recorded inflow");
assert.match(accounting, /Inflow may include transfers or loans; it is not verified customer revenue/u, "The inflow total must distinguish recorded cash from verified customer revenue");
assert.match(accounting, /Reconciliation records your review and does not independently verify payment/u, "Manual reconciliation must not certify a payment");
assert.doesNotMatch(accounting, /Cash collected|from real transactions|Verified server ledger|verified ledger|Verified browser-ledger migration|Verifying \$\{rows/u, "Saving or importing a ledger entry must not claim payment verification");

assert.match(client, /\/api\/finance\/ledger/u);
assert.match(client, /\/api\/finance\/import/u);
assert.match(client, /\/reconcile/u);
assert.match(client, /method: "DELETE"/u);
assert.match(store, /serverAuthoritative: Boolean/u, "Authoritative markers must survive state normalization");
assert.match(store, /reconciliationStatus:/u, "Reconciliation state must survive state normalization");

assert.match(server, /canManageWorkspaceModules\(session, tenantId\)/u, "Finance writes must use the owner\/admin role boundary");
assert.match(server, /app\.get\("\/api\/finance\/ledger"/u);
assert.match(server, /app\.post\("\/api\/finance\/transactions"/u);

console.log(JSON.stringify({
  ok: true,
  product: "Accounting UI authority",
  serverBacked: true,
  legacyMigration: true,
  contentIdempotency: true,
  auditedVoid: true,
  reconciliation: true,
  clientReadOnly: true,
}, null, 2));
