"""Import the strongest source assets from the existing PhantomGames Unity baseline into Unreal.

The point is continuity: the UE rewrite must not throw away art that already existed in Unity.
The PowerShell harvester creates a bounded manifest so this import cannot explode into thousands of
editor tasks. Static meshes, textures and audio are imported; skeletal/animation FBX files are also
attempted with conservative settings and never used as a hard dependency until successfully imported.
"""
import json, os, re, traceback
import unreal

SAVED = unreal.Paths.project_saved_dir()
MANIFEST = os.path.abspath(os.path.join(SAVED, "PhantomUnityBaselineInventory.json"))
REPORT = os.path.abspath(os.path.join(SAVED, "PhantomUnityBaselineImport.txt"))
DEST_ROOT = "/Game/Phantom/UnityHarvest"
ALIAS_ROOT = "/Game/Phantom/Curated/Unity"


def sanitize(s):
    s = re.sub(r"[^A-Za-z0-9_]+", "_", s or "asset")
    s = re.sub(r"_+", "_", s).strip("_")
    if not s: s = "asset"
    if s[0].isdigit(): s = "A_" + s
    return s[:72]


def ensure_dir(path):
    try:
        if not unreal.EditorAssetLibrary.does_directory_exist(path):
            unreal.EditorAssetLibrary.make_directory(path)
    except Exception:
        pass


def import_file(src, dest, asset_name):
    if not os.path.isfile(src): return None
    task = unreal.AssetImportTask()
    task.filename = src
    task.destination_path = dest
    task.destination_name = asset_name
    task.automated = True
    task.replace_existing = True
    task.save = True
    ext = os.path.splitext(src)[1].lower()
    try:
        if ext == ".fbx":
            ui = unreal.FbxImportUI()
            # Try static first; Unity environment props are the most valuable safe migration target.
            ui.import_mesh = True
            ui.import_as_skeletal = False
            ui.import_animations = False
            ui.import_materials = True
            ui.import_textures = True
            task.options = ui
        unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
        paths = list(task.imported_object_paths or [])
        return paths[0] if paths else None
    except Exception:
        unreal.log_warning("Unity baseline import failed: %s\n%s" % (src, traceback.format_exc()))
        return None


def get_asset_data(path):
    try:
        reg = unreal.AssetRegistryHelpers.get_asset_registry()
        return reg.get_asset_by_object_path(path)
    except Exception:
        return None


def is_static_mesh(path):
    try:
        obj = unreal.EditorAssetLibrary.load_asset(path)
        return isinstance(obj, unreal.StaticMesh)
    except Exception:
        return False


def duplicate_alias(src_obj_path, dst_obj_path):
    if not src_obj_path or not is_static_mesh(src_obj_path): return False
    src_pkg = src_obj_path.split(".")[0]
    dst_pkg = dst_obj_path.split(".")[0]
    ensure_dir(dst_pkg.rsplit("/",1)[0])
    try:
        if unreal.EditorAssetLibrary.does_asset_exist(dst_pkg): unreal.EditorAssetLibrary.delete_asset(dst_pkg)
        ok = unreal.EditorAssetLibrary.duplicate_asset(src_pkg, dst_pkg)
        if ok: unreal.EditorAssetLibrary.save_asset(dst_pkg)
        return bool(ok)
    except Exception:
        return False


if not os.path.isfile(MANIFEST):
    with open(REPORT, "w", encoding="utf-8") as f:
        f.write("UNITY BASELINE IMPORT: SKIPPED\nmanifest_missing=%s\n" % MANIFEST)
    unreal.log_warning("Unity baseline manifest missing; continuing with owned Fab + curated CC0 library.")
else:
    data = json.load(open(MANIFEST, "r", encoding="utf-8-sig"))
    selected = data.get("selected_files", [])
    imported = []
    for i, item in enumerate(selected):
        src = item.get("path", "")
        game = sanitize(item.get("game", "Shared"))
        cat = sanitize(item.get("category", "misc"))
        ext = item.get("extension", "").lower()
        if ext not in (".fbx",".obj",".glb",".gltf",".png",".jpg",".jpeg",".tga",".bmp",".exr",".hdr",".wav",".ogg",".mp3"):
            continue
        dest = "%s/%s/%s" % (DEST_ROOT, game, cat)
        name = "U_%s_%04d_%s" % (game, i, sanitize(os.path.splitext(os.path.basename(src))[0]))
        obj_path = import_file(src, dest, name)
        if obj_path:
            imported.append({"src":src,"path":obj_path,"game":item.get("game"),"category":item.get("category"),"score":item.get("score",0)})

    # Stable semantic aliases. We score ONLY successfully imported static meshes.
    alias_specs = [
        ("Cube/SM_Unity_House", "Cube", "building", ("house","cottage","home","building")),
        ("Cube/SM_Unity_Tree", "Cube", "foliage", ("tree","oak","pine","foliage")),
        ("Cube/SM_Unity_Rock", "Cube", "terrain", ("rock","stone","boulder")),
        ("Cube/SM_Unity_Bridge", "Cube", "infrastructure", ("bridge",)),
        ("Legends/SM_Unity_Keep", "Legends", "building", ("keep","castle","stronghold","fort")),
        ("Legends/SM_Unity_Tower", "Legends", "building", ("tower","watchtower","turret")),
        ("Legends/SM_Unity_Wall", "Legends", "building", ("wall","rampart")),
        ("Legends/SM_Unity_House", "Legends", "building", ("house","cottage","building")),
        ("Legends/SM_Unity_Tree", "Legends", "foliage", ("tree","forest","pine")),
        ("Ages/SM_Unity_Tower", "Ages", "building", ("tower","fort","castle")),
        ("Ages/SM_Unity_Siege", "Ages", "prop", ("siege","catapult","ballista","trebuchet")),
        ("Strike/SM_Unity_Prop", "Strike", "prop", ("crate","barrier","debris","container","prop")),
        ("Strike/SM_Unity_Building", "Strike", "building", ("building","warehouse","hotel","shop","house")),
    ]
    aliases=[]
    for rel, game, cat, words in alias_specs:
        candidates=[]
        for x in imported:
            if x.get("game") not in (game,"Shared") or x.get("category") != cat or not is_static_mesh(x.get("path")): continue
            blob=(x.get("src","")+" "+x.get("path","")).lower()
            score=int(x.get("score",0)) + sum(40 for w in words if w in blob)
            candidates.append((score,x))
        candidates.sort(key=lambda y:y[0], reverse=True)
        if candidates:
            dst = "%s/%s.%s" % (ALIAS_ROOT, rel, rel.rsplit("/",1)[-1])
            if duplicate_alias(candidates[0][1]["path"], dst):
                aliases.append((rel,candidates[0][1]["path"],candidates[0][0]))

    try:
        unreal.EditorLoadingAndSavingUtils.save_dirty_packages(True, True)
    except Exception:
        pass
    os.makedirs(os.path.dirname(REPORT), exist_ok=True)
    with open(REPORT, "w", encoding="utf-8") as f:
        f.write("PHANTOM UNITY BASELINE IMPORT\n")
        f.write("selected=%d\nimported=%d\nstatic_aliases=%d\n\n" % (len(selected),len(imported),len(aliases)))
        f.write("ALIASES:\n")
        for rel,src,score in aliases: f.write("  %s <- %s score=%s\n" % (rel,src,score))
        f.write("\nIMPORTED:\n")
        for x in imported: f.write("  %s <- %s\n" % (x["path"],x["src"]))
    unreal.log("PHANTOM UNITY BASELINE: selected=%d imported=%d aliases=%d" % (len(selected),len(imported),len(aliases)))
