param([string]$ProjectRoot="")
$ErrorActionPreference='Stop'
if(-not $ProjectRoot){$ProjectRoot=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path}
$Games=@(
 @{Id='phantom-strike';Exe='PhantomStrike.exe'},
 @{Id='phantom-ages';Exe='PhantomAges.exe'},
 @{Id='phantom-legends';Exe='PhantomLegends.exe'},
 @{Id='cubetown';Exe='Cubetown.exe'}
)
$Out=Join-Path $ProjectRoot 'PHANTOM_BUILD_PATH_AUDIT.md'
$Lines=@('# PHANTOM BUILD PATH AUDIT','',"Generated: $([DateTime]::Now.ToString('s'))",'')
foreach($G in $Games){
 $Expected=Join-Path $ProjectRoot ("Builds\Windows\"+$G.Id+"\"+$G.Exe)
 $Matches=@(Get-ChildItem $ProjectRoot -Recurse -File -Filter $G.Exe -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
 $Lines+="## $($G.Id)"
 $Lines+="- Expected PhantomPlay path: $Expected"
 $Lines+="- Expected exists: $(Test-Path $Expected)"
 if(Test-Path $Expected){$F=Get-Item $Expected;$Lines+="- Expected modified: $($F.LastWriteTime.ToString('s'))";$Lines+="- SHA256: $((Get-FileHash $Expected -Algorithm SHA256).Hash)"}
 $Lines+='- Executables discovered:'
 if($Matches.Count){$Lines += $Matches|Select-Object -First 12|ForEach-Object{"  - $($_.FullName) | $($_.LastWriteTime.ToString('s'))"}} else {$Lines+='  - none'}
 $Lines+=''
}
Set-Content $Out $Lines -Encoding UTF8
Write-Host $Out
