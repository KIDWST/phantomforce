param(
    [Parameter(Mandatory=$true)][string]$ProjectRoot,
    [string]$BuildRoot = '',
    [string]$ProofRoot = '',
    [int]$CaptureDelaySeconds = 7,
    [int]$TimeoutSeconds = 35,
    [string[]]$GameIds = @(),
    [ValidateSet('town','lair')][string]$CubetownCaptureMode = 'town',
    [ValidateSet('normal','dawn','shadowfall','restored','prologue','finale','aktarus','eclipse','postgame')][string]$ShadowbearerCaptureState = 'normal'
)
$ErrorActionPreference='Stop'
if([string]::IsNullOrWhiteSpace($BuildRoot)){$BuildRoot=Join-Path $ProjectRoot 'Builds\Windows'}
if([string]::IsNullOrWhiteSpace($ProofRoot)){$ProofRoot=Join-Path $ProjectRoot 'Saved\PhantomGameplayProof'}
New-Item -ItemType Directory -Force -Path $ProofRoot | Out-Null
$games=@(
    @{id='phantom-strike';exe='PhantomStrike.exe';shipping='PhantomStrike-Win64-Shipping.exe'},
    @{id='phantom-ages';exe='PhantomAges.exe';shipping='PhantomAges-Win64-Shipping.exe'},
    @{id='phantom-legends';exe='PhantomLegends.exe';shipping='PhantomLegends-Win64-Shipping.exe'},
    @{id='cubetown';exe='Cubetown.exe';shipping='Cubetown-Win64-Shipping.exe'}
)
if($GameIds.Count -gt 0){
    $requested=@($GameIds | ForEach-Object { $_.ToLowerInvariant() })
    $games=@($games | Where-Object { $requested -contains $_.id })
    if($games.Count -ne $requested.Count){throw "Unknown or duplicate gameplay proof game id: $($GameIds -join ', ')"}
}
foreach($g in $games){
    $dir=Join-Path $BuildRoot $g.id
    $bootstrapExe=Join-Path $dir $g.exe
    if(!(Test-Path $bootstrapExe)){throw "Gameplay proof executable missing: $bootstrapExe"}
    # The root executable is Unreal's bootstrapper. It starts the real Shipping process and exits
    # immediately, so waiting on it races the screenshot and can attribute one game's frame to the
    # next game. Launch the packaged Shipping binary directly and wait for the process that owns the
    # viewport and screenshot request.
    $shippingPath=Join-Path $dir ('PhantomGames\Binaries\Win64\'+$g.shipping)
    $shippingExe=Get-Item -LiteralPath $shippingPath -ErrorAction SilentlyContinue
    if(-not $shippingExe){throw "Gameplay proof Shipping executable missing: $shippingPath"}
    # Packaged Unreal may place Saved beside the executable, under the staged project folder,
    # or in the standard per-user LocalAppData project save. Candidate-local screenshots can
    # be cleared safely; per-user screenshots are preserved and filtered by this run's start time.
    Get-ChildItem $dir -Recurse -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match '\\Saved\\Screenshots($|\\)' } |
        ForEach-Object { Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }
    $screenshotRoots=@($dir)
    if(-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)){
        $userScreenshotRoot=Join-Path $env:LOCALAPPDATA 'PhantomGames\Saved\Screenshots'
        if(Test-Path $userScreenshotRoot){$screenshotRoots += $userScreenshotRoot}
    }
    $started=Get-Date
    Write-Host "[GAMEPLAY PROOF] $($g.id): launch -> auto-enter gameplay -> wait -> screenshot -> quit" -ForegroundColor Cyan
    $args=@('-windowed','-ResX=1920','-ResY=1080','-NoSplash','-PhantomAutoStart','-PhantomGameplayCapture','-PhantomAutoQuit',("-PhantomCaptureDelay="+$CaptureDelaySeconds))
    if($g.id -eq 'cubetown' -and $CubetownCaptureMode -eq 'lair'){$args += '-PhantomLairCapture'}
    if($g.id -eq 'cubetown' -and $ShadowbearerCaptureState -ne 'normal'){
        $args += ("-ShadowbearerCaptureState="+$ShadowbearerCaptureState)
    }elseif($g.id -eq 'cubetown' -and $CubetownCaptureMode -eq 'town'){
        # The canonical prologue is proved separately. The four-game visual gate must inspect
        # unobstructed active play rather than rejecting a deliberately letterboxed cutscene.
        $args += '-ShadowbearerCaptureState=dawn'
    }
    $p=Start-Process -FilePath $shippingExe.FullName -ArgumentList $args -WorkingDirectory $dir -PassThru
    $timedOut=$false
    if(-not $p.WaitForExit($TimeoutSeconds*1000)){
        $timedOut=$true
        Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
        Write-Warning "$($g.id) gameplay proof timed out; Shipping process terminated."
    }
    Start-Sleep -Milliseconds 800
    $shot=Get-ChildItem $screenshotRoots -Recurse -File -Include '*.png','*.jpg' -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match '\\Saved\\Screenshots\\' -and $_.LastWriteTime -ge $started.AddSeconds(-2) } |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if($shot){
        $captureSuffix=if($g.id -eq 'cubetown' -and $ShadowbearerCaptureState -ne 'normal'){
            '-'+$ShadowbearerCaptureState.ToUpperInvariant()+'-GAMEPLAY.png'
        }elseif($g.id -eq 'cubetown' -and $CubetownCaptureMode -eq 'lair'){'-LAIR-GAMEPLAY.png'}else{'-GAMEPLAY.png'}
        $dst=Join-Path $ProofRoot ($g.id+$captureSuffix)
        Copy-Item $shot.FullName $dst -Force
        Write-Host "  [CAPTURED] $dst (source=$($shot.Name), process=$($shippingExe.Name))" -ForegroundColor Green
    } else {
        $exitDetail=if($timedOut){'timeout'}elseif($p.HasExited){"exit=$($p.ExitCode)"}else{'process state unavailable'}
        Write-Warning "  No packaged gameplay screenshot found for $($g.id) ($exitDetail). Candidate evidence FAILED."
    }
}
$captured=@(Get-ChildItem $ProofRoot -File -Filter '*-GAMEPLAY.png' -ErrorAction SilentlyContinue)
Set-Content (Join-Path $ProofRoot 'README.txt') -Encoding UTF8 -Value @(
    'PHANTOM GAMEPLAY PROOF V11 CANDIDATE',
    'These are actual candidate packaged gameplay captures, not title screens and not a resolution matrix.',
    "captured=$($captured.Count)/$($games.Count)",
    "generated=$([DateTime]::Now.ToString('s'))"
)
Write-Host "Gameplay proof complete: $($captured.Count)/$($games.Count) actual gameplay screenshots." -ForegroundColor $(if($captured.Count -eq $games.Count){'Green'}else{'Yellow'})
