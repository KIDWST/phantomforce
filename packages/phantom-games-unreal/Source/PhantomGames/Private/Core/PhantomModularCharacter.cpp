#include "Core/PhantomModularCharacter.h"

#include "Animation/AnimSequence.h"
#include "Components/SceneComponent.h"
#include "Components/SkeletalMeshComponent.h"
#include "Engine/SkeletalMesh.h"
#include "GameFramework/Actor.h"

namespace
{
    FString CharacterAliasFromPath(const TCHAR* BodyMeshPath)
    {
        FString Reference(BodyMeshPath ? BodyMeshPath : TEXT(""));
        int32 Slash = INDEX_NONE;
        Reference.FindLastChar(TEXT('/'), Slash);
        FString Name = Slash == INDEX_NONE ? Reference : Reference.Mid(Slash + 1);
        int32 Dot = INDEX_NONE;
        if (Name.FindChar(TEXT('.'), Dot)) Name = Name.Left(Dot);
        Name.RemoveFromStart(TEXT("SK_"));
        return Name;
    }
}

bool PhantomModularCharacter::Configure(
    AActor* Owner,
    USkeletalMeshComponent* Leader,
    USceneComponent* AttachParent,
    const TCHAR* BodyMeshPath,
    const TCHAR* IdleAnimPath,
    float TargetHeightCm,
    float AnchorZ,
    float YawOffset,
    bool bAllowMonolithic
)
{
    if (!Owner || !Leader || !AttachParent || !BodyMeshPath) return false;
    USkeletalMesh* Body = LoadObject<USkeletalMesh>(nullptr, BodyMeshPath);
    const FString Alias = CharacterAliasFromPath(BodyMeshPath);
    if (!Body || Alias.IsEmpty()) return false;

    static const TCHAR* PartSuffixes[] = {
        TEXT("ArmLeft"), TEXT("ArmRight"), TEXT("Cloak"), TEXT("Eyes"),
        TEXT("Head"), TEXT("Jaw"), TEXT("LegLeft"), TEXT("LegRight"), TEXT("Skull")
    };
    struct FResolvedPart
    {
        FString Suffix;
        USkeletalMesh* Mesh = nullptr;
    };
    TArray<FResolvedPart> Parts;

    const FBoxSphereBounds BodyBounds = Body->GetBounds();
    float MinZ = BodyBounds.Origin.Z - BodyBounds.BoxExtent.Z;
    float MaxZ = BodyBounds.Origin.Z + BodyBounds.BoxExtent.Z;
    if (!bAllowMonolithic)
    {
        for (const TCHAR* Suffix : PartSuffixes)
        {
            // Human production sets intentionally omit skeleton-only facial/cloak parts. Avoid
            // probing known-absent packages every launch; those probes produced alarming missing
            // asset warnings even though the complete animated hero was present.
            const bool bSkeletonAlias = Alias.StartsWith(TEXT("Skeleton"));
            const FString SuffixName(Suffix);
            if (!bSkeletonAlias && (
                SuffixName == TEXT("Cloak") || SuffixName == TEXT("Eyes") ||
                SuffixName == TEXT("Jaw") || SuffixName == TEXT("Skull")))
            {
                continue;
            }
            const FString AssetPath = FString::Printf(
                TEXT("/Game/Phantom/Characters/Production/Parts/SK_%s_%s.SK_%s_%s"),
                *Alias, Suffix, *Alias, Suffix
            );
            if (USkeletalMesh* PartMesh = LoadObject<USkeletalMesh>(nullptr, *AssetPath))
            {
                const FBoxSphereBounds Bounds = PartMesh->GetBounds();
                MinZ = FMath::Min(MinZ, Bounds.Origin.Z - Bounds.BoxExtent.Z);
                MaxZ = FMath::Max(MaxZ, Bounds.Origin.Z + Bounds.BoxExtent.Z);
                Parts.Add({FString(Suffix), PartMesh});
            }
        }
    }
    // Imported modular characters must include their visible body parts. Verified full-body
    // meshes (such as Epic's Manny) can opt into the same fit/animation path without clones.
    if (Parts.Num() < 4 && !bAllowMonolithic) return false;

    const float RawHeight = FMath::Max(1.0f, MaxZ - MinZ);
    const float FitScale = FMath::Clamp(TargetHeightCm / RawHeight, 0.01f, 50.0f);
    const FVector RelativeLocation(0.0f, 0.0f, AnchorZ - MinZ * FitScale);
    const FRotator RelativeRotation(0.0f, YawOffset, 0.0f);
    const FVector RelativeScale(FitScale);

    Leader->SetSkeletalMeshAsset(Body);
    Leader->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    Leader->SetRelativeLocation(RelativeLocation);
    Leader->SetRelativeRotation(RelativeRotation);
    Leader->SetRelativeScale3D(RelativeScale);
    Leader->SetVisibility(true, true);
    Leader->SetHiddenInGame(false, true);

    for (const FResolvedPart& Part : Parts)
    {
        const FName ComponentName(*FString::Printf(TEXT("Production_%s_%s"), *Alias, *Part.Suffix));
        USkeletalMeshComponent* Follower = NewObject<USkeletalMeshComponent>(Owner, ComponentName);
        if (!Follower) continue;
        Follower->SetupAttachment(AttachParent);
        Follower->SetSkeletalMeshAsset(Part.Mesh);
        Follower->SetCollisionEnabled(ECollisionEnabled::NoCollision);
        Follower->SetRelativeLocation(RelativeLocation);
        Follower->SetRelativeRotation(RelativeRotation);
        Follower->SetRelativeScale3D(RelativeScale);
        Follower->SetVisibility(true, true);
        Follower->SetHiddenInGame(false, true);
        Follower->SetLeaderPoseComponent(Leader, true, false);
        Owner->AddInstanceComponent(Follower);
        Follower->RegisterComponent();
    }

    if (UAnimSequence* Idle = LoadObject<UAnimSequence>(nullptr, IdleAnimPath))
    {
        Leader->SetAnimationMode(EAnimationMode::AnimationSingleNode);
        Leader->PlayAnimation(Idle, true);
    }
    return true;
}
