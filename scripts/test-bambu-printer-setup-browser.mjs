import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Disposable synthetic credentials and authenticated local fixture only. No printer or production service is contacted.
const root = fileURLToPath(new URL("../", import.meta.url)), stamp = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = path.join(root, "tmp", "bambu-pairing", stamp); mkdirSync(runDir, { recursive: true });
const chromePath = [process.env.CHROME_PATH, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean).find(existsSync);
assert.ok(chromePath, "Chrome is required for printer setup browser QA");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function ready(url) { for (let i = 0; i < 100; i++) { try { if ((await fetch(url)).ok) return; } catch {} await sleep(100); } throw Error("Browser fixture did not become ready"); }
function connect(url) {
  const socket = new WebSocket(url), pending = new Map(), errors = []; let sequence = 0;
  const opened = new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  socket.addEventListener("message", event => { const message = JSON.parse(String(event.data)); if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text); const item = pending.get(message.id); if (!item) return; pending.delete(message.id); clearTimeout(item.timer); message.error ? item.reject(Error(message.error.message)) : item.resolve(message.result); });
  return { errors, close: () => socket.close(), async send(method, params = {}) { await opened; const id = ++sequence; return new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 20000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })); }); } };
}
async function evaluate(cdp, expression) { const value = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (value.exceptionDetails) throw Error(value.exceptionDetails.exception?.description || value.exceptionDetails.text); return value.result?.value; }
async function waitFor(cdp, expression, label) { for (let i = 0; i < 100; i++) { if (await evaluate(cdp, expression)) return; await sleep(100); } throw Error(label); }
const tenant = "occasionally-odd", runId = "a".repeat(64), hash = "b".repeat(64), syntheticCode = "QA123456", now = new Date().toISOString();
const monitor = { state: "configured", connected: 1, printers: [{ id: "p2s", bindingId: "p2s:abcdef1234567890", model: "P2S", label: "Fixture P2S", state: "monitoring", connected: true, job: { name: "Synthetic sign", taskId: "fixture-task-101", subtaskId: "fixture-subtask-202", state: "printing", progress: 40, remainingMinutes: 42, observedAt: now } }] };
let pairingState = { ok: true, tenant_id: tenant, revision: 0, encryptionReady: true, connections: [], monitor };
const feed = { ok: true, tenant_id: tenant, workflow: { revision: 12 }, runs: [{ id: runId, fileHash: hash, observedAt: now }], files: [{ sha256: hash, metadata: { projectTitle: "Synthetic sign" } }] };
const calls = [], commands = [], pairs = []; let failSave = true, hold = false, release = null;
const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1"), pathname = url.pathname;
  const json = (value, status = 200) => { response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); response.end(JSON.stringify(value)); };
  if (pathname === "/health") return json({ ok: true });
  if (pathname.startsWith("/api/")) {
    calls.push({ method: request.method, path: pathname, authorized: request.headers.authorization === "Bearer isolated-pairing-fixture", business: request.headers["x-phantomforce-business"] });
    if (request.headers.authorization !== "Bearer isolated-pairing-fixture" || request.headers["x-phantomforce-business"] !== tenant) return json({ ok: false, error: "Fixture scope rejected" }, 403);
    if (hold && request.method === "GET") { hold = false; await new Promise(resolve => { release = resolve; }); }
    if (request.method === "GET") return json(pathname.endsWith("printer-connections") ? pairingState : feed);
    const chunks = []; for await (const chunk of request) chunks.push(chunk); const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    if (pathname.endsWith("/printer-connections")) { pairs.push(body); if (failSave) return json({ ok: false, message: "Synthetic pairing failure" }, 409); pairingState = { ...pairingState, revision: pairingState.revision + 1, connections: [{ id: body.id, label: body.label, model: body.model, configured: true, updatedAt: now }] }; return json(pairingState); }
    if (pathname.endsWith("workflow/commands")) { commands.push(body); return json({ ok: true, tenant_id: tenant }); }
    return json({ ok: false, error: "Fixture endpoint unavailable" }, 404);
  }
  if (pathname === "/qa") { response.writeHead(200, { "content-type": "text/html" }); return response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app/commerce-workspace.css"><link rel="stylesheet" href="/app/bambu-print-feed.css"><style>body{margin:0;padding:16px;background:#161c20;color:#edf3ef}main{max-width:1200px;margin:auto}</style></head><body><main id="root" class="bpf-feed"></main><script type="module">const{renderBambuPrinterSetup}=await import('/app/js/bambu-printer-setup.js');window.account='fixture-a';window.business='occasionally-odd';window.mount=(business='occasionally-odd')=>{window.surface?.destroy();window.business=business;window.surface=renderBambuPrinterSetup(document.querySelector('#root'),{businessId:business,getSessionIdentity:()=>window.account,isActive:()=>window.business===business,getHeaders:()=>({Authorization:'Bearer isolated-pairing-fixture'})})};window.mount();</script></body></html>`); }
  const target = path.resolve(root, `.${decodeURIComponent(pathname)}`);
  if (!target.startsWith(path.join(root, "app") + path.sep)) { response.writeHead(403); return response.end(); }
  try { if (!statSync(target).isFile()) throw Error(); response.writeHead(200, { "content-type": { ".js": "text/javascript", ".css": "text/css" }[path.extname(target)] || "application/octet-stream" }); response.end(readFileSync(target)); } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); const base = `http://127.0.0.1:${server.address().port}`;
const debugServer = createServer(); await new Promise(resolve => debugServer.listen(0, "127.0.0.1", resolve)); const debugPort = debugServer.address().port; await new Promise(resolve => debugServer.close(resolve));
let chrome, cdp;
try {
  chrome = spawn(chromePath, ["--headless=new", `--remote-debugging-port=${debugPort}`, "--remote-allow-origins=*", `--user-data-dir=${path.join(os.tmpdir(), `phantom-bambu-pairing-${process.pid}-${stamp}`)}`, "--disable-gpu", "--disable-extensions", "--disable-background-networking", "--no-first-run", "--no-default-browser-check", "about:blank"], { windowsHide: true, stdio: "ignore" });
  await ready(`http://127.0.0.1:${debugPort}/json/version`); const target = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" }).then(response => response.json()); cdp = connect(target.webSocketDebuggerUrl);
  await cdp.send("Page.enable"); await cdp.send("Runtime.enable"); await cdp.send("Network.enable"); await cdp.send("Network.setBlockedURLs", { urls: ["https://*"] });
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1360, height: 1000, deviceScaleFactor: 1, mobile: false }); await cdp.send("Page.navigate", { url: `${base}/qa` });
  await waitFor(cdp, "document.querySelector('[data-bambu-pairing]')", "Printer setup did not mount"); assert.equal(calls.length, 0, "Closed setup must not fetch credentials or start pairing");
  await evaluate(cdp, "document.querySelector('[data-bambu-pairing]').open=true"); await waitFor(cdp, "document.querySelector('[data-pair-form]')", "Opening setup did not load authenticated state");
  assert.equal(calls.every(call => call.authorized && call.business === tenant), true);
  assert.equal(await evaluate(cdp, "document.querySelector('[name=accessCode]').type"), "password");
  await evaluate(cdp, `document.querySelector('[name=host]').value='192.168.4.20';document.querySelector('[name=serial]').value='FIXTUREP2S123';document.querySelector('[name=accessCode]').value='${syntheticCode}'`); await sleep(250);
  assert.equal(await evaluate(cdp, "document.querySelector('[name=accessCode]').value"), syntheticCode, "First-open toggle must not repaint an active credential field");
  await evaluate(cdp, "document.querySelector('[data-pair-form]').requestSubmit()"); await waitFor(cdp, "document.querySelector('.bpf-notice')?.textContent.includes('Synthetic pairing failure')", "Failure did not show a safe message");
  assert.equal(await evaluate(cdp, "document.querySelector('[name=accessCode]').value"), "", "Failed save must clear code");
  assert.equal(await evaluate(cdp, `document.body.innerHTML.includes('${syntheticCode}')||JSON.stringify(localStorage).includes('${syntheticCode}')||JSON.stringify(sessionStorage).includes('${syntheticCode}')`), false);
  failSave = false;
  await evaluate(cdp, `document.querySelector('[name=host]').value='192.168.4.20';document.querySelector('[name=serial]').value='FIXTUREP2S123';document.querySelector('[name=accessCode]').value='${syntheticCode}';document.querySelector('[data-pair-form]').requestSubmit()`);
  await waitFor(cdp, "document.querySelector('.bpf-notice')?.textContent.includes('Connection saved encrypted')", "Pairing save did not complete"); assert.equal(pairs.at(-1).accessCode, syntheticCode); assert.equal(pairs.at(-1).id, "p2s");
  await evaluate(cdp, `var form=document.querySelector('[data-pair-bind=p2s]');form.elements.runId.value='${runId}';form.elements.verified.checked=true;form.requestSubmit()`);
  await waitFor(cdp, "document.querySelector('.bpf-notice')?.textContent.includes('Exact printer task linked')", "Exact task link did not complete");
  assert.deepEqual(commands[0].payload, { runId, printerId: "p2s:abcdef1234567890", taskId: "fixture-task-101", subtaskId: "fixture-subtask-202" }); assert.equal(commands[0].expectedRevision, 12);
  let image = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); writeFileSync(path.join(runDir, "bambu-pairing-desktop.png"), Buffer.from(image.data, "base64"));
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 900, deviceScaleFactor: 1, mobile: false }); assert.equal(await evaluate(cdp, "document.documentElement.scrollWidth<=innerWidth+2"), true);
  image = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); writeFileSync(path.join(runDir, "bambu-pairing-390.png"), Buffer.from(image.data, "base64"));
  const countBefore = calls.length; await evaluate(cdp, "window.account='fixture-b';document.querySelector('[data-pair-refresh]').click();document.querySelector('[data-pair-form]').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))"); await sleep(100); assert.equal(calls.length, countBefore, "Account replacement must block old actions");
  await evaluate(cdp, "window.account='fixture-a';window.mount();document.querySelector('[data-bambu-pairing]').open=true"); await waitFor(cdp, "document.querySelector('[data-pair-form]')", "Remount did not load");
  hold = true; await evaluate(cdp, "document.querySelector('[data-pair-refresh]').click()"); for (let i = 0; i < 30 && !release; i++) await sleep(20); assert.ok(release);
  await evaluate(cdp, "window.account='fixture-c';document.querySelector('#root').textContent='New account placeholder'"); release(); release = null; await sleep(150); assert.equal(await evaluate(cdp, "document.querySelector('#root').textContent"), "New account placeholder");
  const isolatedCount = calls.length; await evaluate(cdp, "window.mount('client-chicagoshots')"); await sleep(100); assert.equal(calls.length, isolatedCount); assert.equal(await evaluate(cdp, "document.querySelector('#root').children.length"), 0);
  assert.deepEqual(cdp.errors, []);
  writeFileSync(path.join(runDir, "report.json"), JSON.stringify({ ok: true, authScoped: true, secretCleared: true, noClientPersistence: true, exactTaskBinding: true, accountGuard: true, tenantIsolation: true, mobileWidth: 390 }, null, 2));
  console.log(`PASS encrypted printer setup browser: scoped auth, password clearing/no persistence, exact binding, stale account/tenant suppression and390px layout. Report: ${runDir}`);
} finally { release?.(); cdp?.close(); chrome?.kill(); await new Promise(resolve => server.close(resolve)); }
