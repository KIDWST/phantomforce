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
};

type SocialConnectionStore = {
  version: 1;
  connections: Partial<Record<SocialAnalyticsPlatform, StoredConnection>>;
  pendingStates: Record<string, PendingOAuthState>;
};

const socialDataDir = () => resolve(process.env.PHANTOMFORCE_SOCIAL_DATA_DIR || process.env.PHANTOMFORCE_DATA_DIR || ".phantom");
const storePath = () => join(socialDataDir(), "social-connections.json");

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

export function getStoredSocialConnection(platform: SocialAnalyticsPlatform) {
  return readStore().connections[platform] || null;
}

export function listStoredSocialConnections() {
  return readStore().connections;
}

export function saveStoredSocialConnection(platform: SocialAnalyticsPlatform, data: Omit<StoredConnection, "platform" | "connectedAt" | "updatedAt">) {
  const store = readStore();
  const existing = store.connections[platform];
  const now = new Date().toISOString();
  store.connections[platform] = {
    ...existing,
    ...data,
    platform,
    connectedAt: existing?.connectedAt || now,
    updatedAt: now,
  };
  writeStore(store);
  return redactedConnection(store.connections[platform]);
}

export function savePendingSocialOAuthState(
  state: string,
  platform: SocialAnalyticsPlatform,
  data: { codeVerifier?: string } = {},
) {
  const store = readStore();
  store.pendingStates[state] = { platform, createdAt: new Date().toISOString(), ...data };
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

export function socialConnectionStoreStatus() {
  const connections = listStoredSocialConnections();
  return {
    path: storePath(),
    connections: Object.fromEntries(Object.entries(connections).map(([platform, connection]) => [
      platform,
      redactedConnection(connection),
    ])),
    secretsExposed: false,
  };
}
