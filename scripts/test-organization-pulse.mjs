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
const orgGraph = read("app/js/orggraph.js");
const orgPulseClient = read("app/js/organizationpulse.js");
const serverRecords = read("app/js/serverrecords.js");
const clientSetup = read("app/js/clientsetup.js");
const main = read("app/js/main.js");
const flowMap = read("app/js/flowmap.js");

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
assert.match(index, /app\.get\("\/api\/brain\/contract"/, "Brain Signal contract endpoint must exist");
assert.match(proxy, /\/api\/brain/, "Static server must proxy /api/brain to Hermes");

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

// 9. Opportunity engine: every opportunity carries provenance and a real
//    action route; nothing fires without a matching record; platform jobs
//    are labeled as platform-level so workspaces don't mistake them.
assert.match(pulse, /provenance: \{ source: string; nodeId\?: string \}/, "Opportunities must carry provenance");
assert.match(pulse, /Platform automation failing/, "Platform jobs must be labeled platform-level");
assert.ok(!/Math\.random\(\)|fakeOpportunit|sampleOpportunit/i.test(pulse), "No fabricated opportunities");
assert.match(index, /app\.get\("\/api\/organization\/opportunities"/, "Opportunities endpoint must exist");
assert.match(index, /getOrganizationOpportunities\(session, \{/, "Chat must receive graph-derived opportunities");
assert.match(index, /\}, pulse\)/, "Chat must reuse the computed pulse (no double reads)");

// 10. Managed Growth Ops: the organization pulse must include the real
//     business operating spine, not just memory, competitors, or local UI
//     fallbacks.
assert.match(pulse, /getClientSetupDocument/u, "Pulse must read Client Setup documents.");
assert.match(pulse, /getCrmPipelineDocument/u, "Pulse must read CRM pipeline documents.");
assert.match(pulse, /getProposalDocument/u, "Pulse must read proposal documents.");
assert.match(pulse, /getWorkspaceApprovalDocument/u, "Pulse must read workspace approval documents.");
assert.match(pulse, /buildManagedGrowthReport/u, "Pulse must derive Managed Growth Ops from the shared report builder.");
assert.match(pulse, /managedGrowth: Section/u, "Pulse contract must expose Managed Growth Ops.");
assert.match(pulse, /Managed Growth Ops:/u, "Chat awareness must include Managed Growth Ops counts.");
assert.match(pulse, /socialAnalyticsStatus/u, "Managed Growth Ops awareness must preserve social analytics honesty.");
assert.match(pulse, /type: "managed-growth"/u, "Graph must expose a Managed Growth Ops node.");
assert.match(pulse, /type: "client-setup"/u, "Graph must expose client setup nodes.");
assert.match(pulse, /type: "crm-lead"/u, "Graph must expose CRM lead nodes.");
assert.match(pulse, /type: "proposal"/u, "Graph must expose proposal nodes.");
assert.match(pulse, /source: "managed-growth-report"/u, "Managed Growth opportunities must carry report provenance.");
assert.match(orgGraph, /"managed-growth"/u, "Client graph must style Managed Growth nodes explicitly.");
assert.match(orgGraph, /"client-setup"/u, "Client graph must style client setup nodes explicitly.");
assert.match(orgGraph, /"crm-lead"/u, "Client graph must style CRM lead nodes explicitly.");
assert.match(orgGraph, /proposal/u, "Client graph must style proposal nodes explicitly.");

// 11. Browser shell: signed-in dashboard attention must prefer the server
//     pulse over local fallback arrays, so badges/notifications do not drift
//     from the real CRM/proposal/approval stores.
assert.match(orgPulseClient, /\/api\/organization\/pulse/u, "Browser pulse client must fetch the Organization Pulse endpoint.");
assert.match(orgPulseClient, /\/api\/brain\/contract/u, "Browser pulse client must fetch the Brain Signal contract endpoint.");
assert.match(orgPulseClient, /managedGrowth/u, "Browser pulse client must read Managed Growth Ops.");
assert.match(orgPulseClient, /friendlyBackendError[\s\S]*Sign in to load Organization Pulse/u, "Organization Pulse client must hide raw auth transport errors behind a clean sign-in message.");
assert.match(orgPulseClient, /friendlyBackendError[\s\S]*Sign in to load Brain Signals/u, "Brain Signal client must hide raw auth transport errors behind a clean sign-in message.");
assert.match(orgPulseClient, /pulsePendingApprovalCount/u, "Browser pulse client must expose server-backed approval counts.");
assert.match(orgPulseClient, /pulseAttentionItems/u, "Browser pulse client must expose server-backed attention items.");
assert.match(orgPulseClient, /brainContractAttentionItems/u, "Browser pulse client must expose Brain Signal attention items.");
assert.match(orgPulseClient, /Array\.isArray\(payload\.whatChanged\)/u, "Brain Signal client must normalize missing whatChanged arrays.");
assert.match(orgPulseClient, /Array\.isArray\(payload\.whatMatters\)/u, "Brain Signal client must normalize missing whatMatters arrays.");
assert.match(orgPulseClient, /Array\.isArray\(payload\.recommendedActions\)/u, "Brain Signal client must normalize missing recommendedActions arrays.");
assert.match(main, /organizationpulse\.js/u, "Dashboard shell must import the Organization Pulse client.");
assert.match(main, /brainContractAttentionItems/u, "Dashboard shell must import Brain Signal attention items.");
assert.match(main, /function approvalBadgeCount\(\)/u, "Dashboard shell must centralize approval badge counts.");
assert.match(main, /organizationPulseAvailable\(\)\) return pulse \? pulsePendingApprovalCount/u, "Approval badge count must prefer cached server pulse when signed in and never fall back to local counts while loading.");
assert.match(main, /const brainItems = brainContractAvailable\(\) \? brainContractAttentionItems\(cachedBrainContract\(\)\) : \[\]/u, "Attention items must read Brain Signal contract first.");
assert.match(main, /const items = brainItems\.length[\s\S]*\? brainItems[\s\S]*: organizationPulseAvailable\(\)[\s\S]*\? pulseAttentionItems\(cachedOrganizationPulse\(\)\)/u, "Attention items must prefer Brain Signals, then server pulse.");
assert.match(main, /!items\.length && !organizationPulseAvailable\(\) && !brainContractAvailable\(\)/u, "Local fallback attention must only run when signed out.");
assert.match(main, /data-open-ws="\$\{esc\(target\)\}"/u, "Brain-derived plan routes must be escaped before entering data-open-ws attributes.");
assert.match(main, /data-open-ws="\$\{esc\(it\.open\)\}"/u, "Brain-derived notification routes must be escaped before entering data-open-ws attributes.");
assert.match(main, /ensureOrganizationPulseFresh\(\);/u, "Dashboard shell must refresh Organization Pulse in the background.");
assert.match(main, /ensureBrainContractFresh\(\);/u, "Dashboard shell must refresh Brain Signal contract in the background.");
assert.match(main, /crm: "leads"/u, "CRM surface actions must route to the real Clients workspace.");
assert.match(main, /"competitor-intelligence": "intelligence"/u, "Competitor Intelligence actions must route to the real Intelligence workspace.");
assert.match(main, /managedgrowth: "analytics"/u, "Managed Growth actions must route to the real analytics workspace.");
assert.match(flowMap, /organizationpulse\.js/u, "Operations map must share the Organization Pulse client.");
assert.match(flowMap, /data-open-ws="\$\{esc\(n\.ws\)\}"/u, "Operations map workspace routes must escape data-open-ws attributes.");
assert.match(flowMap, /cachedOrganizationPulse\(\)\?\.managedGrowth/u, "Operations map summary must read Managed Growth Ops from the cached server pulse.");
assert.match(flowMap, /openLeadCount: serverGrowth \? Number\(serverGrowth\.openLeads/u, "Operations map lead counts must prefer server-backed CRM counts.");
assert.match(flowMap, /stat: serverGrowth \? fmtMoney\(proposalPipeline\)/u, "Operations map proposal stat must prefer server-backed proposal pipeline value.");

// 12. Command palette records: signed-in lookup must read server CRM and
//     proposal documents instead of drifting against local fallback arrays.
assert.match(serverRecords, /loadCrmLeads/u, "Server record cache must read CRM leads.");
assert.match(serverRecords, /loadProposals/u, "Server record cache must read proposals.");
assert.match(serverRecords, /loadWorkspaceApprovals/u, "Server record cache must read workspace approvals.");
assert.match(serverRecords, /loadClientSetupDocument/u, "Server record cache must read client setup slots.");
assert.match(clientSetup, /export async function loadClientSetupDocument/u, "Client Setup must expose a read-only server document loader.");
assert.match(serverRecords, /Promise\.allSettled/u, "Server record cache must tolerate one record source being unavailable.");
assert.match(serverRecords, /serverRecordsAvailable/u, "Server record cache must be gated by an authenticated session.");
assert.match(serverRecords, /setupSlots/u, "Server record cache must retain setup slots.");
assert.match(serverRecords, /approvals/u, "Server record cache must retain approvals.");
assert.match(main, /serverrecords\.js/u, "Command palette must import server record cache.");
assert.match(main, /ensureServerRecordsFresh\(\)/u, "Command palette must refresh server records in the background.");
assert.match(main, /serverRecordsAvailable\(\) \? \(serverRecords\?\.leads \|\| \[\]\) : visible\(store\.state\.leads\)/u, "Signed-in lead search must prefer server records.");
assert.match(main, /serverRecordsAvailable\(\) \? \(serverRecords\?\.proposals \|\| \[\]\) : visible\(store\.state\.proposals\)/u, "Signed-in proposal search must prefer server records.");
assert.match(main, /serverRecordsAvailable\(\) \? \(serverRecords\?\.approvals \|\| \[\]\) : visible\(store\.state\.approvals\)/u, "Signed-in approval search must prefer server records.");
assert.match(main, /serverRecordsAvailable\(\) \? \(serverRecords\?\.setupSlots \|\| \[\]\) : \[\]/u, "Signed-in setup search must prefer server records.");
assert.match(main, /Client setup ·/u, "Command palette must label setup slot records clearly.");

console.log("Organization Pulse and Brain Graph safety checks passed.");
