#pragma once

#include "CoreMinimal.h"

// Production interaction constants derived from the Phantom Games Master Interaction Specification.
// Keep pointer timing/threshold behavior centralized so each game does not invent its own feel.
namespace PhantomInteractionSpec
{
    constexpr float ClickMaxDuration = 0.22f;
    constexpr float DragThreshold1080 = 6.0f;
    constexpr float DoubleClickInterval = 0.28f;
    constexpr float DoubleClickRadius1080 = 5.0f;
    constexpr float HoldThreshold = 0.40f;
    constexpr float TooltipDelay = 0.45f;
    constexpr float ContextTooltipDelay = 0.75f;
    constexpr float InputBufferWindow = 0.15f;

    FORCEINLINE float DpiScaledPixels(float LogicalPixels, int32 ViewportHeight)
    {
        return LogicalPixels * FMath::Max(0.70f, static_cast<float>(FMath::Max(ViewportHeight, 720)) / 1080.0f);
    }
}
