# PhantomForce Product Constitution

## North Star

PhantomForce is one premium foreground client product. It is not a bundle of scattered tools, agent experiments, provider names, or operator scripts.

The client-facing promise is a clean app that helps a small business run operations, clients, scheduling, content, approvals, media requests, and business setup through Phantom AI.

## Foreground Product

The customer experience is PhantomForce App plus Phantom AI.

Customers should see one coherent cockpit. The canonical rendered navigation is:

- Home
- Phantom AI
- Leads & Clients
- Schedule
- Tasks
- Content
- Media Lab
- Offers
- Approvals
- Settings
- Status

The app should feel like a managed business operating system for a small business owner. It should not feel like the customer is switching between AI vendors, developer tools, local models, or internal infrastructure.

In product copy, "customer" means the business owner buying PhantomForce. In the personal-training simulation, "clients" means the trainer's roster. Avoid using "client" for both.

## Background Workforce

The background workforce supports PhantomForce. It is not the product being sold.

- PhantomForce App: one client cockpit.
- Phantom AI: the user-facing assistant/interface.
- Hermes: memory, context compiler, ledger, approvals, rules, summaries, and history.
- Claude API: premium reasoning brain when configured through official API configuration.
- Codex: internal operator, builder, and auditor.
- Local models: fallback, helper, compression, and token-saving layer.
- PhantomCut: optional customer-visible Media Lab add-on; editor internals stay background.
- Pangolin/access layer: access control and gating, not the app itself.
- PhantomPlus: planned managed multi-agent runs inside PhantomForce, bounded by Hermes, budgets, max steps, runtime limits, tenant isolation, approval gates, pause/stop controls, and admin audit trail.
- Jordan/PhantomForce: managed service operator and final control layer.

## Client-Facing Boundaries

The customer should not see raw provider routing, developer tool names, repo state, CLI internals, token plumbing, localhost controls, or unproven live claims.

Do not sell or foreground:

- Claude
- Codex
- Hermes
- local models
- provider switching
- internal agent bridge mechanics

The customer can see that Phantom AI is available, limited, in setup, blocked, or approval-gated. The customer should not need to understand which background worker produced an answer.

Customer status may show Ready / Needs setup / Blocked and approval state. Raw launch blockers, provider names, and infrastructure details belong in admin/debug.

## Admin And Debug Truth

Admin/debug mode may show honest operational labels:

- Brain: Mock / Local / Claude API Not Configured / Claude API Ready
- Hermes: Not Integrated / Ledger Stub / Ledger Enabled / Context Compiler Enabled
- Access: Demo Local / Owner Config-Gated / Pangolin Dry-Run / Pangolin Live
- Actions: Disabled / Approval Only / Live

These labels must be scoped to admin/support/status contexts. They must not become the primary customer product language.

## Safety Rules

- No public exposure unless explicitly approved.
- No Pangolin/Newt route changes from simulation work.
- No production deploy from simulation work.
- No outbound emails, posts, uploads, or sends without approval.
- No credential scraping, token storage, or secret commits.
- No destructive migrations or destructive scripts.
- No fake billing, access, launch, or provider-readiness claims.
- Do not implement customer-facing Claude through Claude Code OAuth/session reuse.
- Customer-facing Claude must use official Claude API configuration only.
- Do not run unbounded agent loops. Future PhantomPlus runs must have max steps, max cost, max runtime, approval gates, tenant isolation, and audit history.
- Do not route high-sensitivity data to cheap third-party worker models by default.

## Product Patch Rule

Every future patch must improve at least one of:

1. One-app client experience
2. Phantom AI usefulness
3. Hermes memory/context/ledger
4. Approval safety
5. Client onboarding
6. Admin/support visibility
7. Media/content workflow
8. Token reduction
9. Launch readiness

Random features that do not support this constitution should not be built.
