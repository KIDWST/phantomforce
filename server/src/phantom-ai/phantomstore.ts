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

export type PhantomStoreProductCategory = "Desktop App" | "AI Suite" | "Plugin" | "Automation" | "Creative Tool";
const PRODUCT_CATEGORIES: PhantomStoreProductCategory[] = ["Desktop App", "AI Suite", "Plugin", "Automation", "Creative Tool"];
function safeProductCategory(value: unknown): PhantomStoreProductCategory {
  const v = clean(value, 30);
  return (PRODUCT_CATEGORIES as string[]).includes(v) ? (v as PhantomStoreProductCategory) : "Desktop App";
}

export type PhantomStoreProductStatus = "available" | "quality_hold";
function safeProductStatus(value: unknown): PhantomStoreProductStatus {
  return clean(value, 20) === "quality_hold" ? "quality_hold" : "available";
}

/* Product images stay first-party: either an app-relative asset path that the
   admin shell already serves (e.g. /app/assets/...) or an http(s) URL. Anything
   else is dropped so a stored product can never render a javascript: image. */
function safeImageUrl(value: unknown): string | null {
  const url = clean(value, 700);
  if (!url) return null;
  if (/^\/(?!\/)[\w\-./]+\.(?:png|jpe?g|webp|svg|gif)$/i.test(url)) return url;
  return safeUrl(url) || null;
}

export type PhantomStoreProductVariant = {
  id: string;
  label: string;
  priceUsd: number;
  available: boolean;
};

function safeVariants(value: unknown): PhantomStoreProductVariant[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).flatMap((raw) => {
    const v = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const label = clean(v.label, 90);
    if (!label) return [];
    const priceUsd = Number(v.priceUsd);
    return [{
      id: clean(v.id, 80) || `variant-${randomUUID()}`,
      label,
      priceUsd: Number.isFinite(priceUsd) && priceUsd >= 0 ? Math.round(priceUsd * 100) / 100 : 0,
      available: v.available !== false,
    }];
  });
}

export type PhantomStoreProductInventory = { mode: "unlimited" | "tracked"; stock?: number };

function safeInventory(value: unknown): PhantomStoreProductInventory {
  const v = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  if (clean(v.mode, 20) === "tracked") {
    const stock = Number(v.stock);
    return { mode: "tracked", stock: Number.isFinite(stock) && stock >= 0 ? Math.floor(stock) : 0 };
  }
  return { mode: "unlimited" };
}

export type PhantomStoreProduct = {
  id: string;
  sellerId: string;
  name: string;
  summary: string;
  description: string;
  category: PhantomStoreProductCategory;
  priceLabel: string;
  buyLabel: string;
  buyUrl: string;
  delivery: string;
  version: string;
  status: PhantomStoreProductStatus;
  qualityNote: string;
  tags: string[];
  badges: string[];
  imageUrl: string | null;
  gallery: string[];
  variants: PhantomStoreProductVariant[];
  inventory: PhantomStoreProductInventory;
  rating: number;
  reviewCount: number;
  featured: boolean;
  updatedAt: string;
  reviews: PhantomStoreReview[];
};

type PhantomStoreStore = {
  version: 1;
  tools: PhantomStoreTool[];
  products: PhantomStoreProduct[];
  productClicks: Record<string, number>;
  productVariantClicks: Record<string, Record<string, number>>;
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
    productCount: 5,
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
    priceLabel: "$20 early access",
    buyLabel: "Buy Termina",
    buyUrl: "https://phantomforce.online/phantomstore/termina",
    delivery: "Windows desktop download",
    version: "0.2.0",
    status: "available",
    qualityNote: "Multi-CLI submit reliability is a launch gate and is covered by Termina's dispatch retry tests.",
    tags: ["local ai", "terminal wall", "multi-agent", "privacy"],
    badges: ["Local-first", "Desktop", "Launch-ready QA"],
    /* No real Termina product photography exists in the repo yet; null tells
       the client to render its deterministic branded SVG tile instead of a
       fabricated image. Same rule for the other imageUrl: null products. */
    imageUrl: null,
    gallery: [],
    variants: [{ id: "termina-early-access", label: "Early access license", priceUsd: 20, available: true }],
    inventory: { mode: "unlimited" },
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
    /* The PhantomForce brand mark is a real shipped asset in the admin app. */
    imageUrl: "/app/assets/brand-phantom.png",
    gallery: [],
    /* Plans are chosen inside the workspace's own plan picker, so the listing
       carries no fixed-price variants rather than inventing plan prices here. */
    variants: [],
    inventory: { mode: "unlimited" },
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
    imageUrl: null,
    gallery: [],
    variants: [{ id: "vocal-ai-creator", label: "Creator license", priceUsd: 29, available: true }],
    inventory: { mode: "unlimited" },
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
    summary:
      "A private automation and remote-control bridge for running approved commands, screenshots, and staged Discord updates across your own Windows/Kali machines.",
    description:
      "Phantombot gives you a bearer-token-gated bridge to run approved commands, capture screenshots, manage tmux sessions, and stage Discord updates for manual approval across Windows and Kali. Every network-exposing, sending, or destructive action requires explicit operator approval -- nothing sends, uploads, or exposes automatically. Early access: this ships as source, not an installer, so it currently expects a buyer comfortable running Python and configuring their own bridge token.",
    category: "Automation",
    priceLabel: "$20 early access",
    buyLabel: "Buy Phantombot",
    buyUrl: "https://phantomforce.online/phantomstore/phantombot",
    delivery: "Windows + Kali source bundle (download)",
    version: "1.0.0",
    status: "available",
    qualityNote: "Early access: source-only delivery, requires Python and manual bridge-token setup. No packaged installer yet.",
    tags: ["automation", "remote control", "devops", "bridge"],
    badges: ["Local-first", "Approval-gated", "Early access"],
    imageUrl: null,
    gallery: [],
    variants: [{ id: "phantombot-early-access", label: "Early access source bundle", priceUsd: 20, available: true }],
    inventory: { mode: "unlimited" },
    rating: 0,
    reviewCount: 0,
    featured: false,
    updatedAt: "2026-07-17T00:00:00.000Z",
    reviews: [],
  },
  {
    id: "product-phantomcut-studio",
    sellerId: "seller-phantomforce",
    name: "PhantomCut Studio",
    summary:
      "A local production cockpit that connects your own DaVinci Resolve install to your own Higgsfield account for AI-assisted commercial video generation.",
    description:
      "PhantomCut Studio runs on your machine, drives DaVinci Resolve through its official scripting bridge with explicit apply buttons, and submits Higgsfield jobs through your own locally-authenticated Higgsfield CLI login. Nothing routes through PhantomForce's own accounts or credits -- you bring your own Resolve license and Higgsfield subscription. Source footage is never overwritten, moved, or deleted; Resolve and Higgsfield actions require explicit confirmation before anything runs. Early access: requires Python, your own DaVinci Resolve install, and your own Higgsfield CLI login -- no packaged installer yet.",
    category: "Creative Tool",
    priceLabel: "$20 early access",
    buyLabel: "Buy PhantomCut Studio",
    buyUrl: "https://phantomforce.online/phantomstore/phantomcut-studio",
    delivery: "Local Python cockpit (download, requires your own Resolve + Higgsfield CLI)",
    version: "0.3.0",
    status: "available",
    qualityNote: "Early access: bring your own DaVinci Resolve install and Higgsfield CLI login. No packaged installer yet.",
    tags: ["davinci resolve", "video generation", "higgsfield", "creator tool"],
    badges: ["Local-first", "Bring your own credits", "Early access"],
    imageUrl: null,
    gallery: [],
    variants: [{ id: "phantomcut-early-access", label: "Early access license", priceUsd: 20, available: true }],
    inventory: { mode: "unlimited" },
    rating: 0,
    reviewCount: 0,
    featured: false,
    updatedAt: "2026-07-17T00:00:00.000Z",
    reviews: [],
  },
];

/* Stored products are re-normalized on read so a hand-edited or pre-upgrade
   store file can never surface a product missing the image/variant/inventory
   shape the UI depends on. */
function normalizeStoredProduct(raw: unknown): PhantomStoreProduct | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Partial<PhantomStoreProduct> & Record<string, unknown>;
  if (!clean(p.id, 120) || !clean(p.name, 90)) return null;
  return {
    id: clean(p.id, 120),
    sellerId: clean(p.sellerId, 80) || "seller-phantomforce",
    name: clean(p.name, 90),
    summary: clean(p.summary, 300),
    description: clean(p.description, 4000),
    category: safeProductCategory(p.category),
    priceLabel: clean(p.priceLabel, 60),
    buyLabel: clean(p.buyLabel, 40) || "Buy now",
    buyUrl: safeUrl(p.buyUrl),
    delivery: clean(p.delivery, 120),
    version: clean(p.version, 40) || "1.0.0",
    status: safeProductStatus(p.status),
    qualityNote: clean(p.qualityNote, 500),
    tags: Array.isArray(p.tags) ? p.tags.map((t) => clean(t, 30)).filter(Boolean).slice(0, 8) : [],
    badges: Array.isArray(p.badges) ? p.badges.map((b) => clean(b, 40)).filter(Boolean).slice(0, 6) : [],
    imageUrl: safeImageUrl(p.imageUrl),
    gallery: Array.isArray(p.gallery) ? p.gallery.map(safeImageUrl).filter((g): g is string => Boolean(g)).slice(0, 8) : [],
    variants: safeVariants(p.variants),
    inventory: safeInventory(p.inventory),
    rating: Number.isFinite(Number(p.rating)) ? Number(p.rating) : 0,
    reviewCount: Number.isFinite(Number(p.reviewCount)) ? Number(p.reviewCount) : 0,
    featured: p.featured === true,
    updatedAt: clean(p.updatedAt, 40) || now(),
    reviews: Array.isArray(p.reviews) ? (p.reviews as PhantomStoreReview[]) : [],
  };
}

async function readStore(): Promise<PhantomStoreStore> {
  try {
    const parsed = JSON.parse(await readFile(storePath, "utf8")) as Partial<PhantomStoreStore>;
    return {
      version: 1,
      tools: Array.isArray(parsed.tools) ? parsed.tools : [],
      products: Array.isArray(parsed.products) ? parsed.products.map(normalizeStoredProduct).filter((p): p is PhantomStoreProduct => Boolean(p)) : [],
      productClicks: parsed.productClicks && typeof parsed.productClicks === "object" ? parsed.productClicks : {},
      productVariantClicks: parsed.productVariantClicks && typeof parsed.productVariantClicks === "object" ? parsed.productVariantClicks : {},
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, tools: [], products: [], productClicks: {}, productVariantClicks: {} };
    throw error;
  }
}

/* Products live in the JSON store so admins can edit them; the hardcoded
   SEEDED_PRODUCTS list is only the one-time seed for an empty store. Returns
   true when the caller should persist the seeded store. */
function seedProductsIfEmpty(store: PhantomStoreStore): boolean {
  if (store.products.length) return false;
  store.products = SEEDED_PRODUCTS.map((product) => ({
    ...product,
    tags: [...product.tags],
    badges: [...product.badges],
    gallery: [...product.gallery],
    variants: product.variants.map((variant) => ({ ...variant })),
    inventory: { ...product.inventory },
    reviews: product.reviews.map((review) => ({ ...review })),
  }));
  return true;
}

async function readStoreWithProducts(): Promise<PhantomStoreStore> {
  const store = await readStore();
  if (seedProductsIfEmpty(store)) await writeStore(store);
  return store;
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
  const variantClicks = store.productVariantClicks || {};
  const products = store.products.map((product) => ({
    ...product,
    buyClicks: Number(productClicks[product.id] || 0),
    variantBuyClicks: variantClicks[product.id] || {},
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
  const store = await readStoreWithProducts();
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

/* Admin-only product editing, mirroring the moderation permission gate above:
   the same canManageAccess/isSuperAdmin check and the same "moderation access"
   error message the route layer already maps to a 403. */
function productInput(input: Record<string, unknown>) {
  return {
    name: clean(input.name, 90),
    summary: clean(input.summary, 300),
    description: clean(input.description, 4000),
    category: safeProductCategory(input.category),
    priceLabel: clean(input.priceLabel, 60),
    buyLabel: clean(input.buyLabel, 40) || "Buy now",
    buyUrl: safeUrl(input.buyUrl),
    delivery: clean(input.delivery, 120),
    version: clean(input.version, 40) || "1.0.0",
    status: safeProductStatus(input.status),
    qualityNote: clean(input.qualityNote, 500),
    tags: Array.isArray(input.tags) ? input.tags.map((t) => clean(t, 30)).filter(Boolean).slice(0, 8) : [],
    badges: Array.isArray(input.badges) ? input.badges.map((b) => clean(b, 40)).filter(Boolean).slice(0, 6) : [],
    imageUrl: safeImageUrl(input.imageUrl),
    gallery: Array.isArray(input.gallery) ? input.gallery.map(safeImageUrl).filter((g): g is string => Boolean(g)).slice(0, 8) : [],
    variants: safeVariants(input.variants),
    inventory: safeInventory(input.inventory),
    featured: input.featured === true,
  };
}

export async function upsertPhantomStoreProduct(session: AccessSession, productId: string | null, input: Record<string, unknown>) {
  if (!session.canManageAccess && session.isSuperAdmin !== true) throw new Error("Platform moderation access is required.");
  const store = await readStoreWithProducts();
  if (productId) {
    const product = store.products.find((item) => item.id === productId);
    if (!product) return null;
    const data = productInput({ ...product, ...input });
    if (!data.name) throw new Error("Product name is required.");
    if (!data.summary) throw new Error("Product summary is required.");
    /* Ratings/reviews are proof, not admin-editable fields — no fake reviews. */
    Object.assign(product, data, { updatedAt: now() });
    await writeStore(store);
    return product;
  }
  const data = productInput(input);
  if (!data.name) throw new Error("Product name is required.");
  if (!data.summary) throw new Error("Product summary is required.");
  const product: PhantomStoreProduct = {
    id: `product-${randomUUID()}`,
    sellerId: clean(input.sellerId, 80) || "seller-phantomforce",
    ...data,
    rating: 0,
    reviewCount: 0,
    updatedAt: now(),
    reviews: [],
  };
  store.products.unshift(product);
  await writeStore(store);
  return product;
}

export async function recordPhantomStoreProductBuyClick(_session: AccessSession, productId: string, input: Record<string, unknown> = {}) {
  const store = await readStoreWithProducts();
  const product = store.products.find((item) => item.id === productId && item.status === "available");
  if (!product) return null;
  const inventory = safeInventory(product.inventory);
  if (inventory.mode === "tracked" && Number(inventory.stock || 0) <= 0) {
    throw new Error("This product is out of stock right now.");
  }
  const requestedVariantId = clean(input.variantId, 80);
  let variant: PhantomStoreProductVariant | null = null;
  if (requestedVariantId) {
    variant = (product.variants || []).find((item) => item.id === requestedVariantId) || null;
    if (!variant) throw new Error("That product variant was not found.");
    if (!variant.available) throw new Error("That product variant is not available right now.");
  }
  store.productClicks = store.productClicks || {};
  store.productClicks[product.id] = Number(store.productClicks[product.id] || 0) + 1;
  let variantBuyClicks: number | null = null;
  if (variant) {
    store.productVariantClicks = store.productVariantClicks || {};
    const clicks = (store.productVariantClicks[product.id] = store.productVariantClicks[product.id] || {});
    clicks[variant.id] = Number(clicks[variant.id] || 0) + 1;
    variantBuyClicks = clicks[variant.id];
  }
  await writeStore(store);
  return {
    buyClicks: store.productClicks[product.id],
    variantId: variant?.id || null,
    variantBuyClicks,
    product: { ...product, seller: SEEDED_SELLERS.find((seller) => seller.id === product.sellerId) || null },
    checkout: {
      mode: "external",
      url: product.buyUrl,
      note: variant
        ? `Purchase intent recorded for "${variant.label}". Continue through the seller checkout/support page.`
        : "Purchase intent recorded. Continue through the seller checkout/support page.",
    },
  };
}

export async function getPhantomStoreStatus() {
  const store = await readStore();
  seedProductsIfEmpty(store);
  return {
    provider: "local_json",
    pathConfigured: Boolean(process.env.PHANTOMFORCE_PHANTOMSTORE_PATH),
    tools: store.tools.length,
    approvedTools: store.tools.filter((tool) => tool.status === "approved").length,
    sellers: SEEDED_SELLERS.length,
    products: store.products.length,
    productBuyClicks: Object.values(store.productClicks || {}).reduce((sum, value) => sum + Number(value || 0), 0),
  };
}
