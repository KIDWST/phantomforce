param(
    [string]$ProjectRoot = "",
    [switch]$NoUnreal
)
$ErrorActionPreference = "Stop"
if(-not $ProjectRoot){$ProjectRoot=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path}
$Agent = Join-Path $ProjectRoot "Tools\PhantomPlayAI\phantomplay_ai.py"
if (-not (Test-Path -LiteralPath $Agent -PathType Leaf)) { throw "PhantomPlay AI agent missing: $Agent" }

$py = Get-Command py.exe -ErrorAction SilentlyContinue
$python = Get-Command python.exe -ErrorAction SilentlyContinue
if ($py) {
    $exe = $py.Source
    $prefix = @("-3")
} elseif ($python) {
    $exe = $python.Source
    $prefix = @()
} else {
    throw "Python 3 was not found. Install Python 3 or enable the Windows Python launcher, then rerun."
}

Write-Host ""
Write-Host "PHANTOMPLAY AI V18" -ForegroundColor Green
Write-Host "Project: $ProjectRoot"
Write-Host "AI UI: http://127.0.0.1:8765" -ForegroundColor Cyan
Write-Host "Unreal MCP: http://127.0.0.1:8000/mcp" -ForegroundColor Cyan
Write-Host ""

$args = @($prefix + @($Agent, "--project", $ProjectRoot))
if (-not $NoUnreal) { $args += "--launch-unreal" }
& $exe @args
exit $LASTEXITCODE
