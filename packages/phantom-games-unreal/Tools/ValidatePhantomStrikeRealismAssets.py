import unreal


REQUIRED_ASSETS = {
    "/Game/Characters/Mannequins/Meshes/SKM_Manny_Simple": "SkeletalMesh",
    "/Game/Characters/Mannequins/Meshes/SKM_Quinn_Simple": "SkeletalMesh",
    "/Game/Weapons/Rifle/Meshes/SM_Rifle": "StaticMesh",
    "/Game/Weapons/Pistol/Meshes/SM_Pistol": "StaticMesh",
    "/Game/Variant_Shooter/Anims/ABP_TP_Rifle": "AnimBlueprint",
    "/Game/ProductAssets/Mesh/SM_Building": "StaticMesh",
    "/Game/ProductAssets/Mesh/SM_Car": "StaticMesh",
    "/Game/ProductAssets/Materials/M_Concrete": "Material",
    "/Game/ArchVis/SampleScene/Tree/HillTree_02": "StaticMesh",
    "/Game/ArchVis/SampleScene/Building/Meshes/Exterior_Terrain": "StaticMesh",
    "/Game/ArchVis/SampleScene/Building/Materials/Terrain": "Material",
    "/Game/Phantom/Materials/Production/M_Phantom_Asphalt": "Material",
    "/Game/Phantom/Materials/Production/M_Phantom_Concrete": "Material",
}


def main():
    failures = []
    registry = unreal.AssetRegistryHelpers.get_asset_registry()
    registry.scan_paths_synchronous(
        [
            "/Game/Characters",
            "/Game/Weapons",
            "/Game/Variant_Shooter",
            "/Game/ProductAssets",
            "/Game/ArchVis/SampleScene",
        ],
        True,
    )

    for path, expected_class in REQUIRED_ASSETS.items():
        if not unreal.EditorAssetLibrary.does_asset_exist(path):
            failures.append(f"missing: {path}")
            continue
        asset = unreal.EditorAssetLibrary.load_asset(path)
        if asset is None:
            failures.append(f"unloadable: {path}")
            continue
        actual_class = asset.get_class().get_name()
        if actual_class != expected_class:
            failures.append(f"wrong class: {path} expected={expected_class} actual={actual_class}")
            continue
        bounds_note = ""
        if hasattr(asset, "get_bounds"):
            bounds = asset.get_bounds()
            size = bounds.box_extent * 2.0
            bounds_note = f" size_cm=({size.x:.1f},{size.y:.1f},{size.z:.1f})"
        unreal.log(f"[PhantomStrikeRealismGate] PASS {path} ({actual_class}){bounds_note}")

    if failures:
        for failure in failures:
            unreal.log_error(f"[PhantomStrikeRealismGate] FAIL {failure}")
        raise RuntimeError("PhantomStrike realism asset gate failed: " + "; ".join(failures))

    unreal.log("[PhantomStrikeRealismGate] PASS all required realism assets")


main()
