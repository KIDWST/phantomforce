# PhantomForce Continuous Website Quality Program

PhantomForce quality work is an endless program made of finite, verified cycles.
The product is never considered permanently finished, but every change must earn
its existence by fixing a verified problem, reducing measurable friction,
improving maintainability, or increasing product clarity.

## North Star

Continuously transform PhantomForce into the clearest, fastest, most trustworthy,
accessible, resilient, visually polished, and commercially effective product
experience possible.

## Product Principles

1. PhantomForce is the command center and control plane for the Phantom ecosystem.
2. PhantomPlay should be a focused, separate experience that PhantomForce can
   configure, publish to, and launch.
3. Customers should not be forced to use every Phantom capability.
4. Subscription packaging should group meaningful capabilities without hundreds
   of confusing micro-options.
5. Workspace or organization type is separate from user role.
6. Recommended workspace profiles are Business, Education, Individual/Creator,
   and Enterprise/Custom.
7. Roles may include Owner, Administrator, Developer, Operator, Teacher,
   Student, Creator, and Viewer.
8. Developer is a role, capability package, or use case; it is not the default
   identity of every organization.
9. Onboarding should progressively determine what the customer is setting up,
   their role, desired outcomes, needed modules, and recommended subscription.
10. Public and authenticated surfaces must clearly distinguish PhantomForce,
    PhantomPlay, workspace types, roles, modules, pricing, and customization.

## Cycle Loop

Each cycle follows:

1. Discover routes, components, interactions, states, and tests.
2. Exercise representative journeys in a running app.
3. Audit functional behavior, product clarity, content, visual quality,
   responsiveness, accessibility, performance, SEO/sharing, security/privacy,
   reliability, and maintainability.
4. Record verified issues with severity, evidence, reproduction, expected and
   actual behavior, likely cause, correction, and test requirement.
5. Fix the highest-impact safe batch that fits a coherent reviewable change set.
6. Verify with applicable tests, type checks, builds, and browser/runtime smoke.
7. Self-review the diff for regressions, accidental scope expansion, secrets,
   temporary code, accessibility problems, and documentation drift.
8. Checkpoint the audit log, backlog, scorecard, and next-cycle file.

## Severity

- P0: security compromise, data loss, destructive behavior, or app unusable.
- P1: core journey broken, severe accessibility failure, or major blocker.
- P2: significant usability, performance, content, or reliability problem.
- P3: valid polish or maintainability improvement.
- P4: low-impact idea requiring product validation.

## Required Durable Artifacts

- `docs/quality/SITE_INVENTORY.md`
- `docs/quality/QUALITY_SCORECARD.md`
- `docs/quality/QUALITY_BACKLOG.md`
- `docs/quality/AUDIT_LOG.md`
- `docs/quality/PRODUCT_DECISIONS.md`
- `docs/quality/NEXT_CYCLE.md`
- `docs/quality/site-surface.json`
- `docs/quality/latest-audit.json`

## Completion Condition For One Cycle

A cycle checkpoint is valid only when the discoverable inventory is updated,
new P0 issues are fixed or blocked with evidence, P1 issues are fixed or
documented with concrete blockers, at least one meaningful evidence-backed
improvement is implemented unless genuinely blocked, relevant checks pass,
browser-visible changes are inspected, quality docs are current, and the next
cycle is defined.

Never end with "the website is complete." End with a checkpoint and the next
highest-value investigation.
