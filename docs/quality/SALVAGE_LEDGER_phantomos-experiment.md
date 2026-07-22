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
| `phantom-chess`, `phantom-cube`, `phantom-grand-prix`, `phantom-pizzeria`, `beat-strike` | **SUPERSEDED — verified by diff** | Not assumed — diffed branch vs live `main`: chess/cube/pizzeria differ by 5–10 lines (`main` ahead); **phantom-grand-prix: `main` has +1,660 lines** (Cup mode, hop-drift, slipstream) and **beat-strike: `main` +159 lines**. Taking the branch copies would be a *regression*, so the live versions are kept. |
| `app/games/kingdom-breakers-fix/` | **NOT A GAME** | 117-line "Weapon Fix Demo" whose own subtitle says it just *visualizes* combat math from a test file. `main` ships the full `kingdom-breakers` game (physics siege, campaign, duel, wardens). Shipping the demo as a catalog "game" would be dishonest. |
| Phantom Midna / Disney character animation (`phantom.css` deltas) | **SUPERSEDED** | `main` evolved the companion well past this ("Bring the Phantom back", expressive cyber-face, Command-OS `pc-avatar`). |
| **PhantomOS shell** (`app/os/index.html`, `app/os/os.css`, `app/js/os.js`) | **SALVAGED — now live & reachable** | The most visionary unique asset: a radical "interface after the interface" (Floor / Focus / Threadline / Desk / Voice — no sidebar, dashboard, or chat page). It turned out to depend on the **shared** `store.js`/`command.js`/`workspaces.js` (not a fork of them), and live `main` already exports **14 of the 15** symbols it needs — the only gap was `commandBriefing()`, a self-contained function ported verbatim into `store.js`. Added `\|\| []` null-safety for the optional `games`/`storeItems`/`agents` collections. **Verified headless against live main: boots with zero errors, the full Floor renders, and it's reachable via a new owner-only, internal-only `PhantomOS` nav entry that opens `/app/os/index.html`.** |
| **The Flow** (`handoff/flow-map/`) | **SUPERSEDED — verified** | Live `main` **already ships the same concept and wires it in**: `app/js/flowmap.js` (206 lines — "Leads → Quotes → Delivery → Sites → Accounting → Protection", live store stats, every node opens its workspace, reduced-motion static) is imported by `main.js` and mounted in a real operations-map overlay dialog. The branch's "The Flow" is a prettier *standalone, zero-dependency* take (starfield, comet sparkles, green→cyan→gold ribbon), but wiring it live would duplicate a shipped feature. Kept as an *optional cosmetic reference* for enhancing the live map later; recoverable at `origin/archive/phantomos-experiment:handoff/flow-map/`. |

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
