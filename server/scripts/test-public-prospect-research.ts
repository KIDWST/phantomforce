import assert from "node:assert/strict";

import { researchPublicProspects } from "../src/crm/public-prospect-research.js";

const requestUrls: string[] = [];
const requestBodies: string[] = [];
let requestCount = 0;
const fetchStub: typeof fetch = async (input, init) => {
  requestCount += 1;
  requestUrls.push(String(input));
  requestBodies.push(String(init?.body || ""));
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
};

const result = await researchPublicProspects({
  count: 10,
  prompt: "Find gyms and wedding vendors in Elgin IL",
  audience: "local businesses",
  fetchImpl: fetchStub,
});

assert.equal(requestCount, 3, "Research must race the trusted directory mirrors instead of waiting on them serially.");
assert.ok(requestUrls.every((url) => /^https:\/\/overpass(?:-api\.de|\.kumi\.systems|\.private\.coffee)/u.test(url)), "Research must call only configured OpenStreetMap Overpass endpoints.");
assert.ok(requestBodies.every((body) => body === requestBodies[0]), "Every mirror must receive the same combined audience query.");
assert.match(decodeURIComponent(requestBodies[0]), /41\.95,-88\.42,42\.14,-88\.17/u, "Elgin requests must use the Elgin market boundary.");
assert.match(decodeURIComponent(requestBodies[0]), /fitness_centre/u, "The query must include the requested fitness audience.");
assert.match(decodeURIComponent(requestBodies[0]), /florist/u, "The query must include the requested wedding audience.");
assert.equal(result.provider, "openstreetmap");
assert.equal(result.providerCalled, true);
assert.equal(result.market, "Elgin, Illinois");
assert.equal(result.requested, 10);
assert.equal(result.limitApplied, 10);
assert.equal(result.candidates.length, 2, "Unnamed directory records must not become prospects.");

const gym = result.candidates.find((candidate) => candidate.name === "Elgin Strength Lab");
const florist = result.candidates.find((candidate) => candidate.name === "Fox Valley Floral Studio");
assert.ok(gym);
assert.ok(florist);
assert.equal(gym.email, "hello@elginstrength.example", "Only a published business email may be retained.");
assert.equal(florist.email, null, "Ambiguous or multi-address email fields must be rejected, not guessed.");
assert.equal(gym.sourceUrl, "https://www.openstreetmap.org/node/101");
assert.equal(florist.sourceUrl, "https://www.openstreetmap.org/way/202");
assert.equal(gym.socials.source, gym.sourceUrl, "Every prospect must carry its source record into the CRM.");
assert.ok(result.candidates.every((candidate) => candidate.tags.includes("consent:unknown")), "Research must never invent outreach consent.");
assert.ok(result.candidates.every((candidate) => candidate.tags.includes("source:openstreetmap")), "Every prospect must retain source provenance.");
assert.ok(result.candidates.every((candidate) => !candidate.email || candidate.tags.includes("email:published-business")), "Only published business emails may be tagged as available.");
assert.match(result.sourceLicense, /openstreetmap\.org\/copyright/u);

console.log(JSON.stringify({
  ok: true,
  product: "Account-scoped public prospect research",
  market: result.market,
  candidates: result.candidates.length,
  publishedBusinessEmails: result.candidates.filter((candidate) => candidate.email).length,
  consent: "unknown",
  outreachExecuted: false,
}, null, 2));
