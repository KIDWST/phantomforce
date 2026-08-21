"""Targeted V22 material/world repair after a verified source-surface refresh."""
import os
import runpy
import unreal

root = os.path.abspath(unreal.Paths.project_dir())
tools = os.path.join(root, "Tools")
steps = (
    "ImportPolyHavenProduction.py",
    "PatchPortfolioWorldsV21.py",
    "PatchPortfolioWorldsV22.py",
    "ValidateProductionWorlds.py",
)
log = []
for name in steps:
    unreal.log("PHANTOM V22 TARGETED MATERIAL CORRECTION: " + name)
    runpy.run_path(os.path.join(tools, name), run_name="__main__")
    log.append("PASS " + name)
try:
    unreal.EditorLoadingAndSavingUtils.save_dirty_packages(True, True)
except Exception:
    pass
with open(os.path.join(unreal.Paths.project_saved_dir(), "PhantomV22MaterialCorrection.txt"), "w", encoding="utf-8") as handle:
    handle.write("\n".join(log) + "\n")
unreal.log("PHANTOM V22 TARGETED MATERIAL CORRECTION COMPLETE: " + " | ".join(log))
