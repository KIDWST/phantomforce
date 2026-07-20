/* PhantomForce Bridge — the ship chrome around the existing capability.
 *
 * This module owns three things and NOTHING about business logic:
 *   1. The deep-space ambience canvas behind every surface.
 *   2. The bottom command dock (shortcut buttons are plain [data-nav-id]
 *      elements, so main.js's existing delegated click handler routes them
 *      with no coupling; the sigil is a [data-side-toggle], so the existing
 *      setMobileNav machinery opens the Navigator deck — the restyled
 *      sidebar — untouched).
 *   3. Keeping dock state honest: active module, approvals badge, and the
 *      sigil's aria-expanded all mirror what main.js renders into the
 *      sidebar, observed via MutationObserver — never duplicated logic.
 *
 * Honors prefers-reduced-motion: the starfield renders one static frame and
 * every drift/pulse stays off.
 */
(() => {
  "use strict";
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const desktop = () => window.matchMedia("(min-width: 901px)").matches;

  /* ===================== deep-space ambience ===================== */
  const space = document.querySelector("[data-bridge-space]");
  if (space) {
    const ctx = space.getContext("2d");
    let W = 0, H = 0, stars = [], nebulae = [];
    let running = false, lastT = 0;

    const rand = (a, b) => a + Math.random() * (b - a);
    /* Restraint over spectacle: a sparse, dim field that reads as depth
       behind the product, never as a screensaver competing with it. */
    const seed = () => {
      stars = [];
      const count = Math.min(90, Math.round((W * H) / 26000));
      for (let i = 0; i < count; i++) {
        const depth = Math.random();                    // 0 far … 1 near
        stars.push({
          x: Math.random() * W, y: Math.random() * H, depth,
          r: 0.4 + depth * 1.0,
          hue: Math.random() < 0.82 ? "160,255,205" : "120,225,255",
          base: 0.10 + depth * 0.22,
          tw: rand(0.2, 0.7), ph: rand(0, Math.PI * 2),
        });
      }
      nebulae = [0, 1].map((i) => ({
        x: rand(0.15, 0.85) * W, y: rand(0.1, 0.9) * H,
        r: rand(0.32, 0.5) * Math.max(W, H),
        hue: i === 1 ? "20,90,120" : "18,110,70",
        a: rand(0.03, 0.05),
        vx: rand(-1.1, 1.1), vy: rand(-0.7, 0.7),
      }));
    };
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      W = space.width = Math.round(innerWidth * dpr * 0.66);
      H = space.height = Math.round(innerHeight * dpr * 0.66);
      seed();
      if (reduceMotion) drawFrame(0, 0);
    };

    function drawFrame(t, dt) {
      ctx.clearRect(0, 0, W, H);
      for (const n of nebulae) {
        if (dt) {
          n.x += n.vx * dt; n.y += n.vy * dt;
          if (n.x < -n.r) n.x = W + n.r; if (n.x > W + n.r) n.x = -n.r;
          if (n.y < -n.r) n.y = H + n.r; if (n.y > H + n.r) n.y = -n.r;
        }
        const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r);
        g.addColorStop(0, `rgba(${n.hue},${n.a})`);
        g.addColorStop(1, `rgba(${n.hue},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(n.x - n.r, n.y - n.r, n.r * 2, n.r * 2);
      }
      for (const s of stars) {
        if (dt) {
          s.x -= (0.4 + s.depth * 1.6) * dt;              // slow parallax drift
          if (s.x < -2) { s.x = W + 2; s.y = Math.random() * H; }
        }
        const a = reduceMotion ? s.base : s.base * (0.75 + 0.25 * Math.sin(t * s.tw + s.ph));
        ctx.fillStyle = `rgba(${s.hue},${a})`;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
      }
    }

    let frameReq = 0;
    const loop = (now) => {
      if (!running) return;
      const t = now / 1000;
      const dt = Math.min(0.1, lastT ? t - lastT : 0.016);
      lastT = t;
      drawFrame(t, dt);
      frameReq = requestAnimationFrame(loop);
    };
    const setRunning = (on) => {
      if (reduceMotion) return;              // static frame only
      if (on && !running) { running = true; lastT = 0; frameReq = requestAnimationFrame(loop); }
      if (!on && running) { running = false; cancelAnimationFrame(frameReq); }
    };
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", () => setRunning(!document.hidden));
    resize();
    setRunning(true);
  }

  /* ===================== command dock ===================== */
  const dock = document.querySelector("[data-bridge-dock]");
  const sigil = dock?.querySelector(".bridge-sigil");
  const sidebar = document.querySelector(".sidebar");
  const navMain = document.querySelector("[data-nav]");
  if (dock && sidebar && navMain) {
    const left = dock.querySelector("[data-bridge-dock-left]");
    const right = dock.querySelector("[data-bridge-dock-right]");
    const DOCK_SLOTS = 6;                     // shortcuts mirrored from the nav

    const buildDock = () => {
      const items = [...navMain.querySelectorAll(".nav-item:not(.nav-item-disabled)")].slice(0, DOCK_SLOTS);
      if (!items.length) return;
      const btn = (item) => {
        const id = item.dataset.navId;
        const icon = item.querySelector(".ic")?.outerHTML || "";
        const label = item.querySelector("span")?.textContent || id;
        const badge = item.querySelector(".nav-badge")?.textContent || "";
        const active = item.classList.contains("is-active");
        return `<button class="bridge-dock-btn ${active ? "is-active" : ""}" data-nav-id="${id}" type="button" aria-label="${label}" ${active ? 'aria-current="page"' : ""}>
          ${icon}<span>${label}</span>${badge ? `<em class="bridge-dock-badge">${badge}</em>` : ""}
        </button>`;
      };
      const half = Math.ceil(items.length / 2);
      left.innerHTML = items.slice(0, half).map(btn).join("");
      right.innerHTML = items.slice(half).map(btn).join("") +
        `<button class="bridge-dock-btn bridge-dock-cmdk" data-cmdk-open type="button" aria-label="Open command palette">
          <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <span>⌘K</span>
        </button>`;
      dock.hidden = !desktop();
    };

    const syncExpanded = () => {
      const open = sidebar.classList.contains("is-expanded");
      sigil?.setAttribute("aria-expanded", String(open));
    };

    // Mirror whatever main.js paints — renderNav rewrites the nav's innerHTML
    // on every route change, so one observer keeps the dock truthful.
    let raf = 0;
    const scheduleBuild = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { buildDock(); syncExpanded(); }); };
    new MutationObserver(scheduleBuild).observe(navMain, { childList: true, subtree: true });
    new MutationObserver(syncExpanded).observe(sidebar, { attributes: true, attributeFilter: ["class"] });
    window.addEventListener("resize", scheduleBuild);
    buildDock();
    syncExpanded();
  }
})();
