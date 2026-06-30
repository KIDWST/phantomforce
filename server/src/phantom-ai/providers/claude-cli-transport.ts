import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { redactSensitiveText } from "../hermes-ledger.js";
import type { SensitivityLevel } from "../types.js";

const execFileAsync = promisify(execFile);

export type ClaudeCliChatInput = {
  requestId: string;
  businessName: string;
  taskType: string;
  userMessage: string;
  compactContext: string;
  sensitivityLevel: SensitivityLevel;
  approvalRequired: boolean;
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
    command: process.env.PHANTOM_CLAUDE_CLI_COMMAND?.trim() || "claude",
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
  const command = env.PHANTOM_CLAUDE_CLI_COMMAND?.trim() || "claude";
  const cwd = resolve(input.cwd ?? process.cwd());
  const timeout = Math.min(Math.max(input.timeoutMs ?? 90000, 5000), 180000);

  const prompt = [
    "You are Phantom AI inside Jordan's local PhantomForce admin dashboard.",
    "You are running in the admin-only Claude CLI lane.",
    "Use the Hermes context below as backend memory. Be direct, adaptive, and useful.",
    "You may draft, reason, inspect the plan conceptually, and tell Jordan exact next steps.",
    "Do not claim that you sent, posted, uploaded, billed, deployed, deleted, or changed production state.",
    "If an action should touch the outside world, draft it and mark it owner-approved/manual until a separate send path exists.",
    "",
    `Business: ${redactSensitiveText(input.businessName).slice(0, 120)}`,
    `Task: ${redactSensitiveText(input.taskType).slice(0, 120)}`,
    `Sensitivity: ${input.sensitivityLevel}`,
    `Approval-sensitive: ${input.approvalRequired}`,
    "",
    "Hermes context:",
    redactSensitiveText(input.compactContext).slice(0, MAX_CONTEXT_CHARS),
    "",
    `Jordan request: ${redactSensitiveText(input.userMessage).slice(0, MAX_MESSAGE_CHARS)}`,
  ].join("\n");

  try {
    const result = await execFileAsync(command, ["-p", prompt], {
      cwd,
      timeout,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
      env: process.env,
    });
    const output = truncate(result.stdout || result.stderr || "Claude CLI returned an empty response.");

    return {
      provider_id: "claude_cli",
      model_id: "claude-cli",
      status: "called",
      blocked_reason: null,
      error_message: null,
      output_text: output,
      provider_called: true,
      network_call_performed: true,
      request_body_prepared: true,
      command,
      cwd,
      exit_code: 0,
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
      return blockedResult(input, `Claude CLI command "${command}" is not available to the backend process.`);
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
      command,
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
