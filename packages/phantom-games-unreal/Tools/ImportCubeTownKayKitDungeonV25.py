"""Import the verified CC0 KayKit Dungeon kit at Unreal's centimeter scale.

The generic CC0 importer treated meter-authored GLB geometry as centimeters, leaving several
compatibility aliases roughly 100x too small. CubeTown's reference lair uses this dedicated OBJ
import so the original materials remain intact and every asset arrives at playable world scale.
"""
from __future__ import annotations

import json
import os

import unreal


PROJECT = os.path.abspath(unreal.Paths.project_dir())
SOURCE = os.path.join(
    PROJECT,
    "SourceArt", "External", "CC0", "KayKitDungeon",
    "KayKit-Dungeon-Remastered-1.0-main", "addons", "kaykit_dungeon_remastered",
    "Assets", "obj",
)
DESTINATION = "/Game/Phantom/External/KayKitDungeonV25"
REPORT = os.path.join(os.path.abspath(unreal.Paths.project_saved_dir()), "CubeTownKayKitDungeonV25.json")

ASSETS = {
    "SM_KKD_FloorLarge": "floor_tile_large.obj",
    "SM_KKD_FloorBroken": "floor_tile_large_rocks.obj",
    "SM_KKD_Wall": "wall.obj",
    "SM_KKD_WallBroken": "wall_broken.obj",
    "SM_KKD_WallGated": "wall_gated.obj",
    "SM_KKD_Doorway": "wall_doorway.obj",
    "SM_KKD_PillarDecorated": "pillar_decorated.obj",
    "SM_KKD_Chest": "chest.obj",
    "SM_KKD_ChestGold": "chest_gold.obj",
    "SM_KKD_TorchLit": "torch_lit.obj",
    "SM_KKD_BannerRed": "banner_patternA_red.obj",
    "SM_KKD_BannerBlue": "banner_patternA_blue.obj",
    "SM_KKD_Crates": "crates_stacked.obj",
    "SM_KKD_Barrier": "barrier.obj",
    "SM_KKD_Rubble": "rubble_large.obj",
    "SM_KKD_Stairs": "stairs_wide.obj",
    "SM_KKD_Spikes": "spikes.obj",
}


def make_task(alias: str, filename: str) -> unreal.AssetImportTask:
    source = os.path.join(SOURCE, filename)
    if not os.path.isfile(source):
        raise RuntimeError("Missing licensed KayKit Dungeon source: " + source)

    options = unreal.FbxImportUI()
    options.set_editor_property("import_mesh", True)
    options.set_editor_property("import_as_skeletal", False)
    options.set_editor_property("import_animations", False)
    options.set_editor_property("import_materials", True)
    options.set_editor_property("import_textures", True)
    options.set_editor_property("mesh_type_to_import", unreal.FBXImportType.FBXIT_STATIC_MESH)
    static_options = options.get_editor_property("static_mesh_import_data")
    static_options.set_editor_property("combine_meshes", True)
    static_options.set_editor_property("generate_lightmap_u_vs", True)
    static_options.set_editor_property("auto_generate_collision", True)
    static_options.set_editor_property("import_uniform_scale", 100.0)

    task = unreal.AssetImportTask()
    task.set_editor_property("filename", source)
    task.set_editor_property("destination_path", DESTINATION)
    task.set_editor_property("destination_name", alias)
    task.set_editor_property("automated", True)
    task.set_editor_property("replace_existing", True)
    task.set_editor_property("save", True)
    task.set_editor_property("options", options)
    return task


tasks = [make_task(alias, filename) for alias, filename in ASSETS.items()]
unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks(tasks)

result = {"schema": 25, "license": "CC0", "destination": DESTINATION, "assets": {}}
failures = []
for alias, task in zip(ASSETS, tasks):
    asset_path = f"{DESTINATION}/{alias}"
    asset = unreal.EditorAssetLibrary.load_asset(asset_path)
    if not isinstance(asset, unreal.StaticMesh):
        failures.append(alias)
        continue
    bounds = asset.get_bounds().box_extent
    size = [round(float(bounds.x) * 2.0, 2), round(float(bounds.y) * 2.0, 2), round(float(bounds.z) * 2.0, 2)]
    if max(size) < 40.0 or max(size) > 2500.0:
        failures.append(f"{alias}:bad-bounds:{size}")
    materials = [
        slot.material_interface.get_path_name() if slot.material_interface else ""
        for slot in asset.get_editor_property("static_materials")
    ]
    if not materials or any("WorldGridMaterial" in material for material in materials):
        failures.append(f"{alias}:bad-materials:{materials}")
    result["assets"][alias] = {"path": asset_path, "bounds_size": size, "materials": materials}

result["status"] = "FAIL" if failures else "PASS"
result["failures"] = failures
with open(REPORT, "w", encoding="utf-8") as handle:
    json.dump(result, handle, indent=2)
if failures:
    raise RuntimeError("CubeTown KayKit Dungeon V25 import gate failed: " + " | ".join(failures))
unreal.EditorAssetLibrary.save_directory(DESTINATION, only_if_is_dirty=False, recursive=True)
unreal.log("CUBETOWN KAYKIT DUNGEON V25 IMPORT PASS " + json.dumps(result, separators=(",", ":")))
