# Phantom Skills ("Superpowers")

Owner-editable playbooks the Phantom AI brain follows when a request matches —
PhantomForce's own version of the skill-library pattern (inspired by
obra/superpowers, rebuilt as a product feature instead of a dev-tool
convention).

## What a Skill is

A Skill is a **procedure, not a fact**. Facts live in the Memory Vault
(`neural-spine.ts` memories). A Skill has:

- **name** — e.g. "Client follow-up".
- **trigger** — plain language describing WHEN it applies; matched lexically
  against the user's request at context-compose time.
- **instructions** — the playbook injected into the model micro-prompt when
  the skill engages (max 2000 chars, redacted at rest like every Brain store).
- **enabled** — owner toggle; paused skills never engage.

## Where it lives

- Store: `.phantom/brain-skills.jsonl` (`PHANTOM_BRAIN_SKILLS_PATH`
  override) — same append/latest-version-fold mechanics and tenant scoping as
  the Memory Vault. Seed ids are tenant-qualified.
- Server: `listBrainSkills` / `createBrainSkill` / `updateBrainSkill` /
  `deleteBrainSkill` + engagement inside `composeBrainContext`
  (`server/src/phantom-ai/neural-spine.ts`).
- Routes: `GET/POST /phantom-ai/brain/skills`,
  `PATCH/DELETE /phantom-ai/brain/skills/:id` — same auth + tenant rules as
  the Memory Vault routes.
- UI: Memory page → "Skills — Phantom's superpowers" card (`app/js/brain.js`):
  create, edit, pause/enable, delete. The Context Preview panel shows which
  skills a message would engage before any model call.
- Chat: every brain block in `/phantom-ai/chat` responses carries
  `engaged_skills`; the dashboard chat renders "‹name› skill engaged" chips
  under the reply (`chatAttachSkillChips` in `app/js/main.js`) — memory used
  *visibly*, per `docs/PRINCIPLES.md`.

## Engagement rules (deliberately conservative)

- Lexical token overlap between the request and the skill's name + trigger;
  threshold 3.2, at most **2** skills engage, and only the top match's full
  playbook is injected (the second is name-only).
- The casual/instant chat lane skips brain context by design, so skills only
  engage on business-lane requests.
- Skills carry **no execution authority**: approval gates, tool rules, and
  tenant boundaries apply unchanged to whatever the model does with the
  playbook.

## Seeds

Five editable, deletable starter playbooks (source `superpowers_seed`):
Client follow-up, Content campaign, Proposal draft, Weekly business review,
Debug my setup. All are honest process guidance — no invented facts, no fake
capability claims.

## Tests

`npm run test:brain-skills --workspace @phantomforce/server` — 14 checks:
seeding/idempotency, CRUD, duplicate-name rejection, trigger engagement,
micro-prompt injection, pause behavior, soft delete, tenant isolation,
cross-tenant rejection, secret redaction.
