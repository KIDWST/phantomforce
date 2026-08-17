# Phantom Games V8 — 2026 implementation research

This note records the implementation direction used by the V8 updater. It is deliberately a reference/audit document, not permission to blindly copy third-party projects or mix incompatible art packs.

## Unreal reference architecture

- Unreal Engine 5.8 is the project's current engine target. V8 keeps the existing 5.8 build and import pipeline rather than silently changing engine major/minor versions during a rescue build.
- Epic's current Lyra Starter Game remains a strong reference for modular shooter architecture, Enhanced Input, Gameplay Ability System patterns, UI, weapons, teams and scalable game features. PhantomStrike should compare its systems against Lyra rather than copying Lyra content wholesale.
- When Unreal changes, Epic recommends comparing against the sample version that matches that engine version; version-specific sample code matters.
- Epic's UE 5.8 release work continues to emphasize rendering, animation/character systems, worldbuilding and PCG. V8 therefore keeps the project on current UE 5.8 features but avoids enabling plugins merely because they are fashionable.

Primary references:
- https://dev.epicgames.com/documentation/en-us/unreal-engine/lyra-sample-game-in-unreal-engine
- https://dev.epicgames.com/documentation/en-us/unreal-engine/upgrading-the-lyra-starter-game-to-the-latest-engine-release-in-unreal-engine
- https://dev.epicgames.com/documentation/en-us/unreal-engine/abilities-in-lyra-in-unreal-engine
- https://dev.epicgames.com/documentation/en-us/unreal-engine/unreal-engine-5-8-release-notes

## Current public character/animation research targets

Quaternius currently publishes CC0, engine-compatible character/animation resources that are useful candidates for a future verified SkeletalMesh import pipeline:

- Universal Animation Library 2 (2026): 130+ humanoid animations.
- Universal Base Characters (2025): six base characters plus hairstyles, humanoid rig, glTF/FBX.
- Modular Character Outfits — Fantasy (2025): modular fantasy outfit library for the same kind of character workflow.

V8 does **not** flatten arbitrary rigged FBX files into StaticMesh characters. That earlier shortcut produced sideways/frozen/incorrect characters. Those packs should only be promoted into runtime once the skeletal import + retarget + animation path is verified inside Unreal.

References:
- https://quaternius.com/packs/universalanimationlibrary2.html
- https://quaternius.com/packs/universalbasecharacters.html
- https://quaternius.com/packs/modularcharacteroutfitsfantasy.html

## RTS research direction

Current RTS player discussions repeatedly converge on two requirements that matter here: a familiar, robust control/formula foundation and enough faction/content/flavor to make the game worth staying in. Beginner-facing discussions also emphasize clear, easy-to-learn controls and readable interfaces. Phantom Legends therefore keeps familiar RTS interaction (drag-select, contextual right click, formations, control groups, camera pan/zoom) while V8 focuses on making the opening capital and battlefield visibly populated rather than reinventing controls.

## Asset-source policy

V8 uses this order:

1. Existing authored Phantom assets (especially PhantomStrike city/weapons).
2. Compatible assets discovered from the original Unity baseline.
3. Already imported/owned Fab, Quixel/Megascans and Marketplace content discovered inside the Unreal project.
4. Required current free/CC0 creator packs from Kenney/KayKit.
5. Guaranteed bundled V8 Y-up GLB world pieces and setpieces.
6. No Engine primitive as a silent missing-art fallback.

Paid Fab content is never purchased automatically. Browser cookies/tokens are never scraped. Fab/Quixel assets are only promoted when already imported/entitled through the normal Epic workflow.

## V8 production lesson

The previous iterations over-valued "compiled and packaged". V8's promotion contract is instead:

**compile -> one content-import editor session -> build isolated candidates -> launch actual gameplay -> take one gameplay screenshot per game -> reject flat/blank/prototype frames -> only then promote.**

A failed visual gate leaves the current live PhantomPlay build intact.
