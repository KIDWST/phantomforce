import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const main = readFileSync(new URL("../app/js/main.js", import.meta.url), "utf8");
const index = readFileSync(new URL("../app/index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/phantom.css", import.meta.url), "utf8");
const count = (source, pattern) => source.match(pattern)?.length || 0;

assert.equal(count(index, /class="chatbox"/gu), 1, "Dashboard must have one primary Phantom chat surface.");
assert.equal(count(index, /data-command-form/gu), 1, "Dashboard must have one command composer.");
assert.doesNotMatch(index, /data-chatbox-toggle/u, "Phantom Console minimize belongs inside the rendered header, not stranded in static markup.");
assert.match(index, /data-dashboard-brief-title/u, "Dashboard must keep a data-backed business brief.");
assert.match(index, /data-dashboard-brief-status/u, "Dashboard must explain the real organization state.");
assert.match(index, /data-dashboard-brief-metrics/u, "Dashboard must keep its compact real-data snapshot.");
assert.match(index, /data-nav-bottom/u, "Desktop navigation must keep the utility section separate.");
assert.match(index, /data-plan/u, "Dashboard must retain the real owner-action summary.");
assert.match(index, /data-queue/u, "Dashboard must retain real work-in-motion status.");

assert.doesNotMatch(index, /data-command-widgets/u, "Removed expandable command cards must not return.");
assert.doesNotMatch(index, /data-operating-spaces/u, "Dashboard must not duplicate navigation as operating-space cards.");
assert.doesNotMatch(index, /data-command-snapshot/u, "Dashboard must not duplicate the business brief with another snapshot.");
assert.doesNotMatch(index, /class="quick-card"/u, "Removed quick-action card must stay removed.");
assert.doesNotMatch(index, /class="chatbox-tools"/u, "Chat must not carry a second row of settings/navigation buttons.");
assert.doesNotMatch(main, /The brain picks the lightest model/u, "Dashboard copy must show intelligence through behavior instead of explaining model routing.");

assert.match(main, /function renderDashboardBrief\(\)/u, "Dashboard brief must be rendered from application state.");
assert.match(main, /const plan = todaysPlan\(\)/u, "Dashboard brief must use real plan state.");
assert.match(main, /const leads = visible\(store\.state\.leads \|\| \[\]\)/u, "Dashboard brief must use organization-scoped leads.");
assert.match(main, /const accounting = moneyView\(\)/u, "Dashboard brief must use confirmed accounting state.");
assert.match(main, /renderDashboardBrief\(\);/u, "Console render must refresh the dashboard brief.");
assert.match(main, /setChatboxMinimized\(!chatbox\?\.classList\.contains\("is-minimized"\)\)/u, "Console minimize must toggle from the live DOM state.");
assert.match(main, /const bottomItems = items;/u, "The dedicated utility zone must remain the full navigation launcher while the main sidebar shows open tabs.");
assert.match(main, /const MOBILE_DOCK_IDS = \["dashboard", "crm", "media", "sites", "money"\]/u, "Phone dock must keep the five core destinations stable.");
assert.match(main, /data-mobile-more/u, "Phone dock must expose the complete navigation through More.");
assert.match(main, /setMobileNav\(!mobileNavOpen\)/u, "More must open and close the existing mobile drawer.");
assert.match(css, /\.mobile-bottom-nav\s*\{[\s\S]*?grid-template-columns:\s*repeat\(6, minmax\(0, 1fr\)\)/u, "Phone dock must fit six controls without horizontal clipping.");
assert.doesNotMatch(css, /\.sidebar\s*\{\s*display:\s*none\s*!important;\s*\}/u, "Phone CSS must not disable the complete navigation drawer.");
assert.match(css, /\.dashboard-brief\s*\{/u, "Compact business brief must have dashboard styling.");
assert.match(css, /\.dashboard-brief-metrics\s*\{/u, "Business snapshot must have a stable responsive layout.");
assert.match(css, /\.chatbox\.is-minimized\s*\{/u, "Phantom Console must have a real collapsed state.");
assert.match(css, /\.pc-minimize/u, "Phantom Console minimize must share the header action styling.");

console.log("Compact command surface checks passed.");
