// Termina smoke test against the current multi-terminal API surface.
// Node 20+ (global fetch). No dependencies. Assumes a server started with
// TERMINA_PORT/TERMINA_TOKEN; the old v0.1 standalone expectations (kali-lab
// blocked profile, fixed "control" session) no longer exist and were removed
// here on 2026-07-18.
const PORT = process.env.TERMINA_PORT ?? "7431";
const TOKEN = process.env.TERMINA_TOKEN ?? "smoke-token";
const BASE = `http://127.0.0.1:${PORT}`;

const fail = (m) => {
  console.error("SMOKE FAILED:", m);
  process.exit(1);
};
const H = { "x-termina-token": TOKEN };

// Bad token is rejected.
const bad = await fetch(`${BASE}/api/profiles`, { headers: { "x-termina-token": "nope" } });
if (bad.status !== 401) fail(`bad token should be 401, got ${bad.status}`);

const health = await fetch(`${BASE}/api/health`, { headers: H }).then((r) => r.json());
if (!health.ok || health.app !== "termina") fail("health check failed");

const prof = await fetch(`${BASE}/api/profiles`, { headers: H }).then((r) => r.json());
if (!prof.ok || !Array.isArray(prof.profiles) || prof.profiles.length === 0) fail("no profiles");

const models = await fetch(`${BASE}/api/models`, { headers: H }).then((r) => r.json());
if (!models.ok || !Array.isArray(models.models) || models.models.length === 0) fail("model catalog empty");

const usage = await fetch(`${BASE}/api/usage/summary`, { headers: H }).then((r) => r.json());
if (!usage.ok || !Array.isArray(usage.perSession)) fail("usage summary malformed");
if (!["ok", "warn", "over"].includes(usage.limitState)) fail(`unexpected limitState ${usage.limitState}`);

const missions = await fetch(`${BASE}/api/missions`, { headers: H }).then((r) => r.json());
if (!missions.ok || !Array.isArray(missions.missions)) fail("missions list malformed");

console.log(
  JSON.stringify({
    ok: true,
    badTokenRejected: true,
    profiles: prof.profiles.length,
    models: models.models.length,
    usageLimitState: usage.limitState,
    missions: missions.missions.length,
  }, null, 2),
);
