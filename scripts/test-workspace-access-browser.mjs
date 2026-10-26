import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Disposable Chrome profile and static-only server. API requests get a fixed
// unavailable response; no proxy, recovery launcher, or real service is used.
const root = fileURLToPath(new URL("../", import.meta.url));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = path.join(root, "tmp", "workspace-access", stamp);
const businesses = [
  { id: "phantomforce", name: "PhantomForce" },
  { id: "client-chicagoshots", name: "ChicagoShots" },
  { id: "occasionally-odd", name: "Occasionally Odd" },
];
const chromePath = [process.env.CHROME_PATH, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean).find(existsSync);
assert.ok(chromePath, "Chrome is required for business workspace browser QA");
mkdirSync(runDir, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(() => resolve(port)); });
});
async function ready(url) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { const response = await fetch(url); if (response.ok) return response; } catch {}
    await sleep(150);
  }
  throw new Error(`Local test service did not become ready: ${url}`);
}
function connect(url) {
  const socket = new WebSocket(url);
  let sequence = 0;
  const pending = new Map();
  const errors = [];
  const open = new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    if (!pending.has(message.id)) return;
    const task = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(task.timer);
    if (message.error) task.reject(new Error(message.error.message)); else task.resolve(message.result);
  });
  return {
    errors,
    close: () => socket.close(),
    async send(method, params = {}) {
      await open;
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Browser call timed out: ${method}`)); }, 20000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
  };
}
async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
}
async function waitFor(cdp, expression, label) {
  let lastError;
  for (let attempt = 0; attempt < 120; attempt++) {
    try { if (await evaluate(cdp, expression)) return; } catch (error) { lastError = error; }
    await sleep(150);
  }
  throw new Error(`${label}${lastError ? `: ${lastError.message}` : ""}`);
}
async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), sleep(1500)]);
}
const coreExpression = `import('/app/js/store.js?v='+window.PHANTOM_BUILD)`;
const staticPort = await freePort();
const debugPort = await freePort();
const base = `http://127.0.0.1:${staticPort}`;
const server = createServer((request, response) => {
  const pathname = new URL(request.url, base).pathname;
  if (pathname === "/health") { response.writeHead(200, { "content-type": "application/json" }); response.end('{"ok":true}'); return; }
  if (!pathname.startsWith("/app/")) { response.writeHead(503, { "content-type": "application/json" }); response.end('{"ok":false,"error":"isolated_test_api_disabled"}'); return; }
  const target = path.resolve(root, `.${decodeURIComponent(pathname)}`);
  if (!target.startsWith(path.resolve(root, "app") + path.sep)) { response.writeHead(403); response.end(); return; }
  try {
    if (!statSync(target).isFile()) throw new Error("Not a file");
    const mime = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".json": "application/json", ".woff2": "font/woff2" }[path.extname(target)] || "application/octet-stream";
    response.writeHead(200, { "content-type": mime, "cache-control": "no-store" }); response.end(readFileSync(target));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise((resolve) => server.listen(staticPort, "127.0.0.1", resolve));
let chrome;
let cdp;
const results = [];
try {
  await ready(`${base}/health`);
  chrome = spawn(chromePath, ["--headless=new", `--remote-debugging-port=${debugPort}`, "--remote-allow-origins=*", `--user-data-dir=${path.join(os.tmpdir(), `phantomforce-business-qa-${process.pid}-${stamp}`)}`, "--disable-gpu", "--disable-extensions", "--disable-background-networking", "--disable-component-update", "--no-first-run", "--no-default-browser-check", "about:blank"], { windowsHide: true, stdio: "ignore" });
  await ready(`http://127.0.0.1:${debugPort}/json/version`);
  const target = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" }).then((response) => response.json());
  cdp = connect(target.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");
  // Keep every browser request local, including fonts and optional integrations.
  await cdp.send("Network.setBlockedURLs", { urls: ["https://*"] });
  await cdp.send("Page.navigate", { url: `${base}/app/index.html?session=admin` });

  await waitFor(cdp, `document.querySelector('[data-business-select]')?.options.length >= 3`, "Business selector missing");
  for (const width of [1440, 768, 390]) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
    for (const business of businesses) {
      await evaluate(cdp, `document.querySelector('[data-workspace-access]').focus();document.querySelector('[data-workspace-access]').click()`);
      await waitFor(cdp, `document.querySelector('.workspace-access-dialog[open]')`, "Workspace panel did not open");
      assert.equal(await evaluate(cdp, `document.querySelectorAll('[data-access-workspace]').length`), 3);
      const old = await evaluate(cdp, `(async()=>{const c=await ${coreExpression};return c.currentTenantId()})()`);
      await evaluate(cdp, `document.querySelector('[data-access-workspace="${business.id}"]').click()`);
      await waitFor(cdp, `(async()=>{const c=await ${coreExpression};return c.currentTenantId()===${JSON.stringify(business.id)} && document.querySelector('[data-business-select]')?.value===${JSON.stringify(business.id)} && !document.querySelector('.business-switch-curtain') && !document.querySelector('.workspace-access-dialog')})()`, 'Card switch did not complete');
      assert.equal(await evaluate(cdp, `document.querySelector('[data-business-select]').value`), business.id);
      await cdp.send('Page.reload', { ignoreCache: true });
      await waitFor(cdp, `document.querySelector('[data-business-select]')?.value===${JSON.stringify(business.id)}`, 'Reload lost workspace');
      await evaluate(cdp, `document.querySelector('[data-workspace-access]').focus();document.querySelector('[data-workspace-access]').click()`);
      await waitFor(cdp, `document.querySelector('[data-access-print]')`, 'Local tool is not reachable');
      await evaluate(cdp, `document.querySelector('[data-access-print]').click()`);
      await waitFor(cdp, `document.querySelector('[data-po-files]')`, 'Print tool did not load');
      assert.ok(await evaluate(cdp, `document.querySelector('.workspace-access-dialog').scrollWidth <= document.querySelector('.workspace-access-dialog').clientWidth + 2`), 'Print dialog overflow');
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await waitFor(cdp, `!document.querySelector('.workspace-access-dialog')`, 'Escape did not close');
      assert.ok(await evaluate(cdp, `document.activeElement === document.querySelector('[data-workspace-access]')`), 'Focus not restored');
      results.push({ business: business.id, width, from: old, ok: true });
      console.log(`PASS ${business.name} ${width}px: card switch, reload, local print access, containment, Escape and focus`);
    }
  }
  // An isolated customer fixture has one business; never expose operator scopes.
  await evaluate(cdp, `(async()=>{const c=await ${coreExpression};c.session.set({role:'admin',name:'Customer fixture',localCustomer:true,orgId:'customer-fixture',orgRole:'owner',memberships:[{orgId:'customer-fixture',orgName:'Customer fixture workspace',role:'owner'}]});return true})()`);
  await cdp.send('Page.reload', { ignoreCache: true });
  await waitFor(cdp, `document.querySelector('[data-business-select]')?.value==='customer-fixture'`, 'Customer fixture missing');
  assert.equal(await evaluate(cdp, `document.querySelector('[data-business-select]').disabled`),false,'Single-workspace accounts need a usable account picker');
  await evaluate(cdp, `const select=document.querySelector('[data-business-select]');select.value='__workspace_access__';select.dispatchEvent(new Event('change',{bubbles:true}));`);
  await waitFor(cdp, `document.querySelector('[data-access-account]')`, 'Customer recovery actions missing');
  assert.equal(await evaluate(cdp, `document.querySelectorAll('[data-access-workspace]').length`), 1);
  assert.ok(await evaluate(cdp, `document.querySelector('.workspace-access-dialog').innerText.includes('This customer account has one workspace')`));
  const customerCapture = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(path.join(runDir, 'customer-access-390.png'), Buffer.from(customerCapture.data, 'base64'));
  await evaluate(cdp, `document.querySelector('[data-access-refresh]').click()`);
  await waitFor(cdp, `document.querySelector('.wa-message')?.textContent.includes('Could not refresh')`, 'Failed refresh did not recover');
  assert.equal(await evaluate(cdp, `document.querySelector('[data-access-refresh]').disabled`), false);
  await evaluate(cdp, `document.querySelector('[data-access-print]').click()`);
  await waitFor(cdp, `document.querySelector('[data-po-files]')`, 'Customer cannot reach local print tool');
  console.log('Print dialog close geometry: '+await evaluate(cdp, `JSON.stringify({scroll:document.querySelector('.workspace-access-dialog').scrollTop,close:document.querySelector('[data-access-close]').getBoundingClientRect().toJSON()})`));
  const customerTool = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(path.join(runDir, 'customer-print-390.png'), Buffer.from(customerTool.data, 'base64'));
  assert.equal(await evaluate(cdp, `(async()=>{const c=await ${coreExpression};return c.currentTenantId()})()`), 'customer-fixture');
  assert.ok(await evaluate(cdp, `document.querySelector('.workspace-access-dialog').scrollWidth <= document.querySelector('.workspace-access-dialog').clientWidth + 2`));
  console.log('PASS customer fixture: one authorized scope, explanation, failed-refresh recovery and local print tool without business switch');
  assert.deepEqual(cdp.errors, [], 'Uncaught browser errors');
  writeFileSync(path.join(runDir, 'report.json'), JSON.stringify({ ok: true, results, customer: true }, null, 2));
  console.log(JSON.stringify({ ok: true, report: path.join(runDir, 'report.json') }));
} catch (error) {
  console.error(error.stack); process.exitCode=1;
} finally {
  cdp?.close(); await stop(chrome); server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
}
