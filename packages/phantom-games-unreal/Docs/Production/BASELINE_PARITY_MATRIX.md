# Baseline Parity Matrix

| Game | Canonical size | Required camera/identity | Unity or prior baseline retained | V11R6 result | Parity verdict |
|---|---:|---|---|---|---|
| CubeTown | 960 × 960 m | Third-person adventure; 610 cm boom, -14° pitch, 68° FOV | Quest/build/season hooks and compatible assets inventoried | Playable village corridor, hero and HUD visible | Partial; lacks world-scale density and premium ground/material finish |
| Phantom Ages | 360 × 110 m | One-screen perspective battler; camera at `(0,-25000,14500)` cm, rotation `(-30.1,90,0)`, 66° FOV | Age/evolve/tower/formation/resource/build hooks inventoried | Clean readable battle lane | Partial; composition is flat and lacks premium combat spectacle |
| PhantomStrike | 480 × 360 m | First-person; camera offset `(-10,0,64)` cm, 103° FOV | Sprint/extraction and 31 character/weapon source selections inventoried | Road, cover, enemies, HUD and fitted weapon visible | Partial; strongest frame, still fails detail/foreground heuristic |
| Phantom Legends | 4096 × 4096 m | RTS; 9800 cm boom, `(-58,-45,0)`, 50° FOV | Age/tower/selection/resource/build hooks and 15 character assets inventoried | Stable stronghold framing under proof flag | Partial; map scale is not communicated and malformed resource/prop silhouettes remain |

No row is marked complete because the launcher contract requires four independent visual passes.
