/* Organization Pulse / Brain Graph regression checks.
   Source-level guarantees (matching the style of test-phantomplay.mjs):
   the aggregation layer stays honest, tenant-pinned, additive-only in chat,
   and reachable through the admin static proxy. */
import { readFileSync } from "node:fs";
import assert from "node:assert";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const pulse = read("server/src/phantom-ai/organization-pulse.ts");
const index = read("server/src/index.ts");
const proxy = read("ops/admin-live/admin-static-server.mjs");

// 1. Honesty contract: unavailable sections must carry a reason, never fake data.
assert.match(pulse, /available: false; reason: string/, "Pulse sections must model unavailability with a reason");
assert.match(pulse, /not connected/i, "Disconnected domains must say so instead of pretending");
assert.ok(!/Math\.random\(\)/.test(pulse), "The pulse layer must never invent data");

// 2. The graph exposes real gaps and inspectable sources.
assert.match(pulse, /gaps: Array<\{ nodeId: string; reason: string \}>/, "Graph must report disconnection gaps");
assert.match(pulse, /source: string/, "Every graph node must carry its backing store");
assert.match(pulse, /Never recalled in a conversation/, "Unused memories must surface as real gaps");
assert.match(pulse, /No public signals recorded yet/, "Evidence-less competitors must surface as real gaps");

// 3. Chat injection is additive-only and bounded.
assert.match(index, /workspace_pulse/, "Chat must receive the workspace awareness module");
assert.match(index, /awareness is additive only/, "Pulse failures must never break chat");
assert.match(index, /buildWorkspaceAwarenessText\(pulse\)\.slice\(0, 900\)/, "Awareness block must stay bounded");

// 4. Tenant pinning: non-managing sessions cannot choose an arbitrary tenant.
assert.match(index, /canManage && requested \? requested : own/, "Pulse tenant resolution must pin non-admin sessions");

// 5. Endpoints exist and ride the admin static proxy.
assert.match(index, /app\.get\("\/api\/organization\/pulse"/, "Pulse endpoint must exist");
assert.match(index, /app\.get\("\/api\/organization\/graph"/, "Graph endpoint must exist");
assert.match(proxy, /\/api\/organization/, "Static server must proxy /api/organization to Hermes");

// 6. The pulse layer never mutates stores (read-only imports).
assert.ok(!/createCompetitor|createSignal|saveBusinessProfile|createBrainMemory|ingestAsset/.test(pulse),
  "organization-pulse must stay read-only");

// 7. Defect PF-1 regression: memory reads must not seed bootstrap notes, and
//    seeded platform guidance must never count as organization knowledge.
assert.match(pulse, /readOnly: true/, "Pulse memory reads must be side-effect free");
assert.match(pulse, /phase_iii_bootstrap/, "Bootstrap notes must be excluded from org memory counts");
const spine = read("server/src/phantom-ai/neural-spine.ts");
assert.match(spine, /if \(!options\.readOnly\) await ensureBrainBootstrapMemories/,
  "listBrainMemories must support side-effect-free reads");

// 8. Defect PF-2 regression: agent runs are strictly workspace-scoped — an
//    admin viewing org X must never see other workspaces' runs in X's pulse.
assert.ok(!/run\.workspace === tenantId \|\| access\.canManage/.test(pulse),
  "Run scoping must not widen for admins");
assert.match(pulse, /run\.workspace === tenantId/, "Runs must match the tenant exactly");

console.log("Organization Pulse and Brain Graph safety checks passed.");
