#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "PhantomGameDirectorBase.generated.h"

class AStaticMeshActor;
class APointLight;
class ADirectionalLight;
class UHierarchicalInstancedStaticMeshComponent;

enum class EPhantomShellScreen : uint8
{
    Title,
    Gameplay,
    Pause,
    Controls,
    Settings
};

enum class EPhantomPrimitive : uint8
{
    Cube,
    Sphere,
    Cylinder,
    Cone,
    Plane
};

UCLASS(Abstract)
class PHANTOMGAMES_API APhantomGameDirectorBase : public AActor
{
    GENERATED_BODY()

public:
    APhantomGameDirectorBase();
    virtual void BeginPlay() override;

    bool IsShellVisible() const { return ShellScreen != EPhantomShellScreen::Gameplay; }
    EPhantomShellScreen GetShellScreen() const { return ShellScreen; }
    float GetMasterVolume() const { return MasterVolume; }
    int32 GetGraphicsQuality() const { return GraphicsQuality; }
    FString GetGraphicsQualityLabel() const;
    virtual bool WantsMouseCursorInGameplay() const { return false; }

protected:
    AStaticMeshActor* SpawnBlock(
        const FString& Name,
        const FVector& Location,
        const FVector& Size,
        const FLinearColor& Color,
        const FRotator& Rotation = FRotator::ZeroRotator,
        bool bCollision = true
    );
    AStaticMeshActor* SpawnShape(
        EPhantomPrimitive Primitive,
        const FString& Name,
        const FVector& Location,
        const FVector& Size,
        const FLinearColor& Color,
        const FRotator& Rotation = FRotator::ZeroRotator,
        bool bCollision = true
    );
    AStaticMeshActor* SpawnStaticMeshAsset(
        const FString& Name,
        const FString& AssetPath,
        const FVector& Location,
        const FVector& Scale,
        const FRotator& Rotation = FRotator::ZeroRotator,
        bool bCollision = true,
        bool bGroundAtLocation = true
    );
    AStaticMeshActor* SpawnTintedStaticMeshAsset(
        const FString& Name,
        const FString& AssetPath,
        const FVector& Location,
        const FVector& Scale,
        const FLinearColor& Tint,
        const FRotator& Rotation = FRotator::ZeroRotator,
        bool bCollision = true,
        bool bGroundAtLocation = true
    );
    bool ApplyMaterialAsset(
        AStaticMeshActor* Actor,
        const FString& MaterialPath,
        int32 MaterialSlot = INDEX_NONE
    );
    APointLight* SpawnPointLight(
        const FString& Name,
        const FVector& Location,
        const FLinearColor& Color,
        float Intensity,
        float Radius,
        bool bCastShadows = false
    );
    ADirectionalLight* SpawnSun(float Intensity, const FRotator& Rotation, const FLinearColor& Color);
    void SetWorldMood(const FLinearColor& FogColor, float FogDensity, const FLinearColor& AmbientColor);
    UHierarchicalInstancedStaticMeshComponent* SpawnInstancedMeshCluster(
        const FString& Name,
        const FString& AssetPath,
        const TArray<FTransform>& WorldTransforms,
        bool bCollision = false
    );

private:
    EPhantomShellScreen ShellScreen = EPhantomShellScreen::Title;
    bool bGameStarted = false;
    float MasterVolume = 0.85f;
    int32 GraphicsQuality = 3;

    void ApplyShellState();
    void HandlePrimaryAction();
    void HandleEscape();
    void HandleControls();
    void HandleSettings();
    void HandleVolumeDown();
    void HandleVolumeUp();
    void HandleQualityDown();
    void HandleQualityUp();
    void HandleExitGame();
    void HandleShellClick();
};
