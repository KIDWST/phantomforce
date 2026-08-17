import http from "node:http";
import { createHash } from "node:crypto";

const port = Number(process.env.PORT || process.argv[2] || 5299);
const host = process.env.HOST || "127.0.0.1";
const publications = new Map();
const attempts = new Map();
const analyticsAttempts = new Map();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function json(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(payload));
}

async function body(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || `${host}:${port}`}`);
  if (request.method === "GET" && url.pathname === "/health") {
    return json(response, 200, { ok: true, status: "operational", detail: "Golden Path HTTP sandbox is accepting requests." });
  }
  if (request.method === "POST" && url.pathname === "/publications") {
    const payload = await body(request).catch(() => ({}));
    const key = String(request.headers["idempotency-key"] || payload.idempotencyKey || "");
    if (!key) return json(response, 400, { error: "idempotency_key_required" });
    const count = (attempts.get(key) || 0) + 1;
    attempts.set(key, count);
    if (payload.failureMode === "rate_limit_once" && count === 1) return json(response, 429, { error: "rate_limited", message: "Sandbox rate limit injected for the first attempt." });
    if (payload.failureMode === "timeout_once" && count === 1) await sleep(1_000);
    if (payload.failureMode === "worker_crash_once" && count === 1) await sleep(2_000);
    if (payload.failureMode === "invalid_media") return json(response, 422, { error: "invalid_media", message: "Sandbox rejected the supplied media revision." });
    if (payload.failureMode === "auth_expired") return json(response, 401, { error: "auth_expired", message: "Sandbox authorization expired." });
    const existing = publications.get(key);
    if (existing) return json(response, 200, existing);
    const digest = createHash("sha256").update(`${key}:${payload.revisionHash || ""}`).digest("hex").slice(0, 16);
    const accepted = { ok: true, status: "accepted", providerPublicationId: `sandbox-post-${digest}`, publicUrl: `https://sandbox.invalid/posts/${digest}`, acceptedAt: new Date().toISOString(), failureMode: String(payload.failureMode || "") };
    publications.set(key, accepted);
    return json(response, 201, accepted);
  }
  const analyticsMatch = /^\/publications\/([^/]+)\/analytics$/u.exec(url.pathname);
  if (request.method === "GET" && analyticsMatch) {
    const id = decodeURIComponent(analyticsMatch[1]);
    const publication = [...publications.values()].find((item) => item.providerPublicationId === id);
    if (!publication) return json(response, 404, { error: "publication_not_found" });
    const analyticsCount = (analyticsAttempts.get(id) || 0) + 1;
    analyticsAttempts.set(id, analyticsCount);
    if (publication.failureMode === "async_processing_failure") return json(response, 422, { error: "processing_failed", message: "Sandbox accepted the request but later processing failed." });
    if (publication.failureMode === "analytics_unavailable_once" && analyticsCount === 1) return json(response, 503, { error: "analytics_unavailable", message: "Sandbox analytics is temporarily unavailable." });
    const seed = Number.parseInt(createHash("sha256").update(id).digest("hex").slice(0, 8), 16);
    return json(response, 200, { ok: true, providerPublicationId: id, capturedAt: new Date().toISOString(), impressions: 100 + seed % 900, engagements: 10 + seed % 90, clicks: 1 + seed % 30 });
  }
  if (request.method === "POST" && url.pathname === "/authorization/refresh") {
    const payload = await body(request).catch(() => ({}));
    if (payload.failureMode === "refresh_auth_expired") return json(response, 401, { error: "auth_expired", message: "Sandbox refresh token is expired." });
    return json(response, 200, { ok: true, checkedAt: new Date().toISOString(), detail: "Sandbox authorization refreshed." });
  }
  if (request.method === "GET" && url.pathname === "/state") return json(response, 200, { ok: true, publicationCount: publications.size, attempts: Object.fromEntries(attempts), analyticsAttempts: Object.fromEntries(analyticsAttempts) });
  return json(response, 404, { error: "not_found" });
});

server.listen(port, host, () => console.log(JSON.stringify({ ok: true, provider: "phantomforce-http-sandbox", origin: `http://${host}:${port}` })));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
