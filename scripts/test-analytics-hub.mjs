import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const analytics = read("../app/js/analytics-hub.js");
const main = read("../app/js/main.js");
const commandOs = read("../app/js/command-os.js");
const index = read("../app/index.html");
const css = read("../app/command-os.css");

assert.match(main, /shell\.dataset\.activeNav = activeNav/u, "Main navigation must publish its canonical active route.");
assert.match(main, /document\.documentElement\.dataset\.activeNav = activeNav/u, "The active route must be available to global navigation surfaces.");
assert.match(main, /Media library[\s\S]*Content queue[\s\S]*Social channels[\s\S]*Open pipeline/u, "The home brief must lead with the media-to-revenue loop.");
assert.match(main, /const cards = \[interactionsCard\(\), contentMomentumCard\(\), opportunityCard\(\), appointmentsCard\(\)\]/u, "The home signal deck must prioritize social and content performance.");
assert.doesNotMatch(main, /const cards = \[[^\n]*securityCard\(\)/u, "Security diagnostics must not displace marketing signals on the home deck.");
assert.match(index, /Media-to-revenue growth map[\s\S]*Media library[\s\S]*Content queue[\s\S]*Social channels[\s\S]*Approvals[\s\S]*Open pipeline[\s\S]*Attributed revenue/u, "The main growth map must tell the media-to-revenue story before operations diagnostics.");
assert.match(commandOs, /marketingInventory\(\)[\s\S]*setNode\([\s\S]*"revenue",[\s\S]*marketing\.assets[\s\S]*setNode\("clients", marketing\.drafts/u, "The growth map must be driven by real media and content inventory.");
assert.doesNotMatch(commandOs, /account\?\.profileUrl\s*\|\|\s*account\?\.handle/u, "A saved social profile must not be counted as a live provider connection.");
assert.doesNotMatch(main, /status === "linked" \|\| status === "connected" \|\| account\?\.profileUrl/u, "The dashboard must require verified social connection state.");
assert.match(main, /workspaceStorageGetItem\("pf\.social\.accounts\.v1"\)/u, "Social connection counts must remain scoped to the active workspace.");
assert.match(commandOs, /dataset\.activeNav[\s\S]*?side-nav/u, "Command OS must prefer canonical route state over the legacy side-nav fallback.");

assert.doesNotMatch(analytics, /Signal map|domainSignalMap/u, "Decorative signal maps must not be the analytics default.");
assert.match(analytics, /\{ id: "social", label: "Social Media" \}[\s\S]*\{ id: "games", label: "Game Analytics" \}/u, "Social media must be the first analytics domain while game analytics stays available in the dropdown.");
assert.match(analytics, /return ids\.has\("social"\) \? "social"/u, "Analytics must default to social media when the operator has not chosen another domain.");
assert.match(analytics, /Media &amp; marketing[\s\S]*Social analytics first/u, "The analytics shell must communicate the marketing-first hierarchy.");
assert.match(analytics, /<option value="overview" selected>Overview<\/option>/u, "Analytics must open on a useful overview.");
assert.match(analytics, /<option value="trend">Trend<\/option>/u, "Analytics must expose historical trends.");
assert.match(analytics, /<option value="compare">Breakdown<\/option>/u, "Analytics must expose ranked breakdowns.");
assert.match(analytics, /function domainLineChart/u, "Analytics must render a real time-series chart.");
assert.match(analytics, /function domainFunnel/u, "Analytics must render conversion funnels.");
assert.match(analytics, /function datedBuckets/u, "Dated records must be bucketed into the selected range.");
assert.match(analytics, /data-an-point/u, "Chart points must be keyboard and pointer inspectable.");
assert.match(analytics, /wireAnalyticsInteractions/u, "Charts must update a visible readout on interaction.");
assert.match(analytics, /No daily history is inferred from totals/u, "Aggregate counters must not be presented as invented history.");
assert.match(analytics, /Historical store events are not connected/u, "Missing event instrumentation must have an explicit empty state.");
assert.match(analytics, /renderCompetitorIntelligence\(root, \{ embedded: true \}\)/u, "Competitor intelligence must remain integrated.");
assert.match(analytics, /renderSocialAnalytics\(root/u, "Official audience analytics must remain integrated.");

assert.match(css, /\.an-visual-grid\.has-secondary/u, "Analytics must support a responsive primary and secondary visualization layout.");
assert.match(css, /\.an-line-chart svg/u, "Time-series SVGs must scale with their container.");
assert.match(css, /\.an-rank-row:hover,[\s\S]*?\.an-rank-row:focus-visible/u, "Ranked data must expose visible interactive states.");
assert.match(css, /@media \(max-width: 620px\)[\s\S]*?\.an-rank-row/u, "Analytics must have a compact mobile layout.");

console.log("Analytics hub route, visualization, and data-honesty checks passed.");
