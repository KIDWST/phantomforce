"""CubeTown V17: import the core 4K diorama material library and build Unreal materials.
Runs inside Unreal Editor Python. The full 10GB source library stays in SourceArt; the fast
installer imports only the surfaces actually used by the V17 persistent-world pass.
"""
from __future__ import annotations
import json, os, traceback
import unreal

PROJECT = os.path.abspath(unreal.Paths.project_dir())
SAVED = os.path.abspath(unreal.Paths.project_saved_dir())
ROOT = os.path.join(PROJECT, "SourceArt", "CubetownV17", "4K")
DEST = "/Game/Phantom/Generated/Cubetown/V17/Materials"
REPORT = os.path.join(SAVED, "CubetownV17CoreArtImport.json")

CORE_ROLES = [
    "HeartstoneGrass", "HeartstonePath", "HeartstoneCobble", "HeartstoneWood",
    "CrimsonSoil", "CrimsonMoss", "FrostRock", "FrostSnow",
    "EmberSoil", "MoonmossMud", "SunpetalSand", "StarfallGrass",
    "CrownStone", "RuinsStone", "DungeonTile", "MagicCyan",
]

asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
mel = unreal.MaterialEditingLibrary


def load(path):
    try:
        return unreal.load_asset(path)
    except Exception:
        return None


def import_tex(role: str, kind: str):
    source = os.path.join(ROOT, role, kind + ".tga")
    if not os.path.isfile(source):
        raise RuntimeError(f"Missing V17 source texture: {source}")
    dest = f"{DEST}/Textures/{role}"
    unreal.EditorAssetLibrary.make_directory(dest)
    task = unreal.AssetImportTask()
    task.filename = source
    task.destination_path = dest
    task.destination_name = f"T_CT17_{role}_{kind}"
    task.automated = True
    task.replace_existing = True
    task.save = True
    asset_tools.import_asset_tasks([task])
    tex = load(f"{dest}/T_CT17_{role}_{kind}")
    if not tex:
        raise RuntimeError(f"Import failed: {role}/{kind}")
    try:
        if kind == "Normal":
            tex.set_editor_property("srgb", False)
            tex.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_NORMALMAP)
        elif kind in ("Roughness", "Detail"):
            tex.set_editor_property("srgb", False)
        tex.modify()
    except Exception:
        pass
    unreal.EditorAssetLibrary.save_loaded_asset(tex, only_if_is_dirty=False)
    return tex


def make_material(role: str, textures: dict):
    unreal.EditorAssetLibrary.make_directory(DEST)
    path = f"{DEST}/M_CT17_{role}"
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        unreal.EditorAssetLibrary.delete_asset(path)
    mat = asset_tools.create_asset(f"M_CT17_{role}", DEST, unreal.Material, unreal.MaterialFactoryNew())
    if not mat:
        raise RuntimeError("Could not create " + path)

    base = mel.create_material_expression(mat, unreal.MaterialExpressionTextureSample, -620, -120)
    base.texture = textures["BaseColor"]
    mel.connect_material_property(base, "RGB", unreal.MaterialProperty.MP_BASE_COLOR)

    normal = mel.create_material_expression(mat, unreal.MaterialExpressionTextureSample, -620, 100)
    normal.texture = textures["Normal"]
    try:
        normal.sampler_type = unreal.MaterialSamplerType.SAMPLERTYPE_NORMAL
    except Exception:
        pass
    mel.connect_material_property(normal, "RGB", unreal.MaterialProperty.MP_NORMAL)

    rough = mel.create_material_expression(mat, unreal.MaterialExpressionTextureSample, -620, 300)
    rough.texture = textures["Roughness"]
    try:
        rough.sampler_type = unreal.MaterialSamplerType.SAMPLERTYPE_LINEAR_COLOR
    except Exception:
        pass
    mel.connect_material_property(rough, "R", unreal.MaterialProperty.MP_ROUGHNESS)

    spec = mel.create_material_expression(mat, unreal.MaterialExpressionConstant, -360, 390)
    spec.r = 0.22
    mel.connect_material_property(spec, "", unreal.MaterialProperty.MP_SPECULAR)

    mel.recompile_material(mat)
    unreal.EditorAssetLibrary.save_asset(path, only_if_is_dirty=False)
    return path


results = {"revision": "V17", "status": "RUNNING", "materials": {}}
try:
    for role in CORE_ROLES:
        tex = {kind: import_tex(role, kind) for kind in ("BaseColor", "Normal", "Roughness", "Detail")}
        results["materials"][role] = make_material(role, tex)
    results["status"] = "PASS"
except Exception as exc:
    results["status"] = "FAIL"
    results["error"] = str(exc)
    results["traceback"] = traceback.format_exc()
    unreal.log_error("CUBETOWN V17 CORE ART IMPORT FAILED: " + str(exc))
    raise
finally:
    with open(REPORT, "w", encoding="utf-8") as handle:
        json.dump(results, handle, indent=2)

unreal.log("CUBETOWN V17 CORE ART IMPORT PASS")
