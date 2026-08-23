[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Root,
    [ValidateRange(15, 90)][int]$TimeoutSeconds = 45
)

$ErrorActionPreference = 'Stop'
$ResolvedRoot = [IO.Path]::GetFullPath($Root).TrimEnd('\')
$Shipping = Join-Path $ResolvedRoot 'PhantomGames\Binaries\Win64\Cubetown-Win64-Shipping.exe'
$Proof = Join-Path $env:LOCALAPPDATA 'PhantomGames\Saved\ShadowbearerLocomotionProof.txt'
$SaveRoot = Join-Path $env:LOCALAPPDATA 'PhantomGames\Saved\SaveGames'
if (-not (Test-Path -LiteralPath $Shipping -PathType Leaf)) { throw "Shipping executable missing: $Shipping" }

function Get-SaveSnapshot {
    $Snapshot = [ordered]@{}
    foreach ($File in @(Get-ChildItem -LiteralPath $SaveRoot -File -ErrorAction SilentlyContinue)) {
        $Snapshot[$File.FullName] = [ordered]@{
            sha256 = (Get-FileHash -LiteralPath $File.FullName -Algorithm SHA256).Hash
            modified_utc = $File.LastWriteTimeUtc.ToString('o')
        }
    }
    return $Snapshot
}

$BeforeSaves = Get-SaveSnapshot
$StartedUtc = [DateTime]::UtcNow
$Arguments = @(
    '-PhantomGame=cubetown',
    '-PhantomAutoStart',
    '-ShadowbearerCaptureState=prologue',
    '-PhantomLocomotionProof',
    '-unattended',
    '-nosplash',
    '-nosound',
    '-windowed',
    '-ResX=1280',
    '-ResY=720'
)
$Process = Start-Process -FilePath $Shipping -ArgumentList $Arguments -WorkingDirectory $ResolvedRoot -WindowStyle Hidden -PassThru
if (-not $Process.WaitForExit($TimeoutSeconds * 1000)) {
    try { $Process.Kill($true) } catch {}
    throw "Packaged Shadowbearer runtime proof timed out after $TimeoutSeconds seconds."
}
if ($Process.ExitCode -ne 0) { throw "Packaged Shadowbearer runtime proof exited with code $($Process.ExitCode)." }
if (-not (Test-Path -LiteralPath $Proof -PathType Leaf)) { throw "Runtime proof file missing: $Proof" }
$ProofItem = Get-Item -LiteralPath $Proof
if ($ProofItem.LastWriteTimeUtc -le $StartedUtc) { throw 'Runtime proof file is stale.' }
$ProofText = (Get-Content -LiteralPath $Proof -Raw).Trim()
$RequiredProof = '^SHADOWBEARER STARTUP \+ LOCOMOTION \+ CHARACTER INTEGRITY RUNTIME PASS gameplay_ready=true prologue_exit=true move_input_ignored=false'
if ($ProofText -notmatch $RequiredProof) { throw "Packaged Shadowbearer runtime proof failed: $ProofText" }

$AfterSaves = Get-SaveSnapshot
if (($BeforeSaves | ConvertTo-Json -Compress -Depth 5) -cne ($AfterSaves | ConvertTo-Json -Compress -Depth 5)) {
    throw 'Packaged runtime proof changed the player save directory.'
}

[pscustomobject]@{
    status = 'passed'
    root = $ResolvedRoot
    proof_utc = $ProofItem.LastWriteTimeUtc.ToString('o')
    proof = $ProofText
    player_saves_unchanged = $true
} | ConvertTo-Json -Depth 5
