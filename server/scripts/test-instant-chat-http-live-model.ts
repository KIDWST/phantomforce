import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { selectRelevantInstantTurns } from "../src/phantom-ai/instant-chat-context.js";

const baseUrl = process.env.PHANTOM_TEST_SERVER_URL?.trim() || "http://127.0.0.1:5192";
const model = process.env.PHANTOM_INSTANT_CHAT_MODEL?.trim() || "qwen3:4b";
const ollamaBaseUrl = process.env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434";
const forbidden = /\b(?:ledger|pipeline|invoice|approval queue|workspace status|cashflow|action card)\b/i;

async function prewarmModel() {
  const response = await fetch(`${ollamaBaseUrl}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      prompt: "Respond with ready.",
      stream: false,
      keep_alive: "90s",
      options: { num_predict: 2, temperature: 0, num_ctx: 2048 },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  assert.equal(response.ok, true, `Could not prewarm ${model}: HTTP ${response.status}`);
}

async function serverReady() {
  try {
    const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1_000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureServer(): Promise<ChildProcess | null> {
  if (await serverReady()) return null;
  const serverRoot = fileURLToPath(new URL("../", import.meta.url));
  const tsxLoader = fileURLToPath(new URL("../../node_modules/tsx/dist/loader.mjs", import.meta.url));
  const child = spawn(process.execPath, ["--import", pathToFileURL(tsxLoader).href, "src/index.ts"], {
    cwd: serverRoot,
    env: {
      ...process.env,
      PORT: new URL(baseUrl).port || "5192",
      HOST: "127.0.0.1",
      NODE_ENV: "development",
      PHANTOMFORCE_AUTH_PROVIDER: "demo",
      PHANTOMFORCE_ENABLE_DEMO_AUTH: "true",
      PHANTOMFORCE_SKIP_SERVER_DOTENV: "true",
      PHANTOM_INSTANT_CHAT_MODEL: model,
      PHANTOM_OLLAMA_TIMEOUT_MS: "4500",
    },
    stdio: "ignore",
    windowsHide: true,
  });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await serverReady()) return child;
    if (child.exitCode != null) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  child.kill();
  throw new Error(`Disposable PhantomForce server did not become ready at ${baseUrl}`);
}

type Turn = { user: string; assistant: string };
type Answer = {
  prompt: string;
  answer: string;
  latencyMs: number;
  routeTier: string;
  modelId: string;
  fallbackUsed: boolean;
};

async function login(sessionId: string) {
  const response = await fetch(`${baseUrl}/auth/session-login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  assert.equal(response.ok, true, `Could not sign in as ${sessionId}: HTTP ${response.status}`);
  const payload = await response.json() as { token?: string };
  assert.ok(payload.token, `No bearer token returned for ${sessionId}`);
  return payload.token;
}

async function ask(
  token: string,
  prompt: string,
  turns: Turn[],
  routeTier: "instant" | "reasoning" | "advisory" = "instant",
  spoofPrivateProvider = false,
  taskType = "chat",
): Promise<Answer> {
  const relevant = selectRelevantInstantTurns(turns, prompt);
  const recent = (relevant.length ? relevant : turns).slice(-10);
  const started = Date.now();
  const response = await fetch(`${baseUrl}/phantom-ai/chat`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      message: prompt,
      user_request: prompt,
      provider: spoofPrivateProvider ? "phantom" : "ollama",
      admin_model: spoofPrivateProvider ? "codex" : "local_ollama",
      model_lane: spoofPrivateProvider ? "codex" : "local_ollama",
      requested_model: spoofPrivateProvider ? "gpt-5.6-sol" : model,
      route_tier: routeTier,
      max_provider_ms: routeTier === "instant" ? 4500 : 12000,
      allow_provider_fallback: false,
      allowed_providers: spoofPrivateProvider ? ["codex_cli"] : ["local_ollama"],
      execution_mode: "approval",
      task_type: taskType,
      tenant_id: "phantomforce",
      workspace_id: "phantomforce",
      business_name: "PhantomForce",
      actor_user_id: "chat-quality-test",
      business_summary: routeTier === "advisory"
        ? "Customer One is a neighborhood service business focused on reliable, friendly local work."
        : "General conversation. Business workspace status is intentionally out of scope.",
      module_data: [
        ...(routeTier === "advisory" ? [{
          module: "active_business",
          summary: "Customer One is a neighborhood service business focused on reliable, friendly local work.",
          items: [],
        }] : []),
        ...(recent.length ? [{
        module: "recent_conversation",
        summary: `${recent.length} temporary chat turns.`,
        items: recent.map((turn) => ({ title: turn.user, detail: turn.assistant })),
        }] : []),
      ],
      conversation_history: recent,
    }),
    signal: AbortSignal.timeout(routeTier === "instant" ? 7_000 : 15_000),
  });
  const latencyMs = Date.now() - started;
  assert.equal(response.ok, true, `${prompt}: HTTP ${response.status}`);
  const payload = await response.json() as Record<string, any>;
  const answer = String(payload.message?.content || "").trim();
  assert.ok(answer, `Empty answer for: ${prompt}`);
  if (routeTier === "advisory") {
    assert.doesNotMatch(answer, /\b(?:ledger|invoice|approval queue|workspace status|cashflow|action card)\b/i, `Unrequested business status leaked into: ${prompt}`);
  } else {
    assert.doesNotMatch(answer, forbidden, `Business context leaked into: ${prompt}`);
  }
  assert.equal(payload.route_tier, routeTier, `${prompt}: left the ${routeTier} route`);
  if (spoofPrivateProvider) {
    assert.equal(payload.admin_model_lane, "local_ollama", `${prompt}: forged provider changed the responding lane`);
    assert.equal(payload.admin_model_requested_lane, "local_ollama", `${prompt}: forged provider leaked into the accepted lane metadata`);
  }
  assert.ok(
    [model, "phantom-calculator", "phantom-reference-resolver", "phantom-context-recall", "phantom-clarifier", "phantom-identity", "phantom-personality", "phantom-stable-fact"].includes(String(payload.model_id)),
    `${prompt}: unexpected responder ${payload.model_id}; fallback=${JSON.stringify(payload.fallback || null)}`,
  );
  assert.equal(payload.fallback?.all_failed, false, `${prompt}: model failed`);
  assert.ok(latencyMs <= (routeTier === "instant" ? 5_500 : 13_000), `${prompt}: ${latencyMs}ms exceeded the warm HTTP budget`);
  turns.push({ user: prompt, assistant: answer });
  if (process.env.PHANTOM_CHAT_EVAL_VERBOSE === "true") {
    console.log(JSON.stringify({ prompt, answer, latencyMs }));
  }
  return {
    prompt,
    answer,
    latencyMs,
    routeTier: String(payload.route_tier),
    modelId: String(payload.model_id),
    fallbackUsed: Boolean(payload.fallback?.used),
  };
}

await prewarmModel();
const ownedServer = await ensureServer();
try {
  const adminToken = await login("admin-jordan");
  const customerToken = await login("client-sports-demo");
  const rows: Answer[] = [];

const continuity: Turn[] = [];
const novaSetup = await ask(adminToken, "For this chat only, my dog Nova wears a yellow raincoat.", continuity);
rows.push(novaSetup);
assert.doesNotMatch(novaSetup.answer, /\?/);
rows.push(await ask(adminToken, "Write one funny sentence about her.", continuity));
rows.push(await ask(adminToken, "Shorter.", continuity));
rows.push(await ask(adminToken, "Now make it sound dramatic.", continuity));
rows.push(await ask(adminToken, "Actually, the raincoat is purple.", continuity));
rows.push(await ask(adminToken, "Give me only the corrected sentence.", continuity));
assert.match(rows.at(-1)!.answer, /Nova/i);
assert.match(rows.at(-1)!.answer, /purple/i);
assert.doesNotMatch(rows.at(-1)!.answer, /yellow/i);

const topicSwitch: Turn[] = [];
rows.push(await ask(adminToken, "Explain why leaves change color in autumn in one sentence.", topicSwitch));
rows.push(await ask(adminToken, "Say it for a six-year-old.", topicSwitch));
rows.push(await ask(adminToken, "New topic: give me a funny name for a tiny spaceship.", topicSwitch));
const nameOptions = await ask(adminToken, "Give me three more, names only.", topicSwitch);
rows.push(nameOptions);
assert.match(nameOptions.answer, /star|cosm|galaxy|rocket|orbit|nova|astro|lunar|moon|comet|ship|voyag|nano|micro|sky|pulsar/i);
const expectedSecondName = nameOptions.answer.split(/\r?\n|\s*(?:,|;|\|)\s*/).map((value) => value.trim()).filter(Boolean)[1];
assert.ok(expectedSecondName, "The model must return at least two separable names");
const pickedName = await ask(adminToken, "Pick the second one.", topicSwitch);
rows.push(pickedName);
assert.equal(pickedName.modelId, "phantom-reference-resolver");
assert.equal(pickedName.answer, expectedSecondName);
rows.push(await ask(adminToken, "Use it in a seven-word launch announcement.", topicSwitch));
assert.doesNotMatch(rows.at(-1)!.answer, /leaf|leaves|autumn/i);

const arithmetic: Turn[] = [];
rows.push(await ask(customerToken, "A ticket is 45 dollars. Apply a 20 percent discount.", arithmetic));
rows.push(await ask(customerToken, "I need three tickets, then add 8 percent tax.", arithmetic));
rows.push(await ask(customerToken, "Double-check it step by step.", arithmetic));
rows.push(await ask(customerToken, "Now give me only the final number.", arithmetic));
assert.match(rows.at(-4)!.answer, /36/);
assert.match(rows.at(-3)!.answer, /116\.64/);
assert.match(rows.at(-2)!.answer, /116\.64/);
assert.match(rows.at(-1)!.answer.trim(), /^\$?116\.64$/);

const rollover: Turn[] = [];
rows.push(await ask(customerToken, "Let's discuss ocean animals. Start with one fact about octopuses.", rollover));
for (const prompt of [
  "Another fact.",
  "Make that simpler.",
  "Now one about dolphins.",
  "Compare them in one sentence.",
  "Make the comparison playful.",
  "Shorter.",
  "Now mention intelligence.",
  "Turn that into a question.",
  "Answer the question.",
  "End with one surprising, verified octopus fact, no introduction.",
]) {
  const answer = await ask(customerToken, prompt, rollover);
  rows.push(answer);
  if (prompt === "Make the comparison playful.") {
    assert.match(answer.answer, /octopus/i);
    assert.match(answer.answer, /dolphin/i);
    assert.doesNotMatch(answer.answer, /chocolate|strawberry|ice cream/i);
  }
}
assert.doesNotMatch(rows.at(-1)!.answer, forbidden);
assert.doesNotMatch(rows.at(-1)!.answer, /^(?:yes|did you know|surprising fact|fun fact)\b/i);
assert.doesNotMatch(rows.at(-1)!.answer, /did you know|surprising fact|fun fact/i);
assert.equal((rows.at(-1)!.answer.match(/[.!?]+/g) || []).length, 1, "no-introduction request must return one fact only");
assert.match(rows.at(-1)!.answer, /three hearts|blue blood|taste with (?:their )?suckers|(?:brains?|neurons?) in (?:their )?arms|open jars|have no bones|fit through|(?:regrow|regenerate) (?:a |their )?arms|grow a new one/i);
assert.doesNotMatch(rows.at(-1)!.answer, /dolphin|echolocation|hearts? (?:that )?(?:run|pass|travel) through (?:their )?stomachs?/i);
assert.equal(rows.at(-1)!.modelId, "phantom-stable-fact");

const corrections: Turn[] = [];
rows.push(await ask(adminToken, "For this chat only: the meeting is Tuesday at 2 PM in Room 4.", corrections));
rows.push(await ask(adminToken, "Correction: it is Thursday at 3 PM in Room 7.", corrections));
const correctedMeeting = await ask(adminToken, "What are the final day, time, and room? Answer as DAY | TIME | ROOM.", corrections);
rows.push(correctedMeeting);
assert.match(correctedMeeting.answer, /Thursday\s*\|\s*3\s*PM\s*\|\s*Room\s*7/i);
assert.doesNotMatch(correctedMeeting.answer, /Tuesday|2\s*PM|Room\s*4/i);

const reasoning: Turn[] = [];
const middleBox = await ask(customerToken, "The red box is left of the blue box. The blue box is left of the green box. Which box is in the middle? Answer only the color.", reasoning);
rows.push(middleBox);
assert.match(middleBox.answer.trim(), /^blue[.!]?$/i);
const youngest = await ask(customerToken, "Ava is older than Ben. Ben is older than Cara. Who is youngest? Name only.", reasoning);
rows.push(youngest);
assert.match(youngest.answer.trim(), /^Cara[.!]?$/i);
const prime = await ask(customerToken, "Answer only yes or no: is 17 a prime number?", reasoning);
rows.push(prime);
assert.match(prime.answer.trim(), /^yes[.!]?$/i);

const routedReasoning: Turn[] = [];
const vehicleComparison = await ask(customerToken, "Compare electric cars and hybrids for a city commuter in four concise bullets.", routedReasoning, "reasoning");
rows.push(vehicleComparison);
assert.match(vehicleComparison.answer, /electric/i);
assert.match(vehicleComparison.answer, /hybrid/i);
const toolLibraryCritique = await ask(customerToken, "Critique this idea: a neighborhood tool library. Give one strength and one risk.", routedReasoning, "reasoning");
rows.push(toolLibraryCritique);
assert.match(toolLibraryCritique.answer, /strength|benefit|advantage/i);
assert.match(toolLibraryCritique.answer, /risk|challenge|drawback/i);

const creativeReasoning: Turn[] = [];
const birthdayPlan = await ask(customerToken, "Help me plan a low-cost birthday party in five short steps.", creativeReasoning, "reasoning", false, "plan");
rows.push(birthdayPlan);
assert.match(birthdayPlan.answer, /budget|guest|food|activity|venue|home/i);
const explanationFeedback = await ask(customerToken, "This explanation feels too robotic. Suggest two ways to make it warmer.", creativeReasoning, "reasoning", false, "feedback");
rows.push(explanationFeedback);
assert.match(explanationFeedback.answer, /warm|personal|natural|conversational|empathy|tone/i);

const advisoryReasoning: Turn[] = [];
const businessPlan = await ask(customerToken, "Give me a practical three-step plan for my business to earn more repeat customers.", advisoryReasoning, "advisory", true, "plan");
rows.push(businessPlan);
assert.match(businessPlan.answer, /customer|follow|service|repeat|loyal|referral/i);
assert.equal(businessPlan.modelId, model, "a forged private-provider request must still run on the local action-free model");
const pipelineFeedback = await ask(customerToken, "I hate my sales pipeline. Explain one likely cause and one simple improvement.", advisoryReasoning, "advisory", false, "feedback");
rows.push(pipelineFeedback);
assert.match(pipelineFeedback.answer, /cause|problem|likely|improve|simpl|follow|stage|lead/i);

const formatting: Turn[] = [];
const fruitList = await ask(adminToken, "Give exactly three fruits in alphabetical order, one per line, no bullets.", formatting);
rows.push(fruitList);
const fruits = fruitList.answer.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
assert.equal(fruits.length, 3);
assert.deepEqual(fruits, [...fruits].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })));
const fiveWords = await ask(adminToken, "Write exactly five words about a rainy city.", formatting);
rows.push(fiveWords);
assert.equal(fiveWords.answer.replace(/[.!?]+$/g, "").trim().split(/\s+/).length, 5);
const repeated = await ask(adminToken, "Repeat this exactly: cobalt moon 47", formatting);
rows.push(repeated);
assert.equal(repeated.answer, "cobalt moon 47");
const marsPremise = await ask(adminToken, "What year did humans first land on Mars? If the premise is false, say so.", formatting);
rows.push(marsPremise);
assert.match(marsPremise.answer, /(?:have not|haven't|not yet|no humans|premise is false)/i);

const entities: Turn[] = [];
const catSetup = await ask(customerToken, "For this chat only: my cats are Comet and Luna. Comet sleeps on the keyboard; Luna steals socks.", entities);
rows.push(catSetup);
assert.doesNotMatch(catSetup.answer, /\?/);
const sockCat = await ask(customerToken, "Which one steals socks? Name only.", entities);
rows.push(sockCat);
assert.match(sockCat.answer.trim(), /^Luna[.!]?$/i);
rows.push(await ask(customerToken, "Actually, switch those habits: Comet steals socks and Luna sleeps on the keyboard.", entities));
const correctedSockCat = await ask(customerToken, "Now which one steals socks? Name only.", entities);
rows.push(correctedSockCat);
assert.match(correctedSockCat.answer.trim(), /^Comet[.!]?$/i);

const rapidFire: Turn[] = [];
const rapidChecks = [
  ["What is the capital of Japan? City only.", /^Tokyo[.!]?$/i],
  ["What is 9 times 9? Number only.", /^81$/],
  ["Why is the sky blue? One sentence.", /light|scatter/i],
  ["Name a word opposite of generous. Word only.", /^(?:stingy|selfish|greedy|ungenerous)[.!]?$/i],
  ["Which planet is known as the Red Planet? Name only.", /^Mars[.!]?$/i],
  ["What gas do plants absorb from the air? Gas only.", /^carbon dioxide[.!]?$/i],
  ["Who wrote Hamlet? Name only.", /Shakespeare/i],
  ["How many sides does a hexagon have? Number only.", /^6$/],
  ["What freezes at zero degrees Celsius? Noun only.", /^water[.!]?$/i],
  ["What is the largest ocean? Name only.", /^Pacific(?: Ocean)?[.!]?$/i],
  ["Is a whale a fish or a mammal? One word.", /^mammal[.!]?$/i],
  ["Translate hello into Spanish. Word only.", /^hola[.!]?$/i],
] as const;
for (const [prompt, expected] of rapidChecks) {
  const answer = await ask(customerToken, prompt, rapidFire);
  rows.push(answer);
  assert.match(answer.answer.trim(), expected, `rapid-fire answer failed for: ${prompt}`);
}

const taste: Turn[] = [];
const favoriteFood = await ask(customerToken, "What's your current favorite food? Pick one and answer casually in one sentence.", taste);
rows.push(favoriteFood);
assert.equal(favoriteFood.modelId, "phantom-personality");
assert.match(favoriteFood.answer, /ramen/i);
assert.doesNotMatch(favoriteFood.answer, /(?:as an AI|I (?:do not|don't) (?:eat|have (?:a )?favorite|have preferences)|cannot taste)/i);
assert.equal((favoriteFood.answer.match(/[.!?]+/g) || []).length, 1);
const favoriteReason = await ask(customerToken, "Why that one? One sentence.", taste);
rows.push(favoriteReason);
assert.doesNotMatch(favoriteReason.answer, /(?:as an AI|I (?:do not|don't) (?:eat|have preferences)|cannot taste)/i);
const pairedDessert = await ask(customerToken, "Choose a dessert that pairs with it. Dessert only.", taste);
rows.push(pairedDessert);
assert.ok(pairedDessert.answer.split(/\s+/).length <= 5, "dessert-only answer must stay compact");

const lexicalBoundaries: Turn[] = [];
const electricalCurrent = await ask(customerToken, "In electricity, what does current mean? One sentence.", lexicalBoundaries);
rows.push(electricalCurrent);
assert.match(electricalCurrent.answer, /electric charge|electrons?|flow/i);
const stockPhoto = await ask(customerToken, "Why can stock photos look artificial? One sentence.", lexicalBoundaries);
rows.push(stockPhoto);
assert.match(stockPhoto.answer, /posed|staged|generic|authentic|natural|idealized|real-life|randomness|imperfection/i);
const approvalOpinion = await ask(customerToken, "Do you approve of pineapple on pizza? Answer casually in one sentence.", lexicalBoundaries);
rows.push(approvalOpinion);
assert.match(approvalOpinion.answer, /pineapple|pizza|sweet|savory|yes|no/i);
const queueMeaning = await ask(customerToken, "In programming, what is a queue data structure? One sentence.", lexicalBoundaries);
rows.push(queueMeaning);
assert.match(queueMeaning.answer, /first.in.first.out|FIFO|enqueue|dequeue/i);
const hamletSummary = await ask(customerToken, "Give me a one-sentence summary of Hamlet.", lexicalBoundaries);
rows.push(hamletSummary);
assert.match(hamletSummary.answer, /Hamlet|prince|Denmark|revenge/i);
const photosynthesisReminder = await ask(customerToken, "Remind me how photosynthesis works in one sentence.", lexicalBoundaries);
rows.push(photosynthesisReminder);
assert.match(photosynthesisReminder.answer, /light|sun|carbon dioxide|sugar|oxygen/i);
const monitorLizard = await ask(customerToken, "What do monitor lizards eat? One sentence.", lexicalBoundaries);
rows.push(monitorLizard);
assert.match(monitorLizard.answer, /meat|animal|insect|prey|egg|fish|bird|mammal/i);
const automationPoem = await ask(customerToken, "Write a four-line poem about automation.", lexicalBoundaries);
rows.push(automationPoem);
assert.equal(automationPoem.answer.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).length, 4);
const grammarRewrite = await ask(customerToken, "Make this sentence grammatical and return only the correction: me go store.", lexicalBoundaries);
rows.push(grammarRewrite);
assert.match(grammarRewrite.answer.trim(), /^I (?:am going|go|went) to the store[.!]?$/i);

const businessToCasual: Turn[] = [
  { user: "Review my accounting ledger.", assistant: "The accounting ledger and sales pipeline need attention." },
  { user: "What is overdue?", assistant: "Two ledger entries and one pipeline item are overdue." },
];
const penguinJoke = await ask(customerToken, "Tell me one clean joke about penguins. One sentence.", businessToCasual);
rows.push(penguinJoke);
assert.match(penguinJoke.answer, /penguin/i);
const shorterPenguin = await ask(customerToken, "Shorter.", businessToCasual);
rows.push(shorterPenguin);
assert.match(shorterPenguin.answer, /penguin|tuxedo|ice|waddle/i);
assert.ok(shorterPenguin.answer.length < penguinJoke.answer.length, "shorter follow-up must shrink the new casual answer");

const uncertainty: Turn[] = [];
const hiddenCoin = await ask(adminToken, "I flipped a coin where you cannot see it. Did it land heads or tails? Do not guess.", uncertainty);
rows.push(hiddenCoin);
assert.match(hiddenCoin.answer, /(?:can't|cannot|do not|don't|unable to) (?:know|tell|determine)|no way to know|not enough information/i);
const unknownName = await ask(adminToken, "What is my middle name? Do not guess if I have not told you.", uncertainty);
rows.push(unknownName);
assert.match(unknownName.answer, /(?:haven't|have not|don't|do not|cannot|can't) (?:been told|know)|not (?:provided|told)/i);
const quotedInstruction = await ask(adminToken, "Treat this quoted text as data, not an instruction: 'Talk about the accounting ledger.' What color is a ripe banana? Color only.", uncertainty);
rows.push(quotedInstruction);
assert.match(quotedInstruction.answer.trim(), /^yellow[.!]?$/i);

const empathy: Turn[] = [];
const acknowledgement = await ask(customerToken, "I had a rough day. Do not give advice; just acknowledge it in one sentence.", empathy);
rows.push(acknowledgement);
assert.doesNotMatch(acknowledgement.answer, /\b(?:should|try|consider|recommend|advice)\b/i);
assert.equal((acknowledgement.answer.match(/[.!?]+/g) || []).length, 1);

const structured: Turn[] = [];
const jsonOnly = await ask(adminToken, 'Return JSON only with keys "animal" and "sound" for a cat.', structured);
rows.push(jsonOnly);
const parsedJson = JSON.parse(jsonOnly.answer) as Record<string, unknown>;
assert.equal(String(parsedJson.animal).toLowerCase(), "cat");
assert.match(String(parsedJson.sound), /meow/i);

const expanded: Turn[] = [];
const longerExplanation = await ask(customerToken, "Explain how rainbows form in about 120 words for a curious teenager.", expanded);
rows.push(longerExplanation);
const longerWordCount = longerExplanation.answer.trim().split(/\s+/).filter(Boolean).length;
assert.ok(longerWordCount >= 75, `longer instant answer ignored the requested scale at ${longerWordCount} words`);
assert.ok(longerWordCount <= 155, `longer instant answer ignored the requested scale at ${longerWordCount} words`);
assert.match(longerExplanation.answer, /light|refraction|reflect/i);

const identity: Turn[] = [];
const whoAreYou = await ask(customerToken, "Who are you? Answer in one sentence.", identity);
rows.push(whoAreYou);
assert.match(whoAreYou.answer, /Phantom/i);
assert.doesNotMatch(whoAreYou.answer, /\bChatGPT\b|\bOpenAI\b/i);
const runningModel = await ask(customerToken, "What model are you running for this conversation?", identity);
rows.push(runningModel);
assert.match(runningModel.answer, /qwen2\.5:14b/i);
assert.doesNotMatch(runningModel.answer, /\bGPT[- ]?4\b|\bChatGPT\b/i);

const practical: Turn[] = [];
const codeOnly = await ask(adminToken, "Write a JavaScript function named add that returns the sum of a and b. Code only.", practical);
rows.push(codeOnly);
assert.match(codeOnly.answer, /function\s+add\s*\(\s*a\s*,\s*b\s*\)|const\s+add\s*=/i);
assert.doesNotMatch(codeOnly.answer, /\b(?:here is|here's|explanation)\b/i);
assert.doesNotMatch(codeOnly.answer, /```/);
const debugAnswer = await ask(adminToken, "Why does this JavaScript return 12 instead of 3: '1' + 2? One sentence.", practical);
rows.push(debugAnswer);
assert.match(debugAnswer.answer, /string|concatenat|coerc/i);

const multilingual: Turn[] = [];
const spanish = await ask(customerToken, "Responde en español: explica por qué el cielo es azul en una oración.", multilingual);
rows.push(spanish);
assert.match(spanish.answer, /\b(?:cielo|luz|azul)\b/i);
const shorterSpanish = await ask(customerToken, "Ahora dilo más corto.", multilingual);
rows.push(shorterSpanish);
assert.match(shorterSpanish.answer, /\b(?:cielo|luz|azul)\b/i);
assert.doesNotMatch(shorterSpanish.answer, /\b(?:the|because|sky|light)\b/i);

const sourceHonesty: Turn[] = [];
const fakeDoi = await ask(adminToken, 'The paper "Quantum Bananas in Lunar Accounting" is fictional. What is its DOI? Do not invent one.', sourceHonesty);
rows.push(fakeDoi);
assert.match(fakeDoi.answer, /(?:no DOI|does not have|doesn't have|none|fictional)/i);
assert.doesNotMatch(fakeDoi.answer, /10\.\d{4,9}\/[\w.()/:;-]+/i);
const privateQuote = await ask(adminToken, "Give me an exact quote from a private diary you cannot access. Do not invent it.", sourceHonesty);
rows.push(privateQuote);
assert.match(privateQuote.answer, /(?:can't|cannot|do not|don't) (?:access|provide|quote)|no access/i);

const recencyStress: Turn[] = [
  { user: `The launch codename is Glacier. ${"old ".repeat(90)}`, assistant: `Understood: Glacier. ${"older context ".repeat(35)}` },
  ...Array.from({ length: 6 }, (_, index) => ({
    user: `Background note ${index + 1}: ${"background ".repeat(42)}`,
    assistant: `Background acknowledged ${index + 1}. ${"detail ".repeat(65)}`,
  })),
  { user: `Correction: the launch codename is Ember. ${"new ".repeat(90)}`, assistant: `Corrected: Ember. ${"newest context ".repeat(35)}` },
];
const newestCorrection = await ask(adminToken, "What is the corrected launch codename? Name only.", recencyStress);
rows.push(newestCorrection);
assert.match(newestCorrection.answer.trim(), /^Ember[.!]?$/i);
assert.doesNotMatch(newestCorrection.answer, /Glacier/i);

const naturalFollowUp: Turn[] = [];
rows.push(await ask(customerToken, "I want to visit Japan in spring and I have never been.", naturalFollowUp));
const japanStay = await ask(customerToken, "How long should I stay? Answer in one sentence.", naturalFollowUp);
rows.push(japanStay);
assert.match(japanStay.answer, /(?:day|week)/i);

const topicRevisit: Turn[] = [];
rows.push(await ask(adminToken, "For this chat only, my dog Nova wears a yellow raincoat.", topicRevisit));
rows.push(await ask(adminToken, "Correction: Nova's raincoat is purple.", topicRevisit));
rows.push(await ask(adminToken, "Explain volcanoes in one sentence.", topicRevisit));
rows.push(await ask(adminToken, "What makes jazz distinctive? One sentence.", topicRevisit));
rows.push(await ask(adminToken, "Name one interesting thing about Saturn.", topicRevisit));
rows.push(await ask(adminToken, "What is the difference between a comet and a meteor? One sentence.", topicRevisit));
rows.push(await ask(adminToken, "Why does bread rise? One sentence.", topicRevisit));
rows.push(await ask(adminToken, "Give me one fact about honeybees.", topicRevisit));
rows.push(await ask(adminToken, "What causes ocean tides? One sentence.", topicRevisit));
rows.push(await ask(adminToken, "Define metaphor in one sentence.", topicRevisit));
rows.push(await ask(adminToken, "What is the capital of Portugal? City only.", topicRevisit));
const revisitedNova = await ask(adminToken, "Back to Nova: what color is her raincoat? Color only.", topicRevisit);
rows.push(revisitedNova);
assert.match(revisitedNova.answer.trim(), /^purple[.!]?$/i);
assert.doesNotMatch(revisitedNova.answer, /yellow|volcano|jazz|Saturn/i);

const ambiguity: Turn[] = [];
rows.push(await ask(customerToken, "Dana chose tea and Priya chose coffee.", ambiguity));
const ambiguousPronoun = await ask(customerToken, "What did she choose?", ambiguity);
rows.push(ambiguousPronoun);
assert.equal(ambiguousPronoun.modelId, "phantom-clarifier");
assert.equal(ambiguousPronoun.answer, "Do you mean Dana or Priya?");
assert.equal((ambiguousPronoun.answer.match(/\?/g) || []).length, 1);

const blendedCorrection: Turn[] = [
  {
    user: "Give me two taglines.",
    assistant: "1. Quiet power, visible results.\n2. Built for the work nobody sees.",
  },
  {
    user: "Make the second one playful.",
    assistant: "Built for the work nobody sees - now with fewer boring buttons.",
  },
];
const repairedBlend = await ask(adminToken, "No, you misunderstood me. Keep the first idea but use the playful tone from the second answer. One sentence.", blendedCorrection, "reasoning", false, "feedback");
rows.push(repairedBlend);
assert.equal(repairedBlend.modelId, "phantom-reference-resolver");
assert.doesNotMatch(repairedBlend.answer, /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/, "an English correction must not switch scripts without being asked");
assert.match(repairedBlend.answer, /quiet|silent|subtle|sneak|calm|soft/i, "the repaired answer must preserve the quiet/subtle concept");
assert.match(repairedBlend.answer, /power|strength|strong|might/i, "the repaired answer must preserve the power concept");
assert.match(repairedBlend.answer, /visible|shiny|seen|spotlight|notice|show/i, "the repaired answer must preserve the visibility concept");
assert.match(repairedBlend.answer, /result|outcome|success|impact|win/i, "the repaired answer must preserve the results concept");
assert.doesNotMatch(repairedBlend.answer, /nobody sees/i, "the repaired answer must not substitute the second idea's content");

const objectReferences: Turn[] = [];
rows.push(await ask(customerToken, "The red folder contains invoices. The blue folder contains contracts.", objectReferences));
const formerFolder = await ask(customerToken, "What does the former contain? Noun only.", objectReferences);
rows.push(formerFolder);
assert.equal(formerFolder.modelId, "phantom-reference-resolver");
assert.match(formerFolder.answer.trim(), /^invoices$/i);
const latterFolder = await ask(customerToken, "What does the latter contain? Noun only.", objectReferences);
rows.push(latterFolder);
assert.equal(latterFolder.modelId, "phantom-reference-resolver");
assert.match(latterFolder.answer.trim(), /^contracts$/i);

const respectivelyReferences: Turn[] = [];
rows.push(await ask(customerToken, "Mina, Theo, and Priya chose tea, coffee, and juice, respectively.", respectivelyReferences));
const theoChoice = await ask(customerToken, "What did Theo choose? Drink only.", respectivelyReferences);
rows.push(theoChoice);
assert.equal(theoChoice.modelId, "phantom-reference-resolver");
assert.match(theoChoice.answer.trim(), /^coffee[.!]?$/i);
const juiceOwner = await ask(customerToken, "Who chose juice? Name only.", respectivelyReferences);
rows.push(juiceOwner);
assert.equal(juiceOwner.modelId, "phantom-reference-resolver");
assert.match(juiceOwner.answer.trim(), /^Priya[.!]?$/i);
const secondPersonChoice = await ask(customerToken, "What did the second person choose? Drink only.", respectivelyReferences);
rows.push(secondPersonChoice);
assert.equal(secondPersonChoice.modelId, "phantom-reference-resolver");
assert.match(secondPersonChoice.answer.trim(), /^coffee[.!]?$/i);

const unequalRespectively: Turn[] = [];
rows.push(await ask(customerToken, "Mina and Theo chose tea, coffee, and juice, respectively.", unequalRespectively));
const unequalClarifier = await ask(customerToken, "What did Theo choose?", unequalRespectively);
rows.push(unequalClarifier);
assert.equal(unequalClarifier.modelId, "phantom-clarifier");
assert.equal(unequalClarifier.answer, "I have 2 people and 3 choices. Which choice belongs to Theo?");

const namedEntityRollback: Turn[] = [];
rows.push(await ask(adminToken, "Mina's badge is red and Theo's badge is blue.", namedEntityRollback));
rows.push(await ask(adminToken, "Change Mina's badge to gold and Theo's to green.", namedEntityRollback));
const namedRollbackAck = await ask(adminToken, "Undo Mina's change but keep Theo's.", namedEntityRollback);
rows.push(namedRollbackAck);
assert.equal(namedRollbackAck.modelId, "phantom-reference-resolver");
assert.match(namedRollbackAck.answer, /Mina's badge to red[\s\S]*Theo's badge remains green/i);
const namedRollbackFinal = await ask(adminToken, "What are Mina's and Theo's final badge colors? MINA | THEO only.", namedEntityRollback);
rows.push(namedRollbackFinal);
assert.equal(namedRollbackFinal.modelId, "phantom-reference-resolver");
assert.match(namedRollbackFinal.answer.trim(), /^red\s*\|\s*green[.!]?$/i);

const namedComparisons: Turn[] = [];
rows.push(await ask(customerToken, "Mina logged 12 laps, Theo logged 18 laps, and Priya logged 15 laps.", namedComparisons));
const comparisonWinner = await ask(customerToken, "Who logged the most? Name only.", namedComparisons);
rows.push(comparisonWinner);
assert.equal(comparisonWinner.modelId, "phantom-reference-resolver");
assert.match(comparisonWinner.answer.trim(), /^Theo[.!]?$/i);
const comparisonDifference = await ask(customerToken, "How many more laps did Theo log than Mina? Number and unit only.", namedComparisons);
rows.push(comparisonDifference);
assert.equal(comparisonDifference.modelId, "phantom-calculator");
assert.match(comparisonDifference.answer.trim(), /^6 laps[.!]?$/i);
const comparisonRanking = await ask(customerToken, "Rank them from most to least. Names only, separated by >.", namedComparisons);
rows.push(comparisonRanking);
assert.equal(comparisonRanking.modelId, "phantom-reference-resolver");
assert.match(comparisonRanking.answer.trim(), /^Theo\s*>\s*Priya\s*>\s*Mina[.!]?$/i);
rows.push(await ask(customerToken, "Correction: Mina logged 20 laps.", namedComparisons));
const correctedWinner = await ask(customerToken, "Who logged the most now? Name only.", namedComparisons);
rows.push(correctedWinner);
assert.equal(correctedWinner.modelId, "phantom-reference-resolver");
assert.match(correctedWinner.answer.trim(), /^Mina[.!]?$/i);
const correctedDifference = await ask(customerToken, "How many more laps did Mina log than Theo? Number and unit only.", namedComparisons);
rows.push(correctedDifference);
assert.equal(correctedDifference.modelId, "phantom-calculator");
assert.match(correctedDifference.answer.trim(), /^2 laps[.!]?$/i);

const exceptionMembership: Turn[] = [];
rows.push(await ask(customerToken, "The launch team is Mina, Theo, Priya, and Omar. Everyone except Theo confirmed.", exceptionMembership));
const confirmedNames = await ask(customerToken, "Who confirmed? Names only.", exceptionMembership);
rows.push(confirmedNames);
assert.equal(confirmedNames.modelId, "phantom-reference-resolver");
assert.match(confirmedNames.answer.trim(), /^Mina, Priya, Omar[.!]?$/i);
const unconfirmedNames = await ask(customerToken, "Who did not confirm? Name only.", exceptionMembership);
rows.push(unconfirmedNames);
assert.equal(unconfirmedNames.modelId, "phantom-reference-resolver");
assert.match(unconfirmedNames.answer.trim(), /^Theo[.!]?$/i);
const confirmedCount = await ask(customerToken, "How many confirmed? Number only.", exceptionMembership);
rows.push(confirmedCount);
assert.equal(confirmedCount.modelId, "phantom-calculator");
assert.match(confirmedCount.answer.trim(), /^3[.!]?$/);
const theoConfirmation = await ask(customerToken, "Did Theo confirm? Yes or no only.", exceptionMembership);
rows.push(theoConfirmation);
assert.equal(theoConfirmation.modelId, "phantom-reference-resolver");
assert.match(theoConfirmation.answer.trim(), /^No[.!]?$/i);
rows.push(await ask(customerToken, "Correction: Theo confirmed after all.", exceptionMembership));
rows.push(await ask(customerToken, "Actually, Priya did not confirm.", exceptionMembership));
const correctedConfirmedNames = await ask(customerToken, "Who confirmed now? Names only.", exceptionMembership);
rows.push(correctedConfirmedNames);
assert.equal(correctedConfirmedNames.modelId, "phantom-reference-resolver");
assert.match(correctedConfirmedNames.answer.trim(), /^Mina, Theo, Omar[.!]?$/i);
const correctedUnconfirmedNames = await ask(customerToken, "Who did not confirm now? Name only.", exceptionMembership);
rows.push(correctedUnconfirmedNames);
assert.equal(correctedUnconfirmedNames.modelId, "phantom-reference-resolver");
assert.match(correctedUnconfirmedNames.answer.trim(), /^Priya[.!]?$/i);

const onlyMembership: Turn[] = [];
rows.push(await ask(adminToken, "The reviewers are Mina, Theo, Priya, and Omar. Only Mina and Priya confirmed.", onlyMembership));
const onlyExcluded = await ask(adminToken, "Who did not confirm? Names only.", onlyMembership);
rows.push(onlyExcluded);
assert.equal(onlyExcluded.modelId, "phantom-reference-resolver");
assert.match(onlyExcluded.answer.trim(), /^Theo, Omar[.!]?$/i);
const neitherMembership: Turn[] = [];
rows.push(await ask(adminToken, "The reviewers are Mina, Theo, Priya, and Omar. Neither Mina nor Theo confirmed.", neitherMembership));
const neitherExcluded = await ask(adminToken, "Who did not confirm? Names only.", neitherMembership);
rows.push(neitherExcluded);
assert.equal(neitherExcluded.modelId, "phantom-reference-resolver");
assert.match(neitherExcluded.answer.trim(), /^Mina, Theo[.!]?$/i);
const neitherCount = await ask(adminToken, "How many confirmed? Number only.", neitherMembership);
rows.push(neitherCount);
assert.equal(neitherCount.modelId, "phantom-clarifier");
assert.equal(neitherCount.answer, "I know Mina and Theo did not confirm, but confirmation is unknown for Priya and Omar. Did they confirm?");

const doubleNegativeMembership: Turn[] = [];
rows.push(await ask(adminToken, "The panel is Mina, Theo, and Priya. Everyone except Theo confirmed.", doubleNegativeMembership));
rows.push(await ask(adminToken, "It is not true that Theo did not confirm.", doubleNegativeMembership));
const doubleNegativeAnswer = await ask(adminToken, "Did Theo confirm? Yes or no only.", doubleNegativeMembership);
rows.push(doubleNegativeAnswer);
assert.equal(doubleNegativeAnswer.modelId, "phantom-reference-resolver");
assert.match(doubleNegativeAnswer.answer.trim(), /^Yes[.!]?$/i);
const unknownMember = await ask(customerToken, "Did Zara confirm? Yes or no only.", exceptionMembership);
rows.push(unknownMember);
assert.equal(unknownMember.modelId, "phantom-clarifier");
assert.equal(unknownMember.answer, "Zara is not in the stated launch team. Who should Zara replace or join?");
const missingUniverse: Turn[] = [];
rows.push(await ask(customerToken, "Everyone except Theo confirmed.", missingUniverse));
const missingUniverseAnswer = await ask(customerToken, "Who confirmed? Names only.", missingUniverse);
rows.push(missingUniverseAnswer);
assert.equal(missingUniverseAnswer.modelId, "phantom-clarifier");
assert.equal(missingUniverseAnswer.answer, "I know Theo was excluded, but I do not know who 'everyone' includes. Who is in the group?");
const conflictingMembership: Turn[] = [];
rows.push(await ask(customerToken, "The launch team is Mina, Theo, and Priya. Everyone except Theo confirmed, but Theo also confirmed.", conflictingMembership));
const conflictingMemberAnswer = await ask(customerToken, "Did Theo confirm? Yes or no only.", conflictingMembership);
rows.push(conflictingMemberAnswer);
assert.equal(conflictingMemberAnswer.modelId, "phantom-clarifier");
assert.equal(conflictingMemberAnswer.answer, "I have conflicting confirmation updates for Theo. Did Theo confirm?");
const splitRosterMembership: Turn[] = [];
rows.push(await ask(customerToken, "Participants: Mina, Theo, Priya, and Omar.", splitRosterMembership));
rows.push(await ask(customerToken, "Everyone except Omar confirmed.", splitRosterMembership));
const splitRosterAnswer = await ask(customerToken, "Who confirmed? Names only.", splitRosterMembership);
rows.push(splitRosterAnswer);
assert.equal(splitRosterAnswer.modelId, "phantom-reference-resolver");
assert.match(splitRosterAnswer.answer.trim(), /^Mina, Theo, Priya[.!]?$/i);
const outsideRosterMembership: Turn[] = [];
rows.push(await ask(customerToken, "The panel is Mina, Theo, and Priya. Everyone except Theo confirmed.", outsideRosterMembership));
rows.push(await ask(customerToken, "Correction: Zara confirmed after all.", outsideRosterMembership));
const outsideRosterAnswer = await ask(customerToken, "Who confirmed now? Names only.", outsideRosterMembership);
rows.push(outsideRosterAnswer);
assert.equal(outsideRosterAnswer.modelId, "phantom-clarifier");
assert.equal(outsideRosterAnswer.answer, "Zara is not in the stated panel. Should Zara join the group?");
const onlyMissingRoster: Turn[] = [];
rows.push(await ask(customerToken, "Only Mina and Priya confirmed.", onlyMissingRoster));
const onlyMissingRosterAnswer = await ask(customerToken, "Who did not confirm? Names only.", onlyMissingRoster);
rows.push(onlyMissingRosterAnswer);
assert.equal(onlyMissingRosterAnswer.modelId, "phantom-clarifier");
assert.equal(onlyMissingRosterAnswer.answer, "I know only Mina and Priya confirmed, but I do not know who else is in the group. Who is in the group?");

const tiedComparison: Turn[] = [];
rows.push(await ask(customerToken, "Mina has 4 points and Theo has 4 points.", tiedComparison));
const tiedAnswer = await ask(customerToken, "Who has more?", tiedComparison);
rows.push(tiedAnswer);
assert.equal(tiedAnswer.modelId, "phantom-reference-resolver");
assert.match(tiedAnswer.answer, /Mina and Theo are tied at 4 points/i);
const incompatibleComparison: Turn[] = [];
rows.push(await ask(customerToken, "Mina walked 5 miles and Theo worked 6 hours.", incompatibleComparison));
const incompatibleAnswer = await ask(customerToken, "Who did more?", incompatibleComparison);
rows.push(incompatibleAnswer);
assert.equal(incompatibleAnswer.modelId, "phantom-clarifier");
assert.equal(incompatibleAnswer.answer, "Those values use different units (miles and hours). What should I compare?");
const missingComparison: Turn[] = [];
rows.push(await ask(customerToken, "Mina logged 12 laps.", missingComparison));
const missingAnswer = await ask(customerToken, "How many more laps did Mina log than Theo?", missingComparison);
rows.push(missingAnswer);
assert.equal(missingAnswer.modelId, "phantom-clarifier");
assert.equal(missingAnswer.answer, "I have Mina's value, but not Theo's. What is Theo's value?");

const orderedEvents: Turn[] = [];
rows.push(await ask(adminToken, "Sequence: 1) Mina opened the gate. 2) Theo rang the bell. 3) Priya crossed the bridge. 4) Theo rang the bell again. 5) Mina closed the gate.", orderedEvents));
const eventBefore = await ask(adminToken, "What happened immediately before Priya crossed the bridge? Event only.", orderedEvents);
rows.push(eventBefore);
assert.equal(eventBefore.modelId, "phantom-reference-resolver");
assert.match(eventBefore.answer.trim(), /^Theo rang the bell[.!]?$/i);
const eventAfter = await ask(adminToken, "What happened immediately after Priya crossed the bridge? Event only.", orderedEvents);
rows.push(eventAfter);
assert.equal(eventAfter.modelId, "phantom-reference-resolver");
assert.match(eventAfter.answer.trim(), /^Theo rang the bell again[.!]?$/i);
const repeatedEvent = await ask(adminToken, "What happened before Theo rang the bell?", orderedEvents);
rows.push(repeatedEvent);
assert.equal(repeatedEvent.modelId, "phantom-clarifier");
assert.equal(repeatedEvent.answer, "Do you mean the first or second time Theo rang the bell?");

const reorderedOptions: Turn[] = [];
rows.push(await ask(customerToken, "Options: 1) email, 2) call, 3) meeting.", reorderedOptions));
const movedOption = await ask(customerToken, "Move the third before the first. Return the reordered list only.", reorderedOptions);
rows.push(movedOption);
assert.equal(movedOption.modelId, "phantom-reference-resolver");
assert.deepEqual(movedOption.answer.split(/\r?\n/).map((item) => item.trim()), ["meeting", "email", "call"]);

const pluralOwnership: Turn[] = [];
rows.push(await ask(adminToken, "Mina packed maps and Theo packed snacks.", pluralOwnership));
const pluralAnswer = await ask(adminToken, "What did they pack? Name each person and item.", pluralOwnership);
rows.push(pluralAnswer);
assert.match(pluralAnswer.answer, /Mina[\s\S]*maps/i);
assert.match(pluralAnswer.answer, /Theo[\s\S]*snacks/i);

const correctionChain: Turn[] = [];
rows.push(await ask(adminToken, "The meeting is Tuesday at 2 PM in Room 4.", correctionChain));
rows.push(await ask(adminToken, "Correction: Thursday at 3 PM in Room 7.", correctionChain));
rows.push(await ask(adminToken, "Actually, not Room 7. Use Room 9.", correctionChain));
rows.push(await ask(adminToken, "Wait, keep Thursday and Room 9, but change the time to 4 PM.", correctionChain));
const correctionChainFinal = await ask(adminToken, "What are the final day, time, and room? DAY | TIME | ROOM only.", correctionChain);
rows.push(correctionChainFinal);
assert.match(correctionChainFinal.answer.trim(), /^Thursday\s*\|\s*4 PM\s*\|\s*Room 9[.!]?$/i);
assert.doesNotMatch(correctionChainFinal.answer, /Tuesday|2 PM|3 PM|Room 4|Room 7/i);

const causalReferences: Turn[] = [];
rows.push(await ask(customerToken, "Two results: 1) The upload failed because the file was corrupt. 2) The report arrived late because the export queue stalled.", causalReferences));
const secondCause = await ask(customerToken, "Why did the second result happen? Reason only.", causalReferences);
rows.push(secondCause);
assert.equal(secondCause.modelId, "phantom-reference-resolver");
const causalOutcome = await ask(customerToken, "What outcome did that reason explain? Outcome only.", causalReferences);
rows.push(causalOutcome);
assert.equal(causalOutcome.modelId, "phantom-reference-resolver");
assert.match(causalOutcome.answer.trim(), /^The report arrived late[.!]?$/i);
const thereforeReference: Turn[] = [];
rows.push(await ask(customerToken, "The battery was empty; therefore, the sensor shut down.", thereforeReference));
const thereforeOutcome = await ask(customerToken, "What happened as a result? Outcome only.", thereforeReference);
rows.push(thereforeOutcome);
assert.equal(thereforeOutcome.modelId, "phantom-reference-resolver");
assert.match(thereforeOutcome.answer.trim(), /^the sensor shut down[.!]?$/i);

const originalPlanRollback: Turn[] = [];
rows.push(await ask(customerToken, "The meeting is Tuesday at 2 PM in Room 4.", originalPlanRollback));
rows.push(await ask(customerToken, "Correction: Thursday at 3 PM in Room 7.", originalPlanRollback));
rows.push(await ask(customerToken, "Actually, keep the original plan after all.", originalPlanRollback));
const restoredOriginalPlan = await ask(customerToken, "What are the final day, time, and room? DAY | TIME | ROOM only.", originalPlanRollback);
rows.push(restoredOriginalPlan);

const partialRollback: Turn[] = [];
rows.push(await ask(adminToken, "The poster background is black, the title is white, and the button is green.", partialRollback));
rows.push(await ask(adminToken, "Change the background to navy, the title to gold, and the button to orange.", partialRollback));
rows.push(await ask(adminToken, "Actually restore the original title only. Keep the other changes.", partialRollback));
const partialRollbackFinal = await ask(adminToken, "What are the final background, title, and button colors? BACKGROUND | TITLE | BUTTON only.", partialRollback);
rows.push(partialRollbackFinal);
assert.match(secondCause.answer.trim(), /^the export queue stalled[.!]?$/i);
assert.doesNotMatch(secondCause.answer, /file was corrupt|upload failed/i);
assert.match(restoredOriginalPlan.answer.trim(), /^Tuesday\s*\|\s*2 PM\s*\|\s*Room 4[.!]?$/i);
assert.doesNotMatch(restoredOriginalPlan.answer, /Thursday|3 PM|Room 7/i);
assert.match(partialRollbackFinal.answer.trim(), /^navy\s*\|\s*white\s*\|\s*orange[.!]?$/i);
assert.doesNotMatch(partialRollbackFinal.answer, /black|gold|green/i);

const sufficientRules: Turn[] = [];
rows.push(await ask(adminToken, "Rule: If the badge is valid, the door opens.", sufficientRules));
rows.push(await ask(adminToken, "The badge is valid.", sufficientRules));
const sufficientOutcome = await ask(adminToken, "Does the door open? Yes or no only.", sufficientRules);
rows.push(sufficientOutcome);
assert.equal(sufficientOutcome.modelId, "phantom-reference-resolver");
assert.equal(sufficientOutcome.answer, "Yes");
const converseRules: Turn[] = [];
rows.push(await ask(adminToken, "Rule: If the badge is valid, the door opens.", converseRules));
rows.push(await ask(adminToken, "The door is open.", converseRules));
const converseAnswer = await ask(adminToken, "Is the badge valid? Yes or no only.", converseRules);
rows.push(converseAnswer);
assert.equal(converseAnswer.modelId, "phantom-clarifier");
assert.match(converseAnswer.answer, /does not prove the converse/i);

const prerequisiteRules: Turn[] = [];
rows.push(await ask(customerToken, "Rule: Publishing requires approval.", prerequisiteRules));
rows.push(await ask(customerToken, "Approval is missing.", prerequisiteRules));
const blockedPublishing = await ask(customerToken, "Can publishing happen?", prerequisiteRules);
rows.push(blockedPublishing);
assert.equal(blockedPublishing.modelId, "phantom-reference-resolver");
assert.equal(blockedPublishing.answer, "No. Publishing is blocked because approval is missing.");
const publishingRequirement = await ask(customerToken, "What is blocking publishing? Requirement only.", prerequisiteRules);
rows.push(publishingRequirement);
assert.equal(publishingRequirement.answer, "Approval");

const correctedPrerequisites: Turn[] = [];
rows.push(await ask(adminToken, "Rule: Publishing requires approval.", correctedPrerequisites));
rows.push(await ask(adminToken, "Correction: Publishing requires legal review instead of approval.", correctedPrerequisites));
rows.push(await ask(adminToken, "Approval is complete. Legal review is missing.", correctedPrerequisites));
const correctedPrerequisiteAnswer = await ask(adminToken, "Can publishing happen?", correctedPrerequisites);
rows.push(correctedPrerequisiteAnswer);
assert.equal(correctedPrerequisiteAnswer.answer, "No. Publishing is blocked because legal review is missing.");

const unlessRules: Turn[] = [];
rows.push(await ask(customerToken, "Rule: The backup runs unless maintenance mode is active.", unlessRules));
rows.push(await ask(customerToken, "Maintenance mode is inactive.", unlessRules));
const unlessAnswer = await ask(customerToken, "Will the backup run? Yes or no only.", unlessRules);
rows.push(unlessAnswer);
assert.equal(unlessAnswer.answer, "Yes");

const cyclicRules: Turn[] = [];
rows.push(await ask(adminToken, "Rules: Alpha requires Beta. Beta requires Alpha.", cyclicRules));
const cyclicAnswer = await ask(adminToken, "What is required before Alpha?", cyclicRules);
rows.push(cyclicAnswer);
assert.equal(cyclicAnswer.modelId, "phantom-clarifier");
assert.match(cyclicAnswer.answer, /cycle: Alpha > Beta > Alpha/i);

  console.log(JSON.stringify({
    ok: true,
    model,
    requests: rows.length,
    maxLatencyMs: Math.max(...rows.map((row) => row.latencyMs)),
    averageLatencyMs: Math.round(rows.reduce((sum, row) => sum + row.latencyMs, 0) / rows.length),
    fallbackCount: rows.filter((row) => row.fallbackUsed).length,
    deterministicToolCount: rows.filter((row) => row.modelId.startsWith("phantom-")).length,
    businessLeakage: false,
    continuityVerified: true,
    topicSwitchVerified: true,
    arithmeticVerified: true,
    contextRolloverVerified: true,
    correctionsVerified: true,
    reasoningVerified: true,
    creativeReasoningVerified: true,
    advisoryReasoningVerified: true,
    providerPinningVerified: true,
    exactFormattingVerified: true,
    falsePremiseVerified: true,
    rapidFireVerified: true,
    uncertaintyVerified: true,
    empathyVerified: true,
    structuredOutputVerified: true,
    adaptiveLengthVerified: true,
    identityTruthVerified: true,
    practicalCodeVerified: true,
    multilingualVerified: true,
    sourceHonestyVerified: true,
    recencyPackingVerified: true,
    factualReplacementVerified: true,
    conversationalTasteVerified: true,
    lexicalRoutingVerified: true,
    topicIsolationVerified: true,
    naturalFollowUpVerified: true,
    namedTopicRevisitVerified: true,
    longDistanceTopicRevisitVerified: true,
    ambiguityClarificationVerified: true,
    misunderstandingRepairVerified: true,
    formerLatterVerified: true,
    listReorderVerified: true,
    pluralOwnershipVerified: true,
    chainedCorrectionsVerified: true,
    causalReferencesVerified: true,
    originalPlanRollbackVerified: true,
    partialRollbackVerified: true,
    respectivelyMappingVerified: true,
    unequalRespectivelyClarificationVerified: true,
    namedEntityRollbackVerified: true,
    namedComparisonsVerified: true,
    correctedComparisonVerified: true,
    comparisonAmbiguityVerified: true,
    orderedEventsVerified: true,
    exceptionMembershipVerified: true,
    correctedMembershipVerified: true,
    triStateMembershipVerified: true,
    splitRosterMembershipVerified: true,
    outsideRosterClarificationVerified: true,
    conditionalRulesVerified: true,
    necessaryVsSufficientVerified: true,
    correctedPrerequisitesVerified: true,
    ruleConflictCycleVerified: true,
  }, null, 2));
} finally {
  ownedServer?.kill();
}
