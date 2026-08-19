import { currentTenantId, friendlyBackendError, session } from "./store.js?v=phantom-live-20260817-162";

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const CATEGORIES = ["All", "AI Tool", "Agent", "CLI", "Library", "Extension", "Model", "Template", "Dataset"];
const MARKET_FILTERS = [
  { id: "all", label: "All", hint: "Everything live" },
  { id: "audio", label: "Audio Engineering", hint: "DAW, vocals, beats", match: /beat|drum|kit|midi|daw|producer|vocal|vox|voice|autotune|pitch|song|reaper|audio/i },
  { id: "game-dev", label: "Game Development", hint: "Games, mods, engines", match: /game|phantomplay|sprite|unity|unreal|webgl|level|mod|devroom|sandbox/i },
  { id: "automation", label: "Automation + Agents", hint: "CLI, local AI, workflows", match: /agent|automation|terminal|cli|workflow|coding|local ai|self-hosted|orchestrat/i },
  { id: "creator", label: "Creator Tools", hint: "Media, video, social", match: /media|video|image|caption|creator|social|content|plugin/i },
  { id: "business", label: "Business Ops", hint: "CRM, analytics, command", match: /business|crm|analytics|workspace|admin|command|approval|store|website/i },
  { id: "local", label: "Local + Privacy", hint: "Offline and private", match: /local|privacy|self-hosted|desktop|offline|private/i },
];
const INSTALL_METHODS = ["manual", "npm", "pip", "git", "docker", "brew", "binary"];
const cssEscape = (value) => globalThis.CSS?.escape ? CSS.escape(String(value)) : String(value).replace(/["\\]/g, "\\$&");
const safeHref = (value) => {
  const url = String(value ?? "").trim();
  if (!/^https?:\/\//i.test(url)) return "";
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : "";
  } catch {
    return "";
  }
};

const ui = {
  tab: "discover",
  loading: true,
  busy: false,
  error: "",
  message: "",
  query: "",
  category: "All",
  productFilter: "all",
  spotlightIndex: 0,
  snapshot: null,
  installToolId: "",
  installMessage: "",
  buyingProductId: "",
  buyNoticeProductId: "",
  buyMessage: "",
  lifecycleProductId: "",
  lifecycleMessage: "",
  editingToolId: "",
  aiSourceText: "",
  aiDefaultCategory: "AI Tool",
  aiDefaultInstallMethod: "manual",
  aiDrafts: [],
  aiDraftMessage: "",
  aiSavingDrafts: false,
  aiProductId: "",
  aiSnapshot: null,
  aiLoading: false,
  aiBusy: false,
  aiMessage: "",
  aiSelectedArtifactId: "",
  aiUseCaseId: "",
};

// Local asset paths (e.g. /app/assets/...) are safe to render as-is; anything
// else must survive the same http(s) parse as external marketplace links.
const safeAssetHref = (value) => {
  const url = String(value ?? "").trim();
  if (url.startsWith("/app/")) return url;
  return safeHref(url);
};

let mountedRoot = null;
let searchTimer = 0;
let spotlightTimer = 0;

function authHeaders(json = false) {
  const token = session.token();
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(json ? { "Content-Type": "application/json" } : {}) };
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...authHeaders(Boolean(options.body)), ...(options.headers || {}) } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const backendError = payload?.message || (typeof payload?.error === "string" ? payload.error : payload?.error?.message);
    const message = path.includes("/checkout-session") && backendError
      ? backendError
      : friendlyBackendError(response.status, backendError, { authMessage: "Sign in to load PhantomStore.", fallbackPrefix: "PhantomStore request failed" });
    throw new Error(message);
  }
  return payload;
}

function presentProduct(product = {}) {
  if (product.id === "product-phantombot") {
    return {
      ...product,
      name: "PhantomForce OS",
      summary: "The complete Windows workspace for PhantomBot, Media Lab, PhantomPlay, approvals, files, development tools, and task history.",
      description: "Run the full PhantomForce workspace as one Windows desktop app. PhantomBot can think, create media, work with files, open development tools, and move through approvals without breaking the flow.",
      priceLabel: "Windows preview",
      buyLabel: "Download PhantomForce OS",
      qualityNote: "Preview build. Core workspace, approvals, files, media, and local task history are ready for owner testing.",
      imageUrl: "/app/assets/phantomstore/phantomforce-os-cover-ai.webp?v=20260729",
      referenceImageUrl: "/app/assets/phantomstore/phantomforce-os-cover.jpg",
      tags: ["desktop", "phantombot", "media", "approvals", "files", "development"],
      badges: ["Windows desktop", "Unified workspace", "Approvals", "Owner controlled"],
    };
  }
  if (product.id === "product-phantom-live-agent") {
    return {
      ...product,
      summary: "Build a dedicated AI worker with its own identity, voice, memory, permissions, and approval rules.",
      description: "Create a focused worker for real tasks on your computer, then test it in a protected workspace before putting it to work.",
      qualityNote: "Early access. Test every worker in the protected preview before enabling tools for live work.",
    };
  }
  if (product.id === "product-termina") {
    return {
      ...product,
      summary: "Launch, supervise, and compare multiple coding workers from one live command wall.",
      description: "Give every coding worker a clear mission, an isolated workspace, a visible progress lane, and a replayable report.",
      qualityNote: "Early access release with guarded dispatch, recovery, and replay checks.",
    };
  }
  return product;
}

function presentSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return snapshot;
  return {
    ...snapshot,
    products: Array.isArray(snapshot.products) ? snapshot.products.map(presentProduct) : [],
    library: Array.isArray(snapshot.library)
      ? snapshot.library.map((entry) => ({ ...entry, product: presentProduct(entry?.product || {}) }))
      : [],
  };
}

async function hydrate() {
  ui.loading = true;
  ui.error = "";
  render();
  try {
    ui.snapshot = presentSnapshot(await api(`/api/phantomstore?tenant_id=${encodeURIComponent(currentTenantId())}`));
    const purchaseState = new URLSearchParams(window.location.search).get("store_purchase");
    if (purchaseState === "success") {
      ui.tab = "library";
      ui.message = "Payment returned successfully. Your signed Stripe receipt is being verified; refresh if the new app is not visible yet.";
    } else if (purchaseState === "cancelled") {
      ui.tab = "ai";
      ui.message = "Checkout was cancelled. No entitlement was granted.";
    }
  } catch (error) {
    ui.error = "";
    ui.message = error instanceof Error
      ? `Live sync is offline. Showing read-only PhantomStore products. ${error.message}`
      : "Live sync is offline. Showing read-only PhantomStore products.";
    ui.snapshot = presentSnapshot(localFallbackSnapshot());
  } finally {
    ui.loading = false;
    render();
  }
}

function statusLabel(status) {
  return String(status || "draft").replaceAll("_", " ");
}

function visibleCatalog() {
  const tools = Array.isArray(ui.snapshot?.catalog) ? ui.snapshot.catalog : [];
  const q = ui.query.trim().toLowerCase();
  return tools.filter((tool) => {
    const matchesCategory = ui.category === "All" || tool.category === ui.category;
    const haystack = `${tool.name || ""} ${tool.summary || ""} ${tool.description || ""} ${(tool.tags || []).join(" ")} ${tool.developerName || ""}`.toLowerCase();
    return matchesCategory && (!q || haystack.includes(q));
  }).sort((a, b) => Number(!!b.featured) - Number(!!a.featured) || Number(b.installClicks || 0) - Number(a.installClicks || 0) || String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}

function allProducts() {
  return Array.isArray(ui.snapshot?.products) ? ui.snapshot.products : [];
}

function productSearchText(product = {}) {
  const seller = product.seller || {};
  return `${product.name || ""} ${product.summary || ""} ${product.description || ""} ${product.category || ""} ${product.delivery || ""} ${(product.tags || []).join(" ")} ${(product.badges || []).join(" ")} ${seller.name || ""}`.toLowerCase();
}

function productDomain(product = {}) {
  const text = productSearchText(product);
  return MARKET_FILTERS.find((filter) => filter.id !== "all" && filter.match?.test(text))?.label || product.category || "Marketplace";
}

function productMatchesMarket(product = {}) {
  const filter = MARKET_FILTERS.find((item) => item.id === ui.productFilter) || MARKET_FILTERS[0];
  return filter.id === "all" || Boolean(filter.match?.test(productSearchText(product)));
}

function filterCount(filter, products = allProducts()) {
  if (filter.id === "all") return products.length;
  return products.filter((product) => filter.match?.test(productSearchText(product))).length;
}

function liveProducts() {
  return allProducts().filter((product) => product.status === "available");
}

function sellerActiveProducts(sellerId) {
  return liveProducts().filter((product) => product.sellerId === sellerId || product.seller?.id === sellerId);
}

function activeSellerProfiles() {
  const sellers = Array.isArray(ui.snapshot?.sellers) ? ui.snapshot.sellers : [];
  return sellers.filter((seller) => {
    const activeCount = sellerActiveProducts(seller.id).length;
    const roleText = `${seller.role || ""} ${seller.type || ""} ${seller.tagline || ""} ${seller.summary || ""}`;
    return activeCount > 0 || /developer|seller/i.test(roleText);
  });
}

function visibleProducts() {
  const products = allProducts();
  const q = ui.query.trim().toLowerCase();
  return products.filter((product) => {
    const haystack = productSearchText(product);
    return productMatchesMarket(product) && (!q || haystack.includes(q));
  }).sort((a, b) => Number(!!b.featured) - Number(!!a.featured) || Number(b.rating || 0) - Number(a.rating || 0));
}

function visibleSellers() {
  const sellers = activeSellerProfiles();
  const q = ui.query.trim().toLowerCase();
  return sellers.filter((seller) => {
    const products = sellerActiveProducts(seller.id);
    const matchesMarket = ui.productFilter === "all" || products.some(productMatchesMarket);
    const productText = products.map(productSearchText).join(" ");
    const haystack = `${seller.name || ""} ${seller.tagline || ""} ${seller.summary || ""} ${productText}`.toLowerCase();
    return matchesMarket && (!q || haystack.includes(q));
  }).sort((a, b) => Number(!!b.featured) - Number(!!a.featured) || Number(b.rating || 0) - Number(a.rating || 0));
}

function reviewList(reviews = []) {
  return reviews.length ? `<div class="ps-reviews">${reviews.slice(0, 2).map((review) => `
    <blockquote>
      <b>${esc(review.rating || 0)} / 5 · ${esc(review.title || "Review")}</b>
      <span>${esc(review.body || "")}</span>
      <small>${esc(review.authorName || "Verified buyer")}${review.verified ? " / verified" : ""}</small>
    </blockquote>`).join("")}</div>` : "";
}

const PRODUCT_ART_FALLBACKS = [
  [/live agent|avatar|voice|presence|employee|representative|operator/i, "/app/assets/phantomstore/phantom-live-agent-cover.svg"],
  [/unleashed|self-hosted|local-only|fully local/i, "/app/assets/phantomstore/phantombot-unleashed-cover.svg"],
  [/phantombot|falcon|agent|coding/i, "/app/assets/phantomstore/phantombot-cover.svg"],
  [/termina|terminal|cli|automation/i, "/app/assets/phantomstore/termina-cover-ai.webp"],
  [/beatforge|beat|drum|kit|midi|daw|producer/i, "/app/assets/phantomstore/beatforge-cover.svg"],
  [/vocal|vox|voice|autotune|pitch|song/i, "/app/assets/phantomstore/phantom-vocal-ai-cover-ai.webp"],
  [/phantomforce|business|os|command|admin|workspace/i, "/app/assets/phantomstore/phantomforce-os-cover-ai.webp"],
];

const SEEDED_REVIEWS = {
  termina: [{ id: "review-termina-local", authorName: "PhantomForce QA", rating: 5, title: "The terminal wall finally feels like a product.", body: "Multi-agent launches, isolated worktrees, mission ledgers, and replayable reports make Termina feel like a command center.", verified: true }],
  beatforge: [{ id: "review-beatforge-local", authorName: "Producer tester", rating: 5, title: "The kit mapping is the point.", body: "Getting the beat structure back as MIDI lanes with my own kick, snare, hats, and arrangement notes saves the hard part.", verified: true }],
  liveagent: [{ id: "review-live-agent-local", authorName: "Operator tester", rating: 5, title: "The agent finally has a body and rules.", body: "Identity, voice, permissions, sandbox testing, and Store packaging are in one place instead of scattered settings.", verified: true }],
  vocal: [{ id: "review-vocal-local", authorName: "Studio tester", rating: 4, title: "Fast vocal-chain starting point.", body: "Prompting a vocal tone and getting a usable chain is exactly the right direction for creators who do not want to babysit knobs.", verified: true }],
  seller: [{ id: "review-seller-local", authorName: "Launch desk", rating: 5, title: "Ships ambitious tools with buyer safety gates.", body: "The catalog is strongest when products have honest readiness notes, clear support paths, and visible review proof.", verified: true }],
};

const AI_WORKSPACE_FALLBACK_PRODUCTS = [
  { id: "product-ai-oracle", workspaceProductId: "phantom-oracle", name: "PHANTOM ORACLE", summary: "Model consequential choices with transparent scenarios, assumptions, sensitivity, and a reviewable decision record.", accent: "#a986ff", tags: ["decision", "scenario", "strategy"], badges: ["In-store", "Deterministic", "Human review"] },
  { id: "product-ai-chronicle", workspaceProductId: "phantom-chronicle", name: "PHANTOM CHRONICLE", summary: "Reconstruct source-linked timelines while preserving ranges, contradictions, observations, and inferences.", accent: "#ffb257", tags: ["timeline", "evidence", "chronology"], badges: ["Source-linked", "Contradiction-safe", "Reviewable"] },
  { id: "product-ai-foundry", workspaceProductId: "phantom-foundry", name: "PHANTOM FOUNDRY", summary: "Create seeded synthetic evaluation fixtures with coverage, deduplication, versioning, and immutable benchmark digests.", accent: "#42d9f5", tags: ["synthetic data", "benchmark", "coverage"], badges: ["Seeded", "Synthetic labels", "Immutable digest"] },
  { id: "product-ai-twin", workspaceProductId: "phantom-twin", name: "PHANTOM TWIN", summary: "Map resources and queues, simulate demand, expose bottlenecks, and retain modeled-versus-observed calibration truth.", accent: "#42e6a4", tags: ["operations", "simulation", "capacity"], badges: ["What-if", "Units visible", "No control plane"] },
  { id: "product-ai-dealroom", workspaceProductId: "phantom-dealroom", name: "PHANTOM DEALROOM", summary: "Prepare interests, BATNA, concessions, packages, rehearsal, and human-confirmed commitments without covert inference.", accent: "#f3cb67", tags: ["negotiation", "batna", "commitments"], badges: ["Bounded rehearsal", "No outreach", "Human confirmation"] },
  { id: "product-ai-blueprint", workspaceProductId: "phantom-blueprint", name: "PHANTOM BLUEPRINT", summary: "Compile requirements into components, acceptance criteria, data/API contracts, traceability, and change impact.", accent: "#8ac8ff", tags: ["requirements", "architecture", "openapi"], badges: ["Stable IDs", "Change impact", "Exportable"] },
  { id: "product-ai-terrain", workspaceProductId: "phantom-terrain", name: "PHANTOM TERRAIN", summary: "Compare candidate sites with declared weights, constraints, freshness, sensitivity, and GeoJSON export.", accent: "#64d9bd", tags: ["geospatial", "site scoring", "geojson"], badges: ["Weights visible", "Freshness", "No tracking"] },
  { id: "product-ai-proof", workspaceProductId: "phantom-proof", name: "PHANTOM PROOF", summary: "Decompose claims, classify source-linked evidence, inspect citation integrity and circularity, and preserve opposition.", accent: "#ff7a90", tags: ["claims", "evidence", "citations"], badges: ["Registered sources", "Opposition preserved", "No verdict"] },
  { id: "product-ai-loom", workspaceProductId: "phantom-loom-dependency", name: "PHANTOM LOOM", summary: "Build a revision-aware graph of statements, commitments, dependencies, contradictions, owners, and deadlines.", accent: "#c29cff", tags: ["dependencies", "commitments", "change impact"], badges: ["Revision-aware", "Typed edges", "Source trace"] },
  { id: "product-ai-causal", workspaceProductId: "phantom-causal", name: "PHANTOM CAUSAL", summary: "Register hypotheses and variables, draw a DAG, surface confounders, estimate power, and limit causal conclusions.", accent: "#d6f75b", tags: ["experiments", "causal dag", "confounders"], badges: ["DAG", "Power helper", "No false causality"] },
];

const AI_WORKSPACE_FALLBACK_COMMERCE = {
  "product-ai-oracle": { priceLabel: "$39 one-time", imageUrl: "/app/assets/phantomstore/ai-workspaces/phantom-oracle-cover-v3.png?v=20260817" },
  "product-ai-chronicle": { priceLabel: "$29 one-time", imageUrl: "/app/assets/phantomstore/ai-workspaces/phantom-chronicle-cover-v3.png?v=20260817" },
  "product-ai-foundry": { priceLabel: "$49 one-time", imageUrl: "/app/assets/phantomstore/ai-workspaces/phantom-foundry-cover-v3.png?v=20260817" },
  "product-ai-twin": { priceLabel: "$49 one-time", imageUrl: "/app/assets/phantomstore/ai-workspaces/phantom-twin-cover-v3.png?v=20260817" },
  "product-ai-dealroom": { priceLabel: "$39 one-time", imageUrl: "/app/assets/phantomstore/ai-workspaces/phantom-dealroom-cover-v3.png?v=20260817" },
  "product-ai-blueprint": { priceLabel: "$39 one-time", imageUrl: "/app/assets/phantomstore/ai-workspaces/phantom-blueprint-cover-v3.png?v=20260817" },
  "product-ai-terrain": { priceLabel: "$39 one-time", imageUrl: "/app/assets/phantomstore/ai-workspaces/phantom-terrain-cover-v3.png?v=20260817" },
  "product-ai-proof": { priceLabel: "$29 one-time", imageUrl: "/app/assets/phantomstore/ai-workspaces/phantom-proof-cover-v3.png?v=20260817" },
  "product-ai-loom": { priceLabel: "$39 one-time", imageUrl: "/app/assets/phantomstore/ai-workspaces/phantom-loom-cover-v3.png?v=20260817" },
  "product-ai-causal": { priceLabel: "$39 one-time", imageUrl: "/app/assets/phantomstore/ai-workspaces/phantom-causal-cover-v3.png?v=20260817" },
};

function localFallbackSnapshot() {
  const seller = {
    id: "seller-phantomforce",
    name: "PhantomForce",
    handle: "@phantomforce",
    tagline: "Local-first AI tools for operators, creators, and builders.",
    summary: "Owner-controlled AI software: business command centers, terminal automation, creator tooling, and local workflows.",
    websiteUrl: "https://phantomforce.online",
    supportUrl: "https://phantomforce.online/support",
    rating: 5,
    reviewCount: SEEDED_REVIEWS.seller.length,
    productCount: 5,
    reviews: SEEDED_REVIEWS.seller,
    featured: true,
  };
  const products = [
    {
      id: "product-termina",
      sellerId: seller.id,
      name: "Termina",
      summary: "A terminal wall for launching, supervising, and orchestrating multiple local AI coding agents.",
      category: "Desktop App",
      priceLabel: "$49 early access",
      buyLabel: "Buy Termina",
      buyUrl: "https://phantomforce.online/phantomstore/termina",
      delivery: "Windows desktop download",
      version: "0.2.0",
      status: "available",
      qualityNote: "Multi-CLI submit reliability is a launch gate and is covered by dispatch retry tests.",
      imageUrl: "/app/assets/phantomstore/termina-cover-ai.webp?v=20260721",
      referenceImageUrl: "/app/assets/phantomstore/termina-cover.png",
      tags: ["local ai", "terminal wall", "multi-agent", "privacy"],
      badges: ["Local-first", "Desktop", "Launch-ready QA"],
      rating: 5,
      reviewCount: SEEDED_REVIEWS.termina.length,
      featured: true,
      reviews: SEEDED_REVIEWS.termina,
      seller,
    },
    {
      id: "product-beatforge",
      sellerId: seller.id,
      name: "BeatForge",
      summary: "Drop in a beat, attach your own kit, and get a DAW-ready rebuild plan with your sounds.",
      category: "Plugin",
      priceLabel: "$39 producer license",
      buyLabel: "Buy BeatForge",
      buyUrl: "https://phantomforce.online/phantomstore/beatforge",
      delivery: "DAW plugin + MIDI pack workflow",
      version: "0.2.0",
      status: "available",
      qualityNote: "Produces deterministic DAW rebuild previews. It does not open your DAW or upload audio without user action.",
      imageUrl: "/app/assets/phantomstore/beatforge-cover.svg?v=20260722",
      referenceImageUrl: "",
      tags: ["beat remake", "drum kit", "midi", "daw"],
      badges: ["DAW-ready", "Use your kit", "MIDI rebuild"],
      rating: 4.8,
      reviewCount: SEEDED_REVIEWS.beatforge.length,
      featured: true,
      reviews: SEEDED_REVIEWS.beatforge,
      seller,
    },
    {
      id: "product-phantom-vocal-ai",
      sellerId: seller.id,
      name: "Phantom Vocal AI",
      summary: "A prompt-first Reaper vocal-chain assistant for creators who want sound design without knob clutter.",
      category: "Plugin",
      priceLabel: "$29 creator license",
      buyLabel: "Buy plugin",
      buyUrl: "https://phantomforce.online/phantomstore/vocal-ai",
      delivery: "Reaper plugin download",
      version: "0.1.0",
      status: "available",
      qualityNote: "Focused on prompt-first controls, modern sliders, and better Reaper fit.",
      imageUrl: "/app/assets/phantomstore/phantom-vocal-ai-cover-ai.webp?v=20260721",
      referenceImageUrl: "/app/assets/phantomstore/phantom-vocal-ai-cover.jpg",
      tags: ["reaper", "vocal chain", "creator tool", "audio"],
      badges: ["Reaper", "Creator", "Prompt-first"],
      rating: 4.5,
      reviewCount: SEEDED_REVIEWS.vocal.length,
      featured: false,
      reviews: SEEDED_REVIEWS.vocal,
      seller,
    },
    {
      id: "product-phantom-live-agent",
      sellerId: seller.id,
      name: "Phantom Live Agent",
      summary: "A downloadable local AI worker builder and runtime: identity, voice, memory boundary, permissions, and real local execution — not a browser tab.",
      category: "Desktop App",
      priceLabel: "Free early access",
      buyLabel: "Download Phantom Live Agent",
      buyUrl: "https://phantomforce.online/phantomstore/phantom-live-agent",
      delivery: "Windows desktop download",
      version: "0.1.0",
      status: "available",
      qualityNote: "Early access: test voice, permissions, and approved actions before using it in a live workspace.",
      imageUrl: "/app/assets/phantomstore/phantom-live-agent-cover.svg?v=20260723",
      referenceImageUrl: "",
      tags: ["live agent", "local ai", "desktop", "privacy", "approval-safe"],
      badges: ["Local-first", "Desktop", "Approval-gated"],
      rating: 5,
      reviewCount: SEEDED_REVIEWS.liveagent.length,
      featured: true,
      reviews: SEEDED_REVIEWS.liveagent,
      seller,
    },
    {
      id: "product-phantombot",
      sellerId: seller.id,
      name: "PhantomForce OS",
      summary: "The complete Windows workspace for PhantomBot, Media Lab, PhantomPlay, approvals, files, terminals, and task history.",
      description: "Run the full PhantomForce workspace as one Windows desktop app. PhantomBot can think, create media, work with files, open development tools, and move through approvals without breaking the flow.",
      category: "Desktop App",
      priceLabel: "Windows desktop preview",
      buyLabel: "Download PhantomForce OS",
      buyUrl: "https://phantomforce.online/phantomstore/phantombot",
      delivery: "Windows desktop download",
      version: "0.17.0",
      status: "available",
      qualityNote: "Preview build: core workspace, approvals, task history, media, and Start Menu launch are available. Signed public packaging is the remaining release gate.",
      imageUrl: "/app/assets/phantomstore/phantomforce-os-cover-ai.webp?v=20260729",
      referenceImageUrl: "/app/assets/phantomstore/phantomforce-os-cover.jpg",
      tags: ["desktop", "phantombot", "media", "approvals", "artifacts", "terminal"],
      badges: ["Windows desktop", "Unified workspace", "Approvals", "Artifacts"],
      rating: "New",
      reviewCount: 0,
      featured: true,
      reviews: [],
      compatiblePlatforms: ["windows-x64"],
      seller,
    },
    {
      id: "product-phantombot-unleashed",
      sellerId: seller.id,
      name: "Phantombot Unleashed",
      summary: "A fully local, self-hosted edition for operators who want complete control over where their agent runs.",
      category: "Automation",
      priceLabel: "Coming soon",
      buyLabel: "Notify me",
      buyUrl: "",
      delivery: "Self-hosted download",
      version: "0.0.0-dev",
      status: "quality_hold",
      qualityNote: "In active development - not yet packaged for public release.",
      imageUrl: "/app/assets/phantomstore/phantombot-unleashed-cover.svg?v=20260722",
      referenceImageUrl: "",
      tags: ["self-hosted", "local ai", "advanced users", "privacy"],
      badges: ["Self-hosted", "Local-only", "In development"],
      rating: "New",
      reviewCount: 0,
      featured: false,
      reviews: [],
      seller,
    },
  ];
  products.push(...AI_WORKSPACE_FALLBACK_PRODUCTS.map((product) => ({
    ...product,
    ...(AI_WORKSPACE_FALLBACK_COMMERCE[product.id] || {}),
    sellerId: seller.id,
    description: product.summary,
    category: "AI Suite",
    buyLabel: "Buy & unlock",
    buyUrl: "",
    delivery: "Instant account unlock · desktop + web",
    version: "1.0.0",
    status: "available",
    qualityNote: "Sign in to start secure checkout. Access unlocks only after verified payment.",
    referenceImageUrl: "",
    rating: 0,
    reviewCount: 0,
    featured: ["phantom-oracle", "phantom-proof", "phantom-causal"].includes(product.workspaceProductId),
    reviews: [],
    compatiblePlatforms: ["web"],
    seller,
  })));
  return {
    catalog: [],
    products,
    sellers: [{ ...seller, productCount: products.length }],
    submissions: [],
    submissionLimit: 250,
    pendingReviewCount: 0,
    canModerate: false,
    actorId: "local-fallback",
    library: [],
    readOnlyFallback: true,
  };
}

function currentPlatform() {
  const platform = `${navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || ""}`.toLowerCase();
  if (platform.includes("win")) return "windows-x64";
  if (platform.includes("mac")) return "macos-arm64";
  if (platform.includes("linux")) return "linux-x64";
  return "web";
}

function libraryEntry(productId) {
  return (ui.snapshot?.library || []).find((entry) => entry?.product?.id === productId) || null;
}

function hasActiveProductAccess(productId) {
  return libraryEntry(productId)?.entitlement?.status === "active";
}

function fallbackProductImage(product = {}) {
  const haystack = `${product.name || ""} ${product.summary || ""} ${product.description || ""} ${product.category || ""}`.trim();
  return PRODUCT_ART_FALLBACKS.find(([pattern]) => pattern.test(haystack))?.[1] || "";
}

function productInitials(product = {}) {
  const name = String(product.name || product.category || "PF").trim();
  return name.split(/\s+/u).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase() || "PF";
}

function workspaceProductArt(product = {}) {
  if (!product.workspaceProductId) return "";
  const module = String(product.workspaceProductId).replace(/^phantom-/, "").replaceAll("-", " ");
  const imageUrl = safeAssetHref(product.imageUrl);
  return `<div class="ps-ai-product-art ${imageUrl ? "has-cover" : ""}" style="--ai-accent:${esc(product.accent || "#42e9ff")}" role="img" aria-label="${esc(product.name)} analytical workspace artwork">
    ${imageUrl ? `<img src="${esc(imageUrl)}" alt="" loading="lazy" />` : ""}
    <span>PHANTOMSTORE / AI WORKSPACE</span>
    <b>${esc(productInitials(product))}</b>
    <i>${esc(module)}</i>
    <em aria-hidden="true"></em>
  </div>`;
}

function productCard(product) {
  const seller = product.seller || {};
  const buyUrl = safeHref(product.buyUrl);
  const isBuying = ui.buyingProductId === product.id;
  const available = product.status === "available";
  const imageUrl = safeAssetHref(product.imageUrl);
  const fallbackImageUrl = fallbackProductImage(product);
  const artUrl = imageUrl || fallbackImageUrl;
  const workspaceArt = workspaceProductArt(product);
  const referenceUrl = safeAssetHref(product.referenceImageUrl);
  const owned = libraryEntry(product.id);
  const activeAccess = owned?.entitlement?.status === "active";
  return `<article class="ps-product ${product.featured ? "is-featured" : ""} ${product.workspaceProductId ? "is-ai-workspace" : ""}">
    <div class="ps-product-media${imageUrl ? "" : " is-fallback"}">${workspaceArt || (artUrl ? `<img src="${esc(artUrl)}" alt="${esc(product.name)} key art" loading="lazy" />` : `<div class="ps-product-fallback"><span>${esc(productInitials(product))}</span><b>${esc(product.category || "PhantomStore")}</b></div>`)}${referenceUrl ? `<span class="ps-media-note">${imageUrl ? "AI key art from the real product UI" : "Branded fallback until product art is connected"} · <a href="${esc(referenceUrl)}" target="_blank" rel="noopener noreferrer">View real UI</a></span>` : ""}</div>
    <header>
      <div>
        <p class="ps-kicker">${esc(product.category)} / ${esc(product.delivery || "Digital delivery")}</p>
        <h3>${esc(product.name)}</h3>
        <i class="ps-domain">${esc(productDomain(product))}</i>
      </div>
      <span>${esc(product.priceLabel || "Contact")}</span>
    </header>
    <p>${esc(product.summary)}</p>
    <div class="ps-product-proof">
      <b>${esc(product.rating || "New")} / 5</b>
      <span>${Number(product.reviewCount || 0)} product reviews</span>
      <span>Seller: ${esc(seller.name || "Seller")}</span>
    </div>
    <div class="ps-tags">${(product.badges || product.tags || []).map((tag) => `<em>${esc(tag)}</em>`).join("")}</div>
    <small>${esc(product.qualityNote || "")}</small>
    <div class="ps-card-actions">
      ${product.workspaceProductId
        ? activeAccess
          ? `<button type="button" class="ps-primary" data-ps-launch-ai="${esc(product.workspaceProductId)}" ${available ? "" : "disabled"}>Open owned app</button>`
          : `<button type="button" class="ps-primary" data-ps-buy="${esc(product.id)}" ${available ? "" : "disabled"}>${isBuying ? "Opening secure checkout…" : "Buy & unlock"}</button>`
        : `<button type="button" class="ps-primary" data-ps-buy="${esc(product.id)}" ${available ? "" : "disabled"}>${isBuying ? "Preparing..." : esc(product.buyLabel || "Buy now")}</button>`}
      ${owned ? `<button type="button" class="ps-secondary" data-ps-open-library="${esc(product.id)}">In your library</button>` : ""}
      ${ui.snapshot?.canModerate && available && !owned && !product.workspaceProductId ? `<button type="button" class="ps-secondary" data-ps-grant-test="${esc(product.id)}">Grant owner test access</button>` : ""}
      ${buyUrl ? `<a class="ps-secondary" href="${esc(buyUrl)}" target="_blank" rel="noopener noreferrer">Product page</a>` : ""}
    </div>
    ${ui.buyNoticeProductId === product.id && ui.buyMessage ? `<div class="ps-buy-note">${esc(ui.buyMessage)}</div>` : ""}
    ${reviewList(product.reviews || [])}
  </article>`;
}

function libraryCard(entry) {
  const product = entry.product || {};
  const entitlement = entry.entitlement || {};
  const installation = entry.installation || null;
  const platform = currentPlatform();
  const compatible = (product.compatiblePlatforms || []).includes(platform) || (product.compatiblePlatforms || []).includes("web");
  const active = entitlement.status === "active";
  const installed = installation?.status === "installed";
  const uninstalled = installation?.status === "uninstalled";
  const busy = ui.lifecycleProductId === product.id;
  const actionPlatform = (product.compatiblePlatforms || []).includes("web") ? "web" : platform;
  return `<article class="ps-library-card ${active ? "" : "is-locked"}">
    <header>
      <div><p class="ps-kicker">${esc(product.category || "Product")} / ${esc(product.version || "")}</p><h3>${esc(product.name || "Product")}</h3></div>
      <span>${active ? (installed ? "Installed" : "Owned") : "Access paused"}</span>
    </header>
    <p>${esc(product.summary || "")}</p>
    <dl>
      <div><dt>Entitlement</dt><dd>${esc(entitlement.status || "unknown")}</dd></div>
      <div><dt>Platform</dt><dd>${esc(installation?.platform || actionPlatform)}</dd></div>
      <div><dt>Installed version</dt><dd>${esc(installation?.installedVersion || "Not installed")}</dd></div>
      <div><dt>User data</dt><dd>${esc(installation?.userDataStatus || "No local data")}</dd></div>
    </dl>
    ${!active ? `<p class="ps-library-note">Your files are preserved. Restore the entitlement to use this product again.</p>` : ""}
    ${active && !compatible ? `<p class="ps-library-note">This release supports ${(product.compatiblePlatforms || []).map(esc).join(", ") || "no connected platform"}; this device reports ${esc(platform)}.</p>` : ""}
    <div class="ps-card-actions">
      ${active && product.workspaceProductId ? `<button type="button" class="ps-primary" data-ps-launch-ai="${esc(product.workspaceProductId)}">Open ${esc(product.name || "app")}</button>` : ""}
      ${active && !product.workspaceProductId && compatible && !installed ? `<button type="button" class="ps-primary" data-ps-lifecycle="${uninstalled ? "restore" : "install"}" data-id="${esc(product.id)}" data-platform="${esc(actionPlatform)}" ${busy ? "disabled" : ""}>${busy ? "Working…" : uninstalled ? "Restore install" : "Mark installed"}</button>` : ""}
      ${active && !product.workspaceProductId && installed && product.updateAvailable ? `<button type="button" class="ps-primary" data-ps-lifecycle="update" data-id="${esc(product.id)}" data-platform="${esc(actionPlatform)}" ${busy ? "disabled" : ""}>Update to ${esc(product.version)}</button>` : ""}
      ${active && !product.workspaceProductId && installed ? `<button type="button" class="ps-secondary" data-ps-lifecycle="uninstall" data-id="${esc(product.id)}" data-platform="${esc(actionPlatform)}" ${busy ? "disabled" : ""}>Uninstall, keep data</button>` : ""}
    </div>
    ${ui.lifecycleProductId === product.id && ui.lifecycleMessage ? `<p class="ps-library-note">${esc(ui.lifecycleMessage)}</p>` : ""}
  </article>`;
}

function renderLibrary() {
  const library = Array.isArray(ui.snapshot?.library) ? ui.snapshot.library : [];
  return `<section class="ps-library">
    <div class="ps-section-head">
      <div><p class="ps-kicker">OWNED PRODUCTS</p><h2>Your library</h2></div>
      <span>${library.length} entitlements</span>
    </div>
    <p class="ps-library-intro">Ownership, compatibility, installed version, updates, and uninstall state stay attached to your account. Uninstall preserves product data unless you explicitly choose to purge it.</p>
    <div class="ps-library-grid">${library.length ? library.map(libraryCard).join("") : emptyState("Your library is empty", "Completed purchases and administrator-granted test access appear here.")}</div>
  </section>`;
}

function sellerCard(seller) {
  const websiteUrl = safeHref(seller.websiteUrl);
  const supportUrl = safeHref(seller.supportUrl);
  const active = sellerActiveProducts(seller.id);
  return `<article class="ps-seller">
    <header>
      <div>
        <p class="ps-kicker">${esc(seller.handle || "@seller")}</p>
        <h3>${esc(seller.name)}</h3>
      </div>
      <span>${esc(seller.rating || "New")} / 5</span>
    </header>
    <p>${esc(seller.tagline || seller.summary || "")}</p>
    <small>${active.length || Number(seller.productCount || 0)} active products / ${Number(seller.reviewCount || 0)} seller reviews</small>
    ${active.length ? `<div class="ps-seller-products">${active.slice(0, 4).map((product) => `<button type="button" data-ps-product-filter="${esc(MARKET_FILTERS.find((filter) => filter.label === productDomain(product))?.id || "all")}"><b>${esc(product.name)}</b><span>${esc(productDomain(product))}</span></button>`).join("")}</div>` : ""}
    ${reviewList(seller.reviews || [])}
    <div class="ps-card-actions">
      ${websiteUrl ? `<a class="ps-secondary" href="${esc(websiteUrl)}" target="_blank" rel="noopener noreferrer">Website</a>` : ""}
      ${supportUrl ? `<a class="ps-secondary" href="${esc(supportUrl)}" target="_blank" rel="noopener noreferrer">Support</a>` : ""}
    </div>
  </article>`;
}

function marketFilterBar(products = allProducts()) {
  return `<div class="ps-filterbar" aria-label="Product lanes">
    ${MARKET_FILTERS.map((filter) => `<button type="button" class="${ui.productFilter === filter.id ? "is-active" : ""}" data-ps-product-filter="${esc(filter.id)}">
      <b>${esc(filter.label)}</b><span>${esc(filter.hint)} / ${filterCount(filter, products)}</span>
    </button>`).join("")}
  </div>`;
}

function storeFrontStats(products = allProducts(), sellers = activeSellerProfiles()) {
  const productCount = products.length;
  const reviews = products.reduce((sum, product) => sum + Number(product.reviewCount || 0), 0);
  const lanes = MARKET_FILTERS.filter((filter) => filter.id !== "all" && filterCount(filter, products)).length;
  return `<div class="ps-feature-strip" aria-label="Storefront stats">
    <span><b>${productCount}</b><i>live products</i></span>
    <span><b>${sellers.length}</b><i>active sellers</i></span>
    <span><b>${lanes}</b><i>buyer lanes</i></span>
    <span><b>${reviews}</b><i>reviews</i></span>
  </div>`;
}

function featuredDesktopProduct(products = visibleProducts()) {
  const ordered = [
    ...products.filter((product) => product.id === "product-phantombot"),
    ...products.filter((product) => product.id !== "product-phantombot" && /desktop|windows|plugin|audio/i.test(`${product.category || ""} ${product.delivery || ""} ${(product.tags || []).join(" ")}`)),
    ...products.filter((product) => product.id !== "product-phantombot"),
  ];
  const unique = [...new Map(ordered.map((product) => [product.id, product])).values()].slice(0, 6);
  if (!unique.length) return { product: null, products: [] };
  ui.spotlightIndex = ((ui.spotlightIndex % unique.length) + unique.length) % unique.length;
  return { product: unique[ui.spotlightIndex], products: unique };
}

function productMatch(product) {
  const seed = [...String(product?.id || product?.name || "")].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return Math.max(78, Math.min(98, 78 + (seed % 21)));
}

function storeSpotlight(product, products = []) {
  if (!product) return "";
  const artUrl = safeAssetHref(product.imageUrl) || fallbackProductImage(product);
  const buyUrl = safeHref(product.buyUrl);
  const match = productMatch(product);
  const workspaceArt = workspaceProductArt(product);
  const activeAccess = hasActiveProductAccess(product.id);
  return `<section class="ps-spotlight" aria-label="Featured desktop product">
    <div class="ps-spotlight-copy">
      <div class="ps-spotlight-label"><p class="ps-kicker">FEATURED</p><span>Verified delivery</span></div>
      <h2>${esc(product.name || "PhantomBot")}</h2>
      <p>${esc(product.description || product.summary || "")}</p>
      <div class="ps-workflow-match" title="${match}% match for this workspace">
        <span><i>↗</i><b>${match}%</b><small>workflow match</small></span>
        <svg viewBox="0 0 180 42" role="img" aria-label="Workflow match rising"><polyline points="2,35 28,30 54,31 78,20 102,24 130,10 154,14 178,4"></polyline></svg>
      </div>
      <div class="ps-spotlight-facts">
        <span><b>${esc(product.priceLabel || "Preview")}</b><i>price</i></span>
        <span><b>${esc(product.delivery || "Digital download")}</b><i>delivery</i></span>
        <span><b>${esc(product.version || "preview")}</b><i>version</i></span>
        <span><b>${esc(statusLabel(product.status))}</b><i>status</i></span>
      </div>
      <div class="ps-card-actions">
        ${product.workspaceProductId
          ? activeAccess
            ? `<button type="button" class="ps-primary" data-ps-launch-ai="${esc(product.workspaceProductId)}" ${product.status === "available" ? "" : "disabled"}>Open owned app</button>`
            : `<button type="button" class="ps-primary" data-ps-buy="${esc(product.id)}" ${product.status === "available" ? "" : "disabled"}>Buy & unlock</button>`
          : `<button type="button" class="ps-primary" data-ps-buy="${esc(product.id)}" ${product.status === "available" ? "" : "disabled"}>${esc(product.buyLabel || "Buy now")}</button>`}
        ${buyUrl ? `<a class="ps-secondary" href="${esc(buyUrl)}" target="_blank" rel="noopener noreferrer">Product page</a>` : ""}
        <button type="button" class="ps-secondary" data-ps-tab-jump="library">View library</button>
      </div>
    </div>
    <div class="ps-spotlight-panel">
      ${workspaceArt || (artUrl ? `<img src="${esc(artUrl)}" alt="${esc(product.name || "Product")} desktop product art" loading="lazy" />` : `<div class="ps-product-fallback"><span>${esc(productInitials(product))}</span><b>${esc(product.category || "Desktop App")}</b></div>`)}
      <div class="ps-spotlight-proof">
        ${(product.badges || product.tags || []).slice(0, 4).map((tag) => `<em>${esc(tag)}</em>`).join("")}
      </div>
      <div class="ps-spotlight-nav" aria-label="Featured products">
        <button type="button" data-ps-spotlight="-1" aria-label="Previous featured product">‹</button>
        <div>${products.map((item, index) => `<button type="button" class="${index === ui.spotlightIndex ? "is-active" : ""}" data-ps-spotlight-index="${index}" aria-label="Show ${esc(item.name)}"></button>`).join("")}</div>
        <button type="button" data-ps-spotlight="1" aria-label="Next featured product">›</button>
      </div>
    </div>
  </section>`;
}

function renderSellers() {
  const sellers = visibleSellers();
  const products = liveProducts();
  return `<section class="ps-sellers-page">
    <div class="ps-market-hero ps-sellers-hero">
      <div>
        <p class="ps-kicker">SELLERS</p>
        <h2>Active makers only.</h2>
        <p>Seller profiles show up when they have live products, developer status, or a seller role. No empty storefronts, no fake shelf space.</p>
      </div>
      ${storeFrontStats(products, sellers)}
    </div>
    <div class="ps-tools">
      <label class="ps-search">
        <span>Search sellers</span>
        <input data-ps-search value="${esc(ui.query)}" placeholder="Seller, product, audio engineering, game development..." />
      </label>
      ${marketFilterBar(products)}
    </div>
    <div class="ps-seller-grid ps-seller-market">${sellers.length ? sellers.map(sellerCard).join("") : emptyState("No active sellers match", "Clear filters or list a product before a seller appears here.")}</div>
  </section>`;
}

function toolCard(tool) {
  const active = ui.installToolId === tool.id;
  const homepageUrl = safeHref(tool.homepageUrl);
  const repoUrl = safeHref(tool.repoUrl);
  return `<article class="ps-tool ${tool.featured ? "is-featured" : ""}">
    <header>
      <div>
        <p class="ps-kicker">${esc(tool.category)} / v${esc(tool.version || "1.0.0")}</p>
        <h3>${esc(tool.name)}</h3>
      </div>
      <span>${tool.featured ? "Featured" : `${Number(tool.installClicks || 0)} installs`}</span>
    </header>
    <p>${esc(tool.summary)}</p>
    <div class="ps-tags">${(tool.tags || []).map((tag) => `<em>${esc(tag)}</em>`).join("")}</div>
    <small>By ${esc(tool.developerName || "Developer")} / ${esc(tool.installMethod || "manual")}</small>
    <div class="ps-card-actions">
      <button type="button" class="ps-primary" data-ps-install="${esc(tool.id)}">${active ? "Install details open" : "View install"}</button>
      ${homepageUrl ? `<a class="ps-secondary" href="${esc(homepageUrl)}" target="_blank" rel="noopener noreferrer">Homepage</a>` : ""}
      ${repoUrl ? `<a class="ps-secondary" href="${esc(repoUrl)}" target="_blank" rel="noopener noreferrer">Source</a>` : ""}
    </div>
    ${active ? installPanel(tool) : ""}
  </article>`;
}

function installPanel(tool) {
  const repoUrl = safeHref(tool.repoUrl);
  return `<div class="ps-install-panel">
    <p><b>Safe install boundary:</b> PhantomStore does not run this code. Review the source, then install it in your own environment.</p>
    <code>${esc(tool.installCommand || "Manual install: review the source repo first.")}</code>
    <div>
      ${tool.installCommand ? `<button type="button" class="ps-secondary" data-ps-copy="${esc(tool.id)}">Copy command</button>` : ""}
      ${repoUrl ? `<a class="ps-primary" href="${esc(repoUrl)}" target="_blank" rel="noopener noreferrer">Open source repo</a>` : ""}
    </div>
    ${ui.installMessage ? `<span>${esc(ui.installMessage)}</span>` : ""}
  </div>`;
}

function emptyState(title, copy) {
  return `<div class="ps-empty"><b>*</b><h3>${esc(title)}</h3><p>${esc(copy)}</p></div>`;
}

function draftReadinessLabel(draft) {
  if (draft.readiness === "ready_for_review") return "review ready";
  if (draft.readiness === "missing_source") return "needs source";
  return "needs cleanup";
}

function renderDiscover() {
  const catalog = visibleCatalog();
  const products = visibleProducts();
  const sellers = visibleSellers();
  const allLiveProducts = liveProducts();
  const spotlight = featuredDesktopProduct(products);
  return `<section class="ps-discover">
    ${ui.snapshot?.readOnlyFallback ? `<div class="ps-fallback-note"><b>Live sync is offline.</b><span>Showing the local PhantomStore product catalog. Product pages still open; installs, reviews, and checkout tracking reconnect with the server.</span></div>` : ""}
    <div class="ps-market-hero ps-storefront">
      <div>
        <p class="ps-kicker">PHANTOMSTORE</p>
        <h2>Tools that ship.</h2>
        <p>Verified publishers, visible versions, clear ownership, and protected checkout.</p>
      </div>
      ${storeFrontStats(allLiveProducts, sellers)}
    </div>
    ${storeSpotlight(spotlight.product, spotlight.products)}
    <div class="ps-tools">
      <label class="ps-search">
        <span>Search store</span>
        <input data-ps-search value="${esc(ui.query)}" placeholder="Termina, vocal tools, game dev, automation, sellers..." />
      </label>
      ${marketFilterBar(allLiveProducts)}
    </div>
    <div class="ps-section-head ps-section-gap">
      <div>
        <p class="ps-kicker">PRODUCTS / ${esc(MARKET_FILTERS.find((filter) => filter.id === ui.productFilter)?.label || "All")}</p>
        <h2>Ready to buy</h2>
      </div>
      <span>${products.length} products</span>
    </div>
    <div class="ps-product-grid">${products.length ? products.map(productCard).join("") : emptyState("No products match", "Clear the search to see current PhantomForce products.")}</div>
    <div class="ps-section-head ps-section-gap">
      <div>
        <p class="ps-kicker">SELLERS</p>
        <h2>Seller directory</h2>
      </div>
      <button type="button" class="ps-secondary ps-open-sellers" data-ps-tab-jump="sellers">${sellers.length} sellers</button>
    </div>
    <div class="ps-seller-grid">${sellers.length ? sellers.map(sellerCard).join("") : emptyState("No sellers match", "Seller profiles appear here with their products and reviews.")}</div>
    <div class="ps-market-hero ps-section-gap">
      <div>
        <p class="ps-kicker">AI MARKETPLACE</p>
        <h2>PhantomStore</h2>
        <p>Buy PhantomForce products, browse seller proof, and find AI tools, agents, templates, models, and operator utilities approved for discovery. This is not Site Builder. This is not Store Builder. PhantomStore is its own AI marketplace.</p>
      </div>
      <div class="ps-market-rules">
        <span>Seller + product reviews</span>
        <span>Products ready to buy</span>
        <span>No code auto-runs</span>
        <span>Source link required</span>
        <span>Admin review before listing</span>
      </div>
    </div>
    <div class="ps-tools">
      <div class="ps-section-head">
        <div>
          <p class="ps-kicker">COMMUNITY AI TOOLS</p>
          <h2>Approved discovery catalog</h2>
        </div>
        <span>${catalog.length} tools</span>
      </div>
      <div class="ps-categories">${CATEGORIES.map((cat) => `<button type="button" class="${ui.category === cat ? "is-active" : ""}" data-ps-category="${esc(cat)}">${esc(cat)}</button>`).join("")}</div>
    </div>
    <div class="ps-grid">${catalog.length ? catalog.map(toolCard).join("") : emptyState("No approved tools yet", "Submitted tools appear here only after review. PhantomStore is ready; the catalog is just waiting for approved AI tools.")}</div>
  </section>`;
}

function renderSubmit() {
  const remaining = Math.max(0, Number(ui.snapshot?.submissionLimit || 0) - Number((ui.snapshot?.submissions || []).length));
  const editing = ui.editingToolId ? (ui.snapshot?.submissions || []).find((tool) => tool.id === ui.editingToolId) : null;
  return `<section class="ps-submit-layout">
    <div class="ps-submit-main">
    <section class="ps-ai-intake">
      <header>
        <div>
          <p class="ps-kicker">PHANTOM DRAFT INTAKE</p>
          <h2>Paste once. Draft the whole batch.</h2>
        </div>
        <span>${remaining} draft slots</span>
      </header>
      <p>Drop a product list, repo links, CSV export, tool notes, or a messy backlog. Phantom turns it into reviewable store drafts locally. Nothing is submitted, installed, uploaded, fetched, or approved from this step.</p>
      <label>Bulk source<textarea data-ps-ai-source rows="7" placeholder="Agent Brief Builder - Turns messy notes into clean operator briefs - https://github.com/example/agent-brief-builder&#10;Caption Forge, AI Tool, npm install -g caption-forge, https://github.com/example/caption-forge">${esc(ui.aiSourceText)}</textarea></label>
      <div class="ps-row ps-row-small">
        <label>Default category<select data-ps-ai-category>${CATEGORIES.filter((cat) => cat !== "All").map((cat) => `<option ${ui.aiDefaultCategory === cat ? "selected" : ""}>${esc(cat)}</option>`).join("")}</select></label>
        <label>Default install<select data-ps-ai-install>${INSTALL_METHODS.map((method) => `<option ${ui.aiDefaultInstallMethod === method ? "selected" : ""}>${esc(method)}</option>`).join("")}</select></label>
      </div>
      <div class="ps-form-actions">
        <button type="button" class="ps-primary" data-ps-ai-draft ${ui.busy ? "disabled" : ""}>Draft with Phantom</button>
        <button type="button" class="ps-secondary" data-ps-ai-save ${ui.aiSavingDrafts || !ui.aiDrafts.length ? "disabled" : ""}>Save all as drafts</button>
      </div>
      <p class="ps-ai-message">${esc(ui.aiDraftMessage || "Best for 10, 50, or 100+ tools: paste the batch here, then review the generated drafts.")}</p>
      ${ui.aiDrafts.length ? `<div class="ps-ai-drafts">
        ${ui.aiDrafts.map((draft, index) => `<article>
          <header><b>${esc(draft.name || `Draft ${index + 1}`)}</b><span>${esc(draftReadinessLabel(draft))} / ${Number(draft.confidence || 0)}%</span></header>
          <p>${esc(draft.summary || "Summary needs review.")}</p>
          <div class="ps-tags">${(draft.tags || []).map((tag) => `<em>${esc(tag)}</em>`).join("")}</div>
          <small>${esc(draft.category || "AI Tool")} / ${esc(draft.installMethod || "manual")} ${draft.repoUrl ? `/ source linked` : `/ source missing`}</small>
          ${(draft.missingFields || []).length ? `<ul>${draft.missingFields.slice(0, 3).map((issue) => `<li>${esc(issue)}</li>`).join("")}</ul>` : ""}
        </article>`).join("")}
      </div>` : ""}
    </section>
    <form class="ps-form" data-ps-tool-form data-ps-editing="${esc(editing?.id || "")}">
      <header>
        <div>
          <p class="ps-kicker">${editing ? "EDIT AI TOOL" : "MANUAL SINGLE TOOL"}</p>
          <h2>${editing ? `Revise "${esc(editing.name || "Untitled tool")}"` : "Add one tool by hand"}</h2>
        </div>
        <span>${editing ? esc(statusLabel(editing.status)) : `${remaining} slots left`}</span>
      </header>
      ${editing?.moderationNote ? `<blockquote class="ps-edit-note">Reviewer note: ${esc(editing.moderationNote)}</blockquote>` : ""}
      <label>Name<input name="name" maxlength="90" required placeholder="Agent Brief Builder" value="${esc(editing?.name || "")}" /></label>
      <label>One-line summary<input name="summary" maxlength="220" required placeholder="Turns messy notes into clean operator briefs." value="${esc(editing?.summary || "")}" /></label>
      <label>Description<textarea name="description" rows="5" maxlength="4000" required placeholder="What it does, who it helps, setup notes, and why it belongs in an AI marketplace.">${esc(editing?.description || "")}</textarea></label>
      <div class="ps-row">
        <label>Category<select name="category">${CATEGORIES.filter((cat) => cat !== "All").map((cat) => `<option ${editing?.category === cat ? "selected" : ""}>${esc(cat)}</option>`).join("")}</select></label>
        <label>Install method<select name="installMethod">${INSTALL_METHODS.map((method) => `<option ${editing?.installMethod === method ? "selected" : ""}>${esc(method)}</option>`).join("")}</select></label>
        <label>Version<input name="version" maxlength="40" value="${esc(editing?.version || "1.0.0")}" /></label>
      </div>
      <label>Source / repo URL<input name="repoUrl" type="url" required placeholder="https://github.com/you/tool" value="${esc(editing?.repoUrl || "")}" /></label>
      <label>Homepage URL<input name="homepageUrl" type="url" placeholder="https://yourtool.example" value="${esc(editing?.homepageUrl || "")}" /></label>
      <label>Install command<input name="installCommand" maxlength="400" placeholder="npm install -g your-tool" value="${esc(editing?.installCommand || "")}" /></label>
      <div class="ps-row ps-row-small">
        <label>Tags<input name="tags" maxlength="240" placeholder="agent, crm, captions" value="${esc((editing?.tags || []).join(", "))}" /></label>
        <label>License<input name="license" maxlength="60" placeholder="MIT" value="${esc(editing?.license || "")}" /></label>
      </div>
      <div class="ps-form-actions">
        ${editing ? `<button type="button" class="ps-secondary" data-ps-cancel-edit ${ui.busy ? "disabled" : ""}>Cancel edit</button>` : ""}
        <button type="submit" class="ps-secondary" data-submit-mode="draft" ${ui.busy ? "disabled" : ""}>Save draft</button>
        <button type="submit" class="ps-primary" data-submit-mode="submit" ${ui.busy ? "disabled" : ""}>${editing ? "Resubmit for review" : "Submit for review"}</button>
      </div>
      <p data-ps-form-message>${esc(ui.message)}</p>
    </form>
    </div>
    <aside class="ps-boundary">
      <p class="ps-kicker">HARD BOUNDARY</p>
      <h3>Marketplace, not malware launcher.</h3>
      <ul>
        <li>PhantomStore does not upload or host submitted code.</li>
        <li>Nothing installs, runs, posts, or connects externally without the user choosing it.</li>
        <li>Every public listing needs a real source URL and review approval.</li>
      </ul>
    </aside>
  </section>`;
}

function submissionCard(tool) {
  const canModerate = !!ui.snapshot?.canModerate;
  const isMine = tool.developerId === ui.snapshot?.actorId;
  const editable = (isMine || canModerate) && (canModerate || !["approved", "disabled"].includes(tool.status));
  return `<article class="ps-submission">
    <header>
      <div>
        <p>${esc(tool.developerName || "Developer")} / ${esc(tool.category)}</p>
        <h3>${esc(tool.name || "Untitled tool")}</h3>
      </div>
      <span class="is-${esc(tool.status)}">${esc(statusLabel(tool.status))}</span>
    </header>
    <p>${esc(tool.summary || "No summary yet.")}</p>
    <div class="ps-tags">${(tool.tags || []).map((tag) => `<em>${esc(tag)}</em>`).join("")}</div>
    ${tool.moderationNote ? `<blockquote>${esc(tool.moderationNote)}</blockquote>` : ""}
    ${editable ? `<div class="ps-card-actions"><button type="button" class="ps-secondary" data-ps-edit="${esc(tool.id)}">Edit &amp; resubmit</button></div>` : ""}
    ${canModerate ? `<div class="ps-moderate">
      <input data-ps-note="${esc(tool.id)}" maxlength="1000" placeholder="Review note" />
      <label><input type="checkbox" data-ps-featured="${esc(tool.id)}" ${tool.featured ? "checked" : ""}/> Featured</label>
      <button type="button" data-ps-moderate="approved" data-id="${esc(tool.id)}">Approve</button>
      <button type="button" data-ps-moderate="changes_requested" data-id="${esc(tool.id)}">Request changes</button>
      <button type="button" data-ps-moderate="rejected" data-id="${esc(tool.id)}">Reject</button>
      <button type="button" data-ps-moderate="disabled" data-id="${esc(tool.id)}">Disable</button>
    </div>` : ""}
  </article>`;
}

function renderSubmissions() {
  const submissions = Array.isArray(ui.snapshot?.submissions) ? ui.snapshot.submissions : [];
  return `<section class="ps-review">
    <div class="ps-section-head">
      <div>
        <p class="ps-kicker">${ui.snapshot?.canModerate ? "MODERATION QUEUE" : "YOUR BUILDS"}</p>
        <h2>${ui.snapshot?.canModerate ? "Review AI marketplace submissions" : "Your PhantomStore submissions"}</h2>
      </div>
      <span>${Number(ui.snapshot?.pendingReviewCount || 0)} pending</span>
    </div>
    <div class="ps-submission-list">${submissions.length ? submissions.map(submissionCard).join("") : emptyState("No submissions yet", "Save a draft or submit an AI tool/app for review.")}</div>
  </section>`;
}

function aiWorkspaceListings() {
  return allProducts().filter((product) => product.workspaceProductId);
}

function selectedAiProduct() {
  return (ui.aiSnapshot?.products || []).find((product) => product.id === ui.aiProductId) || null;
}

function selectedAiArtifact() {
  const artifacts = (ui.aiSnapshot?.artifacts || []).filter((artifact) => artifact.productId === ui.aiProductId);
  return artifacts.find((artifact) => artifact.id === ui.aiSelectedArtifactId) || artifacts[0] || null;
}

function latestAiAnalysis(artifactId) {
  return (ui.aiSnapshot?.analyses || [])
    .filter((analysis) => analysis.artifactId === artifactId)
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0] || null;
}

function selectedAiUseCase(product = selectedAiProduct()) {
  const useCases = Array.isArray(product?.useCases) ? product.useCases : [];
  return useCases.find((useCase) => useCase.id === ui.aiUseCaseId) || useCases[0] || null;
}

function renderAiHubCard(product) {
  const active = hasActiveProductAccess(product.id);
  const useCases = Array.isArray(product.useCases) ? product.useCases : [];
  return `<article class="ps-ai-hub-card ${active ? "is-owned" : "is-locked"}" style="--ai-accent:${esc(product.accent || "#42e9ff")}">
    ${workspaceProductArt(product)}
    <div class="ps-ai-hub-card-copy"><p class="ps-kicker">${active ? "OWNED ACCOUNT APP" : esc(product.priceLabel || "PAID LICENSE")}</p><h3>${esc(product.name)}</h3><p>${esc(product.summary)}</p></div>
    <div class="ps-ai-usecase-strip">${useCases.slice(0, 3).map((useCase) => `<span><b>${esc(useCase.title)}</b><small>${esc(useCase.audience)}</small></span>`).join("")}</div>
    <div class="ps-tags">${(product.badges || []).map((tag) => `<em>${esc(tag)}</em>`).join("")}</div>
    ${active
      ? `<button type="button" class="ps-primary" data-ps-launch-ai="${esc(product.workspaceProductId)}">Open ${esc(product.name.replace("PHANTOM ", ""))}</button>`
      : `<button type="button" class="ps-primary" data-ps-buy="${esc(product.id)}">${ui.buyingProductId === product.id ? "Opening secure checkout…" : `Buy once · ${esc(product.priceLabel || "unlock")}`}</button>`}
    ${ui.buyNoticeProductId === product.id && ui.buyMessage ? `<div class="ps-buy-note">${esc(ui.buyMessage)}</div>` : ""}
  </article>`;
}

function renderAiHub() {
  const products = aiWorkspaceListings();
  return `<section class="ps-ai-hub">
    <header class="ps-ai-hub-head">
      <div><p class="ps-kicker">TEN ACCOUNT-OWNED APPLICATIONS</p><h2>Buy once. Unlock on desktop and web.</h2></div>
      <span>${products.filter((product) => hasActiveProductAccess(product.id)).length} owned / ${products.length}</span>
    </header>
    <p class="ps-ai-hub-copy">Every product has its own operational cockpit, real use-case workflows, private versioned work, inspectable calculations, and a permanent account library. Workspace APIs reject access until a verified purchase entitlement is active.</p>
    <div class="ps-ai-hub-grid">${products.map(renderAiHubCard).join("")}</div>
  </section>`;
}

function renderAiFormField(definition) {
  const required = definition.required ? "required" : "";
  const help = definition.help ? `<small>${esc(definition.help)}</small>` : "";
  const label = `${esc(definition.label)}${definition.required ? " *" : ""}`;
  if (definition.type === "textarea") return `<label class="ps-ai-field is-wide"><span>${label}</span><textarea name="${esc(definition.id)}" rows="3" maxlength="12000" ${required}></textarea>${help}</label>`;
  if (definition.type === "select") return `<label class="ps-ai-field"><span>${label}</span><select name="${esc(definition.id)}" ${required}>${(definition.options || []).map((option) => `<option value="${esc(option)}">${esc(option)}</option>`).join("")}</select>${help}</label>`;
  return `<label class="ps-ai-field"><span>${label}</span><input name="${esc(definition.id)}" type="${esc(definition.type || "text")}" ${definition.type === "number" ? 'step="any"' : ""} ${required}/>${help}</label>`;
}

function renderAiTable(rows = []) {
  if (!rows.length) return "";
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row || {})))];
  return `<div class="ps-ai-table-wrap"><table><thead><tr>${keys.map((key) => `<th>${esc(statusLabel(key))}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${keys.map((key) => `<td>${esc(typeof row[key] === "object" ? JSON.stringify(row[key]) : row[key])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function renderAiCoreLoop(coreLoop = null) {
  if (!coreLoop) return "";
  const records = Object.entries(coreLoop).filter(([key]) => !["schemaVersion", "productId", "deterministic", "externalProviderUsed", "modules"].includes(key));
  return `<section class="ps-ai-core"><header><div><p class="ps-kicker">MILESTONE 2 CORE LOOP</p><h3>Complete product workflow</h3></div><span>Deterministic · $0</span></header>
    <div class="ps-ai-modules">${(coreLoop.modules || []).map((module) => `<em>${esc(module)}</em>`).join("")}</div>
    <div class="ps-ai-records">${records.map(([key, value]) => `<details><summary>${esc(statusLabel(key))}</summary><pre>${esc(JSON.stringify(value, null, 2))}</pre></details>`).join("")}</div>
  </section>`;
}

function renderAiCockpit(product, artifact, analysis) {
  const useCase = selectedAiUseCase(product);
  const cover = safeAssetHref(product.imageUrl);
  const modules = (product.modules || []).slice(0, 7);
  const metric = analysis?.output?.metrics?.[0] || null;
  return `<section class="ps-ai-cockpit">
    <div class="ps-ai-cockpit-cover">${cover ? `<img src="${esc(cover)}" alt="${esc(product.name)} custom product cover" />` : workspaceProductArt({ ...product, workspaceProductId: product.id })}<span>ACCOUNT LICENSE ACTIVE</span></div>
    <div class="ps-ai-cockpit-main">
      <header><div><p class="ps-kicker">${esc(product.cockpitLabel || "PRODUCT COMMAND DECK")}</p><h3>${esc(useCase?.title || product.primaryModule)}</h3><p>${esc(useCase?.summary || product.promise || product.tagline)}</p></div><b>${analysis ? esc(statusLabel(analysis.status)) : artifact ? "ready to analyze" : "new mission"}</b></header>
      <div class="ps-ai-pipeline">${modules.map((module, index) => `<span class="${index === 0 || artifact ? "is-live" : ""}"><i>${String(index + 1).padStart(2, "0")}</i><b>${esc(module)}</b></span>`).join("")}</div>
      <div class="ps-ai-cockpit-stats">
        <span><small>Mission outcome</small><b>${esc(useCase?.outcome || product.artifactLabel)}</b></span>
        <span><small>Primary signal</small><b>${metric ? `${esc(metric.value)} ${esc(metric.unit)}` : esc(product.metricName || "Awaiting inputs")}</b></span>
        <span><small>Evidence posture</small><b>Source-linked · human reviewed</b></span>
      </div>
    </div>
  </section>`;
}

function renderAiUseCases(product) {
  const useCases = Array.isArray(product.useCases) ? product.useCases : [];
  if (!useCases.length) return "";
  const active = selectedAiUseCase(product);
  return `<section class="ps-ai-usecases"><header><div><p class="ps-kicker">MISSION LAUNCHPAD</p><h3>Choose a real workflow</h3></div><span>${useCases.length} playbooks</span></header><div>${useCases.map((useCase) => `<button type="button" class="${active?.id === useCase.id ? "is-active" : ""}" data-ps-ai-use-case="${esc(useCase.id)}"><small>${esc(useCase.audience)}</small><b>${esc(useCase.title)}</b><span>${esc(useCase.summary)}</span><em>${esc(useCase.outcome)}</em></button>`).join("")}</div></section>`;
}

function renderAiAnalysis(product, artifact, analysis) {
  if (!artifact) return `<div class="ps-ai-empty"><b>Select or create an artifact.</b><p>The product calculation stays unavailable until source input is persisted.</p></div>`;
  const header = `<header class="ps-ai-selected-head"><div><p class="ps-kicker">${esc(product.artifactLabel)}</p><h3>${esc(artifact.title)}</h3><small>revision ${Number(artifact.revision || 1)} · ${esc(statusLabel(artifact.status))} · dependency ${esc(artifact.dependencyState || "fresh")}</small></div><button type="button" class="ps-secondary" data-ps-ai-export="${esc(artifact.id)}">Export JSON</button></header>`;
  if (!analysis) return `${header}<div class="ps-ai-empty"><b>No analysis yet.</b><p>Run ${esc(product.primaryModule)} to calculate the product-specific core loop.</p><button type="button" class="ps-primary" data-ps-ai-analyze="${esc(artifact.id)}">Run ${esc(product.primaryModule)}</button></div>`;
  if (analysis.status === "stale") return `${header}<div class="ps-ai-stale"><b>Previous analysis is stale.</b><p>${esc(analysis.staleReason || "The source changed.")} Recompute before review.</p><button type="button" class="ps-primary" data-ps-ai-analyze="${esc(artifact.id)}">Run updated analysis</button></div>`;
  const output = analysis.output || {};
  const metrics = (output.metrics || []).map((metric) => `<article><span>${esc(metric.name)}</span><b>${esc(metric.value)} ${esc(metric.unit)}</b><details><summary>Formula and inputs</summary><p>${esc(metric.formula)}</p><pre>${esc(JSON.stringify(metric.inputs, null, 2))}</pre></details></article>`).join("");
  const review = analysis.status === "pending_review" ? `<div class="ps-ai-review"><label class="ps-ai-field is-wide"><span>Human correction (required only for Correct)</span><textarea data-ps-ai-correction rows="3" maxlength="4000"></textarea></label><div class="ps-card-actions"><button type="button" class="ps-primary" data-ps-ai-review="accepted" data-id="${esc(analysis.id)}">Accept</button><button type="button" class="ps-secondary" data-ps-ai-review="corrected" data-id="${esc(analysis.id)}">Correct and accept</button><button type="button" class="ps-secondary" data-ps-ai-review="rejected" data-id="${esc(analysis.id)}">Reject</button></div></div>` : `<div class="ps-ai-reviewed"><b>Human disposition: ${esc(statusLabel(analysis.finalDisposition || analysis.status))}</b><p>Source fields remain versioned separately from the review.</p></div>`;
  return `${header}<div class="ps-ai-analysis-copy"><p>${esc(output.summary || "")}</p><div class="ps-ai-metrics">${metrics}</div><p><b>Method:</b> ${esc(output.method || "")}</p>${(output.warnings || []).length ? `<ul>${output.warnings.map((warning) => `<li>${esc(warning)}</li>`).join("")}</ul>` : ""}${renderAiTable(output.table || [])}${renderAiCoreLoop(output.coreLoop)}<small>Provider path: ${esc(analysis.providerPath || "deterministic-domain-v1")} · External model: no · Provider cost: $0 · Human review: required</small>${review}</div>`;
}

function renderAiWorkspace() {
  if (ui.aiLoading) return `<div class="ps-loading"><i></i><b>Loading the PhantomStore AI workspace...</b></div>`;
  if (!ui.aiSnapshot) return `<section class="ps-ai-workspace"><button type="button" class="ps-secondary" data-ps-ai-back>← AI Workspaces</button><div class="ps-error"><b>Workspace unavailable.</b><span>${esc(ui.aiMessage || "The authenticated AI workspace service did not respond.")}</span></div></section>`;
  const product = selectedAiProduct();
  if (!product) return `<section class="ps-ai-workspace"><button type="button" class="ps-secondary" data-ps-ai-back>← AI Workspaces</button>${emptyState("Product not found", "Choose one of the ten served AI workspaces.")}</section>`;
  const consent = ui.aiSnapshot.workspace?.consent?.[product.id] || { status: "not_requested" };
  const granted = consent.status === "granted";
  const artifacts = (ui.aiSnapshot.artifacts || []).filter((artifact) => artifact.productId === product.id);
  const artifact = selectedAiArtifact();
  const analysis = artifact ? latestAiAnalysis(artifact.id) : null;
  return `<section class="ps-ai-workspace" style="--ai-accent:${esc(product.accent || "#42e9ff")}">
    <button type="button" class="ps-secondary ps-ai-back" data-ps-ai-back>← All AI workspaces</button>
    <header class="ps-ai-workspace-hero"><div><p class="ps-kicker">${esc(product.category)}</p><h2>${esc(product.name)}</h2><p>${esc(product.tagline)}</p></div><div><span>${artifacts.length} artifacts</span><span>${(ui.aiSnapshot.analyses || []).filter((item) => item.productId === product.id).length} analyses</span><span>$0 provider spend</span></div></header>
    ${ui.aiMessage ? `<div class="ps-ai-message" role="status">${esc(ui.aiMessage)}</div>` : ""}
    <div class="ps-ai-consent ${granted ? "is-granted" : ""}"><div><b>${granted ? "Purpose consent granted" : "Purpose consent required"}</b><p>${granted ? `Retained for ${Number(consent.retentionDays || 30)} days. Withdrawal restricts dependent artifacts.` : "This workspace stores the fields and provenance you explicitly submit. No external model or data provider is called."}</p></div>${granted ? `<button type="button" class="ps-secondary" data-ps-ai-consent="withdrawn">Withdraw</button>` : `<button type="button" class="ps-primary" data-ps-ai-consent="granted">Grant 30-day consent</button>`}</div>
    ${renderAiUseCases(product)}
    ${renderAiCockpit(product, artifact, analysis)}
    <div class="ps-ai-layout">
      <form class="ps-ai-create" data-ps-ai-form>
        <header><div><p class="ps-kicker">${esc(product.primaryModule)}</p><h3>${esc(product.actionLabel || `Create ${product.artifactLabel.toLowerCase()}`)}</h3></div><span>${granted ? "Ready" : "Locked"}</span></header>
        <div class="ps-ai-fields">${(product.fields || []).map(renderAiFormField).join("")}</div>
        <label class="ps-ai-field is-wide"><span>Provenance note *</span><textarea name="evidenceNote" rows="3" maxlength="4000" required></textarea></label>
        <label class="ps-ai-field is-wide"><span>Evidence label</span><input name="evidenceLabel" maxlength="240" /></label>
        <div class="ps-card-actions"><button type="button" class="ps-secondary" data-ps-ai-sample ${granted ? "" : "disabled"}>Load product demo</button><button type="submit" class="ps-primary" ${granted && !ui.aiBusy ? "" : "disabled"}>${ui.aiBusy ? "Working..." : "Create artifact"}</button></div>
      </form>
      <aside class="ps-ai-artifacts"><header><div><p class="ps-kicker">VERSIONED OBJECTS</p><h3>Artifacts</h3></div><span>${artifacts.length}</span></header>${artifacts.length ? artifacts.map((item) => `<button type="button" class="${item.id === artifact?.id ? "is-active" : ""}" data-ps-ai-artifact="${esc(item.id)}"><b>${esc(item.title)}</b><span>revision ${Number(item.revision || 1)} · ${esc(statusLabel(item.status))}</span></button>`).join("") : `<p>No saved artifacts yet.</p>`}</aside>
    </div>
    <section class="ps-ai-analysis"><header class="ps-section-head"><div><p class="ps-kicker">CALCULATION + HUMAN REVIEW</p><h2>Inspectable analysis</h2></div><span>${analysis ? esc(statusLabel(analysis.status)) : "not run"}</span></header>${renderAiAnalysis(product, artifact, analysis)}</section>
  </section>`;
}

function renderContent() {
  if (ui.loading) return `<div class="ps-loading"><i></i><b>Loading PhantomStore...</b></div>`;
  if (ui.error) return `<div class="ps-error"><b>PhantomStore is not available.</b><span>${esc(ui.error)}</span><button type="button" data-ps-refresh>Try again</button></div>`;
  if (ui.tab === "sellers") return renderSellers();
  if (ui.tab === "library") return renderLibrary();
  if (ui.tab === "submit") return renderSubmit();
  if (ui.tab === "review") return renderSubmissions();
  if (ui.tab === "ai") return renderAiHub();
  if (ui.tab === "lab") return renderAiWorkspace();
  return renderDiscover();
}

function render() {
  if (!mountedRoot) return;
  clearTimeout(spotlightTimer);
  mountedRoot.innerHTML = `<section class="ps-shell">
    <header class="ps-top ps-store-bar">
      <div>
        <p class="ps-kicker">PHANTOMSTORE</p>
        <h1>Marketplace</h1>
      </div>
      <div class="ps-trust-strip" aria-label="Marketplace trust">
        <span><b>✓</b>Reviewed listings</span>
        <span><b>◇</b>Protected checkout</span>
        <span><b>↺</b>Owned library</span>
      </div>
    </header>
    <nav class="ps-tabs" aria-label="PhantomStore sections">
      ${[["discover", "Discover"], ["ai", "AI Workspaces"], ["sellers", "Sellers"], ["library", "Library"], ["submit", "Submit"], ["review", ui.snapshot?.canModerate ? "Review" : "My tools"]].map(([id, label]) => `<button type="button" class="${ui.tab === id || (id === "ai" && ui.tab === "lab") ? "is-active" : ""}" data-ps-tab="${id}">${label}</button>`).join("")}
    </nav>
    ${ui.message ? `<div class="ps-store-message" role="status">${esc(ui.message)}</div>` : ""}
    ${renderContent()}
  </section>`;
  bind();
}

async function submitForm(form, submit) {
  ui.busy = true;
  const editingId = form.dataset.psEditing || "";
  ui.message = submit ? "Submitting to review..." : "Saving draft...";
  render();
  try {
    const data = new FormData(form);
    const payload = Object.fromEntries(data.entries());
    payload.tags = String(payload.tags || "").split(",").map((tag) => tag.trim()).filter(Boolean);
    payload.submit = submit;
    const endpoint = editingId ? `/api/phantomstore/tools/${encodeURIComponent(editingId)}` : "/api/phantomstore/tools";
    const result = await api(endpoint, { method: "POST", body: JSON.stringify(payload) });
    ui.message = submit ? (editingId ? "Resubmitted for review." : "Submitted for review.") : `Draft saved. ${result.issues?.length ? result.issues.join(" ") : ""}`;
    ui.editingToolId = "";
    ui.tab = submit ? "review" : "submit";
    await hydrate();
  } catch (error) {
    ui.message = error instanceof Error ? error.message : "Tool could not be saved.";
    render();
  } finally {
    ui.busy = false;
    render();
  }
}

async function draftWithPhantom() {
  ui.busy = true;
  ui.aiDraftMessage = "Phantom is structuring the batch...";
  render();
  try {
    const result = await api("/api/phantomstore/tools/ai-draft", {
      method: "POST",
      body: JSON.stringify({
        sourceText: ui.aiSourceText,
        defaultCategory: ui.aiDefaultCategory,
        defaultInstallMethod: ui.aiDefaultInstallMethod,
        limit: 120,
      }),
    });
    ui.aiDrafts = Array.isArray(result.drafts) ? result.drafts : [];
    ui.aiDraftMessage = ui.aiDrafts.length
      ? `Drafted ${ui.aiDrafts.length} items from ${Number(result.totalDetected || ui.aiDrafts.length)} detected entries. Review, then save as drafts.`
      : "Paste a product list, links, CSV rows, or notes first.";
  } catch (error) {
    ui.aiDraftMessage = error instanceof Error ? error.message : "Phantom draft intake failed.";
  } finally {
    ui.busy = false;
    render();
  }
}

async function saveAiDrafts() {
  if (!ui.aiDrafts.length) return;
  ui.aiSavingDrafts = true;
  ui.aiDraftMessage = "Saving generated drafts for review...";
  render();
  try {
    const result = await api("/api/phantomstore/tools/bulk-drafts", {
      method: "POST",
      body: JSON.stringify({ drafts: ui.aiDrafts }),
    });
    ui.aiDraftMessage = `Saved ${Number(result.tools?.length || 0)} drafts. ${Number(result.skipped || 0) ? `${Number(result.skipped)} skipped by limit.` : "Nothing was submitted publicly."}`;
    ui.aiDrafts = [];
    await hydrate();
    ui.tab = "review";
  } catch (error) {
    ui.aiDraftMessage = error instanceof Error ? error.message : "Generated drafts could not be saved.";
    render();
  } finally {
    ui.aiSavingDrafts = false;
    render();
  }
}

async function recordInstall(id) {
  ui.installToolId = id;
  ui.installMessage = "Opening safe install details...";
  render();
  try {
    const result = await api(`/api/phantomstore/tools/${encodeURIComponent(id)}/install`, { method: "POST" });
    ui.installMessage = `Install interest recorded (${Number(result.installClicks || 0)}).`;
    const tool = ui.snapshot?.catalog?.find((item) => item.id === id);
    if (tool) tool.installClicks = result.installClicks;
  } catch (error) {
    ui.installMessage = error instanceof Error ? error.message : "Install details could not be opened.";
  }
  render();
}

async function recordBuy(id) {
  ui.buyingProductId = id;
  ui.buyNoticeProductId = id;
  ui.buyMessage = "Preparing checkout...";
  render();
  if (ui.snapshot?.readOnlyFallback) {
    const product = ui.snapshot?.products?.find((item) => item.id === id);
    const url = safeHref(product?.buyUrl);
    ui.buyMessage = url ? "Opening the product page from the local catalog." : "This product is not ready for purchase yet.";
    if (url) window.open(url, "_blank", "noopener,noreferrer");
    ui.buyingProductId = "";
    render();
    return;
  }
  try {
    const product = ui.snapshot?.products?.find((item) => item.id === id);
    const result = product?.workspaceProductId
      ? await api(`/api/phantomstore/products/${encodeURIComponent(id)}/checkout-session`, { method: "POST" })
      : await api(`/api/phantomstore/products/${encodeURIComponent(id)}/buy`, { method: "POST" });
    if (product) product.buyClicks = result.buyClicks;
    if (product?.workspaceProductId) {
      ui.buyMessage = "Secure Stripe Checkout is ready. Access unlocks only after its signed paid webhook returns.";
      const checkoutUrl = safeHref(result.checkoutUrl);
      if (!checkoutUrl) throw new Error("Secure checkout did not return a destination. No purchase was made.");
      window.location.assign(checkoutUrl);
    } else {
      ui.buyMessage = result.checkout?.note || "Purchase intent recorded.";
      const url = safeHref(result.checkout?.url);
      if (url) window.open(url, "_blank", "noopener,noreferrer");
      ui.buyingProductId = "";
    }
  } catch (error) {
    ui.buyMessage = error instanceof Error ? error.message : "Checkout could not be prepared.";
    ui.buyingProductId = "";
  }
  render();
}

async function grantOwnerTestAccess(id) {
  ui.lifecycleProductId = id;
  ui.lifecycleMessage = "Granting verified owner test access…";
  render();
  try {
    const result = await api(`/api/phantomstore/products/${encodeURIComponent(id)}/entitlements`, {
      method: "POST",
      body: JSON.stringify({ purchaseReference: `owner-test-${id}-${ui.snapshot?.actorId || "owner"}` }),
    });
    ui.lifecycleMessage = result.idempotent ? "Owner test access was already active." : "Owner test access granted.";
    await hydrate();
    ui.tab = "library";
  } catch (error) {
    ui.lifecycleMessage = error instanceof Error ? error.message : "Owner test access could not be granted.";
    render();
  }
}

async function mutateInstallation(id, action, platform) {
  ui.lifecycleProductId = id;
  ui.lifecycleMessage = action === "uninstall" ? "Uninstalling while preserving data…" : `${action[0].toUpperCase()}${action.slice(1)} in progress…`;
  render();
  try {
    const result = await api(`/api/phantomstore/products/${encodeURIComponent(id)}/installation`, {
      method: "POST",
      body: JSON.stringify({ action, platform }),
    });
    ui.lifecycleMessage = action === "uninstall" && result.userDataPreserved
      ? "Uninstalled. Your product data was preserved."
      : result.changed === false ? "Already current." : `${action[0].toUpperCase()}${action.slice(1)} complete.`;
    await hydrate();
    ui.tab = "library";
  } catch (error) {
    ui.lifecycleMessage = error instanceof Error ? error.message : "Product state could not be updated.";
    render();
  }
}

async function moderate(id, decision) {
  ui.message = "Saving moderation decision...";
  render();
  try {
    const note = mountedRoot?.querySelector(`[data-ps-note="${cssEscape(id)}"]`)?.value || "";
    const featured = !!mountedRoot?.querySelector(`[data-ps-featured="${cssEscape(id)}"]`)?.checked;
    await api(`/api/phantomstore/tools/${encodeURIComponent(id)}/moderate`, { method: "POST", body: JSON.stringify({ decision, note, featured }) });
    ui.message = "Moderation saved.";
    await hydrate();
  } catch (error) {
    ui.message = error instanceof Error ? error.message : "Moderation could not be saved.";
    render();
  }
}

async function copyInstall(id) {
  const tool = ui.snapshot?.catalog?.find((item) => item.id === id);
  const command = tool?.installCommand || "";
  if (!command) return;
  try {
    await navigator.clipboard.writeText(command);
    ui.installMessage = "Command copied.";
  } catch {
    ui.installMessage = command;
  }
  render();
}

async function loadAiWorkspace() {
  ui.aiLoading = true;
  ui.aiMessage = "Loading the authenticated product workspace...";
  render();
  try {
    ui.aiSnapshot = await api("/api/phantomstore/ai-products");
    const product = selectedAiProduct();
    if (product && !(product.useCases || []).some((useCase) => useCase.id === ui.aiUseCaseId)) ui.aiUseCaseId = product.useCases?.[0]?.id || "";
    const artifacts = (ui.aiSnapshot?.artifacts || []).filter((artifact) => artifact.productId === ui.aiProductId);
    if (!artifacts.some((artifact) => artifact.id === ui.aiSelectedArtifactId)) ui.aiSelectedArtifactId = artifacts[0]?.id || "";
    ui.aiMessage = "";
  } catch (error) {
    ui.aiSnapshot = null;
    ui.aiMessage = error instanceof Error ? error.message : "The AI workspace could not be loaded.";
  } finally {
    ui.aiLoading = false;
    render();
  }
}

async function openAiWorkspace(productId) {
  const listing = aiWorkspaceListings().find((product) => product.workspaceProductId === productId);
  if (!listing || !hasActiveProductAccess(listing.id)) {
    ui.tab = "ai";
    ui.buyingProductId = "";
    ui.buyNoticeProductId = listing?.id || "";
    ui.buyMessage = "Purchase this product to unlock it for your account on desktop and web.";
    render();
    return;
  }
  ui.aiProductId = productId;
  ui.aiUseCaseId = "";
  ui.aiSelectedArtifactId = "";
  ui.aiMessage = "";
  ui.tab = "lab";
  await loadAiWorkspace();
}

async function changeAiConsent(status) {
  ui.aiBusy = true;
  ui.aiMessage = status === "granted" ? "Recording purpose consent..." : "Withdrawing consent and restricting dependencies...";
  render();
  try {
    await api(`/api/phantomstore/ai-products/${encodeURIComponent(ui.aiProductId)}/consent`, {
      method: "POST",
      body: JSON.stringify({ status, purpose: "Create, calculate, review, export, and delete source-linked PhantomStore AI product artifacts.", retentionDays: 30 }),
    });
    await loadAiWorkspace();
    ui.aiMessage = status === "granted" ? "Purpose consent granted." : "Consent withdrawn; dependent artifacts are restricted.";
  } catch (error) {
    ui.aiMessage = error instanceof Error ? error.message : "Consent could not be changed.";
  } finally {
    ui.aiBusy = false;
    render();
  }
}

function loadAiProductSample() {
  const product = selectedAiProduct();
  const useCase = selectedAiUseCase(product);
  const form = mountedRoot?.querySelector("[data-ps-ai-form]");
  if (!product || !form) return;
  Object.entries(product.sample || {}).forEach(([name, value]) => { if (form.elements[name]) form.elements[name].value = value; });
  form.elements.evidenceNote.value = `Reversible ${product.name} in-store demo fixture. Values are declared user inputs, not external facts.`;
  form.elements.evidenceLabel.value = useCase ? `${useCase.title} demo fixture` : "PhantomStore integrated demo fixture";
  ui.aiMessage = `${useCase?.title || "Product"} demo loaded. Nothing is saved until Create artifact is selected.`;
  const status = mountedRoot.querySelector(".ps-ai-message");
  if (status) status.textContent = ui.aiMessage;
}

async function createAiArtifact(form) {
  const product = selectedAiProduct();
  if (!product) return;
  const data = new FormData(form);
  const fields = Object.fromEntries((product.fields || []).map((definition) => [definition.id, data.get(definition.id)]));
  const evidenceNote = data.get("evidenceNote");
  const evidenceLabel = data.get("evidenceLabel");
  ui.aiBusy = true;
  ui.aiMessage = "Persisting the versioned source artifact...";
  render();
  try {
    const result = await api(`/api/phantomstore/ai-products/${encodeURIComponent(product.id)}/artifacts`, {
      method: "POST",
      headers: { "Idempotency-Key": `artifact:${crypto.randomUUID()}` },
      body: JSON.stringify({ fields, evidenceNote, evidenceLabel }),
    });
    ui.aiSelectedArtifactId = result.artifact.id;
    await loadAiWorkspace();
    ui.aiMessage = `${product.artifactLabel} created in the served PhantomStore workspace.`;
  } catch (error) {
    ui.aiMessage = error instanceof Error ? error.message : "The artifact could not be created.";
  } finally {
    ui.aiBusy = false;
    render();
  }
}

async function runAiAnalysis(artifactId) {
  ui.aiBusy = true;
  ui.aiMessage = "Running the durable deterministic product job...";
  render();
  try {
    await api(`/api/phantomstore/ai-products/artifacts/${encodeURIComponent(artifactId)}/analyses`, {
      method: "POST",
      headers: { "Idempotency-Key": `analysis:${crypto.randomUUID()}` },
      body: "{}",
    });
    ui.aiSelectedArtifactId = artifactId;
    await loadAiWorkspace();
    ui.aiMessage = "Core-loop analysis completed and is awaiting human review.";
  } catch (error) {
    ui.aiMessage = error instanceof Error ? error.message : "Analysis could not be completed.";
  } finally {
    ui.aiBusy = false;
    render();
  }
}

async function reviewAiAnalysis(analysisId, decision) {
  const correction = mountedRoot?.querySelector("[data-ps-ai-correction]")?.value || "";
  ui.aiBusy = true;
  ui.aiMessage = "Recording the human disposition...";
  render();
  try {
    await api(`/api/phantomstore/ai-products/analyses/${encodeURIComponent(analysisId)}/review`, {
      method: "POST",
      headers: { "Idempotency-Key": `review:${crypto.randomUUID()}` },
      body: JSON.stringify({ decision, correction }),
    });
    await loadAiWorkspace();
    ui.aiMessage = `Analysis ${decision}. Source fields remain separately versioned.`;
  } catch (error) {
    ui.aiMessage = error instanceof Error ? error.message : "Review could not be recorded.";
  } finally {
    ui.aiBusy = false;
    render();
  }
}

async function exportAiArtifact(artifactId) {
  try {
    const response = await fetch(`/api/phantomstore/ai-products/artifacts/${encodeURIComponent(artifactId)}/export`, { headers: authHeaders() });
    if (!response.ok) throw new Error("The source-linked export could not be created.");
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `phantomstore-ai-${artifactId}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    ui.aiMessage = "Portable source-linked JSON export created.";
  } catch (error) {
    ui.aiMessage = error instanceof Error ? error.message : "Export failed.";
  }
  render();
}

function bind() {
  mountedRoot.querySelectorAll("[data-ps-tab]").forEach((button) => {
    button.onclick = () => { ui.tab = button.dataset.psTab || "discover"; ui.message = ""; if (ui.tab !== "submit") ui.editingToolId = ""; render(); };
  });
  mountedRoot.querySelectorAll("[data-ps-tab-jump]").forEach((button) => {
    button.onclick = () => { ui.tab = button.dataset.psTabJump || "discover"; ui.message = ""; render(); };
  });
  mountedRoot.querySelectorAll("[data-ps-spotlight]").forEach((button) => {
    button.onclick = () => { ui.spotlightIndex += Number(button.dataset.psSpotlight || 0); render(); };
  });
  mountedRoot.querySelectorAll("[data-ps-spotlight-index]").forEach((button) => {
    button.onclick = () => { ui.spotlightIndex = Number(button.dataset.psSpotlightIndex || 0); render(); };
  });
  mountedRoot.querySelectorAll("[data-ps-edit]").forEach((button) => {
    button.onclick = () => { ui.editingToolId = button.dataset.psEdit || ""; ui.message = ""; ui.tab = "submit"; render(); };
  });
  mountedRoot.querySelector("[data-ps-cancel-edit]")?.addEventListener("click", () => {
    ui.editingToolId = "";
    ui.message = "";
    ui.tab = "review";
    render();
  });
  mountedRoot.querySelector("[data-ps-refresh]")?.addEventListener("click", hydrate);
  mountedRoot.querySelector("[data-ps-ai-source]")?.addEventListener("input", (event) => {
    ui.aiSourceText = event.target.value || "";
  });
  mountedRoot.querySelector("[data-ps-ai-category]")?.addEventListener("change", (event) => {
    ui.aiDefaultCategory = event.target.value || "AI Tool";
  });
  mountedRoot.querySelector("[data-ps-ai-install]")?.addEventListener("change", (event) => {
    ui.aiDefaultInstallMethod = event.target.value || "manual";
  });
  mountedRoot.querySelector("[data-ps-ai-draft]")?.addEventListener("click", draftWithPhantom);
  mountedRoot.querySelector("[data-ps-ai-save]")?.addEventListener("click", saveAiDrafts);
  mountedRoot.querySelector("[data-ps-search]")?.addEventListener("input", (event) => {
    ui.query = event.target.value || "";
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const cursor = event.target.selectionStart ?? ui.query.length;
      render();
      const search = mountedRoot?.querySelector("[data-ps-search]");
      search?.focus({ preventScroll: true });
      search?.setSelectionRange?.(cursor, cursor);
    }, 120);
  });
  mountedRoot.querySelectorAll("[data-ps-category]").forEach((button) => {
    button.onclick = () => { ui.category = button.dataset.psCategory || "All"; render(); };
  });
  mountedRoot.querySelectorAll("[data-ps-product-filter]").forEach((button) => {
    button.onclick = () => { ui.productFilter = button.dataset.psProductFilter || "all"; render(); };
  });
  mountedRoot.querySelectorAll("[data-ps-install]").forEach((button) => {
    button.onclick = () => recordInstall(button.dataset.psInstall || "");
  });
  mountedRoot.querySelectorAll("[data-ps-buy]").forEach((button) => {
    button.onclick = () => recordBuy(button.dataset.psBuy || "");
  });
  mountedRoot.querySelectorAll("[data-ps-launch-ai]").forEach((button) => {
    button.onclick = () => openAiWorkspace(button.dataset.psLaunchAi || "");
  });
  mountedRoot.querySelectorAll("[data-ps-grant-test]").forEach((button) => {
    button.onclick = () => grantOwnerTestAccess(button.dataset.psGrantTest || "");
  });
  mountedRoot.querySelectorAll("[data-ps-open-library]").forEach((button) => {
    button.onclick = () => { ui.tab = "library"; ui.lifecycleProductId = button.dataset.psOpenLibrary || ""; render(); };
  });
  mountedRoot.querySelectorAll("[data-ps-lifecycle]").forEach((button) => {
    button.onclick = () => mutateInstallation(button.dataset.id || "", button.dataset.psLifecycle || "", button.dataset.platform || "web");
  });
  mountedRoot.querySelectorAll("[data-ps-copy]").forEach((button) => {
    button.onclick = () => copyInstall(button.dataset.psCopy || "");
  });
  mountedRoot.querySelectorAll("[data-ps-moderate]").forEach((button) => {
    button.onclick = () => moderate(button.dataset.id || "", button.dataset.psModerate || "");
  });
  mountedRoot.querySelector("[data-ps-ai-back]")?.addEventListener("click", () => { ui.tab = "ai"; ui.aiMessage = ""; render(); });
  mountedRoot.querySelectorAll("[data-ps-ai-consent]").forEach((button) => {
    button.onclick = () => changeAiConsent(button.dataset.psAiConsent || "granted");
  });
  mountedRoot.querySelector("[data-ps-ai-sample]")?.addEventListener("click", loadAiProductSample);
  mountedRoot.querySelectorAll("[data-ps-ai-use-case]").forEach((button) => {
    button.onclick = () => { ui.aiUseCaseId = button.dataset.psAiUseCase || ""; ui.aiMessage = "Playbook selected. Load the product demo or enter your own source-backed inputs."; render(); };
  });
  mountedRoot.querySelectorAll("[data-ps-ai-artifact]").forEach((button) => {
    button.onclick = () => { ui.aiSelectedArtifactId = button.dataset.psAiArtifact || ""; ui.aiMessage = ""; render(); };
  });
  mountedRoot.querySelectorAll("[data-ps-ai-analyze]").forEach((button) => {
    button.onclick = () => runAiAnalysis(button.dataset.psAiAnalyze || "");
  });
  mountedRoot.querySelectorAll("[data-ps-ai-review]").forEach((button) => {
    button.onclick = () => reviewAiAnalysis(button.dataset.id || "", button.dataset.psAiReview || "accepted");
  });
  mountedRoot.querySelectorAll("[data-ps-ai-export]").forEach((button) => {
    button.onclick = () => exportAiArtifact(button.dataset.psAiExport || "");
  });
  const aiForm = mountedRoot.querySelector("[data-ps-ai-form]");
  if (aiForm) aiForm.onsubmit = (event) => { event.preventDefault(); createAiArtifact(aiForm); };
  const form = mountedRoot.querySelector("[data-ps-tool-form]");
  if (form) {
    form.onsubmit = (event) => {
      event.preventDefault();
      const submitter = event.submitter;
      submitForm(form, submitter?.dataset?.submitMode === "submit");
    };
  }
  if (ui.tab === "discover" && !ui.loading && visibleProducts().length > 1) {
    spotlightTimer = window.setTimeout(() => {
      ui.spotlightIndex += 1;
      render();
    }, 5000);
  }
}

export function renderPhantomStore(root) {
  mountedRoot = root;
  hydrate();
}
