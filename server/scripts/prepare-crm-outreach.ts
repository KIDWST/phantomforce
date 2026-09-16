import "../src/load-env.js";

import { prisma } from "../src/access/prisma-runtime.js";
import { prepareCrmOutreachDrafts } from "../src/crm/crm-growth-automation.js";

const orgId = process.argv.find((arg) => arg.startsWith("--org="))?.slice(6) || "phantomforce-internal";

async function main() {
  if (!prisma) throw new Error("DATABASE_URL is required to prepare CRM outreach.");
  const [settings, contacts] = await Promise.all([
    prisma.crmSettings.findUnique({
      where: { orgId },
      select: { orgId: true, dailyPullTarget: true, sourceMode: true, brain: true },
    }),
    prisma.contact.findMany({
      where: { orgId },
      orderBy: [{ dueAt: "asc" }, { fitScore: "desc" }, { updatedAt: "desc" }],
      take: 2_000,
      select: {
        id: true, orgId: true, name: true, email: true, organization: true, status: true,
        type: true, tags: true, fitScore: true, dueAt: true,
      },
    }),
  ]);
  if (!settings) throw new Error(`CRM settings for ${orgId} do not exist.`);
  if (!["daily", "public-research"].includes(settings.sourceMode)) {
    throw new Error(`CRM automation is not enabled for ${orgId}. Current source mode: ${settings.sourceMode}.`);
  }
  const result = await prepareCrmOutreachDrafts({ settings, contacts, actor: "system:phantombot-crm" });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    orgId,
    ...result,
    action: "email.draft",
    state: "awaiting_owner_approval",
    externalSendExecuted: false,
  }, null, 2)}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => prisma?.$disconnect());
