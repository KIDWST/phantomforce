import "../src/load-env.js";

import { prisma } from "../src/access/prisma-runtime.js";

const orgId = process.argv.find((arg) => arg.startsWith("--org="))?.slice(6) || "phantomforce-internal";

async function main() {
  if (!prisma) throw new Error("DATABASE_URL is required for the CRM audit.");
  const [org, settings, contacts] = await Promise.all([
    prisma.org.findUnique({ where: { id: orgId }, select: { id: true, name: true } }),
    prisma.crmSettings.findUnique({ where: { orgId }, select: { dailyPullTarget: true, sourceMode: true, notes: true, brain: true } }),
    prisma.contact.findMany({
      where: { orgId },
      select: { email: true, phone: true, website: true, status: true, type: true, tags: true, dueAt: true, source: true },
    }),
  ]);
  if (!org) throw new Error(`Organization ${orgId} does not exist.`);
  const laneCounts = new Map<string, number>();
  for (const contact of contacts) {
    const lane = contact.tags.find((tag) => tag.startsWith("lane:"))?.slice(5) || "general";
    laneCounts.set(lane, (laneCounts.get(lane) || 0) + 1);
  }
  const eligible = contacts.filter((contact) =>
    Boolean(contact.email)
    && contact.tags.includes("email:published-business")
    && !contact.tags.some((tag) => ["consent:denied", "do-not-contact", "unsubscribed", "email:guessed"].includes(tag.toLowerCase()))
    && !["client", "active-client", "lost", "archived"].includes(contact.status.toLowerCase()),
  ).length;
  const brain = settings?.brain && typeof settings.brain === "object" && !Array.isArray(settings.brain)
    ? settings.brain as Record<string, unknown>
    : {};
  process.stdout.write(`${JSON.stringify({
    ok: true,
    org: { id: org.id, name: org.name },
    crm: {
      contacts: contacts.length,
      prospects: contacts.filter((contact) => contact.type === "business-prospect").length,
      publishedBusinessEmails: contacts.filter((contact) => Boolean(contact.email) && contact.tags.includes("email:published-business")).length,
      eligibleForDraftReview: eligible,
      publicWebsites: contacts.filter((contact) => Boolean(contact.website)).length,
      publicPhones: contacts.filter((contact) => Boolean(contact.phone)).length,
      consentReviewRequired: contacts.filter((contact) => contact.tags.includes("consent:unknown")).length,
      dueNow: contacts.filter((contact) => Boolean(contact.dueAt) && Number(contact.dueAt) <= Date.now()).length,
      byLane: Object.fromEntries([...laneCounts.entries()].sort((left, right) => right[1] - left[1])),
    },
    automation: {
      sourceMode: settings?.sourceMode || "not-configured",
      dailyDraftTarget: settings?.dailyPullTarget || 0,
      phantomBotBusinessProfile: typeof brain.businessProfile === "string" ? brain.businessProfile : "not-configured",
      sendsRequireApproval: true,
      automaticSendingEnabled: false,
    },
    piiPrinted: false,
  }, null, 2)}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => prisma?.$disconnect());
