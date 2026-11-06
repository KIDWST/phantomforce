import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
import type {FastifyInstance,FastifyRequest,FastifyReply} from 'fastify';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const defaultFile=resolve(root,'server/.local/chicagoshots-website/events.json');
const eventSchema=z.object({
  id:z.string().uuid(),session:z.string().uuid(),
  event:z.enum(['page_view','cta_click','inquiry_start','inquiry_submit']),
  page:z.enum(['/','/sports','/events','/podcasts','/weddings']),
  source:z.enum(['direct','instagram','facebook','tiktok','youtube','linkedin','google','email','referral','other']),
  campaign:z.string().max(80).regex(/^[a-zA-Z0-9_-]*$/).default(''),
}).strict();
type WebsiteEvent=z.infer<typeof eventSchema>&{at:string};
let lock:Promise<unknown>=Promise.resolve();
const filePath=(override?:string)=>resolve(override||process.env.PHANTOMFORCE_CHICAGOSHOTS_WEBSITE_FILE||defaultFile);
async function load(file?:string):Promise<WebsiteEvent[]>{
  try{
    const doc=z.object({version:z.literal(1),events:z.array(eventSchema.extend({at:z.string().datetime()})).max(50000)}).parse(JSON.parse(await readFile(filePath(file),'utf8')));
    return doc.events;
  }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}
}
export async function recordWebsiteEvent(value:unknown,file?:string,now=new Date()){
  const event=eventSchema.parse(value),prior=lock;
  let release=()=>{};lock=new Promise<void>(r=>{release=r;});await prior.catch(()=>{});
  try{
    const cutoff=now.getTime()-30*86400000;
    const events=(await load(file)).filter(row=>Date.parse(row.at)>=cutoff);
    if(events.some(row=>row.id===event.id))return {recorded:false,duplicate:true};
    events.push({...event,at:now.toISOString()});
    const target=filePath(file),temporary=target+'.'+randomUUID()+'.tmp';await mkdir(dirname(target),{recursive:true});
    await writeFile(temporary,JSON.stringify({version:1,events:events.slice(-50000)})+'\n','utf8');await rename(temporary,target);
    return {recorded:true,duplicate:false};
  }finally{release();}
}
export async function websiteMetrics(file?:string,now=new Date()){
  const events=(await load(file)).filter(row=>Date.parse(row.at)>=now.getTime()-30*86400000&&Date.parse(row.at)<=now.getTime());
  const count=(name:string)=>events.filter(row=>row.event===name).length;
  const visits=events.filter(row=>row.event==='page_view');
  return {tenant_id:'client-chicagoshots',period:'Last 30 days',page_views:count('page_view'),visit_sessions:new Set(visits.map(row=>row.session)).size,
    cta_clicks:count('cta_click'),inquiry_starts:count('inquiry_start'),inquiry_submissions:count('inquiry_submit'),
    last_event_at:events.map(row=>row.at).sort().at(-1)||null,
    sources:Object.fromEntries([...new Set(visits.map(row=>row.source))].map(source=>[source,visits.filter(row=>row.source===source).length])),
    source:'First-party browser events',limitations:'Up to 50,000 events; browser-reported, not verified buyers, revenue, or cross-device unique people.'};
}
export function registerChicagoShotsWebsiteRoutes(app:FastifyInstance,authorize:(request:FastifyRequest,reply:FastifyReply)=>unknown){
  const rates=new Map<string,{at:number,n:number}>();
  app.post('/api/public/chicagoshots/website-events',async(request,reply)=>{
    reply.header('cache-control','no-store');
    if(!['https://chicagoshots.com','https://www.chicagoshots.com'].includes(String(request.headers.origin||'')))return reply.code(403).send({ok:false,error:'origin_not_allowed'});
    if(request.headers.dnt==='1'||/bot|crawler|spider|headless/i.test(String(request.headers['user-agent']||'')))return reply.code(202).send({ok:true,recorded:false});
    const parsed=eventSchema.safeParse(request.body);if(!parsed.success)return reply.code(400).send({ok:false,error:'invalid_website_event'});
    const now=Date.now(),key=request.ip,rate=rates.get(key);
    if(rates.size>=10000)for(const [id,value] of rates)if(value.at<now-600000)rates.delete(id);
    if(rate&&rate.at>=now-600000){if(rate.n>=300)return reply.code(429).send({ok:false,error:'rate_limited'});rate.n++;}
    else {if(rates.size>=10000)return reply.code(429).send({ok:false,error:'rate_limited'});rates.set(key,{at:now,n:1});}
    try{return reply.code(202).send({ok:true,...await recordWebsiteEvent(parsed.data)});}
    catch{return reply.code(503).send({ok:false,error:'website_metrics_unavailable'});}
  });
  app.get('/phantom-ai/ops/chicagoshots/website-metrics',async(request,reply)=>{
    reply.header('cache-control','no-store');if(!authorize(request,reply))return reply;
    try{return {ok:true,...await websiteMetrics()};}catch{return reply.code(503).send({ok:false,error:'website_metrics_unavailable'});}
  });
}
