"""Import the CC0 Quaternius golden knight as CubeTown's authored lair guardian.

The source OBJ preserves five authored color materials (gold armor, black plate, crimson detail,
red cloth, and skin). Importing it at centimeter scale avoids the untextured generated proxy that
previously read as a giant primitive in the playable proof frame.
"""
from __future__ import annotations

import json
import os

import unreal


PROJECT = os.path.abspath(unreal.Paths.project_dir())
SOURCE = os.path.join(
    PROJECT,
    "SourceArt", "External", "CC0", "AnimatedCharacters",
    "Ultimate Animated Character Pack - Nov 2019", "OBJ", "Knight_Golden_Male.obj",
)
DESTINATION = "/Game/Phantom/External/Quaternius/CubeTownGuardianV25"
ALIAS = "SM_CT25_RiftGuardian"
REPORT = os.path.join(os.path.abspath(unreal.Paths.project_saved_dir()), "CubeTownGuardianV25.json")

if not os.path.isfile(SOURCE):
    raise RuntimeError("Missing licensed guardian source: " + SOURCE)

options = unreal.FbxImportUI()
options.set_editor_property("import_mesh", True)
options.set_editor_property("import_as_skeletal", False)
options.set_editor_property("import_animations", False)
options.set_editor_property("import_materials", True)
options.set_editor_property("import_textures", False)
options.set_editor_property("mesh_type_to_import", unreal.FBXImportType.FBXIT_STATIC_MESH)
static_options = options.get_editor_property("static_mesh_import_data")
static_options.set_editor_property("combine_meshes", True)
static_options.set_editor_property("generate_lightmap_u_vs", True)
static_options.set_editor_property("auto_generate_collision", True)
static_options.set_editor_property("import_uniform_scale", 100.0)
static_options.set_editor_property("import_rotation", unreal.Rotator(roll=90.0, pitch=0.0, yaw=0.0))

task = unreal.AssetImportTask()
task.set_editor_property("filename", SOURCE)
task.set_editor_property("destination_path", DESTINATION)
task.set_editor_property("destination_name", ALIAS)
task.set_editor_property("automated", True)
task.set_editor_property("replace_existing", True)
task.set_editor_property("save", True)
task.set_editor_property("options", options)
unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])

asset_path = f"{DESTINATION}/{ALIAS}"
asset = unreal.EditorAssetLibrary.load_asset(asset_path)
failures = []
if not isinstance(asset, unreal.StaticMesh):
    failures.append("guardian static mesh missing")
    size = []
    materials = []
else:
    bounds = asset.get_bounds().box_extent
    size = [round(float(bounds.x) * 2.0, 2), round(float(bounds.y) * 2.0, 2), round(float(bounds.z) * 2.0, 2)]
    materials = [
        slot.material_interface.get_path_name() if slot.material_interface else ""
        for slot in asset.get_editor_property("static_materials")
    ]
    if max(size) < 100.0 or max(size) > 1200.0:
        failures.append(f"guardian bounds outside production range: {size}")
    if len(materials) < 4 or any((not material or "WorldGridMaterial" in material) for material in materials):
        failures.append(f"guardian authored materials missing: {materials}")

result = {
    "schema": 25,
    "status": "FAIL" if failures else "PASS",
    "license": "CC0",
    "asset": asset_path,
    "bounds_size": size,
    "materials": materials,
    "failures": failures,
}
with open(REPORT, "w", encoding="utf-8") as handle:
    json.dump(result, handle, indent=2)
if failures:
    raise RuntimeError("CubeTown guardian import gate failed: " + " | ".join(failures))
unreal.EditorAssetLibrary.save_directory(DESTINATION, only_if_is_dirty=False, recursive=True)
unreal.log("CUBETOWN GUARDIAN V25 IMPORT PASS " + json.dumps(result, separators=(",", ":")))
