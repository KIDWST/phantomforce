"""Import a small CC0 Kenney foliage set for CubeTown's reference-matched opening frame."""
from __future__ import annotations

import json
import os

import unreal


PROJECT = os.path.abspath(unreal.Paths.project_dir())
SOURCE = os.path.join(PROJECT, "SourceArt", "External", "CC0", "KenneyNature", "Models", "OBJ format")
DESTINATION = "/Game/Phantom/External/KenneyNatureV26"
REPORT = os.path.join(os.path.abspath(unreal.Paths.project_saved_dir()), "CubeTownFoliageV26.json")
ASSETS = {
    "SM_CT26_PineRound": "tree_pineRoundB.obj",
    "SM_CT26_PineTall": "tree_pineTallA_detailed.obj",
    "SM_CT26_Oak": "tree_oak.obj",
    "SM_CT26_StoneBridge": "bridge_stoneRound.obj",
}


def import_task(alias: str, filename: str) -> unreal.AssetImportTask:
    source = os.path.join(SOURCE, filename)
    if not os.path.isfile(source):
        raise RuntimeError("Missing CC0 Kenney foliage source: " + source)
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
    # Kenney's OBJ set is Y-up. Convert it once at import so runtime scaling and collision use Z.
    static_options.set_editor_property("import_rotation", unreal.Rotator(roll=90.0, pitch=0.0, yaw=0.0))

    task = unreal.AssetImportTask()
    task.set_editor_property("filename", source)
    task.set_editor_property("destination_path", DESTINATION)
    task.set_editor_property("destination_name", alias)
    task.set_editor_property("automated", True)
    task.set_editor_property("replace_existing", True)
    task.set_editor_property("save", True)
    task.set_editor_property("options", options)
    return task


tasks = [import_task(alias, filename) for alias, filename in ASSETS.items()]
unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks(tasks)

result = {"schema": 26, "license": "CC0", "destination": DESTINATION, "assets": {}}
failures = []
for alias in ASSETS:
    asset_path = f"{DESTINATION}/{alias}"
    asset = unreal.EditorAssetLibrary.load_asset(asset_path)
    if not isinstance(asset, unreal.StaticMesh):
        failures.append(alias + ":missing-static-mesh")
        continue
    extent = asset.get_bounds().box_extent
    size = [round(float(extent.x) * 2.0, 2), round(float(extent.y) * 2.0, 2), round(float(extent.z) * 2.0, 2)]
    materials = [
        slot.material_interface.get_path_name() if slot.material_interface else ""
        for slot in asset.get_editor_property("static_materials")
    ]
    if max(size) < 80.0 or max(size) > 5000.0:
        failures.append(f"{alias}:bad-bounds:{size}")
    if not materials or any((not material or "WorldGridMaterial" in material) for material in materials):
        failures.append(f"{alias}:bad-materials:{materials}")
    result["assets"][alias] = {"path": asset_path, "bounds_size": size, "materials": materials}

result["status"] = "FAIL" if failures else "PASS"
result["failures"] = failures
with open(REPORT, "w", encoding="utf-8") as handle:
    json.dump(result, handle, indent=2)
if failures:
    raise RuntimeError("CubeTown foliage V26 import failed: " + " | ".join(failures))
unreal.EditorAssetLibrary.save_directory(DESTINATION, only_if_is_dirty=False, recursive=True)
unreal.log("CUBETOWN FOLIAGE V26 IMPORT PASS " + json.dumps(result, separators=(",", ":")))
