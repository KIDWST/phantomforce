/* PhantomForce — the Phantom, built to match the reference art:
   a hooded emerald hologram specter. The hood frames a DARK void of a face
   where only the fierce slanted eyes and a clean crescent smile glow. Real
   sleeves end in real hands with fingers — the right hand held up conjuring
   a green flame orb, the left offered open to the viewer. An ornate diamond
   amulet glows at the chest. The body is thousands of particles with a
   bright hood rim, smoky interior, and a ragged dissolving hem, rising out
   of a circuit summoning ring.

   Under the skin: classic animation principles. Underdamped springs drive
   every face and arm parameter (overshoot + settle), squash & stretch is
   volume-preserving, and the emotions are over-emoted on purpose — puppy-
   brow sadness with a falling tear, delighted arc eyes, launched brows and
   an O gasp for surprise, a proper villain furrow for menace. When idle it
   performs a looping show: conjure → cross arms → wink → wave → laugh →
   hologram sway. Real moods interrupt instantly. Shared by both sites. */

const GA = 2.399963229728653;
const TAU = Math.PI * 2;

export const ACCENTS = {
  calm: [65, 255, 161],
  happy: [132, 255, 207],
  bright: [96, 255, 140],
  alert: [255, 92, 116],
  sad: [58, 200, 158],
  excited: [132, 255, 207],
  surprised: [96, 255, 140],
};

const FACE = {
  idle:      { browY: 0.10, browA: 0.24, browSad: 0, browSplit: 0.00, lid: 0.85, eyeHappy: 0.0, curve: 0.34, open: 0.04, wide: 1.00, smirk: 0.35, tilt: 0.03, squash: 0.00, drop: 0.00 },
  listening: { browY: 0.17, browA: -0.10, browSad: 0, browSplit: 0.00, lid: 1.00, eyeHappy: 0.0, curve: 0.12, open: 0.24, wide: 0.55, smirk: 0.10, tilt: -0.02, squash: 0.05, drop: 0.00 },
  thinking:  { browY: 0.12, browA: 0.30, browSad: 0, browSplit: 0.16, lid: 0.70, eyeHappy: 0.0, curve: 0.12, open: 0.04, wide: 0.60, smirk: 0.40, tilt: 0.06, squash: 0.00, drop: 0.02 },
  talking:   { browY: 0.13, browA: 0.12, browSad: 0, browSplit: 0.00, lid: 0.92, eyeHappy: 0.0, curve: 0.34, open: 0.30, wide: 1.00, smirk: 0.35, tilt: 0.00, squash: 0.05, drop: 0.00 },
  menace:    { browY: 0.02, browA: 0.60, browSad: 0, browSplit: 0.00, lid: 0.55, eyeHappy: 0.0, curve: 0.50, open: 0.16, wide: 1.10, smirk: 0.65, tilt: 0.05, squash: 0.15, drop: 0.00 },
  happy:     { browY: 0.20, browA: 0.00, browSad: 0, browSplit: 0.00, lid: 0.75, eyeHappy: 0.85, curve: 0.75, open: 0.18, wide: 1.10, smirk: 0.30, tilt: -0.03, squash: 0.30, drop: 0.00 },
  sad:       { browY: 0.06, browA: -0.05, browSad: 0.95, browSplit: 0.00, lid: 0.55, eyeHappy: 0.0, curve: -0.55, open: 0.05, wide: 0.70, smirk: 0.00, tilt: 0.08, squash: -0.85, drop: 0.16 },
  surprised: { browY: 0.32, browA: -0.25, browSad: 0, browSplit: 0.00, lid: 1.30, eyeHappy: 0.0, curve: 0.02, open: 0.60, wide: 0.45, smirk: 0.00, tilt: 0.00, squash: 0.35, drop: -0.06 },
  excited:   { browY: 0.24, browA: -0.05, browSad: 0, browSplit: 0.00, lid: 1.05, eyeHappy: 0.4, curve: 0.70, open: 0.34, wide: 1.15, smirk: 0.15, tilt: -0.02, squash: 0.50, drop: 0.00 },
};

function applyEmotion(T, emotion, mood) {
  const o = { ...T };
  const idleish = mood === "idle" || mood === "happy";
  if (["sad", "surprised", "excited", "happy"].includes(emotion) && idleish) return { ...FACE[emotion] };
  if (emotion === "happy") { o.curve += 0.2; o.lid *= 0.9; o.browY += 0.05; o.eyeHappy = Math.max(o.eyeHappy, 0.35); o.squash += 0.2; }
  if (emotion === "excited") { o.curve += 0.25; o.browY += 0.1; o.squash += 0.4; o.lid = Math.min(1.15, o.lid + 0.15); }
  if (emotion === "sad") { o.browSad = 0.9; o.curve -= 0.6; o.squash -= 0.7; o.drop += 0.12; o.lid *= 0.75; o.smirk = 0; }
  if (emotion === "surprised") { o.browY += 0.2; o.lid *= 1.25; o.open += 0.2; o.squash += 0.2; }
  if (emotion === "bright") { o.browY += 0.05; o.lid = Math.min(1.1, o.lid + 0.15); o.curve += 0.08; }
  if (emotion === "alert") { o.browA += 0.4; o.lid *= 0.72; o.curve = Math.min(o.curve, -0.28); o.open += 0.1; o.smirk = 0.1; }
  return o;
}

/* arm poses: wrist targets in unit space (right side; hL/aL override left).
   hand: "open" (fingers fanned) or "curl" (relaxed cup). a = hand angle
   offset from the arm's own direction, radians. The default pose is the
   reference art: right hand raised conjuring the flame, left offered open. */
/* a = absolute screen angle of the fingers (radians, 0=right, +down);
   the right hand's default is palm-up conjuring, the left is offered open */
const ARMS = {
  conjure: { h: [0.90, 0.52], hand: "cup", a: -1.57, hL: [-0.84, -0.14], handL: "open", aL: 2.1 },
  cross:   { h: [-0.14, 0.14], hand: "curl", a: 2.8, hL: [0.16, 0.02], handL: "curl", aL: 0.35 },
  wave:    { h: [1.02, 0.84], hand: "open", a: -1.45, hL: [-0.84, -0.14], handL: "open", aL: 2.1 },
  cheer:   { h: [0.62, 0.70], hand: "open", a: -1.57, hL: [-0.62, 0.70], handL: "open", aL: -1.57 },
  talk:    { h: [0.74, -0.02], hand: "open", a: -0.5, hL: [-0.74, -0.02], handL: "open", aL: 3.6 },
  chin:    { h: [0.22, 0.50], hand: "curl", a: -2.2, hL: [-0.84, -0.14], handL: "open", aL: 2.1 },
  droop:   { h: [0.58, -0.52], hand: "curl", a: 1.57, hL: [-0.58, -0.52], handL: "curl", aL: 1.57 },
  menace:  { h: [0.80, 0.30], hand: "open", a: -0.35, hL: [-0.80, 0.30], handL: "open", aL: 3.5 },
};

const SHOW = [
  { name: "idle", d: 1.8 },
  { name: "cross", d: 2.5 },
  { name: "wink", d: 1.0 },
  { name: "wave", d: 2.6 },
  { name: "laugh", d: 1.6 },
  { name: "sway", d: 2.0 },
];
const SHOW_LEN = SHOW.reduce((s, g) => s + g.d, 0);

function springStep(x, v, target, dt, K, D) {
  v += ((target - x) * K - D * v) * dt;
  return [x + v * dt, v];
}

/* face void: the dark opening of the hood (unit space) */
const VOID_CX = 0, VOID_CY = 0.95, VOID_RX = 0.46, VOID_RY = 0.53;

export function createPhantomCharacter({ small = false } = {}) {
  /* ---- particle body straight from the reference silhouette ---- */
  const N = small ? 900 : 1600;
  const pts = [];
  const hash = (k, m) => ((k * m) % 233) / 233;
  const pushPt = (x, y, z, dim) => pts.push({ x, y, z, dim });
  const NHOOD = (N * 0.30) | 0, NSH = (N * 0.16) | 0, NROBE = (N * 0.34) | 0, NIN = N - NHOOD - NSH - NROBE;
  for (let k = 0; k < NHOOD; k++) {                     // hood: pointed peak → rim, opening pushed to a bright rim
    const t = k / NHOOD, ang = k * GA;
    let y = 1.78 - Math.pow(t, 0.9) * 1.25;
    const R = (0.10 + Math.pow(t, 0.85) * 1.02) * (0.92 + 0.08 * hash(k, 9301));
    let x = Math.cos(ang) * R;
    const z = Math.sin(ang) * R * 0.6;
    if (z > 0) {
      const ex = x / VOID_RX, ey = (y - VOID_CY) / VOID_RY;
      const d = ex * ex + ey * ey;
      if (d < 1) { const f = 1 / Math.sqrt(d + 1e-4); x = ex * f * VOID_RX; y = VOID_CY + ey * f * VOID_RY; }
    }
    pushPt(x, y, z, 1);
  }
  for (let k = 0; k < NSH; k++) {                       // shoulders / cape spread
    const t = k / NSH, ang = k * GA;
    const y = 0.53 - t * 0.63;
    const R = (1.02 + Math.sin(t * Math.PI) * 0.12) * (0.9 + 0.1 * hash(k, 4241));
    pushPt(Math.cos(ang) * R, y, Math.sin(ang) * R * 0.55, 1);
  }
  for (let k = 0; k < NROBE; k++) {                     // robe → ragged dissolving hem
    const t = k / NROBE, ang = k * GA;
    const tend = Math.pow(0.5 + 0.5 * Math.cos(ang * 7), 1.7);
    const hemY = -0.55 - tend * 1.0;
    const y = -0.1 + t * (hemY + 0.1);
    const R = (1.12 - 0.22 * t) * (0.88 + 0.12 * hash(k, 6367));
    pushPt(Math.cos(ang) * R, y, Math.sin(ang) * R * 0.55, 1);
  }
  for (let k = 0; k < NIN; k++) {                       // smoky interior fill (never inside the face void)
    const u = hash(k, 127), w = hash(k, 331), ang = k * GA;
    const y = -1.1 + u * 2.55;
    const sil = y > 0.53 ? 0.10 + (1.78 - y) / 1.25 * 1.0 : y > -0.1 ? 1.05 : 1.1 - 0.2 * (-0.1 - y);
    const R = Math.max(0.05, sil) * Math.sqrt(w) * 0.85;
    const x = Math.cos(ang) * R, z = Math.sin(ang) * R * 0.6;
    if (z > 0 && (x / VOID_RX) ** 2 + ((y - VOID_CY) / VOID_RY) ** 2 < 1.05) continue;
    pushPt(x, y, z, 0.45);
  }
  /* sleeve fill points (u along sleeve, v across) */
  const SLV = [];
  for (let k = 0; k < 30; k++) SLV.push([hash(k, 197), hash(k, 89)]);

  /* ---- spring-animated state ---- */
  const E = { ...FACE.idle };
  const EV = {}; for (const k in E) EV[k] = 0;
  const arm = {
    R: { hx: 0.90, hy: 0.52, vhx: 0, vhy: 0 },
    L: { hx: -0.84, hy: -0.14, vhx: 0, vhy: 0 },
  };
  let blinkT = 2.5, dartT = 2, dartX = 0, dartY = 0;
  let born = -1, wink = 0, ringBoost = 0, swayBias = 0, flameHold = 1;

  const draw = (ctx2, o) => {
    const { t, cx, cy, scale, mood, emotion, pulse, px, py } = o;
    const dt = Math.min(0.05, Math.max(0.001, o.dt));
    if (born < 0) born = t;
    const age = t - born;
    const reveal = Math.min(1, age / 2.2);
    const settled = reveal >= 1;
    const accent = ACCENTS[emotion] || ACCENTS.calm;
    const A = (a) => `rgba(${accent[0]},${accent[1]},${accent[2]},${a})`;
    const talkBeat = mood === "talking" ? Math.abs(Math.sin(t * 9.5)) : 0;
    const thinkBeat = mood === "thinking" ? Math.abs(Math.sin(t * 5.2)) : 0;

    /* ---- acting selection: mood > emotion > idle show ---- */
    let gesture = "conjure", gLocal = 0;
    if (!settled) gesture = "conjure";
    else if (mood === "idle" || mood === "happy") {
      let gt = (age - 2.2) % SHOW_LEN;
      for (const g of SHOW) { if (gt < g.d) { gesture = g.name === "idle" || g.name === "wink" || g.name === "sway" ? "conjure" : g.name === "laugh" ? "cheer" : g.name, gLocal = gt / g.d; break; } gt -= g.d; }
      var showBeat = "idle";
      { let g2 = (age - 2.2) % SHOW_LEN; for (const g of SHOW) { if (g2 < g.d) { showBeat = g.name; break; } g2 -= g.d; } }
      if (emotion === "sad") gesture = "droop";
      if (emotion === "excited") gesture = "cheer";
    } else gesture = mood === "talking" ? "talk" : mood === "thinking" ? "chin" : mood === "menace" ? "menace" : "conjure";
    const beat = typeof showBeat === "string" ? showBeat : "idle";

    const T = applyEmotion(FACE[mood] || FACE.idle, emotion, mood);
    if (mood === "talking") T.open = 0.1 + talkBeat * 0.42;
    if (beat === "cross" && gesture === "cross") { T.browA += 0.12; T.curve += 0.06; T.smirk = 0.55; }
    if (beat === "wave") { T.curve += 0.18; T.lid = Math.min(1, T.lid + 0.1); }
    if (beat === "wink") T.curve += 0.22;
    if (beat === "laugh" && (mood === "idle" || mood === "happy")) {
      Object.assign(T, FACE.happy);
      T.open = 0.25 + Math.abs(Math.sin(t * 8)) * 0.28;
      T.squash = 0.55;
    }
    for (const key in E) {
      const [nx, nv] = springStep(E[key], EV[key], T[key], dt, 140, 11);
      E[key] = nx; EV[key] = nv;
    }

    const winkT = beat === "wink" ? Math.sin(Math.min(1, Math.max(0, (gLocal - 0.15) / 0.7)) * Math.PI) : 0;
    wink += (winkT - wink) * Math.min(1, dt * 12);
    const swayT = beat === "sway" ? Math.sin(gLocal * TAU) * 0.4 : 0;
    swayBias += (swayT - swayBias) * Math.min(1, dt * 5);
    ringBoost += (((beat === "sway" || !settled) ? 1 : 0) - ringBoost) * Math.min(1, dt * 4);
    flameHold += (((gesture === "conjure" || gesture === "chin") ? 1 : 0) - flameHold) * Math.min(1, dt * 5);

    /* arms: springs toward the pose */
    const pose = ARMS[gesture] || ARMS.conjure;
    const waveSwing = beat === "wave" ? Math.sin(t * 6.4) * 0.13 * Math.sin(Math.min(1, gLocal * 2) * Math.PI) : 0;
    const talkBob = gesture === "talk" ? Math.sin(t * 3.2) * 0.03 : 0;
    const stepJ = (j, k, target) => { const [nx, nv] = springStep(j[k], j["v" + k], target, dt, 80, 10); j[k] = nx; j["v" + k] = nv; };
    stepJ(arm.R, "hx", pose.h[0] + waveSwing); stepJ(arm.R, "hy", pose.h[1] + talkBob);
    stepJ(arm.L, "hx", pose.hL[0]); stepJ(arm.L, "hy", pose.hL[1] - talkBob);

    blinkT -= dt; if (blinkT < -0.14) blinkT = 2.2 + ((t * 997) % 1) * 3.2;
    const blink = blinkT < 0.14 && blinkT > -0.14 ? Math.abs(blinkT / 0.14) : 1;
    dartT -= dt; if (dartT < 0) { dartT = 1.6 + ((t * 131) % 1) * 2.6; dartX = (((t * 379) % 1) - 0.5) * 1.4; dartY = (((t * 733) % 1) - 0.5) * 0.8; }
    const lookX = Math.abs(px) + Math.abs(py) > 0.02 ? px * 2 : dartX;
    const lookY = Math.abs(px) + Math.abs(py) > 0.02 ? py * 1.4 : dartY;

    /* squash & stretch */
    const bounce = E.squash > 0 ? Math.sin(t * 3.6) * 0.045 * E.squash : 0;
    const bodySy = 1 + E.squash * 0.055 + bounce;
    const bodySx = 1 - (bodySy - 1) * 0.6;
    const floatAmp = 1 + E.squash * (E.squash > 0 ? 0.9 : 0.55);
    const slump = E.squash < 0 ? -E.squash * 0.11 : 0;
    const breath = (1 + Math.sin(t * 0.9) * 0.025 + pulse * 0.1 + talkBeat * 0.02) * (0.92 + reveal * 0.08);
    const floatY = (Math.sin(t * 1.1) * 0.055 * floatAmp + Math.sin(t * 3.2) * (mood === "talking" ? 0.03 : 0.01)) * scale * 0.07
      + (1 - reveal) * scale * 0.0022 * 90;
    const X = (ux) => cx + ux * scale * breath * bodySx;
    const Y = (uy) => cy - (uy - slump) * scale * breath * bodySy + floatY * 7;
    const revealY = -1.75 + reveal * 3.8;
    const faceAlpha = Math.max(0, Math.min(1, (reveal - 0.82) / 0.18));

    const rot = Math.sin(t * 0.4) * 0.3 + px * 0.6 + swayBias;
    const cosR = Math.cos(rot), sinR = Math.sin(rot);

    ctx2.globalCompositeOperation = "lighter";

    /* summoning ring + soft beam */
    ctx2.save();
    ctx2.translate(cx, cy + scale * 1.72 + floatY * 3);
    const ringA = 1 + ringBoost * 1.6;
    for (let ring = 0; ring < 4; ring++) {
      const p = (t * 0.38 + ring / 4) % 1;
      ctx2.strokeStyle = A((0.2 - p * 0.14) * ringA);
      ctx2.lineWidth = ring === 0 ? 1.6 : 1;
      ctx2.beginPath();
      ctx2.ellipse(0, 0, scale * (0.55 + p * 0.6), scale * (0.1 + p * 0.09), 0, 0, TAU);
      ctx2.stroke();
    }
    if (ringBoost > 0.05) {
      ctx2.save();
      ctx2.scale(0.42, 1.35);
      const bg = ctx2.createRadialGradient(0, -scale * 0.55, 0, 0, -scale * 0.55, scale * 0.95);
      bg.addColorStop(0, A(0.2 * ringBoost));
      bg.addColorStop(1, A(0));
      ctx2.fillStyle = bg;
      ctx2.beginPath(); ctx2.arc(0, -scale * 0.55, scale * 0.95, 0, TAU); ctx2.fill();
      ctx2.restore();
    }
    ctx2.restore();

    /* materializing data dust */
    if (!settled) {
      for (let i = 0; i < 30; i++) {
        const dx = Math.sin(i * 2.13) * 0.95;
        const p = (t * 1.5 + i * 0.37) % 1;
        const dy = -1.7 + p * (revealY + 1.75);
        ctx2.fillStyle = A((1 - reveal) * (0.7 - p * 0.4));
        ctx2.fillRect(X(dx), Y(dy), 1.6, 3.5);
      }
    }

    /* body particles */
    const greenMix = emotion === "alert" ? 0.5 : 1;
    const mr = Math.round(65 * greenMix + accent[0] * (1 - greenMix));
    const mg = Math.round(255 * greenMix + accent[1] * (1 - greenMix));
    const mb = Math.round(161 * greenMix + accent[2] * (1 - greenMix));
    const hemSpeed = emotion === "sad" ? 0.5 : 1;
    for (const p of pts) {
      if (p.y > revealY) continue;
      let ny = p.y;
      if (p.y < -0.2) {
        const m = Math.min(1, (-0.2 - p.y) / 1.2);
        ny = p.y + (Math.sin(p.x * 4 + t * 2.4 * hemSpeed) * 0.09 + Math.sin(p.z * 5 - t * 1.7 * hemSpeed) * 0.05) * m;
      }
      const warp = mood === "thinking" ? Math.sin(t * 6 + p.x * 4 + p.z * 3) * 0.015 : 0;
      const rx = p.x * cosR + p.z * sinR;
      const rz = -p.x * sinR + p.z * cosR;
      const depth = (rz + 1) / 2;
      const edge = p.y > revealY - 0.25 && !settled ? 1.8 : 1;
      const a = (0.20 + depth * 0.55 + pulse * 0.3) * edge * p.dim;
      ctx2.fillStyle = `rgba(${mr},${mg},${mb},${Math.min(0.95, a)})`;
      const sz = (0.9 + depth * 1.35 + talkBeat * 0.3) * (p.dim < 1 ? 0.85 : 1);
      ctx2.fillRect(X(rx + warp), Y(ny), sz, sz);
    }

    /* the dark of the hood: features glow out of a void, like the art */
    ctx2.globalCompositeOperation = "source-over";
    ctx2.save();
    ctx2.translate(X(VOID_CX + 0.05 * sinR), Y(VOID_CY - E.drop * 0.5));
    ctx2.rotate(E.tilt * 0.5);
    const vg = ctx2.createRadialGradient(0, 0, 0, 0, 0, VOID_RX * scale * breath);
    vg.addColorStop(0, "rgba(1,7,5,0.92)");
    vg.addColorStop(0.75, "rgba(1,7,5,0.85)");
    vg.addColorStop(1, "rgba(1,7,5,0)");
    ctx2.fillStyle = vg;
    ctx2.beginPath();
    ctx2.ellipse(0, 0, VOID_RX * 0.97 * scale * breath * bodySx, VOID_RY * 0.97 * scale * breath * bodySy, 0, 0, TAU);
    ctx2.fill();
    ctx2.restore();
    ctx2.globalCompositeOperation = "lighter";

    /* sleeves + hands. sleeves are soft smoky strokes (round caps, no slabs);
       hands are solid little gloves — filled palm + thick capsule fingers */
    if (faceAlpha > 0.05) {
      const drawSleeveHand = (side, j, handStyle, handAngle) => {
        const shx = side * 0.58 * cosR, shy = 0.34;
        const wx = j.hx, wy = j.hy;
        const dx = wx - shx, dy = wy - shy;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len, nyv = dx / len;
        const bow = side * 0.07 + Math.sin(t * 1.8 + side) * 0.02;
        const mx2 = shx + dx * 0.5 + nx * bow, my2 = shy + dy * 0.5 + nyv * bow;
        ctx2.lineCap = "round";
        ctx2.shadowColor = A(0.6);
        ctx2.shadowBlur = 6;
        ctx2.strokeStyle = A(0.12 * faceAlpha);
        ctx2.lineWidth = scale * 0.17;
        ctx2.beginPath();
        ctx2.moveTo(X(shx), Y(shy));
        ctx2.quadraticCurveTo(X(mx2), Y(my2), X(wx), Y(wy));
        ctx2.stroke();
        ctx2.strokeStyle = A(0.2 * faceAlpha);
        ctx2.lineWidth = scale * 0.10;
        ctx2.stroke();
        ctx2.shadowBlur = 0;
        /* hologram flecks along the sleeve */
        for (const [u, v] of SLV) {
          const w2 = 0.07 + u * 0.06;
          const sx2 = shx + dx * u + nx * (bow * 2 * u * (1 - u) + (v - 0.5) * 2 * w2);
          const sy2 = shy + dy * u + nyv * (bow * 2 * u * (1 - u) + (v - 0.5) * 2 * w2);
          ctx2.fillStyle = A((0.3 + u * 0.4) * faceAlpha);
          ctx2.fillRect(X(sx2), Y(sy2), 1.3, 1.3);
        }
        /* the glove: filled palm + 4 thick fingers + thumb */
        const hs = scale * 0.05;
        ctx2.save();
        ctx2.translate(X(wx), Y(wy));
        ctx2.rotate(handAngle);
        ctx2.shadowColor = A(0.85);
        ctx2.shadowBlur = 10 + pulse * 6;
        const hg = ctx2.createRadialGradient(0, 0, 0, 0, 0, hs * 2.4);
        hg.addColorStop(0, `rgba(220,255,240,${0.9 * faceAlpha})`);
        hg.addColorStop(1, A(0.5 * faceAlpha));
        ctx2.fillStyle = hg;
        ctx2.strokeStyle = hg;
        ctx2.beginPath(); ctx2.ellipse(0, 0, hs * 1.05, hs * 0.88, 0, 0, TAU); ctx2.fill();
        ctx2.lineCap = "round";
        ctx2.lineWidth = hs * 0.72;
        const spread = handStyle === "open" ? 0.38 : 0.3;
        const flen = handStyle === "open" ? hs * 1.7 : hs * 1.1;
        const bend = handStyle === "open" ? 0.1 : 0.6;
        for (let f = 0; f < 4; f++) {
          const fa = (f - 1.5) * spread;
          const bx = Math.cos(fa) * hs * 0.85, by = Math.sin(fa) * hs * 0.7;
          ctx2.beginPath();
          ctx2.moveTo(bx, by);
          ctx2.quadraticCurveTo(
            bx + Math.cos(fa) * flen * 0.55, by + Math.sin(fa) * flen * 0.55,
            bx + Math.cos(fa + bend) * flen, by + Math.sin(fa + bend) * flen);
          ctx2.stroke();
        }
        ctx2.beginPath();                                   // thumb
        ctx2.moveTo(-hs * 0.2, hs * 0.7);
        ctx2.lineTo(hs * (handStyle === "open" ? 0.75 : 0.5), hs * 1.15);
        ctx2.stroke();
        ctx2.shadowBlur = 0;
        ctx2.restore();
      };
      drawSleeveHand(1, arm.R, pose.hand, pose.a);
      drawSleeveHand(-1, arm.L, pose.handL, pose.aL);

      /* the conjured flame orb, hovering over the raised hand */
      if (flameHold > 0.05) {
        const fx = X(arm.R.hx + 0.02), fy = Y(arm.R.hy + 0.30 + Math.sin(t * 2.3) * 0.03);
        const fr = scale * (0.11 + Math.sin(t * 6.4) * 0.012 + pulse * 0.03) * flameHold;
        for (let l = 3; l >= 0; l--) {
          const lr = fr * (1 + l * 0.55);
          const g = ctx2.createRadialGradient(fx, fy - l * fr * 0.35, 0, fx, fy - l * fr * 0.35, lr);
          g.addColorStop(0, l === 0 ? `rgba(235,255,246,${0.9 * flameHold * faceAlpha})` : A(0.28 * flameHold * faceAlpha / l));
          g.addColorStop(1, A(0));
          ctx2.fillStyle = g;
          ctx2.beginPath(); ctx2.arc(fx, fy - l * fr * 0.35, lr, 0, TAU); ctx2.fill();
        }
        /* flame licks — short, thick, flickering */
        ctx2.strokeStyle = A(0.55 * flameHold * faceAlpha);
        ctx2.lineWidth = 2;
        ctx2.lineCap = "round";
        for (let l = 0; l < 3; l++) {
          const la = t * 3 + l * 2.1;
          ctx2.beginPath();
          ctx2.moveTo(fx + Math.sin(la) * fr * 0.4, fy - fr * 0.5);
          ctx2.quadraticCurveTo(fx + Math.sin(la + 1) * fr * 0.6, fy - fr * 1.0, fx + Math.sin(la * 1.3) * fr * 0.3, fy - fr * (1.35 + Math.sin(la) * 0.2));
          ctx2.stroke();
        }
      }
    }

    /* amulet: gem in an ornate frame, like the art */
    if (faceAlpha > 0.05) {
      const ax = X(0.02 * cosR), ay = Y(0.10);
      const ar = scale * (0.07 + Math.sin(t * 2.1) * 0.005 + pulse * 0.02);
      ctx2.save();
      ctx2.translate(ax, ay);
      ctx2.rotate(Math.sin(t * 0.9) * 0.06);
      const ag = ctx2.createLinearGradient(0, -ar, 0, ar);
      ag.addColorStop(0, `rgba(235,255,246,${0.92 * faceAlpha})`);
      ag.addColorStop(1, A(0.65 * faceAlpha));
      ctx2.fillStyle = ag;
      ctx2.shadowColor = A(0.9);
      ctx2.shadowBlur = 14 + pulse * 10;
      ctx2.beginPath();
      ctx2.moveTo(0, -ar); ctx2.lineTo(ar * 0.62, 0); ctx2.lineTo(0, ar); ctx2.lineTo(-ar * 0.62, 0);
      ctx2.closePath(); ctx2.fill();
      ctx2.strokeStyle = A(0.55 * faceAlpha);
      ctx2.lineWidth = 1.1;
      ctx2.beginPath(); ctx2.ellipse(0, 0, ar * 1.7, ar * 2.0, 0, 0, TAU); ctx2.stroke();
      /* side curls of the frame — separate strokes, no connecting chord */
      ctx2.beginPath();
      ctx2.arc(-ar * 2.1, -ar * 0.4, ar * 0.7, Math.PI * 0.2, Math.PI * 1.3);
      ctx2.stroke();
      ctx2.beginPath();
      ctx2.arc(ar * 2.1, -ar * 0.4, ar * 0.7, Math.PI * 1.7, Math.PI * 0.8, true);
      ctx2.stroke();
      ctx2.shadowBlur = 0;
      ctx2.restore();
    }

    /* sparkles */
    for (let i = 0; i < 9; i++) {
      const sx = Math.sin(i * 2.4) * 1.35, sy = 0.2 + Math.cos(i * 1.7) * 1.15;
      const tw = Math.pow(Math.max(0, Math.sin(t * 1.3 + i * 2.1)), 3) * 0.8 * reveal * (emotion === "sad" ? 0.3 : 1);
      if (tw < 0.05) continue;
      const spx = X(sx), spy = Y(sy), sl = scale * 0.03 * tw;
      ctx2.strokeStyle = A(tw);
      ctx2.lineWidth = 1;
      ctx2.beginPath();
      ctx2.moveTo(spx - sl, spy); ctx2.lineTo(spx + sl, spy);
      ctx2.moveTo(spx, spy - sl); ctx2.lineTo(spx, spy + sl);
      ctx2.stroke();
    }

    /* ================= the FACE, glowing out of the void ================= */
    if (faceAlpha > 0.02) {
      ctx2.save();
      ctx2.globalAlpha = faceAlpha;
      ctx2.translate(X(0.05 * sinR), Y(VOID_CY - E.drop));
      ctx2.rotate(E.tilt + Math.sin(t * 0.8) * 0.012 + swayBias * 0.25);
      const s = scale * breath;
      const lid = Math.max(0.08, E.lid * blink - thinkBeat * 0.05);
      const eyeHappy = Math.max(0, Math.min(1, E.eyeHappy));

      /* brows: sharp glowing slashes */
      ctx2.lineCap = "round";
      ctx2.shadowColor = A(0.9);
      ctx2.shadowBlur = 10 + pulse * 8;
      for (const side of [-1, 1]) {
        const raise = side === -1 ? E.browSplit : 0;
        const byIn = -(0.21 + E.browY + raise) * s + E.browA * 0.18 * s - E.browSad * 0.09 * s;
        const byOut = -(0.21 + E.browY + raise) * s - E.browA * 0.08 * s + E.browSad * 0.15 * s;
        ctx2.strokeStyle = A(0.95);
        ctx2.lineWidth = s * 0.045;
        ctx2.beginPath();
        ctx2.moveTo(side * 0.075 * s, byIn);
        ctx2.quadraticCurveTo(side * 0.21 * s, byIn - 0.045 * s * (1 - E.browA - E.browSad), side * 0.35 * s, byOut);
        ctx2.stroke();
      }

      /* eyes: fierce slanted almonds glowing out of the dark */
      for (const side of [-1, 1]) {
        const shut = side === 1 ? Math.max(0, 1 - wink * 1.4) : 1;
        const eh = 0.115 * s * lid * shut * (1 - eyeHappy * 0.9);
        const ew = 0.18 * s;
        ctx2.save();
        ctx2.translate(side * 0.24 * s, -0.05 * s);
        ctx2.rotate(side * -0.14 + side * -E.browA * 0.16 + side * E.browSad * 0.14);
        if (eyeHappy > 0.08) {
          ctx2.strokeStyle = A(0.95 * eyeHappy);
          ctx2.lineWidth = s * 0.05;
          ctx2.beginPath(); ctx2.arc(0, eh + s * 0.05, ew * 0.72, Math.PI * 1.12, Math.PI * 1.88); ctx2.stroke();
        }
        if (eh > 0.012 && eyeHappy < 0.9) {
          const eg = ctx2.createRadialGradient(0, 0, 0, 0, 0, ew);
          eg.addColorStop(0, `rgba(238,255,248,${(0.95 + pulse * 0.05) * (1 - eyeHappy)})`);
          eg.addColorStop(0.55, A(0.9 * (1 - eyeHappy)));
          eg.addColorStop(1, A(0.15 * (1 - eyeHappy)));
          ctx2.fillStyle = eg;
          ctx2.beginPath();
          ctx2.moveTo(-ew, 0);
          ctx2.quadraticCurveTo(0, -eh * 1.8, ew, 0);
          ctx2.quadraticCurveTo(0, eh * 1.15, -ew, 0);
          ctx2.fill();
          const pxp = Math.max(-1, Math.min(1, lookX)) * ew * 0.4;
          const pyp = Math.max(-1, Math.min(1, lookY)) * eh * 0.5 + E.browSad * eh * 0.3;
          ctx2.shadowBlur = 0;
          ctx2.fillStyle = "rgba(2,12,9,0.9)";
          ctx2.beginPath(); ctx2.ellipse(pxp, pyp, eh * 0.55, eh * 0.65, 0, 0, TAU); ctx2.fill();
          ctx2.fillStyle = "rgba(240,255,250,0.9)";
          ctx2.beginPath(); ctx2.arc(pxp - eh * 0.18, pyp - eh * 0.22, Math.max(0.6, eh * 0.13), 0, TAU); ctx2.fill();
          ctx2.shadowColor = A(0.9);
          ctx2.shadowBlur = 10 + pulse * 8;
        } else if (eh <= 0.012 && eyeHappy < 0.08) {
          ctx2.strokeStyle = A(0.9);
          ctx2.lineWidth = s * 0.03;
          ctx2.beginPath(); ctx2.arc(0, 0, ew * 0.7, 0.15 * Math.PI, 0.85 * Math.PI); ctx2.stroke();
        }
        ctx2.restore();
      }

      /* sad tear */
      if (E.browSad > 0.55) {
        const tp = (t * 0.45) % 1;
        const ty = 0.06 * s + tp * 0.24 * s;
        ctx2.fillStyle = `rgba(190,255,235,${(1 - tp) * 0.85 * (E.browSad - 0.55) * 2.2})`;
        ctx2.beginPath();
        ctx2.ellipse(-0.27 * s, ty, s * 0.02, s * 0.03, 0, 0, TAU);
        ctx2.fill();
      }

      /* wink sparkle */
      if (wink > 0.5) {
        const wx = 0.40 * s, wy = -0.16 * s, wl = s * 0.09 * (wink - 0.5) * 2;
        ctx2.strokeStyle = `rgba(240,255,250,${(wink - 0.5) * 2})`;
        ctx2.lineWidth = 1.5;
        ctx2.beginPath();
        ctx2.moveTo(wx - wl, wy); ctx2.lineTo(wx + wl, wy);
        ctx2.moveTo(wx, wy - wl); ctx2.lineTo(wx, wy + wl);
        ctx2.moveTo(wx - wl * 0.6, wy - wl * 0.6); ctx2.lineTo(wx + wl * 0.6, wy + wl * 0.6);
        ctx2.moveTo(wx - wl * 0.6, wy + wl * 0.6); ctx2.lineTo(wx + wl * 0.6, wy - wl * 0.6);
        ctx2.stroke();
      }

      /* mouth: the clean crescent smile of the art, with full range.
         smile: corners UP, belly DOWN. frown: corners DOWN, arch UP. */
      const frown = Math.max(0, -E.curve);
      const grin = Math.max(0, E.curve);
      const mw = 0.40 * E.wide * s;
      const cornL = E.smirk * 0.04 * s + frown * 0.13 * s - grin * 0.10 * s;
      const cornR = -E.smirk * 0.07 * s + frown * 0.13 * s - grin * 0.10 * s;
      ctx2.save();
      ctx2.translate(0.02 * s, 0.30 * s + E.browSad * 0.02 * s);
      if (E.open > 0.06) {
        const topC = -grin * 0.06 * s - E.open * 0.16 * s - frown * 0.11 * s;
        const botC = E.open * 0.32 * s + grin * 0.14 * s - frown * 0.05 * s;
        ctx2.beginPath();
        ctx2.moveTo(-mw, cornL);
        ctx2.quadraticCurveTo(0, topC, mw, cornR);
        ctx2.quadraticCurveTo(0, botC, -mw, cornL);
        ctx2.closePath();
        ctx2.fillStyle = "rgba(1,8,6,0.88)";
        ctx2.fill();
        ctx2.strokeStyle = A(0.92);
        ctx2.lineWidth = Math.max(1.2, s * 0.03);
        ctx2.stroke();
        if (E.curve > 0.3) {
          ctx2.fillStyle = "rgba(240,255,250,0.92)";
          for (const fx of [-mw * 0.42, mw * 0.34]) {
            const fy = topC * 0.5;
            ctx2.beginPath();
            ctx2.moveTo(fx - s * 0.022, fy); ctx2.lineTo(fx + s * 0.022, fy); ctx2.lineTo(fx, fy + s * 0.05);
            ctx2.closePath(); ctx2.fill();
          }
        }
      } else {
        /* closed: one clean glowing crescent, belly below the corners */
        const midC = grin * 0.16 * s - frown * 0.13 * s;
        ctx2.strokeStyle = A(0.95);
        ctx2.lineWidth = Math.max(1.4, s * 0.038);
        ctx2.shadowColor = A(0.9);
        ctx2.shadowBlur = 10 + pulse * 8;
        ctx2.beginPath();
        ctx2.moveTo(-mw, cornL);
        ctx2.quadraticCurveTo(0, midC, mw, cornR);
        ctx2.stroke();
      }
      ctx2.restore();

      ctx2.shadowBlur = 0;
      ctx2.restore();
    }
    ctx2.globalCompositeOperation = "source-over";
  };

  return { draw };
}
