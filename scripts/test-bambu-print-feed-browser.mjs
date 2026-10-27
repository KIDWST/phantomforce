import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Isolated authenticated API fixtures and a disposable browser profile only.
// No printer, production API, private model or external market service is used.
const root = fileURLToPath(new URL("../", import.meta.url));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = path.join(root, "tmp", "bambu-feed", stamp); mkdirSync(runDir, { recursive: true });
const chromePath = [process.env.CHROME_PATH, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean).find(existsSync);
assert.ok(chromePath, "Chrome is required for Bambu feed browser QA");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function ready(url) { for (let i = 0; i < 100; i++) { try { if ((await fetch(url)).ok) return; } catch {} await sleep(100); } throw new Error(`Not ready: ${url}`); }
function connect(url) {
  const socket = new WebSocket(url), pending = new Map(), errors = []; let sequence = 0;
  const opened = new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  socket.addEventListener("message", event => { const message = JSON.parse(String(event.data)); if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text); const item = pending.get(message.id); if (!item) return; pending.delete(message.id); clearTimeout(item.timer); message.error ? item.reject(new Error(message.error.message)) : item.resolve(message.result); });
  return { errors, close: () => socket.close(), async send(method, params = {}) { await opened; const id = ++sequence; return new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 20000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })); }); } };
}
async function evaluate(cdp, expression) { const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result?.value; }
async function waitFor(cdp, expression, label) { for (let i = 0; i < 120; i++) { if (await evaluate(cdp, expression)) return; await sleep(100); } throw new Error(label); }
const archive = Buffer.from("Isolated synthetic 3MF archive fixture. No private model.");
const fileHash = createHash("sha256").update(archive).digest("hex"), runId = "a".repeat(64);
const tenant = "occasionally-odd", now = new Date().toISOString();
const fixture = { ok: true, tenant_id: tenant, canManage: true, revision: 1,
  collector: { enabled: true, connected: true, state: "watching", lastScanAt: now, lastCaptureAt: now, discovered: 2, source: "Bambu Studio local send packages", coverage: "Prepared send packages; printer completion is not connected" },
  settings: { paused: false, currency: "USD", costsConfirmed: false, costs: { filament: 25, machine: 1, labor: 20, minutes: 10, packaging: 1, fixedFee: 0, failure: .1, fee: 0, margin: .3, hourly: 10, revenue: 25 } },
  runs: [runId, "b".repeat(64)].map((id, index) => ({ id, tenantId: tenant, fileHash, observedAt: new Date(Date.now() - index * 60000).toISOString(), evidence: "prepared", source: "bambu-studio-local" })),
  files: [{ sha256: fileHash, tenantId: tenant, bytes: archive.length, metadata: { name: "plate_1.gcode.3mf", projectTitle: "Custom modular display", printer: "Bambu P2S", nozzle: "0.4 mm", plates: [{ index: "1", grams: 100, seconds: 28800, objectCount: 45, supportUsed: true, warnings: [], filaments: [{ id: "1", type: "PLA", color: "#000000", grams: 60 }, { id: "2", type: "PLA", color: "#ffffff", grams: 40 }] }] }, mapping: null, analysis: { plates: [{ index: "1", materialCost: { amount: 2.2 } }] } }],
  summary: { receipts: 2, uniqueFiles: 1, completed: 0, failed: 0, knownOutcomeFailureRate: null } };
let releaseFeed = null, holdFeed = false, feedReads = 0, mutationCount = 0, archiveReads = 0;
const calls = [];
const commerceVersion = readFileSync(path.join(root, "app/js/commerce-workspace.js"), "utf8").match(/store\.js\?v=([^"']+)/)?.[1];
const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1"), pathname = url.pathname;
  const json = (payload, status = 200) => { response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); response.end(JSON.stringify(payload)); };
  if (pathname === "/health") return json({ ok: true });
  if (pathname.startsWith("/api/")) {
    calls.push({ pathname, business: request.headers["x-phantomforce-business"], authorized: request.headers.authorization === "Bearer isolated-browser-fixture", method: request.method });
    if (request.headers.authorization !== "Bearer isolated-browser-fixture") return json({ ok: false, error: "fixture_auth_required" }, 401);
    if (pathname === "/api/business-workspaces/commerce") { const business = request.headers["x-phantomforce-business"]; return json({ ok: true, tenant_id: business, canManage: true, state: { tenantId: business, revision: 1, products: [], materials: [], printers: [], orders: [], jobs: [], customers: [], channels: [], outbox: [] }, summary: {} }); }
    if (pathname === "/api/business-workspaces/print-runs" && request.method === "GET") { feedReads++; if (holdFeed) { holdFeed = false; await new Promise(resolve => { releaseFeed = resolve; }); } return json(fixture); }
    if (pathname === `/api/business-workspaces/print-runs/${runId}/file`) { archiveReads++; response.writeHead(200, { "content-type": "model/3mf", "x-phantomforce-sha256": fileHash }); return response.end(archive); }
    const chunks = []; for await (const chunk of request) chunks.push(chunk); const input = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    if (pathname === "/api/business-workspaces/print-runs/settings") { mutationCount++; fixture.settings = { ...fixture.settings, ...input }; fixture.collector.state = fixture.settings.paused ? "paused" : "watching"; fixture.revision++; return json({ ok: true, tenant_id: tenant, canManage: true, settings: fixture.settings }); }
    if (pathname === `/api/business-workspaces/print-runs/models/${fileHash}`) { mutationCount++; fixture.files[0].mapping = input; fixture.revision++; return json({ ok: true, tenant_id: tenant, canManage: true, model: input }); }
    return json({ ok: false, error: "isolated_endpoint_unavailable" }, 404);
  }
  if (pathname === "/qa") { response.writeHead(200, { "content-type": "text/html" }); return response.end(`<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app/commerce-workspace.css"><style>body{margin:0;background:#241e23}main{max-width:1420px;margin:auto}</style></head><body><main id="root"></main><script type="module">const oldInterval=window.setInterval;window.__polls=[];window.setInterval=(fn,ms)=>{if(ms===20000)window.__polls.push(fn);return oldInterval(fn,ms)};const store=await import('/app/js/store.js?v=${commerceVersion}');store.session.set({token:'isolated-browser-fixture'});window.scope='occasionally-odd';window.account=store.session;const {renderCommerceWorkspace}=await import('/app/js/commerce-workspace.js');window.mount=(section='production',business='occasionally-odd')=>{window.scope=business;window.surface=renderCommerceWorkspace(document.querySelector('#root'),{businessId:business,initialSection:section,getActiveBusinessId:()=>window.scope})};window.mount();</script></body></html>`); }
  if (!pathname.startsWith("/app/")) { response.writeHead(404); return response.end(); }
  const target = path.resolve(root, `.${decodeURIComponent(pathname)}`);
  if (!target.startsWith(path.join(root, "app") + path.sep)) { response.writeHead(403); return response.end(); }
  try { if (!statSync(target).isFile()) throw new Error(); const mime = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html" }[path.extname(target)] || "application/octet-stream"; response.writeHead(200, { "content-type": mime, "cache-control": "no-store" }); response.end(readFileSync(target)); } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); const port = server.address().port, base = `http://127.0.0.1:${port}`;
const debugServer = createServer(); await new Promise(resolve => debugServer.listen(0, "127.0.0.1", resolve)); const debugPort = debugServer.address().port; await new Promise(resolve => debugServer.close(resolve));
let chrome, cdp;
try {
  chrome = spawn(chromePath, ["--headless=new", `--remote-debugging-port=${debugPort}`, "--remote-allow-origins=*", `--user-data-dir=${path.join(os.tmpdir(), `phantom-bambu-qa-${process.pid}-${stamp}`)}`, "--disable-gpu", "--disable-extensions", "--disable-background-networking", "--no-first-run", "--no-default-browser-check", "about:blank"], { windowsHide: true, stdio: "ignore" });
  await ready(`http://127.0.0.1:${debugPort}/json/version`);
  const target = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" }).then(response => response.json()); cdp = connect(target.webSocketDebuggerUrl);
  await cdp.send("Page.enable"); await cdp.send("Runtime.enable"); await cdp.send("Network.enable"); await cdp.send("Network.setBlockedURLs", { urls: ["https://*"] });
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1360, height: 1024, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.navigate", { url: `${base}/qa` });
  await waitFor(cdp, "document.querySelector('.bpf-run-details[open]') && document.querySelector('[data-po-folder]')", "Actual Production workspace did not mount the durable feed and scanner");
  assert.equal(await evaluate(cdp, "document.querySelector('[data-bambu-print-feed]').compareDocumentPosition(document.querySelector('[data-print-opportunities]')) & Node.DOCUMENT_POSITION_FOLLOWING"), 4);
  assert.equal(await evaluate(cdp, "document.querySelector('[data-bpf-detail=shop]').open"), false, "No mandatory manual setup should open first");
  const first = await evaluate(cdp, "document.querySelector('.bpf-feed').innerText");
  assert.match(first, /Watching Bambu Studio/); assert.match(first, /Custom modular display/); assert.match(first, /8 saved printer hours/); assert.match(first, /cleanup/); assert.match(first, /Illustrative cost scenario/); assert.match(first, /printer completion.*not connected/i);
  assert.match(first, /Bambu print feed/);
  assert.ok(!first.includes("45 saleable"), "Part count became product count");
  assert.equal(await evaluate(cdp, "new URL(document.querySelector('[data-bambu-feed-css]').href).searchParams.get('v')"), commerceVersion, "Lazy stylesheet lost the build cache key");
  let screenshot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); writeFileSync(path.join(runDir, "bambu-production-desktop.png"), Buffer.from(screenshot.data, "base64"));
  console.log("PASS actual Production commerce mount, automatic expanded decision brief, no mandatory form, scoped authenticated history and versioned lazy CSS");
  await evaluate(cdp, "document.querySelector('[data-bpf-toggle]').click()"); await waitFor(cdp, "document.querySelector('.bpf-status')?.innerText==='Capture paused'", "Pause did not persist");
  await evaluate(cdp, "document.querySelector('[data-bpf-toggle]').click()"); await waitFor(cdp, "document.querySelector('.bpf-status')?.innerText==='Watching Bambu Studio'", "Resume did not persist");
  await evaluate(cdp, "document.querySelector('[data-bpf-detail=shop]').open=true;var form=document.querySelector('[data-bpf-costs]');form.elements.filament.value='32';form.elements.confirmed.checked=true;form.requestSubmit()");
  await waitFor(cdp, "document.querySelector('.bpf-basis')?.innerText.includes('Saved cost assumptions')", "Shop assumptions were not saved");
  assert.equal(fixture.settings.costs.filament, 32); assert.equal(fixture.settings.costs.fee, 0, "Local/custom defaults must not invent marketplace fees");
  await evaluate(cdp, `document.querySelector('[data-bpf-detail="model-${fileHash}"]').open=true;var form=document.querySelector('[data-bpf-model]');form.elements.name.value='Custom display';form.elements.saleableUnits.value='4';form.elements.extraCostPerBatch.value='12';form.elements.completeProduct.checked=true;form.elements.rightsStatus.value='original';form.requestSubmit()`);
  await waitFor(cdp, "document.querySelector('.bpf-unit')?.innerText.includes('4 confirmed saleable units')", "Saved model mapping did not unlock unit economics");
  assert.equal(fixture.files[0].mapping.extraCostPerBatch, 12);
  assert.equal(fixture.files[0].mapping.saleableUnits, 4);
  console.log("PASS pause/resume, one-time durable cost assumptions and complete-product yield/hardware mapping");
  fixture.collector.unsupported = 2; fixture.collector.scanLimited = true;
  await evaluate(cdp, "document.querySelector('[data-bpf-refresh]').click()");
  await waitFor(cdp, "document.querySelector('.bpf-feed')?.innerText.includes('Capture coverage is incomplete')", "Unsupported packages were not disclosed");
  assert.match(await evaluate(cdp, "document.querySelector('.bpf-feed').innerText"), /some source folders were not inspected/, "Bounded discovery must disclose scan limits");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 900, deviceScaleFactor: 1, mobile: false });
  await evaluate(cdp, "document.querySelector('[data-bpf-detail=shop]').open=false;document.querySelector('.bpf-feed').scrollIntoView({block:'start'})");
  assert.ok(await evaluate(cdp, "document.documentElement.scrollWidth<=innerWidth+2"), "Bambu feed overflows the mobile viewport");
  screenshot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); writeFileSync(path.join(runDir, "bambu-production-390.png"), Buffer.from(screenshot.data, "base64"));
  await evaluate(cdp, "document.querySelector('.bpf-run-details[open]').scrollIntoView({block:'start'})"); screenshot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); writeFileSync(path.join(runDir, "bambu-costs-390.png"), Buffer.from(screenshot.data, "base64"));
  await evaluate(cdp, "window.mount('finance')"); await waitFor(cdp, "document.querySelector('.bpf-run-details[open]') && document.querySelector('.cw-metrics-three')", "Finance did not include durable feed");
  assert.match(await evaluate(cdp, "document.querySelector('.bpf-unit').innerText"), /4 confirmed saleable units/, "Mapping was not reused after remount");
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: runDir });
  await evaluate(cdp, "document.querySelector('[data-bpf-download]').click()");
  await waitFor(cdp, "document.querySelector('.bpf-notice')?.innerText.includes('verified and downloaded')", "Authenticated archive download failed");
  assert.equal(archiveReads, 1, "Archive download did not use authenticated API");
  for (let i = 0; i < 50 && !existsSync(path.join(runDir, "plate_1.gcode.3mf")); i++) await sleep(30);
  assert.ok(existsSync(path.join(runDir, "plate_1.gcode.3mf")), "Verified archive was not downloaded");
  assert.equal(createHash("sha256").update(readFileSync(path.join(runDir, "plate_1.gcode.3mf"))).digest("hex"), fileHash);
  await evaluate(cdp, `var form=document.querySelector('[data-bpf-model]');document.querySelector('[data-bpf-detail="model-${fileHash}"]').open=true;form.elements.name.value='Unsaved preserved draft';form.elements.name.dispatchEvent(new Event('input',{bubbles:true}));window.__polls.at(-1)()`);
  await sleep(250); assert.equal(await evaluate(cdp, "document.querySelector('[data-bpf-model]').elements.name.value"), "Unsaved preserved draft", "Automatic refresh erased an in-progress optional refinement");
  console.log("PASS mobile containment, Finance integration, cross-mount saved mapping, authenticated SHA-verified archive download and draft-safe automatic refresh");
  // A feed response started under one account must not be accepted by the same
  // business surface after the authenticated account changes.
  await evaluate(cdp, "window.mount('production')"); await waitFor(cdp, "document.querySelector('.bpf-run-details[open]')", "Production remount failed");
  holdFeed = true; const beforeReads = feedReads; await evaluate(cdp, "window.__polls.at(-1)()");
  for (let i = 0; i < 50 && feedReads === beforeReads; i++) await sleep(30);
  assert.ok(releaseFeed, "Late-response fixture was not reached");
  fixture.files[0].mapping.name = "Late response must not render";
  await evaluate(cdp, "window.account.set({token:'different-isolated-account'})"); releaseFeed(); releaseFeed = null; await sleep(300);
  assert.ok(!(await evaluate(cdp, "document.querySelector('.bpf-feed').innerText")).includes("Late response must not render"), "Previous account response rendered after same-business account switch");
  const beforeMutations = mutationCount, beforeArchives = archiveReads;
  await evaluate(cdp, "document.querySelector('[data-bpf-toggle]').click();document.querySelector('[data-bpf-download]').click()"); await sleep(150);
  assert.equal(mutationCount, beforeMutations); assert.equal(archiveReads, beforeArchives);
  await evaluate(cdp, "window.account.set({token:'isolated-browser-fixture'});window.mount('production','phantomforce')");
  await waitFor(cdp, "document.querySelector('[data-commerce-workspace=phantomforce]') && document.querySelector('[data-po-folder]')", "Other business fixture failed");
  assert.equal(await evaluate(cdp, "document.querySelectorAll('[data-bambu-print-feed]').length"), 0, "Bambu history leaked into another workspace");
  assert.ok(calls.filter(call => call.pathname.includes('print-runs')).every(call => call.business === tenant && call.authorized), "Print requests lacked scope/authentication");
  assert.deepEqual(cdp.errors, [], "Uncaught browser errors");
  console.log("PASS same-business account-change late-response/action guard and other-business isolation");
  writeFileSync(path.join(runDir, "report.json"), JSON.stringify({ ok: true, productionMount: true, financeMount: true, authenticated: true, modelMappingReused: true, mobileWidth: 390, draftPreserved: true, accountSwitchGuard: true, tenantIsolation: true, externalRequestsBlocked: true, screenshots: ["bambu-production-desktop.png", "bambu-production-390.png", "bambu-costs-390.png"] }, null, 2));
  console.log(JSON.stringify({ ok: true, report: path.join(runDir, "report.json") }));
} catch (error) { console.error(error.stack); process.exitCode = 1; }
finally { if (releaseFeed) releaseFeed(); cdp?.close(); if (chrome?.exitCode === null) { chrome.kill(); await Promise.race([new Promise(resolve => chrome.once("exit", resolve)), sleep(1500)]); } server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
