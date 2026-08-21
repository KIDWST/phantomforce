#include "Ages/PhantomAgesDirector.h"
#include "Core/PhantomGameShell.h"
#include "Core/PhantomInteractionSpec.h"
#include "Core/PhantomModularCharacter.h"

#include "Camera/CameraComponent.h"
#include "Components/SceneComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Components/SkeletalMeshComponent.h"
#include "Engine/SkeletalMesh.h"
#include "Animation/AnimSequence.h"
#include "Engine/Canvas.h"
#include "Engine/Engine.h"
#include "Engine/DamageEvents.h"
#include "Engine/StaticMeshActor.h"
#include "EngineUtils.h"
#include "GameFramework/PlayerController.h"
#include "GameFramework/SpringArmComponent.h"
#include "InputCoreTypes.h"
#include "Kismet/GameplayStatics.h"
#include "Materials/MaterialInstanceDynamic.h"

namespace
{
    // Frame the active war camp and first engagement instead of observing the entire map from
    // an empty, board-game distance. The closer lens keeps both fortresses readable while the
    // foreground set pieces and moving formations occupy the lower half of the screen.
    const FVector FixedBattlefieldCameraLocation(0.0f, -19000.0f, 5200.0f);
    const FRotator FixedBattlefieldCameraRotation(-17.0f, 90.0f, 0.0f);
    // Perspective restores depth, silhouettes, and scale to the one-screen battlefield.  The old
    // orthographic board view made every authored fortress and army read like a flat prototype token.
    constexpr float FixedBattlefieldFieldOfView = 55.0f;

    APhantomAgesDirector* AgesDirector(const UObject* Context)
    {
        if (!Context || !Context->GetWorld()) return nullptr;
        for (TActorIterator<APhantomAgesDirector> It(Context->GetWorld()); It; ++It) return *It;
        return nullptr;
    }

    const TCHAR* AgeName(int32 Age)
    {
        static const TCHAR* Names[] = {
            TEXT("STONE AGE"), TEXT("BRONZE AGE"), TEXT("IRON AGE"),
            TEXT("MEDIEVAL AGE"), TEXT("FUTURE AGE"), TEXT("PHANTOM AGE")
        };
        return Names[FMath::Clamp(Age, 0, 5)];
    }

    const TCHAR* AgeDetail(int32 Age)
    {
        static const TCHAR* Details[] = {
            TEXT("CAVE CLANS // HARDWOOD CLUBS, KNAPPED STONE, THROWN SPEARS, CONTROLLED FIRE"),
            TEXT("EARLY KINGDOMS // CAST BRONZE, SHIELDS, CHARIOTS, ORGANIZED SPEAR FORMATIONS"),
            TEXT("IRON EMPIRES // HARDER BLADES, DISCIPLINED INFANTRY, TRUE SIEGE ENGINEERING"),
            TEXT("MEDIEVAL REALMS // CASTLES, LONGBOWS, CAVALRY, SPRINGALDS, COUNTER-SIEGE"),
            TEXT("FUTURE COALITIONS // COMPOSITE ARMOR, AUTONOMOUS SYSTEMS, PRECISION ENERGY"),
            TEXT("PHANTOM ASCENDANCY // RIFT FORGES, DRAGON COVENANTS, REALITY-BENDING WARFARE")
        };
        return Details[FMath::Clamp(Age, 0, 5)];
    }

    const TCHAR* UnitName(EPhantomAgesUnitType Type)
    {
        switch (Type)
        {
            case EPhantomAgesUnitType::Clubman: return TEXT("CLUB BEARER");
            case EPhantomAgesUnitType::SpearHunter: return TEXT("SPEAR HUNTER");
            case EPhantomAgesUnitType::FireArcher: return TEXT("FIRE ARCHER");
            case EPhantomAgesUnitType::Swordsman: return TEXT("SWORDSMAN");
            case EPhantomAgesUnitType::Cavalry: return TEXT("CAVALRY");
            case EPhantomAgesUnitType::Catapult: return TEXT("CATAPULT");
            case EPhantomAgesUnitType::Springald: return TEXT("SPRINGALD");
            case EPhantomAgesUnitType::Dragon: return TEXT("DRAGON");
        }
        return TEXT("UNIT");
    }

    const TCHAR* UnitRole(EPhantomAgesUnitType Type)
    {
        switch (Type)
        {
            case EPhantomAgesUnitType::Clubman: return TEXT("FRONTLINE");
            case EPhantomAgesUnitType::SpearHunter: return TEXT("RANGED");
            case EPhantomAgesUnitType::FireArcher: return TEXT("RANGED + BURN");
            case EPhantomAgesUnitType::Swordsman: return TEXT("ARMORED FRONT");
            case EPhantomAgesUnitType::Cavalry: return TEXT("FLANKER");
            case EPhantomAgesUnitType::Catapult: return TEXT("TOWER ONLY");
            case EPhantomAgesUnitType::Springald: return TEXT("ANTI-SIEGE");
            case EPhantomAgesUnitType::Dragon: return TEXT("MYTHIC");
        }
        return TEXT("UNIT");
    }

    bool IsInfantry(EPhantomAgesUnitType Type)
    {
        return Type == EPhantomAgesUnitType::Clubman || Type == EPhantomAgesUnitType::Swordsman;
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

    FLinearColor TeamColor(EPhantomAgesTeam Team, int32 Age)
    {
        const float Glow = FMath::Clamp(Age * 0.045f, 0.0f, 0.22f);
        return Team == EPhantomAgesTeam::Player
            ? FLinearColor(0.025f, 0.42f + Glow, 0.72f + Glow)
            : FLinearColor(0.72f + Glow, 0.025f, 0.08f + Glow * 0.35f);
    }

    const TCHAR* EraRosterName(int32 Age, int32 Slot)
    {
        static const TCHAR* Names[6][4] = {
            { TEXT("CLUB HUNTER"), TEXT("FLINT SPEAR"), TEXT("FIRE SHAMAN"), TEXT("STONE BRUISER") },
            { TEXT("BRONZE GUARD"), TEXT("JAVELIN"), TEXT("SLING ARCHER"), TEXT("WAR CHARIOT") },
            { TEXT("IRON LEGION"), TEXT("LONGBOW"), TEXT("WAR RIDER"), TEXT("ONAGER") },
            { TEXT("SWORD KNIGHT"), TEXT("CROSSBOW"), TEXT("CAVALRY"), TEXT("TREBUCHET") },
            { TEXT("ASSAULT TROOPER"), TEXT("PLASMA RANGER"), TEXT("HOVER CAVALRY"), TEXT("RAIL SIEGE") },
            { TEXT("RIFT BLADE"), TEXT("VOID RANGER"), TEXT("DRAKE RIDER"), TEXT("ARC BALLISTA") }
        };
        return Names[FMath::Clamp(Age,0,5)][FMath::Clamp(Slot,0,3)];
    }

    FLinearColor EraMetal(int32 Age)
    {
        static const FLinearColor Metals[] = {
            FLinearColor(0.34f, 0.18f, 0.07f),
            FLinearColor(0.72f, 0.34f, 0.08f),
            FLinearColor(0.42f, 0.48f, 0.52f),
            FLinearColor(0.62f, 0.66f, 0.72f),
            FLinearColor(0.05f, 0.82f, 0.92f),
            FLinearColor(0.58f, 0.12f, 1.0f)
        };
        return Metals[FMath::Clamp(Age, 0, 5)];
    }

    const TCHAR* EraTowerAsset(int32 Age)
    {
        static const TCHAR* Paths[] = {
            TEXT("/Game/Phantom/Generated/Ages/SM_AgeTower_Stone.SM_AgeTower_Stone"),
            TEXT("/Game/Phantom/Generated/Ages/SM_AgeTower_Bronze.SM_AgeTower_Bronze"),
            TEXT("/Game/Phantom/Generated/Ages/SM_AgeTower_Iron.SM_AgeTower_Iron"),
            TEXT("/Game/Phantom/Generated/Ages/SM_AgeTower_Medieval.SM_AgeTower_Medieval"),
            TEXT("/Game/Phantom/Generated/Ages/SM_AgeTower_Future.SM_AgeTower_Future"),
            TEXT("/Game/Phantom/Generated/Ages/SM_AgeTower_Phantom.SM_AgeTower_Phantom")
        };
        return Paths[FMath::Clamp(Age, 0, 5)];
    }

    const TCHAR* EraCC0CharacterAsset(int32 Age)
    {
        static const TCHAR* Paths[] = {
            TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Age_Stone.SM_CC0_Age_Stone"),
            TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Age_Bronze.SM_CC0_Age_Bronze"),
            TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Age_Iron.SM_CC0_Age_Iron"),
            TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Age_Medieval.SM_CC0_Age_Medieval"),
            TEXT(""), TEXT("")
        };
        return Paths[FMath::Clamp(Age,0,5)];
    }

    const TCHAR* EraCharacterAsset(int32 Age, EPhantomAgesTeam Team)
    {
        static const TCHAR* PlayerPaths[] = {
            TEXT("/Game/Phantom/Generated/Ages/Characters/SM_StonePlayer.SM_StonePlayer"),
            TEXT("/Game/Phantom/Generated/Ages/Characters/SM_BronzePlayer.SM_BronzePlayer"),
            TEXT("/Game/Phantom/Generated/Ages/Characters/SM_IronPlayer.SM_IronPlayer"),
            TEXT("/Game/Phantom/Generated/Ages/Characters/SM_MedievalPlayer.SM_MedievalPlayer"),
            TEXT("/Game/Phantom/Generated/Ages/Characters/SM_FuturePlayer.SM_FuturePlayer"),
            TEXT("/Game/Phantom/Generated/Ages/Characters/SM_PhantomPlayer.SM_PhantomPlayer")
        };
        static const TCHAR* EnemyPaths[] = {
            TEXT("/Game/Phantom/Generated/Ages/Characters/SM_StoneEnemy.SM_StoneEnemy"),
            TEXT("/Game/Phantom/Generated/Ages/Characters/SM_BronzeEnemy.SM_BronzeEnemy"),
            TEXT("/Game/Phantom/Generated/Ages/Characters/SM_IronEnemy.SM_IronEnemy"),
            TEXT("/Game/Phantom/Generated/Ages/Characters/SM_MedievalEnemy.SM_MedievalEnemy"),
            TEXT("/Game/Phantom/Generated/Ages/Characters/SM_FutureEnemy.SM_FutureEnemy"),
            TEXT("/Game/Phantom/Generated/Ages/Characters/SM_PhantomEnemy.SM_PhantomEnemy")
        };
        const int32 Index = FMath::Clamp(Age, 0, 5);
        return Team == EPhantomAgesTeam::Player ? PlayerPaths[Index] : EnemyPaths[Index];
    }
}

APhantomAgesProjectile::APhantomAgesProjectile()
{
    PrimaryActorTick.bCanEverTick = true;
    ProjectileMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Projectile"));
    SetRootComponent(ProjectileMesh);
    ProjectileMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    ProjectileMesh->SetCastShadow(false);
}

void APhantomAgesProjectile::Configure(
    AActor* NewSource,
    AActor* NewTarget,
    EPhantomAgesUnitType NewType,
    EPhantomAgesTeam NewTeam,
    float NewDamage
)
{
    Source = NewSource;
    Target = NewTarget;
    Type = NewType;
    Damage = NewDamage;
    StartLocation = GetActorLocation();
    const float Distance = NewTarget ? FVector::Dist(StartLocation, NewTarget->GetActorLocation()) : 500.0f;
    Duration = FMath::Clamp(Distance / (NewType == EPhantomAgesUnitType::Catapult ? 950.0f : 1850.0f), 0.18f, 1.15f);
    ArcHeight = NewType == EPhantomAgesUnitType::Catapult ? 430.0f
        : (NewType == EPhantomAgesUnitType::FireArcher || NewType == EPhantomAgesUnitType::Dragon ? 150.0f : 52.0f);

    const TCHAR* MeshPath = NewType == EPhantomAgesUnitType::Catapult
        ? TEXT("/Engine/BasicShapes/Sphere.Sphere")
        : TEXT("/Engine/BasicShapes/Cylinder.Cylinder");
    ProjectileMesh->SetStaticMesh(LoadObject<UStaticMesh>(nullptr, MeshPath));
    if (NewType == EPhantomAgesUnitType::Catapult)
    {
        ProjectileMesh->SetRelativeScale3D(FVector(0.28f));
        ApplyColor(ProjectileMesh, FLinearColor(0.08f, 0.07f, 0.055f));
    }
    else
    {
        ProjectileMesh->SetRelativeScale3D(NewType == EPhantomAgesUnitType::Springald
            ? FVector(0.09f, 0.09f, 0.92f)
            : FVector(0.055f, 0.055f, 0.72f));
        ProjectileMesh->SetRelativeRotation(FRotator(90.0f, 0.0f, 0.0f));
        const FLinearColor Color = NewType == EPhantomAgesUnitType::FireArcher
            ? FLinearColor(1.0f, 0.2f, 0.015f)
            : (NewTeam == EPhantomAgesTeam::Player ? FLinearColor(0.2f, 0.9f, 1.0f) : FLinearColor(1.0f, 0.12f, 0.2f));
        ApplyColor(ProjectileMesh, Color);
    }
}

void APhantomAgesProjectile::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    if (!Target.IsValid())
    {
        Destroy();
        return;
    }
    Elapsed += DeltaSeconds;
    const float Alpha = FMath::Clamp(Elapsed / Duration, 0.0f, 1.0f);
    const FVector End = Target->GetActorLocation() + FVector(0.0f, 0.0f, 78.0f);
    FVector Next = FMath::Lerp(StartLocation, End, Alpha);
    Next.Z += FMath::Sin(Alpha * PI) * ArcHeight;
    const FVector Travel = Next - GetActorLocation();
    if (!Travel.IsNearlyZero()) SetActorRotation(Travel.Rotation());
    SetActorLocation(Next);
    if (Alpha >= 1.0f)
    {
        UGameplayStatics::ApplyDamage(Target.Get(), Damage, nullptr, Source.Get(), UDamageType::StaticClass());
        Destroy();
    }
}

APhantomAgesTower::APhantomAgesTower()
{
    PrimaryActorTick.bCanEverTick = false;
    Root = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
    SetRootComponent(Root);
    UStaticMesh* Cube = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cube.Cube"));
    UStaticMesh* Cylinder = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
    UStaticMesh* Cone = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cone.Cone"));
    UStaticMesh* Sphere = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Sphere.Sphere"));

    TowerMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("TowerBody"));
    TowerMesh->SetupAttachment(Root);
    TowerMesh->SetStaticMesh(Cube);
    TowerMesh->SetRelativeLocation(FVector(0.0f, 0.0f, 235.0f));
    TowerMesh->SetRelativeScale3D(FVector(1.75f, 2.35f, 4.7f));

    TowerCrown = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("TowerCrown"));
    TowerCrown->SetupAttachment(Root);
    TowerCrown->SetStaticMesh(Cone);
    TowerCrown->SetRelativeLocation(FVector(0.0f, 0.0f, 560.0f));
    TowerCrown->SetRelativeScale3D(FVector(1.55f, 1.55f, 1.4f));
    TowerCrown->SetCollisionEnabled(ECollisionEnabled::NoCollision);

    LeftTurret = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("LeftTurret"));
    LeftTurret->SetupAttachment(Root);
    LeftTurret->SetStaticMesh(Cylinder);
    LeftTurret->SetRelativeLocation(FVector(-118.0f, 0.0f, 340.0f));
    LeftTurret->SetRelativeScale3D(FVector(0.48f, 0.48f, 2.1f));
    LeftTurret->SetCollisionEnabled(ECollisionEnabled::NoCollision);

    RightTurret = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("RightTurret"));
    RightTurret->SetupAttachment(Root);
    RightTurret->SetStaticMesh(Cylinder);
    RightTurret->SetRelativeLocation(FVector(118.0f, 0.0f, 340.0f));
    RightTurret->SetRelativeScale3D(FVector(0.48f, 0.48f, 2.1f));
    RightTurret->SetCollisionEnabled(ECollisionEnabled::NoCollision);

    Banner = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Banner"));
    Banner->SetupAttachment(Root);
    Banner->SetStaticMesh(Cube);
    Banner->SetRelativeLocation(FVector(0.0f, -126.0f, 335.0f));
    Banner->SetRelativeScale3D(FVector(0.72f, 0.08f, 1.35f));
    Banner->SetCollisionEnabled(ECollisionEnabled::NoCollision);

    EnergyCore = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("EnergyCore"));
    EnergyCore->SetupAttachment(Root);
    EnergyCore->SetStaticMesh(Sphere);
    EnergyCore->SetRelativeLocation(FVector(0.0f, -145.0f, 430.0f));
    EnergyCore->SetRelativeScale3D(FVector(0.42f));
    EnergyCore->SetCollisionEnabled(ECollisionEnabled::NoCollision);

    HealthBack = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("HealthBack"));
    HealthBack->SetupAttachment(Root);
    HealthBack->SetStaticMesh(Cube);
    HealthBack->SetRelativeLocation(FVector(0.0f, -165.0f, 700.0f));
    HealthBack->SetRelativeScale3D(FVector(2.5f, 0.09f, 0.075f));
    HealthBack->SetCollisionEnabled(ECollisionEnabled::NoCollision);

    HealthFill = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("HealthFill"));
    HealthFill->SetupAttachment(Root);
    HealthFill->SetStaticMesh(Cube);
    HealthFill->SetRelativeLocation(FVector(0.0f, -175.0f, 700.0f));
    HealthFill->SetCollisionEnabled(ECollisionEnabled::NoCollision);
}

void APhantomAgesTower::Configure(EPhantomAgesTeam NewTeam, int32 NewAge)
{
    Team = NewTeam;
    Age = FMath::Clamp(NewAge, 0, 5);
    const float PreviousMax = MaxHealth;
    MaxHealth = 2500.0f + Age * 330.0f;
    Health = FMath::Clamp(Health + (MaxHealth - PreviousMax), 0.0f, MaxHealth);

    // Every civilization age now has its own fortress mesh. Do not collapse Bronze/Iron/Medieval
    // into one generic castle silhouette: visual evolution is part of the core Age-of-War loop.
    // V6: real imported art wins over the emergency generated shell. Age-specific crowns, banners,
    // weapons, energy cores and upgrade sockets still communicate evolution even when a stronger
    // Fab/Unity/curated fortress body is available.
    bool bUsingExternalTower = false;
    UStaticMesh* GeneratedTower = LoadObject<UStaticMesh>(nullptr, TEXT("/Game/Phantom/Curated/Fab/Ages/SM_Fab_Tower.SM_Fab_Tower"));
    if (GeneratedTower) bUsingExternalTower = true;
    if (!GeneratedTower)
    {
        GeneratedTower = LoadObject<UStaticMesh>(nullptr, TEXT("/Game/Phantom/Curated/Unity/Ages/SM_Unity_Tower.SM_Unity_Tower"));
        bUsingExternalTower = GeneratedTower != nullptr;
    }
    if (!GeneratedTower)
    {
        GeneratedTower = LoadObject<UStaticMesh>(nullptr, TEXT("/Game/Phantom/Curated/Ages/SM_Ages_Tower.SM_Ages_Tower"));
        bUsingExternalTower = GeneratedTower != nullptr;
    }
    if (!GeneratedTower)
    {
        GeneratedTower = LoadObject<UStaticMesh>(nullptr, EraTowerAsset(Age));
    }
    bUsingGeneratedTowerMesh = GeneratedTower != nullptr;
    if (bUsingGeneratedTowerMesh)
    {
        TowerMesh->SetStaticMesh(GeneratedTower);
        TowerMesh->SetRelativeLocation(FVector::ZeroVector);
        TowerMesh->SetRelativeRotation(FRotator::ZeroRotator);
        TowerMesh->SetRelativeScale3D(bUsingExternalTower ? FVector(1.82f) : FVector(1.62f + Age * 0.045f));
    }
    else
    {
        TowerMesh->SetStaticMesh(LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cube.Cube")));
        TowerMesh->SetRelativeLocation(FVector(0.0f, 0.0f, 235.0f));
        const float Growth = 1.0f + Age * 0.045f;
        TowerMesh->SetRelativeScale3D(FVector(1.75f * Growth, 2.35f, (4.7f + Age * 0.25f) * Growth));
    }

    const FLinearColor Main = TeamColor(Team, Age);
    const FLinearColor Metal = EraMetal(Age);
    if (!bUsingExternalTower) ApplyColor(TowerMesh, bUsingGeneratedTowerMesh ? Main * 0.72f : FLinearColor(Main.R * 0.45f, Main.G * 0.45f, Main.B * 0.45f));
    ApplyColor(TowerCrown, Metal);
    ApplyColor(LeftTurret, Metal);
    ApplyColor(RightTurret, Metal);
    ApplyColor(Banner, Main);
    ApplyColor(EnergyCore, Age >= 4 ? Main * 1.4f : FLinearColor(0.95f, 0.62f, 0.12f));
    ApplyColor(HealthBack, FLinearColor(0.025f, 0.03f, 0.04f));
    ApplyColor(HealthFill, Team == EPhantomAgesTeam::Player ? FLinearColor(0.08f, 0.9f, 0.85f) : FLinearColor(1.0f, 0.12f, 0.18f));

    // Generated towers carry the era silhouette. Upgrade pieces act as readable add-ons instead of replacing it.
    TowerCrown->SetRelativeLocation(FVector(0.0f, 0.0f, bUsingGeneratedTowerMesh ? 520.0f : 560.0f));
    TowerCrown->SetRelativeScale3D(FVector(bUsingGeneratedTowerMesh ? 0.56f : 1.55f));
    TowerCrown->SetVisibility(!bUsingGeneratedTowerMesh && Age >= 1);
    LeftTurret->SetVisibility(!bUsingGeneratedTowerMesh && Age >= 2);
    RightTurret->SetVisibility(!bUsingGeneratedTowerMesh && Age >= 2);
    Banner->SetRelativeLocation(FVector(0.0f, -126.0f, bUsingGeneratedTowerMesh ? 300.0f : 335.0f));
    Banner->SetRelativeScale3D(bUsingGeneratedTowerMesh ? FVector(0.42f, 0.06f, 0.82f) : FVector(0.72f, 0.08f, 1.35f));
    EnergyCore->SetRelativeLocation(FVector(0.0f, -145.0f, bUsingGeneratedTowerMesh ? 410.0f : 430.0f));
    EnergyCore->SetVisibility(Age >= 4);
    RefreshHealthBar();
}

void APhantomAgesTower::ApplyTowerUpgrades(int32 FortificationLevel, int32 PowerLevel, int32 RangeLevel)
{
    FortificationLevel = FMath::Clamp(FortificationLevel, 0, 5);
    PowerLevel = FMath::Clamp(PowerLevel, 0, 5);
    RangeLevel = FMath::Clamp(RangeLevel, 0, 5);
    const float PreviousMax = MaxHealth;
    MaxHealth = 2500.0f + Age * 330.0f + FortificationLevel * 450.0f;
    Health = FMath::Clamp(Health + FMath::Max(0.0f, MaxHealth - PreviousMax), 0.0f, MaxHealth);

    if (bUsingGeneratedTowerMesh)
    {
        const float Scale = 1.72f + Age * 0.038f + FortificationLevel * 0.032f;
        TowerMesh->SetRelativeScale3D(FVector(Scale, Scale, Scale * (1.0f + FortificationLevel * 0.012f)));
        TowerCrown->SetVisibility(PowerLevel > 0);
        TowerCrown->SetRelativeScale3D(FVector(0.48f + PowerLevel * 0.08f));
        LeftTurret->SetVisibility(PowerLevel >= 2);
        RightTurret->SetVisibility(PowerLevel >= 2);
        LeftTurret->SetRelativeLocation(FVector(-138.0f, 0.0f, 350.0f));
        RightTurret->SetRelativeLocation(FVector(138.0f, 0.0f, 350.0f));
        LeftTurret->SetRelativeScale3D(FVector(0.28f + PowerLevel * 0.035f, 0.28f + PowerLevel * 0.035f, 1.05f + PowerLevel * 0.10f));
        RightTurret->SetRelativeScale3D(LeftTurret->GetRelativeScale3D());
    }
    else
    {
        const float Growth = 1.0f + Age * 0.045f;
        const float FortifyScale = 1.0f + FortificationLevel * 0.055f;
        TowerMesh->SetRelativeScale3D(FVector(1.75f * Growth * FortifyScale, 2.35f * FortifyScale, (4.7f + Age * 0.25f) * Growth * (1.0f + FortificationLevel * 0.025f)));
        TowerCrown->SetVisibility(Age >= 1 || PowerLevel > 0);
        LeftTurret->SetVisibility(Age >= 2 || PowerLevel > 0);
        RightTurret->SetVisibility(Age >= 2 || PowerLevel > 0);
    }

    TowerCrown->SetRelativeScale3D(TowerCrown->GetRelativeScale3D() * (1.0f + PowerLevel * 0.04f));
    EnergyCore->SetVisibility(Age >= 4 || RangeLevel > 0);
    EnergyCore->SetRelativeScale3D(FVector(0.32f + RangeLevel * 0.055f));
    RefreshHealthBar();
}

void APhantomAgesTower::RefreshHealthBar()
{
    const float Ratio = MaxHealth > 0.0f ? FMath::Clamp(Health / MaxHealth, 0.0f, 1.0f) : 0.0f;
    HealthFill->SetRelativeScale3D(FVector(2.42f * Ratio, 0.075f, 0.052f));
    HealthFill->SetRelativeLocation(FVector(-121.0f * (1.0f - Ratio), -175.0f, 700.0f));
    const bool bShowBar = Ratio < 0.995f;
    HealthBack->SetVisibility(bShowBar);
    HealthFill->SetVisibility(bShowBar);
}

float APhantomAgesTower::TakeDamage(
    float DamageAmount,
    FDamageEvent const& DamageEvent,
    AController* EventInstigator,
    AActor* DamageCauser
)
{
    const APhantomAgesUnit* SourceUnit = Cast<APhantomAgesUnit>(DamageCauser);
    if (SourceUnit && SourceUnit->Team == Team) return 0.0f;
    Health = FMath::Max(0.0f, Health - DamageAmount);
    RefreshHealthBar();
    return DamageAmount;
}

APhantomAgesUnit::APhantomAgesUnit()
{
    PrimaryActorTick.bCanEverTick = true;
    Root = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
    SetRootComponent(Root);
    UStaticMesh* Cylinder = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
    UStaticMesh* Sphere = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Sphere.Sphere"));
    UStaticMesh* Cube = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cube.Cube"));
    UStaticMesh* Cone = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cone.Cone"));

    BodyMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Body"));
    BodyMesh->SetupAttachment(Root);
    BodyMesh->SetStaticMesh(Cylinder);
    BodyMesh->SetRelativeLocation(FVector(0.0f, 0.0f, 70.0f));
    BodyMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);

    HeadMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Head"));
    HeadMesh->SetupAttachment(Root);
    HeadMesh->SetStaticMesh(Sphere);
    HeadMesh->SetRelativeLocation(FVector(0.0f, 0.0f, 132.0f));
    HeadMesh->SetRelativeScale3D(FVector(0.31f));
    HeadMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);

    WeaponMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Weapon"));
    WeaponMesh->SetupAttachment(Root);
    WeaponMesh->SetStaticMesh(Cube);
    WeaponMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);

    OffhandMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Offhand"));
    OffhandMesh->SetupAttachment(Root);
    OffhandMesh->SetStaticMesh(Cube);
    OffhandMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);

    MountMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Mount"));
    MountMesh->SetupAttachment(Root);
    MountMesh->SetStaticMesh(Sphere);
    MountMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);

    WheelLeft = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("WheelLeft"));
    WheelLeft->SetupAttachment(Root);
    WheelLeft->SetStaticMesh(Cylinder);
    WheelLeft->SetCollisionEnabled(ECollisionEnabled::NoCollision);

    WheelRight = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("WheelRight"));
    WheelRight->SetupAttachment(Root);
    WheelRight->SetStaticMesh(Cylinder);
    WheelRight->SetCollisionEnabled(ECollisionEnabled::NoCollision);

    UpgradeGlow = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("UpgradeGlow"));
    UpgradeGlow->SetupAttachment(Root);
    UpgradeGlow->SetStaticMesh(Sphere);
    UpgradeGlow->SetRelativeLocation(FVector(0.0f, 18.0f, 76.0f));
    UpgradeGlow->SetRelativeScale3D(FVector(0.7f, 0.12f, 0.92f));
    UpgradeGlow->SetCollisionEnabled(ECollisionEnabled::NoCollision);

    LeftArm = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("LeftArm"));
    LeftArm->SetupAttachment(Root);
    LeftArm->SetStaticMesh(Cylinder);
    LeftArm->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    RightArm = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("RightArm"));
    RightArm->SetupAttachment(Root);
    RightArm->SetStaticMesh(Cylinder);
    RightArm->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    LeftLeg = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("LeftLeg"));
    LeftLeg->SetupAttachment(Root);
    LeftLeg->SetStaticMesh(Cylinder);
    LeftLeg->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    RightLeg = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("RightLeg"));
    RightLeg->SetupAttachment(Root);
    RightLeg->SetStaticMesh(Cylinder);
    RightLeg->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    HeadgearMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Headgear"));
    HeadgearMesh->SetupAttachment(Root);
    HeadgearMesh->SetStaticMesh(Cone);
    HeadgearMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);

    VisualModel = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("AuthoredUnitVisual"));
    VisualModel->SetupAttachment(Root);
    VisualModel->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    VisualModel->SetVisibility(false);

    SkeletalVisual = CreateDefaultSubobject<USkeletalMeshComponent>(TEXT("ProductionSkeletalVisual"));
    SkeletalVisual->SetupAttachment(Root);
    SkeletalVisual->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    SkeletalVisual->SetVisibility(false, true);

    HealthBack = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("HealthBack"));
    HealthBack->SetupAttachment(Root);
    HealthBack->SetStaticMesh(Cube);
    HealthBack->SetRelativeLocation(FVector(0.0f, -48.0f, 178.0f));
    HealthBack->SetRelativeScale3D(FVector(0.78f, 0.07f, 0.035f));
    HealthBack->SetCollisionEnabled(ECollisionEnabled::NoCollision);

    HealthFill = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("HealthFill"));
    HealthFill->SetupAttachment(Root);
    HealthFill->SetStaticMesh(Cube);
    HealthFill->SetRelativeLocation(FVector(0.0f, -54.0f, 178.0f));
    HealthFill->SetCollisionEnabled(ECollisionEnabled::NoCollision);
}

void APhantomAgesUnit::Configure(
    EPhantomAgesTeam NewTeam,
    EPhantomAgesUnitType NewType,
    int32 NewAge,
    int32 ArmorLevel,
    int32 DamageLevel,
    int32 SpeedLevel
)
{
    Team = NewTeam;
    UnitType = NewType;
    Age = NewAge;
    ArmorUpgrade = ArmorLevel;
    DamageUpgrade = DamageLevel;
    const bool bRanged = IsRanged();
    const bool bSiege = IsSiege();
    const float BaseHealth = NewType == EPhantomAgesUnitType::Cavalry ? 190.0f
        : (NewType == EPhantomAgesUnitType::Dragon ? 330.0f
        : (bSiege ? 150.0f : (bRanged ? 92.0f : 148.0f)));
    MaxHealth = BaseHealth + ArmorLevel * 26.0f + Age * 12.0f;
    Health = MaxHealth;
    const float BaseDamage = NewType == EPhantomAgesUnitType::Catapult ? 98.0f
        : (NewType == EPhantomAgesUnitType::Springald ? 70.0f
        : (NewType == EPhantomAgesUnitType::Dragon ? 62.0f : (bRanged ? 22.0f : 18.0f)));
    Damage = (BaseDamage + Age * (bSiege ? 5.0f : 2.2f)) * (1.0f + DamageLevel * 0.17f);
    MoveSpeed = (NewType == EPhantomAgesUnitType::Cavalry ? 2000.0f
        : (NewType == EPhantomAgesUnitType::Dragon ? 1900.0f : (bSiege ? 900.0f : 1500.0f))) * (1.0f + SpeedLevel * 0.1f);
    AttackRange = NewType == EPhantomAgesUnitType::SpearHunter ? 680.0f
        : (NewType == EPhantomAgesUnitType::FireArcher ? 760.0f
        : (NewType == EPhantomAgesUnitType::Catapult ? 1040.0f
        : (NewType == EPhantomAgesUnitType::Springald ? 760.0f
        : (NewType == EPhantomAgesUnitType::Dragon ? 610.0f : 125.0f))));
    AttackInterval = NewType == EPhantomAgesUnitType::Catapult ? 2.15f
        : (NewType == EPhantomAgesUnitType::Springald ? 1.48f : (bRanged ? 0.94f : 0.68f));

    // Final visibility is chosen after the authored CC0 visual is resolved below.
    BodyMesh->SetVisibility(true);
    HeadMesh->SetVisibility(!bSiege && NewType != EPhantomAgesUnitType::Dragon);
    WeaponMesh->SetVisibility(true);
    OffhandMesh->SetVisibility(false);
    MountMesh->SetVisibility(false);
    WheelLeft->SetVisibility(bSiege);
    WheelRight->SetVisibility(bSiege);
    UpgradeGlow->SetVisibility(ArmorLevel > 0 || DamageLevel > 0 || Age >= 4);
    const bool bHumanoid = !bSiege && NewType != EPhantomAgesUnitType::Dragon;

    // Use the verified full-body mannequin for humanoid combatants. This replaces the visible
    // stick-figure fallback while preserving authored siege engines and dragons.
    const bool bProductionHumanoid = bHumanoid && PhantomModularCharacter::Configure(
        this,
        SkeletalVisual,
        Root,
        TEXT("/Game/Characters/Mannequins/Meshes/SKM_Manny_Simple.SKM_Manny_Simple"),
        TEXT("/Game/Characters/Mannequins/Anims/Unarmed/MM_Idle.MM_Idle"),
        245.0f,
        0.0f,
        -90.0f,
        true
    );
    const bool bUseRecoveredMonolithicHumanoid = false;
    if (bProductionHumanoid)
    {
        ProductionIdleAnimation = LoadObject<UAnimSequence>(
            nullptr,
            TEXT("/Game/Characters/Mannequins/Anims/Unarmed/MM_Idle.MM_Idle")
        );
        ProductionMoveAnimation = LoadObject<UAnimSequence>(
            nullptr,
            TEXT("/Game/Characters/Mannequins/Anims/Unarmed/Jog/MF_Unarmed_Jog_Fwd.MF_Unarmed_Jog_Fwd")
        );
        ProductionAttackAnimation = LoadObject<UAnimSequence>(
            nullptr,
            TEXT("/Game/Characters/Mannequins/Anims/Unarmed/Attack/MM_Attack_01.MM_Attack_01")
        );
        ActiveProductionAnimation = ProductionIdleAnimation;
    }
    else if (SkeletalVisual)
    {
        SkeletalVisual->SetVisibility(false, true);
        ProductionIdleAnimation = nullptr;
        ProductionMoveAnimation = nullptr;
        ProductionAttackAnimation = nullptr;
        ActiveProductionAnimation = nullptr;
    }

    // Era identity is visual, not just a number. Every civilization tier gets a dedicated
    // character silhouette; role-specific CC0 meshes are only a fallback when an era model is unavailable.
    UStaticMesh* AuthoredVisual = nullptr;
    if (bSiege)
    {
        const TCHAR* SiegeV9 = NewType == EPhantomAgesUnitType::Catapult
            ? TEXT("/Game/Phantom/Generated/Ages/V9/Siege/SM_V9_AgesTrebuchet.SM_V9_AgesTrebuchet")
            : TEXT("/Game/Phantom/Generated/Ages/V9/Siege/SM_V9_AgesBallista.SM_V9_AgesBallista");
        AuthoredVisual = LoadObject<UStaticMesh>(nullptr, SiegeV9);
    }
    else if (NewType == EPhantomAgesUnitType::Dragon)
    {
        AuthoredVisual = LoadObject<UStaticMesh>(nullptr, Team == EPhantomAgesTeam::Player
            ? TEXT("/Game/Phantom/Generated/Ages/V9/Units/SM_V9_AgesBlueDragon.SM_V9_AgesBlueDragon")
            : TEXT("/Game/Phantom/Generated/Ages/V9/Units/SM_V9_AgesRedDragon.SM_V9_AgesRedDragon"));
    }
    // Recovered monolithic V9 humanoids have inconsistent axes/bounds in packaged builds and
    // rendered as tall black columns. Humanoids therefore use the bounded articulated rig.
    else if (bUseRecoveredMonolithicHumanoid)
    {
        // V9 high-detail faction silhouettes first; era-specific meshes remain the fallback so
        // progression still works even if a future V9 role is absent.
        const bool bPlayerV9 = Team == EPhantomAgesTeam::Player;
        const bool bRangedV9 = NewType == EPhantomAgesUnitType::SpearHunter || NewType == EPhantomAgesUnitType::FireArcher;
        const TCHAR* V9Role = bRangedV9
            ? (bPlayerV9 ? TEXT("/Game/Phantom/Generated/Ages/V9/Units/SM_V9_AgesBlueRanger.SM_V9_AgesBlueRanger") : TEXT("/Game/Phantom/Generated/Ages/V9/Units/SM_V9_AgesRedRanger.SM_V9_AgesRedRanger"))
            : (bPlayerV9 ? TEXT("/Game/Phantom/Generated/Ages/V9/Units/SM_V9_AgesBlueGuard.SM_V9_AgesBlueGuard") : TEXT("/Game/Phantom/Generated/Ages/V9/Units/SM_V9_AgesRedGuard.SM_V9_AgesRedGuard"));
        AuthoredVisual = LoadObject<UStaticMesh>(nullptr, V9Role);
        if (!AuthoredVisual) AuthoredVisual = LoadObject<UStaticMesh>(nullptr, EraCharacterAsset(Age, Team));
        if (!AuthoredVisual)
        {
            const TCHAR* CC0EraPath = EraCC0CharacterAsset(Age);
            if (CC0EraPath && FCString::Strlen(CC0EraPath) > 0) AuthoredVisual = LoadObject<UStaticMesh>(nullptr, CC0EraPath);
        }
    }
    VisualModel->SetStaticMesh(AuthoredVisual);
    VisualModel->SetVisibility(AuthoredVisual != nullptr && !bProductionHumanoid);
    if (AuthoredVisual)
    {
        const FBoxSphereBounds VisualBounds = AuthoredVisual->GetBounds();
        const float RawHeight = FMath::Max(1.0f, VisualBounds.BoxExtent.Z * 2.0f);
        const float TargetHeight = bSiege ? 360.0f : (NewType == EPhantomAgesUnitType::Dragon ? 1150.0f : 245.0f);
        const float FitScale = FMath::Clamp(TargetHeight / RawHeight, 0.025f, 60.0f);
        const float LocalBottom = (VisualBounds.Origin.Z - VisualBounds.BoxExtent.Z) * FitScale;
        VisualModel->SetRelativeScale3D(FVector(FitScale));
        VisualModel->SetRelativeLocation(FVector(0.0f, 0.0f, -LocalBottom));
        VisualModel->SetRelativeRotation(FRotator::ZeroRotator);
    }
    const bool bFallbackVisual = AuthoredVisual == nullptr && !bProductionHumanoid;
    BodyMesh->SetVisibility(bFallbackVisual);
    HeadMesh->SetVisibility(bFallbackVisual && !bSiege && NewType != EPhantomAgesUnitType::Dragon);
    WeaponMesh->SetVisibility(bFallbackVisual && !bSiege && NewType != EPhantomAgesUnitType::Dragon);
    OffhandMesh->SetVisibility(false);
    MountMesh->SetVisibility(false);
    WheelLeft->SetVisibility(bFallbackVisual && bSiege);
    WheelRight->SetVisibility(bFallbackVisual && bSiege);
    LeftArm->SetVisibility(bFallbackVisual && bHumanoid);
    RightArm->SetVisibility(bFallbackVisual && bHumanoid);
    LeftLeg->SetVisibility(bFallbackVisual && bHumanoid);
    RightLeg->SetVisibility(bFallbackVisual && bHumanoid);
    HeadgearMesh->SetVisibility(bFallbackVisual && bHumanoid && Age >= 1);

    UStaticMesh* Cube = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cube.Cube"));
    UStaticMesh* Cylinder = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
    UStaticMesh* Sphere = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Sphere.Sphere"));
    UStaticMesh* Cone = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cone.Cone"));
    BodyMesh->SetStaticMesh(Cylinder);
    WeaponMesh->SetStaticMesh(Cube);
    OffhandMesh->SetStaticMesh(Cube);
    MountMesh->SetStaticMesh(Sphere);
    BodyMesh->SetRelativeLocation(FVector(0.0f, 0.0f, 70.0f));
    BodyMesh->SetRelativeScale3D(FVector(0.42f, 0.34f, 0.74f));
    HeadMesh->SetRelativeLocation(FVector(0.0f, 0.0f, 132.0f));
    WeaponMesh->SetRelativeLocation(FVector(30.0f, -8.0f, 92.0f));
    WeaponMesh->SetRelativeRotation(FRotator(0.0f, 0.0f, -24.0f));
    WeaponMesh->SetRelativeScale3D(FVector(0.14f, 0.12f, 0.78f));
    LeftArm->SetRelativeLocation(FVector(0.0f, -28.0f, 78.0f));
    RightArm->SetRelativeLocation(FVector(0.0f, 28.0f, 78.0f));
    LeftArm->SetRelativeScale3D(FVector(0.10f, 0.10f, 0.40f));
    RightArm->SetRelativeScale3D(FVector(0.10f, 0.10f, 0.40f));
    LeftLeg->SetRelativeLocation(FVector(0.0f, -12.0f, 34.0f));
    RightLeg->SetRelativeLocation(FVector(0.0f, 12.0f, 34.0f));
    LeftLeg->SetRelativeScale3D(FVector(0.115f, 0.115f, 0.34f));
    RightLeg->SetRelativeScale3D(FVector(0.115f, 0.115f, 0.34f));
    HeadgearMesh->SetRelativeLocation(FVector(0.0f, 0.0f, 155.0f));
    HeadgearMesh->SetRelativeScale3D(FVector(0.28f, 0.28f, 0.24f));

    if (NewType == EPhantomAgesUnitType::Clubman)
    {
        WeaponMesh->SetRelativeScale3D(FVector(0.17f, 0.15f, 0.88f));
        WeaponMesh->SetRelativeRotation(FRotator(0.0f, 0.0f, -34.0f));
    }
    else if (NewType == EPhantomAgesUnitType::SpearHunter)
    {
        WeaponMesh->SetStaticMesh(Cylinder);
        WeaponMesh->SetRelativeLocation(FVector(22.0f, -8.0f, 102.0f));
        WeaponMesh->SetRelativeRotation(FRotator(0.0f, 0.0f, -66.0f));
        WeaponMesh->SetRelativeScale3D(FVector(0.055f, 0.055f, 1.28f));
    }
    else if (NewType == EPhantomAgesUnitType::FireArcher)
    {
        WeaponMesh->SetStaticMesh(Cylinder);
        WeaponMesh->SetRelativeLocation(FVector(24.0f, -8.0f, 98.0f));
        WeaponMesh->SetRelativeRotation(FRotator(0.0f, 0.0f, -50.0f));
        WeaponMesh->SetRelativeScale3D(FVector(0.045f, 0.045f, 0.95f));
        OffhandMesh->SetVisibility(true);
        OffhandMesh->SetStaticMesh(Cone);
        OffhandMesh->SetRelativeLocation(FVector(38.0f, -8.0f, 111.0f));
        OffhandMesh->SetRelativeScale3D(FVector(0.18f, 0.06f, 0.34f));
    }
    else if (NewType == EPhantomAgesUnitType::Swordsman)
    {
        WeaponMesh->SetRelativeScale3D(FVector(0.105f, 0.08f, 0.95f));
        OffhandMesh->SetVisibility(true);
        OffhandMesh->SetStaticMesh(Cylinder);
        OffhandMesh->SetRelativeLocation(FVector(-28.0f, -8.0f, 88.0f));
        OffhandMesh->SetRelativeRotation(FRotator(90.0f, 0.0f, 0.0f));
        OffhandMesh->SetRelativeScale3D(FVector(0.43f, 0.43f, 0.09f));
    }
    else if (NewType == EPhantomAgesUnitType::Cavalry)
    {
        MountMesh->SetVisibility(true);
        MountMesh->SetRelativeLocation(FVector(-5.0f, 0.0f, 62.0f));
        MountMesh->SetRelativeScale3D(FVector(1.08f, 0.5f, 0.58f));
        BodyMesh->SetRelativeLocation(FVector(0.0f, 0.0f, 128.0f));
        BodyMesh->SetRelativeScale3D(FVector(0.38f, 0.32f, 0.58f));
        HeadMesh->SetRelativeLocation(FVector(0.0f, 0.0f, 178.0f));
        WeaponMesh->SetRelativeLocation(FVector(45.0f, 0.0f, 135.0f));
        WeaponMesh->SetRelativeScale3D(FVector(0.07f, 0.06f, 1.35f));
        WeaponMesh->SetRelativeRotation(FRotator(0.0f, 0.0f, -66.0f));
    }
    else if (bSiege)
    {
        BodyMesh->SetStaticMesh(Cube);
        BodyMesh->SetRelativeLocation(FVector(0.0f, 0.0f, 62.0f));
        BodyMesh->SetRelativeScale3D(NewType == EPhantomAgesUnitType::Catapult
            ? FVector(1.15f, 0.62f, 0.32f)
            : FVector(1.02f, 0.54f, 0.24f));
        WeaponMesh->SetStaticMesh(Cylinder);
        WeaponMesh->SetRelativeLocation(FVector(10.0f, 0.0f, 112.0f));
        WeaponMesh->SetRelativeRotation(FRotator(0.0f, 0.0f, NewType == EPhantomAgesUnitType::Catapult ? -34.0f : -68.0f));
        WeaponMesh->SetRelativeScale3D(NewType == EPhantomAgesUnitType::Catapult
            ? FVector(0.095f, 0.095f, 1.15f)
            : FVector(0.075f, 0.075f, 1.38f));
        WheelLeft->SetRelativeLocation(FVector(-50.0f, -45.0f, 36.0f));
        WheelRight->SetRelativeLocation(FVector(50.0f, -45.0f, 36.0f));
        WheelLeft->SetRelativeRotation(FRotator(90.0f, 0.0f, 0.0f));
        WheelRight->SetRelativeRotation(FRotator(90.0f, 0.0f, 0.0f));
        WheelLeft->SetRelativeScale3D(FVector(0.38f, 0.38f, 0.16f));
        WheelRight->SetRelativeScale3D(FVector(0.38f, 0.38f, 0.16f));
    }
    else if (NewType == EPhantomAgesUnitType::Dragon)
    {
        BodyMesh->SetStaticMesh(Sphere);
        BodyMesh->SetRelativeLocation(FVector(0.0f, 0.0f, 120.0f));
        BodyMesh->SetRelativeScale3D(FVector(1.18f, 0.52f, 0.48f));
        WeaponMesh->SetStaticMesh(Cone);
        WeaponMesh->SetRelativeLocation(FVector(86.0f, 0.0f, 132.0f));
        WeaponMesh->SetRelativeRotation(FRotator(0.0f, 90.0f, 0.0f));
        WeaponMesh->SetRelativeScale3D(FVector(0.34f, 0.34f, 0.64f));
        OffhandMesh->SetVisibility(true);
        OffhandMesh->SetRelativeLocation(FVector(-12.0f, 0.0f, 138.0f));
        OffhandMesh->SetRelativeScale3D(FVector(0.82f, 0.11f, 0.6f));
        OffhandMesh->SetRelativeRotation(FRotator(0.0f, 0.0f, 18.0f));
    }

    if (AuthoredVisual || bProductionHumanoid)
    {
        BodyMesh->SetVisibility(false);
        HeadMesh->SetVisibility(false);
        WeaponMesh->SetVisibility(false);
        OffhandMesh->SetVisibility(false);
        MountMesh->SetVisibility(false);
        WheelLeft->SetVisibility(false);
        WheelRight->SetVisibility(false);
        LeftArm->SetVisibility(false);
        RightArm->SetVisibility(false);
        LeftLeg->SetVisibility(false);
        RightLeg->SetVisibility(false);
        HeadgearMesh->SetVisibility(false);
    }

    const FLinearColor Main = TeamColor(Team, Age);
    ApplyColor(BodyMesh, Main * 0.68f);
    ApplyColor(HeadMesh, Age == 0 ? FLinearColor(0.66f, 0.38f, 0.22f) : FLinearColor(0.72f, 0.58f, 0.46f));
    ApplyColor(WeaponMesh, NewType == EPhantomAgesUnitType::FireArcher ? FLinearColor(1.0f, 0.18f, 0.015f) : EraMetal(Age));
    ApplyColor(OffhandMesh, EraMetal(Age));
    ApplyColor(MountMesh, Team == EPhantomAgesTeam::Player ? FLinearColor(0.13f, 0.23f, 0.3f) : FLinearColor(0.28f, 0.08f, 0.08f));
    ApplyColor(WheelLeft, FLinearColor(0.18f, 0.09f, 0.035f));
    ApplyColor(WheelRight, FLinearColor(0.18f, 0.09f, 0.035f));
    ApplyColor(LeftArm, Main * 0.78f);
    ApplyColor(RightArm, Main * 0.78f);
    ApplyColor(LeftLeg, FLinearColor(Main.R * 0.42f, Main.G * 0.42f, Main.B * 0.42f));
    ApplyColor(RightLeg, FLinearColor(Main.R * 0.42f, Main.G * 0.42f, Main.B * 0.42f));
    ApplyColor(HeadgearMesh, EraMetal(Age));
    ApplyColor(UpgradeGlow, DamageUpgrade > ArmorUpgrade ? EraMetal(Age) : Main);
    ApplyColor(HealthBack, FLinearColor(0.02f, 0.025f, 0.03f));
    ApplyColor(HealthFill, Team == EPhantomAgesTeam::Player ? FLinearColor(0.12f, 0.92f, 0.82f) : FLinearColor(1.0f, 0.16f, 0.2f));
    SetActorRotation(FRotator(0.0f, Team == EPhantomAgesTeam::Player ? 0.0f : 180.0f, 0.0f));
    WeaponRestRotation = WeaponMesh->GetRelativeRotation();
    AttackCooldown = FMath::FRandRange(0.05f, AttackInterval);
    RefreshHealthBar();
}

bool APhantomAgesUnit::IsSiege() const
{
    return UnitType == EPhantomAgesUnitType::Catapult || UnitType == EPhantomAgesUnitType::Springald;
}

bool APhantomAgesUnit::IsRanged() const
{
    return UnitType == EPhantomAgesUnitType::SpearHunter
        || UnitType == EPhantomAgesUnitType::FireArcher
        || UnitType == EPhantomAgesUnitType::Dragon;
}

AActor* APhantomAgesUnit::ResolveTarget() const
{
    APhantomAgesTower* EnemyTower = nullptr;
    for (TActorIterator<APhantomAgesTower> It(GetWorld()); It; ++It)
    {
        if (It->Team != Team && It->Health > 0.0f) EnemyTower = *It;
    }
    if (UnitType == EPhantomAgesUnitType::Catapult) return EnemyTower;

    APhantomAgesUnit* Nearest = nullptr;
    float NearestDistance = TNumericLimits<float>::Max();
    for (TActorIterator<APhantomAgesUnit> It(GetWorld()); It; ++It)
    {
        if (*It == this || It->Team == Team) continue;
        if (UnitType == EPhantomAgesUnitType::Springald && !It->IsSiege()) continue;
        const float Distance = FVector::DistSquared2D(GetActorLocation(), It->GetActorLocation());
        if (Distance < NearestDistance)
        {
            NearestDistance = Distance;
            Nearest = *It;
        }
    }
    if (UnitType == EPhantomAgesUnitType::Springald) return Nearest ? Cast<AActor>(Nearest) : Cast<AActor>(EnemyTower);
    return Nearest ? Cast<AActor>(Nearest) : Cast<AActor>(EnemyTower);
}

float APhantomAgesUnit::DamageAgainst(AActor* Target) const
{
    if (UnitType == EPhantomAgesUnitType::Catapult) return Cast<APhantomAgesTower>(Target) ? Damage : 0.0f;
    if (UnitType == EPhantomAgesUnitType::Springald)
    {
        if (const APhantomAgesUnit* Unit = Cast<APhantomAgesUnit>(Target)) return Unit->IsSiege() ? Damage : 0.0f;
        if (Cast<APhantomAgesTower>(Target)) return Damage * 0.62f;
        return 0.0f;
    }
    if (Cast<APhantomAgesTower>(Target)) return FMath::Max(9.0f, Damage * 0.43f);
    if (UnitType == EPhantomAgesUnitType::Cavalry)
    {
        if (const APhantomAgesUnit* Unit = Cast<APhantomAgesUnit>(Target)) return Unit->IsRanged() ? Damage * 1.38f : Damage;
    }
    return Damage;
}

void APhantomAgesUnit::LaunchProjectile(AActor* TargetActor, float AppliedDamage)
{
    if (!TargetActor || !GetWorld()) return;
    const FVector Muzzle = GetActorLocation() + FVector(Team == EPhantomAgesTeam::Player ? 46.0f : -46.0f, 0.0f, IsSiege() ? 126.0f : 114.0f);
    APhantomAgesProjectile* Projectile = GetWorld()->SpawnActor<APhantomAgesProjectile>(Muzzle, FRotator::ZeroRotator);
    if (Projectile) Projectile->Configure(this, TargetActor, UnitType, Team, AppliedDamage);
}

void APhantomAgesUnit::RefreshHealthBar()
{
    const float Ratio = MaxHealth > 0.0f ? FMath::Clamp(Health / MaxHealth, 0.0f, 1.0f) : 0.0f;
    HealthFill->SetRelativeScale3D(FVector(0.74f * Ratio, 0.055f, 0.024f));
    HealthFill->SetRelativeLocation(FVector(-37.0f * (1.0f - Ratio), -54.0f, 178.0f));
}

void APhantomAgesUnit::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    AttackCooldown = FMath::Max(0.0f, AttackCooldown - DeltaSeconds);
    TargetRefresh -= DeltaSeconds;
    if (!CurrentTarget.IsValid() || TargetRefresh <= 0.0f)
    {
        CurrentTarget = ResolveTarget();
        TargetRefresh = 0.16f;
    }
    AActor* TargetActor = CurrentTarget.Get();
    if (!TargetActor)
    {
        SetProductionAnimation(ProductionIdleAnimation, true);
        return;
    }
    bool bMovedThisFrame = false;
    const float CenterDistance = FMath::Abs(TargetActor->GetActorLocation().X - GetActorLocation().X);
    const float TargetRadius = Cast<APhantomAgesTower>(TargetActor) ? 185.0f : 0.0f;
    const float Distance = FMath::Max(0.0f, CenterDistance - TargetRadius);
    if (Distance > AttackRange)
    {
        const float Direction = Team == EPhantomAgesTeam::Player ? 1.0f : -1.0f;
        bool bFormationBlocked = false;
        const float DesiredSpacing = IsSiege() ? 185.0f : (UnitType == EPhantomAgesUnitType::Cavalry ? 145.0f : 92.0f);
        for (TActorIterator<APhantomAgesUnit> It(GetWorld()); It; ++It)
        {
            if (*It == this || It->Team != Team) continue;
            const FVector FriendlyDelta = It->GetActorLocation() - GetActorLocation();
            const bool bAhead = FriendlyDelta.X * Direction > 0.0f;
            if (!bAhead || FMath::Abs(FriendlyDelta.Y) > 82.0f) continue;
            if (FMath::Abs(FriendlyDelta.X) < DesiredSpacing)
            {
                bFormationBlocked = true;
                break;
            }
        }
        if (!bFormationBlocked)
        {
            AddActorWorldOffset(FVector(Direction * MoveSpeed * DeltaSeconds, 0.0f, 0.0f), false);
            bMovedThisFrame = true;
            if (LeftArm->IsVisible())
            {
                const float Phase = GetWorld()->GetTimeSeconds() * 9.0f + GetActorLocation().X * 0.012f;
                const float Swing = FMath::Sin(Phase) * 24.0f;
                LeftArm->SetRelativeRotation(FRotator(Swing, 0.0f, 0.0f));
                RightArm->SetRelativeRotation(FRotator(-Swing, 0.0f, 0.0f));
                LeftLeg->SetRelativeRotation(FRotator(-Swing * 0.72f, 0.0f, 0.0f));
                RightLeg->SetRelativeRotation(FRotator(Swing * 0.72f, 0.0f, 0.0f));
            }
        }
    }
    else if (AttackCooldown <= 0.0f)
    {
        const float AppliedDamage = DamageAgainst(TargetActor);
        if (AppliedDamage > 0.0f)
        {
            if (IsRanged() || IsSiege()) LaunchProjectile(TargetActor, AppliedDamage);
            else UGameplayStatics::ApplyDamage(TargetActor, AppliedDamage, nullptr, this, UDamageType::StaticClass());
        }
        AttackCooldown = AttackInterval;
    }
    const float AttackSwing = AttackCooldown > AttackInterval * 0.72f
        ? FMath::Sin((AttackInterval - AttackCooldown) / (AttackInterval * 0.28f) * PI) * 38.0f
        : 0.0f;
    WeaponMesh->SetRelativeRotation(WeaponRestRotation + FRotator(0.0f, 0.0f, AttackSwing));
    if (AttackCooldown > AttackInterval * 0.72f)
    {
        SetProductionAnimation(ProductionAttackAnimation, false);
    }
    else
    {
        SetProductionAnimation(bMovedThisFrame ? ProductionMoveAnimation : ProductionIdleAnimation, true);
    }
}

void APhantomAgesUnit::SetProductionAnimation(UAnimSequence* Animation, bool bLoop)
{
    if (!SkeletalVisual || !SkeletalVisual->IsVisible() || !Animation || ActiveProductionAnimation == Animation) return;
    SkeletalVisual->SetAnimationMode(EAnimationMode::AnimationSingleNode);
    SkeletalVisual->PlayAnimation(Animation, bLoop);
    ActiveProductionAnimation = Animation;
}

float APhantomAgesUnit::TakeDamage(
    float DamageAmount,
    FDamageEvent const& DamageEvent,
    AController* EventInstigator,
    AActor* DamageCauser
)
{
    const APhantomAgesUnit* SourceUnit = Cast<APhantomAgesUnit>(DamageCauser);
    if (SourceUnit && SourceUnit->Team == Team) return 0.0f;
    Health = FMath::Max(0.0f, Health - DamageAmount);
    RefreshHealthBar();
    if (Health <= 0.0f)
    {
        if (APhantomAgesDirector* Director = AgesDirector(this)) Director->NotifyUnitKilled(Team, UnitType);
        Destroy();
    }
    return DamageAmount;
}

APhantomAgesPawn::APhantomAgesPawn()
{
    PrimaryActorTick.bCanEverTick = true;
    CameraRoot = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
    SetRootComponent(CameraRoot);
    SpringArm = CreateDefaultSubobject<USpringArmComponent>(TEXT("BattlefieldBoom"));
    SpringArm->SetupAttachment(CameraRoot);
    SpringArm->TargetArmLength = 0.0f;
    SpringArm->SetRelativeRotation(FRotator::ZeroRotator);
    SpringArm->bDoCollisionTest = false;
    SpringArm->bEnableCameraLag = false;
    SpringArm->bEnableCameraRotationLag = false;
    BattlefieldCamera = CreateDefaultSubobject<UCameraComponent>(TEXT("BattlefieldCamera"));
    BattlefieldCamera->SetupAttachment(SpringArm);
    BattlefieldCamera->ProjectionMode = ECameraProjectionMode::Perspective;
    BattlefieldCamera->FieldOfView = FixedBattlefieldFieldOfView;
    AutoPossessPlayer = EAutoReceiveInput::Player0;
}

void APhantomAgesPawn::BeginPlay()
{
    Super::BeginPlay();
    SetActorLocation(FixedBattlefieldCameraLocation);
    SetActorRotation(FixedBattlefieldCameraRotation);
    if (SpringArm) { SpringArm->TargetArmLength=0.0f; SpringArm->SetRelativeRotation(FRotator::ZeroRotator); }
    if (APlayerController* PC=Cast<APlayerController>(GetController()))
    {
        PC->bShowMouseCursor=true; PC->bEnableClickEvents=true;
        FInputModeGameAndUI Mode; Mode.SetHideCursorDuringCapture(false); Mode.SetLockMouseToViewportBehavior(EMouseLockMode::DoNotLock);
        PC->SetInputMode(Mode); UGameplayStatics::SetViewportMouseCaptureMode(this, EMouseCaptureMode::NoCapture);
    }
}

void APhantomAgesPawn::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds); (void)DeltaSeconds;
    SetActorLocation(FixedBattlefieldCameraLocation);
    SetActorRotation(FixedBattlefieldCameraRotation);
    if (BattlefieldCamera)
    {
        BattlefieldCamera->ProjectionMode = ECameraProjectionMode::Perspective;
        BattlefieldCamera->FieldOfView = FixedBattlefieldFieldOfView;
    }
    if (SpringArm) { SpringArm->TargetArmLength=0.0f; SpringArm->SetRelativeRotation(FRotator::ZeroRotator); }
}

void APhantomAgesPawn::Zoom(float Value){ (void)Value; }
void APhantomAgesPawn::PanForward(float Value){ (void)Value; }
void APhantomAgesPawn::PanRight(float Value){ (void)Value; }
void APhantomAgesPawn::FocusHome(){ SetActorLocation(FixedBattlefieldCameraLocation); SetActorRotation(FixedBattlefieldCameraRotation); }
void APhantomAgesPawn::FocusEnemy(){ FocusHome(); }
void APhantomAgesPawn::FocusFront(){ FocusHome(); }
void APhantomAgesPawn::ToggleCinematic(){ FocusHome(); }
void APhantomAgesPawn::CycleFront(){ FocusHome(); }

void APhantomAgesPawn::HandleClick()
{
    APlayerController* PC=Cast<APlayerController>(GetController());
    APhantomAgesDirector* Director=AgesDirector(this);
    if (!PC || !Director) return;
    float X=0.0f,Y=0.0f; int32 W=0,H=0;
    if (!PC->GetMousePosition(X,Y)) return; PC->GetViewportSize(W,H);
    if (W<=0 || H<=0) return;
    const float FW=static_cast<float>(W);
    const float FH=static_cast<float>(H);
    const float UI=FMath::Clamp(FMath::Min(FW/1920.0f,FH/1080.0f),0.78f,1.08f);
    const float DeckTop=FH-190.0f*UI;
    if (Y<DeckTop) return;
    const bool bShift=PC->IsInputKeyDown(EKeys::LeftShift)||PC->IsInputKeyDown(EKeys::RightShift);
    const bool bCtrl=PC->IsInputKeyDown(EKeys::LeftControl)||PC->IsInputKeyDown(EKeys::RightControl);
    const bool bRmb=PC->IsInputKeyDown(EKeys::RightMouseButton);
    if (X<FW*0.48f)
    {
        const int32 Slot=FMath::Clamp(FMath::FloorToInt(X/(FW*0.48f/4.0f)),0,3);
        if(bRmb) Director->RemoveQueuedPlayer(Slot,bShift?5:1);
        else if(bCtrl) Director->QueuePlayer(Slot,99);
        else Director->QueuePlayer(Slot,bShift?5:1);
        return;
    }
    if (bRmb) return; // Right-click is queue removal only.
    if (X>=FW*0.50f)
    {
        const int32 Action=FMath::Clamp(FMath::FloorToInt((X-FW*0.50f)/(FW*0.48f/5.0f)),0,4);
        if (Action==0) Director->AdvancePlayerAge();
        else if (Action==1) Director->TriggerTowerPulse();
        else if (Action==2) Director->PurchaseTowerFortification();
        else if (Action==3) Director->PurchaseTowerPower();
        else if (Action==4) Director->PurchaseTowerRange();
    }
}

void APhantomAgesPawn::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
    Super::SetupPlayerInputComponent(PlayerInputComponent);
    PlayerInputComponent->BindKey(EKeys::LeftMouseButton, IE_Pressed, this, &APhantomAgesPawn::HandleClick);
    PlayerInputComponent->BindKey(EKeys::RightMouseButton, IE_Pressed, this, &APhantomAgesPawn::HandleClick);
    PlayerInputComponent->BindAction(TEXT("Deploy1"), IE_Pressed, this, &APhantomAgesPawn::Deploy1);
    PlayerInputComponent->BindAction(TEXT("Deploy2"), IE_Pressed, this, &APhantomAgesPawn::Deploy2);
    PlayerInputComponent->BindAction(TEXT("Deploy3"), IE_Pressed, this, &APhantomAgesPawn::Deploy3);
    PlayerInputComponent->BindAction(TEXT("Deploy4"), IE_Pressed, this, &APhantomAgesPawn::Deploy4);
    PlayerInputComponent->BindAction(TEXT("Deploy5"), IE_Pressed, this, &APhantomAgesPawn::Deploy5);
    PlayerInputComponent->BindAction(TEXT("Deploy6"), IE_Pressed, this, &APhantomAgesPawn::Deploy6);
    PlayerInputComponent->BindAction(TEXT("Deploy7"), IE_Pressed, this, &APhantomAgesPawn::Deploy7);
    PlayerInputComponent->BindAction(TEXT("Deploy8"), IE_Pressed, this, &APhantomAgesPawn::Deploy8);
    PlayerInputComponent->BindAction(TEXT("ResearchArmor"), IE_Pressed, this, &APhantomAgesPawn::ResearchArmor);
    PlayerInputComponent->BindAction(TEXT("ResearchInfantry"), IE_Pressed, this, &APhantomAgesPawn::ResearchInfantry);
    PlayerInputComponent->BindAction(TEXT("ResearchRanged"), IE_Pressed, this, &APhantomAgesPawn::ResearchRanged);
    PlayerInputComponent->BindAction(TEXT("ResearchSiege"), IE_Pressed, this, &APhantomAgesPawn::ResearchSiege);
    PlayerInputComponent->BindAction(TEXT("ResearchSpeed"), IE_Pressed, this, &APhantomAgesPawn::ResearchSpeed);
    PlayerInputComponent->BindAction(TEXT("ResearchEconomy"), IE_Pressed, this, &APhantomAgesPawn::ResearchEconomy);
    PlayerInputComponent->BindAction(TEXT("AdvanceAge"), IE_Pressed, this, &APhantomAgesPawn::AdvanceAge);
    PlayerInputComponent->BindAction(TEXT("TowerPulse"), IE_Pressed, this, &APhantomAgesPawn::TowerPulse);
    PlayerInputComponent->BindAction(TEXT("SpeedOne"), IE_Pressed, this, &APhantomAgesPawn::SpeedOne);
    PlayerInputComponent->BindAction(TEXT("SpeedTwo"), IE_Pressed, this, &APhantomAgesPawn::SpeedTwo);
    PlayerInputComponent->BindAction(TEXT("SpeedFour"), IE_Pressed, this, &APhantomAgesPawn::SpeedFour);
    PlayerInputComponent->BindKey(EKeys::U, IE_Pressed, this, &APhantomAgesPawn::UpgradeTowerFortification);
    PlayerInputComponent->BindKey(EKeys::I, IE_Pressed, this, &APhantomAgesPawn::UpgradeTowerPower);
    PlayerInputComponent->BindKey(EKeys::O, IE_Pressed, this, &APhantomAgesPawn::UpgradeTowerRange);
}

#define PHANTOM_AGES_ACTION(Name, Expression) void APhantomAgesPawn::Name() { if (APhantomAgesDirector* Director = AgesDirector(this)) { Expression; } }
PHANTOM_AGES_ACTION(Deploy1, Director->DeployPlayer(0))
PHANTOM_AGES_ACTION(Deploy2, Director->DeployPlayer(1))
PHANTOM_AGES_ACTION(Deploy3, Director->DeployPlayer(2))
PHANTOM_AGES_ACTION(Deploy4, Director->DeployPlayer(3))
PHANTOM_AGES_ACTION(Deploy5, Director->DeployPlayer(4))
PHANTOM_AGES_ACTION(Deploy6, Director->DeployPlayer(5))
PHANTOM_AGES_ACTION(Deploy7, Director->DeployPlayer(6))
PHANTOM_AGES_ACTION(Deploy8, Director->DeployPlayer(7))
PHANTOM_AGES_ACTION(ResearchArmor, Director->PurchaseResearch(EPhantomAgesResearch::TroopArmor))
PHANTOM_AGES_ACTION(ResearchInfantry, Director->PurchaseResearch(EPhantomAgesResearch::InfantryDamage))
PHANTOM_AGES_ACTION(ResearchRanged, Director->PurchaseResearch(EPhantomAgesResearch::RangedDamage))
PHANTOM_AGES_ACTION(ResearchSiege, Director->PurchaseResearch(EPhantomAgesResearch::SiegeEngineering))
PHANTOM_AGES_ACTION(ResearchSpeed, Director->PurchaseResearch(EPhantomAgesResearch::MarchSpeed))
PHANTOM_AGES_ACTION(ResearchEconomy, Director->PurchaseResearch(EPhantomAgesResearch::WarEconomy))
PHANTOM_AGES_ACTION(AdvanceAge, Director->AdvancePlayerAge())
PHANTOM_AGES_ACTION(TowerPulse, Director->TriggerTowerPulse())
PHANTOM_AGES_ACTION(SpeedOne, Director->SetBattleSpeed(1.0f))
PHANTOM_AGES_ACTION(SpeedTwo, Director->SetBattleSpeed(2.0f))
PHANTOM_AGES_ACTION(SpeedFour, Director->SetBattleSpeed(4.0f))
PHANTOM_AGES_ACTION(UpgradeTowerFortification, Director->PurchaseTowerFortification())
PHANTOM_AGES_ACTION(UpgradeTowerPower, Director->PurchaseTowerPower())
PHANTOM_AGES_ACTION(UpgradeTowerRange, Director->PurchaseTowerRange())
#undef PHANTOM_AGES_ACTION

void APhantomAgesHUD::DrawHUD()
{
    Super::DrawHUD();
    if (!Canvas) return;
    APhantomAgesDirector* Director=AgesDirector(this); if(!Director)return;
    const float W=Canvas->SizeX,H=Canvas->SizeY;
    if(DrawPhantomGameShell(this,Director,W,H,TEXT("PHANTOM AGES"),TEXT("ERA WAR // EVOLVE. COUNTER. BREAK THE ENEMY FORTRESS."),TEXT("LMB unit card queue 1    SHIFT+LMB queue 5    CTRL+LMB max    RMB remove\nFIXED FULL-BATTLEFIELD CAMERA // NO WASD PAN // NO EDGE SCROLL // NO ZOOM // NO ORBIT\nQ/W/E/R/T/Y research    ESC pause"),FLinearColor(0.15f,0.92f,0.88f))) return;
    const float UI=FMath::Clamp(FMath::Min(W/1920.0f,H/1080.0f),0.78f,1.08f); auto S=[UI](float V){return V*UI;};
    UFont* F=GEngine?GEngine->GetMediumFont():nullptr;
    const FLinearColor Panel(0.006f,0.014f,0.024f,0.94f),Card(0.026f,0.046f,0.060f,0.97f),Cyan(0.14f,0.94f,0.88f),Gold(1.0f,0.72f,0.18f),Red(1.0f,0.20f,0.24f);
    const float Top=S(88.0f), Bottom=S(184.0f), Pad=S(18.0f);
    DrawRect(Panel,0,0,W,Top); DrawRect(Cyan,0,Top-S(3),W,S(3));
    DrawText(TEXT("PHANTOM AGES"),FLinearColor::White,Pad,S(9),F,S(1.02f));
    DrawText(AgeName(Director->GetAge()),Cyan,Pad,S(47),F,S(0.70f));
    DrawText(FString::Printf(TEXT("GOLD %04d   XP %03d/%03d   ARMY %02d/%02d   +%d/s   K/L %d/%d"),Director->GetGold(),Director->GetExperience(),Director->GetAdvanceCost(),Director->GetPlayerArmyCount(),Director->GetArmyCap(),Director->GetPlayerIncome(),Director->GetPlayerKills(),Director->GetPlayerLosses()),FLinearColor(0.82f,0.90f,0.95f),W*0.22f,S(13),F,S(0.68f));
    DrawText(FString::Printf(TEXT("FORT F%d  POWER P%d  RANGE R%d   SPEED %.0fX"),Director->GetTowerFortificationLevel(),Director->GetTowerPowerLevel(),Director->GetTowerRangeLevel(),Director->GetBattleSpeed()),Gold,W*0.22f,S(48),F,S(0.61f));
    if(Director->GetPlayerTower()&&Director->GetEnemyTower())
    {
        const float L=FMath::Clamp(Director->GetPlayerTower()->Health/Director->GetPlayerTower()->MaxHealth,0.0f,1.0f), R=FMath::Clamp(Director->GetEnemyTower()->Health/Director->GetEnemyTower()->MaxHealth,0.0f,1.0f);
        const float BW=W*0.20f; DrawRect(FLinearColor(0.03f,0.04f,0.05f),W*0.56f,S(22),BW,S(10)); DrawRect(Cyan,W*0.56f,S(22),BW*L,S(10));
        DrawRect(FLinearColor(0.03f,0.04f,0.05f),W*0.78f,S(22),BW,S(10)); DrawRect(Red,W*0.78f,S(22),BW*R,S(10));
        DrawText(TEXT("YOUR FORTRESS"),Cyan,W*0.56f,S(42),F,S(0.50f)); DrawText(TEXT("ENEMY FORTRESS"),Red,W*0.78f,S(42),F,S(0.50f));
    }

    const float Y=H-Bottom; DrawRect(Panel,0,Y,W,Bottom); DrawRect(Cyan,0,Y,W,S(3));
    const float UnitArea=W*0.48f, Gap=S(8), UnitW=(UnitArea-Pad*2-Gap*3)/4.0f;
    for(int32 Slot=0;Slot<4;++Slot)
    {
        const EPhantomAgesUnitType Type=Director->GetRosterUnit(Slot); const bool bValid=Slot<Director->GetRosterCount(); const float X=Pad+Slot*(UnitW+Gap);
        DrawRect(bValid?Card:FLinearColor(0.02f,0.025f,0.03f,0.92f),X,Y+S(18),UnitW,Bottom-S(36)); DrawRect(bValid?Cyan:FLinearColor(0.20f,0.22f,0.24f),X,Y+S(18),S(5),Bottom-S(36));
        if(bValid){DrawText(FString::Printf(TEXT("[%d] %s"),Slot+1,EraRosterName(Director->GetAge(),Slot)),FLinearColor::White,X+S(13),Y+S(30),F,S(0.72f)); DrawText(FString::Printf(TEXT("%d GOLD"),Director->GetUnitCost(Type)),Gold,X+S(13),Y+S(72),F,S(0.58f)); DrawText(FString::Printf(TEXT("QUEUE %d   LMB +1   RMB -1"),Director->GetQueuedCount(Slot)),FLinearColor(0.58f,0.72f,0.78f),X+S(13),Y+S(108),F,S(0.42f));}
    }
    const TCHAR* Labels[5]={TEXT("EVOLVE"),TEXT("VOLLEY"),TEXT("FORTIFY"),TEXT("POWER"),TEXT("RANGE")};
    const float ActionStart=W*0.50f, ActionArea=W*0.48f, ActionW=(ActionArea-Gap*4)/5.0f;
    for(int32 I=0;I<5;++I)
    {
        const float X=ActionStart+I*(ActionW+Gap); DrawRect(Card,X,Y+S(18),ActionW,Bottom-S(36)); DrawRect(I==0?Gold:Cyan,X,Y+S(18),S(5),Bottom-S(36)); DrawText(Labels[I],FLinearColor::White,X+S(12),Y+S(32),F,S(0.65f));
        FString Detail; if(I==0)Detail=FString::Printf(TEXT("%d XP"),Director->GetAdvanceCost()); else if(I==1)Detail=Director->GetPulseRemaining()<=0?TEXT("READY"):TEXT("COOLDOWN"); else if(I==2)Detail=FString::Printf(TEXT("%dg"),Director->GetTowerFortificationCost()); else if(I==3)Detail=FString::Printf(TEXT("%dg"),Director->GetTowerPowerCost()); else Detail=FString::Printf(TEXT("%dg"),Director->GetTowerRangeCost());
        DrawText(Detail,I==0?Gold:FLinearColor(0.65f,0.80f,0.84f),X+S(12),Y+S(76),F,S(0.54f)); DrawText(TEXT("CLICK"),FLinearColor(0.42f,0.60f,0.66f),X+S(12),Y+S(112),F,S(0.42f));
    }
    DrawText(FString::Printf(TEXT("RESEARCH  Q ARMOR %d   W MELEE %d   E RANGE %d   R SIEGE %d   T SPEED %d   Y ECON %d"),Director->GetResearchLevel(EPhantomAgesResearch::TroopArmor),Director->GetResearchLevel(EPhantomAgesResearch::InfantryDamage),Director->GetResearchLevel(EPhantomAgesResearch::RangedDamage),Director->GetResearchLevel(EPhantomAgesResearch::SiegeEngineering),Director->GetResearchLevel(EPhantomAgesResearch::MarchSpeed),Director->GetResearchLevel(EPhantomAgesResearch::WarEconomy)),FLinearColor(0.68f,0.78f,0.82f),Pad,H-S(22),F,S(0.43f));
    if(!Director->GetMatchResult().IsEmpty()){DrawRect(FLinearColor(0,0,0,0.88f),W*0.35f,H*0.42f,W*0.30f,S(95));DrawText(Director->GetMatchResult(),Director->GetMatchResult()==TEXT("VICTORY")?Cyan:Red,W*0.44f,H*0.45f,F,S(1.0f));}
}

APhantomAgesDirector::APhantomAgesDirector()
{
    PrimaryActorTick.bCanEverTick = true;
}

void APhantomAgesDirector::BeginPlay()
{
    Super::BeginPlay();
    for (int32 Index = 0; Index < 6; ++Index) ResearchLevels.Add(static_cast<EPhantomAgesResearch>(Index), 0);
    BuildBattlefield();

    // A match now opens as an actual war, not two empty towers waiting for the user to discover a button.
    // Stone Age still owns the progression; these are legitimate age-0 armies, not unlocked future cheats.
    for (int32 I=0; I<6; ++I)
    {
        SpawnUnit(EPhantomAgesTeam::Player, (I%3==0)?EPhantomAgesUnitType::FireArcher:((I%3==1)?EPhantomAgesUnitType::SpearHunter:EPhantomAgesUnitType::Clubman), 0);
        SpawnUnit(EPhantomAgesTeam::Enemy,  (I%3==0)?EPhantomAgesUnitType::FireArcher:((I%3==1)?EPhantomAgesUnitType::SpearHunter:EPhantomAgesUnitType::Clubman), 0);
    }
    Gold = FMath::Max(Gold, 360);
    EnemyGold = FMath::Max(EnemyGold, 360);
}

void APhantomAgesDirector::BuildBattlefield()
{
    SpawnSun(4.5f, FRotator(-43.0f, -26.0f, 0.0f), FLinearColor(1.0f, 0.80f, 0.60f));
    SetWorldMood(FLinearColor(0.055f, 0.075f, 0.115f), 0.0060f, FLinearColor(0.19f, 0.21f, 0.28f));
    StyleWorldPostProcess(-0.32f, 1.12f, 0.90f, 0.38f, 0.18f);

    // V10: PhantomAges_World already owns the battlefield art, armies, fortresses, siege and
    // spectacle composition. Runtime adds ONLY authoritative gameplay towers/collision/simulation.
    const bool bProductionWorld = GetWorld() && GetWorld()->GetMapName().Contains(TEXT("PhantomAges_World"));
    if (bProductionWorld)
    {
        if (AStaticMeshActor* BattleCollision = SpawnBlock(TEXT("BattleCollision"), FVector(0,0,-35), FVector(36000,11000,70), FLinearColor::Black))
            BattleCollision->SetActorHiddenInGame(true);
        PlayerTower = GetWorld()->SpawnActor<APhantomAgesTower>(FVector(-15500,0,0),FRotator::ZeroRotator);
        EnemyTower = GetWorld()->SpawnActor<APhantomAgesTower>(FVector(15500,0,0),FRotator(0,180,0));
        if(PlayerTower){PlayerTower->Configure(EPhantomAgesTeam::Player,PlayerAge);PlayerTower->ApplyTowerUpgrades(TowerFortificationLevel,TowerPowerLevel,TowerRangeLevel);PlayerTower->SetActorHiddenInGame(true);}
        if(EnemyTower){EnemyTower->Configure(EPhantomAgesTeam::Enemy,EnemyAge);EnemyTower->ApplyTowerUpgrades(EnemyAge/2,EnemyAge/2,EnemyAge/3);EnemyTower->SetActorHiddenInGame(true);}
        return;
    }

    // CANONICAL MAP CONTRACT: 360m x 110m. This entire battlefield is framed by one fixed camera.
    // Do NOT place a 360m-wide vertical cube behind the battlefield. In the prior build it read as
    // gigantic black walls. The sky now comes from SkyAtmosphere; distant mountains provide depth.
    SpawnStaticMeshAsset(TEXT("BattleMountainLeft"), TEXT("/Game/Phantom/Generated/Common/SM_BackdropMountain_A.SM_BackdropMountain_A"),
        FVector(-10500.0f, 7200.0f, 100.0f), FVector(7.0f), FRotator(0.0f, 14.0f, 0.0f), false, true);
    SpawnStaticMeshAsset(TEXT("BattleMountainCenter"), TEXT("/Game/Phantom/Generated/Common/SM_BackdropMountain_B.SM_BackdropMountain_B"),
        FVector(0.0f, 8500.0f, 100.0f), FVector(8.2f), FRotator(0.0f, 2.0f, 0.0f), false, true);
    SpawnStaticMeshAsset(TEXT("BattleMountainRight"), TEXT("/Game/Phantom/Generated/Common/SM_BackdropMountain_A.SM_BackdropMountain_A"),
        FVector(10500.0f, 7200.0f, 100.0f), FVector(7.0f), FRotator(0.0f, -14.0f, 0.0f), false, true);
    // V8 authored battlefield surface: retain invisible collision but remove the giant prototype-color slabs.
    if (AStaticMeshActor* BattleCollision = SpawnBlock(TEXT("BattleCollision"), FVector(0.0f,0.0f,-35.0f), FVector(36000.0f,11000.0f,70.0f), FLinearColor::Black))
        BattleCollision->SetActorHiddenInGame(true);
    SpawnStaticMeshAsset(TEXT("V8AgesBattlefieldTerrain"),TEXT("/Game/Phantom/Generated/Ages/V8/Terrain/SM_V8_AgesBattlefield.SM_V8_AgesBattlefield"),
        FVector(0,0,-4),FVector(1.0f),FRotator::ZeroRotator,false,false);

    // Readable lane punctuation and battlefield debris.
    for (int32 Marker=0; Marker<21; ++Marker)
    {
        const float X=-14000.0f+Marker*1400.0f;
        SpawnStaticMeshAsset(FString::Printf(TEXT("LaneMarker_%02d"),Marker), TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Rock.SM_CC0_Rock"),
            FVector(X,620.0f+(Marker%3)*260.0f,6.0f), FVector(0.28f+(Marker%4)*0.03f), FRotator(0.0f,Marker*17.0f,0.0f), false, true);
    }

    // Dense background silhouette: trees, ruins and forts stay inside the same screen instead of extending into scroll-space.
    for (int32 Index=0; Index<30; ++Index)
    {
        const float X=-17400.0f+Index*1200.0f;
        const float Y=2700.0f+(Index%4)*520.0f;
        const TCHAR* Tree=Index%3==0 ? TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Tree_A.SM_CC0_Tree_A")
                                     : TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Tree_A.SM_CC0_Tree_A");
        SpawnStaticMeshAsset(FString::Printf(TEXT("BattleTree_%02d"),Index),Tree,FVector(X,Y,8.0f),
            FVector(0.58f+(Index%4)*0.08f),FRotator(0.0f,Index*23.0f,0.0f),false,true);
    }
    for (int32 Index=0; Index<18; ++Index)
    {
        const float X=-15800.0f+Index*1850.0f;
        SpawnStaticMeshAsset(FString::Printf(TEXT("BattleRock_%02d"),Index),
            TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Rock.SM_CC0_Rock"),
            FVector(X,1700.0f+(Index%2)*650.0f,8.0f),FVector(0.70f+(Index%3)*0.10f),
            FRotator(0.0f,Index*31.0f,0.0f),false,true);
    }

    // V6 one-screen battlefield fill: use HISM for hundreds of real imported set-dressing pieces.
    // These are visual density, while the actual 40 opening combatants remain fully simulated actors.
    TArray<FTransform> AgesGrass;
    TArray<FTransform> AgesRubble;
    AgesGrass.Reserve(260);
    AgesRubble.Reserve(150);
    for (int32 I=0; I<260; ++I)
    {
        const float X=-14300.0f+(I%52)*560.0f;
        const float Y=650.0f+(I/52)*620.0f+((I*97)%360-180.0f);
        AgesGrass.Emplace(FRotator(0.0f,(I*47)%360,0.0f),FVector(X,Y,4.0f),FVector(0.36f+(I%5)*0.05f));
    }
    for (int32 I=0; I<150; ++I)
    {
        const float X=-14100.0f+(I%30)*970.0f;
        const float Y=1050.0f+(I/30)*510.0f+((I*61)%280-140.0f);
        AgesRubble.Emplace(FRotator(0.0f,(I*31)%360,0.0f),FVector(X,Y,5.0f),FVector(0.26f+(I%4)*0.045f));
    }
    SpawnInstancedMeshCluster(TEXT("AgesBattleGrassHISM"),TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Flower.SM_CC0_Flower"),AgesGrass,false);
    SpawnInstancedMeshCluster(TEXT("AgesBattleRubbleHISM"),TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Rock.SM_CC0_Rock"),AgesRubble,false);

    SpawnStaticMeshAsset(TEXT("PlayerBackHouse"),TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_House_A.SM_CC0_House_A"),
        FVector(-12400.0f,3500.0f,8.0f),FVector(0.92f),FRotator(0.0f,18.0f,0.0f),false,true);
    SpawnStaticMeshAsset(TEXT("EnemyBackHouse"),TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_House_B.SM_CC0_House_B"),
        FVector(12400.0f,3500.0f,8.0f),FVector(0.92f),FRotator(0.0f,198.0f,0.0f),false,true);

    // Midfield spectacle anchors. They make the center visually enormous without increasing navigable map size.
    const float CampXs[]={-9800.0f,-5200.0f,0.0f,5200.0f,9800.0f};
    for(int32 I=0;I<UE_ARRAY_COUNT(CampXs);++I)
    {
        const float X=CampXs[I];
        SpawnStaticMeshAsset(FString::Printf(TEXT("FrontlineCamp_%02d"),I),
            I%2?TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_House_A.SM_CC0_House_A"):TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_House_B.SM_CC0_House_B"),
            FVector(X,3900.0f,8.0f),FVector(0.52f),FRotator(0,I%2?12.0f:192.0f,0),false,true);
        SpawnStaticMeshAsset(FString::Printf(TEXT("FrontlineBanner_%02d"),I),
            TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Lantern.SM_CC0_Lantern"),
            FVector(X,2100.0f,8.0f),FVector(0.72f),FRotator::ZeroRotator,false,true);
    }

    // Three depth bands make the one-screen battlefield feel enormous without permitting camera travel.
    for(int32 I=0;I<56;++I)
    {
        const float X=-14500.0f+(I%28)*1075.0f;
        const float Y=900.0f+(I/28)*1550.0f+((I%4)-1.5f)*110.0f;
        const TCHAR* Asset=(I%5==0)?TEXT("/Game/Phantom/Generated/Common/SM_RockCluster_A.SM_RockCluster_A"):
                           ((I%3==0)?TEXT("/Game/Phantom/Generated/Common/SM_Fence_A.SM_Fence_A"):
                                     TEXT("/Game/Phantom/Generated/Common/SM_GrassTuft_A.SM_GrassTuft_A"));
        SpawnStaticMeshAsset(FString::Printf(TEXT("BattleDensity_%02d"),I),Asset,FVector(X,Y,4.0f),
            FVector(0.42f+(I%4)*0.07f),FRotator(0,I*23.0f,0),false,true);
    }
    // Giant background silhouettes are spectacle only: they cannot be navigated to and do not enlarge gameplay.
    SpawnStaticMeshAsset(TEXT("AgesBackdropTitanLeft"),TEXT("/Game/Phantom/Generated/Ages/V9/Units/SM_V9_AgesRedTitan.SM_V9_AgesRedTitan"),
        FVector(-5200,3650,250),FVector(5.8f),FRotator(0,90,0),false,true);
    SpawnStaticMeshAsset(TEXT("AgesBackdropTitanRight"),TEXT("/Game/Phantom/Generated/Ages/V9/Units/SM_V9_AgesBlueDragon.SM_V9_AgesBlueDragon"),
        FVector(5400,3800,250),FVector(6.0f),FRotator(0,-90,0),false,true);

    SpawnStaticMeshAsset(TEXT("AgesSiegeLeft"),TEXT("/Game/Phantom/Generated/Ages/V9/Siege/SM_V9_AgesTrebuchet.SM_V9_AgesTrebuchet"),
        FVector(-7600,1850,8),FVector(1.65f),FRotator(0,90,0),false,true);
    SpawnStaticMeshAsset(TEXT("AgesSiegeRight"),TEXT("/Game/Phantom/Generated/Ages/V9/Siege/SM_V9_AgesBallista.SM_V9_AgesBallista"),
        FVector(7600,1850,8),FVector(1.75f),FRotator(0,-90,0),false,true);

    SpawnStaticMeshAsset(TEXT("V8AgesRedFortress"),TEXT("/Game/Phantom/Generated/Ages/V9/Architecture/SM_V9_AgesRedFortress.SM_V9_AgesRedFortress"),
        FVector(-15500.0f,650.0f,0.0f),FVector(1.0f),FRotator(0,90,0),false,true);
    SpawnStaticMeshAsset(TEXT("V8AgesBlueFortress"),TEXT("/Game/Phantom/Generated/Ages/V9/Architecture/SM_V9_AgesBlueFortress.SM_V9_AgesBlueFortress"),
        FVector(15500.0f,650.0f,0.0f),FVector(1.0f),FRotator(0,-90,0),false,true);
    PlayerTower = GetWorld()->SpawnActor<APhantomAgesTower>(FVector(-15500.0f,0.0f,0.0f), FRotator::ZeroRotator);
    EnemyTower = GetWorld()->SpawnActor<APhantomAgesTower>(FVector(15500.0f,0.0f,0.0f), FRotator(0.0f,180.0f,0.0f));
    if (PlayerTower) { PlayerTower->Configure(EPhantomAgesTeam::Player, PlayerAge); PlayerTower->ApplyTowerUpgrades(TowerFortificationLevel, TowerPowerLevel, TowerRangeLevel); }
    if (EnemyTower) { EnemyTower->Configure(EPhantomAgesTeam::Enemy, EnemyAge); EnemyTower->ApplyTowerUpgrades(EnemyAge / 2, EnemyAge / 2, EnemyAge / 3); }
    BuildEraDecor(PlayerAge, EPhantomAgesTeam::Player);
    BuildEraDecor(EnemyAge, EPhantomAgesTeam::Enemy);
}

void APhantomAgesDirector::BuildEraDecor(int32 Age, EPhantomAgesTeam Team)
{
    Age = FMath::Clamp(Age, 0, 5);
    const bool bPlayer = Team == EPhantomAgesTeam::Player;
    const float Side = bPlayer ? -1.0f : 1.0f;
    const float BaseX = Side * 15500.0f;
    const FLinearColor Accent = bPlayer ? FLinearColor(0.06f, 0.74f, 1.0f) : FLinearColor(1.0f, 0.08f, 0.16f);
    const FLinearColor Metal = EraMetal(Age);
    const FString Prefix = FString::Printf(TEXT("%sEra%d"), bPlayer ? TEXT("Player") : TEXT("Enemy"), Age);

    // Every age adds a new readable layer around the tower: camps -> walls -> siege works -> energy monuments.
    for (int32 Index = 0; Index < 2 + FMath::Min(Age, 2); ++Index)
    {
        const FVector P(BaseX - Side * (380.0f + Index * 165.0f), -250.0f + Index * 165.0f, 12.0f);
        if (!SpawnTintedStaticMeshAsset(FString::Printf(TEXT("%s_Rock_%02d"), *Prefix, Index), TEXT("/Game/Phantom/Generated/Common/SM_RockCluster_A.SM_RockCluster_A"), P, FVector(0.38f + Index * 0.04f), Metal * 0.62f, FRotator(0.0f, 25.0f * Index, 0.0f), false))
        {
            SpawnShape(EPhantomPrimitive::Sphere, FString::Printf(TEXT("%s_RockFallback_%02d"), *Prefix, Index), P + FVector(0.0f, 0.0f, 45.0f), FVector(90.0f, 65.0f, 55.0f), Metal * 0.62f, FRotator::ZeroRotator, false);
        }
    }

    if (Age >= 1)
    {
        SpawnTintedStaticMeshAsset(FString::Printf(TEXT("%s_FenceA"), *Prefix), TEXT("/Game/Phantom/Generated/Common/SM_Fence_A.SM_Fence_A"), FVector(BaseX - Side * 390.0f, -245.0f, 8.0f), FVector(0.62f), Metal * 0.70f, FRotator(0.0f, 90.0f, 0.0f), false);
        SpawnTintedStaticMeshAsset(FString::Printf(TEXT("%s_FenceB"), *Prefix), TEXT("/Game/Phantom/Generated/Common/SM_Fence_A.SM_Fence_A"), FVector(BaseX - Side * 390.0f, 245.0f, 8.0f), FVector(0.62f), Metal * 0.70f, FRotator(0.0f, 90.0f, 0.0f), false);
    }
    if (Age >= 2)
    {
        SpawnTintedStaticMeshAsset(FString::Printf(TEXT("%s_WallA"), *Prefix), TEXT("/Game/Phantom/Generated/Legends/SM_FantasyWall.SM_FantasyWall"), FVector(BaseX - Side * 330.0f, -245.0f, 0.0f), FVector(0.48f), Metal * 0.66f, FRotator(0.0f, 90.0f, 0.0f), false);
        SpawnTintedStaticMeshAsset(FString::Printf(TEXT("%s_WallB"), *Prefix), TEXT("/Game/Phantom/Generated/Legends/SM_FantasyWall.SM_FantasyWall"), FVector(BaseX - Side * 330.0f, 245.0f, 0.0f), FVector(0.48f), Metal * 0.66f, FRotator(0.0f, 90.0f, 0.0f), false);
    }
    if (Age >= 3)
    {
        const FVector BeaconP(BaseX - Side * 620.0f, 0.0f, 8.0f);
        SpawnStaticMeshAsset(FString::Printf(TEXT("%s_Beacon"), *Prefix), TEXT("/Game/Phantom/Curated/Ages/SM_Ages_Tower.SM_Ages_Tower"), BeaconP, FVector(0.52f), FRotator(0.0f, bPlayer ? 0.0f : 180.0f, 0.0f), false, true);
        SpawnPointLight(FString::Printf(TEXT("%s_BeaconLight"), *Prefix), BeaconP + FVector(0.0f,0.0f,300.0f), Accent, 2600.0f + Age * 650.0f, 360.0f, false);
    }
    if (Age >= 4)
    {
        for (int32 Index = -1; Index <= 1; Index += 2)
        {
            const FVector P(BaseX - Side * 720.0f, Index * 165.0f, 8.0f);
            SpawnStaticMeshAsset(FString::Printf(TEXT("%s_EnergySpire_%d"), *Prefix, Index), TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Lantern.SM_CC0_Lantern"), P, FVector(1.05f), FRotator::ZeroRotator, false, true);
            SpawnPointLight(FString::Printf(TEXT("%s_EnergySpireLight_%d"), *Prefix, Index), P + FVector(0.0f,0.0f,170.0f), Accent, 2200.0f, 280.0f, false);
        }
    }
    if (Age >= 5)
    {
        const FVector CoreP(BaseX - Side * 780.0f, 0.0f, 320.0f);
        SpawnShape(EPhantomPrimitive::Sphere, FString::Printf(TEXT("%s_PhantomCore"), *Prefix), CoreP, FVector(96.0f), Accent, FRotator::ZeroRotator, false);
        SpawnPointLight(FString::Printf(TEXT("%s_PhantomCoreLight"), *Prefix), CoreP, Accent, 9000.0f, 680.0f, false);
    }
}

void APhantomAgesDirector::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    if (!MatchResult.IsEmpty())
    {
        MatchResetRemaining -= DeltaSeconds;
        if (MatchResetRemaining <= 0.0f) ResetMatch();
        return;
    }
    PlayerProductionRemaining -= DeltaSeconds;
    if(PlayerProductionRemaining<=0.0f && !PlayerProductionQueue.IsEmpty() && PlayerArmyCount<ArmyCap)
    {
        const int32 Slot=PlayerProductionQueue[0];
        PlayerProductionQueue.RemoveAt(0);
        if(PlayerProductionQueueCounts.IsValidIndex(Slot)) PlayerProductionQueueCounts[Slot]=FMath::Max(0,PlayerProductionQueueCounts[Slot]-1);
        if(Slot>=0 && Slot<RosterCount(PlayerAge))
            SpawnUnit(EPhantomAgesTeam::Player,RosterType(Slot,PlayerAge),PlayerAge);
        PlayerProductionRemaining=0.72f;
    }

    IncomeAccumulator += DeltaSeconds;
    if (IncomeAccumulator >= 1.0f)
    {
        IncomeAccumulator -= 1.0f;
        Gold += 11 + GetResearchLevel(EPhantomAgesResearch::WarEconomy) * 5;
        EnemyGold += 11 + EnemyAge * 2;
    }
    TowerPulseRemaining = FMath::Max(0.0f, TowerPulseRemaining - DeltaSeconds);
    PlayerTowerShotRemaining -= DeltaSeconds;
    EnemyTowerShotRemaining -= DeltaSeconds;
    if (PlayerTowerShotRemaining <= 0.0f)
    {
        RunTowerDefense(EPhantomAgesTeam::Player);
        PlayerTowerShotRemaining = FMath::Max(0.62f, 1.25f - TowerPowerLevel * 0.11f);
    }
    if (EnemyTowerShotRemaining <= 0.0f)
    {
        RunTowerDefense(EPhantomAgesTeam::Enemy);
        EnemyTowerShotRemaining = 1.25f;
    }
    EnemyDecisionRemaining -= DeltaSeconds;
    if (EnemyDecisionRemaining <= 0.0f)
    {
        RunEnemyDecision();
        EnemyDecisionRemaining = FMath::FRandRange(0.52f, 0.96f);
    }
    CheckMatchState();
}

EPhantomAgesUnitType APhantomAgesDirector::SlotType(int32 Slot) const { return RosterType(Slot, PlayerAge); }

int32 APhantomAgesDirector::RosterCount(int32 Age) const { return 4; }
int32 APhantomAgesDirector::GetRosterCount() const { return RosterCount(PlayerAge); }
EPhantomAgesUnitType APhantomAgesDirector::GetRosterUnit(int32 Slot) const { return RosterType(Slot, PlayerAge); }
EPhantomAgesUnitType APhantomAgesDirector::RosterType(int32 Slot, int32 Age) const
{
    Slot=FMath::Clamp(Slot,0,3); Age=FMath::Clamp(Age,0,5);
    static const EPhantomAgesUnitType Rosters[6][4]={
        {EPhantomAgesUnitType::Clubman,EPhantomAgesUnitType::SpearHunter,EPhantomAgesUnitType::FireArcher,EPhantomAgesUnitType::Clubman},
        {EPhantomAgesUnitType::Swordsman,EPhantomAgesUnitType::SpearHunter,EPhantomAgesUnitType::FireArcher,EPhantomAgesUnitType::Cavalry},
        {EPhantomAgesUnitType::Swordsman,EPhantomAgesUnitType::FireArcher,EPhantomAgesUnitType::Cavalry,EPhantomAgesUnitType::Catapult},
        {EPhantomAgesUnitType::Swordsman,EPhantomAgesUnitType::Cavalry,EPhantomAgesUnitType::Catapult,EPhantomAgesUnitType::Springald},
        {EPhantomAgesUnitType::Cavalry,EPhantomAgesUnitType::FireArcher,EPhantomAgesUnitType::Springald,EPhantomAgesUnitType::Catapult},
        {EPhantomAgesUnitType::Swordsman,EPhantomAgesUnitType::Cavalry,EPhantomAgesUnitType::Dragon,EPhantomAgesUnitType::Springald}};
    return Rosters[Age][Slot];
}

int32 APhantomAgesDirector::UnitCost(EPhantomAgesUnitType Type) const
{
    static const int32 Costs[] = { 28, 36, 44, 62, 88, 126, 112, 320 };
    return Costs[static_cast<int32>(Type)];
}

bool APhantomAgesDirector::IsUnlocked(EPhantomAgesUnitType Type, int32 Age) const
{
    if (Type == EPhantomAgesUnitType::Catapult || Type == EPhantomAgesUnitType::Springald) return Age >= 2;
    if (Type == EPhantomAgesUnitType::Dragon) return Age >= 5;
    if (Type == EPhantomAgesUnitType::Cavalry || Type == EPhantomAgesUnitType::Swordsman) return Age >= 1;
    return true;
}

void APhantomAgesDirector::DeployPlayer(int32 Slot)
{
    QueuePlayer(Slot,1);
}

void APhantomAgesDirector::QueuePlayer(int32 Slot, int32 Count)
{
    if (!MatchResult.IsEmpty() || Slot<0 || Slot>=RosterCount(PlayerAge) || Count<=0) return;
    if(PlayerProductionQueueCounts.Num()!=4) PlayerProductionQueueCounts.Init(0,4);
    const EPhantomAgesUnitType Type=RosterType(Slot,PlayerAge);
    const int32 Cost=UnitCost(Type);
    if(!IsUnlocked(Type,PlayerAge)) return;
    int32 Added=0;
    while(Added<Count && Gold>=Cost && PlayerArmyCount+PlayerProductionQueue.Num()<ArmyCap)
    {
        Gold-=Cost;
        PlayerProductionQueue.Add(Slot);
        ++PlayerProductionQueueCounts[Slot];
        ++Added;
        if(Count>=99 && Gold<Cost) break;
    }
    if(Added>0 && PlayerProductionRemaining<=0.0f) PlayerProductionRemaining=0.15f;
}

void APhantomAgesDirector::RemoveQueuedPlayer(int32 Slot, int32 Count)
{
    if(Slot<0||Slot>=4||Count<=0||PlayerProductionQueueCounts.Num()!=4) return;
    const int32 Cost=UnitCost(RosterType(Slot,PlayerAge));
    for(int32 Removed=0;Removed<Count;++Removed)
    {
        const int32 Index=PlayerProductionQueue.FindLast(Slot);
        if(Index==INDEX_NONE) break;
        PlayerProductionQueue.RemoveAt(Index);
        PlayerProductionQueueCounts[Slot]=FMath::Max(0,PlayerProductionQueueCounts[Slot]-1);
        Gold+=Cost;
    }
}

void APhantomAgesDirector::SpawnUnit(EPhantomAgesTeam Team, EPhantomAgesUnitType Type, int32 Age)
{
    const bool bSiege = Type == EPhantomAgesUnitType::Catapult || Type == EPhantomAgesUnitType::Springald;
    const bool bRanged = Type == EPhantomAgesUnitType::SpearHunter || Type == EPhantomAgesUnitType::FireArcher || Type == EPhantomAgesUnitType::Dragon;
    const int32 FormationRank = bSiege ? 2 : (bRanged ? 1 : 0);
    int32& FormationIndex = Team == EPhantomAgesTeam::Player ? PlayerFormationIndex : EnemyFormationIndex;
    const float Direction = Team == EPhantomAgesTeam::Player ? 1.0f : -1.0f;
    const float BaseX = Team == EPhantomAgesTeam::Player ? -14500.0f : 14500.0f;
    const int32 UnitIndex = FormationIndex++;
    const int32 FormationRow = UnitIndex / 5;
    const float Lane = static_cast<float>((UnitIndex % 5) - 2) * 480.0f;
    const FVector Location(BaseX - Direction * (FormationRank * 250.0f + FormationRow * 360.0f), Lane, 0.0f);
    APhantomAgesUnit* Unit = GetWorld()->SpawnActor<APhantomAgesUnit>(Location, FRotator::ZeroRotator);
    if (!Unit) return;
    if (Team == EPhantomAgesTeam::Player) ++PlayerArmyCount;
    else ++EnemyArmyCount;
    const int32 Armor = Team == EPhantomAgesTeam::Player ? GetResearchLevel(EPhantomAgesResearch::TroopArmor) : FMath::Min(5, Age / 2 + (Age >= 4 ? 1 : 0));
    const EPhantomAgesResearch DamageResearch = bSiege
        ? EPhantomAgesResearch::SiegeEngineering
        : (bRanged ? EPhantomAgesResearch::RangedDamage : EPhantomAgesResearch::InfantryDamage);
    const int32 DamageLevel = Team == EPhantomAgesTeam::Player ? GetResearchLevel(DamageResearch) : FMath::Min(5, Age / 2 + (Age >= 3 ? 1 : 0));
    const int32 SpeedLevel = Team == EPhantomAgesTeam::Player ? GetResearchLevel(EPhantomAgesResearch::MarchSpeed) : FMath::Min(5, Age / 2);
    Unit->Configure(Team, Type, Age, Armor, DamageLevel, SpeedLevel);
    // Age of War readability: combatants must read clearly from a fixed side camera.
    Unit->SetActorScale3D(FVector(4.65f));
}

void APhantomAgesDirector::PurchaseResearch(EPhantomAgesResearch Research)
{
    const int32 Level = GetResearchLevel(Research);
    const int32 Cost = 64 + Level * 48;
    if (Level >= 5 || Gold < Cost || !MatchResult.IsEmpty()) return;
    Gold -= Cost;
    ResearchLevels.Add(Research, Level + 1);
}

int32 APhantomAgesDirector::GetResearchLevel(EPhantomAgesResearch Research) const
{
    return ResearchLevels.FindRef(Research);
}

void APhantomAgesDirector::AdvancePlayerAge()
{
    const int32 Cost = GetAdvanceCost();
    if (PlayerAge >= 5 || Experience < Cost || !PlayerTower || !MatchResult.IsEmpty()) return;
    Experience -= Cost;
    ++PlayerAge;
    PlayerTower->Configure(EPhantomAgesTeam::Player, PlayerAge);
    PlayerTower->ApplyTowerUpgrades(TowerFortificationLevel, TowerPowerLevel, TowerRangeLevel);
    BuildEraDecor(PlayerAge, EPhantomAgesTeam::Player);
}

void APhantomAgesDirector::TriggerTowerPulse()
{
    if (TowerPulseRemaining > 0.0f || !PlayerTower || !MatchResult.IsEmpty()) return;
    TArray<APhantomAgesUnit*> Targets;
    for (TActorIterator<APhantomAgesUnit> It(GetWorld()); It; ++It)
    {
        if (It->Team == EPhantomAgesTeam::Enemy && FVector::DistSquared2D(PlayerTower->GetActorLocation(), It->GetActorLocation()) < FMath::Square(1850.0f)) Targets.Add(*It);
    }
    Targets.Sort([this](const APhantomAgesUnit& Left, const APhantomAgesUnit& Right)
    {
        return FVector::DistSquared(PlayerTower->GetActorLocation(), Left.GetActorLocation())
            < FVector::DistSquared(PlayerTower->GetActorLocation(), Right.GetActorLocation());
    });
    const int32 Count = FMath::Min(3, Targets.Num());
    for (int32 Index = 0; Index < Count; ++Index)
    {
        APhantomAgesProjectile* Projectile = GetWorld()->SpawnActor<APhantomAgesProjectile>(PlayerTower->GetActorLocation() + FVector(90.0f, 0.0f, 520.0f), FRotator::ZeroRotator);
        if (Projectile) Projectile->Configure(PlayerTower, Targets[Index], EPhantomAgesUnitType::FireArcher, EPhantomAgesTeam::Player, 18.0f + PlayerAge * 2.5f + TowerPowerLevel * 5.0f);
    }
    TowerPulseRemaining = 30.0f;
}

void APhantomAgesDirector::PurchaseTowerFortification()
{
    if (!PlayerTower || TowerFortificationLevel >= 5 || !MatchResult.IsEmpty()) return;
    const int32 Cost = GetTowerFortificationCost();
    if (Gold < Cost) return;
    Gold -= Cost;
    ++TowerFortificationLevel;
    PlayerTower->ApplyTowerUpgrades(TowerFortificationLevel, TowerPowerLevel, TowerRangeLevel);
}

void APhantomAgesDirector::PurchaseTowerPower()
{
    if (!PlayerTower || TowerPowerLevel >= 5 || !MatchResult.IsEmpty()) return;
    const int32 Cost = GetTowerPowerCost();
    if (Gold < Cost) return;
    Gold -= Cost;
    ++TowerPowerLevel;
    PlayerTower->ApplyTowerUpgrades(TowerFortificationLevel, TowerPowerLevel, TowerRangeLevel);
}

void APhantomAgesDirector::PurchaseTowerRange()
{
    if (!PlayerTower || TowerRangeLevel >= 5 || !MatchResult.IsEmpty()) return;
    const int32 Cost = GetTowerRangeCost();
    if (Gold < Cost) return;
    Gold -= Cost;
    ++TowerRangeLevel;
    PlayerTower->ApplyTowerUpgrades(TowerFortificationLevel, TowerPowerLevel, TowerRangeLevel);
}

void APhantomAgesDirector::SetBattleSpeed(float NewSpeed)
{
    BattleSpeed = FMath::Clamp(NewSpeed, 1.0f, 4.0f);
    UGameplayStatics::SetGlobalTimeDilation(this, BattleSpeed);
}

void APhantomAgesDirector::NotifyUnitKilled(EPhantomAgesTeam DefeatedTeam, EPhantomAgesUnitType Type)
{
    const int32 Bounty = 5 + UnitCost(Type) / 5;
    if (DefeatedTeam == EPhantomAgesTeam::Enemy)
    {
        EnemyArmyCount = FMath::Max(0, EnemyArmyCount - 1);
        ++PlayerKills;
        Gold += Bounty;
        Experience += 7 + UnitCost(Type) / 3;
    }
    else
    {
        PlayerArmyCount = FMath::Max(0, PlayerArmyCount - 1);
        ++PlayerLosses;
        EnemyGold += Bounty;
        EnemyExperience += 7 + UnitCost(Type) / 3;
    }
}

void APhantomAgesDirector::RunTowerDefense(EPhantomAgesTeam Team)
{
    APhantomAgesTower* Tower = Team == EPhantomAgesTeam::Player ? PlayerTower : EnemyTower;
    if (!Tower || Tower->Health <= 0.0f) return;
    APhantomAgesUnit* Nearest = nullptr;
    float NearestDistance = TNumericLimits<float>::Max();
    for (TActorIterator<APhantomAgesUnit> It(GetWorld()); It; ++It)
    {
        if (It->Team == Team) continue;
        const float Distance = FVector::DistSquared2D(Tower->GetActorLocation(), It->GetActorLocation());
        const float DefenseRange = Team == EPhantomAgesTeam::Player ? 2200.0f + TowerRangeLevel * 280.0f : 2200.0f + EnemyAge * 120.0f;
        if (Distance < FMath::Square(DefenseRange) && Distance < NearestDistance)
        {
            NearestDistance = Distance;
            Nearest = *It;
        }
    }
    if (!Nearest) return;
    APhantomAgesProjectile* Projectile = GetWorld()->SpawnActor<APhantomAgesProjectile>(Tower->GetActorLocation() + FVector(Team == EPhantomAgesTeam::Player ? 80.0f : -80.0f, 0.0f, 500.0f), FRotator::ZeroRotator);
    const float TowerDamage = 16.0f + Tower->Age * 3.5f + (Team == EPhantomAgesTeam::Player ? TowerPowerLevel * 7.0f : EnemyAge * 1.5f);
    if (Projectile) Projectile->Configure(Tower, Nearest, EPhantomAgesUnitType::FireArcher, Team, TowerDamage);
}

void APhantomAgesDirector::RunEnemyDecision()
{
    if (!EnemyTower || !PlayerTower || !MatchResult.IsEmpty()) return;
    const int32 AgeCost = 110 + EnemyAge * 95;
    if (EnemyAge < 5 && EnemyExperience >= AgeCost && (EnemyAge < PlayerAge || EnemyExperience > AgeCost + 45))
    {
        EnemyExperience -= AgeCost;
        ++EnemyAge;
        EnemyTower->Configure(EPhantomAgesTeam::Enemy, EnemyAge);
        EnemyTower->ApplyTowerUpgrades(EnemyAge / 2, EnemyAge / 2, EnemyAge / 3);
        BuildEraDecor(EnemyAge, EPhantomAgesTeam::Enemy);
        return;
    }
    if (EnemyArmyCount >= ArmyCap) return;

    int32 PlayerSiege = 0;
    int32 PlayerRanged = 0;
    int32 PlayerFrontline = 0;
    for (TActorIterator<APhantomAgesUnit> It(GetWorld()); It; ++It)
    {
        if (It->Team != EPhantomAgesTeam::Player) continue;
        if (It->IsSiege()) ++PlayerSiege;
        else if (It->IsRanged()) ++PlayerRanged;
        else ++PlayerFrontline;
    }

    EPhantomAgesUnitType Choice = EPhantomAgesUnitType::Clubman;
    if (PlayerSiege > 0 && IsUnlocked(EPhantomAgesUnitType::Springald, EnemyAge)) Choice = EPhantomAgesUnitType::Springald;
    else if (PlayerRanged > PlayerFrontline && IsUnlocked(EPhantomAgesUnitType::Cavalry, EnemyAge)) Choice = EPhantomAgesUnitType::Cavalry;
    else if (PlayerFrontline >= 3) Choice = EnemyAge >= 1 ? EPhantomAgesUnitType::FireArcher : EPhantomAgesUnitType::SpearHunter;
    else
    {
        TArray<EPhantomAgesUnitType> Options;
        for (int32 Slot = 0; Slot < RosterCount(EnemyAge); ++Slot)
        {
            const EPhantomAgesUnitType Type = RosterType(Slot, EnemyAge);
            if (IsUnlocked(Type, EnemyAge) && UnitCost(Type) <= EnemyGold) Options.Add(Type);
        }
        if (!Options.IsEmpty()) Choice = Options[FMath::RandRange(0, Options.Num() - 1)];
    }
    const int32 Cost = UnitCost(Choice);
    if (EnemyGold >= Cost)
    {
        EnemyGold -= Cost;
        SpawnUnit(EPhantomAgesTeam::Enemy, Choice, EnemyAge);
    }
}

void APhantomAgesDirector::CheckMatchState()
{
    if (!PlayerTower || !EnemyTower || !MatchResult.IsEmpty()) return;
    if (EnemyTower->Health <= 0.0f)
    {
        MatchResult = TEXT("VICTORY");
        BattleSpeed = 1.0f;
        UGameplayStatics::SetGlobalTimeDilation(this, 1.0f);
        MatchResetRemaining = 5.0f;
    }
    else if (PlayerTower->Health <= 0.0f)
    {
        MatchResult = TEXT("DEFEAT");
        BattleSpeed = 1.0f;
        UGameplayStatics::SetGlobalTimeDilation(this, 1.0f);
        MatchResetRemaining = 5.0f;
    }
}

void APhantomAgesDirector::ResetMatch()
{
    TArray<AActor*> Cleanup;
    for (TActorIterator<APhantomAgesUnit> It(GetWorld()); It; ++It) Cleanup.Add(*It);
    for (TActorIterator<APhantomAgesProjectile> It(GetWorld()); It; ++It) Cleanup.Add(*It);
    for (TActorIterator<AActor> It(GetWorld()); It; ++It)
    {
        for (const FName& Tag : It->Tags)
        {
            const FString Name = Tag.ToString();
            if (Name.StartsWith(TEXT("PlayerEra")) || Name.StartsWith(TEXT("EnemyEra")))
            {
                Cleanup.AddUnique(*It);
                break;
            }
        }
    }
    for (AActor* Actor : Cleanup) if (Actor) Actor->Destroy();
    if (PlayerTower) PlayerTower->Destroy();
    if (EnemyTower) EnemyTower->Destroy();
    PlayerTower = nullptr;
    EnemyTower = nullptr;
    Gold = 300;
    EnemyGold = 300;
    PlayerProductionQueue.Reset();
    PlayerProductionQueueCounts.Init(0, 4);
    PlayerProductionRemaining = 0.0f;
    Experience = 0;
    EnemyExperience = 0;
    PlayerAge = 0;
    EnemyAge = 0;
    PlayerFormationIndex = 0;
    EnemyFormationIndex = 0;
    PlayerArmyCount = 0;
    EnemyArmyCount = 0;
    PlayerKills = 0;
    PlayerLosses = 0;
    TowerFortificationLevel = 0;
    TowerPowerLevel = 0;
    TowerRangeLevel = 0;
    IncomeAccumulator = 0.0f;
    EnemyDecisionRemaining = 0.8f;
    TowerPulseRemaining = 0.0f;
    PlayerTowerShotRemaining = 0.8f;
    EnemyTowerShotRemaining = 0.8f;
    BattleSpeed = 1.0f;
    UGameplayStatics::SetGlobalTimeDilation(this, 1.0f);
    MatchResult.Reset();
    for (int32 Index = 0; Index < 6; ++Index) ResearchLevels.Add(static_cast<EPhantomAgesResearch>(Index), 0);
    PlayerTower = GetWorld()->SpawnActor<APhantomAgesTower>(FVector(-15500.0f, 0.0f, 0.0f), FRotator::ZeroRotator);
    EnemyTower = GetWorld()->SpawnActor<APhantomAgesTower>(FVector(15500.0f, 0.0f, 0.0f), FRotator(0.0f, 180.0f, 0.0f));
    const bool bProductionWorld = GetWorld() && GetWorld()->GetMapName().Contains(TEXT("PhantomAges_World"));
    if (PlayerTower)
    {
        PlayerTower->Configure(EPhantomAgesTeam::Player, PlayerAge);
        PlayerTower->ApplyTowerUpgrades(TowerFortificationLevel, TowerPowerLevel, TowerRangeLevel);
        if (bProductionWorld) PlayerTower->SetActorHiddenInGame(true);
    }
    if (EnemyTower)
    {
        EnemyTower->Configure(EPhantomAgesTeam::Enemy, EnemyAge);
        EnemyTower->ApplyTowerUpgrades(0, 0, 0);
        if (bProductionWorld) EnemyTower->SetActorHiddenInGame(true);
    }
    BuildEraDecor(PlayerAge, EPhantomAgesTeam::Player);
    BuildEraDecor(EnemyAge, EPhantomAgesTeam::Enemy);

    // A rematch must reopen with the same immediate battle readability as the first launch.
    for (int32 I=0; I<18; ++I)
    {
        SpawnUnit(EPhantomAgesTeam::Player, (I%3==0)?EPhantomAgesUnitType::FireArcher:((I%3==1)?EPhantomAgesUnitType::SpearHunter:EPhantomAgesUnitType::Clubman), 0);
        SpawnUnit(EPhantomAgesTeam::Enemy,  (I%3==0)?EPhantomAgesUnitType::FireArcher:((I%3==1)?EPhantomAgesUnitType::SpearHunter:EPhantomAgesUnitType::Clubman), 0);
    }
    Gold = FMath::Max(Gold, 520);
    EnemyGold = FMath::Max(EnemyGold, 520);
}
