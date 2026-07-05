/* PhantomForce — AI Operations Console: shell, sidebar, dashboard, ghost, overlays. */

import {
  store, ctx, session, resolveSession, isAdmin, currentWs, setWorkspace, wsName,
  visible, todaysPlan, moneyView, fmtMoney, ago, pushActivity, isLiveAdminHost, isStaticPublicHost,
  ownerLogin, redirectToLiveAdmin, verifyLiveSession,
} from "./store.js?v=phantom-live-20260705-15";
import { handleCommand, commandSuggestions } from "./command.js?v=phantom-live-20260705-15";
import { WORKSPACE_DEFS, missionWidgets, esc } from "./workspaces.js?v=phantom-live-20260705-15";
import { createPhantomCharacter } from "./character.js?v=phantom-live-20260705-15";
import { renderMediaStudio, renderMediaSettings } from "./medialab.js?v=phantom-live-20260705-15";
import { createPhantomStage3D } from "./phantom-3d.js?v=phantom-live-20260705-15";

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
  search:`<circle cx="7" cy="7" r="4"/><path d="M10 10l3.5 3.5"/>`,
  bell:  `<path d="M8 2.5a3.5 3.5 0 0 0-3.5 3.5c0 3-1.2 4-1.2 4h9.4s-1.2-1-1.2-4A3.5 3.5 0 0 0 8 2.5zM6.6 12.5a1.4 1.4 0 0 0 2.8 0"/>`,
  bolt:  `<path d="M8.5 2L4 9h3l-.5 5L11 7H8z"/>`,
  target:`<circle cx="8" cy="8" r="5.4"/><circle cx="8" cy="8" r="2.4"/>`,
  dollar:`<path d="M8 2.6v10.8M10.2 5.1c-.4-.9-1.2-1.3-2.2-1.3-1.3 0-2.3.7-2.3 1.9 0 2.6 4.8 1.3 4.8 4 0 1.3-1.1 2-2.5 2-1.2 0-2.1-.5-2.5-1.5"/>`,
  users: `<circle cx="6" cy="6" r="2.1"/><path d="M2.6 13c0-2 1.5-3.3 3.4-3.3S9.4 11 9.4 13"/><path d="M10.5 4.2a2 2 0 0 1 0 3.9M11 9.9c1.6.2 2.8 1.4 2.8 3.1"/>`,
  book:  `<path d="M3.5 3.5h6a1.5 1.5 0 0 1 1.5 1.5v8H5a1.5 1.5 0 0 1-1.5-1.5z"/><path d="M11 5a1.5 1.5 0 0 1 1.5-1.5H13v8h-2"/>`,
  calendar:`<rect x="2.8" y="3.5" width="10.4" height="9.5" rx="1.2"/><path d="M2.8 6h10.4M5.5 2.4v2M10.5 2.4v2"/>`,
};
const svg = (key, cls = "") => `<svg class="ic ${cls}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[key] || ""}</svg>`;

/* a tiny deterministic trend sparkline for a stat value (stable per value) */
function sparkline(seed, up = true) {
  const n = 12, pts = [];
  let v = 0.5;
  for (let i = 0; i < n; i++) {
    const r = (Math.sin(seed * 12.9898 + i * 4.1414) * 43758.5453) % 1;
    v = Math.max(0.08, Math.min(0.92, v + (Math.abs(r) - 0.5) * 0.34 + (up ? 0.02 : -0.02)));
    pts.push(v);
  }
  const W = 100, H = 30;
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${((i / (n - 1)) * W).toFixed(1)} ${((1 - p) * H).toFixed(1)}`).join(" ");
  const area = `${d} L${W} ${H} L0 ${H} Z`;
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <path class="spark-area" d="${area}"/><path class="spark-line" d="${d}"/></svg>`;
}

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
        : { role: "employee", name: "Employee", ws: "phantomforce" };
      session.set(ctx.session);
      enterPhantom();
    };
  });
}

/* ============================ sidebar nav ============================ */
const NAV = [
  { id: "dashboard",  label: "Dashboard",    icon: "grid",  view: "main" },
  { id: "media",      label: "Media Lab",    icon: "media", ws: "media" },
  { id: "content",    label: "Content Hub",  icon: "doc",   ws: "sites" },
  { id: "brand",      label: "Brand Memory", icon: "brain", ws: "workforce" },
  { id: "approvals",  label: "Approvals",    icon: "check", ws: "approvals", badge: true },
  { id: "automation", label: "Automation",   icon: "auto",  ws: "workforce" },
  { id: "analytics",  label: "Analytics",    icon: "chart", ws: "money" },
  { id: "settings",   label: "Settings",     icon: "cog",   ws: "settings" },
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
    { label: "Brand Memory", value: "Private & Local", tone: "ok", lock: true },
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
  $("[data-user-role]").textContent = isAdmin() ? "Administrator" : "Employee";
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
  image:   { label: "Image",   icon: "spark", placeholder: "Describe an image to create…", prefix: "Create an image request for " },
  video:   { label: "Video",   icon: "film",  placeholder: "Describe a video to produce…", prefix: "Create a video request for " },
  website: { label: "Website", icon: "grid",  placeholder: "Describe a page or site to build…", prefix: "Build a website for " },
  admin:   { label: "Admin",   icon: "cog",   placeholder: "", open: "adminos" },
};
let activeMode = "ask";
const POSE_VERSION = "phantom-live-20260705-15";
let phantom3d = null;
let phantomBootSettled = false;
const MODE_POSES = {
  ask: {
    src: "/app/assets/poses/mode-dark-ask.webp",
    caption: "Listening",
    alt: "Phantom listening",
  },
  write: {
    src: "/app/assets/poses/mode-dark-write.webp",
    caption: "Drafting",
    alt: "Phantom writing",
  },
  image: {
    src: "/app/assets/poses/mode-dark-image.webp",
    caption: "Conjuring",
    alt: "Phantom creating an image",
  },
  video: {
    src: "/app/assets/poses/mode-dark-video.webp",
    caption: "Directing video",
    alt: "Phantom directing a video",
  },
  website: {
    src: "/app/assets/poses/mode-dark-website.webp",
    caption: "Building pages",
    alt: "Phantom building a website",
  },
  admin: {
    src: "/app/assets/poses/mode-dark-admin.webp",
    caption: "Control",
    alt: "Phantom in admin control mode",
  },
};

function poseUrl(src) {
  return `${src}?v=${POSE_VERSION}`;
}

function syncPoseMood(mood = "idle", emotion = "calm") {
  const stage = $("[data-mode-stage]");
  if (stage) {
    stage.dataset.mood = mood;
    stage.dataset.emotion = emotion;
  }
  if (phantom3d) phantom3d.setMood(mood, emotion);
}

function renderModePose(id = activeMode) {
  const pose = MODE_POSES[id] || MODE_POSES.ask;
  const poseId = MODE_POSES[id] ? id : "ask";
  const stage = $("[data-mode-stage]");
  const img = $("[data-mode-pose]");
  const caption = $("[data-mode-caption]");
  if (!stage || !img) return;
  phantom?.classList.add("has-mode-poses");
  const nextSrc = poseUrl(pose.src);
  const poseChanged = stage.dataset.pose !== poseId || img.getAttribute("src") !== nextSrc;
  stage.dataset.pose = poseId;
  if (poseChanged) {
    stage.classList.remove("is-swapping");
    void stage.offsetWidth;
    stage.classList.add("is-swapping");
    clearTimeout(renderModePose.swapTimer);
    renderModePose.swapTimer = setTimeout(() => stage.classList.remove("is-swapping"), 420);
    img.setAttribute("src", nextSrc);
    if (phantom3d) phantom3d.setPose({ ...pose, id: poseId, src: nextSrc });
  }
  img.setAttribute("alt", pose.alt);
  if (caption) caption.textContent = pose.caption;
  syncPoseMood(typeof ghostMood === "string" ? ghostMood : "idle", typeof ghostEmotion === "string" ? ghostEmotion : "calm");
}

function renderChips() {
  const wrap = $("[data-cmd-chips]");
  wrap.innerHTML = Object.entries(MODES).map(([id, m]) => `
    <button class="cmd-chip ${activeMode === id ? "is-active" : ""}" data-mode="${id}" aria-pressed="${activeMode === id ? "true" : "false"}" title="${esc(m.label)} mode">
      ${svg(m.icon)}<span>${m.label}</span>
    </button>`).join("");
}

function setMode(id) {
  const m = MODES[id];
  if (!m) return;
  activeMode = id;
  renderChips();
  renderModePose(id);
  if (m.open) { openWorkspace(m.open); return; }
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
    { icon: "db",    title: "Brand Memory", value: files, sub: files ? "Files indexed" : "No files yet", foot: files ? `Updated ${ago(store.state.activity[0]?.at || new Date().toISOString())}` : "Waiting for first upload", open: "workforce", trend: files ? "live" : "empty" },
    { icon: "media", title: "Media Lab",    value: media.length, sub: "Video requests", foot: media.length ? `${delivered} delivered` : "No requests yet", open: "media", trend: media.length ? "ready" : "empty" },
    { icon: "check", title: "Approvals",    value: pending, sub: "Pending", foot: pending ? "Needs your review" : "Queue clear", open: "approvals", alert: pending > 0, trend: pending ? "action" : "clear" },
    { icon: "spark", title: "Content",      value: thisWeekCount(), sub: "This week", foot: thisWeekCount() ? "Real activity only" : "No activity yet", open: "media", trend: thisWeekCount() ? "live" : "empty" },
    { icon: "auto",  title: "Automations",  value: activeAgents, sub: "Active", foot: activeAgents ? "Real workers only" : "Not configured", open: "workforce", trend: activeAgents ? "live" : "empty" },
  ];
  $("[data-statcards]").innerHTML = cards.map((c) => `
    <button class="statcard ${c.alert ? "statcard-alert" : ""}" data-open-ws="${c.open}">
      <span class="statcard-top">
        <span class="statcard-icon">${svg(c.icon)}</span>
        <span class="statcard-trend ${c.alert ? "trend-alert" : ""}">${esc(c.trend)}</span>
      </span>
      <span class="statcard-k">${esc(c.title)}</span>
      <b class="statcard-v">${c.value}</b>
      <span class="statcard-sub">${esc(c.sub)}</span>
      ${sparkline(c.value + c.title.length, !c.alert)}
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
  const base = visible(store.state.activity).map((a) => ({ who: a.who, text: a.text, at: a.at, icon: ACT_ICON(a.text), live: false }));
  const items = [...liveFeed, ...base].slice(0, 4);
  const box = $("[data-activity]");
  if (!box) return;
  if (!items.length) { box.innerHTML = `<p class="empty-line">Quiet — nothing has run yet.</p>`; return; }
  box.innerHTML = items.map((a) => `
    <div class="act-card ${a.live ? "act-live" : ""}">
      <span class="act-thumb">${svg(a.icon || ACT_ICON(a.text))}</span>
      <span class="act-body">
        <b>${esc(a.who)} ${esc(a.text)}</b>
        <i>${a.live ? "just now" : ago(a.at)}</i>
      </span>
      <span class="act-dot" aria-hidden="true"></span>
    </div>`).join("");
}

/* ============================ today's plan (donut) ============================ */
function renderPlan() {
  const plan = todaysPlan();
  if (!plan.length) {
    $("[data-plan]").innerHTML = `
      <div class="section-head"><h2>Today's plan</h2></div>
      <button class="plan-inner" data-open-ws="leads">
        <svg class="plan-donut" viewBox="0 0 72 72" aria-hidden="true">
          <circle cx="36" cy="36" r="30" class="plan-track"/>
          <text x="36" y="40" class="plan-pct">0</text>
        </svg>
        <span class="plan-copy">
          <b>No real work loaded yet.</b>
          <i>Add a lead, draft a proposal, or connect a tool.</i>
        </span>
        <span class="plan-arrow">${svg("arrow")}</span>
      </button>`;
    return;
  }
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
  { label: "Create new content", icon: "spark",  run: "Create a media request for a new campaign" },
  { label: "Start video campaign", icon: "film",  run: "Create a video request for the launch" },
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

/* ============================ attention intelligence ============================ */
function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}
function attentionItems() {
  const items = [];
  visible(store.state.approvals).filter((a) => a.status === "pending").slice(0, 3)
    .forEach((a) => items.push({ icon: "check", tone: "warn", title: a.title, sub: "Waiting on your approval", open: "approvals" }));
  visible(store.state.security).filter((s) => s.posture && s.posture !== "clean")
    .forEach(() => items.push({ icon: "shield", tone: "warn", title: "Security posture needs a look", sub: "Protect flagged attention", open: "protect" }));
  visible(store.state.leads).filter((l) => l.due && new Date(l.due).getTime() < Date.now() + 864e5 && l.status !== "won" && l.status !== "lost").slice(0, 2)
    .forEach((l) => items.push({ icon: "users", tone: "warn", title: `Follow up: ${l.name}`, sub: l.next || "Due today", open: "leads" }));
  visible(store.state.proposals).filter((p) => p.status === "sent-ready").slice(0, 2)
    .forEach((p) => items.push({ icon: "dollar", tone: "ok", title: `Quote ready to send: ${p.client}`, sub: fmtMoney(p.price), open: "proposals" }));
  return items;
}
function renderInsights() {
  const box = $("[data-insights]");
  if (!box) return;
  const items = attentionItems();
  if (!items.length) {
    box.innerHTML = `<div class="insights-head"><span class="insights-k">${greeting()} — you're clear</span></div>
      <div class="insights-row"><div class="insight-card insight-clear"><span class="insight-ic">${svg("check")}</span><span class="insight-body"><b>No real tasks are waiting.</b><i>This account starts clean. Add work when you're ready.</i></span></div></div>`;
    return;
  }
  box.innerHTML = `<div class="insights-head"><span class="insights-k">${greeting()} — ${items.length} thing${items.length > 1 ? "s" : ""} need${items.length > 1 ? "" : "s"} you</span><button class="insights-all" data-open-ws="approvals">Review all</button></div>
    <div class="insights-row">${items.slice(0, 4).map((it) => `
      <button class="insight-card insight-${it.tone}" data-open-ws="${it.open}">
        <span class="insight-ic">${svg(it.icon)}</span>
        <span class="insight-body"><b>${esc(it.title)}</b><i>${esc(it.sub)}</i></span>
      </button>`).join("")}</div>`;
}

/* ============================ notifications ============================ */
let notifOpen = false;
function renderNotifs() {
  const items = attentionItems();
  const btnIc = $("[data-notif-ic]"); if (btnIc) btnIc.innerHTML = svg("bell");
  const dot = $("[data-notif-dot]");
  if (dot) { dot.hidden = items.length === 0; dot.textContent = items.length > 9 ? "9+" : String(items.length); }
  const menu = $("[data-notif-menu]");
  if (!menu) return;
  menu.hidden = !notifOpen;
  if (!notifOpen) return;
  menu.innerHTML = `<div class="notif-head">Notifications${items.length ? ` · ${items.length}` : ""}</div>` + (items.length
    ? items.map((it) => `<button class="notif-item" data-open-ws="${it.open}"><span class="notif-item-ic notif-${it.tone}">${svg(it.icon)}</span><span class="notif-item-body"><b>${esc(it.title)}</b><i>${esc(it.sub)}</i></span></button>`).join("")
    : `<div class="notif-empty">You're all caught up.</div>`);
}

/* ============================ ⌘K command palette ============================ */
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => (a && a.length ? a[rnd(a.length)] : null);
let cmdkOpen = false, cmdkIdx = 0, cmdkItems = [];
function fuzzy(q, text) {
  if (!q) return 1;
  if (text.includes(q)) return 200 - text.indexOf(q);
  let ti = 0, score = 0;
  for (const ch of q) { const f = text.indexOf(ch, ti); if (f < 0) return 0; score += 1 / (1 + f - ti); ti = f + 1; }
  return score;
}
function paletteSources(query) {
  const q = query.trim().toLowerCase();
  const items = [];
  NAV.filter((n) => !n.adminOnly || isAdmin()).forEach((n) =>
    items.push({ group: "Go to", label: n.label, icon: n.icon, sub: n.ws ? `Open ${n.label}` : "Console home", run: () => goNav(n.id) }));
  for (const id in WORKSPACE_DEFS) {
    const def = WORKSPACE_DEFS[id];
    if (def.adminOnly && !isAdmin()) continue;
    if (NAV.some((n) => n.ws === id)) continue;
    items.push({ group: "Go to", label: def.title, icon: "grid", sub: def.kicker, run: () => openWorkspace(id) });
  }
  QUICK.forEach((a) => items.push({ group: "Do", label: a.label, icon: a.icon, sub: a.run ? "Run command" : "Open", run: () => (a.run ? runCommand(a.run) : openWorkspace(a.open)) }));
  commandSuggestions().forEach((s) => items.push({ group: "Ask", label: s, icon: "chat", sub: "Run", run: () => runCommand(s) }));
  if (q.length >= 2) {
    const add = (label, sub, open, icon) => items.push({ group: "Records", label, icon, sub, run: () => openWorkspace(open) });
    visible(store.state.leads).filter((l) => (l.name || "").toLowerCase().includes(q) || (l.company || "").toLowerCase().includes(q)).slice(0, 4)
      .forEach((l) => add(l.name, `Lead · ${l.company || l.status}`, "leads", "users"));
    visible(store.state.proposals).filter((p) => (p.client || "").toLowerCase().includes(q)).slice(0, 4)
      .forEach((p) => add(p.client, `Proposal · ${fmtMoney(p.price)}`, "proposals", "dollar"));
    visible(store.state.media).filter((m) => (m.title || "").toLowerCase().includes(q)).slice(0, 4)
      .forEach((m) => add(m.title, "Video request", "media", "film"));
    visible(store.state.sites).filter((s) => (s.title || "").toLowerCase().includes(q)).slice(0, 4)
      .forEach((s) => add(s.title, `${s.kind}`, "sites", "grid"));
  }
  const scored = items.map((it) => ({ it, s: fuzzy(q, (it.label + " " + (it.sub || "")).toLowerCase()) })).filter((x) => q === "" || x.s > 0);
  scored.sort((a, b) => b.s - a.s);
  const out = scored.map((x) => x.it);
  // "Ask Phantom: <query>" is always available, but only jumps to the top when
  // nothing else matches strongly — so typing a workspace name opens it directly.
  if (q) {
    const ask = { group: "Ask", label: `Ask Phantom: "${query.trim()}"`, icon: "chat", sub: "Run as a command", run: () => runCommand(query.trim()) };
    const strong = scored[0] && scored[0].s >= 100;   // a direct substring hit
    if (strong) out.push(ask); else out.unshift(ask);
  }
  return out.slice(0, 40);
}
function renderPalette(query) {
  cmdkItems = paletteSources(query);
  cmdkIdx = Math.min(cmdkIdx, Math.max(0, cmdkItems.length - 1));
  const box = $("[data-cmdk-results]");
  if (!cmdkItems.length) { box.innerHTML = `<div class="cmdk-empty">No matches. Press ↵ to ask Phantom.</div>`; return; }
  let lastGroup = "";
  box.innerHTML = cmdkItems.map((it, i) => {
    const head = it.group !== lastGroup ? `<div class="cmdk-group">${esc(it.group)}</div>` : "";
    lastGroup = it.group;
    return `${head}<button class="cmdk-item ${i === cmdkIdx ? "is-sel" : ""}" data-cmdk-i="${i}">
      <span class="cmdk-item-ic">${svg(it.icon)}</span>
      <span class="cmdk-item-body"><b>${esc(it.label)}</b>${it.sub ? `<i>${esc(it.sub)}</i>` : ""}</span>
      <span class="cmdk-item-enter">↵</span></button>`;
  }).join("");
  const sel = box.querySelector(".is-sel"); if (sel) sel.scrollIntoView({ block: "nearest" });
}
function renderPaletteSel() {
  const box = $("[data-cmdk-results]");
  box.querySelectorAll(".cmdk-item").forEach((el) => el.classList.toggle("is-sel", +el.dataset.cmdkI === cmdkIdx));
  const sel = box.querySelector(".is-sel"); if (sel) sel.scrollIntoView({ block: "nearest" });
}
function openPalette() {
  if (phantom.hidden) return;
  cmdkOpen = true; cmdkIdx = 0;
  const root = $("[data-cmdk]"); root.hidden = false;
  requestAnimationFrame(() => root.classList.add("is-open"));
  $("[data-cmdk-input-ic]").innerHTML = svg("search");
  const input = $("[data-cmdk-input]"); input.value = ""; renderPalette("");
  setTimeout(() => input.focus(), 20);
}
function closePalette() {
  cmdkOpen = false;
  const root = $("[data-cmdk]"); root.classList.remove("is-open");
  setTimeout(() => { if (!cmdkOpen) root.hidden = true; }, 180);
}
function execPalette(i = cmdkIdx) {
  const it = cmdkItems[i];
  if (!it) return;
  closePalette();
  setTimeout(() => it.run(), 60);
}

/* ============================ live pulse ============================ */
let liveFeed = [];
let pulseTimer = 0;
function pushLive() {
  if (phantom.hidden || document.hidden) return;
  const agents = store.state.agents || [];
  const leads = visible(store.state.leads);
  const media = visible(store.state.media);
  const builders = [
    () => { const a = pick(agents); return a && { who: a.name, text: ["is scanning channels.", "is drafting the next move.", "synced with the desks.", "is watching for signal."][rnd(4)], icon: "auto" }; },
    () => { const l = pick(leads); return l && { who: "Lead Hunter", text: `re-scored ${l.name} — ${l.status}.`, icon: "users" }; },
    () => { const m = pick(media); return m && { who: "Media Factory", text: `advanced "${m.title}".`, icon: "film" }; },
  ];
  let ev = null;
  for (let k = 0; k < 6 && !ev; k++) ev = builders[rnd(builders.length)]();
  if (!ev) return;
  liveFeed.unshift({ ...ev, at: new Date().toISOString(), live: true });
  liveFeed = liveFeed.slice(0, 6);
  if (!cmdkOpen) renderActivity();
}
function startPulse() {
  clearInterval(pulseTimer);
  if (reduceMotion) return;
  pulseTimer = setInterval(pushLive, 7000);
}

/* ============================ spoken briefing ============================ */
function briefingText() {
  const m = moneyView();
  const pend = visible(store.state.approvals).filter((a) => a.status === "pending").length;
  const name = (ctx.session?.name || "there").split(/\s+/)[0];
  const bits = [`${greeting()}, ${name}`];
  if (m.pipeline) bits.push(`${fmtMoney(m.pipeline)} in open pipeline`);
  if (pend) bits.push(`${pend} approval${pend > 1 ? "s" : ""} waiting on you`);
  if (!pend && !m.pipeline) bits.push("no real work loaded yet");
  return bits.slice(0, 3).join(" · ") + ". What do you want handled first?";
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
  renderNotifs();
  renderHero();
  renderChips();
  renderModePose(activeMode);
  renderInsights();
  renderStatCards();
  renderActivity();
  renderPlan();
  renderQueue();
  renderQuick();
  const openIc = $("[data-cmdk-open-ic]"); if (openIc && !openIc.innerHTML) openIc.innerHTML = svg("search");
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
  syncPoseMood(ghostMood, ghostEmotion);
}
function speechHoldMs(text = "") {
  const n = String(text || "").length;
  return Math.min(12000, Math.max(3200, n * 72));
}
function speak(text, cls = "", emotionOverride = null) {
  clearTimeout(typeTimer);
  const box = sayBox();
  box.hidden = false;
  const p = document.createElement("p");
  p.className = `say-line ${cls}`.trim();
  box.replaceChildren(p);
  const emotion = emotionOverride || emotionForText(text);
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
    if (e.target.closest("[data-cmdk-open]")) { openPalette(); return; }
    if (e.target.closest("[data-cmdk-close]")) { closePalette(); return; }
    const cItem = e.target.closest("[data-cmdk-i]");
    if (cItem) { execPalette(+cItem.dataset.cmdkI); return; }
    if (e.target.closest("[data-notif-btn]")) { notifOpen = !notifOpen; renderNotifs(); return; }
    const opener = e.target.closest("[data-open-ws]");
    if (opener) { if (notifOpen) { notifOpen = false; renderNotifs(); } openWorkspace(opener.dataset.openWs); return; }
    // click outside notif menu closes it
    if (notifOpen && !e.target.closest(".notif-wrap")) { notifOpen = false; renderNotifs(); }
  });
  // command palette input
  const cin = $("[data-cmdk-input]");
  if (cin) cin.addEventListener("input", () => { cmdkIdx = 0; renderPalette(cin.value); });
  // global keyboard
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) { e.preventDefault(); cmdkOpen ? closePalette() : openPalette(); return; }
    if (cmdkOpen) {
      if (e.key === "ArrowDown") { e.preventDefault(); cmdkIdx = Math.min(cmdkItems.length - 1, cmdkIdx + 1); renderPaletteSel(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); cmdkIdx = Math.max(0, cmdkIdx - 1); renderPaletteSel(); }
      else if (e.key === "Enter") { e.preventDefault(); execPalette(); }
      else if (e.key === "Escape") { e.preventDefault(); closePalette(); }
      return;
    }
    if (phantom.hidden) return;
    const typing = /^(input|textarea|select)$/i.test(e.target.tagName);
    if (e.key === "/" && !typing) { e.preventDefault(); $("[data-command-input]")?.focus(); }
    else if (e.key === "Escape" && notifOpen) { notifOpen = false; renderNotifs(); }
  });
}

/* ============================ overlay engine ============================ */
/* Custom, non-store workspaces (the Media Lab studio + Settings). These
   override / extend WORKSPACE_DEFS without touching workspaces.js. */
const mediaOpts = () => ({
  esc,
  isAdmin: isAdmin(),
  notify: (who, text) => { pushActivity(who, text); store.save(); },
  openSettings: () => openWorkspace("settings"),
  renderBriefs: (bodyEl) => { const rr = () => WORKSPACE_DEFS.media.render(bodyEl, rr); rr(); },
});
const CUSTOM = {
  media: { title: "Media Lab", kicker: "AI studio", custom: true, wide: true, render: (body) => renderMediaStudio(body, mediaOpts()) },
  settings: { title: "Settings", kicker: "Configuration", custom: true, render: (body) => renderMediaSettings(body, mediaOpts()) },
};

let openId = null;
function openWorkspace(id, pushHash = true) {
  const def = CUSTOM[id] || WORKSPACE_DEFS[id];
  if (!def) return;
  if (def.adminOnly && !isAdmin()) return;
  closeOverlay(false);
  openId = id;
  document.body.classList.add("overlay-open");
  overlayRoot.innerHTML = `
    <div class="overlay ${def.wide ? "overlay-wide" : ""}" role="dialog" aria-modal="true" aria-label="${esc(def.title)}">
      <button class="overlay-backdrop" data-overlay-close aria-label="Back to console"></button>
      <section class="overlay-panel">
        <header class="overlay-head">
          <div>
            <p class="overlay-kicker">${esc(def.kicker)}${!def.custom && isAdmin() && currentWs() !== "phantomforce" ? ` · ${esc(wsName(currentWs()))}` : ""}</p>
            <h2>${esc(def.title)}</h2>
          </div>
          <button class="overlay-x" data-overlay-close aria-label="Close workspace">✕</button>
        </header>
        <div class="overlay-body" data-overlay-body></div>
      </section>
    </div>`;
  const body = $("[data-overlay-body]", overlayRoot);
  const rerender = () => {
    if (def.custom) def.render(body);
    else { def.render(body, rerender); if (id === "phantom") wirePhantomConsole(body); }
  };
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
  if (m && (CUSTOM[m[1]] || WORKSPACE_DEFS[m[1]])) openWorkspace(m[1], false);
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
      </div>`).join("") || `<p class="phantom-hello">This is the full command console. Everything you ask lands as real work — drafts, requests, and pipelines, never just chat.</p>`;
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
function initPhantom3D() {
  const canvas = $("[data-phantom-3d]");
  if (!canvas || reduceMotion || phantom3d) return;
  try {
    phantom3d = createPhantomStage3D({ canvas, reduceMotion });
    if (!phantom3d) return;
    phantom?.classList.add("has-3d-phantom");
    const pose = MODE_POSES[activeMode] || MODE_POSES.ask;
    phantom3d.setPose({ ...pose, id: activeMode, src: poseUrl(pose.src) });
    phantom3d.setMood(ghostMood || "idle", ghostEmotion || "calm");
  } catch (error) {
    console.warn("Phantom 3D stage unavailable", error);
    phantom3d = null;
  }
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
      startupOnly: !phantomBootSettled && !phantomHasActed,
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
  if (!ghostStarted) { ghostStarted = true; initPhantom3D(); initGhost(); startClock(); startPulse(); }
  activeNav = "dashboard";
  renderConsole();
  requestAnimationFrame(() => phantom.classList.add("booted"));
  const q = new URLSearchParams(location.search);
  const view = (q.get("view") || "").toLowerCase();
  if (view && view !== "command" && (CUSTOM[view] || WORKSPACE_DEFS[view])) openWorkspace(view);
  const m = location.hash.match(/^#ws\/([a-z]+)/);
  if (m && WORKSPACE_DEFS[m[1]]) openWorkspace(m[1], false);
  // a data-driven spoken briefing once the reveal settles
  setTimeout(() => {
    phantomBootSettled = true;
    setGhostMood("idle", { emotion: "happy" });
    if (!openId) speak(briefingText(), "", "bright");
  }, 1400);
}

async function boot() {
  ctx.session = isLiveAdminHost() ? await verifyLiveSession() : resolveSession();
  wireDeck();
  store.onChange(() => {
    if (!phantom.hidden) {
      renderNav(); renderStatusPills(); renderNotifs(); renderInsights();
      renderStatCards(); renderActivity(); renderPlan(); renderQueue();
    }
  });
  if (ctx.session) enterPhantom();
  else showGate();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
