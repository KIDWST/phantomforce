import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const main = readFileSync(new URL("../app/js/main.js", import.meta.url), "utf8");
const index = readFileSync(new URL("../app/index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/phantom.css", import.meta.url), "utf8");

const widgetStart = main.indexOf("function renderCommandWidgets()");
const widgetEnd = main.indexOf("mount.innerHTML = cards.map(card).join(\"\");", widgetStart);
const widgetSource = widgetStart >= 0 && widgetEnd > widgetStart ? main.slice(widgetStart, widgetEnd) : "";

assert.match(index, /data-command-widgets/u, "Dashboard must keep the expandable command widget mount.");
assert.match(index, /data-hero-sub/u, "Dashboard hero must have a data-backed operating briefing line.");
assert.match(index, /data-hero-proof/u, "Dashboard hero must have a recent proof line for handled work.");
assert.match(index, /data-decision-deck/u, "Dashboard must have a real-data decision deck mount.");
assert.match(index, /data-command-snapshot/u, "Dashboard must have a 10-second command snapshot.");
assert.match(index, /data-outcome-strip/u, "Dashboard must have a first-class active outcomes section.");
assert.match(index, /data-operating-pulse/u, "Dashboard must show a compact operating pulse from real state.");
assert.match(index, /data-execution-timeline/u, "Dashboard must show the You / Phantom / Results execution timeline.");
assert.match(index, /data-unblock-center/u, "Dashboard must show real blockers only when Phantom needs owner input.");
assert.match(index, /data-handled-proof/u, "Dashboard must have a handled-work proof strip mount.");
assert.match(index, /data-quick-title>Next moves</u, "Right rail should lead with next moves, not generic quick actions.");
assert.match(index, /data-work-title>Work in motion</u, "Right rail should show work in motion, not an old mission queue.");
assert.match(index, /Open operating map/u, "Right rail map entry should read like an operating system, not a mission list.");
assert.match(index, /data-open-ws="settings" data-settings-target="loop"/u,
  "Chat tools must expose Loop/model settings directly.");
assert.doesNotMatch(index, /class="cmd-tool" data-open-ws="memory"/u,
  "Memory must not be a dashboard/chat shortcut; it belongs inside Phantom's brain layer.");
assert.doesNotMatch(index, /Tell me what you need<br \/>or choose a lane below/u,
  "Dashboard hero must not lead with generic chatbot framing.");
assert.match(widgetSource, /id:\s*"workforce"/u, "Workforce must stay available as a dashboard widget.");
assert.match(widgetSource, /id:\s*"automations"/u, "Automations must stay available as a dashboard widget.");
assert.match(widgetSource, /id:\s*"phantomwire"/u, "PhantomWire activity must be surfaced on the dashboard.");
assert.match(widgetSource, /renderCommandToolDock\(\)/u, "Workforce widget must show an inline worker dock.");
assert.match(widgetSource, /renderAutomationDock\(automations\)/u, "Automation widget must show an inline automation dock.");
assert.match(main, /function renderCommandToolDock\(\)/u, "Command surface should define the worker dock renderer.");
assert.match(main, /function renderAutomationDock\(automations = \[\]\)/u, "Command surface should define the automation dock renderer.");
assert.match(main, /function commandDepartmentMap\(tools = \[\]\)/u,
  "Workforce widget should condense real tool lanes into human departments.");
assert.match(main, /function operatingPulseItems\(\)/u,
  "Command dashboard should derive department pulse items from the real tool spine.");
assert.match(main, /function renderOperatingPulse\(\)/u,
  "Command dashboard should render the compact operating pulse.");
assert.match(main, /function commandSnapshotItems\(\)/u,
  "Command dashboard should derive a 10-second snapshot from real state.");
assert.match(main, /function renderCommandSnapshot\(\)/u,
  "Command dashboard should render the 10-second command snapshot.");
assert.match(main, /label:\s*"Health"[\s\S]*?label:\s*"Needs"[\s\S]*?label:\s*"Moving"[\s\S]*?label:\s*"Result"[\s\S]*?label:\s*"Next"/u,
  "Command snapshot must summarize health, needs, movement, results, and next action.");
assert.match(main, /function executionTimelineLanes\(\)/u,
  "Command dashboard should derive execution lanes from real state.");
assert.match(main, /function renderExecutionTimeline\(\)/u,
  "Command dashboard should render the execution timeline.");
assert.match(main, /function unblockCenterItems\(\)/u,
  "Command dashboard should derive unblock cards from real blockers.");
assert.match(main, /function renderUnblockCenter\(\)/u,
  "Command dashboard should render the compact unblock center.");
assert.match(main, /visible\(store\.state\.approvals \|\| \[\]\)[\s\S]*?status === "pending"/u,
  "Unblock center must include pending approvals as real owner gates.");
assert.match(main, /visible\(store\.state\.agents \|\| \[\]\)[\s\S]*?\["blocked", "needs-approval", "waiting"\]/u,
  "Unblock center must include blocked or waiting worker lanes.");
assert.match(main, /renderOutcomeStrip\(\);[\s\S]*?renderOperatingPulse\(\);[\s\S]*?renderHandledProofDeck\(\);/u,
  "Console render order should put the operating pulse between outcomes and handled proof.");
assert.match(main, /lane:\s*"You"[\s\S]*?lane:\s*"Phantom"[\s\S]*?lane:\s*"Results"/u,
  "Execution timeline must keep the planner lanes: You, Phantom, Results.");
assert.match(main, /class="cw-dept-map"/u,
  "Workforce widget should render as a compact department map, not a raw worker list.");
assert.match(main, /class="cw-automation-empty"/u,
  "Automation widget should show a clean real-empty state instead of pretending starter recipes are running.");
assert.match(main, /data-command-run="Create a daily content ideas automation"/u,
  "Automation widget should let the owner create an automation from the command surface.");
assert.match(main, /function renderOutcomePath\(\{ plan = \[\], attention = \[\], approvals = \[\], automations = \[\], activity = \[\], leads = \{\}, media = \{\}, money = \{\} \} = \{\}\)/u,
  "Outcome board must render a real operating path from existing state.");
assert.match(main, /function operatingBriefingText\(\{ includePrompt = false \} = \{\}\)/u,
  "Dashboard hero must derive its briefing from real operating state.");
assert.doesNotMatch(main, /<h2>Today's plan<\/h2>/u,
  "Owner-action rail should not use calendar dashboard language.");
assert.match(main, /<h2>Need from you<\/h2>/u,
  "Owner-action rail should explain what Phantom needs from the owner.");
assert.match(main, /function recentHandledProof\(\)/u,
  "Dashboard hero must be able to surface recent handled activity without fake examples.");
assert.match(main, /function handledProofItems\(\)/u,
  "Command surface must derive handled-work proof from real activity only.");
assert.match(main, /deck\.hidden = items\.length === 0/u,
  "Handled proof strip must disappear when no real activity exists.");
assert.match(main, /function nextMoveActions\(\)/u,
  "Right rail must derive next moves from real attention and plan state.");
assert.match(main, /function workInMotionItems\(\)/u,
  "Right rail must derive work in motion from real agents and proof activity.");
assert.match(main, /store\.state\.activity[\s\S]*?badge:\s*"PROOF"/u,
  "Work in motion should include real handled activity as proof, not fake missions.");
assert.match(main, /renderedNextMoves\[.*quick\.dataset\.quick.*\] \|\| QUICK/u,
  "Visible next-move clicks must execute the rendered data-driven action.");
assert.match(main, /function renderDecisionDeck\(\)/u,
  "Command surface must render structured decision cards from attention state.");
assert.match(main, /function activeOutcomeItems\(\)/u,
  "Command surface must derive active outcomes from plan and attention state.");
assert.match(main, /function renderOutcomeStrip\(\)/u,
  "Command surface must render outcomes as a first-class operating section.");
assert.match(main, /data-command-run="Create my first business outcome"/u,
  "Outcome section should let a clean account capture a result, not pick a tab.");
assert.match(main, /renderDecisionDeck\(\);[\s\S]*?renderOutcomeStrip\(\);[\s\S]*?renderHandledProofDeck\(\);/u,
  "Console render order should put outcomes between decisions and handled proof.");
assert.match(main, /kind:\s*"agent-failure"[\s\S]*?weight:\s*390/u,
  "Decision signals must carry explicit kinds and priority weights.");
assert.match(main, /return items\.sort\(\(a, b\) => \(b\.weight \|\| 0\) - \(a\.weight \|\| 0\)\);/u,
  "Attention signals must be ranked before the bell, strip, and decision deck render them.");
assert.match(main, /function decisionMetaLabel\(item = \{\}\)/u,
  "Decision cards must explain why each card is actionable.");
assert.match(main, /function decisionWhyText\(item = \{\}\)/u,
  "Decision cards must explain why each signal matters.");
assert.match(main, /function decisionEvidenceText\(item = \{\}\)/u,
  "Decision cards must show the evidence behind the signal.");
assert.match(main, /function decisionConfidenceText\(item = \{\}\)/u,
  "Decision cards must show confidence instead of generic source text.");
assert.match(main, /const items = attentionItems\(\)\.slice\(0, 3\);/u,
  "Decision deck must reuse the same real attention source and stay capped.");
assert.match(main, /deck\.hidden = items\.length === 0/u,
  "Decision deck must disappear when there are no real signals.");
assert.match(main, /data-open-ws="\$\{esc\(item\.open \|\| "activity"\)\}"/u,
  "Decision cards must only open existing workspaces.");
assert.match(css, /\.cw-dock\s*\{/u, "Expanded command widgets must have visual dock styling.");
assert.match(css, /\.cw-flow\s*\{/u, "Outcome widget must show a compact Signal/Decision/Work/Result flow.");
assert.match(css, /\.cw-dept-map\s*\{/u, "Workforce widget must have visual department-map styling.");
assert.match(css, /\.cw-automation-empty\s*\{/u, "Automation widget must have a clean empty-state dock.");
assert.match(css, /\.cw-dock-node::before/u, "Command dock nodes should expose visible status dots.");
assert.match(css, /\.hero2-proof\s*\{/u, "Recent handled proof line must have compact dashboard styling.");
assert.match(css, /\.decision-deck\s*\{/u, "Decision deck must have compact command-center styling.");
assert.match(css, /\.decision-intel\s*\{/u, "Decision deck must style why/evidence context compactly.");
assert.match(css, /\.command-snapshot\s*\{/u, "Command snapshot must have compact command-center styling.");
assert.match(css, /\.snap-grid\s*\{/u, "Command snapshot must scan as a compact grid.");
assert.match(css, /\.outcome-strip\s*\{/u, "Active outcomes must have a dedicated command-center surface.");
assert.match(css, /\.operating-pulse\s*\{/u, "Operating pulse must have a compact command-center surface.");
assert.match(css, /@keyframes operatingPulse/u, "Operating pulse should animate department readiness, not decorative thinking.");
assert.match(css, /\.execution-timeline\s*\{/u, "Execution timeline must have compact dashboard styling.");
assert.match(css, /@keyframes executionFlow/u, "Execution timeline should animate real work flow.");
assert.match(css, /\.unblock-center\s*\{/u, "Unblock center must have compact command-center styling.");
assert.match(css, /\.unblock-card\s*\{/u, "Unblock center must render each blocker as an actionable card.");
assert.match(css, /@keyframes outcomeProgress/u, "Outcome cards should animate operational progress, not decorative thinking.");
assert.match(css, /\.handled-proof\s*\{/u, "Handled proof strip must have compact proof styling.");
assert.match(css, /\.quick-item i\s*\{/u, "Next move rail must support compact evidence subtext.");
assert.doesNotMatch(widgetSource, /id:\s*"memory"/u, "Memory should not consume a dashboard widget slot.");
assert.doesNotMatch(main, /memoryStats\s*\(/u, "Dashboard widgets should not depend on Memory stats.");
assert.match(main, /id:\s*"automation"[\s\S]*?navHidden:\s*true/u, "Automations should stay out of primary navigation.");
assert.match(main, /id:\s*"workers"[\s\S]*?navHidden:\s*true/u, "Workforce should stay out of primary navigation.");
assert.match(main, /id:\s*"memory"[\s\S]*?navHidden:\s*true/u, "Memory should stay out of primary navigation.");

console.log("command surface checks passed");
