/* Registers "termina_mission" on the ONE shared agent-run engine
   (phantom-ai/agent-runs.ts) — the same engine that already gates
   publish_site (sites/publishing.ts) behind a real approval action. This is
   intentional: PhantomForce does not get a second, parallel approval
   mechanism for missions. A mission run is created `awaiting_approval` and
   the executor below — the only code path that ever calls
   termina-bridge.ts's decompose()/createMission() — is only ever invoked by
   agent-runs.ts's approveAgentRun(), which itself only runs after a
   distinct, separately-authorized approval action. There is no path from
   "chat produced this run" straight to "Termina workers started." */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { registerAgentRunExecutor } from "./agent-runs.js";
import {
  createMission,
  decompose,
  ensureRunning,
  getMission,
  terminaTokenFromEnv,
  terminaUrlFromEnv,
  terminaWorkspaceRootFromEnv,
} from "./termina-bridge.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../../..");
const ARTIFACTS_DIR = resolve(repoRoot, ".phantom", "artifacts");

export const TERMINA_MISSION_OPERATION = "termina_mission";

export function registerTerminaMissionExecutor() {
  registerAgentRunExecutor(TERMINA_MISSION_OPERATION, {
    title: "Dispatch Termina mission",
    description:
      "Sends a real objective to Termina (C:\\Users\\jorda\\Termina) to decompose into worker roles and starts a real multi-agent mission against the configured workspace. Real API/token cost. Real filesystem/git writes. Never runs without a separate, explicit approval.",
    risk: "never_silent",
    requiredRole: "super_admin",
    scope: "the configured Termina workspace root (this server's own repo checkout by default)",
    expectedEffect:
      "Termina decomposes the objective (a real LLM call) and starts a mission with launchMode \"approval\" — Termina's own per-worker approval gate stays on top of this.",
    rollbackGuidance:
      "Stop or retry individual workers directly through Termina's own API/dashboard (POST /api/missions/:id/workers/:id/stop). PhantomForce does not manage rollback of file/git changes made by mission workers — review the affected workspace's git state directly.",
    async execute({ run, progress, isCancelled }) {
      const objective = String((run.inputs as { objective?: unknown }).objective ?? run.request ?? "").trim();
      if (!objective) throw new Error("No objective was provided for this mission.");

      const baseUrl = terminaUrlFromEnv();
      const token = terminaTokenFromEnv();
      if (!token) {
        throw new Error(
          "Termina is not configured on this server (TERMINA_TOKEN is unset). Set TERMINA_URL/TERMINA_TOKEN in server/.env, then retry.",
        );
      }

      await progress("Checking whether Termina is running locally…");
      // Deliberately does not auto-launch Termina — see termina-bridge.ts.
      // If Termina is down this throws and the run fails with a clear,
      // user-facing message instead of silently doing nothing or crashing.
      await ensureRunning(baseUrl, token, 3_000);
      if (isCancelled()) throw new Error("cancelled");

      const workspaceRoot = terminaWorkspaceRootFromEnv();

      await progress("Asking Termina to decompose the objective into worker roles (real LLM call)…");
      const decomposed = await decompose(baseUrl, token, objective, workspaceRoot);
      if (isCancelled()) throw new Error("cancelled");

      await progress(`Starting Termina mission "${decomposed.missionName}" with ${decomposed.roles.length} worker role(s)…`);
      const mission = await createMission(baseUrl, token, {
        name: decomposed.missionName,
        objective,
        workspaceRoot,
        roles: decomposed.roles,
      });

      // Stash the real Termina mission id on the run's own inputs so
      // GET /phantom-ai/runs/:id and the verify step below can both find it
      // without a second parallel store.
      (run.inputs as Record<string, unknown>).missionId = mission.id;
      (run.inputs as Record<string, unknown>).workspaceRoot = workspaceRoot;

      const lines = [
        `# Termina mission dispatched`,
        ``,
        `Agent run ${run.id} was approved and dispatched a real Termina mission.`,
        ``,
        `- Termina mission ID: ${mission.id}`,
        `- Mission name: ${mission.name}`,
        `- Objective: ${objective}`,
        `- Workspace root: ${workspaceRoot}`,
        `- Launch mode: ${mission.launchMode} (Termina's own per-worker approval gate; this bridge never requests "auto")`,
        `- Decompose cost: ${decomposed.costUsd === null ? "unknown" : `$${decomposed.costUsd}`}`,
        `- Workers: ${mission.workers.map((worker) => `${worker.name} (${worker.status})`).join(", ") || "none reported"}`,
        ``,
        `Poll GET /api/missions/${mission.id} on Termina directly, or GET /phantom-ai/runs/${run.id} here, for live progress. Nothing further executes automatically from PhantomForce.`,
      ];
      await mkdir(ARTIFACTS_DIR, { recursive: true });
      const path = resolve(ARTIFACTS_DIR, `${run.id}-termina-mission.md`);
      await writeFile(path, lines.join("\n"), "utf8");

      return {
        artifacts: [{ kind: "markdown" as const, path, summary: `Termina mission ${mission.id} dispatched (${mission.workers.length} worker(s)).` }],
        summary: `Dispatched Termina mission ${mission.id} ("${mission.name}") with ${mission.workers.length} worker(s).`,
        actualEffect: `Termina mission ${mission.id} is running against ${workspaceRoot}.`,
      };
    },
    async verify({ run }) {
      const missionId = (run.inputs as { missionId?: unknown }).missionId;
      if (typeof missionId !== "string" || !missionId) {
        return { ok: false, detail: "no Termina mission id was recorded after dispatch" };
      }
      try {
        const baseUrl = terminaUrlFromEnv();
        const token = terminaTokenFromEnv();
        const { mission } = await getMission(baseUrl, token, missionId);
        if (!mission?.id) return { ok: false, detail: `Termina has no record of mission ${missionId}` };
        if (!mission.workers?.length) return { ok: false, detail: `Termina mission ${missionId} reports no workers` };
        return { ok: true, detail: `Termina confirms mission ${missionId} is live with ${mission.workers.length} worker(s), status ${mission.status}` };
      } catch (error) {
        return { ok: false, detail: `could not verify with Termina: ${error instanceof Error ? error.message : String(error)}` };
      }
    },
  });
}
