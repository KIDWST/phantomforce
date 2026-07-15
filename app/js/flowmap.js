/* PhantomForce Phantom — living systems map.
   One deliberate operating path: Leads → Quotes → Delivery → Sites → Accounting → Protection.
   Pure SVG + SMIL + CSS: comet dashes
   and packet orbs travel the spine, nodes ping and spin, sparks drift in
   the field. Live stats from the store; every node opens its workspace.
   Two layouts: wide wave spine and phone snake. Reduced motion → static. */

import { store, visible, moneyView, fmtMoney } from "./store.js?v=phantom-live-20260714-268";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const NARROW_AT = 620;
const BEAT = 3.4; /* seconds — one packet run along an edge; everything syncs to this */
let lastMode = "";
const signedMoney = (value) => value < 0 ? `-${fmtMoney(Math.abs(value))}` : fmtMoney(value);

/* Shared real counts for both the full map (flowNodes) and the collapsed
   compact summary row — one source of truth, never fabricated. */
function liveCounts() {
  const m = moneyView();
  const openLeads = visible(store.state.leads).filter((l) => !["won", "lost"].includes(l.status));
  const moving = visible(store.state.media).filter((x) => x.status !== "delivered");
  const builds = visible(store.state.sites);
  const sec = visible(store.state.security)[0];
  const secClean = !sec || sec.posture === "clean";
  return { m, openLeads, moving, builds, secClean };
}

/* Collapsed-state summary: real counts plus whether anything is urgent
   enough that the map should default to open instead of collapsed. */
export function flowSummary() {
  const { openLeads, moving, builds, secClean } = liveCounts();
  return {
    builds: builds.length,
    openLeads: openLeads.length,
    moving: moving.length,
    urgent: !secClean,
    text: `${builds.length} website${builds.length === 1 ? "" : "s"} · ${openLeads.length} open lead${openLeads.length === 1 ? "" : "s"} · ${moving.length} moving deliver${moving.length === 1 ? "y" : "ies"}`,
  };
}

function flowNodes() {
  const { m, openLeads, moving, builds, secClean } = liveCounts();
  return [
    { id: "leads", ws: "leads", icon: "◉", label: "Leads", stat: `${openLeads.length} open` },
    { id: "quotes", ws: "proposals", icon: "◆", label: "Quotes", stat: `${m.open.length} live` },
    { id: "delivery", ws: "media", icon: "▶", label: "Delivery", stat: `${moving.length} moving` },
    { id: "site", ws: "sites", icon: "▦", label: "Sites", stat: `${builds.length} live` },
    { id: "money", ws: "money", icon: "◈", label: "Accounting", stat: m.transactions.length ? signedMoney(m.netCash) : "books", size: 24 },
    { id: "protect", ws: "protect", icon: "⬡", label: "Protection", stat: secClean ? "clean" : "attention", alert: !secClean },
  ];
}

/* smooth horizontal-tangent bezier between two node centers */
const link = (a, b) => {
  const mx = (a[0] + b[0]) / 2;
  return `M${a[0]},${a[1]} C${mx},${a[1]} ${mx},${b[1]} ${b[0]},${b[1]}`;
};

function layout(mode) {
  if (mode === "narrow") {
    const pos = {
      leads: [64, 76], quotes: [180, 76], delivery: [296, 76],
      site: [296, 216], money: [180, 216], protect: [64, 216],
    };
    return {
      viewBox: "0 0 360 300",
      pos,
      spine: [
        link(pos.leads, pos.quotes),
        link(pos.quotes, pos.delivery),
        "M296,76 C344,96 344,196 296,216",
        link(pos.site, pos.money),
        link(pos.money, pos.protect),
      ],
      watch: [
        "M64,216 C12,196 12,96 64,76",
      ],
    };
  }
  const pos = {
    leads: [80, 168], quotes: [240, 112], delivery: [400, 168],
    site: [560, 112], money: [720, 168], protect: [880, 112],
  };
  return {
    viewBox: "0 0 960 280",
    pos,
    spine: [
      link(pos.leads, pos.quotes),
      link(pos.quotes, pos.delivery),
      link(pos.delivery, pos.site),
      link(pos.site, pos.money),
      link(pos.money, pos.protect),
    ],
    watch: [
      "M880,112 C916,170 850,236 760,196",
    ],
  };
}

/* deterministic drifting sparks scattered through the field */
function sparkSvg(viewBox) {
  const [, , w, h] = viewBox.split(" ").map(Number);
  let out = "";
  for (let i = 0; i < 16; i++) {
    const x = 26 + ((i * 61) % (w - 52));
    const y = 32 + ((i * 47) % (h - 74));
    const r = (1 + (i % 3) * 0.6).toFixed(1);
    out += `<circle class="flow-spark" cx="${x}" cy="${y}" r="${r}"
      style="animation-duration:${4 + (i % 5)}s;animation-delay:${(-i * 0.9).toFixed(1)}s"></circle>`;
  }
  return out;
}

/* glowing orb + trail riding each spine edge, phased just ahead of its comet dash */
function packetSvg(spine) {
  return spine.map((d, i) => {
    const head = -(i * 0.85 + 0.24);
    return `
      <circle class="flow-packet-trail" r="2.5">
        <animateMotion dur="${BEAT}s" repeatCount="indefinite" begin="${(head + 0.16).toFixed(2)}s" path="${d}"/>
      </circle>
      <circle class="flow-packet" r="4">
        <animateMotion dur="${BEAT}s" repeatCount="indefinite" begin="${head.toFixed(2)}s" path="${d}"/>
      </circle>`;
  }).join("");
}

function nodeSvg(n, [x, y], i, animated) {
  const R = n.size || 21;
  const tagW = Math.ceil(Math.max(n.label.length * 7.6, n.stat.length * 6.6) + 22);
  const tagY = R + 10;
  const radar = n.id === "protect" && animated ? `
    <g class="flow-radar">
      <path d="M0,0 L${R + 22},-11 A${R + 24},${R + 24} 0 0 1 ${R + 22},11 Z"></path>
      <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="7s" repeatCount="indefinite"/>
    </g>` : "";
  const ping = animated ? `
    <circle class="flow-ping" r="${R}">
      <animate attributeName="r" values="${R};${R + 16}" dur="${BEAT}s" begin="${(-i * 0.57).toFixed(2)}s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0.5;0" dur="${BEAT}s" begin="${(-i * 0.57).toFixed(2)}s" repeatCount="indefinite"/>
    </circle>` : "";
  const spin = animated ? `<animateTransform attributeName="transform" type="rotate"
      from="${i % 2 ? 360 : 0}" to="${i % 2 ? 0 : 360}" dur="16s" repeatCount="indefinite"/>` : "";
  return `
    <g class="flow-node${n.alert ? " flow-node-alert" : ""}" data-open-ws="${n.ws}"
       transform="translate(${x},${y})" tabindex="0" role="button"
       aria-label="Open ${n.label} — ${n.stat}" style="animation-delay:${i * 90}ms">
      ${radar}
      <g class="flow-orb">
        <circle class="flow-halo" r="${R + 9}" style="animation-delay:${(-((x + y) % 5) * 0.55).toFixed(2)}s"></circle>
        ${ping}
        <circle class="flow-core" r="${R}"></circle>
        <g class="flow-ticks"><circle r="${R + 5}"></circle>${spin}</g>
        <text class="flow-icon" y="5">${n.icon}</text>
      </g>
      <rect class="flow-tag-bg" x="${-tagW / 2}" y="${tagY}" width="${tagW}" height="34" rx="10"></rect>
      <text class="flow-label" y="${tagY + 14}">${n.label}</text>
      <text class="flow-stat" y="${tagY + 28}">${n.stat}</text>
    </g>`;
}

export function renderFlowMap() {
  const stage = document.querySelector("[data-flowmap]");
  if (!stage) return;
  const mode = (stage.clientWidth || window.innerWidth) < NARROW_AT ? "narrow" : "wide";
  lastMode = mode;
  const L = layout(mode);
  const animated = !reduceMotion;
  stage.innerHTML = `
    <svg viewBox="${L.viewBox}" role="group" aria-label="Live map of Phantom systems">
      <defs>
        <radialGradient id="flowNodeFill" cx="50%" cy="36%" r="72%">
          <stop offset="0%" stop-color="rgba(150,255,205,0.30)"/>
          <stop offset="55%" stop-color="rgba(10,42,28,0.94)"/>
          <stop offset="100%" stop-color="rgba(4,14,10,0.98)"/>
        </radialGradient>
      </defs>
      ${sparkSvg(L.viewBox)}
      ${L.watch.map((d) => `<path class="flow-edge-watch" d="${d}"></path>`).join("")}
      ${L.spine.map((d) => `<path class="flow-edge" d="${d}"></path>`).join("")}
      ${animated ? L.spine.map((d, i) => `<path class="flow-edge-pulse" d="${d}" pathLength="140" style="animation-delay:${-i * 0.85}s"></path>`).join("") : ""}
      ${animated ? packetSvg(L.spine) : ""}
      ${flowNodes().map((n, i) => nodeSvg(n, L.pos[n.id], i, animated)).join("")}
    </svg>`;
}

/* switch layouts only when the breakpoint is actually crossed */
let resizeT = 0;
window.addEventListener("resize", () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => {
    const stage = document.querySelector("[data-flowmap]");
    if (!stage || !stage.firstElementChild) return;
    const mode = (stage.clientWidth || window.innerWidth) < NARROW_AT ? "narrow" : "wide";
    if (mode !== lastMode) renderFlowMap();
  }, 160);
}, { passive: true });

/* keyboard: Enter / Space on a focused node opens its workspace */
document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const node = e.target.closest?.("[data-flowmap] [data-open-ws]");
  if (!node) return;
  e.preventDefault();
  node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
});
