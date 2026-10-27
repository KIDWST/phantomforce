import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { businessError } from "./business-scope.js";
import { getCommerceState } from "./commerce-store.js";
import { inspectPrintBuffer, printCore, type PrintFilament, type PrintMetadata } from "./print-parser.js";

export const PRINT_TENANT = "occasionally-odd";
export const PRINT_RUN_LIMITS = Object.freeze({ fileBytes: 128 * 1024 * 1024, journalBytes: 32 * 1024 * 1024, runs: 20000, files: 5000, responseRuns: 200 });
const nonnegative = z.number().finite().min(0).max(1_000_000);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime({ offset: true });
const costSchema = z.object({ filament: nonnegative, machine: nonnegative, labor: nonnegative, minutes: nonnegative,
  packaging: nonnegative, fixedFee: nonnegative, failure: z.number().min(0).max(.99), fee: z.number().min(0).max(.99),
  margin: z.number().min(0).max(.99), hourly: nonnegative, revenue: nonnegative }).strict()
  .refine(value => value.fee + value.margin < 1, "Fees plus margin must be below 100%.");
const settingsSchema = z.object({ paused: z.boolean(), currency: z.string().regex(/^[A-Z]{3}$/), costsConfirmed: z.boolean(), costs: costSchema }).strict();
export const PrintSettingsInput = settingsSchema.partial().strict();
const comparableSchema = z.object({ url: z.string().url().max(2000).refine(value => /^https:\/\//i.test(value)), observedAt: timestamp,
  currency: z.string().regex(/^[A-Z]{3}$/), price: nonnegative, shipping: nonnegative.nullable(), quantity: z.number().int().min(1).max(100000),
  kind: z.enum(["asking", "sold"]), comparable: z.boolean(), notes: z.string().max(1000).default("") }).strict();
export const PrintModelInput = z.object({ name: z.string().trim().min(1).max(180), saleableUnits: z.number().int().min(1).max(100000),
  completeProduct: z.boolean(), extraCostPerBatch: nonnegative.default(0), rightsStatus: z.enum(["original", "authorized", "unconfirmed"]), rightsReference: z.string().max(1000).default(""),
  comparables: z.array(comparableSchema).max(20).default([]) }).strict().refine(value => value.rightsStatus !== "authorized" || !!value.rightsReference.trim(), "Record the license reference.");
const mappingSchema = z.object({ sha256: hash, tenantId: z.literal(PRINT_TENANT), value: PrintModelInput, updatedAt: timestamp }).strict();
const filamentSchema = z.object({ id: z.string().max(80), type: z.string().max(120), color: z.string().max(80), grams: nonnegative.nullable(), meters: nonnegative.nullable(), profile: z.string().max(240).optional(), vendor: z.string().max(240).optional() }).strict();
const metadataSchema = z.object({ name: z.string().max(240), sha256: hash, printer: z.string().max(240), printerProfile: z.string().max(240), nozzle: z.string().max(240), sliceProfile: z.string().max(240),
  filamentProfiles: z.array(z.object({ id: z.string().max(80), type: z.string().max(240), color: z.string().max(240), profile: z.string().max(240), vendor: z.string().max(240) }).strict()).max(128),
  presetCosts: z.array(z.string().max(80)).max(128), plates: z.array(z.object({ index: z.string().max(80), grams: nonnegative.nullable(), seconds: nonnegative.nullable(), warnings: z.array(z.string().max(500)).max(256), objectCount: z.number().int().min(0).max(100000), nozzle: z.string().max(120), printerModelId: z.string().max(120), supportUsed: z.boolean().nullable(), outsidePlate: z.boolean(), filaments: z.array(filamentSchema).max(128) }).strict()).max(256),
  issues: z.array(z.string().max(500)).max(100), issue: z.string().max(500), hasGcode: z.boolean(), projectTitle: z.string().max(240).optional() }).strict();
const fileSchema = z.object({ sha256: hash, tenantId: z.literal(PRINT_TENANT), bytes: z.number().int().positive().max(PRINT_RUN_LIMITS.fileBytes), capturedAt: timestamp, metadata: metadataSchema }).strict();
const evidenceSchema = z.enum(["prepared", "submitted", "printing", "completed", "failed", "unknown"]);
const runSchema = z.object({ id: hash, tenantId: z.literal(PRINT_TENANT), sourceEventHash: hash, fileHash: hash, observedAt: timestamp, updatedAt: timestamp,
  evidence: evidenceSchema, source: z.literal("bambu-studio-local"), observations: z.array(z.object({ evidence: evidenceSchema, observedAt: timestamp }).strict()).max(30) }).strict();
const documentSchema = z.object({ schemaVersion: z.literal(1), tenantId: z.literal(PRINT_TENANT), revision: z.number().int().nonnegative(), settings: settingsSchema,
  files: z.array(fileSchema).max(PRINT_RUN_LIMITS.files), runs: z.array(runSchema).max(PRINT_RUN_LIMITS.runs), models: z.array(mappingSchema).max(PRINT_RUN_LIMITS.files) }).strict();
type Document = z.infer<typeof documentSchema>;
export type PrintSettings = z.infer<typeof settingsSchema>;
export type PrintEvidence = z.infer<typeof evidenceSchema>;
export type PrintCollectorStatus = { enabled: boolean; connected: boolean; state: "disconnected" | "watching" | "paused" | "missing-source" | "error" | "stopped"; lastScanAt: string | null; lastCaptureAt: string | null; discovered: number; unsupported?: number; scanLimited?: boolean; error?: string; source: string; coverage: string };
let collector: PrintCollectorStatus = { enabled: false, connected: false, state: "disconnected", lastScanAt: null, lastCaptureAt: null, discovered: 0, source: "Bambu Studio local send packages", coverage: "Prepared send packages; printer completion is not connected" };
export function setPrintCollectorStatus(value: Partial<PrintCollectorStatus>) { collector = { ...collector, ...value, source: "Bambu Studio local send packages" }; }
const defaultRoot = process.env.LOCALAPPDATA ? resolve(process.env.LOCALAPPDATA, "PhantomForce/print-runs") : resolve(dirname(fileURLToPath(import.meta.url)), "../../.local/print-runs");
const locks = new Map<string, Promise<unknown>>();
function fail(code: string, message: string, status = 409): never { throw businessError(code, message, status); }
export function assertPrintTenant(tenantId: string) { if (tenantId !== PRINT_TENANT) fail("PRINT_WORKSPACE_REQUIRED", "The Bambu Studio connection belongs to Occasionally Odd.", 403); }
function storageRoot(root?: string) { return resolve(root || process.env.PHANTOMFORCE_PRINT_RUNS_ROOT || process.env.PHANTOMFORCE_PRINT_RUNS_DIR || defaultRoot); }
function documentPath(root?: string) { return resolve(storageRoot(root), "occasionally-odd.json"); }
function archivePath(sha256: string, root?: string) { if (!hash.safeParse(sha256).success) fail("PRINT_FILE_INVALID", "Invalid print file.", 400); return resolve(storageRoot(root), "archives", sha256 + ".3mf"); }
async function empty(): Promise<Document> { return { schemaVersion: 1, tenantId: PRINT_TENANT, revision: 0, settings: { paused: false, currency: "USD", costsConfirmed: false, costs: { ...(await printCore()).PRINT_DEFAULTS, fee: 0, fixedFee: 0 } }, files: [], runs: [], models: [] }; }
async function readDocument(root?: string): Promise<Document> {
  try {
    const path = documentPath(root);
    if ((await stat(path)).size > PRINT_RUN_LIMITS.journalBytes) fail("PRINT_STORE_INVALID", "Print history is too large and requires administrator review.");
    const result = documentSchema.safeParse(JSON.parse(await readFile(path, "utf8")));
    if (!result.success) fail("PRINT_STORE_INVALID", "Print history requires administrator review.");
    const state = result.data;
    if ([state.files.map(file => file.sha256), state.runs.map(run => run.id), state.models.map(model => model.sha256)].some(keys => new Set(keys).size !== keys.length)
      || state.files.some(file => file.sha256 !== file.metadata.sha256)
      || state.runs.some(run => run.id !== run.sourceEventHash || !state.files.some(file => file.sha256 === run.fileHash))
      || state.models.some(model => !state.files.some(file => file.sha256 === model.sha256))) fail("PRINT_STORE_INVALID", "Print references require administrator review.");
    return state;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty(); if (error instanceof SyntaxError) fail("PRINT_STORE_INVALID", "Print history requires administrator review."); throw error; }
}
async function atomicWrite(path: string, bytes: string | Uint8Array) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = path + "." + randomUUID() + ".tmp";
  try { await writeFile(temporary, bytes, { mode: 0o600 }); await rename(temporary, path); }
  finally { await unlink(temporary).catch(() => undefined); }
}
async function mutate<T>(root: string | undefined, operation: (document: Document) => Promise<T> | T): Promise<T> {
  const path = documentPath(root), previous = locks.get(path) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(async () => { const document = await readDocument(root), before = JSON.stringify(document); const result = await operation(document);
    if (JSON.stringify(document) === before) return result;
    document.revision++;
    const checked = documentSchema.safeParse(document); if (!checked.success) fail("PRINT_STORE_INVALID", "Print history limits were exceeded; no records were removed.");
    const serialized = JSON.stringify(checked.data, null, 2) + "\n"; if (Buffer.byteLength(serialized) > PRINT_RUN_LIMITS.journalBytes) fail("PRINT_STORE_FULL", "Print history needs archiving before more files can be imported.");
    await atomicWrite(path, serialized); return result; });
  locks.set(path, current); try { return await current; } finally { if (locks.get(path) === current) locks.delete(path); }
}
async function boundedRead(path: string) {
  const before = await stat(path); if (!before.isFile() || before.size < 22 || before.size > PRINT_RUN_LIMITS.fileBytes) fail("PRINT_FILE_INVALID", "Choose a stable 3MF under 128 MB.", 400);
  const bytes = await readFile(path), after = await stat(path);
  if (bytes.length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) fail("PRINT_FILE_CHANGING", "The slicer is still writing this file; import will retry.");
  return bytes;
}

/** Trusted local collector only. Remote routes cannot submit paths or forge print outcomes. */
export async function importPrintRun(input: { filePath: string; sourceEventId: string; observedAt: string; evidence: PrintEvidence; companionConfigPath?: string }, root?: string) {
  if (!input.sourceEventId || input.sourceEventId.length > 4000 || !timestamp.safeParse(input.observedAt).success || !evidenceSchema.safeParse(input.evidence).success) fail("PRINT_RECEIPT_INVALID", "Invalid local print observation.", 400);
  const eventHash = createHash("sha256").update(PRINT_TENANT + "\0" + input.sourceEventId).digest("hex");
  const bytes = await boundedRead(input.filePath), companion = input.companionConfigPath ? await boundedRead(input.companionConfigPath) : undefined;
  const raw = await inspectPrintBuffer(bytes, basename(input.filePath).slice(0, 240), companion);
  const parsed = metadataSchema.safeParse(raw); if (!parsed.success) fail("PRINT_METADATA_INVALID", "The 3MF metadata exceeds supported limits.", 400);
  const metadata = parsed.data, now = new Date().toISOString();
  return mutate(root, async document => {
    const existing = document.runs.find(run => run.id === eventHash);
    if (existing && existing.fileHash !== metadata.sha256) fail("PRINT_EVENT_CONFLICT", "A print observation changed its associated file.");
    const archived = document.files.find(file => file.sha256 === metadata.sha256);
    if (!archived) {
      if (document.files.length >= PRINT_RUN_LIMITS.files) fail("PRINT_STORE_FULL", "Print file history needs archiving before more imports.");
      await atomicWrite(archivePath(metadata.sha256, root), bytes);
      document.files.push({ sha256: metadata.sha256, tenantId: PRINT_TENANT, bytes: bytes.length, capturedAt: now, metadata });
    }
    if (existing) {
      const repeated = existing.observations.some(item => item.evidence === input.evidence && item.observedAt === input.observedAt);
      if (!repeated) {
        if (existing.observations.length >= 30) fail("PRINT_OBSERVATIONS_FULL", "Print observation history requires review.");
        existing.observations.push({ evidence: input.evidence, observedAt: input.observedAt });
        // Replayed earlier or weaker observations cannot turn a known outcome into a prepared file.
        const ranks: Record<PrintEvidence, number> = { unknown: 0, prepared: 1, submitted: 2, printing: 3, completed: 4, failed: 4 };
        if (ranks[input.evidence] >= ranks[existing.evidence] && input.observedAt >= existing.updatedAt) { existing.evidence = input.evidence; existing.updatedAt = input.observedAt; }
      }
      return { run: existing, file: document.files.find(file => file.sha256 === metadata.sha256)!, duplicate: repeated };
    }
    if (document.runs.length >= PRINT_RUN_LIMITS.runs) fail("PRINT_STORE_FULL", "Print attempt history needs archiving before more imports.");
    const run: Document["runs"][number] = { id: eventHash, tenantId: PRINT_TENANT, sourceEventHash: eventHash, fileHash: metadata.sha256,
      observedAt: input.observedAt, updatedAt: input.observedAt, evidence: input.evidence, source: "bambu-studio-local", observations: [{ evidence: input.evidence, observedAt: input.observedAt }] };
    document.runs.push(run); return { run, file: document.files.find(file => file.sha256 === metadata.sha256)!, duplicate: false };
  });
}
export async function getPrintSettings(root?: string) { return (await readDocument(root)).settings; }
export const getPrintRunSettings = getPrintSettings;
export async function updatePrintSettings(tenantId: string, input: unknown, root?: string) {
  assertPrintTenant(tenantId); const parsed = PrintSettingsInput.safeParse(input); if (!parsed.success) fail("PRINT_SETTINGS_INVALID", "Check the print cost settings and percentages.", 400);
  return mutate(root, document => { document.settings = settingsSchema.parse({ ...document.settings, ...parsed.data }); return document.settings; });
}
export async function updatePrintModel(tenantId: string, sha256: string, input: unknown, root?: string) {
  assertPrintTenant(tenantId); const parsed = PrintModelInput.safeParse(input); if (!hash.safeParse(sha256).success || !parsed.success) fail("PRINT_MODEL_INVALID", "Check the model yield, rights and market evidence.", 400);
  return mutate(root, document => { if (!document.files.some(file => file.sha256 === sha256)) fail("PRINT_FILE_NOT_FOUND", "Print file not found in this business.", 404);
    const value = { sha256, tenantId: PRINT_TENANT as typeof PRINT_TENANT, value: parsed.data, updatedAt: new Date().toISOString() }; const index = document.models.findIndex(model => model.sha256 === sha256);
    if (index >= 0) document.models[index] = value; else document.models.push(value); return value; });
}
const positive = (value: number | null | undefined): value is number => typeof value === "number" && value > 0;
const normalized = (value: string | undefined) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
function materialCost(plate: PrintMetadata["plates"][number], materials: Array<{ id: string; name: string; unit: string; unitCost: number }>) {
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

export async function getPrintRuns(tenantId = PRINT_TENANT, root?: string) {
  assertPrintTenant(tenantId); const document = await readDocument(root), core = await printCore();
  // Commerce read failure does not fabricate zero-cost filament or hide the durable print journal.
  let materials: Awaited<ReturnType<typeof getCommerceState>>["materials"] = [], materialWarning: string | null = null;
  try { materials = (await getCommerceState(PRINT_TENANT)).materials; } catch { materialWarning = "Saved material costs could not be verified."; }
  const runs = [...document.runs].sort((a, b) => b.observedAt.localeCompare(a.observedAt)).slice(0, PRINT_RUN_LIMITS.responseRuns);
  const included = new Set(runs.map(run => run.fileHash));
  const files = document.files.filter(file => included.has(file.sha256)).map(file => {
    const mapping = document.models.find(model => model.sha256 === file.sha256)?.value || null;
    const plates = file.metadata.plates.map(plate => {
      const recorded = document.settings.currency === "USD" ? materialCost(plate, materials) : null;
      const ready = positive(plate.grams) && positive(plate.seconds);
      const costs = { ...document.settings.costs, ...(recorded && positive(plate.grams) ? { filament: recorded.amount / plate.grams * 1000 } : {}) };
      return { index: plate.index, ready, materialCost: recorded, estimate: ready ? core.printEconomics(plate.grams!, plate.seconds!, costs) : null,
        moneyBasis: document.settings.costsConfirmed ? "saved-planning-assumptions" : "illustrative-scenario", filamentBasis: recorded ? "saved-business-materials" : document.settings.costsConfirmed ? "saved-planning-assumption" : "illustrative-scenario" };
    });
    const allReady = plates.length > 0 && plates.every(plate => plate.ready && plate.estimate);
    const grams = file.metadata.plates.reduce((sum, plate) => sum + (plate.grams || 0), 0), seconds = file.metadata.plates.reduce((sum, plate) => sum + (plate.seconds || 0), 0);
    // Full-project scenarios pay handling/packaging/fixed fees once. Each plate above is a standalone scenario.
    const mixedMaterialAmount = file.metadata.plates.reduce((sum, plate, index) => sum + (plates[index].materialCost?.amount ?? ((plate.grams || 0) / 1000 * document.settings.costs.filament)), 0);
    const projectEstimate = allReady ? core.printEconomics(grams, seconds, { ...document.settings.costs, filament: mixedMaterialAmount / grams * 1000 }) : null;
    const extraCostPerBatch = mapping?.extraCostPerBatch || 0;
    if (projectEstimate && extraCostPerBatch) {
      const costs = document.settings.costs; projectEstimate.cost += extraCostPerBatch;
      projectEstimate.breakEven = projectEstimate.cost / (1 - costs.fee);
      projectEstimate.marginPrice = projectEstimate.cost / (1 - costs.fee - costs.margin);
      projectEstimate.hourlyPrice = (projectEstimate.cost + costs.hourly * projectEstimate.expectedHours) / (1 - costs.fee);
      projectEstimate.contributionPerHour = (costs.revenue * (1 - costs.fee) - projectEstimate.cost) / projectEstimate.expectedHours;
    }
    const totals = { grams, seconds, scope: "complete-project-estimate", cost: projectEstimate?.cost ?? null, breakEven: projectEstimate?.breakEven ?? null,
      marginPrice: projectEstimate?.marginPrice ?? null, hourlyPrice: projectEstimate?.hourlyPrice ?? null };
    const seenComps = new Set<string>(), now = Date.now();
    const comps = (mapping?.comparables || []).filter(comp => { const at = Date.parse(comp.observedAt); return comp.comparable && comp.currency === document.settings.currency && comp.shipping !== null && at <= now && now - at <= 30 * 86400000; })
      .sort((a, b) => b.observedAt.localeCompare(a.observedAt)).filter(comp => { const key = comp.kind + "\0" + comp.url; if (seenComps.has(key)) return false; seenComps.add(key); return true; });
    const rangeFor = (kind: "asking" | "sold") => { const rows = comps.filter(comp => comp.kind === kind), values = rows.map(comp => (comp.price + comp.shipping!) / comp.quantity); return values.length ? { low: Math.min(...values), high: Math.max(...values), count: values.length, limited: values.length < 3, comparables: rows } : null; };
    const asking = rangeFor("asking"), sold = rangeFor("sold");
    return { ...file, mapping, analysis: { currency: document.settings.currency, source: "saved-slice-estimates", plates, totals,
      additionalPartsCost: { amount: extraCostPerBatch, currency: document.settings.currency, source: "saved-product-parts-assumption" },
      moneyBasis: document.settings.costsConfirmed ? "saved-planning-assumptions" : "illustrative-scenario",
      perUnit: mapping?.completeProduct && totals.cost !== null ? { units: mapping.saleableUnits, cost: totals.cost / mapping.saleableUnits, breakEven: totals.breakEven! / mapping.saleableUnits, marginPrice: totals.marginPrice! / mapping.saleableUnits, hourlyPrice: totals.hourlyPrice! / mapping.saleableUnits } : null,
      market: comps.length ? { status: "sourced-comparables", count: comps.length, asking, sold, includesShipping: true, freshnessDays: 30, comparables: comps, caveat: "Asking offers and observed sales are separate, limited samples; neither proves future demand. Evidence older than 30 days, future dates and repeated URLs are excluded." } : { status: "unavailable", count: 0, asking: null, sold: null, caveat: "Connect a legitimate market source or record comparable offers before calling a target price competitive." },
      caveats: ["Slice mass and duration are estimates, not measured consumption.", "Prepared artifacts do not prove submission or completion.", "Objects are parts; saleable yield is never inferred.", "Contribution scenarios exclude unspecified overhead and are not net profit.", ...(document.settings.costsConfirmed ? [] : ["Example costs are illustrative until confirmed once in shop settings."]), ...(materialWarning ? [materialWarning] : [])] } };
  });
  const observed = document.runs.filter(run => ["completed", "failed"].includes(run.evidence)), failed = observed.filter(run => run.evidence === "failed").length;
  return { ok: true, tenant_id: PRINT_TENANT, revision: document.revision, collector: { ...collector, ...(document.settings.paused ? { state: "paused" as const } : {}) }, runs, files, settings: document.settings,
    summary: { receipts: document.runs.length, uniqueFiles: document.files.length, prepared: document.runs.filter(run => run.evidence === "prepared").length,
      submitted: document.runs.filter(run => run.evidence === "submitted").length, printing: document.runs.filter(run => run.evidence === "printing").length,
      completed: observed.length - failed, failed, knownOutcomeFailureRate: observed.length ? failed / observed.length : null, returnedRuns: runs.length,
      marketSource: "not-connected", materialWarning } };
}
export async function getPrintRunArchive(tenantId: string, runId: string, root?: string) {
  assertPrintTenant(tenantId); if (!hash.safeParse(runId).success) fail("PRINT_RUN_NOT_FOUND", "Print receipt not found.", 404);
  const document = await readDocument(root), run = document.runs.find(item => item.id === runId);
  if (!run) fail("PRINT_RUN_NOT_FOUND", "Print receipt not found.", 404);
  const file = document.files.find(item => item.sha256 === run.fileHash)!;
  let bytes: Buffer;
  try { bytes = await boundedRead(archivePath(file.sha256, root)); } catch { return fail("PRINT_ARCHIVE_UNAVAILABLE", "The archived print file could not be verified."); }
  if (createHash("sha256").update(bytes).digest("hex") !== file.sha256) fail("PRINT_ARCHIVE_INVALID", "The archived print file failed its integrity check.");
  return { bytes, sha256: file.sha256, name: file.metadata.name.replace(/[^a-zA-Z0-9_. -]/g, "_").slice(0, 180) || "print.3mf" };
}
