/* Shared account access on the canonical app. Choosing Admin changes the
   sign-in destination, never the account's server-verified authority. */
import { ctx, session, ownerLogin } from "./store.js?v=phantom-live-20261026-245";
import {
  fetchAuthConfig, databaseLogin, databaseLogout, databaseSignup,
  databaseForgotUsername, databaseForgotPassword, databaseResetPassword,
  databaseAcceptInvitation, databaseVerify2fa,
} from "./orgs.js?v=phantom-live-20261026-245";

const esc = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
export const hasPlatformAdminAccess = account => account?.role === "admin"
  && (account.canManageAccess === true || (account.database === true && account.isSuperAdmin === true));

function renderInternalAdminAuthLoading(card, message) {
  card.innerHTML = `<p class="gate-kicker">PHANTOMFORCE · ADMIN ACCESS</p><h1>Admin sign-in.</h1><p class="gate-note">${esc(message)}</p>`;
}
function renderCustomerAuthBlocked(card, message) {
  card.innerHTML = `<p class="gate-kicker">PHANTOMFORCE · ACCOUNT ACCESS</p><h1>Sign in to PhantomForce.</h1><p class="gate-error">${esc(message)}</p><p class="gate-note">Customer and admin access are available here once the account system responds.</p>`;
}

export function mountAccountAccessGate({ card, gate, onEnter, workspaceProfileChoices, normalizeWorkspaceProfile, saveWorkspaceProfile, ...options }) {
  const { customerApp = false, internalAdmin = false, required = false, attempt = 0 } = options;
  const retryAuthUpgrade = (message) => {
    if (!required || gate.hidden) return false;
    if (internalAdmin) {
      renderInternalAdminAuthLoading(card, message);
    } else {
      renderCustomerAuthBlocked(card, message);
    }
    if (attempt >= 20) return true;
    window.setTimeout(() => mountAccountAccessGate({ card, gate, onEnter, workspaceProfileChoices, normalizeWorkspaceProfile, saveWorkspaceProfile, ...options, attempt: attempt + 1 }), 3000);
    return true;
  };
  fetchAuthConfig({ refresh: attempt > 0 }).then((auth) => {
    if (gate.hidden) return;
    const databaseUsable = auth?.databaseAuthEnabled === true && auth?.databaseReachable !== false;
    const customerEnabled = !!(auth?.customerAuthEnabled || databaseUsable);
    const ownerEnabled = auth?.ownerProductionAuthEnabled === true;
    if (!customerEnabled && !ownerEnabled) {
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
      access: internalAdmin || !customerEnabled ? "admin" : initialMode === "signin" && new URLSearchParams(location.search).get("access") === "admin" ? "admin" : "",
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
    const setError = (msg) => {
      const error = card.querySelector("[data-db-error]");
      if (!error) return;
      error.textContent = msg || "";
      error.hidden = !msg;
    };
    const doEnter = async (nextSession) => {
      if ((internalAdmin || state.access === "admin") && !hasPlatformAdminAccess(nextSession)) {
        void databaseLogout();
        session.clear(); ctx.session = null;
        state.mode = "signin"; state.challenge = null; state.message = "";
        render();
        throw new Error("This account does not have PhantomForce admin access. Use Customer sign-in or your administrator account.");
      }
      ctx.session = nextSession;
      onEnter();
    };
    const render = () => {
      const adminIntent = internalAdmin || state.access === "admin";
      const ownerCredentials = adminIntent && ownerEnabled && !databaseUsable;
      const helper = adminIntent ? "Your administrator account opens the full command center and admin tools." : "Your verified account opens its workspaces and permitted tools.";
      const note = adminIntent ? "Use your existing PhantomForce administrator account. Admin access is verified after sign-in." : "Customer and administrator accounts use this same website. Choose Admin sign-in for the full console.";
      const accountChoices = !internalAdmin ? `<div class="auth-tabs auth-tabs-primary" role="group" aria-label="Sign-in access"><button type="button" class="auth-tab ${state.access === "customer" ? "is-active" : ""}" data-auth-access="customer" aria-pressed="${state.access === "customer"}" ${customerEnabled ? "" : 'disabled title="Customer sign-in is not enabled on this installation"'}>Customer sign-in</button><button type="button" class="auth-tab ${adminIntent ? "is-active" : ""}" data-auth-access="admin" aria-pressed="${adminIntent}">Admin sign-in</button></div>` : "";
      const tab = (id, label) => `<button type="button" class="auth-tab ${state.mode === id ? "is-active" : ""}" data-auth-mode="${id}">${label}</button>`;
      const msg = state.message ? `<p class="gate-note">${esc(state.message)}</p>` : "";
      if (internalAdmin && !["signin", "2fa"].includes(state.mode)) state.mode = "signin";
      if (!customerEnabled && !["signin", "2fa"].includes(state.mode)) state.mode = "signin";
      if ((!customerEnabled || adminIntent) && ["signup", "invite"].includes(state.mode)) state.mode = "signin";
      const body = state.mode === "invite" && !internalAdmin ? `
        <form class="owner-login" data-auth-form="invite">
          <label><span>Your name</span><input name="name" autocomplete="name" placeholder="Your name" /></label>
          <label><span>Create a password</span><input type="password" name="password" autocomplete="new-password" minlength="8" placeholder="At least 8 characters" /></label>
          <button class="gate-opt gate-submit" type="submit"><span class="gate-opt-icon">+</span><b>Join workspace</b><i>This invitation can only be accepted once.</i></button>
        </form>` : state.mode === "signup" && !adminIntent ? `
        <form class="owner-login" data-auth-form="signup">
          <fieldset class="workspace-choice-field">
            <legend>What workspace do you want?</legend>
            <div class="workspace-choice-grid">${workspaceProfileChoices("business")}</div>
          </fieldset>
          <label><span>Email</span><input type="email" name="email" autocomplete="email" placeholder="you@business.com" required /></label>
          <label><span>Username</span><input name="username" autocomplete="username" placeholder="yourname" minlength="3" maxlength="32" /></label>
          <label><span>Name</span><input name="name" autocomplete="name" placeholder="Your name" /></label>
          <label><span>Workspace name</span><input name="organizationName" placeholder="Optional" /></label>
          <label><span>Password</span><input type="password" name="password" autocomplete="new-password" minlength="8" required /></label>
          <button class="gate-opt gate-submit" type="submit"><span class="gate-opt-icon">＋</span><b>Create account</b><i>Starts your workspace on Basic.</i></button>
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
          <label><span>${ownerCredentials ? "Admin email" : "Email or username"}</span><input ${ownerCredentials ? 'type="email"' : ""} name="identifier" autocomplete="username" placeholder="${ownerCredentials ? "you@business.com" : "you@business.com or username"}" autofocus required /></label>
          <label><span>Password</span><input type="password" name="password" autocomplete="current-password" placeholder="Password" required /></label>
          <button class="gate-opt gate-submit" type="submit"><span class="gate-opt-icon">⌘</span><b>${adminIntent ? "Open admin console" : state.access === "customer" ? "Open customer workspace" : "Sign in"}</b><i>${helper}</i></button>
        </form>`;
      card.innerHTML = `
        <p class="gate-kicker">PHANTOMFORCE · ${adminIntent ? "ADMIN ACCESS" : "ACCOUNT ACCESS"}</p>
        <h1>${state.mode === "invite" ? "Join your workspace." : state.mode === "signup" ? "Create your Phantom account." : state.mode === "2fa" ? "Enter your 2FA code." : state.mode === "forgot-user" ? "Recover your username." : state.mode === "forgot-pass" ? "Reset your password." : state.mode === "reset-pass" ? "Choose a new password." : adminIntent ? "Admin sign-in." : state.access === "customer" ? "Customer sign-in." : "Sign in to PhantomForce."}</h1>
        ${accountChoices}
        ${internalAdmin || adminIntent || !customerEnabled || state.mode === "invite" ? "" : `<div class="auth-tabs auth-tabs-primary">${tab("signin", "Sign in")}${tab("signup", "Create account")}</div>`}
        ${body}
        <p class="gate-error" data-db-error hidden></p>
        ${msg}
        ${state.mode === "signin" && !internalAdmin && customerEnabled ? `<div class="auth-links"><button type="button" data-auth-mode="forgot-user">Forgot username?</button><button type="button" data-auth-mode="forgot-pass">Forgot password?</button></div>` : ""}
        ${!["signin", "signup"].includes(state.mode) ? `<div class="auth-links"><button type="button" data-auth-mode="signin">${state.mode === "2fa" ? "Use another account" : "Back to sign in"}</button></div>` : ""}
        <p class="gate-note">${note}</p>`;
      card.querySelectorAll("[data-auth-access]").forEach((button) => {
        button.onclick = () => {
          if (state.busy || button.disabled) return;
          state.access = button.dataset.authAccess; state.mode = "signin"; state.challenge = null; state.message = "";
          try {
            const url = new URL(location.href);
            if (state.access === "admin") url.searchParams.set("access", "admin");
            else url.searchParams.delete("access");
            history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
          } catch { /* The selection still works if this browser restricts history. */ }
          render(); card.querySelector('input[name="identifier"]')?.focus();
        };
      });
      card.querySelectorAll("[data-auth-mode]").forEach((btn) => {
        btn.onclick = () => { if (state.busy) return; state.mode = btn.dataset.authMode; state.challenge = null; state.message = ""; render(); };
      });
      card.querySelectorAll('input[name="workspaceProfile"]').forEach((input) => {
        input.onchange = () => {
          card.querySelectorAll(".workspace-choice").forEach((choice) => {
            choice.classList.toggle("is-selected", choice.contains(input));
          });
        };
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
      card.querySelectorAll("button, input").forEach((control) => { control.disabled = true; });
      try {
        if (state.mode === "signin") {
          const identifier = String(data.get("identifier") || "").trim();
          const password = String(data.get("password") || "");
          const nextSession = !databaseUsable && ownerEnabled && (internalAdmin || state.access === "admin")
            ? await ownerLogin(identifier, password)
            : await databaseLogin(identifier, password);
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
          const workspaceProfile = normalizeWorkspaceProfile(String(data.get("workspaceProfile") || "business"));
          const signup = await databaseSignup({
            email: String(data.get("email") || "").trim(),
            username: String(data.get("username") || "").trim() || undefined,
            name: String(data.get("name") || "").trim() || undefined,
            organizationName: String(data.get("organizationName") || "").trim() || undefined,
            password: String(data.get("password") || ""),
            workspaceProfile,
          });
          saveWorkspaceProfile(signup?.workspaceProfile || workspaceProfile);
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
        card.querySelectorAll("button, input").forEach((control) => { control.disabled = false; });
        if (!customerEnabled) card.querySelector('[data-auth-access="customer"]')?.setAttribute("disabled", "");
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
