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
  engine?: string;
  projectFiles?: string[];
  provider?: PhantomPlayAiProvider;
  model?: string;
  fallbackProvider?: PhantomPlayAiProvider;
  allowFallbacks?: boolean;
  openRouterCredential?: string;
  timeoutMs?: number;
};

export type PhantomPlayAiProvider = "auto" | "codex" | "claude" | "openrouter" | "local";

export type PhantomPlayAiFailureCode =
  | "api_key_invalid"
  | "insufficient_credits"
  | "permission_denied"
  | "rate_limited"
  | "provider_timeout"
  | "provider_unavailable"
  | "invalid_model_response";

export type PhantomPlayAiProviderFailure = {
  provider: Exclude<PhantomPlayAiProvider, "auto">;
  code: PhantomPlayAiFailureCode;
  summary: string;
  action: string;
};

export type PhantomPlayAiEditResult =
  | { ok: true; newContent: string; changed: boolean; provider: Exclude<PhantomPlayAiProvider, "auto">; model: string; raw: string }
  | { ok: false; error: string; code?: PhantomPlayAiFailureCode; summary?: string; failures?: PhantomPlayAiProviderFailure[] };

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

export function explainPhantomPlayProviderFailure(
  provider: Exclude<PhantomPlayAiProvider, "auto">,
  rawMessage: string,
): PhantomPlayAiProviderFailure {
  const message = rawMessage.trim();
  const status = Number(message.match(/(?:HTTP|status(?: code)?)\s*[:=]?\s*(\d{3})/iu)?.[1] || 0);

  if (provider === "openrouter" && (status === 401 || /invalid api key|authentication|unauthorized|revoked/iu.test(message))) {
    return {
      provider,
      code: "api_key_invalid",
      summary: "OpenRouter API key invalid or expired (HTTP 401).",
      action: "Replace it in PhantomForce Settings → Bridges & Connectors, then retry.",
    };
  }
  if (provider === "openrouter" && (status === 402 || /insufficient (?:credits|balance)|payment required/iu.test(message))) {
    return {
      provider,
      code: "insufficient_credits",
      summary: "OpenRouter has insufficient credits (HTTP 402).",
      action: "Add credits or use another AI route.",
    };
  }
  if (provider === "openrouter" && status === 403) {
    return {
      provider,
      code: "permission_denied",
      summary: "OpenRouter denied access to this model (HTTP 403).",
      action: "Check the key permissions or choose a model available to this account.",
    };
  }
  if (status === 429 || /rate limit|too many requests|quota/iu.test(message)) {
    return {
      provider,
      code: "rate_limited",
      summary: `${provider === "openrouter" ? "OpenRouter" : provider} is rate-limited (HTTP 429).`,
      action: "Wait briefly or choose another AI route.",
    };
  }
  if (/timed? out|timeout/iu.test(message)) {
    return {
      provider,
      code: "provider_timeout",
      summary: `${provider === "local" ? "Local model" : provider} timed out before returning a complete file.`,
      action: "Retry with a faster model or a smaller active file.",
    };
  }
  if (/complete-file markers/iu.test(message)) {
    return {
      provider,
      code: "invalid_model_response",
      summary: `${provider === "local" ? "Local model" : provider} response was incomplete: required complete-file markers were missing.`,
      action: "Retry or choose a stronger code model.",
    };
  }
  if (/empty file|invalid json|json is invalid|dropped the document root|invalid model response/iu.test(message)) {
    return {
      provider,
      code: "invalid_model_response",
      summary: message.replace(/^The model/iu, `${provider === "local" ? "Local model" : provider}`),
      action: "Nothing was saved. Retry or choose a stronger code model.",
    };
  }
  if (/command failed|exited with|not available|unavailable|enoent|not recognized|not found/iu.test(message)) {
    const label = provider === "codex" ? "Codex desktop fallback"
      : provider === "claude" ? "Claude desktop fallback"
        : provider === "local" ? "Local model fallback"
          : "OpenRouter";
    return {
      provider,
      code: "provider_unavailable",
      summary: `${label} could not start or complete the edit.`,
      action: provider === "codex"
        ? "Check Codex sign-in and the local Codex bridge."
        : provider === "local"
          ? "Check that the local model service is running and has enough context capacity."
          : `Check the ${provider} bridge configuration.`,
    };
  }
  return {
    provider,
    code: "provider_unavailable",
    summary: `${provider === "local" ? "Local model" : provider} could not complete the edit.`,
    action: "Check this route in PhantomForce Settings → Bridges & Connectors or choose another route.",
  };
}

function projectLanguageGuidance(filePath: string, engine: string) {
  const extension = filePath.toLowerCase().split(".").pop() || "";
  if (extension === "gd" || engine.toLowerCase().includes("godot")) {
    return "This is a Godot project. Preserve valid GDScript/scene conventions and the project's existing node architecture.";
  }
  if (extension === "cs" || engine.toLowerCase().includes("unity")) {
    return "This is a Unity project. Preserve valid C# and the project's existing Unity component and serialization conventions.";
  }
  if (["cpp", "cc", "cxx", "h", "hpp"].includes(extension) || engine.toLowerCase().includes("unreal")) {
    return "This is an Unreal/native C++ project. Preserve valid C++ and the project's existing engine macros, ownership, and build conventions.";
  }
  if (extension === "py" || engine.toLowerCase().includes("panda")) {
    return "This is a Python/Panda3D project. Preserve valid Python and the project's existing scene, task, and asset-loading conventions.";
  }
  if (["html", "js", "mjs", "css", "json", "ts", "tsx"].includes(extension)) {
    return "This is a web game file. Keep it compatible with the project's existing browser runtime and build assumptions.";
  }
  return "Preserve the active file's language, engine conventions, and existing project architecture.";
}

export function validatePhantomPlayAiEdit(input: PhantomPlayAiEditInput, newContent: string): string | null {
  if (!newContent.trim()) return "The model returned an empty file.";
  if (newContent.includes("\0")) return "The model returned invalid NUL bytes.";
  if (newContent.length > MAX_FILE_CHARS) return `The revised file exceeds the ${MAX_FILE_CHARS} character safety limit.`;
  const extension = input.filePath.toLowerCase().split(".").pop() || "";
  if (extension === "json") {
    try {
      JSON.parse(newContent);
    } catch (error) {
      return `The revised JSON is invalid: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  if (
    extension === "html"
    && input.fileContent.toLowerCase().includes("<html")
    && !newContent.toLowerCase().includes("<html")
  ) {
    return "The revised HTML dropped the document root.";
  }
  return null;
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
        PHANTOM_LIVE_PROVIDERS_ENABLED: input.openRouterCredential ? "true" : process.env.PHANTOM_LIVE_PROVIDERS_ENABLED,
        PHANTOM_OPENROUTER_TRANSPORT_ENABLED: input.openRouterCredential ? "true" : process.env.PHANTOM_OPENROUTER_TRANSPORT_ENABLED,
        OPENROUTER_API_KEY: input.openRouterCredential || process.env.OPENROUTER_API_KEY,
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
    "You are editing the active source file inside a PhantomPlay game. The accepted file is saved transactionally with undo history and the compatible running preview is reloaded.",
    `Game: ${input.gameId}`,
    `File: ${input.filePath}`,
    `Engine: ${input.engine?.trim() || "Detected by PhantomPlay"}`,
    projectLanguageGuidance(input.filePath, input.engine || ""),
    ...(input.projectFiles?.length
      ? ["Project file map (for architecture awareness; only the active file may be returned):", ...input.projectFiles.slice(0, 160).map((file) => `- ${file.slice(0, 300)}`)]
      : []),
    "",
    "Rules:",
    "- Make the minimum change that satisfies the instruction. Preserve everything else exactly, including formatting style.",
    "- Preserve the file's existing language, file type, framework, build/runtime assumptions, and dependency policy. The result must remain valid for that project.",
    "- Keep the file valid for its detected engine and current project. Do not convert engines, invent dependencies, or claim to edit files you were not given.",
    "- Implement the requested behavior directly. Do not return a plan, analysis, patch, Markdown fence, or hidden reasoning.",
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
  const selectedFallback = normalizedProvider(input.fallbackProvider);
  const allowFallbacks = input.allowFallbacks !== false;
  const automaticProviders: Array<Exclude<PhantomPlayAiProvider, "auto">> = ["codex", "local", "claude", "openrouter"];
  // A manual choice is a priority, not a single point of failure. PhantomPlay
  // tries the selected route/model first, then recovers through the remaining
  // desktop-capable routes. A provider-specific model id is intentionally not
  // forwarded to fallback providers.
  const fallbackFirst = selectedFallback === "auto" ? [] : [selectedFallback];
  const orderedFallbacks = [
    ...fallbackFirst,
    ...automaticProviders,
  ].filter((provider, index, values) => values.indexOf(provider) === index);
  const providers: Array<Exclude<PhantomPlayAiProvider, "auto">> = selectedProvider === "auto"
    ? (allowFallbacks ? orderedFallbacks : [orderedFallbacks[0] ?? "codex"])
    : allowFallbacks
      ? [selectedProvider, ...orderedFallbacks.filter((provider) => provider !== selectedProvider)]
      : [selectedProvider];
  const failures: PhantomPlayAiProviderFailure[] = [];
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
      const validationError = validatePhantomPlayAiEdit(input, newContent);
      if (validationError) throw new Error(validationError);
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
      const failure = explainPhantomPlayProviderFailure(provider, message);
      failures.push(failure);
      const selectedRouteNeedsConfiguration = selectedProvider !== "auto"
        && provider === selectedProvider
        && ["api_key_invalid", "insufficient_credits", "permission_denied"].includes(failure.code);
      if (selectedRouteNeedsConfiguration) break;
    }
  }
  const primary = failures[0];
  const fallbackSummary = failures
    .slice(1)
    .map((failure) => failure.summary)
    .join(" ");
  return {
    ok: false,
    code: primary?.code,
    summary: primary?.summary || "No AI route completed the edit.",
    failures,
    error: [
      primary?.summary || "No AI route completed the edit.",
      primary?.action,
      fallbackSummary ? `Automatic fallbacks also failed: ${fallbackSummary}` : "",
    ].filter(Boolean).join(" "),
  };
}
