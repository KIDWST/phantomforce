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
  { id: "phantomstore", label: "phantomstore" },
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
  const mobileHomebar = document.querySelector(".mobile-admin-homebar");
  const stickyTopbar = document.querySelector(".topbar2");
  const systemLine = document.querySelector(".os-system-line");
  const mobileNav = document.querySelector("[data-mobile-bottom-nav]");
  const dashboardBrief = document.querySelector(".dashboard-brief");
  const decisionDeck = document.querySelector(".decision-deck");
  const dashboardHero = consoleRoot?.querySelector(".hero2");
  const dashboardComposer = consoleRoot?.querySelector(".hero2-phantombot-link");
  const productCards = [...document.querySelectorAll(".ps-product")];
  const productMedia = [...document.querySelectorAll(".ps-product-media")];
  const phantomPlayActions = [...document.querySelectorAll(".pp-game-actions button")];
  const pageWorker = document.querySelector(".page-worker");
  const storeSearch = document.querySelector(".ps-search");
  const analyticsGraph = document.querySelector("[data-workspace-page='analytics'] .an-top-visual-grid");
  const analyticsTrendCard = document.querySelector("[data-workspace-page='analytics'] .an-trend-card");
  const dashboardIntel = document.querySelector("[data-dashboard-intel]");
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
  const parseRgb = (value = "") => {
    const match = String(value).match(/rgba?\(([^)]+)\)/i);
    if (!match) return null;
    const parts = match[1].split(",").map((part) => Number.parseFloat(part.trim()));
    if (parts.length < 3 || parts.slice(0, 3).some((part) => Number.isNaN(part))) return null;
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length >= 4 && !Number.isNaN(parts[3]) ? parts[3] : 1 };
  };
  const luminance = ({ r, g, b }) => (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
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
    },
    phantomStore: {
      productCards: productCards.length,
      productMedia: productMedia.length,
      pageWorkerVisible: isVisible(pageWorker),
      searchVisible: isVisible(storeSearch),
      firstProductMediaTop: productMedia[0] ? Math.round(productMedia[0].getBoundingClientRect().top) : null,
      brokenMedia: productMedia.filter((media) => {
        const rect = media.getBoundingClientRect();
        const img = media.querySelector("img");
        const fallback = media.querySelector(".ps-product-fallback");
        const style = img ? getComputedStyle(img) : null;
        return rect.width < 120 || rect.height < 60 || (!img && !fallback) || (style && (style.objectFit !== "contain" || style.transform !== "none"));
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
      firstVisibleLabel: [...document.querySelectorAll("[data-workspace-page='analytics'] .page-worker, [data-workspace-page='analytics'] .an-top-visual-grid, [data-workspace-page='analytics'] .an-kpis")]
        .filter(isVisible)
        .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
        .map((el) => el.classList.contains("page-worker") ? "page-worker" : el.classList.contains("an-top-visual-grid") ? "graph" : "kpis")[0] || "",
    },
    dashboard: {
      briefTop: dashboardBrief ? Math.round(dashboardBrief.getBoundingClientRect().top) : null,
      heroTop: dashboardHero ? Math.round(dashboardHero.getBoundingClientRect().top) : null,
      intelTop: dashboardIntel ? Math.round(dashboardIntel.getBoundingClientRect().top) : null,
      visibleDecisionCards: decisionCards.filter(isVisible).length,
      decisionListHorizontalOverflow: decisionList ? decisionList.scrollWidth > decisionList.clientWidth + 2 : false,
      reviewAllVisible: isVisible(decisionReviewAll),
      composerBottom: dashboardComposer && isVisible(dashboardComposer) ? Math.round(dashboardComposer.getBoundingClientRect().bottom) : null,
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
  if (page.id === "dashboard") {
    await evaluate(cdp, `(${injectDashboardDecisionFixture.toString()})()`);
  }
  const audit = await evaluate(cdp, `(${auditPage.toString()})()`);
  const png = await cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  }, 20_000);
  const file = path.join(screenshotDir, `${page.label}-${viewport.width}x${viewport.height}.png`);
  writeFileSync(file, Buffer.from(png.data, "base64"));
  return { page: page.id, label: page.label, viewport, appState, audit, screenshot: file };
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
  if (viewport.width <= 900) {
    assert.equal(audit.nav.mobileVisible, true, `${label} ${viewport.width}: compact bottom nav must be visible.`);
    assert.deepEqual(audit.nav.visibleSurfaces.map((surface) => surface.name), ["bottom-dock"], `${label} ${viewport.width}: mobile must have exactly one visible nav surface.`);
    assert.equal(audit.nav.mobileHomebarVisible, false, `${label} ${viewport.width}: compact homebar must stay hidden so mobile has one nav bar.`);
    assert.equal(audit.nav.commandRailVisible, false, `${label} ${viewport.width}: Command OS rail must be hidden on compact widths to avoid duplicate nav.`);
    assert.equal(audit.nav.systemLineVisible, false, `${label} ${viewport.width}: system status line must stay hidden so the bottom dock is the only mobile bar.`);
    assert.equal(audit.nav.desktopVisible, false, `${label} ${viewport.width}: desktop sidebar must be hidden on compact widths.`);
    if (page === "dashboard") {
      assert.deepEqual(audit.dashboardCollisions, [], `${label} ${viewport.width}: dashboard brief, decisions and console must remain separate in the mobile document flow.`);
      assert.equal(audit.dashboard.reviewAllVisible, true, `${label} ${viewport.width}: decision preview must link to the complete queue.`);
      if (viewport.width <= 680) {
        assert.equal(audit.dashboard.decisionListHorizontalOverflow, false, `${label} ${viewport.width}: decision preview must not create a sideways phone scroller.`);
        assert.equal(audit.dashboard.visibleDecisionCards, 1, `${label} ${viewport.width}: phone home must show one priority decision before Phantom.`);
        assert.ok(
          audit.dashboard.composerBottom !== null && audit.nav.mobileTop !== null && audit.dashboard.composerBottom <= audit.nav.mobileTop + 2,
          `${label} ${viewport.width}: PhantomBot link must be fully tappable above the fixed mobile dock on initial load.`
        );
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
  }
  if (page === "phantomstore") {
    assert.ok(audit.phantomStore.productCards >= 3, `${label} ${viewport.width}: PhantomStore must render real product cards even if live sync is offline.`);
    assert.equal(audit.phantomStore.productMedia, audit.phantomStore.productCards, `${label} ${viewport.width}: every PhantomStore product needs a visible media block.`);
    assert.deepEqual(audit.phantomStore.brokenMedia, [], `${label} ${viewport.width}: PhantomStore product media must be full-frame, visible art or styled fallback.`);
    if (viewport.width <= 640) {
      assert.equal(audit.phantomStore.pageWorkerVisible, false, `${label} ${viewport.width}: Store phone view must not bury products under the global prompt panel.`);
      assert.equal(audit.phantomStore.searchVisible, false, `${label} ${viewport.width}: Store phone view must put products before search controls.`);
      assert.ok(
        audit.phantomStore.firstProductMediaTop !== null && audit.phantomStore.firstProductMediaTop < audit.nav.mobileTop - 16,
        `${label} ${viewport.width}: first Store product art must appear above the mobile dock.`
      );
    }
  }
  if (page === "phantomplay") {
    assert.deepEqual(audit.phantomPlay.clippedActions, [], `${label} ${viewport.width}: PhantomPlay card actions must not be clipped inside game cards.`);
  }
  if (page === "analytics") {
    assert.equal(audit.analytics.pageWorkerVisible, false, `${label} ${viewport.width}: Analytics must not render the generic prompt before the stats graph.`);
    assert.equal(audit.analytics.firstVisibleLabel, "graph", `${label} ${viewport.width}: Analytics must start with the stats graph, not setup or prompt chrome.`);
    assert.ok(audit.analytics.graphTop !== null && audit.analytics.graphTop >= -2, `${label} ${viewport.width}: Analytics graph must be mounted in the visible document flow.`);
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
        "exactly one compact nav surface visible through 900px",
        "compact Command OS rail hidden to prevent duplicate navigation",
        "one desktop primary navigation surface visible above tablet widths",
        "document has no horizontal overflow",
        "visible elements do not escape viewport",
        "dark mode has no large pale/white UI surfaces",
        "visible control text is not clipped",
        "PhantomPlay card actions stay fully visible inside game cards",
        "PhantomStore phone view puts product art before prompt chrome",
        "PhantomStore products render with full-frame media blocks",
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
