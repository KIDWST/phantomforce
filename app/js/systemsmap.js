/* Systems Neural Map — the Developer-tab "brain": every internal subsystem
 * and integration PhantomForce actually carries, drawn as a neural network
 * around the central Neural Spine, with HONEST state per node.
 *
 * Honesty first: this map never claims something is "connected/working" when
 * it is not. Each node carries a real state — live, gated (intentional
 * dry-run), config (real module present, needs credentials/config to go
 * live), or absent (not linked yet) — sourced from docs/RELEASE_CANDIDATE_
 * TRUTH_MAP.md and overlaid with live status (providers, workforce) when the
 * server responds. Color is never the only signal: every node and the legend
 * restate state in text. Reduced motion stops all pulse. */

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const STATE = {
  live:   { color: "#41ffa1", label: "Live" },
  gated:  { color: "#ffb347", label: "Gated (dry-run by design)" },
  config: { color: "#4f9dff", label: "Needs config / credentials" },
  absent: { color: "#6f7f8c", label: "Not linked yet" },
};

/* The real topology. Each cluster head links to the Spine; members link to
   their head. Every id below maps to a real module in the repo (server/src or
   app/js) — except `engraph`, which is honestly marked absent. */
const CLUSTERS = [
  { id: "memory", head: { id: "hermes", label: "Hermes", state: "live", desc: "Hash-chained interaction + evidence ledger. The system of record.", src: "server/src/phantom-ai/hermes-*.ts" },
    members: [
      { id: "spine-mem", label: "Neural Spine", state: "live", desc: "Owner/org-scoped memory vault, behavioral profile, context-preview.", src: "server/src/phantom-ai/neural-spine.ts" },
      { id: "obsidian", label: "Obsidian", state: "config", desc: "Sanitized process-note vault. Local; needs a vault path configured.", src: "Obsidian Command Center", needs: "vault path" },
    ] },
  { id: "execution", head: { id: "agentruns", label: "Agent-Run Engine", state: "live", desc: "The ONE execution engine — states, artifacts, receipts, ledger proof.", src: "server/src/phantom-ai/agent-runs.ts" },
    members: [
      { id: "automation", label: "Automation Engine", state: "live", desc: "Scheduled read-only jobs with Hermes receipts.", src: "server/src/phantom-ai/automation-engine.ts" },
      { id: "n8n", label: "n8n", state: "gated", desc: "Workflow lane — dry-run by design; live execution hardwired off until approved.", src: "ops/n8n", needs: "approval + live flag" },
      { id: "falcon", label: "Falcon", state: "config", desc: "Background job queue (FalconJob). Present; wire jobs to activate.", src: "server/src/falcon" },
      { id: "ruflo", label: "Ruflo", state: "config", desc: "Worker automation lane. Present; needs runner configuration.", src: "server/src/phantom-ai (ruflo)" },
    ] },
  { id: "models", head: { id: "router", label: "Model Router", state: "live", desc: "Routes chat across providers: Codex → Claude → OpenRouter → Local.", src: "server/src/phantom-ai/model-router.ts" },
    members: [
      { id: "codex", label: "Codex CLI", state: "config", desc: "Private reasoning lane via Codex CLI.", src: "codex-cli-transport" },
      { id: "claude", label: "Claude CLI", state: "config", desc: "Claude transport. Needs CLI/key configured.", src: "claude-cli-transport", needs: "ANTHROPIC key/CLI" },
      { id: "openrouter", label: "OpenRouter", state: "config", desc: "GLM 5.2 via OpenRouter. Needs key + live transport flags.", src: "openrouter-live-transport", needs: "OPENROUTER_API_KEY + 2 flags" },
      { id: "local", label: "Local Ollama", state: "config", desc: "Localhost model lane (qwen2.5:14b).", src: "local-ollama-transport", needs: "Ollama running" },
    ] },
  { id: "agents", head: { id: "orca", label: "Orca", state: "config", desc: "Orchestration/agent lane. Present; needs runner + credentials.", src: "server/src (orca)" },
    members: [
      { id: "serena", label: "Serena", state: "config", desc: "Coding/agent tool lane. Present; needs MCP/runner config.", src: "server/src (serena)" },
    ] },
  { id: "connectors", head: { id: "connhub", label: "Connectors", state: "config", desc: "External connector boundary. Credentials required; all fail-closed.", src: "server/src/connectors" },
    members: [
      { id: "calendar", label: "Calendar", state: "config", desc: "Calendar connector — reports live:false until authorized.", src: "calendar-connector.ts", needs: "OAuth" },
      { id: "finance", label: "Finance", state: "config", desc: "Plaid/CSV finance. Manual/CSV ready; live provider not configured.", src: "finance-connector.ts", needs: "provider config" },
      { id: "sales", label: "Sales / CRM", state: "config", desc: "Sales connector boundary.", src: "sales-connector.ts", needs: "OAuth" },
      { id: "social", label: "Social", state: "config", desc: "Social OAuth — manual capture; live posting disabled.", src: "social-analytics-connector.ts", needs: "OAuth" },
    ] },
  { id: "knowledge", head: { id: "orggraph", label: "Org Brain Graph", state: "live", desc: "Force-directed map of every entity the brain sees (/api/organization/graph).", src: "app/js/orggraph.js" },
    members: [
      { id: "engraph", label: "engraph", state: "absent", desc: "Knowledge-graph engine — not present in the repo yet. Available to add.", src: "not linked", needs: "repo + integration" },
    ] },
];

/* Overlay real live status when the server responded. Never fabricates: absent
   data leaves the honest static default in place. */
function applyLive(nodesById, live) {
  if (!live) return;
  const pm = live.providerManager;
  if (pm && Array.isArray(pm.providers)) {
    const map = { codex_cli: "codex", claude_cli: "claude", openrouter_glm: "openrouter", local_ollama: "local" };
    pm.providers.forEach((p) => {
      const id = map[p.provider_id || p.id];
      const n = id && nodesById[id];
      if (n && (p.status === "online" || p.live_call_ready)) n.state = "live";
    });
  }
  if (live.localModels && (live.localModels.available || live.localModels.ready) && nodesById.local) nodesById.local.state = "live";
  if (live.workforce && nodesById.agentruns) {
    const count = live.workforce.summary?.runtime_active_workers ?? live.workforce.summary?.total_workers;
    if (count != null) nodesById.agentruns.live = `${count} active`;
  }
}

export function renderNeuralMap(host, live) {
  if (!host) return;
  const reduce = (() => { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } })();
  const W = 920, H = 560, cx = W / 2, cy = H / 2;
  const nodes = [];
  const edges = [];
  const byId = {};
  const spine = { id: "spine", label: "Neural Spine", state: "live", x: cx, y: cy, r: 34, kind: "core",
    desc: "The brain core. Every subsystem below routes through it — memory, decisions, execution, evidence.", src: "neural-spine.ts + index.ts" };
  nodes.push(spine); byId.spine = spine;

  const clusterAngles = [-90, -30, 30, 90, 150, 210]; // 6 clusters around the core
  CLUSTERS.forEach((cluster, ci) => {
    const a = (clusterAngles[ci] * Math.PI) / 180;
    const hx = cx + Math.cos(a) * 168;
    const hy = cy + Math.sin(a) * 150;
    const head = { ...cluster.head, x: hx, y: hy, r: 22, kind: "head" };
    nodes.push(head); byId[head.id] = head;
    edges.push({ a: "spine", b: head.id, live: head.state === "live" });
    const n = cluster.members.length;
    cluster.members.forEach((m, mi) => {
      const spread = 58; // degrees fanned around the head's outward direction
      const base = clusterAngles[ci];
      const ma = ((base + (mi - (n - 1) / 2) * (spread / Math.max(1, n - 1 || 1))) * Math.PI) / 180;
      const mx = hx + Math.cos(ma) * 96;
      const my = hy + Math.sin(ma) * 92;
      const node = { ...m, x: Math.max(30, Math.min(W - 30, mx)), y: Math.max(30, Math.min(H - 30, my)), r: 13, kind: "leaf" };
      nodes.push(node); byId[node.id] = node;
      edges.push({ a: head.id, b: node.id, live: node.state === "live" });
    });
  });
  applyLive(byId, live);

  const counts = { live: 0, gated: 0, config: 0, absent: 0 };
  nodes.forEach((n) => { counts[n.state] = (counts[n.state] || 0) + 1; });

  const edgeSvg = edges.map((e, i) => {
    const A = byId[e.a], B = byId[e.b];
    if (!A || !B) return "";
    const on = A.state === "live" && B.state === "live";
    return `<line class="nm-edge${on ? " is-live" : ""}" x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}" style="--i:${i}"></line>`;
  }).join("");

  const nodeSvg = nodes.map((n) => {
    const c = STATE[n.state].color;
    const labelDy = n.kind === "leaf" ? n.r + 13 : n.r + 15;
    return `<g class="nm-node nm-${n.kind}${n.state === "live" && !reduce ? " nm-pulse" : ""}" data-nm-node="${esc(n.id)}" tabindex="0" role="button"
        aria-label="${esc(n.label)} — ${esc(STATE[n.state].label)}" transform="translate(${n.x},${n.y})">
      <circle r="${n.r}" style="--c:${c}"></circle>
      ${n.kind === "core" ? `<circle class="nm-core-ring" r="${n.r + 8}"></circle>` : ""}
      <text class="nm-label" y="${labelDy}">${esc(n.label)}</text>
    </g>`;
  }).join("");

  const legend = Object.entries(STATE).map(([k, v]) =>
    `<span class="nm-leg"><i style="background:${v.color}"></i>${esc(v.label)} · ${counts[k] || 0}</span>`).join("");

  host.innerHTML = `
    <div class="nm-head">
      <div><p class="nm-kicker">System neural map</p><h3>Everything linked to the brain</h3></div>
      <div class="nm-legend">${legend}</div>
    </div>
    <div class="nm-stage">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Neural network of PhantomForce subsystems">
        <g class="nm-edges">${edgeSvg}</g>
        <g class="nm-nodes">${nodeSvg}</g>
      </svg>
      <aside class="nm-detail" data-nm-detail hidden></aside>
    </div>`;

  const detail = host.querySelector("[data-nm-detail]");
  const show = (id) => {
    const n = byId[id]; if (!n || !detail) return;
    detail.hidden = false;
    detail.innerHTML = `
      <button class="nm-detail-x" type="button" data-nm-close aria-label="Close">×</button>
      <span class="nm-detail-state" style="--c:${STATE[n.state].color}">${esc(STATE[n.state].label)}</span>
      <h4>${esc(n.label)}${n.live ? ` <em>· ${esc(n.live)}</em>` : ""}</h4>
      <p>${esc(n.desc || "")}</p>
      <dl>${n.src ? `<div><dt>Source</dt><dd>${esc(n.src)}</dd></div>` : ""}${n.needs ? `<div><dt>To go live</dt><dd>${esc(n.needs)}</dd></div>` : ""}</dl>`;
    host.querySelectorAll("[data-nm-node]").forEach((g) => g.classList.toggle("is-focus", g.getAttribute("data-nm-node") === id));
  };
  host.querySelectorAll("[data-nm-node]").forEach((g) => {
    const id = g.getAttribute("data-nm-node");
    g.addEventListener("click", () => show(id));
    g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); show(id); } });
  });
  detail?.addEventListener("click", (e) => {
    if (e.target.closest("[data-nm-close]")) { detail.hidden = true; host.querySelectorAll("[data-nm-node]").forEach((g) => g.classList.remove("is-focus")); }
  });
}
