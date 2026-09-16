import { prisma } from "../access/prisma-runtime.js";
import { proposeWorkAction } from "../workforce/work-graph.js";

export type GrowthContact = {
  id: string;
  orgId: string;
  name: string;
  email: string | null;
  organization: string | null;
  status: string;
  type: string;
  tags: string[];
  fitScore: number | null;
  dueAt: Date | null;
};

type GrowthSettings = {
  orgId: string;
  dailyPullTarget: number;
  sourceMode: string;
  brain: unknown;
};

export type OutreachDraft = {
  contactId: string;
  organization: string;
  lane: string;
  to: string;
  subject: string;
  body: string;
};

const VALID_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DISALLOWED_TAGS = new Set(["consent:denied", "do-not-contact", "unsubscribed", "email:guessed"]);
const INACTIVE_STATUSES = new Set(["lost", "client", "active-client", "archived"]);

function clean(value: unknown, fallback = "") {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : fallback;
}

function crmBrain(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function laneFor(contact: Pick<GrowthContact, "tags">) {
  return contact.tags.find((tag) => tag.startsWith("lane:"))?.slice(5) || "business";
}

function businessNameFor(settings: GrowthSettings) {
  const profile = clean(crmBrain(settings.brain).businessProfile);
  return clean(profile.split(/[—–-]/u)[0], "Your team") || "Your team";
}

function offerForLane(lane: string) {
  const offers: Record<string, string> = {
    healthcare: "conference recaps, physician and expert interviews, patient education, and social-ready video",
    "sports-fitness": "game coverage, athlete profiles, recruiting reels, and season-long social content",
    education: "program stories, enrollment campaigns, athletics coverage, and event highlight films",
    "events-hospitality": "wedding and event films, venue showcases, recap edits, and fast-turn social clips",
    "creative-partners": "overflow camera work, editing support, second-camera coverage, and white-label delivery",
    "wedding-ecosystem": "wedding films, venue and vendor showcases, fast-turn social edits, and referral-ready highlights",
    "coaches-programs": "coach profiles, program stories, testimonials, recruiting content, and recurring social video",
  };
  return offers[lane] || "brand stories, event coverage, interviews, and social-ready video";
}

export function selectDailyOutreachProspects(contacts: GrowthContact[], requestedLimit: number) {
  const limit = Math.max(1, Math.min(25, Math.floor(requestedLimit || 1)));
  return contacts
    .filter((contact) => Boolean(contact.email && VALID_EMAIL.test(contact.email)))
    .filter((contact) => contact.tags.includes("email:published-business"))
    .filter((contact) => !contact.tags.some((tag) => DISALLOWED_TAGS.has(tag.toLowerCase())))
    .filter((contact) => !INACTIVE_STATUSES.has(contact.status.toLowerCase()))
    .sort((left, right) => {
      const dueDifference = Number(left.dueAt ?? Number.MAX_SAFE_INTEGER) - Number(right.dueAt ?? Number.MAX_SAFE_INTEGER);
      if (dueDifference) return dueDifference;
      return (right.fitScore ?? 0) - (left.fitScore ?? 0);
    })
    .slice(0, limit);
}

export function buildOutreachDraft(contact: GrowthContact, settings: GrowthSettings): OutreachDraft {
  const organization = clean(contact.organization || contact.name, "Chicago business");
  const sender = businessNameFor(settings);
  const lane = laneFor(contact);
  const offer = offerForLane(lane);
  return {
    contactId: contact.id,
    organization,
    lane,
    to: String(contact.email),
    subject: `Video support for ${organization}`,
    body: [
      `Hi ${organization} team,`,
      "",
      `I'm reaching out from ${sender}. We help Chicago organizations with ${offer}.`,
      "",
      `I found ${organization} through a public Chicago-area business listing and thought our production support may be relevant. If video is on your roadmap, would a short conversation be useful?`,
      "",
      "Best,",
      sender,
    ].join("\n"),
  };
}

export async function prepareCrmOutreachDrafts(args: {
  settings: GrowthSettings;
  contacts: GrowthContact[];
  actor?: string;
  workGraphRoot?: string;
}) {
  const selected = selectDailyOutreachProspects(args.contacts, args.settings.dailyPullTarget);
  let created = 0;
  let alreadyPrepared = 0;
  for (const contact of selected) {
    const draft = buildOutreachDraft(contact, args.settings);
    const result = await proposeWorkAction({
      tenantId: args.settings.orgId,
      actor: args.actor || "system:phantombot-crm",
      idempotencyKey: `crm-outreach-introduction:${args.settings.orgId}:${contact.id}`,
      correlationId: `crm-daily-outreach:${args.settings.orgId}`,
      root: args.workGraphRoot,
      action: {
        type: "email.draft",
        proposedBy: "system",
        rationale: `PhantomBot prepared a first-touch ${draft.lane} prospect email from tenant-scoped CRM evidence. Owner review is required; nothing was sent.`,
        policy: { surface: "internal", reversible: true, requiresApproval: true },
        payload: {
          to: [draft.to],
          subject: draft.subject,
          body: draft.body,
          threadId: `crm-contact:${draft.contactId}`,
        },
      },
    });
    if (result.result.replayed) alreadyPrepared += 1;
    else created += 1;
  }
  return {
    eligible: selected.length,
    created,
    alreadyPrepared,
    sent: 0,
    providerCalled: false,
  };
}

export async function runCrmOutreachPrepForActiveOrganizations() {
  if (!prisma) {
    return { organizations: 0, eligible: 0, created: 0, alreadyPrepared: 0, sent: 0, providerCalled: false };
  }
  const settings = await prisma.crmSettings.findMany({
    where: { sourceMode: { in: ["daily", "public-research"] } },
    select: { orgId: true, dailyPullTarget: true, sourceMode: true, brain: true },
  });
  const total = { organizations: settings.length, eligible: 0, created: 0, alreadyPrepared: 0, sent: 0, providerCalled: false };
  for (const row of settings) {
    const contacts = await prisma.contact.findMany({
      where: { orgId: row.orgId },
      orderBy: [{ dueAt: "asc" }, { fitScore: "desc" }, { updatedAt: "desc" }],
      take: 2_000,
      select: {
        id: true, orgId: true, name: true, email: true, organization: true, status: true,
        type: true, tags: true, fitScore: true, dueAt: true,
      },
    });
    const result = await prepareCrmOutreachDrafts({ settings: row, contacts });
    total.eligible += result.eligible;
    total.created += result.created;
    total.alreadyPrepared += result.alreadyPrepared;
  }
  return total;
}
