#!/usr/bin/env node
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { access, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const __selfPath = fileURLToPath(import.meta.url);

/* Fingerprint of the code THIS process is running. Sync-AdminMain compares it
   against the file on disk after every git pull and restarts the server when
   they differ — push to main and the live box follows, no hands involved. */
const sourceHash = (() => {
  try { return createHash("sha256").update(readFileSync(__selfPath)).digest("hex").slice(0, 16); }
  catch { return "unknown"; }
})();

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const repoRoot = path.resolve(argValue("--root", process.env.PF_ADMIN_REPO_ROOT || path.join(__dirname, "..", "..")));
const port = Number(argValue("--port", process.env.PF_ADMIN_PORT || "5177"));
const host = argValue("--host", process.env.PF_ADMIN_HOST || "127.0.0.1");
const apiOrigin = argValue("--api", process.env.PF_ADMIN_API_ORIGIN || "http://127.0.0.1:5190").replace(/\/$/, "");

/* ---------------- Creative Engine transport ----------------
   PRIMARY route: PhantomForce UI -> this backend -> Hermes -> Higgsfield
   MCP/tools (via Hermes's PhantomCut bridge). The higgsfield CLI is an
   OPTIONAL admin/dev fallback, disabled unless explicitly enabled — it is
   never required for normal Media Lab operation and never used silently. */
const CREATIVE_TRANSPORTS = new Set(["hermes_mcp", "cli_fallback", "disabled"]);
const creativeEngine = {
  transport: (() => {
    const raw = String(process.env.CREATIVE_ENGINE_TRANSPORT || "hermes_mcp").trim().toLowerCase();
    return CREATIVE_TRANSPORTS.has(raw) ? raw : "hermes_mcp";
  })(),
  hermesBaseUrl: String(process.env.HERMES_BASE_URL || apiOrigin).replace(/\/+$/, ""),
  hermesToken: String(process.env.HERMES_API_TOKEN || ""),
  hermesHiggsfieldEnabled: String(process.env.HERMES_HIGGSFIELD_ENABLED ?? "true").toLowerCase() !== "false",
  cliFallbackEnabled: String(process.env.HIGGSFIELD_CLI_FALLBACK_ENABLED || "false").toLowerCase() === "true",
};

function hermesAuthHeader(req) {
  if (creativeEngine.hermesToken) return { Authorization: `Bearer ${creativeEngine.hermesToken}` };
  const caller = String(req?.headers?.authorization || "");
  return caller ? { Authorization: caller } : {};
}

async function hermesFetch(pathname, req, init = {}, timeoutMs = 6500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${creativeEngine.hermesBaseUrl}${pathname}`, {
      ...init,
      headers: { ...(init.headers || {}), ...hermesAuthHeader(req) },
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    return { reached: true, status: response.status, ok: response.ok, data };
  } catch (error) {
    return { reached: false, status: 0, ok: false, data: null, error: String(error?.message || error) };
  } finally {
    clearTimeout(timer);
  }
}

const mime = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
  [".ico", "image/x-icon"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".txt", "text/plain; charset=utf-8"],
]);

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(body);
}

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0] || "/");
  const normalized = decoded === "/" || decoded === "/app" || decoded === "/app/" ? "/app/index.html" : decoded;
  const joined = path.resolve(repoRoot, `.${normalized}`);
  if (joined !== repoRoot && !joined.startsWith(`${repoRoot}${path.sep}`)) return null;
  return joined;
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function shouldProxy(urlPath) {
  return urlPath === "/session"
    || urlPath === "/sessions"
    || urlPath.startsWith("/auth/")
    || urlPath.startsWith("/api/vacation-mode")
    || urlPath.startsWith("/phantom-ai/");
}

async function readRequestBody(req, limit = 6_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) throw new Error("request_too_large");
    chunks.push(buffer);
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

async function proxyToApi(req, res) {
  const target = `${apiOrigin}${req.url || "/"}`;
  const headers = { ...req.headers };
  delete headers.host;
  delete headers["content-length"];

  try {
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readRequestBody(req);
    const upstream = await fetch(target, { method: req.method, headers, body });
    const responseHeaders = Object.fromEntries(upstream.headers);
    responseHeaders["cache-control"] = "no-store";
    res.writeHead(upstream.status, responseHeaders);
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.end(buffer);
  } catch (error) {
    send(res, 502, JSON.stringify({ ok: false, error: "Admin API unavailable." }), "application/json; charset=utf-8");
  }
}

function sendJson(res, status, payload) {
  send(res, status, JSON.stringify(payload), "application/json; charset=utf-8");
}

async function validateAdminBearer(req) {
  const authorization = String(req.headers.authorization || "");
  if (!/^Bearer\s+\S+/i.test(authorization)) return null;
  const response = await fetch(`${apiOrigin}/session`, {
    headers: { Authorization: authorization },
  }).catch(() => null);
  if (!response?.ok) return null;
  const payload = await response.json().catch(() => null);
  return payload?.session?.canManageAccess ? payload.session : null;
}

function clampText(value, limit) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function mediaModel(payload) {
  const requested = clampText(payload.model, 80);
  if (payload.modality === "video") {
    return ["seedance_2_0", "kling3_0", "kling3_0_turbo", "marketing_studio_video"].includes(requested)
      ? requested
      : "seedance_2_0";
  }
  return ["gpt_image_2", "nano_banana_2", "nano_banana_flash", "image_auto"].includes(requested)
    ? requested
    : "gpt_image_2";
}

function mediaAspect(payload) {
  const value = clampText(payload?.params?.aspect || payload?.generation_spec?.aspect || "1:1", 16);
  return /^(auto|21:9|16:9|4:3|3:2|1:1|2:3|3:4|4:5|9:16)$/.test(value) ? value : "1:1";
}

function mediaResolution(payload) {
  const quality = clampText(payload?.params?.quality || payload?.generation_spec?.quality || "", 32);
  if (payload.modality === "video") return quality === "high" ? "1080p" : "720p";
  return quality === "high" ? "2k" : "1k";
}

function mediaCount(payload) {
  const raw = Number(payload?.params?.count || payload?.generation_spec?.count || 1);
  return Math.min(4, Math.max(1, Number.isFinite(raw) ? Math.floor(raw) : 1));
}

function mediaDuration(payload) {
  const raw = Number(payload?.params?.duration || payload?.generation_spec?.duration || 6);
  return Math.min(30, Math.max(2, Number.isFinite(raw) ? Math.floor(raw) : 6));
}

function parseHiggsfieldJson(stdout) {
  const text = String(stdout || "").trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = Math.min(
      ...["[", "{"].map((mark) => {
        const index = text.indexOf(mark);
        return index < 0 ? Number.POSITIVE_INFINITY : index;
      }),
    );
    if (!Number.isFinite(start)) return null;
    try { return JSON.parse(text.slice(start)); } catch { return null; }
  }
}

function collectHiggsfieldAssets(value, type, assets = []) {
  if (!value) return assets;
  if (Array.isArray(value)) {
    value.forEach((item) => collectHiggsfieldAssets(item, type, assets));
    return assets;
  }
  if (typeof value === "object") {
    const url = value.result_url || value.url || value.output_url || value.min_result_url;
    if (typeof url === "string" && /^https?:\/\//i.test(url)) {
      assets.push({
        type,
        url,
        meta: {
          job_id: value.id || "",
          thumbnail_url: value.thumbnail_url || "",
          min_result_url: value.min_result_url || "",
          status: value.status || "",
        },
      });
    }
  }
  return assets;
}

function resolveOnPath(commandName) {
  if (commandName.includes("\\") || commandName.includes("/")) {
    return existsSync(commandName) ? commandName : null;
  }
  const pathDirs = String(process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const suffixes = process.platform === "win32"
    ? [".cmd", ".exe", ".bat", ".ps1", ""]
    : [""];
  for (const dir of pathDirs) {
    for (const suffix of suffixes) {
      const candidate = path.join(dir, `${commandName}${suffix}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function higgsfieldInvocation(args) {
  const resolved = resolveOnPath("higgsfield");
  if (process.platform !== "win32") {
    return { command: resolved || "higgsfield", args };
  }
  if (!resolved) {
    return { command: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", "higgsfield", ...args] };
  }
  const lower = resolved.toLowerCase();
  if (lower.endsWith(".ps1")) {
    return { command: "powershell.exe", args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", resolved, ...args] };
  }
  if (lower.endsWith(".cmd") || lower.endsWith(".bat")) {
    return { command: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", resolved, ...args] };
  }
  if (/\.(exe|com)$/i.test(lower)) {
    return { command: resolved, args };
  }
  const bash = resolveOnPath("bash");
  if (bash) {
    return { command: bash, args: [resolved, ...args] };
  }
  return { command: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", resolved, ...args] };
}

function runHiggsfield(args, timeoutMs = 30 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const invocation = higgsfieldInvocation(args);
    const child = spawn(invocation.command, invocation.args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("higgsfield_timeout"));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error((stderr || stdout || `higgsfield_exit_${code}`).slice(0, 500)));
    });
  });
}

/* CLI preflight, cached: /health reports whether the higgsfield CLI is even
   present so the console can say "install it" BEFORE a render burns a wait. */
let cliStatus = { at: 0, present: null, detail: "" };
let cliProbeInFlight = null;
async function refreshCliStatus() {
  if (Date.now() - cliStatus.at < 10 * 60 * 1000 && cliStatus.present !== null) return cliStatus;
  if (cliProbeInFlight) return cliProbeInFlight;
  cliProbeInFlight = probeCliStatus().finally(() => { cliProbeInFlight = null; });
  return cliProbeInFlight;
}
async function probeCliStatus() {
  try {
    const result = await runHiggsfield(["--version"], 15000);
    cliStatus = { at: Date.now(), present: true, detail: clampText(result.stdout || result.stderr, 80) };
  } catch (error) {
    const message = String(error?.message || error);
    cliStatus = {
      at: Date.now(),
      // a usage error still proves the binary exists; only ENOENT-style misses mean "not installed"
      present: !/enoent|not recognized|command not found|no such file/i.test(message),
      detail: clampText(message, 200),
    };
  }
  return cliStatus;
}

/* ---------------- Creative Engine status (safe preflight) ----------------
   Answers, WITHOUT generating anything or spending any credits:
   - can PhantomForce reach Hermes?
   - can Hermes see Higgsfield/MCP tools (via its PhantomCut bridge)?
   - which creative tools are available?
   - is auth missing? is CLI fallback enabled?                              */
async function handleCreativeEngineStatus(req, res) {
  const out = {
    status: "not_configured",
    transport: creativeEngine.transport,
    hermes: { reachable: false, toolsAvailable: false, authOk: false, baseUrl: creativeEngine.hermesBaseUrl },
    higgsfield: { availableThroughHermes: false },
    approvalRequired: true,
    cliFallbackEnabled: creativeEngine.cliFallbackEnabled,
    tools: [],
    message: "",
  };

  if (creativeEngine.transport === "disabled") {
    out.message = "Creative Engine transport is disabled (CREATIVE_ENGINE_TRANSPORT=disabled).";
    sendJson(res, 200, out);
    return;
  }

  const probe = await hermesFetch("/phantom-ai/media-lab/higgsfield/status", req, {}, 6500);
  if (!probe.reached) {
    out.status = "not_configured";
    out.message = `Blocked: Hermes endpoint is not configured or not answering at ${creativeEngine.hermesBaseUrl}. Start Hermes on this box (or set HERMES_BASE_URL).`;
    sendJson(res, 200, out);
    return;
  }
  out.hermes.reachable = true;

  if (probe.status === 401 || probe.status === 403) {
    out.status = "error";
    out.message = "Hermes is reachable but rejected this session — sign in with an admin account (or set HERMES_API_TOKEN).";
    sendJson(res, 200, out);
    return;
  }

  const body = probe.data || {};
  out.hermes.authOk = true;
  const phantomcut = body.phantomcut || {};
  const lanes = body.higgsfield_tool_lanes || null;
  // Tool lanes: the operator-MCP lane (current) or the legacy PhantomCut
  // bridge. Older Hermes builds only report phantomcut.
  const laneUp = lanes
    ? lanes.mcp_cli?.enabled === true || (lanes.phantomcut?.enabled === true && phantomcut.reachable === true)
    : phantomcut.reachable === true;
  const bridgeUp = probe.ok && body.ok !== false && laneUp;
  out.hermes.toolsAvailable = bridgeUp && creativeEngine.hermesHiggsfieldEnabled;
  out.higgsfield.availableThroughHermes = out.hermes.toolsAvailable;
  out.higgsfield.toolLane = lanes ? (lanes.mcp_cli?.enabled ? "mcp_cli" : "phantomcut") : (phantomcut.reachable ? "phantomcut" : "none");

  // optional richer discovery route (newer Hermes builds); absence is fine
  const tools = await hermesFetch("/phantom-ai/creative-engine/tools", req, {}, 5000);
  if (tools.reached && tools.ok && Array.isArray(tools.data?.tools)) {
    out.tools = tools.data.tools;
  } else if (out.hermes.toolsAvailable) {
    out.tools = [
      { name: "higgsfield.draft", available: true, credit_spend: false, note: "creates a draft in your Higgsfield studio; the paid render is approved there" },
      { name: "higgsfield.render", available: false, credit_spend: true, note: "Hermes does not expose a paid render tool route yet (PhantomCut gates it behind RUN_HIGGSFIELD_PAID_JOB)" },
    ];
  }

  if (creativeEngine.cliFallbackEnabled) {
    const cli = await refreshCliStatus();
    out.higgsfield.cli = { present: cli.present, detail: cli.detail };
    const existingRender = out.tools.find((tool) => tool?.name === "higgsfield.render");
    if (existingRender) {
      existingRender.available = cli.present !== false;
      existingRender.route = "POST /generate";
      existingRender.note = "Owner-approved local CLI render lane. The UI must send approved:true before credits can be spent.";
    } else {
      out.tools.push({
        name: "higgsfield.render",
        available: cli.present !== false,
        credit_spend: true,
        route: "POST /generate",
        note: "Owner-approved local CLI render lane. The UI must send approved:true before credits can be spent.",
      });
    }
  }

  if (!creativeEngine.hermesHiggsfieldEnabled) {
    out.status = "error";
    out.message = "Blocked: Higgsfield through Hermes is disabled (HERMES_HIGGSFIELD_ENABLED=false).";
  } else if (out.hermes.toolsAvailable) {
    out.status = "connected";
    out.message = creativeEngine.cliFallbackEnabled
      ? "Creative Engine is connected through Hermes; approved owner renders use the local Higgsfield CLI lane."
      : "Creative Engine is connected through Hermes.";
  } else {
    out.status = "error";
    out.message = lanes
      ? "Blocked: Hermes has no working Higgsfield tool lane. Check that the operator CLI on the admin box has the Higgsfield MCP registered (PHANTOM_HIGGSFIELD_TOOL_MODE=auto), then Re-check."
      : `Blocked: this Hermes build only knows the legacy PhantomCut bridge (${phantomcut.base_url || "127.0.0.1:8787"}), which isn't answering. Pull + restart Hermes to get the operator-MCP lane, then Re-check.`;
  }
  sendJson(res, 200, out);
}

/* Broker a Media Lab brief to Hermes -> Higgsfield tools. Draft-only: this
   NEVER spends credits — the paid render is approved by the owner inside
   Higgsfield/PhantomCut, which is exactly the approval-first contract. */
const HERMES_ASPECTS = new Set(["9:16", "16:9", "1:1", "4:5"]);
async function hermesDraftFromPlan(plan, req) {
  const aspect = HERMES_ASPECTS.has(plan.aspect) ? plan.aspect : (plan.modality === "video" ? "16:9" : "1:1");
  const result = await hermesFetch("/phantom-ai/media-lab/higgsfield/draft", req, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: plan.prompt,
      mode: plan.model === "marketing_studio_video" ? "marketing" : plan.modality,
      model: plan.model,
      duration: String(plan.duration),
      aspect_ratio: aspect,
      resolution: plan.resolution === "2k" && plan.modality === "video" ? "1080p" : plan.resolution,
      media_role: plan.modality === "video" ? "video" : "image",
      product_url: "",
      generate_audio: "",
    }),
  }, 300000);   // the MCP-CLI lane can take minutes; callers run this in a background job

  if (!result.reached) {
    return { ok: false, message: `Blocked: Hermes endpoint is not configured or not answering at ${creativeEngine.hermesBaseUrl}.` };
  }
  if (result.status === 404) {
    return { ok: false, message: "Blocked: Hermes does not expose a render tool route yet (missing POST /phantom-ai/media-lab/higgsfield/draft)." };
  }
  if (result.status === 401 || result.status === 403) {
    return { ok: false, message: "Blocked: Hermes rejected this session — sign in with an admin account (or set HERMES_API_TOKEN)." };
  }
  if (!result.ok || result.data?.ok !== true) {
    const detail = typeof result.data?.error === "string" ? result.data.error : "";
    if (Array.isArray(result.data?.lanes_tried)) {
      // new Hermes: it tried every Higgsfield tool lane and reports each failure
      return { ok: false, message: `Blocked: Hermes tried its Higgsfield tool lanes and none worked — ${detail.slice(0, 240)}. If the MCP lane failed, check that the operator CLI on the admin box has the Higgsfield MCP registered.` };
    }
    // legacy Hermes (PhantomCut-only build): name the old bridge honestly
    if (result.status === 503 || result.data?.phantomcut_reachable === false || /fetch failed|did not respond|econnrefused/i.test(detail)) {
      return { ok: false, message: "Blocked: this Hermes build still routes Higgsfield through the retired PhantomCut bridge, which isn't running. Pull + restart Hermes to switch it to the operator-MCP lane, then hit Re-check." };
    }
    return { ok: false, message: `Blocked: Hermes is reachable, but Higgsfield MCP tools are not available${detail ? ` — ${detail.slice(0, 160)}` : "."}` };
  }
  return { ok: true, draft: result.data.draft || null, safety: result.data.safety || null, toolLane: result.data.tool_lane || "" };
}

/* Renders run as BACKGROUND JOBS: tunnels (Cloudflare et al.) cut a blocking
   request at ~100s, and a Higgsfield render takes minutes. POST /generate with
   async:true returns a job id instantly; the client polls /generate/job/<id>.
   The legacy blocking mode stays for direct/localhost use.                   */
const mediaJobs = new Map();
function pruneMediaJobs() {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, job] of mediaJobs) if (job.at < cutoff) mediaJobs.delete(id);
  while (mediaJobs.size > 40) mediaJobs.delete(mediaJobs.keys().next().value);
}

async function renderMedia(plan) {
  const assets = [];
  for (let index = 0; index < plan.count; index += 1) {
    const args = [
      "generate", "create", plan.model,
      "--prompt", plan.prompt,
      "--aspect_ratio", plan.aspect,
      "--resolution", plan.resolution,
      "--wait",
      "--wait-timeout", plan.modality === "video" ? "30m" : "15m",
      "--json",
      "--no-color",
    ];
    if (plan.modality === "video") args.splice(9, 0, "--duration", String(plan.duration));
    const result = await runHiggsfield(args, plan.modality === "video" ? 31 * 60 * 1000 : 16 * 60 * 1000);
    const parsed = parseHiggsfieldJson(result.stdout);
    collectHiggsfieldAssets(parsed, plan.modality, assets);
    if (!parsed) {
      const urls = String(result.stdout || "").match(/https?:\/\/\S+/g) || [];
      urls.forEach((url) => assets.push({ type: plan.modality, url: url.replace(/[),\]]+$/, ""), meta: {} }));
    }
  }
  return assets.map((asset) => ({
    ...asset,
    meta: {
      ...(asset.meta || {}),
      generation_spec: plan.generation_spec,
      model: plan.model,
      aspect: plan.aspect,
      resolution: plan.resolution,
      session_id: plan.sessionId,
    },
  }));
}

async function handleMediaJobStatus(req, res, urlPath) {
  const session = await validateAdminBearer(req);
  if (!session) {
    sendJson(res, 401, { error: "admin_session_required" });
    return;
  }
  const job = mediaJobs.get(urlPath.slice("/generate/job/".length));
  if (!job) {
    sendJson(res, 404, { error: "job_not_found", message: "This render job is gone — the studio server probably restarted mid-render." });
    return;
  }
  sendJson(res, 200, {
    ok: true,
    job: job.id,
    status: job.status,
    transport: job.transport || "cli_fallback",
    assets: job.assets,
    queued: job.queued === true || undefined,
    draft: job.draft || undefined,
    safety: job.safety || undefined,
    blocked: job.status === "blocked" || undefined,
    error: job.error || undefined,
    message: job.message || undefined,
    live: job.transport !== "hermes_mcp",
    provider: job.transport === "hermes_mcp" ? "higgsfield-via-hermes" : "higgsfield-cli",
    model: job.model,
    generation_spec: job.generation_spec,
  });
}

async function handleMediaGenerate(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }

  const session = await validateAdminBearer(req);
  if (!session) {
    sendJson(res, 401, { error: "admin_session_required" });
    return;
  }

  let payload;
  try {
    const body = await readRequestBody(req);
    payload = JSON.parse(String(body || "{}"));
  } catch (error) {
    sendJson(res, error?.message === "request_too_large" ? 413 : 400, { error: "bad_request" });
    return;
  }

  const prompt = clampText(payload.prompt || payload.original_prompt, 3000);
  if (!prompt) {
    sendJson(res, 400, { error: "empty" });
    return;
  }

  const modality = payload.modality === "video" ? "video" : "image";
  const plan = {
    prompt,
    modality,
    model: mediaModel({ ...payload, modality }),
    aspect: mediaAspect(payload),
    resolution: mediaResolution({ ...payload, modality }),
    duration: mediaDuration(payload),
    count: modality === "video" ? 1 : mediaCount(payload),
    generation_spec: payload.generation_spec || null,
    sessionId: session.id || "",
  };
  const now = Date.now();

  if (creativeEngine.transport === "disabled") {
    sendJson(res, 200, {
      error: "blocked", blocked: true, status: "blocked", transport: "disabled", live: false,
      message: "Blocked: Creative Engine transport is disabled (CREATIVE_ENGINE_TRANSPORT=disabled).",
    });
    return;
  }

  /* PRIMARY: Hermes/MCP for draft/no-spend requests. If the owner already
     approved this request and the admin CLI fallback is enabled, skip the
     fragile draft lane and continue directly to the local CLI render below.
     That keeps normal requests safe while making the explicit Generate button
     actually generate. */
  const ownerApprovedCliRender = creativeEngine.cliFallbackEnabled && payload.approved === true;
  if (creativeEngine.transport === "hermes_mcp" && !ownerApprovedCliRender) {
    const makeHermesJob = () => {
      const id = `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      const job = {
        id, at: now, createdAt: now, updatedAt: now,
        status: "queued", transport: "hermes_mcp",
        brief: prompt, prompt, type: modality,
        approvalRequired: true, approvedAt: null,
        creditWarningShown: payload.credit_warning_shown === true,
        errorMessage: "", assets: [], artifactRefs: [],
        model: plan.model, generation_spec: plan.generation_spec,
        error: "", message: "", queued: false, draft: null, safety: null,
      };
      mediaJobs.set(id, job);
      pruneMediaJobs();
      return job;
    };

    /* ASYNC (default from the UI): the MCP draft can take minutes through the
       operator CLI — answer with a job id instantly so no tunnel can cut it,
       and let the client poll. Sync mode stays for direct/localhost use. */
    if (payload.async === true || /[?&]async=1/.test(req.url || "")) {
      const job = makeHermesJob();
      job.status = "running";
      (async () => {
        const viaHermes = await hermesDraftFromPlan(plan, req).catch((e) => ({ ok: false, message: `Blocked: ${String(e?.message || e).slice(0, 160)}` }));
        if (viaHermes.ok) {
          job.status = "done"; job.queued = true; job.draft = viaHermes.draft; job.safety = viaHermes.safety || { paid_job_called: false };
          job.message = "Brief queued through Hermes — approve the render in your Higgsfield studio. No credits were spent.";
        } else if (!creativeEngine.cliFallbackEnabled) {
          job.status = "blocked"; job.error = "blocked"; job.message = viaHermes.message; job.errorMessage = viaHermes.message;
        } else if (payload.approved === true) {
          // the request carried an explicit approval — run the admin CLI fallback
          try {
            const assets = await renderMedia(plan);
            if (!assets.length) { job.status = "failed"; job.error = "no_assets"; }
            else {
              job.status = "done"; job.transport = "cli_fallback"; job.assets = assets;
              job.artifactRefs = assets.map((a) => a.url); job.approvedAt = Date.now();
            }
          } catch (error) {
            job.status = "failed"; job.error = "higgsfield_cli_failed";
            job.message = String(error?.message || error).slice(0, 220); job.errorMessage = job.message;
          }
        } else {
          job.status = "blocked"; job.error = "approval_required";
          job.message = `${viaHermes.message} The CLI fallback is enabled — approve the render and run it again. This will use your connected creative engine credits. Approve render?`;
          job.errorMessage = job.message;
        }
        job.updatedAt = Date.now();
      })();
      sendJson(res, 200, { ok: true, transport: "hermes_mcp", status: "running", job: job.id, live: false, approvalRequired: true });
      return;
    }

    const viaHermes = await hermesDraftFromPlan(plan, req);
    if (viaHermes.ok) {
      const job = makeHermesJob();
      job.queued = true; job.draft = viaHermes.draft;
      sendJson(res, 200, {
        ok: true, transport: "hermes_mcp", status: "queued", queued: true, live: false,
        job: job.id, draft: viaHermes.draft, approvalRequired: true,
        safety: viaHermes.safety || { paid_job_called: false, upload_performed: false },
        message: "Brief queued through Hermes — approve the render in your Higgsfield studio. No credits were spent.",
      });
      return;
    }
    if (!creativeEngine.cliFallbackEnabled) {
      // honest blocked state — NEVER silently fall back to the CLI
      sendJson(res, 200, {
        error: "blocked", blocked: true, status: "blocked", transport: "hermes_mcp", live: false,
        message: viaHermes.message,
      });
      return;
    }
    // fallback explicitly enabled by the admin — continue into the CLI lane below
  }

  /* CLI lane: optional admin/dev fallback only. Requires the explicit env
     flag AND an explicit approval on the request — CLI renders spend the
     owner's Higgsfield credits directly. */
  if (!creativeEngine.cliFallbackEnabled) {
    sendJson(res, 200, {
      error: "blocked", blocked: true, status: "blocked", transport: creativeEngine.transport, live: false,
      message: "Blocked: the CLI fallback is disabled (set HIGGSFIELD_CLI_FALLBACK_ENABLED=true to allow it for admin/dev use).",
    });
    return;
  }
  if (payload.approved !== true) {
    sendJson(res, 200, {
      error: "approval_required", status: "awaiting_approval", transport: "cli_fallback", live: false,
      message: "This will use your connected creative engine credits. Approve render?",
    });
    return;
  }

  if (payload.async === true || /[?&]async=1/.test(req.url || "")) {
    const id = `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const job = {
      id, at: Date.now(), createdAt: Date.now(), updatedAt: Date.now(),
      status: "running", transport: "cli_fallback",
      brief: plan.prompt, prompt: plan.prompt, type: plan.modality,
      approvalRequired: true, approvedAt: Date.now(),
      creditWarningShown: payload.credit_warning_shown === true,
      errorMessage: "", assets: [], artifactRefs: [],
      error: "", message: "", model: plan.model, generation_spec: plan.generation_spec,
    };
    mediaJobs.set(id, job);
    pruneMediaJobs();
    (async () => {
      try {
        const assets = await renderMedia(plan);
        if (!assets.length) { job.status = "failed"; job.error = "no_assets"; }
        else { job.status = "done"; job.assets = assets; job.artifactRefs = assets.map((a) => a.url); }
        job.updatedAt = Date.now();
      } catch (error) {
        job.status = "failed";
        job.error = "higgsfield_cli_failed";
        job.message = String(error?.message || error).slice(0, 220);
        job.errorMessage = job.message;
        job.updatedAt = Date.now();
      }
    })();
    sendJson(res, 200, { ok: true, job: id, status: "running", provider: "higgsfield-cli", model: plan.model });
    return;
  }

  let assets;
  try {
    assets = await renderMedia(plan);
  } catch (error) {
    sendJson(res, 200, { error: "higgsfield_cli_failed", message: String(error?.message || error).slice(0, 220) });
    return;
  }

  if (!assets.length) {
    sendJson(res, 200, { error: "no_assets" });
    return;
  }

  sendJson(res, 200, {
    assets,
    live: true,
    provider: "higgsfield-cli",
    model: plan.model,
    generation_spec: plan.generation_spec,
  });
}

createServer(async (req, res) => {
  const urlPath = (req.url || "/").split("?")[0];

  if (urlPath === "/health") {
    // answer INSTANTLY from cache — the console probes with a short timeout.
    // The CLI is only preflighted when the admin fallback is explicitly on;
    // normal operation routes through Hermes and never needs the CLI.
    if (creativeEngine.cliFallbackEnabled && (cliStatus.present === null || Date.now() - cliStatus.at > 10 * 60 * 1000)) {
      refreshCliStatus().catch(() => {});
    }
    let jobsRunning = 0;
    for (const job of mediaJobs.values()) if (job.status === "running") jobsRunning += 1;
    send(res, 200, JSON.stringify({
      ok: true,
      service: "phantomforce-admin-static",
      root: repoRoot,
      source_hash: sourceHash,
      jobs_running: jobsRunning,
      creative_transport: creativeEngine.transport,
      cli_fallback_enabled: creativeEngine.cliFallbackEnabled,
      ...(creativeEngine.cliFallbackEnabled
        ? { higgsfield_cli: { present: cliStatus.present, detail: cliStatus.detail } }
        : {}),
    }), "application/json; charset=utf-8");
    return;
  }

  if (urlPath === "/api/creative-engine/status") {
    await handleCreativeEngineStatus(req, res);
    return;
  }

  if (urlPath === "/generate") {
    await handleMediaGenerate(req, res);
    return;
  }

  if (urlPath.startsWith("/generate/job/")) {
    await handleMediaJobStatus(req, res, urlPath);
    return;
  }

  if (shouldProxy(urlPath)) {
    await proxyToApi(req, res);
    return;
  }

  const filePath = safePath(req.url || "/");
  if (!filePath) {
    send(res, 403, "Forbidden");
    return;
  }

  let target = filePath;
  try {
    const info = await stat(target);
    if (info.isDirectory()) target = path.join(target, "index.html");
  } catch {
    if (req.url?.startsWith("/app/") && !(await fileExists(target))) {
      target = path.join(repoRoot, "app", "index.html");
    }
  }

  try {
    const info = await stat(target);
    if (!info.isFile()) throw new Error("not a file");
  } catch {
    send(res, 404, "Not found");
    return;
  }

  const ext = path.extname(target).toLowerCase();
  res.writeHead(200, {
    "content-type": mime.get(ext) || "application/octet-stream",
    "cache-control": ext === ".html" ? "no-store" : "public, max-age=30",
    "x-content-type-options": "nosniff",
  });
  createReadStream(target).pipe(res);
}).listen(port, host, () => {
  console.log(`phantomforce-admin-static serving ${repoRoot} on http://${host}:${port}`);
});
