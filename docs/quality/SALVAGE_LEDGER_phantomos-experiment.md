# Salvage ledger — `claude/phantom-midna-animation-mvys72` (PhantomOS experiment)

**Date:** 2026-07-22 · **Cycle:** salvage the greatest work from a stale branch, discard nothing silently.

## Situation

The branch `claude/phantom-midna-animation-mvys72` had diverged badly: **886 commits behind
`origin/main`** and forked from an ancient base (`4efc4719`, 2026-07-02). It carried **18
branch-unique commits** — an alternate "PhantomOS" line plus several games. Live ships from
`main`, so this branch reached no user. Rather than blindly discard it or blindly rebase all 18
(which would duplicate features `main` already shipped and conflict heavily), each unique asset
was evaluated on its own merit.

**Full history preserved:** the branch tip `4803815f` was pushed to
`origin/archive/phantomos-experiment` before the working branch was restarted on `origin/main`.
Nothing is lost; every commit remains recoverable there.

## Disposition of the 18 branch-unique commits

| Asset | Verdict | Reason |
|---|---|---|
| `app/games/phantom-ages/` (+ `shared/objectPool.js`) | **SALVAGED — now live** | Real, complete Age-of-War lane pusher (fixed-timestep sim, pooled units/projectiles). `main` had no equivalent. Verified running headless, wired into all three catalogs (`phantomplay.js`, `phantomplay-v2.js`, `server/phantomplay.ts`) with a first-class cover. |
| `phantom-chess`, `phantom-cube`, `phantom-grand-prix`, `phantom-pizzeria`, `beat-strike` | **SUPERSEDED** | `main` already ships all five, evolved further across its 886-commit lead. Branch copies are older. |
| `app/games/kingdom-breakers-fix/` | **DISCARDED** | A "Weapon Fix Demo" test harness, not a game. `main` ships the full `kingdom-breakers`. |
| Phantom Midna / Disney character animation (`phantom.css` deltas) | **SUPERSEDED** | `main` evolved the companion well past this ("Bring the Phantom back", expressive cyber-face, Command-OS `pc-avatar`). |
| **PhantomOS shell** (`app/os/index.html`, `app/os/os.css`, `app/js/os.js`) | **ARCHIVED → candidate for a deliberate future cycle** | The most visionary unique asset: a radical "interface after the interface" (Floor / Focus / Threadline / Desk / Voice — no sidebar, dashboard, or chat page). But it is a **standalone shell built against an 886-commit-old `store.js`/`workspaces.js` API**; reviving it live is a real reconciliation project, not a blind merge, and it competes directionally with `main`'s own Command-OS. Should be revived only as an owner-greenlit, scoped effort. |
| **The Flow** (`handoff/flow-map/`) | **ARCHIVED → widget candidate** | A cinematic animated offer-chain map, already packaged as a standalone handoff. Good candidate to become a real dashboard widget in a later cycle. |

## Recovery pointers

- Full experiment branch: `git fetch origin archive/phantomos-experiment`
- PhantomOS shell files live at `origin/archive/phantomos-experiment:app/os/` and `:app/js/os.js`
- The Flow: `origin/archive/phantomos-experiment:handoff/flow-map/`

## This cycle's shipped change

Salvaged **Phantom Ages** into the live catalog. Base: `origin/main` @ `0335248b`. Build id
bumped `phantom-live-20260722-17 → -18` across the static module graph (132 refs).

### Known pre-existing blockers (NOT introduced here)

`node scripts/guard-change-memory.mjs` fails on two rules that were already red on clean
`origin/main`, in files this cycle did not modify:
- `customer-plan-switching-tier-simulator` — `entitlements.ts` exposes `developer`/`developer_elite`
  tiers the guard's pattern doesn't allow.
- `dashboard-chat-context-and-fast-routing` — `command.js` model-routing pattern.

These block `ship:live-admin` and are owned by whoever added the developer tiers / model routing.
