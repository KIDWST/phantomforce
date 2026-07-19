import { currentTenantId, session } from "./store.js?v=phantom-live-20260718-3";

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const TABS = [["radar", "Radar"], ["competitors", "Competitors"], ["sources", "Sources & settings"]];
const RADAR_WIDGETS = [["board", "Competitor board"], ["timeline", "Timeline"], ["alerts", "Alerts"], ["pressure", "Category pressure"], ["opportunities", "Opportunities"], ["estimates", "Latest estimates"]];
const TIMELINE_RANGES = [7, 30, 90];
const SIGNAL_ICONS = {
  website_copy: "¶", pricing_page: "$", landing_page: "◧", indexed_page: "⌕", public_ad: "▶", ad_volume: "≡",
  social_cadence: "↻", content_format: "◫", release_note: "⇪", documentation: "☰", app_store_note: "▤", public_review: "★",
  customer_complaint: "!", job_listing: "⚑", employee_role: "◔", partnership: "∞", event_appearance: "◈", newsletter: "✉",
  domain_change: "@", technology_stack: "⌗", search_pattern: "?", community_discussion: "…",
};
const SIGNAL_LABELS = {
  website_copy: "Website copy", pricing_page: "Pricing page", landing_page: "Landing page", indexed_page: "New indexed page",
  public_ad: "Public ad", ad_volume: "Ad volume", social_cadence: "Social cadence", content_format: "Content format",
  release_note: "Release note", documentation: "Documentation", app_store_note: "App-store note", public_review: "Public review",
  customer_complaint: "Customer complaint", job_listing: "Job listing", employee_role: "Employee role", partnership: "Partnership",
  event_appearance: "Event appearance", newsletter: "Newsletter", domain_change: "Domain change", technology_stack: "Public technology change",
  search_pattern: "Search pattern", community_discussion: "Community discussion",
};
const GAP_TYPES = [["question", "Ignored question"], ["complaint", "Weakly handled complaint"], ["pricing", "Pricing confusion"], ["feature", "Desired feature"], ["trust", "Trust concern"], ["segment", "Underserved segment"], ["objection", "Purchase objection"]];
const EVENT_TYPES = ["Price increase", "Product discontinuation", "Negative feedback spike", "New feature launch", "Rebrand", "Service outage", "Geographic expansion", "Audience shift", "Major campaign", "New subscription tier", "Policy change", "Public limitation"];
const ui = { tab: "radar", radarWidget: "board", loading: true, error: "", notice: "", snapshot: null, signalQuery: "", competitorFilter: "all", editingProfile: false, busy: "", selectedCompetitor: "", timelineCompetitor: "all", timelineDays: 30, timelineData: null, timelineLoading: false, timelineError: "" };
let root = null;

function authHeaders(json = false) {
  const token = session.token();
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(json ? { "Content-Type": "application/json" } : {}) };
}
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...authHeaders(Boolean(options.body)), ...(options.headers || {}) } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error || `Intelligence request failed (${response.status}).`);
  return payload;
}
async function refresh(silent = false) {
  if (!silent) ui.loading = true;
  ui.error = "";
  render();
  try { ui.snapshot = await api(`/api/competitor-intelligence?tenant_id=${encodeURIComponent(currentTenantId())}`); }
  catch (error) { ui.error = error instanceof Error ? error.message : "Competitor Intelligence is unavailable."; }
  finally { ui.loading = false; render(); }
}
async function run(path, body, success) {
  ui.notice = ""; ui.error = "";
  try {
    const payload = await api(path, { method: path.endsWith("/mode") ? "PATCH" : "POST", body: JSON.stringify({ ...body, tenantId: currentTenantId() }) });
    if (payload?.result?.allowed === false) {
      await refresh(true);
      ui.notice = "";
      ui.error = `Blocked: ${payload.result.boundary}. Safe alternative: ${payload.result.alternative}`;
      render();
      return false;
    }
    ui.notice = success; await refresh(true); return true;
  }
  catch (error) { ui.error = error instanceof Error ? error.message : "Request failed."; render(); return false; }
}
async function loadTimeline() {
  ui.timelineLoading = true; ui.timelineError = ""; render();
  try {
    const params = new URLSearchParams({ tenant_id: currentTenantId(), days: String(ui.timelineDays) });
    if (ui.timelineCompetitor && ui.timelineCompetitor !== "all") params.set("competitor_id", ui.timelineCompetitor);
    const payload = await api(`/api/competitor-intelligence/timeline?${params.toString()}`);
    ui.timelineData = payload?.timeline || null;
  } catch (error) { ui.timelineError = error instanceof Error ? error.message : "Timeline is unavailable."; ui.timelineData = null; }
  finally { ui.timelineLoading = false; render(); }
}
function openTimeline(competitorId = "all") {
  ui.tab = "radar"; ui.radarWidget = "timeline"; ui.timelineCompetitor = competitorId || "all"; ui.notice = ""; ui.error = "";
  loadTimeline();
  root?.scrollIntoView({ behavior: "smooth", block: "start" });
}
function fmtDate(value) { try { return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); } catch { return "Unknown date"; } }
function ago(value) { const minutes = Math.max(1, Math.round((Date.now() - new Date(value).getTime()) / 60000)); return minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.round(minutes / 60)}h ago` : `${Math.round(minutes / 1440)}d ago`; }
function competitorName(id) { return ui.snapshot?.competitors?.find((item) => item.id === id)?.name || "Unknown competitor"; }
function competitorOptions(includeAll = false, selectedId = "") { return `${includeAll ? '<option value="all">All competitors</option>' : '<option value="">Choose competitor</option>'}${(ui.snapshot?.competitors || []).map((item) => `<option value="${esc(item.id)}"${item.id === selectedId ? " selected" : ""}>${esc(item.name)}</option>`).join("")}`; }
function starterCompetitor(id) { return ui.snapshot?.starterCompetitors?.find((item) => item.id === id); }
function selectedCompetitorId() { const list = ui.snapshot?.competitors || []; return list.some((item) => item.id === ui.selectedCompetitor) ? ui.selectedCompetitor : list[0]?.id || ""; }
function statusPill(label, tone = "good") { return `<span class="ci-pill is-${tone}">${esc(label)}</span>`; }
function empty(title, text, action = "") { return `<div class="ci-empty"><span>◇</span><h3>${esc(title)}</h3><p>${esc(text)}</p>${action}</div>`; }
function message() { return `${ui.error ? `<div class="ci-message is-error">${esc(ui.error)}</div>` : ""}${ui.notice ? `<div class="ci-message is-success">${esc(ui.notice)}</div>` : ""}`; }
function scoutStatusLabel(status) {
  return ({ needs_context: "Needs business map", auto_analyzing: "Auto-scouting", analyzing: "Auto-scouting", ready_to_discover: "Starter map active", active: "Public scout active", watching: "Watching live sources", source_ready: "Source ready" }[status]) || "Public scout active";
}
function laneTone(status) { return status === "watching" ? "watching" : status === "source_ready" ? "source-ready" : status === "needs_context" ? "needs-context" : "analyzing"; }
function hashValue(value) {
  let hash = 0;
  for (const char of String(value || "")) hash = (hash * 31 + char.charCodeAt(0)) % 9973;
  return hash;
}
function momentumLabel(value) {
  const labels = { gaining: "UP", vulnerable: "DOWN", mixed: "MIXED", quiet: "QUIET", unwatched: "UNWATCHED" };
  return labels[value] || "WATCH";
}
function threatLabel(value) {
  const labels = { high: "High threat", medium: "Moderate threat", watch: "Lower threat" };
  return labels[value] || "Moderate threat";
}
function directThreat(item) {
  const text = `${item.name || ""} ${item.domain || ""} ${item.category || ""}`.toLowerCase();
  return /\b(chatgpt|openai|claude|anthropic|perplexity|gemini|google|highlevel|gohighlevel|hubspot|salesforce)\b/.test(text);
}
function threatClass(item) {
  if (directThreat(item)) return "direct";
  if (Number(item.score || 0) >= 72) return "hot";
  if (Number(item.score || 0) >= 66) return "warm";
  return "cool";
}
function nodeVector(item) {
  const score = Number(item.score || 0);
  return item.momentum === "vulnerable" ? "pressure" : item.momentum === "mixed" ? "mixed" : score >= 72 ? "leader" : score >= 66 ? "rising" : "watch";
}
function sourceStateLabel(item) {
  return item.sourceState === "starter" ? "Modeled baseline" : item.signalCount ? `${item.signalCount} public signals` : "Needs public source";
}
function hostOf(value) { try { return new URL(value).hostname; } catch { return String(value || ""); } }
function contextValue(field) { return ui.snapshot?.scout?.context?.[field] || ""; }
function businessContextComplete() {
  const p = ui.snapshot?.businessProfile;
  const c = ui.snapshot?.scout?.context;
  return Boolean((p?.businessName || c?.businessName) && (p?.offering || c?.offer) && (p?.audience || c?.audience));
}
function contextLine() {
  const p = ui.snapshot?.businessProfile;
  const c = ui.snapshot?.scout?.context;
  const name = p?.businessName || c?.businessName || "";
  const offer = p?.offering || c?.offer || "";
  const audience = p?.audience || c?.audience || "";
  const where = p?.geography || c?.location || "";
  if (!name && !offer) return "Business context needs confirmation. Phantom has starter signals, but the owner profile is the source of truth.";
  return [name, offer, audience ? `for ${audience}` : "", where].filter(Boolean).join(" · ");
}
function contextCard() {
  const ready = businessContextComplete();
  const memories = ui.snapshot?.memoryContext || {};
  return `<div class="ci-context ${ready ? "is-ready" : "needs-input"}">
    <div>
      <b>${esc(ready ? "Business context active" : "Confirm business context")}</b>
      <span>${esc(contextLine())}</span>
      <small>${ready ? "This profile is treated as gold context for targeting, memory, and AI routing." : "One clean profile is the main input Phantom needs: what you sell, who buys it, where you operate, and what makes you different."}</small>
    </div>
    <div class="ci-context-actions">
      <button class="ci-primary" type="button" data-ci-context-profile>${ready ? "Review context" : "Set business context"}</button>
      <button class="ci-secondary" type="button" data-ci-open-memory>Memory Vault${memories.count ? ` · ${Number(memories.count)}` : ""}</button>
    </div>
  </div>`;
}
function viewHead(kicker, title, hint = "") { return `<header class="ci-view-head"><p class="ci-kicker">${esc(kicker)}</p><h3>${esc(title)}</h3>${hint ? `<p>${esc(hint)}</p>` : ""}</header>`; }

/* ------------------------------- Radar view ------------------------------ */
function metrics() {
  const m = ui.snapshot.metrics;
  return `<section class="ci-metrics"><article><b>${Number(m.competitors || 0)}</b><span>Tracked competitors</span></article><article><b>${Number(m.signals || 0)}</b><span>Public signals</span></article><article><b>${Number(m.marketMovers || 0)}</b><span>Live movers</span></article><article class="${m.blockedRequests ? "is-alert" : ""}"><b>${Number(m.blockedRequests || 0)}</b><span>Blocked requests</span></article></section>`;
}
function marketMap() {
  const board = (ui.snapshot.marketBoard || []).slice(0, 12);
  if (!board.length) return "";
  const position = (item, index) => {
    const seed = hashValue(`${item.name}:${item.domain}`);
    const angle = (index / Math.max(1, board.length)) * Math.PI * 2 - Math.PI / 2;
    const ring = 28 + (index % 3) * 13 + (seed % 7);
    return {
      x: Math.max(9, Math.min(91, Math.round((50 + Math.cos(angle) * ring * 0.84) * 10) / 10)),
      y: Math.max(11, Math.min(89, Math.round((50 + Math.sin(angle) * ring * 0.55) * 10) / 10)),
    };
  };
  const heatSpots = [
    { x: 50, y: 50, size: 34, tone: "phantom" },
    ...board.map((item, index) => ({ ...position(item, index), size: Math.max(20, Math.min(42, Number(item.score || 50) * 0.46)), tone: threatClass(item) })),
  ];
  return `<section class="ci-market-map" aria-label="Competitor market map">
    <div class="ci-map-copy">
      <h4 class="ci-sub">Live market map</h4>
      <p>Node size follows each competitor's score. Starter scores are modeled from category position — add public sources to turn the radar into live evidence.</p>
      <div class="ci-map-legend"><span>Red = direct competitor</span><span>Amber = heat rising</span><span>Green = adjacent</span></div>
    </div>
    <div class="ci-map-stage">
      <div class="ci-map-heat" aria-hidden="true">${heatSpots.map((spot) => `<i class="is-${esc(spot.tone)}" style="--hx:${spot.x}%;--hy:${spot.y}%;--hs:${spot.size}vmin"></i>`).join("")}</div>
      <div class="ci-map-rings" aria-hidden="true"></div>
      <div class="ci-map-node is-phantom" style="--x:50%;--y:50%;--size:84px" title="Your position on the map — not a scored competitor"><strong>PF</strong><span>PhantomForce</span></div>
      ${board.map((item, index) => {
        const { x, y } = position(item, index);
        return `<button class="ci-map-node is-${esc(nodeVector(item))} is-threat-${esc(threatClass(item))} ${directThreat(item) ? "is-direct" : ""} ${item.sourceState === "starter" ? "is-starter" : ""}" type="button" data-ci-focus-competitor="${esc(item.competitorId)}" style="--x:${x}%;--y:${y}%;--size:${Math.max(44, Math.min(72, Number(item.score || 50)))}px">
          <strong>${esc(item.symbol)}</strong><span>${esc(item.name)}</span><b>${Number(item.score || 0)}</b>
        </button>`;
      }).join("")}
    </div>
  </section>`;
}
function clusterBars() {
  const charts = ui.snapshot.autoScout?.charts || [];
  if (!charts.length) return "";
  return `<section class="ci-auto-scout"><h4 class="ci-sub">Auto scout report · category pressure</h4><div class="ci-auto-bars">${charts.map((chart) => `<article class="is-${esc(chart.tone)}"><div><b>${esc(chart.label)}</b><span>${esc(chart.detail)}</span></div><strong>${Number(chart.value || 0)}</strong><i><em style="width:${Math.max(4, Math.min(100, Number(chart.value || 0)))}%"></em></i></article>`).join("")}</div></section>`;
}
function marketBoard() {
  const board = ui.snapshot.marketBoard || [];
  if (!board.length) return `<section class="ci-market-empty">${empty("Add the business map", ui.snapshot.scout?.status === "needs_context" ? "Fill in PhantomForce's offer, audience, and service area so Phantom can show the first competitor map." : "Track a competitor, then add public evidence for live rankings.", '<button class="ci-secondary" data-ci-tab="sources">Open sources & settings</button>')}</section>`;
  return `<section class="ci-market-board">${board.map((item) => {
    const starter = item.sourceState === "starter";
    const bodyHtml = starter
      ? `<div class="ci-threat-row"><span class="ci-threat-pill is-${esc(item.threat || "watch")}">${esc(threatLabel(item.threat))}</span></div>${item.whatItIs ? `<p class="ci-whatitis">${esc(item.whatItIs)}</p>` : ""}<p class="ci-edge"><b>Your edge:</b> ${esc(item.edge || item.tip)}</p>`
      : `<div class="ci-ticker"><span>${esc(momentumLabel(item.momentum))}</span><i style="width:${Math.max(6, Math.min(100, Number(item.score || 0)))}%"></i></div><p>${esc(item.tip)}</p>`;
    return `<article class="is-${esc(item.momentum)} ${starter ? "is-starter" : ""}" data-ci-card="${esc(item.competitorId)}"><header><span class="ci-symbol">${esc(item.symbol)}</span><div><p>${esc(item.category)} · ${esc(item.domain)}</p><h3>${esc(item.name)}</h3></div><b>${Number(item.score || 0)}</b></header>${bodyHtml}<p class="ci-proof">${esc(sourceStateLabel(item))}${item.lastSignalAt ? ` · last signal ${fmtDate(item.lastSignalAt)}` : ""}</p><div class="ci-watch-tags">${(item.watch || []).slice(0, 3).map((tag) => `<span>${esc(tag)}</span>`).join("")}</div>${starter ? `<button class="ci-primary" data-ci-track-starter="${esc(item.competitorId)}">Track + compare</button>` : item.signalCount ? `<div class="ci-card-actions"><button class="ci-secondary" data-ci-fuse="${esc(item.competitorId)}">Refresh estimate</button><button class="ci-secondary" data-ci-timeline="${esc(item.competitorId)}">View timeline</button></div>` : `<div class="ci-card-actions"><button class="ci-secondary" data-ci-tab="sources">Add source</button><button class="ci-secondary" data-ci-timeline="${esc(item.competitorId)}">View timeline</button></div>`}</article>`;
  }).join("")}</section>`;
}
function opportunityRail() {
  const tips = (ui.snapshot.tips || []).slice(0, 2);
  const autoOpps = (ui.snapshot.autoScout?.opportunities || []).slice(0, 3);
  if (!tips.length && !autoOpps.length) return empty("No opportunities yet", "Track a competitor and add public sources; Phantom will surface response options here.");
  return `<section class="ci-tips"><div>${tips.map((item) => `<article class="is-${esc(item.tone)}"><span>${esc(item.tone)}</span><h3>${esc(item.title)}</h3><p>${esc(item.detail)}</p></article>`).join("")}${autoOpps.map((item) => `<article class="is-${esc(item.tone)}"><span>${Number(item.impact || 0)} impact</span><h3>${esc(item.title)}</h3><p>${esc(item.detail)}</p><p class="ci-proof">${esc(item.action)}</p></article>`).join("")}</div></section>`;
}
function inferenceCard(item) {
  return `<article class="ci-inference"><header><div>${statusPill("ESTIMATE", "neutral")} ${statusPill(item.confidence.toUpperCase(), item.confidence === "high" ? "good" : item.confidence === "medium" ? "warn" : "neutral")}</div><time>${fmtDate(item.createdAt)}</time></header><p class="ci-overline">${esc(competitorName(item.competitorId))} · ${esc(item.area.replaceAll("_", " "))}</p><h3>${esc(item.estimate)}</h3><details><summary>Evidence and reasoning</summary><div class="ci-detail-grid"><div><h4>Supporting signals</h4><ul>${item.supportingSignals.map((signal) => `<li><a href="${esc(signal.source)}" target="_blank" rel="noopener noreferrer">${esc(signal.title)}</a><small>${fmtDate(signal.date)}</small></li>`).join("")}</ul></div><div><h4>Alternative explanations</h4><ul>${item.alternativeExplanations.map((text) => `<li>${esc(text)}</li>`).join("")}</ul></div><div><h4>Recommended verification</h4><ul>${item.recommendedVerification.map((text) => `<li>${esc(text)}</li>`).join("")}</ul></div><div><h4>Safe response options</h4><ul>${item.safeResponseOptions.map((text) => `<li>${esc(text)}</li>`).join("")}</ul></div></div></details><footer><span>Confidence score</span><div><i style="width:${Math.round(item.confidenceScore * 100)}%"></i></div><b>${Math.round(item.confidenceScore * 100)}%</b></footer></article>`;
}
/* ------------------------ Timeline + alerts panels ------------------------ */
function timelineItemCard(item) {
  const isEstimate = item.kind === "estimate";
  const icon = isEstimate ? "≈" : (SIGNAL_ICONS[item.type] || "•");
  const typeLabel = isEstimate ? String(item.type || "").replaceAll("_", " ") : (SIGNAL_LABELS[item.type] || item.type);
  const source = !isEstimate && item.sourceUrl ? ` · <a href="${esc(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(item.sourceLabel || "Source")}</a>` : "";
  return `<article class="ci-timeline-item ${isEstimate ? "is-estimate" : "is-signal"}">
    <span class="ci-timeline-icon" aria-hidden="true">${icon}</span>
    <div class="ci-timeline-body">
      <header>${statusPill(isEstimate ? "ESTIMATE" : "SIGNAL", isEstimate ? "neutral" : "good")}<b>${esc(typeLabel)}</b><time>${esc(ago(item.at))}</time></header>
      <h3>${esc(item.title)}</h3>
      <p>${esc(item.detail)}</p>
      <small>${esc(item.competitorName)}${source}</small>
    </div>
  </article>`;
}
function timelinePanel() {
  const scopeName = ui.timelineCompetitor === "all" ? "All competitors" : competitorName(ui.timelineCompetitor);
  const controls = `<div class="ci-timeline-controls">
    <select data-ci-timeline-competitor aria-label="Timeline competitor">${competitorOptions(true, ui.timelineCompetitor)}</select>
    <div class="ci-timeline-ranges" role="group" aria-label="Timeline range">${TIMELINE_RANGES.map((days) => `<button type="button" class="${Number(ui.timelineDays) === days ? "is-active" : ""}" data-ci-timeline-days="${days}">${days} days</button>`).join("")}</div>
  </div>`;
  let body;
  if (!(ui.snapshot.competitors || []).length) body = empty("Track a competitor first", "The timeline shows dated public signals and labeled estimates for competitors you track. Add one in the Competitors tab.");
  else if (ui.timelineLoading || (!ui.timelineData && !ui.timelineError)) body = `<p class="ci-timeline-loading">Loading dated activity…</p>`;
  else if (ui.timelineError) body = `<div class="ci-message is-error">${esc(ui.timelineError)}</div>`;
  else if (!ui.timelineData.groups?.length) body = empty("No dated activity in this range", `No stored public signals or labeled estimates for ${scopeName.toLowerCase() === "all competitors" ? "any tracked competitor" : scopeName} in the last ${Number(ui.timelineData.days)} days. Widen the range or record a dated public signal — nothing is fabricated here.`);
  else body = `<div class="ci-timeline-meta"><span>${Number(ui.timelineData.totalSignals || 0)} public signals</span><span>${Number(ui.timelineData.totalEstimates || 0)} labeled estimates</span><span>${esc(scopeName)} · last ${Number(ui.timelineData.days)} days</span></div>
    <div class="ci-timeline-groups">${ui.timelineData.groups.map((group) => `<section class="ci-timeline-day"><h4>${fmtDate(`${group.date}T12:00:00`)}</h4><div class="ci-timeline-items">${group.items.map(timelineItemCard).join("")}</div></section>`).join("")}</div>`;
  return `<section class="ci-timeline">${controls}${body}</section>`;
}
function alertsPanel() {
  const s = ui.snapshot;
  const alerts = s.alerts || [];
  const subs = s.alertSubscriptions || [];
  const unread = Number(s.metrics?.unreadAlerts || 0);
  const competitors = s.competitors || [];
  const list = alerts.length
    ? `<div class="ci-alert-list">${alerts.map((item) => `<article class="ci-alert ${item.read ? "" : "is-unread"}">
        <span class="ci-timeline-icon" aria-hidden="true">${SIGNAL_ICONS[item.signalType] || "•"}</span>
        <div class="ci-timeline-body">
          <header>${statusPill(item.read ? "READ" : "NEW", item.read ? "neutral" : "hot")}<b>${esc(SIGNAL_LABELS[item.signalType] || item.signalType)}</b><time>${esc(ago(item.createdAt))}</time></header>
          <h3>${esc(item.title)}</h3>
          <p>${esc(item.summary)}</p>
          <small>${esc(competitorName(item.competitorId))} · observed ${fmtDate(item.observedAt)}</small>
        </div>
        <div class="ci-alert-actions">${item.read ? "" : `<button class="ci-secondary" data-ci-alert-read="${esc(item.id)}">Mark read</button>`}<button class="ci-secondary" data-ci-timeline="${esc(item.competitorId)}">View timeline</button></div>
      </article>`).join("")}</div>`
    : empty("No alerts yet", subs.some((item) => item.enabled) ? "You're subscribed. When a new stored public signal matches your triggers, an in-app alert appears here." : "Turn on \"Alert me\" for a competitor below. Matching new public signals will create in-app alerts — nothing is emailed or pushed.");
  const subsBlock = competitors.length
    ? `<div class="ci-alert-subs"><h4 class="ci-sub">Alert subscriptions</h4><p class="ci-hint">In-app only — no email, push, or external notifications. Toggle alerts per competitor and pick which recorded signal types should trigger one.</p>${competitors.map((item) => {
        const sub = subs.find((entry) => entry.competitorId === item.id);
        const on = Boolean(sub?.enabled);
        const triggers = sub?.triggers || [];
        return `<details class="ci-alert-sub ${on ? "is-on" : ""}"><summary><b>${esc(item.name)}</b><span>${on ? (triggers.length ? `On · ${triggers.length} trigger type${triggers.length === 1 ? "" : "s"}` : "On · all signal types") : "Off"}</span><button type="button" class="${on ? "ci-secondary" : "ci-primary"}" data-ci-sub-toggle="${esc(item.id)}">${on ? "Turn off" : "Alert me"}</button></summary><form data-ci-sub-form="${esc(item.id)}"><div class="ci-alert-triggers">${Object.entries(SIGNAL_LABELS).map(([value, label]) => `<label class="ci-check"><input type="checkbox" name="trigger" value="${value}" ${triggers.includes(value) ? "checked" : ""}> ${esc(label)}</label>`).join("")}</div><p class="ci-proof">No boxes checked = alert on every signal type for this competitor.</p><button class="ci-primary" type="submit">Save triggers</button></form></details>`;
      }).join("")}</div>`
    : empty("Track a competitor first", "Alerts subscribe to competitors you already track. Add one in the Competitors tab.");
  return `<section class="ci-alerts"><div class="ci-alerts-head"><h4 class="ci-sub">In-app alerts${unread ? ` · ${unread} unread` : ""}</h4>${unread ? `<button class="ci-secondary" data-ci-alerts-read-all>Mark all read</button>` : ""}</div>${list}${subsBlock}</section>`;
}

function radarWidgetPanel() {
  const s = ui.snapshot;
  const widget = RADAR_WIDGETS.some(([id]) => id === ui.radarWidget) ? ui.radarWidget : "board";
  if (widget === "timeline") return timelinePanel();
  if (widget === "alerts") return alertsPanel();
  if (widget === "pressure") return clusterBars() || empty("No category pressure yet", "Track competitors across categories so Phantom can compare pressure once signals come in.");
  if (widget === "opportunities") return opportunityRail();
  if (widget === "estimates") {
    const latest = s.inferences.slice(0, 6);
    return latest.length ? `<div class="ci-inference-list">${latest.map(inferenceCard).join("")}</div>` : empty("No live estimates yet", "Starter competitors are modeled baselines. Track a competitor and add dated public signals before Phantom labels movement.", '<button class="ci-primary" data-ci-tab="sources">Add public source</button>');
  }
  return marketBoard();
}
function radar() {
  const s = ui.snapshot;
  const auto = s.autoScout || {};
  const widget = RADAR_WIDGETS.some(([id]) => id === ui.radarWidget) ? ui.radarWidget : "board";
  return `${viewHead("MARKET RADAR", auto.headline || "Where the market is moving")}
    ${contextCard()}
    ${metrics()}${marketMap()}
    <nav class="ci-radar-widgets" aria-label="Competitor views">${RADAR_WIDGETS.map(([id, label]) => `<button type="button" class="${widget === id ? "is-active" : ""}" data-ci-widget="${id}">${label}${id === "alerts" && Number(s.metrics?.unreadAlerts || 0) ? `<i class="ci-widget-badge">${Number(s.metrics.unreadAlerts)}</i>` : ""}</button>`).join("")}</nav>
    <section class="ci-radar-panel">${radarWidgetPanel()}</section>`;
}

/* ---------------------------- Competitors view ---------------------------- */
function leadCard(lead) {
  return `<article class="ci-lead"><header><h4>${esc(lead.archetype)}</h4></header><p>${esc(lead.description)}</p><div class="ci-lead-grid"><div><h5>Where to look</h5><ul>${lead.whereToFind.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div><div><h5>Try these public searches</h5><ul class="ci-queries">${lead.exampleQueries.map((q) => `<li><a href="https://www.google.com/search?q=${encodeURIComponent(q)}" target="_blank" rel="noopener noreferrer">${esc(q)} ↗</a></li>`).join("")}</ul></div></div><footer>${lead.signalsToWatch.map((s) => `<span class="ci-chip">${esc(SIGNAL_LABELS[s] || s)}</span>`).join("")}</footer></article>`;
}
function discoveryCard(run) {
  return `<section class="ci-discovery"><h4 class="ci-sub">Latest discovery · ${esc(run.segment)}</h4><p class="ci-basis">Based on: ${esc(run.basis)} · ${fmtDate(run.createdAt)}</p><div class="ci-lead-list">${run.leads.map(leadCard).join("")}</div><details class="ci-builder"><summary>All ${run.searchQueries.length} public search queries + directories</summary><div class="ci-detail-grid"><div><h4>Search queries</h4><ul class="ci-queries">${run.searchQueries.map((q) => `<li><a href="https://www.google.com/search?q=${encodeURIComponent(q)}" target="_blank" rel="noopener noreferrer">${esc(q)} ↗</a></li>`).join("")}</ul></div><div><h4>Directories & sources to check</h4><ul>${run.directories.map((d) => `<li>${esc(d)}</li>`).join("")}</ul></div></div></details><p class="ci-disclaimer">${esc(run.disclaimer)}</p></section>`;
}
function dossierCard(d) {
  return `<article class="ci-dossier"><header><div>${statusPill("DEEP DIVE", "hot")}<h3>${esc(d.competitorName)}</h3></div><time>${fmtDate(d.createdAt)}</time></header><p>${esc(d.focus)}</p><div class="ci-dossier-sources">${d.sources.map((s) => `<div class="ci-dossier-source"><div class="ci-dossier-source-head"><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.source)} ↗</a>${statusPill(SIGNAL_LABELS[s.signalType] || s.signalType, "neutral")}</div><p>${esc(s.whatItReveals)}</p><ul>${s.questions.map((q) => `<li>${esc(q)}</li>`).join("")}</ul></div>`).join("")}</div><div class="ci-detail-grid"><div><h4>Priority checklist</h4><ul>${d.priorityChecklist.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div><div><h4>Hypotheses to test</h4><ul>${d.hypothesisPrompts.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div></div><p class="ci-disclaimer">${esc(d.disclaimer)}</p></article>`;
}
function researchForms(selectedId) {
  return `<details class="ci-builder"><summary>Mine an audience gap</summary><form data-ci-gap-form><label>Competitor<select name="competitorId" required>${competitorOptions(false, selectedId)}</select></label><label>Theme type<select name="category">${GAP_TYPES.map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></label><label>Aggregated theme<textarea name="theme" rows="4" maxlength="700" placeholder="Several recent reviews ask…" required></textarea></label><label>Approximate occurrences<input name="volume" type="number" min="1" value="1" required></label><label>Public source URLs<textarea name="sourceUrls" rows="3" placeholder="One HTTPS URL per line" required></textarea></label><label class="ci-check"><input name="aggregated" type="checkbox" required> This is an aggregated theme, not an individual profile.</label><button class="ci-primary">Create opportunities</button></form></details>
  <details class="ci-builder"><summary>Search, offer, or timing opportunity</summary><form data-ci-opportunity-form><label>Competitor<select name="competitorId" required>${competitorOptions(false, selectedId)}</select></label><label>Opportunity<select name="kind"><option value="search">Search demand</option><option value="offer">Offer packaging</option><option value="timing">Launch timing</option></select></label><label>Title<input name="title" maxlength="200" required></label><label>Public evidence or pattern<textarea name="insight" rows="4" maxlength="1500" required></textarea></label><label>Source URL<input name="sourceUrl" type="url" required></label><button class="ci-primary">Build response options</button></form></details>
  <details class="ci-builder"><summary>Reverse-engineer a public creative strategy</summary><form data-ci-creative-form><label>Competitor<select name="competitorId" required>${competitorOptions(false, selectedId)}</select></label><label>Public source URL<input name="sourceUrl" type="url" required></label><div class="ci-form-row"><label>Hook category<input name="hookCategory" placeholder="Problem, proof, surprise…"></label><label>Emotional trigger<input name="emotionalTrigger" placeholder="Relief, ambition, urgency…"></label></div><label>Abstract source strategy<textarea name="sourceAbstract" rows="4" maxlength="2000" placeholder="Describe strategy, not copied wording." required></textarea></label><div class="ci-form-grid"><label>Story structure<input name="storyStructure"></label><label>Proof mechanism<input name="proofMechanism"></label><label>Pacing<input name="pacing"></label><label>Content density<input name="contentDensity"></label><label>Visual rhythm<input name="visualRhythm"></label><label>Shot distribution<input name="shotDistribution"></label><label>CTA structure<input name="ctaStructure"></label><label>Audience sophistication<input name="audienceSophistication"></label><label>Objection addressed<input name="objectionAddressed"></label><label>Desired action<input name="desiredAction"></label></div><label>Your substantially original response<textarea name="originalResponse" rows="5" maxlength="3000" required></textarea></label><button class="ci-primary">Analyze originality risk</button></form></details>
  <details class="ci-builder"><summary>Prepare a rapid response package</summary><form data-ci-intercept-form><label>Competitor<select name="competitorId" required>${competitorOptions(false, selectedId)}</select></label><label>Public event<select name="eventType">${EVENT_TYPES.map((item) => `<option>${item}</option>`).join("")}</select></label><label>Event summary<textarea name="eventSummary" rows="3" maxlength="1200" required></textarea></label><label>Supporting evidence<textarea name="evidence" rows="3" maxlength="1600" required></textarea></label><label>Public source URL<input name="sourceUrl" type="url" required></label><div class="ci-form-row"><label>Event date<input name="eventDate" type="date" value="${new Date().toISOString().slice(0, 10)}"></label><label>Response deadline<input name="responseDeadline" placeholder="Within 48 hours"></label></div><label>Why it matters<textarea name="whyItMatters" rows="2"></textarea></label><label>Original positioning angle<textarea name="positioningAngle" rows="2"></textarea></label><label>Original content brief<textarea name="contentBrief" rows="3"></textarea></label><label>Landing-page direction<textarea name="landingPageDraft" rows="3"></textarea></label><label>Deliverable offer option<textarea name="offerOption" rows="2"></textarea></label><button class="ci-primary">Build bounded response</button></form></details>
  <details class="ci-builder"><summary>Add authorized customer-experience evidence</summary><form data-ci-evidence-form><label>Competitor<select name="competitorId" required>${competitorOptions(false, selectedId)}</select></label><label>Evidence type<select name="evidenceType"><option>Quote</option><option>Demo notes</option><option>Public sales material</option><option>Pricing proposal</option><option>Onboarding observation</option><option>Support experience</option><option>Product screenshot</option><option>Terms or policy</option></select></label><label>Title<input name="title" maxlength="180" required></label><label>Observations<textarea name="observations" rows="5" maxlength="3000" required></textarea></label><label>Source reference<input name="sourceReference" maxlength="1000" placeholder="Document name, public URL, or authorized context"></label><label>Obtained date<input name="acquiredAt" type="date" value="${new Date().toISOString().slice(0, 10)}"></label><label class="ci-check"><input name="legitimatelyObtained" type="checkbox" required> I legitimately obtained and may analyze this material.</label><label class="ci-check"><input name="noDeceptionConfirmed" type="checkbox" required> No false identity, pretext, restricted recording, eligibility bypass, or confidentiality breach was used.</label><button class="ci-primary">Save evidence</button></form></details>`;
}
function researchLog(competitorId) {
  const s = ui.snapshot;
  const themes = s.audienceThemes.filter((item) => item.competitorId === competitorId);
  const opps = s.opportunities.filter((item) => item.competitorId === competitorId);
  const creatives = s.creativeAnalyses.filter((item) => item.competitorId === competitorId);
  const intercepts = s.interceptions.filter((item) => item.competitorId === competitorId);
  const evidence = s.mysteryEvidence.filter((item) => item.competitorId === competitorId);
  if (!themes.length && !opps.length && !creatives.length && !intercepts.length && !evidence.length) return empty("No research logged yet", "Use the research actions above — audience gaps, market opportunities, originality checks, response packages, and authorized evidence for this competitor will collect here.");
  return `<div class="ci-card-list">${themes.map((item) => `<article><header>${statusPill(item.category.toUpperCase(), "good")}<span>${Number(item.volume || 0)} observations</span></header><h3>${esc(item.theme)}</h3><ul>${item.opportunities.map((text) => `<li>${esc(text)}</li>`).join("")}</ul><small>${fmtDate(item.createdAt)}</small></article>`).join("")}${opps.map((item) => `<article><header>${statusPill(item.kind.toUpperCase(), "neutral")}<a href="${esc(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">Source ↗</a></header><h3>${esc(item.title)}</h3><p>${esc(item.insight)}</p><ul>${item.recommendations.map((text) => `<li>${esc(text)}</li>`).join("")}</ul></article>`).join("")}${creatives.map((item) => `<article class="ci-creative-card is-${item.similarityRisk}"><header>${statusPill(`${item.similarityRisk.toUpperCase()} SIMILARITY RISK`, item.similarityRisk === "high" ? "hot" : item.similarityRisk === "medium" ? "warn" : "good")}<b>${item.similarityScore}% lexical overlap</b></header><h3>${esc(item.hookCategory || "Creative strategy")}</h3><p>${esc(item.originalResponse)}</p><ul>${item.similarityWarnings.map((text) => `<li>${esc(text)}</li>`).join("")}</ul><details><summary>Abstract attributes</summary><dl><dt>Trigger</dt><dd>${esc(item.emotionalTrigger || "Not entered")}</dd><dt>Structure</dt><dd>${esc(item.storyStructure || "Not entered")}</dd><dt>Proof</dt><dd>${esc(item.proofMechanism || "Not entered")}</dd><dt>CTA</dt><dd>${esc(item.ctaStructure || "Not entered")}</dd></dl></details></article>`).join("")}${intercepts.map((item) => `<article class="ci-intercept-card"><header>${statusPill(item.eventType.toUpperCase(), "hot")}<time>${fmtDate(item.eventDate)}</time></header><h3>${esc(item.eventSummary)}</h3><p>${esc(item.whyItMatters)}</p><details><summary>Response package</summary><h4>Original positioning</h4><p>${esc(item.positioningAngle || "Use a distinct, customer-centered angle.")}</p><h4>Content brief</h4><p>${esc(item.contentBrief)}</p><h4>Landing page</h4><pre>${esc(item.landingPageDraft)}</pre><h4>Offer</h4><p>${esc(item.offerOption)}</p><div class="ci-detail-grid"><div><h4>Sales points</h4><ul>${item.salesTalkingPoints.map((text) => `<li>${esc(text)}</li>`).join("")}</ul></div><div><h4>Search content</h4><ul>${item.searchContent.map((text) => `<li>${esc(text)}</li>`).join("")}</ul></div><div><h4>Risks</h4><ul>${item.risks.map((text) => `<li>${esc(text)}</li>`).join("")}</ul></div><div><h4>Approvals</h4><ul>${item.requiredApprovals.map((text) => `<li>${esc(text)}</li>`).join("")}</ul></div></div></details></article>`).join("")}${evidence.map((item) => `<article><header>${statusPill(item.evidenceType.toUpperCase(), "neutral")}<time>${fmtDate(item.acquiredAt)}</time></header><h3>${esc(item.title)}</h3><p>${esc(item.observations)}</p><small>lawful-use attestation recorded</small></article>`).join("")}</div>`;
}
function competitorDetail(selected) {
  const dossier = ui.snapshot.dossiers.find((item) => item.competitorId === selected.id);
  const busy = ui.busy === `dossier:${selected.id}`;
  return `<div class="ci-comp-detail">
    <div class="ci-comp-detail-head"><div><b>${esc(selected.name)}</b><a href="${esc(selected.website)}" target="_blank" rel="noopener noreferrer">${esc(hostOf(selected.website))} ↗</a>${selected.notes ? `<p>${esc(selected.notes)}</p>` : ""}</div><div class="ci-comp-actions"><button class="ci-primary" data-ci-dossier="${esc(selected.id)}" ${busy ? "disabled" : ""}>${busy ? "Building…" : dossier ? "Refresh deep dive" : "Deep dive"}</button><button class="ci-secondary" data-ci-fuse="${esc(selected.id)}">Fuse signals</button><button class="ci-secondary" data-ci-timeline="${esc(selected.id)}">View timeline</button></div></div>
    ${dossier ? dossierCard(dossier) : empty("No dossier yet", `Generate a deep-dive research plan for ${selected.name} — public sources, a priority checklist, and hypotheses to verify.`)}
    <h4 class="ci-sub">Research actions</h4>${researchForms(selected.id)}
    <h4 class="ci-sub">Research log</h4>${researchLog(selected.id)}
  </div>`;
}
function competitorsView() {
  const s = ui.snapshot;
  const runs = s.discoveryRuns || [];
  const selectedId = selectedCompetitorId();
  const selected = s.competitors.find((item) => item.id === selectedId) || null;
  const trackedRows = s.competitors.map((item) => {
    const board = (s.marketBoard || []).find((entry) => entry.competitorId === item.id);
    return `<article class="ci-comp-row ${item.id === selectedId ? "is-selected" : ""}"><button type="button" class="ci-comp-open" data-ci-select="${esc(item.id)}"><b>${esc(item.name)}</b><small>${esc(hostOf(item.website))}${item.category ? ` · ${esc(item.category)}` : ""}</small>${board ? `<span>${Number(board.score || 0)} · ${esc(momentumLabel(board.momentum))} · ${esc(sourceStateLabel(board))}</span>` : ""}</button></article>`;
  }).join("");
  const starterRows = (s.starterCompetitors || []).map((item) => `<article class="ci-comp-row is-starter"><div class="ci-comp-open"><b>${esc(item.name)}</b><small>${esc(hostOf(item.website))} · ${esc(item.category)}</small></div><button class="ci-secondary" data-ci-track-starter="${esc(item.id)}">Track</button></article>`).join("");
  return `${viewHead("COMPETITORS", "Tracked competitors & deep dives", "Pick a competitor to open its dossier and research tools. Discovery finds who else to watch.")}
    <div class="ci-discover-cta"><div><b>Find my competitors</b><p>Generate a targeted list of who to watch, where they show up, and the exact public searches to run — from your business profile.</p></div><button class="ci-primary" data-ci-discover ${ui.busy === "discover" ? "disabled" : ""}>${ui.busy === "discover" ? "Analyzing…" : "Find competitors"}</button></div>
    ${runs.length ? discoveryCard(runs[0]) : ""}
    <section class="ci-comp-layout">
      <div class="ci-comp-list">
        <h4 class="ci-sub">Tracked</h4>
        ${trackedRows || empty("No competitors tracked yet", "Run discovery above, track a starter competitor, or add one manually.")}
        ${starterRows ? `<h4 class="ci-sub">Starter map · not yet tracked</h4>${starterRows}` : ""}
        <details class="ci-builder"><summary>Add a competitor manually</summary><form data-ci-competitor-form><label>Name<input name="name" maxlength="120" required></label><label>Public website<input name="website" type="url" placeholder="https://…" required></label><label>Category<input name="category" maxlength="100" placeholder="Local service, SaaS, retail…"></label><label>Notes<textarea name="notes" rows="3" maxlength="1000" placeholder="What makes this competitor relevant?"></textarea></label><button class="ci-primary" type="submit">Add competitor</button></form></details>
      </div>
      ${selected ? competitorDetail(selected) : `<div class="ci-comp-detail">${empty("No competitor selected", "Track or add a competitor on the left, then click it to open the dossier area.")}</div>`}
    </section>`;
}

/* ------------------------- Sources & settings view ------------------------ */
function modeCard() {
  const s = ui.snapshot; const enabled = s.settings.aggressiveMode;
  return `<section class="ci-mode ${enabled ? "is-active" : ""}"><div><h3>${enabled ? "Aggressive Intelligence is active" : "Standard intelligence is active"}</h3><p>${enabled ? "Phantom is fusing more weak public signals and preparing faster original responses. The lawful-use boundaries do not change." : "Public evidence stays organized and source-backed. Turn on aggressive mode to increase cross-signal interpretation."}</p></div><div class="ci-mode-actions">${statusPill(enabled ? "AGGRESSIVE" : "STANDARD", enabled ? "hot" : "good")}<button type="button" class="ci-primary" data-ci-mode ${!s.access.canManage || (!enabled && !s.access.aggressiveAvailable) ? "disabled" : ""}>${enabled ? "Use standard mode" : "Turn on aggressive mode"}</button></div></section>`;
}
function scoutForm() {
  return `<form class="ci-scout-form" data-ci-scout-form><div class="ci-form-row"><label>Business or brand<input name="businessName" maxlength="120" value="${esc(contextValue("businessName"))}" placeholder="e.g. ChicagoShots"></label><label>Location or service area<input name="location" maxlength="180" value="${esc(contextValue("location"))}" placeholder="Chicago, online, national…"></label></div><label>What do you sell?<input name="offer" maxlength="240" value="${esc(contextValue("offer"))}" placeholder="Offer, product, service, category…" required></label><label>Who buys it?<input name="audience" maxlength="240" value="${esc(contextValue("audience"))}" placeholder="Audience, segment, buyer type…"></label><label>What should Phantom watch for?<textarea name="goals" rows="3" maxlength="400" placeholder="Competitors gaining traction, pricing changes, product sales, weak reviews, content trends…">${esc(contextValue("goals"))}</textarea></label><button class="ci-primary" type="submit">${ui.snapshot?.scout?.context ? "Update scout map" : "Build scout map"}</button></form>`;
}
function scoutLaneCard(lane) {
  return `<article class="is-${esc(laneTone(lane.status))}">
    <span>${esc(scoutStatusLabel(lane.status))}</span>
    <h3>${esc(lane.label)}</h3>
    <p>${esc(lane.why)}</p>
    <div class="ci-lane-mini"><b>Looking at</b>${(lane.candidateCompetitors || []).slice(0, 4).map((item) => `<i>${esc(item)}</i>`).join("")}</div>
    <div class="ci-lane-mini"><b>Sources</b>${(lane.sourceTargets || []).slice(0, 3).map((item) => `<i>${esc(item)}</i>`).join("")}</div>
    <code>${esc(lane.nextAction || lane.query)}</code>
  </article>`;
}
function webDiscoveryBanner() {
  const w = ui.snapshot.webDiscovery || { connected: false, provider: "none", detail: "" };
  return `<div class="ci-web-status is-${w.connected ? "on" : "off"}"><span>${w.connected ? "◉" : "○"}</span><div><b>${w.connected ? `Automatic web discovery connected (${esc(w.provider)})` : "Automatic web discovery not connected"}</b><small>${esc(w.detail)}</small></div></div>`;
}
function profileSummary(p) {
  const rows = [["Category", p.category], ["What you sell", p.offering], ["Who you serve", p.audience], ["Where", p.geography], ["Positioning", p.positioning]].filter(([, v]) => v);
  const chips = (list) => (list || []).map((t) => `<span class="ci-chip">${esc(t)}</span>`).join("");
  return `<div class="ci-profile-view"><dl>${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("") || '<div><dt>Profile</dt><dd>Not set yet</dd></div>'}</dl>${(p.differentiators || []).length ? `<div class="ci-chip-row"><small>Differentiators</small>${chips(p.differentiators)}</div>` : ""}${(p.keywords || []).length ? `<div class="ci-chip-row"><small>Keywords</small>${chips(p.keywords)}</div>` : ""}</div>`;
}
function profileForm(p) {
  const list = (arr) => (arr || []).join(", ");
  return `<form data-ci-profile-form class="ci-profile-form"><div class="ci-form-row"><label>Business name<input name="businessName" maxlength="120" value="${esc(p.businessName)}"></label><label>Category<input name="category" maxlength="120" placeholder="Local photography studio, B2B SaaS…" value="${esc(p.category)}"></label></div><label>What you sell<textarea name="offering" rows="2" maxlength="400" placeholder="The core product or service and outcome">${esc(p.offering)}</textarea></label><div class="ci-form-row"><label>Who you serve<input name="audience" maxlength="300" placeholder="Your ideal customer" value="${esc(p.audience)}"></label><label>Where<input name="geography" maxlength="160" placeholder="City, region, or 'online'" value="${esc(p.geography)}"></label></div><label>One-line positioning<input name="positioning" maxlength="400" placeholder="How you want to be seen vs alternatives" value="${esc(p.positioning)}"></label><div class="ci-form-row"><label>Differentiators<input name="differentiators" placeholder="Comma separated" value="${esc(list(p.differentiators))}"></label><label>Keywords<input name="keywords" placeholder="Comma separated" value="${esc(list(p.keywords))}"></label></div><div class="ci-profile-actions"><button class="ci-primary" type="submit">Save profile</button><button class="ci-secondary" type="button" data-ci-profile-cancel>Cancel</button></div></form>`;
}
function sourcesView() {
  const s = ui.snapshot;
  const scout = s.scout || {};
  const profile = s.businessProfile;
  const profileBlock = ui.editingProfile
    ? profileForm(profile || { businessName: "", category: "", offering: "", audience: "", geography: "", positioning: "", differentiators: [], keywords: [] })
    : `${profileSummary(profile || {})}${s.access.canManage ? `<button class="ci-secondary" data-ci-edit-profile>${profile && !profile.autoSeeded ? "Edit profile" : "Set up profile"}</button>` : ""}`;
  const filtered = s.signals.filter((item) => (ui.competitorFilter === "all" || item.competitorId === ui.competitorFilter) && (!ui.signalQuery || `${item.title} ${item.summary}`.toLowerCase().includes(ui.signalQuery.toLowerCase())));
  return `${viewHead("SOURCES & SETTINGS", "Scout settings, public sources, and hard boundaries")}
    ${modeCard()}
    <section class="ci-two-col">
      <div>
        <div class="ci-settings-card"><div class="ci-settings-head"><h4 class="ci-sub">Market scout</h4>${statusPill(scoutStatusLabel(scout.status || "needs_context"), scout.status === "needs_context" ? "warn" : "good")}</div><p class="ci-hint">${esc(scout.briefing || "Public-source scouting is active.")}</p>${scout.missing?.length ? `<div class="ci-missing">${scout.missing.map((item) => `<span>${esc(item)}</span>`).join("")}</div>` : ""}${scoutForm()}<details class="ci-source-drawer"><summary>Source lanes Phantom is checking <span>${(scout.lanes || []).length}</span></summary><div class="ci-scout-lanes">${(scout.lanes || []).map(scoutLaneCard).join("")}</div></details></div>
        <div class="ci-settings-card ${profile?.autoSeeded ? "is-seeded" : ""}"><div class="ci-settings-head"><h4 class="ci-sub">Business context profile</h4>${profile?.autoSeeded ? statusPill("AUTO-DRAFTED — CONFIRM", "warn") : profile ? statusPill("SAVED TO MEMORY", "good") : ""}</div><p class="ci-hint">This is the gold context Phantom uses for competitor targeting, proposals, routing, and memories. Users can see or edit it from Memory.</p>${profileBlock}</div>
        ${webDiscoveryBanner()}
        <details class="ci-builder"><summary>Check a planned research action</summary><form data-ci-policy-form><label>Describe the planned action<textarea name="action" rows="4" maxlength="3000" required></textarea></label><button class="ci-primary">Check boundary</button></form></details>
        <div class="ci-boundaries"><h3>Hard boundaries</h3><p>Aggressive mode changes speed and synthesis, not access rights.</p><ul><li>Public and lawfully supplied evidence only</li><li>No identities, private groups, bypasses, or deception</li><li>No invasive targeting of individual commenters</li><li>No cloning protected expression</li><li>No outreach, publishing, or operational interference</li></ul></div>
      </div>
      <div>
        <details class="ci-builder" ${s.competitors.length ? "open" : ""}><summary>Add a public signal</summary><form data-ci-signal-form><label>Competitor<select name="competitorId" required>${competitorOptions()}</select></label><label>Signal type<select name="type" required>${Object.entries(SIGNAL_LABELS).map(([value, label]) => `<option value="${value}">${esc(label)}</option>`).join("")}</select></label><label>What changed?<input name="title" maxlength="180" required></label><label>Evidence summary<textarea name="summary" rows="4" maxlength="1500" required></textarea></label><label>Public source URL<input name="sourceUrl" type="url" placeholder="https://…" required></label><div class="ci-form-row"><label>Source label<input name="sourceLabel" maxlength="160"></label><label>Observed date<input name="observedAt" type="date" value="${new Date().toISOString().slice(0, 10)}" required></label></div><label class="ci-check"><input name="publicAccessConfirmed" type="checkbox" required> I confirm this is public and lawfully accessible.</label><button class="ci-primary" type="submit">Record signal</button></form></details>
        <div class="ci-stream-head"><h4 class="ci-sub">Public signals (${s.signals.length})</h4><div class="ci-tools"><input data-ci-signal-search type="search" value="${esc(ui.signalQuery)}" placeholder="Search evidence"><select data-ci-competitor-filter>${competitorOptions(true)}</select></div></div>
        <div class="ci-signal-list">${filtered.map((item) => `<article><span>${esc(SIGNAL_LABELS[item.type] || item.type)}</span><div><h3>${esc(item.title)}</h3><p>${esc(item.summary)}</p><small>${esc(competitorName(item.competitorId))} · ${fmtDate(item.observedAt)} · <a href="${esc(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(item.sourceLabel)}</a></small></div></article>`).join("") || empty("No matching signals", s.competitors.length ? "Change the filters or add a dated public signal." : "Track a competitor first, then record dated public signals here.")}</div>
        <h4 class="ci-sub">Allowed and blocked actions</h4>
        <div class="ci-audit">${s.audit.map((item) => `<article class="is-${item.result}"><span>${item.result === "blocked" ? "×" : "✓"}</span><div><h3>${esc(item.action.replaceAll("_", " "))}</h3><p>${esc(item.reason)}</p>${item.alternative ? `<small>Safe alternative: ${esc(item.alternative)}</small>` : ""}</div><time>${ago(item.createdAt)}</time></article>`).join("") || empty("Audit log is clear", "Mode changes, evidence intake, generated analyses, and blocked requests will appear here.")}</div>
      </div>
    </section>`;
}

/* --------------------------------- Shell ---------------------------------- */
function content() {
  if (ui.loading) return `<div class="ci-loading"><i></i><i></i><i></i><p>Loading public-signal intelligence…</p></div>`;
  if (!ui.snapshot) return empty("Intelligence is unavailable", ui.error || "The protected service did not respond.", '<button class="ci-primary" data-ci-retry>Try again</button>');
  if (!ui.snapshot.access.enabled) return empty("Competitor Intelligence is not included", "Ask the workspace owner about a plan with public-signal intelligence.");
  return ({ radar, competitors: competitorsView, sources: sourcesView }[ui.tab] || radar)();
}
function render() {
  if (!root) return;
  root.innerHTML = `<div class="ci-shell">${ui.snapshot?.access.enabled ? `<nav class="ci-tabs" aria-label="Competitor Intelligence sections">${TABS.map(([id, label]) => `<button type="button" class="${ui.tab === id ? "is-active" : ""}" data-ci-tab="${id}">${label}</button>`).join("")}</nav>` : ""}${message()}<main>${content()}</main></div>`;
  bind();
}
function formBody(form) {
  const data = Object.fromEntries(new FormData(form));
  form.querySelectorAll('input[type="checkbox"]').forEach((input) => { data[input.name] = input.checked; });
  return data;
}
function bindForm(selector, path, success, transform = (value) => value) {
  root.querySelector(selector)?.addEventListener("submit", async (event) => { event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('button[type="submit"], button:not([type])'); if (button) button.disabled = true; const ok = await run(path, transform(formBody(form)), success); if (ok) form.reset(); if (button) button.disabled = false; });
}
function bind() {
  root.querySelectorAll("[data-ci-tab]").forEach((button) => button.addEventListener("click", () => { ui.tab = button.dataset.ciTab; ui.notice = ""; ui.error = ""; render(); root.scrollIntoView({ behavior: "smooth", block: "start" }); }));
  root.querySelectorAll("[data-ci-widget]").forEach((button) => button.addEventListener("click", () => { ui.radarWidget = button.dataset.ciWidget; if (ui.radarWidget === "timeline") { loadTimeline(); return; } render(); }));
  root.querySelectorAll("[data-ci-timeline]").forEach((button) => button.addEventListener("click", () => openTimeline(button.dataset.ciTimeline)));
  root.querySelectorAll("[data-ci-timeline-days]").forEach((button) => button.addEventListener("click", () => { ui.timelineDays = Number(button.dataset.ciTimelineDays) || 30; loadTimeline(); }));
  const timelineSelect = root.querySelector("[data-ci-timeline-competitor]");
  if (timelineSelect) { timelineSelect.value = ui.timelineCompetitor; timelineSelect.addEventListener("change", (event) => { ui.timelineCompetitor = event.target.value || "all"; loadTimeline(); }); }
  root.querySelectorAll("[data-ci-alert-read]").forEach((button) => button.addEventListener("click", () => run("/api/competitor-intelligence/alerts/read", { alertIds: [button.dataset.ciAlertRead] }, "Alert marked read.")));
  root.querySelector("[data-ci-alerts-read-all]")?.addEventListener("click", () => run("/api/competitor-intelligence/alerts/read", { all: true }, "All alerts marked read."));
  root.querySelectorAll("[data-ci-sub-toggle]").forEach((button) => button.addEventListener("click", (event) => {
    event.preventDefault(); event.stopPropagation();
    const competitorId = button.dataset.ciSubToggle;
    const sub = (ui.snapshot?.alertSubscriptions || []).find((item) => item.competitorId === competitorId);
    run("/api/competitor-intelligence/alert-subscriptions", { competitorId, enabled: !sub?.enabled, triggers: sub?.triggers || [] }, sub?.enabled ? "In-app alerts turned off for this competitor." : "In-app alerts on — matching new signals will appear in the Alerts panel.");
  }));
  root.querySelectorAll("[data-ci-sub-form]").forEach((form) => form.addEventListener("submit", (event) => {
    event.preventDefault();
    const competitorId = form.dataset.ciSubForm;
    const triggers = [...form.querySelectorAll('input[name="trigger"]:checked')].map((input) => input.value);
    run("/api/competitor-intelligence/alert-subscriptions", { competitorId, enabled: true, triggers }, triggers.length ? "Alert triggers saved." : "Alert triggers saved — every signal type will alert.");
  }));
  if (ui.tab === "radar" && ui.radarWidget === "timeline" && ui.snapshot?.access?.enabled && !ui.timelineData && !ui.timelineLoading && !ui.timelineError && (ui.snapshot.competitors || []).length) loadTimeline();
  root.querySelector("[data-ci-retry]")?.addEventListener("click", () => refresh());
  root.querySelector("[data-ci-mode]")?.addEventListener("click", () => run("/api/competitor-intelligence/mode", { enabled: !ui.snapshot.settings.aggressiveMode }, ui.snapshot.settings.aggressiveMode ? "Standard mode restored." : "Aggressive Intelligence Mode activated."));
  root.querySelectorAll("[data-ci-fuse]").forEach((button) => button.addEventListener("click", () => run("/api/competitor-intelligence/fuse", { competitorId: button.dataset.ciFuse }, "Public signals fused into labeled estimates.")));
  root.querySelectorAll("[data-ci-select]").forEach((button) => button.addEventListener("click", () => { ui.selectedCompetitor = button.dataset.ciSelect; render(); }));
  root.querySelectorAll("[data-ci-focus-competitor]").forEach((button) => button.addEventListener("click", () => {
    const card = [...root.querySelectorAll("[data-ci-card]")].find((item) => item.dataset.ciCard === button.dataset.ciFocusCompetitor);
    if (!card) return;
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.classList.add("is-pulsing");
    window.setTimeout(() => card.classList.remove("is-pulsing"), 1200);
  }));
  root.querySelectorAll("[data-ci-track-starter]").forEach((button) => button.addEventListener("click", () => {
    const item = starterCompetitor(button.dataset.ciTrackStarter);
    if (!item) return;
    run("/api/competitor-intelligence/competitors", { name: item.name, website: item.website, category: item.category, notes: item.notes }, `${item.name} is now tracked. Add public sources for live intelligence.`);
  }));
  root.querySelector("[data-ci-signal-search]")?.addEventListener("input", (event) => { ui.signalQuery = event.target.value; render(); root.querySelector("[data-ci-signal-search]")?.focus(); });
  const filter = root.querySelector("[data-ci-competitor-filter]"); if (filter) { filter.value = ui.competitorFilter; filter.addEventListener("change", (event) => { ui.competitorFilter = event.target.value; render(); }); }
  root.querySelector("[data-ci-edit-profile]")?.addEventListener("click", () => { ui.editingProfile = true; render(); });
  root.querySelector("[data-ci-context-profile]")?.addEventListener("click", () => { ui.tab = "sources"; ui.editingProfile = true; ui.notice = ""; ui.error = ""; render(); root.scrollIntoView({ behavior: "smooth", block: "start" }); });
  root.querySelector("[data-ci-open-memory]")?.addEventListener("click", () => {
    window.dispatchEvent(new CustomEvent("phantom:navigate", { detail: { nav: "memory" } }));
  });
  root.querySelector("[data-ci-profile-cancel]")?.addEventListener("click", () => { ui.editingProfile = false; render(); });
  root.querySelector("[data-ci-discover]")?.addEventListener("click", async () => {
    ui.busy = "discover"; ui.error = ""; ui.notice = ""; render();
    await run("/api/competitor-intelligence/discover", {}, "Competitor discovery generated from your profile.");
    ui.busy = ""; render();
  });
  root.querySelectorAll("[data-ci-dossier]").forEach((button) => button.addEventListener("click", async () => {
    ui.busy = `dossier:${button.dataset.ciDossier}`; ui.error = ""; ui.notice = ""; render();
    await run("/api/competitor-intelligence/dossier", { competitorId: button.dataset.ciDossier }, "Deep-dive research plan generated.");
    ui.busy = ""; render();
  }));
  root.querySelector("[data-ci-profile-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('button[type="submit"]'); if (button) button.disabled = true;
    ui.notice = ""; ui.error = "";
    try {
      await api("/api/competitor-intelligence/business-profile", { method: "PUT", body: JSON.stringify({ ...formBody(form), tenantId: currentTenantId() }) });
      ui.editingProfile = false; ui.notice = "Business profile saved."; await refresh(true);
    } catch (error) { ui.error = error instanceof Error ? error.message : "Profile could not be saved."; if (button) button.disabled = false; render(); }
  });
  bindForm("[data-ci-competitor-form]", "/api/competitor-intelligence/competitors", "Competitor profile added.");
  bindForm("[data-ci-scout-form]", "/api/competitor-intelligence/scout", "AI market scout armed.");
  bindForm("[data-ci-signal-form]", "/api/competitor-intelligence/signals", "Public signal recorded.");
  bindForm("[data-ci-gap-form]", "/api/competitor-intelligence/audience-themes", "Audience gap converted into original opportunities.", (data) => ({ ...data, sourceUrls: String(data.sourceUrls || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean) }));
  bindForm("[data-ci-opportunity-form]", "/api/competitor-intelligence/opportunities", "Original market response options prepared.");
  bindForm("[data-ci-creative-form]", "/api/competitor-intelligence/creative-analyses", "Creative strategy analyzed for originality risk.");
  bindForm("[data-ci-intercept-form]", "/api/competitor-intelligence/interceptions", "Bounded response package prepared.");
  bindForm("[data-ci-evidence-form]", "/api/competitor-intelligence/mystery-evidence", "Authorized evidence saved.");
  bindForm("[data-ci-policy-form]", "/api/competitor-intelligence/policy-check", "Research action passed the current boundary check.");
}

export function renderCompetitorIntelligence(target, options = {}) {
  root = target; ui.tab = "radar"; ui.editingProfile = false; ui.busy = ""; ui.selectedCompetitor = ""; ui.timelineCompetitor = "all"; ui.timelineDays = 30; ui.timelineData = null; ui.timelineLoading = false; ui.timelineError = ""; refresh();
}
