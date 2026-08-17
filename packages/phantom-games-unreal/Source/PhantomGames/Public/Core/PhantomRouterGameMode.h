#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "PhantomRouterGameMode.generated.h"

UCLASS()
class PHANTOMGAMES_API APhantomRouterGameMode : public AGameModeBase
{
    GENERATED_BODY()

public:
    APhantomRouterGameMode();
    virtual void BeginPlay() override;

private:
    FString SelectedGameId;
};
