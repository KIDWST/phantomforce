/* PhantomForce Phantom — living systems map.
   One deliberate pipeline: Leads → Quotes → Money → Delivery → Site, with
   Protect watching the whole run. Pure SVG, live stats from the store,
   nodes open their workspace. Two layouts: wide spine and phone snake. */

import { store, visible, moneyView, fmtMoney } from "./store.js";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const NARROW_AT = 620;
let lastMode = "";

function flowNodes() {
  const m = moneyView();
  const openLeads = visible(store.state.leads).filter((l) => !["won", "lost"].includes(l.status));
  const moving = visible(store.state.media).filter((x) => x.status !== "delivered");
  const builds = visible(store.state.sites);
  const sec = visible(store.state.security)[0];
  const secClean = !sec || sec.posture === "clean";
  return [
    { id: "leads", ws: "leads", icon: "◉", label: "Leads", stat: `${openLeads.length} open` },
    { id: "quotes", ws: "proposals", icon: "◆", label: "Quotes", stat: `${m.open.length} live` },
    { id: "money", ws: "money", icon: "◈", label: "Money", stat: fmtMoney(m.pipeline) },
    { id: "delivery", ws: "media", icon: "▶", label: "Delivery", stat: `${moving.length} moving` },
    { id: "site", ws: "sites", icon: "▦", label: "Site", stat: `${builds.length} builds` },
    { id: "protect", ws: "protect", icon: "⬡", label: "Protect", stat: secClean ? "clean" : "attention", alert: !secClean },
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
      leads: [64, 76], quotes: [180, 76], money: [296, 76],
      delivery: [296, 216], site: [180, 216], protect: [64, 216],
    };
    return {
      viewBox: "0 0 360 300",
      pos,
      spine: [
        link(pos.leads, pos.quotes),
        link(pos.quotes, pos.money),
        "M296,76 C344,96 344,196 296,216",
        link(pos.delivery, pos.site),
      ],
      watch: [
        "M180,216 L64,216",
        "M64,216 C12,196 12,96 64,76",
      ],
    };
  }
  const pos = {
    leads: [90, 168], quotes: [285, 120], money: [480, 168],
    delivery: [675, 120], site: [870, 168], protect: [480, 52],
  };
  return {
    viewBox: "0 0 960 280",
    pos,
    spine: [
      link(pos.leads, pos.quotes),
      link(pos.quotes, pos.money),
      link(pos.money, pos.delivery),
      link(pos.delivery, pos.site),
    ],
    watch: [
      "M480,52 C400,52 322,90 288,116",
      "M480,52 C560,52 638,90 672,116",
      "M480,73 L480,147",
    ],
  };
}

function nodeSvg(n, [x, y]) {
  const tagW = Math.ceil(Math.max(n.label.length * 7.6, n.stat.length * 6.6) + 22);
  return `
    <g class="flow-node${n.alert ? " flow-node-alert" : ""}" data-open-ws="${n.ws}"
       transform="translate(${x},${y})" tabindex="0" role="button" aria-label="Open ${n.label} — ${n.stat}">
      <circle class="flow-halo" r="30" style="animation-delay:${-((x + y) % 5) * 0.55}s"></circle>
      <circle class="flow-core" r="21"></circle>
      <circle class="flow-ring" r="26"></circle>
      <text class="flow-icon" y="5">${n.icon}</text>
      <rect class="flow-tag-bg" x="${-tagW / 2}" y="31" width="${tagW}" height="34" rx="10"></rect>
      <text class="flow-label" y="45">${n.label}</text>
      <text class="flow-stat" y="59">${n.stat}</text>
    </g>`;
}

export function renderFlowMap() {
  const stage = document.querySelector("[data-flowmap]");
  if (!stage) return;
  const mode = (stage.clientWidth || window.innerWidth) < NARROW_AT ? "narrow" : "wide";
  lastMode = mode;
  const L = layout(mode);
  stage.innerHTML = `
    <svg viewBox="${L.viewBox}" role="group" aria-label="Live map of Phantom systems">
      <defs>
        <radialGradient id="flowNodeFill" cx="50%" cy="36%" r="72%">
          <stop offset="0%" stop-color="rgba(150,255,205,0.30)"/>
          <stop offset="55%" stop-color="rgba(10,42,28,0.94)"/>
          <stop offset="100%" stop-color="rgba(4,14,10,0.98)"/>
        </radialGradient>
      </defs>
      ${L.watch.map((d) => `<path class="flow-edge-watch" d="${d}"></path>`).join("")}
      ${L.spine.map((d) => `<path class="flow-edge" d="${d}"></path>`).join("")}
      ${reduceMotion ? "" : L.spine.map((d, i) => `<path class="flow-edge-pulse" d="${d}" pathLength="140" style="animation-delay:${-i * 0.85}s"></path>`).join("")}
      ${flowNodes().map((n) => nodeSvg(n, L.pos[n.id])).join("")}
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
