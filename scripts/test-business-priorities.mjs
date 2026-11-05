import assert from "node:assert/strict";
import { businessDay, workPriority, compareWorkPriority } from "../app/js/business-priorities.js";
const today = "2026-11-05";
assert.equal(businessDay(new Date(2026, 10, 5, 23, 59)), today);
assert.equal(workPriority({ due: today, status: "open" }, today).today, true);
assert.equal(workPriority({ due: "2026-11-04T00:00:00Z", status: "review" }, today).overdue, true);
for (const status of ["complete", "retired", "shipped", "cancelled"]) {
  const result = workPriority({ due: "2020-01-01", status }, today);
  assert.equal(result.open, false); assert.equal(result.overdue, false);
}
for (const due of ["", "bad date", "2026-02-30", "2026-13-01"]) {
  assert.equal(workPriority({ due, status: "open" }, today).unscheduled, true);
}
const rows = [
  { id: "no-date", status: "open" }, { id: "future", due: "2026-11-06", status: "open" },
  { id: "review", status: "review" }, { id: "today", due: today, status: "open" },
  { id: "late", due: "2026-11-04", status: "open" }, { id: "done", due: "2020-01-01", status: "shipped" },
];
assert.deepEqual(rows.sort((a, b) => compareWorkPriority(a, b, today)).map(row => row.id), ["late", "today", "review", "future", "no-date", "done"]);
console.log("Business priorities: calendar dates, invalid dates, closed work and urgency ordering passed.");
