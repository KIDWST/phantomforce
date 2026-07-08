# PhantomForce — Autonomous Creative OS

> **PhantomForce turns powerful AI creation engines into autonomous business
> workflows — with the owner still in control.**
>
> **Higgsfield creates. PhantomForce operates.**
>
> **Go live your life. Phantom keeps the work moving.**

## The thesis

Creation engines like Higgsfield Supercomputer are becoming astonishing: media,
designs, sites, games, apps, marketing assets, whole creative workflows from a
prompt. That power is real — and PhantomForce embraces it as an engine.

But an engine is not an operation. A solo creator or small business doesn't
just need *another render*. They need to decide what to make, assign it, track
it, review it, connect it to campaigns and clients and follow-ups, keep it
private, and keep it moving while they sleep — without anything publishing,
sending, or spending behind their back.

That layer is PhantomForce:

| | Higgsfield / Supercomputer | PhantomForce |
| --- | --- | --- |
| Role | **Creation supercomputer** | **Autonomous operating layer around creation** |
| Answers | "Make this." | "What should we make, who's making it, what happened, what needs my approval?" |
| Memory | Prompt-deep | Business-deep: clients, offers, pipeline, brand, preferences (Hermes) |
| Agents | One creation surface | Planner · Builder · Creative · Website · Ops · Reviewer · Approval |
| Away-time | Nothing happens | **Vacation Mode**: bounded autonomous runs with reports |
| Risk | User-managed | **Approval Queue**: publish/send/spend/deploy/delete always wait |

**Category:** Autonomous Creative Operations · Creative Operations OS ·
AI Command Center for Creators · AI Workflow Autopilot for Creators and
Small Businesses.

## Why PhantomForce is not a Higgsfield clone

PhantomForce does not compete on generation quality — it *routes to* engines
like Higgsfield (through Hermes and the Creative Engine transport) and wraps
them in what an engine alone can't provide:

- **Business memory** — Hermes carries workspace context, client data,
  offers, preferences, and a run ledger. Prompts leave with context; results
  return into workflows, not into a downloads folder.
- **Multi-agent work tracking** — Tasks/Ops and Termina show who/what is
  working, on what, and how far along.
- **Approval-first autonomy** — Vacation Mode and the Approval Queue make
  autonomy safe enough to actually use.
- **Workflow endpoints** — Site Studio, Looper, campaigns, proposals,
  follow-ups: creation lands somewhere that makes money.
- **Proof-based reporting** — every serious run reports what was requested,
  what ran, what changed, what's blocked, and what needs approval.

We take inspiration from great creation UX (a big command box, smart chips,
review-before-final-render, credit approval before generation) — but the
identity is PhantomForce's own: the dark-emerald command center, business-aware
workflows, Vacation Mode, Termina, and the Approval Queue.

## Scenario: the solo game developer

A solo game dev connects Higgsfield and PhantomForce, then says:

> "I'm going offline for 6 hours. Continue building the game trailer, create
> the landing page draft, organize the task list, generate three logo
> directions, write a launch email, and give me a report before anything
> publishes."

PhantomForce coordinates Planner, Builder, Creative (Higgsfield briefs),
Website, Ops, Reviewer, and Approval agents. Six hours later:

```
VACATION MODE REPORT — 6h window, ended 9:42 PM

Completed
- 3 trailer concepts (briefs + preview boards)
- 1 landing page draft in Site Studio
- 12 tasks organized into launch lanes
- 4 social post drafts
- 1 launch email sequence (3 emails, drafts)

Needs your approval
- Spend Higgsfield credits on the final trailer render
- Publish the landing page
- Send the launch email

Blocked
- Store copy waiting on the final game title

Next recommended action: approve the trailer render, then review the page.
```

Nothing published. Nothing sent. No credits spent. The work moved anyway.

The same shape serves an agency (client campaigns + follow-ups), a coach
(content + booking funnels), or a small business (leads, proposals, reviews).

## Module map

1. **Phantom AI** — the command box. Friendly, normal chat by default;
   serious operator only when explicitly asked. (See
   `docs/PHANTOM_AI_BEHAVIOR_RULES.md` — the "hello is not a task" contract.)
2. **Termina** — power mode: the multi-agent command wall. Spin up Planner,
   Builder, Reviewer, Media, Website, Ops, and Approval workers; compare
   output, merge results, send work to Looper or Vacation Mode.
   **User-triggered only.**
3. **Vacation Mode** — bounded autonomous runs: goal, time window, allowed
   actions, blocked actions, assigned agents, report cadence, approvals.
   **Opt-in, confirmed, visible, report-based.**
4. **Creative Engine** — the Higgsfield/Hermes-powered creation layer
   (see `docs/HERMES_HIGGSFIELD_CREATIVE_ENGINE.md`). Creates media, assets,
   and site/game creative — wrapped in briefs, review, approval, and routing
   into campaigns/sites/tasks.
5. **Site Studio** — websites and landing pages driven by Phantom workflows.
6. **Looper** — plan → build → review → approval build packets.
7. **Tasks/Ops** — who/what is working, tracked.
8. **Approval Queue** — nothing risky goes live without a human yes.
9. **Reports** — what happened while you were away, in proof format.
10. **Hermes** — memory, business context, preferences, tool orchestration,
    run ledger.
11. **Worker layer** (n8n/Ruflo-style, as present) — automation execution
    under the same approval rules.

## Vacation Mode — definition and boundaries

*"Vacation Mode: leave the work running without losing control."*

**Data model** (`store.state.vacationRuns`, policy in `VACATION_POLICY`):
`VacationModeRun { id, ws, title, goal, status: draft|awaiting_approval|
running|paused|complete|blocked|failed, timeWindowMinutes, reportCadence,
allowedActions, blockedActions, assignedAgents, approvalRequired, startedAt,
completedAt, report, createdAt, updatedAt }` — with
`VacationModeReport { completed, inProgress, blocked, needsApproval,
artifacts, nextActions }` to follow in v0.4.

**Allowed while away:** draft · plan · summarize · organize · create tasks ·
create briefs · prepare assets · write copy · review output · prepare
approval items · report.

**Requires approval, always:** spend credits · final renders · publish ·
deploy · send email · post social · charge money · delete files · change
client data · share files · connect accounts · public links · production
changes.

**Never starts from:** "this would be cool", "what if…", brainstorming, or
any non-explicit phrasing. The chat lane demands the literal
`confirm vacation mode` handshake, and the Automation-workspace scaffold
queues runs into the Approval Queue. In the current build the scaffold is
**planning only** — it is labeled as such in the UI, and approving a run
records your go-ahead for when execution ships (v0.3+).

## Proof-based reporting

Every serious workflow produces a compact report: **what was requested ·
what ran · which agent worked · what changed · what artifacts were created ·
what is blocked · what needs approval · next recommended action.**
Templates live in `docs/autonomous-creative-os/prompts/`.

## Safety boundaries (enforced today)

- Normal chat never creates tasks/workflows (`app/js/intent-router.js`,
  tested by `scripts/test-phantom-intent-router.mjs`).
- Publish/send/deploy/spend/delete route to the Approval Queue from chat —
  "nothing has been executed."
- Creative Engine renders that spend credits require explicit approval
  (UI confirm + backend `approved:true`); Hermes drafts spend nothing.
- Vacation Mode: explicit trigger + confirmation + approval-gated run record;
  no autonomous execution exists yet, and the UI says so.
- No fake generation, no fake completion, no hidden credit spend.

## Roadmap

- **v0.1 — Product alignment** *(this pass)*: docs, chat behavior rules,
  Creative Engine positioning, Vacation Mode scaffold (planning only),
  honest labels, no fake execution.
- **v0.2 — Intent routing cleanup** *(shipped alongside)*: normal chat stays
  normal; tasks/Looper/Termina/Vacation trigger only on explicit ask.
- **v0.3 — Vacation Mode planning runs**: goal/time/allowed/blocked produce a
  full run plan with per-step approval boundaries; safe steps (drafting,
  organizing) can execute under the policy.
- **v0.4 — Vacation Mode reports**: report format, completed/blocked/needs-
  approval sections, run ledger in Hermes.
- **v0.5 — Creative Engine handoff**: Hermes/Higgsfield briefs end-to-end;
  approval before credit spend; results feed campaigns/sites/tasks.
- **v0.6 — Multi-agent execution**: Termina workers with roles
  (Planner/Builder/Reviewer/Creative/Ops/Approval) and merged reports.
- **v0.7 — Business workflow automation**: n8n/Ruflo/worker integrations —
  lead follow-up, campaigns, websites, reports.

## Public positioning lines

- "PhantomForce turns powerful AI tools into autonomous business workflows —
  with the owner still in control."
- "Go live your life. Phantom keeps the work moving."
- "Higgsfield creates. PhantomForce operates."
- "Connect your creative engine. Let Phantom plan, create, review, organize,
  and report."
- "Get your life back with PhantomForce."
