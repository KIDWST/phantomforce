import assert from "node:assert/strict";

import { buildManagedGrowthReport } from "../src/managed-growth/managed-growth-report.js";

const generatedAt = "2026-07-13T18:00:00.000Z";

const report = buildManagedGrowthReport({
  tenantId: "dev-org-chicagoshots",
  generatedAt,
  clientSetup: {
    schemaVersion: 1,
    tenantId: "dev-org-chicagoshots",
    version: 4,
    checksum: "setup-checksum",
    updatedAt: generatedAt,
    updatedBy: "test",
    slots: [
      {
        slotId: "active-1",
        slotKind: "active",
        status: "active",
        organizationName: "ChicagoShots",
        businessTemplate: "media_content",
        modules: { lead_queue: true, follow_up_queue: true, approval_queue: true, reports: true, business_cleanup: true },
        servicesPackages: [],
        leadSources: [],
        socialMediaWorkflow: { platforms: [], cadence: "", assetNeeds: [], notes: "" },
        approvalRules: { requireOwnerApprovalFor: [], approvalNotes: "" },
        reportingPreferences: { cadence: "weekly", metrics: ["new_leads"], recipients: ["owner"], notes: "" },
        completeness: { score: 80, completed: ["business"], blockers: ["Choose reporting recipients."], nextAction: "Finish reporting." },
        updatedAt: generatedAt,
        updatedBy: "test",
      },
      {
        slotId: "active-2",
        slotKind: "active",
        status: "empty",
        organizationName: "",
        businessTemplate: "",
        modules: {},
        servicesPackages: [],
        leadSources: [],
        socialMediaWorkflow: { platforms: [], cadence: "", assetNeeds: [], notes: "" },
        approvalRules: { requireOwnerApprovalFor: [], approvalNotes: "" },
        reportingPreferences: { cadence: "", metrics: [], recipients: [], notes: "" },
        completeness: { score: 0, completed: [], blockers: ["Name the client organization."], nextAction: "Name the client." },
        updatedAt: generatedAt,
        updatedBy: "test",
      },
      {
        slotId: "pending-1",
        slotKind: "pending",
        status: "pending",
        organizationName: "Next Gym",
        businessTemplate: "local_service",
        modules: { lead_queue: true },
        servicesPackages: [],
        leadSources: [],
        socialMediaWorkflow: { platforms: [], cadence: "", assetNeeds: [], notes: "" },
        approvalRules: { requireOwnerApprovalFor: [], approvalNotes: "" },
        reportingPreferences: { cadence: "", metrics: [], recipients: [], notes: "" },
        completeness: { score: 50, completed: ["business"], blockers: ["Choose services/packages."], nextAction: "Choose services." },
        updatedAt: generatedAt,
        updatedBy: "test",
      },
    ],
    audit: [],
  } as any,
  crm: {
    schemaVersion: 1,
    tenantId: "dev-org-chicagoshots",
    version: 3,
    checksum: "crm-checksum",
    updatedAt: generatedAt,
    updatedBy: "test",
    leads: [
      { id: "lead-1", status: "follow-up", due: "2026-07-13T17:00:00.000Z", value: 2500, company: "Studio", name: "Studio", source: "Manual", segment: "creator" },
      { id: "lead-2", status: "proposal", due: "2026-07-14T17:00:00.000Z", value: 1500, company: "Gym", name: "Gym", source: "Manual", segment: "fitness" },
      { id: "lead-3", status: "lost", due: "2026-07-12T17:00:00.000Z", value: 1000, company: "Lost", name: "Lost", source: "Manual", segment: "old" },
    ],
    audit: [],
  } as any,
  proposals: {
    schemaVersion: 1,
    tenantId: "dev-org-chicagoshots",
    version: 2,
    checksum: "proposal-checksum",
    updatedAt: generatedAt,
    updatedBy: "test",
    proposals: [
      { id: "prop-1", status: "draft", price: 2000, client: "Studio" },
      { id: "prop-2", status: "sent-ready", price: 3000, client: "Gym" },
      { id: "prop-3", status: "won", price: 5000, client: "Venue" },
    ],
    audit: [],
  } as any,
  approvals: {
    schemaVersion: 1,
    tenantId: "dev-org-chicagoshots",
    version: 5,
    checksum: "approval-checksum",
    updatedAt: generatedAt,
    updatedBy: "test",
    approvals: [
      { id: "approval-1", status: "pending", title: "Review post" },
      { id: "approval-2", status: "changes-requested", title: "Revise booking" },
    ],
    audit: [],
  } as any,
});

const metric = (id: string) => report.metrics.find((row) => row.id === id);
const module = (id: string) => report.modules.find((row) => row.id === id);

assert.equal(report.schemaVersion, 1);
assert.equal(report.tenantId, "dev-org-chicagoshots");
assert.equal(metric("open_leads")?.value, 2);
assert.equal(metric("follow_ups_due")?.value, 1);
assert.equal(metric("proposal_pipeline")?.value, 5000);
assert.equal(metric("won_value")?.value, 5000);
assert.equal(metric("pending_approvals")?.value, 1);
assert.equal(metric("setup_completeness")?.value, 65);
assert.equal(metric("enabled_lead_sources")?.value, 0);
assert.equal(report.setup.activeConfigured, 1);
assert.equal(report.setup.pendingConfigured, 1);
assert.equal(report.safety.providerCalled, false);
assert.equal(report.safety.outboundActionExecuted, false);
assert.equal(report.safety.publicExposureChanged, false);
assert.equal(report.safety.socialAnalyticsStatus, "not_connected_here");
assert.equal(report.modules.length, 10);
assert.equal(module("lead_queue")?.label, "Lead Queue");
assert.equal(module("lead_queue")?.signalCount, 2);
assert.equal(module("follow_up_queue")?.status, "needs_action");
assert.equal(module("approval_queue")?.surface, "approvals");
assert.equal(module("approval_queue")?.status, "needs_action");
assert.equal(module("content_calendar")?.surface, "content");
assert.equal(module("content_calendar")?.status, "needs_setup");
assert.equal(module("media_assets")?.source, "client_setup");
assert.equal(module("employee_tasks")?.surface, "workforce");
assert.equal(module("business_cleanup")?.status, "needs_action");
assert(module("client_requests")?.detail.includes("dedicated request records are not counted"));
assert(report.blockers.some((row) => row.id === "client_setup_active_slots"));
assert(report.blockers.some((row) => row.id === "follow_ups_due" && row.severity === "critical"));
assert(report.blockers.some((row) => row.id === "social_analytics_disconnected"));
assert(report.nextActions.some((row) => row.surface === "approvals"));
assert(report.nextActions.some((row) => row.surface === "crm" && row.requiresApproval));
assert.equal(report.sourceDocuments.length, 4);

console.log(JSON.stringify({ ok: true, metrics: report.metrics.length, modules: report.modules.length, blockers: report.blockers.length, actions: report.nextActions.length }));
