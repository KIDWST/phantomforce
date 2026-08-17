# Phantom Games Unreal

Unreal Engine project for three PhantomPlay flagships plus the native Cubetown expansion:

- **PhantomStrike** — a modern first-person tactical shooter.
- **Phantom Ages** — a fixed orthographic age-evolution lane battler.
- **Phantom Legends** — a fantasy RTS and persistent settlement builder.
- **Cubetown: Echoes of the Maker** — a voxel action-adventure and creative builder.

The project shares rendering, build automation, and low-level platform code. It does not share game identities, camera controllers, save namespaces, gameplay directors, or executable targets.

## Identity Contract

| Game | Target | Runtime ID | Save namespace | Camera |
| --- | --- | --- | --- | --- |
| PhantomStrike | `PhantomStrike` | `phantom-strike` | `phantomstrike.` | first person |
| Phantom Ages | `PhantomAges` | `phantom-ages` | `phantomages.` | fixed orthographic side view |
| Phantom Legends | `PhantomLegends` | `phantom-legends` | `phantomlegends.` | elevated RTS camera |
| Cubetown | `Cubetown` | `cubetown` | `cubetown.echoes.` | elevated action-adventure camera |

Every player accepts `-PhantomGame=<id>`. An unknown ID is fatal rather than loading another game. The three flagship identities remain protected as exactly three products; Cubetown is an additional Unreal-native game and does not weaken support for unrelated Unity, Godot, Panda3D, web, executable, or uploaded projects.

## Build

Epic Games Launcher installs are discovered automatically from the launcher's manifest records, including engines installed on non-system drives. Compile all four native targets from the repository root with:

```powershell
npm run build --workspace @phantomforce/phantom-games-unreal
```

Build all four standalone Windows players with:

```powershell
npm run build --workspace @phantomforce/phantom-games-unreal -- -PackageWindows
```

Epic installed builds include `SwarmInterface` precompiled. When Visual Studio does not include the legacy .NET Framework SDK discovery files, the build creates a local ignored discovery marker rather than modifying the engine installation. Source-built Unreal engines still require the real SDK.

Smoke-test all four packaged players with:

```powershell
npm run smoke:windows --workspace @phantomforce/phantom-games-unreal
```

To override engine discovery, set the engine root explicitly:

```powershell
$env:UNREAL_ENGINE_ROOT = "H:\UE_5.8"
npm run build --workspace @phantomforce/phantom-games-unreal -- -PackageWindows
```

Normalized outputs:

```text
Builds/Windows/phantom-strike/PhantomStrike.exe
Builds/Windows/phantom-ages/PhantomAges.exe
Builds/Windows/phantom-legends/PhantomLegends.exe
Builds/Windows/cubetown/Cubetown.exe
```

PhantomPlay launches these four players in their own resizable native windows. Cubetown's existing web files remain available as source and compatibility reference, but Run prefers the packaged Unreal player and never silently falls back. Other catalog games continue using their declared web, Canvas, WebGL, Godot, Unity, Panda3D, or executable runtime.

## Current Source Systems

- PhantomStrike has automatic rifle combat, aim-down-sights, recoil and heat spread, timed reloads, headshots, damage feedback, role-based enemies, escalating waves, scoring, extraction state, and a procedural near-future command complex.
- Phantom Ages has a fixed orthographic lane camera, layered era-specific units and towers, visible projectiles, health bars, disciplined front/ranged/siege formations, six literal research paths, battle-speed controls, counter-aware economy AI, restrained tower defense, and the required catapult/springald target rules.
- Phantom Legends has an RTS camera, role-group selection, formation orders, resource-node gathering, guards and rangers, automated defense towers, persistent stronghold upgrades, escalating Rift raids, structure combat, and a generated fantasy frontier.
- Cubetown has a voxel island, mine/place building, biome blocks, hero combat and dash, learned creature echoes, summonable companions, Wisdom Shrines, escalating world cycles, a Rift Guardian finale, and persistent inventory/progression.

The source is a production foundation, not a claim that final AAA art, authored maps, animation, audio, networking, optimization, or packaged builds are complete.
