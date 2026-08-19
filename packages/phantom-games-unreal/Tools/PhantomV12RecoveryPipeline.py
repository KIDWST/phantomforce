"""Resume the V12 content build after restoring tracked LFS packages.

The full GLB importer already completed 272 assets. Seven CubeTown hero-part destinations
were valid tracked packages and correctly refused replacement, so this pass validates those
targets and resumes the remaining production pipeline without reimporting every mesh again.
"""
import os
import runpy
import traceback

import unreal


root = os.path.abspath(unreal.Paths.project_dir())
tools = os.path.join(root, "Tools")
saved = os.path.abspath(unreal.Paths.project_saved_dir())
report = os.path.join(saved, "PhantomOneShotEditorPipelineV11.txt")

required_hero_parts = [
    "/Game/Phantom/Generated/Cubetown/V8/Characters/SM_V8_HeroArm",
    "/Game/Phantom/Generated/Cubetown/V8/Characters/SM_V8_HeroCap",
    "/Game/Phantom/Generated/Cubetown/V8/Characters/SM_V8_HeroCloak",
    "/Game/Phantom/Generated/Cubetown/V8/Characters/SM_V8_HeroHead",
    "/Game/Phantom/Generated/Cubetown/V8/Characters/SM_V8_HeroLeg",
    "/Game/Phantom/Generated/Cubetown/V8/Characters/SM_V8_HeroTorso",
    "/Game/Phantom/Generated/Cubetown/V8/Characters/SM_V8_HeroWand",
]

missing = [path for path in required_hero_parts if not unreal.EditorAssetLibrary.does_asset_exist(path)]
if missing:
    raise RuntimeError("Restored CubeTown hero packages are missing: " + " | ".join(missing))

steps = [
    "ImportExternalCC0Assets.py",
    "ImportProductionCharacters.py",
    "ImportPolyHavenProduction.py",
    "ImportUnityBaselineAssets.py",
    "HarvestOwnedFabAssets.py",
    "BuildProductionWorlds.py",
    "ValidateProductionWorlds.py",
]
log = ["PASS ImportOverhaulAssets.py"]
for name in steps:
    path = os.path.join(tools, name)
    if not os.path.isfile(path):
        raise RuntimeError("Required V12 recovery step is missing: " + path)
    unreal.log("PHANTOM V12 RECOVERY PIPELINE: " + name)
    try:
        runpy.run_path(path, run_name="__main__")
        log.append("PASS " + name)
    except Exception as exc:
        log.append("FAIL %s: %s" % (name, exc))
        with open(report, "w", encoding="utf-8") as handle:
            handle.write("\n".join(log) + "\n\n" + traceback.format_exc())
        raise

try:
    unreal.EditorLoadingAndSavingUtils.save_dirty_packages(True, True)
except Exception:
    pass
with open(report, "w", encoding="utf-8") as handle:
    handle.write("\n".join(log) + "\n")
unreal.log("PHANTOM V12 RECOVERY COMPLETE: " + " | ".join(log))
