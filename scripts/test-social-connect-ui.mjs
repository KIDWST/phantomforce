import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { socialConnectorsFromResponse, socialPreflightFromResponse } from "../app/js/social-connection-state.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const availableResponse = {
  social_connections: {
    providers: [{
      provider: "instagram",
      name: "Instagram",
      globallyAvailable: true,
      connectionStatus: "AVAILABLE_TO_CONNECT",
      capabilityStatus: "ANALYTICS_AND_POSTING",
      savedHandleReference: "@officialchicagoshots",
      customerMessage: "Sign in to connect Instagram.",
      action: "CONNECT_ACCOUNT",
    }],
    oauthPreflight: { configured: 1, total: 7 },
  },
};
const [available] = socialConnectorsFromResponse(availableResponse);
assert.equal(available.id, "instagram");
assert.equal(available.oauthConfigured, true);
assert.equal(available.configured, false);
assert.equal(available.handle, "@officialchicagoshots");
assert.equal(available.savedConnection, null);
assert.deepEqual(
  socialPreflightFromResponse(availableResponse),
  {
    readyCount: 1,
    authorizedCount: 0,
    totalCount: 1,
    platforms: [{
      id: "instagram",
      name: "Instagram",
      oauthAppReady: true,
      accountAuthorized: false,
      canStartOAuth: true,
      canSync: false,
      nextAction: "connect_signed_in_account",
      nextLabel: "Connect account",
      nextDetail: "Sign in to connect Instagram.",
    }],
  },
);

const [connected] = socialConnectorsFromResponse({
  social_connections: {
    providers: [{
      provider: "youtube",
      name: "YouTube",
      globallyAvailable: true,
      connectionStatus: "CONNECTED",
      capabilityStatus: "ANALYTICS_AND_POSTING",
      displayName: "ChicagoShots",
      username: "@officialchicagoshots",
    }],
  },
});
assert.equal(connected.configured, true);
assert.equal(connected.oauthConfigured, true);
assert.equal(connected.handle, "@officialchicagoshots");

const main = read("app/js/main.js");
const contentHub = read("app/js/contenthub.js");
const socialSettings = read("app/js/social-settings.js");
const server = read("server/src/index.ts");
const accountSources = [main, contentHub, socialSettings, read("app/js/workspaces.js")].join("\n");

assert.match(main, /id: "adminos"[\s\S]{0,140}adminOnly: true/u,
  "Admin must be a workspace-management surface.");
assert.doesNotMatch(main, /adminos:\s*"developer"/u,
  "Admin must not redirect to Developer.");
assert.match(main, /data-user-menu-action="settings"/u,
  "The top-right menu must expose Settings.");
assert.match(main, /data-user-menu-action="organization"/u,
  "Workspace managers must get an Organization & employees shortcut.");
assert.match(main, /data-user-menu-action="developer"/u,
  "The owner menu must retain the Developer panel.");
assert.match(main, /title: "Admin"/u,
  "Admin must remain a first-class workspace route.");
assert.match(main, /adminos:\s*\{[\s\S]{0,4200}data-admin-organization[\s\S]{0,900}renderOrganizationPanel\(organizationPanel/u,
  "Admin must render the organization command center directly.");
assert.doesNotMatch(main, /adminos:\s*\{[\s\S]{0,2600}data-production-core-panel/u,
  "Admin must not fall back to the oversized production-core settings wall.");
assert.match(main, /data-admin-jump="connections"[\s\S]{0,2600}pf\.settings\.tab\.v1", "media"/u,
  "Admin must provide a direct connection-settings shortcut.");
assert.match(main, /opener\.dataset\.settingsTarget/u,
  "Settings deep links must honor their requested tab.");

assert.match(contentHub, /socialConnectorsFromResponse/u);
assert.match(socialSettings, /socialConnectorsFromResponse/u);
assert.match(contentHub, /Connect account/u);
assert.match(contentHub, /data-an-provider-setup/u,
  "Analytics must route unconfigured providers to real connection settings.");
assert.match(socialSettings, /\/phantom-ai\/ops\/social-oauth\/setup/u,
  "Owners must have a real provider setup endpoint.");
assert.match(socialSettings, /data-social-provider-form/u,
  "Owners must have a usable provider configuration form.");
assert.match(socialSettings, /json\?\.oauth\?\.authorizationUrl/u,
  "Social connection success requires a real authorization URL.");
assert.match(server, /reply\.code\(409\)\.send\(\{[\s\S]{0,220}state: "setup_required"/u,
  "Missing social provider setup must return an honest configuration error.");
assert.doesNotMatch(accountSources, /Setup requested|Owner setup needed|Waiting on platform setup|Connection pending/iu,
  "Public account surfaces must not display false setup-request states.");
assert.doesNotMatch(accountSources, /Nothing else is needed from you/iu,
  "Account surfaces must never claim setup is complete when authorization did not open.");

console.log("Social connection and admin navigation checks passed.");
