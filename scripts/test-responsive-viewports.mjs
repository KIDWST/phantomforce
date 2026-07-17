import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

const pages = [
  { id: "dashboard", label: "dashboard" },
  { id: "leads", label: "clients" },
  { id: "media", label: "media-lab" },
  { id: "content", label: "content-hub" },
  { id: "analytics", label: "analytics" },
  { id: "phantomplay", label: "phantomplay" },
  { id: "settings", label: "settings" },
];

const viewports = [
  { width: 320, height: 780 },
  { width: 375, height: 812 },
  { width: 768, height: 900 },
  { width: 1024, height: 900 },
  { width: 1440, height: 1000 },
  { width: 1920, height: 1080 },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function stopProcess(child, timeoutMs = 3000) {
  if (!child || child.killed || child.exitCode !== null) return;
  const stopped = new Promise((resolve) => {
    child.once("exit", resolve);
    child.once("error", resolve);
  });
  child.kill();
  await Promise.race([stopped, sleep(timeoutMs)]);
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function getChromePath() {
  const found = chromeCandidates.find((candidate) => existsSync(candidate));
  assert.ok(found, `Chrome was not found. Tried: ${chromeCandidates.join(", ")}`);
  return found;
}

function getFreePort() {
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

async function waitForHttpOk(url, { timeoutMs = 15_000 } = {}) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${url}${lastError ? ` (${lastError.message})` : ""}`);
}

function spawnStaticServer(port) {
  const output = [];
  const child = spawn(process.execPath, [
    path.join(repoRoot, "ops", "admin-live", "admin-static-server.mjs"),
    "--root", repoRoot,
    "--port", String(port),
    "--host", "127.0.0.1",
    "--api", "http://127.0.0.1:5190",
  ], {
    cwd: repoRoot,
    windowsHide: true,
    env: {
      ...process.env,
      CREATIVE_ENGINE_TRANSPORT: "disabled",
      HIGGSFIELD_CLI_FALLBACK_ENABLED: "false",
    },
  });
  child.stdout.on("data", (chunk) => output.push(String(chunk)));
  child.stderr.on("data", (chunk) => output.push(String(chunk)));
  return { child, output };
}

async function spawnChrome(debugPort, userDataDir) {
  const chromePath = getChromePath();
  const child = spawn(chromePath, [
    "--headless=new",
    `--remote-debugging-port=${debugPort}`,
    "--remote-allow-origins=*",
    `--user-data-dir=${userDataDir}`,
    "--disable-gpu",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-dev-shm-usage",
    "--disable-features=Translate,OptimizationHints,MediaRouter",
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1440,1000",
    "about:blank",
  ], {
    cwd: repoRoot,
    windowsHide: true,
    stdio: "ignore",
  });
  await waitForHttpOk(`http://127.0.0.1:${debugPort}/json/version`, { timeoutMs: 15_000 });
  return child;
}

async function openPageTarget(debugPort) {
  const response = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" });
  if (!response.ok) throw new Error(`Chrome target creation failed (${response.status})`);
  const target = await response.json();
  if (!target.webSocketDebuggerUrl) throw new Error("Chrome target did not expose a debugger websocket.");
  return target.webSocketDebuggerUrl;
}

function createCdpClient(webSocketUrl) {
  const ws = new WebSocket(webSocketUrl);
  let nextId = 0;
  const pending = new Map();
  const listeners = new Map();

  const opened = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out opening Chrome websocket.")), 10_000);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("Chrome websocket failed to open."));
    }, { once: true });
  });

  ws.addEventListener("message", (event) => {
    const raw = typeof event.data === "string" ? event.data : Buffer.from(event.data).toString("utf8");
    const message = JSON.parse(raw);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject, timer } = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(timer);
      if (message.error) reject(new Error(`${message.error.message || "CDP error"} (${message.error.code || "unknown"})`));
      else resolve(message.result || {});
      return;
    }
    const eventListeners = listeners.get(message.method) || [];
    eventListeners.slice().forEach((listener) => listener(message));
  });

  const send = async (method, params = {}, timeoutMs = 20_000) => {
    await opened;
    const id = ++nextId;
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      ws.send(payload);
    });
  };

  const waitEvent = async (method, timeoutMs = 15_000) => {
    await opened;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const eventListeners = listeners.get(method) || [];
        listeners.set(method, eventListeners.filter((listener) => listener !== onEvent));
        reject(new Error(`Timed out waiting for ${method}`));
      }, timeoutMs);
      const onEvent = (message) => {
        clearTimeout(timer);
        const eventListeners = listeners.get(method) || [];
        listeners.set(method, eventListeners.filter((listener) => listener !== onEvent));
        resolve(message);
      };
      const eventListeners = listeners.get(method) || [];
      eventListeners.push(onEvent);
      listeners.set(method, eventListeners);
    });
  };

  const close = () => {
    try { ws.close(); } catch {}
  };

  return { send, waitEvent, close };
}

async function evaluate(cdp, expression, timeoutMs = 20_000) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, timeoutMs);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "Runtime.evaluate failed");
  }
  return result.result?.value;
}

async function waitForApp(cdp, expectedPage) {
  const expression = `(${(() => {
    const phantom = document.querySelector("[data-phantom]");
    const gate = document.querySelector("[data-gate]");
    const gateVisible = !!gate && !gate.hidden && getComputedStyle(gate).display !== "none";
    const phantomVisible = !!phantom && !phantom.hidden && getComputedStyle(phantom).display !== "none";
    return { gateVisible, phantomVisible };
  }).toString()})()`;

  const started = Date.now();
  while (Date.now() - started < 12_000) {
    const state = await evaluate(cdp, expression).catch(() => null);
    if (state?.phantomVisible) break;
    if (state?.gateVisible) {
      await evaluate(cdp, `(() => {
        const button = document.querySelector('[data-enter="admin"]');
        if (button) { button.click(); return true; }
        return false;
      })()`).catch(() => null);
    }
    await sleep(250);
  }

  const pageExpression = `(${((page) => {
    const phantom = document.querySelector("[data-phantom]");
    const gate = document.querySelector("[data-gate]");
    const phantomVisible = !!phantom && !phantom.hidden && getComputedStyle(phantom).display !== "none";
    const gateVisible = !!gate && !gate.hidden && getComputedStyle(gate).display !== "none";
    const workspace = document.querySelector("[data-workspace-page]");
    const consoleRoot = document.querySelector("[data-console]");
    return {
      phantomVisible,
      gateVisible,
      workspacePage: workspace?.dataset.workspacePage || "",
      consoleVisible: !!consoleRoot && consoleRoot.getBoundingClientRect().width > 100 && consoleRoot.getBoundingClientRect().height > 100,
      ready: phantomVisible && !gateVisible && (page === "dashboard" ? !!consoleRoot : workspace?.dataset.workspacePage === page),
      text: document.body.innerText.slice(0, 400),
    };
  }).toString()})(${JSON.stringify(expectedPage)})`;

  while (Date.now() - started < 18_000) {
    const state = await evaluate(cdp, pageExpression).catch(() => null);
    if (state?.ready) return state;
    await sleep(300);
  }
  return evaluate(cdp, pageExpression);
}

function auditPage() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const doc = document.documentElement;
  const body = document.body;
  const workspace = document.querySelector("[data-workspace-page]");
  const consoleRoot = document.querySelector("[data-console]");
  const nav = document.querySelector("[data-nav]");
  const mobileNav = document.querySelector("[data-mobile-bottom-nav]");
  const isVisible = (el) => {
    if (!el) return false;
    if (el.closest('[aria-hidden="true"]')) return false;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 1 && rect.height > 1;
  };
  const clipsOverflow = (node) => {
    const style = getComputedStyle(node);
    return /(auto|scroll|hidden|clip)/.test(`${style.overflowX} ${style.overflowY}`);
  };
  const intersect = (a, b) => ({
    left: Math.max(a.left, b.left),
    right: Math.min(a.right, b.right),
    top: Math.max(a.top, b.top),
    bottom: Math.min(a.bottom, b.bottom),
  });
  const visibleRect = (el) => {
    let rect = el.getBoundingClientRect();
    let box = { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    let node = el.parentElement;
    while (node && node !== document.body && node !== document.documentElement) {
      if (clipsOverflow(node)) {
        const clip = node.getBoundingClientRect();
        box = intersect(box, { left: clip.left, right: clip.right, top: clip.top, bottom: clip.bottom });
      }
      if (box.right <= box.left || box.bottom <= box.top) return box;
      node = node.parentElement;
    }
    return box;
  };
  const insideHorizontalScroller = (el) => {
    let node = el.parentElement;
    while (node && node !== document.body) {
      const style = getComputedStyle(node);
      if (/(auto|scroll)/.test(style.overflowX) && node.scrollWidth > node.clientWidth + 4) return true;
      node = node.parentElement;
    }
    return false;
  };
  const selectorName = (el) => [
    el.tagName.toLowerCase(),
    el.id ? `#${el.id}` : "",
    String(el.className || "").trim().split(/\s+/).filter(Boolean).slice(0, 4).map((cls) => `.${cls}`).join(""),
  ].join("");
  const elementSummary = (el) => {
    const rect = visibleRect(el);
    return {
      selector: selectorName(el).slice(0, 120),
      text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 90),
      left: Math.round(rect.left),
      right: Math.round(rect.right),
      top: Math.round(rect.top),
      bottom: Math.round(rect.bottom),
      clientWidth: Math.round(el.clientWidth || 0),
      scrollWidth: Math.round(el.scrollWidth || 0),
      clientHeight: Math.round(el.clientHeight || 0),
      scrollHeight: Math.round(el.scrollHeight || 0),
    };
  };
  const fixedOk = (el) => {
    const style = getComputedStyle(el);
    return style.position === "fixed" && (el.closest("[data-mobile-bottom-nav]") || el.classList.contains("mobile-bottom-nav"));
  };

  const offenders = [...document.body.querySelectorAll("*")]
    .filter(isVisible)
    .filter((el) => !fixedOk(el))
    .filter((el) => !insideHorizontalScroller(el))
    .filter((el) => {
      const rect = visibleRect(el);
      if (rect.right <= rect.left || rect.bottom <= rect.top) return false;
      return rect.right > vw + 2 || rect.left < -2;
    })
    .slice(0, 10)
    .map(elementSummary);

  const clippedText = [...document.querySelectorAll([
    "button",
    ".nav-item span",
    ".mobile-bottom-item span",
    ".pill",
    ".workspace-page-head h1",
    ".ml-tabs button",
    ".ch-tabs button",
    ".gate-opt b",
    ].join(","))]
    .filter(isVisible)
    .filter((el) => {
      const rect = visibleRect(el);
      if (rect.right <= rect.left || rect.bottom <= rect.top) return false;
      const style = getComputedStyle(el);
      if (style.textOverflow === "ellipsis") return false;
      if (style.overflowX === "hidden" && style.whiteSpace === "nowrap") return false;
      const isClipped = (node) => {
        const box = visibleRect(node);
        if (box.right <= box.left || box.bottom <= box.top) return false;
        return node.scrollWidth > node.clientWidth + 3 || node.scrollHeight > node.clientHeight + 4;
      };
      if (el.querySelector('[aria-hidden="true"]')) {
        const labelChildren = [...el.children].filter((child) => !child.closest('[aria-hidden="true"]') && isVisible(child));
        if (labelChildren.length) return labelChildren.some(isClipped);
      }
      return isClipped(el);
    })
    .slice(0, 10)
    .map(elementSummary);

  const mobileRect = mobileNav?.getBoundingClientRect();
  const consoleRect = consoleRoot?.getBoundingClientRect();
  const pageRect = workspace?.getBoundingClientRect();
  return {
    title: document.title,
    hash: location.hash,
    viewport: { width: vw, height: vh },
    workspacePage: workspace?.dataset.workspacePage || "",
    pageVisible: workspace ? pageRect.width > 100 && pageRect.height > 100 : consoleRect?.width > 100 && consoleRect?.height > 100,
    bodyScrollWidth: Math.max(doc.scrollWidth, body?.scrollWidth || 0),
    horizontalOverflow: Math.max(doc.scrollWidth, body?.scrollWidth || 0) > vw + 2,
    offenders,
    clippedText,
    nav: {
      desktopVisible: isVisible(nav),
      mobileVisible: isVisible(mobileNav),
      mobileTop: mobileRect ? Math.round(mobileRect.top) : null,
      mobileBottom: mobileRect ? Math.round(mobileRect.bottom) : null,
    },
    textProbe: document.body.innerText.slice(0, 300),
  };
}

/* Interaction-level probes: run inside the page after the base audit, for a
   small representative subset of viewports (not every case — Chrome/CDP
   round-trips add up fast). Each probe clicks a real control and re-runs the
   same overflow/clipping audit so a dialog, popover, or tab body that only
   appears after interaction is not a blind spot the static-load audit misses. */
function clickAndAudit(selector) {
  const el = document.querySelector(selector);
  if (!el) return { clicked: false };
  el.click();
  return { clicked: true };
}

function focusTraversalProbe() {
  const before = document.activeElement;
  const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true });
  document.body.focus?.();
  document.dispatchEvent(event);
  const focusables = [...document.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 1 && rect.height > 1 && !el.disabled;
    });
  if (focusables[0]) focusables[0].focus();
  const after = document.activeElement;
  const focusVisible = after && after !== document.body && after !== before;
  const outline = after ? getComputedStyle(after).outlineStyle : "none";
  return {
    focusableCount: focusables.length,
    focusMoved: focusVisible,
    focusedTag: after ? after.tagName.toLowerCase() : null,
    outlineStyle: outline,
  };
}

const INTERACTIONS = {
  settings: {
    label: "open Plan & access tab",
    selector: '[data-set-tab="plan"]',
    settleMs: 500,
  },
  media: {
    label: "open Edit tab",
    selector: '[data-ml-tab="edit"], .ml-tabs button',
    settleMs: 400,
  },
};

async function runViewportCase(cdp, baseUrl, screenshotDir, page, viewport, { navigate = true, interact = false } = {}) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: viewport.width < 768,
  });
  if (navigate) {
    const targetUrl = `${baseUrl}/app/?session=owner-admin#page/${page.id}`;
    const loadEvent = cdp.waitEvent("Page.loadEventFired", 15_000).catch(() => null);
    await cdp.send("Page.navigate", { url: targetUrl });
    await loadEvent;
    await sleep(450);
  } else {
    await sleep(250);
  }
  const appState = await waitForApp(cdp, page.id);

  let interaction = null;
  const probe = INTERACTIONS[page.id];
  if (interact && probe) {
    const clickResult = await evaluate(cdp, `(${clickAndAudit.toString()})(${JSON.stringify(probe.selector)})`).catch(() => null);
    await sleep(probe.settleMs);
    interaction = { label: probe.label, ...clickResult };
  }

  const focus = interact ? await evaluate(cdp, `(${focusTraversalProbe.toString()})()`).catch(() => null) : null;
  const audit = await evaluate(cdp, `(${auditPage.toString()})()`);
  const png = await cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  }, 20_000);
  const suffix = interact ? "-interact" : "";
  const file = path.join(screenshotDir, `${page.label}-${viewport.width}x${viewport.height}${suffix}.png`);
  writeFileSync(file, Buffer.from(png.data, "base64"));
  return { page: page.id, label: page.label, viewport, appState, audit, interaction, focus, screenshot: file };
}

function assertCase(result) {
  const { page, label, viewport, audit, appState } = result;
  assert.equal(appState?.gateVisible, false, `${label} ${viewport.width}: auth gate must not remain visible during local QA.`);
  assert.equal(appState?.phantomVisible, true, `${label} ${viewport.width}: Phantom shell must be visible.`);
  if (page !== "dashboard") {
    assert.equal(audit.workspacePage, page, `${label} ${viewport.width}: expected workspace page ${page}, got ${audit.workspacePage || "none"}.`);
  }
  assert.equal(audit.pageVisible, true, `${label} ${viewport.width}: page body must be visible.`);
  assert.equal(audit.horizontalOverflow, false, `${label} ${viewport.width}: document has horizontal overflow (${audit.bodyScrollWidth}px > ${viewport.width}px).`);
  assert.deepEqual(audit.offenders, [], `${label} ${viewport.width}: visible elements escape the viewport.`);
  assert.deepEqual(audit.clippedText, [], `${label} ${viewport.width}: visible control text is clipped.`);
  if (viewport.width < 768) {
    assert.equal(audit.nav.mobileVisible, true, `${label} ${viewport.width}: mobile bottom nav must be visible.`);
    assert.equal(audit.nav.desktopVisible, false, `${label} ${viewport.width}: desktop sidebar must be hidden on phone widths.`);
  }
  if (viewport.width > 900) {
    assert.equal(audit.nav.desktopVisible, true, `${label} ${viewport.width}: desktop sidebar must be visible.`);
  }
}

function assertInteraction(result) {
  const { label, viewport, interaction, focus, audit } = result;
  if (interaction) {
    assert.equal(interaction.clicked, true, `${label} ${viewport.width}: interaction target "${interaction.label}" must exist and be clickable.`);
    assert.equal(audit.horizontalOverflow, false, `${label} ${viewport.width}: "${interaction.label}" must not introduce horizontal overflow.`);
    assert.deepEqual(audit.offenders, [], `${label} ${viewport.width}: "${interaction.label}" must not push visible elements outside the viewport.`);
    assert.deepEqual(audit.clippedText, [], `${label} ${viewport.width}: "${interaction.label}" must not clip visible control text.`);
  }
  if (focus) {
    assert.ok(focus.focusableCount > 0, `${label} ${viewport.width}: page must expose at least one focusable control for keyboard users.`);
    assert.equal(focus.focusMoved, true, `${label} ${viewport.width}: keyboard focus must be able to move onto a real control.`);
  }
}

async function main() {
  assert.equal(typeof WebSocket, "function", "Node 22+ global WebSocket is required for the Chrome CDP responsive smoke test.");

  const staticPort = await getFreePort();
  const debugPort = await getFreePort();
  const baseUrl = `http://127.0.0.1:${staticPort}`;
  const runDir = path.join(repoRoot, "tmp", "responsive-viewports", timestamp());
  const screenshotDir = path.join(runDir, "screenshots");
  const userDataDir = path.join(os.tmpdir(), `phantomforce-responsive-chrome-${process.pid}-${Date.now()}`);
  mkdirSync(screenshotDir, { recursive: true });

  const staticServer = spawnStaticServer(staticPort);
  let chrome = null;
  let cdp = null;
  const results = [];
  try {
    await waitForHttpOk(`${baseUrl}/health`, { timeoutMs: 15_000 });
    chrome = await spawnChrome(debugPort, userDataDir);
    const wsUrl = await openPageTarget(debugPort);
    cdp = createCdpClient(wsUrl);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");

    for (const page of pages) {
      let navigate = true;
      for (const viewport of viewports) {
        console.error(`[responsive] ${page.label} ${viewport.width}x${viewport.height}`);
        const result = await runViewportCase(cdp, baseUrl, screenshotDir, page, viewport, { navigate });
        navigate = false;
        results.push(result);
        assertCase(result);
      }
    }

    /* Interaction-level pass: a small representative subset of viewports
       (phone + desktop), only for pages with a registered probe, on a fresh
       navigation so prior static-audit clicks/state cannot leak in. */
    const interactionViewports = viewports.filter((v) => v.width === 375 || v.width === 1440);
    for (const page of pages) {
      if (!INTERACTIONS[page.id]) continue;
      let navigate = true;
      for (const viewport of interactionViewports) {
        console.error(`[responsive:interact] ${page.label} ${viewport.width}x${viewport.height} — ${INTERACTIONS[page.id].label}`);
        const result = await runViewportCase(cdp, baseUrl, screenshotDir, page, viewport, { navigate, interact: true });
        navigate = false;
        results.push(result);
        assertCase(result);
        assertInteraction(result);
      }
    }

    const summary = {
      ok: true,
      checkedAt: new Date().toISOString(),
      chrome: getChromePath(),
      pages: pages.map((page) => page.id),
      viewports,
      cases: results.length,
      screenshots: screenshotDir,
      report: path.join(runDir, "report.json"),
      checks: [
        "local admin QA session renders",
        "requested workspace page renders",
        "phone bottom nav visible under 768px",
        "desktop sidebar visible above tablet widths",
        "document has no horizontal overflow",
        "visible elements do not escape viewport",
        "visible control text is not clipped",
        "registered interaction targets (Settings Plan & access tab, Media Lab Edit tab) are clickable and open without overflow/clipping at phone and desktop widths",
        "keyboard focus can move onto a real control after interaction",
      ],
      interactionProbes: Object.fromEntries(Object.entries(INTERACTIONS).map(([id, probe]) => [id, probe.label])),
    };
    writeFileSync(summary.report, JSON.stringify({ ...summary, results }, null, 2));
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    cdp?.close();
    await stopProcess(chrome);
    await stopProcess(staticServer.child);
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // Chrome can keep profile databases locked for a beat on Windows; the
      // responsive result should not be marked failed by temp-dir cleanup.
    }
  }
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
