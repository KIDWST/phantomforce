import { createHash, randomUUID } from "node:crypto";
import { existsSync, createReadStream } from "node:fs";
import { mkdir, realpath, readdir, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, parse, relative, resolve } from "node:path";

import { executeEngineWorker, type EngineWorkerResult, type EngineCommandEvidence } from "./phantomplay-engine-worker.js";
import { redactSensitiveText } from "./phantom-ai/hermes-ledger.js";
import {
  requestPhantomPlayAiEdit,
  type PhantomPlayAiFailureCode,
  type PhantomPlayAiProvider,
  type PhantomPlayAiProviderFailure,
} from "./phantomplay-ai-edit.js";

const MAX_INSTRUCTION_CHARS = 12_000;
const MAX_PROJECT_FILES = 240;
const MAX_SNAPSHOT_FILES = 4_000;
const SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".phantom",
  ".idea",
  ".vs",
  ".vscode",
  "binaries",
  "build",
  "builds",
  "deriveddatacache",
  "dist",
  "intermediate",
  "node_modules",
  "saved",
  "target",
]);
const PROJECT_MARKERS = [
  ".git",
  "package.json",
  "Cargo.toml",
  "project.godot",
  "pyproject.toml",
  "CMakeLists.txt",
];

export type PhantomPlayEngineCommandInput = {
  gameId: string;
  projectTitle: string;
  cwd: string;
  engine?: string;
  projectFiles?: string[];
  instruction: string;
  provider?: PhantomPlayAiProvider;
  model?: string;
  fallbackProvider?: PhantomPlayAiProvider;
  allowFallbacks?: boolean;
  openRouterCredential?: string;
  timeoutMs?: number;
};

export type PhantomPlayEngineCommandSuccess = {
  ok: true;
  runId: string;
  status: "changes_applied" | "no_changes" | "review_required";
  summary: string;
  plannerProvider: Exclude<PhantomPlayAiProvider, "auto">;
  plannerModel: string;
  executorProvider: "codex";
  executorModel: string;
  changedFiles: string[];
  receiptPath: string;
  seconds: number;
  commands: EngineCommandEvidence[];
  snapshotComplete: boolean;
};

export type PhantomPlayEngineCommandFailure = {
  ok: false;
  error: string;
  code?: PhantomPlayAiFailureCode | "invalid_project" | "execution_failed" | "project_busy";
  summary?: string;
  failures?: PhantomPlayAiProviderFailure[];
  runId?: string;
  receiptPath?: string;
  changedFiles?: string[];
};

export type PhantomPlayEngineCommandResult =
  | PhantomPlayEngineCommandSuccess
  | PhantomPlayEngineCommandFailure;

type PlannerResult = {
  ok: true;
  plan: string;
  provider: Exclude<PhantomPlayAiProvider, "auto">;
  model: string;
} | PhantomPlayEngineCommandFailure;

export type EngineAgentOptions = {
  plan?: (input: PhantomPlayEngineCommandInput, cwd: string) => Promise<PlannerResult>;
  execute?: (input: PhantomPlayEngineCommandInput, cwd: string, runId: string, plan: string) => Promise<EngineWorkerResult>;
  runId?: string;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
};

function normalizeProvider(value: unknown): PhantomPlayAiProvider {
  return value === "codex" || value === "claude" || value === "openrouter" || value === "local" ? value : "auto";
}

function safeRelativePath(value: string) {
  const normalized = value.replace(/\\/gu, "/").replace(/^\.\//u, "");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").some(part => part === "..") || normalized.includes(":")) return null;
  return normalized.slice(0, 360);
}

async function hasProjectMarker(cwd: string, projectFiles: string[]) {
  if (PROJECT_MARKERS.some((marker) => existsSync(join(cwd, marker)))) return true;
  const entries = await readdir(cwd).catch(() => []);
  if (entries.some((entry) => entry.toLowerCase().endsWith(".uproject"))) return true;
  return projectFiles.some((file) => {
    const candidate = safeRelativePath(file);
    return candidate ? existsSync(join(cwd, candidate)) : false;
  });
}

export async function validatePhantomPlayEngineProject(input: PhantomPlayEngineCommandInput) {
  const cwd = await realpath(resolve(input.cwd?.trim() || "")).catch(() => resolve(input.cwd?.trim() || ""));
  const driveRoot = parse(cwd).root;
  const profile = await realpath(resolve(process.env.USERPROFILE || process.env.HOME || dirname(cwd))).catch(() => "");
  if (!input.cwd?.trim() || cwd.toLowerCase() === driveRoot.toLowerCase() || cwd.toLowerCase() === profile.toLowerCase() || cwd.toLowerCase() === dirname(profile).toLowerCase()) {
    throw new Error("Phantom Engine refused an unsafe project root. Select the game project folder, not a drive or profile root.");
  }
  const details = await stat(cwd).catch(() => null);
  if (!details?.isDirectory()) throw new Error("The selected Phantom Engine project folder does not exist.");
  if (cwd.replace(/\\/gu, "/").toLowerCase().includes("/deployments/")) throw new Error("Select the development project, not the installed/live deployment. Engine changes must be built and checked before publishing.");
  const projectFiles = (input.projectFiles ?? []).map(safeRelativePath).filter((file): file is string => Boolean(file)).slice(0, MAX_PROJECT_FILES);
  if (!(await hasProjectMarker(cwd, projectFiles))) {
    throw new Error("Phantom Engine could not verify this as a game project. Add or select a project file before running Auto Build.");
  }
  return { cwd, projectFiles };
}

async function hashFile(path: string) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest("hex");
}

async function snapshotProject(root: string) {
  const snapshot = new Map<string, string>();
  let complete = true;
  const pending = [root];
  while (pending.length && snapshot.size < MAX_SNAPSHOT_FILES) {
    const folder = pending.pop()!;
    const entries = await readdir(folder, { withFileTypes: true }).catch(() => { complete = false; return []; });
    for (const entry of entries) {
      if (snapshot.size >= MAX_SNAPSHOT_FILES) { complete = false; break; }
      if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name.toLowerCase())) continue;
      const absolute = join(folder, entry.name);
      if (entry.isDirectory()) {
        pending.push(absolute);
      } else if (entry.isFile()) {
        const key = relative(root, absolute).replace(/\\/gu, "/");
        snapshot.set(key, await hashFile(absolute).catch(() => { complete = false; return "unreadable"; }));
      }
    }
  }
  return { files: snapshot, complete: complete && pending.length === 0 };
}

function changedPaths(before: Map<string, string>, after: Map<string, string>) {
  const keys = new Set([...before.keys(), ...after.keys()]);
  return [...keys]
    .filter((key) => before.get(key) !== after.get(key))
    .sort((left, right) => left.localeCompare(right))
    .slice(0, 500);
}

async function defaultPlan(input: PhantomPlayEngineCommandInput, cwd: string): Promise<PlannerResult> {
  // Codex plans and executes in one project-scoped run. Avoid the read-only chat adapter.
  if (!input.provider || input.provider === "auto" || input.provider === "codex") {
    return { ok: true, plan: "Inspect the repository, plan the requested changes, implement them, then test them.", provider: "codex", model: input.model || "configured default" };
  }
  if (input.provider === "claude") return { ok: false, code: "execution_failed", error: "Claude planning is not yet isolated for multi-file Engine jobs. Select OpenRouter, local, or Codex in Connections. No files were changed." };
  const seed = JSON.stringify({
    schema_version: "1.0",
    summary: "",
    acceptance_checks: [],
    tasks: [],
  }, null, 2);
  const projectFiles = (input.projectFiles ?? []).map(safeRelativePath).filter((file): file is string => Boolean(file)).slice(0, MAX_PROJECT_FILES);
  const result = await requestPhantomPlayAiEdit({
    gameId: input.gameId,
    filePath: ".phantom/engine-plan.json",
    fileContent: seed,
    instruction: [
      "Replace this JSON with a concise, executable Phantom Engine build blueprint for the user's command.",
      "Keep these exact top-level keys: schema_version, summary, acceptance_checks, tasks.",
      "Each task must have id, objective, files_or_systems, verification, and status='planned'.",
      "Cover code, licensed asset/model sourcing when requested, integration, build, and verification as applicable.",
      "Do not claim work is complete; this is the planning stage for a separate local execution agent.",
      `User command: ${input.instruction.trim().slice(0, MAX_INSTRUCTION_CHARS)}`,
    ].join("\n"),
    cwd,
    engine: input.engine,
    projectFiles,
    provider: normalizeProvider(input.provider),
    model: input.model,
    fallbackProvider: normalizeProvider(input.fallbackProvider),
    allowFallbacks: input.allowFallbacks,
    openRouterCredential: input.openRouterCredential,
    timeoutMs: input.timeoutMs,
  });
  if (!result.ok) return result;
  return { ok: true, plan: result.newContent, provider: result.provider, model: result.model };
}

async function defaultExecute(
  input: PhantomPlayEngineCommandInput,
  cwd: string,
  runId: string,
  plan: string,
  options: EngineAgentOptions,
): Promise<EngineWorkerResult> {
  void runId;
  return executeEngineWorker({ cwd, instruction: `Selected game: ${input.projectTitle || input.gameId} (${input.gameId}).\nSelected project files: ${(input.projectFiles || []).map(safeRelativePath).filter(Boolean).join(", ")}\nDo not modify sibling games or unrelated project files.\n\n${input.instruction}`, plan,
    model: input.provider === "codex" ? input.model : undefined,
    timeoutMs: Math.min(Math.max(input.timeoutMs ?? 600_000, 30_000), 1_800_000),
    signal: options.signal, onProgress: options.onProgress });
}

function compactSummary(value: string) {
  return redactSensitiveText(value).replace(/\s+/gu, " ").trim().slice(0, 1_400) || "Worker ended without a summary. Review the changed files and command evidence.";
}

async function writeReceipt(cwd: string, receipt: Record<string, unknown>) {
  const root = join(cwd, ".phantom");
  await mkdir(root, { recursive: true });
  const actualRoot = await realpath(root);
  if (relative(cwd, actualRoot).replace(/\\/gu, "/").split("/").includes("..") || parse(actualRoot).root.toLowerCase() !== parse(cwd).root.toLowerCase()) throw new Error("Receipt root resolves outside the project.");
  const directory = join(cwd, ".phantom", "engine-runs");
    await mkdir(directory, { recursive: true });
    const actual = await realpath(directory);
    if (relative(cwd, actual).replace(/\\/gu, "/").split("/").includes("..") || parse(actual).root.toLowerCase() !== parse(cwd).root.toLowerCase()) throw new Error("Receipt folder resolves outside the project. Run evidence was not written there.");
  const destination = join(directory, `${String(receipt.run_id)}.json`);
  const temporary = `${destination}.tmp`;
  await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  await rename(temporary, destination);
  return relative(cwd, destination).replace(/\\/gu, "/");
}

const activeProjects = new Set<string>();

export async function requestPhantomPlayEngineCommand(
  input: PhantomPlayEngineCommandInput,
  options: EngineAgentOptions = {},
): Promise<PhantomPlayEngineCommandResult> {
  const instruction = input.instruction?.trim();
  if (!instruction) return { ok: false, code: "invalid_project", error: "Tell Phantom Engine what to build, fix, or finish." };
  if (instruction.length > MAX_INSTRUCTION_CHARS) {
    return { ok: false, code: "invalid_project", error: `The command exceeds the ${MAX_INSTRUCTION_CHARS} character safety limit.` };
  }

  let cwd: string;
  try {
    ({ cwd } = await validatePhantomPlayEngineProject(input));
  } catch (error) {
    return { ok: false, code: "invalid_project", error: error instanceof Error ? error.message : String(error) };
  }

  const projectKey = cwd.toLowerCase();
  if (activeProjects.has(projectKey)) return { ok: false, code: "project_busy", error: "An Engine worker is already modifying this project. Wait for that run to finish." };
  activeProjects.add(projectKey);
  try {
  const runId = options.runId || `pe-${new Date().toISOString().replace(/[-:.TZ]/gu, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`;
  const started = Date.now();
  options.onProgress?.("Planning the requested work…");
  const planner = await (options.plan ?? defaultPlan)(input, cwd);
  if (!planner.ok) return planner;
  if (options.signal?.aborted) return { ok: false, code: "execution_failed", error: "Cancelled before execution. No files were changed." };

  const before = await snapshotProject(cwd);
  options.onProgress?.("Executing in the selected project…");
  const execution = await (options.execute ? options.execute(input, cwd, runId, planner.plan) : defaultExecute(input, cwd, runId, planner.plan, options))
    .catch((error): EngineWorkerResult => ({ status: "error", outputText: "", model: "unknown", errorMessage: String(error), commands: [] }));
  options.onProgress?.("Recording changed files and command evidence…");
  const after = await snapshotProject(cwd);
  const changedFiles = changedPaths(before.files, after.files);
  const snapshotComplete = before.complete && after.complete;
  const seconds = Number(((Date.now() - started) / 1000).toFixed(2));
  const status = !snapshotComplete || execution.status !== "called" || execution.commands.some(command => command.exitCode !== 0) ? "review_required" : changedFiles.length ? "changes_applied" : "no_changes";
  const receipt = {
    schema_version: "1.0",
    run_id: runId,
    created_at: new Date().toISOString(),
    project_id: input.gameId,
    project_title: input.projectTitle,
    project_root_basename: basename(cwd),
    engine: input.engine || "detected",
    instruction: redactSensitiveText(instruction.slice(0, MAX_INSTRUCTION_CHARS)),
    planner: { provider: planner.provider, model: planner.model },
    executor: { provider: "codex", model: execution.model },
    status,
    changed_files: changedFiles,
    snapshot_complete: snapshotComplete,
    commands: execution.commands,
    error: execution.errorMessage ? redactSensitiveText(execution.errorMessage) : null,
    verification_note: "File changes and command exit codes are observed. Visual quality, gameplay acceptance and deployment are NOT verified by this receipt. Build artifacts, saves and dependencies are excluded from the snapshot. No automatic rollback is claimed.",
    summary: compactSummary(execution.outputText),
    seconds,
  };
  let receiptPath: string;
  try { receiptPath = await writeReceipt(cwd, receipt); }
  catch (error) { return { ok: false, code: "execution_failed", runId, changedFiles, error: `Worker ended with ${changedFiles.length} detected file changes, but its receipt could not be saved: ${redactSensitiveText(String(error))}. Inspect project changes before retrying.` }; }
  if (execution.status !== "called") return { ok: false, code: "execution_failed", runId, receiptPath, changedFiles, error: `${redactSensitiveText(execution.errorMessage || "Worker failed.")} Recorded ${changedFiles.length} changed files. Receipt: ${receiptPath}` };
  return {
    ok: true,
    runId,
    status,
    summary: compactSummary(execution.outputText),
    plannerProvider: planner.provider,
    plannerModel: planner.model,
    executorProvider: "codex",
    executorModel: execution.model,
    changedFiles,
    receiptPath,
    seconds,
    commands: execution.commands,
    snapshotComplete,
  };
  } catch (error) {
    return { ok: false, code: "execution_failed", error: redactSensitiveText(String(error)) };
  } finally { activeProjects.delete(projectKey); }
}
