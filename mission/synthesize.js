// Final mission synthesis: a one-shot `claude -p` call, cwd'd at the main
// workspace root so it can independently inspect worker branches/diffs
// rather than only trusting self-reported ledger claims. Runs as a detached
// process, not a wall tile.
import { runClaudePrint } from "./claude-print.js";

const REPORT_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    workerFindings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          workerId: { type: "string" },
          workerName: { type: "string" },
          found: { type: "string" },
        },
        required: ["workerId", "workerName", "found"],
      },
    },
    workCompleted: { type: "array", items: { type: "string" } },
    filesChanged: { type: "array", items: { type: "string" } },
    testsRun: { type: "array", items: { type: "string" } },
    verifiedCompletion: { type: "array", items: { type: "string" }, description: "Claims you independently verified (e.g. by inspecting the diff/files yourself)" },
    claimedCompletion: { type: "array", items: { type: "string" }, description: "Worker self-reported as done, not independently verified" },
    proposedWork: { type: "array", items: { type: "string" } },
    unresolvedWork: { type: "array", items: { type: "string" } },
    conflictingFindings: { type: "array", items: { type: "string" } },
    failedOrIncomplete: { type: "array", items: { type: "string" } },
    recommendedIntegrationOrder: { type: "array", items: { type: "string" } },
    decisionsNeedingUser: { type: "array", items: { type: "string" } },
    nextSteps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          description: { type: "string" },
          rationale: { type: "string" },
        },
        required: ["description", "rationale"],
      },
    },
  },
  required: [
    "summary",
    "workerFindings",
    "workCompleted",
    "verifiedCompletion",
    "claimedCompletion",
    "proposedWork",
    "unresolvedWork",
    "decisionsNeedingUser",
    "nextSteps",
  ],
};

const SYNTHESIS_BUDGET_USD = 3;

export async function synthesizeMission({ mission, ledger, scratchDir }) {
  const workerSummaries = mission.workers
    .map((w) => `Worker ${w.index} — ${w.name}\n  scope: ${w.scope}\n  workspace: ${w.cwd}${w.branch ? ` (branch ${w.branch})` : ""}`)
    .join("\n\n");

  const ledgerText = ledger.length
    ? ledger.map((e) => `[worker ${e.workerId ?? "?"}] ${e.type}${e.detail ? `: ${e.detail}` : ""}`).join("\n")
    : "(no structured events were reported by any worker)";

  const prompt =
    `You are the lead coordinator synthesizing the results of a completed multi-worker Claude Code mission.\n\n` +
    `MISSION OBJECTIVE:\n${mission.objective}\n\n` +
    `WORKERS:\n${workerSummaries}\n\n` +
    `LEDGER (self-reported events from workers, in order):\n${ledgerText}\n\n` +
    `You are running with the main workspace as your working directory and have tool access. ` +
    `Where a worker's branch/worktree still exists, independently inspect it (e.g. \`git diff\`, reading the actual files) ` +
    `rather than trusting self-reports. Explicitly separate what you verified yourself from what is only claimed, proposed, ` +
    `or unresolved. Do not claim something is complete if you have no evidence for it.`;

  const result = await runClaudePrint({
    prompt,
    jsonSchema: REPORT_SCHEMA,
    cwd: mission.workspaceRoot,
    maxBudgetUsd: SYNTHESIS_BUDGET_USD,
    timeoutMs: 300000,
    scratchDir,
  });

  const report = result.structured_output;
  if (!report) throw new Error("synthesis did not return a structured report");
  // The model isn't asked to invent step ids (unreliable — could collide or
  // be omitted); assigned here, before anything is persisted or returned.
  report.nextSteps = (report.nextSteps ?? []).map((step, i) => ({ id: `step-${i + 1}`, ...step }));
  return { report, costUsd: result.total_cost_usd ?? null };
}

export function renderReportMarkdown(mission, report, costUsd) {
  const list = (items) => (items && items.length ? items.map((i) => `- ${i}`).join("\n") : "_none_");
  const findings = report.workerFindings?.length
    ? report.workerFindings.map((f) => `- **${f.workerName}:** ${f.found}`).join("\n")
    : "_none_";
  const steps = report.nextSteps?.length
    ? report.nextSteps.map((s, i) => `${i + 1}. ${s.description} — ${s.rationale}`).join("\n")
    : "_none_";
  return `# Phantom Report — ${mission.name}

**Objective:** ${mission.objective}

**Cost:** ${costUsd != null ? `$${costUsd.toFixed(4)}` : "unknown"}

## What each worker found
${findings}

## Summary
${report.summary}

## Work completed
${list(report.workCompleted)}

## Files changed
${list(report.filesChanged)}

## Tests run
${list(report.testsRun)}

## Verified completion (independently checked)
${list(report.verifiedCompletion)}

## Claimed completion (self-reported, not independently verified)
${list(report.claimedCompletion)}

## Proposed work (not yet applied)
${list(report.proposedWork)}

## Unresolved work
${list(report.unresolvedWork)}

## Conflicting findings
${list(report.conflictingFindings)}

## Failed or incomplete work
${list(report.failedOrIncomplete)}

## Recommended integration order
${list(report.recommendedIntegrationOrder)}

## Decisions still requiring the user
${list(report.decisionsNeedingUser)}

## Next steps
${steps}
`;
}
