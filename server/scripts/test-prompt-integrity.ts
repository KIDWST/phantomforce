import assert from "node:assert/strict";

import {
  MAX_PROMPT_CHARS,
  buildPromptIntegrityEnvelope,
  verifyPromptIntegrity,
} from "../src/phantom-ai/prompt-integrity.js";
import { planningPrompt } from "../src/phantom-ai/hermes-acp-operator.js";

const beginning = "# PHANTOM V1 - THE BLACKOUT PROTOCOL";
const middle = "MIDDLE_SENTINEL: preserve Unicode boundaries: power-grid \u26a1 \ud83e\udde0";
const final = "FINAL_INSTRUCTION: create the project, run tests, and report exact evidence.";
const prompt = [
  beginning,
  "",
  "Build a new offline browser application. Do not request repository files that do not exist.",
  ...Array.from({ length: 1200 }, (_, index) => `Requirement ${index + 1}: preserve deterministic behavior and verify output ${index + 1}.`),
  middle,
  ...Array.from({ length: 800 }, (_, index) => `Acceptance ${index + 1}: later requirements must remain visible ${index + 1}.`),
  final,
].join("\n");

const envelope = buildPromptIntegrityEnvelope(prompt, {
  messageId: "blackout-fixture",
  conversationId: "golden-evaluation",
  clientVersion: "test-client",
  createdAt: "2026-07-29T00:00:00.000Z",
});
const verified = verifyPromptIntegrity(prompt, envelope);
assert.equal(verified.ok, true);
if (verified.ok) {
  assert.equal(verified.state, "complete");
  assert.equal(verified.envelope.full_sha256, envelope.full_sha256);
  assert(envelope.segment_count > 1);
}

const tampered = verifyPromptIntegrity(`${prompt}\nTAMPERED`, envelope);
assert.equal(tampered.ok, false);
if (!tampered.ok) assert.equal(tampered.state, "hash_mismatch");

const missing = verifyPromptIntegrity(prompt, undefined);
assert.equal(missing.ok, false);
if (!missing.ok) assert.equal(missing.state, "incomplete");

const oversizedText = "x".repeat(MAX_PROMPT_CHARS + 1);
const oversized = verifyPromptIntegrity(
  oversizedText,
  buildPromptIntegrityEnvelope(oversizedText, {
    messageId: "oversized",
    conversationId: "golden-evaluation",
  }),
);
assert.equal(oversized.ok, false);
if (!oversized.ok) assert.equal(oversized.state, "rejected");

const operatorPrompt = planningPrompt(prompt, "fixture-workspace");
assert(operatorPrompt.includes(beginning));
assert(operatorPrompt.includes(middle));
assert(operatorPrompt.endsWith(final));
assert(operatorPrompt.includes("\n\nBuild a new offline browser application."));
assert.match(operatorPrompt, /new project, choose a reasonable structure/i);
assert.match(operatorPrompt, /requirement ledger/i);
assert.doesNotMatch(operatorPrompt, /cannot execute code|cannot access file/i);

console.log(JSON.stringify({
  ok: true,
  characters: prompt.length,
  bytes: envelope.byte_length,
  lines: envelope.line_count,
  segments: envelope.segment_count,
  sha256: envelope.full_sha256,
  beginningPreserved: true,
  middlePreserved: true,
  finalInstructionPreserved: true,
  tamperRejected: true,
  oversizedRejected: true,
}, null, 2));
