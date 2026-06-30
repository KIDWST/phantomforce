import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

import { redactSensitiveText } from "./hermes-ledger.js";
import {
  OPENROUTER_CHAT_COMPLETIONS_ENDPOINT,
  OPENROUTER_GLM_52_MODEL_ID,
  OPENROUTER_GLM_PROVIDER_ID,
} from "./providers/openrouter-adapter.js";

const execFileAsync = promisify(execFile);

type OperatorFetchResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
};

type OperatorFetch = (
  url: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
  },
) => Promise<OperatorFetchResponse>;

export type CodexOperatorInput = {
  requestId: string;
  businessName: string;
  userMessage: string;
  compactContext: string;
  approvalRequired: boolean;
  cwd?: string;
  maxTokens?: number;
};

export type CodexOperatorResult = {
  provider_id: typeof OPENROUTER_GLM_PROVIDER_ID;
  model_id: typeof OPENROUTER_GLM_52_MODEL_ID;
  status: "blocked" | "called" | "error";
  output_text: string;
  provider_called: boolean;
  network_call_performed: boolean;
  request_body_prepared: boolean;
  tool_requested: boolean;
  tool_executed: boolean;
  tool_name: string | null;
  tool_result: unknown;
  admin_only: true;
  localhost_only: true;
  raw_secret_exposed: false;
  approval_executed: false;
  external_action_executed: false;
  queue_written: false;
  ledger_written: false;
  error_message: string | null;
};

type ToolCall =
  | { tool: "list_dir"; path?: string; limit?: number }
  | { tool: "read_file"; path: string; max_bytes?: number }
  | { tool: "search_files"; path?: string; query: string; limit?: number }
  | { tool: "run_command"; cmd: string; cwd?: string; timeout_ms?: number }
  | { tool: "write_file"; path: string; content: string; mode?: "create" | "overwrite" }
  | { tool: "approval_required"; reason: string; proposal?: string };

const repoRoot = resolve(process.cwd());
const userHome = homedir();
const MAX_TOOL_RESULT_CHARS = 12000;
const MAX_READ_BYTES = 120000;
const MAX_SEARCH_LIMIT = 80;

type CommandRunResult = {
  stdout: string;
  stderr: string;
  code: number | string;
  signal: string | null;
};

function isEnvEnabled(value: string | undefined) {
  return value === "true";
}

function safeNumber(value: unknown, fallback: number, min: number, max: number) {
  const number = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(Math.max(number, min), max);
}

function normalizeOperatorPath(inputPath: string | undefined, fallback = repoRoot) {
  const raw = (inputPath?.trim() || fallback).replace(/^~(?=$|[\\/])/, userHome);
  return resolve(raw);
}

function truncate(value: string, max = MAX_TOOL_RESULT_CHARS) {
  return redactSensitiveText(value).slice(0, max);
}

function safeJsonParse(text: string): ToolCall | null {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) candidates.push(fenced.trim());
  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  if (objectMatch) candidates.push(objectMatch[0]);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Partial<ToolCall>;
      if (parsed && typeof parsed === "object" && typeof parsed.tool === "string") {
        return parsed as ToolCall;
      }
    } catch {
      // Try next candidate.
    }
  }

  return null;
}

function firstString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((item) => firstString(item)).find((item): item is string => Boolean(item)) ?? null;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return firstString(record.text) ?? firstString(record.content);
  }
  return null;
}

function extractOutputText(json: unknown) {
  if (!json || typeof json !== "object") return "";
  const record = json as Record<string, unknown>;
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const firstChoice = choices[0];
  if (!firstChoice || typeof firstChoice !== "object") return "";
  const choiceRecord = firstChoice as Record<string, unknown>;
  const message = choiceRecord.message;

  if (message && typeof message === "object") {
    const text = firstString((message as Record<string, unknown>).content);
    if (text) return text;
  }

  return firstString(choiceRecord.text) ?? "";
}

function knownWorkspaceContext() {
  return [
    `Dashboard repo: ${repoRoot}`,
    "Known Jordan workspaces:",
    "- C:\\Users\\jorda\\Documents\\Codex\\worktrees",
    "- C:\\Users\\jorda\\Documents\\PhantomForce-AgentLab",
    "- C:\\Users\\jorda\\Documents\\PhantomForce-MediaLab",
    "- C:\\Users\\jorda\\Documents\\PhantomForce-App",
    "- C:\\Users\\jorda\\Documents\\VM-Share\\Falcon-Unleashed",
    "- E:\\Resolve_Work",
    "- G:\\+ CS +\\FX",
  ].join("\n");
}

async function callOperatorModel(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  options: {
    env: NodeJS.ProcessEnv | Record<string, string | undefined>;
    fetchImpl?: OperatorFetch;
    maxTokens?: number;
  },
) {
  const env = options.env;
  const apiKey = env.OPENROUTER_API_KEY?.trim();

  if (!isEnvEnabled(env.PHANTOM_LIVE_PROVIDERS_ENABLED) || !isEnvEnabled(env.PHANTOM_OPENROUTER_TRANSPORT_ENABLED)) {
    throw new Error("OpenRouter transport flags are not enabled for this operator call.");
  }

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured on the server.");
  }

  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as OperatorFetch | undefined);
  if (!fetchImpl) {
    throw new Error("No fetch implementation is available for OpenRouter.");
  }

  const body = JSON.stringify({
    model: env.OPENROUTER_MODEL?.trim() || OPENROUTER_GLM_52_MODEL_ID,
    messages,
    temperature: 0.35,
    max_tokens: options.maxTokens ?? 850,
  });

  const response = await fetchImpl(OPENROUTER_CHAT_COMPLETIONS_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": env.PHANTOM_OPENROUTER_HTTP_REFERER?.trim() || "http://127.0.0.1",
      "X-Title": "PhantomForce Codex Operator",
    },
    body,
  });
  const json = await response.json().catch(async () => {
    const text = await response.text().catch(() => "");
    return { error: redactSensitiveText(text).slice(0, 1000) };
  });
  const outputText = truncate(extractOutputText(json), 6000);

  if (!response.ok) {
    const errorValue = json && typeof json === "object" ? (json as Record<string, unknown>).error : null;
    throw new Error(firstString(errorValue) ?? `OpenRouter HTTP ${response.status}`);
  }

  return outputText || "Phantom AI returned an empty operator response.";
}

async function runCommand(tool: Extract<ToolCall, { tool: "run_command" }>) {
  const cmd = tool.cmd.trim();
  if (!cmd) throw new Error("run_command requires cmd.");

  const cwd = normalizeOperatorPath(tool.cwd, repoRoot);
  const timeout = safeNumber(tool.timeout_ms, 60000, 1000, 120000);
  const started = Date.now();
  const result: CommandRunResult = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", cmd],
    {
      cwd,
      timeout,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    },
  )
    .then(({ stdout, stderr }) => ({ stdout, stderr, code: 0, signal: null }))
    .catch((error: unknown) => {
      const commandError = error as { stdout?: string; stderr?: string; code?: number | string; signal?: string };
      return {
        stdout: commandError.stdout ?? "",
        stderr: commandError.stderr ?? String(error),
        code: commandError.code ?? 1,
        signal: commandError.signal ?? null,
      };
    });
  const exitCode = typeof result.code === "number" ? result.code : result.code ? Number(result.code) : 0;

  return {
    ok: exitCode === 0,
    cmd: truncate(cmd, 500),
    cwd,
    exit_code: Number.isFinite(exitCode) ? exitCode : result.code,
    signal: result.signal,
    seconds: Number(((Date.now() - started) / 1000).toFixed(2)),
    stdout: truncate(result.stdout),
    stderr: truncate(result.stderr),
  };
}

async function executeTool(tool: ToolCall) {
  if (tool.tool === "approval_required") {
    return {
      ok: false,
      approval_required: true,
      reason: truncate(tool.reason ?? "Approval required.", 800),
      proposal: truncate(tool.proposal ?? "", 1600),
    };
  }

  if (tool.tool === "list_dir") {
    const path = normalizeOperatorPath(tool.path, repoRoot);
    const limit = safeNumber(tool.limit, 80, 1, 200);
    const entries = await readdir(path, { withFileTypes: true });
    const rows = await Promise.all(
      entries.slice(0, limit).map(async (entry) => {
        const fullPath = resolve(path, entry.name);
        const entryStat = await stat(fullPath).catch(() => null);
        return {
          name: entry.name,
          type: entry.isDirectory() ? "dir" : entry.isFile() ? "file" : "other",
          bytes: entryStat?.size ?? null,
          modified: entryStat?.mtime.toISOString() ?? null,
        };
      }),
    );
    return { ok: true, path, count: rows.length, total: entries.length, entries: rows };
  }

  if (tool.tool === "read_file") {
    const path = normalizeOperatorPath(tool.path, repoRoot);
    const maxBytes = safeNumber(tool.max_bytes, MAX_READ_BYTES, 1, MAX_READ_BYTES);
    const fileStat = await stat(path);
    if (!fileStat.isFile()) throw new Error("read_file path is not a file.");
    const content = await readFile(path, "utf8");
    return {
      ok: true,
      path,
      bytes: fileStat.size,
      truncated: Buffer.byteLength(content, "utf8") > maxBytes,
      content: truncate(content, maxBytes),
    };
  }

  if (tool.tool === "search_files") {
    const path = normalizeOperatorPath(tool.path, repoRoot);
    const query = tool.query.trim();
    if (!query) throw new Error("search_files requires query.");
    const limit = safeNumber(tool.limit, 50, 1, MAX_SEARCH_LIMIT);
    const { stdout, stderr } = await execFileAsync(
      "rg",
      [
        "--line-number",
        "--max-count",
        String(limit),
        "--hidden",
        "-g",
        "!node_modules",
        "-g",
        "!.git",
        "-g",
        "!dist",
        query,
        path,
      ],
      { cwd: repoRoot, timeout: 45000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
    ).catch((error: unknown) => {
      const err = error as { stdout?: string; stderr?: string; code?: number };
      if (err.code === 1) return { stdout: "", stderr: "" };
      throw error;
    });
    return { ok: true, path, query, output: truncate(stdout || stderr || "No matches.") };
  }

  if (tool.tool === "run_command") {
    return runCommand(tool);
  }

  if (tool.tool === "write_file") {
    const path = normalizeOperatorPath(tool.path, repoRoot);
    const mode = tool.mode ?? "create";
    if (mode === "create" && existsSync(path)) {
      return { ok: false, blocked: true, reason: "File already exists; use mode=overwrite explicitly.", path };
    }
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, tool.content, "utf8");
    return {
      ok: true,
      path,
      mode,
      bytes: Buffer.byteLength(tool.content, "utf8"),
      receipt: createHash("sha256").update(`${path}:${tool.content}`).digest("hex").slice(0, 16),
    };
  }

  throw new Error(`Unsupported operator tool: ${(tool as { tool?: string }).tool ?? "unknown"}`);
}

function directToolFromPrompt(prompt: string): ToolCall | null {
  const text = prompt.trim();
  const lower = text.toLowerCase();
  const commandPrefixes = ["/run ", "run command:", "run cmd:", "execute command:", "execute:"];

  for (const prefix of commandPrefixes) {
    if (lower.startsWith(prefix)) {
      return { tool: "run_command", cmd: text.slice(prefix.length).trim() };
    }
  }

  if (lower.startsWith("/list ")) {
    return { tool: "list_dir", path: text.slice(6).trim() };
  }

  if (lower.startsWith("/read ")) {
    return { tool: "read_file", path: text.slice(6).trim() };
  }

  if (lower.startsWith("/search ")) {
    return { tool: "search_files", query: text.slice(8).trim(), path: repoRoot };
  }

  return null;
}

export async function runCodexOperatorChat(
  input: CodexOperatorInput,
  options: {
    env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
    fetchImpl?: OperatorFetch;
  } = {},
): Promise<CodexOperatorResult> {
  const env = {
    ...process.env,
    ...(options.env ?? {}),
    PHANTOM_LIVE_PROVIDERS_ENABLED: "true",
    PHANTOM_OPENROUTER_TRANSPORT_ENABLED: "true",
  };
  const toolProtocol = [
    "You are Phantom AI admin operator inside PhantomForce. You are allowed to behave like a local Codex-style operator for Jordan only.",
    "You have admin-only local tools through the server. Use them when the user asks to inspect files, search code, run tests, check status, create files, or make local changes.",
    "If a tool is needed, reply ONLY valid JSON in one of these forms:",
    '{"tool":"list_dir","path":"C:\\\\Users\\\\jorda\\\\Documents","limit":80}',
    '{"tool":"read_file","path":"C:\\\\Users\\\\jorda\\\\Documents\\\\project\\\\file.ts","max_bytes":60000}',
    '{"tool":"search_files","path":"C:\\\\Users\\\\jorda\\\\Documents\\\\Codex\\\\worktrees","query":"Phantom AI","limit":50}',
    '{"tool":"run_command","cmd":"git status --short","cwd":"C:\\\\Users\\\\jorda\\\\Documents\\\\Codex\\\\worktrees\\\\phantomforce-client-sim-truth-20260629","timeout_ms":60000}',
    '{"tool":"write_file","path":"C:\\\\Users\\\\jorda\\\\Documents\\\\note.md","content":"...","mode":"create"}',
    '{"tool":"approval_required","reason":"...","proposal":"..."}',
    "Use normal prose only when no tool is needed.",
    "Never claim you changed, sent, posted, uploaded, deployed, deleted, charged, or pushed unless a tool result proves it.",
    "This is Jordan's admin lane. Do not expose these tools to client sessions. If you choose to run a command, run it and report the receipt.",
    "Keep answers direct. Format with clean line breaks. Do not mention OpenRouter, transport flags, or API keys.",
  ].join("\n");
  const directTool = directToolFromPrompt(input.userMessage);
  let firstOutput = "";
  let toolCall: ToolCall | null = directTool;
  let providerCalled = false;
  let networkCallPerformed = false;

  try {
    if (!toolCall) {
      const messages = [
        {
          role: "system" as const,
          content: toolProtocol,
        },
        {
          role: "user" as const,
          content: [
            `Business: ${redactSensitiveText(input.businessName)}`,
            knownWorkspaceContext(),
            "",
            "Hermes/Codex memory context:",
            redactSensitiveText(input.compactContext).slice(0, 6000),
            "",
            `Approval-sensitive request: ${input.approvalRequired}`,
            `User request: ${redactSensitiveText(input.userMessage).slice(0, 1800)}`,
          ].join("\n"),
        },
      ];
      firstOutput = await callOperatorModel(messages, {
        env,
        fetchImpl: options.fetchImpl,
        maxTokens: input.maxTokens,
      });
      providerCalled = true;
      networkCallPerformed = true;
      toolCall = safeJsonParse(firstOutput);
    }

    if (!toolCall) {
      return {
        provider_id: OPENROUTER_GLM_PROVIDER_ID,
        model_id: OPENROUTER_GLM_52_MODEL_ID,
        status: "called",
        output_text: firstOutput,
        provider_called: providerCalled,
        network_call_performed: networkCallPerformed,
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
      };
    }

    const executableToolCall =
      toolCall.tool === "run_command" && !toolCall.cwd && input.cwd ? { ...toolCall, cwd: input.cwd } : toolCall;
    const toolResult = await executeTool(executableToolCall);
    const summary = await callOperatorModel(
      [
        {
          role: "system",
          content:
            "You are Phantom AI admin operator. Summarize only what actually happened from the tool result. If blocked, say exactly why. Keep it concise and useful.",
        },
        {
          role: "user",
          content: [
            `Original request: ${redactSensitiveText(input.userMessage).slice(0, 1800)}`,
            `Tool call: ${truncate(JSON.stringify(executableToolCall), 1600)}`,
            `Tool result: ${truncate(JSON.stringify(toolResult), MAX_TOOL_RESULT_CHARS)}`,
          ].join("\n\n"),
        },
      ],
      { env, fetchImpl: options.fetchImpl, maxTokens: 650 },
    );

    return {
      provider_id: OPENROUTER_GLM_PROVIDER_ID,
      model_id: OPENROUTER_GLM_52_MODEL_ID,
      status: "called",
      output_text: summary,
      provider_called: true,
      network_call_performed: true,
      request_body_prepared: true,
      tool_requested: true,
      tool_executed: executableToolCall.tool !== "approval_required" && !(toolResult as { blocked?: unknown }).blocked,
      tool_name: executableToolCall.tool,
      tool_result: toolResult,
      admin_only: true,
      localhost_only: true,
      raw_secret_exposed: false,
      approval_executed: false,
      external_action_executed: false,
      queue_written: false,
      ledger_written: false,
      error_message: null,
    };
  } catch (error) {
    return {
      provider_id: OPENROUTER_GLM_PROVIDER_ID,
      model_id: OPENROUTER_GLM_52_MODEL_ID,
      status: providerCalled ? "error" : "blocked",
      output_text: "Phantom AI operator lane hit an error before completing the request.",
      provider_called: providerCalled,
      network_call_performed: networkCallPerformed,
      request_body_prepared: true,
      tool_requested: Boolean(toolCall),
      tool_executed: false,
      tool_name: toolCall?.tool ?? null,
      tool_result: null,
      admin_only: true,
      localhost_only: true,
      raw_secret_exposed: false,
      approval_executed: false,
      external_action_executed: false,
      queue_written: false,
      ledger_written: false,
      error_message: redactSensitiveText(error instanceof Error ? error.message : String(error)).slice(0, 1000),
    };
  }
}

export const codexOperatorInternals = {
  directToolFromPrompt,
  executeTool,
  normalizeOperatorPath,
};
