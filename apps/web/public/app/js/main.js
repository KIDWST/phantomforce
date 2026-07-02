/* PhantomForce Cockpit — shell, overlay engine, ghost, ticker, command deck. */

import {
  store, ctx, session, resolveSession, isAdmin, currentWs, setWorkspace, wsName,
  visible, todaysPlan, moneyView, fmtMoney, ago,
} from "./store.js";
import { handleCommand, commandSuggestions } from "./command.js";
import { WORKSPACE_DEFS, missionWidgets, esc } from "./workspaces.js";

const $ = (sel, root = document) => root.querySelector(sel);
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const gate = $("[data-gate]");
const cockpit = $("[data-cockpit]");
const overlayRoot = $("[data-overlay-root]");

/* ============================ access gate ============================ */
function showGate() {
  gate.hidden = false;
  cockpit.hidden = true;
  gate.querySelectorAll("[data-enter]").forEach((btn) => {
    btn.onclick = () => {
      const kind = btn.dataset.enter;
      ctx.session = kind === "admin"
        ? { role: "admin", name: "Jordan", ws: "phantomforce" }
        : { role: "client", name: "Test Client", ws: "test-client" };
      session.set(ctx.session);
      enterCockpit();
    };
  });
}

/* ============================ shell ============================ */
function renderTopbar() {
  $("[data-role-sub]").textContent = isAdmin() ? "ADMIN COCKPIT" : "CLIENT PORTAL";
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
function speak(text, cls = "") {
  clearTimeout(typeTimer);
  const p = document.createElement("p");
  p.className = `say-line ${cls}`.trim();
  sayBox().replaceChildren(p);
  if (cls || reduceMotion) { p.textContent = text; return; }
  let i = 0;
  const tick = () => {
    p.textContent = text.slice(0, i);
    if (i++ < text.length) typeTimer = setTimeout(tick, 11 + Math.random() * 16);
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
  ghostFlare();
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
      <button class="overlay-backdrop" data-overlay-close aria-label="Back to cockpit"></button>
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
function ghostFlare() { ghostPulse = 1; }
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
    pts.push({ x: Math.cos(angp) * rr, y, z: Math.sin(angp) * rr * 0.58 });
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
  const t0 = performance.now();
  const frame = (now) => {
    if (document.hidden) { requestAnimationFrame(frame); return; }
    const t = (now - t0) * 0.001;
    ghostPulse = Math.max(0, ghostPulse - 0.02);
    cpx += (px - cpx) * 0.05;
    ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx2.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h * 0.56;
    const scale = Math.min(w, h) * 0.30;
    const rot = cpx * 0.9 + Math.sin(t * 0.15) * 0.08;
    const cosR = Math.cos(rot), sinR = Math.sin(rot);
    const breath = 1 + Math.sin(t * 0.9) * 0.025 + ghostPulse * 0.1;
    const floatY = Math.sin(t * 1.1) * 4;
    ctx2.globalCompositeOperation = "lighter";
    for (const p of pts) {
      let ny = p.y;
      if (p.y < -0.2) {
        const m = Math.min(1, (-0.2 - p.y) / 1.2);
        ny = p.y + (Math.sin(p.x * 4 + t * 2.4) * 0.09 + Math.sin(p.z * 5 - t * 1.7) * 0.05) * m;
      }
      const rx = p.x * cosR + p.z * sinR;
      const rz = -p.x * sinR + p.z * cosR;
      const X = cx + rx * scale * breath;
      const Y = cy - ny * scale * breath + floatY;
      const depth = (rz + 1) / 2;
      const a = 0.16 + depth * 0.5 + ghostPulse * 0.3;
      ctx2.fillStyle = `rgba(65,255,161,${Math.min(0.9, a)})`;
      const sz = 0.9 + depth * 1.3;
      ctx2.fillRect(X, Y, sz, sz);
    }
    /* eyes */
    const blink = (Math.sin(t * 0.9) > 0.995) ? 0.15 : 1;
    const eyeY = cy - 0.74 * scale * breath + floatY;
    for (const sx of [-0.3, 0.3]) {
      const ex = cx + (sx * cosR + 0.62 * sinR * 0.4) * scale * breath;
      const g = ctx2.createRadialGradient(ex, eyeY, 0, ex, eyeY, scale * 0.16);
      g.addColorStop(0, `rgba(214,255,236,${0.9 + ghostPulse * 0.1})`);
      g.addColorStop(1, "rgba(65,255,161,0)");
      ctx2.fillStyle = g;
      ctx2.save();
      ctx2.translate(ex, eyeY);
      ctx2.scale(0.7, 1.25 * blink);
      ctx2.beginPath(); ctx2.arc(0, 0, scale * 0.16, 0, Math.PI * 2); ctx2.fill();
      ctx2.restore();
    }
    ctx2.globalCompositeOperation = "source-over";
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/* ============================ boot ============================ */
let ghostStarted = false;
function enterCockpit() {
  gate.hidden = true;
  cockpit.hidden = false;
  if (!ghostStarted) { ghostStarted = true; initGhost(); }
  renderDashboard();
  const q = new URLSearchParams(location.search);
  const view = (q.get("view") || "").toLowerCase();
  if (view && view !== "command" && WORKSPACE_DEFS[view]) openWorkspace(view);
  const m = location.hash.match(/^#ws\/([a-z]+)/);
  if (m && WORKSPACE_DEFS[m[1]]) openWorkspace(m[1], false);
  speak(isAdmin()
    ? "Cockpit's live. Every desk reported in — what do you want handled first?"
    : `Welcome back. Your workspace is moving — ask me anything or check today's plan.`);
}

function boot() {
  ctx.session = resolveSession();
  wireCommandDeck();
  store.onChange(() => { /* keep rail + grid live after any store write */
    if (!cockpit.hidden) { renderMission(); renderRail(); }
  });
  if (ctx.session) enterCockpit();
  else showGate();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
