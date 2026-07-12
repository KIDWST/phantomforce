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

type TenantState = {
  settings: { aggressiveMode: boolean; modeChangedAt: string | null; publicSourcesOnly: true; individualTargeting: false; externalActions: false };
  competitors: CompetitorRecord[]; signals: SignalRecord[]; inferences: InferenceRecord[]; audienceThemes: AudienceTheme[];
  creativeAnalyses: CreativeAnalysis[]; interceptions: InterceptionPackage[]; opportunities: ResearchOpportunity[];
  mysteryEvidence: MysteryEvidence[]; audit: AuditRecord[];
};
type Store = { version: 1; tenants: Record<string, TenantState> };
const freshTenant = (): TenantState => ({ settings: { aggressiveMode: false, modeChangedAt: null, publicSourcesOnly: true, individualTargeting: false, externalActions: false }, competitors: [], signals: [], inferences: [], audienceThemes: [], creativeAnalyses: [], interceptions: [], opportunities: [], mysteryEvidence: [], audit: [] });
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
  return { tenantId, access: { enabled: options.entitled, aggressiveAvailable: options.aggressiveEntitled, canManage: session.canManageAccess || session.isSuperAdmin || session.orgRole === "owner" || session.orgRole === "admin", competitorLimit: options.competitorLimit, signalLimit: options.signalLimit }, signalTypes: SIGNAL_TYPES, settings: state.settings, competitors: state.competitors, signals: state.signals, inferences: state.inferences, audienceThemes: state.audienceThemes, creativeAnalyses: state.creativeAnalyses, interceptions: state.interceptions, opportunities: state.opportunities, mysteryEvidence: state.mysteryEvidence, audit: state.audit.slice(0, 100), metrics: { competitors: state.competitors.length, signals: state.signals.length, inferences: state.inferences.length, highConfidence: state.inferences.filter((entry) => entry.confidence === "high").length, audienceThemes: state.audienceThemes.length, blockedRequests: state.audit.filter((entry) => entry.result === "blocked").length } };
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
