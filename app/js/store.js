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
export const VACATION_POLICY = {
  allowDrafting: true,
  allowTaskCreation: true,
  allowMediaBriefs: true,
  allowRendering: false,
  allowPublishing: false,
  allowSending: false,
  allowDeploying: false,
  allowDeleting: false,
  requireApprovalForCredits: true,
  requireApprovalForExternalActions: true,
  maxRunMinutes: 480,
};
export const FINANCE_CATEGORIES = [
  "Sales income",
  "Service income",
  "Refund",
  "Software",
  "Advertising",
  "Contractors",
  "Payroll",
  "Equipment",
  "Travel",
  "Meals",
  "Fees",
  "Taxes",
  "Owner draw",
  "Transfer",
  "Uncategorized",
];
export const FINANCE_CONNECTORS = [
  { id: "bank", type: "bank", name: "Bank account", provider: "Plaid", status: "not-connected" },
  { id: "card", type: "credit-card", name: "Credit card", provider: "Plaid", status: "not-connected" },
  { id: "manual", type: "manual", name: "Manual ledger", provider: "Local entry / CSV", status: "ready" },
];

/* ---------------- local memory ---------------- */
export const MEMORY_RETENTION_DAYS = 30;
export const CHAT_HISTORY_RETENTION_DAYS = 10;
export const MEMORY_CATEGORY_LABELS = {
  conversation: "Saved chats",
  preference: "Preferences",
  business: "Business",
  client: "Clients",
  proposal: "Quotes",
  media: "Media",
  website: "Websites",
  security: "Security",
  money: "Accounting",
  operations: "Operations",
};
const MEMORY_LIMIT = 300;
const CHAT_HISTORY_LIMIT = 500;
const SECRET_REDACTIONS = [
  [/\b(sk-[a-z0-9_-]{12,}|hf_[a-z0-9]{12,}|ghp_[a-z0-9_]{20,})\b/gi, "[redacted-key]"],
  [/\b(AKIA|ASIA)[A-Z0-9]{16}\b/g, "[redacted-aws-key]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi, "Bearer [redacted]"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/gi, "[redacted-slack-token]"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[redacted-jwt]"],
  [/\b(?:\d[ -]?){13,19}\b/g, "[redacted-card]"],
  [/\b(api[_ -]?key|token|secret|password|passcode|owner key|cookie|session)\s*[:=]\s*[^\s,;]+/gi, "$1: [redacted]"],
  [/\b(password|passcode|token|secret|api[_ -]?key|owner key)\s+(is|was|are)\s+[^\s,;]+/gi, "$1 $2 [redacted]"],
  [/[A-Za-z]:\\Users\\[^\\\s]+\\AppData\\Local\\Temp\\[^\s,;]+/gi, "[redacted-temp-path]"],
];

const EXPLICIT_MEMORY_SIGNAL_PATTERN = /\b(remember(?: this| that)?|make sure|from now on|always|never|prefer|preference|i like|i do not like|i don't like|i hate|do not|don't|should not|shouldn't|must not|save this|keep this|do it this way next time|next time)\b/i;
const FAILED_INTERACTION_PATTERN = /(?:did not complete (?:this )?(?:phantom )?chat request|private brain error|command failed|run-codex\.ps1|powershell\.exe|appdata\\local\\temp|request failed before a usable answer|provider (?:is )?(?:unavailable|offline)|transport error|timed? out|stack trace|exit code\s*\d+)/i;
const FAILED_HISTORY_REPLY = "Request failed before a usable answer was produced.";

export function sanitizeMemoryText(value = "") {
  let text = String(value || "").replace(/\s+/g, " ").trim();
  for (const [pattern, replacement] of SECRET_REDACTIONS) text = text.replace(pattern, replacement);
  return text.slice(0, 1400);
}

export function classifyMemory(value = "") {
  const text = String(value || "").toLowerCase();
  if (/\b(remember|make sure|from now on|always|never|prefer|preference|i like|i don't like|i hate|don't use|use this)\b/.test(text)) return "preference";
  if (/(breach|leak|malware|phish|password|security|protect|scan|risk|vulnerability|tracker|spybot|scam)/.test(text)) return "security";
  if (/(video|reel|photo|image|media|content|caption|ad|creative|social|tiktok|instagram|facebook|youtube)/.test(text)) return "media";
  if (/(website|site|page|store|dashboard|ui|mobile|phantom deck|admin\.phantomforce|app\.phantomforce)/.test(text)) return "website";
  if (/(proposal|quote|pricing|estimate|package|scope|cover letter|resume|cv)/.test(text)) return "proposal";
  if (/(lead|client|customer|prospect|crm|contact|account|company|business|buyer|follow[- ]?up)/.test(text)) return "client";
  if (/(money|accounting|ledger|cashflow|cash flow|bank|credit card|transaction|revenue|invoice|payment|retainer|sale|deal|pipeline|cost|credits|subscription)/.test(text)) return "money";
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
  return EXPLICIT_MEMORY_SIGNAL_PATTERN.test(String(value || ""));
}

function hasDurableMemorySignal(value = "") {
  return EXPLICIT_MEMORY_SIGNAL_PATTERN.test(String(value || ""));
}

export function isFailedMemoryInteraction(prompt = "", reply = "") {
  return FAILED_INTERACTION_PATTERN.test(`${String(prompt || "")} ${String(reply || "")}`);
}

function isInvalidAutoMemory(entry = {}) {
  if (entry.pinnedByUser || entry.source === "manual") return false;
  return isFailedMemoryInteraction(entry.title, `${entry.summary || ""} ${entry.text || ""}`);
}

/* Greetings, thanks, acks — chatter that isn't actually about anything.
   Gates saved memory and temporary history so the app never spends storage
   on "hi", "ok", and other non-context. */
const TRIVIAL_MESSAGE_PATTERN = /^(hi|hello|hey|yo|sup|thanks|thank you|thx|ok|okay|sure|yes|no|yep|nope|nah|cool|nice|lol|test|testing|hmm|k|kk)[\s!.?]*$/i;

function isMemoryWorthy(prompt, reply) {
  const cleanPrompt = sanitizeMemoryText(prompt);
  if (!cleanPrompt) return false;
  if (TRIVIAL_MESSAGE_PATTERN.test(cleanPrompt.trim())) return false;
  if (isFailedMemoryInteraction(cleanPrompt, reply)) return false;
  const wordCount = cleanPrompt.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount < 3 && !hasDurableMemorySignal(cleanPrompt)) return false;
  return hasDurableMemorySignal(cleanPrompt);
}

function isTrivialChat(prompt = "", reply = "") {
  const cleanPrompt = sanitizeMemoryText(prompt);
  if (!cleanPrompt) return true;
  if (TRIVIAL_MESSAGE_PATTERN.test(cleanPrompt.trim())) return true;
  const wordCount = cleanPrompt.trim().split(/\s+/).filter(Boolean).length;
  return wordCount < 3 && !hasDurableMemorySignal(cleanPrompt);
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
    .filter((entry) => entry.text && !isInvalidAutoMemory(entry) && (entry.pinnedByUser || entry.pinnedByAi || new Date(entry.createdAt).getTime() >= cutoff))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, MEMORY_LIMIT);
}

export function pruneChatHistory(entries = []) {
  const cutoff = Date.now() - CHAT_HISTORY_RETENTION_DAYS * DAY;
  return entries
    .filter(Boolean)
    .map((entry) => {
      const createdAt = entry.createdAt || entry.at || new Date().toISOString();
      const prompt = sanitizeMemoryText(entry.prompt || entry.text || entry.title || "");
      const sanitizedReply = sanitizeMemoryText(entry.reply || "");
      const reply = isFailedMemoryInteraction(prompt, sanitizedReply) ? FAILED_HISTORY_REPLY : sanitizedReply;
      const category = entry.category || classifyMemory(prompt);
      return {
        id: entry.id || uid("hist"),
        ws: entry.ws || "phantomforce",
        source: "temporary-chat",
        category,
        title: sanitizeMemoryText(entry.title || memoryTitle(prompt, category)).slice(0, 90),
        summary: sanitizeMemoryText(entry.summary || reply || prompt).slice(0, 220),
        prompt,
        reply,
        mode: sanitizeMemoryText(entry.mode || "ask").slice(0, 40),
        route: sanitizeMemoryText(entry.route || "").slice(0, 50),
        createdAt,
        expiresAt: entry.expiresAt || new Date(new Date(createdAt).getTime() + CHAT_HISTORY_RETENTION_DAYS * DAY).toISOString(),
      };
    })
    .filter((entry) => entry.prompt && !isTrivialChat(entry.prompt, entry.reply) && new Date(entry.createdAt).getTime() >= cutoff)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, CHAT_HISTORY_LIMIT);
}

export function memoryRetention(entry) {
  if (entry?.pinnedByUser) return "remembered by you";
  if (entry?.pinnedByAi) return "remembered by Phantom";
  const ageDays = Math.floor((Date.now() - new Date(entry?.createdAt || Date.now()).getTime()) / DAY);
  return `${Math.max(0, MEMORY_RETENTION_DAYS - ageDays)}d left`;
}

export function chatHistoryRetention(entry) {
  const createdAt = new Date(entry?.createdAt || Date.now()).getTime();
  const ageDays = Math.floor((Date.now() - createdAt) / DAY);
  return `${Math.max(0, CHAT_HISTORY_RETENTION_DAYS - ageDays)}d until shred`;
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
    role: "Keeps Business Manager Phantom reachable through the private route while hiding raw local ports.",
    ownerControl: "Owner access is live through the private route. Raw local ports stay hidden from everybody else.",
    activity: "watching the Business Manager route and keeping backend ports private.",
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
    ownerControl: "Business Manager memory is on. Client workspaces keep their own separate memory unless you connect them.",
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
    id: "flow-relay",
    name: "Flow Relay",
    internal: "Workflow Runner",
    worker: "Relay Runner",
    mode: "setup-ready",
    status: "scaffolded",
    role: "Hosts local workflow drafts and repeatable automations after owner approval.",
    ownerControl: "Scaffolded as an internal worker lane. Workflow execution stays disabled until the owner connects and approves each run.",
    activity: "workflow drafts are scaffolded; no live workflow execution is active here.",
    path: "Local workflow bay",
    visibleToClients: false,
  },
  {
    id: "loop-planner",
    name: "Loop Planner",
    internal: "Agent Loop Layer",
    worker: "Loop Planner",
    mode: "planning",
    status: "planned",
    role: "Plans repeatable agent loops, handoffs, and review gates across Phantom workers.",
    ownerControl: "Planning lane only until a real loop runner is connected. It can propose loops, not execute them.",
    activity: "mapped as the loop-planning worker for future coordinated agent runs.",
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
    role: "Creates images, videos, edits, and approval-gated generated outputs.",
    ownerControl: "Ready in Media Lab. Paid credits and external runs stay owner-controlled.",
    activity: "Media Lab is ready for owner-controlled creative work.",
    path: "Private backend",
    visibleToClients: false,
  },
  {
    id: "brain-router",
    name: "Model Switchboard",
    internal: "Routing Layer",
    worker: "Model Router",
    mode: "active",
    status: "routed",
    role: "Routes admin-only thinking, review, coding, and worker model lanes behind Phantom AI.",
    ownerControl: "Owner routing is active. Clients only see Phantom, not the backend model names.",
    activity: "routing requests through the correct model lane while keeping tool names hidden.",
    path: "Private backend",
    visibleToClients: false,
  },
];

function toolActivitySeed() {
  return [];
}

function financeSeed() {
  return {
    accounts: [],
    transactions: [],
    connectors: FINANCE_CONNECTORS,
  };
}

function normalizeFinance(finance) {
  const input = finance && typeof finance === "object" ? finance : financeSeed();
  const connectors = FINANCE_CONNECTORS.map((connector) => ({
    ...connector,
    ...((input.connectors || []).find((item) => item?.id === connector.id) || {}),
  }));
  const accounts = Array.isArray(input.accounts) ? input.accounts.map((account) => ({
    id: account.id || uid("acct"),
    ws: account.ws || "phantomforce",
    name: String(account.name || "Business account").slice(0, 80),
    type: account.type || "manual",
    institution: String(account.institution || "").slice(0, 80),
    status: account.status || "manual",
    lastSync: account.lastSync || null,
  })) : [];
  const transactions = Array.isArray(input.transactions) ? input.transactions.map((tx) => {
    const amount = Number(tx.amount || 0);
    return {
      id: tx.id || uid("txn"),
      ws: tx.ws || "phantomforce",
      date: tx.date || new Date().toISOString().slice(0, 10),
      description: String(tx.description || "Transaction").slice(0, 160),
      amount: Number.isFinite(amount) ? amount : 0,
      category: FINANCE_CATEGORIES.includes(tx.category) ? tx.category : "Uncategorized",
      account: String(tx.account || "Manual ledger").slice(0, 80),
      source: tx.source || "manual",
      externalId: tx.externalId || null,
      notes: String(tx.notes || "").slice(0, 300),
      createdAt: tx.createdAt || new Date().toISOString(),
    };
  }).filter((tx) => tx.amount !== 0) : [];
  return { accounts, transactions, connectors };
}

/* ---------------- seed ---------------- */
const REQUIRED_WORKSPACES = [
  {
    id: "phantomforce",
    name: "PhantomForce",
    kind: "HQ",
    brainKey: "phantomforce-owner-brain",
    memoryNamespace: "phantomforce",
    assetNamespace: "phantomforce",
    tagline: "Brand-new workspace. Real records appear only after you create or connect them.",
  },
  {
    id: "chicagoshots",
    name: "ChicagoShots",
    kind: "Business",
    brainKey: "chicagoshots-business-brain",
    memoryNamespace: "chicagoshots",
    assetNamespace: "chicagoshots",
    tagline: "Independent ChicagoShots business brain, memory, content, and media workspace.",
  },
];

function seed() {
  return {
    version: 4,
    workspaces: REQUIRED_WORKSPACES.map((workspace) => ({ ...workspace })),
    leads: [],
    proposals: [],
    tasks: [],
    reviews: [],
    bookings: [],
    media: [],
    looperPlans: [],
    sites: [],
    products: [],
    finance: financeSeed(),
    security: [],
    approvals: [],
    agents: [],
    vacationRuns: [],
    memory: [],
    chatHistory: [],
    toolSpine: TOOL_SPINE,
    activity: [],
  };
}

/* ---------------- store ---------------- */
function normalizeData(data) {
  const seeded = seed();
  const d = data && typeof data === "object" ? data : seeded;
  const savedWorkspaces = Array.isArray(d.workspaces) ? d.workspaces : [];
  d.workspaces = REQUIRED_WORKSPACES.map((required) => ({
    ...required,
    ...(savedWorkspaces.find((workspace) => workspace?.id === required.id) || {}),
    id: required.id,
    name: required.name,
    brainKey: required.brainKey,
    memoryNamespace: required.memoryNamespace,
    assetNamespace: required.assetNamespace,
  }));
  d.leads = Array.isArray(d.leads) ? d.leads : [];
  d.proposals = Array.isArray(d.proposals) ? d.proposals : [];
  d.tasks = Array.isArray(d.tasks) ? d.tasks : [];
  d.reviews = Array.isArray(d.reviews) ? d.reviews : [];
  d.bookings = Array.isArray(d.bookings) ? d.bookings : [];
  d.media = Array.isArray(d.media) ? d.media : [];
  d.looperPlans = Array.isArray(d.looperPlans) ? d.looperPlans : [];
  d.sites = Array.isArray(d.sites) ? d.sites : [];
  d.products = Array.isArray(d.products) ? d.products : [];
  d.finance = normalizeFinance(d.finance);
  d.security = Array.isArray(d.security) ? d.security : [];
  d.approvals = Array.isArray(d.approvals) ? d.approvals : [];
  d.agents = Array.isArray(d.agents) ? d.agents : [];
  d.vacationRuns = Array.isArray(d.vacationRuns) ? d.vacationRuns : [];
  d.memory = pruneMemory(Array.isArray(d.memory) ? d.memory : []);
  d.chatHistory = pruneChatHistory(Array.isArray(d.chatHistory) ? d.chatHistory : []);
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
    try {
      this.state.memory = pruneMemory(Array.isArray(this.state.memory) ? this.state.memory : []);
      this.state.chatHistory = pruneChatHistory(Array.isArray(this.state.chatHistory) ? this.state.chatHistory : []);
      localStorage.setItem(DB_KEY, JSON.stringify(this.state));
    } catch {}
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
    const s = { role: "employee", name: "Team Member", ws: "phantomforce" };
    session.set(s); return s;
  }
  const saved = session.get();
  if (saved) {
    if (saved.role === "client") {
      saved.role = "employee";
      saved.name = "Team Member";
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
  let response;
  try {
    response = await fetch("/auth/owner-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "owner-admin", ownerKey }),
    });
  } catch {
    throw new Error("Your key is probably fine — the backend on the admin PC isn't answering at all. Start it (open PowerShell in the phantomforce\\server folder, run: npm run dev), wait ~20 seconds, then sign in again.");
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.token || !payload?.session) {
    const raw = String(payload?.error || "");
    // a down backend must never read as "wrong password"
    if (response.status === 502 || /unavailable|ECONNREFUSED|fetch failed/i.test(raw)) {
      throw new Error("Your key is probably fine — the backend on the admin PC is stopped. Start it: open PowerShell in the phantomforce\\server folder, run: npm run dev — wait ~20 seconds, then sign in again.");
    }
    if (response.status === 401 || response.status === 403) {
      // auto-diagnose: is the backend even holding an owner key right now?
      let keyLoaded = null;
      try {
        const probe = await fetch("/sessions").then((r) => r.json());
        if (typeof probe?.auth?.ownerLoginKeyConfigured === "boolean") keyLoaded = probe.auth.ownerLoginKeyConfigured;
      } catch {}
      if (keyLoaded === false) {
        throw new Error("Your key is fine — the backend started WITHOUT its .env file, so no owner key is loaded. On the admin PC: stop the server (Ctrl+C), then run it from the phantomforce\\server folder (cd ...\\phantomforce\\server, then npm run dev) and sign in again.");
      }
      throw new Error("That key was rejected by the backend. If you're sure it's right, restart the server from the phantomforce\\server folder so it loads PHANTOMFORCE_OWNER_LOGIN_KEY from .env — see docs/ADMIN_RECOVERY.md.");
    }
    throw new Error(raw || "Owner login failed.");
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
  const sanitizedReply = sanitizeMemoryText(reply);
  const failed = isFailedMemoryInteraction(cleanPrompt, sanitizedReply);
  const cleanReply = failed ? FAILED_HISTORY_REPLY : sanitizedReply;
  if (isTrivialChat(cleanPrompt, cleanReply)) return null;
  const now = new Date().toISOString();
  const category = classifyMemory(cleanPrompt);
  const history = {
    id: uid("hist"),
    ws: currentWs(),
    source: "temporary-chat",
    category,
    title: cleanPrompt,
    summary: cleanReply || cleanPrompt,
    prompt: cleanPrompt,
    reply: cleanReply,
    mode,
    route,
    createdAt: now,
    expiresAt: days(CHAT_HISTORY_RETENTION_DAYS),
  };
  store.state.chatHistory = pruneChatHistory([history, ...(store.state.chatHistory || [])]);
  let memory = null;
  if (failed || !isMemoryWorthy(cleanPrompt, cleanReply)) {
    store.save();
    return history;
  }
  const combined = cleanReply ? `User: ${cleanPrompt}\nPhantom: ${cleanReply}` : `User: ${cleanPrompt}`;
  memory = addMemory({
    source: "saved-conversation",
    category,
    title: cleanPrompt,
    summary: cleanReply || cleanPrompt,
    text: combined,
    tags: [mode, route, category].filter(Boolean),
    pinnedByAi: true,
    createdAt: now,
  });
  store.save();
  return memory || history;
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

export function forgetChatHistory(id) {
  store.state.chatHistory = (store.state.chatHistory || []).filter((item) => item.id !== id);
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

export function chatHistoryStats(list = visible(store.state.chatHistory || [])) {
  const items = pruneChatHistory(Array.isArray(list) ? list : []);
  const expiresSoon = items.filter((item) => {
    return Date.now() - new Date(item.createdAt).getTime() > (CHAT_HISTORY_RETENTION_DAYS - 2) * DAY;
  }).length;
  const categories = new Set(items.map((item) => item.category)).size;
  return { total: items.length, categories, expiresSoon };
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
  const finance = normalizeFinance(store.state.finance);
  store.state.finance = finance;
  const transactions = visible(finance.transactions)
    .slice()
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime() || String(b.createdAt).localeCompare(String(a.createdAt)));
  const accounts = visible(finance.accounts);
  const cashIn = transactions.filter((tx) => tx.amount > 0).reduce((sum, tx) => sum + tx.amount, 0);
  const cashOut = transactions.filter((tx) => tx.amount < 0).reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
  const netCash = cashIn - cashOut;
  const ledgerBalance = transactions.reduce((sum, tx) => sum + tx.amount, 0);
  const uncategorizedCount = transactions.filter((tx) => !tx.category || tx.category === "Uncategorized").length;
  const connectedAccounts = accounts.filter((account) => account.status === "connected");
  const readySources = finance.connectors.filter((connector) => connector.status === "ready" || connector.status === "connected").length;
  return {
    open,
    won,
    lost,
    pipeline,
    wonValue,
    retainerMonthly,
    transactions,
    accounts,
    connectors: finance.connectors,
    cashIn,
    cashOut,
    netCash,
    ledgerBalance,
    uncategorizedCount,
    connectedAccounts,
    readySources,
    latestTransaction: transactions[0] || null,
    opportunity: { open, won, lost, pipeline, wonValue, retainerMonthly },
  };
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
  visible(store.state.tasks || []).filter((t) => ["new", "working"].includes(t.status || "new"))
    .forEach((t) => items.push({ icon: "▸", text: `Task ready: ${t.title}`, kind: "task", open: "workforce" }));
  visible(store.state.media).filter((m) => ["pending", "draft", "brief-ready", "generation-approved"].includes(m.status))
    .forEach((m) => items.push({ icon: "▸", text: `Pending media: ${m.title}`, kind: "media", open: "media" }));
  visible(store.state.security).forEach((s) => {
    if (daysUntil(s.rotationDue) <= 30) items.push({ icon: "⚠", text: `Password rotation window closes in ${daysUntil(s.rotationDue)} days`, kind: "security", open: "protect" });
  });
  return items.slice(0, 7);
}

/* ---------------- approvals ---------------- */
/* opts.changesRequested keeps the underlying record untouched (it's not a
   final decision — the worker/automation that prepared it should redo the
   work) and routes the item to a distinct "changes requested" status
   instead of approved/declined, carrying the owner's notes with it. */
export function resolveApproval(id, approved, opts = {}) {
  const a = store.state.approvals.find((x) => x.id === id);
  if (!a || a.status !== "pending") return;
  const { changesRequested = false, notes = "" } = opts;
  a.status = changesRequested ? "changes-requested" : (approved ? "approved" : "declined");
  a.resolvedAt = new Date().toISOString();
  a.ownerNotes = notes || "";
  a.decision = changesRequested ? (approved ? "approve-with-changes" : "disapprove-with-changes") : (approved ? "approve" : "disapprove");
  if (approved && !changesRequested) {
    if (a.type === "publish-review") { const r = store.state.reviews.find((x) => x.id === a.ref); if (r) r.status = "published-ready"; }
    if (a.type === "send-message") { const l = store.state.leads.find((x) => x.id === a.ref); if (l) { l.status = "follow-up"; l.next = "Message approved — send-ready in your outbox"; } }
    if (a.type === "publish-page") { const s = store.state.sites.find((x) => x.id === a.ref); if (s) s.status = "approved-to-publish"; }
    if (a.type === "media-generation") { const m = store.state.media.find((x) => x.id === a.ref); if (m) m.status = "generation-approved"; }
    if (a.type === "booking") { const b = store.state.bookings.find((x) => x.id === a.ref); if (b) b.status = "approved"; }
    if (a.type === "automation") {
      const agent = store.state.agents.find((x) => x.id === a.ref);
      if (agent) { agent.status = "active"; agent.updatedAt = new Date().toISOString(); }
    }
  } else if (!approved && !changesRequested && a.type === "automation") {
    const agent = store.state.agents.find((x) => x.id === a.ref);
    if (agent) { agent.status = "blocked"; agent.updatedAt = new Date().toISOString(); }
  }
  const verb = changesRequested ? `requested changes on (${approved ? "approve" : "disapprove"} path)` : (approved ? "approved" : "declined");
  pushActivity("Command Router", `${verb}: ${a.title}${notes ? ` — "${notes.slice(0, 80)}"` : ""}`, a.ws);
  store.save();
}

export const STATUS_LABEL = {
  "new": "New", "follow-up": "Follow-up", "proposal": "Proposal out", "won": "Won", "lost": "Lost",
  "draft": "Draft", "sent-ready": "Send-ready", "sent": "Sent", "approved": "Approved",
  "brief-ready": "Pending", "generation-approved": "Pending", "generated": "Generated", "delivered": "Generated",
  "publish-ready": "Publish-ready", "approved-to-publish": "Approved to publish", "published-ready": "Published-ready",
  "received": "Received", "pending": "Pending", "declined": "Declined", "changes-requested": "Changes requested", "not-wired": "Not wired", "invoice-ready": "Invoice-ready",
  "watching": "Watching", "online": "Online", "indexed": "Indexed", "scaffolded": "Scaffolded", "ready": "Ready", "enforcing": "Enforcing", "contained": "Contained", "routed": "Routed",
  "active": "Active", "standby": "Standby", "sandbox": "Sandbox", "gated": "Gated",
  "setup-ready": "Setup ready", "available": "Available", "planning": "Planning", "owner-controlled": "Owner-controlled",
  "cataloged": "Cataloged", "server-only": "Server-only", "approval-gated": "Approval-gated",
  "not-scheduled": "Not scheduled",
};
export const statusLabel = (s) => STATUS_LABEL[s] || s;

/* ============================ Phantom Loop ============================
   Phantom Loop is a CHAT-ROUTING preference, not a task/plan/build system:
   "route this reply through another model, then bring the answer back."
   It lives entirely as configuration/state — enabling it never creates a
   task, packet, approval item, or Site Studio action on its own. */
const PHANTOM_LOOP_KEY = "pf.phantomloop.v1";
/* Real backend routing keys (id, models) stay stable — they're sent to the
   phantom-ai/chat route as-is. Display names are generic on purpose: the
   real vendor/model identity only ever surfaces on the owner-only Developer
   page, never in Settings, chat, or any other admin/employee-visible text. */
export const LOOP_PROVIDERS = [
  { id: "openai", name: "Cloud Lane A", models: ["gpt-4o", "gpt-4o-mini", "o3"] },
  { id: "claude", name: "Cloud Lane B", models: ["claude-sonnet-5", "claude-opus-4-8", "claude-haiku-4-5"] },
  { id: "glm", name: "Cloud Router", models: ["glm-5", "openrouter-auto"] },
  { id: "local", name: "Local Lane", models: ["llama3", "mistral", "custom-local"] },
  { id: "custom", name: "Custom endpoint", models: ["custom"] },
];
export function loopProviderName(id) {
  return LOOP_PROVIDERS.find((p) => p.id === id)?.name || id;
}
const MODEL_DISPLAY_LABELS = {
  "gpt-4o": "Fast", "gpt-4o-mini": "Lightweight", "o3": "Deep reasoning",
  "claude-sonnet-5": "Balanced", "claude-opus-4-8": "Deep", "claude-haiku-4-5": "Fast",
  "glm-5": "Standard", "openrouter-auto": "Auto-routed",
  "llama3": "Fast", "mistral": "Balanced", "custom-local": "Custom",
  "custom": "Custom",
};
export const modelDisplayLabel = (id) => MODEL_DISPLAY_LABELS[id] || id;

/* ============================ Phantom Lane Targets ============================
   Owner-only backend mapping for the four chat lanes. These are real routing
   preferences read by command.js before it calls /phantom-ai/chat. */
const PHANTOM_LANE_KEY = "pf.phantomlanes.v1";
export const PHANTOM_LANES = [
  { id: "claude", name: "Phantom Reasoning", role: "Strategy, copy, review", defaultTarget: "claude_cli" },
  { id: "codex", name: "Phantom Code", role: "Code, repo work, implementation", defaultTarget: "codex" },
  { id: "openrouter", name: "Phantom Router", role: "Flexible cloud routing", defaultTarget: "glm_5_2" },
  { id: "local", name: "Phantom Local", role: "Private/local-first work", defaultTarget: "glm_5_2" },
];
export const PHANTOM_LANE_TARGETS = [
  { id: "claude_cli", name: "Claude CLI", provider: "phantom", models: ["claude-cli", "claude-sonnet", "claude-opus"] },
  { id: "codex", name: "Codex / Private Operator", provider: "phantom", models: ["codex-default", "codex-high", "codex-fast"] },
  { id: "glm_5_2", name: "GLM / OpenRouter Route", provider: "openrouter_glm", models: ["z-ai/glm-5.2", "openrouter-auto", "local-glm"] },
];
export function phantomLaneTargetName(id) {
  return PHANTOM_LANE_TARGETS.find((target) => target.id === id)?.name || id;
}
function normalizePhantomLaneConfig(input = {}) {
  const saved = input && typeof input === "object" ? input : {};
  const lanes = {};
  for (const lane of PHANTOM_LANES) {
    const existing = saved.lanes?.[lane.id] || {};
    const target = PHANTOM_LANE_TARGETS.some((item) => item.id === existing.target) ? existing.target : lane.defaultTarget;
    const targetDef = PHANTOM_LANE_TARGETS.find((item) => item.id === target) || PHANTOM_LANE_TARGETS[0];
    const model = targetDef.models.includes(existing.model) ? existing.model : targetDef.models[0];
    lanes[lane.id] = { target, model };
  }
  return { lanes, updatedAt: saved.updatedAt || null };
}
export function loadPhantomLaneConfig() {
  try {
    return normalizePhantomLaneConfig(JSON.parse(localStorage.getItem(PHANTOM_LANE_KEY) || "{}"));
  } catch {
    return normalizePhantomLaneConfig({});
  }
}
export function savePhantomLaneConfig(next) {
  const normalized = normalizePhantomLaneConfig({ ...(next || {}), updatedAt: new Date().toISOString() });
  try { localStorage.setItem(PHANTOM_LANE_KEY, JSON.stringify(normalized)); } catch {}
  return normalized;
}
export function getPhantomLaneTarget(laneId) {
  const cfg = loadPhantomLaneConfig();
  const lane = PHANTOM_LANES.find((item) => item.id === laneId) || PHANTOM_LANES[0];
  const selected = cfg.lanes[lane.id] || { target: lane.defaultTarget };
  return PHANTOM_LANE_TARGETS.find((target) => target.id === selected.target) || PHANTOM_LANE_TARGETS[0];
}
export const PHANTOM_LOOP_DEFAULTS = Object.freeze({
  enabled: false,
  targetProvider: "openai",
  targetModel: "gpt-4o",
  depth: "one_pass",           // one_pass | two_pass | auto
  approvalMode: "safe_auto",   // safe_auto | ask_external | manual
  maxCostPerResponse: null,
  advanced: {
    allowedProviders: ["openai", "claude", "glm", "local", "custom"],
    routingMode: "phantom_to_external_to_phantom",
    maxPasses: 2,
    timeoutMs: 20000,
    sharePrivateContext: false,
    allowToolCalls: false,
    proofLogging: true,
  },
});
export function loadPhantomLoop() {
  try {
    const saved = JSON.parse(localStorage.getItem(PHANTOM_LOOP_KEY) || "{}");
    return {
      ...PHANTOM_LOOP_DEFAULTS,
      ...saved,
      advanced: { ...PHANTOM_LOOP_DEFAULTS.advanced, ...(saved.advanced || {}) },
    };
  } catch {
    return { ...PHANTOM_LOOP_DEFAULTS };
  }
}
export function savePhantomLoop(next) {
  try { localStorage.setItem(PHANTOM_LOOP_KEY, JSON.stringify(next)); } catch {}
  return next;
}
