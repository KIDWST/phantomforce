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
const runDir = path.join(root, "tmp", "print-quotes", stamp); mkdirSync(runDir, { recursive: true });
const chromePath = [process.env.CHROME_PATH, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean).find(existsSync);
assert.ok(chromePath, "Chrome is required for Print quote browser QA");
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

const { tsImport } = await import('tsx/esm/api');
const dataRoot = path.join(runDir, 'isolated-data');
process.env.PHANTOMFORCE_BUSINESS_COMMERCE_DIR=path.join(dataRoot,'commerce');
const { getPrintWorkflow, executePrintWorkflow }=await tsImport('../server/src/business-workspaces/print-quote-workflow.ts',import.meta.url);
const { randomUUID }=await import('node:crypto');
const tenant='occasionally-odd', fileHash='c'.repeat(64), runId='a'.repeat(64), secondHash='d'.repeat(64), now=new Date().toISOString();
const metadata={name:'synthetic.3mf',projectTitle:'Custom display',printer:'Bambu Lab P2S',plates:[{index:'1',grams:100,seconds:3600,objectCount:45,supportUsed:true,outsidePlate:false,warnings:[],filaments:[{id:'1',type:'PLA',color:'#000000',grams:100}]}]};
const source={settings:{paused:false,currency:'USD',costsConfirmed:true,costs:{filament:25,machine:1,labor:20,minutes:10,packaging:1,fixedFee:0,failure:.1,fee:0,margin:.3,hourly:10,revenue:25}},files:[{sha256:fileHash,metadata},{sha256:secondHash,metadata:{...metadata,name:'new-reslice.3mf',projectTitle:'Custom display reslice'}}],runs:Array.from({length:10},(_,i)=>({id:i===0?runId:(i.toString(16).repeat(64)),fileHash,observedAt:now,evidence:'prepared'}))};
let workflow=await getPrintWorkflow(source,dataRoot);
await executePrintWorkflow(source,{commandId:randomUUID(),expectedRevision:workflow.revision,type:'save-planning',payload:{printers:[{id:'p2s',label:'P2S',model:'Bambu Lab P2S',hoursPerDay:24},{id:'p1s',label:'P1S',model:'Bambu Lab P1S',hoursPerDay:24}],workDays:[0,1,2,3,4,5,6]}},'qa',dataRoot);
const calls=[];let holdFeed=false,releaseFeed=null;
const commerceVersion=readFileSync(path.join(root,'app/js/commerce-workspace.js'),'utf8').match(/store\.js\?v=([^"']+)/)?.[1];
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1'),pathname=url.pathname;
 const json=(body,status=200)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(body));};
 if(pathname==='/health')return json({ok:true});
 if(pathname.startsWith('/api/')){
  calls.push({pathname,business:req.headers['x-phantomforce-business'],authorized:req.headers.authorization==='Bearer isolated-browser-fixture',method:req.method});
  if(req.headers.authorization!=='Bearer isolated-browser-fixture')return json({ok:false,error:'auth_required'},401);
  if(pathname==='/api/business-workspaces/commerce'){const t=req.headers['x-phantomforce-business'];return json({ok:true,tenant_id:t,canManage:true,state:{tenantId:t,revision:0,products:[],materials:[],printers:[],orders:[],jobs:[],customers:[],channels:[],outbox:[]},summary:{}});}
  if(pathname==='/api/business-workspaces/print-runs' && req.method==='GET'){
   if(holdFeed){holdFeed=false;await new Promise(resolve=>releaseFeed=resolve);}
   return json({ok:true,tenant_id:tenant,canManage:true,revision:1,settings:source.settings,collector:{connected:true,state:'watching',lastScanAt:now,lastCaptureAt:now,coverage:'Prepared packages only; printer completion is not connected.'},runs:source.runs.map(row=>({...row,tenantId:tenant})),files:source.files.map(row=>({...row,tenantId:tenant,bytes:100,mapping:null,analysis:{plates:[]}})),summary:{receipts:10,uniqueFiles:2,completed:0,failed:0},workflow:await getPrintWorkflow(source,dataRoot)});
  }
  if(pathname==='/api/business-workspaces/print-runs/workflow/commands'){
   const chunks=[];for await(const chunk of req)chunks.push(chunk);const input=JSON.parse(Buffer.concat(chunks).toString());calls.at(-1).input=input;
   try{return json({ok:true,tenant_id:tenant,...await executePrintWorkflow(source,input,'isolated-browser-operator',dataRoot)});}catch(error){return json({ok:false,error:error.message},error.statusCode||409);}
  }
  return json({ok:false,error:'unavailable'},404);
 }
 if(pathname==='/qa'){res.writeHead(200,{'content-type':'text/html'});return res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app/commerce-workspace.css"><style>body{margin:0;background:#241e23}main{max-width:1400px;margin:auto}</style></head><body><main id="root"></main><script type="module">const oldInterval=window.setInterval;window.__polls=[];window.setInterval=(fn,ms)=>{if(ms===20000)window.__polls.push(fn);return oldInterval(fn,ms)};const store=await import('/app/js/store.js?v=${commerceVersion}');store.session.set({token:'isolated-browser-fixture'});window.account=store.session;window.scope='occasionally-odd';const {renderCommerceWorkspace}=await import('/app/js/commerce-workspace.js');window.mount=(section='production',business='occasionally-odd')=>{window.scope=business;window.surface=renderCommerceWorkspace(document.querySelector('#root'),{businessId:business,initialSection:section,getActiveBusinessId:()=>window.scope});};window.mount();</script></body></html>`);}
 if(!pathname.startsWith('/app/')){res.writeHead(404);return res.end();}
 const target=path.resolve(root,'.'+decodeURIComponent(pathname));if(!target.startsWith(path.join(root,'app')+path.sep)){res.writeHead(403);return res.end();}
 try{const mime={'.js':'text/javascript','.css':'text/css','.html':'text/html'}[path.extname(target)]||'application/octet-stream';res.writeHead(200,{'content-type':mime,'cache-control':'no-store'});res.end(readFileSync(target));}catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port,base=`http://127.0.0.1:${port}`;
const debugServer=createServer();await new Promise(resolve=>debugServer.listen(0,'127.0.0.1',resolve));const debugPort=debugServer.address().port;await new Promise(resolve=>debugServer.close(resolve));
let chrome,cdp;
try{
 chrome=spawn(chromePath,['--headless=new',`--remote-debugging-port=${debugPort}`,'--remote-allow-origins=*',`--user-data-dir=${path.join(os.tmpdir(),`pf-quote-qa-${process.pid}-${stamp}`)}`,'--disable-gpu','--disable-extensions','--disable-background-networking','--no-first-run','--no-default-browser-check','about:blank'],{windowsHide:true,stdio:'ignore'});
 await ready(`http://127.0.0.1:${debugPort}/json/version`);const target=await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`,{method:'PUT'}).then(r=>r.json());cdp=connect(target.webSocketDebuggerUrl);
 await cdp.send('Page.enable');await cdp.send('Runtime.enable');await cdp.send('Network.enable');await cdp.send('Network.setBlockedURLs',{urls:['https://*']});await cdp.send('Emulation.setDeviceMetricsOverride',{width:1360,height:1024,deviceScaleFactor:1,mobile:false});await cdp.send('Page.navigate',{url:base+'/qa'});
 await waitFor(cdp,"document.querySelector('.bpf-workflow') && document.querySelector('[data-po-folder]')",'Actual commerce mount did not include quote workflow');
 assert.match(await evaluate(cdp,"document.querySelector('.bpf-workflow').innerText"),/0 \/ 10/);
 await evaluate(cdp,`document.querySelector('[data-pq-from-run]').click();var f=document.querySelector('[data-pq-recipe]');f.elements.name.value='Display recipe';f.elements.unitsPerBatch.value='2';f.elements.finishingMinutesPerBatch.value='12';f.elements.hardwareCostPerBatch.value='3';f.elements.packagingCostPerUnit.value='.5';f.elements.completeProduct.checked=true;f.requestSubmit();`);
 await waitFor(cdp,"document.querySelector('[data-pq-quote]')",'Recipe was not saved');
 workflow=await getPrintWorkflow(source,dataRoot);assert.equal(workflow.recipes.length,1);assert.equal(workflow.recipes[0].unitsPerBatch,2);assert.deepEqual(workflow.recipes[0].compatiblePrinterIds,[],'Model compatibility must not be assumed from the second printer');
 await evaluate(cdp,`document.querySelector('[data-bpf-detail=pq-link]').open=true;var f=document.querySelector('[data-pq-link]');f.elements.fileHash.value='${secondHash}';f.requestSubmit();`);await waitFor(cdp,"document.querySelector('[data-pq-quote] select[name=fileHash]')?.options.length===2",'Explicit reslice was not linked');
 workflow=await getPrintWorkflow(source,dataRoot);assert.ok(workflow.recipes[0].linkedFileHashes.includes(secondHash));
 await evaluate(cdp,"var f=document.querySelector('[data-pq-quote]');f.elements.quantity.value='5';f.requestSubmit();");
 await waitFor(cdp,"document.querySelector('[data-pq-result]')",'Quote draft was not saved');
 workflow=await getPrintWorkflow(source,dataRoot);assert.equal(workflow.quotes[0].batches,3);assert.equal(workflow.quotes[0].producedUnits,6);assert.equal(workflow.quotes[0].delivery.readyDate,null);assert.match(await evaluate(cdp,"document.querySelector('[data-pq-result]').innerText"),/Not planned/);
 console.log('PASS actual commerce mount, captured-project recipe seeding, full-batch quantity quote and unknown-capacity guard');
 await evaluate(cdp,"document.querySelector('[data-bpf-detail=pq-planning]').open=true;var f=document.querySelector('[data-pq-planning]');f.elements.finishingHoursPerDay.value='2';f.elements.manualQueueHours.value='8';f.elements.manualFinishingQueueHours.value='0';f.requestSubmit();");
 await waitFor(cdp,"document.querySelector('.bpf-notice')?.innerText.includes('Capacity calendar saved')",'Calendar was not saved');
 workflow=await getPrintWorkflow(source,dataRoot);assert.equal(workflow.planning.printers.length,2);assert.equal(workflow.planning.printers[0].hoursPerDay,24);
 await evaluate(cdp,"document.querySelector('[data-pq-revise]').click()");await waitFor(cdp,"document.querySelector('[data-pq-result]')?.innerText.includes('v2')",'Frozen quote revision missing');
 workflow=await getPrintWorkflow(source,dataRoot);assert.equal(workflow.quotes.length,2);assert.equal(workflow.quotes[0].delivery.status,'planned');assert.equal(workflow.quotes[1].delivery.status,'unavailable');assert.equal(workflow.quotes[0].delivery.printerLoads.length,1,'P2S slice must not silently use P1S');
 await evaluate(cdp,"var f=document.querySelector('[data-pq-quote]');f.elements.quantity.value='2';f.requestSubmit();");await waitFor(cdp,"document.querySelector('[data-pq-result]')?.innerText.includes('2 units')",'Single batch quote missing');
 const frozen=(await getPrintWorkflow(source,dataRoot)).quotes[0];assert.equal(frozen.batches,1);
 // Synthetic future occurrences happen after the frozen estimate, never retroactive calibration.
 source.runs.forEach(run=>{run.observedAt=new Date().toISOString();});
 await evaluate(cdp,"document.querySelector('[data-bpf-detail=pq-actuals]').open=true;document.querySelector('[data-pq-timer]').click()");await waitFor(cdp,"document.querySelector('.bpf-timer')?.innerText.includes('timer running')",'Finishing timer did not start');
 await evaluate(cdp,"var f=document.querySelector('[data-pq-actual]');f.elements.notes.value='Draft survives timer stop';f.elements.notes.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-pq-timer]').click()");await waitFor(cdp,"document.querySelector('.bpf-timer')?.innerText.includes('Hands-on finishing timer')",'Finishing timer did not stop');assert.equal(await evaluate(cdp,"document.querySelector('[data-pq-actual]').elements.notes.value"),'Draft survives timer stop');
 await evaluate(cdp,`var f=document.querySelector('[data-pq-actual]');f.elements.quoteId.value='${frozen.id}:${frozen.version}';f.elements.confirmed.checked=true;f.requestSubmit();`);await waitFor(cdp,"document.querySelector('.bpf-actual-result')",'Actual outcome did not save');
 workflow=await getPrintWorkflow(source,dataRoot);assert.equal(workflow.actuals[0].revenue,null);assert.equal(workflow.actuals[0].fees,null);assert.equal(workflow.actuals[0].source,'operator-confirmed');assert.equal(workflow.scorecard.pairedJobs,0,'Incomplete expense records must not manufacture measured success');
 await evaluate(cdp,`var f=document.querySelector('[data-pq-actual]');f.elements.quoteId.value='${frozen.id}:${frozen.version}';f.elements.printerHours.value='1.2';f.elements.grams.value='105';f.elements.goodUnits.value='2';f.elements.materialCost.value='2.6';f.elements.machineCost.value='1.2';f.elements.laborCost.value='4';f.elements.hardwareCost.value='3';f.elements.packagingCost.value='1';f.elements.revenue.value='30';f.elements.fees.value='0';f.elements.confirmed.checked=true;f.requestSubmit();`);await waitFor(cdp,"document.querySelector('.bpf-workflow')?.innerText.includes('1 / 10')",'Measured paired completion did not enter scorecard');
 workflow=await getPrintWorkflow(source,dataRoot);assert.equal(workflow.scorecard.pairedJobs,1);assert.equal(workflow.actuals[0].quoteVersion,frozen.version);assert.ok(workflow.scorecard.contributionPerPrinterHour>0);
 console.log('PASS two named24-hour printers with exact-model compatibility, frozen revisions, durable finishing timer and measured actuals without fake zeros');
 for(const run of source.runs.slice(1)){workflow=await getPrintWorkflow(source,dataRoot);await executePrintWorkflow(source,{commandId:randomUUID(),expectedRevision:workflow.revision,type:'record-actual',payload:{runId:run.id,quoteId:frozen.id,quoteVersion:frozen.version,outcome:'completed',startedAt:null,completedAt:new Date().toISOString(),printerSeconds:4320,grams:105,finishingMinutes:12,hardwareCost:3,materialCost:2.6,machineCost:1.2,laborCost:4,packagingCost:1,revenue:30,fees:0,goodUnits:2,notes:'Synthetic measured browser fixture'}},'qa',dataRoot);}
 await evaluate(cdp,"document.querySelector('[data-bpf-refresh]').click()");await waitFor(cdp,"document.querySelector('.bpf-workflow')?.innerText.includes('10 / 10')",'Ten-job scorecard did not reach measured target');
 await evaluate(cdp,"document.querySelector('[data-bpf-detail=pq-scorecard]').open=true;document.querySelector('.bpf-workflow').scrollIntoView({block:'start'})");
 let image=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(path.join(runDir,'print-quotes-desktop.png'),Buffer.from(image.data,'base64'));
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:false});assert.ok(await evaluate(cdp,'document.documentElement.scrollWidth<=innerWidth+2'),'Quote workflow overflows mobile');
 await evaluate(cdp,"document.querySelector('[data-pq-result]').scrollIntoView({block:'start'})");image=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(path.join(runDir,'print-quote-390.png'),Buffer.from(image.data,'base64'));
 await evaluate(cdp,"document.querySelector('[data-bpf-detail=pq-scorecard]').scrollIntoView({block:'start'})");image=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(path.join(runDir,'print-scorecard-390.png'),Buffer.from(image.data,'base64'));
 await evaluate(cdp,"var f=document.querySelector('[data-pq-recipe]');f.elements.name.value='Saved draft survives background';f.elements.name.dispatchEvent(new Event('input',{bubbles:true}));window.__polls.at(-1)()");await sleep(200);assert.equal(await evaluate(cdp,"document.querySelector('[data-pq-recipe]').elements.name.value"),'Saved draft survives background');
 await evaluate(cdp,"window.mount('finance')");await waitFor(cdp,"document.querySelector('.bpf-workflow')?.innerText.includes('10 / 10')",'Finance did not reuse saved recipe and scorecard');
 const before=calls.filter(row=>row.method==='POST').length;await evaluate(cdp,"window.account.set({token:'another-account'});document.querySelector('[data-pq-revise]').click()");await sleep(150);assert.equal(calls.filter(row=>row.method==='POST').length,before,'Stale account action escaped its guard');
 await evaluate(cdp,"window.account.set({token:'isolated-browser-fixture'});window.mount('production','phantomforce')");await waitFor(cdp,"document.querySelector('[data-commerce-workspace=phantomforce]')",'Other business mount failed');assert.equal(await evaluate(cdp,"document.querySelectorAll('.bpf-workflow').length"),0,'Quote workflow leaked into another business');
 assert.ok(calls.filter(row=>row.pathname.includes('print-runs')).every(row=>row.business===tenant && row.authorized));assert.deepEqual(cdp.errors,[]);
 console.log('PASS ten measured completed fixtures, mobile containment, Finance reuse, draft preservation and account/business isolation');
 writeFileSync(path.join(runDir,'report.json'),JSON.stringify({ok:true,actualCommerceMount:true,serverWorkflowUsed:true,syntheticFixturesOnly:true,tenMeasuredCompletedJobs:true,namedPrinters:true,modelCompatibility:true,frozenRevisions:true,unknownActualsRemainNull:true,finishingTimer:true,mobileWidth:390,draftsPreserved:true,accountScope:true,tenantScope:true},null,2));console.log(JSON.stringify({ok:true,report:path.join(runDir,'report.json')}));
}catch(error){console.error(error.stack);console.error(JSON.stringify((await getPrintWorkflow(source,dataRoot)).scorecard));if(cdp)console.error(await evaluate(cdp,"document.querySelector('.bpf-workflow')?.innerText"));process.exitCode=1;}
finally{if(releaseFeed)releaseFeed();cdp?.close();if(chrome?.exitCode===null){chrome.kill();await Promise.race([new Promise(resolve=>chrome.once('exit',resolve)),sleep(1500)]);}server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
