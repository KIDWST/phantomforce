import { createHash } from "node:crypto";

export const BAMBU_STATUS_MAX_BYTES = 128 * 1024;
export type BambuJobStatus = {
  taskId: string | null; subtaskId: string | null; name: string | null;
  state: "preparing" | "printing" | "paused" | "completed" | "failed" | "idle" | "unknown";
  progress: number | null; remainingMinutes: number | null; observedAt: string;
};
export type BambuObservation = {
  printerId: string; taskId: string; subtaskId?: string; eventId: string;
  state: "printing" | "completed" | "failed"; observedAt: string;
};
const stateNames: Record<string, BambuJobStatus["state"]> = { PREPARE: "preparing", SLICING: "preparing", RUNNING: "printing", PAUSE: "paused", FINISH: "completed", FAILED: "failed", IDLE: "idle" };
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
function identifier(value: unknown) {
  const text = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : typeof value === "string" ? value.trim() : "";
  return text && !["0", "-1"].includes(text) && /^[A-Za-z0-9_.-]{1,180}$/.test(text) ? text : null;
}
function label(value: unknown) { return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 240) || null : null; }
function number(value: unknown, maximum: number) { return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= maximum ? value : null; }

/** Merge whitelisted MQTT deltas only. File names, percentages and elapsed estimates never establish task identity or completion. */
export function normalizeBambuStatus(payload: Uint8Array | string, previous: BambuJobStatus | null, observedAt = new Date().toISOString()): BambuJobStatus | null {
  if (!Number.isFinite(Date.parse(observedAt))) throw new Error("Invalid printer observation time.");
  const text = typeof payload === "string" ? payload : Buffer.from(payload).toString("utf8");
  if (Buffer.byteLength(text) > BAMBU_STATUS_MAX_BYTES) throw new Error("Printer status exceeds the supported size.");
  let raw: unknown; try { raw = JSON.parse(text); } catch { throw new Error("Printer status is not valid JSON."); }
  if (!record(raw) || !record(raw.print)) return null;
  const value = raw.print;
  if (!["gcode_state", "task_id", "subtask_id", "subtask_name", "mc_percent", "mc_remaining_time"].some(key => Object.hasOwn(value, key))) return null;
  const suppliedTask = Object.hasOwn(value, "task_id"), suppliedSubtask = Object.hasOwn(value, "subtask_id");
  const taskId = suppliedTask ? identifier(value.task_id) : previous?.taskId || null;
  const subtaskId = suppliedSubtask ? identifier(value.subtask_id) : previous?.subtaskId || null;
  const changed = !!previous && ((suppliedTask && taskId !== previous.taskId) || (suppliedSubtask && subtaskId !== previous.subtaskId));
  const base = changed ? null : previous;
  const explicitState = typeof value.gcode_state === "string" ? stateNames[value.gcode_state] || "unknown" : undefined;
  // A changed main task cannot inherit the old task's subtask identity.
  const actualSubtask = changed && suppliedTask && taskId !== previous?.taskId && !suppliedSubtask ? null : subtaskId;
  return {
    taskId, subtaskId: actualSubtask,
    name: Object.hasOwn(value, "subtask_name") ? label(value.subtask_name) : base?.name || null,
    state: explicitState ?? base?.state ?? "unknown",
    progress: Object.hasOwn(value, "mc_percent") ? number(value.mc_percent, 100) : base?.progress ?? null,
    remainingMinutes: Object.hasOwn(value, "mc_remaining_time") ? number(value.mc_remaining_time, 100000) : base?.remainingMinutes ?? null,
    observedAt,
  };
}

/** Internal trusted transport event. HTTP clients cannot claim hardware outcomes through this adapter. */
export function bambuObservation(printerId: string, status: BambuJobStatus): BambuObservation | null {
  if (!/^[A-Za-z0-9_.:-]{1,180}$/.test(printerId) || !status.taskId || !["printing", "completed", "failed"].includes(status.state)) return null;
  const identity = [printerId, status.taskId, status.subtaskId || "", status.state].join("\0");
  return { printerId, taskId: status.taskId, ...(status.subtaskId ? { subtaskId: status.subtaskId } : {}),
    eventId: createHash("sha256").update(identity).digest("hex"), state: status.state as BambuObservation["state"], observedAt: status.observedAt };
}
