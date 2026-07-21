# PhantomForce Ascension — Mission Control

Internal development record. Not customer-facing.

## Mission
UI revamp ("body") of PhantomForce per the Ascension orchestration spec: replace the
generic shell, establish semantic design tokens, migrate routes onto one coherent
system, integrate brain state throughout the product. Positioning goal: "the Apple
for business" — restrained, premium, dense-but-calm, coherent.

## Repository facts
- Repo root (live checkout, serves admin/app.phantomforce.online tunnels): `C:\Users\jorda\Documents\Codex\deployments\phantomforce-live` — stays on `main`, DO NOT switch its branch.
- Ascension worktree (all mission work happens here): `C:\Users\jorda\Documents\Codex\worktrees\phantomforce-ascension-ui-20260721`
- Integration branch: `ascension/ui-v2`
- Baseline commit: `95efdb91` (tag `ascension-baseline-20260721`)
- Remote: origin/main (synced at baseline)
- Monorepo: npm workspaces (`packages/*`, `server`), static front-end in `/app` + root `index.html`, Node >= 22, Prisma in server.
- Key commands: `npm run build`, `npm run dev:server`, `npm run typecheck`, `npm run test:release-critical` (full matrix in root package.json).

## Related in-flight work (do not collide)
- `worktrees\phantomforce-dual-ascension-20260720` — branch `codex/dual-ascension-20260720`, brain/confirmation-reasoning work by another session. Coordinate, don't revert.
- Parallel agent sessions editing worktrees are intentional per standing user guidance.

## Status log
- 2026-07-21: Mission started. Baseline tagged, branch + worktree created, ledgers scaffolded. Read-only investigation wave launched (6 auditors: cartographer, routes, design, data, a11y/perf, brain-surface) — workflow run wf_e468d681-edc.

## Recovery
- To recover baseline: `git checkout ascension-baseline-20260721`
- Live site is unaffected until `ascension/ui-v2` is deliberately merged to main and shipped via existing ship scripts (`npm run ship:live-admin` / verify first with `npm run verify:live-admin`).
