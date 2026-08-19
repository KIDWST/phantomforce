"""Repair recovered CubeTown V17 roughness samplers for Shipping cook.

The abandoned V17 import scripts disabled sRGB on roughness textures but left their material
expressions at Color. Unreal's Shipping cook correctly rejects that mismatch. This migration fixes
the committed Git LFS material assets without requiring the missing workstation-only source TGAs.
"""
from __future__ import annotations

import json
import os
import traceback

import unreal


SAVED = os.path.abspath(unreal.Paths.project_saved_dir())
DEST = "/Game/Phantom/Generated/Cubetown/V17/Materials"
REPORT = os.path.join(SAVED, "CubeTownV17MaterialRepair.json")
CORE_ROLES = [
    "HeartstoneGrass", "HeartstonePath", "HeartstoneCobble", "HeartstoneWood",
    "CrimsonSoil", "CrimsonMoss", "FrostRock", "FrostSnow",
    "EmberSoil", "MoonmossMud", "SunpetalSand", "StarfallGrass",
    "CrownStone", "RuinsStone", "DungeonTile", "MagicCyan",
]

mel = unreal.MaterialEditingLibrary
result = {"revision": "V18R1", "status": "RUNNING", "repaired": [], "failures": []}

try:
    for role in CORE_ROLES:
        path = f"{DEST}/M_CT17_{role}"
        material = unreal.load_asset(path)
        if not material:
            result["failures"].append(f"missing material {path}")
            continue
        node = mel.get_material_property_input_node(material, unreal.MaterialProperty.MP_ROUGHNESS)
        if not node or not isinstance(node, unreal.MaterialExpressionTextureSample):
            result["failures"].append(f"roughness texture sample missing {path}")
            continue
        texture = node.get_editor_property("texture")
        if texture:
            texture.set_editor_property("srgb", False)
            unreal.EditorAssetLibrary.save_loaded_asset(texture, only_if_is_dirty=False)
        node.set_editor_property("sampler_type", unreal.MaterialSamplerType.SAMPLERTYPE_LINEAR_COLOR)
        mel.recompile_material(material)
        unreal.EditorAssetLibrary.save_loaded_asset(material, only_if_is_dirty=False)
        result["repaired"].append(path)

    if result["failures"] or len(result["repaired"]) != len(CORE_ROLES):
        raise RuntimeError("CubeTown V17 material repair was incomplete: " + " | ".join(result["failures"]))
    result["status"] = "PASS"
except Exception as exc:
    result["status"] = "FAIL"
    result["error"] = str(exc)
    result["traceback"] = traceback.format_exc()
    unreal.log_error("CUBETOWN V17 MATERIAL REPAIR FAILED: " + str(exc))
    raise
finally:
    with open(REPORT, "w", encoding="utf-8") as handle:
        json.dump(result, handle, indent=2)

unreal.log("CUBETOWN V17 MATERIAL REPAIR PASS: %d materials" % len(result["repaired"]))
