import unreal


ASSET_NAMES = (
    "AssaultRifle",
    "Hospital1",
    "Shop1",
    "Bank1",
    "Flat",
    "Flat2",
    "House1",
    "Street_Straight",
    "Street_4Way",
    "Streetlight_Single",
    "TrafficLight",
)


for asset_name in ASSET_NAMES:
    path = f"/Game/Phantom/Strike/{asset_name}.{asset_name}"
    asset = unreal.load_asset(path)
    if not asset:
        unreal.log_error(f"Missing imported asset: {path}")
        continue
    bounds = asset.get_bounds()
    extent = bounds.box_extent
    unreal.log(
        "PHANTOM_ASSET_BOUNDS "
        f"{path} size=({extent.x * 2.0:.3f}, {extent.y * 2.0:.3f}, {extent.z * 2.0:.3f})"
    )
