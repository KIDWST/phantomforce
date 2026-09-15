import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getChicagoShotsNexProspexCrm } from "../src/phantom-ai/chicagoshots-nexprospex-crm.js";
import { buildChicagoShotsReplyDrafts } from "../src/phantom-ai/chicagoshots-studio.js";
import { createChicagoShotsInquiry, listChicagoShotsInquiries } from "../src/phantom-ai/chicagoshots-inquiry-store.js";
import { createChicagoShotsCampaign, listChicagoShotsCampaigns, updateChicagoShotsCampaignDeliverable } from "../src/phantom-ai/chicagoshots-campaign-store.js";

const crm = await getChicagoShotsNexProspexCrm(5);
assert.equal(crm.safety.database_opened_read_only, true, "The live NexProspex SQLite file should be opened read-only.");
assert.ok(crm.summary.contacts_total >= 600, "The current NexProspex source should expose the full contact base.");
assert.ok(crm.summary.organizations_total >= 600, "The current NexProspex source should expose the full organization base.");
assert.ok(crm.summary.follow_ups_due_or_ready > 0, "Follow-up tracking should come from the live task table.");
assert.equal(crm.safety.external_send, false);
assert.equal(crm.safety.source_data_mutated, false);

const drafts = buildChicagoShotsReplyDrafts(crm.follow_up_candidates, 3);
assert.equal(drafts.length, 3, "The studio should prepare a bounded reply draft queue.");
assert.ok(drafts.every((draft) => draft.status === "approval_required" && draft.external_send === false));
assert.ok(drafts.every((draft) => draft.body.includes("ChicagoShots") && draft.body.includes("Jordan West")));

const root = await mkdtemp(join(tmpdir(), "phantomforce-chicagoshots-inquiry-"));
const file = join(root, "inquiries.json");
try {
  const campaignFile = join(root, "campaigns.json");
  const seededCampaigns = await listChicagoShotsCampaigns(campaignFile);
  assert.equal(seededCampaigns.length, 3, "The Studio should seed the user-provided wedding, conference, and podcast growth campaigns.");
  const started = await updateChicagoShotsCampaignDeliverable({
    campaignId: "wedding-2026-09-26",
    deliverableId: "shot-map",
    status: "in_progress",
    actor: "test-operator",
    root: campaignFile,
  });
  assert.equal(started.changed, true);
  assert.equal(started.deliverable.status, "in_progress");
  assert.equal(started.campaign.history[0]?.actor, "test-operator");
  const sportsCampaign = await createChicagoShotsCampaign({
    name: "Fall Athlete Recruitment Engine",
    template: "sports",
    dateLabel: "Fall 2026",
    targetOutcome: "Turn game-day coverage into athlete inquiries and sponsor conversations.",
    actor: "test-operator",
    root: campaignFile,
  });
  assert.equal(sportsCampaign.serviceLine, "Sports + athletes");
  assert.equal(sportsCampaign.deliverables.length, 6);
  assert.ok(sportsCampaign.attributionTag.startsWith("cs-fall-athlete-recruitment-engine-"));
  assert.ok(sportsCampaign.channels.includes("TikTok"));
  assert.equal((await listChicagoShotsCampaigns(campaignFile)).length, 4, "A reusable campaign should persist beside the seeded engines.");
  await assert.rejects(
    () => updateChicagoShotsCampaignDeliverable({
      campaignId: "wedding-2026-09-26",
      deliverableId: "shot-map",
      status: "approved",
      actor: "test-operator",
      root: campaignFile,
    }),
    /Approval and published states must come from/u,
  );

  const first = await createChicagoShotsInquiry({
    idempotencyKey: "test-inquiry-123456",
    name: "Taylor Example",
    email: "taylor@example.com",
    projectType: "Conference or event",
    eventDate: "2026-10-15",
    location: "Chicago",
    message: "We need conference coverage and social cutdowns.",
    attribution: {
      campaignId: "physician-conference-2026-10",
      campaignTag: "cs-physician-conference-2026-10",
      utmSource: "linkedin",
      utmMedium: "organic-social",
      utmCampaign: "cs-physician-conference-2026-10",
      landingUrl: "https://chicagoshots.com/conferences?secret=must-not-persist#contact",
      referrerUrl: "https://www.linkedin.com/feed/?tracking=must-not-persist",
    },
    root: file,
  });
  assert.equal(first.created, true);
  assert.equal(first.inquiry.responseDraft.externalSent, false);
  assert.equal(first.inquiry.attribution.campaignId, "physician-conference-2026-10");
  assert.equal(first.inquiry.attribution.landingUrl, "https://chicagoshots.com/conferences");
  assert.equal(first.inquiry.attribution.referrerUrl, "https://www.linkedin.com/feed/");
  const repeated = await createChicagoShotsInquiry({
    idempotencyKey: "test-inquiry-123456",
    name: "Taylor Example",
    email: "taylor@example.com",
    projectType: "Conference or event",
    message: "Repeated request should be idempotent.",
    root: file,
  });
  assert.equal(repeated.created, false);
  assert.equal((await listChicagoShotsInquiries(10, file)).length, 1);

  process.env.NODE_ENV = "development";
  process.env.PHANTOMFORCE_SERVER_LISTEN = "false";
  process.env.PHANTOMFORCE_SERVER_LOGGER = "false";
  process.env.PHANTOMFORCE_AUTH_PROVIDER = "demo";
  process.env.PHANTOMFORCE_ENABLE_DEMO_AUTH = "true";
  process.env.PHANTOMFORCE_SKIP_SERVER_DOTENV = "true";
  process.env.PHANTOMFORCE_ALLOW_UNSIGNED_SESSION_HEADER = "false";
  process.env.PHANTOMFORCE_CHICAGOSHOTS_INQUIRY_FILE = join(root, "route-inquiries.json");
  process.env.PHANTOMFORCE_CHICAGOSHOTS_CAMPAIGN_FILE = join(root, "route-campaigns.json");
  process.env.PHANTOMFORCE_WORKSPACE_APPROVAL_DIR = join(root, "approvals");
  process.env.PHANTOMFORCE_CONTENT_ASSET_DIR = join(root, "assets");
  process.env.PHANTOMFORCE_CONTENT_PUBLICATION_DIR = join(root, "publications");
  const { app } = await import("../src/index.js");
  try {
    const publicInquiry = await app.inject({
      method: "POST",
      url: "/api/public/chicagoshots/inquiries",
      headers: { "Content-Type": "application/json", Origin: "https://chicagoshots.com" },
      payload: JSON.stringify({
        idempotency_key: "public-inquiry-123456",
        name: "Morgan Example",
        email: "morgan@example.com",
        project_type: "Wedding or milestone",
        event_date: "2026-09-26",
        location: "Chicago",
        message: "We need a wedding film and a short social teaser.",
        campaign_tag: "cs-wedding-2026-09-26",
        utm_source: "instagram",
        utm_medium: "organic-social",
        utm_campaign: "cs-wedding-2026-09-26",
        landing_url: "https://chicagoshots.com/?private=removed#contact",
        referrer_url: "https://www.instagram.com/?tracking=removed",
        started_at: Date.now() - 2_000,
      }),
    });
    assert.equal(publicInquiry.statusCode, 201);
    assert.equal(publicInquiry.headers["access-control-allow-origin"], "https://chicagoshots.com");

    const login = await app.inject({
      method: "POST",
      url: "/auth/demo-login",
      headers: { "Content-Type": "application/json" },
      payload: JSON.stringify({ sessionId: "admin-jordan" }),
    });
    const token = (JSON.parse(login.payload) as { token: string }).token;
    const studio = await app.inject({
      method: "GET",
      url: "/phantom-ai/ops/chicagoshots/studio?limit=5",
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(studio.statusCode, 200);
    const studioBody = JSON.parse(studio.payload) as { inquiries: { total: number }; campaigns: Array<{ id: string; outcomes: { inquiries_total: number; assets_total: number } }>; safety: { external_send: boolean; campaign_updates_are_internal: boolean }; crm: { summary: { contacts_total: number } } };
    assert.equal(studioBody.inquiries.total, 1);
    assert.equal(studioBody.campaigns.length, 3);
    assert.equal(studioBody.campaigns.find((campaign) => campaign.id === "wedding-2026-09-26")?.outcomes.inquiries_total, 1);
    assert.equal(studioBody.safety.external_send, false);
    assert.equal(studioBody.safety.campaign_updates_are_internal, true);
    assert.ok(studioBody.crm.summary.contacts_total >= 600);

    const campaignCreate = await app.inject({
      method: "POST",
      url: "/phantom-ai/ops/chicagoshots/campaigns",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      payload: JSON.stringify({
        name: "Chicago Founder Authority Series",
        template: "brand",
        date_label: "Q4 2026",
        target_outcome: "Generate qualified founder interviews and measurable business inquiries.",
        channels: ["LinkedIn", "YouTube"],
      }),
    });
    assert.equal(campaignCreate.statusCode, 201);
    const campaignCreateBody = JSON.parse(campaignCreate.payload) as { campaign: { serviceLine: string; channels: string[]; deliverables: unknown[] }; external_send: boolean; external_publish: boolean; approval_bypassed: boolean };
    assert.equal(campaignCreateBody.campaign.serviceLine, "Brand + business content");
    assert.deepEqual(campaignCreateBody.campaign.channels, ["LinkedIn", "YouTube"]);
    assert.equal(campaignCreateBody.campaign.deliverables.length, 6);
    assert.equal(campaignCreateBody.external_send, false);
    assert.equal(campaignCreateBody.external_publish, false);
    assert.equal(campaignCreateBody.approval_bypassed, false);

    const campaignAsset = await app.inject({
      method: "POST",
      url: "/phantom-ai/content/assets",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      payload: JSON.stringify({
        tenant_id: "client-chicagoshots",
        campaign_id: "wedding-2026-09-26",
        filename: "wedding-hero.png",
        image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      }),
    });
    assert.equal(campaignAsset.statusCode, 200);
    const campaignAssetBody = JSON.parse(campaignAsset.payload) as { asset: { campaign_id: string | null } };
    assert.equal(campaignAssetBody.asset.campaign_id, "wedding-2026-09-26");

    const danglingCampaignAsset = await app.inject({
      method: "POST",
      url: "/phantom-ai/content/assets",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      payload: JSON.stringify({
        tenant_id: "client-chicagoshots",
        campaign_id: "campaign-does-not-exist",
        filename: "orphan.png",
        image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      }),
    });
    assert.equal(danglingCampaignAsset.statusCode, 400, "Uploads must not be routed into a campaign that does not exist.");

    const invalidCampaign = await app.inject({
      method: "POST",
      url: "/phantom-ai/ops/chicagoshots/campaigns",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      payload: JSON.stringify({ name: "No", template: "custom", target_outcome: "tiny" }),
    });
    assert.equal(invalidCampaign.statusCode, 400);

    const campaignStart = await app.inject({
      method: "PATCH",
      url: "/phantom-ai/ops/chicagoshots/campaigns/wedding-2026-09-26/deliverables/shot-map",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      payload: JSON.stringify({ status: "in_progress" }),
    });
    assert.equal(campaignStart.statusCode, 200);
    const campaignReady = await app.inject({
      method: "PATCH",
      url: "/phantom-ai/ops/chicagoshots/campaigns/wedding-2026-09-26/deliverables/shot-map",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      payload: JSON.stringify({ status: "ready_for_review" }),
    });
    assert.equal(campaignReady.statusCode, 200);
    const campaignReadyBody = JSON.parse(campaignReady.payload) as { approval_queued: boolean; external_publish: boolean; approval_bypassed: boolean };
    assert.equal(campaignReadyBody.approval_queued, true);
    assert.equal(campaignReadyBody.external_publish, false);
    assert.equal(campaignReadyBody.approval_bypassed, false);
    const campaignUnsafe = await app.inject({
      method: "PATCH",
      url: "/phantom-ai/ops/chicagoshots/campaigns/wedding-2026-09-26/deliverables/shot-map",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      payload: JSON.stringify({ status: "approved" }),
    });
    assert.equal(campaignUnsafe.statusCode, 400, "The production tracker must not bypass Approvals.");

    const queue = await app.inject({
      method: "POST",
      url: "/phantom-ai/ops/chicagoshots/reply-drafts/queue",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      payload: JSON.stringify({ limit: 3 }),
    });
    assert.equal(queue.statusCode, 201);
    const queueBody = JSON.parse(queue.payload) as { queued: unknown[]; external_send: boolean; source_crm_mutated: boolean };
    assert.equal(queueBody.queued.length, 3);
    assert.equal(queueBody.external_send, false);
    assert.equal(queueBody.source_crm_mutated, false);
  } finally {
    await app.close();
  }
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("ChicagoShots Studio campaign, CRM, reply-draft, and inquiry checks passed.");
