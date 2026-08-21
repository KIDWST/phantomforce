#pragma once

#include "CoreMinimal.h"
#include "Core/PhantomGameDirectorBase.h"
#include "GameFramework/HUD.h"
#include "GameFramework/Pawn.h"
#include "PhantomAgesDirector.generated.h"

class UCameraComponent;
class UAnimSequence;
class USceneComponent;
class UStaticMeshComponent;
class USpringArmComponent;

class USkeletalMeshComponent;

UENUM(BlueprintType)
enum class EPhantomAgesTeam : uint8
{
    Player,
    Enemy
};

UENUM(BlueprintType)
enum class EPhantomAgesUnitType : uint8
{
    Clubman,
    SpearHunter,
    FireArcher,
    Swordsman,
    Cavalry,
    Catapult,
    Springald,
    Dragon
};

UENUM(BlueprintType)
enum class EPhantomAgesResearch : uint8
{
    TroopArmor,
    InfantryDamage,
    RangedDamage,
    SiegeEngineering,
    MarchSpeed,
    WarEconomy
};

UCLASS()
class PHANTOMGAMES_API APhantomAgesProjectile : public AActor
{
    GENERATED_BODY()

public:
    APhantomAgesProjectile();
    virtual void Tick(float DeltaSeconds) override;
    void Configure(
        AActor* NewSource,
        AActor* NewTarget,
        EPhantomAgesUnitType NewType,
        EPhantomAgesTeam NewTeam,
        float NewDamage
    );

private:
    UPROPERTY()
    UStaticMeshComponent* ProjectileMesh;

    TWeakObjectPtr<AActor> Source;
    TWeakObjectPtr<AActor> Target;
    FVector StartLocation = FVector::ZeroVector;
    EPhantomAgesUnitType Type = EPhantomAgesUnitType::SpearHunter;
    float Damage = 0.0f;
    float Elapsed = 0.0f;
    float Duration = 0.35f;
    float ArcHeight = 0.0f;
};

UCLASS()
class PHANTOMGAMES_API APhantomAgesTower : public AActor
{
    GENERATED_BODY()

public:
    APhantomAgesTower();
    void Configure(EPhantomAgesTeam NewTeam, int32 NewAge);
    void ApplyTowerUpgrades(int32 FortificationLevel, int32 PowerLevel, int32 RangeLevel);
    virtual float TakeDamage(float DamageAmount, FDamageEvent const& DamageEvent, AController* EventInstigator, AActor* DamageCauser) override;

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly)
    EPhantomAgesTeam Team = EPhantomAgesTeam::Player;

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly)
    float Health = 2500.0f;

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly)
    float MaxHealth = 2500.0f;

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly)
    int32 Age = 0;

private:
    UPROPERTY()
    USceneComponent* Root;

    UPROPERTY()
    UStaticMeshComponent* TowerMesh;

    UPROPERTY()
    UStaticMeshComponent* TowerCrown;

    UPROPERTY()
    UStaticMeshComponent* LeftTurret;

    UPROPERTY()
    UStaticMeshComponent* RightTurret;

    UPROPERTY()
    UStaticMeshComponent* Banner;

    UPROPERTY()
    UStaticMeshComponent* EnergyCore;

    UPROPERTY()
    UStaticMeshComponent* HealthBack;

    UPROPERTY()
    UStaticMeshComponent* HealthFill;

    bool bUsingGeneratedTowerMesh = false;

    void RefreshHealthBar();
};

UCLASS()
class PHANTOMGAMES_API APhantomAgesUnit : public AActor
{
    GENERATED_BODY()

public:
    APhantomAgesUnit();
    virtual void Tick(float DeltaSeconds) override;
    virtual float TakeDamage(float DamageAmount, FDamageEvent const& DamageEvent, AController* EventInstigator, AActor* DamageCauser) override;
    void Configure(
        EPhantomAgesTeam NewTeam,
        EPhantomAgesUnitType NewType,
        int32 NewAge,
        int32 ArmorLevel,
        int32 DamageLevel,
        int32 SpeedLevel
    );
    bool IsSiege() const;
    bool IsRanged() const;

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly)
    EPhantomAgesTeam Team = EPhantomAgesTeam::Player;

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly)
    EPhantomAgesUnitType UnitType = EPhantomAgesUnitType::Clubman;

private:
    UPROPERTY()
    USceneComponent* Root;

    UPROPERTY()
    UStaticMeshComponent* BodyMesh;

    UPROPERTY()
    UStaticMeshComponent* HeadMesh;

    // Zero To Hero humanoid articulation components. These are created and
    // animated by PhantomAgesDirector.cpp and therefore must be class members.
    UPROPERTY()
    UStaticMeshComponent* LeftArm;

    UPROPERTY()
    UStaticMeshComponent* RightArm;

    UPROPERTY()
    UStaticMeshComponent* LeftLeg;

    UPROPERTY()
    UStaticMeshComponent* RightLeg;

    UPROPERTY()
    UStaticMeshComponent* HeadgearMesh;

    // Imported character presentation mesh. Primitive articulation remains only as fallback.
    UPROPERTY()
    UStaticMeshComponent* VisualModel;

    // V11 real rigged/animated humanoid presentation. Static primitives are fallback only.
    UPROPERTY()
    USkeletalMeshComponent* SkeletalVisual;

    UPROPERTY()
    UAnimSequence* ProductionIdleAnimation = nullptr;

    UPROPERTY()
    UAnimSequence* ProductionMoveAnimation = nullptr;

    UPROPERTY()
    UAnimSequence* ProductionAttackAnimation = nullptr;

    UPROPERTY()
    UAnimSequence* ActiveProductionAnimation = nullptr;

    UPROPERTY()
    UStaticMeshComponent* WeaponMesh;

    UPROPERTY()
    UStaticMeshComponent* OffhandMesh;

    UPROPERTY()
    UStaticMeshComponent* MountMesh;

    UPROPERTY()
    UStaticMeshComponent* WheelLeft;

    UPROPERTY()
    UStaticMeshComponent* WheelRight;

    UPROPERTY()
    UStaticMeshComponent* UpgradeGlow;

    UPROPERTY()
    UStaticMeshComponent* HealthBack;

    UPROPERTY()
    UStaticMeshComponent* HealthFill;

    TWeakObjectPtr<AActor> CurrentTarget;
    float Health = 100.0f;
    float MaxHealth = 100.0f;
    float Damage = 16.0f;
    float MoveSpeed = 115.0f;
    float AttackRange = 120.0f;
    float AttackInterval = 0.85f;
    float AttackCooldown = 0.0f;
    float TargetRefresh = 0.0f;
    int32 Age = 0;
    int32 ArmorUpgrade = 0;
    int32 DamageUpgrade = 0;
    FRotator WeaponRestRotation = FRotator::ZeroRotator;

    AActor* ResolveTarget() const;
    float DamageAgainst(AActor* Target) const;
    void LaunchProjectile(AActor* Target, float AppliedDamage);
    void RefreshHealthBar();
    void SetProductionAnimation(UAnimSequence* Animation, bool bLoop);
};

UCLASS()
class PHANTOMGAMES_API APhantomAgesPawn : public APawn
{
    GENERATED_BODY()

public:
    APhantomAgesPawn();
    virtual void BeginPlay() override;
    virtual void Tick(float DeltaSeconds) override;
    virtual void SetupPlayerInputComponent(UInputComponent* PlayerInputComponent) override;

private:
    UPROPERTY()
    USceneComponent* CameraRoot;

    UPROPERTY()
    USpringArmComponent* SpringArm;

    UPROPERTY()
    UCameraComponent* BattlefieldCamera;

    float CameraZoomMultiplier = 1.0f;
    float CameraForwardInput = 0.0f;
    float CameraRightInput = 0.0f;
    bool bMiddleMouseWasDown = false;
    bool bRightMouseWasDown = false;
    bool bCinematicCamera = false;
    FVector2D LastMousePosition = FVector2D::ZeroVector;

    void Zoom(float Value);
    void PanForward(float Value);
    void PanRight(float Value);
    void FocusHome();
    void FocusEnemy();
    void FocusFront();
    void ToggleCinematic();
    void CycleFront();
    void HandleClick();
    void Deploy1();
    void Deploy2();
    void Deploy3();
    void Deploy4();
    void Deploy5();
    void Deploy6();
    void Deploy7();
    void Deploy8();
    void ResearchArmor();
    void ResearchInfantry();
    void ResearchRanged();
    void ResearchSiege();
    void ResearchSpeed();
    void ResearchEconomy();
    void AdvanceAge();
    void TowerPulse();
    void SpeedOne();
    void SpeedTwo();
    void SpeedFour();
    void UpgradeTowerFortification();
    void UpgradeTowerPower();
    void UpgradeTowerRange();
};

UCLASS()
class PHANTOMGAMES_API APhantomAgesHUD : public AHUD
{
    GENERATED_BODY()

public:
    virtual void DrawHUD() override;
};

UCLASS()
class PHANTOMGAMES_API APhantomAgesDirector : public APhantomGameDirectorBase
{
    GENERATED_BODY()

public:
    APhantomAgesDirector();
    virtual void BeginPlay() override;
    virtual void Tick(float DeltaSeconds) override;
    virtual bool WantsMouseCursorInGameplay() const override { return true; }
    void DeployPlayer(int32 Slot);
    void QueuePlayer(int32 Slot, int32 Count = 1);
    void RemoveQueuedPlayer(int32 Slot, int32 Count = 1);
    void PurchaseResearch(EPhantomAgesResearch Research);
    void AdvancePlayerAge();
    void TriggerTowerPulse();
    void SetBattleSpeed(float NewSpeed);
    void PurchaseTowerFortification();
    void PurchaseTowerPower();
    void PurchaseTowerRange();
    void NotifyUnitKilled(EPhantomAgesTeam DefeatedTeam, EPhantomAgesUnitType Type);
    int32 GetGold() const { return Gold; }
    int32 GetEnemyGold() const { return EnemyGold; }
    int32 GetAge() const { return PlayerAge; }
    int32 GetEnemyAge() const { return EnemyAge; }
    int32 GetAdvanceCost() const { return 110 + PlayerAge * 95; }
    int32 GetExperience() const { return Experience; }
    int32 GetEnemyExperience() const { return EnemyExperience; }
    int32 GetRosterCount() const;
    EPhantomAgesUnitType GetRosterUnit(int32 Slot) const;
    int32 GetResearchLevel(EPhantomAgesResearch Research) const;
    float GetPulseRemaining() const { return TowerPulseRemaining; }
    float GetBattleSpeed() const { return BattleSpeed; }
    const FString& GetMatchResult() const { return MatchResult; }
    int32 GetUnitCost(EPhantomAgesUnitType Type) const { return UnitCost(Type); }
    bool IsPlayerUnlocked(EPhantomAgesUnitType Type) const { return IsUnlocked(Type, PlayerAge); }
    APhantomAgesTower* GetPlayerTower() const { return PlayerTower; }
    APhantomAgesTower* GetEnemyTower() const { return EnemyTower; }
    int32 GetPlayerArmyCount() const { return PlayerArmyCount; }
    int32 GetEnemyArmyCount() const { return EnemyArmyCount; }
    int32 GetArmyCap() const { return ArmyCap; }
    int32 GetPlayerKills() const { return PlayerKills; }
    int32 GetPlayerLosses() const { return PlayerLosses; }
    int32 GetPlayerIncome() const { return 11 + GetResearchLevel(EPhantomAgesResearch::WarEconomy) * 5; }
    int32 GetTowerFortificationLevel() const { return TowerFortificationLevel; }
    int32 GetTowerPowerLevel() const { return TowerPowerLevel; }
    int32 GetTowerRangeLevel() const { return TowerRangeLevel; }
    int32 GetTowerFortificationCost() const { return 90 + TowerFortificationLevel * 75; }
    int32 GetTowerPowerCost() const { return 85 + TowerPowerLevel * 70; }
    int32 GetTowerRangeCost() const { return 80 + TowerRangeLevel * 65; }
    int32 GetQueuedCount(int32 Slot) const { return PlayerProductionQueueCounts.IsValidIndex(Slot) ? PlayerProductionQueueCounts[Slot] : 0; }

private:
    int32 Gold = 300;
    int32 EnemyGold = 300;
    int32 Experience = 0;
    int32 EnemyExperience = 0;
    int32 PlayerAge = 0;
    int32 EnemyAge = 0;
    int32 PlayerFormationIndex = 0;
    int32 EnemyFormationIndex = 0;
    int32 PlayerArmyCount = 0;
    int32 EnemyArmyCount = 0;
    int32 PlayerKills = 0;
    int32 PlayerLosses = 0;
    int32 ArmyCap = 96;
    int32 TowerFortificationLevel = 0;
    int32 TowerPowerLevel = 0;
    int32 TowerRangeLevel = 0;
    float IncomeAccumulator = 0.0f;
    float EnemyDecisionRemaining = 0.8f;
    float TowerPulseRemaining = 0.0f;
    float PlayerTowerShotRemaining = 0.8f;
    float EnemyTowerShotRemaining = 0.8f;
    float BattleSpeed = 1.0f;
    float MatchResetRemaining = 0.0f;
    FString MatchResult;
    TArray<int32> PlayerProductionQueue;
    TArray<int32> PlayerProductionQueueCounts = {0,0,0,0};
    float PlayerProductionRemaining = 0.0f;
    TMap<EPhantomAgesResearch, int32> ResearchLevels;

    UPROPERTY()
    APhantomAgesTower* PlayerTower;

    UPROPERTY()
    APhantomAgesTower* EnemyTower;

    void BuildBattlefield();
    void BuildEraDecor(int32 Age, EPhantomAgesTeam Team);
    void SpawnUnit(EPhantomAgesTeam Team, EPhantomAgesUnitType Type, int32 Age);
    bool IsUnlocked(EPhantomAgesUnitType Type, int32 Age) const;
    int32 UnitCost(EPhantomAgesUnitType Type) const;
    EPhantomAgesUnitType SlotType(int32 Slot) const;
    EPhantomAgesUnitType RosterType(int32 Slot, int32 Age) const;
    int32 RosterCount(int32 Age) const;
    void RunEnemyDecision();
    void RunTowerDefense(EPhantomAgesTeam Team);
    void CheckMatchState();
    void ResetMatch();
};
