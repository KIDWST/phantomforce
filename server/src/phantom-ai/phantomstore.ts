/* PhantomStore — a community marketplace for AI-built tools and apps, distinct
   from PhantomPlay (games) and Site & Store Studio (client website builder).
   Any registered PhantomForce account can submit a tool; nothing goes live
   until an admin approves it, mirroring the exact submission/moderation shape
   already proven in ./phantomplay.ts.

   Deliberate scope boundary: PhantomStore never hosts or executes a
   submitted tool's code. "Install" means a copy-ready command (npm/pip/git/
   docker/etc, author-supplied) plus a required link to the tool's real
   source repo — the platform is a directory with a moderation queue, not a
   code-execution or distribution channel. Letting arbitrary registered users
   push something that auto-runs on another user's machine would turn this
   into a malware vector; reviewable metadata + an outbound link keeps the
   actual install/run decision (and the code being run) in the installer's
   own hands. */

import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { AccessSession } from "../access/session.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../../..");
const storePath = process.env.PHANTOMFORCE_PHANTOMSTORE_PATH || resolve(repoRoot, ".phantom", "phantomstore.json");
const retryableWriteCodes = new Set(["EPERM", "EACCES", "EBUSY"]);

/* Built from character codes rather than a \u escape literal, to avoid any
   editor/pipeline re-interpreting the escape sequence as a raw control byte. */
const CONTROL_CHARS = new RegExp("[" + String.fromCharCode(0) + "-" + String.fromCharCode(31) + String.fromCharCode(127) + "]", "g");
const clean = (value: unknown, max = 500) => String(value ?? "").trim().replace(CONTROL_CHARS, " ").slice(0, max);
const now = () => new Date().toISOString();

export type PhantomStoreCategory = "AI Tool" | "Agent" | "CLI" | "Library" | "Extension" | "Model" | "Template" | "Dataset";
const CATEGORIES: PhantomStoreCategory[] = ["AI Tool", "Agent", "CLI", "Library", "Extension", "Model", "Template", "Dataset"];
function safeCategory(value: unknown): PhantomStoreCategory {
  const v = clean(value, 30);
  return (CATEGORIES as string[]).includes(v) ? (v as PhantomStoreCategory) : "AI Tool";
}

export type PhantomStoreInstallMethod = "npm" | "pip" | "git" | "docker" | "brew" | "binary" | "manual";
const INSTALL_METHODS: PhantomStoreInstallMethod[] = ["npm", "pip", "git", "docker", "brew", "binary", "manual"];
function safeInstallMethod(value: unknown): PhantomStoreInstallMethod {
  const v = clean(value, 20).toLowerCase();
  return (INSTALL_METHODS as string[]).includes(v) ? (v as PhantomStoreInstallMethod) : "manual";
}

export type PhantomStoreSubmissionStatus = "draft" | "submitted" | "changes_requested" | "approved" | "rejected" | "disabled";

function safeUrl(value: unknown): string {
  const url = clean(value, 700);
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? url : "";
  } catch {
    return "";
  }
}

export type PhantomStoreTool = {
  id: string;
  tenantId: string;
  developerId: string;
  developerName: string;
  name: string;
  summary: string;
  description: string;
  category: PhantomStoreCategory;
  tags: string[];
  repoUrl: string;
  homepageUrl: string;
  installMethod: PhantomStoreInstallMethod;
  installCommand: string;
  version: string;
  license: string;
  status: PhantomStoreSubmissionStatus;
  featured: boolean;
  moderationNote: string;
  installClicks: number;
  createdAt: string;
  updatedAt: string;
};

export type PhantomStoreDraftReadiness = "ready_for_review" | "needs_review" | "missing_source";

export type PhantomStoreGeneratedDraft = ReturnType<typeof toolInput> & {
  sourceIndex: number;
  sourceLine: string;
  readiness: PhantomStoreDraftReadiness;
  confidence: number;
  missingFields: string[];
  notes: string[];
};

export type PhantomStoreReview = {
  id: string;
  authorName: string;
  rating: number;
  title: string;
  body: string;
  createdAt: string;
  verified: boolean;
};

export type PhantomStoreSeller = {
  id: string;
  name: string;
  handle: string;
  tagline: string;
  summary: string;
  websiteUrl: string;
  supportUrl: string;
  rating: number;
  reviewCount: number;
  productCount: number;
  reviews: PhantomStoreReview[];
  featured: boolean;
};

export type PhantomStoreProduct = {
  id: string;
  sellerId: string;
  name: string;
  summary: string;
  description: string;
  category: "Desktop App" | "AI Suite" | "Plugin" | "Automation" | "Creative Tool";
  priceLabel: string;
  buyLabel: string;
  buyUrl: string;
  delivery: string;
  version: string;
  status: "available" | "quality_hold";
  qualityNote: string;
  imageUrl: string;
  /* The untouched product screenshot the AI key art was rendered from. Kept
     side by side with imageUrl so the marketing art never has to pretend to
     be a raw screenshot — the UI links buyers to the real thing. */
  referenceImageUrl: string;
  tags: string[];
  badges: string[];
  rating: number;
  reviewCount: number;
  featured: boolean;
  updatedAt: string;
  reviews: PhantomStoreReview[];
};

type PhantomStoreStore = {
  version: 1;
  tools: PhantomStoreTool[];
  productClicks: Record<string, number>;
};

const seededReviews = {
  termina: [
    {
      id: "review-termina-mission-wall",
      authorName: "PhantomForce QA",
      rating: 5,
      title: "The terminal wall finally feels like a product.",
      body: "Multi-agent launches, isolated worktrees, mission ledgers, and replayable reports make Termina feel less like a script and more like a command center.",
      createdAt: "2026-07-17T00:00:00.000Z",
      verified: true,
    },
  ],
  phantomforce: [
    {
      id: "review-phantomforce-os",
      authorName: "Owner workspace",
      rating: 5,
      title: "Everything routes through one business brain.",
      body: "The value is the combination: media, sites, analytics, competitors, approvals, and AI execution in one protected workspace.",
      createdAt: "2026-07-17T00:00:00.000Z",
      verified: true,
    },
  ],
  vocal: [
    {
      id: "review-vocal-ai",
      authorName: "Studio tester",
      rating: 4,
      title: "Fast vocal-chain starting point.",
      body: "Prompting a vocal tone and getting a usable chain is exactly the right direction for creators who do not want to babysit knobs.",
      createdAt: "2026-07-17T00:00:00.000Z",
      verified: true,
    },
  ],
  seller: [
    {
      id: "review-seller-phantomforce",
      authorName: "Launch desk",
      rating: 5,
      title: "Ships ambitious tools with buyer safety gates.",
      body: "The seller catalog is strongest when products are listed with honest readiness notes, clear support paths, and visible review proof.",
      createdAt: "2026-07-17T00:00:00.000Z",
      verified: true,
    },
  ],
} satisfies Record<string, PhantomStoreReview[]>;

const SEEDED_SELLERS: PhantomStoreSeller[] = [
  {
    id: "seller-phantomforce",
    name: "PhantomForce",
    handle: "@phantomforce",
    tagline: "Local-first AI tools for operators, creators, and builders.",
    summary: "PhantomForce builds owner-controlled AI software: business command centers, terminal automation, creator tooling, and production-grade local workflows.",
    websiteUrl: "https://phantomforce.online",
    supportUrl: "https://phantomforce.online/support",
    rating: 5,
    reviewCount: seededReviews.seller.length,
    productCount: 3,
    reviews: seededReviews.seller,
    featured: true,
  },
];

const SEEDED_PRODUCTS: PhantomStoreProduct[] = [
  {
    id: "product-termina",
    sellerId: "seller-phantomforce",
    name: "Termina",
    summary: "The advanced CLI workflow manager: a CCTV-style terminal wall for launching, supervising, and orchestrating multiple AI coding agents from one local command center.",
    description:
      "Termina opens multiple isolated worker terminals, dispatches individualized mission prompts, tracks ledgers, and keeps local AI/CLI orchestration private. The current release includes a hardened paste-and-submit path for multi-CLI dispatch.",
    category: "Desktop App",
    priceLabel: "$49 early access",
    buyLabel: "Buy Termina",
    buyUrl: "https://phantomforce.online/phantomstore/termina",
    delivery: "Windows desktop download",
    version: "0.2.0",
    status: "available",
    qualityNote: "Multi-CLI submit reliability is a launch gate and is covered by Termina's dispatch retry tests.",
    imageUrl: "/app/assets/phantomstore/termina-cover-ai.webp?v=20260721",
    referenceImageUrl: "/app/assets/phantomstore/termina-cover.png",
    tags: ["local ai", "terminal wall", "multi-agent", "privacy"],
    badges: ["Local-first", "Desktop", "Launch-ready QA"],
    rating: 5,
    reviewCount: seededReviews.termina.length,
    featured: true,
    updatedAt: "2026-07-17T00:00:00.000Z",
    reviews: seededReviews.termina,
  },
  {
    id: "product-phantomforce-os",
    sellerId: "seller-phantomforce",
    name: "PhantomForce Business OS",
    summary: "The main PhantomForce workspace for media, sites, analytics, competitor intel, approvals, and AI execution.",
    description:
      "A protected operating layer for running a business with AI. It keeps public actions approval-gated while the backend learns the business through onboarding, workspace context, and owner-controlled memory.",
    category: "AI Suite",
    priceLabel: "Plans from free",
    buyLabel: "Choose plan",
    buyUrl: "https://app.phantomforce.online",
    delivery: "Web app workspace",
    version: "2026.07",
    status: "available",
    qualityNote: "Free plan remains available for previewing the workspace before upgrading.",
    imageUrl: "/app/assets/phantomstore/phantomforce-os-cover-ai.webp?v=20260721",
    referenceImageUrl: "/app/assets/phantomstore/phantomforce-os-cover.jpg",
    tags: ["business os", "media lab", "analytics", "sites"],
    badges: ["Free plan", "Workspace", "Owner gated"],
    rating: 5,
    reviewCount: seededReviews.phantomforce.length,
    featured: true,
    updatedAt: "2026-07-17T00:00:00.000Z",
    reviews: seededReviews.phantomforce,
  },
  {
    id: "product-phantom-vocal-ai",
    sellerId: "seller-phantomforce",
    name: "Phantom Vocal AI",
    summary: "A prompt-first Reaper vocal-chain assistant for creators who want sound design without knob clutter.",
    description:
      "Describe the vocal you want and Phantom Vocal AI prepares a modern vocal chain direction. Designed for a cleaner slider/prompter workflow inside Reaper.",
    category: "Plugin",
    priceLabel: "$29 creator license",
    buyLabel: "Buy plugin",
    buyUrl: "https://phantomforce.online/phantomstore/vocal-ai",
    delivery: "Reaper plugin download",
    version: "0.1.0",
    status: "available",
    qualityNote: "UI refresh is focused on prompt-first controls, modern sliders, and better Reaper fit.",
    imageUrl: "/app/assets/phantomstore/phantom-vocal-ai-cover-ai.webp?v=20260721",
    referenceImageUrl: "/app/assets/phantomstore/phantom-vocal-ai-cover.jpg",
    tags: ["reaper", "vocal chain", "creator tool", "audio"],
    badges: ["Reaper", "Creator", "Prompt-first"],
    rating: 4.5,
    reviewCount: seededReviews.vocal.length,
    featured: false,
    updatedAt: "2026-07-17T00:00:00.000Z",
    reviews: seededReviews.vocal,
  },
  {
    id: "product-phantombot",
    sellerId: "seller-phantomforce",
    name: "Phantombot",
    summary: "The elite premium mission controller: unlimited-usage AI coding assistance routed across premium and local models for one flat monthly price.",
    description:
      "Phantombot routes every request through a cloud-preferred, local-guaranteed chain — your own subscription and API keys first, then OpenRouter, with a local model as the always-available fallback so you're never hard-blocked. Built for operators who want a Codex/Claude-Code-style coding agent experience without per-token anxiety.",
    category: "AI Suite",
    priceLabel: "$20/mo unlimited",
    buyLabel: "Subscribe to Phantombot",
    buyUrl: "https://app.phantomforce.online",
    delivery: "Hosted + local-routed workspace access",
    version: "2026.07",
    status: "available",
    qualityNote: "\"Unlimited\" means unmetered routing across your connected providers and local fallback, not unlimited underlying provider capacity — heavy use may shift to the local model during provider limits.",
    imageUrl: "",
    referenceImageUrl: "",
    tags: ["ai coding agent", "unlimited usage", "local fallback", "automation"],
    badges: ["Unlimited usage", "Cloud + local", "Mission controller"],
    rating: 0,
    reviewCount: 0,
    featured: true,
    updatedAt: "2026-07-22T00:00:00.000Z",
    reviews: [],
  },
  {
    id: "product-phantombot-unleashed",
    sellerId: "seller-phantomforce",
    name: "Phantombot Unleashed",
    summary: "The fully local, self-hosted edition of Phantombot for operators who want complete control over where their agent runs and what it can touch.",
    description:
      "A standalone, self-hosted build of the Phantombot engine and UI shell for advanced users who want to run entirely on their own machine — no hosted account required, full control over configuration and local models. Still in active development.",
    category: "Automation",
    priceLabel: "Coming soon",
    buyLabel: "Notify me",
    buyUrl: "",
    delivery: "Self-hosted download",
    version: "0.0.0-dev",
    status: "quality_hold",
    qualityNote: "In active development — not yet packaged for public release.",
    imageUrl: "",
    referenceImageUrl: "",
    tags: ["self-hosted", "local ai", "advanced users", "privacy"],
    badges: ["Self-hosted", "Local-only", "In development"],
    rating: 0,
    reviewCount: 0,
    featured: false,
    updatedAt: "2026-07-22T00:00:00.000Z",
    reviews: [],
  },
];
SEEDED_SELLERS[0].productCount = SEEDED_PRODUCTS.length;

async function readStore(): Promise<PhantomStoreStore> {
  try {
    const parsed = JSON.parse(await readFile(storePath, "utf8")) as Partial<PhantomStoreStore>;
    return {
      version: 1,
      tools: Array.isArray(parsed.tools) ? parsed.tools : [],
      productClicks: parsed.productClicks && typeof parsed.productClicks === "object" ? parsed.productClicks : {},
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, tools: [], productClicks: {} };
    throw error;
  }
}

let writes = Promise.resolve();
const sleep = (ms: number) => new Promise((resolveFn) => setTimeout(resolveFn, ms));

async function replaceStoreFile(temp: string, target: string) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      await rename(temp, target);
      return;
    } catch (error) {
      lastError = error;
      const code = String((error as NodeJS.ErrnoException).code || "");
      if (!retryableWriteCodes.has(code)) throw error;
      await sleep(40 * (attempt + 1));
    }
  }
  try {
    await copyFile(temp, target);
    await unlink(temp).catch(() => undefined);
  } catch (fallbackError) {
    throw lastError instanceof Error ? lastError : fallbackError;
  }
}

async function writeStore(store: PhantomStoreStore) {
  const nextWrite = writes.catch(() => undefined).then(async () => {
    await mkdir(dirname(storePath), { recursive: true });
    const temp = `${storePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(store, null, 2), "utf8");
    await replaceStoreFile(temp, storePath);
  });
  writes = nextWrite.catch(() => undefined);
  await nextWrite;
}

function tenantIdFor(session: AccessSession, requested?: unknown) {
  const own = session.orgId || session.clientId || session.id || "phantomforce";
  if (!session.canManageAccess) return clean(own, 100) || "phantomforce";
  return clean(requested, 100) || clean(own, 100) || "phantomforce";
}

function actorIdFor(session: AccessSession) {
  return clean(session.userId || session.id, 120) || "anonymous";
}

/* A fixed cap, not plan-tied -- PhantomStore is new and additive; wiring it
   into the entitlements engine's per-plan limits is a follow-up, not a
   blocker for a first version. */
const MAX_SUBMISSIONS_PER_DEVELOPER = 250;
const MAX_AI_DRAFTS_PER_REQUEST = 120;

function toolInput(input: Record<string, unknown>) {
  return {
    name: clean(input.name, 90),
    summary: clean(input.summary, 220),
    description: clean(input.description, 4000),
    category: safeCategory(input.category),
    tags: Array.isArray(input.tags) ? input.tags.map((t) => clean(t, 30)).filter(Boolean).slice(0, 8) : [],
    repoUrl: safeUrl(input.repoUrl),
    homepageUrl: safeUrl(input.homepageUrl),
    installMethod: safeInstallMethod(input.installMethod),
    installCommand: clean(input.installCommand, 400),
    version: clean(input.version, 40) || "1.0.0",
    license: clean(input.license, 60),
  };
}

function toolValidation(data: ReturnType<typeof toolInput>) {
  const issues: string[] = [];
  if (!data.name) issues.push("Name is required.");
  if (!data.summary) issues.push("Add a one-line summary.");
  if (!data.description) issues.push("Add a fuller description.");
  if (!data.repoUrl) issues.push("A real source/repo URL is required -- PhantomStore links out to the real thing, it doesn't host uploads.");
  if (!data.installCommand && data.installMethod !== "manual") issues.push("Add the exact install command (e.g. npm install ..., pip install ..., git clone ...).");
  return issues;
}

function titleCaseName(value: string) {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, 8)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function slugFromName(value: string) {
  return clean(value, 90).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "phantomstore-tool";
}

function inferCategory(text: string): PhantomStoreCategory {
  const lower = text.toLowerCase();
  if (/\b(agent|bot|workforce|operator)\b/.test(lower)) return "Agent";
  if (/\b(cli|terminal|command line|powershell|bash)\b/.test(lower)) return "CLI";
  if (/\b(sdk|library|package|npm|pip)\b/.test(lower)) return "Library";
  if (/\b(extension|chrome|browser|vscode)\b/.test(lower)) return "Extension";
  if (/\b(model|llm|lora|embedding|checkpoint)\b/.test(lower)) return "Model";
  if (/\b(template|starter|boilerplate|prompt pack)\b/.test(lower)) return "Template";
  if (/\b(dataset|data set|training data|csv)\b/.test(lower)) return "Dataset";
  return "AI Tool";
}

function inferInstall(text: string, repoUrl: string, defaultMethod: PhantomStoreInstallMethod) {
  const line = text.match(/\b(npm\s+(?:install|i)[^\n,;]*)/i)?.[1]
    || text.match(/\b(pip\s+install[^\n,;]*)/i)?.[1]
    || text.match(/\b(docker\s+(?:pull|run)[^\n,;]*)/i)?.[1]
    || text.match(/\b(brew\s+install[^\n,;]*)/i)?.[1]
    || text.match(/\b(git\s+clone[^\n,;]*)/i)?.[1]
    || "";
  const command = clean(line, 400);
  if (/^npm\s/i.test(command)) return { installMethod: "npm" as const, installCommand: command };
  if (/^pip\s/i.test(command)) return { installMethod: "pip" as const, installCommand: command };
  if (/^docker\s/i.test(command)) return { installMethod: "docker" as const, installCommand: command };
  if (/^brew\s/i.test(command)) return { installMethod: "brew" as const, installCommand: command };
  if (/^git\s/i.test(command)) return { installMethod: "git" as const, installCommand: command };
  if (repoUrl && /github\.com|gitlab\.com|bitbucket\.org/i.test(repoUrl)) return { installMethod: "git" as const, installCommand: `git clone ${repoUrl}` };
  return { installMethod: defaultMethod, installCommand: defaultMethod === "manual" ? "" : `${defaultMethod} install ${slugFromName(text)}` };
}

function inferTags(text: string, category: PhantomStoreCategory) {
  const lower = text.toLowerCase();
  const tags = new Set<string>([category.toLowerCase().replace(/\s+/g, "-")]);
  [
    "crm", "sales", "content", "caption", "video", "workflow", "automation", "security", "dashboard",
    "analytics", "voice", "music", "sports", "agent", "local", "privacy", "website", "store",
  ].forEach((tag) => { if (lower.includes(tag)) tags.add(tag); });
  return [...tags].slice(0, 8);
}

function splitDraftSource(sourceText: unknown) {
  const source = String(sourceText ?? "")
    .replace(new RegExp("[" + String.fromCharCode(0) + "-" + String.fromCharCode(8) + String.fromCharCode(11) + String.fromCharCode(12) + String.fromCharCode(14) + "-" + String.fromCharCode(31) + String.fromCharCode(127) + "]", "g"), " ")
    .trim()
    .slice(0, 60000);
  const lines = source.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];
  if (lines.length >= 2) return lines.map((line) => line.replace(/^[-*•\d.)\s]+/, "").trim()).filter(Boolean);
  const bulletLines = lines
    .filter((line) => /^[-*•\d.)\s]+/.test(line) || /^https?:\/\//i.test(line) || line.includes(","))
    .map((line) => line.replace(/^[-*•\d.)\s]+/, "").trim())
    .filter(Boolean);
  if (bulletLines.length >= 2) return bulletLines;
  return source.split(/\n\s*\n/g).map((entry) => entry.trim()).filter(Boolean);
}

function generatedDraftFromEntry(entry: string, sourceIndex: number, input: Record<string, unknown>): PhantomStoreGeneratedDraft {
  const urls = entry.match(/https?:\/\/[^\s,;)\]]+/gi) || [];
  const repoUrl = safeUrl(urls.find((url) => /github\.com|gitlab\.com|bitbucket\.org/i.test(url)) || "");
  const homepageUrl = safeUrl(urls.find((url) => url !== repoUrl) || "");
  const withoutUrls = entry.replace(/https?:\/\/[^\s,;)\]]+/gi, " ").replace(/\s+/g, " ").trim();
  const namePart = clean(withoutUrls.split(/\s[-–—:|]\s/)[0] || withoutUrls.split(",")[0], 90);
  const inferredName = titleCaseName(namePart || repoUrl.split("/").filter(Boolean).pop() || "Untitled tool");
  const summaryRaw = clean(withoutUrls.replace(namePart, "").replace(/^[-–—:|,\s]+/, ""), 220);
  const category = safeCategory(input.defaultCategory || inferCategory(entry));
  const install = inferInstall(entry, repoUrl, safeInstallMethod(input.defaultInstallMethod || "manual"));
  const data = toolInput({
    name: inferredName,
    summary: summaryRaw || `AI marketplace draft for ${inferredName}.`,
    description: withoutUrls || `Review ${inferredName}, confirm the source URL, and complete the marketplace notes before submission.`,
    category,
    tags: inferTags(entry, category),
    repoUrl,
    homepageUrl,
    installMethod: install.installMethod,
    installCommand: install.installCommand,
    version: "1.0.0",
    license: clean(input.defaultLicense, 60) || "MIT",
  });
  const missingFields = toolValidation(data);
  const readiness: PhantomStoreDraftReadiness = data.repoUrl ? (missingFields.length ? "needs_review" : "ready_for_review") : "missing_source";
  const confidence = Math.max(30, 95 - missingFields.length * 16 - (summaryRaw ? 0 : 10) - (repoUrl ? 0 : 22));
  return {
    ...data,
    sourceIndex,
    sourceLine: clean(entry, 700),
    readiness,
    confidence,
    missingFields,
    notes: [
      "Generated from pasted local input only.",
      "Draft only: nothing was submitted, installed, uploaded, or fetched externally.",
      ...(readiness === "missing_source" ? ["Add a real source/repo URL before submitting for public review."] : []),
    ],
  };
}

export function generatePhantomStoreSubmissionDrafts(input: Record<string, unknown>) {
  const limit = Math.min(Math.max(Number(input.limit || 40) || 40, 1), MAX_AI_DRAFTS_PER_REQUEST);
  const entries = splitDraftSource(input.sourceText).slice(0, limit);
  const drafts = entries.map((entry, index) => generatedDraftFromEntry(entry, index + 1, input));
  return {
    drafts,
    totalDetected: splitDraftSource(input.sourceText).length,
    cappedAt: limit,
    provider: "phantom_deterministic_intake",
    providerCalled: false,
    externalFetchPerformed: false,
    databaseWritten: false,
    note: "Phantom drafted marketplace metadata from the pasted text only. Review before submitting anything publicly.",
  };
}

function publicTool(tool: PhantomStoreTool) {
  const { moderationNote: _moderationNote, ...rest } = tool;
  return rest;
}

function catalogFor(store: PhantomStoreStore) {
  return store.tools.filter((tool) => tool.status === "approved").map(publicTool);
}

function marketplaceFor(store: PhantomStoreStore) {
  const productClicks = store.productClicks || {};
  const products = SEEDED_PRODUCTS.map((product) => ({
    ...product,
    buyClicks: Number(productClicks[product.id] || 0),
    seller: SEEDED_SELLERS.find((seller) => seller.id === product.sellerId) || null,
  }));
  const sellers = SEEDED_SELLERS.map((seller) => ({
    ...seller,
    productCount: products.filter((product) => product.sellerId === seller.id).length,
  }));
  return { sellers, products };
}

export async function getPhantomStoreSnapshot(session: AccessSession, options: { tenantId?: unknown } = {}) {
  const tenantId = tenantIdFor(session, options.tenantId);
  const actorId = actorIdFor(session);
  const store = await readStore();
  const canModerate = session.canManageAccess === true || session.isSuperAdmin === true;
  const mine = store.tools.filter((tool) => tool.developerId === actorId);
  const marketplace = marketplaceFor(store);
  return {
    tenantId,
    actorId,
    catalog: catalogFor(store),
    sellers: marketplace.sellers,
    products: marketplace.products,
    submissions: (canModerate ? store.tools : mine).slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    pendingReviewCount: store.tools.filter((tool) => tool.status === "submitted").length,
    canModerate,
    submissionLimit: MAX_SUBMISSIONS_PER_DEVELOPER,
  };
}

export async function submitPhantomStoreTool(session: AccessSession, input: Record<string, unknown>) {
  const tenantId = tenantIdFor(session, input.tenantId);
  const actorId = actorIdFor(session);
  const store = await readStore();
  const ownCount = store.tools.filter((tool) => tool.developerId === actorId).length;
  if (ownCount >= MAX_SUBMISSIONS_PER_DEVELOPER && !session.canManageAccess) {
    throw new Error(`You've reached the ${MAX_SUBMISSIONS_PER_DEVELOPER}-tool submission limit.`);
  }
  const data = toolInput(input);
  const submit = input.submit === true;
  const issues = toolValidation(data);
  if (submit && issues.length) throw new Error(issues.join(" "));
  const timestamp = now();
  const tool: PhantomStoreTool = {
    id: `tool-${randomUUID()}`,
    tenantId,
    developerId: actorId,
    developerName: clean(input.developerName || session.label, 90) || "Developer",
    ...data,
    status: submit ? "submitted" : "draft",
    featured: false,
    moderationNote: "",
    installClicks: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  store.tools.unshift(tool);
  await writeStore(store);
  return { tool, issues };
}

export async function saveGeneratedPhantomStoreDrafts(session: AccessSession, input: Record<string, unknown>) {
  const tenantId = tenantIdFor(session, input.tenantId);
  const actorId = actorIdFor(session);
  const store = await readStore();
  const ownCount = store.tools.filter((tool) => tool.developerId === actorId).length;
  const availableSlots = session.canManageAccess ? MAX_AI_DRAFTS_PER_REQUEST : Math.max(0, MAX_SUBMISSIONS_PER_DEVELOPER - ownCount);
  const incoming = Array.isArray(input.drafts) ? input.drafts.slice(0, availableSlots) : [];
  if (!incoming.length) {
    return { tools: [], skipped: Array.isArray(input.drafts) ? input.drafts.length : 0, issues: ["No draft metadata was provided."] };
  }
  const timestamp = now();
  const tools = incoming.map((draft) => {
    const data = toolInput((draft || {}) as Record<string, unknown>);
    const tool: PhantomStoreTool = {
      id: `tool-${randomUUID()}`,
      tenantId,
      developerId: actorId,
      developerName: clean(input.developerName || session.label, 90) || "Developer",
      ...data,
      status: "draft",
      featured: false,
      moderationNote: "",
      installClicks: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    return tool;
  });
  store.tools.unshift(...tools);
  await writeStore(store);
  return {
    tools,
    skipped: Array.isArray(input.drafts) ? Math.max(0, input.drafts.length - tools.length) : 0,
    issues: tools.flatMap((tool) => toolValidation(toolInput(tool as unknown as Record<string, unknown>))).slice(0, 12),
  };
}

export async function updatePhantomStoreTool(session: AccessSession, toolId: string, input: Record<string, unknown>) {
  const actorId = actorIdFor(session);
  const store = await readStore();
  const tool = store.tools.find((item) => item.id === toolId);
  if (!tool || (!session.canManageAccess && tool.developerId !== actorId)) return null;
  if (["approved", "disabled"].includes(tool.status) && !session.canManageAccess) {
    throw new Error("Approved tools require a new update review.");
  }
  const data = toolInput({ ...tool, ...input });
  const submit = input.submit === true;
  const issues = toolValidation(data);
  if (submit && issues.length) throw new Error(issues.join(" "));
  Object.assign(tool, data, { status: submit ? "submitted" : "draft", updatedAt: now(), moderationNote: "" });
  await writeStore(store);
  return { tool, issues };
}

export async function moderatePhantomStoreTool(session: AccessSession, toolId: string, input: Record<string, unknown>) {
  if (!session.canManageAccess && session.isSuperAdmin !== true) throw new Error("Platform moderation access is required.");
  const decision = clean(input.decision, 40);
  if (!["approved", "rejected", "changes_requested", "disabled"].includes(decision)) {
    throw new Error("Choose approve, reject, request changes, or disable.");
  }
  const store = await readStore();
  const tool = store.tools.find((item) => item.id === toolId);
  if (!tool) return null;
  const issues = toolValidation(toolInput(tool as unknown as Record<string, unknown>));
  if (decision === "approved" && issues.length) throw new Error(`Cannot approve: ${issues.join(" ")}`);
  tool.status = decision as PhantomStoreSubmissionStatus;
  tool.featured = decision === "approved" && input.featured === true;
  tool.moderationNote = clean(input.note, 1000);
  tool.updatedAt = now();
  await writeStore(store);
  return tool;
}

export async function recordPhantomStoreInstallClick(_session: AccessSession, toolId: string) {
  const store = await readStore();
  const tool = store.tools.find((item) => item.id === toolId && item.status === "approved");
  if (!tool) return null;
  tool.installClicks += 1;
  await writeStore(store);
  return { installClicks: tool.installClicks };
}

export async function recordPhantomStoreProductBuyClick(_session: AccessSession, productId: string) {
  const store = await readStore();
  const product = SEEDED_PRODUCTS.find((item) => item.id === productId && item.status === "available");
  if (!product) return null;
  store.productClicks = store.productClicks || {};
  store.productClicks[product.id] = Number(store.productClicks[product.id] || 0) + 1;
  await writeStore(store);
  return {
    buyClicks: store.productClicks[product.id],
    product: { ...product, seller: SEEDED_SELLERS.find((seller) => seller.id === product.sellerId) || null },
    checkout: {
      mode: "external",
      url: product.buyUrl,
      note: "Purchase intent recorded. Continue through the seller checkout/support page.",
    },
  };
}

export async function getPhantomStoreStatus() {
  const store = await readStore();
  return {
    provider: "local_json",
    pathConfigured: Boolean(process.env.PHANTOMFORCE_PHANTOMSTORE_PATH),
    tools: store.tools.length,
    approvedTools: store.tools.filter((tool) => tool.status === "approved").length,
    sellers: SEEDED_SELLERS.length,
    products: SEEDED_PRODUCTS.length,
    productBuyClicks: Object.values(store.productClicks || {}).reduce((sum, value) => sum + Number(value || 0), 0),
  };
}
