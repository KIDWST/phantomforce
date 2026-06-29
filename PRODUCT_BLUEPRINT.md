# PhantomForce Product Blueprint

## Current Priority

Turn the personal-training client simulation into a clean PWA-first app package:

- one owner login
- owner-only workspace
- employee roles disabled/future
- clear modules
- Phantom AI status
- Hermes status in admin/debug context
- approval queue
- personal-training sample data
- PhantomCut only as optional Media Lab add-on

## Product Shape

PhantomForce should open into the client cockpit, not a tool catalog. The personal-training simulation should model a high-value small business owner running:

- lead intake
- client roster
- training sessions
- package offers
- tasks and follow-ups
- content calendar
- media requests
- approvals
- setup and launch blockers

Phantom AI should be the connective tissue across these modules. It can suggest, summarize, draft, and queue actions. It cannot silently send, post, deploy, delete, bill, change credentials, or touch production.

## PWA-First Navigation

Primary customer navigation:

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

Short labels may be used in constrained mobile navigation, but the app should still read as one product.

This is the canonical product navigation. Older labels such as Command Center, Content Calendar, Offers / Packages, Settings / Access, and Status / Launch Blockers may appear in internal docs, but rendered product UI should use the canonical labels unless space requires a shorter variant.

## Owner-Only Access Model

The simulation is owner-only.

- Owner login is demo/local.
- Employee roles are disabled/future.
- Staff delegation is blocked until role rules, audit trails, and approval boundaries are implemented.
- Client access and billing claims must stay clearly demo/config-gated until proven.

Use "customer" for the small-business owner buying PhantomForce. Use "clients" only for the personal trainer's roster.

## Phantom AI Status

Customer-facing language:

- Phantom AI: Demo assistant / Setup required / Ready
- Memory: Setup required / Enabled
- Actions: Approval only / Disabled / Live
- Launch readiness: Ready / Needs setup / Blocked

Admin/debug language may additionally show:

- Brain: Mock / Local / Claude API Not Configured / Claude API Ready
- Hermes: Not Integrated / Ledger Stub / Ledger Enabled / Context Compiler Enabled
- Access: Demo Local / Owner Config-Gated / Pangolin Dry-Run / Pangolin Live

Admin/debug labels must not dominate the customer workspace.

## Personal-Training Simulation Seed

The local seed should include:

- owner/operator profile
- services/packages
- leads
- client roster
- today's schedule
- tasks
- approvals queue
- content calendar
- media requests
- onboarding checklist
- launch blockers

All simulation data must be labeled as demo/local. It must not imply live customers, billing, posting, or production access.

## Media Lab And PhantomCut

Media Lab is part of the client cockpit. PhantomCut is an optional customer-visible add-on for video/editor workflows, while Resolve/editor implementation details remain background.

For the personal-training simulation, PhantomCut may support:

- form-check clips
- transformation reel prep
- testimonial capture planning
- short-form content handoff

It is not the core app and should not replace leads, clients, scheduling, approvals, or packages.

## Hermes Direction

Hermes should become the memory, context compiler, ledger, rules, summaries, approval history, and launch-readiness record.

MVP direction:

- compile small useful context packets
- avoid dumping huge raw histories into premium models
- record provider/memory/action status in an append-only ledger
- make approvals and risks visible

Until implemented, Hermes must be shown as setup required or not integrated, not as live memory.

## Launch Blockers

The default customer Status view should show readiness in plain language: Ready, Needs setup, Blocked, Approval only. The simulation cannot be represented as real customer launch-ready until these are proven:

- official Claude API path for customer-facing premium reasoning
- Hermes memory/context/ledger implementation
- approval ledger and audit trail
- owner-only access rules
- employee role disablement/future-state clarity
- production access and billing gates
- no secret exposure
- no public deployment or route changes from the simulation patch

## Smallest Safe UI Patch

The next UI patch should:

- foreground PhantomForce and Phantom AI in customer-facing copy
- move raw provider/tool-stack status into admin/debug/status areas
- keep admin/debug closed by default, even for the owner-only simulation
- add the personal-training simulation seed as local demo data
- make approval-only behavior visible
- show PhantomCut as optional Media Lab add-on
- avoid package changes, backend route changes, public exposure, and production actions
