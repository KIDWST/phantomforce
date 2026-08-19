#pragma once

#include "CoreMinimal.h"
#include "Core/PhantomGameDirectorBase.h"
#include "GameFramework/Character.h"
#include "GameFramework/HUD.h"
#include "GameFramework/Pawn.h"
#include "GameFramework/SaveGame.h"
#include "PhantomLegendsDirector.generated.h"

class UCameraComponent;
class USceneComponent;
class USpringArmComponent;
class UStaticMeshComponent;

UENUM(BlueprintType)
enum class EPhantomLegendsFaction : uint8
{
    Legion,
    Rift
};

UENUM(BlueprintType)
enum class EPhantomLegendsRole : uint8
{
    Worker,
    Guard,
    Ranger,
    Raider,
    Brute
};

UENUM(BlueprintType)
enum class EPhantomLegendsResource : uint8
{
    Gold,
    Wood,
    Stone,
    Shard
};

UENUM(BlueprintType)
enum class EPhantomLegendsStructureType : uint8
{
    Stronghold,
    DefenseTower,
    RiftGate
};

UCLASS()
class PHANTOMGAMES_API UPhantomLegendsSaveGame : public USaveGame
{
    GENERATED_BODY()

public:
    UPROPERTY()
    int32 Gold = 450;

    UPROPERTY()
    int32 Wood = 320;

    UPROPERTY()
    int32 Stone = 180;

    UPROPERTY()
    int32 LegacyShards = 0;

    UPROPERTY()
    int32 StrongholdLevel = 1;

    UPROPERTY()
    int32 HighestRaid = 0;
};

UCLASS()
class PHANTOMGAMES_API APhantomLegendsResourceNode : public AActor
{
    GENERATED_BODY()

public:
    APhantomLegendsResourceNode();
    void Configure(EPhantomLegendsResource NewType, int32 NewAmount);
    int32 Harvest(int32 Requested);
    EPhantomLegendsResource GetResourceType() const { return ResourceType; }
    int32 GetRemaining() const { return Remaining; }

private:
    UPROPERTY()
    USceneComponent* Root;

    UPROPERTY()
    UStaticMeshComponent* BaseMesh;

    UPROPERTY()
    UStaticMeshComponent* DetailMesh;

    EPhantomLegendsResource ResourceType = EPhantomLegendsResource::Wood;
    int32 Remaining = 500;
};

UCLASS()
class PHANTOMGAMES_API APhantomLegendsStructure : public AActor
{
    GENERATED_BODY()

public:
    APhantomLegendsStructure();
    virtual void Tick(float DeltaSeconds) override;
    virtual float TakeDamage(float DamageAmount, FDamageEvent const& DamageEvent, AController* EventInstigator, AActor* DamageCauser) override;
    void Configure(EPhantomLegendsStructureType NewType, EPhantomLegendsFaction NewFaction, int32 NewLevel);

    EPhantomLegendsFaction GetFaction() const { return Faction; }
    EPhantomLegendsStructureType GetStructureType() const { return StructureType; }
    float GetHealth() const { return Health; }
    float GetMaxHealth() const { return MaxHealth; }
    float GetCombatRadius() const;

private:
    UPROPERTY()
    USceneComponent* Root;

    UPROPERTY()
    UStaticMeshComponent* BaseMesh;

    UPROPERTY()
    UStaticMeshComponent* CrownMesh;

    UPROPERTY()
    UStaticMeshComponent* LeftSpire;

    UPROPERTY()
    UStaticMeshComponent* RightSpire;

    UPROPERTY()
    UStaticMeshComponent* CoreMesh;

    // Authored/CC0 presentation mesh. Primitive components remain as invisible gameplay collision.
    UPROPERTY()
    UStaticMeshComponent* VisualModel;

    UPROPERTY()
    UStaticMeshComponent* HealthBack;

    UPROPERTY()
    UStaticMeshComponent* HealthFill;

    EPhantomLegendsStructureType StructureType = EPhantomLegendsStructureType::DefenseTower;
    EPhantomLegendsFaction Faction = EPhantomLegendsFaction::Legion;
    int32 Level = 1;
    float Health = 500.0f;
    float MaxHealth = 500.0f;
    float AttackRemaining = 0.0f;

    void RefreshHealthBar();
    void UpdateHealthBarVisibility();
};

UCLASS()
class PHANTOMGAMES_API APhantomLegendsProjectile : public AActor
{
    GENERATED_BODY()

public:
    APhantomLegendsProjectile();
    virtual void Tick(float DeltaSeconds) override;
    void Configure(AActor* NewSource, AActor* NewTarget, EPhantomLegendsFaction NewFaction, float NewDamage);

private:
    UPROPERTY()
    UStaticMeshComponent* ProjectileMesh;

    TWeakObjectPtr<AActor> Source;
    TWeakObjectPtr<AActor> Target;
    FVector StartLocation = FVector::ZeroVector;
    EPhantomLegendsFaction Faction = EPhantomLegendsFaction::Legion;
    float Damage = 0.0f;
    float Elapsed = 0.0f;
    float Duration = 0.28f;
};

UCLASS()
class PHANTOMGAMES_API APhantomLegendsUnit : public ACharacter
{
    GENERATED_BODY()

public:
    APhantomLegendsUnit();
    virtual void Tick(float DeltaSeconds) override;
    virtual float TakeDamage(float DamageAmount, FDamageEvent const& DamageEvent, AController* EventInstigator, AActor* DamageCauser) override;
    void Configure(bool bNewWorker, const FLinearColor& Color);
    void ConfigureRole(EPhantomLegendsRole NewRole, EPhantomLegendsFaction NewFaction, int32 NewTier);
    void SetSelected(bool bNewSelected);
    void SetOrderLocation(const FVector& Location);
    void SetCombatTarget(AActor* Target);
    void SetGatherTarget(APhantomLegendsResourceNode* Node);
    bool IsPlayerUnit() const { return Faction == EPhantomLegendsFaction::Legion; }
    EPhantomLegendsRole GetRole() const { return Role; }
    EPhantomLegendsFaction GetFaction() const { return Faction; }
    float GetHealth() const { return Health; }
    float GetMaxHealth() const { return MaxHealth; }
    int32 GetVeterancy() const { return VeteranLevel; }
    void RegisterVeteranKill();
    void RestoreHealth(float Amount);
    void StopOrders();
    void SetAttackMoveLocation(const FVector& Location);
    void QueueOrderLocation(const FVector& Location, bool bAttackMoveOrder = false);
    void SetPatrolLocation(const FVector& Location);
    void SetHoldPosition(bool bHold);
    bool IsHoldingPosition() const { return bHoldPosition; }

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly)
    bool bWorker = false;

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly)
    bool bSelected = false;

private:
    UPROPERTY()
    UStaticMeshComponent* BodyMesh;

    UPROPERTY()
    UStaticMeshComponent* HeadMesh;

    UPROPERTY()
    UStaticMeshComponent* WeaponMesh;

    UPROPERTY()
    UStaticMeshComponent* ShieldMesh;

    UPROPERTY()
    UStaticMeshComponent* ChestMesh;

    UPROPERTY()
    UStaticMeshComponent* LeftShoulder;

    UPROPERTY()
    UStaticMeshComponent* RightShoulder;

    UPROPERTY()
    UStaticMeshComponent* LeftArm;

    UPROPERTY()
    UStaticMeshComponent* RightArm;

    UPROPERTY()
    UStaticMeshComponent* LeftLeg;

    UPROPERTY()
    UStaticMeshComponent* RightLeg;

    UPROPERTY()
    UStaticMeshComponent* HelmetMesh;

    UPROPERTY()
    UStaticMeshComponent* CrestMesh;

    // Modern imported character silhouette; hidden primitive rig is retained only as deterministic fallback.
    UPROPERTY()
    UStaticMeshComponent* VisualModel;

    UPROPERTY()
    UStaticMeshComponent* SelectionRing;

    UPROPERTY()
    UStaticMeshComponent* HealthBack;

    UPROPERTY()
    UStaticMeshComponent* HealthFill;

    EPhantomLegendsRole Role = EPhantomLegendsRole::Worker;
    EPhantomLegendsFaction Faction = EPhantomLegendsFaction::Legion;
    FVector OrderLocation = FVector::ZeroVector;
    TWeakObjectPtr<AActor> CombatTarget;
    TWeakObjectPtr<APhantomLegendsResourceNode> GatherTarget;
    bool bHasOrder = false;
    bool bHasPriorityCombatTarget = false;
    bool bAttackMove = false;
    bool bHoldPosition = false;
    bool bPatrolling = false;
    bool bPatrolToB = true;
    FVector PatrolA = FVector::ZeroVector;
    FVector PatrolB = FVector::ZeroVector;
    TArray<FVector> QueuedWaypoints;
    TArray<bool> QueuedAttackMoveFlags;
    float Health = 100.0f;
    float MaxHealth = 100.0f;
    float Damage = 15.0f;
    float AttackRange = 135.0f;
    float AttackInterval = 0.8f;
    float AttackRemaining = 0.0f;
    float TargetRefresh = 0.0f;
    float GatherRemaining = 0.0f;
    int32 VeteranLevel = 0;

    AActor* ResolveCombatTarget() const;
    float ComputeDamageAgainst(AActor* TargetActor) const;
    void AutoGatherNearestResource();
    void RefreshHealthBar();
    void UpdateHealthBarVisibility();
};

UCLASS()
class PHANTOMGAMES_API APhantomLegendsPawn : public APawn
{
    GENERATED_BODY()

public:
    APhantomLegendsPawn();
    virtual void BeginPlay() override;
    virtual void Tick(float DeltaSeconds) override;
    virtual void SetupPlayerInputComponent(UInputComponent* PlayerInputComponent) override;
    bool IsBoxSelecting() const { return bBoxSelecting; }
    FVector2D GetSelectionStart() const { return SelectionStart; }
    FVector2D GetSelectionCurrent() const { return SelectionCurrent; }

private:
    UPROPERTY()
    USceneComponent* CameraRoot;

    UPROPERTY()
    USpringArmComponent* SpringArm;

    UPROPERTY()
    UCameraComponent* StrategyCamera;

    float ForwardInput = 0.0f;
    float RightInput = 0.0f;
    float ZoomInput = 0.0f;
    FVector2D CameraBounds = FVector2D(202000.0f, 202000.0f);
    bool bBoxSelecting = false;
    bool bLeftMouseWasDown = false;
    bool bMiddleMouseWasDown = false;
    bool bRightMouseWasDown = false;
    bool bRightDragActive = false;
    bool bMinimapPanning = false;
    bool bHasLastMousePosition = false;
    FVector2D LastMousePosition = FVector2D::ZeroVector;
    FVector2D SelectionStart = FVector2D::ZeroVector;
    FVector2D SelectionCurrent = FVector2D::ZeroVector;
    FVector2D RightDragStart = FVector2D::ZeroVector;
    FVector2D RightDragCurrent = FVector2D::ZeroVector;
    FVector BookmarkLocations[4];
    FRotator BookmarkRotations[4];
    float BookmarkZoom[4] = { 0,0,0,0 };
    bool BookmarkSet[4] = { false,false,false,false };

    void MoveForward(float Value);
    void MoveRight(float Value);
    void Zoom(float Value);
    void ZoomIn();
    void ZoomOut();
    void RotateLeft();
    void RotateRight();
    void Select();
    void BeginBoxSelect();
    void EndBoxSelect();
    void Order();
    void BeginRightOrder();
    void EndRightOrder();
    void TrainWorker();
    void TrainGuard();
    void BuildTower();
    void TrainRanger();
    void TrainBrute();
    void UpgradeStronghold();
    void SelectArmy();
    void StopSelected();
    void CenterSelected();
    void AttackMove();
    void HoldSelected();
    void PatrolSelected();
    void FocusCapital();
    void ResetCamera();
    void ControlGroup1(); void ControlGroup2(); void ControlGroup3();
    void ControlGroup4(); void ControlGroup5(); void ControlGroup6();
    void ControlGroup7(); void ControlGroup8(); void ControlGroup9();
    void HandleControlGroup(int32 GroupIndex);
    void HandleCameraBookmark(int32 Index);
    void CameraBookmark5(); void CameraBookmark6(); void CameraBookmark7(); void CameraBookmark8();
};

UCLASS()
class PHANTOMGAMES_API APhantomLegendsHUD : public AHUD
{
    GENERATED_BODY()

public:
    virtual void DrawHUD() override;
};

UCLASS()
class PHANTOMGAMES_API APhantomLegendsDirector : public APhantomGameDirectorBase
{
    GENERATED_BODY()

public:
    APhantomLegendsDirector();
    virtual void BeginPlay() override;
    virtual bool WantsMouseCursorInGameplay() const override { return true; }
    virtual void Tick(float DeltaSeconds) override;
    void SelectAtCursor(APlayerController* PlayerController);
    void SelectScreenRect(APlayerController* PlayerController, const FVector2D& A, const FVector2D& B);
    void SelectAllArmy();
    void StopSelectedUnits();
    void HoldSelectedUnits();
    void PatrolSelectedUnits(APlayerController* PlayerController);
    void HandleControlGroup(APlayerController* PlayerController, int32 GroupIndex);
    void OrderFormationFromScreenDrag(APlayerController* PlayerController, const FVector2D& Start, const FVector2D& End);
    FVector GetSelectedCenter() const;
    void OrderAtCursor(APlayerController* PlayerController);
    void AttackMoveAtCursor(APlayerController* PlayerController);
    void TrainWorker();
    void TrainGuard();
    void TrainRanger();
    void TrainBrute();
    void BuildDefenseTower(APlayerController* PlayerController);
    void UpgradeStronghold();
    void DepositResource(EPhantomLegendsResource Resource, int32 Amount);
    void NotifyUnitDefeated(EPhantomLegendsFaction Faction, EPhantomLegendsRole DefeatedRole);
    void NotifyStructureDestroyed(EPhantomLegendsFaction Faction, EPhantomLegendsStructureType Type);
    int32 GetGold() const { return Gold; }
    int32 GetWood() const { return Wood; }
    int32 GetStone() const { return Stone; }
    int32 GetLegacyShards() const { return LegacyShards; }
    int32 GetStrongholdLevel() const { return StrongholdLevel; }
    int32 GetSelectedCount() const { return SelectedUnits.Num(); }
    int32 GetLegionPopulation() const;
    int32 GetVeteranUnitCount() const;
    int32 GetPopulationCap() const { return FMath::Min(300, 80 + StrongholdLevel * 55); }
    int32 GetRaidWave() const { return RaidWave; }
    int32 GetRaidersAlive() const { return RaidersAlive; }
    float GetRaidRemaining() const { return RaidRemaining; }
    const FString& GetRealmStatus() const { return RealmStatus; }
    APhantomLegendsStructure* GetStronghold() const { return Stronghold; }

private:
    int32 Gold = 450;
    int32 Wood = 320;
    int32 Stone = 180;
    int32 LegacyShards = 0;
    int32 StrongholdLevel = 1;
    int32 HighestRaid = 0;
    int32 RaidWave = 0;
    int32 RaidersAlive = 0;
    float EconomyAccumulator = 0.0f;
    float SaveAccumulator = 0.0f;
    float RaidRemaining = 13.0f;
    float RealmResetRemaining = 0.0f;
    FString RealmStatus = TEXT("FORTIFY THE RIFTBOUND FRONTIER");
    TArray<TWeakObjectPtr<APhantomLegendsUnit>> SelectedUnits;
    float LastSelectionClickTime = -10.0f;
    EPhantomLegendsRole LastSelectionRole = EPhantomLegendsRole::Worker;
    FVector2D LastSelectionScreen = FVector2D(-10000.0f, -10000.0f);
    TArray<TArray<TWeakObjectPtr<APhantomLegendsUnit>>> ControlGroups;

    UPROPERTY()
    APhantomLegendsStructure* Stronghold;

    UPROPERTY()
    APhantomLegendsStructure* RiftGate;

    void BuildRealm();
    void SpawnUnit(EPhantomLegendsRole UnitRole, EPhantomLegendsFaction Faction, const FVector& Location = FVector::ZeroVector);
    void SpawnRaid();
    void UpgradeFieldedUnits();
    void LoadProgress();
    void SaveProgress();
};
