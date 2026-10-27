import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Disposable browser, synthetic records, actual production modules; no private data.
const root = fileURLToPath(new URL("../", import.meta.url));
const runDir = path.join(root, "tmp/print-decision-lab", new Date().toISOString().replace(/[:.]/g, "-"));
mkdirSync(runDir, { recursive: true });
const chromePath = [process.env.CHROME_PATH, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean).find(existsSync);
assert.ok(chromePath, "Chrome required for print lab browser verification");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const fixture = { tenant_id: "occasionally-odd", settings: { currency: "USD", costsConfirmed: true, costs: { filament: 15, machine: 1, labor: 20, failure: .1, hourly: 10 } },
  files: [
    { sha256: "a".repeat(64), capturedAt: "2026-10-25T10:00:00Z", metadata: { name: "first.3mf", projectTitle: "Synthetic custom sign", printer: "Bambu Lab P1S", plates: [{ index: "1", grams: 142.87, seconds: 14963, objectCount: 3, supportUsed: false }] } },
    { sha256: "b".repeat(64), capturedAt: "2026-10-26T10:00:00Z", metadata: { name: "second.3mf", projectTitle: "Synthetic custom sign", printer: "Bambu Lab P2S", plates: [{ index: "1", grams: 155.67, seconds: 14757, objectCount: 4, supportUsed: false }] } }
  ], workflow: { recipes: [], planning: { printers: [{ id: "p2s", label: "Bambu P2S", model: "P2S", hoursPerDay: 24 }, { id: "p1s", label: "Bambu P1S", model: "P1S", hoursPerDay: 24 }], finishingHoursPerDay: 2 } } };
const server = createServer((req, res) => {
  const pathname = new URL(req.url, "http://127.0.0.1").pathname;
  if (pathname === "/qa") {
    res.writeHead(200, { "content-type": "text/html" });
    return res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app/commerce-workspace.css"><link rel="stylesheet" href="/app/bambu-print-feed.css"><style>body{margin:0;background:#10171b;color:#ecf4ee;font-family:Arial,sans-serif}main{box-sizing:border-box;max-width:1180px;margin:auto;padding:24px}*{box-sizing:border-box}</style></head><body><main id="root" class="bpf-feed"></main><script type="module">const {printDecisionLabView}=await import('/app/js/print-decision-lab.js');window.fixture=${JSON.stringify(fixture)};window.mount=(value=window.fixture,open=true)=>document.querySelector('#root').innerHTML=printDecisionLabView(value,{open});window.__fetches=0;window.fetch=()=>{window.__fetches++;throw Error('Unexpected network request')};window.__stores=0;Storage.prototype.setItem=()=>{window.__stores++;throw Error('Unexpected storage write')};window.mount();window.ready=true;</script></body></html>`);
  }
  const target = path.resolve(root, "." + decodeURIComponent(pathname));
  if (!target.startsWith(path.join(root, "app") + path.sep)) { res.writeHead(403); return res.end(); }
  try { if (!statSync(target).isFile()) throw Error(); res.writeHead(200, { "content-type": path.extname(target) === ".js" ? "text/javascript" : "text/css" }); res.end(readFileSync(target)); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const debugPort = await new Promise(resolve => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const port = s.address().port; s.close(() => resolve(port)); }); });
const chrome = spawn(chromePath, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${path.join(runDir, "profile")}`, "about:blank"], { stdio: "ignore", windowsHide: true });
let socket, cdp; const errors = []; let checks = 0;
function check(fn) { fn(); checks++; }
try {
  let ready = false;
  for (let i = 0; i < 100 && !ready; i++) { try { ready = (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok; } catch {} if (!ready) await sleep(100); }
  assert.ok(ready, "Disposable Chrome did not start");
  const target = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" }).then(r => r.json());
  socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise((resolve, reject) => { socket.addEventListener("open", resolve); socket.addEventListener("error", reject); });
  const pending = new Map(); let sequence = 0;
  socket.addEventListener("message", event => { const message = JSON.parse(String(event.data)); if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text); const item = pending.get(message.id); if (!item) return; pending.delete(message.id); clearTimeout(item.timer); message.error ? item.reject(Error(message.error.message)) : item.resolve(message.result); });
  cdp = { send(method, params = {}) { const id = ++sequence; return new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout ${method}`)); }, 20000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })); }); } };
  const evaluate = async expression => { const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result?.value; };
  await cdp.send("Page.enable"); await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1360, height: 1100, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/qa` });
  for (let i = 0; i < 120; i++) { if (await evaluate("window.ready===true")) break; await sleep(100); }
  check(() => assert.equal(errors.length, 0));
  const body = await evaluate("document.body.innerText");
  for (const expected of [/Print lab/, /12\.8 g filament/, /3m 26s/, /20 g extra PLA/, /2\.5 min \/ printer-hour/, /Part counts differ/, /Printer models differ/, /possible relation/i, /saved planning assumptions/i]) check(() => assert.match(body, expected));
  check(() => assert.ok(!/\bwinner\b|\buse this\b/i.test(body)));
  await evaluate("document.querySelector('.pdl-lab>summary').focus()");
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r" });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await sleep(100);
  assert.equal(await evaluate("document.querySelector('.pdl-lab').open"), false); checks++;
  await evaluate("window.mount()");
  for (const [label, width, height] of [["desktop", 1360, 1100], ["mobile", 390, 844]]) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });
    await sleep(100);
    const dimensions = await evaluate("({scroll:document.documentElement.scrollWidth,width:innerWidth})");
    check(() => assert.ok(dimensions.scroll <= dimensions.width + 1, `${label} page overflow ${JSON.stringify(dimensions)}`));
    const shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    writeFileSync(path.join(runDir, `print-lab-${label}.png`), Buffer.from(shot.data, "base64"));
  }
  await evaluate("var injected=structuredClone(window.fixture);injected.files.forEach(file=>file.metadata.projectTitle='<img src=x onerror=window.injected=true>');window.mount(injected)");
  assert.equal(await evaluate("document.querySelectorAll('#root img,#root script').length"), 0); checks++;
  assert.equal(await evaluate("window.injected===true"), false); checks++;
  await evaluate("window.mount({...window.fixture,tenant_id:'client-chicagoshots'})");
  assert.equal(await evaluate("document.querySelector('#root').textContent"), ""); checks++;
  await evaluate("var missing=structuredClone(window.fixture);missing.files.forEach(file=>file.metadata.plates=[{grams:null,seconds:null}]);window.mount(missing)");
  assert.match(await evaluate("document.querySelector('#root').innerText"), /incomplete|Unknown/); checks++;
  assert.equal(await evaluate("window.__fetches+window.__stores"), 0); checks++;
  check(() => assert.equal(errors.length, 0, errors.join("\n")));
  console.log(`PASS print lab browser — ${checks} checks: mismatch, arithmetic, keyboard,390px, escaping, scope and no writes`);
  console.log(`Screenshots: ${runDir}`);
} finally { socket?.close(); chrome.kill(); await new Promise(resolve => server.close(resolve)); }
