/* Organization Brain Graph — a force-directed map of every entity the brain
   can see for the current tenant (/api/organization/graph). Canvas layout is
   simulated locally (repulsion + edge springs + centering), settles after a
   fixed tick budget, and never animates continuously once settled. Honors
   prefers-reduced-motion and body.freeze by drawing the settled layout
   instantly. No fabricated data: gaps and disconnection reasons come straight
   from the server payload. */
import { currentTenantId, session } from "./store.js?v=phantom-live-20260721-26";

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
));

/* Validated on #030208 (dataviz six-checks): chroma + contrast PASS, worst
   adjacent CVD pair 9.5 ΔE — floor band, legal because every node carries a
   direct text label and the legend/details panel restate identity in text.
   "system" is deliberately neutral slate: infrastructure, not identity. */
const TYPE_COLORS = {
  organization: "#6649f7",
  "business-profile": "#5a2fd0",
  website: "#3b82f6",
  asset: "#9ac232",
  competitor: "#ff7a8f",
  signal: "#ffab5e",
  approval: "#ffd166",
  insight: "#e04fd0",
  dossier: "#ff8fd2",
  memory: "#c4a5ff",
  "brain-event": "#6c3ac9",
  "agent-run": "#9f74f7",
  system: "#a994c4",
};
const FALLBACK_COLOR = "#a994c4";
const AMBER = "#ffd166";
const nodeColor = (type) => TYPE_COLORS[type] || FALLBACK_COLOR;
const nodeRadius = (node) => (node.type === "organization" ? 24
  : node.type === "business-profile" ? 15
  : node.type === "competitor" || node.type === "website" ? 12
  : 10);
const truncate = (text, max = 18) => {
  const value = String(text || "");
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};

/* Per-tenant cache so brain.js re-renders (memory filter, preview, feedback)
   reuse the fetched graph and settled positions instead of refetching and
   re-simulating every time. Refresh always bypasses it. */
const CACHE_TTL_MS = 45_000;
const cache = new Map(); // tenantId -> { graph, positions, at }

function authHeaders() {
  const token = session.token();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchGraph(tenant) {
  const response = await fetch(`/api/organization/graph?tenant_id=${encodeURIComponent(tenant)}`, {
    headers: authHeaders(),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok || !data.graph) {
    throw new Error(data?.error?.message || data?.error || `Graph request failed (${response.status})`);
  }
  return data.graph;
}

/* Opportunities the graph analysis recommends acting on. Same auth + per-tenant
   cache pattern as the graph itself; Refresh bypasses both caches. */
const oppCache = new Map(); // tenantId -> { opportunities, at }

async function fetchOpportunities(tenant) {
  const response = await fetch(`/api/organization/opportunities?tenant_id=${encodeURIComponent(tenant)}`, {
    headers: authHeaders(),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok || !Array.isArray(data.opportunities)) {
    throw new Error(data?.error?.message || data?.error || `Opportunities request failed (${response.status})`);
  }
  return data.opportunities;
}

/* ---------------- force simulation (~settled in TOTAL_TICKS) ---------------- */
const TOTAL_TICKS = 300;
const REPULSION = 5200;
const SPRING_K = 0.035;
const SPRING_REST = 92;
const CENTER_PULL = 0.012;
const DAMPING = 0.82;

function buildSim(graph) {
  const nodes = graph.nodes.map((raw, index) => {
    const angle = (index / Math.max(1, graph.nodes.length - 1)) * Math.PI * 2;
    const ring = 120 + (index % 5) * 34;
    return {
      ...raw,
      r: nodeRadius(raw),
      x: raw.type === "organization" ? 0 : Math.cos(angle) * ring,
      y: raw.type === "organization" ? 0 : Math.sin(angle) * ring,
      vx: 0, vy: 0,
      pinned: raw.type === "organization", // organization stays center-pinned
    };
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const edges = graph.edges
    .map((edge) => ({ ...edge, a: byId.get(edge.from), b: byId.get(edge.to) }))
    .filter((edge) => edge.a && edge.b);
  return { nodes, edges, byId };
}

function simTick(sim) {
  const { nodes, edges } = sim;
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i]; const b = nodes[j];
      let dx = a.x - b.x; let dy = a.y - b.y;
      let d2 = dx * dx + dy * dy;
      if (d2 < 1) { dx = (Math.random() - 0.5); dy = (Math.random() - 0.5); d2 = 1; }
      const force = Math.min(REPULSION / d2, 18);
      const d = Math.sqrt(d2);
      const fx = (dx / d) * force; const fy = (dy / d) * force;
      a.vx += fx; a.vy += fy;
      b.vx -= fx; b.vy -= fy;
    }
  }
  for (const edge of edges) {
    const { a, b } = edge;
    const dx = b.x - a.x; const dy = b.y - a.y;
    const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    const rest = SPRING_REST + a.r + b.r;
    const pull = (d - rest) * SPRING_K;
    const fx = (dx / d) * pull; const fy = (dy / d) * pull;
    a.vx += fx; a.vy += fy;
    b.vx -= fx; b.vy -= fy;
  }
  for (const node of nodes) {
    if (node.pinned || node.dragging) { node.vx = 0; node.vy = 0; continue; }
    node.vx = (node.vx - node.x * CENTER_PULL) * DAMPING;
    node.vy = (node.vy - node.y * CENTER_PULL) * DAMPING;
    node.x += node.vx;
    node.y += node.vy;
  }
}

/* ---------------- rendering ---------------- */
function legendHtml(nodes) {
  const seen = [...new Set(nodes.map((node) => node.type))];
  return seen.map((type) => `<span><i style="background:${nodeColor(type)}"></i>${esc(type.replace(/-/g, " "))}</span>`).join("");
}

function detailsHtml(node) {
  if (!node) {
    return `<p class="og-kicker">Details</p>
      <p class="og-empty-hint">Click any node to inspect it — its type, the data source backing it, its state, and why it is disconnected (if it is). Drag nodes to untangle the map.</p>`;
  }
  const color = nodeColor(node.type);
  return `
    <p class="og-kicker">Details</p>
    <h4>${esc(node.label)}</h4>
    <span class="og-type-pill" style="color:${color};border-color:${color}55;background:${color}14"><i style="background:${color}"></i>${esc(node.type.replace(/-/g, " "))}</span>
    <div class="og-detail-row"><span>Backed by</span><b>${esc(node.source || "unknown")}</b></div>
    ${node.state ? `<div class="og-detail-row"><span>State</span><b>${esc(node.state)}</b></div>` : ""}
    ${node.disconnected ? `<div class="og-detail-row is-gap"><span>Disconnected</span><b>${esc(node.reason || "No connection recorded.")}</b></div>` : ""}`;
}

function gapsHtml(graph) {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const gaps = graph.gaps || [];
  if (!gaps.length) return `<p class="og-gaps-clear">No disconnected entities detected right now.</p>`;
  return `<div class="og-gap-list">${gaps.map((gap) => {
    const node = byId.get(gap.nodeId);
    return `<div class="og-gap-row"><b>${esc(node?.label || gap.nodeId)}</b><span>${esc(gap.reason)}</span></div>`;
  }).join("")}</div>`;
}

/* Action buttons carry data-open-ws: main.js's document-level click delegate
   (the same pathway the notification bell items use) routes them through
   routeWorkspace(). No import needed — the delegate listens on document. */
function opportunitiesHtml(opps) {
  if (!opps.length) return `<p class="og-gaps-clear">No opportunities detected — the graph has nothing urgent.</p>`;
  return `<div class="og-opp-list">${opps.map((opp, index) => `
    <div class="og-opp-row" data-og-opp-row data-opp-node="${esc(opp.provenance?.nodeId || "")}">
      <button class="og-opp-main" type="button" data-og-opp-toggle aria-expanded="false" aria-controls="og-opp-why-${index}">
        <span class="og-opp-impact is-${esc(opp.impact)}">${esc(opp.impact)}</span>
        <span class="og-opp-title">${esc(opp.title)}</span>
        <span class="og-opp-caret" aria-hidden="true">▾</span>
      </button>
      <div class="og-opp-why" id="og-opp-why-${index}" hidden>
        <p>${esc(opp.why)}</p>
        <p class="og-opp-src">Backed by: ${esc(opp.provenance?.source || "unknown")}</p>
      </div>
      <button class="og-opp-action" type="button" data-open-ws="${esc(opp.action?.route || "")}">${esc(opp.action?.label || "Open")}</button>
    </div>`).join("")}</div>`;
}

function shellHtml(tenant) {
  return `
    <div class="og-shell">
      <div class="og-head">
        <div>
          <p class="og-kicker">Live entity map · ${esc(tenant)}</p>
          <p class="og-sub">Every entity this workspace has actually recorded, and how it connects back to the organization. Nothing here is invented — each node names its backing data source.</p>
        </div>
        <button class="og-refresh" type="button" data-og-refresh>Refresh</button>
      </div>
      <div data-og-stage></div>
      <section class="og-gaps" data-og-gaps hidden>
        <p class="og-kicker">Gaps — what's disconnected and why</p>
        <div data-og-gaps-body></div>
      </section>
      <section class="og-opps" data-og-opps>
        <p class="og-kicker">Opportunities — what the graph recommends</p>
        <div data-og-opps-body></div>
      </section>
    </div>`;
}

function instantSettle() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
    || document.body.classList.contains("freeze");
}

function mountCanvas(stage, graph, cached) {
  stage.innerHTML = `
    <div class="og-controls">
      <input class="og-search" type="search" placeholder="Search nodes…" aria-label="Search graph nodes by label" data-og-search />
      <div class="og-chips" role="group" aria-label="Filter nodes by type" data-og-chips></div>
    </div>
    <div class="og-body">
      <div class="og-canvas-wrap">
        <canvas aria-label="Organization graph: ${graph.nodes.length} entities, ${graph.edges.length} connections"></canvas>
        <div class="og-legend"></div>
      </div>
      <aside class="og-details" data-og-details></aside>
    </div>`;
  const canvas = stage.querySelector("canvas");
  const detailsEl = stage.querySelector("[data-og-details]");
  stage.querySelector(".og-legend").innerHTML = legendHtml(graph.nodes);
  detailsEl.innerHTML = detailsHtml(null);

  /* Search + type filters affect rendering only — never the fetched data.
     Empty type set means "all types". A node passes when it matches the label
     (or type-name) substring AND its type is enabled. */
  const filter = { q: "", types: new Set() };
  const filterActive = () => !!filter.q || filter.types.size > 0;
  const passesFilter = (node) => {
    if (filter.types.size && !filter.types.has(node.type)) return false;
    if (!filter.q) return true;
    return String(node.label || "").toLowerCase().includes(filter.q)
      || String(node.type || "").toLowerCase().includes(filter.q);
  };

  const sim = buildSim(graph);
  if (cached?.positions) {
    for (const node of sim.nodes) {
      const pos = cached.positions.get(node.id);
      if (pos) { node.x = pos.x; node.y = pos.y; }
    }
  }
  const ctx = canvas.getContext("2d");
  const view = { scale: 1, tx: 0, ty: 0, settled: !!cached?.positions };
  let hovered = null;
  let selected = null;

  function sizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return rect;
  }

  function fitView() {
    const rect = canvas.getBoundingClientRect();
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    for (const node of sim.nodes) {
      // widen the box by an approximate label overhang so edge labels stay visible
      const lx = Math.max(node.r, 34);
      minX = Math.min(minX, node.x - lx); maxX = Math.max(maxX, node.x + lx);
      minY = Math.min(minY, node.y - node.r); maxY = Math.max(maxY, node.y + node.r + 16);
    }
    const pad = 52;
    const w = Math.max(60, maxX - minX); const h = Math.max(60, maxY - minY);
    view.scale = Math.min((rect.width - pad) / w, (rect.height - pad) / h, 1.5);
    view.tx = rect.width / 2 - ((minX + maxX) / 2) * view.scale;
    view.ty = rect.height / 2 - ((minY + maxY) / 2) * view.scale;
  }

  const toScreen = (node) => ({ x: node.x * view.scale + view.tx, y: node.y * view.scale + view.ty });
  const toWorld = (sx, sy) => ({ x: (sx - view.tx) / view.scale, y: (sy - view.ty) / view.scale });

  function draw() {
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    const active = hovered || selected;
    const filtering = filterActive();
    for (const edge of sim.edges) {
      const a = toScreen(edge.a); const b = toScreen(edge.b);
      const lit = active && (edge.a === active || edge.b === active);
      const faded = filtering && (!passesFilter(edge.a) || !passesFilter(edge.b));
      ctx.strokeStyle = faded ? "rgba(102,73,247,.05)"
        : lit ? "rgba(102,73,247,.85)" : active ? "rgba(102,73,247,.10)" : "rgba(102,73,247,.26)";
      ctx.lineWidth = lit ? 1.8 : 1;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const node of sim.nodes) {
      const p = toScreen(node);
      const r = Math.max(4, node.r * view.scale);
      const passes = passesFilter(node);
      const isActive = node === hovered || node === selected;
      const dimmed = active && !isActive;
      ctx.globalAlpha = filtering && !passes ? 0.15 : dimmed ? 0.35 : 1;
      if (isActive) { ctx.shadowColor = nodeColor(node.type); ctx.shadowBlur = 14; }
      ctx.fillStyle = nodeColor(node.type);
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      if (node === selected) {
        ctx.strokeStyle = "#2b2649"; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(p.x, p.y, r + 2.5, 0, Math.PI * 2); ctx.stroke();
      }
      if (node.disconnected) {
        ctx.strokeStyle = AMBER; ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.arc(p.x, p.y, r + 4.5, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.font = node.type === "organization" ? '700 11px "Spline Sans Mono", monospace' : '10px "Spline Sans Mono", monospace';
      /* While filtering, matching nodes keep their labels at full brightness. */
      ctx.fillStyle = filtering && !passes ? "rgba(149,143,181,.4)"
        : isActive || filtering ? "#2b2649" : dimmed ? "rgba(149,143,181,.5)" : "#958fb5";
      ctx.fillText(truncate(node.label), p.x, p.y + r + (node.disconnected ? 8 : 5));
      ctx.globalAlpha = 1;
    }
  }

  function settleInstantly() {
    for (let i = 0; i < TOTAL_TICKS; i += 1) simTick(sim);
    view.settled = true;
    fitView(); draw();
  }

  sizeCanvas();
  if (view.settled) { fitView(); draw(); }
  else if (instantSettle()) settleInstantly();
  else {
    let ticks = 0;
    const step = () => {
      if (!canvas.isConnected) return;
      for (let i = 0; i < 8 && ticks < TOTAL_TICKS; i += 1, ticks += 1) simTick(sim);
      fitView(); draw();
      if (ticks < TOTAL_TICKS) requestAnimationFrame(step);
      else view.settled = true; // stop: no continuous animation once settled
    };
    requestAnimationFrame(step);
  }

  const hitTest = (sx, sy) => {
    for (let i = sim.nodes.length - 1; i >= 0; i -= 1) {
      const node = sim.nodes[i];
      if (filterActive() && !passesFilter(node)) continue; // faded nodes aren't clickable
      const p = toScreen(node);
      const r = Math.max(10, node.r * view.scale) + 4;
      if ((sx - p.x) ** 2 + (sy - p.y) ** 2 <= r * r) return node;
    }
    return null;
  };
  const pointerPos = (event) => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  function selectNode(node) {
    selected = node;
    detailsEl.innerHTML = detailsHtml(node);
    if (view.settled) draw();
  }

  let dragNode = null;
  let dragMoved = false;
  canvas.addEventListener("pointerdown", (event) => {
    const { x, y } = pointerPos(event);
    const hit = hitTest(x, y);
    if (!hit) return;
    dragNode = hit; dragMoved = false;
    hit.dragging = true;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    const { x, y } = pointerPos(event);
    if (dragNode) {
      const world = toWorld(x, y);
      dragNode.x = world.x; dragNode.y = world.y;
      dragNode.vx = 0; dragNode.vy = 0;
      dragMoved = true;
      // Live neighbor springs: relax the rest of the graph around the drag
      // without refitting the view (the map must not slide under the cursor).
      simTick(sim); simTick(sim);
      draw();
      return;
    }
    const hit = hitTest(x, y);
    if (hit !== hovered) {
      hovered = hit;
      canvas.style.cursor = hit ? "pointer" : "default";
      if (view.settled) draw();
    }
  });
  const endDrag = (event) => {
    if (!dragNode) return;
    dragNode.dragging = false;
    if (!dragMoved) selectNode(dragNode); // treated as a click
    dragNode = null;
    try { canvas.releasePointerCapture(event.pointerId); } catch { /* already released */ }
    draw();
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("pointerleave", () => {
    if (dragNode) return;
    if (hovered) { hovered = null; canvas.style.cursor = "default"; if (view.settled) draw(); }
  });

  const onResize = () => {
    if (!canvas.isConnected) { window.removeEventListener("resize", onResize); return; }
    sizeCanvas(); fitView(); draw();
  };
  window.addEventListener("resize", onResize);

  /* Search input + type chips (real <input> / <button aria-pressed> so both
     are keyboard accessible). "All" clears the multi-select. */
  const searchEl = stage.querySelector("[data-og-search]");
  const chipsEl = stage.querySelector("[data-og-chips]");
  const typesPresent = [...new Set(sim.nodes.map((node) => node.type))];
  chipsEl.innerHTML = [`<button class="og-chip" type="button" data-og-type="" aria-pressed="true">All</button>`]
    .concat(typesPresent.map((type) => `<button class="og-chip" type="button" data-og-type="${esc(type)}" aria-pressed="false"><i style="background:${nodeColor(type)}"></i>${esc(type.replace(/-/g, " "))}</button>`))
    .join("");
  searchEl.addEventListener("input", () => {
    filter.q = searchEl.value.trim().toLowerCase();
    draw();
  });
  chipsEl.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-og-type]");
    if (!chip) return;
    const type = chip.dataset.ogType;
    if (!type) filter.types.clear();
    else if (filter.types.has(type)) filter.types.delete(type);
    else filter.types.add(type);
    for (const el of chipsEl.querySelectorAll("[data-og-type]")) {
      el.setAttribute("aria-pressed", String(el.dataset.ogType ? filter.types.has(el.dataset.ogType) : filter.types.size === 0));
    }
    draw();
  });

  return {
    sim,
    selectNode: (id) => {
      const node = sim.byId.get(id);
      if (node) selectNode(node);
      return !!node;
    },
    positions: () => new Map(sim.nodes.map((node) => [node.id, { x: node.x, y: node.y }])),
    visibleNodeIds: () => sim.nodes.filter((node) => passesFilter(node)).map((node) => node.id),
  };
}

export function renderOrganizationGraph(target, opts = {}) {
  if (!target) return;
  const tenant = currentTenantId();
  target.innerHTML = shellHtml(tenant);
  const stage = target.querySelector("[data-og-stage]");
  const gapsSection = target.querySelector("[data-og-gaps]");
  const gapsBody = target.querySelector("[data-og-gaps-body]");
  const oppsBody = target.querySelector("[data-og-opps-body]");
  const refreshBtn = target.querySelector("[data-og-refresh]");
  let graphInstance = null; // set once the canvas mounts; used for node highlight

  async function load(force = false) {
    const hit = cache.get(tenant);
    const fresh = hit && Date.now() - hit.at < CACHE_TTL_MS;
    if (!fresh || force) {
      stage.innerHTML = `<div class="og-status"><div class="og-loading-dots"><i></i><i></i><i></i></div><p>Reading the organization graph…</p></div>`;
      gapsSection.hidden = true;
      refreshBtn.disabled = true;
      try {
        const graph = await fetchGraph(tenant);
        cache.set(tenant, { graph, positions: null, at: Date.now() });
      } catch (error) {
        refreshBtn.disabled = false;
        if (!stage.isConnected) return;
        stage.innerHTML = `
          <div class="og-status is-error">
            <h4>Couldn't load the organization graph</h4>
            <p>${esc(error?.message || "The graph endpoint did not respond.")}</p>
            <button class="og-refresh" type="button" data-og-retry>Retry</button>
          </div>`;
        stage.querySelector("[data-og-retry]")?.addEventListener("click", () => load(true));
        return;
      }
      refreshBtn.disabled = false;
    }
    if (!stage.isConnected) return;
    const entry = cache.get(tenant);
    const graph = entry.graph;

    if ((graph.nodes || []).length <= 1) {
      stage.innerHTML = `
        <div class="og-status">
          <h4>The graph is still just your organization</h4>
          <p>This map grows as the workspace records real entities — competitors you track, memories the brain stores, agent runs, assets, and websites. Do work here and the graph fills in on its own.</p>
        </div>`;
      gapsSection.hidden = false;
      gapsBody.innerHTML = gapsHtml(graph);
      publishStats(graph);
      return;
    }

    const instance = mountCanvas(stage, graph, entry);
    graphInstance = instance;
    gapsSection.hidden = false;
    gapsBody.innerHTML = gapsHtml(graph);
    publishStats(graph);
    /* Persist settled positions so brain.js re-renders redraw instantly. */
    entry.persistTimer && clearTimeout(entry.persistTimer);
    entry.persistTimer = setTimeout(() => { entry.positions = instance.positions(); }, 3200);
    /* Test hook: lets the harness select a node without synthesizing pointer
       math, and inspect the layout + active filter. Not used by product code. */
    window.__orgGraphTest = {
      selectNode: instance.selectNode,
      nodeIds: graph.nodes.map((node) => node.id),
      positions: instance.positions,
      visibleNodeIds: instance.visibleNodeIds,
    };
    opts.onReady?.(graph);
  }

  async function loadOpportunities(force = false) {
    const hit = oppCache.get(tenant);
    const fresh = hit && Date.now() - hit.at < CACHE_TTL_MS;
    if (!fresh || force) {
      oppsBody.innerHTML = `<p class="og-opp-loading">Reading graph recommendations…</p>`;
      try {
        const opportunities = await fetchOpportunities(tenant);
        oppCache.set(tenant, { opportunities, at: Date.now() });
      } catch (error) {
        if (!oppsBody.isConnected) return;
        oppsBody.innerHTML = `
          <div class="og-opp-error">
            <p>Couldn't load opportunities — ${esc(error?.message || "the endpoint did not respond.")}</p>
            <button class="og-refresh" type="button" data-og-opp-retry>Retry</button>
          </div>`;
        oppsBody.querySelector("[data-og-opp-retry]")?.addEventListener("click", () => loadOpportunities(true));
        return;
      }
    }
    if (!oppsBody.isConnected) return;
    const opps = oppCache.get(tenant).opportunities;
    oppsBody.innerHTML = opportunitiesHtml(opps);
    window.__oppStats = { count: opps.length };
  }

  oppsBody.addEventListener("click", (event) => {
    /* Action buttons are left alone: their data-open-ws bubbles to main.js's
       document-level delegate, which routes exactly like the bell items. */
    const toggle = event.target.closest("[data-og-opp-toggle]");
    if (!toggle) return;
    const row = toggle.closest("[data-og-opp-row]");
    const why = row?.querySelector(".og-opp-why");
    if (!why) return;
    why.hidden = !why.hidden;
    toggle.setAttribute("aria-expanded", String(!why.hidden));
    if (row.dataset.oppNode) graphInstance?.selectNode(row.dataset.oppNode);
  });

  function publishStats(graph) {
    window.__graphStats = {
      nodes: (graph.nodes || []).length,
      edges: (graph.edges || []).length,
      gaps: (graph.gaps || []).length,
    };
  }

  refreshBtn.addEventListener("click", () => { load(true); loadOpportunities(true); });
  load(false);
  loadOpportunities(false);
}
