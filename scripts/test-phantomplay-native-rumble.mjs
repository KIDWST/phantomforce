import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const shellRoot = path.join(root, "packages", "phantomplay-dioxus-shell");
const executable = [
  process.env.PHANTOMPLAY_TEST_EXECUTABLE,
  path.join(shellRoot, "target", "release", "PhantomPlay.exe"),
  path.join(shellRoot, "target", "dx", "PhantomPlay", "release", "windows", "app", "PhantomPlay.exe"),
].filter(Boolean).find(existsSync);
assert.ok(executable && existsSync(executable), "A built PhantomPlay.exe is required for the native Rumble gate.");

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

async function waitForTargets(port, predicate, timeoutMs = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, { cache: "no-store" })).json();
      if (predicate(targets)) return targets;
    } catch {}
    await sleep(100);
  }
  throw new Error("Timed out waiting for Phantom Rumble in the native PhantomPlay shell.");
}

async function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  const pending = new Map();
  const exceptions = [];
  let nextId = 1;
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown") {
      exceptions.push(message.params?.exceptionDetails?.exception?.description || message.params?.exceptionDetails?.text || "Unknown runtime exception");
      return;
    }
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
  return { socket, send, evaluate, exceptions };
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), sleep(3000)]);
}

const port = await freePort();
const profile = mkdtempSync(path.join(os.tmpdir(), "phantomplay-rumble-"));
let child;
let shell;
let game;

try {
  child = spawn(executable, [], {
    cwd: path.dirname(executable),
    env: {
      ...process.env,
      PHANTOMPLAY_LIVE_ROOT: root,
      PHANTOMPLAY_WEBVIEW_DATA_DIR: profile,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    },
    stdio: "ignore",
    windowsHide: true,
  });

  const shellTargets = await waitForTargets(port, (targets) => targets.some((target) => target.type === "page" && target.title === "PhantomPlay"));
  shell = await connect(shellTargets.find((target) => target.type === "page" && target.title === "PhantomPlay"));
  let launched;
  const libraryStarted = Date.now();
  while (Date.now() - libraryStarted < 8000) {
    launched = await shell.evaluate(`(() => {
      const projects = [...document.querySelectorAll(".project-row")];
      const card = projects.find((node) => node.textContent.toLowerCase().includes("phantom-rumble"));
      const run = card?.querySelector(".mini-action.is-primary");
      if (!run) return { ok: false, projects: projects.map((node) => node.textContent.trim()).slice(0, 60) };
      run.click();
      return { ok: true, projects: [] };
    })()`);
    if (launched.ok) break;
    await sleep(100);
  }
  assert.equal(launched.ok, true, `The native library could not launch Phantom Rumble. Projects: ${launched.projects.join(" | ")}`);

  const gameTargets = await waitForTargets(port, (targets) => targets.some((target) => target.type === "iframe" && target.url.includes("phantom-rumble.html")));
  game = await connect(gameTargets.find((target) => target.type === "iframe" && target.url.includes("phantom-rumble.html")));
  await game.evaluate("location.reload(); true");
  await sleep(250);

  let audit;
  const started = Date.now();
  while (Date.now() - started < 8000) {
    audit = await game.evaluate(`(() => {
      const test = window.__PhantomRumbleTest;
      if (!test) return {
        ready: false,
        href: location.href,
        documentState: document.readyState,
        native: document.documentElement.getAttribute("data-pm-native"),
        gameId: document.documentElement.getAttribute("data-pm-game-id"),
        hotVersion: window.__PHANTOMPLAY_HOT_VERSION__,
        body: document.body?.innerText?.slice(0, 300) || "",
      };
      const initial = test.startFixture();
      const firstBounce = test.bounceWall();
      return {
        ready: true,
        native: document.documentElement.getAttribute("data-pm-native"),
        gameId: document.documentElement.getAttribute("data-pm-game-id"),
        hotVersion: window.__PHANTOMPLAY_HOT_VERSION__,
        version: test.version,
        initial,
        firstBounce,
      };
    })()`);
    if (audit?.ready && audit.native === "true" && typeof audit.hotVersion === "number") break;
    await sleep(100);
  }

  assert.ok(audit?.ready, `Phantom Rumble did not finish booting in the native player: ${JSON.stringify({ audit, exceptions: game.exceptions })}`);
  assert.equal(audit.native, "true", `Phantom Rumble was not hosted by the native runtime: ${JSON.stringify(audit)}`);
  assert.equal(audit.version, "3.0.0-overdrive", "The installed shell loaded a stale Phantom Rumble build.");
  assert.equal(audit.initial.target.ricochet.maxBounces, 4, "The native build is missing WALLBREAKER ricochet physics.");
  assert.ok(audit.initial.effects.particles >= 40, "The native build is missing the Overdrive impact VFX stack.");
  assert.equal(audit.firstBounce.target.ricochet.bounces, 1, "The native build did not execute a fence bounce.");
  assert.equal(audit.firstBounce.effects.scars, 1, "The native build did not preserve arena damage.");

  console.log(JSON.stringify({ ok: true, runtime: "PhantomPlay.exe", game: "Phantom Rumble 3.0: Overdrive", native: audit.native, hotVersion: audit.hotVersion }));
} finally {
  shell?.socket.close();
  game?.socket.close();
  await stop(child);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    await sleep(2000);
    try { rmSync(profile, { recursive: true, force: true }); } catch {}
  }
}
