import type { MembershipRole } from "@prisma/client";

import { seedClientAccessRecords } from "./client-access-state.js";
import { getAccessAuthConfiguration, setAccessSessions, type AccessSession } from "./session.js";
import { prisma, withPrismaStartupTimeout } from "./prisma-runtime.js";

const defaultAdminEmail = "jordan@phantomforce.local";

function configuredAdminEmails() {
  const raw = process.env.PHANTOMFORCE_ADMIN_EMAILS ?? defaultAdminEmail;
  return new Set(
    raw
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

function devIdentitySeeds() {
  return [
    {
      userId: "db-user-admin-jordan",
      email: defaultAdminEmail,
      name: "Jordan / PhantomForce Admin",
      orgId: "client-chicagoshots",
      role: "owner" as MembershipRole,
    },
    {
      userId: "db-user-client-chicagoshots",
      email: "client@chicagoshots.local",
      name: "ChicagoShots Client",
      orgId: "client-chicagoshots",
      role: "member" as MembershipRole,
    },
    {
      userId: "db-user-client-sports-demo",
      email: "owner@test-client.local",
      name: "Test Client Owner",
      orgId: "client-sports-demo",
      role: "member" as MembershipRole,
    },
    {
      userId: "db-user-client-past-due",
      email: "owner@the-force.local",
      name: "The Force Owner",
      orgId: "client-past-due",
      role: "member" as MembershipRole,
    },
  ];
}

function sessionIdFor(email: string, orgId: string, adminEmails: Set<string>) {
  return adminEmails.has(email.toLowerCase()) ? "db-admin-jordan" : `db-${orgId}`;
}

export async function initializeAccessIdentityState() {
  const authConfiguration = getAccessAuthConfiguration();

  if (!authConfiguration.prismaDevAuthEnabled) {
    return;
  }

  if (!prisma) {
    throw new Error("PHANTOMFORCE_AUTH_PROVIDER=prisma-dev requires DATABASE_URL and Prisma repository mode.");
  }

  const adminEmails = configuredAdminEmails();

  await withPrismaStartupTimeout(
    prisma.$transaction(async (tx) => {
      for (const record of seedClientAccessRecords) {
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
      }

      for (const identity of devIdentitySeeds()) {
        await tx.user.upsert({
          where: {
            email: identity.email,
          },
          create: {
            id: identity.userId,
            email: identity.email,
            name: identity.name,
          },
          update: {
            name: identity.name,
          },
        });

        await tx.membership.upsert({
          where: {
            userId_orgId: {
              userId: identity.userId,
              orgId: identity.orgId,
            },
          },
          create: {
            userId: identity.userId,
            orgId: identity.orgId,
            role: identity.role,
          },
          update: {
            role: identity.role,
          },
        });
      }
    }),
    "seeding Prisma dev auth identities",
  );

  const memberships = await withPrismaStartupTimeout(
    prisma.membership.findMany({
      include: {
        user: true,
        org: true,
      },
      orderBy: [
        {
          orgId: "asc",
        },
        {
          userId: "asc",
        },
      ],
    }),
    "loading Prisma dev auth sessions",
  );

  const sessions: AccessSession[] = memberships.map((membership) => {
    const email = membership.user.email.toLowerCase();
    const canManageAccess = adminEmails.has(email);

    return {
      id: sessionIdFor(email, membership.orgId, adminEmails),
      label: `${membership.user.name ?? membership.user.email} / ${membership.org.name}`,
      role: canManageAccess ? "admin" : "client",
      clientId: canManageAccess ? undefined : membership.orgId,
      canManageAccess,
      secondFactorPolicy: canManageAccess ? "required" : "optional",
    };
  });

  setAccessSessions(sessions);
}
