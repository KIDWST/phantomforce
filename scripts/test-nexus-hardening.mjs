import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer as createTcpServer } from "node:net";
import { request as httpRequest } from "node:http";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(path.join(root, relative), "utf8");
const index = read("app/index.html");
const mobileCss = read("app/workspace-mobile-integrity.css");
const staticServer = read("ops/admin-live/admin-static-server.mjs");
const apiServer = read("server/src/index.ts");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createTcpServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitForHealth(url, child) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Admin static server exited with ${child.exitCode}.`);
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return response;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for the admin static server.");
}

function rawRequest(port, pathname) {
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      host: "127.0.0.1",
      port,
      path: pathname,
      method: "GET",
    }, (response) => {
      response.resume();
      response.once("end", () => resolve(response));
    });
    request.once("error", reject);
    request.end();
  });
}

/* Accessibility and recovery: one real landmark target, keyboard bypass,
   live status, reduced motion, and targeted build refresh. */
assert.match(index, /<a class="pf-skip-link" href="#phantom-main">Skip to main workspace<\/a>/u);
assert.match(index, /<main class="console" id="phantom-main" data-console tabindex="-1">/u);
assert.match(index, /data-chat-log aria-live="polite"/u);
assert.match(mobileCss, /\.pf-skip-link:focus\s*\{[\s\S]*?transform:\s*translateY\(0\)/u);
assert.match(mobileCss, /@media \(prefers-reduced-motion: reduce\)/u);
assert.doesNotMatch(index, /getRegistrations\(\)[\s\S]*?unregister\(\)/u,
  "The app must not unregister every service worker on the origin.");
assert.doesNotMatch(index, /caches\.keys\(\)[\s\S]*?caches\.delete\(key\)/u,
  "The app must not destroy every cache on the origin.");
assert.match(index, /pf_build_probe/u);
assert.match(index, /location\.replace\(nextUrl\.href\)/u);

/* The shell is intentionally feature-rich, but the first request must stay
   bounded. Lazy workspace modules are not counted in this initial budget. */
const indexBytes = Buffer.byteLength(index);
assert.ok(indexBytes < 80 * 1024, `app/index.html is ${indexBytes} bytes; budget is 80 KiB.`);
const cssHrefs = [...index.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/gu)]
  .map((match) => match[1])
  .filter((href) => href.startsWith("/app/"));
assert.ok(cssHrefs.length <= 12, `Initial shell loads ${cssHrefs.length} first-party stylesheets; budget is 12.`);
const cssFiles = cssHrefs.map((href) => path.join(root, href.split("?")[0].replace(/^\//u, "")));
const cssBytes = cssFiles.reduce((total, file) => total + statSync(file).size, 0);
assert.ok(cssBytes < 1_100_000, `Initial CSS is ${cssBytes} bytes; budget is 1,100,000 bytes.`);
assert.ok(statSync(path.join(root, "app/js/main.js")).size < 260_000,
  "The initial module must remain below 260 KB; workspace code belongs in lazy imports.");
const buildIds = new Set(index.match(/phantom-live-\d{8}-\d+/gu) || []);
assert.equal(buildIds.size, 1, "app/index.html must advertise exactly one normalized build ID.");

/* Source checks protect both direct static responses and proxied API traffic. */
for (const header of ["x-content-type-options", "x-frame-options", "referrer-policy", "permissions-policy"]) {
  assert.match(staticServer, new RegExp(`"${header}"`, "u"), `Static server must set ${header}.`);
}
assert.match(staticServer, /Object\.fromEntries\(upstream\.headers\), \.\.\.securityHeaders\(\)/u,
  "Proxied responses must retain the hardened header boundary.");
assert.match(apiServer, /app\.addHook\("onSend"[\s\S]*X-Content-Type-Options[\s\S]*X-Frame-Options[\s\S]*Referrer-Policy[\s\S]*Permissions-Policy/u,
  "API responses must carry browser hardening headers.");

/* Non-destructive rollback rehearsal: prove the current committed shell is
   retrievable from Git, copy it into an isolated rehearsal, alter it, restore
   it, and verify the exact content hash. */
const committed = spawnSync("git", ["show", "HEAD:app/index.html"], {
  cwd: root,
  encoding: "utf8",
  windowsHide: true,
});
assert.equal(committed.status, 0, "The current commit must contain a rollback copy of app/index.html.");
const rehearsal = mkdtempSync(path.join(tmpdir(), "phantomforce-rollback-"));
try {
  const backup = path.join(rehearsal, "index.backup.html");
  const target = path.join(rehearsal, "index.html");
  writeFileSync(backup, committed.stdout, "utf8");
  writeFileSync(target, `${committed.stdout}\n<!-- simulated bad release -->\n`, "utf8");
  writeFileSync(target, readFileSync(backup));
  assert.equal(sha256(readFileSync(target)), sha256(committed.stdout), "Rollback rehearsal must restore exact bytes.");
} finally {
  rmSync(rehearsal, { recursive: true, force: true });
}

/* Runtime smoke: start the real admin server, test headers, and prove path
   traversal remains blocked. */
const port = await freePort();
const child = spawn(process.execPath, [
  path.join(root, "ops/admin-live/admin-static-server.mjs"),
  "--root", root,
  "--port", String(port),
  "--host", "127.0.0.1",
  "--api", "http://127.0.0.1:1",
], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
try {
  await waitForHealth(`http://127.0.0.1:${port}/health`, child);
  const response = await fetch(`http://127.0.0.1:${port}/app/index.html`, { cache: "no-store" });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "SAMEORIGIN");
  assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.match(response.headers.get("permissions-policy") || "", /camera=\(\)/u);
  const traversal = await rawRequest(port, "/../../package.json");
  assert.equal(traversal.statusCode, 403, "Raw traversal attempts must be forbidden.");
} finally {
  child.kill();
}

console.log(JSON.stringify({
  ok: true,
  accessibility: true,
  targetedRecovery: true,
  runtimeHeaders: true,
  traversalBlocked: true,
  rollbackRehearsal: true,
  budgets: { indexBytes, cssBytes, initialStylesheets: cssHrefs.length },
}));
