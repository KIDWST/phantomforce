import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  appendFile,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  writeFile,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import type { EngineeringTaskPlan } from "@phantomforce/contracts";
import type { AccessSession } from "../access/session.js";
import {
  getAgentRun,
  registerAgentRunExecutor,
  serializeAgentRun,
  startAgentRun,
  type AgentRun,
  type AgentRunArtifact,
} from "./agent-runs.js";
import {
  HermesAcpTransport,
  type HermesAcpCapabilities,
  type HermesAcpNormalizedEvent,
} from "./hermes-acp-transport.js";
import { redactSensitiveText } from "./hermes-ledger.js";
import {
  engineeringOperationForPlan,
  parseEngineeringTaskPlan,
} from "./hermes-engineering-tools.js";
import { composeHermesEcosystemContext } from "./hermes-ecosystem-knowledge.js";
import { createBrainMemory } from "./neural-spine.js";
import {
  MAX_PROMPT_CHARS,
  type PromptIntegrityEnvelope,
} from "./prompt-integrity.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../../..");

export const HERMES_DOCUMENTATION_PATCH_OPERATION = "hermes_documentation_patch";
export const DEFAULT_HERMES_ACP_SESSIONS_PATH = resolve(
  repoRoot,
  ".phantom",
  "hermes-acp-sessions.jsonl",
);

const MAX_EVENTS = 500;
const MAX_PATCH_TEXT_CHARS = 4_000;
const MAX_COMMAND_OUTPUT_CHARS = 64_000;
const ALLOWED_TEST_COMMANDS = new Map<string, { executable: string; args: string[] }>([
  [
    "npm run test:phantombot-desktop",
    process.platform === "win32"
      ? {
          executable: process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe",
          args: ["/d", "/s", "/c", "npm.cmd run test:phantombot-desktop"],
        }
      : {
          executable: "npm",
          args: ["run", "test:phantombot-desktop"],
        },
  ],
]);

export type HermesDocumentationPatchIntent = {
  version: 1;
  operation: "documentation_patch";
  relativePath: string;
  expectedText: string;
  replacementText: string;
  testCommand: "npm run test:phantombot-desktop";
  summary: string;
};

export type HermesOperatorSessionState =
  | "connecting"
  | "planning"
  | "awaiting_approval"
  | "approved"
  | "executing"
  | "verifying"
  | "completed"
  | "denied"
  | "failed"
  | "cancelled"
  | "blocked";

export type HermesOperatorSessionRecord = {
  id: string;
  schemaVersion: 1;
  organizationId: string;
  workspace: string;
  actorUserId: string;
  accessSessionId: string;
  prompt: string;
  promptIntegrity: PromptIntegrityEnvelope | null;
  summary: string;
  state: HermesOperatorSessionState;
  hermesSessionId: string | null;
  hermesCapabilities: HermesAcpCapabilities | null;
  events: HermesAcpNormalizedEvent[];
  assistantText: string;
  intent: HermesDocumentationPatchIntent | EngineeringTaskPlan | null;
  agentRunId: string | null;
  receiptId: string | null;
  receiptVerified: boolean | null;
  memoryId: string | null;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  reopenCount: number;
};

type OperatorStoreOptions = {
  sessionsPath?: string;
  workspaceRoot?: string;
  hermesExecutable?: string;
  hermesArgs?: string[];
  env?: NodeJS.ProcessEnv;
};

const sessions = new Map<string, HermesOperatorSessionRecord>();
const activeTransports = new Map<string, HermesAcpTransport>();
const operatorSessionChangeEvents = new EventEmitter();
operatorSessionChangeEvents.setMaxListeners(200);
let loadedPath: string | null = null;

function nowIso() {
  return new Date().toISOString();
}

function nextEventSequence(record: Pick<HermesOperatorSessionRecord, "events">) {
  return record.events.reduce(
    (highest, event) => Math.max(highest, Number(event.sequence) || 0),
    0,
  ) + 1;
}

function clean(value: unknown, max = 1_000) {
  return redactSensitiveText(String(value ?? "").replace(/\s+/g, " ").trim()).slice(0, max);
}

function sessionId() {
  return `pbacp-${Date.now().toString(36)}-${randomUUID().slice(0, 10)}`;
}

function sessionsPath(options: OperatorStoreOptions = {}) {
  return resolve(
    options.sessionsPath
    || process.env.PHANTOM_HERMES_ACP_SESSIONS_PATH
    || DEFAULT_HERMES_ACP_SESSIONS_PATH,
  );
}

function configuredWorkspaceRoot(options: OperatorStoreOptions = {}) {
  return resolve(
    options.workspaceRoot
    || process.env.PHANTOMBOT_OPERATOR_WORKSPACE_ROOT
    || repoRoot,
  );
}

function pathKey(value: string) {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function isInside(root: string, target: string) {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

async function canonicalWorkspace(options: OperatorStoreOptions = {}) {
  return realpath(configuredWorkspaceRoot(options));
}

function candidateHermesExecutables(env: NodeJS.ProcessEnv) {
  const explicit = clean(env.PHANTOMBOT_HERMES_EXECUTABLE, 1_000);
  const localAppData = clean(env.LOCALAPPDATA, 1_000);
  const pathEntries = String(env.PATH || env.Path || "")
    .split(sep)
    .filter(Boolean)
    .flatMap((entry) => [
      resolve(entry.replace(/^"|"$/g, ""), process.platform === "win32" ? "hermes.exe" : "hermes"),
      resolve(entry.replace(/^"|"$/g, ""), process.platform === "win32" ? "hermes.cmd" : "hermes"),
    ]);
  return [
    explicit,
    ...pathEntries,
    localAppData
      ? resolve(localAppData, "Hermes", "hermes-agent", "venv", "Scripts", "hermes.exe")
      : "",
  ].filter(Boolean);
}

async function resolveHermesExecutable(options: OperatorStoreOptions = {}) {
  const env = options.env ?? process.env;
  if (options.hermesExecutable) return resolve(options.hermesExecutable);
  for (const candidate of candidateHermesExecutables(env)) {
    try {
      if ((await lstat(candidate)).isFile()) return resolve(candidate);
    } catch {
      // Continue through supported discovery locations.
    }
  }
  throw new Error("hermes_acp_executable_not_found");
}

function isSessionRecord(value: unknown): value is HermesOperatorSessionRecord {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return row.schemaVersion === 1
    && typeof row.id === "string"
    && typeof row.organizationId === "string"
    && typeof row.workspace === "string"
    && typeof row.actorUserId === "string"
    && Array.isArray(row.events);
}

async function loadStore(options: OperatorStoreOptions = {}) {
  const target = sessionsPath(options);
  if (loadedPath === target) return;
  sessions.clear();
  try {
    const raw = await readFile(target, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        if (isSessionRecord(row)) sessions.set(row.id, row);
      } catch {
        // Malformed historical rows are ignored rather than breaking recovery.
      }
    }
  } catch {
    // A missing journal is a valid first start.
  }
  loadedPath = target;
}

async function persist(record: HermesOperatorSessionRecord, options: OperatorStoreOptions = {}) {
  const target = sessionsPath(options);
  await mkdir(dirname(target), { recursive: true });
  record.updatedAt = nowIso();
  sessions.set(record.id, structuredClone(record));
  const persisted = {
    ...record,
    prompt: "[private prompt omitted; integrity metadata retained]",
  };
  await appendFile(target, `${JSON.stringify(persisted)}\n`, "utf8");
  operatorSessionChangeEvents.emit(record.id, record.id);
}

export function subscribeHermesOperatorSession(id: string, listener: () => void) {
  operatorSessionChangeEvents.on(id, listener);
  return () => operatorSessionChangeEvents.off(id, listener);
}

function sessionScope(session: AccessSession, workspace: string) {
  return {
    organizationId: clean(session.orgId || session.clientId || workspace, 180),
    actorUserId: clean(session.userId || session.email || session.id, 180),
    accessSessionId: clean(session.id, 180),
  };
}

function canAccessRecord(session: AccessSession, record: HermesOperatorSessionRecord) {
  const orgId = clean(session.orgId || session.clientId || record.workspace, 180);
  const actorId = clean(session.userId || session.email || session.id, 180);
  return record.organizationId === orgId && record.actorUserId === actorId;
}

function publicRecord(record: HermesOperatorSessionRecord) {
  return {
    ...record,
    prompt: "[private prompt omitted]",
    events: record.events.slice(-MAX_EVENTS),
  };
}

function eventText(events: HermesAcpNormalizedEvent[]) {
  return events
    .filter((event) => event.type === "message_delta")
    .map((event) => event.summary)
    .join("")
    .slice(0, 128_000);
}

export function parseHermesDocumentationIntent(
  assistantText: string,
): HermesDocumentationPatchIntent | null {
  const tagged = assistantText.match(
    /<phantom_tool_intent>\s*([\s\S]*?)\s*<\/phantom_tool_intent>/i,
  );
  const fenced = assistantText.match(/```json\s*([\s\S]*?)\s*```/i);
  const raw = tagged?.[1] || fenced?.[1];
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (
    row.version !== 1
    || row.operation !== "documentation_patch"
    || row.testCommand !== "npm run test:phantombot-desktop"
  ) {
    return null;
  }
  const relativePath = String(row.relativePath || "").replace(/\\/g, "/").trim();
  const expectedText = String(row.expectedText || "");
  const replacementText = String(row.replacementText || "");
  if (
    !relativePath.startsWith("docs/")
    || !relativePath.endsWith(".md")
    || relativePath.includes("..")
    || isAbsolute(relativePath)
    || !expectedText
    || !replacementText
    || expectedText.length > MAX_PATCH_TEXT_CHARS
    || replacementText.length > MAX_PATCH_TEXT_CHARS
  ) {
    return null;
  }
  return {
    version: 1,
    operation: "documentation_patch",
    relativePath,
    expectedText,
    replacementText,
    testCommand: "npm run test:phantombot-desktop",
    summary: clean(row.summary, 300) || `Update ${relativePath} and run desktop runtime tests.`,
  };
}

export function parseHermesEngineeringPlan(assistantText: string): EngineeringTaskPlan | null {
  const tagged = assistantText.match(
    /<phantom_engineering_plan>\s*([\s\S]*?)\s*<\/phantom_engineering_plan>/i,
  );
  if (!tagged?.[1]) return null;
  try {
    return parseEngineeringTaskPlan(JSON.parse(tagged[1]));
  } catch {
    return null;
  }
}

export function planningPrompt(userPrompt: string, workspace: string) {
  return [
    "You are Hermes, the governed engineering planner inside PhantomBot.",
    "This planning turn is Observe mode. Inspect and reason, but do not edit files, run commands, install, deploy, restart services, use credentials, or use network tools.",
    "Propose only bounded typed operations. PhantomForce, not Hermes, executes the validated plan.",
    "Read operations: repo_status; search_text(query,path,maxResults); list_files(path,depth,maxEntries); read_text_file(path,maxBytes); inspect_package_scripts(path); git_diff(staged,path); git_log(limit); find_tests(query,maxResults); inspect_services(namePattern); inspect_listening_ports(ports).",
    "File operations: edit_text_file(path,expectedSha256,expectedText,replacementText); create_text_file(path,expectedAbsent:true,content); append_text_file(path,expectedSha256,content); rename_file/move_file(fromPath,toPath,expectedSha256,expectedDestinationAbsent:true); create_directory(path,expectedAbsent:true); delete_fixture_file(path,expectedSha256).",
    "Command operations: run_npm_script(script,args,timeoutMs); run_typescript_build(workspace,timeoutMs); run_typecheck(workspace,timeoutMs); run_powershell_script(path,args,timeoutMs); run_secret_scan(strict,timeoutMs). Git add or commit, if truly needed, must be a separate single-operation plan.",
    "Every operation needs a unique id, kind, and concise summary. Paths are project-relative. Writes require exact current hashes/state. Include only actions necessary for this request; do not grant future discretion.",
    "Read-only plans run without approval. Any write or command requires explicit approval of the immutable full plan.",
    "Classify the request before planning: new_project, repository_modification, debugging, explanation, reasoning, artifact_generation, tool_required, unsafe, or genuinely_ambiguous.",
    "For a new project, choose a reasonable structure and plan its creation. Never request repository files that do not exist.",
    "Do not refuse a safe task merely because it is large. Break it into bounded operations while preserving every requirement.",
    "Maintain a requirement ledger with objective, deliverables, constraints, files, algorithms, tests, prohibitions, response format, and final instruction. Do not stop after the first section.",
    "Explain your evidence concisely, then end with exactly one JSON block using this shape:",
    "<phantom_engineering_plan>",
    '{"version":1,"workspace":"workspace label","summary":"bounded task summary","operations":[{"id":"inspect-1","kind":"repo_status","summary":"Inspect repository state"}],"verification":{"inspectDiff":true,"requireCleanRollback":true}}',
    "</phantom_engineering_plan>",
    "If no safe, evidence-backed bounded plan is possible, do not emit the block.",
    composeHermesEcosystemContext(userPrompt, workspace),
    `Workspace label: ${workspace}`,
    "User request (formatting and later instructions are authoritative):",
    redactSensitiveText(userPrompt),
  ].join("\n");
}

export async function createHermesOperatorSession(
  session: AccessSession,
  input: { prompt: string; workspace: string; promptIntegrity?: PromptIntegrityEnvelope | null },
  options: OperatorStoreOptions = {},
) {
  await loadStore(options);
  const workspace = clean(input.workspace, 180);
  const prompt = redactSensitiveText(String(input.prompt ?? "").replace(/\r\n?/g, "\n").trim()).slice(0, MAX_PROMPT_CHARS);
  if (!workspace) throw new Error("workspace_required");
  if (!prompt) throw new Error("prompt_required");
  const scope = sessionScope(session, workspace);
  const record: HermesOperatorSessionRecord = {
    id: sessionId(),
    schemaVersion: 1,
    organizationId: scope.organizationId,
    workspace,
    actorUserId: scope.actorUserId,
    accessSessionId: scope.accessSessionId,
    prompt,
    promptIntegrity: input.promptIntegrity ?? null,
    summary: prompt.slice(0, 240),
    state: "connecting",
    hermesSessionId: null,
    hermesCapabilities: null,
    events: [],
    assistantText: "",
    intent: null,
    agentRunId: null,
    receiptId: null,
    receiptVerified: null,
    memoryId: null,
    errorCode: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    closedAt: null,
    reopenCount: 0,
  };
  await persist(record, options);
  void planHermesOperatorSession(record.id, options);
  return publicRecord(record);
}

export async function planHermesOperatorSession(
  id: string,
  options: OperatorStoreOptions = {},
) {
  await loadStore(options);
  const record = sessions.get(id);
  if (!record) throw new Error("hermes_operator_session_not_found");
  const executable = await resolveHermesExecutable(options);
  const workspaceRoot = await canonicalWorkspace(options);
  const transport = new HermesAcpTransport({
    executable,
    args: options.hermesArgs,
    workspaceRoot,
    env: options.env ?? process.env,
    requestTimeoutMs: Number(process.env.PHANTOM_HERMES_ACP_TIMEOUT_MS || 180_000),
  });
  activeTransports.set(id, transport);
  transport.on("event", (event: HermesAcpNormalizedEvent) => {
    if (record.state === "cancelled") return;
    const previous = record.events.at(-1);
    if (event.type !== "analyzing" || previous?.type !== "analyzing") {
      record.events.push({
        ...event,
        sequence: nextEventSequence(record),
      });
    }
    record.events = record.events.slice(-MAX_EVENTS);
    if (event.type === "connecting") record.state = "connecting";
    if (event.type === "connected" || event.type === "analyzing") record.state = "planning";
    void persist(record, options).catch(() => undefined);
  });
  try {
    record.hermesCapabilities = await transport.initialize();
    const created = await transport.newSession();
    record.hermesSessionId = created.sessionId;
    record.state = "planning";
    await persist(record, options);
    await transport.prompt(
      created.sessionId,
      planningPrompt(record.prompt, record.workspace),
    );
    if ((record.state as HermesOperatorSessionState) === "cancelled") {
      return publicRecord(record);
    }
    record.assistantText = eventText(record.events);
    record.intent = parseHermesEngineeringPlan(record.assistantText)
      || parseHermesDocumentationIntent(record.assistantText);
    if (!record.intent) {
      record.state = "blocked";
      record.errorCode = "hermes_safe_intent_missing";
      record.events.push({
        sequence: nextEventSequence(record),
        at: nowIso(),
        type: "blocked",
        summary: "Hermes did not produce a valid governed documentation action.",
      });
      await persist(record, options);
      return publicRecord(record);
    }
    const engineeringPlan = "operations" in record.intent ? record.intent : null;
    const documentationIntent = engineeringPlan ? null : record.intent as HermesDocumentationPatchIntent;
    const operation = engineeringPlan
      ? engineeringOperationForPlan(engineeringPlan)
      : HERMES_DOCUMENTATION_PATCH_OPERATION;
    const inputs = engineeringPlan
      ? {
          hermesOperatorSessionId: record.id,
          hermesSessionId: record.hermesSessionId,
          plan: engineeringPlan,
        }
      : {
          hermesOperatorSessionId: record.id,
          hermesSessionId: record.hermesSessionId,
          relativePath: documentationIntent!.relativePath,
          expectedText: documentationIntent!.expectedText,
          replacementText: documentationIntent!.replacementText,
          testCommand: documentationIntent!.testCommand,
        };
    const started = await startAgentRun({
      operation,
      workspace: record.workspace,
      organizationId: record.organizationId,
      module: "phantombot",
      sessionId: record.accessSessionId,
      request: record.intent.summary,
      tenantId: record.organizationId,
      businessName: record.workspace,
      requestedBy: record.actorUserId,
      idempotencyKey: `hermes-acp:${record.id}:${createHash("sha256")
        .update(JSON.stringify(record.intent))
        .digest("hex")}`,
      inputs,
    });
    if (!("id" in started)) throw new Error(started.error);
    record.agentRunId = started.id;
    record.state = started.state === "awaiting_approval" ? "awaiting_approval" : "executing";
    record.events.push({
      sequence: nextEventSequence(record),
      at: nowIso(),
      type: started.state === "awaiting_approval" ? "approval_required" : "operation_started",
      summary: started.state === "awaiting_approval"
        ? `Approval is required for ${engineeringPlan?.operations.length ?? 2} exact governed operation(s).`
        : `Running ${engineeringPlan?.operations.length ?? 1} bounded read-only engineering operation(s).`,
      data: { agentRunId: started.id },
    });
    await persist(record, options);
    return publicRecord(record);
  } catch (error) {
    if ((record.state as HermesOperatorSessionState) === "cancelled") {
      return publicRecord(record);
    }
    record.state = "failed";
    record.errorCode = clean((error as Error).message, 180) || "hermes_acp_failed";
    record.events.push({
      sequence: nextEventSequence(record),
      at: nowIso(),
      type: "failed",
      summary: "Hermes could not complete the governed planning turn.",
    });
    await persist(record, options);
    return publicRecord(record);
  } finally {
    activeTransports.delete(id);
    transport.close();
  }
}

export async function getHermesOperatorSession(
  session: AccessSession,
  id: string,
  options: OperatorStoreOptions = {},
) {
  await loadStore(options);
  const record = sessions.get(id);
  if (!record || !canAccessRecord(session, record)) return null;
  await reconcileHermesOperatorSession(session, record, options);
  return publicRecord(record);
}

export async function listHermesOperatorSessions(
  session: AccessSession,
  options: OperatorStoreOptions = {},
) {
  await loadStore(options);
  const records = [...sessions.values()]
    .filter((record) => canAccessRecord(session, record))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 50);
  for (const record of records) {
    await reconcileHermesOperatorSession(session, record, options);
  }
  return records.map(publicRecord);
}

export async function closeHermesOperatorSession(
  session: AccessSession,
  id: string,
  options: OperatorStoreOptions = {},
) {
  await loadStore(options);
  const record = sessions.get(id);
  if (!record || !canAccessRecord(session, record)) return null;
  activeTransports.get(id)?.close();
  activeTransports.delete(id);
  record.closedAt = nowIso();
  await persist(record, options);
  return publicRecord(record);
}

export async function reopenHermesOperatorSession(
  session: AccessSession,
  id: string,
  options: OperatorStoreOptions = {},
) {
  await loadStore(options);
  const record = sessions.get(id);
  if (!record || !canAccessRecord(session, record)) return null;
  record.closedAt = null;
  record.reopenCount += 1;
  record.events.push({
    sequence: nextEventSequence(record),
    at: nowIso(),
    type: "connected",
    summary: record.hermesSessionId
      ? "The durable PhantomBot session reopened with its Hermes session mapping."
      : "The durable PhantomBot session reopened from PhantomForce state.",
  });
  await reconcileHermesOperatorSession(session, record, options);
  await persist(record, options);
  return publicRecord(record);
}

export async function cancelHermesOperatorSession(
  session: AccessSession,
  id: string,
  options: OperatorStoreOptions = {},
) {
  await loadStore(options);
  const record = sessions.get(id);
  if (!record || !canAccessRecord(session, record)) return null;
  if (record.hermesSessionId) activeTransports.get(id)?.cancel(record.hermesSessionId);
  record.state = "cancelled";
  record.events.push({
    sequence: nextEventSequence(record),
    at: nowIso(),
    type: "cancelled",
    summary: "The operator session was cancelled.",
  });
  await persist(record, options);
  return publicRecord(record);
}

async function reconcileHermesOperatorSession(
  accessSession: AccessSession,
  record: HermesOperatorSessionRecord,
  options: OperatorStoreOptions,
) {
  if (!record.agentRunId) return;
  const run = getAgentRun(record.agentRunId);
  if (!run) return;
  let changed = false;
  const stateMap: Partial<Record<AgentRun["state"], HermesOperatorSessionState>> = {
    awaiting_approval: "awaiting_approval",
    approved: "approved",
    queued: "approved",
    executing: "executing",
    verifying: "verifying",
    succeeded: "completed",
    completed: "completed",
    partially_succeeded: "completed",
    rejected: "denied",
    expired: "denied",
    failed: "failed",
    cancelled: "cancelled",
  };
  const mapped = stateMap[run.state];
  if (mapped && record.state !== mapped) {
    record.state = mapped;
    changed = true;
    const eventType: HermesAcpNormalizedEvent["type"] =
      mapped === "completed" ? "completed"
      : mapped === "denied" ? "blocked"
      : mapped === "failed" ? "failed"
      : mapped === "cancelled" ? "cancelled"
      : mapped === "verifying" ? "operation_progress"
      : mapped === "executing" ? "operation_started"
      : "operation_progress";
    record.events.push({
      sequence: nextEventSequence(record),
      at: nowIso(),
      type: eventType,
      summary:
        mapped === "completed"
          ? "The approved change and verification completed."
          : `The governed run is ${mapped.replace(/_/g, " ")}.`,
    });
  }
  if (run.receipt && record.receiptId !== run.receipt.receipt_id) {
    record.receiptId = run.receipt.receipt_id;
    record.receiptVerified = run.receipt.verification.ok;
    changed = true;
    record.events.push({
      sequence: nextEventSequence(record),
      at: nowIso(),
      type: run.receipt.verification.ok ? "completed" : "failed",
      summary: run.receipt.verification.ok
        ? `Verified receipt ${run.receipt.receipt_id} was created.`
        : `Failure receipt ${run.receipt.receipt_id} recorded the unsuccessful verification and rollback posture.`,
      data: {
        receiptId: run.receipt.receipt_id,
        verificationOk: run.receipt.verification.ok,
      },
    });
  }
  if (run.receipt?.verification.ok && !record.memoryId) {
    const memory = await createBrainMemory(
      accessSession,
      {
        type: "project",
        confidence: 0.94,
        weight: 0.78,
        source: "hermes_acp_verified_receipt",
        text: [
          `Verified PhantomBot engineering task for ${record.workspace}.`,
          `Request: ${record.summary}.`,
          run.inputs.plan
            ? `Plan: ${clean((run.inputs.plan as EngineeringTaskPlan).summary, 300)}.`
            : `File: ${String(run.inputs.relativePath || "unknown")}.`,
          `Verification: ${run.receipt.verification.detail}.`,
          `Receipt: ${run.receipt.receipt_id}.`,
        ].join(" ").slice(0, 1_100),
      },
      {
        tenantId: record.organizationId,
        memoryPath: process.env.PHANTOM_BRAIN_MEMORY_PATH,
        eventsPath: process.env.PHANTOM_BRAIN_EVENTS_PATH,
      },
    );
    record.memoryId = memory.id;
    changed = true;
  }
  if (changed) await persist(record, options);
}

async function validateDocumentationTarget(root: string, relativePath: string) {
  const normalized = relativePath.replace(/\\/g, "/");
  if (
    !normalized.startsWith("docs/")
    || !normalized.endsWith(".md")
    || normalized.includes("..")
    || isAbsolute(normalized)
  ) {
    throw new Error("documentation_path_not_allowed");
  }
  const canonicalRoot = await realpath(root);
  const target = resolve(canonicalRoot, normalized);
  const canonicalParent = await realpath(dirname(target));
  if (!isInside(canonicalRoot, canonicalParent)) throw new Error("path_outside_workspace");
  try {
    const targetStats = await lstat(target);
    if (targetStats.isSymbolicLink()) throw new Error("symlink_target_rejected");
    const canonicalTarget = await realpath(target);
    if (!isInside(canonicalRoot, canonicalTarget)) throw new Error("path_outside_workspace");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    throw new Error("documentation_file_not_found");
  }
  return { canonicalRoot, target, normalized };
}

async function runAllowedTest(
  command: string,
  cwd: string,
  timeoutMs = 120_000,
) {
  const allowed = ALLOWED_TEST_COMMANDS.get(command);
  if (!allowed) throw new Error("test_command_not_allowed");
  return new Promise<{
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    output: string;
    timedOut: boolean;
  }>((resolvePromise, rejectPromise) => {
    const child = spawn(allowed.executable, allowed.args, {
      cwd,
      env: operatorChildEnvironment(),
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let timedOut = false;
    const append = (chunk: Buffer) => {
      output = `${output}${chunk.toString("utf8")}`.slice(-MAX_COMMAND_OUTPUT_CHARS);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.once("error", rejectPromise);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.once("exit", (exitCode, signal) => {
      clearTimeout(timer);
      resolvePromise({
        exitCode,
        signal,
        output: redactSensitiveText(output),
        timedOut,
      });
    });
  });
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
    "USERPROFILE",
    "windir",
  ];
  const env: NodeJS.ProcessEnv = { PHANTOMBOT_OPERATOR_RUN: "true" };
  for (const key of allowedKeys) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}

function artifactRoot() {
  return resolve(
    process.env.PHANTOM_AGENT_RUN_ARTIFACTS_DIR
    || resolve(repoRoot, ".phantom", "artifacts"),
  );
}

registerAgentRunExecutor(HERMES_DOCUMENTATION_PATCH_OPERATION, {
  title: "Hermes documentation patch",
  description: "Applies one exact approved documentation replacement and runs the allowlisted PhantomBot desktop test.",
  risk: "never_silent",
  requiredRole: "org_manager",
  scope: "One docs/*.md file in the configured operator workspace and one allowlisted test command.",
  expectedEffect: "One exact documentation replacement followed by a real PhantomBot desktop test.",
  rollbackGuidance: "Restore the prior file from the run-specific rollback copy, then rerun npm run test:phantombot-desktop.",
  async execute(ctx) {
    const root = await canonicalWorkspace();
    const relativePath = String(ctx.run.inputs.relativePath || "");
    const expectedText = String(ctx.run.inputs.expectedText || "");
    const replacementText = String(ctx.run.inputs.replacementText || "");
    const testCommand = String(ctx.run.inputs.testCommand || "");
    if (!expectedText || !replacementText) throw new Error("patch_text_required");
    const target = await validateDocumentationTarget(root, relativePath);
    const before = await readFile(target.target, "utf8");
    const occurrences = before.split(expectedText).length - 1;
    if (occurrences !== 1) throw new Error(`expected_text_occurrences:${occurrences}`);
    if (ctx.isCancelled()) throw new Error("cancelled");
    const after = before.replace(expectedText, replacementText);
    const rollbackDir = resolve(artifactRoot(), `${ctx.run.id}-rollback`);
    await mkdir(rollbackDir, { recursive: true });
    const rollbackPath = resolve(rollbackDir, "before.md");
    await writeFile(rollbackPath, before, "utf8");
    const tempPath = `${target.target}.phantombot-${ctx.run.id}.tmp`;
    await writeFile(tempPath, after, "utf8");
    await rename(tempPath, target.target);
    const saved = await readFile(target.target, "utf8");
    if (saved !== after) {
      await writeFile(target.target, before, "utf8");
      throw new Error("saved_file_verification_failed_rolled_back");
    }
    await ctx.progress(`Updated ${target.normalized}; running the approved desktop test.`);
    if (ctx.isCancelled()) {
      await writeFile(target.target, before, "utf8");
      throw new Error("cancelled");
    }
    const test = await runAllowedTest(testCommand, target.canonicalRoot);
    const testFailed = test.timedOut || test.exitCode !== 0;
    if (testFailed) await writeFile(target.target, before, "utf8");
    const evidence = {
      schemaVersion: 1,
      runId: ctx.run.id,
      hermesOperatorSessionId: clean(ctx.run.inputs.hermesOperatorSessionId, 180),
      hermesSessionId: clean(ctx.run.inputs.hermesSessionId, 180),
      file: target.normalized,
      beforeSha256: createHash("sha256").update(before).digest("hex"),
      afterSha256: createHash("sha256").update(after).digest("hex"),
      changed: before !== after,
      command: testCommand,
      exitCode: test.exitCode,
      signal: test.signal,
      timedOut: test.timedOut,
      outputTail: test.output.slice(-8_000),
      rolledBack: testFailed,
      verifiedAt: nowIso(),
    };
    const evidencePath = resolve(artifactRoot(), `${ctx.run.id}-hermes-documentation-patch.json`);
    await mkdir(dirname(evidencePath), { recursive: true });
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    if (test.timedOut) throw new Error("approved_test_timed_out_rolled_back");
    if (test.exitCode !== 0) throw new Error(`approved_test_failed:${test.exitCode}:rolled_back`);
    const artifact: AgentRunArtifact = {
      kind: "json",
      path: evidencePath,
      summary: `Updated ${target.normalized}; ${testCommand} exited 0.`,
    };
    return {
      artifacts: [artifact],
      summary: artifact.summary,
      actualEffect: `Changed ${target.normalized} and verified it with ${testCommand}.`,
    };
  },
  async verify(ctx, artifacts) {
    if (artifacts.length !== 1) return { ok: false, detail: "expected_one_evidence_artifact" };
    try {
      const evidence = JSON.parse(await readFile(artifacts[0].path, "utf8")) as Record<string, unknown>;
      const root = await canonicalWorkspace();
      const target = await validateDocumentationTarget(root, String(evidence.file || ""));
      const current = await readFile(target.target, "utf8");
      const currentHash = createHash("sha256").update(current).digest("hex");
      if (evidence.afterSha256 !== currentHash) {
        return { ok: false, detail: "saved_file_hash_changed_before_verification" };
      }
      if (evidence.exitCode !== 0 || evidence.timedOut !== false) {
        return { ok: false, detail: "test_process_did_not_complete_successfully" };
      }
      return {
        ok: true,
        detail: `${String(evidence.file)} saved and ${String(evidence.command)} passed with exit 0`,
      };
    } catch (error) {
      return { ok: false, detail: clean((error as Error).message, 240) || "verification_failed" };
    }
  },
});

export function publicHermesOperatorRun(run: AgentRun | null) {
  return run ? serializeAgentRun(run) : null;
}
