import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

const root = await mkdtemp(join(tmpdir(), "phantomplay-stream-routes-"));
process.env.PHANTOMFORCE_PHANTOMPLAY_PATH = join(root, "phantomplay.json");
process.env.PHANTOMFORCE_CUSTOMIZATION_DIR = join(root, "customization");
process.env.PHANTOMFORCE_SKIP_SERVER_DOTENV = "true";
process.env.NODE_ENV = "development";
process.env.PHANTOMFORCE_SERVER_LOGGER = "false";
process.env.PHANTOMFORCE_AUTH_PROVIDER = "demo";
process.env.PHANTOMFORCE_ENABLE_DEMO_AUTH = "true";
process.env.HOST = "127.0.0.1";
process.env.PORT = "0"; // OS-assigned free port — this test needs a real listening socket for genuine incremental streaming reads, unlike the other tests in this plan which call module functions directly

const { app } = await import("../src/index.js"); // top-level await in index.ts already calls app.listen() on import, gated only by PHANTOMFORCE_SERVER_LISTEN !== "false" (left unset here, so it listens)
const address = app.server.address();
if (typeof address !== "object" || !address) throw new Error("Server did not report a listen address after import.");
const base = `http://127.0.0.1:${address.port}`;

const loginRes = await fetch(`${base}/auth/demo-login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: "admin-jordan" }) });
assert(loginRes.ok, `Demo login should succeed; got ${loginRes.status}.`);
const { token } = (await loginRes.json()) as { token: string };
const authHeaders = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

// PhantomPlay starts disabled on every newly created tenant config (see
// customization-service.ts's defaultModuleEnabled migration-safety rule), so
// a brand-new tenantId like "stream-route-test" must have the module turned
// on before room creation is entitled — mirrors the setup test-phantomplay.ts
// does for its own scratch tenant via the same workspace-modules route.
const enableModuleRes = await fetch(`${base}/phantom-ai/customization/workspace-modules`, {
  method: "PATCH",
  headers: authHeaders,
  body: JSON.stringify({ tenant_id: "stream-route-test", module_id: "phantomplay", enabled: true, accessMode: "entire_organization", allowedMemberIds: [], activityEnabled: true, challengesEnabled: true }),
});
assert(enableModuleRes.ok, `Enabling PhantomPlay for the scratch tenant should succeed; got ${enableModuleRes.status}.`);

const createRes = await fetch(`${base}/api/phantomplay/rooms`, {
  method: "POST",
  headers: authHeaders,
  body: JSON.stringify({ gameId: "phantom-rumble", mode: "friends", maxPlayers: 4, tenantId: "stream-route-test" }),
});
assert(createRes.ok, `Room creation should succeed; got ${createRes.status}.`);
const created = (await createRes.json()) as { room: { code: string } };
const code = created.room.code;

const streamRes = await fetch(`${base}/api/phantomplay/rooms/${code}/stream?tenant_id=stream-route-test`, { headers: authHeaders });
assert(streamRes.ok, `Stream route should respond 200; got ${streamRes.status}.`);
assert(streamRes.body, "Stream response must have a readable body.");
const reader = streamRes.body!.getReader();
const decoder = new TextDecoder();

let buffer = "";
async function nextLine(timeoutMs = 3000): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const newlineIndex = buffer.indexOf("\n");
    if (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      if (line.trim()) return JSON.parse(line);
      continue;
    }
    const { value, done } = await reader.read();
    if (done) throw new Error("Stream closed before a line arrived.");
    buffer += decoder.decode(value, { stream: true });
  }
  throw new Error("Timed out waiting for a stream line.");
}

const first = await nextLine();
assert(first.type === "state", `First stream line should be an initial state snapshot; got ${JSON.stringify(first)}.`);

const patchRes = await fetch(`${base}/api/phantomplay/rooms/${code}/match-state`, {
  method: "PATCH",
  headers: authHeaders,
  body: JSON.stringify({ tenantId: "stream-route-test", matchState: { phase: "active" } }),
});
assert(patchRes.ok, `Match-state PATCH should succeed; got ${patchRes.status}.`);
const afterPatch = await nextLine();
assert(afterPatch.type === "state", "A match-state PATCH should push a second state line to the open stream.");
assert((afterPatch.room as any)?.matchState?.phase === "active", "The pushed state should reflect the new matchState.");

const actionRes = await fetch(`${base}/api/phantomplay/rooms/${code}/actions`, {
  method: "POST",
  headers: authHeaders,
  body: JSON.stringify({ tenantId: "stream-route-test", action: { ping: true } }),
});
assert(actionRes.ok, `Action POST should succeed; got ${actionRes.status}.`);
const actionLine = await nextLine();
assert(actionLine.type === "action" && typeof (actionLine as any).actorId === "string", "An action POST should relay to the open stream as an 'action' line.");

reader.cancel().catch(() => {});
await app.close();
console.log("PASS: stream + actions routes");
