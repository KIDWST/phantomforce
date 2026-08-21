from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
checks = {
    "shared_shell_scale_api": (ROOT / "Source/PhantomGames/Public/Core/PhantomGameDirectorBase.h", "GetShellUIScale"),
    "shared_shell_uses_scale": (ROOT / "Source/PhantomGames/Public/Core/PhantomGameShell.h", "Director->GetShellUIScale"),
    "volume_persistence": (ROOT / "Source/PhantomGames/Private/Core/PhantomGameDirectorBase.cpp", "PhantomPlay.Audio"),
    "strike_active_weapon_animation": (ROOT / "Source/PhantomGames/Private/Strike/PhantomStrikeDirector.cpp", "UStaticMeshComponent* ActiveWeapon = bUsingSidearm ? SidearmBody : RifleBody"),
    "strike_clean_respawn": (ROOT / "Source/PhantomGames/Private/Strike/PhantomStrikeDirector.cpp", "GetCharacterMovement()->StopMovementImmediately();"),
    "strike_production_humanoid": (ROOT / "Source/PhantomGames/Private/Strike/PhantomStrikeDirector.cpp", "SKM_Manny_Simple"),
    "strike_blended_locomotion": (ROOT / "Source/PhantomGames/Private/Strike/PhantomStrikeDirector.cpp", "ABP_Unarmed_C"),
    "ages_queue_reset": (ROOT / "Source/PhantomGames/Private/Ages/PhantomAgesDirector.cpp", "PlayerProductionQueueCounts.Init(0, 4)"),
    "ages_time_reset": (ROOT / "Source/PhantomGames/Private/Ages/PhantomAgesDirector.cpp", "UGameplayStatics::SetGlobalTimeDilation(this, 1.0f)"),
    "ages_production_humanoid": (ROOT / "Source/PhantomGames/Private/Ages/PhantomAgesDirector.cpp", "SKM_Manny_Simple"),
    "ages_real_jog_animation": (ROOT / "Source/PhantomGames/Private/Ages/PhantomAgesDirector.cpp", "MF_Unarmed_Jog_Fwd"),
    "ages_real_attack_animation": (ROOT / "Source/PhantomGames/Private/Ages/PhantomAgesDirector.cpp", "MM_Attack_01"),
    "legends_selection_prune": (ROOT / "Source/PhantomGames/Private/Legends/PhantomLegendsDirector.cpp", "SelectedUnits.RemoveAll"),
    "legends_safe_tower_spend": (ROOT / "Source/PhantomGames/Private/Legends/PhantomLegendsDirector.cpp", "TOWER SITE BLOCKED // RESOURCES NOT SPENT"),
    "legends_shipping_skeletal_suppression": (ROOT / "Source/PhantomGames/Private/Legends/PhantomLegendsDirector.cpp", "SuppressRecoveredLegendsSkeletalVisuals"),
    "legends_rejected_world_mesh_sanitizer": (ROOT / "Source/PhantomGames/Private/Legends/PhantomLegendsDirector.cpp", "SanitizeLegendsWorldMeshes"),
    "legends_mislabeled_pine_rejection": (ROOT / "Source/PhantomGames/Private/Legends/PhantomLegendsDirector.cpp", "bMislabeledPineAsset"),
    "legends_contaminated_tree_rejection": (ROOT / "Source/PhantomGames/Private/Legends/PhantomLegendsDirector.cpp", "bContaminatedTreeAlias"),
    "legends_generated_tree_rejection": (ROOT / "Source/PhantomGames/Private/Legends/PhantomLegendsDirector.cpp", "bContaminatedGeneratedTree"),
    "legends_verified_tree_fallback": (ROOT / "Source/PhantomGames/Private/Legends/PhantomLegendsDirector.cpp", "/Game/Phantom/Curated/Cube/SM_Cube_Tree_A.SM_Cube_Tree_A"),
    "legends_readable_camera_reset": (ROOT / "Source/PhantomGames/Private/Legends/PhantomLegendsDirector.cpp", "SpringArm->SetRelativeRotation(FRotator(-18.0f,-42.0f,0.0f))"),
    "legends_near_camera_reset": (ROOT / "Source/PhantomGames/Private/Legends/PhantomLegendsDirector.cpp", "SpringArm->TargetArmLength = 3600.0f"),
    "legends_production_humanoid": (ROOT / "Source/PhantomGames/Private/Legends/PhantomLegendsDirector.cpp", "SKM_Manny_Simple"),
    "legends_blended_locomotion": (ROOT / "Source/PhantomGames/Private/Legends/PhantomLegendsDirector.cpp", "ABP_Unarmed_C"),
    "legends_preserves_verified_humanoids": (ROOT / "Source/PhantomGames/Private/Legends/PhantomLegendsDirector.cpp", "/Game/Characters/Mannequins/"),
    "cubetown_respawn_reset": (ROOT / "Source/PhantomGames/Private/Cubetown/CubetownDirector.cpp", "InvulnerableRemaining = 1.0f"),
    "cubetown_shell_scale": (ROOT / "Source/PhantomGames/Private/Cubetown/CubetownDirector.cpp", "Director->GetShellUIScale(Width,Height)"),
    "cubetown_diorama_camera_distance": (ROOT / "Source/PhantomGames/Private/Cubetown/CubetownDirector.cpp", "SpringArm->TargetArmLength = 6200.0f"),
    "cubetown_diorama_camera_pitch": (ROOT / "Source/PhantomGames/Private/Cubetown/CubetownDirector.cpp", "SetRelativeRotation(FRotator(-38.0f, 0.0f, 0.0f))"),
    "cubetown_compressed_camera_fov": (ROOT / "Source/PhantomGames/Private/Cubetown/CubetownDirector.cpp", "AdventureCamera->FieldOfView = 48.0f"),
    "cubetown_forward_composition": (ROOT / "Source/PhantomGames/Private/Cubetown/CubetownDirector.cpp", "FVector(-420.0f, -6900.0f, 210.0f)"),
    "cubetown_camera_collision_proof_guard": (ROOT / "Source/PhantomGames/Private/Cubetown/CubetownDirector.cpp", "SpringArm->bDoCollisionTest = !(bLairCapture || bGameplayCapture)"),
    "cubetown_continuous_capture_lock": (ROOT / "Source/PhantomGames/Private/Cubetown/CubetownDirector.cpp", "const FVector CaptureTarget = CaptureView.Target"),
    "cubetown_lair_capture_survival": (ROOT / "Source/PhantomGames/Private/Cubetown/CubetownDirector.cpp", "if (FParse::Param(FCommandLine::Get(), TEXT(\"PhantomLairCapture\"))) return 0.0f"),
    "cubetown_cold_load_flush": (ROOT / "Source/PhantomGames/Private/Cubetown/CubetownDirector.cpp", "FlushLevelStreaming(EFlushLevelStreamingType::Full)"),
    "cubetown_streamed_capture_reassert": (ROOT / "Source/PhantomGames/Private/Cubetown/CubetownDirector.cpp", "FParse::Param(FCommandLine::Get(), TEXT(\"PhantomGameplayCapture\"))"),
    "cubetown_cold_start_fade": (ROOT / "Source/PhantomGames/Private/Cubetown/CubetownDirector.cpp", "StartCameraFade"),
    "cubetown_lair_objective_override": (ROOT / "Source/PhantomGames/Private/Cubetown/CubetownDirector.cpp", "DEFEAT LAIR GUARDIAN"),
    "cubetown_lair_proof_staging": (ROOT / "Source/PhantomGames/Private/Cubetown/CubetownDirector.cpp", "The evidence launch is a composed inspection frame"),
    "cubetown_production_world_population": (ROOT / "Source/PhantomGames/Private/Cubetown/CubetownDirector.cpp", "CubeV24CanopyA_HISM"),
    "cubetown_full_world_density_grid": (ROOT / "Source/PhantomGames/Private/Cubetown/CubetownDirector.cpp", "for (int32 GX=-23; GX<=23; ++GX)"),
    "cubetown_ten_meter_ground_cover": (ROOT / "Source/PhantomGames/Private/Cubetown/CubetownDirector.cpp", "for (int32 GX=-46; GX<=46; ++GX)"),
    "cubetown_six_meter_ground_cover": (ROOT / "Source/PhantomGames/Private/Cubetown/CubetownDirector.cpp", "for (int32 GX=-70; GX<=70; ++GX)"),
    "cubetown_region_capture_proof": (ROOT / "Source/PhantomGames/Private/Cubetown/CubetownDirector.cpp", "PhantomRegionCapture="),
    "cubetown_human_scale_capsule": (ROOT / "Source/PhantomGames/Private/Cubetown/CubetownDirector.cpp", "SetCapsuleHalfHeight(94.0f)"),
    "cubetown_human_mass_and_gravity": (ROOT / "Source/PhantomGames/Private/Cubetown/CubetownDirector.cpp", "GetCharacterMovement()->Mass = 76.0f"),
    "cubetown_grounded_acceleration": (ROOT / "Source/PhantomGames/Private/Cubetown/CubetownDirector.cpp", "MaxAcceleration = 1650.0f"),
    "cubetown_full_orbit_pitch": (ROOT / "Source/PhantomGames/Private/Cubetown/CubetownDirector.cpp", "-82.0f, -6.0f"),
    "cubetown_camera_relative_movement": (ROOT / "Source/PhantomGames/Private/Cubetown/CubetownDirector.cpp", "FRotationMatrix(FRotator(0.0f, Control.Yaw, 0.0f))"),
    "cubetown_animation_cadence": (ROOT / "Source/PhantomGames/Private/Cubetown/CubetownDirector.cpp", "SingleNode->SetPlayRate"),
    "cubetown_human_proportioned_mesh": (ROOT / "Source/PhantomGames/Private/Cubetown/CubetownDirector.cpp", "SKM_Manny_Simple"),
    "cubetown_blended_locomotion_graph": (ROOT / "Source/PhantomGames/Private/Cubetown/CubetownDirector.cpp", "ABP_Unarmed_C"),
    "cubetown_directional_blendspace": (ROOT / "Source/PhantomGames/Private/Cubetown/CubetownDirector.cpp", "LocomotionAnimClass"),
    "cubetown_backward_locomotion": (ROOT / "Source/PhantomGames/Private/Cubetown/CubetownDirector.cpp", "MF_Unarmed_Walk_Bwd"),
    "cubetown_strafe_locomotion": (ROOT / "Source/PhantomGames/Private/Cubetown/CubetownDirector.cpp", "MF_Unarmed_Jog_Left"),
    "cubetown_jump_locomotion": (ROOT / "Source/PhantomGames/Private/Cubetown/CubetownDirector.cpp", "MM_Land"),
    "cubetown_dodge_locomotion": (ROOT / "Source/PhantomGames/Private/Cubetown/CubetownDirector.cpp", "MM_Dash"),
    "cubetown_combo_locomotion": (ROOT / "Source/PhantomGames/Private/Cubetown/CubetownDirector.cpp", "MM_Attack_03"),
    "cubetown_locomotion_runtime_gate": (ROOT / "Source/PhantomGames/Private/Cubetown/CubetownDirector.cpp", "CUBETOWN LOCOMOTION RUNTIME"),
    "strike_deterministic_proof_view": (ROOT / "Source/PhantomGames/Private/Strike/PhantomStrikeDirector.cpp", "GameplayCaptureViewLockRemaining"),
    "strike_readable_camera_fov": (ROOT / "Source/PhantomGames/Private/Strike/PhantomStrikeDirector.cpp", "FirstPersonCamera->FieldOfView = 82.0f"),
    "legends_rejects_contaminated_fab_barracks": (ROOT / "Source/PhantomGames/Private/Legends/PhantomLegendsDirector.cpp", "SM_Fab_Barracks."),
    "legends_normalizes_legacy_tree_scale": (ROOT / "Source/PhantomGames/Private/Legends/PhantomLegendsDirector.cpp", "bOverscaledLegacyTree"),
}

failures=[]
for name,(path,needle) in checks.items():
    if not path.is_file():
        failures.append(f"{name}: missing {path.relative_to(ROOT)}")
        continue
    text=path.read_text(encoding="utf-8", errors="replace")
    if needle not in text:
        failures.append(f"{name}: expected marker missing")

# Guard against the V13 high-DPI bug returning in the base click path.
base=(ROOT/"Source/PhantomGames/Private/Core/PhantomGameDirectorBase.cpp").read_text(encoding="utf-8", errors="replace")
if "0.78f,1.18f" in base.replace(" ", ""):
    failures.append("shared_shell_scale: legacy 1.18 click cap still present")

legends=(ROOT/"Source/PhantomGames/Private/Legends/PhantomLegendsDirector.cpp").read_text(encoding="utf-8", errors="replace")
if "ConfigureLegendsProductionSkeletal" in legends:
    failures.append("legends_visuals: rejected production skeletal helper is still callable")
if "const bool bProductionSkeletal = false;" in legends:
    failures.append("legends_visuals: production humanoids are hard-disabled")

strike=(ROOT/"Source/PhantomGames/Private/Strike/PhantomStrikeDirector.cpp").read_text(encoding="utf-8", errors="replace")
if "const bool bProductionHumanoid = false;" in strike:
    failures.append("strike_visuals: production humanoids are hard-disabled")

ages=(ROOT/"Source/PhantomGames/Private/Ages/PhantomAgesDirector.cpp").read_text(encoding="utf-8", errors="replace")
if "const bool bProductionHumanoid = false;" in ages:
    failures.append("ages_visuals: production humanoids are hard-disabled")
if "if (AuthoredVisual || bProductionHumanoid)\n    {\n        const FBoxSphereBounds" in ages:
    failures.append("ages_visuals: skeletal path can dereference a missing static mesh")

cubetown=(ROOT/"Source/PhantomGames/Private/Cubetown/CubetownDirector.cpp").read_text(encoding="utf-8", errors="replace")
if "AddActorWorldOffset(Wish * GetCharacterMovement()->MaxWalkSpeed" in cubetown:
    failures.append("cubetown_physics: direct movement bypass returned")

if failures:
    print("PHANTOMPLAY V14 STATIC VALIDATION: FAIL")
    for failure in failures:
        print(" -", failure)
    sys.exit(1)

print("PHANTOMPLAY V14 STATIC VALIDATION: PASS")
for name in checks:
    print(" +", name)
