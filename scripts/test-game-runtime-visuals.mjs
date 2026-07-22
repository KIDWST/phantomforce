import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const chromeCandidates = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

const games = [
  { id: "neon-drift", path: "/app/games/neon-drift.html?v=visual-qa" },
  { id: "phantom-rumble", path: "/app/games/phantom-rumble.html?v=visual-qa" },
  { id: "crown-circuit", path: "/app/games/crown-circuit.html?v=visual-qa" },
  { id: "rift-frenzy", path: "/app/games/rift-frenzy.html?v=visual-qa" },
  { id: "serpent-surge", path: "/app/games/serpent-surge.html?v=visual-qa" },
  { id: "logic-lights", path: "/app/games/logic-lights.html?v=visual-qa" },
  { id: "signal-match", path: "/app/games/signal-match.html?v=visual-qa" },
];

const viewports = [
  { id: "phone", width: 375, height: 812 },
  { id: "desktop", width: 1280, height: 820 },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function chromePath() {
  const found = chromeCandidates.find((candidate) => existsSync(candidate));
  assert.ok(found, `Chrome was not found. Tried: ${chromeCandidates.join(", ")}`);
  return found;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function stop(child) {
  if (!child || child.killed || child.exitCode !== null) return;
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    sleep(2500),
  ]);
  if (!child.killed && child.exitCode === null) child.kill();
}

async function waitForHttpOk(url, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return;
    } catch {}
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function spawnStaticServer(port) {
  return spawn(
    process.execPath,
    [path.join(repoRoot, "ops", "admin-live", "admin-static-server.mjs"), "--port", String(port), "--host", "127.0.0.1", "--api", "http://127.0.0.1:5190"],
    { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] },
  );
}

function spawnChrome(debugPort) {
  const userDataDir = path.join(os.tmpdir(), `pf-game-visuals-${process.pid}-${Date.now()}`);
  return {
    userDataDir,
    child: spawn(chromePath(), [
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${userDataDir}`,
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ], { stdio: ["ignore", "pipe", "pipe"] }),
  };
}

async function openTab(debugPort) {
  const response = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" });
  assert.ok(response.ok, `Could not open Chrome tab: ${response.status}`);
  const tab = await response.json();
  return tab.webSocketDebuggerUrl;
}

function cdpSocket(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    let nextId = 1;
    ws.addEventListener("open", () => {
      resolve({
        send(method, params = {}) {
          const id = nextId++;
          ws.send(JSON.stringify({ id, method, params }));
          return new Promise((res, rej) => pending.set(id, { res, rej }));
        },
        close() { ws.close(); },
      });
    });
    ws.addEventListener("message", (event) => {
      const data = JSON.parse(event.data);
      if (!data.id || !pending.has(data.id)) return;
      const { res, rej } = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) rej(new Error(data.error.message || JSON.stringify(data.error)));
      else res(data.result);
    });
    ws.addEventListener("error", reject);
  });
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Runtime evaluation failed");
  return result.result?.value;
}

async function auditGame(cdp, url, viewport, screenshotPath) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: viewport.id === "phone" ? 2 : 1,
    mobile: viewport.id === "phone",
  });
  await cdp.send("Page.navigate", { url });
  const started = Date.now();
  while (Date.now() - started < 8000) {
    const ready = await evaluate(cdp, "document.readyState").catch(() => "");
    if (ready === "complete") break;
    await sleep(100);
  }
  await sleep(900);
  const audit = await evaluate(cdp, `(${(() => {
    const visible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 8 && rect.height > 8;
    };
    const rgb = (value) => (String(value || "").match(/\\d+(?:\\.\\d+)?/g) || []).slice(0, 3).map(Number);
    const bg = getComputedStyle(document.body).backgroundColor;
    const colors = rgb(bg);
    const tooLight = colors.length === 3 && colors.every((channel) => channel > 220);
    const canvases = [...document.querySelectorAll("canvas")].filter(visible);
    const buttons = [...document.querySelectorAll("button")].filter(visible);
    const headings = [...document.querySelectorAll("h1,h2,.title,.logo")].filter(visible);
    const doc = document.documentElement;
    return {
      title: document.title,
      ready: document.readyState,
      bodyBackground: bg,
      tooLight,
      horizontalOverflow: doc.scrollWidth > innerWidth + 2,
      verticalContent: Math.max(doc.scrollHeight, document.body?.scrollHeight || 0),
      visibleButtons: buttons.length,
      visibleHeadings: headings.length,
      visibleCanvases: canvases.length,
      blankish: buttons.length + headings.length + canvases.length < 2,
    };
  }).toString()})()`);
  const capture = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(screenshotPath, Buffer.from(capture.data, "base64"));
  return audit;
}

const staticPort = await freePort();
const debugPort = await freePort();
const outDir = path.join(repoRoot, "tmp", "game-runtime-visuals", new Date().toISOString().replace(/[:.]/g, "-"));
mkdirSync(path.join(outDir, "screenshots"), { recursive: true });

const staticServer = spawnStaticServer(staticPort);
const chrome = spawnChrome(debugPort);
const audits = [];
let cdp = null;
try {
  await Promise.all([
    waitForHttpOk(`http://127.0.0.1:${staticPort}/health`),
    waitForHttpOk(`http://127.0.0.1:${debugPort}/json/version`),
  ]);
  cdp = await cdpSocket(await openTab(debugPort));
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  const baseUrl = `http://127.0.0.1:${staticPort}`;
  for (const game of games) {
    for (const viewport of viewports) {
      console.log(`[game-visual] ${game.id} ${viewport.id}`);
      const screenshot = path.join(outDir, "screenshots", `${game.id}-${viewport.id}.png`);
      const audit = await auditGame(cdp, `${baseUrl}${game.path}`, viewport, screenshot);
      audits.push({ game: game.id, viewport, screenshot, audit });
      assert.equal(audit.ready, "complete", `${game.id} ${viewport.id}: document must load.`);
      assert.equal(audit.tooLight, false, `${game.id} ${viewport.id}: game must not boot into a plain light/white surface.`);
      assert.equal(audit.horizontalOverflow, false, `${game.id} ${viewport.id}: game must not horizontally overflow.`);
      assert.equal(audit.blankish, false, `${game.id} ${viewport.id}: game must render visible playable UI/canvas.`);
    }
  }
  const report = path.join(outDir, "report.json");
  writeFileSync(report, JSON.stringify({ ok: true, checkedAt: new Date().toISOString(), audits }, null, 2));
  console.log(JSON.stringify({ ok: true, cases: audits.length, screenshots: path.join(outDir, "screenshots"), report }, null, 2));
} finally {
  cdp?.close();
  await stop(staticServer);
  await stop(chrome.child);
}
