#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
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

createServer(async (req, res) => {
  if (req.url === "/health") {
    send(res, 200, JSON.stringify({ ok: true, service: "phantomforce-admin-static", root: repoRoot }), "application/json; charset=utf-8");
    return;
  }

  if (shouldProxy((req.url || "/").split("?")[0])) {
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
