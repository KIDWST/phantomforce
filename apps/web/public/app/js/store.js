/* PhantomForce Phantom — data core.
   Everything runs locally in the browser (localStorage). No sends, no posts,
   no payments, no provider calls happen from here — records move through
   draft → approval → *-ready states and stop there until a connector exists. */

const DB_KEY = "pf.phantom.v5";
const SESSION_KEY = "pf.session.v3";
const LIVE_TOKEN_KEY = "pf.live.sessionToken.v1";
const EXECUTION_MODE_KEY = "pf.admin.executionMode.v1";
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
  { id: "operator", name: "Operator", price: 300, blurb: "Upkeep + lead follow-up system + monthly content drop." },
  { id: "partner", name: "Partner", price: 625, range: "$500–$750", blurb: "Full operating system running weekly: media, pipeline, protection." },
];

export const POSTING_CONNECTORS = [
  {
    id: "gmail",
    name: "Gmail",
    worker: "Inbox Operator",
    category: "email",
    state: "available",
    adminState: "ready",
    clientState: "locked",
    cadence: "email · follow-up · reviews",
    capabilities: ["Draft", "Reply", "Follow up", "Review ask"],
    access: "Google",
    next: "Pick workspace + sender.",
  },
  {
    id: "google-calendar",
    name: "Google Calendar",
    worker: "Booking Coordinator",
    category: "calendar",
    state: "available",
    adminState: "ready",
    clientState: "locked",
    cadence: "bookings · reminders · schedule",
    capabilities: ["Book", "Hold", "Remind", "Reschedule"],
    access: "Google",
    next: "Connect client calendar.",
  },
  {
    id: "google-drive",
    name: "Google Drive",
    worker: "Asset Librarian",
    category: "files",
    state: "available",
    adminState: "ready",
    clientState: "locked",
    cadence: "docs · assets · deliverables",
    capabilities: ["Docs", "Folders", "Assets", "Proof"],
    access: "Google",
    next: "Choose target folder.",
  },
  {
    id: "youtube",
    name: "YouTube",
    worker: "Channel Publisher",
    category: "social",
    state: "setup-needed",
    adminState: "configure",
    clientState: "locked",
    cadence: "videos · shorts · posts · images",
    capabilities: ["Videos", "Shorts", "Posts", "Thumbnails"],
    access: "platform OAuth required",
    next: "Connect channel.",
  },
  {
    id: "instagram",
    name: "Instagram",
    worker: "Social Publisher",
    category: "social",
    state: "setup-needed",
    adminState: "configure",
    clientState: "locked",
    cadence: "reels · posts · stories · images",
    capabilities: ["Reels", "Posts", "Carousels", "Stories"],
    access: "Meta business OAuth required",
    next: "Connect Meta.",
  },
  {
    id: "facebook",
    name: "Facebook",
    worker: "Community Publisher",
    category: "social",
    state: "setup-needed",
    adminState: "configure",
    clientState: "locked",
    cadence: "posts · reels · events · images",
    capabilities: ["Posts", "Reels", "Events", "Photos"],
    access: "Meta page OAuth required",
    next: "Connect page.",
  },
  {
    id: "tiktok",
    name: "TikTok",
    worker: "Shorts Publisher",
    category: "social",
    state: "setup-needed",
    adminState: "configure",
    clientState: "locked",
    cadence: "videos · photo posts · captions",
    capabilities: ["Videos", "Photo posts", "Captions", "Trends"],
    access: "TikTok developer/OAuth required",
    next: "Connect account.",
  },
];

export function tenantIdForWorkspace(id = "phantomforce") {
  if (id === "phantomforce") return "phantomforce-owner";
  return `workspace-${id}`;
}

/* ---------------- internal tool spine ---------------- */
export const TOOL_SPINE = [
  {
    id: "private-gateway",
    name: "Private Gateway",
    internal: "Private gateway layer",
    worker: "Access Sentinel",
    mode: "active",
    status: "watching",
    role: "Keeps admin Phantom reachable through the private route while hiding raw local ports.",
    activity: "gateway system ready; no client route change running.",
    path: "private access route",
    visibleToClients: false,
  },
  {
    id: "memory-core",
    name: "Memory Core",
    internal: "Private memory layer",
    worker: "Memory Keeper",
    mode: "active",
    status: "online",
    role: "Compiles context, receipts, redaction notes, and useful memory for Phantom AI.",
    activity: "memory system ready; waiting for workspace-specific client history.",
    path: "private memory records",
    visibleToClients: false,
  },
  {
    id: "process-vault",
    name: "Process Vault",
    internal: "Private process vault",
    worker: "Vault Scribe",
    mode: "active",
    status: "indexed",
    role: "Stores sanitized decisions, process notes, verification logs, and operating memory.",
    activity: "process vault ready; sanitized notes only.",
    path: "private process memory",
    visibleToClients: false,
  },
  {
    id: "automation-fabric",
    name: "Automation Desk",
    internal: "Private automation layer",
    worker: "Workflow Runner",
    mode: "active",
    status: "ready",
    role: "Holds workflow drafts for repeatable work, daily content plans, and connector-ready automations.",
    activity: "automation system ready; waiting for an approved workflow to run.",
    path: "private automation plans",
    visibleToClients: false,
  },
  {
    id: "build-planner",
    name: "Build Planner",
    internal: "Private build planning layer",
    worker: "Spec Architect",
    mode: "active",
    status: "ready",
    role: "Turns big requests into scoped proposals, tasks, and implementation guardrails.",
    activity: "build-planning system ready; no client spec running.",
    path: "private build plans",
    visibleToClients: false,
  },
  {
    id: "phantomops",
    name: "Operator Standards",
    internal: "PhantomOps standards layer",
    worker: "PhantomOps",
    mode: "active",
    status: "enforcing",
    role: "Keeps agent work structured around standards, handoffs, and owner-safe execution.",
    activity: "operator standards ready; no client command active.",
    path: "private operating standards",
    visibleToClients: false,
  },
  {
    id: "code-intelligence",
    name: "Code Intelligence",
    internal: "Private code intelligence",
    worker: "Code Navigator",
    mode: "active",
    status: "indexed",
    role: "Supports semantic repo navigation and code understanding.",
    activity: "code intelligence system ready; no repo scan running.",
    path: "private repo intelligence",
    visibleToClients: false,
  },
  {
    id: "squad-planner",
    name: "Squad Planner",
    internal: "Private squad planning",
    worker: "Swarm Planner",
    mode: "active",
    status: "ready",
    role: "Provides multi-agent planning vocabulary and squad patterns for owner-controlled work.",
    activity: "squad planning system ready; coordinating Phantom systems by outcome.",
    path: "private squad plans",
    visibleToClients: false,
  },
  {
    id: "phantomcut",
    name: "Media Engine",
    internal: "Media Lab engine",
    worker: "Media Factory",
    mode: "active",
    status: "ready",
    role: "Prepares commercial video generation, Resolve/REAPER bridges, and daily content packaging.",
    activity: "media generation system ready; paid runs require a receipt.",
    path: "C:\\Users\\jorda\\Documents\\PhantomForce-MediaLab\\phantomcut-ai",
    visibleToClients: false,
  },
  {
    id: "model-lanes",
    name: "Model Switchboard",
    internal: "Private model systems",
    worker: "Brain Router",
    mode: "active",
    status: "routed",
    role: "Routes admin-only thinking, review, coding, and model systems behind Phantom AI.",
    activity: "brain routing system ready; workspace memory stays scoped.",
    path: "server/src/phantom-ai/providers",
    visibleToClients: false,
  },
];

function toolActivitySeed() {
  return TOOL_SPINE.map((tool, i) => ({
    id: uid("act"),
    ws: "phantomforce",
    who: tool.worker,
    text: tool.activity,
    at: days(-(0.02 + i * 0.035)),
    toolId: tool.id,
  }));
}

/* ---------------- seed ---------------- */
function seed() {
  const workspaces = [
    { id: "phantomforce", name: "PhantomForce", kind: "HQ", tagline: "Owner workspace. Real work appears here only after you create or import it." },
    { id: "chicagoshots", name: "ChicagoShots", kind: "Brand", tagline: "Media brand workspace. Starts clean until ChicagoShots work is added." },
    { id: "test-client", name: "Test Client", kind: "Client", tagline: "Clean client sandbox. Client memory and records stay separate from Jordan's HQ." },
  ];

  const leads = [];
  const proposals = [];
  const reviews = [];
  const bookings = [];
  const media = [];
  const sites = [];
  const products = [];
  const security = [];
  const approvals = [];
  const tasks = [];

  const agents = [
    { id: "ag-router", name: "Command Router", role: "Reads requests and routes them to the right Phantom system.", status: "active", mission: "Standing by for the first real command.", d1: 0, d7: 0, d30: 0, tokens: "0", cost: "$0.00", last: "No client work yet.", next: "Route the first client request.", bundle: "PhantomOps router · model system A" },
    { id: "ag-leads", name: "Lead Hunter", role: "Captures and qualifies leads once they exist.", status: "active", mission: "Ready for the first real lead.", d1: 0, d7: 0, d30: 0, tokens: "0", cost: "$0.00", last: "No client work yet.", next: "Capture first lead.", bundle: "PhantomOps + intake specs" },
    { id: "ag-forge", name: "Proposal Forge", role: "Turns qualified leads into priced, scoped proposals.", status: "active", mission: "Ready to draft the first proposal.", d1: 0, d7: 0, d30: 0, tokens: "0", cost: "$0.00", last: "No client work yet.", next: "Draft first proposal.", bundle: "Spec templates + pricing ladder" },
    { id: "ag-media", name: "Media Factory", role: "Briefs, shot lists, captions, and controlled generation.", status: "active", mission: "Ready to create the first media brief.", d1: 0, d7: 0, d30: 0, tokens: "0", cost: "$0.00", last: "No client work yet.", next: "Create first media brief.", bundle: "Media Lab system (paid, receipt-based)" },
    { id: "ag-image", name: "Image Creator", role: "Turns prompts into image briefs, thumbnails, ads, and product visuals.", status: "active", mission: "Ready to create the first image brief.", d1: 0, d7: 0, d30: 0, tokens: "0", cost: "$0.00", last: "No image work yet.", next: "Create first image brief.", bundle: "Media Lab image lane" },
    { id: "ag-operator", name: "Phantom Operator", role: "Admin-only local operator work: inspect, plan, edit, test, and run controlled computer actions.", status: "active", mission: "Ready for the first admin operator task.", d1: 0, d7: 0, d30: 0, tokens: "0", cost: "$0.00", last: "No operator task yet.", next: "Prepare first operator task.", bundle: "Private admin operator lane" },
    { id: "ag-site", name: "Site Builder", role: "Drafts pages, landing pages, and site rebuilds.", status: "active", mission: "Ready to build the first page or store.", d1: 0, d7: 0, d30: 0, tokens: "0", cost: "$0.00", last: "No client work yet.", next: "Build first page or store.", bundle: "Build system + section library" },
    { id: "ag-store", name: "Store Builder", role: "Catalogs, product cards, and checkout readiness.", status: "active", mission: "Ready to add the first product or service.", d1: 0, d7: 0, d30: 0, tokens: "0", cost: "$0.00", last: "No client work yet.", next: "Add first product or service.", bundle: "Catalog specs · checkout unwired" },
    { id: "ag-sec", name: "Security Watch", role: "Monthly scans, breach checks, rotation reminders.", status: "active", mission: "Ready for the first approved scan.", d1: 0, d7: 0, d30: 0, tokens: "0", cost: "$0.00", last: "No client work yet.", next: "Run first approved scan.", bundle: "Scan cadence + posture checks" },
    { id: "ag-review", name: "Review Desk", role: "Requests, collects, and stages testimonials.", status: "active", mission: "Ready to draft the first review request.", d1: 0, d7: 0, d30: 0, tokens: "0", cost: "$0.00", last: "No client work yet.", next: "Draft first review request.", bundle: "Request→approve→publish pipeline" },
    { id: "ag-follow", name: "Follow-Up Desk", role: "Keeps open threads from going quiet.", status: "active", mission: "Ready to create the first follow-up.", d1: 0, d7: 0, d30: 0, tokens: "0", cost: "$0.00", last: "No client work yet.", next: "Create first follow-up.", bundle: "Cadence engine + drafts" },
    { id: "ag-money", name: "Revenue Tracker", role: "Pipeline, proposals, retainers, and what's unpaid.", status: "active", mission: "Ready to track the first quote or win.", d1: 0, d7: 0, d30: 0, tokens: "0", cost: "$0.00", last: "No client work yet.", next: "Track first quote or win.", bundle: "Ledger view · invoicing unwired" },
    { id: "ag-book", name: "Booking Coordinator", role: "Appointment drafts, confirmations, reschedules.", status: "active", mission: "Ready to draft the first appointment.", d1: 0, d7: 0, d30: 0, tokens: "0", cost: "$0.00", last: "No client work yet.", next: "Draft first appointment.", bundle: "Calendar system (receipt-based)" },
    { id: "ag-deliver", name: "Delivery Manager", role: "Keeps sold work moving to done.", status: "active", mission: "Ready for the first delivery item.", d1: 0, d7: 0, d30: 0, tokens: "0", cost: "$0.00", last: "No client work yet.", next: "Create first delivery item.", bundle: "Task + deliverable tracking" },
    { id: "ag-clean", name: "Data Cleaner", role: "Dedupes, tags, and keeps records tidy.", status: "active", mission: "Ready when data exists.", d1: 0, d7: 0, d30: 0, tokens: "0", cost: "$0.00", last: "No client work yet.", next: "Clean when data exists.", bundle: "Hygiene rules + memory sync" },
  ];

  const activity = [];
  const workspaceMemory = Object.fromEntries(workspaces.map((w) => [w.id, {
    tenantId: tenantIdForWorkspace(w.id),
    summary: "",
    entries: [],
    createdAt: new Date().toISOString(),
  }]));

  const postingConnectors = POSTING_CONNECTORS;
  const automationConfig = {
    monthlySecurityScans: { state: "ready", cadence: "monthly", nextRunLabel: "after first workspace scan setup" },
    dailyContentEngine: { state: "ready", cadence: "daily", channels: ["YouTube", "Instagram", "Facebook", "TikTok"], mode: "draft-pack first, publish after connector approval" },
    reviewEngine: { state: "ready", cadence: "after delivery", mode: "request, collect, approve, publish-ready" },
  };

  return { version: 5, workspaces, leads, proposals, reviews, bookings, media, sites, products, security, approvals, tasks, agents, toolSpine: TOOL_SPINE, postingConnectors, automationConfig, activity, workspaceMemory };
}

/* ---------------- store ---------------- */
function normalizeData(data) {
  const seeded = seed();
  const d = data && typeof data === "object" ? data : seeded;
  d.workspaces ||= seeded.workspaces;
  d.leads ||= seeded.leads;
  d.proposals ||= seeded.proposals;
  d.reviews ||= seeded.reviews;
  d.bookings ||= seeded.bookings;
  d.media ||= seeded.media;
  d.sites ||= seeded.sites;
  d.products ||= seeded.products;
  d.security ||= seeded.security;
  d.approvals ||= seeded.approvals;
  d.tasks ||= seeded.tasks;
  d.agents = seeded.agents.map((agent) => ({ ...(d.agents || []).find((x) => x.id === agent.id), ...agent }));
  d.toolSpine = TOOL_SPINE.map((tool) => ({ ...tool, ...(d.toolSpine || []).find((x) => x.id === tool.id) }));
  d.postingConnectors = POSTING_CONNECTORS.map((connector) => {
    const saved = (d.postingConnectors || []).find((x) => x.id === connector.id);
    return {
      ...saved,
      ...connector,
      state: saved?.state || connector.state,
      adminState: saved?.adminState || connector.adminState,
      clientState: saved?.clientState || connector.clientState,
    };
  });
  d.automationConfig = { ...seeded.automationConfig, ...(d.automationConfig || {}) };
  d.workspaceMemory ||= Object.fromEntries(d.workspaces.map((w) => [w.id, {
    tenantId: tenantIdForWorkspace(w.id),
    summary: "",
    entries: [],
    createdAt: new Date().toISOString(),
  }]));
  d.activity ||= [];
  d.activity = d.activity.slice(0, 80);
  d.version = 5;
  return d;
}

function load() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && d.version === 5) return normalizeData(d);
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
  reset() { try { localStorage.removeItem(DB_KEY); } catch {} this.state = seed(); this.save(); },
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

export const executionMode = {
  get() {
    try {
      const value = localStorage.getItem(EXECUTION_MODE_KEY);
      return value === "auto" ? "auto" : "approval";
    } catch {
      return "approval";
    }
  },
  set(value) {
    const clean = value === "auto" ? "auto" : "approval";
    try { localStorage.setItem(EXECUTION_MODE_KEY, clean); } catch {}
    try {
      window.dispatchEvent(new CustomEvent("phantom:execution-mode", { detail: { mode: clean } }));
    } catch {}
    return clean;
  },
  label() {
    return executionMode.get() === "auto" ? "Auto Mode" : "Review Mode";
  },
  description() {
    return executionMode.get() === "auto"
      ? "Auto runs safe internal workspace actions. External/world-changing actions still need a proper system path and receipt."
      : "Outside actions wait for review before execution.";
  },
};

export const ADMIN_PUBLIC_HOST = "admin.phantomforce.online";
export const PUBLIC_PAGES_HOSTS = new Set(["phantomforce.online", "www.phantomforce.online"]);

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
  if (key === "owner-admin" || key === "admin" || key === "jordan") {
    if (isStaticPublicHost()) {
      redirectToLiveAdmin();
      return null;
    }
    const s = { role: "admin", name: "Jordan", ws: "phantomforce" };
    session.set(s); return s;
  }
  if (key === "client" || key === "test-client" || key === "client-test") {
    const s = { role: "client", name: "Test Client", ws: "test-client" };
    session.set(s); return s;
  }
  const saved = session.get();
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
  const s = {
    role: "admin",
    name: payload.session.label || "Jordan",
    ws: "phantomforce",
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
  const s = { role: "admin", name: payload.session.label || "Jordan", ws: "phantomforce", token };
  session.set(s);
  return s;
}

/* ---------------- selectors ---------------- */
export const ctx = { session: null };
export const isAdmin = () => ctx.session?.role === "admin";
export const currentWs = () => ctx.session?.ws || "phantomforce";
export const setWorkspace = (id) => { if (!isAdmin()) return; ctx.session.ws = id; session.set(ctx.session); store.save(); };

/* Admin at HQ sees everything; admin inside a workspace or any client sees
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
    .forEach((m) => items.push({ icon: "▸", text: `Media brief ready: ${m.title}`, kind: "media", open: "media" }));
  visible(store.state.tasks || []).filter((t) => ["new", "working"].includes(t.status))
    .forEach((t) => items.push({ icon: "▸", text: t.title, kind: "task", open: t.open || "adminos" }));
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
    if (a.type === "drive-file") { a.detail = `${a.detail} Connector required before Google Drive write.`; }
  }
  pushActivity("Command Router", `${approved ? "approved" : "declined"}: ${a.title}`, a.ws);
  store.save();
}

export const STATUS_LABEL = {
  "new": "New", "follow-up": "Follow-up", "proposal": "Proposal out", "won": "Won", "lost": "Lost",
  "draft": "Draft", "sent-ready": "Send-ready", "sent": "Sent", "approved": "Approved",
  "brief-ready": "Brief ready", "image-ready": "Image ready", "asset-saved": "Saved", "generation-approved": "Generation ready", "delivered": "Delivered",
  "publish-ready": "Publish-ready", "approved-to-publish": "Approved to publish", "published-ready": "Published-ready",
  "received": "Received", "pending": "Pending", "declined": "Declined", "not-wired": "Not wired", "invoice-ready": "Invoice-ready",
  "working": "Working",
  "watching": "Watching", "online": "Online", "indexed": "Indexed", "scaffolded": "Scaffolded", "ready": "Ready", "enforcing": "Enforcing", "contained": "Contained", "routed": "Routed",
  "active": "Active", "standby": "Standby", "sandbox": "Sandbox", "gated": "Controlled",
  "available": "Available", "setup-needed": "Configure", "configure": "Configure", "locked": "Locked",
};
export const statusLabel = (s) => STATUS_LABEL[s] || s;
