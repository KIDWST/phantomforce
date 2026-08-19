"""Phantom Games curated CC0 asset importer v3.

This pass exists because earlier packages could successfully build while every optional asset download
failed, leaving the old primitive/generated look in place. V3 requires a creator-first CC0 library
(Kenney + KayKit) and imports both compatibility aliases and game-specific curated aliases.

It intentionally imports environment/building/prop art as StaticMesh assets because the current
runtime directors are C++-spawned StaticMeshActor worlds. Character animation is handled separately;
we do not pretend a rigged FBX became a production animation system merely because it imported.
"""
import unreal
import os
import glob
import re
import traceback

project_dir = os.path.abspath(unreal.Paths.project_dir())
root = os.path.join(project_dir, "SourceArt", "External", "CC0")
saved_dir = os.path.join(project_dir, "Saved")
os.makedirs(saved_dir, exist_ok=True)
report_path = os.path.join(saved_dir, "PhantomCuratedAssetImport.txt")
diag_path = os.path.join(saved_dir, "PhantomCuratedAssetDiagnostics.txt")
start_path = os.path.join(saved_dir, "PhantomCuratedAssetImport_STARTED.txt")
with open(start_path, "w", encoding="utf-8") as f:
    f.write("Phantom curated CC0 importer v11 started\n")
    f.write(f"root={root}\n")

DEST_COMPAT = "/Game/Phantom/External/CC0/Aliases"
DEST_CURATED = "/Game/Phantom/Curated"
STATIC_EXTS = (".glb", ".gltf", ".fbx", ".obj")

PACKS = {
    "nature": ["KenneyNature", "StylizedNatureMega"],
    "town": ["KenneyFantasyTown", "KenneyCastle", "KayKitMedievalHex", "KayKitCityBuilder", "MedievalVillageMega", "MedievalVillageClassic"],
    "medieval": ["KenneyCastle", "KayKitMedievalHex", "KenneyFantasyTown", "KayKitCityBuilder", "MedievalVillageMega", "MedievalVillageClassic"],
    "dungeon": ["KayKitDungeon"],
    "city": ["KenneyCityCommercial", "KenneyCityIndustrial", "KayKitCityBuilder"],
    "industrial": ["KenneyCityIndustrial", "KenneyCityCommercial", "KayKitCityBuilder"],
    "props": ["KayKitDungeon", "KenneyFantasyTown", "KenneyCastle", "KayKitMedievalHex", "KayKitCityBuilder", "FantasyPropsMega"],
    "characters": ["KayKitAdventurers", "KayKitSkeletons", "RPGCharacters", "AnimatedCharacters"],
    "creatures": ["CuteMonsters"],
}

log = []
def note(msg):
    log.append(str(msg)); unreal.log("[PhantomCuratedV3] " + str(msg))
def warn(msg):
    log.append("WARNING: " + str(msg)); unreal.log_warning("[PhantomCuratedV3] " + str(msg))

def norm(s):
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")

def pack_dirs(keys):
    names = []
    for key in keys:
        names.extend(PACKS.get(key, [key]))
    return [os.path.join(root, n) for n in names if os.path.isdir(os.path.join(root, n))]

def all_files(keys, exts=STATIC_EXTS):
    out = []
    for base in pack_dirs(keys):
        for p in glob.glob(os.path.join(base, "**", "*"), recursive=True):
            if os.path.isfile(p) and os.path.splitext(p)[1].lower() in exts:
                out.append(p)
    return out

def relkey(path):
    try: return norm(os.path.relpath(path, root))
    except Exception: return norm(path)

def choose(keys, positives, negatives=(), used=None, fallback_any=True, ext_priority=(".glb", ".gltf", ".fbx", ".obj")):
    used = used or set()
    priority = {e: (len(ext_priority)-i)*100 for i,e in enumerate(ext_priority)}
    candidates = []
    for p in all_files(keys):
        if p in used: continue
        k = relkey(p); stem = norm(os.path.splitext(os.path.basename(p))[0])
        if any(norm(n) in k for n in negatives): continue
        hits = [norm(x) in k for x in positives]
        if not any(hits): continue
        score = sum(220 - i*12 for i,h in enumerate(hits) if h)
        score += sum(55 for x in positives if norm(x) in stem)
        score += priority.get(os.path.splitext(p)[1].lower(), 0)
        if any(x in k for x in ("preview","sample","collision","collider")): score -= 180
        if "lod" in k: score -= 30
        candidates.append((score,p))
    if candidates:
        candidates.sort(key=lambda x:(x[0],x[1]), reverse=True)
        return candidates[0][1]
    if fallback_any:
        # Deterministic fallback within the intended pack family. This is still real CC0 art,
        # not an engine primitive. It guarantees the visual pass actually changes the build.
        files = [p for p in all_files(keys) if p not in used]
        files.sort(key=lambda p:(priority.get(os.path.splitext(p)[1].lower(),0), relkey(p)), reverse=True)
        return files[0] if files else None
    return None

def exists(dest, alias):
    return unreal.EditorAssetLibrary.does_asset_exist(f"{dest}/{alias}")

def delete_if_exists(path):
    try:
        if unreal.EditorAssetLibrary.does_asset_exist(path):
            unreal.EditorAssetLibrary.delete_asset(path)
    except Exception: pass

def imported_static_path(task):
    for obj_path in getattr(task, "imported_object_paths", []) or []:
        try:
            obj = unreal.load_asset(obj_path)
            if obj and obj.get_class().get_name() == "StaticMesh": return obj_path
        except Exception: pass
    return None

def import_static(dest, alias, source, replace=True):
    target = f"{dest}/{alias}"
    if exists(dest, alias) and not replace:
        note(f"KEEP {target}"); return True
    if not source or not os.path.isfile(source):
        warn(f"NO SOURCE {target}"); return False
    try:
        if replace: delete_if_exists(target)
        task = unreal.AssetImportTask()
        task.filename = source
        task.destination_path = dest
        task.destination_name = alias
        task.automated = True
        task.replace_existing = True
        task.save = True
        ext = os.path.splitext(source)[1].lower()
        if ext == ".fbx":
            opts = unreal.FbxImportUI()
            opts.import_mesh = True
            opts.import_as_skeletal = False
            opts.import_animations = False
            opts.mesh_type_to_import = unreal.FBXImportType.FBXIT_STATIC_MESH
            opts.static_mesh_import_data.combine_meshes = True
            opts.static_mesh_import_data.generate_lightmap_u_vs = True
            task.options = opts
        unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
        if exists(dest, alias):
            unreal.EditorAssetLibrary.save_asset(target)
            note(f"OK {target} <- {os.path.relpath(source, root)}")
            return True
        imported = imported_static_path(task)
        if imported and unreal.EditorAssetLibrary.rename_asset(imported, target):
            unreal.EditorAssetLibrary.save_asset(target)
            note(f"OK {target} <- {os.path.relpath(source, root)} [renamed]")
            return True
        warn(f"IMPORT CREATED NO STATIC MESH {target} from {source}")
        return False
    except Exception as exc:
        warn(f"IMPORT FAILED {target}: {exc}")
        return False

used = set()
results = {}

# Compatibility aliases used throughout existing directors.
compat_specs = [
    ("SM_CC0_Tree_A", ["nature"], ["tree","oak"], ["stump","dead","log"]),
    ("SM_CC0_Bush", ["nature"], ["bush","shrub"], ["dead"]),
    ("SM_CC0_Rock", ["nature"], ["rock","stone"], ["wall","path"]),
    ("SM_CC0_Flower", ["nature"], ["flower","plant"], ["tree"]),
    ("SM_CC0_Fence", ["town","medieval"], ["fence","palisade"], ["wall"]),
    ("SM_CC0_House_A", ["town"], ["house","home","cottage"], ["wall","roof","door"]),
    ("SM_CC0_House_B", ["town"], ["tavern","house","home"], ["wall","roof","door"]),
    ("SM_CC0_House_C", ["town"], ["blacksmith","shop","house"], ["wall","roof","door"]),
    ("SM_CC0_CastleWall", ["medieval","dungeon"], ["wall","castle","fort"], ["floor","door"]),
    ("SM_CC0_CastleTower", ["medieval"], ["tower","turret","keep"], ["water","roof","top","cap","spire"]),
    ("SM_CC0_Gate", ["medieval","dungeon"], ["gate","arch","entrance"], ["window"]),
    ("SM_CC0_Bridge", ["medieval","town"], ["bridge","crossing"], []),
    ("SM_CC0_Lantern", ["props","town"], ["lantern","torch","lamp","light"], []),
    ("SM_CC0_Market", ["town"], ["market","stall"], []),
    ("SM_CC0_Crate", ["props","industrial"], ["crate","box"], []),
    ("SM_CC0_Barrel", ["props","industrial"], ["barrel"], []),
    ("SM_CC0_Cart", ["town","props"], ["cart","wagon"], []),
    ("SM_CC0_Sign", ["town","city"], ["sign"], []),
    ("SM_CC0_Well", ["town","medieval"], ["well","fountain"], []),
    ("SM_CC0_Bench", ["town","props"], ["bench","chair"], []),
    ("SM_CC0_Chest", ["dungeon","props"], ["chest"], []),
    ("SM_CC0_Barracks", ["medieval"], ["barracks","archery","military"], []),
    ("SM_CC0_Keep", ["medieval"], ["castle","keep","townhall"], []),
]
for alias,keys,pos,neg in compat_specs:
    src = choose(keys,pos,neg,used,fallback_any=False)
    if src: used.add(src)
    results[alias] = import_static(DEST_COMPAT, alias, src, replace=True)

# Game-specific aliases. These are what make the new pass visibly different instead of merely
# satisfying old generic alias names.
curated_specs = [
    # CubeTown: cozy village/life-sim language.
    ("Cube/SM_Cube_House_A", ["town"], ["house","home"], ["wall","roof"]),
    ("Cube/SM_Cube_House_B", ["town"], ["cottage","house"], ["wall","roof"]),
    ("Cube/SM_Cube_Tavern", ["town"], ["tavern","inn"], []),
    ("Cube/SM_Cube_Blacksmith", ["town"], ["blacksmith","smith"], []),
    ("Cube/SM_Cube_Windmill", ["town","medieval"], ["windmill","mill"], []),
    ("Cube/SM_Cube_Well", ["town"], ["well","fountain"], []),
    ("Cube/SM_Cube_Bridge", ["town","medieval"], ["bridge"], []),
    ("Cube/SM_Cube_Market", ["town"], ["market","stall"], []),
    ("Cube/SM_Cube_Tree_A", ["nature"], ["tree"], ["stump","log","dead"]),
    ("Cube/SM_Cube_Rock_A", ["nature"], ["rock"], []),
    # Phantom Legends: full RTS city kit.
    ("Legends/SM_Legends_Keep", ["medieval"], ["castle","keep","townhall"], []),
    ("Legends/SM_Legends_Tower", ["medieval"], ["tower","turret"], ["roof","top","cap","spire"]),
    ("Legends/SM_Legends_Wall", ["medieval","dungeon"], ["wall","castle"], ["floor"]),
    ("Legends/SM_Legends_Gate", ["medieval","dungeon"], ["gate","entrance"], []),
    ("Legends/SM_Legends_Barracks", ["medieval"], ["barracks","archery"], []),
    ("Legends/SM_Legends_Market", ["medieval","town"], ["market"], []),
    ("Legends/SM_Legends_Mine", ["medieval"], ["mine","quarry"], []),
    ("Legends/SM_Legends_Windmill", ["medieval","town"], ["windmill","mill"], []),
    ("Legends/SM_Legends_Ruin", ["dungeon"], ["ruin","broken","arch","wall"], []),
    # Phantom Ages: side-stage towers/fortifications now use real modular medieval art.
    ("Ages/SM_Ages_Tower", ["medieval"], ["tower","turret"], ["roof","top","cap","spire"]),
    ("Ages/SM_Ages_Wall", ["medieval"], ["wall","castle"], ["floor"]),
    ("Ages/SM_Ages_Gate", ["medieval","dungeon"], ["gate","entrance"], []),
    # PhantomStrike: use CC0 city/industrial props for street dressing while keeping the stronger
    # existing PhantomStrike building/rifle assets as primary geometry.
    ("Strike/SM_Strike_Warehouse", ["industrial"], ["warehouse","factory","industrial"], []),
    ("Strike/SM_Strike_Commercial", ["city"], ["commercial","shop","building"], []),
    ("Strike/SM_Strike_Industrial", ["industrial"], ["factory","industrial","building"], []),
    ("Strike/SM_Strike_Container", ["industrial","props"], ["container","crate"], []),
    ("Strike/SM_Strike_StreetProp", ["city","industrial"], ["bench","lamp","sign","barrier"], []),
]

curated_ok = 0
for rel_alias,keys,pos,neg in curated_specs:
    folder, alias = rel_alias.split("/",1)
    dest = DEST_CURATED + "/" + folder
    src = choose(keys,pos,neg,used,fallback_any=False)
    if src: used.add(src)
    ok = import_static(dest, alias, src, replace=True)
    results[rel_alias] = ok
    curated_ok += 1 if ok else 0

# V8 CHARACTER SAFETY: do not flatten arbitrary rigged FBX characters into static meshes.
# The games use known-upright bundled visual rigs until a verified SkeletalMesh + animation-retarget path is installed.
# This prevents the recurring sideways/face-down character regression while preserving the complete source packs for later skeletal import.

required_compat = [
    "SM_CC0_Tree_A","SM_CC0_Bush","SM_CC0_Rock","SM_CC0_Flower",
    "SM_CC0_Fence","SM_CC0_House_A","SM_CC0_House_B","SM_CC0_House_C",
    "SM_CC0_CastleWall","SM_CC0_CastleTower","SM_CC0_Gate","SM_CC0_Bridge","SM_CC0_Lantern"
]
required_curated = [x[0] for x in curated_specs]
missing_compat = [a for a in required_compat if not exists(DEST_COMPAT,a)]
missing_curated = []
for rel in required_curated:
    folder,alias = rel.split("/",1)
    if not exists(DEST_CURATED+"/"+folder,alias): missing_curated.append(rel)

try:
    with open(diag_path,"w",encoding="utf-8") as f:
        f.write("Phantom curated CC0 importer v11\n")
        f.write(f"compat_required={len(required_compat)} missing={len(missing_compat)}\n")
        f.write(f"curated_required={len(required_curated)} imported={curated_ok} missing={len(missing_curated)}\n")
        f.write("\n".join(log)); f.write("\n")
except Exception: pass

# Hard visual gate. A pass that cannot populate these real-asset aliases is not allowed to package.
if missing_compat or missing_curated:
    with open(report_path,"w",encoding="utf-8") as f:
        f.write("CURATED ASSET GATE: FAIL\n")
        f.write("Missing compatibility aliases: " + ", ".join(missing_compat) + "\n")
        f.write("Missing game-specific aliases: " + ", ".join(missing_curated) + "\n")
    raise RuntimeError("Curated asset gate failed. The build is intentionally stopped rather than shipping unchanged visuals. Missing compatibility=%s curated=%s" % (missing_compat, missing_curated))

with open(report_path,"w",encoding="utf-8") as f:
    f.write("CURATED ASSET GATE: PASS\n")
    f.write(f"Compatibility aliases: {len(required_compat)}/{len(required_compat)}\n")
    f.write(f"Game-specific curated aliases: {len(required_curated)}/{len(required_curated)}\n")
    f.write("Core creators: current Kenney + current KayKit main-branch packs (CC0); optional Quaternius variety when available.\n")
    f.write("Imported materials are preserved by the runtime; no blanket BasicShapeMaterial flattening.\n")

note(f"QUALITY GATE PASS: compatibility {len(required_compat)}/{len(required_compat)}, curated {len(required_curated)}/{len(required_curated)}")
