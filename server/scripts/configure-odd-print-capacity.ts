import { getPrintRuns, executePrintWorkflowCommand } from "../src/business-workspaces/print-runs.js";

// Explicit owner statements, October 27: P2S + P1S, 24 printing hours/day; 2 hands-on hours/day.
// This never changes printer hardware, creates commerce jobs or assumes a clear queue.
const current = await getPrintRuns("occasionally-odd");
const planning = current.workflow.planning;
if (planning.printers.length && !planning.printers.every(printer => ["p2s", "p1s"].includes(printer.id))) throw new Error("Existing printer planning has other identities. Preserve it and reconcile explicitly.");
const payload = { ...planning, printerId: null, printerLabel: "Bambu P2S and P1S", printerHoursPerDay: null,
  printers: [{ id: "p2s", label: "Bambu P2S", model: "P2S", hoursPerDay: 24 }, { id: "p1s", label: "Bambu P1S", model: "P1S", hoursPerDay: 24 }],
  finishingHoursPerDay: 2, workDays: [0, 1, 2, 3, 4, 5, 6], timeZone: "America/Chicago" as const };
if (process.argv.includes("--apply")) {
  await executePrintWorkflowCommand("occasionally-odd", { commandId: "owner-p2s-p1s-24h-20261027", expectedRevision: current.workflow.revision, type: "save-planning", payload }, "owner-confirmed-capacity");
}
console.log(JSON.stringify({ applied: process.argv.includes("--apply"), tenant: "occasionally-odd", printers: payload.printers, workDays: payload.workDays,
  manualQueueHours: payload.manualQueueHours, manualFinishingQueueHours: payload.manualFinishingQueueHours, finishingHoursPerDay: payload.finishingHoursPerDay, printerControl: false }, null, 2));
