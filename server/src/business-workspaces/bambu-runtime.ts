import { getSavedBambuConnections } from "./bambu-connections.js";
import { attachBambuMonitor } from "./bambu-connection-routes.js";
import { startBambuMonitor } from "./bambu-monitor.js";
import { getPrintTelemetryBindings, recordTelemetryObservation } from "./print-runs.js";

/** Existing API lifecycle only. Exact task binding is mandatory; names and elapsed time are not identity. */
export async function startBambuRuntime() {
  const monitor = await startBambuMonitor({ getConnections: () => getSavedBambuConnections(), async onObservation(observation) {
    const bindings = await getPrintTelemetryBindings();
    const binding = bindings.find(value => value.printerId === observation.printerId && value.taskId === observation.taskId && (value.subtaskId || "") === (observation.subtaskId || ""));
    if (!binding) return { matched: false };
    await recordTelemetryObservation({ ...observation, runId: binding.runId });
    return { matched: true };
  } });
  attachBambuMonitor(monitor);
  return { status: monitor.status, async stop() { attachBambuMonitor(null); await monitor.stop(); } };
}
