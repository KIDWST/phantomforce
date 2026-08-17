import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = process.cwd();
const loaderPath = path.join(root, "app", "games", "shared", "modLoader.js");
const modsRoot = path.join(root, "app", "games", "shared", "mods", "phantom-strike");
const manifest = JSON.parse(readFileSync(path.join(modsRoot, "manifest.json"), "utf8"));

assert.equal(manifest.length, 7, "Phantom Strike must ship seven desktop training mods.");
for (const entry of manifest) {
  const file = path.join(modsRoot, entry.file);
  assert.ok(existsSync(file), `Missing mod script: ${entry.file}`);
  assert.doesNotThrow(() => new Function(readFileSync(file, "utf8")), `${entry.file} must parse`);
}

const listeners = new Map();
const attributes = new Map([
  ["data-pm-game-id", "phantom-strike"],
  ["data-pm-native", "true"],
]);
const stored = new Map();
const persistedStates = [];
const flags = {
  invulnerable: false,
  infiniteAmmo: false,
  infiniteGrenades: false,
  freezeBots: false,
  noReload: false,
  noRecoil: false,
  botDamageScale: 1,
};
let readyDetail = null;
let context;

const document = {
  documentElement: { getAttribute: (name) => attributes.get(name) || null },
  body: {
    appendChild(element) {
      if (element.tagName === "SCRIPT") {
        const prefix = "/shared/mods/phantom-strike/";
        assert.ok(element.src.startsWith(prefix), `Single-file mod used wrong base: ${element.src}`);
        const source = readFileSync(path.join(modsRoot, element.src.slice(prefix.length)), "utf8");
        vm.runInContext(source, context, { filename: element.src });
        element.onload?.();
      }
      return element;
    },
  },
  head: {
    appendChild(element) {
      if (element.tagName === "SCRIPT" && element.src.startsWith("/__pm_mods_write/phantom-strike/")) {
        const rawIds = element.src.split("/phantom-strike/")[1].split("?")[0];
        persistedStates.push(rawIds ? rawIds.split(",") : []);
        element.onload?.();
      }
      return element;
    },
  },
  createElement(tag) {
    return {
      tagName: tag.toUpperCase(),
      style: {},
      classList: { add() {}, remove() {} },
      appendChild() {},
      remove() {},
      querySelectorAll() { return []; },
    };
  },
  querySelector() { return null; },
  querySelectorAll() { return []; },
  addEventListener(type, callback) {
    const group = listeners.get(type) || [];
    group.push(callback);
    listeners.set(type, group);
  },
  removeEventListener(type, callback) {
    listeners.set(type, (listeners.get(type) || []).filter((item) => item !== callback));
  },
};

const windowObject = {
  document,
  location: { pathname: "/phantom-strike.html" },
  requestAnimationFrame(callback) { return setTimeout(() => callback(performance.now()), 1); },
  cancelAnimationFrame(id) { clearTimeout(id); },
  addEventListener(type, callback) {
    const group = listeners.get(type) || [];
    group.push(callback);
    listeners.set(type, group);
  },
  dispatchEvent(event) {
    if (event.type === "phantommods:ready") readyDetail = event.detail;
    for (const callback of listeners.get(event.type) || []) callback(event);
  },
  PhantomPlayDev: {
    getFlag(name) { return flags[name]; },
    setFlag(name, value) { flags[name] = value; return true; },
    action(name) { return name === "refill"; },
    setAudioMuted() {},
  },
  __PHANTOMPLAY_MOD_BOOTSTRAP__: {
    gameId: "phantom-strike",
    modBase: "/shared/mods/phantom-strike/",
    enabled: ["ps_training_mode"],
    mods: manifest,
  },
};

const fakeFetch = async (url, options = {}) => {
  if (url === "/__pm_mods/phantom-strike" && options.method === "PUT") {
    persistedStates.push(JSON.parse(options.body));
    return { ok: true, status: 200, json: async () => persistedStates.at(-1) };
  }
  if (url === "/__pm_mods/phantom-strike") {
    return { ok: true, status: 200, json: async () => ["ps_training_mode"] };
  }
  if (url === "/shared/mods/phantom-strike/manifest.json") {
    return { ok: true, status: 200, json: async () => manifest };
  }
  return { ok: false, status: 404, json: async () => [] };
};

context = vm.createContext({
  window: windowObject,
  document,
  location: windowObject.location,
  localStorage: {
    getItem(key) { return stored.has(key) ? stored.get(key) : null; },
    setItem(key, value) { stored.set(key, value); },
  },
  fetch: fakeFetch,
  CustomEvent: class CustomEvent {
    constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
  },
  Map,
  Set,
  Promise,
  Proxy,
  JSON,
  Math,
  Number,
  Array,
  Object,
  String,
  console,
  performance,
  setTimeout,
  clearTimeout,
});
windowObject.window = windowObject;

vm.runInContext(readFileSync(loaderPath, "utf8"), context, { filename: loaderPath });
for (let attempt = 0; attempt < 30 && !readyDetail; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 5));
}

assert.ok(readyDetail, "Desktop mod loader never reached ready state.");
assert.ok(readyDetail.active.includes("ps_training_mode"), "Native enabled state did not activate Training Mode.");
for (const name of ["invulnerable", "infiniteAmmo", "infiniteGrenades", "freezeBots", "noReload", "noRecoil"]) {
  assert.equal(flags[name], true, `Training Mode did not enable ${name}.`);
}
assert.equal(flags.botDamageScale, 0, "Training Mode did not suppress bot damage.");

windowObject.PhantomMods.enable("ps_god_mode");
windowObject.PhantomMods.disable("ps_training_mode");
assert.equal(flags.invulnerable, true, "Overlapping God Mode was lost when Training Mode was removed.");
assert.equal(flags.freezeBots, false, "Training Mode cleanup did not restore bot AI.");
windowObject.PhantomMods.disable("ps_god_mode");
assert.equal(flags.invulnerable, false, "God Mode cleanup did not restore normal damage.");
assert.ok(persistedStates.length >= 3, "Runtime mod changes did not persist to the native host.");

console.log(`PhantomPlay desktop mods verified: ${readyDetail.available.length} available, ${manifest.length} Phantom Strike mods.`);
