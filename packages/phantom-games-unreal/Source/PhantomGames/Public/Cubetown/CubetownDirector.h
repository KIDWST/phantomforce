#pragma once

#include "CoreMinimal.h"
#include "Core/PhantomGameDirectorBase.h"
#include "GameFramework/Character.h"
#include "GameFramework/HUD.h"
#include "GameFramework/SaveGame.h"
#include "CubetownDirector.generated.h"

class UCameraComponent;
class UAnimInstance;
class UAnimSequence;
class USceneComponent;
class USpringArmComponent;
class UStaticMeshComponent;
class AStaticMeshActor;
class ADirectionalLight;
class APointLight;
class ASkyLight;

UENUM(BlueprintType)
enum class ECubetownBlockType : uint8
{
    Grass,
    Stone,
    Amber,
    Crystal,
    Wood,
    Water
};

UENUM(BlueprintType)
enum class ECubetownEchoType : uint8
{
    Blade,
    Boulder,
    Bloom,
    Bridge,
    TideSpire,
    SkyPad,
    BlastBloom,
    GaleTotem,
    Climbroot
};

UENUM(BlueprintType)
enum class ECubetownEnemyType : uint8
{
    Gloomling,
    Roller,
    BloomWisp,
    RiftGuardian,
    PaleWarden,
    CathedralStag,
    MarionetteMayor,
    BurrowMaw,
    SkyfallMatron,
    EclipseSeraph,
    Aktarus
};

UENUM(BlueprintType)
enum class ECubetownFriend : uint8
{
    Sera,
    Mara,
    Tess,
    Vara,
    Brann,
    Orin
};

UENUM(BlueprintType)
enum class EShadowbearerWorldState : uint8
{
    Dawn,
    Omen,
    Shadowfall,
    Restoring,
    Restored
};

UENUM(BlueprintType)
enum class EShadowbearerCinematic : uint8
{
    None,
    Prologue,
    ReturnedSoul,
    MemoryReveal,
    AktarusDefeat,
    Ascension,
    DawnsReturn,
    Festival
};

UCLASS()
class PHANTOMGAMES_API UCubetownSaveGame : public USaveGame
{
    GENERATED_BODY()

public:
    UPROPERTY()
    TArray<int32> Inventory = { 28, 18, 10, 6, 18, 0 };

    UPROPERTY()
    int32 EchoEnergy = 24;

    UPROPERTY()
    int32 ShrinesRestored = 0;

    UPROPERTY()
    TArray<int32> ActiveShrineIndices;

    UPROPERTY()
    int32 WorldCycle = 1;

    UPROPERTY()
    TArray<FIntVector> PlacedBlockGrids;

    UPROPERTY()
    TArray<uint8> PlacedBlockTypes;

    UPROPERTY()
    TArray<FIntVector> RemovedBlockGrids;

    UPROPERTY()
    bool bBladeUnlocked = true;

    UPROPERTY()
    bool bBoulderUnlocked = false;

    UPROPERTY()
    bool bBloomUnlocked = false;

    UPROPERTY()
    bool bGuardianDefeated = false;

    // V16 persistent Memorycraft discovery bitset. Bits map to ECubetownEchoType values.
    UPROPERTY()
    uint32 CreationUnlockMask = 0x7u;

    UPROPERTY()
    TArray<int32> Friendship = { 0, 0, 0 };

    UPROPERTY()
    int32 StoryChapter = 0;

    UPROPERTY()
    int32 ForgeTier = 0;

    // Only builds authored against the current production scale may be restored. Older experimental
    // saves used radically different mesh units and could cover the new town with kilometre-wide walls.
    UPROPERTY()
    int32 BuildSchemaVersion = 0;

    // Persistent architecture data stores asset identifiers + transforms rather than raw Actor references.
    UPROPERTY()
    TArray<FString> BuildAssetPaths;

    UPROPERTY()
    TArray<FTransform> BuildTransforms;

    UPROPERTY()
    float TimeOfDayHours = 9.25f;

    // Shadowbearer V1 extends the existing save non-destructively. Old CubeTown saves load into
    // the Dawn prologue with their inventory/build data intact.
    UPROPERTY()
    FString PlayerName = TEXT("Zane");

    UPROPERTY()
    int32 ShadowbearerSaveVersion = 2;

    UPROPERTY()
    uint8 ShadowbearerWorldState = static_cast<uint8>(EShadowbearerWorldState::Dawn);

    UPROPERTY()
    int32 OpeningQuestStep = 0;

    UPROPERTY()
    bool bLanternComponentDelivered = false;

    UPROPERTY()
    bool bPaleWardenEncountered = false;

    UPROPERTY()
    bool bFirstShadowSolidified = false;

    UPROPERTY()
    bool bBramblewickLampRestored = false;

    // Complete-story progression is additive so legacy CubeTown/Shadowbearer saves remain valid.
    UPROPERTY()
    int32 CanonicalChapter = 1;

    UPROPERTY()
    bool bPrologueSeen = false;

    UPROPERTY()
    uint32 ReturnedSoulMask = 0;

    UPROPERTY()
    uint32 ArmamentMask = 0;

    UPROPERTY()
    uint32 MemoryMask = 0;

    UPROPERTY()
    int32 EquippedArmament = -1;

    UPROPERTY()
    bool bNightspineOwned = false;

    UPROPERTY()
    bool bVestigeOwned = false;

    UPROPERTY()
    bool bVestigeEquipped = false;

    UPROPERTY()
    bool bFirstEclipseUnlocked = false;

    UPROPERTY()
    bool bEclipsedDawnlantern = false;

    UPROPERTY()
    bool bPostgameUnlocked = false;
};

UCLASS()
class PHANTOMGAMES_API ACubetownBlock : public AActor
{
    GENERATED_BODY()

public:
    ACubetownBlock();
    void Configure(ECubetownBlockType NewType, const FIntVector& NewGrid, bool bNewMineable);
    ECubetownBlockType GetBlockType() const { return BlockType; }
    const FIntVector& GetGrid() const { return Grid; }
    bool IsMineable() const { return bMineable; }

private:
    UPROPERTY()
    UStaticMeshComponent* BlockMesh;

    UPROPERTY()
    UStaticMeshComponent* SurfaceDetail;

    ECubetownBlockType BlockType = ECubetownBlockType::Grass;
    FIntVector Grid = FIntVector::ZeroValue;
    bool bMineable = false;
};

UCLASS()
class PHANTOMGAMES_API ACubetownShrine : public AActor
{
    GENERATED_BODY()

public:
    ACubetownShrine();
    virtual void Tick(float DeltaSeconds) override;
    void Configure(int32 NewIndex);
    void Activate();
    bool IsActive() const { return bActive; }

private:
    UPROPERTY()
    USceneComponent* Root;

    UPROPERTY()
    UStaticMeshComponent* Pedestal;

    UPROPERTY()
    UStaticMeshComponent* RuneCore;

    UPROPERTY()
    UStaticMeshComponent* Ring;

    UPROPERTY()
    UStaticMeshComponent* LeftPillar;

    UPROPERTY()
    UStaticMeshComponent* RightPillar;

    int32 ShrineIndex = 0;
    bool bActive = false;
    bool bUsingGeneratedShrine = false;
};

UCLASS()
class PHANTOMGAMES_API ACubetownEnemy : public ACharacter
{
    GENERATED_BODY()

public:
    ACubetownEnemy();
    virtual void Tick(float DeltaSeconds) override;
    virtual float TakeDamage(float DamageAmount, FDamageEvent const& DamageEvent, AController* EventInstigator, AActor* DamageCauser) override;
    void Configure(ECubetownEnemyType NewType, int32 Tier);
    ECubetownEnemyType GetEnemyType() const { return EnemyType; }

private:
    UPROPERTY()
    UStaticMeshComponent* BodyMesh;

    UPROPERTY()
    UStaticMeshComponent* EyeMesh;

    UPROPERTY()
    UStaticMeshComponent* CrestMesh;

    UPROPERTY()
    UStaticMeshComponent* VisualModel;

    ECubetownEnemyType EnemyType = ECubetownEnemyType::Gloomling;
    float Health = 70.0f;
    float MaxHealth = 70.0f;
    float Damage = 9.0f;
    float AttackRange = 125.0f;
    float AttackInterval = 0.8f;
    float AttackRemaining = 0.0f;
    float SpecialAttackRemaining = 0.0f;
    int32 AktarusPhase = 1;
};

UCLASS()
class PHANTOMGAMES_API ACubetownEcho : public ACharacter
{
    GENERATED_BODY()

public:
    ACubetownEcho();
    virtual void Tick(float DeltaSeconds) override;
    virtual float TakeDamage(float DamageAmount, FDamageEvent const& DamageEvent, AController* EventInstigator, AActor* DamageCauser) override;
    void Configure(ECubetownEchoType NewType);
    ECubetownEchoType GetEchoType() const { return EchoType; }

private:
    UPROPERTY()
    UStaticMeshComponent* BodyMesh;

    UPROPERTY()
    UStaticMeshComponent* SymbolMesh;

    UPROPERTY()
    UStaticMeshComponent* VisualModel;

    ECubetownEchoType EchoType = ECubetownEchoType::Blade;
    float Health = 75.0f;
    float Damage = 22.0f;
    float AttackRange = 155.0f;
    float AttackRemaining = 0.0f;
};

UCLASS()
class PHANTOMGAMES_API ACubetownVillager : public AActor
{
    GENERATED_BODY()

public:
    ACubetownVillager();
    virtual void Tick(float DeltaSeconds) override;
    void Configure(ECubetownFriend NewFriend, const FVector& NewHome);
    ECubetownFriend GetFriendType() const { return FriendType; }

private:
    UPROPERTY()
    USceneComponent* Root;

    UPROPERTY()
    UStaticMeshComponent* BodyMesh;

    UPROPERTY()
    UStaticMeshComponent* HeadMesh;

    UPROPERTY()
    UStaticMeshComponent* AccentMesh;

    UPROPERTY()
    UStaticMeshComponent* LeftArm;

    UPROPERTY()
    UStaticMeshComponent* RightArm;

    UPROPERTY()
    UStaticMeshComponent* LeftLeg;

    UPROPERTY()
    UStaticMeshComponent* RightLeg;

    UPROPERTY()
    UStaticMeshComponent* EyeLeft;

    UPROPERTY()
    UStaticMeshComponent* EyeRight;

    UPROPERTY()
    UStaticMeshComponent* VisualModel;

    ECubetownFriend FriendType = ECubetownFriend::Sera;
    FVector HomeLocation = FVector::ZeroVector;
    float WanderPhase = 0.0f;
};

UCLASS()
class PHANTOMGAMES_API ACubetownHero : public ACharacter
{
    GENERATED_BODY()

public:
    ACubetownHero();
    virtual void BeginPlay() override;
    virtual void Tick(float DeltaSeconds) override;
    virtual void SetupPlayerInputComponent(UInputComponent* PlayerInputComponent) override;
    virtual float TakeDamage(float DamageAmount, FDamageEvent const& DamageEvent, AController* EventInstigator, AActor* DamageCauser) override;
    float GetHealth() const { return Health; }
    void RestoreHealth(float Amount) { Health = FMath::Clamp(Health + Amount, 0.0f, 120.0f); }
    float GetDashRemaining() const { return DashRemaining; }
    float GetDamageFlash() const { return DamageFlash; }
    float GetStamina() const { return Stamina; }
    bool IsLockedOn() const { return LockedTarget.IsValid(); }
    AActor* GetLockedTarget() const { return LockedTarget.Get(); }
    void SetBuildCameraMode(bool bEnabled);
    void FocusOpeningView(const FVector& WorldTarget);
    void ApplyShadowbearerForm(bool bVestige, bool bFirstEclipse);

private:
    UPROPERTY()
    USpringArmComponent* SpringArm;

    UPROPERTY()
    UCameraComponent* AdventureCamera;

    UPROPERTY()
    UStaticMeshComponent* BodyMesh;

    UPROPERTY()
    UStaticMeshComponent* HeadMesh;

    UPROPERTY()
    UStaticMeshComponent* CapMesh;

    UPROPERTY()
    UStaticMeshComponent* WandMesh;

    UPROPERTY()
    UStaticMeshComponent* CloakMesh;

    UPROPERTY()
    UStaticMeshComponent* ShoulderGem;

    UPROPERTY()
    UStaticMeshComponent* WandCore;

    UPROPERTY()
    UStaticMeshComponent* LeftArm;

    UPROPERTY()
    UStaticMeshComponent* RightArm;

    UPROPERTY()
    UStaticMeshComponent* LeftLeg;

    UPROPERTY()
    UStaticMeshComponent* RightLeg;

    UPROPERTY()
    UStaticMeshComponent* EyeLeft;

    UPROPERTY()
    UStaticMeshComponent* EyeRight;

    UPROPERTY()
    UStaticMeshComponent* VisualModel;

    UPROPERTY()
    UAnimSequence* IdleAnimation = nullptr;

    UPROPERTY()
    UAnimSequence* WalkAnimation = nullptr;

    UPROPERTY()
    UAnimSequence* RunAnimation = nullptr;

    UPROPERTY()
    UAnimSequence* BackwardAnimation = nullptr;

    UPROPERTY()
    UAnimSequence* StrafeLeftAnimation = nullptr;

    UPROPERTY()
    UAnimSequence* StrafeRightAnimation = nullptr;

    UPROPERTY()
    UAnimSequence* JumpStartAnimation = nullptr;

    UPROPERTY()
    UAnimSequence* JumpLoopAnimation = nullptr;

    UPROPERTY()
    UAnimSequence* JumpLandAnimation = nullptr;

    UPROPERTY()
    UAnimSequence* DodgeAnimation = nullptr;

    UPROPERTY()
    UAnimSequence* GuardAnimation = nullptr;

    UPROPERTY()
    UAnimSequence* AttackAnimation = nullptr;

    UPROPERTY()
    UAnimSequence* AttackAnimation2 = nullptr;

    UPROPERTY()
    UAnimSequence* AttackAnimation3 = nullptr;

    UPROPERTY()
    UAnimSequence* HitAnimation = nullptr;

    UPROPERTY()
    UAnimSequence* ActiveAnimation = nullptr;

    UPROPERTY()
    TSubclassOf<UAnimInstance> LocomotionAnimClass;

    float Health = 120.0f;
    float AttackRemaining = 0.0f;
    float DashRemaining = 0.0f;
    float DamageFlash = 0.0f;
    float InvulnerableRemaining = 0.0f;
    float Stamina = 100.0f;
    float ComboResetRemaining = 0.0f;
    float ParryWindowRemaining = 0.0f;
    float LandingAnimationRemaining = 0.0f;
    bool bGuarding = false;
    bool bSprinting = false;
    bool bCrouchedByInput = false;
    bool bWasFalling = false;
    bool bLocomotionProofInitialized = false;
    bool bLocomotionProofJumped = false;
    bool bLocomotionProofReported = false;
    int32 ComboStep = 0;
    uint8 LocomotionProofAnimationMask = 0;
    float LocomotionProofElapsed = 0.0f;
    float LocomotionProofMaxSpeed = 0.0f;
    float LocomotionProofYawTravel = 0.0f;
    float LocomotionProofMinPitch = 90.0f;
    float LocomotionProofMaxPitch = -90.0f;
    FVector LocomotionProofStart = FVector::ZeroVector;
    TWeakObjectPtr<ACubetownEnemy> LockedTarget;

    void MoveForward(float Value);
    void MoveRight(float Value);
    void TurnCamera(float Value);
    void LookCamera(float Value);
    void UpdateLocomotionAnimation(float DeltaSeconds);
    void ZoomCamera(float Value);
    void ZoomIn();
    void ZoomOut();
    void PrimaryAction();
    void ToggleBuildMode();
    void BuildRotateLeft();
    void BuildRotateRight();
    void BuildCycleNext();
    void BuildCyclePrev();
    void BuildUndo();
    void BuildRedo();
    void BuildPrefabTool();
    void BuildWallTool();
    void BuildRoomTool();
    void BuildFenceTool();
    void BuildGardenTool();
    void BuildDecorTool();
    void StartCreationSelect();
    void FinishCreationSelect();
    void ToggleInventoryPanel();
    void ToggleMapPanel();
    void ToggleJournalPanel();
    void SummonEcho();
    void RecordCreation();
    void StartWeave();
    void StopWeave();
    void StartReverseWeave();
    void StopReverseWeave();
    void ClearCreations();
    void CycleBlock();
    void CycleEcho();
    void Interact();
    void Dash();
    void HeavyAttack();
    void ToggleLockOn();
    void StartGuard();
    void StopGuard();
    void StartSprint();
    void StopSprint();
    void ToggleCrouch();
    void RecenterCamera();
    void JumpOrClimb();
    void UseArmament();
    void ToggleVestige();
};

UCLASS()
class PHANTOMGAMES_API ACubetownHUD : public AHUD
{
    GENERATED_BODY()

public:
    virtual void DrawHUD() override;
};

UCLASS()
class PHANTOMGAMES_API ACubetownDirector : public APhantomGameDirectorBase
{
    GENERATED_BODY()

public:
    ACubetownDirector();
    virtual void BeginPlay() override;
    virtual void Tick(float DeltaSeconds) override;
    void PrimaryAtCursor(APlayerController* PlayerController, AActor* DamageCauser, float DamageMultiplier = 1.0f);
    void PlaceAtCursor(APlayerController* PlayerController);
    void ToggleBuildMode(APlayerController* PlayerController);
    void UpdateBuildPreview(APlayerController* PlayerController);
    void SetBuildTool(int32 ToolIndex);
    void CommitBuildTool(APlayerController* PlayerController);
    void PlaceBuildPrefab(APlayerController* PlayerController, bool bKeepTool = true);
    void CancelBuildPlacement();
    void RotateBuildPreview(float Degrees);
    void CycleBuildPrefab(int32 Direction);
    void UndoLastBuild();
    void RedoLastBuild();
    void TogglePanel(int32 PanelIndex);
    void BeginCreationSelection();
    void EndCreationSelection();
    bool IsBuildMode() const { return bBuildMode; }
    bool IsCreationSelecting() const { return bCreationSelecting; }
    int32 GetBuildToolIndex() const { return BuildToolIndex; }
    int32 GetActivePanel() const { return ActivePanel; }
    float GetTimeOfDayHours() const { return TimeOfDayHours; }
    FString GetWeatherName() const;
    FString GetRegionName(const FVector& WorldLocation) const;
    FString GetInteractionPrompt(const FVector& HeroLocation) const;
    FString GetObjectiveMarker(const FVector& HeroLocation) const;
    const FString& GetBuildPrefabName() const { return BuildPrefabName; }
    void CycleBlock();
    void CycleEcho();
    void SummonEcho();
    void RecordCreationAtCursor(APlayerController* PlayerController);
    void BeginWeave(APlayerController* PlayerController, bool bReverse);
    void EndWeave();
    void ClearCreations();
    void ActivateNearbyShrine(const FVector& HeroLocation);
    void InteractNearby(const FVector& HeroLocation);
    void RegisterEnemyDefeat(ECubetownEnemyType Type, const FVector& DefeatLocation = FVector::ZeroVector);
    void AdvanceAktarusPhase(int32 Phase, const FVector& ArenaLocation);
    void NotifyHeroDefeated();
    void PulseNearbyEnemies(const FVector& Origin, float Radius, float Damage, AActor* DamageCauser);
    int32 GetInventory(ECubetownBlockType Type) const;
    int32 GetEchoEnergy() const { return EchoEnergy; }
    int32 GetShrinesRestored() const { return ShrinesRestored; }
    int32 GetEnemiesAlive() const { return EnemiesAlive; }
    int32 GetWorldCycle() const { return WorldCycle; }
    ECubetownBlockType GetSelectedBlock() const { return SelectedBlock; }
    ECubetownEchoType GetSelectedEcho() const { return SelectedEcho; }
    bool IsEchoUnlocked(ECubetownEchoType Type) const;
    int32 GetUnlockedCreationCount() const;
    int32 GetCreationBudgetUsed() const;
    int32 GetCreationBudgetMax() const { return 5 + ShrinesRestored; }
    bool IsWeaving() const { return WeaveTarget.IsValid(); }
    bool IsReverseWeave() const { return bReverseWeave; }
    FString GetWeaveTargetName() const;
    bool IsGuardianDefeated() const { return bGuardianDefeated; }
    const FString& GetQuestStatus() const { return QuestStatus; }
    int32 GetFriendship(int32 Index) const { return Friendship.IsValidIndex(Index) ? Friendship[Index] : 0; }
    int32 GetTotalFriendship() const { int32 Total = 0; for (int32 Value : Friendship) Total += Value; return Total; }
    int32 GetStoryChapter() const { return StoryChapter; }
    int32 GetForgeTier() const { return ForgeTier; }
    const FString& GetPlayerName() const { return PlayerName; }
    EShadowbearerWorldState GetShadowbearerWorldState() const { return ShadowbearerWorldState; }
    FString GetShadowbearerWorldStateLabel() const;
    bool IsShadowfallActive() const;
    bool IsOpeningStoryDefeatActive() const;
    bool IsFirstShadowSolidified() const { return bFirstShadowSolidified; }
    bool IsBramblewickLampRestored() const { return bBramblewickLampRestored; }
    bool IsStoryCinematicActive() const { return ActiveCinematic != EShadowbearerCinematic::None; }
    EShadowbearerCinematic GetStoryCinematic() const { return ActiveCinematic; }
    int32 GetStoryCinematicBeat() const { return CinematicBeat; }
    float GetStoryCinematicProgress() const;
    FString GetStoryCinematicKicker() const;
    FString GetStoryCinematicTitle() const;
    FString GetStoryCinematicLine() const;
    FString GetEquippedArmamentName() const;
    int32 GetCanonicalChapter() const { return CanonicalChapter; }
    int32 GetReturnedSoulCount() const;
    bool HasFirstEclipse() const { return bFirstEclipseUnlocked; }
    void AdvanceStoryCinematic();
    void UseEquippedArmament(const FVector& Origin, AActor* DamageCauser);
    void ToggleVestigeForm();

private:
    TArray<int32> Inventory = { 28, 18, 10, 6, 18, 0 };
    TMap<FIntVector, TWeakObjectPtr<ACubetownBlock>> Blocks;
    TMap<FIntVector, ECubetownBlockType> PlayerPlacedBlocks;
    TSet<FIntVector> RemovedWorldBlocks;
    TArray<TWeakObjectPtr<ACubetownShrine>> Shrines;
    TArray<TWeakObjectPtr<ACubetownVillager>> Villagers;
    TArray<TWeakObjectPtr<ACubetownEcho>> ActiveEchoes;
    TArray<TWeakObjectPtr<AStaticMeshActor>> ActiveCreationProps;
    TArray<TWeakObjectPtr<AStaticMeshActor>> MemorySources;
    TWeakObjectPtr<AActor> WeaveTarget;
    bool bReverseWeave = false;
    FVector WeaveRelativeOffset = FVector::ZeroVector;
    uint32 CreationUnlockMask = 0x7u;
    ECubetownBlockType SelectedBlock = ECubetownBlockType::Grass;
    ECubetownEchoType SelectedEcho = ECubetownEchoType::Blade;
    int32 EchoEnergy = 24;
    float PhantomiteRegenSeconds = 0.0f;
    int32 ShrinesRestored = 0;
    TSet<int32> ActiveShrineIndices;
    int32 EnemiesAlive = 0;
    int32 WorldCycle = 1;
    float EnemyWaveRemaining = 7.0f;
    float SaveRemaining = 5.0f;
    bool bBladeUnlocked = true;
    bool bBoulderUnlocked = false;
    bool bBloomUnlocked = false;
    bool bGuardianSpawned = false;
    bool bGuardianDefeated = false;
    TArray<int32> Friendship = { 0, 0, 0 };
    TArray<float> FriendTalkCooldowns = { 0.0f, 0.0f, 0.0f };
    int32 StoryChapter = 0;
    int32 ForgeTier = 0;
    int32 LoadedBuildSchemaVersion = 0;
    bool bBuildMode = false;
    int32 BuildToolIndex = 0; // 0 prefab, 1 wall, 2 room, 3 fence, 4 garden, 5 decor
    bool bHasBuildStart = false;
    FVector BuildStart = FVector::ZeroVector;
    int32 BuildCatalogIndex = 0;
    float BuildYaw = 0.0f;
    float BuildDistance = 650.0f;
    FString BuildPrefabName = TEXT("FOREST COTTAGE");
    TWeakObjectPtr<AStaticMeshActor> BuildPreview;
    TArray<TWeakObjectPtr<AActor>> PlayerBuildables;

    struct FBuildTransaction
    {
        TArray<TWeakObjectPtr<AActor>> Actors;
    };
    TArray<FBuildTransaction> BuildUndoStack;
    TArray<FBuildTransaction> BuildRedoStack;
    TArray<FString> SavedBuildAssetPaths;
    TArray<FTransform> SavedBuildTransforms;

    int32 ActivePanel = 0; // 0 none, 1 inventory, 2 map, 3 journal
    bool bCreationSelecting = false;
    float CreationHoldSeconds = 0.0f;
    float TimeOfDayHours = 9.25f;
    float WeatherRemaining = 95.0f;
    int32 WeatherIndex = 0; // clear, petal wind, magic drizzle, mist
    TWeakObjectPtr<ADirectionalLight> DreamSun;
    TWeakObjectPtr<ADirectionalLight> DreamShadowFill;
    TWeakObjectPtr<ASkyLight> DreamSky;
    TArray<TWeakObjectPtr<APointLight>> DreamNightLights;
    TArray<TWeakObjectPtr<AActor>> DawnOnlyActors;
    TArray<TWeakObjectPtr<AActor>> ShadowOnlyActors;
    TArray<TWeakObjectPtr<AActor>> RestoredOnlyActors;
    TArray<TWeakObjectPtr<APointLight>> DawnLanternLights;
    TWeakObjectPtr<AStaticMeshActor> FirstShadowBridge;
    TWeakObjectPtr<ACubetownEnemy> PaleWarden;
    FString PlayerName = TEXT("Zane");
    EShadowbearerWorldState ShadowbearerWorldState = EShadowbearerWorldState::Dawn;
    int32 OpeningQuestStep = 0;
    bool bLanternComponentDelivered = false;
    bool bPaleWardenEncountered = false;
    bool bFirstShadowSolidified = false;
    bool bBramblewickLampRestored = false;
    bool bShadowbearerCaptureOverride = false;
    float ShadowfallTransitionSeconds = 0.0f;
    int32 CanonicalChapter = 1;
    bool bPrologueSeen = false;
    uint32 ReturnedSoulMask = 0;
    uint32 ArmamentMask = 0;
    uint32 MemoryMask = 0;
    int32 EquippedArmament = -1;
    bool bNightspineOwned = false;
    bool bVestigeOwned = false;
    bool bVestigeEquipped = false;
    bool bFirstEclipseUnlocked = false;
    bool bEclipsedDawnlantern = false;
    bool bPostgameUnlocked = false;
    EShadowbearerCinematic ActiveCinematic = EShadowbearerCinematic::None;
    ECubetownEnemyType CinematicBoss = ECubetownEnemyType::Gloomling;
    int32 CinematicBeat = 0;
    float CinematicBeatSeconds = 0.0f;
    FVector CinematicLocation = FVector::ZeroVector;
    TWeakObjectPtr<AStaticMeshActor> RitualWeapon;
    TWeakObjectPtr<AStaticMeshActor> RitualSoul;
    TArray<TWeakObjectPtr<AStaticMeshActor>> RitualFragments;
    TWeakObjectPtr<ACubetownEnemy> ActiveStoryBoss;
    FString QuestStatus = TEXT("BRAMBLEWICK MORNING // FIND SERA AT THE VILLAGE LANTERNS");

    void BuildDreamWorld();
    void BuildShadowbearerOpening();
    void ApplyShadowbearerWorldState(bool bForce = false);
    void SetShadowbearerWorldState(EShadowbearerWorldState NewState, const FString& Reason);
    void UpdateOpeningStory(float DeltaSeconds);
    void UpdateCanonicalStory(float DeltaSeconds);
    void UpdateStoryCinematic(float DeltaSeconds);
    void BeginStoryCinematic(EShadowbearerCinematic Cinematic, ECubetownEnemyType Boss, const FVector& Location);
    void CompleteStoryCinematic();
    void SpawnRitualWeapon();
    void SpawnRitualSoul();
    void SpawnNextCanonicalBoss();
    void ApplyPostgameForm();
    void SpawnPaleWarden();
    void SolidifyFirstShadow();
    void RestoreBramblewickLamp();
    void RegisterWorldStateActor(AActor* Actor, EShadowbearerWorldState VisibleState);
    void SpawnProductionWorldPopulation();
    void SpawnDreamTree(const FString& Name, const FVector& Location, float Scale, int32 PaletteVariant, bool bCollision = true);
    void SpawnDreamWorldDetails();
    void SpawnMemorycraftTrials();
    AStaticMeshActor* SpawnCreationProp(ECubetownEchoType Type, const FVector& Location, const FRotator& Rotation, bool bWorldSource);
    void UpdateWeave(float DeltaSeconds);
    void UpdateCreationUtilities(float DeltaSeconds);
    void PruneCreations();
    void MakeCreationRoom(int32 RequiredCost);
    void UpdateDreamEnvironment(float DeltaSeconds);
    void RegisterBuildActor(AStaticMeshActor* Actor, const FString& AssetPath);
    void PushBuildTransaction(const TArray<TWeakObjectPtr<AActor>>& Actors);
    void RestoreSavedBuilds();
    FString BuildAssetForIndex(int32 Index) const;
    FString BuildNameForIndex(int32 Index) const;
    bool SpendBuildMaterials(int32 WoodCost, int32 StoneCost, int32 AmberCost, const FString& Action);
    void SpawnBlockAt(const FIntVector& Grid, ECubetownBlockType Type, bool bMineable);
    void SpawnEnemyWave();
    void SpawnEnemy(ECubetownEnemyType Type, const FVector& Location, int32 Tier);
    void SpawnVillage();
    void TalkToVillager(ACubetownVillager* Villager);
    void RefreshStoryQuest();
    FVector GridLocation(const FIntVector& Grid) const;
    FIntVector GridForLocation(const FVector& Location) const;
    void LoadProgress();
    void SaveProgress();
};
