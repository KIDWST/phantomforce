/* PhantomForce shared product grammar.
   This module has no DOM or storage dependency so it can be tested in Node and
   reused by every browser workspace without becoming a second state store. */

export const CANONICAL_OPERATION_STATUSES = Object.freeze([
  "draft",
  "queued",
  "executing",
  "verifying",
  "needs-approval",
  "scheduled",
  "verified",
  "live",
  "published",
  "paid",
  "connected",
  "partial",
  "failed",
  "cancelled",
  "rejected",
  "expired",
  "unavailable",
  "stale",
  "test",
  "unknown",
]);

const STATUS_SET = new Set(CANONICAL_OPERATION_STATUSES);
const TERMINAL_CLAIMS = new Set(["verified", "live", "published", "paid", "connected"]);
const TERMINAL_STATES = new Set([
  ...TERMINAL_CLAIMS,
  "failed",
  "cancelled",
  "rejected",
  "expired",
]);
const STATUS_ALIASES = Object.freeze({
  proposed: "draft",
  open: "draft",
  pending: "queued",
  ready: "queued",
  standby: "queued",
  approved: "queued",
  "setup-ready": "queued",
  "sent-ready": "queued",
  "publish-ready": "queued",
  "published-ready": "queued",
  "approved-to-publish": "queued",
  "brief-ready": "queued",
  "generation-approved": "queued",
  "pending-approval": "needs-approval",
  pending_approval: "needs-approval",
  "approval-gated": "needs-approval",
  running: "executing",
  working: "executing",
  active: "executing",
  in_progress: "executing",
  "in-progress": "executing",
  processing: "executing",
  succeeded: "verified",
  completed: "verified",
  complete: "verified",
  done: "verified",
  executed: "verified",
  generated: "verified",
  delivered: "verified",
  declined: "rejected",
  canceled: "cancelled",
  error: "failed",
  offline: "unavailable",
  idle: "unknown",
});

const STATUS_META = Object.freeze({
  draft: { label: "Draft", tone: "neutral" },
  queued: { label: "Queued", tone: "info" },
  executing: { label: "Executing", tone: "active" },
  verifying: { label: "Verifying", tone: "active" },
  "needs-approval": { label: "Needs approval", tone: "warning" },
  scheduled: { label: "Scheduled", tone: "info" },
  verified: { label: "Verified", tone: "success" },
  live: { label: "Live", tone: "success" },
  published: { label: "Published", tone: "success" },
  paid: { label: "Paid", tone: "success" },
  connected: { label: "Connected", tone: "success" },
  partial: { label: "Partial", tone: "warning" },
  failed: { label: "Failed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  rejected: { label: "Rejected", tone: "danger" },
  expired: { label: "Expired", tone: "warning" },
  unavailable: { label: "Unavailable", tone: "neutral" },
  stale: { label: "Stale", tone: "warning" },
  test: { label: "Test", tone: "info" },
  unknown: { label: "Unknown", tone: "neutral" },
});

function cleanStatus(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}

export function normalizeOperationStatus(value, { verified = false } = {}) {
  const clean = cleanStatus(value);
  const status = STATUS_SET.has(clean) ? clean : (STATUS_ALIASES[clean] || "unknown");
  if (TERMINAL_CLAIMS.has(status) && !verified) return "verifying";
  return status;
}

export function operationStatusMeta(value, options = {}) {
  const status = normalizeOperationStatus(value, options);
  return Object.freeze({
    status,
    ...STATUS_META[status],
    terminal: TERMINAL_STATES.has(status),
    verifiedClaim: TERMINAL_CLAIMS.has(status),
  });
}

export function knownCount(value) {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) {
    return { known: false, value: null, label: "—" };
  }
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric)
    ? { known: true, value: numeric, label: numeric.toLocaleString() }
    : { known: false, value: null, label: "—" };
}

export function productStateHtml(kind, options = {}) {
  const allowed = new Set(["loading", "empty", "error", "permission", "unavailable"]);
  const state = allowed.has(kind) ? kind : "unavailable";
  const title = escapeHtml(options.title || {
    loading: "Loading",
    empty: "Nothing here yet",
    error: "Something went wrong",
    permission: "Access required",
    unavailable: "Unavailable",
  }[state]);
  const detail = escapeHtml(options.detail || "");
  const action = options.actionLabel && options.actionAttribute
    ? `<button class="btn pf-state-action" type="button" ${safeAttribute(options.actionAttribute)}>${escapeHtml(options.actionLabel)}</button>`
    : "";
  const role = state === "error" ? "alert" : "status";
  const busy = state === "loading" ? ' aria-busy="true"' : "";
  return `<div class="ws-empty pf-state pf-state-${state}" role="${role}"${busy}><b>${title}</b>${detail ? `<span>${detail}</span>` : ""}${action}</div>`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function safeAttribute(value) {
  const text = String(value || "").trim();
  return /^data-[a-z0-9-]+(?:=(?:"[^"]*"|'[^']*'|[a-z0-9_-]+))?$/i.test(text) ? text : "";
}

export function createLatestOperation(owner = "operation") {
  let generation = 0;
  let active = null;

  function cancel(reason = "superseded") {
    if (active && !active.signal.aborted) active.controller.abort(reason);
    active = null;
  }

  function begin(context = {}) {
    cancel("superseded");
    generation += 1;
    const controller = new AbortController();
    const token = Object.freeze({
      id: `${owner}:${generation}`,
      owner,
      generation,
      context: Object.freeze({ ...context }),
      controller,
      signal: controller.signal,
      isCurrent: () => active?.generation === generation && !controller.signal.aborted,
    });
    active = token;
    return token;
  }

  function finish(token) {
    if (active?.generation === token?.generation) active = null;
  }

  async function run(work, handlers = {}, context = {}) {
    const token = begin(context);
    try {
      const value = await work(token);
      if (!token.isCurrent()) return { ok: false, stale: true, cancelled: token.signal.aborted };
      handlers.onValue?.(value, token);
      return { ok: true, value, token };
    } catch (error) {
      const cancelled = token.signal.aborted || error?.name === "AbortError";
      if (cancelled || !token.isCurrent()) return { ok: false, stale: true, cancelled };
      handlers.onError?.(error, token);
      return { ok: false, stale: false, cancelled: false, error, token };
    } finally {
      if (token.isCurrent()) {
        handlers.onFinally?.(token);
        active = null;
      }
    }
  }

  return Object.freeze({
    begin,
    run,
    cancel,
    finish,
    isActive: () => Boolean(active && !active.signal.aborted),
    current: () => active,
  });
}

export function createScopedSelection(initialScope = "") {
  let scope = String(initialScope || "");
  const ids = new Set();

  function switchScope(nextScope) {
    const next = String(nextScope || "");
    if (next === scope) return false;
    scope = next;
    ids.clear();
    return true;
  }

  function replace(nextIds = []) {
    ids.clear();
    for (const id of nextIds) {
      const clean = String(id || "").trim();
      if (clean) ids.add(clean);
    }
    return snapshot();
  }

  function snapshot() {
    return Object.freeze({ scope, ids: Object.freeze([...ids]) });
  }

  return Object.freeze({
    switchScope,
    replace,
    add: (id) => { if (id) ids.add(String(id)); return snapshot(); },
    remove: (id) => { ids.delete(String(id)); return snapshot(); },
    toggle: (id) => { const key = String(id); ids.has(key) ? ids.delete(key) : ids.add(key); return snapshot(); },
    clear: () => replace([]),
    has: (id) => ids.has(String(id)),
    first: () => ids.values().next().value || "",
    snapshot,
  });
}

export function createRouteRegistry(definitions = [], aliases = {}) {
  const routes = new Map();
  const routeAliases = new Map(Object.entries(aliases).map(([from, to]) => [String(from), String(to)]));

  function canonicalId(id) {
    const clean = String(id || "").trim().toLowerCase();
    return routeAliases.get(clean) || clean;
  }

  function register(definition) {
    const id = canonicalId(definition?.id);
    if (!id) throw new Error("Route id is required.");
    const route = Object.freeze({
      id,
      title: definition.title || id,
      authority: definition.authority || "member",
      entitlement: definition.entitlement || null,
      surface: definition.surface || null,
    });
    routes.set(id, route);
    return route;
  }

  definitions.forEach(register);
  return Object.freeze({
    canonicalId,
    register,
    has: (id) => routes.has(canonicalId(id)),
    resolve: (id) => routes.get(canonicalId(id)) || null,
    recover: (id, fallback = "dashboard") => routes.has(canonicalId(id)) ? canonicalId(id) : canonicalId(fallback),
    list: () => Object.freeze([...routes.values()]),
  });
}

export function validateActionReceipt(value) {
  const receipt = value && typeof value === "object" ? value : {};
  const required = ["id", "actor", "orgId", "workspaceId", "module", "objectType", "objectId", "action", "timestamp", "nextState", "status", "verification", "summary"];
  const missing = required.filter((key) => receipt[key] === undefined || receipt[key] === null || receipt[key] === "");
  const rawStatus = cleanStatus(receipt.status);
  const status = normalizeOperationStatus(rawStatus, { verified: receipt.verification?.status === "verified" });
  if (TERMINAL_CLAIMS.has(rawStatus) && receipt.verification?.status !== "verified") {
    missing.push("verification.status=verified");
  }
  return Object.freeze({ ok: missing.length === 0, missing: Object.freeze([...new Set(missing)]), status });
}
