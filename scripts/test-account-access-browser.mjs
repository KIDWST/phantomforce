import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The public-host selector is rebound to app.localhost in the served store
// module only; the gate, auth clients and authority checks remain unchanged.
// This avoids Chrome upgrading the production hostname to HTTPS while every
// request stays inside this disposable loopback fixture. Actual form submission
// and 2FA must establish the tested session; no sessions are pre-seeded.
const root = fileURLToPath(new URL('../', import.meta.url));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const runDir = path.join(root, 'tmp', 'account-access', stamp);
const chromePath = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find(existsSync);
assert.ok(chromePath, 'Chrome is required for account-access browser QA');
mkdirSync(runDir, { recursive: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const freePort = () => new Promise((resolve, reject) => { const server = net.createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); }); });
async function ready(url) { for (let i = 0; i < 100; i++) { try { const r = await fetch(url); if (r.ok) return; } catch {} await sleep(100); } throw new Error(`Fixture service did not become ready: ${url}`); }
function connect(url) {
  const socket = new WebSocket(url), pending = new Map(), errors = [];
  let sequence = 0;
  const open = new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', e => { const message = JSON.parse(String(e.data)); if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text); if (message.method === 'Fetch.requestPaused') { const request = message.params; const allowed = new URL(request.request.url).origin === base; void client.send(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', allowed ? { requestId: request.requestId } : { requestId: request.requestId, errorReason: 'BlockedByClient' }).catch(() => {}); } const task = pending.get(message.id); if (!task) return; pending.delete(message.id); clearTimeout(task.timer); if (message.error) task.reject(new Error(message.error.message)); else task.resolve(message.result); });
  const client = { errors, close: () => socket.close(), async send(method, params = {}) { await open; const id = ++sequence; return new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Browser call timed out: ${method}`)); }, 20000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })); }); } };
  return client;
}
async function evaluate(cdp, expression) { const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result?.value; }
async function waitFor(cdp, expression, message) { let last; for (let i = 0; i < 150; i++) { try { if (await evaluate(cdp, expression)) return; } catch (error) { last = error; } await sleep(100); } throw new Error(`${message}${last ? ': ' + last.message : ''}`); }
async function stop(child) { if (!child || child.exitCode !== null) return; child.kill(); await Promise.race([new Promise(resolve => child.once('exit', resolve)), sleep(1500)]); }
const coreExpression = `import('/app/js/store.js?v='+window.PHANTOM_BUILD)`;
const staticPort = await freePort(), debugPort = await freePort();
const loopback = `http://127.0.0.1:${staticPort}`, base = `http://app.localhost:${staticPort}`;
const requests = [], outcomes = [], tokens = new Map(), challenges = new Map();
let sequence = 0, legacyOnly = false, signupCount = 0, holdLogout = false, authUnavailableOnce = false;
const pendingLogoutReplies = [];
const businesses = [{ id: 'phantomforce-internal', businessId: 'phantomforce', name: 'PhantomForce' }, { id: 'occasionally-odd', businessId: 'occasionally-odd', name: 'Occasionally Odd' }];
const ownerSession = () => ({ id: 'access-owner-fixture', label: 'Owner fixture', orgId: 'phantomforce-internal', orgRole: 'owner', workspaceProfile: 'business', isSuperAdmin: true, canManageAccess: true, memberships: businesses.map(b => ({ orgId: b.id, orgName: b.name, role: 'owner' })) });
const customerSession = () => ({ id: 'access-customer-fixture', label: 'Customer fixture', orgId: 'occasionally-odd', orgRole: 'member', workspaceProfile: 'business', isSuperAdmin: false, canManageAccess: false, memberships: [{ orgId: 'occasionally-odd', orgName: 'Occasionally Odd', role: 'member' }] });
const issue = (kind, legacy = false) => {
  const token = `isolated-access-fixture-${++sequence}`;
  const session = legacy ? { id: 'owner-admin', role: 'admin', label: 'Owner fixture', name: 'Owner fixture', canManageAccess: true } : kind === 'owner' ? ownerSession() : customerSession();
  tokens.set(token, session); return { ok: true, token, session };
};
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, loopback).pathname;
  const json = (status, value) => { response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(value)); };
  if (pathname === '/health') return json(200, { ok: true });
  if (!pathname.startsWith('/app/')) {
    let body = {}; if (!['GET', 'HEAD'].includes(request.method)) { let raw = ''; for await (const chunk of request) raw += chunk; body = JSON.parse(raw || '{}'); }
    // Only record body keys and result classes, never credentials or tokens.
    requests.push({ path: pathname, method: request.method, keys: Object.keys(body).sort() });
    const token = String(request.headers.authorization || '').replace(/^Bearer /, ''), current = tokens.get(token);
    if (request.method === 'GET' && pathname === '/sessions') { if (authUnavailableOnce) { authUnavailableOnce = false; return json(200, { auth: { databaseAuthEnabled: false, databaseReachable: false, customerAuthEnabled: false, ownerProductionAuthEnabled: false }, sessions: [] }); } return json(200, { auth: { databaseAuthEnabled: !legacyOnly, customerAuthEnabled: !legacyOnly, ownerProductionAuthEnabled: legacyOnly, productionReady: true, ownerLoginKeyConfigured: true }, sessions: [] }); }
    if (request.method === 'GET' && pathname === '/session') return current ? json(200, { ok: true, session: current }) : json(401, { ok: false });
    if (request.method === 'POST' && pathname === '/auth/login') {
      if (legacyOnly) return json(503, { error: 'fixture_database_disabled' });
      if (body.password !== 'fixture-password') return json(401, { error: 'invalid_credentials' });
      const kind = String(body.email).startsWith('owner') ? 'owner' : 'customer';
      if (String(body.email).includes('2fa')) { const challengeToken = `isolated-challenge-${++sequence}`; challenges.set(challengeToken, kind); return json(200, { ok: true, requires2fa: true, challengeToken }); }
      return json(200, issue(kind));
    }
    if (request.method === 'POST' && pathname === '/auth/2fa/verify') {
      const kind = challenges.get(body.challengeToken);
      if (!kind || body.code !== '123456') return json(401, { error: 'invalid_2fa_code' });
      challenges.delete(body.challengeToken); return json(200, issue(kind));
    }
    if (request.method === 'POST' && pathname === '/auth/owner-login') {
      if (!legacyOnly || body.email !== 'owner@example.invalid' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email) || body.password !== 'fixture-password') return json(401, { error: 'invalid_owner_credentials' });
      return json(200, issue('owner', true));
    }
    if (request.method === 'POST' && pathname === '/auth/logout') { tokens.delete(token); if (holdLogout) { pendingLogoutReplies.push(() => json(200, { ok: true })); return; } return json(200, { ok: true }); }
    if (request.method === 'POST' && pathname === '/auth/signup') { signupCount++; return json(200, { ok: true, workspaceProfile: { id: 'business' }, userId: 'new-customer-fixture' }); }
    if (request.method === 'GET' && pathname === '/api/business-workspaces') {
      if (!current) return json(401, { error: 'auth_required' });
      const available = current.isSuperAdmin ? businesses : current.id === 'owner-admin' ? [{ id: 'phantomforce', businessId: 'phantomforce', name: 'PhantomForce' }] : businesses.filter(b => b.id === current.orgId);
      return json(200, { workspaces: available.map(b => ({ ...b, tenantId: b.id, role: current.canManageAccess ? 'owner' : 'member' })) });
    }
    return json(503, { ok: false, error: 'isolated_test_api_disabled' });
  }
  const target = path.resolve(root, `.${decodeURIComponent(pathname)}`);
  if (!target.startsWith(path.resolve(root, 'app') + path.sep)) { response.writeHead(403); response.end(); return; }
  try { if (!statSync(target).isFile()) throw new Error('Not a file'); const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.woff2': 'font/woff2' }[path.extname(target)] || 'application/octet-stream'; let content = readFileSync(target); if (pathname === '/app/js/store.js') { const source = content.toString('utf8'); assert.ok(source.includes('CLIENT_PUBLIC_HOST = "app.phantomforce.online"'), 'The sole public-host fixture binding must match the production constant'); content = source.replace('CLIENT_PUBLIC_HOST = "app.phantomforce.online"', 'CLIENT_PUBLIC_HOST = "app.localhost"'); } response.writeHead(200, { 'content-type': mime, 'cache-control': 'no-store' }); response.end(content); } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(staticPort, '127.0.0.1', resolve));
let chrome, cdp;
const gateReady = `!document.querySelector('[data-gate]').hidden && document.querySelector('[data-auth-access="admin"]') && document.querySelector('[data-auth-form="signin"]')`;
async function navigate(suffix = '') { const result = await cdp.send('Page.navigate', { url: `${base}/app/index.html${suffix}` }); assert.ok(!result.errorText, `Loopback public-host fixture navigation failed: ${result.errorText}`); await waitFor(cdp, gateReady, 'The public app must render real customer and admin sign-in'); }
async function selectAccess(kind) { await evaluate(cdp, `document.querySelector('[data-auth-access="${kind}"]').click()`); await waitFor(cdp, `document.querySelector('[data-auth-form="signin"]')`, 'Sign-in form missing after access choice'); }
async function credentials(identifier, password = 'fixture-password') { await evaluate(cdp, `(function(){const f=document.querySelector('[data-auth-form="signin"]');f.elements.identifier.value=${JSON.stringify(identifier)};f.elements.password.value=${JSON.stringify(password)};f.requestSubmit()})()`); }
async function code(value) { await evaluate(cdp, `(function(){const f=document.querySelector('[data-auth-form="2fa"]');f.elements.code.value=${JSON.stringify(value)};f.requestSubmit()})()`); }
async function signedOut() { const before = await evaluate(cdp, 'performance.timeOrigin'); await evaluate(cdp, `document.querySelector('[data-os-menu-btn]').click();document.querySelector('[data-user-menu-action="signout"]').click()`); await waitFor(cdp, `performance.timeOrigin!==${before} && (${gateReady})`, 'Sign out must clear the old document and return to the same app sign-in'); }
async function identity() { return evaluate(cdp, `(async()=>{const c=await ${coreExpression};return {owner:c.isOwnerOperator(),tokenPresent:Boolean(c.session.token()),sessionPresent:Boolean(c.ctx.session),tenant:c.currentTenantId()}})()`); }
async function capture(name) { const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); const target = path.join(runDir, name); writeFileSync(target, Buffer.from(shot.data, 'base64')); return target; }
try {
  chrome = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${debugPort}`, '--remote-allow-origins=*', `--user-data-dir=${path.join(os.tmpdir(), `phantomforce-account-access-${process.pid}-${stamp}`)}`, '--host-resolver-rules=MAP app.localhost 127.0.0.1', '--no-proxy-server', '--disable-gpu', '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--no-first-run', '--no-default-browser-check', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  await ready(`http://127.0.0.1:${debugPort}/json/version`);
  const target = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' }).then(r => r.json());
  cdp = connect(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable'); await cdp.send('Fetch.enable', { patterns: [{ urlPattern: 'http*', requestStage: 'Request' }] });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await navigate();
  assert.equal(await evaluate(cdp, 'location.hostname'), 'app.localhost', 'This must exercise the public-host branch with its sole hostname fixture binding');
  assert.ok(await evaluate(cdp, `Boolean(document.querySelector('[data-auth-access="customer"]'))`));
  assert.equal((await identity()).tokenPresent, false);
  await selectAccess('admin');
  assert.match(await evaluate(cdp, `document.querySelector('.gate-card h1').textContent`), /Admin sign-in/i);
  assert.equal(await evaluate(cdp, `Boolean(document.querySelector('[data-auth-mode="signup"]'))`), false, 'Admin entry cannot advertise self-registration');
  await capture('admin-signin-1440.png');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.ok(await evaluate(cdp, `document.documentElement.scrollWidth<=innerWidth+2`), 'The combined sign-in page must fit a phone');
  await capture('admin-signin-390.png');
  await credentials('owner-fixture', 'incorrect-fixture-password');
  await waitFor(cdp, `!document.querySelector('[data-db-error]').hidden`, 'Rejected credentials must show a useful error');
  assert.equal((await identity()).tokenPresent, false);
  await credentials('owner-2fa');
  await waitFor(cdp, `document.querySelector('[data-auth-form="2fa"]')`, 'Admin password success must require the advertised second factor');
  assert.deepEqual(await identity(), { owner: false, tokenPresent: false, sessionPresent: false, tenant: 'phantomforce' });
  assert.equal(await evaluate(cdp, `document.querySelector('[data-phantom]').hidden`), true, 'No console may open before the second factor');
  await code('000000');
  await waitFor(cdp, `!document.querySelector('[data-db-error]').hidden`, 'Incorrect 2FA must remain at the challenge');
  assert.equal((await identity()).tokenPresent, false);
  await code('123456');
  await waitFor(cdp, `!document.querySelector('[data-phantom]').hidden && document.querySelector('[data-console]')?.dataset.consoleView==='dashboard'`, 'Verified owner must reach the original full console');
  assert.deepEqual(await identity(), { owner: true, tokenPresent: true, sessionPresent: true, tenant: 'phantomforce-internal' });
  await evaluate(cdp, `document.querySelector('[data-os-menu-btn]').click()`);
  assert.ok(await evaluate(cdp, `Boolean(document.querySelector('[data-os-menu-nav="adminos"]') && document.querySelector('[data-os-menu-nav="developer"]'))`), 'Successful admin form must expose the real admin tools');
  await capture('verified-owner-menu-390.png');
  await evaluate(cdp, `document.querySelector('[data-os-menu-btn]').click()`);
  const ownerLogouts = requests.filter(r => r.path === '/auth/logout').length;
  await evaluate(cdp, `document.querySelector('[data-os-menu-btn]').click();document.querySelector('[data-os-menu-nav="runtime"]').click()`);
  await waitFor(cdp, `document.querySelector('[data-workspace-page="runtime"]') && !document.querySelector('[data-workspace-transition]')`, 'Owner runtime tool did not open before entering admin through account access');
  await evaluate(cdp, `document.querySelector('[data-workspace-access]').click()`);
  await waitFor(cdp, `document.querySelector('[data-access-admin]')?.textContent.includes('Open admin console')`, 'Verified owner should receive a direct console entry in account access');
  await evaluate(cdp, `document.querySelector('[data-access-admin]').click()`);
  await waitFor(cdp, `document.querySelector('[data-console]')?.dataset.consoleView==='dashboard'`, 'Owner account access entry must open the full Command center');
  assert.ok(await evaluate(cdp, `Boolean(document.querySelector('[data-workforce-heartbeat]'))`), 'Owner admin entry must mount the original console');
  assert.equal((await identity()).owner, true); assert.equal((await identity()).tokenPresent, true);
  assert.equal(requests.filter(r => r.path === '/auth/logout').length, ownerLogouts, 'A verified owner opening the console must keep the existing session');
  outcomes.push('verified owner account entry opens the full command center without signing out');
  outcomes.push('public Admin sign-in: invalid password, 2FA rejection and verified owner console');
  console.log('PASS actual admin form: no access before 2FA; verified owner reaches full console');
  await evaluate(cdp, `document.querySelector('[data-os-menu-btn]').click();document.querySelector('[data-os-menu-nav="adminos"]').click();window.qaPriorAccountPrivate='PRIVATE-OWNER-ACCOUNT'`);
  await waitFor(cdp, `document.querySelector('[data-workspace-page="adminos"]') && !document.querySelector('[data-workspace-transition]')`, 'Owner admin page must be active for the account-change regression');
  await signedOut();
  assert.equal(await evaluate(cdp, `Boolean(window.qaPriorAccountPrivate || document.querySelector('[data-workspace-page="adminos"]') || location.hash)`), false, 'Sign out cannot retain the previous account document, private view or route');
  assert.equal(tokens.size, 0, 'Owner signout must revoke its fixture session');

  await selectAccess('admin');
  holdLogout = true;
  await credentials('customer-2fa');
  await waitFor(cdp, `document.querySelector('[data-auth-form="2fa"]')`, 'A customer challenge must still complete before deciding verified authority');
  await code('123456');
  await waitFor(cdp, `document.querySelector('[data-db-error]')?.textContent.includes('does not have PhantomForce admin access')`, 'Customer credentials in Admin sign-in must explain the restriction');
  assert.deepEqual(await identity(), { owner: false, tokenPresent: false, sessionPresent: false, tenant: 'phantomforce' });
  assert.equal(tokens.size, 0, 'Rejected admin intent must revoke the issued customer session');
  assert.equal(await evaluate(cdp, `document.querySelector('[data-phantom]').hidden`), true);
  assert.equal(await evaluate(cdp, `document.querySelector('[data-auth-form]')?.hasAttribute('aria-busy')`), false, 'A stalled revocation response cannot keep the rejected admin sign-in controls busy');
  for (let attempt = 0; attempt < 100 && pendingLogoutReplies.length === 0; attempt++) await sleep(20);
  assert.equal(pendingLogoutReplies.length, 1, 'The fixture must actually withhold a logout response while the gate recovers');
  holdLogout = false; while (pendingLogoutReplies.length) pendingLogoutReplies.shift()();
  await credentials('customer-fixture');
  await waitFor(cdp, `document.querySelector('[data-db-error]')?.textContent.includes('does not have PhantomForce admin access') && !document.querySelector('[data-auth-form]')?.hasAttribute('aria-busy')`, 'Non-2FA customer admin attempt must also recover');
  assert.equal((await identity()).tokenPresent, false); assert.equal(tokens.size, 0);
  outcomes.push('customer credentials cannot become admin with or without 2FA');
  console.log('PASS actual customer credentials in Admin entry: no role promotion, session revoked and useful recovery');

  await selectAccess('customer');
  await credentials('customer-fixture');
  await waitFor(cdp, `!document.querySelector('[data-phantom]').hidden && document.querySelector('[data-console]')?.dataset.consoleView==='business-dashboard'`, 'Customer entry must retain the scoped business experience');
  assert.equal((await identity()).owner, false); assert.equal((await identity()).tenant, 'occasionally-odd');
  await evaluate(cdp, `document.querySelector('[data-os-menu-btn]').click()`);
  assert.equal(await evaluate(cdp, `Boolean(document.querySelector('[data-os-menu-nav="adminos"]') || document.querySelector('[data-os-menu-nav="developer"]'))`), false);
  await evaluate(cdp, `document.querySelector('[data-os-menu-btn]').click()`);
  outcomes.push('ordinary customer form opens only the authorized business');
  await evaluate(cdp, `document.querySelector('[data-workspace-access]').click()`);
  await waitFor(cdp, `document.querySelector('[data-access-admin]')`, 'A signed-in customer needs a visible Admin sign-in entry in workspace/account access');
  await evaluate(cdp, `document.querySelector('[data-access-admin]').click()`);
  await waitFor(cdp, gateReady, 'Admin account entry must sign out the current customer and return to the same-site gate');
  assert.match(await evaluate(cdp, `document.querySelector('.gate-card h1').textContent`), /Admin sign-in/i);
  assert.equal(await evaluate(cdp, 'location.origin'), base, 'The admin entry must stay on the same app origin');
  assert.equal((await identity()).tokenPresent, false); assert.equal(tokens.size, 0);
  outcomes.push('customer workspace Admin entry signs out and opens same-site Admin sign-in');
  await selectAccess('customer');
  await credentials('owner@example.invalid');
  await waitFor(cdp, `!document.querySelector('[data-phantom]').hidden && document.querySelector('[data-console]')?.dataset.consoleView==='dashboard'`, 'The unified customer entry must also accept an existing owner account');
  assert.equal((await identity()).owner, true);
  await signedOut();
  outcomes.push('existing owner can use either sign-in entry on the same origin');

  await selectAccess('customer');
  await evaluate(cdp, `document.querySelector('[data-auth-mode="signup"]').click()`);
  await waitFor(cdp, `document.querySelector('[data-auth-form="signup"]')`, 'Customer account creation must remain available');
  await evaluate(cdp, `(function(){const f=document.querySelector('[data-auth-form="signup"]');f.elements.email.value='new-customer@example.invalid';f.elements.username.value='newcustomer';f.elements.name.value='Fixture customer';f.elements.organizationName.value='Fixture customer workspace';f.elements.password.value='fixture-password';f.requestSubmit()})()`);
  await waitFor(cdp, `document.querySelector('[data-auth-form="signin"]') && document.querySelector('.gate-card').textContent.includes('Account created')`, 'Customer signup must finish as a normal sign-in rather than an admin session');
  assert.equal(signupCount, 1); assert.equal((await identity()).tokenPresent, false);
  assert.ok(!requests.find(r => r.path === '/auth/signup').keys.some(k => ['role', 'isSuperAdmin', 'canManageAccess'].includes(k)), 'Signup must not request administrator authority');
  outcomes.push('customer signup stays available and never requests or creates admin authority');

  await navigate('?access=admin&session=admin');
  assert.match(await evaluate(cdp, `document.querySelector('.gate-card h1').textContent`), /Admin sign-in/i);
  assert.equal((await identity()).owner, false); assert.equal((await identity()).tokenPresent, false);
  assert.equal(await evaluate(cdp, `document.querySelector('[data-phantom]').hidden`), true, 'Neither access intent nor the local demo query can grant public admin access');
  outcomes.push('direct admin entry and demo-like URL parameters remain authentication only');

  authUnavailableOnce = true;
  const configRequestsBefore = requests.filter(r => r.path === '/sessions').length;
  await navigate('?access=admin');
  assert.ok(requests.filter(r => r.path === '/sessions').length - configRequestsBefore >= 2, 'Unavailable account configuration must be fetched again instead of reusing its failed cached result');
  assert.equal((await identity()).tokenPresent, false);
  assert.equal(await evaluate(cdp, `document.querySelector('[data-phantom]').hidden`), true);
  outcomes.push('temporarily unavailable account configuration refreshes and recovers without granting a session');

  legacyOnly = true;
  await navigate('?access=admin');
  await credentials('owner@example.invalid');
  await waitFor(cdp, `!document.querySelector('[data-phantom]').hidden && document.querySelector('[data-console]')?.dataset.consoleView==='dashboard'`, 'An explicitly advertised owner-production lane must remain usable when database sign-in is unavailable');
  assert.equal((await identity()).owner, true);
  assert.ok(requests.some(r => r.path === '/auth/owner-login'), 'The advertised owner fallback must use its existing endpoint');
  outcomes.push('advertised owner-production fallback remains authenticated on the app origin');
  const allowed = new Set(['/auth/login', '/auth/2fa/verify', '/auth/logout', '/auth/signup', '/auth/owner-login']);
  assert.ok(requests.filter(r => !['GET', 'HEAD'].includes(r.method)).every(r => r.method === 'POST' && allowed.has(r.path)), 'Account QA cannot run owner commands or unrelated writes');
  for (const request of requests.filter(r => r.path === '/auth/login')) assert.deepEqual(request.keys, ['email', 'password'], 'UI access intent cannot be submitted as an authority flag');
  assert.deepEqual(cdp.errors, [], 'Uncaught browser errors');
  writeFileSync(path.join(runDir, 'report.json'), JSON.stringify({ ok: true, publicHostSelectorReboundToLoopbackHostname: true, outcomes, requests }, null, 2));
  console.log(JSON.stringify({ ok: true, cases: outcomes.length, report: path.join(runDir, 'report.json') }));
} catch (error) {
  console.error(error.stack); process.exitCode = 1;
  if (cdp) { try { console.error('Account gate diagnostic: '+JSON.stringify(await evaluate(cdp, `({url:location.href,gateHidden:document.querySelector('[data-gate]')?.hidden,heading:document.querySelector('.gate-card h1')?.textContent,error:document.querySelector('[data-db-error]')?.textContent,form:document.querySelector('[data-auth-form]')?.dataset.authForm,body:location.href.startsWith('chrome-error:')?document.body.innerText.slice(0,700):null})`))); } catch {} }
} finally { cdp?.close(); await stop(chrome); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
