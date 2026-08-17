#include "Cubetown/CubetownDirector.h"
#include "Core/PhantomGameShell.h"
#include "Core/PhantomInteractionSpec.h"
#include "Core/PhantomModularCharacter.h"

#include "Camera/CameraComponent.h"
#include "Components/CapsuleComponent.h"
#include "Components/SceneComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Components/SkeletalMeshComponent.h"
#include "Engine/SkeletalMesh.h"
#include "Animation/AnimSequence.h"
#include "Engine/Canvas.h"
#include "Engine/Engine.h"
#include "Engine/StaticMeshActor.h"
#include "Engine/Texture2D.h"
#include "Engine/DirectionalLight.h"
#include "Engine/PointLight.h"
#include "Components/DirectionalLightComponent.h"
#include "Components/PointLightComponent.h"
#include "EngineUtils.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "GameFramework/PlayerController.h"
#include "GameFramework/SpringArmComponent.h"
#include "InputCoreTypes.h"
#include "Kismet/GameplayStatics.h"
#include "Materials/MaterialInstanceDynamic.h"

namespace
{
    constexpr TCHAR CubetownSaveSlot[] = TEXT("cubetown.echoes.profile");
    constexpr float CubeSize = 100.0f;

    ACubetownDirector* CubetownDirector(const UObject* Context)
    {
        if (!Context || !Context->GetWorld()) return nullptr;
        for (TActorIterator<ACubetownDirector> It(Context->GetWorld()); It; ++It) return *It;
        return nullptr;
    }

    bool AdventureTrace(APlayerController* PlayerController, FHitResult& OutHit)
    {
        if (!PlayerController) return false;
        if (PlayerController->bShowMouseCursor)
        {
            return PlayerController->GetHitResultUnderCursor(ECC_Visibility, true, OutHit);
        }
        int32 ViewportWidth = 0;
        int32 ViewportHeight = 0;
        PlayerController->GetViewportSize(ViewportWidth, ViewportHeight);
        if (ViewportWidth <= 0 || ViewportHeight <= 0) return false;
        return PlayerController->GetHitResultAtScreenPosition(
            FVector2D(ViewportWidth * 0.5f, ViewportHeight * 0.5f),
            ECC_Visibility,
            true,
            OutHit
        );
    }

    void ApplyColor(UStaticMeshComponent* Mesh, const FLinearColor& Color)
    {
        if (!Mesh) return;
        UMaterialInterface* Base = LoadObject<UMaterialInterface>(
            nullptr,
            TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial")
        );
        if (!Base) return;
        UMaterialInstanceDynamic* Material = UMaterialInstanceDynamic::Create(Base, Mesh);
        Material->SetVectorParameterValue(TEXT("Color"), Color);
        Mesh->SetMaterial(0, Material);
    }


    bool ConfigureProductionSkeletalCharacter(
        ACharacter* Character,
        const TCHAR* MeshPath,
        const TCHAR* IdleAnimPath,
        float TargetHeightCm,
        float YawOffset = -90.0f
    )
    {
        if (!Character || !Character->GetCapsuleComponent()) return false;
        return PhantomModularCharacter::Configure(
            Character,
            Character->GetMesh(),
            Character->GetCapsuleComponent(),
            MeshPath,
            IdleAnimPath,
            TargetHeightCm,
            -Character->GetCapsuleComponent()->GetUnscaledCapsuleHalfHeight(),
            YawOffset
        );
    }


    FLinearColor BlockColor(ECubetownBlockType Type)
    {
        switch (Type)
        {
            case ECubetownBlockType::Grass: return FLinearColor(0.16f, 0.58f, 0.22f);
            case ECubetownBlockType::Stone: return FLinearColor(0.38f, 0.44f, 0.5f);
            case ECubetownBlockType::Amber: return FLinearColor(0.94f, 0.42f, 0.08f);
            case ECubetownBlockType::Crystal: return FLinearColor(0.25f, 0.82f, 1.0f);
            case ECubetownBlockType::Wood: return FLinearColor(0.38f, 0.16f, 0.045f);
            case ECubetownBlockType::Water: return FLinearColor(0.04f, 0.32f, 0.72f);
        }
        return FLinearColor::White;
    }

    const TCHAR* BlockName(ECubetownBlockType Type)
    {
        switch (Type)
        {
            case ECubetownBlockType::Grass: return TEXT("GRASS");
            case ECubetownBlockType::Stone: return TEXT("STONE");
            case ECubetownBlockType::Amber: return TEXT("AMBER");
            case ECubetownBlockType::Crystal: return TEXT("CRYSTAL");
            case ECubetownBlockType::Wood: return TEXT("WOOD");
            case ECubetownBlockType::Water: return TEXT("WATER");
        }
        return TEXT("BLOCK");
    }

    const TCHAR* EchoName(ECubetownEchoType Type)
    {
        switch (Type)
        {
            case ECubetownEchoType::Blade: return TEXT("BLADE ECHO");
            case ECubetownEchoType::Boulder: return TEXT("BOULDER ECHO");
            case ECubetownEchoType::Bloom: return TEXT("BLOOM ECHO");
        }
        return TEXT("ECHO");
    }

    const TCHAR* FriendName(ECubetownFriend Friend)
    {
        switch (Friend)
        {
            case ECubetownFriend::Mira: return TEXT("MIRA");
            case ECubetownFriend::Rowan: return TEXT("ROWAN");
            case ECubetownFriend::Pip: return TEXT("PIP");
        }
        return TEXT("FRIEND");
    }

    // CubeTown deliberately does not use the dark sci-fi Phantom shell. The hit rectangles stay
    // identical to the shared shell so the base director's mouse handling remains valid, while
    // the presentation becomes warm, storybook-like, and lets the live dream world remain visible.
    bool DrawCubetownDreamShell(AHUD* HUD, const APhantomGameDirectorBase* Director, float Width, float Height)
    {
        if (!HUD || !Director || !Director->IsShellVisible()) return false;
        // Preserve a readable physical text size on high-DPI 1440p and 4K displays. The previous
        // 1.18 cap left the shell at near-1080p dimensions even when the backbuffer was twice as tall.
        const float Scale=FMath::Clamp(FMath::Min(Width/1920.0f,Height/1080.0f),0.78f,1.75f);
        const auto S=[Scale](float V){return V*Scale;};
        const float Margin=S(54.0f), PanelW=FMath::Min(Width-Margin*2.0f,S(1060.0f)), PanelH=FMath::Min(Height-Margin*2.0f,S(650.0f));
        const float PanelX=Margin, PanelY=(Height-PanelH)*0.5f;
        const FLinearColor Berry(0.58f,0.055f,0.13f,1.0f), Ruby(0.82f,0.12f,0.22f,1.0f), Cream(0.94f,0.88f,0.72f,0.98f);
        const FLinearColor Ink(0.13f,0.075f,0.10f,1.0f), Moss(0.20f,0.34f,0.19f,1.0f), Paper(0.16f,0.09f,0.12f,0.93f);
        if(Director->GetShellScreen()==EPhantomShellScreen::Title)
        {
            if(UTexture2D* Hero=LoadObject<UTexture2D>(nullptr,TEXT("/Game/Phantom/VisualTargets/CubeTown_TARGET.CubeTown_TARGET")))
                DrawPhantomAspectFillTexture(HUD,Hero,Width,Height);
        }
        HUD->DrawRect(FLinearColor(0.05f,0.025f,0.055f,0.48f),0,0,Width,Height);
        HUD->DrawRect(FLinearColor(0.10f,0.035f,0.07f,0.82f),0,0,Width,S(8.0f));
        HUD->DrawRect(Paper,PanelX,PanelY,PanelW,PanelH);
        HUD->DrawRect(Berry,PanelX,PanelY,S(8.0f),PanelH);
        HUD->DrawRect(FLinearColor(0.95f,0.67f,0.28f,0.18f),PanelX+S(8),PanelY,S(15),PanelH);
        HUD->DrawText(TEXT("CUBETOWN"),Cream,PanelX+S(48),PanelY+S(36),nullptr,S(1.78f));
        HUD->DrawText(TEXT("A FOUR-SEASONS DREAM // FRIENDS, CREATION, ADVENTURE"),FLinearColor(0.95f,0.70f,0.66f),PanelX+S(50),PanelY+S(98),nullptr,S(0.72f));
        HUD->DrawText(TEXT("THE RED TREES STAY"),Ruby,PanelX+PanelW-S(270),PanelY+S(48),nullptr,S(0.60f));
        const float CardX=PanelX+S(44),CardY=PanelY+S(154),CardW=PanelW-S(88),CardH=PanelH-S(202);
        HUD->DrawRect(FLinearColor(0.10f,0.055f,0.07f,0.90f),CardX,CardY,CardW,CardH);
        float MX=-9999,MY=-9999; if(APlayerController* PC=HUD->GetOwningPlayerController()) PC->GetMousePosition(MX,MY);
        auto Button=[&](const FString& Label,float Y,bool Primary=false,bool Danger=false)
        {
            const float X=CardX+S(34),W=FMath::Min(CardW-S(68),S(560)),H=S(52);
            const bool Hover=MX>=X&&MX<=X+W&&MY>=Y&&MY<=Y+H;
            FLinearColor Fill=Primary?FLinearColor(0.42f,0.09f,0.13f,0.98f):FLinearColor(0.18f,0.10f,0.12f,0.98f);
            if(Hover) Fill=Primary?FLinearColor(0.56f,0.12f,0.17f,1.0f):FLinearColor(0.27f,0.15f,0.17f,1.0f);
            HUD->DrawRect(Fill,X,Y,W,H); HUD->DrawRect(Danger?FLinearColor(0.95f,0.30f,0.28f):Primary?Ruby:FLinearColor(0.42f,0.31f,0.25f),X,Y,S(5),H);
            HUD->DrawText(Label,Danger?FLinearColor(1.0f,0.62f,0.58f):Cream,X+S(22),Y+S(13),nullptr,S(0.80f));
        };
        const EPhantomShellScreen Screen=Director->GetShellScreen();
        if(Screen==EPhantomShellScreen::Title)
        {
            HUD->DrawText(TEXT("WAKE UP SOMEWHERE IMPOSSIBLE."),FLinearColor(0.96f,0.68f,0.56f),CardX+S(34),CardY+S(26),nullptr,S(0.70f));
            Button(TEXT("[ENTER]  BEGIN ADVENTURE"),CardY+S(70),true); Button(TEXT("[F1]  CONTROLS"),CardY+S(136)); Button(TEXT("[F2]  SETTINGS"),CardY+S(202)); Button(TEXT("[Q / ESC]  LEAVE CUBETOWN"),CardY+S(286),false,true);
        }
        else if(Screen==EPhantomShellScreen::Pause)
        {
            HUD->DrawText(TEXT("THE DREAM WAITS"),Cream,CardX+S(34),CardY+S(26),nullptr,S(0.95f));
            Button(TEXT("[ENTER / ESC]  RETURN"),CardY+S(88),true); Button(TEXT("[F1]  CONTROLS"),CardY+S(154)); Button(TEXT("[F2]  SETTINGS"),CardY+S(220)); Button(TEXT("[Q]  QUIT TO DESKTOP"),CardY+S(304),false,true);
        }
        else if(Screen==EPhantomShellScreen::Controls)
        {
            HUD->DrawText(TEXT("HOW TO PLAY"),Cream,CardX+S(34),CardY+S(26),nullptr,S(0.96f));
            HUD->DrawText(TEXT("WASD move   MOUSE look   SHIFT sprint   SPACE jump/climb   CTRL crouch   ALT dodge\nLMB combo   RMB guard/parry   E interact   F lock target   HOLD Q Creation   B Build Mode\nTAB inventory   M map   J journal\nBUILD: 1 prefab  2 wall  3 room  4 fence  5 garden  6 decor   [/] catalog   Q/E rotate   CTRL+Z/Y undo/redo"),FLinearColor(0.92f,0.82f,0.72f),CardX+S(36),CardY+S(88),nullptr,S(0.70f));
            Button(TEXT("[ENTER / ESC]  BACK"),CardY+CardH-S(76),true);
        }
        else
        {
            HUD->DrawText(TEXT("SETTINGS"),Cream,CardX+S(34),CardY+S(26),nullptr,S(0.96f));
            HUD->DrawText(FString::Printf(TEXT("MASTER VOLUME     %d%%"),FMath::RoundToInt(Director->GetMasterVolume()*100.0f)),Cream,CardX+S(36),CardY+S(104),nullptr,S(0.80f));
            HUD->DrawRect(FLinearColor(0.12f,0.08f,0.08f),CardX+S(36),CardY+S(145),S(480),S(12));
            HUD->DrawRect(Ruby,CardX+S(36),CardY+S(145),S(480)*Director->GetMasterVolume(),S(12));
            HUD->DrawText(FString::Printf(TEXT("GRAPHICS QUALITY  %s"),*Director->GetGraphicsQualityLabel()),Cream,CardX+S(36),CardY+S(212),nullptr,S(0.80f));
            HUD->DrawText(TEXT("LEFT / RIGHT volume      UP / DOWN graphics"),FLinearColor(0.78f,0.70f,0.65f),CardX+S(36),CardY+S(262),nullptr,S(0.66f));
            Button(TEXT("[ENTER / ESC]  BACK"),CardY+CardH-S(76),true);
        }
        return true;
    }
}


ACubetownBlock::ACubetownBlock()
{
    PrimaryActorTick.bCanEverTick = false;
    BlockMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("VoxelBlock"));
    SetRootComponent(BlockMesh);
    BlockMesh->SetStaticMesh(LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cube.Cube")));

    SurfaceDetail = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("SurfaceDetail"));
    SurfaceDetail->SetupAttachment(BlockMesh);
    SurfaceDetail->SetStaticMesh(LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cube.Cube")));
    SurfaceDetail->SetRelativeLocation(FVector(0.0f, 0.0f, 49.0f));
    SurfaceDetail->SetRelativeScale3D(FVector(0.91f, 0.91f, 0.035f));
    SurfaceDetail->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    SurfaceDetail->SetCastShadow(false);
}

void ACubetownBlock::Configure(ECubetownBlockType NewType, const FIntVector& NewGrid, bool bNewMineable)
{
    BlockType=NewType; Grid=NewGrid; bMineable=bNewMineable;
    struct FResourceVisual{const TCHAR* Path; FVector Scale; FVector Offset;};
    FResourceVisual Visual{TEXT("/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamHerbPatch_A.SM_CubeDreamHerbPatch_A"),FVector(0.72f),FVector::ZeroVector};
    switch(BlockType)
    {
        case ECubetownBlockType::Stone: Visual={TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Rock.SM_CC0_Rock"),FVector(0.58f),FVector::ZeroVector}; break;
        case ECubetownBlockType::Amber: Visual={TEXT("/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamRockCluster_Ember.SM_CubeDreamRockCluster_Ember"),FVector(0.46f),FVector::ZeroVector}; break;
        case ECubetownBlockType::Crystal: Visual={TEXT("/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamCrystalCluster_A.SM_CubeDreamCrystalCluster_A"),FVector(0.70f),FVector::ZeroVector}; break;
        case ECubetownBlockType::Wood: Visual={TEXT("/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamLogPile_A.SM_CubeDreamLogPile_A"),FVector(0.68f),FVector::ZeroVector}; break;
        case ECubetownBlockType::Water: Visual={TEXT("/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamFlowerPatch_A.SM_CubeDreamFlowerPatch_A"),FVector(0.48f),FVector::ZeroVector}; break;
        default: break;
    }
    UStaticMesh* Mesh=LoadObject<UStaticMesh>(nullptr,Visual.Path);
    if(Mesh)
    {
        BlockMesh->SetStaticMesh(Mesh); BlockMesh->SetRelativeLocation(Visual.Offset); BlockMesh->SetRelativeScale3D(Visual.Scale);
        SurfaceDetail->SetVisibility(false); SetActorScale3D(FVector(1.0f));
    }
    else
    {
        BlockMesh->SetStaticMesh(LoadObject<UStaticMesh>(nullptr,TEXT("/Engine/BasicShapes/Sphere.Sphere")));
        BlockMesh->SetRelativeScale3D(FVector(0.42f,0.42f,0.30f)); ApplyColor(BlockMesh,BlockColor(BlockType)); SurfaceDetail->SetVisibility(false);
    }
    Tags.Add(FName(*FString::Printf(TEXT("Cube.Resource.%s"),BlockName(BlockType))));
}

ACubetownShrine::ACubetownShrine()
{
    PrimaryActorTick.bCanEverTick = true;
    Root = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
    SetRootComponent(Root);
    UStaticMesh* Cube = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cube.Cube"));
    UStaticMesh* Cylinder = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
    UStaticMesh* Sphere = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Sphere.Sphere"));
    Pedestal = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Pedestal"));
    Pedestal->SetupAttachment(Root);
    Pedestal->SetStaticMesh(Cylinder);
    Pedestal->SetRelativeLocation(FVector(0.0f, 0.0f, 45.0f));
    Pedestal->SetRelativeScale3D(FVector(1.05f, 1.05f, 0.45f));
    RuneCore = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("RuneCore"));
    RuneCore->SetupAttachment(Root);
    RuneCore->SetStaticMesh(Sphere);
    RuneCore->SetRelativeLocation(FVector(0.0f, 0.0f, 145.0f));
    RuneCore->SetRelativeScale3D(FVector(0.52f));
    RuneCore->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    Ring = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("WisdomRing"));
    Ring->SetupAttachment(Root);
    Ring->SetStaticMesh(Cylinder);
    Ring->SetRelativeLocation(FVector(0.0f, 0.0f, 145.0f));
    Ring->SetRelativeScale3D(FVector(0.85f, 0.85f, 0.08f));
    Ring->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    LeftPillar = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("LeftPillar"));
    LeftPillar->SetupAttachment(Root);
    LeftPillar->SetStaticMesh(Cube);
    LeftPillar->SetRelativeLocation(FVector(-105.0f, 0.0f, 90.0f));
    LeftPillar->SetRelativeScale3D(FVector(0.34f, 0.34f, 1.8f));
    RightPillar = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("RightPillar"));
    RightPillar->SetupAttachment(Root);
    RightPillar->SetStaticMesh(Cube);
    RightPillar->SetRelativeLocation(FVector(105.0f, 0.0f, 90.0f));
    RightPillar->SetRelativeScale3D(FVector(0.34f, 0.34f, 1.8f));
}

void ACubetownShrine::Configure(int32 NewIndex)
{
    ShrineIndex = NewIndex;
    UStaticMesh* GeneratedShrine = LoadObject<UStaticMesh>(nullptr, TEXT("/Game/Phantom/Generated/Cubetown/SM_CubetownShrine.SM_CubetownShrine"));
    bUsingGeneratedShrine = GeneratedShrine != nullptr;
    if (bUsingGeneratedShrine)
    {
        Pedestal->SetStaticMesh(GeneratedShrine);
        Pedestal->SetRelativeLocation(FVector::ZeroVector);
        Pedestal->SetRelativeScale3D(FVector(0.86f));
        LeftPillar->SetVisibility(false);
        RightPillar->SetVisibility(false);
        Ring->SetRelativeScale3D(FVector(0.72f, 0.72f, 0.055f));
        RuneCore->SetRelativeLocation(FVector(0.0f, 0.0f, 165.0f));
    }
    static const FLinearColor ShrineColors[] = {
        FLinearColor(0.12f, 0.88f, 1.0f),
        FLinearColor(1.0f, 0.52f, 0.08f),
        FLinearColor(0.62f, 0.14f, 1.0f)
    };
    const FLinearColor Accent = ShrineColors[FMath::Clamp(ShrineIndex, 0, 2)];
    const FLinearColor PedestalColor = bUsingGeneratedShrine
        ? FLinearColor(0.12f + Accent.R * 0.34f, 0.13f + Accent.G * 0.34f, 0.15f + Accent.B * 0.34f, 1.0f)
        : FLinearColor(0.18f, 0.20f, 0.26f, 1.0f);
    ApplyColor(Pedestal, PedestalColor);
    ApplyColor(RuneCore, Accent * 0.28f);
    ApplyColor(Ring, Accent * 0.2f);
    ApplyColor(LeftPillar, FLinearColor(0.28f, 0.32f, 0.38f));
    ApplyColor(RightPillar, FLinearColor(0.28f, 0.32f, 0.38f));
}

void ACubetownShrine::Activate()
{
    if (bActive) return;
    bActive = true;
    static const FLinearColor ShrineColors[] = {
        FLinearColor(0.12f, 0.88f, 1.0f),
        FLinearColor(1.0f, 0.52f, 0.08f),
        FLinearColor(0.62f, 0.14f, 1.0f)
    };
    const FLinearColor Accent = ShrineColors[FMath::Clamp(ShrineIndex, 0, 2)];
    ApplyColor(RuneCore, Accent);
    ApplyColor(Ring, Accent * 0.75f);
}

void ACubetownShrine::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    RuneCore->AddLocalRotation(FRotator(0.0f, DeltaSeconds * (bActive ? 95.0f : 28.0f), 0.0f));
    Ring->AddLocalRotation(FRotator(0.0f, DeltaSeconds * (bActive ? -72.0f : -16.0f), 0.0f));
    const float Float = FMath::Sin(GetWorld()->GetTimeSeconds() * (bActive ? 3.5f : 1.5f) + ShrineIndex) * 12.0f;
    RuneCore->SetRelativeLocation(FVector(0.0f, 0.0f, 145.0f + Float));
}

ACubetownEnemy::ACubetownEnemy()
{
    PrimaryActorTick.bCanEverTick = true;
    AutoPossessAI = EAutoPossessAI::PlacedInWorldOrSpawned;
    GetCapsuleComponent()->SetCapsuleRadius(38.0f);
    GetCapsuleComponent()->SetCapsuleHalfHeight(58.0f);
    GetCapsuleComponent()->SetCollisionResponseToChannel(ECC_Visibility, ECR_Block);
    GetMesh()->SetVisibility(false, true);
    UStaticMesh* Cube = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cube.Cube"));
    UStaticMesh* Sphere = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Sphere.Sphere"));
    UStaticMesh* Cone = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cone.Cone"));
    BodyMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("EnemyBody"));
    BodyMesh->SetupAttachment(GetCapsuleComponent());
    BodyMesh->SetStaticMesh(Cube);
    BodyMesh->SetRelativeLocation(FVector(0.0f, 0.0f, -12.0f));
    BodyMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    EyeMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Eye"));
    EyeMesh->SetupAttachment(GetCapsuleComponent());
    EyeMesh->SetStaticMesh(Sphere);
    EyeMesh->SetRelativeLocation(FVector(34.0f, 0.0f, 4.0f));
    EyeMesh->SetRelativeScale3D(FVector(0.18f));
    EyeMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    CrestMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Crest"));
    CrestMesh->SetupAttachment(GetCapsuleComponent());
    CrestMesh->SetStaticMesh(Cone);
    CrestMesh->SetRelativeLocation(FVector(0.0f, 0.0f, 48.0f));
    CrestMesh->SetRelativeScale3D(FVector(0.34f, 0.34f, 0.62f));
    CrestMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);

    VisualModel = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("EnemyAuthoredVisual"));
    VisualModel->SetupAttachment(GetCapsuleComponent());
    VisualModel->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    VisualModel->SetVisibility(false);

    GetCharacterMovement()->MaxWalkSpeed = 340.0f;
    GetCharacterMovement()->MaxAcceleration = 1800.0f;
    GetCharacterMovement()->BrakingDecelerationWalking = 1500.0f;
    GetCharacterMovement()->bOrientRotationToMovement = true;
    GetCharacterMovement()->bRunPhysicsWithNoController = true;
}

void ACubetownEnemy::Configure(ECubetownEnemyType NewType, int32 Tier)
{
    EnemyType = NewType;
    const int32 SafeTier = FMath::Max(1, Tier);

    const TCHAR* ProductionMeshPath = EnemyType == ECubetownEnemyType::BloomWisp
        ? TEXT("/Game/Phantom/Characters/Production/SK_SkeletonMage.SK_SkeletonMage")
        : (EnemyType == ECubetownEnemyType::Roller
            ? TEXT("/Game/Phantom/Characters/Production/SK_SkeletonRogue.SK_SkeletonRogue")
            : TEXT("/Game/Phantom/Characters/Production/SK_SkeletonMinion.SK_SkeletonMinion"));
    const TCHAR* ProductionAnimPath = EnemyType == ECubetownEnemyType::BloomWisp
        ? TEXT("/Game/Phantom/Characters/Production/Animations/A_SkeletonMage_Idle.A_SkeletonMage_Idle")
        : (EnemyType == ECubetownEnemyType::Roller
            ? TEXT("/Game/Phantom/Characters/Production/Animations/A_SkeletonRogue_Idle.A_SkeletonRogue_Idle")
            : TEXT("/Game/Phantom/Characters/Production/Animations/A_SkeletonMinion_Idle.A_SkeletonMinion_Idle"));
    const bool bProductionEnemy = ConfigureProductionSkeletalCharacter(
        this, ProductionMeshPath, ProductionAnimPath,
        EnemyType == ECubetownEnemyType::RiftGuardian ? 260.0f : 172.0f,
        -90.0f
    );

    const TCHAR* ModernPath = EnemyType == ECubetownEnemyType::Roller
        ? TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Creature_B.SM_CC0_Creature_B")
        : (EnemyType == ECubetownEnemyType::BloomWisp
            ? TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Creature_C.SM_CC0_Creature_C")
            : TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Creature_A.SM_CC0_Creature_A"));
    UStaticMesh* Authored = bProductionEnemy ? nullptr : (EnemyType == ECubetownEnemyType::RiftGuardian ? nullptr : LoadObject<UStaticMesh>(nullptr, ModernPath));
    if (!Authored && !bProductionEnemy)
    {
        const TCHAR* FallbackPath = EnemyType == ECubetownEnemyType::Roller
            ? TEXT("/Game/Phantom/Generated/Cubetown/Characters/SM_Roller.SM_Roller")
            : (EnemyType == ECubetownEnemyType::BloomWisp
                ? TEXT("/Game/Phantom/Generated/Cubetown/Characters/SM_BloomWisp.SM_BloomWisp")
                : (EnemyType == ECubetownEnemyType::RiftGuardian
                    ? TEXT("/Game/Phantom/Generated/Cubetown/SM_CubetownGuardian.SM_CubetownGuardian")
                    : TEXT("/Game/Phantom/Generated/Cubetown/Characters/SM_Gloomling.SM_Gloomling")));
        Authored = LoadObject<UStaticMesh>(nullptr, FallbackPath);
    }
    if (Authored)
    {
        VisualModel->SetStaticMesh(Authored);
        VisualModel->SetRelativeLocation(EnemyType == ECubetownEnemyType::RiftGuardian ? FVector(0.0f,0.0f,-58.0f) : FVector(0.0f,0.0f,-50.0f));
        VisualModel->SetRelativeScale3D(EnemyType == ECubetownEnemyType::RiftGuardian ? FVector(0.72f) : FVector(0.82f));
        VisualModel->SetVisibility(true);
        BodyMesh->SetVisibility(false);
        EyeMesh->SetVisibility(false);
        CrestMesh->SetVisibility(false);
    }
    if (EnemyType == ECubetownEnemyType::Roller)
    {
        BodyMesh->SetStaticMesh(LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Sphere.Sphere")));
        BodyMesh->SetRelativeScale3D(FVector(0.66f));
        Health = 105.0f + SafeTier * 12.0f;
        Damage = 13.0f + SafeTier;
        AttackRange = 115.0f;
        GetCharacterMovement()->MaxWalkSpeed = 470.0f;
        ApplyColor(BodyMesh, FLinearColor(0.82f, 0.28f, 0.045f));
        ApplyColor(CrestMesh, FLinearColor(1.0f, 0.64f, 0.08f));
    }
    else if (EnemyType == ECubetownEnemyType::BloomWisp)
    {
        BodyMesh->SetStaticMesh(LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Sphere.Sphere")));
        BodyMesh->SetRelativeScale3D(FVector(0.5f));
        BodyMesh->SetRelativeLocation(FVector(0.0f, 0.0f, 32.0f));
        Health = 72.0f + SafeTier * 9.0f;
        Damage = 9.0f + SafeTier;
        AttackRange = 420.0f;
        AttackInterval = 1.15f;
        ApplyColor(BodyMesh, FLinearColor(0.18f, 0.85f, 0.42f));
        ApplyColor(CrestMesh, FLinearColor(0.85f, 1.0f, 0.22f));
    }
    else if (EnemyType == ECubetownEnemyType::RiftGuardian)
    {
        if (UStaticMesh* GuardianMesh = LoadObject<UStaticMesh>(nullptr, TEXT("/Game/Phantom/Generated/Cubetown/SM_CubetownGuardian.SM_CubetownGuardian")))
        {
            BodyMesh->SetStaticMesh(GuardianMesh);
            BodyMesh->SetRelativeLocation(FVector(0.0f, 0.0f, -52.0f));
            BodyMesh->SetRelativeScale3D(FVector(0.58f));
            CrestMesh->SetVisibility(false);
            EyeMesh->SetRelativeLocation(FVector(62.0f, 0.0f, 55.0f));
            EyeMesh->SetRelativeScale3D(FVector(0.22f));
        }
        else
        {
            BodyMesh->SetRelativeScale3D(FVector(1.35f, 1.15f, 1.55f));
            EyeMesh->SetRelativeLocation(FVector(92.0f, 0.0f, 26.0f));
            EyeMesh->SetRelativeScale3D(FVector(0.35f));
            CrestMesh->SetRelativeLocation(FVector(0.0f, 0.0f, 128.0f));
            CrestMesh->SetRelativeScale3D(FVector(0.72f, 0.72f, 1.4f));
        }
        Health = 820.0f;
        Damage = 26.0f;
        AttackRange = 165.0f;
        AttackInterval = 0.95f;
        GetCharacterMovement()->MaxWalkSpeed = 280.0f;
        ApplyColor(BodyMesh, FLinearColor(0.2f, 0.02f, 0.42f));
        ApplyColor(CrestMesh, FLinearColor(0.68f, 0.08f, 1.0f));
    }
    else
    {
        BodyMesh->SetRelativeScale3D(FVector(0.58f, 0.52f, 0.62f));
        Health = 78.0f + SafeTier * 10.0f;
        Damage = 9.0f + SafeTier;
        ApplyColor(BodyMesh, FLinearColor(0.16f, 0.04f, 0.28f));
        ApplyColor(CrestMesh, FLinearColor(0.56f, 0.12f, 0.92f));
    }
    ApplyColor(EyeMesh, FLinearColor(1.0f, 0.18f, 0.34f));
    AttackRemaining = FMath::FRandRange(0.1f, AttackInterval);

    // V11 skeletal character is authoritative. Never let later role styling re-enable prototype primitives.
    if (bProductionEnemy)
    {
        BodyMesh->SetVisibility(false); EyeMesh->SetVisibility(false); CrestMesh->SetVisibility(false);
        VisualModel->SetVisibility(false);
    }
}

void ACubetownEnemy::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    AttackRemaining = FMath::Max(0.0f, AttackRemaining - DeltaSeconds);
    ACubetownHero* Hero = Cast<ACubetownHero>(UGameplayStatics::GetPlayerCharacter(this, 0));
    if (!Hero) return;
    AActor* Target = Hero;
    float BestTargetDistance = FVector::DistSquared2D(GetActorLocation(), Hero->GetActorLocation());
    for (TActorIterator<ACubetownEcho> It(GetWorld()); It; ++It)
    {
        const float EchoDistance = FVector::DistSquared2D(GetActorLocation(), It->GetActorLocation());
        if (EchoDistance < BestTargetDistance && EchoDistance < FMath::Square(620.0f))
        {
            Target = *It;
            BestTargetDistance = EchoDistance;
        }
    }
    const FVector Offset = Target->GetActorLocation() - GetActorLocation();
    const float Distance = Offset.Size2D();
    if (Distance > AttackRange)
    {
        AddMovementInput(Offset.GetSafeNormal2D(), 1.0f);
        SetActorRotation(Offset.Rotation());
    }
    else if (AttackRemaining <= 0.0f)
    {
        UGameplayStatics::ApplyDamage(Target, Damage, GetController(), this, UDamageType::StaticClass());
        AttackRemaining = AttackInterval;
    }
    if (EnemyType == ECubetownEnemyType::Roller) BodyMesh->AddLocalRotation(FRotator(0.0f, DeltaSeconds * 240.0f, DeltaSeconds * 160.0f));
    if (EnemyType == ECubetownEnemyType::BloomWisp)
    {
        BodyMesh->SetRelativeLocation(FVector(0.0f, 0.0f, 32.0f + FMath::Sin(GetWorld()->GetTimeSeconds() * 4.0f) * 22.0f));
    }
}

float ACubetownEnemy::TakeDamage(
    float DamageAmount,
    FDamageEvent const& DamageEvent,
    AController* EventInstigator,
    AActor* DamageCauser
)
{
    Health = FMath::Max(0.0f, Health - DamageAmount);
    if (Health <= 0.0f)
    {
        if (ACubetownDirector* Director = CubetownDirector(this)) Director->RegisterEnemyDefeat(EnemyType);
        Destroy();
    }
    return DamageAmount;
}

ACubetownEcho::ACubetownEcho()
{
    PrimaryActorTick.bCanEverTick = true;
    AutoPossessAI = EAutoPossessAI::PlacedInWorldOrSpawned;
    GetCapsuleComponent()->SetCapsuleRadius(28.0f);
    GetCapsuleComponent()->SetCapsuleHalfHeight(38.0f);
    BodyMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("EchoBody"));
    BodyMesh->SetupAttachment(GetCapsuleComponent());
    BodyMesh->SetStaticMesh(LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Sphere.Sphere")));
    BodyMesh->SetRelativeScale3D(FVector(0.42f));
    BodyMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    SymbolMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("EchoSymbol"));
    SymbolMesh->SetupAttachment(GetCapsuleComponent());
    SymbolMesh->SetStaticMesh(LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cone.Cone")));
    SymbolMesh->SetRelativeLocation(FVector(0.0f, 0.0f, 46.0f));
    SymbolMesh->SetRelativeScale3D(FVector(0.26f, 0.26f, 0.52f));
    SymbolMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    VisualModel = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("EchoAuthoredVisual"));
    VisualModel->SetupAttachment(GetCapsuleComponent());
    VisualModel->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    VisualModel->SetVisibility(false);
    GetCharacterMovement()->MaxWalkSpeed = 430.0f;
    GetCharacterMovement()->MaxAcceleration = 2400.0f;
    GetCharacterMovement()->BrakingDecelerationWalking = 1900.0f;
    GetCharacterMovement()->bOrientRotationToMovement = true;
    GetCharacterMovement()->bRunPhysicsWithNoController = true;
}

void ACubetownEcho::Configure(ECubetownEchoType NewType)
{
    EchoType = NewType;
    const TCHAR* ModernPath = EchoType == ECubetownEchoType::Bloom
        ? TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Creature_C.SM_CC0_Creature_C")
        : (EchoType == ECubetownEchoType::Boulder
            ? TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Creature_A.SM_CC0_Creature_A")
            : TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Creature_B.SM_CC0_Creature_B"));
    if (UStaticMesh* Modern = LoadObject<UStaticMesh>(nullptr, ModernPath))
    {
        VisualModel->SetStaticMesh(Modern);
        VisualModel->SetRelativeLocation(FVector(0.0f,0.0f,-34.0f));
        VisualModel->SetRelativeScale3D(FVector(0.48f));
        VisualModel->SetVisibility(true);
        BodyMesh->SetVisibility(false);
        SymbolMesh->SetVisibility(false);
    }
    if (EchoType == ECubetownEchoType::Boulder)
    {
        Health = 145.0f;
        Damage = 42.0f;
        AttackRange = 130.0f;
        BodyMesh->SetRelativeScale3D(FVector(0.62f));
        ApplyColor(BodyMesh, FLinearColor(0.5f, 0.38f, 0.24f));
        ApplyColor(SymbolMesh, FLinearColor(1.0f, 0.52f, 0.08f));
    }
    else if (EchoType == ECubetownEchoType::Bloom)
    {
        Health = 86.0f;
        Damage = 18.0f;
        AttackRange = 360.0f;
        ApplyColor(BodyMesh, FLinearColor(0.18f, 0.82f, 0.4f));
        ApplyColor(SymbolMesh, FLinearColor(0.8f, 1.0f, 0.2f));
    }
    else
    {
        Health = 95.0f;
        Damage = 28.0f;
        AttackRange = 160.0f;
        ApplyColor(BodyMesh, FLinearColor(0.12f, 0.72f, 1.0f));
        ApplyColor(SymbolMesh, FLinearColor(0.72f, 0.18f, 1.0f));
    }
}

float ACubetownEcho::TakeDamage(
    float DamageAmount,
    FDamageEvent const& DamageEvent,
    AController* EventInstigator,
    AActor* DamageCauser
)
{
    Health = FMath::Max(0.0f, Health - DamageAmount);
    if (Health <= 0.0f) Destroy();
    return DamageAmount;
}

void ACubetownEcho::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    AttackRemaining = FMath::Max(0.0f, AttackRemaining - DeltaSeconds);
    SymbolMesh->AddLocalRotation(FRotator(0.0f, DeltaSeconds * 120.0f, 0.0f));
    ACubetownHero* Hero = Cast<ACubetownHero>(UGameplayStatics::GetPlayerCharacter(this, 0));
    if (!Hero) return;
    ACubetownEnemy* Nearest = nullptr;
    float NearestDistance = TNumericLimits<float>::Max();
    for (TActorIterator<ACubetownEnemy> It(GetWorld()); It; ++It)
    {
        const float Distance = FVector::DistSquared2D(GetActorLocation(), It->GetActorLocation());
        if (Distance < FMath::Square(720.0f) && Distance < NearestDistance)
        {
            Nearest = *It;
            NearestDistance = Distance;
        }
    }
    if (Nearest)
    {
        const FVector Offset = Nearest->GetActorLocation() - GetActorLocation();
        if (Offset.Size2D() > AttackRange)
        {
            AddMovementInput(Offset.GetSafeNormal2D(), 1.0f);
            SetActorRotation(Offset.Rotation());
        }
        else if (AttackRemaining <= 0.0f)
        {
            UGameplayStatics::ApplyDamage(Nearest, Damage, nullptr, this, UDamageType::StaticClass());
            AttackRemaining = EchoType == ECubetownEchoType::Boulder ? 1.1f : 0.62f;
        }
        return;
    }
    const FVector FollowPoint = Hero->GetActorLocation() - Hero->GetActorForwardVector() * 120.0f + Hero->GetActorRightVector() * 95.0f;
    const FVector FollowOffset = FollowPoint - GetActorLocation();
    if (FollowOffset.Size2D() > 95.0f) AddMovementInput(FollowOffset.GetSafeNormal2D(), 1.0f);
}

ACubetownVillager::ACubetownVillager()
{
    PrimaryActorTick.bCanEverTick = true;
    Root = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
    SetRootComponent(Root);
    UStaticMesh* Cylinder = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
    UStaticMesh* Sphere = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Sphere.Sphere"));
    UStaticMesh* Cone = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cone.Cone"));

    BodyMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("FriendBody"));
    BodyMesh->SetupAttachment(Root);
    BodyMesh->SetStaticMesh(Cylinder);
    BodyMesh->SetRelativeLocation(FVector(0.0f, 0.0f, 52.0f));
    BodyMesh->SetRelativeScale3D(FVector(0.32f, 0.32f, 0.54f));
    BodyMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);

    HeadMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("FriendHead"));
    HeadMesh->SetupAttachment(Root);
    HeadMesh->SetStaticMesh(Sphere);
    HeadMesh->SetRelativeLocation(FVector(0.0f, 0.0f, 112.0f));
    HeadMesh->SetRelativeScale3D(FVector(0.27f));
    HeadMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);

    AccentMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("FriendAccent"));
    AccentMesh->SetupAttachment(Root);
    AccentMesh->SetStaticMesh(Cone);
    AccentMesh->SetRelativeLocation(FVector(0.0f, 0.0f, 142.0f));
    AccentMesh->SetRelativeScale3D(FVector(0.25f, 0.25f, 0.32f));
    AccentMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);

    LeftArm = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("FriendLeftArm"));
    LeftArm->SetupAttachment(Root);
    LeftArm->SetStaticMesh(Cylinder);
    LeftArm->SetRelativeLocation(FVector(0.0f, -24.0f, 52.0f));
    LeftArm->SetRelativeScale3D(FVector(0.09f, 0.09f, 0.34f));
    LeftArm->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    RightArm = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("FriendRightArm"));
    RightArm->SetupAttachment(Root);
    RightArm->SetStaticMesh(Cylinder);
    RightArm->SetRelativeLocation(FVector(0.0f, 24.0f, 52.0f));
    RightArm->SetRelativeScale3D(FVector(0.09f, 0.09f, 0.34f));
    RightArm->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    LeftLeg = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("FriendLeftLeg"));
    LeftLeg->SetupAttachment(Root);
    LeftLeg->SetStaticMesh(Cylinder);
    LeftLeg->SetRelativeLocation(FVector(0.0f, -10.0f, 18.0f));
    LeftLeg->SetRelativeScale3D(FVector(0.10f, 0.10f, 0.28f));
    LeftLeg->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    RightLeg = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("FriendRightLeg"));
    RightLeg->SetupAttachment(Root);
    RightLeg->SetStaticMesh(Cylinder);
    RightLeg->SetRelativeLocation(FVector(0.0f, 10.0f, 18.0f));
    RightLeg->SetRelativeScale3D(FVector(0.10f, 0.10f, 0.28f));
    RightLeg->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    EyeLeft = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("FriendEyeLeft"));
    EyeLeft->SetupAttachment(Root);
    EyeLeft->SetStaticMesh(Sphere);
    EyeLeft->SetRelativeLocation(FVector(22.0f, -9.0f, 116.0f));
    EyeLeft->SetRelativeScale3D(FVector(0.045f));
    EyeLeft->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    EyeRight = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("FriendEyeRight"));
    EyeRight->SetupAttachment(Root);
    EyeRight->SetStaticMesh(Sphere);
    EyeRight->SetRelativeLocation(FVector(22.0f, 9.0f, 116.0f));
    EyeRight->SetRelativeScale3D(FVector(0.045f));
    EyeRight->SetCollisionEnabled(ECollisionEnabled::NoCollision);

    VisualModel = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("FriendAuthoredVisual"));
    VisualModel->SetupAttachment(Root);
    VisualModel->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    VisualModel->SetVisibility(false);
}

void ACubetownVillager::Configure(ECubetownFriend NewFriend, const FVector& NewHome)
{
    FriendType = NewFriend;
    HomeLocation = NewHome;
    SetActorLocation(HomeLocation);
    WanderPhase = static_cast<float>(static_cast<int32>(FriendType)) * 2.1f;
    const FLinearColor Body = FriendType == ECubetownFriend::Mira
        ? FLinearColor(0.12f, 0.58f, 0.92f)
        : (FriendType == ECubetownFriend::Rowan ? FLinearColor(0.86f, 0.42f, 0.12f) : FLinearColor(0.46f, 0.82f, 0.3f));
    const FLinearColor Accent = FriendType == ECubetownFriend::Mira
        ? FLinearColor(0.58f, 0.18f, 1.0f)
        : (FriendType == ECubetownFriend::Rowan ? FLinearColor(1.0f, 0.75f, 0.14f) : FLinearColor(1.0f, 0.34f, 0.56f));

    const TCHAR* FriendAlias = FriendType == ECubetownFriend::Mira
        ? TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Char_Ranger.SM_CC0_Char_Ranger")
        : (FriendType == ECubetownFriend::Rowan
            ? TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Char_Worker.SM_CC0_Char_Worker")
            : TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Char_Wizard.SM_CC0_Char_Wizard"));
    const TCHAR* FriendFallback = FriendType == ECubetownFriend::Mira
        ? TEXT("/Game/Phantom/Generated/Cubetown/Characters/SM_Mira.SM_Mira")
        : (FriendType == ECubetownFriend::Rowan
            ? TEXT("/Game/Phantom/Generated/Cubetown/Characters/SM_Rowan.SM_Rowan")
            : TEXT("/Game/Phantom/Generated/Cubetown/Characters/SM_Pip.SM_Pip"));
    UStaticMesh* AuthoredFriend = LoadObject<UStaticMesh>(nullptr, FriendAlias);
    if (!AuthoredFriend) AuthoredFriend = LoadObject<UStaticMesh>(nullptr, FriendFallback);
    if (AuthoredFriend)
    {
        VisualModel->SetStaticMesh(AuthoredFriend);
        VisualModel->SetRelativeLocation(FVector(0.0f,0.0f,0.0f));
        VisualModel->SetRelativeScale3D(FVector(0.88f));
        VisualModel->SetVisibility(true);
        BodyMesh->SetVisibility(false); HeadMesh->SetVisibility(false); AccentMesh->SetVisibility(false);
        LeftArm->SetVisibility(false); RightArm->SetVisibility(false); LeftLeg->SetVisibility(false); RightLeg->SetVisibility(false);
        EyeLeft->SetVisibility(false); EyeRight->SetVisibility(false);
    }
    ApplyColor(BodyMesh, Body);
    ApplyColor(HeadMesh, FLinearColor(0.82f, 0.65f, 0.5f));
    ApplyColor(AccentMesh, Accent);
    ApplyColor(LeftArm, Body * 0.88f);
    ApplyColor(RightArm, Body * 0.88f);
    ApplyColor(LeftLeg, Body * 0.48f);
    ApplyColor(RightLeg, Body * 0.48f);
    ApplyColor(EyeLeft, FLinearColor(0.025f, 0.035f, 0.045f));
    ApplyColor(EyeRight, FLinearColor(0.025f, 0.035f, 0.045f));
}

void ACubetownVillager::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    if (!GetWorld()) return;
    WanderPhase += DeltaSeconds * 0.32f;
    // Friends now have a readable daily life instead of orbiting the same two-metre circle forever.
    // Morning/evening keeps them near home, daytime sends each friend to a role-appropriate village space,
    // and dusk pulls everyone toward the Heartstone plaza for social activity.
    float Hour = 12.0f;
    if (ACubetownDirector* Director = CubetownDirector(this)) Hour = Director->GetTimeOfDayHours();
    FVector ScheduleAnchor = HomeLocation;
    if (Hour >= 8.0f && Hour < 16.5f)
    {
        if (FriendType == ECubetownFriend::Mira) ScheduleAnchor = FVector(-2600.0f, -3000.0f, HomeLocation.Z);
        else if (FriendType == ECubetownFriend::Rowan) ScheduleAnchor = FVector(7100.0f, -5000.0f, HomeLocation.Z);
        else ScheduleAnchor = FVector(900.0f, -4100.0f, HomeLocation.Z);
    }
    else if (Hour >= 16.5f && Hour < 21.5f)
    {
        ScheduleAnchor = FVector(static_cast<int32>(FriendType) * 250.0f - 250.0f, -4200.0f, HomeLocation.Z);
    }
    const FVector Target = ScheduleAnchor + FVector(FMath::Cos(WanderPhase) * 110.0f, FMath::Sin(WanderPhase * 0.83f) * 82.0f, 0.0f);
    const FVector Before = GetActorLocation();
    const FVector Next = FMath::VInterpTo(Before, Target, DeltaSeconds, 0.38f);
    SetActorLocation(Next);
    const FVector Move = Next - Before;
    if (Move.SizeSquared2D() > 1.0f) SetActorRotation(FMath::RInterpTo(GetActorRotation(), Move.Rotation(), DeltaSeconds, 4.0f));
    const float Bob = FMath::Sin(GetWorld()->GetTimeSeconds() * 3.0f + WanderPhase) * 2.5f;
    AccentMesh->SetRelativeLocation(FVector(0.0f, 0.0f, 142.0f + Bob));
    const float Step = FMath::Sin(GetWorld()->GetTimeSeconds() * 5.5f + WanderPhase) * 15.0f;
    LeftArm->SetRelativeRotation(FRotator(Step, 0.0f, 0.0f));
    RightArm->SetRelativeRotation(FRotator(-Step, 0.0f, 0.0f));
    LeftLeg->SetRelativeRotation(FRotator(-Step * 0.65f, 0.0f, 0.0f));
    RightLeg->SetRelativeRotation(FRotator(Step * 0.65f, 0.0f, 0.0f));
}

ACubetownHero::ACubetownHero()
{
    PrimaryActorTick.bCanEverTick = true;
    AutoPossessPlayer = EAutoReceiveInput::Player0;
    GetCapsuleComponent()->SetCapsuleRadius(38.0f);
    GetCapsuleComponent()->SetCapsuleHalfHeight(72.0f);
    GetCharacterMovement()->MaxWalkSpeed = 520.0f;
    GetCharacterMovement()->MaxAcceleration = 4200.0f;
    GetCharacterMovement()->BrakingDecelerationWalking = 3000.0f;
    GetCharacterMovement()->bOrientRotationToMovement = true;
    GetCharacterMovement()->GetNavAgentPropertiesRef().bCanCrouch = true;
    GetCharacterMovement()->JumpZVelocity = 560.0f;
    bUseControllerRotationYaw = false;
    GetMesh()->SetVisibility(false, true);

    SpringArm = CreateDefaultSubobject<USpringArmComponent>(TEXT("AdventureBoom"));
    SpringArm->SetupAttachment(GetCapsuleComponent());
    SpringArm->SetUsingAbsoluteRotation(false);
    SpringArm->bUsePawnControlRotation = true;
    // Modern third-person adventure framing: behind the hero, not a tactical overhead camera.
    SpringArm->TargetArmLength = 610.0f;
    SpringArm->TargetOffset = FVector(0.0f, 0.0f, 130.0f);
    SpringArm->SocketOffset = FVector(0.0f, 34.0f, 12.0f);
    SpringArm->SetRelativeRotation(FRotator(-14.0f, 0.0f, 0.0f));
    SpringArm->bDoCollisionTest = true;
    SpringArm->ProbeSize = 16.0f;
    SpringArm->bEnableCameraLag = true;
    SpringArm->CameraLagSpeed = 12.0f;
    SpringArm->bEnableCameraRotationLag = true;
    SpringArm->CameraRotationLagSpeed = 14.0f;
    AdventureCamera = CreateDefaultSubobject<UCameraComponent>(TEXT("AdventureCamera"));
    AdventureCamera->SetupAttachment(SpringArm);
    AdventureCamera->FieldOfView = 76.0f;

    UStaticMesh* Cylinder = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
    UStaticMesh* Sphere = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Sphere.Sphere"));
    UStaticMesh* Cone = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cone.Cone"));
    UStaticMesh* Cube = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cube.Cube"));
    // V8 MAX-FIDELITY articulated hero: guaranteed bundled Y-up parts, preserving the existing animated limb rig.
    UStaticMesh* V8HeroTorso = LoadObject<UStaticMesh>(nullptr, TEXT("/Game/Phantom/Generated/Cubetown/V8/Characters/SM_V8_HeroTorso.SM_V8_HeroTorso"));
    UStaticMesh* V8HeroHead  = LoadObject<UStaticMesh>(nullptr, TEXT("/Game/Phantom/Generated/Cubetown/V8/Characters/SM_V8_HeroHead.SM_V8_HeroHead"));
    UStaticMesh* V8HeroCap   = LoadObject<UStaticMesh>(nullptr, TEXT("/Game/Phantom/Generated/Cubetown/V8/Characters/SM_V8_HeroCap.SM_V8_HeroCap"));
    UStaticMesh* V8HeroArm   = LoadObject<UStaticMesh>(nullptr, TEXT("/Game/Phantom/Generated/Cubetown/V8/Characters/SM_V8_HeroArm.SM_V8_HeroArm"));
    UStaticMesh* V8HeroLeg   = LoadObject<UStaticMesh>(nullptr, TEXT("/Game/Phantom/Generated/Cubetown/V8/Characters/SM_V8_HeroLeg.SM_V8_HeroLeg"));
    UStaticMesh* V8HeroWand  = LoadObject<UStaticMesh>(nullptr, TEXT("/Game/Phantom/Generated/Cubetown/V8/Characters/SM_V8_HeroWand.SM_V8_HeroWand"));
    UStaticMesh* V8HeroCloak = LoadObject<UStaticMesh>(nullptr, TEXT("/Game/Phantom/Generated/Cubetown/V8/Characters/SM_V8_HeroCloak.SM_V8_HeroCloak"));
    BodyMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("HeroBody"));
    BodyMesh->SetupAttachment(GetCapsuleComponent());
    BodyMesh->SetStaticMesh(V8HeroTorso ? V8HeroTorso : Cylinder);
    BodyMesh->SetRelativeLocation(V8HeroTorso ? FVector(0.0f, 0.0f, -12.0f) : FVector(0.0f, 0.0f, -20.0f));
    BodyMesh->SetRelativeScale3D(V8HeroTorso ? FVector(1.0f) : FVector(0.42f, 0.42f, 0.68f));
    BodyMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    HeadMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("HeroHead"));
    HeadMesh->SetupAttachment(GetCapsuleComponent());
    HeadMesh->SetStaticMesh(V8HeroHead ? V8HeroHead : Sphere);
    HeadMesh->SetRelativeLocation(V8HeroHead ? FVector(0.0f, 0.0f, 52.0f) : FVector(0.0f, 0.0f, 42.0f));
    HeadMesh->SetRelativeScale3D(V8HeroHead ? FVector(1.0f) : FVector(0.31f));
    HeadMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    CapMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("WisdomCap"));
    CapMesh->SetupAttachment(GetCapsuleComponent());
    CapMesh->SetStaticMesh(V8HeroCap ? V8HeroCap : Cone);
    CapMesh->SetRelativeLocation(V8HeroCap ? FVector(-3.0f, 0.0f, 83.0f) : FVector(-6.0f, 0.0f, 76.0f));
    CapMesh->SetRelativeRotation(FRotator(0.0f, 0.0f, -12.0f));
    CapMesh->SetRelativeScale3D(V8HeroCap ? FVector(1.0f) : FVector(0.42f, 0.42f, 0.72f));
    CapMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    WandMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("EchoRod"));
    WandMesh->SetupAttachment(GetCapsuleComponent());
    WandMesh->SetStaticMesh(V8HeroWand ? V8HeroWand : Cube);
    WandMesh->SetRelativeLocation(V8HeroWand ? FVector(30.0f, 24.0f, -3.0f) : FVector(34.0f, 0.0f, -2.0f));
    WandMesh->SetRelativeRotation(FRotator(0.0f, 0.0f, -28.0f));
    WandMesh->SetRelativeScale3D(V8HeroWand ? FVector(1.0f) : FVector(0.09f, 0.07f, 0.78f));
    WandMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);

    CloakMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("MakerCloak"));
    CloakMesh->SetupAttachment(GetCapsuleComponent());
    CloakMesh->SetStaticMesh(V8HeroCloak ? V8HeroCloak : Cone);
    CloakMesh->SetRelativeLocation(V8HeroCloak ? FVector(-24.0f, 0.0f, -8.0f) : FVector(-28.0f, 0.0f, -4.0f));
    CloakMesh->SetRelativeRotation(FRotator(0.0f, 0.0f, 18.0f));
    CloakMesh->SetRelativeScale3D(V8HeroCloak ? FVector(1.0f) : FVector(0.34f, 0.38f, 0.72f));
    CloakMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);

    ShoulderGem = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("ShoulderGem"));
    ShoulderGem->SetupAttachment(GetCapsuleComponent());
    ShoulderGem->SetStaticMesh(Sphere);
    ShoulderGem->SetRelativeLocation(FVector(0.0f, 28.0f, 10.0f));
    ShoulderGem->SetRelativeScale3D(FVector(0.14f));
    ShoulderGem->SetCollisionEnabled(ECollisionEnabled::NoCollision);

    WandCore = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("WandCore"));
    WandCore->SetupAttachment(GetCapsuleComponent());
    WandCore->SetStaticMesh(Sphere);
    WandCore->SetRelativeLocation(FVector(50.0f, 0.0f, 23.0f));
    WandCore->SetRelativeScale3D(FVector(0.12f));
    WandCore->SetCollisionEnabled(ECollisionEnabled::NoCollision);

    LeftArm = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("HeroLeftArm"));
    LeftArm->SetupAttachment(GetCapsuleComponent());
    LeftArm->SetStaticMesh(V8HeroArm ? V8HeroArm : Cylinder);
    LeftArm->SetRelativeLocation(V8HeroArm ? FVector(0.0f, -40.0f, -10.0f) : FVector(0.0f, -29.0f, -15.0f));
    LeftArm->SetRelativeScale3D(V8HeroArm ? FVector(1.0f) : FVector(0.10f, 0.10f, 0.40f));
    LeftArm->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    RightArm = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("HeroRightArm"));
    RightArm->SetupAttachment(GetCapsuleComponent());
    RightArm->SetStaticMesh(V8HeroArm ? V8HeroArm : Cylinder);
    RightArm->SetRelativeLocation(V8HeroArm ? FVector(0.0f, 40.0f, -10.0f) : FVector(0.0f, 29.0f, -15.0f));
    RightArm->SetRelativeScale3D(V8HeroArm ? FVector(1.0f) : FVector(0.10f, 0.10f, 0.40f));
    RightArm->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    LeftLeg = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("HeroLeftLeg"));
    LeftLeg->SetupAttachment(GetCapsuleComponent());
    LeftLeg->SetStaticMesh(V8HeroLeg ? V8HeroLeg : Cylinder);
    LeftLeg->SetRelativeLocation(V8HeroLeg ? FVector(0.0f, -15.0f, -58.0f) : FVector(0.0f, -12.0f, -54.0f));
    LeftLeg->SetRelativeScale3D(V8HeroLeg ? FVector(1.0f) : FVector(0.115f, 0.115f, 0.32f));
    LeftLeg->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    RightLeg = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("HeroRightLeg"));
    RightLeg->SetupAttachment(GetCapsuleComponent());
    RightLeg->SetStaticMesh(V8HeroLeg ? V8HeroLeg : Cylinder);
    RightLeg->SetRelativeLocation(V8HeroLeg ? FVector(0.0f, 15.0f, -58.0f) : FVector(0.0f, 12.0f, -54.0f));
    RightLeg->SetRelativeScale3D(V8HeroLeg ? FVector(1.0f) : FVector(0.115f, 0.115f, 0.32f));
    RightLeg->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    EyeLeft = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("HeroEyeLeft"));
    EyeLeft->SetupAttachment(GetCapsuleComponent());
    EyeLeft->SetStaticMesh(Sphere);
    EyeLeft->SetRelativeLocation(FVector(25.0f, -10.0f, 45.0f));
    EyeLeft->SetRelativeScale3D(FVector(0.05f));
    EyeLeft->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    EyeRight = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("HeroEyeRight"));
    EyeRight->SetupAttachment(GetCapsuleComponent());
    EyeRight->SetStaticMesh(Sphere);
    EyeRight->SetRelativeLocation(FVector(25.0f, 10.0f, 45.0f));
    EyeRight->SetRelativeScale3D(FVector(0.05f));
    EyeRight->SetCollisionEnabled(ECollisionEnabled::NoCollision);

    VisualModel = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("HeroAuthoredVisual"));
    VisualModel->SetupAttachment(GetCapsuleComponent());
    VisualModel->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    VisualModel->SetVisibility(false);
}

void ACubetownHero::BeginPlay()
{
    Super::BeginPlay();
    GetCharacterMovement()->SetMovementMode(MOVE_Walking);
    GetCharacterMovement()->SetComponentTickEnabled(true);
    GetCharacterMovement()->SetPlaneConstraintEnabled(false);
    SetActorEnableCollision(true);
    // DefaultPawnClass normally possesses us, but PhantomPlay has historically launched stale/mixed
    // binaries. Force possession if the pawn ever reaches BeginPlay without a controller.
    if (!Controller)
    {
        if (APlayerController* FirstPC = GetWorld() ? GetWorld()->GetFirstPlayerController() : nullptr)
        {
            FirstPC->Possess(this);
        }
    }
    // Begin on the authored village road rather than just beyond its southern edge.  This gives
    // the adventure camera a clear corridor and an immediate readable town composition.
    SetActorLocation(FVector(0.0f, -10500.0f, 145.0f));
    // V9: spawn facing straight into Heartstone. UE forward is +X; the village is north (+Y)
    // of the spawn. The old zero-yaw start literally pointed the hero at the emptiest side of the map.
    SetActorRotation(FRotator(0.0f, 90.0f, 0.0f));
    if (APlayerController* FirstPC = GetWorld() ? GetWorld()->GetFirstPlayerController() : nullptr)
        FirstPC->SetControlRotation(FRotator(-8.0f, 90.0f, 0.0f));
    const bool bProductionHero = ConfigureProductionSkeletalCharacter(
        this,
        TEXT("/Game/Phantom/Characters/Production/SK_Rogue.SK_Rogue"),
        TEXT("/Game/Phantom/Characters/Production/Animations/A_Rogue_Idle.A_Rogue_Idle"),
        188.0f,
        -90.0f
    );
    if (bProductionHero)
    {
        BodyMesh->SetVisibility(false); HeadMesh->SetVisibility(false); CapMesh->SetVisibility(false);
        WandMesh->SetVisibility(false); CloakMesh->SetVisibility(false); ShoulderGem->SetVisibility(false);
        WandCore->SetVisibility(false); LeftArm->SetVisibility(false); RightArm->SetVisibility(false);
        LeftLeg->SetVisibility(false); RightLeg->SetVisibility(false); EyeLeft->SetVisibility(false); EyeRight->SetVisibility(false);
        VisualModel->SetVisibility(false);
    }

    // V7: arbitrary CC0 FBX characters imported as static meshes produced sideways/flattened heroes.
    // Use the known-upright generated hero until a proper skeletal-character import is explicitly verified.
    // V8: do not replace the articulated upright hero with a monolithic static mesh. The prior mesh could import on its side.
    UStaticMesh* HeroVisual = nullptr;
    if (HeroVisual)
    {
        VisualModel->SetStaticMesh(HeroVisual);
        const FBoxSphereBounds HeroBounds = HeroVisual->GetBounds();
        const float RawHeight = FMath::Max(1.0f, HeroBounds.BoxExtent.Z * 2.0f);
        const float FitScale = FMath::Clamp(190.0f / RawHeight, 0.025f, 60.0f);
        const float LocalBottom = (HeroBounds.Origin.Z - HeroBounds.BoxExtent.Z) * FitScale;
        VisualModel->SetRelativeLocation(FVector(0.0f,0.0f,-GetCapsuleComponent()->GetUnscaledCapsuleHalfHeight() - LocalBottom));
        VisualModel->SetRelativeScale3D(FVector(FitScale));
        VisualModel->SetRelativeRotation(FRotator::ZeroRotator);
        VisualModel->SetVisibility(true);
        BodyMesh->SetVisibility(false); HeadMesh->SetVisibility(false); CapMesh->SetVisibility(false); WandMesh->SetVisibility(false);
        CloakMesh->SetVisibility(false); ShoulderGem->SetVisibility(false); WandCore->SetVisibility(false);
        LeftArm->SetVisibility(false); RightArm->SetVisibility(false); LeftLeg->SetVisibility(false); RightLeg->SetVisibility(false);
        EyeLeft->SetVisibility(false); EyeRight->SetVisibility(false);
    }
    ApplyColor(BodyMesh, FLinearColor(0.16f, 0.54f, 0.9f));
    ApplyColor(HeadMesh, FLinearColor(0.76f, 0.6f, 0.46f));
    ApplyColor(CapMesh, FLinearColor(0.54f, 0.13f, 0.9f));
    ApplyColor(WandMesh, FLinearColor(0.16f, 0.92f, 1.0f));
    ApplyColor(CloakMesh, FLinearColor(0.12f, 0.055f, 0.28f));
    ApplyColor(ShoulderGem, FLinearColor(0.32f, 0.92f, 1.0f));
    ApplyColor(WandCore, FLinearColor(0.55f, 0.16f, 1.0f));
    ApplyColor(LeftArm, FLinearColor(0.20f, 0.64f, 0.96f));
    ApplyColor(RightArm, FLinearColor(0.20f, 0.64f, 0.96f));
    ApplyColor(LeftLeg, FLinearColor(0.09f, 0.13f, 0.28f));
    ApplyColor(RightLeg, FLinearColor(0.09f, 0.13f, 0.28f));
    ApplyColor(EyeLeft, FLinearColor(0.025f, 0.035f, 0.05f));
    ApplyColor(EyeRight, FLinearColor(0.025f, 0.035f, 0.05f));
    if (APlayerController* PlayerController = Cast<APlayerController>(GetController()))
    {
        PlayerController->SetControlRotation(FRotator(-12.0f, 90.0f, 0.0f));
        PlayerController->bShowMouseCursor = false;
        PlayerController->SetInputMode(FInputModeGameOnly());
    }
}

void ACubetownHero::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    if (GetActorLocation().Z < -200.0f)
    {
        SetActorLocation(FVector(0.0f, -10500.0f, 145.0f), false, nullptr, ETeleportType::TeleportPhysics);
        GetCharacterMovement()->StopMovementImmediately();
    }
    // Traversal is non-negotiable: restore walking if a launcher/map transition ever leaves CharacterMovement inactive.
    if (GetCharacterMovement() && GetCharacterMovement()->MovementMode == MOVE_None)
        GetCharacterMovement()->SetMovementMode(MOVE_Walking);
    if (APlayerController* PlayerController = Cast<APlayerController>(GetController()))
    {
        FRotator ViewRotation = PlayerController->GetControlRotation();
        ViewRotation.Pitch = FMath::Clamp(FRotator::NormalizeAxis(ViewRotation.Pitch), -24.0f, 8.0f);
        ViewRotation.Roll = 0.0f;
        PlayerController->SetControlRotation(ViewRotation);

        // Hard fallback for packaged builds: some launcher/input-stack combinations can fail to
        // deliver legacy MoveForward/MoveRight axis events even though keyboard state is live.
        // Read WASD directly so the adventure can never become a stationary camera demo.
        if (!UGameplayStatics::IsGamePaused(this))
        {
            const float ForwardKey = ((PlayerController->IsInputKeyDown(EKeys::W) || PlayerController->IsInputKeyDown(EKeys::Up)) ? 1.0f : 0.0f)
                - ((PlayerController->IsInputKeyDown(EKeys::S) || PlayerController->IsInputKeyDown(EKeys::Down)) ? 1.0f : 0.0f);
            const float RightKey = ((PlayerController->IsInputKeyDown(EKeys::D) || PlayerController->IsInputKeyDown(EKeys::Right)) ? 1.0f : 0.0f)
                - ((PlayerController->IsInputKeyDown(EKeys::A) || PlayerController->IsInputKeyDown(EKeys::Left)) ? 1.0f : 0.0f);
            if (!FMath::IsNearlyZero(ForwardKey) || !FMath::IsNearlyZero(RightKey))
            {
                const FVector Forward = FRotationMatrix(FRotator(0.0f, ViewRotation.Yaw, 0.0f)).GetUnitAxis(EAxis::X);
                const FVector Right = FRotationMatrix(FRotator(0.0f, ViewRotation.Yaw, 0.0f)).GetUnitAxis(EAxis::Y);
                FVector Wish = (Forward * ForwardKey + Right * RightKey).GetSafeNormal2D();
                if (!Wish.IsNearlyZero())
                {
                    AddMovementInput(Wish, 1.0f);
                    // Emergency packaged-build fallback: if CharacterMovement is possessed but the
                    // legacy input stack still produces zero velocity, sweep the capsule directly.
                    if (GetVelocity().SizeSquared2D() < 4.0f)
                    {
                        FHitResult MoveHit;
                        AddActorWorldOffset(Wish * GetCharacterMovement()->MaxWalkSpeed * DeltaSeconds, true, &MoveHit);
                    }
                }
            }
        }
    }
    // Canonical 960m x 960m playable boundary.
    FVector Bounded=GetActorLocation();
    Bounded.X=FMath::Clamp(Bounded.X,-47000.0f,47000.0f);
    Bounded.Y=FMath::Clamp(Bounded.Y,-47000.0f,47000.0f);
    if (!Bounded.Equals(GetActorLocation(),1.0f)) SetActorLocation(Bounded,true);
    AttackRemaining = FMath::Max(0.0f, AttackRemaining - DeltaSeconds);
    DashRemaining = FMath::Max(0.0f, DashRemaining - DeltaSeconds);
    DamageFlash = FMath::Max(0.0f, DamageFlash - DeltaSeconds * 1.5f);
    InvulnerableRemaining = FMath::Max(0.0f, InvulnerableRemaining - DeltaSeconds);
    ComboResetRemaining = FMath::Max(0.0f, ComboResetRemaining - DeltaSeconds);
    ParryWindowRemaining = FMath::Max(0.0f, ParryWindowRemaining - DeltaSeconds);
    if (ComboResetRemaining <= 0.0f) ComboStep = 0;
    if (DashRemaining <= 0.0f && !bGuarding) Stamina = FMath::Min(100.0f, Stamina + DeltaSeconds * 24.0f);
    if (LockedTarget.IsValid())
    {
        ACubetownEnemy* Target=LockedTarget.Get();
        if (!Target || FVector::DistSquared2D(GetActorLocation(),Target->GetActorLocation())>FMath::Square(1500.0f)) LockedTarget.Reset();
        else if (APlayerController* PC=Cast<APlayerController>(GetController()))
        {
            FVector To=Target->GetActorLocation()-GetActorLocation(); To.Z=0.0f;
            if (!To.IsNearlyZero())
            {
                FRotator View=PC->GetControlRotation();
                const float DesiredYaw=To.Rotation().Yaw;
                View.Yaw=FMath::FInterpTo(View.Yaw,DesiredYaw,DeltaSeconds,7.5f);
                PC->SetControlRotation(View);
            }
        }
    }
    if (VisualModel && VisualModel->IsVisible())
    {
        const float Speed = GetVelocity().Size2D();
        const float Bob = Speed > 40.0f ? FMath::Sin(GetWorld()->GetTimeSeconds() * 10.0f) * 2.2f : 0.0f;
        VisualModel->SetRelativeLocation(FVector(0.0f,0.0f,-72.0f + Bob));
    }
    WandCore->AddLocalRotation(FRotator(0.0f, DeltaSeconds * 160.0f, 0.0f));
    ShoulderGem->SetRelativeScale3D(FVector(0.14f + FMath::Sin(GetWorld()->GetTimeSeconds() * 4.0f) * 0.018f));
    const float Swing = AttackRemaining > 0.0f ? FMath::Sin(AttackRemaining * 18.0f) * 34.0f : 0.0f;
    WandMesh->SetRelativeRotation(FRotator(0.0f, 0.0f, -28.0f + Swing));
    const float Speed = GetVelocity().Size2D();
    const float WalkPhase = GetWorld()->GetTimeSeconds() * (Speed > 40.0f ? 9.0f : 2.0f);
    const float LimbSwing = Speed > 40.0f ? FMath::Sin(WalkPhase) * 22.0f : 0.0f;
    LeftArm->SetRelativeRotation(FRotator(LimbSwing, 0.0f, 0.0f));
    RightArm->SetRelativeRotation(FRotator(-LimbSwing - Swing * 0.22f, 0.0f, 0.0f));
    LeftLeg->SetRelativeRotation(FRotator(-LimbSwing * 0.72f, 0.0f, 0.0f));
    RightLeg->SetRelativeRotation(FRotator(LimbSwing * 0.72f, 0.0f, 0.0f));
}

void ACubetownHero::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
    Super::SetupPlayerInputComponent(PlayerInputComponent);
    PlayerInputComponent->BindAxis(TEXT("MoveForward"), this, &ACubetownHero::MoveForward);
    PlayerInputComponent->BindAxis(TEXT("MoveRight"), this, &ACubetownHero::MoveRight);
    PlayerInputComponent->BindAxis(TEXT("Turn"), this, &APawn::AddControllerYawInput);
    PlayerInputComponent->BindAxis(TEXT("LookUp"), this, &APawn::AddControllerPitchInput);
    PlayerInputComponent->BindAxis(TEXT("CameraZoom"), this, &ACubetownHero::ZoomCamera);
    PlayerInputComponent->BindKey(EKeys::MouseScrollUp, IE_Pressed, this, &ACubetownHero::ZoomIn);
    PlayerInputComponent->BindKey(EKeys::MouseScrollDown, IE_Pressed, this, &ACubetownHero::ZoomOut);

    PlayerInputComponent->BindKey(EKeys::LeftMouseButton, IE_Pressed, this, &ACubetownHero::PrimaryAction);
    PlayerInputComponent->BindKey(EKeys::RightMouseButton, IE_Pressed, this, &ACubetownHero::StartGuard);
    PlayerInputComponent->BindKey(EKeys::RightMouseButton, IE_Released, this, &ACubetownHero::StopGuard);
    PlayerInputComponent->BindKey(EKeys::E, IE_Pressed, this, &ACubetownHero::Interact);
    PlayerInputComponent->BindKey(EKeys::F, IE_Pressed, this, &ACubetownHero::ToggleLockOn);
    PlayerInputComponent->BindKey(EKeys::Q, IE_Pressed, this, &ACubetownHero::StartCreationSelect);
    PlayerInputComponent->BindKey(EKeys::Q, IE_Released, this, &ACubetownHero::FinishCreationSelect);
    PlayerInputComponent->BindKey(EKeys::R, IE_Pressed, this, &ACubetownHero::CycleEcho);
    PlayerInputComponent->BindKey(EKeys::B, IE_Pressed, this, &ACubetownHero::ToggleBuildMode);
    PlayerInputComponent->BindKey(EKeys::Tab, IE_Pressed, this, &ACubetownHero::ToggleInventoryPanel);
    PlayerInputComponent->BindKey(EKeys::M, IE_Pressed, this, &ACubetownHero::ToggleMapPanel);
    PlayerInputComponent->BindKey(EKeys::J, IE_Pressed, this, &ACubetownHero::ToggleJournalPanel);
    PlayerInputComponent->BindKey(EKeys::LeftAlt, IE_Pressed, this, &ACubetownHero::Dash);
    PlayerInputComponent->BindKey(EKeys::LeftControl, IE_Pressed, this, &ACubetownHero::ToggleCrouch);
    PlayerInputComponent->BindKey(EKeys::LeftShift, IE_Pressed, this, &ACubetownHero::StartSprint);
    PlayerInputComponent->BindKey(EKeys::LeftShift, IE_Released, this, &ACubetownHero::StopSprint);
    PlayerInputComponent->BindKey(EKeys::SpaceBar, IE_Pressed, this, &ACubetownHero::JumpOrClimb);
    PlayerInputComponent->BindKey(EKeys::V, IE_Pressed, this, &ACubetownHero::RecenterCamera);
    PlayerInputComponent->BindKey(EKeys::MiddleMouseButton, IE_Pressed, this, &ACubetownHero::RecenterCamera);
    PlayerInputComponent->BindKey(EKeys::LeftControl, IE_DoubleClick, this, &ACubetownHero::HeavyAttack);
    PlayerInputComponent->BindKey(EKeys::Comma, IE_Pressed, this, &ACubetownHero::BuildRotateLeft);
    PlayerInputComponent->BindKey(EKeys::Period, IE_Pressed, this, &ACubetownHero::BuildRotateRight);
    PlayerInputComponent->BindKey(EKeys::LeftBracket, IE_Pressed, this, &ACubetownHero::BuildCyclePrev);
    PlayerInputComponent->BindKey(EKeys::RightBracket, IE_Pressed, this, &ACubetownHero::BuildCycleNext);
    PlayerInputComponent->BindKey(EKeys::Z, IE_Pressed, this, &ACubetownHero::BuildUndo);
    PlayerInputComponent->BindKey(EKeys::Y, IE_Pressed, this, &ACubetownHero::BuildRedo);
    PlayerInputComponent->BindKey(EKeys::One, IE_Pressed, this, &ACubetownHero::BuildPrefabTool);
    PlayerInputComponent->BindKey(EKeys::Two, IE_Pressed, this, &ACubetownHero::BuildWallTool);
    PlayerInputComponent->BindKey(EKeys::Three, IE_Pressed, this, &ACubetownHero::BuildRoomTool);
    PlayerInputComponent->BindKey(EKeys::Four, IE_Pressed, this, &ACubetownHero::BuildFenceTool);
    PlayerInputComponent->BindKey(EKeys::Five, IE_Pressed, this, &ACubetownHero::BuildGardenTool);
    PlayerInputComponent->BindKey(EKeys::Six, IE_Pressed, this, &ACubetownHero::BuildDecorTool);
}

void ACubetownHero::MoveForward(float Value)
{
    if (FMath::IsNearlyZero(Value)) return;
    const FRotator Control = Controller ? Controller->GetControlRotation() : GetActorRotation();
    const FVector Forward = FRotationMatrix(FRotator(0.0f, Control.Yaw, 0.0f)).GetUnitAxis(EAxis::X);
    if (ACubetownDirector* D=CubetownDirector(this); D && D->IsBuildMode())
    {
        AddActorWorldOffset(Forward*Value*1150.0f*GetWorld()->GetDeltaSeconds(),true);
        return;
    }
    AddMovementInput(Forward, Value);
}

void ACubetownHero::MoveRight(float Value)
{
    if (FMath::IsNearlyZero(Value)) return;
    const FRotator Control = Controller ? Controller->GetControlRotation() : GetActorRotation();
    const FVector Right = FRotationMatrix(FRotator(0.0f, Control.Yaw, 0.0f)).GetUnitAxis(EAxis::Y);
    if (ACubetownDirector* D=CubetownDirector(this); D && D->IsBuildMode())
    {
        AddActorWorldOffset(Right*Value*1150.0f*GetWorld()->GetDeltaSeconds(),true);
        return;
    }
    AddMovementInput(Right, Value);
}

void ACubetownHero::ZoomCamera(float Value)
{
    if (FMath::IsNearlyZero(Value)) return;
    if(ACubetownDirector* D=CubetownDirector(this))
    {
        if(D->IsCreationSelecting()){D->CycleEcho();return;}
    }
    if(!SpringArm) return;
    SpringArm->TargetArmLength=FMath::Clamp(SpringArm->TargetArmLength-Value*70.0f,430.0f,CubetownDirector(this)&&CubetownDirector(this)->IsBuildMode()?2200.0f:980.0f);
}

void ACubetownHero::ZoomIn()
{
    if (SpringArm) SpringArm->TargetArmLength = FMath::Clamp(SpringArm->TargetArmLength - 80.0f, 420.0f, CubetownDirector(this)&&CubetownDirector(this)->IsBuildMode()?1800.0f:980.0f);
}

void ACubetownHero::ZoomOut()
{
    if (SpringArm) SpringArm->TargetArmLength = FMath::Clamp(SpringArm->TargetArmLength + 80.0f, 420.0f, CubetownDirector(this)&&CubetownDirector(this)->IsBuildMode()?1800.0f:980.0f);
}

void ACubetownHero::PrimaryAction()
{
    if (ACubetownDirector* Director=CubetownDirector(this))
    {
        if(Director->IsBuildMode())
        {
            Director->CommitBuildTool(Cast<APlayerController>(GetController()));
            return;
        }
        if (AttackRemaining > 0.0f) return;
        ComboStep = ComboResetRemaining > 0.0f ? (ComboStep % 3) + 1 : 1;
        ComboResetRemaining = 0.72f;
        const float Multipliers[3] = { 0.85f, 1.0f, 1.35f };
        Director->PrimaryAtCursor(Cast<APlayerController>(GetController()), this, Multipliers[ComboStep-1]);
        AttackRemaining = ComboStep==3 ? 0.38f : 0.22f;
    }
}

void ACubetownHero::ToggleBuildMode()
{
    if(ACubetownDirector* Director=CubetownDirector(this)) Director->ToggleBuildMode(Cast<APlayerController>(GetController()));
}
void ACubetownHero::BuildRotateLeft(){if(ACubetownDirector* D=CubetownDirector(this))if(D->IsBuildMode())D->RotateBuildPreview(-15.0f);}
void ACubetownHero::BuildRotateRight(){if(ACubetownDirector* D=CubetownDirector(this))if(D->IsBuildMode())D->RotateBuildPreview(15.0f);}
void ACubetownHero::BuildCycleNext(){if(ACubetownDirector* D=CubetownDirector(this))if(D->IsBuildMode())D->CycleBuildPrefab(1);}
void ACubetownHero::BuildCyclePrev(){if(ACubetownDirector* D=CubetownDirector(this))if(D->IsBuildMode())D->CycleBuildPrefab(-1);}
void ACubetownHero::BuildUndo(){if(ACubetownDirector* D=CubetownDirector(this))if(D->IsBuildMode()){if(APlayerController* PC=Cast<APlayerController>(GetController()))if(PC->IsInputKeyDown(EKeys::LeftControl)||PC->IsInputKeyDown(EKeys::RightControl))D->UndoLastBuild();}}
void ACubetownHero::BuildPrefabTool(){if(ACubetownDirector* D=CubetownDirector(this))if(D->IsBuildMode())D->SetBuildTool(0);}
void ACubetownHero::BuildWallTool(){if(ACubetownDirector* D=CubetownDirector(this))if(D->IsBuildMode())D->SetBuildTool(1);}
void ACubetownHero::BuildRoomTool(){if(ACubetownDirector* D=CubetownDirector(this))if(D->IsBuildMode())D->SetBuildTool(2);}
void ACubetownHero::BuildFenceTool(){if(ACubetownDirector* D=CubetownDirector(this))if(D->IsBuildMode())D->SetBuildTool(3);}
void ACubetownHero::BuildGardenTool(){if(ACubetownDirector* D=CubetownDirector(this))if(D->IsBuildMode())D->SetBuildTool(4);}
void ACubetownHero::BuildDecorTool(){if(ACubetownDirector* D=CubetownDirector(this))if(D->IsBuildMode())D->SetBuildTool(5);}
void ACubetownHero::BuildRedo(){if(ACubetownDirector* D=CubetownDirector(this))if(D->IsBuildMode()){if(APlayerController* PC=Cast<APlayerController>(GetController()))if(PC->IsInputKeyDown(EKeys::LeftControl)||PC->IsInputKeyDown(EKeys::RightControl))D->RedoLastBuild();}}
void ACubetownHero::ToggleInventoryPanel(){if(ACubetownDirector* D=CubetownDirector(this))D->TogglePanel(1);}
void ACubetownHero::ToggleMapPanel(){if(ACubetownDirector* D=CubetownDirector(this))D->TogglePanel(2);}
void ACubetownHero::ToggleJournalPanel(){if(ACubetownDirector* D=CubetownDirector(this))D->TogglePanel(3);}
void ACubetownHero::StartCreationSelect()
{
    if(ACubetownDirector* D=CubetownDirector(this))
    {
        if(D->IsBuildMode()) D->RotateBuildPreview(-15.0f);
        else D->BeginCreationSelection();
    }
}
void ACubetownHero::FinishCreationSelect(){if(ACubetownDirector* D=CubetownDirector(this))if(D->IsCreationSelecting())D->EndCreationSelection();}

void ACubetownHero::SummonEcho()
{
    if (ACubetownDirector* Director = CubetownDirector(this)) Director->SummonEcho();
}

void ACubetownHero::CycleBlock()
{
    if (ACubetownDirector* Director = CubetownDirector(this)) Director->CycleBlock();
}

void ACubetownHero::CycleEcho()
{
    if (ACubetownDirector* Director = CubetownDirector(this))
    {
        if(Director->IsBuildMode()) Director->RotateBuildPreview(-15.0f);
        else Director->CycleEcho();
    }
}

void ACubetownHero::Interact()
{
    if (ACubetownDirector* Director = CubetownDirector(this))
    {
        if(Director->IsBuildMode()) Director->RotateBuildPreview(15.0f);
        else Director->InteractNearby(GetActorLocation());
    }
}

void ACubetownHero::Dash()
{
    if (DashRemaining > 0.0f || Stamina < 28.0f) return;
    Stamina -= 28.0f;
    FVector Direction=GetVelocity().GetSafeNormal2D();
    if (Direction.IsNearlyZero()) Direction=GetActorForwardVector();
    LaunchCharacter(Direction * 920.0f + FVector(0.0f, 0.0f, 55.0f), true, true);
    if (ACubetownDirector* Director = CubetownDirector(this)) Director->PulseNearbyEnemies(GetActorLocation(), 230.0f, 24.0f, this);
    InvulnerableRemaining = 0.42f;
    DashRemaining = 0.62f;
}

void ACubetownHero::HeavyAttack()
{
    if (AttackRemaining > 0.0f || Stamina < 20.0f) return;
    Stamina -= 20.0f; ComboStep=0; ComboResetRemaining=0.0f;
    if (ACubetownDirector* Director=CubetownDirector(this)) Director->PrimaryAtCursor(Cast<APlayerController>(GetController()),this,2.15f);
    AttackRemaining=0.68f;
}

void ACubetownHero::StartGuard()
{
    if(ACubetownDirector* Director=CubetownDirector(this))
    {
        if(Director->IsBuildMode()){Director->CancelBuildPlacement();return;}
    }
    if (Stamina < 5.0f || DashRemaining > 0.0f) return;
    bGuarding = true;
    ParryWindowRemaining = 0.20f;
    GetCharacterMovement()->MaxWalkSpeed = 280.0f;
}

void ACubetownHero::StopGuard()
{
    bGuarding = false;
    ParryWindowRemaining = 0.0f;
    GetCharacterMovement()->MaxWalkSpeed = bCrouchedByInput ? 280.0f : (bSprinting ? 780.0f : 520.0f);
}

void ACubetownHero::StartSprint()
{
    if(bCrouchedByInput || bGuarding) return;
    bSprinting=true;
    GetCharacterMovement()->MaxWalkSpeed=780.0f;
}
void ACubetownHero::StopSprint()
{
    bSprinting=false;
    GetCharacterMovement()->MaxWalkSpeed=bCrouchedByInput?280.0f:520.0f;
}
void ACubetownHero::ToggleCrouch()
{
    if(ACubetownDirector* D=CubetownDirector(this)) if(D->IsBuildMode()) return;
    bCrouchedByInput=!bCrouchedByInput;
    if(bCrouchedByInput){Crouch();GetCharacterMovement()->MaxWalkSpeed=280.0f;}
    else{UnCrouch();GetCharacterMovement()->MaxWalkSpeed=bSprinting?780.0f:520.0f;}
}
void ACubetownHero::RecenterCamera()
{
    if(APlayerController* PC=Cast<APlayerController>(GetController()))
        PC->SetControlRotation(FRotator(-10.0f,GetActorRotation().Yaw,0.0f));
}
void ACubetownHero::SetBuildCameraMode(bool bEnabled)
{
    if(SpringArm)
    {
        SpringArm->TargetArmLength=bEnabled?1250.0f:560.0f;
        SpringArm->bDoCollisionTest=true;
    }
    if(APlayerController* PC=Cast<APlayerController>(GetController()))
    {
        const float Yaw=PC->GetControlRotation().Yaw;
        PC->SetControlRotation(FRotator(bEnabled?-48.0f:-10.0f,Yaw,0.0f));
    }
    if(VisualModel) VisualModel->SetVisibility(!bEnabled);
}
void ACubetownHero::JumpOrClimb()
{
    if(ACubetownDirector* D=CubetownDirector(this)) if(D->IsBuildMode()) return;
    if(!GetWorld()){Jump();return;}
    const FVector Start=GetActorLocation()+FVector(0,0,58);
    const FVector Fwd=GetActorForwardVector();
    FCollisionQueryParams Q(SCENE_QUERY_STAT(CubeClimb),false,this); FHitResult Low;
    if(GetWorld()->LineTraceSingleByChannel(Low,Start,Start+Fwd*95.0f,ECC_Visibility,Q))
    {
        FHitResult High; const FVector HS=Start+FVector(0,0,105);
        if(!GetWorld()->LineTraceSingleByChannel(High,HS,HS+Fwd*95.0f,ECC_Visibility,Q))
        {
            LaunchCharacter(Fwd*260.0f+FVector(0,0,390.0f),true,true); return;
        }
    }
    Jump();
}

void ACubetownHero::ToggleLockOn()
{
    if (LockedTarget.IsValid()) { LockedTarget.Reset(); return; }
    ACubetownEnemy* Best=nullptr; float BestScore=TNumericLimits<float>::Max();
    APlayerController* PC=Cast<APlayerController>(GetController());
    for (TActorIterator<ACubetownEnemy> It(GetWorld()); It; ++It)
    {
        const float DistSq=FVector::DistSquared2D(GetActorLocation(),It->GetActorLocation());
        if (DistSq>FMath::Square(1300.0f)) continue;
        float Score=DistSq;
        if (PC) { FVector2D Screen; int32 W=0,H=0; PC->GetViewportSize(W,H); if(PC->ProjectWorldLocationToScreen(It->GetActorLocation()+FVector(0,0,65),Screen)) Score += (Screen-FVector2D(W*0.5f,H*0.5f)).SizeSquared()*2.0f; }
        if (Score<BestScore) { BestScore=Score; Best=*It; }
    }
    LockedTarget=Best;
}

float ACubetownHero::TakeDamage(
    float DamageAmount,
    FDamageEvent const& DamageEvent,
    AController* EventInstigator,
    AActor* DamageCauser
)
{
    if (InvulnerableRemaining > 0.0f) return 0.0f;
    float AppliedDamage = DamageAmount;
    if (bGuarding)
    {
        if (ParryWindowRemaining > 0.0f)
        {
            Stamina = FMath::Min(100.0f, Stamina + 12.0f);
            InvulnerableRemaining = 0.18f;
            if (ACubetownDirector* Director = CubetownDirector(this)) Director->PulseNearbyEnemies(GetActorLocation(), 250.0f, 34.0f, this);
            return 0.0f;
        }
        const float GuardCost = FMath::Max(8.0f, DamageAmount * 0.7f);
        if (Stamina >= GuardCost)
        {
            Stamina -= GuardCost;
            AppliedDamage *= 0.28f;
        }
        else
        {
            Stamina = 0.0f;
            bGuarding = false;
            GetCharacterMovement()->MaxWalkSpeed = bCrouchedByInput ? 280.0f : (bSprinting ? 780.0f : 520.0f);
            AppliedDamage *= 0.72f;
        }
    }
    Health = FMath::Max(0.0f, Health - AppliedDamage);
    DamageFlash = FMath::Clamp(DamageFlash + AppliedDamage / 35.0f, 0.0f, 1.0f);
    if (Health <= 0.0f)
    {
        Health = 120.0f;
        SetActorLocation(FVector(0.0f, -11200.0f, 145.0f));
        if (ACubetownDirector* Director = CubetownDirector(this)) Director->NotifyHeroDefeated();
    }
    return AppliedDamage;
}

void ACubetownHUD::DrawHUD()
{
    Super::DrawHUD();
    if (!Canvas) return;
    ACubetownDirector* Director=CubetownDirector(this);
    ACubetownHero* Hero=Cast<ACubetownHero>(GetOwningPawn());
    if(!Director||!Hero)return;
    const float Width=Canvas->SizeX, Height=Canvas->SizeY;
    if(DrawCubetownDreamShell(this,Director,Width,Height))return;
    // Scale the adventure HUD beyond 1080p. Capping this at 1.0 made objectives and prompts
    // illegible in the installed application's 4K playtest despite ample available screen space.
    const float UIScale=FMath::Clamp(FMath::Min(Width/1920.0f,Height/1080.0f),0.78f,1.75f);
    const auto S=[UIScale](float V){return V*UIScale;};
    UFont* Medium=GEngine?GEngine->GetMediumFont():nullptr;
    const FLinearColor Panel(0.075f,0.035f,0.055f,0.84f), Mint(0.96f,0.36f,0.42f);
    const float Pad=S(18.0f);

    // Third-person interaction reticle. Mining, attacks and Maker placement use this center aim point.
    const float CX=Width*0.5f, CY=Height*0.5f;
    DrawLine(CX-S(8.0f),CY,CX-S(2.0f),CY,FLinearColor(0.86f,1.0f,0.94f,0.85f),2.0f);
    DrawLine(CX+S(2.0f),CY,CX+S(8.0f),CY,FLinearColor(0.86f,1.0f,0.94f,0.85f),2.0f);
    DrawLine(CX,CY-S(8.0f),CX,CY-S(2.0f),FLinearColor(0.86f,1.0f,0.94f,0.85f),2.0f);
    DrawLine(CX,CY+S(2.0f),CX,CY+S(8.0f),FLinearColor(0.86f,1.0f,0.94f,0.85f),2.0f);

    // Adventure HUD: only the information needed while moving through the world.
    DrawRect(Panel,Pad,Pad,S(610.0f),S(96.0f));
    DrawRect(Mint,Pad,Pad,S(5.0f),S(96.0f));
    DrawText(FString::Printf(TEXT("CUBETOWN // %s"),*Director->GetRegionName(Hero->GetActorLocation())),FLinearColor(1.0f,0.91f,0.76f),Pad+S(20.0f),Pad+S(13.0f),Medium,S(0.68f));
    DrawText(Director->GetQuestStatus(),FLinearColor(0.78f,0.88f,0.92f),Pad+S(20.0f),Pad+S(45.0f),Medium,S(0.48f));
    DrawText(FString::Printf(TEXT("SHRINES %d/3   ECHO %03d   %02d:%02d   %s"),Director->GetShrinesRestored(),Director->GetEchoEnergy(),FMath::FloorToInt(Director->GetTimeOfDayHours()),FMath::FloorToInt(FMath::Fmod(Director->GetTimeOfDayHours(),1.0f)*60.0f),*Director->GetWeatherName()),FLinearColor(1.0f,0.76f,0.34f),Pad+S(20.0f),Pad+S(71.0f),Medium,S(0.45f));

    // A premium first session always answers two questions: what should I do, and what can I do here?
    // These markers are derived from live world actors, so they remain accurate after saves and progression.
    const FString ObjectiveMarker=Director->GetObjectiveMarker(Hero->GetActorLocation());
    if(!ObjectiveMarker.IsEmpty())
    {
        const float ObjectiveW=S(520.0f),ObjectiveX=(Width-ObjectiveW)*0.5f;
        DrawRect(FLinearColor(0.075f,0.035f,0.055f,0.86f),ObjectiveX,Pad,ObjectiveW,S(42.0f));
        DrawRect(FLinearColor(1.0f,0.62f,0.24f),ObjectiveX,Pad,ObjectiveW,S(4.0f));
        DrawText(ObjectiveMarker,FLinearColor(1.0f,0.91f,0.76f),ObjectiveX+S(18.0f),Pad+S(12.0f),Medium,S(0.50f));
    }

    const float HeartW=S(260.0f), HeartX=Pad, HeartY=Height-S(64.0f);
    DrawRect(Panel,HeartX,HeartY,HeartW,S(45.0f));
    DrawText(TEXT("HEARTS"),FLinearColor(1.0f,0.72f,0.76f),HeartX+S(14.0f),HeartY+S(11.0f),Medium,S(0.46f));
    DrawRect(FLinearColor(0.07f,0.08f,0.09f),HeartX+S(88.0f),HeartY+S(17.0f),S(150.0f),S(12.0f));
    DrawRect(FLinearColor(1.0f,0.24f,0.38f),HeartX+S(88.0f),HeartY+S(12.0f),S(150.0f)*Hero->GetHealth()/120.0f,S(9.0f));
    DrawRect(FLinearColor(0.07f,0.08f,0.09f),HeartX+S(88.0f),HeartY+S(26.0f),S(150.0f),S(7.0f));
    DrawRect(FLinearColor(0.26f,0.92f,0.52f),HeartX+S(88.0f),HeartY+S(26.0f),S(150.0f)*Hero->GetStamina()/100.0f,S(7.0f));

    const float ActionW=FMath::Min(S(720.0f),Width-S(560.0f));
    const float ActionX=(Width-ActionW)*0.5f, ActionY=Height-S(64.0f);
    DrawRect(Panel,ActionX,ActionY,ActionW,S(45.0f));
    DrawText(FString::Printf(TEXT("[LMB] COMBO  [RMB] GUARD  [ALT] DODGE  [F] LOCK  [E] INTERACT  [HOLD Q] %s  [B] BUILD"),EchoName(Director->GetSelectedEcho())),FLinearColor(0.96f,0.84f,0.74f),ActionX+S(16.0f),ActionY+S(12.0f),Medium,S(0.44f));

    const FString InteractionPrompt=Director->GetInteractionPrompt(Hero->GetActorLocation());
    if(!InteractionPrompt.IsEmpty() && !Director->IsBuildMode())
    {
        const float PromptW=S(440.0f),PromptX=(Width-PromptW)*0.5f,PromptY=Height-S(118.0f);
        DrawRect(FLinearColor(0.12f,0.045f,0.07f,0.94f),PromptX,PromptY,PromptW,S(42.0f));
        DrawRect(FLinearColor(0.96f,0.30f,0.40f),PromptX,PromptY,S(5.0f),S(42.0f));
        DrawText(InteractionPrompt,FLinearColor(1.0f,0.92f,0.78f),PromptX+S(18.0f),PromptY+S(12.0f),Medium,S(0.52f));
    }

    DrawRect(Panel,Width-S(300.0f)-Pad,Pad,S(300.0f),S(72.0f));
    DrawText(FString::Printf(TEXT("MIRA %d   ROWAN %d   PIP %d"),Director->GetFriendship(0),Director->GetFriendship(1),Director->GetFriendship(2)),FLinearColor(1.0f,0.58f,0.78f),Width-S(284.0f)-Pad,Pad+S(13.0f),Medium,S(0.46f));
    DrawText(Director->IsGuardianDefeated()?TEXT("HEARTSTONE SAFE"):TEXT("RIFT THREAT ACTIVE"),Director->IsGuardianDefeated()?Mint:FLinearColor(0.82f,0.62f,1.0f),Width-S(284.0f)-Pad,Pad+S(42.0f),Medium,S(0.43f));

    if(Hero->IsLockedOn())
    {
        DrawText(TEXT("LOCKED"),FLinearColor(1.0f,0.78f,0.20f),Width*0.5f-S(34.0f),Height*0.5f+S(26.0f),Medium,S(0.42f));
        if(APlayerController* PC=GetWorld()?GetWorld()->GetFirstPlayerController():nullptr)
        {
            FVector2D P; AActor* T=Hero->GetLockedTarget();
            if(T && PC->ProjectWorldLocationToScreen(T->GetActorLocation()+FVector(0,0,65),P))
            {
                const float R=S(24.0f); const FLinearColor L(1.0f,0.74f,0.16f);
                DrawLine(P.X-R,P.Y-R,P.X-R*0.35f,P.Y-R,L,3); DrawLine(P.X-R,P.Y-R,P.X-R,P.Y-R*0.35f,L,3);
                DrawLine(P.X+R,P.Y-R,P.X+R*0.35f,P.Y-R,L,3); DrawLine(P.X+R,P.Y-R,P.X+R,P.Y-R*0.35f,L,3);
                DrawLine(P.X-R,P.Y+R,P.X-R*0.35f,P.Y+R,L,3); DrawLine(P.X-R,P.Y+R,P.X-R,P.Y+R*0.35f,L,3);
                DrawLine(P.X+R,P.Y+R,P.X+R*0.35f,P.Y+R,L,3); DrawLine(P.X+R,P.Y+R,P.X+R,P.Y+R*0.35f,L,3);
            }
        }
    }

    if(Director->GetActivePanel()!=0)
    {
        const float OW=FMath::Min(S(980.0f),Width-S(120.0f)),OH=FMath::Min(S(640.0f),Height-S(120.0f)),OX=(Width-OW)*0.5f,OY=(Height-OH)*0.5f;
        DrawRect(FLinearColor(0.08f,0.035f,0.055f,0.96f),OX,OY,OW,OH); DrawRect(FLinearColor(0.82f,0.12f,0.22f),OX,OY,S(7),OH);
        if(Director->GetActivePanel()==1)
        {
            DrawText(TEXT("SATCHEL & CREATIONS"),FLinearColor(1.0f,0.90f,0.72f),OX+S(34),OY+S(28),Medium,S(0.92f));
            DrawText(FString::Printf(TEXT("HERBS %d     STONE %d     AMBER %d     CRYSTAL %d     WOOD %d"),Director->GetInventory(ECubetownBlockType::Grass),Director->GetInventory(ECubetownBlockType::Stone),Director->GetInventory(ECubetownBlockType::Amber),Director->GetInventory(ECubetownBlockType::Crystal),Director->GetInventory(ECubetownBlockType::Wood)),FLinearColor(0.92f,0.82f,0.72f),OX+S(38),OY+S(96),Medium,S(0.66f));
            DrawText(FString::Printf(TEXT("DISCOVERED CREATION: %s    ECHO ENERGY %d"),EchoName(Director->GetSelectedEcho()),Director->GetEchoEnergy()),FLinearColor(0.96f,0.45f,0.62f),OX+S(38),OY+S(154),Medium,S(0.66f));
            DrawText(TEXT("HOLD Q in the world to call a discovered Creation. R cycles favorites."),FLinearColor(0.78f,0.72f,0.68f),OX+S(38),OY+S(220),Medium,S(0.58f));
        }
        else if(Director->GetActivePanel()==2)
        {
            DrawText(TEXT("ILLUSTRATED WORLD MAP"),FLinearColor(1.0f,0.90f,0.72f),OX+S(34),OY+S(28),Medium,S(0.92f));
            DrawText(TEXT("FROSTBLOOM HEIGHTS        CRIMSON GROVE         EMBERBLOOM VALLEY"),FLinearColor(0.82f,0.72f,0.95f),OX+S(55),OY+S(120),Medium,S(0.58f));
            DrawText(TEXT("MOONMOSS MARSH       HEARTSTONE / CROWNLANDS       STARFALL MEADOWS"),FLinearColor(0.58f,0.88f,0.76f),OX+S(55),OY+S(235),Medium,S(0.58f));
            DrawText(TEXT("                         SUNPETAL COAST"),FLinearColor(0.95f,0.70f,0.42f),OX+S(55),OY+S(350),Medium,S(0.58f));
            DrawText(FString::Printf(TEXT("YOU ARE HERE: %s"),*Director->GetRegionName(Hero->GetActorLocation())),FLinearColor(1.0f,0.36f,0.42f),OX+S(55),OY+S(460),Medium,S(0.68f));
        }
        else
        {
            DrawText(TEXT("ADVENTURE JOURNAL"),FLinearColor(1.0f,0.90f,0.72f),OX+S(34),OY+S(28),Medium,S(0.92f));
            DrawText(Director->GetQuestStatus(),FLinearColor(0.94f,0.80f,0.70f),OX+S(38),OY+S(105),Medium,S(0.62f));
            DrawText(FString::Printf(TEXT("MIRA %d/5   ROWAN %d/5   PIP %d/5   //   SHRINES %d/3"),Director->GetFriendship(0),Director->GetFriendship(1),Director->GetFriendship(2),Director->GetShrinesRestored()),FLinearColor(0.96f,0.48f,0.64f),OX+S(38),OY+S(180),Medium,S(0.62f));
            DrawText(TEXT("The world is designed around curiosity: red forests, impossible seasonal overlaps, ruins, friends, Creation magic and homes you can actually build."),FLinearColor(0.74f,0.74f,0.70f),OX+S(38),OY+S(250),Medium,S(0.55f));
        }
        DrawText(TEXT("TAB / M / J CLOSE OR SWITCH"),FLinearColor(0.74f,0.68f,0.64f),OX+S(38),OY+OH-S(48),Medium,S(0.52f));
    }

    // Hold-Q Creation wheel: readable, central and playful rather than a hidden text-only state.
    if(Director->IsCreationSelecting())
    {
        DrawRect(FLinearColor(0.035f,0.018f,0.040f,0.48f),0,0,Width,Height);
        const FVector2D Center(Width*0.5f,Height*0.5f);
        const float Radius=S(190.0f), CardW=S(176.0f), CardH=S(82.0f);
        const ECubetownEchoType Types[]={ECubetownEchoType::Blade,ECubetownEchoType::Boulder,ECubetownEchoType::Bloom};
        for(int32 I=0;I<3;++I)
        {
            const float Angle=-PI*0.5f + I*(2.0f*PI/3.0f);
            const float X=Center.X+FMath::Cos(Angle)*Radius-CardW*0.5f;
            const float Y=Center.Y+FMath::Sin(Angle)*Radius-CardH*0.5f;
            const bool Selected=Director->GetSelectedEcho()==Types[I];
            DrawRect(Selected?FLinearColor(0.72f,0.12f,0.28f,0.96f):FLinearColor(0.16f,0.07f,0.13f,0.92f),X,Y,CardW,CardH);
            if(Selected) DrawRect(FLinearColor(1.0f,0.72f,0.40f),X,Y,CardW,S(5.0f));
            DrawText(EchoName(Types[I]),FLinearColor(1.0f,0.91f,0.78f),X+S(18),Y+S(16),Medium,S(0.62f));
            DrawText(Director->IsEchoUnlocked(Types[I])?TEXT("DISCOVERED"):TEXT("UNDISCOVERED"),Director->IsEchoUnlocked(Types[I])?FLinearColor(0.58f,1.0f,0.72f):FLinearColor(0.62f,0.55f,0.58f),X+S(18),Y+S(49),Medium,S(0.42f));
        }
        DrawText(TEXT("CREATION MAGIC // WHEEL OR R TO CYCLE // RELEASE Q TO CALL"),FLinearColor(1.0f,0.86f,0.58f),Center.X-S(250),Center.Y+S(260),Medium,S(0.54f));
    }

    if(Director->IsBuildMode())
    {
        const float BW=FMath::Min(S(980.0f),Width-S(80.0f)),BX=(Width-BW)*0.5f,BY=Height-S(148.0f);
        DrawRect(FLinearColor(0.11f,0.055f,0.075f,0.95f),BX,BY,BW,S(126.0f));
        DrawRect(FLinearColor(0.94f,0.32f,0.38f),BX,BY,S(7),S(126));
        static const TCHAR* ToolNames[]={TEXT("HOUSE / PREFAB"),TEXT("WALL"),TEXT("ROOM"),TEXT("FENCE"),TEXT("GARDEN"),TEXT("DECOR")};
        const int32 Tool=FMath::Clamp(Director->GetBuildToolIndex(),0,5);
        DrawText(FString::Printf(TEXT("BUILD MODE // %s // %s"),ToolNames[Tool],*Director->GetBuildPrefabName()),FLinearColor(1.0f,0.91f,0.76f),BX+S(26),BY+S(16),Medium,S(0.62f));
        DrawText(TEXT("[1] HOUSE  [2] WALL  [3] ROOM  [4] FENCE  [5] GARDEN  [6] DECOR   [/] CATALOG   Q/E ROTATE"),FLinearColor(0.88f,0.80f,0.72f),BX+S(26),BY+S(53),Medium,S(0.46f));
        DrawText(TEXT("LMB PLACE / SET POINT   RMB CANCEL   CTRL+Z UNDO   CTRL+Y REDO   B RETURN TO ADVENTURE"),FLinearColor(0.66f,0.94f,0.76f),BX+S(26),BY+S(84),Medium,S(0.46f));
    }

    if(Hero->GetDamageFlash()>0.0f){const float A=Hero->GetDamageFlash()*0.14f;DrawRect(FLinearColor(1.0f,0.0f,0.08f,A),0,0,Width,S(10));DrawRect(FLinearColor(1.0f,0.0f,0.08f,A),0,Height-S(10),Width,S(10));}
}

ACubetownDirector::ACubetownDirector()
{
    PrimaryActorTick.bCanEverTick = true;
}

void ACubetownDirector::BeginPlay()
{
    Super::BeginPlay();
    LoadProgress();
    BuildDreamWorld();
    RestoreSavedBuilds();
    SpawnVillage();
    RefreshStoryQuest();
    if (ShrinesRestored >= 3 && !bGuardianDefeated)
    {
        bGuardianSpawned = true;
        SpawnEnemy(ECubetownEnemyType::RiftGuardian, FVector(22000.0f, 17000.0f, 155.0f), WorldCycle + 3);
        StoryChapter = FMath::Max(StoryChapter, 2);
        QuestStatus = TEXT("THE RIFT GUARDIAN AWAITS // FIGHT BESIDE YOUR ECHO AND PROTECT YOUR FRIENDS");
    }
    else if (!bGuardianDefeated)
    {
        SpawnEnemyWave();
    }
    else
    {
        StoryChapter = FMath::Max(StoryChapter, 3);
        RefreshStoryQuest();
    }
}

void ACubetownDirector::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    UpdateDreamEnvironment(DeltaSeconds);
    if(bCreationSelecting) CreationHoldSeconds += DeltaSeconds;
    if(bBuildMode) UpdateBuildPreview(GetWorld()?GetWorld()->GetFirstPlayerController():nullptr);
    EnemyWaveRemaining -= DeltaSeconds;
    SaveRemaining -= DeltaSeconds;
    if (FriendTalkCooldowns.Num() < 3) FriendTalkCooldowns.SetNumZeroed(3);
    for (float& Cooldown : FriendTalkCooldowns) Cooldown = FMath::Max(0.0f, Cooldown - DeltaSeconds);
    if (EnemyWaveRemaining <= 0.0f && EnemiesAlive < 12 && !bGuardianSpawned && !bGuardianDefeated)
    {
        ++WorldCycle;
        SpawnEnemyWave();
        EnemyWaveRemaining = FMath::Max(5.0f, 10.0f - WorldCycle * 0.55f);
    }
    if (SaveRemaining <= 0.0f)
    {
        SaveRemaining = 5.0f;
        SaveProgress();
    }
}

FVector ACubetownDirector::GridLocation(const FIntVector& Grid) const
{
    return FVector(Grid.X * CubeSize, Grid.Y * CubeSize, Grid.Z * CubeSize);
}

FIntVector ACubetownDirector::GridForLocation(const FVector& Location) const
{
    return FIntVector(
        FMath::RoundToInt(Location.X / CubeSize),
        FMath::RoundToInt(Location.Y / CubeSize),
        FMath::RoundToInt(Location.Z / CubeSize)
    );
}

void ACubetownDirector::SpawnBlockAt(const FIntVector& Grid, ECubetownBlockType Type, bool bMineable)
{
    if (Blocks.FindRef(Grid).IsValid()) return;
    ACubetownBlock* Block = GetWorld()->SpawnActor<ACubetownBlock>(GridLocation(Grid), FRotator::ZeroRotator);
    if (!Block) return;
    Block->Configure(Type, Grid, bMineable);
    Blocks.Add(Grid, Block);
}

void ACubetownDirector::SpawnDreamTree(const FString& Name, const FVector& Location, float Scale, int32 PaletteVariant, bool bCollision)
{
    static const TCHAR* Trees[]={
        TEXT("/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamTree_Crimson_A.SM_CubeDreamTree_Crimson_A"),
        TEXT("/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamTree_Crimson_B.SM_CubeDreamTree_Crimson_B"),
        TEXT("/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamTree_Coral_A.SM_CubeDreamTree_Coral_A"),
        TEXT("/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamTree_Rose_A.SM_CubeDreamTree_Rose_A"),
        TEXT("/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamTree_Lavender_A.SM_CubeDreamTree_Lavender_A")
    };
    const int32 Index=((PaletteVariant%5)+5)%5;
    if(!SpawnStaticMeshAsset(Name,Trees[Index],Location,FVector(Scale),FRotator(0,(PaletteVariant*47)%360,0),bCollision,true))
        SpawnStaticMeshAsset(Name,TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Tree_A.SM_CC0_Tree_A"),Location,FVector(Scale),FRotator(0,(PaletteVariant*47)%360,0),bCollision,true);
}

void ACubetownDirector::SpawnDreamWorldDetails()
{
    // Ground-scale micro-interest: flowers, mushrooms, rocks and tiny environmental stories every few metres
    // in the opening vertical slice. These are authored meshes, not construction cubes.
    int32 DetailId=0;
    const FVector Centers[]={FVector(0,5000,25),FVector(15000,7000,25),FVector(-15000,-6500,25),FVector(-17000,15000,25),FVector(18000,-13000,25)};
    for(int32 C=0;C<UE_ARRAY_COUNT(Centers);++C)
    {
        for(int32 I=0;I<22;++I)
        {
            const float A=I*2.399963f+C*0.71f; const float R=900.0f+(I%6)*520.0f;
            const FVector P=Centers[C]+FVector(FMath::Cos(A)*R,FMath::Sin(A)*R,0);
            const TCHAR* Asset=(I%5==0)?TEXT("/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamMushroomCluster_A.SM_CubeDreamMushroomCluster_A"):TEXT("/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamFlowerPatch_A.SM_CubeDreamFlowerPatch_A");
            SpawnStaticMeshAsset(FString::Printf(TEXT("DreamGroundDetail_%03d"),DetailId++),Asset,P,FVector((I%5==0)?0.55f:0.42f),FRotator(0,I*31.0f,0),false,true);
        }
    }
    // Environmental storytelling vignettes.
    SpawnStaticMeshAsset(TEXT("ForgottenPicnicCrate"),TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Crate.SM_CC0_Crate"),FVector(7200,8300,30),FVector(0.72f),FRotator(0,28,0),false,true);
    SpawnStaticMeshAsset(TEXT("OldGardenBench"),TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Bench.SM_CC0_Bench"),FVector(-5400,8200,30),FVector(0.9f),FRotator(0,-20,0),false,true);
    SpawnStaticMeshAsset(TEXT("MoonmossBrokenCart"),TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Cart.SM_CC0_Cart"),FVector(-15000,-8000,30),FVector(0.92f),FRotator(0,63,0),false,true);
}

void ACubetownDirector::BuildDreamWorld()
{
    DreamSun=SpawnSun(5.2f,FRotator(-42.0f,-28.0f,0.0f),FLinearColor(1.0f,0.78f,0.58f));
    SetWorldMood(FLinearColor(0.32f,0.46f,0.62f),0.0011f,FLinearColor(0.52f,0.62f,0.78f));

    // V10 PRODUCTION MAP CONTRACT: the visible environment already exists in CubeTown_World.
    // Never build the old runtime world on top of it again. That V10 rescue: previous double-world bug was a major
    // reason the packaged game looked like a scattered prototype and cost unnecessary startup time.
    const bool bProductionWorld = GetWorld() && GetWorld()->GetMapName().Contains(TEXT("CubeTown_World"));
    if (bProductionWorld)
    {
        if (AStaticMeshActor* CollisionGround = SpawnBlock(TEXT("DreamWorldCollision"),FVector(0,0,-30),FVector(96000,96000,60),FLinearColor::Black,FRotator::ZeroRotator,true))
        {
            CollisionGround->SetActorHiddenInGame(true);
            CollisionGround->SetActorEnableCollision(true);
            if (UStaticMeshComponent* ProxyMesh = CollisionGround->GetStaticMeshComponent())
            {
                ProxyMesh->SetVisibility(false, true);
                ProxyMesh->SetHiddenInGame(true, true);
                ProxyMesh->SetCastShadow(false);
            }
        }

        const FIntVector ProductionGrids[]={FIntVector(-120,65,1),FIntVector(145,92,1),FIntVector(205,165,1),FIntVector(-65,140,1),FIntVector(86,-92,1)};
        const ECubetownBlockType ProductionTypes[]={ECubetownBlockType::Stone,ECubetownBlockType::Crystal,ECubetownBlockType::Amber,ECubetownBlockType::Wood,ECubetownBlockType::Grass};
        for(int32 I=0;I<UE_ARRAY_COUNT(ProductionGrids);++I) if(!RemovedWorldBlocks.Contains(ProductionGrids[I])) SpawnBlockAt(ProductionGrids[I],ProductionTypes[I],true);

        const FVector ShrineLocations[]={FVector(-30000,23000,45),FVector(28500,17000,45),FVector(26000,-15000,45)};
        for(int32 Index=0;Index<3;++Index)
        {
            ACubetownShrine* Shrine=GetWorld()->SpawnActor<ACubetownShrine>(ShrineLocations[Index],FRotator(0,Index*38.0f,0));
            if(!Shrine) continue; Shrine->Configure(Index); if(ActiveShrineIndices.Contains(Index)) Shrine->Activate(); Shrines.Add(Shrine);
        }
        return;
    }

    // CANONICAL CUBETOWN WORLD: one contiguous 960m x 960m adventure map. Size is fixed; density is the goal.
    SpawnBlock(TEXT("DreamSeaBackdrop"),FVector(0,0,-520),FVector(104000,104000,180),FLinearColor(0.025f,0.28f,0.48f),FRotator::ZeroRotator,false);
    // V8 MAX WORLD SURFACE: the 960m map keeps a simple invisible gameplay collision plane, while
    // nine authored Y-up terrain chunks provide visible rolling seasonal ground instead of one giant green cube.
    if (AStaticMeshActor* CollisionGround = SpawnBlock(TEXT("DreamWorldCollision"),FVector(0,0,-30),FVector(96000,96000,60),FLinearColor(0.0f,0.0f,0.0f),FRotator::ZeroRotator,true))
        CollisionGround->SetActorHiddenInGame(true);
    for(int32 TY=0; TY<3; ++TY)
    {
        for(int32 TX=0; TX<3; ++TX)
        {
            const FString TerrainPath = FString::Printf(TEXT("/Game/Phantom/Generated/Cubetown/V8/Terrain/SM_V8_CubeTerrain_%d%d.SM_V8_CubeTerrain_%d%d"),TY,TX,TY,TX);
            SpawnStaticMeshAsset(FString::Printf(TEXT("V8SeasonTerrain_%d%d"),TY,TX),TerrainPath,
                FVector((TX-1)*32000.0f,(TY-1)*32000.0f,-5.0f),FVector(1.0f),FRotator::ZeroRotator,false,false);
        }
    }

    // Four-Seasons Dream regions overlap instead of hard biome walls.

    // A continuous sparkling turquoise river acts as a navigation spine.
    for(int32 I=0;I<55;++I)
    {
        const float X=-26000.0f+I*950.0f; const float Y=800.0f+FMath::Sin(I*0.31f)*1900.0f;
        SpawnShape(EPhantomPrimitive::Cylinder,FString::Printf(TEXT("DreamRiver_%02d"),I),FVector(X,Y,25),FVector(1450,900,12),I%3?FLinearColor(0.05f,0.52f,0.78f):FLinearColor(0.06f,0.70f,0.82f),FRotator::ZeroRotator,false);
    }
    const FVector Crossings[]={FVector(-15000,-950,30),FVector(0,800,30),FVector(15000,1600,30)};
    for(int32 I=0;I<3;++I)
    {
        if(!SpawnStaticMeshAsset(FString::Printf(TEXT("DreamBridge_%d"),I),TEXT("/Game/Phantom/Curated/Cube/SM_Cube_Bridge.SM_Cube_Bridge"),Crossings[I],FVector(1.45f),FRotator(0,I*7-7,0),true,true))
            SpawnStaticMeshAsset(FString::Printf(TEXT("DreamBridgeFallback_%d"),I),TEXT("/Game/Phantom/Generated/Cubetown/SM_CubetownBridge.SM_CubetownBridge"),Crossings[I],FVector(1.35f),FRotator::ZeroRotator,true,true);
    }

    // Signature Crimson Grove. Deliberate hue composition: mostly crimson/ruby with coral/rose/lavender punctuation.
    const FVector GroveClusters[]={FVector(-6500,12500,30),FVector(0,16000,30),FVector(6500,13000,30),FVector(-2500,20500,30),FVector(7000,20500,30)};
    int32 TreeId=0;
    for(int32 C=0;C<UE_ARRAY_COUNT(GroveClusters);++C)
        for(int32 I=0;I<11;++I)
        {
            const float A=I*2.399963f+C*0.52f; const float R=900.0f+(I%5)*520.0f;
            SpawnDreamTree(FString::Printf(TEXT("CrimsonSignatureTree_%03d"),TreeId++),GroveClusters[C]+FVector(FMath::Cos(A)*R,FMath::Sin(A)*R,0),0.82f+(I%3)*0.12f,(I+C*3)%5,true);
        }
    // One unmistakable distant landmark visible from the opening village.
    SpawnStaticMeshAsset(TEXT("GreatCrimsonHeartTree"),TEXT("/Game/Phantom/Generated/Cubetown/V9/Setpieces/SM_V9_HeartTree.SM_V9_HeartTree"),FVector(0,24500,40),FVector(1.55f),FRotator(0,18,0),true,true);
    if(APointLight* L=SpawnPointLight(TEXT("GreatTreeGlow"),FVector(0,24500,800),FLinearColor(0.82f,0.16f,0.38f),5200.0f,2600.0f,false)) DreamNightLights.Add(L);

    // Landmark triangle: windmill, ancient arch, floating root isle.
    SpawnStaticMeshAsset(TEXT("StarfallWindmill"),TEXT("/Game/Phantom/Curated/Cube/SM_Cube_Windmill.SM_Cube_Windmill"),FVector(19000,5500,45),FVector(1.35f),FRotator(0,-28,0),true,true);
    SpawnStaticMeshAsset(TEXT("FrostbloomAncientArch"),TEXT("/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamAncientArch_A.SM_CubeDreamAncientArch_A"),FVector(-19000,17000,50),FVector(1.6f),FRotator(0,40,0),true,true);
    SpawnStaticMeshAsset(TEXT("CloudrootFloatingIsle"),TEXT("/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamFloatingIsland_A.SM_CubeDreamFloatingIsland_A"),FVector(3000,30000,4300),FVector(3.2f),FRotator(0,15,0),false,false);
    SpawnPointLight(TEXT("CloudrootGlow"),FVector(3000,30000,4200),FLinearColor(0.42f,0.62f,1.0f),5000.0f,3000.0f,false);

    // Frost pockets and Emberbloom use original authored rock clusters instead of grey cubes.
    for(int32 I=0;I<12;++I)
    {
        const float A=I*2.12f; const FVector FP(-17000+FMath::Cos(A)*(2800+(I%4)*650),15000+FMath::Sin(A)*(2200+(I%3)*700),35);
        SpawnStaticMeshAsset(FString::Printf(TEXT("FrostRock_%02d"),I),TEXT("/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamRockCluster_Cream.SM_CubeDreamRockCluster_Cream"),FP,FVector(0.75f+(I%3)*0.16f),FRotator(0,I*29,0),false,true);
        const FVector EP(22000+FMath::Cos(A+0.5f)*(2200+(I%4)*520),17000+FMath::Sin(A+0.5f)*(1900+(I%3)*580),35);
        SpawnStaticMeshAsset(FString::Printf(TEXT("EmberRock_%02d"),I),TEXT("/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamRockCluster_Ember.SM_CubeDreamRockCluster_Ember"),EP,FVector(0.72f+(I%2)*0.18f),FRotator(0,I*37,0),false,true);
    }

    // Moonmoss and Sunpetal water pockets create impossible seasonal overlap without hard biome walls.
    for(int32 I=0;I<11;++I)
    {
        const float A=I*0.72f;
        SpawnShape(EPhantomPrimitive::Cylinder,FString::Printf(TEXT("MoonmossPool_%02d"),I),FVector(-17000+FMath::Cos(A)*3600,-7000+FMath::Sin(A)*2600,27),FVector(1500,1100,10),FLinearColor(0.05f,0.42f,0.44f),FRotator::ZeroRotator,false);
        SpawnShape(EPhantomPrimitive::Cylinder,FString::Printf(TEXT("SunpetalLagoon_%02d"),I),FVector(17500+FMath::Cos(A)*3900,-14000+FMath::Sin(A)*2500,27),FVector(1700,1200,10),FLinearColor(0.04f,0.62f,0.82f),FRotator::ZeroRotator,false);
    }

    // Resource discoveries are small authored props, not a block-building loop.
    struct FResourcePocket{FIntVector Grid;ECubetownBlockType Type;};
    const FResourcePocket Pockets[]={
        {FIntVector(-120,65,1),ECubetownBlockType::Stone},{FIntVector(-112,72,1),ECubetownBlockType::Stone},
        {FIntVector(145,92,1),ECubetownBlockType::Crystal},{FIntVector(152,96,1),ECubetownBlockType::Crystal},
        {FIntVector(205,165,1),ECubetownBlockType::Amber},{FIntVector(212,170,1),ECubetownBlockType::Amber},
        {FIntVector(-65,140,1),ECubetownBlockType::Wood},{FIntVector(86,-92,1),ECubetownBlockType::Grass}
    };
    for(const FResourcePocket& Pocket:Pockets) if(!RemovedWorldBlocks.Contains(Pocket.Grid)) SpawnBlockAt(Pocket.Grid,Pocket.Type,true);

    const FVector ShrineLocations[]={FVector(-19000,17000,45),FVector(22000,17000,45),FVector(18000,-14500,45)};
    for(int32 Index=0;Index<3;++Index)
    {
        ACubetownShrine* Shrine=GetWorld()->SpawnActor<ACubetownShrine>(ShrineLocations[Index],FRotator(0,Index*38.0f,0)); if(!Shrine)continue;
        Shrine->Configure(Index); if(ActiveShrineIndices.Contains(Index))Shrine->Activate(); Shrines.Add(Shrine);
        static const FLinearColor Lights[]={FLinearColor(0.24f,0.66f,1.0f),FLinearColor(1.0f,0.46f,0.18f),FLinearColor(0.62f,0.25f,1.0f)};
        if(APointLight* L=SpawnPointLight(FString::Printf(TEXT("ShrineLight_%02d"),Index),ShrineLocations[Index]+FVector(0,0,220),Lights[Index],3800.0f,520.0f,false)) DreamNightLights.Add(L);
    }

    // Dense outer-world district pass. Every cluster is a destination, not procedural filler.
    // Hearthstone, Crimson Grove, Crownlands, Mushroom Hollow and Mirror Lake all live in this ONE 960m map.
    struct FDreamHub { const TCHAR* Name; FVector Center; int32 Palette; bool bVillage; };
    const FDreamHub Hubs[] = {
        {TEXT("CrimsonOuter"), FVector(-30000,30000,35), 0, false},
        {TEXT("CrownlandsTerrace"), FVector(30000,30000,35), 3, true},
        {TEXT("MushroomHollow"), FVector(-30000,-30000,35), 4, false},
        {TEXT("MirrorLakeVillage"), FVector(30000,-30000,35), 2, true},
        {TEXT("WestGarden"), FVector(-40000,0,35), 1, true},
        {TEXT("EastRuins"), FVector(40000,0,35), 3, false},
        {TEXT("NorthFalls"), FVector(0,40000,35), 0, false},
        {TEXT("SouthFarms"), FVector(0,-40000,35), 2, true}
    };
    for (int32 H=0; H<UE_ARRAY_COUNT(Hubs); ++H)
    {
        const FDreamHub& Hub=Hubs[H];
        // V7: no giant primitive "biome disc". The destination is defined by real foliage,
        // structures, paths and props instead of a colored cylinder painted on the world.
        for (int32 I=0; I<12; ++I)
        {
            const float A=I*(2.0f*PI/12.0f)+H*0.17f;
            const float R=2500.0f+(I%4)*850.0f;
            const FVector P=Hub.Center+FVector(FMath::Cos(A)*R,FMath::Sin(A)*R,0);
            SpawnDreamTree(FString::Printf(TEXT("%s_Tree_%02d"),Hub.Name,I),P,0.78f+(I%3)*0.11f,(Hub.Palette+I)%5,true);
            if (I%3==0)
                SpawnStaticMeshAsset(FString::Printf(TEXT("%s_Flower_%02d"),Hub.Name,I),
                    TEXT("/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamFlowerPatch_A.SM_CubeDreamFlowerPatch_A"),
                    Hub.Center+FVector(FMath::Cos(A+0.4f)*(1450.0f+I*70.0f),FMath::Sin(A+0.4f)*(1450.0f+I*70.0f),5),
                    FVector(0.44f),FRotator(0,I*29.0f,0),false,true);
        }
        if (Hub.bVillage)
        {
            for (int32 I=0; I<4; ++I)
            {
                const TCHAR* House = I%3==0 ? TEXT("/Game/Phantom/Curated/Cube/SM_Cube_House_A.SM_Cube_House_A")
                    : (I%3==1 ? TEXT("/Game/Phantom/Curated/Cube/SM_Cube_House_B.SM_Cube_House_B")
                              : TEXT("/Game/Phantom/Curated/Cube/SM_Cube_Blacksmith.SM_Cube_Blacksmith"));
                const float A=I*(2.0f*PI/4.0f)+0.45f;
                SpawnStaticMeshAsset(FString::Printf(TEXT("%s_House_%02d"),Hub.Name,I),House,
                    Hub.Center+FVector(FMath::Cos(A)*1700.0f,FMath::Sin(A)*1700.0f,5),
                    FVector(1.04f),FRotator(0,A*180.0f/PI+90.0f,0),true,true);
            }
            SpawnStaticMeshAsset(FString::Printf(TEXT("%s_Landmark"),Hub.Name),
                TEXT("/Game/Phantom/Curated/Cube/SM_Cube_Well.SM_Cube_Well"),Hub.Center,
                FVector(1.12f),FRotator::ZeroRotator,false,true);
        }
        else
        {
            SpawnStaticMeshAsset(FString::Printf(TEXT("%s_Ruin"),Hub.Name),
                H%2==0 ? TEXT("/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamAncientArch_A.SM_CubeDreamAncientArch_A")
                       : TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_CastleTower.SM_CC0_CastleTower"),
                Hub.Center,FVector(H%2==0?1.35f:0.85f),FRotator(0,H*37.0f,0),true,true);
        }
    }

    // Mirror Lake is a real visible destination instead of empty grass.
    for(int32 I=0; I<14; ++I)
    {
        const float A=I*(2.0f*PI/14.0f);
        SpawnShape(EPhantomPrimitive::Cylinder,FString::Printf(TEXT("MirrorLake_%02d"),I),
            FVector(30000+FMath::Cos(A)*2500.0f,-30000+FMath::Sin(A)*1900.0f,28),
            FVector(2100,1600,10),FLinearColor(0.035f,0.58f,0.82f),FRotator::ZeroRotator,false);
    }
    SpawnStaticMeshAsset(TEXT("MirrorLakeBridge"),TEXT("/Game/Phantom/Curated/Cube/SM_Cube_Bridge.SM_Cube_Bridge"),
        FVector(30000,-28000,40),FVector(1.35f),FRotator(0,90,0),true,true);

    // Mushroom Hollow gets a dense magical floor signature.
    for(int32 I=0; I<24; ++I)
    {
        const float A=I*2.399963f; const float R=700.0f+(I%6)*620.0f;
        SpawnStaticMeshAsset(FString::Printf(TEXT("MushroomHollowCluster_%02d"),I),
            TEXT("/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamMushroomCluster_A.SM_CubeDreamMushroomCluster_A"),
            FVector(-30000+FMath::Cos(A)*R,-30000+FMath::Sin(A)*R,35),FVector(0.55f+(I%4)*0.08f),
            FRotator(0,I*21.0f,0),false,true);
    }

    // World-edge authored border: rocks/trees communicate the 960m boundary without invisible wasteland.
    for(int32 I=-5; I<=5; ++I)
    {
        const float T=I*8000.0f;
        const FVector EdgePoints[]={FVector(T,46500,35),FVector(T,-46500,35),FVector(46500,T,35),FVector(-46500,T,35)};
        for(int32 E=0; E<4; ++E)
            SpawnStaticMeshAsset(FString::Printf(TEXT("DreamBoundary_%d_%d"),I,E),
                E%2==0?TEXT("/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamRockCluster_Ember.SM_CubeDreamRockCluster_Ember")
                      :TEXT("/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamRockCluster_Cream.SM_CubeDreamRockCluster_Cream"),
                EdgePoints[E],FVector(1.2f),FRotator(0,(I+6)*19.0f+E*37.0f,0),false,true);
    }

    // V6 WORLD-FILL PASS. Keep the 960m world, but fill the travel space efficiently instead of
    // paying thousands of Actor ticks. Hand-authored POIs stay as Actors; connective scenery is HISM.
    TArray<FTransform> WildTreesA;
    TArray<FTransform> WildTreesB;
    TArray<FTransform> WildRocks;
    TArray<FTransform> WildFlowers;
    WildTreesA.Reserve(1100); WildTreesB.Reserve(700); WildRocks.Reserve(620); WildFlowers.Reserve(1300);
    for(int32 GX=-22;GX<=22;++GX)
    {
        for(int32 GY=-22;GY<=22;++GY)
        {
            const float X=GX*2050.0f+(((GX*73+GY*137)&511)-255.0f);
            const float Y=GY*2050.0f+(((GX*181-GY*59)&511)-255.0f);
            if(FMath::Abs(X)>45400.0f || FMath::Abs(Y)>45400.0f) continue;
            // Preserve Heartstone's readable streets/plaza and the main river corridor.
            if(FMath::Abs(X)<9800.0f && Y>-12500.0f && Y<4200.0f) continue;
            if(FMath::Abs(X)<1500.0f && FMath::Abs(Y)<33000.0f) continue;
            const float S=0.58f+((FMath::Abs(GX*17+GY*31))%6)*0.055f;
            FTransform T(FRotator(0.0f,(GX*37+GY*19)%360,0.0f),FVector(X,Y,22.0f),FVector(S));
            if(((GX+GY)&3)==0) WildTreesB.Add(T); else WildTreesA.Add(T);
            if(((GX*5+GY*7)&3)==0)
                WildRocks.Emplace(FRotator(0.0f,(GX*23-GY*17)%360,0.0f),FVector(X+620.0f,Y-430.0f,14.0f),FVector(0.38f+((GX-GY)&3)*0.05f));
        }
    }
    for(int32 GX=-19;GX<=19;++GX)
    {
        for(int32 GY=-19;GY<=19;++GY)
        {
            if(((GX*11+GY*13)&1)!=0) continue;
            const float X=GX*2350.0f+((GX*97+GY*43)%700-350.0f);
            const float Y=GY*2350.0f+((GX*53-GY*89)%700-350.0f);
            if(FMath::Abs(X)<7800.0f && Y>-11500.0f && Y<3200.0f) continue;
            WildFlowers.Emplace(FRotator(0.0f,(GX*29+GY*41)%360,0.0f),FVector(X,Y,10.0f),FVector(0.34f+((GX+GY)&3)*0.04f));
        }
    }
    SpawnInstancedMeshCluster(TEXT("CubeWildTreesA_HISM"),TEXT("/Game/Phantom/Curated/Cube/SM_Cube_Tree_A.SM_Cube_Tree_A"),WildTreesA,false);
    SpawnInstancedMeshCluster(TEXT("CubeWildTreesB_HISM"),TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Tree_B.SM_CC0_Tree_B"),WildTreesB,false);
    SpawnInstancedMeshCluster(TEXT("CubeWildRocks_HISM"),TEXT("/Game/Phantom/Curated/Cube/SM_Cube_Rock_A.SM_Cube_Rock_A"),WildRocks,false);
    SpawnInstancedMeshCluster(TEXT("CubeWildFlowers_HISM"),TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Flower.SM_CC0_Flower"),WildFlowers,false);

    // Satellite hamlets: map size now buys actual places, not travel time. Each is a readable micro-POI.
    const FVector HamletCenters[]={
        FVector(-21500,-13500,32),FVector(20500,-12500,32),FVector(-25000,12500,32),FVector(23500,14500,32),
        FVector(-12000,27000,32),FVector(11500,28500,32),FVector(-34500,-7500,32),FVector(34500,5000,32)
    };
    for(int32 H=0;H<UE_ARRAY_COUNT(HamletCenters);++H)
    {
        for(int32 I=0;I<5;++I)
        {
            const float A=I*(2.0f*PI/5.0f)+H*0.31f;
            const TCHAR* House=(I%2==0)?TEXT("/Game/Phantom/Curated/Cube/SM_Cube_House_A.SM_Cube_House_A"):
                                            TEXT("/Game/Phantom/Curated/Cube/SM_Cube_House_B.SM_Cube_House_B");
            SpawnStaticMeshAsset(FString::Printf(TEXT("SatelliteHamlet_%02d_House_%02d"),H,I),House,
                HamletCenters[H]+FVector(FMath::Cos(A)*1450.0f,FMath::Sin(A)*1450.0f,0),FVector(0.90f+(I%3)*0.08f),
                FRotator(0.0f,A*180.0f/PI+90.0f,0.0f),true,true);
        }
        SpawnStaticMeshAsset(FString::Printf(TEXT("SatelliteHamlet_%02d_Well"),H),TEXT("/Game/Phantom/Curated/Cube/SM_Cube_Well.SM_Cube_Well"),
            HamletCenters[H],FVector(0.95f),FRotator::ZeroRotator,false,true);
        SpawnPointLight(FString::Printf(TEXT("SatelliteHamlet_%02d_Light"),H),HamletCenters[H]+FVector(0,0,220),
            FLinearColor(1.0f,0.48f,0.20f),850.0f,300.0f,false);
    }

    SpawnDreamWorldDetails();
    SpawnShape(EPhantomPrimitive::Cylinder,TEXT("HeartstoneRing"),FVector(0,-4200,42),FVector(320,320,18),FLinearColor(0.16f,0.72f,0.92f),FRotator::ZeroRotator,false);
    SpawnShape(EPhantomPrimitive::Sphere,TEXT("HeartstoneCore"),FVector(0,-4200,150),FVector(64),FLinearColor(0.68f,0.22f,0.82f),FRotator::ZeroRotator,false);
    if(APointLight* L=SpawnPointLight(TEXT("HeartstoneLight"),FVector(0,-4200,190),FLinearColor(0.30f,0.68f,1.0f),3300.0f,460.0f,false)) DreamNightLights.Add(L);
}

void ACubetownDirector::SpawnVillage()
{
    const bool bProductionWorld = GetWorld() && GetWorld()->GetMapName().Contains(TEXT("CubeTown_World"));
    if (bProductionWorld)
    {
        // Visual Heartstone is authored into the persistent map. Runtime only adds social actors.
        const FVector Homes[]={FVector(-2400,-6900,90),FVector(2400,-6900,90),FVector(0,-4700,90)};
        for(int32 I=0;I<3;++I)
        {
            ACubetownVillager* V=GetWorld()->SpawnActor<ACubetownVillager>(Homes[I],FRotator(0,90,0));
            if(!V) continue; V->Configure(static_cast<ECubetownFriend>(I),Homes[I]); Villagers.Add(V);
        }
        return;
    }
    const FVector Center(0,-4200,30);
    // V8 authored plaza/path replaces the giant tan prototype rectangle and repeated cube walkway.
    SpawnStaticMeshAsset(TEXT("HeartstoneV8Plaza"),TEXT("/Game/Phantom/Generated/Cubetown/V8/Setpieces/SM_V8_HeartstonePlaza.SM_V8_HeartstonePlaza"),
        Center+FVector(0,0,6),FVector(1.0f),FRotator::ZeroRotator,false,false);
    SpawnStaticMeshAsset(TEXT("HeartstoneV8Promenade"),TEXT("/Game/Phantom/Generated/Cubetown/V8/Setpieces/SM_V8_HeartstonePath.SM_V8_HeartstonePath"),
        FVector(0,-6200,8),FVector(1.0f),FRotator::ZeroRotator,false,false);
    SpawnStaticMeshAsset(TEXT("HeartstoneFountain"),TEXT("/Game/Phantom/Curated/Cube/SM_Cube_Well.SM_Cube_Well"),Center+FVector(0,0,10),FVector(1.45f),FRotator::ZeroRotator,false,true);
    if(APointLight* L=SpawnPointLight(TEXT("HeartstoneFountainLight"),Center+FVector(0,0,230),FLinearColor(0.18f,0.78f,1.0f),1400.0f,360.0f,false)) DreamNightLights.Add(L);

    // V8 MAX-DENSITY OPENING HERO DISTRICT: the first camera frame must contain full-size architecture,
    // red trees and readable props. These sit 20-85m in front of the player, not kilometers away.
    const FVector OpeningHousePositions[] = {
        FVector(-2600,-9000,35), FVector(2600,-9000,35),
        FVector(-4100,-7600,35), FVector(4100,-7600,35),
        FVector(-4700,-5600,35), FVector(4700,-5600,35),
        FVector(-3500,-3900,35), FVector(3500,-3900,35)
    };
    for (int32 OI=0; OI<UE_ARRAY_COUNT(OpeningHousePositions); ++OI)
    {
        static const TCHAR* V9OpeningAssets[]={
            TEXT("/Game/Phantom/Generated/Cubetown/V9/Architecture/SM_V9_CubeTavern.SM_V9_CubeTavern"),
            TEXT("/Game/Phantom/Generated/Cubetown/V9/Architecture/SM_V9_CubeHouse_01.SM_V9_CubeHouse_01"),
            TEXT("/Game/Phantom/Generated/Cubetown/V9/Architecture/SM_V9_CubeHouse_02.SM_V9_CubeHouse_02"),
            TEXT("/Game/Phantom/Generated/Cubetown/V9/Architecture/SM_V9_CubeBlacksmith.SM_V9_CubeBlacksmith"),
            TEXT("/Game/Phantom/Generated/Cubetown/V9/Architecture/SM_V9_CubeHouse_03.SM_V9_CubeHouse_03"),
            TEXT("/Game/Phantom/Generated/Cubetown/V9/Architecture/SM_V9_CubeWorkshop.SM_V9_CubeWorkshop"),
            TEXT("/Game/Phantom/Generated/Cubetown/V9/Architecture/SM_V9_CubeInn.SM_V9_CubeInn"),
            TEXT("/Game/Phantom/Generated/Cubetown/V9/Architecture/SM_V9_CubeHouse_04.SM_V9_CubeHouse_04")
        };
        const TCHAR* OpeningAsset = V9OpeningAssets[OI%UE_ARRAY_COUNT(V9OpeningAssets)];
        SpawnStaticMeshAsset(FString::Printf(TEXT("OpeningHeroHouse_%02d"),OI),OpeningAsset,
            OpeningHousePositions[OI],FVector(1.05f+(OI%3)*0.08f),
            FRotator(0.0f, OI%2==0 ? 20.0f : -20.0f, 0.0f),true,true);
    }
    const FVector OpeningTrees[] = {
        FVector(-6000,-9500,30),FVector(6000,-9500,30),FVector(-6200,-7200,30),FVector(6200,-7200,30),
        FVector(-6500,-4700,30),FVector(6500,-4700,30),FVector(-5200,-2500,30),FVector(5200,-2500,30)
    };
    for(int32 OI=0; OI<UE_ARRAY_COUNT(OpeningTrees); ++OI)
        SpawnStaticMeshAsset(FString::Printf(TEXT("OpeningCrimsonTree_%02d"),OI),
            OI%4==0?TEXT("/Game/Phantom/Generated/Cubetown/V9/Nature/SM_V9_AmberTree_0.SM_V9_AmberTree_0"):(OI%3==0?TEXT("/Game/Phantom/Generated/Cubetown/V9/Nature/SM_V9_RoseTree_0.SM_V9_RoseTree_0"):TEXT("/Game/Phantom/Generated/Cubetown/V9/Nature/SM_V9_CrimsonTree_0.SM_V9_CrimsonTree_0")),
            OpeningTrees[OI],FVector(1.0f+(OI%3)*0.08f),FRotator(0,OI*29.0f,0),false,true);
    SpawnStaticMeshAsset(TEXT("OpeningDreamPortal"),TEXT("/Game/Phantom/Generated/Cubetown/V9/Setpieces/SM_V9_DreamPortal.SM_V9_DreamPortal"),
        FVector(0,-2100,20),FVector(1.0f),FRotator::ZeroRotator,false,true);
    SpawnPointLight(TEXT("OpeningDreamPortalLight"),FVector(0,-2100,480),FLinearColor(0.62f,0.20f,1.0f),2600.0f,760.0f,false);

    struct FHouse{const TCHAR* Asset;FVector P;float S;float Yaw;};
    const FHouse Houses[]={
        {TEXT("/Game/Phantom/Curated/Cube/SM_Cube_House_A.SM_Cube_House_A"),FVector(-4700,-6100,36),1.28f,24},
        {TEXT("/Game/Phantom/Curated/Cube/SM_Cube_House_B.SM_Cube_House_B"),FVector(4700,-6100,36),1.28f,-24},
        {TEXT("/Game/Phantom/Curated/Cube/SM_Cube_Blacksmith.SM_Cube_Blacksmith"),FVector(0,-8500,36),1.38f,0},
        {TEXT("/Game/Phantom/Curated/Cube/SM_Cube_House_A.SM_Cube_House_A"),FVector(-6500,-3000,36),1.16f,65},
        {TEXT("/Game/Phantom/Curated/Cube/SM_Cube_House_B.SM_Cube_House_B"),FVector(6500,-3000,36),1.16f,-65},
        {TEXT("/Game/Phantom/Curated/Cube/SM_Cube_Blacksmith.SM_Cube_Blacksmith"),FVector(-6200,-8500,36),1.08f,18},
        {TEXT("/Game/Phantom/Curated/Cube/SM_Cube_House_A.SM_Cube_House_A"),FVector(6200,-8500,36),1.08f,-18}
    };
    for(int32 I=0;I<UE_ARRAY_COUNT(Houses);++I)
    {
        SpawnStaticMeshAsset(FString::Printf(TEXT("HeartstoneHouse_%02d"),I),Houses[I].Asset,Houses[I].P,FVector(Houses[I].S),FRotator(0,Houses[I].Yaw,0),true,true);
        if(APointLight* L=SpawnPointLight(FString::Printf(TEXT("HeartstonePorch_%02d"),I),Houses[I].P+FVector(0,0,180),FLinearColor(1.0f,0.50f,0.20f),420.0f,220.0f,false)) DreamNightLights.Add(L);
    }
    SpawnStaticMeshAsset(TEXT("HeartstoneMarket"),TEXT("/Game/Phantom/Curated/Cube/SM_Cube_Market.SM_Cube_Market"),FVector(2400,-6500,35),FVector(1.32f),FRotator(0,-18,0),false,true);
    SpawnStaticMeshAsset(TEXT("HeartstoneInn"),TEXT("/Game/Phantom/Generated/Cubetown/V9/Architecture/SM_V9_CubeInn.SM_V9_CubeInn"),FVector(-7800,-5200,35),FVector(1.52f),FRotator(0,84,0),true,true);
    SpawnStaticMeshAsset(TEXT("HeartstoneWorkshop"),TEXT("/Game/Phantom/Generated/Cubetown/V9/Architecture/SM_V9_CubeWorkshop.SM_V9_CubeWorkshop"),FVector(7800,-5200,35),FVector(1.42f),FRotator(0,-84,0),true,true);

    // Main promenade and warm night lighting lead directly toward Crimson Grove.
    for(int32 I=0;I<22;++I)
    {
        const float Y=-2500.0f+I*620.0f;
        for(int32 Side=-1;Side<=1;Side+=2)
        {
            const FVector P(Side*520.0f,Y,35.0f);
            SpawnStaticMeshAsset(FString::Printf(TEXT("HeartstoneLantern_%02d_%d"),I,Side),TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Lantern.SM_CC0_Lantern"),P,FVector(0.92f),FRotator::ZeroRotator,false,true);
            if(I%2==0) if(APointLight* L=SpawnPointLight(FString::Printf(TEXT("HeartstoneLampLight_%02d_%d"),I,Side),P+FVector(0,0,170),FLinearColor(1.0f,0.50f,0.22f),280.0f,190.0f,false)) DreamNightLights.Add(L);
        }
    }

    // Red-tree parks make the signature identity visible in the first thirty seconds.
    const FVector ParkTrees[]={FVector(-7900,-7800,30),FVector(-7600,-1000,30),FVector(-4300,-9800,30),FVector(4300,-9800,30),FVector(7600,-1000,30),FVector(7900,-7800,30),FVector(-3100,-1800,30),FVector(3100,-1800,30)};
    for(int32 I=0;I<UE_ARRAY_COUNT(ParkTrees);++I) SpawnDreamTree(FString::Printf(TEXT("HeartstoneCrimsonPark_%02d"),I),ParkTrees[I],0.84f+(I%3)*0.12f,I%5,true);
    for(int32 I=0;I<18;++I)
    {
        const float A=I*2.399f; const FVector P=Center+FVector(FMath::Cos(A)*(1300+(I%5)*520),FMath::Sin(A)*(1000+(I%4)*470),18);
        SpawnStaticMeshAsset(FString::Printf(TEXT("HeartstoneFlower_%02d"),I),TEXT("/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamFlowerPatch_A.SM_CubeDreamFlowerPatch_A"),P,FVector(0.35f+(I%3)*0.08f),FRotator(0,I*23,0),false,true);
    }

    const FVector Homes[]={FVector(-3900,-5700,90),FVector(3900,-5700,90),FVector(0,-7900,90)};
    for(int32 I=0;I<3;++I)
    {
        ACubetownVillager* V=GetWorld()->SpawnActor<ACubetownVillager>(Homes[I],FRotator::ZeroRotator); if(!V)continue; V->Configure(static_cast<ECubetownFriend>(I),Homes[I]); Villagers.Add(V);
    }
    SpawnStaticMeshAsset(TEXT("VillageSign"),TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Sign.SM_CC0_Sign"),FVector(-650,-2600,35),FVector(1.1f),FRotator(0,30,0),false,true);
    SpawnStaticMeshAsset(TEXT("VillageCart"),TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Cart.SM_CC0_Cart"),FVector(-2700,-7000,35),FVector(1.05f),FRotator(0,28,0),false,true);
    SpawnStaticMeshAsset(TEXT("VillageBench"),TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Bench.SM_CC0_Bench"),FVector(1100,-3500,35),FVector(1.0f),FRotator(0,90,0),false,true);

    // HEARTSTONE DENSITY PASS: the opening ten minutes must never read as an empty field.
    // Extra architecture is deliberately kept within ~180m of the player spawn and follows roads/plazas.
    for(int32 I=0;I<18;++I)
    {
        const float A=I*(2.0f*PI/18.0f)+0.18f;
        const float R=9800.0f+(I%3)*1500.0f;
        const FVector P=Center+FVector(FMath::Cos(A)*R,FMath::Sin(A)*R,34.0f);
        const TCHAR* House=(I%3==0)?TEXT("/Game/Phantom/Curated/Cube/SM_Cube_House_A.SM_Cube_House_A"):
                           ((I%3==1)?TEXT("/Game/Phantom/Curated/Cube/SM_Cube_House_B.SM_Cube_House_B"):
                                     TEXT("/Game/Phantom/Curated/Cube/SM_Cube_Blacksmith.SM_Cube_Blacksmith"));
        SpawnStaticMeshAsset(FString::Printf(TEXT("HeartstoneOuterHouse_%02d"),I),House,P,FVector(1.02f+(I%4)*0.07f),
            FRotator(0,A*180.0f/PI+90.0f,0),true,true);
        if(I%2==0) SpawnDreamTree(FString::Printf(TEXT("HeartstoneOuterCrimson_%02d"),I),
            P+FVector(FMath::Cos(A+1.57f)*620.0f,FMath::Sin(A+1.57f)*620.0f,0),0.96f+(I%3)*0.12f,I%5,true);
    }
    for(int32 I=0;I<72;++I)
    {
        const float A=I*2.399963f;
        const float R=1800.0f+(I%12)*870.0f;
        const FVector P=Center+FVector(FMath::Cos(A)*R,FMath::Sin(A)*R,8.0f);
        if(I%4==0) SpawnDreamTree(FString::Printf(TEXT("HeartstoneDenseTree_%03d"),I),P,0.72f+(I%5)*0.08f,(I+1)%5,true);
        else if(I%4==1) SpawnStaticMeshAsset(FString::Printf(TEXT("HeartstoneDenseFlower_%03d"),I),
            TEXT("/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamFlowerPatch_A.SM_CubeDreamFlowerPatch_A"),P,FVector(0.34f+(I%3)*0.07f),FRotator(0,I*17.0f,0),false,true);
        else if(I%4==2) SpawnStaticMeshAsset(FString::Printf(TEXT("HeartstoneDenseMushroom_%03d"),I),
            TEXT("/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamMushroomCluster_A.SM_CubeDreamMushroomCluster_A"),P,FVector(0.34f+(I%4)*0.06f),FRotator(0,I*29.0f,0),false,true);
        else SpawnStaticMeshAsset(FString::Printf(TEXT("HeartstoneDenseRock_%03d"),I),
            TEXT("/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamRockCluster_Cream.SM_CubeDreamRockCluster_Cream"),P,FVector(0.34f+(I%4)*0.06f),FRotator(0,I*31.0f,0),false,true);
    }
}

void ACubetownDirector::PrimaryAtCursor(APlayerController* PlayerController, AActor* DamageCauser, float DamageMultiplier)
{
    if (!PlayerController) return;
    FHitResult Hit;
    const bool bHasHit = AdventureTrace(PlayerController, Hit);
    ACubetownHero* Hero = Cast<ACubetownHero>(UGameplayStatics::GetPlayerCharacter(this, 0));
    if (bHasHit)
    {
        if (ACubetownEnemy* Enemy = Cast<ACubetownEnemy>(Hit.GetActor()))
        {
            if (!Hero || FVector::DistSquared2D(Hero->GetActorLocation(), Enemy->GetActorLocation()) > FMath::Square(360.0f))
            {
                QuestStatus = TEXT("MOVE CLOSER TO STRIKE // OR SUMMON A RANGED BLOOM ECHO");
                return;
            }
            UGameplayStatics::ApplyDamage(Enemy, 42.0f * DamageMultiplier, PlayerController, DamageCauser, UDamageType::StaticClass());
            QuestStatus = TEXT("CREATURE ENGAGED // CAPTURE ITS ECHO WHEN IT FALLS");
            return;
        }
        ACubetownBlock* Block = Cast<ACubetownBlock>(Hit.GetActor());
        if (Block && Block->IsMineable())
        {
            const FIntVector Grid = Block->GetGrid();
            const ECubetownBlockType Type = Block->GetBlockType();
            if (Inventory.Num() < 6) Inventory.SetNumZeroed(6);
            Inventory[static_cast<int32>(Type)] += 1;
            Blocks.Remove(Grid);
            if (PlayerPlacedBlocks.Remove(Grid) == 0) RemovedWorldBlocks.Add(Grid);
            Block->Destroy();
            QuestStatus = FString::Printf(TEXT("GATHERED %s // MAKER MATERIAL ADDED"), BlockName(Type));
            return;
        }
    }
    ACubetownEnemy* Nearest = nullptr;
    float NearestDistance = TNumericLimits<float>::Max();
    if (Hero)
    {
        for (TActorIterator<ACubetownEnemy> It(GetWorld()); It; ++It)
        {
            const float Distance = FVector::DistSquared2D(Hero->GetActorLocation(), It->GetActorLocation());
            if (Distance < FMath::Square(420.0f) && Distance < NearestDistance)
            {
                Nearest = *It;
                NearestDistance = Distance;
            }
        }
    }
    if (Nearest)
    {
        UGameplayStatics::ApplyDamage(Nearest, 30.0f * DamageMultiplier, PlayerController, DamageCauser, UDamageType::StaticClass());
        QuestStatus = TEXT("ECHO STRIKE AUTO-TARGETED THE NEAREST CREATURE");
    }
    else
    {
        QuestStatus = TEXT("NO CREATURE IN RANGE // EXPLORE, TALK TO FRIENDS, OR FOLLOW THE SHRINE LIGHTS");
    }
}

void ACubetownDirector::PlaceAtCursor(APlayerController* PlayerController)
{
    // Compatibility entry point retained for old saves/launchers only. Player-facing voxel placement is retired.
    // Construction belongs to Sims-like Build Mode (B); Creation magic belongs to Hold-Q.
    (void)PlayerController;
    QuestStatus = TEXT("BLOCK CONSTRUCTION RETIRED // PRESS B FOR HOUSES / WALLS / ROOMS OR HOLD Q FOR CREATION MAGIC");
}



FString ACubetownDirector::BuildAssetForIndex(int32 Index) const
{
    static const TCHAR* Assets[]={
        TEXT("/Game/Phantom/Generated/Cubetown/Prefabs/SM_CubePrefab_Cottage.SM_CubePrefab_Cottage"),
        TEXT("/Game/Phantom/Generated/Cubetown/Prefabs/SM_CubePrefab_Workshop.SM_CubePrefab_Workshop"),
        TEXT("/Game/Phantom/Generated/Cubetown/Prefabs/SM_CubePrefab_Barn.SM_CubePrefab_Barn"),
        TEXT("/Game/Phantom/Generated/Cubetown/Prefabs/SM_CubePrefab_Shop.SM_CubePrefab_Shop"),
        TEXT("/Game/Phantom/Generated/Cubetown/Prefabs/SM_CubePrefab_Tower.SM_CubePrefab_Tower"),
        TEXT("/Game/Phantom/Generated/Cubetown/Prefabs/SM_CubePrefab_Stable.SM_CubePrefab_Stable"),
        TEXT("/Game/Phantom/Generated/Cubetown/Prefabs/SM_CubePrefab_Greenhouse.SM_CubePrefab_Greenhouse"),
        TEXT("/Game/Phantom/Generated/Cubetown/Prefabs/SM_CubePrefab_Inn.SM_CubePrefab_Inn")
    };
    return Assets[FMath::Clamp(Index,0,7)];
}
FString ACubetownDirector::BuildNameForIndex(int32 Index) const
{
    static const TCHAR* Names[]={TEXT("COTTAGE"),TEXT("WORKSHOP"),TEXT("BARN"),TEXT("SHOP"),TEXT("TOWER"),TEXT("STABLE"),TEXT("GREENHOUSE"),TEXT("INN")};
    return Names[FMath::Clamp(Index,0,7)];
}

void ACubetownDirector::ToggleBuildMode(APlayerController* PlayerController)
{
    bBuildMode=!bBuildMode;
    ACubetownHero* Hero=Cast<ACubetownHero>(UGameplayStatics::GetPlayerCharacter(this,0));
    if(bBuildMode)
    {
        BuildPrefabName=BuildNameForIndex(BuildCatalogIndex);
        QuestStatus=FString::Printf(TEXT("BUILD MODE // %s // [1] HOUSE [2] WALL [3] ROOM [4] FENCE [5] GARDEN [6] DECOR // CTRL+Z/Y UNDO/REDO"),*BuildPrefabName);
        if(Hero&&Hero->GetCharacterMovement()){ Hero->GetCharacterMovement()->DisableMovement(); Hero->SetBuildCameraMode(true); }
        if(PlayerController){PlayerController->bShowMouseCursor=true;FInputModeGameAndUI M;M.SetHideCursorDuringCapture(false);PlayerController->SetInputMode(M);}
        UpdateBuildPreview(PlayerController);
    }
    else
    {
        CancelBuildPlacement();
        if(Hero&&Hero->GetCharacterMovement()){ Hero->GetCharacterMovement()->SetMovementMode(MOVE_Walking); Hero->SetBuildCameraMode(false); }
        if(PlayerController){PlayerController->bShowMouseCursor=false;PlayerController->SetInputMode(FInputModeGameOnly());}
        QuestStatus=TEXT("ADVENTURE MODE // EXPLORE, FIGHT, CREATE, AND TALK TO YOUR FRIENDS");
    }
}

void ACubetownDirector::UpdateBuildPreview(APlayerController* PlayerController)
{
    if(!bBuildMode||!PlayerController) return;
    // Wall/room tools intentionally have no prefab ghost. Destroy only the old prefab preview;
    // never clear bHasBuildStart here or the first wall/room click would be erased on the next Tick.
    if(BuildToolIndex!=0)
    {
        if(AStaticMeshActor* Preview=BuildPreview.Get()) Preview->Destroy();
        BuildPreview.Reset();
        return;
    }
    FHitResult Hit;
    if(!AdventureTrace(PlayerController,Hit)) return;
    FVector P=Hit.Location;
    P.Z=FMath::Max(P.Z,0.0f);
    // Architectural snapping: Alt = free, Shift = 25cm detail, default = 50cm, Ctrl = 100cm structure.
    const bool bFree=PlayerController->IsInputKeyDown(EKeys::LeftAlt)||PlayerController->IsInputKeyDown(EKeys::RightAlt);
    const bool bFine=PlayerController->IsInputKeyDown(EKeys::LeftShift)||PlayerController->IsInputKeyDown(EKeys::RightShift);
    const bool bCoarse=PlayerController->IsInputKeyDown(EKeys::LeftControl)||PlayerController->IsInputKeyDown(EKeys::RightControl);
    const float Snap=bFine?25.0f:(bCoarse?100.0f:50.0f);
    if(!bFree){P.X=FMath::GridSnap(P.X,Snap);P.Y=FMath::GridSnap(P.Y,Snap);}
    if(!BuildPreview.IsValid())
    {
        AStaticMeshActor* Preview=SpawnStaticMeshAsset(TEXT("BuildPreview"),BuildAssetForIndex(BuildCatalogIndex),P,FVector(1.0f),FRotator(0,BuildYaw,0),false,true);
        if(Preview)
        {
            BuildPreview=Preview;
            if(UStaticMeshComponent* Mesh=Preview->GetStaticMeshComponent())
            {
                Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
                Mesh->SetCastShadow(false);
            }
        }
    }
    if(AStaticMeshActor* Preview=BuildPreview.Get())
    {
        Preview->SetActorLocation(P);
        Preview->SetActorRotation(FRotator(0,BuildYaw,0));
    }
}

void ACubetownDirector::SetBuildTool(int32 ToolIndex)
{
    if(!bBuildMode) return;
    BuildToolIndex=FMath::Clamp(ToolIndex,0,5); bHasBuildStart=false; CancelBuildPlacement();
    if(BuildToolIndex==0) QuestStatus=FString::Printf(TEXT("PREFAB HOUSE TOOL // %s // LMB PLACE  [/] CATALOG  Q/E ROTATE"),*BuildNameForIndex(BuildCatalogIndex));
    else if(BuildToolIndex==1) QuestStatus=TEXT("WALL TOOL // CLICK START, CLICK END // NO BLOCKS // CTRL+Z/Y TRANSACTIONS");
    else if(BuildToolIndex==2) QuestStatus=TEXT("ROOM TOOL // CLICK FIRST CORNER, CLICK OPPOSITE // AUTO FOUR WALLS");
    else if(BuildToolIndex==3) QuestStatus=TEXT("FENCE TOOL // CLICK START, CLICK END // GARDENS AND LOT BOUNDARIES");
    else if(BuildToolIndex==4) QuestStatus=TEXT("GARDEN TOOL // LMB PLACE FLOWER / MUSHROOM COMPOSITION // [/] VARIATION");
    else QuestStatus=TEXT("DECOR TOOL // LMB PLACE LANTERN / BENCH / BRIDGE / MARKET PROP // [/] CATALOG");
}

void ACubetownDirector::RegisterBuildActor(AStaticMeshActor* Actor,const FString& AssetPath)
{
    if(!Actor)return;
    Actor->Tags.Add(FName(*(FString(TEXT("BuildAsset:"))+AssetPath)));
    PlayerBuildables.Add(Actor);
}

void ACubetownDirector::PushBuildTransaction(const TArray<TWeakObjectPtr<AActor>>& Actors)
{
    if(Actors.IsEmpty())return;
    FBuildTransaction Tx; Tx.Actors=Actors; BuildUndoStack.Add(MoveTemp(Tx));
    if(BuildUndoStack.Num()>50) BuildUndoStack.RemoveAt(0, BuildUndoStack.Num() - 50);
    BuildRedoStack.Reset();
}

void ACubetownDirector::CommitBuildTool(APlayerController* PlayerController)
{
    if(!bBuildMode||!PlayerController)return;
    if(BuildToolIndex==0){PlaceBuildPrefab(PlayerController,true);return;}
    if(BuildToolIndex==4||BuildToolIndex==5)
    {
        FHitResult Hit;if(!AdventureTrace(PlayerController,Hit))return; const FVector P=Hit.Location;
        FString Asset;
        if(BuildToolIndex==4) Asset=(BuildCatalogIndex%2==0)?TEXT("/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamFlowerPatch_A.SM_CubeDreamFlowerPatch_A"):TEXT("/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamMushroomCluster_A.SM_CubeDreamMushroomCluster_A");
        else Asset=BuildAssetForIndex(FMath::Clamp(BuildCatalogIndex,3,7));
        TArray<TWeakObjectPtr<AActor>> Tx; AStaticMeshActor* A=SpawnStaticMeshAsset(FString::Printf(TEXT("PlayerDecor_%d"),PlayerBuildables.Num()),Asset,P,FVector(BuildToolIndex==4?0.55f:1.0f),FRotator(0,BuildYaw,0),true,true);
        if(A){RegisterBuildActor(A,Asset);Tx.Add(A);PushBuildTransaction(Tx);} QuestStatus=TEXT("PLACED // CTRL+Z UNDO  CTRL+Y REDO");return;
    }
    FHitResult Hit;if(!AdventureTrace(PlayerController,Hit))return; FVector Point=Hit.Location;Point.Z=FMath::Max(Point.Z,0.0f);
    const bool bFree=PlayerController->IsInputKeyDown(EKeys::LeftAlt)||PlayerController->IsInputKeyDown(EKeys::RightAlt);
    const bool bFine=PlayerController->IsInputKeyDown(EKeys::LeftShift)||PlayerController->IsInputKeyDown(EKeys::RightShift);
    const bool bCoarse=PlayerController->IsInputKeyDown(EKeys::LeftControl)||PlayerController->IsInputKeyDown(EKeys::RightControl);
    const float Snap=bFine?25.0f:(bCoarse?100.0f:50.0f);
    if(!bFree){Point.X=FMath::GridSnap(Point.X,Snap);Point.Y=FMath::GridSnap(Point.Y,Snap);}
    if(!bHasBuildStart){BuildStart=Point;bHasBuildStart=true;QuestStatus=BuildToolIndex==2?TEXT("ROOM CORNER SET // CLICK OPPOSITE CORNER"):TEXT("START SET // CLICK ENDPOINT");return;}
    TArray<TWeakObjectPtr<AActor>> Tx;
    const FString SegmentAsset=BuildToolIndex==3?TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Fence.SM_CC0_Fence"):TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_CastleWall.SM_CC0_CastleWall");
    auto SpawnLine=[&](const FVector& A,const FVector& B)
    {
        const FVector Delta=B-A;const float Length=Delta.Size2D();if(Length<80.0f)return;const float SegmentLength=BuildToolIndex==3?240.0f:320.0f;
        const int32 Count=FMath::Max(1,FMath::CeilToInt(Length/SegmentLength));const FVector Step=Delta/static_cast<float>(Count);const float Yaw=Delta.Rotation().Yaw;
        for(int32 I=0;I<Count;++I){const FVector P=A+Step*(I+0.5f);AStaticMeshActor* Piece=SpawnStaticMeshAsset(FString::Printf(TEXT("PlayerStructure_%d_%d"),PlayerBuildables.Num(),I),SegmentAsset,P,FVector(BuildToolIndex==3?0.75f:0.62f),FRotator(0,Yaw,0),true,true);if(Piece){RegisterBuildActor(Piece,SegmentAsset);Tx.Add(Piece);}}
    };
    if(BuildToolIndex==2){const FVector A=BuildStart,C=Point,B(C.X,A.Y,FMath::Max(A.Z,C.Z)),D(A.X,C.Y,FMath::Max(A.Z,C.Z));SpawnLine(A,B);SpawnLine(B,C);SpawnLine(C,D);SpawnLine(D,A);}else SpawnLine(BuildStart,Point);
    bHasBuildStart=false;PushBuildTransaction(Tx);QuestStatus=FString::Printf(TEXT("%s BUILT // CTRL+Z UNDO  CTRL+Y REDO"),BuildToolIndex==2?TEXT("ROOM"):BuildToolIndex==3?TEXT("FENCE"):TEXT("WALL"));
}

void ACubetownDirector::PlaceBuildPrefab(APlayerController* PlayerController,bool bKeepTool)
{
    if(!bBuildMode||!PlayerController)return;UpdateBuildPreview(PlayerController);AStaticMeshActor* Preview=BuildPreview.Get();if(!Preview)return;
    const FVector P=Preview->GetActorLocation();const FRotator R=Preview->GetActorRotation();const FString Asset=BuildAssetForIndex(BuildCatalogIndex);
    TArray<TWeakObjectPtr<AActor>> Tx;AStaticMeshActor* Placed=SpawnStaticMeshAsset(FString::Printf(TEXT("PlayerBuild_%d"),PlayerBuildables.Num()),Asset,P,FVector(1.0f),R,true,true);
    if(Placed){RegisterBuildActor(Placed,Asset);Tx.Add(Placed);PushBuildTransaction(Tx);}QuestStatus=FString::Printf(TEXT("%s PLACED // CTRL+Z/Y // [/] CATALOG // Q/E ROTATE"),*BuildNameForIndex(BuildCatalogIndex));if(!bKeepTool)CancelBuildPlacement();
}

void ACubetownDirector::CancelBuildPlacement(){if(AStaticMeshActor* Preview=BuildPreview.Get())Preview->Destroy();BuildPreview.Reset();bHasBuildStart=false;}
void ACubetownDirector::RotateBuildPreview(float Degrees){if(!bBuildMode)return;BuildYaw=FMath::Fmod(BuildYaw+Degrees+360.0f,360.0f);if(AStaticMeshActor* Preview=BuildPreview.Get())Preview->SetActorRotation(FRotator(0,BuildYaw,0));}
void ACubetownDirector::CycleBuildPrefab(int32 Direction){if(!bBuildMode)return;BuildCatalogIndex=(BuildCatalogIndex+Direction+8)%8;BuildPrefabName=BuildNameForIndex(BuildCatalogIndex);CancelBuildPlacement();}

void ACubetownDirector::UndoLastBuild()
{
    if(!bBuildMode||BuildUndoStack.IsEmpty())return;FBuildTransaction Tx=BuildUndoStack.Pop();int32 Count=0;
    for(TWeakObjectPtr<AActor>& Ref:Tx.Actors)if(AActor* A=Ref.Get()){A->SetActorHiddenInGame(true);A->SetActorEnableCollision(false);++Count;}
    BuildRedoStack.Add(MoveTemp(Tx));QuestStatus=FString::Printf(TEXT("UNDO // %d BUILD PIECES HIDDEN // CTRL+Y REDO"),Count);
}
void ACubetownDirector::RedoLastBuild()
{
    if(!bBuildMode||BuildRedoStack.IsEmpty())return;FBuildTransaction Tx=BuildRedoStack.Pop();int32 Count=0;
    for(TWeakObjectPtr<AActor>& Ref:Tx.Actors)if(AActor* A=Ref.Get()){A->SetActorHiddenInGame(false);A->SetActorEnableCollision(true);++Count;}
    BuildUndoStack.Add(MoveTemp(Tx));if(BuildUndoStack.Num()>50)BuildUndoStack.RemoveAt(0);QuestStatus=FString::Printf(TEXT("REDO // %d BUILD PIECES RESTORED"),Count);
}


void ACubetownDirector::BeginCreationSelection()
{
    if(bBuildMode||ActivePanel!=0||bCreationSelecting)return;bCreationSelecting=true;CreationHoldSeconds=0.0f;UGameplayStatics::SetGlobalTimeDilation(this,0.32f);
    QuestStatus=FString::Printf(TEXT("CREATION WHEEL // %s // WHEEL OR R CYCLES // RELEASE Q TO CALL"),EchoName(SelectedEcho));
}
void ACubetownDirector::EndCreationSelection()
{
    if(!bCreationSelecting)return;bCreationSelecting=false;UGameplayStatics::SetGlobalTimeDilation(this,1.0f);SummonEcho();
}
void ACubetownDirector::TogglePanel(int32 PanelIndex)
{
    if(bBuildMode)return;ActivePanel=(ActivePanel==PanelIndex)?0:FMath::Clamp(PanelIndex,1,3);
    if(APlayerController* PC=GetWorld()?GetWorld()->GetFirstPlayerController():nullptr)
    {
        const bool Open=ActivePanel!=0; PC->bShowMouseCursor=Open;
        if(Open){FInputModeGameAndUI Mode;Mode.SetHideCursorDuringCapture(false);PC->SetInputMode(Mode);}
        else PC->SetInputMode(FInputModeGameOnly());
    }
}
FString ACubetownDirector::GetWeatherName() const
{
    static const TCHAR* Names[]={TEXT("CLEAR DREAM"),TEXT("PETAL WIND"),TEXT("MAGIC DRIZZLE"),TEXT("LAVENDER MIST")};return Names[FMath::Clamp(WeatherIndex,0,3)];
}
FString ACubetownDirector::GetRegionName(const FVector& P) const
{
    struct R{FVector C;const TCHAR* N;};const R Regions[]={
        {FVector(0,15000,0),TEXT("CRIMSON GROVE")},{FVector(16000,6000,0),TEXT("STARFALL MEADOWS")},{FVector(-17000,15000,0),TEXT("FROSTBLOOM HEIGHTS")},
        {FVector(-17000,-7000,0),TEXT("MOONMOSS MARSH")},{FVector(17500,-14000,0),TEXT("SUNPETAL COAST")},{FVector(22000,17000,0),TEXT("EMBERBLOOM VALLEY")},{FVector(0,-4200,0),TEXT("HEARTSTONE / CROWNLANDS")}};
    float Best=TNumericLimits<float>::Max();const TCHAR* Name=TEXT("CROWNLANDS");for(const R& Region:Regions){const float D=FVector::DistSquared2D(P,Region.C);if(D<Best){Best=D;Name=Region.N;}}return FString(Name);
}
void ACubetownDirector::UpdateDreamEnvironment(float DeltaSeconds)
{
    TimeOfDayHours=FMath::Fmod(TimeOfDayHours+DeltaSeconds*(24.0f/900.0f),24.0f);if(TimeOfDayHours<0)TimeOfDayHours+=24.0f;
    const float DayAlpha=FMath::Clamp(FMath::Sin((TimeOfDayHours-6.0f)/12.0f*PI),0.0f,1.0f);
    if(ADirectionalLight* Sun=DreamSun.Get())if(UDirectionalLightComponent* C=Cast<UDirectionalLightComponent>(Sun->GetLightComponent()))
    {const float Angle=(TimeOfDayHours/24.0f)*360.0f-90.0f;Sun->SetActorRotation(FRotator(-18.0f-FMath::Sin((TimeOfDayHours-6.0f)/12.0f*PI)*48.0f,Angle*0.35f-30.0f,0));C->SetIntensity(0.35f+DayAlpha*5.0f);C->SetLightColor(FLinearColor::LerpUsingHSV(FLinearColor(0.48f,0.58f,0.90f),FLinearColor(1.0f,0.78f,0.56f),DayAlpha));}
    const float NightAlpha=1.0f-DayAlpha;for(TWeakObjectPtr<APointLight>& Ref:DreamNightLights)if(APointLight* L=Ref.Get())if(UPointLightComponent* C=Cast<UPointLightComponent>(L->GetLightComponent()))C->SetIntensity(FMath::Lerp(90.0f,850.0f,NightAlpha));
    WeatherRemaining-=DeltaSeconds;if(WeatherRemaining<=0.0f){WeatherIndex=(WeatherIndex+1)%4;WeatherRemaining=85.0f+WeatherIndex*24.0f;}
}

void ACubetownDirector::RestoreSavedBuilds()
{
    // EMERGENCY VISUAL RECOVERY: old experimental CubeTown saves could contain giant primitive/
    // voxel-era transforms. Never let one stale save turn the new authored world into a black wall.
    const int32 Count=FMath::Min(SavedBuildAssetPaths.Num(),SavedBuildTransforms.Num());
    for(int32 I=0;I<Count;++I)
    {
        const FString& Asset=SavedBuildAssetPaths[I];
        const FTransform& T=SavedBuildTransforms[I];
        const FVector L=T.GetLocation();
        const FVector Sc=T.GetScale3D();
        const bool bApprovedArchitecture =
            Asset.Contains(TEXT("/Game/Phantom/Generated/Cubetown/Prefabs/")) ||
            Asset.Contains(TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_House")) ||
            Asset.Contains(TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_CastleWall")) ||
            Asset.Contains(TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Fence"));
        const bool bSaneTransform =
            FMath::Abs(L.X)<=47000.0f && FMath::Abs(L.Y)<=47000.0f &&
            Sc.GetAbsMax()<=4.0f &&
            FMath::Min3(FMath::Abs(Sc.X),FMath::Abs(Sc.Y),FMath::Abs(Sc.Z))>=0.05f;
        if(!bApprovedArchitecture || !bSaneTransform) continue;
        AStaticMeshActor* A=SpawnStaticMeshAsset(FString::Printf(TEXT("RestoredBuild_%03d"),I),Asset,L,Sc,T.Rotator(),true,true);
        if(A) RegisterBuildActor(A,Asset);
    }
}

void ACubetownDirector::CycleBlock()
{
    // Kept for backwards-compatible save data; no player-facing block construction is exposed.
    QuestStatus = TEXT("CUBETOWN DOES NOT USE BLOCK BUILDING // PRESS B FOR ARCHITECTURE OR HOLD Q FOR CREATION MAGIC");
}

void ACubetownDirector::CycleEcho()
{
    SelectedEcho = static_cast<ECubetownEchoType>((static_cast<int32>(SelectedEcho) + 1) % 3);
}

bool ACubetownDirector::IsEchoUnlocked(ECubetownEchoType Type) const
{
    if (Type == ECubetownEchoType::Blade) return bBladeUnlocked;
    if (Type == ECubetownEchoType::Boulder) return bBoulderUnlocked;
    return bBloomUnlocked;
}

void ACubetownDirector::SummonEcho()
{
    if (!IsEchoUnlocked(SelectedEcho) || EchoEnergy < 12) return;
    ACubetownHero* Hero = Cast<ACubetownHero>(UGameplayStatics::GetPlayerCharacter(this, 0));
    if (!Hero) return;
    if (ActiveEcho.IsValid()) ActiveEcho->Destroy();
    EchoEnergy -= 12;
    ACubetownEcho* Echo = GetWorld()->SpawnActor<ACubetownEcho>(Hero->GetActorLocation() + FVector(-95.0f, 105.0f, 20.0f), Hero->GetActorRotation());
    if (Echo)
    {
        Echo->Configure(SelectedEcho);
        ActiveEcho = Echo;
        QuestStatus = FString::Printf(TEXT("%s SUMMONED // YOUR COPIED CREATURE FIGHTS BESIDE YOU"), EchoName(SelectedEcho));
    }
}

void ACubetownDirector::InteractNearby(const FVector& HeroLocation)
{
    ACubetownVillager* NearestVillager = nullptr;
    float BestDistance = FMath::Square(285.0f);
    for (const TWeakObjectPtr<ACubetownVillager>& Entry : Villagers)
    {
        ACubetownVillager* Villager = Entry.Get();
        if (!Villager) continue;
        const float Distance = FVector::DistSquared2D(HeroLocation, Villager->GetActorLocation());
        if (Distance < BestDistance)
        {
            BestDistance = Distance;
            NearestVillager = Villager;
        }
    }
    if (NearestVillager)
    {
        TalkToVillager(NearestVillager);
        return;
    }

    for (const TWeakObjectPtr<ACubetownShrine>& Entry : Shrines)
    {
        const ACubetownShrine* Shrine = Entry.Get();
        if (Shrine && !Shrine->IsActive() && FVector::DistSquared2D(HeroLocation, Shrine->GetActorLocation()) <= FMath::Square(285.0f))
        {
            ActivateNearbyShrine(HeroLocation);
            return;
        }
    }

    if (Friendship.Num() < 3 || Friendship[0] == 0 || Friendship[1] == 0 || Friendship[2] == 0)
    {
        QuestStatus = TEXT("YOUR FRIENDS ARE WAITING IN HEARTSTONE // FOLLOW THE GOLD OBJECTIVE MARKER");
    }
    else if (ShrinesRestored < 3)
    {
        QuestStatus = TEXT("NO DORMANT SHRINE IN REACH // FOLLOW THE COLORED BEACONS INTO THE WILD");
    }
    else
    {
        QuestStatus = TEXT("THE RIFT GUARDIAN AWAITS BEYOND HEARTSTONE // READY YOUR ECHO COMPANION");
    }
}

FString ACubetownDirector::GetInteractionPrompt(const FVector& HeroLocation) const
{
    float BestVillagerDistance = FMath::Square(340.0f);
    const ACubetownVillager* BestVillager = nullptr;
    for (const TWeakObjectPtr<ACubetownVillager>& Entry : Villagers)
    {
        const ACubetownVillager* Villager = Entry.Get();
        if (!Villager) continue;
        const float Distance = FVector::DistSquared2D(HeroLocation, Villager->GetActorLocation());
        if (Distance < BestVillagerDistance)
        {
            BestVillagerDistance = Distance;
            BestVillager = Villager;
        }
    }
    if (BestVillager)
    {
        return FString::Printf(TEXT("[E] TALK TO %s"), FriendName(BestVillager->GetFriendType()));
    }

    for (const TWeakObjectPtr<ACubetownShrine>& Entry : Shrines)
    {
        const ACubetownShrine* Shrine = Entry.Get();
        if (Shrine && !Shrine->IsActive() && FVector::DistSquared2D(HeroLocation, Shrine->GetActorLocation()) <= FMath::Square(340.0f))
        {
            return EchoEnergy >= 20
                ? TEXT("[E] RESTORE WISDOM SHRINE  //  20 ECHO")
                : FString::Printf(TEXT("NEED %d MORE ECHO TO RESTORE"), 20 - EchoEnergy);
        }
    }
    return FString();
}

FString ACubetownDirector::GetObjectiveMarker(const FVector& HeroLocation) const
{
    const bool bFriendIntroComplete = Friendship.Num() >= 3 && Friendship[0] > 0 && Friendship[1] > 0 && Friendship[2] > 0;
    if (!bFriendIntroComplete)
    {
        float BestDistance = TNumericLimits<float>::Max();
        const ACubetownVillager* BestVillager = nullptr;
        for (const TWeakObjectPtr<ACubetownVillager>& Entry : Villagers)
        {
            const ACubetownVillager* Villager = Entry.Get();
            if (!Villager) continue;
            const int32 FriendIndex = FMath::Clamp(static_cast<int32>(Villager->GetFriendType()), 0, 2);
            if (Friendship.IsValidIndex(FriendIndex) && Friendship[FriendIndex] > 0) continue;
            const float Distance = FVector::DistSquared2D(HeroLocation, Villager->GetActorLocation());
            if (Distance < BestDistance)
            {
                BestDistance = Distance;
                BestVillager = Villager;
            }
        }
        if (BestVillager)
        {
            return FString::Printf(TEXT("MEET %s  //  %d M"), FriendName(BestVillager->GetFriendType()), FMath::RoundToInt(FMath::Sqrt(BestDistance) / 100.0f));
        }
    }

    if (ShrinesRestored < 3)
    {
        float BestDistance = TNumericLimits<float>::Max();
        for (const TWeakObjectPtr<ACubetownShrine>& Entry : Shrines)
        {
            const ACubetownShrine* Shrine = Entry.Get();
            if (!Shrine || Shrine->IsActive()) continue;
            BestDistance = FMath::Min(BestDistance, FVector::DistSquared2D(HeroLocation, Shrine->GetActorLocation()));
        }
        if (BestDistance < TNumericLimits<float>::Max())
        {
            return FString::Printf(TEXT("RESTORE WISDOM SHRINE  //  %d M  //  %d/3"), FMath::RoundToInt(FMath::Sqrt(BestDistance) / 100.0f), ShrinesRestored);
        }
    }

    if (!bGuardianDefeated)
    {
        const float Distance = FVector::Dist2D(HeroLocation, FVector(22000.0f, 17000.0f, HeroLocation.Z));
        return FString::Printf(TEXT("RIFT GUARDIAN  //  %d M"), FMath::RoundToInt(Distance / 100.0f));
    }
    return GetTotalFriendship() >= 12 ? TEXT("HEARTSTONE FESTIVAL  //  EXPLORE FREELY") : TEXT("RETURN TO HEARTSTONE  //  DEEPEN FRIENDSHIPS");
}

void ACubetownDirector::TalkToVillager(ACubetownVillager* Villager)
{
    if (!Villager) return;
    const int32 Index = FMath::Clamp(static_cast<int32>(Villager->GetFriendType()), 0, 2);
    if (Friendship.Num() < 3) Friendship.SetNumZeroed(3);
    if (FriendTalkCooldowns.Num() < 3) FriendTalkCooldowns.SetNumZeroed(3);
    const TCHAR* Name = FriendName(Villager->GetFriendType());

    if (FriendTalkCooldowns[Index] > 0.0f)
    {
        QuestStatus = FString::Printf(TEXT("%s: GOOD TO SEE YOU AGAIN // COME BACK AFTER YOUR NEXT ADVENTURE"), Name);
        return;
    }

    Friendship[Index] = FMath::Clamp(Friendship[Index] + 1, 0, 5);
    FriendTalkCooldowns[Index] = 22.0f;
    const int32 Level = Friendship[Index];

    if (Villager->GetFriendType() == ECubetownFriend::Mira)
    {
        EchoEnergy += 6 + Level * 2;
        QuestStatus = FString::Printf(TEXT("MIRA FRIENDSHIP %d/5 // SHE SHARES ECHO ENERGY FOR THE ROAD"), Level);
    }
    else if (Villager->GetFriendType() == ECubetownFriend::Rowan)
    {
        Inventory[static_cast<int32>(ECubetownBlockType::Wood)] += 4 + Level;
        Inventory[static_cast<int32>(ECubetownBlockType::Stone)] += 2 + Level / 2;
        QuestStatus = FString::Printf(TEXT("ROWAN FRIENDSHIP %d/5 // MAKER MATERIALS ADDED TO YOUR KIT"), Level);
    }
    else
    {
        if (ACubetownHero* Hero = Cast<ACubetownHero>(UGameplayStatics::GetPlayerCharacter(this, 0))) Hero->RestoreHealth(18.0f + Level * 4.0f);
        if (Level >= 3) Inventory[static_cast<int32>(ECubetownBlockType::Crystal)] += 1;
        QuestStatus = FString::Printf(TEXT("PIP FRIENDSHIP %d/5 // YOUR HEARTS HAVE BEEN RESTORED"), Level);
    }

    if (Friendship[0] > 0 && Friendship[1] > 0 && Friendship[2] > 0 && StoryChapter < 1) StoryChapter = 1;
    if (bGuardianDefeated && StoryChapter < 3) StoryChapter = 3;
    if (bGuardianDefeated && GetTotalFriendship() >= 12) StoryChapter = 4;
    SaveProgress();
}

void ACubetownDirector::RefreshStoryQuest()
{
    if (Friendship.Num() < 3) Friendship.SetNumZeroed(3);
    if (bGuardianDefeated)
    {
        StoryChapter = FMath::Max(StoryChapter, 3);
        if (GetTotalFriendship() >= 12)
        {
            StoryChapter = 4;
            QuestStatus = TEXT("HEARTSTONE FESTIVAL UNLOCKED // CUBETOWN IS SAFE, YOUR FRIENDS ARE THRIVING, EXPLORE FREELY");
        }
        else
        {
            QuestStatus = TEXT("CUBETOWN RESTORED // DEEPEN FRIENDSHIPS WITH MIRA, ROWAN, AND PIP TO PREPARE THE FESTIVAL");
        }
        return;
    }
    if (ShrinesRestored >= 3)
    {
        StoryChapter = FMath::Max(StoryChapter, 2);
        QuestStatus = TEXT("THE THREE SHRINES ARE AWAKE // THE RIFT GUARDIAN THREATENS HEARTSTONE VILLAGE");
        return;
    }
    if (Friendship[0] > 0 && Friendship[1] > 0 && Friendship[2] > 0)
    {
        StoryChapter = FMath::Max(StoryChapter, 1);
        QuestStatus = FString::Printf(TEXT("FRIENDS UNITED // RESTORE THE WISDOM SHRINES %d/3 AND GROW YOUR ECHO TEAM"), ShrinesRestored);
        return;
    }
    StoryChapter = 0;
    QuestStatus = TEXT("WELCOME TO HEARTSTONE VILLAGE // [E] TALK TO MIRA, ROWAN, AND PIP");
}

void ACubetownDirector::ActivateNearbyShrine(const FVector& HeroLocation)
{
    for (int32 ShrineIndex = 0; ShrineIndex < Shrines.Num(); ++ShrineIndex)
    {
        ACubetownShrine* Shrine = Shrines[ShrineIndex].Get();
        if (!Shrine || Shrine->IsActive() || FVector::DistSquared2D(HeroLocation, Shrine->GetActorLocation()) > FMath::Square(260.0f)) continue;
        if (EchoEnergy < 20)
        {
            QuestStatus = TEXT("THE SHRINE NEEDS 20 ECHO ENERGY // DEFEAT CREATURES OR SUMMON LESS");
            return;
        }
        EchoEnergy -= 20;
        Shrine->Activate();
        ActiveShrineIndices.Add(ShrineIndex);
        ShrinesRestored = ActiveShrineIndices.Num();
        if (ACubetownHero* Hero = Cast<ACubetownHero>(UGameplayStatics::GetPlayerCharacter(this, 0))) Hero->RestoreHealth(40.0f);
        QuestStatus = FString::Printf(TEXT("WISDOM SHRINE RESTORED // %d OF 3 // YOUR FRIENDS FEEL THE ISLAND HEALING"), ShrinesRestored);
        if (ShrinesRestored >= 3 && !bGuardianSpawned && !bGuardianDefeated)
        {
            bGuardianSpawned = true;
            SpawnEnemy(ECubetownEnemyType::RiftGuardian, FVector(22000.0f, 17000.0f, 155.0f), WorldCycle + 3);
            StoryChapter = FMath::Max(StoryChapter, 2);
            QuestStatus = TEXT("THE RIFT GUARDIAN AWAKENS // DEFEND HEARTSTONE VILLAGE WITH YOUR ECHO COMPANION");
        }
        SaveProgress();
        return;
    }
    QuestStatus = TEXT("NO DORMANT SHRINE NEARBY // FOLLOW THE COLORED BEACONS");
}

void ACubetownDirector::SpawnEnemy(ECubetownEnemyType Type, const FVector& Location, int32 Tier)
{
    ACubetownEnemy* Enemy = GetWorld()->SpawnActor<ACubetownEnemy>(Location, FRotator::ZeroRotator);
    if (!Enemy) return;
    Enemy->Configure(Type, Tier);
    ++EnemiesAlive;
}

void ACubetownDirector::SpawnEnemyWave()
{
    if (bGuardianSpawned || bGuardianDefeated) return;
    const int32 Count = FMath::Min(18, 9 + WorldCycle * 2);
    for (int32 Index = 0; Index < Count; ++Index)
    {
        const float Angle = (Index + WorldCycle * 0.37f) * (2.0f * PI / Count);
        const float Radius = 5200.0f + (Index % 3) * 950.0f;
        // Keep the opening silhouette readable: the first ring begins beyond the village,
        // then naturally advances into contact instead of surrounding the spawn camera.
        const FVector Location(FMath::Cos(Angle) * Radius, 3000.0f + FMath::Sin(Angle) * Radius, 155.0f);
        ECubetownEnemyType Type = ECubetownEnemyType::Gloomling;
        if (WorldCycle >= 2 && Index % 3 == 1) Type = ECubetownEnemyType::Roller;
        if (WorldCycle >= 3 && Index % 4 == 2) Type = ECubetownEnemyType::BloomWisp;
        SpawnEnemy(Type, Location, WorldCycle);
    }
    QuestStatus = FString::Printf(TEXT("WORLD CYCLE %d // NEW CREATURE ECHOES HAVE EMERGED"), WorldCycle);
}

void ACubetownDirector::RegisterEnemyDefeat(ECubetownEnemyType Type)
{
    EnemiesAlive = FMath::Max(0, EnemiesAlive - 1);
    if (Type == ECubetownEnemyType::RiftGuardian)
    {
        bGuardianDefeated = true;
        bGuardianSpawned = false;
        StoryChapter = FMath::Max(StoryChapter, 3);
        EchoEnergy += 100;
        Inventory[static_cast<int32>(ECubetownBlockType::Crystal)] += 24;
        QuestStatus = TEXT("RIFT GUARDIAN DEFEATED // RETURN TO YOUR FRIENDS IN HEARTSTONE VILLAGE");
        SaveProgress();
        return;
    }
    const int32 EnergyGain = Type == ECubetownEnemyType::Roller ? 16 : (Type == ECubetownEnemyType::BloomWisp ? 14 : 10);
    EchoEnergy += EnergyGain;
    if (Type == ECubetownEnemyType::Gloomling) bBladeUnlocked = true;
    if (Type == ECubetownEnemyType::Roller) bBoulderUnlocked = true;
    if (Type == ECubetownEnemyType::BloomWisp) bBloomUnlocked = true;
    const ECubetownEchoType Captured = Type == ECubetownEnemyType::Roller
        ? ECubetownEchoType::Boulder
        : (Type == ECubetownEnemyType::BloomWisp ? ECubetownEchoType::Bloom : ECubetownEchoType::Blade);
    QuestStatus = FString::Printf(TEXT("%s LEARNED // SELECT WITH R, SUMMON WITH E"), EchoName(Captured));
}

void ACubetownDirector::NotifyHeroDefeated()
{
    EchoEnergy = FMath::Max(0, EchoEnergy - 15);
    QuestStatus = TEXT("THE MAKER REAWAKENS AT THE HEARTSTONE // 15 ECHO ENERGY LOST");
}

void ACubetownDirector::PulseNearbyEnemies(const FVector& Origin, float Radius, float Damage, AActor* DamageCauser)
{
    int32 HitCount = 0;
    for (TActorIterator<ACubetownEnemy> It(GetWorld()); It; ++It)
    {
        if (FVector::DistSquared2D(Origin, It->GetActorLocation()) > FMath::Square(Radius)) continue;
        UGameplayStatics::ApplyDamage(*It, Damage, nullptr, DamageCauser, UDamageType::StaticClass());
        ++HitCount;
    }
    QuestStatus = HitCount > 0
        ? FString::Printf(TEXT("DASH BURST HIT %d CREATURES // KEEP MOVING"), HitCount)
        : TEXT("DASH READY // USE IT TO BREAK THROUGH CREATURE PACKS");
}

int32 ACubetownDirector::GetInventory(ECubetownBlockType Type) const
{
    const int32 Index = static_cast<int32>(Type);
    return Inventory.IsValidIndex(Index) ? Inventory[Index] : 0;
}

void ACubetownDirector::LoadProgress()
{
    if (UCubetownSaveGame* Save = Cast<UCubetownSaveGame>(UGameplayStatics::LoadGameFromSlot(CubetownSaveSlot, 0)))
    {
        Inventory = Save->Inventory;
        if (Inventory.Num() < 6) Inventory.SetNumZeroed(6);
        EchoEnergy = Save->EchoEnergy;
        ShrinesRestored = FMath::Clamp(Save->ShrinesRestored, 0, 3);
        ActiveShrineIndices.Reset();
        if (!Save->ActiveShrineIndices.IsEmpty())
        {
            for (int32 Index : Save->ActiveShrineIndices) if (Index >= 0 && Index < 3) ActiveShrineIndices.Add(Index);
            ShrinesRestored = ActiveShrineIndices.Num();
        }
        else
        {
            for (int32 Index = 0; Index < ShrinesRestored; ++Index) ActiveShrineIndices.Add(Index);
        }
        WorldCycle = FMath::Max(1, Save->WorldCycle);
        PlayerPlacedBlocks.Reset();
        const int32 PlacedCount = FMath::Min(Save->PlacedBlockGrids.Num(), Save->PlacedBlockTypes.Num());
        for (int32 Index = 0; Index < PlacedCount; ++Index)
        {
            const uint8 RawType = Save->PlacedBlockTypes[Index];
            if (RawType <= static_cast<uint8>(ECubetownBlockType::Water))
            {
                PlayerPlacedBlocks.Add(Save->PlacedBlockGrids[Index], static_cast<ECubetownBlockType>(RawType));
            }
        }
        RemovedWorldBlocks.Reset();
        for (const FIntVector& Grid : Save->RemovedBlockGrids) RemovedWorldBlocks.Add(Grid);
        bBladeUnlocked = Save->bBladeUnlocked;
        bBoulderUnlocked = Save->bBoulderUnlocked;
        bBloomUnlocked = Save->bBloomUnlocked;
        bGuardianDefeated = Save->bGuardianDefeated;
        Friendship = Save->Friendship;
        if (Friendship.Num() < 3) Friendship.SetNumZeroed(3);
        StoryChapter = FMath::Clamp(Save->StoryChapter, 0, 4);
        SavedBuildAssetPaths=Save->BuildAssetPaths; SavedBuildTransforms=Save->BuildTransforms; TimeOfDayHours=Save->TimeOfDayHours;
        if (!bBladeUnlocked && !bBoulderUnlocked && !bBloomUnlocked)
        {
            bBladeUnlocked = true;
            EchoEnergy = FMath::Max(EchoEnergy, 24);
        }
    }
}

void ACubetownDirector::SaveProgress()
{
    UCubetownSaveGame* Save = Cast<UCubetownSaveGame>(UGameplayStatics::CreateSaveGameObject(UCubetownSaveGame::StaticClass()));
    if (!Save) return;
    Save->Inventory = Inventory;
    Save->EchoEnergy = EchoEnergy;
    Save->ShrinesRestored = ShrinesRestored;
    Save->ActiveShrineIndices = ActiveShrineIndices.Array();
    Save->WorldCycle = WorldCycle;
    Save->PlacedBlockGrids.Reset();
    Save->PlacedBlockTypes.Reset();
    for (const TPair<FIntVector, ECubetownBlockType>& Pair : PlayerPlacedBlocks)
    {
        Save->PlacedBlockGrids.Add(Pair.Key);
        Save->PlacedBlockTypes.Add(static_cast<uint8>(Pair.Value));
    }
    Save->RemovedBlockGrids = RemovedWorldBlocks.Array();
    Save->bBladeUnlocked = bBladeUnlocked;
    Save->bBoulderUnlocked = bBoulderUnlocked;
    Save->bBloomUnlocked = bBloomUnlocked;
    Save->bGuardianDefeated = bGuardianDefeated;
    Save->Friendship = Friendship;
    Save->StoryChapter = StoryChapter;
    Save->TimeOfDayHours=TimeOfDayHours; Save->BuildAssetPaths.Reset(); Save->BuildTransforms.Reset();
    for(const TWeakObjectPtr<AActor>& Ref:PlayerBuildables)
    {
        AActor* A=Ref.Get(); if(!A||A->IsHidden())continue; FString AssetPath;
        for(const FName& Tag:A->Tags){const FString T=Tag.ToString();if(T.StartsWith(TEXT("BuildAsset:"))){AssetPath=T.RightChop(11);break;}}
        if(!AssetPath.IsEmpty()){Save->BuildAssetPaths.Add(AssetPath);Save->BuildTransforms.Add(A->GetActorTransform());}
    }
    UGameplayStatics::SaveGameToSlot(Save, CubetownSaveSlot, 0);
}
