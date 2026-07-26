import {
  EngineeringTaskPlanSchema,
  engineeringPlanIsReadOnly,
  type EngineeringCommandOperation,
  type EngineeringFileOperation,
  type EngineeringOperation,
  type EngineeringReadOperation,
  type EngineeringTaskPlan,
} from "@phantomforce/contracts";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rmdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";

import {
  type AgentRunArtifact,
  registerAgentRunExecutor,
} from "./agent-runs.js";
import { redactSensitiveText } from "./hermes-ledger.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../../..");

export const HERMES_ENGINEERING_READ_OPERATION = "hermes_engineering_read_plan";
export const HERMES_ENGINEERING_CHANGE_OPERATION = "hermes_engineering_change_plan";

const MAX_TEXT_BYTES = 262_144;
const MAX_COMMAND_OUTPUT_CHARS = 96_000;
const MAX_DIFF_OUTPUT_CHARS = 32_000;
const SKIP_DIRECTORIES = new Set([
  ".git",
  ".phantom",
  ".next",
  "coverage",
  "dist",
  "node_modules",
  "run-evidence",
]);
const TEXT_EXTENSIONS = new Set([
  "",
  ".cjs",
  ".css",
  ".csv",
  ".html",
  ".ini",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".ps1",
  ".scss",
  ".sql",
  ".svg",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);
const SENSITIVE_PATH = /(?:^|[\\/])(?:\.env(?:\.|$)|\.npmrc$|\.pypirc$|credentials?(?:\.|$)|cookies?(?:\.|$)|secrets?(?:\.|$)|tokens?(?:\.|$)|seed(?:phrase)?(?:\.|$)|id_[re]sa(?:\.|$)|[^/\\]*\.(?:key|pem|p12|pfx|kdbx))|(?:^|[\\/])\.ssh(?:[\\/]|$)/iu;
const SAFE_ARGUMENT = /^[a-zA-Z0-9_./:@=,+-]{1,300}$/u;
const SAFE_COMMIT_MESSAGE = /^[^\r\n\u0000]{1,200}$/u;
const FIXTURE_PATH = /(?:^|\/)(?:fixtures?|test-fixtures?|tmp)(?:\/|$)/iu;

type SafeTarget = {
  root: string;
  relativePath: string;
  absolutePath: string;
};

type CommandResult = {
  executable: string;
  args: string[];
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  output: string;
};

type RollbackEntry =
  | { kind: "restore_file"; path: string; contents: Buffer }
  | { kind: "remove_file"; path: string }
  | { kind: "move_back"; from: string; to: string }
  | { kind: "remove_directory"; path: string };

type EngineeringEvidence = {
  schemaVersion: 1;
  runId: string;
  planSummary: string;
  readOnly: boolean;
  operations: Array<{
    id: string;
    kind: EngineeringOperation["kind"];
    summary: string;
    ok: boolean;
    result: unknown;
  }>;
  rolledBack: boolean;
  rollback: Array<{ kind: string; path?: string; ok: boolean; error?: string }>;
  beforeDiff: string;
  afterDiff: string;
  verifiedAt: string;
};

function nowIso() {
  return new Date().toISOString();
}

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function assertNoSecretLikeText(value: string) {
  if (redactSensitiveText(value) !== value) throw new Error("secret_like_content_rejected");
}

function configuredWorkspaceRoot() {
  return resolve(process.env.PHANTOMBOT_OPERATOR_WORKSPACE_ROOT || repoRoot);
}

function artifactRoot() {
  return resolve(
    process.env.PHANTOM_AGENT_RUN_ARTIFACTS_DIR
      || resolve(repoRoot, ".phantom", "artifacts"),
  );
}

function isInside(root: string, target: string) {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function decodePath(value: string) {
  let decoded = value;
  for (let index = 0; index < 3; index += 1) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      throw new Error("encoded_path_invalid");
    }
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}

export function normalizeEngineeringPath(value: string, options: { allowRoot?: boolean } = {}) {
  const decoded = decodePath(String(value || "").trim());
  if (!decoded || decoded.includes("\u0000")) throw new Error("path_invalid");
  if (decoded.includes("/") && decoded.includes("\\")) throw new Error("mixed_path_separators_rejected");
  const portable = decoded.replace(/\\/g, "/");
  if (
    portable.startsWith("/")
    || portable.startsWith("//")
    || /^[a-zA-Z]:/u.test(portable)
    || /^[a-zA-Z][a-zA-Z0-9+.-]*:/u.test(portable)
  ) {
    throw new Error("absolute_path_rejected");
  }
  const parts = portable.split("/").filter((part) => part !== "");
  if (parts.some((part) => part === "..")) throw new Error("path_traversal_rejected");
  if (parts.some((part) => part === ".")) {
    if (!(options.allowRoot && parts.length === 1)) throw new Error("path_segment_invalid");
  }
  const normalized = parts.join("/");
  if (!normalized && !options.allowRoot) throw new Error("path_invalid");
  if (SENSITIVE_PATH.test(normalized)) throw new Error("sensitive_path_rejected");
  return normalized || ".";
}

async function rejectLinkedSegments(root: string, relativePath: string, allowMissingLeaf: boolean) {
  const parts = relativePath === "." ? [] : relativePath.split("/");
  let cursor = root;
  for (let index = 0; index < parts.length; index += 1) {
    cursor = resolve(cursor, parts[index]);
    try {
      const info = await lstat(cursor);
      if (info.isSymbolicLink()) throw new Error("linked_path_rejected");
    } catch (error) {
      if (
        allowMissingLeaf
        && index === parts.length - 1
        && (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return;
      }
      throw error;
    }
  }
}

async function safeTarget(
  rawPath: string,
  options: { allowRoot?: boolean; allowMissingLeaf?: boolean; textOnly?: boolean } = {},
): Promise<SafeTarget> {
  const root = await realpath(configuredWorkspaceRoot());
  const relativePath = normalizeEngineeringPath(rawPath, { allowRoot: options.allowRoot });
  const absolutePath = relativePath === "." ? root : resolve(root, ...relativePath.split("/"));
  if (!isInside(root, absolutePath)) throw new Error("path_outside_workspace");
  await rejectLinkedSegments(root, relativePath, Boolean(options.allowMissingLeaf));
  const parent = relativePath === "." ? root : dirname(absolutePath);
  const canonicalParent = await realpath(parent);
  if (!isInside(root, canonicalParent)) throw new Error("linked_parent_escape_rejected");
  if (options.textOnly) {
    const extension = extname(relativePath).toLowerCase();
    if (!TEXT_EXTENSIONS.has(extension)) throw new Error("binary_extension_rejected");
  }
  return { root, relativePath, absolutePath };
}

async function readSafeText(path: SafeTarget, maxBytes = 65_536) {
  const info = await stat(path.absolutePath);
  if (!info.isFile()) throw new Error("text_file_required");
  if (info.size > Math.min(MAX_TEXT_BYTES, maxBytes)) throw new Error("text_file_too_large");
  const contents = await readFile(path.absolutePath);
  if (contents.includes(0)) throw new Error("binary_file_rejected");
  return contents.toString("utf8");
}

function operatorChildEnvironment(): NodeJS.ProcessEnv {
  const allowedKeys = [
    "APPDATA",
    "ComSpec",
    "HOME",
    "HOMEDRIVE",
    "HOMEPATH",
    "LOCALAPPDATA",
    "NODE_ENV",
    "NUMBER_OF_PROCESSORS",
    "OS",
    "Path",
    "PATHEXT",
    "PROCESSOR_ARCHITECTURE",
    "SystemDrive",
    "SystemRoot",
    "TEMP",
    "TMP",
    "TRUFFLEHOG_BIN",
    "USERPROFILE",
    "windir",
  ];
  const env: NodeJS.ProcessEnv = { PHANTOMBOT_OPERATOR_RUN: "true" };
  for (const key of allowedKeys) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}

async function terminateChildTree(child: ReturnType<typeof spawn>) {
  if (!child.pid) return;
  if (process.platform !== "win32") {
    child.kill("SIGTERM");
    return;
  }
  await new Promise<void>((resolvePromise) => {
    const killer = spawn(
      "taskkill.exe",
      ["/pid", String(child.pid), "/t", "/f"],
      {
        windowsHide: true,
        shell: false,
        stdio: "ignore",
      },
    );
    killer.once("exit", () => resolvePromise());
    killer.once("error", () => {
      child.kill();
      resolvePromise();
    });
  });
}

async function runCommand(
  executable: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<CommandResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(executable, args, {
      cwd,
      env: operatorChildEnvironment(),
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let timedOut = false;
    let settled = false;
    const append = (chunk: Buffer) => {
      output = `${output}${chunk.toString("utf8")}`.slice(-MAX_COMMAND_OUTPUT_CHARS);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      rejectPromise(error);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      void terminateChildTree(child);
    }, timeoutMs);
    child.once("exit", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({
        executable: basename(executable),
        args,
        exitCode,
        signal,
        timedOut,
        output: redactSensitiveText(output),
      });
    });
  });
}

function commandExecutable(name: "git" | "powershell") {
  if (name === "powershell") return process.platform === "win32" ? "powershell.exe" : "pwsh";
  return "git";
}

function npmInvocation(args: string[]) {
  if (process.platform !== "win32") return { executable: "npm", args };
  return {
    executable: process.execPath,
    args: [resolve(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"), ...args],
  };
}

function assertSafeArgs(args: string[]) {
  if (args.some((arg) => !SAFE_ARGUMENT.test(arg))) throw new Error("command_argument_rejected");
}

async function gitOutput(root: string, args: string[], timeoutMs = 30_000) {
  assertSafeArgs(args);
  const result = await runCommand(commandExecutable("git"), args, root, timeoutMs);
  if (result.timedOut) throw new Error("git_command_timed_out");
  if (result.exitCode !== 0) throw new Error(`git_command_failed:${result.exitCode}`);
  return result.output.slice(-MAX_COMMAND_OUTPUT_CHARS);
}

async function walkFiles(
  root: string,
  start: string,
  depth: number,
  maxEntries: number,
) {
  const results: string[] = [];
  async function visit(absolute: string, relativeBase: string, remaining: number) {
    if (results.length >= maxEntries) return;
    const entries = await readdir(absolute, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (results.length >= maxEntries) break;
      if (entry.isSymbolicLink()) continue;
      const relativeEntry = relativeBase ? `${relativeBase}/${entry.name}` : entry.name;
      if (SENSITIVE_PATH.test(relativeEntry)) continue;
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name)) continue;
        results.push(`${relativeEntry}/`);
        if (remaining > 0) await visit(resolve(absolute, entry.name), relativeEntry, remaining - 1);
      } else if (entry.isFile()) {
        results.push(relativeEntry);
      }
    }
  }
  await visit(start, relative(root, start).split(sep).join("/"), depth);
  return results;
}

async function executeReadOperation(operation: EngineeringReadOperation) {
  const root = await realpath(configuredWorkspaceRoot());
  if (operation.kind === "repo_status") {
    return { output: await gitOutput(root, ["status", "--short", "--branch"]) };
  }
  if (operation.kind === "git_diff") {
    const args = ["diff", ...(operation.staged ? ["--cached"] : [])];
    if (operation.path) {
      const path = await safeTarget(operation.path, { allowMissingLeaf: true });
      args.push("--", path.relativePath);
    }
    return { output: await gitOutput(root, args) };
  }
  if (operation.kind === "git_log") {
    return { output: await gitOutput(root, ["log", `-${operation.limit}`, "--oneline", "--decorate"]) };
  }
  if (operation.kind === "read_text_file") {
    const target = await safeTarget(operation.path, { textOnly: true });
    const text = await readSafeText(target, operation.maxBytes);
    return {
      path: target.relativePath,
      sha256: sha256(text),
      bytes: Buffer.byteLength(text),
      text: redactSensitiveText(text),
    };
  }
  if (operation.kind === "inspect_package_scripts") {
    const target = await safeTarget(operation.path, { textOnly: true });
    if (basename(target.relativePath) !== "package.json") throw new Error("package_json_required");
    const parsed = JSON.parse(await readSafeText(target, MAX_TEXT_BYTES)) as Record<string, unknown>;
    const scripts = parsed.scripts && typeof parsed.scripts === "object"
      ? Object.fromEntries(Object.entries(parsed.scripts as Record<string, unknown>)
          .slice(0, 200)
          .map(([name, value]) => [name, redactSensitiveText(String(value)).slice(0, 500)]))
      : {};
    return { path: target.relativePath, scripts };
  }
  if (operation.kind === "list_files") {
    const target = await safeTarget(operation.path, { allowRoot: true });
    const info = await stat(target.absolutePath);
    if (!info.isDirectory()) throw new Error("directory_required");
    return {
      path: target.relativePath,
      entries: await walkFiles(target.root, target.absolutePath, operation.depth, operation.maxEntries),
    };
  }
  if (operation.kind === "search_text" || operation.kind === "find_tests") {
    const searchRoot = operation.kind === "find_tests"
      ? await safeTarget(".", { allowRoot: true })
      : await safeTarget(operation.path, { allowRoot: true });
    const query = operation.query.toLowerCase();
    const files = await walkFiles(
      searchRoot.root,
      searchRoot.absolutePath,
      5,
      Math.max(operation.maxResults * 20, 200),
    );
    const matches: Array<{ path: string; line?: number; text?: string }> = [];
    for (const file of files) {
      if (matches.length >= operation.maxResults || file.endsWith("/")) continue;
      const extension = extname(file).toLowerCase();
      if (!TEXT_EXTENSIONS.has(extension)) continue;
      if (
        operation.kind === "find_tests"
        && !/(?:^|\/)(?:tests?|__tests__|scripts)(?:\/|$)|(?:^|[.-])test(?:[.-]|$)|spec\./iu.test(file)
      ) {
        continue;
      }
      if (operation.kind === "find_tests" && (!query || file.toLowerCase().includes(query))) {
        matches.push({ path: file });
        continue;
      }
      try {
        const target = await safeTarget(file, { textOnly: true });
        const text = await readSafeText(target, MAX_TEXT_BYTES);
        text.split(/\r?\n/u).forEach((line, index) => {
          if (matches.length >= operation.maxResults) return;
          if (line.toLowerCase().includes(query)) {
            matches.push({
              path: target.relativePath,
              line: index + 1,
              text: redactSensitiveText(line).slice(0, 500),
            });
          }
        });
      } catch {
        // Unsupported, linked, oversized, or binary files are deliberately skipped.
      }
    }
    return { query: operation.query, matches };
  }
  if (operation.kind === "inspect_services") {
    if (process.platform !== "win32") {
      const result = await runCommand("ps", ["-eo", "pid,ppid,comm,args"], root, 15_000);
      return { output: result.output };
    }
    const staticScript = [
      "$pattern=$args[0]",
      "Get-CimInstance Win32_Process",
      "| Where-Object { $_.Name -match $pattern -or $_.CommandLine -match $pattern }",
      "| Select-Object ProcessId,ParentProcessId,Name,ExecutablePath",
      "| ConvertTo-Json -Compress",
    ].join(" ");
    const result = await runCommand(
      commandExecutable("powershell"),
      ["-NoProfile", "-NonInteractive", "-Command", staticScript, operation.namePattern],
      root,
      20_000,
    );
    if (result.exitCode !== 0) throw new Error("service_inspection_failed");
    return { output: result.output };
  }
  if (operation.kind === "inspect_listening_ports") {
    if (process.platform !== "win32") {
      const result = await runCommand("netstat", ["-lntp"], root, 15_000);
      return { output: result.output };
    }
    const requested = operation.ports.join(",");
    const staticScript = [
      "$ports=@()",
      "if($args[0]){$ports=$args[0].Split(',')|ForEach-Object{[int]$_}}",
      "$rows=Get-NetTCPConnection -State Listen",
      "if($ports.Count){$rows=$rows|Where-Object{$ports -contains $_.LocalPort}}",
      "$rows|Select-Object LocalAddress,LocalPort,OwningProcess|Sort-Object LocalPort|ConvertTo-Json -Compress",
    ].join(";");
    const result = await runCommand(
      commandExecutable("powershell"),
      ["-NoProfile", "-NonInteractive", "-Command", staticScript, requested],
      root,
      20_000,
    );
    if (result.exitCode !== 0) throw new Error("port_inspection_failed");
    return { output: result.output };
  }
  throw new Error(`unsupported_read_operation:${(operation as EngineeringOperation).kind}`);
}

async function atomicWrite(target: SafeTarget, contents: string) {
  const temp = `${target.absolutePath}.phantombot-${Date.now().toString(36)}.tmp`;
  await writeFile(temp, contents, "utf8");
  await rename(temp, target.absolutePath);
}

async function executeFileOperation(
  operation: EngineeringFileOperation,
  rollback: RollbackEntry[],
) {
  if (operation.kind === "create_directory") {
    const target = await safeTarget(operation.path, { allowMissingLeaf: true });
    try {
      await lstat(target.absolutePath);
      throw new Error("expected_directory_absent");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await mkdir(target.absolutePath);
    rollback.push({ kind: "remove_directory", path: target.absolutePath });
    return { path: target.relativePath, created: true };
  }
  if (operation.kind === "create_text_file") {
    assertNoSecretLikeText(operation.content);
    const target = await safeTarget(operation.path, { allowMissingLeaf: true, textOnly: true });
    try {
      await lstat(target.absolutePath);
      throw new Error("expected_file_absent");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await atomicWrite(target, operation.content);
    rollback.push({ kind: "remove_file", path: target.absolutePath });
    return { path: target.relativePath, sha256: sha256(operation.content), created: true };
  }
  if (operation.kind === "edit_text_file" || operation.kind === "append_text_file") {
    if (operation.kind === "append_text_file") {
      assertNoSecretLikeText(operation.content);
    } else {
      assertNoSecretLikeText(operation.expectedText);
      assertNoSecretLikeText(operation.replacementText);
    }
    const target = await safeTarget(operation.path, { textOnly: true });
    const before = await readFile(target.absolutePath);
    if (before.includes(0)) throw new Error("binary_file_rejected");
    if (sha256(before) !== operation.expectedSha256) throw new Error("expected_file_hash_mismatch");
    const beforeText = before.toString("utf8");
    let after: string;
    if (operation.kind === "append_text_file") {
      after = `${beforeText}${operation.content}`;
    } else {
      const occurrences = beforeText.split(operation.expectedText).length - 1;
      if (occurrences !== 1) throw new Error(`expected_text_occurrences:${occurrences}`);
      after = beforeText.replace(operation.expectedText, operation.replacementText);
    }
    rollback.push({ kind: "restore_file", path: target.absolutePath, contents: before });
    await atomicWrite(target, after);
    const saved = await readFile(target.absolutePath);
    if (sha256(saved) !== sha256(after)) throw new Error("saved_file_verification_failed");
    return {
      path: target.relativePath,
      beforeSha256: sha256(before),
      afterSha256: sha256(saved),
    };
  }
  if (operation.kind === "rename_file" || operation.kind === "move_file") {
    const source = await safeTarget(operation.fromPath, { textOnly: true });
    const destination = await safeTarget(operation.toPath, { allowMissingLeaf: true, textOnly: true });
    const before = await readFile(source.absolutePath);
    if (sha256(before) !== operation.expectedSha256) throw new Error("expected_file_hash_mismatch");
    try {
      await lstat(destination.absolutePath);
      throw new Error("expected_destination_absent");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await rename(source.absolutePath, destination.absolutePath);
    rollback.push({ kind: "move_back", from: destination.absolutePath, to: source.absolutePath });
    return {
      fromPath: source.relativePath,
      toPath: destination.relativePath,
      sha256: sha256(before),
    };
  }
  if (operation.kind === "delete_fixture_file") {
    const target = await safeTarget(operation.path, { textOnly: true });
    if (!FIXTURE_PATH.test(target.relativePath)) throw new Error("fixture_delete_path_required");
    const before = await readFile(target.absolutePath);
    if (sha256(before) !== operation.expectedSha256) throw new Error("expected_file_hash_mismatch");
    rollback.push({ kind: "restore_file", path: target.absolutePath, contents: before });
    await rm(target.absolutePath);
    return { path: target.relativePath, deleted: true, beforeSha256: sha256(before) };
  }
  throw new Error(`unsupported_file_operation:${(operation as EngineeringOperation).kind}`);
}

async function executeCommandOperation(operation: EngineeringCommandOperation) {
  const root = await realpath(configuredWorkspaceRoot());
  let executable = "";
  let args: string[] = [];
  if (operation.kind === "run_npm_script") {
    assertSafeArgs(operation.args);
    const packageJson = JSON.parse(await readSafeText(
      await safeTarget("package.json", { textOnly: true }),
      MAX_TEXT_BYTES,
    )) as Record<string, unknown>;
    const scripts = packageJson.scripts && typeof packageJson.scripts === "object"
      ? packageJson.scripts as Record<string, unknown>
      : {};
    if (typeof scripts[operation.script] !== "string") throw new Error("npm_script_not_declared");
    ({ executable, args } = npmInvocation([
      "run",
      operation.script,
      ...(operation.args.length ? ["--", ...operation.args] : []),
    ]));
  } else if (operation.kind === "run_typescript_build" || operation.kind === "run_typecheck") {
    if (operation.workspace && !SAFE_ARGUMENT.test(operation.workspace)) throw new Error("workspace_argument_rejected");
    ({ executable, args } = npmInvocation([
      "run",
      operation.kind === "run_typescript_build" ? "build" : "typecheck",
      ...(operation.workspace ? ["--workspace", operation.workspace] : []),
    ]));
  } else if (operation.kind === "run_powershell_script") {
    assertSafeArgs(operation.args);
    const target = await safeTarget(operation.path, { textOnly: true });
    if (
      extname(target.relativePath).toLowerCase() !== ".ps1"
      || !/^(?:scripts|server\/scripts)\//u.test(target.relativePath)
    ) {
      throw new Error("powershell_script_not_approved_path");
    }
    executable = commandExecutable("powershell");
    args = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", target.absolutePath, ...operation.args];
  } else if (operation.kind === "run_secret_scan") {
    ({ executable, args } = npmInvocation([
      "run",
      operation.strict ? "security:secrets:strict" : "security:secrets",
    ]));
  } else if (operation.kind === "git_add") {
    if (operation.paths.some((path) => !SAFE_ARGUMENT.test(normalizeEngineeringPath(path)))) {
      throw new Error("git_add_path_rejected");
    }
    executable = commandExecutable("git");
    args = ["add", "--", ...operation.paths.map((path) => normalizeEngineeringPath(path))];
  } else if (operation.kind === "git_commit") {
    if (!SAFE_COMMIT_MESSAGE.test(operation.message)) throw new Error("commit_message_rejected");
    executable = commandExecutable("git");
    args = ["commit", "-m", operation.message];
  } else {
    throw new Error(`unsupported_command_operation:${(operation as EngineeringOperation).kind}`);
  }
  const result = await runCommand(executable, args, root, operation.timeoutMs);
  if (result.timedOut) throw new Error(`approved_command_timed_out:${operation.kind}`);
  if (result.exitCode !== 0) {
    throw new Error(`approved_command_failed:${operation.kind}:${result.exitCode}`);
  }
  return {
    executable: result.executable,
    args: result.args,
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    outputTail: result.output.slice(-16_000),
    networkImplications: /(?:install|deploy|publish|release|push|start|dev|serve)/iu.test(args.join(" "))
      ? "repository script may access network or start a service; exact invocation was approval-bound"
      : "no network behavior inferred from the structured invocation",
  };
}

async function rollbackChanges(entries: RollbackEntry[]) {
  const evidence: EngineeringEvidence["rollback"] = [];
  for (const entry of [...entries].reverse()) {
    try {
      if (entry.kind === "restore_file") {
        await mkdir(dirname(entry.path), { recursive: true });
        await writeFile(entry.path, entry.contents);
        evidence.push({ kind: entry.kind, path: basename(entry.path), ok: true });
      } else if (entry.kind === "remove_file") {
        await rm(entry.path, { force: true });
        evidence.push({ kind: entry.kind, path: basename(entry.path), ok: true });
      } else if (entry.kind === "move_back") {
        await rename(entry.from, entry.to);
        evidence.push({ kind: entry.kind, path: basename(entry.to), ok: true });
      } else if (entry.kind === "remove_directory") {
        await rmdir(entry.path);
        evidence.push({ kind: entry.kind, path: basename(entry.path), ok: true });
      }
    } catch (error) {
      evidence.push({
        kind: entry.kind,
        path: "path" in entry ? basename(entry.path) : basename(entry.to),
        ok: false,
        error: redactSensitiveText((error as Error).message).slice(0, 300),
      });
    }
  }
  return evidence;
}

function parsePlan(value: unknown) {
  const plan = EngineeringTaskPlanSchema.parse(value);
  for (const operation of plan.operations) {
    if (operation.kind === "create_text_file" || operation.kind === "append_text_file") {
      assertNoSecretLikeText(operation.content);
    }
    if (operation.kind === "edit_text_file") {
      assertNoSecretLikeText(operation.expectedText);
      assertNoSecretLikeText(operation.replacementText);
    }
  }
  return plan;
}

async function writeEvidence(runId: string, evidence: EngineeringEvidence) {
  const root = artifactRoot();
  await mkdir(root, { recursive: true });
  const path = resolve(root, `${runId}-hermes-engineering-plan.json`);
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  await writeFile(path, serialized, "utf8");
  return path;
}

async function executePlan(
  runId: string,
  rawPlan: unknown,
  progress: (note: string) => Promise<void>,
  isCancelled: () => boolean,
) {
  const plan = parsePlan(rawPlan);
  const readOnly = engineeringPlanIsReadOnly(plan);
  const root = await realpath(configuredWorkspaceRoot());
  const beforeDiff = (await gitOutput(root, ["diff", "--no-ext-diff"]).catch(() => ""))
    .slice(-MAX_DIFF_OUTPUT_CHARS);
  const rollback: RollbackEntry[] = [];
  const evidence: EngineeringEvidence = {
    schemaVersion: 1,
    runId,
    planSummary: plan.summary,
    readOnly,
    operations: [],
    rolledBack: false,
    rollback: [],
    beforeDiff,
    afterDiff: "",
    verifiedAt: nowIso(),
  };
  try {
    for (const operation of plan.operations) {
      if (isCancelled()) throw new Error("cancelled");
      await progress(`${operation.id}: ${operation.summary}`);
      let result: unknown;
      if (
        EngineeringTaskPlanSchema.safeParse({
          ...plan,
          operations: [operation],
        }).success === false
      ) {
        throw new Error("operation_schema_invalid");
      }
      if (
        [
          "repo_status",
          "search_text",
          "list_files",
          "read_text_file",
          "inspect_package_scripts",
          "git_diff",
          "git_log",
          "find_tests",
          "inspect_services",
          "inspect_listening_ports",
        ].includes(operation.kind)
      ) {
        result = await executeReadOperation(operation as EngineeringReadOperation);
      } else if (
        [
          "edit_text_file",
          "create_text_file",
          "append_text_file",
          "rename_file",
          "move_file",
          "create_directory",
          "delete_fixture_file",
        ].includes(operation.kind)
      ) {
        result = await executeFileOperation(operation as EngineeringFileOperation, rollback);
      } else {
        result = await executeCommandOperation(operation as EngineeringCommandOperation);
      }
      evidence.operations.push({
        id: operation.id,
        kind: operation.kind,
        summary: operation.summary,
        ok: true,
        result,
      });
    }
    evidence.afterDiff = (await gitOutput(root, ["diff", "--no-ext-diff"]).catch(() => ""))
      .slice(-MAX_DIFF_OUTPUT_CHARS);
    evidence.verifiedAt = nowIso();
    const path = await writeEvidence(runId, evidence);
    const artifact: AgentRunArtifact = {
      kind: "json",
      path,
      summary: `${plan.operations.length} typed engineering operation(s) completed and verified.`,
    };
    return { plan, evidence, artifact, failure: null };
  } catch (error) {
    evidence.operations.push({
      id: "failure",
      kind: "repo_status",
      summary: "Plan failed closed.",
      ok: false,
      result: redactSensitiveText((error as Error).message).slice(0, 500),
    });
    evidence.rolledBack = rollback.length > 0;
    evidence.rollback = await rollbackChanges(rollback);
    evidence.afterDiff = (await gitOutput(root, ["diff", "--no-ext-diff"]).catch(() => ""))
      .slice(-MAX_DIFF_OUTPUT_CHARS);
    evidence.verifiedAt = nowIso();
    const path = await writeEvidence(runId, evidence);
    const artifact: AgentRunArtifact = {
      kind: "json",
      path,
      summary: evidence.rolledBack
        ? "Typed engineering plan failed and its file mutations were rolled back."
        : "Typed engineering plan failed closed before a file rollback was needed.",
    };
    return {
      plan,
      evidence,
      artifact,
      failure:
        `${redactSensitiveText((error as Error).message).slice(0, 300)}`
        + `:evidence:${basename(path)}`
        + (evidence.rolledBack ? ":rolled_back" : ""),
    };
  }
}

function registerEngineeringExecutor(
  operation: string,
  readOnly: boolean,
) {
  registerAgentRunExecutor(operation, {
    title: readOnly ? "Hermes engineering inspection" : "Hermes governed engineering task",
    description: readOnly
      ? "Runs a bounded, read-only engineering evidence plan inside one canonical workspace."
      : "Runs an exact approval-bound sequence of typed file and development operations.",
    risk: readOnly ? "low_internal" : "never_silent",
    requiredRole: "org_manager",
    scope: readOnly
      ? "One canonical workspace, read-only text/Git/service inspection, bounded redacted output."
      : "One canonical workspace and only the exact typed operations present in the approved immutable plan.",
    expectedEffect: readOnly
      ? "Produce redacted engineering evidence without changing workspace files."
      : "Apply only the approved typed operations, verify each result, and roll back file mutations if the plan fails.",
    rollbackGuidance: readOnly
      ? "No rollback is needed for read-only inspection."
      : "Use the run evidence rollback section; file mutations are restored automatically when execution or verification fails.",
    async execute(ctx) {
      const plan = parsePlan(ctx.run.inputs.plan);
      if (plan.workspace !== ctx.run.workspace) throw new Error("engineering_plan_workspace_mismatch");
      if (engineeringPlanIsReadOnly(plan) !== readOnly) throw new Error("engineering_plan_risk_mismatch");
      const result = await executePlan(
        ctx.run.id,
        plan,
        ctx.progress,
        ctx.isCancelled,
      );
      return {
        artifacts: [result.artifact],
        summary: result.failure || result.artifact.summary,
        actualEffect: readOnly
          ? `Inspected ${plan.operations.length} bounded engineering target(s).`
          : `Executed ${plan.operations.length} exact approval-bound engineering operation(s).`,
      };
    },
    async verify(ctx, artifacts) {
      if (artifacts.length !== 1) return { ok: false, detail: "expected_one_engineering_evidence_artifact" };
      try {
        const evidence = JSON.parse(await readFile(artifacts[0].path, "utf8")) as EngineeringEvidence;
        const plan = parsePlan(ctx.run.inputs.plan);
        if (evidence.runId !== ctx.run.id) return { ok: false, detail: "engineering_evidence_run_mismatch" };
        const failedOperation = evidence.operations.find((operation) => !operation.ok);
        const failureDetail = failedOperation
          ? redactSensitiveText(String(failedOperation.result)).slice(0, 180)
          : "unknown";
        if (evidence.rolledBack) {
          const rollbackOk = evidence.rollback.length > 0
            && evidence.rollback.every((entry) => entry.ok);
          return {
            ok: false,
            detail: `engineering_plan_rolled_back:${rollbackOk ? "verified" : "incomplete"}:${failureDetail}`,
          };
        }
        if (failedOperation) {
          return { ok: false, detail: `engineering_plan_failed_closed:${failureDetail}` };
        }
        if (evidence.operations.filter((operation) => operation.ok).length !== plan.operations.length) {
          return { ok: false, detail: "engineering_operation_count_mismatch" };
        }
        return {
          ok: true,
          detail: `${plan.operations.length} typed operation(s) verified with bounded redacted evidence.`,
        };
      } catch (error) {
        return {
          ok: false,
          detail: `engineering_evidence_invalid:${redactSensitiveText((error as Error).message).slice(0, 180)}`,
        };
      }
    },
  });
}

registerEngineeringExecutor(HERMES_ENGINEERING_READ_OPERATION, true);
registerEngineeringExecutor(HERMES_ENGINEERING_CHANGE_OPERATION, false);

export function parseEngineeringTaskPlan(value: unknown): EngineeringTaskPlan {
  return parsePlan(value);
}

export function engineeringOperationForPlan(plan: EngineeringTaskPlan) {
  return engineeringPlanIsReadOnly(plan)
    ? HERMES_ENGINEERING_READ_OPERATION
    : HERMES_ENGINEERING_CHANGE_OPERATION;
}
