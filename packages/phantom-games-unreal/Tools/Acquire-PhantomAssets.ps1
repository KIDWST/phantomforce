param(
  [string]$ProjectRoot = "",
  [switch]$AuditOnly
)
$ErrorActionPreference='Stop'
if(-not $ProjectRoot){$ProjectRoot=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path}
$Report=Join-Path $ProjectRoot 'PHANTOM_ASSET_REPORT.md'
$Manifest=Join-Path $ProjectRoot 'Config\PhantomAssetManifest.json'
$UProject=Join-Path $ProjectRoot 'PhantomGames.uproject'
if(!(Test-Path $UProject)){throw "PhantomGames.uproject not found: $UProject"}
if(!(Test-Path $Manifest)){throw "Asset manifest missing: $Manifest"}

$launcherCandidates=@(
  "$env:ProgramFiles(x86)\Epic Games\Launcher\Portal\Binaries\Win64\EpicGamesLauncher.exe",
  "$env:ProgramFiles\Epic Games\Launcher\Portal\Binaries\Win64\EpicGamesLauncher.exe"
)
$Launcher=$launcherCandidates|Where-Object{Test-Path $_}|Select-Object -First 1
$EngineRoots=@()
if(Test-Path 'C:\Program Files\Epic Games'){
  $EngineRoots += Get-ChildItem 'C:\Program Files\Epic Games' -Directory -ErrorAction SilentlyContinue | Where-Object {$_.Name -like 'UE_*'} | Select-Object -ExpandProperty FullName
}
if($env:UNREAL_ENGINE_ROOT -and (Test-Path $env:UNREAL_ENGINE_ROOT)){$EngineRoots=@($env:UNREAL_ENGINE_ROOT)+$EngineRoots}
$Editor=$EngineRoots|ForEach-Object{Join-Path $_ 'Engine\Binaries\Win64\UnrealEditor.exe'}|Where-Object{Test-Path $_}|Select-Object -First 1
$FabPlugin=$EngineRoots|ForEach-Object{Join-Path $_ 'Engine\Plugins\Marketplace\Fab\Fab.uplugin'}|Where-Object{Test-Path $_}|Select-Object -First 1
$FabCache=Join-Path $env:LOCALAPPDATA 'Temp\FabLibrary'
$MegascansDirs=@(
  (Join-Path $ProjectRoot 'Content\Megascans'),
  (Join-Path $ProjectRoot 'Content\Fab'),
  (Join-Path $ProjectRoot 'Content\Quixel')
)
$Imported=@()
foreach($D in $MegascansDirs){if(Test-Path $D){$Imported += Get-ChildItem $D -Recurse -File -ErrorAction SilentlyContinue}}
$CacheFiles=@()
if(Test-Path $FabCache){$CacheFiles=Get-ChildItem $FabCache -Recurse -File -ErrorAction SilentlyContinue}

$Lines=@(
 '# PHANTOM ASSET REPORT',
 '',
 "Generated: $([DateTime]::Now.ToString('s'))",
 '',
 '## Official Fab integration status',
 "- Epic Games Launcher: $(if($Launcher){$Launcher}else{'NOT FOUND'})",
 "- Unreal Editor: $(if($Editor){$Editor}else{'NOT FOUND'})",
 "- Fab plugin: $(if($FabPlugin){$FabPlugin}else{'NOT DETECTED'})",
 "- Fab cache: $FabCache",
 "- Cache files detected: $($CacheFiles.Count)",
 "- Imported Fab/Megascans files detected in project: $($Imported.Count)",
 '',
 '## Policy',
 '- Only FREE or ALREADY-OWNED/ENTITLED assets are allowed.',
 '- This script never reads browser cookies, exports tokens, scrapes protected CDN URLs, or purchases paid listings.',
 '- Acquisition uses the authenticated Fab/Epic UI; this script inventories and verifies what reaches the project.',
 '',
 '## Search packs',
 'See Config/PhantomAssetManifest.json for the exact per-game search packs.',
 '',
 '## Imported candidates'
)
$Lines += $Imported|Select-Object -First 200|ForEach-Object{"- $($_.FullName.Substring($ProjectRoot.Length+1))"}
if($Imported.Count-eq0){$Lines+='- None detected yet. Existing bundled/generated assets remain valid fallbacks.'}
Set-Content $Report $Lines -Encoding UTF8
Write-Host "[FAB AUDIT] $Report" -ForegroundColor Cyan

if(!$AuditOnly){
  Write-Host 'Opening the official signed-in Fab/Quixel workflow and the Unreal project.' -ForegroundColor Green
  Start-Process 'https://www.fab.com/sellers/Quixel%20Megascans'
  if($Launcher){Start-Process $Launcher}
  if($Editor){Start-Process $Editor -ArgumentList "`"$UProject`""}
  Write-Host 'Use Fab/Launcher batch download/export or the Fab window in Unreal for FREE/OWNED assets listed in the manifest.' -ForegroundColor Yellow
  Write-Host 'Run this script again with -AuditOnly after import to refresh PHANTOM_ASSET_REPORT.md.' -ForegroundColor Yellow
}
