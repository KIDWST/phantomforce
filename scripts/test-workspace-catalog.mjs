import assert from 'node:assert/strict';
import { createWorkspaceCatalog } from '../app/js/workspace-access.js';

let checks = 0;
const check = assertion => { assertion(); checks++; };
const workspace = tenantId => ({ tenantId, name: `Fixture ${tenantId}`, role: 'owner' });

function fixture() {
  const current = { account: { id: 'fixture-account' }, tenant: 'fixture-business', token: 'fixture-token' };
  const requests = [], accepted = [];
  const catalog = createWorkspaceCatalog({
    getAccount: () => current.account,
    getTenant: () => current.tenant,
    getToken: () => current.token,
    onAccepted: items => accepted.push(items),
    fetcher: (url, options) => new Promise((resolve, reject) => requests.push({ url, options, resolve, reject })),
  });
  const respond = (index, workspaces, ok = true) => requests[index].resolve({ ok, json: async () => ({ workspaces }) });
  return { current, requests, accepted, catalog, respond };
}

{
  const h = fixture();
  check(() => assert.equal(h.catalog.items, null));
  check(() => assert.equal(h.catalog.status, 'idle'));
  const load = h.catalog.load();
  check(() => assert.equal(h.catalog.status, 'loading'));
  check(() => assert.equal(h.requests[0].url, '/api/business-workspaces'));
  check(() => assert.equal(h.requests[0].options.cache, 'no-store'));
  h.respond(0, [workspace('one'), { name: 'Invalid fixture item' }]);
  const result = await load;
  check(() => assert.equal(result, true));
  check(() => assert.equal(h.catalog.status, 'ready'));
  check(() => assert.deepEqual(h.catalog.items.map(item => item.tenantId), ['one']));
  check(() => assert.equal(h.accepted.length, 1));

  const original = h.catalog.items;
  const malformed = h.catalog.load(); h.respond(1, 'not-an-array');
  const malformedResult = await malformed;
  check(() => assert.equal(malformedResult, false));
  check(() => assert.equal(h.catalog.status, 'error'));
  check(() => assert.equal(h.catalog.items, original));
  const failed = h.catalog.load(); h.requests[2].reject(new Error('Fixture connection unavailable'));
  const failedResult = await failed;
  check(() => assert.equal(failedResult, false));
  check(() => assert.equal(h.catalog.items, original));
  const refused = h.catalog.load(); h.respond(3, [workspace('forbidden')], false);
  const refusedResult = await refused;
  check(() => assert.equal(refusedResult, false));
  check(() => assert.equal(h.catalog.items, original));
  check(() => assert.equal(h.accepted.length, 1));
}

{
  const h = fixture();
  const older = h.catalog.load(), newer = h.catalog.load();
  check(() => assert.equal(h.requests[0].options.signal.aborted, true));
  check(() => assert.equal(h.requests[1].options.signal.aborted, false));
  h.respond(1, [workspace('latest')]);
  const newerResult = await newer;
  check(() => assert.equal(newerResult, true));
  // The mock deliberately ignores abort: revision checks must reject late responses too.
  h.respond(0, [workspace('obsolete')]);
  const olderResult = await older;
  check(() => assert.equal(olderResult, false));
  check(() => assert.deepEqual(h.catalog.items.map(item => item.tenantId), ['latest']));
  check(() => assert.equal(h.catalog.status, 'ready'));
  check(() => assert.equal(h.accepted.length, 1));
}

{
  const h = fixture();
  const pending = h.catalog.load();
  h.catalog.clear();
  check(() => assert.equal(h.requests[0].options.signal.aborted, true));
  check(() => assert.equal(h.catalog.items, null));
  check(() => assert.equal(h.catalog.status, 'idle'));
  h.respond(0, [workspace('logged-out-account')]);
  const result = await pending;
  check(() => assert.equal(result, false));
  check(() => assert.equal(h.catalog.items, null));
  check(() => assert.equal(h.catalog.status, 'idle'));
  check(() => assert.equal(h.accepted.length, 0));
}

{
  const h = fixture();
  const initial = h.catalog.load(); h.respond(0, [workspace('account-a')]); await initial;
  const late = h.catalog.load();
  // A replacement account can share a tenant ID; object identity must still isolate it.
  h.current.account = { id: 'different-fixture-account' };
  check(() => assert.equal(h.catalog.items, null));
  check(() => assert.equal(h.catalog.status, 'idle'));
  const fresh = h.catalog.load();
  h.respond(1, [workspace('stale-account-a')]);
  const lateResult = await late;
  check(() => assert.equal(lateResult, false));
  check(() => assert.equal(h.catalog.items, null));
  h.respond(2, [workspace('account-b')]);
  const freshResult = await fresh;
  check(() => assert.equal(freshResult, true));
  check(() => assert.deepEqual(h.catalog.items.map(item => item.tenantId), ['account-b']));
  check(() => assert.equal(h.accepted.length, 2));
}

{
  const h = fixture();
  const pending = h.catalog.load(); h.current.tenant = 'another-fixture-business';
  h.respond(0, [workspace('old-business-response')]);
  const result = await pending;
  check(() => assert.equal(result, false));
  check(() => assert.equal(h.catalog.items, null));
  check(() => assert.equal(h.accepted.length, 0));
  check(() => assert.notEqual(h.catalog.status, 'loading'));
}

{
  const h = fixture();
  const pending = h.catalog.load();
  h.current.token = '';
  const unauthenticated = await h.catalog.load();
  check(() => assert.equal(unauthenticated, false));
  check(() => assert.equal(h.requests.length, 1));
  check(() => assert.equal(h.requests[0].options.signal.aborted, true));
  h.respond(0, [workspace('expired-token-response')]);
  const lateResult = await pending;
  check(() => assert.equal(lateResult, false));
  check(() => assert.equal(h.catalog.items, null));
  check(() => assert.equal(h.accepted.length, 0));
  check(() => assert.notEqual(h.catalog.status, 'loading'));
}

{
  const h = fixture();
  const pending = h.catalog.load();
  h.current.token = 'replacement-fixture-token';
  h.respond(0, [workspace('previous-token-response')]);
  const lateResult = await pending;
  check(() => assert.equal(lateResult, false));
  check(() => assert.equal(h.catalog.items, null));
  check(() => assert.equal(h.accepted.length, 0));
  check(() => assert.notEqual(h.catalog.status, 'loading'));
  const fresh = h.catalog.load(); h.respond(1, [workspace('replacement-token-response')]);
  const freshResult = await fresh;
  check(() => assert.equal(freshResult, true));
  check(() => assert.deepEqual(h.catalog.items.map(item => item.tenantId), ['replacement-token-response']));
}

console.log(`Workspace catalog: ${checks} checks passed (accepted access, failed refresh, supersession, logout, account/token replacement and tenant changes; mocked network only).`);
