import { createHash } from "node:crypto";
import { productById } from "./catalog.mjs";
import { buildCoreLoop } from "./core-loops.mjs";

const round = (value, places = 1) => Number(Number(value).toFixed(places));
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const lines = (value) => String(value || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
const parts = (line, delimiter = "|") => line.split(delimiter).map((value) => value.trim());
const hash = (value) => createHash("sha256").update(String(value)).digest("hex");
const metric = (name, value, unit, formula, inputs, rounding = "one decimal") => ({ name, value, unit, formula, inputs, rounding });
const claim = (text, basis, evidenceIds, inference = false) => ({ text, basis, evidenceIds, inference });

function oracle(fields, evidenceIds) {
  const reserve = Math.max(0, Math.min(100, number(fields.uncertainty)));
  const objectives = lines(fields.objectives).map((line) => { const [name, weight] = parts(line); return { name, weight: number(weight) }; });
  const totalWeight = objectives.reduce((sum, item) => sum + item.weight, 0);
  const options = lines(fields.options).map((line) => {
    const [name, optimistic, base, pessimistic] = parts(line);
    const scores = [number(optimistic), number(base), number(pessimistic)];
    const mean = scores.reduce((sum, value) => sum + value, 0) / scores.length;
    const spread = Math.max(...scores) - Math.min(...scores);
    const adjusted = mean - (spread * reserve / 100);
    return { name, optimistic: scores[0], base: scores[1], pessimistic: scores[2], spread: round(spread), adjusted: round(adjusted) };
  }).sort((a, b) => b.adjusted - a.adjusted || a.name.localeCompare(b.name));
  const top = options[0];
  return {
    summary: top ? `${top.name} ranks first under the declared equal-scenario method; this is a comparison, not a forecast.` : "No option rows were available.",
    metrics: [metric("stability-adjusted option score", top?.adjusted ?? 0, "points", "mean(optimistic, base, pessimistic) − scenario spread × uncertainty reserve", { uncertaintyReservePercent: reserve, objectiveWeightTotal: round(totalWeight, 2) })],
    table: options,
    claims: top ? [claim(`${top.name} has the highest declared stability-adjusted score.`, "calculated", evidenceIds)] : [],
    warnings: totalWeight < 0.99 || totalWeight > 1.01 ? [`Objective weights total ${round(totalWeight, 2)}, not 1.00; rankings currently use scenario scores only.`] : ["Scenario inputs are user assumptions and have not been calibrated against outcomes."],
    method: "Equal-weighted scenario mean with a declared spread penalty. Objective weights are checked for completeness but not silently mixed into option scores."
  };
}

function chronicle(fields, evidenceIds) {
  const events = lines(fields.events).map((line) => {
    const values = parts(line); const modern = values.length >= 5;
    const [eventId, rawDate, kind, event, sourceId] = modern ? values : [`event-${hash(line).slice(0, 8)}`, values[0], values[1], values[2], values[3]];
    const date = String(rawDate || "").split("..")[0]; const timestamp = Date.parse(date.includes("T") ? date : `${date}T00:00:00Z`);
    return { eventId, date: rawDate, kind, event, sourceId, timestamp };
  }).filter((item) => Number.isFinite(item.timestamp)).sort((a, b) => a.timestamp - b.timestamp || a.sourceId.localeCompare(b.sourceId));
  const threshold = Math.max(1, number(fields.gapThresholdDays, 1));
  let maxGap = 0;
  const gaps = [];
  for (let index = 1; index < events.length; index += 1) {
    const days = Math.round((events[index].timestamp - events[index - 1].timestamp) / 86400000);
    maxGap = Math.max(maxGap, days);
    if (days > threshold) gaps.push({ from: events[index - 1].date, to: events[index].date, days });
  }
  const contradictionRows = lines(fields.contradictions).map((line) => { const [sourceA, sourceB, issue] = parts(line); return { sourceA, sourceB, issue }; });
  return {
    summary: `${events.length} dated events were ordered without modifying their source statements; ${gaps.length} gap alerts and ${contradictionRows.length} declared contradictions remain for review.`,
    metrics: [metric("maximum chronology gap", maxGap, "days", "maximum difference between adjacent valid ISO dates", { eventCount: events.length, thresholdDays: threshold }, "whole day")],
    table: events.map(({ timestamp, ...item }) => item),
    claims: events.map((item) => claim(`${item.date}: ${item.event}`, item.kind === "observed" ? "source_fact" : "user_inference", [item.sourceId, ...evidenceIds], item.kind !== "observed")),
    warnings: [...gaps.map((gap) => `${gap.days}-day gap from ${gap.from} to ${gap.to}.`), ...contradictionRows.map((row) => `${row.sourceA} and ${row.sourceB}: ${row.issue}`)],
    method: "Stable ISO-date ordering, adjacent-day gap detection, and preservation of user-declared observed/inferred labels."
  };
}

function foundry(fields, evidenceIds) {
  const taxonomy = [...new Set(lines(fields.taxonomy).map((label) => label.toLowerCase()))];
  const perClass = Math.max(1, Math.min(1000, Math.floor(number(fields.examplesPerClass, 1))));
  const hardPercent = Math.max(0, Math.min(100, number(fields.hardCasePercent)));
  const planned = taxonomy.flatMap((label) => Array.from({ length: Math.min(perClass, 5) }, (_, index) => ({ id: `${label}-${String(index + 1).padStart(3, "0")}`, label, difficulty: index < Math.ceil(Math.min(perClass, 5) * hardPercent / 100) ? "hard" : "standard", recipeDigest: hash(`${fields.dataset}|${label}|${index + 1}`).slice(0, 16) })));
  const total = taxonomy.length * perClass;
  const hardTarget = Math.round(total * hardPercent / 100);
  return {
    summary: `The versioned recipe plans ${total} fixtures across ${taxonomy.length} taxonomy classes; the Milestone 2 core loop materializes a bounded, explicitly synthetic fixture set.`,
    metrics: [metric("planned taxonomy coverage", taxonomy.length ? 100 : 0, "%", "classes with a valid label ÷ declared classes × 100", { classCount: taxonomy.length, examplesPerClass: perClass, hardCaseTarget: hardTarget })],
    table: planned,
    claims: taxonomy.map((label) => claim(`${label}: ${perClass} planned fixtures`, "calculated", evidenceIds)),
    warnings: ["Fixture IDs and distributions are deterministic. No model-generated content or ground-truth claim is produced in this local path."],
    method: "Deduplicated normalized taxonomy × bounded examples-per-class, with deterministic recipe digests and explicit hard-case target."
  };
}

function twin(fields, evidenceIds) {
  const demand = Math.max(0, number(fields.demandPerHour));
  const sla = Math.max(0, number(fields.slaMinutes));
  const steps = lines(fields.steps).map((line) => {
    const [name, minutesValue, workersValue] = parts(line);
    const minutes = Math.max(0.1, number(minutesValue, 0.1));
    const workers = Math.max(1, Math.floor(number(workersValue, 1)));
    const capacityPerHour = workers * 60 / minutes;
    const utilization = capacityPerHour ? demand / capacityPerHour * 100 : 0;
    return { name, minutes, workers, capacityPerHour: round(capacityPerHour), utilizationPercent: round(utilization) };
  });
  const bottleneck = [...steps].sort((a, b) => b.utilizationPercent - a.utilizationPercent)[0];
  const cycle = steps.reduce((sum, step) => sum + step.minutes, 0);
  return {
    summary: bottleneck ? `${bottleneck.name} is the modeled bottleneck at ${bottleneck.utilizationPercent}% utilization under ${demand} items/hour demand.` : "No valid steps were supplied.",
    metrics: [metric("bottleneck utilization", bottleneck?.utilizationPercent ?? 0, "%", "demand per hour ÷ (parallel workers × 60 ÷ minutes per item) × 100", { demandPerHour: demand, modeledCycleMinutes: round(cycle), targetSlaMinutes: sla })],
    table: steps,
    claims: bottleneck ? [claim(`${bottleneck.name} has the highest modeled utilization.`, "calculated", evidenceIds)] : [],
    warnings: [cycle > sla ? `Unqueued step time ${round(cycle)} minutes exceeds the ${sla}-minute SLA before waiting time.` : "Queue arrival variability and worker schedules are not modeled in this bounded slice."],
    method: "Deterministic step capacity and utilization calculation; no employee-level data or machinery control."
  };
}

function dealroom(fields, evidenceIds) {
  const floor = Math.max(0, Math.min(100, number(fields.reservationScore)));
  const interests = lines(fields.interests).map((line) => { const [name, ours, theirs] = parts(line); return { name, ourPriority: number(ours), estimatedCounterpartPriority: number(theirs) }; });
  const packages = lines(fields.packages).map((line) => {
    const [name, ours, theirs] = parts(line);
    const ourValue = number(ours); const counterpartEstimate = number(theirs);
    return { name, ourValue, counterpartEstimate, balancedValue: round(Math.sqrt(Math.max(0, ourValue * counterpartEstimate))), acceptable: ourValue >= floor };
  }).sort((a, b) => b.balancedValue - a.balancedValue || a.name.localeCompare(b.name));
  const top = packages[0];
  return {
    summary: top ? `${top.name} has the highest geometric balance of declared values; counterpart values are assumptions, not private knowledge.` : "No package rows were supplied.",
    metrics: [metric("balanced package value", top?.balancedValue ?? 0, "points", "square root of (our declared value × estimated counterpart value)", { reservationFloor: floor, interestCount: interests.length })],
    table: packages,
    claims: top ? [claim(`${top.name} leads the declared package comparison.`, "calculated", evidenceIds)] : [],
    warnings: packages.filter((item) => !item.acceptable).map((item) => `${item.name} is below the declared reservation floor.`).concat("Counterpart priorities and values must be reviewed; the system does not infer private motives."),
    method: "Transparent geometric balance and reservation-floor check; no persuasion, impersonation, outreach, or deception generation."
  };
}

function blueprint(fields, evidenceIds) {
  const components = new Set(lines(fields.components).map((line) => parts(line)[0]).filter(Boolean));
  const requirements = lines(fields.requirements).map((line) => {
    const [id, statement, rawComponents = ""] = parts(line);
    const mapped = rawComponents.split(",").map((item) => item.trim()).filter(Boolean);
    const unknown = mapped.filter((item) => !components.has(item));
    return { id, statement, components: mapped, traceable: mapped.length > 0 && unknown.length === 0, unknownComponents: unknown };
  });
  const traceable = requirements.filter((item) => item.traceable).length;
  const coverage = requirements.length ? traceable / requirements.length * 100 : 0;
  const used = new Set(requirements.flatMap((item) => item.components));
  const orphanComponents = [...components].filter((item) => !used.has(item));
  return {
    summary: `${traceable} of ${requirements.length} requirements map only to declared components.`,
    metrics: [metric("requirement traceability", round(coverage), "%", "requirements mapped to one or more declared components ÷ all requirements × 100", { requirementCount: requirements.length, componentCount: components.size })],
    table: requirements,
    claims: requirements.filter((item) => item.traceable).map((item) => claim(`${item.id} traces to ${item.components.join(", ")}.`, "calculated", evidenceIds)),
    warnings: requirements.flatMap((item) => item.unknownComponents.map((component) => `${item.id} references undeclared component ${component}.`)).concat(orphanComponents.map((item) => `${item} has no mapped requirement.`)),
    method: "Exact identifier matching between declared requirement mappings and component registry."
  };
}

function terrain(fields, evidenceIds, now) {
  const criteria = lines(fields.criteria).map((line) => { const [name, weight] = parts(line); return { name, weight: number(weight) }; });
  const weightTotal = criteria.reduce((sum, item) => sum + item.weight, 0);
  const candidates = lines(fields.candidates).map((line) => {
    const [name, ...rawScores] = parts(line);
    const scores = criteria.map((criterion, index) => ({ criterion: criterion.name, score: number(rawScores[index]), weight: criterion.weight }));
    const weighted = scores.reduce((sum, item) => sum + item.score * item.weight, 0);
    return { name, score: round(weightTotal ? weighted / weightTotal : 0), inputs: scores };
  }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const sourceMs = Date.parse(`${fields.sourceDate}T00:00:00Z`);
  const nowMs = Date.parse(now);
  const ageDays = Number.isFinite(sourceMs) && Number.isFinite(nowMs) ? Math.max(0, Math.floor((nowMs - sourceMs) / 86400000)) : null;
  return {
    summary: candidates[0] ? `${candidates[0].name} ranks first under the declared criteria; no public or live map data was fetched.` : "No candidate rows were supplied.",
    metrics: [metric("transparent site score", candidates[0]?.score ?? 0, "points", "sum(candidate criterion score × criterion weight) ÷ total weight", { weightTotal: round(weightTotal, 2), sourceAgeDays: ageDays })],
    table: candidates,
    claims: candidates[0] ? [claim(`${candidates[0].name} has the highest user-supplied weighted score.`, "calculated", evidenceIds)] : [],
    warnings: [weightTotal < 0.99 || weightTotal > 1.01 ? `Weights total ${round(weightTotal, 2)}, so scores were normalized.` : "Weights total 1.00.", ageDays == null ? "Source freshness could not be calculated." : ageDays > 90 ? `Newest declared source is ${ageDays} days old.` : `Newest declared source is ${ageDays} days old.`],
    method: "Normalized weighted sum over user-supplied candidate scores with explicit source-age calculation."
  };
}

function proof(fields, evidenceIds, now) {
  const records = lines(fields.evidence).map((line) => {
    const [stance, qualityValue, sourceId, date] = parts(line);
    const quality = Math.max(0, Math.min(1, number(qualityValue)));
    const ageDays = Math.max(0, Math.floor((Date.parse(now) - Date.parse(`${date}T00:00:00Z`)) / 86400000));
    return { stance, quality, sourceId, date, ageDays: Number.isFinite(ageDays) ? ageDays : null };
  });
  const support = records.filter((item) => item.stance === "support").reduce((sum, item) => sum + item.quality, 0);
  const oppose = records.filter((item) => item.stance === "oppose").reduce((sum, item) => sum + item.quality, 0);
  const denominator = support + oppose;
  const balance = denominator ? (support - oppose) / denominator * 100 : 0;
  const subclaims = lines(fields.subclaims);
  return {
    summary: `The declared evidence balance is ${round(balance)} points across ${records.length} records. This is not a truth verdict.`,
    metrics: [metric("weighted evidence balance", round(balance), "points", "100 × (support quality − opposing quality) ÷ (support quality + opposing quality)", { supportQuality: round(support, 2), opposingQuality: round(oppose, 2), subclaimCount: subclaims.length })],
    table: records,
    claims: subclaims.map((text) => claim(text, "user_claim", [...records.map((item) => item.sourceId), ...evidenceIds], true)),
    warnings: [fields.uncertaintyNote, ...records.filter((item) => item.ageDays != null && item.ageDays > 365).map((item) => `${item.sourceId} is more than one year old.`)].filter(Boolean),
    method: "Quality-weighted support-versus-oppose balance over user-entered provenance records; context records do not change the score."
  };
}

function loom(fields, evidenceIds) {
  const commitments = lines(fields.commitments).map((line) => { const [id, owner, dueDate, sourceId] = parts(line); return { id, owner, dueDate, sourceId }; });
  const known = new Set(commitments.map((item) => item.id));
  const dependencies = lines(fields.dependencies).map((line) => { const [upstream, downstream] = line.split(">").map((item) => item.trim()); return { upstream, downstream, valid: known.has(upstream) && known.has(downstream) }; });
  const contradictions = lines(fields.contradictions).map((line) => { const [left, right, reason] = parts(line); return { left, right, reason, traceable: known.has(left) && known.has(right) }; });
  const sourced = commitments.filter((item) => item.sourceId).length;
  const coverage = commitments.length ? sourced / commitments.length * 100 : 0;
  return {
    summary: `${commitments.length} commitments, ${dependencies.length} dependency edges, and ${contradictions.length} declared contradictions were mapped without editing source systems.`,
    metrics: [metric("traceable commitment coverage", round(coverage), "%", "commitments with a source ID ÷ all commitments × 100", { commitmentCount: commitments.length, dependencyCount: dependencies.length, contradictionCount: contradictions.length })],
    table: commitments.map((item) => ({ ...item, dependsOn: dependencies.filter((edge) => edge.downstream === item.id).map((edge) => edge.upstream) })),
    claims: commitments.map((item) => claim(`${item.id} is attributed to ${item.owner} with due date ${item.dueDate}.`, "source_fact", [item.sourceId, ...evidenceIds])),
    warnings: dependencies.filter((edge) => !edge.valid).map((edge) => `Unknown dependency endpoint: ${edge.upstream} > ${edge.downstream}.`).concat(contradictions.map((item) => `${item.left} conflicts with ${item.right}: ${item.reason}`)),
    method: "Exact commitment identifiers, directed dependency edges, source coverage, and user-declared contradiction preservation."
  };
}

function causal(fields, evidenceIds) {
  const controlRate = Math.max(0, Math.min(100, number(fields.baselineRate))) / 100;
  const treatmentRate = Math.max(0, Math.min(100, number(fields.treatmentRate))) / 100;
  const [controlNRaw, treatmentNRaw] = parts(fields.sampleSizes);
  const controlN = Math.max(1, Math.floor(number(controlNRaw, 1)));
  const treatmentN = Math.max(1, Math.floor(number(treatmentNRaw, 1)));
  const difference = (treatmentRate - controlRate) * 100;
  const standardError = Math.sqrt(controlRate * (1 - controlRate) / controlN + treatmentRate * (1 - treatmentRate) / treatmentN) * 100;
  const low = difference - 1.96 * standardError;
  const high = difference + 1.96 * standardError;
  return {
    summary: `The observed treatment-control difference is ${round(difference)} percentage points with an unadjusted 95% interval of ${round(low)} to ${round(high)} points; causality is not established by this calculation alone.`,
    metrics: [metric("observed absolute difference", round(difference), "percentage points", "treatment conversion percent − control conversion percent", { controlRatePercent: round(controlRate * 100), treatmentRatePercent: round(treatmentRate * 100), controlN, treatmentN, standardErrorPoints: round(standardError, 2) })],
    table: [{ arm: "control", ratePercent: round(controlRate * 100), n: controlN }, { arm: "treatment", ratePercent: round(treatmentRate * 100), n: treatmentN }],
    claims: [claim(`Observed difference: ${round(difference)} percentage points.`, "calculated", evidenceIds)],
    warnings: [fields.confounders ? `Declared confounders: ${fields.confounders}` : "No confounders were declared.", low <= 0 && high >= 0 ? "The unadjusted interval crosses zero." : "The unadjusted interval does not cross zero; design and confounding still require review."],
    method: "Difference in two user-entered proportions with independent Wald standard error. No randomization, balance, multiplicity, attrition, or causal identification claim is inferred."
  };
}

const CALCULATORS = { "phantom-oracle": oracle, "phantom-chronicle": chronicle, "phantom-foundry": foundry, "phantom-twin": twin, "phantom-dealroom": dealroom, "phantom-blueprint": blueprint, "phantom-terrain": terrain, "phantom-proof": proof, "phantom-loom-dependency": loom, "phantom-causal": causal };

export function analyzeProduct(productId, fields, evidenceIds = [], { now = "2026-08-17T00:00:00.000Z", path = "deterministic-domain-v1" } = {}) {
  const product = productById(productId);
  if (!product || !CALCULATORS[productId]) throw new Error(`No calculator registered for ${productId}.`);
  const output = CALCULATORS[productId](fields, evidenceIds, now);
  const complete = output && typeof output.summary === "string" && Array.isArray(output.metrics) && Array.isArray(output.table) && Array.isArray(output.claims) && Array.isArray(output.warnings) && typeof output.method === "string";
  if (!complete) throw new Error(`Calculator output failed schema validation for ${productId}.`);
  return {
    schemaVersion: 1,
    taskId: product.taskId,
    providerPath: path,
    model: null,
    externalModelUsed: false,
    sourceFieldsDigest: hash(JSON.stringify(fields)),
    generatedAt: now,
    cost: { usd: 0, inputTokens: 0, outputTokens: 0 },
    reviewRequired: true,
    coreLoop: buildCoreLoop(productId, fields),
    ...output
  };
}
