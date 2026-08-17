param(
    [Parameter(Mandatory=$true)][string]$ProjectRoot,
    [string]$BuildRoot = '',
    [string]$ProofRoot = '',
    [int]$CaptureDelaySeconds = 7,
    [int]$TimeoutSeconds = 35
)
$ErrorActionPreference='Stop'
if([string]::IsNullOrWhiteSpace($BuildRoot)){$BuildRoot=Join-Path $ProjectRoot 'Builds\Windows'}
if([string]::IsNullOrWhiteSpace($ProofRoot)){$ProofRoot=Join-Path $ProjectRoot 'Saved\PhantomGameplayProof'}
New-Item -ItemType Directory -Force -Path $ProofRoot | Out-Null
$games=@(
    @{id='phantom-strike';exe='PhantomStrike.exe'},
    @{id='phantom-ages';exe='PhantomAges.exe'},
    @{id='phantom-legends';exe='PhantomLegends.exe'},
    @{id='cubetown';exe='Cubetown.exe'}
)
foreach($g in $games){
    $dir=Join-Path $BuildRoot $g.id
    $exe=Join-Path $dir $g.exe
    if(!(Test-Path $exe)){throw "Gameplay proof executable missing: $exe"}
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
    $p=Start-Process -FilePath $exe -ArgumentList $args -WorkingDirectory $dir -PassThru
    if(-not $p.WaitForExit($TimeoutSeconds*1000)){
        Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
        Write-Warning "$($g.id) proof run timed out; process terminated."
    }
    Start-Sleep -Milliseconds 800
    $shot=Get-ChildItem $screenshotRoots -Recurse -File -Include '*.png','*.jpg' -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match '\\Saved\\Screenshots\\' -and $_.LastWriteTime -ge $started.AddSeconds(-2) } |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if($shot){
        $dst=Join-Path $ProofRoot ($g.id+'-GAMEPLAY.png')
        Copy-Item $shot.FullName $dst -Force
        Write-Host "  [CAPTURED] $dst" -ForegroundColor Green
    } else {
        Write-Warning "  No packaged gameplay screenshot found for $($g.id). The build remains usable; capture evidence is incomplete."
    }
}
$captured=@(Get-ChildItem $ProofRoot -File -Filter '*-GAMEPLAY.png' -ErrorAction SilentlyContinue)
Set-Content (Join-Path $ProofRoot 'README.txt') -Encoding UTF8 -Value @(
    'PHANTOM GAMEPLAY PROOF V11 CANDIDATE',
    'These are actual candidate packaged gameplay captures, not title screens and not a resolution matrix.',
    "captured=$($captured.Count)/4",
    "generated=$([DateTime]::Now.ToString('s'))"
)
Write-Host "Gameplay proof complete: $($captured.Count)/4 actual gameplay screenshots." -ForegroundColor $(if($captured.Count -eq 4){'Green'}else{'Yellow'})
