import "../src/load-env.js";

import { prisma } from "../src/access/prisma-runtime.js";

const orgId = process.argv.find((arg) => arg.startsWith("--org="))?.slice(6) || "phantomforce-internal";

async function main() {
  if (!prisma) throw new Error("DATABASE_URL is required to configure CRM autopilot.");
  const current = await prisma.crmSettings.findUnique({ where: { orgId } });
  if (!current) throw new Error(`CRM settings for ${orgId} do not exist.`);
  const brain = current.brain && typeof current.brain === "object" && !Array.isArray(current.brain)
    ? current.brain as Record<string, unknown>
    : {};
  const previous = brain.autopilot && typeof brain.autopilot === "object" && !Array.isArray(brain.autopilot)
    ? brain.autopilot as Record<string, unknown>
    : {};
  const autopilot = {
    ...previous,
    enabled: true,
    mode: "exceptions-only",
    standingApproval: true,
    automaticInitialOutreach: true,
    automaticFollowUps: true,
    automaticReplies: false,
    dailySendLimit: 10,
    followUpAfterDays: 5,
    maxFollowUps: 1,
    permissionMode: "public-business",
    senderName: "Jordan West",
    senderBusiness: "ChicagoShots",
    senderWebsite: "https://chicagoshots.com",
    senderPostalAddress: typeof previous.senderPostalAddress === "string" ? previous.senderPostalAddress : "",
    authorizationSource: "explicit-owner-request",
    authorizedAt: new Date().toISOString(),
  };
  await prisma.crmSettings.update({
    where: { orgId },
    data: { brain: { ...brain, kind: "phantomforce_org_crm_brain", version: 3, autopilot } },
  });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    orgId,
    mode: autopilot.mode,
    standingApproval: true,
    dailySendLimit: autopilot.dailySendLimit,
    automaticFollowUps: true,
    automaticReplies: false,
    postalAddressConfigured: Boolean(autopilot.senderPostalAddress),
    outboundExecuted: false,
  }, null, 2)}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => prisma?.$disconnect());
