export type QuoteRates = { filament: number; machine: number; labor: number; failure: number; fee: number; margin: number; hourly: number; fixedFee: number };
export type QuoteRecipe = { unitsPerBatch: number; finishingMinutesPerBatch: number; hardwareCostPerBatch: number; packagingCostPerUnit: number };
export function estimatePrintQuote(grams: number, seconds: number, quantity: number, recipe: QuoteRecipe, rates: QuoteRates) {
  if (![grams, seconds, quantity, recipe.unitsPerBatch].every(value => Number.isFinite(value) && value > 0)) throw new Error("A sliced project and positive finished yield are required.");
  const batches = Math.ceil(quantity / recipe.unitsPerBatch), productionMultiplier = batches / (1 - rates.failure);
  const materialCost = grams / 1000 * rates.filament * productionMultiplier;
  const expectedPrinterHours = seconds / 3600 * productionMultiplier, machineCost = expectedPrinterHours * rates.machine;
  const finishingMinutes = recipe.finishingMinutesPerBatch * batches, laborCost = finishingMinutes / 60 * rates.labor;
  const hardwareCost = recipe.hardwareCostPerBatch * batches, packagingCost = recipe.packagingCostPerUnit * quantity;
  const cost = materialCost + machineCost + laborCost + hardwareCost + packagingCost + rates.fixedFee;
  const breakEven = cost / (1 - rates.fee), marginPrice = cost / (1 - rates.fee - rates.margin);
  const hourlyPrice = (cost + rates.hourly * expectedPrinterHours) / (1 - rates.fee), recommendedPrice = Math.max(marginPrice, hourlyPrice);
  return { batches, producedUnits: batches * recipe.unitsPerBatch, grams: grams * productionMultiplier, printerSeconds: seconds * productionMultiplier,
    expectedPrinterHours, finishingMinutes, hardwareCost, materialCost, machineCost, laborCost, packagingCost, fixedFee: rates.fixedFee,
    cost, breakEven, marginPrice, hourlyPrice, recommendedPrice, unitPrice: recommendedPrice / quantity };
}
export type PlanningPrinter = { id: string; label: string; model: string; hoursPerDay: number };
export type QuotePlanning = { printerId: string | null; printerLabel: string; printerHoursPerDay: number | null; printers: PlanningPrinter[]; workDays: number[]; finishingHoursPerDay: number | null; manualQueueHours: number | null; manualFinishingQueueHours: number | null; bufferDays: number; closedDates: string[]; timeZone: string };
function localDay(now: Date, timeZone: string) { const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now); return ["year", "month", "day"].map(key => parts.find(part => part.type === key)!.value).join("-"); }
const dateAfter = (day: string, amount = 1) => { const value = new Date(day + "T12:00:00Z"); value.setUTCDate(value.getUTCDate() + amount); return value.toISOString().slice(0, 10); };
function consumeHours(start: string, hours: number, daily: number, planning: QuotePlanning) {
  let day = start, remaining = hours;
  for (let count = 0; count < 730; count++, day = dateAfter(day)) {
    const weekday = new Date(day + "T12:00:00Z").getUTCDay();
    if (!planning.workDays.includes(weekday) || planning.closedDates.includes(day)) continue;
    remaining -= daily;
    if (remaining <= .000001) return day;
  }
  return null;
}
/** Capacity is a conservative calendar budget. It does not assert an idle printer or reserve work. */
export function planPrintDelivery(estimate: ReturnType<typeof estimatePrintQuote>, planning: QuotePlanning, eligible: PlanningPrinter[], queueHours: number, now = new Date()) {
  const reasons = ["Planning estimate only; draft quotes do not reserve printer capacity.", "Current device availability is unconfirmed. Include any unrecorded work in the queue allowance."];
  if (!eligible.length || !planning.workDays.length || eligible.some(printer => printer.hoursPerDay <= 0)) return { status: "unavailable" as const, readyDate: null, queueHours, reasons: [...reasons, "Confirm compatible printer capacity and workdays."] };
  if (estimate.finishingMinutes > 0 && !(planning.finishingHoursPerDay && planning.finishingHoursPerDay > 0)) return { status: "unavailable" as const, readyDate: null, queueHours, reasons: [...reasons, "Confirm daily hands-on finishing capacity."] };
  // One complete batch remains on one eligible machine. Whole batches are assigned to the least-loaded compatible printer.
  // Existing unassigned queue cannot safely be assumed to occupy only one machine.
  const loads = eligible.map(printer => ({ ...printer, hours: queueHours + (planning.manualQueueHours || 0) }));
  const batchHours = estimate.expectedPrinterHours / estimate.batches;
  for (let batch = 0; batch < estimate.batches; batch++) { loads.sort((a, b) => a.hours / a.hoursPerDay - b.hours / b.hoursPerDay); loads[0].hours += batchHours; }
  const start = dateAfter(localDay(now, planning.timeZone));
  const completions = loads.filter(printer => printer.hours > 0).map(printer => consumeHours(start, printer.hours, printer.hoursPerDay, planning));
  if (completions.some(day => !day)) return { status: "unavailable" as const, readyDate: null, queueHours, reasons: [...reasons, "The configured calendar cannot fit this work within two years."] };
  let ready: string | null = completions.sort().at(-1)!;
  const finishingHours = estimate.finishingMinutes / 60 + (planning.manualFinishingQueueHours || 0);
  if (finishingHours > 0) ready = consumeHours(dateAfter(ready), finishingHours, planning.finishingHoursPerDay!, planning);
  if (!ready) return { status: "unavailable" as const, readyDate: null, queueHours, reasons: [...reasons, "Finishing work does not fit the configured calendar."] };
  for (let buffer = 0; buffer < planning.bufferDays; buffer++) ready = consumeHours(dateAfter(ready!), .000001, 1, planning)!;
  if (planning.manualQueueHours === null || (estimate.finishingMinutes > 0 && planning.manualFinishingQueueHours === null)) return { status: "unavailable" as const, readyDate: null, conditionalReadyDate: ready, queueHours, reasons: [...reasons, "Confirm unrecorded printer and finishing backlog; zero backlog has not been assumed for a delivery promise."] };
  return { status: "planned" as const, readyDate: ready, queueHours, printerLoads: loads.map(({ id, label, hours }) => ({ id, label, hours })),
    reasons: [...reasons, "Calendar budgets begin on the next working day; finishing follows printing."] };
}
export type ActualMeasurements = { printerSeconds: number | null; grams: number | null; finishingMinutes: number | null; hardwareCost: number | null; materialCost: number | null; machineCost: number | null; laborCost: number | null; packagingCost: number | null; revenue: number | null; fees: number | null };
export function calculatePrintActual(actual: ActualMeasurements, rates: QuoteRates | null) {
  const known = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
  const materialCost = actual.materialCost ?? (known(actual.grams) && rates ? actual.grams / 1000 * rates.filament : null);
  const machineCost = actual.machineCost ?? (known(actual.printerSeconds) && rates ? actual.printerSeconds / 3600 * rates.machine : null);
  const laborCost = actual.laborCost ?? (known(actual.finishingMinutes) && rates ? actual.finishingMinutes / 60 * rates.labor : null);
  const values = { materialCost, machineCost, laborCost, hardwareCost: actual.hardwareCost, packagingCost: actual.packagingCost, fees: actual.fees };
  const missing = Object.entries(values).filter(([, value]) => !known(value)).map(([key]) => key);
  const cost = missing.length ? null : Object.values(values).reduce<number>((sum, value) => sum + value!, 0);
  const measuredCosts = [actual.materialCost, actual.machineCost, actual.laborCost].every(known);
  const costBasis = measuredCosts ? "operator-recorded-costs" : rates ? "measured-usage-at-frozen-rates" : "incomplete";
  const contribution = cost !== null && known(actual.revenue) ? actual.revenue - cost : null;
  return { cost, costBasis, missing, materialCost, machineCost, laborCost, contribution,
    contributionPerPrinterHour: contribution !== null && actual.printerSeconds !== null && actual.printerSeconds > 0 ? contribution / (actual.printerSeconds / 3600) : null };
}
