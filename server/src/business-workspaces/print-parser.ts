import { DOMParser } from "@xmldom/xmldom";
import { inflateRawSync } from "node:zlib";

export type PrintFilament = { id: string; type: string; color: string; grams: number | null; meters: number | null; profile?: string; vendor?: string };
export type PrintPlate = { index: string; grams: number | null; seconds: number | null; warnings: string[]; objectCount: number; nozzle: string; printerModelId: string; supportUsed: boolean | null; outsidePlate: boolean; filaments: PrintFilament[] };
export type PrintMetadata = { name: string; sha256: string; printer: string; printerProfile: string; nozzle: string; sliceProfile: string; filamentProfiles: Array<{id: string; type: string; color: string; profile: string; vendor: string}>; presetCosts: string[]; plates: PrintPlate[]; issues: string[]; issue: string; hasGcode?: boolean; projectTitle?: string };
export type PrintCosts = { filament: number; machine: number; labor: number; minutes: number; packaging: number; fixedFee: number; failure: number; fee: number; margin: number; hourly: number; revenue: number };
export type PrintEconomics = { cost: number; expectedHours: number; breakEven: number; marginPrice: number; hourlyPrice: number; contributionPerHour: number };
type Core = {
  PRINT_LIMITS: { fileBytes: number; metadataBytes: number };
  PRINT_DEFAULTS: PrintCosts;
  inspectPrintFile(file: { name: string; size: number; arrayBuffer(): Promise<ArrayBuffer> }, options: unknown): Promise<PrintMetadata>;
  readPrintZipEntry(buffer: ArrayBuffer, wanted: string, options: unknown): Promise<string | null>;
  printProjectProfiles(config: unknown): PrintMetadata["filamentProfiles"];
  printEconomics(grams: number, seconds: number, costs: PrintCosts): PrintEconomics | null;
};
let corePromise: Promise<Core> | undefined;
export function printCore(): Promise<Core> {
  // Identical relative layout in src/ and dist/. Avoid a copied parser drifting from the browser.
  const moduleUrl = new URL("../../../app/js/print-opportunity-core.js", import.meta.url).href;
  return corePromise ??= import(moduleUrl) as Promise<Core>;
}
class StrictDOMParser {
  parseFromString(text: string, mime: string) {
    const errors: string[] = [];
    const parser = new DOMParser({ onError: (_level: string, message: string) => { errors.push(message); } });
    let doc;
    try { doc = parser.parseFromString(text, mime as "application/xml"); }
    catch { throw new Error("Slice metadata is not valid Bambu XML."); }
    if (errors.length) throw new Error("Slice metadata is not valid Bambu XML.");
    return doc;
  }
}
const inflate = (bytes: Uint8Array) => inflateRawSync(bytes, { maxOutputLength: 1024 * 1024 });
const toArrayBuffer = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

async function optionalProjectTitle(buffer: ArrayBuffer, core: Core): Promise<string | undefined> {
  for (const member of ["3D/3dmodel.model", "Metadata/model_settings.config"]) {
    try {
      const text = await core.readPrintZipEntry(buffer, member, { inflate });
      if (!text || /<!DOCTYPE|<!ENTITY/i.test(text)) continue;
      const doc = new StrictDOMParser().parseFromString(text, "application/xml");
      const metadata = Array.from(doc.getElementsByTagName("metadata"));
      const clean = (value: string | null | undefined) => String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 240);
      const title = metadata.find(node => node.getAttribute("name") === "Title" && node.parentNode === doc.documentElement);
      if (title && clean(title.textContent)) return clean(title.textContent);
      const plate = metadata.find(node => node.getAttribute("key") === "plater_name");
      if (plate && clean(plate.getAttribute("value"))) return clean(plate.getAttribute("value"));
      const names = [...new Set(metadata.filter(node => node.getAttribute("key") === "name" && node.parentNode?.nodeName === "object").map(node => clean(node.getAttribute("value"))).filter(Boolean))];
      if (names.length === 1) return names[0];
    } catch { /* Optional large, malformed or unavailable title metadata never hides valid slice estimates. */ }
  }
  return undefined;
}

/** Inspect names only: G-code is never decompressed, parsed, executed or sent to a printer. */
function hasSavedGcode(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) { end = i; break; }
  if (end < 0) throw new Error("The archive has no valid ZIP directory.");
  const entries = view.getUint16(end + 10, true), size = view.getUint32(end + 12, true), start = view.getUint32(end + 16, true);
  if (entries > 10000 || entries === 65535 || start + size > end) throw new Error("The archive directory is invalid.");
  let offset = start, found = false;
  for (let i = 0; i < entries; i++) {
    if (offset + 46 > start + size || view.getUint32(offset, true) !== 0x02014b50) throw new Error("The archive directory is incomplete.");
    const length = view.getUint16(offset + 28, true), next = offset + 46 + length + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
    if (next > start + size) throw new Error("The archive directory contains an invalid entry.");
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + length));
    if (/^Metadata\/plate_\d+\.gcode$/i.test(name) && !(view.getUint16(offset + 8, true) & 1)) found = true;
    offset = next;
  }
  return found;
}

/** Only known metadata is retained; no 3MF XML, G-code, paths or raw settings leave this adapter. */
export async function inspectPrintBuffer(bytes: Uint8Array, name: string, companion?: Uint8Array): Promise<PrintMetadata> {
  const core = await printCore();
  const buffer = toArrayBuffer(bytes);
  const metadata = await core.inspectPrintFile({ name, size: bytes.byteLength, arrayBuffer: async () => buffer }, { Parser: StrictDOMParser, inflate });
  metadata.hasGcode = hasSavedGcode(bytes);
  metadata.projectTitle = await optionalProjectTitle(buffer, core);
  if (companion) {
    metadata.projectTitle ||= await optionalProjectTitle(toArrayBuffer(companion), core);
    const configText = await core.readPrintZipEntry(toArrayBuffer(companion), "Metadata/project_settings.config", { inflate });
    let config: Record<string, unknown> = {};
    try { const value = JSON.parse(configText || "{}"); if (value && typeof value === "object" && !Array.isArray(value)) config = value; }
    catch { metadata.issues.push("Companion project settings could not be read."); }
    const profiles = core.printProjectProfiles(config);
    if (!metadata.filamentProfiles.length) metadata.filamentProfiles = profiles;
    if (metadata.printer === "Not recorded") metadata.printer = String(config.printer_model || "Not recorded").slice(0, 240);
    if (!metadata.printerProfile) metadata.printerProfile = String(config.printer_settings_id || "").slice(0, 240);
    if (!metadata.sliceProfile) metadata.sliceProfile = String(config.print_settings_id || "").slice(0, 240);
    for (const plate of metadata.plates) for (const filament of plate.filaments) {
      const profile = metadata.filamentProfiles.find(item => item.id === filament.id);
      if (profile) { filament.profile ||= profile.profile; filament.vendor ||= profile.vendor; filament.type ||= profile.type; filament.color ||= profile.color; }
    }
  }
  return metadata;
}
