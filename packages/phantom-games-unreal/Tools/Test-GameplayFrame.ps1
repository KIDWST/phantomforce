param(
    [Parameter(Mandatory=$true)][string]$ProofRoot
)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing

$Files=@(Get-ChildItem $ProofRoot -File -Filter '*-GAMEPLAY.png' -ErrorAction SilentlyContinue | Sort-Object Name)
if($Files.Count -lt 4){throw "V11 visual gate expected four gameplay PNGs under $ProofRoot; found $($Files.Count)."}

function Get-LocalDetailRatio([System.Drawing.Bitmap]$Bmp,[double]$TopFraction,[int]$Cols=16,[int]$Rows=9){
    $W=$Bmp.Width; $H=$Bmp.Height
    $Y0=[int]($H*$TopFraction)
    $RegionH=[Math]::Max(1,$H-$Y0)
    $Detailed=0
    for($TY=0;$TY -lt $Rows;$TY++){
        for($TX=0;$TX -lt $Cols;$TX++){
            $MinLum=999.0; $MaxLum=-1.0; $MinSat=999.0; $MaxSat=-1.0
            for($SY=1;$SY -le 4;$SY++){
                for($SX=1;$SX -le 4;$SX++){
                    $PX=[Math]::Min($W-1,[int](($TX+($SX/5.0))*$W/$Cols))
                    $PY=[Math]::Min($H-1,$Y0+[int](($TY+($SY/5.0))*$RegionH/$Rows))
                    $C=$Bmp.GetPixel($PX,$PY)
                    $LL=0.2126*$C.R+0.7152*$C.G+0.0722*$C.B
                    $Hi=[Math]::Max($C.R,[Math]::Max($C.G,$C.B)); $Lo=[Math]::Min($C.R,[Math]::Min($C.G,$C.B))
                    $Sat=$Hi-$Lo
                    if($LL -lt $MinLum){$MinLum=$LL}; if($LL -gt $MaxLum){$MaxLum=$LL}
                    if($Sat -lt $MinSat){$MinSat=$Sat}; if($Sat -gt $MaxSat){$MaxSat=$Sat}
                }
            }
            # Count local material/geometry/color variation. This intentionally rejects the giant-flat-plane failure.
            if((($MaxLum-$MinLum) -gt 18.0) -or (($MaxSat-$MinSat) -gt 24.0)){$Detailed++}
        }
    }
    return $Detailed/[double]($Cols*$Rows)
}

$Results=@()
foreach($File in $Files){
    $Bmp=[System.Drawing.Bitmap]::FromFile($File.FullName)
    try{
        $W=$Bmp.Width; $H=$Bmp.Height
        if($W -lt 1200 -or $H -lt 675){throw "$($File.Name) is only ${W}x${H}."}

        $NX=112; $NY=63
        $Lums=New-Object System.Collections.Generic.List[double]
        $Buckets=@{}
        $Edges=0; $EdgeTests=0; $Dark=0
        $PrevRow=@()
        for($GY=0;$GY -lt $NY;$GY++){
            $CurrentRow=@()
            $Y=[Math]::Min($H-1,[int](($GY+0.5)*$H/$NY))
            for($GX=0;$GX -lt $NX;$GX++){
                $X=[Math]::Min($W-1,[int](($GX+0.5)*$W/$NX))
                $C=$Bmp.GetPixel($X,$Y)
                $Lum=0.2126*$C.R+0.7152*$C.G+0.0722*$C.B
                $Lums.Add($Lum)
                if($Lum -lt 10){$Dark++}
                $Key=("{0}-{1}-{2}" -f [int]($C.R/20),[int]($C.G/20),[int]($C.B/20))
                if($Buckets.ContainsKey($Key)){$Buckets[$Key]++}else{$Buckets[$Key]=1}
                $CurrentRow += ,@($C.R,$C.G,$C.B)
                if($GX -gt 0){$P=$CurrentRow[$GX-1];$D=[Math]::Abs($C.R-$P[0])+[Math]::Abs($C.G-$P[1])+[Math]::Abs($C.B-$P[2]);if($D -gt 38){$Edges++};$EdgeTests++}
                if($GY -gt 0){$P=$PrevRow[$GX];$D=[Math]::Abs($C.R-$P[0])+[Math]::Abs($C.G-$P[1])+[Math]::Abs($C.B-$P[2]);if($D -gt 38){$Edges++};$EdgeTests++}
            }
            $PrevRow=$CurrentRow
        }

        $N=$Lums.Count
        $Mean=($Lums | Measure-Object -Average).Average
        $Var=(($Lums | ForEach-Object {($_-$Mean)*($_-$Mean)} | Measure-Object -Sum).Sum)/[Math]::Max(1,$N)
        $Std=[Math]::Sqrt($Var)
        $Largest=($Buckets.Values | Measure-Object -Maximum).Maximum
        $LargestRatio=$Largest/[double]$N
        $EdgeRatio=$Edges/[double][Math]::Max(1,$EdgeTests)
        $DarkRatio=$Dark/[double]$N
        $DetailRatio=Get-LocalDetailRatio $Bmp 0.0 16 9
        $LowerDetailRatio=Get-LocalDetailRatio $Bmp 0.25 16 9

        # V11 has game-specific quality floors. The previous generic threshold was too easy to
        # fool with a HUD plus a few props over a giant flat field.
        if($File.Name -match 'cubetown')      {$MinDetail=0.76;$MinLower=0.78;$MinEdge=0.075;$MaxFlat=0.36}
        elseif($File.Name -match 'phantom-legends'){$MinDetail=0.72;$MinLower=0.75;$MinEdge=0.070;$MaxFlat=0.38}
        elseif($File.Name -match 'phantom-ages')   {$MinDetail=0.68;$MinLower=0.72;$MinEdge=0.065;$MaxFlat=0.40}
        else                                   {$MinDetail=0.72;$MinLower=0.74;$MinEdge=0.070;$MaxFlat=0.40}

        $Pass=$true; $Why=@()
        if($Std -lt 15){$Pass=$false;$Why+='luminance variance too low'}
        if($LargestRatio -gt $MaxFlat){$Pass=$false;$Why+='single flat color dominates too much of the gameplay frame'}
        if($EdgeRatio -lt $MinEdge){$Pass=$false;$Why+='scene edge/detail density too low'}
        if($DetailRatio -lt $MinDetail){$Pass=$false;$Why+='too much of the full frame is locally empty/flat'}
        if($LowerDetailRatio -lt $MinLower){$Pass=$false;$Why+='gameplay foreground/lower frame is too empty'}
        if($Mean -lt 20){$Pass=$false;$Why+='overall gameplay image is far too dark'}
        if($DarkRatio -gt 0.70){$Pass=$false;$Why+='frame is mostly black'}

        $Results += [PSCustomObject]@{
            File=$File.Name; Width=$W; Height=$H; StdDev=[Math]::Round($Std,2);
            LargestColorRatio=[Math]::Round($LargestRatio,3); EdgeRatio=[Math]::Round($EdgeRatio,3);
            DetailTileRatio=[Math]::Round($DetailRatio,3); LowerDetailTileRatio=[Math]::Round($LowerDetailRatio,3);
            DarkRatio=[Math]::Round($DarkRatio,3); Pass=$Pass; Reason=($Why -join '; ')
        }
    } finally {$Bmp.Dispose()}
}

$Report=Join-Path $ProofRoot 'V11_VISUAL_GATE.csv'
$Results | Export-Csv $Report -NoTypeInformation
$Results | Format-Table -AutoSize | Out-Host
$Failed=@($Results | Where-Object {-not $_.Pass})
if($Failed.Count){
    throw "V11 production-reboot visual gate rejected $($Failed.Count) candidate frame(s). LIVE BUILDS WERE NOT REPLACED. See $Report and the candidate screenshots."
}
Write-Host 'V11 production-reboot visual gate PASS: all four actual gameplay frames cleared flat/blank/prototype-frame checks.' -ForegroundColor Green
