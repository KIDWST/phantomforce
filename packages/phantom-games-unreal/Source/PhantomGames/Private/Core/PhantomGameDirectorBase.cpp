#include "Core/PhantomGameDirectorBase.h"

#include "Components/DirectionalLightComponent.h"
#include "Components/InputComponent.h"
#include "Components/ExponentialHeightFogComponent.h"
#include "Components/SkyLightComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Components/HierarchicalInstancedStaticMeshComponent.h"
#include "Engine/DirectionalLight.h"
#include "Engine/ExponentialHeightFog.h"
#include "Engine/PointLight.h"
#include "Engine/PostProcessVolume.h"
#include "Engine/SkyLight.h"
#include "EngineUtils.h"
#include "Components/SkyAtmosphereComponent.h"
#include "Engine/StaticMeshActor.h"
#include "Components/PointLightComponent.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialInterface.h"
#include "GameFramework/PlayerController.h"
#include "InputCoreTypes.h"
#include "Kismet/KismetSystemLibrary.h"
#include "Kismet/GameplayStatics.h"
#include "Engine/EngineBaseTypes.h"
#include "GameFramework/GameUserSettings.h"
#include "Misc/App.h"
#include "Misc/CommandLine.h"
#include "Misc/ConfigCacheIni.h"
#include "Misc/Parse.h"
#include "TimerManager.h"

APhantomGameDirectorBase::APhantomGameDirectorBase()
{
    PrimaryActorTick.bCanEverTick = false;
}

void APhantomGameDirectorBase::BeginPlay()
{
    Super::BeginPlay();
    if (APlayerController* PlayerController = GetWorld() ? GetWorld()->GetFirstPlayerController() : nullptr)
    {
        EnableInput(PlayerController);
        if (InputComponent)
        {
            auto& Enter = InputComponent->BindKey(EKeys::Enter, IE_Pressed, this, &APhantomGameDirectorBase::HandlePrimaryAction); Enter.bExecuteWhenPaused = true;
            auto& Escape = InputComponent->BindKey(EKeys::Escape, IE_Pressed, this, &APhantomGameDirectorBase::HandleEscape); Escape.bExecuteWhenPaused = true;
            auto& F1 = InputComponent->BindKey(EKeys::F1, IE_Pressed, this, &APhantomGameDirectorBase::HandleControls); F1.bExecuteWhenPaused = true;
            auto& F2 = InputComponent->BindKey(EKeys::F2, IE_Pressed, this, &APhantomGameDirectorBase::HandleSettings); F2.bExecuteWhenPaused = true;
            auto& Left = InputComponent->BindKey(EKeys::Left, IE_Pressed, this, &APhantomGameDirectorBase::HandleVolumeDown); Left.bExecuteWhenPaused = true; Left.bConsumeInput = false;
            auto& Right = InputComponent->BindKey(EKeys::Right, IE_Pressed, this, &APhantomGameDirectorBase::HandleVolumeUp); Right.bExecuteWhenPaused = true; Right.bConsumeInput = false;
            auto& Down = InputComponent->BindKey(EKeys::Down, IE_Pressed, this, &APhantomGameDirectorBase::HandleQualityDown); Down.bExecuteWhenPaused = true; Down.bConsumeInput = false;
            auto& Up = InputComponent->BindKey(EKeys::Up, IE_Pressed, this, &APhantomGameDirectorBase::HandleQualityUp); Up.bExecuteWhenPaused = true; Up.bConsumeInput = false;
            auto& Quit = InputComponent->BindKey(EKeys::Q, IE_Pressed, this, &APhantomGameDirectorBase::HandleExitGame); Quit.bExecuteWhenPaused = true; Quit.bConsumeInput = false;
            auto& MouseClick = InputComponent->BindKey(EKeys::LeftMouseButton, IE_Pressed, this, &APhantomGameDirectorBase::HandleShellClick); MouseClick.bExecuteWhenPaused = true; MouseClick.bConsumeInput = false;
        }
    }
    // Respect the user's persisted Unreal scalability choice across every PhantomPlay title.
    // Custom (-1) profiles retain the project default until the user selects a named preset.
    if (GEngine && GEngine->GetGameUserSettings())
    {
        const int32 PersistedQuality = GEngine->GetGameUserSettings()->GetOverallScalabilityLevel();
        if (PersistedQuality >= 0)
        {
            GraphicsQuality = FMath::Clamp(PersistedQuality, 0, 4);
        }
    }
    // Master volume is a PhantomPlay-wide preference, not a per-match variable.
    // Persist it beside Unreal's user settings so all four executables inherit the same value.
    if (GConfig)
    {
        float PersistedVolume = MasterVolume;
        if (GConfig->GetFloat(TEXT("PhantomPlay.Audio"), TEXT("MasterVolume"), PersistedVolume, GGameUserSettingsIni))
        {
            MasterVolume = FMath::Clamp(PersistedVolume, 0.0f, 1.0f);
        }
    }
    FApp::SetVolumeMultiplier(MasterVolume);

    ApplyShellState();

    // V10 candidate QA: one packaged gameplay capture per game. This deliberately bypasses
    // title-screen screenshot matrices and waits for the actual game world to settle.
    if (FParse::Param(FCommandLine::Get(), TEXT("PhantomAutoStart")))
    {
        bGameStarted = true;
        ShellScreen = EPhantomShellScreen::Gameplay;
        ApplyShellState();
    }
    if (FParse::Param(FCommandLine::Get(), TEXT("PhantomGameplayCapture")) && GetWorld())
    {
        int32 CaptureDelay = 7;
        FParse::Value(FCommandLine::Get(), TEXT("PhantomCaptureDelay="), CaptureDelay);
        CaptureDelay = FMath::Clamp(CaptureDelay, 3, 20);
        FTimerHandle CaptureTimer;
        GetWorld()->GetTimerManager().SetTimer(CaptureTimer, FTimerDelegate::CreateWeakLambda(this, [this]()
        {
            if (APlayerController* PC = GetWorld() ? GetWorld()->GetFirstPlayerController() : nullptr)
            {
                PC->ConsoleCommand(TEXT("shot"), true);
            }
            if (FParse::Param(FCommandLine::Get(), TEXT("PhantomAutoQuit")) && GetWorld())
            {
                FTimerHandle QuitTimer;
                GetWorld()->GetTimerManager().SetTimer(QuitTimer, FTimerDelegate::CreateWeakLambda(this, [this]()
                {
                    if (APlayerController* PC = GetWorld() ? GetWorld()->GetFirstPlayerController() : nullptr)
                    {
                        UKismetSystemLibrary::QuitGame(this, PC, EQuitPreference::Quit, false);
                    }
                }), 1.5f, false);
            }
        }), static_cast<float>(CaptureDelay), false);
    }
}

FString APhantomGameDirectorBase::GetGraphicsQualityLabel() const
{
    static const TCHAR* Labels[] = { TEXT("LOW"), TEXT("MEDIUM"), TEXT("HIGH"), TEXT("EPIC"), TEXT("CINEMATIC") };
    return Labels[FMath::Clamp(GraphicsQuality, 0, 4)];
}

float APhantomGameDirectorBase::GetShellUIScale(float Width, float Height) const
{
    // One scale contract drives both rendering and hit-testing. Previously the shared shell,
    // CubeTown shell, and click handler each used different caps, so 1440p/4K buttons could be
    // drawn in one place while the actual clickable rectangle remained somewhere else.
    if (Width <= 1.0f || Height <= 1.0f) return 1.0f;
    return FMath::Clamp(FMath::Min(Width / 1920.0f, Height / 1080.0f), 0.78f, 1.75f);
}

void APhantomGameDirectorBase::ApplyShellState()
{
    if (APlayerController* PlayerController = GetWorld() ? GetWorld()->GetFirstPlayerController() : nullptr)
    {
        const bool bOverlay = ShellScreen != EPhantomShellScreen::Gameplay;
        PlayerController->SetPause(bOverlay);
        PlayerController->bShowMouseCursor = bOverlay || WantsMouseCursorInGameplay();
        if (!bOverlay)
        {
            if (WantsMouseCursorInGameplay())
            {
                // RTS-style games need a truly free cursor. The project-wide input config captures
                // mouse input permanently for FPS play, so override that behavior here.
                FInputModeGameAndUI Mode;
                Mode.SetHideCursorDuringCapture(false);
                Mode.SetLockMouseToViewportBehavior(EMouseLockMode::DoNotLock);
                PlayerController->SetInputMode(Mode);
                // A visible RTS cursor must not be captured on mouse-down. The project-wide
                // FPS setting CapturePermanently_IncludingInitialMouseDown was pinning the
                // cursor during drag-select in packaged Legends builds.
                UGameplayStatics::SetViewportMouseCaptureMode(this, EMouseCaptureMode::NoCapture);
                PlayerController->bEnableClickEvents = true;
                PlayerController->bEnableMouseOverEvents = true;
            }
            else
            {
                PlayerController->SetInputMode(FInputModeGameOnly());
                // Restore relative mouse capture for first/third-person games.
                UGameplayStatics::SetViewportMouseCaptureMode(this, EMouseCaptureMode::CapturePermanently_IncludingInitialMouseDown);
            }
        }
    }
}

void APhantomGameDirectorBase::HandlePrimaryAction()
{
    if (ShellScreen == EPhantomShellScreen::Controls || ShellScreen == EPhantomShellScreen::Settings)
    {
        ShellScreen = bGameStarted ? EPhantomShellScreen::Pause : EPhantomShellScreen::Title;
    }
    else
    {
        bGameStarted = true;
        ShellScreen = EPhantomShellScreen::Gameplay;
    }
    ApplyShellState();
}

void APhantomGameDirectorBase::HandleEscape()
{
    if (ShellScreen == EPhantomShellScreen::Gameplay) ShellScreen = EPhantomShellScreen::Pause;
    else if (ShellScreen == EPhantomShellScreen::Pause) ShellScreen = EPhantomShellScreen::Gameplay;
    else if (ShellScreen == EPhantomShellScreen::Controls || ShellScreen == EPhantomShellScreen::Settings) ShellScreen = bGameStarted ? EPhantomShellScreen::Pause : EPhantomShellScreen::Title;
    else HandleExitGame();
    ApplyShellState();
}

void APhantomGameDirectorBase::HandleControls()
{
    if (ShellScreen == EPhantomShellScreen::Controls) return;
    if (ShellScreen == EPhantomShellScreen::Gameplay) bGameStarted = true;
    ShellScreen = EPhantomShellScreen::Controls;
    ApplyShellState();
}

void APhantomGameDirectorBase::HandleSettings()
{
    if (ShellScreen == EPhantomShellScreen::Settings) return;
    if (ShellScreen == EPhantomShellScreen::Gameplay) bGameStarted = true;
    ShellScreen = EPhantomShellScreen::Settings;
    ApplyShellState();
}

void APhantomGameDirectorBase::HandleVolumeDown()
{
    if (ShellScreen != EPhantomShellScreen::Settings) return;
    MasterVolume = FMath::Clamp(MasterVolume - 0.1f, 0.0f, 1.0f);
    FApp::SetVolumeMultiplier(MasterVolume);
    if (GConfig)
    {
        GConfig->SetFloat(TEXT("PhantomPlay.Audio"), TEXT("MasterVolume"), MasterVolume, GGameUserSettingsIni);
        GConfig->Flush(false, GGameUserSettingsIni);
    }
}

void APhantomGameDirectorBase::HandleVolumeUp()
{
    if (ShellScreen != EPhantomShellScreen::Settings) return;
    MasterVolume = FMath::Clamp(MasterVolume + 0.1f, 0.0f, 1.0f);
    FApp::SetVolumeMultiplier(MasterVolume);
    if (GConfig)
    {
        GConfig->SetFloat(TEXT("PhantomPlay.Audio"), TEXT("MasterVolume"), MasterVolume, GGameUserSettingsIni);
        GConfig->Flush(false, GGameUserSettingsIni);
    }
}

void APhantomGameDirectorBase::HandleQualityDown()
{
    if (ShellScreen != EPhantomShellScreen::Settings) return;
    GraphicsQuality = FMath::Clamp(GraphicsQuality - 1, 0, 4);
    if (GEngine && GEngine->GetGameUserSettings()) { GEngine->GetGameUserSettings()->SetOverallScalabilityLevel(GraphicsQuality); GEngine->GetGameUserSettings()->ApplySettings(false); GEngine->GetGameUserSettings()->SaveSettings(); }
}

void APhantomGameDirectorBase::HandleQualityUp()
{
    if (ShellScreen != EPhantomShellScreen::Settings) return;
    GraphicsQuality = FMath::Clamp(GraphicsQuality + 1, 0, 4);
    if (GEngine && GEngine->GetGameUserSettings()) { GEngine->GetGameUserSettings()->SetOverallScalabilityLevel(GraphicsQuality); GEngine->GetGameUserSettings()->ApplySettings(false); GEngine->GetGameUserSettings()->SaveSettings(); }
}

void APhantomGameDirectorBase::HandleShellClick()
{
    if (!IsShellVisible()) return;
    APlayerController* PC=GetWorld()?GetWorld()->GetFirstPlayerController():nullptr; if(!PC) return;
    float MX=0.0f,MY=0.0f; if(!PC->GetMousePosition(MX,MY)) return;
    int32 VW=0,VH=0; PC->GetViewportSize(VW,VH); if(VW<=0||VH<=0)return;
    const float W=static_cast<float>(VW),H=static_cast<float>(VH);
    const float Scale=GetShellUIScale(W,H);
    const auto S=[Scale](float V){return V*Scale;};
    const float Margin=S(54.0f), PanelW=FMath::Min(W-Margin*2.0f,S(1060.0f)), PanelH=FMath::Min(H-Margin*2.0f,S(650.0f));
    const float PanelX=Margin,PanelY=(H-PanelH)*0.5f,CardX=PanelX+S(44.0f),CardY=PanelY+S(154.0f),CardW=PanelW-S(88.0f),CardH=PanelH-S(202.0f);
    const float BX=CardX+S(34.0f),BW=FMath::Min(CardW-S(68.0f),S(560.0f)),BH=S(52.0f);
    auto Hit=[&](float Y){return MX>=BX&&MX<=BX+BW&&MY>=Y&&MY<=Y+BH;};
    if(ShellScreen==EPhantomShellScreen::Title)
    {
        if(Hit(CardY+S(70.0f))) HandlePrimaryAction();
        else if(Hit(CardY+S(136.0f))) HandleControls();
        else if(Hit(CardY+S(202.0f))) HandleSettings();
        else if(Hit(CardY+S(286.0f))) HandleExitGame();
    }
    else if(ShellScreen==EPhantomShellScreen::Pause)
    {
        if(Hit(CardY+S(88.0f))) HandleEscape();
        else if(Hit(CardY+S(154.0f))) HandleControls();
        else if(Hit(CardY+S(220.0f))) HandleSettings();
        else if(Hit(CardY+S(304.0f))) HandleExitGame();
    }
    else if(ShellScreen==EPhantomShellScreen::Controls||ShellScreen==EPhantomShellScreen::Settings)
    {
        if(Hit(CardY+CardH-S(76.0f))) HandlePrimaryAction();
    }
}

void APhantomGameDirectorBase::HandleExitGame()
{
    if (!IsShellVisible()) return;
    APlayerController* PlayerController = GetWorld() ? GetWorld()->GetFirstPlayerController() : nullptr;
    UKismetSystemLibrary::QuitGame(this, PlayerController, EQuitPreference::Quit, false);
}

AStaticMeshActor* APhantomGameDirectorBase::SpawnBlock(
    const FString& Name,
    const FVector& Location,
    const FVector& Size,
    const FLinearColor& Color,
    const FRotator& Rotation,
    bool bCollision
)
{
    return SpawnShape(EPhantomPrimitive::Cube, Name, Location, Size, Color, Rotation, bCollision);
}

AStaticMeshActor* APhantomGameDirectorBase::SpawnShape(
    EPhantomPrimitive Primitive,
    const FString& Name,
    const FVector& Location,
    const FVector& Size,
    const FLinearColor& Color,
    const FRotator& Rotation,
    bool bCollision
)
{
    UWorld* World = GetWorld();
    if (!World) return nullptr;
    const TCHAR* MeshPath = TEXT("/Engine/BasicShapes/Cube.Cube");
    switch (Primitive)
    {
        case EPhantomPrimitive::Sphere: MeshPath = TEXT("/Engine/BasicShapes/Sphere.Sphere"); break;
        case EPhantomPrimitive::Cylinder: MeshPath = TEXT("/Engine/BasicShapes/Cylinder.Cylinder"); break;
        case EPhantomPrimitive::Cone: MeshPath = TEXT("/Engine/BasicShapes/Cone.Cone"); break;
        case EPhantomPrimitive::Plane: MeshPath = TEXT("/Engine/BasicShapes/Plane.Plane"); break;
        default: break;
    }
    UStaticMesh* Mesh = LoadObject<UStaticMesh>(nullptr, MeshPath);
    UMaterialInterface* BaseMaterial = LoadObject<UMaterialInterface>(
        nullptr,
        TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial")
    );
    AStaticMeshActor* Shape = World->SpawnActor<AStaticMeshActor>(Location, Rotation);
    if (!Shape || !Mesh) return Shape;
    Shape->Tags.Add(FName(*Name));
    Shape->GetStaticMeshComponent()->SetStaticMesh(Mesh);
    Shape->SetActorScale3D(Size / 100.0f);
    Shape->SetActorEnableCollision(bCollision);
    Shape->GetStaticMeshComponent()->SetCollisionEnabled(
        bCollision ? ECollisionEnabled::QueryAndPhysics : ECollisionEnabled::NoCollision
    );
    if (BaseMaterial)
    {
        UMaterialInstanceDynamic* Material = UMaterialInstanceDynamic::Create(BaseMaterial, Shape);
        Material->SetVectorParameterValue(TEXT("Color"), Color);
        Shape->GetStaticMeshComponent()->SetMaterial(0, Material);
    }
    return Shape;
}


// V8 MAX-FIDELITY UNIT GATE: normalize meter/cm/arbitrary-kit assets aggressively before world placement.
static FVector PhantomNormalizeSemanticMeshScale(
    UStaticMesh* Mesh,
    const FString& Semantic,
    const FVector& RequestedScale
)
{
    if (!Mesh) return RequestedScale;

    const FString S = Semantic.ToLower();
    const FBoxSphereBounds Bounds = Mesh->GetBounds();
    const FVector RawSize = Bounds.BoxExtent * 2.0f;

    float TargetCm = 0.0f;
    bool bUseHeight = true;

    // Guaranteed V8 world chunks are authored in glTF meters. Normalize them by intended world span
    // as a second safety net in case an Interchange version/import preset reports source units differently.
    if (S.Contains(TEXT("cubeterrain"))) { TargetCm = 32000.0f; bUseHeight = false; }
    else if (S.Contains(TEXT("legendsterrain"))) { TargetCm = 102400.0f; bUseHeight = false; }
    else if (S.Contains(TEXT("strikeground"))) { TargetCm = 12000.0f; bUseHeight = false; }
    else if (S.Contains(TEXT("agesbattlefield"))) { TargetCm = 36000.0f; bUseHeight = false; }
    else if (S.Contains(TEXT("heartstoneplaza"))) { TargetCm = 7600.0f; bUseHeight = false; }
    else if (S.Contains(TEXT("heartstonepath"))) { TargetCm = 8500.0f; bUseHeight = false; }
    else if (S.Contains(TEXT("dreamportal"))) { TargetCm = 900.0f; bUseHeight = true; }
    else if (S.Contains(TEXT("barricade"))) { TargetCm = 500.0f; bUseHeight = false; }
    else if (S.Contains(TEXT("dragon")) || S.Contains(TEXT("titan")) || S.Contains(TEXT("golem"))) { TargetCm = 2600.0f; bUseHeight = false; }
    else if (S.Contains(TEXT("brute")) || S.Contains(TEXT("heavy"))) { TargetCm = 280.0f; bUseHeight = true; }
    else if (S.Contains(TEXT("character")) || S.Contains(TEXT("hero")) || S.Contains(TEXT("worker")) ||
             S.Contains(TEXT("guard")) || S.Contains(TEXT("ranger")) || S.Contains(TEXT("raider")) ||
             S.Contains(TEXT("rifleman")) || S.Contains(TEXT("marksman")) || S.Contains(TEXT("rusher")) ||
             S.Contains(TEXT("player")) || S.Contains(TEXT("enemy"))) { TargetCm = 190.0f; bUseHeight = true; }
    else if (S.Contains(TEXT("stronghold")) || S.Contains(TEXT("castle")) || S.Contains(TEXT("keep")) || S.Contains(TEXT("fortress"))) { TargetCm = 3600.0f; bUseHeight = true; }
    else if (S.Contains(TEXT("watchtower")) || S.Contains(TEXT("tower"))) { TargetCm = 2100.0f; bUseHeight = true; }
    else if (S.Contains(TEXT("warehouse")) || S.Contains(TEXT("commercial")) || S.Contains(TEXT("building"))) { TargetCm = 1250.0f; bUseHeight = true; }
    else if (S.Contains(TEXT("blacksmith")) || S.Contains(TEXT("tavern")) || S.Contains(TEXT("inn")) || S.Contains(TEXT("workshop")) ||
             S.Contains(TEXT("stable")) || S.Contains(TEXT("greenhouse")) || S.Contains(TEXT("barracks")) ||
             S.Contains(TEXT("cottage")) || S.Contains(TEXT("house")) || S.Contains(TEXT("shop"))) { TargetCm = 900.0f; bUseHeight = true; }
    else if (S.Contains(TEXT("wall"))) { TargetCm = 620.0f; bUseHeight = true; }
    else if (S.Contains(TEXT("gate")) || S.Contains(TEXT("arch")) || S.Contains(TEXT("shrine")) || S.Contains(TEXT("portal"))) { TargetCm = 1300.0f; bUseHeight = true; }
    else if (S.Contains(TEXT("windmill"))) { TargetCm = 1500.0f; bUseHeight = true; }
    else if (S.Contains(TEXT("tree"))) { TargetCm = 1650.0f; bUseHeight = true; }
    else if (S.Contains(TEXT("bridge"))) { TargetCm = 2600.0f; bUseHeight = false; }
    else if (S.Contains(TEXT("fountain")) || S.Contains(TEXT("well"))) { TargetCm = 300.0f; bUseHeight = false; }
    else if (S.Contains(TEXT("lantern")) || S.Contains(TEXT("sign"))) { TargetCm = 240.0f; bUseHeight = true; }
    else if (S.Contains(TEXT("fence"))) { TargetCm = 180.0f; bUseHeight = true; }
    else if (S.Contains(TEXT("siege")) || S.Contains(TEXT("trebuchet")) || S.Contains(TEXT("ballista"))) { TargetCm = 650.0f; bUseHeight = false; }
    else if (S.Contains(TEXT("farm")) || S.Contains(TEXT("mine")) || S.Contains(TEXT("crystalnode"))) { TargetCm = 1200.0f; bUseHeight = false; }
    else if (S.Contains(TEXT("cart"))) { TargetCm = 320.0f; bUseHeight = false; }
    else if (S.Contains(TEXT("bench"))) { TargetCm = 200.0f; bUseHeight = false; }
    else if (S.Contains(TEXT("crate")) || S.Contains(TEXT("barrel"))) { TargetCm = 120.0f; bUseHeight = false; }
    else if (S.Contains(TEXT("bush"))) { TargetCm = 190.0f; bUseHeight = false; }
    else if (S.Contains(TEXT("flower")) || S.Contains(TEXT("mushroom"))) { TargetCm = 90.0f; bUseHeight = false; }
    else if (S.Contains(TEXT("rock"))) { TargetCm = 280.0f; bUseHeight = false; }

    if (TargetCm <= 0.0f) return RequestedScale;

    const float RawDimension = bUseHeight
        ? FMath::Max(1.0f, RawSize.Z)
        : FMath::Max(1.0f, FMath::Max3(RawSize.X, RawSize.Y, RawSize.Z));
    const float UnitCorrection = FMath::Clamp(TargetCm / RawDimension, 0.01f, 500.0f);
    return RequestedScale * UnitCorrection;
}

static void PhantomFitAttachedStaticMeshToHeight(
    UStaticMeshComponent* Component,
    UStaticMesh* Mesh,
    float TargetHeightCm,
    float CapsuleHalfHeightCm,
    const FRotator& RelativeRotation = FRotator::ZeroRotator
)
{
    if (!Component || !Mesh) return;
    const FBoxSphereBounds Bounds = Mesh->GetBounds();
    const float RawHeight = FMath::Max(1.0f, Bounds.BoxExtent.Z * 2.0f);
    const float FitScale = FMath::Clamp(TargetHeightCm / RawHeight, 0.01f, 500.0f);
    const float LocalBottom = (Bounds.Origin.Z - Bounds.BoxExtent.Z) * FitScale;
    Component->SetRelativeScale3D(FVector(FitScale));
    Component->SetRelativeLocation(FVector(0.0f, 0.0f, -CapsuleHalfHeightCm - LocalBottom));
    Component->SetRelativeRotation(RelativeRotation);
}

AStaticMeshActor* APhantomGameDirectorBase::SpawnStaticMeshAsset(
    const FString& Name,
    const FString& AssetPath,
    const FVector& Location,
    const FVector& Scale,
    const FRotator& Rotation,
    bool bCollision,
    bool bGroundAtLocation
)
{
    UWorld* World = GetWorld();
    if (!World) return nullptr;

    // Prefer curated CC0 aliases when they are available, but never make the game depend on
    // a network download. The bundled generated mesh remains the deterministic fallback.
    FString PreferredAssetPath;

    // CURATED GAME-SPECIFIC ASSET LAYER (v3): these aliases are imported from the required
    // Kenney/KayKit CC0 library before packaging. The point is not to merely have assets on disk;
    // the runtime must actually request them in the places where players can see the difference.
    if (AssetPath.Contains(TEXT("SM_CubetownHouse_A")) || AssetPath.Contains(TEXT("SM_FantasyCottage")))
        PreferredAssetPath = TEXT("/Game/Phantom/Curated/Cube/SM_Cube_House_A.SM_Cube_House_A");
    else if (AssetPath.Contains(TEXT("SM_CubetownHouse_B")) || AssetPath.Contains(TEXT("SM_CubetownInn")))
        PreferredAssetPath = TEXT("/Game/Phantom/Curated/Cube/SM_Cube_House_B.SM_Cube_House_B");
    else if (AssetPath.Contains(TEXT("SM_CubetownShop")))
        PreferredAssetPath = TEXT("/Game/Phantom/Curated/Cube/SM_Cube_Blacksmith.SM_Cube_Blacksmith");
    else if (AssetPath.Contains(TEXT("SM_CubetownMarket")))
        PreferredAssetPath = TEXT("/Game/Phantom/Curated/Cube/SM_Cube_Market.SM_Cube_Market");
    else if (AssetPath.Contains(TEXT("SM_CubetownBridge")))
        PreferredAssetPath = TEXT("/Game/Phantom/Curated/Cube/SM_Cube_Bridge.SM_Cube_Bridge");
    else if (AssetPath.Contains(TEXT("SM_LegionKeep")) || AssetPath.Contains(TEXT("SM_RiftKeep")))
        PreferredAssetPath = TEXT("/Game/Phantom/Curated/Legends/SM_Legends_Keep.SM_Legends_Keep");
    else if (AssetPath.Contains(TEXT("SM_LegionWatchtower")))
        PreferredAssetPath = TEXT("/Game/Phantom/Curated/Legends/SM_Legends_Tower.SM_Legends_Tower");
    else if (AssetPath.Contains(TEXT("SM_FantasyWall")))
        PreferredAssetPath = TEXT("/Game/Phantom/Curated/Legends/SM_Legends_Wall.SM_Legends_Wall");
    else if (AssetPath.Contains(TEXT("SM_AgeTower_")))
        PreferredAssetPath = TEXT("/Game/Phantom/Curated/Ages/SM_Ages_Tower.SM_Ages_Tower");
    else if (AssetPath.Contains(TEXT("SM_Strike_Container")))
        PreferredAssetPath = TEXT("/Game/Phantom/Curated/Strike/SM_Strike_Container.SM_Strike_Container");
    else if (AssetPath.Contains(TEXT("SM_Strike_Kiosk")))
        PreferredAssetPath = TEXT("/Game/Phantom/Curated/Strike/SM_Strike_Commercial.SM_Strike_Commercial");

    if (PreferredAssetPath.IsEmpty())
    {
    if (AssetPath.Contains(TEXT("SM_StorybookTree_A")) || AssetPath.Contains(TEXT("SM_CubetownTree")))
        PreferredAssetPath = TEXT("/Game/Phantom/Curated/Cube/SM_Cube_Tree_A.SM_Cube_Tree_A");
    else if (AssetPath.Contains(TEXT("SM_StorybookTree_B")))
        PreferredAssetPath = TEXT("/Game/Phantom/Curated/Cube/SM_Cube_Tree_A.SM_Cube_Tree_A");
    else if (AssetPath.Contains(TEXT("SM_RockCluster_A")))
        PreferredAssetPath = TEXT("/Game/Phantom/Generated/Common/SM_RockCluster_A.SM_RockCluster_A");
    else if (AssetPath.Contains(TEXT("SM_Fence_A")))
        PreferredAssetPath = TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Fence.SM_CC0_Fence");
    else if (AssetPath.Contains(TEXT("SM_FantasyWall")))
        PreferredAssetPath = TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_CastleWall.SM_CC0_CastleWall");
    else if (AssetPath.Contains(TEXT("SM_LegionWatchtower")))
        PreferredAssetPath = TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_CastleTower.SM_CC0_CastleTower");
    else if (AssetPath.Contains(TEXT("SM_FantasyCottage")) || AssetPath.Contains(TEXT("SM_CubetownHouse_A")))
        PreferredAssetPath = TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_House_A.SM_CC0_House_A");
    else if (AssetPath.Contains(TEXT("SM_CubetownHouse_B")) || AssetPath.Contains(TEXT("SM_CubetownInn")))
        PreferredAssetPath = TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_House_B.SM_CC0_House_B");
    else if (AssetPath.Contains(TEXT("SM_CubetownShop")))
        PreferredAssetPath = TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_House_C.SM_CC0_House_C");
    else if (AssetPath.Contains(TEXT("SM_AgeTower_Medieval")) || AssetPath.Contains(TEXT("SM_AgeTower_Iron")) || AssetPath.Contains(TEXT("SM_AgeTower_Bronze")))
        PreferredAssetPath = TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_CastleTower.SM_CC0_CastleTower");
    else if (AssetPath.Contains(TEXT("SM_CubetownBridge")) || AssetPath.Contains(TEXT("SM_StoneBridge")))
        PreferredAssetPath = TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Bridge.SM_CC0_Bridge");
    else if (AssetPath.Contains(TEXT("SM_CubetownMarket")))
        PreferredAssetPath = TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Market.SM_CC0_Market");
    else if (AssetPath.Contains(TEXT("SM_CubetownSignpost")))
        PreferredAssetPath = TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Sign.SM_CC0_Sign");
    else if (AssetPath.Contains(TEXT("SM_Bush_A")))
        PreferredAssetPath = TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Bush.SM_CC0_Bush");
    else if (AssetPath.Contains(TEXT("SM_FlowerPatch_A")))
        PreferredAssetPath = TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Flower.SM_CC0_Flower");
    else if (AssetPath.Contains(TEXT("SM_LanternPost_A")))
        PreferredAssetPath = TEXT("/Game/Phantom/External/CC0/Aliases/SM_CC0_Lantern.SM_CC0_Lantern");

    }

    // Callers may explicitly request one of the curated aliases. Treat those exactly like
    // automatic substitutions so grounding and authored-material preservation still apply.
    if (AssetPath.Contains(TEXT("/Game/Phantom/External/CC0/")) || AssetPath.Contains(TEXT("/Game/Phantom/Curated/")))
        PreferredAssetPath = AssetPath;

    // V6 UNITY CONTINUITY LAYER. The pre-Unreal Unity project is no longer ignored.
    // ImportUnityBaselineAssets.py promotes the strongest compatible baseline meshes into stable aliases.
    FString UnityPreferredAssetPath;
    if (AssetPath.Contains(TEXT("CubetownHouse")) || AssetPath.Contains(TEXT("Cube_House")) || AssetPath.Contains(TEXT("FantasyCottage")))
        UnityPreferredAssetPath = TEXT("/Game/Phantom/Curated/Unity/Cube/SM_Unity_House.SM_Unity_House");
    else if (AssetPath.Contains(TEXT("StorybookTree")) || AssetPath.Contains(TEXT("Cube_Tree")))
        UnityPreferredAssetPath = TEXT("/Game/Phantom/Curated/Unity/Cube/SM_Unity_Tree.SM_Unity_Tree");
    else if (AssetPath.Contains(TEXT("LegionKeep")) || AssetPath.Contains(TEXT("RiftKeep")) || AssetPath.Contains(TEXT("Legends_Keep")))
        UnityPreferredAssetPath = TEXT("/Game/Phantom/Curated/Unity/Legends/SM_Unity_Keep.SM_Unity_Keep");
    else if (AssetPath.Contains(TEXT("LegionWatchtower")) || AssetPath.Contains(TEXT("Legends_Tower")))
        UnityPreferredAssetPath = TEXT("/Game/Phantom/Curated/Unity/Legends/SM_Unity_Tower.SM_Unity_Tower");
    else if (AssetPath.Contains(TEXT("FantasyWall")) || AssetPath.Contains(TEXT("Legends_Wall")))
        UnityPreferredAssetPath = TEXT("/Game/Phantom/Curated/Unity/Legends/SM_Unity_Wall.SM_Unity_Wall");
    else if (AssetPath.Contains(TEXT("AgeTower")) || AssetPath.Contains(TEXT("Ages_Tower")))
        UnityPreferredAssetPath = TEXT("/Game/Phantom/Curated/Unity/Ages/SM_Unity_Tower.SM_Unity_Tower");
    else if (AssetPath.Contains(TEXT("Strike_Container")) || AssetPath.Contains(TEXT("Strike_RoadBarrier")) || AssetPath.Contains(TEXT("Strike_Debris")))
        UnityPreferredAssetPath = TEXT("/Game/Phantom/Curated/Unity/Strike/SM_Unity_Prop.SM_Unity_Prop");

    // If the user has already imported owned Fab/Quixel/Marketplace content into this project,
    // HarvestOwnedFabAssets.py creates a small set of stable high-fidelity aliases. Prefer those
    // over the deterministic CC0 library where the art direction matches. No Fab authentication
    // or network access occurs here.
    FString FabPreferredAssetPath;
    if (AssetPath.Contains(TEXT("SM_LegionKeep")) || AssetPath.Contains(TEXT("SM_RiftKeep")) || AssetPath.Contains(TEXT("SM_Legends_Keep")))
        FabPreferredAssetPath = TEXT("/Game/Phantom/Curated/Fab/Legends/SM_Fab_Keep.SM_Fab_Keep");
    else if (AssetPath.Contains(TEXT("Watchtower")) || AssetPath.Contains(TEXT("Legends_Tower")))
        FabPreferredAssetPath = TEXT("/Game/Phantom/Curated/Fab/Legends/SM_Fab_Tower.SM_Fab_Tower");
    else if (AssetPath.Contains(TEXT("FantasyWall")) || AssetPath.Contains(TEXT("Legends_Wall")))
        FabPreferredAssetPath = TEXT("/Game/Phantom/Curated/Fab/Legends/SM_Fab_Wall.SM_Fab_Wall");
    else if (AssetPath.Contains(TEXT("Legends_Ruin")) || AssetPath.Contains(TEXT("Ruin")))
        FabPreferredAssetPath = TEXT("/Game/Phantom/Curated/Fab/Legends/SM_Fab_Ruin.SM_Fab_Ruin");
    else if (AssetPath.Contains(TEXT("Legends_Barracks")))
        FabPreferredAssetPath = TEXT("/Game/Phantom/Curated/Fab/Legends/SM_Fab_Barracks.SM_Fab_Barracks");
    else if (AssetPath.Contains(TEXT("Legends_Market")))
        FabPreferredAssetPath = TEXT("/Game/Phantom/Curated/Fab/Legends/SM_Fab_Market.SM_Fab_Market");
    else if (AssetPath.Contains(TEXT("Legends_Mine")))
        FabPreferredAssetPath = TEXT("/Game/Phantom/Curated/Fab/Legends/SM_Fab_Mine.SM_Fab_Mine");
    else if (AssetPath.Contains(TEXT("Legends_Windmill")))
        FabPreferredAssetPath = TEXT("/Game/Phantom/Curated/Fab/Legends/SM_Fab_Windmill.SM_Fab_Windmill");
    else if (AssetPath.Contains(TEXT("SM_AgeTower_")) || AssetPath.Contains(TEXT("SM_Ages_Tower")))
        FabPreferredAssetPath = TEXT("/Game/Phantom/Curated/Fab/Ages/SM_Fab_Tower.SM_Fab_Tower");
    else if (AssetPath.Contains(TEXT("SM_Ages_Wall")))
        FabPreferredAssetPath = TEXT("/Game/Phantom/Curated/Fab/Ages/SM_Fab_Wall.SM_Fab_Wall");
    else if (AssetPath.Contains(TEXT("Ages_Siege")) || AssetPath.Contains(TEXT("Catapult")) || AssetPath.Contains(TEXT("Trebuchet")) || AssetPath.Contains(TEXT("Ballista")))
        FabPreferredAssetPath = TEXT("/Game/Phantom/Curated/Fab/Ages/SM_Fab_Siege.SM_Fab_Siege");
    else if (AssetPath.Contains(TEXT("Strike_Industrial")) || AssetPath.Contains(TEXT("Strike_Warehouse")))
        FabPreferredAssetPath = TEXT("/Game/Phantom/Curated/Fab/Strike/SM_Fab_Industrial.SM_Fab_Industrial");
    else if (AssetPath.Contains(TEXT("Strike_Commercial")) || AssetPath.Contains(TEXT("Strike_Kiosk")))
        FabPreferredAssetPath = TEXT("/Game/Phantom/Curated/Fab/Strike/SM_Fab_Building.SM_Fab_Building");
    else if (AssetPath.Contains(TEXT("Strike_Rubble")) || AssetPath.Contains(TEXT("Debris")))
        FabPreferredAssetPath = TEXT("/Game/Phantom/Curated/Fab/Strike/SM_Fab_Rubble.SM_Fab_Rubble");
    else if (AssetPath.Contains(TEXT("Strike_StreetProp")) || AssetPath.Contains(TEXT("Strike_Container")) || AssetPath.Contains(TEXT("RoadBarrier")))
        FabPreferredAssetPath = TEXT("/Game/Phantom/Curated/Fab/Strike/SM_Fab_StreetProp.SM_Fab_StreetProp");
    else if (AssetPath.Contains(TEXT("Cube_House")) || AssetPath.Contains(TEXT("CubetownHouse")))
        FabPreferredAssetPath = TEXT("/Game/Phantom/Curated/Fab/Cube/SM_Fab_StylizedHouse.SM_Fab_StylizedHouse");
    else if (AssetPath.Contains(TEXT("Cube_Tree")) || AssetPath.Contains(TEXT("StorybookTree")))
        FabPreferredAssetPath = TEXT("/Game/Phantom/Curated/Fab/Cube/SM_Fab_StylizedTree.SM_Fab_StylizedTree");
    else if (AssetPath.Contains(TEXT("Cube_Rock")))
        FabPreferredAssetPath = TEXT("/Game/Phantom/Curated/Fab/Cube/SM_Fab_StylizedRock.SM_Fab_StylizedRock");
    else if (AssetPath.Contains(TEXT("Cube_Bridge")) || AssetPath.Contains(TEXT("CubetownBridge")))
        FabPreferredAssetPath = TEXT("/Game/Phantom/External/KenneyNatureV26/SM_CT26_StoneBridge.SM_CT26_StoneBridge");

    bool bUsingExternalCC0 = false;
    UStaticMesh* Mesh = nullptr;
    const bool bAuthoredStrikeCore = AssetPath.StartsWith(TEXT("/Game/Phantom/Strike/"));
    const bool bVerifiedCuratedTree = AssetPath.StartsWith(TEXT("/Game/Phantom/Curated/Cube/SM_Cube_Tree_A"));
    const bool bCubeStyle = AssetPath.Contains(TEXT("Cube")) || AssetPath.Contains(TEXT("Cubetown")) || AssetPath.Contains(TEXT("Storybook"));
    if (bVerifiedCuratedTree)
        Mesh = LoadObject<UStaticMesh>(nullptr, *AssetPath);
    if (!bAuthoredStrikeCore && !Mesh && bCubeStyle && !UnityPreferredAssetPath.IsEmpty())
    {
        Mesh = LoadObject<UStaticMesh>(nullptr, *UnityPreferredAssetPath);
        bUsingExternalCC0 = Mesh != nullptr;
    }
    if (!bAuthoredStrikeCore && !Mesh && !FabPreferredAssetPath.IsEmpty())
    {
        Mesh = LoadObject<UStaticMesh>(nullptr, *FabPreferredAssetPath);
        bUsingExternalCC0 = Mesh != nullptr;
    }
    if (!bAuthoredStrikeCore && !Mesh && !UnityPreferredAssetPath.IsEmpty())
    {
        Mesh = LoadObject<UStaticMesh>(nullptr, *UnityPreferredAssetPath);
        bUsingExternalCC0 = Mesh != nullptr;
    }
    if (!Mesh && !PreferredAssetPath.IsEmpty())
    {
        Mesh = LoadObject<UStaticMesh>(nullptr, *PreferredAssetPath);
        bUsingExternalCC0 = Mesh != nullptr;
    }
    if (!Mesh) Mesh = LoadObject<UStaticMesh>(nullptr, *AssetPath);

    // SERIOUS CONTENT FALLBACK:
    // Earlier builds could spawn *nothing* when an optional CC0/Fab alias was missing. That made
    // whole districts disappear. Resolve every common semantic category to a bundled authored GLB.
    // The fallback is intentionally game-shaped, not an invisible failure and not a giant cube town.
    if (!Mesh)
    {
        FString Fallback;
        const FString P = PreferredAssetPath.IsEmpty() ? AssetPath : PreferredAssetPath;
        if (P.Contains(TEXT("Tree")) || P.Contains(TEXT("Bush"))) Fallback = TEXT("/Game/Phantom/Curated/Cube/SM_Cube_Tree_A.SM_Cube_Tree_A");
        else if (P.Contains(TEXT("Rock"))) Fallback = TEXT("/Game/Phantom/Generated/Common/SM_RockCluster_A.SM_RockCluster_A");
        else if (P.Contains(TEXT("Flower"))) Fallback = TEXT("/Game/Phantom/Generated/Common/SM_FlowerPatch_A.SM_FlowerPatch_A");
        else if (P.Contains(TEXT("Mushroom"))) Fallback = TEXT("/Game/Phantom/Generated/Common/SM_MushroomCluster_A.SM_MushroomCluster_A");
        else if (P.Contains(TEXT("Lantern"))) Fallback = TEXT("/Game/Phantom/Generated/Common/SM_LanternPost_A.SM_LanternPost_A");
        else if (P.Contains(TEXT("Bench"))) Fallback = TEXT("/Game/Phantom/Generated/Common/SM_Bench_A.SM_Bench_A");
        else if (P.Contains(TEXT("Fence"))) Fallback = TEXT("/Game/Phantom/Generated/Common/SM_Fence_A.SM_Fence_A");
        else if (P.Contains(TEXT("CastleWall")) || P.Contains(TEXT("FantasyWall"))) Fallback = TEXT("/Game/Phantom/Generated/Legends/SM_FantasyWall.SM_FantasyWall");
        else if (P.Contains(TEXT("CastleTower")) || P.Contains(TEXT("Watchtower"))) Fallback = TEXT("/Game/Phantom/Generated/Legends/SM_LegionWatchtower.SM_LegionWatchtower");
        else if (P.Contains(TEXT("/Game/Phantom/Strike/Street_Bridge"))) Fallback = TEXT("/Game/Phantom/Generated/Strike/Environment/SM_Overpass.SM_Overpass");
        else if (P.Contains(TEXT("/Game/Phantom/Strike/Street"))) Fallback = TEXT("/Game/Phantom/Generated/Strike/Props/SM_Strike_RoadBarrier.SM_Strike_RoadBarrier");
        else if (P.Contains(TEXT("Bridge"))) Fallback = TEXT("/Game/Phantom/Generated/Legends/SM_StoneBridge.SM_StoneBridge");
        else if (P.Contains(TEXT("Gate"))) Fallback = TEXT("/Game/Phantom/Generated/Legends/SM_RiftObelisk.SM_RiftObelisk");
        else if (P.Contains(TEXT("Cart"))) Fallback = TEXT("/Game/Phantom/Generated/Common/SM_Cart_A.SM_Cart_A");
        else if (P.Contains(TEXT("Market"))) Fallback = TEXT("/Game/Phantom/Generated/Cubetown/SM_CubetownMarketStall.SM_CubetownMarketStall");
        else if (P.Contains(TEXT("Sign"))) Fallback = TEXT("/Game/Phantom/Generated/Common/SM_Sign_A.SM_Sign_A");
        else if (P.Contains(TEXT("Well"))) Fallback = TEXT("/Game/Phantom/Generated/Common/SM_Well_A.SM_Well_A");
        else if (P.Contains(TEXT("Fountain"))) Fallback = TEXT("/Game/Phantom/Generated/Cubetown/SM_CubetownFountain.SM_CubetownFountain");
        else if (P.Contains(TEXT("House_C")) || P.Contains(TEXT("Shop"))) Fallback = TEXT("/Game/Phantom/Generated/Cubetown/SM_CubetownShop.SM_CubetownShop");
        else if (P.Contains(TEXT("House_B")) || P.Contains(TEXT("Inn"))) Fallback = TEXT("/Game/Phantom/Generated/Cubetown/SM_CubetownHouse_B.SM_CubetownHouse_B");
        else if (P.Contains(TEXT("House")) || P.Contains(TEXT("Cottage"))) Fallback = TEXT("/Game/Phantom/Generated/Cubetown/SM_CubetownHouse_A.SM_CubetownHouse_A");
        else if (P.Contains(TEXT("/Game/Phantom/Strike/"))) Fallback = TEXT("/Game/Phantom/Generated/Strike/Environment/SM_CommandFacility.SM_CommandFacility");
        else if (P.Contains(TEXT("Crate"))) Fallback = TEXT("/Game/Phantom/Generated/Common/SM_Crate_A.SM_Crate_A");
        else if (P.Contains(TEXT("Barrel"))) Fallback = TEXT("/Game/Phantom/Generated/Common/SM_Barrel_A.SM_Barrel_A");
        if (!Fallback.IsEmpty()) Mesh = LoadObject<UStaticMesh>(nullptr, *Fallback);
    }
    if (!Mesh)
    {
        // V7 PRODUCTION PIVOT: never convert missing real art into an Engine primitive.
        UE_LOG(LogTemp, Error, TEXT("[PhantomArtGate] Missing semantic mesh '%s' for actor '%s'."), *AssetPath, *Name);
        return nullptr;
    }

    const FString Semantic = Name + TEXT(" ") + AssetPath + TEXT(" ") + PreferredAssetPath + TEXT(" ") + UnityPreferredAssetPath + TEXT(" ") + FabPreferredAssetPath;
    const FVector EffectiveScale = bAuthoredStrikeCore ? Scale : PhantomNormalizeSemanticMeshScale(Mesh, Semantic, Scale);

    FVector SpawnLocation = Location;
    if (bGroundAtLocation || bUsingExternalCC0)
    {
        const FBoxSphereBounds Bounds = Mesh->GetBounds();
        const float LocalBottom = Bounds.Origin.Z - Bounds.BoxExtent.Z;
        SpawnLocation.Z -= LocalBottom * EffectiveScale.Z;
    }
    AStaticMeshActor* Actor = World->SpawnActor<AStaticMeshActor>(SpawnLocation, Rotation);
    if (!Actor) return nullptr;
    Actor->Tags.Add(FName(*Name));
    if (bUsingExternalCC0) Actor->Tags.Add(FName(TEXT("PhantomExternalCC0")));
    Actor->GetStaticMeshComponent()->SetStaticMesh(Mesh);
    Actor->SetActorScale3D(EffectiveScale);
    Actor->SetActorEnableCollision(bCollision);
    Actor->GetStaticMeshComponent()->SetCollisionEnabled(
        bCollision ? ECollisionEnabled::QueryAndPhysics : ECollisionEnabled::NoCollision
    );

    // IMPORTANT: preserve imported authored materials. Previous recovery builds replaced tree/bush/rock
    // material slots with BasicShapeMaterial, which flattened real asset packs back into prototype colors
    // and erased the very fidelity the download/import pass was supposed to add. If an import genuinely
    // lacks a usable material, fix it in the editor import/material pipeline instead of globally repainting it.

    return Actor;
}

UHierarchicalInstancedStaticMeshComponent* APhantomGameDirectorBase::SpawnInstancedMeshCluster(
    const FString& Name,
    const FString& AssetPath,
    const TArray<FTransform>& WorldTransforms,
    bool bCollision
)
{
    if (WorldTransforms.IsEmpty()) return nullptr;
    UStaticMesh* Mesh = LoadObject<UStaticMesh>(nullptr, *AssetPath);
    FString ResolvedAssetPath = AssetPath;
    if (!Mesh)
    {
        if (AssetPath.Contains(TEXT("Tree")))
            ResolvedAssetPath = TEXT("/Game/Phantom/Curated/Cube/SM_Cube_Tree_A.SM_Cube_Tree_A");
        else if (AssetPath.Contains(TEXT("Rock")))
            ResolvedAssetPath = TEXT("/Game/Phantom/Generated/Common/SM_RockCluster_A.SM_RockCluster_A");
        else if (AssetPath.Contains(TEXT("Flower")))
            ResolvedAssetPath = TEXT("/Game/Phantom/Generated/Common/SM_FlowerPatch_A.SM_FlowerPatch_A");
        Mesh = LoadObject<UStaticMesh>(nullptr, *ResolvedAssetPath);
    }
    if (!Mesh) return nullptr;

    UHierarchicalInstancedStaticMeshComponent* HISM = NewObject<UHierarchicalInstancedStaticMeshComponent>(this, FName(*Name));
    if (!HISM) return nullptr;
    AddInstanceComponent(HISM);
    HISM->SetStaticMesh(Mesh);
    HISM->SetMobility(EComponentMobility::Static);
    HISM->SetCollisionEnabled(bCollision ? ECollisionEnabled::QueryAndPhysics : ECollisionEnabled::NoCollision);
    HISM->SetCanEverAffectNavigation(bCollision);
    HISM->RegisterComponent();
    // Normalize source-pack units before batching so a 960m world never becomes a field of
    // centimeter-sized houses and trees.
    TArray<FTransform> NormalizedTransforms;
    NormalizedTransforms.Reserve(WorldTransforms.Num());
    const FString Semantic = Name + TEXT(" ") + ResolvedAssetPath;
    const FVector UnitCorrection = PhantomNormalizeSemanticMeshScale(Mesh, Semantic, FVector(1.0f));
    for (const FTransform& SourceTransform : WorldTransforms)
    {
        FTransform T = SourceTransform;
        const FVector Requested = SourceTransform.GetScale3D();
        T.SetScale3D(FVector(Requested.X * UnitCorrection.X, Requested.Y * UnitCorrection.Y, Requested.Z * UnitCorrection.Z));
        NormalizedTransforms.Add(T);
    }
    HISM->AddInstances(NormalizedTransforms, false, true, bCollision);
    return HISM;
}

AStaticMeshActor* APhantomGameDirectorBase::SpawnTintedStaticMeshAsset(
    const FString& Name,
    const FString& AssetPath,
    const FVector& Location,
    const FVector& Scale,
    const FLinearColor& Tint,
    const FRotator& Rotation,
    bool bCollision,
    bool bGroundAtLocation
)
{
    AStaticMeshActor* Actor = SpawnStaticMeshAsset(Name, AssetPath, Location, Scale, Rotation, bCollision, bGroundAtLocation);
    if (!Actor) return nullptr;
    UStaticMeshComponent* MeshComponent = Actor->GetStaticMeshComponent();
    UMaterialInterface* BaseMaterial = LoadObject<UMaterialInterface>(
        nullptr,
        TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial")
    );
    if (!MeshComponent || !BaseMaterial) return Actor;

    // Curated external packs already carry a coherent material language. Preserve those
    // authored materials instead of flattening them back to BasicShapeMaterial.
    if (Actor->ActorHasTag(FName(TEXT("PhantomExternalCC0")))) return Actor;

    const int32 SlotCount = FMath::Max(1, MeshComponent->GetNumMaterials());
    for (int32 Slot = 0; Slot < SlotCount; ++Slot)
    {
        UMaterialInstanceDynamic* Material = UMaterialInstanceDynamic::Create(BaseMaterial, Actor);
        if (!Material) continue;
        Material->SetVectorParameterValue(TEXT("Color"), Tint);
        MeshComponent->SetMaterial(Slot, Material);
    }
    return Actor;
}

bool APhantomGameDirectorBase::ApplyMaterialAsset(
    AStaticMeshActor* Actor,
    const FString& MaterialPath,
    int32 MaterialSlot
)
{
    if (!Actor) return false;
    UStaticMeshComponent* MeshComponent = Actor->GetStaticMeshComponent();
    UMaterialInterface* Material = LoadObject<UMaterialInterface>(nullptr, *MaterialPath);
    if (!MeshComponent || !Material) return false;

    if (MaterialSlot != INDEX_NONE)
    {
        if (MaterialSlot < 0 || MaterialSlot >= FMath::Max(1, MeshComponent->GetNumMaterials())) return false;
        MeshComponent->SetMaterial(MaterialSlot, Material);
        return true;
    }

    const int32 SlotCount = FMath::Max(1, MeshComponent->GetNumMaterials());
    for (int32 Slot = 0; Slot < SlotCount; ++Slot) MeshComponent->SetMaterial(Slot, Material);
    return true;
}

APointLight* APhantomGameDirectorBase::SpawnPointLight(
    const FString& Name,
    const FVector& Location,
    const FLinearColor& Color,
    float Intensity,
    float Radius,
    bool bCastShadows
)
{
    if (!GetWorld()) return nullptr;
    APointLight* Light = GetWorld()->SpawnActor<APointLight>(Location, FRotator::ZeroRotator);
    if (!Light) return nullptr;
    Light->Tags.Add(FName(*Name));
    UPointLightComponent* Component = Cast<UPointLightComponent>(Light->GetLightComponent());
    if (!Component) return Light;
    Component->SetMobility(EComponentMobility::Movable);
    Component->SetLightColor(Color);
    Component->SetIntensity(Intensity);
    Component->SetAttenuationRadius(Radius);
    Component->SetCastShadows(bCastShadows);
    return Light;
}

ADirectionalLight* APhantomGameDirectorBase::SpawnSun(
    float Intensity,
    const FRotator& Rotation,
    const FLinearColor& Color
)
{
    if (!GetWorld()) return nullptr;
    ADirectionalLight* Sun = GetWorld()->SpawnActor<ADirectionalLight>(FVector::ZeroVector, Rotation);
    if (!Sun) return nullptr;
    Sun->GetLightComponent()->SetMobility(EComponentMobility::Movable);
    Sun->GetLightComponent()->SetIntensity(Intensity);
    Sun->GetLightComponent()->SetLightColor(Color);
    Sun->GetLightComponent()->SetCastShadows(true);
    if (UDirectionalLightComponent* Directional = Cast<UDirectionalLightComponent>(Sun->GetLightComponent()))
    {
        Directional->SetAtmosphereSunLight(true);
        Directional->SetAtmosphereSunLightIndex(0);
    }
    return Sun;
}

void APhantomGameDirectorBase::SetWorldMood(
    const FLinearColor& FogColor,
    float FogDensity,
    const FLinearColor& AmbientColor
)
{
    if (!GetWorld()) return;
    // EMERGENCY VISUAL RECOVERY: every game needs an actual sky. The previous code created a
    // movable skylight and fog but NO SkyAtmosphere, which is why packaged builds could render
    // as a black void behind otherwise valid geometry.
    // UE 5.8 recovery uses the public Sky Atmosphere component API rather than a private actor header. Build the global
    // atmosphere from the public USkyAtmosphereComponent API instead. Keeping it on a tiny
    // host actor gives it normal world lifetime without coupling it to a game-specific pawn.
    AActor* AtmosphereHost = GetWorld()->SpawnActor<AActor>(FVector::ZeroVector, FRotator::ZeroRotator);
    if (AtmosphereHost)
    {
        AtmosphereHost->Tags.Add(FName(TEXT("PhantomSkyAtmosphere")));
        USkyAtmosphereComponent* AtmosphereComponent = NewObject<USkyAtmosphereComponent>(
            AtmosphereHost,
            USkyAtmosphereComponent::StaticClass(),
            TEXT("PhantomSkyAtmosphereComponent")
        );
        if (AtmosphereComponent)
        {
            AtmosphereHost->AddInstanceComponent(AtmosphereComponent);
            AtmosphereHost->SetRootComponent(AtmosphereComponent);
            AtmosphereComponent->RegisterComponent();
        }
    }

    AExponentialHeightFog* Fog = GetWorld()->SpawnActor<AExponentialHeightFog>();
    Fog->GetComponent()->SetFogInscatteringColor(FogColor);
    Fog->GetComponent()->SetFogDensity(FMath::Min(FogDensity, 0.0035f));
    Fog->GetComponent()->SetVolumetricFog(true);

    ASkyLight* SkyLight = GetWorld()->SpawnActor<ASkyLight>();
    SkyLight->GetLightComponent()->SetMobility(EComponentMobility::Movable);
    SkyLight->GetLightComponent()->SetIntensity(1.15f);
    SkyLight->GetLightComponent()->SetLightColor(AmbientColor);
    if (USkyLightComponent* SkyComponent = Cast<USkyLightComponent>(SkyLight->GetLightComponent()))
    {
        SkyComponent->RecaptureSky();
    }

    APostProcessVolume* PostProcess = GetWorld()->SpawnActor<APostProcessVolume>();
    if (PostProcess)
    {
        PostProcess->bUnbound = true;
        PostProcess->Settings.bOverride_BloomIntensity = true;
        PostProcess->Settings.BloomIntensity = 0.28f;
        PostProcess->Settings.bOverride_VignetteIntensity = true;
        PostProcess->Settings.VignetteIntensity = 0.11f;
        PostProcess->Settings.bOverride_AmbientOcclusionIntensity = true;
        PostProcess->Settings.AmbientOcclusionIntensity = 1.32f;
        PostProcess->Settings.bOverride_AmbientOcclusionRadius = true;
        PostProcess->Settings.AmbientOcclusionRadius = 135.0f;
        PostProcess->Settings.bOverride_AutoExposureBias = true;
        PostProcess->Settings.AutoExposureBias = 0.10f;
        PostProcess->Settings.bOverride_MotionBlurAmount = true;
        PostProcess->Settings.MotionBlurAmount = 0.0f;
    }
}

void APhantomGameDirectorBase::StyleWorldPostProcess(
    float ExposureBias,
    float Contrast,
    float Saturation,
    float BloomIntensity,
    float VignetteIntensity
)
{
    if (!GetWorld()) return;

    // Each flagship has a deliberately different visual identity.  The old shared +0.10 exposure
    // made Blackridge chalk-white and flattened the fantasy worlds into the same bright prototype
    // look.  Style the already-created unbound volume instead of stacking competing volumes.
    for (TActorIterator<APostProcessVolume> It(GetWorld()); It; ++It)
    {
        FPostProcessSettings& Settings = It->Settings;
        Settings.bOverride_AutoExposureBias = true;
        Settings.AutoExposureBias = ExposureBias;
        Settings.bOverride_ColorContrast = true;
        Settings.ColorContrast = FVector4(Contrast, Contrast, Contrast, 1.0f);
        Settings.bOverride_ColorSaturation = true;
        Settings.ColorSaturation = FVector4(Saturation, Saturation, Saturation, 1.0f);
        Settings.bOverride_BloomIntensity = true;
        Settings.BloomIntensity = BloomIntensity;
        Settings.bOverride_VignetteIntensity = true;
        Settings.VignetteIntensity = VignetteIntensity;
        return;
    }
}
