param(
    [string]$EngineRoot = 'H:\UE_5.8',
    [ValidatePattern('^V[0-9]+R[0-9]+$')][string]$Revision = 'V11R3'
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path -LiteralPath (Split-Path -Parent $PSScriptRoot)).Path
$Project = Join-Path $ProjectRoot 'PhantomGames.uproject'
$CandidateRoot = [IO.Path]::GetFullPath((Join-Path $ProjectRoot "CandidateBuilds\$Revision"))
$ArtifactRoot = [IO.Path]::GetFullPath((Join-Path $ProjectRoot "BuildArtifacts\$Revision"))
$RunUat = Join-Path $EngineRoot 'Engine\Build\BatchFiles\RunUAT.bat'

foreach($TargetPath in @($CandidateRoot,$ArtifactRoot)){
    if(-not $TargetPath.StartsWith($ProjectRoot,[StringComparison]::OrdinalIgnoreCase)){
        throw "Unsafe $Revision candidate target: $TargetPath"
    }
    if(Test-Path -LiteralPath $TargetPath){
        Remove-Item -LiteralPath $TargetPath -Recurse -Force
    }
    New-Item -ItemType Directory -Path $TargetPath -Force | Out-Null
}

$Games = @(
    @{Id='phantom-strike';Target='PhantomStrike';Executable='PhantomStrike.exe'},
    @{Id='phantom-ages';Target='PhantomAges';Executable='PhantomAges.exe'},
    @{Id='phantom-legends';Target='PhantomLegends';Executable='PhantomLegends.exe'},
    @{Id='cubetown';Target='Cubetown';Executable='Cubetown.exe'}
)

foreach($Game in $Games){
    $Archive = Join-Path $ArtifactRoot $Game.Id
    $Output = Join-Path $CandidateRoot $Game.Id
    Write-Host "${Revision}_PACKAGE_BEGIN $($Game.Id)" -ForegroundColor Cyan
    & $RunUat BuildCookRun "-project=$Project" "-target=$($Game.Target)" -noP4 -platform=Win64 -clientconfig=Shipping -build -nocompileeditor -cook -stage -pak -iostore -archive "-archivedirectory=$Archive" -utf8output
    if($LASTEXITCODE -ne 0){throw "$($Game.Target) packaging failed: $LASTEXITCODE"}
    $BuiltPlayer = Get-ChildItem -LiteralPath $Archive -Recurse -File -Filter $Game.Executable | Select-Object -First 1
    if(-not $BuiltPlayer){throw "Missing packaged executable $($Game.Executable)"}
    $PackageRoot = $BuiltPlayer.Directory
    while($PackageRoot.Parent -and $PackageRoot.FullName.StartsWith($Archive,[StringComparison]::OrdinalIgnoreCase) -and -not(Test-Path -LiteralPath (Join-Path $PackageRoot.FullName 'Engine'))){
        $PackageRoot = $PackageRoot.Parent
    }
    New-Item -ItemType Directory -Path $Output -Force | Out-Null
    Copy-Item -Path (Join-Path $PackageRoot.FullName '*') -Destination $Output -Recurse -Force
    if(-not(Test-Path -LiteralPath (Join-Path $Output $Game.Executable))){
        Copy-Item -LiteralPath $BuiltPlayer.FullName -Destination (Join-Path $Output $Game.Executable) -Force
    }
    Set-Content -LiteralPath (Join-Path $Output "PHANTOM_${Revision}_CANDIDATE.txt") -Encoding UTF8 -Value @(
        "PHANTOM $Revision CANDIDATE",
        "game=$($Game.Id)",
        "built=$([DateTime]::Now.ToString('s'))",
        'promotion=blocked_until_explicit_human_PROMOTE'
    )
    Write-Host "${Revision}_PACKAGE_PASS $($Game.Id)" -ForegroundColor Green
}

Write-Host "${Revision}_ALL_PACKAGES_PASS" -ForegroundColor Green
