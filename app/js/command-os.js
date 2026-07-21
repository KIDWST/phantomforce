import {
  store,
  ctx,
  visible,
  todaysPlan,
  moneyView,
  memoryStats,
  fmtMoney,
} from "./store.js?v=phantom-live-20260721-23";

let executionMode = "advise";
let syncFrame = 0;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function setText(selector, value) {
  const element = $(selector);
  if (element) element.textContent = value;
}

function plural(count, singular, pluralLabel = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralLabel}`;
}

function setNode(id, value, detail) {
  const node = $(`[data-os-node="${id}"]`);
  if (!node) return;
  const valueElement = $("[data-os-node-value]", node);
  const detailElement = $("[data-os-node-detail]", node);
  if (valueElement) valueElement.textContent = String(value);
  if (detailElement) detailElement.textContent = detail;
  node.dataset.empty = String(value === 0 || value === "—" || value === "Checking");
}

function setDivision(id, value) {
  const target = $(`[data-os-division-status="${id}"]`);
  if (target) target.textContent = value;
}

function visibleCount(list) {
  return visible(Array.isArray(list) ? list : []).length;
}

function liveSystemHealth() {
  const status = ($("[data-status-pills]")?.textContent || "").replace(/\s+/g, " ").trim();
  if (/all systems operational|system status\s*operational/i.test(status)) {
    return { short: "Nominal", detail: "All systems operational" };
  }
  if (/offline|blocked|failed|unreachable/i.test(status)) {
    return { short: "Attention", detail: "Open status for details" };
  }
  if (/online|protected|ready|reachable/i.test(status)) {
    return { short: "Online", detail: "Live status available" };
  }
  return { short: "Checking", detail: "Reading live status" };
}

function liveWorkerCount() {
  const status = ($("[data-status-pills]")?.textContent || "").replace(/\s+/g, " ");
  const match = status.match(/workers online\D{0,20}(\d+)/i);
  if (match) return Number(match[1]);
  return visible(store.state.agents || []).filter((agent) => ["active", "working", "ready"].includes(agent.status)).length;
}

function liveBridgeState() {
  const context = ($("[data-desktop-context]")?.textContent || "").replace(/\s+/g, " ").trim();
  if (/connected|playing|active session/i.test(context) && !/no media|waiting|offline/i.test(context)) return "Connected";
  if (/offline|unreachable|failed/i.test(context)) return "Offline";
  return "Waiting";
}

function syncActiveNavigation() {
  const active = $(".side-nav [data-nav-id].is-active")?.dataset.navId || "dashboard";
  $$(".os-command-rail [data-nav-id], .os-division-strip [data-nav-id]").forEach((button) => {
    const current = button.dataset.navId === active;
    button.classList.toggle("is-active", current);
    if (current) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
}

function syncCommandOS() {
  syncFrame = 0;
  const leads = visibleCount(store.state.leads);
  const agents = visible(store.state.agents || []);
  const pendingApprovals = visible(store.state.approvals || []).filter((item) => item.status === "pending").length;
  const riskRecords = visibleCount(store.state.security);
  const plan = todaysPlan();
  const money = moneyView();
  const memories = memoryStats();
  const health = liveSystemHealth();
  const workers = liveWorkerCount();
  const bridge = liveBridgeState();
  const name = (ctx.session?.name || $("[data-user-name]")?.textContent || "Operator").trim();
  const initial = name.slice(0, 1).toUpperCase() || "P";

  setNode(
    "revenue",
    money.transactions.length ? fmtMoney(money.netCash) : "—",
    money.transactions.length ? plural(money.transactions.length, "confirmed transaction") : "No ledger data",
  );
  setNode("clients", leads, leads ? plural(leads, "organization record") : "No records");
  setNode("missions", agents.length, agents.length ? plural(agents.length, "mission in motion", "missions in motion") : "None in motion");
  setNode("approvals", pendingApprovals, pendingApprovals ? plural(pendingApprovals, "decision waiting") : "None waiting");
  setNode("risk", riskRecords, riskRecords ? plural(riskRecords, "recorded signal") : "No recorded alerts");
  setNode("health", health.short, health.detail);

  setDivision("phantomplay", "Open entertainment operations");
  setDivision("phantomstore", visibleCount(store.state.products) ? plural(visibleCount(store.state.products), "product") : "No products loaded");
  setDivision("media", visibleCount(store.state.media) ? plural(visibleCount(store.state.media), "media item") : "No media loaded");
  setDivision("sites", visibleCount(store.state.sites) ? plural(visibleCount(store.state.sites), "site") : "No sites loaded");
  setDivision("analytics", "Open live intelligence");
  setDivision("intelligence", "Open market watch");
  setDivision("money", money.transactions.length ? plural(money.transactions.length, "confirmed transaction") : "No transactions loaded");

  setText("[data-os-user-name]", name.split(/\s+/)[0] || name);
  setText("[data-os-user-initial]", initial);
  setText("[data-os-approval-label]", pendingApprovals ? `Approvals ${pendingApprovals}` : "Approvals");
  setText("[data-os-mission-count]", `${agents.length} active`);
  setText("[data-os-agent-state]", plan.length || pendingApprovals ? "Attention ready" : "Ready");
  setText("[data-os-bridge-state]", bridge);
  setText("[data-os-bottom-bridge]", bridge);
  setText("[data-os-system-health]", health.short);
  setText("[data-os-memory-count]", `${memories.total} saved`);
  setText("[data-os-worker-count]", `${workers} online`);

  const core = $(".os-node-core");
  if (core) {
    const label = $("b", core);
    const detail = $("i", core);
    if (label) label.textContent = agents.length ? "Working" : "Ready";
    if (detail) detail.textContent = agents.length ? plural(agents.length, "mission routed") : "Operating intelligence";
  }

  const time = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  setText("[data-os-live-time]", time);
  syncActiveNavigation();
}

function scheduleSync() {
  if (syncFrame) return;
  syncFrame = requestAnimationFrame(syncCommandOS);
}

function setExecutionMode(nextMode) {
  if (!['advise', 'plan', 'execute', 'monitor'].includes(nextMode)) return;
  executionMode = nextMode;
  $$("[data-os-execution]").forEach((button) => {
    const active = button.dataset.osExecution === nextMode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  const input = $("[data-command-input]");
  if (input) {
    input.placeholder = {
      advise: "Ask Phantom what should happen next…",
      plan: "Describe the outcome Phantom should plan…",
      execute: "Describe the guarded mission to execute…",
      monitor: "Tell Phantom what to watch…",
    }[nextMode];
    try { input.focus({ preventScroll: true }); } catch { input.focus(); }
  }
}

function setFieldMode(nextMode) {
  const map = $("[data-os-gravity-map]");
  if (!map || !['executive', 'growth', 'operations', 'threat'].includes(nextMode)) return;
  map.dataset.mode = nextMode;
  $$("[data-os-field-mode]").forEach((button) => {
    const active = button.dataset.osFieldMode === nextMode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

export function applyCommandExecutionMode(raw = "") {
  const text = String(raw || "").trim();
  if (!text || executionMode === "advise") return text;
  const directives = {
    plan: "Plan this without taking external action: ",
    execute: "Execute this through PhantomForce's guarded workflow; queue approval for any external action: ",
    monitor: "Monitor this and report changes without taking external action: ",
  };
  return `${directives[executionMode] || ""}${text}`;
}

function bindCommandOS() {
  document.addEventListener("click", (event) => {
    const navButton = event.target.closest(".os-command-rail [data-nav-id], .os-division-strip [data-nav-id]");
    if (navButton) {
      const navId = navButton.dataset.navId;
      if (typeof window.PHANTOM_GO_NAV === "function") {
        event.preventDefault();
        window.PHANTOM_GO_NAV(navId);
        scheduleSync();
        return;
      }
    }
    const execution = event.target.closest("[data-os-execution]");
    if (execution) {
      setExecutionMode(execution.dataset.osExecution);
      return;
    }
    const fieldMode = event.target.closest("[data-os-field-mode]");
    if (fieldMode) {
      setFieldMode(fieldMode.dataset.osFieldMode);
      return;
    }
    if (event.target.closest("[data-os-mission-toggle]")) {
      const shell = $("[data-phantom]");
      const open = !shell?.classList.contains("os-mission-open");
      shell?.classList.toggle("os-mission-open", open);
      $("[data-os-mission-toggle]")?.setAttribute("aria-expanded", String(open));
    }
  });
}

export function initCommandOS() {
  const shell = $("[data-phantom]");
  if (!shell || shell.dataset.commandOsBound === "true") return;
  shell.dataset.commandOsBound = "true";
  shell.classList.add("command-os-enabled");
  document.documentElement.dataset.commandOs = "2040";
  bindCommandOS();
  setExecutionMode("advise");
  setFieldMode("executive");
  store.onChange(scheduleSync);
  const observer = new MutationObserver(scheduleSync);
  observer.observe(shell, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class", "aria-current"] });
  window.addEventListener("resize", () => {
    if (window.innerWidth > 1280) shell.classList.remove("os-mission-open");
    scheduleSync();
  }, { passive: true });
  window.setInterval(scheduleSync, 15000);
  scheduleSync();
}
