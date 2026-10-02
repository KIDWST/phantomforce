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
const runDir = path.join(root, "tmp", "business-workspaces", stamp);
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
  await waitFor(cdp, `document.querySelector('[data-business-select]')?.options.length >= 3`, "Business switcher did not render");
  await evaluate(cdp, `(async()=>{const {store}=await ${coreExpression}; for(const ws of ${JSON.stringify(businesses.map((business) => business.id))}) { store.state.leads.push({id:'qa-lead',ws,name:'PRIVATE-'+ws,company:'QA customer',status:'new'}); store.state.media.push({id:'qa-media',ws,title:'PRIVATE-ASSET-'+ws,status:'draft'}); } store.save(); return true;})()`);
  for (const width of [1440, 390, 320]) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: width <= 390 ? 844 : 1000, deviceScaleFactor: 1, mobile: width <= 390 });
    for (const business of businesses) {
      await waitFor(cdp, `document.querySelector('[data-business-select]') && !document.querySelector('[data-business-select]').disabled`, "Switcher unavailable before transition");
      const switching = await evaluate(cdp, `(function(){const node=[...document.querySelectorAll('[data-business-select]')].find(x=>x.getBoundingClientRect().width>0); if(!node)return {visible:false}; const r=node.getBoundingClientRect(); const before=node.value; if(before!==${JSON.stringify(business.id)}) { node.value=${JSON.stringify(business.id)}; node.dispatchEvent(new Event('change',{bubbles:true})); } return {visible:true,before,rect:{x:r.x,y:r.y,width:r.width,height:r.height}};})()`);
      assert.equal(switching.visible, true, `${width}px: global business switcher must be visible`);
      await waitFor(cdp, `(async()=>{const node=document.querySelector('[data-business-select]');if(!node || node.value!==${JSON.stringify(business.id)} || document.querySelector('.business-switch-curtain'))return false;const core=await ${coreExpression};return core.currentWs()===${JSON.stringify(business.id)};})()`, `${business.name} did not finish switching`);
      await sleep(400);
      const audit = await evaluate(cdp, `(async()=>{const c=await ${coreExpression};const key='qa-business-draft'; const existing=c.workspaceStorageGetItem(key,{migrateGlobal:false}); if(!existing)c.workspaceStorageSetItem(key,'draft-'+c.currentWs()); const select=[...document.querySelectorAll('[data-business-select]')].find(n=>n.getBoundingClientRect().width>0);return {business:c.currentWs(),tenant:c.currentTenantId(),selection:select?.value,options:[...select.options].map(n=>({id:n.value,name:n.textContent.trim()})),privateRecords:c.visible(c.store.state.leads).map(n=>n.name),assets:c.visible(c.store.state.media).map(n=>n.title),draft:c.workspaceStorageGetItem(key),width:innerWidth,scrollWidth:document.documentElement.scrollWidth,heading:[...document.querySelectorAll('h1,h2')].map(n=>n.textContent.trim()).filter(Boolean),text:document.body.innerText,nav:[...document.querySelectorAll('[data-nav]')].map(n=>n.textContent.trim()).filter(Boolean),switchCount:performance.getEntriesByType('navigation').length};})()`);
      assert.equal(audit.business, business.id);
      assert.equal(audit.tenant, business.id);
      assert.equal(audit.selection, business.id);
      assert.deepEqual(audit.privateRecords, [`PRIVATE-${business.id}`]);
      assert.deepEqual(audit.assets, [`PRIVATE-ASSET-${business.id}`]);
      assert.equal(audit.draft, `draft-${business.id}`);
      assert.ok(audit.scrollWidth <= width + 2, `${business.name} ${width}px overflow: ${audit.scrollWidth}`);
      assert.ok(audit.text.includes(business.name), `${business.name} brand missing`);
      for (const other of businesses.filter((item) => item.id !== business.id)) assert.ok(!audit.text.includes(`PRIVATE-${other.id}`), "Other company customer appeared on screen");
      const screenshot = path.join(runDir, `${business.id}-${width}.png`);
      const capture = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      writeFileSync(screenshot, Buffer.from(capture.data, "base64"));
      const { text, ...safeAudit } = audit;
      results.push({ ...safeAudit, screenshot });
      console.log(`PASS ${business.name} ${width}px: switch, branding, customer/asset isolation, draft, layout`);
      if (width === 1440) {
        if (business.id === "occasionally-odd") {
          assert.ok(audit.text.includes("empty workroom preview"), "Offline commerce must explicitly identify read-only preview");
          const disabled = await evaluate(cdp, `[...document.querySelectorAll('[data-cw-edit]')].every(button=>button.disabled)`);
          assert.ok(disabled, "Offline commerce cannot fabricate persisted inventory or orders");
          await evaluate(cdp, `location.hash='#page/business-campaigns'`);
          await waitFor(cdp, `document.querySelector('[data-business-hub="occasionally-odd"]')`, "Scoped campaign planner did not open");
        }
        if (business.id === "phantomforce") {
          await evaluate(cdp, `document.querySelector('[data-business-home]').click()`);
          await waitFor(cdp, `document.querySelector('[data-business-hub="phantomforce"]')`, "PhantomForce project hub did not open");
        }
        await evaluate(cdp, `document.querySelector('[data-new-business-work]').click()`);
        await waitFor(cdp, `document.querySelector('[data-business-editor]')`, `${business.name} editor did not open`);
        await evaluate(cdp, `(function(){const form=document.querySelector('[data-business-editor]');form.elements.title.value=${JSON.stringify(`PRIVATE-WORK-${business.id}`)};form.elements.customer.value=${JSON.stringify(`CUSTOMER-${business.id}`)};form.elements.notes.value='A local browser QA draft';if(form.elements.rightsStatus)form.elements.rightsStatus.value='original';form.requestSubmit();return true;})()`);
        await waitFor(cdp, `(async()=>{const c=await ${coreExpression};return c.store.state.businessWorkItems.some(item=>item.ws===${JSON.stringify(business.id)} && item.title===${JSON.stringify(`PRIVATE-WORK-${business.id}`)});})()`, `${business.name} draft was not saved`);
        console.log(`PASS ${business.name}: actual work-item form saved only to the active business`);
      } else {
        const work = await evaluate(cdp, `(async()=>{const c=await ${coreExpression};return c.visible(c.store.state.businessWorkItems).map(item=>item.title);})()`);
        assert.deepEqual(work, [`PRIVATE-WORK-${business.id}`], "Saved work must survive switching and remain business scoped");
      }
      if (business.id === "client-chicagoshots" && width === 1440) {
        await evaluate(cdp, `(async()=>{const c=await ${coreExpression};c.store.state.bookings=${JSON.stringify(businesses.map((business) => business.id))}.map(ws=>({id:'qa-booking',ws,client:'PRIVATE-BOOKING-'+ws,type:'Planning call',status:'draft',when:new Date(Date.now()+86400000).toISOString(),duration:30,location:'Studio',copy:'Private planning draft'}));c.store.save();location.hash='#page/bookings';return true;})()`);
        await waitFor(cdp, `document.querySelector('[data-act="remove"][data-id="qa-booking"]')`, "Booking action did not render");
        const bookingText = await evaluate(cdp, `document.body.innerText`);
        assert.ok(!bookingText.includes("PRIVATE-BOOKING-phantomforce"));
        assert.ok(!bookingText.includes("PRIVATE-BOOKING-occasionally-odd"));
        await evaluate(cdp, `document.querySelector('[data-act="remove"][data-id="qa-booking"]').click()`);
        const remaining = await evaluate(cdp, `(async()=>{const c=await ${coreExpression};return c.store.state.bookings.map(item=>item.ws).sort();})()`);
        assert.deepEqual(remaining, ["occasionally-odd", "phantomforce"], "Deleting a booking must preserve identical IDs in other businesses");
        console.log("PASS booking collision: actual remove action preserves both other businesses");
      }
      // Reload once for each business and viewport and prove selection persists.
      const priorDocument = await evaluate(cdp, "performance.timeOrigin");
      await cdp.send("Page.reload", { ignoreCache: true });
      await waitFor(cdp, `performance.timeOrigin !== ${priorDocument} && document.querySelector('[data-business-select]')?.value === ${JSON.stringify(business.id)}`, `${business.name} selection lost on reload`);
      const savedWork = await evaluate(cdp, `(async()=>{const c=await ${coreExpression};return c.visible(c.store.state.businessWorkItems).map(item=>item.title);})()`);
      assert.deepEqual(savedWork, [`PRIVATE-WORK-${business.id}`], `${business.name} work was lost or mixed after reload`);
    }
  }
  assert.deepEqual(cdp.errors, [], "Uncaught browser errors");
  const report = { ok: true, cases: results.length, api: "static-only; all API requests disabled", results };
  writeFileSync(path.join(runDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: true, cases: results.length, report: path.join(runDir, "report.json") }));
} catch (error) {
  let diagnostic;
  try { diagnostic = await evaluate(cdp, `(async()=>{const c=await ${coreExpression};return {url:location.href,active:c.currentWs(),role:c.ctx.session?.role,selection:document.querySelector('[data-business-select]')?.value,disabled:document.querySelector('[data-business-select]')?.disabled,handler:typeof document.querySelector('[data-business-select]')?.onchange,curtain:document.querySelector('.business-switch-curtain')?.textContent,text:document.body.innerText.slice(0,1800)};})()`); } catch {}
  writeFileSync(path.join(runDir, "failure.json"), JSON.stringify({ error: error.stack, diagnostic, results, browserErrors: cdp?.errors }, null, 2));
  console.error(JSON.stringify(diagnostic));
  console.error(error.stack);
  process.exitCode = 1;
} finally {
  cdp?.close();
  await stop(chrome);
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
