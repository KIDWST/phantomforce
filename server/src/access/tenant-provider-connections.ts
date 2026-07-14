import { prisma } from "./prisma-runtime.js";

const SECRET_PATTERN = /(?:sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{20,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9_]{12,}|xox[baprs]-[A-Za-z0-9-]{10,}|api[_-]?key\s*[:=]|secret\s*[:=]|token\s*[:=])/i;
const HIGH_ENTROPY_TOKEN_PATTERN = /^[A-Za-z0-9_+=/.-]{32,}$/;
const HEX_TOKEN_PATTERN = /^[a-f0-9]{32,}$/i;

function requirePrisma() {
  if (!prisma) throw new Error("Provider connections require DATABASE_URL.");
  return prisma;
}

function clean(value: string | undefined, max = 160) {
  return String(value ?? "").trim().replace(/[<>]/g, "").slice(0, max);
}

function assertNoSecret(value: string, field: string) {
  const compact = value.trim();
  const tokenClassCount = [
    /[a-z]/.test(compact),
    /[A-Z]/.test(compact),
    /\d/.test(compact),
    /[_+=/.-]/.test(compact),
  ].filter(Boolean).length;
  if (
    SECRET_PATTERN.test(compact) ||
    (HIGH_ENTROPY_TOKEN_PATTERN.test(compact) && (tokenClassCount >= 2 || HEX_TOKEN_PATTERN.test(compact)))
  ) {
    return { ok: false as const, error: `${field}_looks_like_secret` };
  }
  return { ok: true as const };
}

export type TenantProviderConnectionInput = {
  orgId: string;
  provider: string;
  credentialReference?: string;
  subscriptionReference?: string;
  historyMode: "provider_managed" | "workspace_scoped" | "none";
  note?: string;
};

export function redactTenantProviderConnection(row: {
  id: string;
  orgId: string;
  type: string;
  status: string;
  encryptedToken: unknown;
  updatedAt: Date;
}) {
  const payload = row.encryptedToken && typeof row.encryptedToken === "object" ? row.encryptedToken as Record<string, unknown> : {};
  return {
    id: row.id,
    orgId: row.orgId,
    provider: String(payload.provider || row.type.replace(/^developer_provider:/, "")),
    status: row.status,
    credentialReference: String(payload.credentialReference || ""),
    subscriptionReference: String(payload.subscriptionReference || ""),
    historyMode: String(payload.historyMode || "none"),
    note: String(payload.note || ""),
    secretStored: false,
    tenantOwnedOnly: true,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listTenantProviderConnections(orgId: string) {
  const db = requirePrisma();
  const rows = await db.connection.findMany({
    where: { orgId, type: { startsWith: "developer_provider:" } },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map(redactTenantProviderConnection);
}

export async function saveTenantProviderConnection(input: TenantProviderConnectionInput) {
  const provider = clean(input.provider, 60).toLowerCase();
  const credentialReference = clean(input.credentialReference, 180);
  const subscriptionReference = clean(input.subscriptionReference, 180);
  const note = clean(input.note, 240);
  if (!provider) return { ok: false as const, error: "provider_required" };
  for (const [field, value] of Object.entries({ provider, credentialReference, subscriptionReference, note })) {
    const secretCheck = assertNoSecret(value, field);
    if (!secretCheck.ok) return secretCheck;
  }
  const db = requirePrisma();
  const type = `developer_provider:${provider}`;
  const payload = {
    provider,
    credentialReference,
    subscriptionReference,
    historyMode: input.historyMode,
    note,
    secretStored: false,
    tenantOwnedOnly: true,
  };
  const existing = await db.connection.findFirst({ where: { orgId: input.orgId, type } });
  const row = existing
    ? await db.connection.update({
        where: { id: existing.id },
        data: { status: "reference_saved", encryptedToken: payload },
      })
    : await db.connection.create({
        data: { orgId: input.orgId, type, status: "reference_saved", encryptedToken: payload },
      });
  return { ok: true as const, connection: redactTenantProviderConnection(row) };
}
