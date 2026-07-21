"use strict";

/* Skyguard Arena is a self-contained Canvas/DOM strategy game. It uses the
   PhantomPlay postMessage bridge only; the iframe performs no network calls. */

// ---------------------------------------------------------------------------
// Host bridge and helpers
// ---------------------------------------------------------------------------
const host = (type, data = {}) => parent.postMessage({ source: "phantomplay-game", type, ...data }, "*");
function matchAction(action, mode) {
  host("match-action", { action, mode: mode === "replace" ? "replace" : "merge" });
}
const $ = (selector) => document.querySelector(selector);
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function clampInt(value, min, max, fallback) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? clamp(n, min, max) : fallback;
}
function esc(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  }[char]));
}
function shade(hex, amount) {
  const clean = hex.replace("#", "");
  const n = parseInt(clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean, 16);
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) =>
    amount >= 0 ? Math.round(v + (255 - v) * amount) : Math.round(v * (1 + amount))
  );
  return "rgb(" + channels.map((v) => clamp(v, 0, 255)).join(",") + ")";
}

// ---------------------------------------------------------------------------
// World data
// ---------------------------------------------------------------------------
const REF_W = 1000;
const REF_H = 600;
const ABILITY_COOLDOWN = 26;
const MAX_ENEMIES = 220;
const PRESSURE_TYPES = new Set(["swarm", "armor", "blackout"]);

const MAPS = [
  {
    id: "cloudbreak",
    name: "Cloudbreak Pass",
    objectiveLabel: "Twin relay defense",
    rule: "Three forked routes cross two relays. Crosswinds accelerate light aircraft and bend projectile timing.",
    objective: "relay",
    routes: [
      [[.02,.52],[.16,.50],[.27,.28],[.45,.24],[.58,.36],[.76,.30],[.98,.47]],
      [[.02,.52],[.18,.56],[.31,.49],[.47,.54],[.62,.47],[.79,.56],[.98,.47]],
      [[.02,.52],[.16,.58],[.28,.77],[.44,.72],[.59,.62],[.76,.70],[.98,.47]]
    ],
    slots: [[.10,.35],[.12,.67],[.23,.42],[.29,.18],[.30,.62],[.37,.83],[.43,.39],[.52,.66],[.58,.27],[.65,.55],[.72,.21],[.76,.77],[.84,.40],[.88,.62]]
  },
  {
    id: "stormring",
    name: "Stormglass Ring",
    objectiveLabel: "Shielded core hold",
    rule: "Raiders orbit a fractured core. Lightning telegraphs before jamming defenses and damaging anything nearby.",
    objective: "shield",
    routes: [
      [[.02,.50],[.17,.34],[.34,.20],[.55,.22],[.74,.37],[.66,.55],[.82,.70],[.98,.50]],
      [[.02,.50],[.20,.55],[.34,.72],[.53,.76],[.70,.61],[.62,.43],[.80,.29],[.98,.50]],
      [[.02,.50],[.20,.48],[.34,.34],[.51,.50],[.36,.64],[.57,.69],[.73,.51],[.98,.50]]
    ],
    slots: [[.10,.25],[.11,.72],[.23,.39],[.25,.63],[.38,.14],[.39,.84],[.46,.38],[.48,.63],[.60,.16],[.61,.82],[.70,.36],[.73,.66],[.84,.23],[.87,.76]]
  },
  {
    id: "iron",
    name: "Iron Meridian",
    objectiveLabel: "Gate line defense",
    rule: "Two armored gates create shared chokepoints. Ground raids must break them; air and phase units bypass the line.",
    objective: "gates",
    routes: [
      [[.02,.50],[.18,.29],[.33,.29],[.40,.43],[.55,.43],[.66,.25],[.82,.25],[.98,.47]],
      [[.02,.50],[.18,.50],[.35,.50],[.48,.50],[.65,.50],[.82,.50],[.98,.47]],
      [[.02,.50],[.18,.71],[.33,.71],[.40,.57],[.55,.57],[.66,.75],[.82,.75],[.98,.47]]
    ],
    slots: [[.10,.19],[.10,.81],[.22,.40],[.22,.60],[.34,.20],[.34,.80],[.44,.36],[.44,.64],[.57,.34],[.57,.66],[.68,.15],[.68,.85],[.80,.39],[.82,.62]]
  },
  {
    id: "neontangle",
    name: "Neon Tangle",
    objectiveLabel: "Braided relay race",
    rule: "Four braided flight corridors cross one relay spine. Fast air raids arrive early, but the middle can be locked down by smart range overlap.",
    objective: "relay",
    routes: [
      [[.02,.44],[.13,.25],[.30,.18],[.46,.34],[.58,.26],[.73,.31],[.98,.49]],
      [[.02,.56],[.17,.45],[.30,.52],[.43,.47],[.56,.55],[.72,.46],[.98,.49]],
      [[.02,.50],[.16,.66],[.34,.78],[.48,.62],[.62,.70],[.80,.72],[.98,.49]],
      [[.02,.50],[.20,.50],[.36,.37],[.50,.50],[.64,.63],[.80,.50],[.98,.49]]
    ],
    slots: [[.09,.29],[.10,.70],[.21,.20],[.23,.57],[.30,.82],[.38,.33],[.42,.66],[.50,.25],[.52,.75],[.60,.45],[.66,.60],[.72,.26],[.78,.73],[.88,.40],[.89,.62]]
  }
];
const MAP_BY_ID = Object.fromEntries(MAPS.map((map) => [map.id, map]));

const DEFENSES = {
  glare: {
    id: "glare", name: "Glare Repeater", role: "Kinetic", desc: "Fast all-purpose fire. Reliable into unarmored lines.", cost: 55, upgradeCosts: [60, 130], color: "#ffc857", shape: "round", target: "any",
    tiers: [{ dmg: 12, rof: 3.4, range: 132, projectile: 700 }, { dmg: 19, rof: 4.3, range: 150, projectile: 780 }, { dmg: 30, rof: 5.4, range: 168, projectile: 860 }]
  },
  arc: {
    id: "arc", name: "Arc Diffuser", role: "Splash", desc: "Ground bursts erase tight swarms but struggle into armor.", cost: 80, upgradeCosts: [75, 150], color: "#ff7165", shape: "hex", target: "ground",
    tiers: [{ dmg: 17, rof: 1.2, range: 128, projectile: 440, splash: 56 }, { dmg: 27, rof: 1.45, range: 146, projectile: 480, splash: 72 }, { dmg: 44, rof: 1.7, range: 164, projectile: 520, splash: 92 }]
  },
  frost: {
    id: "frost", name: "Frost Prism", role: "Control", desc: "Slows air or ground and exposes fast raiders to focus fire.", cost: 70, upgradeCosts: [65, 140], color: "#65d8cf", shape: "tri", target: "any",
    tiers: [{ dmg: 6, rof: 1.3, range: 152, projectile: 620, slow: .4, slowDur: 1.8 }, { dmg: 11, rof: 1.55, range: 172, projectile: 690, slow: .55, slowDur: 2.3 }, { dmg: 18, rof: 1.85, range: 192, projectile: 760, slow: .68, slowDur: 3 }]
  },
  vane: {
    id: "vane", name: "Vane Rail", role: "Anti-armor", desc: "Long-range penetrator deletes plated targets one at a time.", cost: 125, upgradeCosts: [110, 220], color: "#b792ff", shape: "diamond", target: "any",
    tiers: [{ dmg: 66, rof: .55, range: 240, projectile: 940, pierce: 8 }, { dmg: 104, rof: .66, range: 270, projectile: 1060, pierce: 12 }, { dmg: 170, rof: .8, range: 300, projectile: 1200, pierce: 18 }]
  },
  flak: {
    id: "flak", name: "Kestrel Flak", role: "Anti-air", desc: "Airburst clusters hard-counter skiffs and airborne swarms.", cost: 90, upgradeCosts: [80, 165], color: "#ff9651", shape: "burst", target: "air",
    tiers: [{ dmg: 27, rof: 1.7, range: 170, projectile: 730, splash: 50, airBonus: 1.8 }, { dmg: 43, rof: 2, range: 190, projectile: 810, splash: 62, airBonus: 2 }, { dmg: 68, rof: 2.4, range: 210, projectile: 900, splash: 78, airBonus: 2.2 }]
  },
  null: {
    id: "null", name: "Null Lantern", role: "Shield break", desc: "Collapses shields and reveals phase craft to control effects.", cost: 85, upgradeCosts: [75, 155], color: "#73e69e", shape: "square", target: "any",
    tiers: [{ dmg: 14, rof: 1.8, range: 144, projectile: 660, shieldDamage: 3, reveal: 2.5 }, { dmg: 23, rof: 2.2, range: 162, projectile: 720, shieldDamage: 4, reveal: 3.3 }, { dmg: 37, rof: 2.7, range: 182, projectile: 790, shieldDamage: 6, reveal: 4.2 }]
  },
  drone: {
    id: "drone", name: "Marshal Drone", role: "Support", desc: "Boosts nearby rate of fire while adding light anti-air shots.", cost: 95, upgradeCosts: [85, 170], color: "#6ca8ff", shape: "wing", target: "any",
    tiers: [{ dmg: 8, rof: 1.6, range: 122, projectile: 730, boost: .2, boostRange: 125 }, { dmg: 14, rof: 2, range: 140, projectile: 800, boost: .3, boostRange: 145 }, { dmg: 24, rof: 2.5, range: 160, projectile: 880, boost: .42, boostRange: 170 }]
  },
  gravity: {
    id: "gravity", name: "Gravity Well", role: "Displace", desc: "Pulls non-boss ground units backward and bunches them for splash.", cost: 110, upgradeCosts: [95, 185], color: "#d077ff", shape: "orb", target: "ground",
    tiers: [{ dmg: 9, rof: .9, range: 160, projectile: 490, pull: .026, slow: .22, slowDur: 1.1 }, { dmg: 16, rof: 1.1, range: 182, projectile: 530, pull: .04, slow: .3, slowDur: 1.4 }, { dmg: 27, rof: 1.35, range: 205, projectile: 580, pull: .056, slow: .4, slowDur: 1.8 }]
  },
  mortar: {
    id: "mortar", name: "Comet Mortar", role: "Siege", desc: "Huge delayed ground impact rewards chokepoint prediction.", cost: 135, upgradeCosts: [115, 230], color: "#f2da79", shape: "barrel", target: "ground",
    tiers: [{ dmg: 54, rof: .5, range: 230, minRange: 70, projectile: 320, splash: 82, arc: 58 }, { dmg: 86, rof: .6, range: 255, minRange: 62, projectile: 350, splash: 100, arc: 72 }, { dmg: 140, rof: .72, range: 280, minRange: 54, projectile: 380, splash: 122, arc: 86 }]
  }
};
const DEFENSE_ORDER = ["glare", "arc", "frost", "vane", "flak", "null", "drone", "gravity", "mortar"];

const COMMANDERS = {
  astra: {
    id: "astra", name: "Astra Vale", sigil: "A", faction: "Dawn Fleet", color: "#ffc857",
    passive: "Defeated raiders award 15% more Glint. Repeaters fire faster.",
    ability: "Overcharge Pulse", abilityCopy: "All defenses gain damage and fire rate for six seconds."
  },
  ilex: {
    id: "ilex", name: "Ilex Norr", sigil: "I", faction: "Tide Archive", color: "#65d8cf",
    passive: "Control effects last longer and the Spire begins with a shield.",
    ability: "Chrono Shell", abilityCopy: "Slow every raider and restore objective integrity."
  },
  rook: {
    id: "rook", name: "Rook Calder", sigil: "R", faction: "Ember Corsairs", color: "#ff775d",
    passive: "Every defense gains two armor pierce. Gate repairs are stronger.",
    ability: "Broadside", abilityCopy: "Six heavy shells strike the deepest threats."
  },
  vesper: {
    id: "vesper", name: "Vesper Quill", sigil: "V", faction: "Umbral Survey", color: "#b792ff",
    passive: "Defense range increases 12%. Phase raiders stay revealed longer.",
    ability: "Route Reversal", abilityCopy: "Pull all non-boss raiders backward along their branch."
  }
};
const COMMANDER_ORDER = ["astra", "ilex", "rook", "vesper"];

const ENEMIES = {
  driftling: { name: "Driftling", hp: 30, speed: .073, armor: 0, bounty: 5, color: "#9da591", size: 9, ground: true },
  skiff: { name: "Skiff Raider", hp: 22, speed: .125, armor: 0, bounty: 6, color: "#ff8b8c", size: 8, air: true },
  bulwark: { name: "Bulwark Hauler", hp: 118, speed: .041, armor: 6, bounty: 15, color: "#c68f56", size: 13, ground: true, heavy: true },
  splitter: { name: "Shard Carrier", hp: 54, speed: .061, armor: 1, bounty: 9, color: "#e6d36f", size: 11, ground: true, split: true },
  shard: { name: "Shardling", hp: 12, speed: .118, armor: 0, bounty: 2, color: "#f4e69a", size: 6, ground: true, swarm: true },
  phase: { name: "Phase Corsair", hp: 72, speed: .075, armor: 2, shield: 45, bounty: 14, color: "#a878e8", size: 11, air: true, phase: true },
  saboteur: { name: "Wire Saboteur", hp: 46, speed: .091, armor: 0, bounty: 10, color: "#63c9bb", size: 9, ground: true, saboteur: true },
  raptor: { name: "Raptor Diver", hp: 60, speed: .135, armor: 1, bounty: 11, color: "#ffa94d", size: 9, air: true },
  warden: { name: "Aegis Warden", hp: 240, speed: .036, armor: 10, shield: 90, bounty: 22, color: "#8fb3ff", size: 14, ground: true, heavy: true },
  hive: { name: "Hive Carrier", hp: 150, speed: .05, armor: 3, bounty: 18, color: "#d7ff6e", size: 13, air: true, splitInto: { type: "skiff", count: 3 } },
  revenant: { name: "Revenant Shell", hp: 210, speed: .058, armor: 4, bounty: 24, color: "#8ce8b4", size: 12, ground: true, regen: .035 },
  juggernaut: { name: "Juggernaut Frame", hp: 620, speed: .028, armor: 14, bounty: 40, color: "#e08b5a", size: 17, ground: true, heavy: true },
  wisp: { name: "Ion Wisp", hp: 46, speed: .155, armor: 0, bounty: 8, color: "#9ef2ff", size: 7, air: true, swarm: true },
  colossus: { name: "Voidmaw Colossus", hp: 1550, speed: .025, armor: 9, shield: 260, bounty: 220, color: "#ff5e73", size: 25, air: true, boss: true, heavy: true },
  shatterlord: { name: "Shatterlord", hp: 2300, speed: .024, armor: 8, bounty: 260, color: "#e6d36f", size: 24, ground: true, boss: true, heavy: true, splitInto: { type: "splitter", count: 4 } },
  nullbringer: { name: "Nullbringer", hp: 3100, speed: .023, armor: 10, shield: 320, bounty: 300, color: "#73e69e", size: 25, ground: true, boss: true, heavy: true, mech: "aura" },
  stormcaller: { name: "Stormcaller", hp: 3600, speed: .027, armor: 8, bounty: 340, color: "#6ca8ff", size: 24, air: true, boss: true, mech: "summon" },
  gravemind: { name: "Gravemind", hp: 4300, speed: .022, armor: 11, bounty: 380, color: "#8ce8b4", size: 26, ground: true, boss: true, heavy: true, mech: "heal" },
  moleking: { name: "Barrow King", hp: 4800, speed: .026, armor: 13, bounty: 420, color: "#c68f56", size: 25, ground: true, boss: true, heavy: true, mech: "burrow" },
  mirrorwarden: { name: "Mirror Warden", hp: 5200, speed: .024, armor: 12, shield: 420, bounty: 460, color: "#b792ff", size: 26, air: true, boss: true, mech: "shieldPhase" },
  fury: { name: "Twin Fury", hp: 3400, speed: .033, armor: 10, bounty: 300, color: "#ff7165", size: 22, air: true, boss: true, mech: "twin" },
  aegisprime: { name: "Aegis Prime", hp: 6400, speed: .022, armor: 16, shield: 700, bounty: 560, color: "#8fb3ff", size: 27, ground: true, boss: true, heavy: true, mech: "regen" },
  sovereign: { name: "The Sovereign", hp: 5200, speed: .02, armor: 18, shield: 900, bounty: 900, color: "#ff5e73", size: 30, air: true, boss: true, mech: "finale", leakDrain: 20 }
};

const CAMPAIGN_WAVES = [
  [{ type: "driftling", count: 8, gap: 680, formation: 2 }],
  [{ type: "skiff", count: 8, gap: 430, formation: 4 }, { type: "driftling", count: 8, gap: 520, delay: 1200 }],
  [{ type: "bulwark", count: 5, gap: 900 }, { type: "splitter", count: 6, gap: 620, delay: 700 }],
  [{ type: "phase", count: 7, gap: 620, formation: 2 }, { type: "skiff", count: 10, gap: 380, delay: 900 }],
  [{ type: "saboteur", count: 7, gap: 650 }, { type: "bulwark", count: 6, gap: 800, delay: 800 }, { type: "driftling", count: 12, gap: 350, delay: 1500 }],
  [{ type: "splitter", count: 10, gap: 480, formation: 5 }, { type: "phase", count: 8, gap: 530, delay: 1100 }],
  [{ type: "bulwark", count: 10, gap: 650 }, { type: "skiff", count: 16, gap: 310, formation: 4, delay: 800 }, { type: "saboteur", count: 8, gap: 500, delay: 1700 }],
  [{ type: "colossus", count: 1, gap: 0, route: 1 }, { type: "phase", count: 10, gap: 480, delay: 500 }, { type: "splitter", count: 10, gap: 450, delay: 1200 }]
];
/* Century Watch: endless mode runs to round 100. Every round scales health,
   speed, armor, count, and bounty; new raider types unlock as rounds pass and
   a new boss with a distinct mechanic arrives every 10 rounds. These
   functions stay DOM-free so a node harness can verify all 100 rounds. */
const CENTURY_ROUNDS = 100;
const BOSS_SCHEDULE = [
  { round: 10, type: "colossus", count: 1, title: "VOIDMAW COLOSSUS", tag: "SHIELDED FLAGSHIP" },
  { round: 20, type: "shatterlord", count: 1, title: "SHATTERLORD", tag: "SPLITS WHEN DESTROYED" },
  { round: 30, type: "nullbringer", count: 1, title: "NULLBRINGER", tag: "JAMS NEARBY DEFENSES" },
  { round: 40, type: "stormcaller", count: 1, title: "STORMCALLER", tag: "SUMMONS ESCORT WINGS" },
  { round: 50, type: "gravemind", count: 1, title: "GRAVEMIND", tag: "HEALS THE RAID" },
  { round: 60, type: "moleking", count: 1, title: "BARROW KING", tag: "BURROWS PAST FIRE" },
  { round: 70, type: "mirrorwarden", count: 1, title: "MIRROR WARDEN", tag: "PHASING SHIELD" },
  { round: 80, type: "fury", count: 2, title: "TWIN FURIES", tag: "ENRAGE TOGETHER" },
  { round: 90, type: "aegisprime", count: 1, title: "AEGIS PRIME", tag: "REGENERATING AEGIS" },
  { round: 100, type: "sovereign", count: 1, title: "THE SOVEREIGN", tag: "CENTURY FINALE" }
];
function bossForRound(number) {
  if (number < 10 || number % 10 !== 0) return null;
  const exact = BOSS_SCHEDULE.find((entry) => entry.round === number);
  if (exact) return exact;
  return BOSS_SCHEDULE[(Math.floor(number / 10) - 1) % BOSS_SCHEDULE.length];
}
function endlessWave(number) {
  const n = clampInt(number, 1, 9999, 1);
  const hpMul = 1 + (n - 1) * .085 + Math.pow(Math.max(0, n - 10), 1.62) * .012;
  const speedMul = 1 + Math.min(.85, n * .0065);
  const armorBonus = Math.floor(n / 12);
  const bountyMul = 1 + n * .02;
  const gapScale = Math.max(.42, 1 - n * .006);
  const entries = [
    { type: "driftling", count: Math.min(26, n === 1 ? 7 : 8 + Math.floor(n * .45)), gap: Math.round((n === 1 ? 650 : 520) * gapScale), formation: n === 1 ? 2 : 3 }
  ];
  if (n >= 2) entries.push({ type: "skiff", count: Math.min(20, 3 + Math.floor(n * .35)), gap: Math.round(430 * gapScale), delay: n === 2 ? 1250 : 700, formation: 4 });
  if (n >= 3) entries.push({ type: "bulwark", count: Math.min(12, 2 + Math.floor(n / 4)), gap: Math.round(820 * gapScale), delay: 1100 });
  if (n >= 5) entries.push({ type: "splitter", count: Math.min(9, 2 + Math.floor(n / 6)), gap: Math.round(600 * gapScale), delay: 1450 });
  if (n >= 9) entries.push({ type: "phase", count: Math.min(9, 2 + Math.floor(n / 6)), gap: Math.round(560 * gapScale), delay: 1700 });
  if (n >= 7) entries.push({ type: "saboteur", count: Math.min(8, 2 + Math.floor(n / 9)), gap: Math.round(620 * gapScale), delay: 1800 });
  if (n >= 12) entries.push({ type: "raptor", count: Math.min(14, 3 + Math.floor((n - 12) / 6)), gap: Math.round(460 * gapScale), delay: 2100, formation: 2 });
  if (n >= 18) entries.push({ type: "warden", count: Math.min(8, 2 + Math.floor((n - 18) / 10)), gap: Math.round(900 * gapScale), delay: 2400 });
  if (n >= 24) entries.push({ type: "hive", count: Math.min(7, 2 + Math.floor((n - 24) / 12)), gap: Math.round(880 * gapScale), delay: 2700 });
  if (n >= 30) entries.push({ type: "revenant", count: Math.min(7, 2 + Math.floor((n - 30) / 12)), gap: Math.round(760 * gapScale), delay: 3000 });
  if (n >= 40) entries.push({ type: "juggernaut", count: Math.min(6, 1 + Math.floor((n - 40) / 12)), gap: Math.round(1100 * gapScale), delay: 3300 });
  if (n >= 50) entries.push({ type: "wisp", count: Math.min(18, 6 + Math.floor((n - 50) / 4)), gap: Math.round(280 * gapScale), delay: 3600, formation: 4 });
  const boss = bossForRound(n);
  if (boss) entries.push({ type: boss.type, count: boss.count, gap: 1200, delay: 600, route: boss.count > 1 ? undefined : n % 3 });
  return { entries, hpMul, speedMul, armorBonus, bountyMul, boss };
}

function routeLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot((points[i][0] - points[i - 1][0]) * REF_W, (points[i][1] - points[i - 1][1]) * REF_H);
  }
  return total;
}
function compileWorld() {
  MAPS.forEach((map) => {
    map.routes = map.routes.map((points) => {
      const route = { points, length: routeLength(points), segments: [] };
      let start = 0;
      for (let i = 1; i < points.length; i++) {
        const len = Math.hypot((points[i][0] - points[i - 1][0]) * REF_W, (points[i][1] - points[i - 1][1]) * REF_H);
        route.segments.push({ start, len });
        start += len;
      }
      return route;
    });
  });
}
function pointAt(route, t) {
  const progress = clamp(t, 0, 1);
  const target = progress * route.length;
  for (let i = 0; i < route.segments.length; i++) {
    const segment = route.segments[i];
    if (target <= segment.start + segment.len || i === route.segments.length - 1) {
      const a = route.points[i];
      const b = route.points[i + 1];
      const f = segment.len ? clamp((target - segment.start) / segment.len, 0, 1) : 0;
      return { x: (a[0] + (b[0] - a[0]) * f) * REF_W, y: (a[1] + (b[1] - a[1]) * f) * REF_H };
    }
  }
  const end = route.points[route.points.length - 1];
  return { x: end[0] * REF_W, y: end[1] * REF_H };
}
function tangentAt(route, t) {
  const a = pointAt(route, clamp(t - .006, 0, 1));
  const b = pointAt(route, clamp(t + .006, 0, 1));
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
}
compileWorld();

// ---------------------------------------------------------------------------
// DOM and stage state
// ---------------------------------------------------------------------------
const screens = {
  title: $("#screenMenu"),
  loadout: $("#screenLoadout"),
  game: $("#screenGame"),
  results: $("#screenResults")
};
const canvas = $("[data-canvas]");
const ctx = canvas.getContext("2d");
const fieldEl = $("[data-field]");
const toastEl = $("[data-toast]");
const waveBanner = $("[data-wave-banner]");
const bossBanner = $("[data-boss-banner]");
const mapEventEl = $("[data-map-event]");
const defenseGridEl = $("[data-defense-grid]");
const commanderGridEl = $("[data-commander-grid]");
const mapGridEl = $("[data-map-grid]");
const dockDefenses = $("[data-dock-defenses]");
const dockSelected = $("[data-dock-selected]");
const pressureDock = $("[data-pressure-dock]");
const abilityBtn = $("[data-commander-btn]");
const abilityFill = $("[data-commander-fill]");
const opponentPanel = $("[data-opponent-panel]");
const roomModeBtn = $("[data-room-mode]");
const roomReadyEl = $("[data-room-ready]");
const overlayPause = $("[data-overlay-pause]");
const overlaySettings = $("[data-overlay-settings]");
const overlayTutorial = $("[data-overlay-tutorial]");
const hud = {
  gold: $("[data-hud-gold]"),
  wave: $("[data-hud-wave]"),
  lives: $("[data-hud-lives]"),
  score: $("[data-hud-score]"),
  mode: $("[data-hud-mode]"),
  objective: $("[data-hud-objective]"),
  livesChip: $(".sg-chip-lives")
};
const opponent = {
  name: $("[data-opp-name]"),
  lives: $("[data-opp-lives]"),
  wave: $("[data-opp-wave]"),
  status: $("[data-opp-status]"),
  bar: $("[data-opp-bar]"),
  note: $("[data-opp-note]")
};
const rankEls = {
  rank: $("[data-rank]"),
  fill: $("[data-rank-fill]"),
  campaign: $("[data-best-campaign]"),
  endless: $("[data-best-endless]")
};

let currentScreen = "title";
function showScreen(name) {
  Object.keys(screens).forEach((key) => { screens[key].hidden = key !== name; });
  currentScreen = name;
  document.body.dataset.screen = name;
}
let toastTimer = 0;
function toast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2100);
}

// ---------------------------------------------------------------------------
// Sound and preferences
// ---------------------------------------------------------------------------
let audioCtx = null;
let hostSoundOn = true;
let localMuted = false;
let localVolume = 70;
let hostReducedMotion = false;
let localReducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
function reducedMotion() { return hostReducedMotion || localReducedMotion; }
function applyMotionClass() { document.body.classList.toggle("reduced", reducedMotion()); }
function ensureAudio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch { audioCtx = null; }
  }
  return audioCtx;
}
function tone(frequency, duration, type, amount, delay) {
  if (!hostSoundOn || localMuted || localVolume <= 0) return;
  const audio = ensureAudio();
  if (!audio) return;
  const start = audio.currentTime + (delay || 0);
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.type = type || "sine";
  oscillator.frequency.setValueAtTime(frequency, start);
  const peak = Math.max(.0005, .12 * localVolume / 100 * (amount || 1));
  gain.gain.setValueAtTime(.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + .01);
  gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + .02);
}
const sfxGate = { fire: 0, fire2: 0, impact: 0, heavy: 0 };
const SFX_GAP_MS = { fire: 45, fire2: 45, impact: 60, heavy: 70 };
function sfx(name) {
  if (name in sfxGate) {
    const now = performance.now();
    if (now - sfxGate[name] < SFX_GAP_MS[name]) return;
    sfxGate[name] = now;
  }
  if (name === "place") { tone(430, .07, "triangle", .6); tone(650, .06, "triangle", .4, .03); }
  else if (name === "upgrade") { tone(420, .08, "square", .5); tone(630, .09, "square", .45, .07); tone(860, .1, "square", .4, .14); }
  else if (name === "fire") tone(790, .035, "square", .16);
  else if (name === "fire2") { tone(620, .05, "square", .26); tone(240, .06, "triangle", .3, .01); }
  else if (name === "heavy") tone(160, .1, "sawtooth", .3);
  else if (name === "impact") tone(230, .055, "triangle", .22);
  else if (name === "bossdown") { tone(180, .18, "sawtooth", .6); tone(360, .16, "triangle", .55, .12); tone(540, .2, "triangle", .5, .26); }
  else if (name === "leak") { tone(150, .22, "sawtooth", .6); tone(105, .3, "sawtooth", .5, .08); }
  else if (name === "wave") { tone(390, .12, "triangle", .55); tone(580, .16, "triangle", .5, .12); }
  else if (name === "ability") { tone(560, .08, "square", .6); tone(840, .12, "square", .55, .07); tone(1120, .16, "square", .5, .15); }
  else if (name === "victory") { tone(520, .16, "triangle", .65); tone(660, .16, "triangle", .6, .14); tone(790, .24, "triangle", .6, .28); }
  else if (name === "defeat") { tone(210, .28, "sawtooth", .6); tone(140, .38, "sawtooth", .55, .18); }
  else if (name === "pressure") { tone(310, .06, "square", .4); tone(520, .08, "square", .4, .05); }
}

// ---------------------------------------------------------------------------
// Persistent progression
// ---------------------------------------------------------------------------
const COMMAND_LEVEL_MAX = 8;
const MASTERY_LEVEL_MAX = 5;
const META_DEFAULT = {
  rank: 1,
  xp: 0,
  bestWaveCampaign: 0,
  bestWaveEndless: 0,
  totalRuns: 0,
  winsBattle: 0,
  lossesBattle: 0,
  tutorialSeen: false,
  soundVol: 70,
  reducedMotion: false,
  unlockedCsv: DEFENSE_ORDER.join(","),
  loadoutCsv: "glare,arc,frost,vane",
  commanderId: "astra",
  mapId: "cloudbreak",
  // Command Tower — permanent Core Shard progression, distinct from Glint
  // (which is purely in-match and resets every run). commandLevel buffs
  // every sentinel in the wing at once; mastery is per-sentinel-type.
  shards: 0,
  commandLevel: 1,
  ...Object.fromEntries(DEFENSE_ORDER.map((id) => ["mastery_" + id, 1]))
};
let meta = { ...META_DEFAULT };
function applyMetaFromState(state) {
  if (!state || typeof state !== "object") return;
  meta.rank = clampInt(state.rank, 1, 999, meta.rank);
  meta.xp = clampInt(state.xp, 0, 10000000, meta.xp);
  meta.bestWaveCampaign = clampInt(state.bestWaveCampaign, 0, 999, meta.bestWaveCampaign);
  meta.bestWaveEndless = clampInt(state.bestWaveEndless, 0, 9999, meta.bestWaveEndless);
  meta.totalRuns = clampInt(state.totalRuns, 0, 999999, meta.totalRuns);
  meta.winsBattle = clampInt(state.winsBattle, 0, 999999, meta.winsBattle);
  meta.lossesBattle = clampInt(state.lossesBattle, 0, 999999, meta.lossesBattle);
  meta.tutorialSeen = !!state.tutorialSeen;
  meta.soundVol = clampInt(state.soundVol, 0, 100, meta.soundVol);
  meta.reducedMotion = !!state.reducedMotion;
  if (typeof state.loadoutCsv === "string") meta.loadoutCsv = state.loadoutCsv.slice(0, 100);
  if (typeof state.commanderId === "string") meta.commanderId = state.commanderId.slice(0, 30);
  if (typeof state.mapId === "string") meta.mapId = state.mapId.slice(0, 30);
  meta.shards = clampInt(state.shards, 0, 999999, meta.shards);
  meta.commandLevel = clampInt(state.commandLevel, 1, COMMAND_LEVEL_MAX, meta.commandLevel);
  DEFENSE_ORDER.forEach((id) => {
    meta["mastery_" + id] = clampInt(state["mastery_" + id], 1, MASTERY_LEVEL_MAX, meta["mastery_" + id]);
  });
  localVolume = meta.soundVol;
  localReducedMotion = meta.reducedMotion || matchMedia("(prefers-reduced-motion: reduce)").matches;
  selectedDefenses = safeDefenseLoadout(meta.loadoutCsv.split(","), ["glare", "arc", "frost", "vane"]);
  selectedCommanderId = COMMANDERS[meta.commanderId] ? meta.commanderId : "astra";
  selectedMapId = MAP_BY_ID[meta.mapId] ? meta.mapId : "cloudbreak";
  applyCommanderTheme();
  applyMotionClass();
}
function metaPayload() {
  const payload = {
    rank: meta.rank,
    xp: meta.xp,
    bestWaveCampaign: meta.bestWaveCampaign,
    bestWaveEndless: meta.bestWaveEndless,
    totalRuns: meta.totalRuns,
    winsBattle: meta.winsBattle,
    lossesBattle: meta.lossesBattle,
    tutorialSeen: meta.tutorialSeen,
    soundVol: meta.soundVol,
    reducedMotion: meta.reducedMotion,
    unlockedCsv: DEFENSE_ORDER.join(","),
    loadoutCsv: selectedDefenses.join(","),
    commanderId: selectedCommanderId,
    mapId: selectedMapId,
    shards: meta.shards,
    commandLevel: meta.commandLevel
  };
  DEFENSE_ORDER.forEach((id) => { payload["mastery_" + id] = meta["mastery_" + id]; });
  return payload;
}
function commandUpgradeCost(level) { return level >= COMMAND_LEVEL_MAX ? null : level * 8; }
function masteryUpgradeCost(level) { return level >= MASTERY_LEVEL_MAX ? null : level * 4; }
function commandTowerBonus() {
  return { dmg: 1 + (meta.commandLevel - 1) * .04, range: 1 + (meta.commandLevel - 1) * .03 };
}
function masteryBonus(defId) { return 1 + ((meta["mastery_" + defId] || 1) - 1) * .06; }
function commandTowerStage() { return meta.commandLevel >= 7 ? 3 : meta.commandLevel >= 5 ? 2 : meta.commandLevel >= 3 ? 1 : 0; }
function grantRewards(reachedWave, won) {
  const xpGain = Math.max(0, reachedWave) * 14 + killCount + (won ? 120 : 0);
  meta.xp += xpGain;
  meta.totalRuns += 1;
  const oldRank = meta.rank;
  meta.rank = 1 + Math.floor(meta.xp / 350);
  meta.loadoutCsv = selectedDefenses.join(",");
  meta.commanderId = selectedCommanderId;
  meta.mapId = selectedMapId;
  // Core Shards: reward furthest wave reached, plus a real win bonus — a
  // loss still earns something for showing up, never a setback.
  const shardsGain = Math.max(1, Math.floor(Math.max(0, reachedWave) / 3)) + (won ? 5 : 0);
  meta.shards += shardsGain;
  return { xpGain, shardsGain, rankedUp: meta.rank > oldRank };
}

// ---------------------------------------------------------------------------
// Loadout stage
// ---------------------------------------------------------------------------
let pendingMode = "campaign";
let selectedDefenses = ["glare", "arc", "frost", "vane"];
let selectedCommanderId = "astra";
let selectedMapId = "cloudbreak";
function safeDefenseLoadout(value, fallback) {
  const list = Array.isArray(value) ? value.filter((id) => DEFENSES[id]) : [];
  const unique = [...new Set(list)].slice(0, 4);
  return unique.length === 4 ? unique : fallback.slice(0, 4);
}
function currentMap() { return MAP_BY_ID[selectedMapId] || MAPS[0]; }
function currentCommander() { return COMMANDERS[selectedCommanderId] || COMMANDERS.astra; }
function applyCommanderTheme() {
  document.body.dataset.commander = selectedCommanderId;
}
function chooseDefense(id) {
  if (!DEFENSES[id]) return;
  if (selectedDefenses.includes(id)) {
    toast("A command wing always fields exactly four defenses.");
    return;
  }
  selectedDefenses = selectedDefenses.slice(1).concat(id);
  renderLoadout();
}
function renderLoadout() {
  const order = new Map(selectedDefenses.map((id, index) => [id, index + 1]));
  defenseGridEl.innerHTML = DEFENSE_ORDER.map((id) => {
    const def = DEFENSES[id];
    const selected = order.has(id);
    return '<button type="button" class="sg-defense-option ' + (selected ? "is-selected" : "") + '" data-defense-choice="' + id + '" style="--def-color:' + def.color + '">' +
      (selected ? '<i class="sg-pick">' + order.get(id) + "</i>" : "") +
      "<b>" + esc(def.name) + "</b><span>" + esc(def.desc) + "</span><small>" + esc(def.role) + " / " + def.cost + " Glint</small></button>";
  }).join("");
  commanderGridEl.innerHTML = COMMANDER_ORDER.map((id) => {
    const commander = COMMANDERS[id];
    return '<button type="button" class="sg-commander-option ' + (id === selectedCommanderId ? "is-selected" : "") + '" data-commander-choice="' + id + '" style="--cmd-color:' + commander.color + '">' +
      '<i class="sg-commander-sigil">' + commander.sigil + "</i><span><b>" + esc(commander.name + " / " + commander.faction) + "</b><span>" + esc(commander.passive + " " + commander.ability + ": " + commander.abilityCopy) + "</span></span></button>";
  }).join("");
  mapGridEl.innerHTML = MAPS.map((map) =>
    '<button type="button" class="sg-map-option ' + (map.id === selectedMapId ? "is-selected" : "") + '" data-map-choice="' + map.id + '">' +
      "<b>" + esc(map.name) + "</b><span>" + esc(map.rule) + "</span><small>" + esc(map.objectiveLabel) + "</small></button>"
  ).join("");
  defenseGridEl.querySelectorAll("[data-defense-choice]").forEach((button) => button.addEventListener("click", () => chooseDefense(button.dataset.defenseChoice)));
  commanderGridEl.querySelectorAll("[data-commander-choice]").forEach((button) => button.addEventListener("click", () => {
    selectedCommanderId = COMMANDERS[button.dataset.commanderChoice] ? button.dataset.commanderChoice : "astra";
    applyCommanderTheme();
    renderLoadout();
  }));
  mapGridEl.querySelectorAll("[data-map-choice]").forEach((button) => button.addEventListener("click", () => {
    selectedMapId = MAP_BY_ID[button.dataset.mapChoice] ? button.dataset.mapChoice : "cloudbreak";
    renderLoadout();
    draw();
  }));
  $("[data-defense-count]").textContent = selectedDefenses.length + " / 4";
  $("[data-map-objective]").textContent = currentMap().objectiveLabel.toUpperCase();
  $("[data-loadout-mode]").textContent = modeLabel(pendingMode).toUpperCase();
  const defNames = selectedDefenses.map((id) => DEFENSES[id].name).join(" / ");
  $("[data-loadout-summary]").innerHTML = "<b>" + esc(currentCommander().name) + "</b> / " + esc(defNames) + " / " + esc(currentMap().name);
  renderRoomLoadout();
}
function openLoadout(nextMode) {
  pendingMode = nextMode;
  if (pendingMode === "battle" && !battle.active) {
    toast("Open Skyguard Arena from a private PhantomPlay room first.");
    return;
  }
  renderLoadout();
  showScreen("loadout");
}
function modeLabel(value) {
  return ({ campaign: "Frontier Campaign", endless: "Century Watch", skirmish: "War Game vs AI", battle: "Private Room War" })[value] || "Battle";
}

// ---------------------------------------------------------------------------
// Command Tower Armory (permanent Core Shard progression)
// ---------------------------------------------------------------------------
let armoryOpen = false;
function commandTierName(level) {
  return level >= 7 ? "Sovereign Spire" : level >= 5 ? "Aegis Command" : level >= 3 ? "Watch Command" : "Field Command";
}
function drawCommandTowerIcon(pctx, cx, cy, size, stage) {
  pctx.save();
  pctx.translate(cx, cy);
  if (stage >= 1) {
    pctx.fillStyle = "rgba(255,200,87,.14)";
    pctx.beginPath();
    pctx.arc(0, 0, size * 1.5, 0, Math.PI * 2);
    pctx.fill();
  }
  pctx.fillStyle = "#100e08";
  pctx.strokeStyle = stage >= 2 ? "#ffe9a8" : "#ffc857";
  pctx.lineWidth = stage >= 3 ? 3 : 2;
  if (stage >= 2) { pctx.shadowColor = "#ffc857"; pctx.shadowBlur = size * .9; }
  pctx.beginPath();
  pctx.moveTo(-size * .55, size * .8);
  pctx.lineTo(-size * .4, -size * .3);
  pctx.lineTo(-size * .2, -size * .3);
  pctx.lineTo(-size * .2, -size * .9);
  pctx.lineTo(size * .2, -size * .9);
  pctx.lineTo(size * .2, -size * .3);
  pctx.lineTo(size * .4, -size * .3);
  pctx.lineTo(size * .55, size * .8);
  pctx.closePath();
  pctx.fill();
  pctx.stroke();
  pctx.shadowBlur = 0;
  const stars = Math.max(1, stage + 1);
  for (let i = 0; i < stars; i++) {
    const sx = (i - (stars - 1) / 2) * size * .32;
    pctx.fillStyle = "#ffe9a8";
    pctx.beginPath();
    pctx.arc(sx, -size * 1.05, size * .09, 0, Math.PI * 2);
    pctx.fill();
  }
  pctx.restore();
}
function renderArmoryTowerPortrait() {
  const portrait = $("[data-armory-tower-portrait]");
  const stage = commandTowerStage();
  portrait.innerHTML = "";
  const canvas2 = document.createElement("canvas");
  canvas2.width = 260;
  canvas2.height = 260;
  canvas2.style.width = "100%";
  canvas2.style.height = "100%";
  portrait.appendChild(canvas2);
  const pctx = canvas2.getContext("2d");
  drawCommandTowerIcon(pctx, 130, 158, 46, stage);
  pctx.fillStyle = "#ffc857";
  pctx.font = "900 13px ui-monospace, monospace";
  pctx.textAlign = "center";
  pctx.fillText(commandTierName(meta.commandLevel).toUpperCase(), 130, 232);
}
function renderArmory() {
  $("[data-armory-shards]").textContent = String(meta.shards);
  $("[data-armory-tower-level]").textContent = "Level " + meta.commandLevel + (meta.commandLevel >= COMMAND_LEVEL_MAX ? " · MAX" : "");
  const bonus = commandTowerBonus();
  $("[data-armory-tower-stats]").innerHTML = [
    "+" + Math.round((bonus.dmg - 1) * 100) + "% sentinel damage",
    "+" + Math.round((bonus.range - 1) * 100) + "% sentinel range"
  ].map((s) => "<span>" + esc(s) + "</span>").join("");
  const towerCost = commandUpgradeCost(meta.commandLevel);
  const towerBtn = $("[data-armory-tower-upgrade]");
  towerBtn.disabled = towerCost === null || meta.shards < towerCost;
  towerBtn.textContent = towerCost === null ? "Command Tower ascended" : "Tower ascension — " + towerCost + " Shards";
  renderArmoryTowerPortrait();
  $("[data-armory-sentinel-grid]").innerHTML = DEFENSE_ORDER.map((id) => {
    const def = DEFENSES[id];
    const level = meta["mastery_" + id] || 1;
    const cost = masteryUpgradeCost(level);
    const maxed = cost === null;
    const pips = Array.from({ length: MASTERY_LEVEL_MAX }, (_, i) => '<i class="' + (i < level ? "is-filled" : "") + '"></i>').join("");
    return '<div class="sg-armory-sentinel-card ' + (maxed ? "is-maxed" : "") + '" style="--def-color:' + def.color + '">' +
      "<b>" + esc(def.name) + "</b><small>Level " + level + (maxed ? " · MAX" : "") + "</small>" +
      '<div class="sg-armory-pips">' + pips + "</div>" +
      '<button type="button" class="sg-armory-sentinel-upgrade" data-armory-sentinel-upgrade="' + id + '" ' + (maxed || meta.shards < cost ? "disabled" : "") + ">" +
      (maxed ? "Max level" : "Level up — " + cost) + "</button></div>";
  }).join("");
  $("[data-armory-sentinel-grid]").querySelectorAll("[data-armory-sentinel-upgrade]").forEach((button) => {
    button.addEventListener("click", () => buyMasteryUpgrade(button.dataset.armorySentinelUpgrade));
  });
}
function openArmory() {
  armoryOpen = true;
  $("[data-armory-overlay]").hidden = false;
  renderArmory();
}
function closeArmory() {
  armoryOpen = false;
  $("[data-armory-overlay]").hidden = true;
}
function commandAscensionFlash() {
  const card = $("[data-armory-tower-card]");
  card.classList.remove("is-ascending");
  void card.offsetWidth;
  card.classList.add("is-ascending");
  toast("Command Tower ascended — Level " + meta.commandLevel + "!");
}
function saveArmory() { host("progress", { state: metaPayload() }); }
function buyCommandUpgrade() {
  const cost = commandUpgradeCost(meta.commandLevel);
  if (cost === null || meta.shards < cost) return;
  meta.shards -= cost;
  meta.commandLevel += 1;
  saveArmory();
  renderArmory();
  commandAscensionFlash();
}
function buyMasteryUpgrade(defId) {
  if (!DEFENSES[defId]) return;
  const key = "mastery_" + defId;
  const level = meta[key] || 1;
  const cost = masteryUpgradeCost(level);
  if (cost === null || meta.shards < cost) return;
  meta.shards -= cost;
  meta[key] = level + 1;
  saveArmory();
  renderArmory();
  toast(DEFENSES[defId].name + " reached mastery level " + meta[key] + ".");
}

// ---------------------------------------------------------------------------
// Run state and world objects
// ---------------------------------------------------------------------------
let mode = null;
let running = false;
let paused = false;
let runCompleted = false;
let resultKind = null;
let gold = 0;
let lives = 0;
let maxLives = 20;
let wave = 0;
let totalWaves = 0;
let score = 0;
let killCount = 0;
let damageDealt = 0;
let glintSpent = 0;
let leakCount = 0;
let abilityUses = 0;
let simTime = 0;
let prepRemaining = 0;
let waveActive = false;
let waveClockMs = 0;
let spawnQueue = [];
let sentinels = [];
let enemies = [];
let projectiles = [];
let effects = [];
let floaters = [];
let selectedSlot = -1;
let focusedSlot = 0;
let placingDefense = null;
let abilityCooldown = 0;
let abilityActive = 0;
let pressureCooldown = 0;
let mapObjective = null;
let mapHazardClock = 6;
let mapWind = 1;
let spireFlash = 0;
let cameraShake = 0;
let lastDockGold = -1;
let uidCounter = 1;
let bot = null;
function uid() { return uidCounter++; }

function newBot(difficulty) {
  const multiplier = ({ easy: .82, standard: 1, hard: 1.22 })[difficulty] || 1;
  const playerRoles = selectedDefenses.map((id) => DEFENSES[id].role);
  const loadout = ["glare", playerRoles.includes("Splash") ? "vane" : "arc", playerRoles.includes("Anti-air") ? "mortar" : "flak", "null"];
  return {
    label: "Marshal AI",
    lives: 20,
    maxLives: 20,
    wave: 0,
    gold: 220,
    alive: true,
    result: null,
    multiplier,
    loadout,
    commander: selectedCommanderId === "rook" ? "ilex" : "rook",
    pressureClock: 5.5,
    jamStacks: 0
  };
}
function botDefenseScore(theBot, waveNo) {
  let value = 8.5 * theBot.multiplier + waveNo * .45;
  theBot.loadout.forEach((id) => {
    const role = DEFENSES[id].role;
    if (role === "Splash" || role === "Anti-air" || role === "Anti-armor" || role === "Shield break") value += 1.15;
  });
  return value;
}
function botAdvanceWave(theBot, waveNo, isBoss) {
  if (!theBot || !theBot.alive) return;
  const attack = 7 + waveNo * 1.3 + (isBoss ? 13 : 0) + (theBot.jamStacks || 0) * 3.5;
  const defense = botDefenseScore(theBot, waveNo);
  const loss = Math.max(0, Math.round((attack - defense) * (.65 + Math.random() * .35)));
  theBot.lives = Math.max(0, theBot.lives - loss);
  theBot.wave = waveNo;
  theBot.gold += 42 + waveNo * 6;
  theBot.jamStacks = 0;
  if (theBot.lives <= 0) {
    theBot.alive = false;
    theBot.result = "defeated";
  }
}
function objectiveStart() {
  const commander = currentCommander();
  const map = currentMap();
  if (map.objective === "relay") return { relay: commander.id === "ilex" ? 18 : map.id === "neontangle" ? 16 : 14 };
  if (map.objective === "shield") return { shield: commander.id === "ilex" ? 12 : 8, maxShield: commander.id === "ilex" ? 12 : 8 };
  return { gates: [{ t: .39, hp: commander.id === "rook" ? 300 : 240, max: commander.id === "rook" ? 300 : 240 }, { t: .67, hp: commander.id === "rook" ? 270 : 215, max: commander.id === "rook" ? 270 : 215 }] };
}
function defenseOpeningScore(defId) {
  const def = DEFENSES[defId];
  if (!def) return 0;
  let score = def.target === "any" ? 5 : 2;
  if (def.role === "Kinetic") score += 4;
  if (def.role === "Splash" || def.role === "Control") score += 3;
  if (def.role === "Anti-air") score += 2;
  score += Math.min(4, def.tiers[0].range / 50);
  return score;
}
function starterDefenseIds() {
  return selectedDefenses
    .slice()
    .sort((a, b) => defenseOpeningScore(b) - defenseOpeningScore(a))
    .slice(0, 2);
}
function openingSlotScore(slotIndex) {
  const origin = slotPoint(slotIndex);
  let score = 0;
  currentMap().routes.forEach((route) => {
    [.20, .28, .36, .44, .54, .64].forEach((t) => {
      const point = pointAt(route, t);
      const distance = Math.hypot(point.x - origin.x, point.y - origin.y);
      if (distance <= 185) score += (185 - distance) / 185 + (t <= .44 ? .38 : 0);
    });
  });
  return score;
}
function seedOpeningDefenses() {
  const starterIds = starterDefenseIds();
  const selected = [];
  const rankedSlots = currentMap().slots
    .map((_, index) => ({ index, score: openingSlotScore(index) }))
    .sort((a, b) => b.score - a.score);
  starterIds.forEach((defId) => {
    const pick = rankedSlots.find((candidate) => {
      if (selected.includes(candidate.index)) return false;
      const point = slotPoint(candidate.index);
      return selected.every((slotIndex) => {
        const other = slotPoint(slotIndex);
        return Math.hypot(point.x - other.x, point.y - other.y) >= 170;
      });
    }) || rankedSlots.find((candidate) => !selected.includes(candidate.index));
    if (!pick) return;
    selected.push(pick.index);
    sentinels.push({
      id: uid(),
      defId,
      tier: 0,
      slotIndex: pick.index,
      cooldown: 0,
      recoil: 0,
      jammed: 0,
      aim: 0,
      spent: 0,
      starter: true
    });
  });
  if (sentinels.length) toast("Starter sentries are covering the first route.");
}
function startRun(nextMode) {
  mode = nextMode;
  gold = mode === "endless" ? 300 : 270;
  lives = maxLives = 20;
  wave = 0;
  score = 0;
  killCount = 0;
  damageDealt = 0;
  glintSpent = 0;
  leakCount = 0;
  abilityUses = 0;
  simTime = 0;
  prepRemaining = 0;
  waveActive = false;
  waveClockMs = 0;
  spawnQueue = [];
  sentinels = [];
  enemies = [];
  projectiles = [];
  effects = [];
  floaters = [];
  selectedSlot = -1;
  focusedSlot = 0;
  placingDefense = null;
  abilityCooldown = 0;
  abilityActive = 0;
  pressureCooldown = 0;
  mapObjective = objectiveStart();
  mapHazardClock = 5.5;
  mapWind = 1;
  spireFlash = 0;
  cameraShake = 0;
  lastDockGold = -1;
  runCompleted = false;
  resultKind = null;
  running = true;
  paused = false;
  totalWaves = mode === "endless" ? CENTURY_ROUNDS : CAMPAIGN_WAVES.length;
  bot = mode === "skirmish" ? newBot("standard") : null;
  seedOpeningDefenses();
  hud.mode.textContent = modeLabel(mode);
  opponentPanel.hidden = !(mode === "skirmish" || mode === "battle");
  overlayPause.hidden = true;
  showScreen("game");
  requestAnimationFrame(resizeCanvas);
  renderDock();
  renderSelected();
  renderPressureDock();
  updateHud();
  renderOpponent();
  beginPrep(4.5);
  host("progress", { score: 0, progress: 0 });
}
function beginPrep(seconds) {
  prepRemaining = seconds;
  waveBanner.hidden = false;
  bossBanner.hidden = true;
  waveBanner.textContent = "Next formation in " + Math.ceil(seconds) + "s";
}

// ---------------------------------------------------------------------------
// Waves, routes, and map rules
// ---------------------------------------------------------------------------
function enemyPosition(enemy) {
  const route = currentMap().routes[enemy.routeIndex] || currentMap().routes[0];
  const point = pointAt(route, enemy.t);
  const tangent = tangentAt(route, enemy.t);
  enemy.x = point.x - tangent.y * enemy.lateral;
  enemy.y = point.y + tangent.x * enemy.lateral;
  enemy.angle = Math.atan2(tangent.y, tangent.x);
}
function spawnEnemy(type, hpMultiplier, routeIndex, lateral, startT, mods) {
  const base = ENEMIES[type];
  if (!base || enemies.length >= MAX_ENEMIES) return null;
  const route = clampInt(routeIndex, 0, currentMap().routes.length - 1, 0);
  const rawMul = Math.max(.1, Number(hpMultiplier) || 1);
  /* Bosses take a damped share of the century curve so late milestones stay killable. */
  const mul = base.boss ? 1 + (rawMul - 1) * .5 : rawMul;
  const m = mods && typeof mods === "object" ? mods : null;
  const speedMul = m && Number.isFinite(m.speedMul) ? (base.boss ? 1 + (m.speedMul - 1) * .5 : m.speedMul) : 1;
  const armorBonus = m && Number.isFinite(m.armorBonus) ? m.armorBonus : 0;
  const bountyMul = m && Number.isFinite(m.bountyMul) ? m.bountyMul : 1;
  const hp = base.hp * mul;
  const enemy = {
    id: uid(),
    type,
    routeIndex: route,
    t: clamp(Number(startT) || 0, 0, .98),
    lateral: Number(lateral) || 0,
    x: 0,
    y: 0,
    angle: 0,
    hp,
    maxHp: hp,
    shield: (base.shield || 0) * mul,
    maxShield: (base.shield || 0) * mul,
    armor: (base.armor || 0) + (base.swarm ? 0 : armorBonus),
    speed: base.speed * speedMul,
    bounty: Math.round(base.bounty * bountyMul),
    hpMul: rawMul,
    mods: m,
    alive: true,
    death: 0,
    hitFlash: 0,
    slowUntil: 0,
    slowAmount: 0,
    revealedUntil: 0,
    gateMask: 0,
    relayMask: 0,
    attackCooldown: 0,
    sabotageDone: false,
    mechClock: 3.5,
    phaseStep: 0,
    burrowUntil: 0,
    invulnUntil: 0,
    enraged: false
  };
  enemyPosition(enemy);
  enemies.push(enemy);
  return enemy;
}
function queueWave(entries, hpMultiplier, mods) {
  spawnQueue = [];
  entries.forEach((entry, entryIndex) => {
    const count = Math.max(0, Math.floor(entry.count));
    for (let i = 0; i < count; i++) {
      const formation = Math.max(1, entry.formation || 1);
      const formationIndex = i % formation;
      const route = Number.isInteger(entry.route) ? entry.route : (i + entryIndex + wave) % currentMap().routes.length;
      const lateral = (formationIndex - (formation - 1) / 2) * (formation > 3 ? 7 : 11);
      spawnQueue.push({
        time: (entry.delay || 0) + Math.floor(i / formation) * entry.gap + formationIndex * 75,
        type: entry.type,
        hpMultiplier: hpMultiplier || 1,
        route,
        lateral,
        mods: mods || null
      });
    }
  });
  spawnQueue.sort((a, b) => a.time - b.time);
  waveClockMs = 0;
  waveActive = true;
}
function scheduleWave(number) {
  wave = number;
  let entries;
  let hpMultiplier = 1;
  let mods = null;
  let bossInfo = null;
  if (mode === "endless") {
    const generated = endlessWave(number);
    entries = generated.entries;
    hpMultiplier = generated.hpMul;
    mods = { speedMul: generated.speedMul, armorBonus: generated.armorBonus, bountyMul: generated.bountyMul };
    if (generated.boss) bossInfo = generated.boss;
  } else {
    entries = CAMPAIGN_WAVES[number - 1];
  }
  if (!entries) return;
  const boss = entries.some((entry) => ENEMIES[entry.type] && ENEMIES[entry.type].boss);
  waveBanner.hidden = boss;
  bossBanner.hidden = !boss;
  if (boss) {
    bossBanner.textContent = bossInfo
      ? "ROUND " + number + " SIGNAL / " + bossInfo.title + " / " + bossInfo.tag
      : "FLAGSHIP SIGNAL / VOIDMAW COLOSSUS";
    sfx("heavy");
  } else {
    waveBanner.textContent = (mode === "endless" ? "Round " + number + "/" + totalWaves : "Wave " + number + "/" + totalWaves) + " inbound";
    waveBanner.hidden = false;
  }
  queueWave(entries, hpMultiplier, mods);
  updateHud();
}
function handleWaveCleared() {
  const bossWave = mode === "endless" ? wave % 10 === 0 : wave % 8 === 0;
  /* Century economy: flat bonus scales with round, boss rounds pay extra, and
     held Glint earns capped interest so upgrades stay reachable to round 100. */
  const interest = Math.min(90, Math.floor(gold * .06));
  const bonus = 30 + wave * 8 + (bossWave ? 40 + wave * 2 : 0) + interest;
  gold += bonus;
  score += wave * 45 + (bossWave ? 250 : 0);
  if (mode === "endless") toast("Round " + wave + " cleared / +" + bonus + " Glint (" + interest + " interest)");
  if (currentMap().objective === "relay") mapObjective.relay = Math.min(18, mapObjective.relay + 1);
  if (currentMap().objective === "shield") mapObjective.shield = Math.min(mapObjective.maxShield, mapObjective.shield + 1);
  if (currentMap().objective === "gates") {
    const repair = currentCommander().id === "rook" ? 48 : 32;
    mapObjective.gates.forEach((gate) => { gate.hp = Math.min(gate.max, gate.hp + repair); });
  }
  sfx("wave");
  reportProgress();
  if (mode === "skirmish") {
    botAdvanceWave(bot, wave, bossWave);
    if (!bot.alive) { finishRun("victory"); return; }
  }
  if (mode === "battle") maybeBroadcastHostStatus(false);
  const isLast = wave >= totalWaves;
  if (isLast) {
    if (mode === "skirmish" && bot && bot.alive && lives < bot.lives) finishRun("defeat");
    else finishRun("victory");
    return;
  }
  beginPrep(mode === "endless" ? 3.2 : 4);
}
function leakEnemy(enemy) {
  enemy.alive = false;
  leakCount += 1;
  const leakBase = ENEMIES[enemy.type];
  let drain = leakBase.leakDrain || (leakBase.boss ? 5 : leakBase.heavy ? 2 : 1);
  if (currentMap().objective === "shield" && mapObjective.shield > 0) {
    const absorbed = Math.min(mapObjective.shield, drain);
    mapObjective.shield -= absorbed;
    drain -= absorbed;
  }
  lives = Math.max(0, lives - drain);
  spireFlash = .42;
  cameraShake = .35;
  sfx("leak");
  if (mode === "battle" && battle.amIHost) maybeBroadcastHostStatus(false);
  if (lives <= 0 && running) finishRun("defeat");
}
function gateHolding(enemy, dt) {
  if (currentMap().objective !== "gates" || ENEMIES[enemy.type].air || ENEMIES[enemy.type].phase) return false;
  for (let i = 0; i < mapObjective.gates.length; i++) {
    const gate = mapObjective.gates[i];
    const bit = 1 << i;
    if (enemy.gateMask & bit || gate.hp <= 0) continue;
    if (enemy.t >= gate.t - .012) {
      enemy.attackCooldown -= dt;
      if (enemy.attackCooldown <= 0) {
        enemy.attackCooldown = ENEMIES[enemy.type].heavy ? .7 : 1.1;
        const damage = ENEMIES[enemy.type].boss ? 38 : ENEMIES[enemy.type].heavy ? 19 : 9;
        gate.hp = Math.max(0, gate.hp - damage);
        effects.push({ type: "impact", x: enemy.x, y: enemy.y, color: "#ff8b62", life: .28, age: 0, size: 24 });
        cameraShake = Math.min(.28, cameraShake + .05);
        if (gate.hp <= 0) {
          enemy.gateMask |= bit;
          announceMapEvent("Gate " + (i + 1) + " breached");
        }
      }
      return gate.hp > 0;
    }
  }
  return false;
}
function checkRelayCrossing(enemy) {
  if (currentMap().objective !== "relay") return;
  [.36, .68].forEach((relayT, index) => {
    const bit = 1 << index;
    if (!(enemy.relayMask & bit) && enemy.t >= relayT) {
      enemy.relayMask |= bit;
      const loss = ENEMIES[enemy.type].boss ? 2.2 : ENEMIES[enemy.type].heavy ? .8 : .35;
      mapObjective.relay = Math.max(0, mapObjective.relay - loss);
      effects.push({ type: "relay", x: enemy.x, y: enemy.y, color: "#ff7165", life: .55, age: 0, size: 40 });
      if (mapObjective.relay <= 0 && running) finishRun("defeat");
    }
  });
}
function saboteurStrike(enemy) {
  if (!ENEMIES[enemy.type].saboteur || enemy.sabotageDone) return;
  const nearest = sentinels.map((sentinel) => ({ sentinel, distance: distanceToSentinel(enemy, sentinel) }))
    .filter((item) => item.distance < 54)
    .sort((a, b) => a.distance - b.distance)[0];
  if (nearest) {
    nearest.sentinel.jammed = Math.max(nearest.sentinel.jammed, 4.2);
    enemy.sabotageDone = true;
    effects.push({ type: "jam", x: enemy.x, y: enemy.y, color: "#65d8cf", life: .6, age: 0, size: 35 });
    toast("A Wire Saboteur jammed " + DEFENSES[nearest.sentinel.defId].name + ".");
  }
}
function announceMapEvent(message) {
  mapEventEl.textContent = message;
  mapEventEl.hidden = false;
  clearTimeout(announceMapEvent.timer);
  announceMapEvent.timer = setTimeout(() => { mapEventEl.hidden = true; }, 1900);
}
function triggerStormStrike() {
  const targets = [];
  if (sentinels.length) {
    const sentinel = sentinels[Math.floor(Math.random() * sentinels.length)];
    const slot = currentMap().slots[sentinel.slotIndex];
    targets.push({ x: slot[0] * REF_W, y: slot[1] * REF_H, sentinel });
  }
  const alive = enemies.filter((enemy) => enemy.alive);
  if (alive.length) {
    const enemy = alive[Math.floor(Math.random() * alive.length)];
    targets.push({ x: enemy.x, y: enemy.y, enemy });
  }
  targets.forEach((target) => effects.push({ type: "lightning", ...target, color: "#65d8cf", life: 1.15, age: 0, struck: false, size: 58 }));
  announceMapEvent("Stormglass discharge telegraphed");
}
function triggerRelaySurge() {
  const route = currentMap().routes[3] || currentMap().routes[1] || currentMap().routes[0];
  const point = pointAt(route, .5);
  effects.push({ type: "relay", x: point.x, y: point.y, color: "#35f7ff", life: .95, age: 0, struck: false, surge: true, size: 118 });
  announceMapEvent("Neon relay surge charging center lane");
}
function updateMapHazards(dt) {
  mapHazardClock -= dt;
  if (currentMap().id === "cloudbreak" && mapHazardClock <= 0) {
    mapHazardClock = 7 + Math.random() * 3;
    mapWind *= -1;
    effects.push({ type: "wind", x: REF_W * .5, y: REF_H * .5, color: "#b8f6e9", life: 1.1, age: 0, size: 110 });
    announceMapEvent(mapWind > 0 ? "Crosswind surging east" : "Crosswind reversing west");
  } else if (currentMap().id === "stormring" && mapHazardClock <= 0) {
    mapHazardClock = 8 + Math.random() * 2.5;
    triggerStormStrike();
  } else if (currentMap().id === "iron" && mapHazardClock <= 0) {
    mapHazardClock = 9;
    const intact = mapObjective.gates.filter((gate) => gate.hp > 0).length;
    announceMapEvent(intact ? intact + " gate lines holding" : "All gate lines breached");
  } else if (currentMap().id === "neontangle" && mapHazardClock <= 0) {
    mapHazardClock = 6.5 + Math.random() * 2.2;
    triggerRelaySurge();
  }
  effects.filter((effect) => effect.type === "lightning" && !effect.struck && effect.age >= .78).forEach((effect) => {
    effect.struck = true;
    if (effect.sentinel) effect.sentinel.jammed = Math.max(effect.sentinel.jammed, 2.4);
    enemies.forEach((enemy) => {
      if (enemy.alive && Math.hypot(enemy.x - effect.x, enemy.y - effect.y) < 62) dealDamage(enemy, 34, { pierce: 3, color: "#65d8cf" });
    });
    cameraShake = .28;
  });
  effects.filter((effect) => effect.type === "relay" && effect.surge && !effect.struck && effect.age >= .45).forEach((effect) => {
    effect.struck = true;
    enemies.forEach((enemy) => {
      if (!enemy.alive || Math.hypot(enemy.x - effect.x, enemy.y - effect.y) > 116) return;
      dealDamage(enemy, 18, { pierce: 2, color: "#35f7ff" });
      enemy.slowAmount = Math.max(enemy.slowAmount, .5);
      enemy.slowUntil = Math.max(enemy.slowUntil, simTime + 2.4);
    });
    cameraShake = Math.min(.3, cameraShake + .12);
  });
}

// ---------------------------------------------------------------------------
// Defense combat and projectiles
// ---------------------------------------------------------------------------
function slotPoint(slotIndex) {
  const slot = currentMap().slots[slotIndex] || currentMap().slots[0];
  return { x: slot[0] * REF_W, y: slot[1] * REF_H };
}
function distanceToSentinel(point, sentinel) {
  const slot = slotPoint(sentinel.slotIndex);
  return Math.hypot(point.x - slot.x, point.y - slot.y);
}
function droneBoost(sentinel) {
  let boost = 0;
  sentinels.forEach((other) => {
    if (other === sentinel || other.defId !== "drone" || other.jammed > 0) return;
    const stats = DEFENSES.drone.tiers[other.tier];
    if (Math.hypot(slotPoint(other.slotIndex).x - slotPoint(sentinel.slotIndex).x, slotPoint(other.slotIndex).y - slotPoint(sentinel.slotIndex).y) <= stats.boostRange) {
      boost = Math.max(boost, stats.boost);
    }
  });
  return boost;
}
function currentStats(sentinel) {
  const base = DEFENSES[sentinel.defId].tiers[sentinel.tier];
  const commander = currentCommander();
  const stats = { ...base };
  if (commander.id === "astra" && sentinel.defId === "glare") stats.rof *= 1.18;
  if (commander.id === "ilex" && stats.slowDur) stats.slowDur *= 1.35;
  if (commander.id === "rook") stats.pierce = (stats.pierce || 0) + 2;
  if (commander.id === "vesper") stats.range *= 1.12;
  const boost = droneBoost(sentinel);
  stats.rof *= 1 + boost;
  if (abilityActive > 0 && commander.id === "astra") { stats.rof *= 1.55; stats.dmg *= 1.55; }
  // Command Tower (global, every sentinel) + Sentinel Mastery (per-type),
  // both permanent Core Shard progression stacking on top of the in-match
  // Glint-paid tier the sentinel is currently placed at.
  const tower = commandTowerBonus();
  stats.dmg *= tower.dmg * masteryBonus(sentinel.defId);
  stats.range *= tower.range;
  return stats;
}
function validDefenseTarget(defense, enemy) {
  const base = ENEMIES[enemy.type];
  if (!enemy.alive) return false;
  if (enemy.burrowUntil > simTime) return false;
  if (defense.target === "air" && !base.air) return false;
  if (defense.target === "ground" && base.air) return false;
  return true;
}
function findTarget(sentinel, stats) {
  const origin = slotPoint(sentinel.slotIndex);
  const defense = DEFENSES[sentinel.defId];
  let best = null;
  let bestScore = -Infinity;
  for (let i = 0; i < enemies.length; i++) {
    const enemy = enemies[i];
    if (!validDefenseTarget(defense, enemy)) continue;
    const distance = Math.hypot(enemy.x - origin.x, enemy.y - origin.y);
    if (distance > stats.range || (stats.minRange && distance < stats.minRange)) continue;
    let threat = enemy.t * 100;
    if (defense.airBonus && ENEMIES[enemy.type].air) threat += 35;
    if (stats.pierce && enemy.armor > 3) threat += 22;
    if (stats.shieldDamage && enemy.shield > 0) threat += 28;
    if (stats.splash && ENEMIES[enemy.type].swarm) threat += 20;
    if (ENEMIES[enemy.type].boss) threat += 18;
    if (threat > bestScore) { best = enemy; bestScore = threat; }
  }
  return best;
}
function fireSentinel(sentinel, stats, target) {
  const origin = slotPoint(sentinel.slotIndex);
  const def = DEFENSES[sentinel.defId];
  sentinel.aim = Math.atan2(target.y - origin.y, target.x - origin.x);
  sentinel.recoil = .16;
  const damage = stats.dmg * (stats.airBonus && ENEMIES[target.type].air ? stats.airBonus : 1);
  projectiles.push({
    id: uid(),
    x: origin.x,
    y: origin.y - 8,
    sx: origin.x,
    sy: origin.y - 8,
    target,
    tx: target.x,
    ty: target.y,
    speed: stats.projectile || 650,
    damage,
    pierce: stats.pierce || 0,
    splash: stats.splash || 0,
    slow: stats.slow || 0,
    slowDur: stats.slowDur || 0,
    shieldDamage: stats.shieldDamage || 0,
    reveal: stats.reveal || 0,
    pull: stats.pull || 0,
    arc: stats.arc || 0,
    color: def.color,
    defId: def.id,
    alive: true,
    age: 0,
    traveled: 0
  });
  if (!reducedMotion() && effects.length < 170) {
    effects.push({ type: "muzzle", x: origin.x, y: origin.y - 8, angle: sentinel.aim, color: def.color, life: .09, age: 0, size: 12 + sentinel.tier * 5 });
  }
  sfx(def.id === "vane" || def.id === "mortar" ? "heavy" : sentinel.tier >= 2 ? "fire2" : "fire");
}
function dealDamage(enemy, amount, attack) {
  if (!enemy || !enemy.alive) return;
  const info = attack || {};
  if (enemy.invulnUntil > simTime) {
    if (floaters.length < 48) floaters.push({ x: enemy.x, y: enemy.y - 17, text: "IMMUNE", color: "#b792ff", life: .5, age: 0 });
    return;
  }
  let damage = amount;
  if (enemy.shield > 0) {
    const shieldMultiplier = info.shieldDamage || 1;
    const shieldHit = Math.min(enemy.shield, damage * shieldMultiplier);
    enemy.shield -= shieldHit;
    damage = Math.max(0, damage - shieldHit / shieldMultiplier);
  }
  if (damage > 0) damage = Math.max(1, damage - Math.max(0, enemy.armor - (info.pierce || 0)));
  enemy.hp -= damage;
  enemy.hitFlash = .15;
  damageDealt += Math.round(amount);
  if (floaters.length < 48) floaters.push({ x: enemy.x, y: enemy.y - 17, text: String(Math.round(amount)), color: info.color || "#fff", life: .55, age: 0 });
  if (effects.length < 160) effects.push({ type: "impact", x: enemy.x, y: enemy.y, color: info.color || "#fff", life: .28, age: 0, size: info.splash || 22 });
  cameraShake = Math.min(.28, cameraShake + (ENEMIES[enemy.type].boss ? .09 : .018));
  if (enemy.hp <= 0) killEnemy(enemy);
}
function applyProjectileImpact(projectile) {
  const target = projectile.target;
  const impact = target && target.alive ? target : { x: projectile.tx, y: projectile.ty };
  if (target && target.alive) {
    dealDamage(target, projectile.damage, projectile);
    if (projectile.slow && (!ENEMIES[target.type].phase || target.revealedUntil > simTime)) {
      target.slowAmount = Math.max(target.slowAmount, projectile.slow);
      target.slowUntil = Math.max(target.slowUntil, simTime + projectile.slowDur);
    }
    if (projectile.reveal) target.revealedUntil = Math.max(target.revealedUntil, simTime + projectile.reveal * (currentCommander().id === "vesper" ? 1.35 : 1));
    if (projectile.pull && !ENEMIES[target.type].boss) target.t = Math.max(0, target.t - projectile.pull);
  }
  if (projectile.splash > 0) {
    for (let i = 0; i < enemies.length; i++) {
      const enemy = enemies[i];
      if (!enemy.alive || enemy === target || Math.hypot(enemy.x - impact.x, enemy.y - impact.y) > projectile.splash) continue;
      dealDamage(enemy, projectile.damage * .62, projectile);
    }
  }
  projectile.alive = false;
  sfx("impact");
}
function updateProjectiles(dt) {
  let write = 0;
  for (let i = 0; i < projectiles.length; i++) {
    const projectile = projectiles[i];
    if (!projectile.alive) continue;
    projectile.age += dt;
    if (projectile.target && projectile.target.alive) {
      projectile.tx = projectile.target.x;
      projectile.ty = projectile.target.y;
    }
    const dx = projectile.tx - projectile.x;
    const dy = projectile.ty - projectile.y;
    const distance = Math.hypot(dx, dy);
    const step = projectile.speed * dt;
    if (distance <= step || projectile.age > 2.5) {
      projectile.x = projectile.tx;
      projectile.y = projectile.ty;
      applyProjectileImpact(projectile);
    } else {
      projectile.x += dx / distance * step;
      projectile.y += dy / distance * step;
      projectile.traveled += step;
    }
    if (projectile.alive) projectiles[write++] = projectile;
  }
  projectiles.length = write;
}
function killEnemy(enemy) {
  if (!enemy.alive) return;
  enemy.alive = false;
  enemy.death = .36;
  const base = ENEMIES[enemy.type];
  const bountyMultiplier = currentCommander().id === "astra" ? 1.15 : 1;
  gold += Math.round(enemy.bounty * bountyMultiplier);
  score += Math.round(enemy.bounty * 3 + (base.boss ? 300 : 0));
  killCount += 1;
  if (base.split) {
    for (let i = 0; i < 3; i++) spawnEnemy("shard", enemy.hpMul || 1, enemy.routeIndex, (i - 1) * 9, enemy.t - i * .002, enemy.mods);
  }
  if (base.splitInto) {
    for (let i = 0; i < base.splitInto.count; i++) {
      spawnEnemy(base.splitInto.type, (enemy.hpMul || 1) * (base.boss ? .8 : 1), (enemy.routeIndex + i) % currentMap().routes.length, (i % 3 - 1) * 10, Math.max(0, enemy.t - i * .008), enemy.mods);
    }
  }
  if (base.boss) {
    sfx("bossdown");
    cameraShake = .45;
    announceMapEvent(base.name + " destroyed");
    if (effects.length < 200) effects.push({ type: "command", x: enemy.x, y: enemy.y, color: base.color, life: .9, age: 0, size: 150 });
  }
  if (!reducedMotion() && effects.length < 150) {
    for (let i = 0; i < 7; i++) effects.push({
      type: "spark",
      x: enemy.x,
      y: enemy.y,
      vx: (Math.random() - .5) * 115,
      vy: (Math.random() - .65) * 115,
      color: base.color,
      life: .48,
      age: 0,
      size: 3
    });
  }
}
function updateSentinels(dt) {
  sentinels.forEach((sentinel) => {
    sentinel.cooldown -= dt;
    sentinel.recoil = Math.max(0, sentinel.recoil - dt);
    sentinel.jammed = Math.max(0, sentinel.jammed - dt);
    if (sentinel.jammed > 0 || sentinel.cooldown > 0) return;
    const stats = currentStats(sentinel);
    const target = findTarget(sentinel, stats);
    if (!target) return;
    fireSentinel(sentinel, stats, target);
    sentinel.cooldown = 1 / Math.max(.1, stats.rof);
  });
}
function bossPulse(enemy, act) {
  if (act === "aura") {
    let jammedCount = 0;
    sentinels
      .map((sentinel) => ({ sentinel, distance: distanceToSentinel(enemy, sentinel) }))
      .filter((item) => item.distance < 240)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 2)
      .forEach((item) => {
        item.sentinel.jammed = Math.max(item.sentinel.jammed, 3.6);
        jammedCount += 1;
      });
    if (jammedCount) {
      announceMapEvent(ENEMIES[enemy.type].name + " jammed " + jammedCount + " defense" + (jammedCount === 1 ? "" : "s"));
      if (effects.length < 200) effects.push({ type: "jam", x: enemy.x, y: enemy.y, color: "#73e69e", life: .7, age: 0, size: 60 });
    }
  } else if (act === "summon") {
    for (let i = 0; i < 3; i++) {
      spawnEnemy("skiff", (enemy.hpMul || 1) * .55, (enemy.routeIndex + i) % currentMap().routes.length, (i - 1) * 9, Math.max(0, enemy.t - .03 * i), enemy.mods);
    }
    if (effects.length < 200) effects.push({ type: "command", x: enemy.x, y: enemy.y, color: "#6ca8ff", life: .6, age: 0, size: 70 });
  } else if (act === "heal") {
    enemy.hp = Math.min(enemy.maxHp, enemy.hp + enemy.maxHp * .05);
    for (let i = 0; i < enemies.length; i++) {
      const ally = enemies[i];
      if (!ally.alive || ally === enemy || Math.hypot(ally.x - enemy.x, ally.y - enemy.y) > 130) continue;
      ally.hp = Math.min(ally.maxHp, ally.hp + ally.maxHp * .15);
    }
    if (effects.length < 200) effects.push({ type: "command", x: enemy.x, y: enemy.y, color: "#8ce8b4", life: .7, age: 0, size: 130 });
  } else if (act === "burrow") {
    enemy.burrowUntil = simTime + 2.2;
    enemy.invulnUntil = simTime + 2.2;
    if (effects.length < 200) effects.push({ type: "jam", x: enemy.x, y: enemy.y, color: "#c68f56", life: .6, age: 0, size: 44 });
  } else if (act === "shieldPhase") {
    enemy.invulnUntil = simTime + 2.6;
    if (effects.length < 200) effects.push({ type: "command", x: enemy.x, y: enemy.y, color: "#b792ff", life: .7, age: 0, size: 60 });
  }
}
function updateBossMech(enemy, dt) {
  const base = ENEMIES[enemy.type];
  const mech = base.mech;
  if (!mech) return;
  if (mech === "twin") {
    if (!enemy.enraged) {
      let partnerAlive = false;
      for (let i = 0; i < enemies.length; i++) {
        if (enemies[i] !== enemy && enemies[i].alive && enemies[i].type === enemy.type) { partnerAlive = true; break; }
      }
      if (!partnerAlive) {
        enemy.enraged = true;
        announceMapEvent("Twin Fury enraged");
        enemy.hitFlash = .3;
      }
    }
    return;
  }
  if (mech === "regen") {
    if (enemy.shield < enemy.maxShield) enemy.shield = Math.min(enemy.maxShield, enemy.shield + enemy.maxShield * .04 * dt);
    return;
  }
  enemy.mechClock -= dt;
  if (enemy.mechClock > 0) return;
  let act = mech;
  if (mech === "finale") {
    act = ["aura", "summon", "shieldPhase"][enemy.phaseStep % 3];
    enemy.phaseStep += 1;
    enemy.mechClock = 6;
  } else {
    enemy.mechClock = ({ aura: 7, summon: 6.5, heal: 5.5, burrow: 8, shieldPhase: 6.5 })[mech] || 7;
  }
  bossPulse(enemy, act);
}
function updateEnemies(dt) {
  let write = 0;
  for (let i = 0; i < enemies.length; i++) {
    const enemy = enemies[i];
    if (!enemy.alive) {
      enemy.death -= dt;
      if (enemy.death > 0) enemies[write++] = enemy;
      continue;
    }
    enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);
    enemy.attackCooldown -= dt;
    const base = ENEMIES[enemy.type];
    if (base.regen && enemy.hp < enemy.maxHp) enemy.hp = Math.min(enemy.maxHp, enemy.hp + enemy.maxHp * base.regen * dt);
    if (base.mech) updateBossMech(enemy, dt);
    saboteurStrike(enemy);
    if (gateHolding(enemy, dt)) { enemies[write++] = enemy; continue; }
    let speedMultiplier = enemy.slowUntil > simTime ? Math.max(.18, 1 - enemy.slowAmount) : 1;
    if (currentMap().id === "cloudbreak" && base.air && !base.heavy) speedMultiplier *= mapWind > 0 ? 1.2 : .92;
    if (abilityActive > 0 && currentCommander().id === "ilex") speedMultiplier *= .62;
    if (enemy.burrowUntil > simTime) speedMultiplier *= 2.3;
    if (enemy.enraged) speedMultiplier *= 1.6;
    enemy.t += enemy.speed * speedMultiplier * dt;
    enemyPosition(enemy);
    checkRelayCrossing(enemy);
    if (enemy.t >= 1) leakEnemy(enemy);
    if (enemy.alive || enemy.death > 0) enemies[write++] = enemy;
  }
  enemies.length = write;
}

// ---------------------------------------------------------------------------
// Commander abilities, bot pressure, and duel pressure
// ---------------------------------------------------------------------------
function activateCommander() {
  if (!running || paused || abilityCooldown > 0) return;
  const commander = currentCommander();
  abilityCooldown = ABILITY_COOLDOWN;
  abilityActive = 6;
  abilityUses += 1;
  sfx("ability");
  effects.push({ type: "command", x: REF_W * .92, y: REF_H * .47, color: commander.color, life: .8, age: 0, size: 130 });
  if (commander.id === "ilex") {
    enemies.forEach((enemy) => {
      enemy.slowAmount = Math.max(enemy.slowAmount, .48);
      enemy.slowUntil = Math.max(enemy.slowUntil, simTime + 6);
    });
    if (currentMap().objective === "relay") mapObjective.relay = Math.min(18, mapObjective.relay + 3);
    if (currentMap().objective === "shield") mapObjective.shield = Math.min(mapObjective.maxShield, mapObjective.shield + 4);
    if (currentMap().objective === "gates") mapObjective.gates.forEach((gate) => { gate.hp = Math.min(gate.max, gate.hp + 55); });
  } else if (commander.id === "rook") {
    const targets = enemies.filter((enemy) => enemy.alive).sort((a, b) => b.t - a.t).slice(0, 6);
    targets.forEach((target, index) => {
      effects.push({ type: "broadside", x: target.x, y: target.y, target, color: commander.color, life: .9 + index * .06, age: 0, struck: false, size: 62 });
    });
  } else if (commander.id === "vesper") {
    enemies.forEach((enemy) => {
      if (!ENEMIES[enemy.type].boss) enemy.t = Math.max(0, enemy.t - .12);
      enemyPosition(enemy);
    });
  }
  toast(commander.ability + " active.");
  updateHud();
}
function updateAbilityEffects(dt) {
  abilityCooldown = Math.max(0, abilityCooldown - dt);
  abilityActive = Math.max(0, abilityActive - dt);
  effects.filter((effect) => effect.type === "broadside" && !effect.struck && effect.age >= effect.life * .58).forEach((effect) => {
    effect.struck = true;
    if (effect.target && effect.target.alive) dealDamage(effect.target, 84, { pierce: 6, splash: 62, color: effect.color });
    enemies.forEach((enemy) => {
      if (enemy.alive && enemy !== effect.target && Math.hypot(enemy.x - effect.x, enemy.y - effect.y) < 62) dealDamage(enemy, 40, { pierce: 3, color: effect.color });
    });
    cameraShake = .32;
  });
}
function applyPressureToPlayer(kind, fromBot) {
  if (!PRESSURE_TYPES.has(kind)) return;
  if (kind === "swarm") {
    for (let i = 0; i < 7; i++) spawnEnemy(i % 2 ? "skiff" : "shard", 1 + wave * .025, i % currentMap().routes.length, (i % 3 - 1) * 8, .01);
  } else if (kind === "armor") {
    spawnEnemy("bulwark", 1.25 + wave * .03, wave % currentMap().routes.length, 0, .02);
    spawnEnemy("phase", 1.05 + wave * .02, (wave + 1) % currentMap().routes.length, 0, .01);
  } else if (kind === "blackout") {
    sentinels.slice().sort(() => Math.random() - .5).slice(0, 2).forEach((sentinel) => { sentinel.jammed = Math.max(sentinel.jammed, 4.5); });
  }
  sfx("pressure");
  toast((fromBot ? "Marshal AI" : "Rival command") + " launched " + pressureName(kind) + ".");
}
function applyPressureToBot(kind) {
  if (!bot || !bot.alive || !PRESSURE_TYPES.has(kind)) return;
  if (kind === "blackout") bot.jamStacks += 1;
  else {
    const roleCounter = kind === "swarm" ? bot.loadout.includes("arc") : bot.loadout.includes("vane") && bot.loadout.includes("null");
    const loss = roleCounter ? 1 : kind === "armor" ? 4 : 3;
    bot.lives = Math.max(0, bot.lives - loss);
    if (bot.lives <= 0) { bot.alive = false; bot.result = "defeated"; }
  }
}
function pressureName(kind) {
  return ({ swarm: "Swarm Wing", armor: "Armored Spear", blackout: "Blackout Hack" })[kind] || "Pressure";
}
function updateBot(dt) {
  if (mode !== "skirmish" || !bot || !bot.alive || !running) return;
  bot.pressureClock -= dt;
  if (bot.pressureClock > 0) return;
  const hasSplash = selectedDefenses.some((id) => DEFENSES[id].role === "Splash");
  const hasArmorCounter = selectedDefenses.some((id) => ["Anti-armor", "Shield break"].includes(DEFENSES[id].role));
  const vulnerable = sentinels.filter((sentinel) => sentinel.jammed <= 0).length < 4;
  let kind = vulnerable ? "blackout" : !hasSplash ? "swarm" : !hasArmorCounter ? "armor" : (Math.random() < .5 ? "swarm" : "blackout");
  applyPressureToPlayer(kind, true);
  bot.pressureClock = clamp(8.5 - wave * .22 + Math.random() * 3, 5, 10);
}
function onPressureClick(kind) {
  if (kind === "surrender") { surrender(); return; }
  const costs = { swarm: 45, armor: 65, blackout: 75 };
  const cost = costs[kind];
  if (!PRESSURE_TYPES.has(kind) || gold < cost || pressureCooldown > 0) return;
  gold -= cost;
  glintSpent += cost;
  pressureCooldown = 6;
  sfx("pressure");
  if (mode === "skirmish") {
    applyPressureToBot(kind);
    toast(pressureName(kind) + " sent to Marshal AI.");
  } else if (mode === "battle") {
    const previous = battle.duel && Array.isArray(battle.duel.pressureLog) ? battle.duel.pressureLog : [];
    const entry = { seq: previous.length ? Number(previous[previous.length - 1].seq) + 1 : 1, type: kind, from: battle.amIHost ? "host" : "guest", at: Date.now() };
    if (battle.amIHost) {
      pushDuelState({ pressureLog: previous.concat(entry).slice(-24) });
      toast(pressureName(kind) + " relayed.");
    } else {
      matchAction({ duel: { ...(battle.duel || {}), pressureLog: previous.concat(entry).slice(-24) } }, "merge");
      toast("Pressure staged through the room relay.");
    }
  }
  updateHud();
}

// ---------------------------------------------------------------------------
// Main simulation
// ---------------------------------------------------------------------------
function updateEffects(dt) {
  let write = 0;
  for (let i = 0; i < effects.length; i++) {
    const effect = effects[i];
    effect.age += dt;
    if (effect.type === "spark") {
      effect.x += effect.vx * dt;
      effect.y += effect.vy * dt;
      effect.vy += 170 * dt;
    }
    if (effect.age < effect.life) effects[write++] = effect;
  }
  effects.length = write;
  write = 0;
  for (let i = 0; i < floaters.length; i++) {
    const floater = floaters[i];
    floater.age += dt;
    floater.y -= 24 * dt;
    if (floater.age < floater.life) floaters[write++] = floater;
  }
  floaters.length = write;
  spireFlash = Math.max(0, spireFlash - dt);
  cameraShake = Math.max(0, cameraShake - dt);
}
function tick(dt) {
  simTime += dt;
  pressureCooldown = Math.max(0, pressureCooldown - dt);
  updateAbilityEffects(dt);
  updateEffects(dt);
  updateMapHazards(dt);
  updateBot(dt);

  if (prepRemaining > 0) {
    prepRemaining -= dt;
    waveBanner.textContent = "Next formation in " + Math.max(1, Math.ceil(prepRemaining)) + "s";
    if (prepRemaining <= 0) {
      prepRemaining = 0;
      scheduleWave(wave + 1);
    }
    updateHud();
    return;
  }
  if (!waveActive) {
    updateHud();
    return;
  }
  waveClockMs += dt * 1000;
  while (spawnQueue.length && spawnQueue[0].time <= waveClockMs) {
    const item = spawnQueue.shift();
    spawnEnemy(item.type, item.hpMultiplier, item.route, item.lateral, 0, item.mods);
  }
  updateEnemies(dt);
  updateSentinels(dt);
  updateProjectiles(dt);
  updateHud();
  if (waveActive && spawnQueue.length === 0 && !enemies.some((enemy) => enemy.alive)) {
    waveActive = false;
    handleWaveCleared();
  }
  if (mode === "battle") {
    maybeBroadcastHostStatus(false);
    applyDuelUpdate();
  }
  if (running && Math.floor(simTime / 4) !== Math.floor((simTime - dt) / 4)) reportProgress();
}

// ---------------------------------------------------------------------------
// Placement, upgrades, and controls
// ---------------------------------------------------------------------------
function renderDock() {
  dockDefenses.innerHTML = selectedDefenses.map((id, index) => {
    const def = DEFENSES[id];
    const affordable = gold >= def.cost;
    return '<button type="button" class="sg-def-card ' + (placingDefense === id ? "is-selected" : "") + '" data-dock-defense="' + id + '" style="--def-color:' + def.color + '" ' + (!affordable ? "disabled" : "") + ' aria-label="' + esc(def.name + ", " + def.cost + " Glint") + '">' +
      '<i class="sg-def-icon"></i><b>' + (index + 1) + " " + esc(def.name) + "</b><span>" + def.cost + " GLINT</span></button>";
  }).join("");
  dockDefenses.querySelectorAll("[data-dock-defense]").forEach((button) => button.addEventListener("click", () => {
    placingDefense = placingDefense === button.dataset.dockDefense ? null : button.dataset.dockDefense;
    renderDock();
  }));
}
function renderSelected() {
  const sentinel = sentinels.find((item) => item.slotIndex === selectedSlot);
  if (!sentinel) { dockSelected.hidden = true; return; }
  const def = DEFENSES[sentinel.defId];
  const maxTier = def.tiers.length - 1;
  const nextCost = sentinel.tier < maxTier ? def.upgradeCosts[sentinel.tier] : 0;
  dockSelected.hidden = false;
  dockSelected.innerHTML = "<b>" + esc(def.name) + " T" + (sentinel.tier + 1) + "/" + def.tiers.length + "</b>" +
    (sentinel.jammed > 0 ? "<span>JAMMED " + sentinel.jammed.toFixed(1) + "s</span>" : "") +
    (sentinel.tier < maxTier ? '<button type="button" data-upgrade ' + (gold < nextCost ? "disabled" : "") + ">Upgrade " + nextCost + "</button>" : "<span>Max tier</span>") +
    '<button type="button" data-sell>Sell +' + Math.round(sentinel.spent * .6) + '</button><button type="button" data-close-selection>Close</button>';
  dockSelected.querySelector("[data-upgrade]")?.addEventListener("click", upgradeSelected);
  dockSelected.querySelector("[data-sell]").addEventListener("click", sellSelected);
  dockSelected.querySelector("[data-close-selection]").addEventListener("click", () => selectSlot(-1));
}
function renderPressureDock() {
  const visible = running && (mode === "skirmish" || mode === "battle");
  pressureDock.hidden = !visible;
  if (!visible) return;
  pressureDock.innerHTML = [
    ["swarm", 45], ["armor", 65], ["blackout", 75]
  ].map((item) => '<button type="button" class="sg-pressure-btn" data-pressure="' + item[0] + '" ' + (gold < item[1] || pressureCooldown > 0 ? "disabled" : "") + ">" + esc(pressureName(item[0])) + " " + item[1] + "</button>").join("") +
    '<button type="button" class="sg-pressure-btn" data-pressure="surrender">Surrender</button>';
  pressureDock.querySelectorAll("[data-pressure]").forEach((button) => button.addEventListener("click", () => onPressureClick(button.dataset.pressure)));
}
function tryPlace(slotIndex) {
  if (!placingDefense || sentinels.some((sentinel) => sentinel.slotIndex === slotIndex)) return;
  const def = DEFENSES[placingDefense];
  if (!def || !selectedDefenses.includes(def.id)) return;
  if (gold < def.cost) { toast("Not enough Glint."); return; }
  gold -= def.cost;
  glintSpent += def.cost;
  sentinels.push({ id: uid(), defId: def.id, tier: 0, slotIndex, cooldown: 0, recoil: 0, jammed: 0, aim: 0, spent: def.cost });
  placingDefense = null;
  sfx("place");
  updateHud();
  renderDock();
  selectSlot(slotIndex);
}
function selectSlot(slotIndex) {
  selectedSlot = slotIndex;
  focusedSlot = slotIndex >= 0 ? slotIndex : focusedSlot;
  renderSelected();
}
function upgradeSelected() {
  const sentinel = sentinels.find((item) => item.slotIndex === selectedSlot);
  if (!sentinel) return;
  const def = DEFENSES[sentinel.defId];
  if (sentinel.tier >= def.tiers.length - 1) return;
  const cost = def.upgradeCosts[sentinel.tier];
  if (gold < cost) return;
  gold -= cost;
  glintSpent += cost;
  sentinel.spent += cost;
  sentinel.tier += 1;
  sfx("upgrade");
  updateHud();
  renderSelected();
}
function sellSelected() {
  const index = sentinels.findIndex((item) => item.slotIndex === selectedSlot);
  if (index < 0) return;
  gold += Math.round(sentinels[index].spent * .6);
  sentinels.splice(index, 1);
  selectSlot(-1);
  renderDock();
  updateHud();
}
function refFromPointer(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left - offsetX) / worldScale,
    y: (event.clientY - rect.top - offsetY) / worldScale
  };
}
canvas.addEventListener("pointerdown", (event) => {
  if (!running || paused) return;
  event.preventDefault();
  const point = refFromPointer(event);
  let hit = -1;
  let best = 34;
  currentMap().slots.forEach((slot, index) => {
    const distance = Math.hypot(point.x - slot[0] * REF_W, point.y - slot[1] * REF_H);
    if (distance < best) { best = distance; hit = index; }
  });
  if (hit < 0) { selectSlot(-1); return; }
  const occupied = sentinels.find((sentinel) => sentinel.slotIndex === hit);
  if (occupied) selectSlot(hit);
  else if (placingDefense) tryPlace(hit);
  else { focusedSlot = hit; selectSlot(-1); }
});
abilityBtn.addEventListener("click", activateCommander);
addEventListener("keydown", (event) => {
  if (currentScreen !== "game" || !running || paused) return;
  if (/^[1-4]$/.test(event.key)) {
    placingDefense = selectedDefenses[Number(event.key) - 1];
    renderDock();
    toast(DEFENSES[placingDefense].name + " selected.");
    event.preventDefault();
  } else if (event.key.toLowerCase() === "q" || event.key === " ") {
    activateCommander();
    event.preventDefault();
  } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
    focusedSlot = (focusedSlot + 1) % currentMap().slots.length;
    selectSlot(sentinels.some((sentinel) => sentinel.slotIndex === focusedSlot) ? focusedSlot : -1);
    event.preventDefault();
  } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
    focusedSlot = (focusedSlot - 1 + currentMap().slots.length) % currentMap().slots.length;
    selectSlot(sentinels.some((sentinel) => sentinel.slotIndex === focusedSlot) ? focusedSlot : -1);
    event.preventDefault();
  } else if (event.key === "Enter" && placingDefense) {
    tryPlace(focusedSlot);
    event.preventDefault();
  } else if (event.key === "Escape") {
    placingDefense = null;
    selectSlot(-1);
    renderDock();
  }
});

// ---------------------------------------------------------------------------
// HUD, opponent, and run lifecycle
// ---------------------------------------------------------------------------
function objectiveText() {
  if (!mapObjective) return currentMap().objectiveLabel;
  if (currentMap().objective === "relay") return "Relay integrity " + Math.max(0, mapObjective.relay).toFixed(1);
  if (currentMap().objective === "shield") return "Core shield " + Math.ceil(mapObjective.shield) + " / " + mapObjective.maxShield;
  const gates = mapObjective.gates.filter((gate) => gate.hp > 0).length;
  return gates ? gates + " gate line" + (gates === 1 ? "" : "s") + " holding" : "Gate line breached";
}
function updateHud() {
  hud.gold.textContent = String(Math.floor(gold));
  hud.wave.textContent = Math.min(wave, totalWaves) + "/" + totalWaves;
  hud.lives.textContent = String(lives);
  hud.score.textContent = String(score);
  hud.objective.textContent = objectiveText();
  hud.livesChip.classList.toggle("is-low", lives <= 5);
  const commander = currentCommander();
  $("[data-ability-sigil]").textContent = commander.sigil;
  $("[data-ability-name]").textContent = commander.ability;
  $("[data-ability-copy]").textContent = abilityCooldown > 0 ? "Ready in " + Math.ceil(abilityCooldown) + "s" : commander.abilityCopy;
  abilityBtn.disabled = !running || abilityCooldown > 0;
  abilityFill.style.width = Math.round((1 - abilityCooldown / ABILITY_COOLDOWN) * 100) + "%";
  renderPressureDock();
  if (gold !== lastDockGold) {
    lastDockGold = gold;
    renderDock();
    if (selectedSlot >= 0) renderSelected();
  }
  renderOpponent();
}
function renderOpponent() {
  if (mode === "skirmish") {
    opponent.name.textContent = bot ? bot.label : "Marshal AI";
    opponent.lives.textContent = bot ? bot.lives + "/" + bot.maxLives : "-";
    opponent.wave.textContent = bot ? bot.wave + "/" + totalWaves : "-";
    opponent.status.textContent = bot ? (bot.alive ? "Counter-building" : "Route fallen") : "-";
    opponent.bar.style.width = bot ? Math.round(bot.lives / bot.maxLives * 100) + "%" : "0%";
    opponent.note.textContent = "The AI drafts counters and sends pressure when your wing exposes a weakness.";
    return;
  }
  if (mode !== "battle") return;
  if (!battle.roleKnown) {
    opponent.status.textContent = "Detecting role";
    return;
  }
  if (battle.amIHost) {
    const rival = battle.participants.find((participant) => participant.role !== "host");
    opponent.name.textContent = rival ? rival.label : "Challenger";
    opponent.lives.textContent = "-";
    opponent.wave.textContent = "-";
    opponent.status.textContent = "Guest relay limited";
    opponent.bar.style.width = "0%";
    opponent.note.textContent = "Room state remains host-authoritative; guest status is not relayed back by the current platform transport.";
  } else {
    const hostStatus = battle.duel && battle.duel.hostStatus;
    const hostParticipant = battle.participants.find((participant) => participant.role === "host");
    opponent.name.textContent = hostParticipant ? hostParticipant.label : "Room host";
    if (hostStatus) {
      opponent.lives.textContent = hostStatus.lives + "/" + hostStatus.maxLives;
      opponent.wave.textContent = hostStatus.wave + "/" + hostStatus.totalWaves;
      opponent.status.textContent = hostStatus.alive === false ? "Route fallen" : "Holding";
      opponent.bar.style.width = Math.round(hostStatus.lives / Math.max(1, hostStatus.maxLives) * 100) + "%";
    } else opponent.status.textContent = "Syncing";
    opponent.note.textContent = "Live host status from the private room relay.";
  }
}
function reportProgress() {
  if (!running) return;
  const progress = Math.min(99, Math.round(Math.max(0, wave - 1) / totalWaves * 100));
  host("score", { score, progress, wave, state: metaPayload() });
}
function finishRun(kind, options) {
  if (runCompleted) return;
  runCompleted = true;
  running = false;
  resultKind = kind;
  const won = kind === "victory";
  const reachedWave = won ? Math.min(wave, totalWaves) : Math.max(0, wave - 1);
  if (mode === "campaign") meta.bestWaveCampaign = Math.max(meta.bestWaveCampaign, reachedWave);
  if (mode === "endless") meta.bestWaveEndless = Math.max(meta.bestWaveEndless, reachedWave);
  if (mode === "battle") {
    if (won) meta.winsBattle += 1; else meta.lossesBattle += 1;
    if (battle.amIHost) maybeBroadcastHostStatus(true);
  }
  const reward = grantRewards(reachedWave, won);
  sfx(won ? "victory" : "defeat");
  waveBanner.hidden = true;
  bossBanner.hidden = true;
  showResults(kind, reward, !!(options && options.surrendered));
  host("complete", { score, progress: 100, wave: reachedWave, state: metaPayload() });
}
function surrender() {
  if (!running || runCompleted) return;
  lives = 0;
  if (mode === "battle" && battle.amIHost) {
    pushDuelState({ hostStatus: { label: "Host", lives: 0, maxLives, wave, totalWaves, gold, alive: false, result: "surrendered", updatedAt: Date.now() } });
  }
  finishRun("defeat", { surrendered: true });
}
function showResults(kind, reward, surrendered) {
  const won = kind === "victory";
  $("[data-results-title]").textContent = won ? (mode === "battle" ? "Room war won" : mode === "endless" ? "Century secured" : "Skyline secured") : (surrendered ? "Command withdrawn" : "Defense line broken");
  $("[data-results-sub]").textContent = modeLabel(mode) + " on " + currentMap().name + " ended at " + (mode === "endless" ? "round" : "wave") + " " + Math.min(wave, totalWaves) + ".";
  const verdict = $("[data-verdict]");
  verdict.classList.toggle("is-loss", !won);
  $("[data-verdict-word]").textContent = won ? "VICTORY" : "DEFEAT";
  $("[data-verdict-copy]").textContent = won ?
    (mode === "endless" ? currentCommander().name + " survived all 100 rounds of the Century Watch and broke The Sovereign." : currentCommander().name + " held the route with a four-defense wing.") :
    "The raid reached the Anchor Spire. Rebuild around the counters that broke through.";
  const stats = [
    [won ? Math.min(wave, totalWaves) : Math.max(0, wave - 1), mode === "endless" ? "Rounds survived" : "Waves survived"],
    [killCount, "Raiders defeated"],
    [damageDealt, "Damage dealt"],
    [glintSpent, "Glint committed"],
    [leakCount, "Raiders leaked"],
    [abilityUses, "Commander abilities"],
    [score, "Battle score"],
    ["+" + reward.xpGain, "Command XP"],
    [meta.rank + (reward.rankedUp ? " UP" : ""), "Command rank"],
    ["+" + reward.shardsGain, "Core Shards earned"]
  ];
  $("[data-results-grid]").innerHTML = stats.map((item) => '<div><b>' + esc(item[0]) + "</b><span>" + esc(item[1]) + "</span></div>").join("");
  $("[data-results-rematch]").hidden = mode !== "battle";
  showScreen("results");
}
function returnToMenu() {
  running = false;
  paused = false;
  overlayPause.hidden = true;
  showScreen("title");
  renderMenuMeta();
}

// ---------------------------------------------------------------------------
// Private room contract
// ---------------------------------------------------------------------------
const battle = {
  active: false,
  roleKnown: false,
  amIHost: false,
  probeId: "",
  probeSentAt: 0,
  participants: [],
  readyStates: {},
  hostControls: null,
  botSlots: [],
  duel: null,
  lastPressureSeq: 0,
  lastBroadcast: 0,
  consumedStartedAt: null
};
function tryResolveRole(matchState) {
  if (battle.roleKnown) return;
  const state = matchState && typeof matchState === "object" ? matchState : {};
  if (!battle.probeId) {
    battle.probeId = "sg-" + Math.random().toString(36).slice(2, 10);
    battle.probeSentAt = Date.now();
    matchAction({ duelHello: { from: battle.probeId, ts: Date.now() } }, "merge");
    return;
  }
  if (state.duelHello && state.duelHello.from === battle.probeId) {
    battle.amIHost = true;
    battle.roleKnown = true;
  } else if (state.duelHello && state.duelHello.from) {
    battle.amIHost = false;
    battle.roleKnown = true;
  } else if (Date.now() - battle.probeSentAt > 8000) {
    battle.amIHost = false;
    battle.roleKnown = true;
  }
}
function pushDuelState(patch) {
  battle.duel = { ...(battle.duel || {}), ...patch };
  matchAction({ duel: battle.duel }, "merge");
}
function maybeBroadcastHostStatus(force) {
  if (mode !== "battle" || !battle.roleKnown || !battle.amIHost) return;
  const now = Date.now();
  if (!force && now - battle.lastBroadcast < 1800) return;
  battle.lastBroadcast = now;
  pushDuelState({
    hostStatus: {
      label: "Host",
      lives,
      maxLives,
      wave,
      totalWaves,
      gold,
      alive: running && lives > 0,
      result: resultKind,
      updatedAt: now
    }
  });
}
function applyDuelUpdate() {
  if (mode !== "battle") return;
  const log = battle.duel && Array.isArray(battle.duel.pressureLog) ? battle.duel.pressureLog.slice(-24) : [];
  log.forEach((entry) => {
    const seq = clampInt(entry && entry.seq, 0, 1000000, 0);
    if (seq <= battle.lastPressureSeq || !entry || !PRESSURE_TYPES.has(entry.type)) return;
    battle.lastPressureSeq = seq;
    if (entry.from === "host" && !battle.amIHost) applyPressureToPlayer(entry.type, false);
  });
}
function roomHumans() {
  return battle.participants.filter((participant) => participant && participant.status !== "left").slice(0, 3);
}
function roomCanStart() {
  const humans = roomHumans();
  const botFill = humans.length === 1 && battle.hostControls && battle.hostControls.allowBotFill && battle.botSlots.length > 0;
  return humans.length === 2 ? humans.every((participant) => battle.readyStates[participant.actorId] === true) : botFill;
}
function renderRoomLoadout() {
  const active = pendingMode === "battle" && battle.active;
  roomReadyEl.hidden = !active;
  if (!active) {
    $("[data-loadout-start]").disabled = false;
    $("[data-loadout-start]").textContent = "Launch defense";
    return;
  }
  const humans = roomHumans();
  const canStart = roomCanStart();
  $("[data-room-roster]").innerHTML = humans.map((participant) =>
    "<li><span>" + esc(participant.label || "Defender") + (participant.role === "host" ? " / Host" : "") + "</span><b>" + (battle.readyStates[participant.actorId] ? "Ready" : "Not ready") + "</b></li>"
  ).join("") || "<li><span>No defenders present</span><b>Waiting</b></li>";
  $("[data-room-title]").textContent = canStart ? "Defense wings locked" : "Waiting for both defenders";
  $("[data-room-note]").textContent = !battle.roleKnown ? "Detecting your room role." :
    canStart ? (battle.amIHost ? "You can launch the private war." : "Your wing is ready. The room host launches.") :
    "Ready up in the PhantomPlay room panel outside the game.";
  const start = $("[data-loadout-start]");
  start.textContent = battle.amIHost ? "Start room war" : "Waiting for room host";
  start.disabled = !canStart || !battle.amIHost;
}
function startRoomBattle() {
  if (!battle.amIHost || !roomCanStart()) return;
  battle.duel = {
    startedAt: Date.now(),
    endedAt: null,
    mapId: selectedMapId,
    hostLoadout: selectedDefenses.slice(),
    hostCommander: selectedCommanderId,
    pressureLog: [],
    hostStatus: null
  };
  matchAction({ duel: battle.duel }, "merge");
  beginBattleRun();
}
function beginBattleRun() {
  if (!battle.duel) return;
  battle.lastPressureSeq = 0;
  battle.consumedStartedAt = battle.duel.startedAt;
  selectedMapId = MAP_BY_ID[battle.duel.mapId] ? battle.duel.mapId : selectedMapId;
  if (battle.amIHost) {
    selectedDefenses = safeDefenseLoadout(battle.duel.hostLoadout, selectedDefenses);
    selectedCommanderId = COMMANDERS[battle.duel.hostCommander] ? battle.duel.hostCommander : selectedCommanderId;
  }
  applyCommanderTheme();
  startRun("battle");
}
function consumeRoomState(data) {
  battle.active = true;
  battle.participants = Array.isArray(data.participants) ? data.participants.slice(0, 8) : [];
  battle.readyStates = data.readyStates && typeof data.readyStates === "object" ? data.readyStates : {};
  battle.hostControls = data.hostControls || null;
  battle.botSlots = Array.isArray(data.botSlots) ? data.botSlots.slice(0, 4) : [];
  const matchState = data.matchState && typeof data.matchState === "object" ? data.matchState : {};
  tryResolveRole(matchState);
  if (matchState.duel && typeof matchState.duel === "object") battle.duel = matchState.duel;
  roomModeBtn.hidden = false;
  $("[data-room-mode-copy]").textContent = battle.roleKnown ? (battle.amIHost ? "You host this room. Prepare the launch." : "You joined this room. Prepare your wing.") : "Room link acquired. Detecting your role.";
  if (currentScreen === "loadout") renderRoomLoadout();
  if (currentScreen === "game") { applyDuelUpdate(); renderOpponent(); }
  if (battle.duel && battle.duel.startedAt && battle.duel.startedAt !== battle.consumedStartedAt && (currentScreen === "loadout" || currentScreen === "title")) beginBattleRun();
}

// ---------------------------------------------------------------------------
// Pseudo-3D Canvas rendering
// ---------------------------------------------------------------------------
let cssWidth = REF_W;
let cssHeight = REF_H;
let worldScale = 1;
let offsetX = 0;
let offsetY = 0;
function resizeCanvas() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  cssWidth = canvas.clientWidth || REF_W;
  cssHeight = canvas.clientHeight || REF_H;
  canvas.width = Math.max(1, Math.round(cssWidth * dpr));
  canvas.height = Math.max(1, Math.round(cssHeight * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  worldScale = Math.min(cssWidth / REF_W, cssHeight / REF_H) || 1;
  offsetX = (cssWidth - REF_W * worldScale) / 2;
  offsetY = (cssHeight - REF_H * worldScale) / 2;
  draw();
}
function toScreen(x, y) { return { x: offsetX + x * worldScale, y: offsetY + y * worldScale }; }
function traceRoute(route) {
  ctx.beginPath();
  route.points.forEach((point, index) => {
    const screen = toScreen(point[0] * REF_W, point[1] * REF_H);
    if (index === 0) ctx.moveTo(screen.x, screen.y); else ctx.lineTo(screen.x, screen.y);
  });
}
function drawIsland(x, y, rx, ry, topColor, sideColor) {
  const screen = toScreen(x, y);
  ctx.fillStyle = "#00000066";
  ctx.beginPath();
  ctx.ellipse(screen.x + 7 * worldScale, screen.y + 17 * worldScale, rx * worldScale, ry * worldScale, 0, 0, Math.PI * 2);
  ctx.fill();
  const side = ctx.createLinearGradient(screen.x, screen.y, screen.x, screen.y + ry * worldScale);
  side.addColorStop(0, sideColor);
  side.addColorStop(1, "#080a08");
  ctx.fillStyle = side;
  ctx.beginPath();
  ctx.ellipse(screen.x, screen.y + 10 * worldScale, rx * worldScale, ry * worldScale, 0, 0, Math.PI * 2);
  ctx.fill();
  const top = ctx.createRadialGradient(screen.x - rx * .25 * worldScale, screen.y - ry * .3 * worldScale, 0, screen.x, screen.y, rx * worldScale);
  top.addColorStop(0, shade(topColor, .22));
  top.addColorStop(1, topColor);
  ctx.fillStyle = top;
  ctx.beginPath();
  ctx.ellipse(screen.x, screen.y, rx * worldScale, ry * worldScale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#ffffff18";
  ctx.lineWidth = 1 * worldScale;
  ctx.stroke();
}
function drawBackground() {
  const map = currentMap();
  const background = ctx.createLinearGradient(0, 0, 0, cssHeight);
  if (map.id === "cloudbreak") {
    background.addColorStop(0, "#122521");
    background.addColorStop(.55, "#29443b");
    background.addColorStop(1, "#171913");
  } else if (map.id === "stormring") {
    background.addColorStop(0, "#201a2d");
    background.addColorStop(.55, "#26333a");
    background.addColorStop(1, "#141218");
  } else {
    background.addColorStop(0, "#27241a");
    background.addColorStop(.55, "#3d3022");
    background.addColorStop(1, "#181713");
  }
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, cssWidth, cssHeight);
  const vignette = ctx.createRadialGradient(cssWidth * .5, cssHeight * .48, 30, cssWidth * .5, cssHeight * .48, Math.max(cssWidth, cssHeight) * .72);
  vignette.addColorStop(0, "#ffffff08");
  vignette.addColorStop(1, "#0000009c");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, cssWidth, cssHeight);
  if (map.id === "cloudbreak") {
    drawIsland(260, 168, 145, 60, "#49694a", "#1d3428");
    drawIsland(508, 438, 185, 72, "#526846", "#263627");
    drawIsland(770, 178, 150, 60, "#4d6849", "#24372b");
  } else if (map.id === "stormring") {
    drawIsland(315, 185, 165, 62, "#4b465b", "#251f33");
    drawIsland(670, 408, 205, 74, "#454c55", "#242834");
    const center = toScreen(500, 300);
    const core = ctx.createRadialGradient(center.x, center.y, 5, center.x, center.y, 120 * worldScale);
    core.addColorStop(0, "#b792ff70");
    core.addColorStop(.35, "#65d8cf24");
    core.addColorStop(1, "#00000000");
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(center.x, center.y, 120 * worldScale, 0, Math.PI * 2);
    ctx.fill();
  } else {
    drawIsland(275, 180, 210, 68, "#706047", "#382d22");
    drawIsland(730, 420, 220, 72, "#65563e", "#32291e");
    drawIsland(510, 300, 200, 74, "#5f5844", "#2c2b23");
  }
}
function drawRoutes() {
  currentMap().routes.forEach((route, index) => {
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = "#00000088";
    ctx.lineWidth = (27 - index * 2) * worldScale;
    ctx.translate(0, 8 * worldScale);
    traceRoute(route);
    ctx.stroke();
    ctx.translate(0, -8 * worldScale);
    const routeGradient = ctx.createLinearGradient(0, offsetY, 0, offsetY + REF_H * worldScale);
    routeGradient.addColorStop(0, index === 0 ? "#8c7857" : "#6f6855");
    routeGradient.addColorStop(1, index === 2 ? "#4f5848" : "#514738");
    ctx.strokeStyle = routeGradient;
    ctx.lineWidth = (18 - index) * worldScale;
    traceRoute(route);
    ctx.stroke();
    ctx.strokeStyle = index === 1 ? "#ffc8573b" : "#d8eee524";
    ctx.lineWidth = 2 * worldScale;
    ctx.setLineDash([11 * worldScale, 12 * worldScale]);
    traceRoute(route);
    ctx.stroke();
    ctx.restore();
  });
}
function drawObjectives() {
  if (!mapObjective) return;
  if (currentMap().objective === "relay") {
    [.36, .68].forEach((t) => {
      const point = pointAt(currentMap().routes[1], t);
      const screen = toScreen(point.x, point.y);
      ctx.fillStyle = "#0008";
      ctx.beginPath();
      ctx.ellipse(screen.x, screen.y + 13 * worldScale, 22 * worldScale, 9 * worldScale, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = mapObjective.relay > 4 ? "#65d8cf" : "#ff7165";
      ctx.beginPath();
      ctx.moveTo(screen.x, screen.y - 24 * worldScale);
      ctx.lineTo(screen.x + 12 * worldScale, screen.y);
      ctx.lineTo(screen.x, screen.y + 12 * worldScale);
      ctx.lineTo(screen.x - 12 * worldScale, screen.y);
      ctx.closePath();
      ctx.fill();
    });
  } else if (currentMap().objective === "shield") {
    const screen = toScreen(965, 282);
    ctx.strokeStyle = "#65d8cf99";
    ctx.lineWidth = 3 * worldScale;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, (24 + mapObjective.shield * 1.2) * worldScale, Math.PI * .55, Math.PI * 1.45);
    ctx.stroke();
  } else {
    mapObjective.gates.forEach((gate) => {
      const point = pointAt(currentMap().routes[1], gate.t);
      const screen = toScreen(point.x, point.y);
      const ratio = gate.hp / gate.max;
      ctx.fillStyle = "#0008";
      ctx.fillRect(screen.x - 25 * worldScale, screen.y + 7 * worldScale, 54 * worldScale, 12 * worldScale);
      ctx.fillStyle = ratio > 0 ? "#8d7651" : "#3a2a22";
      ctx.fillRect(screen.x - 27 * worldScale, screen.y - 20 * worldScale, 54 * worldScale * ratio, 29 * worldScale);
      ctx.strokeStyle = ratio > .35 ? "#ffc857" : "#ff7165";
      ctx.lineWidth = 2 * worldScale;
      ctx.strokeRect(screen.x - 27 * worldScale, screen.y - 20 * worldScale, 54 * worldScale, 29 * worldScale);
    });
  }
}
function drawSpire() {
  const point = pointAt(currentMap().routes[1], .985);
  const screen = toScreen(point.x, point.y);
  const commander = currentCommander();
  ctx.save();
  ctx.fillStyle = "#00000080";
  ctx.beginPath();
  ctx.ellipse(screen.x, screen.y + 23 * worldScale, 35 * worldScale, 13 * worldScale, 0, 0, Math.PI * 2);
  ctx.fill();
  const tower = ctx.createLinearGradient(screen.x - 22 * worldScale, screen.y, screen.x + 24 * worldScale, screen.y);
  tower.addColorStop(0, shade(commander.color, -.58));
  tower.addColorStop(.45, shade(commander.color, -.16));
  tower.addColorStop(1, commander.color);
  ctx.fillStyle = tower;
  ctx.beginPath();
  ctx.moveTo(screen.x - 23 * worldScale, screen.y + 19 * worldScale);
  ctx.lineTo(screen.x - 15 * worldScale, screen.y - 27 * worldScale);
  ctx.lineTo(screen.x, screen.y - 51 * worldScale);
  ctx.lineTo(screen.x + 17 * worldScale, screen.y - 24 * worldScale);
  ctx.lineTo(screen.x + 24 * worldScale, screen.y + 17 * worldScale);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = commander.color;
  ctx.lineWidth = 2 * worldScale;
  ctx.stroke();
  ctx.fillStyle = commander.color;
  ctx.font = "950 " + 14 * worldScale + "px ui-monospace,monospace";
  ctx.textAlign = "center";
  ctx.fillText(commander.sigil, screen.x, screen.y - 12 * worldScale);
  ctx.restore();
}
function drawSlots() {
  currentMap().slots.forEach((slot, index) => {
    const screen = toScreen(slot[0] * REF_W, slot[1] * REF_H);
    const occupied = sentinels.some((sentinel) => sentinel.slotIndex === index);
    const selected = index === selectedSlot || index === focusedSlot;
    ctx.fillStyle = "#00000055";
    ctx.beginPath();
    ctx.ellipse(screen.x, screen.y + 5 * worldScale, 15 * worldScale, 7 * worldScale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = selected ? currentCommander().color : placingDefense && !occupied ? "#65d8cf" : "#ffffff35";
    ctx.lineWidth = (selected ? 2.4 : 1.3) * worldScale;
    ctx.beginPath();
    ctx.ellipse(screen.x, screen.y, 14 * worldScale, 9 * worldScale, 0, 0, Math.PI * 2);
    ctx.stroke();
  });
}
function defenseShape(context, shape, radius) {
  context.beginPath();
  if (shape === "round" || shape === "orb") context.arc(0, 0, radius, 0, Math.PI * 2);
  else if (shape === "hex") {
    for (let i = 0; i < 6; i++) {
      const angle = i * Math.PI / 3 - Math.PI / 2;
      if (i === 0) context.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
      else context.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
    }
    context.closePath();
  } else if (shape === "tri" || shape === "wing") {
    context.moveTo(0, -radius);
    context.lineTo(radius, radius * .8);
    context.lineTo(-radius, radius * .8);
    context.closePath();
  } else if (shape === "diamond") {
    context.moveTo(0, -radius);
    context.lineTo(radius, 0);
    context.lineTo(0, radius);
    context.lineTo(-radius, 0);
    context.closePath();
  } else if (shape === "burst") {
    for (let i = 0; i < 12; i++) {
      const angle = i * Math.PI / 6;
      const r = i % 2 ? radius * .55 : radius;
      if (i === 0) context.moveTo(Math.cos(angle) * r, Math.sin(angle) * r);
      else context.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
    }
    context.closePath();
  } else if (shape === "barrel") context.roundRect(-radius, -radius * .75, radius * 2, radius * 1.5, radius * .3);
  else context.rect(-radius, -radius, radius * 2, radius * 2);
}
function drawSentinel(sentinel) {
  const slot = slotPoint(sentinel.slotIndex);
  const screen = toScreen(slot.x, slot.y);
  const def = DEFENSES[sentinel.defId];
  const radius = (11 + sentinel.tier * 2) * worldScale;
  if (sentinel.slotIndex === selectedSlot) {
    const range = currentStats(sentinel).range * worldScale;
    ctx.strokeStyle = def.color + "45";
    ctx.lineWidth = 1 * worldScale;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, range, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.save();
  ctx.translate(screen.x, screen.y);
  ctx.fillStyle = "#00000070";
  ctx.beginPath();
  ctx.ellipse(3 * worldScale, 10 * worldScale, 18 * worldScale, 7 * worldScale, 0, 0, Math.PI * 2);
  ctx.fill();
  const base = ctx.createLinearGradient(-radius, -radius, radius, radius);
  base.addColorStop(0, shade(def.color, .45));
  base.addColorStop(.5, def.color);
  base.addColorStop(1, shade(def.color, -.5));
  ctx.fillStyle = base;
  ctx.strokeStyle = "#ffffff55";
  ctx.lineWidth = 1.3 * worldScale;
  ctx.save();
  ctx.translate(0, -5 * worldScale);
  if (sentinel.tier >= 2 && !reducedMotion()) {
    ctx.shadowBlur = 14 * worldScale;
    ctx.shadowColor = def.color;
  }
  defenseShape(ctx, def.shape, radius);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  const recoil = sentinel.recoil > 0 && !reducedMotion() ? sentinel.recoil / .16 * 5 : 0;
  ctx.save();
  ctx.rotate(sentinel.aim || 0);
  ctx.strokeStyle = shade(def.color, .3);
  ctx.lineWidth = ((sentinel.defId === "mortar" ? 6 : 3) + sentinel.tier) * worldScale;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-recoil * worldScale, -5 * worldScale);
  ctx.lineTo((19 + sentinel.tier * 3 - recoil) * worldScale, -5 * worldScale);
  ctx.stroke();
  if (sentinel.tier >= 1) {
    ctx.strokeStyle = shade(def.color, .55);
    ctx.lineWidth = 1.5 * worldScale;
    ctx.beginPath();
    ctx.moveTo(2 * worldScale, -9 * worldScale);
    ctx.lineTo((15 + sentinel.tier * 3) * worldScale, -9 * worldScale);
    ctx.stroke();
  }
  ctx.restore();
  ctx.fillStyle = "#ffffffcc";
  for (let pip = 0; pip <= sentinel.tier; pip++) {
    ctx.fillRect((pip * 5 - sentinel.tier * 2.5 - 1.5) * worldScale, 12 * worldScale, 3 * worldScale, 3 * worldScale);
  }
  ctx.restore();
  if (sentinel.jammed > 0) {
    ctx.strokeStyle = "#ff7165";
    ctx.lineWidth = 2 * worldScale;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y - 5 * worldScale, 18 * worldScale, simTime * 4, simTime * 4 + Math.PI * 1.35);
    ctx.stroke();
  }
}
function enemyHull(context, enemy, size, color) {
  const base = ENEMIES[enemy.type];
  context.fillStyle = color;
  context.strokeStyle = shade(base.color, -.5);
  context.lineWidth = 1.5 * worldScale;
  context.beginPath();
  if (base.boss) {
    context.moveTo(size * 1.3, 0);
    context.lineTo(size * .5, size * .72);
    context.lineTo(-size, size * .62);
    context.lineTo(-size * .7, 0);
    context.lineTo(-size, -size * .62);
    context.lineTo(size * .5, -size * .72);
  } else if (base.air) {
    context.moveTo(size * 1.2, 0);
    context.lineTo(-size * .8, size * .7);
    context.lineTo(-size * .35, 0);
    context.lineTo(-size * .8, -size * .7);
  } else if (base.heavy) {
    context.roundRect(-size, -size * .7, size * 2, size * 1.4, size * .25);
  } else if (base.swarm) {
    context.arc(0, 0, size, 0, Math.PI * 2);
  } else {
    context.moveTo(size, 0);
    context.lineTo(size * .25, size * .8);
    context.lineTo(-size, size * .5);
    context.lineTo(-size, -size * .5);
    context.lineTo(size * .25, -size * .8);
  }
  context.closePath();
  context.fill();
  context.stroke();
}
function drawEnemy(enemy) {
  const base = ENEMIES[enemy.type];
  const screen = toScreen(enemy.x, enemy.y);
  const size = (base.size + (base.boss ? 5 : 0)) * worldScale;
  const fade = (enemy.alive ? 1 : clamp(enemy.death / .36, 0, 1)) * (enemy.burrowUntil > simTime ? .35 : 1);
  ctx.save();
  ctx.globalAlpha = fade;
  ctx.translate(screen.x, screen.y);
  ctx.fillStyle = "#00000062";
  ctx.beginPath();
  ctx.ellipse(4 * worldScale, (base.air ? 12 : 8) * worldScale, size * 1.15, size * .45, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.rotate(enemy.angle);
  const hull = ctx.createLinearGradient(-size, -size, size, size);
  hull.addColorStop(0, shade(base.color, .5));
  hull.addColorStop(.45, enemy.hitFlash > 0 ? "#ffffff" : base.color);
  hull.addColorStop(1, shade(base.color, -.45));
  enemyHull(ctx, enemy, size, hull);
  ctx.fillStyle = "#11130f";
  ctx.beginPath();
  ctx.arc(size * .22, 0, Math.max(2, size * .22), 0, Math.PI * 2);
  ctx.fill();
  if (base.air) {
    ctx.fillStyle = "#65d8cf99";
    ctx.fillRect(-size * 1.05, -size * .18, size * .45, size * .36);
  }
  ctx.restore();
  if (enemy.shield > 0) {
    ctx.strokeStyle = "#b792ff99";
    ctx.lineWidth = 2 * worldScale;
    ctx.beginPath();
    ctx.ellipse(screen.x, screen.y, size * 1.45, size, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (enemy.invulnUntil > simTime && enemy.burrowUntil <= simTime) {
    ctx.strokeStyle = "#eadcff";
    ctx.lineWidth = 3 * worldScale;
    ctx.beginPath();
    ctx.ellipse(screen.x, screen.y, size * 1.7, size * 1.25, 0, simTime * 3, simTime * 3 + Math.PI * 1.5);
    ctx.stroke();
  }
  if (enemy.enraged) {
    ctx.strokeStyle = "#ff5e73cc";
    ctx.lineWidth = 2 * worldScale;
    ctx.beginPath();
    ctx.ellipse(screen.x, screen.y, size * 1.55, size * 1.1, 0, -simTime * 4, -simTime * 4 + Math.PI);
    ctx.stroke();
  }
  const barWidth = Math.max(22, base.size * 2.2) * worldScale;
  const barY = screen.y - size - 9 * worldScale;
  ctx.fillStyle = "#050605cc";
  ctx.fillRect(screen.x - barWidth / 2, barY, barWidth, 3 * worldScale);
  ctx.fillStyle = enemy.hp / enemy.maxHp > .38 ? "#73e69e" : "#ff5e73";
  ctx.fillRect(screen.x - barWidth / 2, barY, barWidth * clamp(enemy.hp / enemy.maxHp, 0, 1), 3 * worldScale);
}
function drawProjectiles() {
  projectiles.forEach((projectile) => {
    const screen = toScreen(projectile.x, projectile.y);
    const start = toScreen(projectile.sx, projectile.sy);
    const distance = Math.hypot(projectile.x - projectile.sx, projectile.y - projectile.sy);
    const arcHeight = projectile.arc ? Math.sin(clamp(distance / Math.max(1, Math.hypot(projectile.tx - projectile.sx, projectile.ty - projectile.sy)), 0, 1) * Math.PI) * projectile.arc : 0;
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.strokeStyle = projectile.color + "70";
    ctx.lineWidth = 2.5 * worldScale;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(screen.x, screen.y - arcHeight * worldScale);
    ctx.stroke();
    ctx.shadowBlur = 12 * worldScale;
    ctx.shadowColor = projectile.color;
    ctx.fillStyle = shade(projectile.color, .45);
    ctx.beginPath();
    ctx.arc(screen.x, screen.y - arcHeight * worldScale, (projectile.defId === "mortar" ? 6 : 3.5) * worldScale, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}
function drawEffects() {
  effects.forEach((effect) => {
    const progress = clamp(effect.age / effect.life, 0, 1);
    const alpha = 1 - progress;
    const screen = toScreen(effect.x, effect.y);
    ctx.save();
    ctx.globalAlpha = alpha;
    if (effect.type === "spark") {
      ctx.fillStyle = effect.color;
      ctx.fillRect(screen.x, screen.y, effect.size * worldScale, effect.size * worldScale);
    } else if (effect.type === "muzzle") {
      ctx.globalCompositeOperation = "screen";
      ctx.strokeStyle = effect.color;
      ctx.lineWidth = 4 * worldScale;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(screen.x + Math.cos(effect.angle) * 12 * worldScale, screen.y + Math.sin(effect.angle) * 12 * worldScale);
      ctx.lineTo(screen.x + Math.cos(effect.angle) * (12 + effect.size) * worldScale, screen.y + Math.sin(effect.angle) * (12 + effect.size) * worldScale);
      ctx.stroke();
    } else if (effect.type === "impact" || effect.type === "relay" || effect.type === "jam") {
      ctx.strokeStyle = effect.color;
      ctx.lineWidth = 2 * worldScale;
      ctx.beginPath();
      ctx.ellipse(screen.x, screen.y, effect.size * progress * worldScale, effect.size * .45 * progress * worldScale, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (effect.type === "wind") {
      ctx.strokeStyle = effect.color;
      ctx.lineWidth = 2 * worldScale;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(screen.x - 170 * worldScale, screen.y + i * 35 * worldScale);
        ctx.lineTo(screen.x + (progress * 340 - 170) * worldScale, screen.y + i * 35 * worldScale);
        ctx.stroke();
      }
    } else if (effect.type === "lightning") {
      ctx.strokeStyle = effect.struck ? "#ffffff" : effect.color;
      ctx.lineWidth = (effect.struck ? 6 : 2) * worldScale;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, (18 + progress * 44) * worldScale, 0, Math.PI * 2);
      ctx.stroke();
      if (effect.struck) {
        ctx.beginPath();
        ctx.moveTo(screen.x + Math.sin(progress * 22) * 12 * worldScale, offsetY);
        ctx.lineTo(screen.x, screen.y);
        ctx.stroke();
      }
    } else if (effect.type === "broadside") {
      ctx.strokeStyle = effect.color;
      ctx.lineWidth = (3 + progress * 8) * worldScale;
      ctx.beginPath();
      ctx.moveTo(offsetX + REF_W * worldScale, offsetY + progress * 80 * worldScale);
      ctx.lineTo(screen.x, screen.y);
      ctx.stroke();
    } else if (effect.type === "command") {
      ctx.strokeStyle = effect.color;
      ctx.lineWidth = 4 * alpha * worldScale;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, effect.size * progress * worldScale, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  });
  floaters.forEach((floater) => {
    const screen = toScreen(floater.x, floater.y);
    ctx.save();
    ctx.globalAlpha = 1 - floater.age / floater.life;
    ctx.fillStyle = floater.color;
    ctx.font = "900 " + 11 * worldScale + "px ui-monospace,monospace";
    ctx.textAlign = "center";
    ctx.fillText(floater.text, screen.x, screen.y);
    ctx.restore();
  });
}
function drawBossBars() {
  let index = 0;
  for (let i = 0; i < enemies.length && index < 2; i++) {
    const enemy = enemies[i];
    const base = ENEMIES[enemy.type];
    if (!enemy.alive || !base.boss) continue;
    const barWidth = Math.min(430, cssWidth * .55);
    const x = (cssWidth - barWidth) / 2;
    const y = 44 + index * 26;
    ctx.save();
    ctx.fillStyle = "#050605d8";
    ctx.fillRect(x - 2, y - 2, barWidth + 4, 14);
    const hpRatio = clamp(enemy.hp / enemy.maxHp, 0, 1);
    ctx.fillStyle = hpRatio > .4 ? base.color : "#ff5e73";
    ctx.fillRect(x, y, barWidth * hpRatio, 7);
    if (enemy.maxShield > 0) {
      ctx.fillStyle = "#b792ff";
      ctx.fillRect(x, y + 8, barWidth * clamp(enemy.shield / enemy.maxShield, 0, 1), 2);
    }
    ctx.strokeStyle = "#ffffff40";
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 2, y - 2, barWidth + 4, 14);
    ctx.fillStyle = "#f5f1e7";
    ctx.font = "900 9px ui-monospace,monospace";
    ctx.textAlign = "left";
    ctx.fillText(base.name.toUpperCase() + (enemy.invulnUntil > simTime ? " / IMMUNE" : enemy.enraged ? " / ENRAGED" : ""), x, y - 5);
    ctx.restore();
    index += 1;
  }
}
function draw() {
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  ctx.save();
  if (cameraShake > 0 && !reducedMotion()) ctx.translate((Math.random() - .5) * cameraShake * 15, (Math.random() - .5) * cameraShake * 10);
  drawBackground();
  drawRoutes();
  drawObjectives();
  drawSpire();
  drawSlots();
  const layers = [];
  sentinels.forEach((sentinel) => layers.push({ y: slotPoint(sentinel.slotIndex).y, type: "sentinel", value: sentinel }));
  enemies.forEach((enemy) => layers.push({ y: enemy.y, type: "enemy", value: enemy }));
  layers.sort((a, b) => a.y - b.y).forEach((layer) => {
    if (layer.type === "sentinel") drawSentinel(layer.value); else drawEnemy(layer.value);
  });
  drawProjectiles();
  drawEffects();
  drawBossBars();
  if (spireFlash > 0) {
    ctx.fillStyle = "rgba(255,94,115," + spireFlash * .22 + ")";
    ctx.fillRect(0, 0, cssWidth, cssHeight);
  }
  ctx.restore();
}
let lastFrame = 0;
function frame(timestamp) {
  requestAnimationFrame(frame);
  if (!lastFrame) lastFrame = timestamp;
  const dt = clamp((timestamp - lastFrame) / 1000, 0, .05);
  lastFrame = timestamp;
  if (running && !paused && !document.hidden && currentScreen === "game") tick(dt);
  if (currentScreen === "game") draw();
}

// ---------------------------------------------------------------------------
// Menu, results, settings, and tutorial wiring
// ---------------------------------------------------------------------------
function renderMenuMeta() {
  rankEls.rank.textContent = String(meta.rank);
  rankEls.fill.style.width = Math.round(meta.xp % 350 / 350 * 100) + "%";
  rankEls.campaign.textContent = String(meta.bestWaveCampaign);
  rankEls.endless.textContent = String(meta.bestWaveEndless);
  roomModeBtn.hidden = !battle.active;
}
document.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => openLoadout(button.dataset.mode)));
$("[data-loadout-back]").addEventListener("click", () => showScreen("title"));
$("[data-loadout-start]").addEventListener("click", () => pendingMode === "battle" ? startRoomBattle() : startRun(pendingMode));
$("[data-armory-open]").addEventListener("click", openArmory);
$("[data-armory-close]").addEventListener("click", closeArmory);
$("[data-armory-overlay]").addEventListener("click", (event) => { if (event.target === $("[data-armory-overlay]")) closeArmory(); });
$("[data-armory-tower-upgrade]").addEventListener("click", buyCommandUpgrade);
$("[data-pause-btn]").addEventListener("click", () => setPaused(true));
$("[data-exit-btn]").addEventListener("click", returnToMenu);
$("[data-resume-btn]").addEventListener("click", () => setPaused(false));
$("[data-restart-btn]").addEventListener("click", () => { overlayPause.hidden = true; startRun(mode); });
$("[data-menu-btn]").addEventListener("click", returnToMenu);
$("[data-results-menu]").addEventListener("click", returnToMenu);
$("[data-results-again]").addEventListener("click", () => openLoadout(mode));
$("[data-results-rematch]").addEventListener("click", () => {
  if (battle.amIHost) {
    battle.duel = {};
    matchAction({ duel: {} }, "merge");
  }
  openLoadout("battle");
});
function setPaused(value) {
  if (!running) return;
  paused = value;
  overlayPause.hidden = !value;
  host("paused", { paused: value });
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden && running && !paused) setPaused(true);
});

function syncSettingsInputs() {
  [$("[data-vol-mute]"), $("[data-vol-mute-menu]")].forEach((input) => { input.checked = localMuted; });
  [$("[data-vol-slider]"), $("[data-vol-slider-menu]")].forEach((input) => { input.value = String(localVolume); });
  [$("[data-reduced-toggle]"), $("[data-reduced-toggle-menu]")].forEach((input) => { input.checked = localReducedMotion; });
}
function wireSettings(muteSelector, volumeSelector, motionSelector) {
  $(muteSelector).addEventListener("change", (event) => { localMuted = event.target.checked; syncSettingsInputs(); });
  $(volumeSelector).addEventListener("input", (event) => {
    localVolume = clamp(Number(event.target.value) || 0, 0, 100);
    meta.soundVol = localVolume;
    syncSettingsInputs();
  });
  $(motionSelector).addEventListener("change", (event) => {
    localReducedMotion = event.target.checked;
    meta.reducedMotion = localReducedMotion;
    applyMotionClass();
    syncSettingsInputs();
  });
}
wireSettings("[data-vol-mute]", "[data-vol-slider]", "[data-reduced-toggle]");
wireSettings("[data-vol-mute-menu]", "[data-vol-slider-menu]", "[data-reduced-toggle-menu]");
$("[data-open-settings]").addEventListener("click", () => { syncSettingsInputs(); overlaySettings.hidden = false; });
$("[data-settings-close]").addEventListener("click", () => { overlaySettings.hidden = true; });

const TUTORIAL = [
  { title: "Draft before battle", copy: "Every mission begins in the Command Bay. Select exactly four defense chassis, one commander, and one sky theater." },
  { title: "Build around counters", copy: "Splash breaks swarms, flak owns the air, rail fire pierces armor, and Null Lanterns collapse shields and reveal phase craft." },
  { title: "Read the branches", copy: "Raid formations split across multiple curved routes. Place overlapping fields near shared junctions and chokepoints." },
  { title: "Command the objective", copy: "Relays, shield cores, and gate lines fail differently. The HUD names the tactical condition that can end the battle." },
  { title: "Commit the commander", copy: "Your commander changes every defense, the Spire, faction lighting, and one battle ability. Q or Space calls it from the field." },
  { title: "Pressure rival command", copy: "War Game and Private Room modes let Glint fund Swarm, Armor, or Blackout pressure while you still defend your own route." }
];
let tutorialIndex = 0;
function renderTutorial() {
  const step = TUTORIAL[tutorialIndex];
  $("[data-tutorial-body]").innerHTML = "<h3>" + esc(step.title) + "</h3><p>" + esc(step.copy) + "</p>";
  $("[data-tutorial-dots]").innerHTML = TUTORIAL.map((_, index) => '<i class="' + (index === tutorialIndex ? "is-on" : "") + '"></i>').join("");
  $("[data-tutorial-back]").disabled = tutorialIndex === 0;
  $("[data-tutorial-next]").textContent = tutorialIndex === TUTORIAL.length - 1 ? "Done" : "Next";
}
function closeTutorial() {
  meta.tutorialSeen = true;
  overlayTutorial.hidden = true;
}
$("[data-open-tutorial]").addEventListener("click", () => { tutorialIndex = 0; renderTutorial(); overlayTutorial.hidden = false; });
$("[data-tutorial-back]").addEventListener("click", () => { tutorialIndex = Math.max(0, tutorialIndex - 1); renderTutorial(); });
$("[data-tutorial-next]").addEventListener("click", () => {
  if (tutorialIndex < TUTORIAL.length - 1) { tutorialIndex += 1; renderTutorial(); } else closeTutorial();
});
$("[data-tutorial-skip]").addEventListener("click", closeTutorial);

// ---------------------------------------------------------------------------
// Host protocol listener and internal checks
// ---------------------------------------------------------------------------
addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.source !== "phantomplay-host") return;
  if (data.type === "settings") {
    if ("sound" in data) hostSoundOn = !!data.sound;
    hostReducedMotion = !!data.reducedMotion;
    applyMotionClass();
  } else if (data.type === "pause") {
    setPaused(true);
  } else if (data.type === "resume") {
    setPaused(false);
  } else if (data.type === "restart") {
    if (mode) startRun(mode);
  } else if (data.type === "restore") {
    applyMetaFromState(data.state);
    syncSettingsInputs();
    renderMenuMeta();
    renderLoadout();
  } else if (data.type === "match-state") {
    consumeRoomState(data);
    renderMenuMeta();
  } else if (data.type === "exit") {
    host("exit");
  }
});
if ("ResizeObserver" in window) new ResizeObserver(resizeCanvas).observe(fieldEl);
addEventListener("resize", resizeCanvas);

function runInternalChecks() {
  const errors = [];
  if (DEFENSE_ORDER.length < 8 || DEFENSE_ORDER.some((id) => !DEFENSES[id])) errors.push("defense roster");
  if (DEFENSE_ORDER.some((id) => DEFENSES[id].tiers.length !== 3 || DEFENSES[id].upgradeCosts.length !== 2)) errors.push("defense tier tables");
  if (COMMANDER_ORDER.length < 4 || COMMANDER_ORDER.some((id) => !COMMANDERS[id])) errors.push("commander roster");
  if (selectedDefenses.length !== 4 || new Set(selectedDefenses).size !== 4) errors.push("four-defense loadout");
  if (BOSS_SCHEDULE.length !== 10 || BOSS_SCHEDULE.some((entry) => !ENEMIES[entry.type] || !ENEMIES[entry.type].boss)) errors.push("boss schedule");
  let previousHpMul = 0;
  for (let round = 1; round <= CENTURY_ROUNDS; round++) {
    const generated = endlessWave(round);
    if (!generated.entries.length || generated.entries.some((entry) => !ENEMIES[entry.type] || !Number.isFinite(entry.count) || entry.count < 1)) errors.push("round " + round + " entries");
    if (!Number.isFinite(generated.hpMul) || generated.hpMul <= previousHpMul) errors.push("round " + round + " curve");
    previousHpMul = generated.hpMul;
    if ((round % 10 === 0) !== !!generated.boss) errors.push("round " + round + " boss cadence");
  }
  MAPS.forEach((map) => {
    if (map.routes.length < 2 || map.slots.length < 10) errors.push(map.id + " topology");
    map.routes.forEach((route) => {
      if (!Number.isFinite(route.length) || route.length < 450) errors.push(map.id + " route");
    });
  });
  if (errors.length) throw new Error("Skyguard Arena internal check failed: " + errors.join(", "));
  return true;
}

runInternalChecks();
applyCommanderTheme();
renderMenuMeta();
renderLoadout();
syncSettingsInputs();
applyMotionClass();
showScreen("title");
requestAnimationFrame(resizeCanvas);
requestAnimationFrame(frame);
host("ready");
// Do not block the title screen with the manual. The field manual stays available
// from the title footer, but first load must let the player draft and launch.
