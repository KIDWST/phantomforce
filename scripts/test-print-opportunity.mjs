import assert from "node:assert/strict";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { PRINT_DEFAULTS, nonnegative, printEconomics, readPrintZipEntry } from "../app/js/print-opportunity-core.js";
import { createPrintOpportunityState, renderPrintOpportunities } from "../app/js/print-opportunity.js";

let checks = 0;
const check = (fn) => { fn(); checks++; };
const s = { ...PRINT_DEFAULTS, filament: 60, machine: 0, labor: 0, packaging: 0, fixedFee: 0, failure: 0 };
const e = printEconomics(100, 3600, s);
check(() => assert.equal(e.cost, 6));
check(() => assert.ok(Math.abs(e.breakEven - 6 / .9) < 1e-9));
check(() => assert.ok(Math.abs(e.marginPrice - 10) < 1e-9));
check(() => assert.ok(Math.abs(e.hourlyPrice - 16 / .9) < 1e-9));
check(() => assert.equal(printEconomics(100, 3600, { ...s, failure: .5 }).expectedHours, 2));
check(() => assert.equal(printEconomics(null, 3600, s), null));
check(() => assert.equal(printEconomics("", 3600, s), null));
check(() => assert.equal(printEconomics(100, 0, s), null));
check(() => assert.equal(nonnegative(Infinity), null));
check(() => assert.throws(() => printEconomics(100, 3600, { ...s, fee: .8, margin: .3 }), /below 100/));
check(() => assert.throws(() => printEconomics(100, 3600, { ...s, failure: 1 }), /below 100/));
check(() => assert.throws(() => renderPrintOpportunities({}, { businessId: "business-b", state: createPrintOpportunityState("business-a") }), /different business/));
globalThis.localStorage = { getItem: key => key.endsWith(":business-a") ? JSON.stringify({ ...PRINT_DEFAULTS, filament: 99 }) : null };
const stateA = createPrintOpportunityState("business-a"), stateB = createPrintOpportunityState("business-b");
renderPrintOpportunities({}, { businessId: "business-a", isActive: () => false, state: stateA });
renderPrintOpportunities({}, { businessId: "business-b", isActive: () => false, state: stateB });
check(() => assert.equal(stateA.costs.filament, 99));
check(() => assert.equal(stateB.costs.filament, PRINT_DEFAULTS.filament));

function crc32(bytes) {
  let c = -1;
  for (const b of bytes) { c ^= b; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return (c ^ -1) >>> 0;
}
function zip(members, deflate = false) {
  const local = [], central = []; let offset = 0;
  for (const [name, text] of members) {
    const n = Buffer.from(name), raw = Buffer.from(text), data = deflate ? deflateRawSync(raw) : raw;
    const h = Buffer.alloc(30), d = Buffer.alloc(46);
    h.writeUInt32LE(0x04034b50); h.writeUInt16LE(20, 4); h.writeUInt16LE(deflate ? 8 : 0, 8);
    h.writeUInt32LE(crc32(raw), 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(n.length, 26);
    d.writeUInt32LE(0x02014b50); d.writeUInt16LE(20, 4); d.writeUInt16LE(20, 6); d.writeUInt16LE(deflate ? 8 : 0, 10);
    d.writeUInt32LE(crc32(raw), 16); d.writeUInt32LE(data.length, 20); d.writeUInt32LE(raw.length, 24); d.writeUInt16LE(n.length, 28); d.writeUInt32LE(offset, 42);
    local.push(h, n, data); central.push(d, n); offset += h.length + n.length + data.length;
  }
  const c = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(members.length, 8); end.writeUInt16LE(members.length, 10); end.writeUInt32LE(c.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, c, end]);
}
const path = "Metadata/slice_info.config", text = '<config><plate><metadata key="weight" value="64.2"/></plate></config>';
const stored = zip([[path, text]]), compressed = zip([[path, text]], true);
assert.equal(await readPrintZipEntry(stored, path), text); checks++;
assert.equal(await readPrintZipEntry(compressed, path, { inflate: bytes => inflateRawSync(bytes) }), text); checks++;
assert.equal(await readPrintZipEntry(stored, "missing.config"), null); checks++;
await assert.rejects(() => readPrintZipEntry(zip([[path, text], [path, text]]), path), /ambiguous/); checks++;
const damaged = Buffer.from(stored); damaged[30 + path.length] ^= 1;
await assert.rejects(() => readPrintZipEntry(damaged, path), /integrity/); checks++;
const encrypted = Buffer.from(stored); encrypted.writeUInt16LE(1, 30 + path.length + Buffer.byteLength(text) + 8);
await assert.rejects(() => readPrintZipEntry(encrypted, path), /encrypted/); checks++;
await assert.rejects(() => readPrintZipEntry(Buffer.alloc(30), path), /ZIP directory/); checks++;
console.log(`Print opportunity: ${checks} checks passed (cost thresholds, missing values, invalid rates, stored/deflated ZIPs, duplicate members, encryption and CRC integrity).`);
