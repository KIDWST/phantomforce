param(
  [string]$Model = "qwen2.5:14b",
  [string]$BaseUrl = "http://127.0.0.1:11434",
  [string]$OllamaPath = ""
)

$ErrorActionPreference = "Stop"
$stateDir = Join-Path $env:LOCALAPPDATA "PhantomForce\instant-brain"
$logPath = Join-Path $stateDir "startup.log"
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null

function Write-BrainLog {
  param([string]$Message)
  $stamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  Add-Content -LiteralPath $logPath -Value "[$stamp] $Message"
}

try {
  if (-not $OllamaPath) {
    $command = Get-Command ollama -ErrorAction Stop
    $OllamaPath = $command.Source
  }

  try {
    Invoke-RestMethod -Uri "$BaseUrl/api/tags" -TimeoutSec 3 | Out-Null
  } catch {
    Start-Process -FilePath $OllamaPath -ArgumentList "serve" -WindowStyle Hidden
  }

  $tags = $null
  for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
    try {
      $tags = Invoke-RestMethod -Uri "$BaseUrl/api/tags" -TimeoutSec 3
      break
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  if (-not $tags) {
    throw "Ollama did not become ready at $BaseUrl."
  }

  $installed = @($tags.models | ForEach-Object { if ($_.model) { $_.model } else { $_.name } })
  if ($installed -notcontains $Model) {
    throw "Required instant model '$Model' is not installed."
  }

  $body = @{
    model = $Model
    prompt = "Respond with ready."
    stream = $false
    keep_alive = "24h"
    options = @{ num_predict = 2; temperature = 0; num_ctx = 2048 }
  } | ConvertTo-Json -Depth 4
  Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/generate" -ContentType "application/json" -Body $body -TimeoutSec 120 | Out-Null
  Write-BrainLog "READY model=$Model endpoint=$BaseUrl keep_alive=24h"
  Write-Output "Phantom Instant ready: $Model"
} catch {
  Write-BrainLog "FAILED $($_.Exception.Message)"
  throw
}
