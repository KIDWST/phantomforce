// Independent implementations of behavior studied in the owner's local scripts.
// No SCAR runtime or proprietary source is included in this module.
const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);

export function chooseDeposit(worker,nodes,type,workers=[],anchor=null) {
  let candidates=nodes.filter(node=>node.type===type&&node.amount>0);
  if(anchor){const nearby=candidates.filter(node=>distance(node,anchor)<=220);if(nearby.length)candidates=nearby;}
  const load=node=>workers.filter(other=>other.id!==worker.id&&other.hp>0&&other.gatherNodeId===node.id&&['gather','return'].includes(other.order)).length;
  return candidates.sort((a,b)=>distance(worker,a)+load(a)*48-distance(worker,b)-load(b)*48||String(a.id).localeCompare(String(b.id)))[0]||null;
}

export function chooseDropoff(worker,buildings,definitions,type) {
  return buildings.filter(building=>building.team===worker.team&&building.hp>0&&building.construction>=1&&definitions[building.type]?.accepts?.includes(type))
    .sort((a,b)=>distance(worker,a)-distance(worker,b)||String(a.id).localeCompare(String(b.id)))[0]||null;
}

export function formationDestinations(units,destination) {
  if(!units.length)return [];
  const center={x:units.reduce((sum,u)=>sum+u.x,0)/units.length,y:units.reduce((sum,u)=>sum+u.y,0)/units.length};
  const angle=Math.atan2(destination.y-center.y,destination.x-center.x);
  const forward={x:Math.cos(angle),y:Math.sin(angle)},side={x:-forward.y,y:forward.x};
  const spacing=units.some(unit=>['catapult','ship'].includes(unit.type))?54:36;
  // Fill from the center out; recenter partial rings to preserve the destination.
  const slots=[{x:0,y:0}];
  for(let radius=1;slots.length<units.length;radius++){
    const ring=[];
    for(let x=-radius;x<=radius;x++)for(let y=-radius;y<=radius;y++)if(Math.max(Math.abs(x),Math.abs(y))===radius)ring.push({x,y});
    ring.sort((a,b)=>a.x*a.x+a.y*a.y-b.x*b.x-b.y*b.y||b.y-a.y||a.x-b.x);
    slots.push(...ring.slice(0,units.length-slots.length));
  }
  const mean={x:slots.reduce((sum,p)=>sum+p.x,0)/slots.length,y:slots.reduce((sum,p)=>sum+p.y,0)/slots.length};
  slots.sort((a,b)=>b.y-a.y||Math.abs(a.x)-Math.abs(b.x)||a.x-b.x);
  const rank=unit=>unit.type==='catapult'?2:unit.type==='archer'||unit.type==='worker'?1:0;
  return [...units].sort((a,b)=>rank(a)-rank(b)||String(a.id).localeCompare(String(b.id))).map((unit,i)=>({
    id:unit.id,x:destination.x+((slots[i].x-mean.x)*side.x+(slots[i].y-mean.y)*forward.x)*spacing,
    y:destination.y+((slots[i].x-mean.x)*side.y+(slots[i].y-mean.y)*forward.y)*spacing,
  }));
}
