import assert from "node:assert/strict";

import { callLocalOllamaChat } from "../src/phantom-ai/providers/local-ollama-transport.js";

const baseUrl = process.env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434";
const model = process.env.PHANTOM_INSTANT_CHAT_MODEL?.trim() || "qwen3:4b";
const forbidden = /\b(?:ledger|pipeline|invoice|approval queue|workspace status|cashflow|action card)\b/i;

type Turn = { user: string; assistant: string };

function conversationContext(turns: Turn[]) {
  const rule = "Answer the current casual request directly. Resolve pronouns and transformations from the newest relevant turn, preserve named subjects, and treat later corrections as authoritative. Follow exact format constraints such as 'only the number' without extra framing. Never volunteer ledger, pipeline, accounting, approvals, or dashboard status unless explicitly asked.";
  if (!turns.length) return `Fast casual chat. No business memory required. ${rule}`;
  const transcript = turns.map((turn, index) =>
    `Turn ${index + 1} user: ${turn.user}\nTurn ${index + 1} assistant: ${turn.assistant}`).join("\n");
  return `Fast casual chat. Temporary recent conversation follows.\n${transcript}\n${rule}`;
}

async function prewarm() {
  const response = await fetch(`${baseUrl}/api/generate`, {
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

async function ask(prompt: string, turns: Turn[]) {
  const started = Date.now();
  const result = await callLocalOllamaChat({
    requestId: `instant-live-${Date.now()}`,
    businessName: "PhantomForce",
    taskType: "chat",
    userMessage: prompt,
    compactContext: conversationContext(turns),
    sensitivityLevel: "low",
    approvalRequired: false,
    conversationMode: true,
    maxTokens: 100,
    adminOperatorLane: true,
  }, {
    env: {
      OLLAMA_BASE_URL: baseUrl,
      PHANTOM_OLLAMA_MODEL: model,
      PHANTOM_OLLAMA_TIMEOUT_MS: "4500",
    },
  });
  const latencyMs = Date.now() - started;
  assert.equal(result.status, "called", `${prompt}: ${result.error_message || result.blocked_reason}`);
  assert.equal(result.model_id, model);
  assert.ok(result.output_text.trim().length > 0, `Empty response for: ${prompt}`);
  assert.doesNotMatch(result.output_text, forbidden, `Business context leaked into: ${prompt}`);
  assert.ok(latencyMs <= 4500, `${prompt} took ${latencyMs}ms after prewarm`);
  turns.push({ user: prompt, assistant: result.output_text });
  return { prompt, answer: result.output_text, latencyMs };
}

await prewarm();

const subjectTurns: Turn[] = [];
const subjectRows = [
  await ask("Remember for this chat only: my dog's name is Pixel.", subjectTurns),
  await ask("Actually I misspoke, her name is Nova.", subjectTurns),
  await ask("Write one funny sentence about her.", subjectTurns),
];
assert.match(subjectRows.at(-1)!.answer, /Nova/i, "Pronoun rewrite lost the corrected named subject");
assert.doesNotMatch(subjectRows.at(-1)!.answer, /Pixel/i, "The superseded name resurfaced");

const preferenceTurns: Turn[] = [];
const preferenceRows = [
  await ask("What's your favorite breakfast?", preferenceTurns),
  await ask("Why do you like it?", preferenceTurns),
  await ask("Make a joke about it.", preferenceTurns),
];
assert.doesNotMatch(preferenceRows[0].answer, /as an ai|do not have|don't have|cannot have/i, "Harmless preference answer was robotic");

const mathTurns: Turn[] = [];
const mathRows = [
  await ask("A shirt costs 80 dollars and is 25 percent off. What's the sale price?", mathTurns),
  await ask("If I buy two and add 10 percent tax, what is the total?", mathTurns),
  await ask("Double-check the math.", mathTurns),
  await ask("Give me only the final number.", mathTurns),
];
assert.match(mathRows[0].answer, /\b60\b/, "Discount arithmetic was incorrect");
assert.match(mathRows[1].answer, /\b132\b/, "Quantity plus tax arithmetic was incorrect");
assert.match(mathRows[2].answer, /\b132\b/, "Arithmetic verification changed the correct result");
assert.match(mathRows[3].answer.trim(), /^\$?132(?:\.00)?$/, "Exact final-number constraint was not followed");

const rows = [...subjectRows, ...preferenceRows, ...mathRows];
console.log(JSON.stringify({
  ok: true,
  model,
  prompts: rows.length,
  maxLatencyMs: Math.max(...rows.map((row) => row.latencyMs)),
  averageLatencyMs: Math.round(rows.reduce((sum, row) => sum + row.latencyMs, 0) / rows.length),
  subjectPreserved: true,
  preferenceNatural: true,
  arithmeticVerified: true,
  businessLeakage: false,
}, null, 2));
