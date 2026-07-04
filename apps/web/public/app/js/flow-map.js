/* PhantomFlow — zero-dependency animated operations map.
   API:
   const flow = PhantomFlow.mount(target, { stations, onSelect, height, speed });
   flow.refresh({ leads: { stat, sub, alert }, ... });
   flow.destroy();
*/

const STYLE_ID = "phantom-flow-styles";

const DEFAULT_STATIONS = [
  { id: "leads", label: "Leads", icon: "◉", x: 18, y: 63, workspace: "leads" },
  { id: "quotes", label: "Quotes", icon: "◆", x: 32, y: 35, workspace: "proposals" },
  { id: "money", label: "Money", icon: "$", x: 50, y: 70, workspace: "money" },
  { id: "delivery", label: "Delivery", icon: "▶", x: 68, y: 36, workspace: "media" },
  { id: "site", label: "Site", icon: "▦", x: 82, y: 63, workspace: "sites" },
  { id: "protect", label: "Protect", icon: "⬡", x: 50, y: 20, workspace: "protect" },
];

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}[c]));

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .phantom-flow {
      --flow-height: 286px;
      --flow-speed: 9s;
      position: relative;
      min-height: var(--flow-height);
      overflow: hidden;
      isolation: isolate;
      border: 1px solid rgba(65, 255, 161, 0.2);
      border-radius: 26px;
      background:
        radial-gradient(circle at 50% 54%, rgba(65, 255, 161, 0.16), transparent 34%),
        radial-gradient(circle at 72% 28%, rgba(158, 104, 255, 0.12), transparent 28%),
        linear-gradient(140deg, rgba(0, 11, 8, 0.96), rgba(0, 4, 7, 0.98));
      box-shadow: 0 22px 64px rgba(0, 0, 0, 0.38), inset 0 0 44px rgba(65, 255, 161, 0.035);
      color: #eafff4;
    }
    .phantom-flow::before {
      content: "";
      position: absolute;
      inset: 0;
      opacity: 0.62;
      pointer-events: none;
      background-image:
        radial-gradient(circle, rgba(65,255,161,.72) 0 1px, transparent 1.55px),
        linear-gradient(rgba(65,255,161,.035) 1px, transparent 1px),
        linear-gradient(90deg, rgba(65,255,161,.03) 1px, transparent 1px);
      background-size: 44px 44px, 56px 56px, 56px 56px;
      mask-image: radial-gradient(72% 70% at 50% 52%, #000 22%, transparent 98%);
      -webkit-mask-image: radial-gradient(72% 70% at 50% 52%, #000 22%, transparent 98%);
    }
    .phantom-flow::after {
      content: "";
      position: absolute;
      inset: 12px;
      border-radius: 22px;
      pointer-events: none;
      border: 1px solid rgba(65, 255, 161, 0.055);
      box-shadow: inset 0 0 28px rgba(65,255,161,.045);
    }
    .phantom-flow__head {
      position: relative;
      z-index: 5;
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      padding: 16px 17px 0;
      pointer-events: none;
    }
    .phantom-flow__kicker {
      display: block;
      color: #41ffa1;
      font: 700 9px "DM Mono", ui-monospace, monospace;
      letter-spacing: 0.28em;
      text-transform: uppercase;
    }
    .phantom-flow__title {
      max-width: 330px;
      margin: 5px 0 0;
      font-size: clamp(18px, 2.6vw, 28px);
      line-height: 1.02;
      letter-spacing: -0.035em;
    }
    .phantom-flow__pulse {
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 7px 10px;
      border: 1px solid rgba(65,255,161,.24);
      border-radius: 999px;
      color: #c7ffe4;
      background: rgba(0,0,0,.3);
      font: 700 9px "DM Mono", ui-monospace, monospace;
      letter-spacing: .16em;
      text-transform: uppercase;
      box-shadow: 0 0 18px rgba(65,255,161,.075);
    }
    .phantom-flow__pulse::before {
      content: "";
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #41ffa1;
      box-shadow: 0 0 16px rgba(65,255,161,.9);
      animation: phantomFlowBlink 1.65s ease-in-out infinite;
    }
    .phantom-flow__stage {
      position: absolute;
      inset: 0;
      z-index: 1;
    }
    .phantom-flow__svg {
      width: 100%;
      height: 100%;
      overflow: visible;
    }
    .phantom-flow__path,
    .phantom-flow__branch {
      fill: none;
      stroke-linecap: round;
      filter: drop-shadow(0 0 10px rgba(65,255,161,.24));
    }
    .phantom-flow__path {
      stroke: rgba(65,255,161,.24);
      stroke-width: 1.25;
      stroke-dasharray: 3 8;
    }
    .phantom-flow__branch {
      stroke: rgba(65,255,161,.12);
      stroke-width: .8;
      stroke-dasharray: 2 7;
    }
    .phantom-flow__comet {
      fill: #41ffa1;
      filter: drop-shadow(0 0 14px rgba(65,255,161,.95)) drop-shadow(0 0 28px rgba(30,240,255,.35));
    }
    .phantom-flow__comet.one { offset-path: path("M 50 20 C 30 28 18 44 18 63 C 32 76 43 78 50 70 C 62 77 74 76 82 63 C 80 48 76 40 68 36 C 58 28 48 27 32 35 C 26 44 36 55 50 70"); animation: phantomFlowComet var(--flow-speed) linear infinite; }
    .phantom-flow__comet.two { offset-path: path("M 50 20 C 30 28 18 44 18 63 C 32 76 43 78 50 70 C 62 77 74 76 82 63 C 80 48 76 40 68 36 C 58 28 48 27 32 35 C 26 44 36 55 50 70"); animation: phantomFlowComet var(--flow-speed) linear infinite; animation-delay: calc(var(--flow-speed) * -0.43); opacity: .72; }
    .phantom-flow__core {
      position: absolute;
      z-index: 2;
      left: 50%;
      top: 53%;
      width: clamp(92px, 18vw, 140px);
      aspect-ratio: 1;
      transform: translate(-50%, -50%);
      border-radius: 50%;
      background:
        radial-gradient(circle at 48% 45%, rgba(65,255,161,.34), rgba(65,255,161,.1) 34%, transparent 58%),
        radial-gradient(circle at 52% 55%, rgba(13, 255, 185, .16), transparent 60%);
      box-shadow: 0 0 48px rgba(65,255,161,.17), inset 0 0 36px rgba(65,255,161,.12);
      pointer-events: none;
    }
    .phantom-flow__core::before,
    .phantom-flow__core::after {
      content: "";
      position: absolute;
      inset: -12px;
      border-radius: 50%;
      border: 1px solid rgba(65,255,161,.18);
      animation: phantomFlowSpin 13s linear infinite;
    }
    .phantom-flow__core::after {
      inset: 16px -20px;
      border-color: rgba(159, 114, 255, .16);
      animation-duration: 9s;
      animation-direction: reverse;
    }
    .phantom-flow__face {
      position: absolute;
      left: 50%;
      top: 50%;
      width: 46px;
      height: 24px;
      transform: translate(-50%, -50%);
    }
    .phantom-flow__face::before,
    .phantom-flow__face::after {
      content: "";
      position: absolute;
      top: 0;
      width: 9px;
      height: 13px;
      border-radius: 999px;
      background: #d7fff0;
      box-shadow: 0 0 14px rgba(65,255,161,.6);
    }
    .phantom-flow__face::before { left: 6px; }
    .phantom-flow__face::after { right: 6px; }
    .phantom-flow__mouth {
      position: absolute;
      left: 50%;
      bottom: 0;
      width: 23px;
      height: 8px;
      transform: translateX(-50%);
      border-bottom: 2px solid #41ffa1;
      border-radius: 0 0 999px 999px;
      opacity: .8;
    }
    .phantom-flow__stations {
      position: absolute;
      inset: 0;
      z-index: 4;
    }
    .phantom-flow__station {
      position: absolute;
      left: var(--x);
      top: var(--y);
      transform: translate(-50%, -50%);
      display: grid;
      justify-items: center;
      gap: 7px;
      width: 112px;
      border: 0;
      padding: 0;
      color: inherit;
      text-align: center;
      cursor: pointer;
      background: transparent;
      transition: transform .18s ease, filter .18s ease;
    }
    .phantom-flow__station:hover,
    .phantom-flow__station:focus-visible {
      outline: none;
      transform: translate(-50%, -55%) scale(1.04);
      filter: drop-shadow(0 0 20px rgba(65,255,161,.34));
    }
    .phantom-flow__orb {
      display: grid;
      place-items: center;
      width: 42px;
      height: 42px;
      border: 1px solid rgba(65,255,161,.34);
      border-radius: 50%;
      color: #06120c;
      background: radial-gradient(circle at 35% 30%, #c9ffe6, #41ffa1 46%, #0dbf74 100%);
      box-shadow: 0 0 20px rgba(65,255,161,.42), 0 0 44px rgba(65,255,161,.12);
      font-weight: 900;
      font-size: 15px;
    }
    .phantom-flow__station.is-alert .phantom-flow__orb {
      background: radial-gradient(circle at 35% 30%, #fff3c7, #ffd166 52%, #ff6b3d 100%);
      box-shadow: 0 0 20px rgba(255,209,102,.45), 0 0 44px rgba(255,92,76,.16);
    }
    .phantom-flow__meta {
      min-width: 92px;
      max-width: 118px;
      border: 1px solid rgba(65,255,161,.18);
      border-radius: 999px;
      padding: 6px 8px;
      background: rgba(0, 13, 9, .72);
      box-shadow: 0 12px 28px rgba(0,0,0,.24), inset 0 0 16px rgba(65,255,161,.04);
      -webkit-backdrop-filter: blur(12px);
      backdrop-filter: blur(12px);
    }
    .phantom-flow__label {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 800;
      font-size: 11.5px;
      line-height: 1.05;
    }
    .phantom-flow__stat {
      display: block;
      margin-top: 3px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: #41ffa1;
      font: 700 10px "DM Mono", ui-monospace, monospace;
      line-height: 1.05;
    }
    .phantom-flow__sub {
      display: none;
    }
    @keyframes phantomFlowComet {
      from { offset-distance: 0%; opacity: 0; transform: scale(.7); }
      9% { opacity: 1; }
      84% { opacity: 1; }
      to { offset-distance: 100%; opacity: 0; transform: scale(1.05); }
    }
    @keyframes phantomFlowBlink { 50% { opacity: .4; transform: scale(.68); } }
    @keyframes phantomFlowSpin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) {
      .phantom-flow__comet,
      .phantom-flow__pulse::before,
      .phantom-flow__core::before,
      .phantom-flow__core::after { animation: none !important; }
    }
    @media (max-width: 760px) {
      .phantom-flow {
        --flow-height: 272px;
        min-height: var(--flow-height);
        border-radius: 22px;
      }
      .phantom-flow__head {
        padding: 14px 14px 0;
      }
      .phantom-flow__title {
        max-width: 170px;
        font-size: 19px;
        line-height: 1.02;
      }
      .phantom-flow__pulse {
        padding: 6px 8px;
        font-size: 8px;
      }
      .phantom-flow__station {
        width: 86px;
        gap: 5px;
      }
      .phantom-flow__orb {
        width: 35px;
        height: 35px;
        font-size: 13px;
      }
      .phantom-flow__meta {
        min-width: 76px;
        max-width: 92px;
        padding: 5px 6px;
      }
      .phantom-flow__label { font-size: 10.5px; }
      .phantom-flow__stat { font-size: 9px; }
      .phantom-flow__core {
        top: 60%;
        width: 92px;
      }
      .phantom-flow__svg { opacity: .9; }
      .phantom-flow__station:nth-child(1) { left: 19% !important; top: 68% !important; }
      .phantom-flow__station:nth-child(2) { left: 33% !important; top: 48% !important; }
      .phantom-flow__station:nth-child(3) { left: 50% !important; top: 76% !important; }
      .phantom-flow__station:nth-child(4) { left: 67% !important; top: 48% !important; }
      .phantom-flow__station:nth-child(5) { left: 81% !important; top: 68% !important; }
      .phantom-flow__station:nth-child(6) { left: 80% !important; top: 27% !important; }
    }
  `;
  document.head.appendChild(style);
}

function normalizeStation(station) {
  return {
    ...station,
    workspace: station.workspace || station.id,
    stat: station.stat || "ready",
    sub: station.sub || "",
    status: station.status || "live",
  };
}

function stationHtml(station) {
  const s = normalizeStation(station);
  return `
    <button class="phantom-flow__station ${s.alert ? "is-alert" : ""}" type="button"
            data-flow-station="${esc(s.id)}"
            style="--x:${Number(s.x) || 50}%; --y:${Number(s.y) || 50}%"
            aria-label="Open ${esc(s.label || s.id)}">
      <span class="phantom-flow__orb">${esc(s.icon || "•")}</span>
      <span class="phantom-flow__meta">
        <span class="phantom-flow__label">${esc(s.label || s.id)}</span>
        <span class="phantom-flow__stat" data-flow-stat="${esc(s.id)}">${esc(s.stat)}</span>
        <span class="phantom-flow__sub" data-flow-sub="${esc(s.id)}">${esc(s.sub)}</span>
      </span>
    </button>`;
}

function buildRoot(stations, options) {
  const el = document.createElement("section");
  el.className = "phantom-flow";
  el.style.setProperty("--flow-height", `${Number(options.height) || 286}px`);
  el.style.setProperty("--flow-speed", `${Number(options.speed) || 9}s`);
  el.innerHTML = `
    <div class="phantom-flow__head">
      <div>
        <span class="phantom-flow__kicker">${esc(options.kicker || "The Flow")}</span>
        <h2 class="phantom-flow__title">${esc(options.title || "Work moves from signal to delivery.")}</h2>
      </div>
      <span class="phantom-flow__pulse">${esc(options.pulseLabel || "Live")}</span>
    </div>
    <div class="phantom-flow__stage" aria-hidden="true">
      <svg class="phantom-flow__svg" viewBox="0 0 100 100" preserveAspectRatio="none">
        <path class="phantom-flow__branch" d="M 50 53 L 50 20 M 50 53 L 18 63 M 50 53 L 32 35 M 50 53 L 50 70 M 50 53 L 68 36 M 50 53 L 82 63"></path>
        <path class="phantom-flow__path" d="M 50 20 C 30 28 18 44 18 63 C 32 76 43 78 50 70 C 62 77 74 76 82 63 C 80 48 76 40 68 36 C 58 28 48 27 32 35 C 26 44 36 55 50 70"></path>
        <circle class="phantom-flow__comet one" r="1.25"></circle>
        <circle class="phantom-flow__comet two" r=".9"></circle>
      </svg>
      <div class="phantom-flow__core"><span class="phantom-flow__face"><span class="phantom-flow__mouth"></span></span></div>
    </div>
    <div class="phantom-flow__stations">
      ${stations.map(stationHtml).join("")}
    </div>`;
  return el;
}

export const PhantomFlow = {
  mount(target, options = {}) {
    const host = typeof target === "string" ? document.querySelector(target) : target;
    if (!host) throw new Error("PhantomFlow mount target not found.");
    injectStyles();
    const stations = (options.stations || DEFAULT_STATIONS).map(normalizeStation);
    host.innerHTML = "";
    const root = buildRoot(stations, options);
    host.appendChild(root);

    const state = { stations: new Map(stations.map((s) => [s.id, s])) };
    root.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-flow-station]");
      if (!btn) return;
      const station = state.stations.get(btn.dataset.flowStation);
      if (station && options.onSelect) options.onSelect(station, btn);
    });

    function refresh(stats = {}) {
      for (const [id, patch] of Object.entries(stats)) {
        const station = state.stations.get(id);
        if (!station) continue;
        Object.assign(station, patch || {});
        const stat = root.querySelector(`[data-flow-stat="${CSS.escape(id)}"]`);
        const sub = root.querySelector(`[data-flow-sub="${CSS.escape(id)}"]`);
        const card = root.querySelector(`[data-flow-station="${CSS.escape(id)}"]`);
        if (stat) stat.textContent = station.stat || "";
        if (sub) sub.textContent = station.sub || "";
        if (card) card.classList.toggle("is-alert", Boolean(station.alert));
      }
      return api;
    }

    function destroy() {
      host.innerHTML = "";
    }

    const api = { root, refresh, destroy };
    return api;
  },
};

export default PhantomFlow;
