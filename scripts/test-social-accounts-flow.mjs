import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { socialConnectorsFromResponse, socialPreflightFromResponse } from '../app/js/social-connection-state.js';
import { BUSINESS_PROFILES, businessNavigation } from '../app/js/business-profiles.js';

const source = readFileSync(new URL('../app/js/social-settings.js', import.meta.url), 'utf8');
const settle = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };
const response = (json, ok = true) => ({ ok, status: ok ? 200 : 503, json: async () => json });
const provider = (overrides = {}) => ({ provider: 'instagram', name: 'Instagram', globallyAvailable: true, connectionStatus: 'AVAILABLE_TO_CONNECT', capabilityStatus: 'NOT_CONNECTED', ...overrides });
const status = (tenant, row = provider(), extra = {}) => ({ ok: true, tenant_id: tenant, can_manage_accounts: true, social_connections: { providers: [row] }, ...extra });

class Root {
  isConnected = true;
  nodes = [];
  set innerHTML(value) {
    this.html = value;
    this.nodes = [...value.matchAll(/<([a-z][\w-]*)\b([^>]*)>/gi)].map(([, tag, attrs]) => {
      const attributes = Object.fromEntries([...attrs.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(([, key, value]) => [key, value || '']));
      return { tag, attributes, dataset: Object.fromEntries(Object.entries(attributes).filter(([key]) => key.startsWith('data-')).map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()), value])),
        disabled: 'disabled' in attributes, fields: {}, addEventListener(event, handler) { this[`on${event}`] = handler; }, querySelector() { return {}; }, reset() {} };
    });
  }
  get innerHTML() { return this.html; }
  querySelectorAll(selector) {
    const [, attr, value] = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/) || [];
    return this.nodes.filter(node => attr in node.attributes && (value === undefined || node.attributes[attr] === value));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  async click(selector) { const node = this.querySelector(selector); assert.ok(node, selector); assert.equal(node.disabled, false); node.onclick?.(); await settle(); }
  async submit(selector, fields) { const node = this.querySelector(selector); assert.ok(node, selector); node.fields = fields; await node.onsubmit({ preventDefault() {} }); await settle(); }
}

function harness(owner = false) {
  const h = { tenant: 'business-a', token: 'fixture-auth-a', requests: [], listeners: new Map(), accounts: [{ id: 'instagram', name: 'Instagram', color: '#e1306c', enabled: false }], saves: 0 };
  h.fetcher = async () => response(status(h.tenant));
  const context = { currentTenantId: () => h.tenant, accessSession: { token: () => h.token, get: () => ({ canManageAccess: owner }) },
    loadSocialAccounts: () => h.accounts.map(row => ({ ...row })), saveSocialAccounts: rows => { h.accounts = rows; h.saves++; }, socialConnectorsFromResponse,
    AbortController, URL, Date, setTimeout, clearTimeout, FormData: class { constructor(form) { this.fields = form.fields; } get(key) { return this.fields[key]; } *[Symbol.iterator]() { yield* Object.entries(this.fields); } },
    window: { location: { origin: 'https://fixture.example' }, open: () => null, addEventListener: (event, handler) => h.listeners.set(event, handler), removeEventListener: event => h.listeners.delete(event) },
    fetch: async (url, options) => { h.requests.push({ url, ...options }); return h.fetcher(url, options); } };
  h.render = runInNewContext(source.replace(/^import .*;\r?$/gm, '').replace(/^export /gm, '') + '\nrenderSocialSettings;', context);
  h.root = new Root(); h.controller = h.render(h.root, { standalone: true });
  h.emit = (event, data) => h.listeners.get(event)?.(data);
  return h;
}

for (const profile of Object.values(BUSINESS_PROFILES)) assert.equal(businessNavigation(profile).filter(row => row.id === 'business-social').length, 1);
const expired = socialConnectorsFromResponse({ ...status('business-a', provider({ connectionStatus: 'REAUTH_REQUIRED' })), social_analytics: { connectors: [{ id: 'instagram', configured: true }] } });
assert.equal(expired[0].configured, false, 'Expired customer authorization must override legacy configured flags for owners.');
assert.equal(socialPreflightFromResponse(status('business-a', provider({ globallyAvailable: false }))).platforms[0].canStartOAuth, false);

const h = harness(); await settle();
assert.match(h.root.innerHTML, /Ready to connect/);
assert.doesNotMatch(h.root.innerHTML, /data-social-provider-form|Set up provider/);
assert.equal(h.requests[0].headers['x-phantomforce-business'], 'business-a');
assert.equal(h.requests[0].headers.Authorization, 'Bearer fixture-auth-a');
h.fetcher = async (url, options) => url.endsWith('/start') ? response({ ok: true, tenant_id: 'business-a', oauth: { authorizationUrl: 'https://www.facebook.com/v21.0/dialog/oauth?state=fixture' } }) : response(status('business-a'));
await h.root.click('[data-social-open="instagram"]');
assert.match(h.root.innerHTML, /browser blocked/);
assert.match(h.root.innerHTML, /Continue sign-in/);
assert.equal(JSON.parse(h.requests.at(-1).body).tenant_id, 'business-a');
const countBeforeWrongEvent = h.requests.length;
h.emit('message', { origin: 'https://fixture.example', data: { protocol: 'phantomforce.social-oauth.v1', tenant_id: 'business-b', type: 'connected' } });
h.emit('message', { origin: 'https://attacker.example', data: { protocol: 'phantomforce.social-oauth.v1', tenant_id: 'business-a', type: 'connected' } });
await settle(); assert.equal(h.requests.length, countBeforeWrongEvent, 'Other-business or foreign-origin callback messages cannot affect the active account.');

h.fetcher = async () => response(status('business-a', provider(), { asset_selections: [{ platform: 'instagram', selectionId: 'selection-a', pages: [{ id: 'page-a', name: 'Studio Page' }, { id: 'page-b', name: 'Shop Page' }] }] }));
await h.controller.refresh();
assert.match(h.root.innerHTML, /Choose an account/); assert.match(h.root.innerHTML, /Studio Page/); assert.match(h.root.innerHTML, /Shop Page/);
h.fetcher = async url => url.endsWith('/select-asset') ? response({ ok: true, tenant_id: 'business-a' }) : response(status('business-a', provider({ connectionStatus: 'CONNECTED', username: '@studio', capabilityStatus: 'ANALYTICS_READY' })));
await h.root.submit('[data-social-selection="instagram"]', { pageId: 'page-a' });
const select = h.requests.find(request => request.url.endsWith('/select-asset'));
assert.deepEqual(JSON.parse(select.body), { platform: 'instagram', selectionId: 'selection-a', pageId: 'page-a', tenant_id: 'business-a' });
assert.match(h.root.innerHTML, /@studio/); assert.match(h.root.innerHTML, /Analytics authorized/); assert.match(h.root.innerHTML, /Publishing permission needed/);
await h.root.click('[data-social-disconnect="instagram"]');
h.fetcher = async () => response({ error: 'Connection service unavailable' }, false);
await h.root.click('[data-confirm-disconnect="instagram"]');
assert.equal(h.saves, 0, 'Failed server disconnect must not clear local data or claim removal.');
assert.match(h.root.innerHTML, /Connection service unavailable/);
h.fetcher = async url => url.endsWith('/disconnect') ? response({ ok: true, tenant_id: 'business-a' }) : response(status('business-a'));
await h.root.click('[data-confirm-disconnect="instagram"]');
assert.equal(h.saves, 1); assert.match(h.root.innerHTML, /Connection removed from this business/);
assert.equal(JSON.parse(h.requests.filter(request => request.url.endsWith('/disconnect')).at(-1).body).tenant_id, 'business-a');

h.fetcher = async () => response(status('business-b', provider({ connectionStatus: 'CONNECTED', username: 'Private B identity' })));
await h.controller.refresh();
assert.match(h.root.innerHTML, /another business/); assert.doesNotMatch(h.root.innerHTML, /Private B identity|is-connected/);
let resolveOld;
h.fetcher = () => new Promise(resolve => { resolveOld = resolve; });
const stale = h.controller.refresh();
const oldRequest = h.requests.at(-1);
h.tenant = 'business-b'; h.token = 'fixture-auth-b'; h.emit('pf:business-switch-start');
assert.equal(oldRequest.signal.aborted, true, 'Switching business cancels pending requests.');
const before = h.root.innerHTML;
resolveOld(response(status('business-a', provider({ connectionStatus: 'CONNECTED', username: 'Private A identity' }))));
await stale; assert.equal(h.root.innerHTML, before, 'Late responses cannot repaint after business switching.');
assert.equal(h.listeners.size, 0);
h.controller.destroy();

const owner = harness(true);
owner.fetcher = async url => url.endsWith('/setup') ? response({ ok: true, setup: { providers: [{ id: 'instagram', name: 'Instagram', consoleUrl: 'https://developers.facebook.com/apps/', idLabel: 'App ID', secretLabel: 'Secret', callbackUrl: 'https://fixture.example/callback' }] } }) : response(status('business-a', provider({ globallyAvailable: false, connectionStatus: 'PLATFORM_UNCONFIGURED' })));
await settle(); await owner.controller.refresh();
await owner.root.click('[data-social-setup="instagram"]');
assert.match(owner.root.innerHTML, /data-social-provider-form/);
assert.match(owner.root.innerHTML, /type="password" autocomplete="new-password"/);
assert.match(owner.root.innerHTML, /readonly value="https:\/\/fixture.example\/callback"/);
owner.controller.destroy();

const reconnect = harness(); await settle();
reconnect.fetcher = async () => response(status('business-a', provider({ connectionStatus: 'CONNECTED', connectionUpdatedAt: 'revision-1' })));
await reconnect.controller.refresh();
reconnect.fetcher = async url => url.endsWith('/start') ? response({ ok: true, tenant_id: 'business-a', oauth: { authorizationUrl: 'https://www.facebook.com/dialog/oauth?state=reconnect' } }) : response(status('business-a', provider({ connectionStatus: 'CONNECTED', connectionUpdatedAt: 'revision-1' })));
await reconnect.root.click('[data-social-open="instagram"]');
await reconnect.controller.refresh();
assert.match(reconnect.root.innerHTML, /Waiting for sign-in/, 'The old token must not finish a new reconnect.');
reconnect.fetcher = async () => response(status('business-a', provider({ connectionStatus: 'CONNECTED', connectionUpdatedAt: 'revision-2' })));
await reconnect.controller.refresh();
assert.doesNotMatch(reconnect.root.innerHTML, /Waiting for sign-in|Continue sign-in/);
assert.match(reconnect.root.innerHTML, /Instagram connected/);
reconnect.controller.destroy();

const reader = harness(); await settle();
reader.fetcher = async () => response(status('business-a', provider(), { can_manage_accounts: false }));
await reader.controller.refresh();
assert.equal(reader.root.querySelector('[data-social-open="instagram"]').disabled, true);
assert.match(reader.root.innerHTML, /business administrator must manage/);
assert.doesNotMatch(reader.root.innerHTML, /data-social-disconnect|data-social-selection/);
reader.controller.destroy();

const hub = readFileSync(new URL('../app/js/contenthub.js', import.meta.url), 'utf8');
assert.doesNotMatch(hub, /markAnalyticsOAuthConnected|startAnalyticsOAuthPolling/, 'Analytics must use the same verified connection flow, never a second popup authority.');
assert.match(hub, /event.origin !== window.location.origin/);
const completion = hub.slice(hub.indexOf('async function handleSocialOAuthComplete'), hub.indexOf('function parseSocialOAuthPayload'));
let refreshes = 0;
const callback = runInNewContext(completion + '\nhandleSocialOAuthComplete;', { analyticsTenantId: () => 'business-a', analyticsMount: { isConnected: true }, analyticsConnectorState: {}, loadSocialAccounts: () => [], analyticsOpts: {}, refreshLiveAnalytics: async () => { refreshes++; } });
await callback({ tenant_id: 'business-b', platform: 'instagram' }); assert.equal(refreshes, 0);
await callback({ tenant_id: 'business-a', platform: 'instagram' }); assert.equal(refreshes, 1);
const defaults = hub.slice(hub.indexOf('function defaultSocialAccounts()'), hub.indexOf('export function loadSocialAccounts'));
for (const tenant of ['occasionally-odd', 'phantomforce-internal', 'future-business']) {
  const rows = runInNewContext(defaults + '\ndefaultSocialAccounts();', { currentTenantId: () => tenant, store: { state: { workspaces: [] } }, PLATFORMS: [{ id: 'instagram', handle: 'officialchicagoshots' }] });
  assert.equal(rows[0].handle, '', 'Other businesses never inherit ChicagoShots public handles.');
}
console.log('Social accounts flow passed: scoped authorization, blocked popup recovery, account selection, disconnect failures, permissions, stale response rejection, and business defaults.');
