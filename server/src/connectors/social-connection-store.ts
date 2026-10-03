import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";

import type { SocialAnalyticsPlatform } from "./social-analytics-connector.js";

type StoredConnection = {
  platform: SocialAnalyticsPlatform;
  provider: string;
  connectedAt: string;
  updatedAt: string;
  accountId?: string;
  accountName?: string;
  accountHandle?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
  pageId?: string;
  pageName?: string;
  businessAccountId?: string;
  scopes?: string[];
  metadata?: Record<string, string | number | boolean | null>;
};

type PendingOAuthState = {
  platform: SocialAnalyticsPlatform;
  createdAt: string;
  codeVerifier?: string;
  workspaceKey?: string;
  redirectUri?: string;
  authorizationVersion?: number;
};

export type SocialAssetPage = { id: string; name: string; accessToken: string; instagramId?: string; instagramUsername?: string };
type PendingAssetSelection = {
  platform: "facebook" | "instagram"; workspaceKey: string; authorizationVersion: number;
  expiresAt: string; pages: SocialAssetPage[]; scopes: string[]; tokenExpiresAt?: string;
};

type SocialConnectionBucket = {
  connections: Partial<Record<SocialAnalyticsPlatform, StoredConnection>>;
};

type SocialConnectionStore = {
  version: 1;
  connections: Partial<Record<SocialAnalyticsPlatform, StoredConnection>>;
  pendingStates: Record<string, PendingOAuthState>;
  workspaces?: Record<string, SocialConnectionBucket>;
  assetSelections?: Record<string, PendingAssetSelection>;
  authorizationVersions?: Record<string, Partial<Record<SocialAnalyticsPlatform, number>>>;
  activeAuthorizations?: Record<string, Partial<Record<SocialAnalyticsPlatform, { version: number; expiresAt: string }>>>;
};

const socialDataDir = () => resolve(process.env.PHANTOMFORCE_SOCIAL_DATA_DIR || process.env.PHANTOMFORCE_DATA_DIR || ".phantom");
const storePath = () => join(socialDataDir(), "social-connections.json");
export const DEFAULT_SOCIAL_WORKSPACE = "phantomforce-owner";
export function safeSocialWorkspaceKey(value: unknown) {
  const cleaned = String(value || DEFAULT_SOCIAL_WORKSPACE).trim().toLowerCase().replace(/[^a-z0-9._-]/g, "-").replace(/-+/g, "-").slice(0, 120);
  return cleaned || DEFAULT_SOCIAL_WORKSPACE;
}

const emptyStore = (): SocialConnectionStore => ({
  version: 1,
  connections: {},
  pendingStates: {},
});

function readStore(): SocialConnectionStore {
  const path = storePath();
  if (!existsSync(path)) return emptyStore();
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as SocialConnectionStore;
    return {
      version: 1,
      connections: parsed.connections || {},
      pendingStates: parsed.pendingStates || {},
      workspaces: parsed.workspaces || {},
      assetSelections: parsed.assetSelections || {},
      authorizationVersions: parsed.authorizationVersions || {},
      activeAuthorizations: parsed.activeAuthorizations || {},
    };
  } catch {
    return emptyStore();
  }
}

function writeStore(store: SocialConnectionStore) {
  for (const [id, item] of Object.entries(store.assetSelections || {})) {
    if (!Number.isFinite(Date.parse(item.expiresAt)) || Date.parse(item.expiresAt) <= Date.now()) delete store.assetSelections![id];
  }
  for (const [id, item] of Object.entries(store.pendingStates)) {
    if (!Number.isFinite(Date.parse(item.createdAt)) || Date.parse(item.createdAt) + 20 * 60_000 <= Date.now()) delete store.pendingStates[id];
  }
  const path = storePath();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, path);
}

function workspaceConnections(store: SocialConnectionStore, workspaceKey = DEFAULT_SOCIAL_WORKSPACE) {
  const key = safeSocialWorkspaceKey(workspaceKey);
  if (key === DEFAULT_SOCIAL_WORKSPACE) return store.connections;
  store.workspaces ||= {};
  store.workspaces[key] ||= { connections: {} };
  return store.workspaces[key].connections;
}

export function getStoredSocialConnection(platform: SocialAnalyticsPlatform, workspaceKey = DEFAULT_SOCIAL_WORKSPACE) {
  return workspaceConnections(readStore(), workspaceKey)[platform] || null;
}

export function listStoredSocialConnections(workspaceKey = DEFAULT_SOCIAL_WORKSPACE) {
  return workspaceConnections(readStore(), workspaceKey);
}

export function saveStoredSocialConnection(platform: SocialAnalyticsPlatform, data: Omit<StoredConnection, "platform" | "connectedAt" | "updatedAt">, workspaceKey = DEFAULT_SOCIAL_WORKSPACE) {
  const store = readStore();
  const connections = workspaceConnections(store, workspaceKey);
  const existing = connections[platform];
  const now = new Date(Math.max(Date.now(), (Date.parse(existing?.updatedAt || "") || 0) + 1)).toISOString();
  connections[platform] = {
    ...existing,
    ...data,
    platform,
    connectedAt: existing?.connectedAt || now,
    updatedAt: now,
  };
  delete store.activeAuthorizations?.[safeSocialWorkspaceKey(workspaceKey)]?.[platform];
  writeStore(store);
  return redactedConnection(connections[platform]);
}

export function savePendingSocialOAuthState(state: string, platform: SocialAnalyticsPlatform, extra: Omit<PendingOAuthState, "platform" | "createdAt"> = {}) {
  const store = readStore();
  const workspaceKey = safeSocialWorkspaceKey(extra.workspaceKey);
  const authorizationVersion = invalidateAuthorization(store, platform, workspaceKey);
  store.activeAuthorizations ||= {};
  const active = store.activeAuthorizations[workspaceKey] ||= {};
  active[platform] = { version: authorizationVersion, expiresAt: new Date(Date.now() + 20 * 60_000).toISOString() };
  store.pendingStates[state] = { platform, createdAt: new Date().toISOString(), ...extra, workspaceKey, authorizationVersion };
  writeStore(store);
}

export function consumePendingSocialOAuthState(state: string) {
  const store = readStore();
  const pending = store.pendingStates[state];
  if (!pending) return null;
  delete store.pendingStates[state];
  writeStore(store);
  const ageMs = Date.now() - Date.parse(pending.createdAt);
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs >= 20 * 60_000) return null;
  if (!isCurrentSocialAuthorization(pending.platform, safeSocialWorkspaceKey(pending.workspaceKey), pending.authorizationVersion)) return null;
  return pending;
}

function invalidateAuthorization(store: SocialConnectionStore, platform: SocialAnalyticsPlatform, workspaceKey: string) {
  store.authorizationVersions ||= {};
  const versions = store.authorizationVersions[workspaceKey] ||= {};
  const version = versions[platform] = (versions[platform] || 0) + 1;
  delete store.activeAuthorizations?.[workspaceKey]?.[platform];
  for (const [id, item] of Object.entries(store.pendingStates)) {
    if (item.platform === platform && safeSocialWorkspaceKey(item.workspaceKey) === workspaceKey) delete store.pendingStates[id];
  }
  for (const [id, item] of Object.entries(store.assetSelections || {})) {
    if (item.platform === platform && item.workspaceKey === workspaceKey) delete store.assetSelections![id];
  }
  return version;
}

export function isCurrentSocialAuthorization(platform: SocialAnalyticsPlatform, workspaceKey: string, version: number | undefined) {
  const store = readStore();
  const scope = safeSocialWorkspaceKey(workspaceKey);
  return Number.isInteger(version) && version! > 0 && store.authorizationVersions?.[scope]?.[platform] === version
    && Date.parse(store.activeAuthorizations?.[scope]?.[platform]?.expiresAt || "") > Date.now();
}

export function socialAuthorizationPending(platform: SocialAnalyticsPlatform, workspaceKey: string) {
  const store = readStore();
  const scope = safeSocialWorkspaceKey(workspaceKey);
  const active = store.activeAuthorizations?.[scope]?.[platform];
  return Boolean(active && Date.parse(active.expiresAt) > Date.now() && active.version === store.authorizationVersions?.[scope]?.[platform]);
}

export function finishSocialAuthorization(platform: SocialAnalyticsPlatform, workspaceKey: string, version: number | undefined) {
  const store = readStore();
  const scope = safeSocialWorkspaceKey(workspaceKey);
  if (store.activeAuthorizations?.[scope]?.[platform]?.version !== version) return;
  delete store.activeAuthorizations![scope]![platform];
  writeStore(store);
}

export function savePendingSocialAssetSelection(input: Omit<PendingAssetSelection, "expiresAt">) {
  const store = readStore();
  if (store.authorizationVersions?.[input.workspaceKey]?.[input.platform] !== input.authorizationVersion) throw new Error("Social authorization is no longer current.");
  const expiresAt = new Date(Math.min(Date.now() + 20 * 60_000, input.tokenExpiresAt ? Date.parse(input.tokenExpiresAt) : Infinity)).toISOString();
  const selectionId = randomUUID();
  store.assetSelections ||= {};
  store.assetSelections[selectionId] = { ...input, expiresAt };
  writeStore(store);
  return selectionMetadata(selectionId, store.assetSelections[selectionId]);
}

function selectionMetadata(selectionId: string, item: PendingAssetSelection) {
  return { platform: item.platform, selectionId, expiresAt: item.expiresAt,
    pages: item.pages.map((page) => ({ id: page.id, name: page.name, instagramUsername: page.instagramUsername || "" })) };
}

export function listPendingSocialAssetSelections(workspaceKey = DEFAULT_SOCIAL_WORKSPACE) {
  const store = readStore();
  const scope = safeSocialWorkspaceKey(workspaceKey);
  if (Object.values(store.assetSelections || {}).some((item) => !(Date.parse(item.expiresAt) > Date.now()))) writeStore(store);
  return Object.entries(store.assetSelections || {}).filter(([, item]) => item.workspaceKey === scope
    && Date.parse(item.expiresAt) > Date.now()
    && store.authorizationVersions?.[scope]?.[item.platform] === item.authorizationVersion)
    .map(([id, item]) => selectionMetadata(id, item));
}

export function consumePendingSocialAssetSelection(platform: SocialAnalyticsPlatform, selectionId: string, pageId: string, workspaceKey: string) {
  const store = readStore();
  const scope = safeSocialWorkspaceKey(workspaceKey);
  const item = store.assetSelections?.[selectionId];
  // Wrong-tenant and invalid-page attempts must not consume another selection.
  if (!item || item.platform !== platform || item.workspaceKey !== scope
    || Date.parse(item.expiresAt) <= Date.now()
    || store.authorizationVersions?.[scope]?.[platform] !== item.authorizationVersion) throw new Error("Social asset selection is unavailable or expired.");
  const page = item.pages.find((candidate) => candidate.id === pageId);
  if (!page || (platform === "instagram" && !page.instagramId)) throw new Error("Choose an eligible Page from this connection.");
  delete store.assetSelections![selectionId];
  writeStore(store);
  return { ...item, page };
}

export function disconnectStoredSocialConnection(platform: SocialAnalyticsPlatform, workspaceKey = DEFAULT_SOCIAL_WORKSPACE) {
  const store = readStore();
  const scope = safeSocialWorkspaceKey(workspaceKey);
  const connections = workspaceConnections(store, scope);
  const disconnected = Boolean(connections[platform]);
  delete connections[platform];
  invalidateAuthorization(store, platform, scope);
  writeStore(store);
  return { platform, tenant_id: scope, disconnected, providerRevoked: false };
}

export function redactedConnection(connection: StoredConnection | null | undefined) {
  if (!connection) return null;
  return {
    platform: connection.platform,
    provider: connection.provider,
    connectedAt: connection.connectedAt,
    updatedAt: connection.updatedAt,
    accountId: connection.accountId,
    accountName: connection.accountName,
    accountHandle: connection.accountHandle,
    pageId: connection.pageId,
    pageName: connection.pageName,
    businessAccountId: connection.businessAccountId,
    expiresAt: connection.expiresAt,
    scopes: connection.scopes || [],
    hasAccessToken: Boolean(connection.accessToken),
    hasRefreshToken: Boolean(connection.refreshToken),
    metadata: connection.metadata || {},
  };
}

export function socialConnectionStoreStatus(workspaceKey = DEFAULT_SOCIAL_WORKSPACE) {
  const key = safeSocialWorkspaceKey(workspaceKey);
  const connections = listStoredSocialConnections(key);
  return {
    path: storePath(),
    workspaceKey: key,
    connections: Object.fromEntries(Object.entries(connections).map(([platform, connection]) => [
      platform,
      redactedConnection(connection),
    ])),
    secretsExposed: false,
  };
}
