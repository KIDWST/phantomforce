/* PhantomForce companion preferences.
   Local UI controls only: no sends, uploads, provider calls, or public actions. */

export const COMPANION_PREF_KEY = "pf.companion.preferences.v1";
export const COMPANION_EVENT = "phantom:companion-preferences";
const SESSION_HIDE_KEY = "pf.companion.hidden.session.v1";

export const DEFAULT_COMPANION_PREFS = {
  enabled: true,
  visible: true,
  startDocked: true,
  roamingEnabled: false,
  motionLevel: "subtle",
  soundEnabled: false,
  voiceEnabled: false,
  speechEnabled: true,
  notificationReactions: true,
  greetingEnabled: true,
  greetingFrequency: "session",
  size: "standard",
  dockLocation: "sidebar",
  personality: "playful",
  idleFrequency: "low",
  particleLevel: "low",
};

const bool = (value, fallback) => typeof value === "boolean" ? value : fallback;
const choice = (value, allowed, fallback) => allowed.includes(value) ? value : fallback;

export function normalizeCompanionPrefs(value) {
  const input = value && typeof value === "object" ? value : {};
  return {
    ...DEFAULT_COMPANION_PREFS,
    ...input,
    enabled: bool(input.enabled, DEFAULT_COMPANION_PREFS.enabled),
    visible: bool(input.visible, DEFAULT_COMPANION_PREFS.visible),
    startDocked: bool(input.startDocked, DEFAULT_COMPANION_PREFS.startDocked),
    roamingEnabled: false,
    soundEnabled: bool(input.soundEnabled, DEFAULT_COMPANION_PREFS.soundEnabled),
    voiceEnabled: bool(input.voiceEnabled, DEFAULT_COMPANION_PREFS.voiceEnabled),
    speechEnabled: bool(input.speechEnabled, DEFAULT_COMPANION_PREFS.speechEnabled),
    notificationReactions: bool(input.notificationReactions, DEFAULT_COMPANION_PREFS.notificationReactions),
    greetingEnabled: bool(input.greetingEnabled, DEFAULT_COMPANION_PREFS.greetingEnabled),
    motionLevel: choice(input.motionLevel, ["full", "subtle", "reduced", "none"], DEFAULT_COMPANION_PREFS.motionLevel),
    greetingFrequency: choice(input.greetingFrequency, ["session", "daily", "off"], DEFAULT_COMPANION_PREFS.greetingFrequency),
    size: choice(input.size, ["compact", "standard", "large"], DEFAULT_COMPANION_PREFS.size),
    dockLocation: "sidebar",
    personality: choice(input.personality, ["professional", "friendly", "playful", "quiet"], DEFAULT_COMPANION_PREFS.personality),
    idleFrequency: choice(input.idleFrequency, ["low", "normal", "off"], DEFAULT_COMPANION_PREFS.idleFrequency),
    particleLevel: choice(input.particleLevel, ["low", "normal", "off"], DEFAULT_COMPANION_PREFS.particleLevel),
  };
}

export function loadCompanionPrefs() {
  try {
    return normalizeCompanionPrefs(JSON.parse(localStorage.getItem(COMPANION_PREF_KEY) || "{}"));
  } catch {
    return normalizeCompanionPrefs({});
  }
}

export function saveCompanionPrefs(next) {
  const prefs = normalizeCompanionPrefs(next);
  try { localStorage.setItem(COMPANION_PREF_KEY, JSON.stringify(prefs)); } catch {}
  try { window.dispatchEvent(new CustomEvent(COMPANION_EVENT, { detail: prefs })); } catch {}
  return prefs;
}

export function updateCompanionPrefs(patch) {
  return saveCompanionPrefs({ ...loadCompanionPrefs(), ...(patch || {}) });
}

export function resetCompanionPrefs() {
  try { sessionStorage.removeItem(SESSION_HIDE_KEY); } catch {}
  return saveCompanionPrefs(DEFAULT_COMPANION_PREFS);
}

export function hideCompanionForSession() {
  try { sessionStorage.setItem(SESSION_HIDE_KEY, "1"); } catch {}
  try { window.dispatchEvent(new CustomEvent(COMPANION_EVENT, { detail: loadCompanionPrefs() })); } catch {}
}

export function clearCompanionSessionHide() {
  try { sessionStorage.removeItem(SESSION_HIDE_KEY); } catch {}
  try { window.dispatchEvent(new CustomEvent(COMPANION_EVENT, { detail: loadCompanionPrefs() })); } catch {}
}

export function isCompanionHiddenForSession() {
  try { return sessionStorage.getItem(SESSION_HIDE_KEY) === "1"; } catch { return false; }
}
