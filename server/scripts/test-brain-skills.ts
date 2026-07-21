/* Skills ("superpowers") lifecycle tests — exercises the Brain's skill layer
   against temp stores so no live tenant data is touched.
   Run: npm run test:brain-skills --workspace @phantomforce/server */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDir = mkdtempSync(join(tmpdir(), "pf-skills-"));
process.env.PHANTOM_BRAIN_SKILLS_PATH = join(tempDir, "brain-skills.jsonl");
process.env.PHANTOM_BRAIN_MEMORY_PATH = join(tempDir, "brain-memory.jsonl");
process.env.PHANTOM_BRAIN_EVENTS_PATH = join(tempDir, "brain-events.jsonl");
process.env.PHANTOM_HERMES_LEDGER_PATH = join(tempDir, "hermes-ledger.jsonl");

const { listBrainSkills, createBrainSkill, updateBrainSkill, deleteBrainSkill, composeBrainContext } = await import(
  "../src/phantom-ai/neural-spine.js"
);

const ownerSession = { id: "owner-1", label: "Owner", role: "admin", canManageAccess: true } as never;
const clientSession = { id: "client-9", label: "Client", role: "client", canManageAccess: false, clientId: "client-b" } as never;

let failures = 0;
function check(name: string, condition: boolean, detail = "") {
  if (condition) console.log(`ok   ${name}`);
  else { failures += 1; console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

// 1. Seeds materialize once, all enabled + editable.
let feed = await listBrainSkills(ownerSession);
check("seeds five starting playbooks", feed.skills.length === 5, `got ${feed.skills.length}`);
check("seeds are enabled, editable, deletable", feed.skills.every((skill) => skill.enabled && skill.editable && skill.deletable));
const before = feed.skills.length;
feed = await listBrainSkills(ownerSession);
check("seeding is idempotent", feed.skills.length === before);

// 2. Create + duplicate-name rejection.
const created = await createBrainSkill(ownerSession, {
  name: "Tournament prep",
  trigger: "Preparing for a sports tournament, filming schedule, shot list for game day.",
  instructions: "1) Confirm the date and venue. 2) Build the shot list from prior tournament footage that performed. 3) Draft the day-of schedule.",
});
check("owner can create a skill", created.id.startsWith("brain-skill-") && created.enabled);
let dupRejected = false;
try { await createBrainSkill(ownerSession, { name: "tournament PREP", trigger: "x y z", instructions: "steps" }); }
catch (error) { dupRejected = (error as Error).message === "skill_name_taken"; }
check("duplicate names are rejected case-insensitively", dupRejected);

// 3. Trigger engagement: a matching request engages the skill in composed context.
const pack = await composeBrainContext(ownerSession, {
  message: "Help me prep the shot list for the tournament this weekend",
  surface: "chat",
  logEvent: false,
});
check("matching request engages the skill", pack.engagedSkills.some((skill) => skill.name === "Tournament prep"));
check("engaged playbook is injected into the micro-prompt", pack.microPrompt.includes("Tournament prep"));
check("engagement is reported in debug ids", pack.debug.injectedSkillIds.length >= 1);

// 4. Non-matching request engages nothing.
const quiet = await composeBrainContext(ownerSession, { message: "hey how are you", surface: "chat", logEvent: false });
check("small talk engages no skills", quiet.engagedSkills.length === 0);

// 5. Disabled skills never engage.
await updateBrainSkill(ownerSession, created.id, { enabled: false });
const paused = await composeBrainContext(ownerSession, {
  message: "Help me prep the shot list for the tournament this weekend",
  surface: "chat",
  logEvent: false,
});
check("paused skill does not engage", !paused.engagedSkills.some((skill) => skill.id === created.id));

// 6. Delete is soft and stops listing.
await updateBrainSkill(ownerSession, created.id, { enabled: true });
await deleteBrainSkill(ownerSession, created.id);
feed = await listBrainSkills(ownerSession);
check("deleted skill leaves the active list", !feed.skills.some((skill) => skill.id === created.id));

// 7. Tenant isolation: a client session neither sees nor edits owner skills.
const clientFeed = await listBrainSkills(clientSession);
check("client tenant gets its own seeds, not owner records", clientFeed.skills.every((skill) => skill.scope.tenantId === "client-b"));
const ownerOnly = await createBrainSkill(ownerSession, {
  name: "Owner-only playbook",
  trigger: "Owner-only cross-tenant isolation test.",
  instructions: "1) This playbook exists only in the owner tenant.",
});
let crossRejected = false;
try { await updateBrainSkill(clientSession, ownerOnly.id, { enabled: false }); }
catch { crossRejected = true; }
check("cross-tenant skill edit is rejected", crossRejected);

// 8. Redaction: secrets pasted into a playbook do not survive.
const risky = await createBrainSkill(ownerSession, {
  name: "Risky paste",
  trigger: "Testing redaction of pasted credentials.",
  instructions: "Use api_key sk-test-123456789012345678901234 when calling the provider.",
});
check("pasted secrets are redacted at rest", !risky.instructions.includes("sk-test-123456789012345678901234"));

rmSync(tempDir, { recursive: true, force: true });
if (failures) { console.error(`\n${failures} skill check(s) failed.`); process.exit(1); }
console.log("\nAll skill checks passed.");
