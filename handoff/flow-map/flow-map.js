/*
 * PhantomFlow — "The Flow": a living, animated map of an offer chain.
 *
 * A framed holo-panel with a twinkling starfield. Stations (Leads, Quotes,
 * Approvals, Bookings, Delivery, Reviews, Money) sit on a ribbon of light
 * that grades green → cyan → gold. Comet sparks ride the chain, exploding
 * in sparkles at each station they pass (gold at Money). Stations show a
 * live stat, brighten on hover, and are clickable.
 *
 * Zero dependencies. Injects its own DOM and styles. Honors
 * prefers-reduced-motion (static but still clickable). Collapses to five
 * stations under 640px. Pauses when the tab is hidden.
 *
 * Usage:
 *   <script src="flow-map.js"></script>
 *   const flow = PhantomFlow.mount("#flow-here", {
 *     subtitle: "work in motion — tap a station to open its desk",
 *     onStationClick: (id) => console.log("open", id),
 *   });
 *   flow.refresh({ leads: "5 open", quotes: "2 live", money: "$4,000" });
 *   // later: flow.destroy();
 *
 * Also usable as a CommonJS/ESM-interop module: `module.exports = { mount }`.
 */
(function (global) {
  "use strict";

  const DEFAULT_STATIONS = [
    { id: "leads", label: "Leads", icon: "◉", stat: "—" },
    { id: "quotes", label: "Quotes", icon: "◆", stat: "—" },
    { id: "approvals", label: "Approvals", icon: "✓", stat: "—" },
    { id: "bookings", label: "Bookings", icon: "◷", stat: "—" },
    { id: "delivery", label: "Delivery", icon: "▶", stat: "—" },
    { id: "reviews", label: "Reviews", icon: "★", stat: "—" },
    { id: "money", label: "Money", icon: "◈", stat: "—", gold: true },
  ];

  let stylesInjected = false;
  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    const style = document.createElement("style");
    style.textContent = `
      .phflow { position: relative; overflow: hidden; border: 1px solid rgba(65,255,161,.16); border-radius: 22px;
        background:
          radial-gradient(120% 180% at 12% -30%, rgba(65,255,161,.09), transparent 55%),
          radial-gradient(130% 200% at 88% 130%, rgba(255,214,120,.06), transparent 55%),
          rgba(3,10,7,.55);
        box-shadow: 0 0 50px rgba(65,255,161,.05); }
      .phflow-head { position: absolute; top: 15px; left: 20px; z-index: 1; display: flex; align-items: baseline; gap: 12px; pointer-events: none; }
      .phflow-kicker { font: 500 10px "DM Mono", ui-monospace, monospace; letter-spacing: .24em; text-transform: uppercase; color: rgba(65,255,161,.8); }
      .phflow-sub { font: 400 11px "DM Mono", ui-monospace, monospace; color: rgba(234,255,244,.38); }
      .phflow canvas { display: block; width: 100%; }
      @media (max-width: 720px) { .phflow-sub { display: none; } }
    `;
    document.head.appendChild(style);
  }

  function mount(target, opts) {
    opts = opts || {};
    const hostEl = typeof target === "string" ? document.querySelector(target) : target;
    if (!hostEl) throw new Error("PhantomFlow.mount: target element not found");
    injectStyles();

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const stations = (opts.stations || DEFAULT_STATIONS).map((s) => Object.assign({}, s));
    const heightDesktop = opts.height || 280;
    const heightMobile = opts.heightMobile || 230;
    const collapseIds = opts.collapseOnSmall || ["approvals", "delivery"];

    const sec = document.createElement("section");
    sec.className = "phflow";
    sec.setAttribute("aria-label", opts.title || "The Flow — how work moves");
    sec.innerHTML =
      '<div class="phflow-head">' +
      '<span class="phflow-kicker">' + (opts.title || "The Flow") + "</span>" +
      '<span class="phflow-sub">' + (opts.subtitle || "work in motion") + "</span>" +
      "</div><canvas></canvas>";
    hostEl.appendChild(sec);

    const canvas = sec.querySelector("canvas");
    const ctx2 = canvas.getContext("2d");
    if (!ctx2) { sec.remove(); throw new Error("PhantomFlow.mount: canvas 2d context unavailable"); }

    let w = 0, h = 0, dpr = 1, nodes = [], samples = [], nodeU = [], cum = [], totalLen = 1, stars = [];
    const layout = () => {
      const small = window.matchMedia("(max-width: 720px)").matches;
      canvas.style.height = (small ? heightMobile : heightDesktop) + "px";
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = Math.max(1, r.width); h = Math.max(1, r.height);
      canvas.width = w * dpr; canvas.height = h * dpr;
      stars = Array.from({ length: Math.round(w / 16) }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        r: 0.7 + Math.random() * 1.4, a: 0.08 + Math.random() * 0.26,
        tw: 1 + Math.random() * 3.5, ph: Math.random() * Math.PI * 2,
      }));
      const chain = w < 640 ? stations.filter((n) => collapseIds.indexOf(n.id) === -1) : stations;
      const padX = Math.max(52, w * 0.06);
      nodes = chain.map((n, i) => ({
        ref: n,
        x: padX + (i * (w - padX * 2)) / (chain.length - 1),
        y: h * 0.55 + (i % 2 ? 1 : -1) * h * 0.13,
        flare: 0,
      }));
      /* sample a Catmull-Rom curve through the stations for constant-speed travel */
      const STEPS = 18;
      const pts = nodes.map((n) => [n.x, n.y]);
      const crom = (p0, p1, p2, p3, s) => {
        const s2 = s * s, s3 = s2 * s;
        return [
          0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * s + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * s2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * s3),
          0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * s + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * s2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * s3),
        ];
      };
      samples = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[Math.max(0, i - 1)], p3 = pts[Math.min(pts.length - 1, i + 2)];
        for (let j = 0; j < STEPS; j++) samples.push(crom(p0, pts[i], pts[i + 1], p3, j / STEPS));
      }
      samples.push(pts[pts.length - 1]);
      cum = [0]; totalLen = 0;
      for (let i = 1; i < samples.length; i++) {
        totalLen += Math.hypot(samples[i][0] - samples[i - 1][0], samples[i][1] - samples[i - 1][1]);
        cum.push(totalLen);
      }
      nodeU = nodes.map((_, i) => cum[Math.min(cum.length - 1, i * STEPS)] / totalLen);
    };
    const posAt = (u) => {
      const targetLen = Math.max(0, Math.min(1, u)) * totalLen;
      let lo = 0, hi = cum.length - 1;
      while (lo < hi) { const mi = (lo + hi) >> 1; if (cum[mi] < targetLen) lo = mi + 1; else hi = mi; }
      const i = Math.max(1, lo);
      const seg = cum[i] - cum[i - 1] || 1;
      const f = (targetLen - cum[i - 1]) / seg;
      return [samples[i - 1][0] + (samples[i][0] - samples[i - 1][0]) * f, samples[i - 1][1] + (samples[i][1] - samples[i - 1][1]) * f];
    };

    const drawBackdrop = (t) => {
      for (const s of stars) {
        ctx2.fillStyle = `rgba(190,255,228,${s.a * (0.55 + 0.45 * Math.sin(t * s.tw + s.ph))})`;
        ctx2.fillRect(s.x, s.y, s.r, s.r);
      }
      ctx2.strokeStyle = "rgba(65,255,161,0.045)";   // faint orbit contours behind each station
      ctx2.lineWidth = 1;
      for (const n of nodes) {
        ctx2.beginPath(); ctx2.arc(n.x, n.y, 50, 0, Math.PI * 2); ctx2.stroke();
      }
    };

    /* the path is a ribbon of light shifting green → cyan → gold toward the last station */
    const drawPath = (t) => {
      const grad = ctx2.createLinearGradient(nodes[0].x, 0, nodes[nodes.length - 1].x, 0);
      grad.addColorStop(0, "rgb(65,255,161)");
      grad.addColorStop(0.55, "rgb(30,240,255)");
      grad.addColorStop(1, "rgb(255,214,120)");
      ctx2.lineCap = "round"; ctx2.lineJoin = "round";
      ctx2.beginPath();
      ctx2.moveTo(samples[0][0], samples[0][1]);
      for (let i = 1; i < samples.length; i++) ctx2.lineTo(samples[i][0], samples[i][1]);
      ctx2.strokeStyle = grad;
      ctx2.globalAlpha = 0.07; ctx2.lineWidth = 11; ctx2.stroke();
      ctx2.globalAlpha = 0.16; ctx2.lineWidth = 3.5; ctx2.stroke();
      ctx2.globalAlpha = 0.55; ctx2.lineWidth = 1.2;
      ctx2.setLineDash([4, 10]);
      ctx2.lineDashOffset = -t * 30;   // energy drifts toward the end of the chain
      ctx2.stroke();
      ctx2.setLineDash([]);
      ctx2.globalAlpha = 1;
    };

    const TRAV = 3, prevU = [0, 0, 0], dust = [];
    const burst = (n) => {
      const c = n.ref.gold ? "255,220,140" : "150,255,215";
      for (let b = 0; b < 7 && dust.length < 70; b++) {
        const ang = Math.random() * Math.PI * 2, sp = 24 + Math.random() * 46;
        dust.push({ x: n.x, y: n.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 8, life: 0, max: 0.5 + Math.random() * 0.5, r: 1 + Math.random() * 1.8, c });
      }
    };
    const drawTravelers = (t, dt) => {
      const speed = opts.speed || 0.055;   // full runs of the chain per second
      for (let k = 0; k < TRAV; k++) {
        const u = (t * speed + k / TRAV) % 1;
        for (let i = 0; i < nodeU.length; i++) {
          const nu = nodeU[i];
          const crossed = prevU[k] <= u ? (nu > prevU[k] && nu <= u) : (nu > prevU[k] || nu <= u);
          if (crossed) { nodes[i].flare = 1; burst(nodes[i]); }
        }
        prevU[k] = u;
        /* the spark turns gold as it closes in on the final station */
        const gmix = Math.max(0, (u - 0.8) / 0.2);
        const rc = Math.round(120 + 135 * gmix), gc = Math.round(255 - 41 * gmix), bc = Math.round(200 - 80 * gmix);
        for (let j = 16; j >= 0; j--) {   // long tapered comet tail
          const p = posAt(u - j * 0.006);
          ctx2.fillStyle = `rgba(${rc},${gc},${bc},${(1 - j / 17) * 0.55})`;
          ctx2.beginPath(); ctx2.arc(p[0], p[1], 0.8 + (1 - j / 17) * 3, 0, Math.PI * 2); ctx2.fill();
        }
        const hp = posAt(u), hx = hp[0], hy = hp[1];
        const hg = ctx2.createRadialGradient(hx, hy, 0, hx, hy, 12);
        hg.addColorStop(0, "rgba(255,255,255,0.95)");
        hg.addColorStop(0.35, `rgba(${rc},${gc},${bc},0.75)`);
        hg.addColorStop(1, `rgba(${rc},${gc},${bc},0)`);
        ctx2.fillStyle = hg;
        ctx2.beginPath(); ctx2.arc(hx, hy, 12, 0, Math.PI * 2); ctx2.fill();
        /* four-point lens flare on the comet head */
        const fl = 7 + Math.sin(t * 9 + k * 2) * 2.5;
        ctx2.strokeStyle = `rgba(255,255,255,${0.5 + 0.3 * Math.sin(t * 12 + k)})`;
        ctx2.lineWidth = 1;
        ctx2.beginPath();
        ctx2.moveTo(hx - fl, hy); ctx2.lineTo(hx + fl, hy);
        ctx2.moveTo(hx, hy - fl); ctx2.lineTo(hx, hy + fl);
        ctx2.stroke();
        if (Math.random() < 0.4 && dust.length < 70)
          dust.push({ x: hx, y: hy, vx: (Math.random() - 0.5) * 16, vy: 6 + Math.random() * 14, life: 0, max: 0.5 + Math.random() * 0.6, r: 0.8 + Math.random() * 1.6 });
      }
    };
    const drawDust = (dt) => {
      for (let i = dust.length - 1; i >= 0; i--) {
        const s = dust[i];
        s.life += dt;
        if (s.life > s.max) { dust.splice(i, 1); continue; }
        s.x += s.vx * dt; s.y += s.vy * dt;
        ctx2.strokeStyle = `rgba(${s.c || "210,255,235"},${(1 - s.life / s.max) * 0.85})`;
        ctx2.lineWidth = 1;
        ctx2.beginPath();
        ctx2.moveTo(s.x - s.r * 2, s.y); ctx2.lineTo(s.x + s.r * 2, s.y);
        ctx2.moveTo(s.x, s.y - s.r * 2); ctx2.lineTo(s.x, s.y + s.r * 2);
        ctx2.stroke();
      }
    };

    let hover = -1;
    const drawNodes = (dt, t) => {
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        n.flare = Math.max(0, n.flare - dt * 1.6);
        const gold = n.ref.gold;
        const cr = gold ? 255 : 65, cg = gold ? 214 : 255, cb = gold ? 120 : 161;
        const col = (a) => `rgba(${cr},${cg},${cb},${a})`;
        const R = (w < 640 ? 16 : 21) + (hover === i ? 2.5 : 0) + n.flare * 2.5;
        const glow = ctx2.createRadialGradient(n.x, n.y, 0, n.x, n.y, R * 3.4);
        glow.addColorStop(0, col(0.3 + n.flare * 0.35));
        glow.addColorStop(1, col(0));
        ctx2.fillStyle = glow;
        ctx2.beginPath(); ctx2.arc(n.x, n.y, R * 3.4, 0, Math.PI * 2); ctx2.fill();
        if (n.flare > 0.01) {   // ripple ring as a spark lands
          ctx2.strokeStyle = col(n.flare * 0.6);
          ctx2.lineWidth = 1.5;
          ctx2.beginPath(); ctx2.arc(n.x, n.y, R + (1 - n.flare) * 26, 0, Math.PI * 2); ctx2.stroke();
        }
        /* slow-turning dashed orbit ring, brighter under the cursor */
        ctx2.strokeStyle = col(0.4 + (hover === i ? 0.35 : 0) + n.flare * 0.2);
        ctx2.lineWidth = 1;
        ctx2.setLineDash([5, 7]);
        ctx2.lineDashOffset = t * (i % 2 ? 16 : -16);
        ctx2.beginPath(); ctx2.arc(n.x, n.y, R + 7, 0, Math.PI * 2); ctx2.stroke();
        ctx2.setLineDash([]);
        const disc = ctx2.createRadialGradient(n.x, n.y - R * 0.4, 0, n.x, n.y, R);
        disc.addColorStop(0, "rgba(10,30,22,0.96)");
        disc.addColorStop(1, "rgba(2,10,7,0.96)");
        ctx2.fillStyle = disc;
        ctx2.beginPath(); ctx2.arc(n.x, n.y, R, 0, Math.PI * 2); ctx2.fill();
        ctx2.strokeStyle = col(0.9);
        ctx2.lineWidth = 1.6 + n.flare;
        ctx2.stroke();
        ctx2.fillStyle = col(0.95);
        ctx2.font = `${Math.round(R * 0.85)}px "Space Grotesk", system-ui, sans-serif`;
        ctx2.textAlign = "center"; ctx2.textBaseline = "middle";
        ctx2.fillText(n.ref.icon || "◇", n.x, n.y + 1);
        /* label + live stat, kept on the side of the node away from the path */
        const up = n.y <= h * 0.55;
        const ly = up ? n.y - R - 34 : n.y + R + 18;
        ctx2.font = '500 10px "DM Mono", ui-monospace, monospace';
        ctx2.fillStyle = `rgba(234,255,244,${hover === i ? 0.85 : 0.55})`;
        ctx2.fillText((n.ref.label || n.ref.id).toUpperCase(), n.x, ly);
        ctx2.font = `600 ${Math.round(15 + n.flare * 3)}px "Space Grotesk", system-ui, sans-serif`;
        ctx2.fillStyle = gold ? col(0.95) : "rgba(234,255,244,0.92)";
        ctx2.fillText(n.ref.stat || "—", n.x, ly + 16);
      }
    };

    const scene = (t, dt) => {
      ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx2.clearRect(0, 0, w, h);
      drawBackdrop(t);
      drawPath(t);
      if (!reduceMotion) { drawTravelers(t, dt); drawDust(dt); }
      drawNodes(dt, t);
    };

    const onMove = (e) => {
      const r = canvas.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      hover = nodes.findIndex((n) => Math.hypot(mx - n.x, my - n.y) < 32);
      canvas.style.cursor = hover >= 0 ? "pointer" : "default";
    };
    const onClick = () => {
      if (hover < 0) return;
      const st = nodes[hover].ref;
      if (typeof st.onClick === "function") st.onClick(st.id);
      else if (typeof opts.onStationClick === "function") opts.onStationClick(st.id);
    };
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("click", onClick);
    const onResize = () => { layout(); if (reduceMotion) scene(0, 0); };
    window.addEventListener("resize", onResize, { passive: true });

    layout();
    let rafId = 0, destroyed = false;
    if (reduceMotion) {
      scene(0, 0);
    } else {
      let last = performance.now();
      const frame = (now) => {
        if (destroyed) return;
        if (!document.hidden) scene(now * 0.001, Math.min(0.05, (now - last) / 1000));
        last = now;
        rafId = requestAnimationFrame(frame);
      };
      rafId = requestAnimationFrame(frame);
    }

    return {
      /* refresh({ leads: "5 open", money: {stat: "$4,000"} }) — update live stats */
      refresh(update) {
        if (!update) return;
        for (const st of stations) {
          const v = update[st.id];
          if (v == null) continue;
          if (typeof v === "string") st.stat = v;
          else Object.assign(st, v);
        }
        if (reduceMotion && !destroyed) scene(0, 0);
      },
      destroy() {
        destroyed = true;
        cancelAnimationFrame(rafId);
        window.removeEventListener("resize", onResize);
        sec.remove();
      },
      element: sec,
    };
  }

  const api = { mount };
  global.PhantomFlow = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
