# Nexus Phase 7 — Play and Marketplace

## Delivered boundaries

Phase 7 strengthens the existing PhantomPlay product instead of creating a second game platform.

- PhantomPlay keeps one authenticated catalog, private-room system, save service, runtime watchdog, sandbox, moderation lane, and edge-cache boundary.
- Phantom Ages 2.1.2 now participates in the PhantomPlay host protocol, including ready, pause, resume, restart, save, restore, score, progress, and completion events.
- PhantomStore now has tenant- and actor-scoped product entitlements plus an owned-product library.
- Product install state is a truthful account record. PhantomStore does not execute installers or claim a download ran when it did not.

## Phantom Ages save contract

The game writes a bounded version-2 state containing:

- player and opponent fortress state;
- gold, era, branch, and upgrade levels;
- active units and their lane position/health;
- elapsed time.

Early unversioned development saves are migrated into the version-2 shape. A completed run restores to a clean match rather than reopening a stale victory screen. Runtime effects remain bounded at 90 projectiles and 130 particles.

## PhantomStore ownership contract

An entitlement requires an administrator-verified purchase reference. Replaying the same reference is idempotent. A purchase reference cannot be attached to another tenant, actor, or product.

The product library exposes:

- entitlement status;
- compatible platforms;
- installed version;
- update availability;
- installed/uninstalled state;
- preserved/purged user-data state.

Install and update state only advances for a compatible platform and an active entitlement. Uninstall preserves user data by default. Purge requires a separate explicit confirmation. Revoking access locks the installation while preserving data; restoring the entitlement unlocks it.

## Verification

- `npm run test:phantomplay`
- `npm run test:phantomstore`
- `GAME_FILTER=phantom-ages node scripts/test-game-runtime-visuals.mjs`
- `npm run build --workspace @phantomforce/server`

The visual runtime audit covers 375×812 and 1280×820. Both Phantom Ages cases loaded without horizontal overflow, blank surfaces, or light-theme leakage.
