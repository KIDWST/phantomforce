import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const worker = readFileSync(new URL("../ai-proxy/worker.js", import.meta.url), "utf8");

assert.doesNotMatch(worker, /pf-visitor-fallback/u, "Cloudflare Worker must not sign visitor tokens with a static fallback secret.");
assert.doesNotMatch(worker, /env\.PF_VISITOR_SECRET\s*\|\|/u, "Visitor token signing must not use truthy-or fallback secrets.");
assert.match(worker, /const SECRET_MIN_CHARS = 24/u, "Worker must require non-trivial signing and admin secrets.");
assert.match(worker, /function configuredVisitorSecret\(env\)/u, "Worker must centralize visitor secret validation.");
assert.match(worker, /visitor_secret_configured:\s*!!configuredVisitorSecret\(env\)/u, "Worker health must report whether visitor signing is configured.");
assert.match(worker, /error:\s*"visitor_secret_unconfigured"/u, "Worker chat must fail closed when visitor signing is missing.");
assert.match(worker, /Public AI chat is unavailable until visitor signing is configured/u, "Worker must return a safe visitor-secret configuration message.");

assert.match(worker, /function configuredMediaAdminKey\(env\)/u, "Worker must centralize media admin key detection.");
assert.match(worker, /function constantTimeEqual\(a, b\)/u, "Worker must compare admin keys without early-exit string equality.");
assert.match(worker, /media_admin_key_configured:\s*!!configuredMediaAdminKey\(env\)/u, "Worker health must report whether media generation has an admin gate.");
assert.match(worker, /const envKey = env\[prov\.keyEnv\] \|\| "";/u, "Worker must distinguish company env provider keys from caller-supplied keys.");
assert.match(worker, /if \(envKey\) \{[\s\S]*?if \(!adminKey\) return json\(\{ error: "media_admin_key_unconfigured" \}, 503, headers\);[\s\S]*?if \(!constantTimeEqual\(request\.headers\.get\("x-admin-key"\), adminKey\)\) return json\(\{ error: "forbidden" \}, 403, headers\);[\s\S]*?\}/u, "Worker must not spend stored media provider keys without an admin gate.");
assert.match(worker, /const key = envKey \|\| requestKey;/u, "Worker should still allow explicit caller-supplied provider keys when no company key is used.");

const { default: runtime } = await import(new URL("../ai-proxy/worker.js", import.meta.url));
const publicOrigin = "https://phantomforce.online";

const health = await runtime.fetch(new Request(`${publicOrigin}/health`, {
  method: "GET",
  headers: { Origin: publicOrigin },
}), { OPENAI_API_KEY: "test-openai-key" });
const healthBody = await health.json();
assert.equal(health.status, 200, "Worker health must remain readable.");
assert.equal(healthBody.visitor_secret_configured, false, "Health must report missing visitor signing.");
assert.equal(healthBody.media_admin_key_configured, false, "Health must report missing media admin gate.");

const chatWithoutSecret = await runtime.fetch(new Request(`${publicOrigin}/chat`, {
  method: "POST",
  headers: { Origin: publicOrigin, "Content-Type": "application/json" },
  body: JSON.stringify({ message: "How do I get more leads?" }),
}), { OPENAI_API_KEY: "test-openai-key" });
const chatWithoutSecretBody = await chatWithoutSecret.json();
assert.equal(chatWithoutSecret.status, 503, "Public chat must fail closed when visitor signing is missing.");
assert.equal(chatWithoutSecretBody.error, "visitor_secret_unconfigured", "Public chat must explain the missing visitor signing gate.");

const chatWithShortSecret = await runtime.fetch(new Request(`${publicOrigin}/chat`, {
  method: "POST",
  headers: { Origin: publicOrigin, "Content-Type": "application/json" },
  body: JSON.stringify({ message: "How do I follow up faster?" }),
}), { OPENAI_API_KEY: "test-openai-key", PF_VISITOR_SECRET: "too-short" });
const chatWithShortSecretBody = await chatWithShortSecret.json();
assert.equal(chatWithShortSecret.status, 503, "Public chat must fail closed when visitor signing is too short.");
assert.equal(chatWithShortSecretBody.error, "visitor_secret_unconfigured", "Short visitor signing secrets must be treated as unconfigured.");

const mediaWithoutAdminGate = await runtime.fetch(new Request(`${publicOrigin}/generate`, {
  method: "POST",
  headers: { Origin: publicOrigin, "Content-Type": "application/json" },
  body: JSON.stringify({ provider: "openai", prompt: "A private test image" }),
}), { OPENAI_API_KEY: "test-openai-key" });
const mediaWithoutAdminGateBody = await mediaWithoutAdminGate.json();
assert.equal(mediaWithoutAdminGate.status, 503, "Media generation must fail closed when an env provider key has no admin gate.");
assert.equal(mediaWithoutAdminGateBody.error, "media_admin_key_unconfigured", "Media generation must explain the missing admin gate.");

const originalFetch = globalThis.fetch;
const generatedUrl = "https://example.invalid/generated.png";
try {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), auth: init.headers?.Authorization || init.headers?.authorization || "" });
    return new Response(JSON.stringify({ data: [{ url: generatedUrl }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const callerKeyMedia = await runtime.fetch(new Request(`${publicOrigin}/generate`, {
    method: "POST",
    headers: { Origin: publicOrigin, "Content-Type": "application/json", "x-provider-key": "caller-owned-key" },
    body: JSON.stringify({ provider: "openai", prompt: "A caller-owned test image" }),
  }), {});
  const callerKeyMediaBody = await callerKeyMedia.json();
  assert.equal(callerKeyMedia.status, 200, "Caller-supplied provider keys should remain usable when no env key is configured.");
  assert.equal(callerKeyMediaBody.assets?.[0]?.url, generatedUrl, "Caller-supplied provider key path must return generated assets.");
  assert.equal(calls.at(-1)?.auth, "Bearer caller-owned-key", "Caller-supplied provider key must be used for the upstream request.");

  const adminKey = "123456789012345678901234";
  const callsBeforeWrongAdmin = calls.length;
  const wrongAdminMedia = await runtime.fetch(new Request(`${publicOrigin}/generate`, {
    method: "POST",
    headers: { Origin: publicOrigin, "Content-Type": "application/json", "x-admin-key": "123456789012345678901235" },
    body: JSON.stringify({ provider: "openai", prompt: "A blocked owner-gated test image" }),
  }), { OPENAI_API_KEY: "env-owned-key", PF_MEDIA_ADMIN_KEY: adminKey });
  const wrongAdminMediaBody = await wrongAdminMedia.json();
  assert.equal(wrongAdminMedia.status, 403, "Env provider keys must reject mismatched admin keys.");
  assert.equal(wrongAdminMediaBody.error, "forbidden", "Wrong admin keys must receive a forbidden response.");
  assert.equal(calls.length, callsBeforeWrongAdmin, "Wrong admin keys must not reach the upstream provider.");

  const envKeyMedia = await runtime.fetch(new Request(`${publicOrigin}/generate`, {
    method: "POST",
    headers: { Origin: publicOrigin, "Content-Type": "application/json", "x-admin-key": adminKey },
    body: JSON.stringify({ provider: "openai", prompt: "An owner-gated test image" }),
  }), { OPENAI_API_KEY: "env-owned-key", PF_MEDIA_ADMIN_KEY: adminKey });
  const envKeyMediaBody = await envKeyMedia.json();
  assert.equal(envKeyMedia.status, 200, "Env provider keys should work when a valid admin gate is supplied.");
  assert.equal(envKeyMediaBody.assets?.[0]?.url, generatedUrl, "Env provider key path must return generated assets after admin auth.");
  assert.equal(calls.at(-1)?.auth, "Bearer env-owned-key", "Env provider key must be used after the admin gate passes.");
} finally {
  globalThis.fetch = originalFetch;
}

console.log("AI proxy Worker security checks passed.");
