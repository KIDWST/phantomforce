import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

const baseUrl = process.env.PHANTOM_TEST_SERVER_URL?.trim() || "http://127.0.0.1:5192";
const model = process.env.PHANTOM_INSTANT_CHAT_MODEL?.trim() || "qwen2.5:14b";
const forbidden = /\b(?:ledger|pipeline|invoice|approval queue|workspace status|cashflow|action card)\b/i;

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
  const child = spawn(process.execPath, ["dist/index.js"], {
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

async function ask(token: string, prompt: string, turns: Turn[]): Promise<Answer> {
  const recent = turns.slice(-8);
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
      provider: "ollama",
      admin_model: "local_ollama",
      model_lane: "local_ollama",
      requested_model: model,
      route_tier: "instant",
      max_provider_ms: 4500,
      allow_provider_fallback: false,
      allowed_providers: ["local_ollama"],
      execution_mode: "approval",
      task_type: "chat",
      tenant_id: "phantomforce",
      workspace_id: "phantomforce",
      business_name: "PhantomForce",
      actor_user_id: "chat-quality-test",
      business_summary: "General conversation. Business workspace status is intentionally out of scope.",
      module_data: recent.length ? [{
        module: "recent_conversation",
        summary: `${recent.length} temporary chat turns.`,
        items: recent.map((turn) => ({ title: turn.user, detail: turn.assistant })),
      }] : [],
      conversation_history: recent,
    }),
    signal: AbortSignal.timeout(7_000),
  });
  const latencyMs = Date.now() - started;
  assert.equal(response.ok, true, `${prompt}: HTTP ${response.status}`);
  const payload = await response.json() as Record<string, any>;
  const answer = String(payload.message?.content || "").trim();
  assert.ok(answer, `Empty answer for: ${prompt}`);
  assert.doesNotMatch(answer, forbidden, `Business context leaked into: ${prompt}`);
  assert.equal(payload.route_tier, "instant", `${prompt}: left the instant route`);
  assert.ok(
    [model, "phantom-calculator", "phantom-reference-resolver"].includes(String(payload.model_id)),
    `${prompt}: unexpected responder ${payload.model_id}`,
  );
  assert.equal(payload.fallback?.all_failed, false, `${prompt}: model failed`);
  assert.ok(latencyMs <= 5_500, `${prompt}: ${latencyMs}ms exceeded the warm HTTP budget`);
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

const ownedServer = await ensureServer();
try {
  const adminToken = await login("admin-jordan");
  const customerToken = await login("client-sports-demo");
  const rows: Answer[] = [];

const continuity: Turn[] = [];
rows.push(await ask(adminToken, "For this chat only, my dog Nova wears a yellow raincoat.", continuity));
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
const expectedSecondName = nameOptions.answer.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)[1];
assert.ok(expectedSecondName, "The model must return at least two line-separated names");
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
  "End with one surprising fact, no introduction.",
]) rows.push(await ask(customerToken, prompt, rollover));
assert.doesNotMatch(rows.at(-1)!.answer, forbidden);
assert.doesNotMatch(rows.at(-1)!.answer, /^(?:yes|did you know|surprising fact|fun fact)\b/i);
assert.equal((rows.at(-1)!.answer.match(/[.!?]+/g) || []).length, 1, "no-introduction request must return one fact only");

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
  }, null, 2));
} finally {
  ownedServer?.kill();
}
