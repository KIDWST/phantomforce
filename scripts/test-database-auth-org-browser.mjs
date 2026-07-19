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
  cdp.on("Network.responseReceived", (message) => {
    const response = message.params?.response;
    if (String(response?.url || "").includes("/phantom-ai/chat")) {
      push("chat-http", `${response.status} ${message.params?.type || "request"} ${response.url}`);
    } else if (Number(response?.status || 0) >= 400) {
      push("http", `${response.status} ${message.params?.type || "request"} ${response.url || "unknown route"}`);
    }
  });
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

async function loginAs(cdp, email, diagnostics = null) {
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
    set('[data-auth-form="signin"] [name="identifier"]', ${JSON.stringify(email)});
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

async function submitChat(cdp, prompt, diagnostics = null) {
  const beforeHistoryCount = await evaluate(cdp, `(() => {
    const state = JSON.parse(localStorage.getItem("pf.phantom.v4") || "{}");
    const activeOrg = JSON.parse(localStorage.getItem("pf.session.v3") || "{}").orgId || "";
    return (state.chatHistory || []).filter((item) => item.ws === activeOrg).length;
  })()`);
  await evaluate(cdp, `(() => {
    const form = document.querySelector("[data-command-form]");
    const input = document.querySelector("[data-command-input]");
    if (!form || !input) return false;
    input.value = ${JSON.stringify(prompt)};
    input.dispatchEvent(new Event("input", { bubbles: true }));
    form.requestSubmit();
    return true;
  })()`);
  await waitForExpression(cdp, `(() => {
    const state = JSON.parse(localStorage.getItem("pf.phantom.v4") || "{}");
    const localSession = JSON.parse(localStorage.getItem("pf.session.v3") || "{}");
    const activeOrg = localSession.orgId || "";
    const history = (state.chatHistory || []).filter((item) => item.ws === activeOrg);
    const ok = history.length > ${beforeHistoryCount}
      && history[0]?.prompt === ${JSON.stringify(prompt)}
      && !!history[0]?.reply;
    return {
      ok,
      activeOrg,
      selectedOrg: document.querySelector("[data-org-select]")?.value || "",
      formBound: document.querySelector("[data-command-form]")?.dataset.bound || "",
      formBusy: document.querySelector("[data-command-form]")?.getAttribute("aria-busy") || "",
      inputDisabled: !!document.querySelector("[data-command-input]")?.disabled,
      historyCount: history.length,
      newestPrompt: history[0]?.prompt || "",
      newestReply: history[0]?.reply || "",
      totalHistory: (state.chatHistory || []).length,
      tokenPresent: !!sessionStorage.getItem("pf.live.sessionToken.v1"),
      visibleMessages: [...document.querySelectorAll("[data-chat-log] .msg-text")].slice(-3).map((node) => node.textContent.trim()),
    };
  })()`, `persisted chat answer for ${prompt}`, 20_000, diagnostics);
  const persistedReply = await evaluate(cdp, `(() => {
    const state = JSON.parse(localStorage.getItem("pf.phantom.v4") || "{}");
    const activeOrg = JSON.parse(localStorage.getItem("pf.session.v3") || "{}").orgId || "";
    return (state.chatHistory || []).find((item) => item.ws === activeOrg && item.prompt === ${JSON.stringify(prompt)})?.reply || "";
  })()`);
  await waitForExpression(cdp, `(() => {
    const users = [...document.querySelectorAll("[data-chat-log] .msg-user .msg-text")];
    const phantoms = [...document.querySelectorAll("[data-chat-log] .msg-phantom:not(.msg-typing) .msg-text")];
    const normalize = (value) => String(value || "").replace(/\\s+/g, " ").trim();
    const visiblePrompt = users.at(-1)?.textContent.trim() || "";
    const visibleReply = normalize(phantoms.at(-1)?.textContent);
    const persistedReply = normalize(${JSON.stringify(persistedReply)});
    return {
      ok: visiblePrompt === ${JSON.stringify(prompt)}
        && visibleReply === persistedReply
        && !document.querySelector("[data-chat-log] .msg-typing"),
      visiblePrompt,
      visibleReply,
      persistedReply,
      typing: !!document.querySelector("[data-chat-log] .msg-typing"),
      phantomRows: phantoms.length,
    };
  })()`, `visible chat answer for ${prompt}`, 20_000, diagnostics);
  return evaluate(cdp, `(() => {
    const users = [...document.querySelectorAll("[data-chat-log] .msg-user .msg-text")];
    const phantomRows = [...document.querySelectorAll("[data-chat-log] .msg-phantom:not(.msg-typing)")];
    const last = phantomRows.at(-1);
    return {
      prompt: users.at(-1)?.textContent.trim() || "",
      answer: last?.querySelector(".msg-text")?.textContent.trim() || "",
      cards: last?.querySelectorAll(".rcard").length || 0,
      url: location.href,
    };
  })()`);
}

async function localContextState(cdp) {
  return evaluate(cdp, `(() => {
    const state = JSON.parse(localStorage.getItem("pf.phantom.v4") || "{}");
    const activeOrg = JSON.parse(localStorage.getItem("pf.session.v3") || "{}").orgId || "";
    return {
      activeOrg,
      memory: (state.memory || []).filter((item) => item.ws === activeOrg).map((item) => item.text),
      history: (state.chatHistory || []).filter((item) => item.ws === activeOrg).map((item) => ({ prompt: item.prompt, reply: item.reply })),
      allMemoryScopes: [...new Set((state.memory || []).map((item) => item.ws))],
      allHistoryScopes: [...new Set((state.chatHistory || []).map((item) => item.ws))],
    };
  })()`);
}

async function openMemory(cdp, diagnostics = null) {
  await evaluate(cdp, `document.querySelector('[data-nav-id="memory"]')?.click()`);
  await waitForExpression(cdp, `!!document.querySelector("[data-memory-search]")`, "memory workspace", 10_000, diagnostics);
  return evaluate(cdp, `document.querySelector("main")?.innerText || ""`);
}

async function switchBrowserOrg(cdp, orgId, diagnostics = null) {
  await evaluate(cdp, `(() => {
    const select = document.querySelector("[data-org-select]");
    if (!select) return false;
    select.value = ${JSON.stringify(orgId)};
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  await waitForExpression(cdp, `fetch("/auth/me", {
    headers: { Authorization: "Bearer " + sessionStorage.getItem("pf.live.sessionToken.v1") },
  }).then((response) => response.json()).then((body) => body.activeOrg?.id === ${JSON.stringify(orgId)})`, `organization switch to ${orgId}`, 15_000, diagnostics);
  await waitForExpression(cdp, `document.querySelector("[data-org-select]")?.value === ${JSON.stringify(orgId)}`, `organization switcher value ${orgId}`, 10_000, diagnostics);
  await waitForExpression(cdp, `document.documentElement.dataset.orgSwitching === "false"
    && !document.querySelector("[data-org-select]")?.disabled
    && !document.querySelector("[data-command-input]")?.disabled`, `organization switch UI ready ${orgId}`, 15_000, diagnostics);
}

async function browserApi(cdp, route, { method = "GET", body } = {}) {
  return evaluate(cdp, `fetch(${JSON.stringify(route)}, {
    method: ${JSON.stringify(method)},
    headers: {
      Authorization: "Bearer " + sessionStorage.getItem("pf.live.sessionToken.v1"),
      ${body === undefined ? "" : '"Content-Type": "application/json",'}
    },
    ${body === undefined ? "" : `body: JSON.stringify(${JSON.stringify(body)}),`}
  }).then(async (response) => ({ status: response.status, body: await response.json().catch(() => null) }))`);
}

async function openWorkspace(cdp, navId, expected, absent = [], diagnostics = null) {
  await evaluate(cdp, `(() => {
    history.pushState(null, "", "#page/" + ${JSON.stringify(navId)});
    window.dispatchEvent(new PopStateEvent("popstate"));
    return true;
  })()`);
  await waitForExpression(cdp, `(() => {
    const text = document.querySelector("main")?.innerText || document.body.innerText;
    return text.includes(${JSON.stringify(expected)});
  })()`, `${navId} workspace containing ${expected}`, 15_000, diagnostics);
  const text = await evaluate(cdp, `document.querySelector("main")?.innerText || document.body.innerText`);
  assert.match(text, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), `${navId} must render its active organization record.`);
  for (const forbidden of absent) assert.doesNotMatch(text, new RegExp(forbidden, "i"), `${navId} must not render another organization's ${forbidden} record.`);
  return text;
}

async function createBusinessFixture(cdp, orgId, marker) {
  const lead = await browserApi(cdp, `/orgs/${orgId}/crm/contacts`, {
    method: "POST",
    body: {
      name: `${marker} Contact`, organization: `${marker} Client`, email: `${marker.toLowerCase()}@example.test`,
      status: "new", source: "Cycle 19 browser proof", notes: `${marker} CRM only`,
    },
  });
  assert.equal(lead.status, 200, `${marker} CRM record must be created.`);

  const proposal = await browserApi(cdp, "/api/proposals", {
    method: "POST",
    body: {
      tenant_id: orgId,
      proposal: {
        ws: orgId === "dev-org-phantomforce" ? "dev-org-chicagoshots" : "dev-org-phantomforce",
        client: `${marker} Proposal`, contact: `${marker} Contact`, pkg: "core", price: marker === "Aegis" ? 1901 : 2902,
        status: "draft", pain: `${marker} proposal only`, scope: ["Tenant isolation proof"], timeline: "One week",
      },
    },
  });
  assert.equal(proposal.status, 200, `${marker} proposal must be created.`);
  assert.equal(proposal.body?.proposal?.ws, orgId, `${marker} proposal must ignore a malicious foreign ws label.`);

  const approval = await browserApi(cdp, "/api/workspace-approvals", {
    method: "POST",
    body: {
      tenant_id: orgId,
      approval: {
        ws: orgId === "dev-org-phantomforce" ? "dev-org-chicagoshots" : "dev-org-phantomforce",
        title: `${marker} Approval`, detail: `${marker} approval only`, type: "browser-proof", status: "pending", requestedBy: "Cycle 19",
      },
    },
  });
  assert.equal(approval.status, 200, `${marker} approval must be created.`);
  assert.equal(approval.body?.approval?.ws, orgId, `${marker} approval must ignore a malicious foreign ws label.`);

  const asset = await browserApi(cdp, `/orgs/${orgId}/assets`, {
    method: "POST",
    body: {
      data_url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      name: `${marker.toLowerCase()}-asset.png`, title: `${marker} Asset`, source: "cycle-19-browser",
    },
  });
  assert.equal(asset.status, 200, `${marker} asset must be created.`);
  return { lead: lead.body, proposal: proposal.body, approval: approval.body, asset: asset.body };
}

async function createAccountingFixture(cdp, marker, diagnostics = null) {
  await evaluate(cdp, `document.querySelector('[data-nav-id="money"]')?.click()`);
  await waitForExpression(cdp, `!!document.querySelector("[data-finance-form]")`, "accounting form", 10_000, diagnostics);
  await evaluate(cdp, `(() => {
    const form = document.querySelector("[data-finance-form]");
    const set = (name, value) => {
      const input = form.elements.namedItem(name);
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    set("description", ${JSON.stringify(`${marker} Transaction`)});
    set("direction", "income");
    set("amount", ${JSON.stringify(marker === "Aegis" ? "119.01" : "229.02")});
    set("category", "Sales income");
    set("account", ${JSON.stringify(`${marker} Checking`)});
    form.requestSubmit();
    return true;
  })()`);
  await waitForExpression(cdp, `document.querySelector("main")?.innerText.includes(${JSON.stringify(`${marker} Transaction`)})`, `${marker} accounting transaction`, 10_000, diagnostics);
  await evaluate(cdp, `document.querySelector('[data-act="connector"][data-id="bank"]')?.click()`);
  await waitForExpression(cdp, `(() => {
    const state = JSON.parse(localStorage.getItem("pf.phantom.v4") || "{}");
    const org = JSON.parse(localStorage.getItem("pf.session.v3") || "{}").orgId;
    return state.finance?.connectors?.some((item) => item.id === "bank" && item.ws === org && item.status === "requested");
  })()`, `${marker} scoped bank connector request`, 10_000, diagnostics);
}

async function businessState(cdp) {
  return evaluate(cdp, `(() => {
    const state = JSON.parse(localStorage.getItem("pf.phantom.v4") || "{}");
    const org = JSON.parse(localStorage.getItem("pf.session.v3") || "{}").orgId;
    return {
      org,
      transactions: (state.finance?.transactions || []).filter((item) => item.ws === org).map((item) => item.description),
      connectors: (state.finance?.connectors || []).filter((item) => item.ws === org).map((item) => ({ id: item.id, status: item.status })),
    };
  })()`);
}

async function viewportState(cdp, width, height) {
  await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width <= 480 });
  await sleep(150);
  return evaluate(cdp, `(() => {
    const input = document.querySelector("[data-command-input]");
    const rect = input?.getBoundingClientRect();
    return {
      width: innerWidth,
      height: innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      composer: rect ? { top: Math.round(rect.top), bottom: Math.round(rect.bottom), width: Math.round(rect.width) } : null,
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
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    const diagnostics = installDiagnostics(cdp);
    const chatRequests = [];
    const businessRequests = [];
    cdp.on("Network.requestWillBeSent", (message) => {
      const request = message.params?.request;
      if (request?.url && /\/(?:orgs\/[^/]+\/(?:crm|assets)|api\/(?:proposals|workspace-approvals))/.test(request.url)) {
        businessRequests.push({ method: request.method, url: request.url, postData: request.postData || "" });
      }
      if (!request?.url?.includes("/phantom-ai/chat") || !request.postData) return;
      try { chatRequests.push(JSON.parse(request.postData)); } catch { diagnostics.push("chat-request", request.postData); }
    });

    const loadEvent = cdp.waitEvent("Page.loadEventFired", 15_000).catch(() => null);
    await cdp.send("Page.navigate", { url: `${baseUrl}/app/` });
    await loadEvent;
    await waitForExpression(cdp, stateExpression(), "database login shell", 20_000, diagnostics);

    await loginAs(cdp, "owner@both.local", diagnostics);
    await waitForExpression(cdp, `!!document.querySelector("[data-org-select]")`, "topbar organization switcher", 15_000, diagnostics);

    const initialMe = await browserAuthMe(cdp);
    assert.equal(initialMe?.activeOrg?.id, "dev-org-phantomforce", "multi-org browser session must start in its first authenticated organization.");

    const headerState = await readSwitcherState(cdp);
    assert.equal(headerState.selectExists, true, "admin header must render an organization switcher.");
    assert.deepEqual(headerState.options.map((option) => option.value), ["dev-org-phantomforce", "dev-org-chicagoshots"], "multi-org owner must see exactly their two memberships.");
    assert.equal(headerState.value, "dev-org-phantomforce", "header switcher value must match the server active org.");

    await evaluate(cdp, `document.querySelector("[data-user-btn]")?.click()`);
    await waitForExpression(cdp, `(() => {
      const menu = document.querySelector("[data-user-menu]");
      return !!menu && !menu.hidden && document.querySelectorAll("[data-user-menu-org]").length > 0;
    })()`, "profile organization menu", 10_000, diagnostics);
    const menuState = await readSwitcherState(cdp);
    assert.deepEqual(menuState.menuButtons.map((button) => button.orgId), ["dev-org-phantomforce", "dev-org-chicagoshots"], "profile menu must only show org memberships returned by the server.");
    assert.equal(menuState.menuButtons[0]?.active, true, "profile menu must mark the server active org as active.");

    const directCrossSwitch = await evaluate(cdp, `fetch("/auth/switch-org", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + sessionStorage.getItem("pf.live.sessionToken.v1"),
      },
      body: JSON.stringify({ orgId: "client-sports-demo" }),
    }).then((response) => ({ status: response.status }))`);
    assert.equal(directCrossSwitch.status, 403, "server must reject a browser switch outside the user's memberships.");

    await evaluate(cdp, `(() => {
      const select = document.querySelector("[data-org-select]");
      const option = document.createElement("option");
      option.value = "client-sports-demo";
      option.textContent = "Unauthorized Sports Demo";
      select.append(option);
      select.value = "client-sports-demo";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);
    await sleep(700);

    const afterTamperMe = await browserAuthMe(cdp);
    assert.equal(afterTamperMe?.activeOrg?.id, "dev-org-phantomforce", "tampered local switcher must not change the server active org.");
    const afterTamperState = await readSwitcherState(cdp);
    assert.deepEqual(afterTamperState.options.map((option) => option.value), ["dev-org-phantomforce", "dev-org-chicagoshots"], "tampered local option must be removed on rerender.");
    assert.equal(afterTamperState.value, "dev-org-phantomforce", "switcher must return to the server active org after a refused switch.");

    const reloadAfterTamper = cdp.waitEvent("Page.loadEventFired", 15_000).catch(() => null);
    await cdp.send("Page.reload", { ignoreCache: true });
    await reloadAfterTamper;
    await waitForExpression(cdp, `!!document.querySelector("[data-command-form]")`, "dashboard after tamper reload", 15_000, diagnostics);

    const aegisFixture = await createBusinessFixture(cdp, "dev-org-phantomforce", "Aegis");
    await createAccountingFixture(cdp, "Aegis", diagnostics);
    await openWorkspace(cdp, "leads", "Aegis Client", ["Beacon Client"], diagnostics);
    await openWorkspace(cdp, "proposals", "Aegis Proposal", ["Beacon Proposal"], diagnostics);
    await openWorkspace(cdp, "approvals", "Aegis Approval", ["Beacon Approval"], diagnostics);
    await openWorkspace(cdp, "assets", "Aegis Asset", ["Beacon Asset"], diagnostics);
    await openWorkspace(cdp, "money", "Aegis Transaction", ["Beacon Transaction"], diagnostics);
    const aegisState = await businessState(cdp);
    assert.deepEqual(aegisState.transactions, ["Aegis Transaction"], "PhantomForce accounting must contain only its transaction.");
    assert.equal(aegisState.connectors.some((item) => item.id === "bank" && item.status === "requested"), true, "PhantomForce bank request must be scoped to PhantomForce.");

    await switchBrowserOrg(cdp, "dev-org-chicagoshots", diagnostics);
    const beaconFixture = await createBusinessFixture(cdp, "dev-org-chicagoshots", "Beacon");
    await createAccountingFixture(cdp, "Beacon", diagnostics);
    await openWorkspace(cdp, "leads", "Beacon Client", ["Aegis Client"], diagnostics);
    await openWorkspace(cdp, "proposals", "Beacon Proposal", ["Aegis Proposal"], diagnostics);
    await openWorkspace(cdp, "approvals", "Beacon Approval", ["Aegis Approval"], diagnostics);
    await openWorkspace(cdp, "assets", "Beacon Asset", ["Aegis Asset"], diagnostics);
    await openWorkspace(cdp, "money", "Beacon Transaction", ["Aegis Transaction"], diagnostics);
    const beaconState = await businessState(cdp);
    assert.deepEqual(beaconState.transactions, ["Beacon Transaction"], "ChicagoShots accounting must contain only its transaction.");
    assert.equal(beaconState.connectors.some((item) => item.id === "bank" && item.status === "requested"), true, "ChicagoShots bank request must be scoped to ChicagoShots.");

    for (const route of [
      "/orgs/client-sports-demo/crm",
      "/orgs/client-sports-demo/assets",
      "/api/proposals?tenant_id=client-sports-demo",
      "/api/workspace-approvals?tenant_id=client-sports-demo",
    ]) {
      const denied = await browserApi(cdp, route);
      assert.equal(denied.status, 403, `non-member browser request must be denied: ${route}`);
    }

    const reloadBusiness = cdp.waitEvent("Page.loadEventFired", 15_000).catch(() => null);
    await cdp.send("Page.reload", { ignoreCache: true });
    await reloadBusiness;
    await waitForExpression(cdp, `document.querySelector("[data-org-select]")?.value === "dev-org-chicagoshots"`, "ChicagoShots shell after business reload", 15_000, diagnostics);
    assert.equal((await browserAuthMe(cdp))?.activeOrg?.id, "dev-org-chicagoshots", "active ChicagoShots organization must survive reload.");
    await openWorkspace(cdp, "leads", "Beacon Client", ["Aegis Client"], diagnostics);
    await openWorkspace(cdp, "money", "Beacon Transaction", ["Aegis Transaction"], diagnostics);

    await switchBrowserOrg(cdp, "dev-org-phantomforce", diagnostics);
    await openWorkspace(cdp, "leads", "Aegis Client", ["Beacon Client"], diagnostics);
    await openWorkspace(cdp, "proposals", "Aegis Proposal", ["Beacon Proposal"], diagnostics);
    await openWorkspace(cdp, "approvals", "Aegis Approval", ["Beacon Approval"], diagnostics);
    await openWorkspace(cdp, "assets", "Aegis Asset", ["Beacon Asset"], diagnostics);
    await openWorkspace(cdp, "money", "Aegis Transaction", ["Beacon Transaction"], diagnostics);
    await evaluate(cdp, `document.querySelector('[data-nav-id="dashboard"]')?.click()`);
    await waitForExpression(cdp, `!!document.querySelector("[data-command-form]")`, "PhantomForce dashboard before chat", 10_000, diagnostics);
    await sleep(1700);

    const reasoningPrompts = [
      "Compare electric cars and hybrids for a city commuter in four concise bullets.",
      "Critique this idea: a neighborhood tool library. Give one strength and one risk.",
    ];
    const creativePrompts = [
      "Help me plan a low-cost birthday party in five short steps.",
      "This explanation feels too robotic. Suggest two ways to make it warmer.",
    ];
    const advisoryPrompts = [
      "Give me a practical three-step plan for my business to earn more repeat customers.",
      "I hate my sales pipeline. Explain one likely cause and one simple improvement.",
    ];
    const localOnlyPrompts = [
      "Remember for later that PhantomForce test color is emerald.",
    ];
    const prompts = [
      "What's your favorite food?",
      "Why that one?",
      "Do you approve of pineapple on pizza?",
      "What queue data structure should I use?",
      "Give me a summary of Hamlet.",
      reasoningPrompts[0],
      creativePrompts[0],
      creativePrompts[1],
      reasoningPrompts[1],
      advisoryPrompts[0],
      advisoryPrompts[1],
      "What is 17 times 19?",
      "Explain recursion in one sentence.",
      "Actually, explain it like I'm twelve.",
      "What makes a good apology?",
      "Give me two names for a fictional moon.",
      "Tell me a short clean joke.",
      "My temporary code word is comet.",
      localOnlyPrompts[0],
      "What was that temporary code word?",
    ];
    const promptResults = [];
    for (const prompt of prompts) promptResults.push(await submitChat(cdp, prompt, diagnostics));
    assert.equal(promptResults.length, 20, "browser must complete the full 20-turn conversation without reload.");
    assert.equal(promptResults.every((result) => result.cards === 0), true, "casual and memory prompts must not create business cards.");
    const ordinaryBusinessLeak = promptResults
      .filter((result) => !advisoryPrompts.includes(result.prompt))
      .find((result) => /ledger|pipeline|actual cash|transaction reader/i.test(result.answer));
    assert.equal(ordinaryBusinessLeak, undefined, `ordinary browser conversation must not leak accounting language: ${JSON.stringify(ordinaryBusinessLeak || null)}`);
    assert.equal(promptResults.filter((result) => advisoryPrompts.includes(result.prompt)).some((result) => /ledger|actual cash|transaction reader|approval queue/i.test(result.answer)), false, "advisory answers must not add unrelated workspace status.");
    assert.match(promptResults.at(-1)?.answer || "", /comet/i, "the twentieth turn must retain the active temporary topic.");

    const reasoningResults = promptResults.filter((result) => reasoningPrompts.includes(result.prompt));
    assert.equal(reasoningResults.every((result) => result.cards === 0 && !result.open), true, "customer reasoning must stay in chat without cards or navigation.");
    assert.match(reasoningResults[0]?.answer || "", /electric/i);
    assert.match(reasoningResults[0]?.answer || "", /hybrid/i);
    assert.match(reasoningResults[1]?.answer || "", /strength|benefit|advantage|great (?:concept|idea)|promotes|helps|useful|fosters|reduces waste|resource sharing/i);
    assert.match(reasoningResults[1]?.answer || "", /risk|challenge|drawback/i);
    const reasoningRequests = chatRequests.filter((request) => reasoningPrompts.includes(request.user_request || request.message));
    assert.equal(reasoningRequests.length, 2, "both customer reasoning prompts must reach the authenticated model endpoint.");
    for (const request of reasoningRequests) {
      assert.equal(request.route_tier, "reasoning");
      assert.equal(request.requested_model, "qwen2.5:14b");
      assert.deepEqual(request.allowed_providers, ["local_ollama"]);
      assert.equal(request.allow_provider_fallback, false);
      assert.equal(request.max_provider_ms, 12000);
      assert.equal((request.module_data || []).every((entry) => entry.module === "recent_conversation"), true);
      assert.doesNotMatch(request.business_summary || "", /Business Manager workspace/i);
    }

    const creativeResults = promptResults.filter((result) => creativePrompts.includes(result.prompt));
    assert.equal(creativeResults.every((result) => result.cards === 0 && !result.open), true, "creative customer prompts must stay in chat.");
    assert.match(creativeResults[0]?.answer || "", /budget|guest|food|activity|venue|home/i);
    assert.match(creativeResults[1]?.answer || "", /warm|personal|natural|conversational|empathy|tone/i);
    const creativeRequests = chatRequests.filter((request) => creativePrompts.includes(request.user_request || request.message));
    assert.equal(creativeRequests.length, 2, "planning and feedback must both reach the model endpoint.");
    assert.equal(creativeRequests.every((request) => request.route_tier === "reasoning"), true);
    assert.equal(creativeRequests.every((request) => request.allowed_providers?.length === 1 && request.allowed_providers[0] === "local_ollama"), true);
    assert.equal(creativeRequests.every((request) => (request.module_data || []).every((entry) => entry.module === "recent_conversation")), true);

    const advisoryResults = promptResults.filter((result) => advisoryPrompts.includes(result.prompt));
    assert.equal(advisoryResults.every((result) => result.cards === 0 && !result.open), true, "business advice must stay action-free.");
    assert.match(advisoryResults[0]?.answer || "", /customer|follow|service|repeat|loyal|referral/i);
    assert.match(advisoryResults[1]?.answer || "", /cause|problem|likely|improve|simpl|follow|stage|lead/i);
    const advisoryRequests = chatRequests.filter((request) => advisoryPrompts.includes(request.user_request || request.message));
    assert.equal(advisoryRequests.length, 2, "both scoped business-advice prompts must reach the model endpoint.");
    for (const request of advisoryRequests) {
      assert.equal(request.route_tier, "advisory");
      assert.equal(request.requested_model, "qwen2.5:14b");
      assert.deepEqual(request.allowed_providers, ["local_ollama"]);
      assert.equal(request.allow_provider_fallback, false);
      assert.match(request.business_summary || "", /Business Manager workspace/i);
      const modules = (request.module_data || []).map((entry) => entry.module);
      assert.equal(modules.includes("active_business"), true);
      assert.equal(modules.every((module) => ["active_business", "saved_memory", "recent_conversation"].includes(module)), true);
      assert.equal(modules.includes("money") || modules.includes("today_plan"), false);
    }

    const continuityResults = [];
    continuityResults.push(await submitChat(cdp, "I want to visit Japan in spring and I have never been.", diagnostics));
    continuityResults.push(await submitChat(cdp, "How long should I stay? Answer in one sentence.", diagnostics));
    assert.match(continuityResults.at(-1)?.answer || "", /(?:day|night|week)/i, "a natural follow-up must use the immediately preceding travel topic.");

    continuityResults.push(await submitChat(cdp, "For this chat only, my dog Nova wears a yellow raincoat.", diagnostics));
    continuityResults.push(await submitChat(cdp, "Correction: Nova's raincoat is purple.", diagnostics));
    continuityResults.push(await submitChat(cdp, "Explain volcanoes in one sentence.", diagnostics));
    continuityResults.push(await submitChat(cdp, "What makes jazz distinctive? One sentence.", diagnostics));
    continuityResults.push(await submitChat(cdp, "Name one interesting thing about Saturn.", diagnostics));
    continuityResults.push(await submitChat(cdp, "What is the difference between a comet and a meteor? One sentence.", diagnostics));
    continuityResults.push(await submitChat(cdp, "Why does bread rise? One sentence.", diagnostics));
    continuityResults.push(await submitChat(cdp, "Give me one fact about honeybees.", diagnostics));
    continuityResults.push(await submitChat(cdp, "What causes ocean tides? One sentence.", diagnostics));
    continuityResults.push(await submitChat(cdp, "Define metaphor in one sentence.", diagnostics));
    continuityResults.push(await submitChat(cdp, "What is the capital of Portugal? City only.", diagnostics));
    continuityResults.push(await submitChat(cdp, "Back to Nova: what color is her raincoat? Color only.", diagnostics));
    const longRevisitRequest = chatRequests.filter((request) => (request.user_request || request.message) === "Back to Nova: what color is her raincoat? Color only.").at(-1);
    writeFileSync(path.join(runDir, "nova-revisit.json"), JSON.stringify({ result: continuityResults.at(-1), request: longRevisitRequest || null }, null, 2));
    assert.match(continuityResults.at(-1)?.answer || "", /^purple[.!]?$/i, "a named older topic must survive nine intervening subjects and retain its correction.");
    assert.ok((longRevisitRequest?.conversation_history || []).length <= 10, "named-topic retrieval must remain privacy bounded.");
    assert.match(JSON.stringify(longRevisitRequest?.conversation_history || []), /Nova[\s\S]*purple/i, "the browser must send the relevant older thread and correction instead of ten unrelated turns.");
    continuityResults.push(await submitChat(cdp, "Dana chose tea and Priya chose coffee.", diagnostics));
    const ambiguitySetupHistory = await evaluate(cdp, `(() => {
      const state = JSON.parse(localStorage.getItem("pf.phantom.v4") || "{}");
      const org = JSON.parse(localStorage.getItem("pf.session.v3") || "{}").orgId;
      return (state.chatHistory || []).filter((item) => item.ws === org).slice(0, 3).map((item) => ({ prompt: item.prompt, reply: item.reply }));
    })()`);
    assert.match(JSON.stringify(ambiguitySetupHistory), /Dana[\s\S]*Priya/, "the ambiguity setup must exist in organization-scoped temporary history before the follow-up");
    const browserClarifier = await submitChat(cdp, "What did she choose?", diagnostics);
    continuityResults.push(browserClarifier);
    const ambiguityRequest = chatRequests.filter((request) => (request.user_request || request.message) === "What did she choose?").at(-1);
    writeFileSync(path.join(runDir, "ambiguity-request.json"), JSON.stringify(ambiguityRequest || null, null, 2));
    assert.match(JSON.stringify(ambiguityRequest?.conversation_history || []), /Dana[\s\S]*Priya/, "the ambiguity follow-up request must carry the setup turn to Hermes");
    assert.equal(browserClarifier.answer, "Do you mean Dana or Priya?", "an ambiguous browser pronoun must produce one useful clarification naming both candidates.");
    assert.equal((browserClarifier.answer.match(/\?/g) || []).length, 1, "ambiguity must produce exactly one clarification question.");
    continuityResults.push(await submitChat(cdp, "The red folder contains invoices. The blue folder contains contracts.", diagnostics));
    const browserFormer = await submitChat(cdp, "What does the former contain? Noun only.", diagnostics);
    continuityResults.push(browserFormer);
    assert.match(browserFormer.answer.trim(), /^invoices$/i, "former must resolve to the first stated object value");
    const browserLatter = await submitChat(cdp, "What does the latter contain? Noun only.", diagnostics);
    continuityResults.push(browserLatter);
    assert.match(browserLatter.answer.trim(), /^contracts$/i, "latter must resolve to the second stated object value without invention");
    continuityResults.push(await submitChat(cdp, "Mina, Theo, and Priya chose tea, coffee, and juice, respectively.", diagnostics));
    const browserTheoChoice = await submitChat(cdp, "What did Theo choose? Drink only.", diagnostics);
    continuityResults.push(browserTheoChoice);
    assert.match(browserTheoChoice.answer.trim(), /^coffee[.!]?$/i, "a named respectively callback must return its exact paired value");
    const browserJuiceOwner = await submitChat(cdp, "Who chose juice? Name only.", diagnostics);
    continuityResults.push(browserJuiceOwner);
    assert.match(browserJuiceOwner.answer.trim(), /^Priya[.!]?$/i, "a reverse respectively callback must return the value's actual owner");
    const browserSecondPerson = await submitChat(cdp, "What did the second person choose? Drink only.", diagnostics);
    continuityResults.push(browserSecondPerson);
    assert.match(browserSecondPerson.answer.trim(), /^coffee[.!]?$/i, "an ordinal person callback must preserve respectively order");
    continuityResults.push(await submitChat(cdp, "Mina and Theo chose tea, coffee, and juice, respectively.", diagnostics));
    const browserUnequalMapping = await submitChat(cdp, "What did Theo choose?", diagnostics);
    continuityResults.push(browserUnequalMapping);
    assert.equal(browserUnequalMapping.answer, "I have 2 people and 3 choices. Which choice belongs to Theo?", "unequal respectively lists must clarify their unmatched pairing instead of guessing");
    continuityResults.push(await submitChat(cdp, "Mina's badge is red and Theo's badge is blue.", diagnostics));
    continuityResults.push(await submitChat(cdp, "Change Mina's badge to gold and Theo's to green.", diagnostics));
    const browserNamedUndoAck = await submitChat(cdp, "Undo Mina's change but keep Theo's.", diagnostics);
    continuityResults.push(browserNamedUndoAck);
    assert.match(browserNamedUndoAck.answer, /Mina's badge to red[\s\S]*Theo's badge remains green/i, "named undo must immediately identify both the restored and preserved person state");
    const browserNamedUndoFinal = await submitChat(cdp, "What are Mina's and Theo's final badge colors? MINA | THEO only.", diagnostics);
    continuityResults.push(browserNamedUndoFinal);
    assert.match(browserNamedUndoFinal.answer.trim(), /^red\s*\|\s*green[.!]?$/i, "undoing Mina must not roll Theo back with her");
    continuityResults.push(await submitChat(cdp, "Mina logged 12 laps, Theo logged 18 laps, and Priya logged 15 laps.", diagnostics));
    const browserComparisonWinner = await submitChat(cdp, "Who logged the most? Name only.", diagnostics);
    continuityResults.push(browserComparisonWinner);
    assert.match(browserComparisonWinner.answer.trim(), /^Theo[.!]?$/i, "the largest named value must retain its owner");
    const browserComparisonDifference = await submitChat(cdp, "How many more laps did Theo log than Mina? Number and unit only.", diagnostics);
    continuityResults.push(browserComparisonDifference);
    writeFileSync(path.join(runDir, "cycle29-comparison-request.json"), JSON.stringify({
      result: browserComparisonDifference,
      request: chatRequests.filter((request) => (request.user_request || request.message) === "How many more laps did Theo log than Mina? Number and unit only.").at(-1) || null,
    }, null, 2));
    assert.match(browserComparisonDifference.answer.trim(), /^6 laps[.!]?$/i, `named difference must use the stated values and unit: ${browserComparisonDifference.answer}`);
    const browserComparisonRanking = await submitChat(cdp, "Rank them from most to least. Names only, separated by >.", diagnostics);
    continuityResults.push(browserComparisonRanking);
    assert.match(browserComparisonRanking.answer.trim(), /^Theo\s*>\s*Priya\s*>\s*Mina[.!]?$/i, "ranking must preserve value ownership and requested direction");
    continuityResults.push(await submitChat(cdp, "Correction: Mina logged 20 laps.", diagnostics));
    const browserCorrectedWinner = await submitChat(cdp, "Who logged the most now? Name only.", diagnostics);
    continuityResults.push(browserCorrectedWinner);
    assert.match(browserCorrectedWinner.answer.trim(), /^Mina[.!]?$/i, "comparison must use Mina's corrected value");
    const browserCorrectedDifference = await submitChat(cdp, "How many more laps did Mina log than Theo? Number and unit only.", diagnostics);
    continuityResults.push(browserCorrectedDifference);
    assert.match(browserCorrectedDifference.answer.trim(), /^2 laps[.!]?$/i, "correcting Mina must preserve Theo's value and recompute the difference");
    continuityResults.push(await submitChat(cdp, "Mina has 4 points and Theo has 4 points.", diagnostics));
    const browserTie = await submitChat(cdp, "Who has more?", diagnostics);
    continuityResults.push(browserTie);
    assert.match(browserTie.answer, /Mina and Theo are tied at 4 points/i, "equal values must report a tie instead of inventing a winner");
    continuityResults.push(await submitChat(cdp, "Mina walked 5 miles and Theo worked 6 hours.", diagnostics));
    const browserIncompatibleUnits = await submitChat(cdp, "Who did more?", diagnostics);
    continuityResults.push(browserIncompatibleUnits);
    assert.equal(browserIncompatibleUnits.answer, "Those values use different units (miles and hours). What should I compare?", "incompatible units must clarify instead of performing meaningless arithmetic");
    continuityResults.push(await submitChat(cdp, "Mina logged 12 laps.", diagnostics));
    const browserMissingValue = await submitChat(cdp, "How many more laps did Mina log than Theo?", diagnostics);
    continuityResults.push(browserMissingValue);
    assert.equal(browserMissingValue.answer, "I have Mina's value, but not Theo's. What is Theo's value?", "a missing comparison value must be requested explicitly");
    continuityResults.push(await submitChat(cdp, "Sequence: 1) Mina opened the gate. 2) Theo rang the bell. 3) Priya crossed the bridge. 4) Theo rang the bell again. 5) Mina closed the gate.", diagnostics));
    const browserEventBefore = await submitChat(cdp, "What happened immediately before Priya crossed the bridge? Event only.", diagnostics);
    continuityResults.push(browserEventBefore);
    assert.match(browserEventBefore.answer.trim(), /^Theo rang the bell[.!]?$/i, "before must return the adjacent stated event");
    const browserEventAfter = await submitChat(cdp, "What happened immediately after Priya crossed the bridge? Event only.", diagnostics);
    continuityResults.push(browserEventAfter);
    assert.match(browserEventAfter.answer.trim(), /^Theo rang the bell again[.!]?$/i, "after must return the adjacent stated event");
    const browserRepeatedEvent = await submitChat(cdp, "What happened before Theo rang the bell?", diagnostics);
    continuityResults.push(browserRepeatedEvent);
    assert.equal(browserRepeatedEvent.answer, "Do you mean the first or second time Theo rang the bell?", "a repeated event target must clarify the occurrence instead of choosing one");
    continuityResults.push(await submitChat(cdp, "Options: 1) email, 2) call, 3) meeting.", diagnostics));
    const browserReorder = await submitChat(cdp, "Move the third before the first. Return the reordered list only.", diagnostics);
    continuityResults.push(browserReorder);
    assert.deepEqual(browserReorder.answer.split(/\r?\n/).map((item) => item.trim()), ["meeting", "email", "call"], "list reorder must return the actual moved options");
    continuityResults.push(await submitChat(cdp, "Mina packed maps and Theo packed snacks.", diagnostics));
    const browserPlural = await submitChat(cdp, "What did they pack? Name each person and item.", diagnostics);
    continuityResults.push(browserPlural);
    assert.match(browserPlural.answer, /(?:Mina.{0,50}maps|maps.{0,50}Mina)/i, `plural reference must retain Mina's item: ${browserPlural.answer}`);
    assert.match(browserPlural.answer, /(?:Theo.{0,50}snacks|snacks.{0,50}Theo)/i, `plural reference must retain Theo's item: ${browserPlural.answer}`);
    continuityResults.push(await submitChat(cdp, "The meeting is Tuesday at 2 PM in Room 4.", diagnostics));
    continuityResults.push(await submitChat(cdp, "Correction: Thursday at 3 PM in Room 7.", diagnostics));
    continuityResults.push(await submitChat(cdp, "Actually, not Room 7. Use Room 9.", diagnostics));
    continuityResults.push(await submitChat(cdp, "Wait, keep Thursday and Room 9, but change the time to 4 PM.", diagnostics));
    const browserCorrectionChain = await submitChat(cdp, "What are the final day, time, and room? DAY | TIME | ROOM only.", diagnostics);
    continuityResults.push(browserCorrectionChain);
    assert.match(browserCorrectionChain.answer.trim(), /^Thursday\s*\|\s*4 PM\s*\|\s*Room 9[.!]?$/i, "the browser must retain the latest value from every correction dimension");
    assert.doesNotMatch(browserCorrectionChain.answer, /Tuesday|2 PM|3 PM|Room 4|Room 7/i, "superseded meeting values must not return");
    continuityResults.push(await submitChat(cdp, "Two results: 1) The upload failed because the file was corrupt. 2) The report arrived late because the export queue stalled.", diagnostics));
    const browserSecondCause = await submitChat(cdp, "Why did the second result happen? Reason only.", diagnostics);
    continuityResults.push(browserSecondCause);
    assert.match(browserSecondCause.answer.trim(), /^the export queue stalled[.!]?$/i, "the browser must extract the cause attached to the requested ordinal result");
    assert.doesNotMatch(browserSecondCause.answer, /file was corrupt|upload failed/i, "the browser must not borrow the competing result's cause");
    const browserCausalOutcome = await submitChat(cdp, "What outcome did that reason explain? Outcome only.", diagnostics);
    continuityResults.push(browserCausalOutcome);
    assert.match(browserCausalOutcome.answer.trim(), /^The report arrived late[.!]?$/i, "that reason must point back to its actual outcome");
    continuityResults.push(await submitChat(cdp, "The battery was empty; therefore, the sensor shut down.", diagnostics));
    const browserTherefore = await submitChat(cdp, "What happened as a result? Outcome only.", diagnostics);
    continuityResults.push(browserTherefore);
    assert.match(browserTherefore.answer.trim(), /^the sensor shut down[.!]?$/i, "therefore must preserve the explicitly stated result");
    continuityResults.push(await submitChat(cdp, "The meeting is Tuesday at 2 PM in Room 4.", diagnostics));
    continuityResults.push(await submitChat(cdp, "Correction: Thursday at 3 PM in Room 7.", diagnostics));
    const browserOriginalRollbackAck = await submitChat(cdp, "Actually, keep the original plan after all.", diagnostics);
    continuityResults.push(browserOriginalRollbackAck);
    assert.match(browserOriginalRollbackAck.answer, /Tuesday[\s\S]*2 PM[\s\S]*Room 4/i, "the rollback acknowledgement must immediately name the restored meeting state");
    const browserOriginalRollback = await submitChat(cdp, "What are the final day, time, and room? DAY | TIME | ROOM only.", diagnostics);
    continuityResults.push(browserOriginalRollback);
    writeFileSync(path.join(runDir, "cycle27-rollback-request.json"), JSON.stringify({
      result: browserOriginalRollback,
      request: chatRequests.filter((request) => (request.user_request || request.message) === "What are the final day, time, and room? DAY | TIME | ROOM only.").at(-1) || null,
    }, null, 2));
    assert.match(browserOriginalRollback.answer.trim(), /^Tuesday\s*\|\s*2 PM\s*\|\s*Room 4[.!]?$/i, "an explicit original-plan rollback must restore every original field");
    assert.doesNotMatch(browserOriginalRollback.answer, /Thursday|3 PM|Room 7/i, "a full rollback must not retain superseded correction values");
    continuityResults.push(await submitChat(cdp, "The poster background is black, the title is white, and the button is green.", diagnostics));
    continuityResults.push(await submitChat(cdp, "Change the background to navy, the title to gold, and the button to orange.", diagnostics));
    const browserPartialRollbackAck = await submitChat(cdp, "Actually restore the original title only. Keep the other changes.", diagnostics);
    continuityResults.push(browserPartialRollbackAck);
    assert.match(browserPartialRollbackAck.answer, /original title[\s\S]*navy background[\s\S]*white title[\s\S]*orange button/i, "the partial rollback acknowledgement must immediately name the restored field and preserved changes");
    assert.doesNotMatch(browserPartialRollbackAck.answer, /meeting|Tuesday|Room 4/i, "a design rollback must not inherit an older meeting thread");
    const browserPartialRollback = await submitChat(cdp, "What are the final background, title, and button colors? BACKGROUND | TITLE | BUTTON only.", diagnostics);
    continuityResults.push(browserPartialRollback);
    assert.match(browserPartialRollback.answer.trim(), /^navy\s*\|\s*white\s*\|\s*orange[.!]?$/i, "a partial rollback must restore only the named field");
    assert.doesNotMatch(browserPartialRollback.answer, /black|gold|green/i, "a partial rollback must not revive unrelated original values or the replaced field value");
    assert.equal(continuityResults.every((result) => result.cards === 0), true, "long conversation turns must stay in chat without business cards.");
    assert.equal(continuityResults.some((result) => /ledger|pipeline|actual cash|transaction reader/i.test(result.answer)), false, "long conversation must not leak accounting language.");

    const phantomContext = await localContextState(cdp);
    assert.equal(phantomContext.activeOrg, "dev-org-phantomforce");
    assert.equal(phantomContext.memory.some((text) => /emerald/i.test(text)), true, "explicit PhantomForce memory must be durable and organization-scoped.");
    assert.equal(phantomContext.history.some((item) => /comet/i.test(item.prompt)), true, "PhantomForce temporary history must be organization-scoped.");
    assert.deepEqual(phantomContext.allMemoryScopes, ["dev-org-phantomforce"], "no durable memory may be written to the global HQ scope.");
    assert.deepEqual(phantomContext.allHistoryScopes, ["dev-org-phantomforce"], "no chat history may be written to the global HQ scope.");

    const phantomMemoryText = await openMemory(cdp, diagnostics);
    assert.match(phantomMemoryText, /emerald/i, "PhantomForce memory must render in the Memory UI.");
    assert.match(phantomMemoryText, /(?:navy|white|orange|original title|sensor shut down)/i, "the Memory UI must render recent PhantomForce temporary history while older retained history remains state-verified.");

    const reloadMemory = cdp.waitEvent("Page.loadEventFired", 15_000).catch(() => null);
    await cdp.send("Page.reload", { ignoreCache: true });
    await reloadMemory;
    await waitForExpression(cdp, `!!document.querySelector("[data-memory-search]")`, "reloaded memory workspace", 15_000, diagnostics);
    const reloadedMemoryText = await evaluate(cdp, `document.querySelector("main")?.innerText || ""`);
    assert.match(reloadedMemoryText, /emerald/i, "durable memory must survive a browser reload.");

    await switchBrowserOrg(cdp, "dev-org-chicagoshots", diagnostics);
    const chicagoBodyAfterSwitch = await evaluate(cdp, `document.body.innerText`);
    assert.doesNotMatch(chicagoBodyAfterSwitch, /emerald|comet/i, "organization switch must clear the previous business chat from the visible UI.");
    const chicagoInitialContext = await localContextState(cdp);
    assert.deepEqual(chicagoInitialContext.memory, [], "ChicagoShots must start without PhantomForce durable memory.");
    assert.deepEqual(chicagoInitialContext.history, [], "ChicagoShots must start without PhantomForce temporary history.");

    const chicagoRequestStart = chatRequests.length;
    const chicagoNoContext = await submitChat(cdp, "What temporary code word did I use earlier?", diagnostics);
    assert.doesNotMatch(chicagoNoContext.answer, /comet|emerald/i, "ChicagoShots answer must not reveal PhantomForce context.");
    const chicagoRequest = chatRequests.slice(chicagoRequestStart).at(-1);
    assert.ok(chicagoRequest, "ChicagoShots casual question must send an authenticated model request.");
    assert.equal(chicagoRequest?.workspace_id, "dev-org-chicagoshots", "ChicagoShots model request must use the active organization ID.");
    assert.doesNotMatch(JSON.stringify(chicagoRequest), /comet|emerald/i, "ChicagoShots request packet must not contain PhantomForce context.");

    await submitChat(cdp, "Remember for later that ChicagoShots test color is gold.", diagnostics);
    await submitChat(cdp, "My temporary code word is lens.", diagnostics);
    let chicagoContext = await localContextState(cdp);
    if (!chicagoContext.history.some((item) => /lens/i.test(item.prompt))) {
      const retriedLens = await submitChat(cdp, "My temporary code word is lens.", diagnostics);
      assert.doesNotMatch(retriedLens.answer, /request failed|unavailable|timed out/i, "temporary context retry must produce a usable answer.");
      chicagoContext = await localContextState(cdp);
    }
    assert.equal(chicagoContext.memory.some((text) => /gold/i.test(text)), true, "ChicagoShots durable memory must save in its own scope.");
    assert.equal(
      chicagoContext.history.some((item) => /lens/i.test(item.prompt)),
      true,
      `ChicagoShots temporary history must save in its own scope: ${JSON.stringify(chicagoContext)}`,
    );
    const chicagoMemoryText = await openMemory(cdp, diagnostics);
    assert.match(chicagoMemoryText, /gold|lens/i, "ChicagoShots memory must render in its Memory UI.");
    assert.doesNotMatch(chicagoMemoryText, /emerald|comet/i, "ChicagoShots Memory UI must not render PhantomForce context.");

    await switchBrowserOrg(cdp, "dev-org-phantomforce", diagnostics);
    const phantomRestored = await localContextState(cdp);
    assert.equal(phantomRestored.memory.some((text) => /emerald/i.test(text)), true, "switching back must restore PhantomForce durable memory.");
    assert.equal(phantomRestored.history.some((item) => /comet/i.test(item.prompt)), true, "switching back must restore PhantomForce temporary context.");
    const restoredMemoryText = await openMemory(cdp, diagnostics);
    assert.match(restoredMemoryText, /emerald|comet/i, "restored PhantomForce context must render in the UI.");
    assert.doesNotMatch(restoredMemoryText, /ChicagoShots test color|\blens\b/i, "restored PhantomForce UI must not contain ChicagoShots context.");

    await evaluate(cdp, `document.querySelector('[data-nav-id="dashboard"]')?.click()`);
    await waitForExpression(cdp, `!!document.querySelector("[data-command-form]")`, "restored dashboard", 10_000, diagnostics);
    const restoredRequestStart = chatRequests.length;
    const restoredAnswer = await submitChat(cdp, "Back to Nova: what color is her raincoat? Color only.", diagnostics);
    const restoredRequest = chatRequests.slice(restoredRequestStart).at(-1);
    assert.match(JSON.stringify(restoredRequest), /Nova[\s\S]*purple/i, "restored PhantomForce request must receive its bounded recent topic and latest correction.");
    assert.doesNotMatch(JSON.stringify(restoredRequest), /\blens\b|ChicagoShots test color/i, "restored PhantomForce request must not receive ChicagoShots context.");
    assert.match(restoredAnswer.answer, /^purple[.!]?$/i, "restored PhantomForce model answer must resolve its own corrected recent topic.");

    const desktop = await viewportState(cdp, 1440, 900);
    const desktopCapture = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const desktopScreenshot = path.join(runDir, "desktop-organization-memory.png");
    writeFileSync(desktopScreenshot, Buffer.from(desktopCapture.data, "base64"));
    const mobile = await viewportState(cdp, 390, 844);
    const mobileCapture = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const mobileScreenshot = path.join(runDir, "mobile-organization-memory.png");
    writeFileSync(mobileScreenshot, Buffer.from(mobileCapture.data, "base64"));
    assert.equal(desktop.scrollWidth, 1440, "desktop browser must have exact viewport width without horizontal overflow.");
    assert.equal(mobile.scrollWidth, 390, "mobile browser must have exact viewport width without horizontal overflow.");
    assert.ok(desktop.composer && desktop.composer.bottom <= desktop.height, "desktop composer must remain visible.");
    assert.ok(mobile.composer && mobile.composer.bottom <= mobile.height, "mobile composer must remain visible.");

    const instantRequests = chatRequests.filter((request) => prompts.includes(request.user_request || request.message)
      && !reasoningPrompts.includes(request.user_request || request.message)
      && !creativePrompts.includes(request.user_request || request.message)
      && !advisoryPrompts.includes(request.user_request || request.message));
    assert.equal(instantRequests.length, prompts.length - reasoningPrompts.length - creativePrompts.length - advisoryPrompts.length - localOnlyPrompts.length, "every model-backed ordinary prompt in the mixed sequence must exercise the authenticated instant lane.");
    assert.equal(instantRequests.every((request) => request.route_tier === "instant"), true, "ordinary 20-turn browser requests must remain on the instant lane.");

    const summary = {
      ok: true,
      checkedAt: new Date().toISOString(),
      apiBase,
      appBase: baseUrl,
      chrome: getChromePath(),
      report: path.join(runDir, "report.json"),
      desktopScreenshot,
      mobileScreenshot,
      checks: [
        "database login renders in browser",
        "multi-organization owner sees exactly two memberships",
        "non-member switch and tampered switcher are rejected",
        "CRM, proposals, approvals, assets, accounting, and connector state remain organization-isolated",
        "client-supplied foreign workspace labels are ignored by the server",
        "active organization and its records survive reload without stale tenant rows",
        "20 mixed browser turns stay conversational without ledger leakage",
        "customer reasoning reaches the bounded local model lane without cards or business context",
        "customer planning and feedback use real model answers instead of canned intent copy",
        "organization advice remains action-free and excludes money, plan, asset, and pulse status",
        "natural follow-ups, exact object/list/causal/respectively/comparative/event references, scoped corrections, and useful ambiguity clarification stay coherent across 90 browser turns",
        "durable memory survives reload inside organization A",
        "organization B receives no A memory, history, request context, or visible chat",
        "organization A returns without organization B contamination",
        "desktop and mobile composer stay visible without horizontal overflow",
      ],
    };
    writeFileSync(summary.report, JSON.stringify({
      ...summary,
      headerState,
      menuState,
      afterTamperState,
      promptResults,
      reasoningResults,
      creativeResults,
      advisoryResults,
      continuityResults,
      phantomContext,
      chicagoContext,
      phantomRestored,
      aegisFixture,
      beaconFixture,
      aegisState,
      beaconState,
      businessRequests,
      desktop,
      mobile,
      chatRequestCount: chatRequests.length,
    }, null, 2));
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
