import { lookup } from "node:dns/promises";

const OSM_SOURCE = "OpenStreetMap public business directory";
const OSM_COPYRIGHT = "https://www.openstreetmap.org/copyright";
const MAX_RESULTS_PER_PULL = 100;
const MAX_WEBSITE_ENRICHMENTS_PER_PULL = 12;
const MAX_WEBSITE_DOCUMENT_BYTES = 512_000;
const WEBSITE_EVIDENCE_TTL_MS = 24 * 60 * 60 * 1_000;

export type ProspectLane =
  | "healthcare"
  | "sports-fitness"
  | "education"
  | "events-hospitality"
  | "creative-partners"
  | "wedding-ecosystem"
  | "coaches-programs";

type OsmElement = {
  id: number;
  type: "node" | "way" | "relation";
  tags?: Record<string, string>;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
};

export type PublicProspectCandidate = {
  sourceId: string;
  sourceUrl: string;
  source: string;
  sourceLicense: string;
  lane: ProspectLane;
  market: string;
  name: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  socials: Record<string, string>;
  tags: string[];
  value: number;
  fitScore: number;
  notes: string;
  qualification: string[];
  outreach: string;
};

export type PublicProspectResearchResult = {
  provider: "openstreetmap";
  providerCalled: boolean;
  source: string;
  sourceLicense: string;
  market: string;
  requested: number;
  limitApplied: number;
  truncated: boolean;
  directoryCandidates: number;
  excludedExistingSources: number;
  websiteEnrichment: {
    attempted: number;
    verified: number;
    publishedEmailsAdded: number;
    publishedPhonesAdded: number;
    failed: number;
    capped: boolean;
  };
  candidates: PublicProspectCandidate[];
};

const MARKETS = [
  { id: "elgin-il", label: "Elgin, Illinois", bbox: "41.95,-88.42,42.14,-88.17", match: /\belgin\b/iu },
  { id: "chicagoland", label: "Chicagoland", bbox: "41.50,-88.50,42.30,-87.30", match: /\b(chicagoland|chicago suburbs?|northwest suburbs?|fox valley)\b/iu },
  { id: "chicago", label: "Chicago", bbox: "41.64,-87.94,42.03,-87.52", match: /\bchicago\b/iu },
] as const;

const LANE_PLANS: Array<{ lane: ProspectLane; match: RegExp; selectors: string[] }> = [
  {
    lane: "healthcare",
    match: /\b(health|medical|doctor|physician|clinic|hospital|dentist|pharmacy|therapy|menopause)\b/iu,
    selectors: ['["amenity"~"^(clinic|doctors|hospital|dentist|pharmacy)$"]', '["healthcare"]'],
  },
  {
    lane: "sports-fitness",
    match: /\b(sport|athlet|fitness|gyms?|trainer|team|league|game)\b/iu,
    selectors: ['["leisure"~"^(fitness_centre|sports_centre|stadium|track|pitch|swimming_pool)$"]', '["sport"]'],
  },
  {
    lane: "education",
    match: /\b(school|college|university|education|academy|student|campus)\b/iu,
    selectors: ['["amenity"~"^(school|college|university|kindergarten|music_school)$"]'],
  },
  {
    lane: "events-hospitality",
    match: /\b(event|conference|venue|hotel|hospitality|theatre|museum|gallery)\b/iu,
    selectors: ['["amenity"~"^(events_venue|conference_centre|community_centre|theatre|arts_centre)$"]', '["tourism"~"^(hotel|hostel|guest_house|gallery|museum)$"]'],
  },
  {
    lane: "creative-partners",
    match: /\b(creative|agency|studio|photograph|camera|marketing|production|media|podcast)\b/iu,
    selectors: ['["shop"~"^(photo|camera|art|music)$"]', '["office"~"^(advertising_agency|graphic_design|photographer)$"]', '["studio"]'],
  },
  {
    lane: "wedding-ecosystem",
    match: /\b(wedding|bridal|florist|flower|vendor)\b/iu,
    selectors: ['["shop"="wedding"]', '["office"="event_management"]', '["craft"="photographer"]', '["shop"="florist"]'],
  },
  {
    lane: "coaches-programs",
    match: /\b(coach|program|club|association|nonprofit|community|youth)\b/iu,
    selectors: ['["club"="sport"]', '["office"~"^(educational_institution|ngo|association)$"]', '["amenity"~"^(community_centre|social_centre)$"]'],
  },
];

const LANE_VALUE: Record<ProspectLane, number> = {
  healthcare: 6500,
  "sports-fitness": 2800,
  education: 3200,
  "events-hospitality": 4500,
  "creative-partners": 2200,
  "wedding-ecosystem": 4800,
  "coaches-programs": 2600,
};

const LANE_PITCH: Record<ProspectLane, string> = {
  healthcare: "Conference recaps, expert interviews, educational series, and trusted social cuts.",
  "sports-fitness": "Game-day coverage, athlete stories, recruiting reels, and season-long social content.",
  education: "Campus stories, enrollment campaigns, athletics coverage, and event highlight films.",
  "events-hospitality": "Event films, venue showcases, wedding coverage, and fast-turn social packages.",
  "creative-partners": "Overflow production, second-camera coverage, editing support, and white-label delivery.",
  "wedding-ecosystem": "Wedding films, venue and vendor showcases, same-week social edits, and referral-ready highlight packages.",
  "coaches-programs": "Coach profiles, program stories, testimonials, recruiting content, and recurring social video.",
};

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
] as const;

const queryCache = new Map<string, { expiresAt: number; elements: OsmElement[] }>();
const websiteEvidenceCache = new Map<string, { expiresAt: number; evidence: PublicWebsiteEvidence }>();

type PublicWebsiteEvidence = {
  sourceUrl: string;
  email: string | null;
  phone: string | null;
  socials: Record<string, string>;
};

type ResolvePublicHost = (hostname: string, options: { all: true }) => Promise<Array<{ address: string }>>;

function clean(value: unknown, max = 500) {
  return typeof value === "string" ? value.replace(/\s+/gu, " ").trim().slice(0, max) : "";
}

function privateNetworkAddress(value: string) {
  const address = value.toLowerCase().replace(/^\[|\]$/gu, "");
  if (["localhost", "0.0.0.0", "::1", "0:0:0:0:0:0:0:1"].includes(address)) return true;
  if ([".localhost", ".local", ".internal", ".lan", ".home"].some((suffix) => address.endsWith(suffix))) return true;
  if (/^(?:10|127|169\.254|192\.168)\./u.test(address)) return true;
  const private172 = address.match(/^172\.(\d{1,3})\./u);
  if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return true;
  const carrier100 = address.match(/^100\.(\d{1,3})\./u);
  if (carrier100 && Number(carrier100[1]) >= 64 && Number(carrier100[1]) <= 127) return true;
  if (/^198\.(?:18|19)\./u.test(address)) return true;
  return /^(?:fc|fd|fe80):/u.test(address);
}

async function assertPublicWebsiteUrl(url: URL, resolveImpl: ResolvePublicHost) {
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || privateNetworkAddress(url.hostname)) {
    throw new Error("public_website_target_blocked");
  }
  const records = await resolveImpl(url.hostname, { all: true });
  if (!records.length || records.some((record) => privateNetworkAddress(record.address))) {
    throw new Error("public_website_target_blocked");
  }
}

async function readBoundedText(response: Response) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_WEBSITE_DOCUMENT_BYTES) throw new Error("public_website_too_large");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_WEBSITE_DOCUMENT_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error("public_website_too_large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function decodeHtmlValue(value: string) {
  return value
    .replace(/&amp;/giu, "&")
    .replace(/&#x([0-9a-f]+);/giu, (match, hex: string) => {
      const point = Number.parseInt(hex, 16);
      return Number.isSafeInteger(point) && point <= 0x10ffff ? String.fromCodePoint(point) : match;
    })
    .replace(/&#(\d+);/gu, (match, decimal: string) => {
      const point = Number(decimal);
      return Number.isSafeInteger(point) && point <= 0x10ffff ? String.fromCodePoint(point) : match;
    })
    .replace(/&commat;/giu, "@");
}

function validPublishedEmail(value: string) {
  let decoded = decodeHtmlValue(value);
  try { decoded = decodeURIComponent(decoded); } catch { /* malformed escapes are not interpreted */ }
  const email = decoded.split(/[?#]/u)[0]?.trim().toLowerCase() || "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) && !/^(?:no-?reply|donotreply)@/u.test(email) ? email : null;
}

function publicWebsiteEvidence(html: string, pageUrl: URL): PublicWebsiteEvidence {
  const links = [...html.matchAll(/\bhref\s*=\s*["']([^"']+)["']/giu)].map((match) => decodeHtmlValue(match[1]));
  const email = links
    .filter((href) => /^mailto:/iu.test(href))
    .map((href) => validPublishedEmail(href.replace(/^mailto:/iu, "")))
    .find(Boolean) || null;
  const phone = links
    .filter((href) => /^tel:/iu.test(href))
    .map((href) => {
      const raw = href.replace(/^tel:/iu, "");
      try { return clean(decodeURIComponent(raw), 80); } catch { return clean(raw, 80); }
    })
    .find(Boolean) || null;
  const socials: Record<string, string> = {};
  const platforms = [
    ["instagram", /(?:^|\.)instagram\.com$/iu],
    ["facebook", /(?:^|\.)facebook\.com$/iu],
    ["linkedin", /(?:^|\.)linkedin\.com$/iu],
    ["x", /(?:^|\.)(?:x|twitter)\.com$/iu],
    ["tiktok", /(?:^|\.)tiktok\.com$/iu],
  ] as const;
  for (const href of links) {
    try {
      const link = new URL(href, pageUrl);
      const platform = platforms.find(([, host]) => host.test(link.hostname))?.[0];
      if (platform && !socials[platform]) socials[platform] = link.toString().slice(0, 300);
    } catch { /* malformed public links are ignored */ }
  }
  return { sourceUrl: pageUrl.toString(), email, phone, socials };
}

function samePublicWebsite(left: URL, right: URL) {
  return left.hostname.toLowerCase().replace(/^www\./u, "") === right.hostname.toLowerCase().replace(/^www\./u, "");
}

function contactPageUrl(html: string, current: URL) {
  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/giu)) {
    const label = clean(match[2].replace(/<[^>]+>/gu, " "), 160);
    const href = decodeHtmlValue(match[1]);
    if (!/\b(contact|connect|reach us|get in touch)\b/iu.test(`${label} ${href}`)) continue;
    try {
      const candidate = new URL(href, current);
      if (["http:", "https:"].includes(candidate.protocol) && samePublicWebsite(candidate, current)) return candidate;
    } catch { /* malformed links are ignored */ }
  }
  return null;
}

async function fetchOfficialWebsitePage(
  url: URL,
  root: URL,
  fetchImpl: typeof fetch,
  resolveImpl: ResolvePublicHost,
  redirects = 0,
) {
  await assertPublicWebsiteUrl(url, resolveImpl);
  const response = await fetchImpl(url, {
    method: "GET",
    redirect: "manual",
    headers: {
      accept: "text/html,application/xhtml+xml;q=0.9",
      "user-agent": "PhantomForce-CRM/1.0 (bounded public business contact verification)",
    },
    signal: AbortSignal.timeout(8_000),
  });
  if (response.status >= 300 && response.status < 400) {
    if (redirects >= 3) throw new Error("public_website_redirect_limit");
    const location = response.headers.get("location");
    if (!location) throw new Error("public_website_redirect_without_location");
    const next = new URL(location, url);
    if (!samePublicWebsite(next, root)) throw new Error("public_website_cross_domain_redirect_blocked");
    return fetchOfficialWebsitePage(next, root, fetchImpl, resolveImpl, redirects + 1);
  }
  if (!response.ok) throw new Error(`public_website_http_${response.status}`);
  if (!/text\/html|application\/xhtml\+xml/iu.test(response.headers.get("content-type") || "")) {
    throw new Error("public_website_not_html");
  }
  return { url, html: await readBoundedText(response) };
}

async function researchOfficialWebsite(
  value: string,
  fetchImpl: typeof fetch,
  resolveImpl: ResolvePublicHost,
): Promise<PublicWebsiteEvidence> {
  const cached = websiteEvidenceCache.get(value);
  if (cached && cached.expiresAt > Date.now()) return cached.evidence;
  const root = new URL(value);
  const home = await fetchOfficialWebsitePage(root, root, fetchImpl, resolveImpl);
  let evidence = publicWebsiteEvidence(home.html, home.url);
  if (!evidence.email || !evidence.phone) {
    const contact = contactPageUrl(home.html, home.url);
    if (contact && contact.toString() !== home.url.toString()) {
      const page = await fetchOfficialWebsitePage(contact, root, fetchImpl, resolveImpl);
      const extra = publicWebsiteEvidence(page.html, page.url);
      evidence = {
        sourceUrl: extra.email || extra.phone ? extra.sourceUrl : evidence.sourceUrl,
        email: evidence.email || extra.email,
        phone: evidence.phone || extra.phone,
        socials: { ...extra.socials, ...evidence.socials },
      };
    }
  }
  websiteEvidenceCache.set(value, { expiresAt: Date.now() + WEBSITE_EVIDENCE_TTL_MS, evidence });
  return evidence;
}

function resolveMarket(text: string) {
  return MARKETS.find((market) => market.match.test(text)) || MARKETS[2];
}

function selectedLanePlans(text: string) {
  const matched = LANE_PLANS.filter((plan) => plan.match.test(text));
  const plans = matched.length ? matched : LANE_PLANS;
  return plans.map((plan) => {
    if (plan.lane === "sports-fitness" && /\b(gyms?|fitness|trainer)\b/iu.test(text)) {
      return { ...plan, selectors: ['["leisure"~"^(fitness_centre|sports_centre)$"]'] };
    }
    if (plan.lane === "wedding-ecosystem" && /\b(florist|flowers?)\b/iu.test(text)) {
      return { ...plan, selectors: ['["shop"="florist"]'] };
    }
    return plan;
  });
}

function buildOverpassQuery(plans: typeof LANE_PLANS, bbox: string, limit: number) {
  const selectors = [...new Set(plans.flatMap((plan) => plan.selectors))];
  const clauses = selectors.map((selector) => `nwr["name"]${selector}(${bbox});`).join("");
  const sourceLimit = Math.max(40, Math.min(1_000, limit * Math.max(6, plans.length * 2)));
  return `[out:json][timeout:45];(${clauses});out center ${sourceLimit};`;
}

function laneFor(tags: Record<string, string>, plans: typeof LANE_PLANS): ProspectLane {
  const category = [tags.amenity, tags.healthcare, tags.leisure, tags.sport, tags.club, tags.tourism, tags.shop, tags.office, tags.craft, tags.studio].filter(Boolean).join(" ");
  if (/clinic|doctors|hospital|dentist|pharmacy|healthcare/iu.test(category)) return "healthcare";
  if (/wedding|florist|event_management/iu.test(category)) return "wedding-ecosystem";
  if (/school|college|university|kindergarten|music_school/iu.test(category)) return "education";
  if (/fitness_centre|sports_centre|stadium|track|pitch|swimming_pool|sport/iu.test(category)) return "sports-fitness";
  if (/advertising_agency|graphic_design|photographer|photo|camera|studio/iu.test(category)) return "creative-partners";
  if (/educational_institution|ngo|association|social_centre|community_centre|club/iu.test(category)) return "coaches-programs";
  if (/events_venue|conference_centre|theatre|arts_centre|hotel|hostel|guest_house|gallery|museum/iu.test(category)) return "events-hospitality";
  return plans[0]?.lane || "events-hospitality";
}

function publicEmail(tags: Record<string, string>) {
  const value = clean(tags["contact:email"] || tags.email, 200).toLowerCase();
  return value && !value.includes(";") && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value) ? value : null;
}

function publicWebsite(tags: Record<string, string>) {
  const value = clean(tags["contact:website"] || tags.website || tags.url, 400);
  if (!value) return null;
  try {
    const url = new URL(/^https?:\/\//iu.test(value) ? value : `https://${value}`);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function publicPhone(tags: Record<string, string>) {
  const value = clean(tags["contact:phone"] || tags.phone, 80);
  return value || null;
}

function publicSocials(tags: Record<string, string>, sourceUrl: string) {
  const socials: Record<string, string> = { source: sourceUrl };
  const mappings = [["instagram", "contact:instagram"], ["facebook", "contact:facebook"], ["linkedin", "contact:linkedin"], ["x", "contact:twitter"], ["tiktok", "contact:tiktok"]] as const;
  for (const [field, key] of mappings) {
    const value = clean(tags[key], 300);
    if (value) socials[field] = value;
  }
  return socials;
}

function address(tags: Record<string, string>) {
  const street = [clean(tags["addr:housenumber"], 20), clean(tags["addr:street"], 120)].filter(Boolean).join(" ");
  return [street, clean(tags["addr:city"], 80), clean(tags["addr:state"], 40), clean(tags["addr:postcode"], 20)].filter(Boolean).join(", ");
}

function category(tags: Record<string, string>) {
  for (const key of ["amenity", "healthcare", "leisure", "sport", "club", "tourism", "shop", "office", "craft", "studio"]) {
    if (clean(tags[key])) return `${key}:${clean(tags[key], 80)}`;
  }
  return "public organization";
}

function toCandidate(element: OsmElement, plans: typeof LANE_PLANS, market: (typeof MARKETS)[number]): PublicProspectCandidate | null {
  const tags = element.tags || {};
  const name = clean(tags.name, 180);
  if (!name || !Number.isFinite(Number(element.id)) || !["node", "way", "relation"].includes(element.type)) return null;
  const lane = laneFor(tags, plans);
  const sourceId = `${element.type}/${element.id}`;
  const sourceUrl = `https://www.openstreetmap.org/${sourceId}`;
  const email = publicEmail(tags);
  const website = publicWebsite(tags);
  const phone = publicPhone(tags);
  const location = address(tags);
  const evidence = [category(tags), location].filter(Boolean).join(" · ");
  const evidenceCount = [email, website, phone, location].filter(Boolean).length;
  return {
    sourceId,
    sourceUrl,
    source: OSM_SOURCE,
    sourceLicense: OSM_COPYRIGHT,
    lane,
    market: market.label,
    name,
    email,
    phone,
    website,
    socials: publicSocials(tags, sourceUrl),
    tags: [
      `lane:${lane}`,
      `market:${market.id}`,
      "business-prospect",
      "source:openstreetmap",
      email ? "email:published-business" : "email:research-needed",
      "consent:unknown",
    ],
    value: LANE_VALUE[lane],
    fitScore: Math.min(94, 62 + evidenceCount * 7 + (["events-hospitality", "healthcare", "wedding-ecosystem"].includes(lane) ? 4 : 0)),
    notes: `${LANE_PITCH[lane]} Public directory evidence: ${evidence || `named ${market.label} organization`}. Source record: ${sourceUrl}`,
    qualification: [
      `Publicly listed ${market.label} ${lane.replaceAll("-", " ")} organization`,
      email ? "Published business email found; permission still requires review" : "No published email found; research or contact form required",
      website ? "Public website available for fit review" : "Website requires verification",
    ],
    outreach: LANE_PITCH[lane],
  };
}

function balancedCandidates(candidates: PublicProspectCandidate[], plans: typeof LANE_PLANS, limit: number) {
  const byLane = new Map<ProspectLane, PublicProspectCandidate[]>();
  for (const plan of plans) byLane.set(plan.lane, []);
  for (const candidate of candidates) byLane.get(candidate.lane)?.push(candidate);
  const selected: PublicProspectCandidate[] = [];
  const seen = new Set<string>();
  while (selected.length < limit) {
    let added = false;
    for (const plan of plans) {
      const candidate = byLane.get(plan.lane)?.shift();
      if (!candidate || seen.has(candidate.sourceId)) continue;
      seen.add(candidate.sourceId);
      selected.push(candidate);
      added = true;
      if (selected.length >= limit) break;
    }
    if (!added) break;
  }
  return selected;
}

async function enrichFromOfficialWebsites(
  candidates: PublicProspectCandidate[],
  fetchImpl: typeof fetch,
  resolveImpl: ResolvePublicHost,
) {
  const targets = candidates.filter((candidate) => Boolean(candidate.website)).slice(0, MAX_WEBSITE_ENRICHMENTS_PER_PULL);
  let verified = 0;
  let publishedEmailsAdded = 0;
  let publishedPhonesAdded = 0;
  let failed = 0;
  await Promise.all(targets.map(async (candidate) => {
    try {
      const evidence = await researchOfficialWebsite(candidate.website!, fetchImpl, resolveImpl);
      verified += 1;
      const addedEmail = !candidate.email && Boolean(evidence.email);
      const addedPhone = !candidate.phone && Boolean(evidence.phone);
      if (addedEmail) {
        candidate.email = evidence.email;
        publishedEmailsAdded += 1;
      }
      if (addedPhone) {
        candidate.phone = evidence.phone;
        publishedPhonesAdded += 1;
      }
      candidate.socials = { ...candidate.socials, ...evidence.socials, officialWebsiteSource: evidence.sourceUrl };
      candidate.tags = candidate.tags.filter((tag) => tag !== "email:research-needed");
      if (candidate.email && !candidate.tags.includes("email:published-business")) candidate.tags.push("email:published-business");
      if (!candidate.email) candidate.tags.push("email:research-needed");
      if (!candidate.tags.includes("source:official-website")) candidate.tags.push("source:official-website");
      candidate.notes = `${candidate.notes} Official website evidence: ${evidence.sourceUrl}`;
      candidate.qualification = [
        candidate.qualification[0],
        candidate.email
          ? "Published business email found; permission still requires review"
          : "Official website checked; no published email found on the reviewed pages",
        candidate.website ? "Official website verified for public contact evidence" : candidate.qualification[2],
      ].filter(Boolean);
      const evidenceCount = [candidate.email, candidate.phone, candidate.website, ...Object.keys(evidence.socials)].filter(Boolean).length;
      candidate.fitScore = Math.min(96, Math.max(candidate.fitScore, 62 + evidenceCount * 7));
    } catch {
      failed += 1;
      if (!candidate.tags.includes("enrichment:website-pending")) candidate.tags.push("enrichment:website-pending");
      candidate.qualification = [...candidate.qualification, "Official website contact verification could not be completed this run"].slice(0, 5);
    }
  }));
  return {
    attempted: targets.length,
    verified,
    publishedEmailsAdded,
    publishedPhonesAdded,
    failed,
    capped: candidates.filter((candidate) => Boolean(candidate.website)).length > targets.length,
  };
}

async function fetchOverpass(query: string, fetchImpl: typeof fetch) {
  const cached = queryCache.get(query);
  if (cached && cached.expiresAt > Date.now()) return cached.elements;
  const requests = OVERPASS_ENDPOINTS.map(async (endpoint) => {
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
          "user-agent": "PhantomForce-CRM/1.0 (sourced public organization research)",
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(18_000),
      });
      if (!response.ok) throw new Error(`Public organization directory returned ${response.status}.`);
      const payload = await response.json() as { elements?: OsmElement[] };
      return Array.isArray(payload.elements) ? payload.elements : [];
    } catch (error) {
      throw error instanceof Error ? error : new Error(`Public organization directory ${endpoint} failed.`);
    }
  });
  try {
    const elements = await Promise.any(requests);
    queryCache.set(query, { expiresAt: Date.now() + 6 * 60 * 60 * 1_000, elements });
    return elements;
  } catch (error) {
    const firstFailure = error instanceof AggregateError ? error.errors.find((item) => item instanceof Error) : error;
    throw firstFailure instanceof Error ? firstFailure : new Error("Public organization research is temporarily unavailable.");
  }
}

export async function researchPublicProspects(input: {
  audience?: string;
  prompt?: string;
  count: number;
  fetchImpl?: typeof fetch;
  websiteFetchImpl?: typeof fetch;
  resolveImpl?: ResolvePublicHost;
  excludeSourceIds?: string[];
}): Promise<PublicProspectResearchResult> {
  const text = clean(`${input.prompt || ""} ${input.audience || ""}`, 1_500);
  const market = resolveMarket(text);
  const plans = selectedLanePlans(text);
  const requested = Math.max(1, Math.min(2_000, Math.floor(Number(input.count) || 1)));
  const limitApplied = Math.min(requested, MAX_RESULTS_PER_PULL);
  const query = buildOverpassQuery(plans, market.bbox, limitApplied);
  const elements = await fetchOverpass(query, input.fetchImpl || fetch);
  const directoryCandidates = elements
    .map((element) => toCandidate(element, plans, market))
    .filter((candidate): candidate is PublicProspectCandidate => Boolean(candidate));
  const excluded = new Set((input.excludeSourceIds || []).map((value) => clean(value, 300).toLowerCase()).filter(Boolean));
  const availableCandidates = directoryCandidates.filter((candidate) => !excluded.has(candidate.sourceId.toLowerCase()) && !excluded.has(candidate.sourceUrl.toLowerCase()));
  const candidates = balancedCandidates(
    availableCandidates,
    plans,
    limitApplied,
  );
  const websiteEnrichment = await enrichFromOfficialWebsites(
    candidates,
    input.websiteFetchImpl || input.fetchImpl || fetch,
    input.resolveImpl || ((hostname, options) => lookup(hostname, options)),
  );
  const truncated = requested > limitApplied || availableCandidates.length > limitApplied;
  return {
    provider: "openstreetmap",
    providerCalled: true,
    source: OSM_SOURCE,
    sourceLicense: OSM_COPYRIGHT,
    market: market.label,
    requested,
    limitApplied,
    truncated,
    directoryCandidates: directoryCandidates.length,
    excludedExistingSources: directoryCandidates.length - availableCandidates.length,
    websiteEnrichment,
    candidates,
  };
}
