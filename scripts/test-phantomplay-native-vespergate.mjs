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

async function waitForTargets(port, predicate, timeoutMs = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, { cache: "no-store" })).json();
      if (predicate(targets)) return targets;
    } catch {}
    await sleep(100);
  }
  throw new Error("Timed out waiting for PhantomPlay's Vespergate frame.");
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
  return { socket, evaluate };
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), sleep(3000)]);
}

const port = await freePort();
const profile = mkdtempSync(path.join(os.tmpdir(), "phantomplay-vespergate-"));
let child;
let shell;
let game;

try {
  child = spawn(executable, [], {
    cwd: shellRoot,
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
      const card = projects.find((node) => node.textContent.toLowerCase().includes("vespergate"));
      const run = card?.querySelector(".mini-action.is-primary");
      if (!run) return { ok: false, projects: projects.map((node) => node.textContent.trim()).slice(0, 60) };
      run.click();
      return { ok: true, projects: [] };
    })()`);
    if (launched.ok) break;
    await sleep(100);
  }
  assert.equal(launched.ok, true, `The native library could not launch Vespergate. Projects: ${launched.projects.join(" | ")}`);

  const gameTargets = await waitForTargets(port, (targets) => targets.some((target) => target.type === "iframe" && target.url.includes("vespergate/index.html")));
  const gameTarget = gameTargets.find((target) => target.type === "iframe" && target.url.includes("vespergate/index.html"));
  game = await connect(gameTarget);

  let audit;
  const started = Date.now();
  while (Date.now() - started < 8000) {
    audit = await game.evaluate(`(() => {
      if (!window.__VespergateTest) return null;
      const test = window.__VespergateTest;
      const before = test.state();
      test.newGame();
      test.skipScene();
      test.grant("hasVesperShield");
      test.maxHp(7);
      test.hp(7);
      const after = test.state();
      return {
        native: document.documentElement.getAttribute("data-pm-native"),
        gameId: document.documentElement.getAttribute("data-pm-game-id"),
        injectionPresent: document.documentElement.outerHTML.includes("__PHANTOMPLAY_MOD_BOOTSTRAP__"),
        hotVersion: window.__PHANTOMPLAY_HOT_VERSION__,
        status: document.querySelector("[data-vg-status]")?.textContent.trim(),
        titleAction: document.querySelector("[data-vg-new]")?.textContent.trim() || "",
        roomCount: test.rooms().length,
        before,
        after,
      };
    })()`);
    if (audit?.native === "true" && typeof audit.hotVersion === "number") break;
    await sleep(100);
  }

  assert.ok(audit, "Vespergate did not finish booting in the native player.");
  assert.equal(audit.native, "true", `Vespergate was not hosted by the native PhantomPlay runtime: ${JSON.stringify(audit)}`);
  assert.equal(typeof audit.hotVersion, "number", "The native hot-version contract is missing.");
  assert.match(audit.status, /Vespergate.*HD/u, "The current HD Vespergate surface did not render.");
  assert.ok(audit.roomCount >= 10, "The current multi-region Vespergate world did not load.");
  assert.ok(audit.after.flags.includes("hasVesperShield"), "The Vespershield progression is missing.");
  assert.equal(audit.after.hp, 7, "The current full-health beam-ready state is unavailable.");
  assert.equal(audit.after.maxHp, 7, "The current health progression did not initialize.");
  assert.ok(audit.after.renderScale >= 1, "The HD render scale is invalid.");
  assert.equal(audit.after.visualProfile, "living-dread-restored-v1", "The restored living-world visual profile is missing.");
  assert.equal(audit.after.characterProfile, "pointed-hood-asymmetric-mantle-v1", "The restored illustrated bearer profile is missing.");

  console.log(JSON.stringify({ ok: true, runtime: "PhantomPlay", game: "Vespergate 3.1.0", roomCount: audit.roomCount, native: audit.native }));
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
