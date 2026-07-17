import { workspaceStorageGetItem, workspaceStorageSetItem } from "./store.js?v=phantom-live-20260716-314";
const IDEA_AUTOMATION_KEY = "pf.contenthub.dailyIdeas.v1";
const DAY = 864e5;

export const DAILY_IDEA_AUTOMATION_ID = "daily-content-ideas";
export const DAILY_IDEA_STYLES = ["Practical", "Premium", "Educational", "Bold", "Local", "Creator-led"];
export const DAILY_IDEA_FOCUS = ["Mixed", "Sales", "Education", "Behind the scenes", "Trust", "Offers", "Community"];
export const DAILY_IDEA_CONTENT_TYPES = ["Short video", "Carousel", "Image post", "Text post", "Story", "Email"];
export const DAILY_IDEA_CHANNELS = ["Instagram", "TikTok", "YouTube", "Facebook", "X", "LinkedIn"];

const DEFAULT_AUTOMATION = Object.freeze({
  id: DAILY_IDEA_AUTOMATION_ID,
  name: "Daily New Ideas",
  enabled: true,
  count: 5,
  style: "Practical",
  focus: "Mixed",
  contentTypes: ["Short video", "Carousel", "Image post"],
  channels: ["Instagram", "TikTok", "LinkedIn"],
  refreshHour: 8,
  autoClearDaily: true,
  profile: {
    businessName: "",
    audience: "",
    offer: "",
    voice: "",
    goal: "",
  },
  savedIdeas: [],
  daily: { dayKey: "", signature: "", generatedAt: "", ideas: [], customIdeas: [] },
  updatedAt: "",
});

const safe = (value, max = 220) => String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max);
const clamp = (n, min, max) => Math.min(max, Math.max(min, Number.isFinite(Number(n)) ? Number(n) : min));
const uniq = (items = []) => [...new Set(items.map((item) => safe(item, 42)).filter(Boolean))];
const titleCase = (value = "") => safe(value).replace(/\b\w/g, (c) => c.toUpperCase());

function todayKey(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function hashString(value = "") {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, list) {
  return list[Math.floor(rng() * list.length)] || list[0];
}

function cleanList(input, allowed, fallback) {
  const raw = Array.isArray(input) ? input : String(input || "").split(",");
  const allowedLower = new Map(allowed.map((item) => [item.toLowerCase(), item]));
  const cleaned = uniq(raw).map((item) => allowedLower.get(item.toLowerCase()) || titleCase(item)).filter(Boolean);
  return cleaned.length ? cleaned.slice(0, 8) : fallback.slice();
}

function normalizeProfile(input = {}) {
  return {
    businessName: safe(input.businessName, 80),
    audience: safe(input.audience, 120),
    offer: safe(input.offer, 140),
    voice: safe(input.voice, 120),
    goal: safe(input.goal, 140),
  };
}

export function normalizeDailyIdeaAutomation(input = {}) {
  const base = { ...DEFAULT_AUTOMATION, ...(input && typeof input === "object" ? input : {}) };
  const style = DAILY_IDEA_STYLES.includes(base.style) ? base.style : DEFAULT_AUTOMATION.style;
  const focus = DAILY_IDEA_FOCUS.includes(base.focus) ? base.focus : DEFAULT_AUTOMATION.focus;
  const savedIdeas = Array.isArray(base.savedIdeas)
    ? base.savedIdeas
      .map(normalizeIdea)
      .filter(Boolean)
      .sort((a, b) => Date.parse(b.savedAt || b.createdAt || 0) - Date.parse(a.savedAt || a.createdAt || 0))
      .slice(0, 50)
    : [];
  const daily = base.daily && typeof base.daily === "object" ? base.daily : DEFAULT_AUTOMATION.daily;
  return {
    ...DEFAULT_AUTOMATION,
    ...base,
    enabled: base.enabled !== false,
    count: clamp(base.count, 1, 12),
    style,
    focus,
    contentTypes: cleanList(base.contentTypes, DAILY_IDEA_CONTENT_TYPES, DEFAULT_AUTOMATION.contentTypes),
    channels: cleanList(base.channels, DAILY_IDEA_CHANNELS, DEFAULT_AUTOMATION.channels),
    refreshHour: clamp(base.refreshHour, 0, 23),
    autoClearDaily: base.autoClearDaily !== false,
    profile: normalizeProfile(base.profile),
    savedIdeas,
    daily: {
      dayKey: safe(daily.dayKey, 16),
      signature: safe(daily.signature, 280),
      generatedAt: safe(daily.generatedAt, 40),
      ideas: Array.isArray(daily.ideas) ? daily.ideas.map(normalizeIdea).filter(Boolean) : [],
      customIdeas: Array.isArray(daily.customIdeas) ? daily.customIdeas.map(normalizeIdea).filter(Boolean) : [],
    },
    updatedAt: safe(base.updatedAt, 40),
  };
}

export function loadDailyIdeaAutomation() {
  try {
    return normalizeDailyIdeaAutomation(JSON.parse(workspaceStorageGetItem(IDEA_AUTOMATION_KEY) || "{}"));
  } catch {
    return normalizeDailyIdeaAutomation({});
  }
}

export function saveDailyIdeaAutomation(next) {
  const normalized = normalizeDailyIdeaAutomation({ ...(next || {}), updatedAt: new Date().toISOString() });
  try { workspaceStorageSetItem(IDEA_AUTOMATION_KEY, JSON.stringify(normalized)); } catch {}
  return normalized;
}

function configSignature(config) {
  return JSON.stringify({
    count: config.count,
    style: config.style,
    focus: config.focus,
    contentTypes: config.contentTypes,
    channels: config.channels,
    profile: config.profile,
  });
}

function normalizeIdea(input = {}) {
  const title = safe(input.title, 90);
  if (!title) return null;
  const createdAt = safe(input.createdAt, 40) || new Date().toISOString();
  return {
    id: safe(input.id, 90) || `idea-${hashString(`${title}${createdAt}`).toString(36)}`,
    title,
    angle: safe(input.angle, 260),
    format: safe(input.format, 42) || "Post",
    platforms: Array.isArray(input.platforms) ? input.platforms.map((p) => safe(p, 32).toLowerCase()).filter(Boolean) : [],
    next: safe(input.next, 180),
    why: safe(input.why, 180),
    source: safe(input.source, 40) || "daily",
    dayKey: safe(input.dayKey, 16) || todayKey(),
    createdAt,
    savedAt: safe(input.savedAt, 40),
    custom: !!input.custom,
  };
}

const platformId = (name = "") => {
  const key = String(name).toLowerCase();
  if (key.includes("tik")) return "tiktok";
  if (key.includes("you")) return "youtube";
  if (key.includes("face")) return "facebook";
  if (key.includes("link")) return "linkedin";
  if (key === "x" || key.includes("twitter")) return "x";
  return "instagram";
};

function generateDailyIdeas(config, date = new Date()) {
  const dayKey = todayKey(date);
  const profile = config.profile || {};
  const business = profile.businessName || "your business";
  const audience = profile.audience || "your best-fit customer";
  const offer = profile.offer || "the offer you want to sell";
  const goal = profile.goal || "more qualified demand";
  const voice = profile.voice || config.style;
  const seed = hashString(`${dayKey}|${configSignature(config)}`);
  const rng = mulberry(seed);
  const hooks = [
    `Answer the question ${audience} asks before they trust ${business}`,
    `Show the easiest before/after around ${offer}`,
    `Turn one common hesitation into a simple proof post`,
    `Show what happens behind the scenes before a customer ever sees the final result`,
    `Make a fast checklist that helps ${audience} avoid a costly mistake`,
    `Turn a customer outcome into a no-fluff story`,
    `Explain one reason ${business} is easier to buy from today`,
    `Show the boring work being handled so the owner can focus on the real job`,
    `Make a local/community angle that proves ${business} is active and reachable`,
    `Create a direct offer post tied to ${goal}`,
  ];
  const nextSteps = [
    "Draft the hook first, then attach one visual proof point.",
    "Use a real asset from Creator Hub or generate one in Media Lab.",
    "Keep the copy short and make the CTA one obvious next step.",
    "Turn it into a saved draft only if the owner wants to use it.",
    "Avoid tool names; sell the outcome in human language.",
    "Make it feel useful before it feels promotional.",
  ];
  const reasons = [
    "Daily disposable idea: useful today, gone tomorrow unless saved.",
    "Matched to the current content focus and business profile.",
    "Designed to become a post, image, short, or campaign seed.",
    "Safe prep only; nothing posts or sends from here.",
  ];
  return Array.from({ length: config.count }, (_, i) => {
    const format = pick(rng, config.contentTypes);
    const channelA = pick(rng, config.channels);
    const channelB = pick(rng, config.channels.filter((c) => c !== channelA).length ? config.channels.filter((c) => c !== channelA) : config.channels);
    const hook = pick(rng, hooks);
    const focus = config.focus === "Mixed" ? pick(rng, DAILY_IDEA_FOCUS.filter((x) => x !== "Mixed")) : config.focus;
    return normalizeIdea({
      id: `daily-${dayKey}-${i + 1}-${hashString(`${hook}|${format}|${channelA}`).toString(36)}`,
      title: `${focus}: ${hook.replace(/\.$/, "")}`.slice(0, 86),
      angle: `${hook}. Tone: ${voice}. Tie it to ${offer} without making fake claims.`,
      format,
      platforms: uniq([platformId(channelA), platformId(channelB)]),
      next: pick(rng, nextSteps),
      why: pick(rng, reasons),
      source: "daily",
      dayKey,
      createdAt: new Date().toISOString(),
    });
  }).filter(Boolean);
}

export function ensureDailyIdeas(date = new Date()) {
  let config = loadDailyIdeaAutomation();
  const dayKey = todayKey(date);
  const signature = configSignature(config);
  const needsRefresh = config.daily.dayKey !== dayKey
    || config.daily.signature !== signature
    || !Array.isArray(config.daily.ideas)
    || config.daily.ideas.length !== config.count;
  if (needsRefresh) {
    config = saveDailyIdeaAutomation({
      ...config,
      daily: {
        dayKey,
        signature,
        generatedAt: new Date().toISOString(),
        ideas: config.enabled ? generateDailyIdeas(config, date) : [],
        customIdeas: [],
      },
    });
  }
  return config;
}

export function dailyIdeaState() {
  const config = ensureDailyIdeas();
  return {
    config,
    ideas: [...(config.daily.ideas || []), ...(config.daily.customIdeas || [])].filter(Boolean),
    savedIdeas: config.savedIdeas || [],
    missingProfile: Object.values(config.profile || {}).filter(Boolean).length < 3,
  };
}

export function refreshDailyIdeas() {
  const config = loadDailyIdeaAutomation();
  const dayKey = todayKey();
  return saveDailyIdeaAutomation({
    ...config,
    daily: {
      dayKey,
      signature: configSignature(config),
      generatedAt: new Date().toISOString(),
      ideas: config.enabled ? generateDailyIdeas(config) : [],
      customIdeas: [],
    },
  });
}

export function addCustomDailyIdea({ title, angle = "", format = "", platforms = [] } = {}) {
  const config = ensureDailyIdeas();
  const dayKey = todayKey();
  const idea = normalizeIdea({
    id: `custom-${dayKey}-${hashString(`${title}|${Date.now()}`).toString(36)}`,
    title,
    angle: angle || "Owner-added idea for today.",
    format: format || config.contentTypes[0] || "Post",
    platforms: platforms.length ? platforms : config.channels.map(platformId).slice(0, 2),
    next: "Save it or draft from it before tomorrow's refresh.",
    why: "Added manually by the owner.",
    source: "custom",
    custom: true,
    dayKey,
    createdAt: new Date().toISOString(),
  });
  if (!idea) return null;
  saveDailyIdeaAutomation({
    ...config,
    daily: { ...config.daily, customIdeas: [idea, ...(config.daily.customIdeas || [])].slice(0, 12) },
  });
  return idea;
}

export function saveIdeaForLater(idea) {
  const config = ensureDailyIdeas();
  const normalized = normalizeIdea({ ...idea, savedAt: new Date().toISOString(), source: "saved" });
  if (!normalized) return null;
  const savedIdeas = [normalized, ...(config.savedIdeas || []).filter((item) => item.id !== normalized.id)].slice(0, 50);
  saveDailyIdeaAutomation({ ...config, savedIdeas });
  return normalized;
}
