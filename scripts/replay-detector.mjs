#!/usr/bin/env node
// Replay a captured training session (JSONL from training/captures/**) through
// the CURRENT detector code and report where classification has drifted since
// capture time. This is how a rule change gets checked as an actual
// improvement rather than assumed.
//
// Usage: node scripts/replay-detector.mjs <fixture.jsonl> [detectorKey]
import { readFileSync } from "node:fs";
import path from "node:path";

import { createDetector } from "../detect/index.js";

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/replay-detector.mjs <fixture.jsonl> [detectorKey]");
  process.exit(1);
}

const lines = readFileSync(path.resolve(file), "utf8")
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));

if (lines.length === 0) {
  console.error("no capture lines found in", file);
  process.exit(1);
}

const detectorKey = process.argv[3] ?? lines[0].provider ?? null;
const detector = createDetector({ detector: detectorKey });

let matches = 0;
let mismatches = 0;

for (const rec of lines) {
  detector.feed(rec.raw);
  const result = detector.evaluate();
  if (result.state === rec.state) {
    matches += 1;
    continue;
  }
  mismatches += 1;
  console.log(`[CHANGED] recorded "${rec.state}" -> now "${result.state}" (rule: ${result.ruleId ?? "none"})`);
  console.log(`  raw: ${JSON.stringify(rec.raw.slice(0, 120))}`);
}

console.log(`\n${lines.length} recorded ticks — ${matches} unchanged, ${mismatches} changed.`);
process.exit(0);
