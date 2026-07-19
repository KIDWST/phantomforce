# PhantomForce Seven-Day Evolution Mission

Mission window: 2026-07-19 08:00 through 2026-07-25 20:00 America/Chicago.
The 21st scheduled cycle is the automatic stop condition.

This is a finite scheduled product task. It is not an active Codex goal and
must never be converted into indefinite background persistence.

## Product Thesis

PhantomForce is an adaptive operator brain with controlled hands and feet. Its
interface should let a person move through one continuous relationship with
their organization: see what changed, understand why it matters, decide what
should happen, approve consequential action, and verify the result. Pages and
tools are depths of that intelligence, not disconnected destinations.

The interface should be quiet when nothing needs attention and specific when
work is moving. Activity must come from real events. Recommendations must show
evidence or uncertainty. Sensitive actions must preserve permissions and
approval. Internal providers, routes, ports, tools, and implementation details
stay behind the customer curtain.

## Existing Mission Spine

Do not create duplicate records. Extend these sources:

- `AGENTS.md`: authoritative repo, branch, deployment, and cache rules.
- `docs/quality/SITE_INVENTORY.md`: route and state coverage.
- `docs/quality/QUALITY_SCORECARD.md`: evidence-based quality baseline.
- `docs/quality/PRODUCT_DECISIONS.md`: accepted and rejected product decisions.
- `docs/quality/QUALITY_BACKLOG.md`: unresolved risks and opportunities.
- `docs/quality/AUDIT_LOG.md`: detailed verification history.
- `docs/quality/NEXT_CYCLE.md`: single highest-value next batch.
- `docs/quality/CHANGE_MEMORY.json`: behavior that stale work must not undo.
- `docs/quality/EVOLUTION_STATE.json`: concise resumable mission state.
- `docs/quality/EVOLUTION_CYCLES.md`: the 21 synchronization checkpoints.

## Authoritative Runtime

- Remote: `https://github.com/KIDWST/phantomforce.git`
- Production branch: `main`
- Edit checkout:
  `C:\Users\jorda\Documents\Codex\worktrees\phantomforce-live-social-analytics-20260712`
- Served checkout:
  `C:\Users\jorda\Documents\Codex\deployments\phantomforce-live`
- Local app: `http://127.0.0.1:5177/app/index.html`
- Local API: `http://127.0.0.1:5190/health`
- Internal app: `https://admin.phantomforce.online/app/index.html`
- Customer app: `https://app.phantomforce.online/app/index.html`
- Public site: `https://phantomforce.online/`

Admin is the internal PhantomForce builder layer. The customer app is the
organization-facing product. Do not let role adaptation collapse those two
surfaces into the same authority or navigation.

## Cycle Contract

Each cycle performs one coherent batch:

1. Read this file, `EVOLUTION_STATE.json`, `NEXT_CYCLE.md`, and recent Git log.
2. Run `ops/evolution/Invoke-SevenDayEvolutionPreflight.ps1`.
3. Preserve local work, fetch `origin/main`, and understand new commits.
4. Capture and inspect the relevant route and state before editing.
5. Implement the smallest complete improvement that tests the current thesis.
6. Exercise real behavior on desktop and mobile; include empty, loading, error,
   permission, and reduced-motion states when the batch touches them.
7. Run focused tests, `npm run build`, `npm run test:change-memory`, and
   `git diff --check`. Do not weaken tests to obtain green output.
8. Fetch and rebase current `origin/main`, preserving concurrent work.
9. Commit and push coherent verified progress. Sync the served checkout and run
   the strict live-source doctor for user-facing app changes.
10. Update state, cycle evidence, scorecard/inventory when evidence changed,
    and set exactly one next highest-value batch.

## Interaction Language To Prove

- Intent becomes a visible, contextual work thread rather than a detached chat.
- Real system activity has source, state, consequence, and proof.
- Attention is summoned by priority; inactive capability stays discoverable but
  does not fill the screen.
- Related clients, assets, messages, automations, approvals, and outcomes retain
  context as the user moves deeper.
- Empty organizations teach useful setup without invented work or analytics.
- Dense organizations compress through focus, grouping, and progressive detail.
- Phantom is the intelligence presence, not a floating toy or blocked viewport.
- Keyboard, touch, zoom, reduced motion, and narrow screens are core states.

## Non-Negotiable Boundaries

- Preserve auth, tenant isolation, roles, permissions, billing, usage, APIs,
  storage, orchestration, approvals, auditability, and real data contracts.
- No fake analytics, work, agents, results, completion, or connected providers.
- No secrets, credentials, customer-private data, ports, local paths, provider
  names, or raw internal tooling on customer surfaces.
- Do not delete working capability to make a screenshot clean.
- Do not push or deploy a failing state. Keep the last known-good live commit.
- Do not use animation as a substitute for state, hierarchy, or causality.

## Recovery

On interruption, read `EVOLUTION_STATE.json`, inspect `git status`, compare HEAD
with `origin/main`, run the preflight, and resume `next_highest_value_action`.
If production is unhealthy, protect or restore `last_known_good_commit` before
continuing local evolution. Missing credentials block only the dependent path.

## Completion Evidence

The final package must summarize the thesis, changed assumptions, original
interaction concepts, route coverage, all 21 cycles, commands and results,
deployments and rollbacks, representative desktop/mobile captures, accessibility
and performance evidence, rejected directions, remaining risks, and a precise
continuation path. Completion is evidence-based, not a count of changed files.
