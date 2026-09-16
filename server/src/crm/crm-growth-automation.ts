import { prisma } from "../access/prisma-runtime.js";
import { recordOrgAuditEvent } from "../access/user-accounts.js";
import { getEmailDeliveryConnectorStatus } from "../connectors/email-delivery-connector.js";
import { decideWorkAction, getWorkGraphDocument, proposeWorkAction } from "../workforce/work-graph.js";

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
  lastTouchAt?: Date | null;
  nextStep?: string | null;
};

export type GrowthSettings = {
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

export type CrmAutopilotPolicy = {
  enabled: boolean;
  mode: "exceptions-only";
  standingApproval: boolean;
  automaticInitialOutreach: boolean;
  automaticFollowUps: boolean;
  automaticReplies: false;
  dailySendLimit: number;
  followUpAfterDays: number;
  maxFollowUps: number;
  permissionMode: "public-business" | "opt-in-only";
  senderName: string;
  senderBusiness: string;
  senderWebsite: string;
  senderPostalAddress: string;
};

const DEFAULT_AUTOPILOT_POLICY: CrmAutopilotPolicy = {
  enabled: false,
  mode: "exceptions-only",
  standingApproval: false,
  automaticInitialOutreach: false,
  automaticFollowUps: false,
  automaticReplies: false,
  dailySendLimit: 10,
  followUpAfterDays: 5,
  maxFollowUps: 1,
  permissionMode: "opt-in-only",
  senderName: "",
  senderBusiness: "",
  senderWebsite: "",
  senderPostalAddress: "",
};

function clean(value: unknown, fallback = "") {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : fallback;
}

function crmBrain(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function crmAutopilotPolicy(settings: Pick<GrowthSettings, "brain">): CrmAutopilotPolicy {
  const raw = crmBrain(crmBrain(settings.brain).autopilot);
  return {
    enabled: raw.enabled === true,
    mode: "exceptions-only",
    standingApproval: raw.standingApproval === true,
    automaticInitialOutreach: raw.automaticInitialOutreach === true,
    automaticFollowUps: raw.automaticFollowUps === true,
    automaticReplies: false,
    dailySendLimit: Math.max(1, Math.min(25, Math.floor(Number(raw.dailySendLimit) || DEFAULT_AUTOPILOT_POLICY.dailySendLimit))),
    followUpAfterDays: Math.max(2, Math.min(30, Math.floor(Number(raw.followUpAfterDays) || DEFAULT_AUTOPILOT_POLICY.followUpAfterDays))),
    maxFollowUps: Math.max(0, Math.min(2, Math.floor(Number(raw.maxFollowUps) || DEFAULT_AUTOPILOT_POLICY.maxFollowUps))),
    permissionMode: raw.permissionMode === "public-business" ? "public-business" : "opt-in-only",
    senderName: clean(raw.senderName),
    senderBusiness: clean(raw.senderBusiness),
    senderWebsite: clean(raw.senderWebsite),
    senderPostalAddress: clean(raw.senderPostalAddress),
  };
}

function contactPermissionReady(contact: GrowthContact, policy: CrmAutopilotPolicy) {
  if (contact.tags.some((tag) => DISALLOWED_TAGS.has(tag.toLowerCase()))) return false;
  if (policy.permissionMode === "opt-in-only") return contact.tags.includes("consent:opt-in");
  return contact.tags.includes("email:published-business");
}

function complianceFooter(policy: CrmAutopilotPolicy) {
  return [
    "",
    "—",
    `This is a business introduction from ${policy.senderBusiness}.`,
    policy.senderPostalAddress,
    `To stop receiving marketing email from ${policy.senderBusiness}, reply “unsubscribe”.`,
    policy.senderWebsite,
  ].filter(Boolean).join("\n");
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

export function selectAutomaticOutreachProspects(contacts: GrowthContact[], policy: CrmAutopilotPolicy, requestedLimit: number) {
  const limit = Math.max(1, Math.min(policy.dailySendLimit, Math.floor(requestedLimit || 1)));
  return selectDailyOutreachProspects(contacts, Math.max(limit, 25))
    .filter((contact) => contactPermissionReady(contact, policy))
    .filter((contact) => !contact.tags.some((tag) => tag.startsWith("outreach:submitted") || tag.startsWith("outreach:replied") || tag.startsWith("outreach:bounced")))
    .slice(0, limit);
}

function buildFollowUpDraft(contact: GrowthContact, settings: GrowthSettings, policy: CrmAutopilotPolicy) {
  const organization = clean(contact.organization || contact.name, "your team");
  const sender = policy.senderName || businessNameFor(settings);
  return {
    subject: `Following up — video support for ${organization}`,
    body: [
      `Hi ${organization} team,`,
      "",
      `Following up on my note about video production support from ${policy.senderBusiness || businessNameFor(settings)}. If this is relevant, I can send a concise option based on your upcoming events or content calendar.`,
      "",
      "If someone else handles video or marketing, feel free to point me in the right direction.",
      "",
      "Best,",
      sender,
      complianceFooter(policy),
    ].join("\n"),
  };
}

function autopilotBlockers(policy: CrmAutopilotPolicy) {
  const connector = getEmailDeliveryConnectorStatus();
  const blockers: string[] = [];
  if (!policy.enabled) blockers.push("Autopilot is disabled for this account.");
  if (!policy.standingApproval) blockers.push("Standing owner approval is not recorded.");
  if (!policy.senderName || !policy.senderBusiness || !policy.senderWebsite) blockers.push("Sender identity is incomplete.");
  if (!policy.senderPostalAddress) blockers.push("A valid physical postal address is required before commercial email can run.");
  if (!connector.sendReady) blockers.push("A verified Gmail or Outlook sending executor is not connected.");
  if (!connector.trackingReady || !connector.replySyncReady) blockers.push("Signed delivery and reply webhooks are not connected.");
  return { connector, blockers };
}

export async function getCrmAutopilotStatus(args: {
  settings: GrowthSettings;
  contacts: GrowthContact[];
  workGraphRoot?: string;
}) {
  const policy = crmAutopilotPolicy(args.settings);
  const { connector, blockers } = autopilotBlockers(policy);
  const graph = await getWorkGraphDocument(args.settings.orgId, "system:crm-autopilot-status", args.workGraphRoot);
  const sends = graph.actions.filter((action) => action.type === "email.send" && action.idempotencyKey.startsWith("crm-autopilot:"));
  const receipts = sends.map((action) => action.receipt?.providerReceipt).filter(Boolean);
  const dueNow = args.contacts.filter((contact) => Boolean(contact.dueAt) && Number(contact.dueAt) <= Date.now() && !INACTIVE_STATUSES.has(contact.status.toLowerCase()));
  const eligible = selectAutomaticOutreachProspects(args.contacts, policy, policy.dailySendLimit);
  return {
    state: blockers.length ? "setup-required" as const : "running" as const,
    mode: policy.mode,
    policy: {
      enabled: policy.enabled,
      standingApproval: policy.standingApproval,
      automaticInitialOutreach: policy.automaticInitialOutreach,
      automaticFollowUps: policy.automaticFollowUps,
      automaticReplies: false,
      dailySendLimit: policy.dailySendLimit,
      followUpAfterDays: policy.followUpAfterDays,
      maxFollowUps: policy.maxFollowUps,
      permissionMode: policy.permissionMode,
    },
    outcomes: {
      sent: receipts.length,
      delivered: receipts.filter((receipt) => receipt?.deliveryStatus === "delivered").length,
      replied: receipts.filter((receipt) => receipt?.deliveryStatus === "replied").length,
      bounced: receipts.filter((receipt) => receipt?.deliveryStatus === "bounced").length,
      followUpNeeded: dueNow.length,
      eligibleNow: eligible.length,
    },
    connector: { sendReady: connector.sendReady, trackingReady: connector.trackingReady, replySyncReady: connector.replySyncReady },
    blockers,
    ownerAttentionRequired: blockers.length > 0 || dueNow.some((contact) => contact.tags.includes("outreach:replied")),
    detailVisibility: "exceptions-only" as const,
  };
}

function contactIdFromAction(action: { payload: Record<string, unknown> }) {
  const explicit = clean(action.payload.crmContactId, "");
  if (explicit) return explicit;
  return clean(action.payload.threadId, "").match(/^crm-contact:(.+)$/)?.[1] || "";
}

async function syncCrmOutreachOutcomes(settings: GrowthSettings, contacts: GrowthContact[], workGraphRoot?: string) {
  if (!prisma) return { updated: 0, replied: 0, bounced: 0, optedOut: 0 };
  const policy = crmAutopilotPolicy(settings);
  const graph = await getWorkGraphDocument(settings.orgId, "system:crm-autopilot-sync", workGraphRoot);
  const byId = new Map(contacts.map((contact) => [contact.id, contact]));
  let updated = 0;
  let replied = 0;
  let bounced = 0;
  let optedOut = 0;
  for (const action of graph.actions.filter((candidate) => candidate.type === "email.send" && Boolean(candidate.receipt?.providerReceipt))) {
    const contact = byId.get(contactIdFromAction(action));
    const receipt = action.receipt?.providerReceipt;
    if (!contact || !receipt) continue;
    const tags = new Set(contact.tags);
    if (receipt.deliveryStatus === "replied") {
      const latestReply = [...receipt.events]
        .reverse()
        .find((event) => event.eventType === "replied")?.replyPreview || "";
      const isOptOut = /\b(unsubscribe|remove me|stop emailing|do not contact)\b/iu.test(latestReply);
      if (isOptOut) {
        if (tags.has("unsubscribed")) continue;
        tags.add("unsubscribed");
        tags.add("do-not-contact");
        optedOut += 1;
        await prisma.contact.update({ where: { id: contact.id }, data: {
          status: "lost", tags: [...tags], dueAt: null, lastTouchAt: new Date(receipt.lastEventAt),
          nextStep: "Opt-out received — address suppressed immediately and automatic outreach stopped.",
        } });
        updated += 1;
        continue;
      }
      if (tags.has("outreach:replied")) continue;
      tags.add("outreach:replied");
      replied += 1;
      await prisma.contact.update({ where: { id: contact.id }, data: {
        status: "follow-up", tags: [...tags], dueAt: new Date(), lastTouchAt: new Date(receipt.lastEventAt),
        nextStep: "Reply received — follow-up needed. PhantomBot stopped the automatic sequence.",
      } });
    } else if (receipt.deliveryStatus === "bounced") {
      if (tags.has("outreach:bounced")) continue;
      tags.add("outreach:bounced");
      tags.add("do-not-contact");
      bounced += 1;
      await prisma.contact.update({ where: { id: contact.id }, data: {
        status: "lost", tags: [...tags], dueAt: null, lastTouchAt: new Date(receipt.lastEventAt),
        nextStep: "Delivery bounced — automatic outreach stopped for this address.",
      } });
    } else {
      if (tags.has("outreach:submitted")) continue;
      tags.add("outreach:submitted");
      await prisma.contact.update({ where: { id: contact.id }, data: {
        status: "follow-up", tags: [...tags], lastTouchAt: new Date(receipt.submittedAt),
        dueAt: new Date(Date.parse(receipt.submittedAt) + policy.followUpAfterDays * 86_400_000),
        nextStep: `Email ${receipt.deliveryStatus}; PhantomBot will check for a reply and follow up automatically.`,
      } });
    }
    updated += 1;
  }
  return { updated, replied, bounced, optedOut };
}

async function executeAutopilotSend(args: {
  settings: GrowthSettings;
  contact: GrowthContact;
  subject: string;
  body: string;
  sequence: "initial" | "followup-1" | "followup-2";
  workGraphRoot?: string;
}) {
  const proposed = await proposeWorkAction({
    tenantId: args.settings.orgId,
    actor: "system:phantombot-crm-autopilot",
    idempotencyKey: `crm-autopilot:${args.sequence}:${args.settings.orgId}:${args.contact.id}`,
    correlationId: `crm-contact:${args.contact.id}`,
    root: args.workGraphRoot,
    action: {
      type: "email.send",
      proposedBy: "system",
      rationale: "Executed under the account's recorded exception-only CRM standing approval policy. Provider receipt is required before this counts as sent.",
      policy: { surface: "external", reversible: false, requiresApproval: true },
      payload: {
        to: [String(args.contact.email)],
        subject: args.subject,
        body: args.body,
        threadId: `crm-contact:${args.contact.id}`,
        crmContactId: args.contact.id,
      },
    },
  });
  if (proposed.result.action.status !== "awaiting_approval") return proposed.result.action;
  const decided = await decideWorkAction({
    tenantId: args.settings.orgId,
    actionId: proposed.result.action.id,
    actor: "system:crm-standing-approval",
    decision: "approve",
    note: "Standing owner policy: exception-only CRM autopilot.",
    root: args.workGraphRoot,
  });
  return decided.result.action;
}

export async function runCrmAutopilotForOrganization(args: {
  settings: GrowthSettings;
  contacts: GrowthContact[];
  workGraphRoot?: string;
}) {
  const policy = crmAutopilotPolicy(args.settings);
  const { blockers } = autopilotBlockers(policy);
  const synced = await syncCrmOutreachOutcomes(args.settings, args.contacts, args.workGraphRoot);
  if (blockers.length) return { state: "setup-required" as const, blockers, attempted: 0, sent: 0, failed: 0, synced };
  const graph = await getWorkGraphDocument(args.settings.orgId, "system:crm-autopilot", args.workGraphRoot);
  const day = new Date().toISOString().slice(0, 10);
  const sentToday = graph.actions.filter((action) =>
    action.type === "email.send"
    && action.idempotencyKey.startsWith("crm-autopilot:")
    && action.createdAt.startsWith(day)
    && Boolean(action.receipt?.providerReceipt),
  ).length;
  let capacity = Math.max(0, policy.dailySendLimit - sentToday);
  let attempted = 0;
  let sent = 0;
  let failed = 0;
  if (policy.automaticInitialOutreach && capacity > 0) {
    for (const contact of selectAutomaticOutreachProspects(args.contacts, policy, capacity)) {
      const draft = buildOutreachDraft(contact, args.settings);
      const action = await executeAutopilotSend({
        settings: args.settings,
        contact,
        subject: draft.subject,
        body: `${draft.body}${complianceFooter(policy)}`,
        sequence: "initial",
        workGraphRoot: args.workGraphRoot,
      }).catch(() => null);
      attempted += 1;
      if (action?.receipt?.providerReceipt) sent += 1;
      else failed += 1;
      capacity -= 1;
      if (capacity <= 0) break;
    }
  }
  if (policy.automaticFollowUps && policy.maxFollowUps > 0 && capacity > 0) {
    const followUps = args.contacts
      .filter((contact) => Boolean(contact.email) && Boolean(contact.dueAt) && Number(contact.dueAt) <= Date.now())
      .filter((contact) => contact.tags.includes("outreach:submitted") && !contact.tags.some((tag) => ["outreach:replied", "outreach:bounced", "do-not-contact", "unsubscribed"].includes(tag)))
      .filter((contact) => contactPermissionReady(contact, policy))
      .slice(0, capacity);
    for (const contact of followUps) {
      const followUp = buildFollowUpDraft(contact, args.settings, policy);
      const action = await executeAutopilotSend({ ...args, contact, subject: followUp.subject, body: followUp.body, sequence: "followup-1" }).catch(() => null);
      attempted += 1;
      if (action?.receipt?.providerReceipt) sent += 1;
      else failed += 1;
    }
  }
  if (attempted || synced.updated) {
    await recordOrgAuditEvent({
      orgId: args.settings.orgId,
      actor: "system:phantombot-crm-autopilot",
      eventType: "crm_autopilot_cycle",
      targetType: "crm_automation",
      targetId: day,
      payload: { attempted, sent, failed, outcomesSynchronized: synced.updated, replies: synced.replied, bounces: synced.bounced, optOuts: synced.optedOut },
    }).catch(() => undefined);
  }
  return { state: "running" as const, blockers: [], attempted, sent, failed, synced };
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

export async function runCrmAutopilotForActiveOrganizations() {
  if (!prisma) return { organizations: 0, running: 0, setupRequired: 0, attempted: 0, sent: 0, failed: 0, replies: 0, bounces: 0 };
  const settings = await prisma.crmSettings.findMany({
    where: { sourceMode: { in: ["daily", "public-research"] } },
    select: { orgId: true, dailyPullTarget: true, sourceMode: true, brain: true },
  });
  const total = { organizations: settings.length, running: 0, setupRequired: 0, attempted: 0, sent: 0, failed: 0, replies: 0, bounces: 0 };
  for (const row of settings) {
    const policy = crmAutopilotPolicy(row);
    if (!policy.enabled) continue;
    const contacts = await prisma.contact.findMany({
      where: { orgId: row.orgId },
      orderBy: [{ dueAt: "asc" }, { fitScore: "desc" }, { updatedAt: "desc" }],
      take: 2_000,
      select: {
        id: true, orgId: true, name: true, email: true, organization: true, status: true, type: true,
        tags: true, fitScore: true, dueAt: true, lastTouchAt: true, nextStep: true,
      },
    });
    const result = await runCrmAutopilotForOrganization({ settings: row, contacts });
    if (result.state === "running") total.running += 1;
    else total.setupRequired += 1;
    total.attempted += result.attempted;
    total.sent += result.sent;
    total.failed += result.failed;
    total.replies += result.synced.replied;
    total.bounces += result.synced.bounced;
  }
  return total;
}
