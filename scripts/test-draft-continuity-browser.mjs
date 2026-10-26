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
const runDir = path.join(root, "tmp", "draft-continuity", stamp);
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
function crc32(bytes) {
  let c = -1;
  for (const b of bytes) { c ^= b; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return (c ^ -1) >>> 0;
}
function zip(members, deflate = false) {
  const local = [], central = []; let offset = 0;
  for (const [name, text] of members) {
    const n = Buffer.from(name), raw = Buffer.from(text), data = deflate ? deflateRawSync(raw) : raw;
    const h = Buffer.alloc(30), d = Buffer.alloc(46);
    h.writeUInt32LE(0x04034b50); h.writeUInt16LE(20, 4); h.writeUInt16LE(deflate ? 8 : 0, 8);
    h.writeUInt32LE(crc32(raw), 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(n.length, 26);
    d.writeUInt32LE(0x02014b50); d.writeUInt16LE(20, 4); d.writeUInt16LE(20, 6); d.writeUInt16LE(deflate ? 8 : 0, 10);
    d.writeUInt32LE(crc32(raw), 16); d.writeUInt32LE(data.length, 20); d.writeUInt32LE(raw.length, 24); d.writeUInt16LE(n.length, 28); d.writeUInt32LE(offset, 42);
    local.push(h, n, data); central.push(d, n); offset += h.length + n.length + data.length;
  }
  const c = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(members.length, 8); end.writeUInt16LE(members.length, 10); end.writeUInt32LE(c.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, c, end]);
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


  await waitFor(cdp, `document.querySelector('[data-business-select]')?.options.length>=3`, 'Shell did not load');
  await evaluate(cdp, `(async()=>{const c=await ${coreExpression};window.qaContinuity={saves:[],forms:[]};const save=c.store.save;c.store.save=function(...args){window.qaContinuity.saves.push(new Error().stack);return save.apply(this,args)};new MutationObserver(()=>{window.qaContinuity.forms.push({hasForm:!!document.querySelector('[data-business-editor]'),at:performance.now()})}).observe(document.querySelector('[data-console]'),{childList:true,subtree:true});return true})()`);
  await evaluate(cdp, `document.querySelector('[data-nav-id="business-projects"]').click()`);
  await waitFor(cdp, `document.querySelector('[data-business-hub="phantomforce"]') && !document.querySelector('.app-main[aria-busy="true"]')`, 'Projects did not finish opening');
  console.log('Before editor: '+JSON.stringify(await evaluate(cdp, `(async()=>{const c=await ${coreExpression};return {disabled:document.querySelector('[data-new-business-work]')?.disabled,role:c.ctx.session.role,scope:c.currentTenantId(),tokenPresent:!!c.session.token(),text:document.querySelector('[data-business-hub]').innerText}})()`)));
  await evaluate(cdp, `document.querySelector('[data-new-business-work]').click()`);
  await waitFor(cdp, `document.querySelector('[data-business-editor]')`, 'Project editor did not open or was immediately replaced');
  await evaluate(cdp, `document.querySelector('[data-business-editor] [name="title"]').value='UNSAVED continuity fixture';document.querySelector('[data-business-editor] [name="notes"]').value='Keep these unsaved words';`);
  await evaluate(cdp, `(async()=>{const c=await ${coreExpression};c.store.save();return true})()`);
  assert.equal(await evaluate(cdp, `document.querySelector('[data-business-editor] [name="title"]')?.value`), 'UNSAVED continuity fixture', 'A background store save discarded the unsaved project draft');
  console.log('PASS unsaved project fields survive a background store update');

  await evaluate(cdp, `window.qaDraftNode=document.querySelector('[data-business-editor]');const f=qaDraftNode.elements.title;f.focus();f.setSelectionRange(2,8);window.dispatchEvent(new PopStateEvent('popstate'));window.dispatchEvent(new HashChangeEvent('hashchange'));`);
  await sleep(450); // Exercise the legacy 200ms hash probe after history events.
  assert.ok(await evaluate(cdp, `window.qaDraftNode===document.querySelector('[data-business-editor]')`), 'Duplicate history events remounted the draft');
  await evaluate(cdp, `(async()=>{const c=await ${coreExpression};c.store.save();c.store.save();return true})()`);
  assert.deepEqual(await evaluate(cdp, `({value:document.activeElement.value,start:document.activeElement.selectionStart,end:document.activeElement.selectionEnd})`),{value:'UNSAVED continuity fixture',start:2,end:8});
  assert.equal(await evaluate(cdp, `document.querySelectorAll('[data-workspace-updates-pending]').length`),1);
  await evaluate(cdp, `document.querySelector('[data-business-editor]').requestSubmit()`);
  await waitFor(cdp, `(async()=>{const c=await ${coreExpression};return c.store.state.businessWorkItems.some(x=>x.ws==='phantomforce' && x.title==='UNSAVED continuity fixture') && !document.querySelector('[data-business-editor]') && !document.querySelector('[data-workspace-updates-pending]')})()`, 'Saving did not release the deferred update');
  console.log('PASS duplicate route events, focus/selection, repeated updates and actual draft save');
  await evaluate(cdp, `document.querySelector('[data-new-business-work]').click()`);
  await waitFor(cdp, `document.querySelector('[data-business-editor]')`, 'Second draft did not open');
  await evaluate(cdp, `(async()=>{const c=await ${coreExpression};c.store.state.businessWorkItems.push({id:'background-fixture',ws:'phantomforce',businessId:'phantomforce',kind:'project',status:'draft',title:'BACKGROUND update fixture',metadata:{}});c.store.save();return true})()`);
  await evaluate(cdp, `document.querySelector('[data-business-cancel]').click()`);
  await waitFor(cdp, `!document.querySelector('[data-workspace-updates-pending]') && document.querySelector('[data-business-hub]').innerText.includes('BACKGROUND update fixture')`, 'Closing did not apply the newest background data');
  console.log('PASS closing an editor applies queued data without an extra user refresh');
  await evaluate(cdp, `document.querySelector('[data-nav-id="dashboard"]').click();history.back();`);
  await waitFor(cdp, `document.querySelector('[data-console]')?.dataset.pageWs==='business-projects' && !!document.querySelector('[data-new-business-work]')`, 'Home then rapid Back left the wrong mounted page');
  await evaluate(cdp, `location.hash='#page/business-assets'`);
  await waitFor(cdp, `document.querySelector('[data-console]')?.dataset.pageWs==='business-assets'`, 'Hash navigation did not open Files');
  await evaluate(cdp, `history.back()`);
  await waitFor(cdp, `document.querySelector('[data-console]')?.dataset.pageWs==='business-projects'`, 'Back from another page did not restore Projects');
  await evaluate(cdp, `window.qaBeforeLegacy=document.querySelector('[data-workspace-page-body]');location.hash='#ws/business-projects'`);
  await waitFor(cdp, `location.hash==='#ws/business-projects' && document.querySelector('[data-workspace-page-body]')!==window.qaBeforeLegacy && document.querySelector('[data-console]')?.dataset.pageWs==='business-projects'`, 'Legacy workspace route did not normalize');
  await evaluate(cdp, `document.querySelector('[data-new-business-work]').click();window.qaLegacyForm=document.querySelector('[data-business-editor]')`);
  await sleep(450);
  assert.ok(await evaluate(cdp, `!!window.qaLegacyForm && window.qaLegacyForm===document.querySelector('[data-business-editor]')`),'Legacy alias hash probe repeatedly remounted the editor');
  await evaluate(cdp, `document.querySelector('[data-business-cancel]').click()`);
  console.log('PASS rapid Home/Back, page history and stable legacy workspace routes');

  await evaluate(cdp, `const s=document.querySelector('[data-business-select]');s.value='occasionally-odd';s.dispatchEvent(new Event('change',{bubbles:true}));`);
  await waitFor(cdp, `document.querySelector('[data-business-select]')?.value==='occasionally-odd' && !document.querySelector('.business-switch-curtain')`, 'Commerce switch did not finish');
  assert.ok(!(await evaluate(cdp,`document.body.innerText`)).includes('UNSAVED continuity fixture'), 'A different business showed the prior draft');
  await evaluate(cdp, `document.querySelector('[data-nav-id="business-production"]').click()`);
  await waitFor(cdp, `document.querySelector('[data-po-files]')`, 'Production print analysis missing');
  await evaluate(cdp, `const f=document.querySelector('[data-po-costs]');f.elements.filament.value='37';f.requestSubmit();`);
  const sample=zip([['Metadata/slice_info.config','<config><plate><metadata key="index" value="1"/><metadata key="weight" value="75"/><metadata key="prediction" value="3600"/></plate></config>']]).toString('base64');
  await evaluate(cdp, `(function(){const file=new File([Uint8Array.from(atob(${JSON.stringify(sample)}),x=>x.charCodeAt(0))],'continuity-plate.3mf');const read=file.arrayBuffer.bind(file);const gate=new Promise(resolve=>window.qaReleaseFile=resolve);file.arrayBuffer=async()=>{await gate;return read()};const dt=new DataTransfer();dt.items.add(file);const input=document.querySelector('[data-po-files]');input.files=dt.files;input.dispatchEvent(new Event('change'));})()`);
  await evaluate(cdp, `(async()=>{const c=await ${coreExpression};c.store.save();return true})()`);
  assert.equal(await evaluate(cdp, `document.querySelector('[data-po-files]')?.disabled`),true,'A background update discarded an in-flight local file read');
  await evaluate(cdp, `window.qaReleaseFile()`);
  await waitFor(cdp, `document.querySelector('[data-po-results]')?.innerText.includes('continuity-plate.3mf') && !document.querySelector('[data-po-export]').disabled`, 'Plate analysis failed to finish after the background update');
  await evaluate(cdp, `(async()=>{const c=await ${coreExpression};c.store.save();return true})()`);
  assert.ok(await evaluate(cdp, `document.querySelector('[data-po-results]').innerText.includes('75.00 g')`),'Background update cleared calculated results');
  assert.equal(await evaluate(cdp, `document.querySelector('[data-po-costs]').elements.filament.value`),'37');
  console.log('PASS in-flight file read, calculated plate evidence and custom cost scenario survive background updates');
  await evaluate(cdp, `window.qaUnderlyingPrint=document.querySelector('[data-po-results]');location.hash='#ws/activity'`);
  await waitFor(cdp, `document.querySelector('.overlay[aria-label="Activity"]')`, 'Activity did not open as an overlay above commerce');
  await evaluate(cdp, `document.querySelector('.overlay-x[data-overlay-close]').click()`);
  await waitFor(cdp, `!document.querySelector('.overlay')`, 'Activity overlay did not close');
  assert.ok(await evaluate(cdp, `window.qaUnderlyingPrint===document.querySelector('[data-po-results]') && document.querySelector('[data-po-results]').innerText.includes('continuity-plate.3mf')`),'Closing an overlay destroyed underlying print analysis');
  console.log('PASS overlay close preserves the underlying print mount and evidence');

  await cdp.send('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:false});
  const capture=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(path.join(runDir,'print-continuity-390.png'),Buffer.from(capture.data,'base64'));
  await evaluate(cdp, `document.querySelector('[data-po-clear]').click()`);
  assert.ok(await evaluate(cdp, `!!document.querySelector('[data-workspace-updates-pending]') && !!document.querySelector('[data-preserve-workspace]')`),'Unsaved recalculated costs must remain protected after clearing files');
  await evaluate(cdp, `document.querySelector('[data-po-save]').click()`);
  await waitFor(cdp, `!document.querySelector('[data-workspace-updates-pending]') && !document.querySelector('[data-preserve-workspace]')`, 'Saving numeric preferences did not release background updates');
  assert.equal(await evaluate(cdp, `document.querySelector('[data-po-costs]').elements.filament.value`),'37','Saved scoped preferences did not survive the released refresh');
  console.log('PASS clearing files keeps unsaved costs; saving preferences releases updates with costs intact');
  await evaluate(cdp, `const s=document.querySelector('[data-business-select]');s.value='phantomforce';s.dispatchEvent(new Event('change',{bubbles:true}));`);
  await waitFor(cdp, `document.querySelector('[data-business-select]')?.value==='phantomforce' && !document.querySelector('.business-switch-curtain')`, 'Return switch did not complete');
  await evaluate(cdp, `document.querySelector('[data-workspace-access]').click()`);
  await waitFor(cdp, `document.querySelector('[data-access-print]')`, 'Workspace panel missing');
  await evaluate(cdp, `document.querySelector('[data-access-print]').click()`);
  await waitFor(cdp, `document.querySelector('[data-po-costs]')`, 'Local tool did not open');
  assert.equal(await evaluate(cdp, `document.querySelector('[data-po-costs]').elements.filament.value`),'25','Another business inherited saved cost preferences');
  assert.ok(!(await evaluate(cdp,`document.querySelector('[data-po-results]').innerText`)).includes('continuity-plate.3mf'),'Another business inherited the selected file');
  assert.deepEqual(cdp.errors,[],'Uncaught browser errors');
  console.log('PASS business switch clears transient analysis and keeps numeric preferences isolated');
  writeFileSync(path.join(runDir,'report.json'),JSON.stringify({ok:true,projectDraft:true,routeDeduplication:true,deferredUpdates:true,inFlightRead:true,plateEvidence:true,costScenario:true,businessIsolation:true},null,2));
  console.log(JSON.stringify({ok:true,report:path.join(runDir,'report.json')}));

} catch(error) {
  console.error(error.stack);
  try { console.log('Continuity diagnostic: '+JSON.stringify(await evaluate(cdp, `({url:location.href,form:!!document.querySelector('[data-business-editor]'),fixture:window.qaContinuity,buttonDisabled:document.querySelector('[data-new-business-work]')?.disabled})`))); } catch {}
  process.exitCode=1;
} finally {
  cdp?.close();await stop(chrome);server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
