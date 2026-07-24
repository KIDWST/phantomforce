import {
  store,
  ctx,
  visible,
  todaysPlan,
  moneyView,
  memoryStats,
  fmtMoney,
} from "./store.js?v=phantom-live-20260723-56";
import { loadSocialAccounts } from "./contenthub.js?v=phantom-live-20260723-56";
import { getOperatorInfrastructureStatus } from "./settings.js?v=phantom-live-20260723-56";

let executionMode = "advise";
let syncFrame = 0;
let signalsSignature = "";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

/* Only write when the value actually changed: the shell MutationObserver
   re-schedules a sync on every DOM write, so unconditional writes would keep
   the sync loop hot every frame instead of settling after one pass. */
function setText(selector, value) {
  const element = $(selector);
  if (element && element.textContent !== String(value)) element.textContent = String(value);
}

function setOperatorModelStatus() {
  const status = getOperatorInfrastructureStatus();
  const value = status.label || "Needs configuration";
  const element = $("[data-os-system-health]");
  const host = element?.closest("[data-os-model-status]");
  setText("[data-os-system-health]", value);
  if (!host) return;
  host.dataset.osTone = status.tone || "warn";
  host.title = status.detail || value;
}

function plural(count, singular, pluralLabel = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralLabel}`;
}

function setNode(id, value, detail) {
  const node = $(`[data-os-node="${id}"]`);
  if (!node) return;
  const valueElement = $("[data-os-node-value]", node);
  const detailElement = $("[data-os-node-detail]", node);
  if (valueElement && valueElement.textContent !== String(value)) valueElement.textContent = String(value);
  if (detailElement && detailElement.textContent !== String(detail)) detailElement.textContent = detail;
  node.dataset.empty = String(value === 0 || value === "—" || value === "Checking");
}

function setDivision(id, value) {
  const target = $(`[data-os-division-status="${id}"]`);
  if (target && target.textContent !== String(value)) target.textContent = value;
}

function setDivisionMetric(id, value) {
  const target = $(`[data-os-division-metric="${id}"]`);
  if (!target) return;
  if (target.textContent !== String(value)) target.textContent = String(value);
  target.dataset.empty = String(value === "—");
}

function fmtCompact(n) {
  const num = Number(n) || 0;
  if (Math.abs(num) >= 1e6) return `${(num / 1e6).toFixed(num % 1e6 === 0 ? 0 : 1)}M`;
  if (Math.abs(num) >= 1e3) return `${(num / 1e3).toFixed(num % 1e3 === 0 ? 0 : 1)}K`;
  return String(num);
}

/* ---- live signals: real data or a truthful empty state, never a prop ---- */

function audienceSignal() {
  let accounts = [];
  try { accounts = loadSocialAccounts(); } catch { accounts = []; }
  const linked = (accounts || []).filter((account) => {
    const report = account?.analytics;
    return report && ((Number(report.impressions) || 0) > 0 || (Array.isArray(report.series) && report.series.length));
  });
  if (!linked.length) return { ready: false };
  const impressions = linked.reduce((sum, account) => sum + (Number(account.analytics.impressions) || 0), 0);
  const engagement = linked.reduce((sum, account) => sum + (Number(account.analytics.engagement) || 0), 0);
  const len = Math.min(30, Math.max(0, ...linked.map((account) => (account.analytics.series || []).length)));
  const series = [];
  for (let i = 0; i < len; i += 1) {
    series.push(linked.reduce((sum, account) => {
      const arr = account.analytics.series || [];
      const point = arr[arr.length - len + i];
      return sum + (Number(point?.impressions) || Number(point?.reach) || 0);
    }, 0));
  }
  const windowDays = len || 30;
  return {
    ready: true,
    impressions,
    engagement,
    series,
    windowDays,
    platforms: linked.length,
    avgPerDay: Math.round(impressions / Math.max(1, windowDays)),
  };
}

function cashSignal() {
  const money = moneyView();
  const txs = money.transactions || [];
  if (!txs.length) return { ready: false };
  const DAY = 86400000;
  const now = Date.now();
  const days = Array.from({ length: 30 }, () => 0);
  let in30 = 0;
  let out30 = 0;
  txs.forEach((tx) => {
    const at = new Date(tx.date || tx.createdAt || 0).getTime();
    const age = Math.floor((now - at) / DAY);
    if (age < 0 || age > 29) return;
    days[29 - age] += Number(tx.amount) || 0;
    if (tx.amount > 0) in30 += tx.amount;
    else out30 += Math.abs(tx.amount);
  });
  return { ready: true, netCash: money.netCash, in30, out30, series: days, count: txs.length };
}

function forceSignal() {
  const agents = visible(store.state.agents || []);
  const running = agents.filter((agent) => ["active", "working", "ready"].includes(agent.status)).length;
  const pending = visible(store.state.approvals || []).filter((item) => item.status === "pending").length;
  const memories = memoryStats().total;
  return { agents: agents.length, running, pending, memories };
}

function sparkMarkup(series) {
  const values = (series || []).map((value) => Math.max(0, Number(value) || 0));
  const peak = Math.max(...values, 1);
  const live = values.some((value) => value > 0);
  if (!live) return `<span class="os-signal-spark is-ghost" aria-hidden="true"></span>`;
  const bars = values
    .map((value) => `<i style="--h:${Math.max(4, Math.round((value / peak) * 100))}%"></i>`)
    .join("");
  return `<span class="os-signal-spark" aria-hidden="true">${bars}</span>`;
}

function pipelineSignal() {
  const money = moneyView();
  const openCount = (money.open || []).length;
  const wonCount = (money.won || []).length;
  if (!openCount && !wonCount) return { ready: false };
  return { ready: true, pipeline: money.pipeline, wonValue: money.wonValue, openCount, wonCount };
}

/* ---- division instrument micro-viz: a small live read on each module ---- */

function miniSparkMarkup(series) {
  const values = (series || []).map((value) => Math.max(0, Number(value) || 0));
  const peak = Math.max(...values, 1);
  if (!values.some((value) => value > 0)) return `<span class="os-mini-spark is-ghost"></span>`;
  const bars = values.slice(-16).map((value) => `<i style="--h:${Math.max(8, Math.round((value / peak) * 100))}%"></i>`).join("");
  return `<span class="os-mini-spark">${bars}</span>`;
}

function cellRowMarkup(count, max = 9) {
  const filled = Math.min(Math.max(0, Number(count) || 0), max);
  let cells = "";
  for (let i = 0; i < max; i += 1) cells += `<i${i < filled ? ' class="is-on"' : ""}></i>`;
  return `<span class="os-cells">${cells}</span>`;
}

function divisionVizMarkup(id) {
  switch (id) {
    case "analytics": { const a = audienceSignal(); return miniSparkMarkup(a.ready ? a.series : []); }
    case "money": { const c = cashSignal(); return miniSparkMarkup(c.ready ? c.series.map(Math.abs) : []); }
    case "phantomstore": return cellRowMarkup(visibleCount(store.state.products));
    case "media": return cellRowMarkup(visibleCount(store.state.media));
    case "sites": return cellRowMarkup(visibleCount(store.state.sites));
    case "phantomplay": return `<span class="os-eq"><i></i><i></i><i></i><i></i><i></i></span>`;
    case "intelligence": return `<span class="os-ping"></span>`;
    default: return "";
  }
}

let divisionVizSignature = "";
function renderDivisionViz() {
  const hosts = $$("[data-os-division-viz]");
  if (!hosts.length) return;
  const audience = audienceSignal();
  const cash = cashSignal();
  const signature = JSON.stringify([
    audience.ready ? audience.impressions : 0,
    cash.ready ? Math.round(cash.netCash) : 0,
    visibleCount(store.state.products),
    visibleCount(store.state.media),
    visibleCount(store.state.sites),
  ]);
  /* Same defence as renderSignals: skip only when unchanged AND the deck is
     still populated (ensureDashboardShell rebuilds the DOM from a pristine
     capture on every view switch, emptying these hosts). */
  if (signature === divisionVizSignature && hosts.every((host) => host.childElementCount)) return;
  divisionVizSignature = signature;
  hosts.forEach((host) => { host.innerHTML = divisionVizMarkup(host.dataset.osDivisionViz); });
}

function tweenValue(element, target, format) {
  const to = Number(target);
  if (!Number.isFinite(to)) {
    if (element.textContent !== String(target)) element.textContent = String(target);
    return;
  }
  const from = Number(element.dataset.tweenAt || 0);
  if (from === to) {
    const settled = format(to);
    if (element.textContent !== settled) element.textContent = settled;
    return;
  }
  element.dataset.tweenAt = String(to);
  cancelAnimationFrame(Number(element.dataset.tweenFrame || 0));
  const started = performance.now();
  const duration = 620;
  const step = (t) => {
    const k = Math.min(1, (t - started) / duration);
    const eased = 1 - Math.pow(1 - k, 3);
    element.textContent = format(Math.round(from + (to - from) * eased));
    if (k < 1) element.dataset.tweenFrame = String(requestAnimationFrame(step));
  };
  element.dataset.tweenFrame = String(requestAnimationFrame(step));
}

function renderSignals() {
  const grid = $("[data-os-signal-grid]");
  if (!grid) return;
  const audience = audienceSignal();
  const cash = cashSignal();
  const force = forceSignal();
  const pipe = pipelineSignal();
  const signature = JSON.stringify([
    audience.ready ? [audience.impressions, audience.platforms, audience.windowDays] : 0,
    cash.ready ? [Math.round(cash.netCash), cash.count] : 0,
    [force.agents, force.running, force.pending, force.memories],
    pipe.ready ? [Math.round(pipe.pipeline), Math.round(pipe.wonValue), pipe.openCount] : 0,
  ]);
  /* The dashboard shell is rebuilt from a pristine innerHTML capture on every
     view switch (ensureDashboardShell), which resets this grid to empty — so
     an unchanged signature only skips the render when the grid is still
     populated. */
  if (signature === signalsSignature && grid.childElementCount) return;
  signalsSignature = signature;

  const audienceBody = audience.ready
    ? `<b class="os-signal-v" data-signal-tween="${audience.impressions}" data-signal-fmt="compact">${fmtCompact(audience.impressions)}</b>
       <i class="os-signal-d">≈ ${fmtCompact(audience.avgPerDay)} views/day · last ${audience.windowDays}d · ${plural(audience.platforms, "platform")}</i>
       ${sparkMarkup(audience.series)}`
    : `<b class="os-signal-v is-empty">—</b>
       <i class="os-signal-d">No platforms linked. Connect one in Analytics.</i>
       ${sparkMarkup([])}`;

  const cashBody = cash.ready
    ? `<b class="os-signal-v" data-signal-tween="${Math.round(cash.netCash)}" data-signal-fmt="money">${fmtMoney(cash.netCash)}</b>
       <i class="os-signal-d">30d: +${fmtMoney(cash.in30)} / −${fmtMoney(cash.out30)} · ${plural(cash.count, "transaction")}</i>
       ${sparkMarkup(cash.series.map(Math.abs))}`
    : `<b class="os-signal-v is-empty">—</b>
       <i class="os-signal-d">No ledger connected. Add transactions in Accounting.</i>
       ${sparkMarkup([])}`;

  const forceOn = force.agents > 0 || force.pending > 0;
  const forceBody = `<b class="os-signal-v" data-signal-tween="${force.agents}" data-signal-fmt="plain">${force.agents}</b>
     <i class="os-signal-d">${force.running} running · ${plural(force.pending, "approval")} waiting · ${plural(force.memories, "memory", "memories")}</i>
     <span class="os-signal-load${forceOn ? " is-on" : ""}" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>`;

  const wonShare = pipe.ready && pipe.pipeline + pipe.wonValue > 0
    ? Math.round((pipe.wonValue / (pipe.pipeline + pipe.wonValue)) * 100)
    : 0;
  const pipeBody = pipe.ready
    ? `<b class="os-signal-v" data-signal-tween="${Math.round(pipe.pipeline)}" data-signal-fmt="money">${fmtMoney(pipe.pipeline)}</b>
       <i class="os-signal-d">${plural(pipe.openCount, "open deal")} · ${fmtMoney(pipe.wonValue)} won</i>
       <span class="os-signal-prop" style="--won:${wonShare}%" aria-hidden="true"></span>`
    : `<b class="os-signal-v is-empty">—</b>
       <i class="os-signal-d">No proposals yet. Draft one in Accounting.</i>
       <span class="os-signal-prop is-ghost" aria-hidden="true"></span>`;

  grid.innerHTML = `
    <button class="os-signal" data-open-ws="analytics" type="button">
      <span class="os-signal-k"><u class="os-signal-led${audience.ready ? " is-on" : ""}"></u>Audience</span>
      ${audienceBody}
    </button>
    <button class="os-signal" data-open-ws="money" type="button">
      <span class="os-signal-k"><u class="os-signal-led${cash.ready ? " is-on" : ""}"></u>Cash flow</span>
      ${cashBody}
    </button>
    <button class="os-signal" data-open-ws="proposals" type="button">
      <span class="os-signal-k"><u class="os-signal-led${pipe.ready ? " is-on" : ""}"></u>Pipeline</span>
      ${pipeBody}
    </button>
    <button class="os-signal" data-open-ws="workforce" type="button">
      <span class="os-signal-k"><u class="os-signal-led${forceOn ? " is-on" : ""}"></u>Force load</span>
      ${forceBody}
    </button>`;

  $$("[data-signal-tween]", grid).forEach((element) => {
    const fmt = element.dataset.signalFmt === "money" ? fmtMoney : element.dataset.signalFmt === "compact" ? fmtCompact : String;
    element.dataset.tweenAt = "0";
    tweenValue(element, Number(element.dataset.signalTween), fmt);
  });
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
  const scheduled = status.match(/workforce\D{0,30}(\d+)\s+scheduled/i);
  if (scheduled) return Number(scheduled[1]);
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

  const products = visibleCount(store.state.products);
  const mediaItems = visibleCount(store.state.media);
  const sites = visibleCount(store.state.sites);
  const audience = audienceSignal();

  setDivision("phantomplay", "Open entertainment operations");
  setDivision("phantomstore", products ? plural(products, "product") : "No products loaded");
  setDivision("media", mediaItems ? plural(mediaItems, "media item") : "No media loaded");
  setDivision("sites", sites ? plural(sites, "site") : "No sites loaded");
  setDivision("analytics", audience.ready ? `${fmtCompact(audience.impressions)} impressions · last ${audience.windowDays}d` : "No platforms linked");
  setDivision("intelligence", "Open market watch");
  setDivision("money", money.transactions.length ? plural(money.transactions.length, "confirmed transaction") : "No transactions loaded");

  setDivisionMetric("phantomplay", "LIVE");
  setDivisionMetric("phantomstore", products ? fmtCompact(products) : "—");
  setDivisionMetric("media", mediaItems ? fmtCompact(mediaItems) : "—");
  setDivisionMetric("sites", sites ? fmtCompact(sites) : "—");
  setDivisionMetric("analytics", audience.ready ? fmtCompact(audience.impressions) : "—");
  setDivisionMetric("intelligence", "—");
  setDivisionMetric("money", money.transactions.length ? fmtMoney(money.netCash) : "—");

  /* Reactive gravity map: a node (and its beam of data flowing into the core)
     energizes only when that metric is real. classList.toggle with the same
     state is a no-op on the attribute, so once data settles this stops firing
     the MutationObserver and the sync loop goes quiet. */
  const liveMap = {
    revenue: money.transactions.length > 0,
    clients: leads > 0,
    missions: agents.length > 0,
    approvals: pendingApprovals > 0,
    risk: riskRecords > 0,
    health: health.short !== "Checking",
  };
  Object.keys(liveMap).forEach((key) => {
    const node = $(`[data-os-node="${key}"]`);
    if (node) node.classList.toggle("is-live", liveMap[key]);
    const flow = $(`.os-flow[data-flow="${key}"]`);
    if (flow) flow.classList.toggle("is-live", liveMap[key]);
    const beam = $(`.os-beam[data-beam="${key}"]`);
    if (beam) beam.classList.toggle("is-live", liveMap[key]);
  });

  renderSignals();
  renderDivisionViz();

  setText("[data-os-user-name]", name.split(/\s+/)[0] || name);
  setText("[data-os-user-initial]", initial);
  setText("[data-os-approval-label]", pendingApprovals ? `Approvals ${pendingApprovals}` : "Approvals");
  setText("[data-os-mission-count]", `${agents.length} active`);
  setText("[data-os-agent-state]", plan.length || pendingApprovals ? "Attention ready" : "Ready");
  setText("[data-os-bridge-state]", bridge);
  setText("[data-os-bottom-bridge]", bridge);
  setOperatorModelStatus();
  setText("[data-os-memory-count]", `${memories.total} saved`);
  setText("[data-os-worker-count]", workers ? `${workers} scheduled` : "Needs work");

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
  ensureDecisionObserver();
  syncDecisionOffset();
  mountHud();
  mountSoundToggle();
  maybePowerOn();
  checkOsEvents();
  refreshNodeCenters();
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

/* .dashboard-brief floats over the gravity map with a real height that
   depends on the greeting's line-wrap (name length) and status text length —
   .decision-deck below it used a fixed CSS top offset, which the greeting
   reliably overflowed into for longer names ("Decisions" overlapping "...next
   outcome."). Measure the actual box instead of assuming its height. The
   deck's own height is capped the same way: a fixed 220px ran into the
   division strip below once the top offset grew to clear a taller greeting,
   so the cap shrinks to whatever room is actually left above the strip. */
let decisionObserverAttached = false;
/* initCommandOS runs exactly once, early in boot() — .dashboard-brief and
   .decision-deck are static markup so they normally exist by then, but
   nothing guarantees it (session verification, gate timing), and a
   ResizeObserver attached to a null target never gets a second chance since
   commandOsBound blocks initCommandOS from ever running again. Retrying this
   from inside syncCommandOS — which already runs repeatedly via store
   changes, the DOM MutationObserver, and a 15s interval — means the observer
   attaches on whichever pass first finds real elements, instead of silently
   never attaching at all. */
function ensureDecisionObserver() {
  if (decisionObserverAttached || !("ResizeObserver" in window)) return;
  const brief = $(".dashboard-brief");
  const strip = $(".os-division-strip");
  if (!brief) return;
  const layoutObserver = new ResizeObserver(syncDecisionOffset);
  layoutObserver.observe(brief);
  if (strip) layoutObserver.observe(strip);
  decisionObserverAttached = true;
}

function syncDecisionOffset() {
  const brief = $(".dashboard-brief");
  const deck = $(".decision-deck");
  if (!brief || !deck) return;
  const top = brief.offsetTop + brief.offsetHeight + 24; // 24px clearance below the greeting
  const parentTop = (deck.offsetParent || deck.parentElement).getBoundingClientRect().top;
  const strip = $(".os-division-strip");
  const stripTop = strip ? strip.getBoundingClientRect().top : Infinity;
  const available = stripTop - (parentTop + top) - 16; // 16px clearance above the strip
  const maxHeight = Math.max(120, Math.min(220, available));
  const nextTop = `${Math.round(top)}px`;
  const nextMax = `${Math.round(maxHeight)}px`;
  if (deck.style.getPropertyValue("--os-decision-top") !== nextTop) {
    deck.style.setProperty("--os-decision-top", nextTop);
  }
  if (deck.style.getPropertyValue("--os-decision-max-height") !== nextMax) {
    deck.style.setProperty("--os-decision-max-height", nextMax);
  }
}

function bindCommandOS() {
  document.addEventListener("click", (event) => {
    const navButton = event.target.closest(".os-command-rail [data-nav-id], .os-division-strip [data-nav-id]");
    if (navButton) {
      const navId = navButton.dataset.navId;
      if (typeof window.PHANTOM_GO_NAV === "function") {
        event.preventDefault();
        window.PHANTOM_GO_NAV(navId);
        osSound("nav");
        scheduleSync();
        return;
      }
    }
    const focusChat = event.target.closest("[data-os-focus-chat]");
    if (focusChat) {
      const chatbox = $("[data-chatbox]");
      const input = $("[data-command-input]");
      if (chatbox) {
        chatbox.classList.remove("os-chat-charged");
        void chatbox.offsetWidth;
        chatbox.classList.add("os-chat-charged");
      }
      try { input?.scrollIntoView({ behavior: "smooth", block: "center" }); } catch {}
      try { input?.focus({ preventScroll: true }); } catch { try { input?.focus(); } catch {} }
      return;
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

/* ============================================================= */
/* ==== OS FEEL — power-on, living HUD, keyboard, real toasts === */
/* ============================================================= */
/* Everything here is view-layer only: reads real store/session state, never
   writes it, and never touches routing or the brain. It's what makes the
   console read as an operating system you drive rather than a page you visit. */

const reduceMotionOS = () => { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };

function osShellVisible() {
  const shell = $("[data-phantom]");
  return !!(shell && !shell.hidden && shell.classList.contains("booted"));
}

/* ---- power-on: the console BOOTS once per session with real telemetry ---- */
const POWERON_KEY = "pf.os.poweron.v1";
let poweredOn = false;
function maybePowerOn() {
  if (poweredOn || !osShellVisible()) return;
  poweredOn = true;
  let seen = false;
  try { seen = sessionStorage.getItem(POWERON_KEY) === "1"; } catch {}
  try { sessionStorage.setItem(POWERON_KEY, "1"); } catch {}
  if (seen || reduceMotionOS()) return;
  const bridge = liveBridgeState();
  const lines = [
    ["MEMORY SPINE", `${memoryStats().total} records indexed`],
    ["WORKFORCE", `${liveWorkerCount()} agents online`],
    ["LOCAL BRIDGE", bridge === "Connected" ? "handshake complete" : "standing by"],
    ["POLICY GUARD", "external actions reviewed"],
    ["PHANTOM CORE", "operating intelligence online"],
  ];
  const el = document.createElement("div");
  el.className = "os-poweron";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = `
    <div class="os-poweron-scan"></div>
    <div class="os-poweron-inner">
      <div class="os-poweron-mark">PHANTOMFORCE<em>OS</em></div>
      <div class="os-poweron-tag">BUSINESS COMMAND · POWER-ON</div>
      <ul class="os-poweron-lines">
        ${lines.map(([k, v], i) => `<li style="--i:${i}"><span>${k}</span><b>${v}</b><u>OK</u></li>`).join("")}
      </ul>
      <div class="os-poweron-done" style="--i:${lines.length}">ALL SYSTEMS NOMINAL</div>
    </div>`;
  document.body.appendChild(el);
  osSound("power");
  const kill = () => { if (!el.isConnected) return; el.classList.add("is-gone"); setTimeout(() => el.remove(), 640); };
  setTimeout(kill, 2200);
  el.addEventListener("click", kill);
}

/* ---- living HUD: a heartbeat + a session uptime that never stops ---- */
let uptimeTimer = 0;
function mountHud() {
  const line = $(".os-system-line");
  if (!line || line.querySelector(".os-hud")) return;
  const hud = document.createElement("span");
  hud.className = "os-hud";
  hud.innerHTML = `
    <svg class="os-ecg" viewBox="0 0 66 16" aria-hidden="true"><polyline points="0,8 22,8 27,8 31,2 35,14 39,8 46,8 51,8 55,5 59,8 66,8"/></svg>
    <i class="os-uptime" data-os-uptime title="Session uptime">00:00:00</i>`;
  line.insertBefore(hud, line.querySelector(".os-system-time"));
  if (uptimeTimer) return;
  let start = 0;
  try { start = Number(sessionStorage.getItem("pf.os.session.start")) || 0; } catch {}
  if (!start) { start = Date.now(); try { sessionStorage.setItem("pf.os.session.start", String(start)); } catch {} }
  const tick = () => {
    const el = $("[data-os-uptime]");
    if (!el) return;
    const s = Math.max(0, Math.floor((Date.now() - start) / 1000));
    const pad = (n) => String(n).padStart(2, "0");
    el.textContent = `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  };
  tick();
  uptimeTimer = window.setInterval(tick, 1000);
}

function mountAmbientOS() {
  if (document.querySelector(".os-ambient")) return;
  const a = document.createElement("div");
  a.className = "os-ambient";
  a.setAttribute("aria-hidden", "true");
  document.body.appendChild(a);
  if (!reduceMotionOS()) {
    const glow = document.createElement("div");
    glow.className = "os-cursor-glow";
    glow.setAttribute("aria-hidden", "true");
    document.body.appendChild(glow);
  }
}

/* ---- keyboard command layer: g-chord navigation + a ? cheatsheet ---- */
const GO_MAP = { d: "dashboard", p: "phantomplay", s: "phantomstore", m: "media", w: "sites", a: "analytics", i: "intelligence", $: "money" };
let goMode = false;
let goTimer = 0;
function osIsTyping(t) { return !!(t && (/^(input|textarea|select)$/i.test(t.tagName) || t.isContentEditable)); }
function paletteOpen() { const c = $("[data-cmdk]"); return !!(c && !c.hidden); }
function setGoMode(on) {
  goMode = on;
  document.documentElement.classList.toggle("os-go-armed", on);
  clearTimeout(goTimer);
  if (on) goTimer = window.setTimeout(() => setGoMode(false), 1600);
}
function toggleCheatsheet(force) {
  const existing = document.querySelector(".os-keys");
  if (existing) { existing.remove(); return; }
  if (force === false) return;
  const rows = [
    ["Launch", [["⌘ K", "Command palette"], ["/", "Talk to Phantom"], ["?", "This sheet"], ["Esc", "Close / back"]]],
    ["Go to  ·  press g then", [["g d", "Dashboard"], ["g p", "PhantomPlay"], ["g s", "PhantomStore"], ["g m", "Media Lab"], ["g w", "Website Builder"], ["g a", "Analytics"], ["g i", "Competitor Intel"], ["g $", "Accounting"]]],
  ];
  const el = document.createElement("div");
  el.className = "os-keys";
  el.innerHTML = `<div class="os-keys-panel" role="dialog" aria-label="Keyboard shortcuts">
    <header><b>COMMAND SHORTCUTS</b><span>? to close</span></header>
    <div class="os-keys-grid">
      ${rows.map(([title, items]) => `<section><h4>${title}</h4>${items.map(([k, label]) => `<p>${k.split(" ").map((key) => `<kbd>${key}</kbd>`).join("")}<i>${label}</i></p>`).join("")}</section>`).join("")}
    </div></div>`;
  el.addEventListener("click", (ev) => { if (ev.target === el) el.remove(); });
  document.body.appendChild(el);
}
function bindKeyboard() {
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { const k = document.querySelector(".os-keys"); if (k) { k.remove(); return; } if (goMode) setGoMode(false); return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (!osShellVisible() || paletteOpen() || osIsTyping(e.target)) { if (goMode) setGoMode(false); return; }
    if (goMode) {
      const id = GO_MAP[e.key];
      setGoMode(false);
      if (id && typeof window.PHANTOM_GO_NAV === "function") { e.preventDefault(); window.PHANTOM_GO_NAV(id); scheduleSync(); osSound("nav"); }
      return;
    }
    if (e.key === "g") { e.preventDefault(); setGoMode(true); return; }
    if (e.key === "?") { e.preventDefault(); toggleCheatsheet(); }
  });
}

/* ---- real-event toasts: the OS proactively surfaces genuine changes ---- */
let toastBaseline = null;
function osToast(title, sub, tone) {
  let host = document.querySelector(".os-toasts");
  if (!host) { host = document.createElement("div"); host.className = "os-toasts"; host.setAttribute("aria-live", "polite"); document.body.appendChild(host); }
  const t = document.createElement("div");
  t.className = `os-toast os-toast-${tone || "info"}`;
  t.innerHTML = `<span class="os-toast-led"></span><div class="os-toast-body"><b>${title}</b>${sub ? `<i>${sub}</i>` : ""}</div>`;
  host.appendChild(t);
  requestAnimationFrame(() => t.classList.add("is-in"));
  const kill = () => { t.classList.remove("is-in"); setTimeout(() => t.remove(), 420); };
  const timer = window.setTimeout(kill, 5400);
  t.addEventListener("click", () => { clearTimeout(timer); kill(); });
}
function pingNode(id) {
  const node = $(`[data-os-node="${id}"]`);
  if (!node || reduceMotionOS()) return;
  node.classList.remove("is-pinging");
  void node.offsetWidth;
  node.classList.add("is-pinging");
  setTimeout(() => node.classList.remove("is-pinging"), 1500);
}
function checkOsEvents() {
  const now = {
    pending: visible(store.state.approvals || []).filter((a) => a.status === "pending").length,
    agents: visible(store.state.agents || []).length,
    leads: visible(store.state.leads || []).length,
  };
  /* First pass establishes the baseline silently — seed/boot data must never
     toast. Skipping while hidden/reduced-motion also advances the baseline, so
     nothing backlogs into a burst the moment the console appears. */
  if (!toastBaseline || !osShellVisible() || reduceMotionOS()) { toastBaseline = now; return; }
  let fired = false;
  if (now.pending > toastBaseline.pending) { osToast("Approval needed", `${plural(now.pending - toastBaseline.pending, "decision")} waiting on you`, "warn"); pingNode("approvals"); fired = true; }
  if (now.agents > toastBaseline.agents) { osToast("Agent deployed", `${plural(now.agents - toastBaseline.agents, "agent")} now in motion`, "ok"); pingNode("missions"); fired = true; }
  if (now.leads > toastBaseline.leads) { osToast("New lead captured", `${plural(now.leads - toastBaseline.leads, "organization record")} added`, "ok"); pingNode("clients"); fired = true; }
  if (fired) osSound("toast");
  toastBaseline = now;
}

/* ---- pointer reactivity: the whole world tilts and lights toward your hand ---- */
let pointerRaf = 0;
let pointerXY = null;
let nodeCenters = [];
function refreshNodeCenters() {
  nodeCenters = $$(".os-node").map((node) => {
    const r = node.getBoundingClientRect();
    return { node, id: node.dataset.osNode, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  });
}
function applyPointer() {
  pointerRaf = 0;
  const root = document.documentElement;
  if (root.dataset.commandOs !== "2040") return;
  if (!pointerXY) {
    root.style.setProperty("--px", "0");
    root.style.setProperty("--py", "0");
    nodeCenters.forEach((n) => { n.node.style.setProperty("--mag", "0"); const b = $(`.os-beam[data-beam="${n.id}"]`); if (b) b.style.setProperty("--mag", "0"); });
    return;
  }
  const w = window.innerWidth || 1;
  const h = window.innerHeight || 1;
  root.style.setProperty("--px", (((pointerXY.x / w) * 2 - 1)).toFixed(3));
  root.style.setProperty("--py", (((pointerXY.y / h) * 2 - 1)).toFixed(3));
  root.style.setProperty("--mx", `${pointerXY.x}px`);
  root.style.setProperty("--my", `${pointerXY.y}px`);
  const R = 230;
  nodeCenters.forEach((n) => {
    const d = Math.hypot(pointerXY.x - n.cx, pointerXY.y - n.cy);
    const mag = Math.max(0, 1 - d / R).toFixed(3);
    n.node.style.setProperty("--mag", mag);
    const beam = $(`.os-beam[data-beam="${n.id}"]`);
    if (beam) beam.style.setProperty("--mag", mag);
  });
}
function bindPointer() {
  if (reduceMotionOS()) return;
  window.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch") return;
    pointerXY = { x: e.clientX, y: e.clientY };
    if (!pointerRaf) pointerRaf = requestAnimationFrame(applyPointer);
  }, { passive: true });
  document.addEventListener("pointerleave", () => { pointerXY = null; if (!pointerRaf) pointerRaf = requestAnimationFrame(applyPointer); });
  window.addEventListener("resize", refreshNodeCenters, { passive: true });
  window.setInterval(refreshNodeCenters, 3000);
}

/* ---- ambient sky: an occasional streak crosses the field ---- */
let starTimer = 0;
function scheduleShootingStar() {
  if (starTimer) return;
  const spawn = () => {
    starTimer = 0;
    if (osShellVisible() && !reduceMotionOS() && !document.hidden) {
      const stage = $(".hero2-stage");
      if (stage) {
        const star = document.createElement("span");
        star.className = "os-shooting-star";
        star.style.setProperty("--y", `${8 + Math.random() * 46}%`);
        star.style.setProperty("--d", `${1.1 + Math.random() * 0.9}s`);
        stage.appendChild(star);
        star.addEventListener("animationend", () => star.remove());
      }
    }
    starTimer = window.setTimeout(spawn, 5200 + Math.random() * 8000);
  };
  starTimer = window.setTimeout(spawn, 3200);
}

/* ---- opt-in sound: synthesized, no assets, off by default ---- */
let audioCtx = null;
let soundOn = false;
let lastHoverBlip = 0;
try { soundOn = localStorage.getItem("pf.os.sound.v1") === "1"; } catch {}
function ensureAudio() {
  if (!audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch {} }
  if (audioCtx && audioCtx.state === "suspended") { try { audioCtx.resume(); } catch {} }
  return audioCtx;
}
function blip(freq, dur, type, gain, when) {
  const ac = audioCtx;
  if (!ac) return;
  const t = ac.currentTime + (when || 0);
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type || "sine";
  osc.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain || 0.05, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(t);
  osc.stop(t + dur + 0.03);
}
function osSound(kind) {
  if (!soundOn || !ensureAudio()) return;
  if (kind === "power") [523, 659, 784, 1047].forEach((f, i) => blip(f, 0.5, "sine", 0.05, i * 0.085));
  else if (kind === "nav") { blip(660, 0.13, "triangle", 0.045); blip(990, 0.1, "sine", 0.028, 0.05); }
  else if (kind === "toast") { blip(784, 0.16, "sine", 0.045); blip(1047, 0.14, "sine", 0.026, 0.07); }
  else if (kind === "hover") { const now = Date.now(); if (now - lastHoverBlip < 90) return; lastHoverBlip = now; blip(1280, 0.04, "sine", 0.016); }
}
function mountSoundToggle() {
  const line = $(".os-system-line");
  if (!line || line.querySelector(".os-sound")) return;
  const btn = document.createElement("button");
  btn.className = `os-sound${soundOn ? " is-on" : ""}`;
  btn.type = "button";
  btn.setAttribute("aria-label", "Toggle interface sound");
  btn.innerHTML = `<span aria-hidden="true"></span><i>SOUND ${soundOn ? "ON" : "OFF"}</i>`;
  btn.addEventListener("click", () => {
    soundOn = !soundOn;
    try { localStorage.setItem("pf.os.sound.v1", soundOn ? "1" : "0"); } catch {}
    btn.classList.toggle("is-on", soundOn);
    btn.querySelector("i").textContent = `SOUND ${soundOn ? "ON" : "OFF"}`;
    if (soundOn) { ensureAudio(); osSound("nav"); }
  });
  line.insertBefore(btn, line.querySelector(".os-system-time"));
}
function bindHoverSound() {
  document.addEventListener("pointerover", (e) => {
    if (!soundOn) return;
    if (e.target.closest(".os-command-rail [data-nav-id], .os-division-strip button, .os-signal, .os-node")) osSound("hover");
  }, { passive: true });
}

export function initCommandOS() {
  const shell = $("[data-phantom]");
  if (!shell || shell.dataset.commandOsBound === "true") return;
  shell.dataset.commandOsBound = "true";
  shell.classList.add("command-os-enabled");
  document.documentElement.dataset.commandOs = "2040";
  bindCommandOS();
  bindKeyboard();
  bindPointer();
  bindHoverSound();
  mountAmbientOS();
  scheduleShootingStar();
  setExecutionMode("advise");
  setFieldMode("executive");
  store.onChange(scheduleSync);
  const observer = new MutationObserver(scheduleSync);
  observer.observe(shell, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class", "aria-current"] });
  window.addEventListener("resize", () => {
    if (window.innerWidth > 1280) shell.classList.remove("os-mission-open");
    scheduleSync();
    syncDecisionOffset();
  }, { passive: true });
  window.setInterval(scheduleSync, 15000);
  if (!("ResizeObserver" in window)) window.addEventListener("resize", syncDecisionOffset, { passive: true });
  ensureDecisionObserver();
  syncDecisionOffset();
  scheduleSync();
}
