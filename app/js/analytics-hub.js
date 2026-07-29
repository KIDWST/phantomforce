/* Unified, data-honest analytics. Dated records render as trends; cumulative
   product counters remain explicitly labelled aggregates instead of being
   expanded into invented history. */
import {
  store, isAdmin, isOwnerOperator, session, currentTenantId, moneyView, fmtMoney,
  workspaceStorageGetItem, workspaceStorageSetItem,
} from "./store.js?v=phantom-live-20260729-87";
import { renderAnalytics as renderSocialAnalytics, productAnalyticsRows, kpi, K } from "./contenthub.js?v=phantom-live-20260729-87-creatorrestore1";
import { mountManagedGrowthReport } from "./managedgrowth.js?v=phantom-live-20260729-87";
import { renderCompetitorIntelligence } from "./competitor-intelligence.js?v=phantom-live-20260729-87";

const LAST_DOMAIN_KEY = "pf.analytics.lastDomain.v1";
const CUSTOM_SOURCES_KEY = "pf.analytics.customSources.v1";
const DOMAIN_COLORS = { pulse: "#63e2a9", store: "#39c98f", games: "#7c6cf0", custom: "#4ea1ff", social: "#ffb86b", money: "#f4c95d", intelligence: "#ff687d" };

function esc(value = "") {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function loadCustomSources() {
  try { return JSON.parse(workspaceStorageGetItem(CUSTOM_SOURCES_KEY) || "[]") || []; }
  catch { return []; }
}
function saveCustomSources(list) {
  try { workspaceStorageSetItem(CUSTOM_SOURCES_KEY, JSON.stringify(list)); } catch {}
}

function fmtCustomValue(value, unit) {
  const n = Number(value || 0);
  if (unit === "dollars") return `$${n.toLocaleString()}`;
  if (unit === "percent") return `${n}%`;
  return n.toLocaleString();
}

function authHeaders(extra = {}) {
  const token = typeof session?.token === "function" ? session.token() : "";
  return { ...extra, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

async function fetchGamesAnalytics() {
  const params = new URLSearchParams();
  const tenantId = currentTenantId?.();
  if (tenantId) params.set("tenant_id", tenantId);
  const response = await fetch(`/api/phantomplay/v2/developer/analytics?${params.toString()}`, { headers: authHeaders() });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload?.error === "string" ? payload.error : `Games analytics failed (${response.status}).`);
  return payload;
}

function availableDomains() {
  const domains = [
    { id: "pulse", label: "Business" },
    { id: "store", label: "Store" },
    { id: "games", label: "Play" },
    { id: "money", label: "Accounting" },
    { id: "intelligence", label: "Competitors" },
  ];
  for (const source of loadCustomSources()) domains.push({ id: `custom:${source.id}`, label: source.label });
  domains.push({ id: "social", label: "Audience" });
  return domains;
}

function preferredInitialDomain(domains, saved) {
  const ids = new Set(domains.map((domain) => domain.id));
  if (saved && saved !== "social" && ids.has(saved)) return saved;
  if (ids.has("pulse")) return "pulse";
  if (ids.has("store")) return "store";
  if (ids.has("games")) return "games";
  return domains[0]?.id || "social";
}

function domainBarChart(rows, { emptyTitle, emptyBody, ariaLabel = "Metric comparison" } = {}) {
  if (!rows.length) {
    return `<div class="an-chart-wrap is-empty"><div class="an-chart-empty"><b>${esc(emptyTitle || "No data yet")}</b><span>${esc(emptyBody || "")}</span></div></div>`;
  }
  const max = Math.max(1, ...rows.map((row) => Number(row.value) || 0));
  return `<div class="an-rank-chart" role="list" aria-label="${esc(ariaLabel)}">${rows.map((row, index) => {
    const width = Math.max(2, Math.round((Number(row.value) || 0) / max * 100));
    return `<button class="an-rank-row" type="button" role="listitem" data-an-insight="${esc(row.detail || `${row.label}: ${row.display ?? row.value}`)}">
      <span class="an-rank-order">${String(index + 1).padStart(2, "0")}</span>
      <span class="an-rank-label"><i class="ch-dot" style="background:${row.color}"></i>${esc(row.label)}</span>
      <span class="an-rank-track"><span style="width:${width}%;background:${row.color}"></span></span>
      <b>${esc(row.display ?? row.value)}</b>
    </button>`;
  }).join("")}</div>`;
}

function domainFunnel(stages = [], { emptyTitle = "No funnel data yet" } = {}) {
  if (!stages.length || !stages.some((stage) => Number(stage.value) > 0)) {
    return `<div class="an-chart-wrap is-empty"><div class="an-chart-empty"><b>${esc(emptyTitle)}</b></div></div>`;
  }
  const first = Math.max(1, Number(stages[0]?.value) || 0);
  return `<div class="an-funnel" aria-label="Conversion funnel">${stages.map((stage, index) => {
    const value = Number(stage.value) || 0;
    const previous = index ? Number(stages[index - 1].value) || 0 : first;
    const rate = index ? (previous ? value / previous * 100 : 0) : 100;
    return `<div class="an-funnel-stage">
      <div class="an-funnel-copy"><span>${esc(stage.label)}</span><b>${esc(stage.display ?? K(value))}</b><i>${index ? `${rate.toFixed(1)}% from prior stage` : "Top of funnel"}</i></div>
      <span class="an-funnel-bar"><i style="width:${Math.max(3, value / first * 100)}%;background:${stage.color || DOMAIN_COLORS.pulse}"></i></span>
    </div>`;
  }).join("")}</div>`;
}

function rangeDays(range) {
  return range === "7" ? 7 : range === "90" ? 90 : 30;
}

function dayKey(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : "";
}

function datedBuckets(records = [], range = "30", valueFor = (record) => Number(record.value) || 0) {
  const days = rangeDays(range);
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const buckets = Array.from({ length: days }, (_, index) => {
    const date = new Date(end);
    date.setDate(end.getDate() - (days - index - 1));
    return { date: date.toISOString().slice(0, 10), value: 0 };
  });
  const byDate = new Map(buckets.map((point) => [point.date, point]));
  records.forEach((record) => {
    const point = byDate.get(dayKey(record.date || record.createdAt));
    if (point) point.value += valueFor(record);
  });
  return buckets;
}

function domainLineChart(series = [], { emptyTitle = "No historical data yet", emptyBody = "", range = "30" } = {}) {
  const visibleSeries = series.filter((item) => Array.isArray(item.points) && item.points.some((point) => Number(point.value) !== 0));
  if (!visibleSeries.length) {
    return `<div class="an-chart-wrap is-empty"><div class="an-chart-empty"><b>${esc(emptyTitle)}</b><span>${esc(emptyBody)}</span></div></div>`;
  }
  const width = 920;
  const height = 300;
  const pad = { left: 58, right: 22, top: 24, bottom: 42 };
  const all = visibleSeries.flatMap((item) => item.points.map((point) => Number(point.value) || 0));
  const min = Math.min(0, ...all);
  const max = Math.max(1, ...all);
  const span = Math.max(1, max - min);
  const count = Math.max(2, ...visibleSeries.map((item) => item.points.length));
  const x = (index) => pad.left + index / (count - 1) * (width - pad.left - pad.right);
  const y = (value) => pad.top + (max - Number(value || 0)) / span * (height - pad.top - pad.bottom);
  const ticks = Array.from({ length: 5 }, (_, index) => max - span * index / 4);
  const fmtAxis = (value) => Math.abs(value) >= 1000 ? K(value) : Math.round(value).toLocaleString();
  return `<div class="an-line-chart" data-an-line-chart>
    <div class="an-chart-legend">${visibleSeries.map((item) => `<span><i style="background:${item.color}"></i>${esc(item.label)}</span>`).join("")}<output data-an-chart-readout>Hover or focus a point</output></div>
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${rangeDays(range)} day analytics trend">
      ${ticks.map((tick) => `<g class="an-grid-line"><line x1="${pad.left}" y1="${y(tick)}" x2="${width - pad.right}" y2="${y(tick)}"/><text x="${pad.left - 10}" y="${y(tick) + 4}">${esc(fmtAxis(tick))}</text></g>`).join("")}
      ${visibleSeries.map((item) => {
        const path = item.points.map((point, index) => `${index ? "L" : "M"} ${x(index).toFixed(1)} ${y(point.value).toFixed(1)}`).join(" ");
        return `<g class="an-series" style="--series:${item.color}">
          <path d="${path}"/>
          ${item.points.map((point, index) => `<circle cx="${x(index)}" cy="${y(point.value)}" r="5" tabindex="0" data-an-point data-label="${esc(item.label)}" data-date="${esc(point.date)}" data-value="${esc(item.format ? item.format(point.value) : K(point.value))}"><title>${esc(item.label)} · ${point.date}: ${item.format ? esc(item.format(point.value)) : esc(K(point.value))}</title></circle>`).join("")}
        </g>`;
      }).join("")}
      <text class="an-axis-start" x="${pad.left}" y="${height - 12}">${esc(visibleSeries[0].points[0]?.date || "")}</text>
      <text class="an-axis-end" x="${width - pad.right}" y="${height - 12}">${esc(visibleSeries[0].points.at(-1)?.date || "")}</text>
    </svg>
  </div>`;
}

function domainCardHtml({ eyebrow, title, status, chartHtml, secondaryHtml = "", kpisHtml, detailsHtml, coverage = "" }) {
  return `<div class="an">
    <section class="an-analysis-head">
      <div><p class="ch-eyebrow">${esc(eyebrow)}</p><h2>${esc(title)}</h2>${coverage ? `<p>${esc(coverage)}</p>` : ""}</div>
      ${status ? `<span class="an-live-label">${esc(status)}</span>` : ""}
    </section>
    ${kpisHtml ? `<div class="ch-kpis an-kpis">${kpisHtml}</div>` : ""}
    <section class="an-visual-grid ${secondaryHtml ? "has-secondary" : ""}">
      <div class="an-primary-visual">
        ${chartHtml}
      </div>
      ${secondaryHtml ? `<aside class="an-secondary-visual">${secondaryHtml}</aside>` : ""}
    </section>
    <div class="an-insight-strip" aria-live="polite"><span>Explore</span><output data-an-insight-output>Select or hover a data point for detail.</output></div>
    ${detailsHtml || ""}
  </div>`;
}

function wireAnalyticsInteractions(root) {
  const output = root.querySelector("[data-an-insight-output]");
  root.querySelectorAll("[data-an-insight]").forEach((node) => {
    const show = () => { if (output) output.textContent = node.dataset.anInsight || ""; };
    node.addEventListener("mouseenter", show);
    node.addEventListener("focus", show);
    node.addEventListener("click", show);
  });
  root.querySelectorAll("[data-an-point]").forEach((point) => {
    const show = () => {
      const text = `${point.dataset.label} · ${point.dataset.date}: ${point.dataset.value}`;
      const readout = point.closest("[data-an-line-chart]")?.querySelector("[data-an-chart-readout]");
      if (readout) readout.textContent = text;
      if (output) output.textContent = text;
    };
    point.addEventListener("mouseenter", show);
    point.addEventListener("focus", show);
  });
}

function renderPulseDomain(root, view = "overview") {
  const productRows = productAnalyticsRows();
  const customSources = loadCustomSources();
  const customPoints = customSources.reduce((sum, source) => sum + (Array.isArray(source.points) ? source.points.length : 0), 0);
  const totalViews = productRows.reduce((sum, row) => sum + Number(row.views || 0), 0);
  const totalClicks = productRows.reduce((sum, row) => sum + Number(row.clicks || 0), 0);
  const conversion = totalViews ? totalClicks / totalViews * 100 : 0;
  const rows = productRows.map((row) => ({
    label: row.name,
    value: row.views,
    display: K(row.views),
    color: DOMAIN_COLORS.store,
    detail: `${row.name}: ${K(row.views)} views, ${K(row.clicks)} buy clicks, ${row.views ? (row.clicks / row.views * 100).toFixed(1) : "0.0"}% click rate.`,
  }));
  const funnel = domainFunnel([
    { label: "Product views", value: totalViews, color: DOMAIN_COLORS.store },
    { label: "Buy clicks", value: totalClicks, color: DOMAIN_COLORS.pulse },
  ]);
  const noTrend = domainLineChart([], {
    emptyTitle: "Historical store events are not connected",
    emptyBody: "The current product records contain cumulative counters only. Connect dated storefront events to unlock a real trend.",
  });
  const chartHtml = view === "trend" ? noTrend : domainBarChart(rows, { emptyTitle: "No product activity yet", ariaLabel: "Product views ranking" });
  root.innerHTML = domainCardHtml({
    eyebrow: "Business pulse",
    title: "Business performance",
    status: "Aggregate coverage",
    coverage: "Real cumulative product counters. No daily history is inferred from totals.",
    chartHtml,
    secondaryHtml: view === "overview" ? funnel : "",
    kpisHtml: `${kpi("Store views", K(totalViews), "cumulative")}${kpi("Buy clicks", K(totalClicks), "checkout intent")}${kpi("View → click", `${conversion.toFixed(1)}%`, "conversion")}${kpi("Tracked sources", String(productRows.length + customSources.length), `${customPoints} manual points`)}`,
  });
  wireAnalyticsInteractions(root);
}

function renderStoreDomain(root, view = "overview") {
  const rows = productAnalyticsRows();
  const bars = rows.map((row) => ({
    label: row.name,
    value: row.views,
    display: K(row.views),
    color: DOMAIN_COLORS.store,
    detail: `${row.name}: ${K(row.views)} views, ${K(row.clicks)} buy clicks, ${row.views ? (row.clicks / row.views * 100).toFixed(1) : "0.0"}% click rate.`,
  }));
  const totalViews = rows.reduce((sum, row) => sum + Number(row.views || 0), 0);
  const totalClicks = rows.reduce((sum, row) => sum + Number(row.clicks || 0), 0);
  const clickRate = totalViews ? Math.round(totalClicks / totalViews * 1000) / 10 : 0;
  const trend = domainLineChart([], {
    emptyTitle: "No dated storefront events",
    emptyBody: "Product totals are available, but a trustworthy time series requires dated view and click events.",
  });
  root.innerHTML = domainCardHtml({
    eyebrow: "PhantomStore",
    title: "Product performance",
    status: `${rows.length} products`,
    coverage: "Cumulative product telemetry",
    chartHtml: view === "trend" ? trend : domainBarChart(bars, { emptyTitle: "No product views yet", ariaLabel: "Product performance ranking" }),
    secondaryHtml: view === "overview" ? domainFunnel([
      { label: "Product views", value: totalViews, color: DOMAIN_COLORS.store },
      { label: "Buy clicks", value: totalClicks, color: DOMAIN_COLORS.pulse },
    ]) : "",
    kpisHtml: `${kpi("Store views", K(totalViews), "product page interest")}${kpi("Buy clicks", K(totalClicks), "checkout intent")}${kpi("Click rate", `${clickRate}%`, "views to buy clicks")}${kpi("Products", String(rows.length), "tracked")}`,
    detailsHtml: `<details class="an-connections">
      <summary><b>Product detail</b><span>${rows.length} tracked</span></summary>
      <section class="an-channel-list">
        ${rows.map((row) => `<article class="an-channel-row is-live">
          <div class="an-channel-id"><span class="ch-dot" style="background:${DOMAIN_COLORS.store}"></span><span><b>${esc(row.name)}</b><i>${esc(row.lane)}</i></span></div>
          <div class="an-channel-metrics"><span><b>${K(row.views)}</b>views</span><span><b>${K(row.clicks)}</b>clicks</span><span><b>${esc(row.revenue)}</b>revenue</span></div>
        </article>`).join("")}
      </section>
    </details>`,
  });
  wireAnalyticsInteractions(root);
}

async function renderGamesDomain(root, view = "overview") {
  root.innerHTML = domainCardHtml({ eyebrow: "PhantomPlay", title: "Loading game analytics…", chartHtml: `<div class="an-chart-wrap is-empty"><div class="an-chart-empty"><b>Loading…</b></div></div>` });
  try {
    const data = await fetchGamesAnalytics();
    const games = Array.isArray(data.games) ? data.games : [];
    const bars = games.map((g) => ({ label: g.title || g.gameId, value: g.plays || 0, display: K(g.plays || 0), color: DOMAIN_COLORS.games }));
    const totalPlays = games.reduce((sum, g) => sum + Number(g.plays || 0), 0);
    const totalPlayers = games.reduce((sum, g) => sum + Number(g.players || 0), 0);
    const avgSession = games.length ? Math.round((games.reduce((sum, g) => sum + Number(g.avgSessionMinutes || 0), 0) / games.length) * 10) / 10 : 0;
    const wishlists = games.reduce((sum, g) => sum + Number(g.wishlists || 0), 0);
    root.innerHTML = domainCardHtml({
      eyebrow: "PhantomPlay",
      title: "Plays by game",
      status: `${games.length} game${games.length === 1 ? "" : "s"}`,
      coverage: "Current developer analytics response",
      chartHtml: view === "trend"
        ? domainLineChart([], { emptyTitle: "No dated play events returned", emptyBody: "The game analytics endpoint currently returns per-game totals." })
        : domainBarChart(bars, { emptyTitle: "No plays yet", emptyBody: "Plays appear here once a game session logs.", ariaLabel: "Game plays ranking" }),
      secondaryHtml: view === "overview" ? domainBarChart(games.map((game) => ({
        label: game.title || game.gameId,
        value: game.players || 0,
        display: K(game.players || 0),
        color: "#42e9ff",
      })), { emptyTitle: "No player data yet", ariaLabel: "Unique players ranking" }) : "",
      kpisHtml: `${kpi("Total plays", K(totalPlays), "all games")}${kpi("Players", K(totalPlayers), "unique across games")}${kpi("Avg session", `${avgSession}m`, "per play")}${kpi("Wishlists", K(wishlists), "saved for later")}`,
    });
    wireAnalyticsInteractions(root);
  } catch (error) {
    root.innerHTML = domainCardHtml({
      eyebrow: "PhantomPlay",
      title: "Game analytics unavailable",
      chartHtml: `<div class="an-chart-wrap is-empty"><div class="an-chart-empty"><b>Could not load</b><span>${esc(error?.message || "Try again shortly.")}</span></div></div>`,
    });
  }
}

function renderCustomDomain(root, sourceId, onDeleted, view = "overview", range = "30") {
  const sources = loadCustomSources();
  const source = sources.find((item) => item.id === sourceId);
  if (!source) {
    root.innerHTML = domainCardHtml({ eyebrow: "Custom source", title: "Source not found", chartHtml: `<div class="an-chart-wrap is-empty"><div class="an-chart-empty"><b>Removed</b><span>Pick another source from the dropdown.</span></div></div>` });
    return;
  }
  const points = Array.isArray(source.points) ? source.points : [];
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - rangeDays(range) + 1);
  cutoff.setHours(0, 0, 0, 0);
  const rangedPoints = points.filter((point) => new Date(`${point.date}T00:00:00`).getTime() >= cutoff.getTime());
  const bars = rangedPoints.map((point) => ({ label: point.date, value: Number(point.value) || 0, display: fmtCustomValue(point.value, source.unit), color: DOMAIN_COLORS.custom }));
  const latest = points[points.length - 1];
  const chart = view === "compare"
    ? domainBarChart(bars, { emptyTitle: "No data in this range", ariaLabel: `${source.label} values` })
    : domainLineChart([{
      label: source.label,
      color: DOMAIN_COLORS.custom,
      points: rangedPoints.map((point) => ({ date: point.date, value: Number(point.value) || 0 })),
      format: (value) => fmtCustomValue(value, source.unit),
    }], { emptyTitle: "No data in this range", emptyBody: "Log a dated value below to start the trend.", range });
  root.innerHTML = domainCardHtml({
    eyebrow: "Custom source",
    title: source.label,
    status: `${points.length} point${points.length === 1 ? "" : "s"} logged`,
    coverage: `${rangeDays(range)} day selected range`,
    chartHtml: chart,
    kpisHtml: latest ? kpi("Latest", fmtCustomValue(latest.value, source.unit), latest.date) : "",
    detailsHtml: `<section class="ch-card an-custom-form">
      <div class="ch-card-h"><div><p class="ch-eyebrow">Log a data point</p><h3>${esc(source.label)}</h3></div></div>
      <form data-an-custom-log class="an-custom-log-form">
        <input type="date" name="date" value="${new Date().toISOString().slice(0, 10)}" required />
        <input type="number" step="any" name="value" placeholder="Value" required />
        <button class="btn btn-primary" type="submit">Log</button>
      </form>
      <button class="btn btn-ghost" type="button" data-an-custom-delete>Remove this source</button>
    </section>`,
  });
  wireAnalyticsInteractions(root);
  root.querySelector("[data-an-custom-log]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const date = form.date.value;
    const value = Number(form.value.value);
    if (!date || Number.isNaN(value)) return;
    const list = loadCustomSources();
    const target = list.find((item) => item.id === sourceId);
    if (!target) return;
    target.points = (Array.isArray(target.points) ? target.points : []).filter((point) => point.date !== date);
    target.points.push({ date, value });
    target.points.sort((a, b) => a.date.localeCompare(b.date));
    saveCustomSources(list);
    renderCustomDomain(root, sourceId, onDeleted, view, range);
  });
  root.querySelector("[data-an-custom-delete]")?.addEventListener("click", () => {
    saveCustomSources(loadCustomSources().filter((item) => item.id !== sourceId));
    onDeleted?.();
  });
}

function renderMoneyDomain(root, view = "overview", range = "30") {
  const money = moneyView();
  const rows = [
    { label: "Cash in", value: money.cashIn, display: fmtMoney(money.cashIn), color: "#63e2a9" },
    { label: "Cash out", value: money.cashOut, display: fmtMoney(money.cashOut), color: "#ff687d" },
    { label: "Net cash", value: Math.max(0, money.netCash), display: fmtMoney(money.netCash), color: DOMAIN_COLORS.money },
    { label: "Pipeline", value: money.pipeline, display: fmtMoney(money.pipeline), color: "#4ea1ff" },
    { label: "Won", value: money.wonValue, display: fmtMoney(money.wonValue), color: "#7c6cf0" },
  ];
  const cashInSeries = datedBuckets(money.transactions, range, (transaction) => transaction.amount > 0 ? transaction.amount : 0);
  const cashOutSeries = datedBuckets(money.transactions, range, (transaction) => transaction.amount < 0 ? Math.abs(transaction.amount) : 0);
  const trend = domainLineChart([
    { label: "Cash in", color: "#63e2a9", points: cashInSeries, format: fmtMoney },
    { label: "Cash out", color: "#ff687d", points: cashOutSeries, format: fmtMoney },
  ], {
    emptyTitle: "No ledger activity in this range",
    emptyBody: "Add or import dated transactions to populate the cash trend.",
    range,
  });
  root.innerHTML = domainCardHtml({
    eyebrow: "Accounting",
    title: "Cash movement",
    status: `${money.transactions.length} entries`,
    coverage: `${rangeDays(range)} day ledger window`,
    chartHtml: view === "compare" ? domainBarChart(rows, { emptyTitle: "No ledger activity yet", ariaLabel: "Accounting metric comparison" }) : trend,
    secondaryHtml: view === "overview" ? domainBarChart(rows.slice(0, 2), { emptyTitle: "No cash movement", ariaLabel: "Cash in and out comparison" }) : "",
    kpisHtml: `${kpi("Net cash", fmtMoney(money.netCash), "in minus out")}${kpi("Pipeline", fmtMoney(money.pipeline), "open proposals")}${kpi("Won", fmtMoney(money.wonValue), "closed value")}${kpi("Entries", String(money.transactions.length), "ledger activity")}`,
  });
  wireAnalyticsInteractions(root);
}

function mountDomain(root, domainId, onCustomDeleted, state) {
  const view = state.view;
  if (domainId === "pulse") { renderPulseDomain(root, view); return; }
  if (domainId === "store") { renderStoreDomain(root, view); return; }
  if (domainId === "games") { void renderGamesDomain(root, view); return; }
  if (domainId === "money") { renderMoneyDomain(root, view, state.range); return; }
  if (domainId === "intelligence") { renderCompetitorIntelligence(root, { embedded: true }); return; }
  if (domainId?.startsWith("custom:")) { renderCustomDomain(root, domainId.slice(7), onCustomDeleted, view, state.range); return; }
  renderSocialAnalytics(root, mediaOptsFor(root));
}

function mediaOptsFor(root) {
  return { esc };
}

function wireShell(body, opts) {
  const select = body.querySelector("[data-an-domain]");
  const range = body.querySelector("[data-an-range]");
  const view = body.querySelector("[data-an-view]");
  const root = body.querySelector("[data-analytics-domain-root]");
  const addBtn = body.querySelector("[data-an-add-source]");
  const addForm = body.querySelector("[data-an-add-source-form]");
  const domains = availableDomains();
  const saved = workspaceStorageGetItem(LAST_DOMAIN_KEY) || "";
  const initial = preferredInitialDomain(domains, saved);
  const state = { range: range.value, view: view.value };
  select.innerHTML = domains.map((domain) => `<option value="${esc(domain.id)}" ${domain.id === initial ? "selected" : ""}>${esc(domain.label)}</option>`).join("");
  select.onchange = () => {
    workspaceStorageSetItem(LAST_DOMAIN_KEY, select.value);
    mountDomain(root, select.value, () => wireShell(body, opts), state);
  };
  range.onchange = () => { state.range = range.value; mountDomain(root, select.value, () => wireShell(body, opts), state); };
  view.onchange = () => { state.view = view.value; mountDomain(root, select.value, () => wireShell(body, opts), state); };
  addBtn.onclick = () => { addForm.hidden = !addForm.hidden; if (!addForm.hidden) addForm.querySelector("input[name=label]")?.focus(); };
  addForm.querySelector("[data-an-add-source-cancel]").onclick = () => { addForm.hidden = true; addForm.reset(); };
  addForm.onsubmit = (event) => {
    event.preventDefault();
    const label = addForm.label.value.trim();
    if (!label) return;
    const unit = addForm.unit.value;
    const id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const list = loadCustomSources();
    list.push({ id, label, unit, points: [] });
    saveCustomSources(list);
    addForm.reset();
    addForm.hidden = true;
    workspaceStorageSetItem(LAST_DOMAIN_KEY, `custom:${id}`);
    wireShell(body, opts);
  };
  mountDomain(root, initial, () => wireShell(body, opts), state);
}

export function renderUnifiedAnalytics(body) {
  body.innerHTML = `
    <div class="an-domain-shell">
      <section class="ch-card an-domain-picker">
        <div class="ch-card-h">
          <div><p class="ch-eyebrow">Analytics</p><h3>Performance intelligence</h3></div>
          <div class="an-domain-controls">
            <select data-an-domain aria-label="Analytics source"></select>
            <select data-an-range aria-label="Time range">
              <option value="7">7 days</option>
              <option value="30" selected>30 days</option>
              <option value="90">90 days</option>
            </select>
            <select data-an-view aria-label="Visualization">
              <option value="overview" selected>Overview</option>
              <option value="trend">Trend</option>
              <option value="compare">Breakdown</option>
            </select>
            <button class="an-icon-button" type="button" data-an-add-source title="Add a data source" aria-label="Add a data source">+</button>
          </div>
        </div>
        <form class="an-add-source-form" data-an-add-source-form hidden>
          <input type="text" name="label" placeholder="Source name (e.g. Etsy Shop)" required maxlength="60" />
          <select name="unit">
            <option value="count">Count</option>
            <option value="dollars">Dollars</option>
            <option value="percent">Percent</option>
          </select>
          <button class="btn btn-primary" type="submit">Add</button>
          <button class="btn btn-ghost" type="button" data-an-add-source-cancel>Cancel</button>
        </form>
      </section>
      <div data-analytics-domain-root></div>
      <details class="an-connections an-ops-report">
        <summary title="Open operations report"><b>Operations</b><span aria-hidden="true">↗</span></summary>
        <div data-managed-growth-report></div>
      </details>
    </div>`;
  wireShell(body);
  const opsRoot = body.querySelector("[data-managed-growth-report]");
  const opsDetails = body.querySelector(".an-ops-report");
  opsDetails.addEventListener("toggle", () => {
    if (opsDetails.open && !opsRoot.dataset.mounted) {
      opsRoot.dataset.mounted = "1";
      mountManagedGrowthReport(opsRoot);
    }
  }, { once: false });
}
