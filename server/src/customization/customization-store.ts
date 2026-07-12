import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { OrganizationConfiguration } from "./schemas.js";

export type ConfigurationVersion = {
  id: string;
  tenantId: string;
  version: number;
  summary: string;
  author: string;
  approvedBy: string;
  createdAt: string;
  checksum: string;
  configuration: OrganizationConfiguration;
};

export type ConfigurationAuditEntry = {
  id: string;
  tenantId: string;
  actor: string;
  eventType: "created" | "published" | "rolled_back" | "reset" | "previewed";
  version: number;
  summary: string;
  createdAt: string;
};

type TenantCustomizationDocument = {
  current: OrganizationConfiguration;
  versions: ConfigurationVersion[];
  audit: ConfigurationAuditEntry[];
};

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../../..");
const defaultRoot = resolve(repoRoot, "server/.local/customization");
const locks = new Map<string, Promise<unknown>>();

function safeTenantId(tenantId: string) {
  return tenantId.trim().replace(/[^a-zA-Z0-9_.:-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "unknown";
}

function checksum(configuration: OrganizationConfiguration) {
  return createHash("sha256").update(JSON.stringify(configuration)).digest("hex");
}

export function customizationRoot(override?: string) {
  return resolve(override || process.env.PHANTOMFORCE_CUSTOMIZATION_DIR || defaultRoot);
}

function documentPath(tenantId: string, root?: string) {
  return resolve(customizationRoot(root), `${safeTenantId(tenantId)}.json`);
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

export async function readCustomizationDocument(tenantId: string, root?: string): Promise<TenantCustomizationDocument | null> {
  try {
    return JSON.parse(await readFile(documentPath(tenantId, root), "utf8")) as TenantCustomizationDocument;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function writeCustomizationDocument(document: TenantCustomizationDocument, root?: string) {
  return withTenantLock(document.current.tenantId, async () => {
    const path = documentPath(document.current.tenantId, root);
    await mkdir(dirname(path), { recursive: true });
    const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    await rename(temporaryPath, path);
    return path;
  });
}

export function makeVersion(configuration: OrganizationConfiguration, summary: string, author: string): ConfigurationVersion {
  return {
    id: randomUUID(),
    tenantId: configuration.tenantId,
    version: configuration.version,
    summary: summary.slice(0, 240),
    author,
    approvedBy: author,
    createdAt: configuration.updatedAt,
    checksum: checksum(configuration),
    configuration: structuredClone(configuration),
  };
}

export function makeAudit(
  configuration: OrganizationConfiguration,
  actor: string,
  eventType: ConfigurationAuditEntry["eventType"],
  summary: string,
): ConfigurationAuditEntry {
  return {
    id: randomUUID(),
    tenantId: configuration.tenantId,
    actor,
    eventType,
    version: configuration.version,
    summary: summary.slice(0, 240),
    createdAt: new Date().toISOString(),
  };
}

export async function persistConfiguration(options: {
  configuration: OrganizationConfiguration;
  summary: string;
  actor: string;
  eventType: ConfigurationAuditEntry["eventType"];
  root?: string;
}) {
  const existing = await readCustomizationDocument(options.configuration.tenantId, options.root);
  const version = makeVersion(options.configuration, options.summary, options.actor);
  const document: TenantCustomizationDocument = {
    current: options.configuration,
    versions: [...(existing?.versions ?? []), version].slice(-50),
    audit: [...(existing?.audit ?? []), makeAudit(options.configuration, options.actor, options.eventType, options.summary)].slice(-300),
  };
  const path = await writeCustomizationDocument(document, options.root);
  return { path, document, version };
}
