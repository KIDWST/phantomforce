# Phantom Unreal Test Matrix — V11R6

| Gate | CubeTown | Ages | Strike | Legends |
|---|---|---|---|---|
| C++ compile | PASS | PASS | PASS | PASS |
| Windows Shipping package | PASS | PASS | PASS | PASS |
| Packaged launch/capture | PASS | PASS | PASS | PASS |
| Persistent-world structure | PASS | PASS | PASS | PASS |
| HUD/gameplay frame | PASS | PASS | PASS | PASS |
| Automated visual acceptance | FAIL | FAIL | FAIL | FAIL |
| Runtime performance telemetry | OPEN | OPEN | OPEN | OPEN |
| Promotion authorization | BLOCKED | BLOCKED | BLOCKED | BLOCKED |

Commands:

```powershell
& 'H:\UE_5.8\Engine\Binaries\Win64\UnrealEditor-Cmd.exe' '.\PhantomGames.uproject' -run=pythonscript -script='.\Tools\ValidateProductionWorlds.py' -unattended -nop4 -nosplash -nullrhi
.\Tools\PackageCandidatesV11R3.ps1 -Revision V11R6
.\Tools\Capture-GameplayProof.ps1 -CandidateRoot '.\CandidateBuilds\V11R6' -ProofRoot '.\Saved\PhantomGameplayProofV11R6Final'
.\Tools\Test-GameplayFrame.ps1 -ProofRoot '.\Saved\PhantomGameplayProofV11R6Final'
```
