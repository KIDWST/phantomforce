param([Parameter(Mandatory=$true)][string]$ProjectRoot,[switch]$Force)
$ErrorActionPreference='Stop'
$Root=Join-Path $ProjectRoot 'SourceArt\External\PolyHavenV11'
$Saved=Join-Path $ProjectRoot 'Saved'
New-Item -ItemType Directory -Force -Path $Root,$Saved | Out-Null
$UA='PhantomGamesProductionPipeline/11.0 (+PolyHaven attribution in PHANTOM_ASSET_REPORT.md)'
$headers=@{'User-Agent'=$UA}

function Get-Json([string]$Url){
  return Invoke-RestMethod -Uri $Url -Headers $headers -Method Get -TimeoutSec 90
}
function Score-Asset($a,[string[]]$Words){
  $blob=(($a.name)+' '+($a.description)+' '+($a.category)+' '+(($a.tags -join ' '))).ToLowerInvariant()
  $s=0
  foreach($w in $Words){if($blob.Contains($w.ToLowerInvariant())){$s+=100}}
  if($a.download_count){$s += [Math]::Min(90,[Math]::Log10([double]$a.download_count+1)*15)}
  return $s
}
function Flatten-Urls($node,[string]$prefix=''){
  $out=@()
  if($null -eq $node){return $out}
  if($node -is [string]){return $out}
  if($node.PSObject -and $node.PSObject.Properties['url']){
    $out += [pscustomobject]@{Key=$prefix;Url=[string]$node.url;Size=$node.size;Md5=$node.md5}
  }
  if($node -is [System.Collections.IDictionary]){
    foreach($k in $node.Keys){$out += Flatten-Urls $node[$k] ($prefix+'/'+$k)}
  } elseif($node.PSObject) {
    foreach($p in $node.PSObject.Properties){
      if($p.Name -in @('url','size','md5')){continue}
      if($p.Value -isnot [string]){$out += Flatten-Urls $p.Value ($prefix+'/'+$p.Name)}
    }
  }
  return $out
}
function Pick-File($flat,[string[]]$Needles){
  $c=@()
  foreach($f in $flat){
    $b=($f.Key+' '+$f.Url).ToLowerInvariant();$s=0
    foreach($n in $Needles){if($b.Contains($n.ToLowerInvariant())){$s+=100}}
    if($b -match '2k'){$s+=45}elseif($b -match '1k'){$s+=30}elseif($b -match '4k'){$s-=25}
    if($b -match '\.(jpg|jpeg|png)(\?|$)'){$s+=20}
    if($s -gt 0){$c += [pscustomobject]@{Score=$s;F=$f}}
  }
  if(-not $c){return $null}
  return ($c|Sort-Object Score -Descending|Select-Object -First 1).F
}
function Download-One($f,[string]$Dest){
  if($null -eq $f){return $false}
  if((Test-Path $Dest) -and -not $Force){return $true}
  try{
    Invoke-WebRequest -Uri $f.Url -OutFile $Dest -Headers $headers -UseBasicParsing -TimeoutSec 600 -MaximumRedirection 8
    return (Test-Path $Dest) -and (Get-Item $Dest).Length -gt 4096
  }catch{return $false}
}

Write-Host '[POLY HAVEN] Resolving current CC0 production materials...' -ForegroundColor Cyan
$assets=Get-Json 'https://api.polyhaven.com/assets'
$roles=[ordered]@{
  Grass=@('grass','ground','aerial');
  Cobble=@('cobblestone','stone','floor');
  Dirt=@('dirt','ground','earth');
  Rock=@('rock','cliff','stone');
  Asphalt=@('asphalt','road');
  Concrete=@('concrete','plaster','wall');
  Wood=@('wood','plank');
}
$inventory=@()
foreach($role in $roles.Keys){
  $best=$null;$bestScore=-1
  foreach($prop in $assets.PSObject.Properties){
    $id=$prop.Name;$a=$prop.Value
    if([int]$a.type -ne 1){continue}
    $score=Score-Asset $a $roles[$role]
    if($score -gt $bestScore){$bestScore=$score;$best=[pscustomobject]@{Id=$id;A=$a}}
  }
  if($null -eq $best -or $bestScore -lt 100){throw "Poly Haven could not resolve production material role $role"}
  $files=Get-Json ('https://api.polyhaven.com/files/'+$best.Id)
  $flat=@(Flatten-Urls $files)
  $dir=Join-Path $Root $role;New-Item -ItemType Directory -Force -Path $dir|Out-Null
  $maps=[ordered]@{
    BaseColor=Pick-File $flat @('diff','albedo','basecolor');
    Normal=Pick-File $flat @('nor_gl','normal');
    Roughness=Pick-File $flat @('rough');
    Displacement=Pick-File $flat @('disp','height');
  }
  $downloaded=@{}
  foreach($m in $maps.Keys){
    $f=$maps[$m];if($null -eq $f){continue}
    $ext=[IO.Path]::GetExtension(([Uri]$f.Url).AbsolutePath);if(-not $ext){$ext='.jpg'}
    $dest=Join-Path $dir ($m+$ext)
    if(Download-One $f $dest){$downloaded[$m]=$dest}
  }
  if(-not $downloaded.ContainsKey('BaseColor')){throw "Poly Haven role $role downloaded no BaseColor"}
  $inventory += [pscustomobject]@{Role=$role;AssetId=$best.Id;Name=$best.A.name;Score=$bestScore;Files=$downloaded}
  Write-Host "[POLY HAVEN] $role <- $($best.Id) / $($best.A.name)" -ForegroundColor Green
}
$inventory|ConvertTo-Json -Depth 8|Set-Content (Join-Path $Saved 'PhantomPolyHavenV11.json') -Encoding UTF8
@(
 'PHANTOM POLY HAVEN V11','Powered by Poly Haven','Assets are CC0; live API attribution recorded by PhantomGames production pipeline.',
 "roles=$($inventory.Count)","generated=$([DateTime]::Now.ToString('s'))"
)|Set-Content (Join-Path $Root 'POWERED_BY_POLY_HAVEN.txt') -Encoding UTF8
if($inventory.Count -lt 6){throw "Poly Haven production material gate failed: $($inventory.Count)/7 roles"}
