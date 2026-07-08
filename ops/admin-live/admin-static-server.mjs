#!/usr/bin/env node
import { createReadStream, readFileSync } from "node:fs";
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
  return quality === "high" ? "2k" : "1080p";
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

function runHiggsfield(args, timeoutMs = 30 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const command = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "higgsfield";
    const commandArgs = process.platform === "win32" ? ["/d", "/s", "/c", "higgsfield", ...args] : args;
    const child = spawn(command, commandArgs, { windowsHide: true });
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
    assets: job.assets,
    error: job.error || undefined,
    message: job.message || undefined,
    live: true,
    provider: "higgsfield-cli",
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

  if (payload.async === true || /[?&]async=1/.test(req.url || "")) {
    const id = `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const job = {
      id, at: Date.now(), status: "running", assets: [],
      error: "", message: "", model: plan.model, generation_spec: plan.generation_spec,
    };
    mediaJobs.set(id, job);
    pruneMediaJobs();
    (async () => {
      try {
        const assets = await renderMedia(plan);
        if (!assets.length) { job.status = "failed"; job.error = "no_assets"; }
        else { job.status = "done"; job.assets = assets; }
      } catch (error) {
        job.status = "failed";
        job.error = "higgsfield_cli_failed";
        job.message = String(error?.message || error).slice(0, 220);
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
    // answer INSTANTLY from cache — the console probes with a short timeout,
    // and a slow CLI check must never make the whole studio lane look dead
    if (cliStatus.present === null || Date.now() - cliStatus.at > 10 * 60 * 1000) {
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
      higgsfield_cli: { present: cliStatus.present, detail: cliStatus.detail },
    }), "application/json; charset=utf-8");
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
