import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { redactSensitiveText } from "../hermes-ledger.js";
import type { SensitivityLevel } from "../types.js";

export type ClaudeCliChatInput = {
  requestId: string;
  businessName: string;
  taskType: string;
  userMessage: string;
  compactContext: string;
  sensitivityLevel: SensitivityLevel;
  approvalRequired: boolean;
  executionMode?: "approval" | "auto";
  cwd?: string;
  timeoutMs?: number;
};

export type ClaudeCliChatResult = {
  provider_id: "claude_cli";
  model_id: "claude-cli";
  status: "blocked" | "called" | "error";
  blocked_reason: string | null;
  error_message: string | null;
  output_text: string;
  provider_called: boolean;
  network_call_performed: boolean;
  request_body_prepared: boolean;
  command: string;
  cwd: string;
  exit_code: number | string | null;
  stdout_chars: number;
  stderr_chars: number;
  ledger_written: false;
  queue_written: false;
  approval_executed: false;
  external_action_executed: false;
  raw_secret_exposed: false;
};

const MAX_CONTEXT_CHARS = 6000;
const MAX_MESSAGE_CHARS = 1800;
const MAX_RESPONSE_CHARS = 7000;
const DEFAULT_WINDOWS_CLAUDE_PS1 = "C:\\Users\\jorda\\AppData\\Local\\hermes\\node\\claude.ps1";

function resolveClaudeCliCommand(env: NodeJS.ProcessEnv | Record<string, string | undefined>) {
  const configured = env.PHANTOM_CLAUDE_CLI_COMMAND?.trim();
  if (configured) return { command: configured, argsPrefix: [] as string[], display: configured };

  if (process.platform === "win32" && existsSync(DEFAULT_WINDOWS_CLAUDE_PS1)) {
    return {
      command: "powershell.exe",
      argsPrefix: [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        DEFAULT_WINDOWS_CLAUDE_PS1,
        "--dangerously-skip-permissions",
      ],
      display: DEFAULT_WINDOWS_CLAUDE_PS1,
    };
  }

  return { command: "claude", argsPrefix: [] as string[], display: "claude" };
}

function runClaudeCliProcess(command: string, args: string[], cwd: string, timeout: number) {
  return new Promise<{ stdout: string; stderr: string; code: number | string | null; signal: NodeJS.Signals | null }>(
    (resolvePromise, reject) => {
      const child = spawn(command, args, {
        cwd,
        windowsHide: true,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let finished = false;
      const timer = setTimeout(() => {
        if (finished) return;
        child.kill();
        reject(new Error(`Claude CLI timed out after ${timeout}ms.`));
      }, timeout);

      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", (error) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code, signal) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolvePromise({ stdout, stderr, code, signal });
      });
    },
  );
}

function truncate(value: string, max = MAX_RESPONSE_CHARS) {
  return redactSensitiveText(value).slice(0, max);
}

function blockedResult(input: ClaudeCliChatInput, reason: string): ClaudeCliChatResult {
  return {
    provider_id: "claude_cli",
    model_id: "claude-cli",
    status: "blocked",
    blocked_reason: redactSensitiveText(reason),
    error_message: null,
    output_text: `Claude CLI is selected, but it could not run: ${redactSensitiveText(reason)}`,
    provider_called: false,
    network_call_performed: false,
    request_body_prepared: false,
    command: resolveClaudeCliCommand(process.env).display,
    cwd: resolve(input.cwd ?? process.cwd()),
    exit_code: null,
    stdout_chars: 0,
    stderr_chars: 0,
    ledger_written: false,
    queue_written: false,
    approval_executed: false,
    external_action_executed: false,
    raw_secret_exposed: false,
  };
}

export async function callClaudeCliChat(
  input: ClaudeCliChatInput,
  options: {
    env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  } = {},
): Promise<ClaudeCliChatResult> {
  const env = { ...process.env, ...(options.env ?? {}) };
  const claudeCommand = resolveClaudeCliCommand(env);
  const cwd = resolve(input.cwd ?? process.cwd());
  const timeout = Math.min(Math.max(input.timeoutMs ?? 90000, 5000), 180000);

  const prompt = [
    "You are Phantom AI inside Jordan's local PhantomForce admin dashboard.",
    "You are running in the admin-only Claude CLI lane.",
    "Use the Hermes context below as backend memory. Be direct, adaptive, and useful.",
    "You may draft, reason, inspect the plan conceptually, and tell Jordan exact next steps.",
    "Do not claim that you sent, posted, uploaded, billed, deployed, deleted, or changed production state.",
    "If an action should touch the outside world, draft it and mark it owner-approved/manual until a separate send path exists.",
    "Privacy-first rule: never infer or claim Jordan's physical location from IP, account, browser, device, timezone, memory, or local context.",
    "For weather or location-based requests, ask for an explicit city/ZIP/location or explicit approval for a live lookup; do not guess.",
    "",
    `Business: ${redactSensitiveText(input.businessName).slice(0, 120)}`,
    `Task: ${redactSensitiveText(input.taskType).slice(0, 120)}`,
    `Sensitivity: ${input.sensitivityLevel}`,
    `Execution mode: ${input.executionMode === "auto" ? "auto" : "approval"}`,
    input.executionMode === "auto"
      ? "Auto Mode: safe internal workspace artifacts and action cards may be prepared without asking again; external/world-changing actions still need the right adapter receipt."
      : "Approval Mode: stage actions for review before execution.",
    `Approval-sensitive: ${input.approvalRequired}`,
    "",
    "Hermes context:",
    redactSensitiveText(input.compactContext).slice(0, MAX_CONTEXT_CHARS),
    "",
    `Jordan request: ${redactSensitiveText(input.userMessage).slice(0, MAX_MESSAGE_CHARS)}`,
  ].join("\n");

  try {
    const result = await runClaudeCliProcess(claudeCommand.command, [...claudeCommand.argsPrefix, "-p", prompt], cwd, timeout);
    const output = truncate(result.stdout || result.stderr || "Claude CLI returned an empty response.");
    const exitCode = result.code ?? 0;

    return {
      provider_id: "claude_cli",
      model_id: "claude-cli",
      status: exitCode === 0 ? "called" : "error",
      blocked_reason: null,
      error_message: exitCode === 0 ? null : truncate(result.stderr || `Claude CLI exited with ${exitCode}.`, 1000),
      output_text: output,
      provider_called: true,
      network_call_performed: true,
      request_body_prepared: true,
      command: claudeCommand.display,
      cwd,
      exit_code: exitCode,
      stdout_chars: result.stdout.length,
      stderr_chars: result.stderr.length,
      ledger_written: false,
      queue_written: false,
      approval_executed: false,
      external_action_executed: false,
      raw_secret_exposed: false,
    };
  } catch (error) {
    const commandError = error as { stdout?: string; stderr?: string; code?: number | string; message?: string };
    const stderr = commandError.stderr ?? "";
    const stdout = commandError.stdout ?? "";
    const message = commandError.message ?? String(error);
    const notFound =
      /ENOENT/i.test(message) ||
      /not recognized/i.test(stderr) ||
      /cannot find/i.test(stderr) ||
      /not found/i.test(stderr);

    if (notFound) {
      return blockedResult(input, `Claude CLI command "${claudeCommand.display}" is not available to the backend process.`);
    }

    return {
      provider_id: "claude_cli",
      model_id: "claude-cli",
      status: "error",
      blocked_reason: null,
      error_message: truncate(stderr || message, 1000),
      output_text: truncate(stdout || "Claude CLI errored before returning a usable response."),
      provider_called: true,
      network_call_performed: true,
      request_body_prepared: true,
      command: claudeCommand.display,
      cwd,
      exit_code: commandError.code ?? 1,
      stdout_chars: stdout.length,
      stderr_chars: stderr.length,
      ledger_written: false,
      queue_written: false,
      approval_executed: false,
      external_action_executed: false,
      raw_secret_exposed: false,
    };
  }
}
