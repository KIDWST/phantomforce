/* One-off operational fix, not a test: the production database has no
   bootstrap path that ever sets User.isSuperAdmin=true (the dev seed in
   user-accounts.ts explicitly skips itself when NODE_ENV=production —
   "production onboarding happens via real invitations"). Without that flag,
   AccessSession.canManageAccess is false for the real owner login, which
   silently hides every canManageAccess-gated feature: PhantomPlay Dev Mode
   (phantomplay.ts requires session.canManageAccess === true, no exceptions),
   and effectively game submissions too (submissionLimit is computed from
   canManageAccess/org entitlements, not from orgRole).

   Usage: tsx scripts/grant-owner-super-admin.ts <email> */
import "../src/load-env.js";
import { prisma } from "../src/access/prisma-runtime.js";

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    console.error("Usage: tsx scripts/grant-owner-super-admin.ts <email>");
    process.exit(1);
  }
  if (!prisma) {
    console.error("DATABASE_URL is not configured for this process (PrismaClient unavailable).");
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true, name: true, isSuperAdmin: true } });
  if (!user) {
    console.error(`No user found with email ${email}. Nothing changed.`);
    process.exit(1);
  }

  console.log(`Found user ${user.email} (id ${user.id}, name ${user.name ?? "—"}). isSuperAdmin currently: ${user.isSuperAdmin}`);

  if (user.isSuperAdmin) {
    console.log("Already isSuperAdmin=true. No change needed.");
    process.exit(0);
  }

  const updated = await prisma.user.update({ where: { id: user.id }, data: { isSuperAdmin: true }, select: { email: true, isSuperAdmin: true } });
  console.log(`Updated: ${updated.email} isSuperAdmin is now ${updated.isSuperAdmin}.`);
}

main()
  .catch((error) => {
    console.error("Failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (prisma) await prisma.$disconnect();
  });
