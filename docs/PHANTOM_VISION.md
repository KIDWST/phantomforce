# PhantomForce — Product Vision

This is the permanent product specification. It describes what PhantomForce
is *for* and what it must feel like to use. Timeless philosophy lives in
`docs/PRINCIPLES.md`; how the system is actually built lives in
`docs/ARCHITECTURE.md`; what to build *right now* lives in
`docs/CURRENT_MISSION.md`. This document does not change every sprint — it
changes when the product's understanding of itself changes.

## Vision

PhantomForce is a private, adaptive business operator — not a chat wrapper,
not a dashboard, not a tool suite bolted together under one login.

Today, even with real capability underneath, the core experience still says
*"ask me something."* That's ChatGPT logic. The actual vision is:

> PhantomForce already knows what matters, shows you what changed, proposes
> the next moves, and coordinates the work. The owner should not enter a
> blank chat box and invent the workflow every time.

Chat remains available — it's useful for exploration — but it is no longer
the product's center of gravity. The center of gravity is a system that turns
**signals into decisions, decisions into approval-safe execution, execution
into evidence, and evidence into memory.**

## Product Transformation

The transformation is architectural, not cosmetic:

- Stop revolving the product around chats, pages, and disconnected tasks.
  Revolve it around **Outcomes** — what the business is actually trying to
  accomplish.
- Stop leading with a wall of feature tabs. Lead with a small, comprehensible
  **Workforce** of departments; let the deep agent/automation topology exist
  underneath as depth, not as interface complexity.
- Stop waiting for the owner to ask. Make Phantom continuously generate
  **Signals** — meaningful changes that may require a decision.
- Replace open-ended chat requests, where possible, with **Decision Cards** —
  structured, evidence-backed recommendations the owner approves, modifies,
  or dismisses in one motion.
- Give the system **Institutional Memory** — not chat history, but durable
  knowledge of the business — and make it visibly use that memory.

Re-architecting around Command, Outcomes, Signals, Decisions, Workforce, and
Memory is the mission. "Make chat smarter," "connect all the pages," and
"redesign the dashboard" are explicitly *not* the mission — they're symptoms
of the old model.

## Core User Experience

The home screen must answer, without the owner typing anything: what
requires attention, what Phantom already handled, what is blocked, what
opportunities were detected, what the business is trying to achieve, and
what the next recommended decision is.

Instead of *"Good afternoon, Jordan. What do you want handled first?"*, the
system should read like this:

> **Good afternoon, Jordan**
>
> Your business is stable. Three things need attention.
>
> **1. ChicagoShots has not published in four days.** Phantom found two
> strong unused clips and prepared six platform-specific posts.
> *Review campaign · Approve publishing*
>
> **2. Three client follow-ups are overdue.** Drafts are ready using each
> client's history and prior conversations. *Review messages*
>
> **3. Your sports-video landing page is underperforming.** Phantom
> identified a weak call to action and created a private improved version.
> *Compare versions*
>
> **Handled while you were away:** organized 14 new media assets · generated
> today's operating brief · checked five active automations · refreshed
> competitor evidence · prepared this week's content plan.

That is not chatbot software. That is arriving at work and meeting an
operating team.

## Command Center

Command is the living business briefing — the first space the owner lands
in. It shows: current health, urgent decisions, active outcomes,
opportunities, completed work, blocked actions, and the recommended next
move. It is the surface where Signals surface as Decision Cards and where
"handled while you were away" gets reported honestly.

## Outcomes

The core object of the product is the **Outcome** — a real business goal,
not a task list. Examples: book three new sports clients, launch a clothing
brand, publish consistently for 30 days, build a website and intake funnel,
recover inactive customers, prepare for a tournament, reduce overdue
invoices, launch a game through PhantomPlay.

An Outcome contains: target result, deadline, success metric, strategy,
active workstreams, assigned Phantom departments, approvals, evidence,
risks, costs, and final results. The owner should never have to think about
which tab to visit — opening the outcome shows the whole operation.

## Workforce

Do not lead with seventeen tabs. Lead with a small, human-readable Phantom
workforce organized as departments the owner instantly understands:

- **Growth** — opportunities, campaigns, leads, competitive gaps, revenue
  angles.
- **Creative** — media, branding, copy, websites, posts, campaign assets.
- **Operations** — automations, scheduling, deadlines, execution
  coordination.
- **Client Care** — leads, customers, follow-ups, proposals, delivery.
- **Finance** — invoices, expenses, cash flow, business health.
- **Intelligence** — performance, competitors, trends, risks, strategic
  opportunities.
- **Technology** — sites, integrations, apps, diagnostics, developer work.

The deep mapped agent/worker topology exists beneath these departments and
should represent *depth*, not interface complexity — the owner interacts
with a comprehensible company, not an org chart of a thousand nodes.

## Signals

Phantom must continuously generate Signals: meaningful changes that may
require action. Examples — content performance dropped, a client has gone
quiet, an invoice became overdue, a competitor changed pricing, a campaign is
outperforming expectations, a website form stopped converting, a useful
asset has not been reused, an automation failed, a lead is likely to close,
there is an empty content day tomorrow.

Each Signal carries: what happened, why it matters, evidence, confidence, a
recommended action, whether Phantom can handle it, and whether approval is
required. Signals are what make the system feel alive instead of dormant
between owner requests.

## Decision Cards

Chat is useful for exploration. Operations need structured decisions.
Wherever possible, the primary interaction should be a Decision Card, not an
open-ended prompt:

> **Opportunity detected.** Your football highlight package is generating
> more inquiries than your recruitment package. Phantom recommends: make
> highlights the primary offer, reposition recruitment as an upgrade, update
> the landing page, create three new ads from existing footage.
> **Expected effect:** higher inquiry-to-booking conversion. **Confidence:**
> medium. **Evidence:** 12 recent inquiries, page activity, prior customer
> behavior.
> *Approve plan · Modify · Dismiss*

One decision from the owner; Phantom handles the downstream work. That is
categorically stronger than asking the owner to type six separate prompts.

## Institutional Memory

The system must learn and retain what makes this business this business:
what it sells, which customers are valuable, preferred communication style,
what the owner normally approves, what has failed before, which assets
perform best, what the brand should never say, typical pricing exceptions,
seasonal patterns, recurring bottlenecks, trusted recipients, risk
tolerance.

Phantom must then use that memory *visibly*:

> "I used your usual direct sports-client tone, avoided discount language
> because you rejected that approach twice, and selected footage from the
> DeSoto campaign because similar clips performed best."

That is what makes the product feel like a workforce that knows the
company, not a model that forgot the last conversation.

## Planner

The Planner is an execution timeline, not a mostly-empty weekly board. Three
lanes:

- **You** — meetings, approvals, calls, filming, personal responsibilities.
- **Phantom** — research, generation, follow-up preparation, publishing,
  monitoring, maintenance.
- **Results** — posts going live, deadlines, campaign checkpoints, payment
  dates, expected outcomes.

When the owner moves a deadline, Phantom automatically recalculates
dependent work.

## Analytics

Analytics must explain, not merely display. Not *"engagement down 12%."*
Instead: *"Engagement fell 12% because posting frequency dropped and your
last three uploads reused the same opening style. Short clips featuring
immediate action still outperform talking introductions by 31%. Phantom
prepared two replacement concepts using unused footage."* Followed by:
*Review concepts.* That is operating intelligence, not a chart.

## Intelligence

Competitor and market intelligence must not end with a radar screen. Every
evidence-backed finding should offer a next move: exploit this opening,
create a differentiated offer, prepare a response campaign, track this
change, update positioning, or ignore as irrelevant. Intelligence is the eyes
of the operating system — it exists to produce action, not just awareness.

## Away Mode

Away Mode is not a toggle that flips automations on. The owner defines: what
outcomes matter while away, what Phantom may decide alone, spending and
communication boundaries, who can be contacted, what must wait, what
qualifies as urgent, and how often the owner receives a briefing. The system
then continues operating strictly within those limits. On return:

> "While you were away, Phantom completed 18 actions, requested two
> approvals, prevented one duplicated campaign, and identified a missed $400
> client opportunity."

## Design Direction

The dark-emerald / terminal identity is strong — keep it. Reduce the feeling
of: admin dashboard, feature inventory, chatbot wrapper, raw system metrics.
Increase the feeling of: a living command center, an active organization,
decisions arriving at the right time, work visibly progressing, intelligence
backed by evidence.

Animation should reinforce operations, not decorate them: outcomes
advancing, departments activating, evidence flowing into decisions,
approvals unblocking work, results feeding memory. Not "AI thinking" filler.

## Definition of Victory

When the owner opens PhantomForce, he should understand the state of his
business in under ten seconds without typing anything. Within thirty
seconds, he should be able to approve the most valuable next move. After
approval, Phantom should coordinate the required work across existing
systems without making him manually visit every tool. At any point, he
should be able to see: what Phantom is doing, why it is doing it, what it
used, what it needs, what it completed, and what result it produced.
