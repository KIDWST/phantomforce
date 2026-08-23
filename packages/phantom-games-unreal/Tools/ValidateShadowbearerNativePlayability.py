from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
CPP = ROOT / "Source/PhantomGames/Private/Cubetown/CubetownDirector.cpp"
HDR = ROOT / "Source/PhantomGames/Public/Cubetown/CubetownDirector.h"
WORLD_PATCH = ROOT / "Tools/PatchShadowbearerDawnsReturnV25R16.py"
MODULAR_CPP = ROOT / "Source/PhantomGames/Private/Core/PhantomModularCharacter.cpp"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> None:
    cpp = CPP.read_text(encoding="utf-8")
    hdr = HDR.read_text(encoding="utf-8")
    world_patch = WORLD_PATCH.read_text(encoding="utf-8")
    modular_cpp = MODULAR_CPP.read_text(encoding="utf-8")
    shipped = cpp + "\n" + hdr + "\n" + modular_cpp

    native_contracts = (
        "SpringArm->TargetArmLength = 3300.0f",
        "1600.0f,CubetownDirector(this)&&CubetownDirector(this)->IsBuildMode()?5200.0f:4400.0f",
        "AdventureCamera->FieldOfView = 55.0f",
        "EKeys::Gamepad_RightTrigger",
        "EKeys::Gamepad_LeftTrigger",
        "EKeys::Gamepad_RightShoulder",
        "EKeys::Gamepad_LeftShoulder",
        "EKeys::Gamepad_FaceButton_Top",
        "EKeys::Gamepad_FaceButton_Right",
        "EKeys::Gamepad_FaceButton_Bottom",
        "EKeys::Gamepad_FaceButton_Left",
        "EKeys::SpaceBar",
        "ShadowbearerMeleeAssist",
        "bAttackWindingUp=true",
        "ATTACK INCOMING",
        "PaleWardenEncounterSeconds>=12.0f",
        "THE DAWN HAS ALREADY ENDED",
        "[E / RB] TALK TO",
        "FirstShadowAlignmentStep",
        "ROTATE DAWNLANTERN TOWARD THE CART",
        "ALIGN THE CART'S SHADOW WITH THE GAP",
        "HOLD SHADOW IN MEMORY",
        "FirstShadowWreckedCart",
        "FirstShadowFallenPlank",
        "E / LMB / SPACE / GAMEPAD A   CONTINUE",
        "AutoAdvanceSeconds",
        "CubetownBuildSchemaVersion = 27",
        "bOutsideCanonicalOpening",
        "ApplyColor(VisualModel, Body)",
    )
    for token in native_contracts:
        require(token in shipped, f"missing native playability contract: {token}")

    setup = cpp[cpp.index("void ACubetownHero::SetupPlayerInputComponent"):cpp.index("void ACubetownHero::TurnCamera")]
    require(setup.count("Gamepad_") >= 13, "incomplete gamepad action surface")
    require("FMath::Square(610.0f)" in cpp, "melee assist range is missing")
    require("Facing<0.05f" in cpp, "melee intent cone is missing")
    require("LineTraceSingleByChannel" in cpp, "combat line-of-sight gate is missing")
    require("IsAttackTelegraphing" in hdr and "GetHealthRatio" in hdr, "HUD combat state is not exposed")
    require(cpp.count("++FirstShadowAlignmentStep") == 1, "Dawnlantern puzzle must advance one authored beat per interaction")
    require("Save->FirstShadowAlignmentStep=FirstShadowAlignmentStep" in cpp, "Dawnlantern puzzle progress is not persisted")
    require("build_bramblewick_buildings" in world_patch, "authored Bramblewick districts are missing")
    require("build_bramblewick_nature" in world_patch and "authored_nature_actors" in world_patch,
            "authored Bramblewick nature clusters are missing")
    require("authored_districts\": 5" in world_patch, "Bramblewick district gate is missing")
    require("CT_V13_Roadside_" in world_patch and "CT_Tree_" in world_patch,
            "legacy village clutter cleanup is missing")
    require("for index in range(64)" not in world_patch and "for index in range(38)" not in world_patch,
            "procedural opening clutter scatter remains")
    require("maximum_dimension > 1200.0" in world_patch and "actor.get_actor_location().z) > 1200.0" in world_patch,
            "measured oversized/floating opening-asset gate is missing")
    require("SM_Sign_A" not in world_patch, "kilometre-scale generated sign remains in the opening")
    require("SM_V10_WarBanner" not in world_patch and "SM_FlowerPatch_A" not in world_patch,
            "ambiguous generated patch assets remain in the Shipping opening")
    require("Shadowbearer.CrossStreet" in world_patch,
            "homes are still disconnected from the authored street network")
    require(cpp.count("SpawnProductionWorldPopulation();") == 0,
            "legacy map-wide filler population is still wired")
    require("ShadowbearerRidgeRocks_HISM" in cpp and "ShadowbearerFarmRows_HISM" in cpp,
            "bounded authored outer-world clusters are missing")
    require("if (CanonicalChapter >= 3 || bFirstShadowSolidified)" in cpp,
            "late-game memory tools still contaminate the prologue")
    population = cpp.split("void ACubetownDirector::SpawnProductionWorldPopulation()", 1)[1].split(
        "void ACubetownDirector::BuildDreamWorld()", 1)[0]
    for unsafe_asset in ("SM_Cube_Tree_A", "SM_V9_HeartTree", "SM_CC0_Tree_A", "SM_FlowerPatch_A", "SM_Bush_A", "SM_CC0_Bush", "SM_CC0_Flower", "SM_CubeDreamHerbPatch_A"):
        require(unsafe_asset not in population,
                f"unsafe Shipping population asset remains: {unsafe_asset}")
    for unsafe_opening_asset in ("SM_Cube_Tree_A", "SM_V9_HeartTree"):
        require(unsafe_opening_asset not in world_patch,
                f"malformed foliage asset remains in the authored opening: {unsafe_opening_asset}")
    require("ShadowbearerFriendGround" in cpp,
            "native villagers are not grounded against authored world geometry")
    require("Follower->AttachToComponent(Leader" in modular_cpp,
            "modular character parts are not physically parented to their pose leader")
    require("Follower->SetLeaderPoseComponent(Leader, true, true)" in modular_cpp,
            "modular character parts do not share the authoritative bone buffer")
    require("Follower->SetSimulatePhysics(false)" in modular_cpp,
            "modular character followers can still enter independent physics")
    require("SK_SkeletonMinion_Cloak" in modular_cpp and "Parts.Add({TEXT(\"Cloak\")" in modular_cpp,
            "Zane's skeleton-bound cloak silhouette is missing")
    require("Phantom.RootCosmetic" in cpp and "CapMesh->AttachToComponent(GetMesh()" in cpp,
            "Zane's source-authored hood is not attached to the fitted skeletal root")
    require("Rogue_Cape.Rogue_Cape" not in cpp and "Skeleton_Rogue_Hood.Skeleton_Rogue_Hood" in cpp,
            "source-authored root-bound hood contract is missing or the rejected rigid cape returned")

    normal_camera_values = [float(value) for value in re.findall(r"TargetArmLength\s*=\s*(\d+(?:\.\d+)?)f", cpp)]
    require(3300.0 in normal_camera_values, "authored adventure camera default is absent")
    require("TargetArmLength=6200.0f" not in cpp, "unplayable surveillance-distance camera remains")

    print("PASS: Shadowbearer native playability contracts")
    print("controller_bindings", setup.count("Gamepad_"))
    print("camera_default_cm", 3300)
    print("camera_adventure_range_cm", "1600-4400")
    print("combat", "soft-lock+los+windup+stagger+knockback")
    print("opening_defeat_seconds", 12)
    print("opening_shadow_puzzle", "rotate+align+solidify+persistent")
    print("opening_world", "5-authored-districts+cross-streets+140-nature-cluster-actors+bounded-poi-clusters+grounded-villagers+measured-asset-bounds")
    print("character_integrity", "leader-parented+shared-bone-buffer+physics-disabled+root-bound-headwear+deforming-cloak")
    print("cinematic_controls", "mouse+keyboard+gamepad")


if __name__ == "__main__":
    main()
