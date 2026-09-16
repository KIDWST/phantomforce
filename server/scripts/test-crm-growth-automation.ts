import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildOutreachDraft,
  prepareCrmOutreachDrafts,
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

const draft = buildOutreachDraft(selected[0], settings);
assert.match(draft.body, /game coverage, athlete profiles, recruiting reels/u, "Lane-specific value must personalize the draft.");
assert.match(draft.body, /public Chicago-area business listing/u, "Drafts must disclose the public research source.");
assert.doesNotMatch(draft.body, /I researched|we spoke|following up/u, "Drafts cannot invent relationship history.");

const root = await mkdtemp(join(tmpdir(), "phantomforce-crm-growth-"));
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
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log(JSON.stringify({
  ok: true,
  eligible: selected.length,
  behavior: "tenant-scoped approval-bound drafts",
  sends: 0,
  providerCalled: false,
}, null, 2));
