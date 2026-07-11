import assert from "node:assert/strict";
import { test } from "node:test";

import { buildWorkerPrompt } from "../../mission/prompt.js";

function sampleMission() {
  const workers = [
    { id: "w1", index: 1, name: "Frontend Auditor", scope: "Audit the UI layer only.", cwd: "C:\\repo\\wt-frontend", branch: "termina/mission-abc/frontend", deliverables: "A list of UI issues.", prohibited: "Do not touch backend code." },
    { id: "w2", index: 2, name: "Backend Auditor", scope: "Audit the API layer only.", cwd: "C:\\repo\\wt-backend", branch: "termina/mission-abc/backend", deliverables: "A list of API issues.", prohibited: "Do not touch frontend code." },
  ];
  return { objective: "Prepare the app for launch.", workspaceStrategy: "worktrees", workers };
}

test("each worker gets a prompt containing its own role, scope, and workspace", () => {
  const mission = sampleMission();
  const promptA = buildWorkerPrompt({ mission, worker: mission.workers[0] });
  const promptB = buildWorkerPrompt({ mission, worker: mission.workers[1] });

  assert.ok(promptA.includes("Frontend Auditor"));
  assert.ok(promptA.includes("Audit the UI layer only."));
  assert.ok(promptA.includes("wt-frontend"));
  assert.ok(promptA.includes("Do not touch backend code."));

  assert.ok(promptB.includes("Backend Auditor"));
  assert.ok(promptB.includes("Audit the API layer only."));
  assert.ok(promptB.includes("wt-backend"));
});

test("prompts are never accidentally identical across distinct workers", () => {
  const mission = sampleMission();
  const prompts = mission.workers.map((worker) => buildWorkerPrompt({ mission, worker }));
  assert.notEqual(prompts[0], prompts[1]);
});

test("shares the same objective across all workers", () => {
  const mission = sampleMission();
  const prompts = mission.workers.map((worker) => buildWorkerPrompt({ mission, worker }));
  for (const p of prompts) assert.ok(p.includes("Prepare the app for launch."));
});

test("mentions other workers by name so scopes stay non-duplicative", () => {
  const mission = sampleMission();
  const promptA = buildWorkerPrompt({ mission, worker: mission.workers[0] });
  assert.ok(promptA.includes("Backend Auditor"));
  assert.ok(!promptA.includes("Worker 1 (Frontend Auditor)")); // doesn't list itself as an "other worker"
});

test("audit-mode missions tell the worker not to modify files", () => {
  const mission = sampleMission();
  mission.workspaceStrategy = "audit";
  mission.workers[0].branch = null;
  const prompt = buildWorkerPrompt({ mission, worker: mission.workers[0] });
  assert.ok(/read-only audit/i.test(prompt));
});

test("includes the reporting protocol instructions", () => {
  const mission = sampleMission();
  const prompt = buildWorkerPrompt({ mission, worker: mission.workers[0] });
  assert.ok(prompt.includes("TERMINA_EVENT:"));
  assert.ok(prompt.includes("COMPLETE"));
});
