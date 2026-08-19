import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const index = read("../app/index.html");
const main = read("../app/js/main.js");
const bot = read("../app/js/phantomai.js");
const settings = read("../app/js/settings.js");
const css = read("../app/phantombot-next.css");

for (const selector of [
  "data-phantombot-mission-hud",
  "data-phantombot-hud-state",
  "data-phantombot-hud-context",
  "data-phantombot-hud-artifacts",
  "data-phantombot-hud-approval",
  "data-phantombot-pin-active",
  "data-phantombot-manage-session",
  "data-phantombot-session-name",
  "data-phantombot-export-session",
  "data-phantombot-archive-session",
]) {
  assert.match(main, new RegExp(selector), `PhantomBot markup must include ${selector}.`);
}

assert.doesNotMatch(main, /data-phantombot-mode(?:\s|=|>)/u, "The composer must never ask users to choose Answer, Build, Research, or Operate.");
assert.doesNotMatch(main, /PhantomBot working mode/u, "The retired mode selector must not return.");
assert.doesNotMatch(bot, /WORK_MODES|applyWorkingMode|task\.mode|phantombotMode|PhantomBot working mode/u, "Conversation state and outbound prompts must remain mode-free.");
for (const retiredLabel of ["Answer mode", "Build mode", "Research mode", "Operate mode"]) {
  assert.doesNotMatch(`${main}\n${bot}`, new RegExp(retiredLabel, "u"), `${retiredLabel} must stay retired.`);
}

assert.match(main, /Adapts automatically · workspace context ready/u, "The mission HUD must explain automatic adaptation without exposing modes.");
assert.match(main, /Ask a question or describe what you want done/u, "The composer must accept questions and work in one continuous surface.");
assert.match(bot, /const UNIFIED_STARTERS[\s\S]*function inferredNextMoves/u, "One composer must expose unified starters and infer useful next moves from context.");
assert.match(bot, /task\.messages\.flatMap\(\(message\) => \[message\.q, message\.say\]\)/u, "Session search must include the full transcript.");
assert.match(bot, /function paintSessionHud[\s\S]*Adapts automatically/u, "The mission HUD must reflect live session state without a mode label.");
assert.match(bot, /function nextMovesHtml[\s\S]*inferredNextMoves/u, "Completed responses must derive contextual next moves automatically.");
assert.match(bot, /function saveSessionName[\s\S]*function archiveActiveTask[\s\S]*function exportActiveTask/u, "Sessions must support rename, archive, and export.");
assert.match(bot, /operator\?\.state === "awaiting_approval"[\s\S]*Approval needed/u, "Approval state must remain explicit and visible.");
assert.match(bot, /const outbound = composeMessage\(prompt, attachments\)/u, "The exact user request must route without a mode directive appended.");
assert.match(bot, /handleSmartCommand\(outbound, \{ effort: task\.effort \|\| "instant" \}\)/u, "The automatic intent router must receive every ordinary message directly.");
assert.doesNotMatch(bot, /data-phantombot-next[^\n]{0,220}(?:requestSubmit|submitPrompt)/u, "Recommended next moves must fill the composer without silently executing.");

assert.match(main, /data-phantombot-model aria-haspopup="menu"/u, "The composer model control must expose a real menu instead of a dead listbox.");
assert.match(bot, /function paintModelMenu[\s\S]*data-phantombot-brain-auto[\s\S]*data-phantombot-brain-provider/u, "The composer must offer automatic routing and exact provider/model choices.");
assert.match(settings, /export function getOperatorBrainChoices/u, "Settings must expose the canonical organization brain choices to PhantomBot.");
assert.match(settings, /export async function setOperatorBrainChoice[\s\S]*await persistAiRuntimeConfig\(next\)[\s\S]*saveOperatorSettings\(previous\)/u, "A model change must persist server-side and roll local state back if persistence fails.");
assert.match(bot, /data-phantombot-manage-models[\s\S]*pf\.settings\.tab\.v1", "model"/u, "The model picker must link directly to full connection and custom-model management.");
assert.match(bot, /brain\.status\.configured[\s\S]*now powers this organization[\s\S]*selected · \$\{brain\.status\.detail\}/u, "A selected but unavailable model must never be described as actively powering the organization.");

assert.match(main, /data-phantombot-toggle-archives[\s\S]*data-phantombot-archive-list/u, "Archived sessions must have a recoverable rail surface.");
assert.match(bot, /function unarchiveTask[\s\S]*task\.archived = false/u, "Archived sessions must be restorable without data loss.");
assert.match(bot, /pendingAttachments\.some\(\(attachment\) => attachment\.status === "reading"\)[\s\S]*will stay here until they are ready/u, "Sending while files are still being read must preserve them and explain the wait.");
assert.match(bot, /submitPrompt\(message\.q, message\.attachments \|\| \[\]\)/u, "Retry must preserve the original attachments.");
assert.match(bot, /PhantomBot accepts up to 8 files per message[\s\S]*25 MB file limit/u, "Attachment limits must be explicit instead of silently dropping files.");

assert.match(main, /data-phantombot-session-menu hidden role="dialog" aria-modal="true"/u, "Session management must expose modal dialog semantics.");
assert.match(main, /data-phantombot-context-drawer hidden role="dialog" aria-modal="true"/u, "The session detail drawer must expose modal dialog semantics.");
assert.match(bot, /function trapModalFocus[\s\S]*event\.key !== "Tab"/u, "PhantomBot dialogs must trap keyboard focus.");
assert.match(bot, /function openCompactRail[\s\S]*aria-modal[\s\S]*stage\.setAttribute\("inert"/u, "The compact task rail must protect background content from keyboard interaction.");
assert.match(bot, /if \(event\.key === "Escape"\)[\s\S]*closeSessionMenu\(\{ restoreFocus: true \}\)[\s\S]*closeDetailDrawer\(\{ restoreFocus: true \}\)[\s\S]*closeCompactRail\(\{ restoreFocus: true \}\)/u, "Escape must close each PhantomBot modal and restore focus.");

assert.match(index, /data-admin-page-style href="\/app\/phantombot-next\.css\?v=phantom-live-[^"]+"/u, "The mission workspace stylesheet must be loaded by the initial document.");
assert.ok(index.indexOf("/app/phantombot-next.css") < index.indexOf("/app/admin-next.css"), "Admin Next must remain the final global authority.");
assert.match(main, /\.\/phantomai\.js\?v=phantom-live-[^"]+/u, "The shell must fetch the upgraded PhantomBot module.");

for (const selector of [
  ".phantombot-mission-hud",
  ".phantombot-mission-metrics",
  ".phantombot-next-moves",
  ".phantombot-session-menu",
  ".phantombot-context-drawer",
  ".phantombot-archive-toggle",
  ".phantombot-model-options",
]) {
  assert.match(css, new RegExp(selector.replaceAll(".", "\\.")), `The mission stylesheet must style ${selector}.`);
}
assert.doesNotMatch(css, /phantombot-modebar/u, "Retired mode-selector styles must not remain available for accidental reuse.");
assert.match(css, /--pbot-bg:\s*#020705/u, "PhantomBot must own the black base.");
assert.match(css, /--pbot-live:\s*#18f28f/u, "PhantomBot must own the Phantom green signal.");
assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.phantombot-mission-hud[\s\S]*\.phantomai-chat-form/u, "The mission HUD and unified composer must adapt for compact screens.");
assert.match(css, /@media \(prefers-reduced-motion: reduce\)/u, "The upgraded motion must respect reduced-motion preferences.");
assert.doesNotMatch(css, /purple|violet|indigo|blue|#(?:8d7cf8|c9c1ff|cec7ff|5b4cff|7c6cff|4f8dff)/iu, "The PhantomBot authority cannot reintroduce retired accent families.");
assert.equal((css.match(/\{/gu) || []).length, (css.match(/\}/gu) || []).length, "PhantomBot CSS must have balanced blocks.");

console.log("PhantomBot unified-composer checks passed: automatic intent routing, no task modes, session continuity, safe next moves, mission HUD, and responsive green/black UI.");
