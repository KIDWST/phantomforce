/* PhantomForce Phantom — shell, overlay engine, ghost, ticker, command deck. */

import {
  store, ctx, session, resolveSession, isAdmin, currentWs, setWorkspace, wsName,
  visible, todaysPlan, moneyView, fmtMoney, ago,
} from "./store.js";
import { handleCommand, commandSuggestions } from "./command.js";
import { WORKSPACE_DEFS, missionWidgets, esc } from "./workspaces.js";

const $ = (sel, root = document) => root.querySelector(sel);
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const gate = $("[data-gate]");
const phantom = $("[data-phantom]");
const overlayRoot = $("[data-overlay-root]");

/* ============================ access gate ============================ */
function showGate() {
  gate.hidden = false;
  phantom.hidden = true;
  gate.querySelectorAll("[data-enter]").forEach((btn) => {
    btn.onclick = () => {
      const kind = btn.dataset.enter;
      ctx.session = kind === "admin"
        ? { role: "admin", name: "Jordan", ws: "phantomforce" }
        : { role: "client", name: "Test Client", ws: "test-client" };
      session.set(ctx.session);
      enterPhantom();
    };
  });
}

/* ============================ shell ============================ */
function renderTopbar() {
  $("[data-role-sub]").textContent = isAdmin() ? "ADMIN PHANTOM" : "CLIENT PORTAL";
  const wsLabel = wsName(ctx.session.ws);
  $("[data-identity]").textContent = isAdmin()
    ? `${ctx.session.name} · operator`
    : (ctx.session.name === wsLabel ? `${wsLabel} · workspace` : `${ctx.session.name} · ${wsLabel}`);
  const wrap = $("[data-org-wrap]");
  const select = $("[data-org-select]");
  if (isAdmin()) {
    wrap.hidden = false;
    select.innerHTML = store.state.workspaces
      .map((w) => `<option value="${w.id}" ${w.id === currentWs() ? "selected" : ""}>${esc(w.name)} — ${esc(w.kind)}</option>`)
      .join("");
    select.onchange = () => { setWorkspace(select.value); renderDashboard(); };
  } else {
    wrap.hidden = true;
  }
  $("[data-signout]").onclick = () => { session.clear(); ctx.session = null; closeOverlay(true); showGate(); };
}

/* ============================ ticker ============================ */
let tickerTimer = 0, tickerIdx = 0;
function startTicker() {
  const line = $("[data-ticker-line]");
  const feed = () => {
    const items = visible(store.state.activity);
    if (!items.length) { line.textContent = "The desks are quiet. Ask for something."; return; }
    tickerIdx = (tickerIdx + 1) % items.length;
    const a = items[tickerIdx];
    line.classList.remove("ticker-in");
    void line.offsetWidth;
    line.textContent = `${a.who} ${a.text}`;
    line.classList.add("ticker-in");
  };
  clearInterval(tickerTimer);
  feed();
  tickerTimer = setInterval(feed, 4200);
}

/* ============================ mission grid ============================ */
function renderMission() {
  const grid = $("[data-mission]");
  grid.innerHTML = missionWidgets().map((w) => `
    <button class="widget ${w.alert ? "widget-alert" : ""}" data-open-ws="${w.id}">
      <span class="widget-icon" aria-hidden="true">${w.icon}</span>
      <span class="widget-title">${esc(w.title)}</span>
      <span class="widget-stat">${esc(w.stat)}</span>
      <span class="widget-sub">${esc(w.sub)}</span>
    </button>`).join("");
}

/* ============================ rail ============================ */
function renderRail() {
  const plan = todaysPlan();
  $("[data-rail-plan] .rail-body").innerHTML = plan.length
    ? plan.map((p) => `<button class="rail-item" data-open-ws="${p.open}"><i>${p.icon}</i><span>${esc(p.text)}</span></button>`).join("")
    : `<p class="rail-empty">Clear runway. The desks are working the routine.</p>`;

  const m = moneyView();
  $("[data-rail-money] .rail-body").innerHTML = `
    <button class="rail-item rail-money" data-open-ws="money">
      <span class="rail-money-big">${fmtMoney(m.pipeline)}</span>
      <span>open pipeline · ${fmtMoney(m.wonValue)} won · ${fmtMoney(m.retainerMonthly)}/mo retainers</span>
    </button>`;

  const pend = visible(store.state.approvals).filter((a) => a.status === "pending");
  $("[data-rail-approvals] .rail-body").innerHTML = pend.length
    ? pend.slice(0, 4).map((a) => `<button class="rail-item rail-approval" data-open-ws="approvals"><i>◈</i><span>${esc(a.title)}</span></button>`).join("")
    : `<p class="rail-empty">Nothing waiting on you.</p>`;

  $("[data-rail-work] .rail-body").innerHTML = visible(store.state.activity).slice(0, 4)
    .map((a) => `<div class="rail-item rail-static"><span><b>${esc(a.who)}</b> ${esc(a.text)}</span><i>${ago(a.at)}</i></div>`).join("")
    || `<p class="rail-empty">Quiet.</p>`;
}

function renderDashboard() {
  renderTopbar();
  renderMission();
  renderRail();
  renderSuggests();
  startTicker();
}

/* ============================ command deck ============================ */
const sayBox = () => $("[data-say]");
let typeTimer = 0;
let ghostMood = "idle";
let ghostEmotion = "calm";
let ghostMoodUntil = 0;

function emotionForText(text = "") {
  const s = text.toLowerCase();
  if (/security|scan|breach|risk|threat|password|malware|approval|waiting|blocked|paid/.test(s)) return "alert";
  if (/money|pipeline|won|revenue|quote|proposal|ready|captured|drafted|live/.test(s)) return "bright";
  if (/clear|current|nothing waiting|clean|welcome/.test(s)) return "happy";
  return "calm";
}

function setGhostMood(mood, options = {}) {
  ghostMood = mood;
  ghostEmotion = options.emotion || ghostEmotion;
  ghostMoodUntil = options.ms ? performance.now() + options.ms : 0;
}

function speak(text, cls = "") {
  clearTimeout(typeTimer);
  const p = document.createElement("p");
  p.className = `say-line ${cls}`.trim();
  sayBox().replaceChildren(p);
  const emotion = emotionForText(text);
  if (cls === "thinking") setGhostMood("thinking", { emotion: "bright" });
  else if (cls === "user") setGhostMood("listening", { emotion: "calm", ms: 1600 });
  else setGhostMood("talking", { emotion, ms: Math.max(1500, text.length * 36) });

  if (cls || reduceMotion) {
    p.textContent = text;
    if (!cls) setGhostMood(emotion, { emotion, ms: 1800 });
    return;
  }
  let i = 0;
  const tick = () => {
    p.textContent = text.slice(0, i);
    if (i++ < text.length) typeTimer = setTimeout(tick, 11 + Math.random() * 16);
    else setGhostMood(emotion, { emotion, ms: 1800 });
  };
  tick();
}

function cardHtml(c) {
  return `
    <article class="rcard">
      <p class="rcard-kicker">${esc(c.kicker)}</p>
      <h4>${esc(c.title)}</h4>
      ${c.body ? `<p class="rcard-body">${esc(c.body)}</p>` : ""}
      ${c.meta ? `<p class="rcard-meta">${esc(c.meta)}</p>` : ""}
      ${c.actions?.length ? `<div class="rcard-actions">${c.actions.map((a) => `<button class="btn" data-open-ws="${a.open}">${esc(a.label)}</button>`).join("")}</div>` : ""}
    </article>`;
}

function runCommand(text) {
  speak(text, "user");
  ghostFlare("listening");
  const respBox = $("[data-response]");
  respBox.innerHTML = "";
  setTimeout(() => {
    speak("· · ·", "thinking");
    setTimeout(() => {
      const r = handleCommand(text);
      speak(r.say);
      respBox.innerHTML = (r.cards || []).map(cardHtml).join("");
      renderDashboard();
      if (r.open) setTimeout(() => openWorkspace(r.open), reduceMotion ? 150 : 750);
    }, reduceMotion ? 120 : 620);
  }, reduceMotion ? 60 : 260);
}

function renderSuggests() {
  $("[data-suggests]").innerHTML = commandSuggestions()
    .map((s) => `<button class="suggest" data-suggest="${esc(s)}">${esc(s)}</button>`).join("");
}

function wireCommandDeck() {
  const form = $("[data-command-form]");
  const input = $("[data-command-input]");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = input.value.trim();
    if (!v) return;
    input.value = "";
    runCommand(v);
  });
  document.addEventListener("click", (e) => {
    const sug = e.target.closest("[data-suggest]");
    if (sug) { runCommand(sug.dataset.suggest); return; }
    const opener = e.target.closest("[data-open-ws]");
    if (opener) openWorkspace(opener.dataset.openWs);
  });
}

/* ============================ overlay engine ============================ */
let openId = null;
function openWorkspace(id, pushHash = true) {
  const def = WORKSPACE_DEFS[id];
  if (!def) return;
  if (def.adminOnly && !isAdmin()) return;
  closeOverlay(false);
  openId = id;
  document.body.classList.add("overlay-open");
  overlayRoot.innerHTML = `
    <div class="overlay" role="dialog" aria-modal="true" aria-label="${esc(def.title)}">
      <button class="overlay-backdrop" data-overlay-close aria-label="Back to phantom"></button>
      <section class="overlay-panel">
        <header class="overlay-head">
          <div>
            <p class="overlay-kicker">${esc(def.kicker)}${isAdmin() && currentWs() !== "phantomforce" ? ` · ${esc(wsName(currentWs()))}` : ""}</p>
            <h2>${esc(def.title)}</h2>
          </div>
          <button class="overlay-x" data-overlay-close aria-label="Close workspace">✕</button>
        </header>
        <div class="overlay-body" data-overlay-body></div>
      </section>
    </div>`;
  const body = $("[data-overlay-body]", overlayRoot);
  const rerender = () => { def.render(body, rerender); if (id === "phantom") wirePhantomConsole(body); };
  rerender();
  overlayRoot.querySelectorAll("[data-overlay-close]").forEach((b) => b.addEventListener("click", () => closeOverlay(true)));
  if (pushHash && location.hash !== `#ws/${id}`) {
    try { history.pushState(null, "", `#ws/${id}`); } catch {}
  }
}

function closeOverlay(clearHash) {
  if (!openId) return;
  openId = null;
  overlayRoot.innerHTML = "";
  document.body.classList.remove("overlay-open");
  if (clearHash && location.hash.startsWith("#ws/")) {
    try { history.pushState(null, "", location.pathname + location.search); } catch {}
  }
  renderDashboard();
}

document.addEventListener("keydown", (e) => { if (e.key === "Escape" && openId) closeOverlay(true); });
window.addEventListener("popstate", () => {
  const m = location.hash.match(/^#ws\/([a-z]+)/);
  if (m && WORKSPACE_DEFS[m[1]]) openWorkspace(m[1], false);
  else closeOverlay(false);
});

/* ============================ phantom console ============================ */
const phantomHistory = [];
function wirePhantomConsole(body) {
  const log = $("[data-phantom-log]", body);
  const form = $("[data-phantom-form]", body);
  const input = $("[data-phantom-input]", body);
  const paint = () => {
    log.innerHTML = phantomHistory.map((h) => `
      <div class="phantom-entry">
        <p class="phantom-user">› ${esc(h.q)}</p>
        <p class="phantom-reply">${esc(h.say)}</p>
        ${(h.cards || []).map(cardHtml).join("")}
      </div>`).join("") || `<p class="phantom-hello">This is the full command console. Everything you ask lands as real work — drafts, briefs, and pipelines, never just chat.</p>`;
    log.scrollTop = log.scrollHeight;
  };
  paint();
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = input.value.trim();
    if (!v) return;
    input.value = "";
    const r = handleCommand(v);
    phantomHistory.push({ q: v, say: r.say, cards: r.cards });
    paint();
    renderDashboard();
  });
  setTimeout(() => input.focus(), 60);
}

/* ============================ ghost (2D particle entity) ============================ */
let ghostPulse = 0;
function ghostFlare(mood = "bright") {
  ghostPulse = 1;
  setGhostMood(mood, { emotion: mood === "listening" ? "calm" : mood, ms: 1200 });
}
function initGhost() {
  const canvas = $("[data-ghost]");
  if (!canvas || reduceMotion) return;
  const ctx2 = canvas.getContext("2d");
  if (!ctx2) return;
  const small = window.matchMedia("(max-width: 720px)").matches;
  const N = small ? 700 : 1300;
  const GA = 2.399963229728653, NTEND = 7;
  const pts = [];
  for (let k = 0; k < N; k++) {
    const v = k / (N - 1);
    const angp = k * GA;
    const tend = Math.pow(0.5 + 0.5 * Math.cos(angp * NTEND), 1.7);
    const hemY = -0.6 - tend * 1.05;
    let R, y;
    if (v < 0.3) { const u = v / 0.3; R = Math.sin((u * Math.PI) / 2); y = 1.55 - u * 0.95; }
    else if (v < 0.6) { const u = (v - 0.3) / 0.3; R = 1 - 0.05 * Math.sin(u * Math.PI); y = 0.6 - u; }
    else { const u = (v - 0.6) / 0.4; R = 1 - 0.16 * u; y = -0.4 + u * (hemY + 0.4); }
    const rr = R * (0.9 + 0.1 * (((k * 9301) % 233) / 233));
    /* round body (no front-back flattening) so her silhouette stays the same
       width from every angle — she never looks like a different shape mid-spin */
    pts.push({ x: Math.cos(angp) * rr, y, z: Math.sin(angp) * rr });
  }
  let w = 0, h = 0, dpr = 1;
  const resize = () => {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = Math.max(1, r.width); h = Math.max(1, r.height);
    canvas.width = w * dpr; canvas.height = h * dpr;
  };
  resize();
  window.addEventListener("resize", resize, { passive: true });
  let px = 0, cpx = 0;
  window.addEventListener("pointermove", (e) => { px = e.clientX / innerWidth - 0.5; }, { passive: true });
  let lastMood = "idle", spinAt = -1, nextSpin = 0, idleQuirk = 5;   // Midna-style flourish timers
  let lastT = 0, sway = 0, prevTilt = 0;                             // hem follow-through
  /* pixie dust: twinkling 4-point sparkles shed from the body — more while
     she talks, a storm through every pirouette */
  const sparkles = [];
  const SPARK_MAX = small ? 60 : 110;
  const spawnSpark = (x, y) => {
    if (sparkles.length >= SPARK_MAX) return;
    sparkles.push({
      x, y,
      vx: (Math.random() - 0.5) * 26,
      vy: 6 + Math.random() * 20,
      life: 0, max: 0.9 + Math.random() * 1.2,
      r: 1.2 + Math.random() * 2.4,
      tw: 4 + Math.random() * 8,
      gold: Math.random() < 0.3,   // warm glints scattered through the green magic
    });
  };
  const t0 = performance.now();
  const accents = {
    calm: [65, 255, 161],
    happy: [132, 255, 207],
    bright: [30, 240, 255],
    alert: [255, 92, 116],
  };
  const frame = (now) => {
    if (document.hidden) { requestAnimationFrame(frame); return; }
    const t = (now - t0) * 0.001;
    const dt = Math.min(0.05, Math.max(0.001, t - lastT)); lastT = t;
    if (ghostMoodUntil && now > ghostMoodUntil) {
      ghostMood = "idle";
      ghostMoodUntil = 0;
    }
    ghostPulse = Math.max(0, ghostPulse - 0.02);
    cpx += (px - cpx) * 0.05;
    ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx2.clearRect(0, 0, w, h);
    const scale = Math.min(w, h) * 0.30;
    /* she drifts on a gentle figure-8 arc rather than bobbing in place */
    const cx = w / 2 + Math.sin(t * 0.6) * scale * 0.05, cy = h * 0.56;
    /* spin flourishes: a full pirouette when she starts talking, more mid-speech,
       and the occasional playful roll while idle so she never sits still */
    if (ghostMood !== lastMood) {
      if (ghostMood === "talking") { spinAt = t; nextSpin = t + 2.2 + Math.random() * 2.4; }
      lastMood = ghostMood;
    }
    if (ghostMood === "talking" && t > nextSpin) { spinAt = t; nextSpin = t + 2.2 + Math.random() * 2.8; }
    if (ghostMood === "idle" && t > idleQuirk) { spinAt = t; idleQuirk = t + 8 + Math.random() * 9; }
    /* three-phase pirouette, classic-animation style: anticipation (crouch +
       wind back), the leap-and-twirl, then an elastic overshoot settle */
    const WIND = 0.22, SPIN = 0.85, SETTLE = 0.55;
    let spinOff = 0, spinHop = 0, airStretch = 0, settleWob = 0;
    if (spinAt >= 0) {
      const el = t - spinAt;
      if (el < WIND) {
        const p = el / WIND;
        spinOff = -0.35 * p * p;                    // winds back the other way
        spinHop = -0.45 * Math.sin(p * Math.PI / 2); // dips down
        airStretch = -0.3 * p;                       // crouch squash (wide + short)
      } else if (el < WIND + SPIN) {
        const p = (el - WIND) / SPIN;
        const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;   // ease-in-out
        spinOff = -0.35 * (1 - e) + e * Math.PI * 2;
        spinHop = Math.sin(p * Math.PI);             // leaps as she twirls
        airStretch = 0.28 * Math.sin(p * Math.PI);   // stretches tall in the air
      } else if (el < WIND + SPIN + SETTLE) {
        const p = (el - WIND - SPIN) / SETTLE;
        settleWob = Math.sin(p * Math.PI * 3) * (1 - p) * 0.09;   // wobbles to rest
      } else spinAt = -1;
    }
    const rot = t * 0.22 + cpx * 0.45 + spinOff;
    const cosR = Math.cos(rot), sinR = Math.sin(rot);
    const talkBeat = ghostMood === "talking" ? Math.abs(Math.sin(t * 9.5)) : 0;
    const thinkBeat = ghostMood === "thinking" ? Math.abs(Math.sin(t * 5.2)) : 0;
    const breath = 1 + Math.sin(t * 0.9) * 0.018 + ghostPulse * 0.05 + talkBeat * 0.012;
    const floatY = Math.sin(t * 1.1) * 4 + Math.sin(t * 3.2) * (ghostMood === "talking" ? 2.2 : 0.7)
      - spinHop * scale * 0.14
      - (ghostMood === "talking" ? Math.abs(Math.sin(t * 4.6)) * scale * 0.045 : 0);
    const accent = accents[ghostEmotion] || accents.calm;
    const accentCss = (alpha) => `rgba(${accent[0]},${accent[1]},${accent[2]},${alpha})`;

    /* whole-body language: head-waggle tilt while talking, pensive cock while
       thinking, lean-in while listening; squash & stretch on the talk beat */
    const tilt = (
      ghostMood === "talking" ? Math.sin(t * 3.3) * 0.11 + Math.sin(t * 1.4) * 0.04 :
      ghostMood === "thinking" ? 0.12 + Math.sin(t * 1.2) * 0.05 :
      ghostMood === "listening" ? -0.07 :
      Math.sin(t * 0.7) * 0.035
    ) + settleWob;
    const squash = talkBeat * 0.03 + ghostPulse * 0.02 + airStretch * 0.3 + settleWob * 0.4;
    /* follow-through: the hem lags behind the head's tilt, whipping after her */
    const tiltV = (tilt - prevTilt) / dt; prevTilt = tilt;
    sway += (tiltV * -0.06 - sway) * Math.min(1, dt * 5);
    sway = Math.max(-0.4, Math.min(0.4, sway));
    ctx2.save();
    ctx2.translate(cx, cy);
    ctx2.rotate(tilt);
    ctx2.scale(1 - squash * 0.8, 1 + squash);
    ctx2.translate(-cx, -cy);

    ctx2.globalCompositeOperation = "lighter";
    ctx2.save();
    ctx2.translate(cx, cy + scale * 0.64 + floatY * 0.35);
    ctx2.rotate(rot * 0.32);
    for (let ring = 0; ring < 3; ring++) {
      const pulse = (t * 0.38 + ring / 3) % 1;
      ctx2.strokeStyle = accentCss((0.22 - pulse * 0.16) * (ghostMood === "thinking" ? 1.3 : 0.8));
      ctx2.lineWidth = 1;
      ctx2.beginPath();
      ctx2.ellipse(0, 0, scale * (0.72 + pulse * 0.48), scale * (0.13 + pulse * 0.08), 0, 0, Math.PI * 2);
      ctx2.stroke();
    }
    ctx2.restore();

    ctx2.globalCompositeOperation = "lighter";
    /* dust-per-second scales with how animated she is; sparkles sample the
       visible body so they shed from her silhouette */
    const emitRate = (ghostMood === "talking" ? 24 : 6) + (spinAt >= 0 ? 60 : 0) + ghostPulse * 80;
    const sparkProb = (emitRate * dt) / N;
    for (const p of pts) {
      let ny = p.y;
      if (p.y < -0.2) {
        const m = Math.min(1, (-0.2 - p.y) / 1.2);
        ny = p.y + (Math.sin(p.x * 4 + t * 2.4) * 0.09 + Math.sin(p.z * 5 - t * 1.7) * 0.05) * m;
      }
      const moodWarp = ghostMood === "thinking" ? Math.sin(t * 6 + p.x * 4 + p.z * 3) * 0.018 : 0;
      const rx = p.x * cosR + p.z * sinR;
      const rz = -p.x * sinR + p.z * cosR;
      const X = cx + (rx + moodWarp) * scale * breath + sway * Math.max(0, -ny) * scale;
      const Y = cy - ny * scale * breath + floatY;
      if (Math.random() < sparkProb) spawnSpark(X, Y);
      const depth = (rz + 1) / 2;
      const a = 0.16 + depth * 0.5 + ghostPulse * 0.3;
      const greenMix = ghostEmotion === "alert" ? 0.55 : 1;
      const r = Math.round(65 * greenMix + accent[0] * (1 - greenMix));
      const g = Math.round(255 * greenMix + accent[1] * (1 - greenMix));
      const b = Math.round(161 * greenMix + accent[2] * (1 - greenMix));
      ctx2.fillStyle = `rgba(${r},${g},${b},${Math.min(0.92, a)})`;
      const sz = 0.82 + depth * 1.25 + talkBeat * 0.15;
      ctx2.fillRect(X, Y, sz, sz);
    }
    /* ————— her face: big soft eyes with pupils, rosy cheeks, chibi mouth.
       Anchored to the head (not the spinning cloud) so it never distorts;
       it fades out mid-pirouette when her back is turned, then returns ————— */
    const faceA = Math.max(0, Math.cos(spinOff));
    if (faceA > 0.02) {
      ctx2.globalCompositeOperation = "source-over";
      ctx2.globalAlpha = faceA;
      const bp = t % 3.7;   // eased lid sweep every few seconds, not an instant snap
      const blink = bp < 0.26 ? Math.max(0.08, Math.abs(bp / 0.13 - 1)) : 1;
      const happyFace = ghostMood === "happy" || ghostEmotion === "happy";
      const lookX = cpx * scale * 0.07 + (ghostMood === "talking" ? Math.sin(t * 1.9) * scale * 0.015 : 0);
      const lookY = ghostMood === "thinking" ? -scale * 0.04 : Math.sin(t * 0.8) * scale * 0.008;
      const eyeY = cy - 0.78 * scale + floatY;
      const eyeRx = scale * 0.115, eyeRy = scale * 0.155;
      const squint = ghostEmotion === "alert" ? 0.74 : happyFace ? 0.9 : 1;
      for (const sx of [-0.32, 0.32]) {
        const ex = cx + sx * scale;
        const g = ctx2.createRadialGradient(ex, eyeY, 0, ex, eyeY, scale * 0.21);
        g.addColorStop(0, accentCss(0.35));
        g.addColorStop(1, accentCss(0));
        ctx2.fillStyle = g;
        ctx2.beginPath(); ctx2.arc(ex, eyeY, scale * 0.21, 0, Math.PI * 2); ctx2.fill();
        ctx2.save();
        ctx2.translate(ex, eyeY);
        ctx2.rotate(ghostEmotion === "alert" ? sx * -0.18 : 0);
        ctx2.scale(1, blink * squint);
        ctx2.beginPath(); ctx2.ellipse(0, 0, eyeRx, eyeRy, 0, 0, Math.PI * 2);
        ctx2.fillStyle = "rgba(240,255,248,0.97)";
        ctx2.fill();
        ctx2.clip();   // pupil + catchlights stay inside the eye
        ctx2.fillStyle = "rgba(5,38,28,0.94)";
        ctx2.beginPath(); ctx2.ellipse(lookX, lookY, eyeRx * 0.54, eyeRy * 0.56, 0, 0, Math.PI * 2); ctx2.fill();
        ctx2.fillStyle = "rgba(255,255,255,0.95)";
        ctx2.beginPath(); ctx2.arc(lookX - eyeRx * 0.16, lookY - eyeRy * 0.18, eyeRx * 0.17, 0, Math.PI * 2); ctx2.fill();
        ctx2.fillStyle = "rgba(255,255,255,0.55)";
        ctx2.beginPath(); ctx2.arc(lookX + eyeRx * 0.16, lookY + eyeRy * 0.14, eyeRx * 0.08, 0, Math.PI * 2); ctx2.fill();
        ctx2.restore();
      }

      /* rosy cheeks — brighter when she's happy or chatting */
      ctx2.fillStyle = `rgba(255,145,175,${happyFace ? 0.3 : ghostMood === "talking" ? 0.24 : 0.16})`;
      for (const sx of [-0.47, 0.47]) {
        ctx2.beginPath();
        ctx2.ellipse(cx + sx * scale, cy - 0.56 * scale + floatY, scale * 0.09, scale * 0.05, 0, 0, Math.PI * 2);
        ctx2.fill();
      }

      /* chibi mouth */
      const mouthY = cy - 0.48 * scale + floatY;
      ctx2.lineCap = "round";
      ctx2.lineWidth = Math.max(1.5, scale * 0.022);
      ctx2.strokeStyle = "rgba(235,255,246,0.92)";
      ctx2.shadowColor = accentCss(0.7);
      ctx2.shadowBlur = 6;
      if (ghostMood === "talking") {
        /* open mouth that bounces with each syllable, little tongue inside */
        const open = scale * (0.028 + talkBeat * 0.07);
        const jaw = scale * (0.08 + talkBeat * 0.02);
        ctx2.fillStyle = "rgba(5,38,28,0.92)";
        ctx2.beginPath(); ctx2.ellipse(cx, mouthY + open * 0.3, jaw, open, 0, 0, Math.PI * 2);
        ctx2.fill(); ctx2.stroke();
        ctx2.save(); ctx2.clip();
        ctx2.fillStyle = "rgba(255,150,175,0.85)";
        ctx2.beginPath(); ctx2.ellipse(cx, mouthY + open * 0.95, jaw * 0.62, open * 0.6, 0, 0, Math.PI * 2); ctx2.fill();
        ctx2.restore();
      } else if (ghostMood === "thinking") {
        ctx2.beginPath();
        ctx2.arc(cx, mouthY, scale * (0.024 + thinkBeat * 0.006), 0, Math.PI * 2);   // pensive little "o"
        ctx2.stroke();
      } else if (ghostEmotion === "alert") {
        ctx2.beginPath();
        ctx2.moveTo(cx - scale * 0.09, mouthY + scale * 0.015);
        ctx2.quadraticCurveTo(cx, mouthY - scale * 0.03, cx + scale * 0.09, mouthY + scale * 0.015);   // worried
        ctx2.stroke();
      } else {
        ctx2.beginPath();
        ctx2.arc(cx, mouthY - scale * 0.03, scale * (happyFace ? 0.15 : 0.1), Math.PI * 0.16, Math.PI * 0.84);   // smile
        ctx2.stroke();
      }
      ctx2.shadowBlur = 0;
      ctx2.globalAlpha = 1;
      ctx2.globalCompositeOperation = "lighter";
    }

    /* pixie dust: four-point stars that twinkle, drift down, and fade */
    for (let i = sparkles.length - 1; i >= 0; i--) {
      const s = sparkles[i];
      s.life += dt;
      if (s.life > s.max) { sparkles.splice(i, 1); continue; }
      s.x += s.vx * dt; s.y += s.vy * dt;
      s.vy += 16 * dt;
      s.vx *= 0.985;
      const fade = 1 - s.life / s.max;
      const a = fade * (0.55 + 0.45 * Math.sin(s.life * s.tw * Math.PI));
      const r = s.r * (2.4 - 1.2 * (1 - fade));
      ctx2.fillStyle = s.gold ? `rgba(255,231,150,${a})` : `rgba(190,255,225,${a})`;
      ctx2.beginPath();
      ctx2.moveTo(s.x, s.y - r);
      ctx2.quadraticCurveTo(s.x, s.y, s.x + r, s.y);
      ctx2.quadraticCurveTo(s.x, s.y, s.x, s.y + r);
      ctx2.quadraticCurveTo(s.x, s.y, s.x - r, s.y);
      ctx2.quadraticCurveTo(s.x, s.y, s.x, s.y - r);
      ctx2.fill();
      ctx2.fillStyle = `rgba(255,255,255,${a})`;
      ctx2.fillRect(s.x - 0.6, s.y - 0.6, 1.2, 1.2);
    }
    ctx2.restore();
    ctx2.globalCompositeOperation = "source-over";
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/* ============================ the flow (living map of the offer chain) ============================ */
/* Leads → Quotes → Approvals → Bookings → Delivery → Reviews → Money, drawn as
   a glowing constellation above the mission grid. Comet sparks ride the chain;
   each station flares and pops its live number as one passes. Self-contained:
   injects its own DOM + styles so it works regardless of the host page HTML. */
function initFlowMap() {
  const missionEl = $("[data-mission]");
  if (!missionEl || document.querySelector("[data-flowmap]")) return;
  const host = missionEl.closest("section") || missionEl;

  const style = document.createElement("style");
  style.textContent = `
    .flowmap { margin: 26px 0 6px; }
    .flowmap-panel { position: relative; overflow: hidden; border: 1px solid rgba(65,255,161,.16); border-radius: 22px;
      background:
        radial-gradient(120% 180% at 12% -30%, rgba(65,255,161,.09), transparent 55%),
        radial-gradient(130% 200% at 88% 130%, rgba(255,214,120,.06), transparent 55%),
        rgba(3,10,7,.55);
      box-shadow: 0 0 50px rgba(65,255,161,.05); }
    .flowmap-head { position: absolute; top: 15px; left: 20px; z-index: 1; display: flex; align-items: baseline; gap: 12px; pointer-events: none; }
    .flowmap-kicker { font: 500 10px "DM Mono", monospace; letter-spacing: .24em; text-transform: uppercase; color: rgba(65,255,161,.8); }
    .flowmap-sub { font: 400 11px "DM Mono", monospace; color: rgba(234,255,244,.38); }
    .flowmap canvas { display: block; width: 100%; height: 280px; }
    @media (max-width: 720px) { .flowmap canvas { height: 230px; } .flowmap-sub { display: none; } }
  `;
  document.head.appendChild(style);

  const sec = document.createElement("section");
  sec.className = "flowmap";
  sec.setAttribute("aria-label", "The Flow — how work moves through Phantom");
  sec.innerHTML = `
    <div class="flowmap-panel">
      <div class="flowmap-head">
        <span class="flowmap-kicker">The Flow</span>
        <span class="flowmap-sub">work in motion — tap a station to open its desk</span>
      </div>
      <canvas data-flowmap></canvas>
    </div>`;
  host.parentElement.insertBefore(sec, host);

  const canvas = sec.querySelector("[data-flowmap]");
  const ctx2 = canvas.getContext("2d");
  if (!ctx2) return;

  const FULL = [
    { ws: "leads", label: "Leads" },
    { ws: "proposals", label: "Quotes" },
    { ws: "approvals", label: "Approvals" },
    { ws: "bookings", label: "Bookings" },
    { ws: "media", label: "Delivery" },
    { ws: "reviews", label: "Reviews" },
    { ws: "money", label: "Money", gold: true },
  ];

  let stats = {};
  const refreshStats = () => {
    stats = {};
    for (const wgt of missionWidgets()) stats[wgt.id] = wgt;
    if (reduceMotion) scene(0, 0);
  };

  let w = 0, h = 0, dpr = 1, nodes = [], samples = [], nodeU = [], cum = [], totalLen = 1, stars = [];
  const layout = () => {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = Math.max(1, r.width); h = Math.max(1, r.height);
    canvas.width = w * dpr; canvas.height = h * dpr;
    stars = Array.from({ length: Math.round(w / 16) }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      r: 0.7 + Math.random() * 1.4, a: 0.08 + Math.random() * 0.26,
      tw: 1 + Math.random() * 3.5, ph: Math.random() * Math.PI * 2,
    }));
    const chain = w < 640 ? FULL.filter((n) => n.ws !== "approvals" && n.ws !== "media") : FULL;
    const padX = Math.max(52, w * 0.06);
    nodes = chain.map((n, i) => ({
      ...n,
      x: padX + (i * (w - padX * 2)) / (chain.length - 1),
      y: h * 0.55 + (i % 2 ? 1 : -1) * h * 0.13,
      flare: 0,
    }));
    /* sample a Catmull-Rom curve through the stations for constant-speed travel */
    const STEPS = 18;
    const pts = nodes.map((n) => [n.x, n.y]);
    const crom = (p0, p1, p2, p3, s) => {
      const s2 = s * s, s3 = s2 * s;
      return [
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * s + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * s2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * s3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * s + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * s2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * s3),
      ];
    };
    samples = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)], p3 = pts[Math.min(pts.length - 1, i + 2)];
      for (let j = 0; j < STEPS; j++) samples.push(crom(p0, pts[i], pts[i + 1], p3, j / STEPS));
    }
    samples.push(pts[pts.length - 1]);
    cum = [0]; totalLen = 0;
    for (let i = 1; i < samples.length; i++) {
      totalLen += Math.hypot(samples[i][0] - samples[i - 1][0], samples[i][1] - samples[i - 1][1]);
      cum.push(totalLen);
    }
    nodeU = nodes.map((_, i) => cum[Math.min(cum.length - 1, i * STEPS)] / totalLen);
  };
  const posAt = (u) => {
    const target = Math.max(0, Math.min(1, u)) * totalLen;
    let lo = 0, hi = cum.length - 1;
    while (lo < hi) { const mi = (lo + hi) >> 1; if (cum[mi] < target) lo = mi + 1; else hi = mi; }
    const i = Math.max(1, lo);
    const seg = cum[i] - cum[i - 1] || 1;
    const f = (target - cum[i - 1]) / seg;
    return [samples[i - 1][0] + (samples[i][0] - samples[i - 1][0]) * f, samples[i - 1][1] + (samples[i][1] - samples[i - 1][1]) * f];
  };

  const drawBackdrop = (t) => {
    for (const s of stars) {
      ctx2.fillStyle = `rgba(190,255,228,${s.a * (0.55 + 0.45 * Math.sin(t * s.tw + s.ph))})`;
      ctx2.fillRect(s.x, s.y, s.r, s.r);
    }
    ctx2.strokeStyle = "rgba(65,255,161,0.045)";   // faint orbit contours behind each station
    ctx2.lineWidth = 1;
    for (const n of nodes) {
      ctx2.beginPath(); ctx2.arc(n.x, n.y, 50, 0, Math.PI * 2); ctx2.stroke();
    }
  };

  /* the path is a ribbon of light shifting green → cyan → gold toward Money */
  const drawPath = (t) => {
    const grad = ctx2.createLinearGradient(nodes[0].x, 0, nodes[nodes.length - 1].x, 0);
    grad.addColorStop(0, "rgb(65,255,161)");
    grad.addColorStop(0.55, "rgb(30,240,255)");
    grad.addColorStop(1, "rgb(255,214,120)");
    ctx2.lineCap = "round"; ctx2.lineJoin = "round";
    ctx2.beginPath();
    ctx2.moveTo(samples[0][0], samples[0][1]);
    for (let i = 1; i < samples.length; i++) ctx2.lineTo(samples[i][0], samples[i][1]);
    ctx2.strokeStyle = grad;
    ctx2.globalAlpha = 0.07; ctx2.lineWidth = 11; ctx2.stroke();
    ctx2.globalAlpha = 0.16; ctx2.lineWidth = 3.5; ctx2.stroke();
    ctx2.globalAlpha = 0.55; ctx2.lineWidth = 1.2;
    ctx2.setLineDash([4, 10]);
    ctx2.lineDashOffset = -t * 30;   // energy drifts toward Money
    ctx2.stroke();
    ctx2.setLineDash([]);
    ctx2.globalAlpha = 1;
  };

  const TRAV = 3, prevU = [0, 0, 0], dust = [];
  const burst = (n) => {
    const c = n.gold ? "255,220,140" : "150,255,215";
    for (let b = 0; b < 7 && dust.length < 70; b++) {
      const ang = Math.random() * Math.PI * 2, sp = 24 + Math.random() * 46;
      dust.push({ x: n.x, y: n.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 8, life: 0, max: 0.5 + Math.random() * 0.5, r: 1 + Math.random() * 1.8, c });
    }
  };
  const drawTravelers = (t, dt) => {
    const speed = 0.055;   // full runs of the chain per second
    for (let k = 0; k < TRAV; k++) {
      const u = (t * speed + k / TRAV) % 1;
      for (let i = 0; i < nodeU.length; i++) {
        const nu = nodeU[i];
        const crossed = prevU[k] <= u ? (nu > prevU[k] && nu <= u) : (nu > prevU[k] || nu <= u);
        if (crossed) { nodes[i].flare = 1; burst(nodes[i]); }
      }
      prevU[k] = u;
      /* the spark turns gold as it closes in on the Money station */
      const gmix = Math.max(0, (u - 0.8) / 0.2);
      const rc = Math.round(120 + 135 * gmix), gc = Math.round(255 - 41 * gmix), bc = Math.round(200 - 80 * gmix);
      for (let j = 16; j >= 0; j--) {   // long tapered comet tail
        const [x, y] = posAt(u - j * 0.006);
        ctx2.fillStyle = `rgba(${rc},${gc},${bc},${(1 - j / 17) * 0.55})`;
        ctx2.beginPath(); ctx2.arc(x, y, 0.8 + (1 - j / 17) * 3, 0, Math.PI * 2); ctx2.fill();
      }
      const [hx, hy] = posAt(u);
      const hg = ctx2.createRadialGradient(hx, hy, 0, hx, hy, 12);
      hg.addColorStop(0, "rgba(255,255,255,0.95)");
      hg.addColorStop(0.35, `rgba(${rc},${gc},${bc},0.75)`);
      hg.addColorStop(1, `rgba(${rc},${gc},${bc},0)`);
      ctx2.fillStyle = hg;
      ctx2.beginPath(); ctx2.arc(hx, hy, 12, 0, Math.PI * 2); ctx2.fill();
      /* four-point lens flare on the comet head */
      const fl = 7 + Math.sin(t * 9 + k * 2) * 2.5;
      ctx2.strokeStyle = `rgba(255,255,255,${0.5 + 0.3 * Math.sin(t * 12 + k)})`;
      ctx2.lineWidth = 1;
      ctx2.beginPath();
      ctx2.moveTo(hx - fl, hy); ctx2.lineTo(hx + fl, hy);
      ctx2.moveTo(hx, hy - fl); ctx2.lineTo(hx, hy + fl);
      ctx2.stroke();
      if (Math.random() < 0.4 && dust.length < 70)
        dust.push({ x: hx, y: hy, vx: (Math.random() - 0.5) * 16, vy: 6 + Math.random() * 14, life: 0, max: 0.5 + Math.random() * 0.6, r: 0.8 + Math.random() * 1.6 });
    }
  };
  const drawDust = (dt) => {
    for (let i = dust.length - 1; i >= 0; i--) {
      const s = dust[i];
      s.life += dt;
      if (s.life > s.max) { dust.splice(i, 1); continue; }
      s.x += s.vx * dt; s.y += s.vy * dt;
      ctx2.strokeStyle = `rgba(${s.c || "210,255,235"},${(1 - s.life / s.max) * 0.85})`;
      ctx2.lineWidth = 1;
      ctx2.beginPath();
      ctx2.moveTo(s.x - s.r * 2, s.y); ctx2.lineTo(s.x + s.r * 2, s.y);
      ctx2.moveTo(s.x, s.y - s.r * 2); ctx2.lineTo(s.x, s.y + s.r * 2);
      ctx2.stroke();
    }
  };

  let hover = -1;
  const drawNodes = (dt, t) => {
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      n.flare = Math.max(0, n.flare - dt * 1.6);
      const s = stats[n.ws] || {};
      const [cr, cg, cb] = n.gold ? [255, 214, 120] : [65, 255, 161];
      const col = (a) => `rgba(${cr},${cg},${cb},${a})`;
      const R = (w < 640 ? 16 : 21) + (hover === i ? 2.5 : 0) + n.flare * 2.5;
      const glow = ctx2.createRadialGradient(n.x, n.y, 0, n.x, n.y, R * 3.4);
      glow.addColorStop(0, col(0.3 + n.flare * 0.35));
      glow.addColorStop(1, col(0));
      ctx2.fillStyle = glow;
      ctx2.beginPath(); ctx2.arc(n.x, n.y, R * 3.4, 0, Math.PI * 2); ctx2.fill();
      if (n.flare > 0.01) {   // ripple ring as a spark lands
        ctx2.strokeStyle = col(n.flare * 0.6);
        ctx2.lineWidth = 1.5;
        ctx2.beginPath(); ctx2.arc(n.x, n.y, R + (1 - n.flare) * 26, 0, Math.PI * 2); ctx2.stroke();
      }
      /* slow-turning dashed orbit ring, brighter under the cursor */
      ctx2.strokeStyle = col(0.4 + (hover === i ? 0.35 : 0) + n.flare * 0.2);
      ctx2.lineWidth = 1;
      ctx2.setLineDash([5, 7]);
      ctx2.lineDashOffset = t * (i % 2 ? 16 : -16);
      ctx2.beginPath(); ctx2.arc(n.x, n.y, R + 7, 0, Math.PI * 2); ctx2.stroke();
      ctx2.setLineDash([]);
      const disc = ctx2.createRadialGradient(n.x, n.y - R * 0.4, 0, n.x, n.y, R);
      disc.addColorStop(0, "rgba(10,30,22,0.96)");
      disc.addColorStop(1, "rgba(2,10,7,0.96)");
      ctx2.fillStyle = disc;
      ctx2.beginPath(); ctx2.arc(n.x, n.y, R, 0, Math.PI * 2); ctx2.fill();
      ctx2.strokeStyle = col(0.9);
      ctx2.lineWidth = 1.6 + n.flare;
      ctx2.stroke();
      ctx2.fillStyle = col(0.95);
      ctx2.font = `${Math.round(R * 0.85)}px "Space Grotesk", system-ui, sans-serif`;
      ctx2.textAlign = "center"; ctx2.textBaseline = "middle";
      ctx2.fillText(s.icon || "◇", n.x, n.y + 1);
      /* label + live stat, kept on the side of the node away from the path */
      const up = n.y <= h * 0.55;
      const ly = up ? n.y - R - 34 : n.y + R + 18;
      ctx2.font = '500 10px "DM Mono", monospace';
      ctx2.fillStyle = `rgba(234,255,244,${hover === i ? 0.85 : 0.55})`;
      ctx2.fillText(n.label.toUpperCase(), n.x, ly);
      ctx2.font = `600 ${Math.round(15 + n.flare * 3)}px "Space Grotesk", system-ui, sans-serif`;
      ctx2.fillStyle = n.gold ? col(0.95) : "rgba(234,255,244,0.92)";
      ctx2.fillText(s.stat || "—", n.x, ly + 16);
    }
  };

  const scene = (t, dt) => {
    ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx2.clearRect(0, 0, w, h);
    drawBackdrop(t);
    drawPath(t);
    if (!reduceMotion) { drawTravelers(t, dt); drawDust(dt); }
    drawNodes(dt, t);
  };

  canvas.addEventListener("pointermove", (e) => {
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    hover = nodes.findIndex((n) => Math.hypot(mx - n.x, my - n.y) < 32);
    canvas.style.cursor = hover >= 0 ? "pointer" : "default";
  });
  canvas.addEventListener("click", () => { if (hover >= 0) openWorkspace(nodes[hover].ws); });

  layout();
  refreshStats();
  store.onChange(refreshStats);
  window.addEventListener("resize", () => { layout(); if (reduceMotion) scene(0, 0); }, { passive: true });
  if (reduceMotion) { scene(0, 0); return; }
  let last = performance.now();
  const frame = (now) => {
    if (!document.hidden) {
      const dt = Math.min(0.05, (now - last) / 1000);
      scene(now * 0.001, dt);
    }
    last = now;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/* ============================ boot ============================ */
let ghostStarted = false;
function enterPhantom() {
  gate.hidden = true;
  phantom.hidden = false;
  if (!ghostStarted) { ghostStarted = true; initGhost(); initFlowMap(); }
  renderDashboard();
  const q = new URLSearchParams(location.search);
  const view = (q.get("view") || "").toLowerCase();
  if (view && view !== "command" && WORKSPACE_DEFS[view]) openWorkspace(view);
  const m = location.hash.match(/^#ws\/([a-z]+)/);
  if (m && WORKSPACE_DEFS[m[1]]) openWorkspace(m[1], false);
  speak(isAdmin()
    ? "Phantom is live. Every desk reported in — what do you want handled first?"
    : `Welcome back. Your workspace is moving — ask me anything or check today's plan.`);
}

function boot() {
  ctx.session = resolveSession();
  wireCommandDeck();
  store.onChange(() => { /* keep rail + grid live after any store write */
    if (!phantom.hidden) { renderMission(); renderRail(); }
  });
  if (ctx.session) enterPhantom();
  else showGate();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
