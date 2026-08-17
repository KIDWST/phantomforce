using UnrealBuildTool;

public class PhantomGames : ModuleRules
{
    public PhantomGames(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
        PublicDependencyModuleNames.AddRange(new[]
        {
            "Core",
            "CoreUObject",
            "Engine",
            "InputCore",
            "UMG"
        });
        PrivateDependencyModuleNames.AddRange(new[]
        {
            "AIModule",
            "NavigationSystem",
            "Slate",
            "SlateCore"
        });
    }
}
