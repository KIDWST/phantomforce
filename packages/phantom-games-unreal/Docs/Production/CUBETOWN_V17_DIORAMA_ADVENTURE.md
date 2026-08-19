# CubeTown V17 — Diorama Adventure

V17 is a concrete upgrade, not a source-only placeholder.

- fixes the hero's floor placement by tracing the persistent world and placing the capsule exactly on the hit surface;
- changes the camera to a higher, tighter diorama-adventure composition;
- reduces visual bob and increases grounded movement friction;
- ships the recovered original V17 material library directly as Unreal assets;
- patches `CubeTown_World.umap` in Unreal with visible V17 terrain layers, a Memorycraft garden, destination pads, authored prop rings and a floating traversal chain;
- compiles `PhantomGamesEditor` and `Cubetown` locally so C++ changes actually reach the game binary.

The repository contains the 16 material sets used by the V17 world. The original external SourceArt library is not part of this recovery, so the production pipeline deliberately consumes the committed Unreal assets and does not make a false source-library claim.

This pass is inspired by the *systemic toy-box adventure* feel of games such as Echoes of Wisdom, but it does not include Nintendo assets, characters, maps, dialogue, music, UI art or copied level layouts.
