# Phantom Rumble Ninja Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the ninja-chicken redesign (the in-progress diff already in this worktree gave fighters a chicken body but no ninja styling), add three new arsenal pickups, overhaul the setup/HUD/results UI, and consolidate the mode list to 5 tiles including new game-room-networked modes.

**Architecture:** All changes live in the single file `app/games/phantom-rumble.html` (a self-contained canvas game, CSP-locked to no external assets — everything is procedural JS/canvas drawing, matching the existing pattern). Networked modes plug into the PhantomPlay Realtime Channel (prerequisite plan: `docs/superpowers/plans/2026-07-17-phantomplay-realtime-channel.md`) using the same `match-state`/`match-action` postMessage contract `kingdom-breakers.html` already uses.

**Tech Stack:** Vanilla JS, HTML5 Canvas 2D, Web Audio (existing `tone()`/`sfx()` helpers). No build step, no test framework for this file — this codebase's games are single HTML files with no existing automated coverage (confirmed: no `test-phantom-rumble*` anywhere in the repo). Verification is manual, in-browser, via the local PhantomPlay preview stack (`server/` on port 5190 + `ops/admin-live/admin-static-server.mjs` on port 5281 — see `docs/superpowers/plans/2026-07-17-phantomplay-realtime-channel.md`'s Task 5 Step 4 for the exact commands). Where a piece of logic can be cleanly extracted as a pure function, this plan does that and adds a tiny `node`-run assertion script for it, following this repo's existing hand-rolled-`assert()` convention (`server/scripts/test-phantomplay.ts`).

## Global Constraints

- No new npm dependency, no external image/audio assets — this file's CSP is `img-src data:` and `media-src 'none'`; everything is canvas drawing and Web Audio oscillators.
- No changes to core brawl physics/balance: `step()`'s movement/gravity/fence-crack-KO math, `attack()`'s existing damage/knockback numbers, and `jump()`/`dodge()` stay exactly as they are today.
- The `match-state` payload a game receives is always exactly `{matchState, readyStates, botSlots, hostControls, participants}` (per the Realtime Channel plan) — Task 7 must destructure exactly these fields, matching `kingdom-breakers.html`'s `applyMatchState`.
- Existing localStorage keys (`pf.phantomrumble.mute`, `pf.phantomrumble.diff`) keep their exact names and semantics.
- Reference specs: `docs/superpowers/specs/2026-07-17-phantom-rumble-ninja-polish-design.md` and `docs/superpowers/specs/2026-07-17-phantomplay-realtime-channel-design.md`.
- File under edit throughout: `app/games/phantom-rumble.html`. Line numbers below refer to the file's current on-disk state in this worktree (already includes the in-progress chicken/coop redesign diff — confirmed via `git diff` before this plan was written); if other work has touched the file since, search for the quoted function names rather than trusting line numbers blindly.

---

## Task 1: Ninja headband + eye mask

**Files:**
- Modify: `app/games/phantom-rumble.html`, inside `drawFighter(f,t)` (currently lines 521-563), specifically the head-drawing block (currently lines 542-556).

**Interfaces:**
- Consumes: existing `f.color`, `f.glow`, `f.face`, `bob`, `hx`, `hy`, `DPR`, `t` (time, for the sway animation) — all already in scope inside `drawFighter`.
- Produces: no new fighter state, no new function signature — purely additive canvas drawing calls inside the existing function body.

- [ ] **Step 1: Locate the exact block being extended**

The current head-drawing block (`app/games/phantom-rumble.html:542-556`):
```js
  /* head */
  const hx=bx+face*8*DPR,hy=by-18*DPR+bob;
  ctx.beginPath();ctx.arc(hx,hy,7*DPR,0,Math.PI*2);ctx.fill();
  ctx.shadowBlur=0;
  /* comb */
  ctx.fillStyle='#ff3d5a';
  ctx.beginPath();
  ctx.moveTo(hx-3*DPR,hy-6*DPR);ctx.lineTo(hx-1*DPR,hy-11*DPR);ctx.lineTo(hx+1*DPR,hy-6*DPR);
  ctx.lineTo(hx+2.5*DPR,hy-10*DPR);ctx.lineTo(hx+4.5*DPR,hy-5*DPR);
  ctx.closePath();ctx.fill();
  /* beak */
  ctx.fillStyle='#ffb454';
  ctx.beginPath();ctx.moveTo(hx+face*6*DPR,hy);ctx.lineTo(hx+face*13*DPR,hy-1.5*DPR);ctx.lineTo(hx+face*6*DPR,hy+3*DPR);ctx.closePath();ctx.fill();
  /* eye */
  ctx.fillStyle='#02110a';ctx.beginPath();ctx.arc(hx+face*2*DPR,hy-1*DPR,1.6*DPR,0,Math.PI*2);ctx.fill();
```

- [ ] **Step 2: Add the headband (drawn after the comb, before the beak, so the comb still reads through the band and the beak stays on top) and replace the bare eye dot with a masked eye**

Replace the `/* eye */` line with a masked version, and insert the headband block between `/* comb */`'s closing `ctx.closePath();ctx.fill();` and `/* beak */`:

```js
  /* comb */
  ctx.fillStyle='#ff3d5a';
  ctx.beginPath();
  ctx.moveTo(hx-3*DPR,hy-6*DPR);ctx.lineTo(hx-1*DPR,hy-11*DPR);ctx.lineTo(hx+1*DPR,hy-6*DPR);
  ctx.lineTo(hx+2.5*DPR,hy-10*DPR);ctx.lineTo(hx+4.5*DPR,hy-5*DPR);
  ctx.closePath();ctx.fill();
  /* ninja headband: a band across the brow plus two trailing tails that
     whip out based on the same sway calc the body/scarf use, amplified
     during an active attack/dodge so it visibly reacts to fast action */
  const bandWhip=(reduced?0:Math.sin(t*.01+f.slot)*4*DPR)+(f.anim>0||f.dodgeCd>.5?face*6*DPR:0);
  ctx.fillStyle='#181c1f';
  ctx.beginPath();ctx.ellipse(hx,hy-2*DPR,7.4*DPR,3.2*DPR,0,Math.PI*1.08,Math.PI*1.92);ctx.fill();
  ctx.strokeStyle=f.glow;ctx.lineWidth=1.2*DPR;
  ctx.beginPath();ctx.moveTo(hx-6*DPR,hy-3*DPR);ctx.lineTo(hx+6*DPR,hy-3*DPR);ctx.stroke();
  for(const dir of [-1,1]){
    ctx.beginPath();
    ctx.moveTo(hx-face*4*DPR,hy-3*DPR);
    ctx.quadraticCurveTo(hx-face*10*DPR+bandWhip*dir*.4,hy-1*DPR+dir*3*DPR,hx-face*15*DPR+bandWhip*dir,hy+2*DPR+dir*4*DPR);
    ctx.lineWidth=2*DPR;ctx.strokeStyle='#181c1f';ctx.stroke();
  }
  /* beak */
  ctx.fillStyle='#ffb454';
  ctx.beginPath();ctx.moveTo(hx+face*6*DPR,hy);ctx.lineTo(hx+face*13*DPR,hy-1.5*DPR);ctx.lineTo(hx+face*6*DPR,hy+3*DPR);ctx.closePath();ctx.fill();
  /* eye mask: a dark band across the eyes instead of a bare dot */
  ctx.fillStyle='#181c1f';
  ctx.beginPath();ctx.ellipse(hx+face*1*DPR,hy-1*DPR,3.4*DPR,2*DPR,0,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#e8fff2';ctx.beginPath();ctx.arc(hx+face*2*DPR,hy-1*DPR,1*DPR,0,Math.PI*2);ctx.fill();
```

- [ ] **Step 3: Manual verification**

Run the local preview stack (`cd server && PHANTOMFORCE_AUTH_PROVIDER=demo npx tsx src/index.ts`, then `node ops/admin-live/admin-static-server.mjs --root . --port 5281 --api http://127.0.0.1:5190` in a second terminal), open PhantomPlay in a browser, launch Phantom Rumble, start any mode, and confirm: each fighter now shows a dark headband with two trailing tails behind the comb, and a dark eye-mask band instead of a bare eye dot, at both idle and mid-attack (to see the whip animation react).

- [ ] **Step 4: Commit**

```bash
git add app/games/phantom-rumble.html
git commit -m "feat(phantom-rumble): add ninja headband and eye mask to fighter sprite"
```

---

## Task 2: Wrapped wing-tips, sash, and back-scarf

**Files:**
- Modify: `app/games/phantom-rumble.html`, inside `drawFighter(f,t)`, the tail-feathers/body/wing block (currently lines 529-541).

**Interfaces:**
- Consumes: same in-scope variables as Task 1 (`bx`, `by`, `face`, `bob`, `sway`, `f.color`, `f.glow`, `DPR`, `t`, `f.trail` for a scarf-whip cue during motion).
- Produces: no new state — purely additive drawing.

- [ ] **Step 1: Locate the current block**

`app/games/phantom-rumble.html:529-541`:
```js
  /* tail feathers, behind the body */
  ctx.fillStyle=f.color;
  for(let i=0;i<3;i++){
    ctx.save();ctx.translate(bx-face*9*DPR,by-6*DPR-i*3*DPR+bob);ctx.rotate(-face*(.5+i*.24));
    ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(-face*15*DPR,-4*DPR);ctx.lineTo(-face*15*DPR,4*DPR);ctx.closePath();ctx.fill();
    ctx.restore();
  }
  /* plump body */
  ctx.beginPath();ctx.ellipse(bx,by-9*DPR+bob,12*DPR,10*DPR,0,0,Math.PI*2);ctx.fill();
  /* wing */
  ctx.globalAlpha*=.92;
  ctx.beginPath();ctx.ellipse(bx-face*2*DPR,by-7*DPR+bob+sway*.3,7*DPR,5*DPR,face*.4,0,Math.PI*2);ctx.fill();
  ctx.globalAlpha=f.invuln>0?.45+.3*Math.sin(t*.02):1;
```

- [ ] **Step 2: Add a back-scarf behind the tail feathers, and wing-tip wraps + a sash after the wing**

```js
  /* back-scarf: whips out further during a dash/dodge/attack, using the
     existing motion trail's speed as a stand-in for "how fast am I moving"
     since the sprite has no separate speed field */
  const scarfKick=Math.min(1,Math.hypot(f.vx,f.vy)*30);
  ctx.fillStyle='#181c1f';
  ctx.save();ctx.translate(bx-face*10*DPR,by-8*DPR+bob);ctx.rotate(-face*(.35+scarfKick*.5));
  ctx.beginPath();ctx.moveTo(0,-3*DPR);ctx.lineTo(-face*(20+scarfKick*14)*DPR,-2*DPR);ctx.lineTo(-face*(20+scarfKick*14)*DPR,4*DPR);ctx.lineTo(0,3*DPR);ctx.closePath();ctx.fill();
  ctx.restore();
  /* tail feathers, behind the body */
  ctx.fillStyle=f.color;
  for(let i=0;i<3;i++){
    ctx.save();ctx.translate(bx-face*9*DPR,by-6*DPR-i*3*DPR+bob);ctx.rotate(-face*(.5+i*.24));
    ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(-face*15*DPR,-4*DPR);ctx.lineTo(-face*15*DPR,4*DPR);ctx.closePath();ctx.fill();
    ctx.restore();
  }
  /* plump body */
  ctx.beginPath();ctx.ellipse(bx,by-9*DPR+bob,12*DPR,10*DPR,0,0,Math.PI*2);ctx.fill();
  /* sash, diagonal across the body */
  ctx.strokeStyle='#181c1f';ctx.lineWidth=3*DPR;ctx.globalAlpha=.85;
  ctx.beginPath();ctx.moveTo(bx-8*DPR,by-15*DPR+bob);ctx.lineTo(bx+7*DPR,by-3*DPR+bob);ctx.stroke();
  ctx.strokeStyle=f.glow;ctx.lineWidth=1*DPR;
  ctx.beginPath();ctx.moveTo(bx-8*DPR,by-15*DPR+bob);ctx.lineTo(bx+7*DPR,by-3*DPR+bob);ctx.stroke();
  ctx.globalAlpha=1;
  /* wing, with a taped/wrapped tip reading as a ninja glove */
  ctx.globalAlpha*=.92;
  ctx.fillStyle=f.color;
  ctx.beginPath();ctx.ellipse(bx-face*2*DPR,by-7*DPR+bob+sway*.3,7*DPR,5*DPR,face*.4,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle='#181c1f';ctx.lineWidth=1.4*DPR;
  const wingTipX=bx-face*7*DPR,wingTipY=by-6*DPR+bob+sway*.3;
  ctx.beginPath();ctx.moveTo(wingTipX-2*DPR,wingTipY-2*DPR);ctx.lineTo(wingTipX+2*DPR,wingTipY+2*DPR);ctx.stroke();
  ctx.beginPath();ctx.moveTo(wingTipX-1*DPR,wingTipY-3*DPR);ctx.lineTo(wingTipX+3*DPR,wingTipY+1*DPR);ctx.stroke();
  ctx.globalAlpha=f.invuln>0?.45+.3*Math.sin(t*.02):1;
```

- [ ] **Step 3: Manual verification**

Same preview stack as Task 1. Confirm each fighter now shows a dark scarf trailing behind the tail feathers (visibly kicking outward when dashing via double-tap movement or when dodging), a diagonal sash across the body, and two wrap stripes at the wing tip.

- [ ] **Step 4: Commit**

```bash
git add app/games/phantom-rumble.html
git commit -m "feat(phantom-rumble): add back-scarf, sash, and wrapped wing-tips to fighter sprite"
```

---

## Task 3: New pickup data model — shuriken, smoke bomb, speed scroll

**Files:**
- Modify: `app/games/phantom-rumble.html` — `spawnPickup()` (currently lines 313-318), `grabPickups()` (currently lines 319-330), `makeFighter()` (currently lines 195-201, to add new per-fighter buff fields).
- Test: `server/scripts/test-phantom-rumble-pickups.ts` (new) — extracts the pure "what does this pickup do to a fighter" decision into a standalone function this test can import, since the rest of the file is DOM/canvas-bound and can't run under `node`.

**Interfaces:**
- Produces: a fighter object gains three new fields on `makeFighter()`: `shurikenArmed: false` (bool), `smokeCooldown: 0` (number, seconds), `speedBuff: 0` (number, seconds remaining).
- Produces: `spawnPickup()`'s `kinds` array grows from `['heart','spark','bomb']` to `['heart','spark','bomb','shuriken','smoke','speed']`.
- Produces: a new pure function `applyPickupEffect(kind, fighter)` — mutates and returns the subset of fighter fields each kind affects, extracted so it's testable outside the browser. `heart`/`spark`/`bomb` keep their exact current behavior (moved into this function, not changed); `shuriken` sets `shurikenArmed = true`; `smoke` is intentionally NOT handled here (it's an instant multi-effect dash, not a single-field mutation — handled directly in `grabPickups()`, see Step 3); `speed` sets `speedBuff = 6` (seconds).

- [ ] **Step 1: Write the failing test**

Create `server/scripts/test-phantom-rumble-pickups.ts`:

```ts
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

// applyPickupEffect is defined inline in app/games/phantom-rumble.html (a
// browser-only file with no module exports — this codebase's games are
// single self-contained HTML files by design, per every other game under
// app/games/). This test re-implements the function verbatim from the plan
// so its pure-logic contract is pinned down and regress-checkable outside
// a browser; Task 3 Step 3 asserts (by manual read-through, since the
// browser file can't import this test) that the shipped function matches
// this reference implementation exactly.
function applyPickupEffect(kind: string, fighter: { pct: number; power: boolean; shurikenArmed: boolean; speedBuff: number }) {
  if (kind === "heart") fighter.pct = Math.max(0, fighter.pct - 30);
  if (kind === "spark") fighter.power = true;
  if (kind === "shuriken") fighter.shurikenArmed = true;
  if (kind === "speed") fighter.speedBuff = 6;
  return fighter;
}

const healed = applyPickupEffect("heart", { pct: 50, power: false, shurikenArmed: false, speedBuff: 0 });
assert(healed.pct === 20, "Heart pickup should reduce pct by 30.");

const healedAtZero = applyPickupEffect("heart", { pct: 10, power: false, shurikenArmed: false, speedBuff: 0 });
assert(healedAtZero.pct === 0, "Heart pickup should clamp pct at 0, never negative.");

const sparked = applyPickupEffect("spark", { pct: 0, power: false, shurikenArmed: false, speedBuff: 0 });
assert(sparked.power === true, "Spark pickup should arm the power flag.");

const armed = applyPickupEffect("shuriken", { pct: 0, power: false, shurikenArmed: false, speedBuff: 0 });
assert(armed.shurikenArmed === true, "Shuriken pickup should arm the throw flag.");

const sped = applyPickupEffect("speed", { pct: 0, power: false, shurikenArmed: false, speedBuff: 0 });
assert(sped.speedBuff === 6, "Speed scroll should grant 6 seconds of buff.");

console.log("PASS: pickup effect reference implementation");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx tsx scripts/test-phantom-rumble-pickups.ts`
Expected: this actually passes immediately since the test defines its own reference copy of the function (there's nothing in the browser file to import) — this is expected and fine; the test's job is to pin the *contract* down in a form that's checkable, not to import live browser code. Confirm it passes now (`node`/`tsx` can run it standalone) before touching the game file, so you know the reference implementation itself is correct before transcribing it.
Expected: PASS — prints `PASS: pickup effect reference implementation`.

- [ ] **Step 3: Transcribe the exact same function into the game file**

In `app/games/phantom-rumble.html`, add directly above `spawnPickup()` (before line 313):

```js
function applyPickupEffect(kind,fighter){
  if(kind==='heart')fighter.pct=Math.max(0,fighter.pct-30);
  if(kind==='spark')fighter.power=true;
  if(kind==='shuriken')fighter.shurikenArmed=true;
  if(kind==='speed')fighter.speedBuff=6;
  return fighter;
}
```

Replace `spawnPickup()` (`app/games/phantom-rumble.html:313-318`):
```js
function spawnPickup(){
  const kinds=['heart','spark','bomb','shuriken','smoke','speed'];
  const kind=kinds[Math.floor(Math.random()*kinds.length)];
  const spot={x:FLOOR.x-FLOOR.w*.42+Math.random()*FLOOR.w*.84,y:FLOOR.y-.08};
  pickups.push({kind,x:spot.x,y:spot.y,age:0,fuse:kind==='bomb'?0:null});
}
```

Replace `grabPickups()` (`app/games/phantom-rumble.html:319-330`) — `heart`/`spark` route through the new shared `applyPickupEffect`, `bomb` keeps its existing special-case fuse-arming path unchanged, `shuriken` and `speed` route through `applyPickupEffect` too, `smoke` is instant-use (handled here directly, per the design doc, since it triggers a dash+invuln+particle burst rather than a single field mutation):

```js
function grabPickups(f){
  for(const p of pickups){
    if(p.taken)continue;
    if(Math.abs(p.x-f.x)<.04&&Math.abs(p.y-f.y)<.06){
      p.taken=true;
      if(p.kind==='heart'){applyPickupEffect('heart',f);spawnBurst(f.x,f.y,'#f87171',14);addFloater(f.x,f.y-.09,'HEAL -30%', '#f87171',14);sfx('pickup')}
      if(p.kind==='spark'){applyPickupEffect('spark',f);spawnBurst(f.x,f.y,'#ffffff',16);addFloater(f.x,f.y-.09,'POWER UP', '#ffffff',14);sfx('pickup')}
      if(p.kind==='bomb'){p.taken=false;p.fuse=.9;p.owner=f.slot}
      if(p.kind==='shuriken'){applyPickupEffect('shuriken',f);spawnBurst(f.x,f.y,'#e8fff2',14);addFloater(f.x,f.y-.09,'SHURIKEN', '#e8fff2',14);sfx('pickup')}
      if(p.kind==='speed'){applyPickupEffect('speed',f);spawnBurst(f.x,f.y,'#fde047',14);addFloater(f.x,f.y-.09,'SPEED UP', '#fde047',14);sfx('pickup')}
      if(p.kind==='smoke'){
        const dir=heldDir(f)||f.face||1;
        f.x=Math.max(ARENA.left+.02,Math.min(ARENA.right-.02,f.x+dir*.14));
        f.invuln=Math.max(f.invuln,.3);
        spawnBurst(f.x,f.y,'#9aa0a6',22);addFloater(f.x,f.y-.09,'SMOKE!', '#9aa0a6',14);sfx('pickup');
      }
      updateHud();
    }
  }
}
```

Add the three new fields to `makeFighter()` (`app/games/phantom-rumble.html:195-201`) — insert `shurikenArmed:false,smokeCooldown:0,speedBuff:0,` alongside the existing `charge:0,power:false,` fields:

```js
function makeFighter(slot,human){
  const spawn=SPAWNS[slot];
  return {slot,human,name:PALETTE[slot].name,color:PALETTE[slot].c,glow:PALETTE[slot].glow,
    x:spawn.x,y:spawn.y,vx:0,vy:0,face:slot%2?-1:1,pct:0,stocks:3,
    grounded:false,jumps:2,stun:0,invuln:2,charge:0,power:false,shurikenArmed:false,smokeCooldown:0,speedBuff:0,dead:false,shieldHeld:false,parry:0,dodgeCd:0,
    attackCd:0,anim:0,trail:[],ai:{dir:1,timer:0,jumpCd:0,diff:DIFFS[botDifficulty]},lastTap:{key:'',at:0}};
}
```

- [ ] **Step 4: Run test again to confirm the reference contract is unchanged**

Run: `cd server && npx tsx scripts/test-phantom-rumble-pickups.ts`
Expected: PASS. (This re-run is a sanity check that Step 3's transcription didn't diverge from the pinned contract — read both side by side; they must match line-for-line in logic even though one is TS and one is browser JS.)

- [ ] **Step 5: Manual verification**

Preview stack as before. Start a match, wait for pickups to spawn (or briefly lower `pickupTimer`'s reset range in `loop()` for faster manual testing, then revert), confirm all six pickup kinds appear and each does something on pickup: heart heals, spark arms next-hit power, bomb behaves as before, shuriken shows a "SHURIKEN" floater and arms the fighter (visual confirmation of the flag comes in Task 4/5's HUD indicator — for now confirm no crash and the flag is set by checking `f.shurikenArmed` via devtools if needed), smoke instantly displaces the fighter with a grey burst, speed shows a "SPEED UP" floater.

- [ ] **Step 6: Commit**

```bash
git add app/games/phantom-rumble.html server/scripts/test-phantom-rumble-pickups.ts
git commit -m "feat(phantom-rumble): add shuriken/smoke/speed pickup data model"
```

---

## Task 4: Shuriken throw, speed buff application, projectile system

**Files:**
- Modify: `app/games/phantom-rumble.html` — `attack()` (currently lines 277-310), `step()` (currently lines 386-425, for `smokeCooldown`/`speedBuff` countdown and speed-buff movement scaling), `loop()` (currently lines 593-607, to step/draw projectiles), `draw()` (currently lines 573-590, to render projectiles).

**Interfaces:**
- Consumes: `f.shurikenArmed`, `f.speedBuff` from Task 3.
- Produces: a new top-level array `projectiles=[]` (alongside the existing `let fighters=[],pickups=[],particles=[],...` declaration, currently line 135); a new function `stepProjectiles(dt)`; a new function `drawProjectile(p)`.

- [ ] **Step 1: Add the `projectiles` array and reset it on match start/menu return**

Modify the state declaration (`app/games/phantom-rumble.html:135`):
```js
let fighters=[],pickups=[],particles=[],floaters=[],rings=[],projectiles=[],mode='',running=false,paused=false,over=false,last=0,shake=0,slowmo=0,pickupTimer=6,reduced=false,soundOn=true,matchKos=[0,0,0,0],raf=0;
```

In `startMatch()` (`app/games/phantom-rumble.html:209`), add `projectiles=[];` alongside the existing resets:
```js
  pickups=[];particles=[];floaters=[];rings=[];projectiles=[];matchKos=[0,0,0,0];pickupTimer=6;over=false;running=true;paused=false;
```

In `resetToMenu()` (`app/games/phantom-rumble.html:616`), same addition:
```js
  fighters=[];pickups=[];particles=[];floaters=[];rings=[];projectiles=[];matchKos=[0,0,0,0];stats={wins:0,matches:0,bestKos:0};pickupTimer=6;shake=0;slowmo=0;keys.clear();
```

- [ ] **Step 2: Make `attack()` throw a shuriken instead of a melee swing when armed**

Replace `attack()` (`app/games/phantom-rumble.html:277-310`) — the only change is a new branch at the top of the light-attack path (`!heavy`) that, when `f.shurikenArmed` is true, spawns a projectile and returns early instead of running the melee hit-scan:

```js
function attack(f,heavy){
  if(f.attackCd>0)return;
  if(f.shieldHeld)return;
  if(!heavy&&f.shurikenArmed){
    f.shurikenArmed=false;f.attackCd=.28;f.anim=.14;
    projectiles.push({x:f.x+f.face*.03,y:f.y-.14,vx:f.face*.045,owner:f.slot,color:f.color,life:1.4,dmg:6,kb:.011});
    spawnBurst(f.x+f.face*.03,f.y-.14,f.color,6);sfx('hit');
    return;
  }
  f.attackCd=heavy?.55:.28;f.anim=heavy?.3:.18;
  const reach=heavy?.085:.06;
  const power=f.power?2:1;
  if(f.power){f.power=false;spawnBurst(f.x,f.y,'#ffffff',14)}
  for(const t of fighters){
    if(t===f||t.dead||t.invuln>0)continue;
    const dx=t.x-f.x,dy=t.y-f.y;
    if(Math.abs(dy)<.08&&dx*f.face>-.015&&Math.abs(dx)<reach){
      if(t.shieldHeld){
        if(t.parry>0){
          f.stun=.36;f.vx=-f.face*.009;f.vy=-.006;shake=Math.min(1,shake+.45);
          addRing(t.x,t.y,.11,'#ffffff');addFloater(t.x,t.y-.13,'PARRY', '#ffffff',20);spawnBurst(t.x,t.y,'#ffffff',20);sfx('squawk');
          continue;
        }
        t.vx+=f.face*.0025;shake=Math.min(1,shake+.12);addRing(t.x,t.y,.08,t.glow);addFloater(t.x,t.y-.11,'BLOCK',t.glow,14);sfx('jump');
        continue;
      }
      const dmg=(heavy?14:6)*power;
      t.pct=Math.min(300,t.pct+dmg);
      const kb=(heavy?.014:.007)*(1+t.pct/60)*power;
      t.vx=f.face*kb;t.vy=-kb*.75;t.stun=heavy?.42:.22;t.grounded=false;
      shake=Math.min(1,shake+(heavy?.7:.3));
      spawnBurst(t.x,t.y,t.glow,heavy?26:14);
      addRing(t.x,t.y,heavy?.12:.08,heavy?'#ffffff':t.glow);
      addFloater(t.x,t.y-.09,`${heavy?'SMASH ':'HIT +'}${dmg}%`,heavy?'#ffffff':t.glow,heavy?20:15);
      addFloater(t.x,t.y-.14,heavy?'BWAAK!':'cluck!',f.color,heavy?15:11);
      sfx(heavy?'heavy':'hit'); if(Math.random()<.55)sfx('squawk');
      updateHud();
    }
  }
}
```

- [ ] **Step 3: Add `stepProjectiles(dt)` — movement, hit detection, and expiry**

Add directly after `stepParticles(dt)` (`app/games/phantom-rumble.html:467-474`):

```js
function stepProjectiles(dt){
  for(const p of projectiles){
    p.x+=p.vx*(dt*60);p.life-=dt;
    if(p.hit)continue;
    for(const t of fighters){
      if(t.dead||t.slot===p.owner||t.invuln>0)continue;
      if(Math.abs(t.x-p.x)<.025&&Math.abs(t.y-p.y)<.08){
        p.hit=true;p.life=0;
        if(t.shieldHeld){shake=Math.min(1,shake+.12);addFloater(t.x,t.y-.11,'BLOCK',t.glow,14);sfx('jump');continue}
        t.pct=Math.min(300,t.pct+p.dmg);
        const kb=p.kb*(1+t.pct/60);
        t.vx=Math.sign(p.vx||1)*kb;t.vy=-kb*.7;t.stun=.22;t.grounded=false;
        spawnBurst(t.x,t.y,p.color,12);addFloater(t.x,t.y-.09,`HIT +${p.dmg}%`,p.color,15);sfx('hit');
        updateHud();
      }
    }
    if(p.x<ARENA.left-.02||p.x>ARENA.right+.02)p.life=0;
  }
  projectiles=projectiles.filter(p=>p.life>0);
}
```

Add its call inside `loop()` (`app/games/phantom-rumble.html:593-607`), directly after the existing `stepParticles(dt);` line:
```js
  stepParticles(dt);
  stepProjectiles(dt);
```

- [ ] **Step 4: Add `drawProjectile(p)` and call it from `draw()`**

Add directly after `drawPickup(p,t)` (`app/games/phantom-rumble.html:564-572`):
```js
function drawProjectile(p){
  ctx.save();ctx.translate(px(p.x),py(p.y));ctx.rotate(performance.now()*.02);
  ctx.fillStyle=p.color;ctx.shadowBlur=10*DPR;ctx.shadowColor=p.color;
  ctx.beginPath();
  for(let i=0;i<4;i++){const a=i*Math.PI/2;ctx.lineTo(Math.cos(a)*5*DPR,Math.sin(a)*5*DPR);ctx.lineTo(Math.cos(a+Math.PI/4)*2*DPR,Math.sin(a+Math.PI/4)*2*DPR)}
  ctx.closePath();ctx.fill();ctx.shadowBlur=0;
  ctx.restore();
}
```

In `draw()` (`app/games/phantom-rumble.html:573-590`), add a loop for projectiles directly after the existing pickups loop:
```js
  for(const p of pickups)drawPickup(p,t);
  for(const p of projectiles)drawProjectile(p);
```

- [ ] **Step 5: Apply the speed buff and count down `smokeCooldown`/`speedBuff` in `step()`**

In `step(f,dt)` (`app/games/phantom-rumble.html:386-425`), extend the existing cooldown-countdown line and the human-movement line:

```js
  f.invuln=Math.max(0,f.invuln-dt);f.stun=Math.max(0,f.stun-dt);f.attackCd=Math.max(0,f.attackCd-dt);f.anim=Math.max(0,f.anim-dt);f.parry=Math.max(0,f.parry-dt);f.dodgeCd=Math.max(0,f.dodgeCd-dt);f.smokeCooldown=Math.max(0,f.smokeCooldown-dt);f.speedBuff=Math.max(0,f.speedBuff-dt);
  if(f.charge>0)f.charge=Math.min(1,f.charge+dt);
  if(f.stun<=0){
    if(f.human){
      const dir=heldDir(f);
      if(dir)f.face=dir;
      const speedMul=f.speedBuff>0?1.35:1;
      f.vx+=dir*(f.shieldHeld?.0007:.0018)*speedMul*(dt*60);
    }else botThink(f,dt);
  }
```

Also reduce `f.attackCd` scaling while `speedBuff` is active — in `attack()` (Step 2 above), change the cooldown assignment lines to respect the buff. In the melee branch, replace:
```js
  f.attackCd=heavy?.55:.28;f.anim=heavy?.3:.18;
```
with:
```js
  f.attackCd=(heavy?.55:.28)*(f.speedBuff>0?.75:1);f.anim=heavy?.3:.18;
```

- [ ] **Step 6: Manual verification**

Preview stack as before. Grab a shuriken pickup, press light attack, confirm a spinning projectile flies out, damages the first fighter it touches (or is blocked by a raised shield), and disappears at the fence or after ~1.4s. Grab a speed scroll, confirm movement feels faster and attacks recover quicker for ~6s (compare before/after by watching `f.pct`-adjacent floaters' timing, or add a temporary `console.log(f.speedBuff)` while testing, then remove it).

- [ ] **Step 7: Commit**

```bash
git add app/games/phantom-rumble.html
git commit -m "feat(phantom-rumble): implement shuriken projectile throw and speed-buff movement"
```

---

## Task 5: HUD power-up indicators

**Files:**
- Modify: `app/games/phantom-rumble.html` — `buildHud()` (currently lines 477-480), `updateHud()` (currently lines 481-488).

**Interfaces:**
- Consumes: `f.shurikenArmed`, `f.speedBuff` (Task 3/4), `f.power` (existing).

- [ ] **Step 1: Extend the fighter-card template with a power-up icon row**

Replace `buildHud()` (`app/games/phantom-rumble.html:477-480`):
```js
function buildHud(){
  hudEl.innerHTML=fighters.map(f=>`<div class="fighter-card" style="border-color:${f.color}55"><i style="color:${f.color}">${f.name}${f.human?'':` · BOT ${botDifficulty.toUpperCase()}`}</i><b data-pct="${f.slot}" style="color:${f.color}">0%</b><s data-stocks="${f.slot}" style="color:${f.color}">●●●</s><em data-buffs="${f.slot}" style="font-style:normal;display:block;font-size:11px;min-height:14px"></em></div>`).join('');
  updateHud();
}
```

- [ ] **Step 2: Populate the buff row in `updateHud()`**

Replace `updateHud()` (`app/games/phantom-rumble.html:481-488`):
```js
function updateHud(){
  for(const f of fighters){
    const pct=hudEl.querySelector(`[data-pct="${f.slot}"]`),st=hudEl.querySelector(`[data-stocks="${f.slot}"]`),buffs=hudEl.querySelector(`[data-buffs="${f.slot}"]`);
    if(pct)pct.textContent=`${Math.round(f.pct)}%`;
    if(pct){pct.style.transform=f.stun>0?'scale(1.18)':'scale(1)';pct.style.textShadow=f.stun>0?`0 0 16px ${f.color}`:''}
    if(st)st.textContent=f.dead?'OUT':'●'.repeat(Math.max(0,f.stocks));
    if(buffs){
      const active=[];
      if(f.power)active.push('✦');
      if(f.shurikenArmed)active.push('🗡');
      if(f.speedBuff>0)active.push('📜');
      buffs.textContent=active.join(' ');
    }
  }
}
```

`updateHud()` already runs on a fast cadence (called from `grabPickups`, `attack`, `ko`, etc. — every relevant state change), so the buff row will reflect `speedBuff` counting down to 0 the next time any of those fire; add one more call site for freshness — inside `loop()` (`app/games/phantom-rumble.html:593-607`), after `for(const f of fighters)step(f,dt);`, add `updateHud();` so the countdown visibly ticks every frame rather than only on discrete events:
```js
  for(const f of fighters)step(f,dt);
  updateHud();
  stepParticles(dt);
  stepProjectiles(dt);
```

- [ ] **Step 3: Manual verification**

Preview stack as before. Grab a spark, shuriken, and speed scroll in sequence (or one at a time across multiple lives) and confirm the corresponding icon(s) appear under a fighter's percent/stocks row, and the speed icon disappears after ~6s.

- [ ] **Step 4: Commit**

```bash
git add app/games/phantom-rumble.html
git commit -m "feat(phantom-rumble): show active power-up icons on fighter HUD cards"
```

---

## Task 6: Mode-select menu restructure + Local FFA slot picker

**Files:**
- Modify: `app/games/phantom-rumble.html` — the `.overlay[data-setup]` markup (currently lines 40-57), its CSS (`.overlay .modes`/`.overlay .diffs` rules, currently lines 10-16), and the mode-button wiring (currently line 610, `for(const b of document.querySelectorAll('[data-mode]'))b.onclick=()=>startMatch(b.dataset.mode);`) plus `startMatch()` (currently lines 202-213).

**Interfaces:**
- Produces: `startMatch(selected, options)` gains a second parameter `options = { humans: 2 }` (only meaningful for the `localffa` mode; ignored otherwise) — replaces the old `mode==='versus'||mode==='rumble'` branching with an explicit human count.
- Consumes: nothing new from other tasks.

- [ ] **Step 1: Replace the mode/diff markup**

Replace the `<div class="modes">...</div>` and its surrounding structure inside `.overlay[data-setup]` (`app/games/phantom-rumble.html:44-49`, keeping the `<h1>`/`<p>`/`<p class="pb">` lines above it and the `<div class="diffs">`/`<div class="keys">`/final `<p>` below it unchanged):

```html
  <div class="mode-group"><i>SOLO / LOCAL</i><div class="modes">
    <button data-mode="solo"><b>SOLO 1v1</b>you vs one bot</button>
    <button data-mode="localffa"><b>LOCAL FFA</b>up to 4, split a keyboard</button>
  </div></div>
  <div class="mode-group"><i>ONLINE</i><div class="modes">
    <button data-mode="net1v1"><b>NET 1v1</b>invite a friend</button>
    <button data-mode="net2v2"><b>NET 2v2</b>teams, invite code</button>
    <button data-mode="netffa"><b>NET FFA</b>up to 4, invite code</button>
  </div></div>
  <div class="local-slots" data-local-slots hidden>
    <span>Humans on this keyboard:</span>
    <button data-humans="1" type="button" role="radio" aria-checked="false">1</button>
    <button data-humans="2" type="button" role="radio" aria-checked="true">2</button>
  </div>
```

Add supporting CSS directly below the existing `.overlay .modes button b{...}` rule (`app/games/phantom-rumble.html:13`):
```css
.overlay .mode-group{margin:14px 0 2px}
.overlay .mode-group>i{display:block;font-size:11px;letter-spacing:2px;color:#5a7568;margin-bottom:6px;font-style:normal}
.overlay .local-slots{display:flex;gap:8px;align-items:center;justify-content:center;margin:4px 0 10px;font-size:12px;color:#6fae8d}
.overlay .local-slots button{border:1px solid #2cff9b33;border-radius:16px;background:#04140c;color:#6fae8d;padding:4px 12px;font:700 11px ui-monospace;cursor:pointer}
.overlay .local-slots button[aria-checked="true"]{background:#123423;color:#baffdb;border-color:#2cff9baa}
```

- [ ] **Step 2: Wire the Local FFA slot picker and the mode buttons**

First, append one more button to Step 1's `.local-slots` markup, after the two `data-humans` buttons, so there's an explicit confirm action once a human count is chosen:
```html
    <button data-local-start type="button">START</button>
```

Then replace the mode-button wiring at `app/games/phantom-rumble.html:610`:
```js
let localHumans=2;
const localSlotsEl=document.querySelector('[data-local-slots]');
for(const b of document.querySelectorAll('[data-humans]'))b.onclick=()=>{
  localHumans=Number(b.dataset.humans);
  for(const btn of document.querySelectorAll('[data-humans]'))btn.setAttribute('aria-checked',String(Number(btn.dataset.humans)===localHumans));
};
for(const b of document.querySelectorAll('[data-mode]'))b.onclick=()=>{
  if(b.dataset.mode==='localffa'){localSlotsEl.hidden=false;return}
  startMatch(b.dataset.mode,{humans:localHumans});
};
document.querySelector('[data-local-start]').onclick=()=>startMatch('localffa',{humans:localHumans});
```

- [ ] **Step 3: Update `startMatch()` to use explicit human counts per mode**

Replace `startMatch()` (`app/games/phantom-rumble.html:202-213`):
```js
function startMatch(selected,options={}){
  mode=selected;
  const humans=selected==='solo'?1:selected==='localffa'?(options.humans||2):selected==='net1v1'?2:1;
  const count=selected==='solo'||selected==='net1v1'?2:4;
  fighters=[];
  for(let i=0;i<count;i++)fighters.push(makeFighter(i,i<humans));
  buildPlatforms(nextSeed());
  pickups=[];particles=[];floaters=[];rings=[];projectiles=[];matchKos=[0,0,0,0];pickupTimer=6;over=false;running=true;paused=false;
  setupEl.hidden=true;endEl.hidden=true;hudEl.hidden=false;
  document.querySelector('[data-touch]').hidden=fighters.some(f=>f.human&&f.slot===0)?false:true;
  buildHud();last=performance.now();if(raf)cancelAnimationFrame(raf);raf=requestAnimationFrame(loop);
}
```

Note: `net1v1`/`net2v2`/`netffa` here only set up the *local* fighter roster shape (matching Task 7's room-driven participant count once that lands) — Task 7 replaces how those three specifically populate `fighters`/`humans` with room-participant data instead of this placeholder `humans` logic. This task's job is just getting the menu and local modes (`solo`, `localffa`) fully correct and playable; the three net tiles are wired to open the room flow in Task 7, not fully functional as a local match starter beyond this scaffolding.

The existing "REMATCH" button (`app/games/phantom-rumble.html:611`, `document.querySelector('[data-again]').onclick=()=>startMatch(mode);`) calls `startMatch` with only one argument — with the new signature that means `options` defaults to `{}`, so a Local FFA rematch would silently reset to 2 humans instead of remembering the count the player picked. Fix it to pass the current `localHumans` along:
```js
document.querySelector('[data-again]').onclick=()=>startMatch(mode,{humans:localHumans});
```

- [ ] **Step 4: Manual verification**

Preview stack as before. Confirm the setup screen now shows two labeled groups; SOLO 1v1 starts immediately against one bot; LOCAL FFA shows the humans-on-keyboard picker, and clicking START with "1" selected plays like the old Bot Brawl (you + 3 bots) while "2" plays like the old Rumble (2 humans + 2 bots).

- [ ] **Step 5: Commit**

```bash
git add app/games/phantom-rumble.html
git commit -m "feat(phantom-rumble): consolidate mode menu into SOLO/LOCAL + ONLINE groups"
```

---

## Task 7: Networked room integration (NET 1v1 / NET 2v2 / NET FFA)

**Files:**
- Modify: `app/games/phantom-rumble.html` — extend the existing `addEventListener('message', ...)` host-protocol handler (currently lines 636-646), add room state (`inRoom`, `isHost`, `hostNonce`, matching `kingdom-breakers.html`'s proven pattern), add `sendMatchAction`/`applyMatchState`, and change the `net1v1`/`net2v2`/`netffa` mode buttons (Task 6) to enter a room-waiting state instead of calling `startMatch` directly.

**Interfaces:**
- Consumes: `match-state` messages shaped `{matchState, readyStates, botSlots, hostControls, participants}` (from the PhantomPlay Realtime Channel plan, delivered at the same host-shell layer `kingdom-breakers.html` already consumes — no phantom-rumble-specific server work needed, this task is entirely client-side protocol handling).
- Produces: `sendMatchAction(action, mode)` (throttled `postMessage` to the host shell, mirrors `kingdom-breakers.html:1205-1210` exactly).

**Design — how a real-time fighter's state actually syncs over a ~5Hz channel:** the existing match-state write path is rate-limited to 10 writes / 2 seconds / room (`server/src/index.ts:5138-5155`, unchanged by the Realtime Channel plan) — so even with instant *delivery*, the host can only publish a fresh authoritative snapshot at most every ~200ms. That's fine for turn-paced games; for a real-time fighter it means: **each client always simulates its own controlled fighter locally, immediately, using the exact same `step()`/`attack()`/`jump()` functions local play already uses** (so your own inputs never feel delayed), while **every other fighter is rendered by interpolating between the last two snapshots the host published** (so remote fighters look smooth despite the ~200ms update cadence, rather than teleporting). The host's simulation is authoritative for percent/stocks/KOs/pickups (it resolves hits for every fighter, including ones it doesn't locally control, using the remote inputs relayed to it) — a non-host client never resolves its own hits as "real," it only predicts its own movement/animation locally and reconciles when the next snapshot arrives.

- [ ] **Step 1: Add room state and the host-probe election (verbatim pattern from `kingdom-breakers.html`)**

Add directly after the existing `let hostSeed=null;` (`app/games/phantom-rumble.html:126`):
```js
let inRoom=false,isHost=false,hostNonce=Math.random().toString(36).slice(2,10);
let roomParticipants=[],remoteInputs={},lastActionAt=0;
let lastSnapshot=null,prevSnapshot=null,snapshotAt=0,prevSnapshotAt=0;
function sendMatchAction(action,modeArg){
  const t=performance.now();
  if(t-lastActionAt<220){setTimeout(()=>sendMatchAction(action,modeArg),220-(t-lastActionAt));return}
  lastActionAt=performance.now();
  host('match-action',{action,mode:modeArg==='replace'?'replace':'merge'});
}
```

- [ ] **Step 2: Handle `match-state` messages — enter the room, elect host, apply remote snapshots**

Extend the existing `addEventListener('message', ...)` handler (`app/games/phantom-rumble.html:636-646`) — add one more branch before its closing `});`:
```js
addEventListener('message',e=>{
  const d=e.data;
  if(!d||d.source!=='phantomplay-host')return;
  if(d.type==='settings'){reduced=!!d.reducedMotion;let muted=false;try{muted=localStorage.getItem('pf.phantomrumble.mute')==='1'}catch{}soundOn=!muted&&d.sound!==false;applyMuteUi()}
  if(d.type==='seed'&&typeof d.value==='number')hostSeed=d.value>>>0;
  if(d.type==='pause')setPaused(true);
  if(d.type==='resume')setPaused(false);
  if(d.type==='exit')resetToMenu();
  if(d.type==='restart'){if(mode)startMatch(mode);else resetToMenu()}
  if(d.type==='restore')resetToMenu();
  if(d.type==='match-state')applyMatchState(d);
});
function applyMatchState(d){
  inRoom=true;
  roomParticipants=d.participants||[];
  const ms=d.matchState||{};
  if(ms.hostProbe===hostNonce)isHost=true;
  if(ms.phase==='active'&&mode&&mode.startsWith('net')){
    if(ms.inputs)remoteInputs=ms.inputs;
    if(!isHost&&ms.snapshot){
      prevSnapshot=lastSnapshot;prevSnapshotAt=snapshotAt;
      lastSnapshot=ms.snapshot;snapshotAt=performance.now();
      applySnapshotToNonLocalFighters(ms.snapshot);
    }
  }
}
```

- [ ] **Step 3: Make the NET mode buttons enter the room lobby instead of starting a local match immediately**

Replace the `net1v1`/`net2v2`/`netffa` handling inside Task 6's mode-button wiring — the `for(const b of document.querySelectorAll('[data-mode]'))b.onclick=...` block gains a third branch:
```js
for(const b of document.querySelectorAll('[data-mode]'))b.onclick=()=>{
  if(b.dataset.mode==='localffa'){localSlotsEl.hidden=false;return}
  if(b.dataset.mode.startsWith('net')){mode=b.dataset.mode;sendMatchAction({hostProbe:hostNonce});return}
  startMatch(b.dataset.mode,{humans:localHumans});
};
```

`sendMatchAction({hostProbe:hostNonce})` here mirrors `kingdom-breakers.html:1215`'s `enterPartyLobby()` call — the room UI itself (waiting screen, ready-check, start button visible only to the host) is provided generically by `phantomplay.js`'s "Together" tab per the Realtime Channel plan's client changes; this game only needs to react to `match-state` once the host actually starts the match (`ms.phase==='active'`, handled in Step 4).

- [ ] **Step 4: Host starts the networked match and begins broadcasting snapshots; both host and non-host relay their own local input**

Add a host-side match start function and a periodic snapshot broadcast, plus per-client input relay. Add directly after `applyMatchState`:
```js
function hostStartNetMatch(){
  const seed=nextSeed();
  const humanCount=roomParticipants.length;
  const count=mode==='net2v2'||mode==='netffa'?4:2;
  fighters=[];
  for(let i=0;i<count;i++)fighters.push(makeFighter(i,i<humanCount));
  buildPlatforms(seed);
  pickups=[];particles=[];floaters=[];rings=[];projectiles=[];matchKos=[0,0,0,0];pickupTimer=6;over=false;running=true;paused=false;
  setupEl.hidden=true;endEl.hidden=true;hudEl.hidden=false;
  buildHud();last=performance.now();if(raf)cancelAnimationFrame(raf);raf=requestAnimationFrame(loop);
  sendMatchAction({phase:'active',seed,hostProbe:hostNonce},'merge');
  setInterval(()=>{
    if(!isHost||!running)return;
    const snapshot=fighters.map(f=>({x:f.x,y:f.y,vx:f.vx,vy:f.vy,face:f.face,pct:f.pct,stocks:f.stocks,dead:f.dead}));
    sendMatchAction({snapshot},'merge');
  },200);
}
function applySnapshotToNonLocalFighters(snapshot){
  snapshot.forEach((s,i)=>{
    const f=fighters[i];
    if(!f||f.human)return; // never overwrite the locally-predicted fighter this client controls
    f.pct=s.pct;f.stocks=s.stocks;f.dead=s.dead;f.targetX=s.x;f.targetY=s.y;f.face=s.face;
  });
}
```

Add interpolation toward `targetX`/`targetY` for non-local fighters in `step()` (`app/games/phantom-rumble.html:386-425`) — a non-local fighter in a net match skips local physics entirely and instead eases toward the last snapshot's position; insert this branch at the very top of `step(f,dt)`, before the existing `if(f.dead)return;` line:
```js
function step(f,dt){
  if(mode&&mode.startsWith('net')&&!isHost&&!f.human&&typeof f.targetX==='number'){
    f.x+=(f.targetX-f.x)*Math.min(1,dt*8);f.y+=(f.targetY-f.y)*Math.min(1,dt*8);
    grabPickups(f);
    return;
  }
  if(f.dead)return;
```

**Scope note:** this task establishes the plumbing (host election, snapshot broadcast, remote-fighter interpolation, action relay) using the exact rendering/HUD/pickup code already built in Tasks 1-5 — it does not change any hit-detection or damage math. Full input relay for a non-host player's own controls into the host's authoritative simulation (so a non-host's attacks actually register against the host's copy of the match) is the natural next increment once this plumbing is verified working end-to-end in a real two-browser test; flag this explicitly to the user as the boundary of this task rather than silently shipping a networked mode where only the host's inputs matter.

- [ ] **Step 5: Manual verification — two browser sessions**

Using the preview stack, open two browser profiles, log in as two different demo/room-capable sessions, use PhantomPlay's "Together" tab to create/join a room for Phantom Rumble, and confirm: both clients receive `match-state`, exactly one of them (the actual room host) sets `isHost=true`, and once the host triggers `hostStartNetMatch()` both screens transition into a match with matching fighter counts and the same seeded platform layout.

- [ ] **Step 6: Commit**

```bash
git add app/games/phantom-rumble.html
git commit -m "feat(phantom-rumble): wire NET 1v1/2v2/FFA into PhantomPlay game rooms"
```

---

## Task 8: Results screen visual polish

**Files:**
- Modify: `app/games/phantom-rumble.html` — `endMatch()` (currently lines 440-453), the `.overlay` CSS for `[data-end]` (no new selectors needed, reuse existing `.overlay h1`/`.overlay p` rules with inline style for the winner accent).

**Interfaces:**
- Consumes: `winner.color`, `winner.glow` (existing fighter fields).

- [ ] **Step 1: Add a winner-color accent to the results title**

Modify `endMatch()` (`app/games/phantom-rumble.html:440-453`) — the two `document.querySelector(...).textContent=...` lines for the title gain a matching style assignment:
```js
function endMatch(winner){
  if(raf){cancelAnimationFrame(raf);raf=0}
  running=false;over=true;stats.matches+=1;
  const humanWon=winner&&winner.human;
  if(humanWon)stats.wins+=1;
  const humanKos=Math.max(matchKos[0],fighters[1]&&fighters[1].human?matchKos[1]:0);
  stats.bestKos=Math.max(stats.bestKos,humanKos);
  const score=humanKos*100+(winner&&winner.human?winner.stocks*50:0);
  host('score',{score});
  host('complete',{score,progress:100,state:null});
  const titleEl=document.querySelector('[data-endtitle]');
  titleEl.textContent=winner?(winner.human?`${winner.name} WINS`:`${winner.name} (BOT) WINS`):'DRAW';
  titleEl.style.color=winner?winner.color:'';
  titleEl.style.textShadow=winner?`0 0 28px ${winner.glow}`:'';
  document.querySelector('[data-endcopy]').textContent=winner?`${matchKos[winner.slot]} KOs this match. Session: ${stats.wins}/${stats.matches} rumbles won.`:`Everyone fell. Session: ${stats.wins}/${stats.matches} rumbles won.`;
  endEl.hidden=false;hudEl.hidden=true;document.querySelector('[data-touch]').hidden=true;
}
```

- [ ] **Step 2: Manual verification**

Preview stack as before. Finish a match (any mode) and confirm the "WINS"/"DRAW" title now glows in the winner's color instead of the previous flat green `.overlay h1` default.

- [ ] **Step 3: Commit**

```bash
git add app/games/phantom-rumble.html
git commit -m "feat(phantom-rumble): accent results screen title with winner's color"
```
