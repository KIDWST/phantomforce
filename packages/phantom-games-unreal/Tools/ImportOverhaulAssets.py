from pathlib import Path
import unreal

PROJECT_DIR = Path(unreal.Paths.project_dir())
SOURCE_ROOT = PROJECT_DIR / 'SourceArt' / 'GeneratedGLB'
DEST_ROOT = '/Game/Phantom/Generated'


def fail(message: str):
    unreal.log_error(f'[PhantomOverhaul] {message}')
    raise RuntimeError(message)


if not SOURCE_ROOT.exists():
    fail(f'Generated GLB directory does not exist: {SOURCE_ROOT}')

sources = sorted(SOURCE_ROOT.rglob('*.glb'))
if not sources:
    fail(f'No GLB files found under {SOURCE_ROOT}')

# UE 5.8's Interchange pipeline is the supported path for glTF/GLB import.
manager = unreal.InterchangeManager.get_interchange_manager_scripted()
if not manager:
    fail('InterchangeManager is unavailable. Ensure Unreal Interchange plugins are enabled.')

# This folder is generated entirely by the Phantom overhaul, so replacing it is safe.
if unreal.EditorAssetLibrary.does_directory_exist(DEST_ROOT):
    unreal.log('[PhantomOverhaul] Removing previous generated asset directory before clean import...')
    unreal.EditorAssetLibrary.delete_directory(DEST_ROOT)

imported_meshes = []
failed_sources = []

unreal.log(f'[PhantomOverhaul] Importing {len(sources)} generated GLB meshes through Interchange...')

for index, source_file in enumerate(sources, start=1):
    rel_parent = source_file.parent.relative_to(SOURCE_ROOT).as_posix()
    destination = DEST_ROOT if rel_parent == '.' else f'{DEST_ROOT}/{rel_parent}'
    expected_package = f'{destination}/{source_file.stem}'

    try:
        source_data = unreal.InterchangeManager.create_source_data(str(source_file))
        if not source_data:
            raise RuntimeError('create_source_data returned None')

        # Fail early with a useful message if the current engine has no GLB translator.
        if hasattr(manager, 'can_translate_source_data') and not manager.can_translate_source_data(source_data):
            raise RuntimeError('No Interchange translator is registered for this GLB file')

        params = unreal.ImportAssetParameters()
        params.set_editor_property('is_automated', True)
        params.set_editor_property('replace_existing', True)
        params.set_editor_property('destination_name', source_file.stem)
        if hasattr(params, 'set_editor_property'):
            try:
                params.set_editor_property('force_show_dialog', False)
            except Exception:
                pass

        objects = manager.import_asset(destination, source_data, params)
        objects = list(objects) if objects else []

        static_meshes = [obj for obj in objects if isinstance(obj, unreal.StaticMesh)]

        # Some Interchange versions return an empty result array even when the asset was created,
        # so verify the expected package on disk as a secondary signal.
        expected_asset = unreal.EditorAssetLibrary.load_asset(expected_package)
        if expected_asset and isinstance(expected_asset, unreal.StaticMesh):
            if expected_asset not in static_meshes:
                static_meshes.append(expected_asset)

        if not static_meshes:
            raise RuntimeError(f'Interchange did not create expected StaticMesh {expected_package}')

        # If Interchange ignored destination_name and produced a different package, rename the
        # first StaticMesh to the exact package name referenced by the game C++.
        primary = static_meshes[0]
        primary_path = unreal.EditorAssetLibrary.get_path_name_for_loaded_asset(primary)
        primary_package = primary_path.split('.', 1)[0]
        if primary_package != expected_package:
            if unreal.EditorAssetLibrary.does_asset_exist(expected_package):
                unreal.EditorAssetLibrary.delete_asset(expected_package)
            if not unreal.EditorAssetLibrary.rename_asset(primary_package, expected_package):
                raise RuntimeError(f'Could not rename {primary_package} to {expected_package}')
            primary = unreal.EditorAssetLibrary.load_asset(expected_package)

        if not primary or not isinstance(primary, unreal.StaticMesh):
            raise RuntimeError(f'Expected static mesh is missing after import: {expected_package}')

        try:
            primary.set_editor_property('light_map_resolution', 64)
        except Exception:
            pass

        unreal.EditorAssetLibrary.save_loaded_asset(primary, only_if_is_dirty=False)
        imported_meshes.append(expected_package)
        unreal.log(f'[PhantomOverhaul] [{index:02d}/{len(sources):02d}] OK {expected_package}')

    except Exception as exc:
        failed_sources.append((str(source_file), str(exc)))
        unreal.log_error(f'[PhantomOverhaul] [{index:02d}/{len(sources):02d}] FAILED {source_file}: {exc}')

try:
    unreal.EditorAssetLibrary.save_directory(DEST_ROOT, only_if_is_dirty=False, recursive=True)
except Exception as exc:
    unreal.log_warning(f'[PhantomOverhaul] save_directory warning: {exc}')

if failed_sources:
    unreal.log_error(f'[PhantomOverhaul] {len(failed_sources)} of {len(sources)} GLB imports failed.')
    for filename, reason in failed_sources:
        unreal.log_error(f'[PhantomOverhaul]   {filename}: {reason}')
    fail('Generated asset import did not complete successfully.')

if len(imported_meshes) != len(sources):
    fail(f'Expected {len(sources)} generated StaticMeshes, verified {len(imported_meshes)}.')


# Import the canonical start-screen targets as real Texture2D assets. They are never streamed so
# menus cannot boot into a low mip and look blurry.
TARGET_SOURCE_ROOT = PROJECT_DIR / 'SourceArt' / 'VisualTargets'
TARGET_DEST_ROOT = '/Game/Phantom/VisualTargets'
required_targets = ['PhantomAges_TARGET', 'CubeTown_TARGET', 'PhantomLegends_TARGET', 'PhantomStrike_TARGET']
if not TARGET_SOURCE_ROOT.exists():
    fail(f'Visual target directory does not exist: {TARGET_SOURCE_ROOT}')

asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
for target_name in required_targets:
    src = TARGET_SOURCE_ROOT / f'{target_name}.png'
    if not src.exists():
        fail(f'Required visual target missing: {src}')
    task = unreal.AssetImportTask()
    task.set_editor_property('filename', str(src))
    task.set_editor_property('destination_path', TARGET_DEST_ROOT)
    task.set_editor_property('destination_name', target_name)
    task.set_editor_property('automated', True)
    task.set_editor_property('replace_existing', True)
    task.set_editor_property('save', True)
    asset_tools.import_asset_tasks([task])
    asset_path = f'{TARGET_DEST_ROOT}/{target_name}'
    tex = unreal.EditorAssetLibrary.load_asset(asset_path)
    if not tex or not isinstance(tex, unreal.Texture2D):
        fail(f'Visual target Texture2D import failed: {asset_path}')
    for prop, value in [('never_stream', True)]:
        try:
            tex.set_editor_property(prop, value)
        except Exception:
            pass
    try:
        tex.set_editor_property('lod_group', unreal.TextureGroup.TEXTUREGROUP_UI)
    except Exception:
        pass
    try:
        tex.set_editor_property('mip_gen_settings', unreal.TextureMipGenSettings.TMGS_NO_MIPMAPS)
    except Exception:
        pass
    try:
        tex.set_editor_property('filter', unreal.TextureFilter.TF_TRILINEAR)
    except Exception:
        pass
    unreal.EditorAssetLibrary.save_loaded_asset(tex, only_if_is_dirty=False)
    unreal.log(f'[PhantomOverhaul] UI target OK {asset_path}')

unreal.log(f'[PhantomOverhaul] SUCCESS: imported {len(imported_meshes)} generated StaticMeshes + 4 sharp visual targets.')
