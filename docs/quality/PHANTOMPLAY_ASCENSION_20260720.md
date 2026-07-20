# PhantomPlay Ascension - 2026-07-20

This is a finite implementation ledger, not an active Codex goal.

## Existing foundation

- PhantomPlay already has an authenticated catalog, favorites, progress, scores, content ratings, private tenant-scoped rooms, sandboxed game frames, and host message protocols.
- The admin web app already detects a newer build every 60 seconds, disables stale service workers, and reloads to the new cache-busted build. Users do not need to reinstall for web game updates.
- CubeTown already has saving, gathering, building, crafting, fishing, cooking, quests, trials, co-op room support, and a day/night loop.
- Crown Circuit, Skyguard Arena, Kingdom Breakers, Tidefront Tactics, Phantom Rumble, Rift Frenzy, and Serpent Surge already have functional game loops that should be extended rather than replaced.
- PhantomPlay games are network-silent inside a script-only iframe. Multiplayer uses the existing signed-in workspace relay or explicit same-device play, never public peer discovery.

## Missing play contracts

- Several titles still jump directly into play instead of presenting mode, loadout, match, and results as one understandable loop.
- Some games have shallow maps, imprecise collision, weak impact feedback, or difficulty curves that do not match the audience label.
- CubeTown needs streamed world scale and stronger visual identity without multiplying active simulation cost.
- Crown Circuit and Skyguard need a four-unit plus one-hero loadout contract, more maps, branching routes, and visible hero effects.
- The catalog is missing a complete cake-shop game and a first-person shooter.
- Game metadata and tests need one current engine capability contract instead of relying on descriptions alone.

## This implementation wave

1. Expand CubeTown through deterministic streamed regions, landmarks, atmosphere, and cartoon-human residents while preserving saves and existing systems.
2. Rework Crown Circuit and Skyguard into title -> loadout -> battle -> results flows with exactly four units and one hero.
3. Repair Phantom Dash, Type Storm, BeatStrike, Penalty Kick, and Neon Breaker input, difficulty, audio, and feedback.
4. Upgrade Court Vision, Cipher Keep, and Phantom Grand Prix around their requested full-game viewpoints and mode flows.
5. Add `I'm Baked`, a complete cake-shop day loop, and `Phantom Strike`, a network-silent first-person raycaster with solo bots and real same-device two-player play.
6. Extend the shared engine metadata, catalog, release tests, and visual QA. Existing web build refresh remains the update path.
7. Review the remaining strategy/action games after the first wave, then apply targeted fixes where current code does not satisfy the requested play contract.

## Non-negotiable truth

- No fake online players, fake live activity, or fake network claims.
- No external calls from built-in games.
- No public matchmaking, chat, voice, or inbound device ports.
- A game marked multiplayer must provide either the existing private workspace relay or genuine same-device multiplayer.
- Every shipped title must start, pause, restart, exit, report score/progress, and produce a real win/loss result.
