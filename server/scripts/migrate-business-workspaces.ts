/**
 * Additive organization bootstrap. Dry-run is entirely offline and is the default.
 * Apply requires an explicitly identified existing super-admin owner; existing
 * orgs, memberships, customer rows, credentials and storage are never renamed or copied.
 */
import { businessProfiles } from "../src/business-workspaces/business-scope.js";

const args = process.argv.slice(2);
const value = (flag: string) => args[args.indexOf(flag) + 1];
const apply = args.includes("--apply");
const ownerUserId = args.includes("--owner-user-id") ? value("--owner-user-id") : undefined;
const selectedTenants = args.flatMap((arg, index) => arg === "--tenant-id" ? [args[index + 1]] : []);
if (selectedTenants.some((tenant) => !tenant || tenant.startsWith("--"))) throw new Error("Every --tenant-id requires an exact configured tenant ID.");
const profiles = businessProfiles().filter((profile) => !selectedTenants.length || selectedTenants.includes(profile.tenantId));
if (selectedTenants.some((tenant) => !profiles.some((profile) => profile.tenantId === tenant))) throw new Error("Selected tenant is not explicitly configured.");
const plan = profiles.map((profile) => ({
  tenantId: profile.tenantId, businessId: profile.id, name: profile.name,
  action: "Create only if absent; grant the explicitly selected owner membership only if absent.",
}));
if (!apply) {
  console.log(JSON.stringify({ mode: "dry-run", databaseContacted: false, plan,
    existingRecords: "Preserved in place. No reassignment, merging, credential copying or filesystem moves.",
    requiredForApply: ["Explicit deployment approval", "DATABASE_URL for the intended database", "--apply --owner-user-id <verified-super-admin-id>"],
    mapping: "PHANTOMFORCE_BUSINESS_WORKSPACES may bind business profile IDs to known existing organization IDs. Never infer an ID from a business name." }, null, 2));
} else {
  if (!ownerUserId || ownerUserId.startsWith("--")) throw new Error("An explicit --owner-user-id is required.");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must identify the intended database; this script never loads dotenv.");
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  try {
    await db.$transaction(async (tx) => {
      const owner = await tx.user.findUnique({ where: { id: ownerUserId }, select: { id: true, isSuperAdmin: true } });
      if (!owner?.isSuperAdmin) throw new Error("The selected owner must be an existing platform super-admin.");
      for (const profile of profiles) {
        const org = await tx.org.findUnique({ where: { id: profile.tenantId }, select: { id: true } });
        if (!org) await tx.org.create({ data: { id: profile.tenantId, name: profile.name } });
        const membership = await tx.membership.findUnique({ where: { userId_orgId: { userId: owner.id, orgId: profile.tenantId } } });
        if (!membership) await tx.membership.create({ data: { userId: owner.id, orgId: profile.tenantId, role: "owner" } });
      }
    });
    console.log(JSON.stringify({ mode: "apply", additiveBootstrapCompleted: true, tenants: profiles.map((profile) => profile.tenantId),
      dataReassigned: false, credentialsCopied: false, existingRolesChanged: false }));
  } finally { await db.$disconnect(); }
}
