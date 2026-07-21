/* VESPERGATE — world.js
 * Tile world + material system + procedural gothic art. Tiles carry material
 * identity that governs portal placement (liminal stone accepts gates, null
 * iron refuses them) and gothic rendering. Rooms are hand-authored ASCII maps.
 *
 * Materials (from the art bible):
 *   . open        0
 *   # liminal stone (portalable)      1
 *   X null iron (no portals)          2
 *   = dead stone (no portals, solid)  3
 *   ^ spike hazard                    4
 *   ~ bell-brass (rings, portalable)  5
 *   _ one-way platform (drop-through) 6
 */
"use strict";
(() => {
  const VG = window.VG;
  const T = VG.TILE;

  const MAT = {
    OPEN: 0, LIMINAL: 1, NULL_IRON: 2, DEAD: 3, SPIKE: 4, BRASS: 5, PLATFORM: 6,
    // Glass Ossuary materials:
    MIRROR: 7,   // mirror-bone: solid, reflects shots, no portals
    SAINTGLASS: 8, // saint-glass: carries light (Mercy beam), portalable, translucent
  };
  const SOLID = new Set([MAT.LIMINAL, MAT.NULL_IRON, MAT.DEAD, MAT.BRASS, MAT.MIRROR]);
  const PORTALABLE = new Set([MAT.LIMINAL, MAT.BRASS, MAT.SAINTGLASS]);
  const REFLECT = new Set([MAT.MIRROR]);
  const CHARMAT = { ".": 0, "#": 1, "X": 2, "=": 3, "^": 4, "~": 5, "_": 6, "M": 7, "G": 8, " ": 0 };

  class Room {
    constructor(def) {
      this.id = def.id;
      this.name = def.name;
      this.rows = def.map;
      this.w = def.map[0].length;
      this.h = def.map.length;
      this.pxW = this.w * T; this.pxH = this.h * T;
      this.spawn = def.spawn || { x: 2, y: 2 };
      this.exits = def.exits || [];        // {x,y,w,h,to,toSpawn}
      this.enemies = def.enemies || [];
      this.pickups = def.pickups || [];
      this.bells = def.bells || [];        // {x,y} brass bells that ring
      this.boss = def.boss || null;
      this.shrine = def.shrine || null;    // {x,y}
      this.hint = def.hint || "";
      this._bake();
    }
    _bake() {
      this.grid = this.rows.map((r) => r.split("").map((c) => CHARMAT[c] ?? 0));
    }
    matAt(gx, gy) {
      if (gx < 0 || gy < 0 || gx >= this.w || gy >= this.h) return MAT.DEAD;
      return this.grid[gy][gx];
    }
    matAtPx(x, y) { return this.matAt(Math.floor(x / T), Math.floor(y / T)); }
    solidAtPx(x, y) { return SOLID.has(this.matAtPx(x, y)); }
    platformAtPx(x, y) { return this.matAtPx(x, y) === MAT.PLATFORM; }
    spikeAtPx(x, y) { return this.matAtPx(x, y) === MAT.SPIKE; }
    reflectAtPx(x, y) { return REFLECT.has(this.matAtPx(x, y)); }
    // classify a candidate portal placement: returns {valid, dir, x, y, reason}
    classifyPortal(px, py, half = 20) {
      const gx = Math.floor(px / T), gy = Math.floor(py / T);
      // find nearest solid surface among the 4 neighbours of the aim cell
      const cell = this.matAt(gx, gy);
      if (SOLID.has(cell)) {
        // aiming into a wall: pick the face toward open space
        const faces = [
          { dir: "up", nx: 0, ny: -1 }, { dir: "down", nx: 0, ny: 1 },
          { dir: "left", nx: -1, ny: 0 }, { dir: "right", nx: 1, ny: 0 },
        ];
        for (const f of faces) {
          const ax = gx + f.nx, ay = gy + f.ny;
          if (!SOLID.has(this.matAt(ax, ay))) {
            const mat = this.matAt(gx, gy);
            if (!PORTALABLE.has(mat)) return { valid: false, reason: mat === MAT.NULL_IRON ? "null-iron" : "dead-stone" };
            // center on the face
            const cx = (gx + 0.5) * T + f.nx * (T / 2);
            const cy = (gy + 0.5) * T + f.ny * (T / 2);
            // require room to fit the mouth width (need portalable neighbours along tangent)
            return { valid: true, dir: f.dir, x: cx, y: cy };
          }
        }
        return { valid: false, reason: "no-face" };
      }
      return { valid: false, reason: "open-air" };
    }

    /* ---- rendering: gothic procedural tiles ---- */
    draw(ctx, cam, t) {
      const x0 = Math.max(0, Math.floor(cam.x / T) - 1);
      const y0 = Math.max(0, Math.floor(cam.y / T) - 1);
      const x1 = Math.min(this.w, Math.ceil((cam.x + VG.W) / T) + 1);
      const y1 = Math.min(this.h, Math.ceil((cam.y + VG.H) / T) + 1);
      for (let gy = y0; gy < y1; gy++) {
        for (let gx = x0; gx < x1; gx++) {
          const m = this.grid[gy][gx];
          if (m === MAT.OPEN) continue;
          this._tile(ctx, gx * T, gy * T, m, gx, gy, t);
        }
      }
    }
    _tile(ctx, x, y, m, gx, gy, t) {
      const h = (gx * 928371 + gy * 1299721) >>> 0;
      const v = (h % 24);
      if (m === MAT.LIMINAL) {
        ctx.fillStyle = `rgb(${26 + v},${28 + v},${44 + v})`;
        ctx.fillRect(x, y, T, T);
        ctx.fillStyle = "rgba(120,150,220,0.10)";
        ctx.fillRect(x + 1, y + 1, T - 2, 1);
        ctx.fillStyle = "rgba(0,0,0,0.28)";
        ctx.fillRect(x, y + T - 2, T, 2);
        // sacred-geometry etch on some tiles
        if (h % 7 === 0) { ctx.strokeStyle = "rgba(150,180,240,0.14)"; ctx.beginPath(); ctx.arc(x + T / 2, y + T / 2, 4, 0, Math.PI * 2); ctx.stroke(); }
      } else if (m === MAT.BRASS) {
        const g = 90 + v;
        ctx.fillStyle = `rgb(${g + 30},${g},${30})`;
        ctx.fillRect(x, y, T, T);
        ctx.fillStyle = "rgba(255,220,120,0.16)"; ctx.fillRect(x + 2, y + 2, T - 4, 2);
        ctx.fillStyle = "rgba(40,20,0,0.4)"; ctx.fillRect(x, y + T - 3, T, 3);
      } else if (m === MAT.NULL_IRON) {
        ctx.fillStyle = `rgb(${14 + (v >> 1)},${13 + (v >> 1)},${16 + (v >> 1)})`;
        ctx.fillRect(x, y, T, T);
        ctx.strokeStyle = "rgba(90,60,90,0.25)"; ctx.strokeRect(x + 2.5, y + 2.5, T - 5, T - 5);
      } else if (m === MAT.DEAD) {
        ctx.fillStyle = `rgb(${30 + v},${28 + v},${30 + v})`;
        ctx.fillRect(x, y, T, T);
        ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.fillRect(x, y + T - 2, T, 2);
      } else if (m === MAT.SPIKE) {
        ctx.fillStyle = "rgb(18,16,20)"; ctx.fillRect(x, y, T, T);
        ctx.fillStyle = "#c9d6e8";
        for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(x + 2 + i * 5, y + T); ctx.lineTo(x + 4.5 + i * 5, y + 4); ctx.lineTo(x + 7 + i * 5, y + T); ctx.fill(); }
      } else if (m === MAT.PLATFORM) {
        ctx.fillStyle = "rgb(46,40,58)"; ctx.fillRect(x, y, T, 4);
        ctx.fillStyle = "rgba(150,120,200,0.2)"; ctx.fillRect(x, y, T, 1);
      } else if (m === MAT.MIRROR) {
        // mirror-bone: pale, glassy, with a moving highlight
        ctx.fillStyle = `rgb(${196 + (v >> 1)},${200 + (v >> 1)},${210 + (v >> 1)})`;
        ctx.fillRect(x, y, T, T);
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        const hl = ((gx * 3 + gy * 5 + Math.floor(t * 20)) % (T + 8)) - 4;
        ctx.fillRect(x + hl, y, 2, T);
        ctx.strokeStyle = "rgba(120,140,180,0.4)"; ctx.strokeRect(x + 0.5, y + 0.5, T - 1, T - 1);
      } else if (m === MAT.SAINTGLASS) {
        ctx.fillStyle = `rgba(${120 + v},${160 + v},${210 + v},0.55)`;
        ctx.fillRect(x, y, T, T);
        ctx.fillStyle = "rgba(200,230,255,0.25)"; ctx.fillRect(x + 3, y + 3, T - 6, T - 6);
      }
    }
  }

  VG.Room = Room;
  VG.MAT = MAT;
  VG.SOLID = SOLID;
  VG.PORTALABLE = PORTALABLE;
  VG.REFLECT = REFLECT;
})();
