/* PhantomForce — the Phantom: an animated character, not a blob.
   A mischievous little villain specter drawn in the hologram-particle style:
   bent hood tip, ragged tendril hem, two orbiting wisp flames — and a real
   FACE: big glowing eyes with darting pupils, heavy acting eyebrows, and a
   smirk that morphs into grins, snarls, and talk. Face parameters lerp
   toward per-mood targets so every expression change plays as animation.
   Shared by the public landing page and the admin console. */

const GA = 2.399963229728653;
const TAU = Math.PI * 2;

export const ACCENTS = {
  calm: [65, 255, 161],
  happy: [132, 255, 207],
  bright: [30, 240, 255],
  alert: [255, 92, 116],
};

/* mood → face targets. browA: inner-end-down furrow (villain V). smirk: one
   corner up. browSplit: one brow arched higher (plotting). lid: eye openness. */
const FACE = {
  idle:      { browY: 0.10, browA: 0.20, browSplit: 0.00, lid: 0.85, curve: 0.30, open: 0.05, wide: 0.90, smirk: 0.55, tilt: 0.035 },
  listening: { browY: 0.17, browA: -0.10, browSplit: 0.00, lid: 1.00, curve: 0.12, open: 0.24, wide: 0.55, smirk: 0.10, tilt: -0.02 },
  thinking:  { browY: 0.12, browA: 0.30, browSplit: 0.16, lid: 0.70, curve: 0.12, open: 0.04, wide: 0.60, smirk: 0.40, tilt: 0.06 },
  talking:   { browY: 0.13, browA: 0.12, browSplit: 0.00, lid: 0.92, curve: 0.34, open: 0.30, wide: 1.00, smirk: 0.45, tilt: 0.00 },
  menace:    { browY: 0.02, browA: 0.60, browSplit: 0.00, lid: 0.55, curve: 0.50, open: 0.16, wide: 1.10, smirk: 0.75, tilt: 0.05 },
  happy:     { browY: 0.15, browA: 0.05, browSplit: 0.00, lid: 0.62, curve: 0.62, open: 0.12, wide: 1.05, smirk: 0.50, tilt: -0.03 },
};

function emotionAdjust(T, emotion) {
  const o = { ...T };
  if (emotion === "happy") { o.curve += 0.2; o.lid *= 0.85; o.browY += 0.03; }
  if (emotion === "bright") { o.browY += 0.05; o.lid = Math.min(1, o.lid + 0.15); o.curve += 0.08; }
  if (emotion === "alert") { o.browA += 0.4; o.lid *= 0.72; o.curve = Math.min(o.curve, -0.28); o.open += 0.1; o.smirk = 0.1; }
  return o;
}

export function createPhantomCharacter({ small = false } = {}) {
  /* ---- particle body: hood tip, dome head, cloak, ragged tendril hem ---- */
  const N = small ? 750 : 1350;
  const pts = [];
  for (let k = 0; k < N; k++) {
    const v = k / (N - 1);
    const ang = k * GA;
    const tend = Math.pow(0.5 + 0.5 * Math.cos(ang * 7), 1.7);
    const hemY = -0.6 - tend * 1.05;
    let R, y;
    if (v < 0.07) { const u = v / 0.07; R = 0.05 + u * 0.32; y = 1.5 + (1 - u) * 0.42; }              // bent hood tip
    else if (v < 0.32) { const u = (v - 0.07) / 0.25; R = Math.sin((0.35 + 0.65 * u) * Math.PI / 2); y = 1.5 - u * 0.9; }  // head dome
    else if (v < 0.6) { const u = (v - 0.32) / 0.28; R = 1 - 0.05 * Math.sin(u * Math.PI); y = 0.6 - u; }                  // cloak
    else { const u = (v - 0.6) / 0.4; R = 1 - 0.16 * u; y = -0.4 + u * (hemY + 0.4); }                                     // tendrils
    const bend = 0.34 * Math.pow(Math.max(0, 1 - v / 0.2), 2);                                        // hood curls to one side
    const rr = R * (0.9 + 0.1 * (((k * 9301) % 233) / 233));
    pts.push({ x: Math.cos(ang) * rr + bend, y, z: Math.sin(ang) * rr * 0.58 });
  }

  /* ---- animated face state (lerped toward mood targets) ---- */
  const E = { ...FACE.idle };
  let blinkT = 2.5, dartT = 2, dartX = 0, dartY = 0;

  const draw = (ctx2, o) => {
    const { t, dt, cx, cy, scale, mood, emotion, pulse, px, py } = o;
    const accent = ACCENTS[emotion] || ACCENTS.calm;
    const A = (a) => `rgba(${accent[0]},${accent[1]},${accent[2]},${a})`;
    const talkBeat = mood === "talking" ? Math.abs(Math.sin(t * 9.5)) : 0;
    const thinkBeat = mood === "thinking" ? Math.abs(Math.sin(t * 5.2)) : 0;

    /* face targets ease in — expression changes play as motion, not cuts */
    const T = emotionAdjust(FACE[mood] || FACE.idle, emotion);
    if (mood === "talking") T.open = 0.1 + talkBeat * 0.42;
    const rate = Math.min(1, dt * 9);
    for (const key in E) E[key] += (T[key] - E[key]) * rate;

    /* blink + eye darts (looks around on its own when your cursor is idle) */
    blinkT -= dt; if (blinkT < -0.14) blinkT = 2.2 + ((t * 997) % 1) * 3.2;
    const blink = blinkT < 0.14 && blinkT > -0.14 ? Math.abs(blinkT / 0.14) : 1;
    dartT -= dt; if (dartT < 0) { dartT = 1.6 + ((t * 131) % 1) * 2.6; dartX = (((t * 379) % 1) - 0.5) * 1.4; dartY = (((t * 733) % 1) - 0.5) * 0.8; }
    const lookX = Math.abs(px) + Math.abs(py) > 0.02 ? px * 2 : dartX;
    const lookY = Math.abs(px) + Math.abs(py) > 0.02 ? py * 1.4 : dartY;

    const breath = 1 + Math.sin(t * 0.9) * 0.025 + pulse * 0.1 + talkBeat * 0.02;
    const floatY = Math.sin(t * 1.1) * 0.055 * scale * 0.07 + Math.sin(t * 3.2) * (mood === "talking" ? 0.03 : 0.01) * scale * 0.07;
    const X = (ux) => cx + ux * scale * breath;
    const Y = (uy) => cy - uy * scale * breath + floatY * 7;

    ctx2.globalCompositeOperation = "lighter";

    /* landing halo rings */
    ctx2.save();
    ctx2.translate(cx, cy + scale * 1.72 + floatY * 3);
    for (let ring = 0; ring < 3; ring++) {
      const p = (t * 0.38 + ring / 3) % 1;
      ctx2.strokeStyle = A((0.2 - p * 0.15) * (mood === "thinking" ? 1.3 : 0.85));
      ctx2.lineWidth = 1;
      ctx2.beginPath();
      ctx2.ellipse(0, 0, scale * (0.62 + p * 0.5), scale * (0.11 + p * 0.075), 0, 0, TAU);
      ctx2.stroke();
    }
    ctx2.restore();

    /* wisp flames: two lantern spirits orbiting the phantom */
    for (const ph of [0, Math.PI]) {
      const a = t * 0.8 + ph;
      const wx = Math.cos(a) * 1.18, wy = 0.35 + Math.sin(a * 2) * 0.14, wz = Math.sin(a);
      const behind = wz > 0;
      const wr = scale * (0.055 + Math.sin(t * 7 + ph) * 0.008) * (behind ? 0.8 : 1);
      const al = behind ? 0.4 : 0.85;
      for (let tail = 3; tail >= 0; tail--) {
        const ta = a - tail * 0.13;
        const txp = X(Math.cos(ta) * 1.18), typ = Y(0.35 + Math.sin(ta * 2) * 0.14);
        const g = ctx2.createRadialGradient(txp, typ, 0, txp, typ, wr * (1 - tail * 0.18));
        g.addColorStop(0, `rgba(235,255,246,${(al - tail * 0.16) * (0.8 + pulse * 0.2)})`);
        g.addColorStop(0.5, A((al - tail * 0.16) * 0.6));
        g.addColorStop(1, A(0));
        ctx2.fillStyle = g;
        ctx2.beginPath(); ctx2.arc(txp, typ, Math.max(0.5, wr * (1 - tail * 0.18) * 2.2), 0, TAU); ctx2.fill();
      }
      void wx; void wy;
    }

    /* body: hologram particles, tendrils flowing, hem always moving */
    const rot = Math.sin(t * 0.4) * 0.35 + px * 0.7;
    const cosR = Math.cos(rot), sinR = Math.sin(rot);
    const greenMix = emotion === "alert" ? 0.5 : 1;
    const mr = Math.round(65 * greenMix + accent[0] * (1 - greenMix));
    const mg = Math.round(255 * greenMix + accent[1] * (1 - greenMix));
    const mb = Math.round(161 * greenMix + accent[2] * (1 - greenMix));
    for (const p of pts) {
      let ny = p.y;
      if (p.y < -0.2) {
        const m = Math.min(1, (-0.2 - p.y) / 1.2);
        ny = p.y + (Math.sin(p.x * 4 + t * 2.4) * 0.09 + Math.sin(p.z * 5 - t * 1.7) * 0.05) * m;
      }
      const warp = mood === "thinking" ? Math.sin(t * 6 + p.x * 4 + p.z * 3) * 0.015 : 0;
      const rx = p.x * cosR + p.z * sinR;
      const rz = -p.x * sinR + p.z * cosR;
      const depth = (rz + 1) / 2;
      const a = 0.22 + depth * 0.55 + pulse * 0.3;
      ctx2.fillStyle = `rgba(${mr},${mg},${mb},${Math.min(0.95, a)})`;
      const sz = 0.95 + depth * 1.35 + talkBeat * 0.3;
      ctx2.fillRect(X(rx + warp), Y(ny), sz, sz);
    }

    /* sparkles: little glints of magic around the cloak */
    for (let i = 0; i < 9; i++) {
      const sx = Math.sin(i * 2.4) * 1.35, sy = 0.2 + Math.cos(i * 1.7) * 1.15;
      const tw = Math.pow(Math.max(0, Math.sin(t * 1.3 + i * 2.1)), 3) * 0.8;
      if (tw < 0.05) continue;
      const spx = X(sx), spy = Y(sy), sl = scale * 0.03 * tw;
      ctx2.strokeStyle = A(tw);
      ctx2.lineWidth = 1;
      ctx2.beginPath();
      ctx2.moveTo(spx - sl, spy); ctx2.lineTo(spx + sl, spy);
      ctx2.moveTo(spx, spy - sl); ctx2.lineTo(spx, spy + sl);
      ctx2.stroke();
    }

    /* ================= the FACE — where the acting happens ================= */
    const faceCx = cx + (0.06 * cosR) * scale * breath;
    const tilt = E.tilt + Math.sin(t * 0.8) * 0.012;
    ctx2.save();
    ctx2.translate(faceCx, Y(0.9));
    ctx2.rotate(tilt);

    const s = scale * breath;
    const lid = Math.max(0.08, E.lid * blink - thinkBeat * 0.05);

    /* eyebrows: heavy, glowing, expressive — they sell every emotion */
    ctx2.lineCap = "round";
    ctx2.shadowColor = A(0.9);
    ctx2.shadowBlur = 10 + pulse * 8;
    for (const side of [-1, 1]) {
      const raise = side === -1 ? E.browSplit : 0;                     // one brow arches when plotting
      const byIn = -(0.30 + E.browY + raise) * s + E.browA * 0.22 * s; // inner end drops on a furrow
      const byOut = -(0.30 + E.browY + raise) * s - E.browA * 0.10 * s;
      ctx2.strokeStyle = A(0.95);
      ctx2.lineWidth = s * 0.055;
      ctx2.beginPath();
      ctx2.moveTo(side * 0.10 * s, byIn);
      ctx2.quadraticCurveTo(side * 0.28 * s, byIn - 0.06 * s * (1 - E.browA), side * 0.45 * s, byOut);
      ctx2.stroke();
    }

    /* eyes: big almond glows with dark darting pupils + a spark of life */
    for (const side of [-1, 1]) {
      const exc = side * 0.30 * s;
      const ew = 0.205 * s;
      const eh = 0.135 * s * lid;
      ctx2.save();
      ctx2.translate(exc, -0.10 * s);
      ctx2.rotate(side * -0.10 + side * -E.browA * 0.18);               // outer-corner lift; furrow slants them in
      const eg = ctx2.createRadialGradient(0, 0, 0, 0, 0, ew);
      eg.addColorStop(0, `rgba(238,255,248,${0.95 + pulse * 0.05})`);
      eg.addColorStop(0.55, A(0.85));
      eg.addColorStop(1, A(0.12));
      ctx2.fillStyle = eg;
      ctx2.beginPath();
      ctx2.moveTo(-ew, 0);
      ctx2.quadraticCurveTo(0, -eh * 1.6, ew, 0);
      ctx2.quadraticCurveTo(0, eh * 1.25, -ew, 0);
      ctx2.fill();
      /* pupil: dark, tracks the cursor (or wanders on its own) */
      const pxp = Math.max(-1, Math.min(1, lookX)) * ew * 0.42;
      const pyp = Math.max(-1, Math.min(1, lookY)) * eh * 0.5;
      ctx2.shadowBlur = 0;
      ctx2.fillStyle = "rgba(2,12,9,0.92)";
      ctx2.beginPath(); ctx2.ellipse(pxp, pyp, eh * 0.62, eh * 0.62 * 1.15, 0, 0, TAU); ctx2.fill();
      ctx2.fillStyle = "rgba(240,255,250,0.9)";
      ctx2.beginPath(); ctx2.arc(pxp - eh * 0.2, pyp - eh * 0.24, Math.max(0.6, eh * 0.14), 0, TAU); ctx2.fill();
      ctx2.shadowColor = A(0.9);
      ctx2.shadowBlur = 10 + pulse * 8;
      ctx2.restore();
    }

    /* mouth: smirk ↔ grin ↔ snarl ↔ talk, with little fangs on a real grin */
    const mw = 0.46 * E.wide * s;
    const mY = 0.32 * s;
    const cornL = E.smirk * 0.05 * s;                                   // left corner sags a little…
    const cornR = -E.smirk * 0.085 * s;                                 // …right corner curls up: the smirk
    const topC = -E.curve * 0.16 * s - E.open * 0.05 * s;
    const botC = E.open * 0.36 * s + Math.max(0, E.curve) * 0.03 * s;
    ctx2.save();
    ctx2.translate(0.03 * s, mY);
    ctx2.beginPath();
    ctx2.moveTo(-mw, cornL);
    ctx2.quadraticCurveTo(0, topC, mw, cornR);
    ctx2.quadraticCurveTo(0, botC + Math.max(0, E.curve) * 0.1 * s, -mw, cornL);
    ctx2.closePath();
    if (E.open > 0.06) { ctx2.fillStyle = "rgba(1,8,6,0.88)"; ctx2.fill(); }
    ctx2.strokeStyle = A(0.92);
    ctx2.lineWidth = Math.max(1.2, s * 0.032);
    ctx2.stroke();
    /* fangs */
    if (E.curve > 0.3 && E.open > 0.07) {
      ctx2.fillStyle = "rgba(240,255,250,0.92)";
      for (const fx of [-mw * 0.42, mw * 0.34]) {
        const fy = topC * 0.5 + (cornR + cornL) * 0.25;
        ctx2.beginPath();
        ctx2.moveTo(fx - s * 0.024, fy);
        ctx2.lineTo(fx + s * 0.024, fy);
        ctx2.lineTo(fx, fy + s * 0.055);
        ctx2.closePath();
        ctx2.fill();
      }
    }
    ctx2.restore();

    ctx2.shadowBlur = 0;
    ctx2.restore();
    ctx2.globalCompositeOperation = "source-over";
  };

  return { draw };
}
