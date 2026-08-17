import test from "node:test";
import assert from "node:assert/strict";
import { createPreviewServer } from "../src/server.mjs";
import { AiProductsPlatform, MemoryAdapter } from "../src/platform.mjs";
import { PRODUCTS } from "../src/catalog.mjs";

async function fixture() {
  const platform = await new AiProductsPlatform({ adapter: new MemoryAdapter(), now: () => "2026-08-17T01:35:00.000Z" }).init(); const { server } = await createPreviewServer({ platform }); await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); const address = server.address(); return { platform, server, base: `http://127.0.0.1:${address.port}` };
}
const owner = { Authorization: "Bearer ai-demo-owner-token", "Content-Type": "application/json" };
const reviewer = { Authorization: "Bearer ai-demo-reviewer-token", "Content-Type": "application/json" };

test("CSP, safe headers, traversal defense, body limit, and error envelopes fail safely", async (context) => {
  const { server, base } = await fixture(); context.after(() => new Promise((resolve) => server.close(resolve)));
  let response = await fetch(`${base}/`); assert.equal(response.status, 200); assert.match(response.headers.get("content-security-policy"), /default-src 'self'/); assert.equal(response.headers.get("x-frame-options"), "DENY"); assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  response = await fetch(`${base}/..%2Fpackage.json`); assert.equal(response.status, 404); assert.equal((await response.text()).includes("@phantomforce/phantomstore-ai-products"), false);
  const oversized = JSON.stringify({ status: "granted", marker: "PRIVATE_OVERSIZE_MARKER", padding: "x".repeat(1_000_100) }); response = await fetch(`${base}/api/v1/products/phantom-oracle/consent`, { method: "POST", headers: owner, body: oversized }); assert.equal(response.status, 413); const error = await response.json(); assert.equal(error.error.code, "PAYLOAD_TOO_LARGE"); assert.equal("stack" in error.error, false); assert.equal(JSON.stringify(error).includes("PRIVATE_OVERSIZE_MARKER"), false);
});

test("HTTP authorization, entitlement/provider switches, concurrency, and idempotency fail closed", async (context) => {
  const { platform, server, base } = await fixture(); context.after(() => new Promise((resolve) => server.close(resolve))); const item = PRODUCTS[0];
  let response = await fetch(`${base}/api/v1/products/${item.id}/consent`, { method: "POST", headers: reviewer, body: JSON.stringify({ status: "granted" }) }); assert.equal(response.status, 403); assert.equal((await response.json()).error.code, "ROLE_FORBIDDEN");
  await fetch(`${base}/api/v1/products/${item.id}/consent`, { method: "POST", headers: owner, body: JSON.stringify({ status: "granted" }) }); const createRequest = (note) => fetch(`${base}/api/v1/products/${item.id}/artifacts`, { method: "POST", headers: { ...owner, "Idempotency-Key": "http-m2-collision" }, body: JSON.stringify({ fields: item.sample, evidenceNote: note }) }); const created = await (await createRequest("first body")).json(); response = await createRequest("different body"); assert.equal(response.status, 409); assert.equal((await response.json()).error.code, "IDEMPOTENCY_COLLISION");
  response = await fetch(`${base}/api/v1/artifacts/${created.artifact.id}`, { method: "PATCH", headers: { ...owner, "Idempotency-Key": "http-update-1" }, body: JSON.stringify({ expectedRevision: 1, fields: { decision: "Updated decision" } }) }); assert.equal(response.status, 200); response = await fetch(`${base}/api/v1/artifacts/${created.artifact.id}`, { method: "PATCH", headers: { ...owner, "Idempotency-Key": "http-update-stale" }, body: JSON.stringify({ expectedRevision: 1, fields: { decision: "Stale edit" } }) }); assert.equal(response.status, 409); assert.equal((await response.json()).error.code, "REVISION_CONFLICT");
  platform.document.workspaces["ai-demo-workspace"].flags[item.id].analysisEnabled = false; response = await fetch(`${base}/api/v1/artifacts/${created.artifact.id}/analyses`, { method: "POST", headers: { ...owner, "Idempotency-Key": "paused-analysis" }, body: "{}" }); assert.equal(response.status, 503); assert.equal((await response.json()).error.code, "ANALYSIS_PAUSED");
  platform.document.workspaces["ai-demo-workspace"].flags[item.id].analysisEnabled = true; platform.document.workspaces["ai-demo-workspace"].entitlements[item.id].status = "expired"; response = await fetch(`${base}/api/v1/artifacts/${created.artifact.id}/export`, { headers: owner }); assert.equal(response.status, 403); assert.equal((await response.json()).error.code, "ENTITLEMENT_REQUIRED");
});

test("foreign known IDs and random IDs produce the same non-enumerating response", async (context) => {
  const { server, base } = await fixture(); context.after(() => new Promise((resolve) => server.close(resolve))); const item = PRODUCTS[0]; await fetch(`${base}/api/v1/products/${item.id}/consent`, { method: "POST", headers: owner, body: JSON.stringify({ status: "granted" }) }); const created = await (await fetch(`${base}/api/v1/products/${item.id}/artifacts`, { method: "POST", headers: { ...owner, "Idempotency-Key": "foreign-create" }, body: JSON.stringify({ fields: item.sample, evidenceNote: "private known object" }) })).json();
  const outsideHeaders = { Authorization: "Bearer ai-demo-outsider-token" }; const known = await fetch(`${base}/api/v1/artifacts/${created.artifact.id}/export`, { headers: outsideHeaders }); const random = await fetch(`${base}/api/v1/artifacts/not-a-real-id/export`, { headers: outsideHeaders }); const knownBody = await known.json(); const randomBody = await random.json(); assert.equal(known.status, 404); assert.equal(random.status, 404); assert.equal(knownBody.error.code, randomBody.error.code); assert.equal(knownBody.error.message, randomBody.error.message); assert.equal(JSON.stringify(knownBody).includes("private known object"), false);
});
