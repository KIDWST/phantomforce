import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { AccessSession } from "../access/session.js";
import { redactSensitiveText } from "./hermes-ledger.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../../..");
const STORE_PATH = process.env.PHANTOMFORCE_COMPETITOR_INTELLIGENCE_PATH?.trim()
  ? resolve(process.env.PHANTOMFORCE_COMPETITOR_INTELLIGENCE_PATH)
  : resolve(repoRoot, ".phantom", "competitor-intelligence.json");

const SIGNAL_TYPES = [
  "website_copy", "pricing_page", "landing_page", "indexed_page", "public_ad", "ad_volume",
  "social_cadence", "content_format", "release_note", "documentation", "app_store_note", "public_review",
  "customer_complaint", "job_listing", "employee_role", "partnership", "event_appearance", "newsletter",
  "domain_change", "technology_stack", "search_pattern", "community_discussion",
] as const;
const INFERENCE_AREAS = ["market_direction", "upcoming_offer", "investment", "customer_pain", "positioning", "operational_weakness", "content_priority"] as const;
const PROHIBITED_PATTERNS: Array<{ pattern: RegExp; boundary: string; alternative: string }> = [
  { pattern: /(?:acquire|obtain|steal|capture|buy)\s+(?:credentials?|passwords?|logins?)|(?:unauthorized|private)\s+account access|access\s+(?:their|a competitor(?:'s)?)\s+account/i, boundary: "Unauthorized account or credential access", alternative: "Review public pages, documentation, ads, and opt-in materials." },
  { pattern: /(?:captcha|paywall|private group|private forum|members.only).{0,28}(?:bypass|evade|circumvent|scrape)|(?:bypass|evade|circumvent).{0,28}(?:captcha|paywall|private group|private forum|members.only)/i, boundary: "Access-control or paywall bypass", alternative: "Use public, non-login sources or upload material you are authorized to use." },
  { pattern: /rotate (?:ip|device)|rate.limit (?:evade|bypass)|avoid blocking/i, boundary: "Blocking or rate-limit evasion", alternative: "Reduce collection frequency and comply with the source's published access rules." },
  { pattern: /(?:create|use|buy|post|operate)\s+(?:a\s+)?fake\s+(?:account|customer|identity|review|engagement)|impersonat|\bpretext(?:ing)?\b|\bphish(?:ing)?\b/i, boundary: "Deception or impersonation", alternative: "Use transparent research, genuine accounts, and clearly disclosed outreach." },
  { pattern: /trade secret|steal (?:code|source|asset)|source.code theft|clone (?:their|the) (?:ad|campaign|asset)/i, boundary: "Trade-secret or protected-expression acquisition", alternative: "Analyze abstract strategy and create substantially original expression." },
  { pattern: /review bomb|lead flood|denial.of.service|\bddos\b|harass|defam/i, boundary: "Harassment, interference, or defamation", alternative: "Compete through accurate comparisons, stronger support, and original offers." },
  { pattern: /contact (?:their|competitor) customers|scrape (?:their|competitor) customers/i, boundary: "Invasive targeting of competitor customers", alternative: "Use aggregated public themes and target category demand, not individuals." },
];

export type SignalType = typeof SIGNAL_TYPES[number];
type InferenceArea = typeof INFERENCE_AREAS[number];
type Confidence = "low" | "medium" | "high";

export type CompetitorRecord = { id: string; tenantId: string; name: string; website: string; category: string; notes: string; active: boolean; createdAt: string; updatedAt: string };
export type SignalRecord = { id: string; tenantId: string; competitorId: string; type: SignalType; title: string; summary: string; observedAt: string; sourceUrl: string; sourceLabel: string; publicAccessConfirmed: true; createdAt: string };
export type InferenceRecord = {
  id: string; tenantId: string; competitorId: string; area: InferenceArea; estimate: string; status: "estimate";
  supportingSignalIds: string[]; supportingSignals: Array<{ title: string; date: string; source: string }>;
  alternativeExplanations: string[]; confidence: Confidence; confidenceScore: number; recommendedVerification: string[];
  safeResponseOptions: string[]; createdAt: string;
};
export type AudienceTheme = {
  id: string; tenantId: string; competitorId: string; category: string; theme: string; volume: number; sourceUrls: string[];
  aggregated: true; opportunityType: string; opportunities: string[]; createdAt: string;
};
export type CreativeAnalysis = {
  id: string; tenantId: string; competitorId: string; sourceUrl: string; hookCategory: string; emotionalTrigger: string;
  storyStructure: string; proofMechanism: string; pacing: string; contentDensity: string; visualRhythm: string;
  shotDistribution: string; ctaStructure: string; audienceSophistication: string; objectionAddressed: string;
  desiredAction: string; originalResponse: string; similarityScore: number; similarityRisk: "low" | "medium" | "high";
  similarityWarnings: string[]; createdAt: string;
};
export type InterceptionPackage = {
  id: string; tenantId: string; competitorId: string; eventType: string; eventSummary: string; sourceUrl: string;
  evidence: string; eventDate: string; whyItMatters: string; responseDeadline: string; positioningAngle: string;
  contentBrief: string; landingPageDraft: string; offerOption: string; salesTalkingPoints: string[];
  searchContent: string[]; risks: string[]; requiredApprovals: string[]; measurementPlan: string[]; createdAt: string;
};
export type ResearchOpportunity = {
  id: string; tenantId: string; competitorId: string; kind: "search" | "offer" | "timing"; title: string; sourceUrl: string;
  insight: string; recommendations: string[]; accuracyNotes: string[]; createdAt: string;
};
export type MysteryEvidence = {
  id: string; tenantId: string; competitorId: string; evidenceType: string; title: string; acquiredAt: string;
  observations: string; sourceReference: string; legitimatelyObtained: true; noDeceptionConfirmed: true; createdAt: string;
};
export type AuditRecord = { id: string; tenantId: string; actorId: string; action: string; result: "allowed" | "blocked"; reason: string; alternative: string; createdAt: string };
export type ScoutContext = { businessName: string; location: string; offer: string; audience: string; goals: string; createdAt: string; updatedAt: string };
type ScoutLane = {
  id: string; label: string; status: "needs_context" | "active" | "watching" | "source_ready"; query: string; why: string;
  sourceTargets: string[]; candidateCompetitors: string[]; nextAction: string;
};
type MarketBoardItem = {
  competitorId: string; name: string; symbol: string; category: string; domain: string; score: number;
  momentum: "gaining" | "vulnerable" | "mixed" | "quiet" | "unwatched"; confidence: "none" | Confidence;
  signalCount: number; recentSignals: number; lastSignalAt: string | null; tip: string; watch: string[];
  sourceState?: "tracked" | "starter";
};
type StarterCompetitor = { id: string; name: string; website: string; category: string; notes: string; score: number; watch: string[] };
type AutoScoutReport = {
  generatedAt: string; mode: "starter_public_map" | "tracked_public_signals" | "mixed_public_map"; headline: string; sourceNote: string;
  competitorSet: { tracked: number; starter: number; totalCompared: number; liveSignals: number; confidence: "starter" | "low" | "medium" | "high" };
  charts: Array<{ label: string; value: number; tone: "good" | "warn" | "hot" | "neutral"; detail: string }>;
  comparisons: Array<{
    competitorId: string; name: string; category: string; domain: string; score: number; sourceState: "tracked" | "starter";
    threatLevel: "high" | "medium" | "watch"; phantomAngle: string; watch: string[]; sourceTargets: Array<{ label: string; url: string; reason: string }>;
  }>;
  opportunities: Array<{ title: string; detail: string; action: string; impact: number; tone: "good" | "warn" | "hot" | "neutral" }>;
};

type TenantState = {
  settings: { aggressiveMode: boolean; modeChangedAt: string | null; publicSourcesOnly: true; individualTargeting: false; externalActions: false; scoutContext: ScoutContext | null; scoutEnabled: boolean; scoutCadence: "manual" | "daily"; lastScoutRunAt: string | null };
  competitors: CompetitorRecord[]; signals: SignalRecord[]; inferences: InferenceRecord[]; audienceThemes: AudienceTheme[];
  creativeAnalyses: CreativeAnalysis[]; interceptions: InterceptionPackage[]; opportunities: ResearchOpportunity[];
  mysteryEvidence: MysteryEvidence[]; audit: AuditRecord[];
};
type Store = { version: 1; tenants: Record<string, TenantState> };
const freshTenant = (): TenantState => ({ settings: { aggressiveMode: false, modeChangedAt: null, publicSourcesOnly: true, individualTargeting: false, externalActions: false, scoutContext: null, scoutEnabled: false, scoutCadence: "manual", lastScoutRunAt: null }, competitors: [], signals: [], inferences: [], audienceThemes: [], creativeAnalyses: [], interceptions: [], opportunities: [], mysteryEvidence: [], audit: [] });
let writeChain = Promise.resolve();

function normalizeTenantState(state: TenantState): TenantState {
  const fresh = freshTenant();
  state.settings = { ...fresh.settings, ...(state.settings || {}) };
  state.competitors = Array.isArray(state.competitors) ? state.competitors : [];
  state.signals = Array.isArray(state.signals) ? state.signals : [];
  state.inferences = Array.isArray(state.inferences) ? state.inferences : [];
  state.audienceThemes = Array.isArray(state.audienceThemes) ? state.audienceThemes : [];
  state.creativeAnalyses = Array.isArray(state.creativeAnalyses) ? state.creativeAnalyses : [];
  state.interceptions = Array.isArray(state.interceptions) ? state.interceptions : [];
  state.opportunities = Array.isArray(state.opportunities) ? state.opportunities : [];
  state.mysteryEvidence = Array.isArray(state.mysteryEvidence) ? state.mysteryEvidence : [];
  state.audit = Array.isArray(state.audit) ? state.audit : [];
  return state;
}

function clean(value: unknown, max = 1000) { return redactSensitiveText(String(value ?? "").replace(/\s+/g, " ").trim()).slice(0, max); }
function url(value: unknown, required = true) {
  const raw = clean(value, 1000);
  if (!raw && !required) return "";
  let parsed: URL;
  try { parsed = new URL(raw); } catch { throw new Error("Use a valid public HTTPS source URL."); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("Sources must use public HTTPS URLs without credentials.");
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan") || host === "0.0.0.0" || host === "::1") throw new Error("Private or local source URLs are not allowed.");
  if (/^(10|127|192\.168|169\.254)\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host) || /^198\.(18|19)\./.test(host) || /^(fc|fd|fe80):/i.test(host)) throw new Error("Private, link-local, or relay-network source URLs are not allowed.");
  return parsed.toString();
}
function bool(value: unknown) { return value === true; }
function now() { return new Date().toISOString(); }
function id(prefix: string) { return `${prefix}-${randomUUID()}`; }
function tenantFor(session: AccessSession, requested?: unknown) {
  if (session.canManageAccess || session.isSuperAdmin) return clean(requested, 80) || "phantomforce-owner";
  return clean(session.orgId || session.clientId, 80) || `client-${session.id}`;
}
async function load(): Promise<Store> {
  try { const parsed = JSON.parse(await readFile(STORE_PATH, "utf8")) as Store; return parsed?.version === 1 && parsed.tenants ? parsed : { version: 1, tenants: {} }; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, tenants: {} }; throw error; }
}
async function save(store: Store) {
  writeChain = writeChain.then(async () => { await mkdir(dirname(STORE_PATH), { recursive: true }); const temp = `${STORE_PATH}.${process.pid}.tmp`; await writeFile(temp, JSON.stringify(store, null, 2), "utf8"); await rename(temp, STORE_PATH); });
  await writeChain;
}
async function mutate<T>(tenantId: string, fn: (state: TenantState, store: Store) => T | Promise<T>) {
  const store = await load(); const state = normalizeTenantState(store.tenants[tenantId] ?? freshTenant()); store.tenants[tenantId] = state;
  try { const result = await fn(state, store); await save(store); return result; }
  catch (error) { await save(store); throw error; }
}
function publicAudit(state: TenantState, tenantId: string, actorId: string, action: string, result: "allowed" | "blocked", reason: string, alternative = "") { state.audit.unshift({ id: id("audit"), tenantId, actorId, action: clean(action, 300), result, reason: clean(reason, 500), alternative: clean(alternative, 500), createdAt: now() }); state.audit = state.audit.slice(0, 300); }
function policy(text: string) {
  const hit = PROHIBITED_PATTERNS.find((item) => item.pattern.test(text));
  return hit ? { allowed: false as const, boundary: hit.boundary, alternative: hit.alternative } : { allowed: true as const, boundary: "Public-source competitive research", alternative: "" };
}
function requireAllowed(state: TenantState, tenantId: string, session: AccessSession, action: string, text: string) {
  const decision = policy(text);
  if (!decision.allowed) { publicAudit(state, tenantId, session.id, action, "blocked", decision.boundary, decision.alternative); throw new Error(`${decision.boundary} is prohibited. ${decision.alternative}`); }
  return decision;
}
function competitor(state: TenantState, tenantId: string, competitorId: unknown) { const item = state.competitors.find((entry) => entry.id === clean(competitorId, 180) && entry.tenantId === tenantId); if (!item) throw new Error("Competitor record was not found in this workspace."); return item; }
function confidence(score: number): Confidence { return score >= 0.78 ? "high" : score >= 0.5 ? "medium" : "low"; }
function words(value: string) { return new Set(value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((word) => word.length > 3)); }
function similarity(a: string, b: string) { const aa = words(a); const bb = words(b); if (!aa.size || !bb.size) return 0; const shared = [...aa].filter((word) => bb.has(word)).length; return Math.round((shared / new Set([...aa, ...bb]).size) * 100); }

const RULES: Array<{ types: SignalType[]; area: InferenceArea; estimate: string; alternatives: string[]; verify: string[]; responses: string[] }> = [
  { types: ["pricing_page", "landing_page", "public_ad"], area: "upcoming_offer", estimate: "Offer packaging or pricing emphasis may be changing.", alternatives: ["Routine conversion testing", "A short seasonal campaign"], verify: ["Watch the pricing and campaign URLs for another revision", "Compare the next public newsletter and ad cycle"], responses: ["Clarify your own package and total value", "Prepare an accurate comparison page", "Test a simpler onboarding offer"] },
  { types: ["job_listing", "employee_role", "partnership"], area: "investment", estimate: "This capability area may be receiving increased investment.", alternatives: ["Backfilling normal turnover", "A partner-led experiment rather than a permanent strategy"], verify: ["Track whether related roles remain open", "Look for matching release notes or public announcements"], responses: ["Strengthen adjacent proof", "Interview current customers about the capability", "Prioritize one defensible differentiator"] },
  { types: ["public_review", "customer_complaint", "community_discussion"], area: "customer_pain", estimate: "A recurring customer-experience gap may be creating switching demand.", alternatives: ["A vocal minority", "Old feedback that no longer reflects the product"], verify: ["Aggregate themes across multiple recent sources", "Check whether the competitor has publicly addressed the issue"], responses: ["Publish an educational FAQ", "Improve onboarding or support around the gap", "Use customer language without targeting individuals"] },
  { types: ["website_copy", "newsletter", "event_appearance"], area: "positioning", estimate: "Public positioning may be shifting toward a different audience or outcome.", alternatives: ["A channel-specific message", "An event-only theme"], verify: ["Compare homepage, newsletter, and event language over time", "Watch for new customer proof matching the message"], responses: ["Sharpen your own ideal-customer language", "Build an original counter-position", "Test a focused landing page"] },
  { types: ["social_cadence", "content_format", "public_ad", "ad_volume"], area: "content_priority", estimate: "This content format or campaign theme may be a near-term priority.", alternatives: ["A temporary production batch", "Paid amplification of existing evergreen content"], verify: ["Measure whether cadence persists for two cycles", "Compare organic and paid topic repetition"], responses: ["Answer ignored audience questions", "Counter-program with a distinct format", "Create a deeper original resource"] },
  { types: ["release_note", "documentation", "app_store_note", "technology_stack"], area: "market_direction", estimate: "Product investment may be moving toward the capabilities reflected in these public updates.", alternatives: ["Maintenance or compliance work", "A limited beta rather than a strategic shift"], verify: ["Watch subsequent documentation and release notes", "Look for matching sales language and job roles"], responses: ["Assess customer demand before matching", "Emphasize a differentiated workflow", "Prepare migration guidance where accurate"] },
  { types: ["public_review", "customer_complaint", "policy_change", "service_outage"] as SignalType[], area: "operational_weakness", estimate: "Public evidence may indicate an operational or support weakness.", alternatives: ["A resolved incident", "An isolated account-specific problem"], verify: ["Confirm recency and frequency", "Check the public status or policy record"], responses: ["Improve your service-level communication", "Publish transparent support expectations", "Build a safer switching guide"] },
];

function buildInferences(tenantId: string, state: TenantState, competitorId: string) {
  const signals = state.signals.filter((entry) => entry.competitorId === competitorId).sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  return RULES.map((rule) => {
    const matched = signals.filter((entry) => rule.types.includes(entry.type)).slice(0, 8);
    if (!matched.length) return null;
    const diversity = new Set(matched.map((entry) => entry.type)).size;
    const score = Math.min(0.92, 0.32 + matched.length * 0.08 + diversity * 0.09);
    return { id: id("inference"), tenantId, competitorId, area: rule.area, estimate: rule.estimate, status: "estimate" as const, supportingSignalIds: matched.map((entry) => entry.id), supportingSignals: matched.map((entry) => ({ title: entry.title, date: entry.observedAt, source: entry.sourceUrl })), alternativeExplanations: rule.alternatives, confidence: confidence(score), confidenceScore: Number(score.toFixed(2)), recommendedVerification: rule.verify, safeResponseOptions: rule.responses, createdAt: now() };
  }).filter(Boolean) as InferenceRecord[];
}

const GROWTH_SIGNALS: SignalType[] = ["pricing_page", "landing_page", "public_ad", "ad_volume", "social_cadence", "content_format", "release_note", "documentation", "app_store_note", "job_listing", "employee_role", "partnership", "event_appearance", "newsletter", "search_pattern"];
const WEAKNESS_SIGNALS: SignalType[] = ["public_review", "customer_complaint", "community_discussion"];
const SOURCE_LANES = [
  ["local", "Local competitors", "map pack, local rankings, service area directories"],
  ["reviews", "Review pressure", "public reviews, complaints, objections, support gaps"],
  ["offers", "Offer and pricing", "pricing pages, landing pages, package changes"],
  ["ads", "Ad and content heat", "public ad volume, social cadence, content format shifts"],
  ["products", "Product sales and launches", "release notes, app updates, marketplace or product-page changes"],
  ["hiring", "Investment clues", "job listings, roles, partnerships, events"],
] as const;
const STARTER_MAP_UPDATED_AT = "2026-07-13T00:00:00.000Z";
const STARTER_COMPETITORS: StarterCompetitor[] = [
  { id: "starter-chatgpt", name: "ChatGPT", website: "https://chatgpt.com/", category: "AI assistant", score: 72, watch: ["agent workflows", "search answers", "work apps"], notes: "Starter AI assistant competitor for PhantomForce. Add public sources before treating this as live market evidence." },
  { id: "starter-claude", name: "Claude", website: "https://www.anthropic.com/claude", category: "AI assistant", score: 70, watch: ["projects", "coding", "enterprise safety"], notes: "Starter AI assistant competitor for PhantomForce. Add public sources before treating this as live market evidence." },
  { id: "starter-perplexity", name: "Perplexity", website: "https://www.perplexity.ai/", category: "AI answer engine", score: 65, watch: ["answer search", "source citations", "research workflows"], notes: "Starter AI search competitor for PhantomForce. Add public sources before treating this as live market evidence." },
  { id: "starter-gemini", name: "Gemini", website: "https://gemini.google.com/", category: "AI assistant", score: 67, watch: ["Google workspace", "mobile assistant", "research"], notes: "Starter AI assistant competitor for PhantomForce. Add public sources before treating this as live market evidence." },
  { id: "starter-hubspot", name: "HubSpot", website: "https://www.hubspot.com/products/customer-platform", category: "CRM and customer platform", score: 78, watch: ["CRM", "marketing hubs", "AI customer platform"], notes: "Starter CRM and growth-ops competitor for PhantomForce. Add public sources before treating this as live market evidence." },
  { id: "starter-highlevel", name: "HighLevel", website: "https://www.gohighlevel.com/", category: "Agency operating system", score: 76, watch: ["lead capture", "follow-up automation", "agency dashboard"], notes: "Starter agency operating-system competitor for PhantomForce. Add public sources before treating this as live market evidence." },
  { id: "starter-salesforce", name: "Salesforce", website: "https://www.salesforce.com/products/what-is-customer-360/", category: "Enterprise CRM", score: 74, watch: ["Customer 360", "AI agents", "sales/service clouds"], notes: "Starter enterprise CRM competitor for PhantomForce. Add public sources before treating this as live market evidence." },
  { id: "starter-monday", name: "monday.com", website: "https://monday.com/", category: "Work management", score: 66, watch: ["work platform", "team operations", "AI agents"], notes: "Starter work-management competitor for PhantomForce. Add public sources before treating this as live market evidence." },
  { id: "starter-clickup", name: "ClickUp", website: "https://clickup.com/", category: "Work management", score: 65, watch: ["tasks", "docs", "AI work context"], notes: "Starter productivity and operations competitor for PhantomForce. Add public sources before treating this as live market evidence." },
  { id: "starter-notion", name: "Notion", website: "https://www.notion.com/", category: "Workspace and knowledge base", score: 63, watch: ["workspace memory", "docs", "custom agents"], notes: "Starter workspace and memory competitor for PhantomForce. Add public sources before treating this as live market evidence." },
  { id: "starter-airtable", name: "Airtable", website: "https://www.airtable.com/platform", category: "Business app platform", score: 62, watch: ["apps", "data workflows", "AI builders"], notes: "Starter app-platform competitor for PhantomForce. Add public sources before treating this as live market evidence." },
  { id: "starter-zapier", name: "Zapier", website: "https://zapier.com/", category: "Workflow automation", score: 64, watch: ["app automations", "AI workflows", "agents"], notes: "Starter automation competitor for PhantomForce. Add public sources before treating this as live market evidence." },
  { id: "starter-make", name: "Make", website: "https://www.make.com/en", category: "Workflow automation", score: 61, watch: ["visual automation", "AI agents", "app integrations"], notes: "Starter automation competitor for PhantomForce. Add public sources before treating this as live market evidence." },
  { id: "starter-hootsuite", name: "Hootsuite", website: "https://www.hootsuite.com/", category: "Social media management", score: 58, watch: ["scheduling", "analytics", "social listening"], notes: "Starter social operations competitor for PhantomForce. Add public sources before treating this as live market evidence." },
  { id: "starter-buffer", name: "Buffer", website: "https://buffer.com/", category: "Social media management", score: 55, watch: ["content planning", "posting", "analytics"], notes: "Starter social publishing competitor for PhantomForce. Add public sources before treating this as live market evidence." },
  { id: "starter-canva", name: "Canva", website: "https://www.canva.com/", category: "Creative production", score: 60, watch: ["AI design", "brand kits", "social creatives"], notes: "Starter creative-production competitor for PhantomForce. Add public sources before treating this as live market evidence." },
];

function daysAgo(value: string) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? (Date.now() - time) / 86400000 : 9999;
}
function recentSignal(signal: SignalRecord, days = 45) { return daysAgo(signal.observedAt) <= days; }
function symbolFor(name: string) {
  const letters = clean(name, 80).split(/\s+/).filter(Boolean).map((part) => part[0]?.toUpperCase()).join("");
  return (letters || "CI").slice(0, 3);
}
function domainFor(website: string) {
  try { return new URL(website).hostname.replace(/^www\./u, ""); } catch { return "unknown"; }
}
function starterById(idValue: string) { return STARTER_COMPETITORS.find((item) => item.id === idValue); }
function trackedById(state: TenantState, idValue: string) { return state.competitors.find((item) => item.id === idValue); }
function websiteForBoardItem(state: TenantState, item: MarketBoardItem) {
  return trackedById(state, item.competitorId)?.website || starterById(item.competitorId)?.website || `https://${item.domain}/`;
}
function sourceTargetsForBoardItem(state: TenantState, item: MarketBoardItem) {
  const website = websiteForBoardItem(state, item);
  const domain = domainFor(website);
  const targets = [
    { label: "Official site", url: website, reason: "positioning, offer, proof, and product language" },
    { label: "Public search", url: `https://www.google.com/search?q=${encodeURIComponent(`${item.name} pricing reviews alternatives`)}`, reason: "public pricing, reviews, comparisons, and customer objections" },
  ];
  if (/hubspot|salesforce|highlevel|monday|clickup|notion|airtable|zapier|make/i.test(`${item.name} ${domain}`)) targets.push({ label: "Product updates", url: website, reason: "release notes, feature direction, integration changes" });
  if (/hootsuite|buffer|canva|chatgpt|claude|gemini|perplexity/i.test(`${item.name} ${domain}`)) targets.push({ label: "Content signals", url: website, reason: "launch messaging, format shifts, creator or AI workflow claims" });
  return targets.slice(0, 3);
}
function laneCandidates(laneId: string) {
  const ids: Record<string, string[]> = {
    local: ["starter-highlevel", "starter-hubspot", "starter-salesforce", "starter-monday"],
    reviews: ["starter-highlevel", "starter-hootsuite", "starter-buffer", "starter-canva"],
    offers: ["starter-hubspot", "starter-highlevel", "starter-salesforce", "starter-clickup"],
    ads: ["starter-hootsuite", "starter-buffer", "starter-canva", "starter-chatgpt"],
    products: ["starter-chatgpt", "starter-claude", "starter-gemini", "starter-notion", "starter-airtable"],
    hiring: ["starter-salesforce", "starter-hubspot", "starter-monday", "starter-zapier"],
  };
  return (ids[laneId] || []).map((entry) => starterById(entry)?.name).filter(Boolean) as string[];
}
function laneSourceTargets(laneId: string) {
  const targets: Record<string, string[]> = {
    local: ["Google/Bing public results", "service-area directories", "category comparison pages"],
    reviews: ["public reviews", "support forums", "community complaints"],
    offers: ["official pricing pages", "landing pages", "package comparison pages"],
    ads: ["public ad libraries", "social feeds", "content cadence"],
    products: ["release notes", "docs", "app-store/update pages"],
    hiring: ["job boards", "partnership pages", "event pages"],
  };
  return targets[laneId] || ["official public pages", "public search results"];
}
function laneNextAction(laneId: string) {
  const actions: Record<string, string> = {
    local: "Rank local/service competitors by proof, offer clarity, and follow-up workflow.",
    reviews: "Convert repeated objections into service, onboarding, and FAQ improvements.",
    offers: "Compare packages and build a clearer PhantomForce setup/managed-growth wedge.",
    ads: "Find format heat and create original counter-programming instead of copycat posts.",
    products: "Track capability launches and decide what PhantomForce should beat, ignore, or explain.",
    hiring: "Use roles and partnerships as investment clues for what competitors are prioritizing.",
  };
  return actions[laneId] || "Turn the public source pattern into a sourced comparison and response move.";
}
function phantomAngleFor(item: MarketBoardItem) {
  const haystack = `${item.name} ${item.category} ${item.watch.join(" ")}`.toLowerCase();
  if (/crm|agency|customer|salesforce|hubspot|highlevel/.test(haystack)) return "Beat them with faster client onboarding, clearer owner setup, lead/follow-up operations, and done-with-you growth execution.";
  if (/social|content|creative|canva|hootsuite|buffer/.test(haystack)) return "Beat them by connecting content to approvals, assets, reporting, and client operations instead of treating posts as the whole business.";
  if (/workflow|automation|zapier|make|airtable/.test(haystack)) return "Beat them by turning automations into business outcomes with memory, approvals, and visible client setup state.";
  if (/ai|assistant|chatgpt|claude|gemini|perplexity/.test(haystack)) return "Beat them with private business memory, client setup templates, managed growth ops, and action surfaces built for Jordan's workflow.";
  return "Beat them with a tighter setup machine, proof-backed offers, and safer managed execution.";
}
function threatLevel(score: number): "high" | "medium" | "watch" { return score >= 72 ? "high" : score >= 62 ? "medium" : "watch"; }
function clusterValue(board: MarketBoardItem[], pattern: RegExp) {
  const matches = board.filter((item) => pattern.test(`${item.name} ${item.category} ${item.watch.join(" ")}`));
  if (!matches.length) return 0;
  return Math.round(matches.reduce((sum, item) => sum + item.score, 0) / matches.length);
}
function buildAutoScoutReport(state: TenantState, marketBoard: MarketBoardItem[], marketBoardMode: "live" | "mixed" | "starter"): AutoScoutReport {
  const tracked = marketBoard.filter((item) => item.sourceState === "tracked").length;
  const starter = marketBoard.filter((item) => item.sourceState === "starter").length;
  const liveSignals = state.signals.length;
  const confidence: AutoScoutReport["competitorSet"]["confidence"] = liveSignals >= 6 ? "high" : liveSignals >= 3 ? "medium" : liveSignals ? "low" : "starter";
  const comparisons = marketBoard.slice(0, 8).map((item) => ({
    competitorId: item.competitorId,
    name: item.name,
    category: item.category,
    domain: item.domain,
    score: item.score,
    sourceState: item.sourceState === "tracked" ? "tracked" as const : "starter" as const,
    threatLevel: threatLevel(item.score),
    phantomAngle: phantomAngleFor(item),
    watch: item.watch,
    sourceTargets: sourceTargetsForBoardItem(state, item),
  }));
  const charts: AutoScoutReport["charts"] = [
    { label: "AI assistants", value: clusterValue(marketBoard, /ai|assistant|chatgpt|claude|gemini|perplexity/i), tone: "hot" as const, detail: "Compete on private business memory plus action workflows, not generic chat." },
    { label: "CRM / agency ops", value: clusterValue(marketBoard, /crm|agency|customer|salesforce|hubspot|highlevel/i), tone: "good" as const, detail: "Client setup, lead flow, follow-up, approvals, and reporting are the wedge." },
    { label: "Automation tools", value: clusterValue(marketBoard, /workflow|automation|zapier|make|airtable/i), tone: "warn" as const, detail: "Turn triggers into outcome-based playbooks with owner approval gates." },
    { label: "Content ops", value: clusterValue(marketBoard, /social|content|creative|canva|hootsuite|buffer/i), tone: "neutral" as const, detail: "Tie content to managed growth ops, not just scheduling." },
  ].filter((item) => item.value > 0);
  const opportunities: AutoScoutReport["opportunities"] = [
    { title: "Lead with the Client Setup Machine", detail: "Most starter competitors own one slice: chat, CRM, automation, or social. PhantomForce can win by packaging the whole setup path.", action: "Turn onboarding, module selection, offers, lead sources, approvals, and reporting into the first sales demo.", impact: 94, tone: "good" },
    { title: "Make comparisons visual and sourced", detail: "Use official public pages and dated sources to show where PhantomForce is different without claiming private knowledge.", action: "Generate comparison cards for AI assistants, CRM platforms, automation tools, and social suites.", impact: 86, tone: "warn" },
    { title: "Turn weaknesses into managed services", detail: "When public reviews show confusion, setup burden, or follow-up gaps, translate that into service packaging.", action: "Create a Business Cleanup Checklist and Managed Growth Ops package for each customer type.", impact: 82, tone: "hot" },
    { title: "Keep the system private and school/work safe", detail: "Do not chase public scraping or invasive targeting. Win with lawful public sources, client-owned data, and approval-safe execution.", action: "Separate public market radar from private client memory and keep every external action gated.", impact: 78, tone: "neutral" },
  ];
  const mode = marketBoardMode === "live" ? "tracked_public_signals" : marketBoardMode === "mixed" ? "mixed_public_map" : "starter_public_map";
  return {
    generatedAt: now(),
    mode,
    headline: liveSignals
      ? "Phantom is comparing tracked competitors with live public signals."
      : "Phantom is auto-comparing the starter market map and showing exactly where to compete first.",
    sourceNote: liveSignals
      ? "Scores use tracked competitors plus dated public signals saved in this workspace."
      : "Starter scores use PhantomForce's public category map and official source targets. Add dated public sources before treating movement as live evidence.",
    competitorSet: { tracked, starter, totalCompared: marketBoard.length, liveSignals, confidence },
    charts,
    comparisons,
    opportunities,
  };
}
function contextMissing(context: ScoutContext | null) {
  const missing: string[] = [];
  if (!context?.businessName) missing.push("business name");
  if (!context?.offer) missing.push("offer");
  if (!context?.location) missing.push("location or service area");
  if (!context?.audience) missing.push("audience");
  return missing;
}
function contextReady(context: ScoutContext | null) {
  return Boolean(context?.offer && (context.location || context.audience || context.businessName));
}
function scoutQuery(context: ScoutContext | null, lane: typeof SOURCE_LANES[number]) {
  const offer = context?.offer || "[offer]";
  const location = context?.location || "[location]";
  const audience = context?.audience || "[audience]";
  const base = lane[0] === "local" ? `${offer} ${location} competitors`
    : lane[0] === "reviews" ? `${offer} ${location} reviews complaints`
      : lane[0] === "offers" ? `${offer} pricing packages ${location}`
        : lane[0] === "ads" ? `${offer} ${audience} ads content examples`
          : lane[0] === "products" ? `${offer} product launch sales trends ${location}`
            : `${offer} hiring partnerships ${location}`;
  return base.replace(/\s+/g, " ").trim();
}
function buildScout(state: TenantState) {
  const context = state.settings.scoutContext;
  const missing = contextMissing(context);
  const ready = contextReady(context);
  const signals = state.signals.length;
  const competitors = state.competitors.length;
  const status = !ready ? "needs_context" : competitors || signals ? "watching" : "ready_to_discover";
  const lanes: ScoutLane[] = SOURCE_LANES.map((lane) => ({
    id: lane[0],
    label: lane[1],
    status: !ready ? "needs_context" : signals ? "watching" : "active",
    query: scoutQuery(context, lane),
    why: lane[2],
    sourceTargets: laneSourceTargets(lane[0]),
    candidateCompetitors: laneCandidates(lane[0]),
    nextAction: laneNextAction(lane[0]),
  }));
  return {
    enabled: state.settings.scoutEnabled,
    status,
    context,
    missing,
    lastRunAt: state.settings.lastScoutRunAt,
    briefing: !ready
      ? "Phantom needs the business, offer, audience, and service area before it can build a useful competitor map."
      : competitors
        ? "Phantom is ranking known competitors by public-signal momentum and turning gaps into safe response ideas."
        : "Phantom is already comparing the starter market map, source targets, and response opportunities. Add dated public sources when you want live movement labels.",
    lanes,
  };
}
function boardTip(momentum: MarketBoardItem["momentum"], positives: number, weaknesses: number, opportunities: number) {
  if (momentum === "unwatched") return "Scout their homepage, reviews, pricing, ads, and jobs before making a move.";
  if (momentum === "vulnerable") return "They look exposed. Build proof around the customer pain and verify recency before publishing.";
  if (momentum === "gaining") return "They have heat. Watch the offer and prepare a differentiated comparison or category guide.";
  if (momentum === "mixed") return "Mixed signals. Separate what they are pushing from what customers are resisting.";
  if (opportunities > 0) return "There are response options ready. Turn the best one into a tracked campaign.";
  return positives || weaknesses ? "Keep collecting public sources until the pattern is strong enough to act on." : "No recent signal yet. Add a public source to start live ranking.";
}
function buildMarketBoard(state: TenantState): MarketBoardItem[] {
  return state.competitors.map((item) => {
    const signals = state.signals.filter((entry) => entry.competitorId === item.id);
    const recent = signals.filter((entry) => recentSignal(entry));
    const inferences = state.inferences.filter((entry) => entry.competitorId === item.id);
    const themes = state.audienceThemes.filter((entry) => entry.competitorId === item.id);
    const opportunities = state.opportunities.filter((entry) => entry.competitorId === item.id).length;
    const growth = recent.filter((entry) => GROWTH_SIGNALS.includes(entry.type)).length + inferences.filter((entry) => ["upcoming_offer", "investment", "market_direction", "content_priority", "positioning"].includes(entry.area)).length;
    const weakness = recent.filter((entry) => WEAKNESS_SIGNALS.includes(entry.type)).length + inferences.filter((entry) => ["customer_pain", "operational_weakness"].includes(entry.area)).length + themes.length;
    const score = Math.max(5, Math.min(95, Math.round(48 + growth * 7 + opportunities * 5 - weakness * 6 + Math.min(recent.length, 8) * 2)));
    const momentum: MarketBoardItem["momentum"] = !signals.length ? "unwatched" : growth >= weakness + 2 ? "gaining" : weakness >= growth + 1 ? "vulnerable" : growth && weakness ? "mixed" : recent.length ? "quiet" : "quiet";
    const confidence: MarketBoardItem["confidence"] = signals.length >= 6 ? "high" : signals.length >= 3 ? "medium" : signals.length ? "low" : "none";
    const newest = signals.map((entry) => entry.observedAt).sort().at(-1) || null;
    return {
      competitorId: item.id,
      name: item.name,
      symbol: symbolFor(item.name),
      category: item.category || "Competitor",
      domain: domainFor(item.website),
      score,
      momentum,
      confidence,
      signalCount: signals.length,
      recentSignals: recent.length,
      lastSignalAt: newest,
      tip: boardTip(momentum, growth, weakness, opportunities),
      sourceState: "tracked" as const,
      watch: [
        growth ? "offer heat" : "offer baseline",
        weakness ? "customer pain" : "review scan",
        opportunities ? "response ready" : "opportunity scan",
      ],
    };
  }).sort((a, b) => b.score - a.score || b.recentSignals - a.recentSignals || a.name.localeCompare(b.name));
}
function starterCompetitors(tenantId: string): CompetitorRecord[] {
  return STARTER_COMPETITORS.map((item) => ({ id: item.id, tenantId, name: item.name, website: item.website, category: item.category, notes: item.notes, active: true, createdAt: STARTER_MAP_UPDATED_AT, updatedAt: STARTER_MAP_UPDATED_AT }));
}
function buildStarterMarketBoard(tenantId: string, state: TenantState): MarketBoardItem[] {
  const trackedDomains = new Set(state.competitors.map((item) => domainFor(item.website).toLowerCase()));
  const trackedNames = new Set(state.competitors.map((item) => item.name.toLowerCase()));
  return STARTER_COMPETITORS
    .filter((item) => !trackedDomains.has(domainFor(item.website).toLowerCase()) && !trackedNames.has(item.name.toLowerCase()))
    .map((item) => ({
      competitorId: item.id,
      name: item.name,
      symbol: symbolFor(item.name),
      category: item.category,
      domain: domainFor(item.website),
      score: item.score,
      momentum: "unwatched" as const,
      confidence: "none" as const,
      signalCount: 0,
      recentSignals: 0,
      lastSignalAt: null,
      tip: "Starter competitor from PhantomForce's category map. Track it and add public sources before treating it as live evidence.",
      watch: item.watch,
      sourceState: "starter" as const,
    }));
}
function buildTips(state: TenantState, board: MarketBoardItem[], marketBoardMode: "live" | "mixed" | "starter") {
  const tips: Array<{ title: string; detail: string; tone: "good" | "warn" | "hot" | "neutral" }> = [];
  const scout = buildScout(state);
  if (scout.status === "needs_context") tips.push({ title: "Scout needs context", detail: "Add your offer, location, audience, and business name so Phantom can build the first watch lanes.", tone: "warn" });
  if (marketBoardMode === "starter") tips.push({ title: "Starter map ready", detail: "Phantom is showing known AI, CRM, workflow, and social-ops competitors. Track the ones that matter and add public sources for live ranking.", tone: "good" });
  const vulnerable = board.find((item) => item.momentum === "vulnerable");
  if (vulnerable) tips.push({ title: `${vulnerable.name} looks exposed`, detail: vulnerable.tip, tone: "hot" });
  const gaining = board.find((item) => item.momentum === "gaining");
  if (gaining) tips.push({ title: `${gaining.name} has heat`, detail: gaining.tip, tone: "good" });
  if (!board.length && scout.status !== "needs_context") tips.push({ title: "Run the scout now", detail: "Use a public source to turn the category map into source-backed competitor rankings.", tone: "neutral" });
  if (!tips.length) tips.push({ title: "Keep the board sourced", detail: "Add recent public signals and Phantom will update momentum, confidence, and response options.", tone: "neutral" });
  return tips.slice(0, 4);
}

export function competitorIntelligencePolicyCheck(text: string) { return policy(clean(text, 3000)); }

export async function getCompetitorIntelligenceSnapshot(session: AccessSession, options: { tenantId?: unknown; entitled: boolean; aggressiveEntitled: boolean; competitorLimit: number; signalLimit: number }) {
  const tenantId = tenantFor(session, options.tenantId); const store = await load(); const state = normalizeTenantState(store.tenants[tenantId] ?? freshTenant());
  const trackedMarketBoard = buildMarketBoard(state);
  const starterMarketBoard = buildStarterMarketBoard(tenantId, state);
  const marketBoard = [...trackedMarketBoard, ...starterMarketBoard.slice(0, Math.max(0, 18 - trackedMarketBoard.length))];
  const marketBoardMode = trackedMarketBoard.length ? starterMarketBoard.length ? "mixed" : "live" : "starter";
  const scout = buildScout(state);
  const autoScout = buildAutoScoutReport(state, marketBoard, marketBoardMode);
  return {
    tenantId,
    access: { enabled: options.entitled, aggressiveAvailable: options.aggressiveEntitled, canManage: session.canManageAccess || session.isSuperAdmin || session.orgRole === "owner" || session.orgRole === "admin", competitorLimit: options.competitorLimit, signalLimit: options.signalLimit },
    signalTypes: SIGNAL_TYPES,
    settings: state.settings,
    scout,
    autoScout,
    marketBoardMode,
    marketBoard,
    tips: buildTips(state, marketBoard, marketBoardMode),
    competitors: state.competitors,
    starterCompetitors: starterCompetitors(tenantId).filter((item) => starterMarketBoard.some((boardItem) => boardItem.competitorId === item.id)),
    signals: state.signals,
    inferences: state.inferences,
    audienceThemes: state.audienceThemes,
    creativeAnalyses: state.creativeAnalyses,
    interceptions: state.interceptions,
    opportunities: state.opportunities,
    mysteryEvidence: state.mysteryEvidence,
    audit: state.audit.slice(0, 100),
    metrics: {
      competitors: state.competitors.length,
      starterCompetitors: starterMarketBoard.length,
      marketMap: marketBoard.length,
      signals: state.signals.length,
      inferences: state.inferences.length,
      highConfidence: state.inferences.filter((entry) => entry.confidence === "high").length,
      audienceThemes: state.audienceThemes.length,
      blockedRequests: state.audit.filter((entry) => entry.result === "blocked").length,
      marketMovers: marketBoard.filter((entry) => entry.momentum === "gaining" || entry.momentum === "vulnerable").length,
      activeScoutLanes: scout.lanes.filter((entry) => entry.status !== "needs_context").length,
    },
  };
}

export async function updateMarketScoutContext(session: AccessSession, body: Record<string, unknown>) {
  const tenantId = tenantFor(session, body.tenantId);
  return mutate(tenantId, (state) => {
    const existing = state.settings.scoutContext;
    const at = now();
    const context: ScoutContext = {
      businessName: clean(body.businessName ?? existing?.businessName, 120),
      location: clean(body.location ?? existing?.location, 180),
      offer: clean(body.offer ?? existing?.offer, 240),
      audience: clean(body.audience ?? existing?.audience, 240),
      goals: clean(body.goals ?? existing?.goals, 400),
      createdAt: existing?.createdAt || at,
      updatedAt: at,
    };
    if (!context.businessName && !context.location && !context.offer && !context.audience) throw new Error("Add your business, offer, location, or audience so Phantom can start the scout.");
    requireAllowed(state, tenantId, session, "market_scout_context", `${context.businessName} ${context.location} ${context.offer} ${context.audience} ${context.goals}`);
    state.settings.scoutContext = context;
    state.settings.scoutEnabled = true;
    state.settings.lastScoutRunAt = at;
    publicAudit(state, tenantId, session.id, "market_scout_context", "allowed", "AI market scout context saved; generated public-source watch lanes.");
    return buildScout(state);
  });
}

export async function updateAggressiveMode(session: AccessSession, body: Record<string, unknown>, access: { aggressiveEntitled: boolean }) {
  const tenantId = tenantFor(session, body.tenantId); const enabled = bool(body.enabled);
  if (!(session.canManageAccess || session.isSuperAdmin || session.orgRole === "owner" || session.orgRole === "admin")) throw new Error("Only a workspace owner or admin can change intelligence mode.");
  if (enabled && !access.aggressiveEntitled) throw new Error("Aggressive Intelligence Mode is not included in this plan.");
  return mutate(tenantId, (state) => { state.settings.aggressiveMode = enabled; state.settings.modeChangedAt = now(); publicAudit(state, tenantId, session.id, "mode_change", "allowed", enabled ? "Aggressive public-signal analysis enabled." : "Aggressive mode disabled."); return state.settings; });
}

export async function createCompetitor(session: AccessSession, body: Record<string, unknown>, limit: number) {
  const tenantId = tenantFor(session, body.tenantId);
  return mutate(tenantId, (state) => { if (state.competitors.length >= limit && !session.canManageAccess) throw new Error("This plan's competitor limit has been reached."); const name = clean(body.name, 120); if (!name) throw new Error("Competitor name is required."); const website = url(body.website); requireAllowed(state, tenantId, session, "create_competitor", `${name} ${website} ${clean(body.notes, 1000)}`); const at = now(); const item: CompetitorRecord = { id: id("competitor"), tenantId, name, website, category: clean(body.category, 100), notes: clean(body.notes, 1000), active: true, createdAt: at, updatedAt: at }; state.competitors.unshift(item); publicAudit(state, tenantId, session.id, "create_competitor", "allowed", "Public competitor profile added."); return item; });
}

export async function createSignal(session: AccessSession, body: Record<string, unknown>, limit: number) {
  const tenantId = tenantFor(session, body.tenantId);
  return mutate(tenantId, (state) => { if (state.signals.length >= limit && !session.canManageAccess) throw new Error("This plan's signal limit has been reached."); competitor(state, tenantId, body.competitorId); if (!bool(body.publicAccessConfirmed)) throw new Error("Confirm that the source is public and lawfully accessible."); const type = clean(body.type, 80) as SignalType; if (!SIGNAL_TYPES.includes(type)) throw new Error("Choose a supported public signal type."); const title = clean(body.title, 180); const summary = clean(body.summary, 1500); const sourceUrl = url(body.sourceUrl); requireAllowed(state, tenantId, session, "add_signal", `${title} ${summary} ${sourceUrl}`); if (!title || !summary) throw new Error("Signal title and summary are required."); const observed = new Date(clean(body.observedAt, 40) || Date.now()); if (Number.isNaN(observed.getTime())) throw new Error("Observed date is invalid."); const item: SignalRecord = { id: id("signal"), tenantId, competitorId: clean(body.competitorId, 180), type, title, summary, observedAt: observed.toISOString(), sourceUrl, sourceLabel: clean(body.sourceLabel, 160) || new URL(sourceUrl).hostname, publicAccessConfirmed: true, createdAt: now() }; state.signals.unshift(item); publicAudit(state, tenantId, session.id, "add_signal", "allowed", "Lawful public signal recorded with date and source."); return item; });
}

export async function fuseCompetitorSignals(session: AccessSession, body: Record<string, unknown>) {
  const tenantId = tenantFor(session, body.tenantId);
  return mutate(tenantId, (state) => { competitor(state, tenantId, body.competitorId); const built = buildInferences(tenantId, state, clean(body.competitorId, 180)); state.inferences = [...built, ...state.inferences.filter((entry) => entry.competitorId !== clean(body.competitorId, 180))].slice(0, 400); publicAudit(state, tenantId, session.id, "fuse_signals", "allowed", `${built.length} labeled estimates generated from public signals.`); return built; });
}

const GAP_OUTPUTS: Record<string, string[]> = {
  question: ["Original explainer", "FAQ addition", "Educational landing page"], complaint: ["Support improvement", "Product improvement", "Switching guide"], pricing: ["Transparent pricing page", "Package comparison", "Buying guide"], feature: ["Product discovery interview", "Original offer concept", "Roadmap evidence check"], trust: ["Proof library", "Policy explainer", "Support expectation page"], segment: ["Segment-specific resource", "Focused service package", "Original landing page"], objection: ["Objection-handling FAQ", "Sales talking points", "Comparison guide"], default: ["Original content idea", "Customer education", "Service improvement"],
};
export async function createAudienceTheme(session: AccessSession, body: Record<string, unknown>) {
  const tenantId = tenantFor(session, body.tenantId);
  return mutate(tenantId, (state) => { competitor(state, tenantId, body.competitorId); if (!bool(body.aggregated)) throw new Error("Audience-gap records must contain aggregated themes, not individual profiles."); const sourceUrls = Array.isArray(body.sourceUrls) ? body.sourceUrls.map((entry) => url(entry)).slice(0, 12) : []; if (!sourceUrls.length) throw new Error("Add at least one public source."); const theme = clean(body.theme, 700); const category = clean(body.category, 60) || "default"; requireAllowed(state, tenantId, session, "audience_gap", `${theme} ${sourceUrls.join(" ")}`); if (!theme) throw new Error("Aggregated audience theme is required."); const item: AudienceTheme = { id: id("gap"), tenantId, competitorId: clean(body.competitorId, 180), category, theme, volume: Math.max(1, Math.min(Number(body.volume) || 1, 100000)), sourceUrls, aggregated: true, opportunityType: category, opportunities: GAP_OUTPUTS[category] || GAP_OUTPUTS.default, createdAt: now() }; state.audienceThemes.unshift(item); publicAudit(state, tenantId, session.id, "audience_gap", "allowed", "Aggregated public audience theme converted into non-invasive opportunities."); return item; });
}

export async function createCreativeAnalysis(session: AccessSession, body: Record<string, unknown>) {
  const tenantId = tenantFor(session, body.tenantId);
  return mutate(tenantId, (state) => { competitor(state, tenantId, body.competitorId); const sourceUrl = url(body.sourceUrl); const sourceAbstract = clean(body.sourceAbstract, 2000); const originalResponse = clean(body.originalResponse, 3000); requireAllowed(state, tenantId, session, "creative_analysis", `${sourceAbstract} ${originalResponse}`); if (!sourceAbstract || !originalResponse) throw new Error("Add an abstract strategy description and an original response concept."); const score = similarity(sourceAbstract, originalResponse); const risk = score >= 45 ? "high" : score >= 25 ? "medium" : "low"; const warnings = risk === "high" ? ["Wording or structure is too similar.", "Change examples, sequence, visual system, proof, and CTA before production."] : risk === "medium" ? ["Differentiate the structure, evidence, and visual treatment further."] : ["Lexical overlap is low; still verify visual and campaign distinctiveness before publishing."]; const item: CreativeAnalysis = { id: id("creative"), tenantId, competitorId: clean(body.competitorId, 180), sourceUrl, hookCategory: clean(body.hookCategory, 160), emotionalTrigger: clean(body.emotionalTrigger, 160), storyStructure: clean(body.storyStructure, 500), proofMechanism: clean(body.proofMechanism, 300), pacing: clean(body.pacing, 160), contentDensity: clean(body.contentDensity, 160), visualRhythm: clean(body.visualRhythm, 240), shotDistribution: clean(body.shotDistribution, 300), ctaStructure: clean(body.ctaStructure, 300), audienceSophistication: clean(body.audienceSophistication, 160), objectionAddressed: clean(body.objectionAddressed, 300), desiredAction: clean(body.desiredAction, 240), originalResponse, similarityScore: score, similarityRisk: risk, similarityWarnings: warnings, createdAt: now() }; state.creativeAnalyses.unshift(item); publicAudit(state, tenantId, session.id, "creative_analysis", "allowed", `Abstract creative analysis saved; similarity risk ${risk}.`); return item; });
}

export async function createInterceptionPackage(session: AccessSession, body: Record<string, unknown>) {
  const tenantId = tenantFor(session, body.tenantId);
  return mutate(tenantId, (state) => { competitor(state, tenantId, body.competitorId); const sourceUrl = url(body.sourceUrl); const eventSummary = clean(body.eventSummary, 1200); const evidence = clean(body.evidence, 1600); requireAllowed(state, tenantId, session, "market_interception", `${eventSummary} ${evidence}`); if (!eventSummary || !evidence) throw new Error("Event summary and public evidence are required."); if (/traged|death|disaster|medical emergency|protected characteristic|vulnerable individual/i.test(`${eventSummary} ${evidence}`)) { publicAudit(state, tenantId, session.id, "market_interception", "blocked", "Emergency, tragedy, protected-trait, or vulnerability exploitation", "Respond only with neutral support or wait until the event is no longer sensitive."); throw new Error("Sensitive emergencies, tragedies, protected traits, and vulnerable individuals cannot be used for market interception."); } const eventType = clean(body.eventType, 100); const angle = clean(body.positioningAngle, 600); const item: InterceptionPackage = { id: id("intercept"), tenantId, competitorId: clean(body.competitorId, 180), eventType, eventSummary, sourceUrl, evidence, eventDate: new Date(clean(body.eventDate, 40) || Date.now()).toISOString(), whyItMatters: clean(body.whyItMatters, 700), responseDeadline: clean(body.responseDeadline, 120) || "Review within 48 hours", positioningAngle: angle, contentBrief: clean(body.contentBrief, 1200) || `Create an original, evidence-led response to ${eventType || "this public market event"}.`, landingPageDraft: clean(body.landingPageDraft, 1600) || `Headline: A clearer path forward\nExplain the customer problem accurately, show original proof, and offer a practical next step without attacking or imitating a competitor.`, offerOption: clean(body.offerOption, 700) || "Offer a transparent assessment or migration plan that the organization can genuinely deliver.", salesTalkingPoints: ["State the verified public change accurately.", "Lead with the customer's decision criteria.", "Use only your own proof and capabilities."], searchContent: ["Accurate comparison guide", "Alternative and migration guide", "Category education FAQ"], risks: ["Facts may change; re-check the source before publishing.", "Avoid implied affiliation, private knowledge, or unsupported superiority."], requiredApprovals: ["Fact check", "Brand/legal review", "Offer delivery confirmation", "Final publication approval"], measurementPlan: ["Qualified comparison-page visits", "Conversion to consultation or trial", "Sales objections observed", "Support and sentiment quality"], createdAt: now() }; state.interceptions.unshift(item); publicAudit(state, tenantId, session.id, "market_interception", "allowed", "Bounded response package prepared; no publishing or contact occurred."); return item; });
}

export async function createResearchOpportunity(session: AccessSession, body: Record<string, unknown>) {
  const tenantId = tenantFor(session, body.tenantId);
  return mutate(tenantId, (state) => { competitor(state, tenantId, body.competitorId); const kind = ["search", "offer", "timing"].includes(clean(body.kind, 30)) ? clean(body.kind, 30) as "search" | "offer" | "timing" : "search"; const title = clean(body.title, 200); const insight = clean(body.insight, 1500); const sourceUrl = url(body.sourceUrl); requireAllowed(state, tenantId, session, `${kind}_opportunity`, `${title} ${insight}`); if (!title || !insight) throw new Error("Opportunity title and public insight are required."); const recs = kind === "search" ? ["Create accurate category education", "Build an original comparison or switching guide", "Answer the long-tail question directly"] : kind === "offer" ? ["Rebundle around a clearer outcome", "Improve onboarding or support", "Use only deliverable guarantees and proof"] : ["Validate seasonality across more than one cycle", "Launch before the noise or deliberately counter-program", "Set a measurement window and stop rule"]; const item: ResearchOpportunity = { id: id("opportunity"), tenantId, competitorId: clean(body.competitorId, 180), kind, title, sourceUrl, insight, recommendations: recs, accuracyNotes: ["Source is public and dated.", "No affiliation or superiority is implied.", "Verify demand and delivery capability before acting."], createdAt: now() }; state.opportunities.unshift(item); publicAudit(state, tenantId, session.id, `${kind}_opportunity`, "allowed", "Original, non-defamatory opportunity prepared."); return item; });
}

export async function createMysteryEvidence(session: AccessSession, body: Record<string, unknown>) {
  const tenantId = tenantFor(session, body.tenantId);
  return mutate(tenantId, (state) => { competitor(state, tenantId, body.competitorId); if (!bool(body.legitimatelyObtained) || !bool(body.noDeceptionConfirmed)) throw new Error("Confirm lawful acquisition and no deception, impersonation, restricted recording, or confidentiality breach."); const observations = clean(body.observations, 3000); const sourceReference = clean(body.sourceReference, 1000); requireAllowed(state, tenantId, session, "mystery_evidence", `${observations} ${sourceReference}`); if (!observations) throw new Error("Customer-experience observations are required."); const item: MysteryEvidence = { id: id("evidence"), tenantId, competitorId: clean(body.competitorId, 180), evidenceType: clean(body.evidenceType, 80), title: clean(body.title, 180), acquiredAt: new Date(clean(body.acquiredAt, 40) || Date.now()).toISOString(), observations, sourceReference, legitimatelyObtained: true, noDeceptionConfirmed: true, createdAt: now() }; state.mysteryEvidence.unshift(item); publicAudit(state, tenantId, session.id, "mystery_evidence", "allowed", "Authorized customer-experience evidence recorded."); return item; });
}

export async function auditCompetitorIntelligenceRequest(session: AccessSession, body: Record<string, unknown>) {
  const tenantId = tenantFor(session, body.tenantId); const action = clean(body.action, 300); const decision = policy(action);
  return mutate(tenantId, (state) => { publicAudit(state, tenantId, session.id, "policy_check", decision.allowed ? "allowed" : "blocked", decision.boundary, decision.alternative); return decision; });
}

export async function getCompetitorIntelligenceStoreStatus() { try { const file = await stat(STORE_PATH); return { path: STORE_PATH, exists: true, bytes: file.size }; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { path: STORE_PATH, exists: false, bytes: 0 }; throw error; } }
