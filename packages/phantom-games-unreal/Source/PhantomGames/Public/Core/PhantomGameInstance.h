#pragma once

#include "CoreMinimal.h"
#include "Engine/GameInstance.h"
#include "PhantomGameInstance.generated.h"

UCLASS()
class PHANTOMGAMES_API UPhantomGameInstance : public UGameInstance
{
    GENERATED_BODY()

public:
    virtual void Init() override;

    UPROPERTY(BlueprintReadOnly, Category = "Phantom")
    FString SelectedGameId;

    UPROPERTY(BlueprintReadOnly, Category = "Phantom")
    FString SelectedSaveNamespace;
};
