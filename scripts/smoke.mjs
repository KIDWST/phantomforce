// Standalone Termina smoke test: REST + live PTY over WebSocket.
// Node 20+ (global fetch + WebSocket). No dependencies.
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
const kali = prof.profiles.find((p) => p.id === "kali-lab");
if (!kali || kali.status !== "blocked") fail("kali-lab should be blocked");

// Blocked profile refuses to start.
const blocked = await fetch(`${BASE}/api/sessions/kali-lab/start`, { method: "POST", headers: H });
if (blocked.status !== 409) fail(`blocked start should be 409, got ${blocked.status}`);

// Start a real shell session.
const start = await fetch(`${BASE}/api/sessions/control/start`, { method: "POST", headers: H }).then((r) => r.json());
if (!start.ok) fail("control session did not start");

const marker = "TERMINA_STANDALONE_OK_42";
let out = "";
const echoed = await new Promise((resolve) => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/pty?session=control&token=${TOKEN}`);
  let sent = false;
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === "output") {
        out += msg.data;
        if (!sent) {
          sent = true;
          setTimeout(() => ws.send(JSON.stringify({ type: "input", data: `echo ${marker}\r` })), 500);
        }
        if (out.split(marker).length > 2) {
          resolve(true);
          ws.close();
        }
      }
    } catch {
      /* ignore */
    }
  };
  ws.onerror = () => resolve(false);
  setTimeout(() => resolve(out.includes(marker)), 8000);
});

// Bad-token socket must be refused.
const badWs = await new Promise((resolve) => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/pty?session=control&token=wrong`);
  ws.onclose = () => resolve("closed");
  ws.onerror = () => resolve("closed");
  ws.onopen = () => resolve("opened");
  setTimeout(() => resolve("timeout"), 3000);
});

const stop = await fetch(`${BASE}/api/sessions/control/stop`, { method: "POST", headers: H }).then((r) => r.json());

console.log(
  JSON.stringify({
    ok: echoed && stop.ok && badWs !== "opened",
    badTokenRejected: true,
    profiles: prof.profiles.length,
    kaliBlocked: true,
    blockedStartRefused: true,
    interactiveEcho: echoed,
    badSocketRefused: badWs !== "opened",
    stopped: stop.ok === true,
    outputBytes: out.length,
  }),
);
process.exit(echoed && stop.ok && badWs !== "opened" ? 0 : 1);
