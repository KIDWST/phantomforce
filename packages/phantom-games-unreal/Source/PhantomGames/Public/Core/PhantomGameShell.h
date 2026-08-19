#pragma once
#include "CoreMinimal.h"
#include "GameFramework/HUD.h"
#include "Core/PhantomGameDirectorBase.h"
#include "Engine/Texture2D.h"

inline void DrawPhantomAspectFillTexture(AHUD* HUD, UTexture2D* Texture, float Width, float Height)
{
    if (!HUD || !Texture || Width <= 1.0f || Height <= 1.0f) return;
    const float TW = FMath::Max(1.0f, static_cast<float>(Texture->GetSizeX()));
    const float TH = FMath::Max(1.0f, static_cast<float>(Texture->GetSizeY()));
    const float ScreenAspect = Width / Height;
    const float TextureAspect = TW / TH;
    float U=0.0f,V=0.0f,US=1.0f,VS=1.0f;
    if (ScreenAspect > TextureAspect)
    {
        VS = TextureAspect / ScreenAspect;
        V = (1.0f - VS) * 0.5f;
    }
    else
    {
        US = ScreenAspect / TextureAspect;
        U = (1.0f - US) * 0.5f;
    }
    HUD->DrawTexture(Texture,0.0f,0.0f,Width,Height,U,V,US,VS,FLinearColor::White,BLEND_Opaque,1.0f,false);
}

inline bool DrawPhantomGameShell(AHUD* HUD, const APhantomGameDirectorBase* Director, float Width, float Height, const FString& Title, const FString& Subtitle, const FString& Controls, const FLinearColor& Accent)
{
    if (!HUD || !Director || !Director->IsShellVisible()) return false;
    const float Scale = Director->GetShellUIScale(Width, Height);
    const auto S = [Scale](float V){ return V * Scale; };
    const float Margin = S(54.0f);
    const float PanelW = FMath::Min(Width - Margin * 2.0f, S(1060.0f));
    const float PanelH = FMath::Min(Height - Margin * 2.0f, S(650.0f));
    const float PanelX = Margin;
    const float PanelY = (Height - PanelH) * 0.5f;
    const FLinearColor Ink(0.012f,0.020f,0.033f,0.965f);
    const FLinearColor Glass(0.030f,0.045f,0.066f,0.96f);
    const FLinearColor Muted(0.62f,0.71f,0.80f,1.0f);

    // Title screens use the supplied canonical target as a native Unreal Texture2D imported with
    // TEXTUREGROUP_UI + NeverStream. This prevents the old low-mip / stretched / blurry splash problem.
    if (Director->GetShellScreen() == EPhantomShellScreen::Title)
    {
        const TCHAR* HeroPath = nullptr;
        if (Title.Contains(TEXT("AGES"))) HeroPath = TEXT("/Game/Phantom/VisualTargets/PhantomAges_TARGET.PhantomAges_TARGET");
        else if (Title.Contains(TEXT("LEGENDS"))) HeroPath = TEXT("/Game/Phantom/VisualTargets/PhantomLegends_TARGET.PhantomLegends_TARGET");
        else if (Title.Contains(TEXT("STRIKE"))) HeroPath = TEXT("/Game/Phantom/VisualTargets/PhantomStrike_TARGET.PhantomStrike_TARGET");
        if (HeroPath)
        {
            if (UTexture2D* Hero = LoadObject<UTexture2D>(nullptr, HeroPath))
            {
                DrawPhantomAspectFillTexture(HUD, Hero, Width, Height);
            }
        }
    }

    // Full-screen cinematic scrim + restrained brand rail. Deliberately avoids the old giant desktop-window look.
    HUD->DrawRect(FLinearColor(0.003f,0.008f,0.014f,0.48f), 0, 0, Width, Height);
    HUD->DrawRect(FLinearColor(Accent.R*0.12f,Accent.G*0.12f,Accent.B*0.12f,0.96f), 0, 0, Width, S(9.0f));
    HUD->DrawRect(Ink, PanelX, PanelY, PanelW, PanelH);
    HUD->DrawRect(Accent, PanelX, PanelY, S(7.0f), PanelH);

    HUD->DrawText(Title, FLinearColor::White, PanelX+S(48.0f), PanelY+S(38.0f), nullptr, S(1.70f));
    HUD->DrawText(Subtitle, Muted, PanelX+S(50.0f), PanelY+S(96.0f), nullptr, S(0.80f));
    HUD->DrawText(TEXT("PHANTOMPLAY  //  UE 5.8"), Accent, PanelX+PanelW-S(260.0f), PanelY+S(48.0f), nullptr, S(0.62f));

    const EPhantomShellScreen Screen = Director->GetShellScreen();
    const float CardX = PanelX + S(44.0f);
    const float CardY = PanelY + S(154.0f);
    const float CardW = PanelW - S(88.0f);
    const float CardH = PanelH - S(202.0f);
    HUD->DrawRect(Glass, CardX, CardY, CardW, CardH);
    float MouseX=-10000.0f,MouseY=-10000.0f;
    if(APlayerController* PC=HUD->GetOwningPlayerController()) PC->GetMousePosition(MouseX,MouseY);

    auto DrawButton = [&](const FString& Label, float Y, bool bPrimary=false, bool bDanger=false)
    {
        const float ButtonX=CardX+S(34.0f), ButtonW=FMath::Min(CardW-S(68.0f),S(560.0f));
        const bool bHover=MouseX>=ButtonX&&MouseX<=ButtonX+ButtonW&&MouseY>=Y&&MouseY<=Y+S(52.0f);
        FLinearColor Fill = bPrimary ? FLinearColor(Accent.R*0.18f,Accent.G*0.18f,Accent.B*0.18f,0.98f) : FLinearColor(0.055f,0.072f,0.095f,0.98f);
        if(bHover) Fill=FLinearColor(FMath::Min(1.0f,Fill.R+0.08f),FMath::Min(1.0f,Fill.G+0.08f),FMath::Min(1.0f,Fill.B+0.08f),1.0f);
        HUD->DrawRect(Fill, ButtonX, Y, ButtonW, S(52.0f));
        HUD->DrawRect(bDanger ? FLinearColor(1.0f,0.26f,0.30f) : (bPrimary ? Accent : FLinearColor(0.20f,0.27f,0.35f)), CardX+S(34.0f), Y, S(5.0f), S(52.0f));
        HUD->DrawText(Label, bDanger ? FLinearColor(1.0f,0.60f,0.62f) : (bPrimary ? FLinearColor::White : FLinearColor(0.84f,0.90f,0.95f)), CardX+S(56.0f), Y+S(13.0f), nullptr, S(0.82f));
    };

    if (Screen == EPhantomShellScreen::Title)
    {
        HUD->DrawText(TEXT("READY"), Accent, CardX+S(34.0f), CardY+S(26.0f), nullptr, S(0.72f));
        DrawButton(TEXT("[ENTER]  PLAY"), CardY+S(70.0f), true);
        DrawButton(TEXT("[F1]  CONTROLS"), CardY+S(136.0f));
        DrawButton(TEXT("[F2]  SETTINGS"), CardY+S(202.0f));
        DrawButton(TEXT("[Q / ESC]  QUIT"), CardY+S(286.0f), false, true);
    }
    else if (Screen == EPhantomShellScreen::Pause)
    {
        HUD->DrawText(TEXT("PAUSED"), FLinearColor::White, CardX+S(34.0f), CardY+S(26.0f), nullptr, S(1.05f));
        DrawButton(TEXT("[ENTER / ESC]  RESUME"), CardY+S(88.0f), true);
        DrawButton(TEXT("[F1]  CONTROLS"), CardY+S(154.0f));
        DrawButton(TEXT("[F2]  SETTINGS"), CardY+S(220.0f));
        DrawButton(TEXT("[Q]  QUIT TO DESKTOP"), CardY+S(304.0f), false, true);
    }
    else if (Screen == EPhantomShellScreen::Controls)
    {
        HUD->DrawText(TEXT("CONTROLS"), FLinearColor::White, CardX+S(34.0f), CardY+S(26.0f), nullptr, S(1.04f));
        HUD->DrawText(Controls, FLinearColor(0.84f,0.90f,0.95f), CardX+S(36.0f), CardY+S(90.0f), nullptr, S(0.78f));
        DrawButton(TEXT("[ENTER / ESC]  BACK"), CardY+CardH-S(76.0f), true);
    }
    else if (Screen == EPhantomShellScreen::Settings)
    {
        HUD->DrawText(TEXT("SETTINGS"), FLinearColor::White, CardX+S(34.0f), CardY+S(26.0f), nullptr, S(1.04f));
        HUD->DrawText(FString::Printf(TEXT("MASTER VOLUME     %d%%"), FMath::RoundToInt(Director->GetMasterVolume()*100.0f)), FLinearColor::White, CardX+S(36.0f), CardY+S(104.0f), nullptr, S(0.82f));
        HUD->DrawRect(FLinearColor(0.075f,0.095f,0.12f), CardX+S(36.0f), CardY+S(145.0f), S(480.0f), S(12.0f));
        HUD->DrawRect(Accent, CardX+S(36.0f), CardY+S(145.0f), S(480.0f)*Director->GetMasterVolume(), S(12.0f));
        HUD->DrawText(FString::Printf(TEXT("GRAPHICS QUALITY  %s"), *Director->GetGraphicsQualityLabel()), FLinearColor::White, CardX+S(36.0f), CardY+S(212.0f), nullptr, S(0.82f));
        HUD->DrawText(TEXT("LEFT / RIGHT  volume      UP / DOWN  graphics"), Muted, CardX+S(36.0f), CardY+S(262.0f), nullptr, S(0.68f));
        DrawButton(TEXT("[ENTER / ESC]  BACK"), CardY+CardH-S(76.0f), true);
    }
    return true;
}
