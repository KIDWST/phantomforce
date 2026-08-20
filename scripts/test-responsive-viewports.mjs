import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
/* Responsive QA must not inherit whichever real account system happens to be
   running on the developer machine. An explicit override can exercise a live
   API, while the default keeps the local owner shortcut deterministic. */
const apiOrigin = process.env.PHANTOMFORCE_RESPONSIVE_API_ORIGIN || "http://127.0.0.1:1";
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
  { id: "phantomai", label: "phantombot" },
  { id: "leads", label: "clients" },
  { id: "media", label: "media-lab" },
  { id: "content", label: "content-hub" },
  { id: "analytics", label: "analytics" },
  { id: "sites", label: "websites" },
  { id: "phantomplay", label: "phantomplay" },
  { id: "phantomstore", label: "phantomstore" },
  { id: "settings", label: "settings" },
  { id: "adminos", label: "admin" },
];

const viewports = [
  { width: 320, height: 780 },
  { width: 375, height: 812 },
  { width: 768, height: 900 },
  { width: 1024, height: 900 },
  { width: 1440, height: 1000 },
  { width: 1920, height: 1080 },
];

const requestedPages = new Set(String(process.env.PHANTOMFORCE_RESPONSIVE_PAGES || "").split(",").map((value) => value.trim()).filter(Boolean));
if (requestedPages.size) pages.splice(0, pages.length, ...pages.filter((page) => requestedPages.has(page.id) || requestedPages.has(page.label)));
const requestedWidths = new Set(String(process.env.PHANTOMFORCE_RESPONSIVE_WIDTHS || "").split(",").map((value) => value.trim()).filter(Boolean).map(Number).filter(Number.isFinite));
if (requestedWidths.size) viewports.splice(0, viewports.length, ...viewports.filter((viewport) => requestedWidths.has(viewport.width)));
const requestedSettingsTab = String(process.env.PHANTOMFORCE_RESPONSIVE_SETTINGS_TAB || "").trim();
const requestedMediaTab = String(process.env.PHANTOMFORCE_RESPONSIVE_MEDIA_TAB || "").trim();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function injectDashboardDecisionFixture() {
  const deck = document.querySelector("[data-decisions]");
  if (!deck) return;
  deck.hidden = false;
  deck.innerHTML = `
    <div class="decision-head">
      <h2>Decisions</h2><span class="decision-count">13</span>
      <i>Signals packaged for one motion — approve, adjust, or dismiss.</i>
      <button class="decision-review-all" type="button" data-open-ws="approvals">Review all 13</button>
    </div>
    <div class="decision-list">
      ${[1, 2, 3, 4].map((index) => `
        <article class="decision-card dc-high" data-decision-id="responsive-${index}">
          <header class="decision-meta">
            <span class="decision-dept">Technology</span><span class="decision-impact di-high">high impact</span><span class="decision-conf">confidence: high</span>
          </header>
          <h3>Platform automation failing: PhantomCut Lane Health Check</h3>
          <p>PhantomCut media lane unreachable at http://127.0.0.1:8787. This is a platform-level job and affects the whole installation.</p>
          <p class="decision-evidence">Evidence: automation-engine</p>
          <footer class="decision-actions">
            <button class="btn btn-primary" type="button">Approve · Open automations</button>
            <button class="btn" type="button">Adjust</button>
            <button class="btn btn-quiet" type="button">Dismiss</button>
          </footer>
        </article>`).join("")}
    </div>`;
}

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
    "--api", apiOrigin,
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

  const send = async (method, params = {}, timeoutMs = 45_000) => {
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
    const boot = document.querySelector("[data-boot-fallback]");
    const visible = (el) => {
      if (!el || el.hidden) return false;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 1 && rect.height > 1;
    };
    return { gateVisible: visible(gate), phantomVisible: visible(phantom), bootVisible: visible(boot) };
  }).toString()})()`;

  const started = Date.now();
  while (Date.now() - started < 12_000) {
    const state = await evaluate(cdp, expression).catch(() => null);
    if (state?.phantomVisible && !state?.bootVisible) break;
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
    const boot = document.querySelector("[data-boot-fallback]");
    const visible = (el) => {
      if (!el || el.hidden) return false;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 1 && rect.height > 1;
    };
    const phantomVisible = visible(phantom);
    const gateVisible = visible(gate);
    const bootVisible = visible(boot);
    const workspace = document.querySelector("[data-workspace-page]");
    const consoleRoot = document.querySelector("[data-console]");
    const dashboardBrief = document.querySelector("[data-dashboard-brief-title]");
    const dashboardReady = visible(consoleRoot) && visible(dashboardBrief) && !/POWER-ON|MEMORY SPINE|records indexed/u.test(document.body.innerText || "");
    return {
      phantomVisible,
      gateVisible,
      bootVisible,
      workspacePage: workspace?.dataset.workspacePage || "",
      consoleVisible: visible(consoleRoot),
      dashboardReady,
      ready: phantomVisible && !gateVisible && !bootVisible && (page === "dashboard" ? dashboardReady : workspace?.dataset.workspacePage === page),
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
  const commandRail = document.querySelector("[data-os-command-rail]");
  const commandRailNav = commandRail?.querySelector(".os-primary-nav");
  const commandRailActions = commandRail?.querySelector(".os-rail-actions");
  const commandRailActive = commandRail?.querySelector(".os-primary-nav .is-active");
  const mobileHomebar = document.querySelector(".mobile-admin-homebar");
  const stickyTopbar = document.querySelector(".topbar2");
  const systemLine = document.querySelector(".os-system-line");
  const mobileNav = document.querySelector("[data-mobile-bottom-nav]");
  const dashboardBrief = document.querySelector(".dashboard-brief");
  const decisionDeck = document.querySelector(".decision-deck");
  const dashboardHero = consoleRoot?.querySelector(".hero2");
  const dashboardPet = document.querySelector("[data-buddy]");
  const productCards = [...document.querySelectorAll(".ps-product")];
  const productMedia = [...document.querySelectorAll(".ps-product-media")];
  const featuredProductMedia = document.querySelector(".ps-spotlight-panel");
  const phantomPlayActions = [...document.querySelectorAll(".pp-game-actions button")];
  const pageWorker = document.querySelector(".page-worker");
  const storeSearch = document.querySelector(".ps-search");
  const analyticsGraph = document.querySelector("[data-workspace-page='analytics'] .an-top-visual-grid, [data-workspace-page='analytics'] .an-domain-shell .an-visual-grid");
  const analyticsTrendCard = document.querySelector("[data-workspace-page='analytics'] .an-trend-card");
  const dashboardIntel = document.querySelector("[data-dashboard-intel]");
  const dashboardIntelGrid = dashboardIntel?.querySelector(".dashboard-intel-grid");
  const dashboardIntelCards = [...(dashboardIntel?.querySelectorAll(".dashboard-intel-card") || [])];
  const phantomBotShell = document.querySelector("[data-phantombot-os]");
  const phantomBotTaskRail = document.querySelector("[data-phantombot-taskrail]");
  const phantomBotTaskList = document.querySelector("[data-phantombot-task-list]");
  const phantomBotComposer = document.querySelector("[data-phantomai-chat-input]");
  const phantomBotRailToggles = [...document.querySelectorAll("[data-phantombot-rail-toggle]")];
  const commandRailSearch = document.querySelector("[data-os-command-rail] [data-cmdk-open]");
  const isVisible = (el) => {
    if (!el) return false;
    if (el.closest('[aria-hidden="true"]')) return false;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== "none"
      && style.visibility !== "hidden"
      && Number(style.opacity || "1") > 0.01
      && rect.width > 1
      && rect.height > 1
      && rect.right > 0
      && rect.bottom > 0
      && rect.left < window.innerWidth
      && rect.top < window.innerHeight;
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
  const parseRgb = (value = "") => {
    const match = String(value).match(/rgba?\(([^)]+)\)/i);
    if (!match) return null;
    const parts = match[1].split(",").map((part) => Number.parseFloat(part.trim()));
    if (parts.length < 3 || parts.slice(0, 3).some((part) => Number.isNaN(part))) return null;
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length >= 4 && !Number.isNaN(parts[3]) ? parts[3] : 1 };
  };
  const luminance = ({ r, g, b }) => (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
  const relativeLuminance = ({ r, g, b }) => {
    const channel = (value) => {
      const ratio = value / 255;
      return ratio <= 0.04045 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
    };
    return (0.2126 * channel(r)) + (0.7152 * channel(g)) + (0.0722 * channel(b));
  };
  const contrastRatio = (foreground, background) => {
    const fg = relativeLuminance(foreground);
    const bg = relativeLuminance(background);
    return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
  };
  const isAllowedPaleSurface = (el) => {
    if (el.closest("img, video, canvas, svg, picture")) return true;
    if (el.matches("img, video, canvas, svg, path, circle, rect, line, polyline, polygon")) return true;
    if (el.closest(".ps-product-media, .pp-game-art, .ml-stage-view, .ml-pool-thumb, .ch-pub-preview-media, .ch-asset-thumb, .site-preview-media")) return true;
    return false;
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

  const paleSurfaces = [...document.body.querySelectorAll("*")]
    .filter(isVisible)
    .filter((el) => !isAllowedPaleSurface(el))
    .filter((el) => {
      const raw = el.getBoundingClientRect();
      if (raw.width * raw.height < 2800) return false;
      const color = parseRgb(getComputedStyle(el).backgroundColor);
      if (!color || color.a < 0.68) return false;
      const maxChannel = Math.max(color.r, color.g, color.b);
      const minChannel = Math.min(color.r, color.g, color.b);
      return luminance(color) > 218 && maxChannel - minChannel < 38;
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
  const navSurfaceEntries = [
    ["sidebar", nav],
    ["command-rail", commandRail],
    ["mobile-homebar", mobileHomebar],
    ["topbar", stickyTopbar],
    ["system-line", systemLine],
    ["bottom-dock", mobileNav],
  ].filter(([, el]) => isVisible(el));
  const navSurfaces = navSurfaceEntries.map(([name, el]) => {
    const rect = el.getBoundingClientRect();
    return {
      name,
      top: Math.round(rect.top),
      bottom: Math.round(rect.bottom),
      height: Math.round(rect.height),
    };
  });
  const dashboardSurfaces = [dashboardBrief, decisionDeck, dashboardHero].filter(isVisible);
  const decisionList = document.querySelector(".decision-list");
  const decisionCards = [...document.querySelectorAll(".decision-card")];
  const decisionReviewAll = document.querySelector(".decision-review-all");
  const dashboardCollisions = [];
  for (let index = 0; index < dashboardSurfaces.length; index += 1) {
    for (let next = index + 1; next < dashboardSurfaces.length; next += 1) {
      const first = dashboardSurfaces[index];
      const second = dashboardSurfaces[next];
      const a = first.getBoundingClientRect();
      const b = second.getBoundingClientRect();
      const overlapWidth = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const overlapHeight = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (overlapWidth > 2 && overlapHeight > 2) {
        dashboardCollisions.push(`${selectorName(first)} overlaps ${selectorName(second)}`);
      }
    }
  }
  const dropdownOptionFailures = [];
  const dropdownSchemeFailures = [];
  const expectedColorScheme = document.documentElement.dataset.orgColorMode === "light" ? "light" : "dark";
  const visibleSelects = [...document.querySelectorAll("select")].filter(isVisible);
  visibleSelects.forEach((select) => {
    const selectStyle = getComputedStyle(select);
    if (!String(selectStyle.colorScheme || "").split(/\s+/).includes(expectedColorScheme)) {
      dropdownSchemeFailures.push({
        selector: selectorName(select),
        expected: expectedColorScheme,
        actual: selectStyle.colorScheme || "unset",
      });
    }
    [...select.querySelectorAll("option, optgroup")].forEach((row) => {
      const style = getComputedStyle(row);
      const foreground = parseRgb(style.color);
      const background = parseRgb(style.backgroundColor);
      const ratio = foreground && background && background.a >= 0.98
        ? contrastRatio(foreground, background)
        : 0;
      if (ratio < 4.5) {
        dropdownOptionFailures.push({
          select: selectorName(select),
          row: row.tagName.toLowerCase(),
          text: (row.textContent || "").trim().slice(0, 80),
          color: style.color,
          background: style.backgroundColor,
          contrast: Number(ratio.toFixed(2)),
        });
      }
    });
  });
  return {
    title: document.title,
    hash: location.hash,
    viewport: { width: vw, height: vh },
    workspacePage: workspace?.dataset.workspacePage || "",
    pageVisible: workspace ? pageRect.width > 100 && pageRect.height > 100 : consoleRect?.width > 100 && consoleRect?.height > 100,
    bodyScrollWidth: Math.max(doc.scrollWidth, body?.scrollWidth || 0),
    horizontalOverflow: Math.max(doc.scrollWidth, body?.scrollWidth || 0) > vw + 2,
    offenders,
    paleSurfaces,
    clippedText,
    dashboardCollisions,
    nav: {
      desktopVisible: isVisible(nav),
      commandRailVisible: isVisible(commandRail),
      mobileHomebarVisible: isVisible(mobileHomebar),
      stickyTopbarVisible: isVisible(stickyTopbar),
      systemLineVisible: isVisible(systemLine),
      mobileVisible: isVisible(mobileNav),
      visibleSurfaces: navSurfaces,
      mobileTop: mobileRect ? Math.round(mobileRect.top) : null,
      mobileBottom: mobileRect ? Math.round(mobileRect.bottom) : null,
      commandRailPolish: (() => {
        if (!isVisible(commandRail) || !isVisible(commandRailActions)) return null;
        const railRect = commandRail.getBoundingClientRect();
        const actionsRect = commandRailActions.getBoundingClientRect();
        const navRect = commandRailNav?.getBoundingClientRect();
        const actionsStyle = getComputedStyle(commandRailActions);
        const activeStyle = commandRailActive ? getComputedStyle(commandRailActive) : null;
        const lastNavControl = commandRailNav?.querySelector("button:last-child");
        const lastNavRect = lastNavControl?.getBoundingClientRect();
        return {
          actionTopInset: Math.round(actionsRect.top - railRect.top),
          actionBottomInset: Math.round(railRect.bottom - actionsRect.bottom),
          actionBackground: actionsStyle.backgroundColor,
          navActionOverlap: navRect ? Math.max(0, Math.round(navRect.right - actionsRect.left)) : 0,
          activeRadius: activeStyle ? Number.parseFloat(activeStyle.borderTopLeftRadius) : null,
          lastNavControlVisible: !!(lastNavRect && navRect && lastNavRect.left >= navRect.left - 1 && lastNavRect.right <= navRect.right + 1),
          actionControlRadii: [...commandRailActions.querySelectorAll("button")]
            .filter(isVisible)
            .map((button) => Number.parseFloat(getComputedStyle(button).borderTopLeftRadius)),
        };
      })(),
    },
    phantomStore: {
      productCards: productCards.length,
      productMedia: productMedia.length,
      pageWorkerVisible: isVisible(pageWorker),
      searchVisible: isVisible(storeSearch),
      firstProductMediaTop: productMedia[0] ? Math.round(productMedia[0].getBoundingClientRect().top) : null,
      firstProductArtTop: [featuredProductMedia, productMedia[0]].filter(isVisible).map((media) => Math.round(media.getBoundingClientRect().top)).sort((a, b) => a - b)[0] ?? null,
      brokenMedia: productMedia.filter((media) => {
        const rect = media.getBoundingClientRect();
        const img = media.querySelector("img");
        const fallback = media.querySelector(".ps-product-fallback, .ps-ai-product-art");
        const style = img ? getComputedStyle(img) : null;
        const approvedFit = img?.closest(".ps-ai-product-art.has-cover") ? "cover" : "contain";
        return rect.width < 120 || rect.height < 60 || (!img && !fallback) || (style && (style.objectFit !== approvedFit || style.transform !== "none"));
      }).map(elementSummary).slice(0, 5),
    },
    phantomPlay: {
      clippedActions: phantomPlayActions.filter((button) => {
        if (!isVisible(button)) return false;
        const raw = button.getBoundingClientRect();
        if (raw.top < 0 || raw.bottom > vh) return false;
        const visible = visibleRect(button);
        return visible.right - visible.left < raw.width - 2 || visible.bottom - visible.top < raw.height - 2;
      }).map(elementSummary).slice(0, 8),
    },
    analytics: {
      pageWorkerVisible: isVisible(pageWorker),
      graphTop: analyticsGraph ? Math.round(analyticsGraph.getBoundingClientRect().top) : null,
      trendCardTop: analyticsTrendCard ? Math.round(analyticsTrendCard.getBoundingClientRect().top) : null,
      firstVisibleLabel: [...document.querySelectorAll("[data-workspace-page='analytics'] .page-worker, [data-workspace-page='analytics'] .an-top-visual-grid, [data-workspace-page='analytics'] .an-domain-shell .an-visual-grid, [data-workspace-page='analytics'] .an-kpis")]
        .filter(isVisible)
        .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
        .map((el) => el.classList.contains("page-worker") ? "page-worker" : el.classList.contains("an-visual-grid") ? "graph" : "kpis")[0] || "",
    },
    dashboard: {
      briefTop: dashboardBrief ? Math.round(dashboardBrief.getBoundingClientRect().top) : null,
      heroTop: dashboardHero ? Math.round(dashboardHero.getBoundingClientRect().top) : null,
      intelTop: dashboardIntel ? Math.round(dashboardIntel.getBoundingClientRect().top) : null,
      intelBandColumns: dashboardIntel ? getComputedStyle(dashboardIntel).gridTemplateColumns.trim().split(/\s+/).filter(Boolean).length : null,
      intelGridColumns: dashboardIntelGrid ? getComputedStyle(dashboardIntelGrid).gridTemplateColumns.trim().split(/\s+/).filter(Boolean).length : null,
      intelMinCardWidth: dashboardIntelCards.length ? Math.round(Math.min(...dashboardIntelCards.map((card) => card.getBoundingClientRect().width))) : null,
      visibleDecisionCards: decisionCards.filter(isVisible).length,
      decisionListHorizontalOverflow: decisionList ? decisionList.scrollWidth > decisionList.clientWidth + 2 : false,
      reviewAllVisible: isVisible(decisionReviewAll),
      petBottom: dashboardPet && isVisible(dashboardPet) ? Math.round(dashboardPet.getBoundingClientRect().bottom) : null,
      petRendererCount: document.querySelectorAll("[data-buddy], .phantompet-presence").length,
    },
    phantomBot: {
      shellVisible: isVisible(phantomBotShell),
      taskRailVisible: isVisible(phantomBotTaskRail),
      taskListPresent: !!phantomBotTaskList,
      taskCount: phantomBotTaskList?.querySelectorAll("[data-phantombot-task]").length || 0,
      composerVisible: isVisible(phantomBotComposer),
      composerTag: phantomBotComposer?.tagName || "",
      railToggleVisible: phantomBotRailToggles.some(isVisible),
      pageWorkerVisible: isVisible(pageWorker),
      topSearchVisible: isVisible(commandRailSearch),
    },
    dropdowns: {
      visibleSelects: visibleSelects.length,
      schemeFailures: dropdownSchemeFailures.slice(0, 12),
      optionFailures: dropdownOptionFailures.slice(0, 12),
    },
    textProbe: document.body.innerText.slice(0, 300),
  };
}

async function runViewportCase(cdp, baseUrl, screenshotDir, page, viewport, { navigate = true } = {}) {
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
  // The branded power-on animation intentionally overlays the first session.
  // Dismiss it in QA, then wait through its fade so screenshots prove the
  // audited workspace instead of capturing startup chrome.
  await evaluate(cdp, `(() => { document.querySelector(".os-poweron")?.click(); return true; })()`);
  await sleep(720);
  if (page.id === "settings" && requestedSettingsTab) {
    await evaluate(cdp, `(() => {
      const button = document.querySelector(${JSON.stringify(`[data-set-tab="${requestedSettingsTab}"]`)});
      button?.click();
      return !!button;
    })()`);
    await sleep(180);
  }
  if (page.id === "media" && requestedMediaTab) {
    await evaluate(cdp, `(() => {
      const button = document.querySelector(${JSON.stringify(`[data-ml-tab="${requestedMediaTab}"]`)});
      button?.click();
      return !!button;
    })()`);
    await sleep(240);
    if (requestedMediaTab === "assets") {
      await evaluate(cdp, `(() => {
        const input = document.querySelector("[data-catalog-folder-input]");
        if (!input || typeof DataTransfer !== "function") return false;
        const transfer = new DataTransfer();
        const swatches = [
          ["campaign-hero.svg", "#1ee6a1", "Campaign hero"],
          ["product-launch.svg", "#6d65ff", "Product launch"],
          ["brand-mark.svg", "#ffca68", "Brand mark"],
          ["social-cover.svg", "#eb4e87", "Social cover"],
        ];
        swatches.forEach(([name, color, label], index) => {
          const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#071410"/><rect x="44" y="44" width="1112" height="712" rx="18" fill="' + color + '" opacity=".18"/><circle cx="600" cy="345" r="170" fill="' + color + '" opacity=".85"/><text x="600" y="650" fill="#f2fff9" font-size="64" text-anchor="middle" font-family="Arial">' + label + '</text></svg>';
          transfer.items.add(new File([svg], name, { type: "image/svg+xml", lastModified: Date.now() - (index * 86400000) }));
        });
        transfer.items.add(new File([new Uint8Array(128)], "launch-cut.mp4", { type: "video/mp4", lastModified: Date.now() - 43200000 }));
        transfer.items.add(new File([new Uint8Array(128)], "campaign-theme.mp3", { type: "audio/mpeg", lastModified: Date.now() - 21600000 }));
        input.files = transfer.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      })()`);
      await sleep(320);
      await evaluate(cdp, `(() => {
        const first = document.querySelector("[data-catalog-open]");
        first?.click();
        return !!first;
      })()`);
      await sleep(180);
    }
  }
  if (page.id === "dashboard") {
    await evaluate(cdp, `(${injectDashboardDecisionFixture.toString()})()`);
  }
  const audit = await evaluate(cdp, `(${auditPage.toString()})()`);
  if (page.id === "dashboard" && viewport.width <= 900) {
    await evaluate(cdp, `(() => {
      const opener = document.querySelector("[data-mobile-more]");
      if (!opener) return false;
      opener.focus();
      opener.click();
      return true;
    })()`);
    await sleep(120);
    const opened = await evaluate(cdp, `(() => {
      const sidebar = document.querySelector(".sidebar");
      const active = document.activeElement;
      return {
        expanded: !!sidebar?.classList.contains("is-expanded"),
        focusInside: !!sidebar?.contains(active),
        role: sidebar?.getAttribute("role") || "",
        modal: sidebar?.getAttribute("aria-modal") || "",
      };
    })()`);
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
    await sleep(120);
    const closed = await evaluate(cdp, `(() => {
      const sidebar = document.querySelector(".sidebar");
      const active = document.activeElement;
      return {
        collapsed: !sidebar?.classList.contains("is-expanded"),
        focusRestored: !!active?.matches?.("[data-mobile-more]"),
      };
    })()`);
    audit.mobileDrawer = { ...opened, ...closed };
  }
  if (page.id === "phantomai") {
    await evaluate(cdp, `(() => { const button = document.querySelector("[data-phantombot-model]"); button?.click(); return !!button; })()`);
    await sleep(120);
    const modelOpened = await evaluate(cdp, `(() => {
      const menu = document.querySelector("[data-phantombot-model-menu]");
      const trigger = document.querySelector("[data-phantombot-model]");
      const rect = menu?.getBoundingClientRect();
      return {
        visible: !!menu && !menu.hidden,
        focusInside: !!menu?.contains(document.activeElement),
        automaticChoice: !!menu?.querySelector("[data-phantombot-brain-auto]"),
        exactChoices: menu?.querySelectorAll("[data-phantombot-brain-provider][data-phantombot-brain-model]").length || 0,
        withinViewport: !!rect && rect.left >= -1 && rect.right <= innerWidth + 1 && rect.top >= -1 && rect.bottom <= innerHeight + 1,
        expanded: trigger?.getAttribute("aria-expanded") || "",
      };
    })()`);
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
    await sleep(80);
    const modelClosed = await evaluate(cdp, `(() => ({
      closed: !!document.querySelector("[data-phantombot-model-menu]")?.hidden,
      focusRestored: !!document.activeElement?.matches?.("[data-phantombot-model]"),
    }))()`);
    audit.phantomBotModelPicker = { ...modelOpened, ...modelClosed };

    await evaluate(cdp, `(() => { const button = [...document.querySelectorAll("[data-phantombot-manage-session]")].find((item) => item.getBoundingClientRect().width > 0); button?.focus(); button?.click(); return !!button; })()`);
    await sleep(120);
    const sessionOpened = await evaluate(cdp, `(() => {
      const panel = document.querySelector("[data-phantombot-session-menu]");
      return {
        visible: !!panel && !panel.hidden,
        role: panel?.getAttribute("role") || "",
        modal: panel?.getAttribute("aria-modal") || "",
        focusInside: !!panel?.contains(document.activeElement),
        backgroundInert: [...(panel?.parentElement?.children || [])].filter((child) => child !== panel).every((child) => child.hasAttribute("inert")),
      };
    })()`);
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
    await sleep(80);
    const sessionClosed = await evaluate(cdp, `(() => ({
      closed: !!document.querySelector("[data-phantombot-session-menu]")?.hidden,
      focusRestored: !!document.activeElement?.matches?.("[data-phantombot-manage-session]"),
    }))()`);
    audit.phantomBotSessionDialog = { ...sessionOpened, ...sessionClosed };

    if (viewport.width <= 1100) {
      await evaluate(cdp, `(() => { const button = [...document.querySelectorAll("[data-phantombot-rail-toggle]")].find((item) => item.getBoundingClientRect().width > 0); button?.click(); return !!button; })()`);
      await sleep(120);
      const railOpened = await evaluate(cdp, `(() => {
        const rail = document.querySelector(".phantombot-taskrail");
        const focusable = [...(rail?.querySelectorAll("button:not([disabled]), input:not([disabled])") || [])].filter((item) => item.getBoundingClientRect().width > 0);
        focusable.at(-1)?.focus();
        return {
          visible: !!rail && rail.getBoundingClientRect().width > 0,
          role: rail?.getAttribute("role") || "",
          modal: rail?.getAttribute("aria-modal") || "",
          stageInert: document.querySelector(".phantombot-stage")?.hasAttribute("inert") || false,
          focusInside: !!rail?.contains(document.activeElement),
        };
      })()`);
      await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab" });
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab" });
      await sleep(60);
      const railWrapped = await evaluate(cdp, `(() => {
        const rail = document.querySelector(".phantombot-taskrail");
        return { tabStayedInside: !!rail?.contains(document.activeElement) };
      })()`);
      await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
      await sleep(80);
      const railClosed = await evaluate(cdp, `(() => ({
        closed: !document.querySelector(".phantombot-os")?.classList.contains("is-rail-open"),
        stageInteractive: !document.querySelector(".phantombot-stage")?.hasAttribute("inert"),
        focusRestored: !!document.activeElement?.matches?.("[data-phantombot-rail-toggle]"),
      }))()`);
      audit.phantomBotTaskRail = { ...railOpened, ...railWrapped, ...railClosed };
    }
  }
  if (page.id === "dashboard" && viewport.width > 900) {
    const triggered = await evaluate(cdp, `(() => {
      const toggle = document.querySelector("[data-os-model-toggle]");
      if (!toggle) return false;
      toggle.click();
      return true;
    })()`);
    const gatewayState = await waitForApp(cdp, "settings");
    await sleep(180);
    await evaluate(cdp, `(() => {
      document.querySelector(".set-route-grid")?.scrollIntoView({ block: "start" });
      return true;
    })()`);
    await sleep(100);
    const openAudit = await evaluate(cdp, `(${auditPage.toString()})()`);
    const gatewayVisible = await evaluate(cdp, `(() => {
      const panel = document.querySelector(".set-ai-control-center");
      if (!panel) return false;
      const style = getComputedStyle(panel);
      const rect = panel.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 1 && rect.height > 1;
    })()`);
    audit.dashboardGateway = {
      triggered,
      routed: gatewayState?.ready === true,
      visible: gatewayVisible,
      visibleSelects: openAudit.dropdowns.visibleSelects,
      schemeFailures: openAudit.dropdowns.schemeFailures,
      optionFailures: openAudit.dropdowns.optionFailures,
    };
    await evaluate(cdp, `(() => { window.PHANTOM_GO_NAV?.("dashboard"); return true; })()`);
    await waitForApp(cdp, "dashboard");
    await sleep(120);
  }
  const png = await cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  }, 20_000);
  const file = path.join(screenshotDir, `${page.label}-${viewport.width}x${viewport.height}.png`);
  writeFileSync(file, Buffer.from(png.data, "base64"));
  return { page: page.id, label: page.label, viewport, appState, audit, screenshot: file };
}

async function verifyAtomicWorkspaceTransition(cdp, baseUrl) {
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  const loadEvent = cdp.waitEvent("Page.loadEventFired", 15_000).catch(() => null);
  await cdp.send("Page.navigate", { url: `${baseUrl}/app/?session=owner-admin` });
  await loadEvent;
  await waitForApp(cdp, "dashboard");
  await evaluate(cdp, `(() => { document.querySelector(".os-poweron")?.click(); return true; })()`);
  await sleep(720);
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  const reset = await evaluate(cdp, `(() => ({
    supported: typeof window.PHANTOM_TEST_RESET_WORKSPACE_STYLE === "function",
    removed: window.PHANTOM_TEST_RESET_WORKSPACE_STYLE?.("phantomstore") || 0,
  }))()`);
  assert.equal(reset?.supported, true, "Local browser QA must expose the safe route-style reset hook.");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 900,
    downloadThroughput: 250_000,
    uploadThroughput: 250_000,
    connectionType: "cellular3g",
  });
  await evaluate(cdp, `(() => { window.PHANTOM_GO_NAV("phantomstore"); return true; })()`);
  await sleep(260);
  const delayed = await evaluate(cdp, `(() => {
    const transition = document.querySelector("[data-workspace-transition='phantomstore']");
    const rect = transition?.getBoundingClientRect();
    return {
      transitionVisible: !!transition && rect.width > 100 && rect.height > 100,
      role: transition?.getAttribute("role") || "",
      rawStoreVisible: !!document.querySelector("[data-workspace-page='phantomstore']"),
      dashboardStillPresent: !!document.querySelector("[data-dashboard-brief-title]"),
    };
  })()`);
  assert.equal(delayed.transitionVisible, true, "A delayed workspace style must show the branded Phantom transition.");
  assert.equal(delayed.role, "status", "The loading handoff must announce a polite status.");
  assert.equal(delayed.rawStoreVisible, false, "PhantomStore markup must never render before its visual system is ready.");
  assert.equal(delayed.dashboardStillPresent, true, "The previous complete workspace must stay intact behind the transition.");
  const completed = await waitForApp(cdp, "phantomstore");
  assert.equal(completed?.ready, true, "The delayed styled route must complete successfully.");
  const settled = await evaluate(cdp, `(() => {
    const link = [...document.querySelectorAll("link[data-workspace-style]")].find((item) => item.getAttribute("href")?.includes("/app/phantomstore.css"));
    const shell = document.querySelector(".phantomstore, .ps-shell, [data-phantomstore]");
    return {
      transitionGone: !document.querySelector("[data-workspace-transition]"),
      styleReady: link?.dataset.workspaceStyleState === "ready" && !!link.sheet,
      shellPresent: !!shell,
    };
  })()`);
  assert.equal(settled.transitionGone, true, "The transition must leave after the styled workspace commits.");
  assert.equal(settled.styleReady, true, "The route stylesheet must be applied before the transition leaves.");
  assert.equal(settled.shellPresent, true, "PhantomStore must render its finished product shell.");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
    connectionType: "none",
  });
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: false });
  return { ...delayed, ...settled };
}

function assertCase(result) {
  const { page, label, viewport, audit, appState } = result;
  assert.equal(appState?.gateVisible, false, `${label} ${viewport.width}: auth gate must not remain visible during local QA.`);
  assert.equal(appState?.bootVisible, false, `${label} ${viewport.width}: boot screen must finish before responsive auditing.`);
  assert.equal(appState?.phantomVisible, true, `${label} ${viewport.width}: Phantom shell must be visible.`);
  if (page !== "dashboard") {
    assert.equal(audit.workspacePage, page, `${label} ${viewport.width}: expected workspace page ${page}, got ${audit.workspacePage || "none"}.`);
  } else {
    assert.equal(appState?.dashboardReady, true, `${label} ${viewport.width}: dashboard must render the real business brief, not the startup status panel.`);
  }
  assert.equal(audit.pageVisible, true, `${label} ${viewport.width}: page body must be visible.`);
  assert.equal(audit.horizontalOverflow, false, `${label} ${viewport.width}: document has horizontal overflow (${audit.bodyScrollWidth}px > ${viewport.width}px).`);
  assert.deepEqual(audit.offenders, [], `${label} ${viewport.width}: visible elements escape the viewport.`);
  assert.deepEqual(audit.paleSurfaces, [], `${label} ${viewport.width}: dark mode has large pale/white UI surfaces.`);
  assert.deepEqual(audit.clippedText, [], `${label} ${viewport.width}: visible control text is clipped.`);
  assert.deepEqual(audit.dropdowns.schemeFailures, [], `${label} ${viewport.width}: visible native selects must declare the active color scheme directly.`);
  assert.deepEqual(audit.dropdowns.optionFailures, [], `${label} ${viewport.width}: native dropdown options must retain at least 4.5:1 foreground/background contrast.`);
  if (viewport.width <= 900) {
    assert.equal(audit.nav.mobileVisible, true, `${label} ${viewport.width}: compact bottom nav must be visible.`);
    assert.deepEqual(audit.nav.visibleSurfaces.map((surface) => surface.name), ["bottom-dock"], `${label} ${viewport.width}: mobile must have exactly one visible nav surface.`);
    assert.equal(audit.nav.mobileHomebarVisible, false, `${label} ${viewport.width}: compact homebar must stay hidden so mobile has one nav bar.`);
    assert.equal(audit.nav.commandRailVisible, false, `${label} ${viewport.width}: Command OS rail must be hidden on compact widths to avoid duplicate nav.`);
    assert.equal(audit.nav.systemLineVisible, false, `${label} ${viewport.width}: system status line must stay hidden so the bottom dock is the only mobile bar.`);
    assert.equal(audit.nav.desktopVisible, false, `${label} ${viewport.width}: desktop sidebar must be hidden on compact widths.`);
    if (page === "dashboard") {
      assert.equal(audit.mobileDrawer?.expanded, true, `${label} ${viewport.width}: More must open the compact navigation drawer.`);
      assert.equal(audit.mobileDrawer?.focusInside, true, `${label} ${viewport.width}: opening the compact drawer must move focus inside it.`);
      assert.equal(audit.mobileDrawer?.role, "dialog", `${label} ${viewport.width}: compact drawer must expose dialog semantics while open.`);
      assert.equal(audit.mobileDrawer?.modal, "true", `${label} ${viewport.width}: compact drawer must identify its modal focus boundary.`);
      assert.equal(audit.mobileDrawer?.collapsed, true, `${label} ${viewport.width}: Escape must close the compact drawer.`);
      assert.equal(audit.mobileDrawer?.focusRestored, true, `${label} ${viewport.width}: Escape must restore focus to the More control.`);
      assert.deepEqual(audit.dashboardCollisions, [], `${label} ${viewport.width}: dashboard brief, decisions and console must remain separate in the mobile document flow.`);
      assert.equal(audit.dashboard.reviewAllVisible, true, `${label} ${viewport.width}: decision preview must link to the complete queue.`);
      if (viewport.width <= 680) {
        assert.equal(audit.dashboard.intelBandColumns, 1, `${label} ${viewport.width}: phone Business Signals must not retain the desktop header/card columns.`);
        assert.equal(audit.dashboard.intelGridColumns, 1, `${label} ${viewport.width}: phone Business Signals cards must form one readable list.`);
        assert.ok(
          audit.dashboard.intelMinCardWidth !== null && audit.dashboard.intelMinCardWidth >= viewport.width - 52,
          `${label} ${viewport.width}: each Business Signals summary must retain a useful phone width.`
        );
        assert.equal(audit.dashboard.decisionListHorizontalOverflow, false, `${label} ${viewport.width}: decision preview must not create a sideways phone scroller.`);
        assert.equal(audit.dashboard.visibleDecisionCards, 1, `${label} ${viewport.width}: phone home must show one priority decision before Phantom.`);
        assert.ok(
          audit.dashboard.petBottom !== null && audit.nav.mobileTop !== null && audit.dashboard.petBottom <= audit.nav.mobileTop + 2,
          `${label} ${viewport.width}: the movable PhantomPet must be fully tappable above the fixed mobile dock on initial load.`
        );
        assert.equal(audit.dashboard.petRendererCount, 1, `${label} ${viewport.width}: exactly one PhantomPet renderer may exist.`);
      }
      assert.ok(
        audit.dashboard.intelTop === null || (audit.dashboard.heroTop !== null && audit.dashboard.intelTop > audit.dashboard.heroTop + 20),
        `${label} ${viewport.width}: dashboard intelligence cards must not sit above the brief like a second mobile nav bar.`
      );
    }
  }
  if (viewport.width > 900) {
    assert.equal(audit.nav.desktopVisible || audit.nav.commandRailVisible, true, `${label} ${viewport.width}: a desktop primary navigation surface must be visible.`);
    assert.equal(audit.nav.mobileVisible, false, `${label} ${viewport.width}: mobile bottom nav must not appear on desktop widths.`);
    if (audit.nav.commandRailPolish) {
      assert.ok(audit.nav.commandRailPolish.actionTopInset >= 6 && audit.nav.commandRailPolish.actionBottomInset >= 6, `${label} ${viewport.width}: utility controls must float inside the command rail instead of painting a full-height square.`);
      assert.equal(audit.nav.commandRailPolish.actionBackground, "rgba(0, 0, 0, 0)", `${label} ${viewport.width}: utility cluster must not place a solid rectangle behind navigation actions.`);
      assert.equal(audit.nav.commandRailPolish.navActionOverlap, 0, `${label} ${viewport.width}: utility controls must not overlap primary navigation.`);
      if (audit.nav.commandRailPolish.activeRadius !== null) {
        assert.ok(audit.nav.commandRailPolish.activeRadius >= 10, `${label} ${viewport.width}: active desktop navigation must use the refined rounded surface.`);
      }
      assert.ok(audit.nav.commandRailPolish.actionControlRadii.every((radius) => radius >= 10), `${label} ${viewport.width}: every visible utility control must use the refined rounded surface.`);
      if (viewport.width >= 1440) {
        assert.equal(audit.nav.commandRailPolish.lastNavControlVisible, true, `${label} ${viewport.width}: all primary divisions must remain visible without scrolling on a standard desktop.`);
      }
    }
    if (page === "dashboard") {
      assert.equal(audit.dashboardGateway?.triggered, true, `${label} ${viewport.width}: the footer Gateway control must be available.`);
      assert.equal(audit.dashboardGateway?.routed, true, `${label} ${viewport.width}: the footer Gateway control must open the dedicated Gateway & Brain page.`);
      assert.equal(audit.dashboardGateway?.visible, true, `${label} ${viewport.width}: the full Gateway control center must render for browser verification.`);
      assert.ok(audit.dashboardGateway?.visibleSelects >= 2, `${label} ${viewport.width}: Gateway & Brain settings must visibly expose provider and model dropdowns.`);
      assert.deepEqual(audit.dashboardGateway?.schemeFailures, [], `${label} ${viewport.width}: Gateway & Brain selects must use the dark native popup scheme.`);
      assert.deepEqual(audit.dashboardGateway?.optionFailures, [], `${label} ${viewport.width}: Gateway & Brain option rows must retain at least 4.5:1 contrast.`);
    }
  }
  if (page === "phantomstore") {
    assert.ok(audit.phantomStore.productCards >= 3, `${label} ${viewport.width}: PhantomStore must render real product cards even if live sync is offline.`);
    assert.equal(audit.phantomStore.productMedia, audit.phantomStore.productCards, `${label} ${viewport.width}: every PhantomStore product needs a visible media block.`);
    assert.deepEqual(audit.phantomStore.brokenMedia, [], `${label} ${viewport.width}: PhantomStore product media must be full-frame, visible art or styled fallback.`);
    if (viewport.width <= 640) {
      assert.equal(audit.phantomStore.pageWorkerVisible, false, `${label} ${viewport.width}: Store phone view must not bury products under the global prompt panel.`);
      assert.equal(audit.phantomStore.searchVisible, false, `${label} ${viewport.width}: Store phone view must put products before search controls.`);
      assert.ok(
        audit.phantomStore.firstProductArtTop !== null && audit.phantomStore.firstProductArtTop < audit.nav.mobileTop - 16,
        `${label} ${viewport.width}: first Store product art must appear above the mobile dock (art top ${audit.phantomStore.firstProductArtTop}, dock top ${audit.nav.mobileTop}).`
      );
    }
  }
  if (page === "phantomplay") {
    assert.deepEqual(audit.phantomPlay.clippedActions, [], `${label} ${viewport.width}: PhantomPlay card actions must not be clipped inside game cards.`);
  }
  if (page === "phantomai") {
    assert.equal(audit.phantomBot.shellVisible, true, `${label} ${viewport.width}: dedicated PhantomBot OS shell must be visible.`);
    assert.equal(audit.phantomBot.taskListPresent, true, `${label} ${viewport.width}: task history rail must remain mounted.`);
    assert.ok(audit.phantomBot.taskCount >= 1, `${label} ${viewport.width}: PhantomBot must start with a usable active task.`);
    assert.equal(audit.phantomBot.composerVisible, true, `${label} ${viewport.width}: message composer must be visible on initial load.`);
    assert.equal(audit.phantomBot.composerTag, "TEXTAREA", `${label} ${viewport.width}: composer must be multiline.`);
    assert.equal(audit.phantomBot.pageWorkerVisible, false, `${label} ${viewport.width}: generic page-intelligence prompt must not duplicate PhantomBot chat.`);
    assert.equal(audit.phantomBot.topSearchVisible, false, `${label} ${viewport.width}: global top Search control must stay out of the dedicated PhantomBot OS.`);
    assert.equal(audit.phantomBotModelPicker?.visible, true, `${label} ${viewport.width}: model picker must open from the composer.`);
    assert.equal(audit.phantomBotModelPicker?.focusInside, true, `${label} ${viewport.width}: model picker must receive keyboard focus.`);
    assert.equal(audit.phantomBotModelPicker?.automaticChoice, true, `${label} ${viewport.width}: model picker must offer automatic brain routing.`);
    assert.ok(audit.phantomBotModelPicker?.exactChoices >= 5, `${label} ${viewport.width}: model picker must expose exact provider/model choices.`);
    assert.equal(audit.phantomBotModelPicker?.withinViewport, true, `${label} ${viewport.width}: model picker must remain inside the viewport.`);
    assert.equal(audit.phantomBotModelPicker?.expanded, "true", `${label} ${viewport.width}: model trigger must report its expanded state.`);
    assert.equal(audit.phantomBotModelPicker?.closed, true, `${label} ${viewport.width}: Escape must close the model picker.`);
    assert.equal(audit.phantomBotModelPicker?.focusRestored, true, `${label} ${viewport.width}: closing the model picker must restore focus.`);
    assert.equal(audit.phantomBotSessionDialog?.visible, true, `${label} ${viewport.width}: session controls must open.`);
    assert.equal(audit.phantomBotSessionDialog?.role, "dialog", `${label} ${viewport.width}: session controls must expose dialog semantics.`);
    assert.equal(audit.phantomBotSessionDialog?.modal, "true", `${label} ${viewport.width}: session controls must expose a modal boundary.`);
    assert.equal(audit.phantomBotSessionDialog?.focusInside, true, `${label} ${viewport.width}: session controls must receive focus.`);
    assert.equal(audit.phantomBotSessionDialog?.backgroundInert, true, `${label} ${viewport.width}: session controls must inert the chat background.`);
    assert.equal(audit.phantomBotSessionDialog?.closed, true, `${label} ${viewport.width}: Escape must close session controls.`);
    assert.equal(audit.phantomBotSessionDialog?.focusRestored, true, `${label} ${viewport.width}: closing session controls must restore focus.`);
    if (viewport.width <= 1100) {
      assert.equal(audit.phantomBot.taskRailVisible, false, `${label} ${viewport.width}: compact PhantomBot must keep the task rail collapsed by default.`);
      assert.equal(audit.phantomBot.railToggleVisible, true, `${label} ${viewport.width}: compact PhantomBot needs a visible task-rail toggle.`);
      assert.equal(audit.phantomBotTaskRail?.visible, true, `${label} ${viewport.width}: compact task rail must open.`);
      assert.equal(audit.phantomBotTaskRail?.role, "dialog", `${label} ${viewport.width}: compact task rail must expose dialog semantics.`);
      assert.equal(audit.phantomBotTaskRail?.modal, "true", `${label} ${viewport.width}: compact task rail must expose a modal boundary.`);
      assert.equal(audit.phantomBotTaskRail?.stageInert, true, `${label} ${viewport.width}: compact task rail must inert the workspace stage.`);
      assert.equal(audit.phantomBotTaskRail?.focusInside, true, `${label} ${viewport.width}: compact task rail must receive focus.`);
      assert.equal(audit.phantomBotTaskRail?.tabStayedInside, true, `${label} ${viewport.width}: compact task rail must trap Tab focus.`);
      assert.equal(audit.phantomBotTaskRail?.closed, true, `${label} ${viewport.width}: Escape must close the compact task rail.`);
      assert.equal(audit.phantomBotTaskRail?.stageInteractive, true, `${label} ${viewport.width}: closing the compact rail must restore the stage.`);
      assert.equal(audit.phantomBotTaskRail?.focusRestored, true, `${label} ${viewport.width}: closing the compact rail must restore focus.`);
    } else {
      assert.equal(audit.phantomBot.taskRailVisible, true, `${label} ${viewport.width}: desktop PhantomBot must show the task rail.`);
    }
  }
  if (page === "analytics") {
    assert.equal(audit.analytics.pageWorkerVisible, false, `${label} ${viewport.width}: Analytics must not render the generic prompt before the stats graph.`);
    assert.equal(audit.analytics.firstVisibleLabel, "graph", `${label} ${viewport.width}: Analytics must start with the stats graph, not setup or prompt chrome.`);
    assert.ok(audit.analytics.graphTop !== null && audit.analytics.graphTop >= -2, `${label} ${viewport.width}: Analytics graph must be mounted in the visible document flow.`);
  }
}

async function main() {
  assert.equal(typeof WebSocket, "function", "Node 22+ global WebSocket is required for the Chrome CDP responsive smoke test.");
  assert.ok(pages.length > 0, "Responsive page selection must include at least one known page.");
  assert.ok(viewports.length > 0, "Responsive viewport selection must include at least one known width.");

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
    await cdp.send("Network.enable");
    const workspaceTransition = await verifyAtomicWorkspaceTransition(cdp, baseUrl);

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

    const summary = {
      ok: true,
      checkedAt: new Date().toISOString(),
      chrome: getChromePath(),
      pages: pages.map((page) => page.id),
      viewports,
      cases: results.length,
      workspaceTransition,
      screenshots: screenshotDir,
      report: path.join(runDir, "report.json"),
      checks: [
        "local admin QA session renders",
        "requested workspace page renders",
        "exactly one compact nav surface visible through 900px",
        "compact Command OS rail hidden to prevent duplicate navigation",
        "one desktop primary navigation surface visible above tablet widths",
        "desktop command rail has no full-height utility block or nav overlap",
        "standard desktop keeps every primary division visible without scrolling",
        "document has no horizontal overflow",
        "visible elements do not escape viewport",
        "dark mode has no large pale/white UI surfaces",
        "visible control text is not clipped",
        "visible native dropdown schemes and option rows remain readable at 4.5:1 or better",
        "the dashboard Gateway control opens the full brain page with readable native option rows",
        "compact drawer focus enters, traps, closes, and restores",
        "PhantomBot model picker opens, fits, closes, and restores focus",
        "PhantomBot session controls expose a modal keyboard boundary",
        "PhantomBot compact task rail traps focus and restores the stage",
        "phone Business Signals use one readable column",
        "PhantomPlay card actions stay fully visible inside game cards",
        "PhantomStore phone view puts product art before prompt chrome",
        "PhantomStore products render with full-frame media blocks",
        "delayed route styling keeps raw workspace markup hidden behind a branded transition",
      ],
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
