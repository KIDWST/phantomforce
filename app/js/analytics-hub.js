/* One analytics hero: a single chart with a domain dropdown, instead of
   several stacked report sections. Built-in domains (social, store, games)
   plus free-form custom sources the user names and logs values into by hand
   — there is no Amazon/eBay/Etsy API integration here, just a generic manual
   metric tracker so "literally anything" can be charted. */
import {
  store, isAdmin, isOwnerOperator, session, currentTenantId,
  workspaceStorageGetItem, workspaceStorageSetItem,
} from "./store.js?v=phantom-live-20260728-68";
import { renderAnalytics as renderSocialAnalytics, productAnalyticsRows, kpi, K } from "./contenthub.js?v=phantom-live-20260728-68";
import { mountManagedGrowthReport } from "./managedgrowth.js?v=phantom-live-20260728-68";

const LAST_DOMAIN_KEY = "pf.analytics.lastDomain.v1";
const CUSTOM_SOURCES_KEY = "pf.analytics.customSources.v1";
const DOMAIN_COLORS = { store: "#39c98f", games: "#7c6cf0", custom: "#4ea1ff" };

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
  const domains = [{ id: "social", label: "Social media analytics" }];
  const hasProducts = Array.isArray(store?.state?.products) && store.state.products.length > 0;
  if (hasProducts) domains.push({ id: "store", label: "PhantomStore" });
  if (isAdmin() || isOwnerOperator()) domains.push({ id: "games", label: "PhantomPlay" });
  for (const source of loadCustomSources()) domains.push({ id: `custom:${source.id}`, label: source.label });
  return domains;
}

function domainBarChart(rows, { emptyTitle, emptyBody } = {}) {
  if (!rows.length) {
    return `<div class="an-chart-wrap is-empty"><div class="an-chart-empty"><b>${esc(emptyTitle || "No data yet")}</b><span>${esc(emptyBody || "")}</span></div></div>`;
  }
  const max = Math.max(1, ...rows.map((row) => Number(row.value) || 0));
  return `<div class="ch-bars">${rows.map((row) => `
    <div class="ch-bar-row">
      <span class="ch-bar-lab"><i class="ch-dot" style="background:${row.color}"></i>${esc(row.label)}</span>
      <span class="ch-bar-track"><span class="ch-bar-fill" style="width:${Math.round((Number(row.value) || 0) / max * 100)}%;background:${row.color}"></span></span>
      <b class="ch-bar-val">${esc(row.display ?? row.value)}</b>
    </div>`).join("")}</div>`;
}

function domainCardHtml({ eyebrow, title, status, chartHtml, kpisHtml, detailsHtml }) {
  return `<div class="an">
    <section class="ch-card an-trend-card">
      <div class="ch-card-h"><div><p class="ch-eyebrow">${esc(eyebrow)}</p><h3>${esc(title)}</h3></div>${status ? `<span class="an-live-label">${esc(status)}</span>` : ""}</div>
      ${chartHtml}
    </section>
    ${kpisHtml ? `<div class="ch-kpis an-kpis">${kpisHtml}</div>` : ""}
    ${detailsHtml || ""}
  </div>`;
}

function renderStoreDomain(root) {
  const rows = productAnalyticsRows();
  const bars = rows.map((row) => ({ label: row.name, value: row.views, display: K(row.views), color: DOMAIN_COLORS.store }));
  const totalViews = rows.reduce((sum, row) => sum + Number(row.views || 0), 0);
  const totalClicks = rows.reduce((sum, row) => sum + Number(row.clicks || 0), 0);
  const clickRate = totalViews ? Math.round(totalClicks / totalViews * 1000) / 10 : 0;
  root.innerHTML = domainCardHtml({
    eyebrow: "PhantomStore",
    title: "Views by product",
    status: `${rows.length} product${rows.length === 1 ? "" : "s"}`,
    chartHtml: domainBarChart(bars, { emptyTitle: "No product views yet", emptyBody: "Views appear here once your storefront gets traffic." }),
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
}

async function renderGamesDomain(root) {
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
      chartHtml: domainBarChart(bars, { emptyTitle: "No plays yet", emptyBody: "Plays appear here once a game session logs." }),
      kpisHtml: `${kpi("Total plays", K(totalPlays), "all games")}${kpi("Players", K(totalPlayers), "unique across games")}${kpi("Avg session", `${avgSession}m`, "per play")}${kpi("Wishlists", K(wishlists), "saved for later")}`,
    });
  } catch (error) {
    root.innerHTML = domainCardHtml({
      eyebrow: "PhantomPlay",
      title: "Game analytics unavailable",
      chartHtml: `<div class="an-chart-wrap is-empty"><div class="an-chart-empty"><b>Could not load</b><span>${esc(error?.message || "Try again shortly.")}</span></div></div>`,
    });
  }
}

function renderCustomDomain(root, sourceId, onDeleted) {
  const sources = loadCustomSources();
  const source = sources.find((item) => item.id === sourceId);
  if (!source) {
    root.innerHTML = domainCardHtml({ eyebrow: "Custom source", title: "Source not found", chartHtml: `<div class="an-chart-wrap is-empty"><div class="an-chart-empty"><b>Removed</b><span>Pick another source from the dropdown.</span></div></div>` });
    return;
  }
  const points = Array.isArray(source.points) ? source.points : [];
  const bars = points.slice(-14).map((point) => ({ label: point.date, value: Number(point.value) || 0, display: fmtCustomValue(point.value, source.unit), color: DOMAIN_COLORS.custom }));
  const latest = points[points.length - 1];
  root.innerHTML = domainCardHtml({
    eyebrow: "Custom source",
    title: source.label,
    status: `${points.length} point${points.length === 1 ? "" : "s"} logged`,
    chartHtml: domainBarChart(bars, { emptyTitle: "No data logged yet", emptyBody: "Log a value below to start the chart." }),
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
    renderCustomDomain(root, sourceId, onDeleted);
  });
  root.querySelector("[data-an-custom-delete]")?.addEventListener("click", () => {
    saveCustomSources(loadCustomSources().filter((item) => item.id !== sourceId));
    onDeleted?.();
  });
}

function mountDomain(root, domainId, onCustomDeleted) {
  if (domainId === "store") { renderStoreDomain(root); return; }
  if (domainId === "games") { void renderGamesDomain(root); return; }
  if (domainId?.startsWith("custom:")) { renderCustomDomain(root, domainId.slice(7), onCustomDeleted); return; }
  renderSocialAnalytics(root, mediaOptsFor(root));
}

function mediaOptsFor(root) {
  return { esc };
}

function wireShell(body, opts) {
  const select = body.querySelector("[data-an-domain]");
  const root = body.querySelector("[data-analytics-domain-root]");
  const addBtn = body.querySelector("[data-an-add-source]");
  const addForm = body.querySelector("[data-an-add-source-form]");
  const domains = availableDomains();
  const saved = workspaceStorageGetItem(LAST_DOMAIN_KEY) || "social";
  const initial = domains.some((domain) => domain.id === saved) ? saved : "social";
  select.innerHTML = domains.map((domain) => `<option value="${esc(domain.id)}" ${domain.id === initial ? "selected" : ""}>${esc(domain.label)}</option>`).join("");
  select.onchange = () => {
    workspaceStorageSetItem(LAST_DOMAIN_KEY, select.value);
    mountDomain(root, select.value, () => wireShell(body, opts));
  };
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
  mountDomain(root, initial, () => wireShell(body, opts));
}

export function renderUnifiedAnalytics(body) {
  body.innerHTML = `
    <div class="an-domain-shell">
      <section class="ch-card an-domain-picker">
        <div class="ch-card-h">
          <div><p class="ch-eyebrow">Analytics</p><h3>Pick what to track</h3></div>
          <div class="an-domain-controls">
            <select data-an-domain aria-label="Analytics source"></select>
            <button class="btn btn-ghost" type="button" data-an-add-source>+ Add source</button>
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
        <summary><b>Managed Growth Ops</b><span>Internal setup, CRM, and approvals report</span></summary>
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
