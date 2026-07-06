import { createHash } from "node:crypto";

import { GatewayProvider } from "@prisma/client";

import {
  accessStoragePaths,
  loadAccessWorkflow,
  loadClientAccessRecords,
  saveAccessWorkflow,
  saveClientAccessRecords,
  type AccessWorkflowSnapshot,
} from "./access-storage.js";
import type { ClientAccessRecord } from "./client-access-state.js";
import {
  forceJsonRepository,
  prisma,
  prismaConfigured,
  prismaStartupTimeoutMs,
  usePrisma,
  withPrismaStartupTimeout,
} from "./prisma-runtime.js";
import type { ConnectorCredentialReference } from "../connectors/credential-boundary.js";

export type AccessRepositoryDriver = "json-file" | "prisma-postgres";

export type AccessRepositoryInfo = {
  driver: AccessRepositoryDriver;
  storage: ReturnType<typeof accessStoragePaths>;
  prismaConfigured: boolean;
  migrationTarget: "prisma-postgres";
  prismaWriteMode: "disabled" | "enabled";
  repositoryModeReason:
    | "DATABASE_URL not configured"
    | "PHANTOMFORCE_ACCESS_REPOSITORY=json-file"
    | "DATABASE_URL configured";
  failClosedOnPrismaError: boolean;
  prismaStartupTimeoutMs: number;
};

export type AccessRepository = {
  driver: AccessRepositoryDriver;
  info: () => AccessRepositoryInfo;
  loadClientAccessRecords: (fallback: ClientAccessRecord[]) => Promise<ClientAccessRecord[]>;
  saveClientAccessRecords: (records: ClientAccessRecord[]) => Promise<void>;
  loadAccessWorkflow: () => Promise<AccessWorkflowSnapshot>;
  saveAccessWorkflow: (snapshot: AccessWorkflowSnapshot) => Promise<void>;
};

function gatewayToRecord(gatewayProvider: string | null | undefined): "Pangolin" {
  return gatewayProvider === "pangolin" ? "Pangolin" : "Pangolin";
}

function gatewayToPrisma(gateway: ClientAccessRecord["gateway"]) {
  return gateway === "Pangolin" ? GatewayProvider.pangolin : GatewayProvider.pangolin;
}

function accessStatusToRecord(value: string | null | undefined): ClientAccessRecord["accessStatus"] {
  return value === "past_due" || value === "revoked" ? value : "active";
}

function paymentStatusToRecord(value: string | null | undefined): ClientAccessRecord["paymentStatus"] {
  return value === "due" || value === "failed" ? value : "paid";
}

function actionStatusToPrisma(status: string) {
  return status === "pending_approval" ? "pending" : status;
}

function stableAuditHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function connectorCredentialsToRecord(
  value: unknown,
): Record<string, ConnectorCredentialReference> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, ConnectorCredentialReference>;
}

function jsonFileInfo(): AccessRepositoryInfo {
  return {
    driver: "json-file",
    storage: accessStoragePaths(),
    prismaConfigured,
    migrationTarget: "prisma-postgres",
    prismaWriteMode: "disabled",
    repositoryModeReason: forceJsonRepository
      ? "PHANTOMFORCE_ACCESS_REPOSITORY=json-file"
      : "DATABASE_URL not configured",
    failClosedOnPrismaError: false,
    prismaStartupTimeoutMs,
  };
}

function prismaInfo(): AccessRepositoryInfo {
  return {
    driver: "prisma-postgres",
    storage: accessStoragePaths(),
    prismaConfigured,
    migrationTarget: "prisma-postgres",
    prismaWriteMode: "enabled",
    repositoryModeReason: "DATABASE_URL configured",
    failClosedOnPrismaError: true,
    prismaStartupTimeoutMs,
  };
}

const jsonFileRepository: AccessRepository = {
  driver: "json-file",
  info: jsonFileInfo,
  loadClientAccessRecords: async (fallback) => loadClientAccessRecords(fallback),
  saveClientAccessRecords: async (records) => {
    saveClientAccessRecords(records);
  },
  loadAccessWorkflow: async () => loadAccessWorkflow(),
  saveAccessWorkflow: async (snapshot) => {
    saveAccessWorkflow(snapshot);
  },
};

const prismaRepository: AccessRepository = {
  driver: "prisma-postgres",
  info: prismaInfo,
  async loadClientAccessRecords(fallback) {
    if (!prisma) return fallback;

    const organizations = await withPrismaStartupTimeout(
      prisma.org.findMany({
        where: {
          clientAccess: {
            isNot: null,
          },
        },
        include: {
          clientAccess: true,
          moduleEntitlements: {
            where: {
              enabled: true,
            },
            orderBy: {
              moduleKey: "asc",
            },
          },
        },
        orderBy: {
          name: "asc",
        },
      }),
      "loading client access records",
    );

    if (!organizations.length) {
      await this.saveClientAccessRecords(fallback);
      return fallback;
    }

    return organizations.flatMap((organization) => {
      if (!organization.clientAccess) return [];

      return {
        id: organization.id,
        business: organization.name,
        owner: organization.clientAccess.ownerName ?? "Client Owner",
        plan: organization.clientAccess.planName ?? "Unassigned plan",
        paymentStatus: paymentStatusToRecord(organization.clientAccess.paymentStatus),
        accessStatus: accessStatusToRecord(organization.clientAccess.accessStatus),
        gateway: gatewayToRecord(organization.clientAccess.gatewayProvider),
        privateRoute: organization.clientAccess.privateRoute ?? "",
        modules: organization.moduleEntitlements.map((module) => module.moduleKey),
        connectorCredentials: connectorCredentialsToRecord(
          organization.clientAccess.connectorCredentials,
        ),
        lastAudit: organization.clientAccess.lastAudit ?? "Loaded from Prisma/Postgres",
      };
    });
  },
  async saveClientAccessRecords(records) {
    if (!prisma) return;

    await prisma.$transaction(async (tx) => {
      for (const record of records) {
        await tx.org.upsert({
          where: {
            id: record.id,
          },
          create: {
            id: record.id,
            name: record.business,
          },
          update: {
            name: record.business,
          },
        });

        await tx.clientAccess.upsert({
          where: {
            orgId: record.id,
          },
          create: {
            orgId: record.id,
            gatewayProvider: gatewayToPrisma(record.gateway),
            privateRoute: record.privateRoute,
            accessStatus: record.accessStatus,
            paymentStatus: record.paymentStatus,
            planName: record.plan,
            ownerName: record.owner,
            connectorCredentials: record.connectorCredentials,
            lastAudit: record.lastAudit,
            revokedAt: record.accessStatus === "revoked" ? new Date() : null,
            revokedReason: record.accessStatus === "revoked" ? record.lastAudit : null,
          },
          update: {
            gatewayProvider: gatewayToPrisma(record.gateway),
            privateRoute: record.privateRoute,
            accessStatus: record.accessStatus,
            paymentStatus: record.paymentStatus,
            planName: record.plan,
            ownerName: record.owner,
            connectorCredentials: record.connectorCredentials,
            lastAudit: record.lastAudit,
            revokedAt: record.accessStatus === "revoked" ? new Date() : null,
            revokedReason: record.accessStatus === "revoked" ? record.lastAudit : null,
          },
        });

        await tx.moduleEntitlement.deleteMany({
          where: {
            orgId: record.id,
          },
        });

        if (record.modules.length) {
          await tx.moduleEntitlement.createMany({
            data: record.modules.map((moduleKey) => ({
              orgId: record.id,
              moduleKey,
              enabled: true,
            })),
          });
        }
      }
    });
  },
  async loadAccessWorkflow() {
    if (!prisma) {
      return {
        actions: [],
        approvals: [],
        auditEvents: [],
      };
    }

    const actions = await withPrismaStartupTimeout(
      prisma.action.findMany({
        where: {
          type: {
            in: ["client.access.update", "client.module.set", "client.provision"],
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      }),
      "loading access workflow actions",
    );
    const actionIds = actions.map((action) => action.id);
    const approvals = actionIds.length
      ? await withPrismaStartupTimeout(
          prisma.approval.findMany({
            where: {
              actionId: {
                in: actionIds,
              },
            },
            orderBy: {
              createdAt: "desc",
            },
          }),
          "loading access workflow approvals",
        )
      : [];
    const auditEvents = await withPrismaStartupTimeout(
      prisma.auditEvent.findMany({
        where: {
          targetType: "client-access-workflow",
        },
        orderBy: {
          createdAt: "desc",
        },
      }),
      "loading access workflow audit events",
    );

    return {
      actions: actions
        .map((action) => (action.payload as { accessWorkflowAction?: unknown }).accessWorkflowAction)
        .filter((action): action is AccessWorkflowSnapshot["actions"][number] => Boolean(action)),
      approvals: approvals.map((approval) => {
        const payloadApproval = (approval.payload as { accessApproval?: unknown } | null)?.accessApproval;

        if (payloadApproval) {
          return payloadApproval as AccessWorkflowSnapshot["approvals"][number];
        }

        return {
          id: approval.id,
          actionId: approval.actionId,
          clientId: approval.orgId,
          status: approval.status,
          createdAt: approval.createdAt.toISOString(),
          decidedAt: approval.decidedAt?.toISOString(),
          decidedBy: undefined,
          reason: approval.reason ?? undefined,
        };
      }),
      auditEvents: auditEvents
        .map((event) => (event.payload as { accessAuditEvent?: unknown }).accessAuditEvent)
        .filter((event): event is AccessWorkflowSnapshot["auditEvents"][number] => Boolean(event)),
    };
  },
  async saveAccessWorkflow(snapshot) {
    if (!prisma) return;

    await prisma.$transaction(async (tx) => {
      await tx.auditEvent.deleteMany({
        where: {
          targetType: "client-access-workflow",
        },
      });
      await tx.action.deleteMany({
        where: {
          type: {
            in: ["client.access.update", "client.module.set", "client.provision"],
          },
        },
      });

      const clientIds = Array.from(
        new Set([
          ...snapshot.actions.map((action) => action.clientId),
          ...snapshot.approvals.map((approval) => approval.clientId),
          ...snapshot.auditEvents.map((event) => event.clientId),
        ]),
      );

      for (const clientId of clientIds) {
        await tx.org.upsert({
          where: {
            id: clientId,
          },
          create: {
            id: clientId,
            name: clientId,
          },
          update: {},
        });
      }

      for (const action of snapshot.actions) {
        await tx.action.create({
          data: {
            id: action.id,
            orgId: action.clientId,
            type: action.type,
            payload: {
              accessWorkflowAction: action,
            },
            policy: {
              approvalRequired: true,
            },
            status: actionStatusToPrisma(action.status) as never,
            proposedBy: action.proposedBy,
            rationale: action.rationale,
            createdAt: new Date(action.createdAt),
            updatedAt: action.decidedAt ? new Date(action.decidedAt) : new Date(action.createdAt),
          },
        });
      }

      for (const approval of snapshot.approvals) {
        await tx.approval.create({
          data: {
            id: approval.id,
            orgId: approval.clientId,
            actionId: approval.actionId,
            status: approval.status,
            reason: approval.reason,
            payload: {
              accessApproval: approval,
            },
            createdAt: new Date(approval.createdAt),
            decidedAt: approval.decidedAt ? new Date(approval.decidedAt) : null,
          },
        });
      }

      for (const event of snapshot.auditEvents) {
        await tx.auditEvent.create({
          data: {
            id: event.id,
            orgId: event.clientId,
            actor: event.actor,
            eventType: event.eventType,
            targetType: "client-access-workflow",
            targetId: event.clientId,
            payload: {
              accessAuditEvent: event,
            },
            hash: stableAuditHash(event),
            createdAt: new Date(event.createdAt),
          },
        });
      }
    });
  },
};

export const accessRepository: AccessRepository = usePrisma ? prismaRepository : jsonFileRepository;
