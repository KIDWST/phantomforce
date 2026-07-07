#!/usr/bin/env node
// Termina — standalone local terminal wall.
//
// A tiny HTTP server that serves the wall UI and bridges browser tiles to real
// local PTY sessions over WebSocket. Each tile is its own independent terminal,
// so you can run several Codex CLIs and shells at once. Binds to 127.0.0.1 only
// and is guarded by a per-launch token, so nothing off this machine (and no
// random web page) can reach your shells.

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

const HOST = process.env.TERMINA_HOST ?? "127.0.0.1";
const PORT = Number(process.env.TERMINA_PORT ?? 7420);
// A fresh secret per launch. The served page embeds it; cross-origin pages
// cannot read it, so they cannot drive the API or open PTY sockets.
const TOKEN = process.env.TERMINA_TOKEN ?? randomBytes(24).toString("base64url");

const profiles = loadProfiles();
const profileById = new Map(profiles.map((p) => [p.id, p]));

// ---- session registry (one entry per tile terminal) ------------------------

const MAX_BUFFER_BYTES = 256 * 1024;
/** @type {Map<string, {proc:any,profileId:string,status:string,buffer:string,sockets:Set<any>,startedAt:number,exitCode:number|null}>} */
const sessions = new Map();

// Auto-trust: strip ANSI so we can scan a CLI's rendered text for its
// "do you trust this folder/directory?" prompt, then confirm it once.
const ANSI_CSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const ANSI_OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
function stripAnsi(s) {
  return s
    .replace(ANSI_OSC, "")
    .replace(ANSI_CSI, "")
    .replace(/\x1b[=>()][0-9A-Za-z]?/g, "")
    .replace(/[\x00-\x09\x0b-\x1f\x7f]/g, " ");
}
const TRUST_RE = /(do you trust|trust this folder|trust the contents of this|allow this folder)/i;

function broadcast(session, frame) {
  session.buffer = (session.buffer + frame).slice(-MAX_BUFFER_BYTES);
  for (const socket of session.sockets) {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify({ type: "output", data: frame }));
    }
  }
}

// If a CLI shows its folder-trust prompt, confirm it automatically (once).
// These prompts default to the "Yes, trust" option, so pressing Enter accepts.
function maybeAutoTrust(session, data) {
  if (!session.autoTrust || session.trustSent || !session.proc) return;
  session.trustScan = (session.trustScan + stripAnsi(data)).slice(-4000);
  if (TRUST_RE.test(session.trustScan)) {
    session.trustSent = true;
    // Small delay so the prompt is fully interactive before we answer.
    setTimeout(() => {
      try {
        session.proc.write("\r");
      } catch {
        /* pty gone */
      }
    }, 350);
  }
}

function startSession(sessionId, profile, opts = {}) {
  // Replace any prior session under this id.
  const prior = sessions.get(sessionId);
  if (prior) {
    try {
      prior.proc?.kill();
    } catch {
      /* ignore */
    }
    sessions.delete(sessionId);
  }

  const session = {
    proc: null,
    profileId: profile.id,
    status: "starting",
    buffer: "",
    sockets: new Set(),
    startedAt: Date.now(),
    exitCode: null,
    autoTrust: Boolean(profile.autoTrust),
    trustScan: "",
    trustSent: false,
  };
  sessions.set(sessionId, session);

  try {
    session.proc = pty.spawn(profile.command, profile.args, {
      name: "xterm-256color",
      cols: opts.cols || 100,
      rows: opts.rows || 28,
      cwd: profile.cwd,
      env: terminalEnv(),
    });
    session.status = "running";
    session.proc.onData((data) => {
      broadcast(session, data);
      maybeAutoTrust(session, data);
    });
    session.proc.onExit(({ exitCode }) => {
      session.status = "exited";
      session.exitCode = exitCode;
      broadcast(session, `\r\n\x1b[90m[${profile.label} exited: code ${exitCode}]\x1b[0m\r\n`);
    });
  } catch (error) {
    session.status = "error";
    broadcast(session, `\r\n\x1b[91m[failed to start ${profile.label}: ${error.message}]\x1b[0m\r\n`);
  }
  return session;
}

function stopSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return false;
  try {
    session.proc?.kill();
  } catch {
    /* already gone */
  }
  sessions.delete(sessionId);
  return true;
}

function sessionView(id, session) {
  return {
    id,
    profileId: session.profileId,
    status: session.status,
    startedAt: new Date(session.startedAt).toISOString(),
    exitCode: session.exitCode,
  };
}

// ---- helpers ----------------------------------------------------------------

function tokenFromRequest(req, url) {
  const header = req.headers["x-termina-token"];
  if (typeof header === "string" && header) return header;
  return url.searchParams.get("token") ?? "";
}

function sameOriginOk(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  return origin === `http://${HOST}:${PORT}` || origin === `http://localhost:${PORT}`;
}

function sendJson(res, code, body) {
  res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
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
  if (!filePath.startsWith(publicDir) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return;
  }
  if (rel === "index.html") {
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

  if (!sameOriginOk(req)) return sendJson(res, 403, { ok: false, error: "bad_origin" });
  if (tokenFromRequest(req, url) !== TOKEN) return sendJson(res, 401, { ok: false, error: "bad_token" });

  if (pathName === "/api/health" && req.method === "GET") {
    return sendJson(res, 200, { ok: true, app: "termina", version: "0.2.0", host: HOST, port: PORT });
  }

  if (pathName === "/api/profiles" && req.method === "GET") {
    return sendJson(res, 200, {
      ok: true,
      profiles: profiles.map((p) => ({ id: p.id, label: p.label, note: p.note })),
      sessions: Array.from(sessions.entries()).map(([id, s]) => sessionView(id, s)),
    });
  }

  // Start a terminal in a specific tile session. Body: { profile, cols, rows }
  const startMatch = pathName.match(/^\/api\/sessions\/([\w.-]+)\/start$/);
  if (startMatch && req.method === "POST") {
    readJsonBody(req).then((body) => {
      const profile = profileById.get(String(body.profile));
      if (!profile) return sendJson(res, 404, { ok: false, error: "unknown_profile" });
      const session = startSession(startMatch[1], profile, { cols: body.cols, rows: body.rows });
      return sendJson(res, 200, { ok: session.status !== "error", session: sessionView(startMatch[1], session) });
    });
    return;
  }

  const stopMatch = pathName.match(/^\/api\/sessions\/([\w.-]+)\/stop$/);
  if (stopMatch && req.method === "POST") {
    stopSession(stopMatch[1]);
    return sendJson(res, 200, { ok: true });
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
  const origin = req.headers.origin;
  const originOk = !origin || origin === `http://${HOST}:${PORT}` || origin === `http://localhost:${PORT}`;
  if (!originOk || url.searchParams.get("token") !== TOKEN) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => attachSocket(ws, url.searchParams.get("session")));
});

function attachSocket(ws, sessionId) {
  const session = sessionId ? sessions.get(sessionId) : null;
  if (!session) {
    ws.send(JSON.stringify({ type: "error", data: "no_live_session" }));
    ws.close();
    return;
  }
  if (session.buffer) ws.send(JSON.stringify({ type: "output", data: session.buffer }));
  session.sockets.add(ws);

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type === "input" && typeof msg.data === "string" && session.proc && session.status === "running") {
      session.proc.write(msg.data);
    } else if (msg.type === "resize" && session.proc && session.status === "running") {
      try {
        session.proc.resize(Math.max(2, msg.cols | 0), Math.max(2, msg.rows | 0));
      } catch {
        /* dead pty */
      }
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
  console.log(`  Profiles: ${profiles.map((p) => p.label).join(", ")}`);
  console.log(`TERMINA_URL=${url}`);
});
