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
assert.match(social, /Connect \$\{account\.name\}/u);
assert.match(accounting, /data-act="connector"[\s\S]{0,180}>\$\{connector\.status === "connected" \? "Manage" : "Connect"\}/u);
assert.match(accounting, /const currentFinance = financeNow\(\)[\s\S]*currentConnector\.status = payload\.state[\s\S]*store\.save\(\)/u,
  "Accounting must persist the request on the post-render finance document.");
assert.match(customerView, /nothing else is needed from you/u);
assert.match(planner, /data-settings-target="media">Connect</u);
assert.match(account, /data-settings-target="media">Connect payments</u);
assert.doesNotMatch(customerSurface, /Needs configuration|Set up now|Open setup guide|Developer provider setup|Client secret|App secret|backend credentials|No live payment connector|Not wired here/iu);
assert.doesNotMatch(customerSurface, /data-oauth-client-id|data-oauth-client-secret/iu);

console.log("One-click customer connection UI checks passed.");
