// Pure costing and bounded ZIP metadata reads; no network, filesystem or printer access.
export const PRINT_LIMITS = Object.freeze({ fileBytes: 128 * 1024 * 1024, metadataBytes: 1024 * 1024, entries: 10000, files: 20 });
export const PRINT_DEFAULTS = Object.freeze({ filament: 25, machine: 1, labor: 20, minutes: 10, packaging: 1, fixedFee: .3, failure: .1, fee: .1, margin: .3, hourly: 10, revenue: 25 });

export function nonnegative(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function validatePrintCosts(s) {
  for (const key of Object.keys(PRINT_DEFAULTS)) if (nonnegative(s[key]) === null) throw new Error("Enter a valid, nonnegative value for every cost.");
  if (Number(s.failure) >= 1) throw new Error("Failure rate must be below 100%.");
  if (Number(s.fee) + Number(s.margin) >= 1) throw new Error("Sales fees plus target margin must be below 100%.");
}

export function printEconomics(grams, seconds, costs) {
  validatePrintCosts(costs);
  const g = nonnegative(grams), sec = nonnegative(seconds);
  if (g === null || sec === null || sec === 0) return null;
  const s = Object.fromEntries(Object.entries(costs).map(([k, v]) => [k, Number(v)]));
  const hours = sec / 3600, expectedHours = hours / (1 - s.failure);
  const cost = (g / 1000 * s.filament + hours * s.machine) / (1 - s.failure) + s.minutes / 60 * s.labor + s.packaging + s.fixedFee;
  return { cost, expectedHours, breakEven: cost / (1 - s.fee), marginPrice: cost / (1 - s.fee - s.margin), hourlyPrice: (cost + s.hourly * expectedHours) / (1 - s.fee), contributionPerHour: (s.revenue * (1 - s.fee) - cost) / expectedHours };
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const value of bytes) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Selected entry only. ZIP64, encryption, split archives and ambiguous members fail closed. */
export async function readPrintZipEntry(buffer, wanted, { inflate } = {}) {
  const bytes = new Uint8Array(buffer), v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length > PRINT_LIMITS.fileBytes || bytes.length < 22) throw new Error("Choose a valid 3MF file under 128 MB.");
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50 && i + 22 + v.getUint16(i + 20, true) === bytes.length) { end = i; break; }
  }
  if (end < 0) throw new Error("This file has no readable ZIP directory.");
  const entries = v.getUint16(end + 10, true), size = v.getUint32(end + 12, true), start = v.getUint32(end + 16, true);
  if (v.getUint16(end + 4, true) || v.getUint16(end + 6, true) || v.getUint16(end + 8, true) !== entries || entries === 65535 || entries > PRINT_LIMITS.entries || start + size > end) throw new Error("Split, oversized or ZIP64 archives are not supported. Save a standard 3MF in your slicer.");
  let offset = start, match = null;
  for (let i = 0; i < entries; i++) {
    if (offset + 46 > start + size || v.getUint32(offset, true) !== 0x02014b50) throw new Error("The archive directory is incomplete.");
    const nameLen = v.getUint16(offset + 28, true), extra = v.getUint16(offset + 30, true), comment = v.getUint16(offset + 32, true);
    const next = offset + 46 + nameLen + extra + comment;
    if (next > start + size) throw new Error("The archive directory contains an invalid entry.");
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLen));
    if (name.toLowerCase() === wanted.toLowerCase()) {
      if (match) throw new Error("The archive has ambiguous duplicate metadata entries.");
      match = { flags: v.getUint16(offset + 8, true), method: v.getUint16(offset + 10, true), crc: v.getUint32(offset + 16, true), compressed: v.getUint32(offset + 20, true), length: v.getUint32(offset + 24, true), local: v.getUint32(offset + 42, true), name };
    }
    offset = next;
  }
  if (!match) return null;
  const m = match;
  if ((m.flags & 1) || m.length > PRINT_LIMITS.metadataBytes || m.compressed > PRINT_LIMITS.metadataBytes || m.local + 30 > start) throw new Error("Metadata is encrypted, too large, or invalid.");
  if (v.getUint32(m.local, true) !== 0x04034b50 || v.getUint16(m.local + 8, true) !== m.method) throw new Error("Metadata header does not match its directory.");
  const nameLen = v.getUint16(m.local + 26, true), extra = v.getUint16(m.local + 28, true), data = m.local + 30 + nameLen + extra;
  if (data + m.compressed > start || new TextDecoder().decode(bytes.subarray(m.local + 30, m.local + 30 + nameLen)) !== m.name) throw new Error("Metadata points outside the archive data.");
  const packed = bytes.subarray(data, data + m.compressed);
  let raw;
  if (m.method === 0) raw = packed;
  else if (m.method === 8 && inflate) raw = await inflate(packed);
  else if (m.method === 8 && typeof DecompressionStream !== "undefined") {
    let stream;
    try { stream = new Blob([packed]).stream().pipeThrough(new DecompressionStream("deflate-raw")); }
    catch { throw new Error("This browser cannot read compressed 3MF metadata. Use a current Chrome or Edge browser."); }
    const reader = stream.getReader(), chunks = []; let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        total += value.length;
        if (total > PRINT_LIMITS.metadataBytes) { await reader.cancel(); throw new Error("Expanded metadata exceeds the 1 MB limit."); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    raw = new Uint8Array(total); let cursor = 0;
    for (const chunk of chunks) { raw.set(chunk, cursor); cursor += chunk.length; }
  } else throw new Error("This archive uses an unsupported compression method.");
  if (raw.length !== m.length || raw.length > PRINT_LIMITS.metadataBytes || crc32(raw) !== m.crc) throw new Error("Metadata failed its integrity check. Re-save the project in your slicer.");
  return new TextDecoder("utf-8", { fatal: true }).decode(raw);
}

export function parsePrintSlice(text, Parser = globalThis.DOMParser) {
  if (!text) return [];
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error("XML entity declarations are not supported.");
  if (!Parser) throw new Error("XML parsing is unavailable.");
  const doc = new Parser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror") || doc.documentElement?.tagName !== "config") throw new Error("Slice metadata is not valid Bambu XML.");
  return [...doc.querySelectorAll("config > plate")].map((plate, index) => {
    const values = Object.fromEntries([...plate.querySelectorAll(":scope > metadata")].map(e => [e.getAttribute("key"), e.getAttribute("value")]));
    return {
      index: values.index || String(index + 1), grams: nonnegative(values.weight), seconds: nonnegative(values.prediction),
      warnings: [...plate.querySelectorAll(":scope > warning")].map(e => e.getAttribute("msg") || "Slicer warning"),
      objectCount: plate.querySelectorAll(':scope > object:not([skipped="true"])').length,
      nozzle: String(values.nozzle_diameters || "").slice(0, 120), printerModelId: String(values.printer_model_id || "").slice(0, 120),
      supportUsed: values.support_used === "true" ? true : values.support_used === "false" ? false : null,
      outsidePlate: values.outside === "true",
      filaments: [...plate.querySelectorAll(":scope > filament")].map(element => ({
        id: String(element.getAttribute("id") || "").slice(0, 80), type: String(element.getAttribute("type") || "").slice(0, 120),
        color: String(element.getAttribute("color") || "").slice(0, 80), grams: nonnegative(element.getAttribute("used_g")), meters: nonnegative(element.getAttribute("used_m")),
      })),
    };
  });
}

export function printProjectProfiles(config = {}) {
  if (!config || typeof config !== "object" || Array.isArray(config)) return [];
  const list = key => Array.isArray(config[key]) ? config[key].slice(0, 128) : [];
  const types = list("filament_type"), colors = list("filament_colour"), names = list("filament_settings_id"), vendors = list("filament_vendor");
  const length = Math.max(types.length, colors.length, names.length, vendors.length);
  const value = item => String(item ?? "").slice(0, 240);
  return Array.from({ length }, (_, index) => ({ id: String(index + 1), type: value(types[index]), color: value(colors[index]), profile: value(names[index]), vendor: value(vendors[index]) }));
}

export async function inspectPrintFile(file, options = {}) {
  if (!/\.3mf$/i.test(file.name) || file.size > PRINT_LIMITS.fileBytes) throw new Error("Choose a .3mf file under 128 MB.");
  const buffer = await file.arrayBuffer();
  const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", buffer))].map(b => b.toString(16).padStart(2, "0")).join("");
  const slice = await readPrintZipEntry(buffer, "Metadata/slice_info.config", options);
  const configText = await readPrintZipEntry(buffer, "Metadata/project_settings.config", options);
  const issues = [];
  let config = {};
  try { const parsed = configText ? JSON.parse(configText) : {}; if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) config = parsed; else issues.push("Project settings are not a readable settings object."); }
  catch { issues.push("Project settings could not be read; saved slice estimates are still shown."); }
  const plates = parsePrintSlice(slice, options.Parser);
  const filamentProfiles = printProjectProfiles(config);
  for (const plate of plates) plate.filaments = plate.filaments.map(filament => {
    const profile = filamentProfiles.find(item => item.id === filament.id) || {};
    return { ...profile, ...filament, type: filament.type || profile.type || "", color: filament.color || profile.color || "" };
  });
  return { name: file.name, sha256, printer: String(config.printer_model || "Not recorded").slice(0, 240), printerProfile: String(config.printer_settings_id || "").slice(0, 240), nozzle: Array.isArray(config.nozzle_diameter) ? config.nozzle_diameter.map(String).slice(0, 8).join(", ") : "", sliceProfile: String(config.print_settings_id || "").slice(0, 240), filamentProfiles, presetCosts: Array.isArray(config.filament_cost) ? config.filament_cost.slice(0, 128).map(value => String(value).slice(0, 80)) : [], plates, issues, issue: plates.length ? "" : "No saved slice estimates. Re-slice for your current printer and save the project." };
}
