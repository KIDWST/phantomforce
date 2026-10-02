import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { ownerMediaScope, canReadMediaJob } from "../ops/admin-live/business-media-scope.mjs";

assert.equal(ownerMediaScope({}, {}), "phantomforce");
assert.equal(ownerMediaScope({ "x-phantomforce-business": "phantomforce-internal" }), "phantomforce-internal");
assert.throws(() => ownerMediaScope({ "x-phantomforce-business": "occasionally-odd" }), /dedicated/);
assert.throws(() => ownerMediaScope({}, { tenant_id: "client-chicagoshots" }), /dedicated/);
assert.throws(() => ownerMediaScope({ "x-phantomforce-business": "phantomforce" }, { tenant_id: "occasionally-odd" }), /dedicated/);
const job = { tenantId: "phantomforce", sessionId: "owner-test" };
assert.equal(canReadMediaJob(job, "phantomforce", "owner-test"), true);
assert.equal(canReadMediaJob(job, "client-chicagoshots", "owner-test"), false);
assert.equal(canReadMediaJob(job, "phantomforce", "other-session"), false);
assert.equal(canReadMediaJob({ sessionId: "owner-test" }, "phantomforce", "owner-test"), false);

let upstreamCalls = 0;
const api = createServer((req, res) => {
  upstreamCalls += 1;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(req.url === "/session" ? { session: { id: "owner-test", canManageAccess: true } } : { ok: true, path: req.url, scope: req.headers["x-phantomforce-business"], authenticated: req.headers.authorization === "Bearer proxy-fixture" }));
});
api.listen(0, "127.0.0.1");
await once(api, "listening");
const reserve = createServer();
reserve.listen(0, "127.0.0.1");
await once(reserve, "listening");
const port = reserve.address().port;
await new Promise((resolve) => reserve.close(resolve));
const child = spawn(process.execPath, ["ops/admin-live/admin-static-server.mjs", "--port", String(port), "--api", `http://127.0.0.1:${api.address().port}`], {
  cwd: new URL("../", import.meta.url),
  env: { ...process.env, CREATIVE_ENGINE_TRANSPORT: "disabled", HIGGSFIELD_CLI_FALLBACK_ENABLED: "false" },
  stdio: "ignore", windowsHide: true,
});
const base = `http://127.0.0.1:${port}`;
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { ready = (await fetch(base + "/health")).ok; if (ready) break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(ready, true, "Isolated static gateway starts");
  for (const business of ["client-chicagoshots", "occasionally-odd"]) {
    for (const route of ["/generate", "/generate/job/private-job", "/api/creative-engine/status"]) {
      const response = await fetch(base + route, { headers: { "x-phantomforce-business": business } });
      assert.equal(response.status, 409, `${business} cannot borrow ${route}`);
      assert.equal((await response.json()).error, "business_media_connection_required");
    }
  }
  assert.equal(upstreamCalls, 0, "Rejected business requests never contact owner services");
  const conflict = await fetch(base + "/generate", { method: "POST", headers: { Authorization: "Bearer fixture", "Content-Type": "application/json" }, body: JSON.stringify({ tenant_id: "occasionally-odd", prompt: "must never generate" }) });
  assert.equal(conflict.status, 409);
  const missing = await fetch(base + "/generate/job/unknown", { headers: { Authorization: "Bearer fixture" } });
  assert.equal(missing.status, 404);
  for (const path of ["/api/business-workspaces", "/api/business-workspaces/records", "/api/business-workspaces/commerce", "/api/business-workspaces/commerce/commands"]) {
    const response = await fetch(base + path, { method: path.endsWith("commands") ? "POST" : "GET", headers: { Authorization: "Bearer proxy-fixture", "x-phantomforce-business": "occasionally-odd", "Content-Type": "application/json" }, ...(path.endsWith("commands") ? { body: JSON.stringify({ type: "fixture" }) } : {}) });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, path, scope: "occasionally-odd", authenticated: true });
  }
  console.log(JSON.stringify({ suite: "business-media-boundary", passed: 27, providersCalled: 0 }));
} finally {
  child.kill();
  await new Promise((resolve) => api.close(resolve));
}
