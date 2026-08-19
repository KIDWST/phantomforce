# PhantomPlay Portfolio V14 — Gameplay & Reliability Pass

Date: 2026-08-18

This pass upgrades all four Unreal games without repacking the project or replacing persistent maps/assets.
It is intentionally source-focused so it can be installed as a small update-only package over V13.

## Shared PhantomPlay shell

- One UI scale contract now drives both shell rendering and mouse hit-testing from 720p through 4K.
  The previous shared shell, CubeTown shell, and click handler used different scale caps, which could
  make high-resolution buttons draw in one location while their clickable rectangles remained elsewhere.
- Master volume now persists through `GameUserSettings.ini` and is inherited by all four executables.
- Existing Unreal graphics scalability persistence remains intact.

## PhantomStrike

- Firing now exits sprint immediately for a much more responsive sprint-to-fire transition.
- Starting a sprint safely cancels reload/inspect without losing ammunition, matching fast classic-FPS expectations.
- Starting a reload exits sprint and clears inspect state.
- Sidearm reload/inspect now animates the actually equipped weapon instead of rotating the hidden rifle.
- Respawn now clears sprint/ADS/reload/prone/slide/recoil/heat/crouch state, stops residual velocity, and restores a clean combat view.

## Phantom Ages

- Victory/defeat now returns global time dilation to 1x before the five-second result window so 4x battle speed cannot make post-match UX race by.
- Rematch reset clears the production queue and queue counters instead of carrying paid/stale orders into a new battle.
- Production-world gameplay towers remain hidden after a rematch, preserving the persistent authored fortress presentation.
- Rematches now reseed the same age-zero opening armies and starting-war economy as first launch, rather than reopening as two empty towers.

## Phantom Legends

- Dead weak unit references are pruned from live selection and control groups every frame, preventing stale selected-unit counts and dead control-group entries after battles.
- Defense-tower resources are spent only after the tower actor successfully spawns; a failed placement no longer consumes wood/stone.
- Loaded economy/progression values are clamped to safe production ranges so corrupt/legacy saves cannot create negative resources or impossible stronghold tiers.

## CubeTown

- Hero defeat now performs a complete adventure-state reset: stamina, combo, guard, sprint, crouch, lock-on, movement velocity, camera facing, and a short spawn-protection window.
- The warm CubeTown shell now uses the same shared high-DPI scale contract as its mouse hit-testing.

## Verification status

Static source validation: PASS in the ChatGPT workspace.

Still requires Unreal-side verification on the Windows UE 5.8.1 machine:

- C++ build for all four targets
- packaged launch/smoke for all four games
- 1440p/4K shell click verification
- Phantom Ages rematch verification
- Phantom Legends selection/control-group battle verification
- PhantomStrike sprint/reload/respawn feel verification
- CubeTown defeat/respawn verification
