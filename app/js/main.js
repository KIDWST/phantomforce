/* PhantomForce Phantom — shell, overlay engine, ticker, command deck.
   The old canvas-drawn ghost-blob companion character has been removed —
   a real character design is being built separately; this file no longer
   owns any character rendering so there's nothing left to conflict with
   it. The hero text line (speak()) still works on its own, decoupled
   from any visual mascot. */

import {
  store, ctx, session, resolveSession, isAdmin, currentWs, setWorkspace, wsName,
  visible, todaysPlan, moneyView, fmtMoney, ago, commandBriefing,
  workforceByDepartment, outcomesView,
} from "./store.js";
import { handleCommand, commandSuggestions } from "./command.js";
import { WORKSPACE_DEFS, missionWidgets, esc, chip } from "./workspaces.js";

const $ = (sel, root = document) => root.querySelector(sel);
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const gate = $("[data-gate]");
const phantom = $("[data-phantom]");
const overlayRoot = $("[data-overlay-root]");

/* ============================ access gate ============================ */
function showGate() {
  gate.hidden = false;
  phantom.hidden = true;
  gate.querySelectorAll("[data-enter]").forEach((btn) => {
    btn.onclick = () => {
      const kind = btn.dataset.enter;
      ctx.session = kind === "admin"
        ? { role: "admin", name: "Jordan", ws: "phantomforce" }
        : { role: "client", name: "Test Client", ws: "test-client" };
      session.set(ctx.session);
      enterPhantom();
    };
  });
}

/* ============================ shell ============================ */
function renderTopbar() {
  $("[data-role-sub]").textContent = isAdmin() ? "ADMIN PHANTOM" : "CLIENT PORTAL";
  const wsLabel = wsName(ctx.session.ws);
  $("[data-identity]").textContent = isAdmin()
    ? `${ctx.session.name} · operator`
    : (ctx.session.name === wsLabel ? `${wsLabel} · workspace` : `${ctx.session.name} · ${wsLabel}`);
  const wrap = $("[data-org-wrap]");
  const select = $("[data-org-select]");
  if (isAdmin()) {
    wrap.hidden = false;
    select.innerHTML = store.state.workspaces
      .map((w) => `<option value="${w.id}" ${w.id === currentWs() ? "selected" : ""}>${esc(w.name)} — ${esc(w.kind)}</option>`)
      .join("");
    select.onchange = () => { setWorkspace(select.value); renderDashboard(); };
  } else {
    wrap.hidden = true;
  }
  $("[data-signout]").onclick = () => { session.clear(); ctx.session = null; closeOverlay(true); showGate(); };

  phantom.classList.toggle("side-nav-active", isAdmin());
  renderNotifBell();
}

/* Approvals folded here instead of holding its own sidebar slot — this
   IS the "condense Approvals" move: same real renderApprovals() workspace,
   reached from a badge instead of a permanent nav row. */
function renderNotifBell() {
  if (!isAdmin()) { const old = $("[data-notif-bell]"); if (old) old.remove(); return; }
  let bell = $("[data-notif-bell]");
  if (!bell) {
    bell = document.createElement("button");
    bell.className = "notif-bell";
    bell.setAttribute("data-notif-bell", "");
    bell.setAttribute("data-open-ws", "approvals");
    bell.setAttribute("aria-label", "Notifications — waiting on you");
    bell.innerHTML = `🔔<span class="notif-badge" data-notif-count hidden></span>`;
    $("[data-identity]").insertAdjacentElement("beforebegin", bell);
  }
  const pending = visible(store.state.approvals).filter((a) => a.status === "pending").length;
  const badge = $("[data-notif-count]", bell);
  badge.hidden = pending === 0;
  badge.textContent = pending > 9 ? "9+" : String(pending);
}

/* ============================ side nav ============================
   Admin-only persistent sidebar, replacing the tile-grid as the primary
   navigation surface. Condensed from a flat list: Approvals lives in the
   topbar bell instead of its own row (see renderNotifBell above), and
   the remaining real workspaces are grouped under section headers
   instead of one long undifferentiated column. Every entry maps to a
   real WORKSPACE_DEFS render function — nothing here is a placeholder
   that opens onto empty content. */
const NAV_GROUPS = [
  { header: null, items: [{ id: "outcomes", label: "Outcomes", icon: "◎" }] },
  { header: "Clients", items: [
    { id: "leads", label: "Leads & Follow-Up", icon: "◉" },
    { id: "proposals", label: "Proposals", icon: "▤" },
    { id: "reviews", label: "Reviews", icon: "★" },
    { id: "bookings", label: "Bookings", icon: "◷" },
  ] },
  { header: "Production", items: [
    { id: "media", label: "Media Lab", icon: "▶" },
    { id: "sites", label: "Site & Store Studio", icon: "▦" },
  ] },
  { header: "PhantomPlay", items: [
    { id: "play", label: "Play", icon: "▧" },
    { id: "store", label: "Store", icon: "☆" },
  ] },
  { header: "Operations", items: [
    { id: "workforce", label: "Workforce", icon: "◈" },
    { id: "money", label: "Money", icon: "$" },
    { id: "protect", label: "Protect", icon: "⛨" },
  ] },
];

function navItemHtml(item) {
  const active = openId === item.id;
  return `<button class="side-item ${active ? "is-active" : ""}" data-open-ws="${esc(item.id)}">
    <i aria-hidden="true">${item.icon}</i><span>${esc(item.label)}</span>
  </button>`;
}

function renderSideNav() {
  if (!isAdmin()) { const old = $("[data-side-nav]"); if (old) old.remove(); return; }
  let nav = $("[data-side-nav]");
  if (!nav) {
    nav = document.createElement("nav");
    nav.className = "side-nav";
    nav.setAttribute("data-side-nav", "");
    nav.setAttribute("aria-label", "Primary");
    phantom.insertBefore(nav, phantom.firstChild);
  }
  const homeActive = !openId;
  nav.innerHTML = `
    <div class="side-brand">
      <span class="brand-ghost" aria-hidden="true"></span>
      <span class="side-brand-word">PHANTOMFORCE</span>
    </div>
    <button class="side-item ${homeActive ? "is-active" : ""}" data-side-home>
      <i aria-hidden="true">⌂</i><span>Command</span>
    </button>
    ${NAV_GROUPS.map((g) => `
      ${g.header ? `<p class="side-group-label">${esc(g.header)}</p>` : ""}
      ${g.items.map(navItemHtml).join("")}
    `).join("")}
    ${isAdmin() ? `<p class="side-group-label">System</p>${navItemHtml({ id: "adminos", label: "PhantomOps", icon: "⚙" })}` : ""}
  `;
  const home = $("[data-side-home]", nav);
  if (home) home.addEventListener("click", () => closeOverlay(true));
}

/* ============================ ticker ============================ */
let tickerTimer = 0, tickerIdx = 0;
function startTicker() {
  const line = $("[data-ticker-line]");
  const feed = () => {
    const items = visible(store.state.activity);
    if (!items.length) { line.textContent = "The desks are quiet. Ask for something."; return; }
    tickerIdx = (tickerIdx + 1) % items.length;
    const a = items[tickerIdx];
    line.classList.remove("ticker-in");
    void line.offsetWidth;
    line.textContent = `${a.who} ${a.text}`;
    line.classList.add("ticker-in");
  };
  clearInterval(tickerTimer);
  feed();
  tickerTimer = setInterval(feed, 4200);
}

/* ============================ mission grid ============================ */
function renderMission() {
  const grid = $("[data-mission]");
  grid.className = "mission-grid";
  const label = grid.closest("section")?.querySelector(".deck-label");
  if (label) label.textContent = "Mission grid";
  grid.innerHTML = missionWidgets().map((w) => `
    <button class="widget ${w.alert ? "widget-alert" : ""}" data-open-ws="${w.id}">
      <span class="widget-icon" aria-hidden="true">${w.icon}</span>
      <span class="widget-title">${esc(w.title)}</span>
      <span class="widget-stat">${esc(w.stat)}</span>
      <span class="widget-sub">${esc(w.sub)}</span>
    </button>`).join("");
}

/* ============================ enterprise dashboard (admin) ============================
   Replaces the tile grid for admins now that the sidebar handles
   navigation — tiles that just repeated "click here" are lower value
   than real KPI numbers and real charts once there's another way in.
   Every number below is read straight off store data; nothing charted
   here is invented, and a chart with too little real data to be
   meaningful (a revenue trend off one seeded deal) is left out rather
   than faked. Client portal is untouched — it keeps the tile grid via
   renderMission() above. */
const STAGE_META = {
  new: { label: "New", cls: "stage-inprogress" },
  "follow-up": { label: "Follow-up", cls: "stage-inprogress" },
  proposal: { label: "Proposal", cls: "stage-inprogress" },
  won: { label: "Won", cls: "stage-won" },
  lost: { label: "Lost", cls: "stage-lost" },
};

function deptChartRow(d, maxTotal) {
  const totalPct = maxTotal ? (d.total / maxTotal) * 100 : 0;
  const activePct = d.total ? (d.active / d.total) * 100 : 0;
  return `
    <div class="chart-row" title="${esc(d.name)}: ${d.active} active of ${d.total} total">
      <span class="chart-row-label">${esc(d.name)}</span>
      <div class="chart-track-outer"><div class="chart-track-inner" style="width:${totalPct}%">
        <span class="chart-seg-active" style="width:${activePct}%"></span>
      </div></div>
      <span class="chart-row-value">${d.active}/${d.total}</span>
    </div>`;
}

function stageChartRow(key, count, maxCount) {
  const meta = STAGE_META[key];
  const pct = maxCount ? (count / maxCount) * 100 : 0;
  return `
    <div class="chart-row" title="${esc(meta.label)}: ${count}">
      <span class="chart-row-label">${esc(meta.label)}</span>
      <div class="chart-track-outer"><div class="chart-track-inner ${meta.cls}" style="width:${pct}%"></div></div>
      <span class="chart-row-value">${count}</span>
    </div>`;
}

function renderEnterpriseDashboard() {
  const mount = $("[data-mission]");
  if (!mount) return;
  const label = mount.closest("section")?.querySelector(".deck-label");
  if (label) label.textContent = "Dashboard";

  const depts = workforceByDepartment();
  const maxDeptTotal = Math.max(1, ...depts.map((d) => d.total));
  const activeAgents = depts.reduce((s, d) => s + d.active, 0);
  const totalAgents = depts.reduce((s, d) => s + d.total, 0);

  const leads = visible(store.state.leads);
  const stageCounts = Object.keys(STAGE_META).reduce((acc, k) => { acc[k] = leads.filter((l) => l.status === k).length; return acc; }, {});
  const maxStage = Math.max(1, ...Object.values(stageCounts));

  const m = moneyView();
  const pendingApprovals = visible(store.state.approvals).filter((a) => a.status === "pending").length;
  const outcomes = outcomesView();
  const activeOutcomes = outcomes.filter((o) => o.status === "active").length;

  mount.className = "";
  mount.innerHTML = `
    <div class="ent-dashboard">
      <div class="stat-row kpi-strip">
        <div class="stat"><span>Open pipeline</span><b>${fmtMoney(m.pipeline)}</b><i>${leads.filter((l) => !["won", "lost"].includes(l.status)).length} open leads</i></div>
        <div class="stat"><span>Won value</span><b>${fmtMoney(m.wonValue)}</b><i>${fmtMoney(m.retainerMonthly)}/mo retainers</i></div>
        <div class="stat"><span>Workforce</span><b>${activeAgents}/${totalAgents}</b><i>active right now</i></div>
        <div class="stat"><span>Outcomes</span><b>${activeOutcomes}/${outcomes.length}</b><i>actively being driven</i></div>
        <div class="stat"><span>Waiting on you</span><b>${pendingApprovals}</b><i>pending approvals</i></div>
      </div>

      <div class="ent-charts">
        <div class="chart-card">
          <h3>Workforce by department</h3>
          <p class="chart-sub">Active vs. total headcount, real desk assignments.</p>
          <div class="chart-legend"><span><i style="background:var(--neon)"></i>Active</span><span><i style="background:var(--dim-2)"></i>Idle / off-desk</span></div>
          ${depts.map((d) => deptChartRow(d, maxDeptTotal)).join("")}
        </div>
        <div class="chart-card">
          <h3>Pipeline by stage</h3>
          <p class="chart-sub">Every open lead, where it actually sits today.</p>
          ${Object.keys(STAGE_META).map((k) => stageChartRow(k, stageCounts[k], maxStage)).join("")}
        </div>
      </div>

      <div class="ent-outcomes">
        <h3>Outcomes at a glance</h3>
        ${outcomes.length ? outcomes.map((o) => `
          <div class="ent-outcome-row">
            <b>${esc(o.title)}</b>
            ${chip(o.status)}
            <button class="btn btn-quiet" data-open-ws="outcomes">Open</button>
          </div>`).join("") : `<p class="rail-empty">No outcomes defined yet.</p>`}
      </div>
    </div>`;
}

/* ============================ rail ============================ */
function renderRail() {
  const plan = todaysPlan();
  $("[data-rail-plan] .rail-body").innerHTML = plan.length
    ? plan.map((p) => `<button class="rail-item" data-open-ws="${p.open}"><i>${p.icon}</i><span>${esc(p.text)}</span></button>`).join("")
    : `<p class="rail-empty">Clear runway. The desks are working the routine.</p>`;

  const m = moneyView();
  $("[data-rail-money] .rail-body").innerHTML = `
    <button class="rail-item rail-money" data-open-ws="money">
      <span class="rail-money-big">${fmtMoney(m.pipeline)}</span>
      <span>open pipeline · ${fmtMoney(m.wonValue)} won · ${fmtMoney(m.retainerMonthly)}/mo retainers</span>
    </button>`;

  const pend = visible(store.state.approvals).filter((a) => a.status === "pending");
  $("[data-rail-approvals] .rail-body").innerHTML = pend.length
    ? pend.slice(0, 4).map((a) => `<button class="rail-item rail-approval" data-open-ws="approvals"><i>◈</i><span>${esc(a.title)}</span></button>`).join("")
    : `<p class="rail-empty">Nothing waiting on you.</p>`;

  $("[data-rail-work] .rail-body").innerHTML = visible(store.state.activity).slice(0, 4)
    .map((a) => `<div class="rail-item rail-static"><span><b>${esc(a.who)}</b> ${esc(a.text)}</span><i>${ago(a.at)}</i></div>`).join("")
    || `<p class="rail-empty">Quiet.</p>`;
}

function renderDashboard() {
  renderTopbar();
  renderSideNav();
  renderCommandBriefing();
  if (isAdmin()) renderEnterpriseDashboard(); else renderMission();
  renderRail();
  renderSuggests();
  startTicker();
}

/* ============================ command briefing ============================
   PhantomForce opens on "what's happening," not a blank prompt (see
   docs on Command/Outcomes/Signals architecture). Self-injects its own
   DOM + styles, same pattern as everywhere else in this app that adds a
   section without depending on host HTML markup — works regardless of
   which shell wraps it. Every card is built from real store data in
   store.js's commandBriefing(); nothing here fabricates a stat. */
let briefingStylesInjected = false;
const dismissedCardIds = new Set();

function injectBriefingStyles() {
  if (briefingStylesInjected) return;
  briefingStylesInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    .briefing { margin: 20px 0 28px; }
    .briefing-greet { font: 600 20px "Space Grotesk", system-ui, sans-serif; margin: 0 0 2px; }
    .briefing-health { font: 400 13px "DM Mono", monospace; color: rgba(234,255,244,.55); margin: 0 0 16px; }
    .briefing-cards { display: grid; gap: 12px; }
    .briefing-card { border: 1px solid rgba(65,255,161,.18); border-radius: 16px; padding: 16px 18px;
      background: radial-gradient(120% 160% at 0% 0%, rgba(65,255,161,.06), transparent 60%), rgba(3,10,7,.5); }
    .briefing-card-top { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
    .briefing-dept { font: 500 9px "DM Mono", monospace; letter-spacing: .14em; text-transform: uppercase;
      color: rgba(65,255,161,.85); border: 1px solid rgba(65,255,161,.3); border-radius: 999px; padding: 2px 8px; }
    .briefing-confidence { font: 400 10px "DM Mono", monospace; color: rgba(234,255,244,.4); margin-left: auto; }
    .briefing-card h4 { margin: 0 0 4px; font: 600 15px "Space Grotesk", system-ui, sans-serif; }
    .briefing-card p { margin: 0 0 8px; font-size: 12.5px; color: rgba(234,255,244,.65); line-height: 1.5; }
    .briefing-evidence { margin: 0 0 12px; padding: 0; list-style: none; font: 400 11px "DM Mono", monospace; color: rgba(234,255,244,.45); }
    .briefing-evidence li { padding: 2px 0 2px 14px; position: relative; }
    .briefing-evidence li::before { content: "▸"; position: absolute; left: 0; color: rgba(65,255,161,.5); }
    .briefing-actions { display: flex; gap: 8px; }
    .briefing-away { margin-top: 18px; border-top: 1px solid rgba(255,255,255,.06); padding-top: 14px; }
    .briefing-away-head { font: 500 10px "DM Mono", monospace; letter-spacing: .12em; text-transform: uppercase; color: rgba(234,255,244,.4); margin: 0 0 8px; }
    .briefing-away ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 5px; }
    .briefing-away li { font-size: 12.5px; color: rgba(234,255,244,.6); padding-left: 14px; position: relative; }
    .briefing-away li::before { content: "✓"; position: absolute; left: 0; color: rgba(65,255,161,.6); }
  `;
  document.head.appendChild(style);
}

function greeting() {
  const h = new Date().getHours();
  const time = h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
  const name = ctx.session?.name?.split(" ")[0] || "there";
  return `Good ${time}, ${name}`;
}

function renderCommandBriefing() {
  if (!isAdmin()) return; // client portal keeps the simpler existing view
  injectBriefingStyles();
  const mission = $("[data-mission]");
  if (!mission) return;
  const host = mission.closest("section") || mission;

  let section = $("[data-briefing]");
  if (!section) {
    section = document.createElement("section");
    section.className = "briefing";
    section.setAttribute("data-briefing", "");
    host.parentElement.insertBefore(section, host);
  }

  const { healthLine, decisions, handledWhileAway } = commandBriefing();
  const visibleDecisions = decisions.filter((d) => !dismissedCardIds.has(d.id));

  section.innerHTML = `
    <p class="briefing-greet">${esc(greeting())}</p>
    <p class="briefing-health">${esc(healthLine)}</p>
    ${visibleDecisions.length ? `<div class="briefing-cards">${visibleDecisions.map((d) => `
      <article class="briefing-card" data-card-id="${esc(d.id)}">
        <div class="briefing-card-top">
          <span class="briefing-dept">${esc(d.dept)}</span>
          <span class="briefing-confidence">confidence: ${esc(d.confidence)}</span>
        </div>
        <h4>${esc(d.headline)}</h4>
        <p>${esc(d.body)}</p>
        <ul class="briefing-evidence">${d.evidence.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>
        <div class="briefing-actions">
          <button class="btn btn-primary" data-briefing-open="${esc(d.primary.open)}">${esc(d.primary.label)}</button>
          <button class="btn btn-quiet" data-briefing-dismiss="${esc(d.id)}">Dismiss</button>
        </div>
      </article>`).join("")}</div>` : ""}
    ${handledWhileAway.length ? `<div class="briefing-away">
      <p class="briefing-away-head">Handled while you were away</p>
      <ul>${handledWhileAway.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
    </div>` : ""}`;

  section.querySelectorAll("[data-briefing-open]").forEach((btn) => {
    btn.addEventListener("click", () => openWorkspace(btn.dataset.briefingOpen));
  });
  section.querySelectorAll("[data-briefing-dismiss]").forEach((btn) => {
    btn.addEventListener("click", () => {
      dismissedCardIds.add(btn.dataset.briefingDismiss);
      renderCommandBriefing();
    });
  });
}

/* ============================ command deck ============================ */
const sayBox = () => $("[data-say]");
let typeTimer = 0;

function speak(text, cls = "") {
  clearTimeout(typeTimer);
  const p = document.createElement("p");
  p.className = `say-line ${cls}`.trim();
  sayBox().replaceChildren(p);

  if (cls || reduceMotion) {
    p.textContent = text;
    return;
  }
  let i = 0;
  const tick = () => {
    p.textContent = text.slice(0, i);
    if (i++ < text.length) typeTimer = setTimeout(tick, 11 + Math.random() * 16);
  };
  tick();
}

function cardHtml(c) {
  return `
    <article class="rcard">
      <p class="rcard-kicker">${esc(c.kicker)}</p>
      <h4>${esc(c.title)}</h4>
      ${c.body ? `<p class="rcard-body">${esc(c.body)}</p>` : ""}
      ${c.meta ? `<p class="rcard-meta">${esc(c.meta)}</p>` : ""}
      ${c.actions?.length ? `<div class="rcard-actions">${c.actions.map((a) => `<button class="btn" data-open-ws="${a.open}">${esc(a.label)}</button>`).join("")}</div>` : ""}
    </article>`;
}

function runCommand(text) {
  speak(text, "user");
  const respBox = $("[data-response]");
  respBox.innerHTML = "";
  setTimeout(() => {
    speak("· · ·", "thinking");
    setTimeout(() => {
      const r = handleCommand(text);
      speak(r.say);
      respBox.innerHTML = (r.cards || []).map(cardHtml).join("");
      renderDashboard();
      if (r.open) setTimeout(() => openWorkspace(r.open), reduceMotion ? 150 : 750);
    }, reduceMotion ? 120 : 620);
  }, reduceMotion ? 60 : 260);
}

function renderSuggests() {
  $("[data-suggests]").innerHTML = commandSuggestions()
    .map((s) => `<button class="suggest" data-suggest="${esc(s)}">${esc(s)}</button>`).join("");
}

function wireCommandDeck() {
  const form = $("[data-command-form]");
  const input = $("[data-command-input]");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = input.value.trim();
    if (!v) return;
    input.value = "";
    runCommand(v);
  });
  document.addEventListener("click", (e) => {
    const sug = e.target.closest("[data-suggest]");
    if (sug) { runCommand(sug.dataset.suggest); return; }
    const opener = e.target.closest("[data-open-ws]");
    if (opener) openWorkspace(opener.dataset.openWs);
  });
}

/* ============================ overlay engine ============================ */
let openId = null;
function openWorkspace(id, pushHash = true) {
  const def = WORKSPACE_DEFS[id];
  if (!def) return;
  if (def.adminOnly && !isAdmin()) return;
  closeOverlay(false);
  openId = id;
  document.body.classList.add("overlay-open");
  overlayRoot.innerHTML = `
    <div class="overlay" role="dialog" aria-modal="true" aria-label="${esc(def.title)}">
      <button class="overlay-backdrop" data-overlay-close aria-label="Back to phantom"></button>
      <section class="overlay-panel">
        <header class="overlay-head">
          <div>
            <p class="overlay-kicker">${esc(def.kicker)}${isAdmin() && currentWs() !== "phantomforce" ? ` · ${esc(wsName(currentWs()))}` : ""}</p>
            <h2>${esc(def.title)}</h2>
          </div>
          <button class="overlay-x" data-overlay-close aria-label="Close workspace">✕</button>
        </header>
        <div class="overlay-body" data-overlay-body></div>
      </section>
    </div>`;
  const body = $("[data-overlay-body]", overlayRoot);
  const rerender = () => { def.render(body, rerender); if (id === "phantom") wirePhantomConsole(body); };
  rerender();
  overlayRoot.querySelectorAll("[data-overlay-close]").forEach((b) => b.addEventListener("click", () => closeOverlay(true)));
  if (pushHash && location.hash !== `#ws/${id}`) {
    try { history.pushState(null, "", `#ws/${id}`); } catch {}
  }
}

function closeOverlay(clearHash) {
  if (!openId) return;
  openId = null;
  overlayRoot.innerHTML = "";
  document.body.classList.remove("overlay-open");
  if (clearHash && location.hash.startsWith("#ws/")) {
    try { history.pushState(null, "", location.pathname + location.search); } catch {}
  }
  renderDashboard();
}

document.addEventListener("keydown", (e) => { if (e.key === "Escape" && openId) closeOverlay(true); });
window.addEventListener("popstate", () => {
  const m = location.hash.match(/^#ws\/([a-z]+)/);
  if (m && WORKSPACE_DEFS[m[1]]) openWorkspace(m[1], false);
  else closeOverlay(false);
});

/* ============================ phantom console ============================ */
const phantomHistory = [];
function wirePhantomConsole(body) {
  const log = $("[data-phantom-log]", body);
  const form = $("[data-phantom-form]", body);
  const input = $("[data-phantom-input]", body);
  const paint = () => {
    log.innerHTML = phantomHistory.map((h) => `
      <div class="phantom-entry">
        <p class="phantom-user">› ${esc(h.q)}</p>
        <p class="phantom-reply">${esc(h.say)}</p>
        ${(h.cards || []).map(cardHtml).join("")}
      </div>`).join("") || `<p class="phantom-hello">This is the full command console. Everything you ask lands as real work — drafts, briefs, and pipelines, never just chat.</p>`;
    log.scrollTop = log.scrollHeight;
  };
  paint();
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = input.value.trim();
    if (!v) return;
    input.value = "";
    const r = handleCommand(v);
    phantomHistory.push({ q: v, say: r.say, cards: r.cards });
    paint();
    renderDashboard();
  });
  setTimeout(() => input.focus(), 60);
}

/* ============================ boot ============================ */
function enterPhantom() {
  gate.hidden = true;
  phantom.hidden = false;
  renderDashboard();
  const q = new URLSearchParams(location.search);
  const view = (q.get("view") || "").toLowerCase();
  if (view && view !== "command" && WORKSPACE_DEFS[view]) openWorkspace(view);
  const m = location.hash.match(/^#ws\/([a-z]+)/);
  if (m && WORKSPACE_DEFS[m[1]]) openWorkspace(m[1], false);
  speak(isAdmin()
    ? "Phantom is live. Every desk reported in — what do you want handled first?"
    : `Welcome back. Your workspace is moving — ask me anything or check today's plan.`);
}

function boot() {
  ctx.session = resolveSession();
  wireCommandDeck();
  store.onChange(() => { /* keep rail + grid live after any store write */
    if (!phantom.hidden) { renderMission(); renderRail(); }
  });
  if (ctx.session) enterPhantom();
  else showGate();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
