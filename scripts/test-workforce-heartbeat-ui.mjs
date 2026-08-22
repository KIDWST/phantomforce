import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const index = read("../app/index.html");
const main = read("../app/js/main.js");
const css = read("../app/command-os.css");
const server = read("../server/src/index.ts");
const graph = read("../server/src/workforce/work-graph.ts");
const proxy = read("../ops/admin-live/admin-static-server.mjs");

assert.match(index, /data-workforce-heartbeat/u, "The owner Command Center must mount the workforce heartbeat.");
assert.match(main, /\/api\/workforce\/heartbeat/u, "The heartbeat must read authoritative server work.");
for (const label of ["YOUR PHANTOM WORKFORCE", "What Needs Me", "Review", "Phantom executes", "Verified complete", "Nothing slips"]) {
  assert.ok(main.includes(label), `The heartbeat must expose the ${label} lifecycle state.`);
}
assert.match(main, /Approve all safe/u, "The owner must be able to approve all safe internal work at once.");
assert.match(main, /Approve &amp; run/u, "Individual approval must be a clear execution action.");
assert.match(main, /BLOCKED — EXACT REASON/u, "Blocked work must explain the exact reason.");
assert.match(main, /Nothing was marked complete/u, "Client failures must never become optimistic completion.");
assert.match(main, /receipt \$\{esc\(action\.receipt\?\.id/u, "Verified work must surface a durable receipt identifier.");

for (const route of [
  'app.get("/api/workforce/heartbeat"',
  'app.get("/api/workforce/actions/:actionId"',
  'app.post("/api/workforce/actions"',
  'app.post("/api/workforce/actions/:actionId/decision"',
  'app.post("/api/workforce/actions/decide-all-safe"',
  'app.post("/phantom-ai/decisions/decide-all"',
]) {
  assert.ok(server.includes(route), `${route} must remain server backed.`);
}
assert.match(proxy, /urlPath\.startsWith\("\/api\/workforce"\)/u, "The live admin proxy must forward workforce requests.");

assert.match(graph, /idempotencyKey === idempotencyKey/u, "Work proposals must replay idempotently.");
assert.match(graph, /if \(!verified\) throw new Error/u, "Internal execution must read its result back before completion.");
assert.match(graph, /const prevHash = document\.audit\.at\(-1\)\?\.hash \?\? null[\s\S]*hash: createHash\("sha256"\)/u, "Work audit evidence must remain hash chained.");
assert.match(graph, /safeTenantId\(tenantId\)/u, "Work storage must be pinned to a sanitized tenant identifier.");
assert.match(graph, /No verified email delivery connector is active for this organization/u, "Email send must fail truthfully when its connector is unavailable.");
assert.match(graph, /Connect and verify Gmail or Outlook/u, "Blocked email sends must include actionable remediation.");
assert.match(graph, /status === "awaiting_approval" && action\.policy\.surface === "internal"/u, "Bulk approval must exclude external actions.");

assert.match(css, /\.workforce-heartbeat \{[\s\S]*rgba\(93, 255, 179/u, "The heartbeat must use the Phantom green and black visual system.");
assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.workforce-heartbeat-body \{ grid-template-columns: 1fr; \}/u, "The heartbeat must intentionally collapse on smaller screens.");
assert.doesNotMatch(css.match(/\.workforce-heartbeat \{[\s\S]*?@media \(max-width: 560px\)/u)?.[0] || "", /#[a-f0-9]{0,2}(?:7c3aed|8b5cf6|6366f1)|purple|violet/iu, "The heartbeat cannot introduce purple or blue brand drift.");

console.log(JSON.stringify({
  ok: true,
  suite: "phantomforce-workforce-heartbeat-ui",
  lifecycleStates: 4,
  serverRoutes: 6,
  truthfulExternalBlocking: true,
  tenantIsolationContract: true,
  responsive: true,
}, null, 2));
