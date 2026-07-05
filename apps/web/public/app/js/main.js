/* PhantomForce — AI Operations Console: shell, sidebar, dashboard, ghost, overlays. */

import {
  store, ctx, session, resolveSession, isAdmin, currentWs, setWorkspace, wsName,
  visible, todaysPlan, moneyView, fmtMoney, ago, isLiveAdminHost, isStaticPublicHost,
  ownerLogin, redirectToLiveAdmin, verifyLiveSession,
} from "./store.js";
import { handleCommand, commandSuggestions } from "./command.js?v=admin-phase2-nav-20260705-01";
import { WORKSPACE_DEFS, missionWidgets, esc } from "./workspaces.js?v=admin-phase2-nav-20260705-01";
import { createPhantomCharacter } from "./character.js?v=phantom-live-admin-20260705-09";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const isPhoneView = () => window.matchMedia("(max-width: 720px)").matches;

const gate = $("[data-gate]");
const phantom = $("[data-phantom]");
const overlayRoot = $("[data-overlay-root]");

/* ---- inline line-icons (stroke = currentColor) ---- */
const I = {
  chat:  `<path d="M3 5h10v7H8l-3 2v-2H3z"/>`,
  grid:  `<path d="M3 3h4v4H3zM9 3h4v4H9zM3 9h4v4H3zM9 9h4v4H9z"/>`,
  media: `<rect x="2.5" y="4" width="11" height="8" rx="1.5"/><path d="M7 6.5l3 1.5-3 1.5z"/>`,
  doc:   `<path d="M4 2.5h5l3 3V13.5H4z"/><path d="M9 2.5v3h3"/>`,
  brain: `<path d="M8 3.5c-2 0-3 1-3 2.4 0 .4-.6.6-.6 1.4 0 .7.5 1 .5 1 0 1 .8 2 2 2M8 3.5c2 0 3 1 3 2.4 0 .4.6.6.6 1.4 0 .7-.5 1-.5 1 0 1-.8 2-2 2M8 3.5v7.8"/>`,
  check: `<circle cx="8" cy="8" r="5.2"/><path d="M6 8l1.5 1.5L10.5 6.5"/>`,
  auto:  `<circle cx="5" cy="5" r="1.6"/><circle cx="11" cy="5" r="1.6"/><circle cx="8" cy="11" r="1.6"/><path d="M6.4 5.7l3.2 0M5.6 6.4l1.6 3M10.4 6.4l-1.6 3"/>`,
  chart: `<path d="M3 13V3M3 13h10M6 10.5V7M9 10.5V5M12 10.5V8.5"/>`,
  cog:   `<circle cx="8" cy="8" r="2"/><path d="M8 2.4v1.6M8 12v1.6M2.4 8h1.6M12 8h1.6M4 4l1.1 1.1M10.9 10.9L12 12M12 4l-1.1 1.1M5.1 10.9L4 12"/>`,
  spark: `<path d="M8 2.6l1.4 3.4 3.6.3-2.7 2.4.8 3.5L8 10.8 4.9 12.6l.8-3.5L3 6.7l3.6-.3z"/>`,
  film:  `<rect x="2.5" y="4" width="11" height="8" rx="1"/><path d="M2.5 6.5h11M5.5 4v8M10.5 4v8"/>`,
  shield:`<path d="M8 2.5l4.5 1.6V8c0 3-2 4.7-4.5 5.5C5.5 12.7 3.5 11 3.5 8V4.1z"/>`,
  upload:`<path d="M8 10.5V4M5.5 6L8 3.5 10.5 6M3.5 11.5h9"/>`,
  arrow: `<path d="M3 8h9M9 5l3 3-3 3"/>`,
  clock: `<circle cx="8" cy="8" r="5.2"/><path d="M8 5.2V8l2 1.4"/>`,
  db:    `<ellipse cx="8" cy="4.5" rx="4.5" ry="1.8"/><path d="M3.5 4.5v7c0 1 2 1.8 4.5 1.8s4.5-.8 4.5-1.8v-7"/>`,
};
const svg = (key, cls = "") => `<svg class="ic ${cls}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[key] || ""}</svg>`;

/* ============================ access gate ============================ */
function showGate() {
  gate.hidden = false;
  phantom.hidden = true;
  const card = gate.querySelector(".gate-card");
  if (isLiveAdminHost()) {
    card.innerHTML = `
      <p class="gate-kicker">PHANTOMFORCE · LIVE OWNER ACCESS</p>
      <h1>Sign in to Phantom.</h1>
      <form class="owner-login" data-owner-login>
        <label>
          <span>Owner key</span>
          <input type="password" data-owner-key autocomplete="current-password" placeholder="Enter owner key" autofocus />
        </label>
        <button class="gate-opt gate-submit" type="submit">
          <span class="gate-opt-icon">⌘</span>
          <b>Launch Admin Phantom</b>
          <i>Backend session required. Owner login is enforced on this host.</i>
        </button>
        <p class="gate-error" data-owner-error hidden></p>
      </form>
      <p class="gate-note">Pangolin provides the private route. PhantomForce owns the visible login and session.</p>`;
    const form = card.querySelector("[data-owner-login]");
    const input = card.querySelector("[data-owner-key]");
    const error = card.querySelector("[data-owner-error]");
    form.onsubmit = async (event) => {
      event.preventDefault();
      error.hidden = true;
      const ownerKey = input.value.trim();
      if (!ownerKey) { error.textContent = "Enter the owner key."; error.hidden = false; return; }
      form.classList.add("is-loading");
      try {
        ctx.session = await ownerLogin(ownerKey);
        enterPhantom();
      } catch (err) {
        session.clear();
        error.textContent = err?.message || "Owner login failed.";
        error.hidden = false;
      } finally {
        form.classList.remove("is-loading");
      }
    };
    return;
  }

  gate.querySelectorAll("[data-enter]").forEach((btn) => {
    btn.onclick = () => {
      const kind = btn.dataset.enter;
      if (kind === "admin" && isStaticPublicHost()) { redirectToLiveAdmin(); return; }
      ctx.session = kind === "admin"
        ? { role: "admin", name: "Jordan", ws: "phantomforce" }
        : { role: "client", name: "Test Client", ws: "test-client" };
      session.set(ctx.session);
      enterPhantom();
    };
  });
}

/* ============================ sidebar nav ============================ */
const NAV = [
  { id: "dashboard",  label: "Dashboard",       icon: "grid",  view: "main" },
  { id: "media",      label: "Media Lab",       icon: "media", ws: "media" },
  { id: "crm",        label: "CRM",             icon: "db",    ws: "leads" },
  { id: "approvals",  label: "Approvals",       icon: "check", ws: "approvals", badge: true },
  { id: "automation", label: "Automation",      icon: "auto",  ws: "automation" },
  { id: "analytics",  label: "Analytics",       icon: "chart", ws: "analytics" },
  { id: "memory",     label: "Memory",          icon: "brain", ws: "memory" },
  { id: "settings",   label: "Settings",        icon: "cog",   ws: "adminos", adminOnly: true },
];
let activeNav = "dashboard";

function renderNav() {
  const nav = $("[data-nav]");
  const pending = visible(store.state.approvals).filter((a) => a.status === "pending").length;
  nav.innerHTML = NAV.filter((n) => !n.adminOnly || isAdmin()).map((n) => `
    <button class="nav-item ${activeNav === n.id ? "is-active" : ""}" data-nav-id="${n.id}">
      ${svg(n.icon)}
      <span>${n.label}</span>
      ${n.badge && pending ? `<em class="nav-badge">${pending}</em>` : ""}
    </button>`).join("");
}

function goNav(id) {
  const item = NAV.find((n) => n.id === id);
  if (!item) return;
  activeNav = id;
  renderNav();
  if (item.view === "main") { closeOverlay(true); }
  else if (item.ws) { openWorkspace(item.ws); }
}

/* ============================ topbar ============================ */
function renderStatusPills() {
  const attention = store.state.security.some((s) => s.posture && s.posture !== "clean");
  const pills = [
    { label: "Phantom Status", value: "Online", tone: "ok", dot: true },
    { label: "System Status", value: attention ? "Attention needed" : "All Systems Operational", tone: attention ? "warn" : "ok", dot: true },
    { label: "Memory", value: "Private & Local", tone: "ok", lock: true },
  ];
  $("[data-status-pills]").innerHTML = pills.map((p) => `
    <div class="pill pill-${p.tone}">
      <span class="pill-k">${p.label}</span>
      <span class="pill-v">${p.dot ? `<i class="dot"></i>` : ""}${p.lock ? `<i class="lock" aria-hidden="true">🔒</i>` : ""}${esc(p.value)}</span>
    </div>`).join("")
    + (isAdmin() ? `
    <label class="ws-switch" title="Switch workspace">
      <select data-org-select aria-label="Switch workspace">${store.state.workspaces.map((w) => `<option value="${w.id}" ${w.id === currentWs() ? "selected" : ""}>${esc(w.name)}</option>`).join("")}</select>
    </label>` : "");
  const sel = $("[data-org-select]");
  if (sel) sel.onchange = () => { setWorkspace(sel.value); renderConsole(); };
}

let clockTimer = 0;
function startClock() {
  const paint = () => {
    const now = new Date();
    $("[data-clock-time]").textContent = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    $("[data-clock-date]").textContent = now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  };
  paint();
  clearInterval(clockTimer);
  clockTimer = setInterval(paint, 15000);
}

function renderUser() {
  const name = ctx.session?.name || "Phantom";
  const initials = name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  $("[data-user-avatar]").textContent = initials || "PF";
  $("[data-user-name]").textContent = name;
  $("[data-user-role]").textContent = isAdmin() ? "Administrator" : "Client";
  const btn = $("[data-user-btn]");
  btn.onclick = () => {
    if (confirm("Sign out of PhantomForce?")) {
      session.clear(); ctx.session = null; closeOverlay(true); showGate();
    }
  };
}

/* ============================ hero + command deck ============================ */
const MODES = {
  ask:     { label: "Ask",     icon: "chat",  placeholder: "Ask PhantomForce anything…", prefix: "" },
  write:   { label: "Write",   icon: "doc",   placeholder: "Write a proposal, a caption, a follow-up…", prefix: "Draft " },
  image:   { label: "Image",   icon: "spark", placeholder: "Describe an image to create…", prefix: "Create an image brief for " },
  video:   { label: "Video",   icon: "film",  placeholder: "Describe a video to produce…", prefix: "Create a video brief for " },
  website: { label: "Website", icon: "grid",  placeholder: "Describe a page or site to build…", prefix: "Build a website for " },
  admin:   { label: "Admin",   icon: "cog",   placeholder: "", open: "adminos" },
};
let activeMode = "ask";

function renderChips() {
  const wrap = $("[data-cmd-chips]");
  wrap.innerHTML = Object.entries(MODES).map(([id, m]) => `
    <button class="cmd-chip ${activeMode === id ? "is-active" : ""}" data-mode="${id}">
      ${svg(m.icon)}<span>${m.label}</span>
    </button>`).join("");
}

function setMode(id) {
  const m = MODES[id];
  if (!m) return;
  if (m.open) { openWorkspace(m.open); return; }
  activeMode = id;
  renderChips();
  const input = $("[data-command-input]");
  input.placeholder = m.placeholder;
  input.focus();
}

function renderHero() {
  const name = (ctx.session?.name || "there").split(/\s+/)[0];
  $("[data-hero-name]").textContent = `${name}.`;
}

/* ============================ stat cards ============================ */
function thisWeekCount() {
  const weekAgo = Date.now() - 7 * 864e5;
  return visible(store.state.activity).filter((a) => new Date(a.at).getTime() >= weekAgo).length;
}
function renderStatCards() {
  const media = visible(store.state.media);
  const sites = visible(store.state.sites);
  const products = visible(store.state.products);
  const pending = visible(store.state.approvals).filter((a) => a.status === "pending").length;
  const activeAgents = store.state.agents.filter((a) => a.status === "active").length;
  const delivered = media.filter((m) => m.status === "delivered").length;
  const files = media.length + sites.length + products.length + visible(store.state.reviews).length;

  const cards = [
    { icon: "db",    title: "Memory", value: files, sub: "Files indexed", foot: `Updated ${ago(store.state.activity[0]?.at || new Date().toISOString())}`, open: "memory" },
    { icon: "media", title: "Media Lab",    value: media.length, sub: "Briefs in lab", foot: `${delivered} delivered`, open: "media" },
    { icon: "check", title: "Approvals",    value: pending, sub: "Pending", foot: pending ? "Needs your review" : "All clear", open: "approvals", alert: pending > 0 },
    { icon: "spark", title: "Content",      value: thisWeekCount(), sub: "This week", foot: "Across all desks", open: "media" },
    { icon: "auto",  title: "Automations",  value: activeAgents, sub: "Active", foot: "Running smoothly", open: "workforce" },
  ];
  $("[data-statcards]").innerHTML = cards.map((c) => `
    <button class="statcard ${c.alert ? "statcard-alert" : ""}" data-open-ws="${c.open}">
      <span class="statcard-icon">${svg(c.icon)}</span>
      <span class="statcard-k">${esc(c.title)}</span>
      <b class="statcard-v">${c.value}</b>
      <span class="statcard-sub">${esc(c.sub)}</span>
      <span class="statcard-foot">${esc(c.foot)}</span>
    </button>`).join("");
}

/* ============================ recent activity ============================ */
const ACT_ICON = (text = "") => {
  const s = text.toLowerCase();
  if (/video|reel|phantomcut|shoot/.test(s)) return "film";
  if (/security|scan|breach|threat|protect/.test(s)) return "shield";
  if (/image|photo|promo|creative/.test(s)) return "spark";
  if (/site|page|website|store|checkout/.test(s)) return "grid";
  if (/proposal|quote|invoice|paid|pipeline/.test(s)) return "chart";
  if (/review|testimonial/.test(s)) return "check";
  return "spark";
};
function renderActivity() {
  const items = visible(store.state.activity).slice(0, 4);
  const box = $("[data-activity]");
  if (!items.length) { box.innerHTML = `<p class="empty-line">Quiet — nothing has run yet.</p>`; return; }
  box.innerHTML = items.map((a) => `
    <div class="act-card">
      <span class="act-thumb">${svg(ACT_ICON(a.text))}</span>
      <span class="act-body">
        <b>${esc(a.who)} ${esc(a.text)}</b>
        <i>${ago(a.at)}</i>
      </span>
      <span class="act-dot" aria-hidden="true"></span>
    </div>`).join("");
}

/* ============================ today's plan (donut) ============================ */
function renderPlan() {
  const plan = todaysPlan();
  const m = moneyView();
  const money = m.wonValue + m.pipeline > 0 ? m.wonValue / (m.wonValue + m.pipeline) : 0.4;
  // an upbeat "on track" read: fewer open items + more won momentum = higher.
  const pct = Math.max(55, Math.min(97, Math.round(88 - plan.length * 4 + money * 18)));
  const R = 30, C = 2 * Math.PI * R, off = C * (1 - pct / 100);
  const msg = pct >= 85 ? "You're ahead. Ride it." : pct >= 45 ? "You're on track." : "Let's clear the runway.";
  $("[data-plan]").innerHTML = `
    <div class="section-head"><h2>Today's plan</h2></div>
    <button class="plan-inner" data-open-ws="approvals">
      <svg class="plan-donut" viewBox="0 0 72 72" aria-hidden="true">
        <circle cx="36" cy="36" r="${R}" class="plan-track"/>
        <circle cx="36" cy="36" r="${R}" class="plan-arc" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/>
        <text x="36" y="40" class="plan-pct">${pct}%</text>
      </svg>
      <span class="plan-copy">
        <b>${msg}</b>
        <i>${plan.length ? `${plan.length} thing${plan.length > 1 ? "s" : ""} need you.` : "Nothing waiting. Keep going."}</i>
      </span>
      <span class="plan-arrow">${svg("arrow")}</span>
    </button>`;
}

/* ============================ mission queue ============================ */
const AGENT_STATE = {
  active: { label: "RUNNING", cls: "run" },
  waiting: { label: "WAITING", cls: "wait" },
  "needs-approval": { label: "APPROVE", cls: "wait" },
  blocked: { label: "BLOCKED", cls: "block" },
  idle: { label: "QUEUED", cls: "queue" },
};
function renderQueue() {
  const agents = store.state.agents || [];
  $("[data-queue-count]").textContent = agents.length;
  $("[data-queue]").innerHTML = agents.slice(0, 4).map((a) => {
    const st = AGENT_STATE[a.status] || AGENT_STATE.idle;
    return `
    <button class="queue-item" data-open-ws="workforce">
      <span class="queue-ic">${svg("auto")}</span>
      <span class="queue-meta"><b>${esc(a.name)}</b><i>${esc(a.role || a.mission || "")}</i></span>
      <span class="queue-badge q-${st.cls}">${st.label}</span>
    </button>`;
  }).join("") || `<p class="empty-line">No missions yet.</p>`;
}

/* ============================ quick actions ============================ */
const QUICK = [
  { label: "Create new content", icon: "spark",  run: "Draft a media brief for a new campaign" },
  { label: "Start video campaign", icon: "film",  run: "Create a video brief for the launch" },
  { label: "Run brand analysis", icon: "chart",   run: "What's my pipeline?" },
  { label: "Upload brand asset", icon: "upload",   open: "media" },
  { label: "View approval queue", icon: "check",   open: "approvals" },
];
function renderQuick() {
  $("[data-quick]").innerHTML = QUICK.map((q, i) => `
    <button class="quick-item" data-quick="${i}">
      <span class="quick-ic">${svg(q.icon)}</span>
      <span>${esc(q.label)}</span>
      <span class="quick-arrow">${svg("arrow")}</span>
    </button>`).join("");
}

/* ============================ console render ============================ */
function renderPlanMeta() {
  const renew = new Date(Date.now() + 30 * 864e5).toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });
  const el = $("[data-plan-renew]");
  if (el) el.textContent = `Renewal: ${renew}`;
}

function renderConsole() {
  renderNav();
  renderStatusPills();
  renderPlanMeta();
  renderUser();
  renderHero();
  renderChips();
  renderStatCards();
  renderActivity();
  renderPlan();
  renderQueue();
  renderQuick();
}

/* ============================ command run ============================ */
const sayBox = () => $("[data-say]");
let typeTimer = 0;
let ghostMood = "idle";
let ghostEmotion = "calm";
let ghostMoodUntil = 0;
let ghostMoodStartedAt = performance.now();
let phantomHasActed = false;

function emotionForText(text = "") {
  const s = text.toLowerCase();
  if (/\bwon\b|closed|delivered|booked|launched|published|5 stars|celebrat/.test(s)) return "excited";
  if (/\blost\b|declined|went quiet|overdue|no leads|slipped|empty|ghosted/.test(s)) return "sad";
  if (/security|scan|breach|risk|threat|password|malware|approval|waiting|blocked|paid/.test(s)) return "alert";
  if (/money|pipeline|revenue|quote|proposal|ready|captured|drafted|live/.test(s)) return "bright";
  if (/clear|current|nothing waiting|clean|welcome/.test(s)) return "happy";
  return "calm";
}
function setGhostMood(mood, options = {}) {
  const now = performance.now();
  if (ghostMood !== mood) ghostMoodStartedAt = now;
  ghostMood = mood;
  ghostEmotion = options.emotion || ghostEmotion;
  ghostMoodUntil = options.ms ? now + options.ms : 0;
}
function speechHoldMs(text = "") {
  const n = String(text || "").length;
  return Math.min(12000, Math.max(3200, n * 72));
}
function speak(text, cls = "") {
  clearTimeout(typeTimer);
  const box = sayBox();
  box.hidden = false;
  const p = document.createElement("p");
  p.className = `say-line ${cls}`.trim();
  box.replaceChildren(p);
  const emotion = emotionForText(text);
  if (cls === "thinking") setGhostMood("thinking", { emotion: "bright" });
  else if (cls === "user") setGhostMood("listening", { emotion: "calm", ms: 1600 });
  else setGhostMood("talking", { emotion, ms: speechHoldMs(text) });
  if (cls || reduceMotion) {
    p.textContent = text;
    if (!cls) setGhostMood("talking", { emotion, ms: speechHoldMs(text) });
    return;
  }
  let i = 0;
  const tick = () => {
    p.textContent = text.slice(0, i);
    if (i++ < text.length) typeTimer = setTimeout(tick, 11 + Math.random() * 16);
    else setGhostMood("talking", { emotion, ms: speechHoldMs(text) });
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
function runCommand(raw) {
  phantomHasActed = true;
  const mode = MODES[activeMode] || MODES.ask;
  const text = mode.prefix && !/\b(draft|create|build|make|write|new)\b/i.test(raw) ? mode.prefix + raw : raw;
  speak(raw, "user");
  ghostFlare("listening");
  const respBox = $("[data-response]");
  respBox.innerHTML = "";
  setTimeout(() => {
    speak("· · ·", "thinking");
    setTimeout(() => {
      const r = handleCommand(text);
      speak(r.say);
      respBox.innerHTML = (r.cards || []).map(cardHtml).join("");
      renderConsole();
      if (r.open) setTimeout(() => openWorkspace(r.open), reduceMotion ? 150 : 750);
    }, reduceMotion ? 120 : 620);
  }, reduceMotion ? 60 : 260);
}

function wireDeck() {
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
    const mode = e.target.closest("[data-mode]");
    if (mode) { setMode(mode.dataset.mode); return; }
    const navBtn = e.target.closest("[data-nav-id]");
    if (navBtn) { goNav(navBtn.dataset.navId); return; }
    const quick = e.target.closest("[data-quick]");
    if (quick) {
      const q = QUICK[+quick.dataset.quick];
      if (q?.run) runCommand(q.run);
      else if (q?.open) openWorkspace(q.open);
      return;
    }
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
      <button class="overlay-backdrop" data-overlay-close aria-label="Back to console"></button>
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
  if (!openId) { if (clearHash) syncNavToView(); return; }
  openId = null;
  overlayRoot.innerHTML = "";
  document.body.classList.remove("overlay-open");
  if (clearHash && location.hash.startsWith("#ws/")) {
    try { history.pushState(null, "", location.pathname + location.search); } catch {}
  }
  syncNavToView();
  renderConsole();
}
function syncNavToView() {
  if (!openId) { activeNav = "dashboard"; renderNav(); return; }
  const hit = NAV.find((n) => n.ws === openId);
  if (hit) { activeNav = hit.id; renderNav(); }
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && openId) closeOverlay(true); });
window.addEventListener("popstate", () => {
  const m = location.hash.match(/^#ws\/([a-z]+)/);
  if (m && WORKSPACE_DEFS[m[1]]) openWorkspace(m[1], false);
  else closeOverlay(false);
});

/* ============================ phantom console (chat overlay) ============================ */
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
    renderConsole();
  });
  setTimeout(() => input.focus(), 60);
}

/* ============================ ghost (2D character) ============================ */
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
  const character = createPhantomCharacter({ small });
  let w = 0, h = 0, dpr = 1;
  const resize = () => {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = Math.max(1, r.width); h = Math.max(1, r.height);
    canvas.width = w * dpr; canvas.height = h * dpr;
  };
  resize();
  window.addEventListener("resize", resize, { passive: true });
  let px = 0, py = 0, cpx = 0, cpy = 0;
  window.addEventListener("pointermove", (e) => {
    px = e.clientX / innerWidth - 0.5;
    py = e.clientY / innerHeight - 0.5;
  }, { passive: true });
  const t0 = performance.now();
  let last = t0;
  const frame = (now) => {
    if (document.hidden) { requestAnimationFrame(frame); return; }
    const t = (now - t0) * 0.001;
    const dt = Math.min(0.05, (now - last) * 0.001); last = now;
    if (ghostMoodUntil && now > ghostMoodUntil) { ghostMood = "idle"; ghostMoodUntil = 0; ghostMoodStartedAt = now; }
    ghostPulse = Math.max(0, ghostPulse - 0.02);
    cpx += (px - cpx) * 0.08; cpy += (py - cpy) * 0.08;
    ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx2.clearRect(0, 0, w, h);
    const mood =
      ghostMood === "talking" || ghostMood === "thinking" || ghostMood === "listening" ? ghostMood :
      ghostEmotion === "alert" ? "menace" : "idle";
    character.draw(ctx2, {
      t, dt,
      cx: w / 2, cy: h * 0.54,
      scale: Math.min(w, h) * 0.30,
      mood, emotion: ghostEmotion,
      startupOnly: false,
      moodAge: Math.max(0, (now - ghostMoodStartedAt) * 0.001),
      pulse: ghostPulse,
      px: cpx, py: cpy,
    });
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/* ============================ boot ============================ */
let ghostStarted = false;
function enterPhantom() {
  gate.hidden = true;
  phantom.hidden = false;
  if (!ghostStarted) { ghostStarted = true; initGhost(); startClock(); }
  activeNav = "dashboard";
  renderConsole();
  const q = new URLSearchParams(location.search);
  const view = (q.get("view") || "").toLowerCase();
  if (view && !["command", "dashboard", "home"].includes(view) && WORKSPACE_DEFS[view]) openWorkspace(view);
  const m = location.hash.match(/^#ws\/([a-z]+)/);
  if (m && WORKSPACE_DEFS[m[1]]) openWorkspace(m[1], false);
  // greet
  setTimeout(() => {
    setGhostMood("idle", { emotion: "happy" });
  }, 300);
}

async function boot() {
  ctx.session = isLiveAdminHost() ? await verifyLiveSession() : resolveSession();
  wireDeck();
  store.onChange(() => {
    if (!phantom.hidden) {
      renderNav(); renderStatusPills(); renderStatCards(); renderActivity(); renderPlan(); renderQueue();
    }
  });
  if (ctx.session) enterPhantom();
  else showGate();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
