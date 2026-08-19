import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const chrome = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].filter(Boolean).find(existsSync);
assert.ok(chrome, "Chrome is required for the Phantom Rumble runtime gate.");

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

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), sleep(2500)]);
}

async function waitFor(url, predicate, timeoutMs = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) {
        const value = url.endsWith("/json/list") ? await response.json() : response;
        if (predicate(value)) return value;
      }
    } catch {}
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${url}`);
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
  await send("Page.enable");
  return {
    socket,
    send,
    evaluate: async (expression) => {
      const response = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || "Runtime evaluation failed");
      return response.result?.value;
    },
  };
}

const appPort = await freePort();
const debugPort = await freePort();
const profile = mkdtempSync(path.join(os.tmpdir(), "phantom-rumble-overdrive-"));
let server;
let browser;
let session;

try {
  server = spawn(process.execPath, [path.join(root, "ops", "admin-live", "admin-static-server.mjs"), "--port", String(appPort), "--host", "127.0.0.1", "--api", "http://127.0.0.1:5190"], { cwd: root, stdio: "ignore" });
  await waitFor(`http://127.0.0.1:${appPort}/app/games/phantom-rumble.html`, () => true);
  const gameUrl = `http://127.0.0.1:${appPort}/app/games/phantom-rumble.html?v=3.0.0-runtime-gate`;
  browser = spawn(chrome, [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1280,820",
    gameUrl,
  ], { stdio: "ignore", windowsHide: true });
  const targets = await waitFor(`http://127.0.0.1:${debugPort}/json/list`, (rows) => rows.some((row) => row.type === "page" && row.url.includes("phantom-rumble.html")));
  session = await connect(targets.find((row) => row.type === "page" && row.url.includes("phantom-rumble.html")));
  let ready = false;
  for (let i = 0; i < 80 && !ready; i += 1) {
    ready = await session.evaluate("Boolean(window.__PhantomRumbleTest)");
    if (!ready) await sleep(50);
  }
  assert.equal(ready, true, "Phantom Rumble must expose its deterministic runtime seam.");

  await session.evaluate("window.__PhantomRumbleTest.prepareInputFixture()");
  await session.send("Input.dispatchKeyEvent", { type: "keyDown", key: "g", code: "KeyG", windowsVirtualKeyCode: 71, nativeVirtualKeyCode: 71 });
  await sleep(1100);
  const held = await session.evaluate("window.__PhantomRumbleTest.state()");
  assert.equal(held.attacker.chargeReady, true, "Holding the real G input must reach MAX RUMBLE.");
  assert.ok(held.attacker.charge >= 0.98, `The real held input must preserve a full charge, got ${held.attacker.charge}.`);
  await session.send("Input.dispatchKeyEvent", { type: "keyUp", key: "g", code: "KeyG", windowsVirtualKeyCode: 71, nativeVirtualKeyCode: 71 });
  await sleep(80);
  const released = await session.evaluate("window.__PhantomRumbleTest.state()");
  assert.equal(released.attacker.chargeHeld, false, "Releasing G must end charging exactly once.");
  assert.equal(released.target.ricochet?.maxBounces, 4, "The real held-and-released input path must arm WALLBREAKER physics.");

  await session.evaluate("window.__PhantomRumbleTest.prepareInputFixture(); document.querySelector('[data-t=heavy]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7 }))");
  await sleep(1100);
  const touchHeld = await session.evaluate("window.__PhantomRumbleTest.state()");
  assert.equal(touchHeld.attacker.chargeReady, true, "Holding the touch SMASH control must reach MAX RUMBLE.");
  await session.evaluate("document.querySelector('[data-t=heavy]').dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7 }))");
  await sleep(80);
  const touchReleased = await session.evaluate("window.__PhantomRumbleTest.state()");
  assert.equal(touchReleased.target.ricochet?.maxBounces, 4, "The touch held-and-released path must arm the same WALLBREAKER physics.");

  const hit = await session.evaluate("window.__PhantomRumbleTest.startFixture()");
  assert.equal(hit.version, "3.0.0-overdrive");
  assert.equal(hit.target.ricochet.maxBounces, 4, "A MAX RUMBLE hit must arm four collision opportunities.");
  assert.ok(hit.target.vx > 0.02, `The wallbreaker launch must carry real horizontal force, got ${hit.target.vx}.`);
  assert.ok(hit.effects.particles >= 40, "The initial wallbreaker impact must emit the full layered burst.");
  assert.ok(hit.effects.hitstop > 0 && hit.effects.cameraPunch >= 1, "The initial wallbreaker impact must trigger hit-stop and camera punch.");

  const firstBounce = await session.evaluate("window.__PhantomRumbleTest.bounceWall()");
  assert.equal(firstBounce.target.ricochet.bounces, 1, "The first fence impact must increment the ricochet chain.");
  assert.ok(firstBounce.target.vx < 0, "The first fence impact must reverse horizontal velocity.");
  assert.equal(firstBounce.effects.scars, 1, "The first fence impact must leave an arena scar.");
  assert.ok(firstBounce.target.pct > hit.target.pct, "Each ricochet collision must add real damage.");
  const capture = await session.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  const artifactDir = path.join(root, "tmp", "phantom-rumble-overdrive");
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(path.join(artifactDir, "wallbreaker-runtime.png"), Buffer.from(capture.data, "base64"));

  await session.evaluate("window.__PhantomRumbleTest.bounceWall()");
  await session.evaluate("window.__PhantomRumbleTest.bounceWall()");
  const finisher = await session.evaluate("window.__PhantomRumbleTest.bounceWall()");
  assert.equal(finisher.target.ricochet, null, "The ricochet chain must terminate cleanly after PHANTOM PINBALL.");
  assert.equal(finisher.effects.scars, 4, "The full chain must preserve all four readable collision scars.");
  assert.ok(finisher.effects.particles > firstBounce.effects.particles, "Each collision must escalate the particle spectacle.");

  console.log(JSON.stringify({ ok: true, version: hit.version, heldInput: { held, released }, touchInput: { held: touchHeld, released: touchReleased }, initial: hit, firstBounce, finisher }, null, 2));
} finally {
  if (session) session.socket.close();
  await stop(browser);
  await stop(server);
  rmSync(profile, { recursive: true, force: true });
}
