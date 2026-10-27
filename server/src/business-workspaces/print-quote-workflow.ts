import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { businessError } from "./business-scope.js";
import { getCommerceState } from "./commerce-store.js";
import { savedPrintMaterialCost } from "./print-material-cost.js";
import { calculatePrintActual, estimatePrintQuote, planPrintDelivery, type QuotePlanning } from "./print-quote-core.js";
import type { PrintMetadata, PrintCosts } from "./print-parser.js";

const TENANT = "occasionally-odd";
const nonnegative = z.number().finite().min(0).max(1_000_000), maybeNumber = nonnegative.nullable();
const hash = z.string().regex(/^[a-f0-9]{64}$/), id = z.string().uuid(), label = z.string().trim().min(1).max(180), timestamp = z.string().datetime({ offset: true });
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value);
const printerSchema = z.object({ id: z.string().min(1).max(120), label, model: label, hoursPerDay: z.number().finite().min(0).max(24) }).strict();
const planningSchema = z.object({ printerId: z.string().max(180).nullable(), printerLabel: z.string().max(180), printerHoursPerDay: z.number().finite().min(0).max(24).nullable(), printers: z.array(printerSchema).max(20).default([]),
  workDays: z.array(z.number().int().min(0).max(6)).max(7), finishingHoursPerDay: z.number().finite().min(0).max(24).nullable(), manualQueueHours: maybeNumber, manualFinishingQueueHours: maybeNumber,
  bufferDays: z.number().int().min(0).max(30), closedDates: z.array(date).max(366), timeZone: z.literal("America/Chicago") }).strict().refine(value => new Set(value.printers.map(printer => printer.id)).size === value.printers.length, "Duplicate printers are not allowed.");
const recipeInput = z.object({ recipeId: id.optional(), name: label, fileHash: hash, unitsPerBatch: z.number().int().min(1).max(100000), completeProduct: z.boolean(), finishingMinutesPerBatch: nonnegative,
  hardwareCostPerBatch: nonnegative, packagingCostPerUnit: nonnegative, compatiblePrinterIds: z.array(z.string().min(1).max(120)).max(20).default([]), notes: z.string().max(1000).default("") }).strict();
const recipeSchema = recipeInput.omit({ recipeId: true }).extend({ id, version: z.number().int().positive(), linkedFileHashes: z.array(hash).min(1).max(500), createdAt: timestamp, updatedAt: timestamp }).strict();
const ratesSchema = z.object({ filament: nonnegative, machine: nonnegative, labor: nonnegative, failure: z.number().finite().min(0).max(.99), fee: z.number().finite().min(0).max(.99), margin: z.number().finite().min(0).max(.99), hourly: nonnegative, fixedFee: nonnegative }).strict().refine(value => value.fee + value.margin < 1);
const estimateSchema = z.object({ batches: z.number().int().positive(), producedUnits: z.number().int().positive(), grams: nonnegative, printerSeconds: nonnegative, expectedPrinterHours: nonnegative, finishingMinutes: nonnegative,
  hardwareCost: nonnegative, materialCost: nonnegative, machineCost: nonnegative, laborCost: nonnegative, packagingCost: nonnegative, fixedFee: nonnegative, cost: nonnegative, breakEven: nonnegative, marginPrice: nonnegative, hourlyPrice: nonnegative, recommendedPrice: nonnegative, unitPrice: nonnegative }).strict();
const deliverySchema = z.object({ status: z.enum(["planned", "unavailable"]), readyDate: date.nullable(), conditionalReadyDate: date.optional(), queueHours: nonnegative, reasons: z.array(z.string().max(500)).max(20), printerLoads: z.array(z.object({ id: z.string(), label: z.string(), hours: nonnegative })).optional() }).strict();
const quoteSchema = z.object({ id, version: z.number().int().positive(), createdAt: timestamp, recipeId: id, fileHash: hash, quantity: z.number().int().positive().max(100000), batches: z.number().int().positive(), producedUnits: z.number().int().positive(),
  currency: z.literal("USD"), costsConfirmed: z.boolean(), estimate: estimateSchema, delivery: deliverySchema, recipeSnapshot: recipeSchema, ratesSnapshot: ratesSchema, planningSnapshot: planningSchema,
  needBy: date.nullable(), canMeetNeedBy: z.boolean().nullable(), materialBasis: z.enum(["saved-business-materials", "mixed-saved-materials-and-generic-rate", "saved-generic-filament-rate"]).default("saved-generic-filament-rate"), source: z.literal("saved-slice-and-shop-assumptions") }).strict();
const actualInput = z.object({ runId: hash, quoteId: id.nullable(), quoteVersion: z.number().int().positive().optional(), outcome: z.enum(["completed", "failed"]), startedAt: timestamp.nullable(), completedAt: timestamp,
  printerSeconds: maybeNumber, grams: maybeNumber, finishingMinutes: maybeNumber, hardwareCost: maybeNumber, materialCost: maybeNumber, machineCost: maybeNumber, laborCost: maybeNumber, packagingCost: maybeNumber, revenue: maybeNumber, fees: maybeNumber,
  goodUnits: z.number().int().min(0).max(100000).nullable(), notes: z.string().max(1000).default("") }).strict();
const actualSchema = actualInput.omit({ quoteVersion: true }).extend({ quoteVersion: z.number().int().positive().nullable(), version: z.number().int().positive(), source: z.enum(["operator-confirmed", "printer-telemetry"]), recordedAt: timestamp, actor: z.string().max(180), corrections: z.array(z.object({ at: timestamp, version: z.number().int().positive(), source: z.string(), outcome: z.string() })).max(100) }).strict();
const timerSchema = z.object({ runId: hash, startedAt: timestamp.nullable(), seconds: nonnegative, updatedAt: timestamp }).strict();
const bindingSchema = z.object({ runId: hash, printerId: z.string().min(1).max(180), taskId: z.string().min(1).max(180), subtaskId: z.string().max(180).optional(), boundAt: timestamp }).strict();
const receiptSchema = z.object({ commandId: z.string().min(1).max(180), digest: hash, at: timestamp }).strict();
const workflowSchema = z.object({ schemaVersion: z.literal(1), tenantId: z.literal(TENANT), revision: z.number().int().nonnegative(), planning: planningSchema,
  recipes: z.array(recipeSchema).max(5000), quotes: z.array(quoteSchema).max(10000), actuals: z.array(actualSchema).max(20000), actualHistory: z.array(actualSchema).max(30000).default([]), timers: z.array(timerSchema).max(20000), bindings: z.array(bindingSchema).max(20000), receipts: z.array(receiptSchema).max(30000) }).strict();
type Workflow = z.infer<typeof workflowSchema>;
type Recipe = z.infer<typeof recipeSchema>;
type Quote = z.infer<typeof quoteSchema>;
type Actual = z.infer<typeof actualSchema>;
export type PrintWorkflowSource = { settings: { currency: string; costsConfirmed: boolean; costs: PrintCosts }; files: Array<{ sha256: string; metadata: PrintMetadata }>; runs: Array<{ id: string; fileHash: string; evidence: string; observedAt: string }> };
const defaultRoot = process.env.LOCALAPPDATA ? resolve(process.env.LOCALAPPDATA, "PhantomForce/print-runs") : resolve(dirname(fileURLToPath(import.meta.url)), "../../.local/print-runs");
const locks = new Map<string, Promise<unknown>>();
function fail(message: string, status = 409): never { throw businessError("PRINT_WORKFLOW_INVALID", message, status); }
const filePath = (root?: string) => resolve(root || process.env.PHANTOMFORCE_PRINT_RUNS_ROOT || process.env.PHANTOMFORCE_PRINT_RUNS_DIR || defaultRoot, "occasionally-odd-workflow.json");
function empty(): Workflow { return { schemaVersion: 1, tenantId: TENANT, revision: 0, planning: { printerId: null, printerLabel: "", printerHoursPerDay: null, printers: [], workDays: [1, 2, 3, 4, 5], finishingHoursPerDay: null, manualQueueHours: null, manualFinishingQueueHours: null, bufferDays: 0, closedDates: [], timeZone: "America/Chicago" }, recipes: [], quotes: [], actuals: [], actualHistory: [], timers: [], bindings: [], receipts: [] }; }
async function read(root?: string): Promise<Workflow> {
  try { const path = filePath(root); if ((await stat(path)).size > 32 * 1024 * 1024) fail("Print workflow requires administrator archiving."); const parsed = workflowSchema.safeParse(JSON.parse(await readFile(path, "utf8"))); if (!parsed.success) fail("Print workflow requires administrator review; existing data was preserved.");
    const value = parsed.data; const keys = [value.recipes.map(row => row.id), value.quotes.map(row => row.id + ":" + row.version), value.actuals.map(row => row.runId), value.timers.map(row => row.runId), value.bindings.map(row => row.runId), value.receipts.map(row => row.commandId)]; if (keys.some(list => new Set(list).size !== list.length)) fail("Print workflow contains conflicting records."); return value;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty(); if (error instanceof SyntaxError) fail("Print workflow requires administrator review; existing data was preserved."); throw error; }
}
async function mutate<T>(root: string | undefined, fn: (state: Workflow) => T | Promise<T>) {
  const path = filePath(root), previous = locks.get(path) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => { const state = await read(root), before = JSON.stringify(state), result = await fn(state); if (before !== JSON.stringify(state)) { state.revision++;
    const checked = workflowSchema.safeParse(state); if (!checked.success) fail("Print workflow limits were exceeded; no records were removed."); const bytes = JSON.stringify(checked.data, null, 2) + "\n"; if (Buffer.byteLength(bytes) > 32 * 1024 * 1024) fail("Print workflow requires archiving.");
    await mkdir(dirname(path), { recursive: true }); const temporary = path + "." + randomUUID() + ".tmp"; try { await writeFile(temporary, bytes, { mode: 0o600 }); await rename(temporary, path); } finally { await unlink(temporary).catch(() => undefined); }
  } return result; }); locks.set(path, next); try { return await next; } finally { if (locks.get(path) === next) locks.delete(path); }
}
const parse = <S extends z.ZodTypeAny>(schema: S, input: unknown): z.output<S> => { const result = schema.safeParse(input); if (!result.success) fail("Check the print workflow inputs and measurements.", 400); return result.data; };
function sourceFile(source: PrintWorkflowSource, fileHash: string) { const file = source.files.find(file => file.sha256 === fileHash); if (!file) fail("Choose a captured 3MF from Occasionally Odd.", 404); return file; }
function sourceRun(source: PrintWorkflowSource, runId: string) { const run = source.runs.find(run => run.id === runId); if (!run) fail("Choose a captured print observation from Occasionally Odd.", 404); return run; }
function eligiblePrinters(recipe: Recipe, file: PrintWorkflowSource["files"][number], planning: Workflow["planning"]) {
  let printers = planning.printers;
  if (!printers.length && planning.printerHoursPerDay !== null) printers = [{ id: planning.printerId || "configured-printer", label: planning.printerLabel || "Configured printer", model: file.metadata.printer, hoursPerDay: planning.printerHoursPerDay }];
  if (recipe.compatiblePrinterIds.length) return printers.filter(printer => recipe.compatiblePrinterIds.includes(printer.id));
  const model = file.metadata.printer.toUpperCase().match(/\b(P2S|P1S|P1P|X1C|X1 CARBON|A1 MINI|A1)\b/)?.[0];
  return model ? printers.filter(printer => printer.model.toUpperCase().includes(model)) : [];
}
async function commerceQueue() { try { const commerce = await getCommerceState(TENANT); return { known: true, hours: commerce.jobs.filter(job => ["queued", "printing"].includes(job.status)).reduce((sum, job) => sum + job.printHours, 0), revision: commerce.revision }; } catch { return { known: false, hours: 0, revision: null }; } }
function actualCalculation(actual: Actual, state: Workflow) { const quote = state.quotes.find(quote => quote.id === actual.quoteId && quote.version === actual.quoteVersion); return calculatePrintActual(actual, quote?.costsConfirmed ? quote.ratesSnapshot : null); }
function scorecard(state: Workflow, source: PrintWorkflowSource) {
  const completed = state.actuals.filter(actual => actual.outcome === "completed").sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt));
  const rows: Array<Record<string, unknown> & { estimatedCost: number; actualCost: number; costErrorPercent: number; contribution: number | null; actualPrinterHours: number; contributionPerPrinterHour: number | null }> = [], excluded: Array<{ runId: string; reason: string }> = [];
  for (const actual of completed) { const quote = state.quotes.find(quote => quote.id === actual.quoteId && quote.version === actual.quoteVersion), calc = actualCalculation(actual, state), reasons: string[] = [];
    if (!quote) reasons.push("No original frozen quote is paired.");
    else { if (!quote.costsConfirmed) reasons.push("Original shop costs were illustrative."); const baselineBefore = actual.startedAt || source.runs.find(run => run.id === actual.runId)?.observedAt || actual.completedAt; if (Date.parse(quote.createdAt) > Date.parse(baselineBefore)) reasons.push("Quote was saved after the reported print began or its prepared package was observed."); if (quote.batches !== 1 || actual.goodUnits !== quote.producedUnits) reasons.push("A single captured run must match one complete quoted batch and its finished yield."); }
    if (calc.cost === null) reasons.push("Actual costs are incomplete: " + calc.missing.join(", ") + ".");
    if (!(actual.printerSeconds && actual.printerSeconds > 0)) reasons.push("Occupied printer time is missing.");
    if (reasons.length) { excluded.push({ runId: actual.runId, reason: reasons.join(" ") }); continue; }
    const estimatedCost = quote!.estimate.cost - quote!.ratesSnapshot.fixedFee, actualCost = calc.cost! - actual.fees!;
    if (!(actualCost > 0)) { excluded.push({ runId: actual.runId, reason: "A positive recorded production cost is needed for a percentage comparison." }); continue; }
    rows.push({ runId: actual.runId, quoteId: quote!.id, quoteVersion: quote!.version, completedAt: actual.completedAt, source: actual.source, name: quote!.recipeSnapshot.name, estimatedCost, actualCost,
      costBasis: calc.costBasis + "; production-cost comparison excludes payment fees on both sides", costErrorPercent: (estimatedCost - actualCost) / actualCost * 100,
      estimatedPrinterHours: quote!.estimate.expectedPrinterHours, actualPrinterHours: actual.printerSeconds! / 3600, contribution: calc.contribution, contributionPerPrinterHour: calc.contributionPerPrinterHour });
  }
  const sample = rows.slice(0, 10), contributions = sample.filter(row => row.contribution !== null), hours = contributions.reduce((sum, row) => sum + row.actualPrinterHours, 0);
  const failures = state.actuals.filter(actual => actual.outcome === "failed"), measuredFailures = failures.map(actual => ({ actual, calculation: actualCalculation(actual, state) })).filter(row => row.calculation.cost !== null);
  return { target: 10, completedJobs: completed.length, pairedJobs: rows.length, sampleJobs: sample.length, remaining: Math.max(0, 10 - sample.length),
    averageCostErrorPercent: sample.length ? sample.reduce((sum, row) => sum + Math.abs(row.costErrorPercent), 0) / sample.length : null,
    contributionPerPrinterHour: contributions.length && hours > 0 ? contributions.reduce((sum, row) => sum + row.contribution!, 0) / hours : null,
    contributionJobs: contributions.length, failedJobs: failures.length, failedMeasuredCostJobs: measuredFailures.length, failedMeasuredCost: measuredFailures.length ? measuredFailures.reduce((sum, row) => sum + row.calculation.cost!, 0) : null,
    failedMeasuredPrinterHours: failures.some(actual => actual.printerSeconds !== null) ? failures.reduce((sum, actual) => sum + (actual.printerSeconds || 0) / 3600, 0) : null,
    rows: sample, excluded, sampleBasis: "Most recent ten sufficiently measured completed jobs. Completed-job contribution excludes unallocated separate failed attempts; it is not whole-business profit. Missing revenue does not become zero." };
}
export async function getPrintWorkflow(source: PrintWorkflowSource, root?: string) {
  const state = await read(root), queue = await commerceQueue();
  return { revision: state.revision, recipes: state.recipes, quotes: [...state.quotes].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.version - a.version), actuals: state.actuals.map(actual => ({ ...actual, calculated: actualCalculation(actual, state) })), timers: state.timers, planning: state.planning, bindings: state.bindings,
    capacity: { configuredPrinterHoursPerDay: state.planning.printers.reduce((sum, printer) => sum + printer.hoursPerDay, 0), commerceQueueHours: queue.known ? queue.hours : null, queueSource: "recorded-commerce-jobs", telemetryConnected: false, reservationsCreated: false }, scorecard: scorecard(state, source) };
}
const commandSchema = z.object({ commandId: z.string().min(1).max(180), expectedRevision: z.number().int().nonnegative(), type: z.enum(["save-recipe", "link-recipe", "save-planning", "create-quote", "record-actual", "start-finishing", "stop-finishing", "bind-printer-task"]), payload: z.unknown() }).strict();
export async function executePrintWorkflow(source: PrintWorkflowSource, input: unknown, actor: string, root?: string) {
  const command = parse(commandSchema, input), digest = createHash("sha256").update(JSON.stringify({ type: command.type, payload: command.payload })).digest("hex"), now = new Date().toISOString();
  const result = await mutate(root, async state => {
    const repeated = state.receipts.find(receipt => receipt.commandId === command.commandId); if (repeated) { if (repeated.digest !== digest) fail("This command ID already refers to different data."); return { duplicate: true }; }
    if (command.expectedRevision !== state.revision) throw businessError("PRINT_WORKFLOW_CONFLICT", "Print workflow changed. Refresh before saving your changes.", 409);
    let result: Record<string, unknown> = {};
    if (command.type === "save-recipe") { const value = parse(recipeInput, command.payload); sourceFile(source, value.fileHash); if (value.compatiblePrinterIds.some(printerId => !state.planning.printers.some(printer => printer.id === printerId))) fail("Choose configured compatible printers.", 400);
      const existing = value.recipeId ? state.recipes.find(recipe => recipe.id === value.recipeId) : undefined; if (value.recipeId && !existing) fail("Recipe not found.", 404); const { recipeId, ...fields } = value;
      const recipe: Recipe = { ...fields, id: recipeId || randomUUID(), version: (existing?.version || 0) + 1, linkedFileHashes: [...new Set([...(existing?.linkedFileHashes || []), value.fileHash])], createdAt: existing?.createdAt || now, updatedAt: now };
      if (existing) state.recipes[state.recipes.indexOf(existing)] = recipe; else state.recipes.push(recipe); result = { recipe };
    } else if (command.type === "link-recipe") { const value = parse(z.object({ recipeId: id, fileHash: hash, makePrimary: z.boolean() }).strict(), command.payload), recipe = state.recipes.find(recipe => recipe.id === value.recipeId); if (!recipe) fail("Recipe not found.", 404); sourceFile(source, value.fileHash); recipe.linkedFileHashes = [...new Set([...recipe.linkedFileHashes, value.fileHash])]; if (value.makePrimary) recipe.fileHash = value.fileHash; recipe.version++; recipe.updatedAt = now; result = { recipe };
    } else if (command.type === "save-planning") { const supplied = command.payload as Record<string, unknown>; state.planning = parse(planningSchema, { ...state.planning, ...supplied }); result = { planning: state.planning };
    } else if (command.type === "create-quote") { const value = parse(z.object({ recipeId: id, fileHash: hash.optional(), quantity: z.number().int().min(1).max(100000), needBy: date.optional(), quoteId: id.optional() }).strict(), command.payload), recipe = state.recipes.find(recipe => recipe.id === value.recipeId); if (!recipe || !recipe.completeProduct) fail("Confirm a complete-product recipe and its finished yield first.", 400); const file = sourceFile(source, value.fileHash || recipe.fileHash); if (!recipe.linkedFileHashes.includes(file.sha256)) fail("Link this print version to the recipe first.", 400); if (source.settings.currency !== "USD") fail("Local quote workflow currently requires USD shop settings.", 400);
      const plates = file.metadata.plates; if (!plates.length || plates.some(plate => !(plate.grams && plate.grams > 0 && plate.seconds && plate.seconds > 0) || plate.outsidePlate)) fail("The project needs complete valid saved slice estimates.", 400);
      const rates = parse(ratesSchema, Object.fromEntries(["filament", "machine", "labor", "failure", "fee", "margin", "hourly", "fixedFee"].map(key => [key, source.settings.costs[key as keyof PrintCosts]])));
      let materials: Awaited<ReturnType<typeof getCommerceState>>["materials"] = []; try { materials = (await getCommerceState(TENANT)).materials; } catch { /* Rates remain explicitly generic if inventory cannot be verified. */ }
      const materialRows = plates.map(plate => savedPrintMaterialCost(plate, materials)), grams = plates.reduce((sum, plate) => sum + plate.grams!, 0);
      rates.filament = plates.reduce((sum, plate, index) => sum + (materialRows[index]?.amount ?? plate.grams! / 1000 * rates.filament), 0) / grams * 1000;
      const materialBasis = materialRows.every(Boolean) ? "saved-business-materials" : materialRows.some(Boolean) ? "mixed-saved-materials-and-generic-rate" : "saved-generic-filament-rate";
      const estimate = estimatePrintQuote(grams, plates.reduce((sum, plate) => sum + plate.seconds!, 0), value.quantity, recipe, rates), queue = await commerceQueue();
      const eligible = eligiblePrinters(recipe, file, state.planning), delivery = planPrintDelivery(estimate, state.planning as QuotePlanning, eligible, queue.hours);
      if (!queue.known) { delivery.status = "unavailable"; delivery.readyDate = null; delivery.reasons.push("Recorded commerce queue could not be verified."); }
      const prior = value.quoteId ? state.quotes.filter(quote => quote.id === value.quoteId) : []; if (value.quoteId && !prior.length) fail("Quote not found.", 404);
      const quote: Quote = { id: value.quoteId || randomUUID(), version: prior.length ? Math.max(...prior.map(quote => quote.version)) + 1 : 1, createdAt: now, recipeId: recipe.id, fileHash: file.sha256, quantity: value.quantity, batches: estimate.batches, producedUnits: estimate.producedUnits, currency: "USD", costsConfirmed: source.settings.costsConfirmed, estimate, delivery, recipeSnapshot: structuredClone(recipe), ratesSnapshot: rates, planningSnapshot: structuredClone(state.planning), needBy: value.needBy || null, canMeetNeedBy: value.needBy && delivery.readyDate ? delivery.readyDate <= value.needBy : null, materialBasis, source: "saved-slice-and-shop-assumptions" };
      state.quotes.push(quote); result = { quote };
    } else if (command.type === "record-actual") { const value = parse(actualInput, command.payload), run = sourceRun(source, value.runId); if (Date.parse(value.completedAt) > Date.now() + 60000 || value.startedAt && Date.parse(value.startedAt) > Date.parse(value.completedAt)) fail("Check the actual start and completion times.", 400);
      if (value.startedAt && value.printerSeconds !== null && value.printerSeconds > (Date.parse(value.completedAt) - Date.parse(value.startedAt)) / 1000 + 60) fail("Occupied printer time cannot exceed the reported start-to-end window.", 400);
      const candidates = state.quotes.filter(quote => quote.id === value.quoteId && (!value.quoteVersion || quote.version === value.quoteVersion)).sort((a, b) => b.version - a.version); const quote = candidates[0]; if (value.quoteId && (!quote || quote.fileHash !== run.fileHash)) fail("The original quote must match this exact captured print version.", 400);
      if (quote && quote.batches !== 1) fail("A captured run is one batch. Save a one-batch baseline for accuracy measurement; record this outcome unpaired otherwise.", 400);
      if (quote && value.goodUnits !== null && value.goodUnits > quote.producedUnits) fail("Good units cannot exceed the matched one-batch recipe yield.", 400);
      const timer = state.timers.find(timer => timer.runId === run.id); if (timer?.startedAt && value.finishingMinutes === null) fail("Stop the finishing timer before saving its measured minutes.", 400);
      const existing = state.actuals.find(actual => actual.runId === run.id), duration = value.printerSeconds ?? (value.startedAt ? (Date.parse(value.completedAt) - Date.parse(value.startedAt)) / 1000 : null);
      const actual: Actual = { ...value, printerSeconds: duration, quoteVersion: quote?.version || null, finishingMinutes: value.finishingMinutes ?? (timer && timer.seconds > 0 ? timer.seconds / 60 : null), version: (existing?.version || 0) + 1, source: "operator-confirmed", recordedAt: now, actor: actor.slice(0, 180), corrections: existing ? [...existing.corrections, { at: existing.recordedAt, version: existing.version, source: existing.source, outcome: existing.outcome }] : [] };
      if (existing) { state.actualHistory.push(structuredClone(existing)); state.actuals[state.actuals.indexOf(existing)] = actual; } else state.actuals.push(actual); result = { actual };
    } else if (command.type === "start-finishing" || command.type === "stop-finishing") { const value = parse(z.object({ runId: hash }).strict(), command.payload); sourceRun(source, value.runId); let timer = state.timers.find(timer => timer.runId === value.runId); if (!timer) { timer = { runId: value.runId, startedAt: null, seconds: 0, updatedAt: now }; state.timers.push(timer); }
      if (command.type === "start-finishing" && !timer.startedAt) { if (state.timers.some(other => other.runId !== value.runId && other.startedAt)) fail("Stop the other active hands-on timer before starting this job."); timer.startedAt = now; timer.updatedAt = now; }
      if (command.type === "stop-finishing" && timer.startedAt) { timer.seconds += Math.max(0, (Date.parse(now) - Date.parse(timer.startedAt)) / 1000); timer.startedAt = null; timer.updatedAt = now; } result = { timer };
    } else if (command.type === "bind-printer-task") { const value = parse(bindingSchema.omit({ boundAt: true }), command.payload); sourceRun(source, value.runId); const collision = state.bindings.find(binding => binding.runId !== value.runId && binding.printerId === value.printerId && binding.taskId === value.taskId && (binding.subtaskId || "") === (value.subtaskId || "")); if (collision) fail("This printer task is already bound to another observation."); const binding = { ...value, boundAt: now }, existing = state.bindings.find(item => item.runId === value.runId); if (existing) state.bindings[state.bindings.indexOf(existing)] = binding; else state.bindings.push(binding); result = { binding }; }
    state.receipts.push({ commandId: command.commandId, digest, at: now }); return result;
  });
  return { result, workflow: await getPrintWorkflow(source, root) };
}
export async function getWorkflowTelemetryBindings(root?: string) { return (await read(root)).bindings; }
export async function recordWorkflowTelemetry(source: PrintWorkflowSource, input: { runId: string; printerId: string; taskId: string; subtaskId?: string; eventId: string; state: "printing" | "completed" | "failed"; observedAt: string; startedAt?: string; printerSeconds?: number }, root?: string) {
  const value = parse(z.object({ runId: hash, printerId: label, taskId: label, subtaskId: z.string().max(180).optional(), eventId: z.string().min(1).max(1000), state: z.enum(["printing", "completed", "failed"]), observedAt: timestamp, startedAt: timestamp.optional(), printerSeconds: nonnegative.optional() }).strict(), input); sourceRun(source, value.runId);
  if (Date.parse(value.observedAt) > Date.now() + 60000 || value.startedAt && Date.parse(value.startedAt) > Date.parse(value.observedAt)) fail("Printer observation time is invalid.", 400);
  return mutate(root, state => { const binding = state.bindings.find(binding => binding.runId === value.runId && binding.printerId === value.printerId && binding.taskId === value.taskId && (binding.subtaskId || "") === (value.subtaskId || "")); if (!binding) fail("Printer status does not match an explicitly verified task binding.", 403);
    // Re-observing the same terminal state after reconnect does not change the original observation time.
    const { observedAt: _observedAt, ...identity } = value;
    const commandId = "telemetry:" + createHash("sha256").update(value.printerId + "\0" + value.eventId).digest("hex"), digest = createHash("sha256").update(JSON.stringify(identity)).digest("hex"); const repeated = state.receipts.find(receipt => receipt.commandId === commandId); if (repeated) { if (repeated.digest !== digest) fail("A printer event changed its recorded observation."); return { duplicate: true }; }
    if (value.state !== "printing") { const existing = state.actuals.find(actual => actual.runId === value.runId); if (!existing || existing.source === "printer-telemetry" && Date.parse(value.observedAt) >= Date.parse(existing.completedAt)) { const actual: Actual = { runId: value.runId, quoteId: existing?.quoteId || null, quoteVersion: existing?.quoteVersion || null, outcome: value.state === "completed" ? "completed" : "failed", startedAt: value.startedAt || existing?.startedAt || null, completedAt: value.observedAt, printerSeconds: value.printerSeconds ?? existing?.printerSeconds ?? null,
      grams: null, finishingMinutes: null, hardwareCost: null, materialCost: null, machineCost: null, laborCost: null, packagingCost: null, revenue: null, fees: null, goodUnits: null, notes: "Printer terminal state was observed at the recorded time; precise finish time, material and business costs remain unmeasured.", version: (existing?.version || 0) + 1, source: "printer-telemetry", recordedAt: new Date().toISOString(), actor: "paired-printer-status", corrections: existing ? [...existing.corrections, { at: existing.recordedAt, version: existing.version, source: existing.source, outcome: existing.outcome }] : [] }; if (existing) { state.actualHistory.push(structuredClone(existing)); state.actuals[state.actuals.indexOf(existing)] = actual; } else state.actuals.push(actual); } }
    state.receipts.push({ commandId, digest, at: new Date().toISOString() }); return { duplicate: false, state: value.state, runId: value.runId };
  });
}
