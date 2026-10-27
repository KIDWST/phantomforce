import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// This owns a disposable browser and a loopback-only catalog fixture. No real
// accounts, organizations, user profiles, services or credentials are touched.
const root = fileURLToPath(new URL('../', import.meta.url));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const runDir = path.join(root, 'tmp', 'workspace-directory', stamp);
const chromePath = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find(existsSync);
assert.ok(chromePath, 'Chrome is required for workspace-directory browser QA');
mkdirSync(runDir, { recursive: true });
const primary = [
  { id: 'phantomforce-internal', businessId: 'phantomforce', name: 'PhantomForce' },
  { id: 'client-chicagoshots', businessId: 'client-chicagoshots', name: 'ChicagoShots' },
  { id: 'occasionally-odd', businessId: 'occasionally-odd', name: 'Occasionally Odd' },
];
const duplicates = [
  { id: 'customer-one-a', businessId: null, name: 'Customer 1' },
  { id: 'customer-one-b', businessId: null, name: 'Customer 1' },
];
const catalog = [
  ...primary,
  { id: 'sports-demo', businessId: null, name: 'Sports Demo' },
  { id: 'qa-recovery-dev', businessId: null, name: 'QA recovery dev' },
  ...duplicates,
  ...Array.from({ length: 9 }, (_, index) => ({ id: `archive-workspace-${index + 1}`, businessId: null, name: `Archived planning ${index + 1}` })),
];
assert.equal(catalog.length, 16);
let activeOrg = primary[0].id, customer = false;
const requests = [], results = [];
const available = () => customer ? duplicates : catalog;
const serverSession = () => ({ id: customer ? 'directory-customer-fixture' : 'directory-owner-fixture', label: customer ? 'Customer fixture' : 'Owner fixture', orgId: activeOrg, orgRole: customer ? 'member' : 'owner', isSuperAdmin: !customer, canManageAccess: !customer, memberships: available().map(item => ({ orgId: item.id, orgName: item.name, role: customer ? 'member' : 'owner' })) });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const freePort = () => new Promise((resolve, reject) => { const server = net.createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); }); });
async function ready(url) { for (let index = 0; index < 100; index++) { try { if ((await fetch(url)).ok) return; } catch {} await sleep(100); } throw new Error(`Fixture did not become ready: ${url}`); }
function connect(url) {
  const socket = new WebSocket(url), pending = new Map(), errors = [];
  let sequence = 0;
  const open = new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    const task = pending.get(message.id); if (!task) return;
    pending.delete(message.id); clearTimeout(task.timer);
    if (message.error) task.reject(new Error(message.error.message)); else task.resolve(message.result);
  });
  return { errors, close: () => socket.close(), async send(method, params = {}) { await open; const id = ++sequence; return new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Browser call timed out: ${method}`)); }, 20000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })); }); } };
}
async function evaluate(cdp, expression) { const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result?.value; }
async function waitFor(cdp, expression, label) { let last; for (let index = 0; index < 150; index++) { try { if (await evaluate(cdp, expression)) return; } catch (error) { last = error; } await sleep(100); } throw new Error(`${label}${last ? ': ' + last.message : ''}`); }
async function stop(child) { if (!child || child.exitCode !== null) return; child.kill(); await Promise.race([new Promise(resolve => child.once('exit', resolve)), sleep(1500)]); }
const coreExpression = `import('/app/js/store.js?v='+window.PHANTOM_BUILD)`;
const staticPort = await freePort(), debugPort = await freePort(), base = `http://127.0.0.1:${staticPort}`;
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, base).pathname;
  const json = (status, value) => { response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(value)); };
  if (pathname === '/health') return json(200, { ok: true });
  if (!pathname.startsWith('/app/')) {
    const record = { path: pathname, method: request.method, business: request.headers['x-phantomforce-business'] || null, tenant: new URL(request.url, base).searchParams.get('tenant_id') };
    requests.push(record);
    if (request.method === 'GET' && pathname === '/session') return json(200, { ok: true, session: serverSession() });
    if (request.method === 'GET' && pathname === '/api/business-workspaces') return json(200, { workspaces: available().map(item => ({ ...item, tenantId: item.id, role: customer ? 'member' : 'owner' })) });
    if (request.method === 'POST' && pathname === '/auth/switch-org') {
      let raw = ''; for await (const chunk of request) raw += chunk;
      const { orgId } = JSON.parse(raw || '{}'); record.orgId = orgId;
      if (!available().some(item => item.id === orgId)) return json(403, { ok: false, error: 'not_a_member' });
      activeOrg = orgId; return json(200, { ok: true, session: serverSession() });
    }
    return json(503, { ok: false, error: 'isolated_test_api_disabled' });
  }
  const target = path.resolve(root, `.${decodeURIComponent(pathname)}`);
  if (!target.startsWith(path.resolve(root, 'app') + path.sep)) { response.writeHead(403); response.end(); return; }
  try { if (!statSync(target).isFile()) throw new Error('Not a file'); const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.woff2': 'font/woff2' }[path.extname(target)] || 'application/octet-stream'; response.writeHead(200, { 'content-type': mime, 'cache-control': 'no-store' }); response.end(readFileSync(target)); } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(staticPort, '127.0.0.1', resolve));
let chrome, cdp;
const quickOptions = () => evaluate(cdp, `[...document.querySelector('[data-business-select]').options].map(option=>option.value).filter(value=>value!=='__workspace_access__')`);
const cards = selector => evaluate(cdp, `[...document.querySelectorAll(${JSON.stringify(selector)})].map(node=>({id:node.dataset.accessWorkspace,text:node.textContent.trim()}))`);
async function openAccess() { await evaluate(cdp, `document.querySelector('[data-workspace-access]').click()`); await waitFor(cdp, `document.querySelector('.workspace-access-dialog[open] [data-workspace-primary]')`, 'Workspace account panel did not open'); }
async function search(value) { await evaluate(cdp, `(function(){const input=document.querySelector('[data-access-search]');input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input',{bubbles:true}))})()`); }
async function switchFromPicker(id) { const before = await evaluate(cdp, 'performance.timeOrigin'); await evaluate(cdp, `const select=document.querySelector('[data-business-select]');select.value=${JSON.stringify(id)};select.dispatchEvent(new Event('change',{bubbles:true}));`); await waitFor(cdp, `performance.timeOrigin!==${before} && document.querySelector('[data-business-select]')?.value===${JSON.stringify(id)}`, 'Exact organization selection did not persist through the document switch'); }
async function screenshot(name) { const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); const target = path.join(runDir, name); writeFileSync(target, Buffer.from(shot.data, 'base64')); return target; }
try {
  chrome = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${debugPort}`, '--remote-allow-origins=*', `--user-data-dir=${path.join(os.tmpdir(), `phantomforce-workspace-directory-${process.pid}-${stamp}`)}`, '--disable-gpu', '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--no-first-run', '--no-default-browser-check', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  await ready(`http://127.0.0.1:${debugPort}/json/version`);
  const target = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' }).then(response => response.json());
  cdp = connect(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable');
  await cdp.send('Network.setBlockedURLs', { urls: ['https://*'] });
  await cdp.send('Page.navigate', { url: `${base}/app/index.html?session=admin` });
  await waitFor(cdp, `document.querySelector('[data-business-select]')`, 'Fixture bootstrap did not render');
  await evaluate(cdp, `(async()=>{const c=await ${coreExpression};c.session.set(c.databaseSessionFromLogin({session:${JSON.stringify(serverSession())},token:'workspace-directory-fixture-token'}));return true})()`);
  await cdp.send('Page.navigate', { url: `${base}/app/index.html` });
  await waitFor(cdp, `document.querySelector('[data-business-select]')?.value==='phantomforce-internal'`, 'Verified owner catalog did not load');
  for (const width of [1440, 390]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: width === 390 ? 844 : 1000, deviceScaleFactor: 1, mobile: width === 390 });
    await waitFor(cdp, `document.querySelector('[data-business-select]')?.options.length===4`, 'Everyday owner picker should contain only three businesses plus account options');
    assert.deepEqual((await quickOptions()).sort(), primary.map(item => item.id).sort(), 'The sixteen-row owner catalog cannot flood the everyday picker');
    await evaluate(cdp, `document.querySelector('[data-os-menu-btn]').click();const developer=document.querySelector('[data-os-menu-nav="developer"]');developer.scrollIntoView({block:'center',behavior:'instant'});developer.click()`);
    await waitFor(cdp, `document.querySelector('[data-workspace-page="developer"] [data-production-core-panel]')?.textContent.includes('unavailable')`, 'The real Developer route must retain Production Core with truthful unavailable status');
    assert.ok(await evaluate(cdp, `document.querySelector('[data-production-core-panel]').textContent.includes('Production Core')`), 'Production Core cannot disappear when provider reads fail');
    const coreReads = requests.filter(item => ['/api/production-core/graph', '/api/production-core/truth'].includes(item.path));
    assert.ok(coreReads.length >= 2, 'Production Core must actually read graph and truth rather than display a static placeholder');
    for (const item of coreReads) { assert.equal(item.method, 'GET'); assert.equal(item.tenant, primary[0].id); assert.equal(item.business, primary[0].id); }
    await evaluate(cdp, `document.querySelector('[data-os-menu-btn]').click();document.querySelector('[data-os-menu-nav="dashboard"]').click()`);
    await waitFor(cdp, `document.querySelector('[data-console]')?.dataset.consoleView==='dashboard'`, 'Developer inspection must return to the full owner console');
    await openAccess();
    assert.deepEqual((await cards('[data-workspace-primary] [data-access-workspace]')).map(item => item.id).sort(), primary.map(item => item.id).sort());
    assert.equal(await evaluate(cdp, `document.querySelector('[data-access-directory]').open`), false, 'Other workspaces start collapsed');
    await evaluate(cdp, `document.querySelector('[data-access-directory] summary').click()`);
    await waitFor(cdp, `document.querySelector('[data-access-directory]').open`, 'Other workspaces directory did not expand');
    const initialRows = await cards('[data-workspace-directory-results] [data-access-workspace]');
    assert.deepEqual(initialRows.map(item => item.id).sort(), catalog.filter(item => !primary.some(core => core.id === item.id)).map(item => item.id).sort(), 'All thirteen additional rows remain accessible');
    assert.equal(new Set(initialRows.map(item => item.id)).size, 13, 'Same-named workspaces cannot be merged');
    await search('no-such-workspace');
    await waitFor(cdp, `document.querySelectorAll('[data-workspace-directory-results] [data-access-workspace]').length===0`, 'An unmatched search must not leave stale workspace actions');
    assert.ok(await evaluate(cdp, `document.querySelector('[data-workspace-directory-results]').textContent.includes('No matching')`), 'An empty search result needs a clear state');
    await search('customer');
    await waitFor(cdp, `document.querySelectorAll('[data-workspace-directory-results] [data-access-workspace]').length===2`, 'Directory name search must preserve both Customer 1 rows');
    const customerRows = await cards('[data-workspace-directory-results] [data-access-workspace]');
    assert.deepEqual(customerRows.map(item => item.id).sort(), duplicates.map(item => item.id).sort());
    assert.equal(new Set(customerRows.map(item => item.text)).size, 2, 'Duplicate names need distinct visible identity hints');
    await search('customer-one-b');
    await waitFor(cdp, `document.querySelectorAll('[data-workspace-directory-results] [data-access-workspace]').length===1`, 'Exact ID search must find the intended duplicate');
    assert.equal((await cards('[data-workspace-directory-results] [data-access-workspace]'))[0].id, duplicates[1].id);
    assert.ok(await evaluate(cdp, `document.documentElement.scrollWidth<=innerWidth+2`), `${width}px directory cannot overflow the page`);
    const preview = await screenshot(`owner-directory-${width}.png`);
    const before = await evaluate(cdp, 'performance.timeOrigin');
    await evaluate(cdp, `document.querySelector('[data-workspace-directory-results] [data-access-workspace="customer-one-b"]').scrollIntoView({block:'center',behavior:'instant'})`);
    assert.ok(await evaluate(cdp, `(function(){const r=document.querySelector('[data-workspace-directory-results] [data-access-workspace="customer-one-b"]').getBoundingClientRect();const dialog=document.querySelector('.workspace-access-dialog').getBoundingClientRect();return r.width>0 && r.height>0 && r.top>=Math.max(0,dialog.top) && r.bottom<=Math.min(innerHeight,dialog.bottom)})()`), 'The selected duplicate must be reachable by scrolling the visible directory');
    const selectedPreview = await screenshot(`owner-result-${width}.png`);
    await evaluate(cdp, `document.querySelector('[data-workspace-directory-results] [data-access-workspace="customer-one-b"]').click()`);
    await waitFor(cdp, `performance.timeOrigin!==${before} && document.querySelector('[data-business-select]')?.value==='customer-one-b'`, 'Directory switch must use the exact selected duplicate ID');
    assert.deepEqual((await quickOptions()).sort(), [...primary.map(item => item.id), 'customer-one-b'].sort(), 'An active additional workspace stays visible without exposing the other twelve');
    assert.equal(requests.filter(item => item.path === '/auth/switch-org').at(-1).orgId, 'customer-one-b');
    await openAccess();
    assert.ok((await cards('[data-workspace-primary] [data-access-workspace]')).some(item => item.id === 'customer-one-b'), 'Current additional workspace must remain easy to leave');
    await evaluate(cdp, `document.querySelector('[data-access-directory] summary').click()`);
    const preservedIds = [...await cards('[data-workspace-primary] [data-access-workspace]'), ...await cards('[data-workspace-directory-results] [data-access-workspace]')].map(item => item.id);
    assert.deepEqual(preservedIds.sort(), catalog.map(item => item.id).sort(), 'Choosing a workspace cannot erase or duplicate catalog records');
    await evaluate(cdp, `document.querySelector('[data-access-close]').click()`);
    await switchFromPicker(primary[0].id);
    results.push({ width, quick: primary.map(item => item.id), totalPreserved: preservedIds.length, screenshot: preview, selectedScreenshot: selectedPreview });
    console.log(`PASS ${width}px: core-three picker, searchable sixteen-row catalog, distinct duplicate IDs and exact scope switching`);
  }
  customer = true; activeOrg = duplicates[0].id;
  await evaluate(cdp, `(async()=>{const c=await ${coreExpression};c.session.set(c.databaseSessionFromLogin({session:${JSON.stringify(serverSession())},token:'workspace-directory-fixture-token'}));return true})()`);
  await cdp.send('Page.navigate', { url: `${base}/app/index.html` });
  await waitFor(cdp, `document.querySelector('[data-business-select]')?.value==='customer-one-a'`, 'Customer fixture did not restore');
  assert.deepEqual((await quickOptions()).sort(), duplicates.map(item => item.id).sort(), 'Customer memberships are not subject to owner shortcuts');
  await openAccess();
  assert.deepEqual((await cards('[data-access-workspace]')).map(item => item.id).sort(), duplicates.map(item => item.id).sort(), 'Customer cards remain exactly their authorized catalog');
  await evaluate(cdp, `document.querySelector('[data-access-close]').click()`);
  await switchFromPicker(duplicates[1].id);
  assert.equal(await evaluate(cdp, `(async()=>{const c=await ${coreExpression};return c.isOwnerOperator()})()`), false, 'Duplicate names cannot grant platform authority');
  assert.ok(requests.filter(item => !['GET', 'HEAD'].includes(item.method)).every(item => item.method === 'POST' && item.path === '/auth/switch-org'), 'Directory presentation cannot mutate memberships or records');
  assert.equal(catalog.length, 16, 'The fixture retains all original organization rows');
  assert.deepEqual(cdp.errors, [], 'Uncaught browser errors');
  const report = { ok: true, ownerCases: results.length, customerCatalogUnchanged: true, duplicateIdsPreserved: true, productionCoreRetainedInDeveloper: true, results, requests };
  writeFileSync(path.join(runDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: true, report: path.join(runDir, 'report.json') }));
} catch (error) { console.error(error.stack); process.exitCode = 1; }
finally { cdp?.close(); await stop(chrome); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
