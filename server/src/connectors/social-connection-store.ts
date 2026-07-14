import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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
};

type SocialConnectionBucket = {
  connections: Partial<Record<SocialAnalyticsPlatform, StoredConnection>>;
};

type SocialConnectionStore = {
  version: 1;
  connections: Partial<Record<SocialAnalyticsPlatform, StoredConnection>>;
  pendingStates: Record<string, PendingOAuthState>;
  workspaces?: Record<string, SocialConnectionBucket>;
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
    };
  } catch {
    return emptyStore();
  }
}

function writeStore(store: SocialConnectionStore) {
  const path = storePath();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, "utf8");
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
  const now = new Date().toISOString();
  connections[platform] = {
    ...existing,
    ...data,
    platform,
    connectedAt: existing?.connectedAt || now,
    updatedAt: now,
  };
  writeStore(store);
  return redactedConnection(connections[platform]);
}

export function savePendingSocialOAuthState(state: string, platform: SocialAnalyticsPlatform, extra: Omit<PendingOAuthState, "platform" | "createdAt"> = {}) {
  const store = readStore();
  store.pendingStates[state] = { platform, createdAt: new Date().toISOString(), ...extra, workspaceKey: safeSocialWorkspaceKey(extra.workspaceKey) };
  writeStore(store);
}

export function consumePendingSocialOAuthState(state: string) {
  const store = readStore();
  const pending = store.pendingStates[state];
  if (!pending) return null;
  delete store.pendingStates[state];
  writeStore(store);
  const ageMs = Date.now() - Date.parse(pending.createdAt);
  if (!Number.isFinite(ageMs) || ageMs > 20 * 60_000) return null;
  return pending;
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
