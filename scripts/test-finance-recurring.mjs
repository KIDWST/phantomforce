import assert from "node:assert/strict";
import { generateDueOccurrences, RECURRING_OCCURRENCE_CAP } from "../app/js/finance-recurring.js";

// Weekly: 4 clean occurrences inclusive of start and end
{
  const rule = { frequency: "weekly", intervalDays: null, startDate: "2026-01-01", endDate: null, lastGeneratedDate: null, status: "active" };
  const result = generateDueOccurrences(rule, "2026-01-22");
  assert.deepEqual(result.occurrences.map((o) => o.date), ["2026-01-01", "2026-01-08", "2026-01-15", "2026-01-22"]);
  assert.equal(result.nextLastGeneratedDate, "2026-01-22");
  assert.equal(result.capped, false);
}

// Monthly with day-of-month clamping: 31st anchor through Jan-Apr, Feb has 28 days in 2026
{
  const rule = { frequency: "monthly", intervalDays: null, startDate: "2026-01-31", endDate: null, lastGeneratedDate: null, status: "active" };
  const result = generateDueOccurrences(rule, "2026-04-30");
  assert.deepEqual(result.occurrences.map((o) => o.date), ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  assert.equal(result.nextLastGeneratedDate, "2026-04-30");
}

// Resuming from a lastGeneratedDate should not repeat past occurrences
{
  const rule = { frequency: "weekly", intervalDays: null, startDate: "2026-01-01", endDate: null, lastGeneratedDate: "2026-01-08", status: "active" };
  const result = generateDueOccurrences(rule, "2026-01-22");
  assert.deepEqual(result.occurrences.map((o) => o.date), ["2026-01-15", "2026-01-22"]);
}

// endDate stops generation even if asOfISODate is later
{
  const rule = { frequency: "weekly", intervalDays: null, startDate: "2026-01-01", endDate: "2026-02-01", lastGeneratedDate: null, status: "active" };
  const result = generateDueOccurrences(rule, "2026-04-01");
  assert.deepEqual(result.occurrences.map((o) => o.date), ["2026-01-01", "2026-01-08", "2026-01-15", "2026-01-22", "2026-01-29"]);
  assert.equal(result.nextLastGeneratedDate, "2026-01-29");
}

// Paused rule generates nothing
{
  const rule = { frequency: "weekly", intervalDays: null, startDate: "2026-01-01", endDate: null, lastGeneratedDate: null, status: "paused" };
  const result = generateDueOccurrences(rule, "2026-06-01");
  assert.deepEqual(result.occurrences, []);
  assert.equal(result.nextLastGeneratedDate, null);
}

// Custom-days (e.g. "every other day") respects intervalDays and the cap
{
  const rule = { frequency: "custom-days", intervalDays: 1, startDate: "2020-01-01", endDate: null, lastGeneratedDate: null, status: "active" };
  const result = generateDueOccurrences(rule, "2026-01-01");
  assert.equal(result.occurrences.length, RECURRING_OCCURRENCE_CAP);
  assert.equal(result.capped, true);
}

console.log(JSON.stringify({ ok: true, suite: "finance-recurring" }));
