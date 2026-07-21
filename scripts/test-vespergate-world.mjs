/* Vespergate: The Vesper Hand — world/portal verification.
 * Loads the REAL portal.js / world.js / rooms.js with a window stub and
 * verifies map integrity, exit graph, portal basis-transform, and the
 * gate-hole collision fix. Run: node scripts/test-vespergate-world.mjs */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "app", "games", "vespergate");

// ---- window/VG stub ----
const VG = {
  W: 640, H: 360, TILE: 16,
  clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
  lerp: (a, b, t) => a + (b - a) * t,
  dist: (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay),
  sfx: () => {}, sfxGate: () => {}, sfxBell: () => {}, sfxCinder: () => {},
  settings: { reducedEffects: true },
};
global.window = { VG };

function load(file) {
  const src = fs.readFileSync(path.join(DIR, file), "utf8");
  new Function("window", src)(global.window);
}
load("portal.js");
load("world.js");
load("rooms.js");

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.error(`FAIL  ${name}${detail ? " — " + detail : ""}`); }
}

const ROOMS = VG.ROOMS, D = VG.DATA, T = VG.TILE;

// 1. every room parses, is rectangular, and is border-sealed
for (const [id, def] of Object.entries(ROOMS)) {
  const w = def.map[0].length;
  check(`${id}: rectangular ${w}x${def.map.length}`, def.map.every((r) => r.length === w),
    def.map.map((r, i) => r.length !== w ? `row ${i}=${r.length}` : null).filter(Boolean).join(","));
  const room = new VG.Room(def);
  // border sealed except explicit exits
  const exitTiles = new Set((def.exits || []).map((e) => `${e.gx},${e.gy}`));
  let leaks = 0;
  for (let x = 0; x < room.w; x++) for (const y of [0, room.h - 1]) {
    if (!room.blockedAtPx(x * T + 8, y * T + 8) && !exitTiles.has(`${x},${y}`)) leaks++;
  }
  for (let y = 0; y < room.h; y++) for (const x of [0, room.w - 1]) {
    if (!room.blockedAtPx(x * T + 8, y * T + 8) && !exitTiles.has(`${x},${y}`)) leaks++;
  }
  check(`${id}: border sealed`, leaks === 0, `${leaks} leak tiles`);
  // spawn walkable
  check(`${id}: spawn walkable`, !room.blockedAtPx(def.spawn.x * T + 8, def.spawn.y * T + 8));
}

// 2. exit graph: targets exist, toSpawn walkable, and every exit is returnable
for (const [id, def] of Object.entries(ROOMS)) {
  for (const ex of def.exits || []) {
    check(`${id}→${ex.to}: target exists`, !!ROOMS[ex.to]);
    if (!ROOMS[ex.to]) continue;
    const target = new VG.Room(ROOMS[ex.to]);
    check(`${id}→${ex.to}: toSpawn walkable`, !target.blockedAtPx(ex.toSpawn.x * T + 8, ex.toSpawn.y * T + 8),
      `(${ex.toSpawn.x},${ex.toSpawn.y})`);
    check(`${id}→${ex.to}: return path exists`, (ROOMS[ex.to].exits || []).some((r) => r.to === id));
  }
}

// 3. NPCs: defined, placed on walkable ground in their room
for (const [id, def] of Object.entries(ROOMS)) {
  for (const nid of def.npcs || []) {
    const n = D.NPCS[nid];
    check(`npc ${nid}: defined`, !!n);
    if (!n) continue;
    const room = new VG.Room(def);
    check(`npc ${nid}: standing spot walkable in ${id}`, !room.blockedAtPx(n.x * T + 8, n.y * T + 8), `(${n.x},${n.y})`);
    check(`npc ${nid}: has dialogue`, Array.isArray(D.DIALOG[nid]) && D.DIALOG[nid].length > 0);
  }
}

// 4. quests referenced by dialogue exist
const questRefs = new Set();
for (const rules of Object.values(D.DIALOG)) for (const r of rules) {
  for (const k of ["questActive", "questDone", "questDoneB", "notQuestDone"]) if (r.when?.[k]) questRefs.add(r.when[k]);
  if (r.do?.accept) questRefs.add(r.do.accept);
  if (r.do?.complete) questRefs.add(r.do.complete);
}
for (const q of questRefs) check(`quest ref ${q}: defined`, !!D.QUESTS[q]);

// 5. shop items unique + relics resolve
const ids = D.SHOP.map((s) => s.id);
check("shop: unique ids", new Set(ids).size === ids.length);
for (const s of D.SHOP) if (s.relic) check(`shop relic ${s.relic}: defined`, !!D.RELICS[s.relic]);

// 6. materials: water blocks walk but not shots; bridge walkable; mirror reflects
{
  const lake = new VG.Room(ROOMS.lake);
  let wx = -1, wy = -1, bx = -1, by = -1;
  for (let y = 0; y < lake.h && wx < 0; y++) for (let x = 0; x < lake.w; x++) {
    if (lake.matAt(x, y) === VG.MAT.WATER && wx < 0) { wx = x; wy = y; }
  }
  for (let y = 0; y < lake.h && bx < 0; y++) for (let x = 0; x < lake.w; x++) {
    if (lake.matAt(x, y) === VG.MAT.BRIDGE && bx < 0) { bx = x; by = y; }
  }
  check("lake: has water", wx >= 0);
  check("water: blocks walking", lake.blockedAtPx(wx * T + 8, wy * T + 8));
  check("water: does NOT block shots", !lake.solidAtPx(wx * T + 8, wy * T + 8));
  check("lake: has bridge", bx >= 0);
  if (bx >= 0) check("bridge: walkable", !lake.blockedAtPx(bx * T + 8, by * T + 8));
  const oss = new VG.Room(ROOMS.ossuary1);
  check("ossuary: mirror reflects", oss.reflectAtPx(0 * T + 8, 0 * T + 8));
}

// 7. portal placement classification
{
  const vale = new VG.Room(ROOMS.vale);
  // ruins liminal wall at (4,16) per map ("....##" on y16 row → x5,x6... interior offset +1 → gx5,gy17?) find one programmatically
  let lim = null, iron = null;
  for (let y = 1; y < vale.h - 1 && !lim; y++) for (let x = 1; x < vale.w - 1; x++) {
    if (vale.matAt(x, y) === VG.MAT.LIMINAL) {
      const faces = [[0, -1], [0, 1], [-1, 0], [1, 0]];
      if (faces.some(([fx, fy]) => vale.matAt(x + fx, y + fy) === VG.MAT.OPEN)) { lim = { x, y }; break; }
    }
  }
  const hollow = new VG.Room(ROOMS.hollow1);
  for (let y = 1; y < hollow.h - 1 && !iron; y++) for (let x = 1; x < hollow.w - 1; x++) {
    if (hollow.matAt(x, y) === VG.MAT.NULL_IRON) {
      const faces = [[0, -1], [0, 1], [-1, 0], [1, 0]];
      if (faces.some(([fx, fy]) => hollow.matAt(x + fx, y + fy) === VG.MAT.OPEN)) { iron = { x, y }; break; }
    }
  }
  check("vale: has exposed liminal stone (portal tutorial ruins)", !!lim);
  if (lim) check("classifyPortal: liminal face is valid", vale.classifyPortal(lim.x * T + 8, lim.y * T + 8).valid === true);
  check("hollow1: has exposed null iron", !!iron);
  if (iron) {
    const cls = hollow.classifyPortal(iron.x * T + 8, iron.y * T + 8);
    check("classifyPortal: null iron refused", cls.valid === false && cls.reason === "null-iron", JSON.stringify(cls));
  }
}

// 8. portal transform: momentum magnitude preserved, exits in front of exit gate
{
  const ps = new VG.PortalSystem();
  ps.place(0, 100, 100, "up", true);
  ps.place(1, 300, 200, "right", true);
  ps.gates.forEach((g) => g.open = 1);
  // "up" normal points into open space above; entering means approaching from
  // above (in front of the plane) while moving DOWN against the normal.
  const ent = { x: 100, y: 96, vx: 0, vy: 80, r: 4 };
  const res = ps.tryTeleport(ent, "t1");
  check("teleport: fires on inward crossing", res === true || res === "critical");
  const speed = Math.hypot(ent.vx, ent.vy);
  check("teleport: momentum magnitude preserved", Math.abs(speed - 80) < 0.01, `speed=${speed}`);
  check("teleport: exits along exit normal (+x)", ent.vx > 60 && ent.x > 300, `vx=${ent.vx.toFixed(1)} x=${ent.x.toFixed(1)}`);
}

// 9. THE bug fix: gate hole opens the wall footprint, lone gate does not
{
  const ps = new VG.PortalSystem();
  ps.place(0, 100, 100, "up", true);
  ps.gates[0].open = 1;
  check("holeAt: lone gate is NOT a hole", ps.holeAt(100, 104) === false);
  ps.place(1, 300, 200, "right", true);
  ps.gates.forEach((g) => g.open = 1);
  check("holeAt: open pair IS a hole just inside the wall", ps.holeAt(100, 106) === true);
  check("holeAt: open pair hole spans mouth width", ps.holeAt(115, 106) === true && ps.holeAt(125, 106) === false);
  check("holeAt: not a hole far in front", ps.holeAt(100, 60) === false);
}

// 10. every dungeon gating flag has a source
{
  check("hollow1: exactly 2 bells to ring", (ROOMS.hollow1.bells || []).length === 2);
  const bossExit = ROOMS.hollow1.exits.find((e) => e.to === "hollowboss");
  check("hollow1: boss door needs both bells", bossExit && bossExit.needBells === 2);
  const sigExit = ROOMS.ossuary1.exits.find((e) => e.to === "ossuaryboss");
  check("ossuary1: boss door needs the sigil", sigExit && sigExit.needSigil === true);
  check("ossuary1: sigil target defined", !!ROOMS.ossuary1.sigil);
  check("ossuaryboss: is a choir room with 3 elites", ROOMS.ossuaryboss.choir === true &&
    ROOMS.ossuaryboss.enemies.filter((e) => e.tag === "choir").length === 3);
  check("hollowboss: bellmother present", ROOMS.hollowboss.boss?.type === "bellmother");
}

// 11. the lantern sits in a chamber unreachable on foot (portals required)
{
  const vale = new VG.Room(ROOMS.vale);
  const lp = ROOMS.vale.pickups.find((p) => p.id === "lantern");
  check("vale: lantern pickup exists", !!lp);
  if (lp) {
    // flood fill from spawn on walkable tiles
    const seen = new Set();
    const q = [[ROOMS.vale.spawn.x, ROOMS.vale.spawn.y]];
    while (q.length) {
      const [x, y] = q.pop();
      const k = x + "," + y;
      if (seen.has(k)) continue;
      seen.add(k);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= vale.w || ny >= vale.h) continue;
        if (!vale.blockedAtPx(nx * T + 8, ny * T + 8) && !seen.has(nx + "," + ny)) q.push([nx, ny]);
      }
    }
    check("vale: lantern chamber sealed on foot", !seen.has(lp.x + "," + lp.y),
      "lantern reachable without portals — the tutorial is broken");
    check("vale: main field IS reachable (flood fill sane)", seen.size > 200, `only ${seen.size} tiles`);
  }
}

console.log(`\nVespergate world verification: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
console.log("VESPERGATE WORLD OK");
