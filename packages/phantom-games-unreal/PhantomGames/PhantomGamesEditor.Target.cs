using UnrealBuildTool;
using System.Collections.Generic;

public class PhantomGamesEditorTarget : TargetRules
{
    public PhantomGamesEditorTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Editor;
        DefaultBuildSettings = BuildSettingsVersion.Latest;
        IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
        bOverrideBuildEnvironment = true;
        ExtraModuleNames.Add("PhantomGames");
        GlobalDefinitions.Add("PHANTOM_DEFAULT_GAME=TEXT(\"phantom-strike\")");
    }
}
