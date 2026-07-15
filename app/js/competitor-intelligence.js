import { currentTenantId, session } from "./store.js?v=phantom-live-20260714-258";

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const TABS = [
  ["overview", "Market radar"], ["signals", "Sources"], ["opportunities", "Opportunities"],
  ["creative", "Creative"], ["intercept", "Intercept"], ["evidence", "Evidence & audit"],
];
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
const ui = { tab: "overview", loading: true, error: "", notice: "", snapshot: null, signalQuery: "", competitorFilter: "all" };
let root = null;
let opts = null;

function authHeaders(json = false) {
  const token = session.token();
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(json ? { "Content-Type": "application/json" } : {}) };
}
function friendlyIntelligenceError(status, message = "") {
  const text = String(message || "");
  if (status === 401 || /authorization bearer/i.test(text)) return "Sign in to load Competitor Intelligence.";
  return text || `Intelligence request failed (${status}).`;
}
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...authHeaders(Boolean(options.body)), ...(options.headers || {}) } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(friendlyIntelligenceError(response.status, payload?.error));
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
function fmtDate(value) { try { return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); } catch { return "Unknown date"; } }
function ago(value) { const minutes = Math.max(1, Math.round((Date.now() - new Date(value).getTime()) / 60000)); return minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.round(minutes / 60)}h ago` : `${Math.round(minutes / 1440)}d ago`; }
function competitorName(id) { return ui.snapshot?.competitors?.find((item) => item.id === id)?.name || "Unknown competitor"; }
function competitorOptions(includeAll = false) { return `${includeAll ? '<option value="all">All competitors</option>' : '<option value="">Choose competitor</option>'}${(ui.snapshot?.competitors || []).map((item) => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join("")}`; }
function starterCompetitor(id) { return ui.snapshot?.starterCompetitors?.find((item) => item.id === id); }
function statusPill(label, tone = "good") { return `<span class="ci-pill is-${tone}">${esc(label)}</span>`; }
function empty(title, text, action = "") { return `<div class="ci-empty"><span>◇</span><h3>${esc(title)}</h3><p>${esc(text)}</p>${action}</div>`; }
function message() { return `${ui.error ? `<div class="ci-message is-error">${esc(ui.error)}</div>` : ""}${ui.notice ? `<div class="ci-message is-success">${esc(ui.notice)}</div>` : ""}`; }
function scoutStatusLabel(status) {
  return ({ needs_context: "Starter map active", auto_analyzing: "Auto-scouting", analyzing: "Auto-scouting", ready_to_discover: "Starter map active", active: "Public scout active", watching: "Watching live sources", source_ready: "Source ready" }[status]) || "Public scout active";
}
function laneTone(status) { return status === "watching" ? "watching" : status === "source_ready" ? "source-ready" : status === "needs_context" ? "needs-context" : "analyzing"; }
function hashValue(value) {
  let hash = 0;
  for (const char of String(value || "")) hash = (hash * 31 + char.charCodeAt(0)) % 9973;
  return hash;
}
function percent(value) { return `${value >= 0 ? "+" : ""}${value}%`; }
function trendProfile(item) {
  const seed = hashValue(`${item.name}:${item.domain}:${item.score}`);
  const score = Number(item.score || 50);
  const signalWeight = Math.min(14, Number(item.signalCount || 0) * 3);
  const base = score - 64 + signalWeight;
  const oneYear = Math.round(base * 0.9 + (seed % 13) - 6);
  const fiveYear = Math.round(base * 2.3 + (seed % 29) - 12);
  const volatility = 14 + (seed % 18);
  const points = Array.from({ length: 16 }, (_, index) => {
    const wave = Math.sin((index + (seed % 7)) * 0.75) * volatility * 0.32;
    const slope = (oneYear / 15) * index;
    return Math.max(8, Math.min(92, 48 + (score - 66) * 0.38 + slope + wave));
  });
  const vector = item.momentum === "vulnerable" ? "pressure" : item.momentum === "mixed" ? "mixed" : score >= 72 ? "leader" : score >= 66 ? "rising" : "watch";
  return { oneYear, fiveYear, points, vector };
}
function directThreat(item) {
  const text = `${item.name || ""} ${item.domain || ""} ${item.category || ""}`.toLowerCase();
  return /\b(chatgpt|openai|claude|anthropic|perplexity|gemini|google|highlevel|gohighlevel|hubspot|salesforce)\b/.test(text);
}
function threatClass(item) {
  if (item.name === "PhantomForce") return "phantom";
  if (directThreat(item)) return "direct";
  if (Number(item.score || 0) >= 72) return "hot";
  if (Number(item.score || 0) >= 66) return "warm";
  return "cool";
}
function sparkline(points) {
  const coords = points.map((value, index) => `${(index / Math.max(1, points.length - 1)) * 100},${32 - (value / 100) * 30}`).join(" ");
  return `<svg class="ci-sparkline" viewBox="0 0 100 34" preserveAspectRatio="none" aria-hidden="true"><polyline points="${coords}"></polyline></svg>`;
}
function sourceStateLabel(item) {
  return item.sourceState === "starter" ? "Modeled baseline" : item.signalCount ? `${item.signalCount} public signals` : "Needs public source";
}
function marketMap() {
  const board = (ui.snapshot.marketBoard || []).slice(0, 12);
  if (!board.length) return "";
  const phantomScore = Math.max(72, Math.round(board.reduce((sum, item) => sum + Number(item.score || 0), 0) / board.length) + 4);
  const heatSpots = [
    { x: 50, y: 50, size: 34, tone: "phantom" },
    ...board.map((item, index) => {
      const seed = hashValue(`${item.name}:heat`);
      const angle = (index / Math.max(1, board.length)) * Math.PI * 2 - Math.PI / 2;
      const ring = 28 + (index % 3) * 13 + (seed % 7);
      return {
        x: Math.max(9, Math.min(91, Math.round((50 + Math.cos(angle) * ring * 0.84) * 10) / 10)),
        y: Math.max(11, Math.min(89, Math.round((50 + Math.sin(angle) * ring * 0.55) * 10) / 10)),
        size: Math.max(20, Math.min(42, Number(item.score || 50) * 0.46)),
        tone: threatClass(item),
      };
    }),
  ];
  return `<section class="ci-market-map" aria-label="Interactive competitor map">
    <div class="ci-map-copy">
      <p class="ci-kicker">LIVE MARKET MAP</p>
      <h2>Where PhantomForce lines up</h2>
      <p>Starter scores are modeled from category position. Add public sources to turn the radar into live evidence.</p>
      <div class="ci-map-legend"><span>Red = direct competitor</span><span>Amber = heat rising</span><span>Green = adjacent</span></div>
    </div>
    <div class="ci-map-stage">
      <div class="ci-map-heat" aria-hidden="true">${heatSpots.map((spot) => `<i class="is-${esc(spot.tone)}" style="--hx:${spot.x}%;--hy:${spot.y}%;--hs:${spot.size}vmin"></i>`).join("")}</div>
      <div class="ci-map-rings" aria-hidden="true"></div>
      <button class="ci-map-node is-phantom" type="button" style="--x:50%;--y:50%;--size:84px">
        <strong>PF</strong><span>PhantomForce</span><b>${phantomScore}</b>
      </button>
      ${board.map((item, index) => {
        const seed = hashValue(item.name);
        const angle = (index / Math.max(1, board.length)) * Math.PI * 2 - Math.PI / 2;
        const ring = 28 + (index % 3) * 13 + (seed % 7);
        const x = Math.max(9, Math.min(91, Math.round((50 + Math.cos(angle) * ring * 0.84) * 10) / 10));
        const y = Math.max(11, Math.min(89, Math.round((50 + Math.sin(angle) * ring * 0.55) * 10) / 10));
        const trend = trendProfile(item);
        return `<button class="ci-map-node is-${esc(trend.vector)} is-threat-${esc(threatClass(item))} ${directThreat(item) ? "is-direct" : ""} ${item.sourceState === "starter" ? "is-starter" : ""}" type="button" data-ci-focus-competitor="${esc(item.competitorId)}" style="--x:${x}%;--y:${y}%;--size:${Math.max(44, Math.min(72, Number(item.score || 50)))}px">
          <strong>${esc(item.symbol)}</strong><span>${esc(item.name)}</span><b>${Number(item.score || 0)}</b>
        </button>`;
      }).join("")}
    </div>
    <div class="ci-market-leaders">
      ${board.slice(0, 5).map((item) => {
        const trend = trendProfile(item);
        return `<button type="button" data-ci-focus-competitor="${esc(item.competitorId)}"><span>${esc(item.name)}</span><b>${Number(item.score || 0)}</b><i>${percent(trend.oneYear)} 1Y</i></button>`;
      }).join("")}
    </div>
  </section>`;
}

function modeCard() {
  const s = ui.snapshot; const enabled = s.settings.aggressiveMode;
  return `<section class="ci-mode ${enabled ? "is-active" : ""}"><div><p class="ci-kicker">OPTIONAL ANALYSIS LAYER</p><h2>${enabled ? "Aggressive Intelligence is active" : "Standard intelligence is active"}</h2><p>${enabled ? "Phantom is fusing more weak public signals and preparing faster original responses. The lawful-use boundaries do not change." : "Public evidence stays organized and source-backed. Turn on aggressive mode to increase cross-signal interpretation."}</p></div><div class="ci-mode-actions">${statusPill(enabled ? "AGGRESSIVE" : "STANDARD", enabled ? "hot" : "good")}<button type="button" class="ci-primary" data-ci-mode ${!s.access.canManage || (!enabled && !s.access.aggressiveAvailable) ? "disabled" : ""}>${enabled ? "Use standard mode" : "Turn on aggressive mode"}</button></div></section>`;
}
function metrics() {
  const m = ui.snapshot.metrics;
  return `<section class="ci-metrics"><article><b>${m.competitors}</b><span>Tracked competitors</span></article><article><b>${m.starterCompetitors || 0}</b><span>Starter map</span></article><article><b>${m.signals}</b><span>Public signals</span></article><article><b>${m.marketMovers || 0}</b><span>Live movers</span></article><article><b>${m.sourceLanes || m.activeScoutLanes || 0}</b><span>Source lanes</span></article><article class="${m.blockedRequests ? "is-alert" : ""}"><b>${m.blockedRequests}</b><span>Blocked requests</span></article></section>`;
}
function hostFrom(url) { try { return new URL(url).hostname.replace(/^www\./u, ""); } catch { return "public source"; } }
function contextValue(field) { return ui.snapshot?.scout?.context?.[field] || ""; }
function momentumLabel(value) {
  const labels = { gaining: "UP", vulnerable: "DOWN", mixed: "MIXED", quiet: "QUIET", unwatched: "UNWATCHED" };
  return labels[value] || "WATCH";
}
function scoutForm() {
  return `<form class="ci-scout-form" data-ci-scout-form><div class="ci-form-row"><label>Business or brand<input name="businessName" maxlength="120" value="${esc(contextValue("businessName"))}" placeholder="e.g. ChicagoShots"></label><label>Location or service area<input name="location" maxlength="180" value="${esc(contextValue("location"))}" placeholder="Chicago, online, national…"></label></div><label>What do you sell?<input name="offer" maxlength="240" value="${esc(contextValue("offer"))}" placeholder="Offer, product, service, category…" required></label><label>Who buys it?<input name="audience" maxlength="240" value="${esc(contextValue("audience"))}" placeholder="Audience, segment, buyer type…"></label><label>What should Phantom watch for?<textarea name="goals" rows="3" maxlength="400" placeholder="Competitors gaining traction, pricing changes, product sales, weak reviews, content trends…">${esc(contextValue("goals"))}</textarea></label><button class="ci-primary" type="submit">Build scout map</button></form>`;
}
function autoScoutReport() {
  const report = ui.snapshot.autoScout;
  if (!report) return "";
  const set = report.competitorSet || {};
  const charts = report.charts || [];
  const comparisons = report.comparisons || [];
  const opportunities = report.opportunities || [];
  return `<div class="ci-auto-scout">
    <header>
      <div><p class="ci-kicker">AUTO SCOUT REPORT</p><h3>${esc(report.headline)}</h3><span>${esc(report.sourceNote)}</span></div>
      <dl>
        <div><dt>Compared</dt><dd>${Number(set.totalCompared || 0)}</dd></div>
        <div><dt>Tracked</dt><dd>${Number(set.tracked || 0)}</dd></div>
        <div><dt>Sources</dt><dd>${Number(set.liveSignals || 0)}</dd></div>
        <div><dt>Confidence</dt><dd>${esc(set.confidence || "starter")}</dd></div>
      </dl>
    </header>
    <div class="ci-auto-bars">${charts.map((chart) => `<article class="is-${esc(chart.tone)}"><div><b>${esc(chart.label)}</b><span>${esc(chart.detail)}</span></div><strong>${Number(chart.value || 0)}</strong><i><em style="width:${Math.max(4, Math.min(100, Number(chart.value || 0)))}%"></em></i></article>`).join("")}</div>
    <div class="ci-auto-compare">${comparisons.slice(0, 6).map((item) => `<article class="is-${esc(item.threatLevel)}"><div><span>${esc(item.sourceState)} · ${esc(item.category)}</span><h4>${esc(item.name)}</h4><p>${esc(item.phantomAngle)}</p><small>${(item.sourceTargets || []).map((source) => esc(source.label)).join(" · ")}</small></div><b>${Number(item.score || 0)}</b></article>`).join("")}</div>
    <div class="ci-auto-actions">${opportunities.map((item) => `<article class="is-${esc(item.tone)}"><span>${Number(item.impact || 0)} impact</span><h4>${esc(item.title)}</h4><p>${esc(item.detail)}</p><b>${esc(item.action)}</b></article>`).join("")}</div>
  </div>`;
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
function sourceLaneDrawer(scout) {
  return `<details class="ci-source-drawer"><summary>Source lanes Phantom is checking <span>${(scout.lanes || []).length}</span></summary><div class="ci-scout-lanes">${(scout.lanes || []).map(scoutLaneCard).join("")}</div></details>`;
}
function scoutPanel() {
  const scout = ui.snapshot.scout || {};
  const needs = scout.status === "needs_context";
  return `<section class="ci-scout ${needs ? "needs-context" : "is-ready"}"><div class="ci-scout-copy"><p class="ci-kicker">ON-DEMAND MARKET SCOUT</p><h2>${needs ? "Phantom has the starter map." : "Phantom is auto-scouting."}</h2><p>${esc(scout.briefing || "Public-source scouting is active.")}</p>${scout.missing?.length ? `<div class="ci-missing">${scout.missing.map((item) => `<span>${esc(item)}</span>`).join("")}</div>` : ""}</div>${needs ? `<div class="ci-scout-stack">${autoScoutReport()}${scoutForm()}${sourceLaneDrawer(scout)}</div>` : `${autoScoutReport()}${sourceLaneDrawer(scout)}`}</section>`;
}
function marketBoard() {
  const board = ui.snapshot.marketBoard || [];
  if (!board.length) return `<section class="ci-market-empty">${empty("Add the business map", ui.snapshot.scout?.status === "needs_context" ? "Fill in PhantomForce's offer, audience, and service area so Phantom can show the first competitor map." : "Use the scout map to track a competitor, then add public evidence for live rankings.", '<button class="ci-secondary" data-ci-tab="signals">Open sources</button>')}</section>`;
  return `<section class="ci-market-board">${board.map((item) => {
    const starter = item.sourceState === "starter";
    const trend = trendProfile(item);
    return `<article class="is-${esc(item.momentum)} ${starter ? "is-starter" : ""}" data-ci-card="${esc(item.competitorId)}"><header><span class="ci-symbol">${esc(item.symbol)}</span><div><p>${esc(item.category)} · ${esc(item.domain)}</p><h3>${esc(item.name)}</h3></div><b>${item.score}</b></header><div class="ci-ticker"><span>${starter ? "BASELINE" : momentumLabel(item.momentum)}</span><i style="width:${Math.max(6, Math.min(100, item.score))}%"></i></div>${sparkline(trend.points)}<dl><div><dt>1Y</dt><dd>${percent(trend.oneYear)}</dd></div><div><dt>5Y</dt><dd>${percent(trend.fiveYear)}</dd></div><div><dt>Proof</dt><dd>${esc(sourceStateLabel(item))}</dd></div></dl><p>${esc(item.tip)}</p><div class="ci-watch-tags">${item.watch.map((tag) => `<span>${esc(tag)}</span>`).join("")}</div>${starter ? `<button class="ci-primary" data-ci-track-starter="${esc(item.competitorId)}">Track + compare</button>` : item.signalCount ? `<button class="ci-secondary" data-ci-fuse="${esc(item.competitorId)}">Refresh estimate</button>` : `<button class="ci-secondary" data-ci-tab="signals">Add source</button>`}</article>`;
  }).join("")}</section>`;
}
function tipsPanel() {
  return `<section class="ci-tips"><div class="ci-section-head"><div><p class="ci-kicker">PHANTOM TIPS</p><h2>What to do next</h2></div></div><div>${(ui.snapshot.tips || []).map((item) => `<article class="is-${esc(item.tone)}"><span>${esc(item.tone)}</span><h3>${esc(item.title)}</h3><p>${esc(item.detail)}</p></article>`).join("")}</div></section>`;
}
function inferenceCard(item) {
  return `<article class="ci-inference"><header><div>${statusPill("ESTIMATE", "neutral")} ${statusPill(item.confidence.toUpperCase(), item.confidence === "high" ? "good" : item.confidence === "medium" ? "warn" : "neutral")}</div><time>${fmtDate(item.createdAt)}</time></header><p class="ci-overline">${esc(competitorName(item.competitorId))} · ${esc(item.area.replaceAll("_", " "))}</p><h3>${esc(item.estimate)}</h3><details><summary>Evidence and reasoning</summary><div class="ci-detail-grid"><div><h4>Supporting signals</h4><ul>${item.supportingSignals.map((signal) => `<li><a href="${esc(signal.source)}" target="_blank" rel="noopener noreferrer">${esc(signal.title)}</a><small>${fmtDate(signal.date)}</small></li>`).join("")}</ul></div><div><h4>Alternative explanations</h4><ul>${item.alternativeExplanations.map((text) => `<li>${esc(text)}</li>`).join("")}</ul></div><div><h4>Recommended verification</h4><ul>${item.recommendedVerification.map((text) => `<li>${esc(text)}</li>`).join("")}</ul></div><div><h4>Safe response options</h4><ul>${item.safeResponseOptions.map((text) => `<li>${esc(text)}</li>`).join("")}</ul></div></div></details><footer><span>Confidence score</span><div><i style="width:${Math.round(item.confidenceScore * 100)}%"></i></div><b>${Math.round(item.confidenceScore * 100)}%</b></footer></article>`;
}
function overview() {
  const latest = ui.snapshot.inferences.slice(0, 4);
  const starter = ui.snapshot.marketBoardMode === "starter";
  return `${modeCard()}${metrics()}${marketMap()}${scoutPanel()}<section class="ci-radar-grid"><div><div class="ci-section-head"><div><p class="ci-kicker">${starter ? "MARKET INDEX" : "MARKET BOARD"}</p><h2>${starter ? "Competitors Phantom should watch first" : "Competitors moving up, down, or going quiet"}</h2></div><button class="ci-secondary" data-ci-tab="signals">Open sources</button></div>${marketBoard()}</div>${tipsPanel()}</section><section class="ci-overview-grid"><div><div class="ci-section-head"><div><p class="ci-kicker">LATEST ESTIMATES</p><h2>${latest.length ? "What may be changing" : "Live estimates need public evidence"}</h2></div></div><div class="ci-inference-list">${latest.length ? latest.map(inferenceCard).join("") : empty("No live estimates yet", "Starter competitors are modeled baselines. Track a competitor and add public signals before Phantom labels confirmed movement.", '<button class="ci-primary" data-ci-tab="signals">Add public source</button>')}</div></div><aside class="ci-boundaries"><p class="ci-kicker">HARD BOUNDARIES</p><h2>Win sooner. Stay clean.</h2><p>Aggressive mode changes speed and synthesis, not access rights.</p><ul><li>Public and lawfully supplied evidence only</li><li>No identities, private groups, bypasses, or deception</li><li>No invasive targeting of individual commenters</li><li>No cloning protected expression</li><li>No outreach, publishing, or operational interference</li></ul><button class="ci-secondary" data-ci-tab="evidence">Open audit log</button></aside></section>`;
}

function signals() {
  const filtered = ui.snapshot.signals.filter((item) => (ui.competitorFilter === "all" || item.competitorId === ui.competitorFilter) && (!ui.signalQuery || `${item.title} ${item.summary}`.toLowerCase().includes(ui.signalQuery.toLowerCase())));
  const starterStrip = (ui.snapshot.starterCompetitors || []).slice(0, 8).map((item) => `<article class="is-starter"><div><h3>${esc(item.name)}</h3><a href="${esc(item.website)}" target="_blank" rel="noopener noreferrer">${esc(new URL(item.website).hostname)}</a><small>${esc(item.category)}</small></div><button class="ci-primary" data-ci-track-starter="${esc(item.id)}">Track</button></article>`).join("");
  return `<section class="ci-two-col"><div><details class="ci-builder" open><summary>Add a competitor</summary><form data-ci-competitor-form><label>Name<input name="name" maxlength="120" required></label><label>Public website<input name="website" type="url" placeholder="https://…" required></label><label>Category<input name="category" maxlength="100" placeholder="Local service, SaaS, retail…"></label><label>Notes<textarea name="notes" rows="3" maxlength="1000" placeholder="What makes this competitor relevant?"></textarea></label><button class="ci-primary" type="submit">Add competitor</button></form></details><details class="ci-builder" ${ui.snapshot.competitors.length ? "open" : ""}><summary>Add a public signal</summary><form data-ci-signal-form><label>Competitor<select name="competitorId" required>${competitorOptions()}</select></label><label>Signal type<select name="type" required>${Object.entries(SIGNAL_LABELS).map(([value, label]) => `<option value="${value}">${esc(label)}</option>`).join("")}</select></label><label>What changed?<input name="title" maxlength="180" required></label><label>Evidence summary<textarea name="summary" rows="4" maxlength="1500" required></textarea></label><label>Public source URL<input name="sourceUrl" type="url" placeholder="https://…" required></label><div class="ci-form-row"><label>Source label<input name="sourceLabel" maxlength="160"></label><label>Observed date<input name="observedAt" type="date" value="${new Date().toISOString().slice(0, 10)}" required></label></div><label class="ci-check"><input name="publicAccessConfirmed" type="checkbox" required> I confirm this is public and lawfully accessible.</label><button class="ci-primary" type="submit">Record signal</button></form></details></div><div><div class="ci-section-head"><div><p class="ci-kicker">EVIDENCE STREAM</p><h2>${ui.snapshot.signals.length} public signals</h2></div><div class="ci-tools"><input data-ci-signal-search type="search" value="${esc(ui.signalQuery)}" placeholder="Search evidence"><select data-ci-competitor-filter>${competitorOptions(true)}</select></div></div><div class="ci-competitor-strip">${ui.snapshot.competitors.map((item) => `<article><div><h3>${esc(item.name)}</h3><a href="${esc(item.website)}" target="_blank" rel="noopener noreferrer">${esc(new URL(item.website).hostname)}</a></div><button class="ci-primary" data-ci-fuse="${esc(item.id)}">Fuse signals</button></article>`).join("") || starterStrip || empty("No competitors", "Track a starter competitor or add one manually.")}</div><div class="ci-signal-list">${filtered.map((item) => `<article><span>${esc(SIGNAL_LABELS[item.type] || item.type)}</span><div><h3>${esc(item.title)}</h3><p>${esc(item.summary)}</p><small>${esc(competitorName(item.competitorId))} · ${fmtDate(item.observedAt)} · <a href="${esc(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(item.sourceLabel)}</a></small></div></article>`).join("") || empty("No matching signals", "Change the filters or add a dated public signal.")}</div></div></section>`;
}

function opportunities() {
  return `<section class="ci-two-col"><div><details class="ci-builder" open><summary>Mine an audience gap</summary><form data-ci-gap-form><label>Competitor<select name="competitorId" required>${competitorOptions()}</select></label><label>Theme type<select name="category">${GAP_TYPES.map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></label><label>Aggregated theme<textarea name="theme" rows="4" maxlength="700" placeholder="Several recent reviews ask…" required></textarea></label><label>Approximate occurrences<input name="volume" type="number" min="1" value="1" required></label><label>Public source URLs<textarea name="sourceUrls" rows="3" placeholder="One HTTPS URL per line" required></textarea></label><label class="ci-check"><input name="aggregated" type="checkbox" required> This is an aggregated theme, not an individual profile.</label><button class="ci-primary">Create opportunities</button></form></details><details class="ci-builder"><summary>Search, offer, or timing opportunity</summary><form data-ci-opportunity-form><label>Competitor<select name="competitorId" required>${competitorOptions()}</select></label><label>Opportunity<select name="kind"><option value="search">Search demand</option><option value="offer">Offer packaging</option><option value="timing">Launch timing</option></select></label><label>Title<input name="title" maxlength="200" required></label><label>Public evidence or pattern<textarea name="insight" rows="4" maxlength="1500" required></textarea></label><label>Source URL<input name="sourceUrl" type="url" required></label><button class="ci-primary">Build response options</button></form></details></div><div><div class="ci-section-head"><div><p class="ci-kicker">AUDIENCE DEMAND</p><h2>Original ways to serve the gap</h2></div></div><div class="ci-card-list">${ui.snapshot.audienceThemes.map((item) => `<article><header>${statusPill(item.category.toUpperCase(), "good")}<span>${item.volume} observations</span></header><h3>${esc(item.theme)}</h3><ul>${item.opportunities.map((text) => `<li>${esc(text)}</li>`).join("")}</ul><small>${esc(competitorName(item.competitorId))} · ${fmtDate(item.createdAt)}</small></article>`).join("") || empty("No audience gaps yet", "Aggregate public questions, complaints, objections, and trust concerns without profiling individuals.")}<div class="ci-section-head compact"><div><p class="ci-kicker">MARKET OPPORTUNITIES</p><h2>Search, offer, and timing</h2></div></div>${ui.snapshot.opportunities.map((item) => `<article><header>${statusPill(item.kind.toUpperCase(), "neutral")}<a href="${esc(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">Source ↗</a></header><h3>${esc(item.title)}</h3><p>${esc(item.insight)}</p><ul>${item.recommendations.map((text) => `<li>${esc(text)}</li>`).join("")}</ul></article>`).join("") || empty("No market opportunities yet", "Turn a public search pattern, package, or timing signal into bounded original options.")}</div></div></section>`;
}

function creative() {
  const latest = ui.snapshot.creativeAnalyses;
  return `<section class="ci-two-col"><details class="ci-builder" open><summary>Reverse-engineer the strategy</summary><form data-ci-creative-form><label>Competitor<select name="competitorId" required>${competitorOptions()}</select></label><label>Public source URL<input name="sourceUrl" type="url" required></label><div class="ci-form-row"><label>Hook category<input name="hookCategory" placeholder="Problem, proof, surprise…"></label><label>Emotional trigger<input name="emotionalTrigger" placeholder="Relief, ambition, urgency…"></label></div><label>Abstract source strategy<textarea name="sourceAbstract" rows="4" maxlength="2000" placeholder="Describe strategy, not copied wording." required></textarea></label><div class="ci-form-grid"><label>Story structure<input name="storyStructure"></label><label>Proof mechanism<input name="proofMechanism"></label><label>Pacing<input name="pacing"></label><label>Content density<input name="contentDensity"></label><label>Visual rhythm<input name="visualRhythm"></label><label>Shot distribution<input name="shotDistribution"></label><label>CTA structure<input name="ctaStructure"></label><label>Audience sophistication<input name="audienceSophistication"></label><label>Objection addressed<input name="objectionAddressed"></label><label>Desired action<input name="desiredAction"></label></div><label>Your substantially original response<textarea name="originalResponse" rows="5" maxlength="3000" required></textarea></label><button class="ci-primary">Analyze originality risk</button></form></details><div><div class="ci-section-head"><div><p class="ci-kicker">ORIGINALITY CHECK</p><h2>Learn the pattern. Never clone the expression.</h2></div></div><div class="ci-card-list">${latest.map((item) => `<article class="ci-creative-card is-${item.similarityRisk}"><header>${statusPill(`${item.similarityRisk.toUpperCase()} SIMILARITY RISK`, item.similarityRisk === "high" ? "hot" : item.similarityRisk === "medium" ? "warn" : "good")}<b>${item.similarityScore}% lexical overlap</b></header><h3>${esc(item.hookCategory || "Creative strategy")}</h3><p>${esc(item.originalResponse)}</p><ul>${item.similarityWarnings.map((text) => `<li>${esc(text)}</li>`).join("")}</ul><details><summary>Abstract attributes</summary><dl><dt>Trigger</dt><dd>${esc(item.emotionalTrigger || "Not entered")}</dd><dt>Structure</dt><dd>${esc(item.storyStructure || "Not entered")}</dd><dt>Proof</dt><dd>${esc(item.proofMechanism || "Not entered")}</dd><dt>CTA</dt><dd>${esc(item.ctaStructure || "Not entered")}</dd></dl></details></article>`).join("") || empty("No creative analyses", "Describe a public strategy abstractly and test an original response for similarity risk.")}</div></div></section>`;
}

function intercept() {
  return `<section class="ci-two-col"><details class="ci-builder" open><summary>Prepare a rapid response package</summary><form data-ci-intercept-form><label>Competitor<select name="competitorId" required>${competitorOptions()}</select></label><label>Public event<select name="eventType">${EVENT_TYPES.map((item) => `<option>${item}</option>`).join("")}</select></label><label>Event summary<textarea name="eventSummary" rows="3" maxlength="1200" required></textarea></label><label>Supporting evidence<textarea name="evidence" rows="3" maxlength="1600" required></textarea></label><label>Public source URL<input name="sourceUrl" type="url" required></label><div class="ci-form-row"><label>Event date<input name="eventDate" type="date" value="${new Date().toISOString().slice(0, 10)}"></label><label>Response deadline<input name="responseDeadline" placeholder="Within 48 hours"></label></div><label>Why it matters<textarea name="whyItMatters" rows="2"></textarea></label><label>Original positioning angle<textarea name="positioningAngle" rows="2"></textarea></label><label>Original content brief<textarea name="contentBrief" rows="3"></textarea></label><label>Landing-page direction<textarea name="landingPageDraft" rows="3"></textarea></label><label>Deliverable offer option<textarea name="offerOption" rows="2"></textarea></label><button class="ci-primary">Build bounded response</button></form></details><div><div class="ci-section-head"><div><p class="ci-kicker">MARKET INTERCEPTION</p><h2>Move fast without making things up.</h2></div></div><div class="ci-card-list">${ui.snapshot.interceptions.map((item) => `<article class="ci-intercept-card"><header>${statusPill(item.eventType.toUpperCase(), "hot")}<time>${fmtDate(item.eventDate)}</time></header><h3>${esc(item.eventSummary)}</h3><p>${esc(item.whyItMatters)}</p><details open><summary>Response package</summary><h4>Original positioning</h4><p>${esc(item.positioningAngle || "Use a distinct, customer-centered angle.")}</p><h4>Content brief</h4><p>${esc(item.contentBrief)}</p><h4>Landing page</h4><pre>${esc(item.landingPageDraft)}</pre><h4>Offer</h4><p>${esc(item.offerOption)}</p><div class="ci-detail-grid"><div><h4>Sales points</h4><ul>${item.salesTalkingPoints.map((text) => `<li>${esc(text)}</li>`).join("")}</ul></div><div><h4>Search content</h4><ul>${item.searchContent.map((text) => `<li>${esc(text)}</li>`).join("")}</ul></div><div><h4>Risks</h4><ul>${item.risks.map((text) => `<li>${esc(text)}</li>`).join("")}</ul></div><div><h4>Approvals</h4><ul>${item.requiredApprovals.map((text) => `<li>${esc(text)}</li>`).join("")}</ul></div></div></details></article>`).join("") || empty("No response packages", "Use a verified public market event to prepare an original, approval-ready response.")}</div></div></section>`;
}

function evidence() {
  return `<section class="ci-two-col"><div><details class="ci-builder" open><summary>Add authorized customer-experience evidence</summary><form data-ci-evidence-form><label>Competitor<select name="competitorId" required>${competitorOptions()}</select></label><label>Evidence type<select name="evidenceType"><option>Quote</option><option>Demo notes</option><option>Public sales material</option><option>Pricing proposal</option><option>Onboarding observation</option><option>Support experience</option><option>Product screenshot</option><option>Terms or policy</option></select></label><label>Title<input name="title" maxlength="180" required></label><label>Observations<textarea name="observations" rows="5" maxlength="3000" required></textarea></label><label>Source reference<input name="sourceReference" maxlength="1000" placeholder="Document name, public URL, or authorized context"></label><label>Obtained date<input name="acquiredAt" type="date" value="${new Date().toISOString().slice(0, 10)}"></label><label class="ci-check"><input name="legitimatelyObtained" type="checkbox" required> I legitimately obtained and may analyze this material.</label><label class="ci-check"><input name="noDeceptionConfirmed" type="checkbox" required> No false identity, pretext, restricted recording, eligibility bypass, or confidentiality breach was used.</label><button class="ci-primary">Save evidence</button></form></details><details class="ci-builder"><summary>Check a planned research action</summary><form data-ci-policy-form><label>Describe the planned action<textarea name="action" rows="4" maxlength="3000" required></textarea></label><button class="ci-primary">Check boundary</button></form></details></div><div><div class="ci-section-head"><div><p class="ci-kicker">AUTHORIZED MATERIAL</p><h2>Customer-experience evidence</h2></div></div><div class="ci-card-list">${ui.snapshot.mysteryEvidence.map((item) => `<article><header>${statusPill(item.evidenceType.toUpperCase(), "neutral")}<time>${fmtDate(item.acquiredAt)}</time></header><h3>${esc(item.title)}</h3><p>${esc(item.observations)}</p><small>${esc(competitorName(item.competitorId))} · lawful-use attestation recorded</small></article>`).join("") || empty("No uploaded observations", "Add only material you legitimately obtained without deception or confidentiality violations.")}<div class="ci-section-head compact"><div><p class="ci-kicker">ADMIN AUDIT</p><h2>Allowed and blocked actions</h2></div></div><div class="ci-audit">${ui.snapshot.audit.map((item) => `<article class="is-${item.result}"><span>${item.result === "blocked" ? "×" : "✓"}</span><div><h3>${esc(item.action.replaceAll("_", " "))}</h3><p>${esc(item.reason)}</p>${item.alternative ? `<small>Safe alternative: ${esc(item.alternative)}</small>` : ""}</div><time>${ago(item.createdAt)}</time></article>`).join("") || empty("Audit log is clear", "Mode changes, evidence intake, generated analyses, and blocked requests will appear here.")}</div></div></section>`;
}

function content() {
  if (ui.loading) return `<div class="ci-loading"><i></i><i></i><i></i><p>Loading public-signal intelligence…</p></div>`;
  if (!ui.snapshot) return empty("Intelligence is unavailable", ui.error || "The protected service did not respond.", '<button class="ci-primary" data-ci-retry>Try again</button>');
  if (!ui.snapshot.access.enabled) return empty("Competitor Intelligence is not included", "Ask the workspace owner about a plan with public-signal intelligence.");
  return ({ overview, signals, opportunities, creative, intercept, evidence }[ui.tab] || overview)();
}
function render() {
  if (!root) return;
  root.innerHTML = `<div class="ci-shell"><header class="ci-hero"><div><p class="ci-kicker">COMPETITOR & MARKET INTELLIGENCE</p><h1>Competitor Intel</h1><p>Start with PhantomForce's competitor map, then add public evidence for live movement, buyer pressure, and safe response ideas.</p></div>${ui.snapshot ? `<div class="ci-hero-status"><span></span><div><small>SCOUT</small><b>${esc(scoutStatusLabel(ui.snapshot.scout?.status || "offline"))}</b></div></div>` : ""}</header>${message()}${ui.snapshot?.access.enabled ? `<nav class="ci-tabs" aria-label="Competitor Intelligence sections">${TABS.map(([id, label]) => `<button type="button" class="${ui.tab === id ? "is-active" : ""}" data-ci-tab="${id}">${label}</button>`).join("")}</nav>` : ""}<main>${content()}</main></div>`;
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
  root.querySelector("[data-ci-retry]")?.addEventListener("click", () => refresh());
  root.querySelector("[data-ci-mode]")?.addEventListener("click", () => run("/api/competitor-intelligence/mode", { enabled: !ui.snapshot.settings.aggressiveMode }, ui.snapshot.settings.aggressiveMode ? "Standard mode restored." : "Aggressive Intelligence Mode activated."));
  root.querySelectorAll("[data-ci-fuse]").forEach((button) => button.addEventListener("click", () => run("/api/competitor-intelligence/fuse", { competitorId: button.dataset.ciFuse }, "Public signals fused into labeled estimates.")));
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
  root = target; opts = options; ui.tab = "overview"; refresh();
}
