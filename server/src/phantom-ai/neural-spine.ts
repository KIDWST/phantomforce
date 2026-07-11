import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { AccessSession } from "../access/session.js";
import { readApprovalQueueWithTransitions } from "./approval-queue.js";
import { buildAgentWorkforceStatus } from "./agent-workforce.js";
import { listAutomationJobs } from "./automation-engine.js";
import {
  appendHermesLedgerRecord,
  getHermesLedgerStatus,
  readRedactedHermesLedgerRecords,
  redactSensitiveText,
} from "./hermes-ledger.js";
import { getMediaLabImageToolchainStatus } from "./media-lab-image-toolchain.js";
import { getProviderSetupStatus } from "./model-router.js";
import { detectRembg } from "./rembg-bridge.js";
import { buildToolLanePreview } from "./tool-lane.js";
import type { ActorRole, HermesLedgerRecord } from "./types.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../../..");

export const DEFAULT_BRAIN_MEMORY_PATH = resolve(repoRoot, ".phantom", "brain-memory.jsonl");
export const DEFAULT_BRAIN_EVENTS_PATH = resolve(repoRoot, ".phantom", "brain-events.jsonl");

const OWNER_TENANT_ID = "phantomforce-owner";
const MAX_TEXT_CHARS = 1200;
const MAX_SUMMARY_CHARS = 320;
const MAX_MEMORIES_RETURNED = 120;
const MAX_EVENTS_RETURNED = 120;
const SENSITIVE_KEY_PATTERN = /(api[_-]?key|authorization|bearer|card|cc|credit|password|secret|token|cookie|session)/i;

export type BrainMemoryType =
  | "fact"
  | "preference"
  | "rule"
  | "workflow"
  | "brand"
  | "media_style"
  | "correction"
  | "safety"
  | "tool_state"
  | "project";

export type BrainSurface =
  | "chat"
  | "dashboard"
  | "workers"
  | "content_hub"
  | "media_lab"
  | "vacation"
  | "automation"
  | "developer"
  | "settings"
  | "brain";

export type BrainMemoryRecord = {
  id: string;
  scope: {
    tenantId: string;
    actorUserId: string;
    sessionId: string;
  };
  type: BrainMemoryType;
  text: string;
  sourceEventId: string | null;
  confidence: number;
  weight: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  useCount: number;
  editable: boolean;
  deletable: boolean;
  source: string;
};

export type BrainEventRecord = {
  id: string;
  timestamp: string;
  scope: {
    tenantId: string;
    actorUserId: string;
    sessionId: string;
  };
  surface: BrainSurface;
  type: string;
  summary: string;
  linkedRunId: string | null;
  outcome: string;
  importance: "low" | "medium" | "high";
  safeForMemory: boolean;
  source: string;
  metadata: Record<string, string | number | boolean | null>;
};

export type BrainBehavioralProfile = {
  tonePreference: string;
  detailDepthPreference: string;
  outputFormatPreference: string;
  approvalStrictness: string;
  riskTolerance: string;
  currentProjectFocus: string[];
  preferredDebuggingStyle: string;
  preferredMediaWorkflow: string;
  knownAvoidances: string[];
  recurringCorrections: string[];
  confidence: number;
  evidenceCount: number;
};

export type BrainContextPack = {
  composedAt: string;
  currentMessage: string;
  surface: BrainSurface;
  relevantMemories: Array<BrainMemoryRecord & { score: number; reason: string }>;
  activeRules: string[];
  systemState: Awaited<ReturnType<typeof getBrainSystemHealth>>;
  behavioralProfile: BrainBehavioralProfile;
  suggestedIntent: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  needsApproval: boolean;
  proposedActionType: string;
  microPrompt: string;
  debug: {
    reasons: string[];
    memoryCandidates: number;
    injectedMemoryIds: string[];
    noModelWeightClaims: true;
  };
};

export type BrainStoreOptions = {
  memoryPath?: string;
  eventsPath?: string;
  tenantId?: string | null;
};

function resolveBrainMemoryPath(pathFromEnv = process.env.PHANTOM_BRAIN_MEMORY_PATH) {
  return pathFromEnv?.trim() ? resolve(pathFromEnv) : DEFAULT_BRAIN_MEMORY_PATH;
}

function resolveBrainEventsPath(pathFromEnv = process.env.PHANTOM_BRAIN_EVENTS_PATH) {
  return pathFromEnv?.trim() ? resolve(pathFromEnv) : DEFAULT_BRAIN_EVENTS_PATH;
}

function storePaths(options: BrainStoreOptions = {}) {
  return {
    memoryPath: options.memoryPath ?? resolveBrainMemoryPath(),
    eventsPath: options.eventsPath ?? resolveBrainEventsPath(),
  };
}

function cleanBrainScopeId(value: unknown, fallback = "") {
  if (typeof value !== "string") return fallback;
  const normalized = value
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9_.:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || fallback;
}

function scopeForSession(session: AccessSession, options: BrainStoreOptions = {}) {
  const tenantId = session.canManageAccess
    ? cleanBrainScopeId(options.tenantId, OWNER_TENANT_ID)
    : cleanBrainScopeId(session.clientId, `client-${session.id}`);
  return {
    tenantId,
    actorUserId: session.id,
    sessionId: session.id,
  };
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function sanitizeText(value: unknown, maxChars = MAX_TEXT_CHARS) {
  return redactSensitiveText(String(value ?? "").replace(/\s+/g, " ").trim()).slice(0, maxChars);
}

function sanitizeMemoryType(value: unknown): BrainMemoryType {
  const valid: BrainMemoryType[] = [
    "fact",
    "preference",
    "rule",
    "workflow",
    "brand",
    "media_style",
    "correction",
    "safety",
    "tool_state",
    "project",
  ];
  return valid.includes(value as BrainMemoryType) ? (value as BrainMemoryType) : inferMemoryType(String(value ?? ""));
}

function sanitizeMetadata(value: unknown): BrainEventRecord["metadata"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: BrainEventRecord["metadata"] = {};
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, 16)) {
    const key = sanitizeText(rawKey, 60);
    if (!key) continue;
    if (SENSITIVE_KEY_PATTERN.test(rawKey)) {
      out[key] = "[redacted]";
      continue;
    }
    if (typeof rawValue === "number" || typeof rawValue === "boolean" || rawValue === null) {
      out[key] = rawValue;
    } else {
      out[key] = sanitizeText(rawValue, 180);
    }
  }
  return out;
}

function isMemoryRecord(value: unknown): value is BrainMemoryRecord {
  const record = value as Partial<BrainMemoryRecord>;
  return Boolean(
    record &&
      typeof record.id === "string" &&
      record.scope &&
      typeof record.scope.tenantId === "string" &&
      typeof record.text === "string" &&
      typeof record.createdAt === "string",
  );
}

function isEventRecord(value: unknown): value is BrainEventRecord {
  const record = value as Partial<BrainEventRecord>;
  return Boolean(
    record &&
      typeof record.id === "string" &&
      typeof record.timestamp === "string" &&
      record.scope &&
      typeof record.scope.tenantId === "string" &&
      typeof record.summary === "string",
  );
}

async function appendJsonl(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(value)}\n`, "utf8");
}

async function readJsonl<T>(
  path: string,
  guard: (value: unknown) => value is T,
  limit = 500,
): Promise<{ records: T[]; malformed: number }> {
  try {
    const raw = await readFile(path, "utf8");
    const lines = raw.split(/\r?\n/).filter(Boolean).slice(-limit);
    const records: T[] = [];
    let malformed = 0;
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (guard(parsed)) records.push(parsed);
        else malformed += 1;
      } catch {
        malformed += 1;
      }
    }
    return { records, malformed };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { records: [], malformed: 0 };
    throw error;
  }
}

function latestActiveMemoryVersions(records: BrainMemoryRecord[], scope: ReturnType<typeof scopeForSession>) {
  const latest = new Map<string, BrainMemoryRecord>();
  for (const record of records) {
    if (record.scope.tenantId !== scope.tenantId) continue;
    if (record.scope.actorUserId !== scope.actorUserId && !record.scope.actorUserId.startsWith("bootstrap")) continue;
    const previous = latest.get(record.id);
    if (!previous || record.updatedAt.localeCompare(previous.updatedAt) >= 0) latest.set(record.id, record);
  }
  return [...latest.values()]
    .filter((record) => record.active)
    .sort((left, right) => right.weight - left.weight || right.updatedAt.localeCompare(left.updatedAt));
}

function inferMemoryType(text: string): BrainMemoryType {
  const s = text.toLowerCase();
  if (/\b(always|never|must|require|approval|blocked|external sends?|uploads?|posts?|spending|credits)\b/.test(s)) return "safety";
  if (/\b(prefer|like|tone|wording|format|style|human|robotic|debugging|powershell)\b/.test(s)) return "preference";
  if (/\b(wrong|correction|next time|do it this way|do not|don't|stop)\b/.test(s)) return "correction";
  if (/\b(higgsfield|rembg|ai-proxy|fastify|ollama|openrouter|claude|codex|n8n|serena|ruflo|openspec)\b/.test(s)) return "tool_state";
  if (/\b(media|video|image|photo|prompt|asset|content hub|media lab|visual)\b/.test(s)) return "media_style";
  if (/\b(brand|copy|voice|colors|logo)\b/.test(s)) return "brand";
  if (/\b(workflow|automation|process|steps|sop|loop)\b/.test(s)) return "workflow";
  if (/\b(project|phantomforce|chicagoshots|site|dashboard|client)\b/.test(s)) return "project";
  return "fact";
}

function bootstrapBrainMemories(scope: ReturnType<typeof scopeForSession>, now: string): BrainMemoryRecord[] {
  const base = [
    {
      type: "preference" as const,
      text: "User prefers exact PowerShell commands when debugging local infrastructure.",
      confidence: 0.86,
      weight: 0.82,
    },
    {
      type: "tool_state" as const,
      text: "Higgsfield is subscription/manual mode unless a real HIGGSFIELD_API_KEY exists. Do not ask for a Higgsfield API key unless the user says they have one.",
      confidence: 0.92,
      weight: 0.94,
    },
    {
      type: "tool_state" as const,
      text: "rembg runs locally through the Fastify backend with Python command py when the status route reports connected; it is not a Pangolin VPS feature.",
      confidence: 0.9,
      weight: 0.9,
    },
    {
      type: "rule" as const,
      text: "PhantomForce should be chat-first and should not auto-create tasks from casual brainstorming or greetings.",
      confidence: 0.9,
      weight: 0.92,
    },
    {
      type: "preference" as const,
      text: "User wants direct human wording, not robotic corporate copy or bloated paragraphs unless detail is requested.",
      confidence: 0.86,
      weight: 0.85,
    },
    {
      type: "safety" as const,
      text: "External sends, posts, uploads, deploys, spending, payments, invoices, and destructive changes require approval before acting.",
      confidence: 0.96,
      weight: 0.98,
    },
  ];

  return base.map((item, index) => ({
    id: `brain-bootstrap-${index + 1}`,
    scope: {
      ...scope,
      actorUserId: `bootstrap-${scope.actorUserId}`,
      sessionId: `bootstrap-${scope.sessionId}`,
    },
    type: item.type,
    text: sanitizeText(item.text),
    sourceEventId: null,
    confidence: item.confidence,
    weight: item.weight,
    active: true,
    createdAt: now,
    updatedAt: now,
    lastUsedAt: null,
    useCount: 0,
    editable: true,
    deletable: true,
    source: "phase_iii_bootstrap",
  }));
}

async function ensureBrainBootstrapMemories(session: AccessSession, options: BrainStoreOptions = {}) {
  const { memoryPath } = storePaths(options);
  const scope = scopeForSession(session, options);
  const existing = await readJsonl(memoryPath, isMemoryRecord, 2000);
  const existingBootstrap = new Set(
    existing.records
      .filter((record) => record.scope.tenantId === scope.tenantId && record.source === "phase_iii_bootstrap")
      .map((record) => record.id),
  );
  const now = new Date().toISOString();
  for (const record of bootstrapBrainMemories(scope, now)) {
    if (!existingBootstrap.has(record.id)) await appendJsonl(memoryPath, record);
  }
}

export async function listBrainMemories(
  session: AccessSession,
  options: BrainStoreOptions & { includeInactive?: boolean; limit?: number; type?: unknown } = {},
) {
  await ensureBrainBootstrapMemories(session, options);
  const { memoryPath } = storePaths(options);
  const scope = scopeForSession(session, options);
  const read = await readJsonl(memoryPath, isMemoryRecord, 5000);
  const latest = new Map<string, BrainMemoryRecord>();
  for (const record of read.records) {
    if (record.scope.tenantId !== scope.tenantId) continue;
    if (record.scope.actorUserId !== scope.actorUserId && !record.scope.actorUserId.startsWith("bootstrap")) continue;
    const previous = latest.get(record.id);
    if (!previous || record.updatedAt.localeCompare(previous.updatedAt) >= 0) latest.set(record.id, record);
  }
  const limit = Math.min(Math.max(Math.floor(options.limit ?? MAX_MEMORIES_RETURNED), 1), MAX_MEMORIES_RETURNED);
  const typeFilter = typeof options.type === "string" && options.type.trim() ? sanitizeMemoryType(options.type) : null;
  return {
    storePath: memoryPath,
    malformed: read.malformed,
    memories: [...latest.values()]
      .filter((record) => options.includeInactive || record.active)
      .filter((record) => !typeFilter || record.type === typeFilter)
      .sort((left, right) => right.weight - left.weight || right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, limit),
  };
}

export async function createBrainMemory(
  session: AccessSession,
  input: {
    text?: unknown;
    type?: unknown;
    confidence?: unknown;
    weight?: unknown;
    source?: unknown;
    sourceEventId?: unknown;
  },
  options: BrainStoreOptions = {},
) {
  const { memoryPath } = storePaths(options);
  const now = new Date().toISOString();
  const text = sanitizeText(input.text);
  if (!text) throw new Error("memory_text_required");
  const record: BrainMemoryRecord = {
    id: `brain-memory-${randomUUID()}`,
    scope: scopeForSession(session, options),
    type: typeof input.type === "string" ? sanitizeMemoryType(input.type) : inferMemoryType(text),
    text,
    sourceEventId: typeof input.sourceEventId === "string" ? sanitizeText(input.sourceEventId, 120) : null,
    confidence: clampNumber(input.confidence, 0.74, 0.05, 1),
    weight: clampNumber(input.weight, 0.7, 0.05, 1),
    active: true,
    createdAt: now,
    updatedAt: now,
    lastUsedAt: null,
    useCount: 0,
    editable: true,
    deletable: true,
    source: sanitizeText(input.source || "manual", 80) || "manual",
  };
  await appendJsonl(memoryPath, record);
  await appendBrainEvent(
    session,
    {
      surface: "brain",
      type: "memory_created",
      summary: `Memory created: ${record.text}`,
      outcome: "saved",
      importance: record.weight >= 0.85 ? "high" : "medium",
      safeForMemory: true,
      source: "brain_memory_vault",
      metadata: { memoryId: record.id, memoryType: record.type },
    },
    options,
  );
  return record;
}

export async function updateBrainMemory(
  session: AccessSession,
  id: string,
  patch: {
    text?: unknown;
    type?: unknown;
    confidence?: unknown;
    weight?: unknown;
    active?: unknown;
  },
  options: BrainStoreOptions = {},
) {
  const current = (await listBrainMemories(session, { ...options, includeInactive: true, limit: MAX_MEMORIES_RETURNED })).memories.find(
    (record) => record.id === id,
  );
  if (!current || !current.editable) throw new Error("memory_not_found");
  const nextText = patch.text === undefined ? current.text : sanitizeText(patch.text);
  if (!nextText) throw new Error("memory_text_required");
  const next: BrainMemoryRecord = {
    ...current,
    text: nextText,
    type: patch.type === undefined ? current.type : sanitizeMemoryType(patch.type),
    confidence: patch.confidence === undefined ? current.confidence : clampNumber(patch.confidence, current.confidence, 0.05, 1),
    weight: patch.weight === undefined ? current.weight : clampNumber(patch.weight, current.weight, 0.05, 1),
    active: patch.active === undefined ? current.active : Boolean(patch.active),
    updatedAt: new Date().toISOString(),
  };
  await appendJsonl(storePaths(options).memoryPath, next);
  await appendBrainEvent(
    session,
    {
      surface: "brain",
      type: next.active ? "memory_updated" : "memory_forgotten",
      summary: next.active ? `Memory updated: ${next.text}` : `Memory forgotten: ${current.text}`,
      outcome: next.active ? "updated" : "forgotten",
      importance: "medium",
      safeForMemory: next.active,
      source: "brain_memory_vault",
      metadata: { memoryId: next.id, memoryType: next.type },
    },
    options,
  );
  return next;
}

export async function forgetBrainMemory(session: AccessSession, id: string, options: BrainStoreOptions = {}) {
  return updateBrainMemory(session, id, { active: false }, options);
}

export async function readBrainEvents(
  session: AccessSession,
  options: BrainStoreOptions & { limit?: number } = {},
) {
  const { eventsPath } = storePaths(options);
  const scope = scopeForSession(session, options);
  const read = await readJsonl(eventsPath, isEventRecord, 1000);
  const limit = Math.min(Math.max(Math.floor(options.limit ?? MAX_EVENTS_RETURNED), 1), MAX_EVENTS_RETURNED);
  return {
    storePath: eventsPath,
    malformed: read.malformed,
    events: read.records
      .filter((record) => record.scope.tenantId === scope.tenantId)
      .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
      .slice(0, limit),
  };
}

export async function appendBrainEvent(
  session: AccessSession,
  input: {
    surface?: unknown;
    type?: unknown;
    summary?: unknown;
    linkedRunId?: unknown;
    outcome?: unknown;
    importance?: unknown;
    safeForMemory?: unknown;
    source?: unknown;
    metadata?: unknown;
    logToHermes?: boolean;
  },
  options: BrainStoreOptions = {},
) {
  const now = new Date().toISOString();
  const event: BrainEventRecord = {
    id: `brain-event-${randomUUID()}`,
    timestamp: now,
    scope: scopeForSession(session, options),
    surface: normalizeSurface(input.surface),
    type: sanitizeText(input.type || "event", 80) || "event",
    summary: sanitizeText(input.summary, MAX_SUMMARY_CHARS),
    linkedRunId: typeof input.linkedRunId === "string" ? sanitizeText(input.linkedRunId, 140) : null,
    outcome: sanitizeText(input.outcome || "recorded", 80) || "recorded",
    importance: normalizeImportance(input.importance),
    safeForMemory: input.safeForMemory === undefined ? false : Boolean(input.safeForMemory),
    source: sanitizeText(input.source || "neural_spine", 80) || "neural_spine",
    metadata: sanitizeMetadata(input.metadata),
  };
  if (!event.summary) throw new Error("event_summary_required");
  await appendJsonl(storePaths(options).eventsPath, event);
  if (input.logToHermes !== false) {
    await appendHermesLedgerRecord(hermesRecordForBrainEvent(session, event));
  }
  return event;
}

function normalizeSurface(value: unknown): BrainSurface {
  const valid: BrainSurface[] = [
    "chat",
    "dashboard",
    "workers",
    "content_hub",
    "media_lab",
    "vacation",
    "automation",
    "developer",
    "settings",
    "brain",
  ];
  return valid.includes(value as BrainSurface) ? (value as BrainSurface) : "brain";
}

function normalizeImportance(value: unknown): BrainEventRecord["importance"] {
  return value === "high" || value === "medium" || value === "low" ? value : "medium";
}

function hermesRecordForBrainEvent(session: AccessSession, event: BrainEventRecord): HermesLedgerRecord {
  const actorRole: ActorRole = session.canManageAccess ? "platform_admin" : "business_owner";
  return {
    timestamp: event.timestamp,
    tenant_id: event.scope.tenantId,
    business_name: "PhantomForce",
    actor_user_id: event.scope.actorUserId,
    actor_role: actorRole,
    request_id: event.id,
    task_type: `brain.${event.type}`.slice(0, 120),
    sensitivity_level: event.importance === "high" ? "medium" : "low",
    provider_route: "local",
    model_id: "phantom-neural-spine",
    context_chars: event.summary.length,
    estimated_tokens: Math.ceil(event.summary.length / 4),
    estimated_cost_usd: 0,
    user_request_summary: event.summary,
    result_summary: `${event.surface}: ${event.outcome}`,
    approval_required: false,
    approval_status: "not_required",
    risks: [],
    next_action: "Use Brain UI or context preview to inspect this event.",
    agent_run_id: event.linkedRunId ?? event.id,
    parent_task_id: event.id,
  };
}

function tokenize(value: string) {
  return new Set(
    sanitizeText(value, 1200)
      .toLowerCase()
      .split(/[^a-z0-9_.-]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !["the", "and", "for", "you", "that", "this", "with"].includes(token)),
  );
}

function scoreMemory(memory: BrainMemoryRecord, message: string) {
  const text = memory.text.toLowerCase();
  const tokens = tokenize(message);
  let score = memory.weight * 4 + memory.confidence * 3;
  const reasons: string[] = [];
  for (const token of tokens) {
    if (text.includes(token)) {
      score += 1.2;
      if (reasons.length < 3) reasons.push(`matched "${token}"`);
    }
  }
  const messageLower = message.toLowerCase();
  const boosts: Array<[RegExp, BrainMemoryType, string]> = [
    [/\b(higgsfield|creator studio|manual|subscription|api key)\b/i, "tool_state", "tool-state match"],
    [/\b(rembg|background|remove background|python|fastify)\b/i, "tool_state", "local tool match"],
    [/\b(send|post|upload|deploy|spend|charge|payment|invoice|delete)\b/i, "safety", "approval safety match"],
    [/\b(robotic|human|tone|wording|paragraph|concise|direct)\b/i, "preference", "tone preference match"],
    [/\b(task|brainstorm|casual|hello|chat)\b/i, "rule", "chat behavior match"],
    [/\b(video|image|photo|media|content|prompt)\b/i, "media_style", "media workflow match"],
  ];
  for (const [pattern, type, reason] of boosts) {
    if (pattern.test(messageLower) && memory.type === type) {
      score += 3;
      reasons.push(reason);
    }
  }
  return {
    score,
    reason: reasons.length ? reasons.join("; ") : "high-weight memory",
  };
}

function suggestIntent(message: string) {
  const s = message.toLowerCase();
  if (/^\s*(hey|hi|hello|yo|sup|good morning|good afternoon|good evening)[\s.!?]*$/.test(s)) return "chat";
  if (/\b(send|post|upload|deploy|charge|pay|invoice|delete|publish)\b/.test(s)) return "approval_required_action";
  if (/\b(remember|forget|never|do this next time|too robotic|wrong)\b/.test(s)) return "feedback_or_memory";
  if (/\b(debug|fix|broken|not connected|error|status|health)\b/.test(s)) return "debug";
  if (/\b(create|build|draft|make|generate|plan)\b/.test(s)) return "draft_or_build";
  return "chat";
}

function riskForIntent(message: string): BrainContextPack["riskLevel"] {
  const s = message.toLowerCase();
  if (/\b(delete|destroy|wipe|reset|password|secret|credential|payment|charge|bankruptcy|tax)\b/.test(s)) return "critical";
  if (/\b(send|post|upload|deploy|publish|invoice|spend|credits|client-facing|external)\b/.test(s)) return "high";
  if (/\b(edit|write|automation|workflow|connect|install|scan)\b/.test(s)) return "medium";
  return "low";
}

function proposedActionType(message: string, intent: string) {
  const s = message.toLowerCase();
  if (/\b(send|email|text|sms|dm)\b/.test(s)) return "external_send";
  if (/\b(post|publish|social)\b/.test(s)) return "external_post";
  if (/\b(upload)\b/.test(s)) return "external_upload";
  if (/\b(deploy|production)\b/.test(s)) return "deployment";
  if (/\b(invoice|payment|charge|spend|credits)\b/.test(s)) return "money_or_credit_action";
  if (/\b(delete|reset|wipe)\b/.test(s)) return "destructive_action";
  return intent === "draft_or_build" ? "draft_or_local_build" : "chat_or_read";
}

function deriveBehavioralProfile(memories: BrainMemoryRecord[], events: BrainEventRecord[]): BrainBehavioralProfile {
  const texts = [...memories.map((memory) => memory.text), ...events.map((event) => event.summary)].join("\n").toLowerCase();
  const explicit = memories.filter((memory) => ["preference", "rule", "correction", "media_style", "safety"].includes(memory.type));
  const knownAvoidances: string[] = [];
  const recurringCorrections: string[] = [];
  if (/robotic|corporate|fluff|too long|bloated|paragraph/.test(texts)) {
    knownAvoidances.push("robotic corporate copy", "unneeded long paragraphs");
    recurringCorrections.push("make wording more human and concise");
  }
  if (/auto-create tasks|casual brainstorming|hello|greeting/.test(texts)) {
    knownAvoidances.push("auto-creating tasks from brainstorming or greetings");
  }
  if (/higgsfield.*api key|subscription\/manual|manual mode/.test(texts)) {
    recurringCorrections.push("treat Higgsfield as manual/subscription unless an API key exists");
  }
  if (/powershell|exact command|debug/.test(texts)) {
    recurringCorrections.push("give exact PowerShell commands for local debugging");
  }
  return {
    tonePreference: /human|direct|not robotic|fluff/.test(texts) ? "direct, human, low-fluff" : "operator-clear",
    detailDepthPreference: /concise|too long|novel|paragraph/.test(texts) ? "concise unless detail is requested" : "balanced",
    outputFormatPreference: /commands|powershell|steps/.test(texts) ? "actionable commands and short proof" : "short answer first",
    approvalStrictness: /approval|nothing sends|manual-send|external/.test(texts) ? "strict approval gates for outside-world actions" : "approval-first",
    riskTolerance: "low for external/destructive actions, medium for local drafting",
    currentProjectFocus: [
      ...new Set(
        explicit
          .filter((memory) => /phantomforce|admin|dashboard|media|content|site|worker|brain/i.test(memory.text))
          .map((memory) => memory.type === "media_style" ? "Media Lab / Content Hub" : "PhantomForce admin operator brain")
          .slice(0, 4),
      ),
    ],
    preferredDebuggingStyle: /powershell|exact command/.test(texts) ? "exact PowerShell commands plus what each result means" : "diagnose first, then commands",
    preferredMediaWorkflow: /higgsfield|media|image|video|content/.test(texts) ? "in-app workflow, hide provider plumbing, manual/API state honest" : "approval-gated media workflow",
    knownAvoidances: [...new Set(knownAvoidances)].slice(0, 8),
    recurringCorrections: [...new Set(recurringCorrections)].slice(0, 8),
    confidence: Math.min(0.95, 0.35 + explicit.length * 0.08),
    evidenceCount: explicit.length + events.length,
  };
}

async function fetchAiProxyHealth() {
  const url = (process.env.PHANTOM_AI_PROXY_BASE_URL ?? "http://127.0.0.1:8788").replace(/\/+$/, "");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 1200);
  try {
    const response = await fetch(`${url}/health`, { signal: ctrl.signal });
    const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    return {
      baseUrl: url,
      reachable: response.ok,
      status: response.ok ? "reachable" : `http_${response.status}`,
      provider: typeof data?.provider === "string" ? data.provider : null,
      model: typeof data?.model === "string" ? data.model : null,
      media: data && typeof data.media === "object" ? data.media : null,
    };
  } catch {
    return {
      baseUrl: url,
      reachable: false,
      status: "unreachable",
      provider: null,
      model: null,
      media: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function getBrainSystemHealth() {
  const [ledger, rembg, aiProxy, toolLane, approvals, automations, workforce] = await Promise.all([
    getHermesLedgerStatus(),
    detectRembg(false),
    fetchAiProxyHealth(),
    buildToolLanePreview({ toolId: "n8n" }),
    readApprovalQueueWithTransitions({ limit: 25 }),
    listAutomationJobs().catch(() => []),
    buildAgentWorkforceStatus({ admin: true, windowHours: 24 }).catch(() => null),
  ]);
  const provider = getProviderSetupStatus();
  const mediaToolchain = getMediaLabImageToolchainStatus();
  const pendingApprovals = approvals.records.filter((record) => record.queue_status === "pending").length;
  return {
    fastifyBackend: "reachable",
    hermesLedger: {
      exists: ledger.exists,
      bytes: ledger.bytes,
      path: ledger.ledgerPath,
    },
    rembg: {
      available: rembg.available,
      pythonCommand: rembg.pythonCommand,
      version: rembg.version,
      error: rembg.error,
    },
    aiProxy,
    higgsfield: {
      mode: process.env.HIGGSFIELD_API_KEY ? "api_configured" : "manual_subscription_or_unconfigured",
      apiConnected: Boolean(process.env.HIGGSFIELD_API_KEY),
      rule: "Subscription/manual mode is valid; API access requires a real server-side API key.",
    },
    provider: {
      hermesStatus: provider.hermes.status,
      glmLiveReady: provider.openrouter_glm.live_call_ready,
      glmConfigured: provider.openrouter_glm.configured,
      localFallback: provider.local_fallback.status,
    },
    toolLane: {
      status: toolLane.status,
      n8nRunning: toolLane.n8n_status.n8n_running,
      n8nScaffolded: toolLane.n8n_status.n8n_scaffolded,
      executionDisabled: toolLane.execution_disabled,
    },
    mediaToolchain: {
      connectorsTotal: mediaToolchain.summary.connectors_total,
      activeOrAvailable: mediaToolchain.summary.active_or_available,
      providerBridgesGated: mediaToolchain.summary.provider_bridges_gated,
    },
    automation: {
      jobCount: automations.length,
      enabledCount: automations.filter((job) => job.enabled).length,
    },
    workerLedger: workforce && "total_workers" in workforce.summary
      ? {
          totalWorkers: workforce.summary.total_workers,
          activeWorkers: workforce.summary.active_workers,
          subagentsMapped: workforce.summary.subagents_mapped,
          totalMappedNodes: workforce.summary.total_mapped_nodes,
          executableActions: workforce.summary.runtime_executable_actions,
          generatedCellsAreRuntimeWorkers: false,
          tasksInWindow: workforce.summary.tasks_in_window,
        }
      : null,
    approvals: {
      queueCount: approvals.records.length,
      pendingCount: pendingApprovals,
      malformedLines: approvals.malformed_lines,
    },
  };
}

export async function composeBrainContext(
  session: AccessSession,
  input: {
    message?: unknown;
    surface?: unknown;
    proposedActionType?: unknown;
    currentModule?: unknown;
    logEvent?: boolean;
  },
  options: BrainStoreOptions = {},
): Promise<BrainContextPack> {
  const message = sanitizeText(input.message || "", 1600);
  const surface = normalizeSurface(input.surface);
  const memoriesResult = await listBrainMemories(session, { ...options, limit: MAX_MEMORIES_RETURNED });
  const eventsResult = await readBrainEvents(session, { ...options, limit: 50 });
  const scored = memoriesResult.memories
    .map((memory) => {
      const scoredMemory = scoreMemory(memory, message);
      return { ...memory, score: scoredMemory.score, reason: scoredMemory.reason };
    })
    .filter((memory) => memory.score >= 5.6)
    .sort((left, right) => right.score - left.score)
    .slice(0, 8);
  const profile = deriveBehavioralProfile(memoriesResult.memories, eventsResult.events);
  const systemState = await getBrainSystemHealth();
  const intent = suggestIntent(message);
  const riskLevel = riskForIntent(message);
  const actionType = sanitizeText(input.proposedActionType, 80) || proposedActionType(message, intent);
  const needsApproval = riskLevel === "high" || riskLevel === "critical" || /external|spend|deploy|destructive|payment/.test(actionType);
  const activeRules = [
    "Do not claim PhantomForce modifies transformer weights, raw attention, or hidden model layers.",
    "Keep casual chat casual; do not auto-create tasks from brainstorming or greetings.",
    "External sends, posts, uploads, deploys, payments, invoices, spending, and destructive actions require approval.",
    "No secrets in memory, logs, or debug output.",
    ...scored
      .filter((memory) => ["rule", "safety", "correction"].includes(memory.type))
      .map((memory) => memory.text)
      .slice(0, 5),
  ];
  const microPromptLines = [
    "PhantomForce is an adaptive operator brain with controlled hands and feet at the application layer.",
    `Tone: ${profile.tonePreference}. Detail: ${profile.detailDepthPreference}.`,
    `Debug style: ${profile.preferredDebuggingStyle}.`,
    `Approval mode: ${profile.approvalStrictness}.`,
    ...scored.slice(0, 6).map((memory) => `Memory: ${memory.text}`),
    needsApproval
      ? "This request touches an approval-gated action. Draft/queue/review only; do not execute outside-world work silently."
      : "If this is chat or brainstorming, answer directly and do not create work unless explicitly asked.",
  ];
  const pack: BrainContextPack = {
    composedAt: new Date().toISOString(),
    currentMessage: message,
    surface,
    relevantMemories: scored,
    activeRules: [...new Set(activeRules)].slice(0, 12),
    systemState,
    behavioralProfile: profile,
    suggestedIntent: intent,
    riskLevel,
    needsApproval,
    proposedActionType: actionType,
    microPrompt: redactSensitiveText(microPromptLines.join("\n")).slice(0, 2400),
    debug: {
      reasons: [
        `selected ${scored.length} of ${memoriesResult.memories.length} active memories`,
        `intent=${intent}`,
        `risk=${riskLevel}`,
        `approval=${needsApproval ? "required" : "not_required"}`,
      ],
      memoryCandidates: memoriesResult.memories.length,
      injectedMemoryIds: scored.map((memory) => memory.id),
      noModelWeightClaims: true,
    },
  };
  if (input.logEvent) {
    await appendBrainEvent(
      session,
      {
        surface,
        type: "context_composed",
        summary: `Context composed for ${intent}: ${message || "(empty message)"}`,
        outcome: needsApproval ? "approval_gated_context" : "context_ready",
        importance: needsApproval ? "high" : "low",
        safeForMemory: false,
        source: "context_composer",
        metadata: {
          intent,
          riskLevel,
          needsApproval,
          memoryCount: scored.length,
          actionType,
        },
        logToHermes: false,
      },
      options,
    );
  }
  return pack;
}

export async function recordBrainFeedback(
  session: AccessSession,
  input: {
    kind?: unknown;
    text?: unknown;
    targetId?: unknown;
    useful?: unknown;
    surface?: unknown;
  },
  options: BrainStoreOptions = {},
) {
  const kind = sanitizeText(input.kind || "feedback", 80) || "feedback";
  const text = sanitizeText(input.text, MAX_TEXT_CHARS);
  if (!text && input.useful === undefined) throw new Error("feedback_text_required");
  const summary = text || (input.useful ? "Output marked useful." : "Output marked not useful.");
  const event = await appendBrainEvent(
    session,
    {
      surface: normalizeSurface(input.surface),
      type: `feedback.${kind}`,
      summary,
      linkedRunId: typeof input.targetId === "string" ? input.targetId : null,
      outcome: input.useful === false ? "negative_feedback" : "feedback_recorded",
      importance: /never|wrong|do not|don't|too robotic|next time/i.test(summary) ? "high" : "medium",
      safeForMemory: true,
      source: "feedback_integrator",
      metadata: { kind, useful: input.useful === undefined ? null : Boolean(input.useful) },
    },
    options,
  );

  let suggestedMemory: BrainMemoryRecord | null = null;
  if (/remember|always|never|do not|don't|next time|too robotic|more human|higgsfield|rembg|approval/i.test(summary)) {
    suggestedMemory = await createBrainMemory(
      session,
      {
        text: summary,
        type: inferMemoryType(summary),
        confidence: /remember|always|never/i.test(summary) ? 0.78 : 0.58,
        weight: /never|always|approval|higgsfield|rembg/i.test(summary) ? 0.78 : 0.58,
        source: "feedback_integrator",
        sourceEventId: event.id,
      },
      options,
    );
  }

  return { event, suggestedMemory };
}

export async function buildBrainStatus(session: AccessSession, options: BrainStoreOptions = {}) {
  await ensureBrainBootstrapMemories(session, options);
  const [memories, events, health, ledgerRecords] = await Promise.all([
    listBrainMemories(session, { ...options, limit: MAX_MEMORIES_RETURNED }),
    readBrainEvents(session, { ...options, limit: MAX_EVENTS_RETURNED }),
    getBrainSystemHealth(),
    readRedactedHermesLedgerRecords({ limit: 50 }),
  ]);
  const profile = deriveBehavioralProfile(memories.memories, events.events);
  const recentContext = events.events.find((event) => event.type === "context_composed") || null;
  return {
    generatedAt: new Date().toISOString(),
    brainStatus: {
      active: true,
      mode: "application_layer_neural_spine",
      memoryCount: memories.memories.length,
      ledgerEventCount: ledgerRecords.length,
      brainEventCount: events.events.length,
      recentContextComposerRun: recentContext,
      profileConfidence: profile.confidence,
      approvalMode: "approval_first_for_external_actions",
      noModelWeightClaims: true,
    },
    memoryVault: memories,
    behavioralProfile: profile,
    recentLearnings: memories.memories
      .filter((memory) => ["correction", "preference", "rule", "tool_state"].includes(memory.type))
      .slice(0, 8),
    feedbackSignals: events.events.filter((event) => event.type.startsWith("feedback.")).slice(0, 12),
    recentEvents: events.events.slice(0, 20),
    actionSafety: {
      requiresApproval: [
        "external sends",
        "social posts",
        "uploads",
        "deployments",
        "payments/invoices/charges",
        "spending credits",
        "destructive file or data actions",
      ],
      allowedLocally: ["drafting", "planning", "context preview", "memory edits", "local image/background edits", "read-only status checks"],
      blocked: ["secret capture", "cookie scraping", "cross-tenant memory reads", "silent approval execution"],
      manualModeOnly: health.higgsfield.apiConnected ? [] : ["Higgsfield creator workflow"],
    },
    systemBrainHealth: health,
    stores: {
      memoryPath: memories.storePath,
      eventsPath: events.storePath,
      malformedMemoryLines: memories.malformed,
      malformedEventLines: events.malformed,
    },
  };
}
