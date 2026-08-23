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
    for (const TCHAR* Suffix : PartSuffixes)
    {
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
    // Zane's source Rogue set has no cloak part, while the same licensed character pack ships a
    // skeleton-compatible cloak on the minion rig.  Bind that deforming mesh through the same
    // leader pose so Shadowbearer has a complete silhouette without reviving the rigid cape that
    // visibly separated from the body during locomotion.
    if (Alias.Equals(TEXT("Rogue"), ESearchCase::IgnoreCase))
    {
        static const TCHAR* RogueCloakPath =
            TEXT("/Game/Phantom/Characters/Production/Parts/SK_SkeletonMinion_Cloak.SK_SkeletonMinion_Cloak");
        if (USkeletalMesh* RogueCloak = LoadObject<USkeletalMesh>(nullptr, RogueCloakPath))
        {
            const FBoxSphereBounds Bounds = RogueCloak->GetBounds();
            MinZ = FMath::Min(MinZ, Bounds.Origin.Z - Bounds.BoxExtent.Z);
            MaxZ = FMath::Max(MaxZ, Bounds.Origin.Z + Bounds.BoxExtent.Z);
            Parts.Add({TEXT("Cloak"), RogueCloak});
        }
    }
    // A production modular humanoid must include both limbs and a head/skull, not merely a body.
    if (Parts.Num() < 4 && !bAllowMonolithic) return false;

    const float RawHeight = FMath::Max(1.0f, MaxZ - MinZ);
    const float FitScale = FMath::Clamp(TargetHeightCm / RawHeight, 0.01f, 50.0f);
    const FVector RelativeLocation(0.0f, 0.0f, AnchorZ - MinZ * FitScale);
    const FRotator RelativeRotation(0.0f, YawOffset, 0.0f);
    const FVector RelativeScale(FitScale);

    Leader->SetSkeletalMeshAsset(Body);
    Leader->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    Leader->SetSimulatePhysics(false);
    Leader->SetEnableGravity(false);
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
        Follower->SetSkeletalMeshAsset(Part.Mesh);
        Follower->SetCollisionEnabled(ECollisionEnabled::NoCollision);
        Follower->SetSimulatePhysics(false);
        Follower->SetEnableGravity(false);
        Follower->SetGenerateOverlapEvents(false);
        Follower->SetCanEverAffectNavigation(false);
        Follower->SetVisibility(true, true);
        Follower->SetHiddenInGame(false, true);
        Follower->ComponentTags.AddUnique(TEXT("Phantom.ModularFollower"));
        Owner->AddInstanceComponent(Follower);
        Follower->RegisterComponent();
        // Followers share the leader component transform and bone buffer.  Attaching each part
        // directly to the capsule with a copied transform allowed independent imported roots to
        // diverge as soon as locomotion changed clips, which looked like Zane's skin and clothes
        // falling off.  A leader-child hierarchy makes separation physically impossible.
        Follower->AttachToComponent(Leader, FAttachmentTransformRules::SnapToTargetNotIncludingScale);
        Follower->SetRelativeLocation(FVector::ZeroVector);
        Follower->SetRelativeRotation(FRotator::ZeroRotator);
        Follower->SetRelativeScale3D(FVector::OneVector);
        Follower->SetLeaderPoseComponent(Leader, true, true);
        Follower->SetBoundsScale(1.25f);
    }

    if (UAnimSequence* Idle = LoadObject<UAnimSequence>(nullptr, IdleAnimPath))
    {
        Leader->SetAnimationMode(EAnimationMode::AnimationSingleNode);
        Leader->PlayAnimation(Idle, true);
    }
    return true;
}
