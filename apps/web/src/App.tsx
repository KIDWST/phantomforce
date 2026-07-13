import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bell,
  Bot,
  Building2,
  CalendarDays,
  Check,
  Clock3,
  Command,
  CreditCard,
  FileAudio,
  FileImage,
  FileVideo,
  FileText,
  Inbox,
  KeyRound,
  Link2,
  Lock,
  Mail,
  MessageSquare,
  Palette,
  Play,
  Plus,
  RefreshCcw,
  Rocket,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  SquareCheckBig,
  Target,
  ToggleLeft,
  UserRound,
  Users,
  X,
  Zap,
} from "lucide-react";
import { DragEvent, FormEvent, ReactNode, useEffect, useMemo, useState } from "react";

type Route =
  | "command"
  | "analytics"
  | "content"
  | "play"
  | "inbox"
  | "calendar"
  | "tasks"
  | "approvals"
  | "access"
  | "activity"
  | "connections"
  | "settings";
type ApprovalKind = "email" | "calendar" | "task";
type ApprovalStatus = "pending" | "approved" | "rejected";
type ActivityLevel = "ok" | "info" | "warn";
type ClientAccessStatus = "active" | "past_due" | "revoked";
type PaymentStatus = "paid" | "due" | "failed";
type MoneyDemoStage = "signed" | "paid" | "past_due" | "revoked" | "restored";
type SettingsCategory = "workspace" | "appearance" | "access" | "notifications";
type WorkspacePublishState = "draft" | "previewed" | "published";

type EmailItem = {
  id: string;
  from: string;
  subject: string;
  preview: string;
  age: string;
  priority: "high" | "medium" | "low";
  status: "needs-reply" | "waiting" | "handled";
  project: string;
};

type CalendarEvent = {
  id: string;
  title: string;
  time: string;
  owner: string;
  status: "confirmed" | "proposed" | "hold";
};

type TaskItem = {
  id: string;
  title: string;
  owner: string;
  due: string;
  status: "today" | "queued" | "done";
};

type Approval = {
  id: string;
  kind: ApprovalKind;
  title: string;
  summary: string;
  payload: Record<string, string>;
  reversible: boolean;
  status: ApprovalStatus;
};

type ActivityItem = {
  id: string;
  title: string;
  detail: string;
  time: string;
  level: ActivityLevel;
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type Connection = {
  id: string;
  name: string;
  description: string;
  status: "connected" | "ready" | "locked";
  scopes: string[];
};

type ClientAccess = {
  id: string;
  business: string;
  owner: string;
  plan: string;
  paymentStatus: PaymentStatus;
  accessStatus: ClientAccessStatus;
  gateway: "Pangolin";
  privateRoute: string;
  modules: string[];
  lastAudit: string;
};

type LinkedClientCsv = {
  id: string;
  label: string;
  path: string;
  lastSyncedAt?: string;
};

type GuardedWorkspace = {
  id: string;
  business: string;
  mode: "full" | "read_only" | "blocked";
  modules: string[];
  reason: string;
};

type WorkspaceModuleAction = {
  id: string;
  label: string;
  requiresFullAccess: boolean;
  enabled: boolean;
};

type WorkspaceModuleView = {
  moduleKey: string;
  title: string;
  mode: GuardedWorkspace["mode"];
  writeAccess: boolean;
  summary: string;
  widgets: Array<{
    id: string;
    label: string;
    value: string;
  }>;
  records: Array<{
    id: string;
    title: string;
    status: string;
  }>;
  primaryActions: WorkspaceModuleAction[];
  disabledActions: WorkspaceModuleAction[];
  connector?: {
    id: string;
    provider: string;
    credentialMode: string;
    credentialSource: string;
    credentialRef: string | null;
    workspaceId: string | null;
    scopes: string[];
    status: string;
    readOnly: boolean;
    live: boolean;
    reason: string;
  };
};

type PangolinRoutePlan = {
  clientId: string;
  business: string;
  privateRoute: string;
  gateway: "Pangolin";
  accessStatus: ClientAccessStatus;
  paymentStatus: PaymentStatus;
  desiredState: "enabled" | "read_only" | "disabled";
  mode: GuardedWorkspace["mode"];
  gatewayEnforcement: "allow_route" | "disable_route";
  appEnforcement: GuardedWorkspace["mode"];
  enforcementNote: string;
  modules: string[];
  reason: string;
  liveChangeRequired: boolean;
  liveChangesAllowed: boolean;
};

type PangolinReadOnlyStatus = {
  provider: "Pangolin";
  readOnly: true;
  configured: boolean;
  status: "unconfigured" | "reachable" | "unreachable";
  checkedAt: string;
  baseUrl?: string;
  healthPath?: string;
  httpStatus?: number;
  latencyMs?: number;
  reason: string;
  liveChangesAllowed: false;
};

type ReadinessGate = {
  id: string;
  label: string;
  status: "ready" | "needs_config" | "blocked";
  detail: string;
  evidence: string;
};

type ProductionReadinessReport = {
  checkedAt: string;
  localDemoReady: boolean;
  productionReady: boolean;
  summary: string;
  gates: ReadinessGate[];
};

type MediaLabEffectCategory =
  | "transitions"
  | "titles"
  | "text_templates"
  | "logo_templates"
  | "overlays"
  | "mockups"
  | "sports"
  | "macros"
  | "templates"
  | "software"
  | "uncategorized";

type MediaLabEffect = {
  id: string;
  title: string;
  category: MediaLabEffectCategory;
  tags: string[];
  sourceProvider: "Motion Array";
  sourcePack: string;
  sourceFolder: string;
  sourceRelativePath: string;
  fileName: string;
  fileExtension: string;
  sizeBytes: number;
  sizeLabel: string;
  licenseStatus: "motion_array_project_use_only" | "needs_rights_review" | "blocked_software_package";
  exposureMode: "metadata_only" | "rendered_derivative_only" | "blocked";
  allowedUse: string;
  rawDownloadAllowed: false;
  cloudPackReady: boolean;
};

type MediaLabCatalog = {
  summary: {
    generatedAt: string;
    sourceProvider: "Motion Array";
    sourceRootConfigured: boolean;
    totalAssets: number;
    totalBytes: number;
    totalSizeLabel: string;
    cloudReadyAssets: number;
    rawDownloadAllowed: false;
    categories: Array<{
      category: MediaLabEffectCategory;
      count: number;
      sizeBytes: number;
      sizeLabel: string;
    }>;
    packs: Array<{
      sourceFolder: string;
      count: number;
      sizeBytes: number;
      sizeLabel: string;
    }>;
    licenseBoundary: {
      sourceProvider: "Motion Array";
      rawDownloadAllowed: false;
      allowedUse: string;
      blockedUse: string;
      reviewRequiredBeforePublicCloud: true;
    };
  };
  effects: MediaLabEffect[];
  warnings: string[];
};

type PhantomPlayAccessMode = "disabled" | "enabled" | "background_jobs_only" | "selected_hours";

type PhantomPlayGame = {
  id: string;
  slug: string;
  title: string;
  creatorId: string;
  tagline: string;
  description: string;
  categories: string[];
  runtime: "html5" | "javascript" | "webassembly" | "webgl" | "godot_web";
  moderationState: string;
  launchPath: string;
  averageMinutes: number;
  supportsKeyboard: boolean;
  supportsMouse: boolean;
  supportsTouch: boolean;
  supportsController: boolean;
  workplaceFriendly: boolean;
};

type PhantomPlayCreator = {
  id: string;
  displayName: string;
  tagline: string;
  verified: boolean;
};

type PhantomPlayPolicy = {
  orgId: string;
  accessMode: PhantomPlayAccessMode;
  allowedRoles: string[];
  allowedHours: { start: string; end: string };
  maxSessionMinutes: number;
  dailyAllowanceMinutes: number;
  allowedCategories: string[];
  allowMultiplayer: boolean;
  allowLeaderboards: boolean;
  allowSocialFeatures: boolean;
  allowSound: boolean;
  usageReportingLevel: "summary" | "policy_only";
  forcePauseOnUrgentWork: boolean;
};

type PhantomPlaySnapshot = {
  product: {
    name: "PhantomPlay";
    slogan: string;
    standalonePath: string;
    breakRoomLabel: string;
  };
  policy: PhantomPlayPolicy;
  games: PhantomPlayGame[];
  creators: PhantomPlayCreator[];
  favorites: string[];
  recentSessions: Array<{ id: string; gameId: string; status: string; lastActiveAt: string }>;
  runtimeSecurity: {
    browserFirstOnly: boolean;
    acceptedRuntimes: string[];
    rejectsExecutables: boolean;
    sandboxRequired: boolean;
    noAssetCloudCoupling: boolean;
  };
  creatorPublishingStates: string[];
};

type ContentHubTab = "create" | "library" | "calendar" | "distribution";
type CreateMode = "photo" | "video" | "voice";
type CreateJobStatus = "queued" | "rendering" | "ready" | "failed";

type CreateJob = {
  id: string;
  workspaceId: string;
  mode: CreateMode;
  title: string;
  prompt: string;
  status: CreateJobStatus;
  createdAt: string;
  completedAt?: string;
  engine: string;
  audioUrl?: string;
  statusUrl?: string;
  error?: string;
};

type VoiceboxRuntimeStatus = {
  configured: boolean;
  reachable: boolean;
  baseUrl: string;
  profiles: number;
  reason: string;
};

type SocialProviderId = "instagram" | "facebook" | "tiktok" | "youtube" | "linkedin" | "x";

type SocialProviderStatus = {
  id: SocialProviderId;
  name: string;
  configured: boolean;
  connected: boolean;
  analyticsReady: boolean;
  authUrl: string | null;
  scopes: string[];
  reason: string;
};

type SocialOauthAttempt = {
  providerId: SocialProviderId;
  providerName: string;
  status: "already_connected" | "ready_to_open_oauth" | "missing_oauth_config";
  authUrl: string | null;
  reason: string;
};

type SocialAnalyticsSnapshot = {
  connectedProviders: number;
  analyticsReadyProviders: number;
  metrics: Array<{ label: string; value: string; delta: string }>;
  providerBreakdown: Array<{
    providerId: SocialProviderId;
    providerName: string;
    followers: number;
    reach: number;
    engagement: number;
    posts: number;
  }>;
  reason: string;
};

type BrandProfile = {
  businessName: string;
  industry: string;
  audience: string;
  offer: string;
  tone: string;
  colors: string;
  goals: string;
  planId: "free" | "starter" | "growth";
  completedAt: string;
  version: string;
};

type AppSession = {
  id: string;
  label: string;
  role: "admin" | "client";
  clientId?: string;
  canManageAccess: boolean;
};

const AUTHORIZATION_HEADER = "Authorization";

const initialSessions: AppSession[] = [
  {
    id: "admin-jordan",
    label: "Jordan / PhantomForce Admin",
    role: "admin",
    canManageAccess: true,
  },
  {
    id: "client-one",
    label: "Customer One new account",
    role: "client",
    clientId: "client-one",
    canManageAccess: false,
  },
  {
    id: "client-chicagoshots",
    label: "ChicagoShots client workspace",
    role: "client",
    clientId: "client-chicagoshots",
    canManageAccess: false,
  },
  {
    id: "client-sports-demo",
    label: "Sports Ops Demo client",
    role: "client",
    clientId: "client-sports-demo",
    canManageAccess: false,
  },
  {
    id: "client-past-due",
    label: "Past Due Pilot client",
    role: "client",
    clientId: "client-past-due",
    canManageAccess: false,
  },
];

const navItems: Array<{ id: Route; label: string; icon: ReactNode }> = [
  { id: "command", label: "Command", icon: <Command size={18} /> },
  { id: "analytics", label: "Analytics", icon: <BarChart3 size={18} /> },
  { id: "content", label: "Media Lab", icon: <FileImage size={18} /> },
  { id: "play", label: "Break Room", icon: <Play size={18} /> },
  { id: "inbox", label: "Inbox", icon: <Inbox size={18} /> },
  { id: "calendar", label: "Calendar", icon: <CalendarDays size={18} /> },
  { id: "tasks", label: "Tasks", icon: <SquareCheckBig size={18} /> },
  { id: "approvals", label: "Approvals", icon: <ShieldCheck size={18} /> },
  { id: "access", label: "Access", icon: <KeyRound size={18} /> },
  { id: "activity", label: "Activity", icon: <Activity size={18} /> },
  { id: "connections", label: "Connections", icon: <Link2 size={18} /> },
];

const initialEmails: EmailItem[] = [
  {
    id: "mail-1",
    from: "Maya Chen",
    subject: "Can we lock a shoot date next week?",
    preview: "Need a quick slot for the product shoot and a quote before Friday.",
    age: "18m",
    priority: "high",
    status: "needs-reply",
    project: "ChicagoShots",
  },
  {
    id: "mail-2",
    from: "Southside Elite",
    subject: "Roster updates and parent contact list",
    preview: "Three players changed teams and two forms are still missing.",
    age: "2h",
    priority: "medium",
    status: "waiting",
    project: "Sports Ops",
  },
  {
    id: "mail-3",
    from: "Air Authority",
    subject: "Follow-up after estimate",
    preview: "Customer asked whether Tuesday install is still possible.",
    age: "4h",
    priority: "medium",
    status: "needs-reply",
    project: "Service Pipeline",
  },
];

const initialEvents: CalendarEvent[] = [
  {
    id: "event-1",
    title: "Open production window",
    time: "Tue 10:30 AM",
    owner: "Jordan",
    status: "hold",
  },
  {
    id: "event-2",
    title: "Client approval call",
    time: "Wed 2:00 PM",
    owner: "Maya Chen",
    status: "confirmed",
  },
  {
    id: "event-3",
    title: "Roster review",
    time: "Thu 6:30 PM",
    owner: "Southside Elite",
    status: "proposed",
  },
];

const initialTasks: TaskItem[] = [
  {
    id: "task-1",
    title: "Reply to Maya with shoot options",
    owner: "PhantomForce",
    due: "Today",
    status: "today",
  },
  {
    id: "task-2",
    title: "Review missing sports forms",
    owner: "Ops",
    due: "Tomorrow",
    status: "queued",
  },
  {
    id: "task-3",
    title: "Draft Air Authority follow-up",
    owner: "Assistant",
    due: "Today",
    status: "today",
  },
];

const initialActivity: ActivityItem[] = [
  {
    id: "act-1",
    title: "Morning brief generated",
    detail: "3 emails need action, 2 calendar holds, 2 approval-ready workflows.",
    time: "9:02 AM",
    level: "ok",
  },
  {
    id: "act-2",
    title: "Google connectors checked",
    detail: "Gmail and Calendar are ready in demo mode. No external writes without approval.",
    time: "9:01 AM",
    level: "info",
  },
  {
    id: "act-3",
    title: "Falcon boundary locked",
    detail: "Raw commands, files, logs, and model settings are not exposed to clients.",
    time: "8:58 AM",
    level: "warn",
  },
];

const initialMessages: Message[] = [
  {
    id: "msg-1",
    role: "assistant",
    content:
      "PhantomForce is online. I found one urgent client follow-up, two scheduling opportunities, and one approval-ready action. Ask me to handle the day, schedule a call, draft replies, or clean up the inbox.",
  },
];

const connections: Connection[] = [
  {
    id: "gmail",
    name: "Google Gmail",
    description: "Read inbox, identify follow-ups, draft replies, and send only after approval.",
    status: "connected",
    scopes: ["Read mail", "Draft mail", "Send with approval"],
  },
  {
    id: "calendar",
    name: "Google Calendar",
    description: "Check availability, propose meeting times, and create events after approval.",
    status: "connected",
    scopes: ["Read calendar", "Create with approval"],
  },
  {
    id: "falcon",
    name: "Falcon private worker",
    description: "Future typed backend jobs. No raw command execution in the client app.",
    status: "locked",
    scopes: ["Typed jobs only", "Staff diagnostics", "Kill switch"],
  },
  {
    id: "media-lab",
    name: "Media Lab effects catalog",
    description: "Motion effects, templates, presets, and production references with raw source downloads blocked.",
    status: "ready",
    scopes: ["Catalog metadata", "Rendered derivatives", "Rights review"],
  },
];

const initialClientAccess: ClientAccess[] = [
  {
    id: "client-one",
    business: "Customer One",
    owner: "New customer",
    plan: "Free preview",
    paymentStatus: "paid",
    accessStatus: "active",
    gateway: "Pangolin",
    privateRoute: "app.phantomforce.online/customer-one",
    modules: ["Command", "Media Lab", "Tasks", "Approvals", "Activity"],
    lastAudit: "Brand intake required before workspace setup",
  },
  {
    id: "client-chicagoshots",
    business: "ChicagoShots",
    owner: "Jordan West",
    plan: "Internal partner",
    paymentStatus: "paid",
    accessStatus: "active",
    gateway: "Pangolin",
    privateRoute: "app.phantomforce.online/chicagoshots",
    modules: ["Command", "Media Lab", "Tasks", "Approvals", "Activity"],
    lastAudit: "Access confirmed for partner workspace",
  },
  {
    id: "client-sports-demo",
    business: "Sports Ops Demo",
    owner: "Client Owner",
    plan: "$2,000 Team Media Day",
    paymentStatus: "paid",
    accessStatus: "active",
    gateway: "Pangolin",
    privateRoute: "app.phantomforce.online/sports-ops-demo",
    modules: ["Command", "Media Lab", "Calendar", "Tasks", "Approvals", "Contacts"],
    lastAudit: "Deposit paid; workspace active",
  },
  {
    id: "client-past-due",
    business: "Past Due Pilot",
    owner: "Client Owner",
    plan: "$1,250/mo Ops Support",
    paymentStatus: "failed",
    accessStatus: "revoked",
    gateway: "Pangolin",
    privateRoute: "app.phantomforce.online/past-due-pilot",
    modules: ["Command", "Tasks", "Reports"],
    lastAudit: "Payment failed; private route revoked",
  },
];

const modules = [
  "AI Command",
  "Email",
  "Calendar",
  "Tasks",
  "Approvals",
  "Activity",
  "Media Lab",
  "Contacts",
  "Documents",
  "Falcon Worker",
];

const clientModuleCatalog = [
  "Command",
  "Calendar",
  "Tasks",
  "Approvals",
  "Contacts",
  "Media Lab",
  "Activity",
  "Documents",
  "Reports",
];

const API_BASE_URL =
  (import.meta as ImportMeta & { env?: { VITE_API_BASE_URL?: string } }).env?.VITE_API_BASE_URL ??
  "http://127.0.0.1:5190";
const MONEY_DEMO_CLIENT_ID = "client-money-demo";
const BRAND_ONBOARDING_VERSION = "2026-07-12-brand-intake-v1";

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 1000)}`;
}

function brandProfileStorageKey(clientId: string) {
  return `phantomforce:brand-profile:${BRAND_ONBOARDING_VERSION}:${clientId}`;
}

function loadBrandProfile(clientId: string): BrandProfile | null {
  try {
    const stored = window.localStorage.getItem(brandProfileStorageKey(clientId));
    if (!stored) return null;
    const profile = JSON.parse(stored) as BrandProfile;
    return profile.version === BRAND_ONBOARDING_VERSION ? profile : null;
  } catch {
    return null;
  }
}

function saveBrandProfile(clientId: string, profile: BrandProfile) {
  window.localStorage.setItem(brandProfileStorageKey(clientId), JSON.stringify(profile));
}

function normalizeModuleKey(moduleKey: string) {
  return moduleKey.trim().toLowerCase();
}

function moduleTestId(clientId: string, moduleKey: string) {
  const slug = moduleKey.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return `access-module-${clientId}-${slug}`;
}

function humanizeSlug(value: string) {
  return value.replace(/_/g, " ").replace(/-/g, " ");
}

function App() {
  const [route, setRoute] = useState<Route>("command");
  const [signedIn, setSignedIn] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState("admin-jordan");
  const [sessionToken, setSessionToken] = useState("");
  const [commandText, setCommandText] = useState("");
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [emails, setEmails] = useState(initialEmails);
  const [events, setEvents] = useState(initialEvents);
  const [tasks, setTasks] = useState(initialTasks);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [activity, setActivity] = useState(initialActivity);
  const [clientAccess, setClientAccess] = useState(initialClientAccess);
  const [guardedWorkspace, setGuardedWorkspace] = useState<GuardedWorkspace | null>(null);
  const [workspaceModuleView, setWorkspaceModuleView] = useState<WorkspaceModuleView | null>(null);
  const [pangolinPlan, setPangolinPlan] = useState<PangolinRoutePlan[]>([]);
  const [pangolinStatus, setPangolinStatus] = useState<PangolinReadOnlyStatus | null>(null);
  const [readinessReport, setReadinessReport] = useState<ProductionReadinessReport | null>(null);
  const [linkedClientCsvs, setLinkedClientCsvs] = useState<LinkedClientCsv[]>([]);
  const [clientCsvBusy, setClientCsvBusy] = useState(false);
  const [clientCsvStatus, setClientCsvStatus] = useState("Drop a CSV here or link one to keep the client list updated.");
  const [mediaLabCatalog, setMediaLabCatalog] = useState<MediaLabCatalog | null>(null);
  const [mediaLabBusy, setMediaLabBusy] = useState(false);
  const [contentHubTab, setContentHubTab] = useState<ContentHubTab>("create");
  const [createMode, setCreateMode] = useState<CreateMode>("video");
  const [createPrompt, setCreatePrompt] = useState(
    "Create a 20 second product launch video with a confident voiceover and three social cutdowns.",
  );
  const [createJobs, setCreateJobs] = useState<CreateJob[]>([]);
  const [voiceboxStatus, setVoiceboxStatus] = useState<VoiceboxRuntimeStatus | null>(null);
  const [socialProviders, setSocialProviders] = useState<SocialProviderStatus[]>([]);
  const [socialAnalytics, setSocialAnalytics] = useState<SocialAnalyticsSnapshot | null>(null);
  const [socialOauthAttempts, setSocialOauthAttempts] = useState<SocialOauthAttempt[]>([]);
  const [socialAnalyticsBusy, setSocialAnalyticsBusy] = useState(false);
  const [socialAnalyticsStatus, setSocialAnalyticsStatus] = useState("Connect social accounts to start combined analytics.");
  const [brandProfiles, setBrandProfiles] = useState<Record<string, BrandProfile>>({});
  const [phantomPlaySnapshot, setPhantomPlaySnapshot] = useState<PhantomPlaySnapshot | null>(null);
  const [phantomPlayBusy, setPhantomPlayBusy] = useState(false);
  const [phantomPlayStatus, setPhantomPlayStatus] = useState("PhantomPlay has not loaded yet.");
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategory>("workspace");
  const [workspaceDesignerDraft, setWorkspaceDesignerDraft] = useState({
    name: "Client Command Workspace",
    layout: "Command first",
    theme: "Phantom dark",
    defaultModule: "Command",
  });
  const [workspaceDesignerPreview, setWorkspaceDesignerPreview] = useState<typeof workspaceDesignerDraft | null>(null);
  const [workspacePublishState, setWorkspacePublishState] = useState<WorkspacePublishState>("draft");
  const [moneyDemoBusy, setMoneyDemoBusy] = useState<MoneyDemoStage | null>(null);
  const [selectedOrg, setSelectedOrg] = useState("PhantomForce Pilot");
  const activeSession = useMemo(
    () => initialSessions.find((session) => session.id === activeSessionId) ?? initialSessions[0],
    [activeSessionId],
  );
  const canManageAccess = activeSession.canManageAccess;
  const activeWorkspaceId = activeSession.clientId ?? "admin-jordan";
  const activeBrandProfile = activeSession.clientId ? brandProfiles[activeSession.clientId] ?? null : null;
  const needsBrandOnboarding = signedIn && activeSession.role === "client" && Boolean(activeSession.clientId) && !activeBrandProfile;
  const visibleClientAccess = useMemo(() => {
    if (canManageAccess) return clientAccess;
    return clientAccess.filter((client) => client.id === activeSession.clientId);
  }, [activeSession.clientId, canManageAccess, clientAccess]);
  const workspaceCreateJobs = useMemo(
    () => createJobs.filter((job) => job.workspaceId === activeWorkspaceId),
    [activeWorkspaceId, createJobs],
  );
  const hasActiveBackgroundJob = workspaceCreateJobs.some((job) => job.status === "queued" || job.status === "rendering");

  function sessionHeaders(json = false): Record<string, string> {
    const headers: Record<string, string> = json ? { "Content-Type": "application/json" } : {};

    if (sessionToken) {
      headers[AUTHORIZATION_HEADER] = `Bearer ${sessionToken}`;
    }

    return headers;
  }

  async function signIn(sessionId: string) {
    const session = initialSessions.find((item) => item.id === sessionId) ?? initialSessions[0];
    const storedBrandProfile = session.clientId ? loadBrandProfile(session.clientId) : null;
    setActiveSessionId(session.id);
    setSelectedOrg(storedBrandProfile?.businessName ?? (session.clientId ? "New customer setup" : "PhantomForce Pilot"));
    setSessionToken("");
    if (session.clientId && storedBrandProfile) {
      setBrandProfiles((current) => ({ ...current, [session.clientId as string]: storedBrandProfile }));
      setCreatePrompt(
        `Create a polished launch asset for ${storedBrandProfile.businessName}: ${storedBrandProfile.offer}. Use a ${storedBrandProfile.tone} tone for ${storedBrandProfile.audience}.`,
      );
    } else if (session.clientId) {
      setCreatePrompt("After brand setup, PhantomForce will write prompts around this customer's business.");
    } else {
      setCreatePrompt("Create a 20 second product launch video with a confident voiceover and three social cutdowns.");
    }

    try {
      const response = await fetch(`${API_BASE_URL}/auth/demo-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.id }),
      });

      if (response.ok) {
        const data = (await response.json()) as { token?: string };
        setSessionToken(data.token ?? "");
      } else {
        addActivity("Signed in locally", "Backend auth token was not issued; API requests will fail closed.", "warn");
      }
    } catch {
      addActivity("Signed in locally", "Backend auth service is offline; API requests will fail closed.", "warn");
    }

    setSignedIn(true);
    setRoute("command");
  }

  function completeBrandOnboarding(clientId: string, profile: BrandProfile) {
    saveBrandProfile(clientId, profile);
    setBrandProfiles((current) => ({ ...current, [clientId]: profile }));
    setSelectedOrg(profile.businessName);
    setRoute("command");
    setCreatePrompt(
      `Create a polished launch asset for ${profile.businessName}: ${profile.offer}. Use a ${profile.tone} tone for ${profile.audience}.`,
    );
    setClientAccess((current) =>
      current.map((client) =>
        client.id === clientId
          ? {
              ...client,
              business: profile.businessName,
              plan: profile.planId === "free" ? "Free preview" : profile.planId === "starter" ? "$49 Starter" : "$199 Growth",
              lastAudit: "Brand identity captured during first-run onboarding",
            }
          : client,
      ),
    );
    addActivity("Brand setup completed", `${profile.businessName} is ready for a clean workspace.`, "ok");
  }

  async function refreshWorkspaceModule(clientId: string, moduleKey?: string) {
    if (!moduleKey) {
      setWorkspaceModuleView(null);
      return;
    }

    try {
      const response = await fetch(
        `${API_BASE_URL}/client-workspaces/${clientId}/modules/${encodeURIComponent(moduleKey)}`,
        {
          headers: sessionHeaders(),
        },
      );

      const data = (await response.json()) as { moduleView?: WorkspaceModuleView };

      if (response.ok && data.moduleView) {
        setWorkspaceModuleView(data.moduleView);
        return;
      }
    } catch {
      addActivity("Module handler offline", "The guarded module payload is waiting on the backend.", "warn");
    }

    setWorkspaceModuleView(null);
  }

  async function refreshGuardedWorkspace(clientId = activeSession.clientId ?? "client-sports-demo") {
    try {
      const response = await fetch(`${API_BASE_URL}/client-workspaces/${clientId}`, {
        headers: sessionHeaders(),
      });
      const data = (await response.json()) as {
        workspace?: {
          id: string;
          business: string;
          mode: GuardedWorkspace["mode"];
          modules: string[];
        };
        decision?: {
          mode: GuardedWorkspace["mode"];
          modules?: string[];
          reason: string;
        };
        record?: {
          id: string;
          business: string;
        };
      };

      if (response.ok && data.workspace) {
        const modules = data.workspace.modules;
        setGuardedWorkspace({
          id: data.workspace.id,
          business: data.workspace.business,
          mode: data.workspace.mode,
          modules,
          reason: data.decision?.reason ?? "Workspace request allowed.",
        });
        const preferredModule = modules.includes("Calendar") ? "Calendar" : modules[0];
        void refreshWorkspaceModule(data.workspace.id, preferredModule);
        return;
      }

      if (data.record && data.decision) {
        const modules = data.decision.modules ?? [];
        setGuardedWorkspace({
          id: data.record.id,
          business: data.record.business,
          mode: data.decision.mode,
          modules,
          reason: data.decision.reason,
        });
        setWorkspaceModuleView(null);
      }
    } catch {
      setGuardedWorkspace({
        id: clientId,
        business: "Sports Ops Demo",
        mode: "blocked",
        modules: [],
        reason: "Backend guard unavailable; production should fail closed.",
      });
      setWorkspaceModuleView(null);
    }
  }

  async function refreshPangolinPlan() {
    if (!canManageAccess) {
      setPangolinPlan([]);
      setPangolinStatus(null);
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/pangolin/reconcile/dry-run`, {
        headers: sessionHeaders(),
      });

      if (response.status === 403) {
        setPangolinPlan([]);
        return;
      }

      if (!response.ok) return;

      const data = (await response.json()) as { plans?: PangolinRoutePlan[] };
      if (Array.isArray(data.plans)) {
        setPangolinPlan(data.plans);
      }
    } catch {
      addActivity("Pangolin dry-run offline", "Gateway route planning is waiting on the backend.", "warn");
    }

    try {
      const response = await fetch(`${API_BASE_URL}/pangolin/status/read-only`, {
        headers: sessionHeaders(),
      });

      if (!response.ok) return;

      const data = (await response.json()) as { status?: PangolinReadOnlyStatus };
      if (data.status) {
        setPangolinStatus(data.status);
      }
    } catch {
      addActivity("Pangolin status offline", "Read-only gateway verification is waiting on the backend.", "warn");
    }
  }

  async function refreshReadinessReport() {
    if (!canManageAccess) {
      setReadinessReport(null);
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/readiness`, {
        headers: sessionHeaders(),
      });

      if (!response.ok) {
        setReadinessReport(null);
        return;
      }

      const data = (await response.json()) as { report?: ProductionReadinessReport };
      setReadinessReport(data.report ?? null);
    } catch {
      addActivity("Readiness API offline", "Production readiness gates are waiting on the backend.", "warn");
      setReadinessReport(null);
    }
  }

  async function refreshMediaLabCatalog() {
    setMediaLabBusy(true);

    try {
      const response = await fetch(`${API_BASE_URL}/media-lab/effects?limit=12`, {
        headers: sessionHeaders(),
      });
      const data = (await response.json()) as MediaLabCatalog & { error?: string };

      if (response.ok && data.summary) {
        setMediaLabCatalog({
          summary: data.summary,
          effects: data.effects ?? [],
          warnings: data.warnings ?? [],
        });
        return;
      }

      addActivity("Media Lab gated", data.error ?? "Effects catalog access is waiting on the backend guard.", "warn");
    } catch {
      addActivity("Media Lab offline", "The effects catalog API is waiting on the backend.", "warn");
    } finally {
      setMediaLabBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    if (!signedIn) return undefined;

    async function loadClientAccess() {
      try {
        const response = await fetch(`${API_BASE_URL}/client-access`, {
          headers: sessionHeaders(),
        });
        if (!response.ok) return;
        const data = (await response.json()) as { records?: ClientAccess[] };
        if (!cancelled && Array.isArray(data.records)) {
          setClientAccess(data.records);
        }
      } catch {
        addActivity("Access API offline", "Using local demo access state until the backend is available.", "warn");
      }
    }

    void loadClientAccess();
    void refreshGuardedWorkspace();
    if (canManageAccess) {
      void refreshPangolinPlan();
      void refreshReadinessReport();
      void refreshLinkedClientCsvs();
    } else {
      setPangolinPlan([]);
      setReadinessReport(null);
      setLinkedClientCsvs([]);
    }

    return () => {
      cancelled = true;
    };
  }, [activeSessionId, sessionToken, signedIn]);

  useEffect(() => {
    if (!signedIn || route !== "content" || contentHubTab !== "create") return;

    void refreshMediaLabCatalog();
    void refreshVoiceboxStatus();
  }, [contentHubTab, route, sessionToken, signedIn]);

  useEffect(() => {
    if (!signedIn || (route !== "analytics" && route !== "connections")) return;

    void refreshSocialAnalytics();
  }, [route, sessionToken, signedIn]);

  useEffect(() => {
    if (!signedIn || route !== "play") return;

    void refreshPhantomPlay();
  }, [route, sessionToken, signedIn]);

  async function refreshPhantomPlay() {
    try {
      const response = await fetch(`${API_BASE_URL}/phantomplay/snapshot`, {
        headers: sessionHeaders(),
      });
      const data = (await response.json()) as ({ ok?: boolean; reason?: string } & Partial<PhantomPlaySnapshot>);

      if (!response.ok || !data.product || !data.policy || !Array.isArray(data.games)) {
        throw new Error(data.reason ?? "PhantomPlay snapshot failed.");
      }

      setPhantomPlaySnapshot(data as PhantomPlaySnapshot);
      setPhantomPlayStatus(
        data.policy.accessMode === "disabled"
          ? "Disabled by default for business orgs. Admin can enable it when ready."
          : "Ready for instant browser play.",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "PhantomPlay backend unavailable.";
      setPhantomPlayStatus(message);
    }
  }

  async function updatePhantomPlayAccessMode(accessMode: PhantomPlayAccessMode) {
    setPhantomPlayBusy(true);

    try {
      const response = await fetch(`${API_BASE_URL}/phantomplay/policy`, {
        method: "POST",
        headers: sessionHeaders(true),
        body: JSON.stringify({ accessMode }),
      });
      const data = (await response.json()) as { policy?: PhantomPlayPolicy; error?: string };

      if (!response.ok || !data.policy) {
        throw new Error(data.error ?? "PhantomPlay policy update failed.");
      }

      setPhantomPlaySnapshot((current) => (current ? { ...current, policy: data.policy! } : current));
      setPhantomPlayStatus(`PhantomPlay policy set to ${humanizeSlug(accessMode)}.`);
      addActivity("PhantomPlay policy updated", `Access mode: ${humanizeSlug(accessMode)}.`, "ok");
    } catch (error) {
      const message = error instanceof Error ? error.message : "PhantomPlay policy update failed.";
      setPhantomPlayStatus(message);
      addActivity("PhantomPlay policy failed", message, "warn");
    } finally {
      setPhantomPlayBusy(false);
    }
  }

  async function launchPhantomPlayGame(gameId: string) {
    setPhantomPlayBusy(true);

    try {
      const response = await fetch(`${API_BASE_URL}/phantomplay/sessions`, {
        method: "POST",
        headers: sessionHeaders(true),
        body: JSON.stringify({ gameId, hasActiveBackgroundJob }),
      });
      const data = (await response.json()) as { playSession?: { id: string }; reason?: string; error?: string };

      if (!response.ok || !data.playSession) {
        throw new Error(data.reason ?? data.error ?? "PhantomPlay launch failed.");
      }

      setPhantomPlayStatus(`Ghost Solitaire session started. Session ${data.playSession.id}.`);
      addActivity("PhantomPlay launched", "Ghost Solitaire started in the Break Room.", "info");
    } catch (error) {
      const message = error instanceof Error ? error.message : "PhantomPlay launch failed.";
      setPhantomPlayStatus(message);
      addActivity("PhantomPlay launch blocked", message, "warn");
    } finally {
      setPhantomPlayBusy(false);
    }
  }

  async function refreshVoiceboxStatus() {
    try {
      const response = await fetch(`${API_BASE_URL}/voicebox/status`, {
        headers: sessionHeaders(),
      });
      const data = (await response.json()) as { status?: VoiceboxRuntimeStatus };

      if (response.ok && data.status) {
        setVoiceboxStatus(data.status);
        return;
      }
    } catch {
      // The UI falls back to the unavailable status below.
    }

    setVoiceboxStatus({
      configured: true,
      reachable: false,
      baseUrl: "http://127.0.0.1:17600",
      profiles: 0,
      reason: "PhantomForce could not reach the Voicebox adapter.",
    });
  }

  async function refreshSocialAnalytics() {
    setSocialAnalyticsBusy(true);
    try {
      const [statusResponse, summaryResponse] = await Promise.all([
        fetch(`${API_BASE_URL}/analytics/social/status`, { headers: sessionHeaders() }),
        fetch(`${API_BASE_URL}/analytics/social/summary`, { headers: sessionHeaders() }),
      ]);
      const statusData = (await statusResponse.json()) as { providers?: SocialProviderStatus[]; error?: string };
      const summaryData = (await summaryResponse.json()) as { snapshot?: SocialAnalyticsSnapshot; error?: string };

      if (!statusResponse.ok) throw new Error(statusData.error ?? "Social connector status is unavailable.");
      if (!summaryResponse.ok) throw new Error(summaryData.error ?? "Social analytics are unavailable.");

      setSocialProviders(statusData.providers ?? []);
      setSocialAnalytics(summaryData.snapshot ?? null);
      setSocialAnalyticsStatus(summaryData.snapshot?.reason ?? "Social analytics loaded.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Social analytics are offline.";
      setSocialAnalyticsStatus(message);
      addActivity("Social analytics offline", message, "warn");
    } finally {
      setSocialAnalyticsBusy(false);
    }
  }

  async function connectAllSocials() {
    setSocialAnalyticsBusy(true);
    try {
      const response = await fetch(`${API_BASE_URL}/analytics/social/oauth-all`, {
        method: "POST",
        headers: sessionHeaders(true),
        body: JSON.stringify({}),
      });
      const data = (await response.json()) as { attempts?: SocialOauthAttempt[]; providers?: SocialProviderStatus[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not start social OAuth.");

      const attempts = data.attempts ?? [];
      setSocialOauthAttempts(attempts);
      setSocialProviders(data.providers ?? []);

      const openable = attempts.filter((attempt) => attempt.status === "ready_to_open_oauth" && attempt.authUrl);
      openable.forEach((attempt) => {
        window.open(attempt.authUrl as string, `_blank`, "noopener,noreferrer");
      });

      const missing = attempts.filter((attempt) => attempt.status === "missing_oauth_config").length;
      const already = attempts.filter((attempt) => attempt.status === "already_connected").length;
      const detail = openable.length
        ? `Opened ${openable.length} OAuth windows. ${missing} providers still need app credentials.`
        : already
          ? `${already} providers are already connected. ${missing} providers need app credentials.`
          : `${missing} providers need OAuth app credentials before PhantomForce can open login.`;

      setSocialAnalyticsStatus(detail);
      addActivity("Connect all socials attempted", detail, missing ? "warn" : "ok");
      void refreshSocialAnalytics();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Connect all socials failed.";
      setSocialAnalyticsStatus(message);
      addActivity("Connect all socials failed", message, "warn");
    } finally {
      setSocialAnalyticsBusy(false);
    }
  }

  async function startCreateJob() {
    const prompt = createPrompt.trim();
    if (!prompt) return;

    const modeLabels: Record<CreateMode, string> = {
      photo: "AI photo set",
      video: "AI video package",
      voice: "Voice generation",
    };
    const engines: Record<CreateMode, string> = {
      photo: "Image generator",
      video: "Video generator + Voicebox voice track",
      voice: "jamiepine/voicebox",
    };
    const job: CreateJob = {
      id: makeId("create"),
      workspaceId: activeWorkspaceId,
      mode: createMode,
      title: modeLabels[createMode],
      prompt,
      status: "queued",
      createdAt: "Just now",
      engine: engines[createMode],
    };

    setCreateJobs((current) => [job, ...current]);
    setCreatePrompt("");
    addActivity(`${modeLabels[createMode]} queued`, "Media Lab will notify you when the generation is ready.", "info");

    if (createMode === "voice") {
      setCreateJobs((current) =>
        current.map((item) => (item.id === job.id ? { ...item, status: "rendering" } : item)),
      );

      try {
        const response = await fetch(`${API_BASE_URL}/content/create/voice`, {
          method: "POST",
          headers: sessionHeaders(true),
          body: JSON.stringify({
            text: prompt,
            language: "en",
          }),
        });
        const data = (await response.json()) as {
          generation?: {
            id: string;
            status: string;
            profile: string | null;
            engine: string | null;
            audioUrl: string;
            statusUrl: string;
          };
          error?: string;
        };

        if (!response.ok || !data.generation) {
          throw new Error(data.error ?? "Voicebox did not accept the voice generation job.");
        }

        setCreateJobs((current) =>
          current.map((item) =>
            item.id === job.id
              ? {
                  ...item,
                  status: data.generation?.status === "completed" ? "ready" : "rendering",
                  engine: data.generation?.engine
                    ? `Voicebox / ${data.generation.engine}`
                    : "jamiepine/voicebox",
                  audioUrl: data.generation?.audioUrl,
                  statusUrl: data.generation?.statusUrl,
                }
              : item,
          ),
        );
        addActivity("Voicebox voice job submitted", "Voicebox accepted the prompt and is generating speech.", "ok");
        void refreshVoiceboxStatus();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Voicebox voice generation failed.";
        setCreateJobs((current) =>
          current.map((item) => (item.id === job.id ? { ...item, status: "failed", error: message } : item)),
        );
        addActivity("Voicebox voice generation failed", message, "warn");
      }
      return;
    }

    window.setTimeout(() => {
      setCreateJobs((current) =>
        current.map((item) => (item.id === job.id ? { ...item, status: "rendering" } : item)),
      );
    }, 900);

    window.setTimeout(() => {
      setCreateJobs((current) =>
        current.map((item) =>
          item.id === job.id ? { ...item, status: "ready", completedAt: "Just now" } : item,
        ),
      );
      addActivity(`${modeLabels[createMode]} ready`, "Open Media Lab to review, edit, and publish the finished asset.", "ok");
    }, 3200);
  }

  const stats = useMemo(() => {
    return {
      urgent: emails.filter((email) => email.status === "needs-reply").length,
      pending: approvals.filter((approval) => approval.status === "pending").length,
      today: tasks.filter((task) => task.status === "today").length,
      events: events.length,
      revoked: clientAccess.filter((client) => client.accessStatus === "revoked").length,
    };
  }, [emails, approvals, tasks, events, clientAccess]);

  function addActivity(title: string, detail: string, level: ActivityLevel = "info") {
    setActivity((current) => [
      {
        id: makeId("act"),
        title,
        detail,
        time: "Just now",
        level,
      },
      ...current,
    ]);
  }

  function upsertClientAccessRecord(record: ClientAccess) {
    setClientAccess((current) => {
      const exists = current.some((item) => item.id === record.id);
      return exists ? current.map((item) => (item.id === record.id ? record : item)) : [record, ...current];
    });
  }

  async function refreshLinkedClientCsvs() {
    if (!canManageAccess) return;

    try {
      const response = await fetch(`${API_BASE_URL}/client-access/csv-links`, {
        headers: sessionHeaders(),
      });
      const data = (await response.json()) as { links?: LinkedClientCsv[] };

      if (response.ok && Array.isArray(data.links)) {
        setLinkedClientCsvs(data.links);
      }
    } catch {
      addActivity("CSV links offline", "Linked client CSV paths are waiting on the backend.", "warn");
    }
  }

  async function importClientCsvText(csv: string, filename = "dropped-client-list.csv") {
    if (!csv.trim()) return;
    setClientCsvBusy(true);
    setClientCsvStatus(`Importing ${filename}...`);

    try {
      const response = await fetch(`${API_BASE_URL}/client-access/csv-import`, {
        method: "POST",
        headers: sessionHeaders(true),
        body: JSON.stringify({ csv, filename }),
      });
      const data = (await response.json()) as {
        imported?: ClientAccess[];
        records?: ClientAccess[];
        rows?: number;
        skipped?: unknown[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "CSV import failed.");
      }

      if (Array.isArray(data.records)) {
        setClientAccess(data.records);
      }

      const imported = data.imported?.length ?? 0;
      const skipped = data.skipped?.length ?? 0;
      setClientCsvStatus(`Updated ${imported} clients from ${filename}${skipped ? `; skipped ${skipped}` : ""}.`);
      addActivity("Client CSV imported", `${filename}: ${imported} clients updated.`, "ok");
    } catch (error) {
      const message = error instanceof Error ? error.message : "CSV import failed.";
      setClientCsvStatus(message);
      addActivity("CSV import failed", message, "warn");
    } finally {
      setClientCsvBusy(false);
    }
  }

  async function importClientCsvFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setClientCsvStatus("Drop a .csv file to update clients.");
      return;
    }

    await importClientCsvText(await file.text(), file.name);
  }

  async function linkClientCsv(path: string, label?: string) {
    if (!path.trim()) {
      setClientCsvStatus("Paste a local CSV path first.");
      return;
    }

    setClientCsvBusy(true);

    try {
      const response = await fetch(`${API_BASE_URL}/client-access/csv-links`, {
        method: "POST",
        headers: sessionHeaders(true),
        body: JSON.stringify({ path: path.trim(), label: label?.trim() || "Linked client CSV" }),
      });
      const data = (await response.json()) as { links?: LinkedClientCsv[]; error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "CSV link failed.");
      }

      setLinkedClientCsvs(data.links ?? []);
      setClientCsvStatus("CSV linked. Use Sync to refresh clients from that file.");
      addActivity("Client CSV linked", path.trim(), "ok");
    } catch (error) {
      const message = error instanceof Error ? error.message : "CSV link failed.";
      setClientCsvStatus(message);
      addActivity("CSV link failed", message, "warn");
    } finally {
      setClientCsvBusy(false);
    }
  }

  async function syncLinkedClientCsv(id?: string) {
    setClientCsvBusy(true);
    setClientCsvStatus("Syncing linked CSV...");

    try {
      const response = await fetch(`${API_BASE_URL}/client-access/csv-links/sync`, {
        method: "POST",
        headers: sessionHeaders(true),
        body: JSON.stringify({ id }),
      });
      const data = (await response.json()) as {
        imported?: ClientAccess[];
        records?: ClientAccess[];
        links?: LinkedClientCsv[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "CSV sync failed.");
      }

      if (Array.isArray(data.records)) {
        setClientAccess(data.records);
      }
      setLinkedClientCsvs(data.links ?? []);
      setClientCsvStatus(`Synced ${data.imported?.length ?? 0} clients from linked CSV.`);
      addActivity("Linked CSV synced", `${data.imported?.length ?? 0} clients updated.`, "ok");
    } catch (error) {
      const message = error instanceof Error ? error.message : "CSV sync failed.";
      setClientCsvStatus(message);
      addActivity("CSV sync failed", message, "warn");
    } finally {
      setClientCsvBusy(false);
    }
  }

  function createFollowUpPlan(source = "command") {
    const targetEmail = emails.find((email) => email.status === "needs-reply") || emails[0];
    const emailApproval: Approval = {
      id: makeId("approval-email"),
      kind: "email",
      title: `Send reply to ${targetEmail.from}`,
      summary: "Confirm next-week availability, offer two call windows, and ask for final shoot details.",
      payload: {
        recipient: targetEmail.from,
        subject: `Re: ${targetEmail.subject}`,
        body:
          "Thanks for the details. I can hold Tuesday at 10:30 AM or Wednesday at 2:00 PM for a quick planning call. Send the final shoot requirements and I will lock the path from there.",
      },
      reversible: false,
      status: "pending",
    };
    const calendarApproval: Approval = {
      id: makeId("approval-calendar"),
      kind: "calendar",
      title: "Create planning call",
      summary: "Place a tentative call on the calendar after the client confirms the preferred slot.",
      payload: {
        title: `Planning call with ${targetEmail.from}`,
        time: "Next Tue 10:30 AM",
        participants: targetEmail.from,
      },
      reversible: true,
      status: "pending",
    };

    setApprovals((current) => [emailApproval, calendarApproval, ...current]);
    setMessages((current) => [
      ...current,
      {
        id: makeId("msg-assistant"),
        role: "assistant",
        content:
          source === "demo"
            ? "Demo flow ready: I found Maya's follow-up, drafted the reply, checked the calendar, and created two approval cards. Nothing external happens until you approve."
            : "I found the best next action: reply to Maya and reserve a call window. I prepared an email and a calendar event for approval. No external action has been taken.",
      },
    ]);
    addActivity("Approval cards created", "Email and calendar actions are waiting for review.", "ok");
    setRoute("command");
  }

  function submitCommand(event: FormEvent) {
    event.preventDefault();
    const text = commandText.trim();
    if (!text) return;
    setCommandText("");
    setMessages((current) => [...current, { id: makeId("msg-user"), role: "user", content: text }]);

    const lower = text.toLowerCase();
    if (lower.includes("schedule") || lower.includes("follow") || lower.includes("handle") || lower.includes("email")) {
      createFollowUpPlan();
      return;
    }

    if (lower.includes("brief") || lower.includes("today")) {
      setMessages((current) => [
        ...current,
        {
          id: makeId("msg-assistant"),
          role: "assistant",
          content:
            "Today needs focus on 2 replies, 3 active tasks, and 1 calendar hold. The fastest win is approving the client follow-up package, then clearing the Air Authority reply.",
        },
      ]);
      addActivity("Brief requested", "Assistant summarized the current operational load.", "info");
      return;
    }

    setMessages((current) => [
      ...current,
      {
        id: makeId("msg-assistant"),
        role: "assistant",
        content:
          "I can help with that. For this first build, I can brief the day, find follow-ups, create approval cards, organize tasks, and prepare email/calendar actions for review.",
      },
    ]);
  }

  function approveAction(id: string) {
    const approval = approvals.find((item) => item.id === id);
    if (!approval) return;

    setApprovals((current) =>
      current.map((item) => (item.id === id ? { ...item, status: "approved" } : item)),
    );

    if (approval.kind === "email") {
      setEmails((current) =>
        current.map((email) =>
          approval.payload.recipient === email.from ? { ...email, status: "handled" } : email,
        ),
      );
    }

    if (approval.kind === "calendar") {
      setEvents((current) => [
        {
          id: makeId("event"),
          title: approval.payload.title,
          time: approval.payload.time,
          owner: approval.payload.participants,
          status: "confirmed",
        },
        ...current,
      ]);
    }

    if (approval.kind === "task") {
      setTasks((current) => [
        {
          id: makeId("task"),
          title: approval.payload.title,
          owner: "PhantomForce",
          due: approval.payload.due,
          status: "queued",
        },
        ...current,
      ]);
    }

    addActivity("Approved action executed", approval.title, "ok");
  }

  function rejectAction(id: string) {
    const approval = approvals.find((item) => item.id === id);
    setApprovals((current) =>
      current.map((item) => (item.id === id ? { ...item, status: "rejected" } : item)),
    );
    if (approval) addActivity("Action rejected", approval.title, "warn");
  }

  function completeTask(id: string) {
    setTasks((current) =>
      current.map((task) => (task.id === id ? { ...task, status: "done" } : task)),
    );
    addActivity("Task completed", "A task was marked complete from the PhantomForce app.", "ok");
  }

  async function updateClientAccess(id: string, nextStatus: ClientAccessStatus) {
    const client = clientAccess.find((item) => item.id === id);
    const reason =
      nextStatus === "active"
        ? "Jordan restored paid private access"
        : nextStatus === "past_due"
          ? "Jordan marked account past due"
          : "Jordan revoked private route for non-payment";

    try {
      const proposalResponse = await fetch(`${API_BASE_URL}/client-access/${id}/status/propose`, {
        method: "POST",
        headers: sessionHeaders(true),
        body: JSON.stringify({
          accessStatus: nextStatus,
          reason,
          proposedBy: "Jordan",
        }),
      });

      if (!proposalResponse.ok) {
        addActivity("Access request blocked", "This session cannot propose client access changes.", "warn");
        return;
      }

      const proposalData = (await proposalResponse.json()) as {
        approval?: { id: string };
      };

      if (!proposalData.approval?.id) {
        throw new Error("Access API did not return an approval.");
      }

      const approvalResponse = await fetch(
        `${API_BASE_URL}/client-access-approvals/${proposalData.approval.id}/decision`,
        {
          method: "POST",
          headers: sessionHeaders(true),
          body: JSON.stringify({
            decision: "approve",
            decidedBy: "Jordan",
            reason,
          }),
        },
      );

      if (approvalResponse.ok) {
        const data = (await approvalResponse.json()) as { record?: ClientAccess };
        if (data.record) {
          upsertClientAccessRecord(data.record);
        }
      } else {
        addActivity("Access approval blocked", "This session cannot approve client access changes.", "warn");
        return;
      }
    } catch {
      setClientAccess((current) =>
        current.map((item) => {
          if (item.id !== id) return item;
          const paymentStatus: PaymentStatus =
            nextStatus === "active" ? "paid" : nextStatus === "past_due" ? "due" : "failed";

          return {
            ...item,
            accessStatus: nextStatus,
            paymentStatus,
            lastAudit: reason,
          };
        }),
      );
    }

    if (client) {
      const detail =
        nextStatus === "active"
          ? `${client.business} can access the dashboard through the private gateway.`
          : nextStatus === "past_due"
            ? `${client.business} is flagged past due before full revocation.`
            : `${client.business} is blocked from the private dashboard route.`;
      addActivity("Client access updated", detail, nextStatus === "revoked" ? "warn" : "ok");
    }

    void refreshGuardedWorkspace(id);
    void refreshPangolinPlan();
  }

  async function updateClientModule(id: string, moduleKey: string, enabled: boolean) {
    const client = clientAccess.find((item) => item.id === id);
    const reason = enabled
      ? `Jordan enabled ${moduleKey} for this package`
      : `Jordan disabled ${moduleKey} for this package`;

    try {
      const proposalResponse = await fetch(
        `${API_BASE_URL}/client-access/${id}/modules/${encodeURIComponent(moduleKey)}/propose`,
        {
          method: "POST",
          headers: sessionHeaders(true),
          body: JSON.stringify({
            enabled,
            reason,
            proposedBy: "Jordan",
          }),
        },
      );

      if (!proposalResponse.ok) {
        addActivity("Module request blocked", "This session cannot propose module entitlement changes.", "warn");
        return;
      }

      const proposalData = (await proposalResponse.json()) as {
        approval?: { id: string };
      };

      if (!proposalData.approval?.id) {
        throw new Error("Access API did not return a module approval.");
      }

      const approvalResponse = await fetch(
        `${API_BASE_URL}/client-access-approvals/${proposalData.approval.id}/decision`,
        {
          method: "POST",
          headers: sessionHeaders(true),
          body: JSON.stringify({
            decision: "approve",
            decidedBy: "Jordan",
            reason,
          }),
        },
      );

      if (!approvalResponse.ok) {
        addActivity("Module approval blocked", "This session cannot approve module entitlement changes.", "warn");
        return;
      }

      const data = (await approvalResponse.json()) as { record?: ClientAccess };
      if (data.record) {
        upsertClientAccessRecord(data.record);
      }
    } catch {
      setClientAccess((current) =>
        current.map((item) => {
          if (item.id !== id) return item;

          const normalized = normalizeModuleKey(moduleKey);
          const hasModule = item.modules.some((module) => normalizeModuleKey(module) === normalized);
          const modules = enabled
            ? hasModule
              ? item.modules
              : [...item.modules, moduleKey]
            : item.modules.filter((module) => normalizeModuleKey(module) !== normalized);

          return {
            ...item,
            modules,
            lastAudit: reason,
          };
        }),
      );
    }

    if (client) {
      addActivity(
        enabled ? "Client module enabled" : "Client module disabled",
        `${moduleKey} ${enabled ? "enabled for" : "removed from"} ${client.business}.`,
        enabled ? "ok" : "warn",
      );
    }

    void refreshGuardedWorkspace(id);
    void refreshPangolinPlan();
  }

  async function provisionMoneyDemo(paymentStatus: PaymentStatus) {
    const paid = paymentStatus === "paid";
    const reason = paid
      ? "money demo payment received from NexProspex close"
      : "money demo signed agreement before payment clears";
    const proposalResponse = await fetch(`${API_BASE_URL}/client-provisioning/propose`, {
      method: "POST",
      headers: sessionHeaders(true),
      body: JSON.stringify({
        clientId: MONEY_DEMO_CLIENT_ID,
        business: "Money Demo Athletics",
        owner: "New Client Owner",
        plan: "$2,000 Launch Ops",
        source: "nexprospex",
        sourceRecordId: paid ? "nxp-money-demo-paid" : "nxp-money-demo-signed",
        winStatus: paid ? "payment_received" : "signed_agreement",
        paymentStatus,
        modules: ["Command", "Calendar", "Tasks", "Approvals", "Contacts"],
        reason,
        proposedBy: "Jordan",
      }),
    });

    if (!proposalResponse.ok) {
      addActivity("Money demo blocked", "This session cannot propose client provisioning.", "warn");
      return;
    }

    const proposalData = (await proposalResponse.json()) as { approval?: { id: string } };
    if (!proposalData.approval?.id) {
      addActivity("Money demo blocked", "Provisioning did not return an approval card.", "warn");
      return;
    }

    const approvalResponse = await fetch(
      `${API_BASE_URL}/client-access-approvals/${proposalData.approval.id}/decision`,
      {
        method: "POST",
        headers: sessionHeaders(true),
        body: JSON.stringify({
          decision: "approve",
          decidedBy: "Jordan",
          reason,
        }),
      },
    );

    if (!approvalResponse.ok) {
      addActivity("Money demo approval blocked", "This session cannot approve provisioning.", "warn");
      return;
    }

    const data = (await approvalResponse.json()) as { record?: ClientAccess };
    if (data.record) {
      upsertClientAccessRecord(data.record);
      addActivity(
        paid ? "Money demo active" : "Money demo blocked",
        paid
          ? "Payment received; workspace, modules, private route, and Calendar boundary are active."
          : "Signed lead is provisioned but blocked until payment clears.",
        paid ? "ok" : "warn",
      );
    }

    await refreshGuardedWorkspace(MONEY_DEMO_CLIENT_ID);
    await refreshPangolinPlan();
  }

  async function runMoneyDemoStage(stage: MoneyDemoStage) {
    setMoneyDemoBusy(stage);

    try {
      if (stage === "signed") {
        await provisionMoneyDemo("due");
        return;
      }

      if (stage === "paid") {
        await provisionMoneyDemo("paid");
        await refreshWorkspaceModule(MONEY_DEMO_CLIENT_ID, "Calendar");
        return;
      }

      const nextStatus: ClientAccessStatus =
        stage === "past_due" ? "past_due" : stage === "revoked" ? "revoked" : "active";
      await updateClientAccess(MONEY_DEMO_CLIENT_ID, nextStatus);
      await refreshGuardedWorkspace(MONEY_DEMO_CLIENT_ID);

      if (stage === "restored") {
        await refreshWorkspaceModule(MONEY_DEMO_CLIENT_ID, "Calendar");
      }
    } finally {
      setMoneyDemoBusy(null);
    }
  }

  if (!signedIn) {
    return (
      <LoginScreen
        activeSessionId={activeSessionId}
        sessions={initialSessions}
        setActiveSessionId={setActiveSessionId}
        onSignIn={signIn}
      />
    );
  }

  if (needsBrandOnboarding && activeSession.clientId) {
    return (
      <BrandOnboardingScreen
        session={activeSession}
        onComplete={(profile) => completeBrandOnboarding(activeSession.clientId as string, profile)}
        onBack={() => {
          setSignedIn(false);
          setSessionToken("");
          setSelectedOrg("PhantomForce Pilot");
        }}
      />
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <div className="brand-mark">
            <Sparkles size={22} />
          </div>
          <div>
            <strong>PhantomForce</strong>
            <span>AI operations app</span>
          </div>
        </div>

        <div className="org-switcher">
          <span>Organization</span>
          <select
            value={selectedOrg}
            onChange={(event) => setSelectedOrg(event.target.value)}
            disabled={!canManageAccess}
          >
            <option>PhantomForce Pilot</option>
            <option>ChicagoShots</option>
            <option>Sports Ops Demo</option>
            {!canManageAccess ? <option>{selectedOrg}</option> : null}
          </select>
        </div>

        <nav className="side-nav" aria-label="Main navigation">
          {navItems.map((item) => (
            <button
              key={item.id}
              className={route === item.id ? "active" : ""}
              type="button"
              onClick={() => setRoute(item.id)}
              title={item.label}
            >
              {item.icon}
              <span>{item.label}</span>
              {item.id === "approvals" && stats.pending > 0 ? <b>{stats.pending}</b> : null}
            </button>
          ))}
        </nav>

        <div className="engine-card">
          <div>
            <span className="status-dot locked" />
            <p>Falcon worker</p>
          </div>
          <strong>Private boundary</strong>
          <small>Typed jobs later. No raw console, files, logs, or shell access in the client app.</small>
        </div>
      </aside>

      <main className="workspace">
        <Topbar
          activeSession={activeSession}
          selectedOrg={selectedOrg}
          pending={stats.pending}
          openSettings={() => setRoute("settings")}
        />
        {route === "command" ? (
          <CommandCenter
            messages={messages}
            commandText={commandText}
            setCommandText={setCommandText}
            submitCommand={submitCommand}
            createFollowUpPlan={() => createFollowUpPlan("demo")}
            stats={stats}
            approvals={approvals}
            approveAction={approveAction}
            rejectAction={rejectAction}
            emails={emails}
            events={events}
          />
        ) : null}
        {route === "analytics" ? (
          <SocialAnalyticsView
            snapshot={socialAnalytics}
            providers={socialProviders}
            attempts={socialOauthAttempts}
            busy={socialAnalyticsBusy}
            status={socialAnalyticsStatus}
            refresh={refreshSocialAnalytics}
            connectAll={connectAllSocials}
          />
        ) : null}
        {route === "content" ? (
          <ContentHubView
            activeTab={contentHubTab}
            setActiveTab={setContentHubTab}
            createMode={createMode}
            setCreateMode={setCreateMode}
            createPrompt={createPrompt}
            setCreatePrompt={setCreatePrompt}
            createJobs={workspaceCreateJobs}
            startCreateJob={startCreateJob}
            voiceboxStatus={voiceboxStatus}
            refreshVoiceboxStatus={refreshVoiceboxStatus}
            catalog={mediaLabCatalog}
            busy={mediaLabBusy}
            refreshCatalog={refreshMediaLabCatalog}
          />
        ) : null}
        {route === "play" ? (
          <PhantomPlayView
            snapshot={phantomPlaySnapshot}
            status={phantomPlayStatus}
            busy={phantomPlayBusy}
            canManageAccess={canManageAccess}
            hasActiveBackgroundJob={hasActiveBackgroundJob}
            refresh={refreshPhantomPlay}
            updateAccessMode={updatePhantomPlayAccessMode}
            launchGame={launchPhantomPlayGame}
            openWork={() => setRoute("content")}
          />
        ) : null}
        {route === "inbox" ? <InboxView emails={emails} createFollowUpPlan={createFollowUpPlan} /> : null}
        {route === "calendar" ? <CalendarView events={events} /> : null}
        {route === "tasks" ? <TasksView tasks={tasks} completeTask={completeTask} /> : null}
        {route === "approvals" ? (
          <ApprovalsView approvals={approvals} approveAction={approveAction} rejectAction={rejectAction} />
        ) : null}
        {route === "access" ? (
          <AccessView
            canManageAccess={canManageAccess}
            clientAccess={visibleClientAccess}
            guardedWorkspace={guardedWorkspace}
            workspaceModuleView={workspaceModuleView}
            pangolinPlan={pangolinPlan}
            pangolinStatus={pangolinStatus}
            readinessReport={readinessReport}
            linkedClientCsvs={linkedClientCsvs}
            clientCsvBusy={clientCsvBusy}
            clientCsvStatus={clientCsvStatus}
            refreshGuardedWorkspace={refreshGuardedWorkspace}
            refreshWorkspaceModule={refreshWorkspaceModule}
            refreshReadinessReport={refreshReadinessReport}
            updateClientAccess={updateClientAccess}
            updateClientModule={updateClientModule}
            runMoneyDemoStage={runMoneyDemoStage}
            importClientCsvFile={importClientCsvFile}
            linkClientCsv={linkClientCsv}
            syncLinkedClientCsv={syncLinkedClientCsv}
            moneyDemoBusy={moneyDemoBusy}
          />
        ) : null}
        {route === "activity" ? <ActivityView activity={activity} /> : null}
        {route === "connections" ? (
          <ConnectionsView socialProviders={socialProviders} connectAll={connectAllSocials} />
        ) : null}
        {route === "settings" ? (
          <SettingsView
            category={settingsCategory}
            setCategory={setSettingsCategory}
            workspaceDraft={workspaceDesignerDraft}
            setWorkspaceDraft={(patch) => {
              setWorkspaceDesignerDraft((current) => ({ ...current, ...patch }));
              setWorkspacePublishState("draft");
            }}
            workspacePreview={workspaceDesignerPreview}
            publishState={workspacePublishState}
            previewWorkspace={() => {
              setWorkspaceDesignerPreview(workspaceDesignerDraft);
              setWorkspacePublishState("previewed");
              addActivity("Workspace preview generated", "Workspace Designer is ready to publish after review.", "info");
            }}
            publishWorkspace={() => {
              if (workspacePublishState !== "previewed") {
                addActivity("Publish blocked", "Preview the workspace before publishing changes.", "warn");
                return;
              }
              setWorkspacePublishState("published");
              addActivity("Workspace published", `${workspaceDesignerDraft.name} changes were published.`, "ok");
            }}
          />
        ) : null}
      </main>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        {navItems.slice(0, 5).map((item) => (
          <button
            key={item.id}
            className={route === item.id ? "active" : ""}
            type="button"
            onClick={() => setRoute(item.id)}
            title={item.label}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

function BrandOnboardingScreen({
  session,
  onComplete,
  onBack,
}: {
  session: AppSession;
  onComplete: (profile: BrandProfile) => void;
  onBack: () => void;
}) {
  const [step, setStep] = useState<"identity" | "plan">("identity");
  const [draft, setDraft] = useState({
    businessName: "",
    industry: "",
    audience: "",
    offer: "",
    tone: "",
    colors: "",
    goals: "",
  });
  const [planId, setPlanId] = useState<BrandProfile["planId"]>("free");

  const readyForPlan = Object.values(draft).every((value) => value.trim().length > 0);
  const planOptions: Array<{
    id: BrandProfile["planId"];
    name: string;
    price: string;
    detail: string;
    icon: ReactNode;
  }> = [
    {
      id: "free",
      name: "Free preview",
      price: "$0",
      detail: "See the workspace, create sample assets, and understand the flow.",
      icon: <Sparkles size={19} />,
    },
    {
      id: "starter",
      name: "Starter",
      price: "$49",
      detail: "A focused business workspace with Media Lab and approval-gated tasks.",
      icon: <Rocket size={19} />,
    },
    {
      id: "growth",
      name: "Growth",
      price: "$199",
      detail: "More automation, publishing support, and deeper operating-room setup.",
      icon: <CreditCard size={19} />,
    },
  ];

  function updateDraft(field: keyof typeof draft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function submitIdentity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!readyForPlan) return;
    setStep("plan");
  }

  function finish() {
    onComplete({
      ...draft,
      businessName: draft.businessName.trim(),
      industry: draft.industry.trim(),
      audience: draft.audience.trim(),
      offer: draft.offer.trim(),
      tone: draft.tone.trim(),
      colors: draft.colors.trim(),
      goals: draft.goals.trim(),
      planId,
      completedAt: new Date().toISOString(),
      version: BRAND_ONBOARDING_VERSION,
    });
  }

  return (
    <main className="brand-onboarding-screen">
      <button className="ghost-small onboarding-back" type="button" onClick={onBack}>
        <ArrowRight size={15} />
        Change login
      </button>
      <section className="brand-intake-hero">
        <div className="brand-orbit" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <span className="panel-label">New customer setup</span>
        <h1>Tell PhantomForce what this business actually is.</h1>
        <p>
          {session.label} starts clean. Brand identity comes first, then plan choice, then a fresh workspace.
        </p>
        <div className="intake-progress" aria-label="Setup progress">
          <span className="active">Brand</span>
          <b />
          <span className={step === "plan" ? "active" : ""}>Plan</span>
          <b />
          <span>Workspace</span>
        </div>
      </section>

      {step === "identity" ? (
        <form className="brand-intake-panel" onSubmit={submitIdentity}>
          <div className="section-head">
            <div>
              <span className="eyebrow">Brand interview</span>
              <h2>Answer the setup questions.</h2>
            </div>
            <span className="safe-pill">
              <Lock size={15} />
              Clean account
            </span>
          </div>

          <div className="brand-question-grid">
            <label>
              <Building2 size={18} />
              Business name
              <input
                value={draft.businessName}
                onChange={(event) => updateDraft("businessName", event.target.value)}
                placeholder="Customer One Studio"
              />
            </label>
            <label>
              <Target size={18} />
              Industry
              <input
                value={draft.industry}
                onChange={(event) => updateDraft("industry", event.target.value)}
                placeholder="Restaurant, HVAC, sports team, creator brand..."
              />
            </label>
            <label>
              <Users size={18} />
              Ideal customer
              <input
                value={draft.audience}
                onChange={(event) => updateDraft("audience", event.target.value)}
                placeholder="Who should the content attract?"
              />
            </label>
            <label>
              <Sparkles size={18} />
              Main offer
              <input
                value={draft.offer}
                onChange={(event) => updateDraft("offer", event.target.value)}
                placeholder="What do they sell or want people to do?"
              />
            </label>
            <label>
              <MessageSquare size={18} />
              Voice and tone
              <input
                value={draft.tone}
                onChange={(event) => updateDraft("tone", event.target.value)}
                placeholder="Premium, funny, local, bold, calm..."
              />
            </label>
            <label>
              <Palette size={18} />
              Colors or visual identity
              <input
                value={draft.colors}
                onChange={(event) => updateDraft("colors", event.target.value)}
                placeholder="Black and gold, clean white, neon green..."
              />
            </label>
          </div>

          <label className="brand-goal-field">
            <Rocket size={18} />
            What should PhantomForce help them accomplish first?
            <textarea
              value={draft.goals}
              onChange={(event) => updateDraft("goals", event.target.value)}
              placeholder="Generate launch content, book more calls, clean up social posts, build a weekly media rhythm..."
            />
          </label>

          <button className="primary-action" type="submit" disabled={!readyForPlan}>
            <ArrowRight size={18} />
            Continue to plan
          </button>
        </form>
      ) : (
        <section className="brand-intake-panel plan-step">
          <div className="section-head">
            <div>
              <span className="eyebrow">Choose plan</span>
              <h2>Pick how {draft.businessName} starts.</h2>
            </div>
            <button className="ghost-small" type="button" onClick={() => setStep("identity")}>
              Edit answers
            </button>
          </div>

          <div className="plan-choice-grid">
            {planOptions.map((plan) => (
              <button
                className={planId === plan.id ? "plan-choice active" : "plan-choice"}
                key={plan.id}
                type="button"
                onClick={() => setPlanId(plan.id)}
              >
                <span>{plan.icon}</span>
                <strong>{plan.name}</strong>
                <b>{plan.price}</b>
                <small>{plan.detail}</small>
              </button>
            ))}
          </div>

          <div className="brand-summary-strip">
            <span>{draft.industry}</span>
            <span>{draft.audience}</span>
            <span>{draft.tone}</span>
          </div>

          <button className="primary-action" type="button" onClick={finish}>
            <Check size={18} />
            Create clean workspace
          </button>
        </section>
      )}
    </main>
  );
}

function LoginScreen({
  activeSessionId,
  sessions,
  setActiveSessionId,
  onSignIn,
}: {
  activeSessionId: string;
  sessions: AppSession[];
  setActiveSessionId: (sessionId: string) => void;
  onSignIn: (sessionId: string) => void | Promise<void>;
}) {
  return (
    <main className="login-screen">
      <section className="login-copy">
        <div className="brand-row large">
          <div className="brand-mark">
            <Sparkles size={24} />
          </div>
          <div>
            <strong>PhantomForce AI</strong>
            <span>Business command app</span>
          </div>
        </div>
        <h1>Run the business from one command center.</h1>
        <p>
          Email, scheduling, approvals, tasks, activity history, and AI-assisted operations in one mobile-ready product.
        </p>
        <div className="hero-asset">
          <img src="/assets/operator-core.png" alt="PhantomForce operator interface preview" />
        </div>
      </section>
      <section className="login-panel">
        <span className="panel-label">Pilot access</span>
        <h2>One login. One business brain.</h2>
        <label>
          Email
          <input defaultValue="jordan@phantomforce.online" />
        </label>
        <label>
          Password
          <input type="password" defaultValue="phantomforce" />
        </label>
        <label>
          Session
          <select value={activeSessionId} onChange={(event) => setActiveSessionId(event.target.value)}>
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.label}
              </option>
            ))}
          </select>
        </label>
        <button className="primary-action" type="button" onClick={() => void onSignIn(activeSessionId)}>
          <KeyRound size={18} />
          Enter PhantomForce
        </button>
        <p className="account-disclaimer">
          By creating an account, you agree that PhantomForce provides software, automation tools, and AI-generated
          assistance. You are responsible for reviewing and approving any outputs, decisions, messages, content, or
          business actions taken through the platform. PhantomForce is not responsible for losses, missed opportunities,
          incorrect decisions, or actions you choose to take based on platform suggestions. AI outputs may be inaccurate
          and are not legal, financial, medical, or professional advice. See <a href="/terms">Terms</a> for details.
        </p>
        <div className="login-rails">
          <p>
            <Lock size={16} />
            Private access can be revoked cleanly when payment stops.
          </p>
          <p>
            <ShieldCheck size={16} />
            Actions stay approval-gated behind the business dashboard.
          </p>
        </div>
      </section>
    </main>
  );
}

function Topbar({
  activeSession,
  selectedOrg,
  pending,
  openSettings,
}: {
  activeSession: AppSession;
  selectedOrg: string;
  pending: number;
  openSettings: () => void;
}) {
  return (
    <header className="topbar">
      <div>
        <span className="eyebrow">Live workspace</span>
        <h1>{selectedOrg}</h1>
        <span className={`session-chip ${activeSession.role}`}>
          {activeSession.role === "admin" ? "Admin access" : "Client workspace"}
        </span>
      </div>
      <div className="topbar-actions">
        <button type="button" title="Search">
          <Search size={18} />
        </button>
        <button type="button" title="Notifications">
          <Bell size={18} />
          {pending > 0 ? <b>{pending}</b> : null}
        </button>
        <button type="button" title="Settings" onClick={openSettings}>
          <Settings size={18} />
        </button>
      </div>
    </header>
  );
}

function SettingsView({
  category,
  setCategory,
  workspaceDraft,
  setWorkspaceDraft,
  workspacePreview,
  publishState,
  previewWorkspace,
  publishWorkspace,
}: {
  category: SettingsCategory;
  setCategory: (category: SettingsCategory) => void;
  workspaceDraft: {
    name: string;
    layout: string;
    theme: string;
    defaultModule: string;
  };
  setWorkspaceDraft: (patch: Partial<typeof workspaceDraft>) => void;
  workspacePreview: typeof workspaceDraft | null;
  publishState: WorkspacePublishState;
  previewWorkspace: () => void;
  publishWorkspace: () => void;
}) {
  return (
    <section className="settings-shell">
      <div className="settings-toolbar" aria-label="Settings categories">
        <label>
          Category
          <select value={category} onChange={(event) => setCategory(event.target.value as SettingsCategory)}>
            <option value="workspace">Workspace Designer</option>
            <option value="appearance">Appearance</option>
            <option value="access">Access Controls</option>
            <option value="notifications">Notifications</option>
          </select>
        </label>
        <label>
          Workspace
          <select value={workspaceDraft.defaultModule} onChange={(event) => setWorkspaceDraft({ defaultModule: event.target.value })}>
            <option>Command</option>
            <option>Content</option>
            <option>Calendar</option>
            <option>Tasks</option>
            <option>Reports</option>
          </select>
        </label>
        <label>
          Theme
          <select value={workspaceDraft.theme} onChange={(event) => setWorkspaceDraft({ theme: event.target.value })}>
            <option>Phantom dark</option>
            <option>Black glass</option>
            <option>Operator red</option>
            <option>High contrast</option>
          </select>
        </label>
        <label>
          Layout
          <select value={workspaceDraft.layout} onChange={(event) => setWorkspaceDraft({ layout: event.target.value })}>
            <option>Command first</option>
            <option>Client first</option>
            <option>Content first</option>
            <option>Compact ops</option>
          </select>
        </label>
      </div>

      {category === "workspace" ? (
        <div className="settings-grid">
          <article className="settings-card workspace-designer-card">
            <span className="eyebrow">Workspace Designer</span>
            <h3>Design first. Preview second. Publish last.</h3>
            <p>
              Publishing is now locked until a preview exists, so accidental instant-publish is dead.
            </p>

            <label className="settings-field">
              Workspace name
              <input
                value={workspaceDraft.name}
                onChange={(event) => setWorkspaceDraft({ name: event.target.value })}
                placeholder="Workspace name"
              />
            </label>

            <div className="designer-actions">
              <button type="button" className="primary-action" onClick={previewWorkspace}>
                Preview Workspace
              </button>
              <button
                type="button"
                className="publish-action"
                disabled={publishState !== "previewed"}
                onClick={publishWorkspace}
                title={publishState !== "previewed" ? "Preview before publishing" : "Publish reviewed workspace"}
              >
                Publish
              </button>
              <span className={`publish-state ${publishState}`}>{publishState}</span>
            </div>
          </article>

          <article className="settings-card workspace-preview-card">
            <span className="eyebrow">Preview</span>
            {workspacePreview ? (
              <div className="workspace-preview-shell">
                <div>
                  <strong>{workspacePreview.name}</strong>
                  <span>{workspacePreview.theme}</span>
                </div>
                <nav>
                  <button type="button">{workspacePreview.defaultModule}</button>
                  <button type="button">{workspacePreview.layout}</button>
                  <button type="button">Approvals</button>
                </nav>
                <section>
                  <b>{workspacePreview.layout}</b>
                  <p>This is the review step before publishing the workspace layout.</p>
                </section>
              </div>
            ) : (
              <div className="empty-preview">
                <strong>No preview yet</strong>
                <span>Change settings, then hit Preview Workspace before Publish unlocks.</span>
              </div>
            )}
          </article>
        </div>
      ) : (
        <article className="settings-card">
          <span className="eyebrow">{category}</span>
          <h3>{category === "appearance" ? "Appearance controls" : category === "access" ? "Access settings" : "Notification settings"}</h3>
          <p>Category shell is ready. Workspace Designer is the active repaired panel.</p>
        </article>
      )}
    </section>
  );
}

function CommandCenter({
  messages,
  commandText,
  setCommandText,
  submitCommand,
  createFollowUpPlan,
  stats,
  approvals,
  approveAction,
  rejectAction,
  emails,
  events,
}: {
  messages: Message[];
  commandText: string;
  setCommandText: (value: string) => void;
  submitCommand: (event: FormEvent) => void;
  createFollowUpPlan: () => void;
  stats: { urgent: number; pending: number; today: number; events: number };
  approvals: Approval[];
  approveAction: (id: string) => void;
  rejectAction: (id: string) => void;
  emails: EmailItem[];
  events: CalendarEvent[];
}) {
  const pendingApprovals = approvals.filter((approval) => approval.status === "pending");
  return (
    <div className="command-layout">
      <section className="command-main">
        <div className="hero-command">
          <div>
            <span className="eyebrow">AI command center</span>
            <h2>Ask. Review. Approve. Move the business.</h2>
            <p>
              PhantomForce turns inbox pressure, calendar gaps, and scattered tasks into approved business actions.
            </p>
          </div>
          <button className="demo-button" type="button" onClick={createFollowUpPlan}>
            <Play size={18} />
            Run first gold demo
          </button>
        </div>

        <div className="metric-grid">
          <Metric icon={<Mail size={18} />} label="Follow-ups" value={stats.urgent} tone="danger" />
          <Metric icon={<ShieldCheck size={18} />} label="Approvals" value={stats.pending} tone="gold" />
          <Metric icon={<SquareCheckBig size={18} />} label="Today tasks" value={stats.today} tone="green" />
          <Metric icon={<CalendarDays size={18} />} label="Calendar items" value={stats.events} tone="blue" />
        </div>

        <section className="chat-card">
          <div className="section-head">
            <div>
              <span className="eyebrow">Business assistant</span>
              <h3>Command thread</h3>
            </div>
            <span className="safe-pill">
              <ShieldCheck size={15} />
              Approval gated
            </span>
          </div>
          <div className="messages" aria-live="polite">
            {messages.map((message) => (
              <article className={`message ${message.role}`} key={message.id}>
                <div className="avatar">{message.role === "assistant" ? <Bot size={18} /> : <UserRound size={18} />}</div>
                <p>{message.content}</p>
              </article>
            ))}
          </div>
          <form className="command-form" onSubmit={submitCommand}>
            <input
              value={commandText}
              onChange={(event) => setCommandText(event.target.value)}
              placeholder="Ask PhantomForce to brief, reply, schedule, or handle a follow-up..."
            />
            <button type="submit" title="Send command">
              <Send size={18} />
            </button>
          </form>
        </section>
      </section>

      <aside className="command-side">
        <section className="panel asset-panel">
          <img src="/assets/falcon-stream.png" alt="Falcon powered workflow stream" />
          <div>
            <span className="eyebrow">Backend power</span>
            <h3>Falcon stays behind the glass.</h3>
            <p>Clients get safe typed outcomes, not raw execution controls.</p>
          </div>
        </section>

        <section className="panel">
          <div className="section-head compact">
            <h3>Action stack</h3>
            <span>{pendingApprovals.length} pending</span>
          </div>
          {pendingApprovals.length ? (
            <div className="stack-list">
              {pendingApprovals.slice(0, 2).map((approval) => (
                <ApprovalCard
                  key={approval.id}
                  approval={approval}
                  approveAction={approveAction}
                  rejectAction={rejectAction}
                  compact
                />
              ))}
            </div>
          ) : (
            <EmptyState icon={<ShieldCheck size={20} />} title="No pending approvals" detail="Run the demo or ask for a follow-up to create reviewable actions." />
          )}
        </section>

        <section className="panel">
          <div className="section-head compact">
            <h3>Live context</h3>
            <span>Read only</span>
          </div>
          <div className="context-list">
            <ContextRow icon={<Inbox size={17} />} title={emails[0].subject} detail={`${emails[0].from} - ${emails[0].age}`} />
            <ContextRow icon={<CalendarDays size={17} />} title={events[0].title} detail={`${events[0].time} - ${events[0].status}`} />
          </div>
        </section>
      </aside>
    </div>
  );
}

function Metric({ icon, label, value, tone }: { icon: ReactNode; label: string; value: number; tone: string }) {
  return (
    <article className={`metric ${tone}`}>
      <span>{icon}</span>
      <div>
        <strong>{value}</strong>
        <p>{label}</p>
      </div>
    </article>
  );
}

function formatMediaCategory(category: MediaLabEffectCategory | string) {
  return category
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatCreateMode(mode: CreateMode) {
  return mode === "photo" ? "Photo" : mode === "video" ? "Video" : "Voice";
}

function PhantomPlayView({
  snapshot,
  status,
  busy,
  canManageAccess,
  hasActiveBackgroundJob,
  refresh,
  updateAccessMode,
  launchGame,
  openWork,
}: {
  snapshot: PhantomPlaySnapshot | null;
  status: string;
  busy: boolean;
  canManageAccess: boolean;
  hasActiveBackgroundJob: boolean;
  refresh: () => void;
  updateAccessMode: (mode: PhantomPlayAccessMode) => void;
  launchGame: (gameId: string) => void;
  openWork: () => void;
}) {
  const solitaire = snapshot?.games.find((game) => game.slug === "solitaire") ?? snapshot?.games[0];
  const disabled = snapshot?.policy.accessMode === "disabled";

  return (
    <Page
      title="PhantomPlay"
      kicker="Standalone instant-play sibling product"
      action={
        <button className="ghost-action" type="button" onClick={refresh} disabled={busy}>
          <RefreshCcw size={16} />
          Refresh
        </button>
      }
    >
      <section className="phantomplay-hero">
        <div>
          <span className="eyebrow">Break Room foundation</span>
          <h3>Play like a ghost.</h3>
          <p>
            PhantomPlay is a separate browser-first gaming product. Inside PhantomForce, it stays restrained: a
            Take Five option while background work keeps running.
          </p>
          <div className="phantomplay-actions">
            <button
              className="primary-action"
              type="button"
              disabled={busy || !solitaire || disabled}
              onClick={() => solitaire && launchGame(solitaire.id)}
            >
              <Play size={18} />
              Launch Ghost Solitaire
            </button>
            <button type="button" onClick={openWork}>
              {hasActiveBackgroundJob ? "Check background work" : "Back to work"}
            </button>
          </div>
          <small>{status}</small>
        </div>
        <div className="phantomplay-console-card">
          <strong>{snapshot?.product.name ?? "PhantomPlay"}</strong>
          <span>{snapshot?.product.slogan ?? "Play like a ghost."}</span>
          <b>{hasActiveBackgroundJob ? "Background work running" : "Break Room idle"}</b>
        </div>
      </section>

      <section className="phantomplay-grid">
        <article className="phantomplay-card flagship">
          <span className="eyebrow">Flagship</span>
          <h3>{solitaire?.title ?? "Ghost Solitaire"}</h3>
          <p>{solitaire?.description ?? "Solitaire foundation waiting for the PhantomPlay backend snapshot."}</p>
          <div className="phantomplay-tags">
            {(solitaire?.categories ?? ["cards", "short-session", "workplace-friendly"]).map((tag) => (
              <span key={tag}>{humanizeSlug(tag)}</span>
            ))}
          </div>
          <ul>
            <li>Browser-first runtime, no PC streaming dependency.</li>
            <li>Planned save/resume, undo, restart, timer, daily challenge, and personal best.</li>
            <li>Keyboard, mouse, touch, accessibility, and reduced-motion requirements are explicit.</li>
          </ul>
        </article>

        <article className="phantomplay-card">
          <span className="eyebrow">Runtime boundary</span>
          <h3>Untrusted games stay boxed in</h3>
          <p>
            Browser builds only: HTML5, JavaScript, WebAssembly, WebGL, and Godot web exports. Executables are rejected
            in the first lane.
          </p>
          <div className="runtime-checks">
            <span>Sandbox iframe</span>
            <span>CSP required</span>
            <span>No PhantomForce cookies/API access</span>
            <span>No Asset Cloud coupling</span>
          </div>
        </article>

        <article className="phantomplay-card">
          <span className="eyebrow">Business controls</span>
          <h3>Conservative by default</h3>
          <p>
            Current mode: <strong>{snapshot ? humanizeSlug(snapshot.policy.accessMode) : "loading"}</strong>. Business
            orgs must opt in before workplace gaming is available.
          </p>
          {canManageAccess ? (
            <div className="policy-buttons">
              {(["disabled", "enabled", "background_jobs_only", "selected_hours"] as PhantomPlayAccessMode[]).map(
                (mode) => (
                  <button
                    key={mode}
                    type="button"
                    disabled={busy || snapshot?.policy.accessMode === mode}
                    onClick={() => updateAccessMode(mode)}
                  >
                    {humanizeSlug(mode)}
                  </button>
                ),
              )}
            </div>
          ) : null}
        </article>

        <article className="phantomplay-card">
          <span className="eyebrow">Creator pipeline</span>
          <h3>Review before publish</h3>
          <p>Creator uploads are future-ready but not auto-published. Every build moves through a moderation state.</p>
          <div className="phantomplay-tags compact">
            {(snapshot?.creatorPublishingStates ?? ["draft", "automated_review", "manual_review", "published"]).map(
              (state) => (
                <span key={state}>{humanizeSlug(state)}</span>
              ),
            )}
          </div>
        </article>
      </section>
    </Page>
  );
}

function ContentHubView({
  activeTab,
  setActiveTab,
  createMode,
  setCreateMode,
  createPrompt,
  setCreatePrompt,
  createJobs,
  startCreateJob,
  voiceboxStatus,
  refreshVoiceboxStatus,
  catalog,
  busy,
  refreshCatalog,
}: {
  activeTab: ContentHubTab;
  setActiveTab: (tab: ContentHubTab) => void;
  createMode: CreateMode;
  setCreateMode: (mode: CreateMode) => void;
  createPrompt: string;
  setCreatePrompt: (value: string) => void;
  createJobs: CreateJob[];
  startCreateJob: () => void | Promise<void>;
  voiceboxStatus: VoiceboxRuntimeStatus | null;
  refreshVoiceboxStatus: () => void | Promise<void>;
  catalog: MediaLabCatalog | null;
  busy: boolean;
  refreshCatalog: () => void;
}) {
  const readyJobs = createJobs.filter((job) => job.status === "ready");
  const pendingJobs = createJobs.filter((job) => job.status !== "ready");
  const tabs: Array<{ id: ContentHubTab; label: string }> = [
    { id: "create", label: "Create" },
    { id: "library", label: "Media Pool" },
    { id: "calendar", label: "Calendar" },
    { id: "distribution", label: "Distribution" },
  ];

  return (
    <Page
      title="Media Lab"
      kicker="Create, review, publish"
      action={
        readyJobs.length ? (
          <span className="safe-pill">
            <Bell size={15} />
            {readyJobs.length} ready
          </span>
        ) : null
      }
    >
      <div className="content-tabs" role="tablist" aria-label="Media Lab sections">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={activeTab === tab.id ? "active" : ""}
            type="button"
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "create" ? (
        <CreateTab
          createMode={createMode}
          setCreateMode={setCreateMode}
          createPrompt={createPrompt}
          setCreatePrompt={setCreatePrompt}
          createJobs={createJobs}
          pendingJobs={pendingJobs}
          startCreateJob={startCreateJob}
          voiceboxStatus={voiceboxStatus}
          refreshVoiceboxStatus={refreshVoiceboxStatus}
          catalog={catalog}
          busy={busy}
          refreshCatalog={refreshCatalog}
        />
      ) : null}

      {activeTab === "library" ? (
        <section className="content-placeholder">
          <EmptyState
            icon={<FileText size={22} />}
            title="Media Pool"
            detail="Finished photo, video, voice, and edited media land in one place after generation."
          />
        </section>
      ) : null}

      {activeTab === "calendar" ? (
        <section className="content-placeholder">
          <EmptyState
            icon={<CalendarDays size={22} />}
            title="Publishing calendar"
            detail="Approved content can be scheduled here without turning pending generation into a whole workspace."
          />
        </section>
      ) : null}

      {activeTab === "distribution" ? (
        <section className="content-placeholder">
          <EmptyState
            icon={<Send size={22} />}
            title="Distribution queue"
            detail="Publishing and posting stay approval-gated after creative review."
          />
        </section>
      ) : null}
    </Page>
  );
}

function CreateTab({
  createMode,
  setCreateMode,
  createPrompt,
  setCreatePrompt,
  createJobs,
  pendingJobs,
  startCreateJob,
  voiceboxStatus,
  refreshVoiceboxStatus,
  catalog,
  busy,
  refreshCatalog,
}: {
  createMode: CreateMode;
  setCreateMode: (mode: CreateMode) => void;
  createPrompt: string;
  setCreatePrompt: (value: string) => void;
  createJobs: CreateJob[];
  pendingJobs: CreateJob[];
  startCreateJob: () => void | Promise<void>;
  voiceboxStatus: VoiceboxRuntimeStatus | null;
  refreshVoiceboxStatus: () => void | Promise<void>;
  catalog: MediaLabCatalog | null;
  busy: boolean;
  refreshCatalog: () => void;
}) {
  return (
    <div className="create-layout">
      <section className="create-main">
        <div className="create-composer">
          <div className="section-head">
            <div>
              <span className="eyebrow">AI media generation</span>
              <h3>Make the asset, keep moving.</h3>
            </div>
            <span className="safe-pill">
              <Bell size={15} />
              Background jobs
            </span>
          </div>

          <div className="create-mode-grid" role="radiogroup" aria-label="Create mode">
            <CreateModeButton
              active={createMode === "photo"}
              icon={<FileImage size={19} />}
              label="Photo"
              detail="Campaign images, scenes, product shots"
              onClick={() => setCreateMode("photo")}
            />
            <CreateModeButton
              active={createMode === "video"}
              icon={<FileVideo size={19} />}
              label="Video"
              detail="Short clips with generated voiceover"
              onClick={() => setCreateMode("video")}
            />
            <CreateModeButton
              active={createMode === "voice"}
              icon={<FileAudio size={19} />}
              label="Voice"
              detail="Voicebox speech, narration, agent reads"
              onClick={() => setCreateMode("voice")}
            />
          </div>

          <label className="create-prompt">
            Prompt
            <textarea
              value={createPrompt}
              onChange={(event) => setCreatePrompt(event.target.value)}
              placeholder="Tell PhantomForce what to create..."
            />
          </label>

          <div className="create-actions">
            <button className="primary-action" type="button" onClick={() => void startCreateJob()} disabled={!createPrompt.trim()}>
              <Sparkles size={18} />
              Generate {formatCreateMode(createMode)}
            </button>
            <span>
              {createMode === "voice" && voiceboxStatus?.reachable
                ? "Voicebox is connected. This will submit a real speech job."
                : createMode === "voice"
                  ? "Start Voicebox, then generate real speech from this prompt."
                  : "Long renders notify you when ready."}
            </span>
          </div>
        </div>

        <MediaLabView catalog={catalog} busy={busy} refreshCatalog={refreshCatalog} embedded />
      </section>

      <aside className="create-side">
        <section className="voicebox-card">
          <div>
            <FileAudio size={21} />
            <strong>Voicebox lane</strong>
          </div>
          <p>
            {voiceboxStatus?.reachable
              ? `Connected to ${voiceboxStatus.baseUrl} with ${voiceboxStatus.profiles} voice profiles.`
              : voiceboxStatus?.reason ?? "Checking Voicebox runtime..."}
          </p>
          <button className="ghost-small" type="button" onClick={() => void refreshVoiceboxStatus()}>
            <RefreshCcw size={15} />
            Check Voicebox
          </button>
        </section>

        <section className="job-panel">
          <div className="section-head compact">
            <h3>Background jobs</h3>
            <span>{pendingJobs.length} running</span>
          </div>
          {createJobs.length ? (
            <div className="job-list">
              {createJobs.map((job) => (
                <article className={`job-row ${job.status}`} key={job.id}>
                  <span>{job.mode === "photo" ? <FileImage size={17} /> : job.mode === "video" ? <FileVideo size={17} /> : <FileAudio size={17} />}</span>
                  <div>
                    <strong>{job.title}</strong>
                    <p>{job.error ?? job.engine}</p>
                    {job.audioUrl ? (
                      <a href={job.audioUrl} target="_blank" rel="noreferrer">
                        Open audio
                      </a>
                    ) : null}
                  </div>
                  <b>{job.status}</b>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<Clock3 size={20} />}
              title="No waiting room"
              detail="Create jobs run quietly here, then notify you when the asset is ready."
            />
          )}
        </section>
      </aside>
    </div>
  );
}

function CreateModeButton({
  active,
  icon,
  label,
  detail,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button className={active ? "active" : ""} type="button" onClick={onClick}>
      <span>{icon}</span>
      <strong>{label}</strong>
      <small>{detail}</small>
    </button>
  );
}

function MediaLabView({
  catalog,
  busy,
  refreshCatalog,
  embedded = false,
}: {
  catalog: MediaLabCatalog | null;
  busy: boolean;
  refreshCatalog: () => void;
  embedded?: boolean;
}) {
  const summary = catalog?.summary;
  const topPacks = summary?.packs.slice(0, 5) ?? [];
  const effects = catalog?.effects ?? [];

  return (
    <section className={embedded ? "media-lab-section embedded" : "media-lab-section"}>
      <div className="section-head">
        <div>
          <span className="eyebrow">Effects cloud</span>
          <h3>Media Lab</h3>
        </div>
        <button className="primary-small" type="button" onClick={refreshCatalog} disabled={busy}>
          <RefreshCcw size={16} />
          {busy ? "Scanning" : "Rescan"}
        </button>
      </div>
      <section className="media-lab-hero">
        <div>
          <span className="eyebrow">Motionarray intake</span>
          <h3>{summary ? `${summary.totalAssets} effects indexed` : "Effects catalog waiting"}</h3>
          <p>
            {summary
              ? `${summary.totalSizeLabel} mapped into PhantomForce categories for editor search, Media Lab renders, and client-safe creative workflows.`
              : "Start the backend to scan the local asset pack and load the catalog."}
          </p>
        </div>
        <div className="media-boundary-card">
          <ShieldCheck size={22} />
          <strong>Raw downloads blocked</strong>
          <span>{summary?.licenseBoundary.blockedUse ?? "Source files stay behind the production boundary."}</span>
        </div>
      </section>

      <div className="media-stat-grid">
        <article>
          <span>Source</span>
          <strong>{summary?.sourceProvider ?? "Motion Array"}</strong>
        </article>
        <article>
          <span>Cloud ready</span>
          <strong>{summary?.cloudReadyAssets ?? 0}</strong>
        </article>
        <article>
          <span>Categories</span>
          <strong>{summary?.categories.length ?? 0}</strong>
        </article>
        <article>
          <span>Root</span>
          <strong>{summary?.sourceRootConfigured ? "Online" : "Waiting"}</strong>
        </article>
      </div>

      {summary ? (
        <section className="media-category-panel">
          <div className="section-head">
            <div>
              <span className="eyebrow">Media Pool map</span>
              <h3>Effects by category</h3>
            </div>
            <span className="safe-pill">
              <Lock size={15} />
              Metadata only
            </span>
          </div>
          <div className="media-category-grid">
            {summary.categories.map((category) => (
              <article key={category.category}>
                <strong>{formatMediaCategory(category.category)}</strong>
                <span>{category.count} assets</span>
                <small>{category.sizeLabel}</small>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="media-library-layout">
        <div className="media-effect-column">
          <div className="section-head">
            <div>
              <span className="eyebrow">Catalog sample</span>
              <h3>Largest source packs</h3>
            </div>
            <span className="safe-pill">
              <Search size={15} />
              {effects.length} shown
            </span>
          </div>
          {effects.length ? (
            <div className="media-effect-grid">
              {effects.map((effect) => (
                <article className={`media-effect-card ${effect.category}`} key={effect.id}>
                  <div className="media-effect-thumb">
                    <Sparkles size={22} />
                  </div>
                  <div>
                    <span>{formatMediaCategory(effect.category)}</span>
                    <h3>{effect.title}</h3>
                    <p>{effect.sourceFolder} / {effect.sizeLabel}</p>
                  </div>
                  <div className="media-effect-tags">
                    <b>{effect.exposureMode.replace(/_/g, " ")}</b>
                    <b>{effect.rawDownloadAllowed ? "downloadable" : "raw blocked"}</b>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<Sparkles size={20} />}
              title="No effects loaded"
              detail="The local catalog scanner has not returned asset metadata yet."
            />
          )}
        </div>

        <aside className="media-pack-panel">
          <div className="section-head compact">
            <h3>Source folders</h3>
            <span>{topPacks.length} packs</span>
          </div>
          <div className="media-pack-list">
            {topPacks.map((pack) => (
              <article key={pack.sourceFolder}>
                <strong>{pack.sourceFolder}</strong>
                <span>{pack.count} assets</span>
                <small>{pack.sizeLabel}</small>
              </article>
            ))}
          </div>
          {catalog?.warnings.length ? (
            <div className="media-warning">
              <AlertTriangle size={17} />
              <span>{catalog.warnings[0]}</span>
            </div>
          ) : null}
        </aside>
      </section>
    </section>
  );
}

function InboxView({ emails, createFollowUpPlan }: { emails: EmailItem[]; createFollowUpPlan: () => void }) {
  return (
    <Page title="Inbox intelligence" kicker="Gmail" action={<button className="primary-small" onClick={createFollowUpPlan}><Sparkles size={16} /> Prepare follow-up</button>}>
      <div className="list-grid">
        {emails.map((email) => (
          <article className="record-card" key={email.id}>
            <div className="record-top">
              <span className={`priority ${email.priority}`}>{email.priority}</span>
              <small>{email.age}</small>
            </div>
            <h3>{email.subject}</h3>
            <p>{email.preview}</p>
            <div className="record-footer">
              <span>{email.from}</span>
              <b>{email.status}</b>
            </div>
          </article>
        ))}
      </div>
    </Page>
  );
}

function CalendarView({ events }: { events: CalendarEvent[] }) {
  return (
    <Page title="Scheduling command" kicker="Calendar">
      <div className="timeline">
        {events.map((event) => (
          <article className="timeline-item" key={event.id}>
            <Clock3 size={18} />
            <div>
              <h3>{event.title}</h3>
              <p>{event.time}</p>
            </div>
            <span className={`status-badge ${event.status}`}>{event.status}</span>
          </article>
        ))}
      </div>
    </Page>
  );
}

function TasksView({ tasks, completeTask }: { tasks: TaskItem[]; completeTask: (id: string) => void }) {
  return (
    <Page title="Task operations" kicker="Execution queue" action={<button className="ghost-small"><Plus size={16} /> New task</button>}>
      <div className="task-list">
        {tasks.map((task) => (
          <article className={`task-row ${task.status}`} key={task.id}>
            <button type="button" onClick={() => completeTask(task.id)} title="Complete task">
              <Check size={17} />
            </button>
            <div>
              <h3>{task.title}</h3>
              <p>{task.owner} - due {task.due}</p>
            </div>
            <span>{task.status}</span>
          </article>
        ))}
      </div>
    </Page>
  );
}

function ApprovalsView({
  approvals,
  approveAction,
  rejectAction,
}: {
  approvals: Approval[];
  approveAction: (id: string) => void;
  rejectAction: (id: string) => void;
}) {
  return (
    <Page title="Approval cockpit" kicker="Human oversight">
      {approvals.length ? (
        <div className="approval-grid">
          {approvals.map((approval) => (
            <ApprovalCard
              key={approval.id}
              approval={approval}
              approveAction={approveAction}
              rejectAction={rejectAction}
            />
          ))}
        </div>
      ) : (
        <EmptyState icon={<ShieldCheck size={22} />} title="No approval cards yet" detail="Approval cards appear when PhantomForce proposes an external or sensitive action." />
      )}
    </Page>
  );
}

function ActivityView({ activity }: { activity: ActivityItem[] }) {
  return (
    <Page title="Activity and audit" kicker="Traceability">
      <div className="activity-feed">
        {activity.map((item) => (
          <article className={`activity-item ${item.level}`} key={item.id}>
            <span />
            <div>
              <h3>{item.title}</h3>
              <p>{item.detail}</p>
            </div>
            <time>{item.time}</time>
          </article>
        ))}
      </div>
    </Page>
  );
}

function AccessView({
  canManageAccess,
  clientAccess,
  guardedWorkspace,
  workspaceModuleView,
  pangolinPlan,
  pangolinStatus,
  readinessReport,
  linkedClientCsvs,
  clientCsvBusy,
  clientCsvStatus,
  refreshGuardedWorkspace,
  refreshWorkspaceModule,
  refreshReadinessReport,
  updateClientAccess,
  updateClientModule,
  runMoneyDemoStage,
  importClientCsvFile,
  linkClientCsv,
  syncLinkedClientCsv,
  moneyDemoBusy,
}: {
  canManageAccess: boolean;
  clientAccess: ClientAccess[];
  guardedWorkspace: GuardedWorkspace | null;
  workspaceModuleView: WorkspaceModuleView | null;
  pangolinPlan: PangolinRoutePlan[];
  pangolinStatus: PangolinReadOnlyStatus | null;
  readinessReport: ProductionReadinessReport | null;
  linkedClientCsvs: LinkedClientCsv[];
  clientCsvBusy: boolean;
  clientCsvStatus: string;
  refreshGuardedWorkspace: (clientId?: string) => void;
  refreshWorkspaceModule: (clientId: string, moduleKey?: string) => void;
  refreshReadinessReport: () => void;
  updateClientAccess: (id: string, nextStatus: ClientAccessStatus) => void;
  updateClientModule: (id: string, moduleKey: string, enabled: boolean) => void;
  runMoneyDemoStage: (stage: MoneyDemoStage) => void;
  importClientCsvFile: (file: File) => void | Promise<void>;
  linkClientCsv: (path: string, label?: string) => void | Promise<void>;
  syncLinkedClientCsv: (id?: string) => void | Promise<void>;
  moneyDemoBusy: MoneyDemoStage | null;
}) {
  const [csvPath, setCsvPath] = useState("");
  const [csvLabel, setCsvLabel] = useState("");
  const [draggingCsv, setDraggingCsv] = useState(false);
  const moneyDemoClient = clientAccess.find((client) => client.id === MONEY_DEMO_CLIENT_ID);
  const moneyDemoStages: Array<{ id: MoneyDemoStage; label: string; detail: string }> = [
    {
      id: "signed",
      label: "Signed",
      detail: "Agreement landed from NexProspex; workspace is blocked until payment clears.",
    },
    {
      id: "paid",
      label: "Paid",
      detail: "Payment activates modules, private route plan, and the Calendar boundary.",
    },
    {
      id: "past_due",
      label: "Past due",
      detail: "Route stays reachable while PhantomForce handlers enforce read-only.",
    },
    {
      id: "revoked",
      label: "Revoked",
      detail: "Pangolin route plan disables access and the app blocks workspace requests.",
    },
    {
      id: "restored",
      label: "Restored",
      detail: "Paid access returns with modules and credential reference intact.",
    },
  ];
  const handleCsvDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDraggingCsv(false);
    const file = Array.from(event.dataTransfer.files).find((item) => item.name.toLowerCase().endsWith(".csv"));
    if (file) void importClientCsvFile(file);
  };
  const handleCsvLink = () => {
    void linkClientCsv(csvPath, csvLabel);
    setCsvPath("");
    setCsvLabel("");
  };

  return (
    <Page title="Client access control" kicker="Pangolin private gateway">
      <section className="access-hero">
        <div>
          <span className="eyebrow">Private business OS</span>
          <h3>Payment controls the doorway. PhantomForce controls the workspace.</h3>
          <p>
            {canManageAccess
              ? "Clients get a simple dashboard. Jordan gets module entitlements, private routes, revocation, and audit history."
              : "This client workspace only shows the modules and access state currently allowed by PhantomForce."}
            {" "}Pangolin stays behind the glass as the access layer, not the product UI.
          </p>
        </div>
        <div className="access-proof">
          <KeyRound size={22} />
          <strong>Paid users enter</strong>
          <span>Past-due users can be blocked without exposing backend services.</span>
        </div>
      </section>

      {canManageAccess ? (
        <section className="client-csv-panel" data-testid="client-csv-panel">
          <div className="route-panel-head">
            <div>
              <span className="eyebrow">Client list CSV</span>
              <h3>Drop a CSV right here to update the list</h3>
            </div>
            <label className="csv-import-button">
              Import CSV
              <input
                type="file"
                accept=".csv,text/csv"
                disabled={clientCsvBusy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void importClientCsvFile(file);
                  event.currentTarget.value = "";
                }}
              />
            </label>
          </div>
          <div
            className={`client-csv-dropzone ${draggingCsv ? "dragging" : ""}`}
            onDragEnter={(event) => {
              event.preventDefault();
              setDraggingCsv(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDraggingCsv(false)}
            onDrop={handleCsvDrop}
            aria-disabled={clientCsvBusy}
          >
            <FileText size={28} />
            <strong>Drag any client CSV here</strong>
            <span>
              Uses business/client, owner, plan, payment status, private route, and modules columns when present.
            </span>
            <small>{clientCsvStatus}</small>
          </div>
          <div className="client-csv-link-row">
            <input
              value={csvPath}
              onChange={(event) => setCsvPath(event.target.value)}
              placeholder="Link CSV path, e.g. C:\\Clients\\ledger.csv or /home/kali/clients.csv"
            />
            <input
              value={csvLabel}
              onChange={(event) => setCsvLabel(event.target.value)}
              placeholder="Label optional"
            />
            <button type="button" disabled={clientCsvBusy || !csvPath.trim()} onClick={handleCsvLink}>
              Link CSV
            </button>
          </div>
          <div className="linked-csv-list">
            {linkedClientCsvs.length ? (
              linkedClientCsvs.map((link) => (
                <article className="linked-csv-item" key={link.id}>
                  <div>
                    <strong>{link.label}</strong>
                    <span>{link.path}</span>
                    <small>{link.lastSyncedAt ? `Synced ${new Date(link.lastSyncedAt).toLocaleString()}` : "Not synced yet"}</small>
                  </div>
                  <button type="button" disabled={clientCsvBusy} onClick={() => void syncLinkedClientCsv(link.id)}>
                    Sync
                  </button>
                </article>
              ))
            ) : (
              <span className="linked-csv-empty">No linked CSVs yet. Drop a file once or link a path for repeat sync.</span>
            )}
          </div>
        </section>
      ) : null}

      {canManageAccess ? (
        <section className="money-demo-panel" data-testid="money-demo-panel">
          <div className="route-panel-head">
            <div>
              <span className="eyebrow">Revenue proof</span>
              <h3>NexProspex win to paid workspace</h3>
            </div>
            <span className={`money-demo-status ${moneyDemoClient?.accessStatus ?? "revoked"}`}>
              {moneyDemoClient
                ? `${moneyDemoClient.paymentStatus} / ${moneyDemoClient.accessStatus}`
                : "not provisioned"}
            </span>
          </div>
          <div className="money-demo-steps">
            {moneyDemoStages.map((stage, index) => (
              <button
                type="button"
                data-testid={`money-demo-${stage.id}`}
                disabled={moneyDemoBusy !== null}
                key={stage.id}
                onClick={() => runMoneyDemoStage(stage.id)}
              >
                <span>{index + 1}</span>
                <strong>{moneyDemoBusy === stage.id ? "Running" : stage.label}</strong>
                <small>{stage.detail}</small>
              </button>
            ))}
          </div>
          <div className="money-demo-proof">
            <span>{moneyDemoClient?.privateRoute ?? "app.phantomforce.online/money-demo-athletics"}</span>
            <span>Calendar credential ref: local-demo:{MONEY_DEMO_CLIENT_ID}:calendar</span>
            <span>Approval and audit required</span>
          </div>
          <div className="demo-boundary-strip" data-testid="money-demo-production-boundary">
            <strong>{readinessReport?.localDemoReady ? "Local demo verified" : "Demo gates checking"}</strong>
            <span>
              {readinessReport?.productionReady
                ? "Production gates are clear."
                : "Not production: real auth, live OAuth, Pangolin verification, deployment, and production Postgres still need gates cleared."}
            </span>
          </div>
        </section>
      ) : null}

      {canManageAccess ? (
        <section className="readiness-panel" data-testid="readiness-panel">
          <div className="route-panel-head">
            <div>
              <span className="eyebrow">Production gates</span>
              <h3>{readinessReport?.productionReady ? "Production ready" : "Local demo ready"}</h3>
            </div>
            <div className="readiness-actions">
              <span className={`readiness-pill ${readinessReport?.productionReady ? "ready" : "needs_config"}`}>
                {readinessReport?.productionReady ? "production ready" : "not production"}
              </span>
              <button type="button" onClick={refreshReadinessReport}>
                <RefreshCcw size={16} />
                Refresh
              </button>
            </div>
          </div>
          <p>{readinessReport?.summary ?? "Readiness gates have not loaded yet."}</p>
          <div className="readiness-grid">
            {(readinessReport?.gates ?? []).map((gate) => (
              <article className={`readiness-card ${gate.status}`} data-testid={`readiness-${gate.id}`} key={gate.id}>
                <div>
                  <strong>{gate.label}</strong>
                  <span>{gate.status.replace("_", " ")}</span>
                </div>
                <p>{gate.detail}</p>
                <small>{gate.evidence}</small>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="guard-panel" data-testid="access-guard-panel">
        <div>
          <span className="eyebrow">Request-time guard</span>
          <h3>{guardedWorkspace?.business ?? "Sports Ops Demo"}</h3>
          <p>
            This panel calls the same backend decision endpoint a client workspace uses before loading private modules.
          </p>
        </div>
        <div className={`guard-decision ${guardedWorkspace?.mode ?? "blocked"}`}>
          <strong>{guardedWorkspace?.mode ?? "checking"}</strong>
          <span>{guardedWorkspace?.reason ?? "Checking live server decision."}</span>
        </div>
        <div className="guard-modules">
          {(guardedWorkspace?.modules.length ? guardedWorkspace.modules : ["No modules available"]).map((module) => (
            <button
              type="button"
              key={module}
              disabled={!guardedWorkspace || module === "No modules available"}
              onClick={() => refreshWorkspaceModule(guardedWorkspace?.id ?? "client-sports-demo", module)}
            >
              {module}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => refreshGuardedWorkspace()}>
          <RefreshCcw size={16} />
          Refresh guard
        </button>
      </section>

      {workspaceModuleView ? (
        <section className="module-view-panel" data-testid="module-view-panel">
          <div className="route-panel-head">
            <div>
              <span className="eyebrow">Guarded module handler</span>
              <h3>{workspaceModuleView.title}</h3>
            </div>
            <span className={`module-access-pill ${workspaceModuleView.writeAccess ? "write" : "read"}`}>
              {workspaceModuleView.writeAccess ? "Write enabled" : "Read only"}
            </span>
          </div>
          <p>{workspaceModuleView.summary}</p>
          {workspaceModuleView.connector ? (
            <div className="module-connector-boundary">
              <span>connector: {workspaceModuleView.connector.id}</span>
              <span>{workspaceModuleView.connector.provider}</span>
              <span>{workspaceModuleView.connector.credentialMode}</span>
              <span>{workspaceModuleView.connector.status}</span>
              <span>{workspaceModuleView.connector.credentialSource}</span>
              {workspaceModuleView.connector.credentialRef ? (
                <span>ref: {workspaceModuleView.connector.credentialRef}</span>
              ) : null}
              <span>{workspaceModuleView.connector.readOnly ? "read only" : "write capable"}</span>
              <small>{workspaceModuleView.connector.reason}</small>
            </div>
          ) : null}
          <div className="module-view-grid">
            {workspaceModuleView.widgets.map((widget) => (
              <div className="module-widget" key={widget.id}>
                <span>{widget.label}</span>
                <strong>{widget.value}</strong>
              </div>
            ))}
          </div>
          <div className="module-view-body">
            <div>
              <span className="eyebrow">Records</span>
              <div className="module-record-list">
                {workspaceModuleView.records.map((record) => (
                  <article key={record.id}>
                    <strong>{record.title}</strong>
                    <span>{record.status}</span>
                  </article>
                ))}
              </div>
            </div>
            <div>
              <span className="eyebrow">Actions</span>
              <div className="module-action-list">
                {workspaceModuleView.primaryActions.map((action) => (
                  <span className="module-action enabled" key={action.id}>
                    {action.label}
                  </span>
                ))}
                {workspaceModuleView.disabledActions.map((action) => (
                  <span className="module-action disabled" key={action.id}>
                    {action.label}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>
      ) : (
        <section className="module-view-panel empty" data-testid="module-view-panel">
          <span className="eyebrow">Guarded module handler</span>
          <h3>No module payload loaded</h3>
          <p>Choose an enabled workspace module to inspect the handler output.</p>
        </section>
      )}

      {canManageAccess ? (
        <section className="pangolin-panel" data-testid="pangolin-dry-run-panel">
          <div className="route-panel-head">
            <div>
              <span className="eyebrow">Pangolin route dry-run</span>
              <h3>Private gateway plan</h3>
            </div>
            <span className="dry-run-pill">No live changes</span>
          </div>
          <div className={`gateway-status ${pangolinStatus?.status ?? "unconfigured"}`} data-testid="pangolin-readonly-status">
            <strong>{pangolinStatus?.status ?? "unconfigured"}</strong>
            <span>{pangolinStatus?.reason ?? "Read-only gateway verification has not run yet."}</span>
            <small>
              {pangolinStatus?.configured
                ? `${pangolinStatus.baseUrl}${pangolinStatus.healthPath ?? ""}`
                : "PANGOLIN_READONLY_BASE_URL not configured"}
            </small>
          </div>
          <div className="pangolin-grid">
            {pangolinPlan.map((plan) => (
              <article
                className="pangolin-route"
                data-testid={`pangolin-route-${plan.clientId}`}
                key={plan.clientId}
              >
                <div>
                  <h4>{plan.business}</h4>
                  <p>{plan.privateRoute}</p>
                </div>
                <span className={`route-state ${plan.desiredState}`}>
                  {plan.desiredState.replace("_", " ")}
                </span>
                <div className="route-meta">
                  <span>{plan.paymentStatus}</span>
                  <span>{plan.mode}</span>
                  <span>gateway: {plan.gatewayEnforcement.replace("_", " ")}</span>
                  <span>app: {plan.appEnforcement.replace("_", " ")}</span>
                  <span>{plan.modules.length} modules</span>
                </div>
                <p className="route-note">{plan.enforcementNote}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <div className="access-grid">
        {clientAccess.map((client) => (
          <article className={`access-card ${client.accessStatus}`} data-testid={`access-card-${client.id}`} key={client.id}>
            <div className="record-top">
              <div>
                <h3>{client.business}</h3>
                <p>{client.owner}</p>
              </div>
              <span className={`status-badge ${client.accessStatus}`}>{client.accessStatus}</span>
            </div>
            <dl className="payload">
              <div>
                <dt>Plan</dt>
                <dd>{client.plan}</dd>
              </div>
              <div>
                <dt>Payment</dt>
                <dd>{client.paymentStatus}</dd>
              </div>
              <div>
                <dt>Private route</dt>
                <dd>{client.privateRoute}</dd>
              </div>
              <div>
                <dt>Audit</dt>
                <dd>{client.lastAudit}</dd>
              </div>
            </dl>
            {canManageAccess ? (
              <div className="module-control-list" aria-label={`${client.business} module entitlements`}>
                {Array.from(new Set([...clientModuleCatalog, ...client.modules])).map((module) => {
                  const enabled = client.modules.some(
                    (clientModule) => normalizeModuleKey(clientModule) === normalizeModuleKey(module),
                  );

                  return (
                    <button
                      type="button"
                      className={`module-toggle ${enabled ? "enabled" : "disabled"}`}
                      data-testid={moduleTestId(client.id, module)}
                      key={module}
                      onClick={() => updateClientModule(client.id, module, !enabled)}
                    >
                      {enabled ? <Check size={14} /> : <Plus size={14} />}
                      <span>{module}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="module-list">
                {client.modules.map((module) => (
                  <span key={module}>{module}</span>
                ))}
              </div>
            )}
            {canManageAccess ? (
              <div className="access-actions">
                <button
                  type="button"
                  data-testid={`access-restore-${client.id}`}
                  onClick={() => updateClientAccess(client.id, "active")}
                >
                  <Check size={16} />
                  Restore
                </button>
                <button
                  type="button"
                  data-testid={`access-due-${client.id}`}
                  onClick={() => updateClientAccess(client.id, "past_due")}
                >
                  <Clock3 size={16} />
                  Mark due
                </button>
                <button
                  type="button"
                  data-testid={`access-revoke-${client.id}`}
                  onClick={() => updateClientAccess(client.id, "revoked")}
                >
                  <ToggleLeft size={16} />
                  Revoke
                </button>
              </div>
            ) : (
              <p className="access-note">Access changes require PhantomForce admin approval.</p>
            )}
          </article>
        ))}
      </div>
    </Page>
  );
}

function SocialAnalyticsView({
  snapshot,
  providers,
  attempts,
  busy,
  status,
  refresh,
  connectAll,
}: {
  snapshot: SocialAnalyticsSnapshot | null;
  providers: SocialProviderStatus[];
  attempts: SocialOauthAttempt[];
  busy: boolean;
  status: string;
  refresh: () => void | Promise<void>;
  connectAll: () => void | Promise<void>;
}) {
  const metrics = snapshot?.metrics ?? [
    { label: "Total reach", value: "-", delta: "Load analytics" },
    { label: "Engagement", value: "-", delta: "Waiting" },
    { label: "Audience", value: "-", delta: "Waiting" },
  ];
  const readyCount = providers.filter((provider) => provider.analyticsReady).length;

  return (
    <Page
      title="Social analytics"
      kicker="All channels"
      action={
        <button className="primary-small" type="button" onClick={() => void connectAll()} disabled={busy}>
          <Link2 size={16} />
          {busy ? "Trying socials" : "OAuth all socials"}
        </button>
      }
    >
      <section className="social-analytics-hero">
        <div>
          <span className="eyebrow">Combined reach engine</span>
          <h3>Every platform should roll into one business view.</h3>
          <p>{status}</p>
        </div>
        <button className="ghost-small" type="button" onClick={() => void refresh()} disabled={busy}>
          <RefreshCcw size={15} />
          Refresh analytics
        </button>
      </section>

      <div className="social-metric-grid">
        {metrics.map((metric) => (
          <article key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            <small>{metric.delta}</small>
          </article>
        ))}
        <article>
          <span>Ready sources</span>
          <strong>{readyCount}/{providers.length || 6}</strong>
          <small>{snapshot?.reason ?? "Waiting for connector status"}</small>
        </article>
      </div>

      <section className="social-provider-panel">
        <div className="section-head">
          <div>
            <span className="eyebrow">OAuth status</span>
            <h3>Provider health</h3>
          </div>
          <span className="safe-pill">
            <ShieldCheck size={15} />
            Backend tokens required
          </span>
        </div>
        <div className="social-provider-grid">
          {providers.map((provider) => (
            <article
              className={`social-provider-card ${
                provider.analyticsReady ? "ready" : provider.configured ? "configured" : "missing"
              }`}
              key={provider.id}
            >
              <div className="record-top">
                <h3>{provider.name}</h3>
                <span className={`status-badge ${provider.analyticsReady ? "connected" : provider.configured ? "ready" : "locked"}`}>
                  {provider.analyticsReady ? "analytics" : provider.configured ? "oauth ready" : "needs setup"}
                </span>
              </div>
              <p>{provider.reason}</p>
              <div className="scope-list">
                {provider.scopes.slice(0, 3).map((scope) => (
                  <span key={scope}>{scope}</span>
                ))}
              </div>
              {provider.authUrl && !provider.analyticsReady ? (
                <a className="provider-oauth-link" href={provider.authUrl} target="_blank" rel="noreferrer">
                  Authorize {provider.name}
                </a>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      <section className="social-provider-panel">
        <div className="section-head">
          <div>
            <span className="eyebrow">Combined breakdown</span>
            <h3>Analytics feed</h3>
          </div>
        </div>
        {snapshot?.providerBreakdown.length ? (
          <div className="social-breakdown-list">
            {snapshot.providerBreakdown.map((provider) => (
              <article key={provider.providerId}>
                <strong>{provider.providerName}</strong>
                <span>{provider.reach.toLocaleString()} reach</span>
                <span>{provider.engagement.toLocaleString()} engagements</span>
                <span>{provider.followers.toLocaleString()} followers</span>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<BarChart3 size={20} />}
            title="No readable analytics yet"
            detail="Use OAuth all socials, then make sure each provider grants analytics or insights scopes."
          />
        )}
      </section>

      {attempts.length ? (
        <section className="social-attempt-panel">
          <div className="section-head compact">
            <h3>Last OAuth-all attempt</h3>
            <span>{attempts.length} providers</span>
          </div>
          {attempts.map((attempt) => (
            <article key={attempt.providerId}>
              <strong>{attempt.providerName}</strong>
              <span>{attempt.status.replace(/_/g, " ")}</span>
              <p>{attempt.reason}</p>
            </article>
          ))}
        </section>
      ) : null}
    </Page>
  );
}

function ConnectionsView({
  socialProviders = [],
  connectAll,
}: {
  socialProviders?: SocialProviderStatus[];
  connectAll?: () => void | Promise<void>;
}) {
  return (
    <Page
      title="Connections and modules"
      kicker="Backend power"
      action={
        connectAll ? (
          <button className="primary-small" type="button" onClick={() => void connectAll()}>
            <Link2 size={16} />
            OAuth all socials
          </button>
        ) : null
      }
    >
      {socialProviders.length ? (
        <section className="social-mini-strip">
          {socialProviders.map((provider) => (
            <span key={provider.id} className={provider.analyticsReady ? "ready" : provider.configured ? "configured" : "missing"}>
              {provider.name}: {provider.analyticsReady ? "analytics" : provider.configured ? "oauth ready" : "setup needed"}
            </span>
          ))}
        </section>
      ) : null}
      <div className="connection-grid">
        {connections.map((connection) => (
          <article className={`connection-card ${connection.status}`} key={connection.id}>
            <div className="record-top">
              <h3>{connection.name}</h3>
              <span className={`status-badge ${connection.status}`}>{connection.status}</span>
            </div>
            <p>{connection.description}</p>
            <div className="scope-list">
              {connection.scopes.map((scope) => (
                <span key={scope}>{scope}</span>
              ))}
            </div>
          </article>
        ))}
      </div>
      <section className="module-panel">
        <div className="section-head">
          <div>
            <span className="eyebrow">Module registry</span>
            <h3>One app, business-specific tools.</h3>
          </div>
        </div>
        <div className="module-list">
          {modules.map((module) => (
            <span key={module}>{module}</span>
          ))}
        </div>
      </section>
    </Page>
  );
}

function Page({ title, kicker, action, children }: { title: string; kicker: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="page">
      <div className="page-head">
        <div>
          <span className="eyebrow">{kicker}</span>
          <h2>{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function ApprovalCard({
  approval,
  approveAction,
  rejectAction,
  compact = false,
}: {
  approval: Approval;
  approveAction: (id: string) => void;
  rejectAction: (id: string) => void;
  compact?: boolean;
}) {
  const Icon = approval.kind === "email" ? Mail : approval.kind === "calendar" ? CalendarDays : SquareCheckBig;
  return (
    <article className={`approval-card ${compact ? "compact" : ""} ${approval.status}`}>
      <div className="approval-title">
        <span>
          <Icon size={18} />
        </span>
        <div>
          <h3>{approval.title}</h3>
          <p>{approval.summary}</p>
        </div>
      </div>
      {!compact ? (
        <dl className="payload">
          {Object.entries(approval.payload).map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <div className="approval-meta">
        <span>{approval.reversible ? "Reversible" : "External final action"}</span>
        <b>{approval.status}</b>
      </div>
      {approval.status === "pending" ? (
        <div className="approval-actions">
          <button type="button" className="approve" onClick={() => approveAction(approval.id)}>
            <Check size={16} />
            Approve
          </button>
          <button type="button" className="reject" onClick={() => rejectAction(approval.id)}>
            <X size={16} />
            Reject
          </button>
        </div>
      ) : null}
    </article>
  );
}

function ContextRow({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return (
    <div className="context-row">
      <span>{icon}</span>
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
    </div>
  );
}

function EmptyState({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return (
    <div className="empty-state">
      <span>{icon}</span>
      <h3>{title}</h3>
      <p>{detail}</p>
    </div>
  );
}

export default App;
