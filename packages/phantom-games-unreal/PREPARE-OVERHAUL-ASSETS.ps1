param([string]$EngineRoot = $env:UNREAL_ENGINE_ROOT)
$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Project = Join-Path $ProjectRoot 'PhantomGames.uproject'
$ImportScript = Join-Path $ProjectRoot 'Tools\ImportOverhaulAssets.py'

function Find-UnrealRoot {
    if ($EngineRoot -and (Test-Path (Join-Path $EngineRoot 'Engine\Binaries\Win64\UnrealEditor-Cmd.exe'))) { return $EngineRoot }
    $Known = @('H:\UE_5.8','C:\Program Files\Epic Games\UE_5.8','D:\Epic Games\UE_5.8','E:\Epic Games\UE_5.8')
    foreach ($Candidate in $Known) {
        if (Test-Path (Join-Path $Candidate 'Engine\Binaries\Win64\UnrealEditor-Cmd.exe')) { return $Candidate }
    }
    $LauncherFile = Join-Path $env:ProgramData 'Epic\UnrealEngineLauncher\LauncherInstalled.dat'
    if (Test-Path $LauncherFile) {
        try {
            $Data = Get-Content $LauncherFile -Raw | ConvertFrom-Json
            foreach ($Install in $Data.InstallationList) {
                if ($Install.InstallLocation -and (Test-Path (Join-Path $Install.InstallLocation 'Engine\Binaries\Win64\UnrealEditor-Cmd.exe'))) { return $Install.InstallLocation }
            }
        } catch {}
    }
    return $null
}

$EngineRoot = Find-UnrealRoot
if (-not $EngineRoot) { throw 'Could not find Unreal Engine 5.8. Set UNREAL_ENGINE_ROOT or pass -EngineRoot.' }
$BuildBat = Join-Path $EngineRoot 'Engine\Build\BatchFiles\Build.bat'
$EditorCmd = Join-Path $EngineRoot 'Engine\Binaries\Win64\UnrealEditor-Cmd.exe'

Write-Host '=== PHANTOM OVERHAUL ASSET PREP ===' -ForegroundColor Cyan
Write-Host "Engine: $EngineRoot"
Write-Host 'Compiling editor module first...' -ForegroundColor Yellow
& $BuildBat PhantomGamesEditor Win64 Development $Project -WaitMutex -NoHotReload
if ($LASTEXITCODE -ne 0) { throw "PhantomGamesEditor compilation failed: $LASTEXITCODE" }

Write-Host 'Importing generated storybook/RTS/era meshes...' -ForegroundColor Yellow
& $EditorCmd $Project '-run=pythonscript' "-script=$ImportScript" -unattended -nop4 -nosplash -utf8output
if ($LASTEXITCODE -ne 0) { throw "Generated asset import failed: $LASTEXITCODE" }
Write-Host 'OVERHAUL ASSETS IMPORTED SUCCESSFULLY.' -ForegroundColor Green
