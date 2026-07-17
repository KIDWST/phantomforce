// Runs Codex CLI in non-interactive exec mode (`codex exec`) as a one-shot,
// detached child process — the ChatGPT-subscription-billed counterpart to
// claude-print.js, used to keep the mission pipeline's bookkeeping calls off
// the Claude Max usage window.
//
// Same injection-safe pattern as claude-print.js: the prompt is written to a
// temp file and read into a PowerShell variable, never spliced into the
// command string. The JSON schema and final message travel via files using
// codex's --output-schema / --output-last-message flags.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const PWSH = "pwsh.exe";

export async function runCodexPrint({ prompt, jsonSchema, cwd, timeoutMs = 120000, scratchDir }) {
  const id = randomBytes(8).toString("hex");
  const dir = path.join(scratchDir, `codex-print-${id}`);
  await mkdir(dir, { recursive: true });
  const promptFile = path.join(dir, "prompt.txt");
  const outFile = path.join(dir, "last-message.txt");
  await writeFile(promptFile, prompt, "utf8");

  const codexArgs = [
    "'exec'", "'--skip-git-repo-check'", "'--ephemeral'",
    "'-s'", "'read-only'", "'--color'", "'never'",
    "'-C'", psQuote(cwd),
    "'-o'", psQuote(outFile),
  ];
  if (jsonSchema) {
    const schemaFile = path.join(dir, "schema.json");
    await writeFile(schemaFile, JSON.stringify(jsonSchema), "utf8");
    codexArgs.push("'--output-schema'", psQuote(schemaFile));
  }

  const scriptLines = [
    `$ErrorActionPreference = 'Stop'`,
    `$prompt = Get-Content -Raw -LiteralPath ${psQuote(promptFile)}`,
    // codex exec blocks reading piped stdin until EOF (no 3s bail like
    // claude -p); execFile hands it an open pipe, so close stdin explicitly.
    `$null | codex ${codexArgs.join(" ")} -- $prompt`,
    `exit $LASTEXITCODE`,
  ];

  try {
    try {
      await run(PWSH, ["-NoLogo", "-NoProfile", "-Command", scriptLines.join("; ")], {
        cwd,
        timeout: timeoutMs,
        maxBuffer: 32 * 1024 * 1024,
      });
    } catch (err) {
      if (err.killed) throw new Error(`codex exec timed out after ${timeoutMs}ms`);
      throw new Error(`codex exec failed: ${lastLines(err.stderr) || err.message}`);
    }
    const lastMessage = (await readFile(outFile, "utf8").catch(() => "")).trim();
    if (!lastMessage) throw new Error("codex exec produced no final message");
    if (!jsonSchema) return { result: lastMessage, structured_output: null, backend: "codex" };
    let structured;
    try {
      structured = JSON.parse(lastMessage);
    } catch {
      throw new Error(`codex exec final message was not valid JSON: ${lastMessage.slice(0, 400)}`);
    }
    return { result: lastMessage, structured_output: structured, backend: "codex" };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function lastLines(stderr) {
  if (typeof stderr !== "string" || !stderr.trim()) return "";
  return stderr.trim().split(/\r?\n/).slice(-3).join(" | ");
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}
