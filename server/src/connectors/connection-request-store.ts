import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const CUSTOMER_CONNECTOR_IDS = [
  "finance-bank",
  "finance-card",
  "payments-stripe",
  "calendar-google",
  "calendar-outlook",
  "calendar-calendly",
  "calendar-icloud",
  "email-gmail",
  "email-outlook",
  "email-proton",
  "email-other",
  "crm-hubspot",
  "code-github",
  "code-gitlab",
  "code-bitbucket",
  "social-youtube",
  "social-instagram",
  "social-facebook",
  "social-tiktok",
  "social-x",
  "social-linkedin",
  "social-pinterest",
] as const;

export type CustomerConnectorId = typeof CUSTOMER_CONNECTOR_IDS[number];

export type CustomerConnectionRequest = {
  id: string;
  tenantId: string;
  connectorId: CustomerConnectorId;
  state: "requested" | "available" | "completed" | "cancelled";
  requestedAt: string;
  updatedAt: string;
  requestedBy: string;
  attempts: number;
};

type Store = { version: 1; requests: CustomerConnectionRequest[] };

const requestPath = () => process.env.PHANTOMFORCE_CONNECTION_REQUESTS_PATH
  ? resolve(process.env.PHANTOMFORCE_CONNECTION_REQUESTS_PATH)
  : resolve(process.env.PHANTOMFORCE_DATA_DIR || "server/.local", "connection-requests.json");

function clean(value: unknown, max = 120) {
  return String(value || "").trim().replace(/[^a-zA-Z0-9_.:@-]+/g, "-").slice(0, max) || "unknown";
}

function readStore(): Store {
  const path = requestPath();
  if (!existsSync(path)) return { version: 1, requests: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Store;
    return { version: 1, requests: Array.isArray(parsed.requests) ? parsed.requests.slice(-2_000) : [] };
  } catch {
    return { version: 1, requests: [] };
  }
}

function writeStore(store: Store) {
  const path = requestPath();
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ version: 1, requests: store.requests.slice(-2_000) }, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
}

export function requestCustomerConnection(options: { tenantId: string; connectorId: CustomerConnectorId; actor: string }) {
  const store = readStore();
  const tenantId = clean(options.tenantId, 80);
  const actor = clean(options.actor, 120);
  const now = new Date().toISOString();
  const existing = [...store.requests].reverse().find((item) =>
    item.tenantId === tenantId && item.connectorId === options.connectorId && item.state === "requested");
  if (existing) {
    existing.attempts = Math.min(1_000, Number(existing.attempts || 1) + 1);
    existing.updatedAt = now;
    existing.requestedBy = actor;
    writeStore(store);
    return structuredClone(existing);
  }
  const request: CustomerConnectionRequest = {
    id: randomUUID(),
    tenantId,
    connectorId: options.connectorId,
    state: "requested",
    requestedAt: now,
    updatedAt: now,
    requestedBy: actor,
    attempts: 1,
  };
  store.requests.push(request);
  writeStore(store);
  return structuredClone(request);
}

export function listCustomerConnectionRequests(tenantId: string) {
  const safeTenant = clean(tenantId, 80);
  return readStore().requests
    .filter((item) => item.tenantId === safeTenant)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((item) => structuredClone(item));
}

export function latestCustomerConnectionRequest(tenantId: string, connectorId: CustomerConnectorId) {
  return listCustomerConnectionRequests(tenantId).find((item) => item.connectorId === connectorId) || null;
}

export function connectionRequestStoreStatus() {
  const store = readStore();
  return {
    version: store.version,
    requestCount: store.requests.length,
    tenantCount: new Set(store.requests.map((item) => item.tenantId)).size,
    secretsStored: false,
  };
}
