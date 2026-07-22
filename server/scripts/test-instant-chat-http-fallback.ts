import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const port = "5193";
const baseUrl = `http://127.0.0.1:${port}`;
const forbidden = /\b(?:ledger|pipeline|invoice|approval queue|workspace status|cashflow|action card)\b/i;

async function ready() {
  try {
    return (await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(500) })).ok;
  } catch {
    return false;
  }
}

const serverRoot = fileURLToPath(new URL("../", import.meta.url));
const tsxLoader = fileURLToPath(new URL("../../node_modules/tsx/dist/loader.mjs", import.meta.url));
const child = spawn(process.execPath, ["--import", pathToFileURL(tsxLoader).href, "src/index.ts"], {
  cwd: serverRoot,
  env: {
    ...process.env,
    PORT: port,
    HOST: "127.0.0.1",
    NODE_ENV: "development",
    PHANTOMFORCE_AUTH_PROVIDER: "demo",
    PHANTOMFORCE_ENABLE_DEMO_AUTH: "true",
    PHANTOMFORCE_SKIP_SERVER_DOTENV: "true",
    OLLAMA_BASE_URL: "http://127.0.0.1:9",
    PHANTOM_LOCAL_MODEL_AVAILABLE: "true",
    PHANTOM_OLLAMA_TIMEOUT_MS: "250",
  },
  stdio: "ignore",
  windowsHide: true,
});

for (let attempt = 0; attempt < 60 && !(await ready()); attempt += 1) {
  assert.equal(child.exitCode, null, "Disposable fallback server exited during startup");
  await new Promise((resolve) => setTimeout(resolve, 100));
}
assert.equal(await ready(), true, "Disposable fallback server did not become ready");

type Turn = { user: string; assistant: string };

try {
  const login = await fetch(`${baseUrl}/auth/session-login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: "admin-jordan" }),
  });
  assert.equal(login.ok, true);
  const token = String((await login.json() as { token?: string }).token || "");
  assert.ok(token);

  const turns: Turn[] = [{
    user: "Show my accounting ledger.",
    assistant: "Your ledger has three entries, a pipeline update, and one invoice.",
  }];
  async function ask(prompt: string) {
    const response = await fetch(`${baseUrl}/phantom-ai/chat`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        message: prompt,
        user_request: prompt,
        provider: "ollama",
        admin_model: "local_ollama",
        model_lane: "local_ollama",
        requested_model: "qwen3:4b",
        route_tier: "instant",
        max_provider_ms: 300,
        allow_provider_fallback: false,
        allowed_providers: ["local_ollama"],
        execution_mode: "approval",
        task_type: "chat",
        tenant_id: "phantomforce",
        workspace_id: "phantomforce",
        business_name: "PhantomForce",
        actor_user_id: "fallback-quality-test",
        conversation_history: turns.slice(-8),
      }),
      signal: AbortSignal.timeout(4_000),
    });
    assert.equal(response.ok, true, `${prompt}: HTTP ${response.status}`);
    const payload = await response.json() as Record<string, any>;
    const answer = String(payload.message?.content || "").trim();
    assert.ok(answer);
    assert.doesNotMatch(answer, forbidden);
    assert.equal(payload.route_tier, "instant");
    turns.push({ user: prompt, assistant: answer });
    return { payload, answer };
  }

  const first = await ask("Explain photosynthesis.");
  assert.equal(first.payload.fallback?.all_failed, true);
  assert.equal(first.payload.fallback?.local_response, true);
  assert.equal(first.payload.model_id, "phantom-instant-local-fallback");
  assert.match(first.answer, /sunlight/i);
  assert.doesNotMatch(first.answer, /three entries/i);

  const simpler = await ask("Say that simpler.");
  assert.equal(simpler.payload.fallback?.all_failed, true);
  assert.match(simpler.answer, /plants use sunlight/i);

  const food = await ask("New topic: what's your favorite food?");
  assert.equal(food.payload.model_id, "phantom-personality");
  assert.match(food.answer, /spicy ramen/i);
  assert.equal(food.payload.fallback?.all_failed, false);

  console.log("instant chat HTTP forced-fallback checks passed (3 requests, provider unreachable)");
} finally {
  child.kill();
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
}
