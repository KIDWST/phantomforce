param(
    [string]$EngineRoot = $env:UNREAL_ENGINE_ROOT,
    [switch]$CompileOnly,
    [switch]$PackageWindows,
    [switch]$SmokeWindows,
    [switch]$SkipExternalCC0Assets,
    [switch]$SkipGameplayProof,
    [switch]$KeepExistingUnrealProcesses,
    [ValidatePattern('^V[0-9]+R[0-9]+$')][string]$CandidateLabel = 'V18R1',
    [switch]$CandidateOnly,
    [switch]$SkipContentRefresh,
    [ValidateRange(2,16)][int]$MaxParallelActions = 8,
    [switch]$FullSpeed
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if($SkipGameplayProof){throw 'Production approval cannot skip actual packaged gameplay proof. Remove -SkipGameplayProof.'}
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent (Split-Path -Parent $ProjectRoot)
$RepoParent = Split-Path -Parent ([System.IO.Path]::GetFullPath($RepoRoot).TrimEnd('\', '/'))
if ((Split-Path -Leaf $RepoParent) -ieq 'deployments') {
    throw "Refusing to build from the deployment checkout '$RepoRoot'. Create or use a development worktree, then run this build there."
}
$Project = Join-Path $ProjectRoot 'PhantomGames.uproject'
$Saved = Join-Path $ProjectRoot 'Saved'
New-Item -ItemType Directory -Force -Path $Saved | Out-Null

function Find-EpicUnrealEngineRoot {
    $ProgramDataRoot = if ($env:ProgramData) { $env:ProgramData } else { 'C:\ProgramData' }
    $ManifestRoot = Join-Path $ProgramDataRoot 'Epic\EpicGamesLauncher\Data\Manifests'
    if (Test-Path $ManifestRoot) {
        foreach ($ManifestFile in Get-ChildItem $ManifestRoot -File -Filter '*.item' -ErrorAction SilentlyContinue) {
            try {
                $Manifest = Get-Content $ManifestFile.FullName -Raw | ConvertFrom-Json
                $IsEngine = $Manifest.AppName -like 'UE_*' -or $Manifest.LaunchExecutable -match 'UnrealEditor\.exe$' -or $Manifest.AppCategories -contains 'engines/ue5'
                if (-not $IsEngine -or -not $Manifest.InstallLocation) { continue }
                $Exe = Join-Path $Manifest.InstallLocation 'Engine\Binaries\Win64\UnrealEditor.exe'
                if (Test-Path $Exe) { return $Manifest.InstallLocation }
            } catch {}
        }
    }
    foreach ($Known in @('H:\UE_5.8','C:\Program Files\Epic Games\UE_5.8','D:\Epic Games\UE_5.8','E:\Epic Games\UE_5.8')) {
        if (Test-Path (Join-Path $Known 'Engine\Binaries\Win64\UnrealEditor.exe')) { return $Known }
    }
    $Epic='C:\Program Files\Epic Games'
    if(Test-Path $Epic){
        $d=Get-ChildItem $Epic -Directory -Filter 'UE_*' -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Where-Object {Test-Path (Join-Path $_.FullName 'Engine\Binaries\Win64\UnrealEditor.exe')} | Select-Object -First 1
        if($d){return $d.FullName}
    }
    return $null
}


function Configure-LocalBuildThrottle {
    if($FullSpeed){
        Write-Host 'Build throttle: FullSpeed requested; leaving process priority unchanged.' -ForegroundColor Yellow
        return
    }
    try {
        [System.Diagnostics.Process]::GetCurrentProcess().PriorityClass = [System.Diagnostics.ProcessPriorityClass]::BelowNormal
    } catch { Write-Warning "Could not lower orchestrator priority: $($_.Exception.Message)" }
    $UbtDir=Join-Path $Saved 'UnrealBuildTool'
    New-Item -ItemType Directory -Force -Path $UbtDir | Out-Null
    $Config=Join-Path $UbtDir 'BuildConfiguration.xml'
    @"
<?xml version="1.0" encoding="utf-8"?>
<Configuration xmlns="https://www.unrealengine.com/BuildConfiguration">
  <BuildConfiguration>
    <MaxParallelActions>$MaxParallelActions</MaxParallelActions>
    <bAllCores>false</bAllCores>
  </BuildConfiguration>
</Configuration>
"@ | Set-Content $Config -Encoding UTF8
    Write-Host "Build throttle: BelowNormal priority + MaxParallelActions=$MaxParallelActions (use -FullSpeed to opt out)." -ForegroundColor DarkYellow
}

function Enable-InstalledBuildNetFxCompatibility {
    if ($env:UE_SDKS_ROOT) { return }
    $NetFxSdkRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\NETFXSDK'
    if (Test-Path $NetFxSdkRoot) {
        $Installed = Get-ChildItem $NetFxSdkRoot -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Where-Object { Test-Path (Join-Path $_.FullName 'Include\um\mscoree.h') } | Select-Object -First 1
        if($Installed){return}
    }
    if (-not (Test-Path (Join-Path $EngineRoot 'Engine\Build\InstalledBuild.txt'))) { return }
    $AutoSdkRoot = Join-Path $ProjectRoot '.autodsk'
    $Compat = Join-Path $AutoSdkRoot 'HostWin64\Win64\Windows Kits\NETFXSDK\4.6.2'
    $Header = Join-Path $Compat 'Include\um\mscoree.h'
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Header) | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $Compat 'lib\um\x64') | Out-Null
    if(-not (Test-Path $Header)){Set-Content $Header '// Installed-build discovery marker.'}
    $env:UE_SDKS_ROOT=$AutoSdkRoot
}

function Stop-ExistingUnrealOnce {
    if($KeepExistingUnrealProcesses){return}
    $running=@(Get-Process UnrealEditor,UnrealEditor-Cmd -ErrorAction SilentlyContinue)
    if($running.Count -gt 0){
        Write-Host "Closing $($running.Count) existing Unreal editor process(es) ONCE to prevent file locks." -ForegroundColor Yellow
        $running | Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
    }
}

function Invoke-NativeChecked([string]$Exe,[string[]]$Arguments,[string]$Label){
    Write-Host "[$Label] $Exe" -ForegroundColor Cyan
    & $Exe @Arguments
    if($LASTEXITCODE -ne 0){throw "$Label failed with exit code $LASTEXITCODE"}
}

function Invoke-PortfolioStaticValidators {
    $Python = Get-Command python.exe -ErrorAction SilentlyContinue
    if(-not $Python){throw 'Python 3 is required for the PhantomPlay portfolio validators.'}
    foreach($Validator in @('ValidatePortfolioGameplayV14.py','ValidateCubetownMemorycraftV16.py')){
        $Path = Join-Path $ProjectRoot ("Tools\"+$Validator)
        Invoke-NativeChecked $Python.Source @($Path) ("STATIC PORTFOLIO GATE "+$Validator)
    }
}

function Test-CuratedAssetLibrary {
    $Required=@(
        'Content\Phantom\External\CC0\Aliases\SM_CC0_Tree_A.uasset','Content\Phantom\UnityHarvest\Legends\character\U_Legends_0009_PineTrees.uasset',
        'Content\Phantom\External\CC0\Aliases\SM_CC0_Rock.uasset','Content\Phantom\External\CC0\Aliases\SM_CC0_Flower.uasset',
        'Content\Phantom\External\CC0\Aliases\SM_CC0_House_A.uasset','Content\Phantom\External\CC0\Aliases\SM_CC0_House_B.uasset',
        'Content\Phantom\External\CC0\Aliases\SM_CC0_CastleWall.uasset','Content\Phantom\External\CC0\Aliases\SM_CC0_CastleTower.uasset',
        'Content\Phantom\External\CC0\Aliases\SM_CC0_Bridge.uasset','Content\Phantom\External\CC0\Aliases\SM_CC0_Lantern.uasset',
        'Content\Phantom\Curated\Cube\SM_Cube_House_A.uasset','Content\Phantom\Curated\Cube\SM_Cube_House_B.uasset',
        'Content\Phantom\Curated\Cube\SM_Cube_Tavern.uasset','Content\Phantom\Curated\Cube\SM_Cube_Blacksmith.uasset',
        'Content\Phantom\Curated\Cube\SM_Cube_Well.uasset','Content\Phantom\Curated\Cube\SM_Cube_Bridge.uasset',
        'Content\Phantom\Curated\Legends\SM_Legends_Keep.uasset','Content\Phantom\Curated\Legends\SM_Legends_Tower.uasset',
        'Content\Phantom\Curated\Legends\SM_Legends_Wall.uasset','Content\Phantom\Curated\Legends\SM_Legends_Barracks.uasset',
        'Content\Phantom\Curated\Ages\SM_Ages_Tower.uasset','Content\Phantom\Curated\Ages\SM_Ages_Wall.uasset',
        'Content\Phantom\Curated\Strike\SM_Strike_Warehouse.uasset','Content\Phantom\Curated\Strike\SM_Strike_Container.uasset'
    )
    $Missing=@(); foreach($Rel in $Required){if(-not(Test-Path (Join-Path $ProjectRoot $Rel))){$Missing+=$Rel}}
    return $Missing
}

function Assert-ImportedContent {
    $Missing=@(Test-CuratedAssetLibrary)
    if($Missing.Count){throw "CURATED VISUAL GATE FAILED. Missing: $($Missing -join ', ')"}
    foreach($Rel in @(
        'Content\Phantom\Strike\AssaultRifle.uasset','Content\Phantom\Strike\Pistol.uasset',
        'Content\Phantom\Strike\House1.uasset','Content\Phantom\Strike\Street_Straight.uasset',
        'Content\Phantom\Characters\Production\SK_Knight.uasset','Content\Phantom\Characters\Production\SK_Rogue.uasset',
        'Content\Phantom\Characters\Production\SK_Barbarian.uasset','Content\Phantom\Characters\Production\SK_SkeletonWarrior.uasset',
        'Content\Phantom\Characters\Production\SK_SkeletonRogue.uasset','Content\Phantom\Characters\Production\SK_SkeletonMinion.uasset',
        'Content\Phantom\Materials\Production\M_Phantom_Grass.uasset','Content\Phantom\Materials\Production\M_Phantom_Dirt.uasset',
        'Content\Phantom\Materials\Production\M_Phantom_Asphalt.uasset','Content\Phantom\Materials\Production\M_Phantom_Concrete.uasset'
    )){if(-not(Test-Path (Join-Path $ProjectRoot $Rel))){throw "V11 production content missing: $Rel"}}

    foreach($Rel in @(
        'Content\Phantom\Worlds\CubeTown_World.umap','Content\Phantom\Worlds\PhantomAges_World.umap',
        'Content\Phantom\Worlds\PhantomLegends_World.umap','Content\Phantom\Worlds\PhantomStrike_World.umap'
    )){if(-not(Test-Path (Join-Path $ProjectRoot $Rel))){throw "V11 persistent production world missing: $Rel"}}

    $CharacterReport=Join-Path $Saved 'PhantomProductionCharactersV11.json'
    if(-not(Test-Path $CharacterReport)){throw 'V11 skeletal-character report missing.'}
    $CharacterData=Get-Content $CharacterReport -Raw | ConvertFrom-Json
    $ModularCharacters=@($CharacterData.results | Where-Object { $_.status -eq 'ok' -and [int]$_.modular_part_count -ge 5 -and $_.driver_part -eq 'Body' })
    if($CharacterData.status -ne 'PASS' -or [int]$CharacterData.characters_ok -lt 6 -or $ModularCharacters.Count -lt 6 -or [int]$CharacterData.animation_aliases -lt 18 -or [int]$CharacterData.animated_characters -lt 4){
        throw "V11 skeletal-character gate failed: status=$($CharacterData.status) characters=$($CharacterData.characters_ok) animation_aliases=$($CharacterData.animation_aliases) animated_characters=$($CharacterData.animated_characters)"
    }
    foreach($Character in @('Knight','Rogue','SkeletonWarrior','SkeletonRogue','SkeletonMinion')){
        foreach($Part in @('ArmLeft','ArmRight','Body','LegLeft','LegRight')){
            $PartFile=Join-Path $ProjectRoot "Content\Phantom\Characters\Production\Parts\SK_${Character}_${Part}.uasset"
            if(-not(Test-Path $PartFile)){throw "V11 modular-character part missing: $PartFile"}
        }
    }

    $MaterialReport=Join-Path $Saved 'PhantomPolyHavenMaterialImportV11.json'
    if(-not(Test-Path $MaterialReport)){throw 'V11 Poly Haven PBR-material report missing.'}
    $MaterialData=Get-Content $MaterialReport -Raw | ConvertFrom-Json
    if($MaterialData.status -ne 'PASS'){throw "V11 PBR material import failed: status=$($MaterialData.status)"}

    $WorldReport=Join-Path $Saved 'PhantomProductionWorldsV11.json'
    $PortfolioWorldReport=Join-Path $Saved 'PhantomPortfolioWorldsV13.json'
    $CubeTownV17Report=Join-Path $Saved 'CubeTownV17DioramaPatch.json'
    $WorldValidation=Join-Path $Saved 'PhantomProductionWorldValidationV11.json'
    foreach($r in @($WorldReport,$PortfolioWorldReport,$CubeTownV17Report,$WorldValidation)){if(-not(Test-Path $r)){throw "Production-world proof missing: $r"}}
    $WorldData=Get-Content $WorldReport -Raw | ConvertFrom-Json
    $PortfolioWorldData=Get-Content $PortfolioWorldReport -Raw | ConvertFrom-Json
    $CubeTownV17Data=Get-Content $CubeTownV17Report -Raw | ConvertFrom-Json
    $ValidationData=Get-Content $WorldValidation -Raw | ConvertFrom-Json
    if($WorldData.status -ne 'PASS' -or $PortfolioWorldData.status -ne 'PASS' -or $CubeTownV17Data.status -ne 'PASS' -or $ValidationData.status -ne 'PASS'){throw 'Production-world build, V13 portfolio patch, CubeTown V17 diorama patch, or density/occlusion validation failed.'}

    $OneShot=Join-Path $Saved 'PhantomOneShotEditorPipelineV11.txt'
    if(-not(Test-Path $OneShot)){throw 'V11 one-shot Unreal content pipeline report missing.'}
    $OneShotText=Get-Content $OneShot -Raw
    if($OneShotText -notmatch [regex]::Escape('PASS ImportOverhaulAssets.py') -and $OneShotText -notmatch [regex]::Escape('PASS committed Unreal generated-art library')){
        throw 'V11 one-shot Unreal content pipeline has neither a source import nor a verified committed generated-art library.'
    }
    if($OneShotText -notmatch [regex]::Escape('PASS ImportExternalCC0Assets.py')){
        $CuratedReport=Join-Path $Saved 'PhantomCuratedAssetImport.txt'
        if(-not(Test-Path $CuratedReport) -or (Get-Content $CuratedReport -Raw) -notmatch 'CURATED ASSET GATE: PASS'){
            throw 'V11 curated external asset import has no passing proof.'
        }
    }
    foreach($step in @('ImportProductionCharacters.py','ImportPolyHavenProduction.py')){
        $retainedLabel=if($step -eq 'ImportProductionCharacters.py'){'PASS retained production characters report'}else{'PASS retained Poly Haven materials report'}
        if($OneShotText -notmatch [regex]::Escape("PASS $step") -and $OneShotText -notmatch [regex]::Escape($retainedLabel)){
            throw "V11 one-shot Unreal content pipeline did not import or retain passing proof for $step"
        }
    }
    foreach($step in @('ImportUnityBaselineAssets.py','HarvestOwnedFabAssets.py','BuildProductionWorlds.py','PatchProductionWorldsV11R7.py','PatchProductionWorldsV11R10.py','PatchCubetownFlagshipV12.py','PatchPortfolioWorldsV13.py','RepairCubeTownV17Materials.py','PatchCubeTownV17Diorama.py','ValidateProductionWorlds.py')){
        if($OneShotText -notmatch [regex]::Escape("PASS $step")){throw "V11 one-shot Unreal content pipeline did not PASS $step"}
    }
    Write-Host "Four-game content gate PASS: all games received the V13 density/safety layer, and CubeTown retained its V17 diorama layer, rigged characters, PBR surfaces, and persistent worlds." -ForegroundColor Green
}

function Assert-UnityBaselineHarvest {
    $Manifest=Join-Path $Saved 'PhantomUnityBaselineInventory.json'
    if(-not(Test-Path $Manifest)){throw "Unity baseline harvest manifest missing: $Manifest"}
    $data=Get-Content $Manifest -Raw | ConvertFrom-Json
    $scriptCount=@($data.baseline_scripts).Count
    if($scriptCount -lt 3){throw "Expected at least the three Unity flagship gameplay baselines; found $scriptCount scripts."}
    Write-Host "Unity continuity PASS: $scriptCount baseline gameplay scripts discovered; $($data.asset_files_found) asset files scanned; $(@($data.selected_files).Count) selected." -ForegroundColor Green
}

if(-not $EngineRoot){$EngineRoot=Find-EpicUnrealEngineRoot}
if(-not $EngineRoot){throw 'Unreal Engine installation not found.'}
$EngineRoot=(Resolve-Path $EngineRoot).Path
Enable-InstalledBuildNetFxCompatibility
Configure-LocalBuildThrottle
Stop-ExistingUnrealOnce
Invoke-PortfolioStaticValidators

$BuildTool=Join-Path $EngineRoot 'Engine\Build\BatchFiles\Build.bat'
$RunUat=Join-Path $EngineRoot 'Engine\Build\BatchFiles\RunUAT.bat'
$EditorCmd=Join-Path $EngineRoot 'Engine\Binaries\Win64\UnrealEditor-Cmd.exe'
foreach($f in @($BuildTool,$RunUat,$EditorCmd)){if(-not(Test-Path $f)){throw "Required UE tool missing: $f"}}

if($SmokeWindows){ & (Join-Path $ProjectRoot 'Smoke-Flagships.ps1'); exit $LASTEXITCODE }

Write-Host '=====================================================================' -ForegroundColor Cyan
Write-Host " PHANTOM GAMES $CandidateLabel // RECOVERED PORTFOLIO // REAL CHARACTERS + REAL WORLDS + HUMAN APPROVAL" -ForegroundColor Cyan
Write-Host ' NO GENERATED-ART DOMINANCE // SKELETAL GAMEPLAY // PBR SURFACES // CANDIDATE-ONLY UNTIL APPROVED' -ForegroundColor Cyan
Write-Host '=====================================================================' -ForegroundColor Cyan
Write-Host "Engine: $EngineRoot"
Write-Host 'QA policy: package game -> auto-enter gameplay -> ONE 1920x1080 screenshot. No resolution matrix.' -ForegroundColor Yellow
Write-Host "PC load policy: below-normal orchestrator priority and MaxParallelActions=$MaxParallelActions." -ForegroundColor Yellow

if($SkipContentRefresh){
    Write-Host 'Using the existing verified content state; acquisition and reimport are skipped.' -ForegroundColor Yellow
    Assert-UnityBaselineHarvest
    Assert-ImportedContent
} else {
    # 0.5) Discover already-installed Epic/Fab samples and project content once. This is an audit only;
    # owned/imported project assets are actually curated later by HarvestOwnedFabAssets.py.
    $EpicAudit=Join-Path $ProjectRoot 'Tools\Audit-InstalledEpicContent.ps1'
    if(Test-Path $EpicAudit){try{& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $EpicAudit -ProjectRoot $ProjectRoot | Out-Host}catch{Write-Warning $_.Exception.Message}}

    # 1) Refresh current creator libraries and production PBR surface sources.
    if($SkipExternalCC0Assets){throw 'V11 refuses -SkipExternalCC0Assets because max-fidelity candidates require the current creator asset baseline.'}
    $Acquire=Join-Path $ProjectRoot 'Tools\AcquireCC0Assets.ps1'
    Invoke-NativeChecked 'powershell.exe' @('-NoProfile','-ExecutionPolicy','Bypass','-File',$Acquire,'-ProjectRoot',$ProjectRoot) 'CURRENT CREATOR ASSET ACQUISITION'
    $PolyAcquire=Join-Path $ProjectRoot 'Tools\AcquirePolyHavenProduction.ps1'
    Invoke-NativeChecked 'powershell.exe' @('-NoProfile','-ExecutionPolicy','Bypass','-File',$PolyAcquire,'-ProjectRoot',$ProjectRoot) 'POLY HAVEN PBR PRODUCTION ACQUISITION'

    # 2) Recover what already existed in the Unity version instead of pretending the Unreal rewrite started from zero.
    $UnityHarvest=Join-Path $ProjectRoot 'Tools\HarvestUnityBaseline.ps1'
    Invoke-NativeChecked 'powershell.exe' @('-NoProfile','-ExecutionPolicy','Bypass','-File',$UnityHarvest,'-ProjectRoot',$ProjectRoot) 'UNITY BASELINE HARVEST'
    Assert-UnityBaselineHarvest

    # 3) Acquire current Poly Haven CC0 PBR surfaces, then compile editor exactly once.
    Invoke-NativeChecked $BuildTool @('PhantomGamesEditor','Win64','Development',$Project,'-WaitMutex','-NoHotReload') 'UNREAL EDITOR MODULE COMPILE'

    # 4) ONE UnrealEditor-Cmd session: baseline library -> creator packs -> skeletal characters -> PBR -> Unity -> owned Fab -> base worlds -> V11R7/V11R10 -> CubeTown V12 -> four-game V13 -> CubeTown V17 -> validation.
    $Pipeline=Join-Path $ProjectRoot 'Tools\PhantomOneShotEditorPipeline.py'
    Remove-Item (Join-Path $Saved 'PhantomOneShotEditorPipelineV11.txt') -Force -ErrorAction SilentlyContinue
    Invoke-NativeChecked $EditorCmd @($Project,"-ExecutePythonScript=$Pipeline",'-unattended','-nop4','-nosplash','-NoSound','-utf8output') 'ONE-SHOT CONTENT IMPORT'
    Assert-ImportedContent
}

$Games=@(
    @{Id='phantom-strike';Target='PhantomStrike';Executable='PhantomStrike.exe'},
    @{Id='phantom-ages';Target='PhantomAges';Executable='PhantomAges.exe'},
    @{Id='phantom-legends';Target='PhantomLegends';Executable='PhantomLegends.exe'},
    @{Id='cubetown';Target='Cubetown';Executable='Cubetown.exe'}
)

if($CompileOnly -and -not $PackageWindows){
    foreach($Game in $Games){Invoke-NativeChecked $BuildTool @($Game.Target,'Win64','Development',$Project,'-WaitMutex','-NoHotReload') ("COMPILE "+$Game.Target)}
    Write-Host "$CandidateLabel compile-only PASS." -ForegroundColor Green
    exit 0
}

# 5) V11 TRANSACTIONAL CANDIDATE PACKAGING.
# Never delete the live PhantomPlay game first. Build into an isolated candidate root, launch that
# candidate directly, take ONE real gameplay frame, and only promote after the visual gate passes.
$CandidateRoot=Join-Path $ProjectRoot ("CandidateBuilds\"+$CandidateLabel)
$ArtifactRoot=Join-Path $ProjectRoot ("BuildArtifacts\"+$CandidateLabel)
$CandidateProofRoot=Join-Path $Saved ("PhantomGameplayProof"+$CandidateLabel+"Candidates")
foreach($Path in @($CandidateRoot,$ArtifactRoot,$CandidateProofRoot)){
    if(Test-Path $Path){Remove-Item $Path -Recurse -Force}
    New-Item -ItemType Directory -Force -Path $Path | Out-Null
}

foreach($Game in $Games){
    $Archive=Join-Path $ArtifactRoot $Game.Id
    $Output=Join-Path $CandidateRoot $Game.Id
    if(Test-Path $Archive){Remove-Item $Archive -Recurse -Force}
    if(Test-Path $Output){Remove-Item $Output -Recurse -Force}
    Write-Host "[CANDIDATE PACKAGE] $($Game.Id)" -ForegroundColor Cyan
    & $RunUat BuildCookRun -project="$Project" "-target=$($Game.Target)" -noP4 -platform=Win64 -clientconfig=Shipping -build -nocompileeditor -cook -stage -pak -iostore -archive -archivedirectory="$Archive" -utf8output
    if($LASTEXITCODE -ne 0){throw "$($Game.Target) candidate packaging failed with exit code $LASTEXITCODE"}
    $BuiltPlayer=Get-ChildItem $Archive -Recurse -File -Filter $Game.Executable | Select-Object -First 1
    if(-not $BuiltPlayer){throw "$($Game.Executable) not found under $Archive"}
    New-Item -ItemType Directory -Force -Path $Output | Out-Null
    $PackageRoot=$BuiltPlayer.Directory
    while($PackageRoot.Parent -and $PackageRoot.FullName.StartsWith($Archive) -and -not(Test-Path (Join-Path $PackageRoot.FullName 'Engine'))){$PackageRoot=$PackageRoot.Parent}
    Copy-Item (Join-Path $PackageRoot.FullName '*') $Output -Recurse -Force
    if(-not(Test-Path (Join-Path $Output $Game.Executable))){Copy-Item $BuiltPlayer.FullName (Join-Path $Output $Game.Executable) -Force}
    Set-Content (Join-Path $Output ("PHANTOM_PRODUCTION_REBOOT_"+$CandidateLabel+"_CANDIDATE.txt")) -Encoding UTF8 -Value @(
        "PHANTOM PRODUCTION REBOOT $CandidateLabel CANDIDATE","game=$($Game.Id)","built=$([DateTime]::Now.ToString('s'))","engine=$EngineRoot",
        'promotion=blocked_until_gameplay_visual_gate_passes',
        'runtime_primitives=not_allowed_as_missing-art-fallback',
        'imported_asset_units=semantic_bounds_normalized'
    )
}

# 6) Exactly one actual gameplay screenshot per candidate. No title-screen/resolution-matrix busywork.
if(-not $SkipGameplayProof){
    $Capture=Join-Path $ProjectRoot 'Tools\Capture-GameplayProof.ps1'
    Invoke-NativeChecked 'powershell.exe' @(
        '-NoProfile','-ExecutionPolicy','Bypass','-File',$Capture,
        '-ProjectRoot',$ProjectRoot,'-BuildRoot',$CandidateRoot,'-ProofRoot',$CandidateProofRoot,
        '-CaptureDelaySeconds','12','-TimeoutSeconds','50'
    ) 'CANDIDATE ACTUAL GAMEPLAY PROOF'
}

$CandidateProofs=@(Get-ChildItem $CandidateProofRoot -File -Filter '*-GAMEPLAY.png' -ErrorAction SilentlyContinue)
if($CandidateProofs.Count -lt 4){
    throw "$CandidateLabel CANDIDATE GATE FAILED: expected 4 actual packaged gameplay screenshots, found $($CandidateProofs.Count). Live PhantomPlay builds were NOT replaced. Candidates remain at $CandidateRoot"
}

# 7) Objective frame sanity gate. This cannot judge fun, but it stops obviously blank/flat/black/
# prototype frames from silently replacing the user's current executable.
$VisualGate=Join-Path $ProjectRoot 'Tools\Test-GameplayFrame.ps1'
Invoke-NativeChecked 'powershell.exe' @(
    '-NoProfile','-ExecutionPolicy','Bypass','-File',$VisualGate,
    '-ProofRoot',$CandidateProofRoot
) 'CANDIDATE VISUAL SANITY GATE'

# 8) HUMAN APPROVAL IS REQUIRED. Metrics cannot decide whether a game is actually appealing.
# Open the four real candidate gameplay screenshots and refuse to replace live PhantomPlay unless the user explicitly approves them.
Write-Host ''
Write-Host "$CandidateLabel AUTOMATED GATES PASSED. LIVE PHANTOMPLAY BUILDS ARE STILL UNTOUCHED." -ForegroundColor Yellow
Write-Host "Review the four actual gameplay screenshots here: $CandidateProofRoot" -ForegroundColor Yellow
if($CandidateOnly){
    Set-Content (Join-Path $CandidateRoot ($CandidateLabel+'_READY_FOR_REVIEW.txt')) -Encoding UTF8 -Value @(
        "$CandidateLabel candidates built and passed automated structural/frame checks.",
        'Live PhantomPlay builds were intentionally left untouched.',
        "screenshots=$CandidateProofRoot"
    )
    Write-Host "$CandidateLabel candidate-only pass complete. Live builds unchanged." -ForegroundColor Green
    exit 0
}
try { Start-Process explorer.exe $CandidateProofRoot } catch {}
$Approval=Read-Host 'Type PROMOTE only if YOU personally approve all four screenshots. Anything else keeps the candidates separate'
if($Approval -cne 'PROMOTE'){
    Set-Content (Join-Path $CandidateRoot ($CandidateLabel+'_NOT_PROMOTED.txt')) -Encoding UTF8 -Value @(
        "$CandidateLabel candidates built and passed automated structural/frame checks.",
        'Live PhantomPlay builds were intentionally NOT replaced because human visual approval was not given.',
        "screenshots=$CandidateProofRoot"
    )
    Write-Host "$CandidateLabel candidates preserved. Live builds unchanged." -ForegroundColor Green
    Write-Host "Candidates: $CandidateRoot" -ForegroundColor Green
    Write-Host "Screenshots: $CandidateProofRoot" -ForegroundColor Green
    exit 0
}

# 9) Promote only after explicit human approval. Existing live games are backed up atomically before replacement.
$LiveRoot=Join-Path $ProjectRoot 'Builds\Windows'
$RollbackRoot=Join-Path $ProjectRoot ("Builds\Rollback\"+$CandidateLabel+'-'+[DateTime]::Now.ToString('yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Force -Path $RollbackRoot | Out-Null
New-Item -ItemType Directory -Force -Path $LiveRoot | Out-Null

foreach($Game in $Games){
    $Live=Join-Path $LiveRoot $Game.Id
    if(Test-Path $Live){
        Move-Item $Live (Join-Path $RollbackRoot $Game.Id) -Force
    }
}
try{
    foreach($Game in $Games){
        $Live=Join-Path $LiveRoot $Game.Id
        $Candidate=Join-Path $CandidateRoot $Game.Id
        New-Item -ItemType Directory -Force -Path $Live | Out-Null
        Copy-Item (Join-Path $Candidate '*') $Live -Recurse -Force
        if(-not(Test-Path (Join-Path $Live $Game.Executable))){throw "Promotion copy missing $($Game.Executable) for $($Game.Id)"}
        Set-Content (Join-Path $Live ("PHANTOM_PRODUCTION_REBOOT_"+$CandidateLabel+"_BUILD.txt")) -Encoding UTF8 -Value @(
            "PHANTOM PRODUCTION REBOOT $CandidateLabel","game=$($Game.Id)","promoted=$([DateTime]::Now.ToString('s'))",
            "rollback=$RollbackRoot",'visual_gate=passed','gameplay_capture=passed'
        )
    }
}catch{
    Write-Host "Promotion copy failed; restoring previous live builds from $RollbackRoot" -ForegroundColor Red
    foreach($Game in $Games){
        $Live=Join-Path $LiveRoot $Game.Id
        $Old=Join-Path $RollbackRoot $Game.Id
        if(Test-Path $Live){Remove-Item $Live -Recurse -Force -ErrorAction SilentlyContinue}
        if(Test-Path $Old){Move-Item $Old $Live -Force}
    }
    throw
}

$FinalProofRoot=Join-Path $Saved 'PhantomGameplayProof'
if(Test-Path $FinalProofRoot){Remove-Item $FinalProofRoot -Recurse -Force}
Copy-Item $CandidateProofRoot $FinalProofRoot -Recurse -Force
Write-Host "$CandidateLabel PROMOTION PASS: candidate builds replaced live builds only after 4/4 gameplay frames passed." -ForegroundColor Green
Write-Host "Rollback: $RollbackRoot" -ForegroundColor DarkGreen

$Audit=Join-Path $ProjectRoot 'Tools\Audit-PhantomBuildPaths.ps1'
if(Test-Path $Audit){try{& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Audit -ProjectRoot $ProjectRoot | Out-Host}catch{Write-Warning $_.Exception.Message}}

$ProofCount=@(Get-ChildItem (Join-Path $Saved 'PhantomGameplayProof') -File -Filter '*-GAMEPLAY.png' -ErrorAction SilentlyContinue).Count
Set-Content (Join-Path $Saved ("PHANTOM_PRODUCTION_REBOOT_"+$CandidateLabel+"_REPORT.txt")) -Encoding UTF8 -Value @(
    "PHANTOM PRODUCTION REBOOT $CandidateLabel COMPLETE",
    "built=$([DateTime]::Now.ToString('s'))",
    "engine=$EngineRoot",
    "actual_gameplay_captures=$ProofCount/4",
    'editor_content_sessions=1',
    'multi_resolution_qa=disabled',
    'transactional_candidate_promotion=enabled',
    'semantic_asset_scale_normalization=enabled',
    'arbitrary_static_character_aliases=demoted',
    'engine_primitive_missing_art_fallback=disabled',
    'persistent_umap_worlds=verified',
    'human_approval_before_promotion=enabled',
    'production_reboot=real_rigged_characters_pbr_persistent_worlds_no_basicshape_worlds',
    'human_visual_approval=explicit_PROMOTE_required'
)
Write-Host '=====================================================================' -ForegroundColor Green
Write-Host " $CandidateLabel PROMOTED // $ProofCount/4 CANDIDATE GAMEPLAY FRAMES PASSED" -ForegroundColor Green
Write-Host " Proof: $(Join-Path $Saved 'PhantomGameplayProof')" -ForegroundColor Green
Write-Host '=====================================================================' -ForegroundColor Green
