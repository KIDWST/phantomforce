/* PhantomForce Phantom — data core.
   Everything runs locally in the browser (localStorage). No sends, no posts,
   no payments, no provider calls happen from here — records move through
   draft → approval → *-ready states and stop there until a connector exists. */

const DB_KEY = "pf.phantom.v4";
const SESSION_KEY = "pf.session.v3";
const LIVE_TOKEN_KEY = "pf.live.sessionToken.v1";
const DAY = 86400000;

export const uid = (p = "id") => `${p}-${Math.random().toString(36).slice(2, 8)}${(Date.now() % 100000).toString(36)}`;
const days = (n) => new Date(Date.now() + n * DAY).toISOString();
export const fmtDate = (iso, opts = {}) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", ...opts });
export const fmtDateTime = (iso) =>
  new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
export const fmtMoney = (n) => "$" + Number(n || 0).toLocaleString();
export const ago = (iso) => {
  const m = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
};
export const daysUntil = (iso) => Math.ceil((new Date(iso).getTime() - Date.now()) / DAY);

/* ---------------- offer ladder ---------------- */
export const PACKAGES = [
  { id: "starter", name: "Starter", price: 750, blurb: "Landing page or content sprint. One clear outcome, fast." },
  { id: "core", name: "Core", price: 1500, blurb: "Site + lead capture + follow-up system. The working baseline." },
  { id: "pro", name: "Pro", price: 2500, blurb: "Full build: site, store, media plan, review engine, phantom setup." },
];
export const RETAINERS = [
  { id: "keeper", name: "Keeper", price: 150, blurb: "Monthly upkeep, security scan, review requests." },
  { id: "operator", name: "Operator", price: 300, blurb: "Upkeep + lead follow-up desk + monthly content drop." },
  { id: "partner", name: "Partner", price: 625, range: "$500–$750", blurb: "Full workforce running weekly: media, pipeline, protection." },
];

/* ---------------- local memory ---------------- */
export const MEMORY_RETENTION_DAYS = 30;
export const MEMORY_CATEGORY_LABELS = {
  conversation: "Conversations",
  preference: "Preferences",
  business: "Business",
  client: "Clients",
  proposal: "Quotes",
  media: "Media",
  website: "Websites",
  security: "Security",
  money: "Money",
  operations: "Operations",
};
const MEMORY_LIMIT = 300;
const SECRET_REDACTIONS = [
  [/\b(sk-[a-z0-9_-]{12,}|hf_[a-z0-9]{12,}|ghp_[a-z0-9_]{20,})\b/gi, "[redacted-key]"],
  [/\b(AKIA|ASIA)[A-Z0-9]{16}\b/g, "[redacted-aws-key]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi, "Bearer [redacted]"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/gi, "[redacted-slack-token]"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[redacted-jwt]"],
  [/\b(api[_ -]?key|token|secret|password|passcode|owner key|cookie|session)\s*[:=]\s*[^\s,;]+/gi, "$1: [redacted]"],
  [/\b(password|passcode|token|secret|api[_ -]?key|owner key)\s+(is|was|are)\s+[^\s,;]+/gi, "$1 $2 [redacted]"],
];

export function sanitizeMemoryText(value = "") {
  let text = String(value || "").replace(/\s+/g, " ").trim();
  for (const [pattern, replacement] of SECRET_REDACTIONS) text = text.replace(pattern, replacement);
  return text.slice(0, 1400);
}

export function classifyMemory(value = "") {
  const text = String(value || "").toLowerCase();
  if (/\b(remember|make sure|from now on|always|never|prefer|preference|i like|i don't like|i hate|don't use|use this)\b/.test(text)) return "preference";
  if (/(breach|leak|malware|phish|password|security|protect|scan|risk|vulnerability|tracker|spybot|scam)/.test(text)) return "security";
  if (/(video|reel|photo|image|higgsfield|media|content|caption|ad|creative|social|tiktok|instagram|facebook|youtube)/.test(text)) return "media";
  if (/(website|site|page|store|dashboard|ui|mobile|phantom deck|admin\.phantomforce|app\.phantomforce)/.test(text)) return "website";
  if (/(proposal|quote|pricing|estimate|package|scope|cover letter|resume|cv)/.test(text)) return "proposal";
  if (/(lead|client|customer|prospect|crm|contact|account|company|business|buyer|follow[- ]?up)/.test(text)) return "client";
  if (/(money|revenue|invoice|payment|retainer|sale|deal|pipeline|cost|credits|subscription)/.test(text)) return "money";
  if (/(automation|workflow|agent|worker|deploy|build|scan|daily check|gateway|vault|process note|private route|connector)/.test(text)) return "operations";
  if (/(phantomforce|business|company|brand|owner|employee|job|linkedin)/.test(text)) return "business";
  return "conversation";
}

function memoryTitle(value = "", category = "conversation") {
  const clean = sanitizeMemoryText(value);
  const first = clean.split(/[.!?]/)[0].trim();
  return (first || MEMORY_CATEGORY_LABELS[category] || "Memory").slice(0, 82);
}

function memoryTags(value = "", category = "conversation") {
  const text = String(value || "").toLowerCase();
  const tags = [category];
  [
    ["phantom", /phantomforce|phantom/],
    ["admin", /admin|owner|jordan/],
    ["mobile", /mobile|phone|iphone|safari/],
    ["client", /client|customer|lead/],
    ["local", /local|private|pc|desktop/],
    ["approval", /approval|approve|review/],
  ].forEach(([tag, pattern]) => { if (pattern.test(text)) tags.push(tag); });
  return [...new Set(tags)].slice(0, 6);
}

export function shouldAiRemember(value = "") {
  return /\b(remember|make sure|from now on|always|never|i like|i don't like|important|owner|employee|policy|pricing|package|business|brand|client|customer|workspace)\b/i.test(String(value || ""));
}

export function pruneMemory(entries = []) {
  const cutoff = Date.now() - MEMORY_RETENTION_DAYS * DAY;
  return entries
    .filter(Boolean)
    .map((entry) => {
      const createdAt = entry.createdAt || entry.at || new Date().toISOString();
      const text = sanitizeMemoryText(entry.text || entry.summary || entry.title || "");
      const category = entry.category || classifyMemory(text);
      return {
        id: entry.id || uid("mem"),
        ws: entry.ws || "phantomforce",
        source: entry.source || "manual",
        category,
        title: sanitizeMemoryText(entry.title || memoryTitle(text, category)).slice(0, 90),
        summary: sanitizeMemoryText(entry.summary || text).slice(0, 220),
        text,
        tags: Array.isArray(entry.tags) ? entry.tags.slice(0, 8).map((tag) => sanitizeMemoryText(tag).slice(0, 28)).filter(Boolean) : memoryTags(text, category),
        createdAt,
        updatedAt: entry.updatedAt || createdAt,
        lastAccessedAt: entry.lastAccessedAt || createdAt,
        pinnedByUser: !!entry.pinnedByUser,
        pinnedByAi: !!entry.pinnedByAi,
      };
    })
    .filter((entry) => entry.text && (entry.pinnedByUser || entry.pinnedByAi || new Date(entry.createdAt).getTime() >= cutoff))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, MEMORY_LIMIT);
}

export function memoryRetention(entry) {
  if (entry?.pinnedByUser) return "remembered by you";
  if (entry?.pinnedByAi) return "remembered by Phantom";
  const ageDays = Math.floor((Date.now() - new Date(entry?.createdAt || Date.now()).getTime()) / DAY);
  return `${Math.max(0, MEMORY_RETENTION_DAYS - ageDays)}d left`;
}

/* ---------------- internal tool spine ---------------- */
export const TOOL_SPINE = [
  {
    id: "private-gateway",
    name: "Private Gateway",
    internal: "Access Layer",
    worker: "Access Sentinel",
    mode: "active",
    status: "watching",
    role: "Keeps admin Phantom reachable through the private route while hiding raw local ports.",
    ownerControl: "Owner access is live through the private route. Raw local ports stay hidden from everybody else.",
    activity: "watching admin.phantomforce.online route and keeping backend ports private.",
    path: "Private backend",
    visibleToClients: false,
  },
  {
    id: "memory-core",
    name: "Memory Core",
    internal: "Memory Layer",
    worker: "Memory Keeper",
    mode: "active",
    status: "online",
    role: "Compiles context, receipts, redaction notes, and useful memory for Phantom AI.",
    ownerControl: "Admin memory is on. Client workspaces keep their own separate memory unless you connect them.",
    activity: "compiled owner context, redacted receipts, and memory hints for Phantom AI.",
    path: "Private backend",
    visibleToClients: false,
  },
  {
    id: "process-vault",
    name: "Process Vault",
    internal: "Process Memory",
    worker: "Vault Scribe",
    mode: "active",
    status: "indexed",
    role: "Stores sanitized decisions, process notes, verification logs, and operating memory.",
    ownerControl: "Owner process memory is indexed. Secrets stay out of the vault.",
    activity: "indexed the PhantomForce Command Center vault for process memory.",
    path: "Private backend",
    visibleToClients: false,
  },
  {
    id: "automation-desk",
    name: "Automation Desk",
    internal: "Workflow Layer",
    worker: "Workflow Runner",
    mode: "setup-ready",
    status: "ready",
    role: "Builds repeat workflows for follow-ups, content, reviews, and handoffs.",
    ownerControl: "Ready for owner setup. Turn on each workflow when the connector and rules are correct.",
    activity: "automation desk is ready for owner-configured workflows.",
    path: "Private backend",
    visibleToClients: false,
  },
  {
    id: "n8n-worker",
    name: "n8n Worker",
    internal: "Workflow Runner",
    worker: "n8n",
    mode: "setup-ready",
    status: "scaffolded",
    role: "Hosts local workflow drafts and repeatable automations after owner approval.",
    ownerControl: "Scaffolded as an internal worker lane. Workflow execution stays disabled until the owner connects and approves each run.",
    activity: "n8n lane is scaffolded for workflow drafts; no live workflow execution is active here.",
    path: "Local workflow bay",
    visibleToClients: false,
  },
  {
    id: "ruflo-loop",
    name: "Ruflo",
    internal: "Agent Loop Layer",
    worker: "Ruflo",
    mode: "planning",
    status: "planned",
    role: "Plans repeatable agent loops, handoffs, and review gates across Phantom workers.",
    ownerControl: "Planning lane only until a real loop runner is connected. It can propose loops, not execute them.",
    activity: "Ruflo is mapped as the loop-planning worker for future coordinated agent runs.",
    path: "Agent loop planner",
    visibleToClients: false,
  },
  {
    id: "build-planner",
    name: "Build Planner",
    internal: "Planning Layer",
    worker: "Spec Architect",
    mode: "active",
    status: "ready",
    role: "Turns big requests into scoped proposals, tasks, and implementation guardrails.",
    ownerControl: "Available for planning real builds, client packages, and sprint scopes.",
    activity: "standing by to turn the next feature request into a scoped build plan.",
    path: "Private backend",
    visibleToClients: false,
  },
  {
    id: "operating-standards",
    name: "Operator Standards",
    internal: "Standards Layer",
    worker: "PhantomOps",
    mode: "active",
    status: "enforcing",
    role: "Keeps agent work structured around standards, handoffs, and owner-safe execution.",
    ownerControl: "Keeps the team organized without exposing tool names to clients.",
    activity: "enforcing PhantomOps standards across command routing and worker handoffs.",
    path: "Private backend",
    visibleToClients: false,
  },
  {
    id: "code-intelligence",
    name: "Code Intelligence",
    internal: "Code Layer",
    worker: "Code Navigator",
    mode: "available",
    status: "indexed",
    role: "Helps Phantom understand codebases, routes, files, and repo structure.",
    ownerControl: "Available for owner diagnostics and build planning. Write actions stay routed through owner mode.",
    activity: "code intelligence is indexed and ready for owner diagnostics.",
    path: "Private backend",
    visibleToClients: false,
  },
  {
    id: "squad-planner",
    name: "Squad Planner",
    internal: "Planning Sandbox",
    worker: "Swarm Planner",
    mode: "planning",
    status: "ready",
    role: "Plans multi-step agent work, handoffs, and team-style workflows.",
    ownerControl: "Ready for owner planning. It becomes real work only when you send the command.",
    activity: "squad planning is ready for owner-directed work.",
    path: "Private backend",
    visibleToClients: false,
  },
  {
    id: "media-engine",
    name: "Media Engine",
    internal: "Media Layer",
    worker: "Media Factory",
    mode: "owner-controlled",
    status: "ready",
    role: "Creates image/video plans, edits, and commercial generation requests.",
    ownerControl: "Ready in Media Lab. Paid credits and external runs stay owner-controlled.",
    activity: "Media Lab is ready for owner-controlled creative work.",
    path: "Private backend",
    visibleToClients: false,
  },
  {
    id: "brain-router",
    name: "Model Switchboard",
    internal: "Brain Layer",
    worker: "Brain Router",
    mode: "active",
    status: "routed",
    role: "Routes admin-only thinking, review, coding, and worker model lanes behind Phantom AI.",
    ownerControl: "Owner brain routing is active. Clients only see Phantom, not the backend model names.",
    activity: "routing requests through the correct brain lane while keeping tool names hidden.",
    path: "Private backend",
    visibleToClients: false,
  },
];

function toolActivitySeed() {
  return [];
}

/* ---------------- seed ---------------- */
function seed() {
  return {
    version: 4,
    workspaces: [
      { id: "phantomforce", name: "PhantomForce", kind: "HQ", tagline: "Brand-new workspace. Real records appear only after you create or connect them." },
    ],
    leads: [],
    proposals: [],
    reviews: [],
    bookings: [],
    media: [],
    sites: [],
    products: [],
    security: [],
    approvals: [],
    agents: [],
    memory: [],
    toolSpine: TOOL_SPINE,
    activity: [],
  };
}

/* ---------------- store ---------------- */
function normalizeData(data) {
  const seeded = seed();
  const d = data && typeof data === "object" ? data : seeded;
  d.workspaces = Array.isArray(d.workspaces) && d.workspaces.length ? d.workspaces : seeded.workspaces;
  d.leads = Array.isArray(d.leads) ? d.leads : [];
  d.proposals = Array.isArray(d.proposals) ? d.proposals : [];
  d.reviews = Array.isArray(d.reviews) ? d.reviews : [];
  d.bookings = Array.isArray(d.bookings) ? d.bookings : [];
  d.media = Array.isArray(d.media) ? d.media : [];
  d.sites = Array.isArray(d.sites) ? d.sites : [];
  d.products = Array.isArray(d.products) ? d.products : [];
  d.security = Array.isArray(d.security) ? d.security : [];
  d.approvals = Array.isArray(d.approvals) ? d.approvals : [];
  d.agents = Array.isArray(d.agents) ? d.agents : [];
  d.memory = pruneMemory(Array.isArray(d.memory) ? d.memory : []);
  d.toolSpine = TOOL_SPINE.map((tool) => ({ ...((d.toolSpine || []).find((x) => x.id === tool.id) || {}), ...tool }));
  d.activity = Array.isArray(d.activity) ? d.activity : [];
  d.activity = d.activity.slice(0, 80);
  d.version = 4;
  return d;
}

function load() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && d.version === 4) return normalizeData(d);
    }
  } catch {}
  return normalizeData(seed());
}

const listeners = new Set();
export const store = {
  state: load(),
  save() {
    try { localStorage.setItem(DB_KEY, JSON.stringify(this.state)); } catch {}
    listeners.forEach((fn) => fn());
  },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  reset() { try { localStorage.removeItem(DB_KEY); } catch {} this.state = normalizeData(seed()); this.save(); },
};

/* ---------------- session ---------------- */
export const session = {
  get() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch { return null; }
  },
  set(s) {
    try {
      const { token, ...safeSession } = s || {};
      localStorage.setItem(SESSION_KEY, JSON.stringify(safeSession));
      if (token) sessionStorage.setItem(LIVE_TOKEN_KEY, token);
    } catch {}
  },
  token() {
    try { return sessionStorage.getItem(LIVE_TOKEN_KEY) || ""; } catch { return ""; }
  },
  clear() {
    try {
      localStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(LIVE_TOKEN_KEY);
    } catch {}
  },
};

export const ADMIN_PUBLIC_HOST = "admin.phantomforce.online";
export const PUBLIC_PAGES_HOSTS = new Set(["phantomforce.online", "www.phantomforce.online"]);
export const OWNER_SESSION_ID = "owner-admin";

export const isLiveAdminHost = () => location.hostname === ADMIN_PUBLIC_HOST;
export const isStaticPublicHost = () => PUBLIC_PAGES_HOSTS.has(location.hostname);

export function liveAdminUrl() {
  const url = new URL(`https://${ADMIN_PUBLIC_HOST}/app/index.html`);
  url.searchParams.set("from", "phantomforce-online");
  return url.toString();
}

export function redirectToLiveAdmin() {
  location.replace(liveAdminUrl());
}

export function resolveSession() {
  if (isLiveAdminHost()) {
    const saved = session.get();
    const token = session.token();
    if (saved?.role === "admin" && token) return { ...saved, token };
    return null;
  }

  const q = new URLSearchParams(location.search);
  const key = (q.get("session") || "").toLowerCase();
  if (key === OWNER_SESSION_ID) {
    if (isStaticPublicHost()) {
      redirectToLiveAdmin();
      return null;
    }
    const s = {
      role: "admin",
      name: "Jordan",
      label: "PhantomForce Owner",
      ws: "phantomforce",
      sessionId: OWNER_SESSION_ID,
      canManageAccess: true,
    };
    session.set(s); return s;
  }
  if (key === "admin" || key === "jordan") {
    if (isStaticPublicHost()) {
      redirectToLiveAdmin();
      return null;
    }
    const s = {
      role: "admin",
      name: "Jordan",
      label: "PhantomForce Owner",
      ws: "phantomforce",
      sessionId: "local-admin",
      canManageAccess: true,
    };
    session.set(s); return s;
  }
  if (key === "employee" || key === "team" || key === "client") {
    const s = { role: "employee", name: "Employee", ws: "phantomforce" };
    session.set(s); return s;
  }
  const saved = session.get();
  if (saved) {
    if (saved.role === "client") {
      saved.role = "employee";
      saved.name = "Employee";
    }
    if (!store.state.workspaces.some((w) => w.id === saved.ws)) saved.ws = "phantomforce";
    session.set(saved);
  }
  if (saved?.role === "admin" && isStaticPublicHost()) {
    redirectToLiveAdmin();
    return null;
  }
  return saved;
}

export async function ownerLogin(ownerKey) {
  const response = await fetch("/auth/owner-login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: "owner-admin", ownerKey }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.token || !payload?.session) {
    throw new Error(payload?.error || "Owner login failed.");
  }
  const sessionId = payload.session.id || OWNER_SESSION_ID;
  const isOwnerSession = sessionId === OWNER_SESSION_ID;
  const s = {
    role: "admin",
    name: payload.session.name || (isOwnerSession ? "Jordan" : payload.session.label || "Operator"),
    label: payload.session.label || (isOwnerSession ? "PhantomForce Owner" : ""),
    ws: "phantomforce",
    sessionId,
    canManageAccess: !!payload.session.canManageAccess,
    token: payload.token,
  };
  session.set(s);
  return s;
}

export async function verifyLiveSession() {
  if (!isLiveAdminHost()) return resolveSession();
  const token = session.token();
  if (!token) return null;
  const response = await fetch("/session", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    session.clear();
    return null;
  }
  const payload = await response.json().catch(() => ({}));
  if (!payload?.session?.canManageAccess) {
    session.clear();
    return null;
  }
  const sessionId = payload.session.id || OWNER_SESSION_ID;
  const isOwnerSession = sessionId === OWNER_SESSION_ID;
  const s = {
    role: "admin",
    name: payload.session.name || (isOwnerSession ? "Jordan" : payload.session.label || "Operator"),
    label: payload.session.label || (isOwnerSession ? "PhantomForce Owner" : ""),
    ws: "phantomforce",
    sessionId,
    canManageAccess: !!payload.session.canManageAccess,
    token,
  };
  session.set(s);
  return s;
}

/* ---------------- selectors ---------------- */
export const ctx = { session: null };
export const isAdmin = () => ctx.session?.role === "admin";
export const isOwnerOperator = () => {
  const s = ctx.session || {};
  if (s.role !== "admin") return false;
  const identity = `${s.sessionId || ""} ${s.name || ""} ${s.label || ""}`.toLowerCase();
  return s.sessionId === OWNER_SESSION_ID
    || (s.canManageAccess === true && /\b(jordan|phantomforce owner)\b/.test(identity));
};
export const currentWs = () => ctx.session?.ws || "phantomforce";
export const setWorkspace = (id) => { if (!isAdmin()) return; ctx.session.ws = id; session.set(ctx.session); store.save(); };

/* Admin at HQ sees everything; admin inside a workspace or an employee sees
   only that workspace's records. */
export function visible(list) {
  const ws = currentWs();
  if (isAdmin() && ws === "phantomforce") return list;
  return list.filter((r) => r.ws === ws);
}
export const wsName = (id) => store.state.workspaces.find((w) => w.id === id)?.name || id;

export function pushActivity(who, text, ws = currentWs()) {
  store.state.activity.unshift({ id: uid("act"), ws, who, text, at: new Date().toISOString() });
  store.state.activity = store.state.activity.slice(0, 80);
}

export function pushToolPulse(toolId) {
  const tools = toolId
    ? store.state.toolSpine.filter((tool) => tool.id === toolId)
    : store.state.toolSpine;
  for (const tool of tools.slice().reverse()) {
    store.state.activity.unshift({
      id: uid("act"),
      ws: "phantomforce",
      who: tool.worker,
      text: tool.activity,
      at: new Date().toISOString(),
      toolId: tool.id,
    });
  }
  store.state.activity = store.state.activity.slice(0, 80);
}

export function addMemory(entry = {}) {
  const rawText = sanitizeMemoryText(entry.text || entry.summary || entry.title || "");
  if (!rawText) return null;
  const sourceText = `${entry.title || ""} ${entry.summary || ""} ${rawText}`;
  const category = entry.category || classifyMemory(sourceText);
  const now = new Date().toISOString();
  const memory = {
    id: entry.id || uid("mem"),
    ws: entry.ws || (currentWs() === "phantomforce" ? "phantomforce" : currentWs()),
    source: entry.source || "manual",
    category,
    title: sanitizeMemoryText(entry.title || memoryTitle(rawText, category)).slice(0, 90),
    summary: sanitizeMemoryText(entry.summary || rawText).slice(0, 220),
    text: rawText,
    tags: Array.isArray(entry.tags) && entry.tags.length
      ? entry.tags.slice(0, 8).map((tag) => sanitizeMemoryText(tag).slice(0, 28)).filter(Boolean)
      : memoryTags(sourceText, category),
    createdAt: entry.createdAt || now,
    updatedAt: now,
    lastAccessedAt: now,
    pinnedByUser: !!entry.pinnedByUser,
    pinnedByAi: !!entry.pinnedByAi || shouldAiRemember(sourceText),
  };
  const recentDuplicate = (store.state.memory || []).find((item) =>
    item.text === memory.text && Date.now() - new Date(item.createdAt).getTime() < 60000);
  if (recentDuplicate) return recentDuplicate;
  store.state.memory = pruneMemory([memory, ...(store.state.memory || [])]);
  store.save();
  return memory;
}

export function rememberConversation({ prompt = "", reply = "", mode = "ask", route = "" } = {}) {
  const cleanPrompt = sanitizeMemoryText(prompt);
  if (!cleanPrompt) return null;
  const cleanReply = sanitizeMemoryText(reply);
  const combined = cleanReply ? `User: ${cleanPrompt}\nPhantom: ${cleanReply}` : `User: ${cleanPrompt}`;
  const category = classifyMemory(`${cleanPrompt} ${cleanReply}`);
  return addMemory({
    source: "conversation",
    category,
    title: cleanPrompt,
    summary: cleanReply || cleanPrompt,
    text: combined,
    tags: [mode, route, category].filter(Boolean),
    pinnedByAi: shouldAiRemember(cleanPrompt) || shouldAiRemember(cleanReply),
  });
}

export function toggleMemoryRemember(id) {
  const memory = store.state.memory.find((item) => item.id === id);
  if (!memory) return null;
  memory.pinnedByUser = !memory.pinnedByUser;
  memory.updatedAt = new Date().toISOString();
  store.state.memory = pruneMemory(store.state.memory);
  store.save();
  return memory;
}

export function forgetMemory(id) {
  store.state.memory = (store.state.memory || []).filter((item) => item.id !== id);
  store.save();
}

export function memoryStats(list = visible(store.state.memory || [])) {
  const memories = Array.isArray(list) ? list : [];
  const remembered = memories.filter((item) => item.pinnedByUser || item.pinnedByAi).length;
  const categories = new Set(memories.map((item) => item.category)).size;
  const expiresSoon = memories.filter((item) => {
    if (item.pinnedByUser || item.pinnedByAi) return false;
    return Date.now() - new Date(item.createdAt).getTime() > (MEMORY_RETENTION_DAYS - 5) * DAY;
  }).length;
  return { total: memories.length, remembered, categories, expiresSoon };
}

/* ---------------- derived: money ---------------- */
export function moneyView() {
  const props = visible(store.state.proposals);
  const open = props.filter((p) => ["draft", "sent-ready", "sent"].includes(p.status));
  const won = props.filter((p) => p.status === "won");
  const lost = props.filter((p) => p.status === "lost");
  const pipeline = open.reduce((s, p) => s + p.price, 0);
  const wonValue = won.reduce((s, p) => s + p.price, 0);
  const retainerMonthly = props.filter((p) => p.retainer && p.status !== "lost")
    .reduce((s, p) => s + (RETAINERS.find((r) => r.id === p.retainer)?.price || 0), 0);
  return { open, won, lost, pipeline, wonValue, retainerMonthly };
}

/* ---------------- derived: today's plan ---------------- */
export function todaysPlan() {
  const items = [];
  visible(store.state.approvals).filter((a) => a.status === "pending")
    .forEach((a) => items.push({ icon: "◈", text: a.title, kind: "approval", open: "approvals" }));
  visible(store.state.leads).filter((l) => ["new", "follow-up"].includes(l.status) && daysUntil(l.due) <= 0)
    .forEach((l) => items.push({ icon: "▸", text: `${l.next} — ${l.name}`, kind: "lead", open: "leads" }));
  visible(store.state.proposals).filter((p) => p.status === "sent-ready")
    .forEach((p) => items.push({ icon: "▸", text: `Proposal send-ready: ${p.client}`, kind: "proposal", open: "proposals" }));
  visible(store.state.media).filter((m) => m.status === "brief-ready")
    .forEach((m) => items.push({ icon: "▸", text: `Video request ready: ${m.title}`, kind: "media", open: "media" }));
  visible(store.state.security).forEach((s) => {
    if (daysUntil(s.rotationDue) <= 30) items.push({ icon: "⚠", text: `Password rotation window closes in ${daysUntil(s.rotationDue)} days`, kind: "security", open: "protect" });
  });
  return items.slice(0, 7);
}

/* ---------------- approvals ---------------- */
export function resolveApproval(id, approved) {
  const a = store.state.approvals.find((x) => x.id === id);
  if (!a || a.status !== "pending") return;
  a.status = approved ? "approved" : "declined";
  a.resolvedAt = new Date().toISOString();
  if (approved) {
    if (a.type === "publish-review") { const r = store.state.reviews.find((x) => x.id === a.ref); if (r) r.status = "published-ready"; }
    if (a.type === "send-message") { const l = store.state.leads.find((x) => x.id === a.ref); if (l) { l.status = "follow-up"; l.next = "Message approved — send-ready in your outbox"; } }
    if (a.type === "publish-page") { const s = store.state.sites.find((x) => x.id === a.ref); if (s) s.status = "approved-to-publish"; }
    if (a.type === "media-generation") { const m = store.state.media.find((x) => x.id === a.ref); if (m) m.status = "generation-approved"; }
    if (a.type === "booking") { const b = store.state.bookings.find((x) => x.id === a.ref); if (b) b.status = "approved"; }
  }
  pushActivity("Command Router", `${approved ? "approved" : "declined"}: ${a.title}`, a.ws);
  store.save();
}

export const STATUS_LABEL = {
  "new": "New", "follow-up": "Follow-up", "proposal": "Proposal out", "won": "Won", "lost": "Lost",
  "draft": "Draft", "sent-ready": "Send-ready", "sent": "Sent", "approved": "Approved",
  "brief-ready": "Ready to produce", "generation-approved": "Generation approved", "delivered": "Delivered",
  "publish-ready": "Publish-ready", "approved-to-publish": "Approved to publish", "published-ready": "Published-ready",
  "received": "Received", "pending": "Pending", "declined": "Declined", "not-wired": "Not wired", "invoice-ready": "Invoice-ready",
  "watching": "Watching", "online": "Online", "indexed": "Indexed", "scaffolded": "Scaffolded", "ready": "Ready", "enforcing": "Enforcing", "contained": "Contained", "routed": "Routed",
  "active": "Active", "standby": "Standby", "sandbox": "Sandbox", "gated": "Gated",
  "setup-ready": "Setup ready", "available": "Available", "planning": "Planning", "owner-controlled": "Owner-controlled",
  "cataloged": "Cataloged", "server-only": "Server-only", "approval-gated": "Approval-gated",
  "not-scheduled": "Not scheduled",
};
export const statusLabel = (s) => STATUS_LABEL[s] || s;
