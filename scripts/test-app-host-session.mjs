import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Isolated browser memory and mocked /session only. No production identities,
// account stores, credentials, database or network are used.
const saved = new Map(), tab = new Map();
const adapter = map => ({ getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)), removeItem: key => map.delete(key) });
globalThis.localStorage = adapter(saved); globalThis.sessionStorage = adapter(tab);
globalThis.location = { hostname: 'app.phantomforce.online', search: '', origin: 'https://app.phantomforce.online', href: 'https://app.phantomforce.online/app/index.html' };
globalThis.window = { location, dispatchEvent() {}, addEventListener() {} };
globalThis.CustomEvent = class {};
globalThis.fetch = async () => { throw new Error('Unexpected real request'); };
const main = readFileSync(new URL('../app/js/main.js', import.meta.url), 'utf8');
const storeImport = main.match(/from "(\.\/store\.js[^\"]*)"/)?.[1];
assert.ok(storeImport);
const core = await import(new URL(`../app/js/${storeImport.slice(2)}`, import.meta.url));
const { ctx, session, resolveSession, verifyLiveSession, isOwnerOperator, currentTenantId } = core;
const token = 'isolated-fixture-token';
const owner = { id: 'db:owner-fixture', label: 'Verified operator', canManageAccess: true, isSuperAdmin: true, orgId: 'phantomforce-internal', orgRole: 'owner', memberships: [{ orgId: 'phantomforce-internal', orgName: 'PhantomForce', role: 'owner' }] };
const customer = { id: 'db:customer-fixture', label: 'Customer fixture', canManageAccess: false, isSuperAdmin: false, orgId: 'customer-fixture', orgRole: 'owner', memberships: [{ orgId: 'customer-fixture', orgName: 'Customer workspace', role: 'owner' }] };
const setHost = hostname => { location.hostname = hostname; location.origin = `https://${hostname}`; location.href = `${location.origin}/app/index.html`; location.search = ''; };
const mockSession = (serverSession, status = 200) => {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/session'); assert.equal(options.headers.Authorization, `Bearer ${token}`);
    assert.ok(options.signal instanceof AbortSignal, 'Session verification must have a bounded abort signal.');
    return { ok: status === 200, status, json: async () => ({ ok: status === 200, session: serverSession }) };
  };
};
const mirror = serverSession => core.databaseSessionFromLogin({ session: serverSession, token });
const tests = [];
const test = (name, check) => tests.push({ name, check });

test('app restores a token-bearing database owner mirror', () => {
  session.set(mirror(owner)); assert.equal(resolveSession()?.isSuperAdmin, true);
});
test('Customer 1 style account keeps its own scope and gains no platform role', () => {
  session.set(mirror(customer)); ctx.session = resolveSession();
  assert.equal(currentTenantId(), customer.orgId); assert.equal(isOwnerOperator(), false); assert.equal(ctx.session.canManageAccess, false);
});
test('public account mirrors cannot restore without their tab token', () => {
  session.set({ ...mirror(owner), token: undefined }); assert.equal(resolveSession(), null); assert.equal(session.get(), null);
});
test('unsigned owner-shaped local mirrors cannot open the canonical app', () => {
  session.set({ role: 'admin', sessionId: 'owner-admin', canManageAccess: true });
  assert.equal(resolveSession(), null); assert.equal(session.get(), null);
});
test('server verification accepts a real owner regardless of display name', async () => {
  session.set(mirror(owner)); mockSession(owner); ctx.session = await verifyLiveSession();
  assert.equal(isOwnerOperator(), true); assert.equal(currentTenantId(), 'phantomforce-internal');
  assert.ok(![...saved.values()].join('').includes(token), 'Bearer tokens must remain out of persisted session mirrors.');
});
test('server-derived customer truth replaces a forged owner mirror', async () => {
  session.set(mirror(owner)); mockSession(customer); ctx.session = await verifyLiveSession();
  assert.equal(isOwnerOperator(), false); assert.equal(ctx.session.isSuperAdmin, false); assert.equal(currentTenantId(), customer.orgId);
  assert.deepEqual(ctx.session.memberships, customer.memberships);
});
test('revoked owner token is rejected and cleared', async () => {
  session.set(mirror(owner)); mockSession(null, 401);
  assert.equal(await verifyLiveSession(), null); assert.equal(session.get(), null); assert.equal(session.token(), '');
});
test('verification outage fails closed while retaining the tab token for retry', async () => {
  session.set(mirror(owner)); globalThis.fetch = async () => { throw new Error('Fixture verifier unavailable'); };
  assert.equal(await verifyLiveSession(), null); assert.equal(session.token(), token);
});
test('temporary verifier gateway failure does not revoke a valid tab token', async () => {
  session.set(mirror(owner)); mockSession(null, 502);
  assert.equal(await verifyLiveSession(), null); assert.equal(session.token(), token);
});
test('an interrupted verifier response body also keeps access closed and allows token retry', async () => {
  session.set(mirror(owner));
  globalThis.fetch = async () => ({ ok: true, json: async () => { throw new Error('Fixture body interrupted'); } });
  assert.equal(await verifyLiveSession(), null); assert.equal(session.token(), token);
});
test('an owner without an active organization is not assigned to another business', async () => {
  const unselected = { ...owner, orgId: null, orgRole: null, memberships: [] };
  session.set(mirror(unselected)); mockSession(unselected); ctx.session = await verifyLiveSession();
  assert.equal(ctx.session.database, true); assert.equal(currentTenantId(), '__unselected__'); assert.equal(isOwnerOperator(), true);
});
test('a signed legacy owner still requires server owner confirmation', async () => {
  session.set({ role: 'admin', sessionId: 'owner-admin', canManageAccess: true, ws: 'occasionally-odd', token });
  assert.ok(resolveSession()); mockSession({ id: 'owner-admin', label: 'Operator fixture', role: 'admin', canManageAccess: true });
  ctx.session = await verifyLiveSession(); assert.equal(isOwnerOperator(), true); assert.equal(currentTenantId(), 'occasionally-odd');
});
test('a legacy customer without an organization cannot become a platform owner', async () => {
  session.set({ role: 'admin', sessionId: 'owner-admin', canManageAccess: true, token });
  mockSession({ id: 'legacy-client-fixture', role: 'client', canManageAccess: false });
  assert.equal(await verifyLiveSession(), null); assert.equal(session.get(), null);
});
test('organization admins and owner-like labels never grant platform capability', () => {
  ctx.session = { ...mirror(customer), name: 'Jordan', label: 'PhantomForce Owner', sessionId: 'owner-admin' };
  assert.equal(isOwnerOperator(), false);
});
test('legacy admin alias still refuses customers', async () => {
  setHost('admin.phantomforce.online'); session.set(mirror(customer)); mockSession(customer);
  assert.equal(await verifyLiveSession(), null); assert.equal(session.get(), null);
});
test('legacy admin alias accepts a server-confirmed platform owner', async () => {
  setHost('admin.phantomforce.online'); session.set(mirror(owner)); mockSession(owner); ctx.session = await verifyLiveSession();
  assert.equal(isOwnerOperator(), true);
});
for (const shortcut of ['owner-admin', 'admin', 'employee']) test(`public query shortcut ${shortcut} cannot create a session`, () => {
  location.search = `?session=${shortcut}`; assert.equal(resolveSession(), null); assert.equal(session.get(), null);
});
test('local developer shortcut stays limited to localhost', () => {
  setHost('127.0.0.1'); location.search = '?session=owner-admin'; ctx.session = resolveSession();
  assert.equal(ctx.session.role, 'admin'); assert.equal(isOwnerOperator(), true);
});
test('legacy owner entry helpers redirect to the canonical app without copying credentials', () => {
  setHost('phantomforce.online'); session.set(mirror(owner));
  const target = new URL(core.liveAdminUrl());
  assert.equal(target.origin, 'https://app.phantomforce.online'); assert.equal(target.pathname, '/app/index.html');
  assert.equal(target.searchParams.has('session'), false); assert.ok(!target.href.includes(token));
  let redirected = ''; location.replace = url => { redirected = url; };
  core.redirectToLiveAdmin(); assert.equal(redirected, target.href);
});
test('verified platform owner customization stays available on the canonical app', async () => {
  const customizationPath = storeImport.slice(2).replace(/^store\.js/, 'customization.js');
  const customization = await import(new URL(`../app/js/${customizationPath}`, import.meta.url));
  globalThis.document = { documentElement: { style: { setProperty() {} }, dataset: {} }, body: { dataset: {} }, querySelector: () => null, querySelectorAll: () => [] };
  customization.applyOrganizationCustomization({ theme: {}, brand: {}, modules: [{ id: 'analytics', label: 'Analytics', enabled: false, roles: ['owner'] }] });
  const navigation = [{ id: 'analytics', label: 'Analytics' }];
  session.set(mirror(owner)); ctx.session = mirror(owner);
  assert.deepEqual(customization.customizeNavigation(navigation), navigation);
  // Persisted owner-looking metadata cannot override the live, server-derived
  // customer context used to decide whether platform customization is forced on.
  ctx.session = mirror(customer);
  assert.deepEqual(customization.customizeNavigation(navigation), []);
});

for (const { name, check } of tests) {
  saved.clear(); tab.clear(); ctx.session = null; setHost('app.phantomforce.online');
  await check(); console.log(`PASS ${name}`);
}
console.log(`Canonical app session: ${tests.length} checks passed (owner/customer restore, server truth, revocation, aliases and local-only shortcuts).`);
