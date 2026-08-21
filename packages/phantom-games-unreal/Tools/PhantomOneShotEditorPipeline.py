"""PhantomPlay four-game one-shot Unreal content pipeline.

One UnrealEditor-Cmd process performs every import, validates real skeletal/PBR production content,
then builds and audits the four persistent worlds. A failed production-content gate aborts before cook.
"""
import json, os, runpy, traceback, unreal
root = os.path.abspath(unreal.Paths.project_dir())
tools = os.path.join(root, "Tools")
steps = [
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
    # Normalize recovered V17 roughness samplers before Shipping cook.
    "RepairCubeTownV17Materials.py",
    # V17 is additive after the shared portfolio pass. It uses committed Unreal assets and
    # remains reproducible without the missing external SourceArt directory.
    "PatchCubeTownV17Diorama.py",
    # V19 adds the Operation Nightglass route, breach, uplink, and extraction detail on top of V18R1.
    "PatchPhantomStrikeV19.py",
    "ValidateProductionWorlds.py",
]
log=[]
generated_source = os.path.join(root, "SourceArt", "GeneratedGLB")
generated_content = os.path.join(root, "Content", "Phantom", "Generated")
if os.path.isdir(generated_source) and any(name.lower().endswith(".glb") for _, _, names in os.walk(generated_source) for name in names):
    steps.insert(0, "ImportOverhaulAssets.py")
else:
    # The recovered production branch contains the cooked-editor .uasset library in Git LFS,
    # but the abandoned workstation-only GLB source directory was never committed. Preserve
    # those verified assets and continue with the current CC0/character/world pipeline.
    has_generated_assets = os.path.isdir(generated_content) and any(
        name.lower().endswith(".uasset") for _, _, names in os.walk(generated_content) for name in names
    )
    if not has_generated_assets:
        raise RuntimeError("Generated art has neither source GLBs nor committed Unreal assets.")
    log.append("PASS committed Unreal generated-art library (source GLBs unavailable)")
    unreal.log_warning("PHANTOM: SourceArt/GeneratedGLB is unavailable; preserving the committed Git LFS Unreal asset library.")

if os.environ.get("PHANTOM_ONE_SHOT_RESUME") == "1":
    saved = unreal.Paths.project_saved_dir()
    retained_reports = [
        ("PhantomProductionCharactersV11.json", "production characters"),
        ("PhantomPolyHavenMaterialImportV11.json", "Poly Haven materials"),
    ]
    for filename, label in retained_reports:
        report_path = os.path.join(saved, filename)
        if not os.path.isfile(report_path):
            raise RuntimeError("Cannot resume: required %s report is missing: %s" % (label, report_path))
        with open(report_path, "r", encoding="utf-8") as handle:
            report = json.load(handle)
        if report.get("status") != "PASS":
            raise RuntimeError("Cannot resume: retained %s report did not pass." % label)
        log.append("PASS retained %s report" % label)
    resume_at = steps.index("ImportUnityBaselineAssets.py")
    steps = steps[resume_at:]
    unreal.log_warning("PHANTOM: Resuming one-shot after verified character/material reports with a headless RHI.")
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
