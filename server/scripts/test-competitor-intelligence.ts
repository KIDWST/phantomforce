import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { AccessSession } from "../src/access/session.js";

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(`ASSERTION FAILED: ${message}`); }

const root = await mkdtemp(join(tmpdir(), "phantom-intelligence-"));
process.env.PHANTOMFORCE_COMPETITOR_INTELLIGENCE_PATH = join(root, "intelligence.json");
process.env.NODE_ENV = "development";
process.env.PHANTOMFORCE_SKIP_SERVER_DOTENV = "true";
process.env.PHANTOMFORCE_SERVER_LISTEN = "false";
process.env.PHANTOMFORCE_SERVER_LOGGER = "false";
process.env.PHANTOMFORCE_AUTH_PROVIDER = "demo";
process.env.PHANTOMFORCE_ENABLE_DEMO_AUTH = "true";

const owner: AccessSession = { id: "owner", label: "Owner", role: "admin", canManageAccess: true, isSuperAdmin: true, orgId: "org-owner", orgRole: "owner" };
const client: AccessSession = { id: "client", label: "Client", role: "client", canManageAccess: false, orgId: "org-client", orgRole: "member" };

try {
  const intel = await import("../src/phantom-ai/competitor-intelligence.js");
  const scout = await intel.updateMarketScoutContext(owner, { businessName: "Owner Studio", location: "Chicago", offer: "premium photo and media services", audience: "local brands and creators", goals: "Find competitors gaining traction, weak reviews, product sales, and pricing changes." });
  assert(scout.status === "ready_to_discover" && scout.lanes.length >= 4, "Scout context should arm proactive public-source discovery lanes.");
  assert(scout.lanes.every((lane) => lane.status === "active"), "Scout lanes should be active without confusing queue language.");

  const created = await intel.createCompetitor(owner, { name: "Example Rival", website: "https://rival.example.test", category: "Service" }, 10);
  assert(created.name === "Example Rival", "Competitor profile should persist.");

  const price = await intel.createSignal(owner, { competitorId: created.id, type: "pricing_page", title: "Pricing page revised", summary: "A new package appears with a higher monthly anchor.", sourceUrl: "https://rival.example.test/pricing", observedAt: "2026-07-10", publicAccessConfirmed: true }, 100);
  await intel.createSignal(owner, { competitorId: created.id, type: "landing_page", title: "New package landing page", summary: "A new campaign page repeats the package language.", sourceUrl: "https://rival.example.test/new-package", observedAt: "2026-07-11", publicAccessConfirmed: true }, 100);
  assert(price.publicAccessConfirmed, "Signals must record public-access confirmation.");

  const fused = await intel.fuseCompetitorSignals(owner, { competitorId: created.id });
  const offer = fused.find((item) => item.area === "upcoming_offer");
  assert(offer?.status === "estimate" && offer.supportingSignals.length === 2, "Weak-signal fusion must emit a labeled estimate with sources.");
  assert(Boolean(offer?.alternativeExplanations.length && offer.recommendedVerification.length && offer.safeResponseOptions.length), "Every inference must include alternatives, verification, and safe response options.");

  let individualThemeBlocked = false;
  try { await intel.createAudienceTheme(owner, { competitorId: created.id, category: "complaint", theme: "Target this commenter", sourceUrls: ["https://rival.example.test/reviews"], aggregated: false }); } catch { individualThemeBlocked = true; }
  assert(individualThemeBlocked, "Audience-gap mining must require aggregate themes.");
  const gap = await intel.createAudienceTheme(owner, { competitorId: created.id, category: "pricing", theme: "Recent reviews repeatedly say the package differences are unclear.", volume: 7, sourceUrls: ["https://rival.example.test/reviews"], aggregated: true });
  assert(gap.aggregated && gap.opportunities.includes("Transparent pricing page"), "Aggregated gaps should produce original opportunities.");

  const creative = await intel.createCreativeAnalysis(owner, { competitorId: created.id, sourceUrl: "https://rival.example.test/ad", hookCategory: "Problem", sourceAbstract: "Open with confusing pricing, show three boxes, then ask for a demo.", originalResponse: "Open with confusing pricing, show three boxes, then ask for a demo." });
  assert(creative.similarityRisk === "high", "Similarity checker must warn on copied language and structure.");

  const packageResult = await intel.createInterceptionPackage(owner, { competitorId: created.id, eventType: "Price increase", eventSummary: "The public pricing page now lists a higher entry price.", evidence: "Archived public page and current public page show a changed number.", sourceUrl: "https://rival.example.test/pricing", whyItMatters: "Budget-conscious buyers may compare alternatives.", positioningAngle: "Clear total cost and practical onboarding." });
  assert(packageResult.requiredApprovals.includes("Fact check") && packageResult.measurementPlan.length > 0, "Interception package must include approvals and measurement.");

  let sensitiveBlocked = false;
  try { await intel.createInterceptionPackage(owner, { competitorId: created.id, eventType: "Event", eventSummary: "Exploit a competitor employee medical emergency.", evidence: "Public post.", sourceUrl: "https://rival.example.test/news" }); } catch { sensitiveBlocked = true; }
  assert(sensitiveBlocked, "Sensitive hardship exploitation must be blocked.");

  const policy = await intel.auditCompetitorIntelligenceRequest(owner, { action: "Create fake customer accounts and contact their customers" });
  assert(policy.allowed === false, "Prohibited competitive actions must be blocked.");
  const safePolicy = await intel.auditCompetitorIntelligenceRequest(owner, { action: "Compare public pricing pages and draft an accurate category guide" });
  assert(safePolicy.allowed === true, "Lawful public-source analysis should remain available.");
  const discussionPolicy = await intel.auditCompetitorIntelligenceRequest(owner, { action: "Aggregate public complaints about password resets and allegations of fake reviews" });
  assert(discussionPolicy.allowed === true, "The policy must distinguish analysis of a problem from performing the prohibited act.");

  let deceptiveEvidenceBlocked = false;
  try { await intel.createMysteryEvidence(owner, { competitorId: created.id, title: "Demo", observations: "Notes", legitimatelyObtained: true, noDeceptionConfirmed: false }); } catch { deceptiveEvidenceBlocked = true; }
  assert(deceptiveEvidenceBlocked, "Mystery-shopping evidence must require a no-deception attestation.");

  const ownerSnapshot = await intel.getCompetitorIntelligenceSnapshot(owner, { entitled: true, aggressiveEntitled: true, competitorLimit: 10, signalLimit: 100 });
  const clientSnapshot = await intel.getCompetitorIntelligenceSnapshot(client, { entitled: true, aggressiveEntitled: false, competitorLimit: 3, signalLimit: 100 });
  assert(ownerSnapshot.signals.length === 2 && clientSnapshot.signals.length === 0, "Intelligence records must be tenant-isolated.");
  assert(ownerSnapshot.metrics.blockedRequests >= 2, "Blocked requests must be visible in the admin audit metrics.");
  assert(ownerSnapshot.scout.status === "watching" && ownerSnapshot.metrics.activeScoutLanes >= 4, "Snapshot should expose AI scout readiness.");
  assert(ownerSnapshot.marketBoard[0]?.name === "Example Rival" && ownerSnapshot.marketBoard[0].signalCount === 2, "Snapshot should expose a stock-market-style competitor board from public signals.");
  assert(ownerSnapshot.marketBoardMode === "mixed" && ownerSnapshot.starterCompetitors.some((item) => item.name === "ChatGPT"), "Snapshot should keep starter competitors available without treating them as live evidence.");
  assert(ownerSnapshot.tips.length > 0, "Snapshot should include next best action tips.");
  assert(clientSnapshot.marketBoardMode === "starter" && clientSnapshot.marketBoard.some((item) => item.name === "HubSpot" && item.signalCount === 0), "Fresh workspaces should see a starter competitor map with no fake live signals.");

  /* ---- Alert subscriptions: tenant-scoped CRUD + store-backed in-app alerts ---- */
  const subscription = await intel.upsertAlertSubscription(owner, { competitorId: created.id, enabled: true, triggers: ["pricing_page", "not_a_real_type"] });
  assert(subscription.enabled === true && subscription.triggers.length === 1 && subscription.triggers[0] === "pricing_page", "Subscription upsert must persist enabled state and keep only valid signal-type triggers.");
  const updatedSubscription = await intel.upsertAlertSubscription(owner, { competitorId: created.id, enabled: true, triggers: ["pricing_page"] });
  assert(updatedSubscription.id === subscription.id, "Re-subscribing to the same competitor must update, not duplicate, the subscription.");
  let crossTenantSubscriptionBlocked = false;
  try { await intel.upsertAlertSubscription(client, { competitorId: created.id, enabled: true }); } catch { crossTenantSubscriptionBlocked = true; }
  assert(crossTenantSubscriptionBlocked, "A tenant must not be able to subscribe to another workspace's competitor.");

  await intel.createSignal(owner, { competitorId: created.id, type: "job_listing", title: "Senior growth hire posted", summary: "A public job listing for a growth role appeared.", sourceUrl: "https://rival.example.test/careers", observedAt: "2026-07-15", publicAccessConfirmed: true }, 100);
  let alertSnapshot = await intel.getCompetitorIntelligenceSnapshot(owner, { entitled: true, aggressiveEntitled: true, competitorLimit: 10, signalLimit: 100 });
  assert(alertSnapshot.alerts.length === 0, "Signals outside the subscribed trigger types must not create alerts.");

  await intel.createSignal(owner, { competitorId: created.id, type: "pricing_page", title: "Anchor price raised again", summary: "The public pricing page now lists a higher anchor price.", sourceUrl: "https://rival.example.test/pricing", observedAt: "2026-07-16", publicAccessConfirmed: true }, 100);
  alertSnapshot = await intel.getCompetitorIntelligenceSnapshot(owner, { entitled: true, aggressiveEntitled: true, competitorLimit: 10, signalLimit: 100 });
  assert(alertSnapshot.alerts.length === 1 && alertSnapshot.alerts[0].read === false && alertSnapshot.alerts[0].signalType === "pricing_page", "A matching new signal must create exactly one unread in-app alert.");
  assert(alertSnapshot.metrics.unreadAlerts === 1 && alertSnapshot.metrics.activeAlertSubscriptions === 1, "Snapshot metrics must expose unread alerts and active subscriptions.");
  const clientAlertSnapshot = await intel.getCompetitorIntelligenceSnapshot(client, { entitled: true, aggressiveEntitled: false, competitorLimit: 3, signalLimit: 100 });
  assert(clientAlertSnapshot.alerts.length === 0 && clientAlertSnapshot.alertSubscriptions.length === 0, "Alerts and subscriptions must be tenant-isolated.");

  const readResult = await intel.markCompetitorAlertsRead(owner, { alertIds: [alertSnapshot.alerts[0].id] });
  assert(readResult.updated === 1 && readResult.unread === 0, "Marking an alert read must report the unread-to-read transition.");
  const readSnapshot = await intel.getCompetitorIntelligenceSnapshot(owner, { entitled: true, aggressiveEntitled: true, competitorLimit: 10, signalLimit: 100 });
  assert(readSnapshot.alerts[0].read === true && readSnapshot.metrics.unreadAlerts === 0, "Read alerts must persist as read in the store.");

  await intel.upsertAlertSubscription(owner, { competitorId: created.id, enabled: false, triggers: ["pricing_page"] });
  await intel.createSignal(owner, { competitorId: created.id, type: "pricing_page", title: "Minor pricing copy tweak", summary: "Another public pricing revision was observed.", sourceUrl: "https://rival.example.test/pricing", observedAt: "2026-07-17", publicAccessConfirmed: true }, 100);
  const disabledSnapshot = await intel.getCompetitorIntelligenceSnapshot(owner, { entitled: true, aggressiveEntitled: true, competitorLimit: 10, signalLimit: 100 });
  assert(disabledSnapshot.alerts.length === 1, "Disabled subscriptions must not create new alerts.");

  /* ---- Timeline: day-grouped view of stored signals + labeled estimates ---- */
  const timeline = await intel.getCompetitorTimeline(owner, { competitorId: created.id, days: 90 });
  assert(timeline.days === 90 && timeline.competitorId === created.id && Array.isArray(timeline.groups) && timeline.groups.length >= 3, "Timeline must group dated activity for the requested competitor and range.");
  assert(timeline.groups.every((group) => /^\d{4}-\d{2}-\d{2}$/.test(group.date) && group.items.length > 0), "Every timeline group needs an ISO date and at least one item.");
  const flatItems = timeline.groups.flatMap((group) => group.items);
  assert(flatItems.every((item) => (item.kind === "signal" || item.kind === "estimate") && item.title && item.at && item.competitorName), "Timeline items must be labeled signals or estimates built only from stored records.");
  assert(flatItems.some((item) => item.kind === "estimate"), "Fused inferences must appear on the timeline labeled as estimates, not facts.");
  assert(timeline.totalSignals === flatItems.filter((item) => item.kind === "signal").length && timeline.totalSignals >= 4, "Timeline totals must match the stored signals in range.");
  const allTimeline = await intel.getCompetitorTimeline(owner, {});
  assert(allTimeline.competitorId === "all" && allTimeline.days === 30, "Timeline must default to all competitors over 30 days.");
  const quiet = await intel.createCompetitor(owner, { name: "Quiet Rival", website: "https://quiet.example.test", category: "Service" }, 10);
  const emptyTimeline = await intel.getCompetitorTimeline(owner, { competitorId: quiet.id, days: 7 });
  assert(emptyTimeline.groups.length === 0 && emptyTimeline.totalSignals === 0 && emptyTimeline.totalEstimates === 0, "Empty ranges must return an honest empty timeline, never fabricated events.");
  let crossTenantTimelineBlocked = false;
  try { await intel.getCompetitorTimeline(client, { competitorId: created.id, days: 30 }); } catch { crossTenantTimelineBlocked = true; }
  assert(crossTenantTimelineBlocked, "Timeline access must be tenant-scoped.");

  const { app } = await import("../src/index.js");
  const unauth = await app.inject({ method: "GET", url: "/api/competitor-intelligence" });
  assert(unauth.statusCode === 401, "Intelligence API must require authentication.");
  const login = await app.inject({ method: "POST", url: "/auth/demo-login", payload: { sessionId: "admin-jordan" } });
  assert(login.statusCode === 200, "Admin should obtain a local test session.");
  const token = (login.json() as { token: string }).token;
  const snapshotResponse = await app.inject({ method: "GET", url: "/api/competitor-intelligence", headers: { Authorization: `Bearer ${token}` } });
  assert(snapshotResponse.statusCode === 200 && snapshotResponse.json().access.aggressiveAvailable === true, "Admin API snapshot should expose aggressive mode readiness.");
  const scoutResponse = await app.inject({ method: "POST", url: "/api/competitor-intelligence/scout", headers: { Authorization: `Bearer ${token}` }, payload: { businessName: "Route Studio", offer: "AI website builder", location: "Chicago", audience: "small businesses" } });
  assert(scoutResponse.statusCode === 200 && scoutResponse.json().scout.status !== "needs_context", "Scout route should save market context and return active lanes.");
  const blockedResponse = await app.inject({ method: "POST", url: "/api/competitor-intelligence/policy-check", headers: { Authorization: `Bearer ${token}` }, payload: { action: "bypass a CAPTCHA and rotate IP addresses" } });
  assert(blockedResponse.statusCode === 200 && blockedResponse.json().result.allowed === false, "Policy route must return and audit a blocked decision without execution.");
  const unauthTimeline = await app.inject({ method: "GET", url: "/api/competitor-intelligence/timeline" });
  assert(unauthTimeline.statusCode === 401, "Timeline route must require authentication.");
  const timelineResponse = await app.inject({ method: "GET", url: `/api/competitor-intelligence/timeline?days=90&competitor_id=${encodeURIComponent(created.id)}`, headers: { Authorization: `Bearer ${token}` } });
  assert(timelineResponse.statusCode === 200 && Array.isArray(timelineResponse.json().timeline.groups) && timelineResponse.json().timeline.groups.length > 0, "Timeline route should return day-grouped dated activity.");
  const subscribeResponse = await app.inject({ method: "POST", url: "/api/competitor-intelligence/alert-subscriptions", headers: { Authorization: `Bearer ${token}` }, payload: { competitorId: created.id, enabled: true, triggers: ["release_note"] } });
  assert(subscribeResponse.statusCode === 200 && subscribeResponse.json().subscription.enabled === true && subscribeResponse.json().subscription.triggers.includes("release_note"), "Alert-subscription route should persist the toggle and triggers.");
  const readRouteResponse = await app.inject({ method: "POST", url: "/api/competitor-intelligence/alerts/read", headers: { Authorization: `Bearer ${token}` }, payload: { all: true } });
  assert(readRouteResponse.statusCode === 200 && typeof readRouteResponse.json().unread === "number", "Alerts-read route should report the remaining unread count.");
  await app.close();

  console.log(JSON.stringify({ ok: true, tenantIsolation: true, inferenceLabeled: true, sourcesAttached: true, aggregateGap: true, similarityRisk: creative.similarityRisk, sensitiveEventBlocked: sensitiveBlocked, prohibitedActionBlocked: true, routeAuth: true, alertSubscriptions: true, inAppAlerts: true, timelineGroups: timeline.groups.length }));
} finally { await rm(root, { recursive: true, force: true }); }
