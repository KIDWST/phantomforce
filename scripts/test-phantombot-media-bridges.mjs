import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const command = read("../app/js/command.js");
const mediaLab = read("../app/js/medialab.js");
const server = read("../server/src/index.ts");
const desktop = read("../packages/phantombot-desktop/src/main.cjs");

assert.match(command, /export function mediaGenerationRequest[\s\S]*modality[\s\S]*aspect[\s\S]*duration[\s\S]*model/u, "PhantomBot must classify image and video generation before chat routing.");
assert.ok(command.indexOf("const mediaRequest = mediaGenerationRequest(text)") < command.indexOf('if (intent.primaryIntent === "run_agent")'), "Media dispatch must run before generic PhantomBot work routing.");
assert.ok(command.indexOf("const mediaRequest = mediaGenerationRequest(text)") < command.indexOf("canAskHermes(text, intent, settings)"), "Media dispatch must run before any text-model request.");
assert.match(command, /\/phantom-ai\/media-lab\/chatgpt-image\/generate[\s\S]*ChatGPT Bridge generated/u, "Still-image requests must call the ChatGPT image bridge and import real returned assets.");
assert.match(command, /\/phantom-ai\/media-lab\/creative\/draft[\s\S]*Higgsfield received the video request automatically/u, "Video requests must automatically call the Higgsfield draft bridge.");
assert.match(command, /MEDIA_PROMPT_INTENT_KEY = "pf\.medialab\.promptIntent\.v1"[\s\S]*preserveMediaPrompt\(spec\)/u, "Every media request must be persisted before a bridge call.");
assert.match(command, /No substitute image was fabricated[\s\S]*No credits spent · no fake render/u, "Bridge recovery must stay truthful and must never fake media.");

const dispatcherStart = command.indexOf("async function dispatchPhantomMedia");
const dispatcherEnd = command.indexOf("function loadRuntimeAiSettings", dispatcherStart);
const dispatcher = dispatcherStart >= 0 && dispatcherEnd > dispatcherStart
  ? command.slice(dispatcherStart, dispatcherEnd)
  : "";
assert.ok(dispatcher, "The shared PhantomBot media dispatcher must exist.");
assert.doesNotMatch(dispatcher, /unable to generate|cannot generate|can't generate/i, "PhantomBot media recovery must preserve the request instead of returning a generic capability refusal.");

assert.match(mediaLab, /const IMAGE_MEDIA_LANE = "chatgpt_bridge"/u, "Media Lab and PhantomBot must agree that ChatGPT owns still images.");
assert.match(mediaLab, /const PRIMARY_MEDIA_LANE = "higgsfield"/u, "Media Lab and PhantomBot must agree that Higgsfield owns video.");
assert.match(server, /runHiggsfieldCliDraft[\s\S]*"generate", "cost"[\s\S]*higgsfield_cli_cost/u, "The video draft must verify the authenticated Higgsfield CLI without spending credits.");
assert.match(server, /tool_lane: "higgsfield_cli_cost"[\s\S]*paid_job_called: false[\s\S]*explicit_confirmation_required: "RUN_MEDIA_PAID_JOB"/u, "Paid Higgsfield rendering must remain explicitly approval-gated.");

assert.match(desktop, /http:\/\/127\.0\.0\.1:5190\/app\/index\.html/u, "Desktop PhantomBot must load the shared local web app.");
assert.match(desktop, /https:\/\/admin\.phantomforce\.online\/app\/index\.html/u, "Desktop fallback must load the same shared deployed web app.");

console.log("PhantomBot media bridge checks passed: ChatGPT images, Higgsfield video drafts, preserved retries, shared web/desktop routing, and no silent credit spend.");
