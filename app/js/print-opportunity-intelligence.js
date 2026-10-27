import { nonnegative, printEconomics } from "./print-opportunity-core.js?v=phantom-live-20261027-247";

const normalized = value => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
const measured = value => nonnegative(value) !== null && Number(value) > 0;
const label = row => `${row.file.name} · plate ${row.plate.index}`;

export function selectPrintFiles(list, limit = 20) {
  const all = [...list], projects = all.filter(file => /\.3mf$/i.test(file.name));
  projects.sort((a, b) => String(a.webkitRelativePath || a.name).localeCompare(String(b.webkitRelativePath || b.name)));
  return { files: projects.slice(0, limit), totalProjects: projects.length, ignored: all.length - projects.length, truncated: Math.max(0, projects.length - limit) };
}

/** Descriptors must exactly identify one recorded material; generic filename guesses are excluded. */
export function matchPrintMaterial(filament, materials = []) {
  const keys = [filament.profile];
  if (filament.type && filament.color) keys.push([filament.vendor, filament.type, filament.color].filter(Boolean).join(" "));
  if (!filament.profile && !filament.vendor && !filament.color && filament.type) keys.push(filament.type);
  const names = new Set(keys.map(normalized).filter(Boolean));
  const matches = materials.filter(material => names.has(normalized(material.name)));
  if (matches.length !== 1) return null;
  const material = matches[0];
  if (!["g", "kg"].includes(material.unit) || !measured(material.unitCost)) return null;
  return { materialId: material.id, name: material.name, costPerGram: Number(material.unitCost) / (material.unit === "kg" ? 1000 : 1), unit: material.unit, unitCost: Number(material.unitCost), source: "saved-business-material" };
}

function recordedMaterialCost(plate, materials) {
  const filaments = (plate.filaments || []).filter(filament => measured(filament.grams));
  if (!filaments.length || !measured(plate.grams)) return null;
  const used = filaments.reduce((sum, filament) => sum + Number(filament.grams), 0);
  if (Math.abs(used - Number(plate.grams)) > Math.max(.05, Number(plate.grams) * .001)) return null;
  const sources = filaments.map(filament => ({ filament, material: matchPrintMaterial(filament, materials) }));
  if (sources.some(source => !source.material)) return null;
  return { amount: sources.reduce((sum, source) => sum + source.filament.grams * source.material.costPerGram, 0), currency: "USD", source: "saved-business-materials", materials: sources.map(source => ({ ...source.material, grams: source.filament.grams })) };
}

/** Deterministic, sourced planning conclusions; no price, product yield or demand inference. */
export function analyzePrintOpportunities(files, { businessId, businessContext, costs, costsSource = "example" } = {}) {
  const context = businessContext?.state || businessContext;
  const currency = businessContext?.currency || context?.currency;
  const scoped = context?.tenantId === businessId && (!currency || currency === "USD");
  const materials = scoped && Array.isArray(context.materials) ? context.materials.filter(material => material?.tenantId === businessId) : [];
  const printers = scoped && Array.isArray(context.printers) ? context.printers.filter(printer => printer?.tenantId === businessId) : [];
  const seen = new Map(), duplicates = [], uniqueFiles = [], unreadable = [], rows = [];
  for (const file of files) {
    if (file.error) { unreadable.push(file); continue; }
    if (file.sha256 && seen.has(file.sha256)) { duplicates.push({ file, original: seen.get(file.sha256) }); continue; }
    if (file.sha256) seen.set(file.sha256, file.name);
    uniqueFiles.push(file);
    for (const plate of file.plates || []) {
      const ready = measured(plate.grams) && measured(plate.seconds);
      let estimate = null;
      if (ready && costs) try { estimate = printEconomics(plate.grams, plate.seconds, costs); } catch { /* Incomplete optional pricing does not block technical analysis. */ }
      rows.push({ file, plate, materialCost: recordedMaterialCost(plate, materials), estimate,
        ready,
        printerMatch: printers.find(printer => normalized(printer.name) === normalized(file.printer))?.name || null,
        requirements: [...new Set((plate.filaments || []).map(filament => [filament.vendor, filament.type, filament.color].filter(Boolean).join(" ")).filter(Boolean))],
      });
    }
  }
  rows.sort((a, b) => (measured(a.plate.seconds) ? a.plate.seconds : Infinity) - (measured(b.plate.seconds) ? b.plate.seconds : Infinity) || (measured(a.plate.grams) ? a.plate.grams : Infinity) - (measured(b.plate.grams) ? b.plate.grams : Infinity) || label(a).localeCompare(label(b)));
  const readyRows = rows.filter(row => row.ready), needsSlice = uniqueFiles.filter(file => !file.plates?.length || file.plates.some(plate => !measured(plate.grams) || !measured(plate.seconds)));
  const warningRows = rows.filter(row => row.plate.warnings?.length || row.plate.outsidePlate);
  const fastest = readyRows[0] || null, lightest = [...readyRows].sort((a, b) => a.plate.grams - b.plate.grams || a.plate.seconds - b.plate.seconds)[0] || null;
  const printerTargets = [...new Set(uniqueFiles.map(file => file.printer).filter(printer => printer && printer !== "Not recorded"))];
  let nextAction;
  if (unreadable.length) nextAction = `Re-save ${unreadable[0].name} in your slicer; its archive could not be read safely.`;
  else if (needsSlice.length) nextAction = `Slice ${needsSlice[0].name} for the printer you will use, then save the 3MF with estimates.`;
  else if (warningRows.length) nextAction = warningRows[0].plate.outsidePlate ? `Check objects marked outside the printable plate in ${label(warningRows[0])}.` : `Review the saved slicing warning for ${label(warningRows[0])} before producing it.`;
  else if (printerTargets.length > 1) nextAction = "These slices target different printer profiles. Re-slice the candidates for your intended printer before comparing production capacity.";
  else if (readyRows.some(row => !row.materialCost) && costsSource === "example") nextAction = "The next useful fact is your actual filament cost. Match the recorded filament profile to a saved inventory material; the technical comparison already works.";
  else nextAction = "Use the fastest saved slice as a turnaround candidate, then confirm its current printer profile, saleable quantity and commercial rights before quoting.";
  return { rows, uniqueFiles, duplicates, unreadable, needsSlice, warningRows, fastest, lightest, printerTargets, nextAction, costsSource,
    counts: { selected: files.length, uniqueFiles: uniqueFiles.length, duplicates: duplicates.length, unreadable: unreadable.length, plates: rows.length, ready: readyRows.length, needsSlice: needsSlice.length, warnings: warningRows.length },
    source: "saved-3mf-metadata", moneyBasis: costsSource === "saved" ? "saved-device-assumptions" : costsSource === "custom" ? "user-planning-assumptions" : "illustrative-example-only",
  };
}
