import { z } from "zod";

import { MODULE_BY_ID, PLATFORM_MODULES, REQUIRED_MODULE_IDS } from "./module-registry.js";
import {
  ConfigurationPatchSchema,
  OrganizationConfigurationSchema,
  type ConfigurationPatch,
  type OrganizationConfiguration,
} from "./schemas.js";
import {
  persistConfiguration,
  readCustomizationDocument,
  type ConfigurationVersion,
} from "./customization-store.js";
import {
  workspaceProfileFor,
  type WorkspaceProfileId,
} from "./workspace-profiles.js";

const RESERVED_FIELD_IDS = new Set([
  "id", "tenant_id", "tenantid", "org_id", "orgid", "user_id", "userid", "permission", "permissions",
  "billing", "audit", "security_state", "owner_id", "created_at", "updated_at",
]);
const PROTECTED_TERMINOLOGY = new Set(["security", "billing", "approval", "error", "phantomforce", "platform_owner"]);

export type CustomizationEntitlements = {
  coBranded: boolean;
  whiteLabel: boolean;
  internalPhantomForce: boolean;
};

export type ValidationIssue = { path: string; message: string; severity: "error" | "warning" };

export function defaultOrganizationConfiguration(tenantId: string, actor = "system", profileId: WorkspaceProfileId = "business"): OrganizationConfiguration {
  const now = new Date().toISOString();
  const internal = tenantId === "phantomforce-owner" || tenantId === "phantomforce";
  const profile = internal ? workspaceProfileFor("business") : workspaceProfileFor(profileId);
  const enabledModules = new Set(internal ? PLATFORM_MODULES.map((module) => module.id) : profile.enabledModules);
  return OrganizationConfigurationSchema.parse({
    schemaVersion: 1,
    tenantId,
    version: 1,
    brand: {
      mode: internal ? "internal_phantomforce" : "standard",
      organizationName: internal ? "PhantomForce" : "My Business",
      workspaceName: internal ? "Dashboard" : profile.workspaceName,
      poweredByPhantomForce: true,
    },
    theme: {},
    terminology: {},
    modules: PLATFORM_MODULES.map((module, order) => ({
      id: module.id,
      label: module.displayName,
      enabled: module.required || enabledModules.has(module.id),
      order,
      roles: module.allowedRoles.includes("platform_owner")
        ? ["owner"]
        : module.allowedRoles,
    })),
    navigation: { homeModuleId: profile.homeModuleId },
    assistant: {},
    dashboards: [{ id: "owner_home", name: "Dashboard", scope: "owner", widgets: [
      { id: "daily_brief", type: "ai_briefing", title: "Daily brief", source: "phantom.briefing" },
      { id: "approval_queue", type: "approvals", title: "Needs attention", source: "approvals.pending" },
    ] }],
    customObjects: [],
    forms: [],
    workflows: [],
    extensions: [],
    policies: {
      workspaceProfile: internal ? "business" : profile.id,
      brainStorageMode: internal ? "optional_local" : profile.brainStorageMode,
      localBrainInstall: profile.localBrainInstall,
      apiCredentialPolicy: profile.apiCredentialPolicy,
      subscriptionPolicy: profile.subscriptionPolicy,
      historyPolicy: profile.historyPolicy,
    },
    updatedAt: now,
    updatedBy: actor,
  });
}

export function hydratePlatformModules(configuration: OrganizationConfiguration): OrganizationConfiguration {
  const internal = configuration.tenantId === "phantomforce-owner" || configuration.tenantId === "phantomforce";
  const profile = internal ? workspaceProfileFor("business") : workspaceProfileFor(configuration.policies.workspaceProfile);
  const enabledModules = new Set(internal ? PLATFORM_MODULES.map((module) => module.id) : profile.enabledModules);
  const existingById = new Map(configuration.modules.map((module) => [module.id, module]));
  const modules = PLATFORM_MODULES.map((definition, order) => {
    const roles = definition.allowedRoles.includes("platform_owner") ? ["owner"] : definition.allowedRoles;
    const existing = existingById.get(definition.id);
    if (!existing) {
      return {
        id: definition.id,
        label: definition.displayName,
        enabled: definition.required || enabledModules.has(definition.id),
        order,
        roles,
      };
    }
    return {
      id: definition.id,
      label: existing.label || definition.displayName,
      enabled: definition.required || existing.enabled,
      order: Number.isInteger(existing.order) ? existing.order : order,
      roles: existing.roles.length ? existing.roles : roles,
    };
  });
  return OrganizationConfigurationSchema.parse({ ...configuration, modules });
}

function mergeConfiguration(current: OrganizationConfiguration, patch: ConfigurationPatch, actor: string) {
  return {
    ...current,
    ...patch,
    brand: { ...current.brand, ...(patch.brand ?? {}) },
    theme: { ...current.theme, ...(patch.theme ?? {}) },
    navigation: { ...current.navigation, ...(patch.navigation ?? {}) },
    assistant: { ...current.assistant, ...(patch.assistant ?? {}) },
    policies: { ...current.policies, ...(patch.policies ?? {}) },
    terminology: patch.terminology ? { ...current.terminology, ...patch.terminology } : current.terminology,
    version: current.version + 1,
    updatedAt: new Date().toISOString(),
    updatedBy: actor,
  };
}

function hexRgb(hex: string) {
  return [Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16), Number.parseInt(hex.slice(5, 7), 16)];
}

function luminance(hex: string) {
  const channels = hexRgb(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

export function validateOrganizationConfiguration(configuration: OrganizationConfiguration, entitlements: CustomizationEntitlements): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (configuration.brand.mode === "white_label" && !entitlements.whiteLabel) issues.push({ path: "brand.mode", message: "White-label mode requires an enterprise entitlement.", severity: "error" });
  if (configuration.brand.mode === "co_branded" && !entitlements.coBranded && !entitlements.whiteLabel) issues.push({ path: "brand.mode", message: "Co-branded mode is not included in this organization plan.", severity: "error" });
  if (configuration.brand.mode === "internal_phantomforce" && !entitlements.internalPhantomForce) issues.push({ path: "brand.mode", message: "Internal PhantomForce mode is platform-owned.", severity: "error" });
  if (!configuration.brand.poweredByPhantomForce) issues.push({ path: "brand.poweredByPhantomForce", message: "PhantomForce attribution cannot be removed from this plan.", severity: "error" });

  const moduleIds = new Set(configuration.modules.map((module) => module.id));
  for (const requiredId of REQUIRED_MODULE_IDS) {
    const module = configuration.modules.find((candidate) => candidate.id === requiredId);
    if (!module?.enabled) issues.push({ path: `modules.${requiredId}`, message: `${MODULE_BY_ID.get(requiredId)?.displayName ?? requiredId} is required for access, approval, or recovery.`, severity: "error" });
  }
  for (const module of configuration.modules) {
    const definition = MODULE_BY_ID.get(module.id);
    if (!definition) issues.push({ path: `modules.${module.id}`, message: "Unknown platform module.", severity: "error" });
    if (!definition?.customerConfigurable && module.label !== definition?.displayName) issues.push({ path: `modules.${module.id}.label`, message: "This system label is protected.", severity: "error" });
    if (module.enabled) for (const dependency of definition?.dependencies ?? []) {
      const dependencyState = configuration.modules.find((candidate) => candidate.id === dependency);
      if (!dependencyState?.enabled) issues.push({ path: `modules.${module.id}`, message: `${module.label} requires ${MODULE_BY_ID.get(dependency)?.displayName ?? dependency}.`, severity: "error" });
    }
  }
  if (!moduleIds.has(configuration.navigation.homeModuleId) || !configuration.modules.find((module) => module.id === configuration.navigation.homeModuleId)?.enabled) {
    issues.push({ path: "navigation.homeModuleId", message: "The home page must be an enabled module.", severity: "error" });
  }

  for (const key of Object.keys(configuration.terminology)) if (PROTECTED_TERMINOLOGY.has(key.toLowerCase())) {
    issues.push({ path: `terminology.${key}`, message: "Security, billing, approval, error, and platform identity terms are protected.", severity: "error" });
  }
  const objectIds = new Set<string>();
  for (const object of configuration.customObjects) {
    if (objectIds.has(object.id)) issues.push({ path: `customObjects.${object.id}`, message: "Custom object IDs must be unique.", severity: "error" });
    objectIds.add(object.id);
    const fieldIds = new Set<string>();
    for (const field of object.fields) {
      if (RESERVED_FIELD_IDS.has(field.id.toLowerCase())) issues.push({ path: `customObjects.${object.id}.fields.${field.id}`, message: "This field name is reserved by the platform.", severity: "error" });
      if (fieldIds.has(field.id)) issues.push({ path: `customObjects.${object.id}.fields.${field.id}`, message: "Field IDs must be unique inside an object.", severity: "error" });
      fieldIds.add(field.id);
    }
  }
  for (const form of configuration.forms) {
    const object = configuration.customObjects.find((candidate) => candidate.id === form.objectId);
    if (!object) issues.push({ path: `forms.${form.id}.objectId`, message: "The form must target an existing custom object.", severity: "error" });
    const validFields = new Set(object?.fields.map((field) => field.id) ?? []);
    for (const fieldId of form.fieldIds) if (!validFields.has(fieldId)) issues.push({ path: `forms.${form.id}.fieldIds`, message: `Unknown field ${fieldId}.`, severity: "error" });
    if (form.public && !form.requiresAbuseProtection) issues.push({ path: `forms.${form.id}.requiresAbuseProtection`, message: "Public forms require abuse protection.", severity: "error" });
  }
  for (const workflow of configuration.workflows) for (const action of workflow.actions) {
    if ((action.type === "connector_action" || action.type === "notify") && !action.requiresApproval) issues.push({ path: `workflows.${workflow.id}`, message: "External connector and notification actions must remain approval-gated.", severity: "error" });
  }
  if (!configuration.policies.requireApprovalForOutbound || !configuration.policies.requireApprovalForDestructive) issues.push({ path: "policies", message: "Organization configuration cannot weaken platform approval enforcement.", severity: "error" });
  if (!["never_silent", "optional_prompt"].includes(configuration.policies.localBrainInstall)) issues.push({ path: "policies.localBrainInstall", message: "Local brain setup must never install silently; users must explicitly opt in.", severity: "error" });
  if (configuration.policies.apiCredentialPolicy !== "tenant_owned_only") issues.push({ path: "policies.apiCredentialPolicy", message: "Workspace API credentials must be owned by that tenant only.", severity: "error" });
  if (configuration.policies.subscriptionPolicy !== "tenant_owned_only") issues.push({ path: "policies.subscriptionPolicy", message: "Workspace subscriptions must be owned by that tenant only.", severity: "error" });
  if (configuration.policies.workspaceProfile === "developer") {
    const blocked = ["crm", "media", "sites", "money", "intelligence", "analytics", "automation", "vacation"];
    for (const moduleId of blocked) {
      if (configuration.modules.find((module) => module.id === moduleId)?.enabled) {
        issues.push({ path: `modules.${moduleId}`, message: "Developer workspaces can only enable developer-focused modules by default.", severity: "error" });
      }
    }
    if (configuration.policies.brainStorageMode !== "external_provider") issues.push({ path: "policies.brainStorageMode", message: "Developer workspaces should rely on connected provider history instead of duplicating a local brain.", severity: "error" });
    if (configuration.policies.historyPolicy !== "provider_managed_when_connected") issues.push({ path: "policies.historyPolicy", message: "Developer history should be provider-managed when a connected subscription already tracks it.", severity: "error" });
  }

  if (luminance(configuration.theme.primary) < 0.12 && configuration.theme.colorMode !== "light") issues.push({ path: "theme.primary", message: "The primary color is too dark to remain readable on the dark workspace.", severity: "warning" });
  return issues;
}

export async function getOrganizationConfiguration(tenantId: string, actor: string, root?: string) {
  const document = await readCustomizationDocument(tenantId, root);
  if (document) return { configuration: hydratePlatformModules(OrganizationConfigurationSchema.parse(document.current)), versions: document.versions, audit: document.audit };
  const configuration = defaultOrganizationConfiguration(tenantId, actor);
  const persisted = await persistConfiguration({ configuration, summary: "Created organization defaults", actor, eventType: "created", root });
  return { configuration, versions: persisted.document.versions, audit: persisted.document.audit };
}

export async function previewConfigurationChange(options: { tenantId: string; actor: string; patch: unknown; entitlements: CustomizationEntitlements; root?: string }) {
  const current = (await getOrganizationConfiguration(options.tenantId, options.actor, options.root)).configuration;
  const parsedPatch = ConfigurationPatchSchema.parse(options.patch);
  const candidate = OrganizationConfigurationSchema.parse(mergeConfiguration(current, parsedPatch, options.actor));
  const issues = validateOrganizationConfiguration(candidate, options.entitlements);
  const changedSections = Object.keys(parsedPatch);
  return {
    valid: !issues.some((issue) => issue.severity === "error"),
    currentVersion: current.version,
    proposedVersion: candidate.version,
    changedSections,
    reversible: true,
    requiresApproval: true,
    affectedScope: "entire_organization",
    issues,
    candidate,
  };
}

export async function publishConfigurationChange(options: { tenantId: string; actor: string; patch: unknown; summary: string; expectedVersion?: number; entitlements: CustomizationEntitlements; root?: string }) {
  const preview = await previewConfigurationChange(options);
  if (!preview.valid) throw new z.ZodError(preview.issues.filter((issue) => issue.severity === "error").map((issue) => ({ code: "custom", path: issue.path.split("."), message: issue.message })));
  if (options.expectedVersion && preview.currentVersion !== options.expectedVersion) throw new Error(`Configuration changed from version ${options.expectedVersion} to ${preview.currentVersion}. Preview again before publishing.`);
  const persisted = await persistConfiguration({ configuration: preview.candidate, summary: options.summary || "Published organization customization", actor: options.actor, eventType: "published", root: options.root });
  return { ...preview, configuration: persisted.document.current, version: persisted.version, audit: persisted.document.audit.at(-1) };
}

export async function rollbackOrganizationConfiguration(options: { tenantId: string; actor: string; version: number; entitlements: CustomizationEntitlements; root?: string }) {
  const state = await getOrganizationConfiguration(options.tenantId, options.actor, options.root);
  const target = state.versions.find((version) => version.version === options.version);
  if (!target) throw new Error("Configuration version not found.");
  const restored = hydratePlatformModules(OrganizationConfigurationSchema.parse({ ...structuredClone(target.configuration), version: state.configuration.version + 1, updatedAt: new Date().toISOString(), updatedBy: options.actor }));
  const issues = validateOrganizationConfiguration(restored, options.entitlements);
  if (issues.some((issue) => issue.severity === "error")) throw new Error(`That version cannot be restored: ${issues.find((issue) => issue.severity === "error")?.message}`);
  const persisted = await persistConfiguration({ configuration: restored, summary: `Restored version ${target.version}`, actor: options.actor, eventType: "rolled_back", root: options.root });
  return { configuration: persisted.document.current, version: persisted.version, audit: persisted.document.audit.at(-1) };
}

export async function resetOrganizationConfiguration(options: { tenantId: string; actor: string; root?: string }) {
  const state = await getOrganizationConfiguration(options.tenantId, options.actor, options.root);
  const reset = { ...defaultOrganizationConfiguration(options.tenantId, options.actor), version: state.configuration.version + 1, updatedAt: new Date().toISOString() };
  const persisted = await persistConfiguration({ configuration: reset, summary: "Restored PhantomForce defaults without deleting organization data", actor: options.actor, eventType: "reset", root: options.root });
  return { configuration: persisted.document.current, version: persisted.version, audit: persisted.document.audit.at(-1) };
}

export function planAssistantCustomization(message: string, current: OrganizationConfiguration) {
  const text = message.trim();
  const lower = text.toLowerCase();
  const patch: ConfigurationPatch = {};
  const explanations: string[] = [];
  const rename = text.match(/(?:rename|change)\s+(.+?)\s+to\s+(.+?)(?:\s+and\s+|\.|$)/i);
  if (rename) {
    const source = rename[1].trim().toLowerCase();
    const target = rename[2].trim();
    const module = current.modules.find((candidate) => candidate.label.toLowerCase() === source || candidate.id === source);
    if (module && MODULE_BY_ID.get(module.id)?.customerConfigurable) {
      patch.modules = current.modules.map((candidate) => candidate.id === module.id ? { ...candidate, label: target.slice(0, 40) } : candidate);
      explanations.push(`${module.label} will display as ${target}. Its canonical ID stays ${module.id}.`);
    }
  }
  const color = text.match(/#([0-9a-f]{6})\b/i);
  if (color) { patch.theme = { primary: `#${color[1]}` }; explanations.push("The organization primary color will change using validated theme tokens."); }
  for (const module of current.modules) {
    const label = module.label.toLowerCase();
    if ((lower.includes(`hide ${label}`) || lower.includes(`disable ${label}`)) && MODULE_BY_ID.get(module.id)?.customerConfigurable) {
      patch.modules = (patch.modules ?? current.modules).map((candidate) => candidate.id === module.id ? { ...candidate, enabled: false } : candidate);
      explanations.push(`${module.label} will be hidden for this organization.`);
    }
  }
  const tone = (["professional", "friendly", "energetic", "concise", "direct"] as const).find((candidate) => lower.includes(candidate));
  if (lower.includes("assistant") && tone) { patch.assistant = { tone }; explanations.push(`The assistant tone will become ${tone}.`); }
  if (/football|recruiting|athlete|coach/.test(lower)) {
    patch.terminology = { ...current.terminology, clients: "Athletes", leads: "Recruits", pipeline: "Recruiting Pipeline" };
    explanations.push("Sports recruiting terminology will be applied without changing canonical records or integrations.");
  }
  return {
    understood: explanations.length > 0,
    message: text,
    patch,
    explanations,
    requiresApproval: true,
    sourceCodeEdited: false,
    protectedCoreTouched: false,
  };
}

export function publicConfiguration(configuration: OrganizationConfiguration) {
  return {
    ...configuration,
    extensions: configuration.extensions.map((extension) => ({ ...extension, grantedPermissions: extension.grantedPermissions })),
    platform: { id: "phantomforce", attributionRequired: true, protectedCore: true },
  };
}

export type { ConfigurationVersion };
