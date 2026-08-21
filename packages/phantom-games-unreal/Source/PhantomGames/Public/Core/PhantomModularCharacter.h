#pragma once

#include "CoreMinimal.h"

class AActor;
class UAnimSequence;
class USceneComponent;
class USkeletalMeshComponent;

namespace PhantomModularCharacter
{
    // Builds one animated character from a body driver plus the stable modular-part aliases
    // emitted by Tools/ImportProductionCharacters.py.  AnchorZ is the desired local floor.
    bool Configure(
        AActor* Owner,
        USkeletalMeshComponent* Leader,
        USceneComponent* AttachParent,
        const TCHAR* BodyMeshPath,
        const TCHAR* IdleAnimPath,
        float TargetHeightCm,
        float AnchorZ,
        float YawOffset,
        bool bAllowMonolithic = false
    );
}
