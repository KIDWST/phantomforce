import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PRODUCT_IDS } from "@phantomforce/phantomstore-ai-products/catalog";
import {
  AiProductsPlatform,
  JsonFileAdapter,
  PlatformError,
  type AiProductsSession,
} from "@phantomforce/phantomstore-ai-products/platform";

import type { AccessSession } from "../access/session.js";
import { getPhantomStoreWorkspaceProductAccessMap } from "./phantomstore.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../../..");
const integratedStorePath = process.env.PHANTOMFORCE_PHANTOMSTORE_AI_PRODUCTS_PATH
  || resolve(repoRoot, ".phantom", "phantomstore-ai-products.json");

let platformPromise: Promise<AiProductsPlatform> | null = null;

function stableScopedId(prefix: string, value: unknown) {
  const digest = createHash("sha256").update(String(value || prefix)).digest("hex").slice(0, 24);
  return `${prefix}-${digest}`;
}

function roleFor(session: AccessSession): AiProductsSession["role"] {
  const orgRole = String(session.orgRole || "").toLowerCase();
  return session.canManageAccess || session.isSuperAdmin || ["owner", "admin"].includes(orgRole) ? "owner" : "reviewer";
}

function mappedSession(session: AccessSession): AiProductsSession {
  const rawWorkspace = session.orgId || session.clientId || session.id;
  const rawActor = session.userId || session.id;
  return {
    workspaceId: stableScopedId("store-ws", rawWorkspace),
    actorId: stableScopedId("store-actor", rawActor),
    subjectId: stableScopedId("store-subject", rawActor),
    role: roleFor(session),
    displayName: String(session.label || "PhantomStore member").slice(0, 120),
    authenticationStrength: "phantomforce_access_session",
    sessionExpiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
    capabilities: ["phantomstore.ai-products.read", "phantomstore.ai-products.review"],
  };
}

async function integratedPlatform() {
  if (!platformPromise) {
    platformPromise = new AiProductsPlatform({ adapter: new JsonFileAdapter(integratedStorePath) }).init();
  }
  return platformPromise;
}

async function ensureWorkspace(session: AccessSession) {
  const platform = await integratedPlatform();
  const identity = mappedSession(session);
  const access = await getPhantomStoreWorkspaceProductAccessMap(session);
  await platform.mutate((document) => {
    const timestamp = new Date().toISOString();
    const entitlements = Object.fromEntries(PRODUCT_IDS.map((id) => {
      const paid = access[id];
      return [id, paid?.active
        ? { status: "active", plan: "phantomstore_paid_account", purchaseProductId: paid.productId, grantedAt: paid.entitlement?.grantedAt || timestamp }
        : { status: "expired", plan: "purchase_required", purchaseProductId: paid?.productId || null, grantedAt: null }];
    }));
    const flags = Object.fromEntries(PRODUCT_IDS.map((id) => [id, {
      enabled: Boolean(access[id]?.active),
      analysisEnabled: Boolean(access[id]?.active),
      jobsEnabled: Boolean(access[id]?.active),
      expensiveOperationsEnabled: Boolean(access[id]?.active),
      externalProvidersEnabled: false,
      rollout: "paid_account_release",
      analysisPath: "deterministic-domain-v1",
    }]));
    const consent = Object.fromEntries(PRODUCT_IDS.map((id) => [id, { status: "not_requested", updatedAt: timestamp }]));
    const workspace = document.workspaces[identity.workspaceId] || {
      id: identity.workspaceId,
      name: `${identity.displayName} workspace`,
      members: {},
      entitlements,
      flags,
      consent,
      planLimits: { artifactsPerProduct: 500, analysesPerProduct: 1000, concurrentJobs: 5 },
    };
    workspace.members[identity.actorId] = identity.role;
    workspace.entitlements = entitlements;
    workspace.flags = { ...(workspace.flags || {}), ...flags };
    workspace.consent = { ...consent, ...(workspace.consent || {}) };
    document.workspaces[identity.workspaceId] = workspace;
    return true;
  });
  return { platform, identity };
}

function integratedSnapshot(snapshot: Record<string, any>) {
  return {
    ...snapshot,
    deployment: "served_phantomstore_paid_account_release",
    products: (snapshot.products || []).map((product: Record<string, any>) => ({
      ...product,
      store: {
        ...(product.store || {}),
        state: "paid_account_product",
        route: `/app/index.html#phantomstore/${product.id}`,
        commerceActive: true,
      },
    })),
    diagnostics: {
      ...(snapshot.diagnostics || {}),
      deployment: "served_phantomstore_paid_account_release",
      externalModelsActive: false,
      externalSpendUsd: 0,
    },
  };
}

export async function getIntegratedAiProductsSnapshot(session: AccessSession) {
  const { platform, identity } = await ensureWorkspace(session);
  return integratedSnapshot(platform.snapshot(identity));
}

export async function setIntegratedAiProductConsent(session: AccessSession, productId: string, input: Record<string, unknown>) {
  const { platform, identity } = await ensureWorkspace(session);
  return platform.setConsent(identity, productId, input);
}

export async function createIntegratedAiProductArtifact(session: AccessSession, productId: string, input: Record<string, unknown>, idempotencyKey: string) {
  const { platform, identity } = await ensureWorkspace(session);
  return platform.createArtifact(identity, productId, input, idempotencyKey);
}

export async function updateIntegratedAiProductArtifact(session: AccessSession, artifactId: string, input: Record<string, unknown>, idempotencyKey: string) {
  const { platform, identity } = await ensureWorkspace(session);
  return platform.updateArtifact(identity, artifactId, input, idempotencyKey);
}

export async function runIntegratedAiProductAnalysis(session: AccessSession, artifactId: string, input: Record<string, unknown>, idempotencyKey: string) {
  const { platform, identity } = await ensureWorkspace(session);
  return platform.runAnalysis(identity, artifactId, input, idempotencyKey);
}

export async function reviewIntegratedAiProductAnalysis(session: AccessSession, analysisId: string, input: Record<string, unknown>, idempotencyKey: string) {
  const { platform, identity } = await ensureWorkspace(session);
  return platform.reviewAnalysis(identity, analysisId, input, idempotencyKey);
}

export async function archiveIntegratedAiProductArtifact(session: AccessSession, artifactId: string, restore = false) {
  const { platform, identity } = await ensureWorkspace(session);
  return platform.archiveArtifact(identity, artifactId, restore);
}

export async function deleteIntegratedAiProductArtifact(session: AccessSession, artifactId: string, confirmation: string) {
  const { platform, identity } = await ensureWorkspace(session);
  return platform.deleteArtifact(identity, artifactId, confirmation);
}

export async function exportIntegratedAiProductArtifact(session: AccessSession, artifactId: string) {
  const { platform, identity } = await ensureWorkspace(session);
  return platform.exportArtifact(identity, artifactId);
}

export function integratedAiProductError(error: unknown) {
  if (error instanceof PlatformError) {
    return { status: error.status, body: { ok: false, error: { code: error.code, message: error.message, ...error.details } } };
  }
  return {
    status: 500,
    body: { ok: false, error: { code: "AI_PRODUCT_INTERNAL_ERROR", message: "The PhantomStore AI workspace could not complete that request." } },
  };
}
