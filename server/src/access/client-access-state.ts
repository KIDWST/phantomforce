import { z } from "zod";

import { accessRepository } from "./access-repository.js";
import {
  getLocalDemoCredentialReference,
  type ConnectorCredentialReference,
} from "../connectors/credential-boundary.js";

export const ClientAccessStatusSchema = z.enum(["active", "past_due", "revoked"]);
export const PaymentStatusSchema = z.enum(["paid", "due", "failed"]);

export type ClientAccessStatus = z.infer<typeof ClientAccessStatusSchema>;
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;

export type ClientAccessRecord = {
  id: string;
  business: string;
  owner: string;
  plan: string;
  paymentStatus: PaymentStatus;
  accessStatus: ClientAccessStatus;
  gateway: "Pangolin";
  privateRoute: string;
  modules: string[];
  connectorCredentials: Record<string, ConnectorCredentialReference>;
  lastAudit: string;
};

export type ClientAccessProvisionInput = {
  clientId: string;
  business: string;
  owner: string;
  plan: string;
  paymentStatus: PaymentStatus;
  privateRoute?: string;
  modules: string[];
  connectorCredentials?: Record<string, ConnectorCredentialReference>;
};

function normalizeModuleKey(moduleKey: string) {
  return moduleKey.trim().toLowerCase();
}

function hasCalendarModule(modules: string[]) {
  return modules.some((module) => normalizeModuleKey(module) === "calendar");
}

export function buildDefaultConnectorCredentials(
  clientId: string,
  modules: string[],
): Record<string, ConnectorCredentialReference> {
  if (!hasCalendarModule(modules)) {
    return {};
  }

  return {
    calendar: getLocalDemoCredentialReference("calendar", clientId),
  };
}

function normalizeConnectorCredentials(record: ClientAccessRecord): ClientAccessRecord {
  return {
    ...record,
    connectorCredentials: {
      ...buildDefaultConnectorCredentials(record.id, record.modules),
      ...(record.connectorCredentials ?? {}),
    },
  };
}

export const seedClientAccessRecords: ClientAccessRecord[] = [
  {
    id: "client-chicagoshots",
    business: "ChicagoShots",
    owner: "Jordan West",
    plan: "Internal partner",
    paymentStatus: "paid",
    accessStatus: "active",
    gateway: "Pangolin",
    privateRoute: "app.phantomforce.online/chicagoshots",
    modules: ["Command", "Media Lab", "Content", "Tasks", "Approvals", "Activity"],
    connectorCredentials: {},
    lastAudit: "Access confirmed for partner workspace",
  },
  {
    id: "client-sports-demo",
    business: "Sports Ops Demo",
    owner: "Client Owner",
    plan: "$2,000 Team Media Day",
    paymentStatus: "paid",
    accessStatus: "active",
    gateway: "Pangolin",
    privateRoute: "app.phantomforce.online/sports-ops-demo",
    modules: ["Command", "Media Lab", "Calendar", "Tasks", "Approvals", "Contacts"],
    connectorCredentials: buildDefaultConnectorCredentials("client-sports-demo", [
      "Command",
      "Media Lab",
      "Calendar",
      "Tasks",
      "Approvals",
      "Contacts",
    ]),
    lastAudit: "Deposit paid; workspace active",
  },
  {
    id: "client-past-due",
    business: "Past Due Pilot",
    owner: "Client Owner",
    plan: "$1,250/mo Ops Support",
    paymentStatus: "failed",
    accessStatus: "revoked",
    gateway: "Pangolin",
    privateRoute: "app.phantomforce.online/past-due-pilot",
    modules: ["Command", "Tasks", "Reports"],
    connectorCredentials: {},
    lastAudit: "Payment failed; private route revoked",
  },
];

const clientAccessRecords = new Map<string, ClientAccessRecord>(
  seedClientAccessRecords.map((record) => [record.id, record]),
);

let initialized = false;

export async function initializeClientAccessState() {
  if (initialized) return;

  const records = await accessRepository.loadClientAccessRecords(seedClientAccessRecords);
  clientAccessRecords.clear();

  for (const record of records) {
    clientAccessRecords.set(record.id, normalizeConnectorCredentials(record));
  }

  initialized = true;
}

async function persistClientAccessRecords() {
  await accessRepository.saveClientAccessRecords(listClientAccess());
}

export function listClientAccess() {
  return Array.from(clientAccessRecords.values());
}

export function getClientAccess(id: string) {
  return clientAccessRecords.get(id);
}

function slugifyRouteSegment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function deriveAccessStatusFromPayment(paymentStatus: PaymentStatus): ClientAccessStatus {
  return paymentStatus === "paid" ? "active" : "revoked";
}

export function defaultPrivateRouteForBusiness(business: string) {
  return `app.phantomforce.online/${slugifyRouteSegment(business) || "client"}`;
}

export function buildProvisionedClientAccess(
  input: ClientAccessProvisionInput,
  reason: string,
): ClientAccessRecord {
  const accessStatus = deriveAccessStatusFromPayment(input.paymentStatus);

  return {
    id: input.clientId,
    business: input.business,
    owner: input.owner,
    plan: input.plan,
    paymentStatus: input.paymentStatus,
    accessStatus,
    gateway: "Pangolin",
    privateRoute: input.privateRoute ?? defaultPrivateRouteForBusiness(input.business),
    modules: input.modules,
    connectorCredentials:
      input.connectorCredentials ?? buildDefaultConnectorCredentials(input.clientId, input.modules),
    lastAudit:
      accessStatus === "active"
        ? `Provisioned paid workspace: ${reason}`
        : `Provisioned blocked workspace pending payment: ${reason}`,
  };
}

export function provisionClientAccess(
  input: ClientAccessProvisionInput,
  reason: string,
): Promise<ClientAccessRecord> {
  const record = buildProvisionedClientAccess(input, reason);
  clientAccessRecords.set(record.id, record);

  return persistClientAccessRecords().then(() => record);
}

export function updateClientAccess(
  id: string,
  accessStatus: ClientAccessStatus,
  reason: string,
): Promise<ClientAccessRecord | undefined> {
  const existing = clientAccessRecords.get(id);

  if (!existing) {
    return Promise.resolve(undefined);
  }

  const paymentStatus: PaymentStatus =
    accessStatus === "active" ? "paid" : accessStatus === "past_due" ? "due" : "failed";
  const updated: ClientAccessRecord = {
    ...existing,
    accessStatus,
    paymentStatus,
    lastAudit:
      accessStatus === "active"
        ? `Access restored: ${reason}`
        : accessStatus === "past_due"
          ? `Marked past due: ${reason}`
          : `Access revoked: ${reason}`,
  };

  clientAccessRecords.set(id, updated);

  return persistClientAccessRecords().then(() => updated);
}

export function setClientModule(
  id: string,
  moduleKey: string,
  enabled: boolean,
  reason: string,
): Promise<ClientAccessRecord | undefined> {
  const existing = clientAccessRecords.get(id);

  if (!existing) {
    return Promise.resolve(undefined);
  }

  const normalized = normalizeModuleKey(moduleKey);
  const hasModule = existing.modules.some((module) => normalizeModuleKey(module) === normalized);
  const modules = enabled
    ? hasModule
      ? existing.modules
      : [...existing.modules, moduleKey]
    : existing.modules.filter((module) => normalizeModuleKey(module) !== normalized);
  const connectorCredentials =
    enabled && normalized === "calendar"
      ? {
          ...existing.connectorCredentials,
          ...buildDefaultConnectorCredentials(existing.id, modules),
        }
      : existing.connectorCredentials;

  const updated: ClientAccessRecord = {
    ...existing,
    modules,
    connectorCredentials,
    lastAudit: `${enabled ? "Module enabled" : "Module disabled"}: ${moduleKey} - ${reason}`,
  };

  clientAccessRecords.set(id, updated);

  return persistClientAccessRecords().then(() => updated);
}

export function getAccessDecision(id: string) {
  const record = getClientAccess(id);

  if (!record) {
    return {
      allowed: false,
      mode: "blocked",
      reason: "Unknown client access record.",
      modules: [],
    };
  }

  if (record.accessStatus === "revoked") {
    return {
      allowed: false,
      mode: "blocked",
      reason: "Client access is revoked.",
      modules: [],
    };
  }

  if (record.accessStatus === "past_due") {
    return {
      allowed: true,
      mode: "read_only",
      reason: "Client is past due; grace access is read-only.",
      modules: record.modules,
    };
  }

  return {
    allowed: true,
    mode: "full",
    reason: "Client access is active.",
    modules: record.modules,
  };
}
