import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type ChicagoShotsCampaignDeliverableStatus = "planned" | "in_progress" | "ready_for_review" | "approved" | "published";

export type ChicagoShotsCampaign = {
  id: string;
  name: string;
  serviceLine: string;
  dateLabel: string;
  targetOutcome: string;
  attributionTag: string;
  channels: string[];
  deliverables: Array<{
    id: string;
    name: string;
    status: ChicagoShotsCampaignDeliverableStatus;
  }>;
  history: Array<{
    deliverableId: string;
    from: ChicagoShotsCampaignDeliverableStatus;
    to: ChicagoShotsCampaignDeliverableStatus;
    actor: string;
    at: string;
  }>;
  createdAt: string;
  updatedAt: string;
};

type CampaignDocument = { schemaVersion: 1; campaigns: ChicagoShotsCampaign[] };
const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../../..");
const defaultPath = resolve(repoRoot, "server/.local/chicagoshots-campaigns/campaigns.json");
const INTERNAL_STATUSES = new Set<ChicagoShotsCampaignDeliverableStatus>(["planned", "in_progress", "ready_for_review"]);
const CAMPAIGN_TEMPLATES = new Set(["wedding", "conference", "podcast", "sports", "brand", "custom"]);
let lock: Promise<unknown> = Promise.resolve();

function storePath(override?: string) {
  return resolve(override || process.env.PHANTOMFORCE_CHICAGOSHOTS_CAMPAIGN_FILE || defaultPath);
}

function cleanText(value: unknown, max: number) {
  return String(value ?? "").replace(/\s+/gu, " ").trim().slice(0, max);
}

function slug(value: unknown) {
  return cleanText(value, 120).toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "").slice(0, 70) || "campaign";
}

function templateDefinition(template: string) {
  const definitions: Record<string, { serviceLine: string; channels: string[]; deliverables: string[] }> = {
    wedding: { serviceLine: "Wedding + milestone", channels: ["Instagram", "TikTok", "YouTube", "Website"], deliverables: ["Shot map + release plan", "Hero wedding film", "Vertical story set", "Social cutdown batch", "Vendor referral kit", "Outcome case study"] },
    conference: { serviceLine: "Conference + expert media", channels: ["LinkedIn", "YouTube", "Instagram", "Podcast"], deliverables: ["Speaker + session capture map", "Conference recap film", "Expert clip series", "Sponsor asset package", "60–90 day authority calendar", "Performance + inquiry report"] },
    podcast: { serviceLine: "Podcast + expert series", channels: ["Podcast", "YouTube", "Instagram", "LinkedIn"], deliverables: ["Episode production brief", "Master episode", "Short-form clip batch", "Thumbnail system", "Release calendar", "Monthly growth report"] },
    sports: { serviceLine: "Sports + athletes", channels: ["Instagram", "TikTok", "YouTube", "Website"], deliverables: ["Game-day capture plan", "Game or season recap", "Athlete feature set", "Vertical highlight batch", "Sponsor asset package", "Performance + inquiry report"] },
    brand: { serviceLine: "Brand + business content", channels: ["LinkedIn", "Instagram", "YouTube", "Website"], deliverables: ["Audience + outcome brief", "Hero brand film", "Social cutdown batch", "Thumbnail + still set", "Release calendar", "Performance + inquiry report"] },
    custom: { serviceLine: "Custom media campaign", channels: ["Instagram", "YouTube", "Website"], deliverables: ["Campaign brief", "Capture plan", "Master edit", "Social cutdown batch", "Approval package", "Outcome report"] },
  };
  return definitions[template] || definitions.custom;
}

function seedCampaigns(): ChicagoShotsCampaign[] {
  const createdAt = "2026-09-14T00:00:00.000Z";
  return [
    {
      id: "wedding-2026-09-26",
      name: "Wedding Story Engine",
      serviceLine: "Wedding + milestone",
      dateLabel: "September 26, 2026",
      targetOutcome: "A premium story, vendor referral loop, and permission-cleared case study",
      attributionTag: "cs-wedding-2026-09-26",
      channels: ["Instagram", "TikTok", "YouTube", "Website"],
      deliverables: [
        { id: "shot-map", name: "Shot map + release plan", status: "planned" },
        { id: "hero-film", name: "Hero wedding film", status: "planned" },
        { id: "vertical-stories", name: "Vertical story set", status: "planned" },
        { id: "social-cutdowns", name: "Ten social cutdowns", status: "planned" },
        { id: "vendor-kit", name: "Vendor referral kit", status: "planned" },
        { id: "case-study", name: "Outcome case study", status: "planned" },
      ],
      history: [],
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "physician-conference-2026-10",
      name: "Physician Conference Authority Engine",
      serviceLine: "Conference + expert media",
      dateLabel: "October 2026",
      targetOutcome: "Extend the conference into a 60–90 day expert-education campaign",
      attributionTag: "cs-physician-conference-2026-10",
      channels: ["LinkedIn", "YouTube", "Instagram", "Podcast"],
      deliverables: [
        { id: "speaker-map", name: "Speaker + session capture map", status: "planned" },
        { id: "recap-film", name: "Conference recap film", status: "planned" },
        { id: "expert-clips", name: "Expert clip series", status: "planned" },
        { id: "sponsor-assets", name: "Sponsor asset package", status: "planned" },
        { id: "authority-calendar", name: "60–90 day authority calendar", status: "planned" },
        { id: "outcome-report", name: "Performance + inquiry report", status: "planned" },
      ],
      history: [],
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "menopause-podcast-always-on",
      name: "Menopause Podcast Always-On",
      serviceLine: "Podcast + expert series",
      dateLabel: "Ongoing",
      targetOutcome: "Build a recognizable authority channel with a repeatable release rhythm",
      attributionTag: "cs-menopause-podcast-always-on",
      channels: ["Podcast", "YouTube", "Instagram", "LinkedIn"],
      deliverables: [
        { id: "episode-batch", name: "Next episode batch", status: "planned" },
        { id: "clip-batch", name: "Short-form clip batch", status: "planned" },
        { id: "thumbnail-system", name: "Thumbnail system", status: "planned" },
        { id: "release-calendar", name: "Release calendar", status: "planned" },
        { id: "monthly-report", name: "Monthly growth report", status: "planned" },
      ],
      history: [],
      createdAt,
      updatedAt: createdAt,
    },
  ];
}

async function readDocument(override?: string): Promise<CampaignDocument> {
  try {
    const parsed = JSON.parse(await readFile(storePath(override), "utf8")) as Partial<CampaignDocument>;
    return { schemaVersion: 1, campaigns: Array.isArray(parsed.campaigns) ? parsed.campaigns.slice(0, 100) : seedCampaigns() };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { schemaVersion: 1, campaigns: seedCampaigns() };
    throw error;
  }
}

async function writeDocument(document: CampaignDocument, override?: string) {
  const target = storePath(override);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

export async function listChicagoShotsCampaigns(root?: string) {
  const document = await readDocument(root);
  return document.campaigns
    .slice()
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

export async function createChicagoShotsCampaign(input: {
  name: string;
  template: string;
  dateLabel?: string;
  targetOutcome: string;
  channels?: string[];
  actor: string;
  root?: string;
}) {
  const name = cleanText(input.name, 120);
  const targetOutcome = cleanText(input.targetOutcome, 320);
  const template = CAMPAIGN_TEMPLATES.has(input.template) ? input.template : "custom";
  if (name.length < 3) throw Object.assign(new Error("Campaign name must be at least 3 characters."), { statusCode: 400 });
  if (targetOutcome.length < 10) throw Object.assign(new Error("Target outcome must be at least 10 characters."), { statusCode: 400 });
  const current = lock;
  let release = () => {};
  lock = new Promise<void>((resolveLock) => { release = resolveLock; });
  await current.catch(() => undefined);
  try {
    const document = await readDocument(input.root);
    const definition = templateDefinition(template);
    const now = new Date().toISOString();
    const unique = randomUUID().slice(0, 8);
    const channels = [...new Set((Array.isArray(input.channels) ? input.channels : [])
      .map((channel) => cleanText(channel, 40))
      .filter(Boolean))].slice(0, 8);
    const campaign: ChicagoShotsCampaign = {
      id: `${slug(name)}-${unique}`,
      name,
      serviceLine: definition.serviceLine,
      dateLabel: cleanText(input.dateLabel, 80) || "Timing open",
      targetOutcome,
      attributionTag: `cs-${slug(name)}-${unique}`,
      channels: channels.length ? channels : definition.channels,
      deliverables: definition.deliverables.map((deliverable, index) => ({
        id: `${slug(deliverable)}-${index + 1}`,
        name: deliverable,
        status: "planned",
      })),
      history: [],
      createdAt: now,
      updatedAt: now,
    };
    document.campaigns.unshift(campaign);
    document.campaigns = document.campaigns.slice(0, 100);
    await writeDocument(document, input.root);
    return campaign;
  } finally {
    release();
  }
}

export async function updateChicagoShotsCampaignDeliverable(input: {
  campaignId: string;
  deliverableId: string;
  status: ChicagoShotsCampaignDeliverableStatus;
  actor: string;
  root?: string;
}) {
  if (!INTERNAL_STATUSES.has(input.status)) {
    throw Object.assign(new Error("Approval and published states must come from the approval and provider-receipt systems."), { statusCode: 400 });
  }
  const current = lock;
  let release = () => {};
  lock = new Promise<void>((resolveLock) => { release = resolveLock; });
  await current.catch(() => undefined);
  try {
    const document = await readDocument(input.root);
    const campaign = document.campaigns.find((item) => item.id === input.campaignId);
    if (!campaign) throw Object.assign(new Error("Campaign not found."), { statusCode: 404 });
    const deliverable = campaign.deliverables.find((item) => item.id === input.deliverableId);
    if (!deliverable) throw Object.assign(new Error("Campaign deliverable not found."), { statusCode: 404 });
    const previous = deliverable.status;
    if (previous === "approved" || previous === "published") {
      throw Object.assign(new Error("Approved or published work cannot be changed from the production tracker."), { statusCode: 409 });
    }
    if (previous !== input.status) {
      const now = new Date().toISOString();
      deliverable.status = input.status;
      campaign.updatedAt = now;
      campaign.history.unshift({
        deliverableId: deliverable.id,
        from: previous,
        to: input.status,
        actor: String(input.actor || "unknown").slice(0, 180),
        at: now,
      });
      campaign.history = campaign.history.slice(0, 500);
      await writeDocument(document, input.root);
    }
    return { campaign, deliverable, changed: previous !== input.status };
  } finally {
    release();
  }
}
