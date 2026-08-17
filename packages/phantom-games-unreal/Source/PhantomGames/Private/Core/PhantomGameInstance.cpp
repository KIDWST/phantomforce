#include "Core/PhantomGameInstance.h"

#include "Core/PhantomGameIds.h"

void UPhantomGameInstance::Init()
{
    Super::Init();
    SelectedGameId = PhantomGameIds::ResolveRequested();
    if (!PhantomGameIds::IsNativeGame(SelectedGameId))
    {
        UE_LOG(LogTemp, Fatal, TEXT("Unknown -PhantomGame identity: %s"), *SelectedGameId);
        return;
    }
    SelectedSaveNamespace = PhantomGameIds::SaveNamespace(SelectedGameId);
}
