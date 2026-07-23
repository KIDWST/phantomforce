/* VESPERGATE: LIVING DARKNESS — effects.js
 * Screen-space lighting/darkness engine, atmosphere motes, shockwaves, and
 * hit-stop. Sits on top of the existing renderer without touching how rooms
 * or entities draw themselves: it punches light through an otherwise
 * near-black overlay in logical (pre-HD-scale) screen space, once per frame,
 * after the camera transform has been reset. Callers push lights fresh each
 * frame (per-frame lists, not persistent state) then call renderDarkness().
 */
"use strict";
window.VG = window.VG || {};
(() => {
  const VG = window.VG;

  const maskCv = document.createElement("canvas");
  const mctx = maskCv.getContext("2d");

  // One generic radial-alpha sprite, scaled per-light via drawImage — since
  // destination-out only reads source alpha, a single cached sprite covers
  // every radius/color combination.
  const SPR = 128;
  const sprite = document.createElement("canvas");
  sprite.width = SPR; sprite.height = SPR;
  (() => {
    const c = sprite.getContext("2d");
    const g = c.createRadialGradient(SPR / 2, SPR / 2, 0, SPR / 2, SPR / 2, SPR / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.55, "rgba(255,255,255,0.7)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g; c.fillRect(0, 0, SPR, SPR);
  })();

  let lights = [];
  let t = 0;

  const fx = {
    DARK_BIOMES: new Set(["dungeon", "ossuary"]),

    pushLight(wx, wy, radius, opts = {}) {
      lights.push({
        wx, wy, radius,
        flicker: opts.flicker !== false,
        seed: opts.seed != null ? opts.seed : (wx * 13 + wy * 7),
        boost: opts.boost || 1,
      });
    },
    clearLights() { lights.length = 0; },

    tick(dt) {
      t += dt;
      fx._updateShockwaves(dt);
      fx._updateAtmosphere(dt);
      fx._hitStopT = Math.max(0, fx._hitStopT - dt);
    },

    /* ---------------- hit-stop ---------------- */
    _hitStopT: 0,
    hitStop(sec) { fx._hitStopT = Math.max(fx._hitStopT, sec); },
    scaleDt(dt) { return fx._hitStopT > 0 ? dt * 0.06 : dt; },

    /* ---------------- darkness + lights ---------------- */
    renderDarkness(ctx, cam, fillStyle) {
      if (maskCv.width !== VG.W || maskCv.height !== VG.H) { maskCv.width = VG.W; maskCv.height = VG.H; }
      mctx.globalCompositeOperation = "source-over";
      mctx.clearRect(0, 0, VG.W, VG.H);
      mctx.fillStyle = fillStyle;
      mctx.fillRect(0, 0, VG.W, VG.H);
      mctx.globalCompositeOperation = "destination-out";
      const z = cam.zoom || 1;
      for (const L of lights) {
        const sx = (L.wx - cam.x) * z, sy = (L.wy - cam.y) * z;
        const flick = L.flicker ? 0.82 + Math.sin(t * 9 + L.seed) * 0.14 : 1;
        const r = L.radius * z * flick * L.boost;
        if (sx < -r || sx > VG.W + r || sy < -r || sy > VG.H + r) continue;
        mctx.drawImage(sprite, sx - r, sy - r, r * 2, r * 2);
      }
      mctx.globalCompositeOperation = "source-over";
      ctx.drawImage(maskCv, 0, 0);
      fx.clearLights();
    },

    /* ---------------- shockwaves (bell tolls, boss phase hits) ---------------- */
    _shocks: [],
    spawnShockwave(wx, wy, opts = {}) {
      fx._shocks.push({
        x: wx, y: wy, r: opts.r0 || 4, vr: opts.speed || 130,
        maxR: opts.maxR || 260, color: opts.color || "255,120,90", life: 1,
      });
    },
    _updateShockwaves(dt) {
      for (const s of fx._shocks) { s.r += s.vr * dt; s.life = 1 - s.r / s.maxR; }
      fx._shocks = fx._shocks.filter((s) => s.life > 0);
    },
    drawShockwaves(ctx) {
      for (const s of fx._shocks) {
        ctx.strokeStyle = `rgba(${s.color},${Math.max(0, s.life * 0.6)})`;
        ctx.lineWidth = 2 + s.life * 3;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.stroke();
      }
    },

    /* ---------------- atmosphere: dust motes drifting through light ---------------- */
    _motes: [],
    seedAtmosphere(cam, biome) {
      const target = fx.DARK_BIOMES.has(biome) ? 26 : 0;
      if (target === 0) { if (fx._motes.length) fx._motes.length = 0; return; }
      while (fx._motes.length < target) {
        fx._motes.push({
          x: cam.x + Math.random() * VG.W, y: cam.y + Math.random() * VG.H,
          vy: -3 - Math.random() * 4, sway: Math.random() * Math.PI * 2,
          r: 0.6 + Math.random() * 1.1, life: 4 + Math.random() * 6,
        });
      }
    },
    _updateAtmosphere(dt) {
      for (const m of fx._motes) { m.y += m.vy * dt; m.sway += dt * 0.6; m.x += Math.sin(m.sway) * 4 * dt; m.life -= dt; }
      fx._motes = fx._motes.filter((m) => m.life > 0);
    },
    drawAtmosphere(ctx, cam) {
      for (const m of fx._motes) {
        if (m.x < cam.x - 10 || m.x > cam.x + VG.W + 10 || m.y < cam.y - 10 || m.y > cam.y + VG.H + 10) continue;
        ctx.globalAlpha = Math.min(1, m.life) * 0.22;
        ctx.fillStyle = "#cdd8ff";
        ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
  };

  VG.fx = fx;
})();
