import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type ClientSetupSlotId = "active-1" | "active-2" | "pending-1";
export type ClientSetupSlotKind = "active" | "pending";
export type ClientSetupSlotStatus = "active" | "pending" | "empty";
export type BusinessTemplateKey =
  | "local_service"
  | "media_content"
  | "contractor_home_service"
  | "sports_team_club"
  | "restaurant_bar_venue"
  | "professional_service"
  | "crypto_startup_internal_ops";

export type ClientSetupModule = {
  id: string;
  label: string;
  description: string;
};

export type ClientSetupBusinessTemplate = {
  key: BusinessTemplateKey;
  label: string;
  description: string;
  recommendedModules: string[];
  starterPackages: Array<{ name: string; price: string; cadence: string; notes: string }>;
  starterLeadSources: Array<{ label: string; type: string; notes: string }>;
  reportingMetrics: string[];
};

export type ClientSetupServicePackage = {
  id: string;
  name: string;
  price: string;
  cadence: string;
  notes: string;
};

export type ClientSetupLeadSource = {
  id: string;
  label: string;
  type: string;
  enabled: boolean;
  notes: string;
};

export type ClientSetupSocialWorkflow = {
  enabled: boolean;
  platforms: string[];
  cadence: string;
  assetSource: string;
  approvalRequired: boolean;
  notes: string;
};

export type ClientSetupApprovalRules = {
  requireOwnerApproval: boolean;
  requireClientApproval: boolean;
  outboundPublishing: "approval_required" | "draft_only" | "manual_only";
  spendApprovalThreshold: string;
  notes: string;
};

export type ClientSetupReportingPreferences = {
  cadence: string;
  metrics: string[];
  recipients: string;
  notes: string;
};

export type ClientSetupCompleteness = {
  score: number;
  completed: string[];
  blockers: string[];
  nextAction: string;
};

export type ClientSetupSlot = {
  slotId: ClientSetupSlotId;
  slotKind: ClientSetupSlotKind;
  status: ClientSetupSlotStatus;
  organizationName: string;
  businessTemplate: BusinessTemplateKey | "";
  modules: Record<string, boolean>;
  servicesPackages: ClientSetupServicePackage[];
  leadSources: ClientSetupLeadSource[];
  socialMediaWorkflow: ClientSetupSocialWorkflow;
  approvalRules: ClientSetupApprovalRules;
  reportingPreferences: ClientSetupReportingPreferences;
  completeness: ClientSetupCompleteness;
  updatedAt: string;
  updatedBy: string;
};

export type ClientSetupAuditEntry = {
  id: string;
  tenantId: string;
  actor: string;
  slotId: ClientSetupSlotId;
  eventType: "created" | "updated";
  summary: string;
  createdAt: string;
};

export type ClientSetupDocument = {
  schemaVersion: 1;
  tenantId: string;
  version: number;
  slots: ClientSetupSlot[];
  audit: ClientSetupAuditEntry[];
  updatedAt: string;
  updatedBy: string;
  checksum: string;
};

export const CLIENT_SETUP_SLOT_IDS: ClientSetupSlotId[] = ["active-1", "active-2", "pending-1"];

export const CLIENT_SETUP_MODULES: ClientSetupModule[] = [
  { id: "lead_queue", label: "Lead Queue", description: "Capture and qualify new prospects." },
  { id: "follow_up_queue", label: "Follow-Up Queue", description: "Track callbacks, reminders, and nurture." },
  { id: "content_calendar", label: "Social/Content Calendar", description: "Plan approved posts and campaigns." },
  { id: "media_assets", label: "Media Assets", description: "Organize brand photos, clips, and creative." },
  { id: "approval_queue", label: "Approval Queue", description: "Hold outbound work until the right person approves." },
  { id: "client_requests", label: "Client Requests", description: "Collect asks, issues, and change requests." },
  { id: "employee_tasks", label: "Employee Tasks", description: "Assign work to team workspace members." },
  { id: "reports", label: "Reports", description: "Send progress, activity, and growth summaries." },
  { id: "packages_offers", label: "Packages/Offers", description: "Define sellable services and offers." },
  { id: "business_cleanup", label: "Business Cleanup Checklist", description: "Spot missing basics before growth work." },
];

export const CLIENT_SETUP_BUSINESS_TEMPLATES: ClientSetupBusinessTemplate[] = [
  {
    key: "local_service",
    label: "Local service business",
    description: "Appointments, local reputation, phone leads, and follow-up.",
    recommendedModules: ["lead_queue", "follow_up_queue", "approval_queue", "reports", "packages_offers", "business_cleanup"],
    starterPackages: [
      { name: "Service setup package", price: "", cadence: "one-time", notes: "Define intake, offer, proof, and follow-up path." },
      { name: "Managed growth retainer", price: "", cadence: "monthly", notes: "Ongoing lead, content, review, and report operations." },
    ],
    starterLeadSources: [
      { label: "Google Business Profile", type: "local_search", notes: "Public listing and local intent." },
      { label: "Referral partners", type: "relationship", notes: "Trusted local recommendations." },
      { label: "Website form", type: "owned", notes: "Owned intake and qualification." },
    ],
    reportingMetrics: ["new_leads", "follow_ups_due", "reviews", "appointments"],
  },
  {
    key: "media_content",
    label: "Media/content business",
    description: "Creative output, approvals, content cadence, and asset organization.",
    recommendedModules: ["content_calendar", "media_assets", "approval_queue", "client_requests", "employee_tasks", "reports"],
    starterPackages: [
      { name: "Content engine setup", price: "", cadence: "one-time", notes: "Build formats, approvals, and publishing lanes." },
      { name: "Monthly content operations", price: "", cadence: "monthly", notes: "Produce, organize, approve, and report." },
    ],
    starterLeadSources: [
      { label: "Portfolio inquiries", type: "owned", notes: "Inbound from work examples." },
      { label: "Social DMs", type: "social", notes: "Manual import until OAuth is connected." },
      { label: "Partner referrals", type: "relationship", notes: "Warm creative referrals." },
    ],
    reportingMetrics: ["assets_created", "posts_approved", "drafts_ready", "client_requests"],
  },
  {
    key: "contractor_home_service",
    label: "Contractor/home service",
    description: "Estimate requests, job follow-up, seasonal campaigns, and reviews.",
    recommendedModules: ["lead_queue", "follow_up_queue", "content_calendar", "approval_queue", "reports", "packages_offers"],
    starterPackages: [
      { name: "Estimate funnel setup", price: "", cadence: "one-time", notes: "Capture service area, job type, urgency, and quote path." },
      { name: "Seasonal growth ops", price: "", cadence: "monthly", notes: "Campaigns, follow-up, content, and local proof." },
    ],
    starterLeadSources: [
      { label: "Map pack", type: "local_search", notes: "Local service discovery." },
      { label: "Yard/signage referrals", type: "offline", notes: "Manual lead capture." },
      { label: "Quote request form", type: "owned", notes: "Owned intake." },
    ],
    reportingMetrics: ["quote_requests", "follow_ups_due", "jobs_won", "reviews"],
  },
  {
    key: "sports_team_club",
    label: "Sports/team/club",
    description: "Registrations, schedules, parent communications, content, and sponsors.",
    recommendedModules: ["client_requests", "content_calendar", "media_assets", "approval_queue", "reports", "employee_tasks"],
    starterPackages: [
      { name: "Team command setup", price: "", cadence: "seasonal", notes: "Organize registrations, media, updates, and approvals." },
      { name: "Sponsor/content operations", price: "", cadence: "monthly", notes: "Coordinate sponsor posts, highlights, and reports." },
    ],
    starterLeadSources: [
      { label: "Registration interest", type: "owned", notes: "Families or players asking to join." },
      { label: "School/community referrals", type: "relationship", notes: "Community pipeline." },
      { label: "Event signups", type: "event", notes: "Clinics, camps, or tryouts." },
    ],
    reportingMetrics: ["registrations", "requests_open", "content_ready", "sponsor_deliverables"],
  },
  {
    key: "restaurant_bar_venue",
    label: "Restaurant/bar/venue",
    description: "Events, offers, reservations, reputation, and daily content.",
    recommendedModules: ["content_calendar", "media_assets", "lead_queue", "approval_queue", "reports", "packages_offers"],
    starterPackages: [
      { name: "Venue launch setup", price: "", cadence: "one-time", notes: "Offers, event calendar, media workflow, and reporting." },
      { name: "Weekly demand ops", price: "", cadence: "monthly", notes: "Events, posts, offers, and review follow-up." },
    ],
    starterLeadSources: [
      { label: "Event inquiries", type: "owned", notes: "Private events and group bookings." },
      { label: "Social comments/DMs", type: "social", notes: "Manual import until OAuth is connected." },
      { label: "Local listings", type: "local_search", notes: "Public discovery and reviews." },
    ],
    reportingMetrics: ["event_inquiries", "posts_ready", "offers_active", "reviews"],
  },
  {
    key: "professional_service",
    label: "Professional service",
    description: "Trust-building intake, referrals, consult scheduling, and proof reporting.",
    recommendedModules: ["lead_queue", "follow_up_queue", "approval_queue", "reports", "client_requests", "business_cleanup"],
    starterPackages: [
      { name: "Client intake setup", price: "", cadence: "one-time", notes: "Qualify fit, urgency, referral path, and consult next step." },
      { name: "Authority growth ops", price: "", cadence: "monthly", notes: "Proof, follow-up, education content, and reporting." },
    ],
    starterLeadSources: [
      { label: "Referral intake", type: "relationship", notes: "Warm referrals from existing network." },
      { label: "Website consult form", type: "owned", notes: "Owned lead path." },
      { label: "Directory profile", type: "directory", notes: "Public service listing." },
    ],
    reportingMetrics: ["qualified_leads", "consults_booked", "follow_ups_due", "proof_assets"],
  },
  {
    key: "crypto_startup_internal_ops",
    label: "Crypto/startup/internal ops",
    description: "Internal tasks, requests, launch updates, approvals, and reporting.",
    recommendedModules: ["employee_tasks", "client_requests", "approval_queue", "reports", "content_calendar", "business_cleanup"],
    starterPackages: [
      { name: "Ops command setup", price: "", cadence: "one-time", notes: "Define roles, approvals, launch tasks, and reporting." },
      { name: "Managed internal ops", price: "", cadence: "monthly", notes: "Keep tasks, launches, approvals, and updates moving." },
    ],
    starterLeadSources: [
      { label: "Partner intros", type: "relationship", notes: "Warm strategic conversations." },
      { label: "Waitlist or form", type: "owned", notes: "Owned interest capture." },
      { label: "Community requests", type: "community", notes: "Public requests captured manually." },
    ],
    reportingMetrics: ["open_tasks", "approvals_pending", "launch_updates", "requests_open"],
  },
];

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../../..");
const defaultRoot = resolve(repoRoot, "server/.local/client-setup");
const locks = new Map<string, Promise<unknown>>();
const templateKeys = new Set(CLIENT_SETUP_BUSINESS_TEMPLATES.map((template) => template.key));
const moduleIds = new Set(CLIENT_SETUP_MODULES.map((module) => module.id));

function safeTenantId(tenantId: string) {
  return tenantId.trim().replace(/[^a-zA-Z0-9_.:-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "unknown";
}

export function clientSetupRoot(override?: string) {
  return resolve(override || process.env.PHANTOMFORCE_CLIENT_SETUP_DIR || defaultRoot);
}

function documentPath(tenantId: string, root?: string) {
  return resolve(clientSetupRoot(root), `${safeTenantId(tenantId)}.json`);
}

function checksum(document: Omit<ClientSetupDocument, "checksum">) {
  return createHash("sha256").update(JSON.stringify({ ...document, checksum: undefined })).digest("hex");
}

async function withTenantLock<T>(tenantId: string, operation: () => Promise<T>): Promise<T> {
  const key = safeTenantId(tenantId);
  const previous = locks.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  locks.set(key, current);
  try {
    return await current;
  } finally {
    if (locks.get(key) === current) locks.delete(key);
  }
}

function cleanText(value: unknown, max = 240) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function cleanMultiline(value: unknown, max = 900) {
  return typeof value === "string" ? value.replace(/\r\n/g, "\n").trim().slice(0, max) : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function slotKindFor(slotId: ClientSetupSlotId): ClientSetupSlotKind {
  return slotId === "pending-1" ? "pending" : "active";
}

function cleanStatus(slotId: ClientSetupSlotId, value: unknown): ClientSetupSlotStatus {
  const slotKind = slotKindFor(slotId);
  if (slotKind === "pending") return value === "pending" ? "pending" : "empty";
  return value === "active" ? "active" : "empty";
}

function cleanTemplate(value: unknown): BusinessTemplateKey | "" {
  return typeof value === "string" && templateKeys.has(value as BusinessTemplateKey) ? value as BusinessTemplateKey : "";
}

function cleanModules(value: unknown, existing?: Record<string, boolean>) {
  const source = isRecord(value) ? value : existing ?? {};
  return Object.fromEntries(CLIENT_SETUP_MODULES.map((module) => [module.id, Boolean(source[module.id])]));
}

function cleanServicePackages(value: unknown): ClientSetupServicePackage[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).map((item) => {
    const source = isRecord(item) ? item : {};
    return {
      id: cleanText(source.id, 80) || randomUUID(),
      name: cleanText(source.name, 90),
      price: cleanText(source.price, 40),
      cadence: cleanText(source.cadence, 40),
      notes: cleanMultiline(source.notes, 500),
    };
  }).filter((item) => item.name || item.price || item.notes);
}

function cleanLeadSources(value: unknown): ClientSetupLeadSource[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 16).map((item) => {
    const source = isRecord(item) ? item : {};
    return {
      id: cleanText(source.id, 80) || randomUUID(),
      label: cleanText(source.label, 90),
      type: cleanText(source.type, 50),
      enabled: source.enabled !== false,
      notes: cleanMultiline(source.notes, 500),
    };
  }).filter((item) => item.label || item.type || item.notes);
}

function cleanPlatformList(value: unknown) {
  const known = new Set(["instagram", "tiktok", "youtube", "facebook", "x", "linkedin", "pinterest"]);
  return Array.isArray(value)
    ? value.map((item) => cleanText(item, 40).toLowerCase()).filter((item) => known.has(item)).slice(0, 7)
    : [];
}

function cleanSocialWorkflow(value: unknown): ClientSetupSocialWorkflow {
  const source = isRecord(value) ? value : {};
  return {
    enabled: Boolean(source.enabled),
    platforms: cleanPlatformList(source.platforms),
    cadence: cleanText(source.cadence, 80),
    assetSource: cleanText(source.assetSource, 80),
    approvalRequired: source.approvalRequired !== false,
    notes: cleanMultiline(source.notes, 700),
  };
}

function cleanApprovalRules(value: unknown): ClientSetupApprovalRules {
  const source = isRecord(value) ? value : {};
  const outbound = source.outboundPublishing === "draft_only" || source.outboundPublishing === "manual_only"
    ? source.outboundPublishing
    : "approval_required";
  return {
    requireOwnerApproval: source.requireOwnerApproval !== false,
    requireClientApproval: Boolean(source.requireClientApproval),
    outboundPublishing: outbound,
    spendApprovalThreshold: cleanText(source.spendApprovalThreshold, 40),
    notes: cleanMultiline(source.notes, 700),
  };
}

function cleanReportingPreferences(value: unknown): ClientSetupReportingPreferences {
  const source = isRecord(value) ? value : {};
  const metrics = Array.isArray(source.metrics)
    ? source.metrics.map((item) => cleanText(item, 60)).filter(Boolean).slice(0, 12)
    : [];
  return {
    cadence: cleanText(source.cadence, 80),
    metrics,
    recipients: cleanText(source.recipients, 220),
    notes: cleanMultiline(source.notes, 700),
  };
}

function calculateCompleteness(slot: Omit<ClientSetupSlot, "completeness">): ClientSetupCompleteness {
  if (slot.status === "empty") {
    return {
      score: 0,
      completed: [],
      blockers: ["Set this slot to active or pending before it counts as a client setup."],
      nextAction: slot.slotKind === "pending" ? "Mark this slot pending when a real prospect is ready." : "Mark this slot active when a real client is ready.",
    };
  }

  const checks: Array<[string, boolean, string]> = [
    ["organization", Boolean(slot.organizationName), "Name the organization."],
    ["business_template", Boolean(slot.businessTemplate), "Choose a business template."],
    ["modules", Object.values(slot.modules).some(Boolean), "Enable at least one operating module."],
    ["services_packages", slot.servicesPackages.length > 0, "Add at least one service/package."],
    ["lead_sources", slot.leadSources.some((source) => source.enabled), "Add at least one enabled lead source."],
    ["social_media_workflow", Boolean(slot.socialMediaWorkflow.cadence || slot.socialMediaWorkflow.platforms.length || slot.socialMediaWorkflow.assetSource), "Configure the social/media workflow."],
    ["approval_rules", Boolean(slot.approvalRules.outboundPublishing), "Confirm approval rules."],
    ["reporting_preferences", Boolean(slot.reportingPreferences.cadence || slot.reportingPreferences.metrics.length || slot.reportingPreferences.recipients), "Choose reporting preferences."],
  ];
  const completed = checks.filter(([, ok]) => ok).map(([id]) => id);
  const blockers = checks.filter(([, ok]) => !ok).map(([, , message]) => message);
  const score = Math.round((completed.length / checks.length) * 100);
  return {
    score,
    completed,
    blockers,
    nextAction: blockers[0] ?? "Ready for owner review, team access, and managed growth ops.",
  };
}

export function normalizeClientSetupSlot(
  value: unknown,
  slotId: ClientSetupSlotId,
  actor: string,
  existing?: ClientSetupSlot,
): ClientSetupSlot {
  const source = isRecord(value) ? value : {};
  const now = new Date().toISOString();
  const status = cleanStatus(slotId, source.status ?? existing?.status);
  const withoutCompleteness: Omit<ClientSetupSlot, "completeness"> = {
    slotId,
    slotKind: slotKindFor(slotId),
    status,
    organizationName: cleanText(source.organizationName ?? existing?.organizationName, 120),
    businessTemplate: cleanTemplate(source.businessTemplate ?? existing?.businessTemplate),
    modules: cleanModules(source.modules, existing?.modules),
    servicesPackages: cleanServicePackages(source.servicesPackages ?? existing?.servicesPackages),
    leadSources: cleanLeadSources(source.leadSources ?? existing?.leadSources),
    socialMediaWorkflow: cleanSocialWorkflow(source.socialMediaWorkflow ?? existing?.socialMediaWorkflow),
    approvalRules: cleanApprovalRules(source.approvalRules ?? existing?.approvalRules),
    reportingPreferences: cleanReportingPreferences(source.reportingPreferences ?? existing?.reportingPreferences),
    updatedAt: cleanText(source.updatedAt, 80) || now,
    updatedBy: cleanText(source.updatedBy ?? actor, 120) || "system",
  };
  return { ...withoutCompleteness, completeness: calculateCompleteness(withoutCompleteness) };
}

function defaultSlot(slotId: ClientSetupSlotId, actor: string): ClientSetupSlot {
  return normalizeClientSetupSlot({ status: "empty", modules: {} }, slotId, actor);
}

function documentWithChecksum(document: Omit<ClientSetupDocument, "checksum">): ClientSetupDocument {
  return { ...document, checksum: checksum(document) };
}

export function defaultClientSetupDocument(tenantId: string, actor = "system"): ClientSetupDocument {
  const now = new Date().toISOString();
  const base = {
    schemaVersion: 1 as const,
    tenantId: safeTenantId(tenantId),
    version: 1,
    slots: CLIENT_SETUP_SLOT_IDS.map((slotId) => defaultSlot(slotId, actor)),
    audit: [],
    updatedAt: now,
    updatedBy: actor,
  };
  return documentWithChecksum(base);
}

export async function readClientSetupDocument(tenantId: string, root?: string): Promise<ClientSetupDocument | null> {
  try {
    const raw = JSON.parse(await readFile(documentPath(tenantId, root), "utf8")) as ClientSetupDocument;
    const base = defaultClientSetupDocument(tenantId, "system");
    const slots = CLIENT_SETUP_SLOT_IDS.map((slotId) => {
      const existing = raw.slots?.find((slot) => slot.slotId === slotId);
      return normalizeClientSetupSlot(existing ?? base.slots.find((slot) => slot.slotId === slotId), slotId, existing?.updatedBy ?? "system", existing);
    });
    return documentWithChecksum({
      schemaVersion: 1,
      tenantId: safeTenantId(raw.tenantId || tenantId),
      version: Number.isInteger(raw.version) && raw.version > 0 ? raw.version : 1,
      slots,
      audit: Array.isArray(raw.audit) ? raw.audit.slice(-300) : [],
      updatedAt: cleanText(raw.updatedAt, 80) || new Date().toISOString(),
      updatedBy: cleanText(raw.updatedBy, 120) || "system",
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function writeClientSetupDocumentUnlocked(document: ClientSetupDocument, root?: string) {
  const path = documentPath(document.tenantId, root);
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
  return path;
}

export async function writeClientSetupDocument(document: ClientSetupDocument, root?: string) {
  return withTenantLock(document.tenantId, () => writeClientSetupDocumentUnlocked(document, root));
}

export async function getClientSetupDocument(tenantId: string, actor = "system", root?: string) {
  return await readClientSetupDocument(tenantId, root) ?? defaultClientSetupDocument(tenantId, actor);
}

export async function saveClientSetupSlot(options: {
  tenantId: string;
  slotId: ClientSetupSlotId;
  slot: unknown;
  actor: string;
  root?: string;
}) {
  return withTenantLock(options.tenantId, async () => {
    const existing = await readClientSetupDocument(options.tenantId, options.root);
    const current = existing ?? defaultClientSetupDocument(options.tenantId, options.actor);
    const previousSlot = current.slots.find((slot) => slot.slotId === options.slotId);
    const now = new Date().toISOString();
    const incoming = isRecord(options.slot) ? { ...options.slot, updatedAt: now, updatedBy: options.actor } : { updatedAt: now, updatedBy: options.actor };
    const nextSlot = normalizeClientSetupSlot(incoming, options.slotId, options.actor, previousSlot);
    const audit: ClientSetupAuditEntry = {
      id: randomUUID(),
      tenantId: current.tenantId,
      actor: options.actor,
      slotId: options.slotId,
      eventType: previousSlot && previousSlot.status !== "empty" ? "updated" : "created",
      summary: `${nextSlot.slotKind} setup slot ${options.slotId} saved with ${nextSlot.completeness.score}% completeness`,
      createdAt: now,
    };
    const document = documentWithChecksum({
      schemaVersion: 1,
      tenantId: current.tenantId,
      version: current.version + 1,
      slots: CLIENT_SETUP_SLOT_IDS.map((slotId) => slotId === options.slotId
        ? nextSlot
        : current.slots.find((slot) => slot.slotId === slotId) ?? defaultSlot(slotId, options.actor)),
      audit: [...current.audit, audit].slice(-300),
      updatedAt: now,
      updatedBy: options.actor,
    });
    const path = await writeClientSetupDocumentUnlocked(document, options.root);
    return { path, document, slot: nextSlot };
  });
}

export function publicClientSetupDocument(document: ClientSetupDocument) {
  return structuredClone({
    schemaVersion: document.schemaVersion,
    tenantId: document.tenantId,
    version: document.version,
    slots: document.slots,
    audit: document.audit.slice(-25),
    updatedAt: document.updatedAt,
    updatedBy: document.updatedBy,
    checksum: document.checksum,
  });
}

export function isClientSetupSlotId(value: unknown): value is ClientSetupSlotId {
  return typeof value === "string" && CLIENT_SETUP_SLOT_IDS.includes(value as ClientSetupSlotId);
}

export function applyBusinessTemplate(slot: ClientSetupSlot, templateKey: BusinessTemplateKey, actor = slot.updatedBy): ClientSetupSlot {
  const template = CLIENT_SETUP_BUSINESS_TEMPLATES.find((item) => item.key === templateKey);
  if (!template) return slot;
  const modules = Object.fromEntries(CLIENT_SETUP_MODULES.map((module) => [module.id, template.recommendedModules.includes(module.id)]));
  return normalizeClientSetupSlot({
    ...slot,
    businessTemplate: template.key,
    modules,
    servicesPackages: template.starterPackages.map((item) => ({ id: randomUUID(), ...item })),
    leadSources: template.starterLeadSources.map((item) => ({ id: randomUUID(), enabled: true, ...item })),
    socialMediaWorkflow: {
      ...slot.socialMediaWorkflow,
      enabled: template.recommendedModules.includes("content_calendar") || template.recommendedModules.includes("media_assets"),
      approvalRequired: true,
    },
    reportingPreferences: {
      ...slot.reportingPreferences,
      metrics: template.reportingMetrics,
    },
  }, slot.slotId, actor, slot);
}
