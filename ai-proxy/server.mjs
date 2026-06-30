/* PhantomForce — public AI proxy (self-hosted, for Pangolin).
 *
 * A tiny standalone Node server (no dependencies) that lets the public site use
 * GLM 5.2 via OpenRouter WITHOUT exposing the key in the browser. The key lives
 * only in this server's environment. Run it on your always-on box and expose it
 * publicly through Pangolin.
 *
 * Run:
 *   OPENROUTER_API_KEY=... node ai-proxy/server.mjs      (Node 18+)
 * then add a Pangolin route:  https://ai.phantomforce.online  ->  127.0.0.1:8788
 *
 * Limits (bot armor — your real visitors never feel them):
 *   PF_PER_USER_DAILY (default 5), PF_GLOBAL_DAILY_CAP (default 1000),
 *   PF_MAX_TOKENS (default 160). Override via env.
 */

import http from "node:http";

const KEY = process.env.OPENROUTER_API_KEY || "";
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 8788);
const MODEL = process.env.PF_MODEL || "z-ai/glm-5.2";
const PER_USER_DAILY = Number(process.env.PF_PER_USER_DAILY || 5);
const GLOBAL_DAILY_CAP = Number(process.env.PF_GLOBAL_DAILY_CAP || 1000);
const MAX_TOKENS = Number(process.env.PF_MAX_TOKENS || 160);
const ALLOWED = (process.env.PF_ALLOWED_ORIGINS ||
  "https://phantomforce.online,https://www.phantomforce.online,http://127.0.0.1:8099,http://localhost:8099"
).split(",").map((s) => s.trim());

const SYSTEM_PROMPT = [
  "You are PhantomForce, a private cyber-AI for business owners.",
  "Answer in at most two short sentences. Be sharp, confident, and genuinely useful.",
  "Stay strictly about running a business: leads, scheduling, follow-ups, operations, marketing, admin, and the risks a business faces (scams, data leaks, compliance, deadlines).",
  "Never request, store, or reveal personal or identifying information. Do not give legal, medical, or financial advice beyond general business guidance.",
  "If a question is off-topic or unsafe, briefly steer back to how PhantomForce helps a business.",
].join(" ");

const userHits = new Map(); // ip -> { day, n }
let globalHits = { day: "", n: 0 };
const today = () => new Date().toISOString().slice(0, 10);

const server = http.createServer((req, res) => {
  const origin = req.headers.origin || "";
  const allow = ALLOWED.includes(origin) ? origin : ALLOWED[0];
  const base = {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
  const send = (obj, status = 200) => {
    res.writeHead(status, { ...base, "Content-Type": "application/json" });
    res.end(JSON.stringify(obj));
  };

  if (req.method === "OPTIONS") { res.writeHead(204, base); return res.end(); }
  if (req.method === "GET" && req.url === "/health") return send({ ok: true, configured: !!KEY });
  if (req.method !== "POST") { res.writeHead(405, base); return res.end(); }
  if (!KEY) return send({ error: "unconfigured" });

  const d = today();
  if (globalHits.day !== d) globalHits = { day: d, n: 0 };
  const ip = (String(req.headers["x-forwarded-for"] || "").split(",")[0].trim()) || req.socket.remoteAddress || "anon";
  let u = userHits.get(ip);
  if (!u || u.day !== d) { u = { day: d, n: 0 }; userHits.set(ip, u); }
  if (u.n >= PER_USER_DAILY) return send({ error: "limit", message: "That's your free questions for today. Summon an operator to go deeper." });
  if (globalHits.n >= GLOBAL_DAILY_CAP) return send({ error: "busy", message: "I'm at capacity for today — summon an operator." });

  let body = "";
  req.on("data", (c) => { body += c; if (body.length > 4000) req.destroy(); });
  req.on("end", async () => {
    let message;
    try { message = String((JSON.parse(body) || {}).message || "").trim().slice(0, 400); }
    catch { return send({ error: "bad_request" }, 400); }
    if (!message) return send({ error: "empty" }, 400);
    try {
      const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://phantomforce.online",
          "X-Title": "PhantomForce",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          temperature: 0.6,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: message },
          ],
        }),
      });
      if (!upstream.ok) return send({ error: "upstream" });
      const data = await upstream.json();
      const reply = ((((data || {}).choices || [])[0] || {}).message || {}).content;
      const clean = (reply || "").trim();
      if (!clean) return send({ error: "upstream" });
      u.n += 1; globalHits.n += 1;
      send({ reply: clean, remaining: PER_USER_DAILY - u.n });
    } catch {
      send({ error: "upstream" });
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`PhantomForce AI proxy listening on http://${HOST}:${PORT}  (key configured: ${!!KEY})`);
});
