/* PhantomForce — PhantomWire layer.
   A live, honest picture of the internal worker spine: a scrolling report
   ticker, a tail-style operations log, a worker roster with status LEDs, and
   session telemetry. Everything here is driven by the real TOOL_SPINE workers
   (store.js) — no fabricated business records. Self-contained: owns its own
   timers, guards against double-mount, and respects reduced-motion. */

import { session, store, TOOL_SPINE } from "./store.js?v=phantom-live-20260723-55";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* mode → visual tone + short label (drives the status LED colour) */
const MODE_META = {
  active:  { tone: "on",   tag: "LIVE" },
  standby: { tone: "idle", tag: "STDBY" },
  gated:   { tone: "gate", tag: "GATED" },
  sandbox: { tone: "hold", tag: "SANDBOX" },
};
const modeMeta = (m) => MODE_META[m] || { tone: "idle", tag: String(m || "").toUpperCase() };

/* short agent code, e.g. "Access Sentinel" -> "ACS" */
function agentCode(worker) {
  const parts = String(worker || "").split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0] + (parts[1][1] || "")).toUpperCase();
  return String(worker || "AGT").slice(0, 3).toUpperCase();
}

const now2 = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

let workforceCache = null;
let workforceLoading = false;

async function fetchWorkforce() {
  if (workforceLoading) return;
  workforceLoading = true;
  try {
    const token = session.token();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const response = await fetch("/phantom-ai/agents/status?window_hours=24", { headers });
    const payload = await response.json().catch(() => null);
    if (response.ok && payload?.ok) workforceCache = payload.workforce;
  } catch {
    workforceCache = null;
  } finally {
    workforceLoading = false;
  }
}

function modeForTicker(item) {
  if (item?.tone === "error") return "gated";
  if (item?.tone === "attention") return "standby";
  return "active";
}

function wireItems(limit = 14) {
  const ticker = Array.isArray(workforceCache?.ticker) ? workforceCache.ticker : [];
  if (ticker.length) {
    return ticker.slice(0, limit).map((item) => ({
      worker: item.label || "Worker",
      internal: item.tone === "activity" ? "Agent receipt" : "Worker attention",
      activity: item.text || "Status recorded.",
      mode: modeForTicker(item),
    }));
  }
  const jobs = Number(workforceCache?.summary?.enabled_automation_jobs || 0);
  const attention = Number(workforceCache?.summary?.automation_jobs_needing_attention || 0);
  if (jobs) {
    return [{
      worker: "Automation Engine",
      internal: "Worker status",
      activity: `${jobs} scheduled workers configured; ${attention} need attention.`,
      mode: attention ? "standby" : "active",
    }];
  }
  return TOOL_SPINE.map((t) => ({
    worker: t.worker,
    internal: t.internal,
    activity: `${t.activity} (${t.mode}; no live worker receipt yet)`,
    mode: t.mode,
  })).slice(0, limit);
}

/* ======================================================================
   PHANTOMWIRE TICKER  (thin band under the topbar)
   ====================================================================== */
export function mountPhantomWire(el) {
  if (!el || el.dataset.mounted) return;
  el.dataset.mounted = "1";
  const render = () => {
    const items = wireItems().map((t) => {
      const m = modeMeta(t.mode);
      return `<span class="atk-item">
        <i class="atk-led atk-${m.tone}"></i>
        <b>${esc(t.worker)}</b>
        <em>${esc(t.internal)}</em>
        <span class="atk-txt">${esc(t.activity)}</span>
      </span>`;
    }).join(`<span class="atk-sep">/</span>`);
    // duplicated track for a seamless marquee loop
    el.innerHTML = `<div class="atk-label">PHANTOMWIRE</div>
      <div class="atk-view"><div class="atk-track ${reduceMotion ? "is-static" : ""}">${items}<span class="atk-loop-copy" aria-hidden="true"><span class="atk-sep">/</span>${items}</span></div></div>`;
  };
  void fetchWorkforce().then(render);
  const refresh = setInterval(() => void fetchWorkforce().then(render), 30000);
  render();
  const off = store.onChange(() => {
    if (!el.isConnected) { off(); clearInterval(refresh); return; }
    render();
  });
}

export const mountAgentTicker = mountPhantomWire;

/* ======================================================================
   AGENT OPERATIONS CONSOLE  (roster + telemetry + live tail log)
   ====================================================================== */
let logTimer = 0;
let uptimeTimer = 0;

function telemetryRow() {
  const summary = workforceCache?.summary;
  const online = Number(summary?.enabled_automation_jobs || TOOL_SPINE.filter((t) => t.mode === "active").length);
  const attention = Number(summary?.automation_jobs_needing_attention || 0);
  return `
    <div class="aops-tele">
      <div class="aops-t"><span class="aops-t-k">Scheduled workers</span><b class="aops-t-v" data-tele-online>${online}</b><i>real jobs</i></div>
      <div class="aops-t"><span class="aops-t-k">Needs attention</span><b class="aops-t-v ${attention ? "aops-warn" : "aops-ok"}">${attention}</b><i>setup/failures</i></div>
      <div class="aops-t"><span class="aops-t-k">Session uptime</span><b class="aops-t-v" data-tele-uptime>0:00</b><i>live</i></div>
      <div class="aops-t"><span class="aops-t-k">Routing lane</span><b class="aops-t-v aops-ok" data-tele-lane>Nominal</b><i>brain router</i></div>
    </div>`;
}

function rosterRow(t) {
  const m = modeMeta(t.mode);
  return `<div class="aops-agent">
    <span class="aops-led aops-${m.tone}"><i></i></span>
    <span class="aops-agent-main">
      <b>${esc(t.worker)}</b>
      <span class="aops-agent-tool">${esc(t.internal)}</span>
    </span>
    <span class="aops-agent-act">${esc(t.activity)}</span>
    <span class="aops-agent-mode aops-m-${m.tone}">${m.tag}</span>
  </div>`;
}

function logLineHtml(entry) {
  return `<div class="aops-log-line aops-lvl-${entry.tone}">
    <span class="aops-log-t">${entry.at}</span>
    <span class="aops-log-code">${entry.code}</span>
    <span class="aops-log-msg">${esc(entry.msg)}</span>
  </div>`;
}

function seedLog() {
  return wireItems(8).map((t, i) => {
    const m = modeMeta(t.mode);
    const d = new Date(Date.now() - (5 - i) * 4200);
    const p = (n) => String(n).padStart(2, "0");
    return { at: `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`, code: agentCode(t.worker), msg: t.activity, tone: m.tone };
  });
}

export function mountAgentConsole(el) {
  if (!el || el.dataset.mounted) return;
  el.dataset.mounted = "1";
  el.innerHTML = `
    <div class="aops-head">
      <div class="aops-title">
        <span class="aops-live"><i></i>LIVE</span>
        <h2>PhantomWire</h2>
        <span class="aops-sub">Agent receipts, scheduled jobs, and worker attention</span>
      </div>
      <span class="aops-scan" aria-hidden="true"></span>
    </div>
    ${telemetryRow()}
    <div class="aops-grid">
      <div class="aops-roster" data-aops-roster>${wireItems(12).map(rosterRow).join("")}</div>
      <div class="aops-log-wrap">
        <div class="aops-log-head"><span>PHANTOMWIRE LOG</span><i data-aops-tail>tail -f</i></div>
        <div class="aops-log" data-aops-log></div>
      </div>
    </div>`;

  const logEl = el.querySelector("[data-aops-log]");
  const buffer = seedLog();
  const render = () => { logEl.innerHTML = buffer.map(logLineHtml).join(""); logEl.scrollTop = logEl.scrollHeight; };
  render();

  // telemetry: worker counts come from the backend; this just keeps uptime live.
  const uptimeEl = el.querySelector("[data-tele-uptime]");
  const t0 = Date.now();
  const paintUptime = () => {
    const s = Math.floor((Date.now() - t0) / 1000);
    const mm = Math.floor(s / 60), ss = s % 60;
    if (uptimeEl) uptimeEl.textContent = `${mm}:${String(ss).padStart(2, "0")}`;
  };
  clearInterval(uptimeTimer);
  uptimeTimer = setInterval(paintUptime, 1000);
  paintUptime();

  if (reduceMotion) return; // no streaming under reduced-motion; static roster + seeded log stand

  const emit = () => {
    if (document.hidden || !el.isConnected) return;
    const items = wireItems(12);
    const t = items[Math.floor(Math.random() * items.length)];
    const m = modeMeta(t.mode);
    buffer.push({ at: now2(), code: agentCode(t.worker), msg: t.activity, tone: m.tone });
    if (buffer.length > 40) buffer.shift();
    // append just the new line for smooth scroll instead of full repaint
    logEl.insertAdjacentHTML("beforeend", logLineHtml(buffer[buffer.length - 1]));
    while (logEl.children.length > 40) logEl.removeChild(logEl.firstChild);
    const last = logEl.lastElementChild;
    if (last) last.classList.add("is-fresh");
    logEl.scrollTop = logEl.scrollHeight;
  };
  clearInterval(logTimer);
  logTimer = setInterval(emit, 2600 + Math.random() * 900);
}

/* ======================================================================
   HERO TYPEWRITER  (rotating line grounded in real agent state)
   ====================================================================== */
let heroTimer = 0;
export function mountHeroTicker(el) {
  if (!el || el.dataset.mounted) return;
  el.dataset.mounted = "1";
  void fetchWorkforce();
  const live = wireItems(5);
  const phrases = [
    "Worker feed shows agent receipts and attention only.",
    ...live.map((t) => `${t.worker}: ${t.activity}`),
    "Ask for anything. It lands as a draft, a brief, or a plan.",
  ].map((s) => (s.length > 68 ? s.slice(0, 65).trimEnd() + "…" : s));

  const cursor = `<i class="hero2-cursor" aria-hidden="true"></i>`;
  if (reduceMotion) {
    let i = 0;
    el.innerHTML = `<span class="hero2-tick-txt">${esc(phrases[0])}</span>`;
    clearInterval(heroTimer);
    heroTimer = setInterval(() => {
      i = (i + 1) % phrases.length;
      el.querySelector(".hero2-tick-txt").textContent = phrases[i];
    }, 4200);
    return;
  }

  el.innerHTML = `<span class="hero2-tick-txt"></span>${cursor}`;
  const txt = el.querySelector(".hero2-tick-txt");
  let pi = 0, ci = 0, mode = "type";
  const step = () => {
    const phrase = phrases[pi];
    if (mode === "type") {
      ci++; txt.textContent = phrase.slice(0, ci);
      if (ci >= phrase.length) { mode = "hold"; heroTimer = setTimeout(step, 2100); return; }
      heroTimer = setTimeout(step, 26 + Math.random() * 34);
    } else if (mode === "hold") {
      mode = "erase"; heroTimer = setTimeout(step, 30);
    } else {
      ci -= 2; if (ci < 0) ci = 0; txt.textContent = phrase.slice(0, ci);
      if (ci <= 0) { mode = "type"; pi = (pi + 1) % phrases.length; heroTimer = setTimeout(step, 340); return; }
      heroTimer = setTimeout(step, 14);
    }
  };
  step();
}

/* one call to wire everything the dashboard needs */
export function mountAgentOps({ ticker, console: consoleEl, heroTicker } = {}) {
  if (ticker) mountPhantomWire(ticker);
  if (consoleEl) mountAgentConsole(consoleEl);
  if (heroTicker) mountHeroTicker(heroTicker);
}
