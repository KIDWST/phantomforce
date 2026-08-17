param(
    [int]$Seconds = 8
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Games = @(
    @{ Id = "phantom-strike"; Target = "PhantomStrike" },
    @{ Id = "phantom-ages"; Target = "PhantomAges" },
    @{ Id = "phantom-legends"; Target = "PhantomLegends" },
    @{ Id = "cubetown"; Target = "Cubetown" }
)

foreach ($Game in $Games) {
    $PackageRoot = Join-Path $ProjectRoot "Builds\Windows\$($Game.Id)"
    $Executable = Join-Path $PackageRoot "PhantomGames\Binaries\Win64\$($Game.Target)-Win64-Shipping.exe"
    if (-not (Test-Path $Executable)) {
        throw "Packaged player is missing: $Executable"
    }

    $Process = Start-Process `
        -FilePath $Executable `
        -ArgumentList @("-PhantomGame=$($Game.Id)", "-nullrhi", "-nosound", "-unattended", "-nosplash") `
        -WorkingDirectory $PackageRoot `
        -WindowStyle Hidden `
        -PassThru

    Start-Sleep -Seconds $Seconds
    if ($Process.HasExited) {
        throw "$($Game.Target) exited during startup with code $($Process.ExitCode)."
    }

    Stop-Process -Id $Process.Id
    Wait-Process -Id $Process.Id -ErrorAction SilentlyContinue
    Write-Host "$($Game.Target) remained healthy for $Seconds seconds."
}

Write-Host "Smoke-tested PhantomStrike, Phantom Ages, Phantom Legends, and Cubetown."
