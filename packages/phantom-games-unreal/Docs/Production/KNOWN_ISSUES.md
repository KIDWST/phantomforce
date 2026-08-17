# Known Issues — V11R6

- All four captured gameplay frames fail the automated flatness/detail gate.
- CubeTown ground/material breakup and prop grounding are visibly weak.
- Phantom Ages is readable but lacks depth, effects, and foreground richness.
- PhantomStrike needs additional environmental and lower-frame detail.
- Phantom Legends contains egg-like translucent silhouettes and fails to communicate its canonical 4096 m scale.
- Two discovered Fab aliases were false semantic matches to `HeadMesh`; they are not acceptable production assets.
- Performance telemetry, soak testing, multiplayer testing, save/load testing, and broad input-device coverage are not complete.
- Capture-only Legends edge-scroll suppression is conditional on `PhantomGameplayCapture`; it requires regression coverage whenever capture tooling changes.
- The repository was already dirty and the Unreal/Unity package trees are untracked at the parent repository level; no cleanup or reset was performed.
