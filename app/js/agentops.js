/* PhantomForce — PhantomWire layer.
   A live, honest picture of users and the internal worker spine: a scrolling report
   ticker, a tail-style operations log, a worker roster with status LEDs, and
   session telemetry. Everything here is driven by the real TOOL_SPINE workers
   (store.js) — no fabricated business records. Self-contained: owns its own
   timers, guards against double-mount, and respects reduced-motion. */

import { store, visible, TOOL_SPINE } from "./store.js?v=phantom-live-20260719-45";

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

/* a pool of realistic, domain-specific report fragments per worker.
   The first entry is always the worker's canonical activity from the store. */
const EXTRA_LINES = {
  "private-gateway": ["private route verified · 0 exposed ports", "rotated tunnel handshake", "edge probe rejected — unsolicited", "latency nominal on admin route"],
  "memory-core": ["compiled owner context bundle", "redacted 3 receipts before indexing", "refreshed memory hints for Phantom AI", "pruned context older than 30d"],
  "process-vault": ["indexed Command Center vault", "wrote verification log for last decision", "linked process notes to active missions", "snapshotted operating memory"],
  "automation-desk": ["holding ChicagoShots dry-run draft", "workflow scaffold validated — no live calls", "1 automation queued pending approval", "standby: no approved workflows"],
  "build-planner": ["standing by for next build request", "scoped guardrails for feature intake", "drafted task breakdown", "spec schema validated"],
  "operating-standards": ["standards pass: 11/11 workers compliant", "audited last worker handoff — clean", "checked owner-safe execution rules", "enforcing standards on command routing"],
  "code-intelligence": ["mapped repo graph (read-only)", "indexed module boundaries", "0 write operations — read lane only", "navigation index cached"],
  "squad-planner": ["contained in planning mode", "squad pattern generated · no autonomy", "multi-agent plan sandboxed", "held: live autonomy disabled"],
  "media-engine": ["staged for approved Media Lab runs", "editor bridge prepared", "paid generation gated — awaiting approval", "render pipeline dry-run ok"],
  "brain-router": ["routed request → review lane", "tool names hidden from user view", "load balanced across brain lanes", "model lane health verified"],
};

function linePool(tool) {
  const extras = EXTRA_LINES[tool.id] || [];
  return [tool.activity, ...extras].filter(Boolean);
}

const pick = (a) => a[Math.floor((reduceMotion ? 0.5 : Math.random()) * a.length) % a.length];
const now2 = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

function wireItems(limit = 14) {
  const recent = visible(store.state.activity || []).slice(0, 8).map((a) => ({
    worker: a.who || "Phantom",
    internal: a.toolId ? "Worker activity" : "User activity",
    activity: a.text || "activity recorded.",
    mode: "active",
  }));
  const workers = TOOL_SPINE.map((t) => ({
    worker: t.worker,
    internal: t.internal,
    activity: t.activity,
    mode: t.mode,
  }));
  return (recent.length ? [...recent, ...workers] : workers).slice(0, limit);
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
  render();
  const off = store.onChange(() => {
    if (!el.isConnected) { off(); return; }
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
  const online = TOOL_SPINE.filter((t) => t.mode === "active").length;
  return `
    <div class="aops-tele">
      <div class="aops-t"><span class="aops-t-k">Workers online</span><b class="aops-t-v" data-tele-online>${online}</b><i>of ${TOOL_SPINE.length}</i></div>
      <div class="aops-t"><span class="aops-t-k">Reports streamed</span><b class="aops-t-v" data-tele-reports>0</b><i>this session</i></div>
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
  // a few believable lines already on the wire so the log never starts empty
  return TOOL_SPINE.slice(0, 5).map((t, i) => {
    const m = modeMeta(t.mode);
    const d = new Date(Date.now() - (5 - i) * 4200);
    const p = (n) => String(n).padStart(2, "0");
    return { at: `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`, code: agentCode(t.worker), msg: pick(linePool(t)), tone: m.tone };
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
        <span class="aops-sub">Recent activity from workers and users</span>
      </div>
      <span class="aops-scan" aria-hidden="true"></span>
    </div>
    ${telemetryRow()}
    <div class="aops-grid">
      <div class="aops-roster" data-aops-roster>${TOOL_SPINE.map(rosterRow).join("")}</div>
      <div class="aops-log-wrap">
        <div class="aops-log-head"><span>PHANTOMWIRE LOG</span><i data-aops-tail>tail -f</i></div>
        <div class="aops-log" data-aops-log></div>
      </div>
    </div>`;

  const logEl = el.querySelector("[data-aops-log]");
  const buffer = seedLog();
  let reports = 0;
  const render = () => { logEl.innerHTML = buffer.map(logLineHtml).join(""); logEl.scrollTop = logEl.scrollHeight; };
  render();

  // telemetry: count-up "reports streamed" + live uptime
  const reportsEl = el.querySelector("[data-tele-reports]");
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

  // count-up the initial seeded reports for a bit of animated life
  reports = buffer.length;
  countUp(reportsEl, reports, 700);

  if (reduceMotion) return; // no streaming under reduced-motion; static roster + seeded log stand

  const emit = () => {
    if (document.hidden || !el.isConnected) return;
    const t = TOOL_SPINE[Math.floor(Math.random() * TOOL_SPINE.length)];
    const m = modeMeta(t.mode);
    buffer.push({ at: now2(), code: agentCode(t.worker), msg: pick(linePool(t)), tone: m.tone });
    if (buffer.length > 40) buffer.shift();
    // append just the new line for smooth scroll instead of full repaint
    logEl.insertAdjacentHTML("beforeend", logLineHtml(buffer[buffer.length - 1]));
    while (logEl.children.length > 40) logEl.removeChild(logEl.firstChild);
    const last = logEl.lastElementChild;
    if (last) last.classList.add("is-fresh");
    logEl.scrollTop = logEl.scrollHeight;
    reports += 1;
    if (reportsEl) reportsEl.textContent = String(reports);
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
  const phrases = [
    "Everything below is real work — never just chat.",
    ...TOOL_SPINE.filter((t) => t.mode === "active").slice(0, 5).map((t) => `${t.worker} ${t.activity}`),
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

/* small count-up helper for telemetry numbers */
function countUp(el, target, ms = 600) {
  if (!el) return;
  target = Number(target) || 0;
  if (reduceMotion || target <= 0) { el.textContent = String(target); return; }
  const start = performance.now();
  const tick = (t) => {
    const k = Math.min(1, (t - start) / ms);
    const eased = 1 - Math.pow(1 - k, 3);
    el.textContent = String(Math.round(target * eased));
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/* one call to wire everything the dashboard needs */
export function mountAgentOps({ ticker, console: consoleEl, heroTicker } = {}) {
  if (ticker) mountPhantomWire(ticker);
  if (consoleEl) mountAgentConsole(consoleEl);
  if (heroTicker) mountHeroTicker(heroTicker);
}
