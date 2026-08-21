import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const planner = read("app/js/planner.js");
const phantomAi = read("app/js/phantomai.js");
const main = read("app/js/main.js");
const store = read("app/js/store.js");
const connections = read("app/js/connection-center.js");
const catalog = read("server/src/connectors/customer-connection-catalog.ts");
const pulse = read("server/src/phantom-ai/organization-pulse.ts");
const signals = read("server/src/phantom-ai/signals.ts");
const styles = read("app/admin-next.css");

assert.match(planner, /AI complete all safe work/, "Planner must expose one-click safe bulk completion.");
assert.match(planner, /data-pl-ai[\s\S]*data-pl-manual[\s\S]*data-pl-repair/, "Attention cards must support AI, manual, and direct-repair paths.");
assert.match(planner, /loadOrganizationPulse[\s\S]*loadBrainContract[\s\S]*brainContractAttentionItems/, "Planner attention must be hydrated from live organization intelligence.");
assert.match(planner, /\/phantom-ai\/automations\/\$\{encodeURIComponent\(item\.repairId\)\}\/run/, "Safe automation repair must use the real execution endpoint.");
assert.match(planner, /\/phantom-ai\/runs\/\$\{encodeURIComponent\(run\.id\)\}\/retry/, "Failed runs must use the real retry endpoint.");
assert.match(planner, /Do not send, publish, deploy, spend, delete, change credentials, or approve/, "Bulk AI work must preserve consequential owner gates.");
assert.match(planner, /ownerOperator: opts\.isOwnerOperator === true/, "Platform-wide automation repair must remain owner-only.");

assert.match(phantomAi, /chatBindings\.submitPrompt\(queued\.prompt, \[\]\)/, "Queued operator work must enter PhantomBot's actual submission pipeline.");
assert.match(phantomAi, /export function queuePhantomAiPrompt[\s\S]*queuedOperatorPrompt =/, "Planner must be able to queue real PhantomBot work.");
assert.match(main, /isOwnerOperator: isOwnerOperator\(\)[\s\S]*runAI:[\s\S]*queuePhantomAiPrompt/, "Shared workspace options must expose owner posture and the live AI route.");
assert.match(store, /export function todaysPlan[\s\S]*recordId[\s\S]*manualAction: "follow-up-done"[\s\S]*manualAction: "done"/, "Local attention must carry executable record identities and manual actions.");
assert.match(store, /kind: "approval"[\s\S]*approvalRequired: true[\s\S]*kind: "task"[\s\S]*approvalRequired: false/, "Owner approvals and safe internal tasks must remain distinct.");

assert.match(connections, /Diagnose & recheck all[\s\S]*set-connect-health/, "Connections must have a one-click full diagnosis and health summary.");
assert.match(connections, /Ask platform owner/, "Connection blockers must expose an owner escalation action rather than becoming dead buttons.");
assert.match(connections, /connector\.resolution \|\| "The platform owner must finish the secure connection service setup\."/, "Connection blockers must explain the exact resolution.");
assert.match(connections, /connectionOpts\.isOwnerOperator[\s\S]*openWorkspace\("developer"\)/, "Only the platform owner may open platform connection diagnostics.");
assert.match(catalog, /reasonCode:[\s\S]*resolution:[\s\S]*ownerActionRequired:/, "Connection status must carry machine-readable reasons and owner actions.");

assert.match(pulse, /id: "approvals-pending"[\s\S]*canPhantomHandle: false[\s\S]*approvalRequired: true/, "Approval signals must stay owner-gated.");
assert.match(pulse, /id: `automation-failing:\$\{job\.id\}`[\s\S]*canPhantomHandle: true[\s\S]*approvalRequired: false/, "Retryable internal failures must be marked AI-actionable.");
assert.match(signals, /canPhantomHandle: opportunity\.canPhantomHandle[\s\S]*approvalRequired: opportunity\.approvalRequired/, "Brain signals must preserve truthful opportunity actionability.");

assert.match(styles, /\.planner-autopilot[\s\S]*\.planner-attention-card[\s\S]*@media \(max-width: 760px\)/, "Autopilot must retain its responsive operator UI.");
assert.match(styles, /\.set-connect-health[\s\S]*\.set-connect-state small[\s\S]*@media \(max-width: 680px\)/, "Connection diagnosis must remain readable on compact layouts.");

console.log("Autopilot attention and connection recovery regression checks passed.");
