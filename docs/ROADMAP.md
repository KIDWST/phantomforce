# Roadmap

This roadmap is a long-term operating plan. It should change as implementation reality changes, but the phase order protects the product from becoming a pile of disconnected tools.

# Phase 1: Foundation

## Objectives

Establish the operating spine: Command, Outcomes, Signals, Memory, Decisions, Approvals, Evidence, and Workforce.

## Deliverables

- Unified object model for Outcome, Signal, Decision, Evidence, Approval, Memory, Department, Business Record, Asset, Execution, and Task.
- Context composer connected to memory and system health.
- Honest empty states for brand-new accounts.
- Owner-visible memory vault and context preview.
- Signal intake interface for existing systems.
- Decision Card data contract.
- Proof/evidence ledger integration.

## Dependencies

- Existing Hermes/ledger patterns.
- Existing memory store.
- Existing approval queue.
- Existing admin auth and tenant scoping.

## Success Criteria

- Phantom can remember durable preferences.
- Chat uses context before responding.
- Signals can become decisions.
- Decisions can require approval.
- Actions produce evidence.
- No duplicate disconnected memory/ledger system exists.

# Phase 2: Department Execution

## Objectives

Make every major business department produce useful work through the same operating spine.

## Deliverables

- Clients/CRM command handling and lead creation.
- Content Hub daily idea automation with configurable parameters.
- Media Lab outputs landing in Content Hub.
- Site Studio creation and publishing approval path.
- Money/accounting records and CSV export/import.
- Security/protect baseline checks.
- Automation tab showing only configured automations.
- Workforce drill-down showing real and mapped capability.

## Dependencies

- Phase 1 object model.
- Approval queue.
- Asset Cloud.
- Social OAuth where needed.

## Success Criteria

- Users can state an outcome and see the right department respond.
- Departments do not expose backend tool names unnecessarily.
- Automations are configurable and visible in one place.
- External actions remain approval-gated.

# Phase 3: Business Intelligence

## Objectives

Turn business data and external signals into decisions and measurable advantage.

## Deliverables

- Live social analytics with OAuth setup and sync.
- Competitor intelligence signal tracking.
- Website/store performance signals.
- Client pipeline analytics.
- Money/revenue signals.
- Content performance recommendations.
- Decision Cards generated from analytics and intelligence.

## Dependencies

- Provider OAuth credentials and account authorization.
- Evidence model.
- Signal store.
- Decision Card UI.

## Success Criteria

- Analytics show real live or imported data, not fake metrics.
- Every recommendation links to evidence.
- Business intelligence produces next actions.
- The owner can approve, reject, or remember recommendations.

# Phase 4: Away Mode

## Objectives

Provide controlled business coverage when the owner is unavailable.

## Deliverables

- Away coverage policy.
- Urgency/risk classifier.
- Allowed local/read-only work lanes.
- Approval escalation.
- Exception feed.
- Instant stop.
- Evidence receipts for every action.

## Dependencies

- Approvals.
- Signals.
- Worker run ledger.
- Notification strategy.

## Success Criteria

- Away Mode can watch and triage without creating chaos.
- Risky actions queue for approval.
- Owner can see exactly what happened while away.
- Turning Away Mode off stops new autonomous coverage.

# Phase 5: Multi-User Collaboration

## Objectives

Support businesses with owners, admins, employees, and scoped permissions.

## Deliverables

- Organization/user permission model.
- Employee login and feature grants.
- Tenant-scoped memory, assets, analytics, approvals, and automations.
- Owner-controlled employee capabilities.
- Audit trail by actor.
- Customer/workspace separation.

## Dependencies

- Database-backed auth.
- Durable tenant stores.
- Access policy system.
- Audit/evidence ledger.

## Success Criteria

- Owners can grant and revoke capabilities.
- Employees see only allowed modules.
- No cross-tenant data leakage.
- Every significant action has actor, time, scope, and evidence.

# Phase 6: Scale And Moat

## Objectives

Make PhantomForce difficult to replicate through coordinated tooling, memory, workflows, and proof.

## Deliverables

- Tool registry with hidden backend capability mapping.
- Provider/model router with owner controls.
- Local-first lanes for Ollama and desktop tools.
- Strong asset and memory retention policy.
- Workflow marketplace/recipes.
- Advanced content/editor capabilities.
- Robust automated diagnostics.

## Dependencies

- Stable object model.
- Durable storage.
- Provider credentials.
- Security posture.

## Success Criteria

- The product feels like a coordinated operating company, not a menu of tools.
- New accounts get immediate useful automations without fake data.
- Advanced tools work behind the curtain.
- Owners can inspect, control, and trust the system.
