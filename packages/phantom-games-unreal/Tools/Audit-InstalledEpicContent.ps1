param([string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot))
$ErrorActionPreference='SilentlyContinue'
$Saved=Join-Path $ProjectRoot 'Saved'
New-Item -ItemType Directory -Force -Path $Saved | Out-Null
$Out=Join-Path $Saved 'PhantomInstalledEpicContent.txt'
$Lines=New-Object System.Collections.Generic.List[string]
$Lines.Add('PHANTOM GAMES V11 // INSTALLED EPIC/FAB CONTENT AUDIT')
$Lines.Add(('scanned='+[DateTime]::Now.ToString('s')))
$Lines.Add('purpose=discover already-installed samples/vault content without scraping credentials or buying content')
$Lines.Add('')

$manifestRoot=Join-Path $env:ProgramData 'Epic\EpicGamesLauncher\Data\Manifests'
if(Test-Path $manifestRoot){
    foreach($f in Get-ChildItem $manifestRoot -File -Filter '*.item' -ErrorAction SilentlyContinue){
        try{
            $m=Get-Content $f.FullName -Raw | ConvertFrom-Json
            $text=(($m.DisplayName,$m.AppName,$m.InstallLocation,$m.CatalogItemId) -join ' ')
            if($text -match 'Lyra|City Sample|CitySample|Electric Dreams|Content Examples|Megascans|Quixel|Fab|Animation|Starter Game|Shooter'){
                $Lines.Add(('MANIFEST | {0} | {1} | {2}' -f $m.DisplayName,$m.AppName,$m.InstallLocation))
            }
        }catch{}
    }
}
$vaultCandidates=@(
    (Join-Path ${env:ProgramFiles} 'Epic Games\Launcher\VaultCache'),
    (Join-Path ${env:ProgramData} 'Epic\EpicGamesLauncher\VaultCache'),
    (Join-Path $env:LOCALAPPDATA 'Temp\FabLibrary')
)
foreach($root in $vaultCandidates){
    if(Test-Path $root){
        $Lines.Add(('ROOT | '+$root))
        foreach($d in Get-ChildItem $root -Directory -ErrorAction SilentlyContinue | Where-Object {$_.Name -match 'Lyra|City|Electric|Content|Mega|Quixel|Fab|Medieval|Fantasy|Environment|Animation|Shooter'} | Select-Object -First 100){
            $Lines.Add(('CONTENT | '+$d.FullName))
        }
    }
}
$projectContent=Join-Path $ProjectRoot 'Content'
if(Test-Path $projectContent){
    $fabLike=@(Get-ChildItem $projectContent -Recurse -File -Filter '*.uasset' -ErrorAction SilentlyContinue | Where-Object {$_.FullName -match 'Megascans|Quixel|Fab|Marketplace'} | Select-Object -First 250)
    $Lines.Add(('PROJECT_FAB_LIKE_UASSETS='+$fabLike.Count))
    foreach($x in $fabLike){$Lines.Add(('PROJECT | '+$x.FullName))}
}
$Lines | Set-Content $Out -Encoding UTF8
Write-Host "[EPIC/FAB AUDIT] $Out" -ForegroundColor DarkCyan
