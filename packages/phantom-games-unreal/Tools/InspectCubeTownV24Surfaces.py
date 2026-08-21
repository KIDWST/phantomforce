"""Log exact CubeTown V24 surface transforms/bounds for visual-placement diagnosis."""
import json
import os
import unreal

WORLD = "/Game/Phantom/Worlds/CubeTown_World"
REPORT = os.path.join(os.path.abspath(unreal.Paths.project_saved_dir()), "CubeTownV24SurfaceInspection.json")
level = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)

if not level.load_level(WORLD):
    raise RuntimeError("Could not load " + WORLD)

labels = {
    "CT_Terrain_Cube_11",
    "CT_V24_SunpetalDistrict",
    "CT_V24_SunpetalMainStreet",
    "CT_V24_SunpetalHarborStreet",
    "CT_V24_SunpetalMarketSquare",
    "CT_V24_SunpetalStreetHouse_00",
}
result = {}
for actor in actors.get_all_level_actors() or []:
    label = actor.get_actor_label()
    if label not in labels:
        continue
    origin, extent = actor.get_actor_bounds(False)
    component = actor.get_components_by_class(unreal.StaticMeshComponent)
    mesh = component[0].get_editor_property("static_mesh") if component else None
    mesh_size = mesh.get_bounds().box_extent * 2.0 if mesh else unreal.Vector()
    result[label] = {
        "location": [float(v) for v in actor.get_actor_location().to_tuple()],
        "scale": [float(v) for v in actor.get_actor_scale3d().to_tuple()],
        "bounds_origin": [float(v) for v in origin.to_tuple()],
        "bounds_extent": [float(v) for v in extent.to_tuple()],
        "mesh": mesh.get_path_name() if mesh else "",
        "mesh_size": [float(v) for v in mesh_size.to_tuple()],
        "materials": [
            component[0].get_material(index).get_path_name() if component and component[0].get_material(index) else ""
            for index in range(component[0].get_num_materials() if component else 0)
        ],
    }

with open(REPORT, "w", encoding="utf-8") as handle:
    json.dump(result, handle, indent=2)
unreal.log("CUBETOWN V24 SURFACE INSPECTION " + json.dumps(result))
