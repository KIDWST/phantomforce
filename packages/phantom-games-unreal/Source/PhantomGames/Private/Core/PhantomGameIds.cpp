#include "Core/PhantomGameIds.h"

#include "Misc/CommandLine.h"
#include "Misc/Parse.h"

#ifndef PHANTOM_DEFAULT_GAME
#define PHANTOM_DEFAULT_GAME TEXT("phantom-strike")
#endif

namespace PhantomGameIds
{
    const FString& Strike()
    {
        static const FString Value(TEXT("phantom-strike"));
        return Value;
    }

    const FString& Ages()
    {
        static const FString Value(TEXT("phantom-ages"));
        return Value;
    }

    const FString& Legends()
    {
        static const FString Value(TEXT("phantom-legends"));
        return Value;
    }

    const FString& Cubetown()
    {
        static const FString Value(TEXT("cubetown"));
        return Value;
    }

    bool IsFlagship(const FString& GameId)
    {
        return GameId == Strike() || GameId == Ages() || GameId == Legends();
    }

    bool IsNativeGame(const FString& GameId)
    {
        return IsFlagship(GameId) || GameId == Cubetown();
    }

    FString ResolveRequested()
    {
        FString Requested;
        if (!FParse::Value(FCommandLine::Get(), TEXT("PhantomGame="), Requested))
        {
            Requested = PHANTOM_DEFAULT_GAME;
        }
        Requested.TrimStartAndEndInline();
        Requested.ToLowerInline();
        return Requested;
    }

    FString SaveNamespace(const FString& GameId)
    {
        if (GameId == Strike()) return TEXT("phantomstrike.");
        if (GameId == Ages()) return TEXT("phantomages.");
        if (GameId == Legends()) return TEXT("phantomlegends.");
        if (GameId == Cubetown()) return TEXT("cubetown.echoes.");
        return FString();
    }
}
