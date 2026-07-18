/* Phantom Pizzeria — an original pizza-shop time-management game for
 * PhantomPlay. Genre staples (order ticket → build → bake → serve,
 * scored on accuracy + timing + speed, day progression) with our own
 * characters, art, and tuning throughout.
 *
 * Orders are generated from a deterministic seeded PRNG (mulberry32,
 * same approach as BeatStrike) so any day's order sequence is exactly
 * reproducible — which is also what makes the automated verification
 * meaningful.
 */
(function () {
  "use strict";

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const TOPPINGS = [
    { id: "pepperoni", name: "Pepperoni", emoji: "🔴", unlockDay: 1 },
    { id: "mushroom", name: "Mushrooms", emoji: "🍄", unlockDay: 1 },
    { id: "olive", name: "Olives", emoji: "🫒", unlockDay: 2 },
    { id: "pepper", name: "Peppers", emoji: "🫑", unlockDay: 3 },
    { id: "onion", name: "Onions", emoji: "🧅", unlockDay: 4 },
    { id: "pineapple", name: "Pineapple", emoji: "🍍", unlockDay: 5 },
  ];
  const CUSTOMERS = ["Wisp", "Boo-Boo", "Sir Spooksalot", "Mabel the Mist", "Grim Jim", "Phanny", "Old Howler", "Little Echo"];
  const ORDERS_PER_DAY = 5;
  const BAKE_WINDOWS = { light: [0.30, 0.50], regular: [0.50, 0.72], "well-done": [0.72, 0.92] };

  // ---------------------------------------------------------------------
  // Run state
  // ---------------------------------------------------------------------
  const SAVE_KEY = "pf.pizzeria.v1";
  function loadBest() { try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || { bestCoins: 0, bestDay: 0 }; } catch { return { bestCoins: 0, bestDay: 0 }; } }
  function saveBest(b) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(b)); } catch {} }
  let best = loadBest();

  let day = 1, coins = 0, served = 0;
  let rng = mulberry32(1);
  let order = null;        // current order {customer, toppings:{id:count}, bake, patienceMs}
  let built = [];          // toppings placed, in placement order [{id,x,y}]
  let sauced = true, cheesed = true; // base always sauce+cheese (kept simple, accuracy is toppings+bake)
  let phase = "menu";      // menu | build | oven | day-end
  let orderStartedAt = 0;
  let patienceTimer = null;
  let ovenT = 0, ovenRunning = false, ovenRaf = 0, ovenSpeed = 0.22; // fraction/sec
  let dayReport = [];

  function availableToppings() { return TOPPINGS.filter((t) => t.unlockDay <= day); }

  function newOrder() {
    const avail = availableToppings();
    const kinds = 1 + Math.floor(rng() * Math.min(3, avail.length));
    const picked = [...avail].sort(() => rng() - 0.5).slice(0, kinds);
    const toppings = {};
    for (const t of picked) toppings[t.id] = 2 + Math.floor(rng() * 3); // 2-4 each
    const bakes = Object.keys(BAKE_WINDOWS);
    order = {
      customer: CUSTOMERS[Math.floor(rng() * CUSTOMERS.length)],
      toppings,
      bake: bakes[Math.floor(rng() * bakes.length)],
      patienceMs: Math.max(26000, 46000 - day * 3000),
    };
    built = [];
    phase = "build";
    orderStartedAt = performance.now();
    startPatience();
    renderAll();
  }

  function startPatience() {
    clearInterval(patienceTimer);
    patienceTimer = setInterval(() => {
      const left = 1 - (performance.now() - orderStartedAt) / order.patienceMs;
      patienceEl.style.width = `${Math.max(0, left * 100)}%`;
      if (left <= 0) clearInterval(patienceTimer);
    }, 250);
  }

  // ---------------------------------------------------------------------
  // Scoring
  // ---------------------------------------------------------------------
  function scoreOrder(bakePos) {
    // topping accuracy
    const placedCount = {};
    for (const t of built) placedCount[t.id] = (placedCount[t.id] || 0) + 1;
    let want = 0, gotRight = 0, extras = 0;
    for (const [id, n] of Object.entries(order.toppings)) {
      want += n;
      gotRight += Math.min(n, placedCount[id] || 0);
    }
    for (const [id, n] of Object.entries(placedCount)) {
      extras += Math.max(0, n - (order.toppings[id] || 0));
    }
    const accuracy = want === 0 ? 1 : Math.max(0, (gotRight - extras * 0.5) / want);

    // bake timing
    const [lo, hi] = BAKE_WINDOWS[order.bake];
    let bakeScore, bakeVerdict;
    if (bakePos >= lo && bakePos <= hi) { bakeScore = 1; bakeVerdict = "perfect"; }
    else if (bakePos < lo) { bakeScore = Math.max(0, 1 - (lo - bakePos) * 3); bakeVerdict = "underbaked"; }
    else { bakeScore = Math.max(0, 1 - (bakePos - hi) * 3); bakeVerdict = "burnt"; }

    // speed (patience remaining)
    const speedScore = Math.max(0, 1 - (performance.now() - orderStartedAt) / order.patienceMs);

    const total = Math.round(accuracy * 50 + bakeScore * 35 + speedScore * 15);
    return { accuracy, bakeScore, bakeVerdict, speedScore, coins: total };
  }

  // ---------------------------------------------------------------------
  // DOM
  // ---------------------------------------------------------------------
  const $ = (s) => document.querySelector(s);
  const dayEl = $("[data-day]"), coinsEl = $("[data-coins]"), servedEl = $("[data-served]");
  const customerEl = $("[data-customer]"), ticketLinesEl = $("[data-ticket-lines]"), ticketBakeEl = $("[data-ticket-bake]");
  const patienceEl = $("[data-patience]");
  const pizzaView = $("[data-pizza-view]"), pizzaBase = $("[data-pizza-base]");
  const toppingBar = $("[data-topping-bar]");
  const ovenZone = $("[data-oven-zone]"), ovenNeedle = $("[data-oven-needle]"), ovenLabel = $("[data-oven-label]");
  const pullBtn = $("[data-pull-btn]"), toOvenBtn = $("[data-to-oven-btn]"), undoBtn = $("[data-undo-btn]");
  const toast = $("[data-toast]");
  const menuOverlay = $("[data-menu-overlay]"), dayOverlay = $("[data-day-overlay]");

  function renderHud() {
    dayEl.textContent = String(day);
    coinsEl.textContent = String(coins);
    servedEl.textContent = `${served}/${ORDERS_PER_DAY}`;
  }

  function renderTicket() {
    if (!order) return;
    customerEl.textContent = `${order.customer} orders:`;
    ticketLinesEl.innerHTML = Object.entries(order.toppings).map(([id, n]) => {
      const t = TOPPINGS.find((x) => x.id === id);
      return `<li>${t.emoji} ${t.name} × ${n}</li>`;
    }).join("");
    ticketBakeEl.textContent = order.bake;
  }

  function renderPizza() {
    pizzaBase.className = "pizza-base" + (sauced ? " sauced" : "") + (cheesed ? " cheesed" : "");
    pizzaView.querySelectorAll(".top-piece").forEach((el) => el.remove());
    for (const t of built) {
      const def = TOPPINGS.find((x) => x.id === t.id);
      const el = document.createElement("span");
      el.className = "top-piece";
      el.style.left = `${t.x}%`; el.style.top = `${t.y}%`;
      el.textContent = def.emoji;
      pizzaView.appendChild(el);
    }
  }

  function renderToppingBar() {
    toppingBar.innerHTML = availableToppings().map((t) =>
      `<button class="top-btn" data-top="${t.id}" ${phase !== "build" ? "disabled" : ""}>${t.emoji} ${t.name}</button>`).join("");
  }

  function renderOven() {
    const [lo, hi] = order ? BAKE_WINDOWS[order.bake] : [0, 0];
    ovenZone.style.left = `${lo * 100}%`;
    ovenZone.style.width = `${(hi - lo) * 100}%`;
    ovenNeedle.style.left = `${ovenT * 100}%`;
    ovenLabel.textContent = phase === "oven" ? (ovenT < lo ? "Baking…" : ovenT <= hi ? "IN THE WINDOW — pull now!" : "BURNING!") : "Empty";
    pullBtn.disabled = phase !== "oven";
  }

  function renderAll() { renderHud(); renderTicket(); renderPizza(); renderToppingBar(); renderOven(); }

  function showToast(msg, ms = 2200) {
    toast.textContent = msg;
    toast.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { toast.hidden = true; }, ms);
  }

  // ---------------------------------------------------------------------
  // Interactions
  // ---------------------------------------------------------------------
  toppingBar.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-top]");
    if (!btn || phase !== "build") return;
    const ang = rng() * Math.PI * 2, rad = 12 + rng() * 24;
    built.push({ id: btn.dataset.top, x: 50 + Math.cos(ang) * rad - 6, y: 47 + Math.sin(ang) * rad - 6 });
    renderPizza();
  });
  undoBtn.addEventListener("click", () => { if (phase === "build") { built.pop(); renderPizza(); } });

  toOvenBtn.addEventListener("click", () => {
    if (phase !== "build") return;
    phase = "oven";
    ovenT = 0; ovenRunning = true;
    let last = performance.now();
    const tick = (now) => {
      if (!ovenRunning) return;
      ovenT = Math.min(1, ovenT + (now - last) / 1000 * ovenSpeed);
      last = now;
      renderOven();
      if (ovenT >= 1) { ovenRunning = false; servePizza(1); return; } // fully burnt, auto-fail serve
      ovenRaf = requestAnimationFrame(tick);
    };
    ovenRaf = requestAnimationFrame(tick);
    renderToppingBar(); renderOven();
  });

  pullBtn.addEventListener("click", () => {
    if (phase !== "oven") return;
    ovenRunning = false;
    cancelAnimationFrame(ovenRaf);
    servePizza(ovenT);
  });

  function servePizza(bakePos) {
    clearInterval(patienceTimer);
    const r = scoreOrder(bakePos);
    coins += r.coins;
    served++;
    dayReport.push({ customer: order.customer, coins: r.coins, verdict: r.bakeVerdict, accuracy: Math.round(r.accuracy * 100) });
    pizzaBase.classList.add(r.bakeVerdict === "perfect" ? "baked-good" : r.bakeVerdict === "burnt" ? "baked-burnt" : "baked-raw");
    showToast(`${order.customer}: ${r.coins} coins — ${Math.round(r.accuracy * 100)}% toppings, bake ${r.bakeVerdict}`);
    phase = "between";
    renderHud();
    setTimeout(() => {
      if (served >= ORDERS_PER_DAY) endDay();
      else newOrder();
    }, 1400);
  }

  function endDay() {
    phase = "day-end";
    $("[data-day-title]").textContent = `Day ${day} Complete!`;
    const total = dayReport.reduce((s, r) => s + r.coins, 0);
    $("[data-day-report]").innerHTML = dayReport.map((r) =>
      `<div class="report-row"><span>${r.customer} · ${r.accuracy}% · ${r.verdict}</span><b>+${r.coins}</b></div>`).join("") +
      `<div class="report-row report-total"><span>Day total</span><b>+${total}</b></div>`;
    if (coins > best.bestCoins || day > best.bestDay) { best = { bestCoins: Math.max(best.bestCoins, coins), bestDay: Math.max(best.bestDay, day) }; saveBest(best); }
    dayOverlay.hidden = false;
  }

  function startDay(n) {
    day = n; served = 0; dayReport = [];
    rng = mulberry32(1000 + day * 77);   // deterministic per-day order sequence
    ovenSpeed = 0.20 + day * 0.02;       // oven runs hotter as days pass
    menuOverlay.hidden = true;
    dayOverlay.hidden = true;
    newOrder();
  }

  $("[data-start-btn]").addEventListener("click", () => { coins = 0; startDay(1); });
  $("[data-next-day-btn]").addEventListener("click", () => startDay(day + 1));
  $("[data-day-menu-btn]").addEventListener("click", () => { dayOverlay.hidden = true; menuOverlay.hidden = false; showBest(); });
  $("[data-menu-btn]").addEventListener("click", () => { clearInterval(patienceTimer); ovenRunning = false; menuOverlay.hidden = false; showBest(); });

  function showBest() {
    const line = $("[data-best-line]");
    if (best.bestCoins > 0) { line.hidden = false; line.textContent = `BEST RUN: ${best.bestCoins} coins · reached day ${best.bestDay}`; }
  }
  showBest();

  /* Test hook — drives the same handlers the player uses. */
  window.__PizzeriaTest = {
    start() { coins = 0; startDay(1); },
    getOrder() { return order ? { customer: order.customer, toppings: { ...order.toppings }, bake: order.bake } : null; },
    addTopping(id) { const btn = toppingBar.querySelector(`[data-top="${id}"]`); if (btn) btn.click(); },
    toOven() { toOvenBtn.click(); },
    setOvenPos(t) { ovenT = t; },     // test-only: jump the needle
    pull() { pullBtn.click(); },
    state() { return { day, coins, served, phase, ovenT }; },
  };
})();
