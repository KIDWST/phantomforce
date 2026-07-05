/* PhantomForce — the Phantom: a feature-film-style animated mascot built on
   classic animation principles.

   Squash & stretch: the whole body compresses and stretches with its bounce,
   volume-preserving. Anticipation & follow-through: every face and arm
   parameter is driven by an underdamped SPRING, so expressions overshoot and
   settle like a hand-animated character, never snapping. Exaggeration: the
   emotions are over-emoted on purpose — huge sad puppy brows and a glowing
   tear, anime arc-eyes when it's delighted, brows launched sky-high when
   surprised, a proper villain furrow for menace.

   Body: hologram particles (bent hood tip, ragged tendril hem), wisp flames,
   a diamond amulet, posed arms with friendly rounded hands, and a summoning
   ring it materializes from. When the conversation is quiet it performs a
   looping idle show: idle → crosses its arms → winks → waves → laughs →
   sways like a displayed hologram. Real moods interrupt instantly; thinking
   brings a hand to its chin. Shared by both PhantomForce sites. */

const GA = 2.399963229728653;
const TAU = Math.PI * 2;

export const ACCENTS = {
  calm: [65, 255, 161],
  happy: [132, 255, 207],
  bright: [30, 240, 255],
  alert: [255, 92, 116],
  sad: [58, 200, 158],
  excited: [132, 255, 207],
  surprised: [30, 240, 255],
};

/* face + posture targets. browA: inner-down furrow (villain V). browSad:
   inner-up/outer-down puppy brows. eyeHappy: eyes become delighted arcs.
   squash: body posture (+puffed/bouncy, -slumped). drop: head hangs. */
const FACE = {
  idle:      { browY: 0.10, browA: 0.20, browSad: 0, browSplit: 0.00, lid: 0.85, eyeHappy: 0.0, curve: 0.32, open: 0.05, wide: 0.95, smirk: 0.55, tilt: 0.035, squash: 0.00, drop: 0.00 },
  listening: { browY: 0.17, browA: -0.10, browSad: 0, browSplit: 0.00, lid: 1.00, eyeHappy: 0.0, curve: 0.12, open: 0.24, wide: 0.55, smirk: 0.10, tilt: -0.02, squash: 0.05, drop: 0.00 },
  thinking:  { browY: 0.12, browA: 0.30, browSad: 0, browSplit: 0.16, lid: 0.70, eyeHappy: 0.0, curve: 0.12, open: 0.04, wide: 0.60, smirk: 0.40, tilt: 0.06, squash: 0.00, drop: 0.02 },
  talking:   { browY: 0.13, browA: 0.12, browSad: 0, browSplit: 0.00, lid: 0.92, eyeHappy: 0.0, curve: 0.34, open: 0.30, wide: 1.00, smirk: 0.45, tilt: 0.00, squash: 0.05, drop: 0.00 },
  menace:    { browY: 0.02, browA: 0.60, browSad: 0, browSplit: 0.00, lid: 0.55, eyeHappy: 0.0, curve: 0.50, open: 0.16, wide: 1.10, smirk: 0.75, tilt: 0.05, squash: 0.15, drop: 0.00 },
  happy:     { browY: 0.20, browA: 0.00, browSad: 0, browSplit: 0.00, lid: 0.75, eyeHappy: 0.85, curve: 0.75, open: 0.18, wide: 1.10, smirk: 0.35, tilt: -0.03, squash: 0.30, drop: 0.00 },
  sad:       { browY: 0.06, browA: -0.05, browSad: 0.95, browSplit: 0.00, lid: 0.55, eyeHappy: 0.0, curve: -0.55, open: 0.05, wide: 0.70, smirk: 0.00, tilt: 0.08, squash: -0.85, drop: 0.16 },
  surprised: { browY: 0.32, browA: -0.25, browSad: 0, browSplit: 0.00, lid: 1.30, eyeHappy: 0.0, curve: 0.02, open: 0.60, wide: 0.45, smirk: 0.00, tilt: 0.00, squash: 0.35, drop: -0.06 },
  excited:   { browY: 0.24, browA: -0.05, browSad: 0, browSplit: 0.00, lid: 1.05, eyeHappy: 0.4, curve: 0.70, open: 0.34, wide: 1.15, smirk: 0.20, tilt: -0.02, squash: 0.50, drop: 0.00 },
};

/* emotion coloring layered over a base mood (so it can talk sadly, think
   excitedly…). Full-preset emotions take over when the mood is idle. */
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

/* arm poses, right side (sx=+1); left mirrors unless a pose overrides it.
   shoulder fixed at (±0.60, 0.30); e=elbow, h=hand in unit space. */
const ARMS = {
  neutral: { e: [0.80, -0.05], h: [0.66, -0.38] },
  droop:   { e: [0.72, -0.18], h: [0.58, -0.54] },
  cross:   { e: [0.84, 0.10], h: [-0.14, 0.16], eL: [-0.84, 0.02], hL: [0.16, 0.04] },
  wave:    { e: [0.94, 0.42], h: [1.04, 0.90], eL: [-0.80, -0.05], hL: [-0.66, -0.38] },
  cheer:   { e: [0.88, 0.30], h: [0.64, 0.74] },
  talk:    { e: [0.82, 0.02], h: [0.70, -0.04] },
  chin:    { e: [0.82, 0.06], h: [0.24, 0.52], eL: [-0.80, -0.05], hL: [-0.66, -0.38] },
  menace:  { e: [0.88, 0.18], h: [0.76, 0.34] },
};

/* the idle show — loops seamlessly until a real mood interrupts */
const SHOW = [
  { name: "idle", d: 1.5 },
  { name: "cross", d: 2.5 },
  { name: "wink", d: 1.0 },
  { name: "wave", d: 2.6 },
  { name: "laugh", d: 1.6 },
  { name: "sway", d: 2.0 },
];
const SHOW_LEN = SHOW.reduce((s, g) => s + g.d, 0);

/* underdamped spring: the soul of the over-emote. values overshoot their
   target and settle, like a hand-animated character. */
function springStep(x, v, target, dt, K, D) {
  v += ((target - x) * K - D * v) * dt;
  return [x + v * dt, v];
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
    if (v < 0.07) { const u = v / 0.07; R = 0.05 + u * 0.32; y = 1.5 + (1 - u) * 0.42; }
    else if (v < 0.32) { const u = (v - 0.07) / 0.25; R = Math.sin((0.35 + 0.65 * u) * Math.PI / 2); y = 1.5 - u * 0.9; }
    else if (v < 0.6) { const u = (v - 0.32) / 0.28; R = 1 - 0.05 * Math.sin(u * Math.PI); y = 0.6 - u; }
    else { const u = (v - 0.6) / 0.4; R = 1 - 0.16 * u; y = -0.4 + u * (hemY + 0.4); }
    const bend = 0.34 * Math.pow(Math.max(0, 1 - v / 0.2), 2);
    const rr = R * (0.9 + 0.1 * (((k * 9301) % 233) / 233));
    pts.push({ x: Math.cos(ang) * rr + bend, y, z: Math.sin(ang) * rr * 0.58 });
  }

  /* ---- spring-animated state ---- */
  const E = { ...FACE.idle };
  const EV = {}; for (const k in E) EV[k] = 0;
  const arm = {
    R: { ex: 0.80, ey: -0.05, hx: 0.66, hy: -0.38, vex: 0, vey: 0, vhx: 0, vhy: 0 },
    L: { ex: -0.80, ey: -0.05, hx: -0.66, hy: -0.38, vex: 0, vey: 0, vhx: 0, vhy: 0 },
  };
  let blinkT = 2.5, dartT = 2, dartX = 0, dartY = 0;
  let born = -1, wink = 0, ringBoost = 0, swayBias = 0;

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

    /* ---- pick the moment's acting: mood > emotion > idle show ---- */
    let gesture = "neutral", gLocal = 0;
    if (!settled) gesture = "neutral";
    else if (mood === "idle" || mood === "happy") {
      let gt = (age - 2.2) % SHOW_LEN;
      for (const g of SHOW) { if (gt < g.d) { gesture = g.name; gLocal = gt / g.d; break; } gt -= g.d; }
      if (["sad", "surprised"].includes(emotion)) gesture = "emote";   // big feelings pause the show
    } else gesture = mood === "talking" ? "talk" : mood === "thinking" ? "chin" : mood === "menace" ? "menace" : "neutral";

    const T = applyEmotion(FACE[mood] || FACE.idle, emotion, mood);
    if (mood === "talking") T.open = 0.1 + talkBeat * 0.42;
    if (gesture === "cross") { T.browA += 0.12; T.curve += 0.06; T.smirk = 0.7; }
    if (gesture === "wave") { T.curve += 0.18; T.lid = Math.min(1, T.lid + 0.1); }
    if (gesture === "wink") { T.curve += 0.22; }
    if (gesture === "laugh") {
      Object.assign(T, FACE.happy);
      T.open = 0.25 + Math.abs(Math.sin(t * 8)) * 0.28;               // laughing chatter
      T.squash = 0.55;
    }

    /* springs: overshoot + settle (K stiffness, D damping → underdamped) */
    for (const key in E) {
      const [nx, nv] = springStep(E[key], EV[key], T[key], dt, 140, 11);
      E[key] = nx; EV[key] = nv;
    }

    /* wink + sway + ring boost */
    const winkT = gesture === "wink" ? Math.sin(Math.min(1, Math.max(0, (gLocal - 0.15) / 0.7)) * Math.PI) : 0;
    wink += (winkT - wink) * Math.min(1, dt * 12);
    const swayT = gesture === "sway" ? Math.sin(gLocal * TAU) * 0.4 : 0;
    swayBias += (swayT - swayBias) * Math.min(1, dt * 5);
    ringBoost += (((gesture === "sway" || !settled) ? 1 : 0) - ringBoost) * Math.min(1, dt * 4);

    /* arms: spring toward the pose of the moment */
    const poseName =
      gesture === "laugh" ? "cheer" :
      gesture === "cross" || gesture === "wave" || gesture === "talk" || gesture === "chin" || gesture === "menace" ? gesture :
      (emotion === "sad" ? "droop" : emotion === "excited" ? "cheer" : "neutral");
    const pose = ARMS[poseName] || ARMS.neutral;
    const poseL = { e: pose.eL || [-pose.e[0], pose.e[1]], h: pose.hL || [-pose.h[0], pose.h[1]] };
    const waveSwing = gesture === "wave" ? Math.sin(t * 6.4) * 0.14 * Math.sin(Math.min(1, gLocal * 2) * Math.PI) : 0;
    const talkBob = gesture === "talk" ? Math.sin(t * 3.2) * 0.03 : 0;
    const AK = 80, AD = 10;
    const stepJoint = (j, k, target) => { const [nx, nv] = springStep(j[k], j["v" + k], target, dt, AK, AD); j[k] = nx; j["v" + k] = nv; };
    stepJoint(arm.R, "ex", pose.e[0]); stepJoint(arm.R, "ey", pose.e[1]);
    stepJoint(arm.R, "hx", pose.h[0] + waveSwing); stepJoint(arm.R, "hy", pose.h[1] + talkBob);
    stepJoint(arm.L, "ex", poseL.e[0]); stepJoint(arm.L, "ey", poseL.e[1]);
    stepJoint(arm.L, "hx", poseL.h[0]); stepJoint(arm.L, "hy", poseL.h[1] - talkBob);

    /* blink + eye darts */
    blinkT -= dt; if (blinkT < -0.14) blinkT = 2.2 + ((t * 997) % 1) * 3.2;
    const blink = blinkT < 0.14 && blinkT > -0.14 ? Math.abs(blinkT / 0.14) : 1;
    dartT -= dt; if (dartT < 0) { dartT = 1.6 + ((t * 131) % 1) * 2.6; dartX = (((t * 379) % 1) - 0.5) * 1.4; dartY = (((t * 733) % 1) - 0.5) * 0.8; }
    const lookX = Math.abs(px) + Math.abs(py) > 0.02 ? px * 2 : dartX;
    const lookY = Math.abs(px) + Math.abs(py) > 0.02 ? py * 1.4 : dartY;

    /* squash & stretch: volume-preserving; sadness slumps, joy bounces */
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

    ctx2.globalCompositeOperation = "lighter";

    /* summoning ring; flares while forming or showing off */
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
      /* soft light cone rising from the ring — no hard edges */
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

    /* materializing: data dust rising from the ring into the body */
    if (!settled) {
      for (let i = 0; i < 30; i++) {
        const dx = Math.sin(i * 2.13) * 0.95;
        const p = (t * 1.5 + i * 0.37) % 1;
        const dy = -1.7 + p * (revealY + 1.75);
        ctx2.fillStyle = A((1 - reveal) * (0.7 - p * 0.4));
        ctx2.fillRect(X(dx), Y(dy), 1.6, 3.5);
      }
    }

    /* wisp flames: dimmer and lower when it's sad */
    const wispMood = emotion === "sad" ? 0.45 : 1;
    if (reveal > 0.6) for (const ph of [0, Math.PI]) {
      const a = t * 0.8 * wispMood + ph;
      const al = (Math.sin(a) > 0 ? 0.4 : 0.85) * faceAlpha * wispMood;
      const wr = scale * (0.055 + Math.sin(t * 7 + ph) * 0.008);
      for (let tail = 3; tail >= 0; tail--) {
        const ta = a - tail * 0.13;
        const txp = X(Math.cos(ta) * 1.18), typ = Y(0.35 - (1 - wispMood) * 0.3 + Math.sin(ta * 2) * 0.14);
        const g = ctx2.createRadialGradient(txp, typ, 0, txp, typ, Math.max(0.5, wr * (1 - tail * 0.18)));
        g.addColorStop(0, `rgba(235,255,246,${Math.max(0, (al - tail * 0.16)) * (0.8 + pulse * 0.2)})`);
        g.addColorStop(0.5, A(Math.max(0, al - tail * 0.16) * 0.6));
        g.addColorStop(1, A(0));
        ctx2.fillStyle = g;
        ctx2.beginPath(); ctx2.arc(txp, typ, Math.max(0.5, wr * (1 - tail * 0.18) * 2.2), 0, TAU); ctx2.fill();
      }
    }

    /* body: hologram particles, tendrils flowing */
    const rot = Math.sin(t * 0.4) * 0.35 + px * 0.7 + swayBias;
    const cosR = Math.cos(rot), sinR = Math.sin(rot);
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
      const a = (0.22 + depth * 0.55 + pulse * 0.3) * edge;
      ctx2.fillStyle = `rgba(${mr},${mg},${mb},${Math.min(0.95, a)})`;
      const sz = 0.95 + depth * 1.35 + talkBeat * 0.3;
      ctx2.fillRect(X(rx + warp), Y(ny), sz, sz);
    }

    /* arms + friendly rounded hands */
    if (faceAlpha > 0.05) {
      const drawArm = (side, j) => {
        const shX = side * 0.60 * cosR, shY = 0.30;
        ctx2.strokeStyle = A(0.55 * faceAlpha);
        ctx2.lineCap = "round";
        ctx2.shadowColor = A(0.7);
        ctx2.shadowBlur = 8 + pulse * 6;
        ctx2.lineWidth = scale * 0.075;
        ctx2.beginPath();
        ctx2.moveTo(X(shX), Y(shY));
        ctx2.quadraticCurveTo(X(j.ex), Y(j.ey), X((j.ex + j.hx) / 2), Y((j.ey + j.hy) / 2));
        ctx2.stroke();
        ctx2.lineWidth = scale * 0.058;
        ctx2.beginPath();
        ctx2.moveTo(X((j.ex + j.hx) / 2), Y((j.ey + j.hy) / 2));
        ctx2.quadraticCurveTo(X(j.ex * 0.35 + j.hx * 0.65), Y(j.ey * 0.35 + j.hy * 0.65), X(j.hx), Y(j.hy));
        ctx2.stroke();
        const dirA = Math.atan2(-(j.hy - j.ey), j.hx - j.ex);
        const hx = X(j.hx), hy = Y(j.hy);
        const pr = scale * 0.062;
        const pg = ctx2.createRadialGradient(hx, hy, 0, hx, hy, pr * 1.6);
        pg.addColorStop(0, `rgba(235,255,246,${0.75 * faceAlpha})`);
        pg.addColorStop(0.6, A(0.55 * faceAlpha));
        pg.addColorStop(1, A(0));
        ctx2.fillStyle = pg;
        ctx2.beginPath(); ctx2.arc(hx, hy, pr * 1.5, 0, TAU); ctx2.fill();
        for (const f of [-0.55, 0, 0.55]) {
          const fa = dirA + f * 0.55;
          ctx2.fillStyle = A(0.7 * faceAlpha);
          ctx2.beginPath(); ctx2.arc(hx + Math.cos(fa) * pr * 1.5, hy + Math.sin(fa) * pr * 1.5, pr * 0.42, 0, TAU); ctx2.fill();
        }
        ctx2.shadowBlur = 0;
      };
      drawArm(1, arm.R);
      drawArm(-1, arm.L);
    }

    /* amulet: diamond gem at the chest */
    if (faceAlpha > 0.05) {
      const ax = X(0.02 * cosR), ay = Y(0.16);
      const ar = scale * (0.075 + Math.sin(t * 2.1) * 0.006 + pulse * 0.02);
      ctx2.save();
      ctx2.translate(ax, ay);
      ctx2.rotate(Math.sin(t * 0.9) * 0.08);
      const ag = ctx2.createLinearGradient(0, -ar, 0, ar);
      ag.addColorStop(0, `rgba(235,255,246,${0.92 * faceAlpha})`);
      ag.addColorStop(1, A(0.65 * faceAlpha));
      ctx2.fillStyle = ag;
      ctx2.shadowColor = A(0.9);
      ctx2.shadowBlur = 14 + pulse * 10;
      ctx2.beginPath();
      ctx2.moveTo(0, -ar); ctx2.lineTo(ar * 0.62, 0); ctx2.lineTo(0, ar); ctx2.lineTo(-ar * 0.62, 0);
      ctx2.closePath(); ctx2.fill();
      ctx2.strokeStyle = A(0.5 * faceAlpha);
      ctx2.lineWidth = 1;
      ctx2.beginPath(); ctx2.arc(0, 0, ar * 1.6, 0, TAU); ctx2.stroke();
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

    /* ================= the FACE — where the acting happens ================= */
    if (faceAlpha > 0.02) {
      ctx2.save();
      ctx2.globalAlpha = faceAlpha;
      const faceCx = cx + (0.06 * cosR) * scale * breath;
      ctx2.translate(faceCx, Y(0.9 - E.drop));
      ctx2.rotate(E.tilt + Math.sin(t * 0.8) * 0.012 + swayBias * 0.25);

      const s = scale * breath;
      const lid = Math.max(0.08, E.lid * blink - thinkBeat * 0.05);
      const eyeHappy = Math.max(0, Math.min(1, E.eyeHappy));

      /* eyebrows: the actors. furrow = villain, sad = puppy, up = surprise */
      ctx2.lineCap = "round";
      ctx2.shadowColor = A(0.9);
      ctx2.shadowBlur = 10 + pulse * 8;
      for (const side of [-1, 1]) {
        const raise = side === -1 ? E.browSplit : 0;
        const byIn = -(0.30 + E.browY + raise) * s + E.browA * 0.22 * s - E.browSad * 0.10 * s;
        const byOut = -(0.30 + E.browY + raise) * s - E.browA * 0.10 * s + E.browSad * 0.17 * s;
        ctx2.strokeStyle = A(0.95);
        ctx2.lineWidth = s * 0.055;
        ctx2.beginPath();
        ctx2.moveTo(side * 0.10 * s, byIn);
        ctx2.quadraticCurveTo(side * 0.28 * s, byIn - 0.06 * s * (1 - E.browA - E.browSad), side * 0.45 * s, byOut);
        ctx2.stroke();
      }

      /* eyes: almond glow + darting pupil; melt into delighted arcs when
         it's overjoyed; the right one shuts for the wink */
      for (const side of [-1, 1]) {
        const shut = side === 1 ? Math.max(0, 1 - wink * 1.4) : 1;
        const eh = 0.135 * s * lid * shut * (1 - eyeHappy * 0.9);
        const ew = 0.205 * s;
        ctx2.save();
        ctx2.translate(side * 0.30 * s, -0.10 * s);
        ctx2.rotate(side * -0.10 + side * -E.browA * 0.18 + side * E.browSad * 0.14);
        if (eyeHappy > 0.08) {                                     // joyful ∩ arcs
          ctx2.strokeStyle = A(0.95 * eyeHappy);
          ctx2.lineWidth = s * 0.05;
          ctx2.beginPath(); ctx2.arc(0, eh + s * 0.05, ew * 0.72, Math.PI * 1.12, Math.PI * 1.88); ctx2.stroke();
        }
        if (eh > 0.012 && eyeHappy < 0.9) {
          const eg = ctx2.createRadialGradient(0, 0, 0, 0, 0, ew);
          eg.addColorStop(0, `rgba(238,255,248,${(0.95 + pulse * 0.05) * (1 - eyeHappy)})`);
          eg.addColorStop(0.55, A(0.85 * (1 - eyeHappy)));
          eg.addColorStop(1, A(0.12 * (1 - eyeHappy)));
          ctx2.fillStyle = eg;
          ctx2.beginPath();
          ctx2.moveTo(-ew, 0);
          ctx2.quadraticCurveTo(0, -eh * 1.6, ew, 0);
          ctx2.quadraticCurveTo(0, eh * 1.25, -ew, 0);
          ctx2.fill();
          const pxp = Math.max(-1, Math.min(1, lookX)) * ew * 0.42;
          const pyp = Math.max(-1, Math.min(1, lookY)) * eh * 0.5 + E.browSad * eh * 0.3;
          ctx2.shadowBlur = 0;
          ctx2.fillStyle = "rgba(2,12,9,0.92)";
          ctx2.beginPath(); ctx2.ellipse(pxp, pyp, eh * 0.62, eh * 0.62 * 1.15, 0, 0, TAU); ctx2.fill();
          ctx2.fillStyle = "rgba(240,255,250,0.9)";
          ctx2.beginPath(); ctx2.arc(pxp - eh * 0.2, pyp - eh * 0.24, Math.max(0.6, eh * 0.14), 0, TAU); ctx2.fill();
          ctx2.shadowColor = A(0.9);
          ctx2.shadowBlur = 10 + pulse * 8;
        } else if (eh <= 0.012 && eyeHappy < 0.08) {
          ctx2.strokeStyle = A(0.9);                               // cheeky shut-eye arc
          ctx2.lineWidth = s * 0.03;
          ctx2.beginPath(); ctx2.arc(0, 0, ew * 0.7, 0.15 * Math.PI, 0.85 * Math.PI); ctx2.stroke();
        }
        ctx2.restore();
      }

      /* a glowing tear wells and falls when it's really sad */
      if (E.browSad > 0.55) {
        const tp = (t * 0.45) % 1;
        const ty = 0.02 * s + tp * 0.26 * s;
        ctx2.fillStyle = `rgba(190,255,235,${(1 - tp) * 0.85 * (E.browSad - 0.55) * 2.2})`;
        ctx2.beginPath();
        ctx2.ellipse(-0.30 * s, ty, s * 0.02, s * 0.03, 0, 0, TAU);
        ctx2.fill();
      }

      /* wink sparkle */
      if (wink > 0.5) {
        const wx = 0.44 * s, wy = -0.22 * s, wl = s * 0.09 * (wink - 0.5) * 2;
        ctx2.strokeStyle = `rgba(240,255,250,${(wink - 0.5) * 2})`;
        ctx2.lineWidth = 1.5;
        ctx2.beginPath();
        ctx2.moveTo(wx - wl, wy); ctx2.lineTo(wx + wl, wy);
        ctx2.moveTo(wx, wy - wl); ctx2.lineTo(wx, wy + wl);
        ctx2.moveTo(wx - wl * 0.6, wy - wl * 0.6); ctx2.lineTo(wx + wl * 0.6, wy + wl * 0.6);
        ctx2.moveTo(wx - wl * 0.6, wy + wl * 0.6); ctx2.lineTo(wx + wl * 0.6, wy - wl * 0.6);
        ctx2.stroke();
      }

      /* mouth: full range — grin, frown, O of surprise, laugh, talk, fangs.
         smile: corners up, belly down. frown: corners DOWN, arch UP. */
      const frown = Math.max(0, -E.curve);
      const grin = Math.max(0, E.curve);
      const mw = 0.46 * E.wide * s;
      const cornL = E.smirk * 0.05 * s + frown * 0.13 * s;
      const cornR = -E.smirk * 0.085 * s + frown * 0.13 * s;
      const topC = -grin * 0.16 * s - E.open * 0.16 * s - frown * 0.11 * s;
      const botC = E.open * 0.32 * s + grin * 0.03 * s - frown * 0.05 * s;
      ctx2.save();
      ctx2.translate(0.03 * s, 0.32 * s + E.browSad * 0.02 * s);
      ctx2.beginPath();
      ctx2.moveTo(-mw, cornL);
      ctx2.quadraticCurveTo(0, topC, mw, cornR);
      ctx2.quadraticCurveTo(0, botC + Math.max(0, E.curve) * 0.1 * s, -mw, cornL);
      ctx2.closePath();
      if (E.open > 0.06) { ctx2.fillStyle = "rgba(1,8,6,0.88)"; ctx2.fill(); }
      ctx2.strokeStyle = A(0.92);
      ctx2.lineWidth = Math.max(1.2, s * 0.032);
      ctx2.stroke();
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
    }
    ctx2.globalCompositeOperation = "source-over";
  };

  return { draw };
}
