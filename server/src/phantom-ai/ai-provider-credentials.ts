import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const AI_CREDENTIAL_PROVIDER_IDS = ["deepseek_api"] as const;
export type AiCredentialProviderId = (typeof AI_CREDENTIAL_PROVIDER_IDS)[number];

type EncryptedCredential = {
  version: 1;
  provider_id: AiCredentialProviderId;
  algorithm: "aes-256-gcm";
  iv: string;
  tag: string;
  ciphertext: string;
  key_hint: string;
  updated_at: string;
  updated_by: string;
};

type CredentialDocument = {
  version: 1;
  tenant_id: string;
  credentials: Partial<Record<AiCredentialProviderId, EncryptedCredential>>;
};

type CredentialStoreOptions = {
  root?: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
};

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../../..");
const defaultRoot = resolve(repoRoot, "server/.local/ai-provider-credentials");
const locks = new Map<string, Promise<unknown>>();

function safeTenantId(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9_.:-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "unknown";
}

function rootPath(options: CredentialStoreOptions = {}) {
  return resolve(options.root || options.env?.PHANTOMFORCE_AI_CREDENTIALS_DIR || process.env.PHANTOMFORCE_AI_CREDENTIALS_DIR || defaultRoot);
}

function documentPath(tenantId: string, options: CredentialStoreOptions = {}) {
  return resolve(rootPath(options), `${safeTenantId(tenantId)}.json`);
}

function encryptionSecret(env: CredentialStoreOptions["env"] = process.env) {
  return env?.PHANTOMFORCE_AI_CREDENTIALS_SECRET?.trim()
    || env?.PHANTOMFORCE_SESSION_SECRET?.trim()
    || "";
}

function encryptionKey(options: CredentialStoreOptions = {}) {
  const secret = encryptionSecret(options.env);
  if (!secret) {
    throw Object.assign(new Error("AI provider credential encryption is not configured on this server."), {
      statusCode: 503,
      code: "AI_CREDENTIAL_ENCRYPTION_NOT_CONFIGURED",
    });
  }
  return createHash("sha256").update(secret, "utf8").digest();
}

function providerEnvironmentKey(providerId: AiCredentialProviderId, env: CredentialStoreOptions["env"] = process.env) {
  if (providerId === "deepseek_api") return env?.DEEPSEEK_API_KEY?.trim() || "";
  return "";
}

function cleanCredential(value: unknown) {
  if (typeof value !== "string") return "";
  const credential = value.trim();
  if (credential.length < 12 || credential.length > 512 || /[\r\n\0]/.test(credential)) return "";
  return credential;
}

function keyHint(value: string) {
  return value.length >= 4 ? `...${value.slice(-4)}` : "configured";
}

function encryptCredential(providerId: AiCredentialProviderId, credential: string, actor: string, options: CredentialStoreOptions) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(options), iv);
  const ciphertext = Buffer.concat([cipher.update(credential, "utf8"), cipher.final()]);
  return {
    version: 1,
    provider_id: providerId,
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    key_hint: keyHint(credential),
    updated_at: new Date().toISOString(),
    updated_by: actor.trim().slice(0, 120) || "system",
  } satisfies EncryptedCredential;
}

function decryptCredential(record: EncryptedCredential, options: CredentialStoreOptions) {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(options), Buffer.from(record.iv, "base64"));
  decipher.setAuthTag(Buffer.from(record.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(record.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

async function readDocument(tenantId: string, options: CredentialStoreOptions = {}): Promise<CredentialDocument> {
  try {
    const parsed = JSON.parse(await readFile(documentPath(tenantId, options), "utf8")) as CredentialDocument;
    if (parsed?.version !== 1 || parsed.tenant_id !== safeTenantId(tenantId)) throw new Error("Invalid AI credential document.");
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, tenant_id: safeTenantId(tenantId), credentials: {} };
    }
    throw error;
  }
}

async function writeDocument(document: CredentialDocument, options: CredentialStoreOptions = {}) {
  const path = documentPath(document.tenant_id, options);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

async function withTenantLock<T>(tenantId: string, operation: () => Promise<T>) {
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

export async function getAiProviderCredentialStatus(tenantId: string, options: CredentialStoreOptions = {}) {
  const document = await readDocument(tenantId, options);
  return Object.fromEntries(AI_CREDENTIAL_PROVIDER_IDS.map((providerId) => {
    const stored = document.credentials[providerId];
    const environmentCredential = providerEnvironmentKey(providerId, options.env);
    return [providerId, {
      configured: Boolean(stored || environmentCredential),
      source: stored ? "encrypted_server_vault" : environmentCredential ? "server_environment" : "none",
      key_hint: stored?.key_hint || (environmentCredential ? keyHint(environmentCredential) : null),
      updated_at: stored?.updated_at || null,
      removable: Boolean(stored),
      secret_returned: false,
    }];
  }));
}

export async function getAiProviderCredential(
  tenantId: string,
  providerId: AiCredentialProviderId,
  options: CredentialStoreOptions = {},
) {
  const document = await readDocument(tenantId, options);
  const stored = document.credentials[providerId];
  if (stored) return decryptCredential(stored, options);
  return providerEnvironmentKey(providerId, options.env) || null;
}

export async function saveAiProviderCredential(options: CredentialStoreOptions & {
  tenantId: string;
  providerId: AiCredentialProviderId;
  credential: unknown;
  actor: string;
}) {
  const credential = cleanCredential(options.credential);
  if (!credential) {
    throw Object.assign(new Error("Enter a valid provider API key."), {
      statusCode: 400,
      code: "AI_PROVIDER_CREDENTIAL_INVALID",
    });
  }
  return withTenantLock(options.tenantId, async () => {
    const document = await readDocument(options.tenantId, options);
    document.credentials[options.providerId] = encryptCredential(options.providerId, credential, options.actor, options);
    await writeDocument(document, options);
    return (await getAiProviderCredentialStatus(options.tenantId, options))[options.providerId];
  });
}

export async function deleteAiProviderCredential(
  tenantId: string,
  providerId: AiCredentialProviderId,
  options: CredentialStoreOptions = {},
) {
  return withTenantLock(tenantId, async () => {
    const document = await readDocument(tenantId, options);
    delete document.credentials[providerId];
    if (Object.keys(document.credentials).length) await writeDocument(document, options);
    else await unlink(documentPath(tenantId, options)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    return (await getAiProviderCredentialStatus(tenantId, options))[providerId];
  });
}
