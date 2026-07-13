// Builds the structured, individualized prompt sent to each worker terminal.
// Never relies on "everyone do something different" — every section below is
// explicit and worker-specific.
export function buildWorkerPrompt({ mission, worker }) {
  const lines = [];

  lines.push("SHARED MISSION");
  lines.push(mission.objective);
  lines.push("");

  lines.push("YOUR ROLE");
  lines.push(`Worker ${worker.index} — ${worker.name}`);
  lines.push("");

  lines.push("YOUR EXCLUSIVE SCOPE");
  lines.push(worker.scope);
  lines.push("");

  lines.push("WORKSPACE");
  lines.push(`Path: ${worker.cwd}`);
  if (worker.branch) {
    lines.push(`Branch: ${worker.branch} (isolated git worktree — your changes here do not affect other workers)`);
  } else if (mission.launchMode !== "plan") {
    lines.push(
      "This folder is NOT isolated — every worker on this mission shares this exact path. " +
        "Stay strictly inside your exclusive scope and avoid editing files another worker might touch.",
    );
  }
  if (mission.launchMode === "plan") lines.push("Mode: read-only. Do not modify any files.");
  else if (mission.launchMode === "auto") lines.push("Mode: fully autonomous — no approval prompts will interrupt you, act within your scope.");
  lines.push("");

  if (worker.resumingFrom) {
    lines.push("RESUMING FROM CHECKPOINT");
    lines.push(
      "You are a fresh agent continuing from a checkpoint of another worker's file state — NOT the same process. " +
        "The files in your workspace reflect that point in time; nothing else (running processes, in-memory state) carried over.",
    );
    lines.push(`Checkpoint time: ${new Date(worker.resumingFrom.checkpointTs).toISOString()}`);
    lines.push(`What had happened up to that point: ${worker.resumingFrom.summary}`);
    lines.push("");
  }

  if (worker.deliverables) {
    lines.push("DELIVERABLES");
    lines.push(worker.deliverables);
    lines.push("");
  }

  if (worker.prohibited) {
    lines.push("DO NOT");
    lines.push(worker.prohibited);
    lines.push("");
  }

  const others = mission.workers.filter((w) => w.id !== worker.id).map((w) => `Worker ${w.index} (${w.name})`);
  if (others.length) {
    lines.push("OTHER WORKERS ON THIS MISSION");
    lines.push(
      `You are one of ${mission.workers.length} workers on this mission, each in their own isolated workspace: ${others.join(", ")}. ` +
        "Stay inside your exclusive scope above; do not duplicate their work.",
    );
    lines.push("");
  }

  lines.push("REPORTING PROTOCOL");
  lines.push(
    "As you work, periodically emit a line of exactly this form (on its own line, valid JSON, no other text on that line) " +
      "so Termina's mission command center can track your progress:",
  );
  lines.push('TERMINA_EVENT: {"type": "<STARTED|DISCOVERY|FILE_CLAIM|BLOCKER|QUESTION|PROPOSED_CHANGE|CHANGE_APPLIED|TEST_RESULT|HANDOFF|COMPLETE|FAILED>", "detail": "..."}');
  lines.push("Emit STARTED immediately, and COMPLETE (or FAILED) when you are done. Emit FILE_CLAIM before editing a file outside a brief scan.");
  lines.push("");

  lines.push("COMPLETION REQUIREMENTS");
  lines.push(
    "Before emitting COMPLETE: summarize what you actually verified vs. merely proposed, list files touched, note any tests run, " +
      "and flag unresolved risks explicitly.",
  );

  return lines.join("\n");
}
