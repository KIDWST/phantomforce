import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const apiBase = (process.env.PHANTOMFORCE_DATABASE_AUTH_BROWSER_API_BASE || process.env.BASE || "http://127.0.0.1:5391").replace(/\/$/, "");
const PASSWORD = "phantom-dev-password";

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
    "--api", apiBase,
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

  const on = (method, listener) => {
    const eventListeners = listeners.get(method) || [];
    eventListeners.push(listener);
    listeners.set(method, eventListeners);
    return () => {
      const current = listeners.get(method) || [];
      listeners.set(method, current.filter((item) => item !== listener));
    };
  };

  const close = () => {
    try { ws.close(); } catch {}
  };

  return { send, waitEvent, on, close };
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

async function waitForExpression(cdp, expression, label, timeoutMs = 15_000, diagnostics = null) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = await evaluate(cdp, expression).catch((error) => ({ error: error.message }));
    if (last === true || last?.ok) return last;
    await sleep(250);
  }
  const browserLog = diagnostics?.messages?.length
    ? ` Browser diagnostics: ${JSON.stringify(diagnostics.messages).slice(0, 1400)}`
    : "";
  throw new Error(`Timed out waiting for ${label}. Last state: ${JSON.stringify(last).slice(0, 400)}${browserLog}`);
}

function installDiagnostics(cdp) {
  const messages = [];
  const push = (type, payload) => {
    messages.push({ type, payload: String(payload || "").slice(0, 600) });
    if (messages.length > 40) messages.shift();
  };
  cdp.on("Runtime.exceptionThrown", (message) => push("exception", message.params?.exceptionDetails?.exception?.description || message.params?.exceptionDetails?.text));
  cdp.on("Log.entryAdded", (message) => push("log", `${message.params?.entry?.level || ""}: ${message.params?.entry?.text || ""}`));
  cdp.on("Console.messageAdded", (message) => push("console", `${message.params?.message?.level || ""}: ${message.params?.message?.text || ""}`));
  cdp.on("Network.loadingFailed", (message) => push("network", `${message.params?.errorText || ""} ${message.params?.blockedReason || ""}`.trim()));
  return { messages, push };
}

function stateExpression() {
  return `(${(() => {
    const gate = document.querySelector("[data-gate]");
    const phantom = document.querySelector("[data-phantom]");
    const signIn = document.querySelector('[data-auth-form="signin"]');
    const select = document.querySelector("[data-org-select]");
    const gateVisible = !!gate && !gate.hidden && getComputedStyle(gate).display !== "none";
    const phantomVisible = !!phantom && !phantom.hidden && getComputedStyle(phantom).display !== "none";
    return {
      ok: phantomVisible || !!signIn,
      gateVisible,
      phantomVisible,
      hasSignIn: !!signIn,
      hasSwitcher: !!select,
      text: document.body.innerText.slice(0, 500),
    };
  }).toString()})()`;
}

async function loginAsChicagoShotsOwner(cdp, diagnostics = null) {
  await waitForExpression(cdp, `(() => {
    const form = document.querySelector('[data-auth-form="signin"]');
    return !!form && !!form.querySelector('[name="identifier"]') && !!form.querySelector('[name="password"]');
  })()`, "database sign-in form", 20_000, diagnostics);

  await evaluate(cdp, `(() => {
    const set = (selector, value) => {
      const input = document.querySelector(selector);
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    set('[data-auth-form="signin"] [name="identifier"]', "owner@chicagoshots.local");
    set('[data-auth-form="signin"] [name="password"]', ${JSON.stringify(PASSWORD)});
    document.querySelector('[data-auth-form="signin"]').requestSubmit();
    return true;
  })()`);

  await waitForExpression(cdp, `(() => {
    const gate = document.querySelector("[data-gate]");
    const phantom = document.querySelector("[data-phantom]");
    return !!phantom && !phantom.hidden && (!gate || gate.hidden);
  })()`, "signed-in Phantom shell", 20_000, diagnostics);
}

async function browserAuthMe(cdp) {
  return evaluate(cdp, `fetch("/auth/me", {
    headers: { Authorization: "Bearer " + sessionStorage.getItem("pf.live.sessionToken.v1") },
  }).then((response) => response.json())`);
}

async function readSwitcherState(cdp) {
  return evaluate(cdp, `(() => {
    const select = document.querySelector("[data-org-select]");
    const buttons = [...document.querySelectorAll("[data-user-menu-org]")].map((button) => ({
      orgId: button.dataset.userMenuOrg || "",
      label: button.querySelector("b")?.textContent.trim() || "",
      role: button.querySelector("span")?.textContent.trim() || "",
      active: button.classList.contains("is-active"),
    }));
    return {
      selectExists: !!select,
      value: select?.value || "",
      options: select ? [...select.options].map((option) => ({
        value: option.value,
        label: option.textContent.trim(),
        selected: option.selected,
      })) : [],
      menuButtons: buttons,
      body: document.body.innerText.slice(0, 700),
    };
  })()`);
}

async function main() {
  assert.equal(typeof WebSocket, "function", "Node 22+ global WebSocket is required for the Chrome CDP auth smoke test.");
  await waitForHttpOk(`${apiBase}/health`, { timeoutMs: 15_000 });

  const staticPort = await getFreePort();
  const debugPort = await getFreePort();
  const baseUrl = `http://127.0.0.1:${staticPort}`;
  const runDir = path.join(repoRoot, "tmp", "database-auth-org-browser", timestamp());
  const userDataDir = path.join(os.tmpdir(), `phantomforce-auth-browser-${process.pid}-${Date.now()}`);
  mkdirSync(runDir, { recursive: true });

  const staticServer = spawnStaticServer(staticPort);
  let chrome = null;
  let cdp = null;
  try {
    await waitForHttpOk(`${baseUrl}/health`, { timeoutMs: 15_000 });
    chrome = await spawnChrome(debugPort, userDataDir);
    const wsUrl = await openPageTarget(debugPort);
    cdp = createCdpClient(wsUrl);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Log.enable");
    await cdp.send("Network.enable");
    const diagnostics = installDiagnostics(cdp);

    const loadEvent = cdp.waitEvent("Page.loadEventFired", 15_000).catch(() => null);
    await cdp.send("Page.navigate", { url: `${baseUrl}/app/` });
    await loadEvent;
    await waitForExpression(cdp, stateExpression(), "database login shell", 20_000, diagnostics);

    await loginAsChicagoShotsOwner(cdp, diagnostics);
    await waitForExpression(cdp, `!!document.querySelector("[data-org-select]")`, "topbar organization switcher", 15_000, diagnostics);

    const initialMe = await browserAuthMe(cdp);
    assert.equal(initialMe?.activeOrg?.id, "dev-org-chicagoshots", "browser session must start scoped to ChicagoShots.");

    const headerState = await readSwitcherState(cdp);
    assert.equal(headerState.selectExists, true, "admin header must render an organization switcher.");
    assert.deepEqual(headerState.options.map((option) => option.value), ["dev-org-chicagoshots"], "ChicagoShots owner must only see ChicagoShots in the header switcher.");
    assert.equal(headerState.value, "dev-org-chicagoshots", "header switcher value must match the server active org.");

    await evaluate(cdp, `document.querySelector("[data-user-btn]")?.click()`);
    await waitForExpression(cdp, `(() => {
      const menu = document.querySelector("[data-user-menu]");
      return !!menu && !menu.hidden && document.querySelectorAll("[data-user-menu-org]").length > 0;
    })()`, "profile organization menu", 10_000, diagnostics);
    const menuState = await readSwitcherState(cdp);
    assert.deepEqual(menuState.menuButtons.map((button) => button.orgId), ["dev-org-chicagoshots"], "profile menu must only show org memberships returned by the server.");
    assert.equal(menuState.menuButtons[0]?.active, true, "profile menu must mark the server active org as active.");

    const directCrossSwitch = await evaluate(cdp, `fetch("/auth/switch-org", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + sessionStorage.getItem("pf.live.sessionToken.v1"),
      },
      body: JSON.stringify({ orgId: "dev-org-phantomforce" }),
    }).then((response) => ({ status: response.status }))`);
    assert.equal(directCrossSwitch.status, 403, "server must reject a browser cross-org switch for a non-member.");

    await evaluate(cdp, `(() => {
      const select = document.querySelector("[data-org-select]");
      const option = document.createElement("option");
      option.value = "dev-org-phantomforce";
      option.textContent = "PhantomForce";
      select.append(option);
      select.value = "dev-org-phantomforce";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);
    await sleep(700);

    const afterTamperMe = await browserAuthMe(cdp);
    assert.equal(afterTamperMe?.activeOrg?.id, "dev-org-chicagoshots", "tampered local switcher must not change the server active org.");
    const afterTamperState = await readSwitcherState(cdp);
    assert.deepEqual(afterTamperState.options.map((option) => option.value), ["dev-org-chicagoshots"], "tampered local option must be removed on rerender.");
    assert.equal(afterTamperState.value, "dev-org-chicagoshots", "switcher must return to the server active org after a refused switch.");

    const summary = {
      ok: true,
      checkedAt: new Date().toISOString(),
      apiBase,
      appBase: baseUrl,
      chrome: getChromePath(),
      report: path.join(runDir, "report.json"),
      checks: [
        "database login renders in browser",
        "ChicagoShots owner signs in",
        "header switcher uses server memberships only",
        "profile menu uses server memberships only",
        "direct cross-org browser switch is rejected",
        "tampered local switcher cannot drift the active org",
      ],
    };
    writeFileSync(summary.report, JSON.stringify({ ...summary, headerState, menuState, afterTamperState }, null, 2));
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    cdp?.close();
    await stopProcess(chrome);
    await stopProcess(staticServer.child);
    rmSync(userDataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
