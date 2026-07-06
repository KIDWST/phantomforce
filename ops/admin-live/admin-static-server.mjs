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

createServer(async (req, res) => {
  if (req.url === "/health") {
    send(res, 200, JSON.stringify({ ok: true, service: "phantomforce-admin-static", root: repoRoot }), "application/json; charset=utf-8");
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
