import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const main = readFileSync(new URL("../app/js/main.js", import.meta.url), "utf8");
const index = readFileSync(new URL("../app/index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/phantom.css", import.meta.url), "utf8");
const command = readFileSync(new URL("../app/js/command.js", import.meta.url), "utf8");
const commandOsCss = readFileSync(new URL("../app/command-os.css", import.meta.url), "utf8");
const phantomAi = readFileSync(new URL("../app/js/phantomai.js", import.meta.url), "utf8");
const pageWorker = readFileSync(new URL("../app/js/pageworker.js", import.meta.url), "utf8");
const count = (source, pattern) => source.match(pattern)?.length || 0;

// Full chat (log + composer) moved off the dashboard into its own PhantomBot
// tab (app/js/phantomai.js, the "phantomai" workspace, reachable from the
// sidebar and the command rail). The dashboard keeps only a compact
// "PhantomPet" card (link into PhantomBot) — no composer or log, nothing here
// should compete with the PhantomBot tab for actual chatting. An earlier pass
// reused the old full companion.js chat-header widget (mountCompanion) here
// under a "hero2-phantompet" CSS class, which read as an embedded chatbot
// with no chat body under it — that regression is what this assertion now
// guards against explicitly.
assert.match(index, /class="phantompet-card"/u, "Dashboard must keep the compact PhantomPet status card.");
assert.doesNotMatch(index, /data-chatbox/u, "Dashboard must not re-embed companion.js's mountCompanion chat-header widget.");
assert.equal(count(index, /data-command-form/gu), 0, "Dashboard must not re-embed a command composer; PhantomBot is its own tab now.");
assert.equal(count(index, /data-chat-log/gu), 0, "Dashboard must not re-embed a chat log; PhantomBot is its own tab now.");
assert.match(main, /class="phantomai phantombot-os" data-phantombot-os/u, "PhantomBot must render as its own AI operating-system shell.");
assert.match(main, /data-phantombot-taskrail[\s\S]*data-phantombot-task-list/u, "PhantomBot must include a dedicated task rail and persistent task list.");
assert.match(main, /data-phantombot-new-task/u, "PhantomBot must provide an explicit new-task action.");
assert.match(main, /<textarea class="phantomai-chat-input" data-phantomai-chat-input/u, "PhantomBot must use a multiline composer instead of a single-line search-style input.");
assert.match(main, /Enter sends · Shift \+ Enter adds a line/u, "The multiline composer must explain its keyboard behavior.");
assert.doesNotMatch(main, /data-phantomai-chat-input type="text"/u, "PhantomBot must not regress to a single-line text field.");
assert.match(phantomAi, /const TASKS_KEY = "pf\.phantombot\.tasks\.v1"/u, "PhantomBot tasks must have a stable workspace persistence key.");
assert.match(phantomAi, /workspaceStorageGetItem\(TASKS_KEY,[\s\S]*workspaceStorageSetItem\(TASKS_KEY/u, "PhantomBot must load and save its task history through workspace-scoped storage.");
assert.match(phantomAi, /taskState\.tasks[\s\S]*activeId/u, "PhantomBot must track multiple tasks and one active task.");
assert.match(phantomAi, /say:\s*message\.say,[\s\S]*pending:\s*!!message\.pending,[\s\S]*error:\s*!!message\.error/u, "In-flight replies must remain pending in storage until a real reload converts them into interrupted recovery state.");
assert.match(phantomAi, /mountPhantomAI\(root\)[\s\S]*loadTaskState\(false\)/u, "Shell remounts must preserve an active in-memory request instead of reloading its recovery snapshot.");
assert.match(phantomAi, /event\.key === "Enter" && !event\.shiftKey && !event\.isComposing/u, "Enter must send while Shift+Enter remains available for a newline.");
assert.match(phantomAi, /Math\.min\(Math\.max\(input\.scrollHeight, 28\), 168\)/u, "The multiline composer must grow with its content while remaining bounded.");
assert.match(phantomAi, /data-phantombot-jump/u, "Long task conversations must provide a jump-to-latest control.");
assert.match(phantomAi, /event\.key\.toLowerCase\(\) === "n"/u, "PhantomBot must support the Ctrl/Cmd+N new-task shortcut.");
assert.match(pageWorker, /const SKIP_PAGES = new Set\(\[[\s\S]*"phantomai"[\s\S]*\]\);/u, "PhantomBot must skip the generic page-intelligence prompt because chat is the native primary surface.");
assert.doesNotMatch(index, /data-chatbox-toggle/u, "Phantom Console minimize belongs inside the rendered header, not stranded in static markup.");
assert.match(index, /data-dashboard-brief-title/u, "Dashboard must keep a data-backed business brief.");
assert.match(index, /data-dashboard-brief-status/u, "Dashboard must explain the real organization state.");
assert.match(index, /data-dashboard-brief-metrics/u, "Dashboard must keep its compact real-data snapshot.");
assert.match(index, /data-nav-bottom/u, "Desktop navigation must keep the utility section separate.");
assert.match(index, /data-plan/u, "Dashboard must retain the real owner-action summary.");
assert.match(index, /data-queue/u, "Dashboard must retain real work-in-motion status.");

assert.doesNotMatch(index, /data-command-widgets/u, "Removed expandable command cards must not return.");
assert.doesNotMatch(index, /data-mobile-command|data-mobile-bell|data-mobile-user-btn/u, "Mobile top chrome must not carry command, notification, or user navigation.");
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
// The drag/minimize/hotkey/right-click "Console" mobility subsystem
// (setChatboxMinimized, bindChatboxMobility, CHATBOX_POSITION_KEY, the
// Ctrl-backtick summon hotkey, etc.) only ever operated on the removed
// [data-chatbox] element. It has been deleted along with that element —
// see the phantompet-card assertions above — rather than left bound to
// nothing.
assert.doesNotMatch(main, /bindChatboxMobility/u, "Dead chatbox drag/hotkey subsystem must not come back once its target element is gone.");
assert.match(main, /const bottomItems = items;/u, "The dedicated utility zone must remain the full navigation launcher while the main sidebar shows open tabs.");
assert.match(main, /const MOBILE_DOCK_IDS = \["dashboard", "crm", "assets", "sites", "money"\]/u, "Phone dock must keep the five core destinations stable.");
assert.match(main, /data-mobile-more/u, "Phone dock must expose the complete navigation through More.");
assert.match(main, /setMobileNav\(!mobileNavOpen\)/u, "More must open and close the existing mobile drawer.");
assert.match(css, /\.mobile-bottom-nav\s*\{[\s\S]*?grid-template-columns:\s*repeat\(6, minmax\(0, 1fr\)\)/u, "Phone dock must fit six controls without horizontal clipping.");
assert.match(css, /Mobile shell cleanup: bottom dock only\.[\s\S]*?@media \(max-width: 900px\)[\s\S]*?--mobile-admin-topbar:\s*0px\s*!important/u, "Compact base shell must not reserve height for a second mobile nav bar.");
assert.match(css, /Mobile shell cleanup: bottom dock only\.[\s\S]*?@media \(max-width: 900px\)[\s\S]*?\.os-command-rail,[\s\S]*?\.mobile-admin-homebar\s*\{[\s\S]*?display:\s*none\s*!important/u, "Compact base shell must hide the top nav surfaces.");
assert.match(css, /Mobile shell cleanup: bottom dock only\.[\s\S]*?@media \(max-width: 900px\)[\s\S]*?\.sidebar:not\(\.is-expanded\)\s*\{[\s\S]*?display:\s*none\s*!important/u, "Compact base shell must remove the collapsed sidebar launcher so the bottom dock is the only mobile nav.");
assert.match(css, /Mobile shell cleanup: bottom dock only\.[\s\S]*?@media \(max-width: 900px\)[\s\S]*?\.mobile-bottom-nav\s*\{[\s\S]*?display:\s*grid\s*!important/u, "Compact base shell must keep the bottom dock visible through tablet-width mobile.");
assert.match(css, /Final compact nav guard:[\s\S]*?@media \(max-width: 900px\)[\s\S]*?\.topbar2,[\s\S]*?\.os-command-rail,[\s\S]*?\.mobile-admin-homebar,[\s\S]*?\.os-system-line\s*\{[\s\S]*?display:\s*none\s*!important/u, "Final compact guard must hide every top/status chrome bar on phones and narrow tablets.");
assert.match(css, /Final compact nav guard:[\s\S]*?@media \(max-width: 900px\)[\s\S]*?\.phantom > \.sidebar:not\(\.is-expanded\)\s*\{[\s\S]*?display:\s*none\s*!important/u, "Final compact guard must keep the collapsed sidebar hidden until More opens it.");
assert.match(css, /Final compact nav guard:[\s\S]*?@media \(max-width: 900px\)[\s\S]*?\.mobile-bottom-nav\s*\{[\s\S]*?display:\s*grid\s*!important/u, "Final compact guard must leave the bottom dock as the one mobile nav.");
assert.match(css, /@media \(max-width: 767px\)[\s\S]*?\.sidebar\s*\{[\s\S]*?display:\s*none\s*!important[\s\S]*?\.sidebar\.is-expanded\s*\{[\s\S]*?display:\s*flex\s*!important/u, "Phone sidebar must be drawer-only so it cannot duplicate the bottom nav.");
assert.match(css, /\.sidebar:not\(\.is-expanded\)\s*\{\s*display:\s*none\s*!important;\s*\}/u, "Final phone chrome must keep the sidebar hidden until More opens it.");
assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.ch-card-h\s*\{[\s\S]*?flex-direction:\s*column/u, "Analytics mobile card headers must stack instead of squeezing copy into one-word columns.");
assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.buddy\s*\{[\s\S]*?opacity:\s*0;[\s\S]*?pointer-events:\s*none/u, "Phone companion must not sit on top of mobile controls.");
assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.buddy-say\s*\{[\s\S]*?display:\s*none/u, "Phone companion speech must not create off-screen overflow.");
assert.match(css, /\.dashboard-brief\s*\{/u, "Compact business brief must have dashboard styling.");
assert.match(css, /\.dashboard-brief-metrics\s*\{/u, "Business snapshot must have a stable responsive layout.");
assert.match(css, /\.chatbox\.is-minimized\s*\{/u, "Phantom Console must have a real collapsed state.");
assert.match(css, /\.pc-minimize/u, "Phantom Console minimize must share the header action styling.");
assert.match(css, /\.pc-minimize\s*\{[\s\S]*?position:\s*absolute/u, "Console minimize control must be pinned to the panel corner, not the normal button row.");
assert.match(css, /\.console \.chatbox\.is-floating\s*\{[\s\S]*?position:\s*fixed !important/u, "Dragged console must float above the dashboard layout.");
assert.match(css, /\.console \.chatbox\.is-minimized\s*\{[\s\S]*?width:\s*min\(360px/u, "Minimized console must collapse into a compact dock pill.");
assert.match(css, /\.chatbox-context-menu\s*\{/u, "Console must expose a right-click context menu.");
assert.match(css, /\.chatbox\.is-typing::after/u, "Console must render a subtle Phantom presence while typing.");
assert.doesNotMatch(commandOsCss, /data-chatbox-minimized="true"[\s\S]{0,220}\.chatbox-head \.pc-actions,[\s\S]{0,280}display:\s*none\s*!important/u, "Collapsed Command OS must keep the restore control clickable.");
assert.match(commandOsCss, /\.chatbox-head \.pc-mode,[\s\S]*?\.chatbox-head \.pc-settings,[\s\S]*?\.chatbox-head \.pc-menu\s*\{[\s\S]*?display:\s*none\s*!important/u, "Collapsed Command OS should hide only non-restore header controls.");
assert.match(commandOsCss, /@media \(max-width: 900px\)[\s\S]*?\.phantom\.command-os-enabled \.os-command-rail\s*\{[\s\S]*?display:\s*none\s*!important/u, "Compact Command OS must not render a duplicate top navigation rail.");
assert.match(commandOsCss, /@media \(max-width: 900px\)[\s\S]*?--mobile-admin-topbar:\s*0px\s*!important/u, "Compact Command OS must not reserve height for a second mobile nav bar.");
assert.match(commandOsCss, /@media \(max-width: 900px\)[\s\S]*?\.phantom\.command-os-enabled \.mobile-admin-homebar\s*\{[\s\S]*?display:\s*none\s*!important/u, "Compact Command OS must hide the old mobile homebar so only the bottom dock remains.");
assert.match(commandOsCss, /@media \(max-width: 900px\)[\s\S]*?\.phantom\.command-os-enabled > \.sidebar:not\(\.is-expanded\)\s*\{[\s\S]*?display:\s*none\s*!important/u, "Compact Command OS must hide the desktop sidebar until More opens it.");
assert.match(commandOsCss, /@media \(max-width: 900px\)[\s\S]*?\.phantom\.command-os-enabled \.mobile-bottom-nav\s*\{[\s\S]*?display:\s*grid\s*!important/u, "Compact Command OS must keep exactly one bottom dock visible.");
assert.match(commandOsCss, /Compact layout ownership:[\s\S]*?\.phantom\.command-os-enabled \.console-center\s*\{[\s\S]*?flex-direction:\s*column\s*!important[\s\S]*?overflow:\s*visible\s*!important/u, "Compact dashboard surfaces must use one scrollable vertical flow.");
assert.match(commandOsCss, /Compact layout ownership:[\s\S]*?\.phantom\.command-os-enabled \.decision-deck\s*\{[\s\S]*?position:\s*relative\s*!important[\s\S]*?max-height:\s*none\s*!important/u, "Compact decisions must not be absolutely layered or vertically clipped.");
assert.match(commandOsCss, /Compact layout ownership:[\s\S]*?\.phantom\.command-os-enabled \.console:not\(\.console-workspace\) \.hero2-copy\s*\{[\s\S]*?position:\s*relative\s*!important/u, "Compact Phantom Console must participate in document flow instead of covering decisions.");
assert.match(commandOsCss, /Compact layout ownership:[\s\S]*?\.phantom\.command-os-enabled \.dashboard-intel-band\s*\{[\s\S]*?order:\s*4\s*!important/u, "Dashboard intelligence cards must sit below the compact brief and console, not above them like another nav bar.");
assert.match(main, /class="decision-review-all"[\s\S]*?data-open-ws="approvals"/u, "The compact decision preview must provide a direct route to the complete approvals queue.");
assert.match(commandOsCss, /Phone command surface:[\s\S]*?\.decision-list\s*\{[\s\S]*?grid-auto-flow:\s*row\s*!important[\s\S]*?overflow:\s*visible\s*!important/u, "Phone decisions must use a single-column flow instead of a sideways carousel.");
assert.match(commandOsCss, /Phone command surface:[\s\S]*?\.decision-card:nth-child\(n \+ 2\)\s*\{[\s\S]*?display:\s*none\s*!important/u, "Phone home must show one priority decision before the command surface.");
assert.match(commandOsCss, /Phone command surface:[\s\S]*?\.decision-card > p:not\(\.decision-evidence\)\s*\{[\s\S]*?display:\s*none\s*!important/u, "Phone home must keep the priority preview compact so the Phantom composer remains reachable.");
assert.match(commandOsCss, /Phone command surface:[\s\S]*?\.hero2-stage\s*\{[\s\S]*?display:\s*none\s*!important/u, "Phone home must remove the decorative Earth stage so the Phantom input stays reachable.");
assert.match(commandOsCss, /Final loaded mobile nav kill switch:[\s\S]*?@media \(max-width: 900px\)[\s\S]*?\.phantom \.topbar2,[\s\S]*?\.phantom \.os-command-rail,[\s\S]*?\.phantom \.mobile-admin-homebar,[\s\S]*?\.phantom \.os-system-line\s*\{[\s\S]*?display:\s*none\s*!important/u, "Last-loaded Command OS CSS must hide every duplicate compact top/status chrome surface.");
assert.match(commandOsCss, /Final loaded mobile nav kill switch:[\s\S]*?@media \(max-width: 900px\)[\s\S]*?\.phantom \.mobile-bottom-nav\s*\{[\s\S]*?display:\s*grid\s*!important/u, "Last-loaded Command OS CSS must leave the bottom dock as the only compact nav.");
assert.match(main, /chatAttachMedia\(r\.media\)/u, "Completed media must render inline in the dashboard chat.");
assert.match(main, /Byting cyberchips into the frame/u, "Creative render progress should have a specific Phantom voice.");
assert.match(css, /\.chat-media\s*\{/u, "Inline chat media needs a stable media card treatment.");

console.log("Compact command surface checks passed.");
