/* PhantomForce — public AI proxy (self-hosted, for Pangolin).
 *
 * A tiny standalone Node server (no dependencies) that lets the public site use
 * Claude WITHOUT exposing any provider key in the browser. The key lives only
 * in this server's environment. Run it on your always-on box and expose it
 * publicly through Pangolin.
 *
 * Run:
 *   OPENROUTER_API_KEY=... node ai-proxy/server.mjs      (Claude via OpenRouter)
 *   ANTHROPIC_API_KEY=... PF_PROVIDER=anthropic node ai-proxy/server.mjs
 * then add a Pangolin route:  https://ai.phantomforce.online  ->  127.0.0.1:8788
 *
 * Limits (bot armor — your real visitors never feel them):
 *   PF_PER_USER_DAILY (default 5), PF_GLOBAL_DAILY_CAP (default 1000),
 *   PF_MAX_TOKENS (default 160). Override via env.
 */

import http from "node:http";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

// Minimal, zero-dependency .env loader so secrets (RESEND_API_KEY, etc.) live in
// a gitignored ai-proxy/.env instead of the shell history or the code. A real
// environment variable always wins over the file.
try {
  const envPath = fileURLToPath(new URL("./.env", import.meta.url));
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* no .env file — rely on the real environment */ }

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 8788);
const EXTRA_HOSTS = (process.env.PF_EXTRA_HOSTS || "::1")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || "";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || "";
const requestedProvider = (process.env.PF_PROVIDER || (ANTHROPIC_KEY ? "anthropic" : "openrouter")).toLowerCase();
const PROVIDER = ["anthropic", "openrouter"].includes(requestedProvider) ? requestedProvider : "openrouter";
const KEY = PROVIDER === "anthropic" ? ANTHROPIC_KEY : OPENROUTER_KEY;
const MODEL = process.env.PF_MODEL || (
  PROVIDER === "anthropic"
    ? "claude-sonnet-5"
    : "~anthropic/claude-sonnet-latest"
);
const ANTHROPIC_VERSION = process.env.ANTHROPIC_VERSION || "2023-06-01";
const PER_USER_DAILY = Number(process.env.PF_PER_USER_DAILY || 5);
const GLOBAL_DAILY_CAP = Number(process.env.PF_GLOBAL_DAILY_CAP || 1000);
const MAX_TOKENS = Number(process.env.PF_MAX_TOKENS || 160);
const ALLOWED = (process.env.PF_ALLOWED_ORIGINS ||
  "https://phantomforce.online,https://www.phantomforce.online,https://app.phantomforce.online,http://127.0.0.1:8099,http://localhost:8099"
).split(",").map((s) => s.trim());

// --- Demo signup → automated email (Resend) ---
// The API key lives ONLY here in env. Never hard-code it, never log it.
//   RESEND_API_KEY=re_...  PF_DEMO_FROM="PhantomForce <demo@phantomforce.online>"
//   PF_DEMO_DOWNLOAD_URL=https://phantomforce.online/downloads/phantomforce-demo.zip
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const DEMO_FROM = process.env.PF_DEMO_FROM || "PhantomForce <onboarding@resend.dev>";
const DEMO_DOWNLOAD_URL = process.env.PF_DEMO_DOWNLOAD_URL || "";
const DEMO_SUBJECT = process.env.PF_DEMO_SUBJECT || "Your PhantomForce demo is ready";
const SIGNUPS_FILE = process.env.PF_SIGNUPS_FILE || fileURLToPath(new URL("./signups.json", import.meta.url));

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

async function askClaude(message) {
  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": KEY,
      "anthropic-version": ANTHROPIC_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
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

async function askOpenRouter(message) {
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
  if (!upstream.ok) return "";
  const data = await upstream.json();
  return (((((data || {}).choices || [])[0] || {}).message || {}).content || "").trim();
}

/* ---------------- demo signup → automated email ---------------- */
function readSignups() {
  try {
    const parsed = JSON.parse(fs.readFileSync(SIGNUPS_FILE, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
function writeSignups(list) {
  fs.writeFileSync(SIGNUPS_FILE, JSON.stringify(list, null, 2));
}
function recordSignup(email, token) {
  const list = readSignups();
  const existing = list.find((r) => r.email === email);
  if (existing) { existing.token = existing.token || token; existing.at = existing.at || new Date().toISOString(); }
  else list.push({ email, token, at: new Date().toISOString(), paid: false, accessKey: null });
  writeSignups(list);
}

function demoEmailHtml(downloadUrl) {
  const cta = downloadUrl
    ? `<a href="${downloadUrl}" style="display:inline-block;padding:13px 26px;border-radius:999px;background:#33ffa0;color:#02140b;font-weight:700;text-decoration:none;letter-spacing:0.04em">Download the PhantomForce demo &rarr;</a>`
    : `<span style="color:#8fb9a6">Your demo download link will follow shortly.</span>`;
  return `<div style="background:#02060a;color:#dff7ec;font-family:Menlo,Consolas,monospace,Arial;padding:40px 28px;text-align:center">
    <div style="font-size:20px;letter-spacing:0.14em;color:#33ffa0;margin-bottom:18px">PHANTOMFORCE</div>
    <p style="font-size:15px;line-height:1.6;max-width:460px;margin:0 auto 26px">Your private cyber-AI demo is ready. It runs the boring half of your business &mdash; leads, replies, scheduling, follow-ups &mdash; privately, with nothing sent without you.</p>
    <p style="margin:0 0 30px">${cta}</p>
    <p style="font-size:12px;color:#6f8f81;line-height:1.6">You requested this on phantomforce.online. If it wasn't you, just ignore this email.</p>
  </div>`;
}

// Resend transactional send. Returns {ok}. If no key is configured it does NOT
// send (stub) — so the flow is testable without a live external send.
async function sendDemoEmail(to, downloadUrl) {
  if (!RESEND_API_KEY) {
    console.log(`[demo-email STUB — set RESEND_API_KEY to send] to=${to} link=${downloadUrl || "(set PF_DEMO_DOWNLOAD_URL)"}`);
    return { ok: false, stub: true };
  }
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: DEMO_FROM, to: [to], subject: DEMO_SUBJECT, html: demoEmailHtml(downloadUrl) }),
    });
    if (!r.ok) { console.warn(`[demo-email] Resend responded ${r.status}`); return { ok: false }; }
    return { ok: true };
  } catch (e) {
    console.warn(`[demo-email] send failed: ${e && e.message}`);
    return { ok: false };
  }
}

function handleRegister(req, res, send) {
  let body = "";
  req.on("data", (c) => { body += c; if (body.length > 2000) req.destroy(); });
  req.on("end", async () => {
    let email;
    try { email = String((JSON.parse(body) || {}).email || "").trim().toLowerCase(); }
    catch { return send({ error: "bad_request" }, 400); }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return send({ error: "invalid_email" }, 400);
    // Unique token: the demo download key today, and the seed for a paid access
    // key later (active subscription -> upgrade the same record).
    const token = crypto.randomUUID().replace(/-/g, "");
    const downloadUrl = DEMO_DOWNLOAD_URL
      ? `${DEMO_DOWNLOAD_URL}${DEMO_DOWNLOAD_URL.includes("?") ? "&" : "?"}key=${token}`
      : "";
    try { recordSignup(email, token); } catch (e) { console.warn(`[register] could not store signup: ${e && e.message}`); }
    const result = await sendDemoEmail(email, downloadUrl).catch(() => ({ ok: false }));
    send({ ok: true, emailed: !!result.ok, live: !!RESEND_API_KEY });
  });
}

/* ---------------- stage 3: active subscription → paid access key ---------------- */
function generateAccessKey() {
  const raw = crypto.randomBytes(12).toString("base64").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return `PF-PRO-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

// Upgrade a signup to paid and mint a one-per-customer access key. Idempotent:
// re-upgrading the same email returns the existing key.
function upgradeSignup(email) {
  const list = readSignups();
  let rec = list.find((r) => r.email === email);
  if (!rec) { rec = { email, token: crypto.randomUUID().replace(/-/g, ""), at: new Date().toISOString() }; list.push(rec); }
  if (!rec.accessKey) rec.accessKey = generateAccessKey();
  rec.paid = true; rec.upgradedAt = rec.upgradedAt || new Date().toISOString();
  writeSignups(list);
  return rec.accessKey;
}

function accessKeyEmailHtml(accessKey) {
  return `<div style="background:#02060a;color:#dff7ec;font-family:Menlo,Consolas,monospace,Arial;padding:40px 28px;text-align:center">
    <div style="font-size:20px;letter-spacing:0.14em;color:#33ffa0;margin-bottom:18px">PHANTOMFORCE PRO</div>
    <p style="font-size:15px;line-height:1.6;max-width:460px;margin:0 auto 24px">Your subscription is active. Here's your private access key &mdash; enter it in PhantomForce to unlock the full version.</p>
    <p style="margin:0 0 26px"><span style="display:inline-block;padding:13px 22px;border:1px solid #33ffa0;border-radius:12px;background:rgba(51,255,160,0.08);color:#7dffc4;font-size:18px;letter-spacing:0.12em">${accessKey}</span></p>
    <p style="font-size:12px;color:#6f8f81;line-height:1.6">Keep this key private. It's tied to your account and unlocks paid features.</p>
  </div>`;
}

async function sendAccessKeyEmail(to, accessKey) {
  if (!RESEND_API_KEY) {
    console.log(`[access-key STUB — set RESEND_API_KEY to send] to=${to} key=${accessKey}`);
    return { ok: false, stub: true };
  }
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: DEMO_FROM, to: [to], subject: "Your PhantomForce Pro access key", html: accessKeyEmailHtml(accessKey) }),
    });
    if (!r.ok) { console.warn(`[access-key] Resend responded ${r.status}`); return { ok: false }; }
    return { ok: true };
  } catch (e) {
    console.warn(`[access-key] send failed: ${e && e.message}`);
    return { ok: false };
  }
}

// Owner-only: called when a subscription goes active (manually, or later by a
// payment-provider webhook). Guarded by PF_ADMIN_KEY so the public can't self-upgrade.
function handleUpgrade(req, res, send) {
  const adminKey = process.env.PF_ADMIN_KEY || "";
  const provided = String(req.headers["x-admin-key"] || "");
  if (!adminKey || provided.length !== adminKey.length || !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(adminKey))) {
    return send({ error: "forbidden" }, 403);
  }
  let body = "";
  req.on("data", (c) => { body += c; if (body.length > 2000) req.destroy(); });
  req.on("end", async () => {
    let email;
    try { email = String((JSON.parse(body) || {}).email || "").trim().toLowerCase(); }
    catch { return send({ error: "bad_request" }, 400); }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return send({ error: "invalid_email" }, 400);
    const accessKey = upgradeSignup(email);
    const result = await sendAccessKeyEmail(email, accessKey).catch(() => ({ ok: false }));
    send({ ok: true, accessKey, emailed: !!result.ok, live: !!RESEND_API_KEY });
  });
}

function handleRequest(req, res) {
  const origin = req.headers.origin || "";
  const allow = ALLOWED.includes(origin) ? origin : ALLOWED[0];
  const base = {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-admin-key",
    "Vary": "Origin",
  };
  const send = (obj, status = 200) => {
    res.writeHead(status, { ...base, "Content-Type": "application/json" });
    res.end(JSON.stringify(obj));
  };

  if (req.method === "OPTIONS") { res.writeHead(204, base); return res.end(); }
  const path = (req.url || "").split("?")[0];
  if (req.method === "GET" && path === "/health") return send({ ok: true, configured: !!KEY, provider: PROVIDER, model: MODEL, demoEmail: !!RESEND_API_KEY });
  if (req.method !== "POST") { res.writeHead(405, base); return res.end(); }
  // Demo signup lives outside the AI proxy: it works even without an AI key.
  if (path === "/register") return handleRegister(req, res, send);
  if (path === "/upgrade") return handleUpgrade(req, res, send);
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
      const reply = PROVIDER === "anthropic"
        ? await askClaude(message)
        : await askOpenRouter(message);
      const clean = (reply || "").trim();
      if (!clean) return send({ error: "upstream" });
      u.n += 1; globalHits.n += 1;
      send({ reply: clean, remaining: PER_USER_DAILY - u.n });
    } catch {
      send({ error: "upstream" });
    }
  });
}

const server = http.createServer(handleRequest);

server.listen(PORT, HOST, () => {
  console.log(`PhantomForce AI proxy listening on http://${HOST}:${PORT}  (provider: ${PROVIDER}, model: ${MODEL}, key configured: ${!!KEY})`);
});

for (const extraHost of EXTRA_HOSTS) {
  if (extraHost === HOST) continue;
  const extraServer = http.createServer(handleRequest);
  extraServer.on("error", (err) => {
    console.warn(`PhantomForce AI proxy extra listener ${extraHost}:${PORT} unavailable: ${err.message}`);
  });
  extraServer.listen(PORT, extraHost, () => {
    console.log(`PhantomForce AI proxy also listening on http://${extraHost}:${PORT}`);
  });
}
