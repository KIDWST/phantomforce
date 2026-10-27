/* Account failures are public copy, never a serialization of server internals. */
const ACTIONS = Object.freeze({
  login: "sign you in", twoFactor: "verify your 2FA code", signup: "create your account",
  username: "recover your username", passwordRequest: "request a password reset",
  passwordReset: "reset your password", invitation: "accept this invitation",
  security: "update two-factor authentication",
});
const unavailable = action => `The account service could not ${ACTIONS[action] || "complete this request"}. Try again in a moment.`;

// Error envelopes vary: ordinary routes use a string, Fastify uses message,
// and validation uses an object. Only known public conditions affect copy.
function condition(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  return [payload.error, payload.message, payload.code, payload.error?.code, payload.error?.message]
    .filter(value => typeof value === "string").join(" ").toLowerCase();
}

export function accountErrorMessage(status, payload, action = "login") {
  const detail = condition(payload);
  if (status === 0) return "The account service could not be reached. Check your connection and try again.";
  if (status >= 500 || [404, 405, 408].includes(status)) return unavailable(action);
  if (/database auth is disabled|login is not enabled|auth_unavailable|database_unavailable/.test(detail)) return unavailable(action);
  if (status === 429) return "Too many account attempts. Wait a moment, then try again.";
  if (status === 401) return action === "login" ? "Invalid email or password."
    : action === "twoFactor" ? "Invalid or expired 2FA code." : "This account request could not be verified. Try again or sign in again.";
  if (action === "invitation" && status === 400 && /expired|invalid|accepted/.test(detail)) return "This invitation link is invalid, expired, or already used. Ask the workspace owner for a new invitation.";
  if (status === 409 && action === "signup") return "An account with those details already exists. Try signing in or use account recovery.";
  if (status === 403) return action === "login" ? "This account does not have access here. Use an account with access or contact your administrator."
    : "This account action is not permitted. Sign in with an account that has access.";
  if (status === 400 || status === 422) return action === "login" ? "Check your email or username and password, then try again."
    : action === "twoFactor" ? "Enter the current code from your authenticator app."
      : "Check the account details you entered, then try again.";
  return unavailable(action);
}

const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const identifier = value => typeof value === "string" && value.length > 0 && value.length <= 240 && !/[\s\x00-\x1f\x7f]/.test(value);
const invalidResponse = () => new Error("The account service returned an incomplete sign-in response. Please try again.");

/** Validate before storing anything. A successful HTTP status is not a session. */
export function accountSignInResult(payload, { allowChallenge = true } = {}) {
  if (!record(payload) || payload.ok !== true || (payload.requires2fa !== undefined && typeof payload.requires2fa !== "boolean")) throw invalidResponse();
  if (payload.requires2fa === true) {
    if (!allowChallenge || !identifier(payload.challengeToken) || payload.challengeToken.length < 10
      || payload.token !== undefined || payload.session !== undefined
      || (payload.expiresAt !== undefined && (typeof payload.expiresAt !== "string" || !Number.isFinite(Date.parse(payload.expiresAt))))) throw invalidResponse();
    return { requires2fa: true, challengeToken: payload.challengeToken, expiresAt: payload.expiresAt, user: payload.user };
  }
  const account = payload.session;
  if (typeof payload.token !== "string" || payload.token.length < 10 || payload.token.length > 16_384 || /\s|[\x00-\x1f\x7f]/.test(payload.token)
    || !record(account) || !identifier(account.id)
    || ["canManageAccess", "isSuperAdmin"].some(key => account[key] !== undefined && typeof account[key] !== "boolean")
    || (account.orgId !== undefined && account.orgId !== null && !identifier(account.orgId))
    || (account.orgRole !== undefined && account.orgRole !== null && typeof account.orgRole !== "string")
    || (account.memberships !== undefined && (!Array.isArray(account.memberships) || account.memberships.some(member => !record(member) || !identifier(member.orgId))))) throw invalidResponse();
  return payload;
}
