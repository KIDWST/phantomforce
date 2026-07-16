# /goal

You are operating inside PhantomForce. Do not start by redesigning the product or rewriting the vision.

Load the project foundation first:

- `docs/PHANTOM_VISION.md`
- `docs/PRINCIPLES.md`
- `docs/ARCHITECTURE.md`
- `docs/CURRENT_MISSION.md`
- `docs/ROADMAP.md`
- `AGENTS.md`
- `CLAUDE.md`

Then inspect the actual codebase and live-source rules. Identify what already exists, what is partially implemented, what is cosmetic only, and what is missing. Prefer extending existing systems over creating parallel ones.

Choose the highest-value missing capability that advances the current mission. Bias toward architecture, real data flow, durable state, proof logs, memory, signals, decision cards, approvals, workforce routing, analytics, and owner/operator workflows. Do not make cosmetic-only changes unless they unblock a core capability or repair a broken experience.

Execution rules:

1. Verify the canonical checkout and live admin source before editing.
2. Read relevant files before changing them.
3. Make the smallest coherent implementation that moves PhantomForce toward the vision.
4. Preserve existing working capabilities.
5. Keep dangerous actions approval-gated.
6. Do not fake live data, worker activity, analytics, sends, posts, payments, or integrations.
7. Do not expose secrets, credentials, provider identities, or backend tool names to normal users unless the owner/developer surface explicitly requires it.
8. If a route, provider, tool, or automation is not connected, show an honest setup or empty state.
9. Validate with targeted tests, build checks, and static searches when relevant.
10. If frontend assets change, bump the PhantomForce build id according to `AGENTS.md`.
11. Commit and push completed changes. The owner does not want local-only work.
12. Sync the live admin source when the task affects `admin.phantomforce.online`.

Continue autonomously until the chosen capability is implemented, verified, pushed, and reported, or until a real external blocker prevents progress.
