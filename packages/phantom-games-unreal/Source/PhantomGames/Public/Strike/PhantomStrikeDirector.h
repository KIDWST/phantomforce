#pragma once

#include "CoreMinimal.h"
#include "Core/PhantomGameDirectorBase.h"
#include "GameFramework/Character.h"
#include "GameFramework/HUD.h"
#include "PhantomStrikeDirector.generated.h"

class UCameraComponent;
class UPointLightComponent;
class UPrimitiveComponent;
class UStaticMeshComponent;

UENUM(BlueprintType)
enum class EPhantomStrikeEnemyRole : uint8
{
    Rifleman,
    Rusher,
    Heavy,
    Marksman
};

UENUM(BlueprintType)
enum class EPhantomStrikeMissionPhase : uint8
{
    Insertion,
    StreetAdvance,
    Breach,
    Uplink,
    Extraction,
    Complete
};

UCLASS()
class PHANTOMGAMES_API APhantomStrikeCharacter : public ACharacter
{
    GENERATED_BODY()

public:
    APhantomStrikeCharacter();
    virtual void BeginPlay() override;
    virtual void Tick(float DeltaSeconds) override;
    virtual void SetupPlayerInputComponent(UInputComponent* PlayerInputComponent) override;
    virtual float TakeDamage(float DamageAmount, FDamageEvent const& DamageEvent, AController* EventInstigator, AActor* DamageCauser) override;

    void RegisterKill(int32 Points, bool bHeadshot);

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Combat")
    float Health = 100.0f;

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Combat")
    float Armor = 50.0f;

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Combat")
    int32 Ammo = 32;

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Combat")
    int32 ReserveAmmo = 192;

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Combat")
    int32 Kills = 0;

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Combat")
    int32 Score = 0;

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Combat")
    int32 Deaths = 0;

    bool IsAiming() const { return bAiming; }
    bool IsReloading() const { return bReloading; }
    float GetReloadProgress() const;
    float GetHitMarkerRemaining() const { return HitMarkerRemaining; }
    float GetDamageFlash() const { return DamageFlash; }
    bool WasLastHitHeadshot() const { return bLastHitHeadshot; }
    float GetWeaponHeat() const { return WeaponHeat; }
    bool IsSprinting() const { return bSprinting; }
    bool IsSliding() const { return SlideRemaining > 0.0f; }
    bool IsProne() const { return bProne; }
    bool IsCrouchedByInput() const { return bCrouchedByInput; }
    bool IsSemiAuto() const { return bSemiAuto; }
    bool IsScoreboardVisible() const { return bScoreboardVisible; }
    bool IsMapVisible() const { return bMapVisible; }
    int32 GetTacticals() const { return Tacticals; }
    int32 GetStreak() const { return CurrentStreak; }
    int32 GetBestStreak() const { return BestStreak; }
    int32 GetGrenades() const { return Grenades; }
    bool IsUsingSidearm() const { return bUsingSidearm; }
    const TCHAR* GetWeaponName() const { return bUsingSidearm ? TEXT("P9 SIDEARM") : TEXT("AR-6 BLACKRIDGE"); }

private:
    UPROPERTY()
    UCameraComponent* FirstPersonCamera;

    UPROPERTY()
    UStaticMeshComponent* RifleBody;

    UPROPERTY()
    UStaticMeshComponent* RifleBarrel;

    UPROPERTY()
    UStaticMeshComponent* RifleSight;

    UPROPERTY()
    UStaticMeshComponent* SidearmBody;

    UPROPERTY()
    UStaticMeshComponent* RightForearm;

    UPROPERTY()
    UStaticMeshComponent* LeftForearm;

    UPROPERTY()
    UStaticMeshComponent* RightGlove;

    UPROPERTY()
    UStaticMeshComponent* LeftGlove;

    UPROPERTY()
    UStaticMeshComponent* MuzzleBloom;

    UPROPERTY()
    UPointLightComponent* MuzzleLight;

    bool bTriggerHeld = false;
    bool bAiming = false;
    bool bSprinting = false;
    bool bReloading = false;
    bool bUsingImportedRifle = false;
    bool bUsingRealisticBodyRig = false;
    bool bUsingTemplateWeapons = false;
    bool bUsingTemplateSidearm = false;
    bool bUsingSidearm = false;
    bool bLastHitHeadshot = false;
    bool bProne = false;
    bool bCrouchedByInput = false;
    bool bSemiAuto = false;
    bool bScoreboardVisible = false;
    bool bMapVisible = false;
    bool bInitialViewApplied = false;
    float FireCooldown = 0.0f;
    float ReloadRemaining = 0.0f;
    float WeaponHeat = 0.0f;
    float MuzzleFlashRemaining = 0.0f;
    float HitMarkerRemaining = 0.0f;
    float DamageFlash = 0.0f;
    float TimeSinceDamage = 0.0f;
    float WeaponBobTime = 0.0f;
    float RecoilKick = 0.0f;
    float SlideRemaining = 0.0f;
    float MeleeRemaining = 0.0f;
    float GrenadeRemaining = 0.0f;
    float TacticalRemaining = 0.0f;
    float InspectRemaining = 0.0f;
    float ShotImpulse = 0.0f;
    FVector2D WeaponInertia = FVector2D::ZeroVector;
    FRotator LastViewRotation = FRotator::ZeroRotator;
    bool bHasViewSample = false;
    int32 Grenades = 2;
    int32 Tacticals = 2;
    int32 CurrentStreak = 0;
    int32 BestStreak = 0;
    int32 PrimaryAmmo = 32;
    int32 PrimaryReserve = 192;
    int32 SidearmAmmo = 15;
    int32 SidearmReserve = 75;

    void MoveForward(float Value);
    void MoveRight(float Value);
    void StartSprint();
    void StopSprint();
    void StartFire();
    void StopFire();
    void StartAim();
    void StopAim();
    void FireOneRound();
    void BeginReload();
    void FinishReload();
    void MeleeStrike();
    void ThrowFrag();
    void Slide();
    void CrouchOrSlide();
    void ToggleProne();
    void JumpOrMantle();
    void Interact();
    void UseTactical();
    void ToggleFireMode();
    void InspectWeapon();
    void ShowScoreboard();
    void HideScoreboard();
    void ToggleMap();
    void RefreshMovementSpeed();
    void EquipPrimary();
    void EquipSidearm();
    void SwapWeapon();
    int32 CurrentMagazineSize() const { return bUsingSidearm ? 15 : 32; }
};

UCLASS()
class PHANTOMGAMES_API APhantomStrikeEnemy : public ACharacter
{
    GENERATED_BODY()

public:
    APhantomStrikeEnemy();
    virtual void Tick(float DeltaSeconds) override;
    virtual float TakeDamage(float DamageAmount, FDamageEvent const& DamageEvent, AController* EventInstigator, AActor* DamageCauser) override;
    void Configure(EPhantomStrikeEnemyRole NewRole, int32 NewTier);
    bool IsHeadComponent(const UPrimitiveComponent* Component) const;

private:
    UPROPERTY()
    UStaticMeshComponent* BodyMesh;

    UPROPERTY()
    UStaticMeshComponent* HeadMesh;

    UPROPERTY()
    UStaticMeshComponent* ArmorMesh;

    UPROPERTY()
    UStaticMeshComponent* WeaponMesh;

    // Authored character silhouette from the curated CC0/gltf pipeline.
    // Primitive meshes remain collision/headshot fallbacks only.
    UPROPERTY()
    UStaticMeshComponent* VisualModel;

    UPROPERTY()
    UPointLightComponent* MuzzleLight;

    EPhantomStrikeEnemyRole Role = EPhantomStrikeEnemyRole::Rifleman;
    int32 Tier = 1;
    float Health = 100.0f;
    float AttackCooldown = 0.0f;
    float AttackInterval = 0.8f;
    float PreferredRange = 900.0f;
    float Damage = 9.0f;
    float StrafeDirection = 1.0f;
    float MuzzleFlashRemaining = 0.0f;
    float DecisionRemaining = 0.0f;
    float ExposureRemaining = 0.0f;
    float FlankWeight = 0.0f;
    float PresentationTime = 0.0f;
    float RecoilRemaining = 0.0f;
    float HitReactionRemaining = 0.0f;
    float DeathRemaining = 0.0f;
    FVector VisualRestLocation = FVector::ZeroVector;
    bool bDying = false;
    bool bUsingRealisticRig = false;

    bool HasLineOfSightTo(AActor* Target) const;
};

UCLASS()
class PHANTOMGAMES_API APhantomStrikeSquadmate : public ACharacter
{
    GENERATED_BODY()

public:
    APhantomStrikeSquadmate();
    virtual void BeginPlay() override;
    virtual void Tick(float DeltaSeconds) override;
    void ConfigureSquadmate(int32 NewSquadIndex);
    bool IsOperational() const { return bOperational; }

private:
    UPROPERTY()
    UStaticMeshComponent* VisualModel;

    UPROPERTY()
    UStaticMeshComponent* WeaponModel;

    UPROPERTY()
    UPointLightComponent* StatusLight;

    int32 SquadIndex = 0;
    float FireRemaining = 0.0f;
    float RepathRemaining = 0.0f;
    float PresentationTime = 0.0f;
    float RecoilRemaining = 0.0f;
    FVector VisualRestLocation = FVector::ZeroVector;
    bool bOperational = true;
    bool bUsingRealisticRig = false;
};

UCLASS()
class PHANTOMGAMES_API APhantomStrikeHUD : public AHUD
{
    GENERATED_BODY()

public:
    virtual void DrawHUD() override;
};

UCLASS()
class PHANTOMGAMES_API APhantomStrikeDirector : public APhantomGameDirectorBase
{
    GENERATED_BODY()

public:
    APhantomStrikeDirector();
    virtual void BeginPlay() override;
    virtual void Tick(float DeltaSeconds) override;
    void RegisterEnemyDown();
    int32 GetWave() const { return Wave; }
    int32 GetTotalWaves() const { return TotalWaves; }
    int32 GetRemainingEnemies() const { return RemainingEnemies; }
    bool IsMissionComplete() const { return bMissionComplete; }
    bool IsExtractionOpen() const { return bExtractionOpen; }
    bool IsAwaitingUplink() const { return bAwaitingUplink; }
    float GetIntermissionRemaining() const { return IntermissionRemaining; }
    FVector GetExtractionLocation() const { return ExtractionLocation; }
    FVector GetUplinkLocation() const { return UplinkLocation; }
    EPhantomStrikeMissionPhase GetMissionPhase() const;
    FString GetMissionPhaseLabel() const;
    FString GetObjectiveText() const;
    float GetMissionProgress() const;
    float GetMissionElapsed() const { return MissionElapsed; }
    int32 GetOperationalSquadmates() const;
    void TryActivateUplink(APhantomStrikeCharacter* Player);

private:
    int32 Wave = 0;
    int32 TotalWaves = 6;
    int32 RemainingEnemies = 0;
    float IntermissionRemaining = 0.0f;
    bool bMissionComplete = false;
    bool bExtractionOpen = false;
    bool bAwaitingUplink = false;
    float MissionElapsed = 0.0f;
    FVector UplinkLocation = FVector(9000.0f, 0.0f, 105.0f);
    FVector ExtractionLocation = FVector(14600.0f, -9200.0f, 105.0f);

    void BuildCommandComplex();
    void BuildV27BlackridgeRealism();
    void SpawnWave();
    void SpawnSquad();
    void OpenExtraction();
};
