/* PhantomForce Phantom — shell, overlay engine, ghost, ticker, command deck. */

import {
  store, ctx, session, resolveSession, isAdmin, currentWs, setWorkspace, wsName,
  visible, todaysPlan, moneyView, fmtMoney, ago, commandBriefing,
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
  renderCommandBriefing();
  renderMission();
  renderRail();
  renderSuggests();
  startTicker();
}

/* ============================ command briefing ============================
   PhantomForce opens on "what's happening," not a blank prompt (see
   docs on Command/Outcomes/Signals architecture). Self-injects its own
   DOM + styles, same pattern as everywhere else in this app that adds a
   section without depending on host HTML markup — works regardless of
   which shell wraps it. Every card is built from real store data in
   store.js's commandBriefing(); nothing here fabricates a stat. */
let briefingStylesInjected = false;
const dismissedCardIds = new Set();

function injectBriefingStyles() {
  if (briefingStylesInjected) return;
  briefingStylesInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    .briefing { margin: 20px 0 28px; }
    .briefing-greet { font: 600 20px "Space Grotesk", system-ui, sans-serif; margin: 0 0 2px; }
    .briefing-health { font: 400 13px "DM Mono", monospace; color: rgba(234,255,244,.55); margin: 0 0 16px; }
    .briefing-cards { display: grid; gap: 12px; }
    .briefing-card { border: 1px solid rgba(65,255,161,.18); border-radius: 16px; padding: 16px 18px;
      background: radial-gradient(120% 160% at 0% 0%, rgba(65,255,161,.06), transparent 60%), rgba(3,10,7,.5); }
    .briefing-card-top { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
    .briefing-dept { font: 500 9px "DM Mono", monospace; letter-spacing: .14em; text-transform: uppercase;
      color: rgba(65,255,161,.85); border: 1px solid rgba(65,255,161,.3); border-radius: 999px; padding: 2px 8px; }
    .briefing-confidence { font: 400 10px "DM Mono", monospace; color: rgba(234,255,244,.4); margin-left: auto; }
    .briefing-card h4 { margin: 0 0 4px; font: 600 15px "Space Grotesk", system-ui, sans-serif; }
    .briefing-card p { margin: 0 0 8px; font-size: 12.5px; color: rgba(234,255,244,.65); line-height: 1.5; }
    .briefing-evidence { margin: 0 0 12px; padding: 0; list-style: none; font: 400 11px "DM Mono", monospace; color: rgba(234,255,244,.45); }
    .briefing-evidence li { padding: 2px 0 2px 14px; position: relative; }
    .briefing-evidence li::before { content: "▸"; position: absolute; left: 0; color: rgba(65,255,161,.5); }
    .briefing-actions { display: flex; gap: 8px; }
    .briefing-away { margin-top: 18px; border-top: 1px solid rgba(255,255,255,.06); padding-top: 14px; }
    .briefing-away-head { font: 500 10px "DM Mono", monospace; letter-spacing: .12em; text-transform: uppercase; color: rgba(234,255,244,.4); margin: 0 0 8px; }
    .briefing-away ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 5px; }
    .briefing-away li { font-size: 12.5px; color: rgba(234,255,244,.6); padding-left: 14px; position: relative; }
    .briefing-away li::before { content: "✓"; position: absolute; left: 0; color: rgba(65,255,161,.6); }
  `;
  document.head.appendChild(style);
}

function greeting() {
  const h = new Date().getHours();
  const time = h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
  const name = ctx.session?.name?.split(" ")[0] || "there";
  return `Good ${time}, ${name}`;
}

function renderCommandBriefing() {
  if (!isAdmin()) return; // client portal keeps the simpler existing view
  injectBriefingStyles();
  const mission = $("[data-mission]");
  if (!mission) return;
  const host = mission.closest("section") || mission;

  let section = $("[data-briefing]");
  if (!section) {
    section = document.createElement("section");
    section.className = "briefing";
    section.setAttribute("data-briefing", "");
    host.parentElement.insertBefore(section, host);
  }

  const { healthLine, decisions, handledWhileAway } = commandBriefing();
  const visibleDecisions = decisions.filter((d) => !dismissedCardIds.has(d.id));

  section.innerHTML = `
    <p class="briefing-greet">${esc(greeting())}</p>
    <p class="briefing-health">${esc(healthLine)}</p>
    ${visibleDecisions.length ? `<div class="briefing-cards">${visibleDecisions.map((d) => `
      <article class="briefing-card" data-card-id="${esc(d.id)}">
        <div class="briefing-card-top">
          <span class="briefing-dept">${esc(d.dept)}</span>
          <span class="briefing-confidence">confidence: ${esc(d.confidence)}</span>
        </div>
        <h4>${esc(d.headline)}</h4>
        <p>${esc(d.body)}</p>
        <ul class="briefing-evidence">${d.evidence.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>
        <div class="briefing-actions">
          <button class="btn btn-primary" data-briefing-open="${esc(d.primary.open)}">${esc(d.primary.label)}</button>
          <button class="btn btn-quiet" data-briefing-dismiss="${esc(d.id)}">Dismiss</button>
        </div>
      </article>`).join("")}</div>` : ""}
    ${handledWhileAway.length ? `<div class="briefing-away">
      <p class="briefing-away-head">Handled while you were away</p>
      <ul>${handledWhileAway.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
    </div>` : ""}`;

  section.querySelectorAll("[data-briefing-open]").forEach((btn) => {
    btn.addEventListener("click", () => openWorkspace(btn.dataset.briefingOpen));
  });
  section.querySelectorAll("[data-briefing-dismiss]").forEach((btn) => {
    btn.addEventListener("click", () => {
      dismissedCardIds.add(btn.dataset.briefingDismiss);
      renderCommandBriefing();
    });
  });
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

/* ============================ boot ============================ */
let ghostStarted = false;
function enterPhantom() {
  gate.hidden = true;
  phantom.hidden = false;
  if (!ghostStarted) { ghostStarted = true; initGhost(); }
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
