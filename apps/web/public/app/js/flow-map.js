/* PhantomFlow — zero-dependency animated operations map.
   API:
   const flow = PhantomFlow.mount(target, { stations, onSelect, height, speed });
   flow.refresh({ leads: { stat, sub, status }, ... });
   flow.destroy();
*/

const STYLE_ID = "phantom-flow-styles";

const DEFAULT_STATIONS = [
  { id: "leads", label: "Leads", icon: "◉", x: 10, y: 50, workspace: "leads" },
  { id: "quotes", label: "Quotes", icon: "◆", x: 24, y: 30, workspace: "proposals" },
  { id: "money", label: "Money", icon: "◈", x: 40, y: 54, workspace: "money" },
  { id: "delivery", label: "Delivery", icon: "▶", x: 58, y: 34, workspace: "media" },
  { id: "site", label: "Site + Store", icon: "▦", x: 73, y: 55, workspace: "sites" },
  { id: "protect", label: "Protect", icon: "⬡", x: 88, y: 38, workspace: "protect" },
];

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .phantom-flow {
      --flow-height: 300px;
      --flow-speed: 10s;
      position: relative;
      min-height: var(--flow-height);
      overflow: hidden;
      isolation: isolate;
      border: 1px solid rgba(65, 255, 161, 0.22);
      border-radius: 24px;
      background:
        radial-gradient(circle at 18% 16%, rgba(65, 255, 161, 0.13), transparent 28%),
        radial-gradient(circle at 72% 34%, rgba(154, 107, 255, 0.14), transparent 30%),
        linear-gradient(135deg, rgba(4, 17, 12, 0.88), rgba(1, 7, 8, 0.94));
      box-shadow: 0 28px 80px rgba(0, 0, 0, 0.42), inset 0 0 42px rgba(65, 255, 161, 0.04);
      color: #eafff2;
    }
    .phantom-flow::before {
      content: "";
      position: absolute;
      inset: 0;
      pointer-events: none;
      opacity: 0.72;
      background-image:
        radial-gradient(circle, rgba(65,255,161,.8) 0 1px, transparent 1.6px),
        linear-gradient(rgba(65,255,161,.04) 1px, transparent 1px),
        linear-gradient(90deg, rgba(65,255,161,.035) 1px, transparent 1px);
      background-size: 42px 42px, 54px 54px, 54px 54px;
      mask-image: radial-gradient(80% 72% at 50% 48%, #000 18%, transparent 95%);
      -webkit-mask-image: radial-gradient(80% 72% at 50% 48%, #000 18%, transparent 95%);
    }
    .phantom-flow__head {
      position: relative;
      z-index: 3;
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      padding: 18px 18px 0;
    }
    .phantom-flow__kicker {
      display: block;
      color: #41ffa1;
      font: 600 10px "DM Mono", ui-monospace, monospace;
      letter-spacing: 0.22em;
      text-transform: uppercase;
    }
    .phantom-flow__title {
      margin: 4px 0 0;
      font-size: clamp(20px, 3vw, 34px);
      line-height: 1.04;
      letter-spacing: -0.03em;
    }
    .phantom-flow__pulse {
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      border: 1px solid rgba(65,255,161,.24);
      border-radius: 999px;
      color: #bfffe0;
      background: rgba(0,0,0,.24);
      font: 600 10px "DM Mono", ui-monospace, monospace;
      letter-spacing: .12em;
      text-transform: uppercase;
    }
    .phantom-flow__pulse::before {
      content: "";
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #41ffa1;
      box-shadow: 0 0 16px rgba(65,255,161,.8);
      animation: phantomFlowBlink 1.8s ease-in-out infinite;
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
    .phantom-flow__path {
      fill: none;
      stroke: rgba(65,255,161,.18);
      stroke-width: 2.5;
      stroke-linecap: round;
      stroke-dasharray: 8 11;
      filter: drop-shadow(0 0 10px rgba(65,255,161,.24));
    }
    .phantom-flow__comet {
      fill: #41ffa1;
      filter: drop-shadow(0 0 14px rgba(65,255,161,.85)) drop-shadow(0 0 28px rgba(30,240,255,.42));
    }
    .phantom-flow__comet.one { offset-path: path("M 10 50 C 18 12 30 12 40 54 S 68 76 73 55 S 80 22 88 38"); animation: phantomFlowComet var(--flow-speed) linear infinite; }
    .phantom-flow__comet.two { offset-path: path("M 10 50 C 18 12 30 12 40 54 S 68 76 73 55 S 80 22 88 38"); animation: phantomFlowComet var(--flow-speed) linear infinite; animation-delay: calc(var(--flow-speed) * -0.38); opacity: .72; }
    .phantom-flow__stations {
      position: absolute;
      inset: 0;
      z-index: 2;
    }
    .phantom-flow__station {
      position: absolute;
      left: var(--x);
      top: var(--y);
      width: min(178px, 21vw);
      min-width: 126px;
      transform: translate(-50%, -50%);
      border: 1px solid rgba(65,255,161,.2);
      border-radius: 18px;
      padding: 12px;
      color: inherit;
      text-align: left;
      cursor: pointer;
      background: rgba(2, 12, 9, .76);
      box-shadow: 0 16px 42px rgba(0,0,0,.32), inset 0 0 22px rgba(65,255,161,.035);
      -webkit-backdrop-filter: blur(12px);
      backdrop-filter: blur(12px);
      transition: transform .18s ease, border-color .18s ease, box-shadow .18s ease, background .18s ease;
    }
    .phantom-flow__station:hover,
    .phantom-flow__station:focus-visible {
      outline: none;
      transform: translate(-50%, -54%);
      border-color: rgba(65,255,161,.58);
      background: rgba(6, 30, 20, .86);
      box-shadow: 0 18px 50px rgba(0,0,0,.38), 0 0 34px rgba(65,255,161,.22);
    }
    .phantom-flow__station.is-alert { border-color: rgba(255, 209, 102, .42); }
    .phantom-flow__icon {
      display: inline-grid;
      place-items: center;
      width: 28px;
      height: 28px;
      border-radius: 11px;
      color: #020b07;
      background: #41ffa1;
      box-shadow: 0 0 18px rgba(65,255,161,.42);
      font-weight: 800;
      margin-bottom: 10px;
    }
    .phantom-flow__label {
      display: block;
      font-weight: 750;
      font-size: 14px;
      line-height: 1.05;
    }
    .phantom-flow__stat {
      display: block;
      margin-top: 6px;
      color: #41ffa1;
      font: 650 16px "DM Mono", ui-monospace, monospace;
      line-height: 1.05;
    }
    .phantom-flow__sub {
      display: block;
      margin-top: 5px;
      color: #89b99c;
      font-size: 11.5px;
      line-height: 1.25;
    }
    @keyframes phantomFlowComet {
      from { offset-distance: 0%; opacity: 0; transform: scale(.7); }
      8% { opacity: 1; }
      88% { opacity: 1; }
      to { offset-distance: 100%; opacity: 0; transform: scale(1.15); }
    }
    @keyframes phantomFlowBlink { 50% { opacity: .45; transform: scale(.72); } }
    @media (prefers-reduced-motion: reduce) {
      .phantom-flow__comet,
      .phantom-flow__pulse::before { animation: none !important; }
    }
    @media (max-width: 760px) {
      .phantom-flow {
        --flow-height: 390px;
        min-height: var(--flow-height);
        border-radius: 20px;
      }
      .phantom-flow__head {
        padding: 15px 15px 0;
      }
      .phantom-flow__pulse {
        padding: 7px 8px;
        font-size: 8.5px;
      }
      .phantom-flow__station {
        width: 126px;
        min-width: 112px;
        padding: 10px;
        border-radius: 16px;
      }
      .phantom-flow__station:nth-child(1) { left: 24% !important; top: 43% !important; }
      .phantom-flow__station:nth-child(2) { left: 72% !important; top: 43% !important; }
      .phantom-flow__station:nth-child(3) { left: 24% !important; top: 65% !important; }
      .phantom-flow__station:nth-child(4) { left: 72% !important; top: 65% !important; }
      .phantom-flow__station:nth-child(n+5) { display: none; }
      .phantom-flow__label { font-size: 13px; }
      .phantom-flow__stat { font-size: 14px; }
      .phantom-flow__sub { font-size: 10.5px; }
      .phantom-flow__svg { opacity: .72; }
    }
  `;
  document.head.appendChild(style);
}

function normalizeStation(station) {
  return {
    ...station,
    workspace: station.workspace || station.id,
    stat: station.stat || "ready",
    sub: station.sub || "tap to open",
    status: station.status || "live",
  };
}

function stationHtml(station) {
  const safe = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const s = normalizeStation(station);
  return `
    <button class="phantom-flow__station ${s.alert ? "is-alert" : ""}" type="button"
            data-flow-station="${safe(s.id)}"
            style="--x:${Number(s.x) || 50}%; --y:${Number(s.y) || 50}%">
      <span class="phantom-flow__icon">${safe(s.icon || "•")}</span>
      <span class="phantom-flow__label">${safe(s.label || s.id)}</span>
      <span class="phantom-flow__stat" data-flow-stat="${safe(s.id)}">${safe(s.stat)}</span>
      <span class="phantom-flow__sub" data-flow-sub="${safe(s.id)}">${safe(s.sub)}</span>
    </button>`;
}

function buildRoot(stations, options) {
  const el = document.createElement("section");
  el.className = "phantom-flow";
  el.style.setProperty("--flow-height", `${Number(options.height) || 300}px`);
  el.style.setProperty("--flow-speed", `${Number(options.speed) || 10}s`);
  el.innerHTML = `
    <div class="phantom-flow__head">
      <div>
        <span class="phantom-flow__kicker">${options.kicker || "Live work flow"}</span>
        <h2 class="phantom-flow__title">${options.title || "One path moves the business."}</h2>
      </div>
      <span class="phantom-flow__pulse">${options.pulseLabel || "Live"}</span>
    </div>
    <div class="phantom-flow__stage" aria-hidden="true">
      <svg class="phantom-flow__svg" viewBox="0 0 100 100" preserveAspectRatio="none">
        <path class="phantom-flow__path" d="M 10 50 C 18 12 30 12 40 54 S 68 76 73 55 S 80 22 88 38"></path>
        <circle class="phantom-flow__comet one" r="1.5"></circle>
        <circle class="phantom-flow__comet two" r="1.1"></circle>
      </svg>
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
