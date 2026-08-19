#include "Legends/PhantomLegendsDirector.h"
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
#include "EngineUtils.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "GameFramework/PlayerController.h"
#include "GameFramework/SpringArmComponent.h"
#include "InputCoreTypes.h"
#include "Kismet/GameplayStatics.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"

namespace
{
    constexpr TCHAR LegendsSaveSlot[] = TEXT("phantomlegends.profile");

    APhantomLegendsDirector* LegendsDirector(const UObject* Context)
    {
        if (!Context || !Context->GetWorld()) return nullptr;
        for (TActorIterator<APhantomLegendsDirector> It(Context->GetWorld()); It; ++It) return *It;
        return nullptr;
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


    bool ConfigureLegendsProductionSkeletal(
        APhantomLegendsUnit* Unit,
        const TCHAR* MeshPath,
        const TCHAR* IdleAnimPath,
        float TargetHeightCm,
        float YawOffset
    )
    {
        if (!Unit || !Unit->GetCapsuleComponent()) return false;
        return PhantomModularCharacter::Configure(
            Unit,
            Unit->GetMesh(),
            Unit->GetCapsuleComponent(),
            MeshPath,
            IdleAnimPath,
            TargetHeightCm,
            -Unit->GetCapsuleComponent()->GetUnscaledCapsuleHalfHeight(),
            YawOffset
        );
    }

    const TCHAR* ResourceName(EPhantomLegendsResource Resource)
    {
        switch (Resource)
        {
            case EPhantomLegendsResource::Gold: return TEXT("GOLD");
            case EPhantomLegendsResource::Wood: return TEXT("WOOD");
            case EPhantomLegendsResource::Stone: return TEXT("STONE");
            case EPhantomLegendsResource::Shard: return TEXT("RIFT SHARD");
        }
        return TEXT("RESOURCE");
    }

    const TCHAR* RoleName(EPhantomLegendsRole Role)
    {
        switch (Role)
        {
            case EPhantomLegendsRole::Worker: return TEXT("WORKER");
            case EPhantomLegendsRole::Guard: return TEXT("GUARD");
            case EPhantomLegendsRole::Ranger: return TEXT("RANGER");
            case EPhantomLegendsRole::Brute: return TEXT("BRUTE");
            case EPhantomLegendsRole::Raider: return TEXT("RAIDER");
        }
        return TEXT("UNIT");
    }
}

APhantomLegendsResourceNode::APhantomLegendsResourceNode()
{
    PrimaryActorTick.bCanEverTick = false;
    Root = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
    SetRootComponent(Root);
    BaseMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("ResourceBase"));
    BaseMesh->SetupAttachment(Root);
    BaseMesh->SetCollisionEnabled(ECollisionEnabled::QueryOnly);
    BaseMesh->SetCollisionResponseToAllChannels(ECR_Ignore);
    BaseMesh->SetCollisionResponseToChannel(ECC_Visibility, ECR_Block);
    DetailMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("ResourceDetail"));
    DetailMesh->SetupAttachment(Root);
    DetailMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
}

void APhantomLegendsResourceNode::Configure(EPhantomLegendsResource NewType, int32 NewAmount)
{
    ResourceType = NewType;
    Remaining = NewAmount;
    UStaticMesh* ResourceVisual = nullptr;

    switch (ResourceType)
    {
        case EPhantomLegendsResource::Wood:
            // Use the RTS baseline forest cluster with its authored wood/foliage materials. The
            // old generated tree had no material slots and read as a translucent egg at command zoom.
            ResourceVisual = LoadObject<UStaticMesh>(nullptr, TEXT("/Game/Phantom/UnityHarvest/Legends/character/U_Legends_0009_PineTrees.U_Legends_0009_PineTrees"));
            if (!ResourceVisual) ResourceVisual = LoadObject<UStaticMesh>(nullptr, TEXT("/Game/Phantom/Curated/Cube/SM_Cube_Tree_A.SM_Cube_Tree_A"));
            break;
        case EPhantomLegendsResource::Stone:
            ResourceVisual = LoadObject<UStaticMesh>(nullptr, TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Rock.SM_CC0_Rock"));
            if (!ResourceVisual) ResourceVisual = LoadObject<UStaticMesh>(nullptr, TEXT("/Game/Phantom/UnityHarvest/Legends/character/U_Legends_0010_Rocks.U_Legends_0010_Rocks"));
            break;
        case EPhantomLegendsResource::Gold:
            ResourceVisual = LoadObject<UStaticMesh>(nullptr, TEXT("/Game/Phantom/Curated/Legends/SM_Legends_Mine.SM_Legends_Mine"));
            if (!ResourceVisual) ResourceVisual = LoadObject<UStaticMesh>(nullptr, TEXT("/Game/Phantom/Generated/Legends/V9/Economy/SM_V9_Mine.SM_V9_Mine"));
            break;
        case EPhantomLegendsResource::Shard:
            ResourceVisual = LoadObject<UStaticMesh>(nullptr, TEXT("/Game/Phantom/Generated/Cubetown/Dream/SM_CubeDreamCrystalCluster_A.SM_CubeDreamCrystalCluster_A"));
            if (!ResourceVisual) ResourceVisual = LoadObject<UStaticMesh>(nullptr, TEXT("/Game/Phantom/Generated/Legends/V9/Economy/SM_V9_CrystalNode.SM_V9_CrystalNode"));
            if (!ResourceVisual) ResourceVisual = LoadObject<UStaticMesh>(nullptr, TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Rock.SM_CC0_Rock"));
            break;
    }

    DetailMesh->SetStaticMesh(nullptr);
    DetailMesh->SetVisibility(false, true);
    DetailMesh->SetHiddenInGame(true, true);
    if (!ResourceVisual)
    {
        UE_LOG(LogTemp, Error, TEXT("Missing required authored visual for Phantom Legends resource %s"), ResourceName(ResourceType));
        BaseMesh->SetStaticMesh(nullptr);
        BaseMesh->SetVisibility(false, true);
        Tags.Add(FName(*FString::Printf(TEXT("Resource.%s"), ResourceName(ResourceType))));
        return;
    }

    BaseMesh->SetStaticMesh(ResourceVisual);
    const FLinearColor ResourceColor = ResourceType == EPhantomLegendsResource::Wood
        ? FLinearColor(0.10f, 0.42f, 0.16f)
        : (ResourceType == EPhantomLegendsResource::Stone
            ? FLinearColor(0.34f, 0.38f, 0.42f)
            : (ResourceType == EPhantomLegendsResource::Gold
                ? FLinearColor(0.92f, 0.55f, 0.08f)
                : FLinearColor(0.10f, 0.78f, 0.90f)));
    ApplyColor(BaseMesh, ResourceColor);
    const FBoxSphereBounds Bounds = ResourceVisual->GetBounds();
    const FVector FullSize = Bounds.BoxExtent * 2.0f;
    const float RawDimension = ResourceType == EPhantomLegendsResource::Wood
        ? FMath::Max(1.0f, FullSize.Z)
        : FMath::Max(1.0f, FMath::Max3(FullSize.X, FullSize.Y, FullSize.Z));
    const float TargetSize = ResourceType == EPhantomLegendsResource::Wood ? 1150.0f
        : (ResourceType == EPhantomLegendsResource::Gold ? 760.0f
        : (ResourceType == EPhantomLegendsResource::Shard ? 640.0f : 480.0f));
    const float FitScale = FMath::Clamp(TargetSize / RawDimension, 0.01f, 80.0f);
    const float LocalBottom = (Bounds.Origin.Z - Bounds.BoxExtent.Z) * FitScale;
    BaseMesh->SetRelativeLocation(FVector(0.0f, 0.0f, -LocalBottom));
    BaseMesh->SetRelativeRotation(FRotator::ZeroRotator);
    BaseMesh->SetRelativeScale3D(FVector(FitScale));
    BaseMesh->SetVisibility(true, true);
    BaseMesh->SetHiddenInGame(false, true);
    Tags.Add(FName(*FString::Printf(TEXT("Resource.%s"), ResourceName(ResourceType))));
}

int32 APhantomLegendsResourceNode::Harvest(int32 Requested)
{
    const int32 Yield = FMath::Clamp(Requested, 0, Remaining);
    Remaining -= Yield;
    const float Ratio = FMath::Clamp(Remaining / 500.0f, 0.25f, 1.0f);
    SetActorScale3D(FVector(Ratio));
    if (Remaining <= 0) Destroy();
    return Yield;
}

APhantomLegendsStructure::APhantomLegendsStructure()
{
    PrimaryActorTick.bCanEverTick = true;
    Root = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
    SetRootComponent(Root);
    UStaticMesh* Cube = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cube.Cube"));
    UStaticMesh* Cylinder = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
    UStaticMesh* Cone = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cone.Cone"));
    UStaticMesh* Sphere = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Sphere.Sphere"));

    BaseMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("StructureBase"));
    BaseMesh->SetupAttachment(Root);
    BaseMesh->SetStaticMesh(Cube);
    BaseMesh->SetCollisionEnabled(ECollisionEnabled::QueryAndPhysics);
    BaseMesh->SetCollisionResponseToChannel(ECC_Visibility, ECR_Block);
    CrownMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Crown"));
    CrownMesh->SetupAttachment(Root);
    CrownMesh->SetStaticMesh(Cone);
    CrownMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    LeftSpire = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("LeftSpire"));
    LeftSpire->SetupAttachment(Root);
    LeftSpire->SetStaticMesh(Cylinder);
    LeftSpire->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    RightSpire = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("RightSpire"));
    RightSpire->SetupAttachment(Root);
    RightSpire->SetStaticMesh(Cylinder);
    RightSpire->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    CoreMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Core"));
    CoreMesh->SetupAttachment(Root);
    CoreMesh->SetStaticMesh(Sphere);
    CoreMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);

    VisualModel = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("AuthoredStructureVisual"));
    VisualModel->SetupAttachment(Root);
    VisualModel->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    VisualModel->SetVisibility(false);

    HealthBack = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("HealthBack"));
    HealthBack->SetupAttachment(Root);
    HealthBack->SetStaticMesh(Cube);
    HealthBack->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    HealthBack->SetVisibility(false);
    HealthFill = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("HealthFill"));
    HealthFill->SetupAttachment(Root);
    HealthFill->SetStaticMesh(Cube);
    HealthFill->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    HealthFill->SetVisibility(false);
}

void APhantomLegendsStructure::Configure(
    EPhantomLegendsStructureType NewType,
    EPhantomLegendsFaction NewFaction,
    int32 NewLevel
)
{
    StructureType = NewType;
    Faction = NewFaction;
    Level = FMath::Max(1, NewLevel);
    const bool bLegion = Faction == EPhantomLegendsFaction::Legion;
    const FLinearColor Main = bLegion ? FLinearColor(0.1f, 0.42f, 0.7f) : FLinearColor(0.46f, 0.035f, 0.18f);
    const FLinearColor Accent = bLegion ? FLinearColor(0.18f, 0.9f, 1.0f) : FLinearColor(0.82f, 0.08f, 1.0f);

    const TCHAR* ExternalStructurePath = StructureType == EPhantomLegendsStructureType::Stronghold
        ? (bLegion ? TEXT("/Game/Phantom/Generated/Legends/SM_LegionKeep.SM_LegionKeep")
                   : TEXT("/Game/Phantom/Generated/Legends/SM_RiftKeep.SM_RiftKeep"))
        : (StructureType == EPhantomLegendsStructureType::DefenseTower
            ? (bLegion ? TEXT("/Game/Phantom/Generated/Legends/V9/Architecture/SM_V9_BlueTower.SM_V9_BlueTower")
                       : TEXT("/Game/Phantom/Generated/Legends/V9/Architecture/SM_V9_RedTower.SM_V9_RedTower"))
            : (bLegion ? TEXT("/Game/Phantom/Generated/Legends/V9/Architecture/SM_V9_BlueGate.SM_V9_BlueGate")
                       : TEXT("/Game/Phantom/Generated/Legends/V9/Architecture/SM_V9_RedGate.SM_V9_RedGate")));
    UStaticMesh* ExternalStructure = LoadObject<UStaticMesh>(nullptr, ExternalStructurePath);
    if (!ExternalStructure && StructureType == EPhantomLegendsStructureType::Stronghold)
        ExternalStructure = LoadObject<UStaticMesh>(nullptr, TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_House_A.SM_CC0_House_A"));
    const bool bUseExternalVisual = ExternalStructure != nullptr;
    VisualModel->SetStaticMesh(ExternalStructure);
    VisualModel->SetVisibility(bUseExternalVisual);
    if (bUseExternalVisual)
    {
        VisualModel->SetRelativeRotation(FRotator::ZeroRotator);
        const FBoxSphereBounds VisualBounds = ExternalStructure->GetBounds();
        const float RawHeight = FMath::Max(1.0f, VisualBounds.BoxExtent.Z * 2.0f);
        const float TargetHeight = StructureType == EPhantomLegendsStructureType::Stronghold ? 1550.0f
            : (StructureType == EPhantomLegendsStructureType::DefenseTower ? 900.0f : 1350.0f);
        const float VisualScale = FMath::Clamp(TargetHeight / RawHeight, 0.02f, 40.0f);
        const float LocalBottom = (VisualBounds.Origin.Z - VisualBounds.BoxExtent.Z) * VisualScale;
        VisualModel->SetRelativeLocation(FVector(0.0f, 0.0f, -LocalBottom));
        VisualModel->SetRelativeScale3D(FVector(VisualScale));
    }

    if (StructureType == EPhantomLegendsStructureType::Stronghold)
    {
        MaxHealth = 1800.0f + Level * 420.0f;
        if (UStaticMesh* KeepMesh = LoadObject<UStaticMesh>(nullptr, TEXT("/Game/Phantom/Generated/Legends/SM_LegionKeep.SM_LegionKeep")))
        {
            BaseMesh->SetStaticMesh(KeepMesh);
            BaseMesh->SetRelativeLocation(FVector::ZeroVector);
            BaseMesh->SetRelativeScale3D(FVector(1.0f + Level * 0.035f));
            CrownMesh->SetVisibility(false);
            LeftSpire->SetVisibility(false);
            RightSpire->SetVisibility(false);
            CoreMesh->SetRelativeLocation(FVector(0.0f, -245.0f, 365.0f));
            CoreMesh->SetRelativeScale3D(FVector(0.58f));
        }
        else
        {
            BaseMesh->SetRelativeLocation(FVector(0.0f, 0.0f, 260.0f));
        BaseMesh->SetRelativeScale3D(FVector(4.8f, 4.2f, 5.2f + Level * 0.35f));
        CrownMesh->SetRelativeLocation(FVector(0.0f, 0.0f, 650.0f + Level * 24.0f));
        CrownMesh->SetRelativeScale3D(FVector(2.4f, 2.4f, 2.9f));
        LeftSpire->SetRelativeLocation(FVector(-275.0f, 0.0f, 430.0f));
        RightSpire->SetRelativeLocation(FVector(275.0f, 0.0f, 430.0f));
        LeftSpire->SetRelativeScale3D(FVector(0.78f, 0.78f, 4.5f));
        RightSpire->SetRelativeScale3D(FVector(0.78f, 0.78f, 4.5f));
            CoreMesh->SetRelativeLocation(FVector(0.0f, -230.0f, 420.0f));
            CoreMesh->SetRelativeScale3D(FVector(0.72f));
        }
    }
    else if (StructureType == EPhantomLegendsStructureType::RiftGate)
    {
        MaxHealth = 1300.0f + Level * 260.0f;
        if (UStaticMesh* RiftKeepMesh = LoadObject<UStaticMesh>(nullptr, TEXT("/Game/Phantom/Generated/Legends/SM_RiftKeep.SM_RiftKeep")))
        {
            BaseMesh->SetStaticMesh(RiftKeepMesh);
            BaseMesh->SetRelativeLocation(FVector::ZeroVector);
            BaseMesh->SetRelativeScale3D(FVector(1.08f));
            CrownMesh->SetVisibility(false);
            LeftSpire->SetVisibility(false);
            RightSpire->SetVisibility(false);
            CoreMesh->SetRelativeLocation(FVector(0.0f, -210.0f, 300.0f));
            CoreMesh->SetRelativeScale3D(FVector(0.92f, 0.34f, 1.35f));
        }
        else
        {
            BaseMesh->SetRelativeLocation(FVector(0.0f, 0.0f, 180.0f));
        BaseMesh->SetRelativeScale3D(FVector(3.8f, 2.8f, 3.6f));
        CrownMesh->SetRelativeLocation(FVector(0.0f, 0.0f, 480.0f));
        CrownMesh->SetRelativeScale3D(FVector(2.1f, 2.1f, 2.6f));
        LeftSpire->SetRelativeLocation(FVector(-205.0f, 0.0f, 315.0f));
        RightSpire->SetRelativeLocation(FVector(205.0f, 0.0f, 315.0f));
        LeftSpire->SetRelativeScale3D(FVector(0.65f, 0.65f, 3.5f));
        RightSpire->SetRelativeScale3D(FVector(0.65f, 0.65f, 3.5f));
            CoreMesh->SetRelativeLocation(FVector(0.0f, -155.0f, 285.0f));
            CoreMesh->SetRelativeScale3D(FVector(1.1f, 0.35f, 1.5f));
        }
    }
    else
    {
        MaxHealth = 520.0f + Level * 115.0f;
        BaseMesh->SetRelativeLocation(FVector(0.0f, 0.0f, 150.0f));
        BaseMesh->SetRelativeScale3D(FVector(1.45f, 1.45f, 3.0f));
        CrownMesh->SetRelativeLocation(FVector(0.0f, 0.0f, 355.0f));
        CrownMesh->SetRelativeScale3D(FVector(1.2f, 1.2f, 1.45f));
        LeftSpire->SetVisibility(false);
        RightSpire->SetVisibility(false);
        CoreMesh->SetRelativeLocation(FVector(0.0f, -88.0f, 280.0f));
        CoreMesh->SetRelativeScale3D(FVector(0.42f));
    }
    if (bUseExternalVisual)
    {
        BaseMesh->SetVisibility(false);
        CrownMesh->SetVisibility(false);
        LeftSpire->SetVisibility(false);
        RightSpire->SetVisibility(false);
        CoreMesh->SetVisibility(false);
    }
    Health = MaxHealth;
    HealthBack->SetRelativeLocation(FVector(0.0f, -260.0f, StructureType == EPhantomLegendsStructureType::DefenseTower ? 470.0f : 760.0f));
    HealthBack->SetRelativeScale3D(FVector(2.1f, 0.08f, 0.055f));
    ApplyColor(BaseMesh, Main * 0.55f);
    ApplyColor(CrownMesh, Main);
    ApplyColor(LeftSpire, Main * 0.72f);
    ApplyColor(RightSpire, Main * 0.72f);
    ApplyColor(CoreMesh, Accent);
    ApplyColor(HealthBack, FLinearColor(0.02f, 0.025f, 0.035f));
    ApplyColor(HealthFill, bLegion ? FLinearColor(0.15f, 0.95f, 0.78f) : FLinearColor(1.0f, 0.12f, 0.22f));
    RefreshHealthBar();
}

void APhantomLegendsStructure::RefreshHealthBar()
{
    const float Ratio = MaxHealth > 0.0f ? FMath::Clamp(Health / MaxHealth, 0.0f, 1.0f) : 0.0f;
    const float Z = StructureType == EPhantomLegendsStructureType::DefenseTower ? 470.0f : 760.0f;
    HealthFill->SetRelativeScale3D(FVector(2.0f * Ratio, 0.065f, 0.038f));
    HealthFill->SetRelativeLocation(FVector(-100.0f * (1.0f - Ratio), -268.0f, Z));
    UpdateHealthBarVisibility();
}

void APhantomLegendsStructure::UpdateHealthBarVisibility()
{
    const bool bShowHealth = Health > 0.0f && Health < MaxHealth;
    HealthBack->SetVisibility(bShowHealth, true);
    HealthFill->SetVisibility(bShowHealth, true);
    HealthBack->SetHiddenInGame(!bShowHealth, true);
    HealthFill->SetHiddenInGame(!bShowHealth, true);
}

float APhantomLegendsStructure::GetCombatRadius() const
{
    switch (StructureType)
    {
        case EPhantomLegendsStructureType::Stronghold: return 430.0f;
        case EPhantomLegendsStructureType::RiftGate: return 350.0f;
        case EPhantomLegendsStructureType::DefenseTower: return 135.0f;
    }
    return 120.0f;
}

void APhantomLegendsStructure::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    AttackRemaining = FMath::Max(0.0f, AttackRemaining - DeltaSeconds);
    CoreMesh->AddLocalRotation(FRotator(0.0f, DeltaSeconds * 42.0f, 0.0f));
    if (StructureType != EPhantomLegendsStructureType::DefenseTower || AttackRemaining > 0.0f) return;
    APhantomLegendsUnit* Nearest = nullptr;
    float NearestDistance = TNumericLimits<float>::Max();
    for (TActorIterator<APhantomLegendsUnit> It(GetWorld()); It; ++It)
    {
        if ((It->IsPlayerUnit() && Faction == EPhantomLegendsFaction::Legion)
            || (!It->IsPlayerUnit() && Faction == EPhantomLegendsFaction::Rift)) continue;
        const float Distance = FVector::DistSquared2D(GetActorLocation(), It->GetActorLocation());
        if (Distance < FMath::Square(980.0f) && Distance < NearestDistance)
        {
            Nearest = *It;
            NearestDistance = Distance;
        }
    }
    if (Nearest)
    {
        const FVector Muzzle = GetActorLocation() + FVector(0.0f, 0.0f, 330.0f);
        APhantomLegendsProjectile* Projectile = GetWorld()->SpawnActor<APhantomLegendsProjectile>(Muzzle, FRotator::ZeroRotator);
        if (Projectile) Projectile->Configure(this, Nearest, Faction, 25.0f + Level * 7.0f);
        AttackRemaining = 0.72f;
    }
}

float APhantomLegendsStructure::TakeDamage(
    float DamageAmount,
    FDamageEvent const& DamageEvent,
    AController* EventInstigator,
    AActor* DamageCauser
)
{
    if (Health <= 0.0f) return 0.0f;
    if (const APhantomLegendsUnit* Source = Cast<APhantomLegendsUnit>(DamageCauser))
    {
        if ((Source->IsPlayerUnit() && Faction == EPhantomLegendsFaction::Legion)
            || (!Source->IsPlayerUnit() && Faction == EPhantomLegendsFaction::Rift)) return 0.0f;
    }
    Health = FMath::Max(0.0f, Health - DamageAmount);
    RefreshHealthBar();
    if (Health <= 0.0f)
    {
        if (APhantomLegendsDirector* Director = LegendsDirector(this)) Director->NotifyStructureDestroyed(Faction, StructureType);
        if (StructureType == EPhantomLegendsStructureType::DefenseTower) Destroy();
    }
    return DamageAmount;
}

APhantomLegendsProjectile::APhantomLegendsProjectile()
{
    PrimaryActorTick.bCanEverTick = true;
    ProjectileMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("RiftBolt"));
    SetRootComponent(ProjectileMesh);
    ProjectileMesh->SetStaticMesh(LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Sphere.Sphere")));
    ProjectileMesh->SetRelativeScale3D(FVector(0.12f));
    ProjectileMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    ProjectileMesh->SetCastShadow(false);
}

void APhantomLegendsProjectile::Configure(AActor* NewSource, AActor* NewTarget, EPhantomLegendsFaction NewFaction, float NewDamage)
{
    Source = NewSource;
    Target = NewTarget;
    Faction = NewFaction;
    Damage = NewDamage;
    StartLocation = GetActorLocation();
    const float Distance = NewTarget ? (StartLocation - NewTarget->GetActorLocation()).Size2D() : 500.0f;
    Duration = FMath::Clamp(Distance / 1750.0f, 0.18f, 0.62f);
    ApplyColor(ProjectileMesh, Faction == EPhantomLegendsFaction::Legion
        ? FLinearColor(0.16f, 0.82f, 1.0f)
        : FLinearColor(1.0f, 0.12f, 0.62f));
}

void APhantomLegendsProjectile::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    if (!Target.IsValid())
    {
        Destroy();
        return;
    }
    Elapsed += DeltaSeconds;
    const float Alpha = FMath::Clamp(Elapsed / Duration, 0.0f, 1.0f);
    const FVector End = Target->GetActorLocation() + FVector(0.0f, 0.0f, 76.0f);
    FVector Next = FMath::Lerp(StartLocation, End, Alpha);
    Next.Z += FMath::Sin(Alpha * PI) * 72.0f;
    SetActorLocation(Next);
    const float Pulse = 0.10f + FMath::Sin(Elapsed * 34.0f) * 0.025f;
    ProjectileMesh->SetRelativeScale3D(FVector(Pulse));
    if (Alpha >= 1.0f)
    {
        UGameplayStatics::ApplyDamage(Target.Get(), Damage, nullptr, Source.Get(), UDamageType::StaticClass());
        Destroy();
    }
}

APhantomLegendsUnit::APhantomLegendsUnit()
{
    PrimaryActorTick.bCanEverTick = true;
    AutoPossessAI = EAutoPossessAI::PlacedInWorldOrSpawned;
    GetCapsuleComponent()->SetCapsuleRadius(36.0f);
    GetCapsuleComponent()->SetCapsuleHalfHeight(72.0f);
    GetCapsuleComponent()->SetCollisionResponseToChannel(ECC_Visibility, ECR_Block);
    GetMesh()->SetVisibility(false, true);
    UStaticMesh* Cylinder = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
    UStaticMesh* Sphere = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Sphere.Sphere"));
    UStaticMesh* Cube = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cube.Cube"));
    UStaticMesh* Cone = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cone.Cone"));

    BodyMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Body"));
    BodyMesh->SetupAttachment(GetCapsuleComponent());
    BodyMesh->SetStaticMesh(Cylinder);
    BodyMesh->SetRelativeScale3D(FVector(0.42f, 0.58f, 0.92f));
    BodyMesh->SetRelativeLocation(FVector(0.0f, 0.0f, -22.0f));
    BodyMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    HeadMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Head"));
    HeadMesh->SetupAttachment(GetCapsuleComponent());
    HeadMesh->SetStaticMesh(Sphere);
    HeadMesh->SetRelativeScale3D(FVector(0.3f));
    HeadMesh->SetRelativeLocation(FVector(0.0f, 0.0f, 38.0f));
    HeadMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    WeaponMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Weapon"));
    WeaponMesh->SetupAttachment(GetCapsuleComponent());
    WeaponMesh->SetStaticMesh(Cube);
    WeaponMesh->SetRelativeLocation(FVector(32.0f, 0.0f, -2.0f));
    WeaponMesh->SetRelativeRotation(FRotator(0.0f, 0.0f, -32.0f));
    WeaponMesh->SetRelativeScale3D(FVector(0.11f, 0.09f, 0.72f));
    WeaponMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    ShieldMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Shield"));
    ShieldMesh->SetupAttachment(GetCapsuleComponent());
    ShieldMesh->SetStaticMesh(Cylinder);
    ShieldMesh->SetRelativeLocation(FVector(-28.0f, -6.0f, -4.0f));
    ShieldMesh->SetRelativeRotation(FRotator(90.0f, 0.0f, 0.0f));
    ShieldMesh->SetRelativeScale3D(FVector(0.38f, 0.38f, 0.08f));
    ShieldMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);

    ChestMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("ChestArmor"));
    ChestMesh->SetupAttachment(GetCapsuleComponent());
    ChestMesh->SetStaticMesh(Cube);
    ChestMesh->SetRelativeLocation(FVector(0.0f, -2.0f, -8.0f));
    ChestMesh->SetRelativeScale3D(FVector(0.36f, 0.44f, 0.22f));
    ChestMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);

    LeftShoulder = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("LeftShoulder"));
    LeftShoulder->SetupAttachment(GetCapsuleComponent());
    LeftShoulder->SetStaticMesh(Sphere);
    LeftShoulder->SetRelativeLocation(FVector(0.0f, -31.0f, 5.0f));
    LeftShoulder->SetRelativeScale3D(FVector(0.18f));
    LeftShoulder->SetCollisionEnabled(ECollisionEnabled::NoCollision);

    RightShoulder = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("RightShoulder"));
    RightShoulder->SetupAttachment(GetCapsuleComponent());
    RightShoulder->SetStaticMesh(Sphere);
    RightShoulder->SetRelativeLocation(FVector(0.0f, 31.0f, 5.0f));
    RightShoulder->SetRelativeScale3D(FVector(0.18f));
    RightShoulder->SetCollisionEnabled(ECollisionEnabled::NoCollision);

    LeftArm = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("LeftArm"));
    LeftArm->SetupAttachment(GetCapsuleComponent());
    LeftArm->SetStaticMesh(Cylinder);
    LeftArm->SetRelativeLocation(FVector(0.0f, -30.0f, -20.0f));
    LeftArm->SetRelativeScale3D(FVector(0.12f, 0.12f, 0.42f));
    LeftArm->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    RightArm = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("RightArm"));
    RightArm->SetupAttachment(GetCapsuleComponent());
    RightArm->SetStaticMesh(Cylinder);
    RightArm->SetRelativeLocation(FVector(0.0f, 30.0f, -20.0f));
    RightArm->SetRelativeScale3D(FVector(0.12f, 0.12f, 0.42f));
    RightArm->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    LeftLeg = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("LeftLeg"));
    LeftLeg->SetupAttachment(GetCapsuleComponent());
    LeftLeg->SetStaticMesh(Cylinder);
    LeftLeg->SetRelativeLocation(FVector(0.0f, -13.0f, -57.0f));
    LeftLeg->SetRelativeScale3D(FVector(0.14f, 0.14f, 0.34f));
    LeftLeg->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    RightLeg = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("RightLeg"));
    RightLeg->SetupAttachment(GetCapsuleComponent());
    RightLeg->SetStaticMesh(Cylinder);
    RightLeg->SetRelativeLocation(FVector(0.0f, 13.0f, -57.0f));
    RightLeg->SetRelativeScale3D(FVector(0.14f, 0.14f, 0.34f));
    RightLeg->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    HelmetMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Helmet"));
    HelmetMesh->SetupAttachment(GetCapsuleComponent());
    HelmetMesh->SetStaticMesh(Sphere);
    HelmetMesh->SetRelativeLocation(FVector(0.0f, 0.0f, 48.0f));
    HelmetMesh->SetRelativeScale3D(FVector(0.33f, 0.33f, 0.18f));
    HelmetMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);

    CrestMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("RoleCrest"));
    CrestMesh->SetupAttachment(GetCapsuleComponent());
    CrestMesh->SetStaticMesh(Cone);
    CrestMesh->SetRelativeLocation(FVector(-2.0f, 0.0f, 64.0f));
    CrestMesh->SetRelativeScale3D(FVector(0.14f, 0.14f, 0.28f));
    CrestMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);

    VisualModel = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("AuthoredUnitVisual"));
    VisualModel->SetupAttachment(GetCapsuleComponent());
    VisualModel->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    VisualModel->SetVisibility(false);

    SelectionRing = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("SelectionRing"));
    SelectionRing->SetupAttachment(GetCapsuleComponent());
    SelectionRing->SetStaticMesh(Cylinder);
    SelectionRing->SetRelativeLocation(FVector(0.0f, 0.0f, -70.0f));
    SelectionRing->SetRelativeScale3D(FVector(1.55f, 1.55f, 0.055f));
    SelectionRing->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    SelectionRing->SetVisibility(false);
    HealthBack = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("HealthBack"));
    HealthBack->SetupAttachment(GetCapsuleComponent());
    HealthBack->SetStaticMesh(Cube);
    HealthBack->SetRelativeLocation(FVector(0.0f, -46.0f, 86.0f));
    HealthBack->SetRelativeScale3D(FVector(0.68f, 0.06f, 0.035f));
    HealthBack->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    HealthBack->SetVisibility(false);
    HealthFill = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("HealthFill"));
    HealthFill->SetupAttachment(GetCapsuleComponent());
    HealthFill->SetStaticMesh(Cube);
    HealthFill->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    HealthFill->SetVisibility(false);
    GetCharacterMovement()->MaxWalkSpeed = 390.0f;
    GetCharacterMovement()->MaxAcceleration = 2200.0f;
    GetCharacterMovement()->BrakingDecelerationWalking = 1800.0f;
    GetCharacterMovement()->bOrientRotationToMovement = true;
    GetCharacterMovement()->bRunPhysicsWithNoController = true;
}

void APhantomLegendsUnit::Configure(bool bNewWorker, const FLinearColor& Color)
{
    ConfigureRole(
        bNewWorker ? EPhantomLegendsRole::Worker : EPhantomLegendsRole::Guard,
        EPhantomLegendsFaction::Legion,
        1
    );
    ApplyColor(BodyMesh, Color);
}

void APhantomLegendsUnit::ConfigureRole(EPhantomLegendsRole NewRole, EPhantomLegendsFaction NewFaction, int32 NewTier)
{
    Role = NewRole;
    Faction = NewFaction;
    bWorker = Role == EPhantomLegendsRole::Worker;
    const bool bLegion = Faction == EPhantomLegendsFaction::Legion;
    const FLinearColor Main = bLegion ? FLinearColor(0.12f, 0.58f, 0.88f) : FLinearColor(0.62f, 0.04f, 0.16f);
    const FLinearColor Accent = bLegion ? FLinearColor(0.55f, 0.18f, 0.95f) : FLinearColor(0.86f, 0.08f, 0.92f);
    MaxHealth = bWorker ? 90.0f : (Role == EPhantomLegendsRole::Brute ? 280.0f : (Role == EPhantomLegendsRole::Raider ? 125.0f : 150.0f));
    MaxHealth += FMath::Max(0, NewTier - 1) * (Role == EPhantomLegendsRole::Brute ? 34.0f : 14.0f);
    Health = MaxHealth;
    Damage = bWorker ? 7.0f : (Role == EPhantomLegendsRole::Brute ? 28.0f : (Role == EPhantomLegendsRole::Ranger ? 20.0f : 17.0f));
    Damage += NewTier * 1.8f;
    AttackRange = Role == EPhantomLegendsRole::Ranger ? 560.0f : 130.0f;
    AttackInterval = Role == EPhantomLegendsRole::Ranger ? 1.15f : (Role == EPhantomLegendsRole::Brute ? 1.05f : 0.72f);
    GetCharacterMovement()->MaxWalkSpeed = bWorker ? 420.0f : (Role == EPhantomLegendsRole::Raider ? 500.0f : (Role == EPhantomLegendsRole::Brute ? 285.0f : 390.0f));

    const TCHAR* SkelPath = nullptr;
    const TCHAR* AnimPath = nullptr;
    if (bLegion)
    {
        if (Role == EPhantomLegendsRole::Brute)
        {
            SkelPath = TEXT("/Game/Phantom/Characters/Production/SK_Barbarian.SK_Barbarian");
            AnimPath = TEXT("/Game/Phantom/Characters/Production/Animations/A_Barbarian_Idle.A_Barbarian_Idle");
        }
        else if (Role == EPhantomLegendsRole::Ranger || Role == EPhantomLegendsRole::Raider || bWorker)
        {
            SkelPath = TEXT("/Game/Phantom/Characters/Production/SK_Rogue.SK_Rogue");
            AnimPath = TEXT("/Game/Phantom/Characters/Production/Animations/A_Rogue_Idle.A_Rogue_Idle");
        }
        else
        {
            SkelPath = TEXT("/Game/Phantom/Characters/Production/SK_Knight.SK_Knight");
            AnimPath = TEXT("/Game/Phantom/Characters/Production/Animations/A_Knight_Idle.A_Knight_Idle");
        }
    }
    else
    {
        if (Role == EPhantomLegendsRole::Ranger)
        {
            SkelPath = TEXT("/Game/Phantom/Characters/Production/SK_SkeletonRogue.SK_SkeletonRogue");
            AnimPath = TEXT("/Game/Phantom/Characters/Production/Animations/A_SkeletonRogue_Idle.A_SkeletonRogue_Idle");
        }
        else if (Role == EPhantomLegendsRole::Brute)
        {
            SkelPath = TEXT("/Game/Phantom/Characters/Production/SK_SkeletonWarrior.SK_SkeletonWarrior");
            AnimPath = TEXT("/Game/Phantom/Characters/Production/Animations/A_SkeletonWarrior_Idle.A_SkeletonWarrior_Idle");
        }
        else
        {
            SkelPath = TEXT("/Game/Phantom/Characters/Production/SK_SkeletonMinion.SK_SkeletonMinion");
            AnimPath = TEXT("/Game/Phantom/Characters/Production/Animations/A_SkeletonMinion_Idle.A_SkeletonMinion_Idle");
        }
    }
    const bool bProductionSkeletal = ConfigureLegendsProductionSkeletal(
        this, SkelPath, AnimPath,
        Role == EPhantomLegendsRole::Brute ? 285.0f : (bWorker ? 180.0f : 205.0f),
        bLegion ? -90.0f : 90.0f
    );

    const TCHAR* GeneratedCharacter = nullptr;
    if (bLegion)
    {
        GeneratedCharacter = bWorker
            ? TEXT("/Game/Phantom/Generated/Legends/Characters/SM_LegionWorker.SM_LegionWorker")
            : (Role == EPhantomLegendsRole::Ranger
                ? TEXT("/Game/Phantom/Generated/Legends/Characters/SM_LegionRanger.SM_LegionRanger")
                : (Role == EPhantomLegendsRole::Brute
                    ? TEXT("/Game/Phantom/Generated/Legends/Characters/SM_LegionBrute.SM_LegionBrute")
                    : TEXT("/Game/Phantom/Generated/Legends/Characters/SM_LegionGuard.SM_LegionGuard")));
    }
    else
    {
        GeneratedCharacter = Role == EPhantomLegendsRole::Ranger
            ? TEXT("/Game/Phantom/Generated/Legends/Characters/SM_RiftRanger.SM_RiftRanger")
            : (Role == EPhantomLegendsRole::Brute
                ? TEXT("/Game/Phantom/Generated/Legends/Characters/SM_RiftBrute.SM_RiftBrute")
                : TEXT("/Game/Phantom/Generated/Legends/Characters/SM_RiftRaider.SM_RiftRaider"));
    }

    const TCHAR* V9Character = bLegion
        ? (Role == EPhantomLegendsRole::Ranger ? TEXT("/Game/Phantom/Generated/Legends/V9/Units/SM_V9_BlueRanger.SM_V9_BlueRanger")
           : (Role == EPhantomLegendsRole::Brute ? TEXT("/Game/Phantom/Generated/Legends/V9/Units/SM_V9_BlueGolem.SM_V9_BlueGolem")
              : TEXT("/Game/Phantom/Generated/Legends/V9/Units/SM_V9_BlueGuard.SM_V9_BlueGuard")))
        : (Role == EPhantomLegendsRole::Ranger ? TEXT("/Game/Phantom/Generated/Legends/V9/Units/SM_V9_RedRanger.SM_V9_RedRanger")
           : (Role == EPhantomLegendsRole::Brute ? TEXT("/Game/Phantom/Generated/Legends/V9/Units/SM_V9_RedGolem.SM_V9_RedGolem")
              : TEXT("/Game/Phantom/Generated/Legends/V9/Units/SM_V9_RedGuard.SM_V9_RedGuard")));
    UStaticMesh* AuthoredCharacter = bProductionSkeletal ? nullptr : LoadObject<UStaticMesh>(nullptr, V9Character);
    if (!AuthoredCharacter) AuthoredCharacter = GeneratedCharacter ? LoadObject<UStaticMesh>(nullptr, GeneratedCharacter) : nullptr;
    if (!AuthoredCharacter)
    {
        const TCHAR* CharacterAlias = bWorker
            ? TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Char_Worker.SM_CC0_Char_Worker")
            : (Role == EPhantomLegendsRole::Ranger
                ? TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Char_Ranger.SM_CC0_Char_Ranger")
                : (Role == EPhantomLegendsRole::Brute
                    ? TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Char_Brute.SM_CC0_Char_Brute")
                    : TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Char_Warrior.SM_CC0_Char_Warrior")));
        AuthoredCharacter = LoadObject<UStaticMesh>(nullptr, CharacterAlias);
    }

    VisualModel->SetStaticMesh(AuthoredCharacter);
    VisualModel->SetVisibility(AuthoredCharacter != nullptr && !bProductionSkeletal);
    if (AuthoredCharacter)
    {
        const FBoxSphereBounds VisualBounds = AuthoredCharacter->GetBounds();
        const float RawHeight = FMath::Max(1.0f, VisualBounds.BoxExtent.Z * 2.0f);
        const float TargetHeight = Role == EPhantomLegendsRole::Brute ? 430.0f : (bWorker ? 185.0f : 215.0f);
        const float FitScale = FMath::Clamp(TargetHeight / RawHeight, 0.025f, 60.0f);
        const float LocalBottom = (VisualBounds.Origin.Z - VisualBounds.BoxExtent.Z) * FitScale;
        VisualModel->SetRelativeLocation(FVector(0.0f, 0.0f, -GetCapsuleComponent()->GetUnscaledCapsuleHalfHeight() - LocalBottom));
        VisualModel->SetRelativeRotation(FRotator(0.0f, bLegion ? 0.0f : 180.0f, 0.0f));
        VisualModel->SetRelativeScale3D(FVector(FitScale));
    }
    const bool bShowFallbackRig = AuthoredCharacter == nullptr && !bProductionSkeletal;
    BodyMesh->SetVisibility(bShowFallbackRig);
    HeadMesh->SetVisibility(bShowFallbackRig);
    WeaponMesh->SetVisibility(bShowFallbackRig);
    LeftArm->SetVisibility(bShowFallbackRig);
    RightArm->SetVisibility(bShowFallbackRig);
    LeftLeg->SetVisibility(bShowFallbackRig);
    RightLeg->SetVisibility(bShowFallbackRig);
    HelmetMesh->SetVisibility(bShowFallbackRig);

    BodyMesh->SetRelativeScale3D(Role == EPhantomLegendsRole::Brute ? FVector(0.62f, 0.62f, 0.86f) : (bWorker ? FVector(0.36f, 0.36f, 0.58f) : FVector(0.46f, 0.46f, 0.72f)));
    HeadMesh->SetRelativeScale3D(Role == EPhantomLegendsRole::Brute ? FVector(0.38f) : FVector(0.3f));
    ShieldMesh->SetVisibility(bShowFallbackRig && (Role == EPhantomLegendsRole::Guard || Role == EPhantomLegendsRole::Brute));
    ChestMesh->SetVisibility(bShowFallbackRig && !bWorker);
    LeftShoulder->SetVisibility(bShowFallbackRig && (Role == EPhantomLegendsRole::Guard || Role == EPhantomLegendsRole::Brute));
    RightShoulder->SetVisibility(bShowFallbackRig && (Role == EPhantomLegendsRole::Guard || Role == EPhantomLegendsRole::Brute));
    CrestMesh->SetVisibility(bShowFallbackRig && !bWorker);
    ChestMesh->SetRelativeScale3D(Role == EPhantomLegendsRole::Brute ? FVector(0.48f, 0.56f, 0.30f) : FVector(0.36f, 0.44f, 0.22f));
    CrestMesh->SetRelativeScale3D(Role == EPhantomLegendsRole::Ranger ? FVector(0.11f, 0.11f, 0.38f) : FVector(0.14f, 0.14f, 0.28f));
    WeaponMesh->SetRelativeScale3D(Role == EPhantomLegendsRole::Ranger ? FVector(0.06f, 0.06f, 0.98f) : (Role == EPhantomLegendsRole::Brute ? FVector(0.18f, 0.16f, 0.98f) : FVector(0.11f, 0.09f, 0.72f)));
    ApplyColor(BodyMesh, Main * (bWorker ? 0.72f : 1.0f));
    ApplyColor(HeadMesh, bLegion ? FLinearColor(0.72f, 0.58f, 0.46f) : FLinearColor(0.2f, 0.025f, 0.05f));
    ApplyColor(WeaponMesh, Role == EPhantomLegendsRole::Ranger ? Accent : FLinearColor(0.62f, 0.66f, 0.72f));
    ApplyColor(ShieldMesh, Accent);
    ApplyColor(ChestMesh, Main * 0.52f);
    ApplyColor(LeftShoulder, Accent * 0.82f);
    ApplyColor(RightShoulder, Accent * 0.82f);
    ApplyColor(LeftArm, Main * 0.82f);
    ApplyColor(RightArm, Main * 0.82f);
    ApplyColor(LeftLeg, Main * 0.62f);
    ApplyColor(RightLeg, Main * 0.62f);
    ApplyColor(HelmetMesh, bWorker ? Main * 0.7f : Accent * 0.78f);
    HelmetMesh->SetVisibility(bShowFallbackRig && (!bWorker || Role == EPhantomLegendsRole::Ranger));
    LeftArm->SetRelativeScale3D(Role == EPhantomLegendsRole::Brute ? FVector(0.16f, 0.16f, 0.48f) : FVector(0.12f, 0.12f, 0.42f));
    RightArm->SetRelativeScale3D(Role == EPhantomLegendsRole::Brute ? FVector(0.16f, 0.16f, 0.48f) : FVector(0.12f, 0.12f, 0.42f));
    ApplyColor(CrestMesh, Accent);
    ApplyColor(SelectionRing, FLinearColor(0.05f, 1.0f, 0.42f));
    ApplyColor(HealthBack, FLinearColor(0.02f, 0.025f, 0.035f));
    ApplyColor(HealthFill, bLegion ? FLinearColor(0.15f, 0.95f, 0.72f) : FLinearColor(1.0f, 0.12f, 0.22f));
    RefreshHealthBar();
}

void APhantomLegendsUnit::RegisterVeteranKill()
{
    if (VeteranLevel >= 5) return;
    ++VeteranLevel;
    const float HealthGain = MaxHealth * 0.075f;
    MaxHealth += HealthGain;
    Health = FMath::Min(MaxHealth, Health + HealthGain + 14.0f);
    Damage *= 1.06f;
    AttackInterval = FMath::Max(0.48f, AttackInterval * 0.97f);
    GetCharacterMovement()->MaxWalkSpeed += 8.0f;
    CrestMesh->SetRelativeScale3D(CrestMesh->GetRelativeScale3D() * 1.07f);
    ApplyColor(CrestMesh, VeteranLevel >= 4 ? FLinearColor(1.0f, 0.72f, 0.12f) : FLinearColor(0.52f, 0.2f + VeteranLevel * 0.08f, 1.0f));
    RefreshHealthBar();
}

void APhantomLegendsUnit::RestoreHealth(float Amount)
{
    if (Amount <= 0.0f || Health <= 0.0f) return;
    Health = FMath::Min(MaxHealth, Health + Amount);
    RefreshHealthBar();
}

void APhantomLegendsUnit::StopOrders()
{
    bHasOrder = false;
    bAttackMove = false;
    bPatrolling = false;
    bHasPriorityCombatTarget = false;
    QueuedWaypoints.Reset();
    QueuedAttackMoveFlags.Reset();
    OrderLocation = GetActorLocation();
    CombatTarget.Reset();
    GatherTarget.Reset();
    GetCharacterMovement()->StopMovementImmediately();
}

void APhantomLegendsUnit::SetAttackMoveLocation(const FVector& Location)
{
    OrderLocation = Location;
    OrderLocation.Z = GetActorLocation().Z;
    bHasOrder = true;
    bAttackMove = true;
    bHoldPosition = false;
    CombatTarget.Reset();
    bHasPriorityCombatTarget = false;
    GatherTarget.Reset();
}

void APhantomLegendsUnit::QueueOrderLocation(const FVector& Location, bool bAttackMoveOrder)
{
    FVector P = Location;
    P.Z = GetActorLocation().Z;
    if (!bHasOrder && !bHasPriorityCombatTarget && !GatherTarget.IsValid())
    {
        if (bAttackMoveOrder) SetAttackMoveLocation(P);
        else SetOrderLocation(P);
        return;
    }
    QueuedWaypoints.Add(P);
    QueuedAttackMoveFlags.Add(bAttackMoveOrder);
}

void APhantomLegendsUnit::SetPatrolLocation(const FVector& Location)
{
    PatrolA = GetActorLocation();
    PatrolB = Location;
    PatrolB.Z = PatrolA.Z;
    bPatrolling = true;
    bPatrolToB = true;
    QueuedWaypoints.Reset();
    QueuedAttackMoveFlags.Reset();
    SetOrderLocation(PatrolB);
}

void APhantomLegendsUnit::SetHoldPosition(bool bHold)
{
    bHoldPosition = bHold;
    if (bHold)
    {
        bHasOrder = false;
        bAttackMove = false;
        GatherTarget.Reset();
        GetCharacterMovement()->StopMovementImmediately();
    }
}

void APhantomLegendsUnit::SetSelected(bool bNewSelected)
{
    bSelected = bNewSelected && IsPlayerUnit();
    SelectionRing->SetVisibility(bSelected);
    RefreshHealthBar();
}

void APhantomLegendsUnit::SetOrderLocation(const FVector& Location)
{
    OrderLocation = Location;
    OrderLocation.Z = GetActorLocation().Z;
    bHasOrder = true;
    bAttackMove = false;
    bHoldPosition = false;
    CombatTarget.Reset();
    bHasPriorityCombatTarget = false;
    GatherTarget.Reset();
}

void APhantomLegendsUnit::SetCombatTarget(AActor* Target)
{
    if (!Target || Target == this) return;
    CombatTarget = Target;
    bHoldPosition = false;
    bAttackMove = false;
    bHasPriorityCombatTarget = true;
    GatherTarget.Reset();
    bHasOrder = false;
    TargetRefresh = 0.0f;
}

void APhantomLegendsUnit::SetGatherTarget(APhantomLegendsResourceNode* Node)
{
    if (!bWorker || !Node) return;
    GatherTarget = Node;
    bHoldPosition = false;
    bAttackMove = false;
    CombatTarget.Reset();
    bHasPriorityCombatTarget = false;
    bHasOrder = false;
    GatherRemaining = 0.0f;
}

AActor* APhantomLegendsUnit::ResolveCombatTarget() const
{
    AActor* Nearest = nullptr;
    float NearestDistance = TNumericLimits<float>::Max();
    const float DetectionRadius = bWorker ? 360.0f : (Role == EPhantomLegendsRole::Ranger ? 1450.0f : (Role == EPhantomLegendsRole::Raider ? 1250.0f : 1125.0f));
    for (TActorIterator<APhantomLegendsUnit> It(GetWorld()); It; ++It)
    {
        if (*It == this || It->Faction == Faction) continue;
        const float Distance = FVector::DistSquared2D(GetActorLocation(), It->GetActorLocation());
        if (Distance < FMath::Square(DetectionRadius) && Distance < NearestDistance)
        {
            Nearest = *It;
            NearestDistance = Distance;
        }
    }
    if (Nearest || bWorker) return Nearest;
    for (TActorIterator<APhantomLegendsStructure> It(GetWorld()); It; ++It)
    {
        if (It->GetFaction() == Faction || It->GetHealth() <= 0.0f) continue;
        const float Distance = FVector::DistSquared2D(GetActorLocation(), It->GetActorLocation());
        const float StructureDetection = Faction == EPhantomLegendsFaction::Legion ? FMath::Square(1450.0f) : TNumericLimits<float>::Max();
        if (Distance < StructureDetection && Distance < NearestDistance)
        {
            Nearest = *It;
            NearestDistance = Distance;
        }
    }
    return Nearest;
}

float APhantomLegendsUnit::ComputeDamageAgainst(AActor* TargetActor) const
{
    float AdjustedDamage = Damage;
    if (const APhantomLegendsUnit* TargetUnit = Cast<APhantomLegendsUnit>(TargetActor))
    {
        if (Role == EPhantomLegendsRole::Guard && (TargetUnit->Role == EPhantomLegendsRole::Raider || TargetUnit->Role == EPhantomLegendsRole::Brute))
        {
            AdjustedDamage *= 1.38f;
        }
        if (Role == EPhantomLegendsRole::Ranger)
        {
            AdjustedDamage *= TargetUnit->Role == EPhantomLegendsRole::Brute ? 0.78f : 1.28f;
        }
        if (Role == EPhantomLegendsRole::Worker)
        {
            AdjustedDamage *= 0.55f;
        }
        if (Role == EPhantomLegendsRole::Brute && TargetUnit->Role == EPhantomLegendsRole::Guard)
        {
            AdjustedDamage *= 0.82f;
        }
    }
    else if (const APhantomLegendsStructure* TargetStructure = Cast<APhantomLegendsStructure>(TargetActor))
    {
        if (TargetStructure->GetFaction() != Faction)
        {
            if (Role == EPhantomLegendsRole::Brute) AdjustedDamage *= 2.15f;
            else if (Role == EPhantomLegendsRole::Ranger) AdjustedDamage *= 0.42f;
            else if (Role == EPhantomLegendsRole::Worker) AdjustedDamage *= 0.22f;
            else AdjustedDamage *= 0.78f;
        }
    }
    return AdjustedDamage;
}

void APhantomLegendsUnit::AutoGatherNearestResource()
{
    if (!bWorker || bHasOrder || bHasPriorityCombatTarget || GatherTarget.IsValid()) return;
    APhantomLegendsResourceNode* Nearest = nullptr;
    float NearestDistance = TNumericLimits<float>::Max();
    for (TActorIterator<APhantomLegendsResourceNode> It(GetWorld()); It; ++It)
    {
        if (It->GetRemaining() <= 0) continue;
        const float Distance = FVector::DistSquared2D(GetActorLocation(), It->GetActorLocation());
        if (Distance < FMath::Square(1250.0f) && Distance < NearestDistance)
        {
            Nearest = *It;
            NearestDistance = Distance;
        }
    }
    if (Nearest) SetGatherTarget(Nearest);
}

void APhantomLegendsUnit::RefreshHealthBar()
{
    const float Ratio = MaxHealth > 0.0f ? FMath::Clamp(Health / MaxHealth, 0.0f, 1.0f) : 0.0f;
    HealthFill->SetRelativeScale3D(FVector(0.64f * Ratio, 0.05f, 0.024f));
    HealthFill->SetRelativeLocation(FVector(-32.0f * (1.0f - Ratio), -52.0f, 86.0f));
    UpdateHealthBarVisibility();
}

void APhantomLegendsUnit::UpdateHealthBarVisibility()
{
    const bool bShowHealth = Health > 0.0f && (bSelected || Health < MaxHealth);
    HealthBack->SetVisibility(bShowHealth, true);
    HealthFill->SetVisibility(bShowHealth, true);
    HealthBack->SetHiddenInGame(!bShowHealth, true);
    HealthFill->SetHiddenInGame(!bShowHealth, true);
}

void APhantomLegendsUnit::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    AttackRemaining = FMath::Max(0.0f, AttackRemaining - DeltaSeconds);
    TargetRefresh -= DeltaSeconds;
    const float Swing = AttackRemaining > 0.0f ? FMath::Sin(AttackRemaining * 22.0f) * 24.0f : 0.0f;
    WeaponMesh->SetRelativeRotation(FRotator(0.0f, 0.0f, -32.0f + Swing));
    const float SpeedAlpha = FMath::Clamp(GetVelocity().Size2D() / FMath::Max(1.0f, GetCharacterMovement()->MaxWalkSpeed), 0.0f, 1.0f);
    const float Gait = FMath::Sin(GetWorld()->GetTimeSeconds() * (8.0f + SpeedAlpha * 4.0f)) * 28.0f * SpeedAlpha;
    LeftLeg->SetRelativeRotation(FRotator(Gait, 0.0f, 0.0f));
    RightLeg->SetRelativeRotation(FRotator(-Gait, 0.0f, 0.0f));
    LeftArm->SetRelativeRotation(FRotator(-Gait * 0.65f, 0.0f, 0.0f));
    RightArm->SetRelativeRotation(FRotator(Gait * 0.65f, 0.0f, 0.0f));
    if (!CombatTarget.IsValid()) bHasPriorityCombatTarget = false;
    if (bWorker && !GatherTarget.IsValid() && !CombatTarget.IsValid()) AutoGatherNearestResource();
    if (GatherTarget.IsValid() && bWorker)
    {
        APhantomLegendsResourceNode* Node = GatherTarget.Get();
        const FVector Offset = Node->GetActorLocation() - GetActorLocation();
        if (Offset.Size2D() > 145.0f)
        {
            AddMovementInput(Offset.GetSafeNormal2D(), 1.0f);
            SetActorRotation(Offset.Rotation());
        }
        else
        {
            GatherRemaining -= DeltaSeconds;
            if (GatherRemaining <= 0.0f)
            {
                const int32 Yield = Node->Harvest(10);
                if (APhantomLegendsDirector* Director = LegendsDirector(this)) Director->DepositResource(Node->GetResourceType(), Yield);
                GatherRemaining = 0.75f;
                if (Node->GetRemaining() <= 0) GatherTarget.Reset();
            }
        }
        return;
    }

    if (!bHasPriorityCombatTarget && (!CombatTarget.IsValid() || TargetRefresh <= 0.0f))
    {
        CombatTarget = ResolveCombatTarget();
        TargetRefresh = 0.22f;
    }
    if (AActor* TargetActor = CombatTarget.Get())
    {
        const FVector Offset = TargetActor->GetActorLocation() - GetActorLocation();
        const float CenterDistance = Offset.Size2D();
        const APhantomLegendsStructure* TargetStructure = Cast<APhantomLegendsStructure>(TargetActor);
        const float TargetRadius = TargetStructure ? TargetStructure->GetCombatRadius() : 0.0f;
        const float Distance = FMath::Max(0.0f, CenterDistance - TargetRadius);
        if (Distance > AttackRange)
        {
            if (!bHoldPosition)
            {
                AddMovementInput(Offset.GetSafeNormal2D(), 1.0f);
                SetActorRotation(Offset.Rotation());
            }
        }
        else if (AttackRemaining <= 0.0f)
        {
            const float AppliedDamage = ComputeDamageAgainst(TargetActor);
            if (Role == EPhantomLegendsRole::Ranger && GetWorld())
            {
                const FVector Muzzle = GetActorLocation() + FVector(0.0f, 0.0f, 92.0f);
                APhantomLegendsProjectile* Projectile = GetWorld()->SpawnActor<APhantomLegendsProjectile>(Muzzle, FRotator::ZeroRotator);
                if (Projectile) Projectile->Configure(this, TargetActor, Faction, AppliedDamage);
            }
            else
            {
                UGameplayStatics::ApplyDamage(TargetActor, AppliedDamage, nullptr, this, UDamageType::StaticClass());
            }
            AttackRemaining = AttackInterval;
        }
        return;
    }

    if (!bHasOrder || bHoldPosition) return;
    const FVector Offset = OrderLocation - GetActorLocation();
    if (Offset.Size2D() < 42.0f)
    {
        if (bPatrolling)
        {
            bPatrolToB = !bPatrolToB;
            OrderLocation = bPatrolToB ? PatrolB : PatrolA;
            bHasOrder = true;
            bAttackMove = true;
            return;
        }
        if (!QueuedWaypoints.IsEmpty())
        {
            OrderLocation = QueuedWaypoints[0];
            bAttackMove = QueuedAttackMoveFlags.IsValidIndex(0) ? QueuedAttackMoveFlags[0] : false;
            QueuedWaypoints.RemoveAt(0);
            if (!QueuedAttackMoveFlags.IsEmpty()) QueuedAttackMoveFlags.RemoveAt(0);
            bHasOrder = true;
            return;
        }
        bHasOrder = false;
        return;
    }
    AddMovementInput(Offset.GetSafeNormal2D(), 1.0f);
    SetActorRotation(Offset.Rotation());
}

float APhantomLegendsUnit::TakeDamage(
    float DamageAmount,
    FDamageEvent const& DamageEvent,
    AController* EventInstigator,
    AActor* DamageCauser
)
{
    if (const APhantomLegendsUnit* Source = Cast<APhantomLegendsUnit>(DamageCauser))
    {
        if (Source->Faction == Faction) return 0.0f;
    }
    if (APhantomLegendsUnit* Source = Cast<APhantomLegendsUnit>(DamageCauser))
    {
        if (Source->GetFaction() != Faction && !bHasPriorityCombatTarget)
        {
            CombatTarget = Source;
            GatherTarget.Reset();
            TargetRefresh = 0.0f;
        }
    }
    Health = FMath::Max(0.0f, Health - DamageAmount);
    RefreshHealthBar();
    if (Health <= 0.0f)
    {
        if (APhantomLegendsUnit* Killer = Cast<APhantomLegendsUnit>(DamageCauser))
        {
            if (Killer != this && Killer->GetFaction() != Faction) Killer->RegisterVeteranKill();
        }
        if (APhantomLegendsDirector* Director = LegendsDirector(this)) Director->NotifyUnitDefeated(Faction, Role);
        Destroy();
    }
    return DamageAmount;
}

APhantomLegendsPawn::APhantomLegendsPawn()
{
    PrimaryActorTick.bCanEverTick = true;
    CameraRoot = CreateDefaultSubobject<USceneComponent>(TEXT("CameraRoot"));
    SetRootComponent(CameraRoot);
    SpringArm = CreateDefaultSubobject<USpringArmComponent>(TEXT("StrategyBoom"));
    SpringArm->SetupAttachment(CameraRoot);
    // Conventional RTS default: start high enough to read the whole tactical situation.
    SpringArm->TargetArmLength = 8200.0f;
    SpringArm->SetRelativeRotation(FRotator(-48.0f, -42.0f, 0.0f));
    SpringArm->bDoCollisionTest = false;
    SpringArm->bEnableCameraLag = true;
    SpringArm->CameraLagSpeed = 14.0f;
    StrategyCamera = CreateDefaultSubobject<UCameraComponent>(TEXT("StrategyCamera"));
    StrategyCamera->SetupAttachment(SpringArm);
    StrategyCamera->FieldOfView = 58.0f;
    AutoPossessPlayer = EAutoReceiveInput::Player0;
}

void APhantomLegendsPawn::BeginPlay()
{
    Super::BeginPlay();
    SetActorLocation(FVector(-126000.0f, -93000.0f, 90.0f));
    if (APlayerController* PlayerController = Cast<APlayerController>(GetController()))
    {
        PlayerController->bShowMouseCursor = true;
        PlayerController->bEnableClickEvents = true;
        PlayerController->bEnableMouseOverEvents = true;
        // GameOnly prevents Slate/UI focus from stealing drag-select releases while keeping the RTS cursor free.
        FInputModeGameOnly Mode;
        PlayerController->SetInputMode(Mode);
        UGameplayStatics::SetViewportMouseCaptureMode(this, EMouseCaptureMode::NoCapture);
    }
}

void APhantomLegendsPawn::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);

    APlayerController* PlayerController = Cast<APlayerController>(GetController());
    float EdgeForward = 0.0f;
    float EdgeRight = 0.0f;
    FVector2D MousePosition = LastMousePosition;
    bool bHasMouse = false;

    const float CameraYaw = SpringArm ? SpringArm->GetRelativeRotation().Yaw : -45.0f;
    const FRotationMatrix CameraBasis(FRotator(0.0f, CameraYaw, 0.0f));
    const FVector ScreenForward = CameraBasis.GetUnitAxis(EAxis::X);
    const FVector ScreenRight = CameraBasis.GetUnitAxis(EAxis::Y);

    if (PlayerController)
    {
        float MouseX = 0.0f;
        float MouseY = 0.0f;
        bHasMouse = PlayerController->GetMousePosition(MouseX, MouseY);
        if (bHasMouse)
        {
            MousePosition = FVector2D(MouseX, MouseY);

            // Belt-and-suspenders RTS selection: input bindings start/end the marquee, but
            // packaged builds also poll the physical LMB transition every frame. If Windows/UE
            // drops a release event while the free cursor leaves a primitive, selection still completes.
            const bool bLeftDown = PlayerController->IsInputKeyDown(EKeys::LeftMouseButton);
            if (bLeftDown && !bLeftMouseWasDown && !bBoxSelecting && !bMinimapPanning)
            {
                bBoxSelecting = true; SelectionStart = SelectionCurrent = MousePosition;
            }
            if (!bLeftDown && bLeftMouseWasDown && bBoxSelecting)
            {
                SelectionCurrent = MousePosition;
                const FVector2D StartCopy=SelectionStart, EndCopy=SelectionCurrent;
                bBoxSelecting=false;
                if (APhantomLegendsDirector* Director=LegendsDirector(this))
                {
                    int32 SelVW=0, SelVH=0; PlayerController->GetViewportSize(SelVW, SelVH);
                    if (FVector2D::Distance(StartCopy,EndCopy) < PhantomInteractionSpec::DpiScaledPixels(PhantomInteractionSpec::DragThreshold1080, SelVH)) Director->SelectAtCursor(PlayerController);
                    else Director->SelectScreenRect(PlayerController,StartCopy,EndCopy);
                }
            }
            bLeftMouseWasDown=bLeftDown;
            if (bMinimapPanning && bLeftDown)
            {
                int32 VW=0,VH=0; PlayerController->GetViewportSize(VW,VH);
                const float UI=FMath::Clamp(FMath::Min(VW/1920.0f,VH/1080.0f),0.76f,1.0f);
                const float MW=215.0f*UI,MH=145.0f*UI,MX=VW-MW-24.0f*UI,MY=78.0f*UI+18.0f*UI;
                const float U=FMath::Clamp((MouseX-MX)/MW,0.0f,1.0f),V=FMath::Clamp((MouseY-MY)/MH,0.0f,1.0f);
                FVector Here=GetActorLocation(); Here.X=U*409600.0f-204800.0f; Here.Y=(1.0f-V)*409600.0f-204800.0f; SetActorLocation(Here);
            }
            if (bMinimapPanning && !bLeftDown) bMinimapPanning=false;

            if (bBoxSelecting)
            {
                float RawDX = 0.0f, RawDY = 0.0f;
                PlayerController->GetInputMouseDelta(RawDX, RawDY);
                const FVector2D ScreenDelta = MousePosition - LastMousePosition;
                if (ScreenDelta.SizeSquared() > 0.25f)
                {
                    SelectionCurrent = MousePosition;
                }
                else if (FMath::Abs(RawDX) + FMath::Abs(RawDY) > 0.01f)
                {
                    int32 VW = 0, VH = 0;
                    PlayerController->GetViewportSize(VW, VH);
                    SelectionCurrent.X = FMath::Clamp(SelectionCurrent.X + RawDX, 0.0f, static_cast<float>(FMath::Max(VW, 1)));
                    SelectionCurrent.Y = FMath::Clamp(SelectionCurrent.Y - RawDY, 0.0f, static_cast<float>(FMath::Max(VH, 1)));
                }
            }

            const bool bMiddleDown = PlayerController->IsInputKeyDown(EKeys::MiddleMouseButton);
            if (bMiddleDown && bMiddleMouseWasDown && bHasLastMousePosition && !bBoxSelecting)
            {
                const FVector2D Delta = MousePosition - LastMousePosition;
                const bool bOrbit=PlayerController->IsInputKeyDown(EKeys::LeftAlt)||PlayerController->IsInputKeyDown(EKeys::RightAlt);
                if(bOrbit && SpringArm)
                {
                    FRotator R=SpringArm->GetRelativeRotation(); R.Yaw+=Delta.X*0.16f; R.Pitch=FMath::Clamp(R.Pitch-Delta.Y*0.11f,-72.0f,-30.0f); SpringArm->SetRelativeRotation(R);
                }
                else
                {
                    const float DragScale = SpringArm
                        ? FMath::GetMappedRangeValueClamped(FVector2D(3800.0f, 14000.0f), FVector2D(2.0f, 7.0f), SpringArm->TargetArmLength)
                        : 3.0f;
                    AddActorWorldOffset((-ScreenRight * Delta.X + ScreenForward * Delta.Y) * DragScale);
                }
            }
            bMiddleMouseWasDown = bMiddleDown;
            if (bRightDragActive) RightDragCurrent = MousePosition;

            // Read the wheel as an analog axis directly from PlayerController. This is the
            // same Mouse Wheel Axis Unreal exposes to input and does not depend on legacy
            // action dispatch while a visible RTS cursor is active.
            const float DirectWheel = PlayerController->GetInputAnalogKeyState(EKeys::MouseWheelAxis);
            if (SpringArm && FMath::Abs(DirectWheel) > 0.001f)
            {
                SpringArm->TargetArmLength = FMath::Clamp(
                    SpringArm->TargetArmLength - DirectWheel * 1000.0f,
                    3800.0f,
                    14000.0f);
            }

            int32 ViewportWidth = 0;
            int32 ViewportHeight = 0;
            PlayerController->GetViewportSize(ViewportWidth, ViewportHeight);
            // Automated proof has no human cursor owner; Windows can park its cursor on a viewport
            // edge and pan kilometres away from the opening stronghold before the screenshot.
            // Disable edge-scroll only for the packaged proof switch. Keyboard, drag, minimap and
            // ordinary player edge-scroll remain unchanged in every normal launch.
            const bool bGameplayProof = FParse::Param(FCommandLine::Get(), TEXT("PhantomGameplayCapture"));
            if (!bGameplayProof && !bBoxSelecting && !bMiddleDown && ViewportWidth > 0 && ViewportHeight > 0)
            {
                constexpr float EdgeBand = 12.0f;
                if (MouseX <= EdgeBand) EdgeRight = -1.0f;
                else if (MouseX >= ViewportWidth - EdgeBand) EdgeRight = 1.0f;
                if (MouseY <= EdgeBand) EdgeForward = 1.0f;
                else if (MouseY >= ViewportHeight - EdgeBand) EdgeForward = -1.0f;
            }

            LastMousePosition = MousePosition;
            bHasLastMousePosition = true;
        }
    }

    // Packaged-launcher fallback: if the legacy axis mapping is suppressed, poll the physical
    // navigation keys directly. RTS camera traversal must never depend on one input path.
    float DirectForward = 0.0f, DirectRight = 0.0f;
    if (PlayerController)
    {
        if (FMath::IsNearlyZero(ForwardInput))
            DirectForward = ((PlayerController->IsInputKeyDown(EKeys::W) || PlayerController->IsInputKeyDown(EKeys::Up)) ? 1.0f : 0.0f)
                - ((PlayerController->IsInputKeyDown(EKeys::S) || PlayerController->IsInputKeyDown(EKeys::Down)) ? 1.0f : 0.0f);
        if (FMath::IsNearlyZero(RightInput))
            DirectRight = ((PlayerController->IsInputKeyDown(EKeys::D) || PlayerController->IsInputKeyDown(EKeys::Right)) ? 1.0f : 0.0f)
                - ((PlayerController->IsInputKeyDown(EKeys::A) || PlayerController->IsInputKeyDown(EKeys::Left)) ? 1.0f : 0.0f);
    }
    const FVector Forward = ScreenForward * FMath::Clamp(ForwardInput + DirectForward + EdgeForward, -1.0f, 1.0f);
    const FVector Right = ScreenRight * FMath::Clamp(RightInput + DirectRight + EdgeRight, -1.0f, 1.0f);
    const float ZoomAlpha = SpringArm
        ? FMath::GetMappedRangeValueClamped(FVector2D(3800.0f, 14000.0f), FVector2D(0.62f, 1.55f), SpringArm->TargetArmLength)
        : 1.0f;
    const float PanModifier = PlayerController && (PlayerController->IsInputKeyDown(EKeys::LeftShift)||PlayerController->IsInputKeyDown(EKeys::RightShift)) ? 2.0f
        : (PlayerController && (PlayerController->IsInputKeyDown(EKeys::LeftControl)||PlayerController->IsInputKeyDown(EKeys::RightControl)) ? 0.5f : 1.0f);
    AddActorWorldOffset((Forward + Right).GetClampedToMaxSize(1.0f) * 6200.0f * ZoomAlpha * PanModifier * DeltaSeconds);

    FVector Clamped = GetActorLocation();
    Clamped.X = FMath::Clamp(Clamped.X, -CameraBounds.X, CameraBounds.X);
    Clamped.Y = FMath::Clamp(Clamped.Y, -CameraBounds.Y, CameraBounds.Y);
    SetActorLocation(Clamped);

    if (SpringArm)
    {
        SpringArm->TargetArmLength = FMath::Clamp(SpringArm->TargetArmLength - ZoomInput * 1000.0f, 3800.0f, 14000.0f);
    }
    ZoomInput = 0.0f;
}

void APhantomLegendsPawn::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
    Super::SetupPlayerInputComponent(PlayerInputComponent);
    PlayerInputComponent->BindAxis(TEXT("MoveForward"), this, &APhantomLegendsPawn::MoveForward);
    PlayerInputComponent->BindAxis(TEXT("MoveRight"), this, &APhantomLegendsPawn::MoveRight);
    PlayerInputComponent->BindAxis(TEXT("CameraZoom"), this, &APhantomLegendsPawn::Zoom);
    // Hard-bind RTS mouse controls so selection/commands never depend on the FPS action map.
    PlayerInputComponent->BindKey(EKeys::LeftMouseButton, IE_Pressed, this, &APhantomLegendsPawn::BeginBoxSelect);
    PlayerInputComponent->BindKey(EKeys::LeftMouseButton, IE_Released, this, &APhantomLegendsPawn::EndBoxSelect);
    PlayerInputComponent->BindKey(EKeys::RightMouseButton, IE_Pressed, this, &APhantomLegendsPawn::BeginRightOrder);
    PlayerInputComponent->BindKey(EKeys::RightMouseButton, IE_Released, this, &APhantomLegendsPawn::EndRightOrder);
    PlayerInputComponent->BindKey(EKeys::MouseScrollUp, IE_Pressed, this, &APhantomLegendsPawn::ZoomIn);
    PlayerInputComponent->BindKey(EKeys::MouseScrollDown, IE_Pressed, this, &APhantomLegendsPawn::ZoomOut);
    PlayerInputComponent->BindKey(EKeys::PageUp, IE_Pressed, this, &APhantomLegendsPawn::ZoomIn);
    PlayerInputComponent->BindKey(EKeys::PageDown, IE_Pressed, this, &APhantomLegendsPawn::ZoomOut);
    PlayerInputComponent->BindKey(EKeys::Q, IE_Pressed, this, &APhantomLegendsPawn::RotateLeft);
    PlayerInputComponent->BindKey(EKeys::E, IE_Pressed, this, &APhantomLegendsPawn::RotateRight);
    PlayerInputComponent->BindAction(TEXT("UpgradeStronghold"), IE_Pressed, this, &APhantomLegendsPawn::UpgradeStronghold);
    PlayerInputComponent->BindAction(TEXT("SelectArmy"), IE_Pressed, this, &APhantomLegendsPawn::SelectArmy);
    PlayerInputComponent->BindKey(EKeys::S, IE_Pressed, this, &APhantomLegendsPawn::StopSelected);
    PlayerInputComponent->BindKey(EKeys::F, IE_Pressed, this, &APhantomLegendsPawn::CenterSelected);
    PlayerInputComponent->BindKey(EKeys::A, IE_Pressed, this, &APhantomLegendsPawn::AttackMove);
    PlayerInputComponent->BindKey(EKeys::H, IE_Pressed, this, &APhantomLegendsPawn::HoldSelected);
    PlayerInputComponent->BindKey(EKeys::P, IE_Pressed, this, &APhantomLegendsPawn::PatrolSelected);
    PlayerInputComponent->BindKey(EKeys::Home, IE_Pressed, this, &APhantomLegendsPawn::FocusCapital);
    PlayerInputComponent->BindKey(EKeys::BackSpace, IE_Pressed, this, &APhantomLegendsPawn::ResetCamera);
    PlayerInputComponent->BindKey(EKeys::One, IE_Pressed, this, &APhantomLegendsPawn::ControlGroup1);
    PlayerInputComponent->BindKey(EKeys::Two, IE_Pressed, this, &APhantomLegendsPawn::ControlGroup2);
    PlayerInputComponent->BindKey(EKeys::Three, IE_Pressed, this, &APhantomLegendsPawn::ControlGroup3);
    PlayerInputComponent->BindKey(EKeys::Four, IE_Pressed, this, &APhantomLegendsPawn::ControlGroup4);
    PlayerInputComponent->BindKey(EKeys::Five, IE_Pressed, this, &APhantomLegendsPawn::ControlGroup5);
    PlayerInputComponent->BindKey(EKeys::Six, IE_Pressed, this, &APhantomLegendsPawn::ControlGroup6);
    PlayerInputComponent->BindKey(EKeys::Seven, IE_Pressed, this, &APhantomLegendsPawn::ControlGroup7);
    PlayerInputComponent->BindKey(EKeys::Eight, IE_Pressed, this, &APhantomLegendsPawn::ControlGroup8);
    PlayerInputComponent->BindKey(EKeys::Nine, IE_Pressed, this, &APhantomLegendsPawn::ControlGroup9);
    PlayerInputComponent->BindKey(EKeys::F5, IE_Pressed, this, &APhantomLegendsPawn::CameraBookmark5);
    PlayerInputComponent->BindKey(EKeys::F6, IE_Pressed, this, &APhantomLegendsPawn::CameraBookmark6);
    PlayerInputComponent->BindKey(EKeys::F7, IE_Pressed, this, &APhantomLegendsPawn::CameraBookmark7);
    PlayerInputComponent->BindKey(EKeys::F8, IE_Pressed, this, &APhantomLegendsPawn::CameraBookmark8);

}

void APhantomLegendsPawn::MoveForward(float Value) { ForwardInput = Value; }
void APhantomLegendsPawn::MoveRight(float Value) { RightInput = Value; }
void APhantomLegendsPawn::Zoom(float Value) { ZoomInput = Value; }
void APhantomLegendsPawn::ZoomIn()
{
    if (SpringArm) SpringArm->TargetArmLength = FMath::Clamp(SpringArm->TargetArmLength - 2200.0f, 3800.0f, 14000.0f);
}
void APhantomLegendsPawn::ZoomOut()
{
    if (SpringArm) SpringArm->TargetArmLength = FMath::Clamp(SpringArm->TargetArmLength + 2200.0f, 3800.0f, 14000.0f);
}
void APhantomLegendsPawn::RotateLeft()
{
    if (!SpringArm) return;
    FRotator R = SpringArm->GetRelativeRotation();
    R.Yaw -= 15.0f;
    SpringArm->SetRelativeRotation(R);
}
void APhantomLegendsPawn::RotateRight()
{
    if (!SpringArm) return;
    FRotator R = SpringArm->GetRelativeRotation();
    R.Yaw += 15.0f;
    SpringArm->SetRelativeRotation(R);
}
void APhantomLegendsPawn::Select() { if (APhantomLegendsDirector* Director = LegendsDirector(this)) Director->SelectAtCursor(Cast<APlayerController>(GetController())); }
void APhantomLegendsPawn::BeginBoxSelect()
{
    APlayerController* PC = Cast<APlayerController>(GetController());
    float X=0.0f, Y=0.0f;
    if (!PC || !PC->GetMousePosition(X,Y)) return;
    int32 VW=0,VH=0; PC->GetViewportSize(VW,VH);
    const float UI=FMath::Clamp(FMath::Min(VW/1920.0f,VH/1080.0f),0.76f,1.0f);
    // The command deck is clickable; numeric keys remain dedicated RTS control groups.
    const float DockH=138.0f*UI,DockY=VH-DockH,Pad=18.0f*UI,Gap=8.0f*UI;
    const float ButtonW=FMath::Min(190.0f*UI,(VW-36.0f*UI)/5.0f-Gap);
    if(Y>=DockY+14.0f*UI&&Y<=DockY+76.0f*UI)
    {
        for(int32 I=0;I<5;++I){const float BX=Pad+I*(ButtonW+Gap);if(X>=BX&&X<=BX+ButtonW){if(I==0)TrainWorker();else if(I==1)TrainGuard();else if(I==2)BuildTower();else if(I==3)TrainRanger();else TrainBrute();return;}}
    }
    const float MW=215.0f*UI,MH=145.0f*UI,MX=VW-MW-24.0f*UI,MY=78.0f*UI+18.0f*UI;
    if(X>=MX&&X<=MX+MW&&Y>=MY&&Y<=MY+MH)
    {
        bMinimapPanning=true; bBoxSelecting=false;
        const float U=FMath::Clamp((X-MX)/MW,0.0f,1.0f),V=FMath::Clamp((Y-MY)/MH,0.0f,1.0f);
        FVector Here=GetActorLocation(); Here.X=U*409600.0f-204800.0f; Here.Y=(1.0f-V)*409600.0f-204800.0f; SetActorLocation(Here);
        return;
    }
    bBoxSelecting = true;
    SelectionStart = SelectionCurrent = FVector2D(X,Y);
    LastMousePosition = SelectionCurrent;
    bHasLastMousePosition = true;
}

void APhantomLegendsPawn::EndBoxSelect()
{
    if (bMinimapPanning) { bMinimapPanning=false; return; }
    if (!bBoxSelecting) return;
    APlayerController* PC = Cast<APlayerController>(GetController());
    if (!PC) { bBoxSelecting = false; return; }
    float ReleaseX = 0.0f, ReleaseY = 0.0f;
    if (PC->GetMousePosition(ReleaseX, ReleaseY))
    {
        SelectionCurrent = FVector2D(ReleaseX, ReleaseY);
    }
    bBoxSelecting = false;
    int32 SelVW=0, SelVH=0; PC->GetViewportSize(SelVW, SelVH);
    if (FVector2D::Distance(SelectionStart, SelectionCurrent) < PhantomInteractionSpec::DpiScaledPixels(PhantomInteractionSpec::DragThreshold1080, SelVH))
    {
        if (APhantomLegendsDirector* Director = LegendsDirector(this)) Director->SelectAtCursor(PC);
    }
    else
    {
        if (APhantomLegendsDirector* Director = LegendsDirector(this)) Director->SelectScreenRect(PC, SelectionStart, SelectionCurrent);
    }
}

void APhantomLegendsPawn::Order() { if (APhantomLegendsDirector* Director = LegendsDirector(this)) Director->OrderAtCursor(Cast<APlayerController>(GetController())); }
void APhantomLegendsPawn::BeginRightOrder()
{
    APlayerController* PC=Cast<APlayerController>(GetController());
    float X=0.0f,Y=0.0f;
    if(!PC || !PC->GetMousePosition(X,Y)) return;
    bRightDragActive=true;
    RightDragStart=RightDragCurrent=FVector2D(X,Y);
}
void APhantomLegendsPawn::EndRightOrder()
{
    if(!bRightDragActive) return;
    bRightDragActive=false;
    APlayerController* PC=Cast<APlayerController>(GetController());
    if(!PC) return;
    float X=0.0f,Y=0.0f; if(PC->GetMousePosition(X,Y)) RightDragCurrent=FVector2D(X,Y);
    int32 VW=0,VH=0; PC->GetViewportSize(VW,VH);
    const float Threshold=PhantomInteractionSpec::DpiScaledPixels(PhantomInteractionSpec::DragThreshold1080,VH);
    if(FVector2D::Distance(RightDragStart,RightDragCurrent)>=Threshold)
    {
        if(APhantomLegendsDirector* Director=LegendsDirector(this)) Director->OrderFormationFromScreenDrag(PC,RightDragStart,RightDragCurrent);
    }
    else Order();
}
void APhantomLegendsPawn::TrainWorker() { if (APhantomLegendsDirector* Director = LegendsDirector(this)) Director->TrainWorker(); }
void APhantomLegendsPawn::TrainGuard() { if (APhantomLegendsDirector* Director = LegendsDirector(this)) Director->TrainGuard(); }
void APhantomLegendsPawn::BuildTower() { if (APhantomLegendsDirector* Director = LegendsDirector(this)) Director->BuildDefenseTower(Cast<APlayerController>(GetController())); }
void APhantomLegendsPawn::TrainRanger() { if (APhantomLegendsDirector* Director = LegendsDirector(this)) Director->TrainRanger(); }
void APhantomLegendsPawn::TrainBrute() { if (APhantomLegendsDirector* Director = LegendsDirector(this)) Director->TrainBrute(); }
void APhantomLegendsPawn::UpgradeStronghold() { if (APhantomLegendsDirector* Director = LegendsDirector(this)) Director->UpgradeStronghold(); }
void APhantomLegendsPawn::SelectArmy() { if (APhantomLegendsDirector* Director = LegendsDirector(this)) Director->SelectAllArmy(); }
void APhantomLegendsPawn::StopSelected() { if (APhantomLegendsDirector* Director = LegendsDirector(this)) Director->StopSelectedUnits(); }
void APhantomLegendsPawn::CenterSelected()
{
    if (APhantomLegendsDirector* Director = LegendsDirector(this))
    {
        const FVector Center = Director->GetSelectedCenter();
        if (!Center.IsNearlyZero())
        {
            FVector Here = GetActorLocation();
            Here.X = Center.X; Here.Y = Center.Y;
            SetActorLocation(Here);
        }
    }
}

void APhantomLegendsPawn::AttackMove()
{
    if (APhantomLegendsDirector* Director = LegendsDirector(this))
        Director->AttackMoveAtCursor(Cast<APlayerController>(GetController()));
}

void APhantomLegendsPawn::HoldSelected()
{
    if (APhantomLegendsDirector* Director = LegendsDirector(this)) Director->HoldSelectedUnits();
}

void APhantomLegendsPawn::PatrolSelected()
{
    if (APhantomLegendsDirector* Director = LegendsDirector(this)) Director->PatrolSelectedUnits(Cast<APlayerController>(GetController()));
}

void APhantomLegendsPawn::FocusCapital()
{
    if (APhantomLegendsDirector* Director = LegendsDirector(this))
    {
        if (APhantomLegendsStructure* Capital = Director->GetStronghold())
        {
            FVector P = GetActorLocation();
            P.X = Capital->GetActorLocation().X;
            P.Y = Capital->GetActorLocation().Y;
            SetActorLocation(P);
        }
    }
}

void APhantomLegendsPawn::ResetCamera()
{
    if (!SpringArm) return;
    SpringArm->SetRelativeRotation(FRotator(-48.0f,-42.0f,0.0f));
    SpringArm->TargetArmLength = 8200.0f;
}

void APhantomLegendsPawn::HandleControlGroup(int32 GroupIndex)
{
    if (APhantomLegendsDirector* Director = LegendsDirector(this))
        Director->HandleControlGroup(Cast<APlayerController>(GetController()), GroupIndex);
}
void APhantomLegendsPawn::ControlGroup1(){HandleControlGroup(0);}
void APhantomLegendsPawn::ControlGroup2(){HandleControlGroup(1);}
void APhantomLegendsPawn::ControlGroup3(){HandleControlGroup(2);}
void APhantomLegendsPawn::ControlGroup4(){HandleControlGroup(3);}
void APhantomLegendsPawn::ControlGroup5(){HandleControlGroup(4);}
void APhantomLegendsPawn::ControlGroup6(){HandleControlGroup(5);}
void APhantomLegendsPawn::ControlGroup7(){HandleControlGroup(6);}
void APhantomLegendsPawn::ControlGroup8(){HandleControlGroup(7);}
void APhantomLegendsPawn::ControlGroup9(){HandleControlGroup(8);}
void APhantomLegendsPawn::HandleCameraBookmark(int32 Index)
{
    if(Index<0||Index>=4||!SpringArm) return;
    APlayerController* PC=Cast<APlayerController>(GetController());
    const bool bSave=PC&&(PC->IsInputKeyDown(EKeys::LeftControl)||PC->IsInputKeyDown(EKeys::RightControl));
    if(bSave){BookmarkLocations[Index]=GetActorLocation();BookmarkRotations[Index]=SpringArm->GetRelativeRotation();BookmarkZoom[Index]=SpringArm->TargetArmLength;BookmarkSet[Index]=true;return;}
    if(!BookmarkSet[Index]) return;
    SetActorLocation(BookmarkLocations[Index]);SpringArm->SetRelativeRotation(BookmarkRotations[Index]);SpringArm->TargetArmLength=BookmarkZoom[Index];
}
void APhantomLegendsPawn::CameraBookmark5(){HandleCameraBookmark(0);} void APhantomLegendsPawn::CameraBookmark6(){HandleCameraBookmark(1);} void APhantomLegendsPawn::CameraBookmark7(){HandleCameraBookmark(2);} void APhantomLegendsPawn::CameraBookmark8(){HandleCameraBookmark(3);}

void APhantomLegendsHUD::DrawHUD()
{
    Super::DrawHUD();
    if (!Canvas) return;
    APhantomLegendsDirector* Director = LegendsDirector(this);
    if (!Director) return;
    // Canvas coordinates are the coordinates DrawHUD actually renders in. Do not replace
    // these with GetViewportSize(): Windows DPI scaling can return a different physical size,
    // which pushed the command deck off-screen in packaged builds.
    const float Width = Canvas->SizeX;
    const float Height = Canvas->SizeY;
    if (DrawPhantomGameShell(this, Director, Width, Height, TEXT("PHANTOM LEGENDS"), TEXT("RIFTBOUND DOMINION // FANTASY RTS"), TEXT("LMB select  SHIFT add  CTRL same-type/remove-drag  ALT military-drag  DOUBLE-CLICK same type\nRMB contextual  RMB-DRAG formation facing  SHIFT+RMB queue  A attack-move  H hold  P patrol  S stop  F focus\n1-9 control groups (CTRL assign / SHIFT add / ALT remove)  F5-F8 camera bookmarks (CTRL save)  WASD+EDGE/MMB pan  ALT+MMB orbit  WHEEL zoom"), FLinearColor(0.65f,0.34f,1.0f))) return;

    const float UIScale = FMath::Clamp(FMath::Min(Width/1920.0f, Height/1080.0f), 0.76f, 1.0f);
    const auto S=[UIScale](float V){return V*UIScale;};
    UFont* Medium = GEngine ? GEngine->GetMediumFont() : nullptr;
    const FLinearColor Panel(0.008f,0.014f,0.028f,0.93f);
    const FLinearColor Purple(0.68f,0.40f,1.0f);
    const FLinearColor Select(0.16f,1.0f,0.48f);
    const float Pad=S(18.0f);

    // Marquee and strong projected selection brackets make the current squad impossible to miss.
    if (const APhantomLegendsPawn* StrategyPawn = Cast<APhantomLegendsPawn>(GetOwningPawn()))
    {
        if (StrategyPawn->IsBoxSelecting())
        {
            const FVector2D A=StrategyPawn->GetSelectionStart(), B=StrategyPawn->GetSelectionCurrent();
            const float X=FMath::Min(A.X,B.X), Y=FMath::Min(A.Y,B.Y), W=FMath::Abs(A.X-B.X), H=FMath::Abs(A.Y-B.Y);
            DrawRect(FLinearColor(0.08f,1.0f,0.40f,0.12f),X,Y,W,H);
            DrawRect(FLinearColor(0.12f,0.92f,0.45f,0.12f),X,Y,W,H);
            DrawLine(X,Y,X+W,Y,Select,3.0f); DrawLine(X,Y+H,X+W,Y+H,Select,3.0f);
            DrawLine(X,Y,X,Y+H,Select,3.0f); DrawLine(X+W,Y,X+W,Y+H,Select,3.0f);
        }
    }
    APlayerController* PC = GetWorld() ? GetWorld()->GetFirstPlayerController() : nullptr;
    if (PC)
    {
        FHitResult HoverHit; PC->GetHitResultUnderCursor(ECC_Visibility,true,HoverHit);
        AActor* Hovered=HoverHit.GetActor();
        for (TActorIterator<APhantomLegendsUnit> It(GetWorld()); It; ++It)
        {
            if (!It->IsPlayerUnit()) continue;
            FVector2D P;
            if (!PC->ProjectWorldLocationToScreen(It->GetActorLocation()+FVector(0,0,80),P)) continue;
            const bool bSel=It->bSelected;
            const bool bHover=Hovered==*It;
            if (!bSel && !bHover) continue;
            const FLinearColor C=bSel ? Select : FLinearColor(1.0f,0.86f,0.24f);
            const float R=bSel ? S(22.0f) : S(17.0f), L=S(8.0f), T=bSel ? 3.0f : 2.0f;
            DrawLine(P.X-R,P.Y-R,P.X-R+L,P.Y-R,C,T); DrawLine(P.X-R,P.Y-R,P.X-R,P.Y-R+L,C,T);
            DrawLine(P.X+R,P.Y-R,P.X+R-L,P.Y-R,C,T); DrawLine(P.X+R,P.Y-R,P.X+R,P.Y-R+L,C,T);
            DrawLine(P.X-R,P.Y+R,P.X-R+L,P.Y+R,C,T); DrawLine(P.X-R,P.Y+R,P.X-R,P.Y+R-L,C,T);
            DrawLine(P.X+R,P.Y+R,P.X+R-L,P.Y+R,C,T); DrawLine(P.X+R,P.Y+R,P.X+R,P.Y+R-L,C,T);
        }
    }

    // AoE-style top resource strip.
    const float TopH=S(72.0f);
    DrawRect(Panel,0,0,Width,TopH);
    DrawText(TEXT("PHANTOM LEGENDS"),FLinearColor::White,Pad,S(9.0f),Medium,S(0.92f));
    DrawText(FString::Printf(TEXT("GOLD %d     WOOD %d     STONE %d     SHARDS %d     POP %d/%d"),Director->GetGold(),Director->GetWood(),Director->GetStone(),Director->GetLegacyShards(),Director->GetLegionPopulation(),Director->GetPopulationCap()),FLinearColor(0.82f,0.90f,0.95f),S(285.0f),S(10.0f),Medium,S(0.70f));
    DrawText(FString::Printf(TEXT("STRONGHOLD %d     VETERANS %d     %d SELECTED"),Director->GetStrongholdLevel(),Director->GetVeteranUnitCount(),Director->GetSelectedCount()),Director->GetSelectedCount()>0?Select:FLinearColor(0.62f,0.70f,0.78f),S(285.0f),S(41.0f),Medium,S(0.62f));
    DrawText(FString::Printf(TEXT("RIFT RAID %02d"),Director->GetRaidWave()+1),FLinearColor(1.0f,0.24f,0.52f),Width-S(235.0f),S(13.0f),Medium,S(0.62f));
    const FString RaidText=Director->GetRaidersAlive()>0?FString::Printf(TEXT("%d HOSTILES"),Director->GetRaidersAlive()):FString::Printf(TEXT("BREACH %.0fs"),Director->GetRaidRemaining());
    DrawText(RaidText,FLinearColor::White,Width-S(235.0f),S(45.0f),Medium,S(0.52f));

    // Bottom command deck, intentionally large enough to operate without memorizing hotkeys.
    const float DockH=S(150.0f), DockY=Height-DockH;
    DrawRect(Panel,0,DockY,Width,DockH); DrawRect(Purple,0,DockY,Width,S(3.0f));
    const TCHAR* Labels[]={TEXT("[Q] WORKER"),TEXT("[W] GUARD"),TEXT("[E] TOWER"),TEXT("[R] RANGER"),TEXT("[T] BRUTE")};
    const TCHAR* Costs[]={TEXT("75 GOLD"),TEXT("110 GOLD"),TEXT("120W + 80S"),TEXT("140 GOLD"),TEXT("180G + 80S")};
    const float ButtonW=FMath::Min(S(190.0f),(Width-S(36.0f))/5.0f-S(8.0f));
    for(int32 I=0;I<5;++I){const float X=Pad+I*(ButtonW+S(8.0f));DrawRect(FLinearColor(0.035f,0.050f,0.073f,0.98f),X,DockY+S(14.0f),ButtonW,S(72.0f));DrawRect(Purple,X,DockY+S(14.0f),S(4.0f),S(72.0f));DrawText(Labels[I],FLinearColor::White,X+S(12.0f),DockY+S(23.0f),Medium,S(0.62f));DrawText(Costs[I],FLinearColor(1.0f,0.72f,0.22f),X+S(12.0f),DockY+S(54.0f),Medium,S(0.52f));}
    DrawText(Director->GetRealmStatus(),FLinearColor(0.72f,0.82f,0.90f),Pad,DockY+S(96.0f),Medium,S(0.60f));
    DrawText(TEXT("DRAG SELECT   RMB ORDER   A ATTACK-MOVE   H HOLD   P PATROL   1-9 GROUPS"),FLinearColor(0.42f,0.86f,0.98f),Pad,DockY+S(124.0f),Medium,S(0.50f));

    // Compact tactical minimap.
    const float MapW=S(215.0f), MapH=S(145.0f), MapX=Width-MapW-S(24.0f), MapY=TopH+S(18.0f);
    DrawRect(FLinearColor(0.006f,0.014f,0.028f,0.90f),MapX,MapY,MapW,MapH);
    DrawRect(Purple,MapX,MapY,MapW,S(2.0f));
    const auto MP=[MapX,MapY,MapW,MapH](const FVector& L){return FVector2D(MapX+FMath::Clamp((L.X+200000.0f)/400000.0f,0.0f,1.0f)*MapW,MapY+(1.0f-FMath::Clamp((L.Y+200000.0f)/400000.0f,0.0f,1.0f))*MapH);};
    for(TActorIterator<APhantomLegendsStructure> It(GetWorld());It;++It){const FVector2D P=MP(It->GetActorLocation());const FLinearColor C=It->GetFaction()==EPhantomLegendsFaction::Legion?FLinearColor(0.15f,0.82f,1.0f):FLinearColor(1.0f,0.15f,0.45f);DrawRect(C,P.X-S(4),P.Y-S(4),S(8),S(8));}
    for(TActorIterator<APhantomLegendsUnit> It(GetWorld());It;++It){const FVector2D P=MP(It->GetActorLocation());const FLinearColor C=It->IsPlayerUnit()?(It->bSelected?Select:FLinearColor(0.15f,0.72f,1.0f)):FLinearColor(1.0f,0.20f,0.28f);const float D=It->bSelected?S(6):S(4);DrawRect(C,P.X-D*0.5f,P.Y-D*0.5f,D,D);}
    DrawText(TEXT("TACTICAL"),FLinearColor(0.64f,0.74f,0.86f),MapX+S(8.0f),MapY+S(6.0f),Medium,S(0.38f));
}

APhantomLegendsDirector::APhantomLegendsDirector()
{
    PrimaryActorTick.bCanEverTick = true;
}

void APhantomLegendsDirector::BeginPlay()
{
    Super::BeginPlay();
    LoadProgress();
    BuildRealm();
    // A deliberate opening formation keeps economy, army and threat readable at a glance.
    const FVector LegionAnchor=Stronghold?Stronghold->GetActorLocation():FVector(-120000.0f,-95000.0f,35.0f);
    for(int32 I=0;I<8;++I)
    {
        SpawnUnit(EPhantomLegendsRole::Worker,EPhantomLegendsFaction::Legion,
            LegionAnchor+FVector(900.0f+(I%4)*330.0f,-900.0f+(I/4)*620.0f,55.0f));
    }
    for(int32 I=0;I<12;++I)
    {
        const EPhantomLegendsRole UnitRole=I%3==0?EPhantomLegendsRole::Ranger:(I%3==1?EPhantomLegendsRole::Guard:EPhantomLegendsRole::Brute);
        SpawnUnit(UnitRole,EPhantomLegendsFaction::Legion,
            LegionAnchor+FVector(2600.0f+(I%4)*420.0f,700.0f+(I/4)*560.0f,55.0f));
    }
    // A scouting patrol starts at the first contested river crossing, not on top of the capital.
    SpawnUnit(EPhantomLegendsRole::Raider, EPhantomLegendsFaction::Rift, FVector(-111500.0f,-87000.0f,90.0f));
    SpawnUnit(EPhantomLegendsRole::Raider, EPhantomLegendsFaction::Rift, FVector(-110900.0f,-87500.0f,90.0f));
    SpawnUnit(EPhantomLegendsRole::Brute, EPhantomLegendsFaction::Rift, FVector(-110300.0f,-86800.0f,90.0f));
    SpawnUnit(EPhantomLegendsRole::Ranger, EPhantomLegendsFaction::Rift, FVector(-109800.0f,-88000.0f,90.0f));
    SpawnUnit(EPhantomLegendsRole::Raider, EPhantomLegendsFaction::Rift, FVector(-109300.0f,-87200.0f,90.0f));
    SpawnUnit(EPhantomLegendsRole::Brute, EPhantomLegendsFaction::Rift, FVector(-108800.0f,-88400.0f,90.0f));
    if (APhantomLegendsPawn* StrategyPawn=Cast<APhantomLegendsPawn>(UGameplayStatics::GetPlayerPawn(this,0)))
    {
        if(Stronghold) StrategyPawn->SetActorLocation(Stronghold->GetActorLocation()+FVector(1900.0f,200.0f,90.0f));
    }
    RaidersAlive = 6;
    RealmStatus = TEXT("RIFT PATROL SIGHTED // TAB SELECTS ARMY, RIGHT-CLICK HOSTILES TO ATTACK");
}

void APhantomLegendsDirector::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    // Destroyed units are weak references, but leaving dead entries in selection/control groups makes
    // the HUD count lie and causes command groups to feel unreliable after a battle. Prune every frame;
    // these arrays are tiny compared with the unit simulation itself.
    SelectedUnits.RemoveAll([](const TWeakObjectPtr<APhantomLegendsUnit>& Unit){ return !Unit.IsValid(); });
    for (TArray<TWeakObjectPtr<APhantomLegendsUnit>>& Group : ControlGroups)
        Group.RemoveAll([](const TWeakObjectPtr<APhantomLegendsUnit>& Unit){ return !Unit.IsValid(); });
    EconomyAccumulator += DeltaSeconds;
    SaveAccumulator += DeltaSeconds;
    if (EconomyAccumulator >= 1.0f)
    {
        EconomyAccumulator -= 1.0f;
        int32 Workers = 0;
        for (TActorIterator<APhantomLegendsUnit> It(GetWorld()); It; ++It)
        {
            if (!It->IsPlayerUnit()) continue;
            if (It->GetRole() == EPhantomLegendsRole::Worker) ++Workers;
            if (Stronghold && FVector::DistSquared2D(It->GetActorLocation(), Stronghold->GetActorLocation()) <= FMath::Square(680.0f))
            {
                It->RestoreHealth(3.0f + StrongholdLevel * 1.5f);
            }
        }
        Gold += Workers;
    }
    const bool bRiftGateActive = RiftGate && RiftGate->GetHealth() > 0.0f;
    if (RaidersAlive <= 0 && RealmResetRemaining <= 0.0f && bRiftGateActive)
    {
        RaidRemaining -= DeltaSeconds;
        if (RaidRemaining <= 0.0f) SpawnRaid();
    }
    if (RealmResetRemaining > 0.0f)
    {
        RealmResetRemaining -= DeltaSeconds;
        if (RealmResetRemaining <= 0.0f)
        {
            Gold = FMath::Max(200, Gold);
            Wood = FMath::Max(160, Wood);
            Stone = FMath::Max(100, Stone);
            if (Stronghold) Stronghold->Configure(EPhantomLegendsStructureType::Stronghold, EPhantomLegendsFaction::Legion, StrongholdLevel);
            RealmStatus = TEXT("THE LEGION REFORMS // FORTIFY THE FRONTIER");
            RaidRemaining = 10.0f;
        }
    }
    if (SaveAccumulator >= 8.0f)
    {
        SaveAccumulator = 0.0f;
        SaveProgress();
    }
}

void APhantomLegendsDirector::BuildRealm()
{
    SpawnSun(4.25f, FRotator(-45.0f,-34.0f,0.0f), FLinearColor(1.0f,0.88f,0.70f));
    SetWorldMood(FLinearColor(0.08f,0.12f,0.10f),0.0014f,FLinearColor(0.34f,0.42f,0.48f));

    // V10 PRODUCTION MAP: macro terrain, roads, river, capitals, settlements and forests are
    // persistent editor-authored actors. Runtime creates only interactive RTS state. This avoids
    // V9 rendering the persistent 4km map AND the old giant BeginPlay environment simultaneously.
    const bool bProductionWorld = GetWorld() && GetWorld()->GetMapName().Contains(TEXT("PhantomLegends_World"));
    if (bProductionWorld)
    {
        if (AStaticMeshActor* RealmCollision=SpawnBlock(TEXT("RealmCollision"),FVector(0,0,-40),FVector(409600,409600,80),FLinearColor::Black))
            RealmCollision->SetActorHiddenInGame(true);
        Stronghold=GetWorld()->SpawnActor<APhantomLegendsStructure>(FVector(-120000,-95000,35),FRotator(0,18,0));
        if(Stronghold)
        {
            Stronghold->Configure(EPhantomLegendsStructureType::Stronghold,EPhantomLegendsFaction::Legion,StrongholdLevel);
            Stronghold->SetActorHiddenInGame(true);
            Stronghold->SetActorScale3D(FVector::ZeroVector);
        }
        RiftGate=GetWorld()->SpawnActor<APhantomLegendsStructure>(FVector(120000,95000,35),FRotator(0,198,0));
        if(RiftGate)
        {
            RiftGate->Configure(EPhantomLegendsStructureType::RiftGate,EPhantomLegendsFaction::Rift,FMath::Max(1,RaidWave));
            RiftGate->SetActorHiddenInGame(true);
            RiftGate->SetActorScale3D(FVector::ZeroVector);
        }
        struct FProdResource{FVector P;EPhantomLegendsResource Type;int32 Amount;};
        const FProdResource Nodes[]={
            {FVector(-104000,-81000,40),EPhantomLegendsResource::Wood,1600},{FVector(-103000,-101000,40),EPhantomLegendsResource::Stone,1300},
            {FVector(-110000,-112000,40),EPhantomLegendsResource::Gold,1200},{FVector(-96000,-86000,40),EPhantomLegendsResource::Shard,800},
            {FVector(-75000,65000,40),EPhantomLegendsResource::Gold,1500},{FVector(72000,-68000,40),EPhantomLegendsResource::Shard,1100},
            {FVector(-26000,132000,40),EPhantomLegendsResource::Wood,1800},{FVector(31000,-132000,40),EPhantomLegendsResource::Stone,1600}
        };
        for(const FProdResource& R:Nodes){APhantomLegendsResourceNode* N=GetWorld()->SpawnActor<APhantomLegendsResourceNode>(R.P,FRotator::ZeroRotator);if(N)N->Configure(R.Type,R.Amount);}
        return;
    }

    // CANONICAL PHANTOM LEGENDS WORLD: exactly 4,096m x 4,096m. One persistent premium RTS battlefield.
    // World Partition/HLOD may optimize it later; the gameplay contract and strategic footprint remain fixed.
    SpawnBlock(TEXT("RealmOverscan"),FVector(0,0,-185),FVector(425000,425000,180),FLinearColor(0.012f,0.030f,0.022f),FRotator::ZeroRotator,false);
    // V8 MAX WORLD SURFACE: keep collision deterministic, but never render a 4 km green cube as the battlefield.
    if (AStaticMeshActor* RealmCollision = SpawnBlock(TEXT("RealmCollision"),FVector(0,0,-40),FVector(409600,409600,80),FLinearColor::Black))
        RealmCollision->SetActorHiddenInGame(true);
    for(int32 TY=0; TY<4; ++TY)
    {
        for(int32 TX=0; TX<4; ++TX)
        {
            const FString TerrainPath = FString::Printf(TEXT("/Game/Phantom/Generated/Legends/V8/Terrain/SM_V8_LegendsTerrain_%d%d.SM_V8_LegendsTerrain_%d%d"),TY,TX,TY,TX);
            SpawnStaticMeshAsset(FString::Printf(TEXT("V8RealmTerrain_%d%d"),TY,TX),TerrainPath,
                FVector((TX-1.5f)*102400.0f,(TY-1.5f)*102400.0f,-5.0f),FVector(1.0f),FRotator::ZeroRotator,false,false);
        }
    }

    // Broad strategic river, five crossings. Crossing control matters instead of one bridge filling the screen.
    SpawnBlock(TEXT("RiftRiver"),FVector(650,0,-9),FVector(18000,409600,24),FLinearColor(0.025f,0.16f,0.29f),FRotator::ZeroRotator,false);
    SpawnBlock(TEXT("RiverBankWest"),FVector(40,0,0),FVector(900,409600,32),FLinearColor(0.11f,0.20f,0.095f),FRotator::ZeroRotator,false);
    SpawnBlock(TEXT("RiverBankEast"),FVector(1260,0,0),FVector(900,409600,32),FLinearColor(0.11f,0.20f,0.095f),FRotator::ZeroRotator,false);
    const float BridgeY[]={-150000.0f,-100000.0f,-50000.0f,-250.0f,50000.0f,100000.0f,150000.0f};
    for(int32 I=0;I<UE_ARRAY_COUNT(BridgeY);++I)
    {
        if(!SpawnStaticMeshAsset(FString::Printf(TEXT("RealmBridge_%02d"),I),TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Bridge.SM_CC0_Bridge"),FVector(650,BridgeY[I],22),FVector(2.35f),FRotator(0,90,0),true,true))
            SpawnStaticMeshAsset(FString::Printf(TEXT("RealmBridgeFallback_%02d"),I),TEXT("/Game/Phantom/Generated/Legends/SM_StoneBridge.SM_StoneBridge"),FVector(650,BridgeY[I],22),FVector(1.9f),FRotator(0,90,0),true,true);
    }

    Stronghold=GetWorld()->SpawnActor<APhantomLegendsStructure>(FVector(-120000,-95000,35),FRotator(0,18,0));
    if(Stronghold) Stronghold->Configure(EPhantomLegendsStructureType::Stronghold,EPhantomLegendsFaction::Legion,StrongholdLevel);
    RiftGate=GetWorld()->SpawnActor<APhantomLegendsStructure>(FVector(120000,95000,35),FRotator(0,198,0));
    if(RiftGate) RiftGate->Configure(EPhantomLegendsStructureType::RiftGate,EPhantomLegendsFaction::Rift,FMath::Max(1,RaidWave));

    // V8 GUARANTEED CAPITAL SILHOUETTES: these bundled meshes exist even when a network/Fab pack is unavailable.
    const FVector LegionCapital = Stronghold ? Stronghold->GetActorLocation() : FVector(-120000,-95000,35);
    const FVector RiftCapital = RiftGate ? RiftGate->GetActorLocation() : FVector(120000,95000,35);
    for(int32 I=0; I<18; ++I)
    {
        const float A=I*(2.0f*PI/18.0f);
        const float R=4300.0f+(I%3)*1500.0f;
        const FVector LP=LegionCapital+FVector(FMath::Cos(A)*R,FMath::Sin(A)*R,0);
        const FVector RP=RiftCapital+FVector(FMath::Cos(A+PI)*R,FMath::Sin(A+PI)*R,0);
        SpawnStaticMeshAsset(FString::Printf(TEXT("V8LegionCapitalHouse_%02d"),I),TEXT("/Game/Phantom/Generated/Legends/V8/Architecture/SM_V8_LegendsHouse.SM_V8_LegendsHouse"),LP,FVector(1.0f),FRotator(0,A*180.0f/PI+90.0f,0),true,true);
        SpawnStaticMeshAsset(FString::Printf(TEXT("V8RiftCapitalHouse_%02d"),I),TEXT("/Game/Phantom/Generated/Legends/V8/Architecture/SM_V8_LegendsHouse.SM_V8_LegendsHouse"),RP,FVector(1.0f),FRotator(0,A*180.0f/PI-90.0f,0),true,true);
    }
    for(int32 I=0; I<6; ++I)
    {
        const float O=(I-2.5f)*2600.0f;
        SpawnStaticMeshAsset(FString::Printf(TEXT("V8LegionCapitalTower_%02d"),I),TEXT("/Game/Phantom/Generated/Legends/V8/Architecture/SM_V8_LegendsTower.SM_V8_LegendsTower"),LegionCapital+FVector(O,7200.0f,0),FVector(1.0f),FRotator::ZeroRotator,true,true);
        SpawnStaticMeshAsset(FString::Printf(TEXT("V8RiftCapitalTower_%02d"),I),TEXT("/Game/Phantom/Generated/Legends/V8/Architecture/SM_V8_RiftTower.SM_V8_RiftTower"),RiftCapital+FVector(O,-7200.0f,0),FVector(1.0f),FRotator(0,180,0),true,true);
    }

    const TCHAR* Houses[]={TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_House_A.SM_CC0_House_A"),TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_House_B.SM_CC0_House_B"),TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_House_C.SM_CC0_House_C")};

    // Legion base: production, housing, market and walls occupy a real base footprint.
    const FVector LegionHomes[]={
        FVector(-12100,-8650,18),FVector(-11300,-8800,18),FVector(-10200,-8950,18),FVector(-9150,-8800,18),
        FVector(-12250,-7250,18),FVector(-11400,-6500,18),FVector(-10050,-6250,18),FVector(-9000,-6600,18),
        FVector(-11800,-5200,18),FVector(-10500,-5050,18),FVector(-9150,-5200,18),FVector(-8300,-5900,18)};
    for(int32 I=0;I<UE_ARRAY_COUNT(LegionHomes);++I)
        SpawnStaticMeshAsset(FString::Printf(TEXT("LegionHome_%02d"),I),Houses[I%3],LegionHomes[I],FVector(1.15f+(I%3)*0.07f),FRotator(0,(I%5)*9.0f-18.0f,0),true,true);
    SpawnStaticMeshAsset(TEXT("LegionBarracks"),TEXT("/Game/Phantom/Curated/Legends/SM_Legends_Barracks.SM_Legends_Barracks"),FVector(-8750,-7650,18),FVector(1.8f),FRotator(0,-4,0),true,true);
    SpawnStaticMeshAsset(TEXT("LegionMarket"),TEXT("/Game/Phantom/Curated/Legends/SM_Legends_Market.SM_Legends_Market"),FVector(-9650,-5650,18),FVector(1.5f),FRotator(0,8,0),false,true);
    for(int32 I=0;I<22;++I)
        SpawnStaticMeshAsset(FString::Printf(TEXT("LegionSouthWall_%02d"),I),TEXT("/Game/Phantom/Curated/Legends/SM_Legends_Wall.SM_Legends_Wall"),FVector(-13200+I*470,-9800,18),FVector(0.98f),FRotator::ZeroRotator,true,true);
    for(int32 I=0;I<14;++I)
        SpawnStaticMeshAsset(FString::Printf(TEXT("LegionWestWall_%02d"),I),TEXT("/Game/Phantom/Curated/Legends/SM_Legends_Wall.SM_Legends_Wall"),FVector(-13200,-9550+I*610,18),FVector(0.98f),FRotator(0,90,0),true,true);
    const FVector LegionTowers[]={FVector(-13200,-9800,18),FVector(-3330,-9800,18),FVector(-13200,-1700,18),FVector(-8300,-9800,18),FVector(-13200,-5750,18)};
    for(int32 I=0;I<UE_ARRAY_COUNT(LegionTowers);++I)
        SpawnStaticMeshAsset(FString::Printf(TEXT("LegionWatchtower_%02d"),I),TEXT("/Game/Phantom/Curated/Legends/SM_Legends_Tower.SM_Legends_Tower"),LegionTowers[I],FVector(1.3f),FRotator::ZeroRotator,true,true);

    // Rift base occupies the opposite quadrant with room for raids to stage before crossing the map.
    for(int32 I=0;I<22;++I)
        SpawnStaticMeshAsset(FString::Printf(TEXT("RiftNorthWall_%02d"),I),TEXT("/Game/Phantom/Curated/Legends/SM_Legends_Wall.SM_Legends_Wall"),FVector(3200+I*470,9800,18),FVector(0.98f),FRotator(0,180,0),true,true);
    for(int32 I=0;I<14;++I)
        SpawnStaticMeshAsset(FString::Printf(TEXT("RiftEastWall_%02d"),I),TEXT("/Game/Phantom/Curated/Legends/SM_Legends_Wall.SM_Legends_Wall"),FVector(13200,1900+I*610,18),FVector(0.98f),FRotator(0,90,0),true,true);
    const FVector RiftTowers[]={FVector(3200,9800,18),FVector(13200,9800,18),FVector(13200,1900,18),FVector(8200,9800,18)};
    for(int32 I=0;I<UE_ARRAY_COUNT(RiftTowers);++I)
        SpawnStaticMeshAsset(FString::Printf(TEXT("RiftTower_%02d"),I),TEXT("/Game/Phantom/Curated/Legends/SM_Legends_Tower.SM_Legends_Tower"),RiftTowers[I],FVector(1.3f),FRotator::ZeroRotator,true,true);
    for(int32 I=0;I<14;++I)
    {
        const FVector P(8700+(I%5)*610,5600+(I/5)*680,18);
        SpawnStaticMeshAsset(FString::Printf(TEXT("RiftObelisk_%02d"),I),TEXT("/Game/Phantom/Generated/Legends/SM_RiftObelisk.SM_RiftObelisk"),P,FVector(0.86f),FRotator(0,I*23,0),false,true);
        if(I<8) SpawnPointLight(FString::Printf(TEXT("RiftObeliskLight_%02d"),I),P+FVector(0,0,300),FLinearColor(0.52f,0.08f,0.92f),1050.0f,290.0f,false);
    }

    // Three expansion districts make macro play meaningful instead of concentrating every resource at center.
    const FVector ExpansionCenters[]={FVector(-7700,2500,20),FVector(7500,-2700,20),FVector(-1800,6900,20)};
    for(int32 E=0;E<UE_ARRAY_COUNT(ExpansionCenters);++E)
    {
        const FVector C=ExpansionCenters[E];
        for(int32 H=0;H<3;++H)
            SpawnStaticMeshAsset(FString::Printf(TEXT("Expansion%d_House%d"),E,H),Houses[(E+H)%3],C+FVector((H-1)*580,(H%2)*520,0),FVector(0.92f),FRotator(0,H*20,0),true,true);
        SpawnStaticMeshAsset(FString::Printf(TEXT("Expansion%d_Well"),E),TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Well.SM_CC0_Well"),C+FVector(0,-480,0),FVector(0.9f),FRotator::ZeroRotator,false,true);
    }

    // Neutral center ruins: enough obstruction for flanking/kiting, not a wall across the whole battlefield.
    const FVector RuinCenter(450,-250,18);
    for(int32 I=-4;I<=4;++I)
    {
        if(I!=0 && I!=1) SpawnStaticMeshAsset(FString::Printf(TEXT("MidRuinNorth_%d"),I),TEXT("/Game/Phantom/Curated/Legends/SM_Legends_Wall.SM_Legends_Wall"),RuinCenter+FVector(I*520,1250,0),FVector(0.9f),FRotator::ZeroRotator,true,true);
        if(FMath::Abs(I)>2) SpawnStaticMeshAsset(FString::Printf(TEXT("MidRuinSouth_%d"),I),TEXT("/Game/Phantom/Curated/Legends/SM_Legends_Wall.SM_Legends_Wall"),RuinCenter+FVector(I*520,-1250,0),FVector(0.9f),FRotator(0,180,0),true,true);
    }
    SpawnStaticMeshAsset(TEXT("MidRuinTowerWest"),TEXT("/Game/Phantom/Curated/Legends/SM_Legends_Tower.SM_Legends_Tower"),RuinCenter+FVector(-2600,1000,0),FVector(0.98f),FRotator::ZeroRotator,true,true);
    SpawnStaticMeshAsset(TEXT("MidRuinTowerEast"),TEXT("/Game/Phantom/Curated/Legends/SM_Legends_Tower.SM_Legends_Tower"),RuinCenter+FVector(2600,-1000,0),FVector(0.98f),FRotator::ZeroRotator,true,true);

    // Forests are smaller tactical clusters distributed around the huge realm, never a giant enclosing ring.
    const FVector ForestCenters[]={
        FVector(-11200,4200,0),FVector(-9000,7200,0),FVector(-6200,8500,0),FVector(-4000,4300,0),
        FVector(4300,-8200,0),FVector(7600,-7200,0),FVector(10800,-4700,0),FVector(9500,-600,0),
        FVector(-10500,-500,0),FVector(11200,2700,0),FVector(-2500,-7600,0),FVector(3400,7200,0)};
    int32 TreeIndex=0;
    for(const FVector& Center:ForestCenters)
    {
        for(int32 J=0;J<8;++J)
        {
            const float A=J*(2.0f*PI/8.0f)+(TreeIndex%3)*0.14f;
            const float R=260.0f+(J%4)*190.0f;
            const FVector P=Center+FVector(FMath::Cos(A)*R,FMath::Sin(A)*R,18);
            const TCHAR* Tree=J%3==0?TEXT("/Game/Phantom/UnityHarvest/Legends/character/U_Legends_0009_PineTrees.U_Legends_0009_PineTrees"):TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Tree_A.SM_CC0_Tree_A");
            SpawnStaticMeshAsset(FString::Printf(TEXT("RealmTree_%03d"),TreeIndex++),Tree,P,FVector(0.66f+(J%3)*0.06f),FRotator(0,J*31,0),false,true);
        }
    }

    struct FResourceSpawn { FVector P; EPhantomLegendsResource Type; int32 Amount; };
    const FResourceSpawn Resources[]={
        // Legion safe resources
        {FVector(-9800,-5400,40),EPhantomLegendsResource::Wood,1200},{FVector(-11100,-4700,40),EPhantomLegendsResource::Stone,900},{FVector(-8700,-5000,40),EPhantomLegendsResource::Gold,780},
        // West expansion
        {FVector(-7900,1800,40),EPhantomLegendsResource::Wood,1050},{FVector(-6900,3000,40),EPhantomLegendsResource::Stone,900},{FVector(-8200,3600,40),EPhantomLegendsResource::Gold,920},{FVector(-6100,2100,40),EPhantomLegendsResource::Shard,520},
        // South-east expansion
        {FVector(6500,-3600,40),EPhantomLegendsResource::Wood,1100},{FVector(7800,-3200,40),EPhantomLegendsResource::Stone,920},{FVector(8500,-1900,40),EPhantomLegendsResource::Gold,900},{FVector(5700,-2200,40),EPhantomLegendsResource::Shard,500},
        // North expansion
        {FVector(-2500,6100,40),EPhantomLegendsResource::Wood,1000},{FVector(-1000,7700,40),EPhantomLegendsResource::Stone,900},{FVector(-3100,8100,40),EPhantomLegendsResource::Gold,880},
        // Contested middle
        {FVector(-2200,-400,40),EPhantomLegendsResource::Gold,1050},{FVector(2900,500,40),EPhantomLegendsResource::Shard,820},{FVector(3600,-1100,40),EPhantomLegendsResource::Stone,980},
        // Rift-side resources
        {FVector(9100,5200,40),EPhantomLegendsResource::Wood,1100},{FVector(10100,4700,40),EPhantomLegendsResource::Stone,950},{FVector(11500,5300,40),EPhantomLegendsResource::Gold,820}
    };
    for(int32 I=0;I<UE_ARRAY_COUNT(Resources);++I)
    {
        APhantomLegendsResourceNode* Node=GetWorld()->SpawnActor<APhantomLegendsResourceNode>(Resources[I].P,FRotator(0,I*17,0));
        if(Node) Node->Configure(Resources[I].Type,Resources[I].Amount);
    }

    // CAPITAL CONTENT: V6 requires imported creator assets before packaging; capital structures therefore use
    // curated real-asset aliases rather than generated placeholder architecture.
    struct FCapitalProp { const TCHAR* Name; const TCHAR* Mesh; FVector P; FVector S; float Yaw; };
    const FCapitalProp CapitalProps[]={
        {TEXT("LegionFarmA"),TEXT("/Game/Phantom/Curated/Legends/SM_Legends_Windmill.SM_Legends_Windmill"),FVector(-9700,-6100,18),FVector(1.25f),12},
        {TEXT("LegionFarmB"),TEXT("/Game/Phantom/Curated/Legends/SM_Legends_Windmill.SM_Legends_Windmill"),FVector(-8200,-6300,18),FVector(1.25f),-8},
        {TEXT("LegionMine"),TEXT("/Game/Phantom/Curated/Legends/SM_Legends_Mine.SM_Legends_Mine"),FVector(-11200,-3500,18),FVector(1.28f),30},
        {TEXT("LegionBarracks"),TEXT("/Game/Phantom/Curated/Legends/SM_Legends_Barracks.SM_Legends_Barracks"),FVector(-7300,-3200,18),FVector(1.32f),0},
        {TEXT("LegionArcaneTower"),TEXT("/Game/Phantom/Curated/Legends/SM_Legends_Tower.SM_Legends_Tower"),FVector(-10100,-1200,18),FVector(1.22f),0},
        {TEXT("LegionShrine"),TEXT("/Game/Phantom/Curated/Legends/SM_Legends_Ruin.SM_Legends_Ruin"),FVector(-5700,-4800,18),FVector(1.20f),18},
        {TEXT("LegionDragonRoost"),TEXT("/Game/Phantom/Curated/Legends/SM_Legends_Tower.SM_Legends_Tower"),FVector(-12200,-6800,18),FVector(1.20f),45},
        {TEXT("RiftFarmA"),TEXT("/Game/Phantom/Curated/Legends/SM_Legends_Windmill.SM_Legends_Windmill"),FVector(9700,6500,18),FVector(1.18f),190},
        {TEXT("RiftFarmB"),TEXT("/Game/Phantom/Curated/Legends/SM_Legends_Windmill.SM_Legends_Windmill"),FVector(8200,6300,18),FVector(1.18f),170},
        {TEXT("RiftMine"),TEXT("/Game/Phantom/Curated/Legends/SM_Legends_Mine.SM_Legends_Mine"),FVector(11300,3500,18),FVector(1.32f),210},
        {TEXT("RiftBarracks"),TEXT("/Game/Phantom/Curated/Legends/SM_Legends_Barracks.SM_Legends_Barracks"),FVector(7300,3300,18),FVector(1.34f),180},
        {TEXT("RiftArcaneTower"),TEXT("/Game/Phantom/Curated/Legends/SM_Legends_Tower.SM_Legends_Tower"),FVector(10100,1300,18),FVector(1.28f),180},
        {TEXT("RiftShrine"),TEXT("/Game/Phantom/Curated/Legends/SM_Legends_Ruin.SM_Legends_Ruin"),FVector(5700,4800,18),FVector(1.20f),198},
        {TEXT("RiftDragonRoost"),TEXT("/Game/Phantom/Curated/Legends/SM_Legends_Tower.SM_Legends_Tower"),FVector(12200,6800,18),FVector(1.24f),225}
    };
    for(const FCapitalProp& P:CapitalProps)
        SpawnStaticMeshAsset(P.Name,P.Mesh,P.P,P.S,FRotator(0,P.Yaw,0),true,true);

    // Production-scale relocation pass: preserve coherent local building spacing while placing the two cities
    // across a 4 km theater. This avoids the old mistake of uniformly scaling houses into gigantic props.
    const FVector LegionDistrictOffset(-109600.0f,-87800.0f,0.0f);
    const FVector RiftDistrictOffset(109200.0f,87650.0f,0.0f);
    for(TActorIterator<AStaticMeshActor> It(GetWorld());It;++It)
    {
        // SpawnStaticMeshAsset stores semantic names in Actor Tags, not UObject names. The previous
        // relocation pass checked GetName(), so almost the entire capital remained near world origin
        // while the camera started 1.2 km away beside the stronghold.
        bool bLegionTagged=false;
        bool bRiftTagged=false;
        bool bRiverTagged=false;
        for(const FName& Tag:It->Tags)
        {
            const FString T=Tag.ToString();
            bLegionTagged |= T.Contains(TEXT("Legion"));
            bRiftTagged |= T.Contains(TEXT("Rift"));
            bRiverTagged |= T.Contains(TEXT("River"));
        }
        if(bLegionTagged) It->AddActorWorldOffset(LegionDistrictOffset);
        else if(bRiftTagged && !bRiverTagged) It->AddActorWorldOffset(RiftDistrictOffset);
    }
    // Safe resource clusters follow the capitals; contested resources remain near the central river.
    for(TActorIterator<APhantomLegendsResourceNode> It(GetWorld());It;++It)
    {
        const FVector P=It->GetActorLocation();
        if(P.X < -6000.0f && P.Y < -4000.0f) It->AddActorWorldOffset(LegionDistrictOffset);
        else if(P.X > 8500.0f && P.Y > 4000.0f) It->AddActorWorldOffset(RiftDistrictOffset);
    }

    // Additional macro settlements/resources make panning outward meaningful rather than revealing empty void.
    const FVector MacroCenters[]={FVector(-80000,70000,18),FVector(78000,-72000,18),FVector(-25000,125000,18),FVector(30000,-128000,18)};
    for(int32 M=0;M<UE_ARRAY_COUNT(MacroCenters);++M)
    {
        const FVector C=MacroCenters[M];
        for(int32 J=0;J<7;++J)
        {
            const float A=J*(2.0f*PI/7.0f); const FVector P=C+FVector(FMath::Cos(A)*1700.0f,FMath::Sin(A)*1700.0f,0);
            SpawnStaticMeshAsset(FString::Printf(TEXT("Macro%d_House%d"),M,J),Houses[(M+J)%3],P,FVector(1.05f),FRotator(0,A*180.0f/PI+90.0f,0),true,true);
        }
        SpawnStaticMeshAsset(FString::Printf(TEXT("Macro%d_Well"),M),TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Well.SM_CC0_Well"),C,FVector(1.0f),FRotator::ZeroRotator,false,true);
        for(int32 J=0;J<12;++J)
        {
            const float A=J*(2.0f*PI/12.0f); const FVector P=C+FVector(FMath::Cos(A)*FMath::FRandRange(2600.0f,5200.0f),FMath::Sin(A)*FMath::FRandRange(2600.0f,5200.0f),0);
            SpawnStaticMeshAsset(FString::Printf(TEXT("Macro%d_Tree%d"),M,J),J%2?TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Tree_A.SM_CC0_Tree_A"):TEXT("/Game/Phantom/UnityHarvest/Legends/character/U_Legends_0009_PineTrees.U_Legends_0009_PineTrees"),P,FVector(0.72f),FRotator(0,J*29.0f,0),false,true);
        }
        const EPhantomLegendsResource Types[]={EPhantomLegendsResource::Wood,EPhantomLegendsResource::Stone,EPhantomLegendsResource::Gold,EPhantomLegendsResource::Shard};
        for(int32 J=0;J<4;++J){APhantomLegendsResourceNode* Node=GetWorld()->SpawnActor<APhantomLegendsResourceNode>(C+FVector((J-1.5f)*1100.0f,2200.0f,40),FRotator::ZeroRotator);if(Node)Node->Configure(Types[J],1000+J*250);}
    }

    // Additional strategic biome/ruin anchors stop the 4 km world from becoming empty between settlements.
    const FVector StrategicHubs[]={
        FVector(-155000,45000,18),FVector(-145000,145000,18),FVector(-55000,165000,18),FVector(55000,155000,18),
        FVector(150000,145000,18),FVector(160000,35000,18),FVector(145000,-65000,18),FVector(90000,-155000,18),
        FVector(-20000,-165000,18),FVector(-115000,-150000,18),FVector(-165000,-60000,18),FVector(0,0,18)
    };
    for(int32 H=0;H<UE_ARRAY_COUNT(StrategicHubs);++H)
    {
        const FVector C=StrategicHubs[H];
        for(int32 J=0;J<10;++J)
        {
            const float A=J*(2.0f*PI/10.0f)+H*0.21f;
            const float R=2300.0f+(J%4)*1200.0f;
            SpawnStaticMeshAsset(FString::Printf(TEXT("StrategicHub%d_Tree%d"),H,J),
                J%3==0?TEXT("/Game/Phantom/UnityHarvest/Legends/character/U_Legends_0009_PineTrees.U_Legends_0009_PineTrees"):TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Tree_A.SM_CC0_Tree_A"),
                C+FVector(FMath::Cos(A)*R,FMath::Sin(A)*R,0),FVector(0.72f+(J%3)*0.08f),FRotator(0,J*31.0f,0),false,true);
        }
        SpawnStaticMeshAsset(FString::Printf(TEXT("StrategicHub%d_Ruin"),H),
            H%2==0?TEXT("/Game/Phantom/Curated/Legends/SM_Legends_Tower.SM_Legends_Tower"):TEXT("/Game/Phantom/Curated/Legends/SM_Legends_Wall.SM_Legends_Wall"),
            C,FVector(H%2==0?1.2f:1.6f),FRotator(0,H*29.0f,0),true,true);
        const EPhantomLegendsResource Type=(H%4==0)?EPhantomLegendsResource::Gold:(H%4==1)?EPhantomLegendsResource::Wood:(H%4==2)?EPhantomLegendsResource::Stone:EPhantomLegendsResource::Shard;
        APhantomLegendsResourceNode* Node=GetWorld()->SpawnActor<APhantomLegendsResourceNode>(C+FVector(1500,-1300,40),FRotator::ZeroRotator);
        if(Node) Node->Configure(Type,1300+H*35);
    }

    // WORLD DENSITY GRID: populate the full 4.096 km battlefield instead of placing a few islands in a void.
    // 49 macro cells each receive a landmark, vegetation, resource node and navigational silhouette.
    int32 DensityId=0;
    for(int32 GX=-3;GX<=3;++GX)
    {
        for(int32 GY=-3;GY<=3;++GY)
        {
            const FVector C(GX*50000.0f,GY*50000.0f,18.0f);
            if(FVector2D(C.X,C.Y).Size()>195000.0f) continue;
            const bool bNearRiver=FMath::Abs(C.X)<22000.0f;
            const TCHAR* Landmark=(DensityId%4==0)?TEXT("/Game/Phantom/Curated/Legends/SM_Legends_Tower.SM_Legends_Tower"):
                                  ((DensityId%4==1)?TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_House_A.SM_CC0_House_A"):
                                  ((DensityId%4==2)?TEXT("/Game/Phantom/Curated/Legends/SM_Legends_Wall.SM_Legends_Wall"):
                                                     TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_House_B.SM_CC0_House_B")));
            SpawnStaticMeshAsset(FString::Printf(TEXT("WorldCellLandmark_%03d"),DensityId),Landmark,
                C+FVector(bNearRiver?9000.0f:0.0f,0,0),FVector(1.15f+(DensityId%3)*0.10f),FRotator(0,DensityId*23.0f,0),true,true);
            for(int32 J=0;J<14;++J)
            {
                const float A=J*(2.0f*PI/14.0f)+DensityId*0.27f;
                const float R=2600.0f+(J%5)*1250.0f;
                const FVector P=C+FVector(FMath::Cos(A)*R,FMath::Sin(A)*R,0);
                SpawnStaticMeshAsset(FString::Printf(TEXT("WorldCellTree_%03d_%02d"),DensityId,J),
                    J%3==0?TEXT("/Game/Phantom/UnityHarvest/Legends/character/U_Legends_0009_PineTrees.U_Legends_0009_PineTrees"):TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Tree_A.SM_CC0_Tree_A"),
                    P,FVector(0.68f+(J%4)*0.08f),FRotator(0,J*29.0f,0),false,true);
            }
            APhantomLegendsResourceNode* CellNode=GetWorld()->SpawnActor<APhantomLegendsResourceNode>(
                C+FVector((DensityId%2?1.0f:-1.0f)*4200.0f,3600.0f,40.0f),FRotator::ZeroRotator);
            if(CellNode) CellNode->Configure(static_cast<EPhantomLegendsResource>(DensityId%4),1250+(DensityId%5)*180);
            ++DensityId;
        }
    }

    // V6 large-world density is instanced, not thousands of ticking actors. The 4.096km map stays huge,
    // but every camera move crosses forests, rock belts and settlement silhouettes.
    TArray<FTransform> RealmTreesA;
    TArray<FTransform> RealmTreesB;
    TArray<FTransform> RealmRocks;
    RealmTreesA.Reserve(1400); RealmTreesB.Reserve(1000); RealmRocks.Reserve(700);
    for(int32 GX=-21;GX<=21;++GX)
    {
        for(int32 GY=-21;GY<=21;++GY)
        {
            const float X=GX*9000.0f+(((GX*131+GY*67)&2047)-1024.0f);
            const float Y=GY*9000.0f+(((GX*47-GY*149)&2047)-1024.0f);
            if(FMath::Abs(X)>194000.0f || FMath::Abs(Y)>194000.0f) continue;
            if(FMath::Abs(X-650.0f)<12500.0f) continue; // river readability
            const float S=0.62f+(FMath::Abs(GX*13+GY*17)%7)*0.06f;
            FTransform T(FRotator(0.0f,(GX*41+GY*29)%360,0.0f),FVector(X,Y,18.0f),FVector(S));
            if(((GX+GY)&3)==0) RealmTreesB.Add(T); else RealmTreesA.Add(T);
            if(((GX*7+GY*5)&3)==0)
                RealmRocks.Emplace(FRotator(0.0f,(GX*19-GY*37)%360,0.0f),FVector(X+1700.0f,Y-1100.0f,16.0f),FVector(0.42f+((GX-GY)&3)*0.06f));
        }
    }
    SpawnInstancedMeshCluster(TEXT("LegendsRealmTreesA_HISM"),TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Tree_A.SM_CC0_Tree_A"),RealmTreesA,false);
    SpawnInstancedMeshCluster(TEXT("LegendsRealmTreesB_HISM"),TEXT("/Game/Phantom/UnityHarvest/Legends/character/U_Legends_0009_PineTrees.U_Legends_0009_PineTrees"),RealmTreesB,false);
    SpawnInstancedMeshCluster(TEXT("LegendsRealmRocks_HISM"),TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Rock.SM_CC0_Rock"),RealmRocks,false);

    TArray<FTransform> RealmSettlementHomes;
    RealmSettlementHomes.Reserve(UE_ARRAY_COUNT(StrategicHubs)*8);
    for(int32 H=0;H<UE_ARRAY_COUNT(StrategicHubs);++H)
    {
        for(int32 I=0;I<8;++I)
        {
            const float A=I*(2.0f*PI/8.0f)+H*0.19f;
            RealmSettlementHomes.Emplace(FRotator(0.0f,A*180.0f/PI+90.0f,0.0f),
                StrategicHubs[H]+FVector(FMath::Cos(A)*2800.0f,FMath::Sin(A)*2800.0f,18.0f),FVector(0.82f+(I%3)*0.07f));
        }
    }
    SpawnInstancedMeshCluster(TEXT("LegendsSatelliteSettlements_HISM"),TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_House_A.SM_CC0_House_A"),RealmSettlementHomes,false);

    // Warm road markers keep the giant map readable at gameplay zoom.
    const FVector Lamps[]={FVector(-9600,-4500,18),FVector(-7800,-3000,18),FVector(-6000,-1800,18),FVector(-3900,-1000,18),FVector(-1700,-500,18),FVector(2500,-600,18),FVector(4700,900,18),FVector(6500,2600,18),FVector(8200,4100,18),FVector(9600,5700,18)};
    for(int32 I=0;I<UE_ARRAY_COUNT(Lamps);++I)
    {
        SpawnStaticMeshAsset(FString::Printf(TEXT("RealmLantern_%02d"),I),TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Lantern.SM_CC0_Lantern"),Lamps[I],FVector(0.85f),FRotator::ZeroRotator,false,true);
        SpawnPointLight(FString::Printf(TEXT("RealmLanternLight_%02d"),I),Lamps[I]+FVector(0,0,170),FLinearColor(1.0f,0.48f,0.20f),430.0f,180.0f,false);
    }
}


void APhantomLegendsDirector::SpawnUnit(EPhantomLegendsRole UnitRole, EPhantomLegendsFaction Faction, const FVector& Location)
{
    FVector SpawnLocation = Location;
    if (SpawnLocation.IsNearlyZero())
    {
        const FVector LegionAnchor = Stronghold ? Stronghold->GetActorLocation() : FVector(-120000.0f,-95000.0f,35.0f);
        const FVector RiftAnchor = RiftGate ? RiftGate->GetActorLocation() : FVector(120000.0f,95000.0f,35.0f);
        const FVector Anchor = Faction == EPhantomLegendsFaction::Legion ? LegionAnchor : RiftAnchor;
        const FVector RallyOffset = Faction == EPhantomLegendsFaction::Legion ? FVector(780.0f,520.0f,55.0f) : FVector(-780.0f,-520.0f,55.0f);
        SpawnLocation = Anchor + RallyOffset + FVector(FMath::FRandRange(-260.0f,260.0f),FMath::FRandRange(-260.0f,260.0f),0.0f);
    }
    APhantomLegendsUnit* Unit = GetWorld()->SpawnActor<APhantomLegendsUnit>(SpawnLocation, FRotator::ZeroRotator);
    if (Unit) Unit->ConfigureRole(UnitRole, Faction, Faction == EPhantomLegendsFaction::Legion ? StrongholdLevel : FMath::Max(1, RaidWave));
}

void APhantomLegendsDirector::SpawnRaid()
{
    ++RaidWave;
    HighestRaid = FMath::Max(HighestRaid, RaidWave);
    const int32 Count = FMath::Min(18, 3 + RaidWave * 2);
    RaidersAlive = Count;
    RealmStatus = TEXT("RIFT BREACH // DEFEND THE STRONGHOLD");
    for (int32 Index = 0; Index < Count; ++Index)
    {
        EPhantomLegendsRole RaiderRole = EPhantomLegendsRole::Raider;
        if (RaidWave >= 2 && Index % 5 == 2) RaiderRole = EPhantomLegendsRole::Ranger;
        if (RaidWave >= 2 && Index % 4 == 0) RaiderRole = EPhantomLegendsRole::Brute;
        const FVector RiftAnchor=RiftGate?RiftGate->GetActorLocation():FVector(120000.0f,95000.0f,35.0f);
        SpawnUnit(RaiderRole, EPhantomLegendsFaction::Rift, RiftAnchor+FVector(-1200.0f+(Index%4)*260.0f,-900.0f+(Index/4)*240.0f,55.0f));
    }
}


int32 APhantomLegendsDirector::GetLegionPopulation() const
{
    int32 Population = 0;
    for (TActorIterator<APhantomLegendsUnit> It(GetWorld()); It; ++It)
    {
        if (It->IsPlayerUnit()) ++Population;
    }
    return Population;
}

int32 APhantomLegendsDirector::GetVeteranUnitCount() const
{
    int32 Veterans = 0;
    for (TActorIterator<APhantomLegendsUnit> It(GetWorld()); It; ++It)
    {
        if (It->IsPlayerUnit() && It->GetVeterancy() > 0) ++Veterans;
    }
    return Veterans;
}

void APhantomLegendsDirector::SelectAtCursor(APlayerController* PlayerController)
{
    if (!PlayerController) return;

    APhantomLegendsUnit* Unit = nullptr;
    FHitResult Hit;
    if (PlayerController->GetHitResultUnderCursor(ECC_Visibility, true, Hit))
    {
        Unit = Cast<APhantomLegendsUnit>(Hit.GetActor());
    }

    // AoE-style forgiving screen-space pick. Collision on tiny stylized troops must never
    // make selection feel like pixel hunting.
    if (!Unit || !Unit->IsPlayerUnit())
    {
        float MouseX = 0.0f, MouseY = 0.0f;
        float BestDistanceSq = FMath::Square(72.0f);
        if (PlayerController->GetMousePosition(MouseX, MouseY))
        {
            for (TActorIterator<APhantomLegendsUnit> It(GetWorld()); It; ++It)
            {
                if (!It->IsPlayerUnit()) continue;
                FVector2D Screen;
                if (!PlayerController->ProjectWorldLocationToScreen(It->GetActorLocation() + FVector(0.0f,0.0f,72.0f), Screen)) continue;
                const float DistanceSq = (Screen - FVector2D(MouseX, MouseY)).SizeSquared();
                if (DistanceSq < BestDistanceSq) { BestDistanceSq = DistanceSq; Unit = *It; }
            }
        }
    }

    const bool bAdditive = PlayerController->IsInputKeyDown(EKeys::LeftShift) || PlayerController->IsInputKeyDown(EKeys::RightShift);
    const bool bControlSameType = PlayerController->IsInputKeyDown(EKeys::LeftControl) || PlayerController->IsInputKeyDown(EKeys::RightControl);
    if (!Unit || !Unit->IsPlayerUnit())
    {
        if (!bAdditive)
        {
            for (TActorIterator<APhantomLegendsUnit> It(GetWorld()); It; ++It) It->SetSelected(false);
            SelectedUnits.Reset();
        }
        RealmStatus = SelectedUnits.IsEmpty() ? TEXT("NO LEGION UNIT SELECTED") : FString::Printf(TEXT("%d LEGION UNITS SELECTED"), SelectedUnits.Num());
        return;
    }

    const float Now = GetWorld() ? GetWorld()->GetTimeSeconds() : 0.0f;
    float CursorX=0.0f, CursorY=0.0f;
    PlayerController->GetMousePosition(CursorX, CursorY);
    const FVector2D CursorNow(CursorX, CursorY);
    int32 ClickVW=0, ClickVH=0; PlayerController->GetViewportSize(ClickVW, ClickVH);
    const float DoubleRadius = PhantomInteractionSpec::DpiScaledPixels(PhantomInteractionSpec::DoubleClickRadius1080, ClickVH);
    const bool bDoubleClickSameRole = !bAdditive && Unit->GetRole() == LastSelectionRole
        && (Now - LastSelectionClickTime) <= PhantomInteractionSpec::DoubleClickInterval
        && FVector2D::Distance(CursorNow, LastSelectionScreen) <= DoubleRadius;
    LastSelectionClickTime = Now;
    LastSelectionRole = Unit->GetRole();
    LastSelectionScreen = CursorNow;

    if (bDoubleClickSameRole || bControlSameType)
    {
        for (TActorIterator<APhantomLegendsUnit> It(GetWorld()); It; ++It) It->SetSelected(false);
        SelectedUnits.Reset();
        int32 VW=0,VH=0; PlayerController->GetViewportSize(VW,VH);
        for (TActorIterator<APhantomLegendsUnit> It(GetWorld()); It; ++It)
        {
            if (!It->IsPlayerUnit() || It->GetRole()!=Unit->GetRole()) continue;
            FVector2D Screen;
            if (PlayerController->ProjectWorldLocationToScreen(It->GetActorLocation(), Screen) && Screen.X>=0 && Screen.Y>=0 && Screen.X<=VW && Screen.Y<=VH)
            {
                It->SetSelected(true); SelectedUnits.Add(*It);
            }
        }
        RealmStatus = FString::Printf(TEXT("%d SAME-TYPE UNITS SELECTED // TYPE GROUP"), SelectedUnits.Num());
        return;
    }

    if (!bAdditive)
    {
        for (TActorIterator<APhantomLegendsUnit> It(GetWorld()); It; ++It) It->SetSelected(false);
        SelectedUnits.Reset();
    }
    if (bAdditive && Unit->bSelected) { Unit->SetSelected(false); SelectedUnits.Remove(Unit); }
    else { Unit->SetSelected(true); SelectedUnits.AddUnique(Unit); }
    RealmStatus = FString::Printf(TEXT("%d LEGION UNIT%s SELECTED // RMB COMMAND"), SelectedUnits.Num(), SelectedUnits.Num()==1 ? TEXT("") : TEXT("S"));
}

void APhantomLegendsDirector::SelectScreenRect(APlayerController* PlayerController, const FVector2D& A, const FVector2D& B)
{
    if (!PlayerController) return;
    const float MinX=FMath::Min(A.X,B.X), MaxX=FMath::Max(A.X,B.X);
    const float MinY=FMath::Min(A.Y,B.Y), MaxY=FMath::Max(A.Y,B.Y);
    const bool bAdditive = PlayerController->IsInputKeyDown(EKeys::LeftShift) || PlayerController->IsInputKeyDown(EKeys::RightShift);
    const bool bRemove = PlayerController->IsInputKeyDown(EKeys::LeftControl) || PlayerController->IsInputKeyDown(EKeys::RightControl);
    const bool bMilitaryOnly = PlayerController->IsInputKeyDown(EKeys::LeftAlt) || PlayerController->IsInputKeyDown(EKeys::RightAlt);

    if (!bAdditive && !bRemove)
    {
        for (TActorIterator<APhantomLegendsUnit> It(GetWorld()); It; ++It) It->SetSelected(false);
        SelectedUnits.Reset();
    }

    TArray<APhantomLegendsUnit*> Candidates;
    bool bAnyMilitary = false;
    for (TActorIterator<APhantomLegendsUnit> It(GetWorld()); It; ++It)
    {
        if (!It->IsPlayerUnit()) continue;
        FVector2D Screen;
        if (!PlayerController->ProjectWorldLocationToScreen(It->GetActorLocation()+FVector(0,0,55), Screen)) continue;
        if (Screen.X<MinX || Screen.X>MaxX || Screen.Y<MinY || Screen.Y>MaxY) continue;
        Candidates.Add(*It);
        if (It->GetRole()!=EPhantomLegendsRole::Worker) bAnyMilitary=true;
    }

    // Smart-box policy: on the battlefield, do not accidentally drag workers into a military army.
    for (APhantomLegendsUnit* Unit : Candidates)
    {
        if (!Unit) continue;
        if ((bMilitaryOnly || bAnyMilitary) && Unit->GetRole()==EPhantomLegendsRole::Worker) continue;
        if (bRemove)
        {
            Unit->SetSelected(false);
            SelectedUnits.Remove(Unit);
        }
        else
        {
            Unit->SetSelected(true);
            SelectedUnits.AddUnique(Unit);
        }
    }
    RealmStatus = SelectedUnits.IsEmpty() ? TEXT("NO LEGION UNITS IN SELECTION") : FString::Printf(TEXT("%d LEGION UNITS SELECTED"), SelectedUnits.Num());
}

void APhantomLegendsDirector::SelectAllArmy()
{
    SelectedUnits.Reset();
    for (TActorIterator<APhantomLegendsUnit> It(GetWorld()); It; ++It)
    {
        const bool bArmy = It->IsPlayerUnit() && It->GetRole() != EPhantomLegendsRole::Worker;
        It->SetSelected(bArmy);
        if (bArmy) SelectedUnits.Add(*It);
    }
}

void APhantomLegendsDirector::StopSelectedUnits()
{
    int32 Count=0;
    for (const TWeakObjectPtr<APhantomLegendsUnit>& Selected : SelectedUnits)
    {
        if (APhantomLegendsUnit* Unit=Selected.Get()) { Unit->StopOrders(); ++Count; }
    }
    RealmStatus = Count>0 ? FString::Printf(TEXT("%d UNITS STOPPED"),Count) : TEXT("SELECT UNITS FIRST");
}

void APhantomLegendsDirector::HoldSelectedUnits()
{
    int32 Count=0;
    for (const TWeakObjectPtr<APhantomLegendsUnit>& Selected : SelectedUnits)
    {
        if (APhantomLegendsUnit* Unit=Selected.Get()) { Unit->SetHoldPosition(true); ++Count; }
    }
    RealmStatus = Count>0 ? FString::Printf(TEXT("%d UNITS HOLDING GROUND // THEY WILL FIGHT WITHOUT CHASING"),Count) : TEXT("SELECT UNITS FIRST");
}

FVector APhantomLegendsDirector::GetSelectedCenter() const
{
    FVector Sum=FVector::ZeroVector; int32 Count=0;
    for (const TWeakObjectPtr<APhantomLegendsUnit>& Selected : SelectedUnits)
    {
        if (const APhantomLegendsUnit* Unit=Selected.Get()) { Sum+=Unit->GetActorLocation(); ++Count; }
    }
    return Count>0 ? Sum/static_cast<float>(Count) : FVector::ZeroVector;
}

void APhantomLegendsDirector::OrderAtCursor(APlayerController* PlayerController)
{
    if (!PlayerController) return;
    FHitResult Hit;
    if (!PlayerController->GetHitResultUnderCursor(ECC_Visibility, true, Hit)) return;
    AActor* AttackTarget = nullptr;
    if (APhantomLegendsUnit* UnitTarget = Cast<APhantomLegendsUnit>(Hit.GetActor()))
    {
        if (!UnitTarget->IsPlayerUnit()) AttackTarget = UnitTarget;
    }
    else if (APhantomLegendsStructure* StructureTarget = Cast<APhantomLegendsStructure>(Hit.GetActor()))
    {
        if (StructureTarget->GetFaction() == EPhantomLegendsFaction::Rift && StructureTarget->GetHealth() > 0.0f)
        {
            AttackTarget = StructureTarget;
        }
    }
    if (AttackTarget)
    {
        if (SelectedUnits.IsEmpty()) { RealmStatus = TEXT("SELECT UNITS BEFORE ISSUING AN ATTACK ORDER"); return; }
        int32 Ordered = 0;
        for (const TWeakObjectPtr<APhantomLegendsUnit>& Selected : SelectedUnits)
        {
            if (APhantomLegendsUnit* Unit = Selected.Get())
            {
                Unit->SetCombatTarget(AttackTarget);
                ++Ordered;
            }
        }
        if (AStaticMeshActor* Marker = SpawnShape(EPhantomPrimitive::Cylinder, TEXT("AttackOrderPulse"), AttackTarget->GetActorLocation() + FVector(0.0f, 0.0f, 14.0f), FVector(86.0f, 86.0f, 8.0f), FLinearColor(1.0f, 0.12f, 0.24f), FRotator::ZeroRotator, false))
        {
            Marker->SetLifeSpan(0.7f);
        }
        RealmStatus = Ordered > 0 ? TEXT("LEGION ENGAGING // FOCUS FIRE ORDER CONFIRMED") : TEXT("TRAIN GUARDS OR RANGERS TO ATTACK");
        return;
    }
    if (APhantomLegendsResourceNode* Node = Cast<APhantomLegendsResourceNode>(Hit.GetActor()))
    {
        if (SelectedUnits.IsEmpty())
        {
            for (TActorIterator<APhantomLegendsUnit> It(GetWorld()); It; ++It)
            {
                if (It->IsPlayerUnit() && It->GetRole() == EPhantomLegendsRole::Worker)
                {
                    It->SetSelected(true);
                    SelectedUnits.Add(*It);
                }
            }
        }
        for (const TWeakObjectPtr<APhantomLegendsUnit>& Selected : SelectedUnits)
        {
            if (APhantomLegendsUnit* Unit = Selected.Get()) Unit->SetGatherTarget(Node);
        }
        RealmStatus = FString::Printf(TEXT("WORKERS ASSIGNED // HARVESTING %s"), ResourceName(Node->GetResourceType()));
        return;
    }
    if (SelectedUnits.IsEmpty()) return;
    const bool bQueue = PlayerController->IsInputKeyDown(EKeys::LeftShift) || PlayerController->IsInputKeyDown(EKeys::RightShift);
    const int32 FormationColumns = FMath::Max(1, FMath::CeilToInt(FMath::Sqrt(static_cast<float>(SelectedUnits.Num()))));
    const int32 FormationRows = FMath::Max(1, FMath::CeilToInt(SelectedUnits.Num() / static_cast<float>(FormationColumns)));
    FVector Center=GetSelectedCenter();
    FVector Travel=Hit.Location-Center; Travel.Z=0.0f; Travel=Travel.GetSafeNormal();
    if (Travel.IsNearlyZero()) Travel=FVector::ForwardVector;
    const FVector Lateral=FVector::CrossProduct(FVector::UpVector,Travel).GetSafeNormal();
    for (int32 Index = 0; Index < SelectedUnits.Num(); ++Index)
    {
        if (APhantomLegendsUnit* Unit = SelectedUnits[Index].Get())
        {
            const int32 Column = Index % FormationColumns;
            const int32 Row = Index / FormationColumns;
            const float C=(Column-(FormationColumns-1)*0.5f)*125.0f;
            const float R=(Row-(FormationRows-1)*0.5f)*125.0f;
            const FVector FormationOffset=Lateral*C-Travel*R;
            if (bQueue) Unit->QueueOrderLocation(Hit.Location + FormationOffset, false);
            else Unit->SetOrderLocation(Hit.Location + FormationOffset);
        }
    }
    if (AStaticMeshActor* Marker = SpawnShape(EPhantomPrimitive::Cylinder, TEXT("MoveOrderPulse"), Hit.Location + FVector(0.0f, 0.0f, 10.0f), FVector(64.0f, 64.0f, 6.0f), FLinearColor(0.12f, 0.92f, 1.0f), FRotator::ZeroRotator, false))
    {
        Marker->SetLifeSpan(0.55f);
    }
    RealmStatus = bQueue ? TEXT("WAYPOINT APPENDED // SHIFT-RMB QUEUE") : TEXT("LEGION MOVING IN FORMATION // AUTO-AGGRO ENABLED");
}

void APhantomLegendsDirector::AttackMoveAtCursor(APlayerController* PlayerController)
{
    if (!PlayerController || SelectedUnits.IsEmpty()) { RealmStatus = TEXT("SELECT UNITS, THEN PRESS A OVER THE DESTINATION"); return; }
    FHitResult Hit;
    if (!PlayerController->GetHitResultUnderCursor(ECC_Visibility, true, Hit)) return;

    const bool bQueue = PlayerController->IsInputKeyDown(EKeys::LeftShift) || PlayerController->IsInputKeyDown(EKeys::RightShift);
    const int32 Columns = FMath::Max(1, FMath::CeilToInt(FMath::Sqrt(static_cast<float>(SelectedUnits.Num()))));
    FVector Center = GetSelectedCenter();
    FVector Travel = Hit.Location - Center; Travel.Z = 0.0f; Travel = Travel.GetSafeNormal();
    if (Travel.IsNearlyZero()) Travel = FVector::ForwardVector;
    const FVector Lateral = FVector::CrossProduct(FVector::UpVector, Travel).GetSafeNormal();
    for (int32 Index=0; Index<SelectedUnits.Num(); ++Index)
    {
        if (APhantomLegendsUnit* Unit=SelectedUnits[Index].Get())
        {
            const int32 Col=Index%Columns, Row=Index/Columns;
            const FVector Offset=Lateral*((Col-(Columns-1)*0.5f)*132.0f)-Travel*(Row*118.0f);
            if (bQueue) Unit->QueueOrderLocation(Hit.Location+Offset, true);
            else Unit->SetAttackMoveLocation(Hit.Location+Offset);
        }
    }
    if (AStaticMeshActor* Marker=SpawnShape(EPhantomPrimitive::Cylinder,TEXT("AttackMovePulse"),Hit.Location+FVector(0,0,10),FVector(92,92,7),FLinearColor(0.15f,1.0f,0.42f),FRotator::ZeroRotator,false))
        Marker->SetLifeSpan(0.75f);
    RealmStatus=bQueue ? TEXT("ATTACK-MOVE WAYPOINT QUEUED") : TEXT("ATTACK-MOVE // LEGION WILL ENGAGE ENEMIES EN ROUTE");
}


void APhantomLegendsDirector::PatrolSelectedUnits(APlayerController* PlayerController)
{
    if (!PlayerController || SelectedUnits.IsEmpty()) { RealmStatus=TEXT("SELECT UNITS, THEN PRESS P OVER A PATROL POINT"); return; }
    FHitResult Hit;
    if (!PlayerController->GetHitResultUnderCursor(ECC_Visibility,true,Hit)) return;
    for (const TWeakObjectPtr<APhantomLegendsUnit>& Selected : SelectedUnits)
        if (APhantomLegendsUnit* Unit=Selected.Get()) Unit->SetPatrolLocation(Hit.Location);
    RealmStatus=TEXT("PATROL ORDER // UNITS WILL DEFEND BETWEEN BOTH ENDS");
}

void APhantomLegendsDirector::HandleControlGroup(APlayerController* PlayerController, int32 GroupIndex)
{
    if (!PlayerController || GroupIndex<0 || GroupIndex>8) return;
    if (ControlGroups.Num()!=9) ControlGroups.SetNum(9);
    const bool bCtrl=PlayerController->IsInputKeyDown(EKeys::LeftControl)||PlayerController->IsInputKeyDown(EKeys::RightControl);
    const bool bShift=PlayerController->IsInputKeyDown(EKeys::LeftShift)||PlayerController->IsInputKeyDown(EKeys::RightShift);
    const bool bAlt=PlayerController->IsInputKeyDown(EKeys::LeftAlt)||PlayerController->IsInputKeyDown(EKeys::RightAlt);
    TArray<TWeakObjectPtr<APhantomLegendsUnit>>& Group=ControlGroups[GroupIndex];

    if (bCtrl)
    {
        Group.Reset();
        for (const TWeakObjectPtr<APhantomLegendsUnit>& U:SelectedUnits) if(U.IsValid()) Group.AddUnique(U);
        RealmStatus=FString::Printf(TEXT("CONTROL GROUP %d ASSIGNED // %d UNITS"),GroupIndex+1,Group.Num());
        return;
    }
    if (bShift)
    {
        for (const TWeakObjectPtr<APhantomLegendsUnit>& U:SelectedUnits) if(U.IsValid()) Group.AddUnique(U);
        RealmStatus=FString::Printf(TEXT("CONTROL GROUP %d EXPANDED // %d UNITS"),GroupIndex+1,Group.Num());
        return;
    }
    if (bAlt)
    {
        for (const TWeakObjectPtr<APhantomLegendsUnit>& U:SelectedUnits) Group.Remove(U);
        RealmStatus=FString::Printf(TEXT("SELECTION REMOVED FROM GROUP %d"),GroupIndex+1);
        return;
    }

    for (TActorIterator<APhantomLegendsUnit> It(GetWorld());It;++It) if(It->IsPlayerUnit()) It->SetSelected(false);
    SelectedUnits.Reset();
    Group.RemoveAll([](const TWeakObjectPtr<APhantomLegendsUnit>& U){return !U.IsValid();});
    for (const TWeakObjectPtr<APhantomLegendsUnit>& U:Group)
        if(APhantomLegendsUnit* Unit=U.Get()){Unit->SetSelected(true);SelectedUnits.AddUnique(Unit);}
    RealmStatus=FString::Printf(TEXT("CONTROL GROUP %d // %d UNITS"),GroupIndex+1,SelectedUnits.Num());
}

void APhantomLegendsDirector::OrderFormationFromScreenDrag(APlayerController* PlayerController, const FVector2D& Start, const FVector2D& End)
{
    if (!PlayerController || SelectedUnits.IsEmpty()) return;
    FVector StartWorld, StartDir, EndWorld, EndDir;
    if (!PlayerController->DeprojectScreenPositionToWorld(Start.X,Start.Y,StartWorld,StartDir)) return;
    if (!PlayerController->DeprojectScreenPositionToWorld(End.X,End.Y,EndWorld,EndDir)) return;
    const float GroundZ=0.0f;
    const float T0=FMath::IsNearlyZero(StartDir.Z)?0.0f:(GroundZ-StartWorld.Z)/StartDir.Z;
    const float T1=FMath::IsNearlyZero(EndDir.Z)?0.0f:(GroundZ-EndWorld.Z)/EndDir.Z;
    FVector Anchor=StartWorld+StartDir*T0;
    FVector FacingPoint=EndWorld+EndDir*T1;
    FVector Facing=FacingPoint-Anchor; Facing.Z=0.0f;
    float Width=FMath::Clamp(Facing.Size(),350.0f,4200.0f);
    if(Facing.IsNearlyZero()) Facing=FVector::ForwardVector; else Facing.Normalize();
    const FVector Lateral=FVector::CrossProduct(FVector::UpVector,Facing).GetSafeNormal();
    const int32 Count=SelectedUnits.Num();
    for(int32 I=0;I<Count;++I)
    {
        if(APhantomLegendsUnit* Unit=SelectedUnits[I].Get())
        {
            const float Alpha=Count<=1?0.5f:static_cast<float>(I)/static_cast<float>(Count-1);
            const FVector P=Anchor+Lateral*((Alpha-0.5f)*Width);
            Unit->SetOrderLocation(P);
            Unit->SetActorRotation(Facing.Rotation());
        }
    }
    RealmStatus=TEXT("FORMATION FACING ORDER // RMB DRAG FRONTAGE SET");
}


void APhantomLegendsDirector::TrainWorker()
{
    if (GetLegionPopulation() >= GetPopulationCap())
    {
        RealmStatus = TEXT("POPULATION CAP REACHED // ASCEND THE STRONGHOLD TO FIELD MORE UNITS");
        return;
    }
    if (Gold < 75) return;
    Gold -= 75;
    SpawnUnit(EPhantomLegendsRole::Worker, EPhantomLegendsFaction::Legion);
}

void APhantomLegendsDirector::TrainGuard()
{
    if (GetLegionPopulation() >= GetPopulationCap())
    {
        RealmStatus = TEXT("POPULATION CAP REACHED // ASCEND THE STRONGHOLD TO FIELD MORE UNITS");
        return;
    }
    if (Gold < 110) return;
    Gold -= 110;
    SpawnUnit(EPhantomLegendsRole::Guard, EPhantomLegendsFaction::Legion);
}

void APhantomLegendsDirector::TrainRanger()
{
    if (GetLegionPopulation() >= GetPopulationCap())
    {
        RealmStatus = TEXT("POPULATION CAP REACHED // ASCEND THE STRONGHOLD TO FIELD MORE UNITS");
        return;
    }
    if (Gold < 140) return;
    Gold -= 140;
    SpawnUnit(EPhantomLegendsRole::Ranger, EPhantomLegendsFaction::Legion);
}

void APhantomLegendsDirector::TrainBrute()
{
    if (GetLegionPopulation() >= GetPopulationCap())
    {
        RealmStatus = TEXT("POPULATION CAP REACHED // ASCEND THE STRONGHOLD TO FIELD MORE UNITS");
        return;
    }
    if (Gold < 180 || Stone < 80) return;
    Gold -= 180;
    Stone -= 80;
    SpawnUnit(EPhantomLegendsRole::Brute, EPhantomLegendsFaction::Legion);
}

void APhantomLegendsDirector::BuildDefenseTower(APlayerController* PlayerController)
{
    if (!PlayerController || Wood < 120 || Stone < 80) return;
    FHitResult Hit;
    if (!PlayerController->GetHitResultUnderCursor(ECC_Visibility, true, Hit)) return;
    APhantomLegendsStructure* Tower = GetWorld()->SpawnActor<APhantomLegendsStructure>(Hit.Location + FVector(0.0f, 0.0f, 40.0f), FRotator::ZeroRotator);
    if (!Tower)
    {
        RealmStatus = TEXT("TOWER SITE BLOCKED // RESOURCES NOT SPENT");
        return;
    }
    Wood -= 120;
    Stone -= 80;
    Tower->Configure(EPhantomLegendsStructureType::DefenseTower, EPhantomLegendsFaction::Legion, StrongholdLevel);
    RealmStatus = TEXT("ARCANE DEFENSE TOWER RAISED");
    SaveProgress();
}

void APhantomLegendsDirector::UpgradeStronghold()
{
    const int32 GoldCost = 260 + StrongholdLevel * 180;
    const int32 StoneCost = 160 + StrongholdLevel * 90;
    const int32 ShardCost = StrongholdLevel >= 2 ? 20 * StrongholdLevel : 0;
    if (StrongholdLevel >= 5 || Gold < GoldCost || Stone < StoneCost || LegacyShards < ShardCost || !Stronghold) return;
    Gold -= GoldCost;
    Stone -= StoneCost;
    LegacyShards -= ShardCost;
    ++StrongholdLevel;
    Stronghold->Configure(EPhantomLegendsStructureType::Stronghold, EPhantomLegendsFaction::Legion, StrongholdLevel);
    UpgradeFieldedUnits();
    RealmStatus = FString::Printf(TEXT("STRONGHOLD ASCENDED TO LEVEL %d"), StrongholdLevel);
    SaveProgress();
}

void APhantomLegendsDirector::UpgradeFieldedUnits()
{
    for (TActorIterator<APhantomLegendsUnit> It(GetWorld()); It; ++It)
    {
        if (!It->IsPlayerUnit()) continue;
        const bool bWasSelected = It->bSelected;
        It->ConfigureRole(It->GetRole(), EPhantomLegendsFaction::Legion, StrongholdLevel);
        It->SetSelected(bWasSelected);
    }
}

void APhantomLegendsDirector::DepositResource(EPhantomLegendsResource Resource, int32 Amount)
{
    switch (Resource)
    {
        case EPhantomLegendsResource::Gold: Gold += Amount; break;
        case EPhantomLegendsResource::Wood: Wood += Amount; break;
        case EPhantomLegendsResource::Stone: Stone += Amount; break;
        case EPhantomLegendsResource::Shard: LegacyShards += Amount; break;
    }
}

void APhantomLegendsDirector::NotifyUnitDefeated(EPhantomLegendsFaction Faction, EPhantomLegendsRole DefeatedRole)
{
    if (Faction == EPhantomLegendsFaction::Rift)
    {
        RaidersAlive = FMath::Max(0, RaidersAlive - 1);
        Gold += DefeatedRole == EPhantomLegendsRole::Brute ? 45 : (DefeatedRole == EPhantomLegendsRole::Ranger ? 28 : 18);
        LegacyShards += DefeatedRole == EPhantomLegendsRole::Brute ? 4 : (DefeatedRole == EPhantomLegendsRole::Ranger ? 2 : 1);
        if (RaidersAlive <= 0)
        {
            RealmStatus = RaidWave <= 0
                ? TEXT("RIFT PATROL BROKEN // PUSH ACROSS THE BRIDGE OR HARVEST FOR TOWERS")
                : FString::Printf(TEXT("RIFT RAID %d BROKEN // LEGACY SHARDS SECURED"), RaidWave);
            RaidRemaining = FMath::Max(7.0f, 15.0f - RaidWave * 0.55f);
            SaveProgress();
        }
    }
}

void APhantomLegendsDirector::NotifyStructureDestroyed(EPhantomLegendsFaction Faction, EPhantomLegendsStructureType Type)
{
    if (Type == EPhantomLegendsStructureType::Stronghold && Faction == EPhantomLegendsFaction::Legion)
    {
        RealmStatus = TEXT("STRONGHOLD FALLEN // THE LEGION REGROUPS");
        RealmResetRemaining = 5.0f;
    }
    else if (Type == EPhantomLegendsStructureType::RiftGate && Faction == EPhantomLegendsFaction::Rift)
    {
        RealmStatus = TEXT("RIFT GATE SHATTERED // DOMINION SECURED // HOSTILE RAIDS ENDED");
        LegacyShards += 80;
        RaidRemaining = TNumericLimits<float>::Max();
        SaveProgress();
    }
}

void APhantomLegendsDirector::LoadProgress()
{
    if (UPhantomLegendsSaveGame* Save = Cast<UPhantomLegendsSaveGame>(UGameplayStatics::LoadGameFromSlot(LegendsSaveSlot, 0)))
    {
        // Treat save files as untrusted persistent state. Old/corrupt values should never create
        // negative economies, impossible population caps, or absurd upgrade tiers.
        Gold = FMath::Clamp(Save->Gold, 0, 1000000);
        Wood = FMath::Clamp(Save->Wood, 0, 1000000);
        Stone = FMath::Clamp(Save->Stone, 0, 1000000);
        LegacyShards = FMath::Clamp(Save->LegacyShards, 0, 1000000);
        StrongholdLevel = FMath::Clamp(Save->StrongholdLevel, 1, 5);
        HighestRaid = FMath::Clamp(Save->HighestRaid, 0, 9999);
    }
}

void APhantomLegendsDirector::SaveProgress()
{
    UPhantomLegendsSaveGame* Save = Cast<UPhantomLegendsSaveGame>(UGameplayStatics::CreateSaveGameObject(UPhantomLegendsSaveGame::StaticClass()));
    if (!Save) return;
    Save->Gold = Gold;
    Save->Wood = Wood;
    Save->Stone = Stone;
    Save->LegacyShards = LegacyShards;
    Save->StrongholdLevel = StrongholdLevel;
    Save->HighestRaid = HighestRaid;
    UGameplayStatics::SaveGameToSlot(Save, LegendsSaveSlot, 0);
}
