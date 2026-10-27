import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// All identities and responses belong to this disposable fixture. The browser
// cannot reach production APIs, read user profiles, or execute owner commands.
const root = fileURLToPath(new URL('../', import.meta.url));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const runDir = path.join(root, 'tmp', 'owner-console', stamp);
const chromePath = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find(existsSync);
assert.ok(chromePath, 'Chrome is required for owner-console browser QA');
mkdirSync(runDir, { recursive: true });
const businesses = [
  { id: 'phantomforce-internal', businessId: 'phantomforce', name: 'PhantomForce' },
  { id: 'client-chicagoshots', businessId: 'client-chicagoshots', name: 'ChicagoShots' },
  { id: 'occasionally-odd', businessId: 'occasionally-odd', name: 'Occasionally Odd' },
];
let activeOrg = businesses[0].id;
let customer = false;
let catalogReady = false;
const requests = [];
const ownerSession = () => ({ id: 'qa-owner', label: 'Owner fixture', orgId: activeOrg, orgRole: 'owner', isSuperAdmin: true, canManageAccess: true, memberships: businesses.map(b => ({ orgId: b.id, orgName: b.name, role: 'owner' })) });
const customerSession = () => ({ id: 'qa-customer', label: 'Customer fixture', orgId: 'occasionally-odd', orgRole: 'member', isSuperAdmin: false, canManageAccess: false, memberships: [{ orgId: 'occasionally-odd', orgName: 'Occasionally Odd', role: 'member' }] });
const serverSession = () => customer ? customerSession() : ownerSession();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const freePort = () => new Promise((resolve, reject) => { const server = net.createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); }); });
async function ready(url) {
  for (let i = 0; i < 100; i++) { try { const r = await fetch(url); if (r.ok) return; } catch {} await sleep(100); }
  throw new Error(`Fixture service did not become ready: ${url}`);
}
function connect(url) {
  const socket = new WebSocket(url), pending = new Map(), errors = [];
  let sequence = 0;
  const open = new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', e => {
    const message = JSON.parse(String(e.data));
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    const task = pending.get(message.id);
    if (!task) return;
    pending.delete(message.id); clearTimeout(task.timer);
    if (message.error) task.reject(new Error(message.error.message)); else task.resolve(message.result);
  });
  return { errors, close: () => socket.close(), async send(method, params = {}) { await open; const id = ++sequence; return new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Browser call timed out: ${method}`)); }, 20000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })); }); } };
}
async function evaluate(cdp, expression) { const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result?.value; }
async function waitFor(cdp, expression, message) { let last; for (let i = 0; i < 120; i++) { try { if (await evaluate(cdp, expression)) return; } catch (error) { last = error; } await sleep(100); } throw new Error(`${message}${last ? ': ' + last.message : ''}`); }
async function stop(child) { if (!child || child.exitCode !== null) return; child.kill(); await Promise.race([new Promise(resolve => child.once('exit', resolve)), sleep(1500)]); }
const coreExpression = `import('/app/js/store.js?v='+window.PHANTOM_BUILD)`;
const staticPort = await freePort(), debugPort = await freePort(), base = `http://127.0.0.1:${staticPort}`;
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, base).pathname;
  const json = (status, value) => { response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(value)); };
  if (pathname === '/health') return json(200, { ok: true });
  if (!pathname.startsWith('/app/')) {
    requests.push({ path: pathname, method: request.method, business: request.headers['x-phantomforce-business'] || null });
    if (request.method === 'GET' && pathname === '/session') return json(200, { ok: true, session: serverSession() });
    if (request.method === 'GET' && pathname === '/api/business-workspaces') return catalogReady ? json(200, { workspaces: businesses.filter(b => !customer || b.id === 'occasionally-odd').map(b => ({ ...b, tenantId: b.id, role: customer ? 'member' : 'owner' })) }) : json(503, { error: 'fixture_catalog_unavailable' });
    if (request.method === 'POST' && pathname === '/auth/switch-org' && !customer) {
      let body = ''; for await (const chunk of request) body += chunk;
      const orgId = JSON.parse(body).orgId;
      if (!businesses.some(b => b.id === orgId)) return json(403, { error: 'fixture_not_a_member' });
      activeOrg = orgId; return json(200, { ok: true, session: ownerSession() });
    }
    return json(503, { ok: false, error: 'isolated_test_api_disabled' });
  }
  const target = path.resolve(root, `.${decodeURIComponent(pathname)}`);
  if (!target.startsWith(path.resolve(root, 'app') + path.sep)) { response.writeHead(403); response.end(); return; }
  try {
    if (!statSync(target).isFile()) throw new Error('Not a file');
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.woff2': 'font/woff2' }[path.extname(target)] || 'application/octet-stream';
    response.writeHead(200, { 'content-type': mime, 'cache-control': 'no-store' }); response.end(readFileSync(target));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(staticPort, '127.0.0.1', resolve));
let chrome, cdp;
const results = [];
try {
  chrome = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${debugPort}`, '--remote-allow-origins=*', `--user-data-dir=${path.join(os.tmpdir(), `phantomforce-owner-console-${process.pid}-${stamp}`)}`, '--disable-gpu', '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--no-first-run', '--no-default-browser-check', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  await ready(`http://127.0.0.1:${debugPort}/json/version`);
  const target = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' }).then(r => r.json());
  cdp = connect(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable');
  await cdp.send('Network.setBlockedURLs', { urls: ['https://*'] });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `${base}/app/index.html?session=admin` });
  await waitFor(cdp, `document.querySelector('[data-business-select]')`, 'Fixture bootstrap did not render');
  await evaluate(cdp, `(async()=>{const c=await ${coreExpression};c.session.set(c.databaseSessionFromLogin({session:${JSON.stringify(ownerSession())},token:'owner-console-fixture-token'}));return true})()`);
  await cdp.send('Page.navigate', { url: `${base}/app/index.html` });
  await waitFor(cdp, `document.querySelector('[data-business-select]')?.value==='phantomforce-internal' && document.querySelector('[data-console]')?.dataset.consoleView==='dashboard'`, 'Preserved internal organization must open original owner dashboard before catalog is available');
  assert.equal(await evaluate(cdp, `(async()=>{const c=await ${coreExpression};return c.currentTenantId()})()`), 'phantomforce-internal', 'Presentation must preserve exact organization identity');
  assert.ok(await evaluate(cdp, `Boolean(document.querySelector('[data-workforce-heartbeat]') && document.querySelector('.dashboard-assistant [data-open-ws="phantomai"]'))`), 'Original dashboard heartbeat and PhantomBot launcher missing');
  assert.ok(requests.some(r => r.path === '/api/business-workspaces'), 'Unavailable catalog fixture must actually be exercised');
  console.log('PASS exact internal organization: original owner dashboard and PhantomBot launcher survive unavailable catalog');

  catalogReady = true;
  const privateAgents = businesses.flatMap(business => [0, 1].map(index => ({ id: `colliding-agent-${index}`, ws: business.id, name: `PRIVATE-AGENT-${business.id}-${index}`, mission: `PRIVATE-MISSION-${business.id}-${index}`, status: index ? 'waiting' : 'active' })));
  privateAgents.push({ id: 'unassigned-agent', name: 'PRIVATE-UNASSIGNED-AGENT', mission: 'PRIVATE-UNASSIGNED-MISSION', status: 'active' });
  const privateSecurity = businesses.map(business => ({ id: 'colliding-security', ws: business.id, posture: business.id === 'client-chicagoshots' ? 'blocked' : 'clean' }));
  privateSecurity.push({ id: 'unassigned-security', posture: 'blocked' });
  await evaluate(cdp, `(async()=>{const c=await ${coreExpression};c.store.state.agents=${JSON.stringify(privateAgents)};c.store.state.security=${JSON.stringify(privateSecurity)};c.store.save({notify:false});return true})()`);
  await cdp.send('Page.reload', { ignoreCache: true });
  await waitFor(cdp, `document.querySelector('[data-business-select]')?.options.length>=3 && document.querySelector('[data-console]')?.dataset.consoleView==='dashboard'`, 'Ready owner catalog did not render');
  const required = ['dashboard', 'adminos', 'developer', 'runtime', 'workers', 'audit', 'planner', 'vacation', 'phantomplay', 'phantomstore', 'promptlibrary', 'business-overview', 'business-templates', 'business-assets', 'business-channels'];
  const routes = [{ menu: 'adminos', route: 'adminos' }, { menu: 'developer', route: 'developer' }, { menu: 'runtime', route: 'runtime' }, { menu: 'phantomplay', route: 'phantomplay' }, { menu: 'phantomstore', route: 'phantomstore' }, { menu: 'workers', route: 'workforce' }, { menu: 'promptlibrary', route: 'promptlibrary' }];
  for (const width of [1440, 390]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: width === 390 ? 844 : 1000, deviceScaleFactor: 1, mobile: width === 390 });
    for (const business of businesses) {
      const oldTime = await evaluate(cdp, 'performance.timeOrigin');
      const oldOrg = await evaluate(cdp, `(async()=>{const c=await ${coreExpression};return c.currentTenantId()})()`);
      if (oldOrg !== business.id) {
        await evaluate(cdp, `const select=document.querySelector('[data-business-select]');select.value=${JSON.stringify(business.id)};select.dispatchEvent(new Event('change',{bubbles:true}));`);
        await waitFor(cdp, `performance.timeOrigin!==${oldTime} && document.querySelector('[data-business-select]')?.value===${JSON.stringify(business.id)}`, 'Business switch did not complete');
      } else {
        await evaluate(cdp, `location.hash='#page/dashboard'`);
      }
      await waitFor(cdp, `document.querySelector('[data-console]')?.dataset.consoleView==='dashboard'`, `${business.name}: owner home became generic business dashboard`);
      assert.ok(await evaluate(cdp, `Boolean(document.querySelector('[data-workforce-heartbeat]') && document.querySelector('.dashboard-assistant [data-open-ws="phantomai"]'))`), `${business.name}: original heartbeat and PhantomBot launcher missing`);
      // The current dashboard omits the legacy widget host. Mount a hidden
      // fixture host briefly and invoke the real store-change rendering path.
      const scopedDashboard = await evaluate(cdp, `(async()=>{const host=document.createElement('div');host.dataset.dashWidgets='';host.hidden=true;document.body.append(host);const c=await ${coreExpression};c.store.save();const widget=host.querySelector('[data-open-ws="workforce"]');const result={queue:document.querySelector('[data-queue]').textContent,count:document.querySelector('[data-queue-count]').textContent,root:document.querySelector('[data-console]').textContent,widget:widget?.querySelector('.qw-val')?.textContent,status:document.querySelector('[data-account-status]')?.textContent,owner:c.isOwnerOperator()};host.remove();return result})()`);
      assert.equal(scopedDashboard.owner, true, 'Fixture must retain verified owner capability');
      assert.equal(scopedDashboard.count, '2', `${business.name}: work-in-motion count contains foreign or unassigned agents`);
      assert.equal(scopedDashboard.widget, '2', `${business.name}: workforce widget count contains foreign or unassigned agents`);
      for (const index of [0, 1]) {
        assert.ok(scopedDashboard.queue.includes(`PRIVATE-AGENT-${business.id}-${index}`), `${business.name}: own private agent missing`);
        assert.ok(scopedDashboard.queue.includes(`PRIVATE-MISSION-${business.id}-${index}`), `${business.name}: own private mission missing`);
      }
      for (const other of businesses.filter(other => other.id !== business.id)) for (const marker of ['PRIVATE-AGENT-', 'PRIVATE-MISSION-']) assert.ok(!scopedDashboard.root.includes(`${marker}${other.id}`), `${business.name}: restored dashboard leaked ${other.name} private agent details`);
      assert.ok(!scopedDashboard.root.includes('PRIVATE-UNASSIGNED-'), 'Unassigned legacy agents must not leak into selected business dashboard');
      assert.equal(scopedDashboard.status?.trim(), business.id === 'client-chicagoshots' ? 'Attention needed' : 'Systems online', `${business.name}: another business security posture changed account status`);
      await evaluate(cdp, `document.querySelector('[data-os-menu-btn]').click()`);
      await waitFor(cdp, `document.querySelector('[data-os-menu-nav="developer"]')`, 'Full owner menu did not open');
      assert.ok(await evaluate(cdp, `document.querySelector('.os-menu-head').textContent.includes('Platform owner')`), 'Verified owner menu must identify platform owner access');
      const menu = await evaluate(cdp, `[...document.querySelectorAll('[data-os-menu-nav]')].map(n=>({id:n.dataset.osMenuNav,label:n.textContent.trim()}))`);
      for (const id of required) assert.ok(menu.some(n => n.id === id), `${business.name}: restored owner menu missing ${id}`);
      assert.equal(new Set(menu.map(n => n.id)).size, menu.length, 'Restored tools must appear once');
      assert.equal(menu.find(n => n.id === 'dashboard').label, 'Command center');
      if (business.id === 'occasionally-odd') for (const id of ['business-production', 'business-inventory', 'business-products', 'business-orders']) assert.ok(menu.some(n => n.id === id), `Commerce extra missing: ${id}`);
      if (business.id === 'client-chicagoshots') for (const id of ['business-calendar', 'business-deliverables', 'business-gear', 'business-projects']) assert.ok(menu.some(n => n.id === id), `Studio extra missing: ${id}`);
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const screenshot = path.join(runDir, `${business.id}-menu-${width}.png`); writeFileSync(screenshot, Buffer.from(shot.data, 'base64'));
      await evaluate(cdp, `document.querySelector('[data-os-menu-btn]').click()`);
      for (const item of routes) {
        await evaluate(cdp, `document.querySelector('[data-os-menu-btn]').click();document.querySelector('[data-os-menu-nav="${item.menu}"]').scrollIntoView({block:'center',behavior:'instant'})`);
        assert.ok(await evaluate(cdp, `(function(){const r=document.querySelector('[data-os-menu-nav="${item.menu}"]').getBoundingClientRect();const m=document.querySelector('[data-os-menu]').getBoundingClientRect();return r.width>0 && r.height>0 && r.top>=Math.max(0,m.top) && r.bottom<=Math.min(innerHeight,m.bottom)})()`), `${business.name}: restored ${item.menu} is not reachable by scrolling the menu`);
        await evaluate(cdp, `document.querySelector('[data-os-menu-nav="${item.menu}"]').click()`);
        await waitFor(cdp, `document.querySelector('[data-workspace-page="${item.route}"]') && !document.querySelector('[data-workspace-transition]')`, `${business.name}: ${item.menu} menu item did not open real workspace`);
        assert.ok(await evaluate(cdp, `document.querySelector('[data-workspace-page-body]').textContent.trim().length>20`), `${business.name}: ${item.menu} rendered an empty workspace`);
        if (item.route === 'developer') {
          await waitFor(cdp, `document.querySelector('[data-production-core-panel]')?.textContent.includes('Production Core') && document.querySelector('[data-production-core-panel]')?.textContent.includes('unavailable')`, `${business.name}: Production Core diagnostics are orphaned or do not finish their unavailable state`);
          assert.ok(await evaluate(cdp, `document.querySelector('[data-production-core-panel]').textContent.includes('unavailable')`), 'An unavailable fixture API must not be presented as live Production Core');
        }
        assert.equal(await evaluate(cdp, `(async()=>{const c=await ${coreExpression};return c.currentTenantId()})()`), business.id, 'Opening owner tools must not silently switch business');
      }
      await evaluate(cdp, `document.querySelector('[data-os-menu-btn]').click();document.querySelector('[data-os-menu-nav="business-overview"]').scrollIntoView({block:'center',behavior:'instant'});document.querySelector('[data-os-menu-nav="business-overview"]').click()`);
      await waitFor(cdp, `document.querySelector('[data-workspace-page="business-overview"]') && !document.querySelector('[data-workspace-transition]')`, `${business.name}: business overview extra did not open`);
      assert.ok(await evaluate(cdp, `document.querySelector('[data-workspace-page-body]').textContent.trim().length>20`), 'Business overview must retain its focused workspace content');
      await evaluate(cdp, `document.querySelector('[data-os-menu-btn]').click();document.querySelector('[data-os-menu-nav="dashboard"]').click()`);
      await waitFor(cdp, `document.querySelector('[data-console]')?.dataset.consoleView==='dashboard'`, 'Command center menu did not restore original dashboard');
      assert.ok(await evaluate(cdp, `document.documentElement.scrollWidth<=innerWidth+2`), `${business.name}: ${width}px dashboard overflow`);
      results.push({ business: business.id, width, tools: routes.map(r => r.menu), menu: menu.map(n => n.id), scopedAgents: 2, scopedSecurity: scopedDashboard.status.trim(), screenshot });
      console.log(`PASS ${business.name} ${width}px: original owner dashboard, full menu, seven real tool workspaces, Production Core and business extras`);
    }
  }

  customer = true;
  await evaluate(cdp, `(async()=>{const c=await ${coreExpression};c.session.set(c.databaseSessionFromLogin({session:${JSON.stringify(customerSession())},token:'owner-console-fixture-token'}));return true})()`);
  await cdp.send('Page.navigate', { url: `${base}/app/index.html` });
  await waitFor(cdp, `document.querySelector('[data-console]')?.dataset.consoleView==='business-dashboard'`, 'Customer must retain its business dashboard');
  await evaluate(cdp, `document.querySelector('[data-os-menu-btn]').click()`);
  await waitFor(cdp, `document.querySelector('[data-os-menu-nav="business-production"]')`, 'Customer business menu missing');
  const customerMenu = await evaluate(cdp, `[...document.querySelectorAll('[data-os-menu-nav]')].map(n=>n.dataset.osMenuNav)`);
  for (const id of ['developer', 'adminos', 'runtime', 'workers', 'phantomplay', 'phantomstore', 'business-overview']) assert.ok(!customerMenu.includes(id), `Customer gained owner discovery: ${id}`);
  await evaluate(cdp, `document.querySelector('[data-os-menu-btn]').click();location.hash='#page/developer'`);
  await sleep(500);
  assert.equal(await evaluate(cdp, `Boolean(document.querySelector('[data-workspace-page="developer"]'))`), false, 'Customer deep link must not open owner-only developer tool');
  assert.equal(await evaluate(cdp, `(async()=>{const c=await ${coreExpression};return c.currentTenantId()})()`), 'occasionally-odd');
  assert.ok(requests.filter(r => r.method !== 'GET').every(r => r.method === 'POST' && r.path === '/auth/switch-org'), 'Browser QA must not invoke owner commands or other writes');
  assert.deepEqual(cdp.errors, [], 'Uncaught browser errors');
  writeFileSync(path.join(runDir, 'report.json'), JSON.stringify({ ok: true, internalCatalogFailure: true, results, customer: true, requests }, null, 2));
  console.log('PASS customer fixture: business home preserved, no owner tools and owner deep link refused');
  console.log(JSON.stringify({ ok: true, report: path.join(runDir, 'report.json') }));
} catch (error) { console.error(error.stack); process.exitCode = 1; }
finally { cdp?.close(); await stop(chrome); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
