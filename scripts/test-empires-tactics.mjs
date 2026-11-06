import assert from 'node:assert/strict';
import {chooseDeposit,chooseDropoff,formationDestinations} from '../app/games/phantom-empires/tactics.js';
const worker={id:'w',team:'player',x:0,y:0,hp:72};
const nodes=[{id:'a',type:'wood',x:20,y:0,amount:30},{id:'b',type:'wood',x:30,y:0,amount:30},{id:'gone',type:'wood',x:1,y:0,amount:0},{id:'food',type:'food',x:2,y:0,amount:50}];
assert.equal(chooseDeposit(worker,nodes,'wood').id,'a');
assert.equal(chooseDeposit(worker,nodes,'wood',[{id:'other',hp:72,gatherNodeId:'a',order:'gather'}]).id,'b');
assert.equal(chooseDeposit(worker,nodes,'gold'),null);
assert.equal(chooseDeposit(worker,nodes,'food').id,'food');
const defs={citadel:{accepts:['wood','food','gold','stone']},camp:{accepts:['wood']},mill:{accepts:['food']}};
const buildings=[{id:'home',type:'citadel',team:'player',hp:1800,construction:1,x:100,y:0},{id:'camp',type:'camp',team:'player',hp:430,construction:1,x:20,y:0},{id:'mill',type:'mill',team:'player',hp:430,construction:1,x:1,y:0},{id:'unfinished',type:'camp',team:'player',hp:50,construction:.5,x:2,y:0},{id:'enemy',type:'camp',team:'enemy',hp:400,construction:1,x:1,y:0}];
assert.equal(chooseDropoff(worker,buildings,defs,'wood').id,'camp');
assert.equal(chooseDropoff(worker,buildings,defs,'gold').id,'home');
assert.equal(chooseDropoff(worker,buildings,defs,'food').id,'mill');
assert.equal(chooseDropoff(worker,buildings.filter(b=>b.type!=='citadel'),defs,'stone'),null);
for(let count=1;count<=60;count++){
  const units=Array.from({length:count},(_,i)=>({id:String(i),type:i%3===0?'catapult':i%3===1?'archer':'sword',x:0,y:0}));
  for(const point of [{x:300,y:0},{x:0,y:300},{x:-300,y:-300}]){
    const slots=formationDestinations(units,point);
    assert.equal(slots.length,count);assert.equal(new Set(slots.map(p=>p.id)).size,count);
    assert.ok(Math.abs(slots.reduce((sum,p)=>sum+p.x,0)/count-point.x)<1e-7);
    assert.ok(Math.abs(slots.reduce((sum,p)=>sum+p.y,0)/count-point.y)<1e-7);
    for(let i=0;i<slots.length;i++)for(let j=i+1;j<slots.length;j++)assert.ok(Math.hypot(slots[i].x-slots[j].x,slots[i].y-slots[j].y)>35);
  }
}
assert.deepEqual(formationDestinations([],{x:0,y:0}),[]);
console.log('Economy and formations: resource types, worker spread, completed friendly drop-offs, missing resources, 1–60-unit centered formations and non-overlapping rotated slots passed.');
