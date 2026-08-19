# PhantomPlay Four-Game Parallel Development Pass

Date: 2026-08-18

## Portfolio contract

PhantomStrike, Phantom Ages, Phantom Legends, and CubeTown are first-class PhantomPlay games and must advance under the same portfolio gate. A development/rebuild pass is incomplete if it silently rebuilds or validates only one title.

## Changes in this archive

- The one-shot Unreal editor pipeline now reapplies the current checked-in world-authorship layers for all four games after rebuilding base worlds: V11R7 for CubeTown + Legends, V11R10 for Ages + Strike, then CubeTown V12, followed by four-world validation.
- `Build-Flagships.ps1` now requires those patch stages to PASS before the content gate succeeds.
- `Run-PhantomVisualQA.ps1` no longer points at an obsolete Codex checkout and resolves the current project root automatically. It also launches each title with its explicit game identity.
- `Run-PhantomPortfolioPass.ps1` was added as a single portfolio command for four-target preflight, content/compile, candidate packaging, 4/4 gameplay capture, and the visual gate. It never promotes builds.

## Verification status

Static archive validation was performed in ChatGPT: the four targets, four game IDs, four persistent maps, and referenced patch scripts are present. Unreal compilation, cooking, packaged launch, and gameplay capture cannot be truthfully marked verified until this archive is run against the user's UE 5.8.1 installation.
