import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildOutreachDraft,
  crmFollowUpSchedule,
  crmFollowUpSequence,
  crmAutopilotPolicy,
  isValidBusinessPostalAddress,
  prepareCrmOutreachDrafts,
  runCrmAutopilotForOrganization,
  selectAutomaticOutreachProspects,
  selectDailyOutreachProspects,
  type GrowthContact,
} from "../src/crm/crm-growth-automation.js";
import { getWorkGraphDocument } from "../src/workforce/work-graph.js";

const settings = {
  orgId: "chicagoshots-test",
  dailyPullTarget: 2,
  sourceMode: "public-research",
  brain: { businessProfile: "ChicagoShots — Chicago video production" },
};
const contact = (overrides: Partial<GrowthContact> = {}): GrowthContact => ({
  id: "contact-ready",
  orgId: settings.orgId,
  name: "Lakefront Athletics",
  email: "hello@lakefront.example",
  organization: "Lakefront Athletics",
  status: "new",
  type: "business-prospect",
  tags: ["lane:sports-fitness", "email:published-business", "consent:unknown"],
  fitScore: 90,
  dueAt: new Date("2026-09-15T12:00:00.000Z"),
  ...overrides,
});

const candidates = [
  contact(),
  contact({ id: "no-email", email: null }),
  contact({ id: "guessed", email: "guess@example.com", tags: ["email:published-business", "email:guessed"] }),
  contact({ id: "opted-out", email: "no@example.com", tags: ["email:published-business", "do-not-contact"] }),
  contact({ id: "client", email: "client@example.com", status: "client" }),
];
const selected = selectDailyOutreachProspects(candidates, 25);
assert.deepEqual(selected.map((item) => item.id), ["contact-ready"], "Only eligible, published business emails may enter draft prep.");
assert.equal(isValidBusinessPostalAddress("Elgin, IL"), false, "A city and state alone cannot unlock commercial sending.");
assert.equal(isValidBusinessPostalAddress("123 Test Street, Chicago, IL 60601"), true, "A complete deliverable address should pass the format gate.");

const draft = buildOutreachDraft(selected[0], settings);
assert.match(draft.body, /game coverage, athlete profiles, recruiting reels/u, "Lane-specific value must personalize the draft.");
assert.match(draft.body, /public Chicago-area business listing/u, "Drafts must disclose the public research source.");
assert.doesNotMatch(draft.body, /I researched|we spoke|following up/u, "Drafts cannot invent relationship history.");

const root = await mkdtemp(join(tmpdir(), "phantomforce-crm-growth-"));
const savedEnv = {
  url: process.env.PHANTOMFORCE_EMAIL_EXECUTOR_URL,
  secret: process.env.PHANTOMFORCE_EMAIL_EXECUTOR_SECRET,
  webhook: process.env.PHANTOMFORCE_EMAIL_WEBHOOK_SECRET,
};
const deliveredBodies: string[] = [];
const executor = createServer((request, response) => {
  let raw = "";
  request.on("data", (chunk) => { raw += String(chunk); });
  request.on("end", () => {
    deliveredBodies.push(String((JSON.parse(raw) as { message?: { body?: string } }).message?.body || ""));
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ accepted: true, provider: "gmail", message_id: "provider-message-1", thread_id: "thread-1", submitted_at: new Date().toISOString() }));
  });
});
try {
  const first = await prepareCrmOutreachDrafts({ settings, contacts: candidates, workGraphRoot: root });
  assert.deepEqual(first, { eligible: 1, created: 1, alreadyPrepared: 0, sent: 0, providerCalled: false });
  const replay = await prepareCrmOutreachDrafts({ settings, contacts: candidates, workGraphRoot: root });
  assert.deepEqual(replay, { eligible: 1, created: 0, alreadyPrepared: 1, sent: 0, providerCalled: false });
  const graph = await getWorkGraphDocument(settings.orgId, "test", root);
  assert.equal(graph.actions.length, 1, "Daily reruns must not duplicate the first-touch draft.");
  assert.equal(graph.actions[0].type, "email.draft");
  assert.equal(graph.actions[0].status, "awaiting_approval");
  assert.equal(graph.actions[0].approval.status, "pending");
  assert.equal(graph.actions.some((action) => action.type === "email.send"), false, "Automation must never create a send action.");

  await new Promise<void>((resolve) => executor.listen(0, "127.0.0.1", resolve));
  const address = executor.address();
  assert(address && typeof address === "object");
  process.env.PHANTOMFORCE_EMAIL_EXECUTOR_URL = `http://127.0.0.1:${address.port}`;
  process.env.PHANTOMFORCE_EMAIL_EXECUTOR_SECRET = "test-email-executor-secret-123456";
  process.env.PHANTOMFORCE_EMAIL_WEBHOOK_SECRET = "test-email-webhook-secret-1234567";
  const autopilotSettings = {
    ...settings,
    brain: {
      ...settings.brain,
      autopilot: {
        enabled: true,
        standingApproval: true,
        automaticInitialOutreach: true,
        automaticFollowUps: true,
        dailySendLimit: 2,
        followUpAfterDays: 5,
        maxFollowUps: 1,
        permissionMode: "public-business",
        senderName: "Jordan West",
        senderBusiness: "ChicagoShots",
        senderWebsite: "https://chicagoshots.com",
        senderPostalAddress: "123 Test Street, Chicago, IL 60601",
      },
    },
  };
  const policy = crmAutopilotPolicy(autopilotSettings);
  assert.equal(policy.preferredEmailProvider, "gmail");
  assert.equal(selectAutomaticOutreachProspects(candidates, policy, 2).length, 1, "Published business outreach may run only under the explicit standing policy.");
  const autopilot = await runCrmAutopilotForOrganization({ settings: autopilotSettings, contacts: candidates, workGraphRoot: root });
  assert.equal(autopilot.state, "running");
  assert.equal(autopilot.sent, 1, "A verified provider receipt is required before autopilot counts a send.");
  assert.match(deliveredBodies[0], /business introduction from ChicagoShots/u);
  assert.match(deliveredBodies[0], /123 Test Street, Chicago, IL 60601/u);
  assert.match(deliveredBodies[0], /reply “unsubscribe”/u);
  const autopilotGraph = await getWorkGraphDocument(settings.orgId, "test", root);
  const send = autopilotGraph.actions.find((action) => action.type === "email.send");
  assert.equal(send?.status, "verified_complete");
  assert.equal(send?.approval.decidedBy, "system:crm-standing-approval");
  assert.equal(send?.receipt?.providerReceipt?.messageId, "provider-message-1");
  const followUpContact = contact({
    dueAt: new Date("2026-09-15T12:00:00.000Z"),
    tags: ["lane:sports-fitness", "email:published-business", "consent:unknown", "outreach:submitted", "outreach:initial-submitted"],
  });
  assert.equal(crmFollowUpSequence(followUpContact, policy), "followup-1");
  const followUp = await runCrmAutopilotForOrganization({ settings: autopilotSettings, contacts: [followUpContact], workGraphRoot: root });
  assert.equal(followUp.attempted, 1, "A due contact should execute its first durable follow-up exactly once.");
  assert.equal(followUp.sent, 1, "A new follow-up counts only after a provider receipt is recorded.");
  assert.equal(deliveredBodies.length, 2, "The executor should receive one initial email and one follow-up.");
  const afterFollowUp = await getWorkGraphDocument(settings.orgId, "test", root);
  assert.equal(afterFollowUp.actions.filter((action) => action.idempotencyKey.includes("crm-autopilot:followup-1:")).length, 1);
  const replayedFollowUp = await runCrmAutopilotForOrganization({ settings: autopilotSettings, contacts: [followUpContact], workGraphRoot: root });
  assert.equal(replayedFollowUp.attempted, 0, "A completed idempotent follow-up replay is not a new provider attempt.");
  assert.equal(replayedFollowUp.sent, 0, "A completed idempotent follow-up replay is not a new send.");
  assert.equal(deliveredBodies.length, 2, "A completed follow-up must not call the provider again.");
  const twoFollowUpPolicy = { ...policy, maxFollowUps: 2 };
  assert.equal(crmFollowUpSequence({ tags: [...followUpContact.tags, "outreach:followup-1-submitted"] }, twoFollowUpPolicy), "followup-2");
  assert.equal(crmFollowUpSequence({ tags: [...followUpContact.tags, "outreach:followup-1-submitted", "outreach:followup-2-submitted"] }, twoFollowUpPolicy), null);
  const finalSchedule = crmFollowUpSchedule(
    { tags: [...followUpContact.tags, "outreach:followup-1-submitted", "outreach:followup-2-submitted"] },
    twoFollowUpPolicy,
    new Date("2026-09-18T12:00:00.000Z"),
  );
  assert.equal(finalSchedule.sequenceComplete, true);
  assert.equal(finalSchedule.dueAt, null, "The final configured follow-up must clear the automatic due date.");
  const pendingSchedule = crmFollowUpSchedule(
    { tags: [...followUpContact.tags, "outreach:followup-1-submitted"] },
    twoFollowUpPolicy,
    new Date("2026-09-18T12:00:00.000Z"),
  );
  assert.equal(pendingSchedule.sequenceComplete, false);
  assert.equal(pendingSchedule.nextFollowUp, 2);
  assert.equal(pendingSchedule.dueAt?.toISOString(), "2026-09-23T12:00:00.000Z");
  assert.equal(crmAutopilotPolicy({ ...autopilotSettings, brain: { ...autopilotSettings.brain, autopilot: { ...autopilotSettings.brain.autopilot, maxFollowUps: 0 } } }).maxFollowUps, 0,
    "An owner must be able to disable automatic follow-ups without the default silently re-enabling them.");
} finally {
  await new Promise<void>((resolve) => executor.close(() => resolve()));
  if (savedEnv.url === undefined) delete process.env.PHANTOMFORCE_EMAIL_EXECUTOR_URL; else process.env.PHANTOMFORCE_EMAIL_EXECUTOR_URL = savedEnv.url;
  if (savedEnv.secret === undefined) delete process.env.PHANTOMFORCE_EMAIL_EXECUTOR_SECRET; else process.env.PHANTOMFORCE_EMAIL_EXECUTOR_SECRET = savedEnv.secret;
  if (savedEnv.webhook === undefined) delete process.env.PHANTOMFORCE_EMAIL_WEBHOOK_SECRET; else process.env.PHANTOMFORCE_EMAIL_WEBHOOK_SECRET = savedEnv.webhook;
  await rm(root, { recursive: true, force: true });
}

console.log(JSON.stringify({
  ok: true,
  eligible: selected.length,
  behavior: "exception-only standing-policy CRM autopilot",
  verifiedAutopilotSends: 2,
  idempotentFollowUpReplay: true,
  boundedSequence: true,
  complianceFooter: true,
  providerReceiptRequired: true,
}, null, 2));
