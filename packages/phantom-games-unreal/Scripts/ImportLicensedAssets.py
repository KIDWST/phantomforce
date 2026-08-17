import os
import unreal


PROJECT_ROOT = os.path.abspath(unreal.Paths.project_dir())
UNITY_ASSET_ROOT = os.path.abspath(
    os.path.join(
        PROJECT_ROOT,
        "..",
        "phantom-games-unity",
        "Assets",
        "Resources",
        "Models",
        "Quaternius",
    )
)


STRIKE_MODELS = (
    "AssaultRifle",
    "Bank",
    "Bullpup",
    "Flat",
    "Flat2",
    "Grip",
    "Hospital",
    "House1",
    "House2",
    "House3",
    "House4",
    "House5",
    "Pistol",
    "Scope",
    "Shop",
    "Shotgun",
    "Silencer",
    "SniperRifle",
    "Street_3Way",
    "Street_4Way",
    "Street_Bridge",
    "Street_Straight",
    "Streetlight_Single",
    "SubmachineGun",
    "TrafficLight",
)


def make_static_mesh_task(source_file, destination_path):
    options = unreal.FbxImportUI()
    options.set_editor_property("import_mesh", True)
    options.set_editor_property("import_as_skeletal", False)
    options.set_editor_property("import_materials", True)
    options.set_editor_property("import_textures", True)
    options.set_editor_property(
        "mesh_type_to_import",
        unreal.FBXImportType.FBXIT_STATIC_MESH,
    )
    static_options = options.get_editor_property("static_mesh_import_data")
    static_options.set_editor_property("combine_meshes", True)
    static_options.set_editor_property("generate_lightmap_u_vs", True)

    task = unreal.AssetImportTask()
    task.set_editor_property("filename", source_file)
    task.set_editor_property("destination_path", destination_path)
    task.set_editor_property("automated", True)
    task.set_editor_property("replace_existing", True)
    task.set_editor_property("save", True)
    task.set_editor_property("options", options)
    return task


def import_strike_models():
    strike_root = os.path.join(UNITY_ASSET_ROOT, "Strike")
    tasks = []
    for model_name in STRIKE_MODELS:
        source_file = os.path.join(strike_root, f"{model_name}.fbx")
        if not os.path.isfile(source_file):
            raise RuntimeError(f"Licensed PhantomStrike source model is missing: {source_file}")
        tasks.append(make_static_mesh_task(source_file, "/Game/Phantom/Strike"))

    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks(tasks)
    failed = []
    for task in tasks:
        imported_paths = list(task.get_editor_property("imported_object_paths"))
        if imported_paths:
            unreal.log(f"Imported licensed asset: {imported_paths[0]}")
        else:
            failed.append(task.get_editor_property("filename"))
    if failed:
        raise RuntimeError(f"Unreal failed to import licensed assets: {failed}")


import_strike_models()
unreal.EditorAssetLibrary.save_directory("/Game/Phantom/Strike", only_if_is_dirty=False, recursive=True)
unreal.log("PhantomStrike licensed asset migration complete.")
