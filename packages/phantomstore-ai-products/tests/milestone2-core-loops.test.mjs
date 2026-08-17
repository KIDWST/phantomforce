import test from "node:test";
import assert from "node:assert/strict";
import { PRODUCTS } from "../src/catalog.mjs";
import { analyzeProduct } from "../src/calculators.mjs";

const product = (id) => PRODUCTS.find((item) => item.id === id);
const analyze = (id, fields) => analyzeProduct(id, fields, ["fixture-source"]).coreLoop;

test("ORACLE high-sensitivity assumption change recalculates and changes the ranked decision", () => {
  const item = product("phantom-oracle"); const before = analyze(item.id, item.sample); const after = analyze(item.id, { ...item.sample, assumptions: "A1 | Single hub | 30 | 1\nA2 | Dual source | -20 | 1" });
  assert.equal(before.ranking[0].name, "Dual source"); assert.equal(after.ranking[0].name, "Single hub"); assert.ok(after.sensitivity.highSensitivity.length); assert.equal(after.decisionRecord.predictionClaim, false);
});

test("CHRONICLE preserves conflicting event times and never chooses one as liability fact", () => {
  const item = product("phantom-chronicle"); const loop = analyze(item.id, item.sample); const arrival = loop.timeline.filter((event) => event.eventId === "ARRIVAL");
  assert.equal(arrival.length, 2); assert.ok(loop.contradictions.some((item) => item.kind === "conflicting_time" && item.resolved === false)); assert.equal(loop.export.liabilityConclusion, null); assert.ok(loop.timeline.some((event) => event.assertionType === "inference"));
});

test("FOUNDRY produces stable labeled synthetic fixtures and immutable benchmark digest for the same seed", () => {
  const item = product("phantom-foundry"); const first = analyze(item.id, item.sample); const second = analyze(item.id, item.sample);
  assert.equal(first.export.fixtureDigest, second.export.fixtureDigest); assert.equal(first.benchmark.resultDigest, second.benchmark.resultDigest); assert.ok(first.fixtures.every((fixture) => fixture.synthetic)); assert.equal(first.benchmark.groundTruthClaim, false); assert.equal(first.deduplication.removed, 0);
});

test("TWIN reacts to demand beyond service capacity with queue depth and bottleneck warnings", () => {
  const item = product("phantom-twin"); const baseline = analyze(item.id, item.sample); const overloaded = analyze(item.id, { ...item.sample, demandPerHour: "25" });
  assert.equal(baseline.bottlenecks.length, 0); assert.ok(overloaded.bottlenecks.length >= 2); assert.ok(overloaded.queues.some((step) => step.modeledQueueAfterOneHour > 0)); assert.equal(overloaded.simulation.units.arrival, "items/hour");
});

test("DEALROOM never promotes speculative counterpart preference to confirmed fact", () => {
  const item = product("phantom-dealroom"); const loop = analyze(item.id, item.sample); const speculative = loop.commitmentLedger.find((entry) => entry.status === "proposed"); const confirmed = loop.commitmentLedger.find((entry) => entry.status === "confirmed_by_human");
  assert.equal(speculative.fact, false); assert.equal(speculative.owner, null); assert.equal(speculative.sourceId, null); assert.equal(confirmed.fact, true); assert.equal(loop.export.commitmentsRequireHumanConfirmation, true);
});

test("BLUEPRINT change impact identifies affected components and tests without deleting stable IDs", () => {
  const item = product("phantom-blueprint"); const loop = analyze(item.id, item.sample);
  assert.deepEqual(loop.changeImpact.changedRequirements, ["REQ-1"]); assert.ok(loop.changeImpact.affectedComponents.includes("API")); assert.ok(loop.changeImpact.affectedTests.includes("TEST-REQ-1")); assert.equal(loop.apiContract.validation.valid, true); assert.equal(loop.export.silentDeletion, false);
});

test("TERRAIN weight changes recalculate scores, ranking, and sensitivity explanation", () => {
  const item = product("phantom-terrain"); const baseline = analyze(item.id, item.sample); const changed = analyze(item.id, { ...item.sample, criteria: "Access | 0.05\nResilience | 0.70\nOperating fit | 0.25" });
  assert.equal(baseline.candidateSites[0].name, "North yard"); assert.equal(changed.candidateSites[0].name, "West retrofit"); assert.notEqual(baseline.candidateSites[0].score, changed.candidateSites[0].score); assert.ok(changed.sensitivity.every((item) => Array.isArray(item.ranking))); assert.equal(changed.export.liveDataFetched, false);
});

test("PROOF preserves opposing evidence and verifies citation references without a truth score", () => {
  const item = product("phantom-proof"); const loop = analyze(item.id, item.sample);
  assert.ok(loop.evidenceBoard.some((entry) => entry.classification === "oppose")); assert.equal(loop.citationIntegrity.allReferencesExist, true); assert.equal(loop.proofPacket.truthVerdict, null); assert.equal(loop.proofPacket.contradictoryEvidencePreserved, true);
});

test("LOOM source revision change traverses to dependent commitments and preserves inferred distinction", () => {
  const item = product("phantom-loom-dependency"); const loop = analyze(item.id, item.sample);
  assert.deepEqual(loop.changeImpact.changedSources, ["spec-4"]); assert.ok(loop.changeImpact.staleCommitmentIds.includes("C1")); assert.ok(loop.changeImpact.staleCommitmentIds.includes("C2")); assert.ok(loop.dependencyGraph.some((edge) => edge.kind === "inferred")); assert.equal(loop.export.storeNameDecision, "unresolved");
});

test("CAUSAL observational correlation is explicitly refused as proven causality", () => {
  const item = product("phantom-causal"); const loop = analyze(item.id, item.sample);
  assert.equal(loop.resultFixture.design, "observational"); assert.equal(loop.resultFixture.provenCausality, false); assert.match(loop.resultFixture.conclusion, /not proven causality/i); assert.ok(loop.powerHelper.estimatedPerArm > 0); assert.equal(loop.export.medicalTrialClaim, false);
});
