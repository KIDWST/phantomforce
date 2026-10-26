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
const runDir = path.join(root, "tmp", "smart-print", stamp);
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



  await waitFor(cdp, `document.querySelector('[data-workspace-access]') && document.querySelector('[data-business-select]')?.options.length>=3`, 'Shell did not load');
  await evaluate(cdp, `document.querySelector('[data-workspace-access]').click()`);
  await waitFor(cdp, `document.querySelector('[data-access-print]')`, 'Workspace panel did not open');
  await evaluate(cdp, `document.querySelector('[data-access-print]').click()`);
  await waitFor(cdp, `document.querySelector('[data-po-folder]')`, 'Smart print tool did not open');
  assert.equal(await evaluate(cdp, `document.querySelector('[data-po-cost-details]').open`),false,'First-run analysis must not require an open manual cost form');
  const sliced=(grams,seconds)=>'<config><plate><metadata key="index" value="1"/><metadata key="weight" value="'+grams+'"/><metadata key="prediction" value="'+seconds+'"/><filament id="1" type="PLA" color="#000000" used_g="'+grams+'"/></plate></config>';
  const project=printer=>JSON.stringify({printer_model:printer,nozzle_diameter:['0.4'],filament_type:['PLA'],filament_colour:['#000000'],filament_settings_id:['Fixture PLA'],filament_vendor:['Fixture'],filament_cost:['3400']});
  const files=[{name:'fast.3mf',data:zip([['Metadata/slice_info.config',sliced(40,3600)],['Metadata/project_settings.config',project('P2S')]]).toString('base64')},{name:'slow.3mf',data:zip([['Metadata/slice_info.config',sliced(120,21600)],['Metadata/project_settings.config',project('X1 Carbon')]]).toString('base64')},{name:'unsliced.3mf',data:zip([['Metadata/project_settings.config',project('P1S')]]).toString('base64')}];
  files.push({...files[0],name:'fast-copy.3mf'});
  async function choose(folderFiles) {
    await evaluate(cdp, `(function(){const dt=new DataTransfer();for(const source of ${JSON.stringify(folderFiles)})dt.items.add(new File([source.data?Uint8Array.from(atob(source.data),x=>x.charCodeAt(0)):'ignored text'],source.name));const input=document.querySelector('[data-po-folder]');input.files=dt.files;input.dispatchEvent(new Event('change'));})()`);
    await waitFor(cdp, `document.querySelector('[data-po-status]')?.innerText.startsWith('Read ') && !document.querySelector('[data-po-export]').disabled`, 'Automatic folder scan did not finish');
  }
  await choose([...files,{name:'readme.txt'}]);
  const first=await evaluate(cdp, `({brief:document.querySelector('.po-brief').innerText,status:document.querySelector('[data-po-status]').innerText,formOpen:document.querySelector('[data-po-cost-details]').open})`);
  assert.match(first.brief,/Fastest and lightest saved plate/);assert.match(first.brief,/fast(?:-copy)?\.3mf/);assert.match(first.brief,/40\.00 g/);assert.match(first.brief,/1\.00 h/);
  assert.match(first.brief,/Slice unsliced\.3mf/);assert.match(first.status,/Ignored 1 other file/);assert.equal(first.formOpen,false);
  assert.ok(!first.brief.includes('$'),'Unverified preset prices became an automatic quote');
  assert.equal(await evaluate(cdp, `document.querySelectorAll('[aria-label="Automatic print comparison"] tbody tr').length`),2,'Duplicates or unsliced files became extra production plates');
  console.log('PASS folder selection produces fastest/lightest, duplicate exclusion, missing-slice action and useful facts without editing a form');
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:false});
  await evaluate(cdp, `document.querySelector('.po-brief').scrollIntoView({block:'start'})`);
  const screenshot=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(path.join(runDir,'automatic-brief-390.png'),Buffer.from(screenshot.data,'base64'));
  assert.ok(await evaluate(cdp,`document.querySelector('.workspace-access-dialog').scrollWidth <= document.querySelector('.workspace-access-dialog').clientWidth+2`),'Smart brief overflows the phone dialog');
  await evaluate(cdp, `document.querySelector('[data-po-cost-details]').open=true;document.querySelector('[data-po-costs]').elements.filament.value='73'`);
  await choose(files.slice(0,2));
  assert.equal(await evaluate(cdp, `document.querySelector('[data-po-costs]').elements.filament.value`),'73','Automatic file selection erased an optional unapplied refinement');
  assert.match(await evaluate(cdp,`document.querySelector('.po-next-action').innerText`),/different printer profiles/,'Mixed printer warning must precede optional price refinement');
  await evaluate(cdp, `document.querySelector('[data-po-costs]').elements.filament.value=''`);
  const many=Array.from({length:23},(_,index)=>({...files[0],name:'batch-'+String(index).padStart(2,'0')+'.3mf'}));
  await choose([...many,{name:'readme.txt'}]);
  assert.match(await evaluate(cdp,`document.querySelector('[data-po-status]').innerText`),/first 20 of 23/);
  assert.equal(await evaluate(cdp,`document.querySelector('[data-po-costs]').elements.filament.value`),'','Blank optional refinements were silently replaced');
  assert.match(await evaluate(cdp,`document.querySelector('.po-brief').innerText`),/fastest|lightest/i);
  assert.deepEqual(cdp.errors,[],'Uncaught browser errors');
  console.log('PASS optional refinements survive scans, invalid fields never block analysis, and folder limits report truncation');
  writeFileSync(path.join(runDir,'report.json'),JSON.stringify({ok:true,noFormFirstRun:true,folderScan:true,duplicates:true,unverifiedPricesExcluded:true,missingSliceAction:true,optionalDraftPreserved:true,limitsDisclosed:true},null,2));
  console.log(JSON.stringify({ok:true,report:path.join(runDir,'report.json')}));
} catch(error) { console.error(error.stack);process.exitCode=1; }
finally { cdp?.close();await stop(chrome);server.closeAllConnections();await new Promise(resolve=>server.close(resolve)); }
