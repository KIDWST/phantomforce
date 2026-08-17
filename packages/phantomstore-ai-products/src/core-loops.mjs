import { createHash } from "node:crypto";

const hash = (value) => createHash("sha256").update(String(value)).digest("hex");
const lines = (value) => String(value || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
const parts = (value) => String(value || "").split("|").map((item) => item.trim());
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const round = (value, places = 2) => Number(Number(value || 0).toFixed(places));

export class CoreLoopValidationError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = "CoreLoopValidationError"; this.code = code; this.details = details; }
}

export const CORE_LOOP_MODULES = Object.freeze({
  "phantom-oracle": ["Decision Canvas", "Assumption Ledger", "Scenario Graph", "Sensitivity Explorer", "Decision Journal", "Executive Brief Builder"],
  "phantom-chronicle": ["Evidence Intake", "Metadata Inspector", "Timeline Builder", "Contradiction Desk", "Source Provenance", "Chronology Report"],
  "phantom-foundry": ["Schema Studio", "Scenario Recipe Builder", "Generator Fleet", "Coverage Matrix", "Deduplication Lab", "Dataset Versioning", "Benchmark Runner", "Export Registry"],
  "phantom-twin": ["Process Mapper", "Resource Catalog", "Queue Simulator", "Capacity Planner", "Bottleneck Radar", "What-if Sandbox", "Twin Calibration", "Scenario Export"],
  "phantom-dealroom": ["Deal Map", "Interest Matrix", "BATNA Builder", "Concession Ladder", "Package Composer", "Counterpart Simulator", "Rehearsal Room", "Commitment Ledger", "Meeting Debrief"],
  "phantom-blueprint": ["Requirements Compiler", "Architecture Canvas", "Component Registry", "Data Contract Studio", "API Designer", "Test Blueprint", "Change Impact Graph", "Spec Exporter"],
  "phantom-terrain": ["Layer Catalog", "Site Scorer", "Constraint Overlay", "Candidate Compare", "Weight Sensitivity", "Data Freshness Monitor", "Export Composer"],
  "phantom-proof": ["Claim Decomposer", "Evidence Board", "Source Quality Lens", "Support/Oppose Matrix", "Citation Inspector", "Freshness Watch", "Circularity Detector", "Reviewer Workflow", "Proof Packet", "Export Studio"],
  "phantom-loom-dependency": ["Corpus Intake", "Commitment Extractor", "Dependency Graph", "Contradiction Radar", "Owner Map", "Deadline Mesh", "Change Impact", "Source Trace", "Revision Diff", "Dependency Brief"],
  "phantom-causal": ["Hypothesis Studio", "Causal DAG Builder", "Metric Registry", "Power Planner", "Pre-registration", "Analysis Notebook", "Sensitivity Checks", "Experiment Library", "Result Brief"]
});

function oracle(fields) {
  const reserve = Math.max(0, Math.min(100, number(fields.uncertainty))) / 100;
  const assumptions = lines(fields.assumptions).map((line) => { const [id, option, delta, sensitivity] = parts(line); return { id, option, deltaPoints: number(delta), sensitivity: Math.max(0, Math.min(1, number(sensitivity))) }; });
  const ranking = lines(fields.options).map((line) => {
    const [name, ...raw] = parts(line); const scores = raw.slice(0, 3).map((item) => number(item)); const mean = scores.reduce((sum, item) => sum + item, 0) / Math.max(1, scores.length); const spread = Math.max(...scores) - Math.min(...scores);
    const effects = assumptions.filter((item) => item.option === name).map((item) => ({ assumptionId: item.id, effect: round(item.deltaPoints * item.sensitivity) }));
    return { name, baseline: round(mean - spread * reserve), assumptionEffect: round(effects.reduce((sum, item) => sum + item.effect, 0)), effects };
  }).map((item) => ({ ...item, adjusted: round(item.baseline + item.assumptionEffect) })).sort((a, b) => b.adjusted - a.adjusted || a.name.localeCompare(b.name));
  const scenarioGraph = lines(fields.scenarioEdges).map((line) => { const [edge, relationship = "depends_on"] = parts(line); const [from, to] = edge.split(">").map((item) => item.trim()); return { from, to, relationship, valid: Boolean(from && to) }; });
  const highSensitivity = assumptions.filter((item) => item.sensitivity >= 0.7).sort((a, b) => Math.abs(b.deltaPoints * b.sensitivity) - Math.abs(a.deltaPoints * a.sensitivity));
  return { modules: CORE_LOOP_MODULES["phantom-oracle"], assumptionLedger: assumptions, scenarioGraph, ranking, sensitivity: { highSensitivity, explanation: highSensitivity.length ? `${highSensitivity[0].id} has the largest declared high-sensitivity effect.` : "No assumption is marked high sensitivity; rankings remain baseline-only." }, decisionRecord: { selectedOption: ranking[0]?.name || null, inputVersionDigest: hash(JSON.stringify(fields)), predictionClaim: false } };
}

function eventRow(line) {
  const values = parts(line); const modern = values.length >= 5;
  const [eventId, range, kind, statement, sourceId] = modern ? values : [`event-${hash(line).slice(0, 8)}`, values[0], values[1], values[2], values[3]];
  const [start, end = start] = String(range || "").split("..").map((item) => item.trim());
  return { eventId, start, end, kind, statement, sourceId, startMs: Date.parse(start), endMs: Date.parse(end) };
}
function chronicle(fields) {
  const events = lines(fields.events).map(eventRow).filter((item) => Number.isFinite(item.startMs)).sort((a, b) => a.startMs - b.startMs || a.eventId.localeCompare(b.eventId));
  const sources = [...new Map(events.map((event) => [event.sourceId, { id: event.sourceId, referenceDigest: hash(event.sourceId), eventCount: events.filter((item) => item.sourceId === event.sourceId).length }])).values()];
  const automatic = [];
  for (const [eventId, variants] of Map.groupBy(events, (event) => event.eventId)) if (new Set(variants.map((item) => `${item.start}|${item.end}`)).size > 1) automatic.push({ eventId, kind: "conflicting_time", variants: variants.map((item) => ({ sourceId: item.sourceId, start: item.start, end: item.end })), resolved: false });
  const declared = lines(fields.contradictions).map((line) => { const [sourceA, sourceB, issue] = parts(line); return { kind: "declared", sourceA, sourceB, issue, resolved: false }; });
  return { modules: CORE_LOOP_MODULES["phantom-chronicle"], metadata: sources, timeline: events.map(({ startMs, endMs, ...event }) => ({ ...event, assertionType: event.kind === "observed" ? "source_fact" : "inference" })), contradictions: [...automatic, ...declared], duplicateSources: sources.filter((source) => source.eventCount > 1), export: { format: "source-linked-chronology-v1", preservesAllConflictingTimes: true, liabilityConclusion: null } };
}

function foundry(fields) {
  const taxonomy = [...new Set(lines(fields.taxonomy).map((item) => item.toLowerCase()))]; const count = Math.max(1, Math.min(20, Math.floor(number(fields.examplesPerClass, 1)))); const seed = String(fields.seed || "phantom-foundry-seed-1");
  const fixtures = taxonomy.flatMap((label) => Array.from({ length: count }, (_, index) => { const digest = hash(`${seed}|${label}|${index}`); return { id: `syn-${digest.slice(0, 12)}`, label, input: `synthetic:${label}:${digest.slice(12, 24)}`, expected: label, synthetic: true, digest }; }));
  const unique = [...new Map(fixtures.map((fixture) => [fixture.digest, fixture])).values()]; const recipeVersion = hash(JSON.stringify({ seed, taxonomy, count, hardCasePercent: number(fields.hardCasePercent), recipe: fields.scenarioRecipe || "" }));
  return { modules: CORE_LOOP_MODULES["phantom-foundry"], recipe: { version: recipeVersion, seed, schema: fields.schemaDefinition || "label:string,input:string,expected:string,synthetic:boolean", taxonomy, examplesPerClass: count }, fixtures: unique, coverageMatrix: taxonomy.map((label) => ({ label, generated: unique.filter((item) => item.label === label).length, target: count })), deduplication: { inputCount: fixtures.length, outputCount: unique.length, removed: fixtures.length - unique.length }, benchmark: { datasetVersion: `dataset-${recipeVersion.slice(0, 12)}`, resultDigest: hash(unique.map((item) => item.digest).join("|")), immutable: true, groundTruthClaim: false }, export: { syntheticLabelRequired: true, fixtureDigest: hash(JSON.stringify(unique)) } };
}

function twin(fields) {
  const demand = Math.max(0, number(fields.demandPerHour)); const steps = lines(fields.steps).map((line) => { const [name, minutesRaw, workersRaw] = parts(line); const minutes = Math.max(0.1, number(minutesRaw, 0.1)); const workers = Math.max(1, Math.floor(number(workersRaw, 1))); const capacity = workers * 60 / minutes; const utilization = demand / capacity; return { name, minutesPerItem: minutes, workers, capacityItemsPerHour: round(capacity), utilizationPercent: round(utilization * 100), modeledQueueAfterOneHour: round(Math.max(0, demand - capacity)), overloaded: utilization >= 1 }; });
  const compare = (multiplier) => steps.map((step) => ({ step: step.name, demandItemsPerHour: round(demand * multiplier), utilizationPercent: round(demand * multiplier / step.capacityItemsPerHour * 100), overloadItemsPerHour: round(Math.max(0, demand * multiplier - step.capacityItemsPerHour)) }));
  return { modules: CORE_LOOP_MODULES["phantom-twin"], resources: steps.map((step) => ({ step: step.name, workers: step.workers })), queues: steps, simulation: { kind: "deterministic_fluid_queue", seed: String(fields.seed || "twin-seed-1"), units: { arrival: "items/hour", service: "items/hour", time: "minutes" }, baseline: compare(1), demandPlus20Percent: compare(1.2) }, bottlenecks: steps.filter((step) => step.overloaded), calibration: { state: fields.observedCalibration ? "observed_reference_supplied" : "modeled_only", note: fields.observedCalibration || "No observed calibration series supplied." }, export: { fakePrecision: false } };
}

function dealroom(fields) {
  const interests = lines(fields.interests).map((line) => { const [name, ours, theirs] = parts(line); return { interest: name, ourPriority: number(ours), counterpartPriority: number(theirs), counterpartValueKind: "speculative_assumption" }; });
  const concessions = lines(fields.concessionLadder).map((line) => { const [order, offer, condition] = parts(line); return { order: number(order), offer, condition, requiresHumanApproval: true }; }).sort((a, b) => a.order - b.order);
  const commitments = lines(fields.commitments).map((line) => { const [status, statement, owner, sourceId] = parts(line); const confirmed = status.toLowerCase() === "confirmed"; return { statement, owner: confirmed ? owner : null, proposedOwner: confirmed ? null : owner, sourceId: confirmed ? sourceId : null, proposedSourceId: confirmed ? null : sourceId, status: confirmed ? "confirmed_by_human" : "proposed", fact: confirmed }; });
  return { modules: CORE_LOOP_MODULES["phantom-dealroom"], parties: lines(fields.parties), interests, batna: lines(fields.batna), constraints: lines(fields.constraints), concessionLadder: concessions, packageComparison: lines(fields.packages).map((line) => { const [name, ours, theirs] = parts(line); return { name, ourValue: number(ours), counterpartEstimate: number(theirs), counterpartValueKind: "speculative_assumption" }; }), rehearsal: { kind: "bounded_scripted_local", prompt: "Ask which declared interest the package addresses; do not infer motives, deceive, coerce, impersonate, or contact anyone." }, commitmentLedger: commitments, export: { secretRecording: false, commitmentsRequireHumanConfirmation: true } };
}

function requirementRows(value) { return lines(value).map((line) => { const [id, statement, raw = ""] = parts(line); return { id, statement, components: raw.split(",").map((item) => item.trim()).filter(Boolean) }; }); }
function blueprint(fields) {
  const requirements = requirementRows(fields.requirements); const previous = new Map(requirementRows(fields.previousRequirements).map((item) => [item.id, item]));
  const components = lines(fields.components).map((line) => { const [id, responsibility] = parts(line); return { id, responsibility }; }); const known = new Set(components.map((item) => item.id));
  const acceptance = lines(fields.acceptanceCriteria).map((line) => { const [requirementId, criterion] = parts(line); return { requirementId, criterion, validRequirement: requirements.some((item) => item.id === requirementId) }; });
  const changed = requirements.filter((item) => { const old = previous.get(item.id); return old && JSON.stringify(old) !== JSON.stringify(item); }); const orphan = requirements.filter((item) => !item.components.length || item.components.some((id) => !known.has(id)));
  const impactedComponents = [...new Set(changed.flatMap((item) => item.components))]; const impactedTests = changed.map((item) => `TEST-${item.id}`);
  const paths = Object.fromEntries(requirements.map((item) => [`/requirements/${encodeURIComponent(item.id)}`, { get: { operationId: `inspect_${item.id.replace(/\W/g, "_")}`, responses: { 200: { description: item.statement } } } }]));
  return { modules: CORE_LOOP_MODULES["phantom-blueprint"], requirementsRegistry: requirements, acceptanceCriteria: acceptance, componentMap: components, dataContracts: lines(fields.dataContracts), apiContract: { openapi: "3.1.0", info: { title: fields.system, version: "1.0.0" }, paths, validation: { valid: requirements.every((item) => Boolean(item.id && item.statement)), format: "openapi_3_1_subset" } }, traceability: requirements.map((item) => ({ requirementId: item.id, componentIds: item.components, testIds: [`TEST-${item.id}`] })), changeImpact: { changedRequirements: changed.map((item) => item.id), affectedComponents: impactedComponents, affectedTests: impactedTests }, orphanRequirements: orphan.map((item) => item.id), export: { stableIds: true, silentDeletion: false } };
}

function terrainScore(fields, criteriaOverride = null) {
  const criteria = criteriaOverride || lines(fields.criteria).map((line) => { const [name, weight] = parts(line); return { name, weight: number(weight) }; }); const total = criteria.reduce((sum, item) => sum + item.weight, 0);
  return lines(fields.candidates).map((line) => { const [name, ...values] = parts(line); const score = criteria.reduce((sum, item, index) => sum + number(values[index]) * item.weight, 0) / Math.max(total, 1e-9); return { name, score: round(score) }; }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}
function terrain(fields) {
  const criteria = lines(fields.criteria).map((line) => { const [name, weight] = parts(line); return { name, weight: number(weight) }; }); const baseline = terrainScore(fields, criteria);
  const sensitivity = criteria.map((criterion, index) => { const adjusted = criteria.map((item, itemIndex) => ({ ...item, weight: itemIndex === index ? item.weight * 1.25 : item.weight })); const ranking = terrainScore(fields, adjusted); return { criterion: criterion.name, increasedByPercent: 25, ranking: ranking.map((item) => item.name), leaderChanged: ranking[0]?.name !== baseline[0]?.name }; });
  const constraints = lines(fields.constraints).map((line) => { const [candidate, constraint, state = "declared"] = parts(line); return { candidate, constraint, state }; });
  const features = lines(fields.candidateCoordinates).map((line) => { const [name, longitude, latitude] = parts(line); return { type: "Feature", properties: { name }, geometry: { type: "Point", coordinates: [number(longitude), number(latitude)] } }; });
  return { modules: CORE_LOOP_MODULES["phantom-terrain"], candidateSites: baseline, normalizedWeights: criteria.map((item) => ({ ...item, normalized: round(item.weight / Math.max(criteria.reduce((sum, row) => sum + row.weight, 0), 1e-9), 4) })), constraints, sensitivity, freshness: { newestSourceDate: fields.sourceDate, visible: true }, geojson: { type: "FeatureCollection", features }, export: { individualTracking: false, militaryTargeting: false, liveDataFetched: false } };
}

function sourceRegistry(fields) { return lines(fields.sourceRegistry).map((line) => { const [id, reference, date, quality] = parts(line); return { id, reference, date, quality: number(quality), referenceDigest: hash(reference) }; }); }
export function validateCoreFields(productId, fields) {
  if (productId !== "phantom-proof") return;
  const sources = sourceRegistry(fields); if (!sources.length) return;
  const known = new Set(sources.map((source) => source.id)); const missing = lines(fields.evidence).map((line) => parts(line)[2]).filter((id) => id && !known.has(id));
  if (missing.length) throw new CoreLoopValidationError("SOURCE_REFERENCE_NOT_FOUND", "Every proof evidence record must reference an existing source registry entry.", { sourceIds: [...new Set(missing)] });
}
function proof(fields) {
  validateCoreFields("phantom-proof", fields); const sources = sourceRegistry(fields); const evidence = lines(fields.evidence).map((line) => { const [classification, quality, sourceId, date] = parts(line); return { classification, quality: number(quality), sourceId, date, contradictory: classification === "oppose" }; });
  const edges = lines(fields.citations).map((line) => { const [from, to] = line.split(">").map((item) => item.trim()); return { from, to }; });
  const graph = new Map(); for (const edge of edges) graph.set(edge.from, [...(graph.get(edge.from) || []), edge.to]);
  const circular = new Set(); const visit = (node, path = []) => { if (path.includes(node)) { path.slice(path.indexOf(node)).forEach((item) => circular.add(item)); return; } for (const next of graph.get(node) || []) visit(next, [...path, node]); }; for (const node of graph.keys()) visit(node);
  return { modules: CORE_LOOP_MODULES["phantom-proof"], claim: fields.claim, atomicSubclaims: lines(fields.subclaims), evidenceBoard: evidence, sourceQuality: sources, classifications: Object.fromEntries(["support", "oppose", "context", "uncertain"].map((kind) => [kind, evidence.filter((item) => item.classification === kind).length])), citationIntegrity: { allReferencesExist: !sources.length || evidence.every((item) => sources.some((source) => source.id === item.sourceId)), circularSourceIds: [...circular] }, proofPacket: { truthVerdict: null, contradictoryEvidencePreserved: evidence.some((item) => item.classification === "oppose"), uncertainty: fields.uncertaintyNote }, export: { citationsFabricated: false } };
}

function loom(fields) {
  const commitments = lines(fields.commitments).map((line) => { const [id, owner, dueDate, sourceId] = parts(line); return { id, owner, dueDate, sourceId }; }); const known = new Set(commitments.map((item) => item.id));
  const dependencies = lines(fields.dependencies).map((line) => { const [edge, kind = "inferred"] = parts(line); const [upstream, downstream] = edge.split(">").map((item) => item.trim()); return { upstream, downstream, kind: kind === "confirmed" ? "confirmed" : "inferred", valid: known.has(upstream) && known.has(downstream) }; });
  const statements = new Map(lines(fields.sourceStatements).map((line) => { const [sourceId, revision, statement] = parts(line); return [sourceId, { sourceId, revision, statement, digest: hash(statement) }]; }));
  const previous = new Map(lines(fields.previousSourceStatements).map((line) => { const [sourceId, revision, statement] = parts(line); return [sourceId, { sourceId, revision, statement, digest: hash(statement) }]; }));
  const changedSources = [...statements.values()].filter((item) => previous.has(item.sourceId) && previous.get(item.sourceId).digest !== item.digest).map((item) => item.sourceId); const directStale = commitments.filter((item) => changedSources.includes(item.sourceId)).map((item) => item.id); const stale = new Set(directStale);
  let progressed = true; while (progressed) { progressed = false; for (const edge of dependencies) if (stale.has(edge.upstream) && !stale.has(edge.downstream)) { stale.add(edge.downstream); progressed = true; } }
  return { modules: CORE_LOOP_MODULES["phantom-loom-dependency"], statements: [...statements.values()], commitmentRegistry: commitments, dependencyGraph: dependencies, contradictions: lines(fields.contradictions).map((line) => { const [left, right, reason] = parts(line); return { left, right, reason, revisionAware: true }; }), ownerDeadlineMap: commitments.map(({ id, owner, dueDate }) => ({ id, owner, dueDate, invented: false })), changeImpact: { changedSources, staleCommitmentIds: [...stale] }, export: { format: "dependency-brief-v1", storeNameDecision: "unresolved", internalKey: "phantom-loom-dependency" } };
}

function causal(fields) {
  const control = Math.max(0, Math.min(100, number(fields.baselineRate))) / 100; const treatment = Math.max(0, Math.min(100, number(fields.treatmentRate))) / 100; const delta = Math.abs(treatment - control); const pooled = (control + treatment) / 2;
  const zAlpha = 1.96; const zPower = 0.84; const perArm = delta > 0 ? Math.ceil(2 * pooled * (1 - pooled) * (zAlpha + zPower) ** 2 / delta ** 2) : null; const design = ["randomized", "observational"].includes(fields.designType) ? fields.designType : "observational";
  return { modules: CORE_LOOP_MODULES["phantom-causal"], hypothesis: fields.hypothesis, variables: lines(fields.variables).map((line) => { const [name, role] = parts(line); return { name, role }; }), dag: lines(fields.dagEdges).map((line) => { const [from, to] = line.split(">").map((item) => item.trim()); return { from, to }; }), confounderWarnings: lines(fields.confounders), metricRegistry: [{ id: "conversion", unit: "%", control: round(control * 100), treatment: round(treatment * 100) }], powerHelper: { assumptions: { alpha: 0.05, targetPower: 0.8, twoSided: true, pooledRate: round(pooled, 4), minimumDetectableDifference: round(delta, 4) }, estimatedPerArm: perArm, method: "unadjusted normal approximation" }, resultFixture: { design, observedDifferencePercentagePoints: round((treatment - control) * 100), provenCausality: false, conclusion: design === "observational" ? "Observed correlation is not proven causality." : "Randomization supports identification only if assignment, attrition, interference, measurement, and protocol assumptions survive review." }, export: { medicalTrialClaim: false, uncertaintyRetained: true } };
}

const BUILDERS = { "phantom-oracle": oracle, "phantom-chronicle": chronicle, "phantom-foundry": foundry, "phantom-twin": twin, "phantom-dealroom": dealroom, "phantom-blueprint": blueprint, "phantom-terrain": terrain, "phantom-proof": proof, "phantom-loom-dependency": loom, "phantom-causal": causal };

export function buildCoreLoop(productId, fields) {
  const builder = BUILDERS[productId]; if (!builder) throw new CoreLoopValidationError("CORE_LOOP_NOT_FOUND", `No Milestone 2 core loop exists for ${productId}.`);
  const result = builder(fields); return { schemaVersion: 1, productId, deterministic: true, externalProviderUsed: false, ...result };
}
