/* PhantomForce — public AI proxy (Cloudflare Worker).
 *
 * Lets the public site use Claude WITHOUT ever exposing the API key in the
 * browser. The key lives only as a Worker secret.
 *
 * Strict limits (abuse + cost protection):
 *   - 5 prompts per visitor (by IP) per day
 *   - global daily cap so total spend is bounded
 *   - max_tokens 160 per reply  (tiny per-call cost)
 *   - business-only system prompt, <=2 sentences, no personal data
 *
 * Deploy: see README.md. For OpenRouter, set `OPENROUTER_API_KEY`. For native
 * Anthropic, set `ANTHROPIC_API_KEY` and optionally `PF_PROVIDER=anthropic`.
 * Keys are NEVER committed or returned to the client.
 */

const PER_USER_DAILY = 5;
const GLOBAL_DAILY_CAP = 800;
const MAX_TOKENS = 160;
const ANTHROPIC_VERSION = "2023-06-01";
const ALLOWED_ORIGINS = [
  "https://phantomforce.online",
  "https://www.phantomforce.online",
  "http://127.0.0.1:8099",
  "http://localhost:8099",
];

const SYSTEM_PROMPT = [
  "You are PhantomForce, a private cyber-AI for business owners.",
  "Answer in at most two short sentences. Be sharp, confident, and genuinely useful.",
  "Stay strictly about running a business: leads, scheduling, follow-ups, operations, marketing, admin, and the risks a business faces (scams, data leaks, compliance, deadlines).",
  "Never request, store, or reveal personal or identifying information. Do not give legal, medical, or financial advice beyond general business guidance.",
  "If a question is off-topic or unsafe, briefly steer back to how PhantomForce helps a business.",
].join(" ");

function cors(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}
function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers: { ...headers, "Content-Type": "application/json" } });
}
function ttlToEndOfDay() {
  const now = Date.now();
  const end = new Date(now); end.setUTCHours(23, 59, 59, 999);
  return Math.max(60, Math.floor((end.getTime() - now) / 1000));
}
function pickProvider(env) {
  const requested = String(env.PF_PROVIDER || (env.ANTHROPIC_API_KEY ? "anthropic" : "openrouter")).toLowerCase();
  return ["anthropic", "openrouter"].includes(requested) ? requested : "openrouter";
}
function pickModel(env, provider) {
  if (env.PF_MODEL) return env.PF_MODEL;
  return provider === "anthropic" ? "claude-sonnet-5" : "~anthropic/claude-sonnet-latest";
}
async function askClaude(message, env, model) {
  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY || env.CLAUDE_API_KEY,
      "anthropic-version": env.ANTHROPIC_VERSION || ANTHROPIC_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: message }],
    }),
  });
  if (!upstream.ok) return "";
  const data = await upstream.json();
  return ((data && data.content) || [])
    .filter((block) => block && block.type === "text" && block.text)
    .map((block) => block.text)
    .join("\n")
    .trim();
}
async function askOpenRouter(message, env, model) {
  const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://phantomforce.online",
      "X-Title": "PhantomForce",
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_TOKENS,
      temperature: 0.6,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: message },
      ],
    }),
  });
  if (!upstream.ok) return "";
  const data = await upstream.json();
  return (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || "").trim();
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const headers = cors(origin);
    const provider = pickProvider(env);
    const model = pickModel(env, provider);
    const configured = provider === "anthropic"
      ? !!(env.ANTHROPIC_API_KEY || env.CLAUDE_API_KEY)
      : !!env.OPENROUTER_API_KEY;
    if (request.method === "OPTIONS") return new Response(null, { headers });
    if (request.method === "GET" && new URL(request.url).pathname === "/health") {
      return json({ ok: true, configured, provider, model }, 200, headers);
    }
    if (request.method !== "POST") return json({ error: "method" }, 405, headers);
    if (!configured) return json({ error: "unconfigured" }, 200, headers);

    const ip = request.headers.get("CF-Connecting-IP") || "anon";
    const day = new Date().toISOString().slice(0, 10);
    const userKey = `u:${ip}:${day}`;
    const globalKey = `g:${day}`;

    const used = parseInt((await env.PF_KV.get(userKey)) || "0", 10);
    if (used >= PER_USER_DAILY) {
      return json({ error: "limit", message: "That's your 5 questions for today. Summon an operator to go deeper." }, 200, headers);
    }
    const gUsed = parseInt((await env.PF_KV.get(globalKey)) || "0", 10);
    if (gUsed >= GLOBAL_DAILY_CAP) {
      return json({ error: "busy", message: "I'm at capacity for today — summon an operator." }, 200, headers);
    }

    let body;
    try { body = await request.json(); } catch { return json({ error: "bad_request" }, 400, headers); }
    const message = String((body && body.message) || "").trim().slice(0, 400);
    if (!message) return json({ error: "empty" }, 400, headers);

    let reply = "";
    try {
      reply = provider === "anthropic"
        ? await askClaude(message, env, model)
        : await askOpenRouter(message, env, model);
    } catch {
      return json({ error: "upstream" }, 200, headers);
    }
    if (!reply) return json({ error: "upstream" }, 200, headers);

    const ttl = ttlToEndOfDay();
    await env.PF_KV.put(userKey, String(used + 1), { expirationTtl: ttl });
    await env.PF_KV.put(globalKey, String(gUsed + 1), { expirationTtl: ttl });

    return json({ reply, remaining: PER_USER_DAILY - (used + 1) }, 200, headers);
  },
};
