import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type ChicagoShotsInquiry = {
  id: string;
  idempotencyKey: string;
  name: string;
  email: string;
  phone: string;
  projectType: string;
  eventDate: string;
  location: string;
  budget: string;
  message: string;
  referral: string;
  attribution: {
    campaignId: string | null;
    campaignTag: string;
    utmSource: string;
    utmMedium: string;
    utmCampaign: string;
    landingUrl: string;
    referrerUrl: string;
  };
  status: "new" | "reviewing" | "qualified" | "booked" | "closed";
  responseDraft: {
    subject: string;
    body: string;
    externalSent: false;
  };
  createdAt: string;
  updatedAt: string;
};

type InquiryDocument = { schemaVersion: 2; inquiries: ChicagoShotsInquiry[] };
const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../../..");
const defaultPath = resolve(repoRoot, "server/.local/chicagoshots-inquiries/inquiries.json");
let lock: Promise<unknown> = Promise.resolve();

function storePath(override?: string) {
  return resolve(override || process.env.PHANTOMFORCE_CHICAGOSHOTS_INQUIRY_FILE || defaultPath);
}

function oneLine(value: unknown, max: number) {
  return String(value ?? "").replace(/\s+/gu, " ").trim().slice(0, max);
}

function notes(value: unknown, max: number) {
  return String(value ?? "").replace(/\r\n/gu, "\n").trim().slice(0, max);
}

function safePageUrl(value: unknown) {
  try {
    const parsed = new URL(oneLine(value, 800));
    if (!['http:', 'https:'].includes(parsed.protocol)) return "";
    return `${parsed.origin}${parsed.pathname}`.slice(0, 500);
  } catch {
    return "";
  }
}

function firstName(value: string) {
  return oneLine(value, 80).split(/\s+/u)[0] || "there";
}

function replyDraft(input: Omit<ChicagoShotsInquiry, "id" | "status" | "responseDraft" | "createdAt" | "updatedAt">) {
  const project = input.projectType || "media project";
  const dateLine = input.eventDate ? ` for ${input.eventDate}` : "";
  return {
    subject: `ChicagoShots inquiry received — ${project}`,
    body: `Hi ${firstName(input.name)},\n\nThanks for reaching out to ChicagoShots about your ${project}${dateLine}. I have your details and will review the date, location, and deliverables.\n\nI will follow up with any questions and the best next step for the project.\n\nJordan West\nChicagoShots\nhttps://chicagoshots.com`,
    externalSent: false as const,
  };
}

async function readDocument(override?: string): Promise<InquiryDocument> {
  try {
    const parsed = JSON.parse(await readFile(storePath(override), "utf8")) as Partial<InquiryDocument>;
    const inquiries = Array.isArray(parsed.inquiries) ? parsed.inquiries.slice(0, 2_000).map((inquiry) => ({
      ...inquiry,
      attribution: {
        campaignId: inquiry.attribution?.campaignId ? oneLine(inquiry.attribution.campaignId, 120) : null,
        campaignTag: oneLine(inquiry.attribution?.campaignTag, 180),
        utmSource: oneLine(inquiry.attribution?.utmSource, 120),
        utmMedium: oneLine(inquiry.attribution?.utmMedium, 120),
        utmCampaign: oneLine(inquiry.attribution?.utmCampaign, 180),
        landingUrl: safePageUrl(inquiry.attribution?.landingUrl),
        referrerUrl: safePageUrl(inquiry.attribution?.referrerUrl),
      },
    })) : [];
    return { schemaVersion: 2, inquiries };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { schemaVersion: 2, inquiries: [] };
    throw error;
  }
}

async function writeDocument(document: InquiryDocument, override?: string) {
  const target = storePath(override);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

export async function createChicagoShotsInquiry(input: {
  idempotencyKey: string;
  name: string;
  email: string;
  phone?: string;
  projectType: string;
  eventDate?: string;
  location?: string;
  budget?: string;
  message: string;
  referral?: string;
  attribution?: {
    campaignId?: string | null;
    campaignTag?: string;
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    landingUrl?: string;
    referrerUrl?: string;
  };
  root?: string;
}) {
  const current = lock;
  let release = () => {};
  lock = new Promise<void>((resolveLock) => { release = resolveLock; });
  await current.catch(() => undefined);
  try {
    const document = await readDocument(input.root);
    const key = oneLine(input.idempotencyKey, 180);
    const existing = document.inquiries.find((inquiry) => inquiry.idempotencyKey === key);
    if (existing) return { inquiry: existing, created: false };
    const now = new Date().toISOString();
    const clean = {
      idempotencyKey: key || randomUUID(),
      name: oneLine(input.name, 120),
      email: oneLine(input.email, 240).toLowerCase(),
      phone: oneLine(input.phone, 60),
      projectType: oneLine(input.projectType, 100),
      eventDate: oneLine(input.eventDate, 40),
      location: oneLine(input.location, 180),
      budget: oneLine(input.budget, 80),
      message: notes(input.message, 2_000),
      referral: oneLine(input.referral, 180),
      attribution: {
        campaignId: input.attribution?.campaignId ? oneLine(input.attribution.campaignId, 120) : null,
        campaignTag: oneLine(input.attribution?.campaignTag, 180),
        utmSource: oneLine(input.attribution?.utmSource, 120),
        utmMedium: oneLine(input.attribution?.utmMedium, 120),
        utmCampaign: oneLine(input.attribution?.utmCampaign, 180),
        landingUrl: safePageUrl(input.attribution?.landingUrl),
        referrerUrl: safePageUrl(input.attribution?.referrerUrl),
      },
    };
    const inquiry: ChicagoShotsInquiry = {
      id: randomUUID(),
      ...clean,
      status: "new",
      responseDraft: replyDraft(clean),
      createdAt: now,
      updatedAt: now,
    };
    document.inquiries.unshift(inquiry);
    document.inquiries = document.inquiries.slice(0, 2_000);
    await writeDocument(document, input.root);
    return { inquiry, created: true };
  } finally {
    release();
  }
}

export async function listChicagoShotsInquiries(limit = 50, root?: string) {
  const document = await readDocument(root);
  const safeLimit = Math.max(1, Math.min(200, Math.floor(limit || 50)));
  return document.inquiries
    .slice()
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, safeLimit);
}
