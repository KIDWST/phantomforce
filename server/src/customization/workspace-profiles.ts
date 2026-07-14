export type WorkspaceProfileId = "business" | "creator" | "developer";

export type BrainStorageMode = "web_only" | "optional_local" | "external_provider";

export type WorkspaceProfile = {
  id: WorkspaceProfileId;
  label: string;
  description: string;
  workspaceName: string;
  homeModuleId: string;
  enabledModules: string[];
  brainStorageMode: BrainStorageMode;
  localBrainInstall: "never_silent" | "optional_prompt";
  apiCredentialPolicy: "tenant_owned_only";
  subscriptionPolicy: "tenant_owned_only";
  historyPolicy: "provider_managed_when_connected" | "workspace_scoped";
};

export const WORKSPACE_PROFILES: Record<WorkspaceProfileId, WorkspaceProfile> = {
  business: {
    id: "business",
    label: "Business",
    description: "Leads, quotes, delivery, sites, accounting, protection, media, analytics, and approvals.",
    workspaceName: "Business HQ",
    homeModuleId: "dashboard",
    enabledModules: ["dashboard", "crm", "media", "sites", "money", "intelligence", "analytics", "automation", "approvals", "workers", "settings", "customize"],
    brainStorageMode: "web_only",
    localBrainInstall: "never_silent",
    apiCredentialPolicy: "tenant_owned_only",
    subscriptionPolicy: "tenant_owned_only",
    historyPolicy: "workspace_scoped",
  },
  creator: {
    id: "creator",
    label: "Creator",
    description: "Media Lab, Content Hub, sites, analytics, approvals, and lightweight planning.",
    workspaceName: "Creator Studio",
    homeModuleId: "media",
    enabledModules: ["dashboard", "media", "sites", "analytics", "approvals", "settings", "customize"],
    brainStorageMode: "web_only",
    localBrainInstall: "never_silent",
    apiCredentialPolicy: "tenant_owned_only",
    subscriptionPolicy: "tenant_owned_only",
    historyPolicy: "workspace_scoped",
  },
  developer: {
    id: "developer",
    label: "Developer",
    description: "Planner, PhantomPlay, Developer settings, approvals, and provider/subscription setup owned by the developer.",
    workspaceName: "Dev Studio",
    homeModuleId: "planner",
    enabledModules: ["dashboard", "planner", "phantomplay", "approvals", "settings", "customize"],
    brainStorageMode: "external_provider",
    localBrainInstall: "never_silent",
    apiCredentialPolicy: "tenant_owned_only",
    subscriptionPolicy: "tenant_owned_only",
    historyPolicy: "provider_managed_when_connected",
  },
};

export const WORKSPACE_PROFILE_IDS = Object.keys(WORKSPACE_PROFILES) as WorkspaceProfileId[];

export function normalizeWorkspaceProfileId(value: unknown): WorkspaceProfileId {
  return typeof value === "string" && value in WORKSPACE_PROFILES ? value as WorkspaceProfileId : "business";
}

export function workspaceProfileFor(value: unknown): WorkspaceProfile {
  return WORKSPACE_PROFILES[normalizeWorkspaceProfileId(value)];
}

