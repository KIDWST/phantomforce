param(
    [string]$ProjectRoot,
    [switch]$Force
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $ProjectRoot) { $ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path) }

$Root = Join-Path $ProjectRoot 'SourceArt\External\CC0'
$Downloads = Join-Path $Root 'Downloads'
New-Item -ItemType Directory -Force -Path $Downloads | Out-Null

# PHANTOM CURATED FREE-ASSET LIBRARY
# Core sources are CC0 and are intentionally pulled from first-party creator sites or the
# creator's public GitHub repositories. These are required because previous builds silently
# continued when third-party mirror URLs failed, leaving the games visually unchanged.
$packs = @(
    @{Name='KenneyNature'; Required=$true; Kind='zip'; Page='https://kenney.nl/assets/nature-kit'; Url='https://kenney.nl/media/pages/assets/nature-kit/37ac38a37b-1677698939/kenney_nature-kit.zip'; File='kenney_nature-kit.zip'; MinMB=2; License='CC0'; Source='Kenney'},
    @{Name='KenneyFantasyTown'; Required=$true; Kind='zip'; Page='https://kenney.nl/assets/fantasy-town-kit'; Url='https://kenney.nl/media/pages/assets/fantasy-town-kit/efe948d309-1754222374/kenney_fantasy-town-kit_2.0.zip'; File='kenney_fantasy-town-kit_2.0.zip'; MinMB=1; License='CC0'; Source='Kenney'},
    @{Name='KenneyCityCommercial'; Required=$true; Kind='zip'; Page='https://kenney.nl/assets/city-kit-commercial'; Url='https://kenney.nl/media/pages/assets/city-kit-commercial/a742d900eb-1753115042/kenney_city-kit-commercial_2.1.zip'; File='kenney_city-kit-commercial_2.1.zip'; MinMB=1; License='CC0'; Source='Kenney'},
    @{Name='KenneyCityIndustrial'; Required=$true; Kind='zip'; Page='https://kenney.nl/assets/city-kit-industrial'; Url='https://kenney.nl/media/pages/assets/city-kit-industrial/5fcb837741-1750838303/kenney_city-kit-industrial_1.0.zip'; File='kenney_city-kit-industrial_1.0.zip'; MinMB=0.5; License='CC0'; Source='Kenney'},
    @{Name='KenneyCastle'; Required=$true; Kind='zip'; Page='https://kenney.nl/assets/castle-kit'; Url=''; File='kenney_castle-kit_current.zip'; MinMB=0.5; License='CC0'; Source='Kenney'},

    @{Name='KayKitMedievalHex'; Required=$true; Kind='zip'; Url='https://github.com/KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0/archive/refs/heads/main.zip'; File='kaykit-medieval-hex-main.zip'; MinMB=1; License='CC0'; Source='KayKit GitHub'},
    @{Name='KayKitDungeon'; Required=$true; Kind='zip'; Url='https://github.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0/archive/refs/heads/main.zip'; File='kaykit-dungeon-main.zip'; MinMB=1; License='CC0'; Source='KayKit GitHub'},
    @{Name='KayKitAdventurers'; Required=$true; Kind='zip'; Url='https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0/archive/refs/heads/main.zip'; File='kaykit-adventurers-main.zip'; MinMB=1; License='CC0'; Source='KayKit GitHub'},
    @{Name='KayKitSkeletons'; Required=$true; Kind='zip'; Url='https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0/archive/refs/heads/main.zip'; File='kaykit-skeletons-main.zip'; MinMB=1; License='CC0'; Source='KayKit GitHub'},
    @{Name='KayKitCityBuilder'; Required=$true; Kind='zip'; Url='https://github.com/KayKit-Game-Assets/KayKit-City-Builder-Bits-1.0/archive/refs/heads/main.zip'; File='kaykit-city-builder-main.zip'; MinMB=0.2; License='CC0'; Source='KayKit GitHub'},

    # 2025-2026 Quaternius character/animation research sources. V8 stages these current CC0 packs
    # when the creator page exposes a downloadable ZIP, but intentionally does NOT flatten their
    # rigged FBX characters into StaticMeshes. They are inputs for a verified SkeletalMesh/retarget pass.
    @{Name='QuaterniusUniversalAnimations2'; Required=$false; Kind='zip'; Page='https://quaternius.com/packs/universalanimationlibrary2.html'; Url=''; File='quaternius_universal-animation-library-2_current.zip'; MinMB=1; License='CC0'; Source='Quaternius'},
    @{Name='QuaterniusUniversalBaseCharacters'; Required=$false; Kind='zip'; Page='https://quaternius.com/packs/universalbasecharacters.html'; Url=''; File='quaternius_universal-base-characters_current.zip'; MinMB=1; License='CC0'; Source='Quaternius'},
    @{Name='QuaterniusFantasyOutfits'; Required=$false; Kind='zip'; Page='https://quaternius.com/packs/modularcharacteroutfitsfantasy.html'; Url=''; File='quaternius_modular-fantasy-outfits_current.zip'; MinMB=1; License='CC0'; Source='Quaternius'},

    # Quaternius packs remain high-value variety. They are optional here because OpenGameArt mirrors
    # have occasionally moved; the required Kenney/KayKit library guarantees the build still changes.
    @{Name='MedievalVillageMega'; Required=$false; Kind='zip'; Url='https://opengameart.org/sites/default/files/medieval_village_megakitstandard.zip'; File='medieval_village_megakitstandard.zip'; MinMB=20; License='CC0'; Source='Quaternius/OpenGameArt mirror'},
    @{Name='MedievalVillageClassic'; Required=$false; Kind='zip'; Url='https://opengameart.org/sites/default/files/medieval_village_pack_-_dec_2020.zip'; File='medieval_village_pack_-_dec_2020.zip'; MinMB=1; License='CC0'; Source='Quaternius/OpenGameArt mirror'},
    @{Name='StylizedNatureMega'; Required=$false; Kind='zip'; Url='https://opengameart.org/sites/default/files/stylized_nature_megakitstandard.zip'; File='stylized_nature_megakitstandard.zip'; MinMB=20; License='CC0'; Source='Quaternius/OpenGameArt mirror'},
    @{Name='FantasyPropsMega'; Required=$false; Kind='zip'; Url='https://opengameart.org/sites/default/files/fantasy_props_megakitstandard.zip'; File='fantasy_props_megakitstandard.zip'; MinMB=10; License='CC0'; Source='Quaternius/OpenGameArt mirror'},
    @{Name='AnimatedCharacters'; Required=$false; Kind='zip'; Url='https://opengameart.org/sites/default/files/ultimate_animated_character_pack_by_quaternius.zip'; File='ultimate_animated_character_pack_by_quaternius.zip'; MinMB=5; License='CC0'; Source='Quaternius/OpenGameArt mirror'},
    @{Name='CuteMonsters'; Required=$false; Kind='zip'; Url='https://opengameart.org/sites/default/files/cute_animated_monsters_-_aug_2020.zip'; File='cute_animated_monsters_-_aug_2020.zip'; MinMB=3; License='CC0'; Source='Quaternius/OpenGameArt mirror'},
    @{Name='RPGCharacters'; Required=$false; Kind='zip'; Url='https://opengameart.org/sites/default/files/rpg_characters_-_nov_2020.zip'; File='rpg_characters_-_nov_2020.zip'; MinMB=2; License='CC0'; Source='Quaternius/OpenGameArt mirror'}
)

function Resolve-CurrentPackUrl($Pack) {
    # Kenney download URLs include content hashes/versioned filenames. Resolve the creator page at
    # install time so V8 does not freeze yesterday's URL as "latest". Any page parsing failure falls
    # back to the known-good first-party URL in the manifest.
    if ($Pack.ContainsKey('Page') -and $Pack['Page']) {
        try {
            Write-Host "[LATEST] resolving $($Pack.Name) from $($Pack['Page'])" -ForegroundColor DarkCyan
            $html = (Invoke-WebRequest -Uri $Pack['Page'] -UseBasicParsing -TimeoutSec 45 -Headers @{'User-Agent'='PhantomGamesAssetPipeline/11.0'}).Content
            $matches = [regex]::Matches($html, '(?:href=["''])([^"'']+\.zip)|https?://[^"''<>\s]+\.zip|/media/pages/[^"''<>\s]+\.zip')
            foreach ($m in $matches) {
                $u = if($m.Groups.Count -gt 1 -and $m.Groups[1].Success){$m.Groups[1].Value}else{$m.Value}
                $u = $u -replace '&amp;','&'
                if ($u -like '/media/pages/*') { $u = 'https://kenney.nl' + $u }
                elseif($u -notmatch '^https?://'){
                    try{$u = [System.Uri]::new([System.Uri]$Pack['Page'],$u).AbsoluteUri}catch{}
                }
                if ($u -match '^https?://.+\.zip(?:\?.*)?$') { return $u }
            }
        } catch { Write-Warning "Latest URL resolution failed for $($Pack.Name); using known-good creator URL. $($_.Exception.Message)" }
    }
    return [string]$Pack.Url
}

function Test-ZipPayload([string]$Path, [double]$MinMB) {
    if (-not (Test-Path $Path)) { return $false }
    $f = Get-Item $Path
    if ($f.Length -lt ($MinMB * 1MB)) { return $false }
    try {
        $fs = [System.IO.File]::OpenRead($Path)
        try {
            $b0 = $fs.ReadByte(); $b1 = $fs.ReadByte()
            return ($b0 -eq 0x50 -and $b1 -eq 0x4B)
        } finally { $fs.Dispose() }
    } catch { return $false }
}

function Download-Robust([string]$Url, [string]$OutFile, [double]$MinMB) {
    if (-not $Force -and (Test-ZipPayload $OutFile $MinMB)) { return $true }
    if (Test-Path $OutFile) { Remove-Item $OutFile -Force -ErrorAction SilentlyContinue }

    $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
    if ($curl) {
        Write-Host "[ASSET] curl $Url" -ForegroundColor DarkCyan
        & $curl.Source -L --fail --retry 6 --retry-all-errors --retry-delay 2 --connect-timeout 25 --max-time 1800 -A 'PhantomGamesAssetPipeline/11.0' -o $OutFile $Url
        if ($LASTEXITCODE -eq 0 -and (Test-ZipPayload $OutFile $MinMB)) { return $true }
        Remove-Item $OutFile -Force -ErrorAction SilentlyContinue
    }

    try {
        Write-Host "[ASSET] Invoke-WebRequest $Url" -ForegroundColor DarkCyan
        Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing -TimeoutSec 1800 -MaximumRedirection 10 -Headers @{'User-Agent'='PhantomGamesAssetPipeline/11.0'}
        if (Test-ZipPayload $OutFile $MinMB) { return $true }
    } catch { Write-Warning $_.Exception.Message }
    Remove-Item $OutFile -Force -ErrorAction SilentlyContinue
    return $false
}

$failures = @()
$inventory = @()
foreach ($p in $packs) {
    $zip = Join-Path $Downloads $p.File
    $dst = Join-Path $Root $p.Name
    $readyMarker = Join-Path $dst '.phantom_ready'
    $resolvedUrl = Resolve-CurrentPackUrl $p
    if ([string]::IsNullOrWhiteSpace($resolvedUrl)) {
        if ($p.Required) { $failures += $p.Name; Write-Host "[MISSING REQUIRED URL] $($p.Name)" -ForegroundColor Red }
        else { Write-Warning "Optional current URL could not be resolved: $($p.Name)" }
        $inventory += [pscustomobject]@{Name=$p.Name;Files=0;Source=$p.Source;License=$p.License;State='url-unresolved'}
        continue
    }
    $markerIsV11 = $false
    $markerSourceMatches = $false
    $markerFresh = $false
    if (Test-Path $readyMarker) {
        try {
            $markerText = Get-Content $readyMarker -Raw
            $markerIsV11 = $markerText -match '(?m)^pipeline=11$'
            $markerSourceMatches = $markerText -match ('(?m)^source=' + [regex]::Escape($resolvedUrl) + '$')
            $markerFresh = ((Get-Date) - (Get-Item $readyMarker).LastWriteTime).TotalDays -lt 7
        } catch {}
    }
    # V11 refresh policy: never trust a pre-V9 stage; refresh when a Kenney resolved URL changes;
    # and refresh current-main GitHub archives at least weekly. This keeps "current" meaningful
    # without downloading every creator library every time the user iterates on C++.
    if (-not $Force -and $markerIsV11 -and $markerSourceMatches -and $markerFresh -and @(Get-ChildItem $dst -Recurse -File -ErrorAction SilentlyContinue).Count -gt 5) {
        $count = @(Get-ChildItem $dst -Recurse -File -ErrorAction SilentlyContinue).Count
        Write-Host "[ASSET] V11 current library ready $($p.Name) ($count files; refreshed within 7 days)" -ForegroundColor DarkGreen
        $inventory += [pscustomobject]@{Name=$p.Name;Files=$count;Source=$p.Source;License=$p.License;State='ready-v10-current'}
        continue
    }

    Write-Host "[ASSET] acquiring current $($p.Name)..." -ForegroundColor Cyan
    $ok = Download-Robust $resolvedUrl $zip ([double]$p.MinMB)
    if (-not $ok) {
        if ($p.Required) { $failures += $p.Name; Write-Host "[MISSING REQUIRED] $($p.Name)" -ForegroundColor Red }
        else { Write-Warning "Optional pack unavailable: $($p.Name)" }
        $inventory += [pscustomobject]@{Name=$p.Name;Files=0;Source=$p.Source;License=$p.License;State='download-failed'}
        continue
    }

    try {
        if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
        New-Item -ItemType Directory -Force -Path $dst | Out-Null
        Expand-Archive -Path $zip -DestinationPath $dst -Force
        $fileCount = @(Get-ChildItem $dst -Recurse -File -ErrorAction SilentlyContinue).Count
        if ($fileCount -lt 5) { throw "Archive expanded to only $fileCount files" }
        Set-Content $readyMarker -Encoding UTF8 -Value @(
            "pack=$($p.Name)", "source=$resolvedUrl", "publisher=$($p.Source)", "license=$($p.License)",
            "pipeline=11", "files=$fileCount", "ready=$([DateTime]::Now.ToString('s'))"
        )
        Write-Host "[ASSET] staged $($p.Name): $fileCount files" -ForegroundColor Green
        $inventory += [pscustomobject]@{Name=$p.Name;Files=$fileCount;Source=$p.Source;License=$p.License;State='staged'}
    } catch {
        if ($p.Required) { $failures += $p.Name }
        Write-Warning "Could not stage $($p.Name): $($_.Exception.Message)"
        $inventory += [pscustomobject]@{Name=$p.Name;Files=0;Source=$p.Source;License=$p.License;State='extract-failed'}
    }
}

$inventory | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $Root 'PHANTOM_CURATED_ASSET_INVENTORY.json') -Encoding UTF8
if ($failures.Count -gt 0) {
    throw "Core curated CC0 art packs failed to acquire: $($failures -join ', '). Build stopped on purpose; this pass will NOT silently ship the old visuals again."
}

$requiredReady = @($packs | Where-Object Required)
$readyCount = 0
foreach ($p in $requiredReady) { if (Test-Path (Join-Path (Join-Path $Root $p.Name) '.phantom_ready')) { $readyCount++ } }
Set-Content (Join-Path $Root 'PHANTOM_CURATED_CC0_READY.txt') -Encoding UTF8 -Value @(
    'PHANTOM CURATED CC0 LIBRARY READY',
    "required=$readyCount/$($requiredReady.Count)",
    "ready=$([DateTime]::Now.ToString('s'))"
)
Write-Host "[ASSET] Required curated library ready: $readyCount/$($requiredReady.Count) packs." -ForegroundColor Green
exit 0
