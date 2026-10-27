import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const directory = await mkdtemp(join(tmpdir(), "pf-bambu-collector-"));
Object.assign(process.env, { PHANTOMFORCE_PRINT_RUNS_ROOT: join(directory, "journal"), PHANTOMFORCE_BUSINESS_COMMERCE_DIR: join(directory, "commerce") });
const { hasBambuGcode, startBambuCollector } = await import("../src/business-workspaces/bambu-collector.js");
const { getPrintRuns, updatePrintSettings } = await import("../src/business-workspaces/print-runs.js");
function crc32(bytes: Buffer) { let crc = -1; for (const byte of bytes) { crc ^= byte; for (let index = 0; index < 8; index++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ -1) >>> 0; }
function zip(members: [string, string][]) {
  const local: Buffer[] = [], central: Buffer[] = []; let offset = 0;
  for (const [name, text] of members) {
    const label = Buffer.from(name), data = Buffer.from(text), header = Buffer.alloc(30), entry = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt32LE(crc32(data), 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(label.length, 26);
    entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt32LE(crc32(data), 16); entry.writeUInt32LE(data.length, 20); entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(label.length, 28); entry.writeUInt32LE(offset, 42);
    local.push(header, label, data); central.push(entry, label); offset += header.length + label.length + data.length;
  }
  const entries = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(members.length, 8); end.writeUInt16LE(members.length, 10); end.writeUInt32LE(entries.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, entries, end]);
}
const metadata: [string, string] = ["Metadata/slice_info.config", '<config><plate><metadata key="weight" value="37.77"/><metadata key="prediction" value="13305"/><filament id="1" type="PLA" color="#FFFFFF" used_g="37.77" used_m="12.46"/></plate></config>'];
const bytes = zip([metadata, ["Metadata/plate_1.gcode", "; synthetic test only; never executed\n"]]);
assert.equal(hasBambuGcode(bytes), true); assert.equal(hasBambuGcode(zip([metadata])), false); assert.equal(hasBambuGcode(Buffer.alloc(30)), false);
const source = join(directory, "bamboo_model"), parent = join(source, "Day", "Job", "Metadata"), file = join(parent, ".123.0.3mf");
await mkdir(parent, { recursive: true });
await writeFile(join(source, "recovery.3mf"), bytes);
await writeFile(join(parent, ".333.0.3mf"), zip([metadata]));
await writeFile(file, bytes.subarray(0, 40));
const collector = await startBambuCollector({ roots: [source], enabled: true, settleMs: 10, intervalMs: 100000 });
const settle = async () => { await collector.scanNow(); await delay(25); await collector.scanNow(); };
try {
  await settle(); assert.equal((await getPrintRuns()).runs.length, 0, "Incomplete ZIP must wait");
  await writeFile(file, bytes); await settle();
  let state = await getPrintRuns();
  assert.equal(state.runs.length, 1); assert.equal(state.files.length, 1); assert.equal(state.runs[0].evidence, "prepared");
  assert.equal(state.files[0].metadata.plates[0].grams, 37.77); assert.equal(state.files[0].metadata.plates[0].seconds, 13305);
  assert.equal(state.summary.completed, 0); assert.equal(state.collector.state, "watching");
  assert.equal(JSON.stringify(state).includes(directory), false, "API must not disclose local paths");
  await settle(); assert.equal((await getPrintRuns()).runs.length, 1, "Same observation is idempotent");
  await updatePrintSettings("occasionally-odd", { paused: true });
  await writeFile(join(parent, ".124.0.3mf"), bytes); await settle();
  assert.equal((await getPrintRuns()).runs.length, 1, "Paused collector must not import");
  await updatePrintSettings("occasionally-odd", { paused: false }); await settle();
  assert.equal((await getPrintRuns()).runs.length, 2, "New occurrence of identical model remains distinct");
  assert.equal((await getPrintRuns()).files.length, 1, "Archive dedup is independent of runs");
  const future = new Date(Date.now() + 2000); await utimes(file, future, future); await settle();
  assert.equal((await getPrintRuns()).runs.length, 3, "Recreated send at same path is a new observation");
} finally { await collector.stop(); }
const restart = await startBambuCollector({ roots: [source], enabled: true, settleMs: 10, intervalMs: 100000 });
await delay(25); await restart.scanNow(); await restart.stop();
assert.equal((await getPrintRuns()).runs.length, 3, "Restart must not duplicate receipts");
const disabled = await startBambuCollector({ roots: [source], enabled: false }); await disabled.scanNow(); await disabled.stop();
assert.equal((await getPrintRuns()).runs.length, 3);
const absent = await startBambuCollector({ roots: [join(directory, "missing")], enabled: true });
assert.equal((await getPrintRuns()).collector.state, "missing-source"); await absent.stop();
// A large old directory must not keep a new package forever behind the 500-file pass cap.
const crowded = join(directory, "crowded", "Metadata"); await mkdir(crowded, { recursive: true });
await Promise.all(Array.from({ length: 505 }, (_, index) => writeFile(join(crowded, `.${1000 + index}.0.3mf`), Buffer.alloc(22))));
await writeFile(join(crowded, ".9999.0.3mf"), bytes);
const rotating = await startBambuCollector({ roots: [join(directory, "crowded")], enabled: true, settleMs: 10, intervalMs: 100000 });
try { for (let index = 0; index < 7; index++) { await delay(25); await rotating.scanNow(); } assert.equal((await getPrintRuns()).summary.receipts, 4, "Bounded scan rotation must reach a new package after old unsupported files"); }
finally { await rotating.stop(); }
console.log("Bambu collector passed: partial ZIP retry, source classification, automatic capture, saved stats, repeat occurrence/archive dedup, pause/resume, same-path changes, restart idempotence, disabled/missing source, rotating bounded scans and privacy.");
