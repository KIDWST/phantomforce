/* PhantomForce — AI Operations Console: shell, sidebar, dashboard, ghost, overlays. */

import {
  store, ctx, session, resolveSession, isAdmin, currentWs, setWorkspace, wsName,
  visible, todaysPlan, moneyView, fmtMoney, ago, pushActivity, isLiveAdminHost, isStaticPublicHost,
  ownerLogin, redirectToLiveAdmin, verifyLiveSession, memoryStats, rememberConversation, isOwnerOperator,
} from "./store.js?v=phantom-live-20260706-29";
import { handleCommand, commandSuggestions } from "./command.js?v=phantom-live-20260706-29";
import { WORKSPACE_DEFS, missionWidgets, esc } from "./workspaces.js?v=phantom-live-20260706-29";
import { createPhantomCharacter } from "./character.js?v=phantom-live-20260706-29";
import { renderMediaStudio, renderMediaSettings } from "./medialab.js?v=phantom-live-20260706-29";
import { renderContentHub, renderAnalytics } from "./contenthub.js?v=phantom-live-20260706-29";
import { createPhantomStage3D } from "./phantom-3d.js?v=phantom-live-20260706-29";
import { renderFlowMap } from "./flowmap.js?v=phantom-live-20260706-29";
import { mountAgentTicker, mountAgentConsole } from "./agentops.js?v=phantom-live-20260706-29";
import { renderBrandMemory, renderAutomation } from "./brandops.js?v=phantom-live-20260706-29";
import { mountCompanion, setCompanionState, getChatSettings } from "./companion.js?v=phantom-live-20260706-29";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const isPhoneView = () => window.matchMedia("(max-width: 720px)").matches;
const isMobileView = () => window.matchMedia("(max-width: 900px)").matches;

const gate = $("[data-gate]");
const phantom = $("[data-phantom]");
const overlayRoot = $("[data-overlay-root]");
const consoleRoot = $("[data-console]");
const dashboardShellHtml = consoleRoot ? consoleRoot.innerHTML : "";
let commandTouchScroll = { x: 0, y: 0 };
let keyboardViewportBound = false;

function updateKeyboardOffset() {
  const vv = window.visualViewport;
  const offset = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
  document.documentElement.style.setProperty("--phantom-keyboard-offset", `${Math.round(offset)}px`);
}

function bindKeyboardViewport() {
  if (keyboardViewportBound || !window.visualViewport) return;
  keyboardViewportBound = true;
  window.visualViewport.addEventListener("resize", updateKeyboardOffset, { passive: true });
  window.visualViewport.addEventListener("scroll", updateKeyboardOffset, { passive: true });
  updateKeyboardOffset();
}

function restoreMobileScroll(x = commandTouchScroll.x, y = commandTouchScroll.y) {
  if (!isMobileView()) return;
  requestAnimationFrame(() => window.scrollTo(x, y));
  setTimeout(() => window.scrollTo(x, y), 90);
}

function focusWithoutScroll(input) {
  if (!input) return;
  const x = window.scrollX;
  const y = window.scrollY;
  try { input.focus({ preventScroll: true }); }
  catch { input.focus(); }
  if (isMobileView()) restoreMobileScroll(x, y);
}

function setCommandFocusState(active) {
  phantom?.classList.toggle("is-command-focused", !!active);
  if (active) {
    commandTouchScroll = { x: window.scrollX, y: window.scrollY };
    bindKeyboardViewport();
    updateKeyboardOffset();
    if (mobileNavOpen) setMobileNav(false);
  } else {
    document.documentElement.style.setProperty("--phantom-keyboard-offset", "0px");
  }
}

function focusCommandInput(delay = 0) {
  const run = () => {
    const input = $("[data-command-input]");
    setCommandFocusState(true);
    focusWithoutScroll(input);
  };
  if (delay) setTimeout(run, delay);
  else run();
}

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
  dev:   `<path d="M5.5 5L3 8l2.5 3M10.5 5L13 8l-2.5 3M9 3.5 7 12.5"/>`,
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
      <p class="gate-note">The private gateway protects this route. PhantomForce owns the visible login and session.</p>`;
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
        ? { role: "admin", name: "Jordan", label: "PhantomForce Owner", ws: "phantomforce", sessionId: "local-admin", canManageAccess: true }
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
  { id: "content",    label: "Content Hub",  icon: "doc",   ws: "content" },
  { id: "memory",     label: "Memory",       icon: "brain", ws: "memory" },
  { id: "brand",      label: "Brand Memory", icon: "db",    ws: "brand" },
  { id: "automation", label: "Automation",   icon: "auto",  ws: "automation" },
  { id: "approvals",  label: "Approvals",    icon: "check", ws: "approvals", badge: true },
  { id: "workers",    label: "Workers",      icon: "users", ws: "workforce" },
  { id: "analytics",  label: "Analytics",    icon: "chart", ws: "analytics" },
  { id: "developer",  label: "Developer",    icon: "dev",   ws: "developer", ownerOnly: true },
  { id: "settings",   label: "Settings",     icon: "cog",   ws: "settings" },
];
const MOBILE_NAV = [
  { id: "dashboard", label: "Home",      icon: "grid",  route: "nav", target: "dashboard" },
  { id: "content",   label: "Content",   icon: "doc",   route: "nav", target: "content" },
  { id: "media",     label: "Video",     icon: "media", route: "nav", target: "media" },
  { id: "workers",   label: "Workers",   icon: "users", route: "nav", target: "workers" },
  { id: "analytics", label: "Analytics", icon: "chart", route: "nav", target: "analytics" },
];
let activeNav = "dashboard";
let activePageId = null;
let mobileNavOpen = false;

const WORKSPACE_ALIASES = {
  memory: "memory",
  content: "content",
  analytics: "analytics",
};

function workspaceId(id) {
  return WORKSPACE_ALIASES[id] || id;
}

function canAccessSurface(surface) {
  if (surface?.ownerOnly && !isOwnerOperator()) return false;
  if (surface?.adminOnly && !isAdmin()) return false;
  return true;
}

function renderNav() {
  const nav = $("[data-nav]");
  const pending = visible(store.state.approvals).filter((a) => a.status === "pending").length;
  nav.innerHTML = NAV.filter(canAccessSurface).map((n) => `
    <button class="nav-item ${activeNav === n.id ? "is-active" : ""}" data-nav-id="${n.id}">
      ${svg(n.icon)}
      <span>${n.label}</span>
      ${n.badge && pending ? `<em class="nav-badge">${pending}</em>` : ""}
    </button>`).join("");
  renderMobileBottomNav();
}

function mobileNavActive(item) {
  const target = workspaceId(item.target);
  if (item.route === "nav") return activeNav === item.target || (item.target === "dashboard" && !activePageId);
  return activePageId === target || openId === target;
}

function renderMobileBottomNav() {
  const nav = $("[data-mobile-bottom-nav]");
  if (!nav) return;
  nav.innerHTML = MOBILE_NAV.filter(canAccessSurface).map((item) => `
    <button class="mobile-bottom-item ${mobileNavActive(item) ? "is-active" : ""}" data-mobile-nav="${esc(item.id)}" type="button">
      ${svg(item.icon)}
      <span>${esc(item.label)}</span>
    </button>`).join("");
}

function setMobileNav(open) {
  mobileNavOpen = !!open;
  const shell = $("[data-phantom]");
  const sidebar = $(".sidebar");
  const toggle = $("[data-side-toggle]");
  shell?.classList.toggle("nav-expanded", mobileNavOpen);
  sidebar?.classList.toggle("is-expanded", mobileNavOpen);
  if (toggle) {
    toggle.setAttribute("aria-expanded", String(mobileNavOpen));
    toggle.setAttribute("aria-label", mobileNavOpen ? "Close navigation" : "Open navigation");
  }
}

function goNav(id) {
  const item = NAV.find((n) => n.id === id);
  if (!item) return;
  activeNav = id;
  renderNav();
  if (id !== "dashboard") {
    const mood = item.id === "approvals" ? { mood: "talking", emotion: "alert" } : { mood: "listening", emotion: "bright" };
    setGhostMood(mood.mood, { emotion: mood.emotion, ms: 1200 });
    stageReact("nav", 640);
  }
  if (item.view === "main") renderDashboardPage(true);
  else if (item.ws) renderWorkspacePage(item.ws, true);
}

function openOperationsMap() {
  if (activePageId) renderDashboardPage(true);
  const section = $("[data-map-section]");
  if (!section) return;
  const alreadyOpen = section.classList.contains("is-map-open");
  section.classList.remove("is-map-closed");
  section.classList.add("is-map-open");
  updateOperationsMapControls();
  renderFlowMap();
  section.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
  const stage = $("[data-flowmap]", section);
  if (stage) setTimeout(() => {
    try { stage.focus({ preventScroll: true }); }
    catch { stage.focus(); }
  }, reduceMotion ? 0 : 260);
  if (!alreadyOpen) {
    setGhostMood("listening", { emotion: "bright", ms: 1200 });
    stageReact("nav", 620);
  }
}
function closeOperationsMap() {
  const section = $("[data-map-section]");
  if (!section) return;
  section.classList.remove("is-map-open");
  section.classList.add("is-map-closed");
  updateOperationsMapControls();
  const opener = $("[data-map-open]", section) || $("[data-map-open]");
  if (opener && !opener.hidden) {
    try { opener.focus({ preventScroll: true }); }
    catch { opener.focus(); }
  }
}
function updateOperationsMapControls() {
  const section = $("[data-map-section]");
  const isOpen = Boolean(section?.classList.contains("is-map-open"));
  $$("[data-map-open]").forEach((button) => {
    if (button.closest("[data-map-section]")) button.hidden = isOpen;
    button.setAttribute("aria-expanded", String(isOpen));
    button.setAttribute("aria-label", isOpen ? "Operations map is already open" : "Open operations map");
  });
  $$("[data-map-open-label]").forEach((label) => { label.textContent = isOpen ? "Close map" : "Open map"; });
  $$("[data-map-close]").forEach((button) => {
    button.hidden = !isOpen;
    button.setAttribute("aria-expanded", String(isOpen));
  });
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
  const mobileAvatar = $("[data-mobile-user-avatar]");
  if (mobileAvatar) mobileAvatar.textContent = initials || "PF";
  $("[data-user-name]").textContent = name;
  $("[data-user-role]").textContent = isAdmin() ? "Administrator" : "Employee";
  const btn = $("[data-user-btn]");
  btn.onclick = () => {
    if (confirm("Sign out of PhantomForce?")) {
      session.clear(); ctx.session = null; closeOverlay(true); showGate();
    }
  };
}

/* ============================ account + plan ============================ */
const ACCOUNT_PLAN = {
  name: "Pro Plan",
  price: "$2,500/mo",
  renewalOffsetDays: 30,
  paymentState: "Manual billing ready",
  workspaceLimit: "Owner workspace",
};
const ACCOUNT_TIERS = [
  {
    id: "starter",
    name: "Starter",
    price: "$750/mo",
    badge: "Launch",
    copy: "Core cockpit, local approvals, and one active business workspace.",
    features: ["Command Center", "Leads and tasks", "Manual proposal workflow"],
  },
  {
    id: "pro",
    name: "Pro Plan",
    price: "$2,500/mo",
    badge: "Current",
    current: true,
    copy: "Managed Phantom AI operations, content workflow, Media Lab, and owner controls.",
    features: ["Phantom AI cockpit", "Content and Media Lab", "Approval-safe ops"],
  },
  {
    id: "scale",
    name: "Scale",
    price: "Custom",
    badge: "Operator",
    copy: "Expanded workspaces, deeper automations, and managed launch support.",
    features: ["Multi-workspace ops", "Automation planning", "Launch support"],
  },
];
let accountNotice = "";

function accountOwnerName() {
  return ctx.session?.name || (isAdmin() ? "Jordan" : "Owner");
}
function accountInitials(name) {
  const initials = String(name || "PhantomForce").split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  return initials || "PF";
}
function accountRenewalLabel() {
  return new Date(Date.now() + ACCOUNT_PLAN.renewalOffsetDays * 864e5).toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });
}
function accountStatusMeta() {
  const attention = store.state.security.some((s) => s.posture && s.posture !== "clean");
  return attention
    ? { label: "Attention needed", tone: "error", detail: "One or more systems need owner review before everything is clean." }
    : { label: "Systems online", tone: "online", detail: "PhantomForce systems are online and protected for this workspace." };
}
function renderAccountPlan(body) {
  const owner = accountOwnerName();
  const status = accountStatusMeta();
  const renewal = accountRenewalLabel();
  body.innerHTML = `
    <div class="account-plan">
      ${accountNotice ? `<div class="account-notice">${esc(accountNotice)}</div>` : ""}
      <section class="account-hero">
        <div class="account-avatar" aria-label="Profile picture">${esc(accountInitials(owner))}</div>
        <div class="account-hero-main">
          <p class="account-kicker">Account profile</p>
          <h3>${esc(owner)}</h3>
          <p class="account-status account-status-${status.tone}"><span aria-hidden="true"></span>${esc(status.label)}</p>
        </div>
        <div class="account-plan-chip">
          <span>${esc(ACCOUNT_PLAN.name)}</span>
          <b>${esc(ACCOUNT_PLAN.price)}</b>
        </div>
      </section>
      <section class="account-grid">
        <article class="account-card account-current">
          <p class="account-card-k">Current plan</p>
          <h4>${esc(ACCOUNT_PLAN.name)}</h4>
          <p>${esc(status.detail)}</p>
          <div class="account-facts">
            <span><b>Renewal</b>${esc(renewal)}</span>
            <span><b>Billing</b>${esc(ACCOUNT_PLAN.paymentState)}</span>
            <span><b>Access</b>${esc(ACCOUNT_PLAN.workspaceLimit)}</span>
          </div>
        </article>
        <article class="account-card account-payment">
          <p class="account-card-k">Payment options</p>
          <h4>Billing controls</h4>
          <p>No live payment connector is wired in this shell. These buttons prepare owner actions only.</p>
          <div class="account-actions">
            <button class="btn btn-primary" data-account-action="payment">Update payment method</button>
            <button class="btn" data-account-action="invoice">Request invoice</button>
          </div>
        </article>
      </section>
      <section class="account-section">
        <div class="set-sec-head">
          <div>
            <p class="account-card-k">Plan tiers</p>
            <h3>Choose the operating level</h3>
          </div>
        </div>
        <div class="account-tiers">
          ${ACCOUNT_TIERS.map((tier) => `
            <article class="account-tier ${tier.current ? "is-current" : ""}">
              <span class="account-tier-badge">${esc(tier.badge)}</span>
              <h4>${esc(tier.name)}</h4>
              <b>${esc(tier.price)}</b>
              <p>${esc(tier.copy)}</p>
              <ul>${tier.features.map((feature) => `<li>${esc(feature)}</li>`).join("")}</ul>
              <button class="btn ${tier.current ? "btn-good" : "btn-primary"}" data-account-action="${tier.current ? "current" : `plan-${tier.id}`}">
                ${tier.current ? "Current plan" : `Request ${esc(tier.name)}`}
              </button>
            </article>`).join("")}
        </div>
      </section>
      <section class="account-section account-cancel">
        <div>
          <p class="account-card-k">Cancellation</p>
          <h3>Plan changes stay owner-controlled</h3>
          <p>Cancellation is not automated here. PhantomForce can prepare a cancellation request, keep access through renewal, and wait for manual confirmation.</p>
        </div>
        <button class="btn btn-quiet" data-account-action="cancel">Prepare cancellation request</button>
      </section>
    </div>`;
  body.querySelectorAll("[data-account-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.accountAction || "plan";
      const label = {
        payment: "Payment-method update",
        invoice: "Manual invoice request",
        current: "Current plan review",
        cancel: "Cancellation request",
      }[action] || `${btn.textContent.trim()} request`;
      accountNotice = `${label} prepared for owner review. No billing, cancellation, payment, or access change was executed.`;
      pushActivity("Account", accountNotice);
      store.save();
      renderAccountPlan(body);
    });
  });
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
const POSE_VERSION = "phantom-live-20260706-29";
let phantom3d = null;
let phantomBootSettled = false;
let stageReactionTimer = 0;
let emotePoseTimer = 0;
let transientPoseKey = "";
const MODE_POSES = {
  ask: {
    src: "/app/assets/poses/chin.webp",
    caption: "Listening",
    alt: "Phantom listening",
  },
  write: {
    src: "/app/assets/poses/point.webp",
    caption: "Drafting",
    alt: "Phantom writing",
  },
  image: {
    src: "/app/assets/poses/conjure.webp",
    caption: "Conjuring",
    alt: "Phantom creating an image",
  },
  video: {
    src: "/app/assets/poses/present.webp",
    caption: "Directing video",
    alt: "Phantom directing a video",
  },
  website: {
    src: "/app/assets/poses/scheme.webp",
    caption: "Building pages",
    alt: "Phantom building a website",
  },
  admin: {
    src: "/app/assets/poses/assert.webp",
    caption: "Control",
    alt: "Phantom in admin control mode",
  },
};
const EMOTE_POSES = {
  listen: {
    src: "/app/assets/poses/chin.webp",
    caption: "Listening",
    alt: "Phantom leaning in to listen",
    pose: "listen",
  },
  think: {
    src: "/app/assets/poses/scheme.webp",
    caption: "Thinking",
    alt: "Phantom thinking through the request",
    pose: "think",
  },
  typing: {
    src: "/app/assets/poses/point.webp",
    caption: "Reading",
    alt: "Phantom tracking your typed request",
    pose: "typing",
  },
  talk: {
    src: "/app/assets/poses/coy.webp",
    caption: "Answering",
    alt: "Phantom answering",
    pose: "talk",
  },
  answer: {
    src: "/app/assets/poses/assert.webp",
    caption: "Got it",
    alt: "Phantom found the answer",
    pose: "answer",
  },
  alert: {
    src: "/app/assets/poses/cross.webp",
    caption: "Heads up",
    alt: "Phantom warning about something important",
    pose: "alert",
  },
  happy: {
    src: "/app/assets/poses/welcome.webp",
    caption: "Ready",
    alt: "Phantom ready to help",
    pose: "happy",
  },
};
const MODE_REACTIONS = {
  ask:     { mood: "listening", emotion: "calm", caption: "Listening" },
  write:   { mood: "thinking",  emotion: "bright", caption: "Writing" },
  image:   { mood: "thinking",  emotion: "excited", caption: "Conjuring" },
  video:   { mood: "thinking",  emotion: "bright", caption: "Directing" },
  website: { mood: "thinking",  emotion: "calm", caption: "Building" },
  admin:   { mood: "talking",   emotion: "alert", caption: "Operator mode" },
};

function poseUrl(src) {
  return `${src}?v=${POSE_VERSION}`;
}

function reactionForMode(id = activeMode) {
  return MODE_REACTIONS[id] || MODE_REACTIONS.ask;
}

function inferModeFromText(text = "") {
  const s = text.toLowerCase();
  if (/\b(video|reel|clip|shoot|phantomcut|edit|render)\b/.test(s)) return "video";
  if (/\b(image|photo|picture|graphic|creative|thumbnail|visual)\b/.test(s)) return "image";
  if (/\b(site|website|page|landing|store|checkout|web)\b/.test(s)) return "website";
  if (/\b(write|draft|proposal|quote|caption|email|follow.?up|copy)\b/.test(s)) return "write";
  if (/\b(status|admin|system|approval|protect|security|scan|worker|settings)\b/.test(s)) return "admin";
  return activeMode;
}

function stageCaptionText(mood = ghostMood, emotion = ghostEmotion) {
  if (transientPoseKey && EMOTE_POSES[transientPoseKey]?.caption) return EMOTE_POSES[transientPoseKey].caption;
  const mode = reactionForMode(activeMode);
  if (mood === "thinking") {
    if (activeMode === "write") return "Drafting";
    if (activeMode === "image") return "Conjuring";
    if (activeMode === "video") return "Directing";
    if (activeMode === "website") return "Building";
    return "Thinking";
  }
  if (mood === "talking") return emotion === "alert" ? "Heads up" : "Answering";
  if (mood === "listening") return "Listening";
  return mode.caption;
}

function applyStagePose(pose, poseId, cssPose = poseId) {
  const stage = $("[data-mode-stage]");
  const img = $("[data-mode-pose]");
  if (!stage || !img || !pose) return;
  phantom?.classList.add("has-mode-poses");
  const nextSrc = poseUrl(pose.src);
  const assetChanged = stage.dataset.poseAsset !== poseId || img.getAttribute("src") !== nextSrc;
  stage.dataset.pose = cssPose;
  stage.dataset.poseAsset = poseId;
  if (assetChanged) {
    stage.classList.remove("is-swapping");
    void stage.offsetWidth;
    stage.classList.add("is-swapping");
    clearTimeout(renderModePose.swapTimer);
    renderModePose.swapTimer = setTimeout(() => stage.classList.remove("is-swapping"), 420);
    img.setAttribute("src", nextSrc);
    if (phantom3d) phantom3d.setPose({ ...pose, id: poseId, src: nextSrc });
  }
  img.setAttribute("alt", pose.alt || "PhantomForce AI character");
  const caption = $("[data-mode-caption]");
  if (caption) caption.textContent = stageCaptionText(typeof ghostMood === "string" ? ghostMood : "idle", typeof ghostEmotion === "string" ? ghostEmotion : "calm");
}

function renderEmotePose(key, ms = 900) {
  const pose = EMOTE_POSES[key];
  if (!pose) return;
  transientPoseKey = key;
  applyStagePose(pose, `${activeMode}-${key}`, pose.pose || key);
  clearTimeout(emotePoseTimer);
  emotePoseTimer = setTimeout(() => {
    if (transientPoseKey === key) {
      transientPoseKey = "";
      renderModePose(activeMode);
    }
  }, Math.max(300, ms));
}

function stageReact(kind = "pulse", ms = 700) {
  const stage = $("[data-mode-stage]");
  if (!stage || reduceMotion) return;
  stage.dataset.reaction = kind;
  stage.classList.remove("is-reacting");
  void stage.offsetWidth;
  stage.classList.add("is-reacting");
  clearTimeout(stageReactionTimer);
  stageReactionTimer = setTimeout(() => {
    stage.classList.remove("is-reacting");
    if (stage.dataset.reaction === kind) delete stage.dataset.reaction;
  }, ms);
  const emote = {
    listen: "listen",
    think: "think",
    typing: "typing",
    answer: "answer",
    nav: "happy",
  }[kind] || (MODE_POSES[kind] ? "" : "");
  if (emote) renderEmotePose(emote, ms + 220);
  if (phantom3d?.burst) phantom3d.burst(kind, ms);
}

function syncPoseMood(mood = "idle", emotion = "calm") {
  const stage = $("[data-mode-stage]");
  if (stage) {
    stage.dataset.mood = mood;
    stage.dataset.emotion = emotion;
  }
  const caption = $("[data-mode-caption]");
  if (caption) caption.textContent = stageCaptionText(mood, emotion);
  if (phantom) {
    phantom.dataset.phantomMood = mood;
    phantom.dataset.phantomEmotion = emotion;
  }
  if (phantom3d) phantom3d.setMood(mood, emotion);
}

function renderModePose(id = activeMode) {
  const pose = MODE_POSES[id] || MODE_POSES.ask;
  const poseId = MODE_POSES[id] ? id : "ask";
  if (!transientPoseKey) applyStagePose(pose, poseId, poseId);
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
  const reaction = reactionForMode(id);
  setGhostMood(reaction.mood, { emotion: reaction.emotion, ms: id === "ask" ? 1800 : 1400 });
  stageReact(id, 760);
  if (m.open) { routeWorkspace(m.open); return; }
  const input = $("[data-command-input]");
  input.placeholder = m.placeholder;
  focusWithoutScroll(input);
}

function renderHero() {
  const name = (ctx.session?.name || "there").split(/\s+/)[0];
  $("[data-hero-name]").textContent = `${name}.`;
  renderHeroWorkAlert();
}

function renderHeroWorkAlert() {
  const alert = $("[data-hero-work-alert]");
  if (!alert) return;
  const latest = liveFeed[0] || visible(store.state.activity)[0] || {
    who: "Proposal Forge",
    text: "prepared quote #114 - waiting on your approval",
    icon: "chart",
    live: true,
    at: new Date().toISOString(),
  };
  alert.innerHTML = `
    <span class="forcewire-alert-label">Forcewire</span>
    <span class="forcewire-alert-ping" aria-hidden="true"></span>
    <span class="forcewire-alert-body">
      <b>${esc(latest.who || "PhantomForce")}</b>
      <em>${esc(latest.text || "prepared the next owner-safe move.")}</em>
    </span>
    <span class="forcewire-alert-time">${latest.live ? "now" : latest.at ? ago(latest.at) : "ready"}</span>`;
}

/* ============================ stat cards ============================ */
function renderStatCards() {
  const media = visible(store.state.media);
  const pending = visible(store.state.approvals).filter((a) => a.status === "pending").length;
  const workerTotal = Math.max(1, (store.state.toolSpine || []).length + 1);
  const mem = memoryStats();

  const cards = [
    { icon: "brain", title: "Phantom AI", value: "ON", sub: "Protected", foot: "Tap to talk", open: "phantom", trend: "on" },
    { icon: "users", title: "Workers", value: workerTotal, sub: "0 active now", foot: "Open roster", open: "workforce", trend: "ready" },
    { icon: "check", title: "Approvals", value: pending ? pending : "OK", sub: pending ? "Review" : "Clear", foot: pending ? "Needs owner call" : "All systems go", open: "approvals", alert: pending > 0, trend: pending ? "needs you" : "ready" },
    { icon: "db", title: "Memory", value: mem.total ? "ON" : "OK", sub: mem.total ? `${mem.total} notes` : "Ready", foot: mem.remembered ? `${mem.remembered} pinned` : "Private context", open: "memory", trend: "ready" },
    { icon: "media", title: "Media", value: media.length ? media.length : "OK", sub: media.length ? "Requests" : "Ready", foot: media.length ? "In pipeline" : "No blockers", open: "media", trend: "ready" },
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
  const msg = plan.length === 1 ? "One real thing needs you." : "A few real things need you.";
  $("[data-plan]").innerHTML = `
    <div class="section-head"><h2>Today's plan</h2></div>
    <button class="plan-inner" data-open-ws="approvals">
      <svg class="plan-donut" viewBox="0 0 72 72" aria-hidden="true">
        <circle cx="36" cy="36" r="30" class="plan-track"/>
        <text x="36" y="40" class="plan-pct">${plan.length}</text>
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
  active: { label: "READY", cls: "run" },
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
  { label: "Check pipeline", icon: "chart",   run: "What's my pipeline?" },
  { label: "Open media library", icon: "upload",   open: "media" },
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
  const mobileDot = $("[data-mobile-notif-dot]");
  if (dot) { dot.hidden = items.length === 0; dot.textContent = items.length > 9 ? "9+" : String(items.length); }
  if (mobileDot) { mobileDot.hidden = items.length === 0; mobileDot.textContent = items.length > 9 ? "9+" : String(items.length); }
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
  NAV.filter(canAccessSurface).forEach((n) =>
    items.push({ group: "Go to", label: n.label, icon: n.icon, sub: n.ws ? `Open ${n.label}` : "Console home", run: () => goNav(n.id) }));
  for (const id in WORKSPACE_DEFS) {
    const def = WORKSPACE_DEFS[id];
    if (!canAccessSurface(def)) continue;
    if (NAV.some((n) => n.ws === id)) continue;
    items.push({ group: "Go to", label: def.title, icon: "grid", sub: def.kicker, run: () => openWorkspace(id) });
  }
  QUICK.forEach((a) => items.push({ group: "Do", label: a.label, icon: a.icon, sub: a.run ? "Run command" : "Open", run: () => (a.run ? runCommand(a.run) : routeWorkspace(a.open)) }));
  commandSuggestions().forEach((s) => items.push({ group: "Ask", label: s, icon: "chat", sub: "Run", run: () => runCommand(s) }));
  if (q.length >= 2) {
    const add = (label, sub, open, icon) => items.push({ group: "Records", label, icon, sub, run: () => routeWorkspace(open) });
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
  setTimeout(() => focusWithoutScroll(input), 20);
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
  renderHeroWorkAlert();
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
  const renew = accountRenewalLabel();
  const owner = accountOwnerName();
  const status = accountStatusMeta();
  const nameEl = $("[data-profile-name]");
  const avatarEl = $("[data-profile-avatar]");
  const statusEl = $("[data-account-status]");
  const planEl = $("[data-plan-name]");
  const el = $("[data-plan-renew]");
  if (nameEl) nameEl.textContent = owner;
  if (avatarEl) avatarEl.textContent = accountInitials(owner);
  if (statusEl) {
    statusEl.className = `side-profile-status is-${status.tone}`;
    statusEl.innerHTML = `<span class="side-profile-dot" aria-hidden="true"></span>${esc(status.label)}`;
  }
  if (planEl) planEl.textContent = ACCOUNT_PLAN.name;
  if (el) el.textContent = `Renewal: ${renew}`;
}

function ensureDashboardShell() {
  const root = $("[data-console]");
  if (!root) return null;
  if (root.dataset.consoleView !== "dashboard") {
    root.className = "console";
    root.dataset.consoleView = "dashboard";
    delete root.dataset.pageWs;
    root.innerHTML = dashboardShellHtml;
  }
  return root;
}

function renderConsole() {
  if (activePageId) {
    renderWorkspacePage(activePageId, false);
    return;
  }
  ensureDashboardShell();
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
  renderFlowMap();
  updateOperationsMapControls();
  renderActivity();
  renderPlan();
  renderQueue();
  renderQuick();
  bindCommandForm();
  const openIc = $("[data-cmdk-open-ic]"); if (openIc && !openIc.innerHTML) openIc.innerHTML = svg("search");
  mountAgentTicker($("[data-agent-ticker]"));
  mountCompanion($("[data-chatbox] .chatbox-head"), { onSettings: applyChatSettings });
  renderChatLog();
}

/* ============================ command run ============================ */
const chatHistory = [];
const chatLogEl = () => $("[data-chat-log]");
function msgHtml(m, i) {
  const cards = (m.cards || []).map((c, ci) => cardHtml(c, ci, i)).join("");
  return `<div class="msg msg-${m.who}" data-msg-i="${i}">
    ${m.who === "phantom" ? `<span class="msg-avatar" aria-hidden="true"></span>` : ""}
    <div class="msg-body"><p class="msg-text"></p>${cards ? `<div class="msg-cards">${cards}</div>` : ""}</div>
  </div>`;
}
function renderChatLog() {
  const log = chatLogEl();
  if (!log) return;
  log.innerHTML = chatHistory.map(msgHtml).join("") + (chatHistory.length <= 1 ? starterHtml() : "");
  log.querySelectorAll(".msg").forEach((el, i) => {
    const text = el.querySelector(".msg-text");
    if (text) text.textContent = chatHistory[i]?.text || "";
  });
  bindStarters(log);
  bindCardRemovers(log, (entryIndex, cardIndex) => {
    const entry = chatHistory[entryIndex];
    if (entry?.cards) {
      entry.cards.splice(cardIndex, 1);
      renderChatLog();
    }
  });
  log.scrollTop = log.scrollHeight;
}
function applyChatSettings(settings = getChatSettings()) {
  const input = $("[data-command-input]");
  if (!input) return;
  const detail = settings.detail === "full" ? "with context" : settings.detail === "sales" ? "sales-ready" : "direct";
  input.placeholder = `Chat with PhantomForce - ${detail}, ${settings.speed}...`;
}

const CHAT_STARTERS = [
  { label: "Build a landing page", run: "Build a landing page for my business" },
  { label: "Create a proposal", run: "Draft a proposal for a new client" },
  { label: "Plan a campaign", run: "Draft a media brief for a new campaign" },
  { label: "Make an intake form", run: "Build a client intake form page" },
  { label: "Review my business", run: "What's my pipeline?" },
];

function starterHtml() {
  return `<div class="chat-start" data-chat-start>
    <p class="chat-start-t">Chat with Phantom.</p>
    <p class="chat-start-s">Ask for what you need. Phantom can plan, draft, organize, and prepare approval-ready next steps from one chat.</p>
    <div class="chat-start-grid">${CHAT_STARTERS.map((st, i) => `<button class="chat-start-btn" data-starter="${i}">${esc(st.label)}</button>`).join("")}</div>
  </div>`;
}

function bindStarters(log) {
  log.querySelectorAll("[data-starter]").forEach((button) => {
    button.onclick = () => {
      const starter = CHAT_STARTERS[Number(button.dataset.starter)];
      if (!starter) return;
      runCommand(starter.run);
    };
  });
}

function chatTypingOn() {
  const log = chatLogEl();
  if (!log || log.querySelector(".msg-typing")) return;
  log.insertAdjacentHTML("beforeend", `<div class="msg msg-phantom msg-typing"><span class="msg-avatar" aria-hidden="true"></span><div class="msg-body"><p class="msg-text msg-dots"><i></i><i></i><i></i></p></div></div>`);
  log.scrollTop = log.scrollHeight;
}
function chatTypingOff() {
  chatLogEl()?.querySelector(".msg-typing")?.remove();
}
function chatAttachCards(cards) {
  if (!cards?.length) return;
  for (let i = chatHistory.length - 1; i >= 0; i--) {
    if (chatHistory[i].who === "phantom") {
      chatHistory[i].cards = cards;
      break;
    }
  }
  renderChatLog();
}
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
  const emotion = emotionOverride || emotionForText(text);
  if (cls === "thinking") {
    setGhostMood("thinking", { emotion: "bright" });
    renderEmotePose("think", 900);
    setCompanionState("thinking");
    chatTypingOn();
    return;
  }
  if (cls === "user") {
    setGhostMood("listening", { emotion: "calm", ms: 1600 });
    renderEmotePose("listen", 1100);
    setCompanionState("listening");
    chatHistory.push({ who: "user", text });
    if (chatHistory.length > 40) chatHistory.shift();
    renderChatLog();
    return;
  }
  setGhostMood("talking", { emotion, ms: speechHoldMs(text) });
  renderEmotePose(emotion === "alert" ? "alert" : emotion === "happy" || emotion === "excited" ? "happy" : "talk", Math.min(2200, speechHoldMs(text)));
  setCompanionState(emotion === "alert" ? "warning" : emotion === "happy" || emotion === "excited" ? "success" : "speaking");
  chatTypingOff();
  chatHistory.push({ who: "phantom", text: "" });
  if (chatHistory.length > 40) chatHistory.shift();
  const entry = chatHistory[chatHistory.length - 1];
  renderChatLog();
  const paintLast = () => {
    const log = chatLogEl();
    const el = log?.querySelector(`[data-msg-i="${chatHistory.indexOf(entry)}"] .msg-text`);
    if (el) {
      el.textContent = entry.text;
      log.scrollTop = log.scrollHeight;
    }
  };
  if (reduceMotion) {
    entry.text = text;
    paintLast();
    setGhostMood("talking", { emotion, ms: speechHoldMs(text) });
    setCompanionState(emotion === "alert" ? "warning" : emotion === "happy" || emotion === "excited" ? "success" : "speaking");
    return;
  }
  let i = 0;
  const tick = () => {
    entry.text = text.slice(0, i);
    paintLast();
    const speed = getChatSettings().speed;
    const delay = speed === "fast" ? 6 + Math.random() * 8 : speed === "careful" ? 18 + Math.random() * 20 : 11 + Math.random() * 16;
    if (i++ < text.length) typeTimer = setTimeout(tick, delay);
    else {
      setGhostMood("talking", { emotion, ms: speechHoldMs(text) });
      setCompanionState(emotion === "alert" ? "warning" : emotion === "happy" || emotion === "excited" ? "success" : "speaking");
    }
  };
  tick();
}
function cardHtml(c, cardIndex = "", entryIndex = "") {
  const cardAttr = cardIndex !== "" ? ` data-card-index="${cardIndex}"` : "";
  const entryAttr = entryIndex !== "" ? ` data-entry-index="${entryIndex}"` : "";
  return `
    <article class="rcard"${cardAttr}${entryAttr}>
      <button class="rcard-x" data-card-remove data-card-index="${cardIndex}" data-entry-index="${entryIndex}" aria-label="Remove card">×</button>
      <p class="rcard-kicker">${esc(c.kicker)}</p>
      <h4>${esc(c.title)}</h4>
      ${c.body ? `<p class="rcard-body">${esc(c.body)}</p>` : ""}
      ${c.meta ? `<p class="rcard-meta">${esc(c.meta)}</p>` : ""}
      ${c.actions?.length ? `<div class="rcard-actions">${c.actions.map((a) => `<button class="btn" data-open-ws="${a.open}">${esc(a.label)}</button>`).join("")}</div>` : ""}
    </article>`;
}
function bindCardRemovers(root, onRemove) {
  if (!root) return;
  root.querySelectorAll("[data-card-remove]").forEach((btn) => {
    btn.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const entryIndex = btn.dataset.entryIndex;
      const cardIndex = btn.dataset.cardIndex;
      if (onRemove && entryIndex !== "" && cardIndex !== "") onRemove(Number(entryIndex), Number(cardIndex));
      else btn.closest(".rcard")?.remove();
    };
  });
}
function runCommand(raw) {
  phantomHasActed = true;
  const inferredMode = inferModeFromText(raw);
  if (inferredMode !== activeMode && MODES[inferredMode]) {
    activeMode = inferredMode;
    renderChips();
    renderModePose(inferredMode);
  }
  const mode = MODES[activeMode] || MODES.ask;
  const text = mode.prefix && !/\b(draft|create|build|make|write|new)\b/i.test(raw) ? mode.prefix + raw : raw;
  speak(raw, "user");
  ghostFlare("listening");
  stageReact("listen", 620);
  setTimeout(() => {
    speak("· · ·", "thinking");
    stageReact("think", 780);
    setTimeout(() => {
      const r = handleCommand(text);
      speak(r.say);
      if (r.cards?.length) chatAttachCards(r.cards);
      rememberConversation({ prompt: raw, reply: r.say, mode: activeMode, route: r.open || "" });
      renderConsole();
      stageReact("answer", 1100);
      if (r.open) setTimeout(() => routeWorkspace(r.open), reduceMotion ? 150 : 750);
    }, reduceMotion ? 120 : 620);
  }, reduceMotion ? 60 : 260);
}

function bindCommandForm() {
  const form = $("[data-command-form]");
  const input = $("[data-command-input]");
  if (!form || !input || form.dataset.bound === "true") return;
  form.dataset.bound = "true";
  form.addEventListener("pointerdown", () => {
    commandTouchScroll = { x: window.scrollX, y: window.scrollY };
  }, { passive: true });
  input.addEventListener("focus", () => {
    setCommandFocusState(true);
    const reaction = reactionForMode(activeMode);
    setGhostMood("listening", { emotion: reaction.emotion });
    setCompanionState("listening");
    stageReact("listen", 520);
    restoreMobileScroll();
  });
  input.addEventListener("input", () => {
    const value = input.value.trim();
    if (!value) {
      setGhostMood("listening", { emotion: reactionForMode(activeMode).emotion });
      setCompanionState("listening");
      return;
    }
    const inferredMode = inferModeFromText(value);
    if (inferredMode !== activeMode && MODES[inferredMode]) {
      activeMode = inferredMode;
      renderChips();
      renderModePose(inferredMode);
    }
    setGhostMood("thinking", { emotion: reactionForMode(activeMode).emotion, ms: 1100 });
    setCompanionState("listening");
    stageReact("typing", 520);
  });
  input.addEventListener("blur", () => {
    setCommandFocusState(false);
    if (!input.value.trim()) {
      setGhostMood("idle", { emotion: "happy", ms: 1200 });
      setCompanionState("idle");
    }
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = input.value.trim();
    if (!v) return;
    input.value = "";
    runCommand(v);
  });
}

function wireDeck() {
  bindCommandForm();
  document.addEventListener("click", (e) => {
    const mode = e.target.closest("[data-mode]");
    if (mode) { setMode(mode.dataset.mode); return; }
    if (e.target.closest("[data-mobile-home]")) { renderDashboardPage(true); return; }
    if (e.target.closest("[data-mobile-command]")) {
      renderDashboardPage(true);
      focusCommandInput(40);
      return;
    }
    if (e.target.closest("[data-mobile-bell]")) { routeWorkspace("approvals"); return; }
    if (e.target.closest("[data-mobile-user-btn]")) { routeWorkspace("account"); return; }
    const mobileNav = e.target.closest("[data-mobile-nav]");
    if (mobileNav) {
      const item = MOBILE_NAV.find((n) => n.id === mobileNav.dataset.mobileNav);
      if (!item) return;
      if (item.route === "nav") goNav(item.target);
      else routeWorkspace(item.target);
      return;
    }
    if (e.target.closest("[data-side-toggle]")) { setMobileNav(!mobileNavOpen); return; }
    const navBtn = e.target.closest("[data-nav-id]");
    if (navBtn) { goNav(navBtn.dataset.navId); setMobileNav(false); return; }
    const quick = e.target.closest("[data-quick]");
    if (quick) {
      const q = QUICK[+quick.dataset.quick];
      if (q?.run) runCommand(q.run);
      else if (q?.open) routeWorkspace(q.open);
      return;
    }
    if (e.target.closest("[data-cmdk-open]")) { openPalette(); return; }
    if (e.target.closest("[data-cmdk-close]")) { closePalette(); return; }
    const cItem = e.target.closest("[data-cmdk-i]");
    if (cItem) { execPalette(+cItem.dataset.cmdkI); return; }
    if (e.target.closest("[data-notif-btn]")) { notifOpen = !notifOpen; renderNotifs(); return; }
    if (e.target.closest("[data-map-open]")) { openOperationsMap(); return; }
    if (e.target.closest("[data-map-close]")) { closeOperationsMap(); return; }
    const opener = e.target.closest("[data-open-ws]");
    if (opener) { if (notifOpen) { notifOpen = false; renderNotifs(); } routeWorkspace(opener.dataset.openWs); return; }
    if (mobileNavOpen && window.matchMedia("(max-width: 900px)").matches && !e.target.closest(".sidebar")) { setMobileNav(false); return; }
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
    if (e.key === "/" && !typing) { e.preventDefault(); focusCommandInput(); }
    else if (e.key === "Escape" && $("[data-map-section]")?.classList.contains("is-map-open")) { closeOperationsMap(); }
    else if (e.key === "Escape" && mobileNavOpen) { setMobileNav(false); }
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
  openSettings: () => routeWorkspace("settings"),
  openWorkspace: (id) => routeWorkspace(id),
  renderBriefs: (bodyEl) => { const rr = () => WORKSPACE_DEFS.media.render(bodyEl, rr); rr(); },
});

function renderDeveloperPage(body) {
  if (!isOwnerOperator()) {
    body.innerHTML = `
      <div class="developer-denied">
        <p class="developer-kicker">Owner-only</p>
        <h3>Developer access is reserved for the PhantomForce owner account.</h3>
        <p>This surface is hidden from normal client, employee, and admin sessions.</p>
      </div>`;
    return;
  }
  const s = ctx.session || {};
  const mem = memoryStats();
  const state = store.state || {};
  const pendingApprovals = visible(state.approvals || []).filter((a) => a.status === "pending").length;
  const queuedArtifacts = (state.contentQueue || []).filter((item) => !item.archived && item.status !== "removed").length;
  const routes = [
    ["Owner account", "PhantomForce Owner"],
    ["Session", s.sessionId || "owner-admin"],
    ["Access guard", s.canManageAccess ? "canManageAccess true" : "local owner session"],
    ["Workspace", wsName(currentWs())],
    ["Host", location.hostname || "local"],
    ["Build", document.querySelector('meta[name="phantom-build"]')?.content || "local"],
  ];
  const safety = [
    ["Provider calls", "Blocked here"],
    ["Approval execution", "Absent"],
    ["External sends", "Blocked"],
    ["Queue writes", "Not from this page"],
    ["Production ledger writes", "Blocked"],
    ["Secrets", "Never displayed"],
  ];
  const shortcuts = [
    ["PhantomOps", "adminos", "System status, tool lane, and owner ops cockpit."],
    ["Memory", "memory", "Memory, recall, and local context."],
    ["Approvals", "approvals", "Human approval queue and blocked-action review."],
    ["Settings", "settings", "Media and provider configuration guardrails."],
  ];
  body.innerHTML = `
    <div class="developer-shell">
      <section class="developer-hero">
        <div>
          <p class="developer-kicker">Owner operator surface</p>
          <h3>Developer Control Room</h3>
          <p>Private operational visibility for the PhantomForce owner account. This page is read-only and does not execute providers, approvals, sends, or production writes.</p>
        </div>
        <div class="developer-owner">
          <span class="developer-owner-avatar">JW</span>
          <b>${esc(s.name || "Jordan")}</b>
          <i><span></span>Owner systems protected</i>
        </div>
      </section>

      <section class="stat-row developer-stats">
        <article class="stat-card"><span>Memory records</span><b>${mem.total}</b><i>Local memory surface</i></article>
        <article class="stat-card"><span>Pending approvals</span><b>${pendingApprovals}</b><i>Execution still gated</i></article>
        <article class="stat-card"><span>Queued artifacts</span><b>${queuedArtifacts}</b><i>Awaiting autopilot or removal</i></article>
        <article class="stat-card"><span>Owner gate</span><b>On</b><i>Owner-only tab</i></article>
      </section>

      <div class="developer-grid">
        <article class="developer-card">
          <p class="developer-kicker">Identity proof</p>
          <h4>Owner session</h4>
          <div class="developer-list">${routes.map(([k, v]) => `<span><b>${esc(k)}</b><i>${esc(v)}</i></span>`).join("")}</div>
        </article>
        <article class="developer-card">
          <p class="developer-kicker">Safety posture</p>
          <h4>No live execution from Developer</h4>
          <div class="developer-list">${safety.map(([k, v]) => `<span><b>${esc(k)}</b><i>${esc(v)}</i></span>`).join("")}</div>
        </article>
      </div>

      <section class="developer-card">
        <p class="developer-kicker">Owner shortcuts</p>
        <h4>Jump to protected operator surfaces</h4>
        <div class="developer-shortcuts">
          ${shortcuts.map(([label, open, copy]) => `
            <button class="developer-shortcut" data-open-ws="${esc(open)}">
              <b>${esc(label)}</b>
              <span>${esc(copy)}</span>
            </button>`).join("")}
        </div>
      </section>

      <section class="developer-card developer-agentops-card">
        <p class="developer-kicker">Internal operations</p>
        <h4>Agent operations</h4>
        <p class="developer-note">Worker spine diagnostics live here so the main dashboard stays focused on business actions.</p>
        <section class="agentops developer-agentops" data-developer-agentops aria-label="Developer agent operations"></section>
      </section>
    </div>`;
  mountAgentConsole(body.querySelector("[data-developer-agentops]"));
}

const CUSTOM = {
  media: { title: "Media Lab", kicker: "AI studio", custom: true, wide: true, render: (body) => renderMediaStudio(body, mediaOpts()) },
  content: { title: "Content Hub", kicker: "Posts, videos, images, and engagement", custom: true, wide: true, render: (body) => renderContentHub(body, mediaOpts()) },
  analytics: { title: "Analytics", kicker: "Trends, data, and business insight", custom: true, wide: true, render: (body) => renderAnalytics(body, mediaOpts()) },
  account: { title: "Account & Plan", kicker: "Profile, billing, and access", custom: true, render: (body) => renderAccountPlan(body) },
  developer: { title: "Developer", kicker: "Owner controls", custom: true, wide: true, ownerOnly: true, render: (body) => renderDeveloperPage(body) },
  settings: { title: "Settings", kicker: "Configuration", custom: true, render: (body) => renderMediaSettings(body, mediaOpts()) },
  brand: { title: "Brand Memory", kicker: "Private & local brand brain", custom: true, wide: true, render: (body) => renderBrandMemory(body, mediaOpts()) },
  automation: { title: "Automation", kicker: "Approved workflows only", custom: true, wide: true, render: (body) => renderAutomation(body, mediaOpts()) },
};

let openId = null;
function workspaceDef(id) {
  const key = workspaceId(id);
  return CUSTOM[key] || WORKSPACE_DEFS[key] || null;
}
function navForWorkspace(id) {
  const key = workspaceId(id);
  return NAV.find((n) => n.id === activeNav && n.ws === key && canAccessSurface(n))
    || NAV.find((n) => n.ws === key && canAccessSurface(n))
    || null;
}
function clearOverlayOnly() {
  openId = null;
  overlayRoot.innerHTML = "";
  document.body.classList.remove("overlay-open");
}
function renderDashboardPage(pushHash = true) {
  activePageId = null;
  activeNav = "dashboard";
  clearOverlayOnly();
  ensureDashboardShell();
  setGhostMood("idle", { emotion: "happy", ms: 1200 });
  stageReact("dashboard", 520);
  renderConsole();
  if (pushHash && location.hash) {
    try { history.pushState(null, "", location.pathname + location.search); } catch {}
  }
}
function renderWorkspacePage(id, pushHash = true) {
  const key = workspaceId(id);
  const def = workspaceDef(key);
  if (!def) return;
  if (!canAccessSurface(def)) return;
  const wsMood = key === "approvals" || key === "protect" ? { mood: "talking", emotion: "alert" } : { mood: "listening", emotion: "bright" };
  setGhostMood(wsMood.mood, { emotion: wsMood.emotion, ms: 1400 });
  stageReact(key === "media" ? "video" : key === "sites" ? "website" : "workspace", 720);
  const root = $("[data-console]");
  if (!root) return;
  const navHit = navForWorkspace(key);
  if (navHit) activeNav = navHit.id;
  activePageId = key;
  clearOverlayOnly();
  root.className = `console console-workspace ${def.wide ? "console-workspace-wide" : ""}`.trim();
  root.dataset.consoleView = "workspace";
  root.dataset.pageWs = key;
  root.innerHTML = `
    <section class="workspace-page ${def.wide ? "workspace-page-wide" : ""}" data-workspace-page="${esc(key)}">
      <header class="workspace-page-head">
        <div>
          <p class="workspace-page-kicker">${esc(def.kicker)}${!def.custom && isAdmin() && currentWs() !== "phantomforce" ? ` · ${esc(wsName(currentWs()))}` : ""}</p>
          <h1>${esc(def.title)}</h1>
        </div>
      </header>
      <div class="workspace-page-body" data-workspace-page-body></div>
    </section>`;
  renderNav();
  renderStatusPills();
  renderPlanMeta();
  renderUser();
  renderNotifs();
  const body = $("[data-workspace-page-body]", root);
  const rerender = () => {
    if (def.custom) def.render(body);
    else { def.render(body, rerender); if (key === "phantom") wirePhantomConsole(body); }
  };
  rerender();
  if (pushHash && location.hash !== `#page/${key}`) {
    try { history.pushState(null, "", `#page/${key}`); } catch {}
  }
}
function routeWorkspace(id, pushHash = true) {
  const key = workspaceId(id);
  if (key === "dashboard") { renderDashboardPage(pushHash); return; }
  if (navForWorkspace(key)) renderWorkspacePage(key, pushHash);
  else openWorkspace(key, pushHash);
}
function openWorkspace(id, pushHash = true) {
  const key = workspaceId(id);
  const def = workspaceDef(key);
  if (!def) return;
  if (!canAccessSurface(def)) return;
  const overlayMood = key === "approvals" || key === "protect" ? { mood: "talking", emotion: "alert" } : { mood: "listening", emotion: "bright" };
  setGhostMood(overlayMood.mood, { emotion: overlayMood.emotion, ms: 1400 });
  stageReact("workspace", 720);
  clearOverlayOnly();
  openId = key;
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
    else { def.render(body, rerender); if (key === "phantom") wirePhantomConsole(body); }
  };
  rerender();
  overlayRoot.querySelectorAll("[data-overlay-close]").forEach((b) => b.addEventListener("click", () => closeOverlay(true)));
  if (pushHash && location.hash !== `#ws/${key}`) {
    try { history.pushState(null, "", `#ws/${key}`); } catch {}
  }
  renderMobileBottomNav();
}
function closeOverlay(clearHash) {
  if (!openId) { if (clearHash) syncNavToView(); return; }
  openId = null;
  overlayRoot.innerHTML = "";
  document.body.classList.remove("overlay-open");
  if (clearHash && location.hash.startsWith("#ws/")) {
    try { history.pushState(null, "", activePageId ? `#page/${activePageId}` : location.pathname + location.search); } catch {}
  }
  syncNavToView();
  if (activePageId) renderWorkspacePage(activePageId, false);
  else renderConsole();
}
function syncNavToView() {
  if (!openId) {
    if (activePageId) {
      const hit = navForWorkspace(activePageId);
      if (hit) activeNav = hit.id;
    } else {
      activeNav = "dashboard";
    }
    renderNav();
    return;
  }
  const hit = NAV.find((n) => n.ws === openId && canAccessSurface(n));
  if (hit) { activeNav = hit.id; renderNav(); }
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && openId) closeOverlay(true); });
window.addEventListener("popstate", () => {
  const page = location.hash.match(/^#page\/([a-z-]+)/);
  const ws = location.hash.match(/^#ws\/([a-z-]+)/);
  if (page && workspaceDef(page[1])) renderWorkspacePage(page[1], false);
  else if (ws && workspaceDef(ws[1])) routeWorkspace(ws[1], false);
  else renderDashboardPage(false);
});

/* ============================ phantom console (chat overlay) ============================ */
const phantomHistory = [];
function wirePhantomConsole(body) {
  const log = $("[data-phantom-log]", body);
  const form = $("[data-phantom-form]", body);
  const input = $("[data-phantom-input]", body);
  const paint = () => {
    log.innerHTML = phantomHistory.map((h, entryIndex) => `
      <div class="phantom-entry">
        <p class="phantom-user">› ${esc(h.q)}</p>
        <p class="phantom-reply">${esc(h.say)}</p>
        ${(h.cards || []).map((c, cardIndex) => cardHtml(c, cardIndex, entryIndex)).join("")}
      </div>`).join("") || `<p class="phantom-hello">This is the full command console. Everything you ask lands as real work — drafts, requests, and pipelines, never just chat.</p>`;
    bindCardRemovers(log, (entryIndex, cardIndex) => {
      const cards = phantomHistory[entryIndex]?.cards;
      if (!cards) return;
      cards.splice(cardIndex, 1);
      paint();
    });
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
    rememberConversation({ prompt: v, reply: r.say, mode: "phantom-console", route: r.open || "" });
    paint();
    renderConsole();
  });
  setTimeout(() => focusWithoutScroll(input), 60);
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
    if (ghostMoodUntil && now > ghostMoodUntil) {
      ghostMood = "idle";
      ghostMoodUntil = 0;
      ghostMoodStartedAt = now;
      syncPoseMood(ghostMood, ghostEmotion);
      if (!transientPoseKey) renderModePose(activeMode);
    }
    ghostPulse = Math.max(0, ghostPulse - 0.02);
    cpx += (px - cpx) * 0.08; cpy += (py - cpy) * 0.08;
    ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx2.clearRect(0, 0, w, h);
    const mood =
      ghostMood === "talking" || ghostMood === "thinking" || ghostMood === "listening" ? ghostMood :
      ghostEmotion === "happy" || ghostEmotion === "excited" ? "happy" :
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
  const page = location.hash.match(/^#page\/([a-z-]+)/);
  const m = location.hash.match(/^#ws\/([a-z-]+)/);
  if (page && workspaceDef(page[1])) renderWorkspacePage(page[1], false);
  else if (m && workspaceDef(m[1])) routeWorkspace(m[1], false);
  else if (view && view !== "command" && workspaceDef(view)) routeWorkspace(view, false);
  // a data-driven spoken briefing once the reveal settles
  setTimeout(() => {
    phantomBootSettled = true;
    setGhostMood("idle", { emotion: "happy" });
    if (!openId && !activePageId) speak(briefingText(), "", "bright");
  }, 1400);
}

async function boot() {
  ctx.session = isLiveAdminHost() ? await verifyLiveSession() : resolveSession();
  wireDeck();
  store.onChange(() => {
    if (!phantom.hidden) {
      if (activePageId) { renderConsole(); return; }
      renderNav(); renderStatusPills(); renderNotifs(); renderInsights();
      renderStatCards(); renderFlowMap(); renderActivity(); renderPlan(); renderQueue();
    }
  });
  if (ctx.session) enterPhantom();
  else showGate();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
