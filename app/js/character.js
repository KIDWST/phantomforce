/* PhantomForce — the Phantom: a living being made from the hero paintings.

   POSE LIBRARY (app/assets/poses/*.webp): the character exists as eleven real
   painted stances — conjure (flame + offered hand), arms crossed, hand on
   chin, open-palm present, finger-up point, hand-over-mouth laugh, a warm
   mug/welcome, a bashful sheepish, a coy hush, a scheming chin-stroke, and an
   assertive finger-up. The engine picks the stance that fits real app state.
   Conjure is a startup reveal only; after the first user action his standby
   stance QUIETLY REFLECTS HOW HE FEELS (warm→welcome, thinking→scheme,
   taken-aback→coy/sheepish) — it never randomly cycles.

   FEELING has MOMENTUM: a mood governor (governMood) carries an emotional
   state with inertia through a valence/arousal plane, so he doesn't snap
   between opposite emotions — a shove into the opposite valence is bridged
   through a surprised → (coy | sheepish) "taken aback" beat before it lands.

   The painted poses already contain the character's face. Do not draw a
   second procedural face over them unless a future asset explicitly sets
   face.live = true after preprocessing erases the baked face. Procedural
   fallback mode still owns the fully live face: blinks, winks, talks, and
   follows the cursor. Body: breath, float, sway, squash & stretch,
   materialize-from-the-ring.

   3D hologram pass: pose art is still the source of truth, but the renderer
   gives it physical volume with perspective yaw, a rear glow shell, a rotated
   floor ring, and parallax response from pointer/phone motion.

   Procedural mode: the hand-built particle phantom, used until artwork
   loads or if it fails. Shared by the landing page and the admin console. */

const GA = 2.399963229728653;
const TAU = Math.PI * 2;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export const ACCENTS = {
  calm: [65, 255, 161],
  content: [96, 255, 180],
  happy: [132, 255, 207],
  bright: [96, 255, 140],
  alert: [255, 92, 116],
  sad: [58, 200, 158],
  excited: [132, 255, 207],
  surprised: [96, 255, 140],
  sheepish: [120, 255, 200],
  coy: [80, 255, 150],
};

const FACE = {
  idle:      { browY: 0.10, browA: 0.24, browSad: 0, browSplit: 0.00, lid: 0.85, eyeHappy: 0.0, curve: 0.42, open: 0.04, wide: 1.00, smirk: 0.35, tilt: 0.03, squash: 0.00, drop: 0.00 },
  listening: { browY: 0.17, browA: -0.10, browSad: 0, browSplit: 0.00, lid: 1.00, eyeHappy: 0.0, curve: 0.12, open: 0.24, wide: 0.55, smirk: 0.10, tilt: -0.02, squash: 0.05, drop: 0.00 },
  thinking:  { browY: 0.12, browA: 0.30, browSad: 0, browSplit: 0.16, lid: 0.70, eyeHappy: 0.0, curve: 0.12, open: 0.04, wide: 0.60, smirk: 0.40, tilt: 0.06, squash: 0.00, drop: 0.02 },
  talking:   { browY: 0.13, browA: 0.12, browSad: 0, browSplit: 0.00, lid: 0.92, eyeHappy: 0.0, curve: 0.34, open: 0.30, wide: 1.00, smirk: 0.35, tilt: 0.00, squash: 0.05, drop: 0.00 },
  menace:    { browY: 0.02, browA: 0.60, browSad: 0, browSplit: 0.00, lid: 0.55, eyeHappy: 0.0, curve: 0.50, open: 0.16, wide: 1.10, smirk: 0.65, tilt: 0.05, squash: 0.15, drop: 0.00 },
  happy:     { browY: 0.20, browA: 0.00, browSad: 0, browSplit: 0.00, lid: 0.75, eyeHappy: 0.85, curve: 0.75, open: 0.18, wide: 1.10, smirk: 0.30, tilt: -0.03, squash: 0.30, drop: 0.00 },
  content:   { browY: 0.16, browA: 0.06, browSad: 0, browSplit: 0.00, lid: 0.80, eyeHappy: 0.55, curve: 0.55, open: 0.09, wide: 1.05, smirk: 0.32, tilt: -0.02, squash: 0.14, drop: 0.00 },
  sad:       { browY: 0.06, browA: -0.05, browSad: 0.95, browSplit: 0.00, lid: 0.55, eyeHappy: 0.0, curve: -0.55, open: 0.05, wide: 0.70, smirk: 0.00, tilt: 0.08, squash: -0.85, drop: 0.16 },
  surprised: { browY: 0.32, browA: -0.25, browSad: 0, browSplit: 0.00, lid: 1.30, eyeHappy: 0.0, curve: 0.02, open: 0.60, wide: 0.45, smirk: 0.00, tilt: 0.00, squash: 0.35, drop: -0.06 },
  excited:   { browY: 0.24, browA: -0.05, browSad: 0, browSplit: 0.00, lid: 1.05, eyeHappy: 0.8, curve: 0.70, open: 0.34, wide: 1.15, smirk: 0.15, tilt: -0.02, squash: 0.50, drop: 0.00 },
  sheepish:  { browY: 0.24, browA: -0.30, browSad: 0.40, browSplit: 0.10, lid: 0.72, eyeHappy: 0.30, curve: 0.30, open: 0.10, wide: 0.85, smirk: 0.45, tilt: 0.09, squash: 0.05, drop: 0.03 },
  coy:       { browY: 0.12, browA: 0.35, browSad: 0, browSplit: 0.20, lid: 0.62, eyeHappy: 0.15, curve: 0.42, open: 0.05, wide: 0.80, smirk: 0.70, tilt: 0.05, squash: 0.05, drop: 0.00 },
};

/* Emotion prototypes in a valence/arousal plane. The mood governor lives in
   this plane so feelings have MOMENTUM: he eases between them instead of
   snapping, and a shove into the opposite valence is bridged through a
   surprised → (coy | sheepish) "taken aback" beat before it lands. */
const EMO = {
  calm:      { v: 0.18, a: 0.20 },
  content:   { v: 0.52, a: 0.32 },
  bright:    { v: 0.38, a: 0.46 },
  happy:     { v: 0.74, a: 0.56 },
  excited:   { v: 0.90, a: 0.92 },
  coy:       { v: 0.44, a: 0.55 },
  sheepish:  { v: 0.06, a: 0.55 },
  surprised: { v: 0.00, a: 0.95 },
  sad:       { v: -0.74, a: 0.24 },
  alert:     { v: -0.36, a: 0.86 },
};

function applyEmotion(T, emotion, mood) {
  const o = { ...T };
  const idleish = mood === "idle" || mood === "happy";
  if (["sad", "surprised", "excited", "happy", "content", "sheepish", "coy"].includes(emotion) && idleish) return { ...FACE[emotion] };
  if (emotion === "happy") { o.curve += 0.2; o.lid *= 0.9; o.browY += 0.05; o.eyeHappy = Math.max(o.eyeHappy, 0.35); o.squash += 0.2; }
  if (emotion === "content") { o.curve += 0.12; o.browY += 0.04; o.eyeHappy = Math.max(o.eyeHappy, 0.28); o.squash += 0.1; }
  if (emotion === "excited") { o.curve += 0.25; o.browY += 0.1; o.squash += 0.4; o.lid = Math.min(1.15, o.lid + 0.15); }
  if (emotion === "sad") { o.browSad = 0.9; o.curve -= 0.6; o.squash -= 0.7; o.drop += 0.12; o.lid *= 0.75; o.smirk = 0; }
  if (emotion === "surprised") { o.browY += 0.2; o.lid *= 1.25; o.open += 0.2; o.squash += 0.2; }
  if (emotion === "sheepish") { o.browSad = Math.max(o.browSad, 0.35); o.browA -= 0.2; o.browSplit += 0.08; o.tilt += 0.05; o.smirk = Math.max(o.smirk, 0.4); o.curve = Math.max(o.curve, 0.2); }
  if (emotion === "coy") { o.browSplit += 0.16; o.browA += 0.2; o.lid *= 0.8; o.smirk = Math.max(o.smirk, 0.6); o.curve = Math.max(o.curve, 0.35); }
  if (emotion === "bright") { o.browY += 0.05; o.lid = Math.min(1.1, o.lid + 0.15); o.curve += 0.08; }
  if (emotion === "alert") { o.browA += 0.4; o.lid *= 0.72; o.curve = Math.min(o.curve, -0.28); o.open += 0.1; o.smirk = 0.1; }
  return o;
}

/* the mood governor: one step of emotional inertia. `stim` is what the host
   is feeling AT him this frame; the returned emotion is what he actually
   FEELS, after momentum and the taken-aback bridge. A positive shove recovers
   through a pleased "coy" beat; a negative or soft one through "sheepish". */
function governMood(G, stim, dt) {
  const tgt = EMO[stim] || EMO.calm;
  const flip = Math.sign(tgt.v) !== Math.sign(G.cv) && Math.abs(tgt.v - G.cv) > 0.5 && Math.abs(G.cv) > 0.22;
  const startle = (tgt.a - G.ca) > 0.5 && tgt.v <= G.cv + 0.05;
  if (!G.bridge && (flip || startle) && G.dwell > 0.45) {
    const into = tgt.v > 0.25 ? "coy" : (stim !== "alert" ? "sheepish" : null);
    G.bridge = { stage: "surprised", tt: 0.40 + Math.random() * 0.22, into };
  }
  if (G.bridge) {
    G.bridge.tt -= dt;
    if (G.bridge.tt <= 0) {
      if (G.bridge.stage === "surprised" && G.bridge.into) G.bridge = { stage: G.bridge.into, tt: 0.50 + Math.random() * 0.3, into: null };
      else G.bridge = null;
    }
  }
  const K = G.bridge ? 6.0 : 3.2, D = 2 * Math.sqrt(K) * 1.05;
  G.cvv += ((tgt.v - G.cv) * K - D * G.cvv) * dt;
  G.cv += G.cvv * dt;
  G.ca += (tgt.a - G.ca) * Math.min(1, dt * (G.bridge ? 7 : 3.5));
  if (G.bridge && G.bridge.stage === "surprised") G.ca = Math.max(G.ca, 0.9);
  let expr;
  if (G.bridge) expr = G.bridge.stage;                          // surprised | coy | sheepish
  else if (stim === "alert" && G.cv < 0.02) expr = "alert";
  else if (G.cv < -0.32) expr = "sad";
  else if (G.cv < 0.22) expr = "calm";
  else if (G.cv < 0.56) expr = "content";
  else if (G.cv < 0.80) expr = "happy";
  else expr = "excited";
  if (expr !== G.expr) { G.expr = expr; G.dwell = 0; } else G.dwell += dt;
  return expr;
}

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

/* idle improvises through micro-beats only. Full-body stances stay tied to real app state. */
const SHOW_POOL = ["wink", "sway", "ponder"];
function buildShow() {
  const picks = SHOW_POOL.slice().sort(() => Math.random() - 0.5).slice(0, 3 + (Math.random() * 2 | 0));
  const seq = [{ name: "idle", d: 1.2 + Math.random() * 1.4 }];
  for (const name of picks) {
    seq.push({
      name,
      d: name === "wink" ? 1.0 : name === "laugh" ? 1.3 + Math.random() * 0.7 : 1.8 + Math.random() * 1.4,
    });
    seq.push({ name: "idle", d: 0.9 + Math.random() * 1.6 });
  }
  return seq;
}

function springStep(x, v, target, dt, K, D) {
  v += ((target - x) * K - D * v) * dt;
  return [x + v * dt, v];
}

const VOID_CX = 0, VOID_CY = 0.95, VOID_RX = 0.46, VOID_RY = 0.53;

/* hero-art landmarks as FRACTIONS of the image, so any export size works.
   Measured on the reference painting; tune here if the art is re-rendered. */
const ART = {
  cx: 0.496,                 // horizontal center of the figure (beam/ring axis)
  groundY: 0.897,            // baked summoning-ring center (the "floor")
  headTop: 0.041,            // top of the hood
  face: { cx: 0.485, cy: 0.260, rx: 0.064, ry: 0.074, s: 0.121 },
  flame: { x: 0.269, y: 0.331 },
  ring: { rx: 0.306, ry: 0.081 },
};

/* ============ the shared face: brows, eyes, tear, wink, mouth ============ */
/* draws at the current transform origin (face center). s = face scale. */
function drawFaceFeatures(ctx2, s, F) {
  const { E, A, pulse, lid, eyeHappy, wink, lookX, lookY, t } = F;

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

  for (const side of [-1, 1]) {
    const shut = side === 1 ? Math.max(0, 1 - wink * 1.4) : 1;
    const eh = 0.125 * s * lid * shut * (1 - eyeHappy * 0.9);
    const ew = 0.21 * s;
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

  if (E.browSad > 0.55) {
    const tp = (t * 0.45) % 1;
    const ty = 0.06 * s + tp * 0.24 * s;
    ctx2.fillStyle = `rgba(190,255,235,${(1 - tp) * 0.85 * (E.browSad - 0.55) * 2.2})`;
    ctx2.beginPath();
    ctx2.ellipse(-0.27 * s, ty, s * 0.02, s * 0.03, 0, 0, TAU);
    ctx2.fill();
  }

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

  if (F.mouth === false) { ctx2.shadowBlur = 0; return; }   // painted hand covers the mouth
  const frown = Math.max(0, -E.curve);
  const grin = Math.max(0, E.curve);
  const mw = 0.31 * E.wide * s;
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
}

export function createPhantomCharacter({ small = false } = {}) {
  /* ---- the pose library: the artwork in six real stances.
     Files are preprocessed offline (black -> true alpha, webp), so loading
     is cheap. Landmarks are fractions of each image: figure axis (cx),
     ring line (groundY), hood top (headTop), and the face map — where the
     live face replaces the painted one. mouth:false = the painted hand
     covers the mouth (laugh), so only eyes and brows are drawn. ---- */
  const POSES = {
    conjure: { file: "poses/conjure.webp", cx: 0.496, groundY: 0.897, headTop: 0.041,
      face: { cx: 0.485, cy: 0.260, rx: 0.064, ry: 0.074, s: 0.121, rot: 0, mouth: true },
      flame: { x: 0.269, y: 0.331 } },
    cross: { file: "poses/cross.webp", cx: 0.527, groundY: 0.894, headTop: 0.053,
      face: { cx: 0.487, cy: 0.253, rx: 0.070, ry: 0.058, s: 0.150, rot: -0.06, mouth: true } },
    chin: { file: "poses/chin.webp", cx: 0.520, groundY: 0.882, headTop: 0.078,
      face: { cx: 0.467, cy: 0.232, rx: 0.068, ry: 0.048, s: 0.148, rot: -0.05, mouth: true } },
    present: { file: "poses/present.webp", cx: 0.488, groundY: 0.885, headTop: 0.059,
      face: { cx: 0.500, cy: 0.205, rx: 0.082, ry: 0.055, s: 0.170, rot: -0.06, mouth: true } },
    point: { file: "poses/point.webp", cx: 0.493, groundY: 0.919, headTop: 0.067,
      face: { cx: 0.491, cy: 0.243, rx: 0.075, ry: 0.052, s: 0.168, rot: -0.05, mouth: true } },
    laugh: { file: "poses/laugh.webp", cx: 0.485, groundY: 0.908, headTop: 0.060,
      face: { cx: 0.418, cy: 0.215, rx: 0.078, ry: 0.038, s: 0.164, rot: -0.14, mouth: false } },
    welcome: { file: "poses/welcome.webp", cx: 0.460, groundY: 0.905, headTop: 0.070,
      face: { cx: 0.434, cy: 0.216, rx: 0.060, ry: 0.058, s: 0.123, rot: 0, mouth: true } },
    sheepish: { file: "poses/sheepish.webp", cx: 0.500, groundY: 0.905, headTop: 0.062,
      face: { cx: 0.498, cy: 0.232, rx: 0.058, ry: 0.055, s: 0.120, rot: 0.02, mouth: true } },
    coy: { file: "poses/coy.webp", cx: 0.500, groundY: 0.905, headTop: 0.098,
      face: { cx: 0.495, cy: 0.270, rx: 0.060, ry: 0.052, s: 0.123, rot: -0.03, mouth: true } },
    scheme: { file: "poses/scheme.webp", cx: 0.490, groundY: 0.905, headTop: 0.066,
      face: { cx: 0.474, cy: 0.236, rx: 0.060, ry: 0.050, s: 0.123, rot: -0.04, mouth: true } },
    assert: { file: "poses/assert.webp", cx: 0.500, groundY: 0.905, headTop: 0.058,
      face: { cx: 0.498, cy: 0.210, rx: 0.062, ry: 0.056, s: 0.127, rot: -0.03, mouth: true } },
  };
  const loadPose = (name) => {
    const p = POSES[name];
    if (!p || p.art || p.loading) return;
    p.loading = true;
    try {
      const img = new Image();
      img.onload = () => { p.art = img; p.w = img.naturalWidth; p.h = img.naturalHeight; };
      img.onerror = () => { p.failed = true; };
      const v = import.meta.url.split("?")[1] || "";   // reuse this module's ?v= cache-buster
      img.src = new URL("../assets/" + p.file, import.meta.url).href + (v ? "?" + v : "");
    } catch { p.failed = true; }
  };
  loadPose("conjure");
  loadPose("welcome");
  try { setTimeout(() => { for (const n in POSES) loadPose(n); }, 1200); } catch { }
  let curPose = "conjure", prevPose = null, poseBlend = 1;

  /* ---- procedural particle body (fallback) ---- */
  const N = small ? 900 : 1600;
  const pts = [];
  const hash = (k, m) => ((k * m) % 233) / 233;
  const NHOOD = (N * 0.30) | 0, NSH = (N * 0.16) | 0, NROBE = (N * 0.34) | 0, NIN = N - NHOOD - NSH - NROBE;
  for (let k = 0; k < NHOOD; k++) {
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
    pts.push({ x, y, z, dim: 1 });
  }
  for (let k = 0; k < NSH; k++) {
    const t = k / NSH, ang = k * GA;
    const y = 0.53 - t * 0.63;
    const R = (1.02 + Math.sin(t * Math.PI) * 0.12) * (0.9 + 0.1 * hash(k, 4241));
    pts.push({ x: Math.cos(ang) * R, y, z: Math.sin(ang) * R * 0.55, dim: 1 });
  }
  for (let k = 0; k < NROBE; k++) {
    const t = k / NROBE, ang = k * GA;
    const tend = Math.pow(0.5 + 0.5 * Math.cos(ang * 7), 1.7);
    const hemY = -0.55 - tend * 1.0;
    const y = -0.1 + t * (hemY + 0.1);
    const R = (1.12 - 0.22 * t) * (0.88 + 0.12 * hash(k, 6367));
    pts.push({ x: Math.cos(ang) * R, y, z: Math.sin(ang) * R * 0.55, dim: 1 });
  }
  for (let k = 0; k < NIN; k++) {
    const u = hash(k, 127), w = hash(k, 331), ang = k * GA;
    const y = -1.1 + u * 2.55;
    const sil = y > 0.53 ? 0.10 + (1.78 - y) / 1.25 * 1.0 : y > -0.1 ? 1.05 : 1.1 - 0.2 * (-0.1 - y);
    const R = Math.max(0.05, sil) * Math.sqrt(w) * 0.85;
    const x = Math.cos(ang) * R, z = Math.sin(ang) * R * 0.6;
    if (z > 0 && (x / VOID_RX) ** 2 + ((y - VOID_CY) / VOID_RY) ** 2 < 1.05) continue;
    pts.push({ x, y, z, dim: 0.45 });
  }
  const SLV = [];
  for (let k = 0; k < 30; k++) SLV.push([hash(k, 197), hash(k, 89)]);

  /* ---- spring-animated shared state ---- */
  const E = { ...FACE.idle };
  const EV = {}; for (const k in E) EV[k] = 0;
  const arm = {
    R: { hx: 0.90, hy: 0.52, vhx: 0, vhy: 0 },
    L: { hx: -0.84, hy: -0.14, vhx: 0, vhy: 0 },
  };
  let blinkT = 2.5, dartT = 2, dartX = 0, dartY = 0;
  let born = -1, wink = 0, ringBoost = 0, swayBias = 0, flameHold = 1;
  let showSeq = [], showT = 0;
  let impulseT = 5, browBump = 0, sighAmt = 0, sighT = 9, glitchNow = 0;
  const gov = { cv: 0.2, cvv: 0, ca: 0.25, expr: "calm", dwell: 1, bridge: null };

  /* ---- one tick of the acting engine, shared by both renderers ---- */
  const tick = (o) => {
    const { t, mood, emotion, px, py } = o;
    const dt = Math.min(0.05, Math.max(0.001, o.dt));
    const moodAge = Number.isFinite(o.moodAge) ? Math.max(0, o.moodAge) : t;
    const startupOnly = o.startupOnly !== false;
    const actionT = mood === "talking" ? moodAge : t;
    if (born < 0) born = t;
    const age = t - born;
    const reveal = Math.min(1, age / 2.2);
    const settled = reveal >= 1;
    /* what he actually FEELS this frame — the host's emotion run through the
       inertia governor, so it has momentum and bridges instead of snapping. */
    const emo = settled ? governMood(gov, emotion, dt) : "calm";
    const talkBeat = mood === "talking" ? Math.abs(Math.sin(actionT * 9.5)) : 0;
    const thinkBeat = mood === "thinking" ? Math.abs(Math.sin(t * 5.2)) : 0;

    let beat = "idle", gLocal = 0;
    if (settled && (mood === "idle" || mood === "happy")) {
      showT += dt;
      const total = showSeq.reduce((s, g) => s + g.d, 0);
      if (!showSeq.length || showT >= total) { showSeq = buildShow(); showT = 0; }
      let gt = showT;
      for (const g of showSeq) { if (gt < g.d) { beat = g.name; gLocal = gt / g.d; break; } gt -= g.d; }
    } else { showT = 0; showSeq = []; }

    /* idle impulses: unscripted flickers of life every few seconds */
    impulseT -= dt;
    if (impulseT < 0) {
      impulseT = 5 + Math.random() * 9;
      const kind = Math.random();
      if (kind < 0.3) { dartT = 0; dartX = (Math.random() - 0.5) * 2.2; dartY = (Math.random() - 0.5) * 1.2; }  // glance away
      else if (kind < 0.55) browBump = 0.16;                                                                     // curious brow flick
      else if (kind < 0.8) sighT = 0;                                                                            // a slow sigh
      else glitchNow = 0.22;                                                                                     // hologram twitch
    }
    browBump = Math.max(0, browBump - dt * 0.35);
    sighT += dt;
    sighAmt = sighT < 2.2 ? Math.sin((sighT / 2.2) * Math.PI) : 0;
    glitchNow = Math.max(0, glitchNow - dt);
    let gesture = startupOnly ? "conjure" : "talk";
    if (!settled) gesture = "conjure";
    else if (mood === "talking") gesture = "talk";
    else if (mood === "thinking") gesture = "chin";
    else if (mood === "menace") gesture = "menace";
    else if (mood === "happy") gesture = "cheer";
    else if (emo === "sad") gesture = "droop";

    /* stances are state-driven, never randomly cycled — but his idle STANDBY
       quietly reflects how he FEELS, and the taken-aback bridge (surprised →
       coy | sheepish) borrows its matching stance so his body agrees with his
       face. Idle life otherwise stays in face, glow, eyes, breath, particles. */
    const bStage = gov.bridge && gov.bridge.stage;
    const bridgePose = bStage === "coy" ? "coy"
      : bStage === "sheepish" ? "sheepish"
      : bStage === "surprised" ? (gov.bridge.into === "coy" ? "coy" : "sheepish") : null;
    let poseName = startupOnly ? "conjure" : "present";
    if (settled) {
      if (mood === "talking") poseName = (emo === "excited" || emo === "happy" || emo === "bright") ? "assert" : "present";
      else if (mood === "thinking") poseName = "scheme";
      else if (mood === "menace") poseName = "cross";
      else if (mood === "listening") poseName = (emo === "content" || emo === "happy") ? "welcome" : "point";
      else if (mood === "happy") poseName = "laugh";
      else poseName =                                    // idle standby, mood-reflective
        bridgePose ? bridgePose :
        emo === "excited" ? "laugh" :
        (emo === "content" || emo === "happy") ? "welcome" :
        startupOnly ? "conjure" : "present";
    }

    const T = applyEmotion(FACE[mood] || FACE.idle, emo, mood);
    if (mood === "talking") T.open = 0.1 + talkBeat * 0.42;
    if (beat === "cross" && gesture === "cross") { T.browA += 0.12; T.curve += 0.06; T.smirk = 0.55; }
    if (beat === "wave") { T.curve += 0.18; T.lid = Math.min(1, T.lid + 0.1); }
    if (beat === "wink") T.curve += 0.22;
    if (beat === "ponder") { T.browSplit += 0.16; T.browA += 0.14; T.lid *= 0.85; T.curve = 0.18; }
    if (beat === "laugh" && (mood === "idle" || mood === "happy")) {
      Object.assign(T, FACE.happy);
      T.open = 0.25 + Math.abs(Math.sin(t * 8)) * 0.28;
      T.squash = 0.55;
    }
    T.browY += browBump;
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

    const pose = ARMS[gesture] || ARMS.conjure;
    const waveSwing = gesture === "wave" ? Math.sin(t * 6.4) * 0.13 * Math.sin(Math.min(1, gLocal * 2) * Math.PI) : 0;
    const talkBob = gesture === "talk" ? Math.sin(actionT * 3.2) * 0.03 : 0;
    const stepJ = (j, k, target) => { const [nx, nv] = springStep(j[k], j["v" + k], target, dt, 80, 10); j[k] = nx; j["v" + k] = nv; };
    stepJ(arm.R, "hx", pose.h[0] + waveSwing); stepJ(arm.R, "hy", pose.h[1] + talkBob);
    stepJ(arm.L, "hx", pose.hL[0]); stepJ(arm.L, "hy", pose.hL[1] - talkBob);

    blinkT -= dt; if (blinkT < -0.14) blinkT = 2.2 + ((t * 997) % 1) * 3.2;
    const blink = blinkT < 0.14 && blinkT > -0.14 ? Math.abs(blinkT / 0.14) : 1;
    dartT -= dt; if (dartT < 0) { dartT = 1.6 + ((t * 131) % 1) * 2.6; dartX = (((t * 379) % 1) - 0.5) * 1.4; dartY = (((t * 733) % 1) - 0.5) * 0.8; }
    const lookX = Math.abs(px) + Math.abs(py) > 0.02 ? px * 2 : dartX;
    const lookY = Math.abs(px) + Math.abs(py) > 0.02 ? py * 1.4 : dartY;

    const bounce = E.squash > 0 ? Math.sin(t * 3.6) * 0.045 * E.squash : 0;
    return {
      dt, age, reveal, settled, talkBeat, thinkBeat, beat, gesture, pose, poseName, emo,
      blink, lookX, lookY, sighAmt, glitchNow,
      bodySy: 1 + E.squash * 0.055 + bounce,
      bodySx: 1 - (E.squash * 0.055 + bounce) * 0.6,
      floatAmp: 1 + E.squash * (E.squash > 0 ? 0.9 : 0.55),
      slump: E.squash < 0 ? -E.squash * 0.11 : 0,
    };
  };

  /* ============================ SPRITE MODE ============================ */
  /* CONSISTENCY CONTRACT — the paintings frame him at different zooms, so
     everything is normalized to the character's anatomical constant:
       · his FACE is always exactly FACE_T × scale wide,
       · his face always sits at FACE_Y × scale above the floor,
       · the floor (ring-space origin) and the drawn ring never move.
     Each painting is scaled by its own k so its face hits that contract;
     the baked floor rings were faded out in preprocessing, and ONE ring is
     drawn by the engine — identical for every pose. Nothing changes size
     or position between stances, ever, except the pose itself. */
  const FACE_T = 0.56;                 // face width, as a fraction of `scale`
  const FACE_Y = -2.05;                // face height above the floor, × scale
  const poseK = (p, scale) => (scale * FACE_T) / (p.face.s * p.w);
  const poseFace = (p, scale) => ({
    x: (p.face.cx - p.cx) * p.w * poseK(p, scale),
    y: FACE_Y * scale,
    s: FACE_T * scale,
    rot: p.face.rot || 0,
    mouth: p.face.mouth !== false,
    live: p.face.live === true,
  });

  const hologramDepth = (o, S) => {
    const pointerYaw = clamp(o.px * 2.1, -1, 1);
    const pointerPitch = clamp(o.py * 1.35, -1, 1);
    const livingYaw = Math.sin(o.t * 0.36) * 0.14 + swayBias * 0.34 + S.talkBeat * Math.sin(o.t * 7.4) * 0.05;
    const yaw = clamp(pointerYaw * (small ? 0.22 : 0.31) + livingYaw, -0.42, 0.42);
    const pitch = clamp(pointerPitch * (small ? 0.045 : 0.07) + Math.sin(o.t * 0.52) * 0.018, -0.1, 0.1);
    const side = Math.sin(yaw);
    const turn = Math.cos(yaw);
    /* camera-only view of the floor: the emitter is furniture, not flesh —
       it answers to the viewer's parallax and NEVER to his sway or talk */
    const camSide = Math.sin(clamp(pointerYaw * (small ? 0.22 : 0.31), -0.42, 0.42));
    return {
      camSide,
      camRingRot: camSide * 0.13,
      camRingY: 0.22 + Math.abs(camSide) * 0.05 + Math.abs(pointerPitch) * 0.045,
      yaw,
      pitch,
      side,
      turn,
      xScale: 0.91 + turn * 0.09,
      yScale: 1 + pitch * 0.1,
      skewX: side * 0.135,
      skewY: -pitch * 0.045,
      xShift: side * o.scale * 0.15,
      yShift: pitch * o.scale * 0.26,
      backX: -side * o.scale * 0.22,
      backY: o.scale * (0.035 + Math.abs(pitch) * 0.24),
      rimX: side * o.scale * 0.82,
      alpha: 0.11 + Math.abs(side) * 0.15 + S.talkBeat * 0.04,
    };
  };

  const drawPoseLayer = (ctx2, p, alpha, o, S, filter, t, depth = null) => {
    const k = poseK(p, o.scale);
    const gx = p.cx * p.w;
    const oy = FACE_Y * o.scale / k - p.face.cy * p.h;   // image y-offset placing the face on the contract line
    ctx2.save();
    if (depth) {
      ctx2.transform(depth.xScale, depth.skewY, depth.skewX, depth.yScale, depth.xShift, depth.yShift);
    }
    ctx2.scale(k, k);
    ctx2.globalAlpha = alpha;
    if (filter) { try { ctx2.filter = filter; } catch { } }
    ctx2.drawImage(p.art, -gx, oy);
    /* glitch slices: a periodic tic, plus a burst while switching stances */
    const gCyc = t % 3.8;
    if ((gCyc < 0.16 || poseBlend < 0.85 || S.glitchNow > 0) && S.settled) {
      for (let i = 0; i < 3; i++) {
        const sy = p.h * (0.45 + 0.15 * i);
        const bh = p.h * 0.04;
        const off = Math.sin(t * 91 + i * 2) * p.w * (poseBlend < 0.85 ? 0.02 : 0.012);
        ctx2.drawImage(p.art, 0, sy, p.w, bh, -gx + off, sy + oy, p.w, bh);
      }
    }
    if (filter) { try { ctx2.filter = "none"; } catch { } }
    if (p.face.live === true) {
      /* Only face-erased future assets should use this. Current paintings
         keep their baked face so the Phantom never shows two expressions. */
      const fx = (p.face.cx - p.cx) * p.w, fy = p.face.cy * p.h + oy;
      ctx2.globalAlpha = 1;
      ctx2.globalCompositeOperation = "destination-out";
      const er = ctx2.createRadialGradient(fx, fy, 0, fx, fy, p.face.rx * p.w * 1.2);
      er.addColorStop(0, "rgba(0,0,0,1)");
      er.addColorStop(0.72, "rgba(0,0,0,1)");
      er.addColorStop(1, "rgba(0,0,0,0)");
      ctx2.fillStyle = er;
      ctx2.beginPath();
      ctx2.ellipse(fx, fy, p.face.rx * p.w * 1.2, p.face.ry * p.h * 1.2, p.face.rot || 0, 0, TAU);
      ctx2.fill();
      ctx2.globalCompositeOperation = "source-over";
    }
    ctx2.restore();
  };

  const drawSprite = (ctx2, o, S) => {
    const { t, cx, cy, scale, mood, pulse } = o;
    const emotion = S.emo || o.emotion;      // his FELT emotion (governed), not the raw stimulus
    const accent = ACCENTS[emotion] || ACCENTS.calm;
    const A = (a) => `rgba(${accent[0]},${accent[1]},${accent[2]},${a})`;
    const breath = 1 + Math.sin(t * 0.9) * 0.02 + pulse * 0.06 + S.talkBeat * 0.015 + S.sighAmt * 0.028;
    const floatY = (Math.sin(t * 1.1) * 0.05 * S.floatAmp + Math.sin(t * 3.2) * (mood === "talking" ? 0.025 : 0.008)) * scale * 0.5
      + (1 - S.reveal) * scale * 0.2 + S.slump * scale * 0.45 + S.sighAmt * scale * 0.03
      - scale * 0.06;                                    // he hovers, projected — never standing on the emitter

    let filter = "";
    if (emotion === "alert") filter = "hue-rotate(215deg) saturate(1.4) brightness(1.05)";
    else if (emotion === "sad") filter = "saturate(0.7) brightness(0.85)";
    else if (emotion === "excited" || emotion === "happy") filter = "saturate(1.15) brightness(1.1)";

    const depth = hologramDepth(o, S);

    /* ================= PROJECTOR FLOOR — static, always =================
       The emitter disc is hardware in the scene: no float, no breath, no
       sway. He bobs and turns ABOVE it; only viewer parallax (camSide)
       tilts its perspective, and only light intensity reacts to him.    */
    const floorX = cx + o.px * scale * 0.10;             // less parallax than the body → real depth separation
    const floorY = cy + scale * 1.72;
    const hot = Math.min(1, 0.30 + ringBoost * 0.45 + pulse * 0.55 + S.talkBeat * 0.35);
    ctx2.save();
    ctx2.translate(floorX, floorY);
    ctx2.rotate(depth.camRingRot);
    ctx2.globalCompositeOperation = "lighter";
    const ery = depth.camRingY;
    const disc = (r) => { ctx2.beginPath(); ctx2.ellipse(0, 0, scale * r, scale * r * ery, 0, 0, TAU); };

    /* his reflection in the emitter glass — flipped, squashed, fading with depth */
    const rp = POSES[curPose];
    if (rp && rp.art && S.settled) {
      const rk = poseK(rp, scale);
      const rgx = rp.cx * rp.w, roy = FACE_Y * scale / rk - rp.face.cy * rp.h;
      for (const [y0, y1, ra] of [[0.02, 0.34, 0.09], [0.34, 0.72, 0.04]]) {
        ctx2.save();
        ctx2.beginPath();
        ctx2.rect(-scale * 1.4, scale * y0, scale * 2.8, scale * (y1 - y0));
        ctx2.clip();
        ctx2.scale(1 - Math.abs(depth.camSide) * 0.06, -0.5);
        ctx2.scale(rk, rk);
        ctx2.globalAlpha = ra * (0.7 + hot * 0.6);
        try { ctx2.filter = "blur(5px)"; } catch { }
        ctx2.drawImage(rp.art, -rgx, roy);
        try { ctx2.filter = "none"; } catch { }
        ctx2.restore();
      }
      ctx2.globalAlpha = 1;
    }

    /* pooled glow on the glass */
    const puddle = ctx2.createRadialGradient(0, 0, 0, 0, 0, scale * 0.92);
    puddle.addColorStop(0, A(0.28 + hot * 0.20));
    puddle.addColorStop(0.45, A(0.10 + hot * 0.05));
    puddle.addColorStop(1, A(0));
    ctx2.fillStyle = puddle;
    ctx2.save(); ctx2.scale(1, ery); ctx2.beginPath(); ctx2.arc(0, 0, scale * 0.92, 0, TAU); ctx2.fill(); ctx2.restore();

    /* the emitter rim — the one line in the scene that NEVER moves */
    ctx2.lineWidth = Math.max(1.2, scale * 0.016);
    ctx2.strokeStyle = A(0.5 + hot * 0.35);
    ctx2.shadowColor = A(0.8);
    ctx2.shadowBlur = 10 + hot * 14;
    disc(0.86); ctx2.stroke();
    ctx2.shadowBlur = 0;
    ctx2.lineWidth = Math.max(1, scale * 0.008);
    ctx2.strokeStyle = A(0.18 + hot * 0.10);
    disc(0.98); ctx2.stroke();

    /* instrument dial: ticks crawl one way, the inner arc sweeps the other */
    ctx2.save();
    ctx2.setLineDash([scale * 0.045, scale * 0.075]);
    ctx2.lineDashOffset = -t * scale * 0.55;
    ctx2.lineWidth = Math.max(1, scale * 0.014);
    ctx2.strokeStyle = A(0.30 + hot * 0.24);
    disc(0.72); ctx2.stroke();
    ctx2.setLineDash([scale * 0.55, scale * 0.95]);
    ctx2.lineDashOffset = t * scale * 0.4;
    ctx2.lineWidth = Math.max(1, scale * 0.01);
    ctx2.strokeStyle = A(0.20 + hot * 0.18);
    disc(0.55); ctx2.stroke();
    ctx2.restore();

    /* etched inner rings */
    ctx2.lineWidth = 1;
    ctx2.strokeStyle = A(0.10);
    disc(0.38); ctx2.stroke();
    disc(0.20); ctx2.stroke();

    /* energy leaves the emitter — the emitter stays put */
    for (let ring = 0; ring < 2; ring++) {
      const p2 = (t * 0.30 + ring / 2) % 1;
      ctx2.strokeStyle = A((0.20 - p2 * 0.17) * (0.5 + hot));
      ctx2.lineWidth = Math.max(1, scale * 0.008);
      disc(0.30 + p2 * 0.72); ctx2.stroke();
    }

    /* the projection cone: three nested veils of light — soft edges, no slab.
       Each veil is narrower and fainter; they fade to nothing well before
       the top so there is never a visible cut line across his chest. */
    const flick = 0.78 + 0.13 * Math.sin(t * 12.7) + 0.09 * Math.sin(t * 33.1 + 1.7);
    const coneShift = depth.camSide * scale * 0.12;
    for (const [wMul, aMul] of [[1, 0.35], [0.82, 0.3], [0.6, 0.35]]) {
      const cg = ctx2.createLinearGradient(0, 0, 0, -scale * 2.75);
      cg.addColorStop(0, A((0.10 + hot * 0.09) * flick * aMul));
      cg.addColorStop(0.6, A(0.028 * flick * aMul));
      cg.addColorStop(0.92, A(0));
      ctx2.fillStyle = cg;
      ctx2.beginPath();
      ctx2.moveTo(-scale * 0.84 * wMul, 0);
      ctx2.lineTo((-scale * 0.46 + coneShift) * wMul, -scale * 2.75);
      ctx2.lineTo((scale * 0.46 + coneShift) * wMul, -scale * 2.75);
      ctx2.lineTo(scale * 0.84 * wMul, 0);
      ctx2.closePath();
      ctx2.fill();
    }

    /* motes riding the beam up into the figure */
    for (let i = 0; i < 10; i++) {
      const pp = (t * (0.16 + (i % 5) * 0.03) + i * 0.617) % 1;
      const mx = Math.sin(i * 2.4 + t * 0.7) * scale * (0.74 - pp * 0.3) + coneShift * pp;
      const dot = Math.max(1, scale * 0.013);
      ctx2.fillStyle = A((1 - pp) * 0.26 * (0.5 + hot * 0.8));
      ctx2.fillRect(mx, -pp * scale * 2.55, dot, dot);
    }
    ctx2.restore();
    ctx2.globalCompositeOperation = "source-over";
    /* =============== end projector floor — the body floats above =============== */

    ctx2.save();
    ctx2.translate(cx + o.px * scale * 0.25, cy + scale * 1.72 + floatY);
    ctx2.rotate(E.tilt * 0.5 + swayBias * 0.3 + depth.yaw * 0.08 + Math.sin(t * 0.5) * 0.012);
    ctx2.scale(S.bodySx * breath, S.bodySy * breath);

    /* materialize: one shared reveal window rising from the floor */
    if (!S.settled) {
      ctx2.beginPath();
      ctx2.rect(-2.2 * scale, 0.3 * scale - S.reveal * 3.6 * scale, 4.4 * scale, S.reveal * 3.6 * scale + 0.2 * scale);
      ctx2.clip();
    }

    const cur = POSES[curPose], prev = prevPose ? POSES[prevPose] : null;
    if (cur && cur.art) {
      ctx2.save();
      ctx2.globalCompositeOperation = "lighter";
      ctx2.translate(depth.backX, depth.backY);
      ctx2.scale(1 + Math.abs(depth.side) * 0.035, 0.985);
      drawPoseLayer(ctx2, cur, depth.alpha * (poseBlend < 1 ? poseBlend : 1), o, S, "blur(12px) saturate(1.55) brightness(1.18)", t, depth);
      ctx2.restore();
    }
    if (prev && prev.art && poseBlend < 1) drawPoseLayer(ctx2, prev, 1 - poseBlend, o, S, filter, t, depth);
    if (cur && cur.art) drawPoseLayer(ctx2, cur, poseBlend < 1 ? poseBlend : 1, o, S, filter, t, depth);

    ctx2.globalCompositeOperation = "lighter";

    /* the conjured flame breathes on the hero stance */
    if (curPose === "conjure" && poseBlend > 0.5 && flameHold > 0.05 && cur && cur.art) {
      const k = poseK(cur, scale);
      const flx = (cur.flame.x - cur.cx) * cur.w * k;
      const fly = FACE_Y * scale + (cur.flame.y - cur.face.cy) * cur.h * k;
      const fr = scale * (0.11 + Math.sin(t * 6.4) * 0.02 + pulse * 0.04) * flameHold * poseBlend;
      const g = ctx2.createRadialGradient(flx, fly, 0, flx, fly, fr * 3);
      g.addColorStop(0, `rgba(235,255,246,${0.45 * flameHold * poseBlend})`);
      g.addColorStop(0.4, A(0.28 * flameHold * poseBlend));
      g.addColorStop(1, A(0));
      ctx2.fillStyle = g;
      ctx2.beginPath(); ctx2.arc(flx, fly, fr * 3, 0, TAU); ctx2.fill();
    }

    /* scanline shimmer drifting up the hologram */
    const sy2 = -((t * 0.22) % 1) * scale * 3.3;
    const sg = ctx2.createLinearGradient(0, sy2 - scale * 0.1, 0, sy2 + scale * 0.1);
    sg.addColorStop(0, A(0));
    sg.addColorStop(0.5, A(0.035));
    sg.addColorStop(1, A(0));
    ctx2.fillStyle = sg;
    ctx2.fillRect(-scale * 1.05, sy2 - scale * 0.1, scale * 2.1, scale * 0.2);

    /* moving side rim: this sells the 3D turn even though the source pose is painted */
    if (S.settled) {
      const side = depth.side || 0.001;
      const rim = Math.sign(side);
      const rimAlpha = (0.08 + Math.abs(side) * 0.22 + pulse * 0.06) * (cur && cur.art ? 1 : 0.35);
      ctx2.save();
      ctx2.translate(depth.rimX, FACE_Y * scale * 0.48 + depth.yShift);
      ctx2.rotate(depth.yaw * 0.55);
      ctx2.strokeStyle = A(rimAlpha);
      ctx2.lineWidth = Math.max(1, scale * 0.012);
      ctx2.shadowColor = A(0.45);
      ctx2.shadowBlur = 12 + pulse * 10;
      ctx2.beginPath();
      ctx2.moveTo(-rim * scale * 0.18, -scale * 0.82);
      ctx2.bezierCurveTo(rim * scale * 0.17, -scale * 0.42, rim * scale * 0.18, scale * 0.28, -rim * scale * 0.04, scale * 0.78);
      ctx2.stroke();
      ctx2.restore();
    }

    /* rising dust while materializing */
    if (!S.settled) {
      for (let i = 0; i < 26; i++) {
        const dx = Math.sin(i * 2.13) * scale * 0.95;
        const p2 = (t * 1.5 + i * 0.37) % 1;
        const dy = -p2 * S.reveal * scale * 3.2;
        ctx2.fillStyle = A((1 - S.reveal) * (0.7 - p2 * 0.4));
        ctx2.fillRect(dx, dy, 2, 4);
      }
    }

    const curLiveFace = !!(cur && cur.face && cur.face.live === true);
    const prevLiveFace = !!(prev && prev.face && prev.face.live === true && poseBlend < 1);
    if (curLiveFace || prevLiveFace) {
      /* Face-erased future assets can opt into the procedural face. Current
         painted poses do not, which prevents the two-face bug. */
      const fCur = poseFace(cur && cur.art ? cur : POSES.conjure, scale);
      const fPrev = prev && prev.art && poseBlend < 1 ? poseFace(prev, scale) : fCur;
      const bl = poseBlend < 1 ? poseBlend : 1;
      const fx = fPrev.x + (fCur.x - fPrev.x) * bl;
      const frot = fPrev.rot + (fCur.rot - fPrev.rot) * bl;
      const fs = FACE_T * scale;
      const mouthOn = bl > 0.5 ? fCur.mouth : fPrev.mouth;
      ctx2.save();
      ctx2.translate(fx, FACE_Y * scale - E.drop * fs * 0.45);
      ctx2.rotate(frot + E.tilt + Math.sin(t * 0.8) * 0.012);
      drawFaceFeatures(ctx2, fs, {
        E, A, pulse,
        lid: Math.max(0.08, E.lid * S.blink - S.thinkBeat * 0.05),
        eyeHappy: Math.max(0, Math.min(1, E.eyeHappy)),
        wink, lookX: S.lookX, lookY: S.lookY, t,
        mouth: mouthOn,
      });
      ctx2.restore();
    }

    ctx2.restore();
    ctx2.globalCompositeOperation = "source-over";
  };

  /* ========================== PROCEDURAL MODE ========================== */
  const drawProcedural = (ctx2, o, S) => {
    const { t, cx, cy, scale, mood, pulse, px } = o;
    const emotion = S.emo || o.emotion;      // felt emotion (governed)
    const accent = ACCENTS[emotion] || ACCENTS.calm;
    const A = (a) => `rgba(${accent[0]},${accent[1]},${accent[2]},${a})`;
    const { reveal, settled, talkBeat, gesture, pose } = S;
    const breath = (1 + Math.sin(t * 0.9) * 0.025 + pulse * 0.1 + talkBeat * 0.02) * (0.92 + reveal * 0.08);
    const floatY = (Math.sin(t * 1.1) * 0.055 * S.floatAmp + Math.sin(t * 3.2) * (mood === "talking" ? 0.03 : 0.01)) * scale * 0.07
      + (1 - reveal) * scale * 0.0022 * 90;
    const X = (ux) => cx + ux * scale * breath * S.bodySx;
    const Y = (uy) => cy - (uy - S.slump) * scale * breath * S.bodySy + floatY * 7;
    const revealY = -1.75 + reveal * 3.8;
    const faceAlpha = Math.max(0, Math.min(1, (reveal - 0.82) / 0.18));
    const rot = Math.sin(t * 0.4) * 0.3 + px * 0.6 + swayBias;
    const cosR = Math.cos(rot), sinR = Math.sin(rot);

    ctx2.globalCompositeOperation = "lighter";

    ctx2.save();
    ctx2.translate(cx, cy + scale * 1.72);   // static floor: his bob never drags the emitter
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

    if (!settled) {
      for (let i = 0; i < 30; i++) {
        const dx = Math.sin(i * 2.13) * 0.95;
        const p = (t * 1.5 + i * 0.37) % 1;
        const dy = -1.7 + p * (revealY + 1.75);
        ctx2.fillStyle = A((1 - reveal) * (0.7 - p * 0.4));
        ctx2.fillRect(X(dx), Y(dy), 1.6, 3.5);
      }
    }

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
    ctx2.ellipse(0, 0, VOID_RX * 0.97 * scale * breath * S.bodySx, VOID_RY * 0.97 * scale * breath * S.bodySy, 0, 0, TAU);
    ctx2.fill();
    ctx2.restore();
    ctx2.globalCompositeOperation = "lighter";

    const faceAlphaOk = faceAlpha > 0.05;
    if (faceAlphaOk) {
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
        for (const [u, v] of SLV) {
          const w2 = 0.07 + u * 0.06;
          const sx2 = shx + dx * u + nx * (bow * 2 * u * (1 - u) + (v - 0.5) * 2 * w2);
          const sy2 = shy + dy * u + nyv * (bow * 2 * u * (1 - u) + (v - 0.5) * 2 * w2);
          ctx2.fillStyle = A((0.3 + u * 0.4) * faceAlpha);
          ctx2.fillRect(X(sx2), Y(sy2), 1.3, 1.3);
        }
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
        for (let f2 = 0; f2 < 4; f2++) {
          const fa = (f2 - 1.5) * spread;
          const bx = Math.cos(fa) * hs * 0.85, by = Math.sin(fa) * hs * 0.7;
          ctx2.beginPath();
          ctx2.moveTo(bx, by);
          ctx2.quadraticCurveTo(
            bx + Math.cos(fa) * flen * 0.55, by + Math.sin(fa) * flen * 0.55,
            bx + Math.cos(fa + bend) * flen, by + Math.sin(fa + bend) * flen);
          ctx2.stroke();
        }
        ctx2.beginPath();
        ctx2.moveTo(-hs * 0.2, hs * 0.7);
        ctx2.lineTo(hs * (handStyle === "open" ? 0.75 : 0.5), hs * 1.15);
        ctx2.stroke();
        ctx2.shadowBlur = 0;
        ctx2.restore();
      };
      drawSleeveHand(1, arm.R, pose.hand, pose.a);
      drawSleeveHand(-1, arm.L, pose.handL, pose.aL);

      if (flameHold > 0.05) {
        const fx = X(arm.R.hx + 0.02), fy = Y(arm.R.hy + 0.30 + Math.sin(t * 2.3) * 0.03);
        const fr = scale * (0.13 + Math.sin(t * 6.4) * 0.012 + pulse * 0.03) * flameHold;
        for (let l = 3; l >= 0; l--) {
          const lr = fr * (1 + l * 0.55);
          const g = ctx2.createRadialGradient(fx, fy - l * fr * 0.35, 0, fx, fy - l * fr * 0.35, lr);
          g.addColorStop(0, l === 0 ? `rgba(235,255,246,${0.9 * flameHold * faceAlpha})` : A(0.28 * flameHold * faceAlpha / l));
          g.addColorStop(1, A(0));
          ctx2.fillStyle = g;
          ctx2.beginPath(); ctx2.arc(fx, fy - l * fr * 0.35, lr, 0, TAU); ctx2.fill();
        }
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
      ctx2.beginPath();
      ctx2.arc(-ar * 2.1, -ar * 0.4, ar * 0.7, Math.PI * 0.2, Math.PI * 1.3);
      ctx2.stroke();
      ctx2.beginPath();
      ctx2.arc(ar * 2.1, -ar * 0.4, ar * 0.7, Math.PI * 1.7, Math.PI * 0.8, true);
      ctx2.stroke();
      ctx2.shadowBlur = 0;
      ctx2.restore();
    }

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

    if (faceAlpha > 0.02) {
      ctx2.save();
      ctx2.globalAlpha = faceAlpha;
      ctx2.translate(X(0.05 * sinR), Y(VOID_CY - E.drop));
      ctx2.rotate(E.tilt + Math.sin(t * 0.8) * 0.012 + swayBias * 0.25);
      drawFaceFeatures(ctx2, scale * breath, {
        E, A, pulse,
        lid: Math.max(0.08, E.lid * S.blink - S.thinkBeat * 0.05),
        eyeHappy: Math.max(0, Math.min(1, E.eyeHappy)),
        wink, lookX: S.lookX, lookY: S.lookY, t,
      });
      ctx2.restore();
    }
    ctx2.globalCompositeOperation = "source-over";
  };

  const draw = (ctx2, o) => {
    const S = tick(o);
    let want = S.poseName;
    if (!POSES[want] || !POSES[want].art) want = "conjure";
    if (want !== curPose && poseBlend >= 1 && POSES[want].art) {
      prevPose = curPose; curPose = want; poseBlend = 0;
      ringBoost = Math.min(1.4, ringBoost + 0.6);
    }
    if (poseBlend < 1) poseBlend = Math.min(1, poseBlend + S.dt / 0.45);
    if (POSES[curPose].art || POSES.conjure.art) drawSprite(ctx2, o, S);
    else drawProcedural(ctx2, o, S);
    return { pose: curPose, want, emo: S.emo, bridge: gov.bridge && gov.bridge.stage, cv: gov.cv };
  };

  return { draw };
}
