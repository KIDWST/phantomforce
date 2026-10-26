import assert from 'node:assert/strict';
import { bindWorkspaceRoutes } from '../app/js/workspace-continuity.js';

// The actual route observer runs against deterministic history/events/timers.
// No browser, DOM, credentials, network requests or wall-clock sleeps are used.
function harness({ asyncRoutes = false, normalizeLegacy = false } = {}) {
  const listeners = new Map(), timers = new Map(), calls = [], jobs = [];
  let timerId = 0, rendered = '', revision = 0, active = null, cancelled = 0;
  const host = {
    location: { hash: '' },
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    setInterval(fn) { const id = ++timerId; timers.set(id, fn); return id; },
    clearInterval(id) { timers.delete(id); },
  };
  const schedule = (target, hash) => {
    const started = ++revision;
    const job = { target, finish() {
      // Mirrors the app's transition version check: cancelled source work may
      // finish later, but it must never replace the newer visible route.
      if (started !== revision) return false;
      rendered = target; active = null;
      if (hash !== undefined) host.location.hash = hash;
      return true;
    } };
    jobs.push(job); active = job; return job;
  };
  const navigate = (kind, id) => {
    calls.push(`${kind}/${id}`);
    const target = kind === 'ws' && normalizeLegacy ? `page/${id}` : `${kind}/${id}`;
    if (asyncRoutes) schedule(target);
    else { revision++; active = null; rendered = target; }
  };
  const dispose = bindWorkspaceRoutes({
    host,
    getRenderedRoute: () => rendered,
    isTransitioning: () => active !== null,
    cancelTransition() { if (active) { cancelled++; revision++; active = null; } },
    page: id => navigate('page', id),
    overlay: id => navigate('ws', id),
    home() { calls.push('home'); revision++; active = null; rendered = ''; },
  });
  return {
    host, calls, jobs, dispose,
    get rendered() { return rendered; },
    get busy() { return active !== null; },
    get cancelled() { return cancelled; },
    get listenerCount() { return [...listeners.values()].reduce((total, set) => total + set.size, 0); },
    get timerCount() { return timers.size; },
    internal(target, hash) { revision++; active = null; rendered = target; host.location.hash = hash; },
    beginInternal(target, hash, { earlyHash = false } = {}) {
      if (earlyHash) host.location.hash = hash;
      return schedule(target, hash);
    },
    event(type, hash = host.location.hash) {
      host.location.hash = hash;
      for (const fn of [...(listeners.get(type) || [])]) fn({ type });
    },
    tick() { for (const fn of [...timers.values()]) fn(); },
  };
}

let passed = 0;
function test(name, check) { check(); passed++; console.log(`PASS ${name}`); }

test('an internal page mount is acknowledged without another render', () => {
  const h = harness(); h.internal('page/business-projects', '#page/business-projects');
  h.tick(); h.tick(); h.event('hashchange'); h.event('popstate');
  assert.equal(h.rendered, 'page/business-projects'); assert.deepEqual(h.calls, []); h.dispose();
});

test('duplicate events and probes produce one pending async transition', () => {
  const h = harness({ asyncRoutes: true });
  h.event('popstate', '#page/business-projects'); h.event('hashchange'); h.tick(); h.tick();
  assert.deepEqual(h.calls, ['page/business-projects']); assert.equal(h.jobs.length, 1);
  h.jobs[0].finish(); h.tick(); h.event('hashchange'); h.event('popstate'); h.tick();
  assert.equal(h.rendered, 'page/business-projects'); assert.deepEqual(h.calls, ['page/business-projects']); h.dispose();
});

for (const probeHome of [true, false]) test(`internal Home then Back ${probeHome ? 'after' : 'before'} the blank-hash probe`, () => {
  const h = harness(); h.internal('page/business-projects', '#page/business-projects'); h.tick();
  h.internal('', ''); if (probeHome) h.tick();
  h.event('popstate', '#page/business-projects'); h.event('hashchange'); h.tick();
  assert.equal(h.rendered, 'page/business-projects'); assert.deepEqual(h.calls, ['page/business-projects']); h.dispose();
});

test('page-to-page Back and Forward render each destination once', () => {
  const h = harness(); h.internal('page/business-projects', '#page/business-projects'); h.tick();
  h.internal('page/business-assets', '#page/business-assets'); h.tick();
  h.event('popstate', '#page/business-projects'); h.event('hashchange'); h.tick();
  assert.equal(h.rendered, 'page/business-projects');
  h.event('popstate', '#page/business-assets'); h.event('hashchange'); h.tick();
  assert.equal(h.rendered, 'page/business-assets');
  assert.deepEqual(h.calls, ['page/business-projects', 'page/business-assets']); h.dispose();
});

test('rapid page-to-page Back works before the new internal page was probed', () => {
  const h = harness(); h.internal('page/business-projects', '#page/business-projects'); h.tick();
  h.internal('page/business-assets', '#page/business-assets');
  h.event('popstate', '#page/business-projects'); h.event('hashchange');
  assert.equal(h.rendered, 'page/business-projects'); assert.deepEqual(h.calls, ['page/business-projects']); h.dispose();
});

test('empty-hash history navigation opens Home once', () => {
  const h = harness(); h.internal('page/business-projects', '#page/business-projects'); h.tick();
  h.event('popstate', ''); h.event('hashchange'); h.tick();
  assert.equal(h.rendered, ''); assert.deepEqual(h.calls, ['home']); h.dispose();
});

test('a query-based initial page without a hash is not forced Home by probing', () => {
  const h = harness(); h.internal('page/business-projects', ''); h.tick(); h.tick();
  assert.equal(h.rendered, 'page/business-projects'); assert.deepEqual(h.calls, []); h.dispose();
});

for (const asyncRoutes of [false, true]) test(`legacy #ws normalization remains stable ${asyncRoutes ? 'after async loading' : 'after synchronous loading'}`, () => {
  const h = harness({ asyncRoutes, normalizeLegacy: true });
  h.event('popstate', '#ws/business-projects'); h.event('hashchange');
  if (asyncRoutes) { h.tick(); assert.equal(h.calls.length, 1); h.jobs[0].finish(); }
  h.tick(); h.tick(); h.event('popstate'); h.event('hashchange'); h.tick();
  assert.equal(h.rendered, 'page/business-projects'); assert.deepEqual(h.calls, ['ws/business-projects']); h.dispose();
});

test('a probe does not duplicate an internal transition whose hash was written early', () => {
  const h = harness(); h.internal('page/business-projects', '#page/business-projects'); h.tick();
  const internal = h.beginInternal('page/business-assets', '#page/business-assets', { earlyHash: true });
  h.tick(); h.tick(); assert.deepEqual(h.calls, []); assert.equal(h.busy, true);
  internal.finish(); h.tick(); h.tick();
  assert.equal(h.rendered, 'page/business-assets'); assert.deepEqual(h.calls, []); h.dispose();
});

test('slow Back then fast Forward cancels the obsolete transition before it can mount', () => {
  const h = harness({ asyncRoutes: true }); h.internal('page/business-assets', '#page/business-assets'); h.tick();
  h.event('popstate', '#page/business-projects');
  assert.equal(h.jobs.length, 1); const obsolete = h.jobs[0]; assert.equal(h.busy, true);
  h.event('popstate', '#page/business-assets'); h.event('hashchange');
  assert.equal(h.cancelled, 1); assert.equal(h.busy, false);
  assert.equal(obsolete.finish(), false, 'A cancelled route must not overwrite the page returned to by Forward.');
  assert.equal(h.rendered, 'page/business-assets'); assert.equal(h.host.location.hash, '#page/business-assets');
  h.tick(); assert.deepEqual(h.calls, ['page/business-projects']); h.dispose();
});

test('an event-driven destination can supersede an internal transition', () => {
  const h = harness(); h.internal('page/business-projects', '#page/business-projects'); h.tick();
  const obsolete = h.beginInternal('page/business-assets', '#page/business-assets');
  h.event('popstate', '#page/business-production');
  assert.equal(h.rendered, 'page/business-production');
  assert.equal(obsolete.finish(), false); assert.deepEqual(h.calls, ['page/business-production']); h.dispose();
});

test('disposing the route observer removes its event listeners and timer', () => {
  const h = harness(); assert.equal(h.listenerCount, 2); assert.equal(h.timerCount, 1);
  h.dispose(); assert.equal(h.listenerCount, 0); assert.equal(h.timerCount, 0);
  h.event('popstate', '#page/business-projects'); h.tick(); assert.deepEqual(h.calls, []);
});

console.log(`Workspace route continuity: ${passed} deterministic checks passed.`);
