#!/usr/bin/env node
// Termina — standalone local terminal wall.
//
// A tiny HTTP server that serves the wall UI and bridges browser tiles to real
// local PTY sessions over WebSocket. Each tile is its own independent terminal,
// so you can run several Codex CLIs and shells at once. Binds to 127.0.0.1 only
// and is guarded by a per-launch token, so nothing off this machine (and no
// random web page) can reach your shells.

import { randomBytes } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pty from "node-pty";
import { WebSocketServer } from "ws";

import { buildProfileArgs, loadProfiles, terminalEnv } from "./profiles.js";
import { createDetector } from "./detect/index.js";
import { stripAnsi } from "./detect/strip-ansi.js";
import * as missionStore from "./mission/store.js";
import { parseEvents } from "./mission/protocol.js";
import { submitBracketedPaste } from "./mission/paste.js";
import { buildWorkerPrompt } from "./mission/prompt.js";
import { decomposeObjective } from "./mission/decompose.js";
import { classifyPrompt } from "./mission/classify.js";
import { enhanceObjective } from "./mission/enhance.js";
import { synthesizeMission, renderReportMarkdown } from "./mission/synthesize.js";
import { isGitRepo, slugify, createWorktree, createWorktreeFromRef, removeWorktree } from "./mission/worktree.js";
import { AGENT_PROVIDERS, isAgentProvider, isLaunchMode } from "./mission/adapters.js";
import { findGitRepos } from "./mission/repos.js";
import { CONNECTION_PROVIDERS, readConnections, removeConnection, saveConnection } from "./connections.js";
import { createFrameRecorder, readFrames } from "./mission/recorder.js";
import { maybeCheckpoint, readCheckpoints } from "./mission/checkpoint.js";
import { TOKEN_ADAPTERS, estimateFromChars, costForUsage } from "./mission/tokens.js";
import { shouldPollSession, resolveSoloTranscript } from "./mission/usage-poll.js";
import { MODEL_CATALOG, contextPercent } from "./mission/model-catalog.js";
import {
  appendUsageHistory,
  bucketHistoryByDay,
  checkLimits,
  dayKey,
  loadUsageLimits,
  readUsageHistory,
  shouldBlockSessionStart,
  summarizeUsage,
} from "./usage-limits.js";
import os from "node:os";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(appDir, "public");
const missionScratchDir = path.join(appDir, ".termina", "tmp");

const HOST = process.env.TERMINA_HOST ?? "127.0.0.1";
const PORT = Number(process.env.TERMINA_PORT ?? 7420);
// A fresh secret per launch. The served page embeds it; cross-origin pages
// cannot read it, so they cannot drive the API or open PTY sockets.
const TOKEN = process.env.TERMINA_TOKEN ?? randomBytes(24).toString("base64url");

const profiles = loadProfiles();
const profileById = new Map(profiles.map((p) => [p.id, p]));
const usageLimits = loadUsageLimits(appDir);
// usage-history.jsonl lives directly under .termina — make sure it exists
// before the first append (missions create it lazily, solo tiles may not).
mkdirSync(path.join(appDir, ".termina"), { recursive: true });

// ---- session registry (one entry per tile terminal) ------------------------

const MAX_BUFFER_BYTES = 256 * 1024;
/** @type {Map<string, {proc:any,profileId:string,status:string,buffer:string,sockets:Set<any>,startedAt:number,exitCode:number|null}>} */
const sessions = new Map();

// ---- status detection --------------------------------------------------------

const DETECTOR_TICK_MS = 200;
const captureRoot = path.join(appDir, "training", "captures");
const claudeProjectsDir = path.join(os.homedir(), ".claude", "projects");

function feedDetector(session, data) {
  session.detector.feed(data);
  if (session.detectorTimer) return; // a tick is already pending
  session.detectorTimer = setTimeout(() => {
    session.detectorTimer = null;
    const result = session.detector.evaluate();
    if (!result.raw) return; // nothing new fed since the last tick
    session.lastDetected = result;
    if (session.capture) captureDetection(session, result);
    broadcastStatus(session, result);
    if (session.missionId) feedMissionProtocol(session, result.raw);
    // Not mission-gated: any session whose provider has a real token adapter
    // (mission worker OR solo claude/openrouter tile) gets live telemetry.
    if (shouldPollSession(session)) pollTokenUsage(session).catch(() => {});
  }, DETECTOR_TICK_MS);
}

// Parses this tick's new raw output (not the whole rolling window, so an
// event line is never re-logged twice) for TERMINA_EVENT lines, appends them
// to the mission ledger, broadcasts them to this worker's own tile(s), and —
// for isolated worktree workers — snapshots the worktree via the Mission DVR
// checkpoint manager on qualifying event types.
function feedMissionProtocol(session, raw) {
  const events = parseEvents(stripAnsi(raw));
  if (!events.length) return;
  const mission = missionStore.readMission(appDir, session.missionId);
  const worker = mission?.workers.find((w) => w.id === session.workerId);
  for (const event of events) {
    session.lastLedgerEvent = event;
    const record = { workerId: session.workerId, source: "worker", type: event.type, detail: event.detail ?? null };
    missionStore.appendLedger(appDir, session.missionId, record).catch(() => {});
    const payload = JSON.stringify({ type: "ledger", event: record });
    for (const socket of session.sockets) {
      if (socket.readyState === socket.OPEN) socket.send(payload);
    }
    if (worker) {
      maybeCheckpoint({ appDir, missionId: session.missionId, worker, eventType: event.type }).catch(() => {});
    }
  }
}

// Real usage where a provider adapter can find the CLI's own local
// transcript; otherwise a clearly estimated fallback derived from the
// recorder's own byte count. Pushed to clients and rolled up into
// tokens.json — never silently treated as equal-confidence to real data.
async function pollTokenUsage(session) {
  if (session.missionId) return pollMissionTokenUsage(session);
  return pollSoloTokenUsage(session);
}

async function pollMissionTokenUsage(session) {
  const mission = missionStore.readMission(appDir, session.missionId);
  const worker = mission?.workers.find((w) => w.id === session.workerId);
  if (!worker) return;

  const adapter = TOKEN_ADAPTERS[worker.provider];
  let usage = null;
  let estimated = true;
  let adapterCostUsd = null;
  if (adapter) {
    const transcript = await adapter.findTranscript(worker.cwd, claudeProjectsDir, worker.usageLogPath);
    if (transcript) {
      const real = await adapter.readUsage(transcript);
      usage = {
        inputTokens: real.inputTokens,
        outputTokens: real.outputTokens,
        cacheTokens: real.cacheTokens ?? 0,
        lastTurnInputTokens: real.lastTurnInputTokens ?? null,
        model: real.model,
      };
      adapterCostUsd = typeof real.costUsd === "number" ? real.costUsd : null;
      estimated = false;
    }
  }
  if (!usage) {
    const frames = await readFrames(appDir, session.missionId, session.workerId);
    const charCount = (frames ?? []).reduce((sum, f) => sum + f.data.length, 0);
    const est = estimateFromChars(charCount);
    usage = { inputTokens: est.inputTokens, outputTokens: est.outputTokens, cacheTokens: 0, lastTurnInputTokens: null, model: null };
  }
  const costUsd =
    adapterCostUsd ??
    costForUsage({ model: usage.model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cacheTokens: usage.cacheTokens });
  const snapshot = {
    ...usage,
    provider: worker.provider,
    contextPercent: contextPercent(usage.model, usage.lastTurnInputTokens),
    costUsd,
    estimated,
  };
  recordUsageSnapshot(session, snapshot);

  const payload = JSON.stringify({ type: "tokens", sessionId: session.id, workerId: session.workerId, ...snapshot });
  for (const socket of session.sockets) {
    if (socket.readyState === socket.OPEN) socket.send(payload);
  }
  await missionStore.writeTokens(appDir, session.missionId, session.workerId, { ...usage, costUsd, estimated }).catch(() => {});
}

// Solo tiles: real transcript data only — there is no frames-based estimate
// here (recordings are mission-only), so a tile with no readable transcript
// simply shows nothing rather than something invented. A shared project dir
// with several concurrently-advancing transcripts cannot be attributed with
// certainty, so that data is flagged estimated + attribution:"ambiguous"
// (QA ledger TQA-03) — never presented as real.
async function pollSoloTokenUsage(session) {
  const adapter = TOKEN_ADAPTERS[session.provider];
  if (!adapter || !session.cwd) return;

  let transcript = null;
  let ambiguous = false;
  if (session.provider === "claude") {
    const found = await resolveSoloTranscript(session.cwd, claudeProjectsDir, session.startedAt);
    if (!found) return;
    transcript = found.path;
    ambiguous = found.ambiguous;
  } else {
    transcript = await adapter.findTranscript(session.cwd, claudeProjectsDir, session.usageLogPath);
  }
  if (!transcript) return;

  const real = await adapter.readUsage(transcript);
  const adapterCostUsd = typeof real.costUsd === "number" ? real.costUsd : null;
  const costUsd =
    adapterCostUsd ??
    costForUsage({ model: real.model, inputTokens: real.inputTokens, outputTokens: real.outputTokens, cacheTokens: real.cacheTokens ?? 0 });
  const snapshot = {
    provider: session.provider,
    model: real.model,
    inputTokens: real.inputTokens,
    outputTokens: real.outputTokens,
    cacheTokens: real.cacheTokens ?? 0,
    lastTurnInputTokens: real.lastTurnInputTokens ?? null,
    contextPercent: contextPercent(real.model, real.lastTurnInputTokens ?? null),
    costUsd,
    estimated: ambiguous,
    ...(ambiguous ? { attribution: "ambiguous" } : {}),
  };
  recordUsageSnapshot(session, snapshot);

  const payload = JSON.stringify({ type: "tokens", sessionId: session.id, ...snapshot });
  for (const socket of session.sockets) {
    if (socket.readyState === socket.OPEN) socket.send(payload);
  }
}

// Latest usage snapshot per session (for /api/usage/summary), plus the
// per-poll cost delta appended to the app-level usage-history.jsonl so daily
// totals survive restarts, plus the limit-state transition check.
function recordUsageSnapshot(session, snapshot) {
  session.usage = { ...snapshot, updatedAt: Date.now() };
  if (typeof snapshot.costUsd === "number" && Number.isFinite(snapshot.costUsd)) {
    const prev = typeof session.lastLoggedCostUsd === "number" ? session.lastLoggedCostUsd : 0;
    const delta = snapshot.costUsd - prev;
    if (delta > 0) {
      session.lastLoggedCostUsd = snapshot.costUsd;
      appendUsageHistory(appDir, { ts: Date.now(), sessionId: session.id, costUsd: delta }).catch(() => {});
    }
  }
  maybeEmitLimitState();
}

function currentLimitCheck() {
  const historyByDay = bucketHistoryByDay(readUsageHistory(appDir));
  let sessionTotalUsd = 0;
  for (const [, session] of sessions) {
    if (typeof session.usage?.costUsd === "number") sessionTotalUsd += session.usage.costUsd;
  }
  return checkLimits({ sessionTotalUsd, todayTotalUsd: historyByDay[dayKey()] ?? 0 }, usageLimits);
}

// Broadcast a limit-state transition (ok→warn, warn→over, back to ok, …) to
// every connected client. Advisory only: nothing running is ever killed —
// "over" on the daily limit blocks NEW session starts (409) until the user
// raises the limit in termina.config.json.
let lastLimitState = "ok";
function maybeEmitLimitState() {
  const check = currentLimitCheck();
  if (check.state === lastLimitState) return;
  lastLimitState = check.state;
  const detail = check.breached
    .map((b) => `${b.limit === "daily" ? "today's spend" : "session spend"} $${b.totalUsd.toFixed(2)} of $${b.limitUsd.toFixed(2)} limit`)
    .join("; ");
  const message =
    check.state === "over"
      ? `Spending limit reached (${detail}). New sessions are blocked until you raise the limit in termina.config.json.`
      : check.state === "warn"
        ? `Approaching spending limit (${detail}).`
        : "Spending back under configured limits.";
  const payload = JSON.stringify({ type: "limit", state: check.state, message, breached: check.breached });
  for (const [, session] of sessions) {
    for (const socket of session.sockets) {
      if (socket.readyState === socket.OPEN) socket.send(payload);
    }
  }
}

function statusPayload(result) {
  return JSON.stringify({
    type: "status",
    state: result.state,
    confidence: result.confidence,
    ruleId: result.ruleId,
    label: result.label,
    why: result.why,
    match: result.match ? result.match.slice(0, 160) : null,
  });
}

function broadcastStatus(session, result) {
  const payload = statusPayload(result);
  for (const socket of session.sockets) {
    if (socket.readyState === socket.OPEN) socket.send(payload);
  }
}

// Best-effort, local-only capture for building future detector fixtures. Never
// blocks the session if the write fails.
function captureDetection(session, result) {
  try {
    const dir = path.join(captureRoot, session.profileId);
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${session.captureId}.jsonl`);
    const line = JSON.stringify({
      ts: Date.now(),
      provider: session.profileId,
      raw: result.raw,
      stripped: result.stripped,
      state: result.state,
      confidence: result.confidence,
      ruleId: result.ruleId,
    });
    appendFile(file, line + "\n", "utf8").catch(() => {});
  } catch {
    /* best effort only */
  }
}

// Auto-trust: strip ANSI (shared with the status detector) so we can scan a
// CLI's rendered text for its "do you trust this folder/directory?" prompt,
// then confirm it once.
const TRUST_RE =
  /(do you trust|trust this folder|trust this director|trust this workspace|trust this repo|trust the (files|contents|code) (in|of) this|allow this folder|allow access to this folder|one you trust|you trust\?|quick safety check)/i;
// Some CLIs use a y/n text prompt rather than an arrow-key menu; "(y/n)" or
// "[y/N]" style prompts need an explicit "y", not just Enter.
const YES_NO_RE = /\(y\/n\)|\[y\/n\]/i;

function broadcast(session, frame) {
  session.buffer = (session.buffer + frame).slice(-MAX_BUFFER_BYTES);
  for (const socket of session.sockets) {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify({ type: "output", data: frame }));
    }
  }
}

// If a CLI shows its folder-trust prompt, confirm it automatically (once).
// Arrow-key menu prompts default to the "Yes, trust" option, so Enter accepts
// them; plain "(y/n)" text prompts need an explicit "y" first.
function maybeAutoTrust(session, data) {
  if (!session.autoTrust || session.trustSent || !session.proc) return;
  session.trustScan = (session.trustScan + stripAnsi(data)).slice(-4000);
  if (TRUST_RE.test(session.trustScan)) {
    session.trustSent = true;
    const reply = YES_NO_RE.test(session.trustScan) ? "y\r" : "\r";
    // Small delay so the prompt is fully interactive before we answer.
    setTimeout(() => {
      try {
        session.proc.write(reply);
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
    id: sessionId,
    profileId: profile.id,
    // Provider identity + spawn cwd, recorded so the token poller can find
    // this session's own CLI transcript even for solo (non-mission) tiles.
    provider: profile.detector ?? profile.id,
    cwd: profile.cwd ?? null,
    // Explicitly requested model for this launch (null = the CLI's own
    // default). Applied at spawn via buildProfileArgs — there is no in-band
    // model swap; changing it means a relaunch.
    model: opts.model ?? null,
    usage: null,
    status: "starting",
    buffer: "",
    sockets: new Set(),
    startedAt: Date.now(),
    exitCode: null,
    autoTrust: Boolean(profile.autoTrust),
    trustScan: "",
    trustSent: false,
    detector: createDetector(profile),
    detectorTimer: null,
    lastDetected: null,
    capture: Boolean(opts.capture),
    captureId: `${sessionId}-${Date.now().toString(36)}`,
    missionId: opts.missionId ?? null,
    workerId: opts.workerId ?? null,
    lastLedgerEvent: null,
    // Mission DVR: only mission workers are recorded, never solo tiles.
    recorder: opts.missionId ? createFrameRecorder(appDir, opts.missionId, opts.workerId) : null,
  };
  sessions.set(sessionId, session);

  try {
    const { args, env: modelEnv } = buildProfileArgs(profile, { model: opts.model });
    session.proc = pty.spawn(profile.command, args, {
      name: "xterm-256color",
      cols: opts.cols || 100,
      rows: opts.rows || 28,
      cwd: profile.cwd,
      // Model env override (OPENROUTER_MODEL) wins over the Connections
      // default that terminalEnv injects.
      env: { ...terminalEnv(profile.id), ...modelEnv },
    });
    session.status = "running";
    session.proc.onData((data) => {
      broadcast(session, data);
      maybeAutoTrust(session, data);
      feedDetector(session, data);
      session.recorder?.append(data);
    });
    session.proc.onExit(({ exitCode }) => {
      session.status = "exited";
      session.exitCode = exitCode;
      clearTimeout(session.detectorTimer);
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
  clearTimeout(session.detectorTimer);
  sessions.delete(sessionId);
  return true;
}

function sessionView(id, session) {
  return {
    id,
    profileId: session.profileId,
    model: session.model ?? null,
    status: session.status,
    startedAt: new Date(session.startedAt).toISOString(),
    exitCode: session.exitCode,
  };
}

// ---- mission orchestration ---------------------------------------------------
// Mission state lives on disk (mission.json + ledger.jsonl via mission/store.js)
// as the single source of truth; the API always reads it fresh rather than
// keeping a separate in-memory copy that could drift.

function waitForReady(sessionId, timeoutMs) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      const session = sessions.get(sessionId);
      if (!session) return resolve(false); // stopped mid-wait
      if (session.lastDetected?.state === "waiting") return resolve(true);
      if (Date.now() - start > timeoutMs) return resolve(false);
      setTimeout(check, 500);
    };
    check();
  });
}

// Pastes the prompt, then submits with a short retry sequence once the UI has
// had a moment to finish collapsing the paste into its placeholder — see
// mission/paste.js for why these cannot be combined into one write.
async function submitPrompt(session, prompt) {
  return submitBracketedPaste(session.proc, prompt);
}

const READY_TIMEOUT_MS = 90000; // cold Claude Code boot + trust-prompt round trip + MCP checks can take a while

// Waits for each worker to signal readiness for input, then delivers its
// individualized prompt as one bracketed paste + Enter. All workers are
// waited on concurrently — they're booting independent PTYs at the same
// time, so waiting on them one at a time would make each worker's timeout
// clock start later than the last, for no reason. Runs detached from the
// HTTP request that created the mission — the caller gets the mission object
// back immediately and watches workers come alive over each tile's existing
// WebSocket.
async function dispatchMission(mission) {
  await Promise.all(mission.workers.map((worker) => dispatchToWorker(mission, worker)));
}

async function dispatchToWorker(mission, worker) {
  if (!sessions.has(worker.sessionId)) return;
  const ready = await waitForReady(worker.sessionId, READY_TIMEOUT_MS);
  if (!ready) {
    const record = {
      workerId: worker.id,
      source: "termina",
      type: "BLOCKER",
      detail: `worker did not reach a ready-for-input state within ${READY_TIMEOUT_MS / 1000}s; prompt not sent`,
    };
    await missionStore.appendLedger(appDir, mission.id, record).catch(() => {});
    await updateWorkerStatus(mission.id, worker.id, "blocked");
    return;
  }
  const session = sessions.get(worker.sessionId);
  if (!session) return;
  const prompt = buildWorkerPrompt({ mission, worker });
  try {
    const submit = await submitPrompt(session, prompt);
    const record = {
      workerId: worker.id,
      source: "termina",
      type: "STARTED",
      detail: `individualized prompt dispatched (${submit.submitWrites} submit attempts)`,
    };
    await missionStore.appendLedger(appDir, mission.id, record).catch(() => {});
    await updateWorkerStatus(mission.id, worker.id, "running");
  } catch {
    const record = { workerId: worker.id, source: "termina", type: "FAILED", detail: "failed to write prompt to worker session" };
    await missionStore.appendLedger(appDir, mission.id, record).catch(() => {});
    await updateWorkerStatus(mission.id, worker.id, "failed");
  }
}

// Persists a worker's status into mission.json — the source of truth once no
// live session/card exists to show it (e.g. after a restart, per Phase 1's
// "always show recovered missions as historical" rule).
async function updateWorkerStatus(missionId, workerId, status) {
  const mission = missionStore.readMission(appDir, missionId);
  if (!mission) return;
  const worker = mission.workers.find((w) => w.id === workerId);
  if (!worker) return;
  worker.status = status;
  await missionStore.writeMission(appDir, missionId, mission).catch(() => {});
}

// If any worker fails partway through setup (e.g. createWorktree refuses a
// dirty target directory), every session/worktree already created for this
// mission is torn down before the error propagates — otherwise those would
// be orphaned: never recorded in mission.json (only written after this
// function returns) and never stoppable from the command center.
async function createMissionWorkers({ mission, roles }) {
  const workers = [];
  try {
    for (let i = 0; i < roles.length; i += 1) {
      const role = roles[i];
      const workerId = `w${i + 1}`;
      const slug = slugify(role.name);
      const providerId = isAgentProvider(role.provider) ? role.provider : "claude";
      const providerProfile = profileById.get(providerId);
      if (!providerProfile) throw new Error(`no '${providerId}' profile configured`);

      let cwd = mission.workspaceRoot;
      let branch = null;
      const mode = mission.launchMode; // "plan" | "approval" | "auto"

      // Real per-worker isolation only when the workspace is actually a git
      // repo (worktrees are a git feature). Elsewhere, workers in
      // approval/auto mode share the one folder directly — a real
      // collision risk with 2+ writers, but not gated on git existing,
      // since the CLI itself runs fine in any plain folder.
      if (mission.isolated) {
        const wt = await createWorktree({ repoRoot: mission.workspaceRoot, missionId: mission.id, workerSlug: slug });
        cwd = wt.path;
        branch = wt.branch;
      }

      const usageLogPath =
        providerId === "openrouter"
          ? path.join(appDir, ".termina", "missions", mission.id, "openrouter-usage", `${workerId}.jsonl`)
          : undefined;
      const workerProfile = {
        ...providerProfile,
        cwd,
        args: AGENT_PROVIDERS[providerId].buildArgs(mode, { usageLogPath }),
      };
      const sessionId = `mission-${mission.id}-${workerId}`;
      const session = startSession(sessionId, workerProfile, { cols: 100, rows: 28, missionId: mission.id, workerId });

      workers.push({
        id: workerId,
        index: i + 1,
        name: role.name,
        scope: role.scope,
        deliverables: role.deliverables,
        prohibited: role.prohibited,
        provider: providerId,
        mode,
        sessionId,
        cwd,
        branch,
        usageLogPath,
        status: session.status === "error" ? "failed" : "starting",
      });
    }
  } catch (error) {
    for (const worker of workers) {
      stopSession(worker.sessionId);
      if (worker.branch) {
        await removeWorktree({ repoRoot: mission.workspaceRoot, targetPath: worker.cwd, force: true }).catch(() => {});
      }
    }
    throw error;
  }
  return workers;
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
  // No caching for any static asset, not just the HTML shell: this is a
  // single-user localhost tool where the files change constantly during
  // active development, and a stale cached script silently masking a real
  // fix (or resurrecting a fixed bug) is far worse than the performance
  // cost of always refetching a handful of small local files.
  res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream", "Cache-Control": "no-store" });
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
      profiles: profiles.map((p) => ({
        id: p.id,
        label: p.label,
        note: p.note,
        cwd: p.cwd,
        projectName: path.basename(p.cwd),
      })),
      sessions: Array.from(sessions.entries()).map(([id, s]) => sessionView(id, s)),
    });
  }

  // Session + daily spend rollup for the totals bar. Costs come only from
  // real usage snapshots; unpriced models stay null, estimated stays flagged.
  if (pathName === "/api/usage/summary" && req.method === "GET") {
    const historyByDay = bucketHistoryByDay(readUsageHistory(appDir));
    const summary = summarizeUsage(sessions.entries(), historyByDay, { limits: usageLimits });
    return sendJson(res, 200, { ok: true, ...summary });
  }

  // Start a terminal in a specific tile session. Body: { profile, cols, rows, capture }
  const startMatch = pathName.match(/^\/api\/sessions\/([\w.-]+)\/start$/);
  if (startMatch && req.method === "POST") {
    // Over the daily spending limit: block NEW sessions only — running ones
    // are never killed.
    if (shouldBlockSessionStart(currentLimitCheck())) {
      return sendJson(res, 409, { ok: false, error: "daily spending limit reached" });
    }
    readJsonBody(req).then((body) => {
      const profile = profileById.get(String(body.profile));
      if (!profile) return sendJson(res, 404, { ok: false, error: "unknown_profile" });
      const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : null;
      const session = startSession(startMatch[1], profile, { cols: body.cols, rows: body.rows, capture: body.capture, model });
      return sendJson(res, 200, { ok: session.status !== "error", session: sessionView(startMatch[1], session) });
    });
    return;
  }

  // The shared model catalog, for the per-tab and global model switchers.
  if (pathName === "/api/models" && req.method === "GET") {
    return sendJson(res, 200, { ok: true, models: MODEL_CATALOG });
  }

  const stopMatch = pathName.match(/^\/api\/sessions\/([\w.-]+)\/stop$/);
  if (stopMatch && req.method === "POST") {
    stopSession(stopMatch[1]);
    return sendJson(res, 200, { ok: true });
  }

  // ---- mission API ------------------------------------------------------

  if (pathName === "/api/repos" && req.method === "GET") {
    return sendJson(res, 200, { ok: true, repos: findGitRepos() });
  }

  if (pathName === "/api/connections" && req.method === "GET") {
    return sendJson(res, 200, { ok: true, connections: readConnections(appDir) });
  }

  const connectionMatch = pathName.match(/^\/api\/connections\/([\w-]+)$/);
  if (connectionMatch && req.method === "POST") {
    const provider = connectionMatch[1];
    if (!Object.prototype.hasOwnProperty.call(CONNECTION_PROVIDERS, provider)) {
      return sendJson(res, 400, { ok: false, error: "unknown_provider" });
    }
    readJsonBody(req)
      .then(async (body) => {
        const apiKey = String(body.apiKey ?? "").trim();
        if (!apiKey) return sendJson(res, 400, { ok: false, error: "api_key_required" });
        await saveConnection(appDir, provider, apiKey, body.extra ? String(body.extra) : undefined);
        return sendJson(res, 200, { ok: true, connections: readConnections(appDir) });
      })
      .catch((error) => sendJson(res, 500, { ok: false, error: error.message }));
    return;
  }

  if (connectionMatch && req.method === "DELETE") {
    const provider = connectionMatch[1];
    removeConnection(appDir, provider)
      .then(() => sendJson(res, 200, { ok: true, connections: readConnections(appDir) }))
      .catch((error) => sendJson(res, 500, { ok: false, error: error.message }));
    return;
  }

  if (pathName === "/api/prompter/classify" && req.method === "POST") {
    readJsonBody(req)
      .then(async (body) => {
        const objective = String(body.objective ?? "").trim();
        const workspaceRoot = String(body.workspaceRoot ?? "").trim();
        if (!objective) return sendJson(res, 400, { ok: false, error: "objective_required" });
        if (!workspaceRoot || !existsSync(workspaceRoot)) return sendJson(res, 400, { ok: false, error: "workspace_root_invalid" });
        const availableProfileIds = profiles.map((p) => p.id);
        const { kind, tiles, costUsd } = await classifyPrompt({ objective, workspaceRoot, availableProfileIds, scratchDir: missionScratchDir });
        return sendJson(res, 200, { ok: true, kind, tiles, costUsd });
      })
      .catch((error) => sendJson(res, 500, { ok: false, error: error.message }));
    return;
  }

  if (pathName === "/api/missions/decompose" && req.method === "POST") {
    readJsonBody(req)
      .then(async (body) => {
        const objective = String(body.objective ?? "").trim();
        // workerCount is optional — omit it to let Claude decide how many
        // distinct workstreams the objective actually calls for.
        const rawCount = parseInt(body.workerCount, 10);
        const workerCount = Number.isFinite(rawCount) && rawCount > 0 ? Math.max(2, Math.min(20, rawCount)) : undefined;
        const workspaceRoot = String(body.workspaceRoot ?? "").trim();
        if (!objective) return sendJson(res, 400, { ok: false, error: "objective_required" });
        if (!workspaceRoot || !existsSync(workspaceRoot)) return sendJson(res, 400, { ok: false, error: "workspace_root_invalid" });
        const { roles, missionName, costUsd } = await decomposeObjective({ objective, workerCount, workspaceRoot, scratchDir: missionScratchDir });
        return sendJson(res, 200, { ok: true, roles, missionName, costUsd });
      })
      .catch((error) => sendJson(res, 500, { ok: false, error: error.message }));
    return;
  }

  if (pathName === "/api/missions/enhance" && req.method === "POST") {
    readJsonBody(req)
      .then(async (body) => {
        const objective = String(body.objective ?? "").trim();
        const workspaceRoot = String(body.workspaceRoot ?? "").trim();
        if (!objective) return sendJson(res, 400, { ok: false, error: "objective_required" });
        if (!workspaceRoot || !existsSync(workspaceRoot)) return sendJson(res, 400, { ok: false, error: "workspace_root_invalid" });
        const { enhancedObjective, whatChanged, costUsd } = await enhanceObjective({ objective, workspaceRoot, scratchDir: missionScratchDir });
        return sendJson(res, 200, { ok: true, enhancedObjective, whatChanged, costUsd });
      })
      .catch((error) => sendJson(res, 500, { ok: false, error: error.message }));
    return;
  }

  if (pathName === "/api/missions" && req.method === "GET") {
    const list = missionStore
      .listMissionIds(appDir)
      .map((id) => missionStore.readMission(appDir, id))
      .filter(Boolean)
      .sort((a, b) => b.createdAt - a.createdAt);
    return sendJson(res, 200, { ok: true, missions: list });
  }

  if (pathName === "/api/missions" && req.method === "POST") {
    readJsonBody(req)
      .then(async (body) => {
        const name = String(body.name ?? "Untitled mission").trim();
        const objective = String(body.objective ?? "").trim();
        const workspaceRoot = String(body.workspaceRoot ?? "").trim();
        const launchMode = isLaunchMode(body.launchMode) ? body.launchMode : "approval";
        const roles = Array.isArray(body.roles) ? body.roles : [];
        if (!objective || !roles.length) return sendJson(res, 400, { ok: false, error: "objective_and_roles_required" });
        if (!workspaceRoot || !existsSync(workspaceRoot)) return sendJson(res, 400, { ok: false, error: "workspace_root_invalid" });
        // A git repo gets real per-worker isolation (worktrees); anywhere
        // else still works, workers just share the one folder directly —
        // not gated on git, since the CLIs themselves don't need a repo.
        const canIsolate = launchMode !== "plan" && (await isGitRepo(workspaceRoot));

        const missionId = randomBytes(6).toString("hex");
        const mission = {
          id: missionId,
          name,
          objective,
          workspaceRoot,
          launchMode,
          isolated: canIsolate,
          status: "running",
          createdAt: Date.now(),
          workers: [],
        };

        try {
          mission.workers = await createMissionWorkers({ mission, roles });
        } catch (error) {
          return sendJson(res, 500, { ok: false, error: `worker setup failed: ${error.message}` });
        }

        await missionStore.writeMission(appDir, missionId, mission);
        for (const worker of mission.workers) {
          await missionStore.appendLedger(appDir, missionId, {
            workerId: worker.id,
            source: "termina",
            type: "STARTED",
            detail: `session ${worker.sessionId} launched (${worker.cwd})`,
          });
        }

        dispatchMission(mission).catch(() => {});

        return sendJson(res, 200, { ok: true, mission });
      })
      .catch((error) => sendJson(res, 500, { ok: false, error: error.message }));
    return;
  }

  const missionGetMatch = pathName.match(/^\/api\/missions\/([\w-]+)$/);
  if (missionGetMatch && req.method === "GET") {
    const mission = missionStore.readMission(appDir, missionGetMatch[1]);
    if (!mission) return sendJson(res, 404, { ok: false, error: "mission_not_found" });
    const ledger = missionStore.readLedger(appDir, missionGetMatch[1]);
    const tokens = missionStore.readTokens(appDir, missionGetMatch[1]);
    return sendJson(res, 200, { ok: true, mission, ledger, tokens });
  }

  const workerActionMatch = pathName.match(/^\/api\/missions\/([\w-]+)\/workers\/([\w-]+)\/(stop|retry)$/);
  if (workerActionMatch && req.method === "POST") {
    const [, missionId, workerId, action] = workerActionMatch;
    const mission = missionStore.readMission(appDir, missionId);
    if (!mission) return sendJson(res, 404, { ok: false, error: "mission_not_found" });
    const worker = mission.workers.find((w) => w.id === workerId);
    if (!worker) return sendJson(res, 404, { ok: false, error: "worker_not_found" });

    if (action === "stop") {
      stopSession(worker.sessionId);
      worker.status = "stopped";
      missionStore
        .writeMission(appDir, missionId, mission)
        .then(() => missionStore.appendLedger(appDir, missionId, { workerId, source: "termina", type: "FAILED", detail: "stopped by user" }))
        .catch(() => {});
      return sendJson(res, 200, { ok: true, worker });
    }

    // retry: same cwd/branch/provider/mode, fresh session id so the client
    // tile can cleanly re-attach (mirrors the existing single-tile Restart).
    stopSession(worker.sessionId);
    const providerId = isAgentProvider(worker.provider) ? worker.provider : "claude";
    const providerProfile = profileById.get(providerId);
    const newSessionId = `mission-${missionId}-${workerId}-r${Date.now().toString(36)}`;
    const workerProfile = {
      ...providerProfile,
      cwd: worker.cwd,
      // Keep the worker's own model (if one was ever set) across the retry.
      args: AGENT_PROVIDERS[providerId].buildArgs(worker.mode, { usageLogPath: worker.usageLogPath, model: worker.model }),
    };
    const session = startSession(newSessionId, workerProfile, { cols: 100, rows: 28, missionId, workerId });
    worker.sessionId = newSessionId;
    worker.status = session.status === "error" ? "failed" : "starting";
    missionStore
      .writeMission(appDir, missionId, mission)
      .then(() => missionStore.appendLedger(appDir, missionId, { workerId, source: "termina", type: "STARTED", detail: "retried by user" }))
      .catch(() => {});

    (async () => {
      const ready = await waitForReady(newSessionId, READY_TIMEOUT_MS);
      if (!ready) return;
      const s = sessions.get(newSessionId);
      if (!s) return;
      const prompt = buildWorkerPrompt({ mission, worker });
      try {
        submitPrompt(s, prompt);
      } catch {
        /* ignore */
      }
    })();

    return sendJson(res, 200, { ok: true, worker });
  }

  // ---- Mission DVR: recordings, checkpoints, tokens, branch -------------

  const recordingMatch = pathName.match(/^\/api\/missions\/([\w-]+)\/recordings\/([\w-]+)$/);
  if (recordingMatch && req.method === "GET") {
    readFrames(appDir, recordingMatch[1], recordingMatch[2]).then((frames) => {
      if (!frames) return sendJson(res, 404, { ok: false, error: "recording_not_found" });
      return sendJson(res, 200, { ok: true, frames });
    });
    return;
  }

  const checkpointsMatch = pathName.match(/^\/api\/missions\/([\w-]+)\/checkpoints$/);
  if (checkpointsMatch && req.method === "GET") {
    readCheckpoints(appDir, checkpointsMatch[1]).then((checkpoints) => sendJson(res, 200, { ok: true, checkpoints }));
    return;
  }

  const tokensMatch = pathName.match(/^\/api\/missions\/([\w-]+)\/tokens$/);
  if (tokensMatch && req.method === "GET") {
    const tokens = missionStore.readTokens(appDir, tokensMatch[1]);
    const history = missionStore.readTokenHistory(appDir, tokensMatch[1]);
    return sendJson(res, 200, { ok: true, tokens, history });
  }

  // Branches a new, brand-new sibling worker from a past checkpoint of an
  // existing isolated worker — filesystem+transcript time-travel only, never
  // process resurrection. The source worker's session/tile is untouched.
  const branchMatch = pathName.match(/^\/api\/missions\/([\w-]+)\/workers\/([\w-]+)\/branch$/);
  if (branchMatch && req.method === "POST") {
    const [, missionId, workerId] = branchMatch;
    readJsonBody(req)
      .then(async (body) => {
        const mission = missionStore.readMission(appDir, missionId);
        if (!mission) return sendJson(res, 404, { ok: false, error: "mission_not_found" });
        const sourceWorker = mission.workers.find((w) => w.id === workerId);
        if (!sourceWorker) return sendJson(res, 404, { ok: false, error: "worker_not_found" });
        if (!sourceWorker.branch) return sendJson(res, 400, { ok: false, error: "worker_not_isolated" });

        const checkpointSha = String(body.checkpointSha ?? "").trim();
        const checkpoints = await readCheckpoints(appDir, missionId);
        const checkpoint = checkpoints.find((c) => c.sha === checkpointSha && c.workerId === workerId);
        if (!checkpoint) return sendJson(res, 400, { ok: false, error: "checkpoint_not_found" });

        const branchIndex = mission.workers.filter((w) => w.id.startsWith(`${workerId}-branch-`)).length + 1;
        const newWorkerId = `${workerId}-branch-${branchIndex}`;
        const slug = `${slugify(sourceWorker.name)}-branch-${branchIndex}`;

        let wt;
        try {
          wt = await createWorktreeFromRef({ repoRoot: mission.workspaceRoot, missionId, workerSlug: slug, ref: checkpointSha });
        } catch (error) {
          return sendJson(res, 500, { ok: false, error: `branch worktree creation failed: ${error.message}` });
        }

        const providerId = isAgentProvider(sourceWorker.provider) ? sourceWorker.provider : "claude";
        const providerProfile = profileById.get(providerId);
        const usageLogPath =
          providerId === "openrouter"
            ? path.join(appDir, ".termina", "missions", missionId, "openrouter-usage", `${newWorkerId}.jsonl`)
            : undefined;
        const workerProfile = { ...providerProfile, cwd: wt.path, args: AGENT_PROVIDERS[providerId].buildArgs(sourceWorker.mode, { usageLogPath }) };
        const sessionId = `mission-${missionId}-${newWorkerId}`;
        const session = startSession(sessionId, workerProfile, { cols: 100, rows: 28, missionId, workerId: newWorkerId });

        const newWorker = {
          id: newWorkerId,
          index: mission.workers.length + 1,
          name: `${sourceWorker.name} (branch ${branchIndex})`,
          scope: sourceWorker.scope,
          deliverables: sourceWorker.deliverables,
          prohibited: sourceWorker.prohibited,
          provider: providerId,
          mode: sourceWorker.mode,
          sessionId,
          cwd: wt.path,
          branch: wt.branch,
          usageLogPath,
          status: session.status === "error" ? "failed" : "starting",
          resumingFrom: {
            checkpointTs: checkpoint.ts,
            summary: String(body.note ?? `Branched from worker ${sourceWorker.name}'s ${checkpoint.ledgerEventType} checkpoint.`),
          },
        };
        mission.workers.push(newWorker);
        await missionStore.writeMission(appDir, missionId, mission);
        await missionStore.appendLedger(appDir, missionId, {
          workerId: newWorkerId,
          source: "termina",
          type: "BRANCHED",
          detail: `branched from ${workerId} at checkpoint ${checkpointSha}`,
        });

        (async () => {
          const ready = await waitForReady(sessionId, READY_TIMEOUT_MS);
          if (!ready) return;
          const s = sessions.get(sessionId);
          if (!s) return;
          try {
            submitPrompt(s, buildWorkerPrompt({ mission, worker: newWorker }));
          } catch {
            /* ignore */
          }
        })();

        return sendJson(res, 200, { ok: true, worker: newWorker });
      })
      .catch((error) => sendJson(res, 500, { ok: false, error: error.message }));
    return;
  }

  const synthesizeMatch = pathName.match(/^\/api\/missions\/([\w-]+)\/synthesize$/);
  if (synthesizeMatch && req.method === "POST") {
    const missionId = synthesizeMatch[1];
    const mission = missionStore.readMission(appDir, missionId);
    if (!mission) return sendJson(res, 404, { ok: false, error: "mission_not_found" });
    const ledger = missionStore.readLedger(appDir, missionId);
    synthesizeMission({ mission, ledger, scratchDir: missionScratchDir })
      .then(async ({ report, costUsd }) => {
        const markdown = renderReportMarkdown(mission, report, costUsd);
        await missionStore.writeReport(appDir, missionId, markdown);
        await missionStore.writeReportJson(appDir, missionId, report);
        return sendJson(res, 200, { ok: true, report, markdown, costUsd });
      })
      .catch((error) => sendJson(res, 500, { ok: false, error: error.message }));
    return;
  }

  const reportMatch = pathName.match(/^\/api\/missions\/([\w-]+)\/report$/);
  if (reportMatch && req.method === "GET") {
    const markdown = missionStore.readReport(appDir, reportMatch[1]);
    if (!markdown) return sendJson(res, 404, { ok: false, error: "report_not_found" });
    const report = missionStore.readReportJson(appDir, reportMatch[1]);
    const approvals = missionStore.readReportApprovals(appDir, reportMatch[1]);
    return sendJson(res, 200, { ok: true, markdown, report, approvals });
  }

  // Phantom Report: approve/skip a proposed next step. Bookkeeping only —
  // never auto-launches anything; the user still acts on it manually.
  const reportStepMatch = pathName.match(/^\/api\/missions\/([\w-]+)\/report\/steps\/([\w-]+)$/);
  if (reportStepMatch && req.method === "POST") {
    const [, missionId, stepId] = reportStepMatch;
    readJsonBody(req)
      .then(async (body) => {
        const decision = body.decision;
        if (decision !== "approved" && decision !== "skipped") {
          return sendJson(res, 400, { ok: false, error: "invalid_decision" });
        }
        const report = missionStore.readReportJson(appDir, missionId);
        if (!report || !report.nextSteps?.some((s) => s.id === stepId)) {
          return sendJson(res, 400, { ok: false, error: "step_not_found" });
        }
        const approvals = await missionStore.writeReportApproval(appDir, missionId, stepId, decision);
        return sendJson(res, 200, { ok: true, approvals });
      })
      .catch((error) => sendJson(res, 500, { ok: false, error: error.message }));
    return;
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
  if (session.lastDetected) ws.send(statusPayload(session.lastDetected));
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
