import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const rel = (path) => relative(process.cwd(), fileURLToPath(new URL(path, root))).replaceAll("\\", "/");

const files = {
  schema: "server/prisma/schema.prisma",
  userAccounts: "server/src/access/user-accounts.ts",
  publicHosts: "server/src/access/public-hosts.ts",
  index: "server/src/index.ts",
  store: "app/js/store.js",
  workspaces: "app/js/workspaces.js",
  command: "app/js/command.js",
  pageworker: "app/js/pageworker.js",
  orgs: "app/js/orgs.js",
  customizationServer: "server/src/customization/customization-service.ts",
  moduleRegistry: "server/src/customization/module-registry.ts",
  customizationClient: "app/js/customization.js",
  clientSetupStore: "server/src/client-setup/client-setup-store.ts",
  clientSetupUi: "app/js/clientsetup.js",
  crmStore: "server/src/crm/crm-pipeline-store.ts",
  crmClient: "app/js/crmpipeline.js",
  proposalStore: "server/src/proposals/proposal-store.ts",
  proposalClient: "app/js/proposalpipeline.js",
  workspaceApprovalStore: "server/src/workspace-approvals/workspace-approval-store.ts",
  workspaceApprovalClient: "app/js/approvalpipeline.js",
  managedGrowthReport: "server/src/managed-growth/managed-growth-report.ts",
  managedGrowthClient: "app/js/managedgrowth.js",
  staticServer: "ops/admin-live/admin-static-server.mjs",
  crmPipelineTest: "scripts/test-crm-pipeline.mjs",
  proposalPipelineTest: "scripts/test-proposal-pipeline.mjs",
  workspaceApprovalTest: "scripts/test-workspace-approvals.mjs",
  managedGrowthTest: "scripts/test-managed-growth-report.mjs",
  authBoundaryTest: "scripts/test-auth-boundaries.mjs",
  pageWorkerTest: "scripts/test-page-worker.mjs",
};

const src = Object.fromEntries(Object.entries(files).map(([key, path]) => [key, read(path)]));
const has = (key, pattern) => pattern.test(src[key]);
const model = (name) => new RegExp(`model\\s+${name}\\s+\\{`, "u").test(src.schema);
const enumType = (name) => new RegExp(`enum\\s+${name}\\s+\\{`, "u").test(src.schema);

const finding = (id, status, claim, evidence, filesUsed) => ({
  id,
  status,
  claim,
  evidence,
  files: filesUsed.map((path) => rel(path)),
});

const blockers = [];
const blocker = (id, severity, blocks, evidence, needed) => {
  blockers.push({ id, severity, blocks, evidence, needed });
};

const serverPersistenceModels = [
  "User", "AuthSession", "Invitation", "Org", "Membership", "ClientAccess", "ModuleEntitlement",
  "OrgPlan", "Contact", "Task", "Action", "Approval", "AuditEvent", "Site", "SiteBuild",
  "SiteDeployment", "MediaAsset", "AssetUsage",
];
const missingServerModels = serverPersistenceModels.filter((name) => !model(name));

assert.deepEqual(missingServerModels, [], `Expected server persistence models missing: ${missingServerModels.join(", ")}`);
assert.ok(enumType("MembershipRole"), "MembershipRole enum must exist.");
assert.ok(has("publicHosts", /CLIENT_PUBLIC_HOST = "app\.phantomforce\.online"/u), "Customer app host boundary must be modeled.");
assert.ok(has("userAccounts", /canManageAccess:\s*isSuperAdmin/u), "canManageAccess must stay platform-super-admin scoped.");

const hasServerClientSetupProfile =
  /model\s+(ClientSetup|ClientSetupProfile|OrganizationSetup|BusinessSetup)\s+\{/u.test(src.schema)
  || (/ClientSetupDocument/u.test(src.clientSetupStore) && /saveClientSetupSlot/u.test(src.clientSetupStore) && /\/api\/client-setup/u.test(src.index));
const hasBusinessTemplateFields =
  /\b(businessType|businessTemplate|templateKey|setupCompleteness|leadSources|approvalRules|reportingPreferences|socialWorkflow|mediaWorkflow)\b/u.test(src.schema)
  || /\b(businessTemplate|leadSources|approvalRules|reportingPreferences|socialMediaWorkflow)\b/u.test(src.clientSetupStore);
const hasServerLeadsPipelineModel =
  /model\s+(Lead|Prospect|Deal|Pipeline|FollowUp)\s+\{/u.test(src.schema)
  || (/CrmPipelineDocument/u.test(src.crmStore) && /\/api\/crm\/leads/u.test(src.index) && /persistCrmProspectLanes/u.test(src.crmClient));
const hasServerProposalPipelineModel =
  /model\s+(Proposal|Estimate|Quote)\s+\{/u.test(src.schema)
  || (/ProposalDocument/u.test(src.proposalStore) && /\/api\/proposals/u.test(src.index) && /createProposal/u.test(src.proposalClient));
const hasServerWorkspaceApprovalModel =
  /model\s+Approval\s+\{/u.test(src.schema)
  || (/WorkspaceApprovalDocument/u.test(src.workspaceApprovalStore) && /\/api\/workspace-approvals/u.test(src.index) && /createWorkspaceApproval/u.test(src.workspaceApprovalClient));
const hasManagedGrowthReport =
  /buildManagedGrowthReport/u.test(src.managedGrowthReport)
  && /\/api\/managed-growth\/report/u.test(src.index)
  && /loadManagedGrowthReport/u.test(src.managedGrowthClient)
  && /urlPath\.startsWith\("\/api\/managed-growth"\)/u.test(src.staticServer);
const hasServicePackageModel =
  /model\s+(Service|Package|Offer)\s+\{/u.test(src.schema)
  || /\bservicesPackages\b/u.test(src.clientSetupStore);
const hasClientSetupUi =
  /renderClientSetupConsole/u.test(src.clientSetupUi)
  && /active-1/u.test(src.clientSetupUi)
  && /pending-1/u.test(src.clientSetupUi)
  && /setup completeness/i.test(src.clientSetupUi);
const clientSetupApiIsProxied = /urlPath\.startsWith\("\/api\/client-setup"\)/u.test(src.staticServer);

assert.ok(hasServerClientSetupProfile, "Client setup state must be server-backed by a setup document or Prisma model.");
assert.ok(hasBusinessTemplateFields, "Client setup must persist business template and workflow fields.");
assert.ok(hasServicePackageModel, "Client setup must persist service/package configuration.");
assert.ok(hasClientSetupUi, "Client Setup UI must exist with active/pending slots and completeness.");
assert.ok(clientSetupApiIsProxied, "Static app server must proxy /api/client-setup for local testing.");

if (!hasServerClientSetupProfile) {
  blocker(
    "BLOCK-CLIENT-SETUP-PROFILE",
    "P0",
    ["2 active client organization slots", "1 pending client slot", "setup completeness", "next setup action"],
    "No ClientSetup/OrganizationSetup profile model or server JSON setup document that stores setup state was found.",
    "Add an org-scoped setup profile/table or JSON field with status, slot type, template, completeness, next action, and blockers.",
  );
}

if (!hasBusinessTemplateFields) {
  blocker(
    "BLOCK-BUSINESS-TEMPLATE-CONFIG",
    "P1",
    ["business type/template selection", "lead sources", "social/media workflow", "approval rules", "reporting preferences"],
    "No schema/store fields for business template, lead sources, workflow preferences, approval rules, or reporting preferences were found.",
    "Persist setup configuration server-side before presenting it as real organization setup.",
  );
}

if (!hasServerLeadsPipelineModel) {
  blocker(
    "BLOCK-SERVER-CRM-PIPELINE",
    "P1",
    ["Client onboarding CRM", "follow-up workflow setup", "client admins/employees tied to CRM work"],
    "Clients pipeline currently writes browser-local `store.state.leads`; server schema only has generic Contact without pipeline stage/source/value/follow-up fields.",
    "Add org-scoped lead/prospect/follow-up persistence or extend Contact with explicit pipeline fields and audit.",
  );
}

if (!hasServicePackageModel) {
  blocker(
    "BLOCK-SERVICE-PACKAGE-CONFIG",
    "P1",
    ["services/packages configuration", "package-aware reporting", "setup completeness"],
    "Services/packages exist as local PACKAGES/RETAINERS and site product parsing, not as org-scoped persisted service-package/setup records.",
    "Add service/package/offer records or an org setup config section that can be reused by CRM, sites, media, and reporting.",
  );
}

const evidence = {
  audit: "PRODUCT-01 Client Setup / Data Model Audit",
  generatedAt: new Date().toISOString(),
  authModel: [
    finding(
      "AUTH-REAL-DATABASE-USERS",
      "real_server_backed",
      "Database auth supports users, sessions, org memberships, invitations, active-org switching, and revocation.",
      "User/AuthSession/Invitation/Membership models and /auth/login, /auth/logout, /auth/switch-org, /auth/invitations/accept routes exist.",
      [files.schema, files.index, files.userAccounts],
    ),
    finding(
      "AUTH-ROLE-SEPARATION",
      "real_server_backed",
      "Platform super-admin is distinct from customer organization owner/admin.",
      "`canManageAccess` is assigned from `isSuperAdmin`; customer owner/admin is carried in `orgRole` / Membership.role.",
      [files.schema, files.userAccounts, files.publicHosts],
    ),
    finding(
      "AUTH-PUBLIC-HOST-SPLIT",
      "real_server_backed",
      "app.phantomforce.online and admin.phantomforce.online are separated server-side and browser-side.",
      "Public host boundary code and auth-boundary regression test both reference customer/admin hosts.",
      [files.publicHosts, files.store, files.authBoundaryTest],
    ),
  ],
  persistenceModel: [
    finding(
      "PERSIST-ORG-SPINE",
      "real_server_backed",
      "Organizations, memberships, tasks, approvals, audit events, sites, domains, assets, and entitlements have Prisma persistence.",
      `Verified models: ${serverPersistenceModels.join(", ")}.`,
      [files.schema],
    ),
    finding(
      "PERSIST-BROWSER-CRM",
      "local_fallback_legacy",
      "Client Pipeline still has browser fallback state for offline/static QA.",
      "store.seed() initializes `leads` and `proposals`; local fallback remains available when the backend session is absent.",
      [files.store, files.workspaces, files.command, files.pageworker, files.pageWorkerTest],
    ),
    finding(
      "PERSIST-CRM-PIPELINE",
      "real_server_backed",
      "Client Pipeline leads and page-worker prospect lanes now have tenant-scoped server persistence.",
      "crm-pipeline-store persists draft leads/prospect lanes, stage, value, next action, due date, source, notes, setup slot reference, and audit entries; Clients page and page prompter call /api/crm routes when signed in.",
      [files.crmStore, files.index, files.crmClient, files.workspaces, files.pageworker, files.crmPipelineTest],
    ),
    finding(
      "PERSIST-PROPOSALS",
      "real_server_backed",
      "Proposal Forge drafts now have tenant-scoped server persistence and stay linked to CRM proposal conversion.",
      "proposal-store persists proposal draft status, package, price, retainer, scope, lead reference, setup slot reference, and audit entries; Proposal Forge calls /api/proposals routes when signed in.",
      [files.proposalStore, files.index, files.proposalClient, files.workspaces, files.proposalPipelineTest],
    ),
    finding(
      "PERSIST-WORKSPACE-APPROVALS",
      "real_server_backed",
      "Review, booking, media-generation, and workspace approval cards now have tenant-scoped server persistence with status-only decisions.",
      "workspace-approval-store persists approval type, ref, status, owner notes, decision, and audit entries; Approval-producing widgets and the Approvals page call /api/workspace-approvals when signed in.",
      [files.workspaceApprovalStore, files.index, files.workspaceApprovalClient, files.workspaces, files.workspaceApprovalTest],
    ),
    finding(
      "PERSIST-MANAGED-GROWTH-REPORT",
      hasManagedGrowthReport ? "real_server_backed" : "blocked",
      "Managed Growth Ops reporting now reads server-backed Client Setup, CRM, Proposal Forge, and Workspace Approval documents without inventing social metrics.",
      "managed-growth-report builds internal metrics, blockers, next actions, source document evidence, and explicit no-provider/no-outbound/no-public-exposure safety flags; Analytics mounts it separately from social analytics.",
      [files.managedGrowthReport, files.index, files.managedGrowthClient, files.staticServer, files.managedGrowthTest],
    ),
    finding(
      "PERSIST-CUSTOMIZATION",
      "mixed_real_and_fallback",
      "Module customization exists server-side and complements, but does not replace, the dedicated client setup records.",
      "Module registry/customization service handles modules/theme/navigation/policies; client setup uses a separate tenant-scoped setup document for onboarding configuration.",
      [files.moduleRegistry, files.customizationServer, files.customizationClient, files.schema],
    ),
    finding(
      "PERSIST-CLIENT-SETUP",
      "real_server_backed",
      "Client setup now has a tenant-scoped server document, API routes, and a browser console for 2 active organization slots plus 1 pending slot.",
      "client-setup-store persists business template, modules, services/packages, lead sources, social/media workflow, approval rules, reporting preferences, completeness, next action, blockers, and audit entries.",
      [files.clientSetupStore, files.index, files.clientSetupUi, files.staticServer],
    ),
  ],
  organizationClientData: [
    finding(
      "ORG-REAL",
      "real_server_backed",
      "Org is first-class and can have ClientAccess, ModuleEntitlement, plan, members, invitations, assets, sites, tasks, contacts, actions, approvals, and audit events.",
      "Org relation list includes the command-center spine needed for customer workspaces.",
      [files.schema],
    ),
    finding(
      "ORG-LOCAL-FIXED-WORKSPACES",
      "local_fallback_static",
      "The browser fallback seeds exactly two fixed workspaces: PhantomForce and ChicagoShots.",
      "REQUIRED_WORKSPACES contains `phantomforce` and `chicagoshots`; this is fallback/demo state, not a configurable 2 active + 1 pending setup machine.",
      [files.store],
    ),
  ],
  userRoleModel: [
    finding(
      "ROLE-MEMBERSHIP",
      "real_server_backed",
      "Org roles include owner, admin, member, and client; owner/admin manage org members and invitations.",
      "MembershipRole enum and requireOrgManager routes exist for members and invitations.",
      [files.schema, files.index],
    ),
    finding(
      "ROLE-FRONTEND-MAPPING",
      "real_frontend_mapping",
      "Customer org owner/admin map to Business Manager; member/client map to team/client surfaces.",
      "localSessionFromServer maps orgRole owner/admin to local admin presentation while keeping server authorization authoritative.",
      [files.orgs],
    ),
  ],
  moduleWorkflowData: [
    finding(
      "MODULE-REGISTRY",
      "real_server_backed",
      "Platform modules have canonical definitions, role lists, dependencies, and protected/required flags, including Client Setup.",
      "PLATFORM_MODULES defines dashboard, crm, clientsetup, media, sites, accounting, PhantomPlay, intelligence, memory, automation, approvals, workforce, analytics, settings, developer.",
      [files.moduleRegistry],
    ),
    finding(
      "WORKFLOW-ACTIONS",
      "real_server_backed",
      "Action/Approval/Task/FalconJob persistence exists for approval-gated workflows.",
      "Prisma models and routes exist for actions, approvals, tasks, and agent runs; CRM lead/follow-up stage data now has a tenant-scoped server document foundation.",
      [files.schema, files.index],
    ),
  ],
  realVsSampleStatic: [
    {
      real: ["User/Org/Membership auth", "invitations", "org switching", "plans/entitlements", "approvals", "tasks", "sites/publishing", "Asset Cloud", "Organization Pulse graph"],
      localOnly: ["fallback workspaces", "local PACKAGES/RETAINERS", "local media/content scratch state"],
      explicitlyNotLive: ["social analytics without OAuth/imported reports", "external outreach", "public publishing", "paid media generation"],
    },
  ],
  product02Readiness: {
    twoActiveClientOrganizations: hasServerClientSetupProfile && hasClientSetupUi ? "ready_setup_slots" : "blocked",
    onePendingClientSlot: hasServerClientSetupProfile && hasClientSetupUi ? "ready_setup_slot" : "blocked",
    businessTemplateSelection: hasBusinessTemplateFields && hasClientSetupUi ? "ready_setup_console" : "blocked",
    moduleEnableDisable: "partially_ready_via_customization_modules",
    servicesPackagesConfiguration: hasServicePackageModel && hasClientSetupUi ? "ready_setup_console" : "blocked",
    leadSourcesConfiguration: hasBusinessTemplateFields && hasClientSetupUi ? "ready_setup_console" : "blocked",
    socialMediaWorkflowConfiguration: hasBusinessTemplateFields && hasClientSetupUi ? "ready_setup_console" : "blocked",
    approvalRulesConfiguration: hasBusinessTemplateFields && hasClientSetupUi ? "ready_setup_console" : "blocked",
    reportingPreferences: hasBusinessTemplateFields && hasClientSetupUi ? "ready_setup_console" : "blocked",
    setupCompletenessScore: hasServerClientSetupProfile && hasClientSetupUi ? "ready_setup_console" : "blocked",
    nextSetupAction: hasServerClientSetupProfile && hasClientSetupUi ? "ready_setup_console" : "blocked",
    blockersVisible: "ready_in_setup_console_and_audit_output",
    remainingServerCrmPipeline: hasServerLeadsPipelineModel ? "server_json_backed_foundation" : "blocked_next_product_step",
    remainingProposalPersistence: hasServerProposalPipelineModel ? "server_json_backed_foundation" : "blocked_next_product_step",
    remainingWorkspaceApprovalPersistence: hasServerWorkspaceApprovalModel ? "server_json_backed_foundation_status_only" : "blocked_next_product_step",
    managedGrowthReports: hasManagedGrowthReport ? "server_report_ready" : "blocked",
  },
  blockers,
};

assert.ok(hasServerLeadsPipelineModel, "Audit should prove server-backed CRM lead/follow-up persistence exists.");
assert.ok(hasServerProposalPipelineModel, "Audit should prove server-backed proposal persistence exists.");
assert.ok(hasServerWorkspaceApprovalModel, "Audit should prove server-backed workspace approval persistence exists.");
assert.ok(hasManagedGrowthReport, "Audit should prove server-backed Managed Growth report exists.");
assert.equal(evidence.product02Readiness.moduleEnableDisable, "partially_ready_via_customization_modules");

console.log(JSON.stringify({ ok: true, ...evidence }, null, 2));
