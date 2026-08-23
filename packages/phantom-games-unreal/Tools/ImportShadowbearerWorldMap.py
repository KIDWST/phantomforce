"""Import the user-approved Shadowbearer world map as a packaged Unreal UI texture.

Run inside Unreal Editor Python. The original PNG remains in SourceArt and the Art Bible;
this importer creates the cookable /Game asset consumed by the M-key world-map overlay.
"""
from __future__ import annotations

import json
import os
import traceback

import unreal


PROJECT = os.path.abspath(unreal.Paths.project_dir())
SAVED = os.path.abspath(unreal.Paths.project_saved_dir())
SOURCE = os.path.join(
    PROJECT,
    "Docs",
    "Shadowbearer",
    "ArtBible",
    "Shadowbearer_WorldMap_Canonical.png",
)
DESTINATION = "/Game/Phantom/VisualTargets"
ASSET_NAME = "Shadowbearer_WorldMap_Canonical"
ASSET_PATH = f"{DESTINATION}/{ASSET_NAME}"
REPORT = os.path.join(SAVED, "ShadowbearerWorldMapImport.json")


result = {
    "status": "RUNNING",
    "source": SOURCE,
    "asset": ASSET_PATH,
}

try:
    if not os.path.isfile(SOURCE):
        raise RuntimeError("Missing canonical Shadowbearer world map: " + SOURCE)

    unreal.EditorAssetLibrary.make_directory(DESTINATION)
    task = unreal.AssetImportTask()
    task.filename = SOURCE
    task.destination_path = DESTINATION
    task.destination_name = ASSET_NAME
    task.automated = True
    task.replace_existing = True
    task.save = True
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])

    texture = unreal.EditorAssetLibrary.load_asset(ASSET_PATH)
    if not texture:
        raise RuntimeError("World-map texture import failed: " + ASSET_PATH)

    # Preserve small cartographic labels in packaged builds instead of streaming a soft mip.
    texture.set_editor_property("srgb", True)
    texture.set_editor_property("never_stream", True)
    texture.set_editor_property("lod_group", unreal.TextureGroup.TEXTUREGROUP_UI)
    texture.set_editor_property("filter", unreal.TextureFilter.TF_TRILINEAR)
    unreal.EditorAssetLibrary.save_loaded_asset(texture, only_if_is_dirty=False)

    result.update(
        status="PASS",
        width=texture.blueprint_get_size_x(),
        height=texture.blueprint_get_size_y(),
    )
    unreal.log("SHADOWBEARER WORLD MAP IMPORT PASS: " + ASSET_PATH)
except Exception as exc:
    result.update(
        status="FAIL",
        error=str(exc),
        traceback=traceback.format_exc(),
    )
    unreal.log_error("SHADOWBEARER WORLD MAP IMPORT FAILED: " + str(exc))
    raise
finally:
    with open(REPORT, "w", encoding="utf-8") as handle:
        json.dump(result, handle, indent=2)
