import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ActionSchema, type ActionPolicy, type ActionType } from "@phantomforce/contracts";

export type WorkGraphStatus =
  | "awaiting_approval"
  | "executing"
  | "verified_complete"
  | "blocked"
  | "failed"
  | "rejected";

export type WorkGraphReceipt = {
  id: string;
  actionId: string;
  correlationId: string;
  outcome: "verified_complete" | "blocked" | "failed";
  summary: string;
  artifactType: string | null;
  artifactId: string | null;
  verifiedAt: string | null;
  blockedReason: string | null;
  remediation: string | null;
  createdAt: string;
};

export type WorkGraphAction = {
  id: string;
  tenantId: string;
  type: ActionType;
  payload: Record<string, unknown>;
  policy: ActionPolicy;
  status: WorkGraphStatus;
  proposedBy: "ai" | "user" | "system";
  proposedByActor: string;
  rationale: string;
  idempotencyKey: string;
  correlationId: string;
  approval: {
    required: boolean;
    status: "not_required" | "pending" | "approved" | "rejected";
    decidedBy: string | null;
    decidedAt: string | null;
    note: string | null;
  };
  receipt: WorkGraphReceipt | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkGraphTask = {
  id: string;
  actionId: string;
  title: string;
  status: "open" | "done";
  dueAt: string | null;
  priority: "low" | "medium" | "high";
  project: string | null;
  createdAt: string;
};

export type WorkGraphNote = {
  id: string;
  actionId: string;
  title: string;
  body: string;
  tags: string[];
  createdAt: string;
};

export type WorkGraphContact = {
  id: string;
  actionId: string;
  name: string;
  email: string | null;
  phone: string | null;
  organization: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkGraphDraft = {
  id: string;
  actionId: string;
  kind: "email" | "calendar";
  title: string;
  payload: Record<string, unknown>;
  status: "draft";
  createdAt: string;
};

export type WorkGraphAuditEvent = {
  id: string;
  tenantId: string;
  actor: string;
  actionId: string;
  correlationId: string;
  eventType: "proposed" | "approved" | "rejected" | "executing" | "verified_complete" | "blocked" | "failed";
  summary: string;
  prevHash: string | null;
  hash: string;
  createdAt: string;
};

export type WorkGraphDocument = {
  schemaVersion: 1;
  tenantId: string;
  version: number;
  actions: WorkGraphAction[];
  tasks: WorkGraphTask[];
  notes: WorkGraphNote[];
  contacts: WorkGraphContact[];
  drafts: WorkGraphDraft[];
  audit: WorkGraphAuditEvent[];
  updatedAt: string;
  updatedBy: string;
  checksum: string;
};

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../../..");
const defaultRoot = resolve(repoRoot, "server/.local/work-graph");
const locks = new Map<string, Promise<unknown>>();
const MAX_ACTIONS = 500;
const MAX_ARTIFACTS = 1_000;
const MAX_AUDIT_EVENTS = 2_000;

const now = () => new Date().toISOString();

function safeTenantId(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9_.:-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "unknown";
}

function cleanText(value: unknown, max = 240) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function cleanBody(value: unknown, max = 12_000) {
  return typeof value === "string" ? value.replace(/\r\n/g, "\n").trim().slice(0, max) : "";
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return structuredClone(value) as Record<string, unknown>;
}

function checksum(document: Omit<WorkGraphDocument, "checksum">) {
  return createHash("sha256").update(JSON.stringify(document)).digest("hex");
}

function withChecksum(document: Omit<WorkGraphDocument, "checksum">): WorkGraphDocument {
  return { ...document, checksum: checksum(document) };
}

export function workGraphRoot(override?: string) {
  return resolve(override || process.env.PHANTOMFORCE_WORK_GRAPH_DIR || defaultRoot);
}

function documentPath(tenantId: string, root?: string) {
  return resolve(workGraphRoot(root), `${safeTenantId(tenantId)}.json`);
}

async function withTenantLock<T>(tenantId: string, operation: () => Promise<T>): Promise<T> {
  const key = safeTenantId(tenantId);
  const previous = locks.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  locks.set(key, current);
  try {
    return await current;
  } finally {
    if (locks.get(key) === current) locks.delete(key);
  }
}

export function defaultWorkGraphDocument(tenantId: string, actor = "system"): WorkGraphDocument {
  const createdAt = now();
  return withChecksum({
    schemaVersion: 1,
    tenantId: safeTenantId(tenantId),
    version: 1,
    actions: [],
    tasks: [],
    notes: [],
    contacts: [],
    drafts: [],
    audit: [],
    updatedAt: createdAt,
    updatedBy: cleanText(actor, 120) || "system",
  });
}

export async function readWorkGraphDocument(tenantId: string, root?: string): Promise<WorkGraphDocument | null> {
  try {
    const parsed = JSON.parse(await readFile(documentPath(tenantId, root), "utf8")) as WorkGraphDocument;
    const base = defaultWorkGraphDocument(parsed.tenantId || tenantId, parsed.updatedBy || "system");
    return withChecksum({
      ...base,
      schemaVersion: 1,
      tenantId: safeTenantId(parsed.tenantId || tenantId),
      version: Number.isInteger(parsed.version) && parsed.version > 0 ? parsed.version : 1,
      actions: Array.isArray(parsed.actions) ? parsed.actions.slice(0, MAX_ACTIONS) : [],
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks.slice(0, MAX_ARTIFACTS) : [],
      notes: Array.isArray(parsed.notes) ? parsed.notes.slice(0, MAX_ARTIFACTS) : [],
      contacts: Array.isArray(parsed.contacts) ? parsed.contacts.slice(0, MAX_ARTIFACTS) : [],
      drafts: Array.isArray(parsed.drafts) ? parsed.drafts.slice(0, MAX_ARTIFACTS) : [],
      audit: Array.isArray(parsed.audit) ? parsed.audit.slice(-MAX_AUDIT_EVENTS) : [],
      updatedAt: cleanText(parsed.updatedAt, 80) || base.updatedAt,
      updatedBy: cleanText(parsed.updatedBy, 120) || base.updatedBy,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function writeDocument(document: WorkGraphDocument, root?: string) {
  const path = documentPath(document.tenantId, root);
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
  return path;
}

export async function getWorkGraphDocument(tenantId: string, actor = "system", root?: string) {
  return await readWorkGraphDocument(tenantId, root) ?? defaultWorkGraphDocument(tenantId, actor);
}

function appendAudit(
  document: WorkGraphDocument,
  input: Omit<WorkGraphAuditEvent, "id" | "tenantId" | "prevHash" | "hash" | "createdAt">,
) {
  const createdAt = now();
  const prevHash = document.audit.at(-1)?.hash ?? null;
  const body = {
    tenantId: document.tenantId,
    actor: cleanText(input.actor, 120) || "system",
    actionId: input.actionId,
    correlationId: input.correlationId,
    eventType: input.eventType,
    summary: cleanText(input.summary, 500),
    prevHash,
    createdAt,
  };
  const event: WorkGraphAuditEvent = {
    id: randomUUID(),
    ...body,
    hash: createHash("sha256").update(JSON.stringify(body)).digest("hex"),
  };
  document.audit.push(event);
  return event;
}

async function mutateDocument<T>(
  tenantId: string,
  actor: string,
  operation: (document: WorkGraphDocument) => Promise<T> | T,
  root?: string,
) {
  return withTenantLock(tenantId, async () => {
    const current = await getWorkGraphDocument(tenantId, actor, root);
    const result = await operation(current);
    const updated = withChecksum({
      schemaVersion: 1,
      tenantId: current.tenantId,
      version: current.version + 1,
      actions: current.actions.slice(0, MAX_ACTIONS),
      tasks: current.tasks.slice(0, MAX_ARTIFACTS),
      notes: current.notes.slice(0, MAX_ARTIFACTS),
      contacts: current.contacts.slice(0, MAX_ARTIFACTS),
      drafts: current.drafts.slice(0, MAX_ARTIFACTS),
      audit: current.audit.slice(-MAX_AUDIT_EVENTS),
      updatedAt: now(),
      updatedBy: cleanText(actor, 120) || "system",
    });
    const path = await writeDocument(updated, root);
    return { path, document: updated, result };
  });
}

function verifiedReceipt(action: WorkGraphAction, summary: string, artifactType: string, artifactId: string): WorkGraphReceipt {
  const createdAt = now();
  return {
    id: randomUUID(),
    actionId: action.id,
    correlationId: action.correlationId,
    outcome: "verified_complete",
    summary,
    artifactType,
    artifactId,
    verifiedAt: createdAt,
    blockedReason: null,
    remediation: null,
    createdAt,
  };
}

function blockedReceipt(action: WorkGraphAction, reason: string, remediation: string): WorkGraphReceipt {
  return {
    id: randomUUID(),
    actionId: action.id,
    correlationId: action.correlationId,
    outcome: "blocked",
    summary: `Blocked: ${reason}`,
    artifactType: null,
    artifactId: null,
    verifiedAt: null,
    blockedReason: reason,
    remediation,
    createdAt: now(),
  };
}

function executeAction(document: WorkGraphDocument, action: WorkGraphAction, actor: string) {
  action.status = "executing";
  action.updatedAt = now();
  appendAudit(document, {
    actor,
    actionId: action.id,
    correlationId: action.correlationId,
    eventType: "executing",
    summary: `Executing ${action.type}.`,
  });

  const payload = action.payload;
  if (action.type === "task.create") {
    const task: WorkGraphTask = {
      id: randomUUID(),
      actionId: action.id,
      title: cleanText(payload.title, 300),
      status: "open",
      dueAt: cleanText(payload.due, 80) || null,
      priority: payload.priority === "low" || payload.priority === "high" ? payload.priority : "medium",
      project: cleanText(payload.project, 180) || null,
      createdAt: now(),
    };
    document.tasks.unshift(task);
    const verified = document.tasks.some((candidate) => candidate.id === task.id && candidate.actionId === action.id);
    if (!verified) throw new Error("Task write could not be verified.");
    action.receipt = verifiedReceipt(action, `Created and verified task: ${task.title}`, "task", task.id);
  } else if (action.type === "note.create") {
    const note: WorkGraphNote = {
      id: randomUUID(),
      actionId: action.id,
      title: cleanText(payload.title, 300),
      body: cleanBody(payload.body),
      tags: Array.isArray(payload.tags) ? payload.tags.map((tag) => cleanText(tag, 80)).filter(Boolean).slice(0, 30) : [],
      createdAt: now(),
    };
    document.notes.unshift(note);
    const verified = document.notes.some((candidate) => candidate.id === note.id && candidate.actionId === action.id);
    if (!verified) throw new Error("Note write could not be verified.");
    action.receipt = verifiedReceipt(action, `Created and verified note: ${note.title}`, "note", note.id);
  } else if (action.type === "contact.upsert") {
    const contactId = cleanText(payload.contactId, 80);
    const email = cleanText(payload.email, 320).toLowerCase();
    let contact = document.contacts.find((candidate) => (contactId && candidate.id === contactId) || (email && candidate.email === email));
    if (contact) {
      contact.name = cleanText(payload.name, 240);
      contact.email = email || null;
      contact.phone = cleanText(payload.phone, 80) || null;
      contact.organization = cleanText(payload.organization, 240) || null;
      contact.actionId = action.id;
      contact.updatedAt = now();
    } else {
      contact = {
        id: contactId || randomUUID(),
        actionId: action.id,
        name: cleanText(payload.name, 240),
        email: email || null,
        phone: cleanText(payload.phone, 80) || null,
        organization: cleanText(payload.organization, 240) || null,
        createdAt: now(),
        updatedAt: now(),
      };
      document.contacts.unshift(contact);
    }
    const verified = document.contacts.some((candidate) => candidate.id === contact!.id && candidate.name === contact!.name);
    if (!verified) throw new Error("Contact write could not be verified.");
    action.receipt = verifiedReceipt(action, `Upserted and verified contact: ${contact.name}`, "contact", contact.id);
  } else if (action.type === "email.draft") {
    const draft: WorkGraphDraft = {
      id: randomUUID(),
      actionId: action.id,
      kind: "email",
      title: cleanText(payload.subject, 300),
      payload: {
        to: Array.isArray(payload.to) ? payload.to.map((value) => cleanText(value, 320)).filter(Boolean).slice(0, 50) : [],
        subject: cleanText(payload.subject, 300),
        body: cleanBody(payload.body),
        threadId: cleanText(payload.threadId, 180) || null,
      },
      status: "draft",
      createdAt: now(),
    };
    document.drafts.unshift(draft);
    const verified = document.drafts.some((candidate) => candidate.id === draft.id && candidate.actionId === action.id);
    if (!verified) throw new Error("Email draft write could not be verified.");
    action.receipt = verifiedReceipt(action, `Prepared and verified email draft: ${draft.title}`, "email_draft", draft.id);
  } else if (action.type === "calendar.event.propose") {
    const proposal: WorkGraphDraft = {
      id: randomUUID(),
      actionId: action.id,
      kind: "calendar",
      title: cleanText(payload.title, 300),
      payload: {
        title: cleanText(payload.title, 300),
        start: cleanText(payload.start, 80),
        end: cleanText(payload.end, 80),
        attendees: Array.isArray(payload.attendees) ? payload.attendees.map((value) => cleanText(value, 320)).filter(Boolean).slice(0, 100) : [],
        description: cleanBody(payload.description, 4_000),
      },
      status: "draft",
      createdAt: now(),
    };
    document.drafts.unshift(proposal);
    const verified = document.drafts.some((candidate) => candidate.id === proposal.id && candidate.actionId === action.id);
    if (!verified) throw new Error("Calendar proposal write could not be verified.");
    action.receipt = verifiedReceipt(action, `Prepared and verified calendar proposal: ${proposal.title}`, "calendar_proposal", proposal.id);
  } else if (action.policy.surface === "external") {
    const reason = action.type === "email.send"
      ? "No verified email delivery connector is active for this organization."
      : action.type === "calendar.event.commit"
        ? "No verified calendar write connector is active for this organization."
        : `No verified external executor is active for ${action.type}.`;
    const remediation = action.type === "email.send"
      ? "Connect and verify Gmail or Outlook in Connections, then retry this approved action."
      : action.type === "calendar.event.commit"
        ? "Connect and verify a calendar account in Connections, then retry this approved action."
        : "Connect and verify the required provider, then retry the action.";
    action.receipt = blockedReceipt(action, reason, remediation);
  } else {
    action.receipt = blockedReceipt(
      action,
      `${action.type} does not yet have a verified internal executor.`,
      "Use a supported internal action or add a tested executor before retrying.",
    );
  }

  action.status = action.receipt.outcome;
  action.updatedAt = now();
  appendAudit(document, {
    actor,
    actionId: action.id,
    correlationId: action.correlationId,
    eventType: action.receipt.outcome,
    summary: action.receipt.summary,
  });
  return action;
}

export async function proposeWorkAction(options: {
  tenantId: string;
  actor: string;
  action: unknown;
  idempotencyKey: string;
  correlationId?: string;
  root?: string;
}) {
  const parsed = ActionSchema.safeParse(options.action);
  if (!parsed.success) throw new Error(`Invalid action: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
  const idempotencyKey = cleanText(options.idempotencyKey, 180);
  if (!idempotencyKey) throw new Error("An idempotency key is required.");
  return mutateDocument(options.tenantId, options.actor, (document) => {
    const existing = document.actions.find((candidate) => candidate.idempotencyKey === idempotencyKey && candidate.type === parsed.data.type);
    if (existing) return { action: existing, replayed: true };
    const createdAt = now();
    const action: WorkGraphAction = {
      id: parsed.data.id || randomUUID(),
      tenantId: document.tenantId,
      type: parsed.data.type,
      payload: asRecord(parsed.data.payload),
      policy: parsed.data.policy,
      status: parsed.data.policy.requiresApproval ? "awaiting_approval" : "executing",
      proposedBy: parsed.data.proposedBy,
      proposedByActor: cleanText(options.actor, 120) || "system",
      rationale: cleanBody(parsed.data.rationale, 2_000),
      idempotencyKey,
      correlationId: cleanText(options.correlationId, 180) || randomUUID(),
      approval: {
        required: parsed.data.policy.requiresApproval,
        status: parsed.data.policy.requiresApproval ? "pending" : "not_required",
        decidedBy: null,
        decidedAt: null,
        note: null,
      },
      receipt: null,
      createdAt,
      updatedAt: createdAt,
    };
    document.actions.unshift(action);
    appendAudit(document, {
      actor: options.actor,
      actionId: action.id,
      correlationId: action.correlationId,
      eventType: "proposed",
      summary: `Proposed ${action.type}; approval ${action.approval.required ? "required" : "not required"}.`,
    });
    if (!action.approval.required) executeAction(document, action, options.actor);
    return { action, replayed: false };
  }, options.root);
}

export async function decideWorkAction(options: {
  tenantId: string;
  actionId: string;
  actor: string;
  decision: "approve" | "reject";
  note?: string;
  root?: string;
}) {
  return mutateDocument(options.tenantId, options.actor, (document) => {
    const action = document.actions.find((candidate) => candidate.id === options.actionId);
    if (!action) throw new Error("Work action not found for this organization.");
    if (!action.approval.required) return { action, replayed: true };
    if (action.approval.status !== "pending") return { action, replayed: true };
    action.approval.status = options.decision === "approve" ? "approved" : "rejected";
    action.approval.decidedBy = cleanText(options.actor, 120) || "owner";
    action.approval.decidedAt = now();
    action.approval.note = cleanBody(options.note, 1_200) || null;
    action.updatedAt = now();
    if (options.decision === "reject") {
      action.status = "rejected";
      appendAudit(document, {
        actor: options.actor,
        actionId: action.id,
        correlationId: action.correlationId,
        eventType: "rejected",
        summary: `Rejected ${action.type}; nothing executed.`,
      });
      return { action, replayed: false };
    }
    appendAudit(document, {
      actor: options.actor,
      actionId: action.id,
      correlationId: action.correlationId,
      eventType: "approved",
      summary: `Approved ${action.type}.`,
    });
    try {
      executeAction(document, action, options.actor);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Execution failed without a usable error.";
      action.status = "failed";
      action.receipt = {
        id: randomUUID(),
        actionId: action.id,
        correlationId: action.correlationId,
        outcome: "failed",
        summary: `Failed: ${message}`,
        artifactType: null,
        artifactId: null,
        verifiedAt: null,
        blockedReason: null,
        remediation: "Review the failure, correct the input or service, and retry with a new idempotency key.",
        createdAt: now(),
      };
      appendAudit(document, {
        actor: options.actor,
        actionId: action.id,
        correlationId: action.correlationId,
        eventType: "failed",
        summary: action.receipt.summary,
      });
    }
    return { action, replayed: false };
  }, options.root);
}

export async function decideAllSafeWorkActions(options: {
  tenantId: string;
  actor: string;
  root?: string;
}) {
  return mutateDocument(options.tenantId, options.actor, (document) => {
    const candidates = document.actions.filter((action) => action.status === "awaiting_approval" && action.policy.surface === "internal").slice(0, 25);
    const completed: WorkGraphAction[] = [];
    for (const action of candidates) {
      action.approval.status = "approved";
      action.approval.decidedBy = cleanText(options.actor, 120) || "owner";
      action.approval.decidedAt = now();
      action.updatedAt = now();
      appendAudit(document, {
        actor: options.actor,
        actionId: action.id,
        correlationId: action.correlationId,
        eventType: "approved",
        summary: `Approved ${action.type} in safe bulk decision.`,
      });
      executeAction(document, action, options.actor);
      completed.push(action);
    }
    return { completed, skippedExternal: document.actions.filter((action) => action.status === "awaiting_approval" && action.policy.surface === "external").length };
  }, options.root);
}

export async function getWorkGraphHeartbeat(tenantId: string, actor = "system", root?: string) {
  const document = await getWorkGraphDocument(tenantId, actor, root);
  const needsYou = document.actions.filter((action) => action.status === "awaiting_approval");
  const inMotion = document.actions.filter((action) => action.status === "executing");
  const verified = document.actions.filter((action) => action.status === "verified_complete").slice(0, 10);
  const blocked = document.actions.filter((action) => action.status === "blocked" || action.status === "failed").slice(0, 10);
  const openTasks = document.tasks.filter((task) => task.status === "open");
  const safeBulkCount = needsYou.filter((action) => action.policy.surface === "internal").length;
  return {
    tenantId: document.tenantId,
    generatedAt: now(),
    storage: "tenant_work_graph",
    version: document.version,
    checksum: document.checksum,
    needsYou,
    inMotion,
    verified,
    blocked,
    nothingSlips: {
      openTaskCount: openTasks.length,
      nextTask: openTasks
        .slice()
        .sort((left, right) => String(left.dueAt || "9999").localeCompare(String(right.dueAt || "9999")))[0] ?? null,
    },
    canApproveAllSafe: safeBulkCount > 0,
    safeBulkCount,
    auditTail: document.audit.slice(-20).reverse(),
  };
}

export function publicWorkGraphAction(action: WorkGraphAction) {
  return structuredClone(action);
}
