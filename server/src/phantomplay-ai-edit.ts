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

import { callCodexCliChat } from "./phantom-ai/providers/codex-cli-transport.js";
import { callLocalOllamaChat } from "./phantom-ai/providers/local-ollama-transport.js";
import { callOpenRouterGlm52 } from "./phantom-ai/providers/openrouter-live-transport.js";

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
  provider?: PhantomPlayAiProvider;
  model?: string;
  timeoutMs?: number;
};

export type PhantomPlayAiProvider = "auto" | "codex" | "claude" | "openrouter" | "local";

export type PhantomPlayAiEditResult =
  | { ok: true; newContent: string; changed: boolean; provider: Exclude<PhantomPlayAiProvider, "auto">; model: string; raw: string }
  | { ok: false; error: string };

export type PhantomPlayAiEditProviderCall = (
  provider: Exclude<PhantomPlayAiProvider, "auto">,
  prompt: string,
  input: PhantomPlayAiEditInput,
  timeout: number,
) => Promise<{ raw: string; provider: Exclude<PhantomPlayAiProvider, "auto">; model: string }>;

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

function normalizedProvider(value: unknown): PhantomPlayAiProvider {
  return value === "codex" || value === "claude" || value === "openrouter" || value === "local" ? value : "auto";
}

function normalizedModel(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 180) : "";
}

async function callEditProvider(
  provider: Exclude<PhantomPlayAiProvider, "auto">,
  prompt: string,
  input: PhantomPlayAiEditInput,
  timeout: number,
): Promise<{ raw: string; provider: Exclude<PhantomPlayAiProvider, "auto">; model: string }> {
  const model = normalizedModel(input.model);
  const requestId = `phantomplay-edit-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  if (provider === "claude") {
    const claudeCommand = resolveClaudeCliCommand(process.env);
    const modelArgs = model && model !== "auto" ? ["--model", model] : [];
    const result = await runClaudeCliProcess(
      claudeCommand.command,
      [...claudeCommand.argsPrefix, ...modelArgs, "-p", prompt],
      resolve(input.cwd),
      timeout,
    );
    const raw = result.stdout || result.stderr || "";
    if ((result.code ?? 0) !== 0 && !raw.includes(BEGIN)) {
      throw new Error(`Claude exited with ${result.code}: ${(result.stderr || "no output").slice(0, 500)}`);
    }
    return { raw, provider, model: model || "claude-cli" };
  }

  if (provider === "codex") {
    const result = await callCodexCliChat({
      requestId,
      businessName: "PhantomPlay",
      taskType: "single-file game code edit",
      userMessage: prompt,
      compactContext: "Return the complete revised file only inside the exact PhantomPlay file markers supplied by the request.",
      approvalRequired: false,
      executionMode: "auto",
      cwd: input.cwd,
      maxTokens: 32_768,
    }, {
      env: {
        ...process.env,
        PHANTOM_CODEX_MODEL: model && model !== "auto" ? model : process.env.PHANTOM_CODEX_MODEL,
        PHANTOM_CODEX_SANDBOX: "read-only",
        PHANTOM_CODEX_TIMEOUT_MS: String(timeout),
      },
    });
    if (result.status !== "called") throw new Error(result.error_message || "Codex is unavailable.");
    return { raw: result.output_text, provider, model: result.model_id };
  }

  if (provider === "openrouter") {
    const result = await callOpenRouterGlm52({
      requestId,
      businessName: "PhantomPlay",
      taskType: "single-file game code edit",
      userMessage: prompt,
      compactContext: "Return the complete revised file only inside the exact PhantomPlay file markers supplied by the request.",
      sensitivityLevel: "low",
      approvalRequired: false,
      executionMode: "auto",
      maxTokens: 32_768,
      adminOperatorLane: true,
    }, {
      env: {
        ...process.env,
        OPENROUTER_MODEL: model && model !== "auto" ? model : process.env.OPENROUTER_MODEL,
      },
    });
    if (result.status !== "called") throw new Error(result.blocked_reason || result.error_message || "OpenRouter is unavailable.");
    return { raw: result.output_text, provider, model: model || result.model_id };
  }

  const result = await callLocalOllamaChat({
    requestId,
    businessName: "PhantomPlay",
    taskType: "single-file game code edit",
    userMessage: prompt,
    compactContext: "Return the complete revised file only inside the exact PhantomPlay file markers supplied by the request.",
    sensitivityLevel: "low",
    approvalRequired: false,
    executionMode: "auto",
    maxTokens: 32_768,
    adminOperatorLane: true,
  }, {
    env: {
      ...process.env,
      PHANTOM_OLLAMA_MODEL: model && model !== "auto" ? model : process.env.PHANTOM_OLLAMA_MODEL,
      PHANTOM_OLLAMA_TIMEOUT_MS: String(timeout),
    },
  });
  if (result.status !== "called") throw new Error(result.blocked_reason || result.error_message || "The local model is unavailable.");
  return { raw: result.output_text, provider, model: result.model_id };
}

export async function requestPhantomPlayAiEdit(
  input: PhantomPlayAiEditInput,
  options: { callProvider?: PhantomPlayAiEditProviderCall } = {},
): Promise<PhantomPlayAiEditResult> {
  if (!input.instruction.trim()) return { ok: false, error: "An instruction is required." };
  if (input.fileContent.length > MAX_FILE_CHARS) {
    return { ok: false, error: `File is too large for the AI panel (${input.fileContent.length} chars, max ${MAX_FILE_CHARS}). Edit it directly.` };
  }

  const cwd = resolve(input.cwd);
  const timeout = Math.min(Math.max(input.timeoutMs ?? 120000, 10000), 240000);

  const prompt = [
    "You are editing a single file inside a PhantomPlay game, live, while it may be running in a native player window with hot reload.",
    `Game: ${input.gameId}`,
    `File: ${input.filePath}`,
    "",
    "Rules:",
    "- Make the minimum change that satisfies the instruction. Preserve everything else exactly, including formatting style.",
    "- Preserve the file's existing language, file type, framework, build/runtime assumptions, and dependency policy. The result must remain valid for that project.",
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

  const selectedProvider = normalizedProvider(input.provider);
  const automaticProviders: Array<Exclude<PhantomPlayAiProvider, "auto">> = ["codex", "local", "claude", "openrouter"];
  // A manual choice is a priority, not a single point of failure. PhantomPlay
  // tries the selected route/model first, then recovers through the remaining
  // desktop-capable routes. A provider-specific model id is intentionally not
  // forwarded to fallback providers.
  const providers: Array<Exclude<PhantomPlayAiProvider, "auto">> = selectedProvider === "auto"
    ? automaticProviders
    : [selectedProvider, ...automaticProviders.filter((provider) => provider !== selectedProvider)];
  const failures: string[] = [];
  const providerCall = options.callProvider ?? callEditProvider;
  for (const provider of providers) {
    try {
      const result = await providerCall(provider, prompt, {
        ...input,
        cwd,
        model: selectedProvider === "auto" || provider === selectedProvider ? input.model : "",
      }, timeout);
      const newContent = extractFile(result.raw);
      if (newContent === null) {
        throw new Error("The model response did not include the required complete-file markers.");
      }
      return {
        ok: true,
        newContent,
        changed: newContent !== input.fileContent,
        provider: result.provider,
        model: result.model,
        raw: result.raw.slice(0, 2000),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const notFound = /ENOENT/i.test(message) || /not recognized/i.test(message) || /not found/i.test(message);
      failures.push(`${provider}: ${notFound ? "provider command is not available" : message}`);
    }
  }
  return {
    ok: false,
    error: selectedProvider === "auto"
      ? `No selected AI route completed the edit. ${failures.join(" ")}`
      : `The selected ${selectedProvider} route failed and automatic fallback was exhausted. ${failures.join(" ")}`,
  };
}
