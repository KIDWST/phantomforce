import { createHash } from "node:crypto";

export type CrmContactSnapshot = Record<string, unknown> & { id: string; orgId: string };

const scalarFields = [
  "name", "email", "phone", "organization", "status", "type", "value", "nextStep", "notes",
  "source", "website", "avatarUrl", "fitScore", "outreach", "crmStage", "dueAt", "lastTouchAt",
] as const;

function stableHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function hasValue(value: unknown) {
  return value !== undefined && value !== null && value !== "";
}

function uniqueStrings(...values: unknown[]) {
  return [...new Set(values.flatMap((value) => Array.isArray(value) ? value : []).filter((value): value is string => typeof value === "string" && Boolean(value.trim())))];
}

function mergeSocials(source: unknown, target: unknown) {
  const left = source && typeof source === "object" && !Array.isArray(source) ? source : {};
  const right = target && typeof target === "object" && !Array.isArray(target) ? target : {};
  return { ...left, ...right };
}

export function crmContactFingerprint(contact: CrmContactSnapshot) {
  return stableHash(contact);
}

export function buildCrmMergePreview(input: {
  orgId: string;
  source: CrmContactSnapshot;
  target: CrmContactSnapshot;
}) {
  if (input.source.orgId !== input.orgId || input.target.orgId !== input.orgId) throw new Error("crm_cross_tenant_merge_blocked");
  if (input.source.id === input.target.id) throw new Error("crm_merge_requires_two_contacts");
  const merged: CrmContactSnapshot = { ...input.target, id: input.target.id, orgId: input.orgId };
  for (const field of scalarFields) {
    if (!hasValue(merged[field]) && hasValue(input.source[field])) merged[field] = input.source[field];
  }
  merged.tags = uniqueStrings(input.target.tags, input.source.tags);
  merged.qualification = uniqueStrings(input.target.qualification, input.source.qualification);
  merged.socials = mergeSocials(input.source.socials, input.target.socials);
  const changes = Object.keys(merged).filter((key) => JSON.stringify(merged[key]) !== JSON.stringify(input.target[key]));
  const previewPayload = {
    orgId: input.orgId,
    sourceId: input.source.id,
    targetId: input.target.id,
    sourceFingerprint: crmContactFingerprint(input.source),
    targetFingerprint: crmContactFingerprint(input.target),
    merged,
  };
  return {
    sourceId: input.source.id,
    targetId: input.target.id,
    source: structuredClone(input.source),
    target: structuredClone(input.target),
    merged,
    changes,
    previewHash: stableHash(previewPayload),
  };
}

export function crmStageTransition(input: {
  contactId: string;
  actor: string;
  beforeStatus: string;
  afterStatus: string;
  beforeStage: string;
  afterStage: string;
  at?: string;
}) {
  const changed = input.beforeStatus !== input.afterStatus || input.beforeStage !== input.afterStage;
  return changed ? {
    contactId: input.contactId,
    actor: input.actor,
    from: { status: input.beforeStatus, stage: input.beforeStage },
    to: { status: input.afterStatus, stage: input.afterStage },
    at: input.at || new Date().toISOString(),
  } : null;
}
