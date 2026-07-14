import { z } from "zod";

import { PLATFORM_MODULES } from "./module-registry.js";

export const BrandModeSchema = z.enum(["standard", "co_branded", "white_label", "internal_phantomforce"]);
export const WorkspaceProfileSchema = z.enum(["business", "creator", "developer"]);
export const BrainStorageModeSchema = z.enum(["web_only", "optional_local", "external_provider"]);
export const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hex color such as #41ffa1.");
export const ApprovedFontSchema = z.enum(["Space Grotesk", "Inter", "DM Sans", "IBM Plex Sans", "Source Sans 3"]);
export const SurfaceStyleSchema = z.enum(["glass", "solid", "soft"]);
export const DensitySchema = z.enum(["comfortable", "compact"]);

const SafeLabelSchema = z.string().trim().min(1).max(40).refine((value) => !/[<>]/.test(value), "Labels cannot contain HTML.");
const SafeTextSchema = z.string().trim().max(600).refine((value) => !/<\/?(?:script|style|iframe|object|embed)\b/i.test(value), "Executable or embedded HTML is not allowed.");
const SafeAssetUrlSchema = z.string().trim().max(500).refine((value) => value === "" || value.startsWith("/app/assets/") || /^https:\/\//i.test(value), "Assets must use HTTPS or the approved PhantomForce asset path.");

export const OrganizationBrandSchema = z.object({
  mode: BrandModeSchema.default("standard"),
  organizationName: SafeLabelSchema.default("My Business"),
  workspaceName: SafeLabelSchema.default("Dashboard"),
  logoUrl: SafeAssetUrlSchema.default(""),
  faviconUrl: SafeAssetUrlSchema.default(""),
  loginBackgroundUrl: SafeAssetUrlSchema.default(""),
  poweredByPhantomForce: z.literal(true).default(true),
}).strict();

export const OrganizationThemeSchema = z.object({
  colorMode: z.enum(["dark", "light", "system"]).default("dark"),
  primary: HexColorSchema.default("#41ffa1"),
  secondary: HexColorSchema.default("#16d9c9"),
  accent: HexColorSchema.default("#ffd166"),
  surfaceStyle: SurfaceStyleSchema.default("glass"),
  font: ApprovedFontSchema.default("Space Grotesk"),
  radius: z.number().int().min(4).max(20).default(12),
  density: DensitySchema.default("comfortable"),
}).strict();

export const ModuleConfigurationSchema = z.object({
  id: z.string().trim().min(1).max(60),
  label: SafeLabelSchema,
  enabled: z.boolean(),
  order: z.number().int().min(0).max(1000),
  roles: z.array(z.enum(["owner", "admin", "manager", "member", "client"])).min(1).max(5),
});

export const NavigationConfigurationSchema = z.object({
  homeModuleId: z.string().trim().min(1).max(60).default("dashboard"),
  compact: z.boolean().default(false),
}).strict();

export const AssistantConfigurationSchema = z.object({
  displayName: SafeLabelSchema.default("Phantom"),
  tone: z.enum(["direct", "professional", "friendly", "energetic", "concise"]).default("direct"),
  detail: z.enum(["brief", "balanced", "detailed"]).default("balanced"),
  instructions: SafeTextSchema.default(""),
}).strict();

export const CustomFieldTypeSchema = z.enum([
  "short_text", "long_text", "number", "currency", "percentage", "date", "datetime", "checkbox",
  "select", "multi_select", "email", "phone", "url", "file_reference", "user_reference",
  "organization_reference", "relationship", "status", "formula", "ai_summary", "calculated",
]);

export const CustomFieldSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
  label: SafeLabelSchema,
  type: CustomFieldTypeSchema,
  required: z.boolean().default(false),
  options: z.array(SafeLabelSchema).max(50).default([]),
  relationshipObjectId: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/).optional(),
  formula: z.string().trim().max(240).regex(/^[a-zA-Z0-9_+\-*/()., %]*$/, "Formula uses unsupported characters.").optional(),
  readOnly: z.boolean().default(false),
});

export const CustomObjectSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
  singularLabel: SafeLabelSchema,
  pluralLabel: SafeLabelSchema,
  icon: z.string().trim().max(30).default("db"),
  fields: z.array(CustomFieldSchema).max(80).default([]),
  rolePermissions: z.record(z.array(z.enum(["view", "create", "edit", "delete", "export"]))).default({}),
});

export const FormSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
  name: SafeLabelSchema,
  objectId: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
  fieldIds: z.array(z.string().regex(/^[a-z][a-z0-9_]{1,39}$/)).max(80),
  public: z.boolean().default(false),
  confirmation: SafeTextSchema.default("Thanks. Your information was received."),
  requiresAbuseProtection: z.boolean().default(true),
});

export const DashboardWidgetSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
  type: z.enum(["metric", "list", "table", "activity", "approvals", "tasks", "pipeline", "calendar", "chart", "notifications", "quick_actions", "saved_view", "ai_briefing", "object_summary", "media_status", "website_status", "workflow_status"]),
  title: SafeLabelSchema,
  source: z.string().trim().min(1).max(80),
});

export const DashboardSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
  name: SafeLabelSchema,
  scope: z.enum(["owner", "admin", "manager", "member", "client"]),
  widgets: z.array(DashboardWidgetSchema).max(30),
});

export const WorkflowSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
  name: SafeLabelSchema,
  enabled: z.boolean().default(false),
  trigger: z.enum(["record_created", "record_updated", "schedule", "form_submitted", "manual"]),
  actions: z.array(z.object({
    type: z.enum(["internal_update", "ai_draft", "notify", "request_approval", "connector_action"]),
    target: z.string().trim().max(100),
    requiresApproval: z.boolean().default(true),
  })).max(30),
});

export const ApprovedExtensionSchema = z.object({
  extensionId: z.string().regex(/^[a-z][a-z0-9_.-]{2,79}$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  enabled: z.boolean().default(false),
  grantedPermissions: z.array(z.enum(["read_records", "write_records", "render_widget", "workflow_action", "network_approved"])).max(10),
});

export const OrganizationPolicySchema = z.object({
  requireApprovalForOutbound: z.literal(true).default(true),
  requireApprovalForDestructive: z.literal(true).default(true),
  approvalThreshold: z.enum(["all_external", "medium_and_up", "high_and_up"]).default("all_external"),
  workspaceProfile: WorkspaceProfileSchema.default("business"),
  brainStorageMode: BrainStorageModeSchema.default("web_only"),
  localBrainInstall: z.enum(["never_silent", "optional_prompt"]).default("never_silent"),
  apiCredentialPolicy: z.literal("tenant_owned_only").default("tenant_owned_only"),
  subscriptionPolicy: z.literal("tenant_owned_only").default("tenant_owned_only"),
  historyPolicy: z.enum(["workspace_scoped", "provider_managed_when_connected"]).default("workspace_scoped"),
}).strict();

export const OrganizationConfigurationSchema = z.object({
  schemaVersion: z.literal(1),
  tenantId: z.string().trim().min(1).max(80),
  version: z.number().int().min(1),
  brand: OrganizationBrandSchema,
  theme: OrganizationThemeSchema,
  terminology: z.record(SafeLabelSchema).default({}),
  modules: z.array(ModuleConfigurationSchema).max(PLATFORM_MODULES.length),
  navigation: NavigationConfigurationSchema,
  assistant: AssistantConfigurationSchema,
  dashboards: z.array(DashboardSchema).max(20).default([]),
  customObjects: z.array(CustomObjectSchema).max(50).default([]),
  forms: z.array(FormSchema).max(100).default([]),
  workflows: z.array(WorkflowSchema).max(100).default([]),
  extensions: z.array(ApprovedExtensionSchema).max(30).default([]),
  policies: OrganizationPolicySchema,
  updatedAt: z.string().datetime(),
  updatedBy: z.string().trim().min(1).max(100),
});

export const ConfigurationPatchSchema = z.object({
  brand: OrganizationBrandSchema.partial().optional(),
  theme: OrganizationThemeSchema.partial().optional(),
  terminology: z.record(SafeLabelSchema).optional(),
  modules: z.array(ModuleConfigurationSchema).optional(),
  navigation: NavigationConfigurationSchema.partial().optional(),
  assistant: AssistantConfigurationSchema.partial().optional(),
  dashboards: z.array(DashboardSchema).max(20).optional(),
  customObjects: z.array(CustomObjectSchema).max(50).optional(),
  forms: z.array(FormSchema).max(100).optional(),
  workflows: z.array(WorkflowSchema).max(100).optional(),
  extensions: z.array(ApprovedExtensionSchema).max(30).optional(),
  policies: OrganizationPolicySchema.partial().optional(),
}).strict();

export type OrganizationConfiguration = z.infer<typeof OrganizationConfigurationSchema>;
export type ConfigurationPatch = z.infer<typeof ConfigurationPatchSchema>;
