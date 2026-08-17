import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AiProductsPlatform, JsonFileAdapter, PlatformError, errorEnvelope } from "./platform.mjs";

const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const publicRoot = join(packageRoot, "public");
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json" };

const tokenFor = (request) => String(request.headers.authorization || "").match(/^Bearer\s+(.+)$/i)?.[1] || "";
const paramsFor = (pathname, pattern) => {
  const keys = []; const source = pattern.replace(/:([A-Za-z0-9_]+)/g, (_, key) => { keys.push(key); return "([^/]+)"; }); const match = pathname.match(new RegExp(`^${source}$`));
  return match ? Object.fromEntries(keys.map((key, index) => [key, decodeURIComponent(match[index + 1])])) : null;
};
async function bodyJson(request) {
  const chunks = []; let total = 0;
  for await (const chunk of request) { total += chunk.length; if (total > 1_000_000) throw new PlatformError("PAYLOAD_TOO_LARGE", "The request exceeds the one-megabyte preview limit.", 413); chunks.push(chunk); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new PlatformError("INVALID_JSON", "Send a valid JSON body.", 400); }
}
const headers = (requestId, extra = {}) => ({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY", "X-API-Version": "1", "X-Request-Id": requestId, ...extra });
function sendJson(response, status, payload, requestId, extra = {}) { response.writeHead(status, headers(requestId, { "Content-Type": "application/json; charset=utf-8", ...extra })); response.end(`${JSON.stringify(payload)}\n`); }
function sendExport(response, payload, requestId, artifactId) { response.writeHead(200, headers(requestId, { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="phantom-ai-${artifactId}.json"` })); response.end(`${JSON.stringify(payload, null, 2)}\n`); }
function limiter() {
  const buckets = new Map();
  return (key) => { const minute = Math.floor(Date.now() / 60000); const bucket = buckets.get(key); if (!bucket || bucket.minute !== minute) { buckets.set(key, { minute, count: 1 }); return; } bucket.count += 1; if (bucket.count > 120) throw new PlatformError("RATE_LIMITED", "Too many local requests. Try again shortly.", 429); };
}

export async function createPreviewServer({ dataPath = process.env.PHANTOMSTORE_AI_PRODUCTS_DATA || join(packageRoot, ".local", "phantomstore-ai-products.json"), platform: supplied = null } = {}) {
  const platform = supplied || await new AiProductsPlatform({ adapter: new JsonFileAdapter(resolve(dataPath)) }).init(); const checkRate = limiter();
  const server = createServer(async (request, response) => {
    const requestId = randomUUID(); const url = new URL(request.url || "/", "http://127.0.0.1"); const method = request.method || "GET"; const startedAt = performance.now(); let traceSession = null;
    response.once("finish", () => { if (traceSession) platform.recordTrace({ workspaceId: traceSession.workspaceId, productId: null, operation: `${method} ${url.pathname.replace(/[0-9a-f-]{16,}/gi, ":id")}`, requestId, durationMs: performance.now() - startedAt, resultState: response.statusCode < 400 ? "succeeded" : "failed", errorCode: response.statusCode < 400 ? null : `HTTP_${response.statusCode}` }).catch(() => {}); });
    try {
      if (method === "GET" && ["/health", "/api/v1/health"].includes(url.pathname)) return sendJson(response, 200, platform.status(), requestId);
      if (method === "GET" && url.pathname === "/api/v1/catalog") return sendJson(response, 200, { version: 1, products: platform.catalog() }, requestId);
      if (url.pathname.startsWith("/api/")) {
        const token = tokenFor(request); checkRate(token || request.socket.remoteAddress || "anonymous"); const session = platform.sessionForToken(token); traceSession = session;
        if (method === "GET" && url.pathname === "/api/v1/session") return sendJson(response, 200, { version: 1, session }, requestId);
        if (method === "GET" && url.pathname === "/api/v1/snapshot") return sendJson(response, 200, platform.snapshot(session), requestId);
        if (method === "GET" && url.pathname === "/api/v1/audit") return sendJson(response, 200, { version: 1, items: platform.auditLog(session, url.searchParams.get("limit")) }, requestId);
        if (method === "GET" && url.pathname === "/api/v1/jobs") return sendJson(response, 200, { version: 1, items: platform.jobLog(session) }, requestId);
        if (method === "GET" && url.pathname === "/api/v1/traces") return sendJson(response, 200, { version: 1, items: platform.traceLog(session, url.searchParams.get("limit")) }, requestId);
        if (method === "GET" && url.pathname === "/api/v1/artifacts") return sendJson(response, 200, { version: 1, items: platform.listArtifacts(session, { productId: url.searchParams.get("productId") || "", includeArchived: url.searchParams.get("includeArchived") === "true" }) }, requestId);

        let params = paramsFor(url.pathname, "/api/v1/products/:productId/consent");
        if (method === "POST" && params) return sendJson(response, 200, { version: 1, consent: await platform.setConsent(session, params.productId, await bodyJson(request)) }, requestId);
        params = paramsFor(url.pathname, "/api/v1/products/:productId/artifacts");
        if (method === "POST" && params) return sendJson(response, 201, { version: 1, ...(await platform.createArtifact(session, params.productId, await bodyJson(request), request.headers["idempotency-key"])) }, requestId);
        params = paramsFor(url.pathname, "/api/v1/artifacts/:artifactId");
        if (method === "PATCH" && params) return sendJson(response, 200, { version: 1, ...(await platform.updateArtifact(session, params.artifactId, await bodyJson(request), request.headers["idempotency-key"])) }, requestId);
        if (method === "DELETE" && params) return sendJson(response, 200, { version: 1, ...(await platform.deleteArtifact(session, params.artifactId, String(request.headers["x-confirm-delete"] || ""))) }, requestId);
        params = paramsFor(url.pathname, "/api/v1/artifacts/:artifactId/duplicate");
        if (method === "POST" && params) return sendJson(response, 201, { version: 1, ...(await platform.duplicateArtifact(session, params.artifactId, request.headers["idempotency-key"])) }, requestId);
        params = paramsFor(url.pathname, "/api/v1/artifacts/:artifactId/archive");
        if (method === "POST" && params) return sendJson(response, 200, { version: 1, ...(await platform.archiveArtifact(session, params.artifactId, false)) }, requestId);
        params = paramsFor(url.pathname, "/api/v1/artifacts/:artifactId/restore-archive");
        if (method === "POST" && params) return sendJson(response, 200, { version: 1, ...(await platform.archiveArtifact(session, params.artifactId, true)) }, requestId);
        params = paramsFor(url.pathname, "/api/v1/recovery/:artifactId");
        if (method === "POST" && params) return sendJson(response, 200, { version: 1, ...(await platform.restoreDeletedArtifact(session, params.artifactId)) }, requestId);
        params = paramsFor(url.pathname, "/api/v1/artifacts/:artifactId/analyses");
        if (method === "POST" && params) return sendJson(response, 202, { version: 1, ...(await platform.runAnalysis(session, params.artifactId, await bodyJson(request), request.headers["idempotency-key"])) }, requestId);
        if (method === "GET" && params) return sendJson(response, 200, { version: 1, items: platform.analysesFor(session, params.artifactId) }, requestId);
        params = paramsFor(url.pathname, "/api/v1/artifacts/:artifactId/dependencies");
        if (method === "GET" && params) return sendJson(response, 200, { version: 1, dependency: platform.dependencyStateFor(session, params.artifactId) }, requestId);
        params = paramsFor(url.pathname, "/api/v1/jobs/:jobId/retry");
        if (method === "POST" && params) return sendJson(response, 202, { version: 1, ...(await platform.retryJob(session, params.jobId)) }, requestId);
        params = paramsFor(url.pathname, "/api/v1/jobs/:jobId/cancel");
        if (method === "POST" && params) return sendJson(response, 200, { version: 1, ...(await platform.cancelJob(session, params.jobId)) }, requestId);
        params = paramsFor(url.pathname, "/api/v1/sources/:sourceId");
        if (method === "DELETE" && params) return sendJson(response, 200, { version: 1, ...(await platform.deleteSource(session, params.sourceId, String(request.headers["x-confirm-delete"] || ""))) }, requestId);
        params = paramsFor(url.pathname, "/api/v1/analyses/:analysisId/review");
        if (method === "POST" && params) return sendJson(response, 200, { version: 1, ...(await platform.reviewAnalysis(session, params.analysisId, await bodyJson(request), request.headers["idempotency-key"])) }, requestId);
        params = paramsFor(url.pathname, "/api/v1/artifacts/:artifactId/export");
        if (method === "GET" && params) return sendExport(response, await platform.exportArtifact(session, params.artifactId), requestId, params.artifactId);
        throw new PlatformError("ROUTE_NOT_FOUND", "The requested API route does not exist.", 404);
      }
      if (!['GET', 'HEAD'].includes(method)) throw new PlatformError("METHOD_NOT_ALLOWED", "This route does not accept that method.", 405);
      const publicPath = url.pathname === "/" ? "index.html" : url.pathname.slice(1); const safePath = resolve(publicRoot, publicPath);
      if (!safePath.startsWith(`${publicRoot}\\`) && safePath !== join(publicRoot, "index.html")) throw new PlatformError("ASSET_NOT_FOUND", "The requested asset does not exist.", 404);
      if (publicPath.includes("..")) throw new PlatformError("ASSET_NOT_FOUND", "The requested asset does not exist.", 404);
      const content = await readFile(safePath); response.writeHead(200, headers(requestId, { "Cache-Control": "no-cache", "Content-Type": MIME[extname(safePath)] || "application/octet-stream", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'" }));
      response.end(method === "HEAD" ? undefined : content);
    } catch (error) {
      const safe = error?.code === "ENOENT" ? new PlatformError("ASSET_NOT_FOUND", "The requested asset does not exist.", 404) : error; const status = safe instanceof PlatformError ? safe.status : 500; sendJson(response, status, errorEnvelope(safe, requestId), requestId);
    }
  });
  return { server, platform };
}

export async function startPreviewServer(options = {}) {
  const { server, platform } = await createPreviewServer(options); const port = Number(options.port ?? process.env.PORT ?? 4182); const host = options.host || process.env.HOST || "127.0.0.1";
  await new Promise((resolvePromise, reject) => { server.once("error", reject); server.listen(port, host, resolvePromise); }); const address = server.address(); const actualPort = typeof address === "object" && address ? address.port : port;
  return { server, platform, url: `http://${host}:${actualPort}` };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const running = await startPreviewServer(); console.log(JSON.stringify({ ok: true, url: running.url, demoToken: "ai-demo-owner-token", deployment: "local_preview" }));
}
