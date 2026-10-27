import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { attachDatabaseSession, type AccessSession } from "../src/access/session.js";
import { bindBusinessRequest } from "../src/business-workspaces/business-scope.js";
import { getSavedBambuConnections, getBambuConnectionSummary, saveBambuConnection, removeBambuConnection, privatePrinterAddress } from "../src/business-workspaces/bambu-connections.js";
import { attachBambuMonitor, registerBambuConnectionRoutes } from "../src/business-workspaces/bambu-connection-routes.js";

const directory = await mkdtemp(join(tmpdir(), "pf-bambu-connections-"));
const secret = "isolated-printer-connection-fixture-key-20261027";
Object.assign(process.env, { PHANTOMFORCE_PRINT_RUNS_ROOT: directory, PHANTOMFORCE_PRINTER_CREDENTIALS_SECRET: secret });
const options = { root: directory, env: { PHANTOMFORCE_PRINTER_CREDENTIALS_SECRET: secret } };
const file = join(directory, "bambu-connections.json"), tenant = "occasionally-odd";
const input = { id: "p2s", label: "Fixture P2S", model: "P2S", host: "192.168.4.20", serial: "FIXTUREP2S123", accessCode: "ABCD1234", expectedRevision: 0 };
let checks = 0;
const check = (fn: () => unknown) => { const value = fn(); if (value instanceof Promise) return value.then(() => { checks++; }); checks++; };
async function reject(fn: () => Promise<unknown>, pattern: RegExp) { await assert.rejects(fn, pattern); checks++; }
try {
  for (const host of ["10.0.0.1", "172.16.3.5", "172.31.255.1", "192.168.4.20"]) check(() => assert.equal(privatePrinterAddress(host), true));
  for (const host of ["8.8.8.8", "172.32.0.1", "127.0.0.1", "169.254.1.1", "192.168.004.2", "192.168.1.256", "localhost", "printer.local", "192.168.1.2:8883", "::1", "0.0.0.0"]) check(() => assert.equal(privatePrinterAddress(host), false));
  const initial = await getBambuConnectionSummary(tenant, options); check(() => assert.equal(initial.revision, 0)); check(() => assert.equal(initial.encryptionReady, true));
  await check(async () => assert.deepEqual(await getSavedBambuConnections(options), []));
  await reject(() => saveBambuConnection("phantomforce", input, options), /Occasionally Odd/);
  await reject(() => saveBambuConnection(tenant, input, { root: directory, env: {} }), /encryption/);
  for (const change of [{ host: "8.8.8.8" }, { serial: "invalid/path" }, { serial: "x".repeat(41) }, { accessCode: "too-long-code" }, { accessCode: "ABC!1234" }, { expectedRevision: null }, { expectedRevision: "0" }, { expectedRevision: -1 }, { expectedRevision: .5 }, { model: "P1S" }, { id: "third-printer" }, { path: "C:/private" }]) {
    await reject(() => saveBambuConnection(tenant, { ...input, ...change }, options), /Enter the printer/);
  }
  const summary = await saveBambuConnection(tenant, input, options);
  check(() => assert.equal(summary.revision, 1)); check(() => assert.equal(summary.connections.length, 1));
  const saved = await readFile(file, "utf8"), publicValue = JSON.stringify(summary);
  for (const value of [input.host, input.serial, input.accessCode]) { check(() => assert.equal(saved.includes(value), false, "Network identity/access code must be encrypted at rest")); check(() => assert.equal(publicValue.includes(value), false, "Summary must not disclose connection identity or access code")); }
  await check(async () => assert.deepEqual(await getSavedBambuConnections(options), [{ ...input, expectedRevision: undefined }].map(({ expectedRevision, ...row }) => row)));
  await reject(() => getSavedBambuConnections({ root: directory, env: { PHANTOMFORCE_PRINTER_CREDENTIALS_SECRET: "different-fixture-key-long-enough-20261027" } }), /unlocked/);
  const tampered = JSON.parse(saved); tampered.connections[0].value.tag = Buffer.alloc(16).toString("base64"); await writeFile(file, JSON.stringify(tampered));
  await reject(() => getSavedBambuConnections(options), /unlocked/); await writeFile(file, saved);
  await reject(() => saveBambuConnection(tenant, input, options), /Refresh/);
  await reject(() => saveBambuConnection(tenant, { ...input, id: "p1s", model: "P1S", expectedRevision: 1 }, options), /physical printer/);
  await saveBambuConnection(tenant, { ...input, id: "p1s", model: "P1S", label: "Fixture P1S", serial: "FIXTUREP1S123", accessCode: "1234ABCD", expectedRevision: 1 }, options);
  await check(async () => assert.equal((await getBambuConnectionSummary(tenant, options)).connections.length, 2));
  const two = await readFile(file, "utf8");
  await removeBambuConnection(tenant, "p1s", 2, options);
  await check(async () => assert.equal((await getBambuConnectionSummary(tenant, options)).connections.length, 1));
  await reject(() => removeBambuConnection(tenant, "p2s", 2, options), /Refresh/);
  const malformed = JSON.parse(two); malformed.tenantId = "phantomforce"; await writeFile(file, JSON.stringify(malformed));
  await reject(() => getBambuConnectionSummary(tenant, options), /administrator review/); await writeFile(file, saved);

  const app = Fastify({ logger: false });
  const session = (id: string, tenantId: string, role: "owner" | "member"): AccessSession => ({ id, label: id, role: "client", canManageAccess: false, userId: id, orgId: tenantId, clientId: tenantId, orgRole: role, subscriptionActive: true, memberships: [{ orgId: tenantId, orgName: "Fixture", role }] });
  const sessions = { owner: session("fixture-owner", tenant, "owner"), member: session("fixture-member", tenant, "member"), outsider: session("fixture-outsider", "client-chicagoshots", "owner"), platform: { ...session("fixture-platform", "phantomforce", "owner"), canManageAccess: true, isSuperAdmin: true } };
  app.addHook("preHandler", async request => { const value = sessions[request.headers["x-fixture-identity"] as keyof typeof sessions]; if (value) attachDatabaseSession(request, bindBusinessRequest(request, value)); });
  let reloads = 0;
  attachBambuMonitor({ async reload() { reloads++; }, status() { return { state: "configured", connected: 0, printers: [] }; } });
  registerBambuConnectionRoutes(app);
  const endpoint = "/api/business-workspaces/print-runs/printer-connections";
  async function request(method: "GET" | "POST", url: string, identity?: string, payload?: unknown, selectedTenant = tenant) { const response = await app.inject({ method, url, ...(identity ? { headers: { "x-fixture-identity": identity, "x-phantomforce-business": selectedTenant } } : {}), ...(payload === undefined ? {} : { payload }) }); checks++; return response; }
  await check(async () => assert.equal((await request("GET", endpoint)).statusCode, 401));
  for (const identity of ["member", "outsider"]) {
    await check(async () => assert.equal((await request("GET", endpoint, identity)).statusCode, 403));
    await check(async () => assert.equal((await request("POST", endpoint, identity, input)).statusCode, 403));
    await check(async () => assert.equal((await request("POST", endpoint + "/p2s/disconnect", identity, { expectedRevision: 1 })).statusCode, 403));
  }
  await check(async () => assert.equal((await request("GET", endpoint, "platform", undefined, "phantomforce")).statusCode, 403));
  await check(async () => assert.equal((await request("POST", endpoint, "owner", { ...input, tenant_id: "phantomforce" })).statusCode, 403));
  const view = await request("GET", endpoint, "owner"); check(() => assert.equal(view.statusCode, 200));
  for (const value of [input.host, input.serial, input.accessCode, "ciphertext"]) check(() => assert.equal(view.body.includes(value), false));
  await check(async () => assert.equal((await request("POST", endpoint, "owner", { ...input, expectedRevision: 1 })).statusCode, 200));
  check(() => assert.equal(reloads, 1));
  for (const value of [null, "2", {}, []]) await check(async () => assert.equal((await request("POST", endpoint + "/p2s/disconnect", "owner", { expectedRevision: value })).statusCode, 400));
  await check(async () => assert.equal((await request("POST", endpoint + "/p2s/disconnect", "owner", { expectedRevision: 2 })).statusCode, 200));
  check(() => assert.equal(reloads, 2));
  attachBambuMonitor(null); await app.close();
  console.log(`Bambu encrypted connections: ${checks} checks passed (AES at rest, identity redaction, corruption/key failure, private addresses, strict revisions, two-printer roles/scope and reload).`);
} finally { attachBambuMonitor(null); await rm(directory, { recursive: true, force: true }); }
