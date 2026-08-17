param([string]$ProjectRoot)
$ErrorActionPreference='Stop'; Set-StrictMode -Version Latest
if(-not $ProjectRoot){$ProjectRoot=Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)}
$PackagesRoot=Resolve-Path (Join-Path $ProjectRoot '..')
$UnitySource=Join-Path $PackagesRoot 'phantom-games-unity'
$PipelineRel='Assets\PhantomForge\Editor\PhantomBuildPipeline.cs'
if(-not(Test-Path (Join-Path $UnitySource $PipelineRel))){throw "Unity baseline project not found: $UnitySource"}

$Candidates=@()
foreach($root in @('C:\Program Files\Unity\Hub\Editor','D:\Program Files\Unity\Hub\Editor','H:\Unity\Hub\Editor')){
 if(Test-Path $root){$Candidates+=Get-ChildItem $root -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending | ForEach-Object {Join-Path $_.FullName 'Editor\Unity.exe'} | Where-Object {Test-Path $_}}
}
$Unity=$Candidates|Select-Object -First 1
if(-not $Unity){throw 'Unity Editor was not found. This safety builder never installs Unity automatically.'}

# Never run the old baseline build pipeline against the live Unity checkout: it may use relative
# production-output paths. Clone source into an isolated workspace first so even old hard-coded
# relative build paths remain under UnitySafetyWorkspace rather than touching Unreal/live packages.
$WorkspaceRoot=Join-Path $ProjectRoot 'UnitySafetyWorkspace\V11'
$UnityProject=Join-Path $WorkspaceRoot 'phantom-games-unity'
if(Test-Path $WorkspaceRoot){Remove-Item $WorkspaceRoot -Recurse -Force}
New-Item -ItemType Directory -Force -Path $UnityProject|Out-Null
Write-Host "[UNITY SAFETY] Cloning baseline without Library/Temp/cache folders..." -ForegroundColor Cyan
& robocopy.exe $UnitySource $UnityProject /E /R:1 /W:1 /NFL /NDL /NJH /NJS /NP /XD Library Temp Logs obj .git Build Builds | Out-Null
$Rc=$LASTEXITCODE
if($Rc -ge 8){throw "Unity safety clone failed with robocopy code $Rc"}

$PipelinePath=Join-Path $UnityProject $PipelineRel
$Pipeline=Get-Content $PipelinePath -Raw
$Ns=[regex]::Match($Pipeline,'namespace\s+([A-Za-z0-9_.]+)').Groups[1].Value
$Class=[regex]::Match($Pipeline,'class\s+(PhantomBuildPipeline)').Groups[1].Value
if(-not $Class){throw 'Could not prove PhantomBuildPipeline class from the Unity baseline source.'}
$Output=Join-Path $WorkspaceRoot 'Logs'; New-Item -ItemType Directory -Force -Path $Output|Out-Null
$Methods=@('BuildPhantomStrike','BuildPhantomAges','BuildPhantomLegends')
$Ran=0
foreach($m in $Methods){
 if($Pipeline -notmatch ('public\s+static\s+void\s+'+[regex]::Escape($m)+'\s*\(')){Write-Warning "Unity baseline has no proven $m method; skipping.";continue}
 $execute=if($Ns){"$Ns.$Class.$m"}else{"$Class.$m"}
 Write-Host "[UNITY SAFETY] $execute" -ForegroundColor Cyan
 & $Unity -batchmode -quit -projectPath $UnityProject -executeMethod $execute -logFile (Join-Path $Output ($m+'.log'))
 if($LASTEXITCODE -ne 0){throw "$m failed. See $(Join-Path $Output ($m+'.log'))"}
 $Ran++
}
if($Ran -lt 3){throw "Unity baseline safety build only proved/ran $Ran of 3 flagship build methods."}
Set-Content (Join-Path $WorkspaceRoot 'README.txt') -Encoding UTF8 -Value @(
 'UNITY V11 SAFETY WORKSPACE',
 "source=$UnitySource",
 "isolated_copy=$UnityProject",
 'The three original PhantomForge build methods were executed only inside this isolated copy.',
 'Nothing in this safety command automatically replaces the Unreal CandidateBuilds or live PhantomPlay executables.',
 'Inspect the isolated workspace/build output manually before using anything from it.'
)
Write-Host "Unity baseline safety build complete: $WorkspaceRoot" -ForegroundColor Green
