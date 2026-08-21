import json
import unreal


PATHS = [
    "/Game/Characters/Mannequins/Meshes/SK_Mannequin",
    "/Game/Characters/Mannequins/Meshes/SKM_Manny_Simple",
    "/Game/Characters/Mannequins/Rigs/PA_Mannequin",
    "/Game/Characters/Mannequins/Rigs/CR_Mannequin_FootIK",
    "/Game/Characters/Mannequins/Anims/Unarmed/ABP_Unarmed",
    "/Game/Characters/Mannequins/Anims/Unarmed/BS_Idle_Walk_Run",
    "/Game/Characters/Mannequins/Anims/Unarmed/MM_Idle",
    "/Game/Characters/Mannequins/Anims/Unarmed/Walk/MF_Unarmed_Walk_Fwd",
    "/Game/Characters/Mannequins/Anims/Unarmed/Jog/MF_Unarmed_Jog_Fwd",
    "/Game/Characters/Mannequins/Anims/Unarmed/Jump/MM_Jump",
    "/Game/Characters/Mannequins/Anims/Unarmed/Jump/MM_Fall_Loop",
    "/Game/Characters/Mannequins/Anims/Unarmed/Jump/MM_Land",
    "/Game/Phantom/Characters/Production/SK_Rogue",
    "/Game/Phantom/Characters/Production/Animations/A_Rogue_Idle",
    "/Game/Phantom/Characters/Production/Animations/A_Rogue_Walk",
    "/Game/Phantom/Characters/Production/Animations/A_Rogue_Run",
    "/Game/Phantom/Characters/Production/_Import_Rogue_GLTF/Rogue/SkeletalMeshes/RogueWalking_Backwards",
    "/Game/Phantom/Characters/Production/_Import_Rogue_GLTF/Rogue/SkeletalMeshes/RogueRunning_Strafe_Left",
    "/Game/Phantom/Characters/Production/_Import_Rogue_GLTF/Rogue/SkeletalMeshes/RogueRunning_Strafe_Right",
    "/Game/Phantom/Characters/Production/_Import_Rogue_GLTF/Rogue/SkeletalMeshes/RogueJump_Start",
    "/Game/Phantom/Characters/Production/_Import_Rogue_GLTF/Rogue/SkeletalMeshes/RogueJump_Idle",
    "/Game/Phantom/Characters/Production/_Import_Rogue_GLTF/Rogue/SkeletalMeshes/RogueJump_Land",
]


report = []
for path in PATHS:
    entry = {"path": path, "loaded": False}
    try:
        asset = unreal.EditorAssetLibrary.load_asset(path)
        entry["loaded"] = bool(asset)
        if asset:
            entry["class"] = asset.get_class().get_name()
            if isinstance(asset, unreal.AnimSequence):
                skeleton = asset.get_editor_property("skeleton")
                entry["skeleton"] = skeleton.get_path_name() if skeleton else None
                entry["play_length"] = asset.get_play_length()
                entry["rate_scale"] = asset.get_editor_property("rate_scale")
                entry["root_motion"] = asset.get_editor_property("enable_root_motion")
            elif isinstance(asset, unreal.SkeletalMesh):
                skeleton = asset.get_editor_property("skeleton")
                entry["skeleton"] = skeleton.get_path_name() if skeleton else None
                entry["bounds"] = str(asset.get_bounds())
            elif isinstance(asset, unreal.BlendSpace):
                parameters = asset.get_editor_property("blend_parameters")
                entry["parameters"] = [
                    {
                        "name": str(parameter.get_editor_property("display_name")),
                        "min": parameter.get_editor_property("min"),
                        "max": parameter.get_editor_property("max"),
                        "grid": parameter.get_editor_property("grid_num"),
                    }
                    for parameter in parameters
                ]
    except Exception as exc:
        entry["error"] = str(exc)
    report.append(entry)

print("CUBETOWN HERO ASSET INSPECTION " + json.dumps(report, sort_keys=True))
