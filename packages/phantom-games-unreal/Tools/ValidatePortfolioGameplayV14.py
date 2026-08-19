from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
checks = {
    "shared_shell_scale_api": (ROOT / "Source/PhantomGames/Public/Core/PhantomGameDirectorBase.h", "GetShellUIScale"),
    "shared_shell_uses_scale": (ROOT / "Source/PhantomGames/Public/Core/PhantomGameShell.h", "Director->GetShellUIScale"),
    "volume_persistence": (ROOT / "Source/PhantomGames/Private/Core/PhantomGameDirectorBase.cpp", "PhantomPlay.Audio"),
    "strike_active_weapon_animation": (ROOT / "Source/PhantomGames/Private/Strike/PhantomStrikeDirector.cpp", "UStaticMeshComponent* ActiveWeapon = bUsingSidearm ? SidearmBody : RifleBody"),
    "strike_clean_respawn": (ROOT / "Source/PhantomGames/Private/Strike/PhantomStrikeDirector.cpp", "GetCharacterMovement()->StopMovementImmediately();"),
    "ages_queue_reset": (ROOT / "Source/PhantomGames/Private/Ages/PhantomAgesDirector.cpp", "PlayerProductionQueueCounts.Init(0, 4)"),
    "ages_time_reset": (ROOT / "Source/PhantomGames/Private/Ages/PhantomAgesDirector.cpp", "UGameplayStatics::SetGlobalTimeDilation(this, 1.0f)"),
    "legends_selection_prune": (ROOT / "Source/PhantomGames/Private/Legends/PhantomLegendsDirector.cpp", "SelectedUnits.RemoveAll"),
    "legends_safe_tower_spend": (ROOT / "Source/PhantomGames/Private/Legends/PhantomLegendsDirector.cpp", "TOWER SITE BLOCKED // RESOURCES NOT SPENT"),
    "cubetown_respawn_reset": (ROOT / "Source/PhantomGames/Private/Cubetown/CubetownDirector.cpp", "InvulnerableRemaining = 1.0f"),
    "cubetown_shell_scale": (ROOT / "Source/PhantomGames/Private/Cubetown/CubetownDirector.cpp", "Director->GetShellUIScale(Width,Height)"),
}

failures=[]
for name,(path,needle) in checks.items():
    if not path.is_file():
        failures.append(f"{name}: missing {path.relative_to(ROOT)}")
        continue
    text=path.read_text(encoding="utf-8", errors="replace")
    if needle not in text:
        failures.append(f"{name}: expected marker missing")

# Guard against the V13 high-DPI bug returning in the base click path.
base=(ROOT/"Source/PhantomGames/Private/Core/PhantomGameDirectorBase.cpp").read_text(encoding="utf-8", errors="replace")
if "0.78f,1.18f" in base.replace(" ", ""):
    failures.append("shared_shell_scale: legacy 1.18 click cap still present")

if failures:
    print("PHANTOMPLAY V14 STATIC VALIDATION: FAIL")
    for failure in failures:
        print(" -", failure)
    sys.exit(1)

print("PHANTOMPLAY V14 STATIC VALIDATION: PASS")
for name in checks:
    print(" +", name)
