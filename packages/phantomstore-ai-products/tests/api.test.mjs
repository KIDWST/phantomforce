import test from "node:test";
import assert from "node:assert/strict";
import { createPreviewServer } from "../src/server.mjs";
import { AiProductsPlatform, MemoryAdapter } from "../src/platform.mjs";
import { PRODUCTS } from "../src/catalog.mjs";

async function fixture() {
  const platform = await new AiProductsPlatform({ adapter: new MemoryAdapter(), now: () => "2026-08-17T00:00:00.000Z" }).init(); const { server } = await createPreviewServer({ platform }); await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); const address = server.address(); return { platform, server, base: `http://127.0.0.1:${address.port}` };
}
const ownerHeaders = { Authorization: "Bearer ai-demo-owner-token", "Content-Type": "application/json" };

test("versioned API exposes public truth and stable private error envelopes", async (context) => {
  const { server, base } = await fixture(); context.after(() => new Promise((resolve) => server.close(resolve)));
  const health = await fetch(`${base}/api/v1/health`); assert.equal(health.status, 200); assert.equal((await health.json()).productCount, 10);
  const catalog = await fetch(`${base}/api/v1/catalog`); assert.equal((await catalog.json()).products.length, 10);
  const denied = await fetch(`${base}/api/v1/snapshot`); assert.equal(denied.status, 401); const body = await denied.json(); assert.equal(body.error.code, "AUTH_REQUIRED"); assert.ok(body.error.requestId); assert.equal("stack" in body.error, false);
});

test("HTTP vertical slice persists domain input, calculation, review, audit, and export", async (context) => {
  const { server, base } = await fixture(); context.after(() => new Promise((resolve) => server.close(resolve))); const product = PRODUCTS[9];
  let response = await fetch(`${base}/api/v1/products/${product.id}/consent`, { method: "POST", headers: ownerHeaders, body: JSON.stringify({ status: "granted" }) }); assert.equal(response.status, 200);
  response = await fetch(`${base}/api/v1/products/${product.id}/artifacts`, { method: "POST", headers: { ...ownerHeaders, "Idempotency-Key": "http-create" }, body: JSON.stringify({ fields: product.sample, evidenceNote: "HTTP experiment evidence" }) }); assert.equal(response.status, 201); const artifact = (await response.json()).artifact;
  response = await fetch(`${base}/api/v1/artifacts/${artifact.id}/analyses`, { method: "POST", headers: { ...ownerHeaders, "Idempotency-Key": "http-analysis" }, body: "{}" }); assert.equal(response.status, 202); const analysis = (await response.json()).analysis; assert.equal(analysis.output.metrics[0].value, 7);
  response = await fetch(`${base}/api/v1/analyses/${analysis.id}/review`, { method: "POST", headers: { ...ownerHeaders, "Idempotency-Key": "http-review" }, body: JSON.stringify({ decision: "corrected", correction: "Interpret only as an observed unadjusted difference." }) }); assert.equal(response.status, 200); assert.equal((await response.json()).artifact.status, "published");
  response = await fetch(`${base}/api/v1/artifacts/${artifact.id}/export`, { headers: { Authorization: ownerHeaders.Authorization } }); assert.equal(response.status, 200); assert.match(response.headers.get("content-disposition"), /attachment/); assert.equal((await response.json()).analyses.length, 1);
  response = await fetch(`${base}/api/v1/audit`, { headers: { Authorization: ownerHeaders.Authorization } }); const audit = await response.json(); assert.ok(audit.items.some((item) => item.action === "artifact.exported")); assert.equal(JSON.stringify(audit).includes("HTTP experiment evidence"), false);
});

test("API enforces idempotency, exact deletion, tenant isolation, and route safety", async (context) => {
  const { server, base } = await fixture(); context.after(() => new Promise((resolve) => server.close(resolve))); const product = PRODUCTS[0];
  await fetch(`${base}/api/v1/products/${product.id}/consent`, { method: "POST", headers: ownerHeaders, body: JSON.stringify({ status: "granted" }) });
  const create = () => fetch(`${base}/api/v1/products/${product.id}/artifacts`, { method: "POST", headers: { ...ownerHeaders, "Idempotency-Key": "same-http-key" }, body: JSON.stringify({ fields: product.sample, evidenceNote: "Oracle API fixture" }) });
  const first = await (await create()).json(); const second = await (await create()).json(); assert.equal(second.artifact.id, first.artifact.id); assert.equal(second.idempotent, true);
  let response = await fetch(`${base}/api/v1/artifacts/${first.artifact.id}/export`, { headers: { Authorization: "Bearer ai-demo-outsider-token" } }); assert.equal(response.status, 404);
  response = await fetch(`${base}/api/v1/artifacts/${first.artifact.id}`, { method: "DELETE", headers: { ...ownerHeaders, "X-Confirm-Delete": "wrong" } }); assert.equal(response.status, 409);
  response = await fetch(`${base}/api/v1/no-such-route`, { headers: { Authorization: ownerHeaders.Authorization } }); assert.equal(response.status, 404); assert.equal((await response.json()).error.code, "ROUTE_NOT_FOUND");
  response = await fetch(`${base}/..%2Fpackage.json`); assert.equal(response.status, 404); const raw = await response.text(); assert.equal(raw.includes("@phantomforce/phantomstore-ai-products"), false);
});
