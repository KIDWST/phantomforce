#include "Strike/PhantomStrikeDirector.h"
#include "Core/PhantomGameShell.h"
#include "Core/PhantomModularCharacter.h"

#include "Camera/CameraComponent.h"
#include "Components/CapsuleComponent.h"
#include "Components/PointLightComponent.h"
#include "Components/PrimitiveComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/Canvas.h"
#include "Engine/DamageEvents.h"
#include "Engine/Engine.h"
#include "Engine/StaticMeshActor.h"
#include "EngineUtils.h"
#include "DrawDebugHelpers.h"
#include "GameFramework/CharacterMovementComponent.h"
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
}

APhantomStrikeCharacter::APhantomStrikeCharacter()
{
    PrimaryActorTick.bCanEverTick = true;
    FirstPersonCamera = CreateDefaultSubobject<UCameraComponent>(TEXT("FirstPersonCamera"));
    FirstPersonCamera->SetupAttachment(GetCapsuleComponent());
    FirstPersonCamera->SetRelativeLocation(FVector(-10.0f, 0.0f, 64.0f));
    FirstPersonCamera->bUsePawnControlRotation = true;
    FirstPersonCamera->FieldOfView = 90.0f;

    UStaticMesh* Cube = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cube.Cube"));
    UStaticMesh* Cylinder = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
    RifleBody = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("NightglassRifle"));
    RifleBody->SetupAttachment(FirstPersonCamera);
    UStaticMesh* ImportedRifle = LoadObject<UStaticMesh>(
        nullptr,
        TEXT("/Game/Phantom/Strike/AssaultRifle.AssaultRifle")
    );
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
    if (UStaticMesh* Pistol=LoadObject<UStaticMesh>(nullptr,TEXT("/Game/Phantom/Strike/Pistol.Pistol")))
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

    MuzzleLight = CreateDefaultSubobject<UPointLightComponent>(TEXT("MuzzleFlash"));
    MuzzleLight->SetupAttachment(FirstPersonCamera);
    MuzzleLight->SetRelativeLocation(FVector(130.0f, 15.0f, -17.0f));
    MuzzleLight->SetIntensity(0.0f);
    MuzzleLight->SetAttenuationRadius(360.0f);
    MuzzleLight->SetLightColor(FLinearColor(0.15f, 0.85f, 1.0f));
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
    // Blackridge insertion point: first contact is intentionally ~8-15 seconds ahead, not a long walk.
    // Production road tiles are 150 cm tall. Keep the capsule center above their top surface
    // so the first-person camera never starts embedded inside Street_Straight.
    SetActorLocation(FVector(-9000.0f,0.0f,260.0f));
    SetActorRotation(FRotator(0.0f,0.0f,0.0f));
    // Keep first contact, road cover, and the weapon readable in the opening
    // frame instead of devoting a third of the view to empty sky.
    if (AController* C=GetController())
    {
        C->SetControlRotation(FRotator(-9.0f,0.0f,0.0f));
        bInitialViewApplied = true;
    }
    if (!bUsingImportedRifle)
    {
        ApplyShapeColor(RifleBody, FLinearColor(0.025f, 0.055f, 0.08f));
        ApplyShapeColor(RifleBarrel, FLinearColor(0.08f, 0.85f, 0.95f));
        ApplyShapeColor(RifleSight, FLinearColor(0.9f, 0.12f, 0.28f));
    }
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
            C->SetControlRotation(FRotator(-9.0f, 0.0f, 0.0f));
            bInitialViewApplied = true;
        }
    }
    // Recovery guard for malformed or temporarily unloaded collision.  A packaged FPS must never
    // leave its camera below Blackridge's authored surface.
    if (GetActorLocation().Z < -200.0f)
    {
        SetActorLocation(FVector(-9000.0f, 0.0f, 260.0f), false, nullptr, ETeleportType::TeleportPhysics);
        GetCharacterMovement()->StopMovementImmediately();
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
    MuzzleLight->SetIntensity(MuzzleFlashRemaining > 0.0f ? 8500.0f : 0.0f);

    const float DesiredFov = bAiming ? (bUsingSidearm ? 74.0f : 70.0f) : (bSprinting ? 96.0f : (SlideRemaining > 0.0f ? 94.0f : 90.0f));
    FirstPersonCamera->SetFieldOfView(FMath::FInterpTo(FirstPersonCamera->FieldOfView, DesiredFov, DeltaSeconds, 12.0f));
    const float CameraZ = bProne ? 28.0f : ((SlideRemaining > 0.0f || bCrouchedByInput) ? 46.0f : 64.0f);
    const FVector DesiredCameraLocation(-10.0f, 0.0f, CameraZ);
    FirstPersonCamera->SetRelativeLocation(FMath::VInterpTo(FirstPersonCamera->GetRelativeLocation(), DesiredCameraLocation, DeltaSeconds, 14.0f));
    const float MoveSpeed = GetVelocity().Size2D();
    WeaponBobTime += DeltaSeconds * (MoveSpeed > 40.0f ? (bSprinting ? 13.0f : 8.5f) : 2.0f);
    const float BobStrength = bAiming ? 0.45f : (bSprinting ? 2.4f : 1.25f);
    const FVector WeaponBob(
        -RecoilKick * 8.0f,
        FMath::Sin(WeaponBobTime) * BobStrength,
        FMath::Abs(FMath::Cos(WeaponBobTime * 0.5f)) * BobStrength - BobStrength * 0.5f
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

    if (bReloading)
    {
        ReloadRemaining -= DeltaSeconds;
        RifleBody->SetRelativeRotation(FRotator(0.0f, 0.0f, FMath::Sin(ReloadRemaining * 7.0f) * 18.0f));
        if (ReloadRemaining <= 0.0f) FinishReload();
    }
    else
    {
        const FRotator InspectRotation = InspectRemaining > 0.0f ? FRotator(8.0f, 32.0f, -18.0f) : FRotator::ZeroRotator;
        RifleBody->SetRelativeRotation(FMath::RInterpTo(RifleBody->GetRelativeRotation(), InspectRotation, DeltaSeconds, 12.0f));
        if (bTriggerHeld && FireCooldown <= 0.0f) FireOneRound();
    }

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
    SpawnBallisticTrace(GetWorld(), ViewLocation + ShotDirection * 75.0f, TraceEnd, FLinearColor(0.18f, 0.82f, 1.0f), 1.6f, 0.035f);
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
        SetActorLocation(FVector(-9000.0f, 0.0f, 260.0f));
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
    WeaponMesh->SetStaticMesh(Cube);
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
    MuzzleLight->SetLightColor(FLinearColor(1.0f, 0.12f, 0.025f));
    MuzzleLight->SetCastShadows(false);
    GetCharacterMovement()->MaxWalkSpeed = 410.0f;
    GetCharacterMovement()->MaxAcceleration = 2200.0f;
}

void APhantomStrikeEnemy::Configure(EPhantomStrikeEnemyRole NewRole, int32 NewTier)
{
    Role = NewRole;
    Tier = FMath::Max(1, NewTier);
    const FLinearColor HostileRed(0.9f, 0.035f, 0.08f);

    const TCHAR* ProductionBody = Role == EPhantomStrikeEnemyRole::Rusher
        ? TEXT("/Game/Phantom/Characters/Production/SK_Rogue.SK_Rogue")
        : (Role == EPhantomStrikeEnemyRole::Heavy
            ? TEXT("/Game/Phantom/Characters/Production/SK_Barbarian.SK_Barbarian")
            : TEXT("/Game/Phantom/Characters/Production/SK_Knight.SK_Knight"));
    const TCHAR* ProductionIdle = Role == EPhantomStrikeEnemyRole::Rusher
        ? TEXT("/Game/Phantom/Characters/Production/Animations/A_Rogue_Idle.A_Rogue_Idle")
        : (Role == EPhantomStrikeEnemyRole::Heavy
            ? TEXT("/Game/Phantom/Characters/Production/Animations/A_Barbarian_Idle.A_Barbarian_Idle")
            : TEXT("/Game/Phantom/Characters/Production/Animations/A_Knight_Idle.A_Knight_Idle"));
    const bool bProductionHumanoid = PhantomModularCharacter::Configure(
        this,
        GetMesh(),
        GetCapsuleComponent(),
        ProductionBody,
        ProductionIdle,
        Role == EPhantomStrikeEnemyRole::Heavy ? 215.0f : 184.0f,
        -GetCapsuleComponent()->GetUnscaledCapsuleHalfHeight(),
        -90.0f
    );

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
    // V7: generated Helix meshes are known-upright and deterministic; arbitrary external static
    // character aliases are fallback-only until a proper skeletal import has been verified.
    UStaticMesh* AuthoredCharacter = bProductionHumanoid ? nullptr : LoadObject<UStaticMesh>(nullptr, GeneratedCharacter);
    if (!AuthoredCharacter && !bProductionHumanoid) AuthoredCharacter = LoadObject<UStaticMesh>(nullptr, ExternalCharacter);
    if (AuthoredCharacter)
    {
        VisualModel->SetStaticMesh(AuthoredCharacter);
        const FBoxSphereBounds VisualBounds = AuthoredCharacter->GetBounds();
        const float RawHeight = FMath::Max(1.0f, VisualBounds.BoxExtent.Z * 2.0f);
        const float TargetHeight = Role == EPhantomStrikeEnemyRole::Heavy ? 220.0f : 185.0f;
        const float FitScale = FMath::Clamp(TargetHeight / RawHeight, 0.025f, 60.0f);
        const float LocalBottom = (VisualBounds.Origin.Z - VisualBounds.BoxExtent.Z) * FitScale;
        VisualModel->SetRelativeLocation(FVector(0.0f, 0.0f, -GetCapsuleComponent()->GetUnscaledCapsuleHalfHeight() - LocalBottom));
        VisualModel->SetRelativeScale3D(FVector(FitScale));
        VisualModel->SetRelativeRotation(FRotator::ZeroRotator);
        VisualModel->SetVisibility(true);
        BodyMesh->SetVisibility(false);
        ArmorMesh->SetVisibility(false);
        // The invisible head primitive remains a dedicated headshot trace target.
        HeadMesh->SetVisibility(false);
    }
    if (bProductionHumanoid)
    {
        VisualModel->SetVisibility(false);
        BodyMesh->SetVisibility(false);
        ArmorMesh->SetVisibility(false);
        HeadMesh->SetVisibility(false);
    }
    const FLinearColor HostileAmber(1.0f, 0.28f, 0.035f);
    ApplyShapeColor(HeadMesh, FLinearColor(0.08f, 0.02f, 0.025f));
    ApplyShapeColor(WeaponMesh, HostileRed);
    if (Role == EPhantomStrikeEnemyRole::Rusher)
    {
        Health = 68.0f + Tier * 7.0f;
        Damage = 13.0f + Tier;
        AttackInterval = 0.48f;
        PreferredRange = 125.0f;
        GetCharacterMovement()->MaxWalkSpeed = 610.0f;
        BodyMesh->SetRelativeScale3D(FVector(0.4f, 0.4f, 0.66f));
        ApplyShapeColor(BodyMesh, FLinearColor(0.38f, 0.025f, 0.055f));
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
        ApplyShapeColor(BodyMesh, FLinearColor(0.065f, 0.035f, 0.12f));
        ApplyShapeColor(ArmorMesh, FLinearColor(0.68f, 0.08f, 0.92f));
        ApplyShapeColor(WeaponMesh, FLinearColor(0.8f, 0.12f, 1.0f));
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
        ApplyShapeColor(BodyMesh, FLinearColor(0.12f, 0.025f, 0.035f));
        ApplyShapeColor(ArmorMesh, HostileAmber);
    }
    else
    {
        Health = 98.0f + Tier * 10.0f;
        Damage = 8.0f + Tier;
        AttackInterval = 0.72f;
        PreferredRange = 980.0f;
        GetCharacterMovement()->MaxWalkSpeed = 390.0f;
        ApplyShapeColor(BodyMesh, FLinearColor(0.18f, 0.025f, 0.05f));
        ApplyShapeColor(ArmorMesh, HostileRed);
    }
    AttackCooldown = FMath::FRandRange(0.15f, AttackInterval);
    StrafeDirection = FMath::RandBool() ? 1.0f : -1.0f;
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
    AttackCooldown = FMath::Max(0.0f, AttackCooldown - DeltaSeconds);
    MuzzleFlashRemaining = FMath::Max(0.0f, MuzzleFlashRemaining - DeltaSeconds);
    MuzzleLight->SetIntensity(MuzzleFlashRemaining > 0.0f ? 6500.0f : 0.0f);
    ACharacter* Player = UGameplayStatics::GetPlayerCharacter(this, 0);
    if (!Player) return;
    const FVector Offset = Player->GetActorLocation() - GetActorLocation();
    const float Distance = Offset.Size2D();
    const FVector Direction = Offset.GetSafeNormal2D();
    SetActorRotation(FMath::RInterpTo(GetActorRotation(), Direction.Rotation(), DeltaSeconds, 8.0f));

    if (Role == EPhantomStrikeEnemyRole::Rusher)
    {
        if (Distance > PreferredRange) AddMovementInput(Direction, 1.0f);
    }
    else
    {
        if (Distance > PreferredRange * 1.2f) AddMovementInput(Direction, 0.85f);
        else if (Distance < PreferredRange * 0.58f) AddMovementInput(-Direction, 0.68f);
        else AddMovementInput(FVector::CrossProduct(FVector::UpVector, Direction) * StrafeDirection, 0.52f);
    }

    const bool bInAttackRange = Role == EPhantomStrikeEnemyRole::Rusher ? Distance < 165.0f : Distance < PreferredRange * 1.45f;
    if (bInAttackRange && AttackCooldown <= 0.0f && HasLineOfSightTo(Player))
    {
        const float RangePenalty = FMath::Clamp(Distance / FMath::Max(PreferredRange, 1.0f), 0.0f, 1.5f);
        const float BaseAccuracy = Role == EPhantomStrikeEnemyRole::Marksman ? 0.78f : (Role == EPhantomStrikeEnemyRole::Rusher ? 0.82f : (Role == EPhantomStrikeEnemyRole::Heavy ? 0.58f : 0.68f));
        const bool bHitPlayer = FMath::FRand() < FMath::Clamp(BaseAccuracy - RangePenalty * 0.16f, 0.35f, 0.9f);
        const FVector Muzzle = GetActorLocation() + GetActorForwardVector() * 90.0f + FVector(0.0f, 0.0f, 62.0f);
        FVector TargetPoint = Player->GetActorLocation() + FVector(0.0f, 0.0f, 48.0f);
        if (!bHitPlayer) TargetPoint += FVector(FMath::FRandRange(-115.0f, 115.0f), FMath::FRandRange(-115.0f, 115.0f), FMath::FRandRange(-55.0f, 95.0f));
        else UGameplayStatics::ApplyDamage(Player, Damage, GetController(), this, UDamageType::StaticClass());
        SpawnBallisticTrace(GetWorld(), Muzzle, TargetPoint, Role == EPhantomStrikeEnemyRole::Marksman ? FLinearColor(0.85f, 0.12f, 1.0f) : FLinearColor(1.0f, 0.08f, 0.025f), 1.35f, 0.05f);
        MuzzleFlashRemaining = 0.06f;
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
    if (Health <= 0.0f)
    {
        if (APhantomStrikeCharacter* Player = Cast<APhantomStrikeCharacter>(DamageCauser))
        {
            const int32 Value = Role == EPhantomStrikeEnemyRole::Heavy ? 250 : (Role == EPhantomStrikeEnemyRole::Rusher ? 125 : 175);
            Player->RegisterKill(Value, bHeadshot);
        }
        if (APhantomStrikeDirector* Director = StrikeDirector(this)) Director->RegisterEnemyDown();
        Destroy();
    }
    return Applied;
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
    if (DrawPhantomGameShell(this, Director, Width, Height, TEXT("PHANTOMSTRIKE"), TEXT("BLACKRIDGE COAST // FAST MILITARY FPS"), TEXT("WASD move    MOUSE look    LMB fire    RMB ADS    R reload    SHIFT sprint\nCTRL/C crouch or slide    Z prone    SPACE jump/mantle    E melee    F interact    G frag    Q tactical\n1/2/WHEEL weapons    V fire mode    B inspect    TAB scoreboard    M tactical map    ESC pause"), FLinearColor(0.12f,0.88f,1.0f))) return;
    const FVector2D Center(Width * 0.5f, Height * 0.5f);
    const float UIScale = FMath::Clamp(FMath::Min(Width / 1920.0f, Height / 1080.0f), 0.78f, 1.35f);
    const float Gap = (Player->IsAiming() ? 5.0f : 9.0f + Player->GetWeaponHeat() * 8.0f) * UIScale;
    const FLinearColor CrosshairColor(0.28f, 1.0f, 0.92f, 0.9f);
    DrawLine(Center.X - Gap - 8.0f * UIScale, Center.Y, Center.X - Gap, Center.Y, CrosshairColor, 1.7f * UIScale);
    DrawLine(Center.X + Gap, Center.Y, Center.X + Gap + 8.0f * UIScale, Center.Y, CrosshairColor, 1.7f * UIScale);
    DrawLine(Center.X, Center.Y - Gap - 8.0f * UIScale, Center.X, Center.Y - Gap, CrosshairColor, 1.7f * UIScale);
    DrawLine(Center.X, Center.Y + Gap, Center.X, Center.Y + Gap + 8.0f * UIScale, CrosshairColor, 1.7f * UIScale);

    if (Player->GetHitMarkerRemaining() > 0.0f)
    {
        const FLinearColor HitColor = Player->WasLastHitHeadshot() ? FLinearColor(1.0f, 0.25f, 0.12f) : FLinearColor::White;
        DrawLine(Center.X - 12.0f, Center.Y - 12.0f, Center.X - 5.0f, Center.Y - 5.0f, HitColor, 2.2f);
        DrawLine(Center.X + 12.0f, Center.Y - 12.0f, Center.X + 5.0f, Center.Y - 5.0f, HitColor, 2.2f);
        DrawLine(Center.X - 12.0f, Center.Y + 12.0f, Center.X - 5.0f, Center.Y + 5.0f, HitColor, 2.2f);
        DrawLine(Center.X + 12.0f, Center.Y + 12.0f, Center.X + 5.0f, Center.Y + 5.0f, HitColor, 2.2f);
    }

    DrawRect(FLinearColor(0.008f, 0.014f, 0.019f, 0.84f), 24.0f * UIScale, 22.0f * UIScale, 438.0f * UIScale, 78.0f * UIScale);
    DrawRect(FLinearColor(0.18f, 0.82f, 0.72f), 24.0f * UIScale, 22.0f * UIScale, 5.0f * UIScale, 78.0f * UIScale);
    DrawText(TEXT("PHANTOMSTRIKE"), FLinearColor::White, 42.0f * UIScale, 31.0f * UIScale, nullptr, 0.98f * UIScale);
    DrawText(TEXT("BLACKRIDGE // SECURE THE EXTRACTION LINE"), FLinearColor(0.62f, 0.82f, 0.78f), 42.0f * UIScale, 65.0f * UIScale, nullptr, 0.64f * UIScale);
    const FString WaveText = Director->IsMissionComplete()
        ? TEXT("MISSION COMPLETE // BLACKRIDGE SECURED")
        : (Director->IsExtractionOpen() ? TEXT("EXTRACTION OPEN // MOVE TO GREEN ZONE") : FString::Printf(TEXT("WAVE %d / %d    HOSTILES %02d"), Director->GetWave(), Director->GetTotalWaves(), Director->GetRemainingEnemies()));
    DrawText(WaveText, (Director->IsMissionComplete() || Director->IsExtractionOpen()) ? FLinearColor(0.2f, 1.0f, 0.55f) : FLinearColor(1.0f, 0.66f, 0.16f), Width - 470.0f * UIScale, 32.0f * UIScale, nullptr, 0.90f * UIScale);
    DrawText(FString::Printf(TEXT("SCORE %06d   K/D %02d/%02d   STREAK %d"), Player->Score, Player->Kills, Player->Deaths, Player->GetStreak()), FLinearColor::White, Width - 470.0f * UIScale, 66.0f * UIScale, nullptr, 0.68f * UIScale);
    const FString CombatState = Director->IsMissionComplete()
        ? TEXT("MISSION COMPLETE")
        : (Director->IsExtractionOpen() ? TEXT("REACH EXTRACTION") : (Director->GetIntermissionRemaining() > 0.0f ? TEXT("REINFORCEMENTS INBOUND") : TEXT("HOSTILES ACTIVE")));
    DrawText(CombatState, (Director->IsMissionComplete() || Director->IsExtractionOpen()) ? FLinearColor(0.2f, 1.0f, 0.55f) : FLinearColor(1.0f, 0.25f, 0.18f), Width * 0.5f - 95.0f * UIScale, 28.0f * UIScale, nullptr, 0.72f * UIScale);

    DrawRect(FLinearColor(0.008f, 0.02f, 0.035f, 0.9f), 26.0f * UIScale, Height - 118.0f * UIScale, 340.0f * UIScale, 88.0f * UIScale);
    DrawText(TEXT("VITALS"), FLinearColor(0.55f, 0.7f, 0.8f), 44.0f * UIScale, Height - 103.0f * UIScale, nullptr, 0.78f * UIScale);
    DrawRect(FLinearColor(0.04f, 0.09f, 0.12f), 44.0f * UIScale, Height - 76.0f * UIScale, 286.0f * UIScale, 13.0f * UIScale);
    DrawRect(FLinearColor(0.16f, 0.95f, 0.72f), 44.0f * UIScale, Height - 76.0f * UIScale, 286.0f * UIScale * Player->Health / 100.0f, 13.0f * UIScale);
    DrawRect(FLinearColor(0.04f, 0.09f, 0.12f), 44.0f * UIScale, Height - 53.0f * UIScale, 286.0f * UIScale, 8.0f * UIScale);
    DrawRect(FLinearColor(0.12f, 0.58f, 1.0f), 44.0f * UIScale, Height - 53.0f * UIScale, 286.0f * UIScale * Player->Armor / 50.0f, 8.0f * UIScale);

    DrawRect(FLinearColor(0.008f, 0.02f, 0.035f, 0.9f), Width - 330.0f * UIScale, Height - 118.0f * UIScale, 304.0f * UIScale, 88.0f * UIScale);
    DrawText(FString::Printf(TEXT("%02d"), Player->Ammo), FLinearColor::White, Width - 304.0f * UIScale, Height - 105.0f * UIScale, nullptr, 2.0f * UIScale);
    DrawText(FString::Printf(TEXT("/ %03d   %s"), Player->ReserveAmmo, Player->GetWeaponName()), FLinearColor(0.45f, 0.72f, 0.82f), Width - 220.0f * UIScale, Height - 75.0f * UIScale, nullptr, 0.78f * UIScale);
    if (Player->IsReloading())
    {
        DrawRect(FLinearColor(0.04f, 0.09f, 0.12f), Width - 304.0f * UIScale, Height - 48.0f * UIScale, 250.0f * UIScale, 7.0f * UIScale);
        DrawRect(FLinearColor(1.0f, 0.55f, 0.12f), Width - 304.0f * UIScale, Height - 48.0f * UIScale, 250.0f * UIScale * Player->GetReloadProgress(), 7.0f * UIScale);
    }
    DrawText(FString::Printf(TEXT("%s   FRAG %d   TACTICAL %d"), Player->IsSemiAuto()?TEXT("SEMI"):TEXT("AUTO"), Player->GetGrenades(), Player->GetTacticals()), FLinearColor(0.55f, 0.78f, 0.88f), Width * 0.5f - 95.0f * UIScale, Height - 34.0f * UIScale, nullptr, 0.64f * UIScale);

    // TACTICAL MINIMAP: compact, upper-left, matching the interaction spec rather than an oversized debug panel.
    const float MapSize = 220.0f * UIScale;
    const float MapX = 26.0f * UIScale;
    const float MapY = 132.0f * UIScale;
    DrawRect(FLinearColor(0.006f,0.014f,0.022f,0.82f), MapX, MapY, MapSize, MapSize);
    DrawText(TEXT("TACTICAL"), FLinearColor(0.48f,0.72f,0.82f), MapX+8.0f*UIScale, MapY+7.0f*UIScale, nullptr, 0.55f*UIScale);
    auto WorldToMap=[&](const FVector& P)->FVector2D
    {
        const float NX=FMath::Clamp((P.X+24000.0f)/48000.0f,0.0f,1.0f);
        const float NY=FMath::Clamp((P.Y+18000.0f)/36000.0f,0.0f,1.0f);
        return FVector2D(MapX+NX*MapSize,MapY+(1.0f-NY)*MapSize);
    };
    const FVector2D PlayerDot=WorldToMap(Player->GetActorLocation());
    DrawRect(FLinearColor(0.18f,1.0f,0.82f),PlayerDot.X-3.0f*UIScale,PlayerDot.Y-3.0f*UIScale,6.0f*UIScale,6.0f*UIScale);
    if (Director->IsExtractionOpen())
    {
        const FVector2D E=WorldToMap(Director->GetExtractionLocation());
        DrawRect(FLinearColor(0.14f,1.0f,0.35f),E.X-5.0f*UIScale,E.Y-5.0f*UIScale,10.0f*UIScale,10.0f*UIScale);
    }

    if (Player->IsScoreboardVisible())
    {
        const float SW=FMath::Min(Width*0.62f,900.0f*UIScale), SH=FMath::Min(Height*0.58f,560.0f*UIScale);
        const float SX=(Width-SW)*0.5f,SY=(Height-SH)*0.5f;
        DrawRect(FLinearColor(0.005f,0.012f,0.020f,0.96f),SX,SY,SW,SH);
        DrawText(TEXT("BLACKRIDGE // SCOREBOARD"),FLinearColor(0.25f,0.95f,1.0f),SX+28.0f*UIScale,SY+24.0f*UIScale,nullptr,1.05f*UIScale);
        DrawText(TEXT("PLAYER                         SCORE      K      D      STREAK"),FLinearColor(0.62f,0.72f,0.80f),SX+28.0f*UIScale,SY+82.0f*UIScale,nullptr,0.72f*UIScale);
        DrawText(FString::Printf(TEXT("PHANTOM                         %06d     %02d     %02d       %02d"),Player->Score,Player->Kills,Player->Deaths,Player->GetStreak()),FLinearColor::White,SX+28.0f*UIScale,SY+126.0f*UIScale,nullptr,0.88f*UIScale);
        DrawText(TEXT("HOLD TAB TO VIEW // RELEASE TO RETURN"),FLinearColor(0.44f,0.62f,0.72f),SX+28.0f*UIScale,SY+SH-48.0f*UIScale,nullptr,0.64f*UIScale);
    }

    if (Player->IsMapVisible())
    {
        const float MW=Width*0.72f,MH=Height*0.72f,MX=(Width-MW)*0.5f,MY=(Height-MH)*0.5f;
        DrawRect(FLinearColor(0.004f,0.010f,0.018f,0.94f),MX,MY,MW,MH);
        DrawText(TEXT("BLACKRIDGE TACTICAL MAP"),FLinearColor(0.25f,0.95f,1.0f),MX+30.0f*UIScale,MY+24.0f*UIScale,nullptr,1.0f*UIScale);
        const FVector2D P=FVector2D(MX+MW*0.5f,MY+MH*0.5f);
        DrawRect(FLinearColor(0.18f,1.0f,0.82f),P.X-5.0f,P.Y-5.0f,10.0f,10.0f);
        DrawText(TEXT("[M] CLOSE"),FLinearColor::White,MX+MW-100.0f*UIScale,MY+MH-42.0f*UIScale,nullptr,0.7f*UIScale);
    }

    if (Player->GetDamageFlash() > 0.0f)
    {
        const float Alpha = Player->GetDamageFlash() * 0.18f;
        DrawRect(FLinearColor(1.0f, 0.0f, 0.04f, Alpha), 0.0f, 0.0f, Width, 18.0f);
        DrawRect(FLinearColor(1.0f, 0.0f, 0.04f, Alpha), 0.0f, Height - 18.0f, Width, 18.0f);
    }
}

APhantomStrikeDirector::APhantomStrikeDirector()
{
    PrimaryActorTick.bCanEverTick = true;
}

void APhantomStrikeDirector::BeginPlay()
{
    Super::BeginPlay();
    BuildCommandComplex();
    Wave = 1;
    SpawnWave();
}

void APhantomStrikeDirector::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
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
        bExtractionOpen = true;
        SpawnPointLight(TEXT("ExtractionBeacon"), ExtractionLocation + FVector(0.0f, 0.0f, 115.0f), FLinearColor(0.12f, 1.0f, 0.48f), 18000.0f, 950.0f, true);
        SpawnShape(EPhantomPrimitive::Cylinder, TEXT("ExtractionZone"), ExtractionLocation + FVector(0.0f, 0.0f, 6.0f), FVector(380.0f, 380.0f, 12.0f), FLinearColor(0.08f, 0.8f, 0.36f), FRotator::ZeroRotator, false);
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
    for (int32 Index = 0; Index < Count; ++Index)
    {
        const int32 Lane = Index % 3;
        const int32 Rank = Index / 3;
        const FVector SpawnLocation(
            -5100.0f + Rank * 720.0f + FMath::FRandRange(-120.0f,120.0f),
            -1500.0f + Lane * 1500.0f + FMath::FRandRange(-120.0f,120.0f),
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

void APhantomStrikeDirector::BuildCommandComplex()
{
    // CANONICAL BLACKRIDGE COAST: 480m x 360m. Dense, authored combat district; never a kilometer-scale walking map.
    SpawnSun(3.35f, FRotator(-42.0f,-28.0f,0.0f), FLinearColor(1.0f,0.83f,0.68f));
    SetWorldMood(FLinearColor(0.09f,0.13f,0.17f),0.0022f,FLinearColor(0.28f,0.36f,0.46f));

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
        // V10 persistent .umap already contains the entire road/building/cover composition. Keep
        // runtime work to lighting + collision so we do not double-spawn hundreds of static actors.
        SpawnPointLight(TEXT("V9CommandCoreLight"),FVector(9000,0,360),FLinearColor(0.08f,0.88f,1.0f),7000.0f,700.0f,true);
        SpawnPointLight(TEXT("V9MarinaWarmLight"),FVector(14500,-10000,420),FLinearColor(1.0f,0.48f,0.22f),4200.0f,520.0f,false);
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
}
