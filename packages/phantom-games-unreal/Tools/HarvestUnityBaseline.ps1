param(
    [Parameter(Mandatory=$true)][string]$ProjectRoot,
    [string]$RepositoryRoot = ""
)
$ErrorActionPreference = 'Stop'

function Find-RepoRoot([string]$Start) {
    if ($RepositoryRoot -and (Test-Path $RepositoryRoot)) { return (Resolve-Path $RepositoryRoot).Path }
    $cursor = (Resolve-Path $Start).Path
    for($i=0; $i -lt 8; $i++) {
        if ((Test-Path (Join-Path $cursor 'packages\phantom-games-unity')) -or (Test-Path (Join-Path $cursor 'app\games\cubetown\cubetown.js'))) { return $cursor }
        $parent = Split-Path -Parent $cursor
        if (-not $parent -or $parent -eq $cursor) { break }
        $cursor = $parent
    }
    $known = Join-Path $env:USERPROFILE 'Documents\Codex\2026-07-30\hi\work\phantomforce-phantomplay-platform-20260811'
    if (Test-Path $known) { return $known }
    throw "Could not discover PhantomForce repository root from $Start"
}

$Repo = Find-RepoRoot $ProjectRoot
$UnityRoot = Join-Path $Repo 'packages\phantom-games-unity'
$AssetsRoot = Join-Path $UnityRoot 'Assets'
$WebCube = Join-Path $Repo 'app\games\cubetown\cubetown.js'
$Saved = Join-Path $ProjectRoot 'Saved'
New-Item -ItemType Directory -Force -Path $Saved | Out-Null
$ManifestPath = Join-Path $Saved 'PhantomUnityBaselineInventory.json'
$ReportPath = Join-Path $Saved 'PhantomUnityBaselineInventory.txt'

$extensions = @('.fbx','.obj','.glb','.gltf','.png','.jpg','.jpeg','.tga','.bmp','.exr','.hdr','.wav','.ogg','.mp3')
$files = @()
if (Test-Path $AssetsRoot) {
    $files = @(Get-ChildItem $AssetsRoot -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $extensions -contains $_.Extension.ToLowerInvariant() })
}

function Game-For([string]$Path) {
    $p = $Path.ToLowerInvariant()
    if ($p -match '\\strike\\|phantomstrike|nightglass|fps|weapon|rifle|pistol') { return 'Strike' }
    if ($p -match '\\ages\\|phantomages|ageofwar|era|tower') { return 'Ages' }
    if ($p -match '\\legends\\|phantomlegends|riftbound|rts|strategy') { return 'Legends' }
    if ($p -match 'cubetown|echo|maker|voxel|cozy') { return 'Cube' }
    return 'Shared'
}

function Category-For([string]$Path) {
    $p = $Path.ToLowerInvariant()
    if ($p -match 'rifle|pistol|gun|weapon|sword|axe|bow|staff') { return 'weapon' }
    if ($p -match 'character|hero|soldier|warrior|knight|ranger|worker|enemy|skeleton|orc|dragon|giant|creature') { return 'character' }
    if ($p -match 'house|building|castle|keep|tower|wall|gate|fort|shop|market|tavern|inn|warehouse|hotel|hospital|bank|church') { return 'building' }
    if ($p -match 'tree|bush|grass|flower|mushroom|foliage|plant') { return 'foliage' }
    if ($p -match 'road|street|bridge|path|sidewalk|curb') { return 'infrastructure' }
    if ($p -match 'rock|cliff|mountain|terrain|ground') { return 'terrain' }
    if ($p -match 'crate|barrel|bench|lamp|light|sign|cart|fence|prop|debris|rubble|container') { return 'prop' }
    if ($p -match '\.(png|jpg|jpeg|tga|bmp|exr|hdr)$') { return 'texture' }
    if ($p -match '\.(wav|ogg|mp3)$') { return 'audio' }
    return 'misc'
}

# Score and cap candidates so a baseline with thousands of files cannot lock the workstation for hours.
$scored = foreach($f in $files) {
    $game = Game-For $f.FullName
    $cat = Category-For $f.FullName
    $name = $f.BaseName.ToLowerInvariant()
    $score = 0
    if ($game -ne 'Shared') { $score += 40 }
    if ($cat -in @('character','building','weapon','foliage','infrastructure','terrain','prop')) { $score += 25 }
    if ($f.Extension.ToLowerInvariant() -in @('.fbx','.glb','.gltf','.obj')) { $score += 30 }
    if ($name -match 'final|hero|main|modular|high|lod0|castle|village|rifle|dragon|tree|house|tower') { $score += 10 }
    if ($name -match 'lod[2-9]|collision|proxy|preview|thumb|icon|ui|test') { $score -= 20 }
    [pscustomobject]@{
        path = $f.FullName
        relative = $f.FullName.Substring($Repo.Length).TrimStart('\')
        game = $game
        category = $cat
        extension = $f.Extension.ToLowerInvariant()
        size = $f.Length
        score = $score
    }
}

$selected = @()
foreach($game in @('Strike','Ages','Legends','Cube','Shared')) {
    foreach($cat in @('character','building','weapon','foliage','infrastructure','terrain','prop','texture','audio','misc')) {
        $quota = switch($cat) {
            'texture' { 35 }
            'audio' { 25 }
            'misc' { 10 }
            default { 55 }
        }
        $selected += @($scored | Where-Object { $_.game -eq $game -and $_.category -eq $cat } | Sort-Object @{Expression='score';Descending=$true}, @{Expression='size';Descending=$true} | Select-Object -First $quota)
    }
}
$selected = @($selected | Sort-Object path -Unique)

# Preserve the known Unity gameplay scripts as baseline evidence. Unreal code is the destination,
# but the original loops are never ignored again.
$scriptCandidates = @(
    'packages\phantom-games-unity\Assets\PhantomForge\Scripts\Strike\PhantomStrikeGame.cs',
    'packages\phantom-games-unity\Assets\PhantomForge\Scripts\Ages\PhantomAgesGame.cs',
    'packages\phantom-games-unity\Assets\PhantomForge\Scripts\Legends\PhantomLegendsGame.cs',
    'packages\phantom-games-unity\Assets\PhantomForge\Scripts\Core\PhantomGameBootstrap.cs',
    'packages\phantom-games-unity\Assets\PhantomForge\Editor\PhantomBuildPipeline.cs',
    'app\games\cubetown\cubetown.js'
)
$scripts = @()
foreach($rel in $scriptCandidates) {
    $p = Join-Path $Repo $rel
    if (Test-Path $p) {
        $text = Get-Content $p -Raw -ErrorAction SilentlyContinue
        $features = @()
        foreach($kw in @('ADS','sprint','slide','grenade','headshot','wave','extraction','age','evolve','tower','formation','selection','resource','build','quest','shrine','echo','friend','season','portal','co-op','coop')) {
            if ($text -match [regex]::Escape($kw)) { $features += $kw }
        }
        $scripts += [pscustomobject]@{ path=$p; relative=$rel; bytes=(Get-Item $p).Length; detected_features=$features }
    }
}

$manifest = [ordered]@{
    schema = 2
    generated = [DateTime]::Now.ToString('s')
    repository_root = $Repo
    unity_root = $UnityRoot
    asset_files_found = $files.Count
    selected_files = $selected
    baseline_scripts = $scripts
    cubetown_web_baseline = $(if(Test-Path $WebCube){$WebCube}else{$null})
}
$manifest | ConvertTo-Json -Depth 8 | Set-Content $ManifestPath -Encoding UTF8

$lines = @(
    'PHANTOM UNITY BASELINE HARVEST',
    "repo=$Repo",
    "unity=$UnityRoot",
    "asset_files_found=$($files.Count)",
    "selected_files=$($selected.Count)",
    "baseline_scripts=$($scripts.Count)",
    '',
    'SELECTED BY GAME/CATEGORY:'
)
$lines += $selected | Group-Object game,category | Sort-Object Name | ForEach-Object { "  $($_.Name) = $($_.Count)" }
$lines += ''
$lines += 'BASELINE SCRIPTS:'
$lines += $scripts | ForEach-Object { "  $($_.relative) [$($_.detected_features -join ', ')]" }
Set-Content $ReportPath -Value $lines -Encoding UTF8
Write-Host "Unity baseline harvest: $($files.Count) eligible files found; $($selected.Count) selected for one-shot Unreal import." -ForegroundColor Green
Write-Host "Manifest: $ManifestPath" -ForegroundColor DarkGray
exit 0
