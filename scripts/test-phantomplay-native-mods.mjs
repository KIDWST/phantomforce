import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const shellRoot = path.join(root, "packages", "phantomplay-dioxus-shell");
const executable = path.join(shellRoot, "target", "release", "PhantomPlay.exe");
assert.ok(existsSync(executable), `Build the native release first: ${executable}`);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.unref();
  server.on("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    server.close(() => resolve(address.port));
  });
});

async function waitForTargets(port, predicate, timeoutMs = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, { cache: "no-store" })).json();
      if (predicate(targets)) return targets;
    } catch {}
    await sleep(100);
  }
  throw new Error(`Timed out waiting for native WebView2 targets on ${port}`);
}

async function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  const pending = new Map();
  let nextId = 1;
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  await send("Runtime.enable");
  const evaluate = async (expression) => {
    const response = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || "Native evaluation failed");
    return response.result?.value;
  };
  return { socket, send, evaluate };
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    sleep(3000),
  ]);
}

const port = await freePort();
const profile = mkdtempSync(path.join(os.tmpdir(), "phantomplay-native-mods-"));
let child;
let shell;
let game;

try {
  child = spawn(executable, [], {
    cwd: shellRoot,
    env: {
      ...process.env,
      PHANTOMPLAY_WEBVIEW_DATA_DIR: profile,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    },
    stdio: "ignore",
    windowsHide: true,
  });

  const initialTargets = await waitForTargets(port, (targets) => targets.some((target) => target.type === "page" && target.title === "PhantomPlay"));
  shell = await connect(initialTargets.find((target) => target.type === "page" && target.title === "PhantomPlay"));

  const launch = await shell.evaluate(`(() => {
    const card = [...document.querySelectorAll(".project-row")].find((node) => node.textContent.includes("Phantom Strike"));
    const run = card?.querySelector(".mini-action.is-primary");
    if (!run) return false;
    run.click();
    return true;
  })()`);
  assert.equal(launch, true, "Native project library could not launch Phantom Strike.");

  const gameTargets = await waitForTargets(port, (targets) => targets.some((target) => target.type === "iframe" && target.url.includes("phantom-strike.html")));
  const gameTarget = gameTargets.find((target) => target.type === "iframe" && target.url.includes("phantom-strike.html"));
  game = await connect(gameTarget);

  const started = Date.now();
  let nativeState;
  while (Date.now() - started < 5000) {
    nativeState = await game.evaluate(`({
      native: document.documentElement.dataset.pmNative,
      hotVersion: window.__PHANTOMPLAY_HOT_VERSION__,
      mods: window.PhantomMods?.list(),
      game: window.PhantomPlayDev?.state(),
    })`);
    if (nativeState.mods?.length === 12 && nativeState.mods.some((mod) => mod.id === "ps_training_mode" && mod.active)) break;
    await sleep(100);
  }

  assert.equal(nativeState.native, "true", "Game frame was not marked as a native PhantomPlay runtime.");
  assert.equal(nativeState.mods.length, 12, "Native frame did not load universal and Phantom Strike mods.");
  assert.ok(nativeState.mods.some((mod) => mod.id === "ps_training_mode" && mod.active), "Training Mode was not applied from native enabled state.");
  for (const flag of ["invulnerable", "infiniteAmmo", "infiniteGrenades", "freezeBots", "noReload", "noRecoil"]) {
    assert.equal(nativeState.game.dev[flag], true, `Native Training Mode did not enable ${flag}.`);
  }
  assert.equal(nativeState.game.dev.botDamageScale, 0, "Native Training Mode did not suppress bot damage.");

  const dock = await shell.evaluate(`({
    workspace: document.querySelector(".workspace-heading strong")?.textContent.trim(),
    mods: [...document.querySelectorAll(".mod-option strong")].map((node) => node.textContent.trim()),
    checked: [...document.querySelectorAll(".mod-option input:checked")].map((input) => input.closest("label")?.textContent),
  })`);
  assert.equal(dock.workspace, "Phantom Strike", "Native workspace did not switch to Phantom Strike.");
  assert.equal(dock.mods.length, 12, "Native Mods dock did not show all available controls.");
  assert.ok(dock.checked.some((label) => label.includes("Training Mode")), "Native Mods dock did not show Training Mode as enabled.");

  const overlayAudit = await game.evaluate(`(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "F10", bubbles: true }));
    return !document.querySelector("#pm-mod-menu");
  })()`);
  assert.equal(overlayAudit, true, "F10 must not inject a second mod menu over the running game.");

  const spawnAudit = await game.evaluate(`(() => {
    const rows = [];
    for (let attempt = 0; attempt < 18; attempt += 1) {
      window.__PhantomStrikeLegacyTest.start();
      const state = window.PhantomPlayDev.state();
      const entities = [...state.players, ...state.bots];
      let minDistance = Infinity;
      for (let i = 0; i < entities.length; i += 1) {
        for (let j = i + 1; j < entities.length; j += 1) {
          minDistance = Math.min(minDistance, Math.hypot(entities[i].x - entities[j].x, entities[i].y - entities[j].y));
        }
      }
      rows.push({
        playerSafe: state.players[0].safe,
        playerView: state.players[0].viewClearance,
        botsSafe: state.bots.every((bot) => bot.safe),
        minDistance,
      });
    }
    return rows;
  })()`);
  assert.ok(spawnAudit.every((row) => row.playerSafe && row.botsSafe), "A Phantom Strike deployment intersected level geometry.");
  assert.ok(spawnAudit.every((row) => row.playerView >= 2.4), "A Phantom Strike deployment opened directly into a wall.");
  assert.ok(spawnAudit.every((row) => row.minDistance >= 2), "Phantom Strike placed opposing actors on the same spawn.");

  const occlusionAudit = await game.evaluate(`(() => {
    const test = window.__PhantomStrikeLegacyTest;
    test.start();
    const blocked = test.lineOfFire(1.5, 1.5, 3.5, 3.5);
    const open = test.lineOfFire(1.5, 1.5, 6.5, 1.5);
    test.setDevFlag("invulnerable", false);
    test.setDevFlag("botDamageScale", 1);
    test.teleport(1.5, 1.5);
    test.setSpawnShield(0);
    test.setHp(100);
    test.setBot(0, 3.5, 3.5, 0);
    for (let shot = 0; shot < 60; shot += 1) test.forceBotShot(0);
    const blockedHp = test.state().players[0].hp;
    test.setHp(100);
    test.setBot(0, 6.5, 1.5, Math.PI);
    for (let shot = 0; shot < 60; shot += 1) test.forceBotShot(0);
    const openHp = test.state().players[0].hp;
    test.setDevFlag("invulnerable", true);
    test.setDevFlag("botDamageScale", 0);
    return { blocked, open, blockedHp, openHp };
  })()`);
  assert.equal(occlusionAudit.blocked, false, "A full wall did not block line of fire.");
  assert.equal(occlusionAudit.open, true, "An open Blackridge lane was incorrectly marked blocked.");
  assert.equal(occlusionAudit.blockedHp, 100, "Bots damaged the player through a full wall.");
  assert.ok(occlusionAudit.openHp < 100, "The wall test was inconclusive because an open-lane bot could not damage the player.");

  await game.evaluate("window.__PhantomStrikeLegacyTest.start(); true");
  await sleep(120);
  const before = await game.evaluate("window.PhantomPlayDev.state()");
  assert.equal(await game.evaluate("window.PhantomPlayDev.action('grenade')"), true, "Native grenade action failed.");
  await sleep(120);
  const after = await game.evaluate("window.PhantomPlayDev.state()");
  assert.equal(after.players[0].grenades, before.players[0].grenades, "Infinite Grenades consumed inventory in Training Mode.");
  assert.ok(after.thrownGrenades.length > 0, "Native grenade action did not create a simulated projectile.");
  assert.deepEqual(after.bots.map((bot) => [bot.x, bot.y]), before.bots.map((bot) => [bot.x, bot.y]), "Frozen bots moved during the training interval.");

  await sleep(800);
  const hotVersion = await game.evaluate("window.__PHANTOMPLAY_HOT_VERSION__");
  assert.ok(Number.isFinite(Number(hotVersion)), "WebView2-compatible hot-reload polling never loaded its version script.");

  console.log(JSON.stringify({
    ok: true,
    nativeMods: nativeState.mods.length,
    active: nativeState.mods.filter((mod) => mod.active).map((mod) => mod.id),
    grenade: after.thrownGrenades[0],
    hotVersion,
  }, null, 2));
} finally {
  game?.socket.close();
  shell?.socket.close();
  await stop(child);
  await sleep(250);
  rmSync(profile, { recursive: true, force: true });
}
