"""PhantomPlay four-game one-shot Unreal content pipeline.

One UnrealEditor-Cmd process performs every import, validates real skeletal/PBR production content,
then builds and audits the four persistent worlds. A failed production-content gate aborts before cook.
"""
import os, runpy, traceback, unreal
root = os.path.abspath(unreal.Paths.project_dir())
tools = os.path.join(root, "Tools")
steps = [
    "ImportOverhaulAssets.py",
    "ImportExternalCC0Assets.py",
    "ImportProductionCharacters.py",
    "ImportPolyHavenProduction.py",
    "ImportUnityBaselineAssets.py",
    "HarvestOwnedFabAssets.py",
    "BuildProductionWorlds.py",
    # Portfolio rule: every rebuild advances all four native PhantomPlay games.
    # V11R7 carries the current shared CubeTown + Legends world-authorship layer.
    "PatchProductionWorldsV11R7.py",
    # V11R10 carries the current Ages + Strike first-frame/combat-space layer.
    "PatchProductionWorldsV11R10.py",
    # V12 is additive on top of the CubeTown V11R7 route pass.
    "PatchCubetownFlagshipV12.py",
    # V13 is the first true four-game visual-density and rejected-alias safety layer.
    "PatchPortfolioWorldsV13.py",
    "ValidateProductionWorlds.py",
]
log=[]
for name in steps:
    path=os.path.join(tools,name)
    if not os.path.isfile(path):
        raise RuntimeError("Required V11 one-shot step is missing: %s" % path)
    unreal.log("PHANTOM V11 ONE-SHOT PIPELINE: %s" % name)
    try:
        runpy.run_path(path, run_name="__main__")
        log.append("PASS %s" % name)
    except Exception as exc:
        log.append("FAIL %s: %s" % (name,exc))
        out=os.path.join(unreal.Paths.project_saved_dir(),"PhantomOneShotEditorPipelineV11.txt")
        with open(out,"w",encoding="utf-8") as f: f.write("\n".join(log)+"\n\n"+traceback.format_exc())
        raise
try:
    unreal.EditorLoadingAndSavingUtils.save_dirty_packages(True, True)
except Exception:
    pass
out=os.path.join(unreal.Paths.project_saved_dir(),"PhantomOneShotEditorPipelineV11.txt")
with open(out,"w",encoding="utf-8") as f: f.write("\n".join(log)+"\n")
unreal.log("PHANTOM FOUR-GAME ONE-SHOT COMPLETE: " + " | ".join(log))
