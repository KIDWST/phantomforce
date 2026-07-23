/* VESPERGATE: THE VESPER HAND — world.js
 * Top-down tile world + material system + the "perpetual golden dusk" art
 * pass: gleaming animated water, swaying grass, shaded roofs, warm lantern
 * light. Tiles carry material identity that governs walkability, portal
 * placement (liminal stone accepts gates, null iron refuses), reflection
 * (mirror-bone banks shots), and rendering. Rooms are hand-authored ASCII.
 *
 * Materials:
 *   .  open ground (biome floor)          P  path
 *   #  liminal stone wall (portalable)    X  null iron (no portals)
 *   =  dead stone wall                    ^  spike hazard (walkable, hurts)
 *   ~  bell-brass (portalable, rings)     M  mirror-bone (reflects shots)
 *   G  saint-glass (portalable, translucent)
 *   W  water (blocks walking, not shots)  B  bridge   S  sand/shore
 *   T  tree   F  fence   H  house wall    R  roof     D  door (walkable)
 *   L  lantern post      O  quest board   w  well     b  the village bell
 *   t  tall grass        f  flowers
 */
"use strict";
(() => {
  const VG = window.VG;
  const T = VG.TILE;

  const MAT = {
    OPEN: 0, LIMINAL: 1, NULL_IRON: 2, DEAD: 3, SPIKE: 4, BRASS: 5,
    MIRROR: 7, SAINTGLASS: 8,
    WATER: 10, BRIDGE: 11, SAND: 12, TREE: 13, FENCE: 14, HOUSE: 15,
    ROOF: 16, DOOR: 17, PATH: 18, LANTERN: 19, BOARD: 20, WELL: 21,
    BELL: 22, GRASS_TALL: 23, FLOWERS: 24,
  };
  // Solid = blocks bodies AND shots/sight.
  const SOLID = new Set([MAT.LIMINAL, MAT.NULL_IRON, MAT.DEAD, MAT.BRASS, MAT.MIRROR,
    MAT.TREE, MAT.FENCE, MAT.HOUSE, MAT.ROOF, MAT.LANTERN, MAT.BOARD, MAT.WELL, MAT.BELL, MAT.SAINTGLASS]);
  // Blocks walking but NOT shots (shots fly over water).
  const NOWALK = new Set([MAT.WATER]);
  const PORTALABLE = new Set([MAT.LIMINAL, MAT.BRASS, MAT.SAINTGLASS]);
  const REFLECT = new Set([MAT.MIRROR]);
  const CHARMAT = {
    ".": 0, "#": 1, "X": 2, "=": 3, "^": 4, "~": 5, "M": 7, "G": 8,
    "W": 10, "B": 11, "S": 12, "T": 13, "F": 14, "H": 15, "R": 16, "D": 17,
    "P": 18, "L": 19, "O": 20, "w": 21, "b": 22, "t": 23, "f": 24, " ": 0,
  };

  /* biome palettes: [groundA, groundB, groundEdge] */
  const BIOMES = {
    village: { ga: [58, 74, 48], gb: [52, 68, 44], amb: "rgba(38,26,66,0.16)", warm: true },
    vale: { ga: [56, 78, 46], gb: [50, 70, 42], amb: "rgba(34,24,62,0.14)", warm: true },
    lake: { ga: [54, 70, 50], gb: [48, 64, 46], amb: "rgba(28,26,70,0.18)", warm: true },
    interior: { ga: [64, 52, 44], gb: [58, 47, 40], amb: "rgba(20,14,34,0.10)", warm: true },
    dungeon: { ga: [30, 30, 44], gb: [26, 27, 40], amb: "rgba(10,8,26,0.22)", warm: false },
    ossuary: { ga: [44, 46, 58], gb: [40, 42, 54], amb: "rgba(20,24,48,0.20)", warm: false },
  };

  class Room {
    constructor(def) {
      this.id = def.id;
      this.name = def.name;
      this.biome = def.biome || "vale";
      this.rows = def.map;
      this.w = def.map[0].length;
      this.h = def.map.length;
      this.pxW = this.w * T; this.pxH = this.h * T;
      this.spawn = def.spawn || { x: 2, y: 2 };
      this.exits = def.exits || [];
      this.enemies = def.enemies || [];
      this.pickups = def.pickups || [];
      this.npcs = def.npcs || [];
      this.bells = def.bells || [];
      this.boss = def.boss || null;
      this.shrine = def.shrine || null;
      this.sigil = def.sigil || null;      // ossuary bank-shot switch
      this.hint = def.hint || "";
      this._bake();
    }
    _bake() { this.grid = this.rows.map((r) => r.split("").map((c) => CHARMAT[c] ?? 0)); }
    matAt(gx, gy) {
      if (gx < 0 || gy < 0 || gx >= this.w || gy >= this.h) return MAT.DEAD;
      return this.grid[gy][gx];
    }
    matAtPx(x, y) { return this.matAt(Math.floor(x / T), Math.floor(y / T)); }
    solidAtPx(x, y) { return SOLID.has(this.matAtPx(x, y)); }
    // walking: solids + water block; everything else is ground
    blockedAtPx(x, y) { const m = this.matAtPx(x, y); return SOLID.has(m) || NOWALK.has(m); }
    spikeAtPx(x, y) { return this.matAtPx(x, y) === MAT.SPIKE; }
    reflectAtPx(x, y) { return REFLECT.has(this.matAtPx(x, y)); }
    waterAtPx(x, y) { return this.matAtPx(x, y) === MAT.WATER; }
    tallGrassAtPx(x, y) { return this.matAtPx(x, y) === MAT.GRASS_TALL; }

    classifyPortal(px, py) {
      const gx = Math.floor(px / T), gy = Math.floor(py / T);
      const cell = this.matAt(gx, gy);
      if (SOLID.has(cell)) {
        const faces = [
          { dir: "up", nx: 0, ny: -1 }, { dir: "down", nx: 0, ny: 1 },
          { dir: "left", nx: -1, ny: 0 }, { dir: "right", nx: 1, ny: 0 },
        ];
        for (const f of faces) {
          const ax = gx + f.nx, ay = gy + f.ny;
          const neighbour = this.matAt(ax, ay);
          if (!SOLID.has(neighbour) && !NOWALK.has(neighbour)) {
            if (!PORTALABLE.has(cell)) return { valid: false, reason: cell === MAT.NULL_IRON ? "null-iron" : "dead-stone" };
            const cx = (gx + 0.5) * T + f.nx * (T / 2);
            const cy = (gy + 0.5) * T + f.ny * (T / 2);
            return { valid: true, dir: f.dir, x: cx, y: cy };
          }
        }
        return { valid: false, reason: "no-face" };
      }
      return { valid: false, reason: "open-air" };
    }

    /* ================= rendering ================= */
    draw(ctx, cam, t, flags = {}) {
      const B = BIOMES[this.biome] || BIOMES.vale;
      const x0 = Math.max(0, Math.floor(cam.x / T) - 1);
      const y0 = Math.max(0, Math.floor(cam.y / T) - 1);
      const x1 = Math.min(this.w, Math.ceil((cam.x + VG.W) / T) + 1);
      const y1 = Math.min(this.h, Math.ceil((cam.y + VG.H) / T) + 1);
      // ground pass
      for (let gy = y0; gy < y1; gy++) for (let gx = x0; gx < x1; gx++) {
        this._ground(ctx, gx * T, gy * T, this.grid[gy][gx], gx, gy, t, B);
      }
      // feature pass (on top of ground)
      for (let gy = y0; gy < y1; gy++) for (let gx = x0; gx < x1; gx++) {
        const m = this.grid[gy][gx];
        if (m !== MAT.OPEN && m !== MAT.PATH && m !== MAT.SAND) this._tile(ctx, gx * T, gy * T, m, gx, gy, t, B, flags);
      }
    }
    _hash(gx, gy) { return ((gx * 928371 + gy * 1299721) >>> 0); }
    _ground(ctx, x, y, m, gx, gy, t, B) {
      const h = this._hash(gx, gy), v = h % 14;
      if (m === MAT.WATER) return; // water paints itself fully in _tile
      if (this.biome === "dungeon" || this.biome === "ossuary" || this.biome === "interior") {
        // stone / plank floor
        ctx.fillStyle = `rgb(${B.ga[0] + v},${B.ga[1] + v},${B.ga[2] + v})`;
        ctx.fillRect(x, y, T, T);
        ctx.fillStyle = "rgba(0,0,0,0.12)";
        if ((gx + gy) % 2) ctx.fillRect(x, y, T, T);
        if (this.biome === "interior") { ctx.fillStyle = "rgba(0,0,0,0.18)"; ctx.fillRect(x, y + T - 1, T, 1); }
        return;
      }
      // grass with two-tone dapple + mown texture
      const g = ((gx * 7 + gy * 13 + ((h >> 4) & 3)) % 2) ? B.ga : B.gb;
      ctx.fillStyle = `rgb(${g[0] + v},${g[1] + v},${g[2] + v})`;
      ctx.fillRect(x, y, T, T);
      if (h % 11 === 0) { ctx.fillStyle = "rgba(255,240,180,0.05)"; ctx.fillRect(x + (h % 12), y + ((h >> 3) % 12), 2, 1); }
      if (m === MAT.PATH) {
        ctx.fillStyle = `rgb(${112 + v},${96 + v},${72 + v})`;
        ctx.fillRect(x, y, T, T);
        ctx.fillStyle = "rgba(60,44,30,0.35)";
        ctx.fillRect(x + (h % 9), y + ((h >> 2) % 11), 3, 2);
        ctx.fillRect(x + ((h >> 5) % 10), y + ((h >> 7) % 9), 2, 2);
      } else if (m === MAT.SAND) {
        ctx.fillStyle = `rgb(${168 + v},${150 + v},${112 + v})`;
        ctx.fillRect(x, y, T, T);
        ctx.fillStyle = "rgba(120,100,70,0.3)"; ctx.fillRect(x + (h % 11), y + ((h >> 3) % 12), 2, 1);
      }
    }
    _tile(ctx, x, y, m, gx, gy, t, B, flags) {
      const h = this._hash(gx, gy), v = h % 18;
      if (m === MAT.WATER) {
        // THE gleam: deep base, drifting specular bands, sparkle, shore foam
        ctx.fillStyle = `rgb(${22 + (v >> 2)},${44 + (v >> 2)},${86 + (v >> 1)})`;
        ctx.fillRect(x, y, T, T);
        const band = Math.sin(t * 1.3 + gx * 0.55 + gy * 1.15);
        if (band > 0.25) {
          ctx.fillStyle = `rgba(120,180,255,${0.10 + band * 0.10})`;
          ctx.fillRect(x, y + ((h + Math.floor(t * 9)) % T), T, 2);
        }
        const tw = Math.sin(t * 2.2 + h % 100);
        if (tw > 0.93) { ctx.fillStyle = "rgba(255,244,214,0.85)"; ctx.fillRect(x + (h % 13), y + ((h >> 3) % 13), 2, 2); }
        // warm dusk sheen drifting across the whole body of water
        const sheen = Math.sin(t * 0.5 + (gx + gy) * 0.18);
        if (sheen > 0.6) { ctx.fillStyle = `rgba(255,170,110,${(sheen - 0.6) * 0.12})`; ctx.fillRect(x, y, T, T); }
        // foam against any walkable neighbour
        const open = (ax, ay) => { const mm = this.matAt(ax, ay); return !SOLID.has(mm) && mm !== MAT.WATER; };
        ctx.fillStyle = `rgba(220,240,255,${0.35 + Math.sin(t * 2.4 + gx + gy) * 0.15})`;
        if (open(gx, gy - 1)) ctx.fillRect(x, y, T, 2);
        if (open(gx, gy + 1)) ctx.fillRect(x, y + T - 2, T, 2);
        if (open(gx - 1, gy)) ctx.fillRect(x, y, 2, T);
        if (open(gx + 1, gy)) ctx.fillRect(x + T - 2, y, 2, T);
      } else if (m === MAT.BRIDGE) {
        ctx.fillStyle = `rgb(${104 + v},${78 + v},${50 + v})`;
        ctx.fillRect(x, y, T, T);
        ctx.fillStyle = "rgba(40,26,14,0.5)";
        for (let i = 0; i < 3; i++) ctx.fillRect(x, y + 3 + i * 5, T, 1);
        ctx.fillStyle = "rgba(255,220,160,0.10)"; ctx.fillRect(x, y, T, 1);
      } else if (m === MAT.TREE) {
        // trunk + layered canopy with dusk rim light + soft shadow
        ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.beginPath(); ctx.ellipse(x + T / 2, y + T - 2, 7, 3, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#4a3420"; ctx.fillRect(x + 6, y + 8, 4, 7);
        const swayT = Math.sin(t * 0.9 + (h % 10)) * 1.2;
        ctx.fillStyle = `rgb(${30 + (v >> 1)},${58 + (v >> 1)},${34 + (v >> 1)})`;
        ctx.beginPath(); ctx.arc(x + T / 2 + swayT * 0.4, y + 6, 8, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `rgb(${42 + v},${76 + v},${44 + v})`;
        ctx.beginPath(); ctx.arc(x + T / 2 - 3 + swayT * 0.6, y + 4, 5.5, 0, Math.PI * 2); ctx.arc(x + T / 2 + 3 + swayT, y + 3, 5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(255,190,120,0.16)";
        ctx.beginPath(); ctx.arc(x + T / 2 - 4 + swayT, y + 1.5, 3.4, 0, Math.PI * 2); ctx.fill();
      } else if (m === MAT.FENCE) {
        const broken = !flags.fencesFixed && (h % 5 === 0);
        ctx.fillStyle = "#5a4028";
        if (broken) { ctx.save(); ctx.translate(x + T / 2, y + T / 2); ctx.rotate(0.5); ctx.fillRect(-1.5, -6, 3, 11); ctx.restore(); }
        else { ctx.fillRect(x + 2, y + 3, 3, 11); ctx.fillRect(x + 11, y + 3, 3, 11); ctx.fillRect(x, y + 5, T, 2); ctx.fillRect(x, y + 10, T, 2); }
        ctx.fillStyle = "rgba(255,220,160,0.10)"; ctx.fillRect(x + 2, y + 3, 3, 1);
      } else if (m === MAT.HOUSE) {
        ctx.fillStyle = `rgb(${92 + (v >> 1)},${74 + (v >> 1)},${58 + (v >> 1)})`;
        ctx.fillRect(x, y, T, T);
        ctx.fillStyle = "#3a2c1e"; // timber frame
        ctx.fillRect(x, y, T, 2); ctx.fillRect(x, y + T - 2, T, 2);
        if (h % 3 === 0) ctx.fillRect(x + 7, y, 2, T);
        if (h % 4 === 1) { // warm window
          ctx.fillStyle = "#241a10"; ctx.fillRect(x + 4, y + 5, 8, 7);
          const flick = 0.75 + Math.sin(t * 7 + h) * 0.1;
          ctx.fillStyle = `rgba(255,196,110,${0.75 * flick})`; ctx.fillRect(x + 5, y + 6, 6, 5);
          ctx.fillStyle = "#241a10"; ctx.fillRect(x + 7.5, y + 5, 1, 7); ctx.fillRect(x + 4, y + 8, 8, 1);
        }
      } else if (m === MAT.ROOF) {
        const row = gy % 2;
        ctx.fillStyle = row ? `rgb(${118 + v},${52 + (v >> 1)},${44 + (v >> 1)})` : `rgb(${132 + v},${60 + (v >> 1)},${50 + (v >> 1)})`;
        ctx.fillRect(x, y, T, T);
        ctx.fillStyle = "rgba(0,0,0,0.22)";
        for (let i = 0; i < 2; i++) ctx.fillRect(x + ((h >> i) % 2) * 8, y + i * 8, 8, 1);
        // ridge highlight facing the dusk sun
        if (!SOLID.has(this.matAt(gx, gy - 1)) || this.matAt(gx, gy - 1) !== MAT.ROOF) { ctx.fillStyle = "rgba(255,180,120,0.28)"; ctx.fillRect(x, y, T, 2); }
      } else if (m === MAT.DOOR) {
        ctx.fillStyle = "#3a281a"; ctx.fillRect(x + 2, y, T - 4, T);
        ctx.fillStyle = "#54381f"; ctx.fillRect(x + 3, y + 1, T - 6, T - 2);
        ctx.fillStyle = "#c9a86a"; ctx.fillRect(x + T - 6, y + 8, 2, 2);
        ctx.fillStyle = `rgba(255,200,120,${0.15 + Math.sin(t * 2) * 0.05})`; ctx.fillRect(x + 2, y + T - 2, T - 4, 2);
      } else if (m === MAT.LANTERN) {
        ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.beginPath(); ctx.ellipse(x + T / 2, y + T - 2, 5, 2, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#2c2c34"; ctx.fillRect(x + 7, y + 4, 2, 11);
        ctx.fillStyle = "#1c1c22"; ctx.fillRect(x + 5, y + 1, 6, 6);
        const lit = flags.lanternsLit !== false;
        if (lit) {
          const flick = 0.8 + Math.sin(t * 9 + h) * 0.12;
          ctx.fillStyle = `rgba(255,206,120,${0.9 * flick})`; ctx.fillRect(x + 6, y + 2, 4, 4);
        } else { ctx.fillStyle = "#403828"; ctx.fillRect(x + 6, y + 2, 4, 4); }
      } else if (m === MAT.BOARD) {
        ctx.fillStyle = "#4a3420"; ctx.fillRect(x + 2, y + 2, T - 4, 9);
        ctx.fillStyle = "#6a4c2c"; ctx.fillRect(x + 3, y + 3, T - 6, 7);
        ctx.fillStyle = "#e8dcc0"; ctx.fillRect(x + 5, y + 4, 4, 5); ctx.fillRect(x + 10, y + 5, 3, 4);
        ctx.fillStyle = "#4a3420"; ctx.fillRect(x + 4, y + 11, 2, 4); ctx.fillRect(x + 10, y + 11, 2, 4);
      } else if (m === MAT.WELL) {
        ctx.fillStyle = "#5c5c68"; ctx.beginPath(); ctx.arc(x + T / 2, y + T / 2 + 2, 7, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#14202e"; ctx.beginPath(); ctx.arc(x + T / 2, y + T / 2 + 2, 4.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `rgba(140,190,255,${0.3 + Math.sin(t * 1.8) * 0.1})`; ctx.beginPath(); ctx.arc(x + T / 2 - 1, y + T / 2 + 1, 2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#4a3420"; ctx.fillRect(x + 2, y - 2, 2, 8); ctx.fillRect(x + 12, y - 2, 2, 8); ctx.fillRect(x + 1, y - 3, 14, 2);
      } else if (m === MAT.BELL) {
        // the village evensong bell — silent (dull) until restored
        const restored = !!flags.bellRestored;
        ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.beginPath(); ctx.ellipse(x + T / 2, y + T - 1, 7, 2.5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = restored ? "#a8842e" : "#6a5c3a";
        ctx.beginPath(); ctx.moveTo(x + 3, y + 12); ctx.quadraticCurveTo(x + T / 2, y - 4, x + 13, y + 12); ctx.closePath(); ctx.fill();
        ctx.fillStyle = restored ? "#d8b04a" : "#7a6c48"; ctx.fillRect(x + 3, y + 10, 10, 2);
        if (restored) { ctx.fillStyle = `rgba(255,226,140,${0.25 + Math.sin(t * 2.6) * 0.15})`; ctx.beginPath(); ctx.arc(x + T / 2, y + 7, 9, 0, Math.PI * 2); ctx.fill(); }
      } else if (m === MAT.GRASS_TALL) {
        const sway = Math.sin(t * 2.1 + gx * 1.7 + gy) * 1.6;
        ctx.strokeStyle = `rgb(${44 + v},${86 + v},${40 + v})`; ctx.lineWidth = 1.4;
        for (let i = 0; i < 4; i++) {
          const bx = x + 2 + i * 4;
          ctx.beginPath(); ctx.moveTo(bx, y + T);
          ctx.quadraticCurveTo(bx + sway * 0.4, y + 8, bx + sway, y + 3 + (h >> i) % 3);
          ctx.stroke();
        }
        ctx.fillStyle = "rgba(255,230,160,0.08)"; ctx.fillRect(x + (h % 10), y + 2, 2, 2);
      } else if (m === MAT.FLOWERS) {
        const cols = ["#ff9ad0", "#ffd166", "#c9a8ff", "#8fe9ff"];
        for (let i = 0; i < 3; i++) {
          const fx = x + 2 + ((h >> (i * 3)) % 11), fy = y + 3 + ((h >> (i * 2 + 1)) % 10);
          ctx.fillStyle = cols[(h >> i) % 4]; ctx.fillRect(fx, fy, 2, 2);
          ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.fillRect(fx, fy, 1, 1);
        }
      } else if (m === MAT.LIMINAL) {
        ctx.fillStyle = `rgb(${34 + v},${36 + v},${54 + v})`; ctx.fillRect(x, y, T, T);
        ctx.fillStyle = "rgba(130,160,230,0.12)"; ctx.fillRect(x + 1, y + 1, T - 2, 1);
        ctx.fillStyle = "rgba(0,0,0,0.28)"; ctx.fillRect(x, y + T - 2, T, 2);
        if (h % 7 === 0) { ctx.strokeStyle = "rgba(150,180,240,0.16)"; ctx.beginPath(); ctx.arc(x + T / 2, y + T / 2, 4, 0, Math.PI * 2); ctx.stroke(); }
      } else if (m === MAT.BRASS) {
        const g = 96 + v;
        ctx.fillStyle = `rgb(${g + 34},${g},${34})`; ctx.fillRect(x, y, T, T);
        ctx.fillStyle = "rgba(255,224,130,0.18)"; ctx.fillRect(x + 2, y + 2, T - 4, 2);
        ctx.fillStyle = "rgba(40,20,0,0.4)"; ctx.fillRect(x, y + T - 3, T, 3);
      } else if (m === MAT.NULL_IRON) {
        ctx.fillStyle = `rgb(${15 + (v >> 1)},${14 + (v >> 1)},${17 + (v >> 1)})`; ctx.fillRect(x, y, T, T);
        ctx.strokeStyle = "rgba(96,64,96,0.28)"; ctx.strokeRect(x + 2.5, y + 2.5, T - 5, T - 5);
      } else if (m === MAT.DEAD) {
        ctx.fillStyle = `rgb(${32 + v},${30 + v},${32 + v})`; ctx.fillRect(x, y, T, T);
        ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.fillRect(x, y + T - 2, T, 2);
      } else if (m === MAT.SPIKE) {
        ctx.fillStyle = "#c9d6e8";
        for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(x + 2 + i * 5, y + T); ctx.lineTo(x + 4.5 + i * 5, y + 4); ctx.lineTo(x + 7 + i * 5, y + T); ctx.fill(); }
      } else if (m === MAT.MIRROR) {
        ctx.fillStyle = `rgb(${198 + (v >> 1)},${202 + (v >> 1)},${212 + (v >> 1)})`; ctx.fillRect(x, y, T, T);
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        const hl = ((gx * 3 + gy * 5 + Math.floor(t * 20)) % (T + 8)) - 4;
        ctx.fillRect(x + hl, y, 2, T);
        ctx.strokeStyle = "rgba(120,140,180,0.4)"; ctx.strokeRect(x + 0.5, y + 0.5, T - 1, T - 1);
      } else if (m === MAT.SAINTGLASS) {
        ctx.fillStyle = `rgba(${122 + v},${162 + v},${212 + v},0.55)`; ctx.fillRect(x, y, T, T);
        ctx.fillStyle = "rgba(200,230,255,0.25)"; ctx.fillRect(x + 3, y + 3, T - 6, T - 6);
      }
    }
    /* warm ambient + lantern glow overlay; call AFTER entities, camera-space */
    drawLight(ctx, cam, t, flags = {}) {
      const B = BIOMES[this.biome] || BIOMES.vale;
      // dusk ambient wash
      ctx.fillStyle = B.amb;
      ctx.fillRect(cam.x, cam.y, VG.W, VG.H);
      if (!B.warm) return;
      // warm horizon from the west
      const grad = ctx.createLinearGradient(cam.x, 0, cam.x + VG.W, 0);
      grad.addColorStop(0, "rgba(255,150,80,0.10)"); grad.addColorStop(0.45, "rgba(255,150,80,0)");
      ctx.fillStyle = grad; ctx.fillRect(cam.x, cam.y, VG.W, VG.H);
      // lantern glows
      if (flags.lanternsLit === false) return;
      const x0 = Math.max(0, Math.floor(cam.x / T) - 4), y0 = Math.max(0, Math.floor(cam.y / T) - 4);
      const x1 = Math.min(this.w, Math.ceil((cam.x + VG.W) / T) + 4), y1 = Math.min(this.h, Math.ceil((cam.y + VG.H) / T) + 4);
      ctx.globalCompositeOperation = "lighter";
      for (let gy = y0; gy < y1; gy++) for (let gx = x0; gx < x1; gx++) {
        const m = this.grid[gy][gx];
        if (m !== MAT.LANTERN && !(m === MAT.HOUSE && this._hash(gx, gy) % 4 === 1)) continue;
        const cx = gx * T + T / 2, cy = gy * T + 6;
        const R = m === MAT.LANTERN ? 34 : 20;
        const flick = 0.85 + Math.sin(t * 8 + this._hash(gx, gy)) * 0.1;
        const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, R);
        g.addColorStop(0, `rgba(255,190,100,${0.20 * flick})`);
        g.addColorStop(1, "rgba(255,190,100,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
    }
    /* Living Darkness support: world-space light sources (brass, saint-glass,
       lanterns) and nearby mirror-tile centers, for effects.js/game.js to
       consume — kept here since only Room knows the tile grid. */
    collectLights(cam) {
      const out = [];
      const x0 = Math.max(0, Math.floor(cam.x / T) - 2), y0 = Math.max(0, Math.floor(cam.y / T) - 2);
      const x1 = Math.min(this.w, Math.ceil((cam.x + VG.W) / T) + 2), y1 = Math.min(this.h, Math.ceil((cam.y + VG.H) / T) + 2);
      for (let gy = y0; gy < y1; gy++) for (let gx = x0; gx < x1; gx++) {
        const m = this.grid[gy][gx];
        if (m === MAT.LANTERN) out.push({ x: gx * T + T / 2, y: gy * T + 6, r: 30, seed: this._hash(gx, gy) });
        else if (m === MAT.BRASS) out.push({ x: gx * T + T / 2, y: gy * T + T / 2, r: 22, seed: this._hash(gx, gy) });
        else if (m === MAT.SAINTGLASS) out.push({ x: gx * T + T / 2, y: gy * T + T / 2, r: 26, seed: this._hash(gx, gy) });
      }
      return out;
    }
    mirrorTilesNear(x, y, range) {
      const gx0 = Math.max(0, Math.floor((x - range) / T)), gx1 = Math.min(this.w - 1, Math.floor((x + range) / T));
      const gy0 = Math.max(0, Math.floor((y - range) / T)), gy1 = Math.min(this.h - 1, Math.floor((y + range) / T));
      const out = [];
      for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) {
        if (this.grid[gy][gx] === MAT.MIRROR) {
          const cx = gx * T + T / 2, cy = gy * T + T / 2;
          if (VG.dist(cx, cy, x, y) <= range) out.push({ x: cx, y: cy });
        }
      }
      return out;
    }
  }

  VG.Room = Room;
  VG.MAT = MAT;
  VG.SOLID = SOLID;
  VG.NOWALK = NOWALK;
  VG.PORTALABLE = PORTALABLE;
  VG.REFLECT = REFLECT;
  VG.BIOMES = BIOMES;
})();
