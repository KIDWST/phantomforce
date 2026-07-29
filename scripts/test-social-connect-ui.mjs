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
assert.match(main, /title: "Admin"[\s\S]{0,300}pf\.settings\.tab\.v1", "organization"/u,
  "Admin must open the real organization management panel.");
assert.match(main, /opener\.dataset\.settingsTarget/u,
  "Settings deep links must honor their requested tab.");

assert.match(contentHub, /socialConnectorsFromResponse/u);
assert.match(socialSettings, /socialConnectorsFromResponse/u);
assert.match(contentHub, /Connect account/u);
assert.doesNotMatch(accountSources, /Setup requested|Owner setup needed|Waiting on platform setup|Connection pending/iu,
  "Public account surfaces must not display false setup-request states.");

console.log("Social connection and admin navigation checks passed.");
