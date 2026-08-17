using UnrealBuildTool;
using System.Collections.Generic;

public class PhantomAgesTarget : TargetRules
{
    public PhantomAgesTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Game;
        DefaultBuildSettings = BuildSettingsVersion.Latest;
        IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
        bOverrideBuildEnvironment = true;
        ExtraModuleNames.Add("PhantomGames");
        GlobalDefinitions.Add("PHANTOM_DEFAULT_GAME=TEXT(\"phantom-ages\")");
    }
}
