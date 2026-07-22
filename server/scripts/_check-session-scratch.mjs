import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const user = await prisma.user.findUnique({ where: { email: "phantomforcesupport@gmail.com" }, include: { memberships: true } });
console.log("user:", JSON.stringify({ id: user.id, email: user.email, isSuperAdmin: user.isSuperAdmin, activeOrgId: user.activeOrgId, memberships: user.memberships }, null, 2));
const sessions = await prisma.authSession.findMany({ where: { userId: user.id }, orderBy: { expiresAt: "desc" }, take: 5 });
console.log("recent sessions:", JSON.stringify(sessions.map(s => ({ id: s.id, expiresAt: s.expiresAt, revokedAt: s.revokedAt, createdAt: s.createdAt })), null, 2));
await prisma.$disconnect();
