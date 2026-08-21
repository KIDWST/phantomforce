/* Phantom Empires: Sovereign — a complete browser-native RTS for PhantomPlay.
 * The supplied Unreal concept sheet is the creative brief. This build uses the
 * shared PhantomPlay strategy runtime so the same game is playable in web and
 * desktop today; it never claims a native engine it is not running.
 */
(function () {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const canvas = $("#empire");
  const ctx = canvas.getContext("2d", { alpha: false });
  const minimap = $("#minimap");
  const mctx = minimap.getContext("2d");
  const embedded = window.parent !== window;
  const host = (type, data = {}) => {
    if (!embedded) return;
    try { parent.postMessage({ source: "phantomplay-game", type, ...data }, "*"); } catch { /* host is optional */ }
  };
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const lerp = (a, b, t) => a + (b - a) * t;
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const angleTo = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
  const rand = (a, b) => a + Math.random() * (b - a);
  const WORLD = { w: 3200, h: 2100, riverLeft: 1480, riverRight: 1740, bridges: [[460, 610], [1320, 1470]] };
  const SAVE_KEY = "phantom-empires-sovereign-v1";

  const UNIT = {
    worker: { label: "Villager", glyph: "V", hp: 72, speed: 82, attack: 5, range: 22, rate: 1.15, cost: { food: 45 }, pop: 1, train: 5, color: "#e7d4a4" },
    sword: { label: "Vanguard", glyph: "S", hp: 145, speed: 74, attack: 18, range: 26, rate: .88, cost: { food: 55, gold: 28 }, pop: 1, train: 7, color: "#d8e2ed" },
    archer: { label: "Longbow", glyph: "A", hp: 92, speed: 78, attack: 14, range: 175, rate: 1.15, cost: { wood: 42, gold: 32 }, pop: 1, train: 8, projectile: true, color: "#95d8ac" },
    cavalry: { label: "Sun Rider", glyph: "C", hp: 205, speed: 118, attack: 25, range: 30, rate: 1.05, cost: { food: 90, gold: 65 }, pop: 2, train: 11, color: "#f4c96d" },
    catapult: { label: "Starfall", glyph: "K", hp: 190, speed: 43, attack: 62, range: 245, rate: 3.2, cost: { wood: 115, gold: 85, stone: 55 }, pop: 3, train: 16, projectile: true, siege: true, color: "#d39b62" },
    ship: { label: "War Galley", glyph: "G", hp: 280, speed: 86, attack: 31, range: 205, rate: 1.9, cost: { wood: 135, gold: 70 }, pop: 3, train: 14, projectile: true, naval: true, color: "#7ed5e8" },
  };

  const BUILDING = {
    citadel: { label: "Citadel", glyph: "C", hp: 1800, size: 74, cost: {}, age: 1, color: "#d7c18d" },
    house: { label: "House", glyph: "H", hp: 390, size: 38, cost: { wood: 75 }, age: 1, pop: 6, color: "#b98c61" },
    barracks: { label: "Barracks", glyph: "B", hp: 720, size: 50, cost: { wood: 120, stone: 45 }, age: 1, trains: ["sword"], color: "#9f7050" },
    range: { label: "Archery Range", glyph: "R", hp: 610, size: 48, cost: { wood: 135, gold: 25 }, age: 1, trains: ["archer"], color: "#7d8c62" },
    stable: { label: "Royal Stable", glyph: "S", hp: 760, size: 54, cost: { wood: 150, gold: 70 }, age: 2, trains: ["cavalry"], color: "#bd9257" },
    workshop: { label: "Siege Works", glyph: "W", hp: 860, size: 58, cost: { wood: 180, gold: 85, stone: 90 }, age: 2, trains: ["catapult"], color: "#a47754" },
    dock: { label: "War Dock", glyph: "D", hp: 760, size: 55, cost: { wood: 170, gold: 50 }, age: 2, trains: ["ship"], water: true, color: "#5f8790" },
    tower: { label: "Watchtower", glyph: "T", hp: 920, size: 40, attack: 18, range: 235, rate: 1.35, cost: { wood: 85, stone: 125 }, age: 2, color: "#8b8f89" },
    wall: { label: "Rampart", glyph: "▥", hp: 780, size: 30, cost: { stone: 45 }, age: 1, color: "#868985" },
    market: { label: "Grand Market", glyph: "M", hp: 650, size: 48, cost: { wood: 100, gold: 80 }, age: 2, income: true, color: "#b69c63" },
  };

  const AGE = [
    { label: "FOUNDING", cost: null },
    { label: "IRON CROWN", cost: { food: 360, gold: 210 } },
    { label: "IMPERIAL", cost: { food: 620, gold: 450, stone: 260 } },
    { label: "SOVEREIGN", cost: { food: 900, gold: 700, stone: 480 } },
  ];

  const BUILD_ORDERS = ["house", "barracks", "range", "stable", "workshop", "dock", "tower", "wall", "market"];
  const TRAIN_ORDERS = ["worker", "sword", "archer", "cavalry", "catapult", "ship"];
  const TUTORIAL = [
    { title: "Command the frontier", copy: "Drag across your units to select them. Right-click anywhere to move, attack, gather, or construct. WASD pans the war camera and the wheel zooms.", art: "SELECT · MOVE · CONQUER" },
    { title: "Build a living economy", copy: "Select Villagers and right-click berries, forests, gold, or stone. Build Houses to raise population and military structures to unlock armies.", art: "FOOD · WOOD · GOLD · STONE" },
    { title: "Control land and sea", copy: "The river divides the empires. Bridges are strategic chokepoints. Build a War Dock beside the water and launch Galleys to own the crossings.", art: "BRIDGES · DOCKS · WAR GALLEYS" },
    { title: "Break the rival crown", copy: "Advance through four Ages, combine infantry, cavalry, archers, siege and ships, then destroy the crimson Citadel. Your empire saves automatically.", art: "4 AGES · ONE CROWN" },
  ];

  let W = 0, H = 0, DPR = 1;
  let nextId = 1;
  let phase = "title";
  let mode = "campaign";
  let last = performance.now();
  let uiTick = 0;
  let saveTick = 0;
  let reportTick = 0;
  let aiTick = 0;
  let elapsed = 0;
  let resultSent = false;
  let muted = false;
  let reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let commandTab = "build";
  let buildMode = null;
  let attackMove = false;
  let drag = null;
  let tutorialIndex = 0;
  let selected = new Set();
  let controlGroups = Array.from({ length: 6 }, () => []);
  let keys = new Set();
  let camera = { x: 680, y: 1020, zoom: .72, shake: 0 };
  let resources = { food: 430, wood: 410, gold: 260, stone: 220 };
  let age = 1;
  let score = 0;
  let units = [];
  let buildings = [];
  let nodes = [];
  let projectiles = [];
  let particles = [];
  let decals = [];
  let training = [];
  let feed = [];
  let weather = { type: "clear", timer: 42, lightning: 0 };
  let audio = null;

  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = innerWidth; H = innerHeight;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  addEventListener("resize", resize); resize();

  function createAudio() {
    if (audio || muted) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audio = new AC();
  }
  function sfx(kind, strength = 1) {
    if (muted) return;
    createAudio();
    if (!audio) return;
    const now = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    const filter = audio.createBiquadFilter();
    const sounds = {
      click: [310, 480, .055, "triangle"], build: [120, 70, .22, "square"], sword: [520, 160, .1, "sawtooth"], arrow: [690, 260, .13, "triangle"], siege: [78, 36, .42, "square"], death: [170, 65, .25, "sawtooth"], age: [220, 880, .85, "sine"], victory: [330, 990, 1.3, "triangle"], alarm: [180, 145, .5, "square"], gather: [260, 330, .06, "sine"], thunder: [54, 24, .9, "sawtooth"], naval: [105, 54, .32, "triangle"],
    };
    const spec = sounds[kind] || sounds.click;
    osc.type = spec[3]; osc.frequency.setValueAtTime(spec[0], now); osc.frequency.exponentialRampToValueAtTime(Math.max(20, spec[1]), now + spec[2]);
    filter.type = "lowpass"; filter.frequency.value = kind === "thunder" ? 280 : 1700;
    gain.gain.setValueAtTime(.0001, now); gain.gain.exponentialRampToValueAtTime(.055 * strength, now + .012); gain.gain.exponentialRampToValueAtTime(.0001, now + spec[2]);
    osc.connect(filter).connect(gain).connect(audio.destination); osc.start(now); osc.stop(now + spec[2] + .04);
  }

  function worldToScreen(x, y) {
    return { x: (x - camera.x) * camera.zoom + W / 2, y: (y - camera.y) * camera.zoom + H / 2 };
  }
  function screenToWorld(x, y) {
    return { x: (x - W / 2) / camera.zoom + camera.x, y: (y - H / 2) / camera.zoom + camera.y };
  }
  function visiblePoint(x, y, margin = 100) {
    const p = worldToScreen(x, y);
    return p.x > -margin && p.x < W + margin && p.y > -margin && p.y < H + margin;
  }
  function id(prefix) { return `${prefix}-${nextId++}`; }
  function teamColor(team) { return team === "player" ? "#65b8ff" : "#f05b54"; }
  function population(team = "player") { return units.filter((unit) => unit.team === team && unit.hp > 0).reduce((sum, unit) => sum + UNIT[unit.type].pop, 0); }
  function populationCap(team = "player") {
    return buildings.filter((building) => building.team === team && building.hp > 0).reduce((sum, building) => sum + (building.type === "citadel" ? 12 : BUILDING[building.type].pop || 0), 0);
  }
  function canAfford(cost) { return Object.entries(cost || {}).every(([key, value]) => resources[key] >= value); }
  function spend(cost) { for (const [key, value] of Object.entries(cost || {})) resources[key] -= value; }
  function formatCost(cost) { return Object.entries(cost || {}).map(([key, value]) => `${key[0].toUpperCase()}${value}`).join(" · ") || "FREE"; }

  function addFeed(text, tone = "") {
    feed.unshift({ id: id("feed"), text, tone, life: 5 });
    feed = feed.slice(0, 4);
    renderFeed();
  }
  function renderFeed() {
    $("[data-event-feed]").innerHTML = feed.map((item) => `<p class="${item.tone ? `is-${item.tone}` : ""}">${escapeHtml(item.text)}</p>`).join("");
  }
  function announce(text) {
    const el = $("[data-announcer]");
    el.textContent = text;
    el.classList.remove("is-live");
    void el.offsetWidth;
    el.classList.add("is-live");
  }
  function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

  function addNode(type, x, y, amount = 1000) {
    nodes.push({ id: id("node"), type, x, y, amount, max: amount, r: type === "wood" ? 30 : 21 });
  }
  function addUnit(type, team, x, y) {
    const def = UNIT[type];
    const unit = { id: id("unit"), type, team, x, y, vx: 0, vy: 0, facing: team === "player" ? 0 : Math.PI, hp: def.hp, maxHp: def.hp, cooldown: rand(0, .4), targetX: x, targetY: y, targetId: null, order: "idle", carry: 0, carryType: null, gatherNodeId: null, veteran: 0, flash: 0, wake: [] };
    units.push(unit); return unit;
  }
  function addBuilding(type, team, x, y, complete = true) {
    const def = BUILDING[type];
    const building = { id: id("building"), type, team, x, y, hp: complete ? def.hp : Math.max(40, def.hp * .12), maxHp: def.hp, construction: complete ? 1 : .08, cooldown: 0, flash: 0 };
    buildings.push(building); return building;
  }

  function resetWorld(nextMode = "campaign") {
    mode = nextMode; nextId = 1; elapsed = 0; score = 0; age = nextMode === "sandbox" ? 3 : 1; resultSent = false;
    resources = nextMode === "sandbox" ? { food: 4000, wood: 4000, gold: 4000, stone: 4000 } : nextMode === "skirmish" ? { food: 700, wood: 650, gold: 480, stone: 400 } : { food: 430, wood: 410, gold: 260, stone: 220 };
    units = []; buildings = []; nodes = []; projectiles = []; particles = []; decals = []; training = []; feed = []; selected.clear(); controlGroups = Array.from({ length: 6 }, () => []);
    weather = { type: "clear", timer: 38, lightning: 0 }; aiTick = nextMode === "skirmish" ? 18 : 30;
    camera = { x: 690, y: 1080, zoom: innerWidth < 700 ? .48 : .72, shake: 0 };
    addBuilding("citadel", "player", 510, 1110);
    addBuilding("house", "player", 670, 1000);
    addBuilding("barracks", "player", 690, 1190);
    addUnit("worker", "player", 555, 1020); addUnit("worker", "player", 590, 1060); addUnit("worker", "player", 560, 1160); addUnit("sword", "player", 750, 1110); addUnit("archer", "player", 780, 1160);
    addBuilding("citadel", "enemy", 2710, 990);
    addBuilding("house", "enemy", 2530, 890); addBuilding("barracks", "enemy", 2520, 1070); addBuilding("tower", "enemy", 2350, 860); addBuilding("tower", "enemy", 2370, 1210);
    addUnit("sword", "enemy", 2430, 1010); addUnit("sword", "enemy", 2460, 1060); addUnit("archer", "enemy", 2480, 950);
    const clusters = [
      ["food", 780, 830], ["food", 860, 880], ["food", 1030, 1520], ["food", 2140, 500], ["food", 2390, 1450],
      ["gold", 970, 1130], ["gold", 1210, 520], ["gold", 2100, 1080], ["gold", 2600, 1510],
      ["stone", 930, 1380], ["stone", 1260, 1650], ["stone", 2020, 650], ["stone", 2430, 720],
    ];
    clusters.forEach(([type, x, y]) => { for (let i = 0; i < 3; i++) addNode(type, x + rand(-50, 50), y + rand(-50, 50), 720); });
    for (let i = 0; i < 38; i++) {
      const side = i % 2 ? rand(120, 1330) : rand(1870, 3070);
      addNode("wood", side, rand(180, 1900), 900);
    }
    addFeed("The blue crown answers your command.", "good");
    addFeed("Crimson scouts hold the eastern frontier.", "danger");
  }

  function showGame() {
    phase = "playing";
    $("[data-title-screen]").hidden = true; $("[data-pause-screen]").hidden = true; $("[data-result-screen]").hidden = true;
    $("[data-hud]").hidden = false; $("[data-mission]").hidden = false; $("[data-command-deck]").hidden = false;
    $("[data-touch-bar]").hidden = !matchMedia("(pointer: coarse)").matches;
    updateUI(true); host("ready", { version: "1.0.0", mode });
  }
  function startGame(nextMode, tutorial = true) {
    createAudio(); resetWorld(nextMode); showGame();
    announce(nextMode === "sandbox" ? "ARCHITECT MODE" : nextMode === "skirmish" ? "FRONTIER WAR" : "THE SOVEREIGN CAMPAIGN");
    if (tutorial && nextMode === "campaign" && !localStorage.getItem(`${SAVE_KEY}:tutorial`)) showTutorial(0);
  }

  function showTutorial(index) {
    tutorialIndex = index;
    const item = TUTORIAL[index];
    $("[data-tutorial-step]").textContent = `WAR COUNCIL · ${index + 1} / ${TUTORIAL.length}`;
    $("[data-tutorial-title]").textContent = item.title;
    $("[data-tutorial-copy]").textContent = item.copy;
    $("[data-tutorial-visual]").textContent = item.art;
    $("[data-tutorial-next]").textContent = index === TUTORIAL.length - 1 ? "Begin campaign" : "Next";
    $("[data-tutorial]").hidden = false;
    phase = "tutorial";
  }
  function closeTutorial() { $("[data-tutorial]").hidden = true; localStorage.setItem(`${SAVE_KEY}:tutorial`, "1"); phase = "playing"; }

  function entityById(entityId) { return units.find((unit) => unit.id === entityId) || buildings.find((building) => building.id === entityId) || nodes.find((node) => node.id === entityId); }
  function ownSelected() { return [...selected].map(entityById).filter((entity) => entity && entity.team === "player" && entity.hp > 0); }
  function selectedUnits() { return ownSelected().filter((entity) => entity.id.startsWith("unit")); }
  function selectedBuildings() { return ownSelected().filter((entity) => entity.id.startsWith("building")); }
  function selectEntities(entities, additive = false) {
    if (!additive) selected.clear();
    entities.filter((entity) => entity.team === "player" && entity.hp > 0).forEach((entity) => selected.add(entity.id));
    updateUI(true); sfx("click", .35);
  }

  function unitAllowed(type) {
    return type === "worker" || (type === "sword" || type === "archer") && age >= 1 || (type === "cavalry" || type === "catapult" || type === "ship") && age >= 2;
  }
  function trainingBuilding(type) {
    const picked = selectedBuildings().find((building) => building.construction >= 1 && (type === "worker" ? building.type === "citadel" : BUILDING[building.type].trains?.includes(type)));
    return picked || buildings.find((building) => building.team === "player" && building.hp > 0 && building.construction >= 1 && (type === "worker" ? building.type === "citadel" : BUILDING[building.type].trains?.includes(type)));
  }
  function trainUnit(type) {
    const def = UNIT[type]; const building = trainingBuilding(type);
    if (!unitAllowed(type)) return addFeed(`${def.label} unlocks in a later Age.`, "danger");
    if (!building) return addFeed(`Build the required training structure first.`, "danger");
    if (!canAfford(def.cost)) return addFeed(`Not enough resources for ${def.label}.`, "danger");
    if (population() + def.pop > populationCap()) return addFeed("Population capped. Raise more Houses.", "danger");
    spend(def.cost); training.push({ id: id("training"), type, buildingId: building.id, remaining: def.train, total: def.train });
    addFeed(`${def.label} training begun.`); sfx("click"); updateUI(true);
  }
  function beginBuild(type) {
    const def = BUILDING[type];
    if (age < def.age) return addFeed(`${def.label} unlocks in Age ${def.age}.`, "danger");
    if (!selectedUnits().some((unit) => unit.type === "worker")) return addFeed("Select at least one Villager to construct.", "danger");
    if (!canAfford(def.cost)) return addFeed(`Not enough resources for ${def.label}.`, "danger");
    buildMode = type; attackMove = false; updateUI(true); announce(`PLACE ${def.label.toUpperCase()}`);
  }
  function placeBuilding(type, point) {
    const def = BUILDING[type];
    const inWater = point.x > WORLD.riverLeft - 35 && point.x < WORLD.riverRight + 35;
    if (def.water ? !inWater : inWater && !onBridge(point.y)) return addFeed(def.water ? "War Docks must touch the river." : "That ground is water.", "danger");
    if (buildings.some((building) => distance(building, point) < BUILDING[building.type].size + def.size + 18)) return addFeed("Another structure blocks that ground.", "danger");
    spend(def.cost); const building = addBuilding(type, "player", clamp(point.x, 70, WORLD.w - 70), clamp(point.y, 90, WORLD.h - 90), false);
    selectedUnits().filter((unit) => unit.type === "worker").forEach((unit) => { unit.targetId = building.id; unit.targetX = building.x; unit.targetY = building.y; unit.order = "build"; });
    selected.clear(); selected.add(building.id); buildMode = null; addFeed(`${def.label} foundation placed.`, "good"); sfx("build"); burst(point.x, point.y, "#e7b85a", 18, 90); updateUI(true);
  }
  function advanceAge() {
    if (age >= 4) return addFeed("The Sovereign Age is already yours.", "good");
    const target = AGE[age];
    if (!canAfford(target.cost)) return addFeed(`Age ${age + 1} requires ${formatCost(target.cost)}.`, "danger");
    spend(target.cost); age += 1; announce(`AGE ${roman(age)} · ${AGE[age - 1].label}`); addFeed(`Your civilization entered the ${AGE[age - 1].label} Age.`, "good"); sfx("age"); score += 500 * age; updateUI(true);
  }
  function roman(value) { return ["I", "II", "III", "IV"][value - 1] || String(value); }

  function renderCommands() {
    const grid = $("[data-command-grid]");
    const orders = commandTab === "build" ? BUILD_ORDERS.map((type) => ({ type, def: BUILDING[type], action: "build" }))
      : commandTab === "train" ? TRAIN_ORDERS.map((type) => ({ type, def: UNIT[type], action: "train" }))
        : [
          { type: "age", label: age >= 4 ? "Sovereign Age" : `Advance to Age ${roman(age + 1)}`, cost: age >= 4 ? {} : AGE[age].cost, action: "realm", disabled: age >= 4 },
          { type: "army", label: "Select Army", cost: {}, action: "realm" },
          { type: "workers", label: "Select Villagers", cost: {}, action: "realm" },
          { type: "home", label: "Center Citadel", cost: {}, action: "realm" },
          { type: "save", label: "Save Empire", cost: {}, action: "realm" },
          { type: "mute", label: muted ? "Sound Off" : "Sound On", cost: {}, action: "realm" },
        ];
    grid.innerHTML = orders.map((item) => {
      const def = item.def || item;
      const locked = item.disabled || (item.action === "build" && age < def.age) || (item.action === "train" && !unitAllowed(item.type));
      const active = buildMode === item.type;
      return `<button type="button" class="order ${active ? "is-active" : ""}" data-order-action="${item.action}" data-order-type="${item.type}" ${locked ? "disabled" : ""}><b>${escapeHtml(def.label)}</b><small>${locked ? `AGE ${def.age || 2}` : item.action === "train" ? `${def.train}s · ${def.pop} pop` : item.action === "build" ? `Structure · ${def.hp} HP` : "Realm command"}</small><em>${escapeHtml(formatCost(def.cost))}</em></button>`;
    }).join("");
    $$('[data-order-action]').forEach((button) => button.onclick = () => {
      const { orderAction, orderType } = button.dataset;
      if (orderAction === "build") beginBuild(orderType);
      else if (orderAction === "train") trainUnit(orderType);
      else realmCommand(orderType);
    });
  }
  function realmCommand(type) {
    if (type === "age") advanceAge();
    if (type === "army") selectEntities(units.filter((unit) => unit.team === "player" && unit.type !== "worker"));
    if (type === "workers") selectEntities(units.filter((unit) => unit.team === "player" && unit.type === "worker"));
    if (type === "home") centerHome();
    if (type === "save") saveGame(true);
    if (type === "mute") { muted = !muted; renderCommands(); addFeed(muted ? "Sound muted." : "Sound restored."); }
  }
  function centerHome() { const home = buildings.find((building) => building.team === "player" && building.type === "citadel"); if (home) { camera.x = home.x; camera.y = home.y; } }

  function updateUI(force = false) {
    if (!force && uiTick < .12) return;
    uiTick = 0;
    for (const key of Object.keys(resources)) $(`[data-resource="${key}"]`).textContent = Math.max(0, Math.floor(resources[key])).toLocaleString();
    $("[data-population]").textContent = `${population()} / ${populationCap()}`;
    $("[data-age-label]").textContent = `AGE ${roman(age)} · ${AGE[age - 1].label}`;
    const day = (elapsed / 110) % 1;
    $("[data-clock]").textContent = day < .15 ? "DAWN" : day < .5 ? "DAY" : day < .68 ? "DUSK" : "NIGHT";
    $("[data-weather]").textContent = weather.type.toUpperCase();
    const own = ownSelected();
    const title = own.length === 1 ? (own[0].id.startsWith("unit") ? UNIT[own[0].type].label : BUILDING[own[0].type].label) : own.length ? `${own.length} forces selected` : "No units selected";
    const health = own.length ? Math.round(own.reduce((sum, entity) => sum + entity.hp / entity.maxHp, 0) / own.length * 100) : 0;
    $("[data-selection-title]").textContent = title;
    $("[data-selection-copy]").textContent = own.length ? `${health}% average strength · right-click to command` : "Drag over units or tap one on the field.";
    $("[data-selection-icons]").innerHTML = own.slice(0, 12).map((entity) => `<i>${escapeHtml(entity.id.startsWith("unit") ? UNIT[entity.type].glyph : BUILDING[entity.type].glyph)}</i>`).join("");
    const enemyHome = buildings.find((building) => building.team === "enemy" && building.type === "citadel");
    const enemyArmy = units.filter((unit) => unit.team === "enemy" && unit.hp > 0).length;
    $("[data-objective-title]").textContent = enemyHome ? "Break the crimson crown" : "The rival crown has fallen";
    $("[data-objective-copy]").textContent = enemyHome ? `Destroy the eastern Citadel. ${enemyArmy} rival forces remain in the field.` : "Secure the surviving frontier and accept victory.";
    $("[data-objective-progress]").style.width = `${enemyHome ? Math.round((1 - enemyHome.hp / enemyHome.maxHp) * 100) : 100}%`;
    $("[data-threat]").textContent = `THREAT: ${enemyArmy > 18 ? "OVERWHELMING" : enemyArmy > 10 ? "HIGH" : enemyArmy > 4 ? "WATCHFUL" : "FALTERING"}`;
    renderCommands(); renderMinimap();
  }

  function onBridge(y) { return WORLD.bridges.some(([top, bottom]) => y >= top && y <= bottom); }
  function canTravel(unit, x, y) {
    if (UNIT[unit.type].naval) return x > WORLD.riverLeft + 8 && x < WORLD.riverRight - 8;
    return !(x > WORLD.riverLeft && x < WORLD.riverRight && !onBridge(y));
  }
  function waypointFor(unit, target) {
    if (UNIT[unit.type].naval) return { x: clamp(target.x, WORLD.riverLeft + 28, WORLD.riverRight - 28), y: target.y };
    const crossing = (unit.x < WORLD.riverLeft && target.x > WORLD.riverRight) || (unit.x > WORLD.riverRight && target.x < WORLD.riverLeft);
    if (crossing && !onBridge(unit.y)) {
      const centers = WORLD.bridges.map(([top, bottom]) => (top + bottom) / 2);
      const bridgeY = centers.reduce((best, value) => Math.abs(value - unit.y) < Math.abs(best - unit.y) ? value : best, centers[0]);
      if (Math.abs(unit.y - bridgeY) > 34) return { x: unit.x < WORLD.riverLeft ? WORLD.riverLeft - 35 : WORLD.riverRight + 35, y: bridgeY };
    }
    return target;
  }
  function commandSelected(point, target = null) {
    const chosen = selectedUnits();
    if (!chosen.length) return;
    const columns = Math.ceil(Math.sqrt(chosen.length));
    chosen.forEach((unit, index) => {
      const offset = { x: (index % columns - (columns - 1) / 2) * 32, y: (Math.floor(index / columns) - 1) * 32 };
      unit.targetX = point.x + offset.x; unit.targetY = point.y + offset.y; unit.targetId = target?.id || null;
      if (target?.id?.startsWith("node") && unit.type === "worker") { unit.order = "gather"; unit.gatherNodeId = target.id; }
      else if (target && target.team && target.team !== unit.team) unit.order = "attack";
      else unit.order = attackMove ? "attack-move" : "move";
    });
    attackMove = false; showOrderCursor(worldToScreen(point.x, point.y)); sfx("click", .5);
  }
  function showOrderCursor(point) {
    const cursor = $("[data-order-cursor]"); cursor.style.left = `${point.x}px`; cursor.style.top = `${point.y}px`; cursor.hidden = false;
    setTimeout(() => { cursor.hidden = true; }, 520);
  }

  function findNearestEnemy(entity, maxDistance = Infinity) {
    let best = null; let bestD = maxDistance;
    for (const candidate of [...units, ...buildings]) {
      if (candidate.team === entity.team || candidate.hp <= 0 || candidate.construction < 1) continue;
      const d = distance(entity, candidate);
      if (d < bestD) { best = candidate; bestD = d; }
    }
    return best;
  }
  function moveToward(unit, target, dt) {
    const point = waypointFor(unit, target); const angle = angleTo(unit, point); const speed = UNIT[unit.type].speed * (weather.type === "storm" && !UNIT[unit.type].naval ? .88 : 1);
    const nx = unit.x + Math.cos(angle) * speed * dt; const ny = unit.y + Math.sin(angle) * speed * dt;
    if (canTravel(unit, nx, ny)) { unit.x = clamp(nx, 25, WORLD.w - 25); unit.y = clamp(ny, 25, WORLD.h - 25); unit.facing = angle; }
    if (UNIT[unit.type].naval && Math.random() < dt * 11) unit.wake.push({ x: unit.x, y: unit.y, life: 1 });
  }
  function updateUnit(unit, dt) {
    const def = UNIT[unit.type]; unit.cooldown -= dt; unit.flash = Math.max(0, unit.flash - dt * 4);
    unit.wake.forEach((wake) => wake.life -= dt); unit.wake = unit.wake.filter((wake) => wake.life > 0);
    if (unit.hp <= 0) return;
    if (unit.order === "gather" || unit.order === "return") return updateGather(unit, dt);
    if (unit.order === "build") return updateBuild(unit, dt);
    let target = unit.targetId ? entityById(unit.targetId) : null;
    if (!target || target.hp <= 0 && !target.id?.startsWith("node")) { unit.targetId = null; target = null; }
    const aggro = unit.order === "move" ? 95 : 260;
    if (!target && unit.type !== "worker") target = findNearestEnemy(unit, aggro);
    if (target && target.team !== unit.team) {
      const range = def.range + (target.id.startsWith("building") ? BUILDING[target.type].size * .55 : 0);
      if (distance(unit, target) <= range) {
        unit.order = "attack"; unit.targetId = target.id;
        if (unit.cooldown <= 0) attack(unit, target);
      } else moveToward(unit, target, dt);
      return;
    }
    const point = { x: unit.targetX, y: unit.targetY };
    if (distance(unit, point) > 8) moveToward(unit, point, dt); else if (unit.order === "move") unit.order = "idle";
  }
  function updateGather(unit, dt) {
    const home = buildings.find((building) => building.team === unit.team && building.type === "citadel" && building.hp > 0);
    if (!home) { unit.order = "idle"; return; }
    if (unit.order === "return") {
      if (distance(unit, home) > BUILDING.citadel.size + 12) moveToward(unit, home, dt);
      else {
        if (unit.team === "player" && unit.carryType) resources[unit.carryType] += unit.carry;
        unit.carry = 0; unit.carryType = null;
        const node = nodes.find((entry) => entry.id === unit.gatherNodeId && entry.amount > 0);
        if (node) { unit.order = "gather"; unit.targetId = node.id; } else unit.order = "idle";
        sfx("gather", .18);
      }
      return;
    }
    const node = nodes.find((entry) => entry.id === unit.gatherNodeId && entry.amount > 0);
    if (!node) { unit.order = "idle"; unit.targetId = null; return; }
    if (distance(unit, node) > node.r + 10) moveToward(unit, node, dt);
    else {
      const amount = Math.min(node.amount, dt * (node.type === "food" ? 10 : 8)); node.amount -= amount; unit.carry += amount; unit.carryType = node.type;
      if (Math.random() < dt * 4) burst(node.x + rand(-8, 8), node.y + rand(-8, 8), nodeColor(node.type), 1, 20);
      if (unit.carry >= 24 || node.amount <= 0) { unit.order = "return"; unit.targetId = home.id; }
    }
  }
  function updateBuild(unit, dt) {
    const building = buildings.find((entry) => entry.id === unit.targetId && entry.hp > 0);
    if (!building || building.construction >= 1) { unit.order = "idle"; unit.targetId = null; return; }
    const radius = BUILDING[building.type].size + 18;
    if (distance(unit, building) > radius) moveToward(unit, building, dt);
    else {
      building.construction = Math.min(1, building.construction + dt * .075);
      building.hp = Math.min(building.maxHp, building.hp + building.maxHp * dt * .075);
      if (Math.random() < dt * 5) burst(building.x + rand(-30, 30), building.y + rand(-24, 24), "#d6b06c", 2, 26);
      if (building.construction >= 1) { unit.order = "idle"; unit.targetId = null; addFeed(`${BUILDING[building.type].label} completed.`, "good"); sfx("build"); score += 110; }
    }
  }

  function attack(attacker, target) {
    const def = attacker.id.startsWith("unit") ? UNIT[attacker.type] : BUILDING[attacker.type];
    attacker.cooldown = def.rate;
    const damage = def.attack * (1 + (attacker.veteran || 0) * .08) * (def.siege && target.id.startsWith("building") ? 1.7 : 1) * (attacker.team === "player" ? 1 + (age - 1) * .08 : 1);
    if (def.projectile || attacker.id.startsWith("building")) {
      projectiles.push({ id: id("shot"), x: attacker.x, y: attacker.y, z: 12, targetId: target.id, team: attacker.team, damage, siege: !!def.siege, naval: !!def.naval, life: 3, arc: 0 });
      sfx(def.siege ? "siege" : def.naval ? "naval" : "arrow", .35);
    } else {
      damageEntity(target, damage, attacker); burst(target.x, target.y, teamColor(attacker.team), 7, 70); sfx("sword", .3);
    }
  }
  function damageEntity(target, amount, source) {
    if (!target || target.hp <= 0) return;
    target.hp -= amount; target.flash = 1; camera.shake = Math.max(camera.shake, amount > 45 ? 12 : 3);
    if (target.hp > 0) return;
    target.hp = 0; selected.delete(target.id); decals.push({ x: target.x, y: target.y, r: target.id.startsWith("building") ? 52 : 14, life: 60 });
    burst(target.x, target.y, target.id.startsWith("building") ? "#ffb066" : teamColor(target.team), target.id.startsWith("building") ? 34 : 14, target.id.startsWith("building") ? 180 : 100);
    sfx(target.id.startsWith("building") ? "siege" : "death", .7);
    if (source?.team === "player") { score += target.id.startsWith("building") ? 350 : 75; source.veteran = (source.veteran || 0) + 1; }
    if (target.type === "citadel") finish(target.team === "enemy");
  }
  function updateProjectile(shot, dt) {
    const target = entityById(shot.targetId); shot.life -= dt;
    if (!target || target.hp <= 0 || shot.life <= 0) { shot.life = 0; return; }
    const speed = shot.siege ? 210 : shot.naval ? 330 : 440; const d = distance(shot, target); shot.arc = Math.sin(clamp(1 - d / 250, 0, 1) * Math.PI) * (shot.siege ? 90 : 22);
    if (d < 13) {
      if (shot.siege) {
        for (const entity of [...units, ...buildings]) if (entity.team !== shot.team && entity.hp > 0 && distance(entity, target) < 72) damageEntity(entity, shot.damage * (entity === target ? 1 : .42), null);
        burst(target.x, target.y, "#ffb04d", 28, 180);
      } else { damageEntity(target, shot.damage, null); burst(target.x, target.y, shot.naval ? "#7fe9ff" : "#e7cf87", 7, 70); }
      shot.life = 0; return;
    }
    const a = angleTo(shot, target); shot.x += Math.cos(a) * speed * dt; shot.y += Math.sin(a) * speed * dt;
  }

  function updateBuildings(dt) {
    for (const building of buildings) {
      if (building.hp <= 0) continue;
      building.cooldown -= dt; building.flash = Math.max(0, building.flash - dt * 3);
      if (building.type === "tower" && building.construction >= 1 && building.cooldown <= 0) {
        const target = findNearestEnemy(building, BUILDING.tower.range);
        if (target) attack(building, target);
      }
      if (building.team === "player" && building.type === "market" && building.construction >= 1) resources.gold += dt * 1.3;
    }
    for (const item of training) {
      const building = buildings.find((entry) => entry.id === item.buildingId && entry.hp > 0);
      if (!building) { item.remaining = -1; continue; }
      item.remaining -= dt;
      if (item.remaining <= 0) {
        const naval = UNIT[item.type].naval;
        const unit = addUnit(item.type, building.team, naval ? clamp(building.x, WORLD.riverLeft + 32, WORLD.riverRight - 32) : building.x + BUILDING[building.type].size + 34, building.y + rand(-26, 26));
        unit.targetX = unit.x + (unit.team === "player" ? 70 : -70); addFeed(`${UNIT[item.type].label} reports for duty.`, "good"); sfx("click"); item.remaining = -1;
      }
    }
    training = training.filter((item) => item.remaining > 0);
  }

  function updateAI(dt) {
    aiTick -= dt;
    if (aiTick > 0) return;
    aiTick = mode === "skirmish" ? rand(13, 18) : rand(19, 27);
    const home = buildings.find((building) => building.team === "enemy" && building.type === "citadel" && building.hp > 0);
    const playerHome = buildings.find((building) => building.team === "player" && building.type === "citadel" && building.hp > 0);
    if (!home || !playerHome) return;
    const wave = Math.min(8, 2 + Math.floor(elapsed / 55));
    const types = elapsed > 150 ? ["sword", "archer", "cavalry", "catapult"] : elapsed > 70 ? ["sword", "archer", "cavalry"] : ["sword", "archer"];
    const spawned = [];
    for (let i = 0; i < wave; i++) spawned.push(addUnit(types[Math.floor(Math.random() * types.length)], "enemy", home.x - 110 + rand(-45, 45), home.y + rand(-90, 90)));
    spawned.forEach((unit) => { unit.targetX = playerHome.x; unit.targetY = playerHome.y; unit.order = "attack-move"; });
    if (elapsed > 95 && !buildings.some((building) => building.team === "enemy" && building.type === "dock" && building.hp > 0)) {
      addBuilding("dock", "enemy", WORLD.riverRight - 10, 970); addUnit("ship", "enemy", 1660, 960).order = "attack-move";
    }
    addFeed(`Crimson war horn: ${wave} forces advancing.`, "danger"); announce("ENEMY WAR PARTY"); sfx("alarm");
  }

  function burst(x, y, color, count, speed) {
    const total = reducedMotion ? Math.min(count, 5) : count;
    for (let i = 0; i < total; i++) {
      const a = rand(0, Math.PI * 2); const s = rand(speed * .25, speed);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, color, life: rand(.3, .85), max: .85, size: rand(2, 6) });
    }
  }
  function updateEffects(dt) {
    particles.forEach((particle) => { particle.x += particle.vx * dt; particle.y += particle.vy * dt; particle.vx *= .94; particle.vy *= .94; particle.life -= dt; });
    particles = particles.filter((particle) => particle.life > 0);
    decals.forEach((decal) => decal.life -= dt); decals = decals.filter((decal) => decal.life > 0);
    feed.forEach((item) => item.life -= dt); const before = feed.length; feed = feed.filter((item) => item.life > 0); if (feed.length !== before) renderFeed();
    camera.shake = Math.max(0, camera.shake - dt * 30);
    weather.timer -= dt;
    if (weather.timer <= 0) {
      const choices = mode === "sandbox" ? ["clear", "clear", "rain"] : ["clear", "rain", "mist", "storm"];
      weather.type = choices[Math.floor(Math.random() * choices.length)]; weather.timer = rand(34, 62); addFeed(`Weather front: ${weather.type}.`);
    }
    if (weather.type === "storm" && Math.random() < dt * .08) { weather.lightning = 1; sfx("thunder", .45); camera.shake = 7; }
    weather.lightning = Math.max(0, weather.lightning - dt * 3);
  }

  function update(dt) {
    if (phase !== "playing") return;
    elapsed += dt; uiTick += dt; saveTick += dt; reportTick += dt;
    const pan = 620 / camera.zoom * dt;
    if (keys.has("KeyW") || keys.has("ArrowUp")) camera.y -= pan;
    if (keys.has("KeyS") || keys.has("ArrowDown")) camera.y += pan;
    if (keys.has("KeyA") || keys.has("ArrowLeft")) camera.x -= pan;
    if (keys.has("KeyD") || keys.has("ArrowRight")) camera.x += pan;
    camera.x = clamp(camera.x, 0, WORLD.w); camera.y = clamp(camera.y, 0, WORLD.h);
    units.forEach((unit) => updateUnit(unit, dt)); projectiles.forEach((shot) => updateProjectile(shot, dt)); projectiles = projectiles.filter((shot) => shot.life > 0);
    updateBuildings(dt); updateAI(dt); updateEffects(dt);
    units = units.filter((unit) => unit.hp > 0); buildings = buildings.filter((building) => building.hp > 0); nodes = nodes.filter((node) => node.amount > 0);
    selected = new Set([...selected].filter((entityId) => !!entityById(entityId)));
    if (saveTick > 10) { saveTick = 0; saveGame(false); }
    if (reportTick > 5) { reportTick = 0; host("progress", { progress: progressSnapshot(), score, state: serialize() }); }
    updateUI();
  }

  function progressSnapshot() {
    const enemyHome = buildings.find((building) => building.team === "enemy" && building.type === "citadel");
    return { mode, age, score, population: population(), enemyCitadel: enemyHome ? Math.round(enemyHome.hp / enemyHome.maxHp * 100) : 0, seconds: Math.floor(elapsed) };
  }
  function serialize() {
    return { version: 1, mode, elapsed, score, age, resources, camera, units, buildings, nodes, training, weather, nextId };
  }
  function saveGame(notify = false) {
    if (phase === "title") return;
    const state = serialize();
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch { /* host save still works */ }
    host("save-state", { state });
    if (notify) { addFeed("Empire saved to this profile.", "good"); sfx("click"); }
    $("[data-continue]").hidden = false;
  }
  function restoreGame(state) {
    if (!state || state.version !== 1 || !Array.isArray(state.units) || !Array.isArray(state.buildings)) return false;
    mode = state.mode || "campaign"; elapsed = Number(state.elapsed) || 0; score = Number(state.score) || 0; age = clamp(Number(state.age) || 1, 1, 4);
    resources = { food: 0, wood: 0, gold: 0, stone: 0, ...(state.resources || {}) }; camera = { x: 680, y: 1050, zoom: .7, shake: 0, ...(state.camera || {}) };
    units = state.units; buildings = state.buildings; nodes = state.nodes || []; training = state.training || []; weather = state.weather || { type: "clear", timer: 40, lightning: 0 }; nextId = Number(state.nextId) || 1000;
    projectiles = []; particles = []; decals = []; selected.clear(); resultSent = false; feed = [];
    showGame(); addFeed("Saved empire restored.", "good"); announce("THE CAMPAIGN CONTINUES"); return true;
  }
  function loadLocal() { try { return JSON.parse(localStorage.getItem(SAVE_KEY) || "null"); } catch { return null; } }

  function finish(victory) {
    if (phase === "result") return;
    phase = "result"; resultSent = true;
    const bonus = victory ? Math.max(0, 6000 - Math.floor(elapsed) * 8) + age * 750 : 0; score += bonus;
    $("[data-result-kicker]").textContent = victory ? "THE FRONTIER REMEMBERS" : "THE CROWN HAS FALLEN";
    $("[data-result-title]").textContent = victory ? "Sovereign Victory" : "Empire Defeated";
    $("[data-result-copy]").textContent = victory ? "The crimson Citadel is broken. Your civilization commands the river, the roads, and the dawn." : "Your Citadel was destroyed. Rebuild faster, control the bridges, and answer siege with cavalry.";
    $("[data-result-stats]").innerHTML = `<span><b>${score.toLocaleString()}</b><small>RENOWN</small></span><span><b>${roman(age)}</b><small>FINAL AGE</small></span><span><b>${Math.floor(elapsed / 60)}:${String(Math.floor(elapsed % 60)).padStart(2, "0")}</b><small>WAR TIME</small></span>`;
    $("[data-result-screen]").hidden = false; sfx(victory ? "victory" : "death", 1); host("score", { score }); host("complete", { score, progress: progressSnapshot(), state: serialize(), victory });
    if (victory) try { localStorage.removeItem(SAVE_KEY); } catch { /* no-op */ }
  }

  function draw() {
    const shakeX = camera.shake ? rand(-camera.shake, camera.shake) : 0; const shakeY = camera.shake ? rand(-camera.shake, camera.shake) : 0;
    ctx.save(); ctx.translate(shakeX, shakeY);
    drawTerrain(); drawDecals(); drawNodes();
    const entities = [...buildings, ...units].sort((a, b) => a.y - b.y);
    entities.forEach((entity) => entity.id.startsWith("building") ? drawBuilding(entity) : drawUnit(entity));
    drawProjectiles(); drawParticles(); drawSelectionMarquee(); drawWeather();
    ctx.restore(); renderMinimap();
  }
  function drawTerrain() {
    const gradient = ctx.createLinearGradient(0, 0, 0, H); gradient.addColorStop(0, "#2c4a32"); gradient.addColorStop(1, "#182e25"); ctx.fillStyle = gradient; ctx.fillRect(0, 0, W, H);
    const tile = 120; const start = screenToWorld(0, 0); const end = screenToWorld(W, H);
    for (let x = Math.floor(start.x / tile) * tile; x < end.x + tile; x += tile) for (let y = Math.floor(start.y / tile) * tile; y < end.y + tile; y += tile) {
      const p = worldToScreen(x, y); const n = Math.abs(Math.sin(x * 12.9898 + y * 78.233)); ctx.fillStyle = n > .55 ? "#ffffff07" : "#00000008"; ctx.fillRect(p.x, p.y, tile * camera.zoom, tile * camera.zoom);
      if (n > .82) { ctx.fillStyle = "#91b36b28"; ctx.fillRect(p.x + 18 * camera.zoom, p.y + 16 * camera.zoom, 3 * camera.zoom, 12 * camera.zoom); }
    }
    const riverA = worldToScreen(WORLD.riverLeft, 0); const riverB = worldToScreen(WORLD.riverRight, 0);
    const water = ctx.createLinearGradient(riverA.x, 0, riverB.x, 0); water.addColorStop(0, "#163747"); water.addColorStop(.5, "#24627a"); water.addColorStop(1, "#153847"); ctx.fillStyle = water; ctx.fillRect(riverA.x, 0, riverB.x - riverA.x, H);
    ctx.strokeStyle = "#78c8d02b"; ctx.lineWidth = 2;
    for (let y = -40 + (elapsed * 22 % 70); y < H + 50; y += 70) { ctx.beginPath(); ctx.moveTo(riverA.x + 10, y); ctx.bezierCurveTo(lerp(riverA.x, riverB.x, .35), y - 12, lerp(riverA.x, riverB.x, .65), y + 12, riverB.x - 10, y); ctx.stroke(); }
    for (const [top, bottom] of WORLD.bridges) {
      const a = worldToScreen(WORLD.riverLeft - 35, top); const b = worldToScreen(WORLD.riverRight + 35, bottom);
      ctx.fillStyle = "#6d5540"; ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.strokeStyle = "#d4aa6a55"; ctx.lineWidth = 3; for (let x = a.x; x < b.x; x += 22 * camera.zoom) { ctx.beginPath(); ctx.moveTo(x, a.y); ctx.lineTo(x, b.y); ctx.stroke(); }
    }
    const border = worldToScreen(0, 0); const border2 = worldToScreen(WORLD.w, WORLD.h); ctx.strokeStyle = "#e7b85a55"; ctx.lineWidth = 3; ctx.strokeRect(border.x, border.y, border2.x - border.x, border2.y - border.y);
  }
  function drawDecals() {
    for (const decal of decals) { if (!visiblePoint(decal.x, decal.y)) continue; const p = worldToScreen(decal.x, decal.y); ctx.fillStyle = `rgba(20,14,10,${clamp(decal.life / 12, .08, .32)})`; ctx.beginPath(); ctx.ellipse(p.x, p.y, decal.r * camera.zoom, decal.r * .45 * camera.zoom, 0, 0, Math.PI * 2); ctx.fill(); }
  }
  function nodeColor(type) { return ({ food: "#e25a65", wood: "#57a764", gold: "#ffd65d", stone: "#a8b1b4" })[type]; }
  function drawNodes() {
    for (const node of nodes) {
      if (!visiblePoint(node.x, node.y)) continue; const p = worldToScreen(node.x, node.y); const z = camera.zoom;
      ctx.save(); ctx.translate(p.x, p.y);
      if (node.type === "wood") {
        ctx.fillStyle = "#503a25"; ctx.fillRect(-4 * z, -3 * z, 8 * z, 27 * z); ctx.fillStyle = "#1e6a3b"; for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc((i - 1.5) * 7 * z, (-12 + Math.abs(i - 1.5) * 3) * z, 15 * z, 0, Math.PI * 2); ctx.fill(); }
      } else if (node.type === "food") {
        ctx.fillStyle = "#2c653b"; ctx.beginPath(); ctx.arc(0, 0, 19 * z, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = nodeColor("food"); for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; ctx.beginPath(); ctx.arc(Math.cos(a) * 13 * z, Math.sin(a) * 8 * z, 3 * z, 0, Math.PI * 2); ctx.fill(); }
      } else {
        ctx.fillStyle = nodeColor(node.type); ctx.strokeStyle = "#101415"; ctx.lineWidth = 2; for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo((i * 8 - 14) * z, 12 * z); ctx.lineTo((i * 8 - 9) * z, -12 * z); ctx.lineTo((i * 8 - 1) * z, 12 * z); ctx.closePath(); ctx.fill(); ctx.stroke(); }
      }
      ctx.restore();
    }
  }
  function drawHealth(entity, p, width, offset) {
    if (entity.hp >= entity.maxHp && entity.construction >= 1 && !selected.has(entity.id)) return;
    const z = camera.zoom; ctx.fillStyle = "#090b0cdd"; ctx.fillRect(p.x - width * z / 2, p.y - offset * z, width * z, 5);
    ctx.fillStyle = entity.team === "player" ? "#62d6ff" : "#ff6b5c"; ctx.fillRect(p.x - width * z / 2 + 1, p.y - offset * z + 1, (width * z - 2) * clamp(entity.hp / entity.maxHp, 0, 1), 3);
  }
  function drawBuilding(building) {
    if (!visiblePoint(building.x, building.y, 160)) return; const def = BUILDING[building.type]; const p = worldToScreen(building.x, building.y); const z = camera.zoom; const size = def.size * z;
    ctx.save(); ctx.translate(p.x, p.y); ctx.globalAlpha = building.construction < 1 ? .45 + building.construction * .55 : 1;
    ctx.fillStyle = "#0007"; ctx.beginPath(); ctx.ellipse(5 * z, size * .52, size * .9, size * .42, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = building.flash ? "#fff2c2" : def.color; ctx.strokeStyle = teamColor(building.team); ctx.lineWidth = selected.has(building.id) ? 4 : 2;
    if (building.type === "tower") {
      ctx.fillRect(-size * .42, -size * .7, size * .84, size * 1.3); ctx.beginPath(); ctx.moveTo(-size * .6, -size * .66); ctx.lineTo(0, -size * 1.18); ctx.lineTo(size * .6, -size * .66); ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (building.type === "wall") {
      ctx.fillRect(-size, -size * .35, size * 2, size * .7); for (let i = -2; i <= 2; i++) ctx.fillRect(i * size * .42 - size * .16, -size * .62, size * .32, size * .3); ctx.strokeRect(-size, -size * .35, size * 2, size * .7);
    } else if (building.type === "dock") {
      ctx.fillRect(-size, -size * .32, size * 2, size * .64); ctx.strokeRect(-size, -size * .32, size * 2, size * .64); for (let i = -2; i <= 2; i++) ctx.fillRect(i * size * .38, -size * .62, size * .12, size * 1.24);
    } else {
      ctx.fillRect(-size * .78, -size * .45, size * 1.56, size * .95); ctx.strokeRect(-size * .78, -size * .45, size * 1.56, size * .95);
      ctx.fillStyle = building.team === "player" ? "#426ea1" : "#a13e39"; ctx.beginPath(); ctx.moveTo(-size, -size * .42); ctx.lineTo(0, -size * 1.03); ctx.lineTo(size, -size * .42); ctx.closePath(); ctx.fill(); ctx.stroke();
      if (building.type === "citadel") { for (const x of [-.62, 0, .62]) { ctx.fillStyle = def.color; ctx.fillRect((x - .16) * size, -size * 1.1, size * .32, size * .68); } }
      ctx.fillStyle = "#080909"; ctx.fillRect(-size * .15, size * .05, size * .3, size * .45);
    }
    ctx.fillStyle = building.team === "player" ? "#cce9ff" : "#ffd1c8"; ctx.font = `700 ${Math.max(8, 11 * z)}px Georgia`; ctx.textAlign = "center"; ctx.fillText(def.glyph, 0, 4 * z);
    if (building.construction < 1) { ctx.fillStyle = "#e7b85a"; ctx.fillRect(-size, size * .75, size * 2 * building.construction, 4); }
    ctx.restore(); drawHealth(building, p, def.size * 1.7, def.size * 1.25);
  }
  function drawUnit(unit) {
    if (!visiblePoint(unit.x, unit.y, 70)) return; const def = UNIT[unit.type]; const p = worldToScreen(unit.x, unit.y); const z = camera.zoom; const r = (def.naval ? 18 : unit.type === "cavalry" ? 15 : unit.type === "catapult" ? 17 : 11) * z;
    for (const wake of unit.wake) { const wp = worldToScreen(wake.x, wake.y); ctx.strokeStyle = `rgba(150,235,255,${wake.life * .35})`; ctx.beginPath(); ctx.ellipse(wp.x, wp.y, (1 - wake.life + .2) * 24 * z, 8 * z, 0, 0, Math.PI * 2); ctx.stroke(); }
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(unit.facing);
    ctx.fillStyle = "#0007"; ctx.beginPath(); ctx.ellipse(4 * z, 8 * z, r * 1.2, r * .58, 0, 0, Math.PI * 2); ctx.fill();
    if (selected.has(unit.id)) { ctx.strokeStyle = "#fff0a5"; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(0, 3 * z, r * 1.65, r, 0, 0, Math.PI * 2); ctx.stroke(); }
    ctx.fillStyle = unit.flash ? "#fff" : teamColor(unit.team); ctx.strokeStyle = "#091012"; ctx.lineWidth = 2;
    if (def.naval) { ctx.beginPath(); ctx.moveTo(r * 1.55, 0); ctx.lineTo(-r, -r * .75); ctx.lineTo(-r * 1.2, r * .75); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.fillStyle = "#ece2c6"; ctx.fillRect(-2, -r * 1.5, 3, r * 1.5); ctx.beginPath(); ctx.moveTo(1, -r * 1.4); ctx.lineTo(r, -r * .5); ctx.lineTo(1, -r * .4); ctx.fill(); }
    else if (unit.type === "cavalry") { ctx.beginPath(); ctx.ellipse(0, 0, r * 1.35, r * .75, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.fillStyle = def.color; ctx.beginPath(); ctx.arc(r * .35, -r * .55, r * .55, 0, Math.PI * 2); ctx.fill(); }
    else if (unit.type === "catapult") { ctx.fillRect(-r, -r * .7, r * 1.8, r * 1.4); ctx.strokeRect(-r, -r * .7, r * 1.8, r * 1.4); ctx.strokeStyle = def.color; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(-r * .3, 0); ctx.lineTo(r * 1.5, 0); ctx.stroke(); }
    else { ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.fillStyle = def.color; ctx.fillRect(-r * .25, -r * 1.45, r * .5, r * 1.1); if (unit.type === "archer") { ctx.strokeStyle = def.color; ctx.beginPath(); ctx.arc(r * .35, 0, r * .9, -1.3, 1.3); ctx.stroke(); } }
    ctx.rotate(-unit.facing); ctx.fillStyle = "#fff"; ctx.font = `700 ${Math.max(7, 9 * z)}px monospace`; ctx.textAlign = "center"; ctx.fillText(def.glyph, 0, 3 * z);
    if (unit.veteran >= 3) { ctx.fillStyle = "#ffe77a"; ctx.fillText("★", 0, -r * 1.55); }
    ctx.restore(); drawHealth(unit, p, 30, 26);
  }
  function drawProjectiles() {
    for (const shot of projectiles) { if (!visiblePoint(shot.x, shot.y)) continue; const p = worldToScreen(shot.x, shot.y); ctx.fillStyle = shot.siege ? "#ffb347" : shot.naval ? "#96f1ff" : "#ffe39a"; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 12; ctx.beginPath(); ctx.arc(p.x, p.y - shot.arc * camera.zoom, shot.siege ? 7 : 3, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0; }
  }
  function drawParticles() {
    for (const particle of particles) { if (!visiblePoint(particle.x, particle.y)) continue; const p = worldToScreen(particle.x, particle.y); ctx.globalAlpha = clamp(particle.life / particle.max, 0, 1); ctx.fillStyle = particle.color; ctx.fillRect(p.x, p.y, particle.size * camera.zoom, particle.size * camera.zoom); } ctx.globalAlpha = 1;
  }
  function drawSelectionMarquee() {
    if (!drag || drag.type !== "select") return;
    ctx.strokeStyle = "#ffe28c"; ctx.fillStyle = "#ffe28c13"; ctx.lineWidth = 1; const x = Math.min(drag.x, drag.cx), y = Math.min(drag.y, drag.cy), w = Math.abs(drag.cx - drag.x), h = Math.abs(drag.cy - drag.y); ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h);
  }
  function drawWeather() {
    const day = (elapsed / 110) % 1; const darkness = day < .15 ? lerp(.35, 0, day / .15) : day < .5 ? 0 : day < .68 ? lerp(0, .44, (day - .5) / .18) : lerp(.44, .35, (day - .68) / .32);
    if (darkness > 0) { ctx.fillStyle = `rgba(7,14,35,${darkness})`; ctx.fillRect(0, 0, W, H); }
    if (weather.type === "mist") { const g = ctx.createLinearGradient(0, H * .2, 0, H); g.addColorStop(0, "#cadbdc05"); g.addColorStop(1, "#cadbdc2b"); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
    if (weather.type === "rain" || weather.type === "storm") { ctx.strokeStyle = weather.type === "storm" ? "#d4ecff55" : "#c9e5ee38"; ctx.lineWidth = 1; const count = reducedMotion ? 35 : 120; for (let i = 0; i < count; i++) { const x = (i * 83 + elapsed * 330) % (W + 80) - 40; const y = (i * 47 + elapsed * 570) % (H + 80) - 40; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 8, y + 22); ctx.stroke(); } }
    if (weather.lightning > 0) { ctx.fillStyle = `rgba(220,239,255,${weather.lightning * .45})`; ctx.fillRect(0, 0, W, H); }
  }
  function renderMinimap() {
    if (!minimap || phase === "title") return; const sx = minimap.width / WORLD.w, sy = minimap.height / WORLD.h;
    mctx.fillStyle = "#1c3827"; mctx.fillRect(0, 0, minimap.width, minimap.height); mctx.fillStyle = "#1f6176"; mctx.fillRect(WORLD.riverLeft * sx, 0, (WORLD.riverRight - WORLD.riverLeft) * sx, minimap.height);
    mctx.fillStyle = "#826447"; WORLD.bridges.forEach(([top, bottom]) => mctx.fillRect((WORLD.riverLeft - 40) * sx, top * sy, (WORLD.riverRight - WORLD.riverLeft + 80) * sx, (bottom - top) * sy));
    for (const building of buildings) { mctx.fillStyle = teamColor(building.team); const size = building.type === "citadel" ? 5 : 3; mctx.fillRect(building.x * sx - size / 2, building.y * sy - size / 2, size, size); }
    for (const unit of units) { mctx.fillStyle = teamColor(unit.team); mctx.fillRect(unit.x * sx, unit.y * sy, 2, 2); }
    const tl = screenToWorld(0, 0), br = screenToWorld(W, H); mctx.strokeStyle = "#fff1a8"; mctx.lineWidth = 1; mctx.strokeRect(tl.x * sx, tl.y * sy, (br.x - tl.x) * sx, (br.y - tl.y) * sy);
  }

  function targetAt(point) {
    let best = null; let bestDistance = 38 / camera.zoom;
    for (const entity of [...units, ...buildings, ...nodes]) { if (entity.hp !== undefined && entity.hp <= 0) continue; const d = distance(entity, point); const size = entity.id.startsWith("building") ? BUILDING[entity.type].size : entity.r || 14; if (d < Math.max(bestDistance, size)) { best = entity; bestDistance = d; } }
    return best;
  }
  canvas.addEventListener("pointerdown", (event) => {
    if (phase !== "playing") return; createAudio(); canvas.setPointerCapture(event.pointerId);
    if (event.button === 2) return;
    if (buildMode) { placeBuilding(buildMode, screenToWorld(event.clientX, event.clientY)); return; }
    drag = { type: event.button === 1 ? "pan" : "select", x: event.clientX, y: event.clientY, cx: event.clientX, cy: event.clientY, cameraX: camera.x, cameraY: camera.y, shift: event.shiftKey };
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!drag) return; drag.cx = event.clientX; drag.cy = event.clientY;
    if (drag.type === "pan") { camera.x = drag.cameraX - (event.clientX - drag.x) / camera.zoom; camera.y = drag.cameraY - (event.clientY - drag.y) / camera.zoom; }
  });
  canvas.addEventListener("pointerup", (event) => {
    if (!drag || drag.type !== "select") { drag = null; return; }
    const moved = Math.hypot(drag.cx - drag.x, drag.cy - drag.y);
    if (moved < 8) { const target = targetAt(screenToWorld(event.clientX, event.clientY)); if (target?.team === "player") selectEntities([target], drag.shift); else if (!drag.shift) selectEntities([]); }
    else {
      const x1 = Math.min(drag.x, drag.cx), x2 = Math.max(drag.x, drag.cx), y1 = Math.min(drag.y, drag.cy), y2 = Math.max(drag.y, drag.cy);
      selectEntities(units.filter((unit) => { const p = worldToScreen(unit.x, unit.y); return unit.team === "player" && p.x >= x1 && p.x <= x2 && p.y >= y1 && p.y <= y2; }), drag.shift);
    }
    drag = null;
  });
  canvas.addEventListener("contextmenu", (event) => { event.preventDefault(); if (phase !== "playing") return; const point = screenToWorld(event.clientX, event.clientY); commandSelected(point, targetAt(point)); });
  canvas.addEventListener("wheel", (event) => { event.preventDefault(); const before = screenToWorld(event.clientX, event.clientY); camera.zoom = clamp(camera.zoom * (event.deltaY > 0 ? .9 : 1.1), .38, 1.45); const after = screenToWorld(event.clientX, event.clientY); camera.x += before.x - after.x; camera.y += before.y - after.y; }, { passive: false });
  minimap.addEventListener("pointerdown", (event) => { const rect = minimap.getBoundingClientRect(); camera.x = (event.clientX - rect.left) / rect.width * WORLD.w; camera.y = (event.clientY - rect.top) / rect.height * WORLD.h; });

  addEventListener("keydown", (event) => {
    keys.add(event.code);
    if (phase === "playing" && ["Space", "Escape", "KeyP"].includes(event.code)) event.preventDefault();
    if (event.code === "Escape" || event.code === "KeyP") {
      if (event.code === "Escape" && buildMode) { buildMode = null; updateUI(true); }
      else if (phase === "playing") pause(); else if (phase === "paused") resume();
    }
    if (phase !== "playing") return;
    if (event.code === "Space") { attackMove = true; announce("ATTACK-MOVE ARMED"); }
    if (event.code === "KeyH") centerHome();
    if (event.code === "KeyF") realmCommand("army");
    const number = /^Digit([1-6])$/.exec(event.code)?.[1];
    if (number) {
      const index = Number(number) - 1;
      if (event.ctrlKey) { controlGroups[index] = [...selected]; addFeed(`Control group ${number} assigned.`); }
      else selectEntities(controlGroups[index].map(entityById).filter(Boolean));
    }
  });
  addEventListener("keyup", (event) => keys.delete(event.code));

  function pause() { if (phase !== "playing") return; phase = "paused"; $("[data-pause-screen]").hidden = false; host("paused", { paused: true }); }
  function resume() { if (phase !== "paused") return; phase = "playing"; $("[data-pause-screen]").hidden = true; last = performance.now(); host("paused", { paused: false }); }
  function toMenu() {
    if (phase !== "title" && phase !== "result") saveGame(false);
    phase = "title"; $("[data-title-screen]").hidden = false; $("[data-pause-screen]").hidden = true; $("[data-result-screen]").hidden = true; $("[data-tutorial]").hidden = true;
    $("[data-hud]").hidden = true; $("[data-mission]").hidden = true; $("[data-command-deck]").hidden = true; $("[data-touch-bar]").hidden = true;
    $("[data-continue]").hidden = !loadLocal(); host("exit", { reason: "menu" });
  }

  $$('[data-start]').forEach((button) => button.onclick = () => startGame(button.dataset.start));
  $("[data-continue]").onclick = () => { createAudio(); const saved = loadLocal(); if (!restoreGame(saved)) startGame("campaign", false); };
  $("[data-pause]").onclick = pause; $("[data-resume]").onclick = resume; $("[data-save]").onclick = () => saveGame(true); $$('[data-menu]').forEach((button) => button.onclick = toMenu);
  $("[data-restart]").onclick = () => { $("[data-result-screen]").hidden = true; startGame(mode, false); };
  $("[data-tutorial-next]").onclick = () => tutorialIndex < TUTORIAL.length - 1 ? showTutorial(tutorialIndex + 1) : closeTutorial();
  $("[data-tutorial-skip]").onclick = closeTutorial;
  $$('[data-command-tab]').forEach((button) => button.onclick = () => { commandTab = button.dataset.commandTab; $$('[data-command-tab]').forEach((tab) => tab.classList.toggle("is-active", tab === button)); renderCommands(); });
  $$('[data-touch]').forEach((button) => button.onclick = () => {
    const action = button.dataset.touch;
    if (action === "army") realmCommand("army"); if (action === "home") centerHome(); if (action === "attack") { attackMove = true; announce("TAP A DESTINATION"); } if (action === "build") { commandTab = "build"; renderCommands(); }
  });

  addEventListener("message", (event) => {
    const data = event.data; if (!data || data.source !== "phantomplay-host") return;
    if (data.type === "settings") { muted = data.sound === false; reducedMotion = !!data.reducedMotion; }
    if (data.type === "pause") pause(); if (data.type === "resume") resume(); if (data.type === "restart") startGame(mode, false);
    if (data.type === "restore" || data.type === "load-state") restoreGame(data.state);
    if (data.type === "save") host("save-state", { state: serialize() });
  });

  function frame(now) {
    const dt = Math.min(.05, Math.max(0, (now - last) / 1000)); last = now; update(dt); draw(); requestAnimationFrame(frame);
  }

  if (window.PhantomGameKernel) {
    window.PhantomGameKernel.init({
      id: "phantom-empires", title: "Phantom Empires: Sovereign", theme: "sovereign", genre: "Real-time civilization strategy",
      fantasy: "Raise a civilization, command land and sea, and break the rival crown across a living frontier.", advisorName: "War Council",
      stages: ["Economy online", "War table synchronized", "Sovereign save armed"],
      scenes: { menu: "Sovereign title", play: "Living frontier", pause: "War table", results: "Victory chronicle" },
      sceneSelectors: { menu: "[data-title-screen]:not([hidden])", play: "#empire", pause: "[data-pause-screen]:not([hidden])", results: "[data-result-screen]:not([hidden])" },
      controls: ["Drag: select", "Right-click: command", "WASD: pan", "Wheel: zoom", "Space: attack-move", "Ctrl+1-6: group"],
    });
  }
  $("[data-continue]").hidden = !loadLocal();
  window.__PhantomEmpiresTest = {
    version: "1.0.0",
    start: (nextMode = "campaign") => startGame(nextMode, false),
    snapshot: () => ({ phase, ...progressSnapshot(), resources: { ...resources }, units: units.length, buildings: buildings.length, training: training.length }),
    advance: (seconds = 1) => { for (let i = 0; i < seconds * 20; i++) update(.05); return window.__PhantomEmpiresTest.snapshot(); },
    selectArmy: () => realmCommand("army"),
    train: trainUnit,
    buildAt: (type, x, y) => placeBuilding(type, { x, y }),
    save: () => serialize(), restore: restoreGame,
  };
  host("ready", { version: "1.0.0", engine: "PhantomPlay Strategy Engine" });
  requestAnimationFrame(frame);
})();
