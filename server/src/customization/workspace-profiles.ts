export type WorkspaceProfileId = "business" | "athlete" | "coach" | "sports_management" | "creator" | "developer" | "agency" | "education";

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
    description: "Leads, quotes, delivery, sites, accounting, protection, media, analytics, automations, and PhantomPlay.",
    workspaceName: "Business HQ",
    homeModuleId: "dashboard",
    enabledModules: ["dashboard", "crm", "media", "sites", "money", "phantomplay", "phantomstore", "intelligence", "analytics", "automation", "approvals", "workers", "settings", "customize"],
    brainStorageMode: "web_only",
    localBrainInstall: "never_silent",
    apiCredentialPolicy: "tenant_owned_only",
    subscriptionPolicy: "tenant_owned_only",
    historyPolicy: "workspace_scoped",
  },
  athlete: {
    id: "athlete",
    label: "Athlete",
    description: "Training updates, recruiting, personal brand, coach communication, sponsorships, media, analytics, and PhantomPlay.",
    workspaceName: "Athlete Command",
    homeModuleId: "dashboard",
    enabledModules: ["dashboard", "crm", "media", "sites", "phantomplay", "phantomstore", "intelligence", "analytics", "automation", "approvals", "workers", "settings", "customize"],
    brainStorageMode: "web_only",
    localBrainInstall: "never_silent",
    apiCredentialPolicy: "tenant_owned_only",
    subscriptionPolicy: "tenant_owned_only",
    historyPolicy: "workspace_scoped",
  },
  coach: {
    id: "coach",
    label: "Coach",
    description: "Roster notes, practice planning, athlete follow-up, media, analytics, approvals, and team PhantomPlay.",
    workspaceName: "Coach Command",
    homeModuleId: "dashboard",
    enabledModules: ["dashboard", "crm", "media", "sites", "phantomplay", "phantomstore", "intelligence", "analytics", "automation", "approvals", "workers", "settings", "customize"],
    brainStorageMode: "web_only",
    localBrainInstall: "never_silent",
    apiCredentialPolicy: "tenant_owned_only",
    subscriptionPolicy: "tenant_owned_only",
    historyPolicy: "workspace_scoped",
  },
  sports_management: {
    id: "sports_management",
    label: "Sports management",
    description: "Athlete pipeline, sponsors, events, media deliverables, offers, follow-ups, accounting, and PhantomPlay.",
    workspaceName: "Sports Management HQ",
    homeModuleId: "dashboard",
    enabledModules: ["dashboard", "crm", "media", "sites", "money", "phantomplay", "phantomstore", "intelligence", "analytics", "automation", "approvals", "workers", "settings", "customize"],
    brainStorageMode: "web_only",
    localBrainInstall: "never_silent",
    apiCredentialPolicy: "tenant_owned_only",
    subscriptionPolicy: "tenant_owned_only",
    historyPolicy: "workspace_scoped",
  },
  creator: {
    id: "creator",
    label: "Creator",
    description: "Media, publishing, websites, analytics, automation, offers, and PhantomPlay.",
    workspaceName: "Creator Studio",
    homeModuleId: "dashboard",
    enabledModules: ["dashboard", "crm", "media", "sites", "phantomplay", "phantomstore", "intelligence", "analytics", "automation", "approvals", "workers", "settings", "customize"],
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
    enabledModules: ["dashboard", "planner", "media", "sites", "phantomplay", "phantomstore", "analytics", "automation", "approvals", "workers", "settings", "customize"],
    brainStorageMode: "external_provider",
    localBrainInstall: "never_silent",
    apiCredentialPolicy: "tenant_owned_only",
    subscriptionPolicy: "tenant_owned_only",
    historyPolicy: "provider_managed_when_connected",
  },
  agency: {
    id: "agency",
    label: "Agency",
    description: "Client delivery, content, sites, approvals, analytics, automations, accounting, and PhantomPlay.",
    workspaceName: "Agency Command",
    homeModuleId: "dashboard",
    enabledModules: ["dashboard", "crm", "media", "sites", "money", "phantomplay", "phantomstore", "intelligence", "analytics", "automation", "approvals", "workers", "settings", "customize"],
    brainStorageMode: "web_only",
    localBrainInstall: "never_silent",
    apiCredentialPolicy: "tenant_owned_only",
    subscriptionPolicy: "tenant_owned_only",
    historyPolicy: "workspace_scoped",
  },
  education: {
    id: "education",
    label: "Education",
    description: "Students, courses, communications, media, approvals, analytics, automations, and PhantomPlay.",
    workspaceName: "Education Command",
    homeModuleId: "dashboard",
    enabledModules: ["dashboard", "crm", "media", "sites", "phantomplay", "phantomstore", "intelligence", "analytics", "automation", "approvals", "workers", "settings", "customize"],
    brainStorageMode: "web_only",
    localBrainInstall: "never_silent",
    apiCredentialPolicy: "tenant_owned_only",
    subscriptionPolicy: "tenant_owned_only",
    historyPolicy: "workspace_scoped",
  },
};

export const WORKSPACE_PROFILE_IDS = Object.keys(WORKSPACE_PROFILES) as WorkspaceProfileId[];

export function normalizeWorkspaceProfileId(value: unknown): WorkspaceProfileId {
  return typeof value === "string" && value in WORKSPACE_PROFILES ? value as WorkspaceProfileId : "business";
}

export function workspaceProfileFor(value: unknown): WorkspaceProfile {
  return WORKSPACE_PROFILES[normalizeWorkspaceProfileId(value)];
}
