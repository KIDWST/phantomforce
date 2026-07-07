#!/usr/bin/env node
// Termina — standalone local terminal wall.
//
// A tiny HTTP server that serves the wall UI and bridges browser tiles to real
// local PTY sessions over WebSocket. It binds to 127.0.0.1 only and is guarded
// by a per-launch token, so nothing off this machine (and no random web page)
// can reach your shells.

import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pty from "node-pty";
import { WebSocketServer } from "ws";

import { loadProfiles, terminalEnv } from "./profiles.js";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(appDir, "public");
const winDir = path.join(appDir, "win");

const HOST = process.env.TERMINA_HOST ?? "127.0.0.1";
const PORT = Number(process.env.TERMINA_PORT ?? 7420);
// A fresh secret per launch. The served page embeds it; cross-origin pages
// cannot read it, so they cannot drive the API or open PTY sockets.
const TOKEN = process.env.TERMINA_TOKEN ?? randomBytes(24).toString("base64url");

const profiles = loadProfiles();
const profileById = new Map(profiles.map((p) => [p.id, p]));

// ---- live session registry -------------------------------------------------

const MAX_BUFFER_BYTES = 200 * 1024;
/** @type {Map<string, { proc: any, status: string, buffer: string, sockets: Set<any>, startedAt: number, exitCode: number|null }>} */
const sessions = new Map();

function publicProfile(p) {
  const live = sessions.get(p.id);
  const running = Boolean(live && live.status === "running");
  return {
    id: p.id,
    label: p.label,
    type: p.type,
    description: p.description,
    cwd: p.cwd,
    interactive: p.interactive !== false,
    blocked: Boolean(p.blocked),
    monitor: Boolean(p.monitor),
    note: p.note,
    status: p.monitor
      ? "live"
      : running
        ? "running"
        : live && live.status === "exited"
          ? "exited"
          : p.blocked
            ? "blocked"
            : "idle",
    exitCode: live?.exitCode ?? null,
  };
}

function broadcast(session, frame) {
  session.buffer = (session.buffer + frame).slice(-MAX_BUFFER_BYTES);
  for (const socket of session.sockets) {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify({ type: "output", data: frame }));
    }
  }
}

function startSession(profile) {
  const existing = sessions.get(profile.id);
  if (existing && existing.status === "running") {
    return existing;
  }

  const session = { proc: null, status: "starting", buffer: "", sockets: new Set(), startedAt: Date.now(), exitCode: null };
  sessions.set(profile.id, session);

  try {
    session.proc = pty.spawn(profile.command, profile.args, {
      name: "xterm-256color",
      cols: 100,
      rows: 30,
      cwd: profile.cwd,
      env: terminalEnv(),
    });
    session.status = "running";
    session.proc.onData((data) => broadcast(session, data));
    session.proc.onExit(({ exitCode }) => {
      session.status = "exited";
      session.exitCode = exitCode;
      broadcast(session, `\r\n\x1b[90m[session exited: code ${exitCode}]\x1b[0m\r\n`);
    });
  } catch (error) {
    session.status = "error";
    session.exitCode = -1;
    broadcast(session, `\r\n\x1b[91m[failed to start: ${error.message}]\x1b[0m\r\n`);
  }
  return session;
}

function stopSession(id) {
  const session = sessions.get(id);
  if (!session || !session.proc) {
    return false;
  }
  try {
    session.proc.kill();
  } catch {
    /* already gone */
  }
  return true;
}

function writeInput(id, data) {
  const session = sessions.get(id);
  if (session && session.status === "running" && session.proc) {
    session.proc.write(data);
    return true;
  }
  return false;
}

function resize(id, cols, rows) {
  const session = sessions.get(id);
  if (session && session.status === "running" && session.proc) {
    try {
      session.proc.resize(Math.max(2, cols | 0), Math.max(2, rows | 0));
    } catch {
      /* dead pty */
    }
  }
}

// ---- open-windows monitor ---------------------------------------------------

const WINDOW_ACTIONS = new Set(["focus", "minimize", "restore", "maximize", "close", "reveal"]);

// Run one of our predefined PowerShell helpers (no shell, fixed script path).
function runPwsh(scriptPath, args = []) {
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath, ...args],
      { timeout: 8000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        if (error && !stdout) {
          resolve({ ok: false, error: "helper_failed", detail: error.message.split("\n")[0] });
          return;
        }
        try {
          resolve(JSON.parse(stdout.trim() || "{}"));
        } catch {
          resolve({ ok: false, error: "bad_helper_output" });
        }
      },
    );
  });
}

async function listOpenWindows() {
  if (process.platform !== "win32") {
    return { ok: false, error: "windows_only", windows: [] };
  }
  const result = await runPwsh(path.join(winDir, "list-windows.ps1"));
  // PowerShell serializes a single-element array as an object; normalize it.
  if (result.windows && !Array.isArray(result.windows)) {
    result.windows = [result.windows];
  }
  if (!result.windows) result.windows = [];
  return result;
}

async function actOnWindow(pid, action) {
  if (process.platform !== "win32") {
    return { ok: false, error: "windows_only" };
  }
  return runPwsh(path.join(winDir, "window-action.ps1"), ["-Action", action, "-ProcessId", String(pid)]);
}

async function captureWindow(pid) {
  if (process.platform !== "win32") {
    return { ok: false, error: "windows_only" };
  }
  return runPwsh(path.join(winDir, "capture-window.ps1"), ["-ProcessId", String(pid)]);
}

async function sendWindowInput(pid, body) {
  if (process.platform !== "win32") {
    return { ok: false, error: "windows_only" };
  }
  const kind = String(body.kind || "");
  if (!["click", "text", "key"].includes(kind)) {
    return { ok: false, error: "bad_kind" };
  }
  const args = ["-ProcessId", String(pid), "-Kind", kind];
  if (kind === "click") {
    const nx = Math.max(0, Math.min(1, Number(body.nx) || 0));
    const ny = Math.max(0, Math.min(1, Number(body.ny) || 0));
    args.push("-NX", String(nx), "-NY", String(ny));
  } else if (kind === "text") {
    args.push("-Text", String(body.text ?? "").slice(0, 200));
  } else if (kind === "key") {
    args.push("-Key", String(body.key ?? "").slice(0, 20));
  }
  return runPwsh(path.join(winDir, "send-input.ps1"), args);
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 64 * 1024) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

// ---- auth helpers -----------------------------------------------------------

function tokenFromRequest(req, url) {
  const header = req.headers["x-termina-token"];
  if (typeof header === "string" && header) return header;
  return url.searchParams.get("token") ?? "";
}

function sameOriginOk(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser or same-origin navigations
  return origin === `http://${HOST}:${PORT}` || origin === `http://localhost:${PORT}`;
}

function sendJson(res, code, body) {
  const payload = JSON.stringify(body);
  res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(payload);
}

// ---- static files -----------------------------------------------------------

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".map": "application/json",
};

function serveStatic(req, res, urlPath) {
  const rel = urlPath === "/" ? "index.html" : decodeURIComponent(urlPath.replace(/^\/+/, ""));
  const filePath = path.join(publicDir, rel);
  // Contain within publicDir.
  if (!filePath.startsWith(publicDir) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return;
  }
  if (rel === "index.html") {
    // Inject the launch token into the page.
    import("node:fs/promises").then(async ({ readFile }) => {
      let html = await readFile(filePath, "utf8");
      html = html.replace("__TERMINA_TOKEN__", TOKEN);
      res.writeHead(200, { "Content-Type": MIME[".html"], "Cache-Control": "no-store" });
      res.end(html);
    });
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream" });
  createReadStream(filePath).pipe(res);
}

// ---- HTTP + REST ------------------------------------------------------------

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const pathName = url.pathname;

  if (!pathName.startsWith("/api/")) {
    serveStatic(req, res, pathName);
    return;
  }

  // Every API call needs the launch token and a same-origin request.
  if (!sameOriginOk(req)) {
    return sendJson(res, 403, { ok: false, error: "bad_origin" });
  }
  if (tokenFromRequest(req, url) !== TOKEN) {
    return sendJson(res, 401, { ok: false, error: "bad_token" });
  }

  if (pathName === "/api/health" && req.method === "GET") {
    return sendJson(res, 200, { ok: true, app: "termina", version: "0.1.0", host: HOST, port: PORT });
  }

  if (pathName === "/api/profiles" && req.method === "GET") {
    return sendJson(res, 200, { ok: true, profiles: profiles.map(publicProfile) });
  }

  // Live list of open application windows on this PC.
  if (pathName === "/api/windows" && req.method === "GET") {
    listOpenWindows().then((data) => sendJson(res, 200, data));
    return;
  }

  // Live thumbnail of one window (JSON with base64 PNG + meta).
  const thumbMatch = pathName.match(/^\/api\/windows\/(\d+)\/thumbnail$/);
  if (thumbMatch && req.method === "GET") {
    captureWindow(Number(thumbMatch[1])).then((data) => sendJson(res, 200, data));
    return;
  }

  // Forward a click/keystroke into a window (background input injection).
  const sendMatch = pathName.match(/^\/api\/windows\/(\d+)\/send$/);
  if (sendMatch && req.method === "POST") {
    readJsonBody(req).then((body) => sendWindowInput(Number(sendMatch[1]), body).then((data) => sendJson(res, 200, data)));
    return;
  }

  // Act on one open window: focus / minimize / restore / maximize / close.
  const winMatch = pathName.match(/^\/api\/windows\/(\d+)\/([a-z]+)$/);
  if (winMatch && req.method === "POST") {
    const pid = Number(winMatch[1]);
    const action = winMatch[2];
    if (!WINDOW_ACTIONS.has(action)) {
      return sendJson(res, 400, { ok: false, error: "bad_action" });
    }
    actOnWindow(pid, action).then((data) => sendJson(res, data.ok ? 200 : 409, data));
    return;
  }

  const startMatch = pathName.match(/^\/api\/sessions\/([\w.-]+)\/(start|stop)$/);
  if (startMatch && req.method === "POST") {
    const [, id, action] = startMatch;
    const profile = profileById.get(id);
    if (!profile) return sendJson(res, 404, { ok: false, error: "unknown_profile" });
    if (profile.monitor) {
      return sendJson(res, 400, { ok: false, error: "not_a_session", detail: "This is a monitor tile, not a terminal." });
    }
    if (action === "start") {
      if (profile.blocked) {
        return sendJson(res, 409, { ok: false, error: "profile_blocked", detail: profile.note });
      }
      const session = startSession(profile);
      return sendJson(res, 200, { ok: session.status !== "error", profile: publicProfile(profile) });
    }
    stopSession(id);
    return sendJson(res, 200, { ok: true, profile: publicProfile(profile) });
  }

  return sendJson(res, 404, { ok: false, error: "not_found" });
});

// ---- WebSocket PTY bridge ---------------------------------------------------

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  if (url.pathname !== "/pty") {
    socket.destroy();
    return;
  }
  // Same-origin + token gate for the socket, too.
  const origin = req.headers.origin;
  const originOk = !origin || origin === `http://${HOST}:${PORT}` || origin === `http://localhost:${PORT}`;
  if (!originOk || url.searchParams.get("token") !== TOKEN) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    attachSocket(ws, url.searchParams.get("session"));
  });
});

function attachSocket(ws, sessionId) {
  const session = sessionId ? sessions.get(sessionId) : null;
  if (!session) {
    ws.send(JSON.stringify({ type: "error", data: "no_live_session" }));
    ws.close();
    return;
  }
  // Replay scrollback so a newly-opened tile shows history immediately.
  if (session.buffer) {
    ws.send(JSON.stringify({ type: "output", data: session.buffer }));
  }
  session.sockets.add(ws);

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type === "input" && typeof msg.data === "string") {
      writeInput(sessionId, msg.data);
    } else if (msg.type === "resize") {
      resize(sessionId, msg.cols, msg.rows);
    }
  });

  ws.on("close", () => session.sockets.delete(ws));
}

// ---- lifecycle --------------------------------------------------------------

function shutdown() {
  for (const [, session] of sessions) {
    try {
      session.proc?.kill();
    } catch {
      /* ignore */
    }
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}/?token=${TOKEN}`;
  console.log("Termina is running.");
  console.log(`  URL:   ${url}`);
  console.log(`  Token: ${TOKEN}`);
  console.log(`  Profiles: ${profiles.length}`);
  // The launcher reads this line to open the app-mode window at the tokened URL.
  console.log(`TERMINA_URL=${url}`);
});
