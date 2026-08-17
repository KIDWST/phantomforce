"""Harvest already-imported owned Fab/Quixel/Marketplace StaticMeshes into Phantom curated aliases.

This script NEVER authenticates, scrapes Fab, purchases content, exports browser cookies, or reaches the
network. It only scans assets already present inside the current Unreal project and promotes clearly
better semantic matches into stable /Game/Phantom/Curated/Fab aliases. The CC0 curated library remains
the deterministic baseline if no owned Fab content has been imported yet.
"""
import os
import unreal

REPORT = os.path.abspath(os.path.join(unreal.Paths.project_saved_dir(), "PhantomOwnedFabHarvest.txt"))
DEST = "/Game/Phantom/Curated/Fab"
EXCLUDED = (
    "/Game/Phantom/Generated/", "/Game/Phantom/External/", "/Game/Phantom/Curated/",
)
SOURCE_HINTS = (
    "megascans", "quixel", "fab", "marketplace", "medieval", "darkruin", "dark_ruin",
    "village", "paragon", "infinityblade", "infinity_blade", "citysample", "city_sample",
    # 2026 target-pack naming observed in current Fab searches / likely imported package roots.
    "emerald", "haven", "toony", "rts", "military", "mout", "warzone", "urban",
    "castle", "fortress", "siege", "fantasy", "stylized", "mediterranean", "megapack",
)

def text(x):
    try: return str(x).lower()
    except Exception: return ""

def get_assets():
    reg = unreal.AssetRegistryHelpers.get_asset_registry()
    try:
        cls = unreal.TopLevelAssetPath("/Script/Engine", "StaticMesh")
        return list(reg.get_assets_by_class(cls, True))
    except Exception:
        try: return list(reg.get_assets_by_class("StaticMesh", True))
        except Exception: return []

def package_path(data):
    try: return str(data.package_name)
    except Exception: return ""

def score_asset(data, positives, context):
    p = package_path(data)
    blob = (p + " " + text(getattr(data,"asset_name",""))).lower()
    if any(p.startswith(x) for x in EXCLUDED): return -9999
    source_bonus = 25 if any(h in blob for h in SOURCE_HINTS) else 0
    if source_bonus == 0: return -9999
    score = source_bonus
    for kw,w in positives:
        if kw in blob: score += w
    for kw,w in context:
        if kw in blob: score += w
    # Avoid obvious non-environment debug/LOD/collision artifacts.
    for bad in ("collision","proxy","lod1","lod2","lod3","preview","test","dummy"):
        if bad in blob: score -= 20
    return score

def ensure_dir(path):
    try:
        if not unreal.EditorAssetLibrary.does_directory_exist(path):
            unreal.EditorAssetLibrary.make_directory(path)
    except Exception: pass

def duplicate_best(assets, rel_alias, positives, context=(), minimum=35):
    scored = sorted(((score_asset(a, positives, context), a) for a in assets), key=lambda x:x[0], reverse=True)
    if not scored or scored[0][0] < minimum:
        return None
    score,a = scored[0]
    src = package_path(a)
    folder,alias = rel_alias.rsplit("/",1)
    dst_dir = DEST + "/" + folder
    dst = dst_dir + "/" + alias
    ensure_dir(dst_dir)
    try:
        if unreal.EditorAssetLibrary.does_asset_exist(dst): unreal.EditorAssetLibrary.delete_asset(dst)
        if unreal.EditorAssetLibrary.duplicate_asset(src, dst):
            unreal.EditorAssetLibrary.save_asset(dst)
            return (dst,src,score)
    except Exception as exc:
        unreal.log_warning("Phantom Fab harvest duplicate failed %s <- %s: %s" % (dst,src,exc))
    return None

assets = get_assets()
results=[]
# We intentionally harvest only categories where a marketplace/scan asset is likely to be a visual
# upgrade. CubeTown remains stylized unless an owned asset explicitly says stylized/fantasy.
specs = [
    ("Legends/SM_Fab_Keep", [("castle",35),("keep",40),("fortress",35)], [("medieval",15),("fantasy",10)]),
    ("Legends/SM_Fab_Tower", [("tower",40),("turret",30)], [("medieval",15),("castle",15)]),
    ("Legends/SM_Fab_Wall", [("wall",35),("rampart",35)], [("medieval",15),("castle",15),("ruin",8)]),
    ("Legends/SM_Fab_Ruin", [("ruin",45),("broken",15),("arch",15)], [("medieval",10),("darkruin",25)]),
    ("Legends/SM_Fab_Barracks", [("barracks",45),("military",25),("garrison",30)], [("medieval",20),("fantasy",15),("rts",15)]),
    ("Legends/SM_Fab_Market", [("market",45),("stall",30),("merchant",20)], [("medieval",20),("village",15)]),
    ("Legends/SM_Fab_Mine", [("mine",45),("quarry",35),("ore",20)], [("medieval",10),("fantasy",10),("rock",10)]),
    ("Legends/SM_Fab_Windmill", [("windmill",50),("mill",35)], [("medieval",20),("village",15)]),
    ("Legends/SM_Fab_House", [("house",35),("cottage",30),("home",20)], [("medieval",20),("fantasy",15),("village",20)]),
    ("Legends/SM_Fab_Tree", [("tree",40),("forest",20)], [("fantasy",15),("megascans",15),("quixel",15)]),
    ("Ages/SM_Fab_Tower", [("tower",40),("castle",20)], [("medieval",20),("fortress",15)]),
    ("Ages/SM_Fab_Wall", [("wall",40),("rampart",30)], [("medieval",20),("castle",15)]),
    ("Ages/SM_Fab_Siege", [("siege",40),("catapult",45),("trebuchet",45),("ballista",45)], [("medieval",20)]),
    ("Strike/SM_Fab_Building", [("building",25),("facade",30),("shop",15),("hotel",15)], [("city",20),("urban",20)]),
    ("Strike/SM_Fab_Industrial", [("industrial",35),("warehouse",35),("factory",30)], [("city",10),("urban",10)]),
    ("Strike/SM_Fab_Rubble", [("rubble",45),("debris",40),("broken",15)], [("city",10),("concrete",15)]),
    ("Strike/SM_Fab_Rock", [("rock",40),("cliff",35)], [("megascans",25),("quixel",25)]),
    ("Strike/SM_Fab_StreetProp", [("barrier",30),("crate",25),("container",35),("street",20)], [("urban",20),("military",20),("mout",25)]),
    ("Cube/SM_Fab_StylizedHouse", [("house",30),("cottage",35),("tavern",20)], [("stylized",35),("fantasy",30)]),
    ("Cube/SM_Fab_StylizedTree", [("tree",35)], [("stylized",40),("fantasy",25),("red",10),("autumn",10)]),
    ("Cube/SM_Fab_StylizedRock", [("rock",30),("cliff",25)], [("stylized",40),("fantasy",20)]),
    ("Cube/SM_Fab_StylizedBridge", [("bridge",40)], [("stylized",30),("fantasy",25),("village",20)]),
    ("Cube/SM_Fab_StylizedCastle", [("castle",45),("keep",35),("palace",30)], [("stylized",35),("fantasy",30)]),
    ("Cube/SM_Fab_StylizedMarket", [("market",45),("stall",25),("pavilion",25)], [("stylized",30),("fantasy",25),("village",20)]),
    ("Cube/SM_Fab_StylizedRuin", [("ruin",45),("arch",25),("ancient",20)], [("stylized",30),("fantasy",25)]),
    ("Cube/SM_Fab_StylizedCliff", [("cliff",45),("rock",25),("waterfall",35)], [("stylized",25),("fantasy",20)]),
    ("Cube/SM_Fab_StylizedFlower", [("flower",45),("garden",30),("plant",20)], [("stylized",30),("fantasy",20)]),
    ("Legends/SM_Fab_Gate", [("gate",50),("gateway",40),("portcullis",30)], [("medieval",20),("castle",20),("fantasy",15)]),
    ("Legends/SM_Fab_Bridge", [("bridge",50)], [("medieval",15),("fantasy",15)]),
    ("Legends/SM_Fab_Farm", [("farm",45),("field",25),("crop",25)], [("medieval",15),("village",15)]),
    ("Legends/SM_Fab_Crystal", [("crystal",45),("mana",25),("gem",20)], [("fantasy",25),("rts",10)]),
    ("Strike/SM_Fab_Hotel", [("hotel",50),("apartment",30)], [("urban",20),("mediterranean",20)]),
    ("Strike/SM_Fab_Shop", [("shop",45),("store",35),("cafe",30)], [("urban",20),("mediterranean",20)]),
    ("Strike/SM_Fab_Barrier", [("barrier",50),("barricade",45),("concrete",20)], [("urban",15),("military",20),("mout",20)]),
]
for rel,pos,ctx in specs:
    r=duplicate_best(assets,rel,pos,ctx)
    if r: results.append(r)

try:
    os.makedirs(os.path.dirname(REPORT), exist_ok=True)
    with open(REPORT,"w",encoding="utf-8") as f:
        f.write("PHANTOM OWNED FAB / QUIXEL HARVEST\n")
        f.write("Scans only assets already imported into this project. No credentials/network used.\n")
        f.write("static_mesh_candidates=%d\n" % len(assets))
        f.write("harvested=%d\n\n" % len(results))
        for dst,src,score in results:
            f.write("%s <- %s score=%s\n" % (dst,src,score))
except Exception: pass

unreal.log("PHANTOM OWNED FAB HARVEST: %d stronger semantic aliases promoted from %d project static meshes" % (len(results),len(assets)))
