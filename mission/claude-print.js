// Runs Claude Code in non-interactive print mode (`claude -p`) as a one-shot,
// detached child process — no PTY, no wall tile. Used for role decomposition
// and final report synthesis, never for the worker terminals themselves
// (those stay fully interactive).
//
// Content (the objective/prompt and the JSON schema) is written to temp
// files and read into PowerShell variables rather than spliced into the
// command-line string, so arbitrary user text (quotes, newlines) can never
// break out of the invocation — the same pwsh-launch pattern profiles.js
// already relies on for interactive Claude/Codex sessions on Windows.
import { randomBytes } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const PWSH = "pwsh.exe";

export async function runClaudePrint({ prompt, jsonSchema, cwd, maxBudgetUsd, timeoutMs = 120000, scratchDir }) {
  const id = randomBytes(8).toString("hex");
  const dir = path.join(scratchDir, `print-${id}`);
  await mkdir(dir, { recursive: true });
  const promptFile = path.join(dir, "prompt.txt");
  await writeFile(promptFile, prompt, "utf8");

  const scriptLines = [
    `$ErrorActionPreference = 'Stop'`,
    `$prompt = Get-Content -Raw -LiteralPath ${psQuote(promptFile)}`,
    `$claudeArgs = @('-p', $prompt, '--output-format', 'json')`,
  ];
  if (jsonSchema) {
    const schemaFile = path.join(dir, "schema.json");
    await writeFile(schemaFile, JSON.stringify(jsonSchema), "utf8");
    scriptLines.push(`$schema = Get-Content -Raw -LiteralPath ${psQuote(schemaFile)}`);
    scriptLines.push(`$claudeArgs += @('--json-schema', $schema)`);
  }
  if (maxBudgetUsd) {
    scriptLines.push(`$claudeArgs += @('--max-budget-usd', '${Number(maxBudgetUsd)}')`);
  }
  scriptLines.push(`claude @claudeArgs`);

  try {
    const { stdout } = await run(PWSH, ["-NoLogo", "-NoProfile", "-Command", scriptLines.join("; ")], {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 32 * 1024 * 1024,
    });
    const result = JSON.parse(extractJson(stdout));
    if (result.is_error) {
      throw new Error(`claude -p reported an error: ${result.result ?? "unknown"}`);
    }
    return result;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// pwsh prints the JSON result as the last line of stdout; be defensive about
// any stray banner/warning text around it.
function extractJson(stdout) {
  const trimmed = stdout.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`claude -p produced no parseable JSON output: ${trimmed.slice(0, 400)}`);
  }
  return trimmed.slice(start, end + 1);
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}
