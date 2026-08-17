#include "Core/PhantomRouterGameMode.h"

#include "Ages/PhantomAgesDirector.h"
#include "Core/PhantomGameIds.h"
#include "Cubetown/CubetownDirector.h"
#include "Legends/PhantomLegendsDirector.h"
#include "Strike/PhantomStrikeDirector.h"
#include "Kismet/GameplayStatics.h"

APhantomRouterGameMode::APhantomRouterGameMode()
{
    SelectedGameId = PhantomGameIds::ResolveRequested();
    if (SelectedGameId == PhantomGameIds::Strike())
    {
        DefaultPawnClass = APhantomStrikeCharacter::StaticClass();
        HUDClass = APhantomStrikeHUD::StaticClass();
    }
    else if (SelectedGameId == PhantomGameIds::Ages())
    {
        DefaultPawnClass = APhantomAgesPawn::StaticClass();
        HUDClass = APhantomAgesHUD::StaticClass();
    }
    else if (SelectedGameId == PhantomGameIds::Legends())
    {
        DefaultPawnClass = APhantomLegendsPawn::StaticClass();
        HUDClass = APhantomLegendsHUD::StaticClass();
    }
    else if (SelectedGameId == PhantomGameIds::Cubetown())
    {
        DefaultPawnClass = ACubetownHero::StaticClass();
        HUDClass = ACubetownHUD::StaticClass();
    }
    else
    {
        UE_LOG(LogTemp, Fatal, TEXT("Unknown -PhantomGame identity: %s"), *SelectedGameId);
    }
}

void APhantomRouterGameMode::BeginPlay()
{
    Super::BeginPlay();

    // V11 PRODUCTION-WORLD ROUTER. Earlier builds always played /Engine/Maps/Entry and assembled
    // essentially the entire visible game in BeginPlay. That made an import/runtime miss look like
    // an empty prototype. Each title now boots into a real persistent .umap produced by the one-shot
    // editor pipeline, while the director remains responsible for gameplay and dynamic simulation.
    const FString CurrentMap = GetWorld() ? GetWorld()->GetMapName() : FString();
    if (CurrentMap.Contains(TEXT("Entry")))
    {
        FString Destination;
        if (SelectedGameId == PhantomGameIds::Strike()) Destination = TEXT("/Game/Phantom/Worlds/PhantomStrike_World");
        else if (SelectedGameId == PhantomGameIds::Ages()) Destination = TEXT("/Game/Phantom/Worlds/PhantomAges_World");
        else if (SelectedGameId == PhantomGameIds::Legends()) Destination = TEXT("/Game/Phantom/Worlds/PhantomLegends_World");
        else if (SelectedGameId == PhantomGameIds::Cubetown()) Destination = TEXT("/Game/Phantom/Worlds/CubeTown_World");
        if (!Destination.IsEmpty())
        {
            UE_LOG(LogTemp, Log, TEXT("[PhantomV11] Loading production world %s for %s"), *Destination, *SelectedGameId);
            UGameplayStatics::OpenLevel(this, FName(*Destination));
            return;
        }
    }

    if (SelectedGameId == PhantomGameIds::Strike())
    {
        GetWorld()->SpawnActor<APhantomStrikeDirector>();
    }
    else if (SelectedGameId == PhantomGameIds::Ages())
    {
        GetWorld()->SpawnActor<APhantomAgesDirector>();
    }
    else if (SelectedGameId == PhantomGameIds::Legends())
    {
        GetWorld()->SpawnActor<APhantomLegendsDirector>();
    }
    else if (SelectedGameId == PhantomGameIds::Cubetown())
    {
        GetWorld()->SpawnActor<ACubetownDirector>();
    }
}
