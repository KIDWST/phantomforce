#!/usr/bin/env node
/* CLI entry for the PhantomPlay edge network data-plane worker.
   Configuration is env-var only for v1 (no config-file parsing, no remote config fetch) so the
   trust boundary stays easy to audit. See README.md for the full variable list. */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { enrollNode, runCycle } from "../src/worker.mjs";

const stateDir = process.env.PHANTOMFORCE_EDGE_STATE_DIR || join(homedir(), ".phantomplay");
const statePath = join(stateDir, "edge-worker-state.json");
const cacheDir = process.env.PHANTOMFORCE_EDGE_CACHE_DIR || join(stateDir, "edge-cache");
const apiBase = (process.env.PHANTOMFORCE_EDGE_API_BASE || "http://127.0.0.1:5190").replace(/\/+$/, "");
const bearerToken = process.env.PHANTOMFORCE_EDGE_BEARER_TOKEN || "";
const pollIntervalMs = Math.max(5000, Number(process.env.PHANTOMFORCE_EDGE_POLL_MS) || 15000);
const label = process.env.PHANTOMFORCE_EDGE_LABEL || `${process.platform}-desktop`;
const limits = {
  maxDiskGb: Number(process.env.PHANTOMFORCE_EDGE_MAX_DISK_GB) || 25,
  maxUploadMbps: Number(process.env.PHANTOMFORCE_EDGE_MAX_MBPS) || 10,
  maxCpuPercent: Number(process.env.PHANTOMFORCE_EDGE_MAX_CPU_PCT) || 20,
  maxMemoryMb: Number(process.env.PHANTOMFORCE_EDGE_MAX_MEMORY_MB) || 1024,
  allowMeteredNetwork: process.env.PHANTOMFORCE_EDGE_ALLOW_METERED === "true",
};

function log(message) {
  console.log(`[phantomplay-edge-worker] ${new Date().toISOString()} ${message}`);
}

async function loadState() {
  try {
    return JSON.parse(await readFile(statePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

async function saveState(state) {
  await mkdir(dirname(statePath), { recursive: true });
  const temporary = `${statePath}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(state, null, 2));
  await rename(temporary, statePath);
}

async function main() {
  if (!bearerToken) {
    console.error("PHANTOMFORCE_EDGE_BEARER_TOKEN is required. Sign in to PhantomForce in a browser, copy the session bearer token, and set that env var.");
    process.exit(1);
  }

  let state = await loadState();
  if (!state.installationId) {
    state.installationId = randomUUID();
    await saveState(state);
  }

  if (!state.nodeId) {
    log("No enrolled node found in local state — enrolling now (requires explicit consent, granted by running this worker).");
    const node = await enrollNode({
      apiBase, bearerToken, installationId: state.installationId, label,
      platform: process.platform, architecture: process.arch, runtimeVersion: "phantomplay-edge-worker/0.1.0",
      limits, availableDiskGb: limits.maxDiskGb,
    });
    state.nodeId = node.id;
    await saveState(state);
    log(`Enrolled as node ${node.id}.`);
  }

  await mkdir(cacheDir, { recursive: true });
  log(`Starting. apiBase=${apiBase} cacheDir=${cacheDir} pollIntervalMs=${pollIntervalMs}`);

  let stopping = false;
  const stop = () => { stopping = true; log("Stopping after current cycle..."); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  while (!stopping) {
    try {
      const outcomes = await runCycle({
        apiBase, bearerToken, nodeId: state.nodeId, cacheDir,
        availableDiskGb: limits.maxDiskGb, runtimeVersion: "phantomplay-edge-worker/0.1.0",
        maxUploadMbps: limits.maxUploadMbps, log,
      });
      if (outcomes.length) log(`Processed ${outcomes.length} lease(s): ${outcomes.map((o) => `${o.leaseId.slice(0, 8)}=${o.complete ? "complete" : "partial"}`).join(", ")}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`Cycle failed: ${message}`);
      if (/\b401\b/.test(message)) {
        console.error("Bearer token was rejected. Refresh PHANTOMFORCE_EDGE_BEARER_TOKEN and restart the worker.");
        process.exit(1);
      }
    }
    for (let waited = 0; waited < pollIntervalMs && !stopping; waited += 1000) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(1000, pollIntervalMs - waited)));
    }
  }
  log("Stopped.");
}

main().catch((error) => {
  console.error(`[phantomplay-edge-worker] fatal: ${error instanceof Error ? error.stack || error.message : error}`);
  process.exit(1);
});
