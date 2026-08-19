"""CubeTown V17 full 10GB 4K art import. Run only when you want the complete material library in Content."""
from __future__ import annotations
import json, os, traceback
import unreal

PROJECT=os.path.abspath(unreal.Paths.project_dir())
SAVED=os.path.abspath(unreal.Paths.project_saved_dir())
ROOT=os.path.join(PROJECT,"SourceArt","CubetownV17","4K")
DEST="/Game/Phantom/Generated/Cubetown/V17/Materials"
REPORT=os.path.join(SAVED,"CubeTownV17FullArtImport.json")
ROLES=['HeartstoneGrass', 'HeartstonePath', 'HeartstoneCobble', 'HeartstoneRoof', 'HeartstonePlaster', 'HeartstoneWood', 'CrimsonLeaves', 'CrimsonBark', 'CrimsonSoil', 'CrimsonMoss', 'FrostGrass', 'FrostRock', 'FrostSnow', 'FrostIce', 'EmberGrass', 'EmberRock', 'EmberSoil', 'EmberGlow', 'MoonmossGrass', 'MoonmossMud', 'MoonmossWater', 'MoonmossMushroom', 'SunpetalGrass', 'SunpetalSand', 'SunpetalWater', 'SunpetalFlower', 'StarfallGrass', 'StarfallRock', 'StarfallCrystal', 'CrownGrass', 'CrownStone', 'CrownMarble', 'CrownGold', 'RuinsStone', 'RuinsMoss', 'RuinsTile', 'CaveRock', 'CaveMoss', 'CaveCrystal', 'DungeonStone', 'DungeonTile', 'DungeonRune', 'BridgeWood', 'BridgeRope', 'PotteryClay', 'FabricRed', 'FabricBlue', 'FabricGold', 'MagicCyan', 'MagicViolet', 'MagicRose', 'MagicGold', 'NightSky', 'CloudSoft']
asset_tools=unreal.AssetToolsHelpers.get_asset_tools(); MEL=unreal.MaterialEditingLibrary

def load(path):
    try:return unreal.load_asset(path)
    except Exception:return None

def tex(role,kind):
    src=os.path.join(ROOT,role,kind+".tga")
    if not os.path.isfile(src):raise RuntimeError("Missing "+src)
    dest=f"{DEST}/Textures/{role}";unreal.EditorAssetLibrary.make_directory(dest)
    task=unreal.AssetImportTask();task.filename=src;task.destination_path=dest;task.destination_name=f"T_CT17_{role}_{kind}";task.automated=True;task.replace_existing=True;task.save=True
    asset_tools.import_asset_tasks([task]);t=load(f"{dest}/T_CT17_{role}_{kind}")
    if not t:raise RuntimeError(f"Import failed {role}/{kind}")
    try:
        if kind=="Normal":t.set_editor_property("srgb",False);t.set_editor_property("compression_settings",unreal.TextureCompressionSettings.TC_NORMALMAP)
        elif kind in ("Roughness","Detail"):t.set_editor_property("srgb",False)
        unreal.EditorAssetLibrary.save_loaded_asset(t,only_if_is_dirty=False)
    except Exception:pass
    return t

def material(role,t):
    unreal.EditorAssetLibrary.make_directory(DEST);path=f"{DEST}/M_CT17_{role}"
    if unreal.EditorAssetLibrary.does_asset_exist(path):unreal.EditorAssetLibrary.delete_asset(path)
    m=asset_tools.create_asset(f"M_CT17_{role}",DEST,unreal.Material,unreal.MaterialFactoryNew())
    if not m:raise RuntimeError("material create failed "+role)
    b=MEL.create_material_expression(m,unreal.MaterialExpressionTextureSample,-620,-120);b.texture=t["BaseColor"];MEL.connect_material_property(b,"RGB",unreal.MaterialProperty.MP_BASE_COLOR)
    n=MEL.create_material_expression(m,unreal.MaterialExpressionTextureSample,-620,100);n.texture=t["Normal"]
    try:n.sampler_type=unreal.MaterialSamplerType.SAMPLERTYPE_NORMAL
    except Exception:pass
    MEL.connect_material_property(n,"RGB",unreal.MaterialProperty.MP_NORMAL)
    r=MEL.create_material_expression(m,unreal.MaterialExpressionTextureSample,-620,300);r.texture=t["Roughness"]
    try:r.sampler_type=unreal.MaterialSamplerType.SAMPLERTYPE_LINEAR_COLOR
    except Exception:pass
    MEL.connect_material_property(r,"R",unreal.MaterialProperty.MP_ROUGHNESS)
    c=MEL.create_material_expression(m,unreal.MaterialExpressionConstant,-360,390);c.r=.22;MEL.connect_material_property(c,"",unreal.MaterialProperty.MP_SPECULAR)
    MEL.recompile_material(m);unreal.EditorAssetLibrary.save_asset(path,only_if_is_dirty=False);return path

res={"revision":"V17","status":"RUNNING","roles":{}}
try:
    for role in ROLES:
        t={k:tex(role,k) for k in ("BaseColor","Normal","Roughness","Detail")}
        res["roles"][role]=material(role,t)
    res["status"]="PASS"
except Exception as e:
    res["status"]="FAIL";res["error"]=str(e);res["traceback"]=traceback.format_exc();unreal.log_error("CUBETOWN V17 FULL ART IMPORT FAILED: "+str(e));raise
finally:
    with open(REPORT,"w",encoding="utf-8") as f:json.dump(res,f,indent=2)
unreal.log("CUBETOWN V17 FULL 10GB ART IMPORT PASS")
