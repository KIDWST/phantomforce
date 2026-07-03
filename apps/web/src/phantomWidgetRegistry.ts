export type PhantomWidgetCategory = "business" | "work" | "money" | "create" | "safety" | "systems" | "summary";

export type PhantomWidgetSafetyLevel = "safe" | "manual" | "approval" | "planned";

export type PhantomWidgetAnimationVariant =
  | "radar"
  | "forge"
  | "checklist"
  | "shield"
  | "keys"
  | "pulse"
  | "build"
  | "film"
  | "message"
  | "scan"
  | "beacon"
  | "breath";

export type PhantomWidgetTarget =
  | "leads"
  | "proposal"
  | "work"
  | "review"
  | "access"
  | "money"
  | "site"
  | "video"
  | "inbox"
  | "protect"
  | "harbor"
  | "glance";

export type PhantomWidgetDefinition = {
  id: string;
  title: string;
  shortStatus: string;
  iconKey: string;
  category: PhantomWidgetCategory;
  safetyLevel: PhantomWidgetSafetyLevel;
  primaryActionLabel: string;
  target: PhantomWidgetTarget;
  count?: string;
  animationVariant: PhantomWidgetAnimationVariant;
  requiresApproval: boolean;
};

export const phantomWidgetRegistry: PhantomWidgetDefinition[] = [
  {
    id: "phantom-radar",
    title: "Phantom Radar",
    shortStatus: "Watching leaks, breaches, malware, and risky habits.",
    iconKey: "radar",
    category: "safety",
    safetyLevel: "safe",
    primaryActionLabel: "Open Protect",
    target: "protect",
    animationVariant: "radar",
    requiresApproval: false,
  },
  {
    id: "proposal-forge",
    title: "Proposal Forge",
    shortStatus: "Draft packets and review-ready proposals.",
    iconKey: "proposal",
    category: "business",
    safetyLevel: "manual",
    primaryActionLabel: "Open Proposal",
    target: "proposal",
    animationVariant: "forge",
    requiresApproval: true,
  },
  {
    id: "work-board",
    title: "Work Board",
    shortStatus: "Tasks, bookings, and upcoming work.",
    iconKey: "work",
    category: "work",
    safetyLevel: "safe",
    primaryActionLabel: "Open Work",
    target: "work",
    animationVariant: "checklist",
    requiresApproval: false,
  },
  {
    id: "review-queue",
    title: "Review Queue",
    shortStatus: "Manual approval before anything leaves.",
    iconKey: "review",
    category: "safety",
    safetyLevel: "approval",
    primaryActionLabel: "Open Review",
    target: "review",
    animationVariant: "shield",
    requiresApproval: true,
  },
  {
    id: "access-keys",
    title: "Access Keys",
    shortStatus: "Admin and employee gates.",
    iconKey: "keys",
    category: "safety",
    safetyLevel: "manual",
    primaryActionLabel: "Open Access",
    target: "access",
    animationVariant: "keys",
    requiresApproval: true,
  },
  {
    id: "money-pulse",
    title: "Money Pulse",
    shortStatus: "Pipeline, unpaid items, and value signals.",
    iconKey: "money",
    category: "money",
    safetyLevel: "planned",
    primaryActionLabel: "Open Money",
    target: "money",
    animationVariant: "pulse",
    requiresApproval: true,
  },
  {
    id: "site-studio",
    title: "Site Studio",
    shortStatus: "Website, app, pages, and deploy readiness.",
    iconKey: "site",
    category: "create",
    safetyLevel: "approval",
    primaryActionLabel: "Open Site",
    target: "site",
    animationVariant: "build",
    requiresApproval: true,
  },
  {
    id: "media-lab",
    title: "Media Lab",
    shortStatus: "Video, clips, and content jobs.",
    iconKey: "media",
    category: "create",
    safetyLevel: "approval",
    primaryActionLabel: "Open Media",
    target: "video",
    animationVariant: "film",
    requiresApproval: true,
  },
  {
    id: "inbox-client-comms",
    title: "Inbox / Client Comms",
    shortStatus: "Draft replies and follow-ups stay manual-send safe.",
    iconKey: "inbox",
    category: "business",
    safetyLevel: "manual",
    primaryActionLabel: "Open Inbox",
    target: "inbox",
    animationVariant: "message",
    requiresApproval: true,
  },
  {
    id: "security-protect",
    title: "Security / Protect",
    shortStatus: "Keys, passwords, routes, and risk checks.",
    iconKey: "protect",
    category: "safety",
    safetyLevel: "safe",
    primaryActionLabel: "Open Protect",
    target: "protect",
    animationVariant: "scan",
    requiresApproval: false,
  },
  {
    id: "harbor-status",
    title: "Harbor Status",
    shortStatus: "Provider, budget guard, local status, manual mode.",
    iconKey: "harbor",
    category: "systems",
    safetyLevel: "safe",
    primaryActionLabel: "Open Harbor",
    target: "harbor",
    animationVariant: "beacon",
    requiresApproval: false,
  },
  {
    id: "glance",
    title: "Glance",
    shortStatus: "Top three things that need attention.",
    iconKey: "glance",
    category: "summary",
    safetyLevel: "safe",
    primaryActionLabel: "Open Glance",
    target: "glance",
    animationVariant: "breath",
    requiresApproval: false,
  },
];
