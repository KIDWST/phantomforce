#include "Strike/PhantomStrikeDirector.h"
#include "Core/PhantomGameShell.h"

#include "Animation/AnimInstance.h"
#include "Camera/CameraComponent.h"
#include "Components/CapsuleComponent.h"
#include "Components/PointLightComponent.h"
#include "Components/PrimitiveComponent.h"
#include "Components/SkeletalMeshComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/Canvas.h"
#include "Engine/DamageEvents.h"
#include "Engine/Engine.h"
#include "Engine/EngineBaseTypes.h"
#include "Engine/PostProcessVolume.h"
#include "Engine/SkeletalMesh.h"
#include "Engine/StaticMeshActor.h"
#include "EngineUtils.h"
#include "DrawDebugHelpers.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "GameFramework/PlayerController.h"
#include "InputCoreTypes.h"
#include "Kismet/GameplayStatics.h"
#include "Materials/MaterialInstanceDynamic.h"

namespace
{
    constexpr int32 StrikeMagazineSize = 32;
    constexpr float StrikeReloadDuration = 1.35f;

    APhantomStrikeDirector* StrikeDirector(const UObject* Context)
    {
        if (!Context || !Context->GetWorld()) return nullptr;
        for (TActorIterator<APhantomStrikeDirector> It(Context->GetWorld()); It; ++It) return *It;
        return nullptr;
    }

    void ApplyShapeColor(UStaticMeshComponent* Mesh, const FLinearColor& Color)
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

    void SpawnBallisticTrace(
        UWorld* World,
        const FVector& Start,
        const FVector& End,
        const FLinearColor& Color,
        float Thickness,
        float Lifetime
    )
    {
        if (!World) return;
        const FVector Delta = End - Start;
        const float Distance = Delta.Size();
        if (Distance <= KINDA_SMALL_NUMBER) return;
        UStaticMesh* Cylinder = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
        UMaterialInterface* Base = LoadObject<UMaterialInterface>(
            nullptr,
            TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial")
        );
        if (!Cylinder || !Base) return;
        AStaticMeshActor* Trace = World->SpawnActor<AStaticMeshActor>((Start + End) * 0.5f, Delta.Rotation() + FRotator(90.0f, 0.0f, 0.0f));
        if (!Trace) return;
        Trace->SetActorEnableCollision(false);
        Trace->GetStaticMeshComponent()->SetCollisionEnabled(ECollisionEnabled::NoCollision);
        Trace->GetStaticMeshComponent()->SetStaticMesh(Cylinder);
        Trace->SetActorScale3D(FVector(Thickness / 100.0f, Thickness / 100.0f, Distance / 100.0f));
        UMaterialInstanceDynamic* Material = UMaterialInstanceDynamic::Create(Base, Trace);
        Material->SetVectorParameterValue(TEXT("Color"), Color);
        Trace->GetStaticMeshComponent()->SetMaterial(0, Material);
        Trace->SetLifeSpan(Lifetime);
    }

    void SpawnImpact(UWorld* World, const FVector& Location, const FLinearColor& Color)
    {
        if (!World) return;
        UStaticMesh* Sphere = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Sphere.Sphere"));
        UMaterialInterface* Base = LoadObject<UMaterialInterface>(
            nullptr,
            TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial")
        );
        if (!Sphere || !Base) return;
        AStaticMeshActor* Impact = World->SpawnActor<AStaticMeshActor>(Location, FRotator::ZeroRotator);
        if (!Impact) return;
        Impact->SetActorEnableCollision(false);
        Impact->GetStaticMeshComponent()->SetCollisionEnabled(ECollisionEnabled::NoCollision);
        Impact->GetStaticMeshComponent()->SetStaticMesh(Sphere);
        Impact->SetActorScale3D(FVector(0.055f));
        UMaterialInstanceDynamic* Material = UMaterialInstanceDynamic::Create(Base, Impact);
        Material->SetVectorParameterValue(TEXT("Color"), Color);
        Impact->GetStaticMeshComponent()->SetMaterial(0, Material);
        Impact->SetLifeSpan(0.14f);
    }

    void SpawnEjectedCasing(UWorld* World, const FVector& Location, const FVector& Forward, const FVector& Right)
    {
        if (!World) return;
        UStaticMesh* Cylinder = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
        UMaterialInterface* Base = LoadObject<UMaterialInterface>(nullptr, TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial"));
        if (!Cylinder || !Base) return;
        AStaticMeshActor* Casing = World->SpawnActor<AStaticMeshActor>(Location, Forward.Rotation() + FRotator(0.0f, 0.0f, 90.0f));
        if (!Casing) return;
        UStaticMeshComponent* Mesh = Casing->GetStaticMeshComponent();
        Mesh->SetStaticMesh(Cylinder);
        Mesh->SetCollisionEnabled(ECollisionEnabled::QueryAndPhysics);
        Mesh->SetStaticMesh(Cylinder);
        Casing->SetActorScale3D(FVector(0.018f, 0.018f, 0.050f));
        UMaterialInstanceDynamic* Material = UMaterialInstanceDynamic::Create(Base, Casing);
        Material->SetVectorParameterValue(TEXT("Color"), FLinearColor(0.46f, 0.27f, 0.055f));
        Mesh->SetMaterial(0, Material);
        Mesh->SetSimulatePhysics(true);
        Mesh->SetMassOverrideInKg(NAME_None, 0.014f, true);
        Mesh->SetPhysicsLinearVelocity(Right * FMath::FRandRange(160.0f, 240.0f) + FVector(0.0f, 0.0f, FMath::FRandRange(80.0f, 140.0f)) + Forward * 25.0f);
        Mesh->SetPhysicsAngularVelocityInDegrees(FVector(FMath::FRandRange(260.0f, 520.0f), FMath::FRandRange(-420.0f, 420.0f), FMath::FRandRange(180.0f, 460.0f)));
        Casing->SetLifeSpan(1.6f);
    }
}

APhantomStrikeCharacter::APhantomStrikeCharacter()
{
    PrimaryActorTick.bCanEverTick = true;
    AutoPossessPlayer = EAutoReceiveInput::Player0;
    FirstPersonCamera = CreateDefaultSubobject<UCameraComponent>(TEXT("FirstPersonCamera"));
    FirstPersonCamera->SetupAttachment(GetCapsuleComponent());
    // Keep the local view at a natural standing eye line. This is intentionally
    // higher than the legacy prototype camera, which read like a ground camera.
    FirstPersonCamera->SetRelativeLocation(FVector(-6.0f, 0.0f, 72.0f));
    FirstPersonCamera->bUsePawnControlRotation = true;
    FirstPersonCamera->FieldOfView = 90.0f;

    // V27 BLACKRIDGE REALISM: the player's visible body is the licensed Unreal
    // mannequin skeletal rig, driven by the Shooter template locomotion graph. The
    // old cylinders and spheres remain hidden emergency fallbacks only.
    if (USkeletalMesh* OperatorBody = LoadObject<USkeletalMesh>(nullptr, TEXT("/Game/Characters/Mannequins/Meshes/SKM_Manny_Simple.SKM_Manny_Simple")))
    {
        GetMesh()->SetSkeletalMeshAsset(OperatorBody);
        GetMesh()->SetRelativeLocation(FVector(0.0f, 0.0f, -96.0f));
        GetMesh()->SetRelativeRotation(FRotator(0.0f, -90.0f, 0.0f));
        GetMesh()->SetCollisionEnabled(ECollisionEnabled::NoCollision);
        // PhantomStrike is a first-person game. Never render the third-person mannequin
        // in the local single-player pawn: camera ownership can settle one frame late in
        // packaged launches and expose Manny's torso across the entire view.
        GetMesh()->SetOnlyOwnerSee(false);
        GetMesh()->SetOwnerNoSee(true);
        GetMesh()->SetCastHiddenShadow(false);
        GetMesh()->SetCastShadow(false);
        GetMesh()->SetVisibility(false, true);
        GetMesh()->SetHiddenInGame(true, true);
        if (UClass* OperatorAnimClass = LoadClass<UAnimInstance>(nullptr, TEXT("/Game/Variant_Shooter/Anims/ABP_TP_Rifle.ABP_TP_Rifle_C")))
        {
            GetMesh()->SetAnimationMode(EAnimationMode::AnimationBlueprint);
            GetMesh()->SetAnimInstanceClass(OperatorAnimClass);
        }
        bUsingRealisticBodyRig = true;
    }

    UStaticMesh* Cube = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cube.Cube"));
    UStaticMesh* Cylinder = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
    UStaticMesh* Sphere = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Sphere.Sphere"));
    RifleBody = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("NightglassRifle"));
    RifleBody->SetupAttachment(FirstPersonCamera);
    UStaticMesh* ImportedRifle = LoadObject<UStaticMesh>(nullptr, TEXT("/Game/Weapons/Rifle/Meshes/SM_Rifle.SM_Rifle"));
    bUsingTemplateWeapons = ImportedRifle != nullptr;
    if (!ImportedRifle) ImportedRifle = LoadObject<UStaticMesh>(nullptr, TEXT("/Game/Phantom/Strike/AssaultRifle.AssaultRifle"));
    bUsingImportedRifle = ImportedRifle != nullptr;
    RifleBody->SetStaticMesh(bUsingImportedRifle ? ImportedRifle : Cube);
    RifleBody->SetRelativeLocation(bUsingImportedRifle ? FVector(65.0f, 25.0f, -29.0f) : FVector(52.0f, 24.0f, -23.0f));
    if (bUsingImportedRifle)
    {
        const FVector FullSize = ImportedRifle->GetBounds().BoxExtent * 2.0f;
        const float LongestAxis = FMath::Max3(FullSize.X, FullSize.Y, FullSize.Z);
        // Source meshes can arrive in meter-scale authoring units.  A one-percent minimum
        // made an oversized import several metres long and placed the first-person camera
        // inside it. Preserve a readable 62 cm first-person presentation at
        // every source scale without changing its collision footprint.
        const float FitScale = FMath::Min(1.0f, 62.0f / FMath::Max(0.001f, LongestAxis));
        RifleBody->SetRelativeScale3D(FVector(FitScale));
        // Imported pivots are not guaranteed to be centered.  Keep the visual bounds in front of
        // the camera instead of placing an arbitrary source pivot at the presentation location.
        RifleBody->SetRelativeLocation(FVector(65.0f, 25.0f, -29.0f) - ImportedRifle->GetBounds().Origin * FitScale);
    }
    else
    {
        RifleBody->SetRelativeScale3D(FVector(0.52f, 0.085f, 0.095f));
    }
    RifleBody->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    RifleBody->SetOnlyOwnerSee(true);
    RifleBody->SetCastShadow(false);
    RifleBody->SetRelativeRotation(bUsingTemplateWeapons ? FRotator(0.0f, -90.0f, 0.0f) : FRotator::ZeroRotator);

    RifleBarrel = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("RifleBarrel"));
    RifleBarrel->SetupAttachment(RifleBody);
    RifleBarrel->SetStaticMesh(Cylinder);
    RifleBarrel->SetRelativeLocation(FVector(55.0f, 0.0f, 4.0f));
    RifleBarrel->SetRelativeRotation(FRotator(0.0f, 90.0f, 0.0f));
    RifleBarrel->SetRelativeScale3D(FVector(0.32f, 0.32f, 0.72f));
    RifleBarrel->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    RifleBarrel->SetOnlyOwnerSee(true);
    RifleBarrel->SetCastShadow(false);
    RifleBarrel->SetVisibility(!bUsingImportedRifle);

    RifleSight = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("RifleSight"));
    RifleSight->SetupAttachment(RifleBody);
    RifleSight->SetStaticMesh(Cube);
    RifleSight->SetRelativeLocation(FVector(4.0f, 0.0f, 15.0f));
    RifleSight->SetRelativeScale3D(FVector(0.12f, 0.16f, 0.12f));
    RifleSight->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    RifleSight->SetOnlyOwnerSee(true);
    RifleSight->SetCastShadow(false);
    RifleSight->SetVisibility(!bUsingImportedRifle);

    SidearmBody = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("P9Sidearm"));
    SidearmBody->SetupAttachment(FirstPersonCamera);
    UStaticMesh* Pistol = LoadObject<UStaticMesh>(nullptr,TEXT("/Game/Weapons/Pistol/Meshes/SM_Pistol.SM_Pistol"));
    bUsingTemplateSidearm = Pistol != nullptr;
    if (!Pistol) Pistol = LoadObject<UStaticMesh>(nullptr,TEXT("/Game/Phantom/Strike/Pistol.Pistol"));
    if (Pistol)
    {
        SidearmBody->SetStaticMesh(Pistol);
        const FVector FullSize = Pistol->GetBounds().BoxExtent * 2.0f;
        const float LongestAxis = FMath::Max3(FullSize.X, FullSize.Y, FullSize.Z);
        const float FitScale = FMath::Min(1.0f, 32.0f / FMath::Max(0.001f, LongestAxis));
        SidearmBody->SetRelativeScale3D(FVector(FitScale));
        SidearmBody->SetRelativeLocation(FVector(55.0f,20.0f,-29.0f) - Pistol->GetBounds().Origin * FitScale);
    }
    else
    {
        SidearmBody->SetStaticMesh(Cube);
        SidearmBody->SetRelativeScale3D(FVector(0.30f));
    }
    if (!SidearmBody->GetStaticMesh() || SidearmBody->GetStaticMesh()->GetPathName() != TEXT("/Game/Phantom/Strike/Pistol.Pistol"))
        SidearmBody->SetRelativeLocation(FVector(55.0f,20.0f,-29.0f));
    SidearmBody->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    SidearmBody->SetOnlyOwnerSee(true); SidearmBody->SetCastShadow(false); SidearmBody->SetVisibility(false);
    SidearmBody->SetRelativeRotation(bUsingTemplateSidearm ? FRotator(0.0f, -90.0f, 0.0f) : FRotator::ZeroRotator);

    RightForearm = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("RightTacticalForearm"));
    RightForearm->SetupAttachment(FirstPersonCamera);
    RightForearm->SetStaticMesh(Cylinder);
    RightForearm->SetRelativeLocation(FVector(25.0f, 31.0f, -38.0f));
    RightForearm->SetRelativeRotation(FRotator(67.0f, 0.0f, -8.0f));
    RightForearm->SetRelativeScale3D(FVector(0.105f, 0.105f, 0.34f));
    RightForearm->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    RightForearm->SetOnlyOwnerSee(true); RightForearm->SetCastShadow(false);
    RightForearm->SetVisibility(!bUsingRealisticBodyRig);

    LeftForearm = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("LeftTacticalForearm"));
    LeftForearm->SetupAttachment(FirstPersonCamera);
    LeftForearm->SetStaticMesh(Cylinder);
    LeftForearm->SetRelativeLocation(FVector(31.0f, -8.0f, -40.0f));
    LeftForearm->SetRelativeRotation(FRotator(64.0f, 8.0f, 13.0f));
    LeftForearm->SetRelativeScale3D(FVector(0.10f, 0.10f, 0.32f));
    LeftForearm->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    LeftForearm->SetOnlyOwnerSee(true); LeftForearm->SetCastShadow(false);
    LeftForearm->SetVisibility(!bUsingRealisticBodyRig);

    RightGlove = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("RightTacticalGlove"));
    RightGlove->SetupAttachment(FirstPersonCamera);
    RightGlove->SetStaticMesh(Sphere);
    RightGlove->SetRelativeLocation(FVector(49.0f, 25.0f, -29.0f));
    RightGlove->SetRelativeScale3D(FVector(0.13f, 0.105f, 0.095f));
    RightGlove->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    RightGlove->SetOnlyOwnerSee(true); RightGlove->SetCastShadow(false);
    RightGlove->SetVisibility(!bUsingRealisticBodyRig);

    LeftGlove = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("LeftTacticalGlove"));
    LeftGlove->SetupAttachment(FirstPersonCamera);
    LeftGlove->SetStaticMesh(Sphere);
    LeftGlove->SetRelativeLocation(FVector(57.0f, 5.0f, -27.0f));
    LeftGlove->SetRelativeScale3D(FVector(0.14f, 0.105f, 0.095f));
    LeftGlove->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    LeftGlove->SetOnlyOwnerSee(true); LeftGlove->SetCastShadow(false);
    LeftGlove->SetVisibility(!bUsingRealisticBodyRig);

    MuzzleBloom = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("MuzzleBloom"));
    MuzzleBloom->SetupAttachment(FirstPersonCamera);
    MuzzleBloom->SetStaticMesh(Sphere);
    MuzzleBloom->SetRelativeLocation(FVector(128.0f, 15.0f, -17.0f));
    MuzzleBloom->SetRelativeScale3D(FVector(0.12f, 0.06f, 0.06f));
    MuzzleBloom->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    MuzzleBloom->SetOnlyOwnerSee(true); MuzzleBloom->SetCastShadow(false); MuzzleBloom->SetVisibility(false);

    MuzzleLight = CreateDefaultSubobject<UPointLightComponent>(TEXT("MuzzleFlash"));
    MuzzleLight->SetupAttachment(FirstPersonCamera);
    MuzzleLight->SetRelativeLocation(FVector(130.0f, 15.0f, -17.0f));
    MuzzleLight->SetIntensity(0.0f);
    MuzzleLight->SetAttenuationRadius(360.0f);
    MuzzleLight->SetLightColor(FLinearColor(1.0f, 0.58f, 0.20f));
    MuzzleLight->SetCastShadows(false);

    GetCharacterMovement()->MaxWalkSpeed = 470.0f;
    GetCharacterMovement()->MaxAcceleration = 3600.0f;
    GetCharacterMovement()->GetNavAgentPropertiesRef().bCanCrouch = true;
    GetCharacterMovement()->BrakingDecelerationWalking = 2200.0f;
    bUseControllerRotationYaw = true;
}

void APhantomStrikeCharacter::BeginPlay()
{
    Super::BeginPlay();
    // V28 insertion is a grounded natural route, with the first encounter visible beyond
    // the first woodland bend. Always begin in a valid walking state.
    SetActorLocation(FVector(-11800.0f,0.0f,300.0f), false, nullptr, ETeleportType::TeleportPhysics);
    SetActorRotation(FRotator(0.0f,0.0f,0.0f));
    SetActorEnableCollision(true);
    GetCharacterMovement()->SetComponentTickEnabled(true);
    GetCharacterMovement()->SetPlaneConstraintEnabled(false);
    GetCharacterMovement()->SetMovementMode(MOVE_Walking);

    APlayerController* FirstPC = GetWorld() ? GetWorld()->GetFirstPlayerController() : nullptr;
    if (FirstPC && FirstPC->GetPawn() != this)
    {
        FirstPC->Possess(this);
    }
    if (FirstPC)
    {
        FirstPC->bShowMouseCursor = false;
        UGameplayStatics::SetViewportMouseCaptureMode(this, EMouseCaptureMode::CapturePermanently_IncludingInitialMouseDown);
        FInputModeGameOnly GameInput;
        FirstPC->SetInputMode(GameInput);
    }
    if (AController* C=GetController())
    {
        C->SetControlRotation(FRotator(-5.0f,0.0f,0.0f));
        bInitialViewApplied = true;
    }
    if (!bUsingImportedRifle)
    {
        ApplyShapeColor(RifleBody, FLinearColor(0.025f, 0.055f, 0.08f));
        ApplyShapeColor(RifleBarrel, FLinearColor(0.08f, 0.85f, 0.95f));
        ApplyShapeColor(RifleSight, FLinearColor(0.9f, 0.12f, 0.28f));
    }
    ApplyShapeColor(RightForearm, FLinearColor(0.18f, 0.16f, 0.12f));
    ApplyShapeColor(LeftForearm, FLinearColor(0.18f, 0.16f, 0.12f));
    ApplyShapeColor(RightGlove, FLinearColor(0.035f, 0.04f, 0.038f));
    ApplyShapeColor(LeftGlove, FLinearColor(0.035f, 0.04f, 0.038f));
    ApplyShapeColor(MuzzleBloom, FLinearColor(1.0f, 0.62f, 0.18f));
}

void APhantomStrikeCharacter::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    // Possession can complete after BeginPlay in packaged builds. Apply the
    // authored insertion view on the first controlled frame so release proof
    // and real launches share the same composition.
    if (!bInitialViewApplied)
    {
        if (AController* C = GetController())
        {
            C->SetControlRotation(FRotator(-5.0f, 0.0f, 0.0f));
            bInitialViewApplied = true;
        }
    }
    // Recovery guard for malformed or temporarily unloaded collision.  A packaged FPS must never
    // leave its camera below Blackridge's authored surface.
    if (GetActorLocation().Z < -200.0f)
    {
        SetActorLocation(FVector(-11800.0f, 0.0f, 300.0f), false, nullptr, ETeleportType::TeleportPhysics);
        GetCharacterMovement()->StopMovementImmediately();
    }

    // Packaged launchers can miss legacy axis mappings during their first focus handoff.
    // Recover possession and read the physical movement keys directly every frame, while
    // retaining the normal input bindings for remapping and controller support.
    APlayerController* FirstPC = GetWorld() ? GetWorld()->GetFirstPlayerController() : nullptr;
    if (FirstPC && FirstPC->GetPawn() != this)
    {
        FirstPC->Possess(this);
    }
    if (GetCharacterMovement()->MovementMode == MOVE_None)
    {
        GetCharacterMovement()->SetMovementMode(MOVE_Walking);
    }
    if (FirstPC && !UGameplayStatics::IsGamePaused(this))
    {
        const float ForwardInput = FMath::Clamp(
            (FirstPC->IsInputKeyDown(EKeys::W) || FirstPC->IsInputKeyDown(EKeys::Up) ? 1.0f : 0.0f)
            - (FirstPC->IsInputKeyDown(EKeys::S) || FirstPC->IsInputKeyDown(EKeys::Down) ? 1.0f : 0.0f)
            + FirstPC->GetInputAnalogKeyState(EKeys::Gamepad_LeftY), -1.0f, 1.0f);
        const float RightInput = FMath::Clamp(
            (FirstPC->IsInputKeyDown(EKeys::D) || FirstPC->IsInputKeyDown(EKeys::Right) ? 1.0f : 0.0f)
            - (FirstPC->IsInputKeyDown(EKeys::A) || FirstPC->IsInputKeyDown(EKeys::Left) ? 1.0f : 0.0f)
            + FirstPC->GetInputAnalogKeyState(EKeys::Gamepad_LeftX), -1.0f, 1.0f);
        if (!FMath::IsNearlyZero(ForwardInput) || !FMath::IsNearlyZero(RightInput))
        {
            const FRotator YawOnly(0.0f, FirstPC->GetControlRotation().Yaw, 0.0f);
            const FVector WishDirection = (
                FRotationMatrix(YawOnly).GetUnitAxis(EAxis::X) * ForwardInput
                + FRotationMatrix(YawOnly).GetUnitAxis(EAxis::Y) * RightInput
            ).GetClampedToMaxSize(1.0f);
            AddMovementInput(WishDirection, 1.0f);
            if (GetVelocity().SizeSquared2D() < 4.0f)
            {
                FHitResult MovementHit;
                AddActorWorldOffset(WishDirection * GetCharacterMovement()->MaxWalkSpeed * DeltaSeconds, true, &MovementHit);
            }
        }
    }
    FireCooldown = FMath::Max(0.0f, FireCooldown - DeltaSeconds);
    SlideRemaining = FMath::Max(0.0f, SlideRemaining - DeltaSeconds);
    MeleeRemaining = FMath::Max(0.0f, MeleeRemaining - DeltaSeconds);
    GrenadeRemaining = FMath::Max(0.0f, GrenadeRemaining - DeltaSeconds);
    TacticalRemaining = FMath::Max(0.0f, TacticalRemaining - DeltaSeconds);
    InspectRemaining = FMath::Max(0.0f, InspectRemaining - DeltaSeconds);
    WeaponHeat = FMath::Max(0.0f, WeaponHeat - DeltaSeconds * 0.65f);
    HitMarkerRemaining = FMath::Max(0.0f, HitMarkerRemaining - DeltaSeconds);
    DamageFlash = FMath::Max(0.0f, DamageFlash - DeltaSeconds * 1.8f);
    MuzzleFlashRemaining = FMath::Max(0.0f, MuzzleFlashRemaining - DeltaSeconds);
    TimeSinceDamage += DeltaSeconds;
    RecoilKick = FMath::FInterpTo(RecoilKick, 0.0f, DeltaSeconds, 15.0f);
    ShotImpulse = FMath::FInterpTo(ShotImpulse, 0.0f, DeltaSeconds, 20.0f);
    MuzzleLight->SetIntensity(MuzzleFlashRemaining > 0.0f ? 8500.0f : 0.0f);
    if (MuzzleBloom)
    {
        MuzzleBloom->SetVisibility(MuzzleFlashRemaining > 0.0f);
        const float BloomPulse = 0.72f + FMath::Clamp(MuzzleFlashRemaining / 0.055f, 0.0f, 1.0f) * 0.55f;
        MuzzleBloom->SetRelativeScale3D(FVector(0.12f, 0.06f, 0.06f) * BloomPulse);
    }

    if (AController* ViewController = GetController())
    {
        const FRotator ViewRotation = ViewController->GetControlRotation();
        if (bHasViewSample)
        {
            const float YawDelta = FMath::FindDeltaAngleDegrees(LastViewRotation.Yaw, ViewRotation.Yaw);
            const float PitchDelta = FMath::FindDeltaAngleDegrees(LastViewRotation.Pitch, ViewRotation.Pitch);
            const FVector2D TargetInertia(
                FMath::Clamp(-YawDelta * 0.42f, -3.8f, 3.8f),
                FMath::Clamp(-PitchDelta * 0.34f, -2.8f, 2.8f)
            );
            WeaponInertia.X = FMath::FInterpTo(WeaponInertia.X, TargetInertia.X, DeltaSeconds, 11.0f);
            WeaponInertia.Y = FMath::FInterpTo(WeaponInertia.Y, TargetInertia.Y, DeltaSeconds, 11.0f);
        }
        else
        {
            bHasViewSample = true;
        }
        LastViewRotation = ViewRotation;
    }

    const float DesiredFov = bAiming ? (bUsingSidearm ? 74.0f : 70.0f) : (bSprinting ? 96.0f : (SlideRemaining > 0.0f ? 94.0f : 90.0f));
    FirstPersonCamera->SetFieldOfView(FMath::FInterpTo(FirstPersonCamera->FieldOfView, DesiredFov, DeltaSeconds, 12.0f));
    const float CameraZ = bProne ? 32.0f : ((SlideRemaining > 0.0f || bCrouchedByInput) ? 50.0f : 72.0f);
    const FVector DesiredCameraLocation(-6.0f, 0.0f, CameraZ);
    FirstPersonCamera->SetRelativeLocation(FMath::VInterpTo(FirstPersonCamera->GetRelativeLocation(), DesiredCameraLocation, DeltaSeconds, 14.0f));
    const float MoveSpeed = GetVelocity().Size2D();
    WeaponBobTime += DeltaSeconds * (MoveSpeed > 40.0f ? (bSprinting ? 13.0f : 8.5f) : 2.0f);
    const float BobStrength = bAiming ? 0.45f : (bSprinting ? 2.4f : 1.25f);
    const FVector WeaponBob(
        -RecoilKick * 8.0f - ShotImpulse * 2.0f,
        FMath::Sin(WeaponBobTime) * BobStrength + WeaponInertia.X,
        FMath::Abs(FMath::Cos(WeaponBobTime * 0.5f)) * BobStrength - BobStrength * 0.5f + WeaponInertia.Y
    );
    const FVector RiflePivotOffset = bUsingImportedRifle && RifleBody->GetStaticMesh()
        ? RifleBody->GetStaticMesh()->GetBounds().Origin * RifleBody->GetRelativeScale3D().X
        : FVector::ZeroVector;
    const FVector RestLocation = (bUsingImportedRifle ? FVector(56.0f, 21.0f, -30.0f) : FVector(52.0f, 24.0f, -23.0f)) - RiflePivotOffset;
    const FVector AimLocation = (bUsingImportedRifle ? FVector(50.0f, 0.5f, -23.0f) : FVector(48.0f, 0.0f, -15.0f)) - RiflePivotOffset;
    const FVector SprintLocation = (bUsingImportedRifle ? FVector(43.0f, 34.0f, -39.0f) : FVector(43.0f, 34.0f, -31.0f)) - RiflePivotOffset;
    const FVector DesiredWeaponLocation = (bAiming ? AimLocation : (bSprinting ? SprintLocation : RestLocation)) + WeaponBob;
    RifleBody->SetRelativeLocation(FMath::VInterpTo(RifleBody->GetRelativeLocation(), DesiredWeaponLocation, DeltaSeconds, 14.0f));
    if (SidearmBody)
    {
        const FVector SidearmPivotOffset = SidearmBody->GetStaticMesh()
            ? SidearmBody->GetStaticMesh()->GetBounds().Origin * SidearmBody->GetRelativeScale3D().X
            : FVector::ZeroVector;
        const FVector SidearmTarget = (bAiming ? FVector(47.0f,0.5f,-22.0f) : FVector(46.0f,18.0f,-27.0f)) + WeaponBob - SidearmPivotOffset;
        SidearmBody->SetRelativeLocation(FMath::VInterpTo(SidearmBody->GetRelativeLocation(), SidearmTarget, DeltaSeconds, 16.0f));
    }

    UStaticMeshComponent* ActiveWeapon = bUsingSidearm ? SidearmBody : RifleBody;
    UStaticMeshComponent* InactiveWeapon = bUsingSidearm ? RifleBody : SidearmBody;
    const FRotator RifleBaseRotation = bUsingTemplateWeapons ? FRotator(0.0f, -90.0f, 0.0f) : FRotator::ZeroRotator;
    const FRotator SidearmBaseRotation = bUsingTemplateSidearm ? FRotator(0.0f, -90.0f, 0.0f) : FRotator::ZeroRotator;
    const FRotator ActiveBaseRotation = bUsingSidearm ? SidearmBaseRotation : RifleBaseRotation;
    const FRotator InactiveBaseRotation = bUsingSidearm ? RifleBaseRotation : SidearmBaseRotation;
    if (InactiveWeapon) InactiveWeapon->SetRelativeRotation(InactiveBaseRotation);
    const FRotator HandlingRotation(
        RecoilKick * 3.8f - WeaponInertia.Y * 0.42f,
        WeaponInertia.X * 0.52f,
        bSprinting ? -11.0f : 0.0f
    );
    if (bReloading)
    {
        ReloadRemaining -= DeltaSeconds;
        if (ActiveWeapon) ActiveWeapon->SetRelativeRotation(ActiveBaseRotation + HandlingRotation + FRotator(5.0f, -4.0f, FMath::Sin(ReloadRemaining * 7.0f) * 24.0f));
        if (ReloadRemaining <= 0.0f) FinishReload();
    }
    else
    {
        const FRotator InspectRotation = InspectRemaining > 0.0f ? FRotator(8.0f, 32.0f, -18.0f) : FRotator::ZeroRotator;
        if (ActiveWeapon) ActiveWeapon->SetRelativeRotation(FMath::RInterpTo(ActiveWeapon->GetRelativeRotation(), ActiveBaseRotation + InspectRotation + HandlingRotation, DeltaSeconds, 14.0f));
        if (bTriggerHeld && FireCooldown <= 0.0f) FireOneRound();
    }

    const FVector RightHandTarget = (bUsingSidearm ? FVector(46.0f, 21.0f, -29.0f) : FVector(49.0f, 25.0f, -29.0f)) + WeaponBob * 0.82f;
    const FVector LeftHandTarget = (bUsingSidearm ? FVector(41.0f, 8.0f, -31.0f) : FVector(59.0f, 4.0f, -27.0f)) + WeaponBob * 0.72f;
    const FVector ReloadHandOffset = bReloading ? FVector(-8.0f, -5.0f, -8.0f) : FVector::ZeroVector;
    if (RightGlove) RightGlove->SetRelativeLocation(FMath::VInterpTo(RightGlove->GetRelativeLocation(), RightHandTarget, DeltaSeconds, 18.0f));
    if (LeftGlove) LeftGlove->SetRelativeLocation(FMath::VInterpTo(LeftGlove->GetRelativeLocation(), LeftHandTarget + ReloadHandOffset, DeltaSeconds, 16.0f));
    if (RightForearm) RightForearm->SetRelativeLocation(FMath::VInterpTo(RightForearm->GetRelativeLocation(), RightHandTarget + FVector(-22.0f, 7.0f, -9.0f), DeltaSeconds, 15.0f));
    if (LeftForearm) LeftForearm->SetRelativeLocation(FMath::VInterpTo(LeftForearm->GetRelativeLocation(), LeftHandTarget + ReloadHandOffset + FVector(-25.0f, -10.0f, -11.0f), DeltaSeconds, 15.0f));

    if (SlideRemaining <= 0.0f && !bSprinting && !bAiming) RefreshMovementSpeed();

    if (TimeSinceDamage > 4.0f && Health > 0.0f && Health < 100.0f)
    {
        Health = FMath::Min(100.0f, Health + DeltaSeconds * 6.0f);
    }
}

void APhantomStrikeCharacter::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
    Super::SetupPlayerInputComponent(PlayerInputComponent);
    PlayerInputComponent->BindAxis(TEXT("MoveForward"), this, &APhantomStrikeCharacter::MoveForward);
    PlayerInputComponent->BindAxis(TEXT("MoveRight"), this, &APhantomStrikeCharacter::MoveRight);
    PlayerInputComponent->BindAxis(TEXT("Turn"), this, &APawn::AddControllerYawInput);
    PlayerInputComponent->BindAxis(TEXT("LookUp"), this, &APawn::AddControllerPitchInput);
    PlayerInputComponent->BindAction(TEXT("Fire"), IE_Pressed, this, &APhantomStrikeCharacter::StartFire);
    PlayerInputComponent->BindAction(TEXT("Fire"), IE_Released, this, &APhantomStrikeCharacter::StopFire);
    PlayerInputComponent->BindAction(TEXT("Aim"), IE_Pressed, this, &APhantomStrikeCharacter::StartAim);
    PlayerInputComponent->BindAction(TEXT("Aim"), IE_Released, this, &APhantomStrikeCharacter::StopAim);
    PlayerInputComponent->BindAction(TEXT("Reload"), IE_Pressed, this, &APhantomStrikeCharacter::BeginReload);
    PlayerInputComponent->BindAction(TEXT("Sprint"), IE_Pressed, this, &APhantomStrikeCharacter::StartSprint);
    PlayerInputComponent->BindAction(TEXT("Sprint"), IE_Released, this, &APhantomStrikeCharacter::StopSprint);

    // Classic fast-PC shooter vocabulary, kept separate from the RTS/adventure modes.
    PlayerInputComponent->BindKey(EKeys::SpaceBar, IE_Pressed, this, &APhantomStrikeCharacter::JumpOrMantle);
    PlayerInputComponent->BindKey(EKeys::LeftControl, IE_Pressed, this, &APhantomStrikeCharacter::CrouchOrSlide);
    PlayerInputComponent->BindKey(EKeys::C, IE_Pressed, this, &APhantomStrikeCharacter::CrouchOrSlide);
    PlayerInputComponent->BindKey(EKeys::Z, IE_Pressed, this, &APhantomStrikeCharacter::ToggleProne);
    PlayerInputComponent->BindKey(EKeys::E, IE_Pressed, this, &APhantomStrikeCharacter::MeleeStrike);
    PlayerInputComponent->BindKey(EKeys::F, IE_Pressed, this, &APhantomStrikeCharacter::Interact);
    PlayerInputComponent->BindKey(EKeys::G, IE_Pressed, this, &APhantomStrikeCharacter::ThrowFrag);
    PlayerInputComponent->BindKey(EKeys::Q, IE_Pressed, this, &APhantomStrikeCharacter::UseTactical);
    PlayerInputComponent->BindKey(EKeys::V, IE_Pressed, this, &APhantomStrikeCharacter::ToggleFireMode);
    PlayerInputComponent->BindKey(EKeys::B, IE_Pressed, this, &APhantomStrikeCharacter::InspectWeapon);
    PlayerInputComponent->BindKey(EKeys::M, IE_Pressed, this, &APhantomStrikeCharacter::ToggleMap);
    PlayerInputComponent->BindKey(EKeys::Tab, IE_Pressed, this, &APhantomStrikeCharacter::ShowScoreboard);
    PlayerInputComponent->BindKey(EKeys::Tab, IE_Released, this, &APhantomStrikeCharacter::HideScoreboard);
    PlayerInputComponent->BindKey(EKeys::One, IE_Pressed, this, &APhantomStrikeCharacter::EquipPrimary);
    PlayerInputComponent->BindKey(EKeys::Two, IE_Pressed, this, &APhantomStrikeCharacter::EquipSidearm);
    PlayerInputComponent->BindKey(EKeys::MouseScrollUp, IE_Pressed, this, &APhantomStrikeCharacter::SwapWeapon);
    PlayerInputComponent->BindKey(EKeys::MouseScrollDown, IE_Pressed, this, &APhantomStrikeCharacter::SwapWeapon);
}

void APhantomStrikeCharacter::MoveForward(float Value)
{
    if (!FMath::IsNearlyZero(Value)) AddMovementInput(GetActorForwardVector(), Value);
}

void APhantomStrikeCharacter::MoveRight(float Value)
{
    if (!FMath::IsNearlyZero(Value)) AddMovementInput(GetActorRightVector(), Value);
}

void APhantomStrikeCharacter::StartSprint()
{
    if (bAiming || bProne) return;
    // Classic sprint-cancel behavior: movement wins immediately instead of forcing the player
    // to wait for a reload/inspect animation before the game responds. Ammo is only committed
    // in FinishReload(), so cancelling here never duplicates or loses rounds.
    if (bReloading) { bReloading=false; ReloadRemaining=0.0f; }
    InspectRemaining = 0.0f;
    bTriggerHeld = false;
    if (bCrouchedByInput) { bCrouchedByInput=false; UnCrouch(); }
    bSprinting = true;
    RefreshMovementSpeed();
}

void APhantomStrikeCharacter::StopSprint()
{
    bSprinting = false;
    RefreshMovementSpeed();
}

void APhantomStrikeCharacter::StartFire()
{
    if (bSprinting)
    {
        bSprinting = false;
        RefreshMovementSpeed();
    }
    bTriggerHeld = !bSemiAuto && !bUsingSidearm;
    if (FireCooldown <= 0.0f && !bReloading) FireOneRound();
}

void APhantomStrikeCharacter::StopFire()
{
    bTriggerHeld = false;
}

void APhantomStrikeCharacter::StartAim()
{
    bSprinting = false;
    bAiming = true;
    RefreshMovementSpeed();
}

void APhantomStrikeCharacter::StopAim()
{
    bAiming = false;
    RefreshMovementSpeed();
}

void APhantomStrikeCharacter::FireOneRound()
{
    if (Ammo <= 0)
    {
        BeginReload();
        return;
    }
    --Ammo;
    FireCooldown = bUsingSidearm ? 0.17f : 0.085f;
    WeaponHeat = FMath::Min(1.0f, WeaponHeat + (bUsingSidearm ? 0.07f : 0.12f));
    RecoilKick = FMath::Min(1.0f, RecoilKick + (bUsingSidearm ? 0.36f : (bAiming ? 0.28f : 0.48f)));
    ShotImpulse = FMath::Min(1.0f, ShotImpulse + (bUsingSidearm ? 0.48f : 0.72f));
    MuzzleFlashRemaining = 0.055f;

    APlayerController* PlayerController = Cast<APlayerController>(GetController());
    if (!PlayerController || !GetWorld()) return;
    FVector ViewLocation;
    FRotator ViewRotation;
    PlayerController->GetPlayerViewPoint(ViewLocation, ViewRotation);
    const float SpreadDegrees = (bUsingSidearm ? (bAiming ? 0.22f : 0.82f) : (bAiming ? 0.16f : 0.72f)) + WeaponHeat * (bAiming ? 0.22f : 0.8f);
    const FVector ShotDirection = FMath::VRandCone(ViewRotation.Vector(), FMath::DegreesToRadians(SpreadDegrees));
    const FVector End = ViewLocation + ShotDirection * 20000.0f;
    FHitResult Hit;
    FCollisionQueryParams Query(SCENE_QUERY_STAT(PhantomStrikeFire), true, this);
    const bool bHit = GetWorld()->LineTraceSingleByChannel(Hit, ViewLocation, End, ECC_Visibility, Query);
    const FVector TraceEnd = bHit ? Hit.ImpactPoint : End;
    SpawnBallisticTrace(GetWorld(), ViewLocation + ShotDirection * 75.0f, TraceEnd, FLinearColor(1.0f, 0.72f, 0.30f), 0.72f, 0.024f);
    const FVector ViewRight = FRotationMatrix(ViewRotation).GetScaledAxis(EAxis::Y);
    SpawnEjectedCasing(GetWorld(), ViewLocation + ViewRotation.Vector() * 62.0f + ViewRight * 22.0f + FVector(0.0f, 0.0f, -13.0f), ViewRotation.Vector(), ViewRight);
    if (bHit)
    {
        const APhantomStrikeEnemy* Enemy = Cast<APhantomStrikeEnemy>(Hit.GetActor());
        bLastHitHeadshot = Enemy && Enemy->IsHeadComponent(Hit.GetComponent());
        const float Applied = UGameplayStatics::ApplyPointDamage(
            Hit.GetActor(),
            bUsingSidearm ? 42.0f : 31.0f,
            ShotDirection,
            Hit,
            GetController(),
            this,
            UDamageType::StaticClass()
        );
        if (Applied > 0.0f)
        {
            HitMarkerRemaining = bLastHitHeadshot ? 0.24f : 0.14f;
            Score += bLastHitHeadshot ? 15 : 5;
        }
        SpawnImpact(GetWorld(), Hit.ImpactPoint + Hit.ImpactNormal * 2.0f, bLastHitHeadshot ? FLinearColor(1.0f, 0.18f, 0.08f) : FLinearColor(1.0f, 0.68f, 0.16f));
    }
    PlayerController->AddPitchInput(-(bUsingSidearm ? 0.20f : (bAiming ? 0.13f : 0.24f)));
    PlayerController->AddYawInput(FMath::FRandRange(-0.07f, 0.07f));
    if (bUsingSidearm) bTriggerHeld=false;
}

void APhantomStrikeCharacter::EquipPrimary()
{
    if (!bUsingSidearm || bReloading) return;
    SidearmAmmo=Ammo; SidearmReserve=ReserveAmmo; Ammo=PrimaryAmmo; ReserveAmmo=PrimaryReserve; bUsingSidearm=false;
    if (RifleBody) RifleBody->SetVisibility(true); if (RifleBarrel) RifleBarrel->SetVisibility(!bUsingImportedRifle); if (RifleSight) RifleSight->SetVisibility(!bUsingImportedRifle); if (SidearmBody) SidearmBody->SetVisibility(false); bAiming=false; bTriggerHeld=false; RefreshMovementSpeed();
}
void APhantomStrikeCharacter::EquipSidearm()
{
    if (bUsingSidearm || bReloading) return;
    PrimaryAmmo=Ammo; PrimaryReserve=ReserveAmmo; Ammo=SidearmAmmo; ReserveAmmo=SidearmReserve; bUsingSidearm=true;
    if (RifleBody) RifleBody->SetVisibility(false); if (RifleBarrel) RifleBarrel->SetVisibility(false); if (RifleSight) RifleSight->SetVisibility(false); if (SidearmBody) SidearmBody->SetVisibility(true); bAiming=false; bTriggerHeld=false; RefreshMovementSpeed();
}
void APhantomStrikeCharacter::SwapWeapon() { if (bUsingSidearm) EquipPrimary(); else EquipSidearm(); }

void APhantomStrikeCharacter::MeleeStrike()
{
    if (MeleeRemaining > 0.0f || bReloading || !GetWorld()) return;
    MeleeRemaining = 0.52f;
    bTriggerHeld = false;
    APlayerController* PlayerController = Cast<APlayerController>(GetController());
    if (!PlayerController) return;
    FVector ViewLocation;
    FRotator ViewRotation;
    PlayerController->GetPlayerViewPoint(ViewLocation, ViewRotation);
    const FVector End = ViewLocation + ViewRotation.Vector() * 190.0f;
    FHitResult Hit;
    FCollisionQueryParams Query(SCENE_QUERY_STAT(PhantomStrikeMelee), true, this);
    if (GetWorld()->LineTraceSingleByChannel(Hit, ViewLocation, End, ECC_Visibility, Query) && Hit.GetActor())
    {
        const float Applied = UGameplayStatics::ApplyPointDamage(Hit.GetActor(), 115.0f, ViewRotation.Vector(), Hit, GetController(), this, UDamageType::StaticClass());
        if (Applied > 0.0f)
        {
            HitMarkerRemaining = 0.2f;
            SpawnImpact(GetWorld(), Hit.ImpactPoint + Hit.ImpactNormal * 2.0f, FLinearColor(1.0f, 0.76f, 0.18f));
        }
    }
    RecoilKick = FMath::Max(RecoilKick, 0.38f);
}

void APhantomStrikeCharacter::ThrowFrag()
{
    if (Grenades <= 0 || GrenadeRemaining > 0.0f || bReloading || !GetWorld()) return;
    --Grenades;
    GrenadeRemaining = 1.0f;
    APlayerController* PlayerController = Cast<APlayerController>(GetController());
    if (!PlayerController) return;
    FVector ViewLocation;
    FRotator ViewRotation;
    PlayerController->GetPlayerViewPoint(ViewLocation, ViewRotation);
    const FVector BlastCenter = ViewLocation + ViewRotation.Vector() * 760.0f - FVector(0.0f, 0.0f, 35.0f);
    SpawnBallisticTrace(GetWorld(), ViewLocation + ViewRotation.Vector() * 60.0f, BlastCenter, FLinearColor(0.95f, 0.72f, 0.18f), 4.5f, 0.11f);
    for (int32 Burst = 0; Burst < 5; ++Burst)
    {
        const FVector Offset = FMath::VRand() * FMath::FRandRange(20.0f, 115.0f);
        SpawnImpact(GetWorld(), BlastCenter + Offset, Burst % 2 == 0 ? FLinearColor(1.0f, 0.28f, 0.04f) : FLinearColor(1.0f, 0.78f, 0.16f));
    }
    for (TActorIterator<APhantomStrikeEnemy> It(GetWorld()); It; ++It)
    {
        const float Distance = FVector::Dist(It->GetActorLocation(), BlastCenter);
        if (Distance > 500.0f) continue;
        const float Falloff = 1.0f - FMath::Clamp(Distance / 500.0f, 0.0f, 1.0f);
        UGameplayStatics::ApplyDamage(*It, 45.0f + 105.0f * Falloff, GetController(), this, UDamageType::StaticClass());
    }
}

void APhantomStrikeCharacter::Slide()
{
    if (SlideRemaining > 0.0f || GetVelocity().Size2D() < 220.0f) return;
    bSprinting = false;
    SlideRemaining = 0.68f;
    bCrouchedByInput = true; Crouch();
    GetCharacterMovement()->MaxWalkSpeed = 540.0f;
    LaunchCharacter(GetActorForwardVector() * 430.0f + FVector(0.0f, 0.0f, 12.0f), true, false);
}


void APhantomStrikeCharacter::RefreshMovementSpeed()
{
    float Speed = 470.0f;
    if (bProne) Speed = 115.0f;
    else if (bCrouchedByInput) Speed = 240.0f;
    else if (bSprinting) Speed = 670.0f;
    if (bAiming) Speed *= bUsingSidearm ? 0.78f : 0.70f;
    GetCharacterMovement()->MaxWalkSpeed = Speed;
}

void APhantomStrikeCharacter::CrouchOrSlide()
{
    if (bProne)
    {
        bProne=false; bCrouchedByInput=true; Crouch(); RefreshMovementSpeed(); return;
    }
    if (bSprinting && GetVelocity().Size2D() > 380.0f) { Slide(); return; }
    bCrouchedByInput=!bCrouchedByInput;
    if (bCrouchedByInput) Crouch(); else UnCrouch();
    RefreshMovementSpeed();
}

void APhantomStrikeCharacter::ToggleProne()
{
    if (SlideRemaining>0.0f) return;
    bSprinting=false;
    bProne=!bProne;
    bCrouchedByInput=bProne;
    if (bProne) Crouch(); else UnCrouch();
    RefreshMovementSpeed();
}

void APhantomStrikeCharacter::JumpOrMantle()
{
    if (bProne) { bProne=false; bCrouchedByInput=false; UnCrouch(); RefreshMovementSpeed(); return; }
    if (!GetWorld()) { Jump(); return; }
    const FVector Start=GetActorLocation()+FVector(0,0,55);
    const FVector Forward=GetActorForwardVector();
    FCollisionQueryParams Params(SCENE_QUERY_STAT(StrikeMantle),false,this);
    FHitResult LowHit;
    if (GetWorld()->LineTraceSingleByChannel(LowHit,Start,Start+Forward*105.0f,ECC_Visibility,Params))
    {
        FHitResult HighHit;
        const FVector HighStart=Start+FVector(0,0,115);
        if (!GetWorld()->LineTraceSingleByChannel(HighHit,HighStart,HighStart+Forward*105.0f,ECC_Visibility,Params))
        {
            LaunchCharacter(Forward*310.0f+FVector(0,0,420.0f),true,true);
            return;
        }
    }
    Jump();
}

void APhantomStrikeCharacter::Interact()
{
    if (APhantomStrikeDirector* Director = StrikeDirector(this)) Director->TryActivateUplink(this);
    APlayerController* PC=Cast<APlayerController>(GetController()); if(!PC||!GetWorld()) return;
    FVector L; FRotator R; PC->GetPlayerViewPoint(L,R);
    FHitResult Hit; FCollisionQueryParams Params(SCENE_QUERY_STAT(StrikeInteract),true,this);
    if(GetWorld()->LineTraceSingleByChannel(Hit,L,L+R.Vector()*180.0f,ECC_Visibility,Params) && Hit.GetActor())
    {
        // Prototype interaction grammar: movable props receive a physical nudge; mission objects remain available to director logic.
        if(UPrimitiveComponent* Prim=Cast<UPrimitiveComponent>(Hit.GetComponent())) if(Prim->IsSimulatingPhysics()) Prim->AddImpulseAtLocation(R.Vector()*4200.0f,Hit.ImpactPoint);
    }
}

void APhantomStrikeCharacter::UseTactical()
{
    if(Tacticals<=0||TacticalRemaining>0.0f||!GetWorld()) return;
    --Tacticals; TacticalRemaining=1.25f;
    APlayerController* PC=Cast<APlayerController>(GetController()); if(!PC) return;
    FVector L; FRotator R; PC->GetPlayerViewPoint(L,R);
    const FVector Center=L+R.Vector()*650.0f;
    for(int32 I=0;I<9;++I) SpawnImpact(GetWorld(),Center+FMath::VRand()*FMath::FRandRange(25.0f,180.0f),FLinearColor(0.55f,0.78f,1.0f));
}

void APhantomStrikeCharacter::ToggleFireMode()
{
    if(bUsingSidearm) return;
    bSemiAuto=!bSemiAuto; bTriggerHeld=false;
}

void APhantomStrikeCharacter::InspectWeapon(){ if(!bReloading&&!bSprinting) InspectRemaining=1.4f; }
void APhantomStrikeCharacter::ShowScoreboard(){ bScoreboardVisible=true; }
void APhantomStrikeCharacter::HideScoreboard(){ bScoreboardVisible=false; }
void APhantomStrikeCharacter::ToggleMap(){ bMapVisible=!bMapVisible; }

void APhantomStrikeCharacter::BeginReload()
{
    if (bReloading || Ammo >= CurrentMagazineSize() || ReserveAmmo <= 0) return;
    bTriggerHeld = false;
    bSprinting = false;
    InspectRemaining = 0.0f;
    RefreshMovementSpeed();
    bReloading = true;
    ReloadRemaining = bUsingSidearm ? 1.05f : StrikeReloadDuration;
}

void APhantomStrikeCharacter::FinishReload()
{
    const int32 Needed = CurrentMagazineSize() - Ammo;
    const int32 Loaded = FMath::Min(Needed, ReserveAmmo);
    Ammo += Loaded;
    ReserveAmmo -= Loaded;
    bReloading = false;
    ReloadRemaining = 0.0f;
}

float APhantomStrikeCharacter::GetReloadProgress() const
{
    const float Duration=bUsingSidearm?1.05f:StrikeReloadDuration;
    return bReloading ? 1.0f - FMath::Clamp(ReloadRemaining / Duration, 0.0f, 1.0f) : 0.0f;
}

void APhantomStrikeCharacter::RegisterKill(int32 Points, bool bHeadshot)
{
    ++Kills;
    ++CurrentStreak;
    BestStreak = FMath::Max(BestStreak, CurrentStreak);
    Score += Points + (bHeadshot ? 75 : 0);
    bLastHitHeadshot = bHeadshot;
    HitMarkerRemaining = 0.3f;
    // Lightweight classic killstreak rewards: momentum without turning the match into an ability spammer.
    if (CurrentStreak == 3) ReserveAmmo = FMath::Min(288, ReserveAmmo + 64);
    if (CurrentStreak == 5) Armor = FMath::Min(75.0f, Armor + 25.0f);
    if (CurrentStreak == 7) { Grenades = FMath::Min(4, Grenades + 2); Health = 100.0f; }
}

float APhantomStrikeCharacter::TakeDamage(
    float DamageAmount,
    FDamageEvent const& DamageEvent,
    AController* EventInstigator,
    AActor* DamageCauser
)
{
    const float Applied = Super::TakeDamage(DamageAmount, DamageEvent, EventInstigator, DamageCauser);
    const float ArmorAbsorption = FMath::Min(Armor, Applied * 0.58f);
    Armor -= ArmorAbsorption;
    Health = FMath::Max(0.0f, Health - Applied + ArmorAbsorption);
    DamageFlash = FMath::Clamp(DamageFlash + Applied / 45.0f, 0.0f, 1.0f);
    TimeSinceDamage = 0.0f;
    if (Health <= 0.0f)
    {
        ++Deaths;
        CurrentStreak = 0;
        Health = 100.0f;
        Armor = 50.0f;
        PrimaryAmmo=32; PrimaryReserve=FMath::Max(PrimaryReserve,96); SidearmAmmo=15; SidearmReserve=FMath::Max(SidearmReserve,45);
        Ammo = bUsingSidearm ? SidearmAmmo : PrimaryAmmo; ReserveAmmo=bUsingSidearm ? SidearmReserve : PrimaryReserve;
        Grenades = FMath::Max(2, Grenades);
        bTriggerHeld=false; bAiming=false; bSprinting=false; bReloading=false; bProne=false;
        ReloadRemaining=0.0f; SlideRemaining=0.0f; InspectRemaining=0.0f; RecoilKick=0.0f; WeaponHeat=0.0f;
        if (bCrouchedByInput) UnCrouch();
        bCrouchedByInput=false;
        GetCharacterMovement()->StopMovementImmediately();
        RefreshMovementSpeed();
        SetActorLocation(FVector(-9000.0f, 0.0f, 260.0f), false, nullptr, ETeleportType::TeleportPhysics);
        if (AController* C=GetController()) C->SetControlRotation(FRotator(-12.0f,0.0f,0.0f));
    }
    return Applied;
}

APhantomStrikeEnemy::APhantomStrikeEnemy()
{
    PrimaryActorTick.bCanEverTick = true;
    AutoPossessAI = EAutoPossessAI::PlacedInWorldOrSpawned;
    GetCapsuleComponent()->SetCollisionResponseToChannel(ECC_Visibility, ECR_Ignore);
    UStaticMesh* Cylinder = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
    UStaticMesh* Sphere = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Sphere.Sphere"));
    UStaticMesh* Cube = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cube.Cube"));

    BodyMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Body"));
    BodyMesh->SetupAttachment(GetCapsuleComponent());
    BodyMesh->SetStaticMesh(Cylinder);
    BodyMesh->SetRelativeScale3D(FVector(0.46f, 0.46f, 0.72f));
    BodyMesh->SetRelativeLocation(FVector(0.0f, 0.0f, -20.0f));
    BodyMesh->SetCollisionEnabled(ECollisionEnabled::QueryOnly);
    BodyMesh->SetCollisionResponseToAllChannels(ECR_Ignore);
    BodyMesh->SetCollisionResponseToChannel(ECC_Visibility, ECR_Block);

    HeadMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Head"));
    HeadMesh->SetupAttachment(GetCapsuleComponent());
    HeadMesh->SetStaticMesh(Sphere);
    HeadMesh->SetRelativeLocation(FVector(0.0f, 0.0f, 55.0f));
    HeadMesh->SetRelativeScale3D(FVector(0.34f));
    HeadMesh->SetCollisionEnabled(ECollisionEnabled::QueryOnly);
    HeadMesh->SetCollisionResponseToAllChannels(ECR_Ignore);
    HeadMesh->SetCollisionResponseToChannel(ECC_Visibility, ECR_Block);

    ArmorMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Armor"));
    ArmorMesh->SetupAttachment(BodyMesh);
    ArmorMesh->SetStaticMesh(Cube);
    ArmorMesh->SetRelativeLocation(FVector(0.0f, 0.0f, 8.0f));
    ArmorMesh->SetRelativeScale3D(FVector(0.88f, 1.18f, 0.42f));
    ArmorMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);

    WeaponMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Weapon"));
    WeaponMesh->SetupAttachment(BodyMesh);
    UStaticMesh* EnemyRifle = LoadObject<UStaticMesh>(nullptr, TEXT("/Game/Weapons/Rifle/Meshes/SM_Rifle.SM_Rifle"));
    WeaponMesh->SetStaticMesh(EnemyRifle ? EnemyRifle : Cube);
    WeaponMesh->SetRelativeLocation(FVector(45.0f, 26.0f, 8.0f));
    WeaponMesh->SetRelativeScale3D(FVector(0.68f, 0.12f, 0.12f));
    WeaponMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);

    VisualModel = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("EnemyAuthoredVisual"));
    VisualModel->SetupAttachment(GetCapsuleComponent());
    VisualModel->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    VisualModel->SetVisibility(false);

    MuzzleLight = CreateDefaultSubobject<UPointLightComponent>(TEXT("HostileMuzzleFlash"));
    MuzzleLight->SetupAttachment(WeaponMesh);
    MuzzleLight->SetRelativeLocation(FVector(72.0f, 0.0f, 0.0f));
    MuzzleLight->SetIntensity(0.0f);
    MuzzleLight->SetAttenuationRadius(280.0f);
    MuzzleLight->SetLightColor(FLinearColor(1.0f, 0.46f, 0.12f));
    MuzzleLight->SetCastShadows(false);
    GetCharacterMovement()->MaxWalkSpeed = 410.0f;
    GetCharacterMovement()->MaxAcceleration = 2200.0f;
}

void APhantomStrikeEnemy::Configure(EPhantomStrikeEnemyRole NewRole, int32 NewTier)
{
    Role = NewRole;
    Tier = FMath::Max(1, NewTier);
    const FLinearColor HostileRed(0.31f, 0.055f, 0.045f);

    // The Shooter template skeletal rig is the V27 production silhouette. Primitive and
    // generated-static bodies remain collision-safe fallbacks, but are never visible when
    // the realistic rig loads.
    USkeletalMesh* OperatorMesh = LoadObject<USkeletalMesh>(nullptr, TEXT("/Game/Characters/Mannequins/Meshes/SKM_Manny_Simple.SKM_Manny_Simple"));
    if (OperatorMesh)
    {
        GetMesh()->SetSkeletalMeshAsset(OperatorMesh);
        GetMesh()->SetRelativeLocation(FVector(0.0f, 0.0f, -96.0f));
        GetMesh()->SetRelativeRotation(FRotator(0.0f, -90.0f, 0.0f));
        GetMesh()->SetCollisionEnabled(ECollisionEnabled::NoCollision);
        GetMesh()->SetVisibility(true, true);
        GetMesh()->SetCastShadow(true);
        if (UClass* OperatorAnimClass = LoadClass<UAnimInstance>(nullptr, TEXT("/Game/Variant_Shooter/Anims/ABP_TP_Rifle.ABP_TP_Rifle_C")))
        {
            GetMesh()->SetAnimationMode(EAnimationMode::AnimationBlueprint);
            GetMesh()->SetAnimInstanceClass(OperatorAnimClass);
        }
        if (UMaterialInterface* DarkOperatorMaterial = LoadObject<UMaterialInterface>(nullptr, TEXT("/Game/Characters/Mannequins/Materials/Manny/MI_Manny_02_New.MI_Manny_02_New")))
        {
            GetMesh()->SetMaterial(0, DarkOperatorMaterial);
            GetMesh()->SetMaterial(1, DarkOperatorMaterial);
        }
        WeaponMesh->AttachToComponent(GetMesh(), FAttachmentTransformRules::SnapToTargetNotIncludingScale, TEXT("weapon_r"));
        WeaponMesh->SetRelativeLocation(FVector::ZeroVector);
        WeaponMesh->SetRelativeRotation(FRotator::ZeroRotator);
        WeaponMesh->SetRelativeScale3D(FVector(1.0f));
        WeaponMesh->SetVisibility(true);
        VisualRestLocation = GetMesh()->GetRelativeLocation();
        bUsingRealisticRig = true;
    }
    else
    {
        GetMesh()->SetVisibility(false, true);
    }

    const TCHAR* ExternalCharacter = Role == EPhantomStrikeEnemyRole::Marksman
        ? TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Strike_Marksman.SM_CC0_Strike_Marksman")
        : (Role == EPhantomStrikeEnemyRole::Heavy
            ? TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Strike_Heavy.SM_CC0_Strike_Heavy")
            : (Role == EPhantomStrikeEnemyRole::Rusher
                ? TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Strike_Rusher.SM_CC0_Strike_Rusher")
                : TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Strike_Rifleman.SM_CC0_Strike_Rifleman")));
    const TCHAR* GeneratedCharacter = Role == EPhantomStrikeEnemyRole::Rusher
        ? TEXT("/Game/Phantom/Generated/Strike/Characters/SM_HelixRusher.SM_HelixRusher")
        : (Role == EPhantomStrikeEnemyRole::Heavy
            ? TEXT("/Game/Phantom/Generated/Strike/Characters/SM_HelixHeavy.SM_HelixHeavy")
            : (Role == EPhantomStrikeEnemyRole::Marksman
                ? TEXT("/Game/Phantom/Generated/Strike/Characters/SM_HelixMarksman.SM_HelixMarksman")
                : TEXT("/Game/Phantom/Generated/Strike/Characters/SM_HelixRifleman.SM_HelixRifleman")));
    UStaticMesh* AuthoredCharacter = bUsingRealisticRig ? nullptr : LoadObject<UStaticMesh>(nullptr, GeneratedCharacter);
    if (!AuthoredCharacter && !bUsingRealisticRig) AuthoredCharacter = LoadObject<UStaticMesh>(nullptr, ExternalCharacter);
    if (AuthoredCharacter && !bUsingRealisticRig)
    {
        VisualModel->SetStaticMesh(AuthoredCharacter);
        const FBoxSphereBounds VisualBounds = AuthoredCharacter->GetBounds();
        const float RawHeight = FMath::Max(1.0f, VisualBounds.BoxExtent.Z * 2.0f);
        const float TargetHeight = Role == EPhantomStrikeEnemyRole::Heavy ? 220.0f : 185.0f;
        const float FitScale = FMath::Clamp(TargetHeight / RawHeight, 0.025f, 60.0f);
        const float LocalBottom = (VisualBounds.Origin.Z - VisualBounds.BoxExtent.Z) * FitScale;
        VisualModel->SetRelativeLocation(FVector(0.0f, 0.0f, -GetCapsuleComponent()->GetUnscaledCapsuleHalfHeight() - LocalBottom));
        VisualRestLocation = VisualModel->GetRelativeLocation();
        VisualModel->SetRelativeScale3D(FVector(FitScale));
        VisualModel->SetRelativeRotation(FRotator::ZeroRotator);
        VisualModel->SetVisibility(true);
        BodyMesh->SetVisibility(false);
        ArmorMesh->SetVisibility(false);
        // The invisible head primitive remains a dedicated headshot trace target.
        HeadMesh->SetVisibility(false);
        WeaponMesh->SetVisibility(false);
    }
    if (bUsingRealisticRig)
    {
        VisualModel->SetVisibility(false);
        BodyMesh->SetVisibility(false);
        ArmorMesh->SetVisibility(false);
        // Invisible sphere is retained solely as the dedicated headshot trace target.
        HeadMesh->SetVisibility(false);
    }
    const FLinearColor HostileAmber(0.48f, 0.22f, 0.055f);
    ApplyShapeColor(HeadMesh, FLinearColor(0.08f, 0.02f, 0.025f));
    if (!bUsingRealisticRig) ApplyShapeColor(WeaponMesh, HostileRed);
    if (Role == EPhantomStrikeEnemyRole::Rusher)
    {
        Health = 68.0f + Tier * 7.0f;
        Damage = 13.0f + Tier;
        AttackInterval = 0.48f;
        PreferredRange = 125.0f;
        GetCharacterMovement()->MaxWalkSpeed = 610.0f;
        BodyMesh->SetRelativeScale3D(FVector(0.4f, 0.4f, 0.66f));
        ApplyShapeColor(BodyMesh, FLinearColor(0.12f, 0.095f, 0.075f));
        ApplyShapeColor(ArmorMesh, HostileRed);
    }
    else if (Role == EPhantomStrikeEnemyRole::Marksman)
    {
        Health = 82.0f + Tier * 8.0f;
        Damage = 24.0f + Tier * 1.5f;
        AttackInterval = 1.35f;
        PreferredRange = 1450.0f;
        GetCharacterMovement()->MaxWalkSpeed = 335.0f;
        BodyMesh->SetRelativeScale3D(FVector(0.43f, 0.43f, 0.72f));
        ApplyShapeColor(BodyMesh, FLinearColor(0.07f, 0.085f, 0.065f));
        ApplyShapeColor(ArmorMesh, FLinearColor(0.16f, 0.18f, 0.14f));
        if (!bUsingRealisticRig) ApplyShapeColor(WeaponMesh, FLinearColor(0.045f, 0.05f, 0.045f));
    }
    else if (Role == EPhantomStrikeEnemyRole::Heavy)
    {
        Health = 190.0f + Tier * 18.0f;
        Damage = 15.0f + Tier * 1.5f;
        AttackInterval = 0.95f;
        PreferredRange = 720.0f;
        GetCharacterMovement()->MaxWalkSpeed = 265.0f;
        BodyMesh->SetRelativeScale3D(FVector(0.62f, 0.62f, 0.86f));
        ArmorMesh->SetRelativeScale3D(FVector(1.05f, 1.3f, 0.55f));
        ApplyShapeColor(BodyMesh, FLinearColor(0.10f, 0.09f, 0.065f));
        ApplyShapeColor(ArmorMesh, HostileAmber);
    }
    else
    {
        Health = 98.0f + Tier * 10.0f;
        Damage = 8.0f + Tier;
        AttackInterval = 0.72f;
        PreferredRange = 980.0f;
        GetCharacterMovement()->MaxWalkSpeed = 390.0f;
        ApplyShapeColor(BodyMesh, FLinearColor(0.085f, 0.095f, 0.072f));
        ApplyShapeColor(ArmorMesh, HostileRed);
    }
    AttackCooldown = FMath::FRandRange(0.15f, AttackInterval);
    StrafeDirection = FMath::RandBool() ? 1.0f : -1.0f;
    DecisionRemaining = FMath::FRandRange(0.35f, 1.1f);
    ExposureRemaining = FMath::FRandRange(0.7f, 1.8f);
    FlankWeight = FMath::FRandRange(-1.0f, 1.0f);
}

bool APhantomStrikeEnemy::IsHeadComponent(const UPrimitiveComponent* Component) const
{
    return Component == HeadMesh;
}

bool APhantomStrikeEnemy::HasLineOfSightTo(AActor* Target) const
{
    if (!Target || !GetWorld()) return false;
    FHitResult Hit;
    FCollisionQueryParams Query(SCENE_QUERY_STAT(PhantomStrikeEnemySight), true, this);
    const FVector Start = GetActorLocation() + FVector(0.0f, 0.0f, 52.0f);
    const FVector End = Target->GetActorLocation() + FVector(0.0f, 0.0f, 45.0f);
    return GetWorld()->LineTraceSingleByChannel(Hit, Start, End, ECC_Visibility, Query) && Hit.GetActor() == Target;
}

void APhantomStrikeEnemy::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    PresentationTime += DeltaSeconds;
    RecoilRemaining = FMath::Max(0.0f, RecoilRemaining - DeltaSeconds);
    HitReactionRemaining = FMath::Max(0.0f, HitReactionRemaining - DeltaSeconds);
    if (bDying)
    {
        DeathRemaining = FMath::Max(0.0f, DeathRemaining - DeltaSeconds);
        const float CollapseAlpha = 1.0f - FMath::Clamp(DeathRemaining / 0.72f, 0.0f, 1.0f);
        if (bUsingRealisticRig && GetMesh())
        {
            GetMesh()->SetRelativeRotation(FMath::RInterpTo(GetMesh()->GetRelativeRotation(), FRotator(-8.0f, -90.0f, 82.0f), DeltaSeconds, 4.8f));
            GetMesh()->SetRelativeLocation(FMath::VInterpTo(GetMesh()->GetRelativeLocation(), VisualRestLocation + FVector(0.0f, 0.0f, -62.0f * CollapseAlpha), DeltaSeconds, 6.0f));
        }
        else if (VisualModel)
        {
            VisualModel->SetRelativeRotation(FMath::RInterpTo(VisualModel->GetRelativeRotation(), FRotator(-8.0f, 0.0f, 82.0f), DeltaSeconds, 4.8f));
            VisualModel->SetRelativeLocation(FMath::VInterpTo(VisualModel->GetRelativeLocation(), VisualRestLocation + FVector(0.0f, 0.0f, -62.0f * CollapseAlpha), DeltaSeconds, 6.0f));
        }
        return;
    }
    AttackCooldown = FMath::Max(0.0f, AttackCooldown - DeltaSeconds);
    DecisionRemaining = FMath::Max(0.0f, DecisionRemaining - DeltaSeconds);
    ExposureRemaining = FMath::Max(0.0f, ExposureRemaining - DeltaSeconds);
    MuzzleFlashRemaining = FMath::Max(0.0f, MuzzleFlashRemaining - DeltaSeconds);
    MuzzleLight->SetIntensity(MuzzleFlashRemaining > 0.0f ? 6500.0f : 0.0f);
    ACharacter* Player = UGameplayStatics::GetPlayerCharacter(this, 0);
    if (!Player) return;
    const FVector Offset = Player->GetActorLocation() - GetActorLocation();
    const float Distance = Offset.Size2D();
    const FVector Direction = Offset.GetSafeNormal2D();
    const FVector Lateral = FVector::CrossProduct(FVector::UpVector, Direction).GetSafeNormal2D();
    const bool bHasLineOfSight = HasLineOfSightTo(Player);
    if (DecisionRemaining <= 0.0f)
    {
        DecisionRemaining = FMath::FRandRange(0.65f, 1.45f);
        if (FMath::FRand() < 0.38f) StrafeDirection *= -1.0f;
        FlankWeight = FMath::FRandRange(-1.0f, 1.0f);
        ExposureRemaining = FMath::FRandRange(0.55f, 1.65f);
    }
    SetActorRotation(FMath::RInterpTo(GetActorRotation(), Direction.Rotation(), DeltaSeconds, bHasLineOfSight ? 10.0f : 6.0f));

    if (VisualModel && VisualModel->IsVisible())
    {
        const float SpeedAlpha = FMath::Clamp(GetVelocity().Size2D() / FMath::Max(1.0f, GetCharacterMovement()->MaxWalkSpeed), 0.0f, 1.0f);
        const float Step = FMath::Sin(PresentationTime * FMath::Lerp(3.4f, 8.6f, SpeedAlpha));
        const float RecoilAlpha = FMath::Clamp(RecoilRemaining / 0.10f, 0.0f, 1.0f);
        const float HitAlpha = FMath::Clamp(HitReactionRemaining / 0.16f, 0.0f, 1.0f);
        VisualModel->SetRelativeLocation(VisualRestLocation + FVector(0.0f, 0.0f, FMath::Abs(Step) * SpeedAlpha * 2.2f - RecoilAlpha * 1.8f));
        VisualModel->SetRelativeRotation(FRotator(-RecoilAlpha * 2.8f + HitAlpha * 5.0f, 0.0f, Step * SpeedAlpha * 2.4f + StrafeDirection * 1.2f));
    }

    if (Role == EPhantomStrikeEnemyRole::Rusher)
    {
        if (Distance > PreferredRange) AddMovementInput((Direction + Lateral * FlankWeight * 0.32f).GetSafeNormal(), 1.0f);
    }
    else
    {
        // Riflemen and marksmen alternate exposure with lateral repositioning instead of
        // marching directly at the player. Heavies keep pressure while leaving flank space.
        const float RoleFlank = Role == EPhantomStrikeEnemyRole::Marksman ? 0.82f : (Role == EPhantomStrikeEnemyRole::Heavy ? 0.24f : 0.58f);
        if (!bHasLineOfSight) AddMovementInput((Direction + Lateral * FlankWeight * RoleFlank).GetSafeNormal(), 0.92f);
        else if (Distance > PreferredRange * 1.2f) AddMovementInput((Direction + Lateral * FlankWeight * 0.28f).GetSafeNormal(), 0.85f);
        else if (Distance < PreferredRange * 0.58f) AddMovementInput(-Direction, 0.68f);
        else if (ExposureRemaining <= 0.34f) AddMovementInput(-Direction + Lateral * StrafeDirection * 0.5f, 0.72f);
        else AddMovementInput(Lateral * StrafeDirection, Role == EPhantomStrikeEnemyRole::Marksman ? 0.68f : 0.52f);
    }

    const bool bInAttackRange = Role == EPhantomStrikeEnemyRole::Rusher ? Distance < 165.0f : Distance < PreferredRange * 1.45f;
    if (bInAttackRange && AttackCooldown <= 0.0f && bHasLineOfSight)
    {
        const float RangePenalty = FMath::Clamp(Distance / FMath::Max(PreferredRange, 1.0f), 0.0f, 1.5f);
        const float BaseAccuracy = Role == EPhantomStrikeEnemyRole::Marksman ? 0.78f : (Role == EPhantomStrikeEnemyRole::Rusher ? 0.82f : (Role == EPhantomStrikeEnemyRole::Heavy ? 0.58f : 0.68f));
        const bool bHitPlayer = FMath::FRand() < FMath::Clamp(BaseAccuracy - RangePenalty * 0.16f, 0.35f, 0.9f);
        const FVector Muzzle = GetActorLocation() + GetActorForwardVector() * 90.0f + FVector(0.0f, 0.0f, 62.0f);
        FVector TargetPoint = Player->GetActorLocation() + FVector(0.0f, 0.0f, 48.0f);
        if (!bHitPlayer) TargetPoint += FVector(FMath::FRandRange(-115.0f, 115.0f), FMath::FRandRange(-115.0f, 115.0f), FMath::FRandRange(-55.0f, 95.0f));
        else UGameplayStatics::ApplyDamage(Player, Damage, GetController(), this, UDamageType::StaticClass());
        SpawnBallisticTrace(GetWorld(), Muzzle, TargetPoint, Role == EPhantomStrikeEnemyRole::Marksman ? FLinearColor(1.0f, 0.56f, 0.18f) : FLinearColor(1.0f, 0.36f, 0.10f), 0.82f, 0.035f);
        MuzzleFlashRemaining = 0.06f;
        RecoilRemaining = 0.10f;
        AttackCooldown = AttackInterval;
        if (FMath::FRand() < 0.18f) StrafeDirection *= -1.0f;
    }
}

float APhantomStrikeEnemy::TakeDamage(
    float DamageAmount,
    FDamageEvent const& DamageEvent,
    AController* EventInstigator,
    AActor* DamageCauser
)
{
    if (bDying) return 0.0f;
    bool bHeadshot = false;
    if (DamageEvent.IsOfType(FPointDamageEvent::ClassID))
    {
        const FPointDamageEvent& PointDamage = static_cast<const FPointDamageEvent&>(DamageEvent);
        bHeadshot = PointDamage.HitInfo.GetComponent() == HeadMesh;
    }
    const float Applied = Super::TakeDamage(
        bHeadshot ? DamageAmount * 2.35f : DamageAmount,
        DamageEvent,
        EventInstigator,
        DamageCauser
    );
    Health = FMath::Max(0.0f, Health - Applied);
    HitReactionRemaining = 0.16f;
    if (Health <= 0.0f)
    {
        if (APhantomStrikeCharacter* Player = Cast<APhantomStrikeCharacter>(DamageCauser))
        {
            const int32 Value = Role == EPhantomStrikeEnemyRole::Heavy ? 250 : (Role == EPhantomStrikeEnemyRole::Rusher ? 125 : 175);
            Player->RegisterKill(Value, bHeadshot);
        }
        if (APhantomStrikeDirector* Director = StrikeDirector(this)) Director->RegisterEnemyDown();
        bDying = true;
        DeathRemaining = 0.72f;
        GetCharacterMovement()->StopMovementImmediately();
        GetCharacterMovement()->DisableMovement();
        GetCapsuleComponent()->SetCollisionEnabled(ECollisionEnabled::NoCollision);
        BodyMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
        HeadMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
        if (bUsingRealisticRig && GetMesh()) GetMesh()->SetComponentTickEnabled(false);
        SetLifeSpan(3.0f);
    }
    return Applied;
}

APhantomStrikeSquadmate::APhantomStrikeSquadmate()
{
    PrimaryActorTick.bCanEverTick = true;
    AutoPossessAI = EAutoPossessAI::PlacedInWorldOrSpawned;
    GetCapsuleComponent()->SetCollisionResponseToChannel(ECC_Pawn, ECR_Ignore);
    GetCharacterMovement()->bRunPhysicsWithNoController = true;
    GetCharacterMovement()->MaxWalkSpeed = 520.0f;
    GetCharacterMovement()->MaxAcceleration = 2800.0f;

    // Use the alternate Quinn proportions for squadmates so the team reads as people,
    // not repeated copies of one generated statue.
    if (USkeletalMesh* SquadBody = LoadObject<USkeletalMesh>(nullptr, TEXT("/Game/Characters/Mannequins/Meshes/SKM_Quinn_Simple.SKM_Quinn_Simple")))
    {
        GetMesh()->SetSkeletalMeshAsset(SquadBody);
        GetMesh()->SetRelativeLocation(FVector(0.0f, 0.0f, -96.0f));
        GetMesh()->SetRelativeRotation(FRotator(0.0f, -90.0f, 0.0f));
        GetMesh()->SetCollisionEnabled(ECollisionEnabled::NoCollision);
        GetMesh()->SetVisibility(true, true);
        GetMesh()->SetCastShadow(true);
        if (UClass* SquadAnimClass = LoadClass<UAnimInstance>(nullptr, TEXT("/Game/Variant_Shooter/Anims/ABP_TP_Rifle.ABP_TP_Rifle_C")))
        {
            GetMesh()->SetAnimationMode(EAnimationMode::AnimationBlueprint);
            GetMesh()->SetAnimInstanceClass(SquadAnimClass);
        }
        if (UMaterialInterface* SquadMaterial = LoadObject<UMaterialInterface>(nullptr, TEXT("/Game/Characters/Mannequins/Materials/Quinn/MI_Quinn_02.MI_Quinn_02")))
        {
            GetMesh()->SetMaterial(0, SquadMaterial);
            GetMesh()->SetMaterial(1, SquadMaterial);
        }
        VisualRestLocation = GetMesh()->GetRelativeLocation();
        bUsingRealisticRig = true;
    }
    else
    {
        GetMesh()->SetVisibility(false, true);
    }

    VisualModel = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("NightglassSquadVisual"));
    VisualModel->SetupAttachment(GetCapsuleComponent());
    // The checked-in Helix operator is the authoritative modern-military squad silhouette.
    // The old alias could resolve to a shared fantasy body and is fallback-only.
    UStaticMesh* SquadMesh = LoadObject<UStaticMesh>(nullptr, TEXT("/Game/Phantom/Generated/Strike/Characters/SM_HelixRifleman.SM_HelixRifleman"));
    if (!SquadMesh) SquadMesh = LoadObject<UStaticMesh>(nullptr, TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Strike_Rifleman.SM_CC0_Strike_Rifleman"));
    VisualModel->SetStaticMesh(SquadMesh);
    VisualModel->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    VisualModel->SetVisibility(!bUsingRealisticRig);

    WeaponModel = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("NightglassSquadWeapon"));
    USceneComponent* WeaponParent = bUsingRealisticRig
        ? static_cast<USceneComponent*>(GetMesh())
        : static_cast<USceneComponent*>(VisualModel);
    WeaponModel->SetupAttachment(WeaponParent, bUsingRealisticRig ? FName(TEXT("weapon_r")) : NAME_None);
    UStaticMesh* SquadRifle = LoadObject<UStaticMesh>(nullptr, TEXT("/Game/Weapons/Rifle/Meshes/SM_Rifle.SM_Rifle"));
    if (!SquadRifle) SquadRifle = LoadObject<UStaticMesh>(nullptr, TEXT("/Game/Phantom/Strike/AssaultRifle.AssaultRifle"));
    WeaponModel->SetStaticMesh(SquadRifle);
    WeaponModel->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    WeaponModel->SetVisibility(bUsingRealisticRig);

    StatusLight = CreateDefaultSubobject<UPointLightComponent>(TEXT("NightglassSquadStatus"));
    StatusLight->SetupAttachment(GetCapsuleComponent());
    StatusLight->SetRelativeLocation(FVector(0.0f, 0.0f, 118.0f));
    StatusLight->SetLightColor(FLinearColor(0.10f, 0.88f, 0.82f));
    StatusLight->SetIntensity(0.0f);
    StatusLight->SetAttenuationRadius(175.0f);
    StatusLight->SetCastShadows(false);
}

void APhantomStrikeSquadmate::BeginPlay()
{
    Super::BeginPlay();
    if (!bUsingRealisticRig)
    {
        UStaticMesh* SquadVisualMesh = VisualModel ? VisualModel->GetStaticMesh() : nullptr;
        if (SquadVisualMesh)
        {
            const FBoxSphereBounds Bounds = SquadVisualMesh->GetBounds();
            const float RawHeight = FMath::Max(1.0f, Bounds.BoxExtent.Z * 2.0f);
            const float FitScale = FMath::Clamp(184.0f / RawHeight, 0.025f, 60.0f);
            const float LocalBottom = (Bounds.Origin.Z - Bounds.BoxExtent.Z) * FitScale;
            VisualModel->SetRelativeScale3D(FVector(FitScale));
            VisualModel->SetRelativeLocation(FVector(0.0f, 0.0f, -GetCapsuleComponent()->GetUnscaledCapsuleHalfHeight() - LocalBottom));
            VisualRestLocation = VisualModel->GetRelativeLocation();
        }
    }
    FireRemaining = FMath::FRandRange(0.3f, 0.9f);
    PresentationTime = FMath::FRandRange(0.0f, 6.0f);
}

void APhantomStrikeSquadmate::ConfigureSquadmate(int32 NewSquadIndex)
{
    SquadIndex = FMath::Clamp(NewSquadIndex, 0, 3);
    if (StatusLight)
    {
        StatusLight->SetIntensity(0.0f);
    }
}

void APhantomStrikeSquadmate::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    if (!bOperational || !GetWorld()) return;
    PresentationTime += DeltaSeconds;
    RecoilRemaining = FMath::Max(0.0f, RecoilRemaining - DeltaSeconds);
    FireRemaining = FMath::Max(0.0f, FireRemaining - DeltaSeconds);
    RepathRemaining = FMath::Max(0.0f, RepathRemaining - DeltaSeconds);
    ACharacter* Player = UGameplayStatics::GetPlayerCharacter(this, 0);
    if (!Player) return;

    APhantomStrikeEnemy* ClosestEnemy = nullptr;
    float ClosestDistanceSq = FMath::Square(4200.0f);
    for (TActorIterator<APhantomStrikeEnemy> It(GetWorld()); It; ++It)
    {
        const float CandidateDistanceSq = FVector::DistSquared(GetActorLocation(), It->GetActorLocation());
        if (CandidateDistanceSq < ClosestDistanceSq)
        {
            ClosestEnemy = *It;
            ClosestDistanceSq = CandidateDistanceSq;
        }
    }

    if (ClosestEnemy)
    {
        const FVector AimDirection = (ClosestEnemy->GetActorLocation() - GetActorLocation()).GetSafeNormal2D();
        SetActorRotation(FMath::RInterpTo(GetActorRotation(), AimDirection.Rotation(), DeltaSeconds, 8.5f));
        if (FireRemaining <= 0.0f)
        {
            const FVector Muzzle = GetActorLocation() + GetActorForwardVector() * 82.0f + FVector(0.0f, 0.0f, 66.0f);
            const FVector SuppressionPoint = ClosestEnemy->GetActorLocation() + FVector(FMath::FRandRange(-45.0f, 45.0f), FMath::FRandRange(-45.0f, 45.0f), FMath::FRandRange(25.0f, 82.0f));
            // Squad fire is suppression/readability only. It never applies damage or finishes the encounter for the player.
            SpawnBallisticTrace(GetWorld(), Muzzle, SuppressionPoint, FLinearColor(1.0f, 0.68f, 0.28f), 0.74f, 0.032f);
            FireRemaining = FMath::FRandRange(0.38f, 0.82f);
            RecoilRemaining = 0.10f;
        }
    }

    const float Side = SquadIndex % 2 == 0 ? -1.0f : 1.0f;
    const float Rank = SquadIndex < 2 ? -1.0f : -1.7f;
    const FVector FormationTarget = Player->GetActorLocation() + Player->GetActorRightVector() * Side * (210.0f + SquadIndex * 24.0f) + Player->GetActorForwardVector() * Rank * 180.0f;
    const FVector FormationOffset = FormationTarget - GetActorLocation();
    if (FormationOffset.Size2D() > 175.0f)
    {
        AddMovementInput(FormationOffset.GetSafeNormal2D(), ClosestEnemy ? 0.62f : 0.92f);
    }

    if (VisualModel && VisualModel->IsVisible())
    {
        const float SpeedAlpha = FMath::Clamp(GetVelocity().Size2D() / FMath::Max(1.0f, GetCharacterMovement()->MaxWalkSpeed), 0.0f, 1.0f);
        const float Step = FMath::Sin(PresentationTime * FMath::Lerp(3.0f, 8.2f, SpeedAlpha));
        const float RecoilAlpha = FMath::Clamp(RecoilRemaining / 0.10f, 0.0f, 1.0f);
        VisualModel->SetRelativeLocation(VisualRestLocation + FVector(0.0f, 0.0f, FMath::Abs(Step) * SpeedAlpha * 2.0f - RecoilAlpha));
        VisualModel->SetRelativeRotation(FRotator(-RecoilAlpha * 2.2f, 0.0f, Step * SpeedAlpha * 2.0f + (SquadIndex == 0 ? -1.2f : 1.2f)));
    }
}

void APhantomStrikeHUD::DrawHUD()
{
    Super::DrawHUD();
    if (!Canvas) return;
    const APhantomStrikeCharacter* Player = Cast<APhantomStrikeCharacter>(GetOwningPawn());
    const APhantomStrikeDirector* Director = StrikeDirector(this);
    if (!Player || !Director) return;

    const float Width = Canvas->SizeX;
    const float Height = Canvas->SizeY;
    if (DrawPhantomGameShell(this, Director, Width, Height, TEXT("PHANTOMSTRIKE"), TEXT("OPERATION NIGHTGLASS // BLACKRIDGE"), TEXT("WASD MOVE   MOUSE AIM   LMB FIRE   RMB ADS   R RELOAD   SHIFT SPRINT\nF INTERACT   G FRAG   Q TACTICAL   TAB ROSTER   M MAP   ESC PAUSE"), FLinearColor(0.82f,0.66f,0.34f))) return;
    const FVector2D Center(Width * 0.5f, Height * 0.5f);
    const float UIScale = FMath::Clamp(FMath::Min(Width / 1920.0f, Height / 1080.0f), 0.78f, 1.35f);
    const FLinearColor PaperWhite(0.86f, 0.88f, 0.84f, 0.92f);
    const FLinearColor MutedWhite(0.61f, 0.65f, 0.62f, 0.88f);
    const FLinearColor TacticalAmber(0.93f, 0.68f, 0.28f, 0.96f);
    const FLinearColor GlassBlack(0.006f, 0.010f, 0.012f, 0.68f);

    // V26 sight picture: a near-white combat reticle that disappears into a true optic dot
    // while aiming. No neon crosshair and no arcade bloom.
    if (Player->IsAiming())
    {
        DrawRect(FLinearColor(0.96f, 0.74f, 0.36f, 0.95f), Center.X - 1.25f * UIScale, Center.Y - 1.25f * UIScale, 2.5f * UIScale, 2.5f * UIScale);
    }
    else
    {
        const float Gap = (7.0f + Player->GetWeaponHeat() * 6.0f) * UIScale;
        DrawLine(Center.X - Gap - 5.0f * UIScale, Center.Y, Center.X - Gap, Center.Y, PaperWhite, 1.15f * UIScale);
        DrawLine(Center.X + Gap, Center.Y, Center.X + Gap + 5.0f * UIScale, Center.Y, PaperWhite, 1.15f * UIScale);
        DrawLine(Center.X, Center.Y - Gap - 5.0f * UIScale, Center.X, Center.Y - Gap, PaperWhite, 1.15f * UIScale);
        DrawLine(Center.X, Center.Y + Gap, Center.X, Center.Y + Gap + 5.0f * UIScale, PaperWhite, 1.15f * UIScale);
    }

    const float CompassYaw = GetOwningPlayerController() ? FMath::Fmod(GetOwningPlayerController()->GetControlRotation().Yaw + 360.0f, 360.0f) : 0.0f;
    const TCHAR* CompassCardinal = CompassYaw < 45.0f || CompassYaw >= 315.0f ? TEXT("N") : (CompassYaw < 135.0f ? TEXT("E") : (CompassYaw < 225.0f ? TEXT("S") : TEXT("W")));
    DrawText(FString::Printf(TEXT("%s   %03.0f"), CompassCardinal, CompassYaw), PaperWhite, Center.X - 31.0f * UIScale, 12.0f * UIScale, nullptr, 0.52f * UIScale);
    for (int32 TickIndex = -5; TickIndex <= 5; ++TickIndex)
    {
        const float TickX = Center.X + TickIndex * 24.0f * UIScale;
        const float TickHeight = TickIndex == 0 ? 8.0f : (TickIndex % 2 == 0 ? 5.0f : 3.0f);
        DrawLine(TickX, 34.0f * UIScale, TickX, (34.0f + TickHeight) * UIScale, MutedWhite, 1.0f * UIScale);
    }

    if (Player->GetHitMarkerRemaining() > 0.0f)
    {
        const FLinearColor HitColor = Player->WasLastHitHeadshot() ? FLinearColor(1.0f, 0.25f, 0.12f) : FLinearColor::White;
        DrawLine(Center.X - 12.0f, Center.Y - 12.0f, Center.X - 5.0f, Center.Y - 5.0f, HitColor, 2.2f);
        DrawLine(Center.X + 12.0f, Center.Y - 12.0f, Center.X + 5.0f, Center.Y - 5.0f, HitColor, 2.2f);
        DrawLine(Center.X - 12.0f, Center.Y + 12.0f, Center.X - 5.0f, Center.Y + 5.0f, HitColor, 2.2f);
        DrawLine(Center.X + 12.0f, Center.Y + 12.0f, Center.X + 5.0f, Center.Y + 5.0f, HitColor, 2.2f);
    }

    // Compact objective card, modelled after a real tactical briefing plate rather than a banner.
    DrawRect(GlassBlack, 28.0f * UIScale, 30.0f * UIScale, 390.0f * UIScale, 66.0f * UIScale);
    DrawRect(TacticalAmber, 28.0f * UIScale, 30.0f * UIScale, 3.0f * UIScale, 66.0f * UIScale);
    DrawText(FString::Printf(TEXT("BLACKRIDGE  //  %s"), *Director->GetMissionPhaseLabel()), MutedWhite, 42.0f * UIScale, 40.0f * UIScale, nullptr, 0.49f * UIScale);
    DrawText(Director->GetObjectiveText().Replace(TEXT("OBJECTIVE: "), TEXT("")), PaperWhite, 42.0f * UIScale, 66.0f * UIScale, nullptr, 0.58f * UIScale);

    DrawText(FString::Printf(TEXT("HOSTILES  %02d"), Director->GetRemainingEnemies()), Director->GetRemainingEnemies() > 0 ? TacticalAmber : MutedWhite, Width - 146.0f * UIScale, 38.0f * UIScale, nullptr, 0.55f * UIScale);

    // Vitals occupy two quiet meter lines. Damage communicates through the world-edge vignette.
    DrawText(FString::Printf(TEXT("TEAM %d/2"), Director->GetOperationalSquadmates()), MutedWhite, 30.0f * UIScale, Height - 82.0f * UIScale, nullptr, 0.48f * UIScale);
    DrawRect(FLinearColor(0.02f, 0.025f, 0.025f, 0.72f), 30.0f * UIScale, Height - 55.0f * UIScale, 210.0f * UIScale, 5.0f * UIScale);
    DrawRect(FLinearColor(0.70f, 0.74f, 0.65f, 0.96f), 30.0f * UIScale, Height - 55.0f * UIScale, 210.0f * UIScale * Player->Health / 100.0f, 5.0f * UIScale);
    DrawRect(FLinearColor(0.02f, 0.025f, 0.025f, 0.72f), 30.0f * UIScale, Height - 43.0f * UIScale, 210.0f * UIScale, 3.0f * UIScale);
    DrawRect(FLinearColor(0.34f, 0.45f, 0.50f, 0.95f), 30.0f * UIScale, Height - 43.0f * UIScale, 210.0f * UIScale * Player->Armor / 50.0f, 3.0f * UIScale);

    DrawText(FString::Printf(TEXT("%02d"), Player->Ammo), PaperWhite, Width - 142.0f * UIScale, Height - 84.0f * UIScale, nullptr, 1.62f * UIScale);
    DrawText(FString::Printf(TEXT("/ %03d"), Player->ReserveAmmo), MutedWhite, Width - 76.0f * UIScale, Height - 59.0f * UIScale, nullptr, 0.58f * UIScale);
    DrawText(FString::Printf(TEXT("%s  |  G %d  Q %d"), Player->IsSemiAuto()?TEXT("SEMI"):TEXT("AUTO"), Player->GetGrenades(), Player->GetTacticals()), MutedWhite, Width - 192.0f * UIScale, Height - 31.0f * UIScale, nullptr, 0.48f * UIScale);
    if (Player->IsReloading())
    {
        DrawRect(FLinearColor(0.03f, 0.035f, 0.035f, 0.78f), Width - 192.0f * UIScale, Height - 98.0f * UIScale, 162.0f * UIScale, 3.0f * UIScale);
        DrawRect(TacticalAmber, Width - 192.0f * UIScale, Height - 98.0f * UIScale, 162.0f * UIScale * Player->GetReloadProgress(), 3.0f * UIScale);
    }

    if (Director->IsAwaitingUplink())
    {
        if (FVector::DistSquared2D(Player->GetActorLocation(), Director->GetUplinkLocation()) < FMath::Square(480.0f))
        {
            DrawRect(GlassBlack,Center.X-122.0f*UIScale,Center.Y+70.0f*UIScale,244.0f*UIScale,36.0f*UIScale);
            DrawText(TEXT("[F]  SECURE THE RELAY"),TacticalAmber,Center.X-88.0f*UIScale,Center.Y+80.0f*UIScale,nullptr,0.58f*UIScale);
        }
    }

    if (Director->GetMissionElapsed() < 5.5f)
    {
        const float IntroAlpha = FMath::Clamp(FMath::Min(Director->GetMissionElapsed() / 0.8f, (5.5f - Director->GetMissionElapsed()) / 1.1f), 0.0f, 1.0f);
        DrawText(TEXT("OPERATION NIGHTGLASS"), FLinearColor(0.92f, 0.92f, 0.86f, IntroAlpha), Center.X - 146.0f * UIScale, Height * 0.68f, nullptr, 1.05f * UIScale);
        DrawText(TEXT("BLACKRIDGE COAST  //  02:17 LOCAL"), FLinearColor(0.68f, 0.66f, 0.58f, IntroAlpha), Center.X - 120.0f * UIScale, Height * 0.68f + 39.0f * UIScale, nullptr, 0.52f * UIScale);
    }

    if (Player->IsScoreboardVisible())
    {
        const float SW=FMath::Min(Width*0.62f,900.0f*UIScale), SH=FMath::Min(Height*0.58f,560.0f*UIScale);
        const float SX=(Width-SW)*0.5f,SY=(Height-SH)*0.5f;
        DrawRect(FLinearColor(0.005f,0.012f,0.020f,0.96f),SX,SY,SW,SH);
        DrawText(TEXT("BLACKRIDGE // ROSTER"),TacticalAmber,SX+28.0f*UIScale,SY+24.0f*UIScale,nullptr,1.05f*UIScale);
        DrawText(TEXT("PLAYER                         SCORE      K      D      STREAK"),FLinearColor(0.62f,0.72f,0.80f),SX+28.0f*UIScale,SY+82.0f*UIScale,nullptr,0.72f*UIScale);
        DrawText(FString::Printf(TEXT("PHANTOM                         %06d     %02d     %02d       %02d"),Player->Score,Player->Kills,Player->Deaths,Player->GetStreak()),FLinearColor::White,SX+28.0f*UIScale,SY+126.0f*UIScale,nullptr,0.88f*UIScale);
        DrawText(TEXT("HOLD TAB TO VIEW // RELEASE TO RETURN"),FLinearColor(0.44f,0.62f,0.72f),SX+28.0f*UIScale,SY+SH-48.0f*UIScale,nullptr,0.64f*UIScale);
    }

    if (Player->IsMapVisible())
    {
        const float MW=Width*0.72f,MH=Height*0.72f,MX=(Width-MW)*0.5f,MY=(Height-MH)*0.5f;
        DrawRect(FLinearColor(0.004f,0.010f,0.018f,0.94f),MX,MY,MW,MH);
        DrawText(TEXT("BLACKRIDGE TACTICAL MAP"),TacticalAmber,MX+30.0f*UIScale,MY+24.0f*UIScale,nullptr,1.0f*UIScale);
        const FVector2D P=FVector2D(MX+MW*0.5f,MY+MH*0.5f);
        DrawRect(PaperWhite,P.X-5.0f,P.Y-5.0f,10.0f,10.0f);
        DrawText(TEXT("[M] CLOSE"),FLinearColor::White,MX+MW-100.0f*UIScale,MY+MH-42.0f*UIScale,nullptr,0.7f*UIScale);
    }

    if (Player->GetDamageFlash() > 0.0f)
    {
        const float Alpha = Player->GetDamageFlash() * 0.24f;
        DrawRect(FLinearColor(0.62f, 0.015f, 0.01f, Alpha), 0.0f, 0.0f, Width, 28.0f * UIScale);
        DrawRect(FLinearColor(0.62f, 0.015f, 0.01f, Alpha), 0.0f, Height - 28.0f * UIScale, Width, 28.0f * UIScale);
        DrawRect(FLinearColor(0.62f, 0.015f, 0.01f, Alpha * 0.72f), 0.0f, 0.0f, 22.0f * UIScale, Height);
        DrawRect(FLinearColor(0.62f, 0.015f, 0.01f, Alpha * 0.72f), Width - 22.0f * UIScale, 0.0f, 22.0f * UIScale, Height);
    }
}

EPhantomStrikeMissionPhase APhantomStrikeDirector::GetMissionPhase() const
{
    if (bMissionComplete) return EPhantomStrikeMissionPhase::Complete;
    if (bExtractionOpen) return EPhantomStrikeMissionPhase::Extraction;
    if (bAwaitingUplink || Wave >= 5) return EPhantomStrikeMissionPhase::Uplink;
    if (Wave >= 3) return EPhantomStrikeMissionPhase::Breach;
    if (Wave >= 2) return EPhantomStrikeMissionPhase::StreetAdvance;
    return EPhantomStrikeMissionPhase::Insertion;
}

FString APhantomStrikeDirector::GetMissionPhaseLabel() const
{
    switch (GetMissionPhase())
    {
    case EPhantomStrikeMissionPhase::Insertion: return TEXT("INSERTION // FIRST CONTACT");
    case EPhantomStrikeMissionPhase::StreetAdvance: return TEXT("STREET ADVANCE");
    case EPhantomStrikeMissionPhase::Breach: return TEXT("COMMAND CENTER BREACH");
    case EPhantomStrikeMissionPhase::Uplink: return bAwaitingUplink ? TEXT("UPLINK READY") : TEXT("UPLINK ASSAULT");
    case EPhantomStrikeMissionPhase::Extraction: return TEXT("EXTRACTION ACTIVE");
    case EPhantomStrikeMissionPhase::Complete: return TEXT("NIGHTGLASS COMPLETE");
    default: return TEXT("OPERATION NIGHTGLASS");
    }
}

FString APhantomStrikeDirector::GetObjectiveText() const
{
    switch (GetMissionPhase())
    {
    case EPhantomStrikeMissionPhase::Insertion: return TEXT("OBJECTIVE: ADVANCE TO THE BLACKRIDGE CHECKPOINT");
    case EPhantomStrikeMissionPhase::StreetAdvance: return TEXT("OBJECTIVE: BREAK THE HELIX STREET LINE");
    case EPhantomStrikeMissionPhase::Breach: return TEXT("OBJECTIVE: BREACH THE COASTAL COMMAND CENTER");
    case EPhantomStrikeMissionPhase::Uplink: return bAwaitingUplink ? TEXT("OBJECTIVE: SECURE THE UPLINK [F]") : TEXT("OBJECTIVE: CLEAR THE UPLINK DEFENDERS");
    case EPhantomStrikeMissionPhase::Extraction: return TEXT("OBJECTIVE: REACH MARINA EXTRACTION");
    case EPhantomStrikeMissionPhase::Complete: return TEXT("OBJECTIVE COMPLETE: BLACKRIDGE SECURED");
    default: return TEXT("OBJECTIVE: OPERATION NIGHTGLASS");
    }
}

float APhantomStrikeDirector::GetMissionProgress() const
{
    if (bMissionComplete) return 1.0f;
    if (bExtractionOpen) return 0.92f;
    if (bAwaitingUplink) return 0.82f;
    return FMath::Clamp((FMath::Max(1, Wave) - 1.0f) / FMath::Max(1.0f, static_cast<float>(TotalWaves)), 0.02f, 0.78f);
}

int32 APhantomStrikeDirector::GetOperationalSquadmates() const
{
    int32 Operational = 0;
    if (!GetWorld()) return Operational;
    for (TActorIterator<APhantomStrikeSquadmate> It(GetWorld()); It; ++It)
    {
        if (It->IsOperational()) ++Operational;
    }
    return Operational;
}

void APhantomStrikeDirector::TryActivateUplink(APhantomStrikeCharacter* Player)
{
    if (!bAwaitingUplink || !Player) return;
    if (FVector::DistSquared2D(Player->GetActorLocation(), UplinkLocation) > FMath::Square(480.0f)) return;
    bAwaitingUplink = false;
    Player->Score += 750;
    OpenExtraction();
}

APhantomStrikeDirector::APhantomStrikeDirector()
{
    PrimaryActorTick.bCanEverTick = true;
}

void APhantomStrikeDirector::BeginPlay()
{
    Super::BeginPlay();
    BuildCommandComplex();
    SpawnSquad();
    Wave = 1;
    SpawnWave();
}

void APhantomStrikeDirector::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    MissionElapsed += DeltaSeconds;
    if (bMissionComplete) return;
    if (bExtractionOpen)
    {
        if (ACharacter* Player = UGameplayStatics::GetPlayerCharacter(this, 0))
        {
            if (FVector::DistSquared2D(Player->GetActorLocation(), ExtractionLocation) < FMath::Square(260.0f))
            {
                bMissionComplete = true;
                if (APhantomStrikeCharacter* StrikePlayer = Cast<APhantomStrikeCharacter>(Player)) StrikePlayer->Score += 1500;
            }
        }
        return;
    }
    if (RemainingEnemies > 0 || IntermissionRemaining <= 0.0f) return;
    IntermissionRemaining -= DeltaSeconds;
    if (IntermissionRemaining <= 0.0f)
    {
        ++Wave;
        SpawnWave();
    }
}

void APhantomStrikeDirector::RegisterEnemyDown()
{
    RemainingEnemies = FMath::Max(0, RemainingEnemies - 1);
    if (RemainingEnemies > 0) return;
    if (Wave >= TotalWaves)
    {
        bAwaitingUplink = true;
        SpawnPointLight(TEXT("NightglassUplinkBeacon"), UplinkLocation + FVector(0.0f, 0.0f, 145.0f), FLinearColor(1.0f, 0.62f, 0.10f), 15000.0f, 720.0f, true);
        SpawnShape(EPhantomPrimitive::Cylinder, TEXT("NightglassUplinkTerminal"), UplinkLocation + FVector(0.0f, 0.0f, 52.0f), FVector(90.0f, 90.0f, 125.0f), FLinearColor(0.92f, 0.48f, 0.06f), FRotator::ZeroRotator, true);
    }
    else
    {
        if (APhantomStrikeCharacter* Player = Cast<APhantomStrikeCharacter>(UGameplayStatics::GetPlayerCharacter(this, 0)))
        {
            Player->ReserveAmmo = FMath::Min(288, Player->ReserveAmmo + 48);
            Player->Armor = FMath::Min(75.0f, Player->Armor + 10.0f);
        }
        IntermissionRemaining = 2.4f;
    }
}

void APhantomStrikeDirector::SpawnWave()
{
    const int32 Count = FMath::Min(24, 7 + Wave * 2);
    RemainingEnemies = Count;
    const float PhaseAnchorX = Wave <= 1 ? -5200.0f : (Wave == 2 ? -2700.0f : (Wave == 3 ? 900.0f : (Wave == 4 ? 3800.0f : (Wave == 5 ? 6500.0f : 8200.0f))));
    for (int32 Index = 0; Index < Count; ++Index)
    {
        const int32 Lane = Index % 3;
        const int32 Rank = Index / 3;
        const FVector SpawnLocation(
            PhaseAnchorX + Rank * 580.0f + FMath::FRandRange(-140.0f,140.0f),
            -1750.0f + Lane * 1750.0f + FMath::FRandRange(-180.0f,180.0f),
            260.0f
        );
        APhantomStrikeEnemy* Enemy = GetWorld()->SpawnActor<APhantomStrikeEnemy>(SpawnLocation, FRotator(0.0f, 180.0f, 0.0f));
        if (!Enemy)
        {
            --RemainingEnemies;
            continue;
        }
        EPhantomStrikeEnemyRole EnemyRole = EPhantomStrikeEnemyRole::Rifleman;
        if (Wave >= 2 && Index % 4 == 1) EnemyRole = EPhantomStrikeEnemyRole::Rusher;
        if (Wave >= 3 && Index % 5 == 0) EnemyRole = EPhantomStrikeEnemyRole::Heavy;
        if (Wave >= 4 && Index % 6 == 3) EnemyRole = EPhantomStrikeEnemyRole::Marksman;
        Enemy->Configure(EnemyRole, Wave);
    }
}

void APhantomStrikeDirector::SpawnSquad()
{
    if (!GetWorld()) return;
    const FVector SquadSpawns[] = {
        FVector(-9240.0f, -235.0f, 260.0f),
        FVector(-9240.0f, 235.0f, 260.0f)
    };
    for (int32 Index = 0; Index < UE_ARRAY_COUNT(SquadSpawns); ++Index)
    {
        if (APhantomStrikeSquadmate* Squadmate = GetWorld()->SpawnActor<APhantomStrikeSquadmate>(SquadSpawns[Index], FRotator::ZeroRotator))
        {
            Squadmate->ConfigureSquadmate(Index);
        }
    }
}

void APhantomStrikeDirector::OpenExtraction()
{
    if (bExtractionOpen) return;
    bExtractionOpen = true;
    SpawnPointLight(TEXT("ExtractionBeacon"), ExtractionLocation + FVector(0.0f, 0.0f, 155.0f), FLinearColor(0.12f, 1.0f, 0.48f), 18000.0f, 950.0f, true);
    SpawnShape(EPhantomPrimitive::Cylinder, TEXT("ExtractionZone"), ExtractionLocation + FVector(0.0f, 0.0f, 8.0f), FVector(380.0f, 380.0f, 16.0f), FLinearColor(0.08f, 0.8f, 0.36f), FRotator::ZeroRotator, false);
}

void APhantomStrikeDirector::BuildCommandComplex()
{
    // V28 BLACKRIDGE COAST: a believable coastal woodland route with a restrained
    // military outpost. Natural daylight replaces the overexposed blue prototype grade.
    SpawnSun(1.35f, FRotator(-34.0f,-32.0f,0.0f), FLinearColor(0.96f,0.91f,0.82f));
    SetWorldMood(FLinearColor(0.10f,0.13f,0.14f),0.00165f,FLinearColor(0.27f,0.30f,0.28f));

    // V8 BLACKRIDGE SURFACE: invisible collision + 12 authored district ground meshes.
    // Road meshes are 150 cm high.  Put the invisible support surface at the same height so a
    // capsule cannot settle below the road and render from inside its underside.
    if (AStaticMeshActor* StrikeCollision = SpawnBlock(TEXT("BlackridgeCollision"),FVector(0,0,115),FVector(48000,36000,70),FLinearColor::Black))
    {
        StrikeCollision->SetActorHiddenInGame(true);
        StrikeCollision->SetActorEnableCollision(true);
        if (UStaticMeshComponent* ProxyMesh = StrikeCollision->GetStaticMeshComponent())
        {
            ProxyMesh->SetVisibility(false, true);
            ProxyMesh->SetHiddenInGame(true, true);
            ProxyMesh->SetCastShadow(false);
        }
    }
    const bool bProductionWorld = GetWorld() && GetWorld()->GetMapName().Contains(TEXT("PhantomStrike_World"));
    if (bProductionWorld)
    {
        // The persistent V10 city is intentionally replaced by V28 below. These low-output
        // practicals guide the route without washing out the landscape.
        const FVector RouteLights[] = {
            FVector(-8200.0f,-1500.0f,360.0f), FVector(-6900.0f,1550.0f,360.0f),
            FVector(-4600.0f,-1800.0f,380.0f), FVector(-2100.0f,1800.0f,380.0f),
            FVector(1200.0f,-1650.0f,400.0f), FVector(3900.0f,1650.0f,400.0f),
            FVector(6900.0f,-1350.0f,420.0f), FVector(9000.0f,1200.0f,420.0f)
        };
        for (int32 Index = 0; Index < UE_ARRAY_COUNT(RouteLights); ++Index)
        {
            const bool bWarm = Index % 2 == 0;
            SpawnPointLight(
                FString::Printf(TEXT("NightglassRouteLight_%02d"), Index),
                RouteLights[Index],
                bWarm ? FLinearColor(1.0f,0.58f,0.32f) : FLinearColor(0.62f,0.70f,0.72f),
                bWarm ? 1250.0f : 900.0f,
                420.0f,
                false
            );
        }
        BuildV28NaturalBlackridge();
        return;
    }
    for(int32 TY=0;TY<3;++TY)
    {
        for(int32 TX=0;TX<4;++TX)
        {
            const FString TerrainPath=FString::Printf(TEXT("/Game/Phantom/Generated/Strike/V8/Terrain/SM_V8_StrikeGround_%d%d.SM_V8_StrikeGround_%d%d"),TY,TX,TY,TX);
            SpawnStaticMeshAsset(FString::Printf(TEXT("V8BlackridgeGround_%d%d"),TY,TX),TerrainPath,
                FVector(-18000.0f+TX*12000.0f,-12000.0f+TY*12000.0f,-3.0f),FVector(1.0f),FRotator::ZeroRotator,false,false);
        }
    }

    auto SpawnCity=[this](const FString& Name,const FString& MeshPath,const FVector& Location,const FVector& Scale,
                          const FRotator& Rotation,bool bCollision,const FString& MaterialPath)->AStaticMeshActor*
    {
        AStaticMeshActor* Actor=SpawnStaticMeshAsset(Name,MeshPath,Location,Scale,Rotation,bCollision,true);
        if(Actor && !MaterialPath.IsEmpty() && Actor->GetStaticMeshComponent() && Actor->GetStaticMeshComponent()->GetNumMaterials()<=1)
            ApplyMaterialAsset(Actor,MaterialPath);
        return Actor;
    };

    static const TCHAR* Buildings[]={
        TEXT("/Game/Phantom/Strike/House1.House1"),TEXT("/Game/Phantom/Strike/House2.House2"),
        TEXT("/Game/Phantom/Strike/House3.House3"),TEXT("/Game/Phantom/Strike/House4.House4"),
        TEXT("/Game/Phantom/Strike/House5.House5"),TEXT("/Game/Phantom/Strike/Flat.Flat"),
        TEXT("/Game/Phantom/Strike/Flat2.Flat2"),TEXT("/Game/Phantom/Strike/Shop1.Shop1")
    };
    static const TCHAR* Materials[]={
        TEXT("/Game/Phantom/Strike/Main.Main"),TEXT("/Game/Phantom/Strike/Stone.Stone"),
        TEXT("/Game/Phantom/Strike/Green_003.Green_003"),TEXT("/Game/Phantom/Strike/Yellow_001.Yellow_001"),
        TEXT("/Game/Phantom/Strike/MainLight.MainLight"),TEXT("/Game/Phantom/Strike/DarkGrey.DarkGrey"),
        TEXT("/Game/Phantom/Strike/MainDark.MainDark"),TEXT("/Game/Phantom/Strike/LightMetal.LightMetal")
    };

    // Street grid: long three-lane spines with frequent cross-connections and route memory landmarks.
    int32 RoadId=0;
    for(int32 X=-21000;X<=21000;X+=3000)
    {
        for(int32 Y=-15000;Y<=15000;Y+=3000)
        {
            const bool bJunction=(X%6000==0)||(Y%6000==0);
            const TCHAR* Road=bJunction?TEXT("/Game/Phantom/Strike/Street_4Way.Street_4Way"):TEXT("/Game/Phantom/Strike/Street_Straight.Street_Straight");
            SpawnCity(FString::Printf(TEXT("BlackridgeRoad_%03d"),RoadId++),Road,FVector((float)X,(float)Y,0),FVector(3.8f),
                FRotator(0,(Y%6000==0)?0.0f:90.0f,0),false,TEXT("/Game/Phantom/Strike/Grey.Grey"));
        }
    }

    // Dense blocks on both sides of the main routes. Gaps are intentional flanks, not empty terrain.
    int32 BuildingId=0;
    for(int32 X=-19500;X<=19500;X+=3000)
    {
        for(int32 Y=-13500;Y<=13500;Y+=3000)
        {
            if((FMath::Abs(X)<4200 && FMath::Abs(Y)<4200) || ((X/3000+Y/3000)%5==0)) continue;
            const int32 Variant=FMath::Abs((X/3000)*7+(Y/3000)*3)%UE_ARRAY_COUNT(Buildings);
            const float Jitter=((BuildingId%3)-1)*240.0f;
            SpawnCity(FString::Printf(TEXT("BlackridgeBlock_%03d"),BuildingId++),Buildings[Variant],
                FVector((float)X+Jitter,(float)Y-Jitter,0),FVector(Variant==5||Variant==6?2.65f:3.65f),
                FRotator(0,((BuildingId+Variant)%4)*90.0f,0),true,Materials[Variant]);
        }
    }

    // Named districts make the map memorable.
    struct FLandmark { const TCHAR* Name; const TCHAR* Mesh; FVector P; FVector S; float Yaw; const TCHAR* Mat; };
    const FLandmark Landmarks[]={
        {TEXT("BlackridgeHotel"),TEXT("/Game/Phantom/Strike/Flat2.Flat2"),FVector(-15000,9000,0),FVector(3.2f),0,TEXT("/Game/Phantom/Strike/MainDark.MainDark")},
        {TEXT("CivicSquareHospital"),TEXT("/Game/Phantom/Strike/Hospital1.Hospital1"),FVector(-7500,7000,0),FVector(2.8f),180,TEXT("/Game/Phantom/Strike/White.White")},
        {TEXT("MarketAlley"),TEXT("/Game/Phantom/Strike/Shop1.Shop1"),FVector(-7000,-8000,0),FVector(3.4f),0,TEXT("/Game/Phantom/Strike/Yellow_001.Yellow_001")},
        {TEXT("MarinaBank"),TEXT("/Game/Phantom/Strike/Bank1.Bank1"),FVector(15000,-10500,0),FVector(2.7f),180,TEXT("/Game/Phantom/Strike/Stone.Stone")},
        {TEXT("WarehouseQuarter"),TEXT("/Game/Phantom/Strike/Flat.Flat"),FVector(16000,6500,0),FVector(3.1f),90,TEXT("/Game/Phantom/Strike/DarkWood.DarkWood")},
        {TEXT("RuinedTheater"),TEXT("/Game/Phantom/Strike/House4.House4"),FVector(6500,10500,0),FVector(4.0f),180,TEXT("/Game/Phantom/Strike/Green.Green")},
        {TEXT("HelixCommand"),TEXT("/Game/Phantom/Strike/Bank1.Bank1"),FVector(9000,0,0),FVector(2.8f),180,TEXT("/Game/Phantom/Strike/Red_002.Red_002")}
    };
    for(const FLandmark& L:Landmarks) SpawnCity(L.Name,L.Mesh,L.P,L.S,FRotator(0,L.Yaw,0),true,L.Mat);

    // Elevated connectors and compact power positions.
    const FVector Bridges[]={FVector(-12000,0,330),FVector(0,7500,330),FVector(12000,-3000,330)};
    for(int32 I=0;I<UE_ARRAY_COUNT(Bridges);++I)
        SpawnCity(FString::Printf(TEXT("BlackridgeOverpass_%02d"),I),TEXT("/Game/Phantom/Strike/Street_Bridge.Street_Bridge"),
            Bridges[I],FVector(3.5f),FRotator(0,I%2?0.0f:90.0f,0),true,TEXT("/Game/Phantom/Strike/DarkMetal.DarkMetal"));

    // Cover rhythm: wrecks, barriers, crates and carts every few seconds of traversal.
    for(int32 I=0;I<144;++I)
    {
        const float X=-21500.0f+(I%18)*2500.0f;
        const float Y=-15000.0f+(I/18)*4200.0f+((I%4)-1.5f)*280.0f;
        const FVector P(X,Y,12.0f);
        if(I%6==0)
        {
            const TCHAR* Car=I%12==0?TEXT("/Game/Phantom/Generated/Strike/Environment/SM_WreckCar_A.SM_WreckCar_A")
                                    :TEXT("/Game/Phantom/Generated/Strike/Environment/SM_WreckCar_B.SM_WreckCar_B");
            SpawnStaticMeshAsset(FString::Printf(TEXT("WreckVehicle_%02d"),I),Car,P,FVector(1.18f),FRotator(0,I*37.0f,0),true,true);
        }
        else if(I%3==0)
            SpawnStaticMeshAsset(FString::Printf(TEXT("TacticalBarrier_%02d"),I),TEXT("/Game/Phantom/Generated/Strike/Environment/SM_TacticalBarrier.SM_TacticalBarrier"),P,FVector(1.1f),FRotator(0,I*19.0f,0),true,true);
        else
        {
            const TCHAR* Prop=I%2?TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Crate.SM_CC0_Crate"):TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Barrel.SM_CC0_Barrel");
            SpawnStaticMeshAsset(FString::Printf(TEXT("TacticalProp_%02d"),I),Prop,P,FVector(1.05f),FRotator(0,I*31.0f,0),true,true);
        }
    }

    // Micro-cover neighborhoods around the three main lanes: frequent corners, broken sightlines,
    // and small cover objects prevent Blackridge from becoming a wide empty shooting gallery.
    for(int32 I=0;I<84;++I)
    {
        const int32 Lane=I%3;
        const float X=-18500.0f+(I%14)*2850.0f;
        const float Y=(Lane-1)*6200.0f+((I/14)%2?950.0f:-950.0f);
        SpawnStaticMeshAsset(FString::Printf(TEXT("BlackridgeMicroCover_%03d"),I),
            I%4==0?TEXT("/Game/Phantom/Generated/Strike/Environment/SM_WreckCar_A.SM_WreckCar_A"):
            (I%4==1?TEXT("/Game/Phantom/Generated/Strike/Environment/SM_TacticalBarrier.SM_TacticalBarrier"):
            (I%4==2?TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Crate.SM_CC0_Crate"):
                     TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Barrel.SM_CC0_Barrel"))),
            FVector(X,Y,12.0f),FVector(0.92f+(I%3)*0.08f),FRotator(0,I*37.0f,0),true,true);
    }

    // SERIOUS STREET-DRESSING PASS: guaranteed bundled detail props so Blackridge never collapses
    // into sterile building shells when optional marketplace content is absent.
    const TCHAR* StreetProps[]={
        TEXT("/Game/Phantom/Generated/Strike/V9/Props/SM_V9_CargoContainer_0.SM_V9_CargoContainer_0"),
        TEXT("/Game/Phantom/Generated/Strike/V9/Props/SM_V9_CargoContainer_1.SM_V9_CargoContainer_1"),
        TEXT("/Game/Phantom/Generated/Strike/V9/Props/SM_V9_SandbagWall.SM_V9_SandbagWall"),
        TEXT("/Game/Phantom/Generated/Strike/V9/Props/SM_V9_TacticalBarricade.SM_V9_TacticalBarricade"),
        TEXT("/Game/Phantom/Generated/Strike/Props/SM_Strike_Pallet.SM_Strike_Pallet"),
        TEXT("/Game/Phantom/Curated/Strike/SM_Strike_Commercial.SM_Strike_Commercial")
    };
    for(int32 I=0;I<96;++I)
    {
        const int32 Lane=I%4;
        const float X=-21000.0f+(I%16)*2750.0f;
        const float Y=-12600.0f+Lane*8400.0f+((I/16)%2?520.0f:-520.0f);
        SpawnStaticMeshAsset(FString::Printf(TEXT("BlackridgeStreetDress_%03d"),I),StreetProps[I%UE_ARRAY_COUNT(StreetProps)],
            FVector(X,Y,8.0f),FVector(0.86f+(I%4)*0.08f),FRotator(0,(I*47)%360,0),true,true);
    }
    // Roof silhouettes add the AC/utility clutter visible in modern dense urban FPS maps.
    for(int32 I=0;I<28;++I)
    {
        const float X=-18000.0f+(I%7)*6000.0f;
        const float Y=-11500.0f+(I/7)*7500.0f;
        SpawnStaticMeshAsset(FString::Printf(TEXT("BlackridgeRoofAC_%02d"),I),
            TEXT("/Game/Phantom/Generated/Strike/Props/SM_Strike_ACUnit.SM_Strike_ACUnit"),
            FVector(X,Y,520.0f+(I%3)*80.0f),FVector(0.86f),FRotator(0,I*23.0f,0),true,true);
    }

    // Streetlights create depth and route readability without a giant HUD.
    for(int32 I=0;I<40;++I)
    {
        const float X=-20500.0f+(I%20)*2150.0f;
        const float Y=I<20?4200.0f:-4200.0f;
        const FVector P(X,Y,0);
        SpawnStaticMeshAsset(FString::Printf(TEXT("Streetlight_%02d"),I),TEXT("/Game/Phantom/Strike/Streetlight_Single.Streetlight_Single"),P,FVector(3.4f),FRotator(0,I<14?180.0f:0.0f,0),false);
        if(I%2==0) SpawnPointLight(FString::Printf(TEXT("StreetlightGlow_%02d"),I),P+FVector(0,0,390),FLinearColor(1.0f,0.72f,0.42f),1900.0f,390.0f,false);
    }
    // V6 dense authored street furniture: these are the recovered original Strike assets, instanced
    // efficiently so the map can stay busy without multiplying Actor overhead.
    TArray<FTransform> StrikeTrafficLights;
    TArray<FTransform> StrikeStreetLights;
    for(int32 I=0;I<72;++I)
    {
        const float X=-19800.0f+(I%18)*2300.0f;
        const float Y=-12600.0f+(I/18)*8400.0f;
        StrikeTrafficLights.Emplace(FRotator(0.0f,(I%2)*180.0f,0.0f),FVector(X,Y,5.0f),FVector(2.8f));
    }
    for(int32 I=0;I<96;++I)
    {
        const float X=-21000.0f+(I%24)*1800.0f;
        const float Y=(I/24)*7200.0f-10800.0f;
        StrikeStreetLights.Emplace(FRotator(0.0f,(I%2)*180.0f,0.0f),FVector(X,Y,5.0f),FVector(3.1f));
    }
    SpawnInstancedMeshCluster(TEXT("BlackridgeTrafficLights_HISM"),TEXT("/Game/Phantom/Strike/TrafficLight.TrafficLight"),StrikeTrafficLights,false);
    SpawnInstancedMeshCluster(TEXT("BlackridgeStreetLights_HISM"),TEXT("/Game/Phantom/Strike/Streetlight_Single.Streetlight_Single"),StrikeStreetLights,false);

    for(int32 I=0;I<30;++I)
    {
        const float X=-17500.0f+(I%10)*3900.0f;
        const float Y=-9800.0f+(I/10)*9800.0f;
        SpawnStaticMeshAsset(FString::Printf(TEXT("V8BlackridgeBarricade_%02d"),I),
            TEXT("/Game/Phantom/Generated/Strike/V8/Props/SM_V8_StrikeBarricade.SM_V8_StrikeBarricade"),
            FVector(X,Y,8.0f),FVector(1.0f),FRotator(0,(I%2)*90.0f,0),true,true);
    }
    SpawnPointLight(TEXT("CommandCoreLight"),FVector(9000,0,360),FLinearColor(0.08f,0.88f,1.0f),7000.0f,700.0f,true);
    BuildV28NaturalBlackridge();
}

void APhantomStrikeDirector::BuildV28NaturalBlackridge()
{
    // This is a replacement pass, not another layer. Remove every legacy city mesh from
    // the persistent V10 level while preserving the invisible traversal collision actor.
    for (TActorIterator<AActor> It(GetWorld()); It; ++It)
    {
        AActor* Existing = *It;
        if (!Existing || Existing == this || Existing->IsA<APawn>() ||
            Existing->ActorHasTag(TEXT("BlackridgeCollision")) ||
            Existing->ActorHasTag(TEXT("PhantomSkyAtmosphere")) ||
            Existing->IsA<APostProcessVolume>())
        {
            continue;
        }
        // Persistent prototype landmarks were not all plain StaticMeshActors; a few
        // used instanced or other primitive components and survived the old cleanup.
        // Remove every legacy rendered primitive before the natural world is authored.
        TInlineComponentArray<UPrimitiveComponent*> PrimitiveComponents;
        Existing->GetComponents(PrimitiveComponents);
        if (PrimitiveComponents.IsEmpty())
        {
            continue;
        }
        Existing->SetActorHiddenInGame(true);
        Existing->SetActorEnableCollision(false);
        for (UPrimitiveComponent* PrimitiveComponent : PrimitiveComponents)
        {
            if (!PrimitiveComponent) continue;
            PrimitiveComponent->SetVisibility(false, true);
            PrimitiveComponent->SetHiddenInGame(true, true);
            PrimitiveComponent->SetCollisionEnabled(ECollisionEnabled::NoCollision);
        }
    }

    // Pull the exposure back to a readable natural daylight range and keep bloom restrained.
    for (TActorIterator<APostProcessVolume> It(GetWorld()); It; ++It)
    {
        It->Settings.bOverride_AutoExposureBias = true;
        It->Settings.AutoExposureBias = -0.85f;
        It->Settings.bOverride_BloomIntensity = true;
        It->Settings.BloomIntensity = 0.14f;
        It->Settings.bOverride_VignetteIntensity = true;
        It->Settings.VignetteIntensity = 0.18f;
    }

    // Tile every surface instead of stretching a monolithic terrain shell. The former ArchVis
    // terrain exposed a vertical boundary at the horizon and left the insertion gray and flat.
    // Close PBR dirt shoulders now blend the asphalt into broad grass bands while the invisible
    // support slab underneath remains the deterministic traversal surface.
    for (int32 Segment = 0; Segment < 30; ++Segment)
    {
        const float SegmentX = -12700.0f + Segment * 1000.0f;
        if (AStaticMeshActor* Route = SpawnStaticMeshAsset(
            FString::Printf(TEXT("V28CoastalAccessRoad_%02d"), Segment),
            TEXT("/Engine/BasicShapes/Plane.Plane"),
            FVector(SegmentX, 0.0f, 154.0f), FVector(10.04f,9.0f,1.0f),
            FRotator::ZeroRotator, false, false))
        {
            ApplyMaterialAsset(Route, TEXT("/Game/Phantom/Materials/Production/M_Phantom_Asphalt.M_Phantom_Asphalt"));
        }
        if (Segment % 2 == 0)
        {
            SpawnShape(EPhantomPrimitive::Cube, FString::Printf(TEXT("V28RoadCenterDash_%02d"), Segment),
                FVector(SegmentX,0.0f,158.0f), FVector(430.0f,7.0f,1.2f),
                FLinearColor(0.78f,0.63f,0.16f), FRotator::ZeroRotator, false);
        }
        for (int32 Side = -1; Side <= 1; Side += 2)
        {
            SpawnShape(EPhantomPrimitive::Cube,
                FString::Printf(TEXT("V28RoadEdge_%02d_%d"), Segment, Side),
                FVector(SegmentX,Side * 424.0f,158.0f), FVector(930.0f,4.0f,1.0f),
                FLinearColor(0.72f,0.72f,0.66f), FRotator::ZeroRotator, false);
            if (AStaticMeshActor* Shoulder = SpawnStaticMeshAsset(
                FString::Printf(TEXT("V28NaturalShoulder_%02d_%d"), Segment, Side),
                TEXT("/Engine/BasicShapes/Plane.Plane"), FVector(SegmentX, Side * 725.0f, 153.5f),
                FVector(10.04f,5.5f,1.0f), FRotator::ZeroRotator, false, false))
            {
                ApplyMaterialAsset(Shoulder, TEXT("/Game/Phantom/Materials/Production/M_Phantom_Dirt.M_Phantom_Dirt"));
            }
            if (AStaticMeshActor* InnerMeadow = SpawnStaticMeshAsset(
                FString::Printf(TEXT("V28InnerMeadow_%02d_%d"), Segment, Side),
                TEXT("/Engine/BasicShapes/Plane.Plane"), FVector(SegmentX, Side * 3500.0f, 153.0f),
                FVector(10.04f,50.0f,1.0f), FRotator::ZeroRotator, false, false))
            {
                ApplyMaterialAsset(InnerMeadow, TEXT("/Game/Phantom/Materials/Production/M_Phantom_Grass.M_Phantom_Grass"));
            }
            if (AStaticMeshActor* OuterMeadow = SpawnStaticMeshAsset(
                FString::Printf(TEXT("V28OuterMeadow_%02d_%d"), Segment, Side),
                TEXT("/Engine/BasicShapes/Plane.Plane"), FVector(SegmentX, Side * 10500.0f, 152.5f),
                FVector(10.04f,90.0f,1.0f), FRotator::ZeroRotator, false, false))
            {
                ApplyMaterialAsset(OuterMeadow, TEXT("/Game/Phantom/Materials/Production/M_Phantom_Grass.M_Phantom_Grass"));
            }
        }
    }
    for (int32 ApronX = 0; ApronX < 6; ++ApronX)
    {
        for (int32 ApronY = 0; ApronY < 4; ++ApronY)
        {
            if (AStaticMeshActor* Apron = SpawnStaticMeshAsset(
                FString::Printf(TEXT("V28OperationsApron_%02d_%02d"), ApronX, ApronY),
                TEXT("/Engine/BasicShapes/Plane.Plane"),
                FVector(6600.0f + ApronX * 1040.0f, -1710.0f + ApronY * 1140.0f, 156.0f),
                FVector(10.44f,11.44f,1.0f), FRotator::ZeroRotator, false, false))
            {
                ApplyMaterialAsset(Apron, TEXT("/Game/Phantom/Materials/Production/M_Phantom_Concrete.M_Phantom_Concrete"));
            }
        }
    }

    FRandomStream NaturalStream(2828);

    // Layer broad PBR ellipsoids below the forest to break the billiard-table horizon. Keeping
    // them outside the playable road corridor preserves deterministic movement while giving the
    // coastal insertion believable rolling terrain instead of a flat prototype plane.
    for (int32 Index = 0; Index < 24; ++Index)
    {
        const float Side = Index % 2 == 0 ? -1.0f : 1.0f;
        const float ScaleX = NaturalStream.FRandRange(34.0f, 74.0f);
        const float ScaleY = NaturalStream.FRandRange(48.0f, 96.0f);
        const float ScaleZ = NaturalStream.FRandRange(7.0f, 18.0f);
        const float CrestHeight = NaturalStream.FRandRange(320.0f, 860.0f);
        const FVector HillLocation(
            NaturalStream.FRandRange(-15400.0f,18400.0f),
            Side * NaturalStream.FRandRange(8500.0f,14600.0f),
            153.0f - 50.0f * ScaleZ + CrestHeight);
        if (AStaticMeshActor* Hill = SpawnStaticMeshAsset(
            FString::Printf(TEXT("V28NaturalHill_%02d"), Index),
            TEXT("/Engine/BasicShapes/Sphere.Sphere"), HillLocation,
            FVector(ScaleX,ScaleY,ScaleZ), FRotator(0.0f,NaturalStream.FRandRange(0.0f,360.0f),0.0f),
            false, false))
        {
            ApplyMaterialAsset(Hill, TEXT("/Game/Phantom/Materials/Production/M_Phantom_Grass.M_Phantom_Grass"));
        }
    }

    // Use the production ArchVis tree exclusively. The recovered CC0 aliases are valid assets,
    // but their faceted crowns and saturated materials fail the realistic Blackridge contract.
    // A broad scale range, irregular clearings, and a second sapling layer create variety without
    // mixing incompatible art styles. Deterministic placement keeps release proof stable.
    TArray<FTransform> NaturalTrees;
    TArray<FTransform> NaturalSaplings;
    NaturalTrees.Reserve(1400);
    NaturalSaplings.Reserve(700);
    for (int32 Index = 0; Index < 1400; ++Index)
    {
        const float X = NaturalStream.FRandRange(-15000.0f, 17600.0f);
        const float Side = Index % 2 == 0 ? -1.0f : 1.0f;
        const float EdgeBias = (Index % 5 == 0) ? 1200.0f : 2100.0f;
        const float Y = Side * NaturalStream.FRandRange(EdgeBias, 14800.0f);
        const float UniformScale = NaturalStream.FRandRange(0.52f, 1.18f);
        const float WidthScale = UniformScale * NaturalStream.FRandRange(0.88f, 1.12f);
        NaturalTrees.Emplace(
            FRotator(0.0f, NaturalStream.FRandRange(0.0f,360.0f), 0.0f),
            FVector(X,Y,154.0f), FVector(WidthScale,WidthScale,UniformScale));
    }
    for (int32 Index = 0; Index < 700; ++Index)
    {
        const float X = NaturalStream.FRandRange(-15200.0f, 17800.0f);
        const float Side = Index % 2 == 0 ? -1.0f : 1.0f;
        const float Y = Side * NaturalStream.FRandRange(1050.0f, 9800.0f);
        const float UniformScale = NaturalStream.FRandRange(0.13f, 0.29f);
        NaturalSaplings.Emplace(
            FRotator(0.0f, NaturalStream.FRandRange(0.0f,360.0f), 0.0f),
            FVector(X,Y,154.0f), FVector(UniformScale));
    }
    SpawnInstancedMeshCluster(TEXT("V28BlackridgeNaturalTrees_HISM"),
        TEXT("/Game/ArchVis/SampleScene/Tree/HillTree_02.HillTree_02"), NaturalTrees, false);
    SpawnInstancedMeshCluster(TEXT("V28BlackridgeNaturalSaplings_HISM"),
        TEXT("/Game/ArchVis/SampleScene/Tree/HillTree_02.HillTree_02"), NaturalSaplings, false);

    // PBR boulders use a smooth engine mesh with deliberately irregular proportions. This avoids
    // reintroducing the faceted CC0 rocks while giving the shoulders real parallax and breakup.
    for (int32 Index = 0; Index < 42; ++Index)
    {
        const float Side = Index % 2 == 0 ? -1.0f : 1.0f;
        const float ScaleX = NaturalStream.FRandRange(1.4f,4.8f);
        const float ScaleY = NaturalStream.FRandRange(1.2f,4.2f);
        const float ScaleZ = NaturalStream.FRandRange(1.1f,3.0f);
        const FVector BoulderLocation(
            NaturalStream.FRandRange(-14800.0f,17600.0f),
            Side * NaturalStream.FRandRange(1250.0f,7600.0f),
            153.0f + ScaleZ * 22.0f);
        if (AStaticMeshActor* Boulder = SpawnStaticMeshAsset(
            FString::Printf(TEXT("V28NaturalBoulder_%02d"), Index),
            TEXT("/Engine/BasicShapes/Sphere.Sphere"), BoulderLocation,
            FVector(ScaleX,ScaleY,ScaleZ),
            FRotator(NaturalStream.FRandRange(-14.0f,14.0f),NaturalStream.FRandRange(0.0f,360.0f),NaturalStream.FRandRange(-12.0f,12.0f)),
            false, false))
        {
            ApplyMaterialAsset(Boulder, TEXT("/Game/Phantom/Materials/Production/M_Phantom_Rock.M_Phantom_Rock"));
        }
    }

    const FVector PracticalLights[] = {
        FVector(-4200.0f,1350.0f,340.0f), FVector(2750.0f,-1420.0f,350.0f),
        FVector(6900.0f,1380.0f,365.0f), FVector(9100.0f,-900.0f,410.0f)
    };
    for (int32 Index = 0; Index < UE_ARRAY_COUNT(PracticalLights); ++Index)
    {
        SpawnPointLight(FString::Printf(TEXT("V28BlackridgePractical_%02d"), Index), PracticalLights[Index],
            FLinearColor(1.0f,0.56f,0.30f), Index == 3 ? 1850.0f : 950.0f,
            Index == 3 ? 480.0f : 330.0f, false);
    }

    // The former additive city implementation is retained below only as disabled recovery
    // reference. It cannot execute or render in V28.
#if 0
    // V27 BLACKRIDGE REALISM: the approved wet-coast target renders are the contract.
    // Real authored vehicle/building meshes and PBR materials replace visible primitive
    // architecture while preserving the persistent map and center traversal lane.
    struct FBlackridgeSetpiece
    {
        const TCHAR* Name;
        const TCHAR* Asset;
        FVector Location;
        float Scale;
        float Yaw;
        bool bCollision;
    };
    const FBlackridgeSetpiece Setpieces[] = {
        {TEXT("V27InsertionDisabledCar"), TEXT("/Game/ProductAssets/Mesh/SM_Car.SM_Car"), FVector(-7850.0f,-1280.0f,160.0f), 1.00f, 18.0f, true},
        {TEXT("V27CheckpointUtilityCar"), TEXT("/Game/ProductAssets/Mesh/SM_Car.SM_Car"), FVector(-5050.0f,1420.0f,160.0f), 1.04f, -24.0f, true},
        {TEXT("V27MarketEvacuationCar"), TEXT("/Game/ProductAssets/Mesh/SM_Car.SM_Car"), FVector(-1680.0f,-1620.0f,160.0f), 0.96f, 34.0f, true},
        {TEXT("V27BreachResponseVehicle"), TEXT("/Game/ProductAssets/Mesh/SM_Car.SM_Car"), FVector(5960.0f,1510.0f,160.0f), 1.06f, 164.0f, true},
        {TEXT("V26InsertionRubble"), TEXT("/Game/Phantom/Generated/Strike/V10/Props/SM_V10_RubblePile.SM_V10_RubblePile"), FVector(-6900.0f,1740.0f,160.0f), 0.82f, 12.0f, false},
        {TEXT("V26CheckpointRubble"), TEXT("/Game/Phantom/Generated/Strike/V10/Props/SM_V10_RubblePile.SM_V10_RubblePile"), FVector(-4050.0f,-1820.0f,160.0f), 0.94f, 83.0f, false},
        {TEXT("V26MarketRubble"), TEXT("/Game/Phantom/Generated/Strike/V10/Props/SM_V10_RubblePile.SM_V10_RubblePile"), FVector(550.0f,1880.0f,160.0f), 0.78f, -28.0f, false},
        {TEXT("V26BreachRubbleLeft"), TEXT("/Game/Phantom/Generated/Strike/V10/Props/SM_V10_RubblePile.SM_V10_RubblePile"), FVector(7350.0f,-1180.0f,160.0f), 0.88f, 17.0f, false},
        {TEXT("V26BreachRubbleRight"), TEXT("/Game/Phantom/Generated/Strike/V10/Props/SM_V10_RubblePile.SM_V10_RubblePile"), FVector(7480.0f,1260.0f,160.0f), 0.84f, 151.0f, false},
        {TEXT("V26InsertionBarrier"), TEXT("/Game/Phantom/Generated/Strike/V9/Props/SM_V9_TacticalBarricade.SM_V9_TacticalBarricade"), FVector(-6100.0f,-1880.0f,160.0f), 0.86f, 90.0f, true},
        {TEXT("V26StreetBarrierA"), TEXT("/Game/Phantom/Generated/Strike/V9/Props/SM_V9_SandbagWall.SM_V9_SandbagWall"), FVector(-2850.0f,1610.0f,160.0f), 0.90f, 8.0f, true},
        {TEXT("V26StreetBarrierB"), TEXT("/Game/Phantom/Generated/Strike/V9/Props/SM_V9_SandbagWall.SM_V9_SandbagWall"), FVector(2380.0f,-1690.0f,160.0f), 0.92f, 172.0f, true},
        {TEXT("V26BreachBarricade"), TEXT("/Game/Phantom/Generated/Strike/V9/Props/SM_V9_TacticalBarricade.SM_V9_TacticalBarricade"), FVector(6660.0f,-1520.0f,160.0f), 0.88f, 78.0f, true},
        {TEXT("V26RelayContainerA"), TEXT("/Game/Phantom/Generated/Strike/V9/Props/SM_V9_CargoContainer_0.SM_V9_CargoContainer_0"), FVector(8650.0f,-1700.0f,160.0f), 0.72f, 90.0f, true},
        {TEXT("V26RelayContainerB"), TEXT("/Game/Phantom/Generated/Strike/V9/Props/SM_V9_CargoContainer_1.SM_V9_CargoContainer_1"), FVector(9400.0f,1740.0f,160.0f), 0.72f, -90.0f, true}
    };
    for (const FBlackridgeSetpiece& Setpiece : Setpieces)
    {
        SpawnStaticMeshAsset(Setpiece.Name, Setpiece.Asset, Setpiece.Location, FVector(Setpiece.Scale), FRotator(0.0f, Setpiece.Yaw, 0.0f), Setpiece.bCollision, true);
    }

    // The shared semantic unit gate already resolves ProductAssets architecture to real-world
    // dimensions. These factors are design multipliers only; the former 54-64x values multiplied
    // the unit correction twice and stretched buildings across the entire insertion route.
    const FBlackridgeSetpiece RealBuildings[] = {
        {TEXT("V27InsertionApartment"), TEXT("/Game/ProductAssets/Mesh/SM_Building.SM_Building"), FVector(-6900.0f,5450.0f,160.0f), 1.45f, 90.0f, true},
        {TEXT("V27CheckpointApartment"), TEXT("/Game/ProductAssets/Mesh/SM_Building.SM_Building"), FVector(-2850.0f,-5600.0f,160.0f), 1.35f, -90.0f, true},
        {TEXT("V27MarketApartment"), TEXT("/Game/ProductAssets/Mesh/SM_Building.SM_Building"), FVector(2450.0f,5650.0f,160.0f), 1.55f, 90.0f, true},
        {TEXT("V27CommandCenterShell"), TEXT("/Game/ProductAssets/Mesh/SM_Building.SM_Building"), FVector(8550.0f,3650.0f,160.0f), 1.75f, -90.0f, false}
    };
    for (const FBlackridgeSetpiece& Building : RealBuildings)
    {
        SpawnStaticMeshAsset(Building.Name, Building.Asset, Building.Location, FVector(Building.Scale), FRotator(0.0f, Building.Yaw, 0.0f), Building.bCollision, true);
    }

    // Warm practicals against the cool storm ambience create the target's photographic depth.
    const FVector PracticalLights[] = {
        FVector(-8200.0f,1380.0f,330.0f), FVector(-5220.0f,-1480.0f,340.0f),
        FVector(-1900.0f,1580.0f,345.0f), FVector(1850.0f,-1550.0f,350.0f),
        FVector(5250.0f,1520.0f,365.0f), FVector(7460.0f,-1180.0f,390.0f),
        FVector(9050.0f,760.0f,410.0f), FVector(14500.0f,-9200.0f,370.0f)
    };
    for (int32 Index = 0; Index < UE_ARRAY_COUNT(PracticalLights); ++Index)
    {
        SpawnPointLight(FString::Printf(TEXT("V26BlackridgePractical_%02d"), Index), PracticalLights[Index], FLinearColor(1.0f,0.48f,0.20f), Index == 5 ? 4100.0f : 2450.0f, Index == 5 ? 560.0f : 390.0f, Index == 5);
    }

    // Relay-room silhouettes use authored industrial props. No engine cubes are allowed in
    // the hero breach composition.
    for (int32 Side = -1; Side <= 1; Side += 2)
    {
        for (int32 Rank = 0; Rank < 3; ++Rank)
        {
            SpawnStaticMeshAsset(
                FString::Printf(TEXT("V27RelayBank_%d_%d"), Side, Rank),
                Rank % 2 == 0
                    ? TEXT("/Game/Phantom/Curated/Strike/SM_Strike_Industrial.SM_Strike_Industrial")
                    : TEXT("/Game/Phantom/Curated/Strike/SM_Strike_StreetProp.SM_Strike_StreetProp"),
                FVector(8350.0f + Rank * 520.0f, Side * 930.0f, 160.0f),
                FVector(Rank % 2 == 0 ? 0.42f : 0.58f),
                FRotator(0.0f, Side < 0 ? 90.0f : -90.0f, 0.0f),
                true,
                true
            );
        }
    }
    SpawnStaticMeshAsset(TEXT("V27BreachFrameLeft"), TEXT("/Game/Phantom/Generated/Strike/V10/Props/SM_V10_RubblePile.SM_V10_RubblePile"), FVector(7540.0f,-760.0f,160.0f), FVector(1.10f), FRotator(0.0f,22.0f,0.0f), false, true);
    SpawnStaticMeshAsset(TEXT("V27BreachFrameRight"), TEXT("/Game/Phantom/Generated/Strike/V10/Props/SM_V10_RubblePile.SM_V10_RubblePile"), FVector(7580.0f,760.0f,160.0f), FVector(1.06f), FRotator(0.0f,156.0f,0.0f), false, true);
    SpawnStaticMeshAsset(TEXT("V27BreachInterior"), TEXT("/Game/Phantom/Curated/Strike/SM_Strike_Warehouse.SM_Strike_Warehouse"), FVector(8950.0f,0.0f,160.0f), FVector(0.92f), FRotator(0.0f,90.0f,0.0f), false, true);
#endif
}
