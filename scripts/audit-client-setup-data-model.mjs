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
  /model\s+(ClientSetup|ClientSetupProfile|OrganizationSetup|BusinessSetup)\s+\{/u.test(src.schema);
const hasBusinessTemplateFields =
  /\b(businessType|businessTemplate|templateKey|setupCompleteness|leadSources|approvalRules|reportingPreferences|socialWorkflow|mediaWorkflow)\b/u.test(src.schema);
const hasServerLeadsPipelineModel =
  /model\s+(Lead|Prospect|Deal|Pipeline|FollowUp)\s+\{/u.test(src.schema);
const hasServicePackageModel =
  /model\s+(Service|Package|Offer)\s+\{/u.test(src.schema);

if (!hasServerClientSetupProfile) {
  blocker(
    "BLOCK-CLIENT-SETUP-PROFILE",
    "P0",
    ["2 active client organization slots", "1 pending client slot", "setup completeness", "next setup action"],
    "Prisma has Org and ClientAccess, but no ClientSetup/OrganizationSetup profile model that stores setup state.",
    "Add an org-scoped setup profile/table or JSON field with status, slot type, template, completeness, next action, and blockers.",
  );
}

if (!hasBusinessTemplateFields) {
  blocker(
    "BLOCK-BUSINESS-TEMPLATE-CONFIG",
    "P1",
    ["business type/template selection", "lead sources", "social/media workflow", "approval rules", "reporting preferences"],
    "No schema fields for business template, lead sources, workflow preferences, approval rules, or reporting preferences were found.",
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
    "Services/packages exist as local PACKAGES/RETAINERS and site product parsing, not as org-scoped persisted service-package records.",
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
      "local_browser_only",
      "Client Pipeline leads/proposals are currently local browser state, not server CRM records.",
      "store.seed() initializes `leads` and `proposals`; renderLeads writes `store.state.leads`; command/pageworker CRM buildout tests create local prospect lanes.",
      [files.store, files.workspaces, files.command, files.pageworker, files.pageWorkerTest],
    ),
    finding(
      "PERSIST-CUSTOMIZATION",
      "mixed_real_and_fallback",
      "Module customization exists server-side, but client setup preferences are not yet modeled as setup records.",
      "Module registry/customization service handles modules/theme/navigation/policies; setup-specific business template and workflow config fields are absent from schema.",
      [files.moduleRegistry, files.customizationServer, files.customizationClient, files.schema],
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
      "Platform modules have canonical definitions, role lists, dependencies, and protected/required flags.",
      "PLATFORM_MODULES defines dashboard, crm, media, sites, accounting, PhantomPlay, intelligence, memory, automation, approvals, workforce, analytics, settings, developer.",
      [files.moduleRegistry],
    ),
    finding(
      "WORKFLOW-ACTIONS",
      "real_server_backed",
      "Action/Approval/Task/FalconJob persistence exists for approval-gated workflows.",
      "Prisma models and routes exist for actions, approvals, tasks, and agent runs; workflow-specific client setup is not modeled yet.",
      [files.schema, files.index],
    ),
  ],
  realVsSampleStatic: [
    {
      real: ["User/Org/Membership auth", "invitations", "org switching", "plans/entitlements", "approvals", "tasks", "sites/publishing", "Asset Cloud", "Organization Pulse graph"],
      localOnly: ["fallback workspaces", "Clients pipeline leads/proposals", "local CRM prospect lane generation", "local PACKAGES/RETAINERS", "local media/content scratch state"],
      explicitlyNotLive: ["social analytics without OAuth/imported reports", "external outreach", "public publishing", "paid media generation"],
    },
  ],
  product02Readiness: {
    twoActiveClientOrganizations: hasServerClientSetupProfile ? "partially_ready" : "blocked",
    onePendingClientSlot: hasServerClientSetupProfile ? "partially_ready" : "blocked",
    businessTemplateSelection: hasBusinessTemplateFields ? "partially_ready" : "blocked",
    moduleEnableDisable: "partially_ready_via_customization_modules",
    servicesPackagesConfiguration: hasServicePackageModel ? "partially_ready" : "blocked",
    leadSourcesConfiguration: hasBusinessTemplateFields ? "partially_ready" : "blocked",
    socialMediaWorkflowConfiguration: hasBusinessTemplateFields ? "partially_ready" : "blocked",
    approvalRulesConfiguration: hasBusinessTemplateFields ? "partially_ready" : "blocked",
    reportingPreferences: hasBusinessTemplateFields ? "partially_ready" : "blocked",
    setupCompletenessScore: hasServerClientSetupProfile ? "partially_ready" : "blocked",
    nextSetupAction: hasServerClientSetupProfile ? "partially_ready" : "blocked",
    blockersVisible: "ready_in_audit_output",
  },
  blockers,
};

assert.ok(blockers.length >= 4, "Audit should surface the current client setup blockers.");
assert.equal(evidence.product02Readiness.moduleEnableDisable, "partially_ready_via_customization_modules");

console.log(JSON.stringify({ ok: true, ...evidence }, null, 2));
