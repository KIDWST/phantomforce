/* VESPERGATE — portal.js
 * The Vesper Hand: two linked gates (Dawn, Dusk) with REAL basis-transform
 * teleportation. An entity crossing a gate has its position AND velocity
 * mapped from the entry gate's local frame into the exit gate's frame — not
 * snapped to a point. Momentum magnitude is preserved (mechanics may modify).
 *
 * Gates live on axis-aligned wall surfaces with an orientation normal. The
 * transform composes: world->entryLocal, mirror across the linked pair,
 * entryLocal->exitWorld, so a shot entering a floor gate leftward can exit a
 * wall gate upward with correct redirected velocity.
 */
"use strict";
(() => {
  const VG = window.VG;

  // Gate normals as unit vectors. A gate sits ON a surface; its normal points
  // into the open space the player/projectile travels through.
  const NORMALS = {
    up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 },
  };

  class Gate {
    constructor(endpoint) {
      this.endpoint = endpoint;   // 0 = Dawn, 1 = Dusk
      this.active = false;
      this.x = 0; this.y = 0;     // center of the gate mouth
      this.dir = "up";            // surface normal direction
      this.half = 20;             // half-length of the mouth along the surface
      this.open = 0;              // 0..1 open animation
      this.glyphPhase = 0;
    }
    get nx() { return NORMALS[this.dir].x; }
    get ny() { return NORMALS[this.dir].y; }
    // tangent along the surface (perpendicular to normal)
    get tx() { return -NORMALS[this.dir].y; }
    get ty() { return NORMALS[this.dir].x; }
  }

  class PortalSystem {
    constructor() {
      this.gates = [new Gate(0), new Gate(1)];
      this.selected = 0;
      this.strain = 0;          // 0..1
      this.collapseLock = 0;    // seconds until gates can be replaced
      this.cooldown = new Map(); // entity -> time until it can re-teleport
    }
    reset() { this.gates.forEach((g) => { g.active = false; g.open = 0; }); this.strain = 0; this.collapseLock = 0; this.cooldown.clear(); }
    get dawn() { return this.gates[0]; }
    get dusk() { return this.gates[1]; }
    bothOpen() { return this.gates[0].active && this.gates[1].active; }

    place(endpoint, x, y, dir, valid) {
      if (this.collapseLock > 0) return false;
      if (!valid) { VG.sfxGate(endpoint, "invalid"); return false; }
      const g = this.gates[endpoint];
      g.active = true; g.x = x; g.y = y; g.dir = dir; g.open = 0.001;
      VG.sfxGate(endpoint, "open");
      return true;
    }
    recall(endpoint) {
      const g = this.gates[endpoint];
      if (g.active) { g.active = false; g.open = 0; VG.sfxGate(endpoint, "close"); }
    }
    vent() {
      let any = false;
      for (const g of this.gates) if (g.active) { g.active = false; g.open = 0; any = true; }
      if (any) VG.sfxGate(0, "close");
      this.strain = Math.max(0, this.strain - 0.7);
      this.cooldown.clear();
      return any;
    }
    collapse() {
      // deliberate/critical collapse: shockwave handled by caller
      this.gates.forEach((g) => { g.active = false; g.open = 0; });
      this.strain = 0;
      this.collapseLock = 1.1;
      VG.sfxBell(140, 0.14);
    }
    addStrain(v) {
      this.strain = VG.clamp(this.strain + v, 0, 1);
      if (this.strain >= 1) return true; // signals critical
      return false;
    }

    update(dt) {
      for (const g of this.gates) {
        if (g.active) g.open = Math.min(1, g.open + dt * 6);
        g.glyphPhase += dt * (g.endpoint === 0 ? 1.4 : -1.1);
      }
      if (this.collapseLock > 0) this.collapseLock = Math.max(0, this.collapseLock - dt);
      // strain slowly self-heals
      this.strain = Math.max(0, this.strain - dt * 0.06);
      for (const [k, v] of this.cooldown) { const nv = v - dt; if (nv <= 0) this.cooldown.delete(k); else this.cooldown.set(k, nv); }
    }

    /* Core: given an entity {x,y,vx,vy,r}, if it crosses the plane of an
     * active gate (moving inward through the mouth), transform it to the other
     * gate. Returns true if teleported. `key` identifies the entity for the
     * anti-oscillation cooldown. */
    tryTeleport(ent, key, opts = {}) {
      if (!this.bothOpen()) return false;
      if (this.cooldown.has(key)) return false;
      for (let i = 0; i < 2; i++) {
        const inG = this.gates[i], outG = this.gates[1 - i];
        if (inG.open < 0.6 && !opts.force) continue;
        // signed distance from gate plane (positive = in front, along normal)
        const relx = ent.x - inG.x, rely = ent.y - inG.y;
        const along = relx * inG.nx + rely * inG.ny;       // distance out from surface
        const tan = relx * inG.tx + rely * inG.ty;          // position along mouth
        if (Math.abs(tan) > inG.half) continue;             // outside the mouth width
        // moving into the gate: velocity opposes the normal, and entity is at/near plane
        const vn = ent.vx * inG.nx + ent.vy * inG.ny;
        const r = ent.r || 3;
        if (along > r + 2 || along < -r - 6) continue;      // not touching plane
        if (vn > -0.01 && !opts.force) continue;            // not moving inward
        // decompose velocity into entry frame
        const vAlong = vn;                                   // along -normal (negative)
        const vTan = ent.vx * inG.tx + ent.vy * inG.ty;
        // exit frame: emerge along exit normal, keep tangential sign
        ent.x = outG.x + outG.nx * (r + 3) + outG.tx * tan;
        ent.y = outG.y + outG.ny * (r + 3) + outG.ty * tan;
        const speedAlong = -vAlong;                          // now moving OUT of exit
        ent.vx = outG.nx * speedAlong + outG.tx * vTan;
        ent.vy = outG.ny * speedAlong + outG.ty * vTan;
        // cooldown keyed to entity, both gates
        this.cooldown.set(key, 0.12);
        const strainBump = (opts.strain != null ? opts.strain : 0.05);
        const critical = this.addStrain(strainBump);
        VG.sfxGate(1 - i, "cross");
        ent._foldCount = (ent._foldCount || 0) + 1;
        ent._lastExit = 1 - i;
        return critical ? "critical" : true;
      }
      return false;
    }
  }

  VG.PortalSystem = PortalSystem;
  VG.portalNormals = NORMALS;
})();
