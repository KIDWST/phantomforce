import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const main = read("../app/js/main.js");
const module = read("../app/js/competitor-intelligence.js");
const css = read("../app/competitor-intelligence.css");
const index = read("../app/index.html");
const staticServer = read("../ops/admin-live/admin-static-server.mjs");
const service = read("../server/src/phantom-ai/competitor-intelligence.ts");

assert.match(main, /id:\s*"intelligence"[\s\S]*label:\s*"Competitor Intel"/u, "Competitor Intelligence must be native navigation.");
assert.match(main, /renderCompetitorIntelligence/u, "The workspace must use the intelligence renderer.");
assert.match(index, /competitor-intelligence\.css\?v=phantom-live-/u, "The dedicated stylesheet must load.");
assert.match(module, /Aggressive Intelligence/u, "Optional aggressive mode must be visible.");
assert.match(module, /data-ci-fuse/u, "Signal fusion must be interactive.");
assert.match(module, /aggregated theme/u, "Audience gaps must require aggregation.");
assert.match(module, /originality risk/u, "Creative analysis must expose similarity risk.");
assert.match(module, /lawful-use attestation/u, "Evidence intake must show lawful-use proof.");
assert.match(css, /@media\(max-width:767px\)/u, "Phone-specific responsive layout must exist.");
assert.match(staticServer, /urlPath\.startsWith\("\/api\/competitor-intelligence"\)/u, "Live admin must proxy intelligence APIs.");
assert.match(service, /PROHIBITED_PATTERNS/u, "A server-side hard boundary policy must exist.");
assert.match(service, /status:\s*"estimate"/u, "Inferences must be labeled estimates.");
assert.doesNotMatch(service, /from\s+["'](?:puppeteer|playwright)|child_process|execFile|spawn\(/iu, "The service must not implement scraping or bypass tooling.");
assert.doesNotMatch(module, /fetch\([^)]*https?:\/\//u, "The UI must not call competitor sites directly.");

console.log("Competitor Intelligence frontend and policy safety checks passed.");
