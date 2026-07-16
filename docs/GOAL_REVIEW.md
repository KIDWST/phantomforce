# Goal Document Review

This reviews the original oversized Goal prompt ("Turn PhantomForce from an
AI tool suite into an active operating intelligence") that became
`docs/PHANTOM_VISION.md`, `docs/PRINCIPLES.md`, `docs/ARCHITECTURE.md`,
`docs/CURRENT_MISSION.md`, and `docs/ROADMAP.md`. It explains *why* each
change was made, not just what changed, and separates four different kinds
of statement that the original document ran together: timeless product
truth, current implementation task, design preference, and one-off
example/illustration. Not everything below was rewritten — several items
are flagged as "keep as-is" because the repetition was doing real
rhetorical work.

## Repeated ideas (consolidated, not deleted)

- **"Chat is not the product / not the center of gravity"** appeared at
  least four times (the opening framing, the home-screen section, the
  decision-cards section, and the design-transformation section). This is
  the single most important idea in the document, so repeating it in the
  original wasn't wrong — but scattering it across four sections meant a
  future editor could update one restatement and leave the others stale.
  **Fix:** stated once, precisely, as a Principle (`docs/PRINCIPLES.md`),
  and referenced everywhere else instead of restated.
- **"Operating team / living command center / operating intelligence, not a
  dashboard skin"** — three phrasings of the same claim, spread across the
  vision, the design section, and the closing line. Consolidated into one
  Principle; the vision doc keeps one strong instance for narrative force
  (the "arriving at work" line), not three.
- **Away Mode's boundary list** (allowed-alone vs. requires-approval) was
  effectively restated a second time inside the Decision Cards section's
  football-highlights example (spend on ad creation implicitly requires the
  same approval boundary). Consolidated so Approval boundaries are defined
  once in `docs/ARCHITECTURE.md` and every other section references them.

## Conflicts with what the codebase already established

- **Away Mode vs. Vacation Mode.** The original document invents "Away
  Mode" with a richer spec (owner-defined outcome priorities, contact
  rules, urgency thresholds, briefing cadence) but the shipped feature —
  with its own data model (`VacationModeRun`, `VACATION_POLICY`), roadmap
  (v0.1–v0.7 in `docs/PHANTOMFORCE_AUTONOMOUS_CREATIVE_OS.md`), and public
  tagline ("Go live your life. Phantom keeps the work moving.") — is called
  **Vacation Mode**. Treating these as two different features would build a
  duplicate system. **Resolution:** `docs/ROADMAP.md` Phase 4 explicitly
  names Away Mode as an *extension* of Vacation Mode, not a replacement.
  Product copy should pick one public name going forward — that's a design
  decision for Jordan, not something this review resolves unilaterally.
- **"Your 1,226 mapped workers... should represent depth, not interface
  complexity."** This restates the exact number `docs/WORKFORCE_REALITY_AUDIT.md`
  already investigated and found to be a *topology* count (12 parent
  workers + 12 curated subagents + 108 template subagents + 1,080
  generated neural cells), not 1,226 independent runtime processes. The
  audit's whole point was that presenting that number without the
  topology-vs-independent-runtime distinction is a truthfulness bug.
  Restating it uncritically in vision language would silently re-introduce
  the problem the audit fixed. **Resolution:** `docs/ARCHITECTURE.md` and
  `docs/PRINCIPLES.md` require any workforce-scale claim to carry the
  truthful framing; the raw number is deliberately not repeated as a
  headline figure in the new docs.
- **Departments vs. Spaces are two different taxonomies that the original
  text partially conflates.** "Intelligence" and "Technology" appear both
  as *departments* (a Workforce grouping of agents) and implicitly overlap
  with *Analytics* and *Business* as navigation *spaces*. A reader could
  reasonably assume "Intelligence" the department and the Analytics/Intel
  spaces are the same screen. **Resolution:** `docs/ARCHITECTURE.md` keeps
  them as explicitly separate lists (Departments group Workforce agents;
  Spaces are navigation) so implementation doesn't merge two concepts that
  serve different purposes.

## Ambiguous wording that needed an implementation-level definition

- **"Whether Phantom can handle it"** (a Signal property) was never defined
  operationally. Handled by whom, decided how? `docs/ARCHITECTURE.md`
  ties this to the existing automation/agent-run capability contracts
  rather than leaving it as a vague boolean a UI just displays.
- **"Modify"** on a Decision Card (approve / modify / dismiss) never says
  what modification means — edit the recommendation's parameters? Re-run
  with different evidence? Partially approve one sub-action? This is left
  as an open implementation question in `docs/CURRENT_MISSION.md`'s gap
  list rather than silently assumed, because guessing wrong here shapes the
  whole Decision object's schema.
- **Decision approval vs. execution approval are conflated in the
  football-highlights example.** "Approve plan" in the original example
  covers a plan that includes spending on ad generation — but the
  document's own Away Mode section says spend always requires separate
  approval. `docs/ARCHITECTURE.md` resolves this by defining Decision
  (approve the *recommendation*) and Approval (clear the *risky
  sub-actions* inside it) as two distinct objects in the flow, so
  "approving a plan" doesn't silently bypass the spend gate.
- **Signal/Evidence data sourcing was never stated as a requirement.** The
  original document's illustrative examples ("Phantom found two strong
  unused clips," "12 recent inquiries") read as UI copy, and nothing in the
  text says these must trace to real backing data. Given this codebase's
  established fail-closed/no-fake-activity posture
  (`docs/RELEASE_CANDIDATE_TRUTH_MAP.md`), that omission is dangerous — a
  future implementer could ship synthetic-feeling Signals to "make the demo
  pop." **Fix:** made explicit as a Principle (no fake activity/metrics)
  and called out again in `docs/CURRENT_MISSION.md`.

## Missing architectural definitions the original never specified

- No definition of how Signal **confidence** is computed or displayed
  consistently (Competitor Intelligence already has a pattern for this —
  see `docs/COMPETITOR_INTELLIGENCE.md` — that should generalize rather
  than each department inventing its own).
- No mention of **multi-workspace tenancy** at all, even though the live
  product already enforces workspace isolation (ChicagoShots vs.
  PhantomForce workspaces, per `AGENTS.md`'s "ChicagoShots workspace
  isolation" entry). Every example in the original text is single-business
  framed. `docs/ARCHITECTURE.md`'s safety boundaries section now states
  explicitly that Outcomes/Signals/Decisions/Memory are tenant-scoped.
- No definition of **who can edit or forget a Memory record**, or what
  auditing applies when memory is corrected. Left as an open item pointing
  at the existing gap map (`docs/PHASE_III_BRAIN_GAP_MAP.md`) rather than
  invented fresh.

## Vision language kept as illustration, not literal spec

The home-screen copy ("ChicagoShots has not published in four days..."),
the football-highlights Decision Card, and the Vacation Mode return
briefing are strong, concrete illustrations of the *shape* PhantomForce
should take — they were kept nearly verbatim in `docs/PHANTOM_VISION.md`
because rewriting them into generic language would have thrown away the
clearest part of the original document. They are not, however, literal
copy to ship; an implementer should generate equivalent real copy from
real data, not hardcode these exact sentences.

## What this review deliberately did not do

It did not rewrite the ambition down. Every capability named in the
original — Outcomes, Signals, Decision Cards, institutional Memory, the
department Workforce view, Away Mode, explanatory Analytics, action-
producing Intelligence — survived into the permanent docs. The changes here
are about where an idea lives and how precisely it's stated, not whether it
survives.
