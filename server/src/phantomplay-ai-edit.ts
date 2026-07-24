/* PhantomPlay — "AI right inside the game" code-edit endpoint.

   Used by the native shell's AI panel (packages/phantomplay-dioxus-shell):
   the dev types an instruction against the currently-open file, this spawns
   the same local Claude CLI already wired up for Phantom Console
   (server/src/phantom-ai/providers/claude-cli-transport.ts), but with limits
   sized for real game files (tens of KB) instead of that transport's 6-7K
   chat-reply caps, and a prompt that asks for ONLY the revised file back.

   No account/session required — same local-dev trust model as the shell's
   file editor itself (it already writes straight to disk with no auth). Do
   not reuse this endpoint for anything user-facing on the public site. */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const MAX_FILE_CHARS = 220_000; // generous headroom over the largest current game.js
const MAX_INSTRUCTION_CHARS = 4000;
const DEFAULT_WINDOWS_CLAUDE_PS1 = "C:\\Users\\jorda\\AppData\\Local\\hermes\\node\\claude.ps1";
const BEGIN = "<<<PHANTOMPLAY_FILE_BEGIN>>>";
const END = "<<<PHANTOMPLAY_FILE_END>>>";

export type PhantomPlayAiEditInput = {
  gameId: string;
  filePath: string;
  fileContent: string;
  instruction: string;
  cwd: string;
  timeoutMs?: number;
};

export type PhantomPlayAiEditResult =
  | { ok: true; newContent: string; changed: boolean; raw: string }
  | { ok: false; error: string };

function resolveClaudeCliCommand(env: NodeJS.ProcessEnv) {
  const configured = env.PHANTOM_CLAUDE_CLI_COMMAND?.trim();
  if (configured) return { command: configured, argsPrefix: [] as string[], display: configured };
  if (process.platform === "win32" && existsSync(DEFAULT_WINDOWS_CLAUDE_PS1)) {
    return {
      command: "powershell.exe",
      argsPrefix: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", DEFAULT_WINDOWS_CLAUDE_PS1, "--dangerously-skip-permissions"],
      display: DEFAULT_WINDOWS_CLAUDE_PS1,
    };
  }
  return { command: "claude", argsPrefix: [] as string[], display: "claude" };
}

function runClaudeCliProcess(command: string, args: string[], cwd: string, timeout: number) {
  return new Promise<{ stdout: string; stderr: string; code: number | string | null }>((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let finished = false;
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      child.kill();
      reject(new Error(`AI edit timed out after ${timeout}ms.`));
    }, timeout);
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.on("error", (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolvePromise({ stdout, stderr, code });
    });
  });
}

function extractFile(raw: string): string | null {
  const start = raw.indexOf(BEGIN);
  const end = raw.indexOf(END);
  if (start === -1 || end === -1 || end <= start) return null;
  return raw.slice(start + BEGIN.length, end).replace(/^\r?\n/, "").replace(/\r?\n$/, "");
}

export async function requestPhantomPlayAiEdit(input: PhantomPlayAiEditInput): Promise<PhantomPlayAiEditResult> {
  if (!input.instruction.trim()) return { ok: false, error: "An instruction is required." };
  if (input.fileContent.length > MAX_FILE_CHARS) {
    return { ok: false, error: `File is too large for the AI panel (${input.fileContent.length} chars, max ${MAX_FILE_CHARS}). Edit it directly.` };
  }

  const claudeCommand = resolveClaudeCliCommand(process.env);
  const cwd = resolve(input.cwd);
  const timeout = Math.min(Math.max(input.timeoutMs ?? 120000, 10000), 240000);

  const prompt = [
    "You are editing a single file inside a PhantomPlay game, live, while it may be running in a native player window with hot reload.",
    `Game: ${input.gameId}`,
    `File: ${input.filePath}`,
    "",
    "Rules:",
    "- Make the minimum change that satisfies the instruction. Preserve everything else exactly, including formatting style.",
    "- The file must remain valid and runnable on its own (plain browser JS/HTML/CSS, no build step, no new dependencies).",
    "- Do not explain your change in prose. Respond with ONLY the complete new file content, wrapped exactly like this, nothing before or after:",
    BEGIN,
    "...full file content...",
    END,
    "",
    `Instruction: ${input.instruction.slice(0, MAX_INSTRUCTION_CHARS)}`,
    "",
    "Current file content:",
    BEGIN,
    input.fileContent,
    END,
  ].join("\n");

  try {
    const result = await runClaudeCliProcess(claudeCommand.command, [...claudeCommand.argsPrefix, "-p", prompt], cwd, timeout);
    const raw = result.stdout || result.stderr || "";
    if ((result.code ?? 0) !== 0 && !raw.includes(BEGIN)) {
      return { ok: false, error: `Claude CLI exited with ${result.code}: ${(result.stderr || "no output").slice(0, 500)}` };
    }
    const newContent = extractFile(raw);
    if (newContent === null) {
      return { ok: false, error: "AI response didn't include a recognizable file block. Nothing was changed." };
    }
    return { ok: true, newContent, changed: newContent !== input.fileContent, raw: raw.slice(0, 2000) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const notFound = /ENOENT/i.test(message) || /not recognized/i.test(message) || /not found/i.test(message);
    return { ok: false, error: notFound ? `Claude CLI ("${claudeCommand.display}") isn't available to the backend process.` : message };
  }
}
