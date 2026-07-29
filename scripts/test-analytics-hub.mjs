import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const analytics = read("../app/js/analytics-hub.js");
const main = read("../app/js/main.js");
const commandOs = read("../app/js/command-os.js");
const css = read("../app/command-os.css");

assert.match(main, /shell\.dataset\.activeNav = activeNav/u, "Main navigation must publish its canonical active route.");
assert.match(main, /document\.documentElement\.dataset\.activeNav = activeNav/u, "The active route must be available to global navigation surfaces.");
assert.match(commandOs, /dataset\.activeNav[\s\S]*?side-nav/u, "Command OS must prefer canonical route state over the legacy side-nav fallback.");

assert.doesNotMatch(analytics, /Signal map|domainSignalMap/u, "Decorative signal maps must not be the analytics default.");
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
