/* PhantomForce companion preferences.
   Local UI controls only: no sends, uploads, provider calls, or public actions. */

export const COMPANION_PREF_KEY = "pf.companion.preferences.v1";
export const COMPANION_EVENT = "phantom:companion-preferences";
export const COMPANION_PLACEMENT_KEY = "pf.companion.pagePlacements.v1";
const SESSION_HIDE_KEY = "pf.companion.hidden.session.v1";
const SESSION_HIDE_MS = 30 * 60 * 1000;

export const DEFAULT_COMPANION_PREFS = {
  version: 2,
  enabled: true,
  visible: true,
  startDocked: false,
  roamingEnabled: true,
  rememberPagePositions: true,
  motionLevel: "subtle",
  soundEnabled: false,
  voiceEnabled: false,
  speechEnabled: true,
  notificationReactions: true,
  greetingEnabled: true,
  greetingFrequency: "session",
  size: "standard",
  dockLocation: "bottom-left",
  personality: "friendly",
  idleFrequency: "low",
  particleLevel: "low",
};

const bool = (value, fallback) => typeof value === "boolean" ? value : fallback;
const choice = (value, allowed, fallback) => allowed.includes(value) ? value : fallback;

export function normalizeCompanionPrefs(value) {
  const input = value && typeof value === "object" ? value : {};
  const migrated = input.version === DEFAULT_COMPANION_PREFS.version
    ? input
    : {
        ...input,
        startDocked: false,
        roamingEnabled: true,
        rememberPagePositions: true,
        dockLocation: input.dockLocation === "sidebar" ? "bottom-left" : input.dockLocation,
      };
  return {
    ...DEFAULT_COMPANION_PREFS,
    ...migrated,
    version: DEFAULT_COMPANION_PREFS.version,
    enabled: bool(migrated.enabled, DEFAULT_COMPANION_PREFS.enabled),
    visible: bool(migrated.visible, DEFAULT_COMPANION_PREFS.visible),
    startDocked: bool(migrated.startDocked, DEFAULT_COMPANION_PREFS.startDocked),
    roamingEnabled: bool(migrated.roamingEnabled, DEFAULT_COMPANION_PREFS.roamingEnabled),
    rememberPagePositions: bool(migrated.rememberPagePositions, DEFAULT_COMPANION_PREFS.rememberPagePositions),
    soundEnabled: bool(migrated.soundEnabled, DEFAULT_COMPANION_PREFS.soundEnabled),
    voiceEnabled: bool(migrated.voiceEnabled, DEFAULT_COMPANION_PREFS.voiceEnabled),
    speechEnabled: bool(migrated.speechEnabled, DEFAULT_COMPANION_PREFS.speechEnabled),
    notificationReactions: bool(migrated.notificationReactions, DEFAULT_COMPANION_PREFS.notificationReactions),
    greetingEnabled: bool(migrated.greetingEnabled, DEFAULT_COMPANION_PREFS.greetingEnabled),
    motionLevel: choice(migrated.motionLevel, ["full", "subtle", "reduced", "none"], DEFAULT_COMPANION_PREFS.motionLevel),
    greetingFrequency: choice(migrated.greetingFrequency, ["session", "daily", "off"], DEFAULT_COMPANION_PREFS.greetingFrequency),
    size: choice(migrated.size, ["compact", "standard", "large"], DEFAULT_COMPANION_PREFS.size),
    dockLocation: choice(migrated.dockLocation, ["bottom-left", "bottom-right", "sidebar"], DEFAULT_COMPANION_PREFS.dockLocation),
    personality: choice(migrated.personality, ["professional", "friendly", "playful", "quiet"], DEFAULT_COMPANION_PREFS.personality),
    idleFrequency: choice(migrated.idleFrequency, ["low", "normal", "off"], DEFAULT_COMPANION_PREFS.idleFrequency),
    particleLevel: choice(migrated.particleLevel, ["low", "normal", "off"], DEFAULT_COMPANION_PREFS.particleLevel),
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
  try { sessionStorage.setItem(SESSION_HIDE_KEY, String(Date.now())); } catch {}
  try { window.dispatchEvent(new CustomEvent(COMPANION_EVENT, { detail: loadCompanionPrefs() })); } catch {}
}

export function clearCompanionSessionHide() {
  try { sessionStorage.removeItem(SESSION_HIDE_KEY); } catch {}
  try { window.dispatchEvent(new CustomEvent(COMPANION_EVENT, { detail: loadCompanionPrefs() })); } catch {}
}

export function isCompanionHiddenForSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_HIDE_KEY);
    if (!raw) return false;
    const hiddenAt = Number(raw);
    if (!Number.isFinite(hiddenAt)) {
      sessionStorage.removeItem(SESSION_HIDE_KEY);
      return false;
    }
    if (Date.now() - hiddenAt > SESSION_HIDE_MS) {
      sessionStorage.removeItem(SESSION_HIDE_KEY);
      return false;
    }
    return true;
  } catch { return false; }
}

function normalizePlacement(value) {
  if (!value || typeof value !== "object") return null;
  const x = Number(value.x);
  const y = Number(value.y);
  const sizePx = value.sizePx == null ? NaN : Number(value.sizePx);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    x,
    y,
    sizePx: Number.isFinite(sizePx) && sizePx > 0 ? sizePx : null,
    savedAt: Number(value.savedAt) || Date.now(),
  };
}

export function loadCompanionPagePlacements() {
  try {
    const raw = JSON.parse(localStorage.getItem(COMPANION_PLACEMENT_KEY) || "{}");
    if (!raw || typeof raw !== "object") return {};
    return Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, normalizePlacement(value)]).filter(([, value]) => value));
  } catch {
    return {};
  }
}

export function getCompanionPagePlacement(pageKey = "dashboard") {
  return loadCompanionPagePlacements()[pageKey] || null;
}

export function saveCompanionPagePlacement(pageKey = "dashboard", placement) {
  const normalized = normalizePlacement(placement);
  if (!normalized) return null;
  const placements = loadCompanionPagePlacements();
  placements[String(pageKey || "dashboard")] = normalized;
  try { localStorage.setItem(COMPANION_PLACEMENT_KEY, JSON.stringify(placements)); } catch {}
  return normalized;
}

export function clearCompanionPagePlacements() {
  try { localStorage.removeItem(COMPANION_PLACEMENT_KEY); } catch {}
  try { window.dispatchEvent(new CustomEvent(COMPANION_EVENT, { detail: loadCompanionPrefs() })); } catch {}
}
