import "../src/load-env.js";

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { prisma } from "../src/access/prisma-runtime.js";
import { recordOrgAuditEvent } from "../src/access/user-accounts.js";

const CHICAGO_BBOX = "41.64,-87.94,42.03,-87.52";
const OSM_SOURCE = "OpenStreetMap public business directory";
const OSM_COPYRIGHT = "https://www.openstreetmap.org/copyright";
const DEFAULT_ORG = "phantomforce-internal";
const DEFAULT_LIMIT = 550;

type ProspectLane = "healthcare" | "sports-fitness" | "education" | "events-hospitality" | "creative-partners";
type OsmElement = {
  id: number;
  type: "node" | "way" | "relation";
  tags?: Record<string, string>;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
};

type Prospect = {
  sourceId: string;
  lane: ProspectLane;
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
};

const lanePlans: Array<{ lane: ProspectLane; quota: number; query: string }> = [
  {
    lane: "healthcare",
    quota: 145,
    query: `[out:json][timeout:90];(nwr["name"]["amenity"~"^(clinic|doctors|hospital|dentist|pharmacy)$"](${CHICAGO_BBOX});nwr["name"]["healthcare"](${CHICAGO_BBOX}););out center 240;`,
  },
  {
    lane: "sports-fitness",
    quota: 125,
    query: `[out:json][timeout:90];nwr["name"]["leisure"~"^(fitness_centre|sports_centre|stadium|track|pitch|swimming_pool)$"](${CHICAGO_BBOX});out center 240;`,
  },
  {
    lane: "education",
    quota: 115,
    query: `[out:json][timeout:90];nwr["name"]["amenity"~"^(school|college|university|kindergarten|music_school)$"](${CHICAGO_BBOX});out center 220;`,
  },
  {
    lane: "events-hospitality",
    quota: 125,
    query: `[out:json][timeout:90];(nwr["name"]["amenity"~"^(events_venue|conference_centre|community_centre|theatre|arts_centre)$"](${CHICAGO_BBOX});nwr["name"]["tourism"~"^(hotel|hostel|guest_house|gallery|museum)$"](${CHICAGO_BBOX});nwr["name"]["shop"="wedding"](${CHICAGO_BBOX}););out center 250;`,
  },
  {
    lane: "creative-partners",
    quota: 40,
    query: `[out:json][timeout:90];(nwr["name"]["shop"~"^(photo|camera|art|music)$"](${CHICAGO_BBOX});nwr["name"]["office"~"^(advertising_agency|graphic_design|photographer)$"](${CHICAGO_BBOX});nwr["name"]["studio"](${CHICAGO_BBOX}););out center 120;`,
  },
];

const laneValue: Record<ProspectLane, number> = {
  healthcare: 6500,
  "sports-fitness": 2800,
  education: 3200,
  "events-hospitality": 4500,
  "creative-partners": 2200,
};

const lanePitch: Record<ProspectLane, string> = {
  healthcare: "Conference recaps, expert interviews, educational series, and trusted social cuts.",
  "sports-fitness": "Game-day coverage, athlete stories, recruiting reels, and season-long social content.",
  education: "Campus stories, enrollment campaigns, athletics coverage, and event highlight films.",
  "events-hospitality": "Event films, venue showcases, wedding coverage, and fast-turn social packages.",
  "creative-partners": "Overflow production, second-camera coverage, editing support, and white-label delivery.",
};

function argValue(name: string, fallback: string) {
  const match = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return match ? match.slice(name.length + 3).trim() : fallback;
}

function clean(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function publicEmail(tags: Record<string, string>) {
  const candidate = clean(tags["contact:email"] || tags.email).toLowerCase();
  if (!candidate || candidate.includes(";") || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)) return null;
  return candidate;
}

function publicWebsite(tags: Record<string, string>) {
  const candidate = clean(tags["contact:website"] || tags.website || tags.url);
  if (!candidate) return null;
  const normalized = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
  try {
    return new URL(normalized).toString();
  } catch {
    return null;
  }
}

function publicPhone(tags: Record<string, string>) {
  const candidate = clean(tags["contact:phone"] || tags.phone);
  return candidate && candidate.length <= 80 ? candidate : null;
}

function publicSocials(tags: Record<string, string>, sourceId: string) {
  const socials: Record<string, string> = { website: `https://www.openstreetmap.org/${sourceId}` };
  const mappings = [
    ["instagram", "contact:instagram"],
    ["facebook", "contact:facebook"],
    ["linkedin", "contact:linkedin"],
    ["x", "contact:twitter"],
    ["tiktok", "contact:tiktok"],
  ] as const;
  for (const [field, tag] of mappings) {
    const value = clean(tags[tag]);
    if (value) socials[field] = value;
  }
  return socials;
}

function address(tags: Record<string, string>) {
  const street = [clean(tags["addr:housenumber"]), clean(tags["addr:street"])].filter(Boolean).join(" ");
  return [street, clean(tags["addr:city"]), clean(tags["addr:state"]), clean(tags["addr:postcode"])].filter(Boolean).join(", ");
}

function category(tags: Record<string, string>) {
  for (const key of ["amenity", "healthcare", "leisure", "sport", "tourism", "shop", "office", "studio"]) {
    if (clean(tags[key])) return `${key}:${clean(tags[key])}`;
  }
  return "public organization";
}

function toProspect(element: OsmElement, lane: ProspectLane): Prospect | null {
  const tags = element.tags || {};
  const name = clean(tags.name);
  if (!name || name.length > 180) return null;
  const sourceId = `${element.type}/${element.id}`;
  const email = publicEmail(tags);
  const website = publicWebsite(tags);
  const phone = publicPhone(tags);
  const location = address(tags);
  const evidence = [category(tags), location].filter(Boolean).join(" · ");
  const evidenceCount = [email, website, phone, location].filter(Boolean).length;
  return {
    sourceId,
    lane,
    name,
    email,
    phone,
    website,
    socials: publicSocials(tags, sourceId),
    tags: [
      "business:ChicagoShots",
      `lane:${lane}`,
      "market:Chicago",
      "business-prospect",
      "source:openstreetmap",
      email ? "email:published-business" : "email:research-needed",
      "consent:unknown",
    ],
    value: laneValue[lane],
    fitScore: Math.min(94, 64 + evidenceCount * 7 + (lane === "events-hospitality" || lane === "healthcare" ? 4 : 0)),
    notes: `${lanePitch[lane]} Public directory evidence: ${evidence || "named Chicago-area organization"}. Source record: https://www.openstreetmap.org/${sourceId}`,
    qualification: [
      `Publicly listed Chicago-area ${lane.replaceAll("-", " ")} organization`,
      email ? "Published business email found; permission still requires review" : "No published email found; research or contact form required",
      website ? "Public website available for fit review" : "Website requires verification",
    ],
  };
}

async function fetchLane(plan: (typeof lanePlans)[number]) {
  const cacheDir = join(tmpdir(), "phantomforce-public-prospect-cache");
  const queryHash = createHash("sha256").update(plan.query).digest("hex").slice(0, 16);
  const cachePath = join(cacheDir, `${plan.lane}-${queryHash}.json`);
  try {
    const cached = JSON.parse(await readFile(cachePath, "utf8")) as { savedAt?: string; elements?: OsmElement[] };
    const savedAt = Date.parse(cached.savedAt || "");
    if (Number.isFinite(savedAt) && Date.now() - savedAt < 86_400_000 && Array.isArray(cached.elements)) {
      return cached.elements.map((element) => toProspect(element, plan.lane)).filter((item): item is Prospect => Boolean(item));
    }
  } catch {
    // A cache miss is expected. The authoritative source is still Overpass.
  }
  const endpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.nchc.org.tw/api/interpreter",
  ];
  let lastError: unknown;
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
          "user-agent": "PhantomForce-ChicagoShots-CRM/1.0 (public prospect research)",
        },
        body: new URLSearchParams({ data: plan.query }),
        signal: AbortSignal.timeout(150_000),
      });
      if (!response.ok) throw new Error(`Overpass returned ${response.status}`);
      const payload = await response.json() as { elements?: OsmElement[] };
      await mkdir(cacheDir, { recursive: true });
      await writeFile(cachePath, JSON.stringify({ savedAt: new Date().toISOString(), elements: payload.elements || [] }), "utf8");
      return (payload.elements || []).map((element) => toProspect(element, plan.lane)).filter((item): item is Prospect => Boolean(item));
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Could not source ${plan.lane} prospects`);
}

function dedupeAndBalance(rows: Prospect[], limit: number) {
  const seenSources = new Set<string>();
  const seenOrganizations = new Set<string>();
  const selected: Prospect[] = [];
  for (const plan of lanePlans) {
    const laneRows = rows.filter((row) => row.lane === plan.lane);
    for (const row of laneRows) {
      const organizationKey = `${row.name.toLowerCase()}|${row.website ? new URL(row.website).hostname.replace(/^www\./, "") : ""}`;
      if (seenSources.has(row.sourceId) || seenOrganizations.has(organizationKey)) continue;
      seenSources.add(row.sourceId);
      seenOrganizations.add(organizationKey);
      selected.push(row);
      if (selected.filter((item) => item.lane === plan.lane).length >= plan.quota) break;
    }
  }
  if (selected.length < limit) {
    for (const row of rows) {
      const organizationKey = `${row.name.toLowerCase()}|${row.website ? new URL(row.website).hostname.replace(/^www\./, "") : ""}`;
      if (seenSources.has(row.sourceId) || seenOrganizations.has(organizationKey)) continue;
      seenSources.add(row.sourceId);
      seenOrganizations.add(organizationKey);
      selected.push(row);
      if (selected.length >= limit) break;
    }
  }
  return selected.slice(0, limit);
}

function summary(rows: Prospect[]) {
  return {
    total: rows.length,
    publishedBusinessEmails: rows.filter((row) => row.email).length,
    publicWebsites: rows.filter((row) => row.website).length,
    publicPhones: rows.filter((row) => row.phone).length,
    byLane: Object.fromEntries(lanePlans.map((plan) => [plan.lane, rows.filter((row) => row.lane === plan.lane).length])),
  };
}

async function main() {
  const orgId = argValue("org", DEFAULT_ORG);
  const limit = Math.max(1, Math.min(2_000, Number(argValue("limit", String(DEFAULT_LIMIT))) || DEFAULT_LIMIT));
  const apply = process.argv.includes("--apply");
  const results: Prospect[] = [];
  for (const plan of lanePlans) {
    const rows = await fetchLane(plan);
    results.push(...rows);
    process.stdout.write(`${plan.lane}: ${rows.length.toLocaleString()} public organizations found\n`);
  }
  const prospects = dedupeAndBalance(results, limit);
  const report = summary(prospects);
  process.stdout.write(`${JSON.stringify({ mode: apply ? "apply" : "dry-run", orgId, source: OSM_SOURCE, license: OSM_COPYRIGHT, ...report }, null, 2)}\n`);
  if (!apply) return;
  if (!prisma) throw new Error("DATABASE_URL is required to apply the prospect import.");
  const org = await prisma.org.findUnique({ where: { id: orgId }, select: { id: true, name: true } });
  if (!org) throw new Error(`Organization ${orgId} does not exist.`);
  const existing = await prisma.contact.findMany({
    where: { orgId },
    select: { organization: true, website: true, notes: true },
  });
  const existingKeys = new Set(existing.map((row) => `${clean(row.organization).toLowerCase()}|${clean(row.website).toLowerCase()}`));
  const existingSourceIds = new Set(existing.flatMap((row) => clean(row.notes).match(/openstreetmap\.org\/(?:node|way|relation)\/\d+/g) || []));
  const pending = prospects.filter((row) => {
    const key = `${row.name.toLowerCase()}|${clean(row.website).toLowerCase()}`;
    return !existingKeys.has(key) && !existingSourceIds.has(`openstreetmap.org/${row.sourceId}`);
  });
  const now = Date.now();
  const created = await prisma.$transaction(async (tx) => {
    const result = await tx.contact.createMany({
      data: pending.map((row, index) => ({
        orgId,
        name: row.name,
        organization: row.name,
        email: row.email,
        phone: row.phone,
        status: "new",
        type: "business-prospect",
        value: row.value,
        nextStep: row.email ? "Review fit, confirm permission, then approve a personalized email draft" : "Verify a public business email or approved contact channel",
        notes: row.notes,
        source: OSM_SOURCE,
        website: row.website,
        socials: row.socials,
        tags: row.tags,
        fitScore: row.fitScore,
        qualification: row.qualification,
        outreach: lanePitch[row.lane],
        crmStage: "Prospect research",
        dueAt: new Date(now + ((index % 21) + 1) * 86_400_000),
      })),
    });
    const current = await tx.crmSettings.findUnique({ where: { orgId } });
    const currentBrain = current?.brain && typeof current.brain === "object" && !Array.isArray(current.brain) ? current.brain as Record<string, unknown> : {};
    await tx.crmSettings.upsert({
      where: { orgId },
      create: {
        orgId,
        dailyPullTarget: 25,
        sourceMode: "public-research",
        notes: "ChicagoShots growth pipeline: weddings/events, healthcare, sports/fitness, education, and creative partners. Public business records only; no guessed email addresses.",
        brain: {
          kind: "phantomforce_org_crm_brain",
          version: 2,
          businessProfile: "ChicagoShots — Chicago video production for weddings, conferences, healthcare education, sports, podcasts, and brand content.",
          targetLanes: lanePlans.map((plan) => plan.lane),
          prospectSource: OSM_SOURCE,
          outreachPolicy: "Draft and review only until a live email connector returns provider receipts.",
          ...currentBrain,
        },
      },
      update: {
        dailyPullTarget: 25,
        sourceMode: "public-research",
        notes: "ChicagoShots growth pipeline: weddings/events, healthcare, sports/fitness, education, and creative partners. Public business records only; no guessed email addresses.",
        brain: {
          ...currentBrain,
          kind: "phantomforce_org_crm_brain",
          version: 2,
          businessProfile: "ChicagoShots — Chicago video production for weddings, conferences, healthcare education, sports, podcasts, and brand content.",
          targetLanes: lanePlans.map((plan) => plan.lane),
          prospectSource: OSM_SOURCE,
          outreachPolicy: "Draft and review only until a live email connector returns provider receipts.",
        },
      },
    });
    return result.count;
  }, { timeout: 60_000 });
  const batchId = createHash("sha256").update(`${orgId}|${new Date().toISOString()}|${created}`).digest("hex").slice(0, 20);
  await recordOrgAuditEvent({
    orgId,
    actor: "system:public-prospect-research",
    eventType: "crm_public_prospects_imported",
    targetType: "crm_batch",
    targetId: batchId,
    payload: {
      requested: limit,
      created,
      skippedExisting: prospects.length - pending.length,
      source: OSM_SOURCE,
      sourceLicense: OSM_COPYRIGHT,
      retrievedAt: new Date().toISOString(),
      publishedBusinessEmails: pending.filter((row) => row.email).length,
      byLane: summary(pending).byLane,
      outreachExecuted: false,
    },
  });
  process.stdout.write(`Applied ${created.toLocaleString()} sourced prospects to ${org.name}. No outreach was sent.\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma?.$disconnect();
  });
