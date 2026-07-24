(function () {
  "use strict";

  if (window.PhantomGameKernel) return;

  const STORAGE_PREFIX = "phantomplay.kernel.";
  const DEFAULT_SETTINGS = {
    reduced: false,
    contrast: false,
    muted: false,
    advisor: 2,
    shake: 2,
    flash: 2,
    density: 1,
    focus: true
  };

  const DEFAULT_TIPS = [
    "Read the field before you spend your first move.",
    "A clean retreat beats a messy reset.",
    "Use the pause menu when the room or controls feel off."
  ];

  const DEFAULT_SCENES = {
    title: "Title screen",
    menu: "Game menu",
    loadout: "Loadout",
    play: "Live play",
    pause: "Paused",
    results: "Results"
  };

  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn, { once: true });
    else fn();
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function storageKey(id) {
    return STORAGE_PREFIX + String(id || "game");
  }

  function loadSettings(id) {
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey(id)) || "{}");
      return Object.assign({}, DEFAULT_SETTINGS, parsed);
    } catch (_error) {
      return Object.assign({}, DEFAULT_SETTINGS);
    }
  }

  function saveSettings(id, settings) {
    try {
      localStorage.setItem(storageKey(id), JSON.stringify(settings));
    } catch (_error) {
      /* best effort */
    }
  }

  function createAudioBus(settings) {
    let context = null;
    let unlocked = false;
    const tones = {
      boot: [220, 0.055],
      select: [360, 0.035],
      open: [520, 0.04],
      close: [240, 0.035],
      warn: [120, 0.05]
    };

    function ensure() {
      if (settings.muted || unlocked) return;
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      context = context || new Ctx();
      if (context.state === "suspended") context.resume().catch(() => {});
      unlocked = true;
    }

    function play(name) {
      if (settings.muted || !context) return;
      const tone = tones[name] || tones.select;
      const now = context.currentTime;
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.type = "triangle";
      osc.frequency.value = tone[0];
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.035, now + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + tone[1]);
      osc.connect(gain);
      gain.connect(context.destination);
      osc.start(now);
      osc.stop(now + tone[1] + 0.015);
    }

    return { ensure, play };
  }

  const THEME_PROFILES = {
    crown: { sigil: "♛", lane: "Broadcast circuit", verbs: ["Draft", "Pressure", "Crown"], posture: "championship", surfaces: ["ribbon", "podium", "commentary"] },
    skyguard: { sigil: "⌁", lane: "Aerial command", verbs: ["Scan", "Build", "Intercept"], posture: "tactical", surfaces: ["radar", "tower net", "threat lane"] },
    strike: { sigil: "⌖", lane: "Kill-space", verbs: ["Enter", "Clear", "Extract"], posture: "lethal", surfaces: ["reticle", "signal", "after-action"] },
    prix: { sigil: "◉", lane: "Grand prix", verbs: ["Lean", "Flow", "Podium"], posture: "joyful", surfaces: ["pit wall", "track cam", "rival"] },
    ages: { sigil: "◬", lane: "Timeline front", verbs: ["Gather", "Advance", "Rewrite"], posture: "temporal", surfaces: ["chronicle", "era rail", "council"] },
    kingdom: { sigil: "⚒", lane: "Siege table", verbs: ["Aim", "Break", "Hold"], posture: "weighty", surfaces: ["rampart", "war scroll", "engine crew"] },
    default: { sigil: "◆", lane: "PhantomPlay", verbs: ["Read", "Act", "Win"], posture: "responsive", surfaces: ["hud", "advisor", "session"] }
  };

  function profileFor(config) {
    return Object.assign({}, THEME_PROFILES.default, THEME_PROFILES[config.theme] || {}, config.profile || {});
  }

  function resolveScene(config) {
    const bodyScene = document.body.dataset.pgkScene || document.body.dataset.screen || document.body.dataset.stage;
    if (bodyScene) return normalizeScene(bodyScene, config);

    const explicit = config.sceneSelectors || {};
    for (const key of Object.keys(explicit)) {
      const selector = explicit[key];
      const element = selector ? document.querySelector(selector) : null;
      if (element && !element.hidden && !element.hasAttribute("hidden")) return normalizeScene(key, config);
    }

    const activeScreen = document.querySelector(".screen.active,[data-screen].active,.sg-screen:not([hidden]),.overlay:not([hidden]),[data-title-overlay]:not([hidden])");
    if (activeScreen) {
      const marker = activeScreen.dataset.screen || activeScreen.id || activeScreen.className || "";
      return normalizeScene(marker, config);
    }

    return "play";
  }

  function normalizeScene(value, config) {
    const text = String(value || "").toLowerCase();
    if (text.includes("pause")) return "pause";
    if (text.includes("result") || text.includes("finish") || text.includes("end")) return "results";
    if (text.includes("loadout") || text.includes("deck") || text.includes("setup") || text.includes("war-council")) return "loadout";
    if (text.includes("title") || text.includes("menu") || text.includes("map") || text.includes("tutorial")) return "menu";
    if (text.includes("play") || text.includes("battle") || text.includes("game") || text.includes("race")) return "play";
    if ((config.playScenes || []).includes(value)) return "play";
    return "menu";
  }

  function applySettings(settings) {
    document.body.classList.toggle("pgk-reduced", !!settings.reduced);
    document.body.classList.toggle("pgk-contrast", !!settings.contrast);
    document.body.classList.toggle("pgk-muted", !!settings.muted);
  }

  function init(rawConfig) {
    const config = Object.assign({
      id: document.title || "phantom-game",
      title: document.title || "PhantomPlay",
      theme: "default",
      genre: "PhantomPlay game",
      fantasy: "player session",
      advisorName: "Phantom coach",
      stages: ["Renderer online", "Input armed", "Save boundary ready"],
      scenes: DEFAULT_SCENES,
      tips: DEFAULT_TIPS
    }, rawConfig || {});

    ready(() => mount(config));
  }

  function initFromScript(script) {
    if (!script || !script.dataset.pgkConfig) return;
    try {
      init(JSON.parse(script.dataset.pgkConfig));
    } catch (error) {
      console.error("PhantomGameKernel config failed", error);
    }
  }

  function mount(config) {
    if (document.querySelector("[data-pgk-root]")) return;

    const settings = loadSettings(config.id);
    const reducedBySystem = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedBySystem) settings.reduced = true;
    applySettings(settings);
    document.body.dataset.pgkTheme = config.theme;
    document.body.dataset.pgkGame = config.id;

    const state = {
      config,
      settings,
      audio: createAudioBus(settings),
      input: "keyboard",
      scene: "menu",
      frames: 0,
      fps: 0,
      longFrames: 0,
      lastFrame: performance.now(),
      lastFpsAt: performance.now(),
      lastTipAt: 0,
      tipIndex: 0,
      panelOpen: false,
      lastEventAt: 0,
      lastSpectacleAt: 0
    };

    const root = document.createElement("div");
    root.className = "pgk-root";
    root.dataset.pgkRoot = "true";
    root.innerHTML = renderKernel(config, settings);
    document.body.appendChild(root);

    state.root = root;
    state.advisorCopy = root.querySelector("[data-pgk-advisor-copy]");
    state.sceneLabel = root.querySelector("[data-pgk-scene]");
    state.inputLabels = root.querySelectorAll("[data-pgk-input]");
    state.fpsLabel = root.querySelector("[data-pgk-fps]");
    state.longFrameLabel = root.querySelector("[data-pgk-longframes]");
    state.scenePips = root.querySelectorAll("[data-pgk-scene-pip]");
    state.verbNodes = root.querySelectorAll("[data-pgk-verb]");
    state.statusLabel = root.querySelector("[data-pgk-status]");
    state.densityLabel = root.querySelector("[data-pgk-density-label]");

    bindKernel(state);
    setTimeout(() => {
      root.querySelector("[data-pgk-boot]")?.classList.add("is-done");
      state.audio.play("boot");
    }, config.bootMs || 850);

    updateScene(state, true);
    requestAnimationFrame((time) => frame(state, time));
    window.dispatchEvent(new CustomEvent("phantom-game-kernel:ready", { detail: { id: config.id } }));
  }

  function renderKernel(config, settings) {
    const profile = profileFor(config);
    const stages = (config.stages || []).slice(0, 4).map((stage) => `<li>${escapeHtml(stage)}</li>`).join("");
    const verbs = (profile.verbs || []).slice(0, 3).map((verb, index) => `<b data-pgk-verb="${index}">${escapeHtml(verb)}</b>`).join("");
    const surfaces = (profile.surfaces || []).slice(0, 3).map((surface) => `<span>${escapeHtml(surface)}</span>`).join("");
    const scenePips = ["menu", "loadout", "play", "pause", "results"].map((scene) => `<i data-pgk-scene-pip="${scene}" title="${escapeHtml(config.scenes?.[scene] || DEFAULT_SCENES[scene] || scene)}"></i>`).join("");
    const title = escapeHtml(config.title);
    const genre = escapeHtml(config.genre);
    const fantasy = escapeHtml(config.fantasy);
    const advisorName = escapeHtml(config.advisorName);
    const lane = escapeHtml(profile.lane);
    const sigil = escapeHtml(profile.sigil);
    return `
      <div class="pgk-boot" data-pgk-boot aria-hidden="true">
        <div class="pgk-boot-card">
          <div class="pgk-boot-sigil">${sigil}</div>
          <p class="pgk-kicker">${genre}</p>
          <h1>${title}</h1>
          <p>${fantasy}</p>
          <ul class="pgk-stage-list">${stages}</ul>
        </div>
      </div>
      <div class="pgk-screen-frame" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      <header class="pgk-live-strip" aria-label="Game shell status">
        <div class="pgk-sigil" aria-hidden="true">${sigil}</div>
        <div class="pgk-strip-copy">
          <p>${lane}</p>
          <strong>${title}</strong>
        </div>
        <div class="pgk-scene-rail" aria-label="Scene progress">${scenePips}</div>
        <output data-pgk-status>booting</output>
      </header>
      <nav class="pgk-action-ribbon" aria-label="Game loop verbs">${verbs}</nav>
      <button class="pgk-command-button" type="button" data-pgk-command aria-label="Open game command center">⌘</button>
      <aside class="pgk-advisor" aria-live="polite">
        <i class="pgk-avatar" aria-hidden="true"></i>
        <p><b>${advisorName}</b><span data-pgk-advisor-copy>Reading the room...</span></p>
      </aside>
      <section class="pgk-panel" data-pgk-panel hidden aria-label="Game command center">
        <div class="pgk-panel-head">
          <div>
            <p class="pgk-kicker">Game command</p>
            <h2>${title}</h2>
            <p data-pgk-scene>Scene: checking</p>
          </div>
          <button class="pgk-close" type="button" data-pgk-close aria-label="Close game command center">x</button>
        </div>
        <div class="pgk-section">
          <h3>Input</h3>
          <div class="pgk-row"><span>Current control surface</span><output data-pgk-input>keyboard</output></div>
        </div>
        <div class="pgk-section">
          <h3>Accessibility</h3>
          <label class="pgk-toggle"><input type="checkbox" data-pgk-setting="reduced" ${settings.reduced ? "checked" : ""}> Reduce motion</label>
          <label class="pgk-toggle"><input type="checkbox" data-pgk-setting="contrast" ${settings.contrast ? "checked" : ""}> High contrast</label>
          <label class="pgk-toggle"><input type="checkbox" data-pgk-setting="muted" ${settings.muted ? "checked" : ""}> Mute kernel cues</label>
        </div>
        <div class="pgk-section">
          <h3>Feel</h3>
          <label class="pgk-row"><span>Advisor density</span><input type="range" min="0" max="3" value="${settings.advisor}" data-pgk-range="advisor"></label>
          <label class="pgk-row"><span>Camera shake cap</span><input type="range" min="0" max="3" value="${settings.shake}" data-pgk-range="shake"></label>
          <label class="pgk-row"><span>Flash intensity cap</span><input type="range" min="0" max="3" value="${settings.flash}" data-pgk-range="flash"></label>
          <label class="pgk-row"><span>HUD density</span><input type="range" min="0" max="2" value="${settings.density}" data-pgk-range="density"></label>
          <label class="pgk-toggle"><input type="checkbox" data-pgk-setting="focus" ${settings.focus ? "checked" : ""}> Focus mode during play</label>
        </div>
        <div class="pgk-section">
          <h3>Native language</h3>
          <div class="pgk-surface-list">${surfaces}</div>
        </div>
        <div class="pgk-section">
          <h3>Session health</h3>
          <div class="pgk-metrics">
            <div class="pgk-metric"><b data-pgk-fps>--</b><span>fps</span></div>
            <div class="pgk-metric"><b data-pgk-longframes>0</b><span>long frames</span></div>
            <div class="pgk-metric"><b>local</b><span>save scope</span></div>
          </div>
        </div>
      </section>
      <footer class="pgk-bottom-telemetry" aria-hidden="true">
        <span data-pgk-density-label>balanced hud</span>
        <span data-pgk-input>keyboard</span>
        <span>private session</span>
      </footer>
      <div class="pgk-toast" data-pgk-toast hidden></div>
    `;
  }

  function bindKernel(state) {
    const root = state.root;
    const openButton = root.querySelector("[data-pgk-command]");
    const closeButton = root.querySelector("[data-pgk-close]");
    const panel = root.querySelector("[data-pgk-panel]");

    const togglePanel = (force) => {
      state.audio.ensure();
      state.panelOpen = typeof force === "boolean" ? force : !state.panelOpen;
      panel.hidden = !state.panelOpen;
      state.audio.play(state.panelOpen ? "open" : "close");
    };

    openButton.addEventListener("click", () => togglePanel());
    closeButton.addEventListener("click", () => togglePanel(false));

    root.querySelectorAll("[data-pgk-setting]").forEach((input) => {
      input.addEventListener("change", () => {
        const key = input.dataset.pgkSetting;
        state.settings[key] = !!input.checked;
        applySettings(state.settings);
        state.audio = createAudioBus(state.settings);
        saveSettings(state.config.id, state.settings);
        toast(state, "Settings saved");
      });
    });

    root.querySelectorAll("[data-pgk-range]").forEach((input) => {
      input.addEventListener("input", () => {
        state.settings[input.dataset.pgkRange] = clamp(Number(input.value), 0, 3);
        saveSettings(state.config.id, state.settings);
      });
    });

    document.addEventListener("keydown", (event) => {
      state.input = "keyboard";
      if (event.key === "F1" || event.key === "?") {
        event.preventDefault();
        togglePanel();
      }
    }, true);

    document.addEventListener("pointerdown", (event) => {
      state.input = event.pointerType === "touch" ? "touch" : "pointer";
      state.audio.ensure();
    }, true);

    window.addEventListener("gamepadconnected", () => {
      state.input = "controller";
      toast(state, "Controller detected");
    });

    window.addEventListener("phantom-game-kernel:event", (event) => {
      const detail = event.detail || {};
      if (detail.message) toast(state, detail.message, detail.kind);
      state.lastEventAt = performance.now();
    });

    window.addEventListener("phantom-game-kernel:spectacle", (event) => {
      const detail = event.detail || {};
      state.root.dataset.pgkSpectacle = detail.kind || "major";
      state.lastSpectacleAt = performance.now();
      if (detail.message) toast(state, detail.message, "spectacle");
    });

    window.addEventListener("message", (event) => {
      const data = event.data;
      if (!data || typeof data !== "object") return;
      if (data.type === "settings" && typeof data.reducedMotion === "boolean") {
        state.settings.reduced = data.reducedMotion;
        applySettings(state.settings);
      }
      if (["pause", "resume", "restart", "exit"].includes(data.type)) {
        window.dispatchEvent(new CustomEvent("phantom-game-kernel:host", { detail: data }));
      }
    });
  }

  function frame(state, time) {
    const dt = time - state.lastFrame;
    state.lastFrame = time;
    state.frames += 1;
    if (dt > 50) state.longFrames += 1;

    if (time - state.lastFpsAt >= 500) {
      state.fps = Math.round(state.frames * 1000 / (time - state.lastFpsAt));
      state.frames = 0;
      state.lastFpsAt = time;
      if (state.fpsLabel) state.fpsLabel.textContent = String(state.fps);
      if (state.longFrameLabel) state.longFrameLabel.textContent = String(state.longFrames);
    }

    if (navigator.getGamepads && Array.from(navigator.getGamepads()).some(Boolean)) state.input = "controller";
    state.inputLabels?.forEach((label) => { label.textContent = state.input; });
    if (state.statusLabel) state.statusLabel.textContent = state.fps ? `${state.fps} fps · ${state.input}` : state.input;
    if (state.densityLabel) {
      const labels = ["compact hud", "balanced hud", "cinematic hud"];
      state.densityLabel.textContent = labels[state.settings.density] || labels[1];
    }
    document.body.dataset.pgkDensity = String(state.settings.density);
    document.body.classList.toggle("pgk-focus-play", state.scene === "play" && !!state.settings.focus);
    if (state.lastSpectacleAt && time - state.lastSpectacleAt > 900) {
      delete state.root.dataset.pgkSpectacle;
      state.lastSpectacleAt = 0;
    }
    updateScene(state, false);
    requestAnimationFrame((nextTime) => frame(state, nextTime));
  }

  function updateScene(state, force) {
    const nextScene = resolveScene(state.config);
    if (!force && nextScene === state.scene) return;

    state.scene = nextScene;
    document.body.classList.toggle("pgk-scene-play", nextScene === "play");
    document.body.classList.toggle("pgk-focus-play", nextScene === "play" && !!state.settings.focus);
    document.body.dataset.pgkKernelScene = nextScene;

    const label = state.config.scenes?.[nextScene] || DEFAULT_SCENES[nextScene] || nextScene;
    if (state.sceneLabel) state.sceneLabel.textContent = "Scene: " + label;
    if (state.advisorCopy) state.advisorCopy.textContent = chooseAdvisorLine(state, nextScene);
    state.scenePips?.forEach((pip) => pip.classList.toggle("is-active", pip.dataset.pgkScenePip === nextScene));
    state.verbNodes?.forEach((node, index) => {
      const hot = (nextScene === "play" && index === 1) || (nextScene === "results" && index === 2) || (nextScene !== "play" && nextScene !== "results" && index === 0);
      node.classList.toggle("is-hot", hot);
    });

    window.dispatchEvent(new CustomEvent("phantom-game-kernel:scene", {
      detail: { id: state.config.id, scene: nextScene, label }
    }));
  }

  function chooseAdvisorLine(state, scene) {
    const config = state.config;
    const map = config.advisor || {};
    if (map[scene]) return map[scene];
    if (scene === "play") return "Live. I will stay small unless you ask for the panel.";
    if (scene === "pause") return "Paused cleanly. Tune controls, then jump back in.";
    if (scene === "results") return "Run complete. Review, adapt, replay.";
    const tips = config.tips && config.tips.length ? config.tips : DEFAULT_TIPS;
    const next = tips[state.tipIndex % tips.length];
    state.tipIndex += 1;
    return next;
  }

  function toast(state, message, kind) {
    const node = state.root.querySelector("[data-pgk-toast]");
    if (!node) return;
    node.textContent = message;
    node.dataset.pgkToastKind = kind || "info";
    node.hidden = false;
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => {
      node.hidden = true;
    }, 1400);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  window.PhantomGameKernel = { init };
  initFromScript(document.currentScript);
})();
