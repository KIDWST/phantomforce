export type PlatformModuleDefinition = {
  id: string;
  displayName: string;
  description: string;
  icon: string;
  route: string;
  required: boolean;
  customerConfigurable: boolean;
  dependencies: string[];
  allowedRoles: string[];
  mobile: boolean;
};

export const PLATFORM_MODULES: PlatformModuleDefinition[] = [
  { id: "dashboard", displayName: "Dashboard", description: "Business home and AI briefing.", icon: "grid", route: "main", required: true, customerConfigurable: true, dependencies: [], allowedRoles: ["owner", "admin", "manager", "member", "client"], mobile: true },
  { id: "intelligence", displayName: "Competitor Intel", description: "Lawful public-signal analysis, audience gaps, and original response planning.", icon: "chart", route: "intelligence", required: false, customerConfigurable: true, dependencies: [], allowedRoles: ["owner", "admin", "manager", "member", "client"], mobile: true },
  { id: "media", displayName: "Media Lab", description: "Image/video creation, content library, and publishing workflow.", icon: "media", route: "media", required: false, customerConfigurable: true, dependencies: [], allowedRoles: ["owner", "admin", "manager", "member"], mobile: true },
  { id: "sites", displayName: "Websites", description: "Websites, stores, forms, and pages.", icon: "site", route: "sites", required: false, customerConfigurable: true, dependencies: [], allowedRoles: ["owner", "admin", "manager", "member"], mobile: true },
  { id: "money", displayName: "Accounting", description: "Revenue, expenses, offers, and financial visibility.", icon: "dollar", route: "money", required: false, customerConfigurable: true, dependencies: [], allowedRoles: ["owner", "admin", "manager"], mobile: true },
  { id: "phantomplay", displayName: "PhantomPlay", description: "Optional team downtime, workspace challenges, and approved community experiences.", icon: "media", route: "phantomplay", required: false, customerConfigurable: true, dependencies: [], allowedRoles: ["owner", "admin", "manager", "member", "client"], mobile: true },
  /* Owner/admin business back office — opens from Settings > Organization,
     not a permanent primary-sidebar slot every teammate needs. */
  { id: "crm", displayName: "Clients", description: "Contacts, leads, pipeline, and follow-up.", icon: "users", route: "leads", required: false, customerConfigurable: true, dependencies: [], allowedRoles: ["owner", "admin"], mobile: true },
  { id: "memory", displayName: "Memory", description: "Organization knowledge and preferences.", icon: "brain", route: "memory", required: false, customerConfigurable: true, dependencies: [], allowedRoles: ["owner", "admin", "manager"], mobile: true },
  { id: "automation", displayName: "Automations", description: "Approval-aware repeat workflows.", icon: "auto", route: "automation", required: false, customerConfigurable: true, dependencies: ["approvals"], allowedRoles: ["owner", "admin", "manager"], mobile: true },
  { id: "approvals", displayName: "Approvals", description: "Review risky and outbound work.", icon: "check", route: "approvals", required: true, customerConfigurable: false, dependencies: [], allowedRoles: ["owner", "admin", "manager", "member"], mobile: true },
  { id: "workers", displayName: "Workforce", description: "See Phantom workers and current work.", icon: "users", route: "workforce", required: false, customerConfigurable: true, dependencies: [], allowedRoles: ["owner", "admin", "manager"], mobile: true },
  { id: "analytics", displayName: "Analytics", description: "Performance, operating, and growth signals.", icon: "chart", route: "analytics", required: false, customerConfigurable: true, dependencies: [], allowedRoles: ["owner", "admin", "manager"], mobile: true },
  { id: "vacation", displayName: "Away Mode", description: "Approved business coverage while the owner is away.", icon: "auto", route: "vacation", required: false, customerConfigurable: true, dependencies: ["approvals"], allowedRoles: ["owner", "admin"], mobile: true },
  { id: "customize", displayName: "Workspace Studio", description: "Shape this organization without changing the platform core.", icon: "spark", route: "customize", required: false, customerConfigurable: false, dependencies: ["settings"], allowedRoles: ["owner", "admin"], mobile: true },
  { id: "settings", displayName: "Settings", description: "Identity, access, privacy, and recovery controls.", icon: "cog", route: "settings", required: true, customerConfigurable: false, dependencies: [], allowedRoles: ["owner", "admin", "manager", "member", "client"], mobile: true },
  { id: "developer", displayName: "Developer", description: "Protected PhantomForce platform diagnostics.", icon: "dev", route: "developer", required: false, customerConfigurable: false, dependencies: [], allowedRoles: ["platform_owner"], mobile: false },
];

export const MODULE_BY_ID = new Map(PLATFORM_MODULES.map((module) => [module.id, module]));
export const REQUIRED_MODULE_IDS = new Set(PLATFORM_MODULES.filter((module) => module.required).map((module) => module.id));
export const PROTECTED_MODULE_IDS = new Set(PLATFORM_MODULES.filter((module) => !module.customerConfigurable).map((module) => module.id));
