import type { PrintFilament, PrintMetadata } from "./print-parser.js";
const positive = (value: number | null | undefined): value is number => typeof value === "number" && value > 0;
const normalized = (value: string | undefined) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
/** Exact identity and complete slice accounting only. Preset currencies are never inferred. */
export function savedPrintMaterialCost(plate: PrintMetadata["plates"][number], materials: Array<{ id: string; name: string; unit: string; unitCost: number }>) {
  if (!positive(plate.grams) || !plate.filaments.length || plate.filaments.some(filament => !positive(filament.grams))) return null;
  const used = plate.filaments.reduce((sum, filament) => sum + (filament.grams || 0), 0);
  if (Math.abs(used - plate.grams) > Math.max(.05, plate.grams * .001)) return null;
  const matches = plate.filaments.map((filament: PrintFilament) => {
    const keys = [filament.profile]; if (filament.type && filament.color) keys.push([filament.vendor, filament.type, filament.color].filter(Boolean).join(" "));
    if (!filament.profile && !filament.vendor && !filament.color && filament.type) keys.push(filament.type);
    const names = new Set(keys.map(normalized).filter(Boolean)), rows = materials.filter(material => names.has(normalized(material.name)));
    return rows.length === 1 && ["g", "kg"].includes(rows[0].unit) && positive(rows[0].unitCost) ? { materialId: rows[0].id, name: rows[0].name, grams: filament.grams!, amount: filament.grams! * rows[0].unitCost / (rows[0].unit === "kg" ? 1000 : 1) } : null;
  });
  return matches.some(match => !match) ? null : { amount: matches.reduce((sum, match) => sum + match!.amount, 0), currency: "USD", source: "saved-business-materials", materials: matches };
}
