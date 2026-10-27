import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import Fastify from "fastify";
import { attachDatabaseSession, type AccessSession } from "../src/access/session.js";
import { bindBusinessRequest } from "../src/business-workspaces/business-scope.js";
import { inspectPrintBuffer } from "../src/business-workspaces/print-parser.js";
import { registerPrintRunRoutes } from "../src/business-workspaces/print-run-routes.js";
import { getPrintRunArchive, getPrintRuns, getPrintRunSettings, importPrintRun, updatePrintModel, updatePrintSettings } from "../src/business-workspaces/print-runs.js";

const root = await mkdtemp(join(tmpdir(), "pf-print-runs-"));
process.env.PHANTOMFORCE_PRINT_RUNS_ROOT = join(root, "prints");
process.env.PHANTOMFORCE_BUSINESS_COMMERCE_DIR = join(root, "commerce");
let checks = 0;
const check = (fn: () => unknown) => { const result = fn(); if (result instanceof Promise) return result.then(() => { checks++; }); checks++; };
async function rejects(fn: () => Promise<unknown>, pattern: RegExp) { await assert.rejects(fn, pattern); checks++; }
function crc32(bytes: Buffer) { let crc = -1; for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ -1) >>> 0; }
function zip(members: Array<[string, string]>, deflate = true) {
  const local: Buffer[] = [], central: Buffer[] = []; let offset = 0;
  for (const [name, text] of members) {
    const n = Buffer.from(name), raw = Buffer.from(text), data = deflate ? deflateRawSync(raw) : raw, h = Buffer.alloc(30), d = Buffer.alloc(46);
    h.writeUInt32LE(0x04034b50); h.writeUInt16LE(20, 4); h.writeUInt16LE(deflate ? 8 : 0, 8); h.writeUInt32LE(crc32(raw), 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(n.length, 26);
    d.writeUInt32LE(0x02014b50); d.writeUInt16LE(20, 4); d.writeUInt16LE(20, 6); d.writeUInt16LE(deflate ? 8 : 0, 10); d.writeUInt32LE(crc32(raw), 16); d.writeUInt32LE(data.length, 20); d.writeUInt32LE(raw.length, 24); d.writeUInt16LE(n.length, 28); d.writeUInt32LE(offset, 42);
    local.push(h, n, data); central.push(d, n); offset += h.length + n.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(members.length, 8); end.writeUInt16LE(members.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
const slice = (grams = 100, seconds = 3600) => `<config><plate><metadata key="index" value="1"/><metadata key="weight" value="${grams}"/><metadata key="prediction" value="${seconds}"/><object id="1"/><object id="2" skipped="true"/><filament id="1" type="PLA" color="#ffffff" used_g="${grams}" used_m="33"/></plate></config>`;
const payload = zip([["Metadata/slice_info.config", slice()], ["Metadata/plate_1.gcode", "GCODE IS NEVER EXECUTED"]]);
const companion = zip([["Metadata/project_settings.config", JSON.stringify({ printer_model: "Bambu Lab P2S", filament_type: ["PLA"], filament_colour: ["#ffffff"], filament_settings_id: ["Fixture PLA"], filament_vendor: ["Fixture"], cloud_token: "MUST_NOT_APPEAR", arbitrary_private_setting: "MUST_NOT_APPEAR" })]]);
const filePath = join(root, "fixture.3mf"), configPath = join(root, "fixture_config.3mf");
await writeFile(filePath, payload); await writeFile(configPath, companion);
try {
  const parsed = await inspectPrintBuffer(payload, "fixture.3mf", companion);
  check(() => assert.equal(parsed.plates[0].grams, 100));
  check(() => assert.equal(parsed.plates[0].seconds, 3600));
  check(() => assert.equal(parsed.plates[0].objectCount, 1));
  check(() => assert.equal(parsed.plates[0].filaments[0].profile, "Fixture PLA"));
  check(() => assert.equal(parsed.printer, "Bambu Lab P2S"));
  check(() => assert.equal(parsed.hasGcode, true));
  check(() => assert.ok(!JSON.stringify(parsed).includes("MUST_NOT_APPEAR")));
  const titleFile = (xml: string, member = "3D/3dmodel.model") => zip([["Metadata/slice_info.config", slice()], [member, xml]]);
  await check(async () => assert.equal((await inspectPrintBuffer(titleFile('<model><metadata name="Title">Minecraft lamp &amp; stand</metadata></model>'), "title.3mf")).projectTitle, "Minecraft lamp & stand"));
  await check(async () => assert.equal((await inspectPrintBuffer(titleFile('<config><plate><metadata key="plater_name" value="Desk planter"/></plate></config>', "Metadata/model_settings.config"), "title.3mf")).projectTitle, "Desk planter"));
  await check(async () => assert.equal((await inspectPrintBuffer(titleFile('<config><object><metadata key="name" value="Original tray"/></object></config>', "Metadata/model_settings.config"), "title.3mf")).projectTitle, "Original tray"));
  await check(async () => assert.equal((await inspectPrintBuffer(titleFile('<!DOCTYPE model [<!ENTITY x "SECRET">]><model><metadata name="Title">&x;</metadata></model>'), "title.3mf")).projectTitle, undefined));
  await check(async () => assert.equal((await inspectPrintBuffer(titleFile("x".repeat(1024 * 1024 + 1)), "title.3mf")).plates[0].grams, 100));
  await rejects(() => inspectPrintBuffer(zip([["Metadata/slice_info.config", '<!DOCTYPE x [<!ENTITY a "xx">]><config/>']]), "bad.3mf"), /entity/);
  await rejects(() => inspectPrintBuffer(zip([["Metadata/slice_info.config", "<config><plate></config>"]]), "bad.3mf"), /XML/);
  await rejects(() => inspectPrintBuffer(zip([["Metadata/slice_info.config", slice()], ["Metadata/slice_info.config", slice()]]), "bad.3mf"), /ambiguous/);
  await rejects(() => inspectPrintBuffer(zip([["Metadata/slice_info.config", "x".repeat(1024 * 1024 + 1)]]), "bomb.3mf"), /too large/);
  const damaged = Buffer.from(payload); damaged[30 + "Metadata/slice_info.config".length] ^= 4;
  await rejects(() => inspectPrintBuffer(damaged, "bad.3mf"), /integrity|invalid|distance|block|unexpected/);
  const first = await importPrintRun({ filePath, companionConfigPath: configPath, sourceEventId: "fixture-send-001", observedAt: "2026-10-26T20:00:00Z", evidence: "prepared" });
  const duplicate = await importPrintRun({ filePath, companionConfigPath: configPath, sourceEventId: "fixture-send-001", observedAt: "2026-10-26T20:00:00Z", evidence: "prepared" });
  check(() => assert.equal(duplicate.duplicate, true));
  check(() => assert.equal(duplicate.run.id, first.run.id));
  let state = await getPrintRuns();
  check(() => assert.equal(state.revision, 1));
  check(() => assert.equal(state.summary.receipts, 1));
  check(() => assert.equal(state.summary.completed, 0));
  check(() => assert.equal(state.summary.knownOutcomeFailureRate, null));
  check(() => assert.equal(state.files[0].analysis.moneyBasis, "illustrative-scenario"));
  check(() => assert.equal(state.files[0].analysis.perUnit, null));
  check(() => assert.equal(state.files[0].analysis.market.status, "unavailable"));
  const repeated = await importPrintRun({ filePath, sourceEventId: "fixture-send-002", observedAt: "2026-10-26T21:00:00Z", evidence: "prepared" });
  state = await getPrintRuns();
  check(() => assert.notEqual(repeated.run.id, first.run.id));
  check(() => assert.equal(state.summary.receipts, 2));
  check(() => assert.equal(state.summary.uniqueFiles, 1));
  check(() => assert.equal((state.files[0].metadata.plates[0].filaments[0]).profile, "Fixture PLA"));
  check(() => assert.equal(state.files[0].sha256, first.file.sha256));
  check(() => assert.equal((JSON.stringify(state).match(/MUST_NOT_APPEAR/g) || []).length, 0));
  await check(async () => assert.equal((await readdir(join(root, "prints", "archives"))).length, 1));
  await importPrintRun({ filePath, sourceEventId: "fixture-send-001", observedAt: "2026-10-26T22:00:00Z", evidence: "completed" });
  await importPrintRun({ filePath, sourceEventId: "fixture-send-001", observedAt: "2026-10-26T20:30:00Z", evidence: "prepared" });
  state = await getPrintRuns();
  check(() => assert.equal(state.runs.find(run => run.id === first.run.id)?.evidence, "completed"));
  check(() => assert.equal(state.summary.completed, 1));
  const archive = await getPrintRunArchive("occasionally-odd", first.run.id);
  check(() => assert.deepEqual(archive.bytes, payload));
  await rejects(() => getPrintRuns("phantomforce"), /Occasionally Odd/);
  await rejects(() => getPrintRunArchive("client-chicagoshots", first.run.id), /Occasionally Odd/);
  await rejects(() => getPrintRunArchive("occasionally-odd", "../file"), /not found/);
  await rejects(async () => updatePrintSettings("occasionally-odd", { costs: { ...(await getPrintRunSettings()).costs, fee: .9, margin: .3 } }), /settings/);
  await rejects(() => updatePrintSettings("occasionally-odd", { paused: true, arbitraryPath: "C:/private" }), /settings/);
  await updatePrintSettings("occasionally-odd", { paused: true, costsConfirmed: true, costs: { ...(await getPrintRunSettings()).costs, filament: 20, machine: 1, labor: 0, minutes: 0, packaging: 1, fixedFee: 0, failure: 0, fee: 0, margin: .5, hourly: 10 } });
  await check(async () => assert.equal((await getPrintRunSettings()).paused, true));
  await updatePrintModel("occasionally-odd", first.file.sha256, { name: "Fixture original", saleableUnits: 2, completeProduct: true, extraCostPerBatch: 6, rightsStatus: "original", comparables: [
    { url: "https://example.com/asking", observedAt: "2026-10-26T20:00:00Z", currency: "USD", price: 20, shipping: 0, quantity: 2, kind: "asking", comparable: true },
    { url: "https://example.com/sold", observedAt: "2026-10-26T20:00:00Z", currency: "USD", price: 12, shipping: 2, quantity: 1, kind: "sold", comparable: true },
    { url: "https://example.com/unknown-shipping", observedAt: "2026-10-26T20:00:00Z", currency: "USD", price: 99, shipping: null, quantity: 1, kind: "asking", comparable: true },
  ] });
  state = await getPrintRuns();
  check(() => assert.equal(state.collector.state, "paused"));
  check(() => assert.equal(state.files[0].analysis.totals.cost, 10));
  check(() => assert.equal(state.files[0].analysis.perUnit?.cost, 5));
  check(() => assert.equal(state.files[0].analysis.totals.marginPrice, 20));
  check(() => assert.equal(state.files[0].analysis.market.asking?.low, 10));
  check(() => assert.equal(state.files[0].analysis.market.sold?.low, 14));
  check(() => assert.equal(state.files[0].analysis.market.asking?.limited, true));
  check(() => assert.equal(state.files[0].analysis.market.count, 2));
  const multiPath = join(root, "multi.3mf"), multiSlice = slice().replace("</config>", slice().replace("<config>", ""));
  await writeFile(multiPath, zip([["Metadata/slice_info.config", multiSlice]]));
  const multi = await importPrintRun({ filePath: multiPath, sourceEventId: "fixture-multi", observedAt: "2026-10-26T23:00:00Z", evidence: "prepared" });
  await check(async () => assert.equal((await getPrintRuns()).files.find(file => file.sha256 === multi.file.sha256)?.analysis.totals.cost, 7, "Two plates cost material4 + machine2 + packaging1, not packaging twice."));

  // Real route handlers against a synthetic trusted auth boundary; no production data or provider.
  const app = Fastify();
  const session = (id: string, tenantId: string, role: "owner" | "member"): AccessSession => ({ id, label: id, role: "client", canManageAccess: false, orgId: tenantId, clientId: tenantId, memberships: [{ orgId: tenantId, orgName: "Fixture", role }] });
  const sessions = { owner: session("fixture-owner", "occasionally-odd", "owner"), member: session("fixture-member", "occasionally-odd", "member"), outsider: session("fixture-outsider", "client-chicagoshots", "owner"), platform: { ...session("fixture-platform", "phantomforce", "owner"), canManageAccess: true, isSuperAdmin: true } };
  app.addHook("preHandler", async request => { const selected = sessions[request.headers["x-fixture-identity"] as keyof typeof sessions]; if (selected) attachDatabaseSession(request, bindBusinessRequest(request, selected)); });
  registerPrintRunRoutes(app);
  const endpoint = "/api/business-workspaces/print-runs", headers = (identity: string, tenant = "occasionally-odd") => ({ "x-fixture-identity": identity, "x-phantomforce-business": tenant });
  const request = async (method: "GET" | "POST", url: string, identity?: string, payload?: unknown, tenant?: string) => { const response = await app.inject({ method, url, headers: identity ? headers(identity, tenant) : {}, ...(payload === undefined ? {} : { payload }) }); checks++; return response; };
  await check(async () => assert.equal((await request("GET", endpoint)).statusCode, 401));
  await check(async () => assert.equal((await request("GET", endpoint, "outsider")).statusCode, 403));
  await check(async () => assert.equal((await request("GET", endpoint, "platform", undefined, "phantomforce")).statusCode, 403));
  await check(async () => assert.equal((await request("GET", endpoint + "?tenant_id=phantomforce", "owner")).statusCode, 403));
  await check(async () => assert.equal((await request("POST", endpoint + "/settings", "member", { paused: false })).statusCode, 403));
  await check(async () => assert.equal((await request("GET", endpoint + "/" + first.run.id + "/file", "member")).statusCode, 403));
  const view = await request("GET", endpoint, "member"); check(() => assert.equal(view.statusCode, 200)); check(() => assert.equal(view.json().canManage, false));
  const download = await request("GET", endpoint + "/" + first.run.id + "/file", "owner"); check(() => assert.equal(download.statusCode, 200)); check(() => assert.equal(download.headers["cache-control"], "private, no-store"));
  check(() => assert.deepEqual(download.rawPayload, payload));
  await check(async () => assert.equal((await request("POST", endpoint + "/settings", "owner", { paused: false })).statusCode, 200));
  await check(async () => assert.equal((await request("POST", endpoint + "/models/" + first.file.sha256, "member", {})).statusCode, 403));
  await app.close();
  await writeFile(join(root, "prints", "archives", first.file.sha256 + ".3mf"), zip([["changed", "tampered"]]));
  await rejects(() => getPrintRunArchive("occasionally-odd", first.run.id), /integrity/);
  const saved = await readFile(join(root, "prints", "occasionally-odd.json"), "utf8");
  await writeFile(join(root, "prints", "occasionally-odd.json"), saved.replace('"tenantId": "occasionally-odd"', '"tenantId": "phantomforce"'));
  await rejects(() => getPrintRuns(), /administrator review/);
  await check(async () => assert.ok((await readFile(join(root, "prints", "occasionally-odd.json"), "utf8")).includes('"tenantId": "phantomforce"'), "Invalid data was not silently reset."));
  console.log(`Print run journal: ${checks} checks passed (bounded shared parser, idempotent receipts, archive integrity, economics, evidence, scope and role guards).`);
} finally { await rm(root, { recursive: true, force: true }); }
