#pragma once

#include "CoreMinimal.h"

namespace PhantomGameIds
{
    PHANTOMGAMES_API const FString& Strike();
    PHANTOMGAMES_API const FString& Ages();
    PHANTOMGAMES_API const FString& Legends();
    PHANTOMGAMES_API const FString& Cubetown();
    PHANTOMGAMES_API bool IsFlagship(const FString& GameId);
    PHANTOMGAMES_API bool IsNativeGame(const FString& GameId);
    PHANTOMGAMES_API FString ResolveRequested();
    PHANTOMGAMES_API FString SaveNamespace(const FString& GameId);
}
