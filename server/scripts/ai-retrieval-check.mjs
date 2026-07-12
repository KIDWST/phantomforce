/* Focused check: AI asset retrieval never surfaces withheld/deprecated assets. */
import { searchAssetsForAi } from "../src/assets/asset-service.js";
const ORG = process.env.CHECK_ORG || "dev-org-chicagoshots";
const hits = await searchAssetsForAi(ORG, "brand music voiceover portrait hero logo", 12);
const leaked = hits.filter((h) => { const f = h.flags || {}; return f.aiReferenceAllowed === false || f.deprecated; });
console.log(`retrieval returned ${hits.length}: ${JSON.stringify(hits.map((h) => h.title))}`);
console.log(leaked.length ? `FAIL — leaked: ${JSON.stringify(leaked.map((h) => h.title))}` : "PASS — no withheld/deprecated asset surfaced to AI");
process.exit(leaked.length ? 1 : 0);
