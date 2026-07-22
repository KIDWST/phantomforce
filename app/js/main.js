/* PhantomForce — AI Operations Console: shell, sidebar, dashboard, ghost, overlays. */

import {
  store, ctx, session, resolveSession, isAdmin, currentWs, currentTenantId, setWorkspace, wsName,
  visible, todaysPlan, moneyView, fmtMoney, ago, pushActivity, isLiveAdminHost, isClientPublicHost, isLocalDevHost, isStaticPublicHost,
  redirectToLiveAdmin, verifyLiveSession, memoryStats, rememberConversation, isOwnerOperator,
  loadPhantomLoop, savePhantomLoop, loopProviderName, LOOP_PROVIDERS, TOOL_SPINE,
  loadPhantomLaneConfig, savePhantomLaneConfig, PHANTOM_LANES, PHANTOM_LANE_TARGETS, phantomLaneTargetName,
} from "./store.js?v=phantom-live-20260722-23";
import {
  loadOrganizationPulse, loadBrainContract, pulseAttentionItems, brainContractAttentionItems,
} from "./organizationpulse.js?v=phantom-live-20260722-23";
import { handleCommand, handleSmartCommand, commandSuggestions } from "./command.js?v=phantom-live-20260722-23";
import { WORKSPACE_DEFS, missionWidgets, esc } from "./workspaces.js?v=phantom-live-20260722-23";
import { createPhantomCharacter } from "./character.js?v=phantom-live-20260722-23";
import { renderMediaStudio, DEFAULT_PROVIDERS } from "./medialab.js?v=phantom-live-20260722-23";
import { renderNeuralMap } from "./systemsmap.js?v=phantom-live-20260722-23";
import { renderContentHub, renderAnalytics } from "./contenthub.js?v=phantom-live-20260722-23";
import { mountManagedGrowthReport } from "./managedgrowth.js?v=phantom-live-20260722-23";
import { createPhantomStage3D } from "./phantom-3d.js?v=phantom-live-20260722-23";
import { renderFlowMap, flowSummary } from "./flowmap.js?v=phantom-live-20260722-23";
import { mountPhantomWire, mountAgentConsole } from "./agentops.js?v=phantom-live-20260722-23";
import { mountPhantomAI } from "./phantomai.js?v=phantom-live-20260722-23";
import { renderAutomation, renderDeveloperAutopilotPanel, renderDeveloperAgentRunsPanel } from "./brandops.js?v=phantom-live-20260722-23";
import { renderVacationMode, cachedVacationStatus } from "./vacation.js?v=phantom-live-20260722-23";
import { renderSiteStudio } from "./sitestudio.js?v=phantom-live-20260722-23";
import { renderPromptLibrary } from "./promptlibrary.js?v=phantom-live-20260722-23";
import { mountCompanion, setCompanionState, setCompanionMode, companionMode, refreshCompanionCore } from "./companion.js?v=phantom-live-20260722-23";
import { mountDesktopContextWidget } from "./desktop-context.js?v=phantom-live-20260722-23";
import { renderOperatorMiniSettings, renderOperatorSettings } from "./settings.js?v=phantom-live-20260722-23";
import { getRembgStatus, getMediaEngineHealth } from "./mediabackend.js?v=phantom-live-20260722-23";
import { mountBuddy, buddyReact } from "./buddy.js?v=phantom-live-20260722-23";
import { mountAmbient } from "./ambient.js?v=phantom-live-20260722-23";
import { renderCompetitorIntelligence } from "./competitor-intelligence.js?v=phantom-live-20260722-23";
import {
  fetchAuthConfig, databaseLogin, databaseLogout, databaseSignup, databaseForgotUsername, databaseForgotPassword,
  databaseResetPassword, databaseAcceptInvitation, databaseVerify2fa, databaseStart2faSetup, databaseConfirm2fa, databaseRegenerate2faBackupCodes, databaseDisable2fa,
  switchOrg, fetchAuthMe, fetchEntitlementsSummary,
} from "./orgs.js?v=phantom-live-20260722-23";
import { renderAssetCloud } from "./assetcloud.js?v=phantom-live-20260722-23";
import { assetsAvailable } from "./orgs.js?v=phantom-live-20260722-23";
import { renderPhantomStore } from "./phantomstore.js?v=phantom-live-20260722-23";
import { renderPhantomPlay } from "./phantomplay.js?v=phantom-live-20260722-23";
// PhantomPlay V2 platform shell (Home/Solo/Friends/Workspace/Dev Hub) - opt-in
// while it hardens: set localStorage "pf.phantomplay.v2" = "1" (the V2 shell has
// a "Classic view" button to switch back). Classic stays the default experience.
import { renderPhantomPlay as renderPhantomPlayV2 } from "./phantomplay-v2.js?v=phantom-live-20260722-23";
const phantomPlayV2Opted = () => { try { return localStorage.getItem("pf.phantomplay.v2") === "1"; } catch { return false; } };
import { pageWorkerHtml, mountPageWorkers } from "./pageworker.js?v=phantom-live-20260722-23";
import {
  customizeNavigation,
  loadOrganizationCustomization,
} from "./customization.js?v=phantom-live-20260722-23";
import { mountMissionControl } from "./missioncontrol.js?v=phantom-live-20260722-23";
import { initCommandOS, applyCommandExecutionMode } from "./command-os.js?v=phantom-live-20260722-23";

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
  document.body.classList.toggle("phantom-keyboard-active", !!active);
  if (active) {
    commandTouchScroll = { x: window.scrollX, y: window.scrollY };
    bindKeyboardViewport();
    updateKeyboardOffset();
    [80, 220, 420].forEach((ms) => setTimeout(updateKeyboardOffset, ms));
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
  site:  `<rect x="2.8" y="3.2" width="10.4" height="9.6" rx="1.4"/><path d="M2.8 5.8h10.4M5.2 8.4h2.4M5.2 10.5h5.6"/>`,
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
  menu:  `<path d="M3 4.5h10M3 8h10M3 11.5h10"/>`,
};
const svg = (key, cls = "") => `<svg class="ic ${cls}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[key] || ""}</svg>`;

/* ============================ access gate ============================ */
function showGate() {
  gate.hidden = false;
  phantom.hidden = true;
  const card = gate.querySelector(".gate-card");
  if (isLiveAdminHost()) {
    renderInternalAdminAuthLoading(card);
    maybeUpgradeGateToDatabaseLogin(card, { internalAdmin: true, required: true });
    return;
  }

  if (isClientPublicHost()) {
    renderCustomerAuthLoading(card);
    maybeUpgradeGateToDatabaseLogin(card, { customerApp: true, required: true });
    return;
  }

  gate.querySelectorAll("[data-enter]").forEach((btn) => {
    btn.onclick = async () => {
      const kind = btn.dataset.enter;
      if (kind === "admin" && isStaticPublicHost()) { redirectToLiveAdmin(); return; }
      if (isLocalDevHost()) {
        try {
          const response = await fetch("/auth/demo-login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId: kind === "admin" ? "admin-jordan" : "client-sports-demo" }),
          });
          const payload = await response.json().catch(() => ({}));
          if (response.ok && payload?.token && payload?.session) {
            ctx.session = {
              role: kind === "admin" ? "admin" : "employee",
              name: kind === "admin" ? "Jordan" : "Team Member",
              label: payload.session.label || "",
              ws: "phantomforce",
              sessionId: payload.session.id,
              canManageAccess: !!payload.session.canManageAccess,
              token: payload.token,
            };
            session.set(ctx.session);
            enterPhantom();
            return;
          }
        } catch {
          // The existing local-only visual session remains available offline.
        }
      }
      ctx.session = kind === "admin"
        ? { role: "admin", name: "Jordan", label: "PhantomForce Owner", ws: "phantomforce", sessionId: "local-admin", canManageAccess: true }
        : { role: "employee", name: "Team Member", ws: "phantomforce" };
      session.set(ctx.session);
      enterPhantom();
    };
  });

  maybeUpgradeGateToDatabaseLogin(card);
}

/* When the backend runs real multi-user auth (database provider), the
   gate becomes an email/password sign-in — accounts, orgs, and roles
   live in Postgres, not in this shell. Checked live, never assumed. */
function renderCustomerAuthLoading(card) {
  card.innerHTML = `
    <p class="gate-kicker">PHANTOMFORCE · CUSTOMER WORKSPACE</p>
    <h1>Sign in to your workspace.</h1>
    <div class="owner-login">
      <p class="gate-note">Checking the account system...</p>
    </div>
    <p class="gate-note">Business owners open Business Manager here. Invited team members open Team Workspace under the same business workspace.</p>`;
}

function renderInternalAdminAuthLoading(card, message = "Connecting to the PhantomForce account system...") {
  card.innerHTML = `
    <p class="gate-kicker">PHANTOMFORCE · INTERNAL ACCESS</p>
    <h1>Internal admin sign-in.</h1>
    <div class="owner-login">
      <p class="gate-note">${esc(message)}</p>
    </div>
    <p class="gate-note">Admin opens full Force with platform access. Customer workspaces live on app.phantomforce.online.</p>`;
}

function renderCustomerAuthBlocked(card, message = "Customer account login is not enabled on this backend.") {
  card.innerHTML = `
    <p class="gate-kicker">PHANTOMFORCE · CUSTOMER WORKSPACE</p>
    <h1>Workspace sign-in is required.</h1>
    <div class="owner-login">
      <p class="gate-error">${message}</p>
    </div>
    <p class="gate-note">app.phantomforce.online only accepts real customer accounts. Jordan/admin operations stay on admin.phantomforce.online.</p>`;
}

function maybeUpgradeGateToDatabaseLogin(card, options = {}) {
  const { customerApp = false, internalAdmin = false, required = false, attempt = 0 } = options;
  const retryAuthUpgrade = (message) => {
    if (!required || gate.hidden) return false;
    if (internalAdmin) {
      renderInternalAdminAuthLoading(card, message);
    } else {
      renderCustomerAuthBlocked(card, message);
    }
    if (attempt >= 20) return true;
    window.setTimeout(() => maybeUpgradeGateToDatabaseLogin(card, { ...options, attempt: attempt + 1 }), 3000);
    return true;
  };
  fetchAuthConfig().then((auth) => {
    if (gate.hidden) return;
    if (!auth?.customerAuthEnabled && !auth?.databaseAuthEnabled) {
      if (required) {
        retryAuthUpgrade(attempt >= 20
          ? "Sign-in is temporarily unavailable. Try again in a moment."
          : "Account sign-in is starting. Retrying automatically...");
      }
      return;
    }
    const linkTokens = (() => {
      try {
        const params = new URLSearchParams(window.location.search);
        return {
          reset: params.get("reset_token") || "",
          invite: params.get("invite_token") || params.get("invitation_token") || "",
        };
      } catch { return { reset: "", invite: "" }; }
    })();
    const initialMode = linkTokens.invite ? "invite" : linkTokens.reset ? "reset-pass" : "signin";
    const state = {
      mode: initialMode,
      challenge: null,
      busy: false,
      message: linkTokens.invite
        ? "Invitation found. Set your name and password to join the workspace."
        : linkTokens.reset
          ? "Reset link found. Choose a new password."
          : "",
      resetToken: linkTokens.reset,
      inviteToken: linkTokens.invite,
    };
    const helper = customerApp
      ? "Owners/admins open Business Manager. Employees open Team Workspace. Permissions come from the business workspace."
      : internalAdmin
      ? "Internal PhantomForce operator access only."
      : "Your account, businesses, roles, recovery, and 2FA are managed on the PhantomForce server.";
    const note = customerApp
      ? "Use the email or username tied to your business workspace."
      : internalAdmin
      ? "Admin is not a public signup or customer account surface. Customer accounts, signup, and recovery live on app.phantomforce.online."
      : "Create a business, accept an invite, recover access, or sign in with 2FA.";
    const setError = (msg) => {
      const error = card.querySelector("[data-db-error]");
      if (!error) return;
      error.textContent = msg || "";
      error.hidden = !msg;
    };
    const doEnter = async (nextSession) => {
      if (customerApp && (nextSession?.canManageAccess || nextSession?.isSuperAdmin)) {
        await databaseLogout();
        session.clear();
        ctx.session = null;
        throw new Error("Platform admin accounts must use admin.phantomforce.online.");
      }
      ctx.session = nextSession;
      enterPhantom();
    };
    const render = () => {
      const tab = (id, label) => `<button type="button" class="auth-tab ${state.mode === id ? "is-active" : ""}" data-auth-mode="${id}">${label}</button>`;
      const msg = state.message ? `<p class="gate-note">${esc(state.message)}</p>` : "";
      if (internalAdmin && !["signin", "2fa"].includes(state.mode)) state.mode = "signin";
      const body = state.mode === "invite" && !internalAdmin ? `
        <form class="owner-login" data-auth-form="invite">
          <label><span>Your name</span><input name="name" autocomplete="name" placeholder="Your name" /></label>
          <label><span>Create a password</span><input type="password" name="password" autocomplete="new-password" minlength="8" placeholder="At least 8 characters" /></label>
          <button class="gate-opt gate-submit" type="submit"><span class="gate-opt-icon">+</span><b>Join workspace</b><i>This invitation can only be accepted once.</i></button>
        </form>` : state.mode === "signup" && !internalAdmin ? `
        <form class="owner-login" data-auth-form="signup">
          <label><span>Email</span><input type="email" name="email" autocomplete="email" placeholder="you@business.com" required /></label>
          <label><span>Username</span><input name="username" autocomplete="username" placeholder="yourname" minlength="3" maxlength="32" /></label>
          <label><span>Name</span><input name="name" autocomplete="name" placeholder="Your name" /></label>
          <label><span>Business / workspace</span><input name="organizationName" placeholder="Business name" /></label>
          <label><span>Password</span><input type="password" name="password" autocomplete="new-password" minlength="8" required /></label>
          <button class="gate-opt gate-submit" type="submit"><span class="gate-opt-icon">＋</span><b>Create account</b><i>Creates your user, starter workspace, and owner role.</i></button>
        </form>` : state.mode === "forgot-user" && !internalAdmin ? `
        <form class="owner-login" data-auth-form="forgot-user">
          <label><span>Account email</span><input type="email" name="email" autocomplete="email" required /></label>
          <button class="gate-opt gate-submit" type="submit"><span class="gate-opt-icon">?</span><b>Recover username</b><i>We’ll send the username tied to this email.</i></button>
        </form>` : state.mode === "forgot-pass" && !internalAdmin ? `
        <form class="owner-login" data-auth-form="forgot-pass">
          <label><span>Email or username</span><input name="identifier" autocomplete="username" required /></label>
          <button class="gate-opt gate-submit" type="submit"><span class="gate-opt-icon">↺</span><b>Send password reset</b><i>Creates a short-lived reset token.</i></button>
        </form>` : state.mode === "reset-pass" && !internalAdmin ? `
        <form class="owner-login" data-auth-form="reset-pass">
          <label><span>Reset token</span><input name="token" autocomplete="one-time-code" value="${esc(state.resetToken || "")}" required /></label>
          <label><span>New password</span><input type="password" name="password" autocomplete="new-password" minlength="8" required /></label>
          <button class="gate-opt gate-submit" type="submit"><span class="gate-opt-icon">✓</span><b>Reset password</b><i>Revokes old sessions and saves the new password.</i></button>
        </form>` : state.mode === "2fa" ? `
        <form class="owner-login" data-auth-form="2fa">
          <label><span>2FA code</span><input name="code" inputmode="numeric" autocomplete="one-time-code" placeholder="000000" required autofocus /></label>
          <button class="gate-opt gate-submit" type="submit"><span class="gate-opt-icon">⌁</span><b>Verify 2FA</b><i>Use your authenticator app code.</i></button>
        </form>` : `
        <form class="owner-login" data-auth-form="signin">
          <label><span>Email or username</span><input name="identifier" autocomplete="username" placeholder="you@business.com or username" autofocus required /></label>
          <label><span>Password</span><input type="password" name="password" autocomplete="current-password" placeholder="Password" required /></label>
          <button class="gate-opt gate-submit" type="submit"><span class="gate-opt-icon">⌘</span><b>${customerApp ? "Open Workspace" : "Open Business Manager"}</b><i>${helper}</i></button>
        </form>`;
      card.innerHTML = `
        <p class="gate-kicker">PHANTOMFORCE · ${internalAdmin ? "INTERNAL ACCESS" : "ACCOUNT ACCESS"}</p>
        <h1>${state.mode === "invite" ? "Join your workspace." : state.mode === "signup" ? "Create your Phantom account." : state.mode === "2fa" ? "Enter your 2FA code." : state.mode === "forgot-user" ? "Recover your username." : state.mode === "forgot-pass" ? "Reset your password." : state.mode === "reset-pass" ? "Choose a new password." : customerApp ? "Sign in to your workspace." : internalAdmin ? "Internal admin sign-in." : "Sign in to Phantom."}</h1>
        ${internalAdmin || state.mode === "invite" ? "" : `<div class="auth-tabs auth-tabs-primary">${tab("signin", "Sign in")}${tab("signup", "Create account")}</div>`}
        ${body}
        <p class="gate-error" data-db-error hidden></p>
        ${msg}
        ${state.mode === "signin" && !internalAdmin ? `<div class="auth-links"><button type="button" data-auth-mode="forgot-user">Forgot username?</button><button type="button" data-auth-mode="forgot-pass">Forgot password?</button></div>` : ""}
        ${!["signin", "signup"].includes(state.mode) ? `<div class="auth-links"><button type="button" data-auth-mode="signin">${state.mode === "2fa" ? "Use another account" : "Back to sign in"}</button></div>` : ""}
        <p class="gate-note">${note}</p>`;
      card.querySelectorAll("[data-auth-mode]").forEach((btn) => {
        btn.onclick = () => { state.mode = btn.dataset.authMode; state.message = ""; render(); };
      });
      const form = card.querySelector("[data-auth-form]");
      if (!form) return;
      form.onsubmit = async (event) => {
      event.preventDefault();
      if (state.busy) return;
      state.busy = true;
      setError("");
      const data = new FormData(form);
      form.classList.add("is-loading");
      form.setAttribute("aria-busy", "true");
      form.querySelectorAll("button, input").forEach((control) => { control.disabled = true; });
      try {
        if (state.mode === "signin") {
          const nextSession = await databaseLogin(String(data.get("identifier") || "").trim(), String(data.get("password") || ""));
          if (nextSession?.requires2fa) {
            state.challenge = nextSession.challengeToken;
            state.mode = "2fa";
            state.message = "Password accepted. Enter your authenticator code to finish signing in.";
            render();
            return;
          }
          await doEnter(nextSession);
        } else if (state.mode === "2fa") {
          await doEnter(await databaseVerify2fa(state.challenge, String(data.get("code") || "")));
        } else if (state.mode === "signup") {
          await databaseSignup({
            email: String(data.get("email") || "").trim(),
            username: String(data.get("username") || "").trim() || undefined,
            name: String(data.get("name") || "").trim() || undefined,
            organizationName: String(data.get("organizationName") || "").trim() || undefined,
            password: String(data.get("password") || ""),
          });
          state.mode = "signin"; state.message = "Account created. Sign in with your new credentials."; render();
        } else if (state.mode === "forgot-user") {
          const result = await databaseForgotUsername(String(data.get("email") || "").trim());
          state.message = result?.preview?.username ? `Recovery queued. Dev preview username: ${result.preview.username}` : "If that email exists, username recovery has been queued.";
          render();
        } else if (state.mode === "forgot-pass") {
          const result = await databaseForgotPassword(String(data.get("identifier") || "").trim());
          if (result?.preview?.resetToken) {
            state.mode = "reset-pass";
            state.resetToken = result.preview.resetToken;
            state.message = "Reset ready in this test environment. Choose a new password.";
          } else {
            state.message = "If that account exists, a reset link is on its way. You can close this page and use the link in the email.";
          }
          render();
        } else if (state.mode === "reset-pass") {
          await databaseResetPassword(String(data.get("token") || "").trim(), String(data.get("password") || ""));
          try {
            const url = new URL(location.href);
            url.searchParams.delete("reset_token");
            history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
          } catch {}
          state.mode = "signin"; state.resetToken = ""; state.message = "Password reset. Sign in with the new password."; render();
        } else if (state.mode === "invite") {
          await databaseAcceptInvitation(state.inviteToken, {
            name: String(data.get("name") || "").trim(),
            password: String(data.get("password") || ""),
          });
          try {
            const url = new URL(location.href);
            url.searchParams.delete("invite_token");
            url.searchParams.delete("invitation_token");
            history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
          } catch {}
          state.mode = "signin";
          state.inviteToken = "";
          state.message = "Invitation accepted. Sign in to open the workspace.";
          render();
        }
      } catch (err) {
        session.clear();
        ctx.session = null;
        setError(err?.message || "Account action failed.");
      } finally {
        state.busy = false;
        form.classList.remove("is-loading");
        form.removeAttribute("aria-busy");
        form.querySelectorAll("button, input").forEach((control) => { control.disabled = false; });
      }
    };
    };
    render();
  }).catch(() => {
    retryAuthUpgrade(attempt >= 20
      ? "Sign-in is temporarily unavailable. Try again in a moment."
      : "Account sign-in is starting. Retrying automatically...");
  });
}

/* ============================ sidebar nav ============================ */
const BASE_NAV = [
  { id: "dashboard",  label: "Dashboard",    icon: "grid",  view: "main" },
  { id: "phantomai",  label: "Phantom AI",   icon: "chat",  ws: "phantomai", dashboardWidget: true },
  { id: "crm",        label: "Clients",      icon: "users", ws: "leads" },
  { id: "media",      label: "Media Lab",    icon: "media", ws: "media" },
  { id: "assets",     label: "Asset Cloud",  icon: "media", ws: "assets", dbOnly: true, dashboardWidget: true },
  { id: "sites",      label: "Websites",     icon: "site",  ws: "sites" },
  { id: "money",      label: "Accounting",   icon: "dollar", ws: "money" },
  { id: "automation", label: "Automations",  icon: "auto",  ws: "automation" },
  { id: "approvals",  label: "Approvals",    icon: "check", ws: "approvals", badge: true, dashboardWidget: true },
  { id: "workers",    label: "Workforce",    icon: "users", ws: "workforce", dashboardWidget: true },
  { id: "intelligence", label: "Competitor Intel", icon: "chart", ws: "intelligence", dashboardWidget: true },
  { id: "analytics",  label: "Analytics",    icon: "chart", ws: "analytics", dashboardWidget: true },
  { id: "memory",     label: "Memory",       icon: "brain", ws: "memory", navZone: "bottom", quiet: true },
  { id: "settings",   label: "Settings",     icon: "cog",   ws: "settings", navZone: "bottom" },
  { id: "adminos",    label: "Admin",        icon: "dev",   ws: "adminos", ownerOnly: true, navZone: "bottom", internalOnly: true },
  { id: "developer",  label: "Developer",    icon: "dev",   ws: "developer", ownerOnly: true, navZone: "bottom" },
  { id: "phantomos",  label: "PhantomOS",    icon: "spark", href: "/app/os/index.html", ownerOnly: true, internalOnly: true, navZone: "bottom", quiet: true },
  { id: "vacation",   label: "Away Mode",    icon: "auto",  ws: "vacation", statusPill: true, navZone: "bottom" },
  { id: "phantomplay", label: "PhantomPlay", icon: "film",  ws: "phantomplay", navZone: "bottom", quiet: true, optionalModule: true },
  { id: "phantomstore", label: "PhantomStore", icon: "spark", ws: "phantomstore" },
];
let NAV = customizeNavigation(BASE_NAV, isAdmin() ? "owner" : "client");
let navEntitlements = { loaded: false, features: null, limits: null, entitlements: null };
const FEATURE_BY_NAV_ID = {
  media: "mediaLab",
  assets: "assetPacks",
  sites: "websites",
  automation: "advancedWorkflows",
  workers: "agentRuns",
  intelligence: "competitorIntelligence",
  vacation: "vacationMode",
  phantomplay: "phantomPlay",
};
/* MOBILE_NAV remains a complete mirror of the desktop registry so access,
   entitlements, and routing have one source of truth. The phone dock renders
   only the frequent destinations; More summons the complete vertical list. */
const MOBILE_LABEL_OVERRIDES = {
  dashboard: "Home",
  crm: "Clients",
  money: "Money",
  sites: "Sites",
  media: "Media",
  phantomplay: "Play",
  phantomstore: "Store",
  automation: "Auto",
  approvals: "Approvals",
  analytics: "Analytics",
  intelligence: "Competitor",
  adminos: "Admin",
  vacation: "Away",
  developer: "Developer",
};
const MOBILE_DOCK_IDS = ["dashboard", "crm", "media", "sites", "money"];
let MOBILE_NAV = NAV.map((n) => ({
  id: n.id,
  label: MOBILE_LABEL_OVERRIDES[n.id] || n.label,
  icon: n.icon,
  route: "nav",
  target: n.id,
  adminOnly: n.adminOnly,
  ownerOnly: n.ownerOnly,
  badge: n.badge,
  navZone: n.navZone,
  quiet: n.quiet,
  navDisabled: n.navDisabled,
}));

function navFeatureDisabled(item) {
  if (isLiveAdminHost() || (isLocalDevHost() && isAdmin())) return false;
  if ((!ctx.session?.database && !ctx.session?.localCustomer) || !navEntitlements.loaded) return false;
  const featureKey = FEATURE_BY_NAV_ID[item?.id];
  if (!featureKey) return false;
  if (navEntitlements.features?.[featureKey] === false) return true;
  const limitKey = {
    media: "mediaCreditsPerMonth",
    sites: "sitesPerOrg",
    workers: "agentRunsPerDay",
    intelligence: "competitorProfiles",
    phantomplay: "phantomPlayMinutesPerDay",
  }[item.id];
  return limitKey ? Number(navEntitlements.limits?.[limitKey] ?? 1) <= 0 : false;
}

function orderedNavItems() {
  return NAV
    .filter(canAccessSurface)
    /* dashboardWidget entries stay in NAV so navForWorkspace/routing still
       resolve them, but they render as Dashboard quick-widgets instead of
       their own sidebar tab — never as a sidebar or mobile-dock button. */
    .filter((item) => !item.dashboardWidget)
    .map((item) => ({ ...item, navDisabled: navFeatureDisabled(item) }))
    /* bottom-zone items always sit after the main list — a workspace
       customization order must never strand a tucked item mid-sidebar */
    .sort((left, right) =>
      (Number(left.navZone === "bottom") - Number(right.navZone === "bottom"))
      || (Number(left.navDisabled) - Number(right.navDisabled)));
}

function mobileItemsFromNav(items = orderedNavItems()) {
  return items.map((n) => ({
    id: n.id,
    label: MOBILE_LABEL_OVERRIDES[n.id] || n.label,
    icon: n.icon,
    route: "nav",
    target: n.id,
    adminOnly: n.adminOnly,
    ownerOnly: n.ownerOnly,
    badge: n.badge,
    navZone: n.navZone,
    quiet: n.quiet,
    navDisabled: n.navDisabled,
  }));
}

function refreshCustomizedNavigation() {
  NAV = customizeNavigation(BASE_NAV, isAdmin() ? "owner" : "client");
  MOBILE_NAV = mobileItemsFromNav();
}

async function refreshNavEntitlements({ rerender = true } = {}) {
  if (!(ctx.session?.database || ctx.session?.localCustomer)) {
    navEntitlements = { loaded: true, features: null, limits: null, entitlements: null };
  } else {
    try {
      const summary = await fetchEntitlementsSummary();
      navEntitlements = {
        loaded: true,
        features: summary?.entitlements?.features || null,
        limits: summary?.entitlements?.limits || null,
        entitlements: summary?.entitlements || null,
      };
    } catch {
      navEntitlements = { loaded: true, features: null, limits: null, entitlements: null };
    }
  }
  MOBILE_NAV = mobileItemsFromNav();
  if (rerender) {
    renderNav();
    renderAccessVersion();
    renderDashboardIntel();
  }
}
let activeNav = "dashboard";
let activePageId = null;
/* The right-hand deck is the launcher. The left-hand rail is a working set:
   destinations only become tabs after somebody opens them. */
const openNavTabs = new Set(["dashboard"]);
function markNavTabOpen(id) {
  if (NAV.some((item) => item.id === id && canAccessSurface(item))) openNavTabs.add(id);
}
/* which page last played its entrance animation — store-change rerenders
   rebuild the same page's DOM constantly, and replaying the transition on
   every save would make the UI feel broken instead of alive. Only a real
   navigation (key change) re-triggers it. */
let lastEnteredPageKey = null;
let mobileNavOpen = false;

const WORKSPACE_ALIASES = {
  brain: "workforce",
  memory: "memory",
  content: "content",
  analytics: "analytics",
};

/* Secondary workspaces still belong to a clear product section. Keeping that
   relationship here makes navigation follow AI routes, cards, deep links, and
   browser history instead of only following direct nav clicks. */
const NAV_PARENT_BY_WORKSPACE = {
  phantom: "dashboard",
  proposals: "crm",
  reviews: "crm",
  bookings: "crm",
  clientsetup: "settings",
  protect: "settings",
  adminos: "developer",
  account: "settings",
  content: "media",
  promptlibrary: "media",
  activity: "workers",
};

function workspaceId(id) {
  return WORKSPACE_ALIASES[id] || id;
}

function canAccessSurface(surface) {
  if (surface?.internalOnly && !(isLiveAdminHost() || (isLocalDevHost() && isAdmin()))) return false;
  if (surface?.ownerOnly && !isOwnerOperator()) return false;
  if (surface?.adminOnly && !isAdmin()) return false;
  /* Asset Cloud is a real multi-tenant surface — only meaningful when the
     backend runs database auth with an active org */
  if (surface?.dbOnly && !assetsAvailable()) return false;
  return true;
}

function navStatusPill(n) {
  if (!n.statusPill) return "";
  if (n.id === "vacation") {
    const cached = cachedVacationStatus();
    if (!cached) return `<em class="nav-pill is-unknown">—</em>`;
    return `<em class="nav-pill ${cached.enabled ? "is-on" : "is-off"}">${cached.enabled ? "ON" : "OFF"}</em>`;
  }
  return "";
}
function renderNav() {
  const nav = $("[data-nav]");
  const bottomNav = $("[data-nav-bottom]");
  const pending = visible(store.state.approvals).filter((a) => a.status === "pending").length;
  const items = orderedNavItems();
  const mainItems = items.filter((n) => openNavTabs.has(n.id));
  const bottomItems = items;
  MOBILE_NAV = mobileItemsFromNav(items);
  const itemHtml = (n, launcher = false) => `
    <button class="nav-item ${activeNav === n.id ? "is-active" : ""} ${launcher ? "nav-launcher" : "nav-open-tab"} ${n.quiet ? "nav-item-quiet" : ""} ${n.navDisabled ? "nav-item-disabled" : ""}" data-nav-id="${n.id}" ${activeNav === n.id && !launcher ? 'aria-current="page"' : ""} ${n.navDisabled ? 'aria-disabled="true" title="Disabled for this plan; the owner can enable it later."' : `title="${launcher ? `Open ${esc(n.label)}` : esc(n.label)}"`}>
      ${svg(n.icon)}
      <span>${n.label}</span>
      ${n.badge && pending ? `<em class="nav-badge">${pending}</em>` : ""}
      ${n.navDisabled ? `<em class="nav-pill is-locked">OFF</em>` : navStatusPill(n)}
    </button>`;
  nav.innerHTML = mainItems.map((item) => itemHtml(item)).join("");
  if (bottomNav) bottomNav.innerHTML = bottomItems.map((item) => itemHtml(item, true)).join("");
  if (osMenuOpen) renderOsMenu();
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
  const pending = visible(store.state.approvals).filter((a) => a.status === "pending").length;
  MOBILE_NAV = mobileItemsFromNav();
  const dockItems = MOBILE_DOCK_IDS
    .map((id) => MOBILE_NAV.find((item) => item.id === id))
    .filter(Boolean);
  const hiddenRouteActive = MOBILE_NAV.some(mobileNavActive) && !dockItems.some(mobileNavActive);
  nav.innerHTML = dockItems.map((item) => `
    <button class="mobile-bottom-item ${mobileNavActive(item) ? "is-active" : ""} ${item.navDisabled ? "is-disabled" : ""}" data-mobile-nav="${esc(item.id)}" type="button" ${mobileNavActive(item) ? 'aria-current="page"' : ""} ${item.navDisabled ? 'aria-disabled="true" title="Disabled for this plan; the owner can enable it later."' : ""}>
      ${svg(item.icon)}
      <span>${esc(item.label)}</span>
      ${item.badge && pending ? `<em class="mobile-bottom-badge">${pending}</em>` : ""}
    </button>`).join("") + `
    <button class="mobile-bottom-item mobile-bottom-more ${mobileNavOpen || hiddenRouteActive ? "is-active" : ""}" data-mobile-more type="button" aria-haspopup="true" aria-expanded="${mobileNavOpen}" aria-label="${mobileNavOpen ? "Close all sections" : "Open all sections"}">
      ${svg("menu")}
      <span>More</span>
      ${pending ? `<em class="mobile-bottom-badge">${pending}</em>` : ""}
    </button>`;
}

function setMobileNav(open) {
  mobileNavOpen = !!open;
  const shell = $("[data-phantom]");
  const sidebar = $(".sidebar");
  shell?.classList.toggle("nav-expanded", mobileNavOpen);
  sidebar?.classList.toggle("is-expanded", mobileNavOpen);
  if (sidebar && window.matchMedia("(max-width: 900px)").matches) {
    sidebar.setAttribute("aria-hidden", String(!mobileNavOpen));
  } else {
    sidebar?.removeAttribute("aria-hidden");
  }
  $$('[data-side-toggle], [data-mobile-more]').forEach((toggle) => {
    toggle.setAttribute("aria-expanded", String(mobileNavOpen));
    toggle.setAttribute("aria-label", mobileNavOpen ? "Close all sections" : "Open all sections");
  });
  if (mobileNavOpen) renderPlanMeta();
  renderMobileBottomNav();
}

function goNav(id) {
  const item = NAV.find((n) => n.id === id);
  if (!item) return;
  // Standalone-shell entries (e.g. the experimental PhantomOS interface) open
  // their own page rather than routing to an in-app workspace.
  if (item.href) { try { window.location.href = item.href; } catch {} return; }
  if (navFeatureDisabled(item)) {
    try { localStorage.setItem("pf.settings.tab.v1", "plan"); } catch {}
    activeNav = "settings";
    renderNav();
    renderWorkspacePage("settings", true);
    speak(`${item.label} is not included in this test tier. Plan & access is open so you can switch tiers.`, "", "alert");
    return;
  }
  markNavTabOpen(id);
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
window.PHANTOM_GO_NAV = goNav;

function missionMapPrompts() {
  return [
    "Create a task to qualify school prospects for PhantomPlay classroom games",
    "Create a task to build the PhantomForce CRM prospect map for creators, businesses, and schools",
    "Create a task to set up the next client onboarding workflow",
    "Create a task to prepare Managed Growth Ops follow-up for active leads",
  ];
}

function openOperationsMap() {
  if (activePageId) renderDashboardPage(true);
  if (openId === "operations-map") {
    closeOperationsMap();
    return;
  }
  const summary = flowSummary();
  const prompts = missionMapPrompts();
  clearOverlayOnly();
  openId = "operations-map";
  document.body.classList.add("overlay-open");
  overlayRoot.innerHTML = `
    <div class="overlay overlay-wide flowmap-overlay" role="dialog" aria-modal="true" aria-label="Operations map">
      <button class="overlay-backdrop" data-map-close aria-label="Close operations map"></button>
      <section class="overlay-panel">
        <header class="overlay-head">
          <div>
            <p class="overlay-kicker">Mission business map</p>
            <h2>Task creation keeper</h2>
            <p class="overlay-sub">${esc(summary.text)}</p>
          </div>
          <button class="overlay-x" data-map-close aria-label="Close operations map">✕</button>
        </header>
        <div class="overlay-body mission-map-body">
          <section class="mission-map-keeper" aria-label="Mission task creation keeper">
            <div class="mission-map-copy">
              <p class="mission-map-kicker">Tell Phantom to create a task</p>
              <h3>I'll map the road to success.</h3>
              <p>Describe the outcome in plain English. Phantom turns it into a mission path with leads, follow-up, approvals, owner work, and proof - without sending, publishing, charging, or exposing anything.</p>
            </div>
            <div class="mission-map-road" aria-label="Road to success">
              ${["Capture outcome", "Find client lane", "Set follow-up", "Draft offer/content", "Queue approvals", "Report progress"].map((step, i) => `
                <span><b>${i + 1}</b>${esc(step)}</span>
              `).join("")}
            </div>
            <div class="mission-map-prompts" aria-label="Task prompt starters">
              ${prompts.map((prompt) => `
                <button class="mission-map-prompt" type="button" data-map-prompt="${esc(prompt)}">
                  <span>${esc(prompt)}</span>
                  <small>Load into chat</small>
                </button>
              `).join("")}
            </div>
          </section>
          <section class="flowmap flowmap-modal is-map-open" aria-label="Live operations map">
            <div class="flow-stage" data-flowmap tabindex="-1"></div>
          </section>
        </div>
      </section>
    </div>`;
  updateOperationsMapControls();
  renderFlowMap();
  const stage = $("[data-flowmap]", overlayRoot);
  if (stage) setTimeout(() => {
    try { stage.focus({ preventScroll: true }); }
    catch { stage.focus(); }
  }, reduceMotion ? 0 : 160);
  setGhostMood("listening", { emotion: "bright", ms: 1200 });
  stageReact("nav", 620);
}
function closeOperationsMap() {
  if (openId !== "operations-map") return;
  clearOverlayOnly();
  updateOperationsMapControls();
  const opener = $("[data-map-open]");
  if (opener) {
    try { opener.focus({ preventScroll: true }); }
    catch { opener.focus(); }
  }
}
function updateOperationsMapControls() {
  const isOpen = openId === "operations-map";
  $$("[data-map-open]").forEach((button) => {
    button.setAttribute("aria-expanded", String(isOpen));
    button.setAttribute("aria-label", isOpen ? "Close operations map" : "Open operations map");
  });
  $$("[data-map-open-label]").forEach((label) => { label.textContent = isOpen ? "Close map" : "Open map"; });
}

function renderFlowCompactSummary() {
  const summary = flowSummary();
  $$("[data-map-open]").forEach((button) => {
    button.dataset.urgent = String(summary.urgent);
    button.title = `${summary.text}. Tap to open the live operations map.`;
  });
  updateOperationsMapControls();
}

/* ============================ topbar ============================ */
let topbarWorkforce = null;
let topbarWorkforceLoading = false;
let topbarWorkforceChecked = false;

function topbarBaselineWorkers() {
  const summary = topbarWorkforce?.summary;
  if (!summary) return null;
  let count = Number(summary.baseline_workers_online ?? summary.active_workers ?? 0);
  const workers = Array.isArray(topbarWorkforce?.workers) ? topbarWorkforce.workers : [];
  const gatekeeperActive = workers.some((worker) => worker.id === "gatekeeper" && worker.state === "active");
  if (/(^|\.)admin\.phantomforce\.online$/i.test(location.hostname) && !gatekeeperActive) count += 1;
  return { count, jobs: Number(summary.tasks_in_window || 0) };
}

function topbarFallbackWorkers() {
  return 3 + (/(^|\.)admin\.phantomforce\.online$/i.test(location.hostname) ? 1 : 0);
}

function databaseOrgMemberships() {
  if (!ctx.session?.database) return [];
  return (ctx.session.memberships || [])
    .filter((membership) => membership?.orgId)
    .map((membership) => ({
      orgId: String(membership.orgId),
      orgName: String(membership.orgName || membership.orgId),
      role: String(membership.role || "member"),
    }));
}

function databaseOrgLabel(orgId = ctx.session?.orgId) {
  const match = databaseOrgMemberships().find((membership) => membership.orgId === orgId);
  return match?.orgName || orgId || "Business";
}

function orgSwitchOptions() {
  if (ctx.session?.database) {
    const memberships = databaseOrgMemberships();
    if (!memberships.length && ctx.session.orgId) {
      return `<option value="${esc(ctx.session.orgId)}" selected>${esc(ctx.session.orgId)}</option>`;
    }
    return memberships.map((membership) => `
      <option value="${esc(membership.orgId)}" ${membership.orgId === ctx.session.orgId ? "selected" : ""}>
        ${esc(membership.orgName)}
      </option>`).join("");
  }
  return store.state.workspaces.map((w) => `<option value="${w.id}" ${w.id === currentWs() ? "selected" : ""}>${esc(w.name)}</option>`).join("");
}

function renderStatusPills() {
  const attention = store.state.security.some((s) => s.posture && s.posture !== "clean");
  const workforce = topbarBaselineWorkers();
  const pills = [
    { label: "System", value: attention ? "Attention needed" : "Operational", tone: attention ? "warn" : "ok", dot: true },
    { label: "Workforce", value: workforce ? `${workforce.count} baseline · ${workforce.jobs} jobs` : (topbarWorkforceChecked ? `${topbarFallbackWorkers()} core ready` : "Checking…"), tone: "ok", dot: true, open: "workforce" },
  ];
  $("[data-status-pills]").innerHTML = pills.map((p) => `
    <div class="pill pill-${p.tone} ${p.open ? "pill-link" : ""}" ${p.open ? `data-pill-open="${p.open}" role="button" tabindex="0"` : ""}>
      <span class="pill-k">${p.label}</span>
      <span class="pill-v">${p.dot ? `<i class="dot"></i>` : ""}${p.lock ? `<i class="lock" aria-hidden="true">🔒</i>` : ""}<span class="pill-v-text" title="${esc(p.value)}">${esc(p.value)}</span></span>
    </div>`).join("")
    + (isAdmin() ? `
    <label class="ws-switch" title="${ctx.session?.database ? "Switch active business organization" : "Switch isolated business workspace"}">
      <select data-org-select aria-label="${ctx.session?.database ? "Switch active business organization" : "Switch workspace"}">${orgSwitchOptions()}</select>
    </label>` : "");
  const sel = $("[data-org-select]");
  if (sel) sel.onchange = () => switchWorkspace(sel.value);
  $$("[data-pill-open]").forEach((el) => {
    const go = () => routeWorkspace(el.dataset.pillOpen);
    el.onclick = go;
    el.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } };
  });
  if (!topbarWorkforceChecked && !topbarWorkforceLoading) {
    topbarWorkforceLoading = true;
    fetchAgentWorkforceStatus(24).then((result) => {
      topbarWorkforceLoading = false;
      topbarWorkforceChecked = true;
      if (result.ok) topbarWorkforce = result.workforce;
      renderStatusPills();
    });
  }
}

async function switchWorkspace(id) {
  if (!isAdmin()) {
    renderStatusPills();
    return false;
  }
  if (ctx.session?.database) {
    const memberships = databaseOrgMemberships();
    const target = memberships.find((membership) => membership.orgId === id);
    const before = ctx.session.orgId || null;
    if (id === before) {
      renderStatusPills();
      return true;
    }
    if (!target) {
      pushActivity("Security", `blocked business switch to ${id || "unknown"} because this account is not a member.`);
      store.save();
      renderStatusPills();
      speak("That business is not available for this account.", "", "alert");
      return false;
    }
    setDatabaseOrganizationSwitching(true);
    try {
      const result = await switchOrg(id);
      accountMenuOpen = false;
      notifOpen = false;
      if (!result.ok) {
        pushActivity("Security", "business switch was refused by the server - this account is not a member.");
        store.save();
        renderStatusPills();
        renderAccountMenu();
        speak("The server refused that business switch.", "", "alert");
        return false;
      }
      await refreshNavEntitlements({ rerender: false });
      // Chat bubbles are an in-memory view, so reset them at the same boundary
      // as the organization-scoped saved/temporary context. A valid org switch
      // must never leave the previous business conversation visible onscreen.
      chatHistory.length = 0;
      pushActivity("Account", `switched active business to ${databaseOrgLabel(id)}.`);
      store.save();
      clearOverlayOnly();
      stageReact("nav", 640);
      setGhostMood("listening", { emotion: "bright", ms: 1200 });
      speak(`${databaseOrgLabel(id)} is active. Organization data is isolated.`, "", "bright");
      routeWorkspace("dashboard");
      renderConsole();
      console.info("[PhantomForce] database organization switched", { from: before, to: ctx.session.orgId, memberships: memberships.map((m) => m.orgId) });
      return true;
    } finally {
      setDatabaseOrganizationSwitching(false);
    }
  }
  const before = currentWs();
  if (!setWorkspace(id)) { renderStatusPills(); return false; }
  await loadOrganizationCustomization({ onApplied: refreshCustomizedNavigation });
  await refreshNavEntitlements({ rerender: false });
  chatHistory.length = 0;
  accountMenuOpen = false;
  notifOpen = false;
  clearOverlayOnly();
  stageReact("nav", 640);
  setGhostMood("listening", { emotion: "bright", ms: 1200 });
  speak(wsName(currentWs()) + " is active. Workspace data is isolated.", "", "bright");
  if (activePageId) renderWorkspacePage(activePageId, false);
  else renderConsole();
  console.info("[PhantomForce] workspace switched", { from: before, to: currentWs(), tenant: currentTenantId() });
  return true;
}

function setDatabaseOrganizationSwitching(active) {
  document.documentElement.dataset.orgSwitching = active ? "true" : "false";
  const select = $("[data-org-select]");
  const input = $("[data-command-input]");
  const form = $("[data-command-form]");
  if (select) select.disabled = active;
  if (input) input.disabled = active;
  if (form) form.setAttribute("aria-busy", active ? "true" : "false");
}
let clockTimer = 0;
let accountMenuOpen = false;
let osMenuOpen = false;
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
  const osInitial = $("[data-os-user-initial]");
  const osName = $("[data-os-user-name]");
  if (osInitial) osInitial.textContent = initials || "PF";
  if (osName) osName.textContent = name;
  const mobileAvatar = $("[data-mobile-user-avatar]");
  if (mobileAvatar) mobileAvatar.textContent = initials || "PF";
  $("[data-user-name]").textContent = name;
  $("[data-user-role]").textContent = isAdmin() ? "Business Manager" : "Team Member";
  const btn = $("[data-user-btn]");
  if (btn) {
    btn.classList.toggle("is-open", accountMenuOpen);
    btn.setAttribute("aria-expanded", accountMenuOpen ? "true" : "false");
    btn.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      accountMenuOpen = !accountMenuOpen;
      renderAccountMenu();
    };
  }
  renderAccountMenu();
  renderOsMenu();
}

function renderOsMenu() {
  const menu = $("[data-os-menu]");
  const btn = $("[data-os-menu-btn]");
  if (!menu) return;
  if (btn) {
    btn.classList.toggle("is-open", osMenuOpen);
    btn.setAttribute("aria-expanded", osMenuOpen ? "true" : "false");
  }
  menu.hidden = !osMenuOpen;
  if (!osMenuOpen) return;
  const primaryIds = ["dashboard", "clients", "media", "sites", "phantomplay", "phantomstore", "analytics", "intelligence", "money", "approvals"];
  const items = orderedNavItems()
    .filter((item) => primaryIds.includes(item.id))
    .sort((a, b) => primaryIds.indexOf(a.id) - primaryIds.indexOf(b.id));
  menu.innerHTML = `
    <div class="os-menu-head">
      <span>${esc(accountInitials(accountOwnerName()))}</span>
      <b>${esc(accountOwnerName())}</b>
      <i>${esc(accountRoleLabel())}</i>
    </div>
    <div class="os-menu-list" role="menu" aria-label="Open PhantomForce section">
      ${items.map((item) => `
        <button class="${activeNav === item.id ? "is-active" : ""}" data-os-menu-nav="${esc(item.id)}" type="button" role="menuitem">
          ${svg(item.icon)}
          <span>${esc(item.label)}</span>
        </button>`).join("")}
    </div>
    <div class="os-menu-actions">
      <button data-user-menu-action="account" type="button">Account and access</button>
      <button class="is-danger" data-user-menu-action="signout" type="button">Sign out</button>
    </div>`;
}

async function signOut() {
  const databaseSession = !!ctx.session?.database;
  accountMenuOpen = false;
  osMenuOpen = false;
  setMobileNav(false);
  closeOverlay(true);
  try {
    if (databaseSession) await databaseLogout();
  } finally {
    session.clear();
    ctx.session = null;
    try {
      const url = new URL(location.href);
      url.searchParams.delete("session");
      history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    } catch {}
    showGate();
  }
}

/* ============================ account + plan ============================ */
const ACCOUNT_PLAN = {
  name: "Elite Plan",
  price: "Best plan",
  renewalOffsetDays: 30,
  paymentState: "Owner billing ready",
  workspaceLimit: "Owner workspace",
};
const ACCOUNT_TIERS = [
  {
    id: "free",
    name: "Free Preview",
    price: "$0",
    badge: "Preview",
    copy: "Small limits for trying the workspace before picking a paid operating tier.",
    features: ["Command center preview", "Small media allowance", "One business workspace"],
  },
  {
    id: "professional",
    name: "Pro",
    price: "$2,500/mo",
    badge: "Growth",
    copy: "Operator-grade system for growth: creator workflow, Media Lab, accounting visibility, and owner controls.",
    features: ["Phantom AI operator", "Content Hub + Media Lab", "Accounting-aware ops"],
  },
  {
    id: "developer",
    name: "Developer",
    price: "Builder",
    badge: "Dev",
    copy: "Developer-focused access for building products, games, plugins, and test releases.",
    features: ["Developer workflows", "PhantomPlay submissions", "Advanced model lane"],
  },
  {
    id: "elite",
    name: "Elite Plan",
    price: "Custom",
    badge: "Current",
    copy: "The full business operating suite: deeper loop routing, multi-workspace control, automations, and launch support.",
    features: ["Advanced loop routing", "Multi-workspace command", "Business automation planning", "Launch support"],
  },
  {
    id: "developer_elite",
    name: "Developer + Elite",
    price: "Full stack",
    badge: "Dev+Elite",
    copy: "Elite business operations plus expanded developer/game submission limits.",
    features: ["Elite operations", "Developer envelope", "Advanced workflows"],
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
function accountRoleLabel() {
  return isAdmin() ? "Business Manager" : "Team Member";
}
function accountIdentityLine() {
  return ctx.session?.email || ctx.session?.label || `${accountRoleLabel()} - ${wsName(currentWs())}`;
}
function currentPlanKey() {
  return navEntitlements.entitlements?.planKey || (isAdmin() ? "internal" : "free");
}
function currentPlanName() {
  return accessVersionCopy().label || ACCOUNT_PLAN.name;
}
function canUsePhantomLoop() {
  return true;
}
function phantomLoopUnavailableMessage() {
  return "Phantom Loop needs a target model picked first — open chat settings to choose one.";
}
const OPERATOR_SETTINGS_KEY = "pf.operator.settings.v1";
function loadConsoleSettingsSnapshot() {
  try {
    return JSON.parse(localStorage.getItem(OPERATOR_SETTINGS_KEY) || "{}") || {};
  } catch {
    return {};
  }
}
function renderConsoleCoreStatus(activeCompanionMode = companionMode()) {
  const settings = loadConsoleSettingsSnapshot();
  const loop = loadPhantomLoop();
  const providerNames = { claude: "Claude", private: "Private Operator", openrouter: "OpenRouter", local: "Local Ollama" };
  const selected = Array.isArray(settings.selectedProviders) && settings.selectedProviders.length ? settings.selectedProviders : ["claude", "private", "openrouter", "local"];
  const brainMode = settings.brainMode === "local"
    ? "Ghost/local"
    : settings.providerMode === "single"
      ? providerNames[settings.provider] || "Single lane"
      : settings.providerMode === "multiple"
        ? `${selected.length} lanes`
        : "Phantom Hybrid";
  const hands = activeCompanionMode === "loop"
    ? "Loop armed"
    : settings.externalActionMode === "owner_rules"
      ? "Autopilot rules"
      : "Termina gated";
  const guard = settings.externalActionMode === "blocked"
    ? "Actions blocked"
    : settings.externalActionMode === "owner_rules"
      ? "Owner rules"
      : "Approval gate";
  return `
    <span><b>Brain</b><i>${esc(brainMode)}</i></span>
    <span><b>Hands</b><i>${esc(hands)}</i></span>
    <span><b>Guard</b><i>${esc(guard)}</i></span>`;
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
function renderAccountMenu() {
  const menu = $("[data-user-menu]");
  const btn = $("[data-user-btn]");
  if (!menu) return;
  const owner = accountOwnerName();
  const status = accountStatusMeta();
  const renewal = accountRenewalLabel();
  const planName = currentPlanName();
  if (btn) {
    btn.classList.toggle("is-open", accountMenuOpen);
    btn.setAttribute("aria-expanded", accountMenuOpen ? "true" : "false");
  }
  menu.hidden = !accountMenuOpen;
  if (!accountMenuOpen) return;
  menu.innerHTML = `
    <div class="user-menu-head">
      <span class="user-menu-avatar">${esc(accountInitials(owner))}</span>
      <span>
        <b>${esc(owner)}</b>
        <i>${isAdmin() ? "Business Manager" : "Team Member"}</i>
      </span>
    </div>
    <button class="user-menu-plan" data-user-menu-action="account" type="button">
      <span>
        <i>Current plan</i>
        <b>${esc(planName)}</b>
        <em>Renewal: ${esc(renewal)}</em>
      </span>
      <strong>Manage →</strong>
    </button>
    ${ctx.session?.database && (ctx.session.memberships || []).length ? `
    <div class="user-menu-orgs">
      <i>Business</i>
      ${(ctx.session.memberships || []).map((m) => `
        <button class="user-menu-org ${m.orgId === ctx.session.orgId ? "is-active" : ""}" data-user-menu-org="${esc(m.orgId)}" type="button">
          <b>${esc(m.orgName)}</b><span>${esc(m.role)}</span>
        </button>`).join("")}
    </div>` : ""}
    <div class="user-menu-status is-${status.tone}">
      <span aria-hidden="true"></span>
      <b>${esc(status.label)}</b>
    </div>
    <button class="user-menu-link" data-user-menu-action="signout" type="button">Sign out</button>`;
  menu.querySelectorAll("[data-user-menu-org]").forEach((btn) => {
    btn.onclick = async () => {
      const orgId = btn.dataset.userMenuOrg;
      if (orgId === ctx.session?.orgId) { accountMenuOpen = false; renderAccountMenu(); return; }
      await switchWorkspace(orgId);
    };
  });
}
/* Database-auth accounts get the REAL plan from the server: assigned plan,
   status, limits, and live usage from the entitlement engine — replacing
   the static local copy. Fetched fresh on every open, never cached-fake. */
async function hydrateLivePlan(body) {
  const mount = body.querySelector("[data-live-plan]");
  if (!mount) return;
  const [me, summary] = await Promise.all([fetchAuthMe(), fetchEntitlementsSummary()]);
  if (!document.body.contains(mount)) return;
  if (!me?.entitlements || !summary) {
    mount.innerHTML = `<p class="set-note">Live plan details are unavailable right now — the server did not answer.</p>`;
    return;
  }
  const ent = summary.entitlements;
  const chip = body.querySelector(".account-plan-chip");
  if (chip) chip.innerHTML = `<span>${esc(ent.planName)}</span><b>${esc(ent.effectiveStatus)}</b>`;
  mount.innerHTML = `
    <article class="account-card">
      <p class="account-card-k">Live plan (server)</p>
      <h4>${esc(ent.planName)} · ${esc(ent.effectiveStatus)}</h4>
      <p>${ent.canWrite ? "Writes enabled for this business." : "This business is view-only until the plan is restored."}${ent.note ? ` Note: ${esc(ent.note)}` : ""}</p>
      <div class="account-facts">
        ${summary.metrics.map((m) => `<span><b>${esc(m.metric.replace(/_/g, " "))}</b>${m.used}/${m.limit}${m.resetAt ? ` · resets ${new Date(m.resetAt).toLocaleDateString()}` : ""}</span>`).join("")}
        <span><b>seats</b>${summary.seats.used}/${summary.seats.limit}</span>
      </div>
      <p class="set-note">Plans are assigned manually by the PhantomForce operator until billing is connected — no self-serve checkout exists yet.</p>
    </article>`;
}

function renderAccountPlan(body) {
  const owner = accountOwnerName();
  const status = accountStatusMeta();
  const renewal = accountRenewalLabel();
  const planName = currentPlanName();
  const planKey = currentPlanKey();
  body.innerHTML = `
    <div class="account-plan">
      ${accountNotice ? `<div class="account-notice">${esc(accountNotice)}</div>` : ""}
      ${ctx.session?.database || ctx.session?.localCustomer ? `<div data-live-plan><p class="set-note">Loading live plan from the server…</p></div>` : ""}
      <section class="account-hero">
        <div class="account-avatar" aria-label="Profile picture">${esc(accountInitials(owner))}</div>
        <div class="account-hero-main">
          <p class="account-kicker">Account profile</p>
          <h3>${esc(owner)}</h3>
          <p class="account-identity">${esc(accountIdentityLine())}</p>
          <p class="account-status account-status-${status.tone}"><span aria-hidden="true"></span>${esc(status.label)}</p>
        </div>
        <div class="account-plan-chip">
          <span>${esc(planName)}</span>
          <b>${esc(ACCOUNT_PLAN.price)}</b>
        </div>
      </section>
      <section class="account-grid">
        <article class="account-card account-current">
          <p class="account-card-k">Current plan</p>
          <h4>${esc(planName)}</h4>
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
      <section class="account-section" data-account-security>
        <div class="set-sec-head">
          <div>
            <p class="account-card-k">Account security</p>
            <h3>Two-factor authentication</h3>
          </div>
        </div>
        ${ctx.session?.database ? `
          <div class="account-billing-list">
            <span><b>Username</b><i>${esc(ctx.session.username || ctx.session.email || "Not loaded")}</i></span>
            <span><b>2FA</b><i data-2fa-status>Checking server status…</i></span>
          </div>
          <div class="account-actions" style="margin-top:12px;flex-wrap:wrap">
            <button class="btn btn-primary" data-security-action="setup-2fa">Set up 2FA</button>
            <button class="btn" data-security-action="backup-2fa">Regenerate recovery codes</button>
            <button class="btn" data-security-action="disable-2fa">Disable 2FA</button>
          </div>
          <div class="account-notice" data-security-output hidden></div>
          <form class="owner-login" data-2fa-confirm-form hidden style="margin-top:12px">
            <label><span>Authenticator code</span><input name="code" inputmode="numeric" autocomplete="one-time-code" placeholder="000000" required /></label>
            <button class="btn btn-primary" type="submit">Confirm 2FA</button>
          </form>
        ` : `<p class="set-note">2FA is available when signed into a database-backed account.</p>`}
      </section>
      <section class="account-section">
        <div class="set-sec-head">
          <div>
            <p class="account-card-k">Billing history</p>
            <h3>Invoices and receipts</h3>
          </div>
        </div>
        <div class="account-billing-list">
          <span><b>Status</b><i>No invoices loaded in this local shell.</i></span>
          <span><b>Payment connector</b><i>Not wired here. Manual billing only.</i></span>
          <span><b>Next safe action</b><i>Use Request invoice to prepare an owner-review note.</i></span>
        </div>
      </section>
      <section class="account-section">
        <div class="set-sec-head">
          <div>
            <p class="account-card-k">Plan tiers</p>
            <h3>Choose the operating level</h3>
          </div>
        </div>
        <div class="account-tiers">
          ${ACCOUNT_TIERS.map((tier) => {
            const current = tier.id === planKey;
            return `
            <article class="account-tier ${current ? "is-current" : ""}">
              <span class="account-tier-badge">${esc(tier.badge)}</span>
              <h4>${esc(tier.name)}</h4>
              <b>${esc(tier.price)}</b>
              <p>${esc(tier.copy)}</p>
              <ul>${tier.features.map((feature) => `<li>${esc(feature)}</li>`).join("")}</ul>
              <button class="btn ${current ? "btn-good" : "btn-primary"}" data-account-action="${current ? "current" : `plan-${tier.id}`}">
                ${current ? "Current plan" : `Request ${esc(tier.name)}`}
              </button>
            </article>`; }).join("")}
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
  wireAccountSecurity(body);
  if (ctx.session?.database || ctx.session?.localCustomer) hydrateLivePlan(body);
}

async function wireAccountSecurity(body) {
  if (!ctx.session?.database) return;
  const output = body.querySelector("[data-security-output]");
  const status = body.querySelector("[data-2fa-status]");
  const form = body.querySelector("[data-2fa-confirm-form]");
  let pendingSecret = "";
  const show = (msg, isError = false) => {
    if (!output) return;
    output.hidden = false;
    output.textContent = msg;
    output.style.borderColor = isError ? "rgba(255,80,80,.36)" : "";
    output.style.color = isError ? "#ffb7b7" : "";
  };
  const showRecoveryCodes = (codes = []) => {
    if (!output) return;
    output.hidden = false;
    output.style.borderColor = "";
    output.style.color = "";
    output.innerHTML = `<b>Save these recovery codes now. They are shown once.</b><div class="auth-recovery-codes">${codes.map((code) => `<code>${esc(code)}</code>`).join("")}</div><small>Each code works once if you lose your authenticator.</small>`;
  };
  fetchAuthMe().then((me) => {
    if (status) status.textContent = me?.user?.twoFactorEnabled ? "Enabled" : "Not enabled";
  }).catch(() => { if (status) status.textContent = "Unavailable"; });
  body.querySelector("[data-security-action='setup-2fa']")?.addEventListener("click", async () => {
    try {
      const setup = await databaseStart2faSetup();
      pendingSecret = setup.secret;
      show(`Add this secret to Google Authenticator / iOS Passwords, then enter the code below: ${setup.secret}`);
      if (form) form.hidden = false;
    } catch (err) {
      show(err?.message || "2FA setup failed.", true);
    }
  });
  body.querySelector("[data-security-action='disable-2fa']")?.addEventListener("click", async () => {
    const code = prompt("Enter your current authenticator or recovery code to disable 2FA:");
    if (!code) return;
    try {
      await databaseDisable2fa(code);
      show("2FA disabled.");
      if (status) status.textContent = "Not enabled";
    } catch (err) {
      show(err?.message || "Could not disable 2FA.", true);
    }
  });
  body.querySelector("[data-security-action='backup-2fa']")?.addEventListener("click", async () => {
    const code = prompt("Enter your current authenticator code to regenerate recovery codes:");
    if (!code) return;
    try {
      const result = await databaseRegenerate2faBackupCodes(code);
      showRecoveryCodes(result.backupCodes || []);
    } catch (err) {
      show(err?.message || "Could not regenerate recovery codes.", true);
    }
  });
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const code = new FormData(form).get("code");
    try {
      const result = await databaseConfirm2fa(String(code || ""));
      showRecoveryCodes(result.backupCodes || []);
      if (status) status.textContent = "Enabled";
      form.hidden = true;
      pendingSecret = "";
    } catch (err) {
      show(err?.message || "Invalid 2FA code.", true);
    }
  });
}

/* ============================ hero + command deck ============================ */
const MODES = {
  ask:     { label: "Ask",     icon: "chat",  placeholder: "Ask PhantomForce anything…", prefix: "" },
  write:   { label: "Write",   icon: "doc",   placeholder: "Write a proposal, a caption, a follow-up…", prefix: "Draft " },
  image:   { label: "Image",   icon: "spark", placeholder: "Describe an image to create…", prefix: "Create an image for " },
  video:   { label: "Video",   icon: "film",  placeholder: "Describe a video to produce…", prefix: "Create a video for " },
  website: { label: "Website", icon: "grid",  placeholder: "Describe a page or site to build…", prefix: "Build a website for " },
  admin:   { label: "Ops",     icon: "cog",   placeholder: "", open: "adminos" },
};
let activeMode = "ask";
const POSE_VERSION = "phantom-live-20260722-23";
let phantom3d = null;
let phantomBootSettled = false;
let stageReactionTimer = 0;
let stageReactionKind = "";
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

/* mode named by THIS text only — null when the message carries no lane
   keyword, so a sticky chip can never rewrite an unrelated question */
function modeNamedInText(text = "") {
  const s = text.toLowerCase();
  if (/\b(video|reel|clip|shoot|phantomcut|render)\b/.test(s)) return "video";
  if (/\b(image|photo|picture|graphic|creative|thumbnail|visual)\b/.test(s)) return "image";
  if (/\b(site|website|page|landing|store|checkout|web)\b/.test(s)) return "website";
  if (/\b(write|draft|proposal|quote|caption|email|follow.?up|copy)\b/.test(s)) return "write";
  if (/\b(admin|system|approval|protect|security|scan|worker|settings)\b/.test(s)) return "admin";
  return null;
}
function inferModeFromText(text = "") {
  return modeNamedInText(text) || activeMode;
}
function looksLikeQuestion(text = "") {
  return /\?\s*$/.test(text.trim()) || /^(what|why|how|when|where|who|which|is|are|was|were|can|could|should|would|do|does|did|will)\b/i.test(text.trim());
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
  if (stage.dataset.pose !== cssPose) stage.dataset.pose = cssPose;
  if (stage.dataset.poseAsset !== poseId) stage.dataset.poseAsset = poseId;
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
  const sameActiveReaction = (
    stageReactionKind === kind &&
    stage.dataset.reaction === kind &&
    stage.classList.contains("is-reacting")
  );
  if (!sameActiveReaction) {
    stageReactionKind = kind;
    if (stage.dataset.reaction !== kind) stage.dataset.reaction = kind;
    stage.classList.remove("is-reacting");
    void stage.offsetWidth;
    stage.classList.add("is-reacting");
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
  clearTimeout(stageReactionTimer);
  stageReactionTimer = setTimeout(() => {
    stage.classList.remove("is-reacting");
    if (stage.dataset.reaction === kind) {
      delete stage.dataset.reaction;
      if (stageReactionKind === kind) stageReactionKind = "";
    }
  }, ms);
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
  const alreadyActive = activeMode === id;
  activeMode = id;
  if (!alreadyActive) {
    renderChips();
    renderModePose(id);
    const reaction = reactionForMode(id);
    setGhostMood(reaction.mood, { emotion: reaction.emotion, ms: id === "ask" ? 1800 : 1400 });
    stageReact(id, 760);
  }
  if (m.open) { routeWorkspace(m.open); return; }
  const input = $("[data-command-input]");
  input.placeholder = m.placeholder;
  focusWithoutScroll(input);
}

function renderHero() {
  const name = (ctx.session?.name || "there").split(/\s+/)[0];
  $("[data-hero-name]").textContent = name === "there" ? "handling?" : `handling, ${name}?`;
}

function renderDashboardBrief() {
  const title = $("[data-dashboard-brief-title]");
  const status = $("[data-dashboard-brief-status]");
  const metrics = $("[data-dashboard-brief-metrics]");
  if (!title || !status || !metrics) return;
  const name = (ctx.session?.name || "there").split(/\s+/)[0];
  const plan = todaysPlan();
  const leads = visible(store.state.leads || []);
  const approvals = visible(store.state.approvals || []).filter((item) => item.status === "pending");
  const accounting = moneyView();
  const attention = plan.length + approvals.length;
  title.textContent = `${greeting()}, ${name}`;
  status.textContent = attention
    ? `${attention} real item${attention === 1 ? "" : "s"} need attention in this organization.`
    : "No urgent decisions are waiting. Phantom is ready for the next outcome.";
  const snapshot = [
    { label: "Clients", value: String(leads.length), detail: "organization records", open: "leads" },
    { label: "Today", value: String(plan.length), detail: plan.length ? "scheduled items" : "nothing due", open: plan[0]?.open || "settings" },
    { label: "Approvals", value: String(approvals.length), detail: approvals.length ? "waiting on you" : "none waiting", open: "approvals" },
    {
      label: "Actual cash",
      value: accounting.transactions.length ? signedMoney(accounting.netCash) : "None yet",
      detail: accounting.transactions.length ? `${accounting.transactions.length} confirmed transactions` : "add or connect",
      open: "money",
    },
  ];
  metrics.innerHTML = snapshot.map((item) => `
    <button class="dashboard-brief-metric" type="button" data-open-ws="${item.open}">
      <span>${esc(item.label)}</span><b>${esc(item.value)}</b><i>${esc(item.detail)}</i>
    </button>`).join("");
}

/* Real calendar events — aggregated from dated records already in the store.
   Nothing invented: a day only lights up if a real lead follow-up, booking,
   task, or media deadline actually falls on it. */
function calendarEvents() {
  const out = [];
  const push = (raw, title, kind, open) => {
    if (!raw) return;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return;
    out.push({ date: d, day: d.toISOString().slice(0, 10), title, kind, open });
  };
  visible(store.state.leads || []).forEach((l) => {
    if (["new", "follow-up"].includes(l.status)) push(l.due, `Follow up: ${l.name || l.company || "lead"}`, "lead", "leads");
  });
  visible(store.state.bookings || []).forEach((b) => push(b.date || b.when || b.at || b.scheduledAt, `${b.type || "Booking"} — ${b.client || b.name || ""}`.trim(), "booking", "planner"));
  visible(store.state.tasks || []).forEach((t) => { if (["new", "working"].includes(t.status || "new")) push(t.due || t.date, `Task: ${t.title || "work item"}`, "task", "workforce"); });
  visible(store.state.media || []).forEach((m) => push(m.deadline || m.dueAt, `Media due: ${m.title || "asset"}`, "media", "media"));
  return out.sort((a, b) => a.date - b.date);
}

function renderCalendarWidget() {
  const host = $("[data-os-calendar]");
  if (!host) return;
  const now = new Date();
  const events = calendarEvents();
  const byDay = new Map();
  events.forEach((e) => byDay.set(e.day, (byDay.get(e.day) || 0) + 1));
  // week strip: 7 days starting Monday of the current week
  const start = new Date(now);
  const dow = (start.getDay() + 6) % 7; // 0 = Monday
  start.setDate(start.getDate() - dow);
  start.setHours(0, 0, 0, 0);
  const todayKey = now.toISOString().slice(0, 10);
  const dayLetters = ["M", "T", "W", "T", "F", "S", "S"];
  let strip = "";
  for (let i = 0; i < 7; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    const count = byDay.get(key) || 0;
    strip += `<button class="cal-day${key === todayKey ? " is-today" : ""}${count ? " has-events" : ""}" type="button" data-open-ws="planner" aria-label="${d.toDateString()}${count ? `, ${count} item${count === 1 ? "" : "s"}` : ""}">
      <span>${dayLetters[i]}</span><b>${d.getDate()}</b>${count ? `<i class="cal-dot" aria-hidden="true"></i>` : ""}</button>`;
  }
  const upcoming = events.filter((e) => e.date >= new Date(todayKey)).slice(0, 4);
  const monthLabel = now.toLocaleDateString([], { month: "long", year: "numeric" });
  host.innerHTML = `
    <div class="section-head">
      <h2>Calendar</h2>
      <button class="cal-open" type="button" data-open-ws="planner">Open planner <span aria-hidden="true">→</span></button>
    </div>
    <p class="cal-month">${esc(monthLabel)}</p>
    <div class="cal-week" role="group" aria-label="This week">${strip}</div>
    <div class="cal-agenda">
      ${upcoming.length
        ? upcoming.map((e) => `<button class="cal-event is-${esc(e.kind)}" type="button" data-open-ws="${esc(e.open)}">
            <time>${e.date.toLocaleDateString([], { weekday: "short", day: "numeric" })}</time><span>${esc(e.title)}</span></button>`).join("")
        : `<p class="cal-empty">Nothing scheduled. Follow-ups, bookings, and deadlines land here as they come in.</p>`}
    </div>`;
}

/* Honest presence — you are genuinely online (this is your live session). We do
   NOT invent a peer count: there is no real-time multi-user presence feed, so
   fabricating "N online" would be fake data. We show your real presence plus the
   real workspaces you command, and invite the team in. */
function renderPresenceWidget() {
  const host = $("[data-os-presence]");
  if (!host) return;
  const name = (ctx.session?.name || "You").trim();
  const first = name.split(/\s+/)[0];
  const initial = (first[0] || "Y").toUpperCase();
  const roleLabel = isAdmin() || isOwnerOperator() ? "Owner" : (ctx.session?.role || "Member");
  let spaces = [];
  try {
    spaces = ctx.session?.database
      ? databaseOrgMemberships().map((m) => ({ id: m.orgId, name: m.orgName }))
      : (store.state.workspaces || []).map((w) => ({ id: w.id, name: w.name }));
  } catch { spaces = []; }
  const activeWs = currentWs();
  const spaceChips = spaces.slice(0, 4).map((s) => `<span class="pres-space${s.id === activeWs ? " is-active" : ""}">${esc(s.name)}</span>`).join("");
  host.innerHTML = `
    <div class="section-head">
      <h2>In the command center</h2>
      <span class="pres-live" aria-label="1 person online">1 online</span>
    </div>
    <div class="pres-me">
      <span class="pres-avatar" aria-hidden="true">${esc(initial)}<i class="pres-dot"></i></span>
      <div class="pres-id"><b>${esc(name)}</b><i>${esc(roleLabel)} · online now</i></div>
    </div>
    ${spaces.length
      ? `<div class="pres-spaces" aria-label="Your workspaces">${spaceChips}</div>`
      : ""}
    <button class="pres-invite" type="button" data-open-ws="clients">Invite your team <span aria-hidden="true">→</span></button>`;
}

function accessVersionCopy() {
  const ent = navEntitlements.entitlements;
  if (ent) {
    const key = String(ent.planKey || "").toLowerCase();
    const dev = key.includes("developer");
    const label = dev && key.includes("elite")
      ? "Developer + Elite"
      : dev
        ? "Developer"
        : ent.planName || ent.planKey || "Selected tier";
    const included = [
      ent.canWrite === false ? "view-only" : "write access",
      ent.features?.modelTier === "advanced" ? "advanced model" : "standard model",
      ent.features?.advancedWorkflows ? "automations" : "",
      ent.features?.competitorIntelligence ? "customer intel" : "",
    ].filter(Boolean);
    return {
      label,
      detail: included.join(" · ") || (ent.effectiveStatus || "active"),
      tone: ent.canWrite === false ? "limited" : "active",
    };
  }
  if (isOwnerOperator() || isAdmin()) {
    return { label: "Full Force Admin", detail: "Owner controls · all modules · live ops", tone: "active" };
  }
  return { label: "Workspace Access", detail: navEntitlements.loaded ? "Plan details unavailable" : "Reading plan access", tone: "limited" };
}

function renderAccessVersion() {
  const root = $("[data-os-access-version]");
  if (!root) return;
  const name = $("[data-access-version-name]", root);
  const detail = $("[data-access-version-detail]", root);
  const copy = accessVersionCopy();
  root.dataset.tone = copy.tone;
  if (name) name.textContent = copy.label;
  if (detail) detail.textContent = copy.detail;
}

function connectedSocialCount() {
  try {
    const raw = JSON.parse(localStorage.getItem("pf.social.accounts.v1") || "{}") || {};
    return Object.values(raw).filter((account) => {
      const status = String(account?.status || "").toLowerCase();
      return status === "linked" || status === "connected" || account?.profileUrl || account?.handle;
    }).length;
  } catch {
    return 0;
  }
}

function renderDashboardIntel() {
  const host = $("[data-dashboard-intel]");
  if (!host) return;
  const leads = visible(store.state.leads || []);
  const media = visible(store.state.media || []);
  const sites = visible(store.state.sites || []);
  const approvals = visible(store.state.approvals || []).filter((item) => item.status === "pending");
  const accounting = moneyView();
  const socialCount = connectedSocialCount();
  const competitorLimit = Number(navEntitlements.limits?.competitorProfiles || 0);
  const pendingMedia = media.filter((item) => ["pending", "draft", "brief-ready", "generation-approved"].includes(item.status)).length;
  const cards = [
    {
      label: "Analytics",
      value: socialCount ? `${socialCount} linked` : "Connect",
      detail: socialCount ? "live profiles ready for reporting" : "social stats are waiting on OAuth",
      open: "analytics",
      tone: socialCount ? "good" : "warn",
    },
    {
      label: "Customer intel",
      value: competitorLimit ? `${competitorLimit} lanes` : "Locked",
      detail: competitorLimit ? "competitor profiles available in this tier" : "upgrade to unlock competitor coverage",
      open: "intelligence",
      tone: competitorLimit ? "good" : "warn",
    },
    {
      label: "Content readiness",
      value: `${media.length} media`,
      detail: pendingMedia ? `${pendingMedia} pending item${pendingMedia === 1 ? "" : "s"}` : `${sites.length} site${sites.length === 1 ? "" : "s"} available`,
      open: pendingMedia ? "media" : "content",
      tone: media.length || sites.length ? "good" : "idle",
    },
    {
      label: "Business health",
      value: leads.length ? `${leads.length} clients` : "No clients",
      detail: approvals.length ? `${approvals.length} approval${approvals.length === 1 ? "" : "s"} waiting` : accounting.transactions.length ? `${signedMoney(accounting.netCash)} net cash` : "add clients or connect accounting",
      open: approvals.length ? "approvals" : leads.length ? "leads" : "money",
      tone: approvals.length ? "warn" : leads.length || accounting.transactions.length ? "good" : "idle",
    },
  ];
  host.innerHTML = `
    <div class="dashboard-intel-head">
      <span>Customer intelligence</span>
      <b>Live workspace signals</b>
    </div>
    <div class="dashboard-intel-grid">
      ${cards.map((card) => `
        <button class="dashboard-intel-card is-${card.tone}" type="button" data-open-ws="${esc(card.open)}">
          <span>${esc(card.label)}</span>
          <b>${esc(card.value)}</b>
          <i>${esc(card.detail)}</i>
        </button>`).join("")}
    </div>`;
}

/* ============================ decision cards ============================ */
/* Decision Cards are the owner-state layer over the server's cross-department
   Signal feed (/phantom-ai/decisions). Server truth only: on fetch failure we
   render nothing — never a fake card, never an optimistic count. Approve and
   Modify honestly navigate to the recommended surface; nothing external
   executes from this deck. */
let decisionFeed = null;
let decisionFeedTenant = "";
let decisionFeedAt = 0;
let decisionFeedInFlight = null;
let decisionBusyId = "";

async function fetchDecisions(force = false) {
  const tenant = currentTenantId();
  if (!force && decisionFeed && decisionFeedTenant === tenant && Date.now() - decisionFeedAt < 60000) return decisionFeed;
  if (decisionFeedInFlight) return decisionFeedInFlight;
  decisionFeedInFlight = (async () => {
    const token = session.token();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const r = await fetch(`/phantom-ai/decisions?tenant_id=${encodeURIComponent(tenant)}`, { headers, signal: ctrl.signal });
      const d = await r.json().catch(() => null);
      if (r.ok && d?.ok) { decisionFeed = d; decisionFeedTenant = tenant; decisionFeedAt = Date.now(); }
    } catch { /* keep last known feed; never invent cards */ }
    finally { clearTimeout(timer); decisionFeedInFlight = null; }
    return decisionFeed;
  })();
  return decisionFeedInFlight;
}

const DECISION_DEPT_ICON = {
  Growth: "chart", Creative: "spark", Operations: "check", "Client Care": "users",
  Finance: "dollar", Intelligence: "shield", Technology: "bolt",
};

function renderDecisions() {
  const deck = $("[data-decisions]");
  if (!deck) return;
  const feed = decisionFeed && decisionFeedTenant === currentTenantId() ? decisionFeed : null;
  const open = feed?.open || [];
  if (!open.length) { deck.hidden = true; deck.innerHTML = ""; return; }
  deck.hidden = false;
  deck.innerHTML = `
    <div class="decision-head">
      <h2>Decisions</h2>
      <span class="decision-count">${open.length}</span>
      <i>Signals packaged for one motion — approve, adjust, or dismiss.</i>
    </div>
    <div class="decision-list">
      ${open.slice(0, 4).map((d) => {
        const busy = decisionBusyId === d.id;
        return `
        <article class="decision-card dc-${esc(d.impact)}" data-decision-id="${esc(d.id)}">
          <header class="decision-meta">
            <span class="decision-dept">${svg(DECISION_DEPT_ICON[d.department] || "bolt")} ${esc(d.department)}</span>
            <span class="decision-impact di-${esc(d.impact)}">${esc(d.impact)} impact</span>
            <span class="decision-conf">confidence: ${esc(d.confidence)}</span>
          </header>
          <h3>${esc(d.title)}</h3>
          <p>${esc(d.whatHappened)}</p>
          <p class="decision-evidence">Evidence: ${esc(d.evidence?.source || "server records")}</p>
          <footer class="decision-actions">
            <button class="btn btn-primary" type="button" data-decision-act="approve" ${busy ? "disabled" : ""}>
              ${d.recommendation ? `Approve · ${esc(d.recommendation.label)}` : "Acknowledge"}
            </button>
            <button class="btn" type="button" data-decision-act="modify" ${busy ? "disabled" : ""}>Adjust</button>
            <button class="btn btn-quiet" type="button" data-decision-act="dismiss" ${busy ? "disabled" : ""}>Dismiss</button>
          </footer>
        </article>`;
      }).join("")}
    </div>`;
}

async function decideDecision(id, action) {
  const card = (decisionFeed?.open || []).find((d) => d.id === id);
  if (!card || decisionBusyId) return;
  let note = "";
  if (action === "modify") {
    note = window.prompt("What should change about this recommendation?", "") || "";
    if (!note.trim()) return; // owner backed out — leave the card open
  }
  decisionBusyId = id;
  renderDecisions();
  try {
    const token = session.token();
    const r = await fetch(`/phantom-ai/decisions/${encodeURIComponent(id)}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ action, note: note || undefined, tenant_id: currentTenantId() }),
    });
    const d = await r.json().catch(() => null);
    if (!r.ok || !d?.ok) throw new Error(d?.error || "Decision could not be recorded.");
    await fetchDecisions(true);
    const route = d.decision?.followThrough?.route;
    if ((action === "approve" || action === "modify") && route) routeWorkspace(route);
  } catch (error) {
    speak(`That decision didn't record: ${error?.message || "server unreachable"}. The card stays open.`, "", "alert");
  } finally {
    decisionBusyId = "";
    renderDecisions();
  }
}

/* ============================ today's plan (donut) ============================ */
function renderPlan() {
  const plan = todaysPlan();
  if (!plan.length) {
    $("[data-plan]").innerHTML = `
      <div class="section-head"><h2>Need from you</h2></div>
      <button class="plan-inner" data-open-ws="settings">
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
  /* Each plan item knows the surface it lives on. Hardcoding "approvals" here
     sent a task or lead straight to an empty approval queue — the count said
     one thing was waiting and the destination said nothing was. */
  const target = plan[0]?.open || "approvals";
  const detail = plan.length === 1
    ? plan[0].text
    : `${plan.length} things need you.`;
  $("[data-plan]").innerHTML = `
    <div class="section-head"><h2>Need from you</h2></div>
    <button class="plan-inner" data-open-ws="${target}">
      <svg class="plan-donut" viewBox="0 0 72 72" aria-hidden="true">
        <circle cx="36" cy="36" r="30" class="plan-track"/>
        <text x="36" y="40" class="plan-pct">${plan.length}</text>
      </svg>
      <span class="plan-copy">
        <b>${msg}</b>
        <i>${esc(detail)}</i>
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
  }).join("") || `<p class="empty-line">No work running.</p>`;
}

/* ============================ organization pulse ============================
   Real server-computed cross-department attention feed (pending approvals,
   follow-ups due, proposal review ready, incomplete client setup, failed
   agent runs, failing automations) plus the Brain Contract's recommended
   actions — organizationpulse.js already wrapped /api/organization/pulse and
   /api/brain/contract with caching and honest empty/error states, it just
   never had anywhere to render. Renders from cache immediately (empty on
   first load), then a fire-and-forget refresh repaints once server truth
   lands — same pattern as renderNotifs/renderDecisions above. */
const PULSE_TONE_BADGE = { warn: "q-wait", ok: "q-run", neutral: "q-queue" };
const PULSE_TONE_LABEL = { warn: "Attention", ok: "Ready", neutral: "Signal" };
function renderOrganizationPulse() {
  const host = $("[data-org-pulse]");
  if (!host) return;
  const items = [...pulseAttentionItems(), ...brainContractAttentionItems()].slice(0, 6);
  const countEl = $("[data-org-pulse-count]");
  if (countEl) countEl.textContent = items.length;
  host.innerHTML = items.map((item) => `
    <button class="queue-item" type="button" data-open-ws="${esc(item.open || "dashboard")}">
      <span class="queue-ic">${svg(item.icon || "brain")}</span>
      <span class="queue-meta"><b>${esc(item.title)}</b><i>${esc(item.sub || "")}</i></span>
      <span class="queue-badge ${PULSE_TONE_BADGE[item.tone] || "q-queue"}">${PULSE_TONE_LABEL[item.tone] || "Signal"}</span>
    </button>`).join("") || `<p class="empty-line">Nothing needs attention right now.</p>`;
}
function refreshOrganizationPulse() {
  return Promise.all([loadOrganizationPulse().catch(() => null), loadBrainContract().catch(() => null)])
    .then(() => renderOrganizationPulse())
    .catch(() => {});
}

/* ============================ dashboard quick-widgets ============================ */
/* Modules demoted from the sidebar (dashboardWidget:true in BASE_NAV) surface
   here as compact live-snapshot cards. Numbers come only from real store
   state; a module with no local metric shows a plain descriptor and a
   click-through arrow — never an invented count. Clicking routes to the full
   workspace through the shared data-open-ws handler, so the page opens exactly
   as it did when it was a tab. */
function dashWidgetItems() {
  const pendingApprovals = visible(store.state.approvals || []).filter((a) => a.status === "pending").length;
  const agentCount = (store.state.agents || []).length;
  return [
    { id: "phantomai", ws: "phantomai", label: "Phantom AI", icon: "chat", sub: "Assistant & history" },
    { id: "approvals", ws: "approvals", label: "Approvals", icon: "check",
      val: pendingApprovals || "", alert: pendingApprovals > 0,
      sub: pendingApprovals ? `${pendingApprovals} waiting on you` : "None waiting" },
    { id: "workers", ws: "workforce", label: "Workforce", icon: "users",
      val: agentCount || "", sub: agentCount ? `${agentCount} in motion` : "Idle" },
    { id: "analytics", ws: "analytics", label: "Analytics", icon: "chart", sub: "Reach & engagement" },
    { id: "intelligence", ws: "intelligence", label: "Competitor Intel", icon: "shield", sub: "Market & rivals" },
    { id: "assets", ws: "assets", label: "Asset Cloud", icon: "media", sub: "Shared library" },
  ];
}
function renderDashWidgets() {
  const host = $("[data-dash-widgets]");
  if (!host) return;
  /* Respect the same access/entitlement rules the sidebar used: a widget for a
     module this org can't reach (e.g. Asset Cloud without database auth, or a
     plan-disabled feature) is simply omitted, never shown as a dead card. */
  const items = dashWidgetItems().filter((item) => {
    const navItem = NAV.find((n) => n.id === item.id);
    return navItem ? canAccessSurface(navItem) && !navFeatureDisabled(navItem) : true;
  });
  host.innerHTML = items.map((item) => `
    <button class="quickwidget${item.alert ? " is-alert" : ""}" type="button" data-open-ws="${esc(item.ws)}">
      <span class="qw-ic">${svg(item.icon)}</span>
      <span class="qw-text"><b>${esc(item.label)}</b><i>${esc(item.sub)}</i></span>
      ${item.val !== undefined && item.val !== "" ? `<span class="qw-val">${esc(String(item.val))}</span>` : `<span class="qw-arrow" aria-hidden="true">→</span>`}
    </button>`).join("");
}

/* ============================ quick actions ============================ */
const QUICK = [
  { label: "Create new content", icon: "spark",  run: "Create campaign media" },
  { label: "Start video campaign", icon: "film",  run: "Create a launch video" },
  { label: "Check cashflow", icon: "chart",   run: "What's my cash flow?" },
  { label: "Open Content Hub", icon: "upload",   open: "content" },
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
/* Server truth for the bell: /api/organization/pulse tells us what is
   actually pending/failing/running on the backend, beyond the client store,
   and /api/organization/opportunities contributes the top high-impact
   recommendation from the live graph analysis. Both share the 60s cache and
   fail independently; on fetch failure we show nothing extra (no fake data). */
let serverPulse = null;
let serverPulseTenant = "";
let serverPulseAt = 0;
let serverPulseInFlight = null;
let serverOpportunity = null; // top high-impact opportunity only, or null
let serverOpportunityTenant = "";
async function fetchServerAttention(force = false) {
  const tenant = currentTenantId();
  if (!force && serverPulse && serverPulseTenant === tenant && Date.now() - serverPulseAt < 60000) return serverPulse;
  if (serverPulseInFlight) return serverPulseInFlight;
  serverPulseInFlight = (async () => {
    const token = session.token();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const getJson = async (path) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      try {
        const r = await fetch(`${path}?tenant_id=${encodeURIComponent(tenant)}`, { headers, signal: ctrl.signal });
        const d = await r.json().catch(() => null);
        return r.ok ? d : null;
      } finally { clearTimeout(timer); }
    };
    const [pulseData, oppData] = await Promise.all([
      getJson("/api/organization/pulse").catch(() => null), // keep last known pulse; never invent items
      getJson("/api/organization/opportunities").catch(() => null),
    ]);
    if (pulseData?.ok && pulseData.pulse) { serverPulse = pulseData.pulse; serverPulseTenant = tenant; serverPulseAt = Date.now(); }
    if (oppData?.ok && Array.isArray(oppData.opportunities)) {
      serverOpportunity = oppData.opportunities.find((o) => o?.impact === "high" && o.title && o.action?.route) || null;
      serverOpportunityTenant = tenant;
    }
    serverPulseInFlight = null;
    return serverPulse;
  })();
  return serverPulseInFlight;
}
function serverAttentionItems() {
  const pulse = serverPulse && serverPulseTenant === currentTenantId() ? serverPulse : null;
  const items = [];
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const pending = pulse?.approvals?.available ? pulse.approvals.pending || 0 : 0;
  if (pending > 0) items.push({ icon: "check", tone: "warn", title: `${plural(pending, "approval")} waiting on you`, sub: "Server-confirmed approval queue", open: "approvals" });
  const failed = pulse?.agentRuns?.available ? pulse.agentRuns.failed || 0 : 0;
  if (failed > 0) items.push({ icon: "bolt", tone: "warn", title: `${plural(failed, "agent run")} failed — work stopped`, sub: "Open Automations to see what broke", open: "automation" });
  const running = pulse?.agentRuns?.available ? pulse.agentRuns.running || 0 : 0;
  if (running > 0) items.push({ icon: "clock", tone: "ok", title: `${plural(running, "job")} running now`, sub: "Agents are working in the background", open: "automation" });
  const failing = pulse?.automations?.available ? pulse.automations.failing || [] : [];
  if (failing.length > 0) items.push({ icon: "bolt", tone: "warn", title: `Automation failing: ${failing[0].name || failing[0].id}`, sub: failing[0].lastSummary || `${failing.length} automation(s) reporting failures`, open: "automation" });
  const opp = serverOpportunity && serverOpportunityTenant === currentTenantId() ? serverOpportunity : null;
  if (opp) items.push({ icon: "bolt", tone: "ok", title: `Opportunity: ${opp.title}`, sub: `${opp.action.label || "Open"} — from live graph analysis`, open: opp.action.route });
  return items;
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
  items.push(...serverAttentionItems());
  return items;
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
      .forEach((m) => add(m.title, "Media item", "media", "film"));
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

/* ============================ spoken briefing ============================ */
const signedMoney = (value) => value < 0 ? `-${fmtMoney(Math.abs(value))}` : fmtMoney(value);

function briefingText() {
  const name = (ctx.session?.name || "there").split(/\s+/)[0];
  return `${greeting()}, ${name}. What do you want handled first?`;
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
  if (planEl) planEl.textContent = currentPlanName();
  if (el) el.textContent = `Renewal: ${renew}`;
}

function ensureDashboardShell() {
  const root = $("[data-console]");
  if (!root) return null;
  if (root.dataset.consoleView !== "dashboard") {
    root.className = "console console-enter";
    root.dataset.consoleView = "dashboard";
    delete root.dataset.pageWs;
    root.innerHTML = dashboardShellHtml;
    lastEnteredPageKey = null;
    const settle = (e) => {
      if (e.target !== root) return;
      root.classList.remove("console-enter");
      root.removeEventListener("animationend", settle);
    };
    root.addEventListener("animationend", settle);
  }
  return root;
}

function renderConsole() {
  if (activePageId) {
    renderWorkspacePage(activePageId, false);
    return;
  }
  ensureDashboardShell();
  // Workspace pages replace the dashboard DOM. Rebind the restored command
  // form before optional widgets render so a secondary panel failure can
  // never leave the primary chat composer visible but inert.
  bindCommandForm();
  renderNav();
  renderStatusPills();
  renderPlanMeta();
  renderAccessVersion();
  renderUser();
  renderNotifs();
  /* Fire-and-forget: pull server truth for the bell, then repaint the badge
     (and the open menu) once it lands. Failures change nothing. */
  const pulseBefore = serverPulseAt;
  fetchServerAttention().then(() => { if (serverPulseAt !== pulseBefore) renderNotifs(); }).catch(() => {});
  renderHero();
  renderDashboardBrief();
  renderCalendarWidget();
  renderPresenceWidget();
  renderDecisions();
  fetchDecisions().then(() => renderDecisions()).catch(() => {});
  renderChips();
  renderModePose(activeMode);
  renderFlowMap();
  renderFlowCompactSummary();
  renderPlan();
  renderQueue();
  renderDashWidgets();
  renderDashboardIntel();
  renderOrganizationPulse();
  refreshOrganizationPulse();
  const openIc = $("[data-cmdk-open-ic]"); if (openIc && !openIc.innerHTML) openIc.innerHTML = svg("search");
  mountPhantomWire($("[data-phantomwire]") || $("[data-agent-ticker]"));
  mountDesktopContextWidget($("[data-desktop-context]"), {
    notify: (who, text) => {
      pushActivity(who, text);
      store.save();
    },
  });
  mountCompanion($("[data-chatbox] .chatbox-head"), {
    onMode: applyCompanionMode,
    canLoop: canUsePhantomLoop,
    onLoopUnavailable: () => speak(phantomLoopUnavailableMessage(), "", "alert"),
    renderSettings: renderChatSettingsPanel,
    renderCore: renderConsoleCoreStatus,
  });
  renderChatLog();
  mountMissionControl($("[data-mission-control]"), {
    runBrain: (text) => handleSmartCommand(text),
  });
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
  // Only jump to the latest message once there's an actual back-and-forth —
  // on first load (just the greeting + starter chips) that would scroll the
  // greeting itself out of view for no reason, especially on shorter screens
  // where the log doesn't have room to show everything at once.
  log.scrollTop = chatHistory.length > 1 ? log.scrollHeight : 0;
}
function applyCompanionMode(mode) {
  const loop = loadPhantomLoop();
  if (mode === "loop" !== loop.enabled) savePhantomLoop({ ...loop, enabled: mode === "loop" });
  const input = $("[data-command-input]");
  if (!input) return;
  input.placeholder = mode === "loop"
    ? "Phantom Loop is on - give Phantom the outcome..."
    : "Ask PhantomForce anything...";
}

function renderChatSettingsPanel(target) {
  renderOperatorMiniSettings(target, {
    openSettings: () => routeWorkspace("settings"),
    onChange: (settings) => {
      renderChatLog();
      /* the change must be VISIBLE immediately, not just saved */
      const caption = document.querySelector("[data-pc-caption]");
      if (caption && settings) {
        const brain = settings.brainMode === "api" ? "Phantom Hybrid" : settings.brainMode === "subscription" ? "Subscription" : "Ghost/local";
        const model = settings.models?.[settings.provider] || "";
        caption.textContent = `Settings applied — ${brain} · ${model}`;
      }
      refreshCompanionCore();
    },
    onLoopChange: (loop) => {
      if (!loop.enabled && companionMode() === "loop") setCompanionMode("chat");
      else if (loop.enabled && companionMode() !== "loop") setCompanionMode("loop");
      applyCompanionMode(companionMode());
      const caption = document.querySelector("[data-pc-caption]");
      if (caption) caption.textContent = loop.enabled ? "Phantom Loop on — deeper pass ready" : "Phantom Loop off";
      refreshCompanionCore();
    },
  });
}

const CHAT_STARTERS = [
  { label: "Catch me up", run: "Catch me up on this business" },
  { label: "Plan my day", run: "Plan my day from real work already here" },
  { label: "Create content", run: "Create campaign media for a new campaign" },
  { label: "Build a website", run: "Build a website for my business" },
];

function starterHtml() {
  return `<div class="chat-start" data-chat-start>
    <p class="chat-start-t">What should Phantom handle?</p>
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

function progressStepsForCommand(text = "") {
  const value = String(text).toLowerCase();
  if (/\b(image|video|media|photo|content|asset|thumbnail|reel)\b/.test(value)) {
    return ["Understanding the creative brief...", "Checking your workspace...", "Preparing the result..."];
  }
  if (/\b(build|create|draft|plan|proposal|campaign|site|page|workflow)\b/.test(value)) {
    return ["Understanding the outcome...", "Checking related work...", "Building the response..."];
  }
  if (/\b(memory|remember|previous|history|client|lead|business)\b/.test(value)) {
    return ["Checking your context...", "Connecting the relevant details...", "Preparing the answer..."];
  }
  return ["Thinking it through...", "Checking the details...", "Preparing the answer..."];
}

function startChatProgress(text) {
  const steps = progressStepsForCommand(text);
  let index = 0;
  speak(steps[index], "thinking");
  const timer = window.setInterval(() => {
    index = Math.min(index + 1, steps.length - 1);
    speak(steps[index], "thinking");
    if (index === steps.length - 1) window.clearInterval(timer);
  }, reduceMotion ? 2200 : 4200);
  return () => window.clearInterval(timer);
}

function chatTypingOn(label = "") {
  const log = chatLogEl();
  if (!log) return;
  const existing = log.querySelector(".msg-typing");
  if (existing) {
    const lab = existing.querySelector("[data-typing-label]");
    if (lab) lab.textContent = label;
    return;
  }
  log.insertAdjacentHTML("beforeend", `<div class="msg msg-phantom msg-typing"><span class="msg-avatar" aria-hidden="true"></span><div class="msg-body">${label ? `<p class="msg-typing-label" data-typing-label>${esc(label)}</p>` : ""}<p class="msg-text msg-dots"><i></i><i></i><i></i></p></div></div>`);
  log.scrollTop = log.scrollHeight;
}
function chatTypingOff() {
  chatLogEl()?.querySelector(".msg-typing")?.remove();
}
/* Visible skill engagement - the brain reports which owner playbooks shaped
   this reply; showing them is part of the memory-used-visibly principle. */
function chatAttachSkillChips(skillNames) {
  const log = $("[data-chat-log]");
  if (!log || !skillNames?.length) return;
  const wrap = document.createElement("div");
  wrap.className = "chat-skill-chips";
  wrap.innerHTML = skillNames.slice(0, 2).map((name) => `<span>${esc(String(name))} skill engaged</span>`).join("");
  log.appendChild(wrap);
  log.scrollTop = log.scrollHeight;
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
let briefingTimer = 0;

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
function speak(text, cls = "", emotionOverride = null, options = {}) {
  clearTimeout(typeTimer);
  const emotion = emotionOverride || emotionForText(text);
  if (cls === "thinking") {
    setGhostMood("thinking", { emotion: "bright" });
    renderEmotePose("think", 900);
    setCompanionState("thinking");
    buddyReact("thinking", 1400);
    chatTypingOn(text && text !== "· · ·" ? text : "");
    return;
  }
  if (cls === "user") {
    setGhostMood("listening", { emotion: "calm", ms: 1600 });
    renderEmotePose("listen", 1100);
    setCompanionState("listening");
    buddyReact("listening", 1600);
    chatHistory.push({ who: "user", text });
    if (chatHistory.length > 40) chatHistory.shift();
    renderChatLog();
    return;
  }
  setGhostMood("talking", { emotion, ms: speechHoldMs(text) });
  renderEmotePose(emotion === "alert" ? "alert" : emotion === "happy" || emotion === "excited" ? "happy" : "talk", Math.min(2200, speechHoldMs(text)));
  setCompanionState(emotion === "alert" ? "warning" : emotion === "happy" || emotion === "excited" ? "success" : "speaking");
  buddyReact(emotion === "alert" ? "alert" : emotion === "happy" || emotion === "excited" ? "happy" : "talking", Math.min(2600, speechHoldMs(text)));
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
      // same reasoning as renderChatLog(): only chase the tail once there's
      // an actual conversation, not while the first greeting is still typing.
      log.scrollTop = chatHistory.length > 1 ? log.scrollHeight : 0;
    }
  };
  if (reduceMotion || options.instant) {
    entry.text = text;
    paintLast();
    setGhostMood("talking", { emotion, ms: speechHoldMs(text) });
    setCompanionState(emotion === "alert" ? "warning" : emotion === "happy" || emotion === "excited" ? "success" : "speaking");
    return;
  }
  let i = 0;
  const revealFrameMs = 16;
  const maxRevealMs = 900;
  const charactersPerFrame = Math.max(1, Math.ceil(text.length / Math.max(1, Math.floor(maxRevealMs / revealFrameMs))));
  const tick = () => {
    entry.text = text.slice(0, i);
    paintLast();
    if (i < text.length) {
      i = Math.min(text.length, i + charactersPerFrame);
      typeTimer = setTimeout(tick, revealFrameMs);
    }
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
  if (briefingTimer) {
    clearTimeout(briefingTimer);
    briefingTimer = 0;
  }
  const loop = loadPhantomLoop();
  const loopArmed = companionMode() === "loop" && loop.enabled;
  const inferredMode = inferModeFromText(raw);
  if (!loopArmed && inferredMode !== activeMode && MODES[inferredMode]) {
    activeMode = inferredMode;
    renderChips();
    renderModePose(inferredMode);
  }
  const mode = MODES[activeMode] || MODES.ask;
  /* the prefix only fires when THIS message names the lane and reads like a
     request — a leftover sticky mode must never turn "whats the weather"
     into "Create a video for whats the weather", and a first-person
     statement ("I have an idea for a video") is a person talking, never a
     brief to silently rewrite into a creation command */
  const namedLane = modeNamedInText(raw);
  const firstPerson = /^(i|i'm|im|i've|ive|we|we're|were|my|our|it|that|this)\b/i.test(raw.trim());
  const modeText = mode.prefix && namedLane === activeMode && !looksLikeQuestion(raw) && !firstPerson && !/\b(draft|create|build|make|write|new)\b/i.test(raw)
    ? mode.prefix + raw
    : raw;
  const text = applyCommandExecutionMode(modeText);
  speak(raw, "user");
  ghostFlare("listening");
  stageReact("listen", 620);
  setTimeout(() => {
    const stopProgress = startChatProgress(text);
    if (loopArmed) setCompanionState("looping");
    stageReact("think", 780);
    setTimeout(async () => {
      let r;
      try {
        r = await handleSmartCommand(text);
      } catch {
        r = handleCommand(text);
      } finally {
        stopProgress();
      }
      if (loopArmed) {
        speak("Finishing the response...", "thinking");
        await new Promise((resolve) => setTimeout(resolve, reduceMotion ? 0 : 420));
      }
      // The thinking state already covers request latency. Once a result is
      // complete, show it immediately so intent labels or answer length can
      // never make a finished response feel slow.
      speak(r.say, "", null, { instant: true });
      if (r.cards?.length) chatAttachCards(r.cards);
      if (r.skills?.length) chatAttachSkillChips(r.skills);
      rememberConversation({ prompt: raw, reply: r.say, mode: activeMode, route: r.open || "" });
      renderConsole();
      stageReact("answer", 1100);
      if (r.open) setTimeout(() => routeWorkspace(r.open), reduceMotion ? 150 : 750);
    }, reduceMotion ? 40 : 90);
  }, reduceMotion ? 20 : 60);
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
      setCompanionState(companionMode() === "loop" ? "building" : "idle");
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
    if (e.target.closest("[data-os-menu-btn]")) {
      osMenuOpen = !osMenuOpen;
      accountMenuOpen = false;
      setMobileNav(false);
      renderAccountMenu();
      renderOsMenu();
      return;
    }
    const accountAction = e.target.closest("[data-user-menu-action]");
    if (accountAction) {
      const action = accountAction.dataset.userMenuAction;
      accountMenuOpen = false;
      osMenuOpen = false;
      renderAccountMenu();
      renderOsMenu();
      if (action === "account") routeWorkspace("account");
      if (action === "signout") signOut();
      return;
    }
    const osMenuNav = e.target.closest("[data-os-menu-nav]");
    if (osMenuNav) {
      osMenuOpen = false;
      renderOsMenu();
      goNav(osMenuNav.dataset.osMenuNav);
      setMobileNav(false);
      return;
    }
    const mobileNav = e.target.closest("[data-mobile-nav]");
    if (mobileNav) {
      const item = MOBILE_NAV.find((n) => n.id === mobileNav.dataset.mobileNav);
      if (!item) return;
      if (item.route === "nav") goNav(item.target);
      else routeWorkspace(item.target);
      setMobileNav(false);
      return;
    }
    if (e.target.closest("[data-mobile-more]")) { setMobileNav(!mobileNavOpen); return; }
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
    const mapPrompt = e.target.closest("[data-map-prompt]");
    if (mapPrompt) {
      const prompt = mapPrompt.dataset.mapPrompt || "";
      closeOperationsMap();
      renderDashboardPage(true);
      setTimeout(() => {
        const input = $("[data-command-input]");
        if (!input) return;
        input.value = prompt;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        focusCommandInput();
      }, reduceMotion ? 0 : 80);
      return;
    }
    const decisionAct = e.target.closest("[data-decision-act]");
    if (decisionAct) {
      const decisionCard = decisionAct.closest("[data-decision-id]");
      if (decisionCard) decideDecision(decisionCard.dataset.decisionId, decisionAct.dataset.decisionAct);
      return;
    }
    const opener = e.target.closest("[data-open-ws]");
    if (opener) { if (notifOpen) { notifOpen = false; renderNotifs(); } routeWorkspace(opener.dataset.openWs); return; }
    if (mobileNavOpen && window.matchMedia("(max-width: 900px)").matches && !e.target.closest(".sidebar")) { setMobileNav(false); return; }
    if (accountMenuOpen && !e.target.closest(".user-menu-wrap")) { accountMenuOpen = false; renderAccountMenu(); }
    if (osMenuOpen && !e.target.closest(".os-menu-wrap")) { osMenuOpen = false; renderOsMenu(); }
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
    else if (e.key === "Escape" && openId === "operations-map") { closeOperationsMap(); }
    else if (e.key === "Escape" && mobileNavOpen) { setMobileNav(false); }
    else if (e.key === "Escape" && osMenuOpen) { osMenuOpen = false; renderOsMenu(); }
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
  focusCommand: () => { renderDashboardPage(true); focusCommandInput(80); },
});

/* Owner-only runtime lanes. Keep the product vocabulary clean here too:
   this page can show readiness without exposing vendor plumbing. */
const LOOP_LANE_IDENTITY = { openai: "ChatGPT (OpenAI)", claude: "Claude (Anthropic)", glm: "GLM (OpenRouter)", local: "Local / Ollama", custom: "Custom endpoint" };
const MEDIA_ENGINE_IDENTITY = { cinematic: "PhantomForce native lane", claude: "Direction lane", openai: "Image lane", runway: "Motion lane", flux: "Still lane" };

/* ============================================================================
   DEVELOPER TAB — the real curtain-pull. Owner-only. Every section here is
   backed by a real call (agent workforce ledger, media probes, ai-proxy
   health) — nothing on this page is a static mockup. It never executes a
   provider, approval, send, or production write; it only looks. */
const DEV_AGENT_ICON = { "phantom-ai": "brain", hermes: "db", builder: "dev", strategist: "brain", reviewer: "check", gatekeeper: "shield", scout: "dollar", sentinel: "shield", cutlab: "film" };
const DEV_PROGRAM_ICON = { n8n: "auto", openspec: "doc", "agent-os": "book", serena: "search", ruflo: "users", "phantom-ai-online-fetch": "bolt", rembg: "media", "media-lab": "film", openai: "spark", fastify: "cog", "ai-proxy": "cog" };
const DEV_TONE = {
  active: "on", working: "on", connected: "on", running_local: "on", reachable: "on", observed: "on",
  standby: "warn", available: "warn", idle: "warn", waiting: "warn", drafting: "warn", watching: "warn", ready: "warn",
  defined: "warn", mapped: "warn", mapped_cell: "warn", scheduled_definition: "warn",
  scaffolded_idle: "warn", sandbox_reference: "warn", planning_reference: "warn", manual: "warn", "manual mode": "warn",
  quarantined_planning_only: "warn", dry_run_draft_only: "warn", local_proposal_draft: "warn", reference_only: "warn", planned_allowlisted_fetch: "warn",
  blocked: "off", blocked_by_parent: "off", unconfigured: "off", missing: "off", planned: "off", unavailable: "off", unreachable: "off",
};
function devTone(state) { return DEV_TONE[String(state || "").toLowerCase()] || "warn"; }
function devDot() { return `<span class="dev-dot" aria-hidden="true"></span>`; }
function laneTargetForId(id) {
  return PHANTOM_LANE_TARGETS.find((target) => target.id === id) || PHANTOM_LANE_TARGETS[0];
}
function laneTargetOptions(selected) {
  return PHANTOM_LANE_TARGETS.map((target) => `<option value="${esc(target.id)}" ${target.id === selected ? "selected" : ""}>${esc(target.name)}</option>`).join("");
}
function localModelOptions(localModels) {
  const installed = Array.isArray(localModels?.installed_models) ? localModels.installed_models : [];
  return [...new Set(["local-auto", ...installed.map((model) => model.model || model.name).filter(Boolean)])];
}
function localModelLabel(modelId, localModels) {
  if (modelId === "local-auto") return localModels?.model_count ? "Auto - best installed Ollama model" : "Auto - read Ollama";
  const model = (localModels?.installed_models || []).find((item) => item.model === modelId || item.name === modelId);
  const suffix = [model?.parameter_size, model?.quantization_level].filter(Boolean).join(" ");
  return `${model?.display_name || modelId}${suffix ? ` (${suffix})` : ""}`;
}
function cleanLocalProviderMessage(value) {
  const text = String(value || "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (/urlopen|winerror\s*10061|actively refused|econnrefused|connection refused|connectex|failed to fetch|fetch failed|target machine/i.test(text)) {
    return "Local brain is offline. Start Ollama/local model service, then re-read models.";
  }
  if (/aborterror|timed?\s*out|timeout|did not respond/i.test(text)) {
    return "Local brain did not answer in time. Re-read models after the local service settles.";
  }
  return text.slice(0, 160);
}
function laneModelOptions(targetId, selectedModel, localModels = null) {
  const target = laneTargetForId(targetId);
  const models = target.id === "local_ollama" ? localModelOptions(localModels) : target.models;
  return models.map((model) => `<option value="${esc(model)}" ${model === selectedModel ? "selected" : ""}>${esc(target.id === "local_ollama" ? localModelLabel(model, localModels) : model)}</option>`).join("");
}
function renderBrainLaneControls(localModels = null) {
  const cfg = loadPhantomLaneConfig();
  return PHANTOM_LANES.map((lane) => {
    const selected = cfg.lanes?.[lane.id] || {};
    const target = laneTargetForId(selected.target || lane.defaultTarget);
    const models = target.id === "local_ollama" ? localModelOptions(localModels) : target.models;
    const model = models.includes(selected.model) || (target.allowCustomModel && typeof selected.model === "string" && selected.model.trim()) ? selected.model : models[0];
    const localHint = lane.id === "local" && target.id === "local_ollama"
      ? `<small>${localModels?.reachable ? `${Number(localModels.model_count || 0)} Ollama model${localModels.model_count === 1 ? "" : "s"} on this PC` : esc(cleanLocalProviderMessage(localModels?.error) || "Ollama status waiting")}</small>`
      : "";
    return `
      <div class="developer-lane-control" data-dev-lane-row="${esc(lane.id)}">
        <div class="developer-lane-copy">
          <b>${esc(lane.name)}</b>
          <i>${esc(lane.role)}</i>
          ${localHint}
        </div>
        <label><span>Backend</span>
          <select data-dev-lane-target="${esc(lane.id)}">${laneTargetOptions(target.id)}</select>
        </label>
        <label><span>Model</span>
          <select data-dev-lane-model="${esc(lane.id)}">${laneModelOptions(target.id, model, localModels)}</select>
        </label>
        <em data-dev-lane-current="${esc(lane.id)}">${esc(phantomLaneTargetName(target.id))}</em>
      </div>`;
  }).join("");
}

async function fetchAgentWorkforceStatus(windowHours = 24) {
  try {
    const token = session.token();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(`/phantom-ai/agents/status?window_hours=${windowHours}`, { headers, signal: ctrl.signal });
    clearTimeout(timer);
    const d = await r.json().catch(() => null);
    if (r.ok && d && d.ok) return { ok: true, workforce: d.workforce };
    return { ok: false, error: (d && (d.error?.message || d.error)) || `Agent status request failed (${r.status}).` };
  } catch (e) {
    return { ok: false, error: e?.name === "AbortError" ? "Agent status request timed out." : "Could not reach the agent status backend." };
  }
}

async function fetchProviderManagerStatus() {
  try {
    const token = session.token();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const response = await fetch("/phantom-ai/provider-status", { headers, signal: ctrl.signal });
    clearTimeout(timer);
    const payload = await response.json().catch(() => null);
    const manager = payload?.status?.provider_manager;
    return response.ok && manager ? manager : null;
  } catch {
    return null;
  }
}

async function fetchLocalModelStatus() {
  try {
    const token = session.token();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const response = await fetch("/phantom-ai/local-models/status", { headers, signal: ctrl.signal });
    clearTimeout(timer);
    const payload = await response.json().catch(() => null);
    return response.ok && payload?.ollama ? payload.ollama : null;
  } catch {
    return null;
  }
}

function providerManagerMarkup(manager) {
  if (!manager?.providers?.length) return `<p class="dev-provider-empty">Provider state is waiting for the local backend.</p>`;
  const labels = { ["co" + "dex_cli"]: "Private", claude_cli: "Claude", openrouter_glm: "OpenRouter", local_ollama: "Local" };
  return `<div class="dev-provider-monitor">
    ${manager.providers.map((provider) => {
      const tone = provider.status === "online" ? "on" : provider.status === "offline" ? "off" : "warn";
      return `<article class="dev-provider-row dev-tone-${tone}">
        <span class="dev-state-pill dev-tone-${tone}">${devDot()}${esc(provider.status)}</span>
        <div><b>${esc(labels[provider.provider_id] || provider.provider_id)}</b><i>${provider.preferred ? "Preferred" : manager.active_provider_id === provider.provider_id ? "Active fallback" : "Standby"}</i></div>
        <span><b>${provider.latency_ms == null ? "—" : `${provider.latency_ms}ms`}</b><i>Latency</i></span>
        <span><b>${esc(provider.quota || "unknown")}</b><i>Quota</i></span>
        <span><b>${provider.last_success_at ? esc(ago(provider.last_success_at)) : "—"}</b><i>Last success</i></span>
      </article>`;
    }).join("")}
  </div>`;
}

function devAgentCard(worker, subs, esc) {
  const tone = devTone(worker.state);
  const icon = DEV_AGENT_ICON[worker.id] || "dev";
  return `
    <article class="dev-agent-card dev-tone-${tone}">
      <div class="dev-agent-top">
        <span class="dev-agent-ic">${svg(icon)}</span>
        <div class="dev-agent-id"><b>${esc(worker.name)}</b><i>${esc(worker.role)}</i></div>
        <span class="dev-state-pill dev-tone-${tone}">${devDot()}${esc(worker.state)}</span>
      </div>
      <p class="dev-agent-focus">${esc(worker.focus)}</p>
      <div class="dev-agent-metrics">
        <span><b>${worker.tasks_last_1h}</b><i>1h</i></span>
        <span><b>${worker.tasks_last_24h}</b><i>24h</i></span>
        <span><b>${worker.tasks_last_7d}</b><i>7d</i></span>
        <span><b>${(worker.tokens_last_24h || 0).toLocaleString()}</b><i>tokens</i></span>
        <span><b>${(worker.estimated_cost_usd_last_24h || 0).toFixed(4)}</b><i>24h cost</i></span>
      </div>
      <div class="dev-agent-foot">
        <span>${esc(worker.tool_binding)}</span>
        <span>${worker.last_run_at ? esc(ago(worker.last_run_at)) : "no runs yet"}</span>
      </div>
      ${subs.length ? `
      <button class="dev-sub-toggle" type="button" data-dev-sub-toggle="${esc(worker.id)}" aria-expanded="false">
        <span data-dev-sub-caret>▸</span> ${subs.length} subagent${subs.length === 1 ? "" : "s"}
      </button>
      <div class="dev-sub-list" data-dev-sub-list="${esc(worker.id)}" hidden>
        ${subs.map((sub) => {
          const subTone = devTone(sub.state);
          return `<div class="dev-sub-item dev-tone-${subTone}">
            ${devDot()}<b>${esc(sub.name)}</b><i>${esc(sub.specialty)}</i><span>${esc(sub.state)}</span>
          </div>`;
        }).join("")}
      </div>` : ""}
    </article>`;
}

function devProgramCard(p, esc) {
  return `
    <article class="dev-program-card dev-tone-${p.tone}">
      <div class="dev-program-top">
        <span class="dev-program-ic">${svg(p.icon)}</span>
        <b>${esc(p.name)}</b>
        <span class="dev-state-pill dev-tone-${p.tone}">${devDot()}${esc(p.status)}</span>
      </div>
      <p>${esc(p.detail)}</p>
      ${p.meta ? `<i class="dev-program-meta">${esc(p.meta)}</i>` : ""}
    </article>`;
}

function friendlyProgramStatus(program) {
  const state = String(program?.state || "").toLowerCase();
  const baseMeta = "Approval-gated · private admin lane · no outside action by itself";
  const byId = {
    n8n: {
      status: state === "running_local" ? "Running local" : "Scaffold ready",
      detail: state === "running_local"
        ? "Local automation bay is online for owner-approved workflow runs."
        : "Automation bay is ready for drafted workflows. Live execution stays off until you approve and connect it.",
      meta: state === "running_local" ? "Local-only runtime · owner controlled" : "Draft mode ready · no live workflow runs",
    },
    openspec: {
      status: "Spec ready",
      detail: "Proposal and acceptance-criteria planning is ready before code changes.",
      meta: "Planning lane · owner-approved writes only",
    },
    "agent-os": {
      status: "Standards ready",
      detail: "Operating standards are available for handoffs, constraints, and worker behavior.",
      meta: "Reference lane · keeps builds organized",
    },
    serena: {
      status: "Map ready",
      detail: "Code navigation context can be prepared when you ask for repo or route insight.",
      meta: "Read-only lane · no repo mutation",
    },
    ruflo: {
      status: "Squad ready",
      detail: "Team-planning vocabulary is available for multi-agent task planning.",
      meta: "Planning lane · owner-directed only",
    },
    "phantom-ai-online-fetch": {
      status: "Research held",
      detail: "Online research is kept behind approval and allowlist controls until you deliberately use it.",
      meta: "Held safely · no live fetch by itself",
    },
  };
  if (byId[program?.id]) return { tone: "on", ...byId[program.id] };
  if (["missing", "planned", "unconfigured", "unavailable"].includes(state)) {
    return {
      tone: "on",
      status: "Held safely",
      detail: program?.current_use || program?.intended_role || "This tool is registered and safely held until configured.",
      meta: baseMeta,
    };
  }
  return {
    tone: devTone(state),
    status: String(program?.state || "ready").replace(/_/g, " "),
    detail: program?.current_use || program?.intended_role || "Ready for owner-directed use.",
    meta: baseMeta,
  };
}

function buildDevPrograms(workforce, rembg, mediaHealth) {
  const list = [];
  list.push({
    id: "background-removal", name: "Background Removal", icon: "media",
    tone: "on",
    status: rembg?.available ? "Connected" : "Ready to connect",
    detail: rembg?.available
      ? `Local background removal running via ${rembg.pythonCommand || "python"}${rembg.version ? ` (${rembg.version})` : ""}.`
      : "Local background removal is safely registered. Connect the local worker when you want offline cutouts.",
    meta: rembg?.available && rembg?.checkedAt ? `Checked ${ago(rembg.checkedAt)} · ${rembg.lane || "local"} lane` : "Registered safely · local worker optional",
  });
  const mediaLabReady = !!mediaHealth?.media?.cinematic;
  list.push({
    id: "media-lab", name: "Media Lab", icon: "film",
    tone: "on",
    status: mediaLabReady ? "Connected" : "Guarded",
    detail: mediaLabReady
      ? "AI Edit and generation can run inside PhantomForce."
      : "Media creation stays inside PhantomForce. Live render lanes are approval-gated until connected.",
    meta: null,
  });
  const openaiKeyed = !!mediaHealth?.media?.openai;
  list.push({
    id: "openai", name: "OpenAI", icon: "spark",
    tone: "on",
    status: openaiKeyed ? "Connected" : "Optional",
    detail: openaiKeyed ? "Image-generation key configured on ai-proxy." : "No OpenAI image key is stored here. Phantom uses configured owner lanes and stays private.",
    meta: null,
  });
  list.push({
    id: "fastify", name: "Fastify backend", icon: "cog",
    tone: "on",
    status: workforce ? "Reachable" : "Bridge waiting",
    detail: workforce ? "The real admin backend — sessions, media tools, agent status, every owner-only route." : "Backend lane is registered; status data is waiting on the admin bridge.",
    meta: null,
  });
  list.push({
    id: "ai-proxy", name: "ai-proxy", icon: "cog",
    tone: "on",
    status: mediaHealth?.reachable ? "Reachable" : "Bridge waiting",
    detail: mediaHealth?.reachable
      ? `Chat routing: ${mediaHealth.provider || "unset"}${mediaHealth.model ? ` / ${mediaHealth.model}` : ""}.`
      : "Chat bridge is registered and safely held until the local proxy answers.",
    meta: null,
  });
  (workforce?.programs || []).forEach((p) => {
    const friendly = friendlyProgramStatus(p);
    list.push({
      id: p.id, name: p.display_name, icon: DEV_PROGRAM_ICON[p.id] || "dev",
      tone: friendly.tone,
      status: friendly.status,
      detail: friendly.detail,
      meta: friendly.meta,
    });
  });
  return list;
}

function devTicker(items, esc) {
  if (!items || !items.length) return `<p class="dev-empty">No recent activity yet.</p>`;
  return items.map((item) => `
    <div class="dev-ticker-item">
      <b>${esc(item.label)}</b>
      <span>${esc(item.text)}</span>
      <i>${esc(ago(item.timestamp))}</i>
    </div>`).join("");
}

function animateDevCount(el, target) {
  if (!el) return;
  if (reduceMotion || !Number.isFinite(target)) { el.textContent = String(target); return; }
  const start = performance.now();
  const dur = 900;
  const step = (now) => {
    const p = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = String(Math.round(target * eased));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

let devRefreshTimer = 0;
function wireDeveloperSection(body, opts, localModels = null) {
  const showLaneSaved = () => {
    const saved = body.querySelector("[data-dev-lane-saved]");
    if (!saved) return;
    saved.hidden = false;
    clearTimeout(showLaneSaved._timer);
    showLaneSaved._timer = setTimeout(() => { saved.hidden = true; }, 2200);
  };
  const saveLane = (laneId, patch = {}) => {
    const cfg = loadPhantomLaneConfig();
    const laneDef = PHANTOM_LANES.find((lane) => lane.id === laneId);
    if (!laneDef) return cfg;
    const current = cfg.lanes[laneId] || { target: laneDef.defaultTarget };
    const targetId = patch.target || current.target || laneDef.defaultTarget;
    const target = laneTargetForId(targetId);
    const nextModel = patch.model || (target.id === current.target ? current.model : target.models[0]) || target.models[0];
    cfg.lanes[laneId] = {
      target: target.id,
      model: target.models.includes(nextModel) || (target.allowCustomModel && typeof nextModel === "string" && nextModel.trim()) ? nextModel : target.models[0],
    };
    return savePhantomLaneConfig(cfg);
  };
  body.querySelectorAll("[data-dev-lane-target]").forEach((select) => {
    select.onchange = () => {
      const laneId = select.dataset.devLaneTarget;
      const cfg = saveLane(laneId, { target: select.value });
      const selected = cfg.lanes[laneId];
      const model = body.querySelector(`[data-dev-lane-model="${laneId}"]`);
      if (model) model.innerHTML = laneModelOptions(selected.target, selected.model, localModels);
      const current = body.querySelector(`[data-dev-lane-current="${laneId}"]`);
      if (current) current.textContent = phantomLaneTargetName(selected.target);
      showLaneSaved();
    };
  });
  body.querySelectorAll("[data-dev-lane-model]").forEach((select) => {
    select.onchange = () => {
      const laneId = select.dataset.devLaneModel;
      saveLane(laneId, { model: select.value });
      showLaneSaved();
    };
  });
  body.querySelectorAll("[data-dev-sub-toggle]").forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.devSubToggle;
      const list = body.querySelector(`[data-dev-sub-list="${id}"]`);
      const caret = btn.querySelector("[data-dev-sub-caret]");
      const open = list.hasAttribute("hidden");
      if (open) { list.removeAttribute("hidden"); btn.setAttribute("aria-expanded", "true"); if (caret) caret.textContent = "▾"; }
      else { list.setAttribute("hidden", ""); btn.setAttribute("aria-expanded", "false"); if (caret) caret.textContent = "▸"; }
    };
  });
  const refreshBtn = body.querySelector("[data-dev-refresh]");
  if (refreshBtn) refreshBtn.onclick = () => {
    if (refreshBtn.classList.contains("is-spinning")) return;
    refreshBtn.classList.add("is-spinning");
    loadDeveloperData(body, opts).finally(() => refreshBtn.classList.remove("is-spinning"));
  };
  body.querySelectorAll(".dev-agent-card, .dev-program-card").forEach((card, i) => {
    card.style.animationDelay = `${Math.min(i * 35, 400)}ms`;
  });
}

function renderDeveloperContent(body, { workforce, workforceError, rembg, mediaHealth, providerManager, localModels }, opts) {
  const s = ctx.session || {};
  const w = workforce;
  const summary = w?.summary;
  const nodeTruth = w?.node_truth || {};
  const workers = w?.workers || [];
  const subagents = w?.subagents || [];
  const programs = buildDevPrograms(w, rembg, mediaHealth);
  const generatedAt = summary?.generated_at || new Date().toISOString();

  const routes = [
    ["Owner account", "PhantomForce Owner"],
    ["Session", s.sessionId || "owner-admin"],
    ["Access guard", s.canManageAccess ? "canManageAccess true" : "local owner session"],
    ["Workspace", wsName(currentWs())],
    ["Host", location.hostname || "local"],
    ["Build", document.querySelector('meta[name="phantom-build"]')?.content || "local"],
  ];
  const safety = w
    ? [
        ["Read-only", w.safety_flags.read_only ? "Yes" : "No"],
        ["Provider called", w.safety_flags.provider_called ? "Yes" : "No"],
        ["External call performed", w.safety_flags.external_call_performed ? "Yes" : "No"],
        ["n8n started", w.safety_flags.n8n_started ? "Yes" : "No"],
        ["Workflow executed", w.safety_flags.workflow_executed ? "Yes" : "No"],
        ["Approval executed", w.safety_flags.approval_executed ? "Yes" : "No"],
        ["Production ledger written", w.safety_flags.production_ledger_written ? "Yes" : "No"],
      ]
    : [
        ["Provider calls", "Blocked here"],
        ["Approval execution", "Absent"],
        ["External sends", "Blocked"],
        ["Production ledger writes", "Blocked"],
      ];
  const shortcuts = [
    ["Workers", "workforce", "Worker map, helper lanes, routing, and activity signals."],
    ["Memory", "memory", "Recall rules, preferences, and local context."],
    ["PhantomOps", "adminos", "System status, tool lanes, and owner ops control."],
    ["Approvals", "approvals", "Human approval queue and blocked-action review."],
    ["Settings", "settings", "Media and provider configuration guardrails."],
  ];

  body.innerHTML = `
    <div class="developer-shell dev-shell">
      <section class="developer-hero dev-hero">
        <div>
          <h3>Developer Control Room</h3>
        </div>
        <div class="dev-hero-right">
          <button class="dev-refresh-btn" type="button" data-dev-refresh title="Re-check everything now">
            <span class="dev-refresh-ic">${svg("clock")}</span> <span>Refresh</span>
          </button>
          <p class="dev-updated">Updated ${esc(ago(generatedAt))}</p>
        </div>
      </section>

      <section class="neural-map-panel" data-neural-map aria-label="System neural map"></section>

      ${w ? `
      <section class="dev-stat-row" data-dev-stats>
        <article class="dev-stat"><span data-dev-count="${summary.runtime_active_workers || 0}">0</span><i>Ledger-active categories</i></article>
        <article class="dev-stat"><span data-dev-count="${summary.total_mapped_nodes || summary.total_worker_nodes || (summary.total_workers + summary.subagents_mapped)}">0</span><i>Mapped workers</i></article>
        <article class="dev-stat"><span data-dev-count="${summary.runtime_executable_actions || 0}">0</span><i>Executable safe actions</i></article>
        <article class="dev-stat"><span data-dev-count="${summary.template_generated_nodes || 0}">0</span><i>Mapped subagents</i></article>
        <article class="dev-stat"><span data-dev-count="${summary.tasks_in_window}">0</span><i>Tasks / ${summary.window_hours}h</i></article>
        <article class="dev-stat"><span data-dev-count="${summary.tokens_in_window}">0</span><i>Tokens / ${summary.window_hours}h</i></article>
        <article class="dev-stat"><span class="dev-stat-static">${summary.estimated_cost_usd_in_window.toFixed(4)}</span><i>Est. cost / ${summary.window_hours}h</i></article>
      </section>` : `
      <div class="dev-error-banner">
        <b>Agent status waiting.</b>
        <span>${esc(workforceError || "The admin bridge is not reporting live workforce detail yet.")}</span>
        <button type="button" data-dev-refresh>Refresh</button>
      </div>`}

      ${w ? `
      <section class="dev-section">
        <div class="dev-section-head">
          <h4>${svg("shield")} Workforce reality</h4>
          <p>${esc(nodeTruth.label || summary.truth_label || "Mapped workforce. Helper lanes are contracts, not autonomous running workers.")}</p>
        </div>
        <div class="dev-program-grid">
          <article class="dev-program-card dev-tone-on"><b>${Number(nodeTruth.parent_worker_definitions || summary.parent_worker_definitions || 0).toLocaleString()}</b><p>Lead worker definitions observed through Hermes/tool status.</p></article>
          <article class="dev-program-card dev-tone-warn"><b>${Number(nodeTruth.generated_subagent_instances || summary.generated_subagent_instances || 0).toLocaleString()}</b><p>Mapped subagent plans. They route context and only count as real work when ledger activity exists.</p></article>
          <article class="dev-program-card dev-tone-warn"><b>${Number(nodeTruth.generated_neural_cell_instances || summary.generated_neural_cell_instances || 0).toLocaleString()}</b><p>Helper-lane contracts. They define expected steps and only show activity when a real route records it.</p></article>
          <article class="dev-program-card dev-tone-on"><b>${Number(nodeTruth.runtime_executable_actions || summary.runtime_executable_actions || 0).toLocaleString()}</b><p>Callable admin-safe actions. These are the executable parts of this workforce surface.</p></article>
        </div>
      </section>

      <section class="dev-section">
        <div class="dev-section-head">
          <h4>${svg("users")} Workers &amp; subagents</h4>
          <p>Lead workers plus mapped helper definitions. Runtime task/tokens below come from Hermes ledger matches only; helper lanes do not inherit fake activity.</p>
        </div>
        <div class="dev-agent-grid">
          ${workers.map((worker) => devAgentCard(worker, subagents.filter((sub) => sub.parent === worker.name), esc)).join("")}
        </div>
      </section>` : ""}

      <section class="dev-section">
        <div class="dev-section-head">
          <h4>${svg("bolt")} Integrations &amp; programs</h4>
          <p>Local media tools, PhantomForce backends, and every tool in the workforce registry — checked for real, right now.</p>
        </div>
        <div class="dev-program-grid">
          ${programs.map((p) => devProgramCard(p, esc)).join("")}
        </div>
      </section>

      <section class="dev-section">
        <div class="dev-section-head">
          <h4>${svg("brain")} Provider monitor</h4>
          <p>Stateful failover, background recovery, last health, and latency. This telemetry stays behind the owner curtain.</p>
        </div>
        ${providerManagerMarkup(providerManager)}
      </section>

      <section class="dev-section">
        <div class="dev-section-head">
          <h4>${svg("cog")} Scheduled server jobs</h4>
          <p>Developer-only curtain pull for internal health checks, scheduled job controls, and evidence from the automation engine.</p>
        </div>
        <div data-dev-autopilot></div>
      </section>

      <section class="dev-section">
        <div class="dev-section-head">
          <h4>${svg("bolt")} Agent runs</h4>
          <p>The real server execution lifecycle — start a run, watch its states, and check the artifact and ledger proof it leaves behind.</p>
        </div>
        <div data-dev-agent-runs></div>
      </section>

      ${w ? `
      <section class="dev-section">
        <div class="dev-section-head">
          <h4>${svg("chart")} Live activity</h4>
          <p>The most recent ledger entries — what actually ran, when.</p>
        </div>
        <div class="dev-ticker">${devTicker(w.ticker, esc)}</div>
      </section>` : ""}

      <div class="developer-grid">
        <article class="developer-card">
          <p class="developer-kicker">Identity proof</p>
          <h4>Owner session</h4>
          <div class="developer-list">${routes.map(([k, v]) => `<span><b>${esc(k)}</b><i>${esc(v)}</i></span>`).join("")}</div>
        </article>
        <article class="developer-card">
          <p class="developer-kicker">Safety posture</p>
          <h4>Owner-gated execution only</h4>
          <div class="developer-list">${safety.map(([k, v]) => `<span><b>${esc(k)}</b><i>${esc(v)}</i></span>`).join("")}</div>
        </article>
      </div>

      <section class="developer-card">
        <p class="developer-kicker">Backend identity</p>
        <h4>What each lane actually runs on</h4>
        <p class="set-note">Change the real backend target for each Phantom lane. Saves locally and applies to the next chat request.</p>
        <div class="developer-lane-groups">
          <div class="developer-lane-group developer-lane-group-wide">
            <b>Phantom routing lanes</b>
            <div class="developer-lane-controls">${renderBrainLaneControls(localModels)}</div>
            <p class="developer-lane-saved" data-dev-lane-saved hidden>Saved — next message uses this routing.</p>
          </div>
          <div class="developer-lane-group">
            <b>Phantom Loop targets</b>
            <div class="developer-list">${LOOP_PROVIDERS.map((p) => `<span><b>${esc(p.name)}</b><i>${esc(LOOP_LANE_IDENTITY[p.id] || p.id)}</i></span>`).join("")}</div>
          </div>
          <div class="developer-lane-group">
            <b>Media engines</b>
            <div class="developer-list">${DEFAULT_PROVIDERS.map((p) => `<span><b>${esc(p.name)}</b><i>${esc(MEDIA_ENGINE_IDENTITY[p.id] || p.id)}${p.enabled ? "" : " · coming soon"}</i></span>`).join("")}</div>
          </div>
        </div>
      </section>

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
    </div>`;

  wireDeveloperSection(body, opts, localModels);
  const autopilotMount = body.querySelector("[data-dev-autopilot]");
  if (autopilotMount) renderDeveloperAutopilotPanel(autopilotMount, opts);
  const agentRunsMount = body.querySelector("[data-dev-agent-runs]");
  if (agentRunsMount) renderDeveloperAgentRunsPanel(agentRunsMount, opts);
  if (w) body.querySelectorAll("[data-dev-count]").forEach((el) => animateDevCount(el, Number(el.dataset.devCount)));
}

async function loadDeveloperData(body, opts) {
  const [wfResult, rembg, mediaHealth, providerManager, localModels] = await Promise.all([
    fetchAgentWorkforceStatus(24),
    getRembgStatus(),
    getMediaEngineHealth(),
    fetchProviderManagerStatus(),
    fetchLocalModelStatus(),
  ]);
  if (!document.body.contains(body)) return;
  renderDeveloperContent(body, {
    workforce: wfResult.ok ? wfResult.workforce : null,
    workforceError: wfResult.ok ? null : wfResult.error,
    rembg, mediaHealth, providerManager, localModels,
  }, opts);
  try {
    renderNeuralMap(body.querySelector("[data-neural-map]"), {
      workforce: wfResult.ok ? wfResult.workforce : null,
      providerManager, localModels,
    });
  } catch (err) { /* map is decorative-safe: never break the dev page */ }
}

function developerSkeletonHtml() {
  return `
    <div class="developer-shell dev-shell dev-loading">
      <section class="developer-hero dev-hero">
        <div>
          <h3>Developer Control Room</h3>
          <p>Checking every agent and integration…</p>
        </div>
      </section>
      <div class="dev-skeleton-grid">
        ${Array.from({ length: 6 }).map(() => `<div class="dev-skeleton-card"></div>`).join("")}
      </div>
    </div>`;
}

function renderDeveloperPage(body) {
  clearInterval(devRefreshTimer);
  if (!isOwnerOperator()) {
    body.innerHTML = `
      <div class="developer-denied">
        <p class="developer-kicker">Owner-only</p>
        <h3>Developer access is reserved for the PhantomForce owner account.</h3>
        <p>This surface is hidden from normal client, employee, and admin sessions.</p>
      </div>`;
    return;
  }
  body.innerHTML = developerSkeletonHtml();
  const opts = mediaOpts();
  loadDeveloperData(body, opts);
  devRefreshTimer = setInterval(() => {
    if (!document.body.contains(body) || currentWs() !== "developer") { clearInterval(devRefreshTimer); return; }
    loadDeveloperData(body, opts);
  }, 30000);
}

function renderMediaLabSuite(body) {
  const opts = mediaOpts();
  body.innerHTML = `
      <section class="media-suite" data-media-suite>
        <header class="media-suite-head">
          <div>
            <p class="media-suite-kicker">Creation workspace</p>
            <h2>Media Lab</h2>
            <p>Create and edit here. Finished work moves to Content Hub for planning, publishing, and analytics.</p>
          </div>
          <button class="media-suite-link" data-open-ws="content" type="button">${svg("doc")} Open Content Hub</button>
        </header>
        <div class="media-suite-body" data-media-suite-body></div>
      </section>`;
  const target = $("[data-media-suite-body]", body);
  renderMediaStudio(target, opts);
  $("[data-open-ws='content']", body)?.addEventListener("click", () => opts.openWorkspace?.("content"));
}

function renderAnalyticsSuite(body) {
  body.innerHTML = `
    <div class="analytics-stack">
      <section data-social-analytics-report></section>
      <section data-managed-growth-report></section>
    </div>`;
  renderAnalytics(body.querySelector("[data-social-analytics-report]"), mediaOpts());
  mountManagedGrowthReport(body.querySelector("[data-managed-growth-report]"));
}

const CUSTOM = {
  media: { title: "Media Lab", kicker: "Create and edit", custom: true, wide: true, render: (body) => renderMediaLabSuite(body) },
  sites: { title: "Websites", kicker: "Websites by domain", custom: true, wide: true, render: (body) => renderSiteStudio(body, mediaOpts()) },
  content: { title: "Content Hub", kicker: "Library, ideas, drafts, publishing, and performance", custom: true, wide: true, render: (body) => renderContentHub(body, mediaOpts()) },
  assets: { title: "Asset Cloud", kicker: "Your business's creative memory", custom: true, wide: true, render: (body) => renderAssetCloud(body) },
  phantomplay: { title: "PhantomPlay", kicker: "Intentional downtime and approved games", custom: true, wide: true, render: (body) => (phantomPlayV2Opted() ? renderPhantomPlayV2 : renderPhantomPlay)(body, mediaOpts()) },
  phantomstore: { title: "PhantomStore", kicker: "AI marketplace", custom: true, wide: true, render: (body) => renderPhantomStore(body, mediaOpts()) },
  intelligence: { title: "Competitor Intelligence", kicker: "Public signals, labeled estimates, and original responses", custom: true, wide: true, render: (body) => renderCompetitorIntelligence(body, mediaOpts()) },
  analytics: { title: "Analytics", kicker: "Signals, trends, and operating insight", custom: true, wide: true, render: (body) => renderAnalyticsSuite(body) },
  account: { title: "Business Profile & Plan", kicker: "Profile, billing, and access", custom: true, render: (body) => renderAccountPlan(body) },
  clientsetup: { title: "Business Manager Settings", kicker: "Workspace and organization setup", custom: true, render: (body) => renderOperatorSettings(body, { ...mediaOpts(), initialTab: "clientsetup", onWorkspaceApplied: () => { refreshCustomizedNavigation(); void refreshNavEntitlements(); renderMobileBottomNav(); } }) },
  developer: { title: "Developer", kicker: "Owner controls", custom: true, wide: true, ownerOnly: true, render: (body) => renderDeveloperPage(body) },
  settings: { title: "Business Manager Settings", kicker: "Brain, memory, routing, and safety configuration", custom: true, render: (body) => renderOperatorSettings(body, { ...mediaOpts(), onWorkspaceApplied: () => { refreshCustomizedNavigation(); void refreshNavEntitlements(); renderMobileBottomNav(); } }) },
  automation: { title: "Automations", kicker: "Business workflows — approval-gated", custom: true, wide: true, render: (body) => renderAutomation(body, mediaOpts()) },
  vacation: { title: "Away Mode", kicker: "Your business stays covered while you are away", custom: true, wide: true, render: (body) => renderVacationMode(body, mediaOpts()) },
  promptlibrary: { title: "Prompt Library", kicker: "Saved prompts, ready to reuse", custom: true, wide: true, render: (body) => renderPromptLibrary(body, mediaOpts()) },
  customize: { title: "Workspace Studio", kicker: "Make this organization feel purpose-built", custom: true, wide: true, adminOnly: true, render: (body) => renderOperatorSettings(body, { ...mediaOpts(), initialTab: "workspace", onWorkspaceApplied: () => { refreshCustomizedNavigation(); void refreshNavEntitlements(); renderMobileBottomNav(); } }) },
  /* The full worker roster + telemetry + live tail log — kept out of the
     dashboard's permanent layout (that only shows a compact summary) and
     opened on demand from "View all activity". */
  activity: { title: "Activity", kicker: "Full PhantomWire feed — workers, telemetry, and live log", custom: true, wide: true, render: (body) => { body.innerHTML = `<div class="agentops"></div>`; mountAgentConsole(body.firstElementChild); } },
  /* The one Phantom AI surface: Chat, Memory, and Activity as tabs over the
     same three existing implementations. phantomai.js owns tab switching and
     all three tabs' wiring; this just renders the markup its contract
     expects and hands it the root. */
  phantomai: {
    title: "Phantom AI",
    kicker: "Chat, memory, and the live activity feed in one place",
    custom: true,
    wide: true,
    render: (body) => {
      body.innerHTML = `
        <div class="phantomai">
          <div class="phantomai-tabs" role="tablist" aria-label="Phantom AI">
            <button type="button" class="phantomai-tab" data-phantomai-tab="chat" role="tab" aria-selected="true">Chat</button>
            <button type="button" class="phantomai-tab" data-phantomai-tab="memory" role="tab" aria-selected="false">Memory</button>
            <button type="button" class="phantomai-tab" data-phantomai-tab="activity" role="tab" aria-selected="false">Activity</button>
          </div>
          <div class="phantomai-pane" data-phantomai-pane="chat">
            <div class="phantomai-chat" data-phantomai-chat-mount>
              <div class="phantomai-chat-log" data-phantomai-chat-log></div>
              <form class="phantomai-chat-form" data-phantomai-chat-form>
                <input class="phantomai-chat-input" data-phantomai-chat-input type="text" autocomplete="off" placeholder="Ask Phantom anything..." aria-label="Message Phantom AI" />
                <button class="btn" type="submit">Send</button>
              </form>
            </div>
          </div>
          <div class="phantomai-pane" data-phantomai-pane="memory" hidden>
            <div class="phantomai-memory-mount" data-phantomai-memory-mount></div>
          </div>
          <div class="phantomai-pane" data-phantomai-pane="activity" hidden>
            <div class="phantomai-activity-mount" data-phantomai-activity-mount></div>
          </div>
        </div>`;
      mountPhantomAI(body.firstElementChild);
    },
  },
};

let openId = null;
function workspaceDef(id) {
  const key = workspaceId(id);
  return CUSTOM[key] || WORKSPACE_DEFS[key] || null;
}
function navForWorkspace(id) {
  const key = workspaceId(id);
  const parentId = NAV_PARENT_BY_WORKSPACE[key];
  return NAV.find((n) => n.id === activeNav && (n.ws === key || n.id === parentId) && canAccessSurface(n))
    || NAV.find((n) => n.ws === key && canAccessSurface(n))
    || NAV.find((n) => n.id === parentId && canAccessSurface(n))
    || null;
}
function clearOverlayOnly() {
  openId = null;
  overlayRoot.innerHTML = "";
  document.body.classList.remove("overlay-open");
}
/* Build staleness watchdog: the sync script records its outcome in the
   served manifest. If this machine stopped updating (blocked sync or no
   sync in 24h), owners see WHY in the product instead of silently living
   on an old build. Admin-only; missing manifest (fresh checkout, GitHub
   Pages) shows nothing. */
let syncBannerShown = false;
async function checkBuildFreshness() {
  if (syncBannerShown || !isAdmin()) return;
  let manifest = null;
  try {
    const response = await fetch("/app/.phantomforce-sync.json", { cache: "no-store" });
    if (!response.ok) return;
    manifest = await response.json();
  } catch { return; }
  if (!manifest || typeof manifest !== "object") return;
  const syncedAt = Date.parse(manifest.synced_at || "");
  const staleMs = Number.isFinite(syncedAt) ? Date.now() - syncedAt : 0;
  const blocked = manifest.sync_status === "blocked";
  const stale = staleMs > 24 * 60 * 60 * 1000;
  if (!blocked && !stale) return;
  syncBannerShown = true;
  const bar = document.createElement("div");
  bar.className = "build-stale-banner";
  bar.setAttribute("role", "alert");
  const when = Number.isFinite(syncedAt) ? new Date(syncedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "unknown";
  bar.innerHTML = `<b>${blocked ? "Updates are blocked on this computer" : "This computer hasn't updated recently"}</b>
    <span>${esc(String(manifest.sync_reason || `Last successful sync: ${when}. Check the sync log if this persists.`))}</span>
    <button type="button" aria-label="Dismiss">&times;</button>`;
  bar.querySelector("button").onclick = () => bar.remove();
  document.body.prepend(bar);
}

function renderDashboardPage(pushHash = true) {
  activePageId = null;
  activeNav = "dashboard";
  markNavTabOpen("dashboard");
  clearOverlayOnly();
  ensureDashboardShell();
  setGhostMood("idle", { emotion: "happy", ms: 1200 });
  stageReact("dashboard", 520);
  renderConsole();
  checkBuildFreshness();
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
  if (navHit) {
    activeNav = navHit.id;
    markNavTabOpen(navHit.id);
  }
  activePageId = key;
  clearOverlayOnly();
  root.className = `console console-workspace ${def.wide ? "console-workspace-wide" : ""}`.trim();
  root.dataset.consoleView = "workspace";
  root.dataset.pageWs = key;
  const entering = lastEnteredPageKey !== key;
  const workspaceFirst = !!(def.custom && def.wide);
  lastEnteredPageKey = key;
  root.innerHTML = `
    <section class="workspace-page ${def.wide ? "workspace-page-wide" : ""} ${workspaceFirst ? "workspace-page-first" : ""} ${entering ? "page-enter" : ""}" data-workspace-page="${esc(key)}">
      ${workspaceFirst ? "" : `<header class="workspace-page-head">
        <div>
          <p class="workspace-page-kicker">${esc(def.kicker)}${!def.custom && isAdmin() && currentWs() !== "phantomforce" ? ` · ${esc(wsName(currentWs()))}` : ""}</p>
          <h1>${esc(def.title)}</h1>
        </div>
      </header>`}
      ${key === "phantomplay" ? "" : pageWorkerHtml(key, def)}
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
    mountPageWorkers(root, mediaOpts());
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
  const navHit = navForWorkspace(key);
  if (navHit) activeNav = navHit.id;
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
        ${key === "phantomplay" ? "" : pageWorkerHtml(key, def)}
        <div class="overlay-body" data-overlay-body></div>
      </section>
    </div>`;
  const body = $("[data-overlay-body]", overlayRoot);
  const rerender = () => {
    if (def.custom) def.render(body);
    else { def.render(body, rerender); if (key === "phantom") wirePhantomConsole(body); }
    mountPageWorkers(overlayRoot, mediaOpts());
  };
  rerender();
  overlayRoot.querySelectorAll("[data-overlay-close]").forEach((b) => b.addEventListener("click", () => closeOverlay(true)));
  if (pushHash && location.hash !== `#ws/${key}`) {
    try { history.pushState(null, "", `#ws/${key}`); } catch {}
  }
  renderNav();
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
  const hit = navForWorkspace(openId);
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
      </div>`).join("") || `<p class="phantom-hello">This is the full command console. Everything you ask is classified first: answers stay answers, commands become guarded work, and external actions stay approval-gated.</p>`;
    bindCardRemovers(log, (entryIndex, cardIndex) => {
      const cards = phantomHistory[entryIndex]?.cards;
      if (!cards) return;
      cards.splice(cardIndex, 1);
      paint();
    });
    log.scrollTop = log.scrollHeight;
  };
  paint();
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = input.value.trim();
    if (!v) return;
    input.value = "";
    const r = await handleSmartCommand(v).catch(() => handleCommand(v));
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
  if (!ghostStarted) {
    ghostStarted = true;
    initPhantom3D(); initGhost(); startClock();
    mountAmbient();
    // the buddy wakes after the boot reveal so it doesn't fight the intro
    setTimeout(() => mountBuddy(), 1600);
  }
  activeNav = "dashboard";
  renderConsole();
  loadOrganizationCustomization({
    onApplied: () => {
      refreshCustomizedNavigation();
      renderNav();
      renderMobileBottomNav();
      renderStatusPills();
      renderUser();
    },
  });
  void refreshNavEntitlements();
  requestAnimationFrame(() => phantom.classList.add("booted"));
  const q = new URLSearchParams(location.search);
  const view = (q.get("view") || "").toLowerCase();
  const page = location.hash.match(/^#page\/([a-z-]+)/);
  const m = location.hash.match(/^#ws\/([a-z-]+)/);
  if (page && workspaceDef(page[1])) renderWorkspacePage(page[1], false);
  else if (m && workspaceDef(m[1])) routeWorkspace(m[1], false);
  else if (view && view !== "command" && workspaceDef(view)) routeWorkspace(view, false);
  // a data-driven spoken briefing once the reveal settles
  if (briefingTimer) clearTimeout(briefingTimer);
  briefingTimer = setTimeout(() => {
    briefingTimer = 0;
    phantomBootSettled = true;
    setGhostMood("idle", { emotion: "happy" });
    if (!phantomHasActed && chatHistory.length <= 1 && !openId && !activePageId) {
      speak(briefingText(), "", "bright");
    }
  }, 1400);
}

async function boot() {
  ctx.session = isLiveAdminHost() ? await verifyLiveSession() : resolveSession();
  wireDeck();
  initCommandOS();
  store.onChange(() => {
    if (!phantom.hidden) {
      if (activePageId) { renderConsole(); return; }
      renderNav(); renderStatusPills(); renderNotifs();
      renderFlowMap(); renderFlowCompactSummary(); renderPlan(); renderQueue(); renderDashWidgets(); renderOrganizationPulse();
    }
  });
  if (ctx.session) enterPhantom();
  else showGate();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
