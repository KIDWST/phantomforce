import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

import { redactSensitiveText } from "../hermes-ledger.js";

const execFileAsync = promisify(execFile);

export type CodexCliChatInput = {
  requestId: string;
  businessName: string;
  taskType: string;
  userMessage: string;
  compactContext: string;
  approvalRequired: boolean;
  cwd?: string;
  maxTokens?: number;
};

export type CodexCliChatResult = {
  provider_id: "codex_cli";
  model_id: string;
  status: "called" | "error";
  output_text: string;
  provider_called: boolean;
  network_call_performed: boolean;
  request_body_prepared: boolean;
  tool_requested: false;
  tool_executed: false;
  tool_name: null;
  tool_result: null;
  admin_only: true;
  localhost_only: true;
  raw_secret_exposed: false;
  approval_executed: false;
  external_action_executed: false;
  queue_written: false;
  ledger_written: false;
  error_message: string | null;
  seconds: number;
};

const DEFAULT_CODEX_MODEL = "gpt-5.5";
const MAX_CONTEXT_CHARS = 3600;
const MAX_MESSAGE_CHARS = 1800;
const MAX_RESPONSE_CHARS = 1400;

function resolveCodexCwd(cwd: string | undefined) {
  const resolved = resolve(cwd?.trim() || process.cwd());
  return basename(resolved).toLowerCase() === "server" ? dirname(resolved) : resolved;
}

function buildPrompt(input: CodexCliChatInput) {
  return [
    "You are Phantom inside PhantomForce, powered by Codex.",
    "You are Jordan's admin business operator and general-purpose AI assistant: practical, direct, calm, and capable.",
    "If the request is about PhantomForce, ChicagoShots, media, proposals, security, websites, agents, or admin work, use the compact context like a senior operator.",
    "If the request is general chat or general knowledge, answer directly like a normal high-quality chatbot. Do not force PhantomForce/dashboard context into unrelated answers.",
    "For time-sensitive facts, use the freshest information available to your runtime. If you cannot verify a current fact, say that briefly instead of guessing.",
    "",
    "Default response contract:",
    "- Be a task-doer, not a narrator.",
    "- For greetings or small talk, reply with one short sentence and do not summarize the dashboard.",
    "- For normal admin or general requests, answer in 1-3 short sentences, 65 words or less.",
    "- Use at most 3 bullets only when the user asks for multiple items.",
    "- Do not use headings, tables, long paragraphs, or status dumps unless the user explicitly asks for detail, a report, or a catch-up.",
    "- Only mention read-only mode if the user asks you to execute, send, post, publish, deploy, charge, approve, write, or mutate something.",
    "- Use workspace context only when it directly answers the request.",
    "This chat run is read-only. Do not edit files, deploy, send messages, post content, charge money, write production records, or claim those actions happened.",
    "If the user asks for an action that changes the outside world, draft the next step and say it needs explicit approval before execution.",
    "Privacy-first rule: never infer or claim the user's physical location from IP, account, browser, device, timezone, memory, or local context.",
    "For weather or location-based requests, ask for an explicit city/ZIP/location or explicit approval for a live lookup; do not guess.",
    "Do not expose API keys, session tokens, cookies, raw prompts, or internal secret values.",
    "Keep the answer useful for a mobile admin screen: concise, specific, and action-oriented.",
    "",
    `Business: ${redactSensitiveText(input.businessName).slice(0, 140)}`,
    `Task: ${redactSensitiveText(input.taskType).slice(0, 140)}`,
    `Current date: ${new Date().toISOString().slice(0, 10)}`,
    `Approval-sensitive request: ${input.approvalRequired}`,
    `Request id: ${redactSensitiveText(input.requestId).slice(0, 140)}`,
    "",
    "Compact context:",
    redactSensitiveText(input.compactContext).slice(0, MAX_CONTEXT_CHARS),
    "",
    `User request: ${redactSensitiveText(input.userMessage).slice(0, MAX_MESSAGE_CHARS)}`,
  ].join("\n");
}

function safeError(error: unknown) {
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message)
      : String(error);
  return redactSensitiveText(message).slice(0, 1200);
}

function psSingleQuoted(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

export async function callCodexCliChat(input: CodexCliChatInput): Promise<CodexCliChatResult> {
  const started = Date.now();
  const tempDir = await mkdtemp(join(tmpdir(), "phantom-codex-chat-"));
  const promptPath = join(tempDir, "prompt.txt");
  const outputPath = join(tempDir, "last-message.txt");
  const scriptPath = join(tempDir, "run-codex.ps1");
  const cwd = resolveCodexCwd(input.cwd);
  const model = process.env.PHANTOM_CODEX_MODEL?.trim() || DEFAULT_CODEX_MODEL;
  const timeout = Number(process.env.PHANTOM_CODEX_TIMEOUT_MS ?? 120000);

  await writeFile(promptPath, buildPrompt(input), "utf8");

  try {
    const script = [
      "$ErrorActionPreference = 'Stop'",
      `$promptPath = ${psSingleQuoted(promptPath)}`,
      `$workdir = ${psSingleQuoted(cwd)}`,
      `$outputPath = ${psSingleQuoted(outputPath)}`,
      `$model = ${psSingleQuoted(model)}`,
      "Get-Content -Raw -LiteralPath $promptPath | codex exec - --cd $workdir --sandbox read-only --model $model --output-last-message $outputPath --color never",
      "exit $LASTEXITCODE",
    ].join("\n");
    await writeFile(scriptPath, script, "utf8");

    await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
      {
        cwd,
        timeout: Number.isFinite(timeout) ? Math.min(Math.max(timeout, 15000), 180000) : 120000,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
      },
    );

    const output = redactSensitiveText((await readFile(outputPath, "utf8")).trim()).slice(0, MAX_RESPONSE_CHARS);

    return {
      provider_id: "codex_cli",
      model_id: model,
      status: "called",
      output_text: output || "Codex completed but returned an empty response.",
      provider_called: true,
      network_call_performed: true,
      request_body_prepared: true,
      tool_requested: false,
      tool_executed: false,
      tool_name: null,
      tool_result: null,
      admin_only: true,
      localhost_only: true,
      raw_secret_exposed: false,
      approval_executed: false,
      external_action_executed: false,
      queue_written: false,
      ledger_written: false,
      error_message: null,
      seconds: Number(((Date.now() - started) / 1000).toFixed(2)),
    };
  } catch (error) {
    return {
      provider_id: "codex_cli",
      model_id: model,
      status: "error",
      output_text: "Codex did not complete this Phantom chat request.",
      provider_called: false,
      network_call_performed: false,
      request_body_prepared: true,
      tool_requested: false,
      tool_executed: false,
      tool_name: null,
      tool_result: null,
      admin_only: true,
      localhost_only: true,
      raw_secret_exposed: false,
      approval_executed: false,
      external_action_executed: false,
      queue_written: false,
      ledger_written: false,
      error_message: safeError(error),
      seconds: Number(((Date.now() - started) / 1000).toFixed(2)),
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
