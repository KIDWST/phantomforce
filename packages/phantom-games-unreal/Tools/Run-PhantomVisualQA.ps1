param(
 [string]$ProjectRoot="C:\Users\jorda\Documents\Codex\2026-07-30\hi\work\phantomforce-phantomplay-platform-20260811\packages\phantom-games-unreal",
 [int]$CaptureDelaySeconds=12
)
$ErrorActionPreference='Continue'
$Games=@(
 @{Id='phantom-strike';Exe='PhantomStrike.exe'},
 @{Id='phantom-ages';Exe='PhantomAges.exe'},
 @{Id='phantom-legends';Exe='PhantomLegends.exe'},
 @{Id='cubetown';Exe='Cubetown.exe'}
)
$Res=@(@(1920,1080),@(2560,1440),@(3440,1440),@(3840,2160))
$QaRoot=Join-Path $ProjectRoot 'Saved\PhantomQA'
New-Item -ItemType Directory -Force $QaRoot|Out-Null
$Log=@('# PHANTOM VISUAL QA','',"Generated: $([DateTime]::Now.ToString('s'))",'')
foreach($G in $Games){
 $Exe=Join-Path $ProjectRoot ("Builds\Windows\"+$G.Id+"\"+$G.Exe)
 if(!(Test-Path $Exe)){$Log+="- MISSING BUILD: $Exe";continue}
 foreach($R in $Res){
   $W=$R[0];$H=$R[1]
   $Dir=Join-Path $QaRoot ($G.Id+"\"+$W+"x"+$H);New-Item -ItemType Directory -Force $Dir|Out-Null
   $Args="-ResX=$W -ResY=$H -WINDOWED -NoSplash -ExecCmds=`"HighResShot 1`""
   $P=Start-Process $Exe -ArgumentList $Args -PassThru
   Start-Sleep -Seconds $CaptureDelaySeconds
   if(!$P.HasExited){Stop-Process -Id $P.Id -Force}
   $Saved=Join-Path (Split-Path $Exe -Parent) 'PhantomGames\Saved\Screenshots\Windows'
   if(Test-Path $Saved){Get-ChildItem $Saved -File -Filter '*.png'|Sort-Object LastWriteTime -Descending|Select-Object -First 1|Copy-Item -Destination (Join-Path $Dir 'TitleOrGameplay.png') -Force}
   $Log+="- $($G.Id) $W x $H captured/attempted"
 }
}
Set-Content (Join-Path $ProjectRoot 'PHANTOM_VISUAL_QA.md') $Log -Encoding UTF8
Write-Host "QA root: $QaRoot"
