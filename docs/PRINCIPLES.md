# PhantomForce — Principles

These are the timeless rules. They don't change with the sprint or the
phase — `docs/CURRENT_MISSION.md` and `docs/ROADMAP.md` do. Every feature
decision should be checkable against this list. If a proposed feature
violates one of these without a documented reason, it's the feature that's
wrong, not the principle.

**Chat is not the product.** Chat is one interaction surface among several,
useful for exploration. The product is the system that knows what matters
before being asked. See `docs/PHANTOM_AI_BEHAVIOR_RULES.md` for the enforced
version of this: casual conversation never creates tasks or triggers work.

**Outcomes over conversations.** The unit of value is a business result the
owner is trying to reach, not a thread of messages. Everything should be
traceable to an Outcome.

**Signals create decisions.** The system doesn't wait to be asked — it
notices meaningful change and turns it into something the owner can act on.
A Signal with no path to a decision is just noise.

**Evidence before opinion.** Every recommendation carries what it's based
on: the data, the confidence, the alternative explanations. "Trust me" is
not a valid system output — this is already the enforced posture in
Competitor Intelligence (`docs/COMPETITOR_INTELLIGENCE.md`) and should hold
everywhere else Phantom recommends anything.

**Execution before generation.** Producing an asset, a draft, or a render is
not the finish line. The finish line is the asset landing in a workflow —
a campaign, a client record, a published page — where it does something.
Creation that ends in a downloads folder is a wasted step.

**Departments over disconnected features.** The owner should be able to
reason about the system as a small, comprehensible workforce (Growth,
Creative, Operations, Client Care, Finance, Intelligence, Technology), not a
flat list of seventeen unrelated tabs. Deep topology lives underneath as
capacity, not as something the owner has to parse.

**Institutional memory over chat history.** What the system remembers is
durable business knowledge — client preferences, what's been tried, what
was rejected and why, what performs — not a transcript. Memory must be used
*visibly*, not just stored.

**Automation should reduce friction, not hide risk.** An automation that
saves a click but obscures what it actually did is a regression, not a
feature.

**Approval preserves control.** Autonomy is only valuable if it's safe
enough to actually turn on. Publish, send, spend, deploy, delete, and any
external/production action wait for a human yes — always, no exceptions
carved out for convenience. This is already enforced product-wide (see
`docs/RELEASE_CANDIDATE_TRUTH_MAP.md`'s fail-closed posture) and must stay
enforced as new capability is added.

**The owner should not need to search for work. Work should arrive.** If
using PhantomForce well requires the owner to remember to check five
different tabs, the architecture has failed regardless of how capable any
individual tab is.

**No fake activity, no fake metrics, no fake completion.** If a capability
is gated, absent, or manual, say so plainly. A confident lie about system
state is worse than an honest "not yet." This is the load-bearing lesson of
`docs/WORKFORCE_REALITY_AUDIT.md` — the 1,226-node number was topology, and
the fix was truthful labeling, not deletion.

**"Neural" means application-layer intelligence, not model internals.**
Memory, context composition, routing, feedback, tool orchestration, proof
logging, and adaptive behavior — that is what PhantomForce's "brain" is
built from. Nothing in this product claims to alter model weights or read
hidden neural layers of an underlying LLM. Keep the metaphor and drop the
false claim.

**PhantomForce is an operating intelligence, not a dashboard skin.** The
measure of a new feature isn't "does it look impressive" — it's "does it
change what the owner has to think about." A feature that adds a screen
without reducing the owner's cognitive load is decoration.
