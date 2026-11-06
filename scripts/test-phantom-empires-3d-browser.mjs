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
const runDir = path.join(root, "tmp", "empires-3d", stamp);

const chromePath = [process.env.CHROME_PATH, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean).find(existsSync);
assert.ok(chromePath, "Chrome is required for the 3D RTS playtest");
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
try {
  await ready(`${base}/health`);
  chrome = spawn(chromePath, ["--headless=new", `--remote-debugging-port=${debugPort}`, "--remote-allow-origins=*", `--user-data-dir=${path.join(os.tmpdir(), `phantomforce-business-qa-${process.pid}-${stamp}`)}`, "--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--disable-extensions", "--disable-background-networking", "--disable-component-update", "--no-first-run", "--no-default-browser-check", "about:blank"], { windowsHide: true, stdio: "ignore" });
  await ready(`http://127.0.0.1:${debugPort}/json/version`);
  const target = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" }).then((response) => response.json());
  cdp = connect(target.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");

  // Keep authored test scenarios repeatable while the shipped game remains randomized.
  await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:'Math.random=(()=>{let seed=12345;return()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);})();'});
  await cdp.send("Network.enable");
  await cdp.send("Network.setBlockedURLs",{urls:["https://*"]});
  await cdp.send("Emulation.setDeviceMetricsOverride",{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await cdp.send("Page.navigate",{url:`${base}/app/games/phantom-empires/index.html?v=2.1.0`});
  await waitFor(cdp,`window.__PhantomEmpiresTest`,"Game boot failed");
  await evaluate(cdp,`window.__PhantomEmpiresTest.start('sandbox')`);
  await sleep(1800);
  const diagnostics=await evaluate(cdp,`__PhantomEmpiresTest.renderer()`);
  assert.equal(diagnostics.engine,'Three.js WebGL');assert.ok(diagnostics.objects>75);assert.ok(diagnostics.triangles>10000);
  const initial=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(path.join(runDir,'initial.png'),Buffer.from(initial.data,'base64'));
  const projection=await evaluate(cdp,`(()=>{const t=__PhantomEmpiresTest,p=t.project(800,900),w=t.unproject(p.x,p.y);return Math.hypot(w.x-800,w.y-900);})()`);
  assert.ok(projection<.001,'3D projection and ground picking must agree');
  async function clickWorld(x,y,button='left'){
    const p=await evaluate(cdp,`__PhantomEmpiresTest.project(${x},${y})`);
    await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button,clickCount:1});
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x,y:p.y,button,clickCount:1});
  }
  await clickWorld(820,1000);
  assert.match(await evaluate(cdp,`document.querySelector('[data-selection-title]').textContent`),/Villager/);
  const wood=await evaluate(cdp,`__PhantomEmpiresTest.save().nodes.filter(n=>n.type==='food').find(n=>{const p=__PhantomEmpiresTest.project(n.x,n.y);return p.x>350&&p.x<1100&&p.y>280&&p.y<650&&__PhantomEmpiresTest.save().nodes.find(r=>r.id===PhantomEmpires3D.pickEntity(p.x,p.y))?.type==='food';})`);
  await clickWorld(wood.x,wood.y,'right');
  assert.equal(await evaluate(cdp,`__PhantomEmpiresTest.save().units.find(u=>u.id==='unit-4').order`),'gather');
  const assigned=await evaluate(cdp,`(()=>{const s=__PhantomEmpiresTest.save();return s.nodes.find(n=>n.id===s.units.find(u=>u.id==='unit-4').gatherNodeId);})()`);
  assert.equal(assigned.type,'food');assert.ok(Math.hypot(assigned.x-wood.x,assigned.y-wood.y)<=220,'Resource assignment respects the clicked cluster');
  await evaluate(cdp,`__PhantomEmpiresTest.advance(35)`);
  const gather=await evaluate(cdp,`__PhantomEmpiresTest.save().nodes.find(n=>n.id===${JSON.stringify(assigned.id)}).amount`);
  assert.ok(gather<assigned.amount,'A ground-picked order must actually gather a resource');
  // Select a worker at its current position and construct through the native command UI.
  await evaluate(cdp,`document.querySelector('[data-command-tab="realm"]').click();document.querySelector('[data-order-type="workers"]').click();document.querySelector('[data-command-tab="build"]').click()`);
  await evaluate(cdp,`document.querySelector('[data-order-action="build"][data-order-type="house"]').click()`);
  await clickWorld(440,820);
  await evaluate(cdp,`__PhantomEmpiresTest.advance(45)`);
  const built=await evaluate(cdp,`__PhantomEmpiresTest.save().buildings.find(b=>b.team==='player'&&b.type==='house'&&Math.abs(b.x-440)<1)`);
  assert.ok(built&&built.construction===1,'A selected villager must complete a placed house');
  const before=await evaluate(cdp,`__PhantomEmpiresTest.save().units.length`);
  await evaluate(cdp,`__PhantomEmpiresTest.train('worker');__PhantomEmpiresTest.advance(6)`);
  assert.ok(await evaluate(cdp,`__PhantomEmpiresTest.save().units.length`)>before,'Training must produce a real unit');
  for(const width of [1440,390]){
    await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:width===390?844:1000,deviceScaleFactor:1,mobile:width===390});
    await sleep(900);
    const capture=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    writeFileSync(path.join(runDir,`battlefield-${width}.png`),Buffer.from(capture.data,'base64'));
    assert.ok(await evaluate(cdp,`document.documentElement.scrollWidth<=innerWidth+1`),'Battlefield must fit the viewport');
  }
  await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
  await evaluate(cdp,`document.querySelector('[data-touch="army"]').click();document.querySelector('[data-touch="attack"]').click()`);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:200,y:320,radiusX:3,radiusY:3,force:1,id:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert.ok(await evaluate(cdp,`__PhantomEmpiresTest.save().units.some(u=>u.team==='player'&&u.type!=='worker'&&u.order==='attack-move')`),'A real touch tap must issue an army command');
  await evaluate(cdp,`document.querySelector('[data-pause]').click();document.querySelector('[data-renderer-toggle]').click()`);
  assert.equal(await evaluate(cdp,`__PhantomEmpiresTest.renderer().engine`),'Canvas2D compatibility');
  await evaluate(cdp,`document.querySelector('[data-renderer-toggle]').click();document.querySelector('[data-resume]').click()`);
  const saved=await evaluate(cdp,`JSON.parse(JSON.stringify(__PhantomEmpiresTest.save()))`);
  await evaluate(cdp,`__PhantomEmpiresTest.start('skirmish');__PhantomEmpiresTest.restore(${JSON.stringify(saved)})`);
  assert.equal(await evaluate(cdp,`__PhantomEmpiresTest.save().buildings.length`),saved.buildings.length);
  await evaluate(cdp,`__PhantomEmpiresTest.advance(70)`);
  assert.ok(await evaluate(cdp,`__PhantomEmpiresTest.save().units.filter(u=>u.team==='enemy').length`)>3,'AI produces real rival forces');

  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await evaluate(cdp,`document.querySelector('[data-command-tab="realm"]').click();document.querySelector('[data-order-type="age"]').click()`);
  assert.equal(await evaluate(cdp,`__PhantomEmpiresTest.save().age`),4,'The final age must be reachable through its actual UI');
  await sleep(400);
  const zoomBefore=await evaluate(cdp,`__PhantomEmpiresTest.unproject(700,400)`);
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:700,y:400,deltaX:0,deltaY:-120});
  const zoomAfter=await evaluate(cdp,`__PhantomEmpiresTest.unproject(700,400)`);
  assert.ok(Math.hypot(zoomAfter.x-zoomBefore.x,zoomAfter.y-zoomBefore.y)<.01,'Zoom stays anchored beneath the cursor');
  const fight=await evaluate(cdp,`(()=>{const s=JSON.parse(JSON.stringify(__PhantomEmpiresTest.save()));const soldier=s.units.find(u=>u.type==='sword'&&u.team==='player');const home=s.buildings.find(b=>b.team==='enemy'&&b.type==='citadel');soldier.x=home.x-30;soldier.y=home.y;soldier.targetId=home.id;soldier.order='attack';soldier.cooldown=0;home.hp=30;s.units=[soldier];__PhantomEmpiresTest.restore(s);__PhantomEmpiresTest.advance(4);return __PhantomEmpiresTest.snapshot();})()`);
  assert.equal(fight.phase,'result','Actual combat destroying the rival citadel ends the match');
  assert.match(await evaluate(cdp,`document.querySelector('[data-result-title]').textContent`),/Victory/);
  await evaluate(cdp,`(()=>{const s=${JSON.stringify(saved)};const attacker=s.units.find(u=>u.team==='enemy'&&u.type==='sword');const home=s.buildings.find(b=>b.team==='player'&&b.type==='citadel');attacker.x=home.x+25;attacker.y=home.y;attacker.targetId=home.id;attacker.order='attack';attacker.cooldown=0;home.hp=1;s.units=[attacker];__PhantomEmpiresTest.restore(s);__PhantomEmpiresTest.advance(4);})()`);
  assert.equal(await evaluate(cdp,`__PhantomEmpiresTest.snapshot().phase`),'result','Defeat must also finish the match');
  assert.doesNotMatch(await evaluate(cdp,`document.querySelector('[data-result-title]').textContent`),/Victory/);


  await evaluate(cdp,`__PhantomEmpiresTest.restore(${JSON.stringify(saved)});__PhantomEmpiresTest.selectArmy()`);
  await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:false});
  await clickWorld(1100,900,'right');
  const formation=await evaluate(cdp,`__PhantomEmpiresTest.save().units.filter(u=>u.team==='player'&&u.type!=='worker').map(u=>({x:u.targetX,y:u.targetY,id:u.targetId}))`);
  assert.ok(formation.length>=2);
  // Native mouse client coordinates are integer pixels; allow one ground-pixel rounding error.
  assert.ok(Math.abs(formation.reduce((s,p)=>s+p.x,0)/formation.length-1100)<2,JSON.stringify(formation));
  assert.ok(Math.abs(formation.reduce((s,p)=>s+p.y,0)/formation.length-900)<2);
  assert.ok(formation.every(slot=>slot.id===null),'Army ground movement cannot become an attack on resource nodes');
  const economy=await evaluate(cdp,`(()=>{
    const s=${JSON.stringify(saved)};const worker=s.units.find(u=>u.team==='player'&&u.type==='worker');
    worker.x=900;worker.y=1000;worker.order='gather';worker.carry=0;worker.carryType=null;worker.gatherType='wood';worker.gatherNodeId='node-last';worker.targetId='node-last';
    s.units=[worker];s.resources.wood=0;
    s.nodes=[{id:'node-last',type:'wood',x:900,y:1000,amount:1,max:1,r:30},{id:'node-next',type:'wood',x:930,y:1000,amount:200,max:200,r:30}];
    s.buildings.push({id:'building-camp',type:'lumbercamp',team:'player',x:800,y:1000,hp:430,maxHp:430,construction:1,cooldown:0,flash:0});
    __PhantomEmpiresTest.restore(s);__PhantomEmpiresTest.advance(1.5);const first=JSON.parse(JSON.stringify(__PhantomEmpiresTest.save()));
    __PhantomEmpiresTest.advance(12);const after=__PhantomEmpiresTest.save();
    return {firstDeposit:first.resources.wood,total:after.resources.wood,next:after.nodes.find(n=>n.id==='node-next')?.amount,carry:after.units[0].carry,type:after.units[0].gatherType};
  })()`);
  assert.ok(economy.firstDeposit>=1,'Villager uses the nearby completed lumber camp');
  assert.ok(economy.total>1&&economy.next<200,'Depleted deposits automatically retarget the next wood source');
  assert.ok(economy.carry<=24+1e-7&&economy.type==='wood','Carrying capacity and resource identity are preserved');

  const switched=await evaluate(cdp,`(()=>{
    const s=JSON.parse(JSON.stringify(__PhantomEmpiresTest.save()));const w=s.units[0];w.x=800;w.y=1000;w.carry=10;w.carryType='wood';w.order='gather';w.gatherType='wood';s.resources.wood=0;s.resources.food=0;
    s.nodes.push({id:'node-food-switch',type:'food',x:800,y:900,amount:200,max:200,r:21});__PhantomEmpiresTest.restore(s);return true;
  })()`);
  await evaluate(cdp,`document.querySelector('[data-command-tab="realm"]').click();document.querySelector('[data-order-type="workers"]').click()`);
  await clickWorld(800,900,'right');
  await evaluate(cdp,`__PhantomEmpiresTest.advance(12)`);
  const switchedState=await evaluate(cdp,`__PhantomEmpiresTest.save()`);
  assert.ok(Math.abs(switchedState.resources.wood-10)<1e-7,'Switching resource orders deposits the old cargo as its original resource');
  assert.ok(switchedState.resources.food>0,'The villager then gathers and deposits the newly ordered resource');
  assert.deepEqual(cdp.errors,[],'Uncaught browser errors');
  const report={ok:true,diagnostics,projectionError:projection,checks:['WebGL rendering','ground picking','selection','resource gathering','construction','training','AI production','save restore','compatibility renderer','desktop and mobile','age advancement','cursor-anchored zoom','combat victory','combat defeat','touch army orders','nearby drop-off deposit','resource depletion retargeting','carry-capacity conservation','resource-switch cargo conservation','actual centered army orders'],runDir};
  writeFileSync(path.join(runDir,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
} catch(error){
  let text;try{text=await evaluate(cdp,`document.body.innerText`);}catch{}
  writeFileSync(path.join(runDir,'failure.json'),JSON.stringify({error:error.stack,text,browserErrors:cdp?.errors},null,2));
  console.error(error.stack);console.error(text);process.exitCode=1;
} finally {cdp?.close();await stop(chrome);server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
