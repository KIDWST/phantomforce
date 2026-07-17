# Phantom Rumble — Race to the Top Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second, completely separate Phantom Rumble game mode: a no-death vertical climbing race, up to 4 players, sabotage-only combat, procedural rising hazard, and a procedural 8-bit soundtrack.

**Architecture:** Everything lives in `app/games/phantom-rumble.html`, as a parallel code path (`mode==='racetop'`) that reuses the existing fighter sprite (`drawFighter`), input handling, and attack hitbox exactly as they are, but runs its own physics step, its own win condition, and has zero interaction with the brawl mode's `pct`/`stocks`/fence-crack system. This plan assumes the Ninja Chicken Polish plan (`docs/superpowers/plans/2026-07-17-phantom-rumble-ninja-polish.md`) has already landed, since it depends on that plan's finished sprite and consolidated mode-menu structure.

**Tech Stack:** Vanilla JS, HTML5 Canvas 2D, Web Audio (extends the existing `tone()`/`audio()` oscillator helpers for the soundtrack — no audio files, matching the page's `media-src 'none'` CSP). No test framework for this file (see the Ninja Polish plan's Tech Stack note for why); verification is manual, in-browser, via the same local preview stack.

## Global Constraints

- No `pct`/stocks/percent-damage system in this mode at all — a fighter has an `altitude` (world-space height climbed) instead.
- Sabotage uses the exact existing `attack()` hitbox/reach values — no aim-assist, no reach buff for this mode (explicit design call, not an oversight).
- Double jump only (`jumps:2`, same as brawl) — no flight, no third jump, no new movement primitive beyond the two mode-exclusive pickups.
- No changes to brawl-mode code paths — every function this plan adds is either new or gated behind `mode==='racetop'` so brawl behavior (`step()`, `attack()`'s damage math, `ko()`, HUD) is untouched.
- No external audio/image assets.
- Reference spec: `docs/superpowers/specs/2026-07-17-phantom-rumble-race-to-top-design.md`.
- File under edit throughout: `app/games/phantom-rumble.html`. This plan assumes the Ninja Polish plan's Task 6 (mode-menu restructure) and Task 7 (room integration) have already landed — it extends that same menu/room infrastructure rather than duplicating it.

---

## Task 1: Tower generation + race-mode fighter setup

**Files:**
- Modify: `app/games/phantom-rumble.html` — extend the existing chunk system (`CHUNKS`, `mulberry32`, `buildPlatforms`, currently lines 100-117) with a new `buildTower(seed)`; add `makeRaceFighter(slot,human)`; add the mode-select tile.

**Interfaces:**
- Produces: `let TOWER=[]` (array of `{x,y,w,h}` platforms, same shape as `PLATS`, but spanning many rows upward) and `let SUMMIT={x,y,w,h}` (the win-condition platform, topmost row).
- Produces: `function buildTower(seed)` — deterministic from `seed` via the existing `mulberry32` PRNG, so local and networked matches agree on layout without transmitting the whole tower (mirrors `buildPlatforms`' existing seeding rationale).
- Produces: `function makeRaceFighter(slot,human)` — same shape as `makeFighter` (reuses `PALETTE`, `SPAWNS[0]` as the shared start position since all racers start together) but with `altitude:0`, no `pct`/`stocks`, plus `grappleReady:false,shieldBubble:0` for Task 4's pickups.

- [ ] **Step 1: Add tower constants and `buildTower`**

Add directly after the existing `buildPlatforms(seed)` function (`app/games/phantom-rumble.html:112-117`):
```js
const TOWER_ROWS=16,ROW_STEP=.16,TOWER_START_Y=.56;
let TOWER=[],SUMMIT=null;
function buildTower(seed){
  const rand=mulberry32(seed);
  TOWER=[{x:.5,y:TOWER_START_Y,w:.5,h:.03}]; // shared start platform, wider than a normal chunk so all 4 racers can spawn on it
  for(let row=1;row<=TOWER_ROWS;row++){
    const chunk=CHUNKS[Math.floor(rand()*CHUNKS.length)];
    const cy=TOWER_START_Y-row*ROW_STEP;
    for(const c of chunk)TOWER.push({x:.5+c.dx,y:cy+c.dy*.4,w:c.w,h:.03});
  }
  const summitY=TOWER_START_Y-(TOWER_ROWS+1)*ROW_STEP;
  SUMMIT={x:.5,y:summitY,w:.4,h:.035,summit:true};
  TOWER.push(SUMMIT);
}
```

- [ ] **Step 2: Add `makeRaceFighter`**

Add directly after `makeFighter` (`app/games/phantom-rumble.html:195-201`):
```js
function makeRaceFighter(slot,human){
  return {slot,human,name:PALETTE[slot].name,color:PALETTE[slot].c,glow:PALETTE[slot].glow,
    x:.5+(slot-1.5)*.06,y:TOWER_START_Y,vx:0,vy:0,face:slot%2?-1:1,altitude:0,finished:false,place:0,
    grounded:false,jumps:2,stun:0,invuln:2,dodgeCd:0,attackCd:0,anim:0,trail:[],grappleReady:false,shieldBubble:0,
    ai:{dir:1,timer:0,jumpCd:0,diff:DIFFS[botDifficulty]},lastTap:{key:'',at:0}};
}
```

- [ ] **Step 3: Add the mode-select tile**

Extend the "ONLINE" `mode-group` markup from the Ninja Polish plan's Task 6 — add a third `mode-group` directly after it, inside `.overlay[data-setup]`:
```html
  <div class="mode-group"><i>SOLO / LOCAL</i><div class="modes">
    <button data-mode="racetop"><b>RACE TO THE TOP</b>up to 4, no health, climb or get left behind</button>
  </div></div>
```
(Placed under the SOLO/LOCAL group since this task only wires up local play; networked Race to the Top is a natural follow-up once this mode's local version is verified, using the exact same room pattern Ninja Polish's Task 7 already established for the brawl modes — flagging that scope boundary explicitly rather than silently building it now.)

- [ ] **Step 4: Manual verification**

Preview stack (`cd server && PHANTOMFORCE_AUTH_PROVIDER=demo npx tsx src/index.ts`, then `node ops/admin-live/admin-static-server.mjs --root . --port 5281 --api http://127.0.0.1:5190`). Confirm the new tile appears on the setup screen (clicking it won't yet start a working match — that lands in Task 2 — so for this step it's enough to confirm no console errors on page load, since `buildTower`/`makeRaceFighter` aren't called yet).

- [ ] **Step 5: Commit**

```bash
git add app/games/phantom-rumble.html
git commit -m "feat(phantom-rumble): add procedurally-generated vertical tower for Race to the Top"
```

---

## Task 2: Race-mode physics loop, camera, and rising hazard

**Files:**
- Modify: `app/games/phantom-rumble.html` — add `raceStep(f,dt)`, `stepHazard(dt)`, a race-mode branch in `startMatch`/a new `startRaceMatch`, and extend `loop()`/`draw()`/`updateCamera()` to branch on `mode==='racetop'`.

**Interfaces:**
- Consumes: `TOWER`, `SUMMIT`, `makeRaceFighter` (Task 1); existing `jump()`, `dodge()`, `heldDir()`, `botThink()` movement primitives (reused as-is — only the collision/fall-handling differs from brawl's `step()`).
- Produces: `let hazardY=1,hazardSpeed=.01` (module state); `function stepHazard(dt)`; `function raceStep(f,dt)`; `function startRaceMatch()`.

- [ ] **Step 1: Add hazard state and `stepHazard`**

Add directly after the `TOWER`/`SUMMIT` declaration from Task 1:
```js
let hazardY=1,hazardSpeed=.01;
function stepHazard(dt){
  hazardY-=hazardSpeed*dt;
  hazardSpeed=Math.min(.05,hazardSpeed+.0004*dt); // accelerates over the match, capped so it never becomes unfair-instant
}
```

- [ ] **Step 2: Add `raceStep(f,dt)` — movement/collision reusing brawl's primitives, without pct/stocks/fence-crack**

Add directly after the existing `wallBonk`/`step` functions (`app/games/phantom-rumble.html:380-425`). This step also needs temporary no-op `raceGrabPickups` and `finishRace` stubs — `raceStep` calls both, but their real implementations don't land until Task 4 and Task 5 respectively. Both later tasks replace these stubs with the same names and signatures, so `raceStep`'s call sites never change:
```js
function raceGrabPickups(f){} // stub — Task 4 replaces this with the real pickup-grab logic
function finishRace(f){f.finished=true} // stub — Task 5 replaces this with the real finish-order logic
function raceStep(f,dt){
  if(f.finished)return;
  f.invuln=Math.max(0,f.invuln-dt);f.stun=Math.max(0,f.stun-dt);f.attackCd=Math.max(0,f.attackCd-dt);f.anim=Math.max(0,f.anim-dt);f.dodgeCd=Math.max(0,f.dodgeCd-dt);f.shieldBubble=Math.max(0,f.shieldBubble-dt);
  if(f.stun<=0){
    if(f.human){
      const dir=heldDir(f);
      if(dir)f.face=dir;
      f.vx+=dir*.0018*(dt*60);
    }else raceBotThink(f,dt);
  }
  f.vx*=f.grounded?.82:.94;
  f.vy=Math.min(.05,f.vy+.0011*(dt*60));
  f.x+=f.vx*(dt*60);f.y+=f.vy*(dt*60);
  f.grounded=false;
  for(const s of TOWER){
    const top=s.y-s.h/2;
    if(f.vy>=0&&Math.abs(f.x-s.x)<s.w/2&&f.y>=top-.012&&f.y<=top+.05){
      f.y=top;f.vy=0;f.grounded=true;f.jumps=2;
      if(s.summit&&!f.finished)finishRace(f);
    }
  }
  if(f.x<ARENA.left)f.x=ARENA.left;
  if(f.x>ARENA.right)f.x=ARENA.right;
  f.altitude=Math.max(f.altitude,TOWER_START_Y-f.y);
  if(!reduced){f.trail.unshift({x:f.x,y:f.y});f.trail=f.trail.slice(0,8)}
  if(f.y>hazardY&&f.invuln<=0)hazardCatch(f);
  raceGrabPickups(f);
}
function raceBotThink(f,dt){
  const d=f.ai.diff||DIFFS.normal;
  f.ai.timer-=dt;f.ai.jumpCd-=dt;
  const target=TOWER.filter(s=>s.y<f.y-.05).sort((a,b)=>b.y-a.y)[0]||SUMMIT;
  f.ai.dir=target.x>f.x?1:-1;
  if(f.ai.timer<=0){
    f.ai.timer=d.reaction[0]+Math.random()*(d.reaction[1]-d.reaction[0]);
    if(f.grounded&&f.ai.jumpCd<=0&&Math.random()<d.recoverSkill){jump(f);f.ai.jumpCd=d.jumpCd}
  }
  f.vx+=f.ai.dir*.0016*d.accel*(dt*60);
}
```

- [ ] **Step 3: Add `startRaceMatch()` and wire the `racetop` mode button to it**

Add directly after `startMatch()` (`app/games/phantom-rumble.html:202-213`). This also needs temporary no-op `startRaceMusic`/`stopRaceMusic` stubs — Task 6 replaces both with the real sequencer (same names, so this task's call sites never change):
```js
function buildRaceHud(){} // stub — Task 5 replaces this with the real HUD builder
function updateRaceHud(){} // stub — Task 5 replaces this with the real HUD updater
function startRaceMusic(){} // stub — Task 6 replaces this with the real sequencer
function stopRaceMusic(){} // stub — Task 6 replaces this with the real sequencer
function startRaceMatch(humanCount){
  mode='racetop';
  const total=4;
  fighters=[];
  for(let i=0;i<total;i++)fighters.push(makeRaceFighter(i,i<(humanCount||1)));
  buildTower(nextSeed());
  hazardY=1;hazardSpeed=.01;
  particles=[];floaters=[];rings=[];projectiles=[];over=false;running=true;paused=false;raceFinishOrder=[];
  setupEl.hidden=true;endEl.hidden=true;hudEl.hidden=false;
  document.querySelector('[data-touch]').hidden=fighters.some(f=>f.human&&f.slot===0)?false:true;
  buildRaceHud();last=performance.now();if(raf)cancelAnimationFrame(raf);raf=requestAnimationFrame(loop);
  startRaceMusic();
}
```

Wire the mode button (extends Task 1 Step 3's `data-mode="racetop"` button, and reuses the Ninja Polish plan's `localHumans` slot-picker state) — in the mode-button click handler:
```js
for(const b of document.querySelectorAll('[data-mode]'))b.onclick=()=>{
  if(b.dataset.mode==='localffa'){localSlotsEl.hidden=false;return}
  if(b.dataset.mode==='racetop'){startRaceMatch(localHumans);return}
  if(b.dataset.mode.startsWith('net')){mode=b.dataset.mode;sendMatchAction({hostProbe:hostNonce});return}
  startMatch(b.dataset.mode,{humans:localHumans});
};
```

- [ ] **Step 4: Branch `loop()`, `draw()`, and `updateCamera()` on `mode==='racetop'`**

Modify `loop()` (`app/games/phantom-rumble.html:593-607`) — add the race branch before the existing brawl-mode body:
```js
function loop(t){
  if(!running)return;
  let dt=Math.min(.033,(t-last)/1000);last=t;
  if(paused){raf=requestAnimationFrame(loop);return}
  if(mode==='racetop'){
    stepHazard(dt);
    for(const f of fighters)raceStep(f,dt);
    updateRaceHud();
    stepParticles(dt);
    draw(t);
    raf=requestAnimationFrame(loop);
    return;
  }
  if(slowmo>0){slowmo=Math.max(0,slowmo-dt);dt*=.35}
  shake=Math.max(0,shake-dt*3);
  pickupTimer-=dt;
  if(pickupTimer<=0){pickupTimer=7+Math.random()*5;if(pickups.length<3)spawnPickup()}
  for(const p of pickups)p.age+=dt;
  tickBombs(dt);
  for(const f of fighters)step(f,dt);
  updateHud();
  stepParticles(dt);
  stepProjectiles(dt);
  draw(t);
  raf=requestAnimationFrame(loop);
}
```

Modify `updateCamera()` (`app/games/phantom-rumble.html:492-498`) to track the highest (lowest `y`, since up is negative-going) living racer in race mode, instead of the group centroid:
```js
function updateCamera(){
  const live=fighters.filter(f=>!f.dead&&!f.finished);
  if(mode==='racetop'){
    if(!live.length){camera.x+=(.5-camera.x)*.04;camera.y+=(TOWER_START_Y-camera.y)*.04;camera.z+=(1-camera.z)*.04;return}
    const leader=live.reduce((a,b)=>a.y<b.y?a:b);
    camera.x+=(.5-camera.x)*.05;camera.y+=(leader.y-camera.y)*.06;camera.z+=(1-camera.z)*.04;
    return;
  }
  if(!live.length){camera.x+=(.5-camera.x)*.04;camera.y+=(.56-camera.y)*.04;camera.z+=(1-camera.z)*.04;return}
  const cx=live.reduce((s,f)=>s+f.x,0)/live.length,cy=live.reduce((s,f)=>s+f.y,0)/live.length;
  const spread=Math.max(.35,...live.map(f=>Math.hypot(f.x-cx,f.y-cy)));
  camera.x+=(cx-camera.x)*.045;camera.y+=(cy-camera.y)*.045;camera.z+=(Math.max(.82,Math.min(1.12,1.08-spread*.45))-camera.z)*.045;
}
```

Modify `drawStage()` (`app/games/phantom-rumble.html:501-520`) to draw `TOWER` (and a hazard band) instead of `FLOOR`/`ARENA` fences when in race mode:
```js
function drawStage(){
  if(mode==='racetop'){
    for(const s of TOWER){
      ctx.fillStyle=s.summit?'#2a1f0a':'#0a1f14';ctx.strokeStyle=s.summit?'#fde04799':'#2cff9b33';ctx.lineWidth=(s.summit?3:2)*DPR;
      const x=px(s.x-s.w/2),y=py(s.y-s.h/2),w=px(s.w),h=Math.max(6*DPR,py(s.h));
      ctx.beginPath();ctx.roundRect(x,y,w,h,6*DPR);ctx.fill();ctx.stroke();
      if(s.summit){ctx.fillStyle='#fde047';ctx.font=`900 ${14*DPR}px ui-monospace`;ctx.textAlign='center';ctx.fillText('SUMMIT',px(s.x),y-8*DPR)}
    }
    const hazardPx=py(hazardY);
    // Overdraw the fill well past the bottom of the canvas (4x height is
    // more than enough headroom for any camera position) rather than
    // computing an exact height — anything below the visible area is
    // harmlessly clipped, and this avoids gaps as the camera moves.
    ctx.fillStyle='#3a1a0a99';ctx.fillRect(0,hazardPx,W,H*4);
    ctx.strokeStyle='#fb923c';ctx.lineWidth=2*DPR;ctx.beginPath();ctx.moveTo(0,hazardPx);ctx.lineTo(W,hazardPx);ctx.stroke();
    return;
  }
  ctx.fillStyle='#0b2417';ctx.strokeStyle='#2cff9b44';ctx.lineWidth=2*DPR;
  const fx=px(FLOOR.x-FLOOR.w/2),fy=py(FLOOR.y-FLOOR.h/2),fw=px(FLOOR.w),fh=Math.max(6*DPR,py(FLOOR.h));
  ctx.beginPath();ctx.roundRect(fx,fy,fw,fh,8*DPR);ctx.fill();ctx.stroke();
  ctx.fillStyle='#4ade8022';ctx.fillRect(fx,fy,fw,2*DPR);
  ctx.strokeStyle='#2cff9b66';ctx.lineWidth=3*DPR;
  for(const wallX of [ARENA.left,ARENA.right]){
    const x=px(wallX),topY=py(ARENA.ceil),botY=py(ARENA.floor);
    ctx.beginPath();ctx.moveTo(x,topY);ctx.lineTo(x,botY);ctx.stroke();
    for(let i=0;i<8;i++){const railY=topY+(botY-topY)*i/7;ctx.beginPath();ctx.moveTo(x-6*DPR,railY);ctx.lineTo(x+6*DPR,railY);ctx.stroke()}
  }
  for(const s of PLATS){
    ctx.fillStyle='#0a1f14';ctx.strokeStyle='#2cff9b33';ctx.lineWidth=2*DPR;
    const x=px(s.x-s.w/2),y=py(s.y-s.h/2),w=px(s.w),h=Math.max(6*DPR,py(s.h));
    ctx.beginPath();ctx.roundRect(x,y,w,h,6*DPR);ctx.fill();ctx.stroke();
  }
}
```

- [ ] **Step 5: Manual verification**

Preview stack as before. Click RACE TO THE TOP, confirm: a tall procedurally-generated tower renders, the camera follows the highest player, a rising orange hazard band climbs from below and accelerates over time, jumping/double-jumping/moving works identically to brawl mode's feel, and reaching the gold SUMMIT platform (fly/climb straight up unobstructed to test) marks that fighter finished without crashing (the real finish-order/results UI lands in Task 5 — for now this just confirms the stub sets `f.finished=true` cleanly).

- [ ] **Step 6: Commit**

```bash
git add app/games/phantom-rumble.html
git commit -m "feat(phantom-rumble): add Race to the Top physics loop, camera, and rising hazard"
```

---

## Task 3: Sabotage and hazard knockdown

**Files:**
- Modify: `app/games/phantom-rumble.html` — add `raceSabotage(f)` (a race-mode-specific counterpart to `attack()`, reusing its exact hitbox math), `hazardCatch(f)`.

**Interfaces:**
- Consumes: `attack()`'s existing reach constants (`.085` heavy / `.06` light — copied, not imported, since race mode has no `heavy`/damage concept, only "did the swing connect").
- Produces: `function raceSabotage(f)`; `function hazardCatch(f)`; both call a shared `slideDown(f,rows)` helper.

- [ ] **Step 1: Add `slideDown` and `hazardCatch`**

Add directly after `raceBotThink` (from Task 2):
```js
function slideDown(f,rows){
  f.y=Math.min(TOWER_START_Y,f.y+rows*ROW_STEP);
  f.vx=0;f.vy=0;f.stun=.4;f.invuln=.6;f.grounded=false;
  spawnBurst(f.x,f.y,f.glow,18);addFloater(f.x,f.y-.1,rows>=4?'WASHED OUT!':'KNOCKED DOWN!',f.glow,16);sfx('ko');
}
function hazardCatch(f){
  slideDown(f,4);
}
```

- [ ] **Step 2: Add `raceSabotage` — exact hitbox from `attack()`, knockdown instead of damage**

Add directly after `hazardCatch`:
```js
function raceSabotage(f){
  if(f.attackCd>0)return;
  f.attackCd=.28;f.anim=.18;
  const reach=.06; // identical to attack()'s light-attack reach — precision is the point, no aim-assist for this mode
  for(const t of fighters){
    if(t===f||t.finished||t.invuln>0||t.shieldBubble>0)continue;
    const dx=t.x-f.x,dy=t.y-f.y;
    if(Math.abs(dy)<.08&&dx*f.face>-.015&&Math.abs(dx)<reach){
      slideDown(t,2);
      spawnBurst(t.x,t.y,t.glow,14);sfx('hit');
    }
  }
}
```

- [ ] **Step 3: Route input to `raceSabotage` instead of `attack` when in race mode**

Modify the existing `keydown` listener (`app/games/phantom-rumble.html:220-233`) — the light/heavy attack lines gain a mode check:
```js
    if(pad.light.includes(e.key)){if(mode==='racetop')raceSabotage(f);else attack(f,false)}
    if(pad.heavy.includes(e.key)){if(mode!=='racetop')f.charge=.01}
```
(Heavy attack has no meaning in race mode — no charge-up sabotage variant, per the design doc's "reuse the light/heavy attack inputs and their current hitbox/reach values exactly" using light-attack reach specifically, since that's the tighter, more precision-demanding hitbox.)

Also route bot sabotage — extend `raceBotThink` (Task 2) to occasionally attempt a sabotage when a rival is in reach:
```js
function raceBotThink(f,dt){
  const d=f.ai.diff||DIFFS.normal;
  f.ai.timer-=dt;f.ai.jumpCd-=dt;
  const target=TOWER.filter(s=>s.y<f.y-.05).sort((a,b)=>b.y-a.y)[0]||SUMMIT;
  f.ai.dir=target.x>f.x?1:-1;
  if(f.ai.timer<=0){
    f.ai.timer=d.reaction[0]+Math.random()*(d.reaction[1]-d.reaction[0]);
    if(f.grounded&&f.ai.jumpCd<=0&&Math.random()<d.recoverSkill){jump(f);f.ai.jumpCd=d.jumpCd}
    const rival=fighters.find(t=>t!==f&&!t.finished&&Math.abs(t.x-f.x)<.06&&Math.abs(t.y-f.y)<.08);
    if(rival&&Math.random()<d.heavyChance){f.face=rival.x>f.x?1:-1;raceSabotage(f)}
  }
  f.vx+=f.ai.dir*.0016*d.accel*(dt*60);
}
```

- [ ] **Step 4: Manual verification**

Preview stack as before. Confirm a light-attack press while in race mode knocks a nearby rival down several tower rows (visible altitude loss) instead of dealing damage, that missing the tight hitbox does nothing (no auto-aim), and that touching the rising hazard band also slides a fighter down (more than a sabotage hit) with a brief invulnerability window afterward so they aren't instantly caught again.

- [ ] **Step 5: Commit**

```bash
git add app/games/phantom-rumble.html
git commit -m "feat(phantom-rumble): add Race to the Top sabotage and rising-hazard knockdown"
```

---

## Task 4: Mode-exclusive pickups — Grapple Dash, Shield Bubble

**Files:**
- Modify: `app/games/phantom-rumble.html` — add `raceSpawnPickup()`, `raceGrabPickups(f)` (referenced by `raceStep` in Task 2), `drawRacePickup(p,t)`.

**Interfaces:**
- Consumes: `f.grappleReady`, `f.shieldBubble` (Task 1's `makeRaceFighter`).
- Produces: reuses the existing `pickups` array (shared, but Race mode spawns/reads different `kind` values — safe since brawl and race mode never run concurrently in the same page instance).

- [ ] **Step 1: Add spawn/grab/draw for the two race pickups**

Add directly after `raceSabotage` (Task 3). This replaces the Task 2 no-op `raceGrabPickups` stub with the real implementation — same name and signature, so `raceStep`'s existing call site is untouched:
```js
let racePickupTimer=5;
function raceSpawnPickup(){
  const kinds=['grapple','bubble'];
  const kind=kinds[Math.floor(Math.random()*kinds.length)];
  const platform=TOWER[Math.floor(Math.random()*(TOWER.length-1))]; // never the summit
  pickups.push({kind,x:platform.x,y:platform.y-.06,age:0,fuse:null});
}
function raceGrabPickups(f){
  for(const p of pickups){
    if(p.taken)continue;
    if(Math.abs(p.x-f.x)<.04&&Math.abs(p.y-f.y)<.06){
      p.taken=true;
      if(p.kind==='grapple'){f.grappleReady=true;spawnBurst(f.x,f.y,'#5eead4',14);addFloater(f.x,f.y-.09,'GRAPPLE READY','#5eead4',14);sfx('pickup')}
      if(p.kind==='bubble'){f.shieldBubble=8;spawnBurst(f.x,f.y,'#a78bfa',14);addFloater(f.x,f.y-.09,'SHIELD UP','#a78bfa',14);sfx('pickup')}
    }
  }
  pickups=pickups.filter(item=>!item.taken);
}
function drawRacePickup(p,t){
  if(p.taken)return;
  const bx=px(p.x),by=py(p.y)-(reduced?0:Math.sin(t*.004+p.age)*4*DPR);
  ctx.shadowBlur=16*DPR;
  if(p.kind==='grapple'){ctx.shadowColor='#5eead4';ctx.fillStyle='#5eead4';ctx.font=`${16*DPR}px ui-monospace`;ctx.fillText('🪝',bx-8*DPR,by)}
  if(p.kind==='bubble'){ctx.shadowColor='#a78bfa';ctx.fillStyle='#a78bfa';ctx.font=`${16*DPR}px ui-monospace`;ctx.fillText('🛡',bx-8*DPR,by)}
  ctx.shadowBlur=0;
}
```

- [ ] **Step 2: Spawn race pickups on a timer, and consume the grapple dash on jump input**

In `loop()`'s race branch (Task 2 Step 4), add pickup spawning directly after `stepHazard(dt);`:
```js
  if(mode==='racetop'){
    stepHazard(dt);
    racePickupTimer-=dt;
    if(racePickupTimer<=0){racePickupTimer=6+Math.random()*4;if(pickups.filter(p=>!p.taken).length<2)raceSpawnPickup()}
    for(const p of pickups)p.age+=dt;
    for(const f of fighters)raceStep(f,dt);
    updateRaceHud();
    stepParticles(dt);
    draw(t);
    raf=requestAnimationFrame(loop);
    return;
  }
```

Consume the grapple dash on the existing `jump` keybind when armed — extend the `keydown` listener's jump line:
```js
    if(pad.jump.includes(e.key)){
      if(mode==='racetop'&&f.grappleReady){
        f.grappleReady=false;
        const dir=heldDir(f)||f.face||1;
        f.vx=dir*.03;f.vy=-.032;f.jumps=1;
        spawnBurst(f.x,f.y,'#5eead4',16);addFloater(f.x,f.y-.1,'GRAPPLE!','#5eead4',15);sfx('jump');
      }else jump(f);
    }
```

Make `drawPickup`'s call site (inside `draw()`, `app/games/phantom-rumble.html:583`) branch to the race variant:
```js
  for(const p of pickups)(mode==='racetop'?drawRacePickup:drawPickup)(p,t);
```

Shield Bubble's actual effect (blocking a sabotage hit) is already wired via Task 3's `raceSabotage`'s `t.shieldBubble>0` skip condition — no further change needed here.

- [ ] **Step 3: Manual verification**

Preview stack as before. Confirm grapple and shield pickups spawn on tower platforms (never the summit), grabbing a grapple then pressing jump launches the fighter further/faster than a normal jump and consumes the buff, and grabbing a shield bubble makes the fighter immune to a sabotage hit (but not to the rising hazard) for its duration.

- [ ] **Step 4: Commit**

```bash
git add app/games/phantom-rumble.html
git commit -m "feat(phantom-rumble): add Grapple Dash and Shield Bubble pickups to Race to the Top"
```

---

## Task 5: Win condition, finish-order results, and altitude/danger HUD

**Files:**
- Modify: `app/games/phantom-rumble.html` — replace the Task 2 no-op `finishRace(f)` with the real implementation; add `buildRaceHud()`/`updateRaceHud()`; extend `endMatch` handling for a race-specific results path.

**Interfaces:**
- Consumes: `f.finished`, `f.place`, `f.altitude` (Task 1).
- Produces: `let raceFinishOrder=[]` (module state, reset in `startRaceMatch`); `function finishRace(f)` (replaces the Task 2 stub); `function endRaceMatch()`.

- [ ] **Step 1: Replace the stub `finishRace` with the real implementation**

Replace the Task 2 stub:
```js
function finishRace(f){f.finished=true}
```
with:
```js
function finishRace(f){
  if(f.finished)return;
  f.finished=true;f.place=raceFinishOrder.length+1;
  raceFinishOrder.push(f.slot);
  addFloater(f.x,f.y-.14,f.place===1?'1st!':f.place===2?'2nd!':f.place===3?'3rd!':'4th!',f.color,f.place===1?26:18);
  sfx(f.place===1?'ko':'pickup');
  const remaining=fighters.filter(t=>!t.finished);
  if(f.place===1||remaining.length===0)endRaceMatch();
}
```

- [ ] **Step 2: Add `buildRaceHud`/`updateRaceHud`**

Add directly after `updateHud()` (`app/games/phantom-rumble.html:481-488`). This replaces the Task 2 no-op stubs with the real HUD builder/updater — same names, so `startRaceMatch()`'s and `loop()`'s existing call sites are untouched:
```js
function buildRaceHud(){
  hudEl.innerHTML=fighters.map(f=>`<div class="fighter-card" style="border-color:${f.color}55"><i style="color:${f.color}">${f.name}${f.human?'':' · BOT'}</i><b data-alt="${f.slot}" style="color:${f.color}">0%</b><s data-place="${f.slot}" style="color:${f.color}"></s></div>`).join('')
    +`<div class="fighter-card" style="min-width:160px"><i>DANGER</i><b data-danger style="color:#fb923c">0%</b></div>`;
}
function updateRaceHud(){
  const towerHeight=(TOWER_ROWS+1)*ROW_STEP;
  for(const f of fighters){
    const alt=hudEl.querySelector(`[data-alt="${f.slot}"]`),place=hudEl.querySelector(`[data-place="${f.slot}"]`);
    if(alt)alt.textContent=`${Math.round(Math.min(100,f.altitude/towerHeight*100))}%`;
    if(place)place.textContent=f.finished?`#${f.place}`:'';
  }
  const lowest=fighters.filter(f=>!f.finished).reduce((min,f)=>Math.max(min,f.y-hazardY),0);
  const dangerEl=hudEl.querySelector('[data-danger]');
  if(dangerEl)dangerEl.textContent=`${Math.max(0,Math.min(100,Math.round(100-lowest/.3*100)))}%`;
}
```

- [ ] **Step 3: Add `endRaceMatch()`**

Add directly after `endMatch()` (`app/games/phantom-rumble.html:440-453`):
```js
function endRaceMatch(){
  if(raf){cancelAnimationFrame(raf);raf=0}
  running=false;over=true;stats.matches+=1;
  const finishedHuman=fighters.find(f=>f.human&&f.place===1);
  if(finishedHuman)stats.wins+=1;
  host('score',{score:400});
  host('complete',{score:400,progress:100,state:null});
  const order=fighters.filter(f=>f.finished).sort((a,b)=>a.place-b.place).concat(fighters.filter(f=>!f.finished));
  const titleEl=document.querySelector('[data-endtitle]');
  const winner=order[0];
  titleEl.textContent=winner&&winner.finished?`${winner.name} REACHES THE TOP`:'RACE OVER';
  titleEl.style.color=winner?winner.color:'';
  titleEl.style.textShadow=winner?`0 0 28px ${winner.glow}`:'';
  document.querySelector('[data-endcopy]').textContent=order.map((f,i)=>`${i+1}. ${f.name}${f.human?'':' (bot)'}${f.finished?'':' — still climbing'}`).join('  ·  ');
  endEl.hidden=false;hudEl.hidden=true;document.querySelector('[data-touch]').hidden=true;
  stopRaceMusic();
}
```

- [ ] **Step 4: Manual verification**

Preview stack as before. Play a full Race to the Top match to completion (climb to the gold summit platform), confirm the results screen shows finish order (not KO stats), that the winner's name/color are correct, and that the HUD during the match shows a percent-to-summit altitude readout per player plus a shared danger meter that rises as the hazard closes in on the lowest player.

- [ ] **Step 5: Commit**

```bash
git add app/games/phantom-rumble.html
git commit -m "feat(phantom-rumble): add Race to the Top win condition, finish order, and altitude HUD"
```

---

## Task 6: Procedural 8-bit soundtrack

**Files:**
- Modify: `app/games/phantom-rumble.html` — extend the existing `audio()`/`tone()` Web Audio helpers (currently lines 174-194) with a small step-sequencer; call it from `startRaceMatch()`/`endRaceMatch()`.

**Interfaces:**
- Consumes: `audio()` (existing, returns the shared `AudioContext` or `null` if muted/unsupported), `soundOn` (existing mute state).
- Produces: `function startRaceMusic()`; `function stopRaceMusic()`.

- [ ] **Step 1: Add the sequencer**

Add directly after the existing `sfx(kind)` function (`app/games/phantom-rumble.html:186-194`). This replaces the Task 2 `startRaceMusic`/`stopRaceMusic` no-op stubs with the real sequencer — same names, so `startRaceMatch()`/`endRaceMatch()`'s existing call sites are untouched:
```js
/* ---------- Race to the Top soundtrack: procedural 8-bit sequencer ----------
   No audio files (CSP: media-src 'none') — same oscillator approach as the
   existing tone()/sfx() SFX, just scheduled as a loop. Melody (square) +
   bass (triangle) + a short noise-like square blip for percussion, tempo
   creeping up as the danger meter closes in. Only runs during Race to the
   Top; brawl-mode audio is untouched. */
const RACE_MELODY=[659,784,880,784,988,880,784,659,880,784,659,587,659,784,988,1175];
const RACE_BASS=[220,220,247,247,262,262,220,196];
let raceMusicTimer=null,raceMusicStep=0;
function raceMusicTick(){
  if(!soundOn||mode!=='racetop'){return}
  const urgency=Math.min(1,(hazardSpeed-.01)/.04); // 0 at match start, approaches 1 as hazardSpeed nears its cap
  const stepMs=Math.max(95,150-urgency*55);
  const note=RACE_MELODY[raceMusicStep%RACE_MELODY.length];
  tone(note,.09,'square',.02,1);
  if(raceMusicStep%2===0)tone(RACE_BASS[(raceMusicStep/2|0)%RACE_BASS.length],.14,'triangle',.03,1);
  if(raceMusicStep%4===0)tone(90,.03,'square',.018,.3);
  raceMusicStep+=1;
  raceMusicTimer=setTimeout(raceMusicTick,stepMs);
}
function startRaceMusic(){
  stopRaceMusic();
  raceMusicStep=0;
  raceMusicTick();
}
function stopRaceMusic(){
  if(raceMusicTimer){clearTimeout(raceMusicTimer);raceMusicTimer=null}
}
```

- [ ] **Step 2: Stop the loop on exit/menu return, not just on race-match end**

`startRaceMatch()` already calls `startRaceMusic()` (Task 2 Step 3) and `endRaceMatch()` already calls `stopRaceMusic()` (Task 5 Step 3) — additionally guard the other exit paths. In `resetToMenu()` (`app/games/phantom-rumble.html:613-623`), add `stopRaceMusic();` alongside the existing resets:
```js
function resetToMenu(){
  cancelAnimationFrame(raf);
  running=false;paused=false;over=false;mode='';
  fighters=[];pickups=[];particles=[];floaters=[];rings=[];projectiles=[];matchKos=[0,0,0,0];stats={wins:0,matches:0,bestKos:0};pickupTimer=6;shake=0;slowmo=0;keys.clear();
  stopRaceMusic();
  document.body.classList.remove('paused');
  hudEl.hidden=true;endEl.hidden=true;setupEl.hidden=false;
  const touch=document.querySelector('[data-touch]');
  if(touch)touch.hidden=true;
  showPb();
  draw(0);
}
```

In the host-protocol `exit` handler (`app/games/phantom-rumble.html:636-646`, already calls `resetToMenu()` which now stops the music) — no additional change needed there since `resetToMenu()` covers it.

- [ ] **Step 3: Manual verification**

Preview stack as before. Start a Race to the Top match, confirm a fast arpeggiated 8-bit melody with a bassline and light percussion loops continuously, tempo audibly quickening as the match goes on (the hazard's `hazardSpeed` climbing toward its cap), and that leaving the match (menu button or finishing) stops the music — confirm brawl-mode matches still have their existing SFX-only audio with no music layered in.

- [ ] **Step 4: Commit**

```bash
git add app/games/phantom-rumble.html
git commit -m "feat(phantom-rumble): add procedural 8-bit soundtrack for Race to the Top"
```
