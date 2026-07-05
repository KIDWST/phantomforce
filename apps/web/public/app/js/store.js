/* PhantomForce Phantom — data core.
   Everything runs locally in the browser (localStorage). No sends, no posts,
   no payments, no provider calls happen from here — records move through
   draft → approval → *-ready states and stop there until a connector exists. */

import { APIFY_DEFAULT_STATE, APIFY_TOOL_SPINE } from "./apify-tools.js?v=phantom-live-20260705-17";

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

/* ---------------- internal tool spine ---------------- */
export const TOOL_SPINE = [
  {
    id: "pangolin",
    name: "Private Gateway",
    internal: "Pangolin + Newt",
    worker: "Access Sentinel",
    mode: "active",
    status: "watching",
    role: "Keeps admin Phantom reachable through the private route while hiding raw local ports.",
    ownerControl: "Owner access is live through the private route. Raw local ports stay hidden from everybody else.",
    activity: "watching admin.phantomforce.online route and keeping backend ports private.",
    path: "ops/admin-live",
    visibleToClients: false,
  },
  {
    id: "hermes",
    name: "Memory Core",
    internal: "Hermes",
    worker: "Memory Keeper",
    mode: "active",
    status: "online",
    role: "Compiles context, receipts, redaction notes, and useful memory for Phantom AI.",
    ownerControl: "Admin memory is on. Client workspaces keep their own separate memory unless you connect them.",
    activity: "compiled owner context, redacted receipts, and memory hints for Phantom AI.",
    path: "server/src/phantom-ai/hermes-*",
    visibleToClients: false,
  },
  {
    id: "obsidian",
    name: "Process Vault",
    internal: "Obsidian",
    worker: "Vault Scribe",
    mode: "active",
    status: "indexed",
    role: "Stores sanitized decisions, process notes, verification logs, and operating memory.",
    ownerControl: "Owner process memory is indexed. Secrets stay out of the vault.",
    activity: "indexed the PhantomForce Command Center vault for process memory.",
    path: "C:\\Users\\jorda\\Documents\\Obsidian\\PhantomForce-Command-Center",
    visibleToClients: false,
  },
  {
    id: "n8n",
    name: "Automation Desk",
    internal: "n8n",
    worker: "Workflow Runner",
    mode: "setup-ready",
    status: "ready",
    role: "Builds repeat workflows for follow-ups, content, reviews, and handoffs.",
    ownerControl: "Ready for owner setup. Turn on each workflow when the connector and rules are correct.",
    activity: "automation desk is ready for owner-configured workflows.",
    path: "ops/n8n",
    visibleToClients: false,
  },
  {
    id: "openspec",
    name: "Build Planner",
    internal: "OpenSpec",
    worker: "Spec Architect",
    mode: "active",
    status: "ready",
    role: "Turns big requests into scoped proposals, tasks, and implementation guardrails.",
    ownerControl: "Available for planning real builds, client packages, and sprint scopes.",
    activity: "standing by to turn the next feature request into a scoped build plan.",
    path: "C:\\Users\\jorda\\Documents\\PhantomForce-AgentLab\\tool-candidates\\openspec",
    visibleToClients: false,
  },
  {
    id: "phantomops",
    name: "Operator Standards",
    internal: "PhantomOps",
    worker: "PhantomOps",
    mode: "active",
    status: "enforcing",
    role: "Keeps agent work structured around standards, handoffs, and owner-safe execution.",
    ownerControl: "Keeps the team organized without exposing tool names to clients.",
    activity: "enforcing PhantomOps standards across command routing and worker handoffs.",
    path: "C:\\Users\\jorda\\Documents\\PhantomForce-AgentLab\\tool-candidates\\agent-os",
    visibleToClients: false,
  },
  {
    id: "serena",
    name: "Code Intelligence",
    internal: "Serena",
    worker: "Code Navigator",
    mode: "available",
    status: "indexed",
    role: "Helps Phantom understand codebases, routes, files, and repo structure.",
    ownerControl: "Available for owner diagnostics and build planning. Write actions stay routed through owner mode.",
    activity: "code intelligence is indexed and ready for owner diagnostics.",
    path: "C:\\Users\\jorda\\Documents\\PhantomForce-AgentLab\\tool-candidates\\serena",
    visibleToClients: false,
  },
  {
    id: "ruflo",
    name: "Squad Planner",
    internal: "Ruflo",
    worker: "Swarm Planner",
    mode: "planning",
    status: "ready",
    role: "Plans multi-step agent work, handoffs, and team-style workflows.",
    ownerControl: "Ready for owner planning. It becomes real work only when you send the command.",
    activity: "squad planning is ready for owner-directed work.",
    path: "C:\\Users\\jorda\\Documents\\PhantomForce-AgentLab\\tool-candidates\\ruflo",
    visibleToClients: false,
  },
  {
    id: "phantomcut",
    name: "Media Engine",
    internal: "PhantomCut + Higgsfield",
    worker: "Media Factory",
    mode: "owner-controlled",
    status: "ready",
    role: "Creates image/video plans, edits, and commercial generation requests.",
    ownerControl: "Ready in Media Lab. Paid credits and external runs stay owner-controlled.",
    activity: "Media Lab is ready for owner-controlled creative work.",
    path: "C:\\Users\\jorda\\Documents\\PhantomForce-MediaLab\\phantomcut-ai",
    visibleToClients: false,
  },
  {
    id: "model-lanes",
    name: "Model Switchboard",
    internal: "Codex / Claude / GLM",
    worker: "Brain Router",
    mode: "active",
    status: "routed",
    role: "Routes admin-only thinking, review, coding, and worker model lanes behind Phantom AI.",
    ownerControl: "Owner brain routing is active. Clients only see Phantom, not the backend model names.",
    activity: "routing requests through the correct brain lane while keeping tool names hidden.",
    path: "server/src/phantom-ai/providers",
    visibleToClients: false,
  },
  ...APIFY_TOOL_SPINE,
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
    toolSpine: TOOL_SPINE,
    apify: { ...APIFY_DEFAULT_STATE },
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
  d.toolSpine = TOOL_SPINE.map((tool) => ({ ...tool, ...(d.toolSpine || []).find((x) => x.id === tool.id) }));
  d.apify = { ...APIFY_DEFAULT_STATE, ...(d.apify && typeof d.apify === "object" ? d.apify : {}) };
  d.apify.selectedActorIds = Array.isArray(d.apify.selectedActorIds) ? d.apify.selectedActorIds : [];
  d.apify.selectedRecipeIds = Array.isArray(d.apify.selectedRecipeIds) ? d.apify.selectedRecipeIds : [];
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
