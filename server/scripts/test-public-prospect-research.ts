import assert from "node:assert/strict";

import { researchPublicProspects } from "../src/crm/public-prospect-research.js";

const directoryUrls: string[] = [];
const directoryBodies: string[] = [];
const websiteUrls: string[] = [];
const fetchStub: typeof fetch = async (input, init) => {
  const url = String(input);
  if (url.includes("overpass")) {
    directoryUrls.push(url);
    directoryBodies.push(String(init?.body || ""));
    return new Response(JSON.stringify({
      elements: [
        {
          type: "node",
          id: 101,
          tags: {
            name: "Elgin Strength Lab",
            leisure: "fitness_centre",
            "contact:email": "hello@elginstrength.example",
            "contact:phone": "+1 847 555 0101",
            "contact:website": "elginstrength.example",
            "addr:city": "Elgin",
            "addr:state": "IL",
          },
        },
        {
          type: "way",
          id: 202,
          tags: {
            name: "Fox Valley Floral Studio",
            shop: "florist",
            email: "not-a-public-email;second@example.test",
            website: "https://foxvalleyfloral.example/services",
            "addr:city": "Elgin",
            "addr:state": "IL",
          },
        },
        { type: "node", id: 303, tags: { leisure: "fitness_centre" } },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  websiteUrls.push(url);
  if (url === "https://elginstrength.example/") {
    return new Response('<html><a href="https://instagram.com/elginstrength">Instagram</a></html>', { status: 200, headers: { "content-type": "text/html" } });
  }
  if (url === "https://foxvalleyfloral.example/services") {
    return new Response('<html><a href="/contact">Contact us</a></html>', { status: 200, headers: { "content-type": "text/html" } });
  }
  if (url === "https://foxvalleyfloral.example/contact") {
    return new Response('<html><a href="mailto:hello@foxvalleyfloral.example">Email</a><a href="tel:+18475550102">Call</a><a href="https://facebook.com/foxvalleyfloral">Facebook</a></html>', { status: 200, headers: { "content-type": "text/html" } });
  }
  return new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
};

const result = await researchPublicProspects({
  count: 10,
  prompt: "Find gyms and wedding vendors in Elgin IL",
  audience: "local businesses",
  fetchImpl: fetchStub,
  resolveImpl: async () => [{ address: "203.0.113.10" }],
});

assert.equal(directoryUrls.length, 3, "Research must race the trusted directory mirrors instead of waiting on them serially.");
assert.ok(directoryUrls.every((url) => /^https:\/\/overpass(?:-api\.de|\.kumi\.systems|\.private\.coffee)/u.test(url)), "Research must call only configured OpenStreetMap Overpass endpoints.");
assert.ok(directoryBodies.every((body) => body === directoryBodies[0]), "Every mirror must receive the same combined audience query.");
assert.match(decodeURIComponent(directoryBodies[0]), /41\.95,-88\.42,42\.14,-88\.17/u, "Elgin requests must use the Elgin market boundary.");
assert.match(decodeURIComponent(directoryBodies[0]), /fitness_centre/u, "The query must include the requested fitness audience.");
assert.match(decodeURIComponent(directoryBodies[0]), /florist/u, "The query must include the requested wedding audience.");
assert.deepEqual(websiteUrls, [
  "https://elginstrength.example/",
  "https://foxvalleyfloral.example/services",
  "https://foxvalleyfloral.example/contact",
], "Website enrichment must stay bounded to each official site and at most one same-site contact page.");
assert.equal(result.provider, "openstreetmap");
assert.equal(result.providerCalled, true);
assert.equal(result.market, "Elgin, Illinois");
assert.equal(result.requested, 10);
assert.equal(result.limitApplied, 10);
assert.equal(result.directoryCandidates, 2);
assert.equal(result.excludedExistingSources, 0);
assert.equal(result.candidates.length, 2, "Unnamed directory records must not become prospects.");

const gym = result.candidates.find((candidate) => candidate.name === "Elgin Strength Lab");
const florist = result.candidates.find((candidate) => candidate.name === "Fox Valley Floral Studio");
assert.ok(gym);
assert.ok(florist);
assert.equal(gym.email, "hello@elginstrength.example", "Only a published business email may be retained.");
assert.equal(florist.email, "hello@foxvalleyfloral.example", "A literal mailto address on the official website may enrich a missing business email.");
assert.equal(florist.phone, "+18475550102", "A literal tel link on the official website may enrich a missing business phone.");
assert.equal(gym.sourceUrl, "https://www.openstreetmap.org/node/101");
assert.equal(florist.sourceUrl, "https://www.openstreetmap.org/way/202");
assert.equal(gym.socials.source, gym.sourceUrl, "Every prospect must carry its source record into the CRM.");
assert.equal(florist.socials.officialWebsiteSource, "https://foxvalleyfloral.example/contact", "Website-enriched fields must retain the exact public evidence page.");
assert.equal(florist.socials.facebook, "https://facebook.com/foxvalleyfloral", "Official-site social links may be retained without guessing handles.");
assert.deepEqual(result.websiteEnrichment, {
  attempted: 2,
  verified: 2,
  publishedEmailsAdded: 1,
  publishedPhonesAdded: 1,
  failed: 0,
  capped: false,
});
assert.ok(result.candidates.every((candidate) => candidate.tags.includes("consent:unknown")), "Research must never invent outreach consent.");
assert.ok(result.candidates.every((candidate) => candidate.tags.includes("source:openstreetmap")), "Every prospect must retain source provenance.");
assert.ok(result.candidates.every((candidate) => !candidate.email || candidate.tags.includes("email:published-business")), "Only published business emails may be tagged as available.");
assert.match(result.sourceLicense, /openstreetmap\.org\/copyright/u);

const continuation = await researchPublicProspects({
  count: 10,
  prompt: "Find gyms and wedding vendors in Elgin IL",
  audience: "local businesses",
  fetchImpl: fetchStub,
  resolveImpl: async () => [{ address: "203.0.113.10" }],
  excludeSourceIds: ["node/101"],
});
assert.equal(continuation.directoryCandidates, 2);
assert.equal(continuation.excludedExistingSources, 1);
assert.deepEqual(continuation.candidates.map((candidate) => candidate.sourceId), ["way/202"],
  "A repeated account pull must continue past already-saved source records instead of returning the same first row.");
assert.equal(directoryUrls.length, 3, "A repeated pull should reuse the bounded directory cache.");
assert.equal(websiteUrls.length, 3, "A repeated pull should reuse cached public website evidence.");

let privateWebsiteFetches = 0;
const privateTargetResult = await researchPublicProspects({
  count: 1,
  prompt: "Find doctors in Elgin IL",
  fetchImpl: async (input) => {
    const url = String(input);
    if (url.includes("overpass")) {
      return new Response(JSON.stringify({ elements: [{
        type: "node", id: 404, tags: {
          name: "Blocked Private Clinic", amenity: "doctors", website: "http://127.0.0.1/internal", "addr:city": "Elgin", "addr:state": "IL",
        },
      }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    privateWebsiteFetches += 1;
    throw new Error("A private-network website must never be requested.");
  },
  resolveImpl: async () => [{ address: "127.0.0.1" }],
});
assert.equal(privateWebsiteFetches, 0, "Private-network website targets must be blocked before any request.");
assert.equal(privateTargetResult.websiteEnrichment.attempted, 1);
assert.equal(privateTargetResult.websiteEnrichment.failed, 1);
assert.equal(privateTargetResult.candidates[0]?.email, null, "A blocked target must never produce contact data.");

console.log(JSON.stringify({
  ok: true,
  product: "Account-scoped public prospect research",
  market: result.market,
  candidates: result.candidates.length,
  publishedBusinessEmails: result.candidates.filter((candidate) => candidate.email).length,
  websiteEnrichment: result.websiteEnrichment,
  continuationExcludedSources: continuation.excludedExistingSources,
  privateNetworkWebsiteFetches: privateWebsiteFetches,
  consent: "unknown",
  outreachExecuted: false,
}, null, 2));
