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
    summary: "A CCTV-style terminal wall for launching and supervising multiple AI CLIs on one local machine.",
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
    tags: ["reaper", "vocal chain", "creator tool", "audio"],
    badges: ["Reaper", "Creator", "Prompt-first"],
    rating: 4.5,
    reviewCount: seededReviews.vocal.length,
    featured: false,
    updatedAt: "2026-07-17T00:00:00.000Z",
    reviews: seededReviews.vocal,
  },
];

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
const MAX_SUBMISSIONS_PER_DEVELOPER = 20;

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
