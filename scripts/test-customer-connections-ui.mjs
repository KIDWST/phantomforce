import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const center = read("app/js/connection-center.js");
const social = read("app/js/social-settings.js");
const accounting = read("app/js/workspaces.js");
const settings = read("app/js/settings.js");
const planner = read("app/js/contenthub.js");
const account = read("app/js/main.js");
const customerView = read("server/src/connectors/social-customer-view.ts");
const customerSurface = [center, social, accounting, planner, account].join("\n");

assert.match(settings, /label: "Connections"/u);
assert.match(center, /One-click connections/u);
assert.match(center, /data-connection-start/u);
assert.match(center, /\/api\/connections\/start/u);
assert.match(center, /configuration_required/u);
assert.match(center, /Needs configuration/u);
assert.match(center, /<details class="set-connect-group"/u, "Connection categories must collapse instead of rendering one endless wall.");
assert.match(center, /needsConfiguration \? `data-connection-fix=[\s\S]*: `data-connection-start=/u,
  "Unavailable sign-in must become an actionable recovery path, never a fake provider start.");
assert.match(center, /connector\.resolution/u, "Configuration blockers must explain the exact fix.");
assert.match(center, /Ask platform owner[\s\S]*connectionOpts\.isOwnerOperator/u,
  "Configuration blockers must preserve the platform-owner boundary.");
assert.match(social, /Connect \$\{account\.name\}/u);
assert.match(accounting, /data-act="connector"[\s\S]{0,180}>\$\{connector\.status === "connected" \? "Manage" : "Connect"\}/u);
assert.match(accounting, /const currentFinance = financeNow\(\)[\s\S]*currentConnector\.status = payload\.state[\s\S]*store\.save\(\)/u,
  "Accounting must persist the request on the post-render finance document.");
assert.match(customerView, /one-time provider setup/u);
assert.doesNotMatch(customerView, /nothing else is needed from you/iu);
assert.match(planner, /data-settings-target="media">Connect</u);
assert.match(account, /data-settings-target="media">Connect payments</u);
assert.doesNotMatch(customerSurface, /Connection requested\. Nothing else is needed|Set up now|Open setup guide|Client secret|App secret|No live payment connector|Not wired here/iu);
assert.doesNotMatch(customerSurface, /data-oauth-client-id|data-oauth-client-secret/iu);

console.log("One-click customer connection UI checks passed.");
