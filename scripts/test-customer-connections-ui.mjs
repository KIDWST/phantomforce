import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

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
assert.match(center, /function emailAutomationOverview[\s\S]*Secure sending[\s\S]*Delivery tracking[\s\S]*Reply sync[\s\S]*CRM email autopilot/u,
  "Connections must summarize the complete verified email automation path before the general connector catalogue.");
assert.match(center, /CONNECTION_GROUP_ORDER = Object\.freeze\(\["Email"/u,
  "Email connections must lead the general catalogue instead of hiding behind accounting setup.");
assert.match(center, /data-connection-group="\$\{esc\(group\)\}"/u,
  "A CRM deep link must be able to open and focus the Email connector group.");
assert.match(center, /focusMode = focusGroup === "Email"[\s\S]*Inbox automation · Focused setup[\s\S]*Show all connections/u,
  "A CRM email deep link must become a focused inbox-automation flow with a clear return path.");
assert.match(center, /connectionGroups\(focusGroup, \{ onlyFocus: focusMode \}\)/u,
  "Focused inbox setup must omit unrelated connector groups.");
assert.match(settings, /settings settings-operator \$\{connectionFocus \? "is-connection-focus" : ""\}/u,
  "Focused inbox setup must remove the unrelated settings category rail.");
assert.match(settings, /requestedConnectionFocus \|\| String\(opts\.connectionFocus \|\| ""\)[\s\S]*opts = \{ \.\.\.opts, connectionFocus \}/u,
  "Focused inbox setup must survive internal settings hydration rerenders.");
assert.match(settings, /function loadSettingsConnectionFocus[\s\S]*sessionStorage\.getItem\(SETTINGS_CONNECTION_FOCUS_KEY\)[\s\S]*function clearSettingsConnectionFocus/u,
  "Focused inbox setup must remain active through independent settings renders and expose an explicit clear path.");
assert.match(settings, /onClearFocus: \(\) => \{[\s\S]*clearSettingsConnectionFocus\(\)[\s\S]*renderOperatorSettings\(el, \{ \.\.\.opts, connectionFocus: "" \}\)/u,
  "Show all connections must restore the complete settings navigation instead of leaving a hidden rail.");
assert.match(account, /key !== "settings"[\s\S]*sessionStorage\.removeItem\("pf\.settings\.connection\.focus\.v1"\)/u,
  "Leaving Settings must clear the focused inbox route so normal navigation never reopens stale setup state.");
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
assert.match(accounting, /data-settings-target="media" data-settings-focus="Email"/u,
  "CRM connection settings must land on Email setup instead of the AI brain tab.");
assert.match(settings, /SETTINGS_TAB_ALIASES = Object\.freeze\(\{ connections: "media" \}\)/u,
  "Legacy connection links must normalize to the real Connections settings tab.");
assert.match(account, /sessionStorage\.setItem\("pf\.settings\.connection\.focus\.v1"/u,
  "Settings deep links must preserve the requested connector group for the destination render.");
assert.doesNotMatch(customerSurface, /Connection requested\. Nothing else is needed|Set up now|Open setup guide|Client secret|App secret|No live payment connector|Not wired here/iu);
assert.doesNotMatch(customerSurface, /data-oauth-client-id|data-oauth-client-secret/iu);

assert.match(settings, /opts = \{ \.\.\.opts, initialTab: undefined \}/u,
  "A settings deep link must not lock every later tab click to its initial tab.");

// Exercise the actual module with isolated accounts and controlled responses.
// No network, credentials, or owner records are used by this fixture.
let tenant = "fixture-a";
let authIdentity = "fixture-session-a";
let nextFetch;
let fetchCount = 0;
const api = runInNewContext(center.replace(/^import .*;\r?$/gmu, "").replace(/^export /gmu, "") + "\n({ getEmailConnectionSnapshot });", {
  session: { token: () => authIdentity, get: () => ({ sessionId: authIdentity }) },
  currentTenantId: () => tenant,
  AbortSignal,
  Date,
  fetch: (...args) => { fetchCount += 1; return nextFetch(...args); },
});
const readyResponse = (provider) => ({
  ok: true,
  json: async () => ({
    connectors: [{ group: "Email", state: "connected", name: provider }],
    email_execution: { sendReady: true, trackingReady: true, replySyncReady: true },
  }),
});
let releaseOldAccount;
nextFetch = () => new Promise((resolve) => { releaseOldAccount = resolve; });
const oldRequest = api.getEmailConnectionSnapshot({ force: true });
tenant = "fixture-b";
authIdentity = "fixture-session-b";
nextFetch = async () => readyResponse("Fixture B inbox");
const current = await api.getEmailConnectionSnapshot();
assert.equal(current.provider, "Fixture B inbox");
assert.equal(current.sendReady, true);
releaseOldAccount(readyResponse("Fixture A private inbox"));
const obsolete = await oldRequest;
assert.equal(obsolete.state, "error");
assert.equal(obsolete.provider, "");
assert.equal(obsolete.sendReady, false);
assert.equal((await api.getEmailConnectionSnapshot()).provider, "Fixture B inbox", "An old tenant response cannot overwrite the current account.");
assert.equal(fetchCount, 2, "Concurrent account requests cannot share one in-flight promise.");
authIdentity = "fixture-session-b-new";
nextFetch = async () => readyResponse("New authenticated inbox");
assert.equal((await api.getEmailConnectionSnapshot()).provider, "New authenticated inbox", "Changing auth identity invalidates even the same tenant's cache.");
nextFetch = async () => ({ ok: false, status: 401, json: async () => ({ error: "Authorization token expired" }) });
const failed = await api.getEmailConnectionSnapshot({ force: true });
assert.equal(failed.state, "error");
assert.equal(failed.provider, "");
assert.equal(failed.sendReady, false);
assert.equal(failed.trackingReady, false);
assert.equal(failed.replySyncReady, false);
assert.doesNotMatch(failed.message, /token expired/iu);
nextFetch = async () => readyResponse("Recovered inbox");
assert.equal((await api.getEmailConnectionSnapshot()).provider, "Recovered inbox", "An auth failure must be retried instead of becoming a permanent loaded cache.");
console.log("Customer connection UI and behavioral isolation checks passed: stale response discarded, auth cache invalidated, failed readiness cleared, recovery retried.");
