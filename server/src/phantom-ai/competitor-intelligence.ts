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

export type BusinessProfile = {
  tenantId: string; businessName: string; category: string; offering: string; audience: string; geography: string;
  differentiators: string[]; keywords: string[]; positioning: string; autoSeeded: boolean; createdAt: string; updatedAt: string;
};
export type DiscoveryLead = { archetype: string; description: string; whereToFind: string[]; exampleQueries: string[]; signalsToWatch: SignalType[] };
export type DiscoveryRun = {
  id: string; tenantId: string; createdAt: string; basis: string; segment: string; leads: DiscoveryLead[];
  searchQueries: string[]; directories: string[]; webDiscovery: { connected: boolean; provider: string; detail: string }; disclaimer: string;
};
export type DossierSource = { source: string; url: string; whatItReveals: string; signalType: SignalType; questions: string[] };
export type CompetitorDossier = {
  id: string; tenantId: string; competitorId: string; competitorName: string; createdAt: string; focus: string;
  sources: DossierSource[]; priorityChecklist: string[]; hypothesisPrompts: string[]; webDiscovery: { connected: boolean; provider: string; detail: string }; disclaimer: string;
};

type TenantState = {
  settings: { aggressiveMode: boolean; modeChangedAt: string | null; publicSourcesOnly: true; individualTargeting: false; externalActions: false };
  businessProfile: BusinessProfile | null; discoveryRuns: DiscoveryRun[]; dossiers: CompetitorDossier[];
  competitors: CompetitorRecord[]; signals: SignalRecord[]; inferences: InferenceRecord[]; audienceThemes: AudienceTheme[];
  creativeAnalyses: CreativeAnalysis[]; interceptions: InterceptionPackage[]; opportunities: ResearchOpportunity[];
  mysteryEvidence: MysteryEvidence[]; audit: AuditRecord[];
};
type Store = { version: 1; tenants: Record<string, TenantState> };
const freshTenant = (): TenantState => ({ settings: { aggressiveMode: false, modeChangedAt: null, publicSourcesOnly: true, individualTargeting: false, externalActions: false }, businessProfile: null, discoveryRuns: [], dossiers: [], competitors: [], signals: [], inferences: [], audienceThemes: [], creativeAnalyses: [], interceptions: [], opportunities: [], mysteryEvidence: [], audit: [] });
let writeChain = Promise.resolve();

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
  const store = await load(); const state = store.tenants[tenantId] ?? freshTenant(); store.tenants[tenantId] = state;
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

export function competitorIntelligencePolicyCheck(text: string) { return policy(clean(text, 3000)); }

export async function getCompetitorIntelligenceSnapshot(session: AccessSession, options: { tenantId?: unknown; entitled: boolean; aggressiveEntitled: boolean; competitorLimit: number; signalLimit: number }) {
  const tenantId = tenantFor(session, options.tenantId); const store = await load(); const state = store.tenants[tenantId] ?? freshTenant();
  return { tenantId, access: { enabled: options.entitled, aggressiveAvailable: options.aggressiveEntitled, canManage: session.canManageAccess || session.isSuperAdmin || session.orgRole === "owner" || session.orgRole === "admin", competitorLimit: options.competitorLimit, signalLimit: options.signalLimit }, signalTypes: SIGNAL_TYPES, settings: state.settings, businessProfile: state.businessProfile, discoveryRuns: state.discoveryRuns.slice(0, 5), dossiers: state.dossiers, webDiscovery: getWebDiscoveryStatus(), competitors: state.competitors, signals: state.signals, inferences: state.inferences, audienceThemes: state.audienceThemes, creativeAnalyses: state.creativeAnalyses, interceptions: state.interceptions, opportunities: state.opportunities, mysteryEvidence: state.mysteryEvidence, audit: state.audit.slice(0, 100), metrics: { competitors: state.competitors.length, signals: state.signals.length, inferences: state.inferences.length, highConfidence: state.inferences.filter((entry) => entry.confidence === "high").length, audienceThemes: state.audienceThemes.length, blockedRequests: state.audit.filter((entry) => entry.result === "blocked").length } };
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

/* ---------------------------------------------------------------------------
   Business context + competitor discovery + deep-dive dossiers.
   Everything below turns what Phantom already knows about the business into
   an honest, actionable market board. Without a connected search provider it
   still produces useful candidate lanes, searches, source checklists, and
   hypotheses to verify. It never presents suggested leads as verified facts,
   never scrapes, and never contacts anyone. Automatic web collection stays
   behind an explicit, provider-neutral adapter that reports "not connected"
   until a key exists. */

const SEARCH_PROVIDER_ENV = ["PHANTOM_SEARCH_API_KEY", "SERPAPI_API_KEY", "SERPER_API_KEY", "BING_SEARCH_KEY", "TAVILY_API_KEY", "BRAVE_SEARCH_KEY"] as const;
export function getWebDiscoveryStatus(env: NodeJS.ProcessEnv = process.env) {
  const key = SEARCH_PROVIDER_ENV.find((name) => (env[name] ?? "").trim());
  const provider = env.PHANTOM_SEARCH_PROVIDER?.trim() || (key ? key.replace(/_API_KEY|_KEY|_SEARCH.*/i, "").toLowerCase() : "");
  const connected = Boolean(key) && env.PHANTOM_WEB_DISCOVERY_ENABLED !== "false";
  return {
    connected,
    provider: provider || "none",
    detail: connected
      ? `Automatic public-web discovery is connected through ${provider || "the configured search provider"}. Phantom can run the generated queries and pull public results for you.`
      : "Automatic web discovery is not connected yet, so Phantom generates candidate lanes, exact public searches, and source checklists immediately. Add a search-provider key later to turn candidates into verified public results automatically.",
  };
}

type BusinessSegment = "local_service" | "ecommerce" | "saas_software" | "agency_studio" | "creator_media" | "hospitality_food" | "professional_practice" | "general";
const SEGMENT_KEYWORDS: Array<{ segment: BusinessSegment; label: string; match: RegExp }> = [
  { segment: "local_service", label: "Local service business", match: /\b(local|plumb|hvac|electric|clean|landscap|salon|barber|spa|dentist|clinic|repair|contractor|roof|auto|detail|photograph|studio|gym|fitness|realtor|real estate|mobile)\b/i },
  { segment: "ecommerce", label: "E-commerce / product brand", match: /\b(shop|store|ecommerce|e-commerce|apparel|clothing|merch|product|retail|dtc|brand|goods|supplement|beauty|cosmetic|jewel|print on demand|dropship)\b/i },
  { segment: "saas_software", label: "Software / SaaS", match: /\b(saas|software|app|platform|api|tool|dashboard|automation|ai|crm|analytics|plugin|extension|developer|b2b)\b/i },
  { segment: "agency_studio", label: "Agency / studio", match: /\b(agency|studio|marketing|creative|design|consult|freelance|production|media house|services firm)\b/i },
  { segment: "creator_media", label: "Creator / media", match: /\b(creator|influencer|youtube|podcast|newsletter|course|coach|community|content|media|streamer|artist|game)\b/i },
  { segment: "hospitality_food", label: "Hospitality / food", match: /\b(restaurant|cafe|coffee|bar|food|catering|hotel|bakery|bistro|kitchen|brewery|truck)\b/i },
  { segment: "professional_practice", label: "Professional practice", match: /\b(law|legal|attorney|account|tax|financ|advisor|insurance|medical|therap|architect|engineer|notary)\b/i },
];
function classifySegment(profile: BusinessProfile): { segment: BusinessSegment; label: string } {
  const text = `${profile.category} ${profile.offering} ${profile.keywords.join(" ")} ${profile.positioning}`;
  const hit = SEGMENT_KEYWORDS.find((entry) => entry.match.test(text));
  return hit ? { segment: hit.segment, label: hit.label } : { segment: "general", label: "General business" };
}

const SEGMENT_DIRECTORIES: Record<BusinessSegment, string[]> = {
  local_service: ["Google Business Profile / Maps", "Yelp", "Nextdoor", "Angi / Thumbtack", "Local chamber & industry association listings", "Facebook local pages", "Instagram location & hashtag search"],
  ecommerce: ["Google Shopping", "Amazon / marketplace category pages", "Instagram & TikTok product tags", "Trustpilot & product review sites", "Meta Ad Library", "Reddit product/community threads", "Comparison & 'best of' roundup blogs"],
  saas_software: ["G2 & Capterra", "Product Hunt", "GitHub / npm (for dev tools)", "AlternativeTo", "Reddit & Hacker News threads", "LinkedIn company & jobs", "Public changelogs & status pages"],
  agency_studio: ["Clutch & DesignRush", "LinkedIn company & case studies", "Awwwards / Behance / Dribbble", "Industry award lists", "Local business directories", "Instagram portfolio search"],
  creator_media: ["YouTube & channel search", "Podcast directories (Apple/Spotify)", "Substack & newsletter directories", "TikTok & Instagram hashtag search", "Course platforms (Udemy/Teachable listings)", "Reddit & Discord communities"],
  hospitality_food: ["Google Maps & Yelp", "TripAdvisor", "DoorDash/Uber Eats/Grubhub listings", "OpenTable / Resy", "Instagram location & hashtag search", "Local food blogs & 'best of' lists"],
  professional_practice: ["Google Business Profile", "Avvo / Healthgrades / industry directories", "LinkedIn firm & partner pages", "Local bar/board/association listings", "Review sites (Yelp, Google reviews)", "Referral & comparison directories"],
  general: ["Google search & Maps", "LinkedIn company search", "Industry directories & associations", "Review sites (Google, Trustpilot)", "Meta Ad Library", "Instagram & TikTok hashtag search"],
};
const SEGMENT_QUERY_TEMPLATES: Record<BusinessSegment, string[]> = {
  local_service: ["{offering} in {geo}", "best {offering} near {geo}", "{offering} {geo} reviews", "top rated {category} {geo}", "affordable {offering} {geo}", "{offering} {geo} 2026"],
  ecommerce: ["best {offering} brands", "{offering} alternatives", "{offering} vs", "{offering} review reddit", "buy {offering} online", "{keyword} brand comparison"],
  saas_software: ["best {offering} software", "{offering} alternatives", "{category} tools 2026", "{offering} vs", "{keyword} platform pricing", "open source {offering}"],
  agency_studio: ["best {category} agency {geo}", "{offering} agency for {audience}", "top {category} studios", "{offering} agency pricing", "{keyword} agency case study"],
  creator_media: ["best {category} for {audience}", "{offering} alternatives", "top {keyword} creators", "{offering} vs", "{category} 2026", "free {offering}"],
  hospitality_food: ["best {offering} in {geo}", "{category} near {geo}", "{offering} {geo} reviews", "top {keyword} {geo}", "{offering} {geo} menu"],
  professional_practice: ["best {category} in {geo}", "{offering} for {audience} {geo}", "top rated {category} {geo}", "{offering} {geo} cost", "{keyword} firm {geo}"],
  general: ["best {offering}", "{offering} in {geo}", "{category} companies", "{offering} alternatives", "top {keyword} providers", "{offering} for {audience}"],
};

function fillTemplate(template: string, profile: BusinessProfile): string {
  const geo = profile.geography || "your area";
  const keyword = profile.keywords[0] || profile.category || profile.offering || "your category";
  const audience = profile.audience || "your customers";
  return template
    .replaceAll("{offering}", profile.offering || profile.category || "your offer")
    .replaceAll("{category}", profile.category || profile.offering || "your category")
    .replaceAll("{geo}", geo).replaceAll("{keyword}", keyword).replaceAll("{audience}", audience)
    .replace(/\s+/g, " ").trim();
}

function discoveryLeads(profile: BusinessProfile, segment: BusinessSegment): DiscoveryLead[] {
  const dirs = SEGMENT_DIRECTORIES[segment];
  const q = (list: string[]) => list.map((template) => fillTemplate(template, profile)).filter((value, index, self) => value && self.indexOf(value) === index);
  return [
    { archetype: "Direct competitors", description: "Businesses offering the same core outcome to the same audience. These set the baseline you are compared against.", whereToFind: dirs.slice(0, 4), exampleQueries: q(SEGMENT_QUERY_TEMPLATES[segment].slice(0, 3)), signalsToWatch: ["pricing_page", "landing_page", "public_review", "public_ad"] },
    { archetype: "Adjacent players", description: "Companies that serve a neighboring need or overlapping audience and could expand into your lane.", whereToFind: dirs.slice(2, 5), exampleQueries: q(["{category} companies", "{offering} for {audience}", "{keyword} providers"].map((t) => t)), signalsToWatch: ["release_note", "partnership", "job_listing", "newsletter"] },
    { archetype: "Substitutes & DIY", description: "The way customers solve this without you — free tools, DIY, or doing nothing. Often the real competitor.", whereToFind: ["Reddit & community threads", "YouTube how-to search", "Google 'how to' & 'DIY' queries"], exampleQueries: q(["how to {offering}", "DIY {offering}", "free {offering}", "{offering} alternatives"]), signalsToWatch: ["community_discussion", "content_format", "search_pattern"] },
    { archetype: "Emerging / AI-native", description: "Newer, often AI-built or software-led entrants attacking your category with lower prices or speed.", whereToFind: ["Product Hunt", "TikTok & Instagram new-brand search", "Reddit 'new tool' threads", "Meta Ad Library (recent advertisers)"], exampleQueries: q(["AI {offering}", "{offering} app 2026", "new {category} startup", "{keyword} automation"]), signalsToWatch: ["public_ad", "ad_volume", "technology_stack", "social_cadence"] },
  ];
}

export function generateDiscoveryPlan(profile: BusinessProfile, env: NodeJS.ProcessEnv = process.env): Omit<DiscoveryRun, "id" | "tenantId" | "createdAt"> {
  const { segment, label } = classifySegment(profile);
  const leads = discoveryLeads(profile, segment);
  const searchQueries = [...new Set(leads.flatMap((lead) => lead.exampleQueries))].slice(0, 16);
  return {
    basis: `${profile.businessName || "This business"} — ${profile.category || "category not set"}${profile.geography ? ` · ${profile.geography}` : ""}${profile.audience ? ` · serving ${profile.audience}` : ""}`,
    segment: label,
    leads, searchQueries, directories: SEGMENT_DIRECTORIES[segment],
    webDiscovery: getWebDiscoveryStatus(env),
    disclaimer: "These are AI-generated starting points, not verified competitors. Use the linked public searches and directories to verify names and sources, then save confirmed competitors/signals. Nothing here is scraped, contacted, or published.",
  };
}

function starterSourceUrl(query: string) {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

function seedDiscoveryMarketBoard(tenantId: string, state: TenantState, profile: BusinessProfile, run: DiscoveryRun) {
  const at = now();
  const firstQuery = run.searchQueries[0] || `${profile.offering || profile.category || "competitors"} ${profile.geography || ""}`.trim();
  const directQuery = run.leads[0]?.exampleQueries[0] || firstQuery;
  const reviewQuery = `${profile.offering || profile.category || "competitors"} reviews ${profile.geography || ""}`.trim();
  const pricingQuery = `${profile.offering || profile.category || "competitors"} pricing`.trim();
  const contentQuery = `${profile.offering || profile.category || "competitors"} ads social content`.trim();

  const addOpportunity = (kind: ResearchOpportunity["kind"], title: string, query: string, insight: string, recommendations: string[]) => {
    const sourceUrl = starterSourceUrl(query);
    const exists = state.opportunities.some((item) => item.title === title && item.sourceUrl === sourceUrl);
    if (exists) return;
    state.opportunities.unshift({
      id: id("opportunity"),
      tenantId,
      competitorId: "",
      kind,
      title,
      sourceUrl,
      insight,
      recommendations,
      accuracyNotes: [
        "AI-generated from the saved business profile; verify public sources before using externally.",
        "No competitor identity is treated as confirmed until a public result is saved.",
        "Use this as a starting board, not a factual claim.",
      ],
      createdAt: at,
    });
  };

  addOpportunity(
    "search",
    `Local competitor searches for ${profile.offering || profile.category || "your offer"}`,
    directQuery,
    `Start with the direct competitor searches for ${run.segment}. These are the first public queries Phantom would run for ${profile.businessName || "this business"}.`,
    ["Open the top 10 public results.", "Save each confirmed competitor with its actual website.", "Record pricing, reviews, and landing-page signals only after verification."],
  );
  addOpportunity(
    "search",
    "Review pressure and customer objections",
    reviewQuery,
    "Find repeated public complaints, praise, and objections across review sources. Treat themes as aggregated demand, not individual targeting.",
    ["Group complaints into themes.", "Turn repeated confusion into FAQ or comparison content.", "Avoid referencing individual reviewers."],
  );
  addOpportunity(
    "offer",
    "Offer and pricing comparison board",
    pricingQuery,
    "Compare packages, entry prices, guarantees, and onboarding friction once public pricing pages are verified.",
    ["List each competitor's public package names.", "Note what is unclear or gated.", "Build your own clearer package language."],
  );
  addOpportunity(
    "timing",
    "Ad and content heat watch",
    contentQuery,
    "Watch which topics, formats, and offers competitors push publicly so your response can be original and better timed.",
    ["Check Meta Ad Library and public social profiles.", "Track repeated hooks by theme, not copied wording.", "Counter-program with a distinct angle."],
  );

  const exists = state.audit.some((item) => item.action === "market_board_seed" && item.reason.includes(run.id));
  if (!exists) publicAudit(state, tenantId, "system", "market_board_seed", "allowed", `Seeded market board from discovery ${run.id}. Candidates are not verified competitors.`);
}

function dossierSources(profile: BusinessProfile | null, competitor: CompetitorRecord): DossierSource[] {
  let base = "";
  try { base = new URL(competitor.website).origin; } catch { base = ""; }
  const at = (path: string) => (base ? `${base}${path}` : competitor.website || "");
  const audience = profile?.audience || "their customers";
  return [
    { source: "Homepage & positioning", url: base || competitor.website, whatItReveals: "Who they target, the primary promise, and how they frame the category.", signalType: "website_copy", questions: ["Which audience and outcome do they lead with?", "What primary claim or differentiator repeats?", `How is their positioning different from serving ${audience}?`] },
    { source: "Pricing / packages", url: at("/pricing"), whatItReveals: "Packaging, price anchors, tiers, and what they gate behind higher plans.", signalType: "pricing_page", questions: ["What are the tiers and anchor price?", "What is free vs paid, and what forces an upgrade?", "Any recent price or packaging change?"] },
    { source: "Product / features or services", url: at("/features"), whatItReveals: "Depth of offering and where they are investing.", signalType: "landing_page", questions: ["Which capability is featured most?", "What is conspicuously missing?", "Any 'new' or 'beta' labels?"] },
    { source: "Blog / changelog / release notes", url: at("/blog"), whatItReveals: "Direction of travel — what they are building and the themes they push.", signalType: "release_note", questions: ["What has shipped in the last 90 days?", "What theme are they doubling down on?", "Cadence of updates?"] },
    { source: "Reviews & complaints", url: `https://www.google.com/search?q=${encodeURIComponent(`${competitor.name} reviews`)}`, whatItReveals: "Recurring customer pain and the switching openings it creates.", signalType: "public_review", questions: ["What is the #1 recurring complaint?", "What do fans praise most?", "Is a gap you can serve appearing repeatedly?"] },
    { source: "Careers / hiring", url: at("/careers"), whatItReveals: "Where they are investing next — roles reveal strategy before announcements.", signalType: "job_listing", questions: ["What roles are open and in which function?", "Any new capability implied by the hires?", "Location/remote expansion signals?"] },
    { source: "Ads & campaigns", url: `https://www.facebook.com/ads/library/?q=${encodeURIComponent(competitor.name)}`, whatItReveals: "Active offers, hooks, and how much they are spending on which message.", signalType: "public_ad", questions: ["What offer/hook are they running now?", "How many active ads and for how long?", "Which audience do the creatives target?"] },
    { source: "Social cadence", url: `https://www.google.com/search?q=${encodeURIComponent(`${competitor.name} instagram OR tiktok OR linkedin`)}`, whatItReveals: "Content priorities, posting rhythm, and audience engagement.", signalType: "social_cadence", questions: ["Which platform and format do they prioritize?", "How often do they post?", "What content gets the most engagement?"] },
  ];
}

export function generateDossier(profile: BusinessProfile | null, competitor: CompetitorRecord, env: NodeJS.ProcessEnv = process.env): Omit<CompetitorDossier, "id" | "tenantId" | "createdAt"> {
  const sources = dossierSources(profile, competitor);
  return {
    competitorId: competitor.id, competitorName: competitor.name,
    focus: `Deep-dive research plan for ${competitor.name}${competitor.category ? ` (${competitor.category})` : ""}. Work top to bottom; log each confirmed observation as a dated public signal, then fuse.`,
    sources,
    priorityChecklist: [
      "Capture their current pricing/packaging and the anchor price.",
      "Read the last 5 reviews and note the single most repeated complaint.",
      "Check the careers page for the newest role and what it implies.",
      "Screenshot the top active ad/offer and its hook.",
      "Record one thing they do better than you and one gap you can win.",
    ],
    hypothesisPrompts: [
      `If ${competitor.name} raised prices or added a tier, which of their customers becomes reachable for you?`,
      "Which recurring complaint could become your headline differentiator?",
      "What are they NOT saying that your audience actually asks about?",
    ],
    webDiscovery: getWebDiscoveryStatus(env),
    disclaimer: "This is a research plan, not collected data. Every URL is a public source for you (or a connected search provider) to open. Log only what you verify. No scraping, login bypass, contact, or impersonation.",
  };
}

/* Auto-seed a business profile from whatever Phantom already knows: the
   workspace/org name, categories already present on saved competitors, and a
   segment guess. The user confirms or edits — nothing is assumed as fact. */
function seedProfile(tenantId: string, state: TenantState, orgName: string): BusinessProfile {
  const existing = state.businessProfile;
  const categories = [...new Set(state.competitors.map((c) => c.category).filter(Boolean))];
  const at = now();
  return {
    tenantId,
    businessName: existing?.businessName || orgName || "",
    category: existing?.category || categories[0] || "",
    offering: existing?.offering || "",
    audience: existing?.audience || "",
    geography: existing?.geography || "",
    differentiators: existing?.differentiators || [],
    keywords: existing?.keywords || categories,
    positioning: existing?.positioning || "",
    autoSeeded: !existing,
    createdAt: existing?.createdAt || at,
    updatedAt: at,
  };
}

function orgNameFor(session: AccessSession, tenantId: string): string {
  const membership = session.memberships?.find((m) => m.orgId === session.orgId);
  return clean(membership?.orgName, 120) || (tenantId.startsWith("client-") ? "" : "");
}

export async function getBusinessProfile(session: AccessSession, requestedTenant: unknown) {
  const tenantId = tenantFor(session, requestedTenant);
  return mutate(tenantId, (state) => {
    if (!state.businessProfile) state.businessProfile = seedProfile(tenantId, state, orgNameFor(session, tenantId));
    return { profile: state.businessProfile, webDiscovery: getWebDiscoveryStatus() };
  });
}

export async function saveBusinessProfile(session: AccessSession, body: Record<string, unknown>) {
  const tenantId = tenantFor(session, body.tenantId);
  if (!(session.canManageAccess || session.isSuperAdmin || session.orgRole === "owner" || session.orgRole === "admin"))
    throw new Error("Only a workspace owner or admin can edit the business profile.");
  const list = (value: unknown, max: number) => (Array.isArray(value) ? value : String(value ?? "").split(/[\n,]/)).map((entry) => clean(entry, 80)).filter(Boolean).slice(0, max);
  return mutate(tenantId, (state) => {
    const at = now();
    const profile: BusinessProfile = {
      tenantId,
      businessName: clean(body.businessName, 120),
      category: clean(body.category, 120),
      offering: clean(body.offering, 400),
      audience: clean(body.audience, 300),
      geography: clean(body.geography, 160),
      differentiators: list(body.differentiators, 8),
      keywords: list(body.keywords, 12),
      positioning: clean(body.positioning, 400),
      autoSeeded: false,
      createdAt: state.businessProfile?.createdAt || at,
      updatedAt: at,
    };
    requireAllowed(state, tenantId, session, "business_profile", `${profile.category} ${profile.offering} ${profile.positioning}`);
    if (!profile.category && !profile.offering) throw new Error("Add at least your category or what you sell so Phantom can find the right competitors.");
    state.businessProfile = profile;
    if (!state.discoveryRuns.length) {
      const plan = generateDiscoveryPlan(profile);
      const run: DiscoveryRun = { id: id("discovery"), tenantId, createdAt: at, ...plan };
      state.discoveryRuns = [run];
      seedDiscoveryMarketBoard(tenantId, state, profile, run);
      publicAudit(state, tenantId, session.id, "competitor_discovery", "allowed", `Generated starter market board with ${run.leads.length} candidate lanes and ${run.searchQueries.length} public searches from the saved profile.`);
    }
    publicAudit(state, tenantId, session.id, "business_profile", "allowed", "Business profile saved for competitor targeting.");
    return { profile, webDiscovery: getWebDiscoveryStatus() };
  });
}

export async function runCompetitorDiscovery(session: AccessSession, body: Record<string, unknown>) {
  const tenantId = tenantFor(session, body.tenantId);
  return mutate(tenantId, (state) => {
    if (!state.businessProfile) state.businessProfile = seedProfile(tenantId, state, orgNameFor(session, tenantId));
    if (!state.businessProfile.category && !state.businessProfile.offering)
      throw new Error("Add your category or what you sell first so discovery targets the right market.");
    const plan = generateDiscoveryPlan(state.businessProfile);
    const run: DiscoveryRun = { id: id("discovery"), tenantId, createdAt: now(), ...plan };
    state.discoveryRuns = [run, ...state.discoveryRuns].slice(0, 20);
    seedDiscoveryMarketBoard(tenantId, state, state.businessProfile, run);
    publicAudit(state, tenantId, session.id, "competitor_discovery", "allowed", `Generated ${run.leads.length} candidate lanes, ${run.searchQueries.length} public searches, and starter market-board opportunities.`);
    return run;
  });
}

export async function runCompetitorDossier(session: AccessSession, body: Record<string, unknown>) {
  const tenantId = tenantFor(session, body.tenantId);
  return mutate(tenantId, (state) => {
    const target = competitor(state, tenantId, body.competitorId);
    const plan = generateDossier(state.businessProfile, target);
    const dossier: CompetitorDossier = { id: id("dossier"), tenantId, createdAt: now(), ...plan };
    state.dossiers = [dossier, ...state.dossiers.filter((entry) => entry.competitorId !== target.id)].slice(0, 40);
    publicAudit(state, tenantId, session.id, "competitor_dossier", "allowed", `Deep-dive research plan generated for ${target.name}. Public sources only; nothing collected.`);
    return dossier;
  });
}

export async function getCompetitorIntelligenceStoreStatus() { try { const file = await stat(STORE_PATH); return { path: STORE_PATH, exists: true, bytes: file.size }; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { path: STORE_PATH, exists: false, bytes: 0 }; throw error; } }
